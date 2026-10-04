import { applyEvent, type DagEvent, type Message, type ProjectSnapshot, type ServerFrame } from '@dagyard/model';
import { SELF, evictDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { AGENT, BASE, OWNER, api, json, openLive, seedDemo } from './helpers.js';

type EventFrame = Extract<ServerFrame, { type: 'event' }>;
const isEvent = (type: DagEvent['type']) => (f: ServerFrame): f is EventFrame => f.type === 'event' && f.event.type === type;

describe('tiempo real', () => {
  it('una escritura por la API llega como frame `event` al WebSocket suscrito', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const live = await openLive(pid);
    const hello = await live.waitFor((f) => f.type === 'hello');
    expect(hello).toEqual({ type: 'hello', projectId: pid, seq: s.seq });

    const text = 'Ya conecté la pasarela. Falta probar un reembolso.';
    const posted = await json<Message>(await api(`/api/projects/${pid}/nodes/pagos/messages`, { method: 'POST', body: { text } }), 201);

    const f = await live.waitFor(isEvent('message.posted'));
    expect(f.event).toMatchObject({ seq: s.seq + 1, projectId: pid, type: 'message.posted', actor: 'agent' });
    expect(f.event.type === 'message.posted' && f.event.payload.message).toEqual(posted);

    // la UI aplica el frame y queda igual que un snapshot nuevo
    const applied = applyEvent(s, f.event);
    const fresh = await json<ProjectSnapshot>(await api(`/api/projects/${pid}`), 200);
    expect(applied.messages).toEqual(fresh.messages);
    expect(applied.seq).toBe(fresh.seq);
    live.ws.close();
  });

  it('resolver desde la UI (owner) llega a otro socket con blocker.resolved + node.updated + message.posted en orden', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const a = await openLive(pid, '', AGENT);
    const b = await openLive(pid, `?token=test-owner-token`, {});
    await a.waitFor((f) => f.type === 'hello');
    await b.waitFor((f) => f.type === 'hello');
    const decision = s.blockers.find((x) => x.kind === 'decision')!;
    await json(await api(`/api/projects/${pid}/blockers/${decision.id}/resolve`, { method: 'POST', body: { choice: 1 }, headers: OWNER }), 200);
    for (const live of [a, b]) {
      await live.waitFor(isEvent('message.posted'));
      const events = live.frames.filter((f): f is EventFrame => f.type === 'event').map((f) => [f.event.seq, f.event.type, f.event.actor]);
      expect(events).toEqual([
        [s.seq + 1, 'blocker.resolved', 'owner'],
        [s.seq + 2, 'node.updated', 'owner'],
        [s.seq + 3, 'message.posted', 'owner'],
      ]);
      live.ws.close();
    }
  });

  it('?since= reenvía lo que faltó justo después del hello', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    for (const t of ['uno', 'dos']) await json(await api(`/api/projects/${pid}/nodes/pagos/messages`, { method: 'POST', body: { text: t } }), 201);
    const live = await openLive(pid, `?since=${s.seq}`);
    await live.waitFor((f) => f.type === 'event' && f.event.seq === s.seq + 2);
    expect(live.frames.map((f) => (f.type === 'event' ? f.event.seq : f.type))).toEqual(['hello', s.seq + 1, s.seq + 2]);
    expect(live.frames[0]).toEqual({ type: 'hello', projectId: pid, seq: s.seq + 2 });
    live.ws.close();
  });

  it('ping → pong (JSON y texto)', async () => {
    const s = await seedDemo();
    const live = await openLive(s.project.id);
    await live.waitFor((f) => f.type === 'hello');
    live.ws.send(JSON.stringify({ type: 'ping' }));
    live.ws.send('ping');
    await live.waitFor((f) => f.type === 'pong');
    const end = Date.now() + 2000;
    while (live.frames.filter((f) => f.type === 'pong').length < 2 && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(live.frames.filter((f) => f.type === 'pong')).toHaveLength(2);
    live.ws.close();
  });

  it('auth por subprotocolo token.<token>: el servidor elige `dagyard` y el frame llega', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const res = await SELF.fetch(`${BASE}/api/projects/${pid}/live`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'dagyard, token.test-owner-token' },
    });
    expect(res.status).toBe(101);
    expect(res.headers.get('sec-websocket-protocol')).toBe('dagyard');
    const ws = res.webSocket!;
    ws.accept();
    const frames: ServerFrame[] = [];
    ws.addEventListener('message', (e) => {
      frames.push(JSON.parse(e.data as string));
    });
    await json(await api(`/api/projects/${pid}/nodes/pagos/messages`, { method: 'POST', body: { text: 'por subprotocolo' } }), 201);
    const end = Date.now() + 5000;
    while (!frames.some(isEvent('message.posted')) && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(frames.map((f) => f.type)).toEqual(['hello', 'event']);
    ws.close();

    const bad = await SELF.fetch(`${BASE}/api/projects/${pid}/live`, { headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'dagyard, token.nope' } });
    expect(bad.status).toBe(401);
    // el subprotocolo no autentica rutas que no son el WebSocket
    await json(await api(`/api/projects/${pid}`, { headers: { 'sec-websocket-protocol': 'dagyard, token.test-owner-token' } }), 401);
  });

  it('sin auth → 401 antes del upgrade; proyecto inexistente → 404', async () => {
    const s = await seedDemo();
    const res = await SELF.fetch(`${BASE}/api/projects/${s.project.id}/live`, { headers: { upgrade: 'websocket' } });
    expect(res.status).toBe(401);
    expect(res.webSocket).toBeNull();
    const bad = await SELF.fetch(`${BASE}/api/projects/${s.project.id}/live?token=nope`, { headers: { upgrade: 'websocket' } });
    expect(bad.status).toBe(401);
    const missing = await SELF.fetch(`${BASE}/api/projects/no-existe/live`, { headers: { upgrade: 'websocket', ...AGENT } });
    expect(missing.status).toBe(404);
  });
});

describe('Durable Object', () => {
  it('si un evento llega antes que el anterior, el DO rellena el hueco desde D1 y conserva el orden', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const live = await openLive(pid);
    await live.waitFor((f) => f.type === 'hello');
    // dos escrituras commiteadas cuyo aviso al DO se «perdió» / llegó al revés
    const at = new Date().toISOString();
    const mk = (seq: number): DagEvent => ({ seq, projectId: pid, type: 'node.removed', actor: 'agent', at, payload: { nodeId: `x${seq}` } });
    const [e1, e2] = [mk(s.seq + 1), mk(s.seq + 2)];
    await env.DB.batch(
      [e1, e2].map((e) =>
        env.DB.prepare('INSERT INTO events (project_id, seq, type, actor, at, payload) VALUES (?, ?, ?, ?, ?, ?)').bind(pid, e.seq, e.type, e.actor, e.at, JSON.stringify(e.payload)),
      ),
    );
    const stub = env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(pid));
    await stub.broadcast(pid, [e2]);
    await stub.broadcast(pid, [e1]); // ya repartido: no se repite
    await live.waitFor((f) => f.type === 'event' && f.event.seq === e2.seq);
    await new Promise((r) => setTimeout(r, 50));
    expect(live.frames.filter((f): f is EventFrame => f.type === 'event').map((f) => f.event.seq)).toEqual([e1.seq, e2.seq]);
    live.ws.close();
  });

  it('el socket sobrevive a la hibernación del DO y sigue recibiendo eventos', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const live = await openLive(pid);
    await live.waitFor((f) => f.type === 'hello');
    await evictDurableObject(env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(pid)));
    await json(await api(`/api/projects/${pid}/nodes/pagos/messages`, { method: 'POST', body: { text: 'después de hibernar' } }), 201);
    const f = await live.waitFor(isEvent('message.posted'));
    expect(f.event.seq).toBe(s.seq + 1);
    live.ws.close();
  });
});
