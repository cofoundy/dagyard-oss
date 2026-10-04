// Fixture sintético para los tests de densidad: la forma de un proyecto importado con `dagyard import` (88 tareas,
// 63/17/6/2 por etapa) con títulos inventados de largo parecido. Solo id, etapa, dependencias, estado y título; los tests
// no dependen de su texto exacto, solo de que sean largos y muchos.
import type { NodeStatus } from '../../data/types';
import type { SceneGraph } from '../contract';
import raw from './basalt-88.json';

interface RawNode {
  id: string;
  stage: string;
  title: string;
  status: string;
  deps: string[];
}

export function basaltGraph(): SceneGraph {
  const stageIndex = new Map(raw.stages.map((s, i) => [s.id, i]));
  const nodes = (raw.nodes as RawNode[]).map((n) => ({
    id: n.id,
    stage: stageIndex.get(n.stage)!,
    title: n.title,
    status: n.status as NodeStatus,
    progress: n.status === 'done' ? 1 : 0,
  }));
  return {
    stages: raw.stages.map((s) => ({ id: s.id, name: s.name })),
    nodes,
    edges: (raw.nodes as RawNode[]).flatMap((n) => n.deps.map((from) => ({ from, to: n.id }))),
  };
}
