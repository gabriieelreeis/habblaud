import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '../../../shared/types';
import { budgetText, cardState, codexUsageNote, openCodeUsageNote, showsUsageAge, sourceLabel, usageMessage, usageSubtitle } from './usage';

const MIN = 60_000;
type Acc = Pick<AccountInfo, 'usage' | 'usageStatus' | 'provider' | 'email' | 'plan' | 'configDir'>;
const codex = (over: Partial<Acc> = {}): Acc => ({ provider: 'codex', usageStatus: 'ok', configDir: '~/.codex', plan: 'Team', ...over });
const win = { utilization: 42, resetsAt: 10 * 60 * MIN };

describe('sourceLabel', () => {
  it('diz quem gravou o uso ao vivo', () => {
    expect(sourceLabel({ source: 'statusline', via: 'mod', fetchedAt: 0 })).toBe('ao vivo (mod do Habblaud)');
    expect(sourceLabel({ source: 'statusline', via: 'tap', fetchedAt: 0 })).toBe('ao vivo (statusline do Claude Code)');
    expect(sourceLabel({ source: 'statusline', fetchedAt: 0 })).toBe('ao vivo (statusline do Claude Code)');
    expect(sourceLabel({ source: 'cache', fetchedAt: 0 })).toBe('cache do /usage do Claude Code');
    expect(sourceLabel({ source: 'codex', fetchedAt: 0 })).toBe('arquivos do Codex');
    expect(sourceLabel({ source: 'opencode', fetchedAt: 0 })).toBe('serviço local do OpenCode');
  });
});

describe('cartão de uso de uma conta do Codex', () => {
  it('"sem cota" é um estado próprio (nunca 0% nem "sem dados")', () => {
    const noQuota = codex({ usage: { source: 'codex', noQuota: true, fetchedAt: 0 } });
    expect(cardState(noQuota)).toBe('noquota');
    expect(usageMessage(noQuota)).toEqual(['sem cota', 'sem cota']);
    expect(codexUsageNote(noQuota, 3 * MIN)).toMatch(/^Na última leitura \(há 3 min\), a conta estava sem cota nem créditos .*Não é 0%/);
    expect(cardState(codex({ usage: { source: 'codex', fiveHour: win, fetchedAt: 0 } }))).toBe('ok');
    expect(cardState(codex({ usage: { source: 'codex', fiveHour: win, fetchedAt: 0 }, usageStatus: 'stale' }))).toBe('stale');
    expect(cardState(codex())).toBe('empty');
  });

  it('a idade fica sempre à mostra no Codex (só se renova com sessão rodando); no Claude Code, só quando é antiga', () => {
    const fresh = { source: 'codex' as const, fiveHour: win, fetchedAt: 0 };
    expect(showsUsageAge(codex({ usage: fresh }))).toBe(true);
    expect(showsUsageAge(codex({ usage: { source: 'codex', noQuota: true, fetchedAt: 0 } }))).toBe(true);
    expect(showsUsageAge(codex())).toBe(false);
    expect(showsUsageAge({ usage: { ...fresh, source: 'statusline' }, usageStatus: 'ok' })).toBe(false);
    expect(showsUsageAge({ usage: { ...fresh, source: 'cache' }, usageStatus: 'stale' })).toBe(true);
    expect(codexUsageNote(codex({ usage: fresh }), 12 * MIN)).toBe('O Codex só grava o uso enquanto alguma sessão roda: estes números são da última leitura (há 12 min).');
  });

  it('sem números: não há o que instalar; embaixo do nome, o plano (sem e-mail)', () => {
    expect(usageMessage(codex())).toEqual(['sem dados ainda', 'sem dados']);
    expect(codexUsageNote(codex(), 0)).toBe('Não precisa instalar nada: os números chegam com a próxima sessão do Codex.');
    expect(usageSubtitle(codex())).toBe('plano Team');
    expect(usageSubtitle(codex({ plan: undefined }))).toBe('Codex');
    // Claude Code: como antes.
    expect(usageMessage({ usageStatus: 'disabled' })).toEqual(['sem dados de uso', 'sem dados']);
    expect(usageSubtitle({ email: 'a@b.c', configDir: '~/.claude' })).toBe('a@b.c');
    expect(usageSubtitle({ configDir: '~/.claude' })).toBe('~/.claude');
    expect(codexUsageNote({ usageStatus: 'ok' }, 0)).toBe('');
  });
});

describe('cartão de uso da conta do OpenCode', () => {
  const oc = (over: Partial<Acc & { organization?: string }> = {}): Acc & { organization?: string } => ({ provider: 'opencode', usageStatus: 'ok', configDir: '~/.local/state/opencode/service.json', ...over });

  it('com o OpenCode Go: barras de 5h e semana como as outras contas; a idade só quando é antiga', () => {
    const go = oc({ plan: 'Go', usage: { source: 'opencode', fiveHour: win, sevenDay: win, monthly: win, fetchedAt: 0 } });
    expect(cardState(go)).toBe('ok');
    expect(showsUsageAge(go)).toBe(false);
    expect(usageSubtitle(go)).toBe('plano Go');
    expect(openCodeUsageNote(go, 0)).toMatch(/OpenCode Go/);
  });

  it('sem o Go: "sem limites informados" (nunca 0% nem "sem dados"); com orçamento, o orçamento', () => {
    const free = oc({ organization: 'Personal', usage: { source: 'opencode', noLimits: true, fetchedAt: 0 } });
    expect(cardState(free)).toBe('nolimits');
    expect(usageMessage(free)).toEqual(['sem limites informados', 'sem limites']);
    expect(usageSubtitle(free)).toBe('Personal');
    expect(openCodeUsageNote(free, 0)).toMatch(/não informou limites/);
    const budget = oc({ usage: { source: 'opencode', budget: { spent: 1.2, limit: 10 }, fetchedAt: 0 } });
    expect(cardState(budget)).toBe('nolimits');
    expect(budgetText({ spent: 1.2, limit: 10 })).toMatch(/de .*(12%)/);
    expect(usageMessage(budget)[0]).toMatch(/^orçamento: /);
    expect(usageSubtitle(oc())).toBe('OpenCode');
    expect(openCodeUsageNote({ usageStatus: 'ok' }, 0)).toBe('');
  });
});
