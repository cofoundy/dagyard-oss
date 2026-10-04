import { demoProject, demoProjectId, type DagEvent, type DemoLang, type ProjectSnapshot, type ServerFrame } from '@dagyard/model';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import { PULSE_IDLE_LIMIT_MS, REPLAY_LIMIT } from '../src/room.js';
import { OWNER, api, json, openLive, seedDemo, type Live } from './helpers.js';

type EventFrame = Extract<ServerFrame, { type: 'event' }>;
const events = (live: Live) => live.frames.filter((f): f is EventFrame => f.type === 'event').map((f) => f.event);

const roomOf = (pid: string) => env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(pid));
const storeStub = () => env.STORE.get(env.STORE.idFromName('db'));
const alarmOf = (pid: string) => runInDurableObject(roomOf(pid), (_, state) => state.storage.getAlarm());
const snap = async (pid: string) => json<ProjectSnapshot>(await api(`/api/projects/${pid}`), 200);
const sql = <T = Record<string, unknown>>(q: string, ...p: Array<string | number>) =>
  runInDurableObject(storeStub(), (_, state) => state.storage.sql.exec(q, ...p).toArray() as T[]);

const closed = (ws: WebSocket) => {
  let code: number | null = null;
  ws.addEventListener('close', (e) => (code = e.code));
  return () => code;
};

const opened: Live[] = [];
async function watch(pid: string, query = ''): Promise<Live> {
  const live = await openLive(pid, query);
  opened.push(live);
  await live.waitFor((f) => f.type === 'hello');
  return live;
}

afterEach(async () => {
  for (const l of opened.splice(0)) l.ws.close();
});

/** La demo de ese idioma recién sembrada por el dueño, con su room sin alarma ni estado del pulso. */
async function fresh(lang: DemoLang): Promise<string> {
  const pid = demoProjectId(lang);
  await api(`/api/projects/${pid}`, { method: 'DELETE', headers: OWNER });
  await runInDurableObject(roomOf(pid), async (_, state) => {
    await state.storage.deleteAlarm();
    await state.storage.deleteAll();
  });
  await json(await api(`/api/projects/${pid}`, { method: 'PUT', body: demoProject(lang), headers: OWNER }), 200);
  return pid;
}

/** La demo sin nada que avanzar ni que arrancar: todo lo que no espera al PM, listo. */
async function stall(pid: string, lang: DemoLang): Promise<void> {
  const stalled = demoProject(lang);
  const held = new Set(stalled.blockers!.map((b) => b.nodeId));
  const waits = new Set(['panel', 'prueba-pagos', 'tiendas', 'anuncio']);
  for (const n of stalled.nodes) if (!held.has(n.id!) && !waits.has(n.id!)) n.status = 'done';
  await json(await api(`/api/projects/${pid}`, { method: 'PUT', body: stalled, headers: OWNER }), 200);
}

/** `n` mensajes escritos directo en el Store: n eventos sin pasar n veces por la API ni por el room. */
const flood = (pid: string, n: number) =>
  runInDurableObject(storeStub(), (store) => {
    for (let i = 0; i < n; i++) store.write({ kind: 'postMessage', pid, nid: 'pagos', input: { text: `m${i}` }, actor: 'agent' });
  });
const range = async (pid: string) =>
  (await sql<{ lo: number; hi: number; n: number }>('SELECT MIN(seq) AS lo, MAX(seq) AS hi, COUNT(*) AS n FROM events WHERE project_id = ?', pid))[0]!;

/** `n` latidos seguidos, como si pasaran n × ~3,5 s. */
async function beats(pid: string, n: number): Promise<number> {
  let ran = 0;
  for (let i = 0; i < n; i++) if (await runDurableObjectAlarm(roomOf(pid))) ran++;
  return ran;
}

/** Espera a que el room ya no tenga sockets (el cierre del cliente tarda un instante en llegar). */
async function unwatched(pid: string): Promise<void> {
  const end = Date.now() + 3000;
  while ((await runInDurableObject(roomOf(pid), (_, state) => state.getWebSockets().length)) > 0) {
    if (Date.now() > end) throw new Error('el room sigue con sockets');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('el pulso de la demo (#74)', () => {
  it('un proyecto que no es demo con un navegador conectado: cero alarmas, cero escrituras', async () => {
    const s = await seedDemo(); // id «marketplace-reservas-xxxx»: parecido, pero no es demo
    const live = await watch(s.project.id);
    expect(await alarmOf(s.project.id)).toBeNull();
    expect(await runDurableObjectAlarm(roomOf(s.project.id))).toBe(false);
    // ni forzando la alarma a mano escribe
    await runInDurableObject(roomOf(s.project.id), (room) => room.alarm());
    expect(await alarmOf(s.project.id)).toBeNull();
    // y el Store rechaza un latido o una re-siembra sobre un proyecto que no es demo
    for (const op of [{ kind: 'demoBeat', pid: s.project.id }, { kind: 'demoReseed', pid: s.project.id, keep: REPLAY_LIMIT }] as const)
      expect(await storeStub().write(op)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect((await snap(s.project.id)).seq).toBe(s.seq);
    await new Promise((r) => setTimeout(r, 50));
    expect(live.frames.map((f) => f.type)).toEqual(['hello']);
  });

  it('el saludo de un navegador arma la alarma; sin nadie mirando no corre ni se re-arma', async () => {
    const pid = await fresh('es');
    expect(await alarmOf(pid)).toBeNull();
    const live = await watch(pid);
    expect(await alarmOf(pid)).not.toBeNull();
    const seq = (await snap(pid)).seq;
    live.ws.close();
    await unwatched(pid);
    expect(await beats(pid, 1)).toBe(1);
    expect(await alarmOf(pid)).toBeNull();
    expect((await snap(pid)).seq).toBe(seq);
  });

  it('60 s de pulso (17 latidos) con la demo abierta: ≥3 cambios en vivo, firmados por el equipo', async () => {
    const pid = await fresh('en');
    const live = await watch(pid);
    expect(await beats(pid, 17)).toBe(17);
    const got = events(live);
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got.every((e) => e.actor === 'agent')).toBe(true);
    const texts = got.flatMap((e) => (e.type === 'message.posted' ? [e.payload.message] : []));
    for (const m of texts) {
      expect(m.from).toMatch(/ team$/);
      expect(m.text).not.toMatch(/[áéíóúñ¿¡]/i);
    }
    // lo que llegó en vivo es lo que quedó: la UI aplica los eventos y ve el mismo grafo
    expect((await snap(pid)).seq).toBe(got[got.length - 1]!.seq);
  });

  it('10 min de pulso (172 latidos): las 3 cosas siguen abiertas, la demo vuelve a empezar y nadie recibe 4004', async () => {
    const pid = await fresh('es');
    const live = await watch(pid);
    const code = closed(live.ws);
    expect(await beats(pid, 172)).toBe(172);
    const s = await snap(pid);
    expect(s.blockers.filter((b) => b.status === 'open').map((b) => b.nodeId).sort()).toEqual(['checkout-d', 'comision', 'pagos']);
    expect(events(live).filter((e) => e.type === 'project.replaced').length).toBeGreaterThanOrEqual(1);
    expect(events(live).some((e) => e.type === 'blocker.resolved' || e.type === 'blocker.opened')).toBe(false);
    expect(code()).toBeNull();
    expect(live.ws.readyState).toBe(WebSocket.OPEN);
    expect(await alarmOf(pid)).not.toBeNull();
  }, 30_000);

  it('sin nada que avanzar, espera 2 latidos y re-siembra con el dueño sobre el mismo id: la página sigue conectada', async () => {
    const pid = await fresh('es');
    await stall(pid, 'es');
    await json(await api(`/api/projects/${pid}/nodes/pagos/messages`, { method: 'POST', body: { text: 'un mensaje que se va al re-sembrar' } }), 201);
    const before = await snap(pid);

    const live = await watch(pid, `?since=${before.seq}`);
    const code = closed(live.ws);
    expect(await beats(pid, 1)).toBe(1);
    expect((await snap(pid)).seq).toBe(before.seq); // un latido sin nada que hacer no escribe
    expect(await beats(pid, 1)).toBe(1);

    const replaced = await live.waitFor((f) => f.type === 'event' && f.event.type === 'project.replaced');
    expect((replaced as EventFrame).event.actor).toBe('owner');
    const after = await snap(pid);
    expect(after.project.createdAt).toBe(before.project.createdAt); // misma encarnación: nada de 4004
    expect(after.nodes.find((n) => n.id === 'perfil-d')).toMatchObject({ status: 'working', progress: 0.55 });
    expect(after.blockers.filter((b) => b.status === 'open')).toHaveLength(3);
    expect(after.messages.some((m) => m.text === 'un mensaje que se va al re-sembrar')).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(code()).toBeNull();
    // y el pulso sigue
    expect(await beats(pid, 1)).toBe(1);
    expect((await snap(pid)).seq).toBeGreaterThan(after.seq);
  });

  it('el visitante que resuelve no pierde su respuesta mientras dure la vuelta; en la demo inglesa le contestan en inglés', async () => {
    const pid = await fresh('en');
    const s = await snap(pid);
    await watch(pid);
    const decision = s.blockers.find((b) => b.kind === 'decision')!;
    await json(await api(`/api/projects/${pid}/blockers/${decision.id}/resolve`, { method: 'POST', body: { choice: 0 }, headers: OWNER }), 200);
    const resumed = (await snap(pid)).messages.at(-1)!;
    expect(resumed.from).toBe('Design team');
    expect(resumed.text).not.toMatch(/[áéíóúñ¿¡]/i);
    await beats(pid, 20);
    const after = await snap(pid);
    expect(after.blockers.find((b) => b.id === decision.id)).toMatchObject({ status: 'resolved', resolution: { choice: decision.options[0] } });
    expect(after.blockers.filter((b) => b.status === 'open')).toHaveLength(2);
  });

  it('deja de re-armarse 30 min después del último saludo; un saludo nuevo lo vuelve a armar', async () => {
    const pid = await fresh('es');
    await watch(pid);
    const seq = (await snap(pid)).seq;
    await runInDurableObject(roomOf(pid), (_, state) => state.storage.put('pulse:lastHello', Date.now() - PULSE_IDLE_LIMIT_MS - 1000));
    expect(await beats(pid, 1)).toBe(1);
    expect(await alarmOf(pid)).toBeNull();
    expect((await snap(pid)).seq).toBe(seq);
    await watch(pid);
    expect(await alarmOf(pid)).not.toBeNull();
  });
});

describe('eventos acotados de la demo (#74)', () => {
  it('al re-sembrar se podan los eventos hasta el piso (max seq − REPLAY_LIMIT); un since bajo el piso recibe resync', async () => {
    const pid = await fresh('es');
    await stall(pid, 'es');
    await flood(pid, REPLAY_LIMIT + 20);
    expect(await storeStub().write({ kind: 'demoReseed', pid, keep: REPLAY_LIMIT })).toMatchObject({ ok: true });
    const { lo, hi, n } = await range(pid);
    const floor = hi - REPLAY_LIMIT;
    expect(n).toBe(REPLAY_LIMIT);
    expect(lo).toBe(floor + 1);
    expect((await sql<{ f: number }>('SELECT events_floor AS f FROM projects WHERE id = ?', pid))[0]!.f).toBe(floor);

    // bajo el piso: resync, nunca un replay con hueco
    const old = await watch(pid, '?since=1');
    await old.waitFor((f) => f.type === 'resync');
    expect(events(old)).toEqual([]);
    const below = await watch(pid, `?since=${floor - 1}`);
    await below.waitFor((f) => f.type === 'resync');
    // en el piso: el replay es completo y sin hueco
    const at = await watch(pid, `?since=${floor}`);
    await at.waitFor((f) => f.type === 'event' && f.event.seq === hi);
    expect(at.frames.some((f) => f.type === 'resync')).toBe(false);
    expect(events(at).map((e) => e.seq)).toEqual(Array.from({ length: REPLAY_LIMIT }, (_, i) => floor + 1 + i));
    // y por HTTP tampoco hay replay con hueco
    expect(await json(await api(`/api/projects/${pid}/events?since=1`), 200)).toEqual({ events: [], resync: true });
    expect((await json<{ events: DagEvent[] }>(await api(`/api/projects/${pid}/events?since=${hi - 2}`), 200)).events.map((e) => e.seq)).toEqual([hi - 1, hi]);
  });

  it('un proyecto que no es demo nunca se poda: ni por re-siembra ni porque el dueño lo reemplace', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    await flood(pid, REPLAY_LIMIT + 20);
    expect(await storeStub().write({ kind: 'demoReseed', pid, keep: REPLAY_LIMIT })).toMatchObject({ ok: false });
    await json(await api(`/api/projects/${pid}`, { method: 'PUT', body: demoProject(), headers: OWNER }), 200);
    const { lo, n } = await range(pid);
    expect(lo).toBe(1);
    expect(n).toBe(s.seq + REPLAY_LIMIT + 20 + 1);
    expect((await json<{ events: DagEvent[] }>(await api(`/api/projects/${pid}/events?since=0`), 200)).events[0]!.seq).toBe(1);
  });
});

describe('revisión adversarial del PR #79', () => {
  const resolveDecision = async (pid: string, id: string) =>
    api(`/api/projects/${pid}/blockers/${id}/resolve`, { method: 'POST', body: { choice: 0 }, headers: OWNER });

  it('1. la re-siembra vuelve a mirar en su transacción: si ya hay algo que avanzar, no toca nada', async () => {
    const pid = await fresh('es');
    await stall(pid, 'es');
    const decision = (await snap(pid)).blockers.find((b) => b.kind === 'decision')!;
    // el room contó 2 latidos ociosos, pero entre medio el PM resolvió: ya no está ocioso
    await json(await resolveDecision(pid, decision.id), 200);
    const before = await snap(pid);
    expect(await storeStub().write({ kind: 'demoReseed', pid, keep: REPLAY_LIMIT })).toMatchObject({ ok: true, value: false, events: [] });
    const after = await snap(pid);
    expect(after.seq).toBe(before.seq);
    expect(after.blockers.find((b) => b.id === decision.id)).toMatchObject({ status: 'resolved' });
  });

  it('1. un bloqueante abierto conserva su fila y su id al re-sembrar: resolver con el id de antes → 200', async () => {
    const pid = await fresh('en');
    await stall(pid, 'en');
    const before = await snap(pid);
    const live = await watch(pid);
    expect(await beats(pid, 2)).toBe(2);
    await live.waitFor((f) => f.type === 'event' && f.event.type === 'project.replaced');
    const after = await snap(pid);
    expect(after.blockers.map((b) => b.id).sort()).toEqual(before.blockers.map((b) => b.id).sort());
    expect(after.blockers.every((b) => b.status === 'open')).toBe(true);
    // el PM tenía la ficha abierta desde antes de la re-siembra
    const decision = before.blockers.find((b) => b.kind === 'decision')!;
    await json(await resolveDecision(pid, decision.id), 200);
  });

  it('1. solo un bloqueante ya resuelto se reabre (con id nuevo) al volver a empezar', async () => {
    const pid = await fresh('es');
    await stall(pid, 'es');
    const before = await snap(pid);
    const decision = before.blockers.find((b) => b.kind === 'decision')!;
    await json(await resolveDecision(pid, decision.id), 200);
    const live = await watch(pid);
    for (let i = 0; i < 80 && !events(live).some((e) => e.type === 'project.replaced'); i++) await beats(pid, 1);
    await live.waitFor((f) => f.type === 'event' && f.event.type === 'project.replaced');
    const after = await snap(pid);
    expect(after.blockers.filter((b) => b.status === 'open')).toHaveLength(3);
    expect(after.blockers).toHaveLength(3);
    const ids = new Set(after.blockers.map((b) => b.id));
    expect(ids.has(decision.id)).toBe(false);
    for (const b of before.blockers.filter((x) => x.id !== decision.id)) expect(ids.has(b.id)).toBe(true);
  }, 30_000);

  it('2. si el relleno de huecos del room cae bajo el piso, manda resync y nunca un replay con hueco', async () => {
    const pid = await fresh('es');
    await stall(pid, 'es');
    const live = await watch(pid);
    // eventos que el room no vio (escritos sin broadcast) y una re-siembra que los poda
    await flood(pid, REPLAY_LIMIT + 20);
    const res = await storeStub().write({ kind: 'demoReseed', pid, keep: REPLAY_LIMIT });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.value).toBe(true);
    await roomOf(pid).broadcast(pid, res.events as DagEvent[], res.incarnation!);
    await live.waitFor((f) => f.type === 'resync');
    expect(events(live)).toEqual([]);
    // y el room sigue repartiendo en vivo lo que viene después
    const { hi } = await range(pid);
    expect(await beats(pid, 1)).toBe(1);
    await live.waitFor((f) => f.type === 'event' && f.event.seq === hi + 1);
  });

  it('3. demoReseed con keep < 1 deja al menos un evento: el seq nunca vuelve atrás', async () => {
    const pid = await fresh('es');
    await stall(pid, 'es');
    expect(await storeStub().write({ kind: 'demoReseed', pid, keep: 0 })).toMatchObject({ ok: true, value: true });
    const { lo, hi, n } = await range(pid);
    expect([n, lo]).toEqual([1, hi]);
    const beat = await storeStub().write({ kind: 'demoBeat', pid });
    if (!beat.ok) throw new Error(beat.error.message);
    expect(beat.events[0]!.seq).toBe(hi + 1);
    expect(await storeStub().write({ kind: 'demoReseed', pid, keep: -5 })).toMatchObject({ ok: true });
  });

  it('4. un latido no sube la demo en la lista: projects.updated_at queda igual', async () => {
    const pid = await fresh('en');
    const before = (await snap(pid)).project.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    for (let i = 0; i < 3; i++) {
      const res = await storeStub().write({ kind: 'demoBeat', pid });
      expect(res.ok && res.events.length).toBeGreaterThan(0);
    }
    expect((await snap(pid)).project.updatedAt).toBe(before);
    const listed = (await json<{ projects: Array<{ id: string; updatedAt: string }> }>(await api('/api/projects'), 200)).projects.find((p) => p.id === pid)!;
    expect(listed.updatedAt).toBe(before);
  });
});
