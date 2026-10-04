import type { Message, ProjectSnapshot } from '@dagyard/model';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { db } from '../src/db.js';
import type { Env } from '../src/env.js';
import { ApiFailure } from '../src/http.js';
import { STORE_RETRY_MS, jitter, write } from '../src/store.js';
import type { Idem, WriteOp } from '../src/writes.js';
import { BASE, api, json, seedDemo } from './helpers.js';
import { SELF } from 'cloudflare:test';

const msgPath = (s: ProjectSnapshot) => `/api/projects/${s.project.id}/nodes/${s.nodes[0]!.id}/messages`;
const messagesOf = async (pid: string, text: string) =>
  (await json<ProjectSnapshot>(await api(`/api/projects/${pid}`), 200)).messages.filter((m) => m.text === text);
const keyed = (key: string) => ({ authorization: 'Bearer test-agent-key', 'idempotency-key': key });

describe('Idempotency-Key (#54)', () => {
  it('un msg repetido con la misma clave no se duplica: devuelve el mismo mensaje', async () => {
    const s = await seedDemo();
    const key = crypto.randomUUID();
    const text = 'Ya conecté la pasarela.';
    const first = await json<Message>(await api(msgPath(s), { method: 'POST', body: { text }, headers: keyed(key) }), 201);
    const again = await json<Message>(await api(msgPath(s), { method: 'POST', body: { text }, headers: keyed(key) }), 201);
    expect(again).toEqual(first);
    expect(await messagesOf(s.project.id, text)).toHaveLength(1);
    // la reproducción no inventa eventos nuevos: el único message.posted es el de la primera vez
    const { events } = await json<{ events: { type: string }[] }>(await api(`/api/projects/${s.project.id}/events?since=${s.seq}`), 200);
    expect(events.filter((e) => e.type === 'message.posted')).toHaveLength(1);
  });

  it('sin clave, dos POST iguales son dos mensajes; con claves distintas, también', async () => {
    const s = await seedDemo();
    const text = 'Dos veces a propósito.';
    await json(await api(msgPath(s), { method: 'POST', body: { text } }), 201);
    await json(await api(msgPath(s), { method: 'POST', body: { text } }), 201);
    await json(await api(msgPath(s), { method: 'POST', body: { text }, headers: keyed(crypto.randomUUID()) }), 201);
    expect(await messagesOf(s.project.id, text)).toHaveLength(3);
  });

  it('la misma clave con otra escritura → 409, sin escribir', async () => {
    const s = await seedDemo();
    const key = crypto.randomUUID();
    await json(await api(msgPath(s), { method: 'POST', body: { text: 'uno' }, headers: keyed(key) }), 201);
    const err = await json<{ error: { code: string } }>(await api(msgPath(s), { method: 'POST', body: { text: 'otro' }, headers: keyed(key) }), 409);
    expect(err.error.code).toBe('conflict');
    expect(await messagesOf(s.project.id, 'otro')).toHaveLength(0);
  });

  it('una escritura que falla no gasta la clave: el reintento corre de verdad', async () => {
    const s = await seedDemo();
    const key = crypto.randomUUID();
    await json(await api(`/api/projects/${s.project.id}/nodes/no-existe/messages`, { method: 'POST', body: { text: 'x' }, headers: keyed(key) }), 404);
    await json(await api(`/api/projects/${s.project.id}/nodes/no-existe/messages`, { method: 'POST', body: { text: 'x' }, headers: keyed(key) }), 404);
  });

  it('la huella es del pedido crudo: los mismos datos con otros bytes, u otra ruta, con la misma clave → 409', async () => {
    const s = await seedDemo();
    const key = crypto.randomUUID();
    const path = msgPath(s);
    const raw = (body: string) => SELF.fetch(`${BASE}${path}`, { method: 'POST', headers: { ...keyed(key), 'content-type': 'application/json' }, body });
    await json(await raw('{"text":"crudo","from":"Ana"}'), 201);
    await json(await raw('{"text":"crudo","from":"Ana"}'), 201);
    await json(await raw('{"from":"Ana","text":"crudo"}'), 409);
    const other = `/api/projects/${s.project.id}/nodes/${s.nodes[1]!.id}/messages`;
    await json(await api(other, { method: 'POST', body: { text: 'crudo', from: 'Ana' }, headers: keyed(key) }), 409);
    expect(await messagesOf(s.project.id, 'crudo')).toHaveLength(1);
  });

  it('resolver un acceso con la misma clave reproduce la respuesta (el valor va en la huella, nunca en claro)', async () => {
    const s = await seedDemo();
    const b = s.blockers.find((x) => x.kind === 'access' && x.status === 'open')!;
    const path = `/api/projects/${s.project.id}/blockers/${b.id}/resolve`;
    const headers = { authorization: 'Bearer test-owner-token', 'idempotency-key': crypto.randomUUID() };
    const first = await json(await api(path, { method: 'POST', body: { value: 'sk_live_123' }, headers }), 200);
    expect(await json(await api(path, { method: 'POST', body: { value: 'sk_live_123' }, headers }), 200)).toEqual(first);
    await json(await api(path, { method: 'POST', body: { value: 'otro' }, headers }), 409);
    const rows = await db(env).prepare('SELECT fp FROM idempotency WHERE key = ?').bind(headers['idempotency-key']).all<{ fp: string }>();
    expect(rows.results[0]!.fp).not.toContain('sk_live_123');
  });

  it('una clave inválida → 400', async () => {
    const s = await seedDemo();
    await json(await api(msgPath(s), { method: 'POST', body: { text: 'x' }, headers: keyed('con espacios') }), 400);
  });
});

/** Un Store que falla como lo hace durante un deploy, intento por intento: se reinicia antes o después de commitear, o responde. */
function flakyEnv(steps: Array<'before' | 'after' | 'ok'>, error: object = { retryable: true }) {
  const real = env.STORE.get(env.STORE.idFromName('db'));
  let calls = 0;
  const stub = {
    async write(op: WriteOp, idem?: Idem) {
      const step = steps[calls++] ?? 'ok';
      const boom = Object.assign(new Error('Durable Object reset because its code was updated.'), error);
      if (step === 'before') throw boom;
      const res = await real.write(op, idem);
      if (step === 'after') throw boom; // commiteó, pero la respuesta se perdió
      return res;
    },
  };
  const fake = { STORE: { idFromName: (n: string) => env.STORE.idFromName(n), get: () => stub }, PROJECT_ROOM: env.PROJECT_ROOM } as unknown as Env;
  return { env: fake, calls: () => calls };
}

const NO_WAIT = [0, 0, 0];
const idem = (fp = 'fp-de-prueba'): Idem => ({ key: crypto.randomUUID(), fp });
const msgOp = (s: ProjectSnapshot, text: string, from?: string) =>
  ({ kind: 'postMessage', pid: s.project.id, nid: s.nodes[0]!.id, input: { text, ...(from && { from }) }, actor: 'agent' }) as const;

describe('write(): el Store no disponible (#54)', () => {
  it('con clave, un reset después de commitear se reintenta y no duplica el mensaje', async () => {
    const s = await seedDemo();
    const text = 'Reset tras el commit.';
    const f = flakyEnv(['after']);
    const m = await write(f.env, msgOp(s, text), idem(), NO_WAIT);
    expect(f.calls()).toBe(2);
    expect(await messagesOf(s.project.id, text)).toEqual([m]);
  });

  it('con clave, un reset antes de commitear se reintenta y escribe una vez', async () => {
    const s = await seedDemo();
    const text = 'Reset antes del commit.';
    const f = flakyEnv(['before', 'before']);
    await write(f.env, msgOp(s, text), idem(), NO_WAIT);
    expect(f.calls()).toBe(3);
    expect(await messagesOf(s.project.id, text)).toHaveLength(1);
  });

  it('la huella es la del pedido, no la del op: otra versión del Worker que lo parsea distinto reproduce igual', async () => {
    const s = await seedDemo();
    const text = 'Parseado por dos versiones.';
    const i = idem();
    const f = flakyEnv(['ok', 'ok']);
    const first = await write(f.env, msgOp(s, text), i, NO_WAIT);
    // la versión nueva agrega un campo al op (aquí, la firma): misma clave, mismo pedido crudo
    const again = await write(f.env, msgOp(s, text, 'Equipo nuevo'), i, NO_WAIT);
    expect(again).toEqual(first);
    expect(await messagesOf(s.project.id, text)).toHaveLength(1);
  });

  it('sin clave, un msg no se reintenta: 503 uncertain, «no sé si quedó»', async () => {
    const s = await seedDemo();
    const f = flakyEnv(['before']);
    const err = await write(f.env, msgOp(s, 'sin clave'), undefined, NO_WAIT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).code).toBe('uncertain');
    expect((err as ApiFailure).status).toBe(503);
    expect((err as ApiFailure).message).toMatch(/no sé si quedó/);
    expect(f.calls()).toBe(1);
  });

  it('sin clave, un PATCH tampoco se reintenta: reaplicarlo podría pisar una escritura posterior', async () => {
    const s = await seedDemo();
    const nid = s.nodes.find((n) => n.status === 'pending')!.id;
    const f = flakyEnv(['after']);
    const err = await write(f.env, { kind: 'patchNode', pid: s.project.id, nid, patch: { status: 'working' }, actor: 'agent' }, undefined, NO_WAIT).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe('uncertain');
    expect(f.calls()).toBe(1);
  });

  it('sobrecargado no se reintenta (empeoraría): 503 overloaded, distinto de unavailable', async () => {
    const s = await seedDemo();
    const f = flakyEnv(['before'], { retryable: true, overloaded: true });
    const err = await write(f.env, msgOp(s, 'sobrecarga'), idem(), NO_WAIT).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe('overloaded');
    expect((err as ApiFailure).status).toBe(503);
    expect(f.calls()).toBe(1);
  });

  it('agotados los reintentos: 503 unavailable, no 500', async () => {
    const s = await seedDemo();
    const f = flakyEnv(['before', 'before', 'before', 'before']);
    const err = await write(f.env, msgOp(s, 'nunca'), idem(), NO_WAIT).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe('unavailable');
    expect(f.calls()).toBe(4);
    expect(await messagesOf(s.project.id, 'nunca')).toHaveLength(0);
  });

  it('un error que no es de disponibilidad sigue siendo un error (500)', async () => {
    const s = await seedDemo();
    const f = flakyEnv(['before'], {});
    const err = await write(f.env, msgOp(s, 'bug'), idem(), NO_WAIT).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiFailure);
    expect(f.calls()).toBe(1);
  });
});
