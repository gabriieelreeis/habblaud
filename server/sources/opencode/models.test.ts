import { describe, expect, it } from 'vitest';
import { parseSession, readMessages } from './parse';
import { modelOptionOf, sessionChoice } from './source';

const names = new Map([['opencode', 'Personal / OpenCode']]);

describe('modelos do OpenCode na gaveta', () => {
  it('leva só id, nome, provedor e níveis (nada de cabeçalhos ou configuração)', () => {
    const raw = {
      id: 'gpt-6.2-sol',
      providerID: 'opencode',
      type: 'chat',
      name: 'GPT-6.2 Sol',
      headers: { 'x-opencode-org-id': 'org_secreto' },
      settings: { baseURL: 'https://exemplo' },
      variants: [{ id: 'low', settings: { reasoningEffort: 'low' } }, { id: 'high' }],
      status: 'active',
      enabled: true,
    };
    expect(modelOptionOf(raw, names)).toEqual({ id: 'opencode/gpt-6.2-sol', name: 'GPT-6.2 Sol', provider: 'Personal / OpenCode', variants: ['low', 'high'] });
    expect(JSON.stringify(modelOptionOf(raw, names))).not.toContain('org_secreto');
    expect(modelOptionOf({ id: 'big-pickle', providerID: 'opencode', name: 'Big Pickle', variants: [] }, names)).toMatchObject({ variants: [] });
    expect(modelOptionOf({ id: 'x', providerID: 'openrouter', name: 'X' }, names)).toMatchObject({ id: 'openrouter/x', provider: 'openrouter' });
    expect(modelOptionOf({ id: 'img', providerID: 'opencode', type: 'image' }, names)).toBeUndefined();
    expect(modelOptionOf({ id: 'off', providerID: 'opencode', enabled: false }, names)).toBeUndefined();
    expect(modelOptionOf({ id: 'old', providerID: 'opencode', status: 'deprecated' }, names)).toBeUndefined();
  });

  it('o modelo e o nível escolhidos na sessão', () => {
    const s = parseSession({ id: 'ses_abcdef123', time: { created: 1, updated: 50 }, model: { id: 'gpt-6.2-sol', providerID: 'opencode', variant: 'high' } })!;
    expect(s.model).toBe('opencode/gpt-6.2-sol');
    expect(s.variant).toBe('high');
    const reading = readMessages(
      [
        { id: 'msg_1', type: 'model-switched', time: { created: 100 }, model: { id: 'gpt-6.2-sol', providerID: 'opencode', variant: 'low' } },
        { id: 'msg_0', type: 'assistant', time: { created: 10 }, model: { id: 'big-pickle', providerID: 'opencode' }, content: [] },
      ],
      'oc:1',
    );
    expect(reading.choice).toEqual({ model: 'opencode/gpt-6.2-sol', variant: 'low', at: 100 });
    expect(reading.model).toBe('opencode/big-pickle');
    expect(sessionChoice(s, reading.choice)).toEqual({ model: 'opencode/gpt-6.2-sol', variant: 'low', at: 100 });
    expect(sessionChoice({ ...s, updatedAt: 200 }, reading.choice)).toEqual({ model: 'opencode/gpt-6.2-sol', variant: 'high', at: 200 });
    expect(sessionChoice({ ...s, model: undefined, variant: undefined }, undefined)).toBeUndefined();
  });
});
