import { describe, expect, it } from 'vitest';
import { marketplaceSnapshot } from './fixture';
import { reduce, reduceAll, upsertBlocker, MAX_MESSAGES } from './reduce';
import type { DagEvent, Snapshot } from './types';

const base = (): Snapshot => ({ ...marketplaceSnapshot(0), seq: 10 });
const node = (s: Snapshot, id: string) => s.nodes.find((n) => n.id === id);

describe('reduce', () => {
  it('node.added agrega el nodo', () => {
    const s = base();
    const n = reduce(s, { seq: 11, type: 'node.added', node: { id: 'recuperar-contrasena', stageId: 'construccion', title: 'Recuperar contraseña', status: 'pending', progress: 0 } });
    expect(n.nodes).toHaveLength(s.nodes.length + 1);
    expect(node(n, 'recuperar-contrasena')?.title).toBe('Recuperar contraseña');
    expect(n.seq).toBe(11);
  });

  it('node.updated completo reemplaza (un campo ausente se borró)', () => {
    const s = base();
    const before = node(s, 'entrevistas-a-usuarios')!;
    expect(before.reportUrl).toBeDefined();
    const { reportUrl: _drop, ...rest } = before;
    const n = reduce(s, { seq: 11, type: 'node.updated', node: { ...rest, status: 'working', progress: 0.2 } });
    expect(node(n, 'entrevistas-a-usuarios')).toMatchObject({ status: 'working', progress: 0.2 });
    expect(node(n, 'entrevistas-a-usuarios')?.reportUrl).toBeUndefined();
  });

  it('node.updated parcial mezcla sobre lo que había', () => {
    const s = base();
    const n = reduce(s, { seq: 11, type: 'node.updated', node: { id: 'buscador-con-filtros', progress: 0.9 } });
    expect(node(n, 'buscador-con-filtros')).toMatchObject({ progress: 0.9, status: 'working', title: 'Buscador con filtros' });
  });

  it('node.updated parcial de un nodo desconocido no inventa un nodo', () => {
    const s = base();
    const n = reduce(s, { seq: 11, type: 'node.updated', node: { id: 'fantasma', progress: 1 } });
    expect(n.nodes).toHaveLength(s.nodes.length);
    expect(n.seq).toBe(11);
  });

  it('node.removed borra el nodo con sus aristas, pedidos y mensajes', () => {
    const s = base();
    const id = 'modelo-de-comisiones';
    expect(s.edges.some((e) => e.from === id || e.to === id)).toBe(true);
    const n = reduce(s, { seq: 11, type: 'node.removed', nodeId: id });
    expect(node(n, id)).toBeUndefined();
    expect(n.edges.some((e) => e.from === id || e.to === id)).toBe(false);
    expect(n.blockers.some((b) => b.nodeId === id)).toBe(false);
    expect(n.messages.some((m) => m.nodeId === id)).toBe(false);
  });

  it('edge.added agrega sin duplicar; edge.removed quita', () => {
    const s = base();
    const edge = { from: 'registro-e-inicio-de-sesion', to: 'pagina-de-lanzamiento' };
    const a = reduce(s, { seq: 11, type: 'edge.added', edge });
    expect(a.edges).toHaveLength(s.edges.length + 1);
    const dup = reduce(a, { seq: 12, type: 'edge.added', edge });
    expect(dup.edges).toHaveLength(a.edges.length);
    const r = reduce(dup, { seq: 13, type: 'edge.removed', edge });
    expect(r.edges).toHaveLength(s.edges.length);
  });

  it('blocker.opened agrega y blocker.resolved reemplaza por id', () => {
    const s = base();
    const blocker = { id: 'b_nuevo', nodeId: 'avisos-por-whatsapp', kind: 'review' as const, question: '¿Va así?', options: ['Aprobar', 'Pedir cambios'] };
    const o = reduce(s, { seq: 11, type: 'blocker.opened', blocker });
    expect(o.blockers.find((b) => b.id === 'b_nuevo')?.resolvedAt).toBeUndefined();
    const r = reduce(o, { seq: 12, type: 'blocker.resolved', blocker: { ...blocker, resolution: 'Aprobado', resolvedBy: 'Tú', resolvedAt: '2026-10-04T06:00:00.000Z' } });
    expect(r.blockers.filter((b) => b.id === 'b_nuevo')).toHaveLength(1);
    expect(r.blockers.find((b) => b.id === 'b_nuevo')?.resolution).toBe('Aprobado');
  });

  it('message.posted agrega sin duplicar y respeta el tope', () => {
    const s = base();
    const message = { id: 'm_x', nodeId: 'pagos-con-tarjeta', from: 'Equipo de Construcción', text: 'Hola', at: '2026-10-04T06:00:00.000Z' };
    const a = reduce(s, { seq: 11, type: 'message.posted', message });
    expect(a.messages.at(-1)?.id).toBe('m_x');
    expect(reduce(a, { seq: 12, type: 'message.posted', message }).messages).toHaveLength(a.messages.length);
    const many: DagEvent[] = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => ({ seq: 20 + i, type: 'message.posted', message: { ...message, id: `m_${i}` } }));
    expect(reduceAll(s, many).messages).toHaveLength(MAX_MESSAGES);
  });

  it('es idempotente: ignora eventos con seq viejo y no muta la entrada', () => {
    const s = base();
    const frozen = JSON.stringify(s);
    const same = reduce(s, { seq: 10, type: 'node.removed', nodeId: 'pagos-con-tarjeta' });
    expect(same).toBe(s);
    reduce(s, { seq: 11, type: 'node.removed', nodeId: 'pagos-con-tarjeta' });
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('upsertBlocker aplica la respuesta directa sin mover el seq', () => {
    const s = base();
    const b = { ...s.blockers[0]!, resolution: '«Al proveedor (10 % por reserva)»', resolvedAt: '2026-10-04T06:00:00.000Z' };
    const n = upsertBlocker(s, b);
    expect(n.seq).toBe(s.seq);
    expect(n.blockers[0]?.resolvedAt).toBeDefined();
  });
});
