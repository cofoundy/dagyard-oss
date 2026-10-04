// Todo lo que lee el PM, en un solo lugar: español peruano, tuteo, sin jerga (D10).

import type { BlockerKind, NodeStatus } from '../data/types';

export const STATUS_TEXT: Record<NodeStatus, string> = {
  done: 'Lista',
  working: 'En progreso',
  blocked: 'Te espera',
  pending: 'Pendiente',
};

/** Clase visual por estado (los tokens del preview). */
export const STATUS_CLASS: Record<NodeStatus, 'done' | 'working' | 'blocked' | 'queued'> = {
  done: 'done',
  working: 'working',
  blocked: 'blocked',
  pending: 'queued',
};

export const BLOCK_TEXT: Record<BlockerKind, string> = {
  decision: 'Necesita tu decisión',
  review: 'Necesita tu revisión',
  access: 'Necesita un acceso',
};

/** Para avisos: «Modelo de comisiones necesita tu decisión». */
export const BLOCK_TOAST: Record<BlockerKind, string> = {
  decision: 'necesita tu decisión',
  review: 'necesita tu revisión',
  access: 'necesita un acceso',
};

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

export function listas(done: number, total: number): string {
  return total ? `${done} de ${total} ${total === 1 ? 'lista' : 'listas'}` : 'Sin tareas';
}

export function waitingText(n: number): string {
  if (!n) return 'Nada te espera';
  return `${n} ${n === 1 ? 'te espera' : 'te esperan'}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];

/** «hace un momento», «hace 5 min», «hace 2 h», «ayer», «3 oct». */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 172_800) return 'ayer';
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Nombre del dueño de una tarea: «Equipo de Diseño». */
export function teamName(team: string | undefined): string | undefined {
  if (!team) return undefined;
  return /^equipo\b/i.test(team) ? team : `Equipo de ${team}`;
}

export const COPY = {
  entryTitle: 'Tu fábrica, en un cielo',
  entryLead: 'Pega tu clave de acceso para ver tus proyectos.',
  entryLabel: 'Clave de acceso',
  entryPlaceholder: 'Pega tu clave',
  entryCta: 'Entrar',
  entryChecking: 'Entrando…',
  entryBad: 'Esa clave no sirve. Revisa que la hayas copiado completa.',
  entryEmpty: 'Falta la clave.',
  entryExpired: 'Tu sesión venció. Vuelve a pegar tu clave.',
  entryOffline: 'No pude conectarme. Revisa tu internet e intenta de nuevo.',
  entryFine: 'La clave no se guarda en este navegador: entras una vez y te recuerda.',
  overview: 'Vista general',
  loading: 'Cargando el plan…',
  loadError: 'No pude cargar el plan.',
  retry: 'Reintentar',
  noProjects: 'Todavía no hay proyectos. Cuando la fábrica cree uno, aparece aquí.',
  reconnecting: 'Reconectando…',
  projectsTitle: 'Tus proyectos',
  logout: 'Salir',
  demoNote: 'Proyecto de ejemplo · sin servidor',
  close: 'Cerrar',
  needs: 'Necesita',
  unlocks: 'Cuando esté lista, arranca',
  notStarted: 'Todavía no empieza. Arranca sola cuando esté listo lo que necesita.',
  waitsYou: 'espera tu respuesta',
  report: 'Informe en Basalt',
  open: 'Abrir',
  yourAnswers: 'Tus respuestas',
  messages: 'Lo que te escribieron',
  sending: 'Enviando…',
  send: 'Enviar',
  cancel: 'Cancelar',
  approve: 'Aprobar',
  requestChanges: 'Pedir cambios',
  changesLabel: '¿Qué hay que cambiar?',
  changesPlaceholder: 'Escríbelo en corto; le llega al equipo tal cual.',
  sendChanges: 'Enviar cambios',
  unlock: 'Desbloquear',
  accessPlaceholder: 'Pega el valor',
  accessMissing: 'Falta el valor',
  accessFine: 'Se guarda cifrado y solo lo recibe el equipo que lo pidió. No vuelve a mostrarse aquí.',
  sendError: 'No se pudo enviar. Revisa tu conexión e intenta de nuevo.',
  alreadyResolved: 'Alguien ya lo resolvió. Te muestro lo último.',
  teamContinues: 'el equipo sigue',
  isDone: 'está lista',
  started: 'arrancó',
  added: 'se agregó al plan',
  removed: 'salió del plan',
} as const;
