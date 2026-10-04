/**
 * `dagyard sync --github`: la cola de issues → nodos `gh-<n>`, con la API granular (nunca `PUT`): cada
 * cambio es un evento en vivo y el resto del grafo no se toca.
 *
 * Reglas (diseño #45, T-2):
 * - Nodo existente: nunca cambia título, etapa, equipo ni goal (los cura la fábrica); `link` solo si está vacío.
 * - Nodo nuevo: solo issues abiertos (con `all` también los cerrados como completados, ya Listos).
 * - El estado solo avanza: cerrado (completado) → `done`; abierto con un PR abierto que lo cierra y nodo
 *   `pending` → `working`. Con un bloqueante abierto el servidor responde 409: aviso, no error.
 * - La etiqueta `epic` no crea nodo; si ya existe, se sincroniza normal.
 * - Aristas solo si ambos nodos existen; nunca borra. `founder-input` → bloqueante `decision`, solo si el
 *   nodo no tiene ninguna decisión (abierta o resuelta, con cualquier texto: contrato #31).
 */
import type { Blocker, BlockerInput, DagNode, Edge, NodeInput, NodePatch, NodeStatus, Stage } from '@dagyard/model';
import { LIMITS, slugify, wouldCreateCycle } from '@dagyard/model';
import { ApiRequestError, type DagyardClient } from '../api.js';
import { UsageError } from '../args.js';
import { oneLine } from '../tasks/parse.js';
import { cleanTitle, closingRefs, dependencyRefs, issueNodeTitle, parseOptions, type GhIssue, type GithubSource } from './github.js';

export type SyncApi = Pick<DagyardClient, 'snapshot' | 'addNode' | 'updateNode' | 'addEdge' | 'openBlocker'>;

export interface SyncOptions {
  repo: string;
  label?: string;
  /** etapa de los nodos nuevos (id o nombre); default `construccion` si existe, si no la primera */
  stage?: string;
  /** también crea los issues cerrados como completados */
  all?: boolean;
  dryRun?: boolean;
}

export interface SyncReport {
  repo: string;
  project: string;
  dryRun: boolean;
  /** issues que mapean a un nodo (nuevo o existente) */
  issues: number;
  created: string[];
  updated: string[];
  unchanged: string[];
  /** en humano: lo que se hizo, en orden */
  actions: string[];
  warnings: string[];
}

export const FOUNDER_LABEL = 'founder-input';
/** Una épica no es una tarea: no se crea (si ya existe como nodo, se sincroniza como cualquier otro). */
export const EPIC_LABEL = 'epic';
const DEFAULT_STAGE = 'construccion';
const RANK: Record<NodeStatus, number> = { pending: 0, working: 1, blocked: 1, done: 2 };
const STATUS_HUMAN: Record<NodeStatus, string> = { pending: 'Pendiente', working: 'En progreso', blocked: 'Te espera', done: 'Lista' };

export const nodeIdOf = (n: number) => `gh-${n}`;

export async function syncGithub(api: SyncApi, source: GithubSource, projectId: string, opts: SyncOptions): Promise<SyncReport> {
  const dry = !!opts.dryRun;
  const snap = await api.snapshot(projectId);
  const stage = pickStage(snap.project.stages, opts.stage);

  const listed = await source.issues(opts.repo, opts.label ? { label: opts.label } : {});
  const issues = listed.filter((i) => !i.isPull).sort((a, b) => a.number - b.number);
  const withPr = new Set<number>();
  for (const pr of await source.openPulls(opts.repo)) for (const n of closingRefs(`${pr.title}\n${pr.body}`)) withPr.add(n);

  const nodes = new Map<string, Pick<DagNode, 'id' | 'status' | 'link'>>(snap.nodes.map((n) => [n.id, n]));
  const edges: Array<Pick<Edge, 'from' | 'to'>> = snap.edges.map((e) => ({ from: e.from, to: e.to }));
  const report: SyncReport = {
    repo: opts.repo,
    project: projectId,
    dryRun: dry,
    issues: 0,
    created: [],
    updated: [],
    unchanged: [],
    actions: [],
    warnings: [],
  };
  const created = new Set<string>();
  const updated = new Set<string>();
  const considered: GhIssue[] = [];

  /** 400/404/409 de una escritura → aviso; lo demás (auth, red, 5xx) corta el sync. */
  const soft = async <T>(what: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiRequestError && [400, 404, 409].includes(err.status)) {
        report.warnings.push(`${what}: ${err.message}`);
        return undefined;
      }
      throw err;
    }
  };

  // 1 · nodos: crear o avanzar
  for (const issue of issues) {
    const id = nodeIdOf(issue.number);
    const existing = nodes.get(id);
    const completed = issue.state === 'closed' && issue.stateReason !== 'not_planned';
    if (!existing) {
      if (issue.state === 'closed' && (!opts.all || !completed)) continue;
      if (issue.labels.includes(EPIC_LABEL)) continue;
      const input: NodeInput = {
        id,
        stage,
        title: issueNodeTitle(issue.title, issue.number),
        status: completed ? 'done' : withPr.has(issue.number) ? 'working' : 'pending',
        link: issue.url,
      };
      considered.push(issue);
      const ok = dry || (await soft(`no pude crear ${id}`, () => api.addNode(projectId, input))) !== undefined;
      if (!ok) continue;
      nodes.set(id, { id, status: input.status!, link: input.link! });
      created.add(id);
      report.actions.push(`nuevo ${id} «${input.title}» (${STATUS_HUMAN[input.status!]})`);
      continue;
    }
    considered.push(issue);
    const patch: NodePatch = {};
    if (!existing.link && issue.url) patch.link = issue.url;
    const want: NodeStatus | null = completed ? 'done' : issue.state === 'open' && withPr.has(issue.number) ? 'working' : null;
    if (want && RANK[want] > RANK[existing.status]) {
      if (existing.status === 'blocked' || hasOpenBlocker(snap.blockers, id)) {
        report.warnings.push(`${id} tiene una pregunta abierta para el dueño; no lo pasé a ${STATUS_HUMAN[want]}`);
      } else {
        patch.status = want;
      }
    }
    if (!Object.keys(patch).length) continue;
    let applied: NodePatch = patch;
    if (!dry) {
      try {
        await api.updateNode(projectId, id, patch);
      } catch (err) {
        if (!(err instanceof ApiRequestError) || ![400, 404, 409].includes(err.status)) throw err;
        if (err.status !== 409 || !patch.status) {
          report.warnings.push(`no pude actualizar ${id}: ${err.message}`);
          continue;
        }
        // 409 al cambiar el estado: tiene un bloqueante abierto. Aviso, y el resto del cambio sí entra
        report.warnings.push(`${id} tiene una pregunta abierta para el dueño; no lo pasé a ${STATUS_HUMAN[patch.status]}`);
        const { status: _skip, ...rest } = patch;
        applied = rest;
        if (!Object.keys(rest).length) continue;
        if ((await soft(`no pude actualizar ${id}`, () => api.updateNode(projectId, id, rest))) === undefined) continue;
      }
    }
    nodes.set(id, { ...existing, ...(applied.link ? { link: applied.link } : {}), ...(applied.status ? { status: applied.status } : {}) });
    updated.add(id);
    const what = [applied.status ? STATUS_HUMAN[applied.status] : null, applied.link ? 'enlace al issue' : null].filter(Boolean);
    report.actions.push(`${id}: ${what.join(', ')}`);
  }

  // 2 · aristas (solo entre nodos que existen; nunca borra)
  for (const issue of considered) {
    const self = nodeIdOf(issue.number);
    if (!nodes.has(self)) continue;
    const refs = dependencyRefs(issue.body);
    const wanted: Array<[string, string]> = [
      ...refs.partOf.map((n): [string, string] => [self, nodeIdOf(n)]), // la épica necesita sus partes
      ...refs.dependsOn.map((n): [string, string] => [nodeIdOf(n), self]),
    ];
    for (const [from, to] of wanted) {
      if (from === to || !nodes.has(from) || !nodes.has(to)) continue;
      if (edges.some((e) => e.from === from && e.to === to)) continue;
      if (dry) {
        if (wouldCreateCycle(edges, from, to)) {
          report.warnings.push(`no agregué ${from} → ${to}: cerraría un ciclo`);
          continue;
        }
      } else {
        try {
          await api.addEdge(projectId, from, to);
        } catch (err) {
          if (!(err instanceof ApiRequestError)) throw err;
          if (err.status === 400 && err.code === 'cycle') report.warnings.push(`no agregué ${from} → ${to}: cerraría un ciclo`);
          else if (err.status === 409) report.warnings.push(`${from} → ${to} ya existía`);
          else if ([400, 404].includes(err.status)) report.warnings.push(`no agregué ${from} → ${to}: ${err.message}`);
          else throw err;
          continue;
        }
      }
      edges.push({ from, to });
      updated.add(self);
      report.actions.push(`${from} → ${to}`);
    }
  }

  // 3 · founder-input → decisión (sin re-preguntar)
  for (const issue of considered) {
    if (issue.state !== 'open' || !issue.labels.includes(FOUNDER_LABEL)) continue;
    const id = nodeIdOf(issue.number);
    const node = nodes.get(id);
    if (!node || node.status === 'done') continue;
    // cualquier decisión previa, abierta o resuelta y con el texto que sea (la fábrica la cura a mano), basta:
    // nunca se re-pregunta (contrato #31)
    if (snap.blockers.some((b) => b.nodeId === id && b.kind === 'decision')) continue;
    const question = oneLine(cleanTitle(issue.title), LIMITS.question);
    const options = parseOptions(issue.body);
    const input: BlockerInput = { kind: 'decision', question, options: options.length ? options : ['Sí', 'No'] };
    if (!dry && (await soft(`no pude abrir la pregunta de ${id}`, () => api.openBlocker(projectId, id, input))) === undefined) continue;
    nodes.set(id, { ...node, status: 'blocked' });
    updated.add(id);
    report.actions.push(`${id}: pregunta al dueño «${question}»`);
  }

  report.issues = considered.length;
  for (const issue of considered) {
    const id = nodeIdOf(issue.number);
    if (created.has(id)) report.created.push(id);
    else if (updated.has(id)) report.updated.push(id);
    else report.unchanged.push(id);
  }
  return report;
}

function hasOpenBlocker(blockers: Blocker[], nodeId: string): boolean {
  return blockers.some((b) => b.nodeId === nodeId && b.status === 'open');
}

function pickStage(stages: Stage[], wanted: string | undefined): string {
  if (!stages.length) throw new UsageError('el proyecto no tiene etapas');
  if (wanted !== undefined) {
    const slug = slugify(wanted);
    const hit = stages.find((s) => s.id === slug || slugify(s.name) === slug);
    if (!hit) throw new UsageError(`no existe la etapa «${wanted}»; las del proyecto: ${stages.map((s) => s.id).join(', ')}`);
    return hit.id;
  }
  return stages.find((s) => s.id === DEFAULT_STAGE)?.id ?? stages[0]!.id;
}

export function formatSync(r: SyncReport): string {
  const lines = [
    `Sincronicé ${r.issues} issues: ${r.created.length} nuevas · ${r.updated.length} actualizadas · ${r.unchanged.length} sin cambios`,
  ];
  if (r.dryRun) lines.push(`Fue una simulación: no se envió nada a «${r.project}».`);
  if (r.warnings.length) lines.push(`Avisos (${r.warnings.length}):`, ...r.warnings.map((w) => `  - ${w}`));
  return `${lines.join('\n')}\n`;
}
