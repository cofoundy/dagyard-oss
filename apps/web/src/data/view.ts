// Selectores puros sobre el snapshot: lo que la escena y la interfaz leen.

import type { SceneGraph } from '../scene/contract';
import type { Blocker, DagNode, Message, Snapshot, Stage } from './types';

export function stageIndex(s: Snapshot): Map<string, number> {
  return new Map(s.stages.map((st, i) => [st.id, i]));
}

export function toSceneGraph(s: Snapshot): SceneGraph {
  const idx = stageIndex(s);
  const ids = new Set(s.nodes.map((n) => n.id));
  return {
    stages: s.stages.map((st) => ({ id: st.id, name: st.name })),
    nodes: s.nodes.map((n) => ({
      id: n.id,
      stage: idx.get(n.stageId) ?? 0,
      title: n.title,
      status: n.status,
      progress: n.progress,
    })),
    edges: s.edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ from: e.from, to: e.to })),
  };
}

export const EMPTY_GRAPH: SceneGraph = { stages: [], nodes: [], edges: [] };

export interface StageStat {
  index: number;
  stage: Stage;
  total: number;
  done: number;
  /** blocked = algo te espera; active = hay trabajo en curso */
  state: 'blocked' | 'active' | 'idle';
}

export function stageStats(s: Snapshot): StageStat[] {
  const idx = stageIndex(s);
  const stats = s.stages.map<StageStat>((stage, index) => ({ index, stage, total: 0, done: 0, state: 'idle' }));
  for (const n of s.nodes) {
    const st = stats[idx.get(n.stageId) ?? 0];
    if (!st) continue;
    st.total++;
    if (n.status === 'done') st.done++;
    if (n.status === 'blocked') st.state = 'blocked';
    else if (n.status === 'working' && st.state !== 'blocked') st.state = 'active';
  }
  return stats;
}

export function isOpen(b: Blocker): boolean {
  return !b.resolvedAt;
}

/** Pedidos abiertos de tareas que existen, en el orden del plan (etapa, luego aparición). */
export function openBlockers(s: Snapshot): Blocker[] {
  const idx = stageIndex(s);
  const order = new Map(s.nodes.map((n, i) => [n.id, (idx.get(n.stageId) ?? 0) * 10_000 + i]));
  return s.blockers.filter((b) => isOpen(b) && order.has(b.nodeId)).sort((a, b) => order.get(a.nodeId)! - order.get(b.nodeId)!);
}

export function openBlockerOf(s: Snapshot, nodeId: string): Blocker | undefined {
  return s.blockers.find((b) => b.nodeId === nodeId && isOpen(b));
}

export function resolvedBlockersOf(s: Snapshot, nodeId: string): Blocker[] {
  return s.blockers
    .filter((b) => b.nodeId === nodeId && !isOpen(b))
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
}

/** Mensajes de una tarea, del más nuevo al más viejo. */
export function messagesOf(s: Snapshot, nodeId: string): Message[] {
  return s.messages.filter((m) => m.nodeId === nodeId).reverse();
}

export function nodeById(s: Snapshot, id: string | null | undefined): DagNode | undefined {
  return id ? s.nodes.find((n) => n.id === id) : undefined;
}

export function depsOf(s: Snapshot, nodeId: string): DagNode[] {
  const ids = s.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  return s.nodes.filter((n) => ids.includes(n.id));
}

export function dependentsOf(s: Snapshot, nodeId: string): DagNode[] {
  const ids = s.edges.filter((e) => e.from === nodeId).map((e) => e.to);
  return s.nodes.filter((n) => ids.includes(n.id));
}

/** Etapas con trabajo en curso o esperándote: «ahora en …». */
export function liveStages(s: Snapshot): StageStat[] {
  return stageStats(s).filter((st) => st.state !== 'idle');
}

export function doneCount(s: Snapshot): number {
  return s.nodes.filter((n) => n.status === 'done').length;
}
