// Proyecto de ejemplo en memoria, solo para tests y `pnpm dev:fixture` (el build usa ./http).
// Es la demo del servidor en el idioma del PM (#83): `demoProject` de @dagyard/model, «Booking marketplace» o
// «Marketplace de reservas», el grafo del preview (design/preview-constelacion.html): 20 tareas, 5 etapas y
// 3 pedidos abiertos (una decisión, una revisión y un acceso). Se le suman informes de ejemplo.
// `FixtureApi` se porta como el servidor de docs/api.md: emite eventos con `seq`, persiste lo que resuelves
// durante la sesión del navegador y deja simular comandos del CLI (`dagyard msg|start|done|block|node add`).

import { demoProject, demoProjectId, demoSignature } from '@dagyard/model';
import { lang, type Lang } from '../i18n';
import { RESOLVED_BY_YOU, resolutionSummary } from './adapter';
import { reduce } from './reduce';
import { ApiError, type AppApi } from './session';
import {
  UnauthorizedError,
  type Blocker,
  type BlockerKind,
  type DagEvent,
  type DagNode,
  type Message,
  type ProjectSummary,
  type Resolution,
  type Snapshot,
  type Stage,
} from './types';

type Handlers = Parameters<AppApi['subscribe']>[2];

const STAGES: Stage[] = [
  { id: 'descubrimiento', name: 'Descubrimiento' },
  { id: 'diseno', name: 'Diseño' },
  { id: 'construccion', name: 'Construcción' },
  { id: 'pruebas', name: 'Pruebas' },
  { id: 'lanzamiento', name: 'Lanzamiento' },
];

interface Seed {
  id: string;
  s: number;
  t: string;
  st: DagNode['status'];
  p?: number;
  deps: string[];
  team?: string;
  msg?: string;
  report?: string;
  block?: { kind: BlockerKind; q: string; opts?: string[]; label?: string };
}

/** Informes de ejemplo: dominio reservado para documentación, nunca una URL real. */
const REPORT = (slug: string) => `https://example.com/informes/${slug}`;

const RENOVACION: Seed[] = [
  { id: 'inventario-de-paginas', s: 0, t: 'Inventario de páginas actuales', st: 'done', deps: [], team: 'Investigación', msg: 'Hay 42 páginas; 11 no reciben visitas hace un año.' },
  { id: 'mensajes-clave', s: 0, t: 'Mensajes clave de la marca', st: 'done', deps: [], team: 'Investigación', msg: 'Tres mensajes: rápido, cercano y sin letra chica.' },
  { id: 'mapa-del-sitio', s: 1, t: 'Mapa del sitio nuevo', st: 'done', deps: ['inventario-de-paginas'], team: 'Diseño', msg: 'Quedan 18 páginas, agrupadas en 4 secciones.' },
  { id: 'portada-nueva', s: 1, t: 'Portada nueva', st: 'working', p: 0.4, deps: ['mapa-del-sitio', 'mensajes-clave'], team: 'Diseño', msg: 'Probando dos versiones del encabezado.' },
  { id: 'migrar-contenido', s: 2, t: 'Migrar el contenido', st: 'pending', deps: ['mapa-del-sitio'] },
  { id: 'formulario-de-contacto', s: 2, t: 'Formulario de contacto', st: 'pending', deps: ['portada-nueva'] },
  { id: 'revision-de-textos', s: 3, t: 'Revisión de textos', st: 'pending', deps: ['migrar-contenido'] },
  { id: 'publicar-el-sitio', s: 4, t: 'Publicar el sitio', st: 'pending', deps: ['revision-de-textos', 'formulario-de-contacto'] },
];

const minutesAgo = (now: number, m: number) => new Date(now - m * 60_000).toISOString();

function buildSnapshot(id: string, name: string, seeds: Seed[], now: number): Snapshot {
  const nodes: DagNode[] = seeds.map((n) => ({
    id: n.id,
    stageId: STAGES[n.s]!.id,
    title: n.t,
    status: n.st,
    progress: n.st === 'done' ? 1 : (n.p ?? 0),
    team: n.team,
    reportUrl: n.st === 'done' ? n.report : undefined,
  }));
  const edges = seeds.flatMap((n) => n.deps.map((from) => ({ from, to: n.id })));
  const blockers: Blocker[] = seeds
    .filter((n) => n.block)
    .map((n, i) => ({
      id: `b_${id.slice(0, 4)}${i + 1}`,
      nodeId: n.id,
      kind: n.block!.kind,
      question: n.block!.q,
      options: n.block!.kind === 'access' ? [] : (n.block!.opts ?? ['Aprobar', 'Pedir cambios']),
      label: n.block!.label,
    }));
  const messages: Message[] = seeds
    .filter((n) => n.msg)
    .map((n, i, all) => ({
      id: `m_${id.slice(0, 4)}${i + 1}`,
      nodeId: n.id,
      from: `Equipo de ${n.team}`,
      text: n.msg!,
      reportUrl: n.st === 'done' ? n.report : undefined,
      at: minutesAgo(now, (all.length - i) * 37),
    }));
  // En la revisión, el agente dejó su informe para que lo leas antes de aprobar.
  for (const n of seeds) {
    if (n.block?.kind === 'review' && n.report) {
      messages.push({ id: `m_${id.slice(0, 4)}r`, nodeId: n.id, from: `Equipo de ${n.team}`, text: 'Te dejé las 3 pantallas en el informe.', reportUrl: n.report, at: minutesAgo(now, 12) });
    }
  }
  return { project: { id, name }, stages: STAGES.map((s) => ({ ...s })), nodes, edges, blockers, messages, seq: 0 };
}

/** Informes de ejemplo sobre la demo (la del servidor no trae): por id de tarea. */
const DEMO_REPORTS: Record<string, string> = {
  entrevistas: REPORT('entrevistas'),
  competencia: REPORT('competencia'),
  'registro-d': REPORT('registro'),
  'checkout-d': REPORT('diseno-del-pago'),
};
const REVIEW_NOTE: Record<Lang, string> = { en: 'The 3 screens are in the report.', es: 'Te dejé las 3 pantallas en el informe.' };
const THANKS: Record<Lang, string> = { en: 'Thanks. Picking up where I left off.', es: 'Gracias. Sigo desde donde me quedé.' };

/** La demo en el idioma `l`, con su id del servidor (`booking-marketplace` o `marketplace-reservas`). */
export function marketplaceSnapshot(now = Date.now(), l: Lang = lang()): Snapshot {
  const id = demoProjectId(l);
  const d = demoProject(l);
  const done = new Set(d.nodes.filter((n) => n.status === 'done').map((n) => n.id!));
  const nodes: DagNode[] = d.nodes.map((n) => ({
    id: n.id!,
    stageId: n.stage,
    title: n.title,
    status: n.status ?? 'pending',
    progress: n.progress ?? 0,
    team: n.team ?? undefined,
    goal: n.goal ?? undefined,
    reportUrl: done.has(n.id!) ? DEMO_REPORTS[n.id!] : undefined,
  }));
  const edges = d.nodes.flatMap((n) => (n.deps ?? []).map((from) => ({ from, to: n.id! })));
  const blockers: Blocker[] = (d.blockers ?? []).map((b, i) => ({
    id: `b_${id.slice(0, 4)}${i + 1}`,
    nodeId: b.nodeId,
    kind: b.kind,
    question: b.question,
    options: [...(b.options ?? [])],
    label: b.accessLabel ?? undefined,
  }));
  const messages: Message[] = (d.messages ?? []).map((m, i, all) => ({
    id: `m_${id.slice(0, 4)}${i + 1}`,
    nodeId: m.nodeId,
    from: m.from!,
    text: m.text,
    reportUrl: done.has(m.nodeId) ? DEMO_REPORTS[m.nodeId] : undefined,
    at: minutesAgo(now, (all.length - i) * 37),
  }));
  // En la revisión, el agente dejó su informe para que lo leas antes de aprobar.
  for (const b of blockers) {
    const report = DEMO_REPORTS[b.nodeId];
    const team = nodes.find((n) => n.id === b.nodeId)?.team ?? null;
    if (b.kind === 'review' && report) {
      messages.push({ id: `m_${id.slice(0, 4)}r`, nodeId: b.nodeId, from: demoSignature(l, team), text: REVIEW_NOTE[l], reportUrl: report, at: minutesAgo(now, 12) });
    }
  }
  return { project: { id, name: d.name }, stages: (d.stages ?? []).map((s) => ({ id: s.id!, name: s.name })), nodes, edges, blockers, messages, seq: 0 };
}

export function renovacionSnapshot(now = Date.now()): Snapshot {
  return buildSnapshot('renovacion-del-sitio', 'Renovación del sitio web', RENOVACION, now);
}

/* ------------------------------------------------------------------ API en memoria */

interface ProjectState {
  snap: Snapshot;
  log: DagEvent[];
  listeners: Set<Handlers>;
}

/** Lo que se le quita a un evento para crearlo: el `seq` lo pone el servidor. */
type Draft = DagEvent extends infer E ? (E extends DagEvent ? Omit<E, 'seq'> : never) : never;

interface Persisted {
  session: boolean;
  resolved: Array<{ projectId: string; blockerId: string; resolution: Resolution }>;
}

const STORAGE_KEY = 'dagyard:fixture';

export interface FixtureOptions {
  /** Dónde persistir lo resuelto y la sesión (por defecto, sessionStorage si existe; null = solo memoria). */
  storage?: Storage | null;
  /** Latencia simulada de cada llamada (ms). */
  latency?: number;
  now?: () => number;
}

export class FixtureApi implements AppApi {
  private readonly projects = new Map<string, ProjectState>();
  private readonly storage: Storage | null;
  private readonly latency: number;
  private readonly now: () => number;
  private persisted: Persisted = { session: false, resolved: [] };
  /** El idioma al arrancar: decide qué demo hay y en qué idioma firma el equipo. */
  private readonly lang: Lang = lang();

  constructor(o: FixtureOptions = {}) {
    this.storage = o.storage !== undefined ? o.storage : safeSessionStorage();
    this.latency = o.latency ?? 0;
    this.now = o.now ?? Date.now;
    const t = this.now();
    for (const snap of [marketplaceSnapshot(t, this.lang), renovacionSnapshot(t)]) {
      this.projects.set(snap.project.id, { snap, log: [], listeners: new Set() });
    }
    this.persisted = this.load();
    // Lo resuelto en esta sesión del navegador sobrevive a la recarga, como en el servidor.
    for (const r of this.persisted.resolved) {
      try {
        this.applyResolution(r.projectId, r.blockerId, r.resolution);
      } catch {
        /* pedido que ya no existe */
      }
    }
  }

  /* ---------------------------------------------------------------- sesión */

  async check(): Promise<boolean> {
    await this.wait();
    return this.persisted.session;
  }

  async login(token: string): Promise<void> {
    await this.wait();
    // En el ejemplo cualquier clave sirve, salvo una vacía o «clave-mala» (para probar el error).
    if (!token.trim() || token.trim() === 'clave-mala') throw new UnauthorizedError();
    this.persisted.session = true;
    this.save();
  }

  async logout(): Promise<void> {
    this.persisted.session = false;
    this.save();
  }

  /* ---------------------------------------------------------------- API */

  async listProjects(): Promise<ProjectSummary[]> {
    await this.wait();
    this.requireSession();
    return [...this.projects.values()].map((p) => ({ ...p.snap.project }));
  }

  async getSnapshot(projectId: string): Promise<Snapshot> {
    await this.wait();
    this.requireSession();
    return structuredClone(this.state(projectId).snap);
  }

  async resolveBlocker(blockerId: string, resolution: Resolution): Promise<Blocker> {
    await this.wait();
    this.requireSession();
    const projectId = this.projectOfBlocker(blockerId);
    const b = this.applyResolution(projectId, blockerId, resolution);
    // El valor de un acceso nunca se guarda, ni siquiera en el ejemplo.
    const kept: Resolution = resolution.kind === 'access' ? { kind: 'access', value: 'guardado' } : resolution;
    this.persisted.resolved.push({ projectId, blockerId, resolution: kept });
    this.save();
    return structuredClone(b);
  }

  subscribe(projectId: string, sinceSeq: number, handlers: Handlers): () => void {
    const p = this.state(projectId);
    let open = true;
    queueMicrotask(() => {
      if (!open) return;
      for (const e of p.log) if (e.seq > sinceSeq) handlers.onEvent(structuredClone(e));
      p.listeners.add(handlers);
      handlers.onStatus?.('live');
    });
    return () => {
      open = false;
      p.listeners.delete(handlers);
    };
  }

  /* ---------------------------------------------------------------- simulador del CLI */

  /** `dagyard msg <nodo> "…" [--report <url>]` */
  message(projectId: string, nodeId: string, text: string, reportUrl?: string): void {
    const p = this.state(projectId);
    const node = this.node(p, nodeId);
    const message: Message = {
      id: `m_${Math.random().toString(36).slice(2, 10)}`,
      nodeId,
      from: demoSignature(this.lang, node.team ?? null),
      text: text.slice(0, 280),
      reportUrl,
      at: new Date(this.now()).toISOString(),
    };
    this.emit(p, { type: 'message.posted', message });
    if (reportUrl && !node.reportUrl) this.emit(p, { type: 'node.updated', node: { ...node, reportUrl } });
  }

  /** `dagyard start <nodo>` */
  start(projectId: string, nodeId: string, team?: string): void {
    const p = this.state(projectId);
    const node = this.node(p, nodeId);
    const stage = p.snap.stages.find((s) => s.id === node.stageId);
    this.emit(p, { type: 'node.updated', node: { ...node, status: 'working', progress: 0, team: team ?? node.team ?? stage?.name } });
  }

  /** `dagyard progress <nodo> <0..1>` */
  progress(projectId: string, nodeId: string, value: number): void {
    const p = this.state(projectId);
    const node = this.node(p, nodeId);
    this.emit(p, { type: 'node.updated', node: { ...node, progress: Math.min(1, Math.max(0, value)) } });
  }

  /** `dagyard done <nodo>` */
  done(projectId: string, nodeId: string): void {
    const p = this.state(projectId);
    const node = this.node(p, nodeId);
    if (this.openBlocker(p, nodeId)) throw new ApiError(409, 'conflict', 'La tarea tiene un pedido abierto.');
    this.emit(p, { type: 'node.updated', node: { ...node, status: 'done', progress: 1 } });
  }

  /** `dagyard block <nodo> --kind … --q "…" [--opt …]` */
  block(projectId: string, nodeId: string, kind: BlockerKind, question: string, extra: { options?: string[]; label?: string } = {}): Blocker {
    const p = this.state(projectId);
    const node = this.node(p, nodeId);
    const blocker: Blocker = {
      id: `b_${Math.random().toString(36).slice(2, 10)}`,
      nodeId,
      kind,
      question,
      options: kind === 'access' ? [] : (extra.options ?? (kind === 'review' ? ['Aprobar', 'Pedir cambios'] : [])),
      label: kind === 'access' ? (extra.label ?? 'Acceso') : undefined,
    };
    this.emit(p, { type: 'blocker.opened', blocker });
    this.emit(p, { type: 'node.updated', node: { ...node, status: 'blocked' } });
    return blocker;
  }

  /** `dagyard node add` */
  addNode(projectId: string, input: { id: string; title: string; stageId: string; deps?: string[]; team?: string }): void {
    const p = this.state(projectId);
    if (p.snap.nodes.some((n) => n.id === input.id)) throw new ApiError(409, 'conflict', 'Ya existe.');
    this.emit(p, { type: 'node.added', node: { id: input.id, stageId: input.stageId, title: input.title, status: 'pending', progress: 0, team: input.team } });
    for (const from of input.deps ?? []) this.emit(p, { type: 'edge.added', edge: { from, to: input.id } });
  }

  /** `dagyard node rm` */
  removeNode(projectId: string, nodeId: string): void {
    const p = this.state(projectId);
    this.node(p, nodeId);
    this.emit(p, { type: 'node.removed', nodeId });
  }

  /* ---------------------------------------------------------------- internos */

  private applyResolution(projectId: string, blockerId: string, resolution: Resolution): Blocker {
    const p = this.state(projectId);
    const b = p.snap.blockers.find((x) => x.id === blockerId);
    if (!b) throw new ApiError(404, 'not_found', 'No encuentro ese pedido.');
    if (b.resolvedAt) throw new ApiError(409, 'conflict', 'Ese pedido ya está resuelto.');
    if (resolution.kind !== b.kind) throw new ApiError(400, 'invalid', 'La respuesta no corresponde al pedido.');
    let choice: string | null = null;
    let note: string | null = null;
    if (resolution.kind === 'decision') {
      if (!b.options.includes(resolution.option)) throw new ApiError(400, 'invalid', 'Esa opción no existe.');
      choice = resolution.option;
    } else if (resolution.kind === 'review') {
      choice = resolution.verdict === 'approve' ? (b.options[0] ?? 'Aprobar') : (b.options[1] ?? 'Pedir cambios');
      note = resolution.comment?.trim() || null;
    } else if (!resolution.value.trim()) {
      throw new ApiError(400, 'invalid', 'Falta el valor.');
    }
    const resolved: Blocker = {
      ...b,
      resolution: resolutionSummary({ kind: b.kind, options: b.options, resolution: { choice, note, hasValue: b.kind === 'access' } }),
      resolvedBy: RESOLVED_BY_YOU,
      resolvedAt: new Date(this.now()).toISOString(),
    };
    this.emit(p, { type: 'blocker.resolved', blocker: resolved });
    const node = this.node(p, b.nodeId);
    if (!this.openBlocker(p, node.id)) {
      this.emit(p, { type: 'node.updated', node: { ...node, status: 'working', progress: Math.max(node.progress, 0.05) } });
      this.emit(p, {
        type: 'message.posted',
        message: {
          id: `m_${Math.random().toString(36).slice(2, 10)}`,
          nodeId: node.id,
          from: demoSignature(this.lang, node.team ?? null),
          text: THANKS[this.lang],
          at: new Date(this.now()).toISOString(),
        },
      });
    }
    return resolved;
  }

  private emit(p: ProjectState, draft: Draft): void {
    const e = { ...draft, seq: p.snap.seq + 1 } as DagEvent;
    p.snap = reduce(p.snap, e);
    p.log.push(e);
    for (const h of p.listeners) h.onEvent(structuredClone(e));
  }

  private state(projectId: string): ProjectState {
    const p = this.projects.get(projectId);
    if (!p) throw new ApiError(404, 'not_found', 'No encuentro ese proyecto.');
    return p;
  }

  private node(p: ProjectState, nodeId: string): DagNode {
    const n = p.snap.nodes.find((x) => x.id === nodeId);
    if (!n) throw new ApiError(404, 'not_found', 'No encuentro esa tarea.');
    return n;
  }

  private openBlocker(p: ProjectState, nodeId: string): Blocker | undefined {
    return p.snap.blockers.find((b) => b.nodeId === nodeId && !b.resolvedAt);
  }

  private projectOfBlocker(blockerId: string): string {
    for (const [id, p] of this.projects) if (p.snap.blockers.some((b) => b.id === blockerId)) return id;
    throw new ApiError(404, 'not_found', 'No encuentro ese pedido.');
  }

  private requireSession(): void {
    if (!this.persisted.session) throw new UnauthorizedError();
  }

  private wait(): Promise<void> {
    return this.latency ? new Promise((r) => setTimeout(r, this.latency)) : Promise.resolve();
  }

  private load(): Persisted {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) return { session: false, resolved: [], ...(JSON.parse(raw) as Partial<Persisted>) };
    } catch {
      /* almacenamiento bloqueado */
    }
    return { session: false, resolved: [] };
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.persisted));
    } catch {
      /* almacenamiento bloqueado: queda en memoria */
    }
  }
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}
