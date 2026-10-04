// Único punto de traducción entre el cable del servidor (`@dagyard/model`, docs/api.md de nucleo) y el
// modelo de la UI (`./types`). Los tipos del cable vienen del paquete, no de copias: si el servidor cambia
// su contrato, el typecheck de la web se rompe aquí. La UI y la escena siguen consumiendo `./types`.

import type {
  Blocker as WireBlocker,
  DagEvent as WireEvent,
  DagNode as WireNode,
  Edge as WireEdge,
  Message as WireMessage,
  ProjectSnapshot as WireSnapshot,
  ProjectSummary as WireProjectSummary,
  ResolveInput as WireResolveInput,
  ServerFrame as WireServerFrame,
  Stage as WireStage,
} from '@dagyard/model';
import type { Blocker, DagEvent, DagNode, Edge, Message, ProjectSummary, Resolution, Snapshot, Stage } from './types';

export type {
  WireBlocker,
  WireEdge,
  WireEvent,
  WireMessage,
  WireNode,
  WireProjectSummary,
  WireResolveInput,
  WireServerFrame,
  WireSnapshot,
  WireStage,
};

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
    link: opt(n.link),
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
