import { demoProject, type BlockerWaitResult, type ProjectGraphInput, type ProjectSnapshot } from '@dagyard/model';
import { describe, expect, it } from 'vitest';
import { AGENT, OWNER, api, json, seedDemo, uniquePid } from './helpers.js';

const open = (s: ProjectSnapshot) => s.blockers.filter((b) => b.status === 'open');
const snap = (pid: string) => api(`/api/projects/${pid}`).then((r) => json<ProjectSnapshot>(r, 200));
const put = (pid: string, body: unknown, headers: Record<string, string> = AGENT) => api(`/api/projects/${pid}`, { method: 'PUT', body, headers });
const resolve = (pid: string, bid: string, body: unknown) =>
  api(`/api/projects/${pid}/blockers/${bid}/resolve`, { method: 'POST', body, headers: OWNER }).then((r) => json(r, 200));

/** Un proyecto chico: «a» y «b» (depende de «a»), con un acceso pendiente sobre «b». */
const small = (): ProjectGraphInput => ({
  name: 'Con acceso',
  nodes: [
    { id: 'a', stage: 'diseno', title: 'A', status: 'done' },
    { id: 'b', stage: 'construccion', title: 'B', status: 'blocked', deps: ['a'] },
  ],
  blockers: [{ nodeId: 'b', kind: 'access', question: 'Necesito la clave de la pasarela', accessLabel: 'Clave' }],
});

// #13 + #18 (opción b): resolver es solo del dueño, así que un agente no puede hacer desaparecer ni una
// pregunta abierta ni una respuesta ya dada. El PUT del agente las conserva con su id.
describe('un agente no borra bloqueantes', () => {
  it('PUT del agente sobre la demo sembrada → 200 y conserva los 3 abiertos con sus ids, sin duplicarlos', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const before = open(s).map((b) => b.id);
    expect(before).toHaveLength(3);

    const again = await json<ProjectSnapshot>(await put(pid, demoProject()), 200);
    expect(again.blockers.map((b) => b.id)).toEqual(before);
    for (const b of again.blockers) expect(again.nodes.find((n) => n.id === b.nodeId)?.status).toBe('blocked');

    // quitar los bloqueantes del body tampoco los borra: la tarea sigue esperando al dueño
    const sin = { ...demoProject(), blockers: [] };
    sin.nodes = sin.nodes.map((n) => (n.status === 'blocked' ? { ...n, status: 'working' as const } : n));
    const after = await json<ProjectSnapshot>(await put(pid, sin), 200);
    expect(open(after).map((b) => b.id)).toEqual(before);
    for (const b of after.blockers) expect(after.nodes.find((n) => n.id === b.nodeId)?.status).toBe('blocked');

    // el dueño sigue reemplazando todo (la semilla)
    const owner = await json<ProjectSnapshot>(await put(pid, demoProject(), OWNER), 200);
    expect(open(owner)).toHaveLength(3);
  });

  it('acceso resuelto → PUT del agente (import --replace) → el wait entrega el valor', async () => {
    const pid = uniquePid();
    const s = await json<ProjectSnapshot>(await put(pid, small()), 200);
    const bid = s.blockers[0]!.id;
    await resolve(pid, bid, { value: 'sk_live_123', note: 'la de pruebas' });

    const again = await json<ProjectSnapshot>(await put(pid, small()), 200);
    // la respuesta del dueño sigue con su id; la misma pregunta en el archivo se vuelve a hacer, nueva y abierta
    expect(again.blockers.find((b) => b.id === bid)).toMatchObject({ status: 'resolved', resolvedBy: 'owner', resolution: { note: 'la de pruebas', hasValue: true } });
    expect(open(again)).toHaveLength(1);
    expect(again.nodes.find((n) => n.id === 'b')?.status).toBe('blocked');

    const w = await json<BlockerWaitResult>(await api(`/api/projects/${pid}/blockers/${bid}/wait?timeout=0`), 200);
    expect(w.blocker.status).toBe('resolved');
    expect(w.value).toBe('sk_live_123');
  });

  it('re-preguntar nunca se descarta: la misma revisión que ya se respondió entra como una nueva abierta', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const review = s.blockers.find((b) => b.nodeId === 'checkout-d')!;
    await resolve(pid, review.id, { choice: 0 });

    const again = await json<ProjectSnapshot>(await put(pid, demoProject()), 200);
    const mine = again.blockers.filter((b) => b.nodeId === 'checkout-d');
    expect(mine.map((b) => b.status)).toEqual(['resolved', 'open']);
    expect(mine[0]!.id).toBe(review.id);
    expect(again.nodes.find((n) => n.id === 'checkout-d')?.status).toBe('blocked');
    // las abiertas idénticas no se duplican
    expect(open(again)).toHaveLength(3);
  });

  it('una pregunta abierta con otras opciones no es la misma: entra como nueva', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const g = demoProject();
    g.blockers = g.blockers!.map((b) => (b.nodeId === 'comision' ? { ...b, options: [...b.options!, 'A los dos'] } : b));
    const again = await json<ProjectSnapshot>(await put(pid, g), 200);
    expect(open(again).filter((b) => b.nodeId === 'comision')).toHaveLength(2);
    expect(open(again)).toHaveLength(4);
  });

  it('PUT del agente que quita un nodo con bloqueante (resuelto o abierto) → 409 sin tocar nada', async () => {
    const pid = uniquePid();
    const s = await json<ProjectSnapshot>(await put(pid, small()), 200);
    const bid = s.blockers[0]!.id;
    const onlyA = { name: 'Con acceso', nodes: [{ id: 'a', stage: 'diseno', title: 'A', status: 'done' as const }] };

    let r = await json(await put(pid, onlyA), 409);
    expect(r.error.code).toBe('conflict');
    expect(r.error.message).toMatch(/«B»/);

    await resolve(pid, bid, { value: 'sk_live_123' });
    const resolved = await snap(pid);
    r = await json(await put(pid, onlyA), 409);
    expect(r.error.code).toBe('conflict');
    const after = await snap(pid);
    expect(after.seq).toBe(resolved.seq);
    expect(after.nodes.map((n) => n.id)).toEqual(['a', 'b']);

    const w = await json<BlockerWaitResult>(await api(`/api/projects/${pid}/blockers/${bid}/wait?timeout=0`), 200);
    expect(w.value).toBe('sk_live_123');

    // el dueño sí puede
    const owner = await json<ProjectSnapshot>(await put(pid, onlyA, OWNER), 200);
    expect(owner.blockers).toHaveLength(0);
  });

  it('DELETE de un nodo con bloqueante abierto: agente → 409; dueño → 204', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const r = await json(await api(`/api/projects/${pid}/nodes/comision`, { method: 'DELETE', headers: AGENT }), 409);
    expect(r.error.code).toBe('conflict');
    expect(r.error.message).toMatch(/una pregunta abierta/);
    expect(open(await snap(pid)).some((b) => b.nodeId === 'comision')).toBe(true);

    // un nodo sin bloqueantes lo sigue borrando el agente
    expect((await api(`/api/projects/${pid}/nodes/landing`, { method: 'DELETE', headers: AGENT })).status).toBe(204);
    expect((await api(`/api/projects/${pid}/nodes/comision`, { method: 'DELETE', headers: OWNER })).status).toBe(204);
  });

  it('DELETE de un nodo con el bloqueante ya resuelto: agente → 409 y la respuesta sigue; dueño → 204', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const b = s.blockers.find((x) => x.nodeId === 'comision')!;
    await resolve(pid, b.id, { choice: 0 });
    const r = await json(await api(`/api/projects/${pid}/nodes/comision`, { method: 'DELETE', headers: AGENT }), 409);
    expect(r.error.code).toBe('conflict');
    expect((await snap(pid)).blockers.find((x) => x.id === b.id)?.status).toBe('resolved');
    expect((await api(`/api/projects/${pid}/nodes/comision`, { method: 'DELETE', headers: OWNER })).status).toBe(204);
  });

  it('PUT del agente sobre un proyecto sin bloqueantes → 200 (lo usa la QA de tiempo real)', async () => {
    const pid = uniquePid();
    const g = { name: 'Sin preguntas', nodes: [{ id: 'a', stage: 'diseno', title: 'A' }] };
    await json(await put(pid, g), 200);
    const again = await json<ProjectSnapshot>(
      await put(pid, { ...g, nodes: [...g.nodes, { id: 'b', stage: 'diseno', title: 'B', deps: ['a'] }] }),
      200,
    );
    expect(again.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('PUT del agente con bloqueantes, si el proyecto es nuevo → 200', async () => {
    const s = await seedDemo(uniquePid());
    expect(open(s)).toHaveLength(3);
  });
});

// #19: creación exclusiva, chequeada dentro de la transacción del Store
describe('PUT con If-None-Match: *', () => {
  it('sobre un proyecto existente → 409 y no lo toca', async () => {
    const pid = uniquePid();
    const s = await json<ProjectSnapshot>(await put(pid, small()), 200);
    const r = await json(await put(pid, { name: 'Otro', nodes: [] }, { ...AGENT, 'if-none-match': '*' }), 409);
    expect(r.error.code).toBe('conflict');
    expect(r.error.message).toMatch(/ya existe/i);
    const after = await snap(pid);
    expect(after.seq).toBe(s.seq);
    expect(after.project.name).toBe('Con acceso');
    expect(after.nodes).toHaveLength(2);
  });

  it('sobre un proyecto nuevo → 200 y lo crea', async () => {
    const pid = uniquePid();
    const s = await json<ProjectSnapshot>(await put(pid, small(), { ...AGENT, 'if-none-match': '*' }), 200);
    expect(s.project.id).toBe(pid);
    expect(s.nodes).toHaveLength(2);
  });
});
