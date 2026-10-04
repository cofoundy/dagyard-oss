import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { originAllowed } from '../src/auth.js';
import type { Env } from '../src/env.js';
import { BASE, OWNER, api, seedDemo } from './helpers.js';

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
    expect(await upgrade(project.id, { cookie: 'dagyard_session=falsa', origin: BASE })).toBe(401);
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
