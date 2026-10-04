import { demoProject, type DagEvent, type ServerFrame } from '@dagyard/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectRoom } from '../src/room.js';
import { OWNER, api, json, openLive, seedDemo, type Live } from './helpers.js';

type EventFrame = Extract<ServerFrame, { type: 'event' }>;
const isMessage = (f: ServerFrame): f is EventFrame => f.type === 'event' && f.event.type === 'message.posted';

/** Un error como el que deja un Durable Object reiniciándose por un deploy. */
const restarting = () => Object.assign(new Error('Durable Object reset because its code was updated.'), { retryable: true });

/** Proyecto con una página mirando y el room ya varios eventos por delante de lo que tendrá el proyecto recreado. */
async function projectAhead(): Promise<{ pid: string; seq: number; old: Live }> {
  const s = await seedDemo();
  const pid = s.project.id;
  const old = await openLive(pid);
  await old.waitFor((f) => f.type === 'hello');
  for (const t of ['uno', 'dos', 'tres']) await json(await api(`/api/projects/${pid}/nodes/pagos/messages`, { method: 'POST', body: { text: t } }), 201);
  await old.waitFor((f) => f.type === 'event' && f.event.seq === s.seq + 3);
  return { pid, seq: s.seq, old };
}

const recreate = async (pid: string) => json(await api(`/api/projects/${pid}`, { method: 'PUT', body: demoProject() }), 200);

/** El primer mensaje del proyecto recreado llega en vivo a una página nueva. */
async function expectLive(pid: string, seq: number): Promise<void> {
  const live = await openLive(pid);
  expect(await live.waitFor((f) => f.type === 'hello')).toEqual({ type: 'hello', projectId: pid, seq });
  await json(await api(`/api/projects/${pid}/nodes/pagos/messages`, { method: 'POST', body: { text: 'proyecto nuevo' } }), 201);
  const f = await live.waitFor(isMessage, 2000);
  expect((f.event as Extract<DagEvent, { type: 'message.posted' }>).payload.message.text).toBe('proyecto nuevo');
  expect(f.event.seq).toBe(seq + 1);
  live.ws.close();
}

const closed = (ws: WebSocket) =>
  new Promise<number>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) resolve(-1);
    ws.addEventListener('close', (e) => resolve(e.code));
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('borrar y recrear un proyecto con el mismo id (#61)', () => {
  it('si reset() falla durante el borrado, el dueño reintenta y el proyecto recreado sigue en vivo', async () => {
    const { pid, seq, old } = await projectAhead();
    const gone = closed(old.ws);
    vi.spyOn(ProjectRoom.prototype, 'reset').mockRejectedValueOnce(restarting());

    const first = await api(`/api/projects/${pid}`, { method: 'DELETE', headers: OWNER });
    expect(first.status).toBe(503);
    // el dueño ve «Inténtalo de nuevo» y reintenta: el borrado termina (o ya había terminado)
    const retry = await api(`/api/projects/${pid}`, { method: 'DELETE', headers: OWNER });
    expect(retry.status).toBe(204);
    await json(await api(`/api/projects/${pid}`), 404);
    expect(await gone).toBe(4004);

    await recreate(pid);
    await expectLive(pid, seq);
  });

  it('aunque reset() no llegue a correr, el room se corrige solo y cierra las páginas del proyecto muerto', async () => {
    const { pid, seq, old } = await projectAhead();
    const gone = closed(old.ws);
    // el aviso al room se pierde por completo (p. ej. el Worker murió entre el borrado y el reset)
    vi.spyOn(ProjectRoom.prototype, 'reset').mockResolvedValue(undefined);
    expect((await api(`/api/projects/${pid}`, { method: 'DELETE', headers: OWNER })).status).toBe(204);

    await recreate(pid);
    await expectLive(pid, seq);
    expect(await gone).toBe(4004);
    // la página vieja no recibió nada del proyecto nuevo
    expect(old.frames.filter(isMessage).map((f) => f.event.seq)).toEqual([seq + 1, seq + 2, seq + 3]);
  });

  it('un broadcast de un proyecto recreado que no pasa por un hello también corrige el room', async () => {
    const { pid, seq, old } = await projectAhead();
    const gone = closed(old.ws);
    vi.spyOn(ProjectRoom.prototype, 'reset').mockResolvedValue(undefined);
    expect((await api(`/api/projects/${pid}`, { method: 'DELETE', headers: OWNER })).status).toBe(204);
    // recrear reparte eventos con seq ≤ lastSent: el room lo nota sin esperar a un socket nuevo
    await recreate(pid);
    expect(await gone).toBe(4004);
    expect(old.frames.filter(isMessage).map((f) => f.event.seq)).toEqual([seq + 1, seq + 2, seq + 3]);
    await expectLive(pid, seq);
  });
});
