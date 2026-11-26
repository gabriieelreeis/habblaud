import { describe, expect, it } from 'vitest';
import type { ControlState, ModelOption } from '../../../shared/types';
import { claudeAlias, controlsAvailable, controlStatusText, EFFORT_LEVELS, effortCommand, effortOrigin, groupModels, isEffortLevel, modelCommand, modelLockedUntil, modelSummary, openCodeRequest } from './effort';

const state = (patch: Partial<ControlState>): ControlState => ({ id: 'c1', agentId: 'a', kind: 'effort', value: 'high', status: 'sending', createdAt: 1, updatedAt: 1, ...patch });

describe('modelo e esforço (peças puras)', () => {
  it('oferece os níveis do Claude Code e só aceita os conhecidos', () => {
    expect(EFFORT_LEVELS).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'auto']);
    for (const level of EFFORT_LEVELS) expect(isEffortLevel(level)).toBe(true);
    expect(isEffortLevel('')).toBe(false);
    expect(isEffortLevel('LOW')).toBe(false);
  });

  it('monta os comandos de barra', () => {
    expect(effortCommand('xhigh')).toBe('/effort xhigh');
    expect(modelCommand('sonnet')).toBe('/model sonnet');
  });

  it('só troca no Claude Code e no OpenCode', () => {
    expect(controlsAvailable('claude')).toBe(true);
    expect(controlsAvailable(undefined)).toBe(true);
    expect(controlsAvailable('opencode')).toBe(true);
    expect(controlsAvailable('codex')).toBe(false);
  });

  it('acha o apelido do modelo do Claude Code', () => {
    expect(claudeAlias('claude-opus-5-5')).toBe('opus');
    expect(claudeAlias('claude-sonnet-5-5[1m]')).toBe('sonnet');
    expect(claudeAlias('claude-haiku-5-5')).toBe('haiku');
    expect(claudeAlias('gpt-6')).toBeUndefined();
    expect(claudeAlias(undefined)).toBeUndefined();
  });

  it('diz de onde veio o esforço', () => {
    expect(effortOrigin({ level: 'high', source: 'flag' }, 'claude')).toBe('aberta com --effort high');
    expect(effortOrigin({ level: 'high', source: 'settings' }, 'claude')).toContain('provável');
    expect(effortOrigin({ level: 'high', source: 'command', at: Date.UTC(2026, 10, 26, 13, 5) }, 'claude')).toMatch(/^confirmado pelo \/effort às /);
    expect(effortOrigin(undefined, 'opencode')).toBe('padrão do modelo no OpenCode');
  });

  it('mostra o modelo da última resposta e o escolhido para as próximas', () => {
    expect(modelSummary({ model: 'claude-opus-5-5', provider: 'claude' })).toBe('última resposta: Opus 5.5');
    expect(modelSummary({ model: 'claude-opus-5-5', provider: 'claude', modelChoice: { label: 'Sonnet 5.5', at: 2 } })).toBe('última resposta: Opus 5.5 · próximas: Sonnet 5.5');
    expect(modelSummary({ model: 'opencode/big-pickle', provider: 'opencode', modelChoice: { label: 'opencode/big-pickle', at: 2 } })).toBe('última resposta: opencode/big-pickle');
    expect(modelSummary({ provider: 'claude' })).toBe('ainda sem resposta nesta sessão');
  });

  it('acompanha a troca até a confirmação e o padrão das sessões novas', () => {
    expect(controlStatusText(state({}), 'claude').text).toBe('Enviando /effort high…');
    expect(controlStatusText(state({ status: 'waiting' }), 'claude').text).toContain('/effort high entregue');
    expect(controlStatusText(state({ status: 'confirmed', defaults: 'restored' }), 'claude')).toEqual({ text: 'Confirmado: esforço high. O padrão das sessões novas continua o de antes.', tone: 'ok' });
    expect(controlStatusText(state({ status: 'confirmed', defaults: 'saved' }), 'claude').text).toContain('Também ficou como padrão');
    expect(controlStatusText(state({ status: 'confirmed', defaults: 'restore-failed', error: 'sem acesso' }), 'claude')).toEqual({ text: 'Confirmado: esforço high. sem acesso', tone: 'error' });
    expect(controlStatusText(state({ status: 'failed', error: 'a sessão saiu' }), 'claude')).toEqual({ text: 'Não deu: a sessão saiu', tone: 'error' });
    expect(controlStatusText(state({ kind: 'model', value: 'opencode/gpt-6.2-sol', variant: 'high', status: 'confirmed' }), 'opencode').text).toBe('Confirmado: opencode/gpt-6.2-sol · high nas próximas respostas.');
  });

  it('trava a troca de modelo do Claude Code por 1 h depois da última resposta', () => {
    const now = 10 * 3_600_000;
    expect(modelLockedUntil({ provider: 'claude', replyAt: now - 600_000 }, now)).toBe(now - 600_000 + 3_600_000);
    expect(modelLockedUntil({ provider: 'claude', replyAt: now - 3_600_001 }, now)).toBeUndefined();
    expect(modelLockedUntil({ provider: 'claude' }, now)).toBeUndefined();
    expect(modelLockedUntil({ provider: 'opencode', replyAt: now }, now)).toBeUndefined();
  });

  it('agrupa os modelos do OpenCode por provedor e monta o pedido', () => {
    const models: ModelOption[] = [
      { id: 'opencode/big-pickle', name: 'Big Pickle', provider: 'OpenCode', variants: [] },
      { id: 'opencode/gpt-6.2-sol', name: 'GPT-6.2 Sol', provider: 'OpenCode', variants: ['low', 'high'] },
      { id: 'openrouter/x/y', name: 'Y', provider: 'OpenRouter', variants: ['high'] },
    ];
    expect([...groupModels(models).keys()]).toEqual(['OpenCode', 'OpenRouter']);
    expect(openCodeRequest('model', 'opencode/gpt-6.2-sol', { model: 'openrouter/x/y', variant: 'high' }, models)).toEqual({ kind: 'model', value: 'opencode/gpt-6.2-sol', variant: 'high' });
    expect(openCodeRequest('model', 'opencode/big-pickle', { model: 'opencode/gpt-6.2-sol', variant: 'high' }, models)).toEqual({ kind: 'model', value: 'opencode/big-pickle' });
    expect(openCodeRequest('effort', 'low', { model: 'opencode/gpt-6.2-sol' }, models)).toEqual({ kind: 'effort', value: 'low' });
    expect(openCodeRequest('effort', '', { model: 'opencode/gpt-6.2-sol', variant: 'low' }, models)).toEqual({ kind: 'model', value: 'opencode/gpt-6.2-sol' });
    expect(openCodeRequest('effort', 'low', {}, models)).toBeUndefined();
  });
});
