import { ApiRequestError, DagyardClient } from './api.js';
import { assertKnownFlags, flag, parseArgs, UsageError, type ParsedArgs } from './args.js';
import { loadConfig } from './config.js';
import type { BlockerInput, BlockerKind, BlockerWaitResult, NodeInput, NodePatch, NodeStatus } from '@dagyard/model';
import { BLOCKER_KINDS, LIMITS, NODE_STATUSES, parseProjectGraphInput, slugify } from '@dagyard/model';
import { buildImport, projectNameFromDir, readTasksDir, type ImportResult } from './tasks/import.js';
import { oneLine } from './tasks/parse.js';

export const VERSION = '0.1.0';

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Exit codes: 0 ok · 1 error de la API o de red · 2 `wait` venció · 3 `next` sin nada arrancable · 64 uso. */
export const EXIT = { ok: 0, api: 1, timeout: 2, nothing: 3, usage: 64 } as const;

interface Ctx {
  io: Io;
  args: ParsedArgs;
}

interface Command {
  usage: string;
  summary: string;
  help: string;
  flags: readonly string[];
  bools?: readonly string[];
  run: (ctx: Ctx) => Promise<number>;
}

const GLOBAL_FLAGS = ['project', 'url'] as const;

const HELP_GLOBAL = `Opciones comunes:
  -p, --project <p>   proyecto (o DAGYARD_PROJECT, o ~/.config/dagyard/project)
  --url <url>         servidor (o DAGYARD_URL, o ~/.config/dagyard/url)
  -h, --help          esta ayuda
La API key sale de DAGYARD_KEY o ~/.config/dagyard/agent-key; nunca se imprime.`;

const COMMANDS: Record<string, Command> = {
  'node add': {
    usage: 'dagyard node add <nodo> --title "…" --stage <etapa> [--goal "…"] [--team "…"] [--dep <nodo>]… [--status <estado>]',
    summary: 'agrega una tarea al plan',
    help: `<nodo> es un id corto (T-314-A se guarda como t-314-a). --dep se repite o va separado por comas.
Estados: pending, working, done (blocked lo pone dagyard block).`,
    flags: ['title', 'stage', 'goal', 'team', 'dep', 'status', 'report', ...GLOBAL_FLAGS],
    async run({ io, args }) {
      const [id] = need(args, ['nodo']);
      const input: NodeInput = {
        id: nodeId(id),
        title: required(args, 'title', LIMITS.title),
        stage: slugify(required(args, 'stage')),
        deps: (args.flags.dep ?? []).flatMap((d) => d.split(',')).map((d) => d.trim()).filter(Boolean).map(nodeId),
      };
      const goal = optional(args, 'goal', LIMITS.goal);
      if (goal !== undefined) input.goal = goal;
      const team = optional(args, 'team', LIMITS.name);
      if (team !== undefined) input.team = team;
      const status = flag(args, 'status');
      if (status !== undefined) input.status = statusArg(status);
      const report = optional(args, 'report', LIMITS.url);
      if (report !== undefined) input.reportUrl = report;
      const node = await client(io, args).addNode(project(io, args), input);
      io.stdout(`${node?.id ?? input.id}\n`);
      return EXIT.ok;
    },
  },
  'node update': {
    usage: 'dagyard node update <nodo> [--title "…"] [--stage <etapa>] [--goal "…"] [--team "…"] [--status <estado>] [--progress <p>] [--report <url>]',
    summary: 'cambia campos de una tarea',
    help: '--progress acepta 0..1 o un porcentaje (40%).',
    flags: ['title', 'stage', 'goal', 'team', 'status', 'progress', 'report', ...GLOBAL_FLAGS],
    async run({ io, args }) {
      const [id] = need(args, ['nodo']);
      const patch: NodePatch = {};
      const title = optional(args, 'title', LIMITS.title);
      if (title !== undefined) patch.title = title;
      const stage = flag(args, 'stage');
      if (stage !== undefined) patch.stage = slugify(stage);
      const goal = optional(args, 'goal', LIMITS.goal);
      if (goal !== undefined) patch.goal = goal;
      const team = optional(args, 'team', LIMITS.name);
      if (team !== undefined) patch.team = team;
      const status = flag(args, 'status');
      if (status !== undefined) patch.status = statusArg(status);
      const progress = flag(args, 'progress');
      if (progress !== undefined) patch.progress = progressArg(progress);
      const report = optional(args, 'report', LIMITS.url);
      if (report !== undefined) patch.reportUrl = report;
      if (Object.keys(patch).length === 0) throw new UsageError('no hay nada que cambiar');
      await client(io, args).updateNode(project(io, args), nodeId(id), patch);
      io.stdout(`${nodeId(id)}\n`);
      return EXIT.ok;
    },
  },
  'node start': {
    usage: 'dagyard node start <nodo> [--team "…"]',
    summary: 'marca una tarea En progreso',
    help: 'Atajo: dagyard start <nodo>.',
    flags: ['team', ...GLOBAL_FLAGS],
    async run({ io, args }) {
      const [id] = need(args, ['nodo']);
      const patch: NodePatch = { status: 'working' };
      const team = optional(args, 'team', LIMITS.name);
      if (team !== undefined) patch.team = team;
      await client(io, args).updateNode(project(io, args), nodeId(id), patch);
      io.stdout(`${nodeId(id)}\n`);
      return EXIT.ok;
    },
  },
  'node progress': {
    usage: 'dagyard node progress <nodo> <p>',
    summary: 'reporta avance (0..1 o 40%)',
    help: 'Atajo: dagyard progress <nodo> <p>.',
    flags: [...GLOBAL_FLAGS],
    async run({ io, args }) {
      const [id, p] = need(args, ['nodo', 'avance']);
      await client(io, args).updateNode(project(io, args), nodeId(id), { progress: progressArg(p) });
      io.stdout(`${nodeId(id)}\n`);
      return EXIT.ok;
    },
  },
  'node done': {
    usage: 'dagyard node done <nodo> [--report <url>]',
    summary: 'marca una tarea Lista',
    help: '--report cuelga el informe de Basalt de la tarea. Atajo: dagyard done <nodo>.',
    flags: ['report', ...GLOBAL_FLAGS],
    async run({ io, args }) {
      const [id] = need(args, ['nodo']);
      const patch: NodePatch = { status: 'done' }; // el servidor fija progress = 1
      const report = optional(args, 'report', LIMITS.url);
      if (report !== undefined) patch.reportUrl = report;
      await client(io, args).updateNode(project(io, args), nodeId(id), patch);
      io.stdout(`${nodeId(id)}\n`);
      return EXIT.ok;
    },
  },
  'edge add': {
    usage: 'dagyard edge add <de> <a>',
    summary: 'agrega una dependencia: <a> necesita que <de> esté lista',
    help: 'El servidor rechaza la arista si arma un ciclo.',
    flags: [...GLOBAL_FLAGS],
    async run({ io, args }) {
      const [from, to] = need(args, ['de', 'a']);
      await client(io, args).addEdge(project(io, args), nodeId(from), nodeId(to));
      io.stdout(`${nodeId(from)} → ${nodeId(to)}\n`);
      return EXIT.ok;
    },
  },
  block: {
    usage: 'dagyard block <nodo> --kind decision|review|access --q "…" [--opt "…"]… [--label "…"]',
    summary: 'le pide al humano una decisión, una revisión o un acceso',
    help: `decision: --opt al menos una vez (máximo ${LIMITS.options}).
review: sin --opt ofrece «Aprobar» y «Pedir cambios».
access: --label nombra el acceso (p. ej. «Clave de la pasarela de pagos»).
Imprime el id del bloqueante, para pasarlo a dagyard wait --blocker.`,
    flags: ['kind', 'q', 'opt', 'label', ...GLOBAL_FLAGS],
    bools: ['json'],
    async run({ io, args }) {
      const [id] = need(args, ['nodo']);
      const kind = required(args, 'kind') as BlockerKind;
      if (!BLOCKER_KINDS.includes(kind)) throw new UsageError(`--kind debe ser ${BLOCKER_KINDS.join(', ')}`);
      const input: BlockerInput = { kind, question: required(args, 'q', LIMITS.question) };
      const opts = (args.flags.opt ?? []).map((o) => o.trim()).filter(Boolean);
      for (const o of opts) if (o.length > LIMITS.option) throw new UsageError(`cada --opt va hasta ${LIMITS.option} caracteres`);
      if (opts.length > LIMITS.options) throw new UsageError(`máximo ${LIMITS.options} opciones`);
      if (kind === 'access') {
        if (opts.length) throw new UsageError('access no lleva --opt; usa --label');
        input.options = [];
        input.accessLabel = required(args, 'label', LIMITS.name);
      } else {
        if (flag(args, 'label') !== undefined) throw new UsageError('--label es solo para access');
        input.options = opts.length ? opts : kind === 'review' ? ['Aprobar', 'Pedir cambios'] : [];
        if (!input.options.length) throw new UsageError('decision necesita al menos un --opt');
      }
      const blocker = await client(io, args).openBlocker(project(io, args), nodeId(id), input);
      io.stdout(args.bools.has('json') ? `${JSON.stringify(blocker)}\n` : `${blocker.id}\n`);
      return EXIT.ok;
    },
  },
  wait: {
    usage: 'dagyard wait <nodo> [--blocker <id>] [--timeout <seg>] [--json]',
    summary: 'espera a que el humano resuelva y devuelve la resolución',
    help: `Sin --blocker espera el último bloqueante abierto del nodo (o devuelve el último resuelto).
Primera línea: la opción elegida (o el valor del acceso). Si hay nota, sigue «nota: …».
Sin --timeout espera para siempre. Exit 2 si vence.`,
    flags: ['blocker', 'timeout', ...GLOBAL_FLAGS],
    bools: ['json'],
    async run({ io, args }) {
      const [id] = need(args, ['nodo']);
      const timeoutRaw = flag(args, 'timeout');
      const timeout = timeoutRaw === undefined ? 0 : Number(timeoutRaw);
      if (!Number.isFinite(timeout) || timeout < 0) throw new UsageError('--timeout va en segundos (≥0)');
      const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      const api = client(io, args);
      const proj = project(io, args);
      const blockerId = flag(args, 'blocker') ?? (await blockerOf(api, proj, nodeId(id)));
      const deadline = timeout > 0 ? Date.now() + timeout * 1000 : Infinity;
      for (;;) {
        const left = Math.ceil((deadline - Date.now()) / 1000);
        if (left <= 0) {
          io.stderr(`dagyard: nadie resolvió el bloqueante de ${nodeId(id)} en ${timeout} s\n`);
          return EXIT.timeout;
        }
        let result: BlockerWaitResult | null;
        try {
          result = await api.waitOnce(proj, blockerId, Math.min(25, left));
        } catch (err) {
          if (err instanceof ApiRequestError && (err.status === 0 || err.status >= 502)) {
            await sleep(2000); // red o proxy caídos: reintenta sin perder la espera
            continue;
          }
          throw err;
        }
        if (result) {
          io.stdout(args.bools.has('json') ? `${JSON.stringify(result)}\n` : formatResolution(result));
          return EXIT.ok;
        }
      }
    },
  },
  msg: {
    usage: 'dagyard msg <nodo> "…" [--report <url>] [--from "…"]',
    summary: `le escribe al PM en corto (≤${LIMITS.message} caracteres)`,
    help: '--from por defecto lo pone el servidor («Equipo de <equipo>»).',
    flags: ['report', 'from', ...GLOBAL_FLAGS],
    async run({ io, args }) {
      const [id] = need(args, ['nodo', 'texto']);
      const text = args.positionals.slice(1).join(' ').trim();
      if (!text) throw new UsageError('el mensaje está vacío');
      if ([...text].length > LIMITS.message) {
        throw new UsageError(`el mensaje tiene ${[...text].length} caracteres; el máximo es ${LIMITS.message}`);
      }
      const input: { text: string; from?: string; reportUrl?: string } = { text };
      const from = optional(args, 'from', LIMITS.name);
      if (from !== undefined) input.from = from;
      const report = optional(args, 'report', LIMITS.url);
      if (report !== undefined) input.reportUrl = report;
      const message = await client(io, args).postMessage(project(io, args), nodeId(id), input);
      io.stdout(`${message?.id ?? 'ok'}\n`);
      return EXIT.ok;
    },
  },
  next: {
    usage: 'dagyard next [--project <p>] [--json]',
    summary: 'la siguiente tarea arrancable, con su línea /goal lista para pegar',
    help: 'Imprime una sola línea: /goal <misión>. Exit 3 si no hay nada arrancable.',
    flags: [...GLOBAL_FLAGS],
    bools: ['json'],
    async run({ io, args }) {
      need(args, []);
      const proj = project(io, args);
      const res = await client(io, args).next(proj);
      if (args.bools.has('json')) {
        io.stdout(`${JSON.stringify(res)}\n`);
        return res.goalLine ? EXIT.ok : EXIT.nothing;
      }
      if (!res.goalLine) {
        io.stderr(`dagyard: no hay tareas arrancables en ${proj}\n`);
        return EXIT.nothing;
      }
      io.stdout(`${goalLine(res.goalLine)}\n`);
      return EXIT.ok;
    },
  },
  import: {
    usage: 'dagyard import --from <ruta a .cofoundy/tasks> [--project <p>] [--name "…"] [--replace] [--dry-run] [--json]',
    summary: 'crea un proyecto nuevo desde las tareas del orchestrator',
    help: `deps y blockedBy se vuelven dependencias; status se normaliza a ${NODE_STATUSES.join(', ')}.
Etapas: phase si todas las tareas lo traen; si no, por profundidad («Para empezar», «Después», «Luego», … «Al final»).
Si el proyecto ya existe no lo pisa (el servidor lo decide al crear): elige otro con --project o pasa
--replace para reemplazarlo. Con la clave de agente, el reemplazo conserva las preguntas y respuestas
del dueño y el servidor lo rechaza (409) si el grafo nuevo quita una tarea que tiene alguna; con el token
del dueño, --replace las borra y las recrea desde el archivo.
--dry-run solo cuenta, no envía nada y no necesita servidor.`,
    flags: ['from', 'name', ...GLOBAL_FLAGS],
    bools: ['dry-run', 'json', 'replace'],
    async run({ io, args }) {
      need(args, []);
      const from = required(args, 'from');
      let files;
      try {
        files = readTasksDir(from);
      } catch (err) {
        throw new UsageError(`no pude leer ${from}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!files.length) throw new UsageError(`no hay tareas (*.md) en ${from}`);
      const name = flag(args, 'name');
      const result = buildImport(files, {
        dirName: projectNameFromDir(from),
        ...(flag(args, 'project') ? { projectId: flag(args, 'project')! } : {}),
        ...(name ? { name } : {}),
      });
      const check = parseProjectGraphInput(result.graph);
      if (!check.ok) throw new Error(`el grafo importado no pasa la validación del modelo: ${check.message}`);
      const dry = args.bools.has('dry-run');
      const replace = args.bools.has('replace');
      if (!dry) {
        // sin --replace, el «¿ya existe?» lo decide el servidor en la misma escritura: dos imports a la vez no se pisan
        try {
          await client(io, args).putProject(result.projectId, result.graph, { exclusive: !replace });
        } catch (err) {
          if (replace || !(err instanceof ApiRequestError) || err.status !== 409) throw err;
          throw new ApiRequestError(
            409,
            'conflict',
            `el proyecto «${result.projectId}» ya existe y no lo piso; usa --project <otro> para crear uno nuevo o --replace para reemplazarlo`,
          );
        }
      }
      io.stdout(args.bools.has('json') ? `${JSON.stringify(result, null, 2)}\n` : formatImport(result, dry, replace));
      return EXIT.ok;
    },
  },
};

const SHORTCUTS: Record<string, string> = { start: 'node start', progress: 'node progress', done: 'node done' };

export async function run(argv: string[], io: Io): Promise<number> {
  let key: string | null = null;
  try {
    key = loadConfig(io.env).key;
    const [first, second] = argv;
    if (!first || first === 'help' || first === '--help' || first === '-h') {
      io.stdout(globalHelp());
      return EXIT.ok;
    }
    if (first === '--version' || first === '-v' || first === 'version') {
      io.stdout(`${VERSION}\n`);
      return EXIT.ok;
    }
    let name: string;
    let rest: string[];
    if (first === 'node' || first === 'edge') {
      if (!second || second.startsWith('-')) {
        io.stdout(groupHelp(first));
        return second && !['--help', '-h'].includes(second) ? EXIT.usage : EXIT.ok;
      }
      name = `${first} ${second}`;
      rest = argv.slice(2);
    } else {
      name = SHORTCUTS[first] ?? first;
      rest = argv.slice(1);
    }
    const cmd = COMMANDS[name];
    if (!cmd) throw new UsageError(`no conozco el comando «${name}»`);
    const args = parseArgs(rest, cmd.bools ?? []);
    if (args.bools.has('help')) {
      io.stdout(commandHelp(cmd));
      return EXIT.ok;
    }
    assertKnownFlags(args, cmd.flags);
    for (const b of args.bools) {
      if (b !== 'help' && !(cmd.bools ?? []).includes(b)) throw new UsageError(`opción desconocida: --${b}`);
    }
    return await cmd.run({ io, args });
  } catch (err) {
    const redact = (s: string) => (key ? s.split(key).join('***') : s);
    if (err instanceof UsageError) {
      io.stderr(redact(`dagyard: ${err.message}\nUsa «dagyard --help» o «dagyard <comando> --help».\n`));
      return EXIT.usage;
    }
    if (err instanceof ApiRequestError) {
      io.stderr(redact(`dagyard: ${err.code}: ${err.message}\n`));
      return EXIT.api;
    }
    io.stderr(redact(`dagyard: ${err instanceof Error ? err.message : String(err)}\n`));
    return EXIT.api;
  }
}

/* ------------------------------------------------------------------ helpers */

function client(io: Io, args: ParsedArgs): DagyardClient {
  const cfg = loadConfig(io.env);
  const url = flag(args, 'url') ?? cfg.url;
  if (!url) throw new UsageError('falta el servidor: DAGYARD_URL, --url o ~/.config/dagyard/url');
  if (!cfg.key) throw new UsageError('falta la API key: DAGYARD_KEY o ~/.config/dagyard/agent-key');
  return new DagyardClient({ baseUrl: url, key: cfg.key, ...(io.fetch ? { fetch: io.fetch } : {}) });
}

function project(io: Io, args: ParsedArgs): string {
  const p = flag(args, 'project') ?? loadConfig(io.env).project;
  if (!p) throw new UsageError('falta el proyecto: --project, DAGYARD_PROJECT o ~/.config/dagyard/project');
  return slugify(p);
}

/** Los posicionales obligatorios, en orden (los que se piden siempre existen). */
function need(args: ParsedArgs, names: string[]): [string, string] {
  const missing = names.slice(args.positionals.length);
  if (missing.length) throw new UsageError(`falta <${missing[0]}>`);
  if (names.length === 0 && args.positionals.length) {
    throw new UsageError(`sobra «${args.positionals[0]}»`);
  }
  return args.positionals as [string, string];
}

function nodeId(raw: string): string {
  if (!/[a-z0-9]/i.test(raw.normalize('NFD'))) throw new UsageError(`«${raw}» no sirve como id de nodo`);
  return slugify(raw);
}

/** El último bloqueante abierto del nodo; si no hay, el último resuelto. */
async function blockerOf(api: DagyardClient, proj: string, node: string): Promise<string> {
  const mine = (await api.snapshot(proj)).blockers
    .filter((b) => b.nodeId === node)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pick = mine.filter((b) => b.status === 'open').pop() ?? mine.pop();
  if (!pick) throw new UsageError(`${node} no tiene bloqueantes; ábrelo con «dagyard block ${node} …»`);
  return pick.id;
}

function required(args: ParsedArgs, key: string, max?: number): string {
  const v = optional(args, key, max);
  if (v === undefined || v === '') throw new UsageError(`falta --${key}`);
  return v;
}

function optional(args: ParsedArgs, key: string, max?: number): string | undefined {
  const v = flag(args, key)?.trim();
  if (v !== undefined && max !== undefined && [...v].length > max) {
    throw new UsageError(`--${key} va hasta ${max} caracteres`);
  }
  return v;
}

function statusArg(s: string): NodeStatus {
  if (s === 'blocked') throw new UsageError('blocked no se pone a mano: lo pone «dagyard block»');
  if (!NODE_STATUSES.includes(s as NodeStatus)) throw new UsageError(`--status debe ser ${MANUAL_STATUSES}`);
  return s as NodeStatus;
}

const MANUAL_STATUSES = NODE_STATUSES.filter((s) => s !== 'blocked').join(', ');

export function progressArg(raw: string): number {
  const pct = raw.trim().endsWith('%');
  let n = Number(raw.trim().replace(/%$/, ''));
  if (!Number.isFinite(n)) throw new UsageError(`avance inválido: «${raw}»`);
  if (pct || n > 1) n /= 100;
  if (n < 0 || n > 1) throw new UsageError(`el avance va de 0 a 1 (o de 0% a 100%): «${raw}»`);
  return Math.round(n * 1000) / 1000;
}

/** Una sola línea física que empieza con `/goal `. */
export function goalLine(raw: string): string {
  const line = oneLine(raw, 10_000);
  return line.startsWith('/goal ') ? line : `/goal ${line.replace(/^\/goal\b\s*/, '')}`;
}

function formatResolution(r: BlockerWaitResult): string {
  const res = r.blocker.resolution;
  const first = r.blocker.kind === 'access' ? (r.value ?? '') : (res?.choice ?? '');
  return `${first}\n${res?.note ? `nota: ${oneLine(res.note, 10_000)}\n` : ''}`;
}

function formatImport(r: ImportResult, dry: boolean, replace: boolean): string {
  const s = r.stats;
  const how = s.stageSource === 'phase' ? 'por fase' : 'por profundidad';
  const done = replace ? ' — reemplazado' : ' — importado';
  const lines = [
    `Proyecto «${r.graph.name}» (${r.projectId})${dry ? ' — simulación, no se envió nada' : done}`,
    `${s.nodes} nodos · ${s.edges} aristas · ${s.stages.length} etapas (${how})`,
    ...s.stages.map((st) => `  ${st.name}: ${st.nodes}`),
    `Estados: ${s.status.pending} pendientes · ${s.status.working} en progreso · ${s.status.blocked} te esperan · ${s.status.done} listas`,
  ];
  if (r.warnings.length) {
    lines.push(`Avisos (${r.warnings.length}):`, ...r.warnings.map((w) => `  - ${w}`));
  }
  return `${lines.join('\n')}\n`;
}

function globalHelp(): string {
  const rows = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(14)} ${c.summary}`);
  return `dagyard ${VERSION} — el plan de la fábrica como un DAG vivo

Uso: dagyard <comando> [opciones]

Comandos:
${rows.join('\n')}
  start | progress | done   atajos de node start | node progress | node done

${HELP_GLOBAL}
`;
}

function groupHelp(group: string): string {
  const rows = Object.entries(COMMANDS)
    .filter(([name]) => name.startsWith(`${group} `))
    .map(([, c]) => `  ${c.usage}\n      ${c.summary}`);
  return `Uso:\n${rows.join('\n')}\n\n${HELP_GLOBAL}\n`;
}

function commandHelp(c: Command): string {
  return `Uso: ${c.usage}\n\n${c.summary.charAt(0).toUpperCase()}${c.summary.slice(1)}.\n${c.help}\n\n${HELP_GLOBAL}\n`;
}
