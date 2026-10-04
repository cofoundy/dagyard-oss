import { DEMO_PROJECT_ID, demoProject, type ProjectSnapshot, type ServerFrame } from '@dagyard/model';
import { SELF } from 'cloudflare:test';
import { expect } from 'vitest';

export const OWNER = { authorization: 'Bearer test-owner-token' };
export const AGENT = { authorization: 'Bearer test-agent-key' };
export const BASE = 'https://dagyard.test';

export async function api(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(opts.headers ?? AGENT) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return SELF.fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

export async function json<T = any>(res: Response, status: number): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return (text ? JSON.parse(text) : null) as T;
}

/** Id de proyecto único por test: no dependemos del aislamiento de storage del pool. */
export const uniquePid = (prefix = 'p') => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

export async function seedDemo(pid = uniquePid(DEMO_PROJECT_ID)): Promise<ProjectSnapshot> {
  return json<ProjectSnapshot>(await api(`/api/projects/${pid}`, { method: 'PUT', body: demoProject() }), 200);
}

export interface Live {
  ws: WebSocket;
  frames: ServerFrame[];
  waitFor<F extends ServerFrame>(pred: (f: ServerFrame) => f is F, ms?: number): Promise<F>;
  waitFor(pred: (f: ServerFrame) => boolean, ms?: number): Promise<ServerFrame>;
}

/** Abre el WebSocket de verdad contra el Worker y junta cada frame recibido. */
export async function openLive(pid: string, query = '', headers: Record<string, string> = AGENT): Promise<Live> {
  const res = await SELF.fetch(`${BASE}/api/projects/${pid}/live${query}`, { headers: { upgrade: 'websocket', ...headers } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const frames: ServerFrame[] = [];
  ws.addEventListener('message', (e) => {
    frames.push(JSON.parse(e.data as string));
  });
  const waitFor = async (pred: (f: ServerFrame) => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    for (;;) {
      const f = frames.find(pred);
      if (f) return f;
      if (Date.now() > end) throw new Error(`no llegó el frame esperado; recibidos: ${JSON.stringify(frames)}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return { ws, frames, waitFor } as Live;
}
