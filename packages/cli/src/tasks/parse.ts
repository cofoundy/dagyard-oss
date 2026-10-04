/**
 * Parser tolerante de una tarea del orchestrator (`.cofoundy/tasks/*.md`).
 *
 * Formatos medidos (2026-10-04): front matter YAML con `deps:` o `blockedBy:`; un bloque ```yaml
 * arriba del cuerpo; y metadata en la cabecera del cuerpo como `- **status:** ready`,
 * `` - `blockedBy: []` ``, `status: ready` o `**Role owner:** x · **blockedBy:** L1 (…), L2 (…)`.
 * La cabecera es todo lo que hay antes del primer `## `.
 */
import type { NodeStatus } from '../model.js';
import { LIMITS } from '../model.js';

export interface ParsedTask {
  /** nombre del archivo, p. ej. `T-314-A.md` */
  file: string;
  /** id primario tal cual: `id:`, si no el prefijo del título (`L1`), si no el nombre de archivo */
  id: string;
  /** todos los nombres con que otra tarea puede referirse a esta */
  aliases: string[];
  /** título humano, sin ids `T-xxx` ni referencias `#123` */
  title: string;
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
