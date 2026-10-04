// Densidad (#20): un proyecto real con 63 tareas en una etapa tiene que leerse. Con el fixture de Basalt (88 nodos,
// 63/17/6/2): ninguna etiqueta visible pisa otra ni un rótulo de etapa, todo entra en el rectángulo seguro, cada etapa
// muestra al menos un título y se ve una buena parte de ellos (#27). Las que no caben se ocultan por prioridad y
// reaparecen al pedirlas.
import { describe, expect, it } from 'vitest';
import type { SafeArea } from './contract';
import {
  LABEL,
  clampSizer,
  estimateSizer,
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
import { basaltGraph } from './fixtures/basalt';
import { labGraph } from './lab-graph';
import { orientationFor } from './layout';

const g = basaltGraph();

// Umbral de títulos visibles (fracción de 88). 1440×900: la mayoría (medido 55 con este estimador, 61 con el DOM real).
// En el celular no caben todos: con títulos de 2 líneas el alto da para ~11 filas de etiquetas a 4 por fila (~36 de
// techo); medido 31 y 32, igual con el DOM real (antes de #27, 19 y 16), así que se exige el 30 % (27) con holgura.
const CASES: { name: string; vp: Viewport; safe: SafeArea; minShare: number }[] = [
  { name: '1440×900', vp: { width: 1440, height: 900 }, safe: { top: 104, right: 20, bottom: 92, left: 20 }, minShare: 0.5 },
  { name: '390×844', vp: { width: 390, height: 844 }, safe: { top: 124, right: 16, bottom: 90, left: 16 }, minShare: 0.3 },
  { name: '390×844 (HUD de la app)', vp: { width: 390, height: 844 }, safe: { top: 150, right: 16, bottom: 84, left: 16 }, minShare: 0.3 },
];

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('el fixture es el de Basalt', () => {
  it('88 nodos en 4 etapas: 63/17/6/2', () => {
    expect(g.nodes).toHaveLength(88);
    expect(g.stages.map((_, i) => g.nodes.filter((n) => n.stage === i).length)).toEqual([63, 17, 6, 2]);
  });
});

describe.each(CASES)('proyecto denso (88 nodos) a $name', ({ name, vp, safe, minShare }) => {
  const full = estimateSizer(g, orientationFor(vp.width, vp.height) === 'portrait');
  const sol = solveOverview(g, vp, safe, full);
  // la vista general pinta los títulos recortados si la solución lo pide
  const sizer = clampSizer(full, (sol as { maxLines?: number }).maxLines);
  // hasta que la escena sepa ocultar, todas las etiquetas se pintan
  const visible: Set<string> = (sol as { visible?: Set<string> }).visible ?? new Set(g.nodes.map((n) => n.id));
  const rect = safeRect(vp, safe);
  const cam = scratchCamera(vp);

  /** Cajas en px de pantalla (view offset aplicado), igual que las pinta labels.ts. */
  const boxesAt = (theta: number, phi: number) => {
    placeCamera(cam, { ...sol.fit.cam, theta, phi });
    const px = (p: { x: number; y: number; z: number }) => {
      const q = projectPx(cam, p, vp);
      return { x: q.x - sol.fit.cam.ox, y: q.y - sol.fit.cam.oy };
    };
    const labels = [...sol.layout.positions]
      .filter(([id]) => visible.has(id))
      .map(([id, p]) => {
        const a = px({ x: p.x, y: p.y - LABEL.drop, z: p.z });
        const s = sizer.node(id, sol.labelWidth);
        return { id, x0: a.x - s.w / 2, x1: a.x + s.w / 2, y0: a.y + LABEL.gap, y1: a.y + LABEL.gap + s.h };
      });
    const headers = sol.layout.stages.map((st) => {
      const a = px(st.header);
      const s = sizer.header(st.index);
      return { id: `etapa-${st.index}`, x0: a.x - s.w / 2, x1: a.x + s.w / 2, y0: a.y - LABEL.headerGap - s.h, y1: a.y - LABEL.headerGap };
    });
    return { labels, headers };
  };

  it('ninguna etiqueta visible pisa otra ni un rótulo de etapa, en todos los ángulos de respiración', () => {
    const hits = new Set<string>();
    for (const a of overviewAngles()) {
      const { labels, headers } = boxesAt(a.theta, a.phi);
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) if (overlaps(labels[i]!, labels[j]!)) hits.add(`${labels[i]!.id}×${labels[j]!.id}`);
        for (const h of headers) if (overlaps(labels[i]!, h)) hits.add(`${labels[i]!.id}×${h.id}`);
      }
    }
    expect([...hits].slice(0, 12), `${hits.size} choques a ${name}`).toEqual([]);
  });

  it('nodos, halos, etiquetas (también las ocultas) y rótulos entran en el rectángulo seguro', () => {
    const items = overviewItems(sol.layout, sizer, sol.labelWidth);
    const out: string[] = [];
    for (const a of overviewAngles()) {
      placeCamera(cam, { ...sol.fit.cam, theta: a.theta, phi: a.phi });
      for (const it of items) {
        const q = projectPx(cam, it.p, vp);
        expect(q.behind).toBe(false);
        const x0 = q.x - sol.fit.cam.ox + it.box.x0, x1 = q.x - sol.fit.cam.ox + it.box.x1;
        const y0 = q.y - sol.fit.cam.oy + it.box.y0, y1 = q.y - sol.fit.cam.oy + it.box.y1;
        if (x0 < rect.x0 - 0.5 || x1 > rect.x1 + 0.5 || y0 < rect.y0 - 0.5 || y1 > rect.y1 + 0.5) out.push(`${x0.toFixed(0)},${y0.toFixed(0)}`);
      }
    }
    expect(out.slice(0, 5)).toEqual([]);
  });

  it('cada etapa con tareas muestra al menos un título', () => {
    const per = g.stages.map((_, i) => [...visible].filter((id) => sol.layout.stageOf.get(id) === i).length);
    console.info(`[densidad] ${name}: ${visible.size} de ${g.nodes.length} etiquetas visibles (${per.join('/')}) · ancho ${sol.labelWidth} px`);
    per.forEach((n, i) => expect(n, `etapa ${i} sin títulos`).toBeGreaterThan(0));
  });

  it(`se ve al menos el ${minShare * 100} % de las etiquetas`, () => {
    expect(visible.size).toBeGreaterThanOrEqual(Math.ceil(g.nodes.length * minShare));
    if (minShare >= 0.5) expect(visible.size).toBeGreaterThan(g.nodes.length / 2);
  });
});

describe.each(CASES)('guardrail: la demo de 20 nodos no cambia a $name', ({ vp, safe }) => {
  const demo = labGraph();
  const sol = solveOverview(demo, vp, safe, estimateSizer(demo, orientationFor(vp.width, vp.height) === 'portrait'));

  it('se ven las 20 etiquetas, sin recorte', () => {
    expect(sol.visible.size).toBe(20);
    expect(sol.maxLines).toBeUndefined();
  });
});
