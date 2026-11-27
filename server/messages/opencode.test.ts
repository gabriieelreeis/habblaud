// Mensagens ao OpenCode pelo escritório: o registro com o entregador do OpenCode (o serviço local dele) — canMessage só
// com o serviço ao alcance, uma mensagem por vez por agente, prazos e a separação da caixa de entrada do plugin do
// Claude Code. Relógio injetado; entregador falso (nunca o OpenCode de verdade).
import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../shared/types';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import type { CodexQueueResult } from './codex';
import { ERR_GONE, ERR_OPENCODE_SLOW, ERR_OPENCODE_UNAVAILABLE, MessageRegistry, QUEUED_TIMEOUT_MS, type SendResult } from './registry';

setQuiet(true);

const SID = 'ses_e0a5341ccffeEAxdLIyDwu9huf';
const SID2 = 'ses_e0a538743ffe1ReskKlfABsPZC';
const MAIN = `.opencode:${SID}`;
const OTHER = `.opencode:${SID2}`;
const CLAUDE = 'acc:1';

function setup() {
  let now = 1_000_000;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const calls: Array<{ sid: string; text: string }> = [];
  const done: Array<(r: CodexQueueResult) => void> = [];
  const service = { up: true };
  let registry: MessageRegistry | undefined;
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: 0,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    messages: () => registry?.reachable() ?? new Set(),
    now: clock.now,
  });
  office.addMain({ id: MAIN, provider: 'opencode', account: '.opencode', sessionId: SID, cwd: '/p/loja', role: 'Agente principal', startedAt: 0, status: 'idle' });
  office.addMain({ id: OTHER, provider: 'opencode', account: '.opencode', sessionId: SID2, cwd: '/p/api', role: 'Agente principal', startedAt: 0, status: 'idle' });
  office.addMain({ id: CLAUDE, account: 'acc', sessionId: SID, cwd: '/p/loja', role: 'Agente principal', startedAt: 0, status: 'idle' });
  registry = new MessageRegistry({
    office,
    opencode: {
      send: (sid, text) => new Promise((ok) => (calls.push({ sid, text }), done.push(ok))),
      available: () => service.up,
    },
    now: clock.now,
  });
  const finish = async (i: number, r: CodexQueueResult) => {
    done[i](r);
    await new Promise((ok) => setTimeout(ok, 0));
  };
  return { office, registry, clock, calls, finish, service };
}

const snapAgent = (office: Office, id: string): AgentInfo | undefined => office.commit().snapshot.agents.find((a) => a.id === id);

function sent(r: SendResult): string {
  if (!('message' in r)) throw new Error(`recusada: ${JSON.stringify(r)}`);
  return r.message.id;
}

describe('MessageRegistry: OpenCode pelo serviço local', () => {
  it('canMessage com o serviço ao alcance; entrega na sessão; atividade no feed; a caixa do plugin não serve', async () => {
    const { office, registry, calls, finish } = setup();
    expect(snapAgent(office, MAIN)!.canMessage).toBe(true);
    // O do Claude Code (mesmo id de sessão, por acaso) segue dependendo do plugin.
    expect(snapAgent(office, CLAUDE)!.canMessage).toBeUndefined();
    const id = sent(registry.send({ agentId: MAIN, text: 'roda os testes' }));
    expect(registry.get(id)!.status).toBe('sent');
    expect(calls).toEqual([{ sid: SID, text: 'roda os testes' }]);
    await finish(0, { ok: true });
    expect(registry.get(id)!.status).toBe('delivered');
    expect(snapAgent(office, MAIN)!.recent.some((a) => a.text === 'Mensagem pelo Habblaud')).toBe(true);
    expect(registry.inbox({ session: SID, account: '.opencode' })).toEqual([]);
  });

  it('sendNow não se aplica ao OpenCode: a flag não aparece na mensagem nem na caixa do plugin', () => {
    const { registry } = setup();
    const id = sent(registry.send({ agentId: MAIN, text: 'oi', sendNow: true }));
    expect(registry.get(id)!.sendNow).toBeUndefined();
    expect(registry.inbox({ session: SID, account: '.opencode' })).toEqual([]);
  });

  it('serviço fora do alcance: não recebe (com o motivo)', () => {
    const { office, registry, service } = setup();
    service.up = false;
    expect(snapAgent(office, MAIN)!.canMessage).toBeUndefined();
    expect(registry.send({ agentId: MAIN, text: 'oi' })).toEqual({ error: 'unavailable', reason: ERR_OPENCODE_UNAVAILABLE });
  });

  it('uma por vez por agente, na ordem; recusa vira failed; fila parada falha no prazo; agente que sai falha', async () => {
    const { office, registry, calls, finish, clock } = setup();
    const a1 = sent(registry.send({ agentId: MAIN, text: 'um' }));
    const a2 = sent(registry.send({ agentId: MAIN, text: 'dois' }));
    sent(registry.send({ agentId: OTHER, text: 'outro' }));
    expect(calls.map((c) => c.text)).toEqual(['um', 'outro']);
    expect(registry.get(a2)!.status).toBe('queued');
    await finish(0, { ok: true });
    expect(registry.get(a1)!.status).toBe('delivered');
    expect(calls.map((c) => c.text)).toEqual(['um', 'outro', 'dois']);
    await finish(2, { ok: false, error: 'a sessão do OpenCode está ocupada' });
    expect(registry.get(a2)).toMatchObject({ status: 'failed', error: 'a sessão do OpenCode está ocupada' });
    const b2 = sent(registry.send({ agentId: OTHER, text: 'atrás' }));
    clock.advance(QUEUED_TIMEOUT_MS);
    registry.tick();
    expect(registry.get(b2)).toMatchObject({ status: 'failed', error: ERR_OPENCODE_SLOW });
    const c = sent(registry.send({ agentId: MAIN, text: 'tchau' }));
    office.setStatus(MAIN, 'offline');
    registry.tick();
    expect(registry.get(c)).toMatchObject({ status: 'failed', error: ERR_GONE });
  });
});
