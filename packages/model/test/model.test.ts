import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  countNodes,
  demoProject,
  findCycle,
  goalLine,
  nextStartable,
  parseBlockerInput,
  parseMessageInput,
  parseNodeInput,
  parseNodePatch,
  parseProjectGraphInput,
  parseResolveInput,
  slugify,
  wouldCreateCycle,
  DEFAULT_STAGES,
  type DagNode,
  type ProjectSnapshot,
} from '../src/index.js';

const at = '2026-10-04T05:00:00.000Z';
const node = (id: string, status: DagNode['status'], stage = 'construccion', createdAt = at): DagNode => ({
  id,
  projectId: 'p',
  stage,
  title: id,
  status,
  progress: 0,
  team: null,
  goal: null,
  reportUrl: null, link: null,
  createdAt,
  updatedAt: createdAt,
});

describe('demo', () => {
  it('trae 20 nodos, 5 etapas y 3 bloqueantes (uno de cada tipo) y es un grafo válido', () => {
    const d = demoProject();
    expect(d.nodes).toHaveLength(20);
    expect(d.stages).toHaveLength(5);
    expect(d.blockers!.map((b) => b.kind).sort()).toEqual(['access', 'decision', 'review']);
    expect(parseProjectGraphInput(d).ok).toBe(true);
    for (const b of d.blockers!) expect(d.nodes.find((n) => n.id === b.nodeId)!.status).toBe('blocked');
  });
  it('devuelve una copia nueva cada vez', () => {
    const a = demoProject();
    a.nodes[0]!.title = 'x';
    expect(demoProject().nodes[0]!.title).not.toBe('x');
  });
});

describe('validación', () => {
  it('slugify quita tildes y espacios', () => {
    expect(slugify('Diseño del pago')).toBe('diseno-del-pago');
    expect(slugify('¡¿?!')).toBe('x');
  });
  it('rechaza un mensaje de más de 280 caracteres y acepta uno de 280', () => {
    expect(parseMessageInput({ text: 'a'.repeat(281) }).ok).toBe(false);
    expect(parseMessageInput({ text: 'a'.repeat(280) }).ok).toBe(true);
  });
  it('valida nodos: etapa en slug, progreso 0..1, estado conocido', () => {
    expect(parseNodeInput({ stage: 'diseno', title: 'Algo' }).ok).toBe(true);
    expect(parseNodeInput({ stage: 'Diseño', title: 'Algo' }).ok).toBe(false);
    expect(parseNodeInput({ stage: 'diseno', title: 'Algo', progress: 2 }).ok).toBe(false);
    expect(parseNodeInput({ stage: 'diseno', title: 'Algo', status: 'queued' }).ok).toBe(false);
    expect(parseNodePatch({}).ok).toBe(false);
    expect(parseNodePatch({ id: 'x' }).ok).toBe(false);
    expect(parseNodePatch({ status: 'done', progress: 1 })).toEqual({ ok: true, value: { status: 'done', progress: 1 } });
  });
  it('bloqueantes: la revisión trae opciones por defecto; el acceso exige su nombre y no lleva opciones', () => {
    const rv = parseBlockerInput({ kind: 'review', question: '¿Lo revisas?' });
    expect(rv.ok && rv.value.options).toEqual(['Aprobar', 'Pedir cambios']);
    expect(parseBlockerInput({ kind: 'decision', question: '¿A o B?' }).ok).toBe(false);
    expect(parseBlockerInput({ kind: 'access', question: 'Necesito la clave' }).ok).toBe(false);
    expect(parseBlockerInput({ kind: 'access', question: 'Necesito la clave', accessLabel: 'Clave', options: ['a'] }).ok).toBe(false);
    expect(parseBlockerInput({ kind: 'access', question: 'Necesito la clave', accessLabel: 'Clave' }).ok).toBe(true);
    expect(parseBlockerInput({ kind: 'secret', question: 'x' }).ok).toBe(false);
  });
  it('resuelve los 3 tipos: decisión por índice, revisión por texto, acceso con valor', () => {
    const dec = { kind: 'decision' as const, options: ['Al proveedor', 'Al cliente'] };
    expect(parseResolveInput({ choice: 1 }, dec)).toEqual({ ok: true, value: { choice: 'Al cliente', value: null, note: null } });
    expect(parseResolveInput({ choice: 5 }, dec).ok).toBe(false);
    const rev = { kind: 'review' as const, options: ['Aprobar', 'Pedir cambios'] };
    expect(parseResolveInput({ choice: 'Pedir cambios', note: 'más grande el botón' }, rev)).toEqual({
      ok: true,
      value: { choice: 'Pedir cambios', value: null, note: 'más grande el botón' },
    });
    expect(parseResolveInput({ choice: 'Otra' }, rev).ok).toBe(false);
    const acc = { kind: 'access' as const, options: [] };
    expect(parseResolveInput({ value: 'sk_test_123' }, acc)).toEqual({
      ok: true,
      value: { choice: null, value: 'sk_test_123', note: null },
    });
    expect(parseResolveInput({ value: '  ' }, acc).ok).toBe(false);
  });
  it('el grafo completo rechaza deps inexistentes, etapas ajenas, ids repetidos y ciclos', () => {
    const base = { name: 'P', stages: [{ id: 'a', name: 'A' }] };
    expect(parseProjectGraphInput({ ...base, nodes: [{ id: 'x', stage: 'a', title: 'X', deps: ['y'] }] }).ok).toBe(false);
    expect(parseProjectGraphInput({ ...base, nodes: [{ id: 'x', stage: 'b', title: 'X' }] }).ok).toBe(false);
    expect(
      parseProjectGraphInput({ ...base, nodes: [{ id: 'x', stage: 'a', title: 'X' }, { id: 'x', stage: 'a', title: 'Y' }] }).ok,
    ).toBe(false);
    const cyc = parseProjectGraphInput({
      ...base,
      nodes: [
        { id: 'x', stage: 'a', title: 'X', deps: ['y'] },
        { id: 'y', stage: 'a', title: 'Y', deps: ['x'] },
      ],
    });
    expect(cyc.ok).toBe(false);
    expect(!cyc.ok && cyc.message).toMatch(/ciclo/);
  });
});

describe('grafo', () => {
  it('detecta ciclos', () => {
    expect(findCycle(['a', 'b', 'c'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])).toBeNull();
    expect(findCycle(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).toEqual(['a', 'b', 'a']);
    expect(wouldCreateCycle([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], 'c', 'a')).toBe(true);
    expect(wouldCreateCycle([{ from: 'a', to: 'b' }], 'a', 'c')).toBe(false);
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true);
  });
  it('next: el pendiente con todas sus deps listas, primero por etapa', () => {
    const stages = [...DEFAULT_STAGES];
    const nodes = [node('a', 'done'), node('b', 'pending', 'pruebas'), node('c', 'pending', 'construccion'), node('d', 'pending', 'diseno')];
    const edges = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }];
    const r = nextStartable(stages, nodes, edges);
    expect(r.node?.id).toBe('c');
    expect(r.goalLine).toBe('/goal c');
    expect(nextStartable(stages, [node('a', 'working')], []).node).toBeNull();
  });
  it('goalLine usa la misión y cae al título', () => {
    expect(goalLine({ title: 'Pagos', goal: 'Conecta  la\npasarela' })).toBe('/goal Conecta la pasarela');
    expect(goalLine({ title: 'Pagos', goal: null })).toBe('/goal Pagos');
  });
  it('en la demo, lo siguiente arrancable es la página de lanzamiento (solo depende de «usuario», que está lista)', () => {
    const d = demoProject();
    const nodes = d.nodes.map((n, i) => node(n.id!, n.status!, n.stage, `2026-10-04T05:00:${String(i).padStart(2, '0')}.000Z`));
    const edges = d.nodes.flatMap((n) => (n.deps ?? []).map((f) => ({ from: f, to: n.id! })));
    expect(nextStartable([...DEFAULT_STAGES], nodes, edges).node?.id).toBe('landing');
    expect(countNodes(nodes)).toEqual({ total: 20, pending: 9, working: 3, blocked: 3, done: 5 });
  });
});

describe('applyEvent', () => {
  const snap = (): ProjectSnapshot => ({
    project: { id: 'p', name: 'P', stages: [...DEFAULT_STAGES], createdAt: at, updatedAt: at },
    nodes: [node('a', 'pending')],
    edges: [],
    blockers: [],
    messages: [],
    seq: 3,
  });
  it('aplica, es idempotente e ignora otros proyectos', () => {
    const ev = { seq: 4, projectId: 'p', type: 'node.updated' as const, actor: 'agent' as const, at, payload: { node: node('a', 'working') } };
    const s1 = applyEvent(snap(), ev);
    expect(s1.nodes[0]!.status).toBe('working');
    expect(s1.seq).toBe(4);
    expect(applyEvent(s1, ev)).toBe(s1);
    expect(applyEvent(snap(), { ...ev, projectId: 'q' }).seq).toBe(3);
  });
  it('node.removed limpia aristas, bloqueantes y mensajes', () => {
    const s = { ...snap(), edges: [{ projectId: 'p', from: 'a', to: 'b' }] };
    const r = applyEvent(s, { seq: 4, projectId: 'p', type: 'node.removed', actor: 'owner', at, payload: { nodeId: 'a' } });
    expect(r.nodes).toHaveLength(0);
    expect(r.edges).toHaveLength(0);
  });
});
