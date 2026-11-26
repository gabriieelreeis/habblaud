import { describe, expect, it } from 'vitest';
import type { AgentInfo, OutboxMessage } from '../../shared/types';
import type { ClaudeDefaults } from '../claude-defaults/defaults';
import { claudeCommand, ControlRegistry, InvalidControl, parseControl } from './controls';

function agent(patch: Partial<AgentInfo> = {}): AgentInfo {
  return { id: '.claude:1', kind: 'main', account: '.claude', sessionId: 's1', status: 'idle', provider: 'claude', ...patch } as AgentInfo;
}

function setup(opts: { snapshot?: ClaudeDefaults | { error: string }; restore?: 'restored' | 'unchanged' | { error: string }; agent?: AgentInfo } = {}) {
  let now = 1_000_000;
  const a = opts.agent ?? agent();
  const sent: string[] = [];
  const msgs = new Map<string, OutboxMessage>();
  const restores: Array<{ before: ClaudeDefaults; kind: string; sentValue: string }> = [];
  let snapshots = 0;
  const reg = new ControlRegistry({
    agent: (id) => (id === a.id ? a : undefined),
    send: (agentId, text) => {
      sent.push(text);
      const m: OutboxMessage = { id: `m${sent.length}`, agentId, status: 'queued', createdAt: now, updatedAt: now };
      msgs.set(m.id, m);
      return { message: { ...m } };
    },
    message: (id) => msgs.get(id),
    defaults: {
      snapshot: async () => {
        snapshots++;
        return opts.snapshot ?? { modelEffort: { 'claude-opus-5-5': 'xhigh' } };
      },
      restore: async (_acc, before, kind, sentValue) => {
        restores.push({ before, kind, sentValue });
        return opts.restore ?? 'restored';
      },
    },
    now: () => now,
  });
  return {
    reg,
    a,
    sent,
    msgs,
    restores,
    snapshots: () => snapshots,
    advance: (ms: number) => (now += ms),
    at: () => now,
  };
}

const flush = () => new Promise((ok) => setTimeout(ok, 0));

describe('troca de modelo e esforço', () => {
  it('confere o pedido', () => {
    expect(parseControl({ agentId: 'a', kind: 'effort', value: 'high' })).toEqual({ agentId: 'a', kind: 'effort', value: 'high', asDefault: false });
    expect(parseControl({ agentId: 'a', kind: 'model', value: 'opencode/x', variant: 'low', asDefault: true })).toEqual({ agentId: 'a', kind: 'model', value: 'opencode/x', variant: 'low', asDefault: true });
    expect(() => parseControl({ agentId: 'a', kind: 'cor', value: 'x' })).toThrow(InvalidControl);
    expect(() => parseControl({ agentId: 'a', kind: 'effort', value: 'x', asDefault: 'sim' })).toThrow(InvalidControl);
    expect(claudeCommand('effort', 'xhigh')).toBe('/effort xhigh');
    expect(claudeCommand('effort', 'turbo')).toBeUndefined();
    expect(claudeCommand('model', 'claude-sonnet-5-5[1m]')).toBe('/model claude-sonnet-5-5[1m]');
    expect(claudeCommand('model', 'sonnet; rm -rf')).toBeUndefined();
  });

  it('Claude Code: guarda o padrão, manda o /effort, confirma pela conversa e devolve o padrão', async () => {
    const t = setup();
    const r = await t.reg.create({ agentId: t.a.id, kind: 'effort', value: 'low' });
    expect(r).toMatchObject({ control: { kind: 'effort', value: 'low', status: 'sending', defaults: 'pending' } });
    expect(t.sent).toEqual(['/effort low']);
    const id = 'control' in r ? r.control.id : '';
    t.msgs.get('m1')!.status = 'delivered';
    t.reg.tick();
    expect(t.reg.get(id)?.status).toBe('waiting');
    t.advance(5_000);
    t.a.effort = { level: 'low', source: 'command', at: t.at() };
    t.reg.tick();
    expect(t.reg.get(id)?.status).toBe('confirmed');
    await flush();
    expect(t.restores).toEqual([{ before: { modelEffort: { 'claude-opus-5-5': 'xhigh' } }, kind: 'effort', sentValue: 'low' }]);
    expect(t.reg.get(id)?.defaults).toBe('restored');
  });

  it('um /effort de antes do envio não confirma', async () => {
    const t = setup({ agent: agent({ effort: { level: 'low', source: 'command', at: 1 } }) });
    const r = await t.reg.create({ agentId: t.a.id, kind: 'effort', value: 'low' });
    t.reg.tick();
    expect('control' in r && t.reg.get(r.control.id)?.status).toBe('sending');
  });

  it('com "também como padrão" não guarda nem devolve nada', async () => {
    const t = setup();
    const r = await t.reg.create({ agentId: t.a.id, kind: 'model', value: 'haiku', asDefault: true });
    expect(t.snapshots()).toBe(0);
    expect(r).toMatchObject({ control: { defaults: 'saved' } });
    t.a.modelChoice = { label: 'Haiku 5.5', at: t.at() };
    t.reg.tick();
    await flush();
    expect('control' in r && t.reg.get(r.control.id)?.status).toBe('confirmed');
    expect(t.restores).toEqual([]);
  });

  it('sem como guardar o padrão, recusa e explica', async () => {
    const t = setup({ snapshot: { error: 'o auxiliar do computador (npm run codex:bridge) não está rodando' } });
    const r = await t.reg.create({ agentId: t.a.id, kind: 'effort', value: 'low' });
    expect(r).toMatchObject({ status: 409 });
    expect('error' in r && r.error).toContain('Também como padrão das sessões novas');
    expect(t.sent).toEqual([]);
  });

  it('duas trocas seguidas usam o padrão de antes da primeira', async () => {
    const t = setup();
    await t.reg.create({ agentId: t.a.id, kind: 'effort', value: 'low' });
    await t.reg.create({ agentId: t.a.id, kind: 'effort', value: 'high' });
    expect(t.snapshots()).toBe(1);
    await t.reg.create({ agentId: t.a.id, kind: 'model', value: 'haiku' });
    expect(t.snapshots()).toBe(2);
  });

  it('entrega que falhou: avisa, mas uma confirmação atrasada ainda devolve o padrão', async () => {
    const t = setup();
    const r = await t.reg.create({ agentId: t.a.id, kind: 'effort', value: 'max' });
    const id = 'control' in r ? r.control.id : '';
    Object.assign(t.msgs.get('m1')!, { status: 'failed', error: 'a sessão não confirmou a entrega' });
    t.reg.tick();
    expect(t.reg.get(id)).toMatchObject({ status: 'failed', error: 'a sessão não confirmou a entrega', defaults: 'pending' });
    t.advance(1_000);
    t.a.effort = { level: 'max', source: 'command', at: t.at() };
    t.reg.tick();
    await flush();
    expect(t.reg.get(id)).toMatchObject({ status: 'confirmed', defaults: 'restored' });
  });

  it('prazo vencido: falha e não devolve nada', async () => {
    const t = setup();
    const r = await t.reg.create({ agentId: t.a.id, kind: 'effort', value: 'low' });
    t.advance(31 * 60_000);
    t.reg.tick();
    expect('control' in r && t.reg.get(r.control.id)).toMatchObject({ status: 'failed', defaults: 'unchanged' });
    expect(t.restores).toEqual([]);
  });

  it('OpenCode: troca o modelo da sessão pelo serviço, com o nível', async () => {
    const a = agent({ id: 'oc:1', provider: 'opencode', account: '.opencode', sessionId: 'ses_abcdef123', model: 'opencode/big-pickle' });
    const calls: unknown[] = [];
    const reg = new ControlRegistry({
      agent: (id) => (id === a.id ? a : undefined),
      send: () => ({ error: 'not-found' }),
      message: () => undefined,
      opencode: {
        available: () => true,
        selectModel: async (...args) => {
          calls.push(args);
          return { ok: true };
        },
        models: async () => [{ id: 'opencode/gpt-6.2-sol', name: 'GPT-6.2 Sol', provider: 'OpenCode', variants: ['low', 'high'] }],
      },
    });
    expect(await reg.create({ agentId: a.id, kind: 'model', value: 'opencode/gpt-6.2-sol', variant: 'high' })).toMatchObject({ control: { status: 'confirmed', value: 'opencode/gpt-6.2-sol', variant: 'high' } });
    a.modelChoice = { label: 'opencode/gpt-6.2-sol', at: 1 };
    expect(await reg.create({ agentId: a.id, kind: 'effort', value: 'low' })).toMatchObject({ control: { status: 'confirmed', variant: 'low' } });
    expect(calls).toEqual([
      ['ses_abcdef123', 'opencode/gpt-6.2-sol', 'high'],
      ['ses_abcdef123', 'opencode/gpt-6.2-sol', 'low'],
    ]);
    expect(await reg.models(a.id)).toEqual({ models: [{ id: 'opencode/gpt-6.2-sol', name: 'GPT-6.2 Sol', provider: 'OpenCode', variants: ['low', 'high'] }] });
    expect(await reg.create({ agentId: a.id, kind: 'model', value: 'sem-barra' })).toMatchObject({ status: 400 });
  });

  it('Claude Code: não manda /model com a conversa em cache (pararia na confirmação da tela)', async () => {
    const t = setup();
    t.a.replyAt = t.at() - 10 * 60_000;
    const r = await t.reg.create({ agentId: t.a.id, kind: 'model', value: 'sonnet' });
    expect(r).toMatchObject({ status: 409 });
    expect('error' in r && r.error).toContain('confirmação na tela da sessão');
    expect(t.sent).toEqual([]);
    expect(await t.reg.create({ agentId: t.a.id, kind: 'effort', value: 'high' })).toMatchObject({ control: { status: 'sending' } });
    t.a.replyAt = t.at() - 61 * 60_000;
    expect(await t.reg.create({ agentId: t.a.id, kind: 'model', value: 'sonnet' })).toMatchObject({ control: { status: 'sending' } });
  });

  it('Codex e subagentes não trocam por aqui', async () => {
    const t = setup({ agent: agent({ provider: 'codex' }) });
    expect(await t.reg.create({ agentId: t.a.id, kind: 'effort', value: 'low' })).toMatchObject({ status: 409 });
    const s = setup({ agent: agent({ kind: 'sub' }) });
    expect(await s.reg.create({ agentId: s.a.id, kind: 'effort', value: 'low' })).toMatchObject({ status: 409 });
    expect(await s.reg.create({ agentId: 'nada', kind: 'effort', value: 'low' })).toMatchObject({ status: 404 });
  });
});
