// Troca de modelo e de esforço pela gaveta do agente (POST /api/controls).
//
// Claude Code: vira `/effort <nível>` ou `/model <modelo>` na fila de mensagens do escritório (o plugin
// habblaud-mensagens o roda com $.command.run). A confirmação é a saída do comando gravada na conversa (AgentInfo.effort
// com origem `command`, AgentInfo.modelChoice) depois do envio. Nesta versão do Claude Code o comando também grava o
// padrão das sessões novas no settings.json: sem `asDefault`, os valores de antes são guardados antes do envio e
// devolvidos depois da confirmação (claude-defaults), e só o que o comando mudou volta. Duas trocas do mesmo tipo na
// mesma conta ao mesmo tempo usam o retrato de antes da primeira.
//
// OpenCode: POST /api/session/<id>/model no serviço dele, com o nível (variant) junto; o próprio OpenCode guarda a
// escolha da sessão e ela vale para os próximos turnos. Não mexe em padrão nenhum.
import { randomBytes } from 'node:crypto';
import { tr } from '../../shared/i18n';
import type { AgentInfo, ControlDefaults, ControlKind, ControlState, ModelOption, OutboxMessage } from '../../shared/types';
import type { ClaudeDefaults } from '../claude-defaults/defaults';
import type { RestoreResult } from '../claude-defaults/service';
import { errMsg, log } from '../log';
import type { SendResult } from '../messages/registry';

export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] as const;
/** Quanto esperar a sessão rodar o comando (ela pode estar no meio de um turno longo). */
export const CONFIRM_MS = 30 * 60_000;
/** Situação resolvida fica este tempo para GET /api/controls/:id. */
export const KEEP_MS = 10 * 60_000;
const SLACK_MS = 2_000;
const CLAUDE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,98}(?:\[[A-Za-z0-9]{1,8}\])?$/;
const OPENCODE_MODEL = /^[A-Za-z0-9._-]{1,60}\/[A-Za-z0-9._:/@+-]{1,160}$/;
const VARIANT = /^[A-Za-z0-9._-]{1,24}$/;

export class InvalidControl extends Error {}

export interface ControlRequest {
  agentId: string;
  kind: ControlKind;
  value: string;
  variant?: string;
  asDefault: boolean;
}

type Rec = Record<string, unknown>;

/** Corpo de POST /api/controls: `{agentId, kind, value, variant?, asDefault?}`. Lança InvalidControl. */
export function parseControl(raw: unknown): ControlRequest {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Rec) : undefined;
  const agentId = typeof r?.agentId === 'string' && r.agentId.length <= 300 ? r.agentId : '';
  const kind = r?.kind === 'effort' || r?.kind === 'model' ? r.kind : undefined;
  const value = typeof r?.value === 'string' ? r.value.trim() : '';
  if (!r || !agentId || !kind || !value || value.length > 220) throw new InvalidControl('esperado {agentId, kind: "effort" | "model", value, variant?, asDefault?}');
  if (r.variant !== undefined && (typeof r.variant !== 'string' || (r.variant !== '' && !VARIANT.test(r.variant)))) throw new InvalidControl(tr('nível de raciocínio inválido'));
  if (r.asDefault !== undefined && typeof r.asDefault !== 'boolean') throw new InvalidControl(tr('"asDefault" precisa ser verdadeiro ou falso'));
  const out: ControlRequest = { agentId, kind, value, asDefault: r.asDefault === true };
  if (typeof r.variant === 'string' && r.variant) out.variant = r.variant;
  return out;
}

/** O comando de barra da troca no Claude Code (undefined = valor inválido). */
export function claudeCommand(kind: ControlKind, value: string): string | undefined {
  if (kind === 'effort') return (CLAUDE_EFFORTS as readonly string[]).includes(value) ? `/effort ${value}` : undefined;
  return CLAUDE_MODEL.test(value) ? `/model ${value}` : undefined;
}

export interface ControlsOptions {
  agent: (id: string) => AgentInfo | undefined;
  /** Põe o texto na fila de mensagens do agente (MessageRegistry.send). */
  send: (agentId: string, text: string) => SendResult;
  message: (id: string) => OutboxMessage | undefined;
  /** Padrões do Claude Code (ausente = não dá para trocar só na sessão). */
  defaults?: {
    snapshot(account: string): Promise<ClaudeDefaults | { error: string }>;
    restore(account: string, before: ClaudeDefaults, kind: ControlKind, sent: string): Promise<RestoreResult>;
  };
  opencode?: {
    available(): boolean;
    selectModel(sessionId: string, model: string, variant?: string): Promise<{ ok: true } | { ok: false; error: string }>;
    models(): Promise<ModelOption[]>;
  };
  now?: () => number;
  tickMs?: number;
  confirmMs?: number;
}

export type ControlResult = { control: ControlState } | { error: string; status: number };

interface Entry {
  state: ControlState;
  account: string;
  messageId?: string;
  before?: ClaudeDefaults;
  sentAt: number;
  restoring?: boolean;
}

const settled = (s: ControlState) => s.status === 'confirmed' || s.status === 'failed';

export class ControlRegistry {
  private readonly entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private readonly now: () => number;

  constructor(private readonly opts: ControlsOptions) {
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (err) {
        log.warnOnce(`controls-tick:${errMsg(err)}`, tr('Trocas de modelo: falha no relógio ({0}).', [errMsg(err)]));
      }
    }, this.opts.tickMs ?? 500);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get(id: string): ControlState | undefined {
    const e = this.entries.get(id);
    return e ? { ...e.state } : undefined;
  }

  /** Modelos que dá para escolher para o agente (só OpenCode; o Claude Code usa os apelidos fixos da página). */
  async models(agentId: string): Promise<{ models: ModelOption[] } | { error: string; status: number }> {
    const a = this.opts.agent(agentId);
    if (!a) return { error: tr('agente não encontrado'), status: 404 };
    if (a.provider !== 'opencode') return { models: [] };
    const oc = this.opts.opencode;
    if (!oc?.available()) return { error: tr('o serviço do OpenCode não está ao alcance agora'), status: 409 };
    try {
      return { models: await oc.models() };
    } catch (err) {
      return { error: tr('o OpenCode não devolveu a lista de modelos ({0})', [errMsg(err)]), status: 502 };
    }
  }

  async create(raw: unknown): Promise<ControlResult> {
    const req = parseControl(raw);
    const a = this.opts.agent(req.agentId);
    if (!a || a.status === 'offline' || a.status === 'done') return { error: tr('agente desconhecido: ele já saiu do escritório?'), status: 404 };
    if (a.kind !== 'main') return { error: tr('só o agente principal troca de modelo ou esforço'), status: 409 };
    const provider = a.provider ?? 'claude';
    if (provider === 'opencode') return this.openCode(a, req);
    if (provider !== 'claude') return { error: tr('modelo e esforço só mudam por aqui em sessões do Claude Code e do OpenCode'), status: 409 };
    return this.claude(a, req);
  }

  /** Relógio: entrega, confirmação pela conversa, restauração do padrão, prazo e limpeza. */
  tick(): void {
    const now = this.now();
    for (const [id, e] of this.entries) {
      const s = e.state;
      if (e.restoring) continue;
      // Falhou a entrega mas o padrão ainda está guardado: a sessão pode rodar o comando atrasada.
      if (settled(s) && !(s.status === 'failed' && s.defaults === 'pending')) {
        if (now - s.updatedAt >= KEEP_MS) this.entries.delete(id);
        continue;
      }
      const a = this.opts.agent(s.agentId);
      if (a && this.confirmed(e, a)) {
        this.update(e, { status: 'confirmed', error: undefined });
        if (e.before) this.restore(e);
        continue;
      }
      const m = e.messageId ? this.opts.message(e.messageId) : undefined;
      if (s.status === 'sending' && m?.status === 'delivered') this.update(e, { status: 'waiting' });
      else if (s.status !== 'failed' && m?.status === 'failed') this.update(e, { status: 'failed', error: m.error ?? tr('a sessão não recebeu o comando') });
      if (now - e.sentAt >= (this.opts.confirmMs ?? CONFIRM_MS)) {
        if (s.status !== 'failed') this.update(e, { status: 'failed', error: tr('a sessão não rodou o comando a tempo') });
        if (s.defaults === 'pending') this.update(e, { defaults: 'unchanged' });
      }
    }
  }

  // ---------------------------------------------------------------- internos

  private async claude(a: AgentInfo, req: ControlRequest): Promise<ControlResult> {
    const text = claudeCommand(req.kind, req.value);
    if (!text) return { error: req.kind === 'effort' ? tr('nível de esforço inválido') : tr('modelo inválido'), status: 400 };
    let before: ClaudeDefaults | undefined;
    if (!req.asDefault) {
      before = this.pendingBefore(a.account, req.kind);
      if (!before) {
        const snap = this.opts.defaults ? await this.opts.defaults.snapshot(a.account) : { error: tr('o padrão das sessões novas não está ao alcance daqui') };
        if ('error' in snap) {
          return { error: tr('não deu para guardar o padrão das sessões novas antes da troca ({0}); marque "Também como padrão das sessões novas" para trocar assim mesmo', [snap.error]), status: 409 };
        }
        before = snap;
      }
    }
    const r = this.opts.send(a.id, text);
    if ('error' in r) {
      if (r.error === 'unavailable') return { error: r.reason, status: 409 };
      if (r.error === 'not-found') return { error: tr('agente desconhecido: ele já saiu do escritório?'), status: 404 };
      return { error: tr('mensagens demais esperando a entrega para este agente: espere a sessão buscar'), status: 429 };
    }
    const now = this.now();
    const e: Entry = {
      state: { id: this.nextId(now), agentId: a.id, kind: req.kind, value: req.value, status: 'sending', defaults: before ? 'pending' : 'saved', createdAt: now, updatedAt: now },
      account: a.account,
      messageId: r.message.id,
      sentAt: now,
    };
    if (before) e.before = before;
    this.entries.set(e.state.id, e);
    return { control: { ...e.state } };
  }

  private async openCode(a: AgentInfo, req: ControlRequest): Promise<ControlResult> {
    const oc = this.opts.opencode;
    if (!oc?.available()) return { error: tr('o serviço do OpenCode não está ao alcance agora (abra o OpenCode ou rode opencode service start)'), status: 409 };
    const model = req.kind === 'model' ? req.value : (a.modelChoice?.label ?? a.model);
    const variant = req.kind === 'effort' ? req.value : req.variant;
    if (!model || !OPENCODE_MODEL.test(model)) return { error: tr('modelo inválido'), status: 400 };
    if (variant !== undefined && !VARIANT.test(variant)) return { error: tr('nível de raciocínio inválido'), status: 400 };
    const r = await oc.selectModel(a.sessionId, model, variant);
    const now = this.now();
    const state: ControlState = {
      id: this.nextId(now),
      agentId: a.id,
      kind: req.kind,
      value: model,
      status: r.ok ? 'confirmed' : 'failed',
      createdAt: now,
      updatedAt: now,
    };
    if (variant) state.variant = variant;
    if (!r.ok) state.error = r.error;
    this.entries.set(state.id, { state, account: a.account, sentAt: now });
    return r.ok ? { control: { ...state } } : { error: r.error, status: 502 };
  }

  /** A sessão rodou o comando depois do envio: a saída dele está na conversa. */
  private confirmed(e: Entry, a: AgentInfo): boolean {
    const since = e.sentAt - SLACK_MS;
    if (e.state.kind === 'effort') return a.effort?.source === 'command' && (a.effort.at ?? 0) >= since;
    return !!a.modelChoice && a.modelChoice.at >= since;
  }

  /** Retrato do padrão guardado por outra troca do mesmo tipo na conta que ainda não devolveu o padrão. */
  private pendingBefore(account: string, kind: ControlKind): ClaudeDefaults | undefined {
    for (const e of this.entries.values()) if (e.account === account && e.state.kind === kind && e.before && e.state.defaults === 'pending') return e.before;
    return undefined;
  }

  private restore(e: Entry): void {
    const d = this.opts.defaults;
    if (!d || !e.before) return;
    e.restoring = true;
    void d
      .restore(e.account, e.before, e.state.kind, e.state.value)
      .then((r) => {
        const defaults: ControlDefaults = typeof r === 'string' ? r : 'restore-failed';
        this.update(e, typeof r === 'string' ? { defaults } : { defaults, error: tr('não deu para devolver o padrão das sessões novas: {0}', [r.error]) });
      })
      .finally(() => {
        e.restoring = false;
      });
  }

  private update(e: Entry, patch: Partial<ControlState>): void {
    for (const [k, v] of Object.entries(patch) as Array<[keyof ControlState, unknown]>) {
      if (v === undefined) delete e.state[k];
      else (e.state as unknown as Rec)[k] = v;
    }
    e.state.updatedAt = this.now();
  }

  private nextId(now: number): string {
    return `c-${now.toString(36)}-${++this.seq}-${randomBytes(6).toString('base64url')}`;
  }
}
