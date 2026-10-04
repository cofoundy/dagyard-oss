/**
 * Un Durable Object por proyecto: guarda los WebSockets (API de hibernación) y reparte los eventos
 * que le pasa el Worker después de cada escritura. El log de eventos vive en el DO `Store` (SQLite);
 * aquí solo se recuerda `lastSent`, el último seq repartido, para no saltarse ni repetir eventos, y la
 * encarnación del proyecto a la que pertenece (su `created_at`): un proyecto borrado y recreado con el mismo
 * id vuelve a empezar su seq, y sin la encarnación sus eventos se confundirían con los del muerto (#67).
 */
import { DurableObject } from 'cloudflare:workers';
import type { DagEvent, ServerFrame } from '@dagyard/model';
import { sessionAlive } from './auth.js';
import { db } from './db.js';
import type { Env } from './env.js';
import { liveState } from './store.js';

/** Si el cliente está más atrás que esto, recibe `resync` y vuelve a pedir el snapshot. */
export const REPLAY_LIMIT = 500;
/** Cuánto se confía en que una sesión del navegador sigue viva antes de volver a preguntarle al Store. */
export const SESSION_RECHECK_MS = 30_000;
/** Código de cierre de un socket cuya sesión del navegador se cerró, venció o es de un token rotado. */
export const CLOSE_SESSION_ENDED = 4001;

interface Attachment {
  pid: string;
  /** recibió su `hello` y la recuperación: ya puede recibir eventos en vivo */
  ready: boolean;
  /** seq hasta el que ya tiene todo (por el hello/la recuperación) */
  seen: number;
  /** encarnación del proyecto que saludó (su `created_at`); vacía hasta el hello */
  incarnation?: string;
  /** hash de la sesión del navegador si entró por cookie: se revalida antes de cada evento */
  session?: string;
}

const frame = (f: ServerFrame) => JSON.stringify(f);

/** Hasta dónde se repartió y de qué encarnación del proyecto. */
type Sent = { seq: number; incarnation: string };

const closeQuietly = (ws: WebSocket, code: number, reason: string) => {
  try {
    ws.close(code, reason);
  } catch {
    // ya cerrado
  }
};

export class ProjectRoom extends DurableObject<Env> {
  private sent: Sent | null | undefined = undefined;
  private queue: Promise<unknown> = Promise.resolve();
  /** hash de sesión → hasta cuándo se da por viva sin preguntar (en memoria: se pierde al hibernar, y está bien) */
  private aliveUntil = new Map<string, number>();

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

  private async getSent(): Promise<Sent | null> {
    if (this.sent === undefined) {
      const m = await this.ctx.storage.get<number | string>(['lastSent', 'incarnation']);
      const seq = m.get('lastSent');
      const incarnation = m.get('incarnation');
      // sin encarnación (estado de antes de #67) es como empezar de cero
      this.sent = typeof seq === 'number' && typeof incarnation === 'string' ? { seq, incarnation } : null;
    }
    return this.sent;
  }

  private async setSent(v: Sent | null): Promise<void> {
    this.sent = v;
    if (v === null) await this.ctx.storage.delete(['lastSent', 'incarnation']);
    else await this.ctx.storage.put({ lastSent: v.seq, incarnation: v.incarnation });
  }

  /** Upgrade ya autenticado por el Worker. Headers: `x-dagyard-project`, `x-dagyard-since`, `x-dagyard-session`, `x-dagyard-protocol`. */
  async fetch(req: Request): Promise<Response> {
    const pid = req.headers.get('x-dagyard-project');
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket' || !pid) return new Response('se esperaba un WebSocket', { status: 426 });
    const rawSince = req.headers.get('x-dagyard-since');
    const since = rawSince && /^\d+$/.test(rawSince) ? Number(rawSince) : null;
    const session = req.headers.get('x-dagyard-session') ?? undefined;

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid, ready: false, seen: 0, session } satisfies Attachment);
    this.serial(() => this.greet(server, pid, since, session)).catch((err) => {
      console.error(JSON.stringify({ msg: 'hello falló', pid, err: String(err) }));
      // p. ej. un reset() lo cerró mientras su hello esperaba en la fila
      closeQuietly(server, 1011, 'error interno');
    });
    // si el cliente ofreció subprotocolos, hay que elegir uno o el navegador corta la conexión; lo eligió el Worker
    const protocol = req.headers.get('x-dagyard-protocol');
    const headers = protocol ? { 'sec-websocket-protocol': protocol } : undefined;
    return new Response(null, { status: 101, webSocket: client, headers });
  }

  private async greet(ws: WebSocket, pid: string, since: number | null, session: string | undefined): Promise<void> {
    const { incarnation, seq, events } = await liveState(db(this.env), pid, since, REPLAY_LIMIT + 1);
    // se borró entre la auth del Worker y este hello
    if (incarnation === null) return closeQuietly(ws, 4004, 'proyecto eliminado');
    ws.send(frame({ type: 'hello', projectId: pid, seq }));
    // un since del futuro (p. ej. el proyecto se borró y se volvió a crear): el cliente debe recargar
    if (since !== null && since > seq) ws.send(frame({ type: 'resync', seq }));
    else if (since !== null && since < seq) {
      if (events.length > REPLAY_LIMIT) ws.send(frame({ type: 'resync', seq }));
      else for (const event of events) if (event.seq <= seq) ws.send(frame({ type: 'event', event }));
    }
    const last = await this.getSent();
    // Lo repartido es de otra encarnación: el proyecto se borró y se recreó sin que llegara el `reset`.
    // Las páginas que la miran son del proyecto muerto.
    if (last !== null && last.incarnation !== incarnation) this.closeStale(incarnation);
    ws.serializeAttachment({ pid, ready: true, seen: seq, session, incarnation } satisfies Attachment);
    // Primer socket de esta encarnación: lo anterior a `seq` ya lo tiene quien está conectado.
    if (last === null || last.incarnation !== incarnation) await this.setSent({ seq, incarnation });
  }

  /** Cierra las páginas ya saludadas que miran otra encarnación que `current`: la de un proyecto que se borró. */
  private closeStale(current: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.ready && att.incarnation !== current) closeQuietly(ws, 4004, 'proyecto eliminado');
    }
  }

  /**
   * RPC desde el Worker tras cada escritura. `incarnation`: la del proyecto que la escribió (el `created_at`
   * que devolvió el Store en la misma transacción).
   */
  async broadcast(pid: string, events: DagEvent[], incarnation: string): Promise<void> {
    await this.serial(async () => {
      const sockets = this.ctx.getWebSockets();
      if (!sockets.length) {
        // nadie mirando: el próximo `hello` arranca de cero
        await this.setSent(null);
        return;
      }
      const incoming = [...events].sort((a, b) => a.seq - b.seq);
      let sent = await this.getSent();
      if (sent !== null && sent.incarnation !== incarnation) {
        // Un aviso tardío de un proyecto ya borrado (las encarnaciones crecen con el reloj del Store): nadie
        // conectado es de esa encarnación.
        if (incarnation < sent.incarnation) return;
        // El proyecto se borró y se recreó sin que llegara el `reset`: las páginas conectadas son del muerto.
        // Las de la encarnación nueva todavía no saludaron; su `hello` arranca de cero.
        this.closeStale(incarnation);
        sent = null;
      }
      const last = sent?.seq ?? incoming[0]!.seq - 1;
      let toSend = incoming.filter((e) => e.seq > last);
      if (!toSend.length) return;
      const contiguous = toSend.every((e, i) => e.seq === last + 1 + i);
      if (!contiguous) {
        // Una escritura concurrente se adelantó: lo que falta ya está commiteado en el Store, si sigue siendo
        // esta encarnación y el Store lo tiene.
        const state = await liveState(db(this.env), pid, last, REPLAY_LIMIT);
        toSend = state.incarnation === incarnation ? state.events : [];
        if (!toSend.length) return;
      }
      const ended = await this.endedSessions(sockets);
      for (const ws of sockets) {
        const att = ws.deserializeAttachment() as Attachment | null;
        if (!att?.ready || att.incarnation !== incarnation) continue;
        if (att.session && ended.has(att.session)) {
          closeQuietly(ws, CLOSE_SESSION_ENDED, 'sesión cerrada');
          continue;
        }
        for (const event of toSend) {
          if (event.seq <= att.seen) continue;
          try {
            ws.send(frame({ type: 'event', event }));
          } catch {
            // socket cerrándose: lo limpia webSocketClose
          }
        }
      }
      await this.setSent({ seq: toSend[toSend.length - 1]!.seq, incarnation });
    });
  }

  /**
   * Sesiones del navegador que ya no sirven (cerradas, vencidas, token rotado) entre las de estos sockets.
   * Una sesión vista viva hace menos de SESSION_RECHECK_MS no se vuelve a preguntar.
   */
  private async endedSessions(sockets: WebSocket[]): Promise<Set<string>> {
    const now = Date.now();
    const toCheck = new Set<string>();
    for (const ws of sockets) {
      const session = (ws.deserializeAttachment() as Attachment | null)?.session;
      if (session && (this.aliveUntil.get(session) ?? 0) <= now) toCheck.add(session);
    }
    const ended = new Set<string>();
    await Promise.all(
      [...toCheck].map(async (session) => {
        if (await sessionAlive(this.env, session)) this.aliveUntil.set(session, now + SESSION_RECHECK_MS);
        else {
          this.aliveUntil.delete(session);
          ended.add(session);
        }
      }),
    );
    return ended;
  }

  /** El proyecto se borró: cierra los sockets y olvida el seq (un proyecto nuevo empieza en 1). */
  async reset(): Promise<void> {
    await this.serial(async () => {
      for (const ws of this.ctx.getWebSockets()) closeQuietly(ws, 4004, 'proyecto eliminado');
      await this.setSent(null);
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
