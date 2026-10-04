import { describe, expect, it } from 'vitest';
import type { SafeArea } from './contract';
import {
  LABEL,
  clampSizer,
  estimateSizer,
  fitItems,
  overviewAngles,
  overviewItems,
  placeCamera,
  projectPx,
  safeRect,
  scratchCamera,
  solveOverview,
  type Box,
  type Viewport,
} from './framing';
import { labGraph } from './lab-graph';
import { orientationFor } from './layout';

const g = labGraph();

// SafeArea como la mide la interfaz: borde del HUD + 12 px; en móvil los botones bajan a ~70 px.
const CASES: { name: string; vp: Viewport; safe: SafeArea }[] = [
  { name: '1440×900', vp: { width: 1440, height: 900 }, safe: { top: 104, right: 20, bottom: 92, left: 20 } },
  { name: '390×844', vp: { width: 390, height: 844 }, safe: { top: 124, right: 16, bottom: 90, left: 16 } },
  // la app real en móvil: los botones bajan bajo la marca y el carril ocupa más
  { name: '390×844 (HUD de la app)', vp: { width: 390, height: 844 }, safe: { top: 150, right: 16, bottom: 84, left: 16 } },
  // el HUD real medido en #41: aquí la demo ya se veía entera y no debe empeorar
  { name: '390×844 (HUD 142/79)', vp: { width: 390, height: 844 }, safe: { top: 142, right: 16, bottom: 79, left: 16 } },
];

describe.each(CASES)('encuadre de la vista general a $name', ({ vp, safe }) => {
  const sizer = estimateSizer(g, orientationFor(vp.width, vp.height) === 'portrait');
  const sol = solveOverview(g, vp, safe, sizer);
  const items = overviewItems(sol.layout, sizer, sol.labelWidth);
  const rect = safeRect(vp, safe);

  it('proyecta cada nodo, halo y etiqueta dentro del rectángulo seguro, en todos los ángulos de respiración', () => {
    const cam = scratchCamera(vp);
    for (const a of overviewAngles()) {
      placeCamera(cam, { ...sol.fit.cam, theta: a.theta, phi: a.phi });
      for (const it of items) {
        const q = projectPx(cam, it.p, vp);
        expect(q.behind).toBe(false);
        const x0 = q.x - sol.fit.cam.ox + it.box.x0, x1 = q.x - sol.fit.cam.ox + it.box.x1;
        const y0 = q.y - sol.fit.cam.oy + it.box.y0, y1 = q.y - sol.fit.cam.oy + it.box.y1;
        expect(x0).toBeGreaterThanOrEqual(rect.x0 - 0.5);
        expect(x1).toBeLessThanOrEqual(rect.x1 + 0.5);
        expect(y0).toBeGreaterThanOrEqual(rect.y0 - 0.5);
        expect(y1).toBeLessThanOrEqual(rect.y1 + 0.5);
      }
    }
  });

  it('el cuadro se ve lleno: ≥85 % del rectángulo seguro en un eje y ≥70 % en el otro', () => {
    const f = sol.fit.fill;
    expect(Math.max(f.x, f.y)).toBeGreaterThan(0.95);
    expect(Math.min(f.x, f.y)).toBeGreaterThan(0.7);
  });

  it('centrado en el rectángulo seguro, no en la pantalla', () => {
    const b = sol.fit.box;
    expect((b.x0 + b.x1) / 2).toBeCloseTo((rect.x0 + rect.x1) / 2, 0);
    expect((b.y0 + b.y1) / 2).toBeCloseTo((rect.y0 + rect.y1) / 2, 0);
  });

  it('las etiquetas de nodo no se pisan entre sí', () => {
    const cam = scratchCamera(vp);
    placeCamera(cam, sol.fit.cam);
    const boxes = [...sol.layout.positions].map(([id, p]) => {
      const q = projectPx(cam, { x: p.x, y: p.y - 0.95, z: p.z }, vp);
      const s = sizer.node(id, sol.labelWidth);
      return { id, x0: q.x - s.w / 2, x1: q.x + s.w / 2, y0: q.y + 6, y1: q.y + 6 + s.h };
    });
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!, b = boxes[j]!;
        if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) hits.push(`${a.id}×${b.id}`);
      }
    expect(hits).toEqual([]);
  });
});

describe.each(CASES.filter((c) => c.vp.width < c.vp.height))('franja del rótulo de etapa en retrato a $name', ({ vp, safe }) => {
  const sizer = estimateSizer(g, true);
  const sol = solveOverview(g, vp, safe, sizer);
  const cam = scratchCamera(vp);
  placeCamera(cam, sol.fit.cam);
  const px = (p: { x: number; y: number; z: number }) => {
    const q = projectPx(cam, p, vp);
    return { x: q.x - sol.fit.cam.ox, y: q.y - sol.fit.cam.oy };
  };
  const headers = sol.layout.stages.map((st) => {
    const a = px(st.header);
    const s = sizer.header(st.index);
    return { i: st.index, x0: a.x - s.w / 2, x1: a.x + s.w / 2, y0: a.y - 6 - s.h, y1: a.y - 6 };
  });
  const labels = [...sol.layout.positions].map(([id, p]) => {
    const a = px({ x: p.x, y: p.y - 0.72, z: p.z });
    const s = sizer.node(id, sol.labelWidth);
    return { id, x0: a.x - s.w / 2, x1: a.x + s.w / 2, y0: a.y + 5, y1: a.y + 5 + s.h };
  });

  it('ninguna etiqueta de nodo pisa un rótulo de etapa', () => {
    const hits: string[] = [];
    for (const h of headers)
      for (const l of labels) if (h.x0 < l.x1 && l.x0 < h.x1 && h.y0 < l.y1 && l.y0 < h.y1) hits.push(`${h.i}×${l.id}`);
    expect(hits).toEqual([]);
  });

  it('las elipses quedan fuera de la franja del rótulo (con colchón)', () => {
    sol.layout.stages.forEach((st, i) => {
      const top = px({ x: st.center.x, y: st.center.y + st.ry, z: st.center.z }).y;
      expect(top).toBeGreaterThan(headers[i]!.y1 + 4); // su propia elipse empieza bajo el rótulo
      const prev = sol.layout.stages[i - 1];
      if (prev) expect(px({ x: prev.center.x, y: prev.center.y - prev.ry, z: prev.center.z }).y).toBeLessThan(headers[i]!.y0 - 4);
    });
  });

  it('las columnas llenan el ancho: etiquetas de al menos 100 px', () => {
    expect(sol.labelWidth).toBeGreaterThanOrEqual(100);
  });
});

// #41: en celulares angostos o con HUD alto se escondían títulos de la demo (19/20 a 430×932, 17/20 a 360×780).
// Ahí el retrato prueba respaldos (más aire entre vecinas, otra cantidad de columnas, títulos a dos líneas) hasta que
// todos se ven; donde la rejilla de siempre ya los mostraba, no cambia nada.
const NARROW: { name: string; vp: Viewport; safe: SafeArea }[] = [
  { name: '430×932 (HUD 142/79)', vp: { width: 430, height: 932 }, safe: { top: 142, right: 16, bottom: 79, left: 16 } },
  { name: '430×932 (HUD alto)', vp: { width: 430, height: 932 }, safe: { top: 170, right: 16, bottom: 96, left: 16 } },
  { name: '360×780 (HUD alto)', vp: { width: 360, height: 780 }, safe: { top: 170, right: 16, bottom: 96, left: 16 } },
  { name: '360×780 (HUD 142/79)', vp: { width: 360, height: 780 }, safe: { top: 142, right: 16, bottom: 79, left: 16 } },
];

describe.each(NARROW)('celular angosto: la demo se ve entera a $name', ({ vp, safe }) => {
  const full = estimateSizer(g, true);
  const sol = solveOverview(g, vp, safe, full);
  const sizer = clampSizer(full, sol.maxLines); // como la pinta la vista general
  const rect = safeRect(vp, safe);
  const cam = scratchCamera(vp);

  it('las 20 etiquetas a la vista', () => {
    expect(sol.visible.size).toBe(20);
  });

  it('nodos, halos, etiquetas y rótulos dentro del rectángulo seguro, en todos los ángulos', () => {
    const out: string[] = [];
    for (const a of overviewAngles()) {
      placeCamera(cam, { ...sol.fit.cam, theta: a.theta, phi: a.phi });
      for (const it of overviewItems(sol.layout, sizer, sol.labelWidth)) {
        const q = projectPx(cam, it.p, vp);
        const x0 = q.x - sol.fit.cam.ox + it.box.x0, x1 = q.x - sol.fit.cam.ox + it.box.x1;
        const y0 = q.y - sol.fit.cam.oy + it.box.y0, y1 = q.y - sol.fit.cam.oy + it.box.y1;
        if (q.behind || x0 < rect.x0 - 0.5 || x1 > rect.x1 + 0.5 || y0 < rect.y0 - 0.5 || y1 > rect.y1 + 0.5) out.push(`${x0.toFixed(0)},${y0.toFixed(0)}`);
      }
    }
    expect(out.slice(0, 5)).toEqual([]);
  });

  it('ninguna etiqueta pisa otra ni un rótulo de etapa, en todos los ángulos de respiración', () => {
    const hits = new Set<string>();
    for (const a of overviewAngles()) {
      placeCamera(cam, { ...sol.fit.cam, theta: a.theta, phi: a.phi });
      const labels = [...sol.layout.positions].map(([id, p]) => {
        const q = projectPx(cam, { x: p.x, y: p.y - LABEL.drop, z: p.z }, vp);
        const s = sizer.node(id, sol.labelWidth);
        return { id, x0: q.x - s.w / 2, x1: q.x + s.w / 2, y0: q.y + LABEL.gap, y1: q.y + LABEL.gap + s.h };
      });
      const heads = sol.layout.stages.map((st) => {
        const q = projectPx(cam, st.header, vp);
        const s = sizer.header(st.index);
        return { id: `etapa-${st.index}`, x0: q.x - s.w / 2, x1: q.x + s.w / 2, y0: q.y - LABEL.headerGap - s.h, y1: q.y - LABEL.headerGap };
      });
      const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) if (hit(labels[i]!, labels[j]!)) hits.add(`${labels[i]!.id}×${labels[j]!.id}`);
        for (const h of heads) if (hit(labels[i]!, h)) hits.add(`${labels[i]!.id}×${h.id}`);
      }
    }
    expect([...hits]).toEqual([]);
  });
});

describe('celular angosto: los respaldos no tocan lo que ya se veía bien', () => {
  it.each(CASES)('a $name, la rejilla de siempre: títulos completos', ({ vp, safe }) => {
    const sol = solveOverview(g, vp, safe, estimateSizer(g, orientationFor(vp.width, vp.height) === 'portrait'));
    expect(sol.visible.size).toBe(20);
    expect(sol.maxLines).toBeUndefined();
  });

  it('a 390×844 con el HUD de la app, el mismo ancho de etiqueta que antes de #41 (100 px) y a 1440×900 (171 px)', () => {
    const [desk, , , phone] = CASES;
    expect(solveOverview(g, phone!.vp, phone!.safe, estimateSizer(g, true)).labelWidth).toBe(100);
    expect(solveOverview(g, desk!.vp, desk!.safe, estimateSizer(g)).labelWidth).toBe(171);
  });
});

describe('encuadre genérico', () => {
  it('sin items no revienta', () => {
    const f = fitItems([], { width: 800, height: 600 }, { top: 0, right: 0, bottom: 0, left: 0 }, { x: 0, y: 0, z: 0 }, overviewAngles());
    expect(Number.isFinite(f.cam.r)).toBe(true);
  });

  it('un SafeArea más grande arriba baja el centro del encuadre', () => {
    const vp = { width: 1440, height: 900 };
    const s = estimateSizer(g);
    const a = solveOverview(g, vp, { top: 20, right: 20, bottom: 20, left: 20 }, s);
    const b = solveOverview(g, vp, { top: 300, right: 20, bottom: 20, left: 20 }, s);
    expect((b.fit.box.y0 + b.fit.box.y1) / 2).toBeGreaterThan((a.fit.box.y0 + a.fit.box.y1) / 2 + 100);
  });
});
