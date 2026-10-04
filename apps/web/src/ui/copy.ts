// Todo lo que lee el PM pasa por aquí, y aquí solo hay claves del catálogo (`../i18n/messages.ts`, #73).
// Cada texto se lee en el momento de pintar (getters), así un cambio de idioma se ve sin recargar.

import type { BlockerKind, NodeStatus } from '../data/types';
import { isDefaultReviewOptions } from '../data/adapter';
import { fmtRelative, t, type MessageKey } from '../i18n';

/** Un objeto cuyos campos leen su clave del catálogo en el idioma actual cada vez que se consultan. */
function fromCatalog<K extends string>(keys: Record<K, MessageKey>): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const [name, key] of Object.entries(keys) as Array<[K, MessageKey]>)
    Object.defineProperty(out, name, { get: () => t(key), enumerable: true });
  return out;
}

export const STATUS_TEXT = fromCatalog<NodeStatus>({
  done: 'status.done',
  working: 'status.working',
  blocked: 'status.blocked',
  pending: 'status.pending',
});

/** Clase visual por estado (los tokens del preview). */
export const STATUS_CLASS: Record<NodeStatus, 'done' | 'working' | 'blocked' | 'queued'> = {
  done: 'done',
  working: 'working',
  blocked: 'blocked',
  pending: 'queued',
};

export const BLOCK_TEXT = fromCatalog<BlockerKind>({
  decision: 'block.decision',
  review: 'block.review',
  access: 'block.access',
});

/** Para avisos: «Modelo de comisiones necesita tu decisión». */
export const BLOCK_TOAST = fromCatalog<BlockerKind>({
  decision: 'blockToast.decision',
  review: 'blockToast.review',
  access: 'blockToast.access',
});

/** El verbo de una respuesta tuya: «Decidiste», «Revisaste», «Entregaste un acceso». */
export const ANSWER_VERB = fromCatalog<BlockerKind>({
  decision: 'answer.decision',
  review: 'answer.review',
  access: 'answer.access',
});

const ROMAN: Array<[number, string]> = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** 0 → «I», 3 → «IV». */
export function roman(index: number): string {
  let n = index + 1;
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) ((out += s), (n -= v));
  return out;
}

export function stageLabel(index: number, name: string): string {
  return `${roman(index)} · ${name}`;
}

/** «3 de 5 listas» / «3 of 5 done»; sin tareas, «Sin tareas». */
export function listas(done: number, total: number): string {
  return t('count.done', { count: total, done, total });
}

/** «Nada te espera», «1 te espera», «2 te esperan». */
export function waitingText(n: number): string {
  return t('count.waiting', { count: n });
}

/** «hace un momento», «hace 5 min», «hace 2 h», «ayer», «3 oct» — en el idioma actual. */
export function ago(iso: string | undefined, now = Date.now()): string {
  return fmtRelative(iso, now);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Nombre del dueño de una tarea: «Equipo de Diseño» / «Design team». Si ya lo dice, tal cual. */
export function teamName(team: string | undefined): string | undefined {
  if (!team) return undefined;
  return /^equipo\b/i.test(team) || /\bteam$/i.test(team) ? team : t('team.name', { team });
}

/**
 * Los dos botones de una revisión. Si el pedido trae las opciones por defecto del servidor (o ninguna), se pintan en
 * el idioma de la interfaz; si el equipo escribió las suyas, van tal cual (lo que escribe un usuario no se traduce).
 */
export function reviewLabels(options: readonly string[]): [approve: string, changes: string] {
  const isDefault = !options.length || isDefaultReviewOptions(options);
  if (isDefault) return [COPY.approve, COPY.requestChanges];
  return [options[0] ?? COPY.approve, options[1] ?? COPY.requestChanges];
}

export const COPY = fromCatalog({
  entryTitle: 'entry.title',
  entryLead: 'entry.lead',
  entryLabel: 'entry.label',
  entryPlaceholder: 'entry.placeholder',
  entryCta: 'entry.cta',
  entryChecking: 'entry.checking',
  entryBad: 'entry.bad',
  entryEmpty: 'entry.empty',
  entryExpired: 'entry.expired',
  entryOffline: 'entry.offline',
  entryFine: 'entry.fine',
  langSwitch: 'lang.switch',
  overview: 'hud.overview',
  loading: 'hud.loading',
  loadError: 'hud.loadError',
  retry: 'hud.retry',
  noProjects: 'hud.noProjects',
  reconnecting: 'hud.reconnecting',
  projectsTitle: 'hud.projects',
  logout: 'hud.logout',
  demoNote: 'hud.demoNote',
  liveIn: 'hud.liveIn',
  stagesLabel: 'hud.stages',
  skyLabel: 'hud.sky',
  close: 'card.close',
  needs: 'card.needs',
  unlocks: 'card.unlocks',
  notStarted: 'card.notStarted',
  waitsYou: 'card.waitsYou',
  report: 'card.report',
  reportBasalt: 'card.reportBasalt',
  technical: 'card.technical',
  open: 'card.open',
  yourAnswers: 'card.yourAnswers',
  messages: 'card.messages',
  sending: 'card.sending',
  send: 'card.send',
  cancel: 'card.cancel',
  approve: 'card.approve',
  requestChanges: 'card.requestChanges',
  changesLabel: 'card.changesLabel',
  changesPlaceholder: 'card.changesPlaceholder',
  sendChanges: 'card.sendChanges',
  unlock: 'card.unlock',
  access: 'card.access',
  accessPlaceholder: 'card.accessPlaceholder',
  accessMissing: 'card.accessMissing',
  accessFine: 'card.accessFine',
  sendError: 'card.sendError',
  alreadyResolved: 'card.alreadyResolved',
  agent: 'answer.agent',
  teamContinues: 'toast.teamContinues',
  isDone: 'toast.isDone',
  started: 'toast.started',
  added: 'toast.added',
  removed: 'toast.removed',
  // avisos fuera de la pantalla (#47)
  noticeTitle: 'notice.title',
  notifyMe: 'notice.notifyMe',
  notifyMeHint: 'notice.notifyMeHint',
});

/** «Pedro respondió» / «Pedro answered». */
export function answeredBy(who: string): string {
  return t('answer.by', { who });
}

const BASALT_HOST = 'basalt.cofoundy.ai';

/** «Informe en Basalt» solo si el enlace vive en Basalt; un PR, un issue o una URL inválida dicen «Informe» (#59). */
export function reportLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return COPY.report;
  }
  return host === BASALT_HOST || host.endsWith(`.${BASALT_HOST}`) ? COPY.reportBasalt : COPY.report;
}
