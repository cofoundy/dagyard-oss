import type { Message, ProjectSnapshot } from '@dagyard/model';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Env } from '../src/env.js';
import { ApiFailure } from '../src/http.js';
import { write } from '../src/store.js';
import type { Idem, WriteOp } from '../src/writes.js';
import { api, json, seedDemo } from './helpers.js';

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

  it('una clave inválida → 400', async () => {
    const s = await seedDemo();
    await json(await api(msgPath(s), { method: 'POST', body: { text: 'x' }, headers: keyed('con espacios') }), 400);
  });
});

/** Un Store que falla como lo hace durante un deploy: según `mode`, antes o después de commitear. */
function flakyEnv(failures: Array<'before' | 'after'>, error: object = { retryable: true }) {
  const real = env.STORE.get(env.STORE.idFromName('db'));
  let calls = 0;
  const stub = {
    async write(op: WriteOp, idem?: Idem) {
      const mode = failures[calls++];
      const boom = Object.assign(new Error('Durable Object reset because its code was updated.'), error);
      if (mode === 'before') throw boom;
      const res = await real.write(op, idem);
      if (mode === 'after') throw boom; // commiteó, pero la respuesta se perdió
      return res;
    },
  };
  const fake = { STORE: { idFromName: (n: string) => env.STORE.idFromName(n), get: () => stub }, PROJECT_ROOM: env.PROJECT_ROOM } as unknown as Env;
  return { env: fake, calls: () => calls };
}

describe('write(): el Store no disponible (#54)', () => {
  const NO_WAIT = [0, 0, 0];
  const msgOp = (s: ProjectSnapshot, text: string) =>
    ({ kind: 'postMessage', pid: s.project.id, nid: s.nodes[0]!.id, input: { text }, actor: 'agent' }) as const;

  it('con clave, un reset después de commitear se reintenta y no duplica el mensaje', async () => {
    const s = await seedDemo();
    const text = 'Reset tras el commit.';
    const f = flakyEnv(['after']);
    const m = await write(f.env, msgOp(s, text), crypto.randomUUID(), NO_WAIT);
    expect(f.calls()).toBe(2);
    expect(await messagesOf(s.project.id, text)).toEqual([m]);
  });

  it('con clave, un reset antes de commitear se reintenta y escribe una vez', async () => {
    const s = await seedDemo();
    const text = 'Reset antes del commit.';
    const f = flakyEnv(['before', 'before']);
    await write(f.env, msgOp(s, text), crypto.randomUUID(), NO_WAIT);
    expect(f.calls()).toBe(3);
    expect(await messagesOf(s.project.id, text)).toHaveLength(1);
  });

  it('sin clave, un msg no se reintenta: 503 unavailable que dice que no sabe si quedó', async () => {
    const s = await seedDemo();
    const f = flakyEnv(['before']);
    const err = await write(f.env, msgOp(s, 'sin clave'), undefined, NO_WAIT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiFailure);
    expect((err as ApiFailure).code).toBe('unavailable');
    expect((err as ApiFailure).status).toBe(503);
    expect((err as ApiFailure).message).toMatch(/no sé si la escritura quedó/);
    expect(f.calls()).toBe(1);
  });

  it('sin clave, un PATCH (repetible) sí se reintenta', async () => {
    const s = await seedDemo();
    const nid = s.nodes.find((n) => n.status === 'pending')!.id;
    const f = flakyEnv(['after']);
    const node = await write(f.env, { kind: 'patchNode', pid: s.project.id, nid, patch: { progress: 0.5 }, actor: 'agent' }, undefined, NO_WAIT);
    expect(node.progress).toBe(0.5);
    expect(f.calls()).toBe(2);
  });

  it('sobrecargado no se reintenta (empeoraría): 503', async () => {
    const s = await seedDemo();
    const f = flakyEnv(['before'], { retryable: true, overloaded: true });
    const err = await write(f.env, msgOp(s, 'sobrecarga'), crypto.randomUUID(), NO_WAIT).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe('unavailable');
    expect(f.calls()).toBe(1);
  });

  it('agotados los reintentos: 503 unavailable, no 500', async () => {
    const s = await seedDemo();
    const f = flakyEnv(['before', 'before', 'before', 'before']);
    const err = await write(f.env, msgOp(s, 'nunca'), crypto.randomUUID(), NO_WAIT).catch((e: unknown) => e);
    expect((err as ApiFailure).code).toBe('unavailable');
    expect(f.calls()).toBe(4);
    expect(await messagesOf(s.project.id, 'nunca')).toHaveLength(0);
  });

  it('un error que no es de disponibilidad sigue siendo un error (500)', async () => {
    const s = await seedDemo();
    const f = flakyEnv(['before'], {});
    const err = await write(f.env, msgOp(s, 'bug'), crypto.randomUUID(), NO_WAIT).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiFailure);
    expect(f.calls()).toBe(1);
  });
});
