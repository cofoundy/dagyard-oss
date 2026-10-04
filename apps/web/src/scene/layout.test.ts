import { describe, expect, it } from 'vitest';
import type { SceneGraph } from './contract';
import { labGraph } from './lab-graph';
import { hash01, intraStageRanks, layoutGraph, orderByBarycenter, orientationFor } from './layout';

const g = labGraph();

function minNodeDistance(pos: Map<string, { x: number; y: number }>): number {
  const v = [...pos.values()];
  let m = Infinity;
  for (let i = 0; i < v.length; i++)
    for (let j = i + 1; j < v.length; j++) m = Math.min(m, Math.hypot(v[i]!.x - v[j]!.x, v[i]!.y - v[j]!.y));
  return m;
}

/** Cruces de aristas entre etapas consecutivas según el orden (métrica clásica de layout por capas). */
function crossings(graph: SceneGraph, order: string[][]): number {
  const idx = new Map<string, number>();
  order.forEach((l) => l.forEach((id, i) => idx.set(id, i)));
  const st = new Map(graph.nodes.map((n) => [n.id, n.stage]));
  const segs = graph.edges.filter((e) => st.get(e.to)! - st.get(e.from)! === 1);
  let c = 0;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i]!, b = segs[j]!;
      if (st.get(a.from) !== st.get(b.from)) continue;
      const d1 = idx.get(a.from)! - idx.get(b.from)!;
      const d2 = idx.get(a.to)! - idx.get(b.to)!;
      if (d1 * d2 < 0) c++;
    }
  return c;
}

describe('orientación', () => {
  it('retrato bajo 0,8 de aspecto', () => {
    expect(orientationFor(1440, 900)).toBe('landscape');
    expect(orientationFor(390, 844)).toBe('portrait');
    expect(orientationFor(800, 1000)).toBe('landscape');
    expect(orientationFor(700, 1000)).toBe('portrait');
  });
});

describe('layout apaisado (columnas)', () => {
  const L = layoutGraph(g, { orientation: 'landscape' });

  it('coloca los 20 nodos y una constelación por etapa', () => {
    expect(L.positions.size).toBe(20);
    expect(L.stages).toHaveLength(5);
    expect(L.stages.map((s) => s.count)).toEqual([3, 5, 6, 3, 3]);
  });

  it('las etapas son columnas equiespaciadas de izquierda a derecha', () => {
    const xs = L.stages.map((s) => s.index * L.spread);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(L.spread);
    // cada nodo queda dentro de la franja de su columna, y las columnas avanzan a la derecha
    const colX = (s: number) => (s - 2) * L.spread;
    for (const n of g.nodes) {
      const p = L.positions.get(n.id)!;
      expect(Math.abs(p.x - colX(n.stage))).toBeLessThan(L.spread / 2);
    }
    const meanX = L.stages.map((s) => s.center.x);
    for (let i = 1; i < meanX.length; i++) expect(meanX[i]).toBeGreaterThan(meanX[i - 1]!);
  });

  it('dentro de una columna los nodos se reparten en vertical con paso fijo', () => {
    for (const st of L.stages) {
      const ys = g.nodes.filter((n) => n.stage === st.index).map((n) => L.positions.get(n.id)!.y).sort((a, b) => b - a);
      for (let i = 1; i < ys.length; i++) expect(ys[i - 1]! - ys[i]!).toBeGreaterThan(5);
    }
  });

  it('sin solapes de nodos', () => {
    expect(minNodeDistance(L.positions)).toBeGreaterThan(4);
  });

  it('profundidad z pequeña (paralaje, no un muro)', () => {
    for (const p of L.positions.values()) expect(Math.abs(p.z)).toBeLessThanOrEqual(1.4);
  });
});

describe('layout retrato (filas)', () => {
  const L = layoutGraph(g, { orientation: 'portrait' });

  it('las etapas son filas de arriba abajo', () => {
    const cy = L.stages.map((s) => s.center.y);
    for (let i = 1; i < cy.length; i++) expect(cy[i]).toBeLessThan(cy[i - 1]!);
    for (const n of g.nodes) {
      const p = L.positions.get(n.id)!;
      const st = L.stages[n.stage]!;
      expect(Math.abs(p.y - st.center.y)).toBeLessThan(st.ry);
      expect(Math.abs(p.x - st.center.x)).toBeLessThan(st.rx);
    }
    // las filas no se encajan: el encabezado de cada etapa queda bajo el borde inferior de la anterior
    for (let i = 1; i < L.stages.length; i++) {
      const prev = L.stages[i - 1]!;
      expect(L.stages[i]!.header.y).toBeLessThan(prev.center.y - prev.ry);
    }
  });

  it('filas con más de 4 nodos se parten en dos sub-filas', () => {
    const rowYs = (s: number) => new Set(g.nodes.filter((n) => n.stage === s).map((n) => Math.round(L.positions.get(n.id)!.y)));
    expect(rowYs(2).size).toBeGreaterThanOrEqual(2); // 6 nodos
    const three = g.nodes.filter((n) => n.stage === 3).map((n) => L.positions.get(n.id)!.y);
    expect(Math.max(...three) - Math.min(...three)).toBeLessThan(1); // 3 nodos: una sola línea
  });

  it('sin solapes de nodos', () => {
    expect(minNodeDistance(L.positions)).toBeGreaterThan(2.9);
  });

  it('retrato denso: con `rowWidth`, una fila corta se reparte en todo el ancho y la elipse la envuelve', () => {
    const step = 6;
    const W = step * 8;
    const D = layoutGraph(g, { orientation: 'portrait', step, maxPerRow: 8, rowWidth: W });
    for (const st of D.stages) {
      const xs = g.nodes.filter((n) => n.stage === st.index).map((n) => D.positions.get(n.id)!.x);
      const span = Math.max(...xs) - Math.min(...xs);
      // n nodos a W/n: los extremos quedan a W·(n−1)/n (± vaivén), nunca apretados al paso fijo
      if (xs.length > 1) expect(span).toBeGreaterThan((W * (xs.length - 1)) / xs.length - step * 0.2);
      for (const x of xs) expect(Math.abs(x - st.center.x)).toBeLessThan(st.rx);
    }
    // sin la opción, el paso fijo de siempre
    const F = layoutGraph(g, { orientation: 'portrait', step, maxPerRow: 8 });
    const three = g.nodes.filter((n) => n.stage === 3).map((n) => F.positions.get(n.id)!.x);
    expect(Math.max(...three) - Math.min(...three)).toBeLessThan(step * 2.2);
  });
});

describe('determinismo y orden', () => {
  it('mismo grafo → mismas posiciones, incluso con nodos y aristas en otro orden', () => {
    const a = layoutGraph(g, { orientation: 'landscape' });
    const b = layoutGraph(g, { orientation: 'landscape' });
    expect([...a.positions]).toEqual([...b.positions]);
    const shuffled: SceneGraph = { ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
    const c = layoutGraph(shuffled, { orientation: 'landscape' });
    for (const [id, p] of a.positions) {
      expect(c.positions.get(id)!.x).toBeCloseTo(p.x, 6);
      expect(c.positions.get(id)!.y).toBeCloseTo(p.y, 6);
    }
  });

  it('el hash es estable y está en [0,1)', () => {
    expect(hash01('comision')).toBe(hash01('comision'));
    for (const s of ['a', 'b', 'perfil-d', '']) {
      expect(hash01(s)).toBeGreaterThanOrEqual(0);
      expect(hash01(s)).toBeLessThan(1);
    }
  });

  it('las dependencias dentro de una etapa abren una sub-columna', () => {
    const r = intraStageRanks(g);
    expect(r.get('usuario')).toBe(1);
    expect(r.get('entrevistas')).toBe(0);
    const L = layoutGraph(g, { orientation: 'landscape' });
    expect(L.positions.get('usuario')!.x).toBeGreaterThan(L.positions.get('entrevistas')!.x);
  });

  it('el baricentro reduce cruces frente al orden de entrada', () => {
    const naive: string[][] = g.stages.map((_, s) => g.nodes.filter((n) => n.stage === s).map((n) => n.id));
    expect(crossings(g, orderByBarycenter(g))).toBeLessThanOrEqual(crossings(g, naive));
  });

  it('grafo vacío y nodo suelto no rompen', () => {
    expect(layoutGraph({ stages: [], nodes: [], edges: [] }, { orientation: 'landscape' }).positions.size).toBe(0);
    const one = layoutGraph({ stages: [{ id: 's', name: 'Única' }], nodes: [{ id: 'x', stage: 0, title: 'X', status: 'pending', progress: 0 }], edges: [] }, { orientation: 'portrait' });
    expect(one.positions.get('x')).toBeDefined();
  });
});
