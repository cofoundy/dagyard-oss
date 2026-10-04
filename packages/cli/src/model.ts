/**
 * Copia local de los tipos del modelo de Dagyard que usa el CLI.
 * Fuente: el borrador de nucleo (`packages/model/src/types.ts`, aún sin mergear). No se importa
 * para que el CLI siga siendo autosuficiente; si difieren, gana el de nucleo y se re-copia.
 */

export type NodeStatus = 'pending' | 'working' | 'blocked' | 'done';
export const NODE_STATUSES: readonly NodeStatus[] = ['pending', 'working', 'blocked', 'done'];

export type BlockerKind = 'decision' | 'review' | 'access';
export const BLOCKER_KINDS: readonly BlockerKind[] = ['decision', 'review', 'access'];

export type BlockerStatus = 'open' | 'resolved';
export type Role = 'owner' | 'agent';
export type IsoDate = string;

export interface Stage {
  id: string;
  name: string;
}

export interface DagNode {
  id: string;
  projectId: string;
  stage: string;
  title: string;
  status: NodeStatus;
  progress: number;
  team: string | null;
  goal: string | null;
  reportUrl: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Edge {
  projectId: string;
  from: string;
  to: string;
}

export interface BlockerResolution {
  choice: string | null;
  note: string | null;
  hasValue: boolean;
}

export interface Blocker {
  id: string;
  projectId: string;
  nodeId: string;
  kind: BlockerKind;
  question: string;
  options: string[];
  accessLabel: string | null;
  status: BlockerStatus;
  resolution: BlockerResolution | null;
  resolvedBy: Role | null;
  resolvedAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface BlockerWaitResult {
  blocker: Blocker;
  value: string | null;
}

export interface Message {
  id: string;
  projectId: string;
  nodeId: string;
  from: string;
  text: string;
  reportUrl: string | null;
  createdAt: IsoDate;
}

export interface NextResult {
  node: DagNode | null;
  goalLine: string | null;
}

export interface StageInput {
  id?: string;
  name: string;
}

export interface NodeInput {
  id?: string;
  stage: string;
  title: string;
  status?: NodeStatus;
  progress?: number;
  team?: string | null;
  goal?: string | null;
  reportUrl?: string | null;
  deps?: string[];
}

export type NodePatch = Partial<Omit<NodeInput, 'id' | 'deps'>>;

export interface BlockerInput {
  kind: BlockerKind;
  question: string;
  options?: string[];
  accessLabel?: string | null;
}

export interface MessageInput {
  from?: string;
  text: string;
  reportUrl?: string | null;
}

export interface ProjectGraphInput {
  name: string;
  stages?: StageInput[];
  nodes: NodeInput[];
}

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'conflict'
  | 'cycle'
  | 'internal';

export interface ApiError {
  error: { code: ErrorCode; message: string };
}

export const LIMITS = {
  slug: 64,
  title: 120,
  name: 80,
  goal: 500,
  question: 500,
  option: 120,
  options: 6,
  message: 280,
  url: 2048,
  nodesPerProject: 500,
} as const;
