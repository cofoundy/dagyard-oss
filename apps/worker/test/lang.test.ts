import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Project, ProjectSnapshot } from '@dagyard/model';
import { db } from '../src/db.js';
import { OWNER, api, json, uniquePid } from './helpers.js';

const graph = (extra: Record<string, unknown> = {}) => ({
  name: 'Tienda',
  stages: [{ id: 'build', name: 'Build' }],
  nodes: [{ id: 'pagos', stage: 'build', title: 'Pagos' }],
  ...extra,
});

const get = async (pid: string) => (await json<ProjectSnapshot>(await api(`/api/projects/${pid}`), 200)).project;
const put = (pid: string, body: unknown) => api(`/api/projects/${pid}`, { method: 'PUT', body });
const rawLang = async (pid: string) => (await db(env).prepare('SELECT lang FROM projects WHERE id = ?').bind(pid).first<{ lang: string | null }>())?.lang;

describe('idioma del proyecto (#77)', () => {
  it('POST sin lang → en, con las etapas por defecto en inglés', async () => {
    const pid = uniquePid();
    const p = await json<Project>(await api('/api/projects', { method: 'POST', body: { id: pid, name: 'Tienda' } }), 201);
    expect(p.lang).toBe('en');
    expect(p.stages.map((s) => s.name)).toEqual(['Discovery', 'Design', 'Build', 'Testing', 'Launch']);
    expect(p.stages.map((s) => s.id)).toEqual(['descubrimiento', 'diseno', 'construccion', 'pruebas', 'lanzamiento']);
    expect((await get(pid)).lang).toBe('en');
  });

  it('un cliente que crea sin stages ni lang y usa los ids de siempre sigue funcionando (scripts/qa/realtime.mjs)', async () => {
    const pid = uniquePid();
    const g = { name: 'QA', nodes: [{ id: 'base', stage: 'diseno', title: 'Base' }, { id: 't', stage: 'construccion', title: 'T', deps: ['base'] }] };
    const s = await json<ProjectSnapshot>(await put(pid, g), 200);
    expect(s.project.lang).toBe('en');
    expect(s.project.stages.find((x) => x.id === 'construccion')?.name).toBe('Build');
  });

  it('POST con lang es → las etapas por defecto en español', async () => {
    const pid = uniquePid();
    const p = await json<Project>(await api('/api/projects', { method: 'POST', body: { id: pid, name: 'Tienda', lang: 'es' } }), 201);
    expect(p.lang).toBe('es');
    expect(p.stages.map((s) => s.id)).toEqual(['descubrimiento', 'diseno', 'construccion', 'pruebas', 'lanzamiento']);
  });

  it('lang inválido → 400 sin crear nada', async () => {
    const pid = uniquePid();
    await json(await put(pid, graph({ lang: 'fr' })), 400);
    await json(await api(`/api/projects/${pid}`), 404);
  });

  it('PUT nuevo sin lang → en; con lang lo guarda; un PUT posterior sin lang conserva el suyo', async () => {
    const en = uniquePid();
    expect((await json<ProjectSnapshot>(await put(en, graph()), 200)).project.lang).toBe('en');

    const es = uniquePid();
    expect((await json<ProjectSnapshot>(await put(es, graph({ lang: 'es' })), 200)).project.lang).toBe('es');
    expect((await json<ProjectSnapshot>(await put(es, graph()), 200)).project.lang).toBe('es');
  });

  it('un proyecto guardado antes del campo se lee en español y un PUT sin lang no lo toca', async () => {
    const pid = uniquePid();
    const now = new Date().toISOString();
    const stages = JSON.stringify([{ id: 'construccion', name: 'Construcción' }]);
    await db(env).prepare('INSERT INTO projects (id, name, stages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(pid, 'Viejo', stages, now, now).run();
    expect(await rawLang(pid)).toBeNull();
    expect((await get(pid)).lang).toBe('es');

    const g = { name: 'Viejo', nodes: [{ id: 'pagos', stage: 'construccion', title: 'Pagos' }] };
    expect((await json<ProjectSnapshot>(await put(pid, g), 200)).project.lang).toBe('es');
    expect(await rawLang(pid)).toBeNull(); // el dato escrito no cambia
  });

  it('la demo inglesa guardada sin idioma (antes de re-sembrarla) se lee en inglés; la española, en español', async () => {
    const now = new Date().toISOString();
    for (const [pid, lang] of [['booking-marketplace', 'en'], ['marketplace-reservas', 'es']] as const) {
      await db(env)
        .prepare('INSERT INTO projects (id, name, stages, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET lang = NULL')
        .bind(pid, 'Demo', '[]', now, now)
        .run();
      expect(await rawLang(pid)).toBeNull();
      expect((await get(pid)).lang, pid).toBe(lang);
    }
  });

  it('PATCH cambia el idioma (y solo con en | es)', async () => {
    const pid = uniquePid();
    await json(await put(pid, graph()), 200);
    const p = await json<Project>(await api(`/api/projects/${pid}`, { method: 'PATCH', body: { lang: 'es' } }), 200);
    expect(p.lang).toBe('es');
    expect(p.name).toBe('Tienda');
    expect((await get(pid)).lang).toBe('es');
    await json(await api(`/api/projects/${pid}`, { method: 'PATCH', body: { lang: 'de' } }), 400);
  });

  it('lo que escribe el servidor sigue el idioma del proyecto: firma por defecto y mensaje al destrabar', async () => {
    const body = (lang?: string) => ({
      name: 'Tienda',
      ...(lang && { lang }),
      stages: [{ id: 'build', name: 'Build' }],
      nodes: [{ id: 'pagos', stage: 'build', title: 'Pagos', team: 'Build' }],
      blockers: [{ nodeId: 'pagos', kind: 'decision', question: '¿Stripe?', options: ['Yes', 'No'] }],
    });
    const cases = [
      ['en', 'Build team', 'Thanks. Picking up where I left off.'],
      ['es', 'Equipo de Build', 'Gracias. Sigo desde donde me quedé.'],
    ] as const;
    for (const [lang, from, resume] of cases) {
      const pid = uniquePid();
      const s = await json<ProjectSnapshot>(await put(pid, body(lang)), 200);
      const m = await json(await api(`/api/projects/${pid}/nodes/pagos/messages`, { method: 'POST', body: { text: 'Avance' } }), 201);
      expect(m.from, lang).toBe(from);
      const bid = s.blockers[0]!.id;
      await json(await api(`/api/projects/${pid}/blockers/${bid}/resolve`, { method: 'POST', body: { choice: 0 }, headers: OWNER }), 200);
      const after = await json<ProjectSnapshot>(await api(`/api/projects/${pid}`), 200);
      expect(after.messages.at(-1), lang).toMatchObject({ from, text: resume });
    }
  });

  it('una revisión sin opciones las recibe en el idioma del proyecto (POST y PUT)', async () => {
    for (const [lang, options] of [['en', ['Approve', 'Request changes']], ['es', ['Aprobar', 'Pedir cambios']]] as const) {
      const pid = uniquePid();
      const review = { kind: 'review', question: 'Revisa el pago' };
      const s = await json<ProjectSnapshot>(await put(pid, graph({ lang, blockers: [{ nodeId: 'pagos', ...review }] })), 200);
      expect(s.blockers[0]!.options, lang).toEqual(options);
      // re-importar lo mismo no duplica la pregunta abierta
      expect((await json<ProjectSnapshot>(await put(pid, graph({ lang, blockers: [{ nodeId: 'pagos', ...review }] })), 200)).blockers, lang).toHaveLength(1);
      const b = await json(await api(`/api/projects/${pid}/nodes/pagos/blockers`, { method: 'POST', body: { ...review, question: 'Otra' } }), 201);
      expect(b.options, lang).toEqual(options);
    }
  });
});
