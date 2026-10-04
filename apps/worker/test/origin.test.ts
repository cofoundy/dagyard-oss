import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { originAllowed } from '../src/auth.js';
import type { Env } from '../src/env.js';
import { AGENT, BASE, OWNER, api, json, seedDemo } from './helpers.js';

async function login(): Promise<string> {
  const res = await api('/api/session', { method: 'POST', body: { token: 'test-owner-token' }, headers: {} });
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

/** Pide el upgrade del WebSocket (y lo cierra si se abrió); devuelve el status. */
async function upgrade(pid: string, headers: Record<string, string>, query = ''): Promise<number> {
  const res = await SELF.fetch(`${BASE}/api/projects/${pid}/live${query}`, { headers: { upgrade: 'websocket', ...headers } });
  if (res.webSocket) {
    res.webSocket.accept();
    res.webSocket.close();
  }
  return res.status;
}

describe('Origin en el upgrade del WebSocket (#14)', () => {
  it('con cookie: Origin ajeno → 403; sin Origin → 403; mismo origen → 101', async () => {
    const { project } = await seedDemo();
    const cookie = await login();
    const evil = await SELF.fetch(`${BASE}/api/projects/${project.id}/live`, { headers: { upgrade: 'websocket', cookie, origin: 'https://evil.example' } });
    expect(evil.status).toBe(403);
    expect(evil.webSocket).toBeNull();
    expect(((await evil.json()) as { error: { code: string } }).error.code).toBe('forbidden');
    expect(await upgrade(project.id, { cookie })).toBe(403);
    // un subdominio hermano, o el mismo host por http, no es el mismo origen
    expect(await upgrade(project.id, { cookie, origin: 'https://hermano.dagyard.test' })).toBe(403);
    expect(await upgrade(project.id, { cookie, origin: 'http://dagyard.test' })).toBe(403);
    expect(await upgrade(project.id, { cookie, origin: BASE })).toBe(101);
  });

  it('con cookie: los orígenes de ALLOWED_ORIGINS valen', async () => {
    const { project } = await seedDemo();
    const cookie = await login();
    expect(await upgrade(project.id, { cookie, origin: 'https://app.dagyard.test' })).toBe(101);
    expect(await upgrade(project.id, { cookie, origin: 'https://otro.dagyard.test' })).toBe(101);
  });

  it('una cookie inválida sigue siendo 401 aunque el Origin sea bueno', async () => {
    const { project } = await seedDemo();
    expect(await upgrade(project.id, { cookie: '__Host-dagyard_session=falsa', origin: BASE })).toBe(401);
  });

  it('Bearer, subprotocolo y ?token= no miran el Origin', async () => {
    const { project } = await seedDemo();
    expect(await upgrade(project.id, OWNER)).toBe(101);
    expect(await upgrade(project.id, { ...OWNER, origin: 'https://evil.example' })).toBe(101);
    expect(await upgrade(project.id, { 'sec-websocket-protocol': 'dagyard, token.test-agent-key', origin: 'https://evil.example' })).toBe(101);
    expect(await upgrade(project.id, {}, '?token=test-agent-key')).toBe(101);
  });

  it('el resto de la API con cookie no cambia (sin Origin)', async () => {
    const cookie = await login();
    expect((await api('/api/me', { headers: { cookie } })).status).toBe(200);
  });

  it('origen opaco (`null`, file:, data:) nunca vale, ni desde ALLOWED_ORIGINS', () => {
    const env = { ALLOWED_ORIGINS: 'null, file:///tmp/x, data:text/html,hola' } as Env;
    for (const origin of ['null', 'file:///tmp/y', 'data:text/html,chau', 'file://localhost/x']) {
      expect(originAllowed(env, 'https://dagyard.test/api/projects/x/live', origin)).toBe(false);
      expect(originAllowed(env, 'http://localhost:8787/api/projects/x/live', origin)).toBe(false);
    }
  });

  it('dev: si se pide a localhost, cualquier origen localhost vale; nada más', () => {
    const env = { ALLOWED_ORIGINS: '' } as Env;
    expect(originAllowed(env, 'http://127.0.0.1:8787/api/projects/x/live', 'http://localhost:5173')).toBe(true);
    expect(originAllowed(env, 'http://localhost:8787/api/projects/x/live', 'http://127.0.0.1:5173')).toBe(true);
    expect(originAllowed(env, 'http://localhost:8787/api/projects/x/live', 'https://evil.example')).toBe(false);
    // un Worker remoto no acepta localhost
    expect(originAllowed(env, 'https://dagyard.cofoundy-dev.workers.dev/api/projects/x/live', 'http://localhost:5173')).toBe(false);
    expect(originAllowed(env, 'https://dagyard.test/x', 'null')).toBe(false);
    expect(originAllowed(env, 'https://dagyard.test/x', undefined)).toBe(false);
  });
});

/** Una escritura «simple» (sin preflight de CORS): lo que podría mandar un Worker hermano con la cookie. */
const simplePost = (path: string, body: unknown, headers: Record<string, string>) =>
  SELF.fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body: JSON.stringify(body) });

describe('CSRF: escrituras con la cookie (revisión adversarial)', () => {
  it('Origin ajeno u opaco con cookie → 403 y no escribe; mismo origen o sin Origin → pasa', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const cookie = await login();
    const decision = s.blockers.find((b) => b.kind === 'decision')!;
    // el ataque del hallazgo: un hermano en *.workers.dev resuelve un bloqueante con la sesión del dueño
    const evil = await simplePost(`/api/projects/${pid}/blockers/${decision.id}/resolve`, { choice: 1 }, { cookie, origin: 'https://otro-worker.cofoundy-dev.workers.dev' });
    expect(evil.status).toBe(403);
    expect(((await evil.json()) as { error: { code: string } }).error.code).toBe('forbidden');
    expect((await simplePost(`/api/projects/${pid}/nodes/pagos/messages`, { text: 'x' }, { cookie, origin: 'null' })).status).toBe(403);
    const after = await json(await api(`/api/projects/${pid}`, { headers: OWNER }), 200);
    expect(after.seq).toBe(s.seq);

    expect((await simplePost(`/api/projects/${pid}/nodes/pagos/messages`, { text: 'mismo origen' }, { cookie, origin: BASE })).status).toBe(201);
    expect((await simplePost(`/api/projects/${pid}/nodes/pagos/messages`, { text: 'permitido' }, { cookie, origin: 'https://app.dagyard.test' })).status).toBe(201);
    // sin Origin (curl, mismo origen en navegadores viejos): pasa
    expect((await simplePost(`/api/projects/${pid}/nodes/pagos/messages`, { text: 'sin origin' }, { cookie })).status).toBe(201);
  });

  it('las lecturas con cookie no miran el Origin, y Bearer tampoco en escrituras', async () => {
    const s = await seedDemo();
    const cookie = await login();
    expect((await api(`/api/projects/${s.project.id}`, { headers: { cookie, origin: 'https://evil.example' } })).status).toBe(200);
    expect((await simplePost(`/api/projects/${s.project.id}/nodes/pagos/messages`, { text: 'cli' }, { ...AGENT, origin: 'https://evil.example' })).status).toBe(201);
  });

  it('?all=1 con cookie desde un origen ajeno → 403 y no cierra nada', async () => {
    const cookie = await login();
    const res = await SELF.fetch(`${BASE}/api/session?all=1`, { method: 'DELETE', headers: { cookie, origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect((await api('/api/me', { headers: { cookie } })).status).toBe(200);
  });
});
