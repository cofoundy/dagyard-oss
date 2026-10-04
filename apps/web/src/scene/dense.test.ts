// Densidad (#20, #30): un proyecto real con 88 tareas tiene que leerse. En un proyecto grande (más de 20 tareas) la
// vista general solo fija la etiqueta de lo que te espera o avanza, a lo sumo 12; lo pendiente y lo listo son estrellas
// tenues cuyo título aparece al pasar el mouse, al enfocar o al volar a su etapa. Con el fixture de Basalt (88 nodos,
// 63/17/6/2) y variantes con tareas activas: ninguna etiqueta fija pisa otra ni un rótulo de etapa y todo entra en el
// rectángulo seguro. La demo (20 tareas) se ve entera, como siempre.
import { describe, expect, it } from 'vitest';
import type { SafeArea, SceneGraph } from './contract';
import {
  LABEL,
  MAX_PINNED,
  clampSizer,
  declutter,
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

/** Basalt con `blocked` tareas que te esperan y `working` en progreso, repartidas por etapa (en ese orden). */
function withActive(g: SceneGraph, blocked: number, working: number): SceneGraph {
  const byStage = g.stages.map((_, i) => g.nodes.filter((n) => n.stage === i && n.status === 'pending'));
  const ids: string[] = [];
  for (let k = 0; ids.length < blocked + working && k < g.nodes.length * g.stages.length; k++) {
    const n = byStage[k % byStage.length]![Math.floor(k / byStage.length)];
    if (n) ids.push(n.id);
  }
  const b = new Set(ids.slice(0, blocked));
  const w = new Set(ids.slice(blocked));
  return { ...g, nodes: g.nodes.map((n) => ({ ...n, status: b.has(n.id) ? 'blocked' : w.has(n.id) ? 'working' : n.status })) };
}

const BASALT = basaltGraph();
const GRAPHS: { name: string; g: SceneGraph }[] = [
  { name: 'Basalt tal cual (nada activo)', g: BASALT },
  { name: 'Basalt con 3 que te esperan y 5 en progreso', g: withActive(BASALT, 3, 5) },
  { name: 'Basalt con 4 que te esperan y 30 en progreso', g: withActive(BASALT, 4, 30) },
];

const CASES: { name: string; vp: Viewport; safe: SafeArea }[] = [
  { name: '1440×900', vp: { width: 1440, height: 900 }, safe: { top: 104, right: 20, bottom: 92, left: 20 } },
  { name: '390×844', vp: { width: 390, height: 844 }, safe: { top: 124, right: 16, bottom: 90, left: 16 } },
  { name: '390×844 (HUD de la app)', vp: { width: 390, height: 844 }, safe: { top: 150, right: 16, bottom: 84, left: 16 } },
];

// #41: celulares angostos o con HUD alto. A 360×780 con un HUD de 170/96 la etapa III de Basalt activo quedaba muda.
const NARROW: { name: string; vp: Viewport; safe: SafeArea }[] = [
  { name: '360×780 (HUD alto)', vp: { width: 360, height: 780 }, safe: { top: 170, right: 16, bottom: 96, left: 16 } },
  { name: '430×932 (HUD 142/79)', vp: { width: 430, height: 932 }, safe: { top: 142, right: 16, bottom: 79, left: 16 } },
];

const MATRIX = GRAPHS.flatMap((g) => [...CASES, ...NARROW].map((c) => ({ ...g, ...c, label: `${g.name} a ${c.name}` })));

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const active = (g: SceneGraph) => new Set(g.nodes.filter((n) => n.status === 'blocked' || n.status === 'working').map((n) => n.id));

describe('el fixture es el de Basalt', () => {
  it('88 nodos en 4 etapas: 63/17/6/2', () => {
    expect(BASALT.nodes).toHaveLength(88);
    expect(BASALT.stages.map((_, i) => BASALT.nodes.filter((n) => n.stage === i).length)).toEqual([63, 17, 6, 2]);
  });
});

describe.each(MATRIX)('proyecto grande: $label', ({ label, g, vp, safe }) => {
  const full = estimateSizer(g, orientationFor(vp.width, vp.height) === 'portrait');
  const sol = solveOverview(g, vp, safe, full);
  // la vista general pinta los títulos recortados si la solución lo pide
  const sizer = clampSizer(full, sol.maxLines);
  const visible = sol.visible;
  const rect = safeRect(vp, safe);
  const cam = scratchCamera(vp);
  const status = new Map(g.nodes.map((n) => [n.id, n.status]));

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

  it(`solo lo que te espera o avanza lleva etiqueta fija, a lo sumo ${MAX_PINNED}`, () => {
    const act = active(g);
    console.info(`[densidad] ${label}: ${visible.size} etiquetas fijas de ${act.size} activas · ancho ${sol.labelWidth} px`);
    expect(sol.quiet).toBe(true);
    expect(visible.size).toBeLessThanOrEqual(MAX_PINNED);
    expect([...visible].filter((id) => !act.has(id))).toEqual([]);
  });

  it('todo lo que te espera tiene su etiqueta, y lo activo llena el cupo que cabe', () => {
    const act = active(g);
    const blocked = [...act].filter((id) => status.get(id) === 'blocked');
    expect(blocked.filter((id) => !visible.has(id))).toEqual([]);
    // a lo sumo una etiqueta activa queda fuera por choque (dos vecinas en la misma fila)
    expect(visible.size).toBeGreaterThanOrEqual(Math.min(MAX_PINNED, act.size) - 1);
  });

  it('cada etapa con algo activo muestra al menos un título', () => {
    const want = new Set([...active(g)].map((id) => sol.layout.stageOf.get(id)));
    const got = new Set([...visible].map((id) => sol.layout.stageOf.get(id)));
    expect([...want].filter((s) => !got.has(s))).toEqual([]);
  });

  it('ninguna etiqueta fija pisa otra ni un rótulo de etapa, en todos los ángulos de respiración', () => {
    const hits = new Set<string>();
    for (const a of overviewAngles()) {
      const { labels, headers } = boxesAt(a.theta, a.phi);
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) if (overlaps(labels[i]!, labels[j]!)) hits.add(`${labels[i]!.id}×${labels[j]!.id}`);
        for (const h of headers) if (overlaps(labels[i]!, h)) hits.add(`${labels[i]!.id}×${h.id}`);
      }
    }
    expect([...hits].slice(0, 12), `${hits.size} choques a ${label}`).toEqual([]);
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

  it('lo pendiente sin etiqueta sigue al alcance: sin el filtro de activas, su etapa muestra títulos', () => {
    // la escena revela con este mismo reparto al volar a una etapa (`stageLabels`), sin el filtro de la vista general
    const quiet = g.stages.map((_, i) => i).filter((i) => ![...visible].some((id) => sol.layout.stageOf.get(id) === i));
    for (const i of quiet) {
      const shown = declutter(g, sol.layout, sol.fit.cam, vp, sizer, sol.labelWidth, { onlyStage: i, angles: [overviewAngles()[0]!] });
      expect(shown.size, `etapa ${i}`).toBeGreaterThan(0);
    }
  });
});

describe.each(CASES)('guardrail: la demo de 20 nodos no cambia a $name', ({ vp, safe }) => {
  const demo = labGraph();
  const sol = solveOverview(demo, vp, safe, estimateSizer(demo, orientationFor(vp.width, vp.height) === 'portrait'));

  it('se ven las 20 etiquetas, sin recorte ni estrellas tenues', () => {
    expect(sol.visible.size).toBe(20);
    expect(sol.maxLines).toBeUndefined();
    expect(sol.quiet).toBeUndefined();
  });
});

describe.each(NARROW)('celular angosto: la demo de 20 nodos se ve entera a $name', ({ vp, safe }) => {
  const demo = labGraph();
  const sol = solveOverview(demo, vp, safe, estimateSizer(demo, true));

  it('se ven las 20 etiquetas, sin estrellas tenues (si el alto no da, recortadas a dos líneas)', () => {
    expect(sol.visible.size).toBe(20);
    expect(sol.quiet).toBeUndefined();
  });
});

// La app mide su HUD (top/bottom) y cae donde cae (#27): se barre el entorno a 390×844, y desde #41 también en los
// celulares angostos (360×780) y grandes (430×932).
const PHONE_SAFES: [number, number][] = [[110, 64], [124, 90], [126, 96], [134, 90], [142, 79], [150, 71], [150, 84], [158, 64], [170, 96]];
const PHONES: Viewport[] = [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
  { width: 430, height: 932 },
];

describe.each(PHONES)('robusto al safe area medido a $width×$height', (vp) => {
  const g = withActive(BASALT, 3, 5);
  const sizer = estimateSizer(g, true);
  const demo = labGraph();
  const demoSizer = estimateSizer(demo, true);

  it.each(PHONE_SAFES)('Basalt activo con top %i / bottom %i: lo que te espera, con etiqueta; ninguna etapa activa muda', (top, bottom) => {
    const sol = solveOverview(g, vp, { top, right: 16, bottom, left: 16 }, sizer);
    const act = active(g);
    const blocked = [...act].filter((id) => g.nodes.find((n) => n.id === id)!.status === 'blocked');
    expect(blocked.filter((id) => !sol.visible.has(id))).toEqual([]);
    const want = new Set([...act].map((id) => sol.layout.stageOf.get(id)));
    const got = new Set([...sol.visible].map((id) => sol.layout.stageOf.get(id)));
    expect([...want].filter((s) => !got.has(s))).toEqual([]);
    expect(sol.visible.size).toBeLessThanOrEqual(MAX_PINNED);
  });

  it.each(PHONE_SAFES)('demo con top %i / bottom %i: las 20 etiquetas', (top, bottom) => {
    expect(solveOverview(demo, vp, { top, right: 16, bottom, left: 16 }, demoSizer).visible.size).toBe(20);
  });
});

describe('el estimador mide como el DOM', () => {
  it('un título que parte en dos líneas ocupa todo el ancho máximo (`width: max-content` + `max-width`)', () => {
    const s = estimateSizer({ stages: [{ id: 'a', name: 'A' }], nodes: [{ id: 'n', stage: 0, title: 'Revisión de velocidad en celular', status: 'pending', progress: 0 }], edges: [] }, true);
    const wrapped = s.node('n', 100);
    expect(wrapped.h).toBeGreaterThan(15);
    expect(wrapped.w).toBe(100);
    expect(s.node('n', 400).w).toBeLessThan(400); // en una línea, solo lo que mide el texto
  });
});
