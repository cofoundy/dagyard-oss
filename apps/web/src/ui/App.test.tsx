import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateSkyOptions } from '../scene/contract';
import { FixtureApi } from '../data/fixture';
import { measureSafeArea } from './useSafeArea';
import { App } from './App';

// La escena es de otro carril: aquí se reemplaza por un doble que registra lo que la interfaz le pide.
const scene = vi.hoisted(() => ({ opts: null as CreateSkyOptions | null, calls: [] as Array<[string, unknown[]]> }));
vi.mock('../scene', () => ({
  createSky: (o: CreateSkyOptions) => {
    scene.opts = o;
    const rec =
      (name: string) =>
      (...args: unknown[]) =>
        void scene.calls.push([name, args]);
    return {
      setGraph: rec('setGraph'),
      pulse: rec('pulse'),
      overview: rec('overview'),
      flyStage: rec('flyStage'),
      focus: rec('focus'),
      setSafeArea: rec('setSafeArea'),
      dispose: rec('dispose'),
    };
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const P = 'marketplace-reservas';
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  scene.opts = null;
  scene.calls = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function settle(times = 4) {
  for (let i = 0; i < times; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0)));
}

async function until(cond: () => boolean, label: string) {
  for (let i = 0; i < 50; i++) {
    if (cond()) return;
    await settle(1);
  }
  throw new Error(`No se cumplió: ${label}\n${host.textContent}`);
}

const text = () => host.textContent ?? '';
const pick = (id: string | null) => act(() => scene.opts!.handlers.onPick(id));
const buttons = () => [...host.querySelectorAll('button')];
const button = (label: string | RegExp) => {
  const b = buttons().find((x) => (typeof label === 'string' ? x.textContent?.trim() === label : label.test(x.textContent ?? '')));
  if (!b) throw new Error(`No hay botón «${label}»`);
  return b;
};
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Todo lo que un PM puede leer: texto y atributos legibles. */
function readable(): string {
  const attrs = [...host.querySelectorAll('[aria-label],[placeholder],[title]')].flatMap((el) =>
    ['aria-label', 'placeholder', 'title'].map((a) => el.getAttribute(a) ?? ''),
  );
  return `${text()} ${attrs.join(' ')}`;
}

async function mountIn() {
  const api = new FixtureApi({ storage: null });
  await api.login('clave-de-prueba');
  act(() => root.render(<App api={api} demo />));
  await until(() => text().includes('Descubrimiento') && !!scene.opts, 'carga el plan');
  return api;
}

describe('interfaz', () => {
  it('pinta el HUD, el carril y le pasa el grafo y el SafeArea a la escena', async () => {
    await mountIn();
    expect(text()).toContain('Marketplace de reservas');
    expect(text()).toContain('5 de 20 listas');
    expect(text()).toContain('3 te esperan');
    expect(text()).toContain('II · Diseño');
    expect(text()).toContain('3 de 3 listas');
    const graphs = scene.calls.filter(([n]) => n === 'setGraph').map(([, a]) => a[0] as { nodes: unknown[] });
    expect(graphs.at(-1)?.nodes).toHaveLength(20);
    expect(scene.calls.some(([n]) => n === 'setSafeArea')).toBe(true);
  });

  it('ningún texto contiene ids ni estados técnicos, abriendo cada ficha y con avisos en vivo', async () => {
    const api = await mountIn();
    const snap = await api.getSnapshot(P);
    const ids = [...snap.nodes.map((n) => n.id), ...snap.blockers.map((b) => b.id), ...snap.messages.map((m) => m.id), snap.project.id];
    const seen: string[] = [readable()];
    for (const n of snap.nodes) {
      pick(n.id);
      await settle(1);
      expect(host.querySelector('.card.open h2')?.textContent).toBe(n.title);
      seen.push(readable());
    }
    // Avisos de lo que hace la fábrica (los mismos eventos que manda el servidor).
    act(() => {
      api.message(P, 'pagos-con-tarjeta', 'Ya conecté la pasarela. Falta probar un reembolso.');
      api.done(P, 'buscador-con-filtros');
      api.start(P, 'revision-de-velocidad');
      api.addNode(P, { id: 'recuperar-contrasena', title: 'Recuperar contraseña', stageId: 'construccion', deps: ['registro-e-inicio-de-sesion'] });
      api.block(P, 'avisos-por-whatsapp', 'review', '¿Te parece bien el texto del aviso?');
    });
    await settle(2);
    seen.push(readable());
    // Selector de proyecto abierto.
    click(host.querySelector('.proj')!);
    seen.push(readable());

    const all = seen.join('\n');
    for (const id of ids) expect(all, `aparece el id ${id}`).not.toContain(id);
    expect(all).not.toMatch(/\b(pending|working|blocked|done|queued|decision|review|access)\b/i);
    expect(all).not.toMatch(/\bT-\d+/);
    expect(all).not.toMatch(/\b[bm]_[a-z0-9]+/);
    expect(all).toContain('Equipo de Construcción');
    expect(all).toContain('Buscador con filtros');
  });

  it('resuelve los tres pedidos desde la ficha: decisión, revisión con cambios y acceso', async () => {
    await mountIn();

    pick('modelo-de-comisiones');
    await settle(1);
    expect(text()).toContain('Necesita tu decisión');
    click(button('Al proveedor (10 % por reserva)'));
    await until(() => text().includes('Decidiste'), 'decisión registrada');
    expect(text()).toContain('«Al proveedor (10 % por reserva)» · el equipo sigue');
    expect(host.querySelector('.card .chip')?.textContent).toBe('En progreso');

    pick('diseno-del-pago');
    await settle(1);
    expect(text()).toContain('Necesita tu revisión');
    click(button('Pedir cambios'));
    type(host.querySelector('.card textarea')!, 'Que el botón de pagar sea más visible');
    click(button('Enviar cambios'));
    await until(() => text().includes('Revisaste'), 'revisión registrada');
    expect(text()).toContain('Pediste cambios: Que el botón de pagar sea más visible');

    pick('pagos-con-tarjeta');
    await settle(1);
    expect(text()).toContain('Clave de la pasarela de pagos');
    click(button('Desbloquear'));
    expect(host.querySelector<HTMLInputElement>('.card input[type=password]')?.placeholder).toBe('Falta el valor');
    type(host.querySelector('.card input[type=password]')!, 'sk_live_no_se_muestra');
    click(button('Desbloquear'));
    await until(() => text().includes('Entregaste un acceso'), 'acceso registrado');
    expect(readable()).not.toContain('sk_live_no_se_muestra');

    expect(text()).toContain('Nada te espera');
    expect(scene.calls.some(([n, a]) => n === 'pulse' && a[0] === 'pagos-con-tarjeta' && a[1] === 'working')).toBe(true);
  });

  it('«te esperan» recorre lo que te toca y Escape vuelve a la vista general', async () => {
    await mountIn();
    click(button(/te esperan/));
    expect(scene.calls.filter(([n]) => n === 'focus').at(-1)?.[1][0]).toBe('modelo-de-comisiones');
    click(button(/te esperan/));
    expect(scene.calls.filter(([n]) => n === 'focus').at(-1)?.[1][0]).toBe('diseno-del-pago');
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(host.querySelector('.card.open')).toBeNull();
    expect(scene.calls.at(-1)?.[0]).toBe('overview');
    click(button(/^III · Construcción/));
    expect(scene.calls.at(-1)).toEqual(['flyStage', [2]]);
    expect(host.querySelector('.stage.sel')?.textContent).toContain('Construcción');
  });

  it('la entrada rechaza una clave mala y deja pasar una buena', async () => {
    const api = new FixtureApi({ storage: null });
    act(() => root.render(<App api={api} demo />));
    await until(() => !!host.querySelector('#clave'), 'muestra la entrada');
    type(host.querySelector('#clave')!, 'clave-mala');
    await act(async () => void host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await until(() => text().includes('Esa clave no sirve'), 'error de clave');
    type(host.querySelector('#clave')!, 'clave-buena');
    await act(async () => void host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await until(() => text().includes('Marketplace de reservas'), 'entra');
  });
});

describe('SafeArea', () => {
  const box = (top: number, bottom: number) => ({ getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) }) as unknown as Element;
  it('reserva arriba el HUD más alto y abajo el carril', () => {
    expect(measureSafeArea([box(18, 82), box(18, 52)], [box(840, 882)], 1440, 900)).toEqual({ top: 94, bottom: 72, left: 20, right: 20 });
    expect(measureSafeArea([box(18, 70), box(70, 108)], [box(790, 826), null], 390, 844)).toEqual({ top: 120, bottom: 66, left: 16, right: 16 });
  });
});
