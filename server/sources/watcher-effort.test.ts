// Integração: esforço e modelo de cada sessão (opções de abertura, /effort na conversa e o padrão do settings.json).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../accounts/service';
import { ClaudeDefaultsService } from '../claude-defaults/service';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { L, tempDir, writeLines } from '../test/fixtures';
import { ClaudeWatcher, encodeCwd } from './watcher';

setQuiet(true);

const CWD = '/projetos/loja';
let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

function setup() {
  const tmp = tempDir();
  cleanup = tmp.cleanup;
  const dir = join(tmp.dir, '.claude');
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  mkdirSync(join(dir, 'projects', encodeCwd(CWD)), { recursive: true });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ modelSettings: { 'claude-opus-5-5': { effortLevel: 'xhigh' } } }));
  const clock = Date.now();
  const accounts = new AccountsService({ dirs: [dir], home: tmp.dir, env: {}, now: () => clock, onChange: () => {} });
  const office = new Office({ names: new NameStore(null), version: 'teste', startedAt: clock, accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined, now: () => clock });
  const defaults = new ClaudeDefaultsService({ direct: true, accounts: () => [{ id: '.claude', configDir: dir, dir }] });
  const watcher = new ClaudeWatcher({ accounts, office, inDocker: false, now: () => clock, isAlive: () => true, watch: false, defaults });
  defaults.refresh();
  const open = (pid: number, sessionId: string, extra: Record<string, unknown> = {}) =>
    writeFileSync(join(dir, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: CWD, startedAt: clock - 60_000, kind: 'bg', status: 'idle', ...extra }));
  const poll = () => {
    watcher.poll();
    office.tick();
  };
  const agent = (pid: number) => office.commit().snapshot.agents.find((a) => a.id === `.claude:${pid}`);
  return { dir, clock, open, poll, agent, watcher, transcript: (sid: string) => join(dir, 'projects', encodeCwd(CWD), `${sid}.jsonl`) };
}

describe('esforço e modelo de cada sessão do Claude Code', () => {
  it('sessão em segundo plano ainda sem conversa: o --effort e o --model da abertura', () => {
    const c = setup();
    mkdirSync(join(c.dir, 'jobs', 'ab12cd34'), { recursive: true });
    writeFileSync(join(c.dir, 'jobs', 'ab12cd34', 'state.json'), JSON.stringify({ respawnFlags: ['--model', 'haiku', '--effort', 'low'] }));
    c.open(100, 'sess-a', { jobId: 'ab12cd34' });
    c.poll();
    expect(c.agent(100)).toMatchObject({ effort: { level: 'low', source: 'flag' }, modelChoice: { label: 'haiku' } });
    c.watcher.stop();
  });

  it('o /effort desta abertura vence; a resposta trava a troca de modelo por um tempo', () => {
    const c = setup();
    writeLines(c.transcript('sess-b'), [
      L.prompt('<local-command-stdout>Set effort level to max (this session only): x</local-command-stdout>', { at: c.clock - 120_000 }),
      L.assistant([L.text('oi')], { at: c.clock - 50_000, msgId: 'm1', model: 'claude-opus-5-5' }),
      L.prompt('<local-command-stdout>Set effort level to medium (saved as your default for new sessions): x</local-command-stdout>', { at: c.clock - 30_000 }),
    ]);
    c.open(101, 'sess-b');
    c.poll();
    const a = c.agent(101)!;
    expect(a.effort).toEqual({ level: 'medium', source: 'command', at: c.clock - 30_000 });
    expect(a.replyAt).toBe(c.clock - 50_000);
    c.watcher.stop();
  });

  it('sem /effort nem --effort: o padrão do modelo no settings.json (provável)', () => {
    const c = setup();
    writeLines(c.transcript('sess-c'), [
      L.prompt('<local-command-stdout>Set effort level to max (this session only): x</local-command-stdout>', { at: c.clock - 120_000 }),
      L.assistant([L.text('oi')], { at: c.clock - 50_000, msgId: 'm1', model: 'claude-opus-5-5' }),
    ]);
    c.open(102, 'sess-c');
    c.poll();
    expect(c.agent(102)?.effort).toEqual({ level: 'xhigh', source: 'settings' });
    c.watcher.stop();
  });
});
