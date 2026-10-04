import { describe, expect, it } from 'vitest';
import { toNotification } from '../src/notify.js';
import { blocker, PID, resolved } from './fixtures.js';

const ctx = { projectId: PID, nodes: null };

describe('toNotification', () => {
  it('decision resuelta por el dueño → pregunta, elección, nota y qué hacer', () => {
    const n = toNotification(resolved(7), { ...ctx, titleOf: () => 'Cobros en la app' });
    expect(n).not.toBeNull();
    expect(n!.meta).toEqual({ project: PID, node: 'pagos', blocker: 'b_123', kind: 'decision' });
    for (const k of Object.keys(n!.meta)) expect(k).toMatch(/^[A-Za-z0-9_]+$/);
    expect(n!.content).toContain('«Cobros en la app» (nodo pagos)');
    expect(n!.content).toContain('Pregunta: ¿Cobramos con tarjeta o con Yape?');
    expect(n!.content).toContain('Elección: Yape');
    expect(n!.content).toContain('Nota del dueño: Empieza por Lima');
    expect(n!.content).toContain('Sigue ahora con el nodo pagos');
    expect(n!.content).toContain('tool reply');
  });

  it('review sin nota: no inventa la nota', () => {
    const b = blocker({ kind: 'review', resolution: { choice: 'Aprobar', note: null, hasValue: false } });
    const n = toNotification(resolved(8, b), ctx)!;
    expect(n.content).toContain('revisó');
    expect(n.content).toContain('Elección: Aprobar');
    expect(n.content).not.toContain('Nota');
    expect(n.meta.kind).toBe('review');
  });

  it('access: el valor nunca va; indica correr dagyard wait', () => {
    const b = blocker({
      kind: 'access',
      options: [],
      accessLabel: 'Clave de la pasarela de pagos',
      resolution: { choice: null, note: null, hasValue: true },
    });
    // aunque un evento malformado trajera un valor, no debe aparecer
    (b as unknown as Record<string, unknown>).value = 'sk_live_SECRETO';
    const n = toNotification(resolved(9, b), ctx)!;
    expect(n.content).toContain('Clave de la pasarela de pagos');
    expect(n.content).toContain(`dagyard wait pagos --blocker b_123 --project ${PID}`);
    expect(n.content).not.toContain('sk_live_SECRETO');
    expect(JSON.stringify(n.meta)).not.toContain('sk_live_SECRETO');
    expect(n.meta.kind).toBe('access');
  });

  it('ignora lo que no es blocker.resolved del dueño', () => {
    expect(toNotification(resolved(10, blocker(), 'agent'), ctx)).toBeNull();
    expect(toNotification({ ...resolved(11), type: 'blocker.opened' } as never, ctx)).toBeNull();
    expect(
      toNotification({ seq: 12, projectId: PID, type: 'node.removed', actor: 'owner', at: '', payload: { nodeId: 'pagos' } }, ctx),
    ).toBeNull();
    expect(toNotification(resolved(13, blocker({ status: 'open', resolution: null, resolvedBy: null })), ctx)).toBeNull();
  });

  it('ignora otros proyectos', () => {
    expect(toNotification(resolved(14), { projectId: 'otro', nodes: null })).toBeNull();
  });

  it('filtra por DAGYARD_NODES', () => {
    expect(toNotification(resolved(15), { projectId: PID, nodes: new Set(['login']) })).toBeNull();
    expect(toNotification(resolved(16), { projectId: PID, nodes: new Set(['login', 'pagos']) })).not.toBeNull();
  });
});
