import { describe, expect, it } from 'vitest';
import { AGENT, OWNER, api, json } from './helpers.js';

describe('health y auth', () => {
  it('health responde sin credencial', async () => {
    expect(await json(await api('/api/health', { headers: {} }), 200)).toEqual({ ok: true, version: 'dev' });
  });

  it('401 sin credencial o con una inválida, con el formato de error del contrato', async () => {
    const none = await json(await api('/api/projects', { headers: {} }), 401);
    expect(none.error.code).toBe('unauthorized');
    expect(typeof none.error.message).toBe('string');
    await json(await api('/api/projects', { headers: { authorization: 'Bearer nope' } }), 401);
    await json(await api('/api/projects', { headers: { authorization: 'Basic abc' } }), 401);
  });

  it('200 con owner y con agent; /api/me dice el rol', async () => {
    await json(await api('/api/projects', { headers: OWNER }), 200);
    await json(await api('/api/projects', { headers: AGENT }), 200);
    expect(await json(await api('/api/me', { headers: OWNER }), 200)).toEqual({ role: 'owner' });
    expect(await json(await api('/api/me', { headers: AGENT }), 200)).toEqual({ role: 'agent' });
  });

  it('POST /api/session pone la cookie y la cookie autentica como owner', async () => {
    await json(await api('/api/session', { method: 'POST', body: { token: 'malo' }, headers: {} }), 401);
    // la clave del agente no abre sesión de navegador
    await json(await api('/api/session', { method: 'POST', body: { token: 'test-agent-key' }, headers: {} }), 401);

    const res = await api('/api/session', { method: 'POST', body: { token: 'test-owner-token' }, headers: {} });
    expect(res.status).toBe(204);
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^__Host-dagyard_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    // la cookie no es el token
    expect(setCookie).not.toContain('test-owner-token');

    const cookie = setCookie.split(';')[0]!;
    expect(await json(await api('/api/me', { headers: { cookie } }), 200)).toEqual({ role: 'owner' });
    await json(await api('/api/me', { headers: { cookie: '__Host-dagyard_session=falsa' } }), 401);

    const out = await api('/api/session', { method: 'DELETE', headers: { cookie } });
    expect(out.status).toBe(204);
    expect(out.headers.get('set-cookie')).toMatch(/__Host-dagyard_session=;.*Max-Age=0/i);
  });

  it('?token= no sirve fuera del WebSocket', async () => {
    await json(await api('/api/projects?token=test-agent-key', { headers: {} }), 401);
  });

  it('ruta de API inexistente → 404 not_found', async () => {
    expect((await json(await api('/api/nada'), 404)).error.code).toBe('not_found');
  });
});
