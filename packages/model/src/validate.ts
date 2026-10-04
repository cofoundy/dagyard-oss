/**
 * Validación sin dependencias. Cada `parse*` recibe `unknown` (el body JSON) y devuelve
 * `{ ok: true, value }` normalizado o `{ ok: false, message }` en español, listo para un 400.
 */
import {
  BLOCKER_KINDS,
  LIMITS,
  NODE_STATUSES,
  type BlockerInput,
  type BlockerKind,
  type MessageInput,
  type NodeInput,
  type NodePatch,
  type NodeStatus,
  type ProjectGraphInput,
  type ProjectInput,
  type ResolveInput,
  type StageInput,
} from './types.js';
import { findCycle } from './graph.js';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};
const wrap = <T>(fn: () => T): Parsed<T> => {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, message: e.message };
    throw e;
  }
};

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function isSlug(s: unknown): s is string {
  return typeof s === 'string' && s.length <= LIMITS.slug && SLUG_RE.test(s);
}

/** «Diseño del pago» → `diseno-del-pago`. Nunca devuelve vacío. */
export function slugify(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, '');
  return s || 'x';
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${what}: se esperaba un objeto`);
  return v as Record<string, unknown>;
}

function str(v: unknown, field: string, max: number, opts: { optional?: boolean } = {}): string | undefined {
  if (v === undefined && opts.optional) return undefined;
  if (typeof v !== 'string') return fail(`${field}: se esperaba texto`);
  const t = v.trim();
  if (!t) return fail(`${field}: no puede estar vacío`);
  if ([...t].length > max) return fail(`${field}: máximo ${max} caracteres`);
  return t;
}

function nullableStr(v: unknown, field: string, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return str(v, field, max);
}

function url(v: unknown, field: string): string | null | undefined {
  const s = nullableStr(v, field, LIMITS.url);
  if (s && !/^https?:\/\//i.test(s)) fail(`${field}: debe empezar con http:// o https://`);
  return s;
}

function slug(v: unknown, field: string, optional = false): string | undefined {
  if (v === undefined && optional) return undefined;
  if (!isSlug(v)) return fail(`${field}: usa minúsculas, números y guiones (máx. ${LIMITS.slug})`);
  return v;
}

function status(v: unknown): NodeStatus | undefined {
  if (v === undefined) return undefined;
  if (!NODE_STATUSES.includes(v as NodeStatus)) fail(`status: uno de ${NODE_STATUSES.join(', ')}`);
  return v as NodeStatus;
}

function progress(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) fail('progress: un número entre 0 y 1');
  return v as number;
}

function stringList(v: unknown, field: string, max: number, maxLen: number): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return fail(`${field}: se esperaba una lista`);
  if (v.length > max) return fail(`${field}: máximo ${max}`);
  return v.map((x, i) => str(x, `${field}[${i}]`, maxLen)!);
}

function stages(v: unknown): StageInput[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length === 0) return fail('stages: se esperaba una lista con al menos una etapa');
  if (v.length > 12) return fail('stages: máximo 12');
  const out = v.map((x, i): StageInput => {
    if (typeof x === 'string') return { name: str(x, `stages[${i}]`, LIMITS.name)! };
    const o = obj(x, `stages[${i}]`);
    const s: StageInput = { name: str(o.name, `stages[${i}].name`, LIMITS.name)! };
    const id = slug(o.id, `stages[${i}].id`, true);
    if (id) s.id = id;
    return s;
  });
  const ids = out.map((s) => s.id ?? slugify(s.name));
  if (new Set(ids).size !== ids.length) fail('stages: hay etapas repetidas');
  return out;
}

/* ------------------------------------------------------------------ parsers */

export function parseProjectInput(body: unknown): Parsed<ProjectInput> {
  return wrap(() => {
    const o = obj(body, 'body');
    const p: ProjectInput = { name: str(o.name, 'name', LIMITS.name)! };
    const id = slug(o.id, 'id', true);
    if (id) p.id = id;
    const st = stages(o.stages);
    if (st) p.stages = st;
    return p;
  });
}

function nodeInput(o: Record<string, unknown>, at: string): NodeInput {
  const n: NodeInput = {
    stage: slug(o.stage, `${at}stage`)!,
    title: str(o.title, `${at}title`, LIMITS.title)!,
  };
  const id = slug(o.id, `${at}id`, true);
  if (id) n.id = id;
  const s = status(o.status);
  if (s) n.status = s;
  const p = progress(o.progress);
  if (p !== undefined) n.progress = p;
  const team = nullableStr(o.team, `${at}team`, LIMITS.name);
  if (team !== undefined) n.team = team;
  const goal = nullableStr(o.goal, `${at}goal`, LIMITS.goal);
  if (goal !== undefined) n.goal = goal;
  const r = url(o.reportUrl, `${at}reportUrl`);
  if (r !== undefined) n.reportUrl = r;
  const l = url(o.link, `${at}link`);
  if (l !== undefined) n.link = l;
  if (o.deps !== undefined) {
    if (!Array.isArray(o.deps)) fail(`${at}deps: se esperaba una lista`);
    n.deps = (o.deps as unknown[]).map((d, i) => slug(d, `${at}deps[${i}]`)!);
  }
  return n;
}

export function parseNodeInput(body: unknown): Parsed<NodeInput> {
  return wrap(() => nodeInput(obj(body, 'body'), ''));
}

export function parseNodePatch(body: unknown): Parsed<NodePatch> {
  return wrap(() => {
    const o = obj(body, 'body');
    const allowed = ['stage', 'title', 'status', 'progress', 'team', 'goal', 'reportUrl', 'link'];
    const extra = Object.keys(o).filter((k) => !allowed.includes(k));
    if (extra.length) fail(`campos no editables: ${extra.join(', ')}`);
    const p: NodePatch = {};
    if (o.stage !== undefined) p.stage = slug(o.stage, 'stage');
    if (o.title !== undefined) p.title = str(o.title, 'title', LIMITS.title);
    const s = status(o.status);
    if (s) p.status = s;
    const pr = progress(o.progress);
    if (pr !== undefined) p.progress = pr;
    const team = nullableStr(o.team, 'team', LIMITS.name);
    if (team !== undefined) p.team = team;
    const goal = nullableStr(o.goal, 'goal', LIMITS.goal);
    if (goal !== undefined) p.goal = goal;
    const r = url(o.reportUrl, 'reportUrl');
    if (r !== undefined) p.reportUrl = r;
    const l = url(o.link, 'link');
    if (l !== undefined) p.link = l;
    if (Object.keys(p).length === 0) fail('nada que actualizar');
    return p;
  });
}

function blockerInput(o: Record<string, unknown>, at: string): BlockerInput {
  if (!BLOCKER_KINDS.includes(o.kind as BlockerKind)) fail(`${at}kind: uno de ${BLOCKER_KINDS.join(', ')}`);
  const kind = o.kind as BlockerKind;
  const b: BlockerInput = { kind, question: str(o.question, `${at}question`, LIMITS.question)! };
  const options = stringList(o.options, `${at}options`, LIMITS.options, LIMITS.option);
  if (kind === 'access') {
    if (options && options.length) fail(`${at}options: un acceso no lleva opciones`);
    b.options = [];
    b.accessLabel = str(o.accessLabel, `${at}accessLabel`, LIMITS.name)!;
  } else {
    // una revisión sin opciones explícitas es «Aprobar / Pedir cambios»
    const opts = options && options.length ? options : kind === 'review' ? ['Aprobar', 'Pedir cambios'] : [];
    if (opts.length < 1) fail(`${at}options: una decisión necesita al menos una opción`);
    b.options = opts;
    b.accessLabel = null;
  }
  return b;
}

export function parseBlockerInput(body: unknown): Parsed<BlockerInput> {
  return wrap(() => blockerInput(obj(body, 'body'), ''));
}

/**
 * Valida una resolución contra el bloqueante que resuelve. Devuelve la opción ya
 * normalizada a su texto (`choice`) o el valor del acceso.
 */
export function parseResolveInput(
  body: unknown,
  blocker: { kind: BlockerKind; options: string[] },
): Parsed<{ choice: string | null; value: string | null; note: string | null }> {
  return wrap(() => {
    const o = obj(body, 'body') as ResolveInput & Record<string, unknown>;
    const note = nullableStr(o.note, 'note', LIMITS.note) ?? null;
    if (blocker.kind === 'access') {
      if (typeof o.value !== 'string' || !o.value.trim()) fail('value: pega el valor del acceso');
      if ((o.value as string).length > LIMITS.accessValue) fail(`value: máximo ${LIMITS.accessValue} caracteres`);
      return { choice: null, value: o.value as string, note };
    }
    let choice: string | undefined;
    if (typeof o.choice === 'number' && Number.isInteger(o.choice)) choice = blocker.options[o.choice];
    else if (typeof o.choice === 'string') choice = blocker.options.find((x) => x === (o.choice as string).trim());
    if (choice === undefined) fail(`choice: el índice o el texto de una opción (${blocker.options.join(' | ')})`);
    return { choice: choice!, value: null, note };
  });
}

function messageInput(o: Record<string, unknown>, at: string): MessageInput {
  const m: MessageInput = { text: str(o.text, `${at}text`, LIMITS.message)! };
  const from = str(o.from, `${at}from`, LIMITS.name, { optional: true });
  if (from) m.from = from;
  const r = url(o.reportUrl, `${at}reportUrl`);
  if (r !== undefined) m.reportUrl = r;
  return m;
}

export function parseMessageInput(body: unknown): Parsed<MessageInput> {
  return wrap(() => messageInput(obj(body, 'body'), ''));
}

/** `PUT /api/projects/:id`: valida el grafo completo, incluidas referencias y ciclos. */
export function parseProjectGraphInput(body: unknown): Parsed<ProjectGraphInput> {
  return wrap(() => {
    const o = obj(body, 'body');
    const g: ProjectGraphInput = { name: str(o.name, 'name', LIMITS.name)!, nodes: [] };
    const st = stages(o.stages);
    if (st) g.stages = st;
    if (!Array.isArray(o.nodes)) fail('nodes: se esperaba una lista');
    const raw = o.nodes as unknown[];
    if (raw.length > LIMITS.nodesPerProject) fail(`nodes: máximo ${LIMITS.nodesPerProject}`);
    g.nodes = raw.map((x, i) => nodeInput(obj(x, `nodes[${i}]`), `nodes[${i}].`));
    if (o.blockers !== undefined) {
      if (!Array.isArray(o.blockers)) fail('blockers: se esperaba una lista');
      g.blockers = (o.blockers as unknown[]).map((x, i) => {
        const bo = obj(x, `blockers[${i}]`);
        return { ...blockerInput(bo, `blockers[${i}].`), nodeId: slug(bo.nodeId, `blockers[${i}].nodeId`)! };
      });
    }
    if (o.messages !== undefined) {
      if (!Array.isArray(o.messages)) fail('messages: se esperaba una lista');
      g.messages = (o.messages as unknown[]).map((x, i) => {
        const mo = obj(x, `messages[${i}]`);
        return { ...messageInput(mo, `messages[${i}].`), nodeId: slug(mo.nodeId, `messages[${i}].nodeId`)! };
      });
    }
    const problem = checkGraph(g);
    if (problem) fail(problem);
    return g;
  });
}

/** Resuelve ids y etapas de un ProjectGraphInput y devuelve el primer problema, o null. */
export function checkGraph(g: ProjectGraphInput): string | null {
  const stageIds = new Set((g.stages ?? []).map((s) => s.id ?? slugify(s.name)));
  const ids = g.nodes.map((n) => n.id ?? slugify(n.title));
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return `nodes: id repetido «${id}»`;
    seen.add(id);
  }
  for (const [i, n] of g.nodes.entries()) {
    if (g.stages && !stageIds.has(n.stage)) return `nodes[${i}].stage: «${n.stage}» no es una etapa del proyecto`;
    for (const d of n.deps ?? []) if (!seen.has(d)) return `nodes[${i}].deps: «${d}» no existe`;
  }
  for (const [i, b] of (g.blockers ?? []).entries()) if (!seen.has(b.nodeId)) return `blockers[${i}].nodeId: «${b.nodeId}» no existe`;
  for (const [i, m] of (g.messages ?? []).entries()) if (!seen.has(m.nodeId)) return `messages[${i}].nodeId: «${m.nodeId}» no existe`;
  const edges = g.nodes.flatMap((n, i) => (n.deps ?? []).map((d) => ({ from: d, to: ids[i]! })));
  const cyc = findCycle(ids, edges);
  if (cyc) return `ciclo en las dependencias: ${cyc.join(' → ')}`;
  return null;
}

