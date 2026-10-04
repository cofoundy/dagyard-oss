// Único punto de traducción entre el cable del servidor (docs/api.md de nucleo, `@dagyard/model`) y el
// modelo de la UI (`./types`). Cuando `@dagyard/model` entre al workspace, los tipos `Wire*` de abajo se
// reemplazan por `import type { … } from '@dagyard/model'` y nada más cambia: la UI y la escena siguen
// consumiendo `./types`.

import type { Blocker, DagEvent, DagNode, Edge, Message, ProjectSummary, Resolution, Snapshot, Stage } from './types';

/* ------------------------------------------------------------------ cable (espejo de @dagyard/model) */

type WireStatus = DagNode['status'];
type WireRole = 'owner' | 'agent';

export interface WireStage {
  id: string;
  name: string;
}

export interface WireProject {
  id: string;
  name: string;
  stages: WireStage[];
  createdAt?: string;
  updatedAt?: string;
}

export interface WireNode {
  id: string;
  projectId?: string;
  stage: string;
  title: string;
  status: WireStatus;
  progress: number;
  team: string | null;
  goal: string | null;
  reportUrl: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface WireEdge {
  projectId?: string;
  from: string;
  to: string;
}

export interface WireBlocker {
  id: string;
  projectId?: string;
  nodeId: string;
  kind: Blocker['kind'];
  question: string;
  options: string[];
  accessLabel: string | null;
  status: 'open' | 'resolved';
  resolution: { choice: string | null; note: string | null; hasValue: boolean } | null;
  resolvedBy: WireRole | null;
  resolvedAt: string | null;
  createdAt?: string;
}

export interface WireMessage {
  id: string;
  projectId?: string;
  nodeId: string;
  from: string;
  text: string;
  reportUrl: string | null;
  createdAt: string;
}

export interface WireSnapshot {
  project: WireProject;
  nodes: WireNode[];
  edges: WireEdge[];
  blockers: WireBlocker[];
  messages: WireMessage[];
  seq: number;
}

export interface WireProjectSummary {
  id: string;
  name: string;
  stages?: WireStage[];
  openBlockers?: number;
}

interface WireEventBase<T extends string, P> {
  seq: number;
  projectId: string;
  type: T;
  actor?: WireRole;
  at?: string;
  payload: P;
}

export type WireEvent =
  | WireEventBase<'project.replaced', { project: WireProject }>
  | WireEventBase<'project.updated', { project: WireProject }>
  | WireEventBase<'node.added', { node: WireNode }>
  | WireEventBase<'node.updated', { node: WireNode }>
  | WireEventBase<'node.removed', { nodeId: string }>
  | WireEventBase<'edge.added', { edge: WireEdge }>
  | WireEventBase<'edge.removed', { edge: WireEdge }>
  | WireEventBase<'blocker.opened', { blocker: WireBlocker }>
  | WireEventBase<'blocker.resolved', { blocker: WireBlocker }>
  | WireEventBase<'message.posted', { message: WireMessage }>;

export type WireServerFrame =
  | { type: 'hello'; projectId: string; seq: number }
  | { type: 'event'; event: WireEvent }
  | { type: 'resync'; seq: number }
  | { type: 'pong' };

export interface WireResolveInput {
  choice?: number | string;
  value?: string;
  note?: string | null;
}

/* ------------------------------------------------------------------ cable → UI */

const opt = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);

export function toStage(s: WireStage): Stage {
  return { id: s.id, name: s.name };
}

export function toNode(n: WireNode): DagNode {
  return {
    id: n.id,
    stageId: n.stage,
    title: n.title,
    status: n.status,
    progress: clamp01(n.progress),
    team: opt(n.team),
    goal: opt(n.goal),
    reportUrl: opt(n.reportUrl),
  };
}

export function toEdge(e: WireEdge): Edge {
  return { from: e.from, to: e.to };
}

/** Resumen legible de una resolución. Nunca incluye el valor de un acceso. */
export function resolutionSummary(b: Pick<WireBlocker, 'kind' | 'options' | 'resolution'>): string {
  const r = b.resolution;
  if (!r) return '';
  if (b.kind === 'access') return 'Acceso entregado';
  if (b.kind === 'review') {
    const approved = r.choice !== null && r.choice === (b.options[0] ?? 'Aprobar');
    if (approved) return r.note ? `Aprobado · ${r.note}` : 'Aprobado';
    return r.note ? `Pediste cambios: ${r.note}` : 'Pediste cambios';
  }
  return r.choice ? `«${r.choice}»${r.note ? ` · ${r.note}` : ''}` : 'Decidido';
}

export function toBlocker(b: WireBlocker): Blocker {
  const resolved = b.status === 'resolved';
  return {
    id: b.id,
    nodeId: b.nodeId,
    kind: b.kind,
    question: b.question,
    options: b.kind === 'access' ? [] : b.options.length ? b.options : b.kind === 'review' ? ['Aprobar', 'Pedir cambios'] : [],
    label: b.kind === 'access' ? opt(b.accessLabel) : undefined,
    resolution: resolved ? resolutionSummary(b) : undefined,
    resolvedBy: resolved ? (b.resolvedBy === 'agent' ? 'Un agente' : 'Tú') : undefined,
    resolvedAt: resolved ? opt(b.resolvedAt) ?? new Date(0).toISOString() : undefined,
  };
}

export function toMessage(m: WireMessage): Message {
  return { id: m.id, nodeId: m.nodeId, from: m.from, text: m.text, reportUrl: opt(m.reportUrl), at: m.createdAt };
}

export function toSnapshot(w: WireSnapshot): Snapshot {
  return {
    project: { id: w.project.id, name: w.project.name },
    stages: w.project.stages.map(toStage),
    nodes: w.nodes.map(toNode),
    edges: w.edges.map(toEdge),
    blockers: w.blockers.map(toBlocker),
    messages: w.messages.map(toMessage),
    seq: w.seq,
  };
}

export function toProjectSummary(p: WireProjectSummary): ProjectSummary {
  return { id: p.id, name: p.name };
}

/**
 * Traduce un evento del cable. `null` = el evento no existe en el modelo de la UI y obliga a recargar el
 * snapshot (`project.replaced`, `project.updated`: cambian etapas o nombre).
 */
export function toEvent(e: WireEvent): DagEvent | null {
  switch (e.type) {
    case 'node.added':
      return { seq: e.seq, type: 'node.added', node: toNode(e.payload.node) };
    case 'node.updated':
      return { seq: e.seq, type: 'node.updated', node: toNode(e.payload.node) };
    case 'node.removed':
      return { seq: e.seq, type: 'node.removed', nodeId: e.payload.nodeId };
    case 'edge.added':
      return { seq: e.seq, type: 'edge.added', edge: toEdge(e.payload.edge) };
    case 'edge.removed':
      return { seq: e.seq, type: 'edge.removed', edge: toEdge(e.payload.edge) };
    case 'blocker.opened':
      return { seq: e.seq, type: 'blocker.opened', blocker: toBlocker(e.payload.blocker) };
    case 'blocker.resolved':
      return { seq: e.seq, type: 'blocker.resolved', blocker: toBlocker(e.payload.blocker) };
    case 'message.posted':
      return { seq: e.seq, type: 'message.posted', message: toMessage(e.payload.message) };
    case 'project.replaced':
    case 'project.updated':
      return null;
  }
}

/* ------------------------------------------------------------------ UI → cable */

export function toResolveInput(r: Resolution): WireResolveInput {
  switch (r.kind) {
    case 'decision':
      return { choice: r.option };
    case 'review':
      // Las opciones de una revisión son [Aprobar, Pedir cambios] por defecto: se manda el índice.
      return { choice: r.verdict === 'approve' ? 0 : 1, note: r.comment?.trim() ? r.comment.trim() : null };
    case 'access':
      return { value: r.value };
  }
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}
