import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RecentSession } from '../../shared/types';
import { conversationOf } from '../sources/opencode/terminal';
import { createTerminalParser } from '../sources/terminal';
import { tempDir } from '../test/fixtures';
import { DeliveryIndex, MAX_DELIVERIES, MAX_PER_AGENT, MAX_SESSIONS, headlineOf, linkedFiles, parseTurns, summaryOf } from './deliveries';

const ts = (s: number) => new Date(Date.UTC(2026, 9, 12, 12, 0, s)).toISOString();
const user = (id: string, s: number, text: string) => ({ type: 'user', uuid: id, timestamp: ts(s), message: { role: 'user', content: text } });
const tool = (id: string, s: number, name: string, input: object) => ({
  type: 'assistant',
  uuid: id,
  timestamp: ts(s),
  message: { id: `m-${id}`, role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t-${id}`, name, input }] },
});
const shot = (id: string, s: number, data: string) => ({
  type: 'user',
  uuid: id,
  timestamp: ts(s),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't-x', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] }] },
});
const say = (id: string, s: number, text: string, stop = 'end_turn') => ({
  type: 'assistant',
  uuid: id,
  timestamp: ts(s),
  message: { id: `m-${id}`, role: 'assistant', stop_reason: stop, content: [{ type: 'text', text }] },
});

const REPLY = `**O relatório está pronto** e foi enviado. Veja [o PDF](/Users/ana/proj/relatorio.pdf) e ./telas/antes.png.

| a | b |
|---|---|

Em poucas palavras: o relatório de vendas agora mostra o último dia certo, e o PDF está na pasta do projeto para a BA conferir.`;

function transcript(): string[] {
  return [
    user('u1', 0, 'Corrija o relatório de vendas'),
    tool('a1', 1, 'Edit', { file_path: '/Users/ana/proj/src/x.ts', old_string: 'a', new_string: 'b' }),
    say('a2', 2, 'Ainda trabalhando, já volto.', 'tool_use'),
    shot('r1', 3, 'AAAA'),
    shot('r2', 4, 'BBBB'),
    shot('r3', 5, 'CCCC'),
    tool('a3', 6, 'SendUserFile', { files: ['/Users/ana/proj/print.png', '/Users/ana/.ssh/id_rsa'], caption: 'A tela nova' }),
    say('a4', 7, REPLY),
    user('u2', 8, 'Obrigado'),
    say('a5', 9, 'De nada!'),
    user('u3', 10, 'Agora rode os testes'),
    tool('a6', 11, 'Bash', { command: 'npm test' }),
    say('a7', 12, 'Rodando os testes… ainda falta a parte de integração, já volto.', 'tool_use'),
  ].map((l) => JSON.stringify(l));
}

describe('entregas: texto', () => {
  it('manchete = primeira frase sem markdown; resumo = último parágrafo corrido', () => {
    expect(headlineOf(REPLY)).toBe('O relatório está pronto e foi enviado.');
    expect(summaryOf(REPLY, headlineOf(REPLY))).toMatch(/^Em poucas palavras: o relatório de vendas agora mostra/);
    expect(summaryOf('Uma frase só, sem resumo nenhum aqui dentro.', 'x')).toBeUndefined();
    expect(headlineOf('# Título\n\n' + 'palavra '.repeat(60))).toMatch(/…$/);
  });

  it('links para arquivos de ver: absolutos, relativos ao projeto; nada protegido', () => {
    expect(linkedFiles(REPLY, '/Users/ana/proj')).toEqual(['/Users/ana/proj/relatorio.pdf']);
    expect(linkedFiles('veja [a](telas/a.png) e [b](https://x.com/b.png) e /Users/ana/.ssh/k.png', '/Users/ana/proj')).toEqual(['/Users/ana/proj/telas/a.png']);
    expect(linkedFiles('[c](relativo.png)')).toEqual([]);
  });
});

describe('entregas: pedidos do transcript', () => {
  it('só o texto que encerrou a vez vale; anexos, capturas (as 2 últimas) e contagem', () => {
    const { turns, last } = parseTurns(transcript(), createTerminalParser());
    expect(turns.map((t) => t.start.text)).toEqual(['Corrija o relatório de vendas', 'Obrigado']);
    const t = turns[0];
    expect([t.tools, t.edited.size, t.ended, t.text.startsWith('**O relatório')]).toEqual([2, 1, true, true]);
    expect(t.files.map((f) => f.path)).toEqual(['/Users/ana/proj/print.png', '/Users/ana/.ssh/id_rsa']);
    expect(t.captures.map((c) => c.data)).toEqual(['BBBB', 'CCCC']);
    expect(last?.start.text).toBe('Agora rode os testes');
    expect(last?.ended).toBe(false);
  });

  it('DeliveryIndex: monta as entregas, ids opacos e nada de arquivo protegido', async () => {
    const dir = tempDir().dir;
    const path = join(dir, 's.jsonl');
    writeFileSync(path, transcript().join('\n') + '\n');
    let busy = true;
    const idx = new DeliveryIndex({
      sessions: async () => [{ account: '.claude', sessionId: 's1', projectDir: 'p', project: '/Users/ana/proj', lastAt: 1, size: 1, open: true, agentId: 'ag' }],
      resolve: () => ({ path, createParser: createTerminalParser }),
      isBusy: () => busy,
      agentName: () => 'Estela',
    });
    const list = await idx.list();
    expect(list).toHaveLength(1);
    const d = list[0];
    expect(d).toMatchObject({ agentName: 'Estela', request: 'Corrija o relatório de vendas', headline: 'O relatório está pronto e foi enviado.', tools: 2, edited: 1 });
    expect(d.attachments.map((a) => [a.name, a.kind, a.caption ?? '', !!a.capture])).toEqual([
      ['print.png', 'image', 'A tela nova', false],
      ['relatorio.pdf', 'pdf', '', false],
      ['tela-1.png', 'image', 'Tela capturada pelo agente', true],
      ['tela-2.png', 'image', 'Tela capturada pelo agente', true],
    ]);
    expect(JSON.stringify(list)).not.toContain('/Users/ana/proj/print.png');
    expect(JSON.stringify(list)).not.toContain('.ssh');
    expect(idx.attachment(d.attachments[0].id)).toMatchObject({ kind: 'file', path: '/Users/ana/proj/print.png', type: 'image/png' });
    expect(idx.attachment(d.attachments[2].id)).toMatchObject({ kind: 'capture', type: 'image/png' });
    expect(idx.attachment('nao-existe')).toBeUndefined();
    // "De nada!" sem ferramentas não é entrega; o último pedido conta só quando o agente para.
    busy = false;
    expect((await idx.list()).map((x) => x.request)).toEqual(['Corrija o relatório de vendas']);
  });
});

describe('entregas: sessões do OpenCode (sem transcript em arquivo)', () => {
  const messages = [
    { id: 'u1', type: 'user', text: 'Corrija o relatório de vendas', time: { created: 1_000 } },
    {
      id: 'm1',
      type: 'assistant',
      time: { created: 2_000, completed: 2_100 },
      content: [
        { type: 'tool', id: 't1', name: 'edit', state: { status: 'completed', input: { filePath: '/proj/x.ts', oldString: 'a', newString: 'b' }, output: 'ok' }, time: { created: 2_050 } },
      ],
    },
    { id: 'm2', type: 'assistant', time: { created: 3_000, completed: 3_100 }, content: [{ type: 'text', text: REPLY }] },
    { id: 'u2', type: 'user', text: 'Obrigado', time: { created: 4_000 } },
    { id: 'm3', type: 'assistant', time: { created: 5_000, completed: 5_100 }, content: [{ type: 'text', text: 'De nada, fico à disposição para o que mais precisar.' }] },
  ];

  it('as mensagens do serviço viram entrega com o selo do OpenCode', async () => {
    let reads = 0;
    const idx = new DeliveryIndex({
      sessions: async () => [{ account: '.opencode', provider: 'opencode', sessionId: 'ses_abc123', projectDir: 'p', project: '/proj', title: 'Relatório', lastAt: 5_000, size: 0, open: false }],
      resolve: (account, sessionId) =>
        account === '.opencode'
          ? {
              key: sessionId,
              stamp: 5_000,
              entries: async () => {
                reads++;
                return conversationOf(messages, '/proj');
              },
            }
          : undefined,
      isBusy: () => false,
    });
    const list = await idx.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      account: '.opencode',
      provider: 'opencode',
      sessionId: 'ses_abc123',
      agentName: 'Relatório',
      request: 'Corrija o relatório de vendas',
      headline: 'O relatório está pronto e foi enviado.',
      tools: 1,
      edited: 1,
    });
    // "De nada..." sem ferramentas não é entrega; o cache evita reler as mensagens sem mudança.
    await idx.list();
    expect(reads).toBe(1);
  });
});

function writeTranscript(dir: string, name: string, count: number, offset: number): string {
  const path = join(dir, name);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = offset + i * 60;
    lines.push(JSON.stringify(user(`u${i}`, at, `Pedido ${i} da sessão`)));
    lines.push(JSON.stringify(tool(`a${i}`, at + 1, 'Edit', { file_path: '/proj/x.ts', old_string: 'a', new_string: 'b' })));
    lines.push(JSON.stringify(say(`r${i}`, at + 2, `Resposta ${i} com texto suficiente para virar uma entrega completa.`)));
  }
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

const liveMessages = () => [
  { id: 'u1', type: 'user', text: 'Corrija o relatório de vendas', time: { created: 1_000 } },
  {
    id: 'm1',
    type: 'assistant',
    time: { created: 2_000, completed: 2_100 },
    content: [{ type: 'tool', id: 't1', name: 'edit', state: { status: 'completed', input: { filePath: '/proj/x.ts', oldString: 'a', newString: 'b' }, output: 'ok' }, time: { created: 2_050 } }],
  },
  { id: 'm2', type: 'assistant', time: { created: 3_000, completed: 3_100 }, content: [{ type: 'text', text: 'O relatório de vendas foi corrigido e enviado para a pasta do projeto, confira.' }] },
];

describe('entregas: limites', () => {
  it('com 31 sessões do Claude, a entrega do OpenCode continua na lista', async () => {
    const dir = tempDir().dir;
    const path = writeTranscript(dir, 'claude.jsonl', 1, 0);
    const sessions: RecentSession[] = Array.from({ length: 31 }, (_, i) => ({
      account: '.claude', sessionId: `c${i}`, projectDir: 'p', project: '/proj', lastAt: 1, size: 1, open: false,
    }));
    sessions.push({ account: '.opencode', provider: 'opencode', sessionId: 'ses_live', projectDir: 'p', project: '/proj', title: 'Ao vivo', lastAt: 1, size: 0, open: false });
    const idx = new DeliveryIndex({
      sessions: async () => sessions,
      resolve: (account, sessionId) => {
        if (account === '.opencode') return { key: sessionId, stamp: 3_100, entries: async () => conversationOf(liveMessages(), '/proj') };
        return { path, createParser: createTerminalParser };
      },
      isBusy: () => false,
      isLive: (account) => account === '.opencode',
    });
    const list = await idx.list();
    const live = list.find((d) => d.sessionId === 'ses_live');
    expect(live).toMatchObject({ account: '.opencode', provider: 'opencode', agentName: 'Ao vivo' });
    expect(list.filter((d) => d.sessionId !== 'ses_live')).toHaveLength(MAX_SESSIONS);
  });

  it('cada sessão contribui com no máximo 10 entregas, as mais recentes', async () => {
    const dir = tempDir().dir;
    const many = writeTranscript(dir, 'many.jsonl', 25, 0);
    const few = writeTranscript(dir, 'few.jsonl', 2, 0);
    const idx = new DeliveryIndex({
      sessions: async () => [
        { account: '.claude', sessionId: 'many', projectDir: 'p', project: '/proj', title: 'Muitas', lastAt: 1, size: 1, open: false },
        { account: '.claude', sessionId: 'few', projectDir: 'p', project: '/proj', title: 'Poucas', lastAt: 1, size: 1, open: false },
      ],
      resolve: (_account, sessionId) => ({ path: sessionId === 'many' ? many : few, createParser: createTerminalParser }),
      isBusy: () => false,
    });
    const list = await idx.list();
    const from = (id: string) => list.filter((d) => d.sessionId === id);
    expect(from('many')).toHaveLength(MAX_PER_AGENT);
    expect(from('few')).toHaveLength(2);
    expect(from('many').map((d) => d.finishedAt)).toEqual(
      Array.from({ length: 25 }, (_, i) => Date.parse(ts(i * 60 + 2))).slice(-MAX_PER_AGENT).reverse(),
    );
  });

  it('o total não passa de 150 entregas e sai em ordem de finishedAt decrescente', async () => {
    const dir = tempDir().dir;
    const paths = new Map<string, string>();
    for (let i = 0; i < 20; i++) paths.set(`s${i}`, writeTranscript(dir, `s${i}.jsonl`, 25, i * 10));
    const idx = new DeliveryIndex({
      sessions: async () => [...paths.keys()].map((sessionId) => ({ account: '.claude', sessionId, projectDir: 'p', project: '/proj', lastAt: 1, size: 1, open: false })),
      resolve: (_account, sessionId) => ({ path: paths.get(sessionId)!, createParser: createTerminalParser }),
      isBusy: () => false,
    });
    const list = await idx.list();
    const times = list.map((d) => d.finishedAt);
    expect(list).toHaveLength(MAX_DELIVERIES);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
