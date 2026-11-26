// Padrões do Claude Code (settings.json) e opções de abertura das sessões em segundo plano (jobs/<id>/state.json) para
// o escritório. No modo Node o servidor lê e grava direto; no Docker essas pastas não são montadas e quem faz é o
// auxiliar do host (npm run codex:bridge): POST /api/host/claude/poll entrega os pedidos e /api/host/claude/ack devolve
// o resultado. Só sai daqui o que defaults.ts escolhe (modelo e esforço), nunca o arquivo.
import { randomUUID } from 'node:crypto';
import { tr } from '../../shared/i18n';
import type { ControlKind } from '../../shared/types';
import { HostWait, pollWithWait } from '../host-wait';
import { isJobId, pickDefaults, readDefaultsFile, readJobFlags, restoreDefaultsFile, type ClaudeDefaults, type JobFlags } from './defaults';

export const HOST_PRESENCE_MS = 10_000;
export const HOST_TIMEOUT_MS = 15_000;
export const REFRESH_MS = 15_000;
const MAX_JOBS_PER_READ = 64;

export interface DefaultsAccount {
  id: string;
  /** Pasta da conta no computador (a que o auxiliar do host abre). */
  configDir: string;
  /** Pasta da conta lida por este processo (no Docker, a montada). */
  dir: string;
}

export type HostRequest =
  | { id: string; op: 'read'; configDir: string; jobs: string[] }
  | { id: string; op: 'restore'; configDir: string; kind: ControlKind; sent: string; before: ClaudeDefaults };

export type RestoreResult = 'restored' | 'unchanged' | { error: string };

interface Pending {
  req: HostRequest;
  account: string;
  sent: boolean;
  done: (r: { ok: true; value: Record<string, unknown> } | { ok: false; error: string }) => void;
}

export interface ClaudeDefaultsOptions {
  /** Modo Node: lê e grava direto no disco. */
  direct: boolean;
  accounts: () => DefaultsAccount[];
  now?: () => number;
  refreshMs?: number;
  hostTimeoutMs?: number;
}

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

/** Padrões vindos do auxiliar (o mesmo formato de ClaudeDefaults), conferidos campo a campo. */
export function parseDefaults(raw: unknown): ClaudeDefaults | undefined {
  const r = rec(raw);
  if (!r) return undefined;
  const modelSettings: Rec = {};
  for (const [id, level] of Object.entries(rec(r.modelEffort) ?? {})) modelSettings[id] = { effortLevel: level };
  return pickDefaults({ model: r.model, effortLevel: r.effortLevel, modelSettings });
}

function parseFlags(raw: unknown): JobFlags | undefined {
  const r = rec(raw);
  if (!r) return undefined;
  const out: JobFlags = {};
  if (typeof r.effort === 'string' && /^[a-z][a-z0-9-]{1,15}$/.test(r.effort)) out.effort = r.effort;
  if (typeof r.model === 'string' && r.model.trim() && r.model.length <= 120) out.model = r.model.trim();
  return out;
}

export class ClaudeDefaultsService {
  private readonly defaults = new Map<string, ClaudeDefaults>();
  private readonly flags = new Map<string, JobFlags>();
  private readonly jobs = new Map<string, Set<string>>();
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<string, Pending>();
  private readonly host: HostWait;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: ClaudeDefaultsOptions) {
    this.now = opts.now ?? Date.now;
    this.host = new HostWait(HOST_PRESENCE_MS, this.now);
  }

  start(): void {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.opts.refreshMs ?? REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Avisado quando um padrão ou uma opção de abertura muda. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  defaultsOf(account: string): ClaudeDefaults | undefined {
    return this.defaults.get(account);
  }

  flagsOf(account: string, jobId: string | undefined): JobFlags | undefined {
    return jobId ? this.flags.get(`${account}|${jobId}`) : undefined;
  }

  /** Sessões em segundo plano abertas agora numa conta (as opções de abertura delas são lidas). */
  wantJobs(account: string, jobIds: readonly string[]): void {
    const next = new Set(jobIds.filter(isJobId).slice(0, MAX_JOBS_PER_READ));
    const prev = this.jobs.get(account);
    this.jobs.set(account, next);
    for (const key of [...this.flags.keys()]) if (key.startsWith(`${account}|`) && !next.has(key.slice(account.length + 1))) this.flags.delete(key);
    if ([...next].some((j) => !prev?.has(j))) this.refreshAccount(account);
  }

  hostAvailable(): boolean {
    return this.host.present();
  }

  /** Relê os padrões e as opções de abertura de todas as contas. */
  refresh(): void {
    for (const a of this.opts.accounts()) this.refreshAccount(a.id);
  }

  /** Os padrões de agora, lidos na hora (antes de mandar um /effort ou /model). */
  async snapshot(account: string): Promise<ClaudeDefaults | { error: string }> {
    const acc = this.account(account);
    if (!acc) return { error: tr('conta do Claude Code desconhecida') };
    if (this.opts.direct) {
      const d = readDefaultsFile(acc.dir);
      if (!('error' in d)) this.setDefaults(account, d);
      return d;
    }
    const r = await this.ask(account, { id: randomUUID(), op: 'read', configDir: acc.configDir, jobs: [...(this.jobs.get(account) ?? [])] });
    if (!r.ok) return { error: r.error };
    const d = this.applyRead(account, r.value);
    return d ?? { error: tr('o computador não devolveu o settings.json') };
  }

  /** Devolve ao settings.json o padrão de `kind` que estava em `before` (só o que o comando mudou). */
  async restore(account: string, before: ClaudeDefaults, kind: ControlKind, sent: string): Promise<RestoreResult> {
    const acc = this.account(account);
    if (!acc) return { error: tr('conta do Claude Code desconhecida') };
    let out: RestoreResult;
    if (this.opts.direct) out = restoreDefaultsFile(acc.dir, before, kind, sent);
    else {
      const r = await this.ask(account, { id: randomUUID(), op: 'restore', configDir: acc.configDir, kind, sent, before });
      const result = r.ok ? r.value.result : undefined;
      out = !r.ok ? { error: r.error } : result === 'restored' || result === 'unchanged' ? result : { error: tr('o computador não confirmou a restauração') };
    }
    this.refreshAccount(account);
    return out;
  }

  /** Rodada do auxiliar: marca presença e entrega os pedidos. */
  poll(): HostRequest[] {
    this.host.seen();
    const out: HostRequest[] = [];
    for (const p of this.pending.values()) {
      if (p.sent) continue;
      p.sent = true;
      out.push(p.req);
    }
    return out;
  }

  pollWait(ms: number, signal?: AbortSignal): Promise<HostRequest[]> {
    return pollWithWait(this.host, () => this.poll(), ms, signal);
  }

  /** Resultado do auxiliar: `{results: [{id, ok, error?, defaults?, flags?, result?}]}`. */
  ack(raw: unknown): void {
    this.host.seen();
    const list = rec(raw)?.results;
    if (!Array.isArray(list)) return;
    for (const item of list.slice(0, 50)) {
      const x = rec(item);
      const p = typeof x?.id === 'string' ? this.pending.get(x.id) : undefined;
      if (!x || !p) continue;
      this.pending.delete(p.req.id);
      if (x.ok === true) p.done({ ok: true, value: x });
      else p.done({ ok: false, error: typeof x.error === 'string' && x.error ? x.error.slice(0, 200) : tr('o computador não fez o pedido') });
    }
  }

  // ---------------------------------------------------------------- internos

  private account(id: string): DefaultsAccount | undefined {
    return this.opts.accounts().find((a) => a.id === id);
  }

  private refreshAccount(account: string): void {
    const acc = this.account(account);
    if (!acc) return;
    const jobs = [...(this.jobs.get(account) ?? [])];
    if (this.opts.direct) {
      const d = readDefaultsFile(acc.dir);
      if (!('error' in d)) this.setDefaults(account, d);
      for (const j of jobs) {
        const f = readJobFlags(acc.dir, j);
        if (f) this.setFlags(account, j, f);
      }
      return;
    }
    if (!this.hostAvailable()) return;
    for (const p of this.pending.values()) if (p.account === account && p.req.op === 'read' && !p.sent) return;
    void this.ask(account, { id: randomUUID(), op: 'read', configDir: acc.configDir, jobs }).then((r) => {
      if (r.ok) this.applyRead(account, r.value);
    });
  }

  private applyRead(account: string, value: Record<string, unknown>): ClaudeDefaults | undefined {
    const d = parseDefaults(value.defaults);
    if (d) this.setDefaults(account, d);
    for (const [jobId, raw] of Object.entries(rec(value.flags) ?? {})) {
      const f = parseFlags(raw);
      if (f && this.jobs.get(account)?.has(jobId)) this.setFlags(account, jobId, f);
    }
    return d;
  }

  private ask(account: string, req: HostRequest): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
    if (!this.hostAvailable()) return Promise.resolve({ ok: false, error: tr('o auxiliar do computador (npm run codex:bridge) não está rodando') });
    return new Promise((done) => {
      this.pending.set(req.id, { req, account, sent: false, done });
      this.host.wake();
      setTimeout(() => {
        if (this.pending.delete(req.id)) done({ ok: false, error: tr('o computador não respondeu a tempo') });
      }, this.opts.hostTimeoutMs ?? HOST_TIMEOUT_MS).unref?.();
    });
  }

  private setDefaults(account: string, d: ClaudeDefaults): void {
    if (JSON.stringify(this.defaults.get(account)) === JSON.stringify(d)) return;
    this.defaults.set(account, d);
    this.emit();
  }

  private setFlags(account: string, jobId: string, f: JobFlags): void {
    const key = `${account}|${jobId}`;
    if (JSON.stringify(this.flags.get(key)) === JSON.stringify(f)) return;
    this.flags.set(key, f);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // quem ouve não derruba os outros
      }
    }
  }
}
