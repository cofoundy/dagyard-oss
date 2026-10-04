/** Lecturas y escrituras en D1. Cada escritura va en un solo `DB.batch()` junto con sus eventos. */
import {
  MESSAGES_IN_SNAPSHOT,
  type Blocker,
  type BlockerResolution,
  type DagEvent,
  type DagEventType,
  type DagNode,
  type Edge,
  type Message,
  type Project,
  type ProjectSnapshot,
  type Role,
} from '@dagyard/model';
import type { Env } from './env.js';
import { notFound } from './http.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const ns = (v: unknown) => (v ?? null) as string | null;

export const toProject = (r: Row): Project => ({
  id: s(r.id),
  name: s(r.name),
  stages: JSON.parse(s(r.stages)),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

export const toNode = (r: Row): DagNode => ({
  id: s(r.id),
  projectId: s(r.project_id),
  stage: s(r.stage),
  title: s(r.title),
  status: r.status as DagNode['status'],
  progress: Number(r.progress),
  team: ns(r.team),
  goal: ns(r.goal),
  reportUrl: ns(r.report_url),
  createdAt: s(r.created_at),
  updatedAt: s(r.updated_at),
});

export const toEdge = (r: Row): Edge => ({ projectId: s(r.project_id), from: s(r.from_id), to: s(r.to_id) });

/** Nunca lee `access_value`: el valor no sale por aquí. */
export const toBlocker = (r: Row): Blocker => ({
  id: s(r.id),
  projectId: s(r.project_id),
  nodeId: s(r.node_id),
  kind: r.kind as Blocker['kind'],
  question: s(r.question),
  options: JSON.parse(s(r.options)),
  accessLabel: ns(r.access_label),
  status: r.status as Blocker['status'],
  resolution: r.resolution ? (JSON.parse(s(r.resolution)) as BlockerResolution) : null,
  resolvedBy: ns(r.resolved_by) as Role | null,
  resolvedAt: ns(r.resolved_at),
  createdAt: s(r.created_at),
});

export const toMessage = (r: Row): Message => ({
  id: s(r.id),
  projectId: s(r.project_id),
  nodeId: s(r.node_id),
  from: s(r.from_name),
  text: s(r.text),
  reportUrl: ns(r.report_url),
  createdAt: s(r.created_at),
});

const BLOCKER_COLS = 'id, project_id, node_id, kind, question, options, access_label, status, resolution, resolved_by, resolved_at, created_at';

/* ------------------------------------------------------------------ lecturas */

export async function getProject(db: D1Database, pid: string): Promise<Project | null> {
  const r = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(pid).first<Row>();
  return r ? toProject(r) : null;
}

export async function requireProject(db: D1Database, pid: string): Promise<Project> {
  return (await getProject(db, pid)) ?? notFound(`El proyecto «${pid}»`);
}

export async function getNode(db: D1Database, pid: string, nid: string): Promise<DagNode | null> {
  const r = await db.prepare('SELECT * FROM nodes WHERE project_id = ? AND id = ?').bind(pid, nid).first<Row>();
  return r ? toNode(r) : null;
}

export async function requireNode(db: D1Database, pid: string, nid: string): Promise<DagNode> {
  return (await getNode(db, pid, nid)) ?? notFound(`La tarea «${nid}»`);
}

export async function getBlockerRow(db: D1Database, pid: string, bid: string): Promise<Row | null> {
  return db.prepare('SELECT * FROM blockers WHERE project_id = ? AND id = ?').bind(pid, bid).first<Row>();
}

export async function openBlockerCount(db: D1Database, pid: string, nid: string): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM blockers WHERE project_id = ? AND node_id = ? AND status = 'open'")
    .bind(pid, nid)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

const nodesQ = (db: D1Database, pid: string) =>
  db.prepare('SELECT * FROM nodes WHERE project_id = ? ORDER BY created_at, rowid').bind(pid);
const edgesQ = (db: D1Database, pid: string) =>
  db.prepare('SELECT * FROM edges WHERE project_id = ? ORDER BY rowid').bind(pid);

/** Proyecto, nodos y aristas en una lectura consistente. */
export async function loadGraph(db: D1Database, pid: string): Promise<{ project: Project; nodes: DagNode[]; edges: Edge[] }> {
  const [p, n, e] = await db.batch<Row>([db.prepare('SELECT * FROM projects WHERE id = ?').bind(pid), nodesQ(db, pid), edgesQ(db, pid)]);
  const row = p!.results[0];
  if (!row) return notFound(`El proyecto «${pid}»`);
  return { project: toProject(row), nodes: n!.results.map(toNode), edges: e!.results.map(toEdge) };
}

export async function snapshot(db: D1Database, pid: string): Promise<ProjectSnapshot> {
  const [p, n, e, b, m, q] = await db.batch<Row>([
    db.prepare('SELECT * FROM projects WHERE id = ?').bind(pid),
    nodesQ(db, pid),
    edgesQ(db, pid),
    db.prepare(`SELECT ${BLOCKER_COLS} FROM blockers WHERE project_id = ? ORDER BY created_at, rowid`).bind(pid),
    db
      .prepare(
        `SELECT * FROM (SELECT *, rowid AS r FROM messages WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${MESSAGES_IN_SNAPSHOT})
         ORDER BY created_at, r`,
      )
      .bind(pid),
    db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE project_id = ?').bind(pid),
  ]);
  const row = p!.results[0];
  if (!row) return notFound(`El proyecto «${pid}»`);
  return {
    project: toProject(row),
    nodes: n!.results.map(toNode),
    edges: e!.results.map(toEdge),
    blockers: b!.results.map(toBlocker),
    messages: m!.results.map(toMessage),
    seq: Number(q!.results[0]?.seq ?? 0),
  };
}

export async function currentSeq(db: D1Database, pid: string): Promise<number> {
  const r = await db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE project_id = ?').bind(pid).first<{ seq: number }>();
  return Number(r?.seq ?? 0);
}

export async function eventsSince(db: D1Database, pid: string, since: number, limit: number): Promise<DagEvent[]> {
  const { results } = await db
    .prepare('SELECT * FROM events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?')
    .bind(pid, since, limit)
    .all<Row>();
  return results.map(
    (r) =>
      ({
        seq: Number(r.seq),
        projectId: s(r.project_id),
        type: r.type as DagEventType,
        actor: r.actor as Role,
        at: s(r.at),
        payload: JSON.parse(s(r.payload)),
      }) as DagEvent,
  );
}

/* ------------------------------------------------------------------ escrituras */

export function insertNode(db: D1Database, n: DagNode): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO nodes (project_id, id, stage, title, status, progress, team, goal, report_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(n.projectId, n.id, n.stage, n.title, n.status, n.progress, n.team, n.goal, n.reportUrl, n.createdAt, n.updatedAt);
}

export function updateNode(db: D1Database, n: DagNode): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE nodes SET stage = ?, title = ?, status = ?, progress = ?, team = ?, goal = ?, report_url = ?, updated_at = ?
       WHERE project_id = ? AND id = ?`,
    )
    .bind(n.stage, n.title, n.status, n.progress, n.team, n.goal, n.reportUrl, n.updatedAt, n.projectId, n.id);
}

export function insertEdge(db: D1Database, e: Edge): D1PreparedStatement {
  return db.prepare('INSERT INTO edges (project_id, from_id, to_id) VALUES (?, ?, ?)').bind(e.projectId, e.from, e.to);
}

export function insertBlocker(db: D1Database, b: Blocker): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO blockers (id, project_id, node_id, kind, question, options, access_label, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .bind(b.id, b.projectId, b.nodeId, b.kind, b.question, JSON.stringify(b.options), b.accessLabel, b.createdAt);
}

export function insertMessage(db: D1Database, m: Message): D1PreparedStatement {
  return db
    .prepare('INSERT INTO messages (id, project_id, node_id, from_name, text, report_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(m.id, m.projectId, m.nodeId, m.from, m.text, m.reportUrl, m.createdAt);
}

/** Borra el contenido del grafo (hijos primero, sin depender de las FK). */
export function clearGraph(db: D1Database, pid: string): D1PreparedStatement[] {
  return ['messages', 'blockers', 'edges', 'nodes'].map((t) => db.prepare(`DELETE FROM ${t} WHERE project_id = ?`).bind(pid));
}

type EventSpec = { [K in DagEventType]: { type: K; payload: Extract<DagEvent, { type: K }>['payload'] } }[DagEventType];

const INSERT_EVENT = `INSERT INTO events (project_id, seq, type, actor, at, payload)
  SELECT ?1, COALESCE(MAX(seq), 0) + 1, ?2, ?3, ?4, ?5 FROM events WHERE project_id = ?1
  RETURNING seq`;

/**
 * Ejecuta `writes` y los eventos en un solo batch (transacción): el `seq` se asigna dentro, así
 * que es atómico y monotónico. Después le pasa los eventos al Durable Object del proyecto.
 */
export async function commit(
  env: Env,
  pid: string,
  actor: Role,
  now: string,
  writes: D1PreparedStatement[],
  events: EventSpec[],
): Promise<DagEvent[]> {
  const db = env.DB;
  const touch = db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, pid);
  const evs = events.map((e) => db.prepare(INSERT_EVENT).bind(pid, e.type, actor, now, JSON.stringify(e.payload)));
  const res = await db.batch<{ seq: number }>([...writes, touch, ...evs]);
  const base = writes.length + 1;
  const out = events.map(
    (e, i) => ({ seq: Number(res[base + i]!.results[0]!.seq), projectId: pid, actor, at: now, ...e }) as DagEvent,
  );
  await publish(env, pid, out);
  return out;
}

/** Reparte a los sockets. Si falla, la escritura ya quedó: los clientes se recuperan con `?since=`. */
export async function publish(env: Env, pid: string, events: DagEvent[]): Promise<void> {
  if (!events.length) return;
  try {
    await env.PROJECT_ROOM.get(env.PROJECT_ROOM.idFromName(pid)).broadcast(pid, events);
  } catch (err) {
    console.error(JSON.stringify({ msg: 'broadcast falló', pid, seqs: events.map((e) => e.seq), err: String(err) }));
  }
}
