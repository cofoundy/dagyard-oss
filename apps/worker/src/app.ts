import {
  DEFAULT_STAGES,
  LIMITS,
  countNodes,
  isSlug,
  nextStartable,
  parseBlockerInput,
  parseMessageInput,
  parseNodeInput,
  parseNodePatch,
  parseProjectGraphInput,
  parseProjectInput,
  parseResolveInput,
  slugify,
  wouldCreateCycle,
  type Blocker,
  type BlockerWaitResult,
  type DagNode,
  type Edge,
  type Message,
  type NodeInput,
  type Parsed,
  type Project,
  type ProjectSummary,
  type Stage,
  type StageInput,
} from '@dagyard/model';
import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE, authenticate, requireOwner, roleOfToken } from './auth.js';
import { randomId, seal, sessionValue, unseal } from './crypto.js';
import type { AppEnv } from './env.js';
import { ApiFailure, errorResponse, fail, notFound } from './http.js';
import {
  clearGraph,
  commit,
  eventsSince,
  getBlockerRow,
  getProject,
  insertBlocker,
  insertEdge,
  insertMessage,
  insertNode,
  loadGraph,
  openBlockerCount,
  requireNode,
  requireProject,
  snapshot,
  toBlocker,
  toProject,
  updateNode,
} from './store.js';

type C = Context<AppEnv>;

export const app = new Hono<AppEnv>();

const ok = <T>(p: Parsed<T>): T => (p.ok ? p.value : fail('invalid', p.message));

async function body(c: C): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return fail('invalid', 'el body no es JSON válido');
  }
}

const iso = () => new Date().toISOString();
const toStages = (input: StageInput[] | undefined): Stage[] =>
  (input ?? DEFAULT_STAGES).map((s) => ({ id: s.id ?? slugify(s.name), name: s.name }));
const signature = (n: Pick<DagNode, 'team'>) => (n.team ? `Equipo de ${n.team}` : 'Agente');
const RESUME_TEXT = 'Gracias. Sigo desde donde me quedé.';
const room = (c: C, pid: string) => c.env.PROJECT_ROOM.get(c.env.PROJECT_ROOM.idFromName(pid));

function pidParam(c: C): string {
  const pid = c.req.param('pid')!;
  return isSlug(pid) ? pid : notFound(`El proyecto «${pid}»`);
}

/** Nodo nuevo con las reglas del servidor: `done` → progress 1. */
function newNode(pid: string, input: NodeInput, stages: Stage[], now: string, at = ''): DagNode {
  if (!stages.some((s) => s.id === input.stage)) fail('invalid', `${at}stage: «${input.stage}» no es una etapa del proyecto`);
  const status = input.status ?? 'pending';
  return {
    id: input.id ?? slugify(input.title),
    projectId: pid,
    stage: input.stage,
    title: input.title,
    status,
    progress: status === 'done' ? 1 : (input.progress ?? 0),
    team: input.team ?? null,
    goal: input.goal ?? null,
    reportUrl: input.reportUrl ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ errores y auth */

app.onError((err, c) => {
  if (err instanceof ApiFailure) return errorResponse(err.code, err.message);
  console.error(JSON.stringify({ msg: 'error no controlado', path: c.req.path, err: String(err), stack: (err as Error).stack }));
  return errorResponse('internal', 'Algo falló de nuestro lado. Inténtalo de nuevo.');
});

app.notFound((c) => (c.req.path.startsWith('/api/') ? errorResponse('not_found', 'Esa ruta no existe') : c.env.ASSETS.fetch(c.req.raw)));

app.get('/api/health', (c) => c.json({ ok: true, version: c.env.VERSION || 'dev' }));

app.post('/api/session', async (c) => {
  const b = (await body(c)) as { token?: unknown } | null;
  const role = typeof b?.token === 'string' ? await roleOfToken(c.env, b.token.trim()) : null;
  if (role !== 'owner') return errorResponse('unauthorized', 'Ese token no es válido');
  setCookie(c, SESSION_COOKIE, await sessionValue(c.env.OWNER_TOKEN), {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return c.body(null, 204);
});

app.delete('/api/session', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.body(null, 204);
});

app.use('/api/*', async (c, next) => {
  const live = /^\/api\/projects\/[^/]+\/live$/.test(c.req.path);
  const role = await authenticate(c, { allowQuery: live });
  if (!role) return errorResponse('unauthorized', 'Falta una credencial válida');
  c.set('role', role);
  await next();
});

app.get('/api/me', (c) => c.json({ role: c.get('role') }));

/* ------------------------------------------------------------------ proyectos */

app.get('/api/projects', async (c) => {
  const db = c.env.DB;
  const [p, n, b] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM projects ORDER BY updated_at DESC'),
    db.prepare('SELECT project_id, status, COUNT(*) AS n FROM nodes GROUP BY project_id, status'),
    db.prepare("SELECT project_id, COUNT(*) AS n FROM blockers WHERE status = 'open' GROUP BY project_id"),
  ]);
  const projects: ProjectSummary[] = p!.results.map((r) => {
    const pr = toProject(r);
    const statuses = n!.results
      .filter((x) => x.project_id === pr.id)
      .flatMap((x) => Array.from({ length: Number(x.n) }, () => ({ status: x.status as DagNode['status'] })));
    return {
      id: pr.id,
      name: pr.name,
      stages: pr.stages,
      counts: countNodes(statuses),
      openBlockers: Number(b!.results.find((x) => x.project_id === pr.id)?.n ?? 0),
      updatedAt: pr.updatedAt,
    };
  });
  return c.json({ projects });
});

app.post('/api/projects', async (c) => {
  const input = ok(parseProjectInput(await body(c)));
  const id = input.id ?? slugify(input.name);
  if (await getProject(c.env.DB, id)) fail('conflict', `Ya existe un proyecto «${id}»`);
  const now = iso();
  const project: Project = { id, name: input.name, stages: toStages(input.stages), createdAt: now, updatedAt: now };
  await c.env.DB.prepare('INSERT INTO projects (id, name, stages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, project.name, JSON.stringify(project.stages), now, now)
    .run();
  return c.json(project, 201);
});

app.get('/api/projects/:pid', async (c) => c.json(await snapshot(c.env.DB, pidParam(c))));

app.put('/api/projects/:pid', async (c) => {
  const pid = pidParam(c);
  const g = ok(parseProjectGraphInput(await body(c)));
  const db = c.env.DB;
  const prev = await getProject(db, pid);
  const now = iso();
  const stages = g.stages ? toStages(g.stages) : (prev?.stages ?? toStages(undefined));
  const blockedBy = new Set((g.blockers ?? []).map((b) => b.nodeId));
  const nodes = g.nodes.map((n, i) => {
    const node = newNode(pid, n, stages, now, `nodes[${i}].`);
    if (node.status === 'blocked' && !blockedBy.has(node.id))
      fail('invalid', `nodes[${i}].status: «blocked» lo pone un bloqueante; agrégalo en blockers`);
    // una tarea con un bloqueante abierto está bloqueada, la declare así o no
    if (blockedBy.has(node.id)) node.status = 'blocked';
    return node;
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: Edge[] = g.nodes.flatMap((n, i) => (n.deps ?? []).map((d) => ({ projectId: pid, from: d, to: nodes[i]!.id })));
  const blockers: Blocker[] = (g.blockers ?? []).map((b) => ({
    id: randomId('b_'),
    projectId: pid,
    nodeId: b.nodeId,
    kind: b.kind,
    question: b.question,
    options: b.options ?? [],
    accessLabel: b.accessLabel ?? null,
    status: 'open',
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: now,
  }));
  const messages: Message[] = (g.messages ?? []).map((m) => ({
    id: randomId('m_'),
    projectId: pid,
    nodeId: m.nodeId,
    from: m.from ?? signature(byId.get(m.nodeId)!),
    text: m.text,
    reportUrl: m.reportUrl ?? null,
    createdAt: now,
  }));
  const project: Project = { id: pid, name: g.name, stages, createdAt: prev?.createdAt ?? now, updatedAt: now };
  await commit(
    c.env,
    pid,
    c.get('role'),
    now,
    [
      db
        .prepare(
          `INSERT INTO projects (id, name, stages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, stages = excluded.stages, updated_at = excluded.updated_at`,
        )
        .bind(pid, project.name, JSON.stringify(stages), project.createdAt, now),
      ...clearGraph(db, pid),
      ...nodes.map((n) => insertNode(db, n)),
      ...edges.map((e) => insertEdge(db, e)),
      ...blockers.map((b) => insertBlocker(db, b)),
      ...messages.map((m) => insertMessage(db, m)),
    ],
    [{ type: 'project.replaced', payload: { project } }],
  );
  return c.json(await snapshot(db, pid));
});

app.patch('/api/projects/:pid', async (c) => {
  const pid = pidParam(c);
  const db = c.env.DB;
  const prev = await requireProject(db, pid);
  const b = await body(c);
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return fail('invalid', 'body: se esperaba un objeto');
  const extra = Object.keys(b).filter((k) => k !== 'name' && k !== 'stages');
  if (extra.length) fail('invalid', `campos no editables: ${extra.join(', ')}`);
  const o = b as { name?: unknown; stages?: unknown };
  if (o.name === undefined && o.stages === undefined) fail('invalid', 'nada que actualizar');
  const input = ok(parseProjectInput({ name: o.name ?? prev.name, ...(o.stages !== undefined && { stages: o.stages }) }));
  const stages = input.stages ? toStages(input.stages) : prev.stages;
  if (input.stages) {
    const ids = new Set(stages.map((s) => s.id));
    const { nodes } = await loadGraph(db, pid);
    const orphan = nodes.find((n) => !ids.has(n.stage));
    if (orphan) fail('invalid', `stages: la tarea «${orphan.title}» usa la etapa «${orphan.stage}»; muévela antes de quitarla`);
  }
  const now = iso();
  const project: Project = { ...prev, name: input.name, stages, updatedAt: now };
  await commit(
    c.env,
    pid,
    c.get('role'),
    now,
    [db.prepare('UPDATE projects SET name = ?, stages = ? WHERE id = ?').bind(project.name, JSON.stringify(stages), pid)],
    [{ type: 'project.updated', payload: { project } }],
  );
  return c.json(project);
});

app.delete('/api/projects/:pid', async (c) => {
  requireOwner(c, 'Borrar un proyecto');
  const pid = pidParam(c);
  const db = c.env.DB;
  await requireProject(db, pid);
  await db.batch([
    ...clearGraph(db, pid),
    db.prepare('DELETE FROM events WHERE project_id = ?').bind(pid),
    db.prepare('DELETE FROM projects WHERE id = ?').bind(pid),
  ]);
  await room(c, pid).reset();
  return c.body(null, 204);
});

app.get('/api/projects/:pid/next', async (c) => {
  const { project, nodes, edges } = await loadGraph(c.env.DB, pidParam(c));
  return c.json(nextStartable(project.stages, nodes, edges));
});

app.get('/api/projects/:pid/events', async (c) => {
  const pid = pidParam(c);
  await requireProject(c.env.DB, pid);
  const raw = c.req.query('since') ?? '0';
  if (!/^\d+$/.test(raw)) fail('invalid', 'since: un número entero ≥ 0');
  return c.json({ events: await eventsSince(c.env.DB, pid, Number(raw), 500) });
});

/* ------------------------------------------------------------------ nodos y aristas */

app.post('/api/projects/:pid/nodes', async (c) => {
  const pid = pidParam(c);
  const input = ok(parseNodeInput(await body(c)));
  const db = c.env.DB;
  const { project, nodes } = await loadGraph(db, pid);
  if (input.status === 'blocked') fail('invalid', 'status: «blocked» lo pone un bloqueante, no se pone a mano');
  if (nodes.length >= LIMITS.nodesPerProject) fail('invalid', `nodes: máximo ${LIMITS.nodesPerProject} por proyecto`);
  const now = iso();
  const node = newNode(pid, input, project.stages, now);
  if (nodes.some((n) => n.id === node.id)) fail('conflict', `Ya existe una tarea «${node.id}»`);
  const deps = [...new Set(input.deps ?? [])];
  for (const d of deps) if (!nodes.some((n) => n.id === d)) fail('invalid', `deps: «${d}» no existe`);
  const edges: Edge[] = deps.map((d) => ({ projectId: pid, from: d, to: node.id }));
  await commit(
    c.env,
    pid,
    c.get('role'),
    now,
    [insertNode(db, node), ...edges.map((e) => insertEdge(db, e))],
    [{ type: 'node.added', payload: { node } }, ...edges.map((edge) => ({ type: 'edge.added' as const, payload: { edge } }))],
  );
  return c.json(node, 201);
});

app.patch('/api/projects/:pid/nodes/:nid', async (c) => {
  const pid = pidParam(c);
  const patch = ok(parseNodePatch(await body(c)));
  const db = c.env.DB;
  const project = await requireProject(db, pid);
  const prev = await requireNode(db, pid, c.req.param('nid'));
  if (patch.status === 'blocked') fail('invalid', 'status: «blocked» lo pone un bloqueante, no se pone a mano');
  if (patch.status !== undefined && (await openBlockerCount(db, pid, prev.id)) > 0)
    fail('conflict', 'La tarea tiene un bloqueante abierto: resuélvelo antes de cambiar su estado');
  if (patch.stage !== undefined && !project.stages.some((s) => s.id === patch.stage))
    fail('invalid', `stage: «${patch.stage}» no es una etapa del proyecto`);
  const now = iso();
  const node: DagNode = { ...prev, ...patch, updatedAt: now };
  if (node.status === 'done') node.progress = 1;
  else if (patch.status === 'working' && prev.status === 'pending') node.progress = patch.progress ?? 0;
  await commit(c.env, pid, c.get('role'), now, [updateNode(db, node)], [{ type: 'node.updated', payload: { node } }]);
  return c.json(node);
});

app.delete('/api/projects/:pid/nodes/:nid', async (c) => {
  const pid = pidParam(c);
  const db = c.env.DB;
  const node = await requireNode(db, pid, c.req.param('nid'));
  const del = (t: string, col = 'node_id') => db.prepare(`DELETE FROM ${t} WHERE project_id = ? AND ${col} = ?`).bind(pid, node.id);
  await commit(
    c.env,
    pid,
    c.get('role'),
    iso(),
    [del('messages'), del('blockers'), del('edges', 'from_id'), del('edges', 'to_id'), del('nodes', 'id')],
    [{ type: 'node.removed', payload: { nodeId: node.id } }],
  );
  return c.body(null, 204);
});

app.post('/api/projects/:pid/edges', async (c) => {
  const pid = pidParam(c);
  const b = (await body(c)) as { from?: unknown; to?: unknown } | null;
  const from = b?.from;
  const to = b?.to;
  if (!isSlug(from) || !isSlug(to)) return fail('invalid', 'from y to: ids de tareas');
  const db = c.env.DB;
  const { nodes, edges } = await loadGraph(db, pid);
  for (const id of [from, to]) if (!nodes.some((n) => n.id === id)) notFound(`La tarea «${id}»`);
  if (edges.some((e) => e.from === from && e.to === to)) fail('conflict', 'Esa dependencia ya existe');
  if (wouldCreateCycle(edges, from, to)) fail('cycle', `«${from}» ya depende de «${to}»: esa dependencia cerraría un ciclo`);
  const edge: Edge = { projectId: pid, from, to };
  await commit(c.env, pid, c.get('role'), iso(), [insertEdge(db, edge)], [{ type: 'edge.added', payload: { edge } }]);
  return c.json(edge, 201);
});

app.delete('/api/projects/:pid/edges', async (c) => {
  const pid = pidParam(c);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!isSlug(from) || !isSlug(to)) return fail('invalid', 'from y to: ids de tareas');
  const db = c.env.DB;
  await requireProject(db, pid);
  const exists = await db.prepare('SELECT 1 FROM edges WHERE project_id = ? AND from_id = ? AND to_id = ?').bind(pid, from, to).first();
  if (!exists) notFound('Esa dependencia');
  const edge: Edge = { projectId: pid, from, to };
  await commit(
    c.env,
    pid,
    c.get('role'),
    iso(),
    [db.prepare('DELETE FROM edges WHERE project_id = ? AND from_id = ? AND to_id = ?').bind(pid, from, to)],
    [{ type: 'edge.removed', payload: { edge } }],
  );
  return c.body(null, 204);
});

/* ------------------------------------------------------------------ bloqueantes */

app.post('/api/projects/:pid/nodes/:nid/blockers', async (c) => {
  const pid = pidParam(c);
  const input = ok(parseBlockerInput(await body(c)));
  const db = c.env.DB;
  await requireProject(db, pid);
  const prev = await requireNode(db, pid, c.req.param('nid'));
  const now = iso();
  const blocker: Blocker = {
    id: randomId('b_'),
    projectId: pid,
    nodeId: prev.id,
    kind: input.kind,
    question: input.question,
    options: input.options ?? [],
    accessLabel: input.accessLabel ?? null,
    status: 'open',
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: now,
  };
  const node: DagNode = { ...prev, status: 'blocked', updatedAt: now };
  await commit(
    c.env,
    pid,
    c.get('role'),
    now,
    [insertBlocker(db, blocker), updateNode(db, node)],
    [
      { type: 'blocker.opened', payload: { blocker } },
      { type: 'node.updated', payload: { node } },
    ],
  );
  return c.json(blocker, 201);
});

async function requireBlockerRow(c: C, pid: string) {
  const bid = c.req.param('bid')!;
  return (await getBlockerRow(c.env.DB, pid, bid)) ?? notFound(`El bloqueante «${bid}»`);
}

app.get('/api/projects/:pid/blockers/:bid', async (c) => c.json(toBlocker(await requireBlockerRow(c, pidParam(c)))));

app.post('/api/projects/:pid/blockers/:bid/resolve', async (c) => {
  requireOwner(c, 'Resolver un bloqueante');
  const pid = pidParam(c);
  const db = c.env.DB;
  const prev = toBlocker(await requireBlockerRow(c, pid));
  if (prev.status === 'resolved') fail('conflict', 'Ese bloqueante ya está resuelto');
  const r = ok(parseResolveInput(await body(c), prev));
  const now = iso();
  const blocker: Blocker = {
    ...prev,
    status: 'resolved',
    resolution: { choice: r.choice, note: r.note, hasValue: r.value !== null },
    resolvedBy: 'owner',
    resolvedAt: now,
  };
  const sealed = r.value !== null ? await seal(c.env.VAULT_KEY, r.value) : null;
  const prevNode = await requireNode(db, pid, prev.nodeId);
  const othersOpen = (await openBlockerCount(db, pid, prev.nodeId)) - 1;
  const node: DagNode = othersOpen > 0 ? { ...prevNode, updatedAt: now } : { ...prevNode, status: 'working', updatedAt: now };
  // el mensaje del sistema solo cuando la tarea de verdad se destraba
  const message: Message | null =
    othersOpen > 0
      ? null
      : { id: randomId('m_'), projectId: pid, nodeId: node.id, from: signature(node), text: RESUME_TEXT, reportUrl: null, createdAt: now };
  await commit(
    c.env,
    pid,
    'owner',
    now,
    [
      db
        .prepare(
          `UPDATE blockers SET status = 'resolved', resolution = ?, resolved_by = 'owner', resolved_at = ?, access_value = ?
           WHERE project_id = ? AND id = ? AND status = 'open'`,
        )
        .bind(JSON.stringify(blocker.resolution), now, sealed, pid, blocker.id),
      updateNode(db, node),
      ...(message ? [insertMessage(db, message)] : []),
    ],
    [
      { type: 'blocker.resolved', payload: { blocker } },
      { type: 'node.updated', payload: { node } },
      ...(message ? [{ type: 'message.posted' as const, payload: { message } }] : []),
    ],
  );
  return c.json(blocker);
});

app.get('/api/projects/:pid/blockers/:bid/wait', async (c) => {
  const pid = pidParam(c);
  const raw = c.req.query('timeout');
  if (raw !== undefined && !/^\d+(\.\d+)?$/.test(raw)) fail('invalid', 'timeout: segundos, entre 0 y 25');
  const timeout = Math.min(25, raw === undefined ? 25 : Number(raw));
  const deadline = Date.now() + timeout * 1000;
  let row = await requireBlockerRow(c, pid);
  while (row.status === 'open' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.min(500, Math.max(0, deadline - Date.now()))));
    row = await requireBlockerRow(c, pid);
  }
  const blocker = toBlocker(row);
  const canSee = blocker.kind === 'access' && blocker.status === 'resolved' && c.get('role') === 'agent' && !!row.access_value;
  const result: BlockerWaitResult = { blocker, value: canSee ? await unseal(c.env.VAULT_KEY, row.access_value as string) : null };
  return c.json(result);
});

/* ------------------------------------------------------------------ mensajes */

app.post('/api/projects/:pid/nodes/:nid/messages', async (c) => {
  const pid = pidParam(c);
  const input = ok(parseMessageInput(await body(c)));
  const db = c.env.DB;
  await requireProject(db, pid);
  const prev = await requireNode(db, pid, c.req.param('nid'));
  const now = iso();
  const message: Message = {
    id: randomId('m_'),
    projectId: pid,
    nodeId: prev.id,
    from: input.from ?? signature(prev),
    text: input.text,
    reportUrl: input.reportUrl ?? null,
    createdAt: now,
  };
  const adopt = message.reportUrl !== null && prev.reportUrl === null;
  const node: DagNode = { ...prev, reportUrl: message.reportUrl, updatedAt: now };
  await commit(
    c.env,
    pid,
    c.get('role'),
    now,
    [insertMessage(db, message), ...(adopt ? [updateNode(db, node)] : [])],
    [{ type: 'message.posted', payload: { message } }, ...(adopt ? [{ type: 'node.updated' as const, payload: { node } }] : [])],
  );
  return c.json(message, 201);
});

/* ------------------------------------------------------------------ tiempo real */

app.get('/api/projects/:pid/live', async (c) => {
  const pid = pidParam(c);
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return fail('invalid', 'Esta ruta espera un WebSocket (Upgrade: websocket)');
  await requireProject(c.env.DB, pid);
  const since = c.req.query('since');
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-dagyard-project', pid);
  headers.delete('x-dagyard-since');
  if (since !== undefined) headers.set('x-dagyard-since', since);
  return room(c, pid).fetch(new Request(c.req.raw.url, { headers }));
});
