// Que la web te avise cuando algo te espera, aunque no la estés mirando (issue #47): la cuenta en el
// título de la pestaña, un punto ámbar en el favicon y, si das permiso, un aviso del navegador por cada
// pedido nuevo. Solo cuenta el proyecto que estás mirando (el tiempo real es por proyecto).

import type { DagEvent, Snapshot } from '../data/types';
import { lang } from '../i18n';
import { BLOCK_TEXT, COPY } from './copy';

export const APP_TITLE = 'Dagyard';

/** «(2) Dagyard» con dos pedidos abiertos; sin nada, «Dagyard». */
export function tabTitle(open: number): string {
  return open > 0 ? `(${open}) ${APP_TITLE}` : APP_TITLE;
}

/** El favicon de `public/favicon.svg`, tal cual (un test los mantiene iguales). */
export const BASE_FAVICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#04060a"/><circle cx="16" cy="16" r="3.2" fill="#f4eee2"/><path d="M16 5v22M5 16h22" stroke="#f4eee2" stroke-width="1" opacity=".55"/></svg>';
export const BASE_FAVICON_HREF = '/favicon.svg';
/** El ámbar de «te espera» (`--amber` en styles.css). */
export const AMBER = '#ffb547';

/** El mismo favicon con un punto ámbar arriba a la derecha, recortado del fondo con un aro del color del cielo. */
export function alertFaviconSvg(): string {
  const dot = `<circle cx="24.5" cy="7.5" r="7" fill="${AMBER}" stroke="#04060a" stroke-width="2"/>`;
  return BASE_FAVICON.replace('</svg>', `${dot}</svg>`);
}

export function faviconHref(open: number): string {
  return open > 0 ? `data:image/svg+xml,${encodeURIComponent(alertFaviconSvg())}` : BASE_FAVICON_HREF;
}

/** Pinta la cuenta en la pestaña: título y favicon. Idempotente: no toca el DOM si ya está así. */
export function showAttention(doc: Document, open: number): void {
  const title = tabTitle(open);
  if (doc.title !== title) doc.title = title;
  let link = doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.append(link);
  }
  const href = faviconHref(open);
  if (link.getAttribute('href') !== href) {
    link.setAttribute('href', href);
    link.type = 'image/svg+xml';
  }
}

/**
 * El pedido que este evento acaba de abrir, si es nuevo de verdad: un `blocker.opened` en vivo de un
 * bloqueante que el snapshot anterior no tenía. Los que ya estaban (al cargar o al volver a sincronizar)
 * no pasan por aquí: esos llegan en el snapshot, no como evento.
 */
export function newlyOpened(prev: Snapshot, next: Snapshot, e: DagEvent) {
  if (e.type !== 'blocker.opened') return null;
  if (e.blocker.resolvedAt) return null;
  if (prev.blockers.some((b) => b.id === e.blocker.id)) return null;
  const node = next.nodes.find((n) => n.id === e.blocker.nodeId);
  if (!node) return null;
  return { blocker: e.blocker, node };
}

/* ------------------------------------------------------------------ permiso del navegador */

export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied';

type NotificationCtor = typeof Notification;

function ctor(): NotificationCtor | null {
  const N = (globalThis as { Notification?: NotificationCtor }).Notification;
  return typeof N === 'function' ? N : null;
}

export function notifyPermission(): NotifyPermission {
  const N = ctor();
  if (!N) return 'unsupported';
  const p = N.permission;
  return p === 'granted' || p === 'denied' ? p : 'default';
}

/** Pide el permiso. Solo se llama desde el clic en «Avisarme», nunca al entrar. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  const N = ctor();
  if (!N) return 'unsupported';
  try {
    // Safari viejo solo acepta el callback; los demás devuelven una promesa.
    await new Promise<NotificationPermission>((resolve) => {
      const r = N.requestPermission(resolve);
      if (r && typeof r.then === 'function') void r.then(resolve, () => resolve(N.permission));
    });
  } catch {
    /* el navegador lo rechazó sin preguntar */
  }
  return notifyPermission();
}

export interface BlockerNotice {
  blockerId: string;
  nodeId: string;
  taskTitle: string;
  kind: keyof typeof BLOCK_TEXT;
  projectName: string;
}

/**
 * ¿Estás mirando la página? Pestaña al frente y ventana con el foco. Si la miras, ya tienes el aviso en
 * pantalla y la cuenta del HUD: un aviso del sistema encima sería ruido.
 */
export function isLooking(doc: Document): boolean {
  return !doc.hidden && doc.hasFocus();
}

/** Texto del aviso del navegador: «Te espera: Modelo de comisiones». */
export function noticeTitle(taskTitle: string): string {
  return `${COPY.noticeTitle}: ${taskTitle}`;
}

export function noticeBody(n: Pick<BlockerNotice, 'kind' | 'projectName'>): string {
  return n.projectName ? `${BLOCK_TEXT[n.kind]} · ${n.projectName}` : BLOCK_TEXT[n.kind];
}

/**
 * Muestra el aviso del navegador de un pedido. Un aviso por bloqueante: el `tag` es su id, así que el
 * navegador reemplaza en vez de apilar. Su clic trae la ventana al frente y abre la ficha. Sin permiso
 * (o si el navegador lo rechaza) devuelve `null` y no pasa nada.
 */
export function showNotice(n: BlockerNotice, onOpen: (nodeId: string) => void): Notification | null {
  const N = ctor();
  if (!N || notifyPermission() !== 'granted') return null;
  try {
    const notice = new N(noticeTitle(n.taskTitle), { body: noticeBody(n), tag: n.blockerId, lang: lang() });
    notice.onclick = (ev) => {
      ev.preventDefault?.();
      try {
        window.focus();
      } catch {
        /* algunos navegadores no dejan enfocar */
      }
      notice.close();
      onOpen(n.nodeId);
    };
    return notice;
  } catch {
    // Chrome en Android solo acepta avisos desde un service worker: ahí se queda la pestaña y el favicon.
    return null;
  }
}
