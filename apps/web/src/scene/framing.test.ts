import { describe, expect, it } from 'vitest';
import type { SafeArea } from './contract';
import {
  estimateSizer,
  fitItems,
  overviewAngles,
  overviewItems,
  placeCamera,
  projectPx,
  safeRect,
  scratchCamera,
  solveOverview,
  type Viewport,
} from './framing';
import { labGraph } from './lab-graph';
import { orientationFor } from './layout';

const g = labGraph();

// SafeArea como la mide la interfaz: borde del HUD + 12 px; en móvil los botones bajan a ~70 px.
const CASES: { name: string; vp: Viewport; safe: SafeArea }[] = [
  { name: '1440×900', vp: { width: 1440, height: 900 }, safe: { top: 104, right: 20, bottom: 92, left: 20 } },
  { name: '390×844', vp: { width: 390, height: 844 }, safe: { top: 124, right: 16, bottom: 90, left: 16 } },
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
