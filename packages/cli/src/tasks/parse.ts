/**
 * Parser tolerante de una tarea del orchestrator (`.cofoundy/tasks/*.md`).
 *
 * Formatos medidos (2026-10-04): front matter YAML con `deps:` o `blockedBy:`; un bloque ```yaml
 * arriba del cuerpo; y metadata en la cabecera del cuerpo como `- **status:** ready`,
 * `` - `blockedBy: []` ``, `status: ready` o `**Role owner:** x · **blockedBy:** L1 (…), L2 (…)`.
 * La cabecera es todo lo que hay antes del primer `## `.
 */
import type { NodeStatus } from '@dagyard/model';
import { LIMITS } from '@dagyard/model';

export interface ParsedTask {
  /** nombre del archivo, p. ej. `T-314-A.md` */
  file: string;
  /** id primario tal cual: `id:`, si no el prefijo del título (`L1`), si no el nombre de archivo */
  id: string;
  /** todos los nombres con que otra tarea puede referirse a esta */
  aliases: string[];
  /** título humano, sin ids `T-xxx` ni referencias `#123` (lo que dice el archivo; para la UI, `legibleTitle`) */
  title: string;
  /** primera frase de `**Issue:** #123 — …` en la cabecera: título de reserva si `title` no es título */
  summary: string | null;
  rawStatus: string | null;
  status: NodeStatus;
  /** el status pide algo a un humano (`blocked  # ESCALATION REQUIRED`): queda «Te espera» */
  needsHuman: boolean;
  /** texto crudo de `deps`, `blockedBy` y `status: blocked-by …`; se resuelve contra el directorio */
  depRefs: string[];
  phase: string | null;
  goal: string | null;
  team: string | null;
}

type Field = 'id' | 'title' | 'status' | 'deps' | 'phase' | 'goal' | 'team';

const KEY_TO_FIELD: Record<string, Field> = {
  id: 'id',
  title: 'title',
  status: 'status',
  deps: 'deps',
  depends: 'deps',
  depends_on: 'deps',
  dependson: 'deps',
  blockedby: 'deps',
  blocked_by: 'deps',
  phase: 'phase',
  goal: 'goal',
  role: 'team',
  role_owner: 'team',
  'role owner': 'team',
};

const KEY_ALTERNATION = 'id|title|status|deps|depends_on|dependsOn|depends|blockedBy|blocked_by|phase|goal|role_owner|Role owner|role';
/** `**key:**`, `**key**:`, `` `key: `` o `key:` */
const INLINE_KEY = new RegExp(
  `(\\*\\*|\`)?\\b(${KEY_ALTERNATION})\\b(\\*\\*)?[ \\t]*:(\\*\\*|\`)?[ \\t]*`,
  'gi',
);

/** Lo que marca el fin de un valor en una línea con varios campos. */
const SEGMENT_END = /\s+·\s+/;

export function parseTask(file: string, text: string): ParsedTask {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const fields: Partial<Record<Exclude<Field, 'deps'>, string>> = {};
  const depRefs: string[] = [];

  const put = (field: Field, value: string) => {
    if (field === 'deps') {
      const refs = depText(value);
      if (refs) depRefs.push(refs);
      return;
    }
    if (fields[field] === undefined && value.trim()) fields[field] = value.trim();
  };

  let bodyStart = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      parseFrontMatter(lines.slice(1, end), put);
      bodyStart = end + 1;
    }
  }

  let h1: string | null = null;
  let summary: string | null = null;
  let fence: string | null = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fenceMatch = /^\s*(```+|~~~+)\s*([\w-]*)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = (fenceMatch[2] ?? '').toLowerCase() || 'plain';
      else fence = null;
      continue;
    }
    if (fence !== null && fence !== 'yaml' && fence !== 'yml') continue;
    if (fence === null && /^#{2,}\s/.test(line)) break; // fin de la cabecera
    if (fence === null && h1 === null && /^#\s+\S/.test(line)) {
      h1 = line.replace(/^#\s+/, '').trim();
      continue;
    }
    if (fence === null && summary === null && ISSUE_LINE.test(line)) summary = issueSummary(lines, i);
    for (const [field, value] of inlineFields(line)) put(field, value);
  }

  const rawStatus = fields.status ? cleanValue(fields.status) : null;
  const statusWord = rawStatus ? (/[a-z][a-z_-]*/i.exec(rawStatus)?.[0] ?? '') : '';
  if (/^blocked[-_]by$/i.test(statusWord) && rawStatus) {
    const refs = depText(rawStatus.slice(rawStatus.toLowerCase().indexOf(statusWord.toLowerCase()) + statusWord.length));
    if (refs) depRefs.push(refs);
  }

  const stem = file.replace(/\.md$/i, '');
  const titleSource = fields.title ? unquote(cleanValue(fields.title)) : h1;
  const prefix = titleSource ? idPrefix(titleSource, stem) : null;
  const explicitId = fields.id ? unquote(cleanValue(fields.id)) : null;
  const id = explicitId || prefix?.id || stem;
  const aliases = unique([id, prefix?.id, stem, explicitId].filter((a): a is string => !!a));

  return {
    file,
    id,
    aliases,
    title: humanTitle(prefix ? prefix.rest : (titleSource ?? ''), stem),
    summary,
    rawStatus,
    status: normalizeStatus(statusWord),
    needsHuman: !!fields.status && NEEDS_HUMAN.test(fields.status),
    depRefs,
    phase: fields.phase ? unquote(cleanValue(fields.phase)) || null : null,
    goal: fields.goal ? oneLine(unquote(cleanValue(fields.goal)), LIMITS.goal) || null : null,
    team: fields.team
      ? oneLine(stripMarkdown(unquote(cleanValue(fields.team))).replace(/\s*\(.*$/, ''), LIMITS.name) || null
      : null,
  };
}

/** Solo claves de primer nivel; listas en bloque (`deps:\n  - T-1`) incluidas. */
function parseFrontMatter(lines: string[], put: (f: Field, v: string) => void): void {
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w -]*?)\s*:\s*(.*)$/.exec(lines[i] ?? '');
    if (!m) continue;
    const field = KEY_TO_FIELD[(m[1] ?? '').toLowerCase()];
    if (!field) continue;
    let value = m[2] ?? '';
    if (stripYamlComment(value).trim() === '') {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1] ?? '')) {
        items.push((lines[++i] ?? '').replace(/^\s+-\s+/, ''));
      }
      value = items.map((it) => stripYamlComment(it)).join(', ');
    }
    // el comentario del status se conserva: dice si espera a un humano
    put(field, field === 'status' ? value : stripYamlComment(value));
  }
}

/** Campos conocidos dentro de una línea de la cabecera del cuerpo. */
function inlineFields(line: string): Array<[Field, string]> {
  const out: Array<[Field, string]> = [];
  const matches = [...line.matchAll(INLINE_KEY)];
  const accepted = matches.filter((m) => {
    const before = line.slice(0, m.index);
    const marked = m[1] !== undefined;
    // al inicio de línea (con viñeta opcional), tras un separador `·`, o envuelta en ** / `
    return marked || /^\s*(?:[-*+]\s+)?$/.test(before) || /·\s*$/.test(before);
  });
  accepted.forEach((m, k) => {
    const key = (m[2] ?? '').toLowerCase();
    const field = KEY_TO_FIELD[key];
    if (!field) return;
    const start = (m.index ?? 0) + m[0].length;
    const nextStart = accepted[k + 1]?.index ?? line.length;
    let value = line.slice(start, nextStart);
    const seg = SEGMENT_END.exec(value);
    if (seg) value = value.slice(0, seg.index);
    out.push([field, value]);
  });
  return out;
}

/** `—`, `none`, `[]`… al inicio = sin dependencias, aunque siga texto libre. */
const EMPTY_DEPS = /^(?:—|–|-|~|\[\s*\]|none|null|n\/a|ninguna?|nada)(?=$|[\s(,.;:·*`])/i;

/** Texto de dependencias sin comentarios, sin markdown y sin lo que va entre paréntesis. */
function depText(raw: string): string {
  const v = stripMarkdown(stripYamlComment(raw)).replace(/^[\s*`:]+/, '').trim();
  if (!v || EMPTY_DEPS.test(v)) return '';
  let out = v;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/\([^()]*\)/g, ' ');
  }
  return out.trim();
}

function stripYamlComment(v: string): string {
  return v.replace(/(^|\s)#(\s.*)?$/, '').trimEnd();
}

/** Quita markdown y comentarios alrededor de un valor de metadata. */
function cleanValue(v: string): string {
  return stripYamlComment(v)
    .replace(/^[\s*`]+/, '')
    .replace(/[\s*`·→]+$/, '')
    .trim();
}

function unquote(v: string): string {
  const m = /^(["'])(.*)\1$/.exec(v.trim());
  return (m ? (m[2] ?? '') : v).trim();
}

/** `T-314-A — La rama…` → `{ id: 'T-314-A', rest: 'La rama…' }`. También `Task L1 — …`, `FIX-SEO · …`. */
function idPrefix(title: string, stem: string): { id: string; rest: string } | null {
  const m = /^(?:task\s+)?([A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*)\s*(?:—|–|·|:|-)\s+(.*)$/i.exec(title);
  if (!m) return null;
  const token = m[1] ?? '';
  const looksLikeId = /\d/.test(token) || token === token.toUpperCase() || token.toLowerCase() === stem.toLowerCase();
  return looksLikeId ? { id: token, rest: m[2] ?? '' } : null;
}

/** D10: nada de `T-402` ni `#123` en el título visible. */
export function humanTitle(raw: string, stem: string): string {
  let t = stripMarkdown(raw)
    .replace(/\(\s*#\d+[^)]*\)/g, ' ')
    .replace(/^\s*#\d+\b[:,]?/, ' ')
    .replace(/\bT-[A-Z0-9]+(?:-[A-Za-z0-9]+)*\b/g, ' ')
    .replace(/\s\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s—–·:,-]+|[\s—–·:,-]+$/g, '')
    .trim();
  if (!t) t = humanize(stem.replace(/^T-\w+-?/i, '') || stem);
  // mayúscula inicial solo si la primera palabra es prosa (no `sweep.sh`, `validateProtocol`)
  if (/^\p{Ll}+(?=[\s,:;]|$)/u.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);
  return oneLine(t, LIMITS.title);
}

const ISSUE_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|`)?issue(?:\*\*)?\s*:/i;
const CONTINUATION_STOP = /^\s*(?:$|[-*+]\s|#|>|```|~~~|\*\*[^*]+:\*\*|`?[A-Za-z_][\w ]*:\s)/;

/** `**Issue:** #665 — la resolución … es CONDICIONAL ⇒ queda …` (y sus líneas de continuación) → la primera cláusula. */
function issueSummary(lines: string[], i: number): string | null {
  const parts = [(lines[i] ?? '').replace(ISSUE_LINE, '')];
  for (let j = i + 1; j < lines.length && !CONTINUATION_STOP.test(lines[j] ?? ''); j++) parts.push(lines[j] ?? '');
  const text = stripMarkdown(parts.join(' '))
    .replace(/\*/g, '')
    .replace(/^\s*#\d+\b\s*(?:[—–:·-]\s*)?/, '')
    .split(/\s*(?:⇒|→|=>|:\s|;\s|\.\s|\.$|\s[—–]\s)/)[0]!
    .trim();
  return text || null;
}

/** Siglas reales: se quedan en mayúsculas. Lo demás en MAYÚSCULAS es énfasis y se baja. */
const ACRONYMS = new Set(
  (
    'MCP API CI CD PR XSS UI UX HTML CSS JSX TSX URL URI HTTP HTTPS OIDC SQL JSON YAML DAG PM SSO JWT CLI SDK ' +
    'DNS CSRF FTS AUC QA ID IA AI SEO CDN TTL RLS CTA DOM SVG PDF CSV TLS SSH AWS GCP DTO SPA SSR RSC ORM CRUD ' +
    'REST RPC WS KV DO LLM SLA KPI MVP OK ESM NPM UTC IP IDE OS GPU CPU RAM SMS OTP RAG'
  ).split(' '),
);

/** Carpetas de código: `lib/x/y` es una ruta aunque no tenga extensión. */
const CODE_DIRS = /^(?:\.?[\w-]*factory|lib|app|apps|src|test|tests|scripts|components|packages|docs|migrations|public|\.github|\.cofoundy)$/i;

/** Una ruta (`/workspace`, `lib/x.ts`, `cli/`) o una lista con barras (`mint/rotate`) dentro de un título. */
const PATH_TOKEN = /(?<![\w.@])(?:\.?\/)?[\w.@~*-]*\/[\w.@~*\/-]*/g;

function humanizePath(token: string): string {
  if (token.includes('//') || /^\/api\//i.test(token)) return '';
  const segs = token.split('/').filter(Boolean);
  if (!segs.length) return '';
  const isList =
    !token.startsWith('/') && !token.endsWith('/') && segs.length >= 2 && segs.every((x) => /^\p{L}+$/u.test(x)) && !CODE_DIRS.test(segs[0]!);
  if (!isList) return segs.at(-1)!;
  return segs.length === 2 ? `${segs[0]} y ${segs[1]}` : `${segs.slice(0, -1).join(', ')} y ${segs.at(-1)}`;
}

/** `.slice(1)`, `var()`, `x.y(a, b)` pegado al nombre: una llamada, no una nota. */
const CODE_CALL = /(?<=^|\s)\.?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\([^()]*\)/g;

/** `verify.sh` → `verify`, `r2.test.ts` → `r2`, `deploy.yml` → `deploy`: el PM no ve nombres de archivo. */
const CODE_FILE =
  /(?<![\w.-])([\w-]+?)(?:\.(?:test|spec|config|d|e2e))?\.(?:ts|tsx|js|jsx|mjs|cjs|sh|bash|py|ya?ml|json|sql|toml|mdx?|css|html|go|rs|rb)\b/g;

/** `REPO_ROOT` → `repo root`. */
const SCREAMING_SNAKE = /(?<![\w])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?![\w])/g;

/** `createTenant + personalTenantIdFor` → `create tenant + personal tenant id for`. Solo si el título es solo identificadores. */
const ONLY_IDENTIFIERS = /^[a-z][a-z0-9]*[A-Z]\w*(?:\s*[+,]\s*[a-z][a-z0-9]*[A-Z]\w*)*$/;

/** Prefijos de código al inicio: `SEC —`, `NAV-CORE —`, `P0.1`, `Phase-9`, `Migration 0015 —`. */
const LEADING_CODES: RegExp[] = [
  /^(?:phase|fase|wave|lane|stage)[-\s]?\d+[a-z]?\b\s*(?:[—–:·]\s*)?/i,
  /^(?:migration|migraci[oó]n)\s+\d+\b\s*(?:[—–:·]\s*)?/i,
  /^P\d+(?:\.\d+)*\b\s*(?:[—–:·]\s*)?/,
];
const LEADING_CAPS_CODE = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)\s*[—–:·]\s+/;

/** Archivo o ruta al inicio seguido de separador: `lib/x.ts — `, `.factory/lib/emit.sh: `, `bus.py cost: `, `sweep.sh + `. */
const LEADING_FILE = /^[^\s:—–]*(?:\/|\.[A-Za-z]{1,4}\b)[^\s:—–]*(?:\s+[\w-]+){0,2}?(?:\s*[—–:]\s+|\s+\+\s+)/;

function cleanTitle(raw: string): string {
  let t = stripMarkdown(raw).replace(/<([A-Za-z][\w.-]*)>/g, '$1').replace(/\s+/g, ' ').trim();

  for (let prev = ''; prev !== t; ) {
    prev = t;
    for (const re of LEADING_CODES) t = t.replace(re, '');
    const caps = LEADING_CAPS_CODE.exec(t);
    if (caps && !ACRONYMS.has(caps[1]!)) t = t.slice(caps[0].length);
    const file = LEADING_FILE.exec(t);
    if (file && t.slice(file[0].length).trim()) t = t.slice(file[0].length);
  }

  // llamadas de código: `.slice(1)` → `slice`, `var()` → `var`
  t = t.replace(CODE_CALL, '$1');
  // paréntesis de notas (`(KEYSTONE, …)`, `(opción B)`)
  for (let prev = ''; prev !== t; ) {
    prev = t;
    t = t.replace(/(^|\s)\([^()]*\)/g, '$1');
  }
  t = t
    .replace(/\s+(?:de|del|of|en|in)\s+#\d+\b/gi, '')
    .replace(/(^|\s)#\d+\b[:,]?/g, '$1')
    .replace(PATH_TOKEN, humanizePath)
    .replace(CODE_FILE, '$1')
    .replace(SCREAMING_SNAKE, (w) => w.toLowerCase().replace(/_+/g, ' '))
    .replace(/(?<![\p{L}\p{N}_])\p{Lu}{2,}(?![\p{L}\p{N}_])/gu, (w) => (ACRONYMS.has(w) ? w : w.toLowerCase()))
    .replace(/\s+([,;])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s—–·:,;+-]+|[\s—–·:,;+-]+$/g, '')
    .trim();

  if (ONLY_IDENTIFIERS.test(t)) t = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  // mayúscula inicial si la primera palabra es prosa (`cross-project`), no código (`r2.test.ts`, `agent_read_denied`)
  if (/^\p{Ll}+(?:-\p{Ll}+)*(?=[\s,:;]|$)/u.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

const NOT_A_TITLE = /^(?:role|rol|owner|lane)\s*:/i;

/**
 * D10 (#21): el título que ve un PM. Sin prefijos de ruta ni de código, sin rutas sueltas, sin
 * paréntesis de notas internas, sin MAYÚSCULAS enfáticas (las siglas se quedan). Si el título no
 * es título (`role: oracle`), se usa la primera frase del issue. Nunca vacío.
 */
export function legibleTitle(title: string, summary: string | null = null): string {
  let t = NOT_A_TITLE.test(title.trim()) ? '' : cleanTitle(title);
  if (!t && summary) t = cleanTitle(summary);
  if (!t) t = cleanTitle(title.replace(NOT_A_TITLE, ''));
  if (!t) t = title.trim() || 'Tarea';
  return oneLine(t, LIMITS.title);
}

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*|__/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

export function humanize(s: string): string {
  const t = s.replace(/[-_]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Una sola línea física, recortada con `…` si no entra. */
export function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

const NEEDS_HUMAN = /escalat|escalad|human|founder|decisi[oó]n|aprobaci[oó]n|approval/i;

const STATUS_WORDS: Record<NodeStatus, string[]> = {
  done: ['done', 'completed', 'complete', 'merged', 'shipped', 'closed', 'finished', 'resolved', 'delivered', 'lista', 'listo'],
  working: ['working', 'in-progress', 'in_progress', 'inprogress', 'progress', 'wip', 'active', 'doing', 'started', 'claimed', 'running', 'in-review', 'review'],
  blocked: ['blocked', 'blocked-by', 'blocked_by', 'waiting', 'escalated', 'on-hold', 'hold', 'stuck'],
  pending: ['pending', 'ready', 'todo', 'open', 'new', 'queued', 'planned', 'deferred', 'backlog', 'draft'],
};

/** `ready|blocked|done|completed|deferred|blocked-by …` → `pending|working|blocked|done`. */
export function normalizeStatus(word: string | null | undefined): NodeStatus {
  const w = (word ?? '').toLowerCase();
  for (const status of ['done', 'working', 'blocked', 'pending'] as const) {
    if (STATUS_WORDS[status].includes(w)) return status;
  }
  return 'pending';
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
