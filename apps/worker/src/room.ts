/**
 * Un Durable Object por proyecto: guarda los WebSockets (API de hibernación) y reparte los eventos
 * que le pasa el Worker después de cada escritura. El log de eventos vive en el DO `Store` (SQLite);
 * aquí solo se recuerda `lastSent`, el último seq repartido, para no saltarse ni repetir eventos.
 */
import { DurableObject } from 'cloudflare:workers';
import type { DagEvent, ServerFrame } from '@dagyard/model';
import { WS_PROTOCOL, offeredProtocols } from './auth.js';
import { db } from './db.js';
import type { Env } from './env.js';
import { currentSeq, eventsSince } from './store.js';

/** Si el cliente está más atrás que esto, recibe `resync` y vuelve a pedir el snapshot. */
export const REPLAY_LIMIT = 500;

interface Attachment {
  pid: string;
  /** recibió su `hello` y la recuperación: ya puede recibir eventos en vivo */
  ready: boolean;
  /** seq hasta el que ya tiene todo (por el hello/la recuperación) */
  seen: number;
}

const frame = (f: ServerFrame) => JSON.stringify(f);

export class ProjectRoom extends DurableObject<Env> {
  private lastSent: number | null | undefined = undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', frame({ type: 'pong' })));
  }

  /** Todo lo que toca `lastSent` o los sockets va en fila: el orden de los frames es el del seq. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async getLastSent(): Promise<number | null> {
    if (this.lastSent === undefined) this.lastSent = (await this.ctx.storage.get<number>('lastSent')) ?? null;
    return this.lastSent;
  }

  private async setLastSent(v: number | null): Promise<void> {
    this.lastSent = v;
    if (v === null) await this.ctx.storage.delete('lastSent');
    else await this.ctx.storage.put('lastSent', v);
  }

  /** Upgrade ya autenticado por el Worker. Headers: `x-dagyard-project`, `x-dagyard-since`. */
  async fetch(req: Request): Promise<Response> {
    const pid = req.headers.get('x-dagyard-project');
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket' || !pid) return new Response('se esperaba un WebSocket', { status: 426 });
    const rawSince = req.headers.get('x-dagyard-since');
    const since = rawSince && /^\d+$/.test(rawSince) ? Number(rawSince) : null;

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid, ready: false, seen: 0 } satisfies Attachment);
    this.serial(() => this.greet(server, pid, since)).catch((err) => {
      console.error(JSON.stringify({ msg: 'hello falló', pid, err: String(err) }));
      server.close(1011, 'error interno');
    });
    // si el cliente ofreció subprotocolos, hay que elegir uno o el navegador corta la conexión
    const offered = offeredProtocols(req.headers.get('sec-websocket-protocol') ?? undefined);
    const headers = offered.includes(WS_PROTOCOL) ? { 'sec-websocket-protocol': WS_PROTOCOL } : undefined;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  private async greet(ws: WebSocket, pid: string, since: number | null): Promise<void> {
    const seq = await currentSeq(db(this.env), pid);
    ws.send(frame({ type: 'hello', projectId: pid, seq }));
    // un since del futuro (p. ej. el proyecto se borró y se volvió a crear): el cliente debe recargar
    if (since !== null && since > seq) ws.send(frame({ type: 'resync', seq }));
    else if (since !== null && since < seq) {
      const evs = await eventsSince(db(this.env), pid, since, REPLAY_LIMIT + 1);
      if (evs.length > REPLAY_LIMIT) ws.send(frame({ type: 'resync', seq }));
      else for (const event of evs) if (event.seq <= seq) ws.send(frame({ type: 'event', event }));
    }
    ws.serializeAttachment({ pid, ready: true, seen: seq } satisfies Attachment);
    // Primer socket de esta instancia: lo anterior a `seq` ya lo tiene quien está conectado.
    if ((await this.getLastSent()) === null) await this.setLastSent(seq);
  }

  /** RPC desde el Worker tras cada escritura. */
  async broadcast(pid: string, events: DagEvent[]): Promise<void> {
    await this.serial(async () => {
      const sockets = this.ctx.getWebSockets();
      if (!sockets.length) {
        // nadie mirando: el próximo `hello` arranca de cero
        await this.setLastSent(null);
        return;
      }
      const incoming = [...events].sort((a, b) => a.seq - b.seq);
      let last = await this.getLastSent();
      if (last === null) last = incoming[0]!.seq - 1;
      let toSend = incoming.filter((e) => e.seq > last!);
      if (!toSend.length) return;
      const contiguous = toSend.every((e, i) => e.seq === last! + 1 + i);
      // Una escritura concurrente se adelantó: lo que falta ya está commiteado en el Store.
      if (!contiguous) toSend = await eventsSince(db(this.env), pid, last, REPLAY_LIMIT);
      for (const ws of sockets) {
        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att?.ready) continue;
        for (const event of toSend) {
          if (event.seq <= att.seen) continue;
          try {
            ws.send(frame({ type: 'event', event }));
          } catch {
            // socket cerrándose: lo limpia webSocketClose
          }
        }
      }
      await this.setLastSent(toSend[toSend.length - 1]!.seq);
    });
  }

  /** El proyecto se borró: cierra los sockets y olvida el seq (un proyecto nuevo empieza en 1). */
  async reset(): Promise<void> {
    await this.serial(async () => {
      for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'proyecto eliminado');
      await this.setLastSent(null);
    });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    if (typeof msg !== 'string') return;
    let type: unknown = msg.trim();
    try {
      type = (JSON.parse(msg) as { type?: unknown }).type;
    } catch {
      // texto plano
    }
    if (type === 'ping') ws.send(frame({ type: 'pong' }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      // ya cerrado
    }
  }
}
