import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { digest, newSessionId } from '../src/crypto.js';
import { db } from '../src/db.js';
import { AGENT, OWNER, api, json } from './helpers.js';

/** Un «navegador»: inicia sesión con la clave de dueño y devuelve su cookie. */
async function login(): Promise<string> {
  const res = await api('/api/session', { method: 'POST', body: { token: 'test-owner-token' }, headers: {} });
  expect(res.status).toBe(204);
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

const me = (cookie: string) => api('/api/me', { headers: { cookie } });
const idOf = (cookie: string) => cookie.slice('dagyard_session='.length);
const store = () => env.STORE.get(env.STORE.idFromName('db'));

describe('sesiones del navegador (#12)', () => {
  it('la cookie es un id aleatorio, distinto en cada login, que vence a los 30 días', async () => {
    const res = await api('/api/session', { method: 'POST', body: { token: 'test-owner-token' }, headers: {} });
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=2592000/);
    const a = res.headers.get('set-cookie')!.split(';')[0]!;
    const b = await login();
    expect(idOf(a)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    // el Store guarda el SHA-256 del id, nunca el id
    const row = await db(env).prepare('SELECT * FROM sessions WHERE id_hash = ?').bind(await digest(idOf(a))).first<Record<string, string>>();
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain(idOf(a));
    const days = (Date.parse(row!.expires_at!) - Date.parse(row!.created_at!)) / 86_400_000;
    expect(days).toBe(30);
  });

  it('una cookie copiada deja de servir cuando el dueño cierra sesión desde su navegador', async () => {
    const cookie = await login();
    const copia = cookie; // la misma cookie, en otro navegador
    await json(await me(copia), 200);
    const out = await api('/api/session', { method: 'DELETE', headers: { cookie } });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/dagyard_session=;.*Max-Age=0/i);
    expect((await json(await me(copia), 401)).error.code).toBe('unauthorized');
  });

  it('cerrar una sesión no toca las de otros navegadores', async () => {
    const [a, b] = [await login(), await login()];
    await api('/api/session', { method: 'DELETE', headers: { cookie: a } });
    await json(await me(a), 401);
    await json(await me(b), 200);
  });

  it('?all=1 cierra todas las sesiones y exige una credencial de dueño', async () => {
    const [a, b] = [await login(), await login()];
    await json(await api('/api/session?all=1', { method: 'DELETE', headers: {} }), 401);
    await json(await api('/api/session?all=1', { method: 'DELETE', headers: { cookie: 'dagyard_session=falsa' } }), 401);
    expect((await json(await api('/api/session?all=1', { method: 'DELETE', headers: AGENT }), 403)).error.code).toBe('forbidden');
    await json(await me(a), 200);

    const out = await api('/api/session?all=1', { method: 'DELETE', headers: { cookie: a } });
    expect(out.status).toBe(204);
    await json(await me(a), 401);
    await json(await me(b), 401);

    // también con el Bearer del dueño (p. ej. desde el CLI, si se filtró una cookie)
    const c = await login();
    expect((await api('/api/session?all=1', { method: 'DELETE', headers: OWNER })).status).toBe(204);
    await json(await me(c), 401);
  });

  it('una sesión vencida → 401, y se purga', async () => {
    const cookie = await login();
    const hash = await digest(idOf(cookie));
    await db(env).prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').bind(new Date(Date.now() - 1000).toISOString(), hash).run();
    await json(await me(cookie), 401);
    expect(await db(env).prepare('SELECT 1 FROM sessions WHERE id_hash = ?').bind(hash).first()).toBeNull();
  });

  it('abrir sesión purga las vencidas aunque nadie las vuelva a usar', async () => {
    const hash = await digest(newSessionId());
    const past = new Date(Date.now() - 1000).toISOString();
    await db(env).prepare('INSERT INTO sessions (id_hash, owner_fp, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(hash, 'x', past, past).run();
    await login();
    expect(await db(env).prepare('SELECT 1 FROM sessions WHERE id_hash = ?').bind(hash).first()).toBeNull();
  });

  it('una sesión abierta con otro token de dueño (token rotado) → 401', async () => {
    const id = newSessionId();
    await store().openSession(await digest(id), await digest('dagyard-owner-v1:token-anterior'), 60_000);
    await json(await me(`dagyard_session=${id}`), 401);
  });

  it('una cookie del formato viejo (HMAC del token) → 401', async () => {
    // el valor que ponía la versión anterior: HMAC-SHA256 en base64url, 43 caracteres
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode('test-owner-token'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('dagyard-session-v1')));
    const old = btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await json(await me(`dagyard_session=${old}`), 401);
  });

  it('cerrar sesión sin cookie, o con una ya cerrada, responde 204', async () => {
    expect((await api('/api/session', { method: 'DELETE', headers: {} })).status).toBe(204);
    const cookie = await login();
    await api('/api/session', { method: 'DELETE', headers: { cookie } });
    expect((await api('/api/session', { method: 'DELETE', headers: { cookie } })).status).toBe(204);
  });
});
