import type { Blocker, DagEvent, ProjectSnapshot } from '@dagyard/model';

export const PID = 'marketplace-reservas';

export function blocker(over: Partial<Blocker> = {}): Blocker {
  return {
    id: 'b_123',
    projectId: PID,
    nodeId: 'pagos',
    kind: 'decision',
    question: '¿Cobramos con tarjeta o con Yape?',
    options: ['Tarjeta', 'Yape'],
    accessLabel: null,
    status: 'resolved',
    resolution: { choice: 'Yape', note: 'Empieza por Lima', hasValue: false },
    resolvedBy: 'owner',
    resolvedAt: '2026-10-04T06:00:00.000Z',
    createdAt: '2026-10-04T05:00:00.000Z',
    ...over,
  };
}

export function resolved(seq: number, b: Blocker = blocker(), actor: 'owner' | 'agent' = 'owner'): DagEvent {
  return { seq, projectId: PID, type: 'blocker.resolved', actor, at: '2026-10-04T06:00:00.000Z', payload: { blocker: b } };
}

export function snapshot(seq: number, nodes: Array<{ id: string; title: string }> = []): ProjectSnapshot {
  return {
    project: { id: PID, name: 'Marketplace' } as unknown as ProjectSnapshot['project'],
    nodes: nodes as unknown as ProjectSnapshot['nodes'],
    edges: [],
    blockers: [],
    messages: [],
    seq,
  };
}
