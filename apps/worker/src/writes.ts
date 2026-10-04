/**
 * Las escrituras de Dagyard. Cada una corre ENTERA dentro de una transacción del DO `Store`
 * (`transactionSync`): lee el estado actual, valida contra él, escribe y asigna el `seq` de sus
 * eventos sin soltar el hilo. Así no hay chequeo-y-escritura separados por otra RPC: una carrera no
 * puede resolver dos veces, cerrar un ciclo, duplicar un id ni reescribir un estado desde uno viejo.
 * Un `ApiFailure` lanzado aquí revierte la transacción entera (no queda ni la escritura ni sus eventos).
 */
import {
  DEFAULT_STAGES,
  LIMITS,
  slugify,
  wouldCreateCycle,
  type Blocker,
  type BlockerInput,
  type DagEvent,
  type DagEventType,
  type DagNode,
  type Edge,
  type Message,
  type MessageInput,
  type NodeInput,
  type NodePatch,
  type Project,
  type ProjectGraphInput,
  type Role,
  type Stage,
  type StageInput,
} from '@dagyard/model';
import { randomId } from './crypto.js';
import type { Row } from './db.js';
import { fail, notFound } from './http.js';
import { toBlocker, toEdge, toNode, toProject } from './rows.js';

export type EventSpec = { [K in DagEventType]: { type: K; payload: Extract<DagEvent, { type: K }>['payload'] } }[DagEventType];

/** Lo que el Worker le pide al Store. Todo viene ya validado en forma por `@dagyard/model`. */
export type WriteOp =
  | { kind: 'createProject'; pid: string; name: string; stages?: StageInput[] }
  /** `exclusive` (`If-None-Match: *`): solo crea; si el proyecto ya existe, `409` sin tocarlo */
  | { kind: 'replaceGraph'; pid: string; graph: ProjectGraphInput; actor: Role; exclusive?: boolean }
  | { kind: 'patchProject'; pid: string; name?: string; stages?: StageInput[]; actor: Role }
  | { kind: 'deleteProject'; pid: string }
  | { kind: 'addNode'; pid: string; input: NodeInput; actor: Role }
  | { kind: 'patchNode'; pid: string; nid: string; patch: NodePatch; actor: Role }
  | { kind: 'removeNode'; pid: string; nid: string; actor: Role }
  | { kind: 'addEdge'; pid: string; from: string; to: string; actor: Role }
  | { kind: 'removeEdge'; pid: string; from: string; to: string; actor: Role }
  | { kind: 'openBlocker'; pid: string; nid: string; input: BlockerInput; actor: Role }
  | {
      kind: 'resolveBlocker';
      pid: string;
      bid: string;
      /** el kind contra el que el Worker validó (y cifró): si no coincide, se rechaza */
      expectKind: Blocker['kind'];
      choice: string | null;
      note: string | null;
      /** valor del acceso ya cifrado (AES-GCM, AAD = pid/bid) o null */
      sealed: string | null;
    }
  | { kind: 'postMessage'; pid: string; nid: string; input: MessageInput; actor: Role };

export interface WriteValues {
  createProject: Project;
  replaceGraph: null;
  patchProject: Project;
  deleteProject: null;
  addNode: DagNode;
  patchNode: DagNode;
  removeNode: null;
  addEdge: Edge;
  removeEdge: null;
  openBlocker: Blocker;
  resolveBlocker: Blocker;
  postMessage: Message;
}

export type WriteResult =
  | { ok: true; value: WriteValues[keyof WriteValues]; events: DagEvent[] }
  | { ok: false; error: { code: Parameters<typeof fail>[0]; message: string } };

const RESUME_TEXT = 'Gracias. Sigo desde donde me quedé.';
const signature = (n: Pick<DagNode, 'team'>) => (n.team ? `Equipo de ${n.team}` : 'Agente');
const toStages = (input: StageInput[] | undefined): Stage[] =>
  (input ?? DEFAULT_STAGES).map((s) => ({ id: s.id ?? slugify(s.name), name: s.name }));

type V = string | number | null;

/** SQL sincrónico dentro de la transacción. */
class Tx {
  readonly events: DagEvent[] = [];
  readonly now = new Date().toISOString();
  constructor(private readonly sql: SqlStorage) {}

  all(q: string, ...p: V[]): Row[] {
    return this.sql.exec(q, ...p).toArray() as Row[];
  }
  one(q: string, ...p: V[]): Row | null {
    return this.all(q, ...p)[0] ?? null;
  }

  project(pid: string): Project {
    const r = this.one('SELECT * FROM projects WHERE id = ?', pid);
    return r ? toProject(r) : notFound(`El proyecto «${pid}»`);
  }
  node(pid: string, nid: string): DagNode {
    const r = this.one('SELECT * FROM nodes WHERE project_id = ? AND id = ?', pid, nid);
    return r ? toNode(r) : notFound(`La tarea «${nid}»`);
  }
  nodeIds(pid: string): Set<string> {
    return new Set(this.all('SELECT id FROM nodes WHERE project_id = ?', pid).map((r) => r.id as string));
  }
  edges(pid: string): Edge[] {
    return this.all('SELECT * FROM edges WHERE project_id = ? ORDER BY rowid', pid).map(toEdge);
  }
  openBlockers(pid: string, nid: string): number {
    return Number(this.one("SELECT COUNT(*) AS n FROM blockers WHERE project_id = ? AND node_id = ? AND status = 'open'", pid, nid)!.n);
  }
  /** Bloqueantes de la tarea, abiertos y ya respondidos: lo que un agente no puede hacer desaparecer. */
  heldBlockers(pid: string, nid: string): { open: number; resolved: number } {
    const r = this.one(
      "SELECT COUNT(*) FILTER (WHERE status = 'open') AS open, COUNT(*) FILTER (WHERE status = 'resolved') AS resolved FROM blockers WHERE project_id = ? AND node_id = ?",
      pid, nid,
    )!;
    return { open: Number(r.open), resolved: Number(r.resolved) };
  }

  insertNode(n: DagNode): void {
    this.all(
      `INSERT INTO nodes (project_id, id, stage, title, status, progress, team, goal, report_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      n.projectId, n.id, n.stage, n.title, n.status, n.progress, n.team, n.goal, n.reportUrl, n.createdAt, n.updatedAt,
    );
  }
  insertEdge(e: Edge): void {
    this.all('INSERT INTO edges (project_id, from_id, to_id) VALUES (?, ?, ?)', e.projectId, e.from, e.to);
  }
  insertBlocker(b: Blocker): void {
    this.all(
      `INSERT INTO blockers (id, project_id, node_id, kind, question, options, access_label, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      b.id, b.projectId, b.nodeId, b.kind, b.question, JSON.stringify(b.options), b.accessLabel, b.createdAt,
    );
  }
  /** Reinserta un bloqueante tal cual estaba: id, respuesta y valor cifrado incluidos. */
  restoreBlocker(r: Row): void {
    const cols = ['id', 'project_id', 'node_id', 'kind', 'question', 'options', 'access_label', 'status', 'resolution', 'resolved_by', 'resolved_at', 'access_value', 'created_at'];
    this.all(`INSERT INTO blockers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => r[c] as V));
  }
  /** Reinserta un mensaje tal cual estaba: id, firma y fecha incluidos. */
  restoreMessage(r: Row): void {
    const cols = ['id', 'project_id', 'node_id', 'from_name', 'text', 'report_url', 'created_at'];
    this.all(`INSERT INTO messages (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => r[c] as V));
  }
  insertMessage(m: Message): void {
    this.all(
      'INSERT INTO messages (id, project_id, node_id, from_name, text, report_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      m.id, m.projectId, m.nodeId, m.from, m.text, m.reportUrl, m.createdAt,
    );
  }
  /** Actualiza solo las columnas pedidas y devuelve el nodo tal como quedó. */
  updateNode(pid: string, nid: string, cols: Partial<Record<'stage' | 'title' | 'status' | 'progress' | 'team' | 'goal' | 'report_url', V>>, where = ''): DagNode | null {
    const keys = Object.keys(cols) as Array<keyof typeof cols>;
    const set = [...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', ');
    const r = this.one(
      `UPDATE nodes SET ${set} WHERE project_id = ? AND id = ? ${where} RETURNING *`,
      ...keys.map((k) => cols[k] as V),
      this.now,
      pid,
      nid,
    );
    return r ? toNode(r) : null;
  }
  clearGraph(pid: string): void {
    for (const t of ['messages', 'blockers', 'edges', 'nodes']) this.all(`DELETE FROM ${t} WHERE project_id = ?`, pid);
  }

  emit(pid: string, actor: Role, ...specs: EventSpec[]): void {
    let seq = Number(this.one('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE project_id = ?', pid)!.seq);
    for (const e of specs) {
      seq++;
      this.all('INSERT INTO events (project_id, seq, type, actor, at, payload) VALUES (?, ?, ?, ?, ?, ?)', pid, seq, e.type, actor, this.now, JSON.stringify(e.payload));
      this.events.push({ seq, projectId: pid, actor, at: this.now, ...e } as DagEvent);
    }
    this.all('UPDATE projects SET updated_at = ? WHERE id = ?', this.now, pid);
  }
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

function newBlocker(pid: string, nodeId: string, input: BlockerInput, now: string): Blocker {
  return {
    id: randomId('b_'),
    projectId: pid,
    nodeId,
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
}

const BLOCKED_BY_HAND = 'status: «blocked» lo pone un bloqueante, no se pone a mano';
const pending = (n: number) => (n === 1 ? 'una pregunta abierta' : `${n} preguntas abiertas`);
/** «una pregunta abierta para el dueño y 2 respuestas del dueño»; y el pronombre que la retoma. */
function held({ open, resolved }: { open: number; resolved: number }): { what: string; them: string } {
  const answers = resolved === 1 ? 'una respuesta' : `${resolved} respuestas`;
  const parts = [open ? `${pending(open)} para el dueño` : '', resolved ? `${answers} del dueño` : ''].filter(Boolean);
  return { what: parts.join(' y '), them: open + resolved === 1 ? 'la' : 'las' };
}
/** Clave de un bloqueante para no duplicarlo al re-importar: misma tarea, tipo, pregunta, opciones y etiqueta. */
const blockerKey = (nodeId: unknown, kind: unknown, question: unknown, options: string, accessLabel: unknown) =>
  JSON.stringify([nodeId, kind, question, options, accessLabel ?? null]);
/** Clave de un mensaje para no duplicarlo al re-importar: misma tarea, firma, texto e informe. */
const messageKey = (nodeId: unknown, from: unknown, text: unknown, reportUrl: unknown) => JSON.stringify([nodeId, from, text, reportUrl ?? null]);

const ops: { [K in WriteOp['kind']]: (tx: Tx, op: Extract<WriteOp, { kind: K }>) => WriteValues[K] } = {
  createProject(tx, { pid, name, stages }) {
    if (tx.one('SELECT 1 FROM projects WHERE id = ?', pid)) fail('conflict', `Ya existe un proyecto «${pid}»`);
    const project: Project = { id: pid, name, stages: toStages(stages), createdAt: tx.now, updatedAt: tx.now };
    tx.all('INSERT INTO projects (id, name, stages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', pid, name, JSON.stringify(project.stages), tx.now, tx.now);
    return project;
  },

  replaceGraph(tx, { pid, graph: g, actor, exclusive }) {
    const prevRow = tx.one('SELECT * FROM projects WHERE id = ?', pid);
    if (prevRow && exclusive) fail('conflict', `Ya existe un proyecto «${pid}»; no lo piso`);
    const prev = prevRow ? toProject(prevRow) : null;
    const stages = g.stages ? toStages(g.stages) : (prev?.stages ?? toStages(undefined));
    // el PUT de un agente sobre un proyecto existente conserva lo que no le toca reescribir; el dueño recrea todo
    const keep = prev !== null && actor !== 'owner';
    const nodes = g.nodes.map((n, i) => newNode(pid, n, stages, tx.now, `nodes[${i}].`));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // una tarea que sigue conserva su antigüedad: `next` desempata por `createdAt`
    if (keep)
      for (const r of tx.all('SELECT id, created_at FROM nodes WHERE project_id = ?', pid)) {
        const node = byId.get(r.id as string);
        if (node) node.createdAt = r.created_at as string;
      }
    // resolver es solo del dueño: el PUT de un agente conserva cada bloqueante (abierto o respondido) con su
    // id, su respuesta y su valor, así un `wait` en curso los sigue encontrando. Quitar su tarea → 409.
    const kept = keep ? tx.all('SELECT * FROM blockers WHERE project_id = ? ORDER BY rowid', pid) : [];
    // los mensajes de las tareas que siguen se conservan con su id y su fecha; los de una tarea quitada se van
    const keptMessages = keep
      ? tx.all('SELECT * FROM messages WHERE project_id = ? ORDER BY rowid', pid).filter((m) => byId.has(m.node_id as string))
      : [];
    const orphan = kept.find((b) => !byId.has(b.node_id as string));
    if (orphan) {
      const nid = orphan.node_id as string;
      const h = held(tx.heldBlockers(pid, nid));
      fail('conflict', `La tarea «${tx.node(pid, nid).title}» tiene ${h.what}; quitarla del proyecto ${h.them} haría desaparecer. Déjala en el grafo o pídele al dueño que reemplace el proyecto él`);
    }
    // re-importar el mismo archivo no duplica una pregunta que sigue abierta; una igual a otra ya respondida
    // entra como nueva: re-preguntar nunca se descarta en silencio
    const keptOpen = kept.filter((b) => b.status === 'open');
    const openKeys = new Set(keptOpen.map((b) => blockerKey(b.node_id, b.kind, b.question, b.options as string, b.access_label)));
    const fresh = (g.blockers ?? []).filter(
      (b) => !openKeys.has(blockerKey(b.nodeId, b.kind, b.question, JSON.stringify(b.options ?? []), b.accessLabel)),
    );
    const answeredKeys = new Set(
      kept.filter((b) => b.status === 'resolved').map((b) => blockerKey(b.node_id, b.kind, b.question, b.options as string, b.access_label)),
    );
    const blockedBy = new Set([...(g.blockers ?? []).map((b) => b.nodeId), ...keptOpen.map((b) => b.node_id as string)]);
    nodes.forEach((node, i) => {
      if (node.status === 'blocked' && !blockedBy.has(node.id))
        fail('invalid', `nodes[${i}].status: «blocked» lo pone un bloqueante; agrégalo en blockers`);
      // como en PATCH: una tarea con una pregunta abierta no se cierra (quedaría bloqueada al 100 %)
      if (node.status === 'done' && blockedBy.has(node.id)) {
        const mine = fresh.filter((b) => b.nodeId === node.id);
        const n = keptOpen.filter((b) => b.node_id === node.id).length + mine.length;
        // todo lo que la bloquearía es re-preguntar lo ya respondido: no hay nada que esperar del dueño
        const reasked = mine.every((b) => answeredKeys.has(blockerKey(b.nodeId, b.kind, b.question, JSON.stringify(b.options ?? []), b.accessLabel)));
        if (reasked && mine.length === n)
          fail('conflict', `nodes[${i}].status: el dueño ya respondió ${n === 1 ? 'la pregunta' : 'las preguntas'} de la tarea «${node.title}» que el archivo vuelve a hacer; ${n === 1 ? 'quítala' : 'quítalas'} de blockers o no cierres la tarea`);
        fail('conflict', `nodes[${i}].status: la tarea «${node.title}» tiene ${pending(n)} para el dueño; no puede quedar «done» hasta que ${n === 1 ? 'la responda' : 'las responda'}`);
      }
      // una tarea con un bloqueante abierto está bloqueada, la declare así o no
      if (blockedBy.has(node.id)) node.status = 'blocked';
    });
    const edges: Edge[] = g.nodes.flatMap((n, i) => [...new Set(n.deps ?? [])].map((d) => ({ projectId: pid, from: d, to: nodes[i]!.id })));
    const project: Project = { id: pid, name: g.name, stages, createdAt: prev?.createdAt ?? tx.now, updatedAt: tx.now };
    tx.all(
      `INSERT INTO projects (id, name, stages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, stages = excluded.stages, updated_at = excluded.updated_at`,
      pid, project.name, JSON.stringify(stages), project.createdAt, tx.now,
    );
    tx.clearGraph(pid);
    for (const n of nodes) tx.insertNode(n);
    for (const e of edges) tx.insertEdge(e);
    for (const b of kept) tx.restoreBlocker(b);
    for (const b of fresh) tx.insertBlocker(newBlocker(pid, b.nodeId, b, tx.now));
    // uno del body idéntico a uno conservado no se duplica: re-importar el mismo archivo es idempotente
    const unclaimed = new Map<string, number>();
    for (const m of keptMessages) {
      const k = messageKey(m.node_id, m.from_name, m.text, m.report_url);
      unclaimed.set(k, (unclaimed.get(k) ?? 0) + 1);
    }
    for (const m of keptMessages) tx.restoreMessage(m);
    for (const m of g.messages ?? []) {
      const from = m.from ?? signature(byId.get(m.nodeId)!);
      const k = messageKey(m.nodeId, from, m.text, m.reportUrl);
      const left = unclaimed.get(k) ?? 0;
      if (left > 0) {
        unclaimed.set(k, left - 1);
        continue;
      }
      tx.insertMessage({ id: randomId('m_'), projectId: pid, nodeId: m.nodeId, from, text: m.text, reportUrl: m.reportUrl ?? null, createdAt: tx.now });
    }
    tx.emit(pid, actor, { type: 'project.replaced', payload: { project } });
    return null;
  },

  patchProject(tx, { pid, name, stages: stageInput, actor }) {
    const prev = tx.project(pid);
    const stages = stageInput ? toStages(stageInput) : prev.stages;
    if (stageInput) {
      const ids = new Set(stages.map((s) => s.id));
      const orphan = tx.all('SELECT title, stage FROM nodes WHERE project_id = ?', pid).find((n) => !ids.has(n.stage as string));
      if (orphan) fail('invalid', `stages: la tarea «${orphan.title}» usa la etapa «${orphan.stage}»; muévela antes de quitarla`);
    }
    const project: Project = { ...prev, name: name ?? prev.name, stages, updatedAt: tx.now };
    tx.all('UPDATE projects SET name = ?, stages = ? WHERE id = ?', project.name, JSON.stringify(stages), pid);
    tx.emit(pid, actor, { type: 'project.updated', payload: { project } });
    return project;
  },

  deleteProject(tx, { pid }) {
    tx.project(pid);
    tx.clearGraph(pid);
    tx.all('DELETE FROM events WHERE project_id = ?', pid);
    tx.all('DELETE FROM projects WHERE id = ?', pid);
    return null;
  },

  addNode(tx, { pid, input, actor }) {
    const project = tx.project(pid);
    if (input.status === 'blocked') fail('invalid', BLOCKED_BY_HAND);
    const ids = tx.nodeIds(pid);
    if (ids.size >= LIMITS.nodesPerProject) fail('invalid', `nodes: máximo ${LIMITS.nodesPerProject} por proyecto`);
    const node = newNode(pid, input, project.stages, tx.now);
    if (ids.has(node.id)) fail('conflict', `Ya existe una tarea «${node.id}»`);
    const deps = [...new Set(input.deps ?? [])];
    for (const d of deps) if (!ids.has(d)) fail('invalid', `deps: «${d}» no existe`);
    const edges: Edge[] = deps.map((d) => ({ projectId: pid, from: d, to: node.id }));
    tx.insertNode(node);
    for (const e of edges) tx.insertEdge(e);
    tx.emit(pid, actor, { type: 'node.added', payload: { node } }, ...edges.map((edge) => ({ type: 'edge.added' as const, payload: { edge } })));
    return node;
  },

  patchNode(tx, { pid, nid, patch, actor }) {
    const project = tx.project(pid);
    const prev = tx.node(pid, nid); // leído dentro de la transacción: es el estado vigente
    if (patch.status === 'blocked') fail('invalid', BLOCKED_BY_HAND);
    if (patch.status !== undefined && tx.openBlockers(pid, nid) > 0)
      fail('conflict', 'La tarea tiene un bloqueante abierto: resuélvelo antes de cambiar su estado');
    if (patch.stage !== undefined && !project.stages.some((s) => s.id === patch.stage))
      fail('invalid', `stage: «${patch.stage}» no es una etapa del proyecto`);
    const cols: Parameters<Tx['updateNode']>[2] = {};
    if (patch.stage !== undefined) cols.stage = patch.stage;
    if (patch.title !== undefined) cols.title = patch.title;
    if (patch.status !== undefined) cols.status = patch.status;
    if (patch.progress !== undefined) cols.progress = patch.progress;
    if (patch.team !== undefined) cols.team = patch.team;
    if (patch.goal !== undefined) cols.goal = patch.goal;
    if (patch.reportUrl !== undefined) cols.report_url = patch.reportUrl;
    const status = patch.status ?? prev.status;
    if (status === 'done') cols.progress = 1;
    else if (patch.status === 'working' && prev.status === 'pending') cols.progress = patch.progress ?? 0;
    const node = tx.updateNode(pid, nid, cols)!;
    tx.emit(pid, actor, { type: 'node.updated', payload: { node } });
    return node;
  },

  removeNode(tx, { pid, nid, actor }) {
    const node = tx.node(pid, nid);
    // resolver es solo del dueño: un agente no hace desaparecer ni sus preguntas abiertas ni sus respuestas
    const h = actor !== 'owner' ? tx.heldBlockers(pid, nid) : { open: 0, resolved: 0 };
    if (h.open + h.resolved > 0) {
      const { what, them } = held(h);
      fail('conflict', `La tarea «${node.title}» tiene ${what}; borrarla ${them} haría desaparecer. Pídele al dueño que la borre él`);
    }
    for (const [t, col] of [['messages', 'node_id'], ['blockers', 'node_id'], ['edges', 'from_id'], ['edges', 'to_id'], ['nodes', 'id']] as const)
      tx.all(`DELETE FROM ${t} WHERE project_id = ? AND ${col} = ?`, pid, node.id);
    tx.emit(pid, actor, { type: 'node.removed', payload: { nodeId: node.id } });
    return null;
  },

  addEdge(tx, { pid, from, to, actor }) {
    tx.project(pid);
    const ids = tx.nodeIds(pid);
    for (const id of [from, to]) if (!ids.has(id)) notFound(`La tarea «${id}»`);
    const edges = tx.edges(pid);
    if (edges.some((e) => e.from === from && e.to === to)) fail('conflict', 'Esa dependencia ya existe');
    if (wouldCreateCycle(edges, from, to)) fail('cycle', `«${from}» ya depende de «${to}»: esa dependencia cerraría un ciclo`);
    const edge: Edge = { projectId: pid, from, to };
    tx.insertEdge(edge);
    tx.emit(pid, actor, { type: 'edge.added', payload: { edge } });
    return edge;
  },

  removeEdge(tx, { pid, from, to, actor }) {
    tx.project(pid);
    const gone = tx.one('DELETE FROM edges WHERE project_id = ? AND from_id = ? AND to_id = ? RETURNING from_id', pid, from, to);
    if (!gone) notFound('Esa dependencia');
    const edge: Edge = { projectId: pid, from, to };
    tx.emit(pid, actor, { type: 'edge.removed', payload: { edge } });
    return null;
  },

  openBlocker(tx, { pid, nid, input, actor }) {
    tx.project(pid);
    tx.node(pid, nid);
    const blocker = newBlocker(pid, nid, input, tx.now);
    tx.insertBlocker(blocker);
    // solo la columna de estado: el resto del nodo queda como esté
    const node = tx.updateNode(pid, nid, { status: 'blocked' })!;
    tx.emit(pid, actor, { type: 'blocker.opened', payload: { blocker } }, { type: 'node.updated', payload: { node } });
    return blocker;
  },

  resolveBlocker(tx, { pid, bid, expectKind, choice, note, sealed }) {
    const row = tx.one('SELECT * FROM blockers WHERE project_id = ? AND id = ?', pid, bid);
    if (!row) return notFound(`El bloqueante «${bid}»`);
    const prev = toBlocker(row);
    if (prev.kind !== expectKind) fail('conflict', 'El bloqueante cambió mientras lo resolvías; vuelve a intentarlo');
    const resolution = { choice, note, hasValue: sealed !== null };
    // la condición `status = 'open'` va en el UPDATE: si no tocó ninguna fila, ya estaba resuelto
    const updated = tx.one(
      `UPDATE blockers SET status = 'resolved', resolution = ?, resolved_by = 'owner', resolved_at = ?, access_value = ?
       WHERE project_id = ? AND id = ? AND status = 'open' RETURNING id`,
      JSON.stringify(resolution), tx.now, sealed, pid, bid,
    );
    if (!updated) fail('conflict', 'Ese bloqueante ya está resuelto');
    const blocker: Blocker = { ...prev, status: 'resolved', resolution, resolvedBy: 'owner', resolvedAt: tx.now };
    const unblocked = tx.openBlockers(pid, prev.nodeId) === 0;
    const node = tx.updateNode(pid, prev.nodeId, unblocked ? { status: 'working' } : {})!;
    // el mensaje del sistema solo cuando la tarea de verdad se destraba
    const message: Message | null = unblocked
      ? { id: randomId('m_'), projectId: pid, nodeId: node.id, from: signature(node), text: RESUME_TEXT, reportUrl: null, createdAt: tx.now }
      : null;
    if (message) tx.insertMessage(message);
    tx.emit(
      pid,
      'owner',
      { type: 'blocker.resolved', payload: { blocker } },
      { type: 'node.updated', payload: { node } },
      ...(message ? [{ type: 'message.posted' as const, payload: { message } }] : []),
    );
    return blocker;
  },

  postMessage(tx, { pid, nid, input, actor }) {
    tx.project(pid);
    const node = tx.node(pid, nid);
    const message: Message = {
      id: randomId('m_'),
      projectId: pid,
      nodeId: nid,
      from: input.from ?? signature(node),
      text: input.text,
      reportUrl: input.reportUrl ?? null,
      createdAt: tx.now,
    };
    tx.insertMessage(message);
    // adopta el informe solo si el nodo no tiene uno, sin tocar ninguna otra columna
    const adopted = message.reportUrl ? tx.updateNode(pid, nid, { report_url: message.reportUrl }, 'AND report_url IS NULL') : null;
    tx.emit(pid, actor, { type: 'message.posted', payload: { message } }, ...(adopted ? [{ type: 'node.updated' as const, payload: { node: adopted } }] : []));
    return message;
  },
};

/** Corre una escritura completa sobre el SQL del Store. Lanza `ApiFailure` para revertir. */
export function runWrite(sql: SqlStorage, op: WriteOp): { value: WriteValues[keyof WriteValues]; events: DagEvent[] } {
  const tx = new Tx(sql);
  const value = (ops[op.kind] as (tx: Tx, op: WriteOp) => WriteValues[keyof WriteValues])(tx, op);
  return { value, events: tx.events };
}
