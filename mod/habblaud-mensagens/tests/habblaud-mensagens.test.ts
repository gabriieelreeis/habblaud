// Testes do plugin de mensagens, rodados pelo próprio Claude Code: `claude plugin test` dentro de
// mod/habblaud-mensagens (sem sessão, sem login, sem rede). Os stubs respondem no lugar do Claude Code e do
// Habblaud: env, relógio (mock.clock), $.session.id, $.session.surfaces, $.http.fetch (as duas rotas do
// servidor), o prompt.submit de baixo (a sessão: aceita, um hook recusa, a chamada lança ou fica presa) e o
// command.run (o comando de barra com nome e argumentos).
import type { HttpResponse, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { accountIdOf, ackBody, configDirOf, inboxBody, MAX_REASON, normalizePath, parseInbox, portOf, promptArgsOf, reasonText, slashCommandOf, type InboxMessage } from '../hooks/register'

const NOW = Date.parse('2026-10-09T12:00:00Z')
const PORT = '4850'
const INBOX_URL = `http://127.0.0.1:${PORT}/api/mod/inbox`
const ACK_URL = `${INBOX_URL}/ack`
const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' }

/** Resposta do Habblaud ao inbox: mensagens, 'offline' (conexão recusada), 'hang' (não responde) ou um HTTP cru. */
type Answer = InboxMessage[] | 'offline' | 'hang' | { status: number; text: string }
/** O que a sessão faz com um prompt: entra, um hook recusa, a chamada lança, ou fica presa (sessão ocupada). */
type Fate = 'ok' | 'drop' | 'throw' | 'hang'

interface World {
  env?: Record<string, string>
  surfaces?: ReadonlyArray<'terminal' | 'desktop'>
  /** Padrão: nenhuma mensagem. */
  inbox?: () => Answer
  /** Padrão: o ack responde 200. */
  ack?: () => 'ok' | 'offline' | 'hang'
  /** Padrão: 'ok'. */
  fate?: (text: string) => Fate
}

interface Sent {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

function response(status: number, text: string): HttpResponse {
  return { status, ok: status >= 200 && status < 300, headers: { 'content-type': 'application/json' }, text }
}

/** Uma fila de respostas: cada pergunta leva a próxima; acabou, nenhuma mensagem. */
function batches(...list: Answer[]): () => Answer {
  return () => list.shift() ?? []
}

/** Registra todos os stubs (antes da primeira chamada em $, como o kit exige) e devolve o que foi capturado. */
function world(on: On, w: World = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, w.env ?? { HOME: '/home/fulano', CLAUDE_CONFIG_DIR: '~/.claude-conta2', HABBLAUD_PORT: PORT })
  const sent: Sent[] = []
  const submits: Array<{ text: string; origin: unknown }> = []
  const commands: Array<{ command: string; args: string }> = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.surfaces', () => ({ value: w.surfaces ?? ['terminal'] }))
  on('http.fetch', async ($, e) => {
    const raw = e.init?.body
    const body = typeof raw === 'string' ? raw : undefined
    sent.push({ url: e.url, method: e.init?.method, headers: e.init?.headers, body: body === undefined ? undefined : JSON.parse(body) })
    if (e.url.endsWith('/ack')) {
      const a = w.ack ? w.ack() : 'ok'
      if (a === 'offline') return { deny: 'connect ECONNREFUSED 127.0.0.1:4850' }
      if (a === 'hang') {
        await clock.sleep(60_000)
        return { deny: 'tarde demais' }
      }
      return { value: response(200, '{"ok":true}') }
    }
    const a = w.inbox ? w.inbox() : []
    if (a === 'offline') return { deny: 'connect ECONNREFUSED 127.0.0.1:4850' }
    if (a === 'hang') {
      await clock.sleep(60_000)
      return { deny: 'tarde demais' }
    }
    return { value: Array.isArray(a) ? response(200, JSON.stringify({ messages: a })) : response(a.status, a.text) }
  })
  on('prompt.submit', async ($, e) => {
    submits.push({ text: e.text, origin: e.origin })
    const fate = w.fate ? w.fate(e.text) : 'ok'
    if (fate === 'drop') return { drop: `recusada por um hook: ${e.text}` }
    if (fate === 'throw') throw new Error('a sessão\nfechou')
    if (fate === 'hang') await clock.sleep(60_000)
    return { text: e.text }
  })
  on('command.run', async ($, e) => {
    commands.push({ command: e.command, args: e.args })
    return {}
  })
  return {
    clock,
    sent,
    submits,
    commands,
    inboxes: () => sent.filter((s) => s.url === INBOX_URL),
    acks: () => sent.filter((s) => s.url === ACK_URL),
    texts: () => submits.map((s) => s.text),
  }
}

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

describe('rodadas', () => {
  test('a cada 2 s pergunta ao Habblaud (marca a presença); sem mensagens, nada vai para a sessão e não há ack', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.sent).toEqual([])
    await w.clock.advance(2_000)
    expect(w.sent).toEqual([{ url: INBOX_URL, method: 'POST', headers: JSON_HEADERS, body: { session: 'sess-1', account: '.claude-conta2' } }])
    await w.clock.advance(4_000)
    expect(w.inboxes().length).toBe(3)
    expect(w.acks()).toEqual([])
    expect(w.submits).toEqual([])
  })

  test('entrega na ordem, como se você tivesse digitado (texto intacto), e confirma tudo num POST só', async ($, on) => {
    const typed = '  e depois:\n- abre o PR\n\n(sem pressa)  '
    const w = world(on, { inbox: batches([{ id: 'm1', text: 'roda os testes' }, { id: 'm2', text: typed }]) })
    await $.session.start(START)
    await w.clock.advance(2_000)
    expect(w.texts()).toEqual(['roda os testes', typed])
    expect(w.submits[0]?.origin).toEqual({ kind: 'plugin', name: 'habblaud-mensagens', asUser: true })
    expect(w.acks()).toEqual([{ url: ACK_URL, method: 'POST', headers: JSON_HEADERS, body: { session: 'sess-1', results: [{ id: 'm1', ok: true }, { id: 'm2', ok: true }] } }])
    await w.clock.advance(2_000)
    expect(w.sent.map((s) => s.url)).toEqual([INBOX_URL, ACK_URL, INBOX_URL])
    expect(w.submits.length).toBe(2)
  })

  test('comando de barra entra por $.command.run (o Claude recusa / no prompt.submit), com os argumentos intactos', async ($, on) => {
    const w = world(on, {
      inbox: batches([
        { id: 'c1', text: '/effort high' },
        { id: 'c2', text: '/model  opus  ' },
        { id: 'c3', text: 'texto normal' },
        { id: 'c4', text: '/compact' },
      ]),
    })
    await $.session.start(START)
    await w.clock.advance(2_000)
    expect(w.commands).toEqual([
      { command: 'effort', args: 'high' },
      { command: 'model', args: 'opus  ' },
      { command: 'compact', args: '' },
    ])
    expect(w.texts()).toEqual(['texto normal'])
    expect(w.acks()[0]?.body).toEqual({
      session: 'sess-1',
      results: [
        { id: 'c1', ok: true },
        { id: 'c2', ok: true },
        { id: 'c3', ok: true },
        { id: 'c4', ok: true },
      ],
    })
  })

  test('sendNow entra no turno em andamento; sem a flag entra na fila; comando de barra segue por $.command.run', async ($, on) => {
    const w = world(on, {
      inbox: batches([
        { id: 'n1', text: 'responde agora', sendNow: true },
        { id: 'n2', text: 'pode esperar' },
        { id: 'n3', text: '/effort high', sendNow: true },
      ]),
    })
    await $.session.start(START)
    await w.clock.advance(2_000)
    const origin = { kind: 'plugin', name: 'habblaud-mensagens', asUser: true }
    expect(w.submits).toEqual([
      { text: 'responde agora', origin },
      { text: 'pode esperar', origin },
    ])
    expect(w.commands).toEqual([{ command: 'effort', args: 'high' }])
    expect(w.acks()[0]?.body).toEqual({
      session: 'sess-1',
      results: [{ id: 'n1', ok: true }, { id: 'n2', ok: true }, { id: 'n3', ok: true }],
    })
  })

  test('recusa de um hook e exceção viram falha com o motivo; sem texto, falha sem ir para a sessão', async ($, on) => {
    const raw = JSON.stringify({
      messages: [
        { id: 'a', text: 'pode ir' },
        { id: 'b', text: 'proibida' },
        { id: 'c', text: 'quebra' },
        { id: 'd', text: '  \n ' },
        { id: 'e', text: 42 },
        // sem id: não há como confirmar, fica de fora
        { text: 'órfã' },
      ],
    })
    const w = world(on, {
      inbox: batches({ status: 200, text: raw }),
      fate: (t) => (t === 'proibida' ? 'drop' : t === 'quebra' ? 'throw' : 'ok'),
    })
    await $.session.start(START)
    await w.clock.advance(2_000)
    expect(w.texts()).toEqual(['pode ir', 'proibida', 'quebra'])
    expect(w.acks()[0]?.body).toEqual({
      session: 'sess-1',
      results: [
        { id: 'a', ok: true },
        { id: 'b', ok: false, error: 'recusada por um hook: proibida' },
        // O hook de baixo que lança é pulado e, sem nada embaixo dele, a chamada rejeita: o motivo é o do kit.
        { id: 'c', ok: false, error: expect.stringMatching(/\S/) },
        { id: 'd', ok: false, error: 'mensagem vazia' },
        { id: 'e', ok: false, error: 'mensagem vazia' },
      ],
    })
  })

  test('sessão ocupada: passou de 2 s, conta como entregue e as seguintes vão em seguida, na ordem; as rodadas seguem', async ($, on) => {
    const w = world(on, {
      inbox: batches([
        { id: 'm1', text: 'primeira' },
        { id: 'm2', text: 'segunda' },
        { id: 'm3', text: 'terceira' },
      ]),
      fate: (t) => (t === 'primeira' ? 'hang' : 'ok'),
    })
    await $.session.start(START)
    await w.clock.advance(2_000)
    expect(w.texts()).toEqual(['primeira'])
    expect(w.acks()).toEqual([])
    await w.clock.advance(2_000)
    expect(w.texts()).toEqual(['primeira', 'segunda', 'terceira'])
    expect(w.acks().map((a) => a.body)).toEqual([
      {
        session: 'sess-1',
        results: [
          { id: 'm1', ok: true },
          { id: 'm2', ok: true },
          { id: 'm3', ok: true },
        ],
      },
    ])
    const asked = w.inboxes().length
    await w.clock.advance(2_000)
    expect(w.inboxes().length).toBeGreaterThan(asked)
  })

  test('uma rodada por vez: com a sessão ocupada e o ack travado, a pergunta do meio é pulada', async ($, on) => {
    const w = world(on, { inbox: batches([{ id: 'm1', text: 'primeira' }]), fate: () => 'hang', ack: () => 'hang' })
    await $.session.start(START)
    await w.clock.advance(2_000)
    // A rodada vai de 2 s (pergunta) a 4 s (prazo do submit) e daí a 6 s (prazo do ack): a de 4 s não começa.
    await w.clock.advance(3_000)
    expect(w.inboxes().length).toBe(1)
    expect(w.acks().length).toBe(1)
    await w.clock.advance(3_000)
    expect(w.inboxes().length).toBeGreaterThan(1)
    expect(w.texts()).toEqual(['primeira'])
  })

  test('ack que falha = silêncio: as rodadas seguem', async ($, on) => {
    const w = world(on, { inbox: batches([{ id: 'm1', text: 'oi' }]), ack: () => 'offline' })
    await $.session.start(START)
    await w.clock.advance(2_000)
    expect(w.acks().length).toBe(1)
    await w.clock.advance(2_000)
    expect(w.inboxes().length).toBe(2)
    expect(w.texts()).toEqual(['oi'])
  })

  test('Habblaud fora do ar, 403 (mensagens desligadas) ou 404 (versão sem a rota): recua para 30 s até voltar', async ($, on) => {
    let answer: Answer = 'offline'
    const w = world(on, { inbox: () => answer })
    await $.session.start(START)
    await w.clock.advance(2_000)
    expect(w.inboxes().length).toBe(1)
    await w.clock.advance(28_000)
    expect(w.inboxes().length).toBe(1)
    answer = { status: 403, text: '{"error":"mensagens pelo escritório desligadas"}' }
    await w.clock.advance(2_000)
    expect(w.inboxes().length).toBe(2)
    answer = { status: 404, text: '{"error":"rota desconhecida"}' }
    await w.clock.advance(30_000)
    expect(w.inboxes().length).toBe(3)
    answer = []
    await w.clock.advance(30_000)
    expect(w.inboxes().length).toBe(4)
    await w.clock.advance(2_000)
    expect(w.inboxes().length).toBe(5)
    expect(w.acks()).toEqual([])
  })

  test('Habblaud travado: desiste em 2 s e recua para 30 s', async ($, on) => {
    let hang = true
    const w = world(on, { inbox: () => (hang ? 'hang' : []) })
    await $.session.start(START)
    await w.clock.advance(2_000)
    expect(w.inboxes().length).toBe(1)
    await w.clock.advance(31_000)
    expect(w.inboxes().length).toBe(1)
    hang = false
    await w.clock.advance(1_000)
    expect(w.inboxes().length).toBe(2)
  })

  test('sessão sem superfície (claude -p, SDK): nem pergunta ao Habblaud', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    await w.clock.advance(10_000)
    expect(w.sent).toEqual([])
  })

  test('sessão do app desktop fora da tela (SDK sem superfície): pergunta mesmo assim', async ($, on) => {
    const w = world(on, { surfaces: [], env: { HOME: '/home/fulano', CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HABBLAUD_PORT: PORT } })
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    await w.clock.advance(2_000)
    expect(w.inboxes().length).toBe(1)
  })

  test('sem HOME nem CLAUDE_CONFIG_DIR: pergunta sem a conta, na porta padrão', async ($, on) => {
    const w = world(on, { env: {} })
    await $.session.start(START)
    await w.clock.advance(2_000)
    expect(w.sent).toEqual([{ url: 'http://127.0.0.1:4747/api/mod/inbox', method: 'POST', headers: JSON_HEADERS, body: { session: 'sess-1' } }])
  })
})

describe('funções puras', () => {
  test('inbox: formato estranho = fora do ar; item sem id fica de fora; sem texto vira texto vazio', () => {
    expect(parseInbox('<html>')).toBeUndefined()
    expect(parseInbox('[]')).toBeUndefined()
    expect(parseInbox('{"messages":{}}')).toBeUndefined()
    expect(parseInbox('{"messages":[]}')).toEqual([])
    expect(parseInbox(JSON.stringify({ messages: [{ id: 'a', text: ' x\n' }, { id: '', text: 'y' }, { text: 'z' }, null, { id: 'b' }] }))).toEqual([
      { id: 'a', text: ' x\n' },
      { id: 'b', text: '' },
    ])
    expect(parseInbox(JSON.stringify({ messages: [{ id: 'n', text: 'oi', sendNow: true }, { id: 'f', text: 'oi', sendNow: false }, { id: 'x', text: 'oi', sendNow: 'sim' }] }))).toEqual([
      { id: 'n', text: 'oi', sendNow: true },
      { id: 'f', text: 'oi' },
      { id: 'x', text: 'oi' },
    ])
  })

  test('corpos das duas rotas', () => {
    expect(JSON.parse(inboxBody('s', '.claude'))).toEqual({ session: 's', account: '.claude' })
    expect(JSON.parse(inboxBody('s', undefined))).toEqual({ session: 's' })
    expect(JSON.parse(ackBody('s', [{ id: 'a', ok: true }, { id: 'b', ok: false, error: 'não' }]))).toEqual({
      session: 's',
      results: [
        { id: 'a', ok: true },
        { id: 'b', ok: false, error: 'não' },
      ],
    })
  })

  test('motivo da falha: uma linha, tamanho limitado, e o padrão quando não há texto', () => {
    expect(reasonText('um\nhook\t recusou ', 'padrão')).toBe('um hook recusou')
    expect(reasonText(new Error('boom'), 'padrão')).toBe('boom')
    expect(reasonText({ message: 'de outro mundo' }, 'padrão')).toBe('de outro mundo')
    expect(reasonText('   ', 'padrão')).toBe('padrão')
    expect(reasonText(undefined, 'padrão')).toBe('padrão')
    const long = reasonText('x'.repeat(2_000), 'padrão')
    expect(long.length).toBe(MAX_REASON)
    expect(long.endsWith('…')).toBe(true)
  })

  test('argumentos do prompt: sendNow pede o turno em andamento; sem ele, entra na fila', () => {
    expect(promptArgsOf('oi', false)).toEqual({ text: 'oi', asUser: true })
    expect(promptArgsOf('oi', true)).toEqual({ text: 'oi', asUser: true, wait: false })
  })

  test('comando de barra: nome e argumentos, sem confundir texto comum', () => {
    expect(slashCommandOf('/effort high')).toEqual({ command: 'effort', args: 'high' })
    expect(slashCommandOf('/model  opus max')).toEqual({ command: 'model', args: 'opus max' })
    expect(slashCommandOf('/compact')).toEqual({ command: 'compact', args: '' })
    expect(slashCommandOf('/effort\nhigh')).toEqual({ command: 'effort', args: 'high' })
    expect(slashCommandOf(' /effort')).toBeUndefined()
    expect(slashCommandOf('c:/Users')).toBeUndefined()
    expect(slashCommandOf('/')).toBeUndefined()
  })

  test('conta e porta como o mod habblaud calcula (também no Windows)', () => {
    expect(normalizePath('/a//b/./c/../d/')).toBe('/a/b/d')
    expect(configDirOf(' ~/.claude-conta2 , /x', '/home/f')).toBe('/home/f/.claude-conta2')
    expect(configDirOf(undefined, '/home/f/')).toBe('/home/f/.claude')
    expect(configDirOf('', undefined)).toBeUndefined()
    expect(configDirOf('C:\\Users\\f\\.claude-conta2\\', undefined)).toBe('C:/Users/f/.claude-conta2')
    expect(accountIdOf('C:/Users/f/.claude-conta2')).toBe('.claude-conta2')
    expect(accountIdOf('/')).toBeUndefined()
    expect(portOf('4850')).toBe(4850)
    expect(portOf('0')).toBe(4747)
    expect(portOf('abc')).toBe(4747)
    expect(portOf(undefined)).toBe(4747)
  })
})
