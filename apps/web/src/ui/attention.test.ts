import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marketplaceSnapshot } from '../data/fixture';
import { reduce } from '../data/reduce';
import type { Blocker, DagEvent } from '../data/types';
import {
  AMBER,
  BASE_FAVICON,
  BASE_FAVICON_HREF,
  alertFaviconSvg,
  faviconHref,
  isLooking,
  newlyOpened,
  noticeBody,
  noticeTitle,
  notifyPermission,
  requestNotifyPermission,
  showAttention,
  showNotice,
  tabTitle,
} from './attention';
import { setLang } from '../i18n';

// estos tests leen la interfaz en español; jsdom diría en-US (#73)
beforeEach(() => setLang('es'));

/** Un `Notification` de mentira que registra lo que se le pide. */
function fakeNotification(permission: NotificationPermission, ask: NotificationPermission = 'granted') {
  const shown: Array<{ title: string; options?: NotificationOptions; closed: boolean; onclick: ((e: Event) => void) | null }> = [];
  class FakeNotification {
    static permission: NotificationPermission = permission;
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = ask;
      return ask;
    });
    onclick: ((e: Event) => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      const rec = { title, options, closed: false, onclick: null as ((e: Event) => void) | null };
      shown.push(rec);
      Object.defineProperty(this, 'onclick', { set: (fn) => (rec.onclick = fn), get: () => rec.onclick });
      this.close = () => void (rec.closed = true);
    }
    close: () => void = () => {};
  }
  return { FakeNotification, shown };
}

afterEach(() => vi.unstubAllGlobals());

describe('título de la pestaña', () => {
  it('lleva la cuenta solo cuando algo te espera', () => {
    expect(tabTitle(0)).toBe('Dagyard');
    expect(tabTitle(1)).toBe('(1) Dagyard');
    expect(tabTitle(3)).toBe('(3) Dagyard');
  });
});

describe('favicon', () => {
  it('el de base es el mismo de public/favicon.svg', () => {
    const file = // vitest corre con la raíz en apps/web
    readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8').trim();
    expect(BASE_FAVICON).toBe(file);
  });

  it('con algo esperando lleva un punto ámbar; sin nada vuelve al normal', () => {
    expect(alertFaviconSvg()).toContain(AMBER);
    expect(alertFaviconSvg().startsWith(BASE_FAVICON.replace('</svg>', ''))).toBe(true);
    expect(decodeURIComponent(faviconHref(2))).toBe(`data:image/svg+xml,${alertFaviconSvg()}`);
    expect(faviconHref(0)).toBe(BASE_FAVICON_HREF);
  });

  it('showAttention cambia título y favicon del documento, y los devuelve a su sitio', () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />';
    document.title = 'Dagyard';
    showAttention(document, 2);
    const link = () => document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!;
    expect(document.title).toBe('(2) Dagyard');
    expect(decodeURIComponent(link().getAttribute('href')!)).toContain(AMBER);
    expect(document.querySelectorAll('link[rel~="icon"]')).toHaveLength(1);
    showAttention(document, 0);
    expect(document.title).toBe('Dagyard');
    expect(link().getAttribute('href')).toBe('/favicon.svg');
  });

  it('si la página no tiene favicon, lo crea', () => {
    document.head.innerHTML = '';
    showAttention(document, 1);
    expect(document.querySelector('link[rel~="icon"]')?.getAttribute('href')).toMatch(/^data:image\/svg\+xml,/);
  });
});

describe('pedido nuevo', () => {
  const snap = marketplaceSnapshot(0, 'es');
  const fresh: Blocker = { id: 'b_nuevo', nodeId: 'whatsapp', kind: 'review', question: '¿Va?', options: ['Aprobar', 'Pedir cambios'] };
  const ev = (blocker: Blocker): DagEvent => ({ seq: snap.seq + 1, type: 'blocker.opened', blocker });

  it('solo cuenta un blocker.opened de un bloqueante que no estaba', () => {
    const e = ev(fresh);
    const got = newlyOpened(snap, reduce(snap, e), e);
    expect(got?.blocker.id).toBe('b_nuevo');
    expect(got?.node.title).toBe('Avisos por WhatsApp');
  });

  it('un bloqueante que ya estaba en el snapshot no es nuevo', () => {
    const old = snap.blockers.find((b) => !b.resolvedAt)!;
    const e = ev(old);
    expect(newlyOpened(snap, reduce(snap, e), e)).toBeNull();
  });

  it('otros eventos, tareas que no existen o pedidos ya resueltos no avisan', () => {
    const msg: DagEvent = { seq: snap.seq + 1, type: 'message.posted', message: { id: 'm_x', nodeId: 'pagos', from: 'Agente', text: 'Hola', at: '' } };
    expect(newlyOpened(snap, reduce(snap, msg), msg)).toBeNull();
    const ghost = ev({ ...fresh, nodeId: 'no-existe' });
    expect(newlyOpened(snap, reduce(snap, ghost), ghost)).toBeNull();
    const done = ev({ ...fresh, resolvedAt: '2026-10-04T00:00:00.000Z', resolution: 'Aprobado' });
    expect(newlyOpened(snap, reduce(snap, done), done)).toBeNull();
  });
});

describe('¿la estás mirando?', () => {
  it('solo con la pestaña al frente y la ventana con foco', () => {
    const doc = (hidden: boolean, focused: boolean) => ({ hidden, hasFocus: () => focused }) as unknown as Document;
    expect(isLooking(doc(false, true))).toBe(true);
    expect(isLooking(doc(true, true))).toBe(false);
    expect(isLooking(doc(false, false))).toBe(false);
    expect(isLooking(doc(true, false))).toBe(false);
  });
});

describe('aviso del navegador', () => {
  const notice = { blockerId: 'b_1', nodeId: 'comision', taskTitle: 'Modelo de comisiones', kind: 'decision' as const, projectName: 'Marketplace de reservas' };

  it('sin la API del navegador no hace nada', () => {
    vi.stubGlobal('Notification', undefined);
    expect(notifyPermission()).toBe('unsupported');
    expect(showNotice(notice, () => {})).toBeNull();
  });

  it('sin permiso no muestra nada; el permiso se pide solo cuando lo llamas', async () => {
    const { FakeNotification, shown } = fakeNotification('default');
    vi.stubGlobal('Notification', FakeNotification);
    expect(notifyPermission()).toBe('default');
    expect(showNotice(notice, () => {})).toBeNull();
    expect(shown).toHaveLength(0);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    await expect(requestNotifyPermission()).resolves.toBe('granted');
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('con permiso: «Te espera: <tarea>», etiquetado con el bloqueante, y su clic abre la ficha', () => {
    const { FakeNotification, shown } = fakeNotification('granted');
    vi.stubGlobal('Notification', FakeNotification);
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const opened: string[] = [];
    expect(showNotice(notice, (id) => opened.push(id))).not.toBeNull();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe('Te espera: Modelo de comisiones');
    expect(shown[0]!.title).toBe(noticeTitle('Modelo de comisiones'));
    expect(shown[0]!.options?.tag).toBe('b_1');
    expect(shown[0]!.options?.body).toBe(noticeBody(notice));
    expect(shown[0]!.options?.body).toBe('Necesita tu decisión · Marketplace de reservas');
    shown[0]!.onclick!(new Event('click'));
    expect(focus).toHaveBeenCalled();
    expect(opened).toEqual(['comision']);
    expect(shown[0]!.closed).toBe(true);
  });

  it('si el navegador rechaza crear el aviso (Android sin service worker), no se cae', () => {
    class Throws {
      static permission = 'granted';
      constructor() {
        throw new TypeError('Illegal constructor');
      }
    }
    vi.stubGlobal('Notification', Throws);
    expect(showNotice(notice, () => {})).toBeNull();
  });
});
