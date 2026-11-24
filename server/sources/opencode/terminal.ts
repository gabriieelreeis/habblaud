// Terminal do Habblaud para uma sessão do OpenCode: a conversa (pedidos, respostas, raciocínio, ferramentas e
// resultados) montada das mensagens que o serviço dele devolve (GET /api/session/<id>/message), no formato do terminal
// (TerminalEntry). Código puro, sem rede: quem busca é a fonte (source.ts, conversation) e quem manda ao navegador é
// http/terminal.ts (RemoteSource), que relê a cada poucos segundos e acrescenta só as entradas novas.
//
// As entradas só são acrescentadas, nunca editadas: texto e raciocínio entram quando a mensagem termina (enquanto o
// modelo escreve, o texto ainda cresce) e o resultado de uma ferramenta entra quando ela termina, numa entrada própria.
import { maskSecrets } from '../../../shared/activity';
import type { TerminalEntry } from '../../../shared/types';
import { INPUT_MAX, marked, oneLine, prepare, RESULT_MAX, RESULT_MAX_LINES, TEXT_MAX, THINKING_MAX, toolView } from '../terminal';
import { fileOf, patchFiles } from './parse';
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

function at(m: Rec): number | undefined {
  return num(rec(m.time)?.created);
}

/** A ferramenta do OpenCode com o nome e os argumentos que o terminal do Claude Code entende (toolView). */
export function toolForTerminal(rawName: string, input: Rec): { tool: string; input: Rec } {
  const name = rawName.trim().toLowerCase();
  switch (name) {
    case 'bash':
    case 'shell':
      return { tool: 'Bash', input: { command: str(input.command), description: str(input.description) } };
    case 'read':
      return { tool: 'Read', input: { file_path: fileOf(input) } };
    case 'edit':
    case 'multiedit':
      return { tool: 'Edit', input: { file_path: fileOf(input), old_string: str(input.oldString) ?? str(input.old_string) ?? '', new_string: str(input.newString) ?? str(input.new_string) ?? '' } };
    case 'write':
      return { tool: 'Write', input: { file_path: fileOf(input), content: str(input.content) ?? '' } };
    case 'patch':
    case 'apply_patch': {
      const patch = str(input.patchText) ?? str(input.patch) ?? str(input.input) ?? '';
      return { tool: 'Edit', input: { file_path: patchFiles(patch).join(', ') || undefined } };
    }
    case 'grep':
      return { tool: 'Grep', input: { pattern: str(input.pattern), path: str(input.path) } };
    case 'glob':
      return { tool: 'Glob', input: { pattern: str(input.pattern), path: str(input.path) } };
    case 'list':
    case 'ls':
      return { tool: 'LS', input: { path: fileOf(input) } };
    case 'webfetch':
      return { tool: 'WebFetch', input: { url: str(input.url) } };
    case 'websearch':
    case 'codesearch':
      return { tool: 'WebSearch', input: { query: str(input.query) } };
    case 'task':
      return { tool: 'Agent', input: { description: str(input.description), subagent_type: str(input.subagent_type) ?? str(input.agent), prompt: str(input.prompt) } };
    case 'todowrite':
      return { tool: 'TodoWrite', input: { todos: input.todos } };
    default:
      return { tool: rawName.trim() || 'tool', input };
  }
}

/** O texto que uma ferramenta devolveu (as partes de texto do `content` do estado, ou `output`). */
function resultText(state: Rec): string {
  const content = Array.isArray(state.content) ? state.content : [];
  const parts = content.map((c) => (rec(c)?.type === 'text' ? str(rec(c)!.text) : undefined)).filter((t): t is string => !!t);
  if (parts.length) return parts.join('\n');
  const err = rec(state.error);
  return str(state.output) ?? str(err?.message) ?? str(state.error) ?? '';
}

function errorText(raw: unknown): string | undefined {
  const e = rec(raw);
  return str(e?.message) ?? str(rec(e?.data)?.message);
}

/** Mensagens da sessão (em qualquer ordem) -> a conversa, da mais antiga para a mais nova. */
export function conversationOf(messages: readonly unknown[], cwd?: string): TerminalEntry[] {
  const list = messages
    .map(rec)
    .filter((m): m is Rec => !!m && !!str(m.id) && at(m) !== undefined)
    .sort((a, b) => at(a)! - at(b)! || String(a.id).localeCompare(String(b.id)));
  const out: TerminalEntry[] = [];
  for (const m of list) {
    const id = String(m.id);
    const when = at(m)!;
    switch (m.type) {
      case 'user': {
        const raw = str(m.text);
        // O `opencode run "..."` guarda a mensagem com as aspas em volta.
        const text = raw && /^"[^"]*"$/.test(raw.trim()) ? raw.trim().slice(1, -1) : raw;
        if (text) out.push({ kind: 'user', id, at: when, text: marked(prepare(text, TEXT_MAX)) });
        break;
      }
      case 'assistant': {
        // Texto e raciocínio só com a mensagem terminada (antes disso ainda crescem).
        const done = num(rec(m.time)?.completed) !== undefined;
        const content = Array.isArray(m.content) ? m.content : [];
        content.forEach((raw, i) => {
          const c = rec(raw);
          if (!c) return;
          const partAt = num(rec(c.time)?.created) ?? when;
          if (c.type === 'text' && done) {
            const text = str(c.text);
            if (text) out.push({ kind: 'assistant', id: `${id}:${i}`, at: partAt, text: marked(prepare(text, TEXT_MAX)) });
            return;
          }
          if (c.type === 'reasoning' && done) {
            const text = str(c.text);
            if (text) out.push({ kind: 'thinking', id: `${id}:${i}`, at: partAt, text: marked(prepare(text, THINKING_MAX)) });
            return;
          }
          if (c.type !== 'tool') return;
          const state = rec(c.state) ?? {};
          const status = state.status;
          // Argumentos ainda chegando: espera a ferramenta começar.
          if (status !== 'running' && status !== 'completed' && status !== 'error') return;
          const callId = str(c.id) ?? `${id}:${i}`;
          const mapped = toolForTerminal(str(c.name) ?? 'tool', rec(state.input) ?? {});
          const view = toolView(mapped.tool, mapped.input, cwd);
          const entry: TerminalEntry = { kind: 'tool', id: callId, at: partAt, tool: mapped.tool, title: view.title };
          if (view.input) entry.input = view.input;
          if (view.inputKind) entry.inputKind = view.inputKind;
          out.push(entry);
          if (status === 'running') return;
          const r = prepare(resultText(state), RESULT_MAX, RESULT_MAX_LINES);
          const result: TerminalEntry = { kind: 'result', id: `${callId}:r`, at: num(rec(c.time)?.completed) ?? partAt, toolUseId: callId, text: r.text };
          if (status === 'error') result.error = true;
          if (r.truncated) result.truncated = true;
          out.push(result);
        });
        const err = errorText(m.error);
        if (err && done && !/abort/i.test(err)) out.push({ kind: 'system', id: `${id}:err`, at: when, text: oneLine(err, 200), level: 'error' });
        break;
      }
      case 'shell': {
        // Comando "!" digitado na TUI.
        const command = str(m.command);
        if (!command) break;
        out.push({ kind: 'tool', id: `${id}:sh`, at: when, tool: 'Bash', title: toolView('Bash', { command }).title, input: marked(prepare(command, INPUT_MAX)), inputKind: 'command' });
        const output = str(m.output);
        if (output && m.status !== 'running') {
          const r = prepare(output, RESULT_MAX, RESULT_MAX_LINES);
          out.push({ kind: 'result', id: `${id}:sh:r`, at: when, toolUseId: `${id}:sh`, text: r.text, ...(r.truncated ? { truncated: true } : {}) });
        }
        break;
      }
      case 'compaction':
        out.push({ kind: 'system', id: `${id}:c`, at: when, text: tr('Conversa compactada'), level: 'info' });
        break;
      case 'idle':
        if (m.outcome === 'interrupted') out.push({ kind: 'system', id: `${id}:i`, at: when, text: tr('Interrompido'), level: 'warn' });
        else if (m.outcome === 'failed') {
          const err = errorText(m.error);
          out.push({ kind: 'system', id: `${id}:f`, at: when, text: err ? oneLine(maskSecrets(err), 200) : tr('A execução falhou'), level: 'error' });
        }
        break;
      default:
        break;
    }
  }
  return out;
}
