// El ciclo contra un servidor WebSocket de verdad (paquete `ws`) con el WebSocket global de Node.
import type { DagEvent } from '@dagyard/model';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import { LiveClient } from '../src/live.js';
import { PID, resolved, snapshot } from './fixtures.js';

let wss: WebSocketServer | null = null;
afterEach(() => {
  wss?.close();
  wss = null;
});

function until(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('timeout esperando la condición'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('LiveClient con un servidor WS real', () => {
  it('auth por subprotocolo, reanuda desde el último seq tras un corte', async () => {
    const conns: Array<{ url: string; protocol: string; sock: ServerSocket }> = [];
    wss = new WebSocketServer({ port: 0, handleProtocols: (p) => (p.has('dagyard') ? 'dagyard' : false) });
    wss.on('connection', (sock, req) => {
      conns.push({ url: req.url ?? '', protocol: String(req.headers['sec-websocket-protocol']), sock });
      sock.send(JSON.stringify({ type: 'hello', projectId: PID, seq: 20 }));
      sock.on('message', (d) => {
        if (String(d).includes('ping')) sock.send(JSON.stringify({ type: 'pong' }));
      });
    });
    const port = (wss.address() as AddressInfo).port;
    const events: DagEvent[] = [];
    const live = new LiveClient({
      baseUrl: `http://127.0.0.1:${port}`,
      key: 'clave-secreta',
      projectId: PID,
      loadSnapshot: async () => snapshot(20),
      onEvent: (e) => events.push(e),
      log: () => {},
      backoffMinMs: 20,
    });
    live.start();
    await until(() => conns.length === 1);
    expect(conns[0]!.url).toBe(`/api/projects/${PID}/live?since=20`);
    expect(conns[0]!.protocol).toBe('dagyard, token.clave-secreta');

    conns[0]!.sock.send(JSON.stringify({ type: 'event', event: resolved(21) }));
    await until(() => events.length === 1);
    conns[0]!.sock.terminate();
    await until(() => conns.length === 2);
    expect(conns[1]!.url).toBe(`/api/projects/${PID}/live?since=21`);
    live.stop();
  });
});
