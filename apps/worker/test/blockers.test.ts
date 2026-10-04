import type { Blocker, BlockerWaitResult, ProjectSnapshot } from '@dagyard/model';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { AGENT, OWNER, api, json, seedDemo } from './helpers.js';

const SECRET = 'sk_live_NO-DEBE-SALIR-123';
const byNode = (s: ProjectSnapshot, nodeId: string) => s.blockers.find((b) => b.nodeId === nodeId)!;

describe('bloqueantes', () => {
  it('resuelve los 3 tipos: decisión por índice, revisión por texto, acceso con valor', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const [decision, review, access] = [byNode(s, 'comision'), byNode(s, 'checkout-d'), byNode(s, 'pagos')];

    // el agente no puede resolver
    expect((await json(await api(`/api/projects/${pid}/blockers/${decision.id}/resolve`, { method: 'POST', body: { choice: 0 }, headers: AGENT }), 403)).error.code).toBe('forbidden');
    // opción inexistente → 400
    await json(await api(`/api/projects/${pid}/blockers/${decision.id}/resolve`, { method: 'POST', body: { choice: 7 }, headers: OWNER }), 400);

    const d = await json<Blocker>(await api(`/api/projects/${pid}/blockers/${decision.id}/resolve`, { method: 'POST', body: { choice: 0 }, headers: OWNER }), 200);
    expect(d).toMatchObject({ status: 'resolved', resolvedBy: 'owner', resolution: { choice: 'Al proveedor (10 % por reserva)', note: null, hasValue: false } });
    const r = await json<Blocker>(
      await api(`/api/projects/${pid}/blockers/${review.id}/resolve`, { method: 'POST', body: { choice: 'Pedir cambios', note: 'Menos campos en la tarjeta' }, headers: OWNER }),
      200,
    );
    expect(r.resolution).toEqual({ choice: 'Pedir cambios', note: 'Menos campos en la tarjeta', hasValue: false });
    await json(await api(`/api/projects/${pid}/blockers/${access.id}/resolve`, { method: 'POST', body: {}, headers: OWNER }), 400);
    const a = await json<Blocker>(await api(`/api/projects/${pid}/blockers/${access.id}/resolve`, { method: 'POST', body: { value: SECRET }, headers: OWNER }), 200);
    expect(a.resolution).toEqual({ choice: null, note: null, hasValue: true });

    // resolver dos veces → 409
    expect((await json(await api(`/api/projects/${pid}/blockers/${decision.id}/resolve`, { method: 'POST', body: { choice: 1 }, headers: OWNER }), 409)).error.code).toBe('conflict');

    const snap = await json<ProjectSnapshot>(await api(`/api/projects/${pid}`), 200);
    for (const nodeId of ['comision', 'checkout-d', 'pagos']) {
      expect(byNode(snap, nodeId).status).toBe('resolved');
      expect(snap.nodes.find((n) => n.id === nodeId)!.status).toBe('working');
    }
    expect(snap.messages.filter((m) => m.text === 'Gracias. Sigo desde donde me quedé.').map((m) => m.nodeId)).toEqual(['comision', 'checkout-d', 'pagos']);
    expect((await json<Blocker>(await api(`/api/projects/${pid}/blockers/${access.id}`), 200)).status).toBe('resolved');
  });

  it('wait: el agente recibe el valor del acceso; el owner, null; nunca sale en snapshots, eventos ni D1 en claro', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const access = byNode(s, 'pagos');

    // abierto y con timeout 0: responde de inmediato, todavía abierto
    const open = await json<BlockerWaitResult>(await api(`/api/projects/${pid}/blockers/${access.id}/wait?timeout=0`), 200);
    expect(open).toMatchObject({ blocker: { status: 'open' }, value: null });

    // long-poll real: el agente espera y el humano resuelve mientras tanto
    const waiting = api(`/api/projects/${pid}/blockers/${access.id}/wait?timeout=10`, { headers: AGENT });
    await new Promise((r) => setTimeout(r, 300));
    await json(await api(`/api/projects/${pid}/blockers/${access.id}/resolve`, { method: 'POST', body: { value: SECRET }, headers: OWNER }), 200);
    const got = await json<BlockerWaitResult>(await waiting, 200);
    expect(got.blocker.status).toBe('resolved');
    expect(got.value).toBe(SECRET);

    const owner = await json<BlockerWaitResult>(await api(`/api/projects/${pid}/blockers/${access.id}/wait?timeout=0`, { headers: OWNER }), 200);
    expect(owner.value).toBeNull();

    // la decisión resuelta no trae valor ni para el agente
    const decision = byNode(s, 'comision');
    await json(await api(`/api/projects/${pid}/blockers/${decision.id}/resolve`, { method: 'POST', body: { choice: 1 }, headers: OWNER }), 200);
    expect((await json<BlockerWaitResult>(await api(`/api/projects/${pid}/blockers/${decision.id}/wait?timeout=0`), 200)).value).toBeNull();

    for (const path of [`/api/projects/${pid}`, `/api/projects/${pid}/events?since=0`, `/api/projects/${pid}/blockers/${access.id}`, '/api/projects']) {
      const text = await (await api(path)).text();
      expect(text, path).not.toContain(SECRET);
    }
    const row = await env.DB.prepare('SELECT access_value FROM blockers WHERE id = ?').bind(access.id).first<{ access_value: string }>();
    expect(row!.access_value).toMatch(/^v1\./);
    expect(row!.access_value).not.toContain(SECRET);
  });

  it('un nodo con dos bloqueantes sigue bloqueado hasta resolver el último', async () => {
    const s = await seedDemo();
    const pid = s.project.id;
    const second = await json<Blocker>(
      await api(`/api/projects/${pid}/nodes/pagos/blockers`, { method: 'POST', body: { kind: 'review', question: 'Revisa el contrato' } }),
      201,
    );
    expect(second.options).toEqual(['Aprobar', 'Pedir cambios']);
    await json(await api(`/api/projects/${pid}/blockers/${byNode(s, 'pagos').id}/resolve`, { method: 'POST', body: { value: 'x' }, headers: OWNER }), 200);
    let snap = await json<ProjectSnapshot>(await api(`/api/projects/${pid}`), 200);
    expect(snap.nodes.find((n) => n.id === 'pagos')!.status).toBe('blocked');
    expect(snap.messages.some((m) => m.nodeId === 'pagos' && m.text.startsWith('Gracias'))).toBe(false);
    await json(await api(`/api/projects/${pid}/blockers/${second.id}/resolve`, { method: 'POST', body: { choice: 'Aprobar' }, headers: OWNER }), 200);
    snap = await json<ProjectSnapshot>(await api(`/api/projects/${pid}`), 200);
    expect(snap.nodes.find((n) => n.id === 'pagos')!.status).toBe('working');
  });

  it('bloqueante inexistente → 404', async () => {
    const s = await seedDemo();
    await json(await api(`/api/projects/${s.project.id}/blockers/b_nope`), 404);
    await json(await api(`/api/projects/${s.project.id}/blockers/b_nope/resolve`, { method: 'POST', body: { choice: 0 }, headers: OWNER }), 404);
  });
});
