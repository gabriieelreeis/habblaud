// Rotas de /api/permissions (responder pelo escritório). A trava (bind local + Host local) já foi
// conferida em http/app.ts; o guard (http/guard.ts) já exigiu JSON e Origin local nos POST (contra CSRF).
//
//   GET  /api/permissions/settings        (página)  {returnWhenUnwatched}: a opção salva no servidor
//   POST /api/permissions/settings        (página)  {returnWhenUnwatched: boolean}: muda e salva a opção
//   POST /api/permissions                 (hook)    registra o pedido: 201 {id, expiresAt} ou 200 {skip}
//                                                   (o hook do Codex manda também provider: "codex", account e codexHome)
//                                                   (os do OpenCode não passam por aqui: a fonte dele os registra)
//   GET  /api/permissions/:id/wait        (hook)    long-poll: {status: pending | decided | released}
//   GET  /api/permissions/:id             (página)  detalhe com os argumentos (comando, diff...)
//   POST /api/permissions/:id/decision    (página)  {behavior: allow | deny | terminal | answer, message?, answers?, ...}
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from '../http/app';
import { InvalidRequest, parseDecision, WAIT_MAX_MS, type PermissionRegistry } from './registry';
import type { PermissionSettingsStore } from './settings';
import { tr } from '../../shared/i18n';

const ITEM = /^\/api\/permissions\/([^/]+)(?:\/(wait|decision))?$/;

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader('Allow', allow);
  sendJson(res, 405, { error: tr('método não permitido') });
}

function fail(res: ServerResponse, err: unknown): void {
  if (res.headersSent) return void res.destroy();
  if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
  else if (err instanceof InvalidRequest) sendJson(res, 400, { error: err.message });
  else sendJson(res, 500, { error: tr('erro interno') });
}

/** Tempo de espera pedido em `?timeout=` (segundos), limitado a WAIT_MAX_MS. */
export function waitMs(url: URL): number {
  const raw = Number(url.searchParams.get('timeout'));
  if (!Number.isFinite(raw) || raw <= 0) return WAIT_MAX_MS;
  return Math.min(WAIT_MAX_MS, Math.max(50, raw * 1_000));
}

export function createPermissionRoutes(registry: PermissionRegistry, settings?: PermissionSettingsStore): (req: IncomingMessage, res: ServerResponse, path: string) => void {
  const register = async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readJson(req);
    const r = registry.register(body);
    if ('skip' in r) sendJson(res, 200, { skip: r.skip });
    else sendJson(res, 201, r);
  };

  const wait = (req: IncomingMessage, res: ServerResponse, id: string) => {
    const w = registry.wait(id, waitMs(new URL(req.url ?? '/', 'http://localhost')));
    if (!w) return sendJson(res, 404, { error: tr('pedido desconhecido') });
    req.socket.setTimeout(0);
    // Conexão fechada antes da resposta (o hook morreu ou desistiu): larga a espera.
    res.on('close', () => {
      if (!res.writableEnded) w.cancel();
    });
    w.result.then(
      (result) => {
        if (!res.destroyed && !res.writableEnded) sendJson(res, 200, result);
      },
      (err) => fail(res, err),
    );
  };

  const decide = async (req: IncomingMessage, res: ServerResponse, id: string) => {
    const d = parseDecision(await readJson(req));
    if (!d) {
      throw new HttpError(400, 'esperado {behavior: "allow" | "deny" | "terminal", message?, interrupt?, suggestion?} ou {behavior: "answer", answers: [{question, options?, other?}]}');
    }
    // Pedido do OpenCode: a decisão vai ao serviço dele antes de responder (decideAsync espera).
    const provider = registry.detail(id)?.provider;
    const r = await registry.decideAsync(id, d);
    if (typeof r === 'object') return sendJson(res, 502, { error: tr('o OpenCode não recebeu a resposta ({0}); responda no próprio OpenCode', [r.error]) });
    switch (r) {
      case 'ok':
        return sendJson(res, 200, { ok: true });
      case 'not-found':
        return sendJson(res, 404, { error: tr('pedido desconhecido: já foi respondido, expirou ou foi respondido no terminal') });
      case 'conflict':
        return sendJson(res, 409, { error: tr('este pedido já foi respondido') });
      case 'invalid':
        return sendJson(res, 400, { error: tr('sugestão de regra desconhecida para este pedido') });
      case 'invalid-answer':
        return sendJson(res, 400, { error: tr('resposta que não serve para este pedido: pergunta se responde com "answer" (cada pergunta uma vez, com as opções dela); os outros pedidos, com "allow" ou "deny"') });
      case 'unsupported':
        if (provider === 'opencode') return sendJson(res, 400, { error: tr('o OpenCode não aceita interromper nem "responder no terminal" pelo Habblaud: aprove, recuse (com um motivo, se quiser) ou responda no próprio OpenCode') });
        return sendJson(res, 400, { error: tr('o Codex não aceita interromper nem "sempre permitir" pelo Habblaud: aprove, recuse (com um motivo, se quiser) ou responda no terminal') });
    }
  };

  const changeSetting = async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readJson(req);
    const b = body as { returnWhenUnwatched?: unknown } | null;
    if (typeof b?.returnWhenUnwatched !== 'boolean') throw new HttpError(400, tr('esperado {returnWhenUnwatched: boolean}'));
    settings!.set(b.returnWhenUnwatched);
    sendJson(res, 200, { ok: true, ...settings!.get() });
  };

  return (req, res, path) => {
    const method = req.method ?? 'GET';
    if (path === '/api/permissions/settings') {
      if (!settings) return sendJson(res, 404, { error: tr('rota desconhecida') });
      if (method === 'GET' || method === 'HEAD') return sendJson(res, 200, settings.get());
      if (method !== 'POST') return methodNotAllowed(res, 'GET, POST');
      return void changeSetting(req, res).catch((err) => fail(res, err));
    }
    if (path === '/api/permissions') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      register(req, res).catch((err) => fail(res, err));
      return;
    }
    const m = ITEM.exec(path);
    if (!m) return sendJson(res, 404, { error: tr('rota desconhecida') });
    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      return sendJson(res, 400, { error: tr('id inválido') });
    }
    if (m[2] === 'wait') {
      if (method !== 'GET') return methodNotAllowed(res, 'GET');
      return wait(req, res, id);
    }
    if (m[2] === 'decision') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      decide(req, res, id).catch((err) => fail(res, err));
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res, 'GET');
    const detail = registry.detail(id);
    if (detail) sendJson(res, 200, detail);
    else sendJson(res, 404, { error: tr('pedido desconhecido') });
  };
}
