// Conversa com o serviço em segundo plano do OpenCode (v2+): a TUI, o `opencode run` e o app desktop falam com o mesmo
// servidor HTTP local (`opencode service status` mostra o endereço). É dele que saem as sessões, as mensagens, os eventos
// ao vivo (SSE em /api/event) e os limites de uso (/api/experimental/usage/limits).
//
// Onde está o serviço (relido a cada conexão: ao reiniciar, o OpenCode troca a porta e a senha):
// - HABBLAUD_OPENCODE_URL (+ HABBLAUD_OPENCODE_PASSWORD), se definidas;
// - senão o arquivo de estado do serviço: HABBLAUD_OPENCODE_SERVICE_FILE ou `$XDG_STATE_HOME/opencode/service.json`
//   (padrão `~/.local/state/opencode/service.json`), gravado pelo próprio OpenCode com `url` e `password`.
// No Docker, o docker-up monta SÓ esse arquivo (somente leitura) e define HABBLAUD_OPENCODE_HOST=host.docker.internal:
// o endereço do arquivo (127.0.0.1) troca de host para o container alcançar o serviço do computador.
//
// Privacidade: a senha só vai no cabeçalho Authorization (Basic, usuário "opencode"), nunca em log, URL ou resposta.
// O Habblaud só LÊ (GET), com duas exceções pedidas pelo próprio usuário: a mensagem que ele escreve a um agente pelo
// escritório vai para a fila da sessão (POST /api/session/<id>/prompt) e a resposta dele a um pedido de permissão vai
// para o pedido (POST /api/session/<id>/permission/<pedido>/reply; o "sempre" faz o OpenCode guardar a regra). Nada é
// apagado.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tr } from '../../../shared/i18n';

export interface OpenCodeEndpoint {
  url: string;
  password?: string;
  /** De onde veio (para o log e o /api/health): o arquivo do serviço ou "env". */
  origin: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Arquivo de estado do serviço do OpenCode. */
export function serviceFile(env: NodeJS.ProcessEnv, home: string): string {
  const explicit = str(env.HABBLAUD_OPENCODE_SERVICE_FILE);
  if (explicit) return explicit;
  const state = str(env.XDG_STATE_HOME) ?? join(home, '.local', 'state');
  return join(state, 'opencode', 'service.json');
}

/** Troca o host de um endereço local (127.0.0.1, localhost, ::1) pelo `host` dado (ex.: host.docker.internal). */
export function rewriteHost(url: string, host: string | undefined): string {
  if (!host) return url;
  try {
    const u = new URL(url);
    if (/^(127\.\d+\.\d+\.\d+|localhost|\[::1\]|0\.0\.0\.0)$/i.test(u.hostname)) u.hostname = host;
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

/**
 * Endereço e senha do serviço agora, ou o motivo de não haver (traduzido). Nunca lança. A senha nunca entra no
 * motivo.
 */
export function resolveEndpoint(env: NodeJS.ProcessEnv = process.env, home: string = env.HOME || homedir()): OpenCodeEndpoint | { error: string } {
  const host = str(env.HABBLAUD_OPENCODE_HOST);
  const envUrl = str(env.HABBLAUD_OPENCODE_URL);
  if (envUrl) return { url: rewriteHost(envUrl.replace(/\/+$/, ''), host), password: str(env.HABBLAUD_OPENCODE_PASSWORD), origin: 'env' };
  const file = serviceFile(env, home);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { error: code === 'ENOENT' ? tr('serviço do OpenCode nunca iniciado ({0} não existe)', [file]) : tr('{0} ilegível ({1})', [file, code ?? tr('erro')]) };
  }
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { error: tr('{0} inválido', [file]) };
  }
  const url = str(j.url);
  if (!url) return { error: tr('{0} sem o endereço do serviço', [file]) };
  return { url: rewriteHost(url.replace(/\/+$/, ''), host), password: str(j.password), origin: file };
}

/** Erro de uma chamada ao serviço; `status` 0 = sem resposta (fora do ar, recusado, tempo esgotado). */
export class OpenCodeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  body?: AsyncIterable<Uint8Array> | null;
}>;

function headers(ep: OpenCodeEndpoint, accept = 'application/json'): Record<string, string> {
  const h: Record<string, string> = { accept };
  if (ep.password) h.authorization = `Basic ${Buffer.from(`opencode:${ep.password}`).toString('base64')}`;
  return h;
}

function failure(err: unknown): OpenCodeHttpError {
  if (err instanceof OpenCodeHttpError) return err;
  const e = err as { name?: string; cause?: { code?: string }; message?: string };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return new OpenCodeHttpError(tr('o serviço do OpenCode não respondeu a tempo'), 0);
  const code = e?.cause?.code;
  if (code === 'ECONNREFUSED') return new OpenCodeHttpError(tr('serviço do OpenCode fora do ar'), 0);
  return new OpenCodeHttpError(code ?? e?.message ?? String(err), 0);
}

/** GET de um JSON do serviço (com tempo-limite). Lança OpenCodeHttpError. */
export async function getJson(fetchFn: FetchLike, ep: OpenCodeEndpoint, path: string, timeoutMs = 8_000): Promise<unknown> {
  let res;
  try {
    res = await fetchFn(`${ep.url}${path}`, { headers: headers(ep), signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw failure(err);
  }
  if (res.status === 401 || res.status === 403) throw new OpenCodeHttpError(tr('o serviço do OpenCode recusou a senha (reinicie o Habblaud depois de reiniciar o OpenCode)'), res.status);
  if (!res.ok) throw new OpenCodeHttpError(tr('o serviço do OpenCode respondeu {0}', [res.status]), res.status);
  try {
    return await res.json();
  } catch (err) {
    throw failure(err);
  }
}

/** POST de um JSON ao serviço (com tempo-limite). Lança OpenCodeHttpError (409 = a sessão não aceitou agora). */
export async function postJson(fetchFn: FetchLike, ep: OpenCodeEndpoint, path: string, body: unknown, timeoutMs = 15_000): Promise<unknown> {
  let res;
  try {
    res = await fetchFn(`${ep.url}${path}`, {
      method: 'POST',
      headers: { ...headers(ep), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw failure(err);
  }
  if (res.status === 401 || res.status === 403) throw new OpenCodeHttpError(tr('o serviço do OpenCode recusou a senha'), res.status);
  if (res.status === 404) throw new OpenCodeHttpError(tr('a sessão não existe mais no OpenCode'), 404);
  if (res.status === 409) throw new OpenCodeHttpError(tr('a sessão do OpenCode está ocupada e não aceitou a mensagem agora'), 409);
  if (!res.ok) throw new OpenCodeHttpError(tr('o serviço do OpenCode respondeu {0}', [res.status]), res.status);
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/** Um evento do /api/event: `{id, created, type, location?, data}`. */
export interface OpenCodeEvent {
  type: string;
  created?: number;
  data: Record<string, unknown>;
}

/** Separa um stream SSE em eventos (só as linhas `data:`; comentários e heartbeats são ignorados). */
export class SseParser {
  private buf = '';

  push(chunk: string): OpenCodeEvent[] {
    this.buf += chunk.replace(/\r\n?/g, '\n');
    const out: OpenCodeEvent[] = [];
    let cut: number;
    while ((cut = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, cut);
      this.buf = this.buf.slice(cut + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      const ev = parseEvent(data);
      if (ev) out.push(ev);
    }
    // Um bloco gigante sem fim (nunca deveria): descarta para não crescer sem limite.
    if (this.buf.length > 8 * 1024 * 1024) this.buf = '';
    return out;
  }
}

export function parseEvent(raw: string): OpenCodeEvent | undefined {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const type = str(j?.type);
  if (!type) return undefined;
  const data = j.data && typeof j.data === 'object' && !Array.isArray(j.data) ? (j.data as Record<string, unknown>) : {};
  const ev: OpenCodeEvent = { type, data };
  if (typeof j.created === 'number' && Number.isFinite(j.created)) ev.created = j.created;
  return ev;
}

/**
 * Abre o stream de eventos e chama `onEvent` para cada um até o stream fechar (resolve) ou falhar (lança). `signal`
 * encerra. `onOpen` é chamado quando o servidor aceita a conexão.
 */
export async function streamEvents(
  fetchFn: FetchLike,
  ep: OpenCodeEndpoint,
  onEvent: (ev: OpenCodeEvent) => void,
  signal: AbortSignal,
  onOpen?: () => void,
): Promise<void> {
  let res;
  try {
    res = await fetchFn(`${ep.url}/api/event`, { headers: headers(ep, 'text/event-stream'), signal });
  } catch (err) {
    throw failure(err);
  }
  if (res.status === 401 || res.status === 403) throw new OpenCodeHttpError(tr('o serviço do OpenCode recusou a senha'), res.status);
  if (!res.ok || !res.body) throw new OpenCodeHttpError(tr('o serviço do OpenCode respondeu {0}', [res.status]), res.status);
  onOpen?.();
  const parser = new SseParser();
  const decoder = new TextDecoder();
  try {
    for await (const chunk of res.body) for (const ev of parser.push(decoder.decode(chunk, { stream: true }))) onEvent(ev);
  } catch (err) {
    if (signal.aborted) return;
    throw failure(err);
  }
}

/**
 * O OpenCode (v2+, com o serviço em segundo plano) existe nesta máquina? HABBLAUD_OPENCODE_URL definida ou o arquivo de
 * estado do serviço presente (o OpenCode o cria na primeira vez que o serviço sobe).
 */
export function openCodeConfigured(env: NodeJS.ProcessEnv = process.env, home: string = env.HOME || homedir()): boolean {
  if (str(env.HABBLAUD_OPENCODE_URL)) return true;
  try {
    readFileSync(serviceFile(env, home));
    return true;
  } catch {
    return false;
  }
}
