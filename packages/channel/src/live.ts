/**
 * Suscripción al tiempo real de un proyecto (`docs/api.md` §Tiempo real): snapshot → `seq`, WebSocket
 * con `?since=<seq>`, reconexión con backoff reanudando desde el último `seq` visto, `resync` → el
 * `seq` vuelve a salir del snapshot (no se reemiten eventos viejos) y `ping` periódico.
 */
import type { DagEvent, ProjectSnapshot, ServerFrame } from '@dagyard/model';
import type { Log } from './log.js';

/** Lo poco que usamos del `WebSocket` global de Node (inyectable en tests). */
export interface WsLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
export type WsFactory = (url: string, protocols: string[]) => WsLike;

export interface LiveOptions {
  baseUrl: string;
  key: string;
  projectId: string;
  loadSnapshot: () => Promise<ProjectSnapshot>;
  onEvent: (ev: DagEvent) => void;
  /** cada snapshot leído (arranque y resync), p. ej. para los títulos de los nodos */
  onSnapshot?: (snap: ProjectSnapshot) => void;
  log: Log;
  ws?: WsFactory;
  pingMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
}

const defaultWs: WsFactory = (url, protocols) => new WebSocket(url, protocols) as unknown as WsLike;

export function liveUrl(baseUrl: string, projectId: string, since: number): string {
  const u = new URL(`${baseUrl.replace(/\/+$/, '')}/api/projects/${encodeURIComponent(projectId)}/live`);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.searchParams.set('since', String(since));
  return u.toString();
}

export class LiveClient {
  private lastSeq = 0;
  private ready = false;
  private stopped = false;
  private attempt = 0;
  private socket: WsLike | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSeen = 0;
  private readonly ws: WsFactory;
  private readonly pingMs: number;
  private readonly minMs: number;
  private readonly maxMs: number;

  constructor(private readonly o: LiveOptions) {
    this.ws = o.ws ?? defaultWs;
    this.pingMs = o.pingMs ?? 25_000;
    this.minMs = o.backoffMinMs ?? 1_000;
    this.maxMs = o.backoffMaxMs ?? 30_000;
  }

  /** El último `seq` visto: desde ahí reanuda la próxima conexión. */
  get seq(): number {
    return this.lastSeq;
  }

  /** Lee el snapshot (reintenta con backoff si falla) y abre el WebSocket. */
  start(): void {
    this.stopped = false;
    void this.boot();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.clearPing();
    const s = this.socket;
    this.socket = null;
    s?.close(1000, 'adiós');
  }

  private async boot(): Promise<void> {
    try {
      const snap = await this.o.loadSnapshot();
      if (this.stopped) return;
      this.lastSeq = snap.seq;
      this.ready = true;
      this.o.onSnapshot?.(snap);
      this.connect();
    } catch (err) {
      if (this.stopped) return;
      this.o.log(`no pude leer el proyecto ${this.o.projectId}: ${errMsg(err)}`);
      this.retry(() => void this.boot());
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const url = liveUrl(this.o.baseUrl, this.o.projectId, this.lastSeq);
    let s: WsLike;
    try {
      s = this.ws(url, ['dagyard', `token.${this.o.key}`]);
    } catch (err) {
      this.o.log(`no pude abrir el WebSocket: ${errMsg(err)}`);
      this.retry(() => this.connect());
      return;
    }
    this.socket = s;
    s.onmessage = (ev) => {
      if (this.socket === s) this.onFrame(ev.data);
    };
    s.onerror = () => {
      // el detalle llega en onclose; reconectar se decide solo ahí
    };
    s.onclose = (ev) => {
      if (this.socket !== s) return;
      this.socket = null;
      this.clearPing();
      if (this.stopped) return;
      const why = ev.code === 4004 ? 'el proyecto se borró' : `código ${ev.code}${ev.reason ? ` (${ev.reason})` : ''}`;
      this.o.log(`se cerró el tiempo real: ${why}; reconecto desde seq ${this.lastSeq}`);
      this.retry(() => this.connect());
    };
    s.onopen = () => {
      if (this.socket !== s) return;
      this.lastSeen = Date.now();
      this.clearPing();
      this.pingTimer = setInterval(() => this.ping(s), this.pingMs);
    };
  }

  private onFrame(data: unknown): void {
    this.lastSeen = Date.now();
    let frame: ServerFrame;
    try {
      frame = JSON.parse(typeof data === 'string' ? data : String(data)) as ServerFrame;
    } catch {
      return; // `pong` en texto plano u otro ruido
    }
    switch (frame.type) {
      case 'hello':
        this.attempt = 0;
        this.o.log(`conectado al proyecto ${frame.projectId} (seq ${frame.seq}, reanudo desde ${this.lastSeq})`);
        return;
      case 'event':
        if (frame.event.seq <= this.lastSeq) return;
        this.lastSeq = frame.event.seq;
        this.o.onEvent(frame.event);
        return;
      case 'resync':
        void this.resync(frame.seq);
        return;
      default:
        return;
    }
  }

  /** El `since` era viejo (o el proyecto se recreó): saltamos al presente sin reemitir lo viejo. */
  private async resync(serverSeq: number): Promise<void> {
    this.lastSeq = serverSeq;
    try {
      const snap = await this.o.loadSnapshot();
      this.lastSeq = Math.max(this.lastSeq, snap.seq);
      this.o.onSnapshot?.(snap);
      this.o.log(`resync: sigo desde seq ${this.lastSeq}`);
    } catch (err) {
      this.o.log(`resync: no pude leer el snapshot (${errMsg(err)}); sigo desde seq ${this.lastSeq}`);
    }
  }

  private ping(s: WsLike): void {
    if (Date.now() - this.lastSeen > this.pingMs * 2.5) {
      this.o.log('el servidor no responde al ping; reconecto');
      s.close(4000, 'sin pong');
      // si el close no llega (red muerta), forzamos la reconexión
      if (this.socket === s) s.onclose?.({ code: 4000, reason: 'sin pong' });
      return;
    }
    try {
      s.send('{"type":"ping"}');
    } catch {
      // el close llegará solo
    }
  }

  private retry(fn: () => void): void {
    if (this.stopped) return;
    const delay = Math.min(this.maxMs, this.minMs * 2 ** this.attempt);
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      fn();
    }, delay);
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** ¿Ya hay un `seq` de partida? (el primer snapshot se leyó) */
  get started(): boolean {
    return this.ready;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
