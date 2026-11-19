// Integração da fonte do OpenCode: um serviço do OpenCode de mentira (fetch falso), o AccountsService e o Office.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '../../../shared/types';
import { AccountsService } from '../../accounts/service';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import type { FetchLike } from './service';
import { OpenCodeSource, PRESENCE_MS } from './source';

setQuiet(true);

const MAIN = 'ses_main0000000000000000001';
const OLD = 'ses_old00000000000000000002';
const CHILD = 'ses_child000000000000000003';
const DIR = 'C:\\Users\\dev\\projeto';

interface FakeService {
  sessions: Record<string, unknown>[];
  active: Record<string, { type: 'running' }>;
  messages: Record<string, unknown[]>;
  permissions: Record<string, unknown[]>;
  limits: unknown;
  down: boolean;
  posts: Array<{ url: string; body: unknown; auth?: string }>;
  calls: string[];
}

let stops: Array<() => void> = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
  vi.useRealTimers();
});

function session(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    projectID: 'p',
    agent: 'build',
    model: { id: 'mimo-v2.6-flash-free', providerID: 'opencode' },
    cost: 0,
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 900, write: 0 } },
    time: { created: 1_000, updated: Date.now() - 60_000 },
    title: 'Ler o arquivo',
    location: { directory: DIR },
    ...over,
  };
}

function setup(state: Partial<FakeService> = {}) {
  const svc: FakeService = {
    sessions: [],
    active: {},
    messages: {},
    permissions: {},
    limits: { data: { workspace: { id: 'org', name: 'Personal', usageURL: 'u' }, budgets: [] } },
    down: false,
    posts: [],
    calls: [],
    ...state,
  };
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const fetchFn: FetchLike = async (url, init) => {
    if (svc.down) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    const u = new URL(url);
    const path = u.pathname;
    svc.calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (init?.method === 'POST') {
      svc.posts.push({ url, body: JSON.parse(init.body ?? 'null'), auth: init.headers?.authorization });
      return json({ data: {} });
    }
    if (path === '/api/session') return json({ data: svc.sessions, cursor: {} });
    if (path === '/api/session/active') return json({ data: svc.active });
    if (path === '/api/experimental/usage/limits') return json(svc.limits);
    let m = /^\/api\/session\/(ses_\w+)\/message$/.exec(path);
    if (m) return json({ data: [...(svc.messages[m[1]] ?? [])].reverse() });
    m = /^\/api\/session\/(ses_\w+)\/permission$/.exec(path);
    if (m) return json({ data: svc.permissions[m[1]] ?? [] });
    m = /^\/api\/session\/(ses_\w+)\/form$/.exec(path);
    if (m) return json({ data: [] });
    m = /^\/api\/session\/(ses_\w+)$/.exec(path);
    if (m) {
      const s = svc.sessions.find((x) => x.id === m![1]);
      return s ? json({ data: s }) : { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const late: { office?: Office } = {};
  const accounts = new AccountsService({ dirs: [], home: '/nada', env: {}, onChange: () => late.office?.markDirty() });
  const office = new Office({
    names: new NameStore(null),
    version: 'teste',
    startedAt: Date.now(),
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: (id) => accounts.find(id)?.detected.name,
  });
  late.office = office;
  const source = new OpenCodeSource({
    accounts,
    office,
    env: { HABBLAUD_OPENCODE_URL: 'http://opencode.test', HABBLAUD_OPENCODE_PASSWORD: 'segredo' },
    home: '/nada',
    fetch: fetchFn,
    stream: false,
    timers: false,
  });
  stops.push(() => source.stop());
  const agents = (): AgentInfo[] => office.commit().snapshot.agents;
  return {
    svc,
    accounts,
    office,
    source,
    agents,
    agent: (sid: string) => agents().find((a) => a.id === `.opencode:${sid}`),
  };
}

describe('fonte do OpenCode: presença e o que o agente faz', () => {
  it('sessão recente entra (sala do projeto, título, modelo, tokens, atividades); antiga e arquivada não', async () => {
    const t = setup({
      sessions: [
        session(MAIN),
        session(OLD, { time: { created: 1, updated: Date.now() - PRESENCE_MS - 60_000 } }),
        session('ses_arch0000000000000000004', { time: { created: 1, updated: Date.now(), archived: Date.now() } }),
      ],
      messages: {
        [MAIN]: [
          { id: 'msg_1', type: 'user', text: 'leia a.txt', time: { created: 2_000 } },
          { id: 'msg_2', type: 'assistant', model: { id: 'mimo', providerID: 'opencode' }, time: { created: 3_000 }, content: [{ type: 'tool', id: 'call_1', name: 'read', state: { status: 'completed', input: { path: 'a.txt' } }, time: { created: 3_100 } }] },
          { id: 'msg_3', type: 'idle', outcome: 'succeeded', time: { created: 4_000 } },
        ],
      },
    });
    await t.source.start();
    const all = t.agents();
    expect(all.map((a) => a.id)).toEqual([`.opencode:${MAIN}`]);
    const a = t.agent(MAIN)!;
    expect(a).toMatchObject({ provider: 'opencode', account: '.opencode', kind: 'main', status: 'idle', roomId: DIR, title: 'Ler o arquivo', model: 'opencode/mimo' });
    expect(a.stats).toMatchObject({ tokensIn: 1000, tokensOut: 10, toolCalls: 1 });
    expect(a.recent.map((r) => r.text)).toEqual(['Recebeu “leia a.txt”', 'Lendo a.txt', 'Concluiu em 2s']);
    expect(t.source.sources()).toEqual([{ label: '.opencode', provider: 'opencode', path: 'http://opencode.test', sessions: 1, ok: true }]);
    // A conta do OpenCode está nas contas do snapshot.
    expect(t.office.commit().snapshot.accounts.map((x) => [x.id, x.provider, x.short, x.name])).toEqual([['.opencode', 'opencode', 'O', 'OpenCode']]);
  });

  it('rodando = trabalhando; os eventos mudam o status na hora (fim da execução, permissão)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } } });
    await t.source.start();
    expect(t.agent(MAIN)?.status).toBe('working');

    t.source.handleEvent({ type: 'permission.asked', data: { id: 'per_1', sessionID: MAIN, action: 'bash' } });
    expect(t.agent(MAIN)).toMatchObject({ status: 'waiting', waitingFor: 'aprovar uma permissão' });
    t.source.handleEvent({ type: 'permission.replied', data: { sessionID: MAIN, requestID: 'per_1' } });
    expect(t.agent(MAIN)?.status).toBe('working');

    // A sessão terminou: a mensagem nova é relida (depois da espera que junta a rajada de eventos).
    t.svc.active = {};
    t.svc.messages[MAIN] = [{ id: 'msg_9', type: 'idle', outcome: 'succeeded', time: { created: Date.now() } }];
    t.source.handleEvent({ type: 'session.execution.succeeded', data: { sessionID: MAIN } });
    expect(t.agent(MAIN)?.status).toBe('idle');
    await vi.advanceTimersByTimeAsync(400);
    expect(t.agent(MAIN)?.recent.some((r) => r.kind === 'done')).toBe(true);
  });

  it('um pedido de permissão pendente (evento perdido) aparece na releitura geral', async () => {
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } }, permissions: { [MAIN]: [{ id: 'per_1', sessionID: MAIN, action: 'bash', resources: [] }] } });
    await t.source.start();
    expect(t.agent(MAIN)?.status).toBe('waiting');
  });

  it('sessão filha rodando entra como subagente do pai e entrega ao terminar', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup({
      sessions: [session(MAIN), session(CHILD, { parentID: MAIN, agent: 'explore', title: 'Estudar o sync (@explore subagent)' })],
      active: { [MAIN]: { type: 'running' }, [CHILD]: { type: 'running' } },
    });
    await t.source.start();
    const sub = t.agent(CHILD)!;
    expect(sub).toMatchObject({ kind: 'sub', parentId: `.opencode:${MAIN}`, role: 'Explore', title: 'Estudar o sync', status: 'working' });
    t.svc.active = { [MAIN]: { type: 'running' } };
    t.source.handleEvent({ type: 'session.execution.succeeded', data: { sessionID: CHILD } });
    expect(t.agent(CHILD)?.status).toBe('done');
  });

  it('serviço fora do ar: só o erro em sources (nada lança); voltando, as sessões entram', async () => {
    const t = setup({ sessions: [session(MAIN)], down: true });
    await t.source.start();
    expect(t.agents()).toEqual([]);
    expect(t.source.sources()[0]).toMatchObject({ ok: false, error: 'serviço do OpenCode fora do ar' });
    t.svc.down = false;
    await t.source.poll();
    expect(t.agent(MAIN)).toBeDefined();
    expect(t.source.sources()[0].ok).toBe(true);
  });

  it('sessão que ficou parada mais que PRESENCE_MS sai', async () => {
    const t = setup({ sessions: [session(MAIN)] });
    await t.source.start();
    expect(t.agent(MAIN)).toBeDefined();
    t.svc.sessions = [session(MAIN, { time: { created: 1, updated: Date.now() - PRESENCE_MS - 1 } })];
    // O último sinal de vida também envelhece (o tracker guardou o updated de antes).
    (t.source as unknown as { sessions: Map<string, { lastSignalAt: number }> }).sessions.get(MAIN)!.lastSignalAt = 0;
    await t.source.poll();
    expect(t.agent(MAIN)?.status ?? 'offline').toBe('offline');
  });
});

describe('fonte do OpenCode: uso e mensagens', () => {
  it('limites do OpenCode Go entram na conta (5h, semana, mês) com o plano e o workspace', async () => {
    const t = setup({
      limits: {
        data: {
          workspace: { id: 'org', name: 'Personal', usageURL: 'u' },
          go: { rolling: { percent: 30, limited: false, resetsAt: Date.now() + 3_600_000 }, weekly: { percent: 60, limited: false, resetsAt: Date.now() + 86_400_000 }, monthly: { percent: 10, limited: false, resetsAt: Date.now() + 9 * 86_400_000 } },
          budgets: [],
        },
      },
    });
    await t.source.start();
    await t.source.refreshLimits();
    const acc = t.accounts.list(new Map())[0];
    expect(acc).toMatchObject({ id: '.opencode', provider: 'opencode', plan: 'Go', organization: 'Personal', usageStatus: 'ok' });
    expect(acc.usage).toMatchObject({ source: 'opencode', fiveHour: { utilization: 30 }, sevenDay: { utilization: 60 }, monthly: { utilization: 10 } });
  });

  it('sem o Go: a conta diz que não há limites informados (nunca 0%)', async () => {
    const t = setup();
    await t.source.start();
    await t.source.refreshLimits();
    const acc = t.accounts.list(new Map())[0];
    expect(acc.usage).toMatchObject({ noLimits: true });
    expect(acc.usage?.fiveHour).toBeUndefined();
  });

  it('sendPrompt põe a mensagem na fila da sessão, com a senha só no cabeçalho', async () => {
    const t = setup({ sessions: [session(MAIN)] });
    await t.source.start();
    expect(t.source.isReachable()).toBe(true);
    await expect(t.source.sendPrompt(MAIN, 'olá')).resolves.toEqual({ ok: true });
    expect(t.svc.posts).toEqual([{ url: `http://opencode.test/api/session/${MAIN}/prompt`, body: { text: 'olá', delivery: 'queue' }, auth: `Basic ${Buffer.from('opencode:segredo').toString('base64')}` }]);
    await expect(t.source.sendPrompt('../x', 'olá')).resolves.toMatchObject({ ok: false });
  });
});
