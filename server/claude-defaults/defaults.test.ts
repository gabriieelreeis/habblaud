import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { defaultEffort, flagsOf, pickDefaults, readDefaultsFile, readJobFlags, restoreDefaultsFile, restoreText, sessionEffort } from './defaults';

const SETTINGS = {
  env: { HABBLAUD_PERMISSION_TIMEOUT: '86400' },
  enabledPlugins: { 'habblaud@habblaud': true },
  modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } },
  theme: 'dark',
};

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('padrões do settings.json', () => {
  it('pega só o modelo e o esforço', () => {
    expect(pickDefaults(SETTINGS)).toEqual({ modelEffort: { 'claude-opus-5-5': 'xhigh' } });
    expect(pickDefaults({ model: 'sonnet', effortLevel: 'high', modelSettings: { x: {}, y: { effortLevel: 'low' } } })).toEqual({ model: 'sonnet', effortLevel: 'high', modelEffort: { y: 'low' } });
    expect(pickDefaults(null)).toEqual({ modelEffort: {} });
  });

  it('o esforço padrão é o do modelo, depois o geral', () => {
    const d = pickDefaults({ effortLevel: 'medium', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } });
    expect(defaultEffort(d, 'claude-opus-5-5')).toBe('xhigh');
    expect(defaultEffort(d, 'claude-opus-5-5[1m]')).toBe('xhigh');
    expect(defaultEffort(d, 'claude-haiku-5-5')).toBe('medium');
    expect(defaultEffort(undefined, 'claude-opus-5-5')).toBeUndefined();
  });

  it('lê o --effort e o --model da abertura (respawnFlags)', () => {
    expect(flagsOf({ respawnFlags: ['--agent', 'ceo', '-n', 'Cabeça (CEO)', '--permission-mode', 'auto', '--effort', 'xhigh'] })).toEqual({ effort: 'xhigh' });
    expect(flagsOf({ respawnFlags: ['--model=haiku', '--effort=low'] })).toEqual({ model: 'haiku', effort: 'low' });
    expect(flagsOf({ respawnFlags: ['--effort', 'NÃO VALE'] })).toEqual({});
    expect(flagsOf({})).toEqual({});
  });

  it('o esforço da sessão: /effort desta abertura, senão --effort, senão o padrão', () => {
    const d = pickDefaults(SETTINGS);
    expect(sessionEffort({ level: 'low', at: 5_000 }, 4_000, { effort: 'high' }, d, 'claude-opus-5-5')).toEqual({ level: 'low', source: 'command', at: 5_000 });
    expect(sessionEffort({ level: 'low', at: 1_000 }, 10_000, { effort: 'high' }, d, 'claude-opus-5-5')).toEqual({ level: 'high', source: 'flag' });
    expect(sessionEffort(undefined, 10_000, undefined, d, 'claude-opus-5-5')).toEqual({ level: 'xhigh', source: 'settings' });
    expect(sessionEffort(undefined, 10_000, undefined, d, 'claude-haiku-5-5')).toBeUndefined();
  });
});

describe('devolver o padrão depois da troca', () => {
  const before = pickDefaults(SETTINGS);
  const text = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

  it('volta o esforço que o /effort gravou e não mexe em mais nada', () => {
    const after = { ...SETTINGS, modelSettings: { 'claude-opus-5-5': { effortLevel: 'low' } } };
    const out = restoreText(text(after), before, 'effort', 'low');
    expect(out).toBe(text(SETTINGS));
  });

  it('apaga o que o /effort criou num modelo que não tinha padrão', () => {
    const after = { ...SETTINGS, modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' }, 'claude-haiku-5-5': { effortLevel: 'low' } } };
    expect(JSON.parse(restoreText(text(after), before, 'effort', 'low')!)).toEqual(SETTINGS);
    const bare = { theme: 'dark', modelSettings: { 'claude-haiku-5-5': { effortLevel: 'low' } } };
    expect(JSON.parse(restoreText(text(bare), pickDefaults({ theme: 'dark' }), 'effort', 'low')!)).toEqual({ theme: 'dark' });
  });

  it('não desfaz um padrão que outra pessoa mudou para outro nível', () => {
    const after = { ...SETTINGS, modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } };
    expect(restoreText(text(after), before, 'effort', 'low')).toBeUndefined();
    expect(restoreText(text(SETTINGS), before, 'effort', 'xhigh')).toBeUndefined();
  });

  it('o auto que apagou o padrão volta o de antes', () => {
    const after = { ...SETTINGS, modelSettings: {} };
    expect(JSON.parse(restoreText(text(after), before, 'effort', 'auto')!)).toEqual(SETTINGS);
  });

  it('volta o modelo padrão (ou o apaga, se não havia)', () => {
    expect(JSON.parse(restoreText(text({ ...SETTINGS, model: 'haiku' }), before, 'model', 'haiku')!)).toEqual(SETTINGS);
    const withModel = pickDefaults({ ...SETTINGS, model: 'opus' });
    expect(JSON.parse(restoreText(text({ ...SETTINGS, model: 'haiku' }), withModel, 'model', 'haiku')!)).toEqual({ ...SETTINGS, model: 'opus' });
    expect(restoreText(text(SETTINGS), before, 'model', 'haiku')).toBeUndefined();
  });

  it('mantém o fim de linha do arquivo', () => {
    const crlf = text({ ...SETTINGS, model: 'haiku' }).replace(/\n/g, '\r\n');
    const out = restoreText(crlf, before, 'model', 'haiku')!;
    expect(out).toBe(text(SETTINGS).replace(/\n/g, '\r\n'));
  });

  it('grava no arquivo e lê os padrões e as flags do job', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const file = join(t.dir, 'settings.json');
    writeFileSync(file, text({ ...SETTINGS, model: 'haiku', modelSettings: { 'claude-opus-5-5': { effortLevel: 'low' } } }));
    expect(readDefaultsFile(t.dir)).toEqual({ model: 'haiku', modelEffort: { 'claude-opus-5-5': 'low' } });
    expect(restoreDefaultsFile(t.dir, before, 'effort', 'low')).toBe('restored');
    expect(restoreDefaultsFile(t.dir, before, 'model', 'haiku')).toBe('restored');
    expect(readFileSync(file, 'utf8')).toBe(text(SETTINGS));
    expect(restoreDefaultsFile(t.dir, before, 'model', 'haiku')).toBe('unchanged');
    mkdirSync(join(t.dir, 'jobs', 'abcd1234'), { recursive: true });
    writeFileSync(join(t.dir, 'jobs', 'abcd1234', 'state.json'), JSON.stringify({ respawnFlags: ['--effort', 'low'] }));
    expect(readJobFlags(t.dir, 'abcd1234')).toEqual({ effort: 'low' });
    expect(readJobFlags(t.dir, '../x')).toBeUndefined();
  });

  it('sem settings.json não há padrão nem o que devolver', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    expect(readDefaultsFile(t.dir)).toEqual({ modelEffort: {} });
    expect(restoreDefaultsFile(t.dir, before, 'effort', 'low')).toBe('unchanged');
    writeFileSync(join(t.dir, 'settings.json'), '{ quebrado');
    expect(readDefaultsFile(t.dir)).toEqual({ error: 'settings.json não é um JSON válido' });
    expect(restoreDefaultsFile(t.dir, before, 'effort', 'low')).toEqual({ error: 'settings.json não é um JSON válido' });
  });
});
