// Rotas das trocas de modelo e esforço pela gaveta. A trava (mensagens ligadas + Host local, ou o login com
// "messages" liberado no acesso remoto) já foi conferida em http/app.ts.
//
//   POST /api/controls                    {agentId, kind, value, variant?, asDefault?}: 201 ControlState | 400 | 404 | 409 | 429 | 502
//   GET  /api/controls/models?agentId=…   modelos do OpenCode para o agente: 200 {models} | 404 | 409 | 502
//   GET  /api/controls/:id                situação da troca: 200 ControlState | 404
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tr } from '../../shared/i18n';
import { HttpError, readJson, sendJson } from '../http/app';
import { InvalidControl, type ControlRegistry } from './controls';

const ITEM = /^\/api\/controls\/([^/]+)$/;

function fail(res: ServerResponse, err: unknown): void {
  if (res.headersSent) return void res.destroy();
  if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
  else if (err instanceof InvalidControl) sendJson(res, 400, { error: err.message });
  else sendJson(res, 500, { error: tr('erro interno') });
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader('Allow', allow);
  sendJson(res, 405, { error: tr('método não permitido') });
}

export function createControlRoutes(controls: ControlRegistry): (req: IncomingMessage, res: ServerResponse, path: string, url: URL) => void {
  return (req, res, path, url) => {
    const method = req.method ?? 'GET';
    if (path === '/api/controls') {
      if (method !== 'POST') return methodNotAllowed(res, 'POST');
      readJson(req)
        .then((body) => controls.create(body))
        .then((r) => ('control' in r ? sendJson(res, 201, r.control) : sendJson(res, r.status, { error: r.error })))
        .catch((err) => fail(res, err));
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(res, 'GET');
    if (path === '/api/controls/models') {
      controls
        .models(url.searchParams.get('agentId') ?? '')
        .then((r) => ('models' in r ? sendJson(res, 200, r) : sendJson(res, r.status, { error: r.error })))
        .catch((err) => fail(res, err));
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
    const state = controls.get(id);
    if (state) sendJson(res, 200, state);
    else sendJson(res, 404, { error: tr('troca desconhecida: ela já foi resolvida há mais de 10 min ou o Habblaud reiniciou') });
  };
}
