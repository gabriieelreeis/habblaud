// Pedidos de permissão do OpenCode (Permission.Request do serviço dele) no formato do cartão do escritório. Código
// puro, sem rede: a fonte (source.ts) lê os pedidos (GET /api/session/<id>/permission e o evento permission.asked) e
// o registro (permissions/registry.ts, registerExternal) os mostra; a resposta volta ao serviço em
// POST /api/session/<id>/permission/<pedido>/reply com `once`, `always` ou `reject`.
//
// O pedido do OpenCode diz a ação ("bash", "edit", "read", "external_directory", o nome de uma ferramenta de MCP...),
// os recursos (os comandos, os arquivos, a pasta) e o que o "sempre" guardaria (`save`, ex. "git status *"): é dele
// que sai a única sugestão "sempre permitir" do cartão, e quem guarda a regra é o próprio OpenCode.
//
// Perguntas (a ferramenta `question` do OpenCode vira um formulário, Form.Info, em GET /api/session/<id>/form): os
// campos de escolha viram as perguntas do cartão (como as do AskUserQuestion) e a resposta volta em
// POST /api/session/<id>/form/<formulário>/reply com o valor de cada campo; recusar cancela o formulário (DELETE).
import { describeTool, maskSecrets, truncate } from '../../../shared/activity';
import type { AskQuestion, PermissionAnswer, PermissionDecision, PermissionRequestInfo, PermissionSuggestionInfo, TerminalInputKind } from '../../../shared/types';
import { INPUT_MAX, marked, prepare, toolView } from '../terminal';
import { tr } from '../../../shared/i18n';

type Rec = Record<string, unknown>;

/** Onde o "sempre" do OpenCode guarda a regra (PermissionSuggestionInfo.destination). */
export const OPENCODE_DESTINATION = 'opencode';
const RESOURCES_MAX = 20;
const RULES_MAX = 4;
const RULE_MAX = 160;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function strings(v: unknown, max = RESOURCES_MAX): string[] {
  return Array.isArray(v) ? v.map(str).filter((s): s is string => !!s).slice(0, max) : [];
}

/** Um pedido pendente do OpenCode. */
export interface OcPermission {
  id: string;
  sessionId: string;
  action: string;
  resources: string[];
  /** O que a resposta `always` guarda (vazio = o OpenCode não oferece "sempre"). */
  save: string[];
  metadata?: Rec;
  /** Mensagem do próprio OpenCode sobre o pedido. */
  message?: string;
}

/** Permission.Request (da lista ou do evento permission.asked) -> OcPermission; undefined se faltar o essencial. */
export function parsePermission(raw: unknown): OcPermission | undefined {
  const r = rec(raw);
  const id = str(r?.id);
  const sessionId = str(r?.sessionID);
  const action = str(r?.action);
  if (!r || !id || !sessionId || !action) return undefined;
  const p: OcPermission = { id, sessionId, action, resources: strings(r.resources), save: strings(r.save, RULES_MAX) };
  const metadata = rec(r.metadata);
  if (metadata) p.metadata = metadata;
  const message = str(r.message);
  if (message) p.message = message;
  return p;
}

/** O que o cartão mostra de um pedido do OpenCode (sem id nem datas, que o registro põe). */
export type OcPermissionView = Pick<PermissionRequestInfo, 'tool' | 'title' | 'text' | 'icon' | 'input' | 'inputKind' | 'suggestions'>;

function inputOf(raw: string | undefined, kind: TerminalInputKind): Pick<OcPermissionView, 'input' | 'inputKind'> {
  if (!raw?.trim()) return {};
  const input = marked(prepare(raw, INPUT_MAX, Infinity, false));
  return input ? { input, inputKind: kind } : {};
}

/** As mudanças de um pedido "edit": o diff que o OpenCode manda em `metadata` (texto, ou um por arquivo). */
function diffOf(metadata: Rec | undefined): string | undefined {
  const diff = str(metadata?.diff);
  if (diff) return diff;
  const files = Array.isArray(metadata?.files) ? metadata.files.map(rec) : [];
  const parts = files.map((f) => str(f?.diff) ?? str(f?.patch)).filter((d): d is string => !!d);
  return parts.length ? parts.join('\n') : undefined;
}

/** Sugestão "sempre permitir": as regras que o `always` do OpenCode guardaria (ex. "bash(git status *)"). */
function suggestionsOf(p: OcPermission): PermissionSuggestionInfo[] | undefined {
  if (!p.save.length) return undefined;
  const rules = p.save.map((s) => truncate(maskSecrets(`${p.action}(${s})`), RULE_MAX));
  return [{ index: 0, rules, destination: OPENCODE_DESTINATION }];
}

/** Título, resumo, ícone, prévia e o "sempre" de um pedido do OpenCode. */
export function permissionView(p: OcPermission, cwd?: string): OcPermissionView {
  const first = p.resources[0];
  const all = p.resources.join('\n');
  const suggestions = suggestionsOf(p);
  const base = (tool: string, input: Rec, extra: Partial<OcPermissionView> = {}): OcPermissionView => {
    const desc = describeTool(tool, input);
    const view = toolView(tool, input, cwd);
    const out: OcPermissionView = { tool, title: view.title, text: desc.text, icon: desc.icon };
    if (view.input) out.input = view.input;
    if (view.inputKind) out.inputKind = view.inputKind;
    Object.assign(out, extra);
    if (suggestions) out.suggestions = suggestions;
    return out;
  };
  switch (p.action.toLowerCase()) {
    case 'bash':
    case 'shell':
      // Um recurso por comando da linha (o OpenCode separa `a && b`): a caixa "$" mostra todos.
      return base('Bash', { command: all });
    case 'edit':
    case 'write':
    case 'patch':
    case 'apply_patch': {
      const files = p.resources.length > 1 ? truncate(p.resources.join(', '), 300) : first;
      return base('Edit', { file_path: files }, inputOf(diffOf(p.metadata), 'diff'));
    }
    case 'read':
      return base('Read', { file_path: first });
    case 'list':
      return base('LS', { path: first });
    case 'glob':
      return base('Glob', { pattern: first });
    case 'grep':
      return base('Grep', { pattern: first });
    case 'webfetch':
      return base('WebFetch', { url: first });
    case 'websearch':
    case 'codesearch':
      return base('WebSearch', { query: first });
    case 'external_directory': {
      const dir = first?.replace(/[\\/]\*$/, '');
      const out: OcPermissionView = {
        tool: 'external_directory',
        title: dir ? `${tr('Pasta externa')}(${truncate(dir, 100)})` : tr('Pasta externa'),
        text: tr('Acessar uma pasta fora do projeto'),
        icon: '📁',
        ...inputOf(all, 'text'),
      };
      if (suggestions) out.suggestions = suggestions;
      return out;
    }
    default: {
      // Ferramenta de MCP ou outra ação: o nome e os argumentos (metadata.input), como no terminal.
      const input = rec(p.metadata?.input);
      const shown = first && first !== '*' ? first : undefined;
      const out: OcPermissionView = {
        tool: p.action,
        title: shown ? `${p.action}(${truncate(shown, 100)})` : p.action,
        text: tr('Usar {0}', [truncate(p.action, 60)]),
        icon: '🔧',
        ...inputOf(input ? JSON.stringify(input, null, 2) : p.resources.filter((r) => r !== '*').join('\n'), input ? 'json' : 'text'),
      };
      if (suggestions) out.suggestions = suggestions;
      return out;
    }
  }
}

/** Resposta do OpenCode para uma decisão do escritório (undefined = decisão que ele não aceita). */
export function permissionReply(d: PermissionDecision): { decision: 'once' | 'always' | 'reject'; message?: string } | undefined {
  if (d.behavior === 'allow') return { decision: d.suggestion === 0 ? 'always' : 'once' };
  if (d.behavior === 'deny') return d.message ? { decision: 'reject', message: d.message } : { decision: 'reject' };
  return undefined;
}

// ------------------------------------------------------------------ perguntas (formulários)

/** Um campo de pergunta que o escritório sabe responder: escolha única (string) ou várias (multiselect). */
interface OcFormField {
  key: string;
  multiSelect: boolean;
  /** Os valores das opções, por posição (a resposta volta pela posição). */
  values: string[];
  /** Aceita texto livre ("Outro"). */
  custom: boolean;
}

/** Uma pergunta pendente do OpenCode (Form.Info) que dá para responder pelo escritório. */
export interface OcForm {
  id: string;
  sessionId: string;
  fields: OcFormField[];
  questions: AskQuestion[];
}

/**
 * Form.Info -> OcForm. undefined = sem o essencial, ou com um campo que o cartão do escritório não sabe mostrar
 * (número, sim/não, link externo, campo condicional): esse fica só no OpenCode.
 */
export function parseForm(raw: unknown): OcForm | undefined {
  const r = rec(raw);
  const id = str(r?.id);
  const sessionId = str(r?.sessionID);
  const fields = Array.isArray(r?.fields) ? r.fields.map(rec) : [];
  if (!r || !id || !sessionId || !fields.length || fields.length > 4) return undefined;
  const out: OcForm = { id, sessionId, fields: [], questions: [] };
  for (const [index, f] of fields.entries()) {
    if (!f || f.hidden === true || Array.isArray(f.when)) return undefined;
    const key = str(f.key);
    const multiSelect = f.type === 'multiselect';
    if (!key || (f.type !== 'string' && !multiSelect)) return undefined;
    const options = (Array.isArray(f.options) ? f.options.map(rec) : []).filter((o): o is Rec => !!o && typeof o.value === 'string');
    const custom = multiSelect ? f.custom === true : f.custom !== false;
    if (!options.length && !custom) return undefined;
    const title = str(f.title);
    const question = str(f.description) ?? title;
    if (!question) return undefined;
    out.fields.push({ key, multiSelect, values: options.map((o) => o.value as string), custom });
    const q: AskQuestion = {
      index,
      question: truncate(maskSecrets(question), 2_000),
      options: options.map((o, i) => {
        const label = truncate(maskSecrets(str(o.label) ?? (o.value as string)), 200);
        const description = str(o.description);
        return description ? { index: i, label, description: truncate(maskSecrets(description), 300) } : { index: i, label };
      }),
    };
    if (title && title !== question) q.header = truncate(maskSecrets(title), 60);
    if (multiSelect) q.multiSelect = true;
    out.questions.push(q);
  }
  return out;
}

/** Resposta do OpenCode (Form.Reply) para as respostas do escritório; undefined = não servem para este formulário. */
export function formReply(form: OcForm, answers: readonly PermissionAnswer[]): { answer: Record<string, string | string[]> } | undefined {
  const answer: Record<string, string | string[]> = {};
  for (const a of answers) {
    const f = form.fields[a.question];
    if (!f) return undefined;
    const picked = (a.options ?? []).map((i) => f.values[i]);
    if (picked.some((v) => v === undefined)) return undefined;
    if (a.other && !f.custom) return undefined;
    const all = a.other ? [...picked, a.other] : picked;
    if (!all.length) return undefined;
    answer[f.key] = f.multiSelect ? all : all[0];
  }
  return form.fields.every((f) => f.key in answer) ? { answer } : undefined;
}
