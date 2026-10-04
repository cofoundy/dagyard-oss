/**
 * `.cofoundy/tasks` → `ProjectGraphInput` (lo que recibe `PUT /api/projects/:id`).
 * Dependencias = `deps` ∪ `blockedBy`, solo ids que existen en el directorio. Etapas = `phase:` si
 * todas las tareas lo traen; si no, la profundidad topológica con nombre humano («Para empezar»,
 * «Después», «Luego», …, «Al final»), con tope de 12. Títulos: los de `titles` si vienen (#30); si no,
 * `legibleTitle` (D10, #21).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { NodeInput, NodeStatus, ProjectGraphInput, StageInput } from '@dagyard/model';
import { LIMITS } from '@dagyard/model';
import { slugify } from '@dagyard/model';
import { humanize, legibleTitle, oneLine, parseTask, type ParsedTask } from './parse.js';

export interface TaskFile {
  file: string;
  text: string;
}

export interface ImportStats {
  nodes: number;
  edges: number;
  stageSource: 'phase' | 'depth';
  stages: Array<{ id: string; name: string; nodes: number }>;
  status: Record<NodeStatus, number>;
  /** cuántos títulos vinieron de `titles`; solo si se pasó */
  titled?: number;
}

export interface ImportResult {
  projectId: string;
  graph: ProjectGraphInput;
  stats: ImportStats;
  /** en humano: referencias desconocidas, ciclos rotos, ids repetidos */
  warnings: string[];
}

export interface ImportOptions {
  /** slug del proyecto; default: el nombre del repo (`dirName`) */
  projectId?: string;
  /** nombre humano; default: `dirName` humanizado */
  name?: string;
  /** nombre del repo dueño de las tareas, p. ej. `basalt` (ver `projectNameFromDir`) */
  dirName?: string;
  /** cómo se nombra el directorio en el `goal` (default `.cofoundy/tasks`) */
  tasksPath?: string;
  /**
   * id de nodo (o id de la tarea, p. ej. `T-314-A`) → título humano que redactó quien importa (#30). Reemplaza a
   * `legibleTitle`; claves desconocidas o títulos que no sirven van a `warnings`, nunca abortan.
   */
  titles?: Record<string, unknown>;
}

/** `parseProjectGraphInput` acepta hasta 12 etapas. */
export const MAX_STAGES = 12;

const SKIP_FILES = /^(readme|index|_.*)\.md$/i;

export function readTasksDir(dir: string): TaskFile[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && /\.md$/i.test(d.name) && !SKIP_FILES.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((file) => ({ file, text: readFileSync(join(dir, file), 'utf8') }));
}

/** `~/x/basalt/.cofoundy/tasks` → `basalt`. */
export function projectNameFromDir(dir: string): string {
  const abs = resolve(dir);
  const parent = dirname(abs);
  if (basename(abs) === 'tasks' && basename(parent) === '.cofoundy') return basename(dirname(parent));
  return basename(abs);
}

export function buildImport(files: TaskFile[], opts: ImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const tasks = files.map((f) => parseTask(f.file, f.text));
  if (tasks.length > LIMITS.nodesPerProject) {
    throw new Error(`son ${tasks.length} tareas; el máximo por proyecto es ${LIMITS.nodesPerProject}`);
  }

  // ids de nodo: slug del id de la tarea, sin repetir
  const nodeIds: string[] = [];
  const used = new Set<string>();
  for (const t of tasks) {
    const base = slugify(t.id) || slugify(t.file.replace(/\.md$/i, '')) || 'tarea';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base.slice(0, LIMITS.slug - 3)}-${n}`;
    if (id !== base) warnings.push(`${t.file}: el id «${t.id}» se repite; quedó como «${id}»`);
    used.add(id);
    nodeIds.push(id);
  }

  // alias (insensible a mayúsculas) → índice de tarea; el primero gana
  const byAlias = new Map<string, number>();
  tasks.forEach((t, i) => {
    for (const a of t.aliases) if (!byAlias.has(a.toLowerCase())) byAlias.set(a.toLowerCase(), i);
  });

  // aristas from → to (to depende de from)
  const deps: number[][] = tasks.map(() => []);
  tasks.forEach((t, to) => {
    const unknown = new Set<string>();
    for (const ref of t.depRefs) {
      for (const token of ref.match(/[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*/g) ?? []) {
        const from = byAlias.get(token.toLowerCase());
        if (from === undefined) {
          if (/^T-|\d/.test(token) && /^[A-Z]/.test(token)) unknown.add(token);
          continue;
        }
        if (from !== to && !deps[to]!.includes(from)) deps[to]!.push(from);
      }
    }
    if (unknown.size) warnings.push(`${t.file}: depende de ${[...unknown].join(', ')}, que no están en el directorio`);
  });

  for (const [from, to] of breakCycles(deps)) {
    deps[to] = deps[to]!.filter((d) => d !== from);
    warnings.push(`ciclo: se quitó la dependencia ${tasks[to]!.file} → ${tasks[from]!.file}`);
  }

  const depth = longestPathDepth(deps);
  const statuses = tasks.map(effectiveStatus);

  const { stages, stageOf, source } = inferStages(tasks, depth);

  const given = opts.titles ? givenTitles(opts.titles, tasks, nodeIds, warnings) : null;

  const tasksPath = (opts.tasksPath ?? '.cofoundy/tasks').replace(/\/+$/, '');
  const nodes: NodeInput[] = tasks.map((t, i) => {
    const title = given?.get(i) ?? legibleTitle(t.title, t.summary);
    return {
      id: nodeIds[i]!,
      stage: stageOf[i]!,
      title,
      status: statuses[i]!,
      progress: statuses[i] === 'done' ? 1 : 0,
      team: t.team,
      goal: t.goal ?? oneLine(`${title} — sigue ${tasksPath}/${t.file} y cumple su aceptación`, LIMITS.goal),
      deps: deps[i]!.map((d) => nodeIds[d]!),
    };
  });

  // #35: el import no le pregunta nada al dueño por su cuenta (una pregunta del archivo se reabriría en cada
  // --replace); avisa, y el agente la hace en vivo cuando de verdad la necesita
  tasks.forEach((t, i) => {
    if (asksHuman(t, deps[i]!, tasks))
      warnings.push(`«${nodes[i]!.title}» pide algo a una persona; quedó Pendiente. Pregúntaselo en vivo con dagyard block`);
  });

  const projectId = slugify(opts.projectId || opts.dirName || 'proyecto');
  const name = oneLine(opts.name ?? humanize(opts.dirName ?? projectId), LIMITS.name);

  const status: Record<NodeStatus, number> = { pending: 0, working: 0, blocked: 0, done: 0 };
  for (const s of statuses) status[s]++;

  return {
    projectId,
    graph: { name, stages, nodes },
    stats: {
      nodes: nodes.length,
      edges: nodes.reduce((n, node) => n + (node.deps?.length ?? 0), 0),
      stageSource: source,
      stages: stages.map((s) => ({ id: s.id!, name: s.name, nodes: stageOf.filter((x) => x === s.id).length })),
      status,
      ...(given ? { titled: given.size } : {}),
    },
    warnings,
  };
}

/**
 * `--titles`: JSON en línea (empieza con `{`) o la ruta a un archivo JSON. Tiene que ser un objeto; lo demás
 * (claves y valores) lo revisa `buildImport` y avisa sin abortar.
 */
export function readTitles(raw: string): Record<string, unknown> {
  let text = raw;
  if (!raw.trim().startsWith('{')) {
    try {
      text = readFileSync(raw, 'utf8');
    } catch {
      throw new Error(`«${raw}» no es un objeto JSON ni un archivo que pueda leer`);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`no es JSON válido (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('se esperaba un objeto { "id de nodo": "título" }');
  }
  return parsed as Record<string, unknown>;
}

/** índice de tarea → título dado. La clave vale como id de nodo o id de la tarea (se compara su slug). */
function givenTitles(
  titles: Record<string, unknown>,
  tasks: ParsedTask[],
  nodeIds: string[],
  warnings: string[],
): Map<number, string> {
  const byKey = new Map<string, number>();
  nodeIds.forEach((id, i) => byKey.set(id, i));
  tasks.forEach((t, i) => {
    const k = slugify(t.id);
    if (k && !byKey.has(k)) byKey.set(k, i);
  });
  const out = new Map<number, string>();
  const keyOf = new Map<number, string>();
  for (const [key, value] of Object.entries(titles)) {
    const i = byKey.get(key) ?? byKey.get(slugify(key));
    if (i === undefined) {
      warnings.push(`--titles: no hay ninguna tarea «${key}»; se ignoró`);
      continue;
    }
    const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    const keep = `quedó «${legibleTitle(tasks[i]!.title, tasks[i]!.summary)}»`;
    if (!title) {
      warnings.push(`--titles: el título de «${key}» no es un texto con contenido; ${keep}`);
      continue;
    }
    const len = [...title].length;
    if (len > LIMITS.title) {
      warnings.push(`--titles: el título de «${key}» tiene ${len} caracteres (máximo ${LIMITS.title}); ${keep}`);
      continue;
    }
    if (out.has(i)) warnings.push(`--titles: «${keyOf.get(i)}» y «${key}» son la misma tarea; quedó el de «${key}»`);
    out.set(i, title);
    keyOf.set(i, key);
  }
  return out;
}

/**
 * El import nunca manda `blocked`: «Te espera» lo pone un bloqueante, y ese lo abre el agente en vivo con
 * `dagyard block` (#35). Una tarea `blocked` en el archivo queda Pendiente.
 */
function effectiveStatus(t: ParsedTask): NodeStatus {
  return t.status === 'blocked' ? 'pending' : t.status;
}

/** `blocked` que pide algo a una persona: el status lo nombra (escalación, decisión…) o no espera a ninguna tarea. */
function asksHuman(t: ParsedTask, myDeps: number[], tasks: ParsedTask[]): boolean {
  if (t.status !== 'blocked') return false;
  return t.needsHuman || !myDeps.some((d) => tasks[d]!.status !== 'done');
}

/** Aristas de retroceso (DFS en orden de archivo) que hay que quitar para que sea un DAG. */
function breakCycles(deps: number[][]): Array<[number, number]> {
  const color = deps.map(() => 0); // 0 sin ver, 1 en pila, 2 cerrado
  const back: Array<[number, number]> = [];
  const visit = (to: number) => {
    color[to] = 1;
    for (const from of deps[to]!) {
      if (color[from] === 1) back.push([from, to]);
      else if (color[from] === 0) visit(from);
    }
    color[to] = 2;
  };
  deps.forEach((_, i) => color[i] === 0 && visit(i));
  return back;
}

/** 0 para las raíces; si no, 1 + la mayor profundidad de sus dependencias. */
function longestPathDepth(deps: number[][]): number[] {
  const memo = new Map<number, number>();
  const depthOf = (i: number): number => {
    const known = memo.get(i);
    if (known !== undefined) return known;
    const d = deps[i]!.length ? 1 + Math.max(...deps[i]!.map(depthOf)) : 0;
    memo.set(i, d);
    return d;
  };
  return deps.map((_, i) => depthOf(i));
}

const PHASE_STAGES: Array<{ id: string; name: string; words: string[] }> = [
  { id: 'descubrimiento', name: 'Descubrimiento', words: ['discovery', 'research', 'descubrimiento', 'spec', 'plan', 'planning'] },
  { id: 'diseno', name: 'Diseño', words: ['design', 'diseño', 'diseno', 'ux'] },
  { id: 'construccion', name: 'Construcción', words: ['build', 'implementation', 'implement', 'dev', 'development', 'construccion', 'construcción'] },
  { id: 'pruebas', name: 'Pruebas', words: ['verification', 'verify', 'test', 'testing', 'qa', 'pruebas', 'review'] },
  { id: 'lanzamiento', name: 'Lanzamiento', words: ['deploy', 'post-deploy', 'release', 'launch', 'lanzamiento', 'rollout', 'ship'] },
];

function inferStages(
  tasks: ParsedTask[],
  depth: number[],
): { stages: StageInput[]; stageOf: string[]; source: 'phase' | 'depth' } {
  const phases = new Set(tasks.map((t) => t.phase?.toLowerCase()));
  if (tasks.length > 0 && tasks.every((t) => t.phase) && phases.size <= MAX_STAGES) {
    const order: Array<{ id: string; name: string; rank: number; minDepth: number }> = [];
    const stageOf = tasks.map((t, i) => {
      const word = t.phase!.toLowerCase();
      const known = PHASE_STAGES.findIndex((s) => s.words.includes(word));
      const id = known >= 0 ? PHASE_STAGES[known]!.id : slugify(word) || 'etapa';
      const name = known >= 0 ? PHASE_STAGES[known]!.name : humanize(t.phase!);
      const existing = order.find((s) => s.id === id);
      if (existing) existing.minDepth = Math.min(existing.minDepth, depth[i]!);
      else order.push({ id, name, rank: known >= 0 ? known : PHASE_STAGES.length, minDepth: depth[i]! });
      return id;
    });
    order.sort((a, b) => a.rank - b.rank || a.minDepth - b.minDepth);
    return { stages: order.map(({ id, name }) => ({ id, name })), stageOf, source: 'phase' };
  }
  // más de 12 niveles: los más profundos comparten «Al final»
  const max = Math.min(depth.length ? Math.max(...depth) : 0, MAX_STAGES - 1);
  const stages = Array.from({ length: max + 1 }, (_, d) => {
    const name = depthStageName(d, max);
    return { id: slugify(name), name };
  });
  return { stages, stageOf: depth.map((d) => stages[Math.min(d, max)]!.id), source: 'depth' };
}

/** Etapas intermedias, en orden; alcanzan para las 10 que caben entre la primera y la última. */
const MIDDLE_STAGES = [
  'Después',
  'Luego',
  'Más adelante',
  'Más tarde',
  'Ya avanzado',
  'Bien avanzado',
  'Hacia el final',
  'Cerca del final',
  'Casi al final',
  'Justo antes del final',
];

/** D10: nunca «Etapa N». La 1ª «Para empezar», la última «Al final», las del medio con nombre propio. */
export function depthStageName(d: number, max: number): string {
  if (d === 0) return 'Para empezar';
  if (d === max) return 'Al final';
  return MIDDLE_STAGES[d - 1] ?? 'Más adelante';
}
