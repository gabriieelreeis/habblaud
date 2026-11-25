import { describe, expect, it } from 'vitest';
import { effortAvailable, effortCommand, EFFORT_LEVELS, isEffortLevel } from './effort';

describe('controle de esforço (peças puras)', () => {
  it('oferece os cinco níveis do Claude Code', () => {
    expect(EFFORT_LEVELS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    for (const level of EFFORT_LEVELS) expect(isEffortLevel(level)).toBe(true);
  });

  it('só aceita níveis conhecidos', () => {
    expect(isEffortLevel('')).toBe(false);
    expect(isEffortLevel('LOW')).toBe(false);
    expect(isEffortLevel('nivel')).toBe(false);
  });

  it('manda o comando de barra com o nível escolhido', () => {
    expect(effortCommand('high')).toBe('/effort high');
    expect(effortCommand('xhigh')).toBe('/effort xhigh');
  });

  it('só muda o esforço no Claude Code', () => {
    expect(effortAvailable('claude')).toBe(true);
    expect(effortAvailable(undefined)).toBe(true);
    expect(effortAvailable('codex')).toBe(false);
    expect(effortAvailable('opencode')).toBe(false);
  });
});
