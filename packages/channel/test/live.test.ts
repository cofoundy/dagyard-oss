import type { DagEvent, ServerFrame } from '@dagyard/model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveClient, liveUrl, type WsLike } from '../src/live.js';
import { PID, resolved, snapshot } from './fixtures.js';

class FakeWs implements WsLike {
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onclose: WsLike['onclose'] = null;
  onerror: WsLike['onerror'] = null;
  sent: string[] = [];
  closed = false;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({});
  }
  frame(f: ServerFrame) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  drop(code = 1006) {
    this.onclose?.({ code, reason: '' });
  }
}

function setup(seqs: number[]) {
  const sockets: FakeWs[] = [];
  const events: DagEvent[] = [];
  const logs: string[] = [];
  const loadSnapshot = vi.fn(async () => snapshot(seqs.shift() ?? 0));
  const live = new LiveClient({
    baseUrl: 'https://d.dev',
    key: 'clave',
    projectId: PID,
    loadSnapshot,
    onEvent: (e) => events.push(e),
    log: (m) => logs.push(m),
    ws: (url, protocols) => {
      const s = new FakeWs(url, protocols);
      sockets.push(s);
      return s;
    },
    pingMs: 1000,
    backoffMinMs: 100,
    backoffMaxMs: 400,
  });
  return { live, sockets, events, logs, loadSnapshot };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('liveUrl', () => {
  it('https → wss y http → ws, con since', () => {
    expect(liveUrl('https://d.dev/', 'mi proyecto', 42)).toBe('wss://d.dev/api/projects/mi%20proyecto/live?since=42');
    expect(liveUrl('http://localhost:8787', PID, 0)).toBe(`ws://localhost:8787/api/projects/${PID}/live?since=0`);
  });
});

describe('LiveClient', () => {
  it('arranca desde el seq del snapshot con el subprotocolo del token', async () => {
    const { live, sockets } = setup([42]);
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe(`wss://d.dev/api/projects/${PID}/live?since=42`);
    expect(sockets[0]!.protocols).toEqual(['dagyard', 'token.clave']);
    live.stop();
  });

  it('entrega eventos nuevos, ignora repetidos y reanuda desde el último seq', async () => {
    const { live, sockets, events } = setup([10]);
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = sockets[0]!;
    s.open();
    s.frame({ type: 'hello', projectId: PID, seq: 12 });
    s.frame({ type: 'event', event: resolved(11) });
    s.frame({ type: 'event', event: resolved(11) }); // repetido
    s.frame({ type: 'event', event: resolved(9) }); // viejo
    s.frame({ type: 'event', event: resolved(12) });
    expect(events.map((e) => e.seq)).toEqual([11, 12]);

    s.drop();
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.url).toContain('since=12');
    live.stop();
  });

  it('backoff exponencial con tope, y se reinicia al recibir hello', async () => {
    const { live, sockets } = setup([0]);
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.drop(); // espera 100
    await vi.advanceTimersByTimeAsync(100);
    sockets[1]!.drop(); // 200
    await vi.advanceTimersByTimeAsync(199);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    sockets[2]!.drop(); // 400
    await vi.advanceTimersByTimeAsync(400);
    sockets[3]!.drop(); // tope 400
    await vi.advanceTimersByTimeAsync(400);
    expect(sockets).toHaveLength(5);
    sockets[4]!.frame({ type: 'hello', projectId: PID, seq: 0 });
    sockets[4]!.drop(); // vuelve a 100
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(6);
    live.stop();
  });

  it('resync: salta al seq del snapshot y no reemite resoluciones viejas', async () => {
    const { live, sockets, events, loadSnapshot } = setup([5, 900]);
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = sockets[0]!;
    s.frame({ type: 'hello', projectId: PID, seq: 900 });
    s.frame({ type: 'resync', seq: 900 });
    await vi.advanceTimersByTimeAsync(0);
    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(live.seq).toBe(900);
    s.frame({ type: 'event', event: resolved(850) }); // vieja: no se reemite
    s.frame({ type: 'event', event: resolved(901) });
    expect(events.map((e) => e.seq)).toEqual([901]);
    s.drop();
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets[1]!.url).toContain('since=901');
    live.stop();
  });

  it('resync tras recrear el proyecto: el seq puede bajar', async () => {
    const { live, sockets, events } = setup([500, 3]);
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.frame({ type: 'resync', seq: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(live.seq).toBe(3);
    sockets[0]!.frame({ type: 'event', event: resolved(4) });
    expect(events.map((e) => e.seq)).toEqual([4]);
    live.stop();
  });

  it('ping periódico y reconexión si el servidor deja de responder', async () => {
    const { live, sockets } = setup([0]);
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    const s = sockets[0]!;
    s.open();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.sent).toEqual(['{"type":"ping"}']);
    s.frame({ type: 'pong' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.sent).toHaveLength(3);
    // sin pong: a los 2,5 intervalos se da por muerto
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
    live.stop();
  });

  it('si el snapshot falla, reintenta sin abrir el WebSocket', async () => {
    const { live, sockets, logs, loadSnapshot } = setup([7]);
    loadSnapshot.mockRejectedValueOnce(new Error('unauthorized'));
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(0);
    expect(logs.join('\n')).toContain('unauthorized');
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toContain('since=7');
    live.stop();
  });

  it('stop: no reconecta', async () => {
    const { live, sockets } = setup([0]);
    live.start();
    await vi.advanceTimersByTimeAsync(0);
    live.stop();
    expect(sockets[0]!.closed).toBe(true);
    sockets[0]!.drop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1);
  });
});
