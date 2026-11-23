// Integração da fonte do OpenCode: um serviço do OpenCode de mentira (fetch falso), o AccountsService e o Office.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentInfo } from '../../../shared/types';
import { AccountsService } from '../../accounts/service';
import { DeliveryIndex } from '../../deliveries/deliveries';
import { setQuiet } from '../../log';
import { NameStore } from '../../model/names';
import { Office } from '../../model/office';
import type { FetchLike } from './service';
import { OpenCodeSource, pinnedSessions, PRESENCE_MS } from './source';
import { PermissionRegistry } from '../../permissions/registry';

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
  forms: Record<string, unknown[]>;
  limits: unknown;
  down: boolean;
  posts: Array<{ url: string; body: unknown; auth?: string }>;
  calls: string[];
  /** Status da resposta a um pedido de permissão (padrão 204). */
  replyStatus?: number;
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

function setup(state: Partial<FakeService> = {}, env: NodeJS.ProcessEnv = {}) {
  const svc: FakeService = {
    sessions: [],
    active: {},
    messages: {},
    permissions: {},
    forms: {},
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
    if (init?.method === 'DELETE') {
      svc.posts.push({ url: `DELETE ${url}`, body: null });
      return { ok: true, status: 204, json: async () => { throw new SyntaxError('sem corpo'); } };
    }
    if (init?.method === 'POST') {
      svc.posts.push({ url, body: JSON.parse(init.body ?? 'null'), auth: init.headers?.authorization });
      if (path.endsWith('/reply')) {
        const status = svc.replyStatus ?? 204;
        return { ok: status < 300, status, json: async () => { throw new SyntaxError('sem corpo'); } };
      }
      return json({ data: {} });
    }
    if (path === '/api/session') return json({ data: svc.sessions.filter((x) => !x.unlisted), cursor: {} });
    if (path === '/api/session/active') return json({ data: svc.active });
    if (path === '/api/experimental/usage/limits') return json(svc.limits);
    let m = /^\/api\/session\/(ses_\w+)\/message$/.exec(path);
    if (m) return json({ data: [...(svc.messages[m[1]] ?? [])].reverse() });
    m = /^\/api\/session\/(ses_\w+)\/permission$/.exec(path);
    if (m) return json({ data: svc.permissions[m[1]] ?? [] });
    m = /^\/api\/session\/(ses_\w+)\/form$/.exec(path);
    if (m) return json({ data: svc.forms[m[1]] ?? [] });
    m = /^\/api\/session\/(ses_\w+)$/.exec(path);
    if (m) {
      const s = svc.sessions.find((x) => x.id === m![1]);
      return s ? json({ data: s }) : { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const late: { office?: Office; permissions?: PermissionRegistry } = {};
  const accounts = new AccountsService({ dirs: [], home: '/nada', env: {}, onChange: () => late.office?.markDirty() });
  const office = new Office({
    names: new NameStore(null),
    version: 'teste',
    startedAt: Date.now(),
    accounts: (s) => accounts.list(s),
    sources: () => [],
    accountName: (id) => accounts.find(id)?.detected.name,
    permissions: () => late.permissions?.snapshot() ?? new Map(),
  });
  late.office = office;
  const source = new OpenCodeSource({
    accounts,
    office,
    env: { HABBLAUD_OPENCODE_URL: 'http://opencode.test', HABBLAUD_OPENCODE_PASSWORD: 'segredo', ...env },
    home: '/nada',
    fetch: fetchFn,
    stream: false,
    timers: false,
  });
  stops.push(() => source.stop());
  // Sem nenhuma página aberta: os pedidos do OpenCode aparecem mesmo assim (não saem do lugar de lá).
  const permissions = new PermissionRegistry({ office, viewers: () => 0 });
  late.permissions = permissions;
  source.setPermissionSink({ add: (r) => permissions.registerExternal(r), remove: (key) => permissions.releaseExternal(key) });
  const agents = (): AgentInfo[] => office.commit().snapshot.agents;
  return {
    svc,
    permissions,
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

  it('sessões e mensagens do serviço alimentam as entregas do escritório', async () => {
    const t = setup({
      sessions: [session(MAIN)],
      messages: {
        [MAIN]: [
          { id: 'msg_1', type: 'user', text: 'Faça o relatório completo de vendas', time: { created: 2_000 } },
          {
            id: 'msg_2',
            type: 'assistant',
            time: { created: 3_000, completed: 3_100 },
            content: [{ type: 'tool', id: 'call_1', name: 'write', state: { status: 'completed', input: { filePath: 'relatorio.md', content: 'dados' }, output: 'ok' }, time: { created: 3_050 } }],
          },
          { id: 'msg_3', type: 'assistant', time: { created: 4_000, completed: 4_100 }, content: [{ type: 'text', text: 'Relatório pronto, com o último dia de vendas conferido.' }] },
        ],
      },
    });
    await t.source.start();
    const sessions = t.source.deliverySessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      account: '.opencode',
      provider: 'opencode',
      sessionId: MAIN,
      project: DIR,
      title: 'Ler o arquivo',
      open: true,
      agentId: `.opencode:${MAIN}`,
    });
    const src = t.source.deliverySource(MAIN);
    expect(src?.key).toBe(MAIN);
    const entries = await src!.entries();
    expect(entries.map((e) => e.kind)).toEqual(['user', 'tool', 'result', 'assistant']);
    expect(entries[0]).toMatchObject({ text: 'Faça o relatório completo de vendas' });
    expect(entries.at(-1)).toMatchObject({ text: 'Relatório pronto, com o último dia de vendas conferido.' });

    // O mesmo encadeamento usado pelo servidor: a entrega aparece com o selo do OpenCode.
    const idx = new DeliveryIndex({
      sessions: async () => t.source.deliverySessions(),
      resolve: (account, sid) => (account === t.source.accountId ? t.source.deliverySource(sid) : undefined),
      isBusy: () => false,
    });
    const list = await idx.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      account: '.opencode',
      provider: 'opencode',
      sessionId: MAIN,
      agentName: 'Ler o arquivo',
      request: 'Faça o relatório completo de vendas',
      tools: 1,
    });
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
  it('sessão fixa (HABBLAUD_OPENCODE_PINNED) fica parada no escritório, mesmo fora da lista; arquivada sai', async () => {
    const parada = { time: { created: 1, updated: Date.now() - PRESENCE_MS - 60_000 } };
    // `unlisted`: fora da lista (cortada nas mais recentes); a fonte busca a sessão fixa sozinha.
    const t = setup({ sessions: [session(OLD, { ...parada, unlisted: true })] }, { HABBLAUD_OPENCODE_PINNED: `${OLD}, ses_naoexiste000000000009` });
    await t.source.start();
    expect(t.agent(OLD)).toMatchObject({ status: 'idle', provider: 'opencode' });
    expect(t.svc.calls).toContain(`GET /api/session/${OLD}`);
    t.svc.sessions = [session(OLD, { time: { created: 1, updated: Date.now(), archived: Date.now() } })];
    await t.source.poll();
    expect(t.agent(OLD)?.status ?? 'offline').toBe('offline');
    expect([...pinnedSessions({ HABBLAUD_OPENCODE_PINNED: ' ses_abc123456 ; nada,ses_def123456 ' })]).toEqual(['ses_abc123456', 'ses_def123456']);
  });

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

describe('fonte do OpenCode: permissões pelo escritório', () => {
  const BASH = { id: 'per_1', sessionID: MAIN, action: 'bash', resources: ['npm test'], save: ['npm test *'] };

  it('o pedido pendente aparece no agente; "sempre permitir" responde always ao serviço e o agente volta a trabalhar', async () => {
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } }, permissions: { [MAIN]: [BASH] } });
    await t.source.start();
    const p = t.agent(MAIN)!.permission!;
    expect(p).toMatchObject({ provider: 'opencode', tool: 'Bash', suggestions: [{ index: 0, rules: ['bash(npm test *)'], destination: 'opencode' }] });
    expect(t.agent(MAIN)!.status).toBe('waiting');
    expect(t.permissions.detail(p.id)).toMatchObject({ input: 'npm test', inputKind: 'command' });

    await expect(t.permissions.decideAsync(p.id, { behavior: 'allow', suggestion: 0 })).resolves.toBe('ok');
    expect(t.svc.posts.at(-1)).toMatchObject({ url: `http://opencode.test/api/session/${MAIN}/permission/per_1/reply`, body: { decision: 'always' } });
    const a = t.agent(MAIN)!;
    expect(a.permission).toBeUndefined();
    expect(a.status).toBe('working');
    // A releitura seguinte (o serviço ainda listando o pedido por um instante) não o traz de volta.
    t.svc.permissions[MAIN] = [];
    await t.source.poll();
    expect(t.agent(MAIN)!.permission).toBeUndefined();
  });

  it('recusar manda reject com o motivo; interromper e "responder no terminal" não valem no OpenCode', async () => {
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } }, permissions: { [MAIN]: [BASH] } });
    await t.source.start();
    const id = t.agent(MAIN)!.permission!.id;
    expect(t.permissions.decide(id, { behavior: 'terminal' })).toBe('unsupported');
    await expect(t.permissions.decideAsync(id, { behavior: 'deny', interrupt: true })).resolves.toBe('unsupported');
    expect(t.svc.posts).toEqual([]);
    await expect(t.permissions.decideAsync(id, { behavior: 'deny', message: 'use pnpm' })).resolves.toBe('ok');
    expect(t.svc.posts.at(-1)?.body).toEqual({ decision: 'reject', message: 'use pnpm' });
  });

  it('serviço que não aceitou a resposta: erro e o pedido continua aberto', async () => {
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } }, permissions: { [MAIN]: [BASH] }, replyStatus: 404 });
    await t.source.start();
    const id = t.agent(MAIN)!.permission!.id;
    await expect(t.permissions.decideAsync(id, { behavior: 'allow' })).resolves.toEqual({ error: 'o pedido não está mais aberto no OpenCode (já foi respondido?)' });
    expect(t.agent(MAIN)!.permission?.id).toBe(id);
  });

  it('pedido pelo evento; respondido na TUI (permission.replied), some do escritório', async () => {
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } } });
    await t.source.start();
    t.source.handleEvent({ type: 'permission.asked', data: { ...BASH, id: 'per_9' } });
    expect(t.agent(MAIN)!.permission).toMatchObject({ provider: 'opencode', tool: 'Bash' });
    t.source.handleEvent({ type: 'permission.replied', data: { sessionID: MAIN, requestID: 'per_9', reply: 'once' } });
    expect(t.agent(MAIN)!.permission).toBeUndefined();
    expect(t.permissions.size).toBe(0);
  });

  it('a execução acabou com o pedido aberto: ele some junto', async () => {
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } }, permissions: { [MAIN]: [BASH] } });
    await t.source.start();
    expect(t.permissions.size).toBe(1);
    t.source.handleEvent({ type: 'session.execution.interrupted', data: { sessionID: MAIN } });
    expect(t.permissions.size).toBe(0);
  });
});

describe('fonte do OpenCode: terminal', () => {
  it('conversation: a conversa da sessão pelo serviço; agente que não é desta fonte, nada', async () => {
    const t = setup({
      sessions: [session(MAIN)],
      messages: {
        [MAIN]: [
          { id: 'msg_1', type: 'user', text: 'oi', time: { created: 2_000 } },
          { id: 'msg_2', type: 'assistant', time: { created: 3_000, completed: 3_500 }, content: [{ type: 'text', text: 'Olá!' }] },
        ],
      },
    });
    await t.source.start();
    expect(t.source.conversation('.claude:1')).toBeUndefined();
    const conv = t.source.conversation(`.opencode:${MAIN}`)!;
    const r = await conv.read();
    expect(r.truncated).toBe(false);
    expect(r.entries.map((e) => [e.kind, e.id])).toEqual([
      ['user', 'msg_1'],
      ['assistant', 'msg_2:0'],
    ]);
    t.svc.down = true;
    await expect(conv.read()).rejects.toThrow();
  });
});

describe('fonte do OpenCode: perguntas pelo escritório', () => {
  const FORM = {
  id: 'frm_1',
  sessionID: MAIN,
  title: 'Questions',
  metadata: { kind: 'question' },
  fields: [
    {
      key: 'q0',
      title: 'Teste',
      description: 'Como você prefere?',
      type: 'string',
      options: [
        { value: 'curto', label: 'Curto', description: 'Só o necessário' },
        { value: 'longo', label: 'Com detalhes' },
      ],
      custom: true,
    },
  ],
};

  it('a pergunta vira o cartão com as opções; responder manda o valor ao formulário e o agente volta a trabalhar', async () => {
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } }, forms: { [MAIN]: [FORM] } });
    await t.source.start();
    const p = t.agent(MAIN)!.permission!;
    expect(p).toMatchObject({ provider: 'opencode', tool: 'AskUserQuestion' });
    expect(p.questions).toEqual([
      { index: 0, question: 'Como você prefere?', header: 'Teste', options: [{ index: 0, label: 'Curto', description: 'Só o necessário' }, { index: 1, label: 'Com detalhes' }] },
    ]);
    await expect(t.permissions.decideAsync(p.id, { behavior: 'allow' })).resolves.toBe('invalid-answer');
    await expect(t.permissions.decideAsync(p.id, { behavior: 'answer', answers: [{ question: 0, options: [1] }] })).resolves.toBe('ok');
    expect(t.svc.posts.at(-1)).toMatchObject({ url: `http://opencode.test/api/session/${MAIN}/form/frm_1/reply`, body: { answer: { q0: 'longo' } } });
    const a = t.agent(MAIN)!;
    expect(a.permission).toBeUndefined();
    expect(a.status).toBe('working');
  });

  it('"Outro" vai como texto livre; recusar cancela a pergunta', async () => {
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } }, forms: { [MAIN]: [FORM] } });
    await t.source.start();
    const id = t.agent(MAIN)!.permission!.id;
    await expect(t.permissions.decideAsync(id, { behavior: 'answer', answers: [{ question: 0, other: 'do seu jeito' }] })).resolves.toBe('ok');
    expect(t.svc.posts.at(-1)?.body).toEqual({ answer: { q0: 'do seu jeito' } });

    const t2 = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } }, forms: { [MAIN]: [FORM] } });
    await t2.source.start();
    await expect(t2.permissions.decideAsync(t2.agent(MAIN)!.permission!.id, { behavior: 'deny' })).resolves.toBe('ok');
    expect(t2.svc.posts.at(-1)?.url).toBe(`DELETE http://opencode.test/api/session/${MAIN}/form/frm_1`);
  });

  it('pergunta pelo evento form.created; respondida na TUI (form.replied), some do escritório', async () => {
    const t = setup({ sessions: [session(MAIN)], active: { [MAIN]: { type: 'running' } } });
    await t.source.start();
    t.source.handleEvent({ type: 'form.created', data: { form: FORM } });
    expect(t.agent(MAIN)!.permission).toMatchObject({ tool: 'AskUserQuestion' });
    t.source.handleEvent({ type: 'form.replied', data: { sessionID: MAIN, id: 'frm_1' } });
    expect(t.agent(MAIN)!.permission).toBeUndefined();
  });
});
