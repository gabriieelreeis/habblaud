// Interpretação do que o serviço do OpenCode devolve (código puro, sem rede): sessões (Session.Info), mensagens da
// sessão (Session.Message.*: user, assistant com texto/raciocínio/ferramentas, compaction, idle, shell...) e os limites
// de uso (UsageLimits.Info). Campos desconhecidos são ignorados e uma entrada inválida nunca derruba a leitura.
//
// Ids das atividades: `<agente>#<id da chamada>` nas ferramentas (o mesmo `id` dos eventos session.tool.*: a chamada
// vista em andamento e a concluída caem na mesma atividade) e `<agente>#<id da mensagem>:<parte>` no resto.
import { describePrompt, describeTool, maskSecrets, SPECIAL, truncate, type ActivityDescription } from '../../../shared/activity';
import type { AccountUsage, Activity, AskQuestion, TaskItem, TaskStatus, UsageWindow } from '../../../shared/types';
import { tr } from '../../../shared/i18n';

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Id de sessão do OpenCode ("ses_..."). */
export function isSessionId(v: unknown): v is string {
  return typeof v === 'string' && /^ses_[A-Za-z0-9]{6,64}$/.test(v);
}

// ------------------------------------------------------------------ sessão

export interface OcSession {
  id: string;
  parentId?: string;
  directory?: string;
  title?: string;
  /** Agente do OpenCode (build, plan, explore...). */
  agent?: string;
  /** "provedor/modelo". */
  model?: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  createdAt: number;
  updatedAt: number;
  busyAt?: number;
  idleAt?: number;
  /** Última vez que a sessão foi aberta numa TUI ou no app. */
  viewedAt?: number;
  archivedAt?: number;
  outcome?: 'succeeded' | 'failed' | 'interrupted';
}

/** Session.Info do serviço -> OcSession (undefined se faltar o essencial). */
export function parseSession(raw: unknown): OcSession | undefined {
  const r = rec(raw);
  if (!r || !isSessionId(r.id)) return undefined;
  const time = rec(r.time) ?? {};
  const createdAt = num(time.created);
  if (createdAt === undefined) return undefined;
  const tokens = rec(r.tokens) ?? {};
  const cache = rec(tokens.cache) ?? {};
  const s: OcSession = {
    id: r.id,
    // Como o Claude Code (input + cache): o que o modelo leu.
    tokensIn: (num(tokens.input) ?? 0) + (num(cache.read) ?? 0) + (num(cache.write) ?? 0),
    tokensOut: (num(tokens.output) ?? 0) + (num(tokens.reasoning) ?? 0),
    cost: num(r.cost) ?? 0,
    createdAt,
    updatedAt: num(time.updated) ?? createdAt,
  };
  if (isSessionId(r.parentID)) s.parentId = r.parentID;
  const dir = str(rec(r.location)?.directory) ?? str(r.directory);
  if (dir) s.directory = dir;
  const title = str(r.title);
  if (title && !/^New session - \d{4}-/.test(title)) s.title = truncate(title, 120);
  const agent = str(r.agent);
  if (agent) s.agent = agent;
  const model = modelLabel(r.model);
  if (model) s.model = model;
  const busy = num(time.busy);
  if (busy !== undefined) s.busyAt = busy;
  const idle = num(time.idle);
  if (idle !== undefined) s.idleAt = idle;
  const viewed = num(time.viewed);
  if (viewed !== undefined) s.viewedAt = viewed;
  const archived = num(time.archived);
  if (archived !== undefined) s.archivedAt = archived;
  if (r.outcome === 'succeeded' || r.outcome === 'failed' || r.outcome === 'interrupted') s.outcome = r.outcome;
  return s;
}

/** Model.Ref ({id, providerID}) -> "provedor/modelo". */
export function modelLabel(raw: unknown): string | undefined {
  const m = rec(raw);
  const id = str(m?.id);
  if (!id) return undefined;
  const provider = str(m?.providerID);
  return provider ? `${provider}/${id}` : id;
}

/**
 * O turno está rodando pelo que a sessão diz? `time.busy` presente e mais novo que `time.idle` (o serviço marca os
 * dois ao começar e terminar uma execução).
 */
export function sessionBusy(s: OcSession): boolean {
  return s.busyAt !== undefined && (s.idleAt === undefined || s.busyAt > s.idleAt);
}

// ------------------------------------------------------------------ ferramentas

export function patchFiles(patch: string): string[] {
  const out: string[] = [];
  for (const m of patch.slice(0, 200_000).matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) out.push(m[1].trim());
  return out;
}

export function fileOf(input: Rec): string | undefined {
  return str(input.filePath) ?? str(input.file_path) ?? str(input.path);
}

/** Perguntas da ferramenta `question` do OpenCode no formato do escritório. */
function questionsOf(input: Rec): AskQuestion[] {
  const list = Array.isArray(input.questions) ? input.questions : [];
  const out: AskQuestion[] = [];
  list.forEach((q, index) => {
    const r = rec(q);
    const question = str(r?.question);
    if (!r || !question) return;
    const options = (Array.isArray(r.options) ? r.options : [])
      .map((o, i) => {
        const or = rec(o);
        const label = str(or?.label);
        if (!label) return undefined;
        const opt: AskQuestion['options'][number] = { index: i, label: truncate(label, 120) };
        const description = str(or?.description);
        if (description) opt.description = truncate(description, 300);
        return opt;
      })
      .filter((o): o is AskQuestion['options'][number] => !!o);
    const item: AskQuestion = { index, question: truncate(question, 2_000), options };
    const header = str(r.header);
    if (header) item.header = truncate(header, 40);
    if (r.multiple === true || r.multiSelect === true) item.multiSelect = true;
    out.push(item);
  });
  return out;
}

/** Ferramenta do OpenCode (nomes em minúsculas: bash, read, edit...) -> descrição do escritório e o nome canônico. */
export function describeOpenCodeTool(rawName: string, rawInput: unknown): { desc: ActivityDescription; tool: string } {
  const input = rec(rawInput) ?? {};
  const name = rawName.trim();
  switch (name.toLowerCase()) {
    case 'bash':
    case 'shell':
      return { desc: describeTool('Bash', { command: str(input.command), description: str(input.description) }), tool: 'Bash' };
    case 'read':
      return { desc: describeTool('Read', { file_path: fileOf(input) }), tool: 'Read' };
    case 'edit':
    case 'multiedit':
      return { desc: describeTool('Edit', { file_path: fileOf(input) }), tool: 'Edit' };
    case 'write':
      return { desc: describeTool('Write', { file_path: fileOf(input) }), tool: 'Write' };
    case 'patch':
    case 'apply_patch': {
      const files = patchFiles(str(input.patchText) ?? str(input.patch) ?? str(input.input) ?? '');
      const desc = describeTool('Edit', { file_path: files[0] });
      if (files.length > 1) desc.detail = truncate(files.join(', '), 300);
      return { desc, tool: 'Edit' };
    }
    case 'grep':
      return { desc: describeTool('Grep', { pattern: str(input.pattern) }), tool: 'Grep' };
    case 'glob':
      return { desc: describeTool('Glob', { pattern: str(input.pattern) }), tool: 'Glob' };
    case 'list':
    case 'ls':
      return { desc: describeTool('LS', { path: fileOf(input) }), tool: 'LS' };
    case 'webfetch':
      return { desc: describeTool('WebFetch', { url: str(input.url) }), tool: 'WebFetch' };
    case 'websearch':
    case 'codesearch':
      return { desc: describeTool('WebSearch', { query: str(input.query) }), tool: 'WebSearch' };
    case 'task':
      return {
        desc: describeTool('Agent', { description: str(input.description), subagent_type: str(input.subagent_type) ?? str(input.agent), prompt: str(input.prompt) }),
        tool: 'Agent',
      };
    case 'todowrite':
      return { desc: describeTool('TodoWrite', { todos: input.todos }), tool: 'TodoWrite' };
    case 'todoread':
      return { desc: describeTool('TaskList', {}), tool: 'TaskList' };
    case 'skill':
      return { desc: describeTool('Skill', { skill: str(input.name) ?? str(input.skill) }), tool: 'Skill' };
    case 'question': {
      const questions = questionsOf(input);
      const desc = describeTool('AskUserQuestion', {});
      if (questions.length) Object.assign(desc, { detail: truncate(questions.map((q) => q.question).join('\n\n'), 2_000), questions });
      return { desc, tool: 'AskUserQuestion' };
    }
    default:
      return { desc: describeTool(name, input), tool: name };
  }
}

/** Lista de tarefas da ferramenta todowrite (`todos: [{content, status, id}]`). */
export function todosOf(rawInput: unknown): TaskItem[] | undefined {
  const todos = rec(rawInput)?.todos;
  if (!Array.isArray(todos)) return undefined;
  const out: TaskItem[] = [];
  todos.forEach((t, i) => {
    const r = rec(t);
    const title = str(r?.content) ?? str(r?.title);
    if (!r || !title) return;
    const raw = str(r.status);
    // cancelled sai da lista (como uma tarefa apagada no Claude Code).
    if (raw === 'cancelled') return;
    const status: TaskStatus = raw === 'completed' || raw === 'in_progress' ? raw : 'pending';
    out.push({ id: str(r.id) ?? String(i + 1), title: truncate(title, 200), status });
  });
  return out;
}

// ------------------------------------------------------------------ mensagens

/** Resultado de interpretar as mensagens de uma sessão. */
export interface MessageReading {
  /** Atividades, da mais antiga para a mais nova. `current` = a ferramenta ainda rodando. */
  activities: Array<{ activity: Activity; current: boolean }>;
  /** Última lista de tarefas (todowrite), se houver. */
  tasks?: TaskItem[];
  toolCalls: number;
  /** Subagentes disparados (ferramenta task). */
  subagents: number;
  /** Modelo da mensagem mais nova do assistente. */
  model?: string;
  /** Primeira e última data vistas. */
  firstAt?: number;
  lastAt?: number;
}

function errorText(raw: unknown): string | undefined {
  const e = rec(raw);
  const msg = str(e?.message) ?? str(rec(e?.data)?.message);
  return msg ? truncate(maskSecrets(msg.split('\n')[0]), 200) : undefined;
}

function at(m: Rec): number | undefined {
  return num(rec(m.time)?.created);
}

/** Atividade de uma instrução recebida: "Recebeu “…”" (kind 'prompt', a base do "Concluiu em X"). */
export function describeOpenCodePrompt(raw: string): ActivityDescription {
  // O `opencode run "..."` guarda a mensagem com as aspas em volta.
  const text = /^"[^"]*"$/.test(raw.trim()) ? raw.trim().slice(1, -1) : raw;
  const shown = truncate(maskSecrets(text.slice(0, 1_000)), 34);
  return { ...describePrompt(maskSecrets(text.slice(0, 1_000))), text: truncate(tr('Recebeu “{0}”', [shown]), 46) };
}

/**
 * Mensagens de uma sessão (em qualquer ordem: são ordenadas pela data) -> atividades e números. `idPrefix` = id do
 * agente no escritório.
 */
export function readMessages(messages: readonly unknown[], idPrefix: string): MessageReading {
  const list = messages
    .map(rec)
    .filter((m): m is Rec => !!m && !!str(m.id) && at(m) !== undefined)
    .sort((a, b) => at(a)! - at(b)! || String(a.id).localeCompare(String(b.id)));
  const out: MessageReading = { activities: [], toolCalls: 0, subagents: 0 };
  let turnStart: number | undefined;
  const push = (id: string, when: number, desc: ActivityDescription, extra: Partial<Activity> = {}, current = false) => {
    out.activities.push({ activity: { id: `${idPrefix}#${id}`, at: when, ...desc, ...extra }, current });
  };
  for (const m of list) {
    const id = String(m.id);
    const when = at(m)!;
    out.firstAt ??= when;
    out.lastAt = Math.max(out.lastAt ?? when, num(rec(m.time)?.completed) ?? when);
    switch (m.type) {
      case 'user': {
        const text = str(m.text);
        if (!text) break;
        turnStart = when;
        push(`${id}:p`, when, describeOpenCodePrompt(text));
        break;
      }
      case 'assistant': {
        const model = modelLabel(m.model);
        if (model) out.model = model;
        const content = Array.isArray(m.content) ? m.content : [];
        content.forEach((raw, i) => {
          const c = rec(raw);
          if (!c) return;
          if (c.type === 'text') {
            const text = str(c.text);
            if (text) push(`${id}:${i}`, when, SPECIAL.respond(truncate(maskSecrets(text), 300)));
            return;
          }
          if (c.type !== 'tool') return;
          const callId = str(c.id) ?? `${id}:${i}`;
          const name = str(c.name) ?? 'tool';
          const state = rec(c.state) ?? {};
          const input = rec(state.input) ?? {};
          const time = rec(c.time) ?? {};
          const started = num(time.created) ?? when;
          const { desc, tool } = describeOpenCodeTool(name, input);
          out.toolCalls++;
          if (tool === 'Agent') out.subagents++;
          if (tool === 'TodoWrite') {
            const tasks = todosOf(input);
            if (tasks) out.tasks = tasks;
          }
          const completed = num(time.completed);
          const extra: Partial<Activity> = { tool };
          if (completed !== undefined && completed >= started) extra.durationMs = completed - started;
          const running = state.status === 'running' || state.status === 'streaming';
          push(callId, started, desc, extra, running);
          if (state.status === 'error') push(`${callId}:e`, completed ?? started, SPECIAL.error(tool, errorText(state.error)), { tool, error: true });
        });
        const err = errorText(m.error);
        if (err && !/abort/i.test(err)) push(`${id}:err`, num(rec(m.time)?.completed) ?? when, SPECIAL.error(undefined, err), { error: true });
        break;
      }
      case 'shell': {
        const command = str(m.command);
        if (command) push(`${id}:sh`, when, describeTool('Bash', { command }), { tool: 'Bash' }, m.status === 'running');
        break;
      }
      case 'compaction':
        push(`${id}:c`, when, SPECIAL.compact());
        break;
      case 'skill': {
        const name = str(m.name) ?? str(rec(m.skill)?.name);
        push(`${id}:s`, when, describeTool('Skill', { skill: name }), { tool: 'Skill' });
        break;
      }
      case 'idle': {
        if (m.outcome === 'succeeded') push(`${id}:d`, when, SPECIAL.turnDone(turnStart !== undefined ? when - turnStart : undefined));
        else if (m.outcome === 'interrupted') push(`${id}:i`, when, SPECIAL.interrupted());
        else if (m.outcome === 'failed') push(`${id}:f`, when, SPECIAL.error(undefined, errorText(m.error)), { error: true });
        turnStart = undefined;
        break;
      }
      default:
        break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ limites de uso

function meter(raw: unknown): UsageWindow | undefined {
  const r = rec(raw);
  const percent = num(r?.percent);
  if (!r || percent === undefined) return undefined;
  const w: UsageWindow = { utilization: r.limited === true ? 100 : Math.min(100, Math.max(0, percent)) };
  const resets = num(r.resetsAt);
  if (resets !== undefined) w.resetsAt = resets;
  return w;
}

export interface OpenCodeLimits {
  usage: AccountUsage;
  /** Plano para exibir: "Go" com o OpenCode Go; senão undefined. */
  plan?: string;
  /** Nome do workspace do OpenCode (ex.: "Personal"). */
  workspace?: string;
}

/**
 * Resposta de /api/experimental/usage/limits (`{data: UsageLimits.Info | null}`) -> uso da conta. Sem o OpenCode Go
 * (sem `go`), as janelas ficam ausentes e `noLimits` diz que o OpenCode não informou limite nenhum; os orçamentos
 * (`budgets`, em dólares) vão em `budget` (o mais apertado).
 */
export function parseUsageLimits(raw: unknown, fetchedAt: number): OpenCodeLimits {
  const data = rec(rec(raw)?.data);
  const usage: AccountUsage = { source: 'opencode', fetchedAt };
  const out: OpenCodeLimits = { usage };
  const name = str(rec(data?.workspace)?.name);
  if (name) out.workspace = truncate(name, 60);
  const go = rec(data?.go);
  if (go) {
    out.plan = 'Go';
    const five = meter(go.rolling);
    const week = meter(go.weekly);
    const month = meter(go.monthly);
    if (five) usage.fiveHour = five;
    if (week) usage.sevenDay = week;
    if (month) usage.monthly = month;
  }
  let tightest: { spent: number; limit: number; resetsAt?: number } | undefined;
  for (const b of Array.isArray(data?.budgets) ? data.budgets : []) {
    const r = rec(b);
    const limit = num(r?.limit);
    const spent = num(r?.spent);
    if (!r || limit === undefined || spent === undefined || limit <= 0) continue;
    if (!tightest || spent / limit > tightest.spent / tightest.limit) {
      tightest = { spent, limit };
      const resets = num(r.resetsAt);
      if (resets !== undefined) tightest.resetsAt = resets;
    }
  }
  if (tightest) usage.budget = tightest;
  if (!usage.fiveHour && !usage.sevenDay && !usage.monthly && !usage.budget) usage.noLimits = true;
  return out;
}
