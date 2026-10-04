import { demoProject, type ProjectSnapshot } from '@dagyard/model';
import { describe, expect, it } from 'vitest';
import { AGENT, OWNER, api, json, seedDemo, uniquePid } from './helpers.js';

const open = (s: ProjectSnapshot) => s.blockers.filter((b) => b.status === 'open');
const snap = (pid: string) => api(`/api/projects/${pid}`).then((r) => json<ProjectSnapshot>(r, 200));

// #13: resolver es solo del dueño, así que un agente no puede hacer desaparecer un bloqueante abierto
describe('un agente no borra bloqueantes abiertos', () => {
  it('PUT de la demo sobre la demo sembrada: agente → 409 y siguen los 3; dueño → 200', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const before = open(s).map((b) => b.id);
    expect(before).toHaveLength(3);

    const r = await json(await api(`/api/projects/${pid}`, { method: 'PUT', body: demoProject(), headers: AGENT }), 409);
    expect(r.error.code).toBe('conflict');
    expect(r.error.message).toMatch(/3 preguntas abiertas/);
    // tampoco sirve quitar el bloqueante del grafo
    const sin = { ...demoProject(), blockers: [] };
    sin.nodes = sin.nodes.map((n) => (n.status === 'blocked' ? { ...n, status: 'working' as const } : n));
    await json(await api(`/api/projects/${pid}`, { method: 'PUT', body: sin, headers: AGENT }), 409);

    const after = await snap(pid);
    expect(open(after).map((b) => b.id)).toEqual(before);
    expect(after.seq).toBe(s.seq);

    const owner = await json<ProjectSnapshot>(await api(`/api/projects/${pid}`, { method: 'PUT', body: demoProject(), headers: OWNER }), 200);
    expect(open(owner)).toHaveLength(3);
  });

  it('DELETE de un nodo con bloqueante abierto: agente → 409; dueño → 204', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const r = await json(await api(`/api/projects/${pid}/nodes/comision`, { method: 'DELETE', headers: AGENT }), 409);
    expect(r.error.code).toBe('conflict');
    expect(r.error.message).toMatch(/una pregunta abierta/);
    expect(open(await snap(pid)).some((b) => b.nodeId === 'comision')).toBe(true);

    // un nodo sin bloqueantes abiertos lo sigue borrando el agente
    expect((await api(`/api/projects/${pid}/nodes/landing`, { method: 'DELETE', headers: AGENT })).status).toBe(204);
    expect((await api(`/api/projects/${pid}/nodes/comision`, { method: 'DELETE', headers: OWNER })).status).toBe(204);
  });

  it('con el bloqueante ya resuelto, el agente puede borrar el nodo', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const b = s.blockers.find((x) => x.nodeId === 'comision')!;
    await json(await api(`/api/projects/${pid}/blockers/${b.id}/resolve`, { method: 'POST', body: { choice: 0 }, headers: OWNER }), 200);
    expect((await api(`/api/projects/${pid}/nodes/comision`, { method: 'DELETE', headers: AGENT })).status).toBe(204);
  });

  it('PUT del agente sobre un proyecto sin bloqueantes abiertos → 200 (lo usa la QA de tiempo real)', async () => {
    const pid = uniquePid();
    const g = { name: 'Sin preguntas', nodes: [{ id: 'a', stage: 'diseno', title: 'A' }] };
    await json(await api(`/api/projects/${pid}`, { method: 'PUT', body: g, headers: AGENT }), 200);
    const again = await json<ProjectSnapshot>(
      await api(`/api/projects/${pid}`, { method: 'PUT', body: { ...g, nodes: [...g.nodes, { id: 'b', stage: 'diseno', title: 'B', deps: ['a'] }] }, headers: AGENT }),
      200,
    );
    expect(again.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('PUT del agente con bloqueantes, si el proyecto es nuevo → 200', async () => {
    const s = await seedDemo(uniquePid());
    expect(open(s)).toHaveLength(3);
  });
});
