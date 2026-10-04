/** Lecturas de Dagyard sobre el Db (DO `Store`) y el puente de escrituras (writes.ts) con el tiempo real. */
import { MESSAGES_IN_SNAPSHOT, type DagEvent, type DagNode, type Edge, type Project, type ProjectSnapshot } from '@dagyard/model';
import type { Db, Row } from './db.js';
import type { Env } from './env.js';
import { ApiFailure, notFound } from './http.js';
import { BLOCKER_COLS, toBlocker, toEdge, toEvent, toMessage, toNode, toProject } from './rows.js';
import type { WriteOp, WriteValues } from './writes.js';

/* ------------------------------------------------------------------ lecturas */

export async function getProject(db: Db, pid: string): Promise<Project | null> {
  const r = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(pid).first<Row>();
  return r ? toProject(r) : null;
}

export async function requireProject(db: Db, pid: string): Promise<Project> {
  return (await getProject(db, pid)) ?? notFound(`El proyecto «${pid}»`);
}

export async function getBlockerRow(db: Db, pid: string, bid: string): Promise<Row | null> {
  return db.prepare('SELECT * FROM blockers WHERE project_id = ? AND id = ?').bind(pid, bid).first<Row>();
}

const nodesQ = (db: Db, pid: string) =>
  db.prepare('SELECT * FROM nodes WHERE project_id = ? ORDER BY created_at, rowid').bind(pid);
const edgesQ = (db: Db, pid: string) =>
  db.prepare('SELECT * FROM edges WHERE project_id = ? ORDER BY rowid').bind(pid);

/** Proyecto, nodos y aristas en una lectura consistente. */
export async function loadGraph(db: Db, pid: string): Promise<{ project: Project; nodes: DagNode[]; edges: Edge[] }> {
  const [p, n, e] = await db.batch<Row>([db.prepare('SELECT * FROM projects WHERE id = ?').bind(pid), nodesQ(db, pid), edgesQ(db, pid)]);
  const row = p!.results[0];
  if (!row) return notFound(`El proyecto «${pid}»`);
  return { project: toProject(row), nodes: n!.results.map(toNode), edges: e!.results.map(toEdge) };
}

export async function snapshot(db: Db, pid: string): Promise<ProjectSnapshot> {
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

export async function currentSeq(db: Db, pid: string): Promise<number> {
  const r = await db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE project_id = ?').bind(pid).first<{ seq: number }>();
  return Number(r?.seq ?? 0);
}

export async function eventsSince(db: Db, pid: string, since: number, limit: number): Promise<DagEvent[]> {
  const { results } = await db
    .prepare('SELECT * FROM events WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?')
    .bind(pid, since, limit)
    .all<Row>();
  return results.map(toEvent);
}

/* ------------------------------------------------------------------ escrituras */

/**
 * Corre una escritura en el Store (una transacción: ver writes.ts) y reparte sus eventos al
 * Durable Object del proyecto. Un error de dominio llega como dato y se relanza como ApiFailure.
 */
export async function write<K extends WriteOp['kind']>(env: Env, op: Extract<WriteOp, { kind: K }>): Promise<WriteValues[K]> {
  const res = await env.STORE.get(env.STORE.idFromName('db')).write(op);
  if (!res.ok) throw new ApiFailure(res.error.code, res.error.message);
  await publish(env, op.pid, res.events as DagEvent[]);
  return res.value as WriteValues[K];
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
