import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, goalLine, progressArg, run } from '../src/cli.js';
import type { Blocker } from '@dagyard/model';

const KEY = 'clave-secreta-123';

interface Seen {
  method: string;
  path: string;
  auth: string | undefined;
  body: unknown;
}

/** Server mock con la forma de la API: guarda lo que recibe y resuelve bloqueantes. */
let server: Server;
let baseUrl = '';
let seen: Seen[] = [];
let blockers = new Map<string, Blocker>();
let accessValues = new Map<string, string>();
let nextGoal: string | null = '/goal Pagos con tarjeta';

function reply(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  const body = await readBody(req);
  seen.push({ method: req.method ?? '', path: url.pathname, auth: req.headers.authorization, body });
  if (req.headers.authorization !== `Bearer ${KEY}`) {
    return reply(res, 401, { error: { code: 'unauthorized', message: `token inválido: ${req.headers.authorization}` } });
  }
  const parts = url.pathname.split('/').filter(Boolean); // api projects :p ...
  const [, , projectId, kind, nodeId, sub] = parts;
  if (req.method === 'PUT' && parts.length === 3) return reply(res, 200, { ok: true });
  if (req.method === 'GET' && parts.length === 3) {
    return reply(res, 200, { project: { id: projectId }, nodes: [], edges: [], blockers: [...blockers.values()], messages: [], seq: 0 });
  }
  if (req.method === 'GET' && kind === 'next') {
    return reply(res, 200, { node: nextGoal ? { id: 'pagos' } : null, goalLine: nextGoal });
  }
  if (req.method === 'POST' && kind === 'nodes' && !nodeId) return reply(res, 201, { ...(body as object), projectId });
  if (req.method === 'PATCH' && kind === 'nodes' && nodeId) {
    if ((body as { status?: string }).status === 'blocked') {
      return reply(res, 400, { error: { code: 'invalid', message: 'blocked no se pone a mano' } });
    }
    return reply(res, 200, { id: nodeId });
  }
  if (req.method === 'POST' && kind === 'edges') return reply(res, 201, { projectId, ...(body as object) });
  if (req.method === 'POST' && sub === 'messages') {
    const text = (body as { text: string }).text;
    if (text.length > 280) return reply(res, 400, { error: { code: 'invalid', message: 'largo' } });
    return reply(res, 201, { id: 'm_1' });
  }
  if (req.method === 'POST' && sub === 'blockers') {
    const input = body as Pick<Blocker, 'kind' | 'question' | 'options' | 'accessLabel'>;
    const id = `b_${blockers.size + 1}`;
    const b: Blocker = {
      id,
      projectId: projectId!,
      nodeId: nodeId!,
      kind: input.kind,
      question: input.question,
      options: input.options,
      accessLabel: input.accessLabel ?? null,
      status: 'open',
      resolution: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    };
    blockers.set(id, b);
    return reply(res, 201, b);
  }
  if (req.method === 'GET' && kind === 'blockers' && sub === 'wait') {
    // contrato: 200 apenas se resuelve, o al vencer con el bloqueante todavía open
    const b = blockers.get(nodeId!); // aquí el 5.º segmento es el id del bloqueante
    if (!b) return reply(res, 404, { error: { code: 'not_found', message: 'bloqueante' } });
    const deadline = Date.now() + Math.min(Number(url.searchParams.get('timeout')) * 1000, 300);
    while (Date.now() < deadline && b.status !== 'resolved') await new Promise((r) => setTimeout(r, 20));
    return reply(res, 200, { blocker: b, value: b.status === 'resolved' ? (accessValues.get(b.id) ?? null) : null });
  }
  reply(res, 404, { error: { code: 'not_found', message: url.pathname } });
}

/** Lo que hace el humano desde la UI (fuera del CLI). */
function resolveByApi(id: string, choice: string | null, opts: { note?: string; value?: string } = {}) {
  const b = blockers.get(id)!;
  b.status = 'resolved';
  b.resolution = { choice, note: opts.note ?? null, hasValue: opts.value !== undefined };
  b.resolvedBy = 'owner';
  b.resolvedAt = new Date().toISOString();
  if (opts.value !== undefined) accessValues.set(id, opts.value);
}

beforeAll(async () => {
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  seen = [];
  blockers = new Map();
  accessValues = new Map();
  nextGoal = '/goal Pagos con tarjeta';
});

async function cli(argv: string[], env: Record<string, string> = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
    env: {
      DAGYARD_URL: baseUrl,
      DAGYARD_KEY: KEY,
      DAGYARD_PROJECT: 'demo',
      DAGYARD_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'dagyard-cfg-')),
      ...env,
    },
    sleep: async () => {},
  });
  return { code, stdout, stderr };
}

const last = () => seen[seen.length - 1]!;

describe('ayuda', () => {
  it.each([
    ['node', 'add'],
    ['node', 'update'],
    ['node', 'start'],
    ['node', 'progress'],
    ['node', 'done'],
    ['edge', 'add'],
    ['block'],
    ['wait'],
    ['msg'],
    ['next'],
    ['import'],
  ])('%s %s --help', async (...cmd) => {
    const r = await cli([...cmd.filter(Boolean), '--help']);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toMatch(/^Uso: dagyard /);
    expect(seen).toHaveLength(0);
  });

  it('sin argumentos lista todos los comandos', async () => {
    const r = await cli([]);
    expect(r.code).toBe(0);
    for (const c of ['node add', 'edge add', 'block', 'wait', 'msg', 'next', 'import']) expect(r.stdout).toContain(c);
  });

  it('comando u opción desconocidos → exit 64', async () => {
    expect((await cli(['vuela'])).code).toBe(EXIT.usage);
    expect((await cli(['msg', 'a', 'hola', '--color', 'rojo'])).code).toBe(EXIT.usage);
  });
});

describe('mutar el DAG', () => {
  it('node add manda el NodeInput con ids en slug', async () => {
    const r = await cli(['node', 'add', 'T-402', '--title', 'Pagos con tarjeta', '--stage', 'Construcción', '--dep', 'T-401,T-400', '--goal', 'Cobra con tarjeta']);
    expect(r.code).toBe(0);
    expect(last()).toMatchObject({
      method: 'POST',
      path: '/api/projects/demo/nodes',
      auth: `Bearer ${KEY}`,
      body: { id: 't-402', title: 'Pagos con tarjeta', stage: 'construccion', deps: ['t-401', 't-400'], goal: 'Cobra con tarjeta' },
    });
    expect(r.stdout).toBe('t-402\n');
  });

  it('start, progress y done (y sus atajos) hacen PATCH', async () => {
    await cli(['node', 'start', 'pagos', '--team', 'Construcción']);
    expect(last()).toMatchObject({ method: 'PATCH', path: '/api/projects/demo/nodes/pagos', body: { status: 'working', team: 'Construcción' } });
    await cli(['progress', 'pagos', '40%']);
    expect(last().body).toEqual({ progress: 0.4 });
    await cli(['done', 'pagos', '--report', 'https://basalt.example/r']);
    expect(last().body).toEqual({ status: 'done', reportUrl: 'https://basalt.example/r' });
    await cli(['node', 'update', 'pagos', '--title', 'Cobros']);
    expect(last().body).toEqual({ title: 'Cobros' });
  });

  it('--status blocked se rechaza: lo pone dagyard block', async () => {
    const r = await cli(['node', 'update', 'pagos', '--status', 'blocked']);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('dagyard block');
    expect(seen).toHaveLength(0);
  });

  it('edge add', async () => {
    const r = await cli(['edge', 'add', 'diseno', 'pagos', '-p', 'Otro Proyecto']);
    expect(r.code).toBe(0);
    expect(last()).toMatchObject({ method: 'POST', path: '/api/projects/otro-proyecto/edges', body: { from: 'diseno', to: 'pagos' } });
  });
});

describe('msg', () => {
  it('manda el texto y el informe', async () => {
    const r = await cli(['msg', 'pagos', 'Listo el cobro, falta el reembolso', '--report', 'https://basalt.example/r']);
    expect(r.code).toBe(0);
    expect(last()).toMatchObject({ path: '/api/projects/demo/nodes/pagos/messages', body: { text: 'Listo el cobro, falta el reembolso', reportUrl: 'https://basalt.example/r' } });
  });

  it('rechaza más de 280 caracteres sin llamar al servidor', async () => {
    const r = await cli(['msg', 'pagos', 'a'.repeat(281)]);
    expect(r.code).toBe(EXIT.usage);
    expect(seen).toHaveLength(0);
  });
});

describe('next', () => {
  it('imprime /goal en una sola línea física', async () => {
    nextGoal = '/goal Pagos con tarjeta —\n  sigue el plan\ty cumple';
    const r = await cli(['next', '--project', 'demo']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('/goal Pagos con tarjeta — sigue el plan y cumple\n');
    expect(r.stdout.trimEnd().split('\n')).toHaveLength(1);
  });

  it('exit 3 si no hay nada arrancable', async () => {
    nextGoal = null;
    const r = await cli(['next']);
    expect(r.code).toBe(EXIT.nothing);
    expect(r.stdout).toBe('');
  });
});

describe('block + wait', () => {
  it('decision: block imprime el id y wait devuelve la elección cuando se resuelve por la API', async () => {
    const b = await cli(['block', 'pagos', '--kind', 'decision', '--q', '¿Qué pasarela?', '--opt', 'Culqi', '--opt', 'Niubiz']);
    expect(b.code).toBe(0);
    const id = b.stdout.trim();
    expect(blockers.get(id)).toMatchObject({ kind: 'decision', options: ['Culqi', 'Niubiz'] });

    const waiting = cli(['wait', 'pagos', '--blocker', id]);
    await new Promise((r) => setTimeout(r, 450)); // al menos una vuelta de long-poll vence en 204
    resolveByApi(id, 'Niubiz', { note: 'más barata' });
    const w = await waiting;
    expect(w.code).toBe(0);
    expect(w.stdout).toBe('Niubiz\nnota: más barata\n');
    const waits = seen.filter((s) => s.path.endsWith('/wait'));
    expect(waits.length).toBeGreaterThanOrEqual(2);
    expect(waits[0]!.path).toBe(`/api/projects/demo/blockers/${id}/wait`);
  });

  it('access: wait devuelve el valor; --json la resolución completa', async () => {
    const b = await cli(['block', 'pagos', '--kind', 'access', '--q', 'Necesito la clave', '--label', 'Clave de la pasarela']);
    const id = b.stdout.trim();
    expect(blockers.get(id)).toMatchObject({ options: [], accessLabel: 'Clave de la pasarela' });
    resolveByApi(id, null, { value: 'sk_test_42' });
    const w = await cli(['wait', 'pagos', '--json']);
    expect(w.code).toBe(0);
    expect(JSON.parse(w.stdout)).toMatchObject({ value: 'sk_test_42', blocker: { id, status: 'resolved' } });
  });

  it('wait sin --blocker toma el último abierto del nodo desde el snapshot', async () => {
    const a = (await cli(['block', 'pagos', '--kind', 'decision', '--q', '¿A?', '--opt', 'Sí'])).stdout.trim();
    const b = (await cli(['block', 'pagos', '--kind', 'decision', '--q', '¿B?', '--opt', 'No'])).stdout.trim();
    resolveByApi(a, 'Sí');
    resolveByApi(b, 'No');
    blockers.get(a)!.createdAt = '2026-01-01T00:00:00.000Z';
    blockers.get(b)!.createdAt = '2026-01-02T00:00:00.000Z';
    const w = await cli(['wait', 'pagos']);
    expect(w.code).toBe(0);
    expect(w.stdout).toBe('No\n');
    expect(last().path).toBe(`/api/projects/demo/blockers/${b}/wait`);
  });

  it('wait de un nodo sin bloqueantes explica cómo abrir uno', async () => {
    const w = await cli(['wait', 'otro']);
    expect(w.code).toBe(EXIT.usage);
    expect(w.stderr).toContain('dagyard block otro');
  });

  it('review sin --opt ofrece Aprobar / Pedir cambios', async () => {
    const b = await cli(['block', 'pagos', '--kind', 'review', '--q', 'Revisa el flujo']);
    expect(blockers.get(b.stdout.trim())?.options).toEqual(['Aprobar', 'Pedir cambios']);
  });

  it('wait con --timeout vence con exit 2', async () => {
    await cli(['block', 'pagos', '--kind', 'decision', '--q', '¿Sí?', '--opt', 'Sí']);
    const w = await cli(['wait', 'pagos', '--timeout', '1']);
    expect(w.code).toBe(EXIT.timeout);
  });

  it('valida kind y opciones antes de llamar', async () => {
    expect((await cli(['block', 'pagos', '--kind', 'otro', '--q', 'x'])).code).toBe(EXIT.usage);
    expect((await cli(['block', 'pagos', '--kind', 'decision', '--q', 'x'])).code).toBe(EXIT.usage);
    expect(seen).toHaveLength(0);
  });
});

describe('import', () => {
  const from = join(__dirname, 'fixtures', 'basalt');

  it('--dry-run no necesita servidor ni key', async () => {
    const r = await cli(['import', '--from', from, '--dry-run'], { DAGYARD_URL: '', DAGYARD_KEY: '' });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('23 nodos');
    expect(r.stdout).toContain('simulación');
    expect(seen).toHaveLength(0);
  });

  it('sin --dry-run hace PUT del grafo entero', async () => {
    const r = await cli(['import', '--from', from, '--project', 'basalt-fabrica', '--name', 'Basalt (fábrica)']);
    expect(r.code).toBe(0);
    const put = last();
    expect(put).toMatchObject({ method: 'PUT', path: '/api/projects/basalt-fabrica' });
    const body = put.body as { name: string; nodes: Array<{ id: string; deps: string[] }> };
    expect(body.name).toBe('Basalt (fábrica)');
    expect(body.nodes.find((n) => n.id === 'l3')?.deps).toEqual(['l1', 'l2']);
  });
});

describe('errores', () => {
  it('nunca imprime la API key, aunque el servidor la devuelva', async () => {
    const bad = 'otra-clave-que-no-sirve';
    const r = await cli(['msg', 'pagos', 'hola'], { DAGYARD_KEY: bad });
    expect(r.code).toBe(EXIT.api);
    expect(r.stderr).toContain('unauthorized');
    expect(r.stderr).not.toContain(bad);
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it('sin servidor configurado explica de dónde sale', async () => {
    const r = await cli(['next'], { DAGYARD_URL: '' });
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('DAGYARD_URL');
  });

  it('servidor caído → exit 1 con mensaje', async () => {
    const r = await cli(['next'], { DAGYARD_URL: 'http://127.0.0.1:1' });
    expect(r.code).toBe(EXIT.api);
    expect(r.stderr).toContain('no pude conectar');
  });
});

describe('helpers', () => {
  it('progressArg acepta 0..1, 0..100 y %', () => {
    expect(progressArg('0.25')).toBe(0.25);
    expect(progressArg('40')).toBe(0.4);
    expect(progressArg('100%')).toBe(1);
    expect(() => progressArg('150%')).toThrow();
  });

  it('goalLine siempre empieza con /goal', () => {
    expect(goalLine('Pagos')).toBe('/goal Pagos');
    expect(goalLine('/goal  Pagos\n')).toBe('/goal Pagos');
  });
});
