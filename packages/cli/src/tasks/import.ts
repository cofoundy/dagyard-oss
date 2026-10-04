/**
 * `.cofoundy/tasks` → `ProjectGraphInput` (lo que recibe `PUT /api/projects/:id`).
 * Dependencias = `deps` ∪ `blockedBy`, solo ids que existen en el directorio. Etapas = `phase:` si
 * todas las tareas lo traen; si no, la profundidad topológica con nombre humano («Getting started», «Next»,
 * …, «Finally» o «Para empezar», «Después», …, «Al final»), con tope de 12. Títulos: los de `titles` si vienen
 * (#30); si no, `legibleTitle` (D10, #21). Etapas, misiones y `lang` van en el idioma del proyecto (#77).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { NodeInput, NodeStatus, ProjectGraphInput, StageInput } from '@dagyard/model';
import { DEFAULT_LANG, DEFAULT_STAGES_BY_LANG, LIMITS, slugify } from '@dagyard/model';
import { depthStageName, importGoal, PHASE_WORDS } from '../defaults.js';
import { lang as currentLang, t as tr, withLang, type Lang } from '../i18n.js';
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
  /** tareas `blocked` en el archivo que piden algo a una persona (quedan Pendiente con un aviso, #35/#38) */
  asksHuman: number;
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
  /** idioma de los avisos (los datos del grafo no cambian); default: el vigente (`withLang`), si no inglés */
  lang?: Lang;
  /** idioma de los datos (etapas, misiones, `lang` del grafo): el del proyecto; default DEFAULT_LANG (uno nuevo) */
  projectLang?: Lang;
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

/** El slug del proyecto que crea o reemplaza un import (lo necesita `dagyard import` antes de construirlo). */
export function importProjectId(opts: Pick<ImportOptions, 'projectId' | 'dirName'>): string {
  return slugify(opts.projectId || opts.dirName || 'proyecto');
}

export function buildImport(files: TaskFile[], opts: ImportOptions = {}): ImportResult {
  return withLang(opts.lang ?? currentLang(), () => build(files, opts));
}

function build(files: TaskFile[], opts: ImportOptions): ImportResult {
  const warnings: string[] = [];
  const tasks = files.map((f) => parseTask(f.file, f.text));
  if (tasks.length > LIMITS.nodesPerProject) {
    throw new Error(
      tr(
        `there are ${tasks.length} tasks; a project holds at most ${LIMITS.nodesPerProject}`,
        `son ${tasks.length} tareas; el máximo por proyecto es ${LIMITS.nodesPerProject}`,
      ),
    );
  }

  // ids de nodo: slug del id de la tarea, sin repetir
  const nodeIds: string[] = [];
  const used = new Set<string>();
  for (const t of tasks) {
    const base = slugify(t.id) || slugify(t.file.replace(/\.md$/i, '')) || 'tarea';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base.slice(0, LIMITS.slug - 3)}-${n}`;
    if (id !== base) warnings.push(tr(`${t.file}: the id «${t.id}» is repeated; it became «${id}»`, `${t.file}: el id «${t.id}» se repite; quedó como «${id}»`));
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
    if (unknown.size) {
      const refs = [...unknown].join(', ');
      warnings.push(tr(`${t.file}: depends on ${refs}, which are not in the folder`, `${t.file}: depende de ${refs}, que no están en el directorio`));
    }
  });

  for (const [from, to] of breakCycles(deps)) {
    deps[to] = deps[to]!.filter((d) => d !== from);
    const edge = `${tasks[to]!.file} → ${tasks[from]!.file}`;
    warnings.push(tr(`loop: removed the dependency ${edge}`, `ciclo: se quitó la dependencia ${edge}`));
  }

  const depth = longestPathDepth(deps);
  const statuses = tasks.map(effectiveStatus);

  const dataLang = opts.projectLang ?? DEFAULT_LANG;
  const { stages, stageOf, source } = inferStages(tasks, depth, dataLang);

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
      goal: t.goal ?? oneLine(importGoal(title, `${tasksPath}/${t.file}`, dataLang), LIMITS.goal),
      deps: deps[i]!.map((d) => nodeIds[d]!),
    };
  });

  // #35: el import no le pregunta nada al dueño por su cuenta (una pregunta del archivo se reabriría en cada
  // --replace); avisa, y el agente la hace en vivo cuando de verdad la necesita
  let askers = 0;
  tasks.forEach((t, i) => {
    if (!asksHuman(t, deps[i]!, tasks)) return;
    askers++;
    const title = nodes[i]!.title;
    warnings.push(
      tr(
        `«${title}» asks a person for something; it stays Pending. Ask them live with dagyard block`,
        `«${title}» pide algo a una persona; quedó Pendiente. Pregúntaselo en vivo con dagyard block`,
      ),
    );
  });

  const projectId = importProjectId(opts);
  const name = oneLine(opts.name ?? humanize(opts.dirName ?? projectId), LIMITS.name);

  const status: Record<NodeStatus, number> = { pending: 0, working: 0, blocked: 0, done: 0 };
  for (const s of statuses) status[s]++;

  return {
    projectId,
    graph: { name, lang: dataLang, stages, nodes },
    stats: {
      nodes: nodes.length,
      edges: nodes.reduce((n, node) => n + (node.deps?.length ?? 0), 0),
      stageSource: source,
      stages: stages.map((s) => ({ id: s.id!, name: s.name, nodes: stageOf.filter((x) => x === s.id).length })),
      status,
      asksHuman: askers,
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
      throw new Error(tr(`«${raw}» is neither a JSON object nor a file I can read`, `«${raw}» no es un objeto JSON ni un archivo que pueda leer`));
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(tr(`it is not valid JSON (${why})`, `no es JSON válido (${why})`));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(tr('expected an object { "node id": "title" }', 'se esperaba un objeto { "id de nodo": "título" }'));
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
      warnings.push(tr(`--titles: there is no task «${key}»; ignored`, `--titles: no hay ninguna tarea «${key}»; se ignoró`));
      continue;
    }
    const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    const fallback = legibleTitle(tasks[i]!.title, tasks[i]!.summary);
    const keep = tr(`kept «${fallback}»`, `quedó «${fallback}»`);
    if (!title) {
      warnings.push(tr(`--titles: the title for «${key}» is not text with content; ${keep}`, `--titles: el título de «${key}» no es un texto con contenido; ${keep}`));
      continue;
    }
    const len = [...title].length;
    if (len > LIMITS.title) {
      warnings.push(
        tr(
          `--titles: the title for «${key}» has ${len} characters (at most ${LIMITS.title}); ${keep}`,
          `--titles: el título de «${key}» tiene ${len} caracteres (máximo ${LIMITS.title}); ${keep}`,
        ),
      );
      continue;
    }
    if (out.has(i)) {
      const prev = keyOf.get(i);
      warnings.push(tr(`--titles: «${prev}» and «${key}» are the same task; kept the one from «${key}»`, `--titles: «${prev}» y «${key}» son la misma tarea; quedó el de «${key}»`));
    }
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

function inferStages(
  tasks: ParsedTask[],
  depth: number[],
  lang: Lang,
): { stages: StageInput[]; stageOf: string[]; source: 'phase' | 'depth' } {
  const phases = new Set(tasks.map((t) => t.phase?.toLowerCase()));
  if (tasks.length > 0 && tasks.every((t) => t.phase) && phases.size <= MAX_STAGES) {
    const known = DEFAULT_STAGES_BY_LANG[lang];
    const order: Array<{ id: string; name: string; rank: number; minDepth: number }> = [];
    const stageOf = tasks.map((t, i) => {
      const word = t.phase!.toLowerCase();
      const k = PHASE_WORDS.findIndex((words) => words.includes(word));
      const id = k >= 0 ? known[k]!.id : slugify(word) || 'etapa';
      const name = k >= 0 ? known[k]!.name : humanize(t.phase!);
      const existing = order.find((s) => s.id === id);
      if (existing) existing.minDepth = Math.min(existing.minDepth, depth[i]!);
      else order.push({ id, name, rank: k >= 0 ? k : PHASE_WORDS.length, minDepth: depth[i]! });
      return id;
    });
    order.sort((a, b) => a.rank - b.rank || a.minDepth - b.minDepth);
    return { stages: order.map(({ id, name }) => ({ id, name })), stageOf, source: 'phase' };
  }
  // más de 12 niveles: los más profundos comparten la última
  const max = Math.min(depth.length ? Math.max(...depth) : 0, MAX_STAGES - 1);
  const stages = Array.from({ length: max + 1 }, (_, d) => {
    const name = depthStageName(d, max, lang);
    return { id: slugify(name), name };
  });
  return { stages, stageOf: depth.map((d) => stages[Math.min(d, max)]!.id), source: 'depth' };
}
