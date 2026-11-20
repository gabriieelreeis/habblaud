// Fonte de agentes do OpenCode (AgentSource 'opencode', ver sources/source.ts). Desde a v2 o OpenCode roda um serviço
// em segundo plano: a TUI, o `opencode run` e o app desktop são clientes dele, e é dele (HTTP local, service.ts) que o
// Habblaud lê tudo, sem tocar no banco SQLite do OpenCode. Uma conta só ("OpenCode"), com o uso do OpenCode Go.
//
// Presença (o OpenCode não diz quais sessões estão abertas numa TUI):
// - uma sessão principal (sem `parentID`) entra quando está rodando (/api/session/active), tem um pedido pendente
//   (permissão ou pergunta) ou teve atividade nos últimos PRESENCE_MS; arquivada sai. Fica parada mais que isso, sai
//   (volta no primeiro sinal de vida);
// - uma sessão fixa (HABBLAUD_OPENCODE_PINNED: ids separados por vírgula ou espaço) fica no escritório o tempo todo
//   enquanto o serviço estiver no ar, parada ou não (como um colega fixo); arquivada, sai;
// - uma sessão filha (a ferramenta `task` cria uma por subagente) entra como subagente do pai enquanto roda e entrega
//   ao terminar.
// Status: rodando = 'working'; pedido de permissão ou pergunta pendente = 'waiting'; senão 'idle'. Os eventos ao vivo
// (SSE /api/event) mudam o status na hora; as atividades saem das mensagens da sessão, relidas (as últimas
// MESSAGE_WINDOW) logo depois de cada evento que importa. Um ciclo de releitura geral (POLL_MS, ou FALLBACK_POLL_MS
// sem o stream) corrige o que um evento perdido deixou para trás.
//
// Permissões: cada pedido pendente (a lista da sessão e o evento permission.asked) vai ao registro do escritório
// (permissions/registry.ts, registerExternal) enquanto a sessão está no escritório, e a decisão de lá volta ao serviço
// (replyPermission: once, always ou reject). Respondido na TUI ou no app, o pedido some daqui também.
//
// Boot assíncrono, com beginBoot/endBoot em par (num `finally`) e tempo-limite curto: com o serviço fora do ar a fonte
// só registra o erro (aparece em meta.sources) e tenta de novo no próximo ciclo.
import type { AccountUsage, AgentStatus, SourceInfo } from '../../../shared/types';
import { ACCOUNT_COLORS, type DetectedAccount } from '../../accounts/detect';
import type { AccountEntry, AccountsService } from '../../accounts/service';
import { errMsg, log } from '../../log';
import type { Office, TranscriptSummary } from '../../model/office';
import type { AgentSource } from '../source';
import type { ExternalRequest } from '../../permissions/registry';
import type { PermissionDecision } from '../../../shared/types';
import { parsePermission, permissionReply, permissionView, type OcPermission } from './permission';
import { conversationOf } from './terminal';
import type { TerminalEntry } from '../../../shared/types';
import { isSessionId, parseSession, parseUsageLimits, readMessages, sessionBusy, type OcSession } from './parse';
import { getJson, OpenCodeHttpError, postJson, resolveEndpoint, serviceFile, streamEvents, type FetchLike, type OpenCodeEndpoint, type OpenCodeEvent } from './service';
import { tr } from '../../../shared/i18n';

/** Sessão principal parada há mais que isto (sem rodar nem pedido pendente) sai do escritório. */
export const PRESENCE_MS = 30 * 60_000;
/** Sessões fixas (sempre no escritório com o serviço no ar), da variável HABBLAUD_OPENCODE_PINNED. */
export function pinnedSessions(env: NodeJS.ProcessEnv): Set<string> {
  return new Set((env.HABBLAUD_OPENCODE_PINNED ?? '').split(/[\s,;]+/).filter(isSessionId));
}

/** Releitura geral (sessões, quem roda, pedidos pendentes) com o stream de eventos ligado. */
export const POLL_MS = 15_000;
/** Releitura geral sem o stream (serviço fora do ar, reconectando). */
export const FALLBACK_POLL_MS = 5_000;
/** Limites de uso (OpenCode Go): releitura. */
export const LIMITS_MS = 60_000;
/** Mensagens relidas de cada sessão a cada mudança (as mais novas). */
export const MESSAGE_WINDOW = 30;
/** Mensagens lidas ao uma sessão entrar no escritório (histórico). */
const BOOT_WINDOW = 60;
/** Mensagens lidas para o terminal do Habblaud (as mais novas). */
export const CONVERSATION_WINDOW = 120;
/** Sessões listadas a cada releitura geral (as de atividade mais recente). */
const LIST_LIMIT = 60;
/** Um evento de até este tempo atrás vence a releitura geral (que pode ter saído antes dele). */
const EVENT_TRUST_MS = 5_000;
/** Espera para juntar uma rajada de eventos de uma sessão numa releitura só. */
const SESSION_DEBOUNCE_MS = 300;
const MAIN_ROLE = tr('Agente principal (OpenCode)');
const SUB_ROLE = tr('Subagente (OpenCode)');

/** Eventos que mudam o que o agente fez (relê as mensagens da sessão). */
const ACTIVITY_EVENTS = new Set([
  'session.inbox.delivered',
  'session.tool.called',
  'session.tool.success',
  'session.tool.failed',
  'session.text.ended',
  'session.step.ended',
  'session.step.failed',
  'session.compaction.started',
  'session.compaction.ended',
  'session.compaction.failed',
  'session.shell.started',
  'session.shell.ended',
  'session.skill.activated',
  'session.usage.updated',
  'session.renamed',
  'session.agent.selected',
  'session.model.selected',
]);
/** Eventos que mudam QUAIS sessões existem (relê a lista). */
const LIST_EVENTS = new Set(['session.created', 'session.archived', 'session.unarchived', 'session.deleted', 'session.moved', 'session.forked']);

/** Onde os pedidos de permissão do OpenCode aparecem (o registro do escritório). */
export interface OpenCodePermissionSink {
  /** Registra (ou acha) o pedido; undefined = não deu agora (tenta de novo na próxima mudança). */
  add(req: ExternalRequest): string | undefined;
  /** O pedido sumiu do OpenCode (respondido lá, execução encerrada, sessão fora). */
  remove(key: string): void;
}

export interface OpenCodeSourceOptions {
  accounts: AccountsService;
  office: Office;
  env?: NodeJS.ProcessEnv;
  home?: string;
  now?: () => number;
  fetch?: FetchLike;
  /** Liga o stream de eventos (padrão true; os testes desligam e chamam handleEvent). */
  stream?: boolean;
  /** Liga os timers (padrão true). */
  timers?: boolean;
}

interface Tracker {
  sid: string;
  key: string;
  info: OcSession;
  kind: 'main' | 'sub';
  inOffice: boolean;
  /** Rodando (execução aberta). */
  running: boolean;
  /** Pedidos de permissão e perguntas pendentes (ids). */
  permissions: Set<string>;
  forms: Set<string>;
  /** Os pedidos de permissão pendentes, inteiros (para o cartão do escritório). */
  permReqs: Map<string, OcPermission>;
  /** Pedidos já levados ao registro do escritório. */
  published: Set<string>;
  /** Ids das atividades já levadas ao escritório. */
  seen: Set<string>;
  /** Ids das chamadas de ferramenta vistas (o número de ferramentas usadas). */
  tools: Set<string>;
  subagents: Set<string>;
  tasks?: TranscriptSummary['tasks'];
  model?: string;
  firstAt?: number;
  lastAt?: number;
  /** Último sinal de vida (evento, mudança na sessão ou a sessão aberta numa TUI). */
  lastSignalAt: number;
  /** Quando um evento mudou `running` ou os pedidos pendentes (a releitura geral não desfaz o que é mais novo). */
  runningAt: number;
  refresh?: ReturnType<typeof setTimeout>;
  fetching?: boolean;
  again?: boolean;
  subDone: boolean;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function roleOf(agent: string | undefined): string {
  if (!agent) return SUB_ROLE;
  return `${agent[0].toUpperCase()}${agent.slice(1)}`;
}

/** Conta do OpenCode (uma só): letra "O" (ou a primeira livre), cor da paleta que as outras contas não usam. */
export function detectOpenCodeAccount(configDir: string, taken: { shorts?: Iterable<string>; colors?: Iterable<string> } = {}, extra: { plan?: string; organization?: string } = {}): DetectedAccount {
  const shorts = new Set([...(taken.shorts ?? [])].map((s) => s.toUpperCase()));
  const colors = new Set(taken.colors ?? []);
  const short = ['O', 'P', 'Q', 'N', 'K', 'J'].find((l) => !shorts.has(l)) ?? 'O';
  const color = ACCOUNT_COLORS.find((c) => !colors.has(c)) ?? ACCOUNT_COLORS[colors.size % ACCOUNT_COLORS.length];
  const acc: DetectedAccount = { id: '.opencode', provider: 'opencode', configDir, short, name: 'OpenCode', color };
  if (extra.plan) acc.plan = extra.plan;
  if (extra.organization) acc.organization = extra.organization;
  return acc;
}

export class OpenCodeSource implements AgentSource {
  readonly provider = 'opencode' as const;
  private entry: AccountEntry | undefined;
  private plan?: string;
  private workspace?: string;
  private endpoint?: OpenCodeEndpoint;
  private error?: string;
  private sessions = new Map<string, Tracker>();
  private streaming = false;
  private stopped = false;
  private abort?: AbortController;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private limitsTimer?: ReturnType<typeof setInterval>;
  private listKick?: ReturnType<typeof setTimeout>;
  private limitsKick?: ReturnType<typeof setTimeout>;
  private polling?: Promise<void>;
  private pollAgain = false;
  private readonly now: () => number;
  private readonly fetchFn: FetchLike;
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string | undefined;
  private readonly displayDir: string;
  private permissionSink?: OpenCodePermissionSink;
  private readonly pinned: Set<string>;

  constructor(private readonly opts: OpenCodeSourceOptions) {
    this.now = opts.now ?? Date.now;
    this.fetchFn = opts.fetch ?? (fetch as unknown as FetchLike);
    this.env = opts.env ?? process.env;
    this.home = opts.home;
    this.pinned = pinnedSessions(this.env);
    // No Docker, o caminho do arquivo do serviço no computador (o montado não diz nada a quem lê).
    this.displayDir = str(this.env.HABBLAUD_OPENCODE_HOST_FILE) ?? (str(this.env.HABBLAUD_OPENCODE_URL) ? 'OpenCode' : serviceFile(this.env, this.home ?? this.env.HOME ?? ''));
    this.register();
  }

  /** Registra (de novo) a conta no AccountsService; o id não muda. */
  private register(): void {
    const others = this.opts.accounts.allEntries().filter((e) => e.provider !== 'opencode');
    const detected = detectOpenCodeAccount(this.displayDir, { shorts: others.map((e) => e.detected.short), colors: others.map((e) => e.detected.color) }, { plan: this.plan, organization: this.workspace });
    this.entry = this.opts.accounts.setProviderAccounts('opencode', [{ dir: this.displayDir, detected }])[0];
  }

  /** Id da conta do OpenCode (AgentInfo.account). */
  get accountId(): string {
    return this.entry?.id ?? '.opencode';
  }

  accountEntries(): readonly AccountEntry[] {
    return this.entry ? [this.entry] : [];
  }

  async start(): Promise<void> {
    this.opts.office.beginBoot();
    try {
      await this.poll(true);
    } finally {
      this.opts.office.endBoot();
    }
    if (this.stopped) return;
    void this.refreshLimits();
    if (this.opts.timers !== false) {
      this.limitsTimer = setInterval(() => void this.refreshLimits(), LIMITS_MS);
      this.limitsTimer.unref?.();
      this.schedulePoll();
    }
    if (this.opts.stream !== false) void this.streamLoop();
  }

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.limitsTimer) clearInterval(this.limitsTimer);
    if (this.listKick) clearTimeout(this.listKick);
    if (this.limitsKick) clearTimeout(this.limitsKick);
    for (const t of this.sessions.values()) if (t.refresh) clearTimeout(t.refresh);
  }

  sources(): SourceInfo[] {
    let sessions = 0;
    for (const t of this.sessions.values()) if (t.kind === 'main' && t.inOffice) sessions++;
    const info: SourceInfo = { label: this.accountId, provider: 'opencode', path: this.endpoint?.url ?? this.displayDir, sessions, ok: !this.error };
    if (this.error) info.error = this.error;
    return [info];
  }

  transcriptPathOf(): string | undefined {
    return undefined;
  }

  /** O serviço respondeu na última tentativa (mensagens pelo escritório só com ele ao alcance). */
  isReachable(): boolean {
    return !!this.endpoint && !this.error;
  }

  /**
   * Mensagem do usuário pelo escritório: entra na fila da sessão (vira o próximo prompt quando o turno atual terminar).
   * Nunca lança.
   */
  async sendPrompt(sessionId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!isSessionId(sessionId)) return { ok: false, error: tr('sessão do OpenCode inválida') };
    const ep = this.endpoint ?? this.resolve();
    if (!ep) return { ok: false, error: this.error ?? tr('serviço do OpenCode desconhecido') };
    try {
      await postJson(this.fetchFn, ep, `/api/session/${sessionId}/prompt`, { text, delivery: 'queue' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  }

  /**
   * Conversa de um agente do OpenCode para o terminal do Habblaud (undefined = não é desta fonte): uma função que lê
   * as mensagens mais novas da sessão no serviço e devolve a conversa (lança se o serviço não respondeu).
   */
  conversation(agentId: string): { read: () => Promise<{ entries: TerminalEntry[]; truncated: boolean }> } | undefined {
    let t: Tracker | undefined;
    for (const x of this.sessions.values()) if (x.key === agentId && x.inOffice) t = x;
    if (!t) return undefined;
    const sid = t.sid;
    const cwd = t.info.directory ?? (t.info.parentId ? this.sessions.get(t.info.parentId)?.info.directory : undefined);
    return {
      read: async () => {
        if (!this.endpoint && !this.resolve()) throw new Error(this.error ?? tr('serviço do OpenCode desconhecido'));
        const msgs = await this.messages(sid, CONVERSATION_WINDOW);
        return { entries: conversationOf(msgs, cwd), truncated: msgs.length >= CONVERSATION_WINDOW };
      },
    };
  }

  /** Liga os pedidos de permissão ao registro do escritório (criado depois da fonte). */
  setPermissionSink(sink: OpenCodePermissionSink | undefined): void {
    this.permissionSink = sink;
    for (const t of this.sessions.values()) this.publishPermissions(t);
  }

  /**
   * Resposta do escritório a um pedido de permissão: `once`, `always` ou `reject` no serviço. Lança se não chegou lá
   * (o cartão mostra o erro e o pedido continua aberto).
   */
  async replyPermission(sessionId: string, requestId: string, d: PermissionDecision): Promise<void> {
    const body = permissionReply(d);
    if (!body) throw new Error(tr('resposta que o OpenCode não aceita'));
    if (!isSessionId(sessionId)) throw new Error(tr('sessão do OpenCode inválida'));
    const ep = this.endpoint ?? this.resolve();
    if (!ep) throw new Error(this.error ?? tr('serviço do OpenCode desconhecido'));
    try {
      await postJson(this.fetchFn, ep, `/api/session/${sessionId}/permission/${encodeURIComponent(requestId)}/reply`, body);
    } catch (err) {
      if (err instanceof OpenCodeHttpError && err.status === 404) throw new Error(tr('o pedido não está mais aberto no OpenCode (já foi respondido?)'));
      throw err;
    }
    const t = this.sessions.get(sessionId);
    if (!t) return;
    t.permReqs.delete(requestId);
    t.permissions.delete(requestId);
    t.published.delete(requestId);
    t.runningAt = this.now();
    this.settle(t);
  }

  /** Serviço alcançado e stream de eventos ligado (testes e /api/health). */
  isStreaming(): boolean {
    return this.streaming;
  }

  // ---------------------------------------------------------------- serviço

  private resolve(): OpenCodeEndpoint | undefined {
    const ep = resolveEndpoint(this.env, this.home);
    if ('error' in ep) {
      this.fail(ep.error);
      return undefined;
    }
    this.endpoint = ep;
    return ep;
  }

  private fail(error: string): void {
    if (this.error !== error) log.warnOnce(`opencode:${error}`, tr('OpenCode: {0}.', [error]));
    this.error = error;
  }

  private get<T = unknown>(path: string, timeoutMs?: number): Promise<T> {
    if (!this.endpoint) return Promise.reject(new Error(tr('serviço do OpenCode desconhecido')));
    return getJson(this.fetchFn, this.endpoint, path, timeoutMs) as Promise<T>;
  }

  // ---------------------------------------------------------------- releitura geral

  private schedulePoll(): void {
    if (this.stopped || this.opts.timers === false) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      void this.poll(false).finally(() => this.schedulePoll());
    }, this.streaming ? POLL_MS : FALLBACK_POLL_MS);
    this.pollTimer.unref?.();
  }

  /** Releitura geral pedida por um evento (junta uma rajada numa só). */
  private kickList(): void {
    if (this.listKick || this.stopped) return;
    this.listKick = setTimeout(() => {
      this.listKick = undefined;
      void this.poll(false);
    }, 400);
    this.listKick.unref?.();
  }

  /** Sessões, quem roda e pedidos pendentes; decide quem está no escritório. Nunca lança. */
  poll(boot = false): Promise<void> {
    if (this.polling) {
      this.pollAgain = true;
      return this.polling;
    }
    this.polling = this.doPoll(boot)
      .catch((err) => this.fail(errMsg(err)))
      .finally(() => {
        this.polling = undefined;
        if (this.pollAgain && !this.stopped) {
          this.pollAgain = false;
          void this.poll(false);
        }
      });
    return this.polling;
  }

  private async doPoll(boot: boolean): Promise<void> {
    if (!this.resolve()) {
      for (const t of [...this.sessions.values()]) this.drop(t);
      return;
    }
    const timeout = boot ? 3_000 : 8_000;
    const [list, active] = await Promise.all([
      this.get<{ data?: unknown[] }>(`/api/session?limit=${LIST_LIMIT}`, timeout),
      this.get<{ data?: Record<string, unknown> }>('/api/session/active', timeout),
    ]);
    if (this.stopped) return;
    this.error = undefined;
    const running = new Set(Object.keys(active?.data ?? {}).filter(isSessionId));
    const now = this.now();
    const seen = new Set<string>();
    const parsed = (Array.isArray(list?.data) ? list.data : []).map(parseSession).filter((s): s is OcSession => !!s);
    // Uma sessão rodando ou fixa fora das listadas (lista cortada): busca sozinha.
    for (const sid of new Set([...running, ...this.pinned])) {
      if (parsed.some((s) => s.id === sid)) continue;
      try {
        const one = parseSession((await this.get<{ data?: unknown }>(`/api/session/${sid}`, timeout))?.data);
        if (one) parsed.push(one);
      } catch {
        // some na próxima
      }
    }
    // Principais antes dos filhos: o subagente precisa do pai já no escritório.
    for (const group of [parsed.filter((s) => !s.parentId), parsed.filter((s) => s.parentId)]) {
      for (const s of group) {
        const t = this.sessions.get(s.id);
        const isRunning = running.has(s.id) || (!active?.data && sessionBusy(s));
        if (t) {
          const signal = Math.max(s.updatedAt, s.viewedAt ?? 0);
          if (signal > t.lastSignalAt) t.lastSignalAt = signal;
          t.info = s;
          // Um evento de agora há pouco vale mais que a lista (pedida antes dele).
          if (now - t.runningAt > EVENT_TRUST_MS) t.running = isRunning;
        }
        const tracker = t ?? this.newTracker(s, isRunning);
        if (!this.wanted(tracker, now)) continue;
        seen.add(s.id);
        if (!t) this.sessions.set(s.id, tracker);
        if (tracker.running || tracker.permissions.size || tracker.forms.size) await this.syncPending(tracker, timeout);
        if (this.stopped) return;
        if (!tracker.inOffice) await this.enter(tracker, boot);
        else this.settle(tracker);
      }
    }
    for (const t of [...this.sessions.values()]) if (!seen.has(t.sid)) this.drop(t);
  }

  private newTracker(s: OcSession, running: boolean): Tracker {
    return {
      sid: s.id,
      key: `${this.accountId}:${s.id}`,
      info: s,
      kind: s.parentId ? 'sub' : 'main',
      inOffice: false,
      running,
      permissions: new Set(),
      forms: new Set(),
      permReqs: new Map(),
      published: new Set(),
      seen: new Set(),
      tools: new Set(),
      subagents: new Set(),
      lastSignalAt: Math.max(s.updatedAt, s.viewedAt ?? 0),
      runningAt: 0,
      subDone: false,
    };
  }

  /** Pedidos de permissão e perguntas pendentes da sessão (um evento perdido não deixa o status errado). */
  private async syncPending(t: Tracker, timeoutMs: number): Promise<void> {
    try {
      const [perms, forms] = await Promise.all([
        this.get<{ data?: unknown[] }>(`/api/session/${t.sid}/permission`, timeoutMs),
        this.get<{ data?: unknown[] }>(`/api/session/${t.sid}/form`, timeoutMs),
      ]);
      const ids = (v: { data?: unknown[] } | undefined) =>
        new Set((Array.isArray(v?.data) ? v.data : []).map((x) => str((x as Record<string, unknown> | null)?.id)).filter((x): x is string => !!x));
      if (this.now() - t.runningAt > EVENT_TRUST_MS) {
        t.permissions = ids(perms);
        t.forms = ids(forms);
        const reqs = (Array.isArray(perms?.data) ? perms.data : []).map(parsePermission).filter((p): p is OcPermission => !!p && t.permissions.has(p.id));
        t.permReqs = new Map(reqs.map((p) => [p.id, p]));
      }
    } catch {
      // versão sem as rotas ou serviço ocupado: fica com o que os eventos disseram
    }
  }

  /** A sessão deve estar no escritório agora? */
  private wanted(t: Tracker, now: number): boolean {
    if (t.info.archivedAt !== undefined) return false;
    const pending = t.permissions.size > 0 || t.forms.size > 0;
    if (t.kind === 'sub') {
      const parent = t.info.parentId ? this.sessions.get(t.info.parentId) : undefined;
      if (!parent?.inOffice) return false;
      // Subagente só aparece trabalhando (ou esperando); depois de entregar, sai.
      return t.inOffice || t.running || pending;
    }
    if (!t.info.directory) return false;
    if (this.pinned.has(t.sid)) return true;
    return t.running || pending || now - Math.max(t.lastSignalAt, t.info.updatedAt) < PRESENCE_MS;
  }

  private status(t: Tracker): { status: AgentStatus; waitingFor?: string } {
    if (t.permissions.size) return { status: 'waiting', waitingFor: tr('aprovar uma permissão') };
    if (t.forms.size) return { status: 'waiting', waitingFor: tr('responder uma pergunta') };
    return { status: t.running ? 'working' : 'idle' };
  }

  private async enter(t: Tracker, boot: boolean): Promise<void> {
    const office = this.opts.office;
    // As mensagens primeiro (histórico, tarefas e números), depois o agente entra com tudo.
    let reading: ReturnType<typeof readMessages> | undefined;
    try {
      reading = readMessages(await this.messages(t.sid, BOOT_WINDOW, boot ? 3_000 : 8_000), t.key);
    } catch (err) {
      log.warnOnce(`opencode-msgs:${t.sid}`, tr('OpenCode: mensagens da sessão {0} ilegíveis ({1}).', [t.sid, errMsg(err)]));
    }
    if (this.stopped || this.sessions.get(t.sid) !== t || t.inOffice) return;
    const st = this.status(t);
    if (t.kind === 'main') {
      office.addMain({
        id: t.key,
        provider: 'opencode',
        account: this.accountId,
        sessionId: t.sid,
        cwd: t.info.directory!,
        role: MAIN_ROLE,
        startedAt: t.info.createdAt,
        status: st.status,
        waitingFor: st.waitingFor,
      });
      t.inOffice = office.has(t.key);
      if (!t.inOffice) return;
      office.setStatus(t.key, st.status, st.waitingFor);
    } else {
      const parent = this.sessions.get(t.info.parentId!);
      if (!parent?.inOffice) return;
      const added = office.addSub({
        id: t.key,
        parentId: parent.key,
        sessionId: t.sid,
        role: roleOf(t.info.agent),
        title: t.info.title?.replace(/\s*\(@\S+ subagent\)\s*$/, ''),
        background: false,
        startedAt: t.info.createdAt,
      });
      if (!added) return;
      t.inOffice = true;
      t.subDone = false;
      if (st.status === 'waiting') office.setStatus(t.key, 'waiting', st.waitingFor);
    }
    if (reading) this.applyReading(t, reading, false);
    this.applySummary(t);
    this.publishPermissions(t);
  }

  /** Sai do escritório: principal encerra; subagente entrega. */
  private drop(t: Tracker): void {
    if (t.refresh) clearTimeout(t.refresh);
    this.leave(t);
    this.sessions.delete(t.sid);
  }

  private leave(t: Tracker): void {
    if (!t.inOffice) return;
    if (t.kind === 'sub') {
      if (!t.subDone) this.opts.office.completeSub(t.key);
      t.subDone = true;
    } else this.opts.office.closeMain(t.key);
    t.inOffice = false;
    this.publishPermissions(t);
  }

  /**
   * Leva ao registro do escritório os pedidos de permissão pendentes da sessão (só com ela no escritório) e solta os
   * que sumiram.
   */
  private publishPermissions(t: Tracker): void {
    const sink = this.permissionSink;
    if (!sink) return;
    const live = t.inOffice ? t.permReqs : new Map<string, OcPermission>();
    for (const key of [...t.published]) {
      if (live.has(key)) continue;
      sink.remove(key);
      t.published.delete(key);
    }
    for (const [key, req] of live) {
      if (t.published.has(key)) continue;
      const cwd = t.info.directory ?? (t.info.parentId ? this.sessions.get(t.info.parentId)?.info.directory : undefined);
      const id = sink.add({ provider: 'opencode', key, agentId: t.key, view: permissionView(req, cwd), deliver: (d) => this.replyPermission(req.sessionId, key, d) });
      if (id) t.published.add(key);
    }
  }

  /** Leva o status e os pedidos de permissão ao escritório. */
  private settle(t: Tracker): void {
    this.settleStatus(t);
    this.publishPermissions(t);
  }

  /** Leva o status ao escritório (o subagente entrega ao ficar ocioso). */
  private settleStatus(t: Tracker): void {
    if (!t.inOffice) return;
    const office = this.opts.office;
    if (!office.has(t.key)) {
      t.inOffice = false;
      return;
    }
    const st = this.status(t);
    if (t.kind === 'sub' && st.status === 'idle') {
      if (!t.subDone) office.completeSub(t.key);
      t.subDone = true;
      return;
    }
    if (t.kind === 'sub' && t.subDone) {
      office.reactivateSub(t.key);
      t.subDone = office.isSubDone(t.key);
      if (t.subDone) return;
    }
    office.setStatus(t.key, st.status, st.waitingFor);
  }

  // ---------------------------------------------------------------- mensagens

  private async messages(sid: string, limit: number, timeoutMs?: number): Promise<unknown[]> {
    const r = await this.get<{ data?: unknown[] }>(`/api/session/${sid}/message?limit=${limit}&order=desc`, timeoutMs);
    return Array.isArray(r?.data) ? r.data : [];
  }

  /** Relê a sessão (dados e as mensagens mais novas) logo depois de uma rajada de eventos dela. */
  private kickSession(t: Tracker): void {
    if (t.refresh || this.stopped) return;
    t.refresh = setTimeout(() => {
      t.refresh = undefined;
      void this.refreshSession(t);
    }, SESSION_DEBOUNCE_MS);
    t.refresh.unref?.();
  }

  async refreshSession(t: Tracker): Promise<void> {
    if (t.fetching) {
      t.again = true;
      return;
    }
    t.fetching = true;
    try {
      const [info, msgs] = await Promise.all([this.get<{ data?: unknown }>(`/api/session/${t.sid}`), this.messages(t.sid, MESSAGE_WINDOW)]);
      if (this.sessions.get(t.sid) !== t) return;
      const s = parseSession(info?.data);
      if (s) t.info = s;
      if (t.inOffice) {
        this.applyReading(t, readMessages(msgs, t.key), true);
        this.applySummary(t);
      }
    } catch (err) {
      log.warnOnce(`opencode-refresh:${t.sid}:${errMsg(err)}`, tr('OpenCode: falha ao reler a sessão {0} ({1}).', [t.sid, errMsg(err)]));
    } finally {
      t.fetching = false;
      if (t.again) {
        t.again = false;
        this.kickSession(t);
      }
    }
  }

  private applyReading(t: Tracker, r: ReturnType<typeof readMessages>, live: boolean): void {
    const office = this.opts.office;
    for (const { activity } of r.activities) {
      if (t.seen.has(activity.id)) continue;
      t.seen.add(activity.id);
      if (activity.tool && !activity.id.endsWith(':e')) t.tools.add(activity.id);
      if (activity.tool === 'Agent') t.subagents.add(activity.id);
      // A mais nova vira a atual (a lista vem em ordem); na releitura ao vivo, também o texto e o "Concluiu".
      office.addActivity(t.key, activity, true, { feed: live });
    }
    if (r.tasks) t.tasks = r.tasks;
    if (r.model) t.model = r.model;
    if (r.firstAt !== undefined && (t.firstAt === undefined || r.firstAt < t.firstAt)) t.firstAt = r.firstAt;
    if (r.lastAt !== undefined && (t.lastAt === undefined || r.lastAt > t.lastAt)) t.lastAt = r.lastAt;
    // A memória dos ids não cresce sem limite numa sessão longa.
    if (t.seen.size > 4_000) t.seen = new Set([...t.seen].slice(-2_000));
  }

  private applySummary(t: Tracker): void {
    if (!t.inOffice) return;
    const s = t.info;
    const summary: TranscriptSummary = {
      tasks: t.tasks ?? [],
      stats: { toolCalls: t.tools.size, tokensIn: s.tokensIn, tokensOut: s.tokensOut, subagents: t.subagents.size },
    };
    if (s.cost > 0) summary.stats.costUSD = s.cost;
    if (s.title) summary.title = s.title;
    const model = t.model ?? s.model;
    if (model) summary.model = model;
    summary.firstAt = t.firstAt ?? s.createdAt;
    summary.lastAt = Math.max(t.lastAt ?? 0, s.updatedAt);
    this.opts.office.applyTranscript(t.key, summary);
  }

  // ---------------------------------------------------------------- eventos ao vivo

  private async streamLoop(): Promise<void> {
    let wait = 1_000;
    while (!this.stopped) {
      const ep = this.resolve();
      if (ep) {
        this.abort = new AbortController();
        try {
          await streamEvents(
            this.fetchFn,
            ep,
            (ev) => this.handleEvent(ev),
            this.abort.signal,
            () => {
              this.streaming = true;
              this.error = undefined;
              wait = 1_000;
              // Reconectou: o que aconteceu no meio é relido.
              this.kickList();
            },
          );
        } catch (err) {
          if (!this.stopped) this.fail(errMsg(err));
        }
        this.streaming = false;
      }
      if (this.stopped) return;
      await new Promise((r) => setTimeout(r, wait).unref?.());
      wait = Math.min(wait * 2, 30_000);
    }
  }

  /** Aplica um evento do serviço. Público para os testes. */
  handleEvent(ev: OpenCodeEvent): void {
    try {
      this.event(ev);
    } catch (err) {
      log.warnOnce(`opencode-event:${errMsg(err)}`, tr('OpenCode: evento ignorado ({0}).', [errMsg(err)]));
    }
  }

  private event(ev: OpenCodeEvent): void {
    const d = ev.data;
    const sid = str(d.sessionID);
    if (LIST_EVENTS.has(ev.type)) {
      this.kickList();
      return;
    }
    if (!isSessionId(sid)) return;
    const t = this.sessions.get(sid);
    const at = ev.created ?? this.now();
    if (t) t.lastSignalAt = Math.max(t.lastSignalAt, at);
    switch (ev.type) {
      case 'session.execution.started':
        if (!t) return this.kickList();
        t.running = true;
        t.runningAt = this.now();
        if (!t.inOffice) return this.kickList();
        this.settle(t);
        return;
      case 'session.execution.succeeded':
      case 'session.execution.failed':
      case 'session.execution.interrupted':
        this.kickLimits();
        if (!t) return;
        t.running = false;
        t.runningAt = this.now();
        // Uma pergunta ou permissão sem resposta morre com a execução.
        t.permissions.clear();
        t.permReqs.clear();
        t.forms.clear();
        this.settle(t);
        this.kickSession(t);
        return;
      case 'permission.asked': {
        const id = str(d.id) ?? str(d.requestID) ?? `perm:${at}`;
        if (!t) return this.kickList();
        t.permissions.add(id);
        const req = parsePermission({ ...d, sessionID: d.sessionID ?? sid });
        if (req) t.permReqs.set(req.id, req);
        t.runningAt = this.now();
        if (!t.inOffice) return this.kickList();
        this.settle(t);
        return;
      }
      case 'permission.replied': {
        if (!t) return;
        const id = str(d.requestID) ?? str(d.permissionID) ?? str(d.id);
        if (id && t.permissions.has(id)) {
          t.permissions.delete(id);
          t.permReqs.delete(id);
        } else {
          t.permissions.clear();
          t.permReqs.clear();
        }
        t.runningAt = this.now();
        this.settle(t);
        this.kickSession(t);
        return;
      }
      case 'form.created': {
        const id = str(d.id) ?? str(d.formID) ?? `form:${at}`;
        if (!t) return this.kickList();
        t.forms.add(id);
        t.runningAt = this.now();
        if (!t.inOffice) return this.kickList();
        this.settle(t);
        return;
      }
      case 'form.replied':
      case 'form.cancelled': {
        if (!t) return;
        const id = str(d.formID) ?? str(d.id);
        if (id && t.forms.has(id)) t.forms.delete(id);
        else t.forms.clear();
        t.runningAt = this.now();
        this.settle(t);
        this.kickSession(t);
        return;
      }
      default:
        if (!ACTIVITY_EVENTS.has(ev.type)) return;
        if (!t) return this.kickList();
        if (t.inOffice) this.kickSession(t);
        else this.kickList();
    }
  }

  // ---------------------------------------------------------------- uso do plano

  private kickLimits(): void {
    if (this.limitsKick || this.stopped) return;
    this.limitsKick = setTimeout(() => {
      this.limitsKick = undefined;
      void this.refreshLimits();
    }, 5_000);
    this.limitsKick.unref?.();
  }

  /** Limites de uso do workspace (OpenCode Go e orçamentos). Nunca lança. */
  async refreshLimits(): Promise<void> {
    if (!this.endpoint && !this.resolve()) return;
    let raw: unknown;
    try {
      raw = await this.get('/api/experimental/usage/limits');
    } catch (err) {
      log.warnOnce(`opencode-limits:${errMsg(err)}`, tr('OpenCode: limites de uso indisponíveis ({0}).', [errMsg(err)]));
      return;
    }
    if (this.stopped) return;
    const limits = parseUsageLimits(raw, this.now());
    this.pushUsage(limits.usage);
    if (limits.plan !== this.plan || limits.workspace !== this.workspace) {
      this.plan = limits.plan;
      this.workspace = limits.workspace;
      this.register();
    }
  }

  private pushUsage(usage: AccountUsage): void {
    this.opts.accounts.setUsage(this.accountId, usage);
  }
}
