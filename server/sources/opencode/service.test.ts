// Cliente do serviço do OpenCode: onde ele está, a senha (nunca fora do cabeçalho) e o stream de eventos.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getJson, openCodeConfigured, OpenCodeHttpError, resolveEndpoint, rewriteHost, serviceFile, SseParser, type FetchLike } from './service';

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function home(): string {
  const d = mkdtempSync(join(tmpdir(), 'habblaud-oc-'));
  dirs.push(d);
  return d;
}

describe('OpenCode: onde está o serviço', () => {
  it('o arquivo de estado do serviço (padrão, XDG_STATE_HOME ou HABBLAUD_OPENCODE_SERVICE_FILE)', () => {
    expect(serviceFile({}, '/h')).toBe(join('/h', '.local', 'state', 'opencode', 'service.json'));
    expect(serviceFile({ XDG_STATE_HOME: '/s' }, '/h')).toBe(join('/s', 'opencode', 'service.json'));
    expect(serviceFile({ HABBLAUD_OPENCODE_SERVICE_FILE: '/opencode/service.json' }, '/h')).toBe('/opencode/service.json');
  });

  it('lê url e senha do arquivo; no Docker troca o host local pelo host.docker.internal', () => {
    const h = home();
    mkdirSync(join(h, '.local', 'state', 'opencode'), { recursive: true });
    writeFileSync(join(h, '.local', 'state', 'opencode', 'service.json'), JSON.stringify({ id: 'x', url: 'http://127.0.0.1:28894', pid: 1, password: 'segredo' }));
    expect(openCodeConfigured({}, h)).toBe(true);
    expect(resolveEndpoint({}, h)).toMatchObject({ url: 'http://127.0.0.1:28894', password: 'segredo' });
    expect(resolveEndpoint({ HABBLAUD_OPENCODE_HOST: 'host.docker.internal' }, h)).toMatchObject({ url: 'http://host.docker.internal:28894' });
  });

  it('HABBLAUD_OPENCODE_URL vence o arquivo', () => {
    expect(resolveEndpoint({ HABBLAUD_OPENCODE_URL: 'http://localhost:9/', HABBLAUD_OPENCODE_PASSWORD: 'p' }, home())).toEqual({ url: 'http://localhost:9', password: 'p', origin: 'env' });
  });

  it('sem o arquivo: o motivo, sem lançar', () => {
    const h = home();
    expect(openCodeConfigured({}, h)).toBe(false);
    const r = resolveEndpoint({}, h);
    expect('error' in r && r.error).toMatch(/nunca iniciado/);
  });

  it('rewriteHost só troca endereços locais', () => {
    expect(rewriteHost('http://127.0.0.1:1', 'h')).toBe('http://h:1');
    expect(rewriteHost('http://localhost:1', 'h')).toBe('http://h:1');
    expect(rewriteHost('http://10.0.0.2:1', 'h')).toBe('http://10.0.0.2:1');
    expect(rewriteHost('http://127.0.0.1:1', undefined)).toBe('http://127.0.0.1:1');
  });
});

describe('OpenCode: chamadas', () => {
  it('a senha vai só no cabeçalho Authorization (Basic, usuário opencode)', async () => {
    let seen: { url: string; headers?: Record<string, string> } | undefined;
    const fetchFn: FetchLike = async (url, init) => {
      seen = { url, headers: init?.headers };
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    };
    await expect(getJson(fetchFn, { url: 'http://x', password: 'segredo', origin: 'env' }, '/api/info')).resolves.toEqual({ ok: 1 });
    expect(seen?.url).toBe('http://x/api/info');
    expect(seen?.headers?.authorization).toBe(`Basic ${Buffer.from('opencode:segredo').toString('base64')}`);
  });

  it('401 e fora do ar viram OpenCodeHttpError com motivo legível (sem a senha)', async () => {
    const denied: FetchLike = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const err = await getJson(denied, { url: 'http://x', password: 'segredo', origin: 'env' }, '/a').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenCodeHttpError);
    expect((err as Error).message).toMatch(/senha/);
    expect((err as Error).message).not.toContain('segredo');
    const down: FetchLike = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    await expect(getJson(down, { url: 'http://x', origin: 'env' }, '/a')).rejects.toThrow(/fora do ar/);
  });
});

describe('OpenCode: stream de eventos (SSE)', () => {
  it('junta os pedaços, ignora heartbeats e linhas inválidas', () => {
    const p = new SseParser();
    expect(p.push('data: {"id":"e1","type":"server.connected","data":{}}\n\n: heartbeat\n\ndata: {"type":"session.execution.st')).toEqual([{ type: 'server.connected', data: {} }]);
    expect(p.push('arted","created":5,"data":{"sessionID":"ses_abcdefgh"}}\r\n\r\ndata: nada\n\n')).toEqual([{ type: 'session.execution.started', created: 5, data: { sessionID: 'ses_abcdefgh' } }]);
  });
});
