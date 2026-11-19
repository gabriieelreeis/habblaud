// Interpretação do que o serviço do OpenCode devolve: sessões, mensagens (atividades) e limites de uso.
import { describe, expect, it } from 'vitest';
import { describeOpenCodeTool, isSessionId, parseSession, parseUsageLimits, readMessages, sessionBusy, todosOf } from './parse';

const SID = 'ses_e0a5341ccffeEAxdLIyDwu9huf';

describe('OpenCode: sessões', () => {
  it('Session.Info vira OcSession (pasta, título, modelo, tokens com o cache, agente)', () => {
    const s = parseSession({
      id: SID,
      parentID: 'ses_e0a538743ffe1ReskKlfABsPZC',
      agent: 'explore',
      model: { id: 'mimo-v2.6-flash-free', providerID: 'opencode', variant: 'default' },
      cost: 0.25,
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 1000, write: 10 } },
      time: { created: 1_000, updated: 2_000, busy: 1_500, idle: 1_200, viewed: 1_800 },
      title: 'Ler o arquivo',
      location: { directory: 'C:\\Users\\dev\\projeto' },
    });
    expect(s).toEqual({
      id: SID,
      parentId: 'ses_e0a538743ffe1ReskKlfABsPZC',
      directory: 'C:\\Users\\dev\\projeto',
      title: 'Ler o arquivo',
      agent: 'explore',
      model: 'opencode/mimo-v2.6-flash-free',
      tokensIn: 1110,
      tokensOut: 25,
      cost: 0.25,
      createdAt: 1_000,
      updatedAt: 2_000,
      busyAt: 1_500,
      idleAt: 1_200,
      viewedAt: 1_800,
    });
    expect(sessionBusy(s!)).toBe(true);
  });

  it('título padrão ("New session - <data>") não vale como título; sem id ou data: undefined', () => {
    expect(parseSession({ id: SID, time: { created: 1 }, title: 'New session - 2026-10-02T13:15:20.680Z' })?.title).toBeUndefined();
    expect(parseSession({ id: 'outro', time: { created: 1 } })).toBeUndefined();
    expect(parseSession({ id: SID })).toBeUndefined();
    expect(parseSession(null)).toBeUndefined();
  });

  it('isSessionId só aceita ids "ses_..."', () => {
    expect(isSessionId(SID)).toBe(true);
    expect(isSessionId('ses_../../x')).toBe(false);
    expect(isSessionId(42)).toBe(false);
  });
});

describe('OpenCode: ferramentas', () => {
  it('nomes do OpenCode viram as atividades conhecidas', () => {
    expect(describeOpenCodeTool('read', { path: 'src/a.txt' })).toMatchObject({ tool: 'Read', desc: { kind: 'read', text: 'Lendo a.txt' } });
    expect(describeOpenCodeTool('read', { filePath: '/x/b.ts' }).desc.text).toBe('Lendo b.ts');
    expect(describeOpenCodeTool('edit', { filePath: '/x/c.ts' })).toMatchObject({ tool: 'Edit', desc: { kind: 'edit' } });
    expect(describeOpenCodeTool('write', { filePath: '/x/d.ts' })).toMatchObject({ tool: 'Write', desc: { kind: 'write' } });
    expect(describeOpenCodeTool('bash', { command: 'npm test' }).tool).toBe('Bash');
    expect(describeOpenCodeTool('grep', { pattern: 'TODO' }).desc.text).toContain('TODO');
    expect(describeOpenCodeTool('task', { description: 'Estudar o sync', subagent_type: 'explore' })).toMatchObject({ tool: 'Agent', desc: { kind: 'delegate' } });
    expect(describeOpenCodeTool('webfetch', { url: 'https://example.com/a' }).desc.kind).toBe('web');
    expect(describeOpenCodeTool('rea_buscar', {}).desc.text).toBe('Usando rea_buscar');
  });

  it('apply_patch: o primeiro arquivo e a lista no detalhe', () => {
    const r = describeOpenCodeTool('apply_patch', { patchText: '*** Begin Patch\n*** Update File: a.ts\n*** Add File: b.ts\n*** End Patch' });
    expect(r.tool).toBe('Edit');
    expect(r.desc.text).toBe('Editando a.ts');
    expect(r.desc.detail).toBe('a.ts, b.ts');
  });

  it('question vira pergunta com as opções', () => {
    const r = describeOpenCodeTool('question', { questions: [{ question: 'Qual?', header: 'Escolha', options: [{ label: 'A', description: 'a' }, { label: 'B' }], multiple: true }] });
    expect(r.tool).toBe('AskUserQuestion');
    expect(r.desc.questions).toEqual([{ index: 0, question: 'Qual?', header: 'Escolha', multiSelect: true, options: [{ index: 0, label: 'A', description: 'a' }, { index: 1, label: 'B' }] }]);
  });

  it('todowrite: a lista de tarefas (cancelada sai)', () => {
    expect(
      todosOf({
        todos: [
          { id: '1', content: 'Ler', status: 'completed' },
          { id: '2', content: 'Escrever', status: 'in_progress' },
          { id: '3', content: 'Largar', status: 'cancelled' },
          { content: 'Depois', status: 'pending' },
        ],
      }),
    ).toEqual([
      { id: '1', title: 'Ler', status: 'completed' },
      { id: '2', title: 'Escrever', status: 'in_progress' },
      { id: '4', title: 'Depois', status: 'pending' },
    ]);
  });
});

describe('OpenCode: mensagens', () => {
  const msgs = [
    // em ordem decrescente, como a API devolve com order=desc
    { id: 'msg_4', type: 'idle', outcome: 'succeeded', time: { created: 9_000 } },
    {
      id: 'msg_3',
      type: 'assistant',
      model: { id: 'mimo', providerID: 'opencode' },
      time: { created: 6_000, completed: 8_000 },
      content: [
        { type: 'reasoning', text: 'pensando' },
        { type: 'text', text: 'banana' },
      ],
    },
    {
      id: 'msg_2',
      type: 'assistant',
      model: { id: 'mimo', providerID: 'opencode' },
      time: { created: 2_000, completed: 5_000 },
      content: [
        { type: 'tool', id: 'call_1', name: 'read', state: { status: 'completed', input: { path: 'a.txt' } }, time: { created: 3_000, completed: 3_500 } },
        { type: 'tool', id: 'call_2', name: 'bash', state: { status: 'error', input: { command: 'false' }, error: { message: 'saiu com 1\nmais' } }, time: { created: 4_000, completed: 4_100 } },
        { type: 'tool', id: 'call_3', name: 'todowrite', state: { status: 'running', input: { todos: [{ id: 't', content: 'Ler', status: 'in_progress' }] } }, time: { created: 4_500 } },
      ],
    },
    { id: 'msg_1', type: 'user', text: '"Leia o arquivo a.txt"', time: { created: 1_000 } },
  ];

  it('atividades em ordem, com ids estáveis (o id da chamada nas ferramentas)', () => {
    const r = readMessages(msgs, 'A');
    expect(r.activities.map((a) => [a.activity.id, a.activity.text, a.current])).toEqual([
      ['A#msg_1:p', 'Recebeu “Leia o arquivo a.txt”', false],
      ['A#call_1', 'Lendo a.txt', false],
      ['A#call_2', expect.any(String), false],
      ['A#call_2:e', 'Erro em Bash', false],
      ['A#call_3', 'Atualizando a lista de tarefas', true],
      ['A#msg_3:1', 'Escrevendo a resposta', false],
      ['A#msg_4:d', 'Concluiu em 8s', false],
    ]);
    expect(r.activities.find((a) => a.activity.id === 'A#call_2:e')?.activity).toMatchObject({ error: true, detail: 'saiu com 1' });
    expect(r.activities.find((a) => a.activity.id === 'A#call_1')?.activity.durationMs).toBe(500);
    expect(r.toolCalls).toBe(3);
    expect(r.tasks).toEqual([{ id: 't', title: 'Ler', status: 'in_progress' }]);
    expect(r.model).toBe('opencode/mimo');
    expect(r.firstAt).toBe(1_000);
    expect(r.lastAt).toBe(9_000);
  });

  it('turno interrompido ou com erro; mensagem inválida é ignorada', () => {
    const r = readMessages(
      [
        { id: 'u', type: 'user', text: 'oi', time: { created: 1 } },
        { id: 'i', type: 'idle', outcome: 'interrupted', time: { created: 2 } },
        { id: 'f', type: 'idle', outcome: 'failed', error: { message: 'Free usage limit reached.' }, time: { created: 3 } },
        { type: 'user', text: 'sem id' },
        'lixo',
      ],
      'A',
    );
    expect(r.activities.map((a) => a.activity.text)).toEqual(['Recebeu “oi”', 'Interrompido por você', 'Algo deu errado']);
    expect(r.activities[2].activity.detail).toBe('Free usage limit reached.');
  });

  it('segredos no prompt são mascarados', () => {
    const r = readMessages([{ id: 'u', type: 'user', text: 'use a chave sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', time: { created: 1 } }], 'A');
    expect(JSON.stringify(r.activities)).not.toContain('AAAAAAAAAAAAAAAA');
  });
});

describe('OpenCode: limites de uso', () => {
  it('OpenCode Go: 5h, semana e mês; o limite batido vira 100%', () => {
    const r = parseUsageLimits(
      {
        data: {
          workspace: { id: 'org_1', name: 'Personal', usageURL: 'https://x' },
          go: {
            rolling: { percent: 42, limited: false, resetsAt: 10_000 },
            weekly: { percent: 80, limited: true, resetsAt: 20_000 },
            monthly: { percent: 12.5, limited: false, resetsAt: 30_000 },
          },
          budgets: [],
        },
      },
      5,
    );
    expect(r).toEqual({
      plan: 'Go',
      workspace: 'Personal',
      usage: {
        source: 'opencode',
        fetchedAt: 5,
        fiveHour: { utilization: 42, resetsAt: 10_000 },
        sevenDay: { utilization: 100, resetsAt: 20_000 },
        monthly: { utilization: 12.5, resetsAt: 30_000 },
      },
    });
  });

  it('sem Go: o orçamento mais apertado; sem nada: noLimits', () => {
    const budgets = [
      { id: 'a', limit: 10, spent: 1, resetsAt: 9 },
      { id: 'b', limit: 5, spent: 4, resetsAt: 8 },
      { id: 'c', limit: 0, spent: 0 },
    ];
    expect(parseUsageLimits({ data: { workspace: { id: 'o', usageURL: 'u' }, budgets } }, 1).usage).toEqual({ source: 'opencode', fetchedAt: 1, budget: { spent: 4, limit: 5, resetsAt: 8 } });
    expect(parseUsageLimits({ data: { workspace: { id: 'o', usageURL: 'u' }, budgets: [] } }, 1).usage).toEqual({ source: 'opencode', fetchedAt: 1, noLimits: true });
    expect(parseUsageLimits({ data: null }, 1).usage.noLimits).toBe(true);
  });
});
