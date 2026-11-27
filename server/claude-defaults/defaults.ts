// Padrões do Claude Code para as sessões novas e as opções de abertura de cada sessão, só no que o escritório usa:
// `model`, `effortLevel` e `modelSettings.<modelo>.effortLevel` do <conta>/settings.json, e o `--effort`/`--model` de
// <conta>/jobs/<id>/state.json (sessões em segundo plano). O resto desses arquivos nunca é lido para fora daqui.
//
// No Claude Code 2.1.332, `/effort` e `/model` numa sessão interativa também gravam o padrão das sessões novas. A
// troca pela gaveta vale só para a sessão: antes do comando o escritório guarda esses valores (snapshot) e, depois
// que a sessão confirma, devolve ao arquivo só o que o comando mudou (restoreText), sem mexer em mais nada.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tr } from '../../shared/i18n';
import type { AgentEffort, ControlKind } from '../../shared/types';

export interface ClaudeDefaults {
  model?: string;
  effortLevel?: string;
  /** modelSettings: id do modelo -> effortLevel. */
  modelEffort: Record<string, string>;
}

export interface JobFlags {
  effort?: string;
  model?: string;
}

type Rec = Record<string, unknown>;

const JOB_ID = /^[A-Za-z0-9_-]{4,64}$/;
const LEVEL = /^[a-z][a-z0-9-]{1,15}$/;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

function str(v: unknown, max = 200): string | undefined {
  return typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;
}

export function isJobId(v: unknown): v is string {
  return typeof v === 'string' && JOB_ID.test(v);
}

/** O que interessa de um settings.json (já lido como JSON). */
export function pickDefaults(raw: unknown): ClaudeDefaults {
  const r = rec(raw) ?? {};
  const out: ClaudeDefaults = { modelEffort: {} };
  const model = str(r.model);
  if (model) out.model = model;
  const effort = str(r.effortLevel, 16);
  if (effort) out.effortLevel = effort;
  for (const [id, v] of Object.entries(rec(r.modelSettings) ?? {})) {
    const level = str(rec(v)?.effortLevel, 16);
    if (level && id.length <= 200) out.modelEffort[id] = level;
  }
  return out;
}

/** Esforço padrão para `model` (id do Claude Code): o do modelo em modelSettings ou o geral. */
export function defaultEffort(d: ClaudeDefaults | undefined, model: string | undefined): string | undefined {
  if (!d) return undefined;
  if (model) {
    const exact = d.modelEffort[model];
    if (exact) return exact;
    const base = model.replace(/\[[^\]]*\]$/, '');
    if (d.modelEffort[base]) return d.modelEffort[base];
  }
  return d.effortLevel;
}

/** Folga entre a hora gravada no registro da sessão e a das linhas da conversa. */
export const START_SLACK_MS = 2_000;

/**
 * Esforço de uma sessão do Claude Code: o último /effort desta abertura (certo), senão o --effort da abertura, senão o
 * padrão do settings.json (provável: o CLAUDE_CODE_EFFORT_LEVEL ou um agente com `effort` podem mudar).
 */
export function sessionEffort(
  cmd: { level: string; at: number } | undefined,
  startedAt: number | undefined,
  flags: JobFlags | undefined,
  defaults: ClaudeDefaults | undefined,
  model: string | undefined,
): AgentEffort | undefined {
  if (cmd && cmd.at >= (startedAt ?? 0) - START_SLACK_MS) return { level: cmd.level, source: 'command', at: cmd.at };
  if (flags?.effort) return { level: flags.effort, source: 'flag' };
  const level = defaultEffort(defaults, model);
  return level ? { level, source: 'settings' } : undefined;
}

/** `--effort` e `--model` com que uma sessão em segundo plano foi aberta (state.json do job). */
export function flagsOf(raw: unknown): JobFlags {
  const flags = rec(raw)?.respawnFlags;
  const out: JobFlags = {};
  if (!Array.isArray(flags)) return out;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    const eq = typeof f === 'string' ? /^--(effort|model)=(.+)$/.exec(f) : null;
    const name = eq ? eq[1] : f === '--effort' ? 'effort' : f === '--model' ? 'model' : undefined;
    const value = eq ? eq[2] : name ? flags[++i] : undefined;
    const v = str(value, 120);
    if (!name || !v) continue;
    if (name === 'effort' && LEVEL.test(v)) out.effort = v;
    if (name === 'model') out.model = v;
  }
  return out;
}

/**
 * O settings.json com o padrão de `kind` de volta ao que estava em `before`, ou undefined se não há o que mudar. Só
 * volta o que o comando mudou: no esforço, cada nível igual a `sent` (ou apagado, no `auto`) que antes era outro; no
 * modelo, o `model`. Lança se o texto não for um objeto JSON.
 */
export function restoreText(text: string, before: ClaudeDefaults, kind: ControlKind, sent: string): string | undefined {
  const json = JSON.parse(text) as unknown;
  const root = rec(json);
  if (!root) throw new Error('settings.json não é um objeto JSON');
  let changed = false;
  const setOrDelete = (obj: Rec, key: string, value: string | undefined) => {
    if (value === undefined) delete obj[key];
    else obj[key] = value;
    changed = true;
  };
  const byCommand = (cur: unknown, was: string | undefined) => cur !== was && (cur === sent || (sent === 'auto' && cur === undefined));
  if (kind === 'model') {
    if (root.model !== before.model) setOrDelete(root, 'model', before.model);
  } else {
    if (byCommand(root.effortLevel, before.effortLevel)) setOrDelete(root, 'effortLevel', before.effortLevel);
    let ms = rec(root.modelSettings);
    let emptied = false;
    for (const id of new Set([...Object.keys(ms ?? {}), ...Object.keys(before.modelEffort)])) {
      const entry = rec(ms?.[id]);
      const was = before.modelEffort[id];
      if (!byCommand(entry?.effortLevel, was)) continue;
      changed = true;
      if (was !== undefined) {
        if (entry) entry.effortLevel = was;
        else {
          ms ??= root.modelSettings = {};
          ms[id] = { effortLevel: was };
        }
      } else if (entry && ms) {
        delete entry.effortLevel;
        if (!Object.keys(entry).length) delete ms[id];
        if (!Object.keys(ms).length) emptied = true;
      }
    }
    if (emptied && ms && !Object.keys(ms).length) delete root.modelSettings;
  }
  if (!changed) return undefined;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const body = JSON.stringify(root, null, 2).replace(/\n/g, eol);
  return /\r?\n$/.test(text) ? body + eol : body;
}

/** Padrões gravados em <configDir>/settings.json (sem o arquivo: nenhum). Nunca lança. */
export function readDefaultsFile(configDir: string): ClaudeDefaults | { error: string } {
  let text: string;
  try {
    text = readFileSync(join(configDir, 'settings.json'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { modelEffort: {} };
    return { error: tr('settings.json ilegível') };
  }
  try {
    return pickDefaults(JSON.parse(text));
  } catch {
    return { error: tr('settings.json não é um JSON válido') };
  }
}

/** Opções de abertura de uma sessão em segundo plano (<configDir>/jobs/<id>/state.json). Nunca lança. */
export function readJobFlags(configDir: string, jobId: string): JobFlags | undefined {
  if (!isJobId(jobId)) return undefined;
  try {
    return flagsOf(JSON.parse(readFileSync(join(configDir, 'jobs', jobId, 'state.json'), 'utf8')));
  } catch {
    return undefined;
  }
}

/**
 * Devolve ao <configDir>/settings.json o padrão de `kind` que estava em `before` (só o que o comando mudou). Nunca
 * lança: 'restored', 'unchanged' (nada a voltar) ou o erro.
 */
export function restoreDefaultsFile(configDir: string, before: ClaudeDefaults, kind: ControlKind, sent: string): 'restored' | 'unchanged' | { error: string } {
  const file = join(configDir, 'settings.json');
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'unchanged';
    return { error: tr('settings.json ilegível') };
  }
  let next: string | undefined;
  try {
    next = restoreText(text, before, kind, sent);
  } catch {
    return { error: tr('settings.json não é um JSON válido') };
  }
  if (next === undefined) return 'unchanged';
  const tmp = `${file}.habblaud-${process.pid}.tmp`;
  try {
    writeFileSync(tmp, next);
    try {
      renameSync(tmp, file);
    } catch {
      rmSync(tmp, { force: true });
      writeFileSync(file, next);
    }
    return 'restored';
  } catch (err) {
    return { error: tr('não deu para gravar o settings.json ({0})', [(err as NodeJS.ErrnoException).code ?? tr('erro')]) };
  }
}
