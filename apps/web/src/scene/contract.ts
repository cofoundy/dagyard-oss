// Contrato entre la escena three.js (src/scene/**, carril «escena») y la interfaz React (carril «interfaz»).
// La escena no conoce la API ni React: recibe un grafo, emite picks y anima lo que se le pide.

import type { NodeStatus } from '../data/types';

export interface SceneStage {
  id: string;
  name: string;
}

export interface SceneNode {
  id: string;
  /** Índice de etapa (0..stages.length-1). */
  stage: number;
  title: string;
  status: NodeStatus;
  progress: number;
}

export interface SceneEdge {
  from: string;
  to: string;
}

export interface SceneGraph {
  stages: SceneStage[];
  nodes: SceneNode[];
  edges: SceneEdge[];
}

/** Zonas de la pantalla que tapa el HUD; la vista general encuadra dentro de lo que queda. */
export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type SceneMode = 'intro' | 'overview' | 'stage' | 'focus';

export interface SceneHandlers {
  /** Click o tap sobre un nodo (id) o sobre el vacío (null). */
  onPick: (id: string | null) => void;
  /** Cambio de modo hecho por la escena (p. ej. Escape o fin del intro). */
  onModeChange?: (mode: SceneMode) => void;
}

export type Pulse = 'done' | 'working' | 'blocked' | 'born';

export interface Sky {
  /**
   * Reconciliación declarativa: nodos nuevos nacen (animación de nacimiento), los que faltan se apagan,
   * las aristas nuevas se dibujan y los cambios de estado transicionan de color. Idempotente.
   */
  setGraph(graph: SceneGraph): void;
  /** Onda de choque sobre un nodo (eventos del servidor). */
  pulse(nodeId: string, kind: Pulse): void;
  overview(): void;
  flyStage(stage: number): void;
  focus(nodeId: string): void;
  setSafeArea(area: SafeArea): void;
  dispose(): void;
}

export interface CreateSkyOptions {
  canvas: HTMLCanvasElement;
  /** Capa DOM para las etiquetas de nodos y etapas (position:absolute, inset:0, pointer-events:none). */
  labels: HTMLElement;
  handlers: SceneHandlers;
  safeArea: SafeArea;
}

/** Implementación en src/scene/index.ts: `export function createSky(opts: CreateSkyOptions): Sky`. */
export type CreateSky = (opts: CreateSkyOptions) => Sky;
