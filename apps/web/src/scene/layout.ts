// Layout «carta estelar»: el plan como una carta celeste leída de frente.
// Puro y determinista (nada de Math.random): mismo grafo + mismas opciones = mismas posiciones.
//
// Apaisado: cada etapa es una columna (una constelación) de izquierda a derecha.
// Retrato: se transpone; cada etapa es una fila de arriba abajo, con dos sub-filas en zigzag si tiene muchos nodos.
// Dentro de cada etapa los nodos se ordenan por baricentro de sus dependencias (menos cruces de aristas).

import type { SceneGraph } from './contract';

export type Orientation = 'landscape' | 'portrait';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface StageFrame {
  index: number;
  /** Centro de la constelación (columna o fila). */
  center: Vec3;
  /** Semiejes de la elipse punteada que la envuelve. */
  rx: number;
  ry: number;
  /** Ancla de la etiqueta de etapa: encima de la columna (apaisado) o encima de la fila (retrato). */
  header: Vec3;
  count: number;
}

export interface LayoutResult {
  orientation: Orientation;
  positions: Map<string, Vec3>;
  /** Etapa de cada nodo colocado. */
  stageOf: Map<string, number>;
  stages: StageFrame[];
  /** Separación usada entre etapas (paso de columna o de fila). */
  spread: number;
}

export interface LayoutOptions {
  orientation: Orientation;
  /** Apaisado: paso de columna. Retrato: holgura extra entre etapas (el encuadre la usa para llenar el alto). */
  spread?: number;
  /** Paso entre nodos dentro de una etapa (vertical en apaisado, horizontal en retrato). */
  step?: number;
  /** Retrato: más de esto en una fila → dos sub-filas. */
  maxPerRow?: number;
}

export const LAYOUT_DEFAULTS = {
  landscape: { spread: 20, step: 6.2 },
  portrait: { spread: 0.6, step: 6 },
  maxPerRow: 4,
  /** Profundidad máxima (±) para el paralaje. */
  depth: 1.4,
} as const;

/** Hash FNV-1a → [0, 1). Determinista por id. */
export function hash01(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

const signed = (id: string, salt: number) => hash01(id, salt) * 2 - 1;

/** Rango dentro de su etapa: 0 si no depende de nadie de su misma etapa; si no, 1 + máx de esas dependencias. */
export function intraStageRanks(graph: SceneGraph): Map<string, number> {
  const stageOf = new Map(graph.nodes.map((n) => [n.id, n.stage]));
  const preds = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!stageOf.has(e.from) || !stageOf.has(e.to)) continue;
    if (stageOf.get(e.from) !== stageOf.get(e.to)) continue;
    const l = preds.get(e.to) ?? [];
    l.push(e.from);
    preds.set(e.to, l);
  }
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const known = rank.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // ciclo: no debería pasar en un DAG; no colgamos
    visiting.add(id);
    let r = 0;
    for (const p of preds.get(id) ?? []) r = Math.max(r, visit(p) + 1);
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  for (const n of graph.nodes) visit(n.id);
  return rank;
}

/** Orden de los nodos de cada etapa por baricentro (barridos ida y vuelta). Devuelve listas de ids por etapa. */
export function orderByBarycenter(graph: SceneGraph): string[][] {
  const S = Math.max(graph.stages.length, ...graph.nodes.map((n) => n.stage + 1), 0);
  const byStage: string[][] = Array.from({ length: S }, () => []);
  const valid = new Set<string>();
  for (const n of graph.nodes) {
    if (n.stage < 0) continue;
    byStage[n.stage]!.push(n.id);
    valid.add(n.id);
  }
  // orden inicial por id: el resultado no depende del orden en que llegan nodos y aristas
  for (const l of byStage) l.sort();
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!valid.has(e.from) || !valid.has(e.to)) continue;
    (preds.get(e.to) ?? preds.set(e.to, []).get(e.to)!).push(e.from);
    (succs.get(e.from) ?? succs.set(e.from, []).get(e.from)!).push(e.to);
  }
  // posición normalizada de cada nodo dentro de su etapa (centrada en 0)
  const pos = new Map<string, number>();
  const assign = (list: string[]) => list.forEach((id, i) => pos.set(id, i - (list.length - 1) / 2));
  byStage.forEach(assign);

  const mean = (ids: string[] | undefined) => {
    if (!ids) return undefined;
    const v = ids.map((i) => pos.get(i)).filter((x): x is number => x !== undefined);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
  };
  const sortStage = (s: number, nb: Map<string, string[]>) => {
    const list = byStage[s]!;
    const key = new Map<string, number>();
    // dos pasadas: la segunda deja que los dependientes de la misma etapa vean la clave de sus dependencias
    for (let pass = 0; pass < 2; pass++) {
      for (const id of list) key.set(id, mean(nb.get(id)) ?? pos.get(id)!);
      for (const id of list) pos.set(id, key.get(id)!);
    }
    const tie = (id: string) => hash01(id, 7) * 1e-3;
    list.sort((a, b) => key.get(a)! + tie(a) - (key.get(b)! + tie(b)));
    assign(list);
  };
  for (let sweep = 0; sweep < 3; sweep++) {
    for (let s = 0; s < S; s++) sortStage(s, preds);
    for (let s = S - 1; s >= 0; s--) sortStage(s, succs);
  }
  for (let s = 0; s < S; s++) sortStage(s, preds);
  return byStage;
}

/** Métricas de las etiquetas en unidades de mundo, para apilar sin pisarse. */
export interface LabelMetrics {
  /** Del centro del nodo al borde inferior de su etiqueta. */
  below: (id: string) => number;
  /** Del ancla del encabezado de etapa a su borde superior. */
  headerAbove: number;
  /** Radio visible del nodo. */
  halo: number;
  /** Colchón mínimo entre piezas (≈ 6 px a la escala real). */
  pad: number;
}

const DEFAULT_METRICS: LabelMetrics = { below: () => 2.4, headerAbove: 1.4, halo: 0.6, pad: 0.35 };

export function layoutGraph(graph: SceneGraph, opts: LayoutOptions & { metrics?: LabelMetrics }): LayoutResult {
  const o = opts.orientation;
  const D = LAYOUT_DEFAULTS[o];
  const spread = opts.spread ?? D.spread;
  const step = opts.step ?? D.step;
  const maxPerRow = opts.maxPerRow ?? LAYOUT_DEFAULTS.maxPerRow;
  const M = opts.metrics ?? DEFAULT_METRICS;
  const order = orderByBarycenter(graph);
  const ranks = intraStageRanks(graph);
  const S = order.length;
  const positions = new Map<string, Vec3>();
  const stageOf = new Map<string, number>();
  const stages: StageFrame[] = [];
  const depth = LAYOUT_DEFAULTS.depth;
  const pad = step * 0.08;
  let cursor = 0; // retrato: y del ancla del encabezado de la etapa en curso

  for (let s = 0; s < S; s++) {
    const list = order[s]!;
    for (const id of list) stageOf.set(id, s);
    const n = list.length;
    const maxRank = Math.max(0, ...list.map((id) => ranks.get(id) ?? 0));

    if (o === 'landscape') {
      const along = (s - (S - 1) / 2) * spread;
      const sub = step * 0.62; // separación entre sub-columnas (dependencias dentro de la etapa)
      let minX = Infinity, maxX = -Infinity, maxY = -Infinity, bottom = Infinity;
      list.forEach((id, i) => {
        const r = ranks.get(id) ?? 0;
        const x = along + (r - maxRank / 2) * sub + signed(id, 1) * step * 0.16;
        const y = -(i - (n - 1) / 2) * step + signed(id, 2) * step * 0.05;
        positions.set(id, { x, y, z: signed(id, 3) * depth });
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        bottom = Math.min(bottom, y - M.below(id));
      });
      if (!n) {
        minX = maxX = along;
        maxY = 0;
        bottom = 0;
      }
      const top = maxY + M.halo + pad * 2;
      stages.push({
        index: s,
        center: { x: (minX + maxX) / 2, y: (top + bottom) / 2, z: 0 },
        rx: Math.max(step * 0.6, (maxX - minX) / 2 + step * 0.48),
        ry: (top - bottom) / 2 + pad * 2,
        header: { x: (minX + maxX) / 2, y: top + pad * 4, z: 0 },
        count: n,
      });
    } else {
      // retrato: filas apiladas por su altura real; en una fila partida, dependencias arriba y dependientes abajo
      const split = n > maxPerRow;
      const sorted = split ? [...list].sort((p, q) => (ranks.get(p) ?? 0) - (ranks.get(q) ?? 0) || list.indexOf(p) - list.indexOf(q)) : list;
      const perRow = split ? Math.ceil(n / Math.ceil(n / maxPerRow)) : Math.max(1, n);
      const rows: string[][] = [];
      for (let i = 0; i < sorted.length; i += perRow) rows.push(sorted.slice(i, i + perRow));
      for (const r of rows) r.sort((p, q) => list.indexOf(p) - list.indexOf(q)); // izquierda→derecha por baricentro
      // franja propia del rótulo: ancla `header`; su texto queda encima. La elipse empieza un colchón más abajo.
      const header = cursor;
      const ringTop = header - M.pad * 1.5;
      let y = ringTop - M.pad * 0.5 - M.halo;
      let bottom = y;
      rows.forEach((row, ri) => {
        let lowest = 0;
        row.forEach((id, i) => {
          const x = (i - (row.length - 1) / 2) * step + signed(id, 1) * step * 0.04;
          positions.set(id, { x, y: y + signed(id, 2) * step * 0.015, z: signed(id, 3) * depth * 0.4 });
          lowest = Math.max(lowest, M.below(id));
        });
        bottom = y - lowest;
        if (ri < rows.length - 1) y = bottom - M.pad - M.halo;
      });
      const widest = Math.max(1, ...rows.map((r) => r.length));
      const ringBottom = bottom - M.pad * 0.5;
      stages.push({
        index: s,
        center: { x: 0, y: (ringTop + ringBottom) / 2, z: 0 },
        rx: ((widest - 1) / 2) * step + step * 0.5,
        ry: (ringTop - ringBottom) / 2,
        header: { x: 0, y: header, z: 0 },
        count: n,
      });
      // el rótulo siguiente empieza dos colchones bajo la elipse: nada pisa su franja
      cursor = ringBottom - M.pad * 2 - M.headerAbove - spread;
    }
  }
  if (o === 'portrait' && stages.length) {
    const top = stages[0]!.header.y + M.headerAbove;
    const bottom = Math.min(...stages.map((st) => st.center.y - st.ry));
    const shift = -(top + bottom) / 2;
    for (const p of positions.values()) p.y += shift;
    for (const st of stages) {
      st.center.y += shift;
      st.header.y += shift;
    }
  }
  return { orientation: o, positions, stageOf, stages, spread };
}

export const orientationFor = (width: number, height: number): Orientation =>
  height > 0 && width / height < 0.8 ? 'portrait' : 'landscape';
