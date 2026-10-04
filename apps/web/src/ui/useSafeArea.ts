// Mide el HUD en el DOM y le dice a la escena qué parte de la pantalla queda libre para encuadrar.
// Arriba: la marca y los botones. Abajo: el carril de etapas (y la nota del ejemplo). La ficha no cuenta.

import { useLayoutEffect, type RefObject } from 'react';
import type { SafeArea } from '../scene/contract';

const GAP = 12;

export function measureSafeArea(top: Array<Element | null>, bottom: Array<Element | null>, vw: number, vh: number): SafeArea {
  let t = 0;
  for (const el of top) {
    const r = el?.getBoundingClientRect();
    if (r && r.height > 0) t = Math.max(t, r.bottom);
  }
  let b = 0;
  for (const el of bottom) {
    const r = el?.getBoundingClientRect();
    if (r && r.height > 0) b = Math.max(b, vh - r.top);
  }
  const gutter = vw <= 720 ? 16 : 20;
  return {
    top: Math.round(t ? t + GAP : 0),
    bottom: Math.round(b ? b + GAP : 0),
    left: gutter,
    right: gutter,
  };
}

export function sameArea(a: SafeArea | null, b: SafeArea): boolean {
  return !!a && a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

export function useSafeArea(
  top: Array<RefObject<Element | null>>,
  bottom: Array<RefObject<Element | null>>,
  onChange: (area: SafeArea) => void,
  deps: unknown[],
): void {
  useLayoutEffect(() => {
    let last: SafeArea | null = null;
    let raf = 0;
    const run = () => {
      raf = 0;
      const area = measureSafeArea(
        top.map((r) => r.current),
        bottom.map((r) => r.current),
        window.innerWidth,
        window.innerHeight,
      );
      if (sameArea(last, area)) return;
      last = area;
      onChange(area);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    run();
    window.addEventListener('resize', schedule);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    for (const r of [...top, ...bottom]) if (r.current) ro?.observe(r.current);
    // Las fuentes web cambian el alto del HUD cuando terminan de cargar.
    void document.fonts?.ready.then(schedule);
    return () => {
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
