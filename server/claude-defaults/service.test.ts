import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { pickDefaults } from './defaults';
import { ClaudeDefaultsService, parseDefaults } from './service';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const flush = () => new Promise((ok) => setTimeout(ok, 0));

describe('ClaudeDefaultsService', () => {
  it('modo Node: lê direto e devolve o padrão no arquivo', async () => {
    const t = tempDir();
    cleanup = t.cleanup;
    writeFileSync(join(t.dir, 'settings.json'), JSON.stringify({ theme: 'dark', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } }));
    const svc = new ClaudeDefaultsService({ direct: true, accounts: () => [{ id: '.claude', configDir: t.dir, dir: t.dir }] });
    let changes = 0;
    svc.onChange(() => changes++);
    svc.refresh();
    expect(svc.defaultsOf('.claude')).toEqual({ modelEffort: { 'claude-opus-5-5': 'xhigh' } });
    expect(changes).toBe(1);
    const before = await svc.snapshot('.claude');
    writeFileSync(join(t.dir, 'settings.json'), JSON.stringify({ theme: 'dark', modelSettings: { 'claude-opus-5-5': { effortLevel: 'low' } } }));
    expect(await svc.restore('.claude', before as ReturnType<typeof pickDefaults>, 'effort', 'low')).toBe('restored');
    expect(JSON.parse(readFileSync(join(t.dir, 'settings.json'), 'utf8'))).toEqual({ theme: 'dark', modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } });
    expect(await svc.snapshot('.outra')).toEqual({ error: 'conta do Claude Code desconhecida' });
  });

  it('Docker: sem o auxiliar não dá para guardar o padrão', async () => {
    const svc = new ClaudeDefaultsService({ direct: false, accounts: () => [{ id: '.claude', configDir: 'C:/Users/x/.claude', dir: '/claude/.claude' }] });
    expect(await svc.snapshot('.claude')).toEqual({ error: 'o auxiliar do computador (npm run codex:bridge) não está rodando' });
  });

  it('Docker: o auxiliar lê e devolve o padrão pelas rodadas', async () => {
    const svc = new ClaudeDefaultsService({ direct: false, accounts: () => [{ id: '.claude', configDir: 'C:/Users/x/.claude', dir: '/claude/.claude' }] });
    svc.poll();
    svc.wantJobs('.claude', ['cbb319f7']);
    const read = svc.poll();
    expect(read).toEqual([{ id: expect.any(String), op: 'read', configDir: 'C:/Users/x/.claude', jobs: ['cbb319f7'] }]);
    svc.ack({ results: [{ id: read[0].id, ok: true, defaults: { modelEffort: { 'claude-opus-5-5': 'xhigh' } }, flags: { cbb319f7: { effort: 'xhigh' }, intruso: { effort: 'low' } } }] });
    await flush();
    expect(svc.defaultsOf('.claude')).toEqual({ modelEffort: { 'claude-opus-5-5': 'xhigh' } });
    expect(svc.flagsOf('.claude', 'cbb319f7')).toEqual({ effort: 'xhigh' });
    expect(svc.flagsOf('.claude', 'intruso')).toBeUndefined();

    const snap = svc.snapshot('.claude');
    const [req] = svc.poll();
    svc.ack({ results: [{ id: req.id, ok: true, defaults: { model: 'opus', modelEffort: {} } }] });
    expect(await snap).toEqual({ model: 'opus', modelEffort: {} });

    const restore = svc.restore('.claude', { model: 'opus', modelEffort: {} }, 'model', 'haiku');
    const [r] = svc.poll();
    expect(r).toMatchObject({ op: 'restore', kind: 'model', sent: 'haiku', before: { model: 'opus', modelEffort: {} } });
    svc.ack({ results: [{ id: r.id, ok: true, result: 'restored' }] });
    expect(await restore).toBe('restored');

    const failing = svc.restore('.claude', { modelEffort: {} }, 'effort', 'low');
    const [f] = svc.poll().filter((x) => x.op === 'restore');
    svc.ack({ results: [{ id: f.id, ok: false, error: 'settings.json ilegível' }] });
    expect(await failing).toEqual({ error: 'settings.json ilegível' });
  });

  it('confere o que o auxiliar devolve', () => {
    expect(parseDefaults({ model: 'opus', effortLevel: 'high', modelEffort: { 'claude-opus-5-5': 'xhigh', ruim: 42 } })).toEqual({ model: 'opus', effortLevel: 'high', modelEffort: { 'claude-opus-5-5': 'xhigh' } });
    expect(parseDefaults('x')).toBeUndefined();
  });
});
