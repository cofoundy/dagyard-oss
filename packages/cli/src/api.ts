/**
 * El único módulo que conoce la API REST (`docs/api.md`). Si una ruta cambia, cambia aquí.
 */
import type {
  ApiError,
  Blocker,
  BlockerInput,
  BlockerWaitResult,
  DagNode,
  Edge,
  Message,
  MessageInput,
  NextResult,
  NodeInput,
  NodePatch,
  ProjectGraphInput,
  ProjectSnapshot,
} from '@dagyard/model';

const p = encodeURIComponent;

export const ROUTES = {
  /**
   * GET: snapshot completo · PUT: reemplaza el grafo entero (idempotente). Con `If-None-Match: *` solo
   * crea: 409 si ya existe. Con la API key conserva los bloqueantes (abiertos y respondidos) y responde
   * 409 si el grafo nuevo quita una tarea que tiene alguno.
   */
  project: (projectId: string) => `/api/projects/${p(projectId)}`,
  /** GET: el siguiente nodo arrancable y su línea `/goal`. */
  next: (projectId: string) => `/api/projects/${p(projectId)}/next`,
  /** POST: crea un nodo. */
  nodes: (projectId: string) => `/api/projects/${p(projectId)}/nodes`,
  /** PATCH: actualiza un nodo. */
  node: (projectId: string, nodeId: string) => `/api/projects/${p(projectId)}/nodes/${p(nodeId)}`,
  /** POST: crea una arista `{ from, to }`. */
  edges: (projectId: string) => `/api/projects/${p(projectId)}/edges`,
  /** POST: abre un bloqueante sobre el nodo. */
  blockers: (projectId: string, nodeId: string) =>
    `/api/projects/${p(projectId)}/nodes/${p(nodeId)}/blockers`,
  /**
   * GET long-poll (`timeout` ≤25 s): 200 `BlockerWaitResult` apenas se resuelve, o al vencer con el
   * bloqueante todavía `open` (entonces se vuelve a llamar).
   */
  wait: (projectId: string, blockerId: string) =>
    `/api/projects/${p(projectId)}/blockers/${p(blockerId)}/wait`,
  /** POST: mensaje corto del agente al PM. */
  messages: (projectId: string, nodeId: string) =>
    `/api/projects/${p(projectId)}/nodes/${p(nodeId)}/messages`,
} as const;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface ClientOptions {
  baseUrl: string;
  key: string;
  fetch?: typeof fetch;
}

export class DagyardClient {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.key = opts.key;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** `exclusive`: creación exclusiva (`If-None-Match: *`); si el proyecto ya existe, 409 sin tocarlo. */
  putProject(projectId: string, graph: ProjectGraphInput, opts: { exclusive?: boolean } = {}): Promise<unknown> {
    return this.json('PUT', ROUTES.project(projectId), graph, opts.exclusive ? { 'if-none-match': '*' } : {});
  }

  snapshot(projectId: string): Promise<ProjectSnapshot> {
    return this.json('GET', ROUTES.project(projectId));
  }

  next(projectId: string): Promise<NextResult> {
    return this.json('GET', ROUTES.next(projectId));
  }

  addNode(projectId: string, node: NodeInput): Promise<DagNode> {
    return this.json('POST', ROUTES.nodes(projectId), node);
  }

  updateNode(projectId: string, nodeId: string, patch: NodePatch): Promise<DagNode> {
    return this.json('PATCH', ROUTES.node(projectId, nodeId), patch);
  }

  addEdge(projectId: string, from: string, to: string): Promise<Edge> {
    return this.json('POST', ROUTES.edges(projectId), { from, to });
  }

  openBlocker(projectId: string, nodeId: string, input: BlockerInput): Promise<Blocker> {
    return this.json('POST', ROUTES.blockers(projectId, nodeId), input);
  }

  /** Una vuelta de long-poll: `null` si venció con el bloqueante todavía abierto. */
  async waitOnce(projectId: string, blockerId: string, timeoutSec: number): Promise<BlockerWaitResult | null> {
    const qs = new URLSearchParams({ timeout: String(timeoutSec) });
    const res = await this.request('GET', `${ROUTES.wait(projectId, blockerId)}?${qs}`);
    if (res.status === 204) return null;
    const body = (await res.json()) as BlockerWaitResult;
    return body.blocker.status === 'resolved' ? body : null;
  }

  postMessage(projectId: string, nodeId: string, input: MessageInput): Promise<Message> {
    return this.json('POST', ROUTES.messages(projectId, nodeId), input);
  }

  private async json<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const res = await this.request(method, path, body, extra);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async request(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...extra,
      authorization: `Bearer ${this.key}`,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new ApiRequestError(0, 'network', `no pude conectar con ${this.baseUrl}: ${cause}`);
    }
    if (!res.ok) {
      let code = `http_${res.status}`;
      let message = res.statusText || 'error';
      try {
        const err = (await res.json()) as Partial<ApiError>;
        if (err.error?.code) code = err.error.code;
        if (err.error?.message) message = err.error.message;
      } catch {
        // cuerpo no-JSON: nos quedamos con el status
      }
      throw new ApiRequestError(res.status, code, message);
    }
    return res;
  }
}
