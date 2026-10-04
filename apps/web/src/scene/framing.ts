// Encuadre exacto: proyecta cada nodo, su halo y la caja de su etiqueta a píxeles y resuelve la distancia de la
// cámara por búsqueda binaria hasta que todo entra en el rectángulo seguro (viewport menos el HUD).
// El centro del encuadre es el centro del rectángulo seguro: se logra con camera.setViewOffset (traslación 2D pura).
// Solo usa matemática de three (sin WebGL), así que corre en tests.

import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { NodeStatus } from '../data/types';
import type { SafeArea, SceneGraph } from './contract';
import { layoutGraph, LAYOUT_DEFAULTS, orientationFor, type LabelMetrics, type LayoutResult, type Orientation, type Vec3 } from './layout';

export interface Viewport {
  width: number;
  height: number;
}

/** Estado de la cámara orbital + desplazamiento del centro óptico en píxeles. */
export interface CamState {
  tx: number;
  ty: number;
  tz: number;
  r: number;
  theta: number;
  phi: number;
  ox: number;
  oy: number;
}

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Un punto del mundo con una caja en píxeles relativa a su proyección (y hacia abajo). */
export interface FrameItem {
  p: Vec3;
  box: Box;
}

export interface Size {
  w: number;
  h: number;
}

export interface Sizer {
  /** Tamaño en px de la etiqueta del nodo con ese ancho máximo (y, si se da, recortada a ese número de líneas). */
  node(id: string, maxWidth: number, lines?: number): Size;
  /** Tamaño en px del encabezado de etapa (nombre + contador). */
  header(stage: number): Size;
}

/** Constantes compartidas entre el encuadre y el dibujo de etiquetas: lo que se mide es lo que se pinta. */
export const LABEL = {
  /** Caída en unidades de mundo desde el centro del nodo hasta el ancla de la etiqueta. */
  drop: 0.72,
  /** Separación en px entre el ancla y el borde superior de la etiqueta. */
  gap: 5,
  /** Separación en px entre el ancla del encabezado y su borde inferior. */
  headerGap: 6,
  /** Radio del halo visible del nodo (mundo) que también debe entrar. */
  halo: 0.5,
} as const;

/** Tilt de la vista general: cámara frontal, mirando un poco hacia abajo (~8°). */
export const OVERVIEW_PHI = Math.PI / 2 - MathUtils.degToRad(8);
/** Respiración máxima en theta (±) más el paralaje del puntero: el encuadre la absorbe. */
export const BREATH = MathUtils.degToRad(2.5);
export const PARALLAX = { theta: MathUtils.degToRad(1.5), phi: MathUtils.degToRad(1) };
export const FRAME_PAD = 6;

export const fovFor = (vp: Viewport) => (orientationFor(vp.width, vp.height) === 'portrait' ? 50 : 40);

const _v = new Vector3();

export function placeCamera(camera: PerspectiveCamera, s: CamState): void {
  const sp = Math.sin(s.phi);
  camera.position.set(s.tx + s.r * sp * Math.sin(s.theta), s.ty + s.r * Math.cos(s.phi), s.tz + s.r * sp * Math.cos(s.theta));
  camera.up.set(0, 1, 0);
  camera.lookAt(s.tx, s.ty, s.tz);
  camera.updateMatrixWorld(true);
}

/** Proyección a píxeles del viewport completo, sin view offset. `behind` si queda detrás de la cámara. */
export function projectPx(camera: PerspectiveCamera, p: Vec3, vp: Viewport): { x: number; y: number; behind: boolean } {
  _v.set(p.x, p.y, p.z).project(camera);
  return { x: (_v.x * 0.5 + 0.5) * vp.width, y: (-_v.y * 0.5 + 0.5) * vp.height, behind: _v.z > 1 || _v.z < -1 };
}

export function bboxPx(camera: PerspectiveCamera, items: FrameItem[], vp: Viewport): Box & { behind: boolean } {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, behind: false };
  for (const it of items) {
    const q = projectPx(camera, it.p, vp);
    if (q.behind) b.behind = true;
    b.x0 = Math.min(b.x0, q.x + it.box.x0);
    b.x1 = Math.max(b.x1, q.x + it.box.x1);
    b.y0 = Math.min(b.y0, q.y + it.box.y0);
    b.y1 = Math.max(b.y1, q.y + it.box.y1);
  }
  return b;
}

export function safeRect(vp: Viewport, safe: SafeArea): Box {
  return { x0: safe.left, x1: vp.width - safe.right, y0: safe.top, y1: vp.height - safe.bottom };
}

export function scratchCamera(vp: Viewport): PerspectiveCamera {
  const c = new PerspectiveCamera(fovFor(vp), vp.width / Math.max(1, vp.height), 0.1, 4000);
  c.updateProjectionMatrix();
  return c;
}

export interface FitResult {
  cam: CamState;
  /** Caja final (unión de todos los ángulos) en px de pantalla, ya con el view offset aplicado. */
  box: Box;
  /** Qué fracción del rectángulo seguro ocupa en cada eje. */
  fill: { x: number; y: number };
}

/**
 * Busca la distancia mínima a la que todos los items entran en el rectángulo seguro para TODOS los ángulos
 * dados (respiración y paralaje incluidos), y el view offset que centra la unión en el rectángulo seguro.
 */
export function fitItems(
  items: FrameItem[],
  vp: Viewport,
  safe: SafeArea,
  target: Vec3,
  angles: { theta: number; phi: number }[],
  opts: { pad?: number; rMin?: number; rMax?: number; camera?: PerspectiveCamera } = {},
): FitResult {
  const camera = opts.camera ?? scratchCamera(vp);
  const pad = opts.pad ?? FRAME_PAD;
  const rect = safeRect(vp, safe);
  const sw = Math.max(1, rect.x1 - rect.x0 - pad * 2);
  const sh = Math.max(1, rect.y1 - rect.y0 - pad * 2);
  const base = { tx: target.x, ty: target.y, tz: target.z, ox: 0, oy: 0 };

  const union = (r: number) => {
    const u = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, behind: false };
    for (const a of angles) {
      placeCamera(camera, { ...base, r, theta: a.theta, phi: a.phi });
      const b = bboxPx(camera, items, vp);
      u.x0 = Math.min(u.x0, b.x0);
      u.x1 = Math.max(u.x1, b.x1);
      u.y0 = Math.min(u.y0, b.y0);
      u.y1 = Math.max(u.y1, b.y1);
      u.behind ||= b.behind;
    }
    return u;
  };
  const fits = (r: number) => {
    const u = union(r);
    return !u.behind && u.x1 - u.x0 <= sw && u.y1 - u.y0 <= sh;
  };

  let lo = opts.rMin ?? 2;
  let hi = opts.rMax ?? 3000;
  if (!items.length) hi = lo = 60;
  else if (fits(lo)) hi = lo;
  else if (!fits(hi)) lo = hi; // ni de lejísimos entra (etiquetas más grandes que la pantalla): lo mejor posible
  else {
    for (let i = 0; i < 26 && hi - lo > 0.01; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
  }
  const r = hi;
  const u = items.length ? union(r) : { x0: vp.width / 2, x1: vp.width / 2, y0: vp.height / 2, y1: vp.height / 2 };
  const cx = (u.x0 + u.x1) / 2;
  const cy = (u.y0 + u.y1) / 2;
  const ox = cx - (rect.x0 + rect.x1) / 2;
  const oy = cy - (rect.y0 + rect.y1) / 2;
  const a0 = angles[0] ?? { theta: 0, phi: OVERVIEW_PHI };
  return {
    cam: { ...base, r, theta: a0.theta, phi: a0.phi, ox, oy },
    box: { x0: u.x0 - ox, x1: u.x1 - ox, y0: u.y0 - oy, y1: u.y1 - oy },
    fill: { x: (u.x1 - u.x0) / sw, y: (u.y1 - u.y0) / sh },
  };
}

/** Ángulos que el encuadre de la vista general debe tolerar: centro, extremos de respiración y paralaje. */
export function overviewAngles(): { theta: number; phi: number }[] {
  const t = BREATH + PARALLAX.theta;
  const p = PARALLAX.phi;
  return [
    { theta: 0, phi: OVERVIEW_PHI },
    { theta: t, phi: OVERVIEW_PHI - p },
    { theta: -t, phi: OVERVIEW_PHI - p },
    { theta: t, phi: OVERVIEW_PHI + p },
    { theta: -t, phi: OVERVIEW_PHI + p },
  ];
}

export function nodeLabelItem(p: Vec3, size: Size): FrameItem {
  return { p: { x: p.x, y: p.y - LABEL.drop, z: p.z }, box: { x0: -size.w / 2, x1: size.w / 2, y0: LABEL.gap, y1: LABEL.gap + size.h } };
}

export function headerItem(p: Vec3, size: Size): FrameItem {
  return { p, box: { x0: -size.w / 2, x1: size.w / 2, y0: -LABEL.headerGap - size.h, y1: -LABEL.headerGap } };
}

/** Todo lo que se ve en la vista general: nodos (con halo), etiquetas, encabezados y elipses. */
export function overviewItems(layout: LayoutResult, sizer: Sizer, maxLabelWidth: number, onlyStage?: number): FrameItem[] {
  const items: FrameItem[] = [];
  const zero: Box = { x0: 0, x1: 0, y0: 0, y1: 0 };
  const H = LABEL.halo;
  for (const st of layout.stages) {
    if (onlyStage !== undefined && st.index !== onlyStage) continue;
    const c = st.center;
    items.push(headerItem(st.header, sizer.header(st.index)));
    if (st.count) {
      for (const [dx, dy] of [[st.rx, 0], [-st.rx, 0], [0, st.ry], [0, -st.ry]] as const)
        items.push({ p: { x: c.x + dx, y: c.y + dy, z: c.z }, box: zero });
    }
  }
  for (const [id, p] of layout.positions) {
    if (onlyStage !== undefined && layout.stageOf.get(id) !== onlyStage) continue;
    for (const [dx, dy] of [[H, 0], [-H, 0], [0, H]] as const) items.push({ p: { x: p.x + dx, y: p.y + dy, z: p.z }, box: zero });
    items.push(nodeLabelItem(p, sizer.node(id, maxLabelWidth)));
  }
  return items;
}

export function contentCenter(layout: LayoutResult, onlyStage?: number): Vec3 {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z = 0, n = 0;
  for (const st of layout.stages) {
    if (onlyStage !== undefined && st.index !== onlyStage) continue;
    if (!st.count && onlyStage === undefined) continue;
    x0 = Math.min(x0, st.center.x - st.rx);
    x1 = Math.max(x1, st.center.x + st.rx);
    y0 = Math.min(y0, st.center.y - st.ry);
    y1 = Math.max(y1, st.header.y);
    z += st.center.z;
    n++;
  }
  if (!n) return { x: 0, y: 0, z: 0 };
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: z / n };
}

/** Píxeles por unidad de mundo cerca del centro del encuadre (para decidir el ancho de las etiquetas). */
export function pxPerUnit(cam: CamState, vp: Viewport): number {
  const c = scratchCamera(vp);
  placeCamera(c, cam);
  const a = projectPx(c, { x: cam.tx, y: cam.ty, z: cam.tz }, vp);
  const b = projectPx(c, { x: cam.tx + 1, y: cam.ty, z: cam.tz }, vp);
  return Math.abs(b.x - a.x);
}

/** Un sizer que mide las etiquetas recortadas a `lines` líneas (vista general densa). */
export function clampSizer(sizer: Sizer, lines: number | undefined): Sizer {
  if (!lines) return sizer;
  return { node: (id, maxWidth) => sizer.node(id, maxWidth, lines), header: (i) => sizer.header(i) };
}

export interface OverviewSolution {
  layout: LayoutResult;
  fit: FitResult;
  orientation: Orientation;
  /** Ancho máximo de las etiquetas de nodo (px) con el que se resolvió el encuadre. */
  labelWidth: number;
  /** Etiquetas que se ven en la vista general; las demás chocan y aparecen al pasar el mouse, enfocar o volar a su etapa. */
  visible: Set<string>;
  /** Vista general densa: los títulos se recortan a este número de líneas (completos al pasar el mouse o enfocar). */
  maxLines?: number;
}

/** Qué etiqueta gana cuando dos chocan: lo que espera al PM primero, lo terminado al final. */
export const LABEL_PRIORITY: Record<NodeStatus, number> = { blocked: 3, working: 2, pending: 1, done: 0 };

/**
 * Elige qué etiquetas de nodo se muestran sin pisarse: por prioridad (Te espera > En progreso > Pendiente > Lista),
 * luego la más baja primero (caben más) y luego el orden del layout. Cada caja es la unión de su proyección en todos
 * los ángulos dados, así que tampoco chocan con la respiración ni el paralaje. Los rótulos de etapa son obstáculos fijos.
 * Antes del reparto, cada etapa reserva su mejor título que quepa (si todos caben, el resultado es el mismo).
 */
export function declutter(
  graph: SceneGraph,
  layout: LayoutResult,
  cam: CamState,
  vp: Viewport,
  sizer: Sizer,
  labelWidth: number,
  opts: { onlyStage?: number; angles?: { theta: number; phi: number }[]; margin?: number } = {},
): Set<string> {
  const camera = scratchCamera(vp);
  const angles = opts.angles ?? overviewAngles();
  const m = opts.margin ?? 0;
  const status = new Map(graph.nodes.map((n) => [n.id, n.status]));
  const ids = [...layout.positions.keys()].filter((id) => opts.onlyStage === undefined || layout.stageOf.get(id) === opts.onlyStage);
  const stages = layout.stages.filter((st) => opts.onlyStage === undefined || st.index === opts.onlyStage);
  const empty = (): Box => ({ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
  const boxes = new Map(ids.map((id) => [id, empty()]));
  const heads = stages.map(empty);
  const grow = (b: Box, x0: number, x1: number, y0: number, y1: number) => {
    b.x0 = Math.min(b.x0, x0);
    b.x1 = Math.max(b.x1, x1);
    b.y0 = Math.min(b.y0, y0);
    b.y1 = Math.max(b.y1, y1);
  };
  for (const a of angles) {
    placeCamera(camera, { ...cam, theta: a.theta, phi: a.phi });
    for (const id of ids) {
      const p = layout.positions.get(id)!;
      const q = projectPx(camera, { x: p.x, y: p.y - LABEL.drop, z: p.z }, vp);
      const s = sizer.node(id, labelWidth);
      grow(boxes.get(id)!, q.x - s.w / 2, q.x + s.w / 2, q.y + LABEL.gap, q.y + LABEL.gap + s.h);
    }
    stages.forEach((st, i) => {
      const q = projectPx(camera, st.header, vp);
      const s = sizer.header(st.index);
      grow(heads[i]!, q.x - s.w / 2, q.x + s.w / 2, q.y - LABEL.headerGap - s.h, q.y - LABEL.headerGap);
    });
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  const h = (id: string) => boxes.get(id)!.y1 - boxes.get(id)!.y0;
  const ranked = [...ids].sort(
    (a, b) => LABEL_PRIORITY[status.get(b) ?? 'pending'] - LABEL_PRIORITY[status.get(a) ?? 'pending'] || h(a) - h(b) || order.get(a)! - order.get(b)!,
  );
  const taken: Box[] = heads.filter((b) => Number.isFinite(b.x0));
  const visible = new Set<string>();
  const take = (id: string) => {
    const b = boxes.get(id)!;
    if (taken.some((t) => b.x0 - m < t.x1 && t.x0 < b.x1 + m && b.y0 - m < t.y1 && t.y0 < b.y1 + m)) return false;
    taken.push(b);
    visible.add(id);
    return true;
  };
  // primero, el mejor título de cada etapa que quepa: ninguna etapa con tareas queda muda en la vista general
  for (const st of stages) for (const id of ranked) if (layout.stageOf.get(id) === st.index && take(id)) break;
  for (const id of ranked) if (!visible.has(id)) take(id);
  return visible;
}

const LABEL_WIDTH = { landscape: { min: 120, max: 200 }, portrait: { min: 80, max: 150 } } as const;

function solveSpread(
  graph: SceneGraph,
  vp: Viewport,
  safe: SafeArea,
  sizer: Sizer,
  o: Orientation,
  labelWidth: number,
  metrics: LabelMetrics,
  maxPerRow: number,
  stepOverride?: number,
  rowWidth?: number,
) {
  const D = LAYOUT_DEFAULTS[o];
  const step = stepOverride ?? D.step;
  const camera = scratchCamera(vp);
  const angles = overviewAngles();
  const run = (spread: number) => {
    const layout = layoutGraph(graph, { orientation: o, spread, step, maxPerRow, metrics, rowWidth });
    const fit = fitItems(overviewItems(layout, sizer, labelWidth), vp, safe, contentCenter(layout), angles, { camera });
    return { layout, fit };
  };
  if (graph.stages.length < 2) return run(D.spread);
  // apaisado: el paso de columna regula el ancho; retrato: la holgura entre filas regula el alto
  let lo = o === 'landscape' ? step * 1.7 : 0;
  let hi = o === 'landscape' ? step * 4.6 : step * 1.4;
  let best = run(lo);
  const wantMore = (s: ReturnType<typeof run>) => (o === 'landscape' ? s.fit.fill.x < s.fit.fill.y : s.fit.fill.y < s.fit.fill.x);
  if (!wantMore(best)) return best;
  const top = run(hi);
  if (wantMore(top)) return top;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const s = run(mid);
    if (wantMore(s)) {
      lo = mid;
      best = s;
    } else hi = mid;
  }
  return best;
}

/** Métricas de etiqueta en mundo para una escala supuesta `ppu` (px por unidad). */
function metricsFor(graph: SceneGraph, sizer: Sizer, ppu: number, labelWidth: number): LabelMetrics {
  const headH = Math.max(0, ...graph.stages.map((_, i) => sizer.header(i).h));
  const cache = new Map<string, number>();
  return {
    below: (id) => {
      let v = cache.get(id);
      if (v === undefined) cache.set(id, (v = LABEL.drop + (LABEL.gap + sizer.node(id, labelWidth).h + 2) / ppu));
      return v;
    },
    headerAbove: (LABEL.headerGap + headH + 2) / ppu,
    halo: LABEL.halo,
    pad: 6 / ppu,
  };
}

/** Más nodos que esto en una etapa = proyecto denso: rejilla elegida por cuántas etiquetas deja leer. */
export const DENSE_STAGE = 8;
/** Proyecto denso: líneas de título en la vista general (88 títulos largos no caben enteros a 1440×900). */
export const DENSE_LINES = 2;
/** Proyecto denso: aire mínimo en px entre dos etiquetas visibles. */
const DENSE_MARGIN = 3;
/** Retrato denso: columnas por fila que se prueban (a 390 px de ancho ganan 10–14: menos filas, más títulos). */
const DENSE_PORTRAIT_COLS = [3, 4, 5, 6, 8, 10, 12, 14];
/** Retrato denso: paso mínimo entre columnas en px, para que los nodos vecinos no se toquen. */
const DENSE_MIN_COL_PX = 24;

type BaseSolution = Omit<OverviewSolution, 'visible'>;

/** Etapas con tareas que muestran al menos un título. */
function stagesWithTitle(s: OverviewSolution): number {
  return new Set([...s.visible].map((id) => s.layout.stageOf.get(id))).size;
}

/** Proyecto denso: gana la rejilla que no deja etapas mudas y, entre esas, la que deja leer más títulos. */
function betterDense(a: OverviewSolution, b: OverviewSolution): boolean {
  const da = stagesWithTitle(a) - stagesWithTitle(b);
  return da !== 0 ? da > 0 : a.visible.size > b.visible.size;
}

/**
 * Resuelve la vista general completa: orientación, espaciado entre etapas que llena el cuadro, ancho de etiquetas
 * y cámara exacta. Las etiquetas miden en píxeles y el mundo en unidades, así que se supone una escala, se apila
 * con ella y se acepta solo si la escala resultante es al menos la supuesta (así nada se pisa). Si aun así dos
 * etiquetas chocan (proyectos densos), `visible` dice cuáles se muestran.
 */
export function solveOverview(graph: SceneGraph, vp: Viewport, safe: SafeArea, sizer: Sizer): OverviewSolution {
  const o = orientationFor(vp.width, vp.height);
  const counts = new Map<number, number>();
  for (const n of graph.nodes) counts.set(n.stage, (counts.get(n.stage) ?? 0) + 1);
  const maxN = Math.max(0, ...counts.values());
  const withVisible = (b: BaseSolution): OverviewSolution => ({ ...b, visible: declutter(graph, b.layout, b.fit.cam, vp, sizer, b.labelWidth) });

  if (o === 'landscape') {
    if (maxN > DENSE_STAGE) return solveDenseLandscape(graph, vp, safe, sizer, maxN);
    return withVisible(solveLandscape(graph, vp, safe, sizer));
  }
  // en pantallas angostas una fila de 4 deja etiquetas de 80 px: se parte desde 4
  const maxPerRow = vp.width - safe.left - safe.right < 480 ? 3 : LAYOUT_DEFAULTS.maxPerRow;
  if (maxN <= DENSE_STAGE) return withVisible(solvePortrait(graph, vp, safe, sizer, maxPerRow));
  // retrato denso: títulos recortados y filas que usan todo el ancho; cuantas más columnas, menos filas (el alto es
  // lo que falta), aunque las etiquetas vecinas se alternen. Gana la rejilla sin etapas mudas que deja leer más
  // etiquetas. Las 3 columnas se prueban siempre (pantallas angostísimas).
  const short = clampSizer(sizer, DENSE_LINES);
  const usable = vp.width - safe.left - safe.right - FRAME_PAD * 2;
  // De más a menos columnas: con menos, las filas crecen y el alto se aplasta; cuando los títulos visibles caen a menos
  // de la mitad del mejor, ya no remontan y se deja de probar.
  let best: OverviewSolution | null = null;
  for (const per of DENSE_PORTRAIT_COLS.filter((k) => k === 3 || usable / k >= DENSE_MIN_COL_PX).reverse()) {
    const b = solvePortrait(graph, vp, safe, short, per, true);
    const visible = declutter(graph, b.layout, b.fit.cam, vp, short, b.labelWidth, { margin: DENSE_MARGIN });
    const c = { ...b, visible, maxLines: DENSE_LINES };
    if (!best || betterDense(c, best)) best = c;
    else if (visible.size < best.visible.size / 2) break;
  }
  return best!;
}

function solvePortrait(graph: SceneGraph, vp: Viewport, safe: SafeArea, sizer: Sizer, maxPerRow: number, dense = false): BaseSolution {
  // Retrato: cada fila reparte su ancho en `maxPerRow` columnas fijas en píxeles, así el ancho de las
  // etiquetas no depende de la escala vertical (si dependiera, menos alto → etiquetas más angostas y altas
  // → todavía menos alto). El paso en mundo se deriva de la escala supuesta `p`.
  const o: Orientation = 'portrait';
  const W = LABEL_WIDTH[o];
  const usable = vp.width - safe.left - safe.right - FRAME_PAD * 2;
  const colPx = usable / maxPerRow;
  // aire entre vecinas: 15 px, que cubren el vaivén de las dos y la respiración (la caja real ocupa todo el ancho)
  const lw = Math.round(MathUtils.clamp(colPx - 15, W.min, W.max));
  // denso: la etiqueta es más ancha que la columna, así que el paso deja sitio a media etiqueta en cada extremo; si
  // no, la fila no entra a la escala supuesta y el encuadre la achica, aplastando el alto (todo se pisa)
  const pitchPx = dense && maxPerRow > 1 ? Math.min(colPx, (usable - lw) / (maxPerRow - 1)) : colPx;
  const attempt = (p: number) => {
    // denso: las filas cortas (etapas chicas, última fila) se reparten en todo el ancho
    const s = solveSpread(graph, vp, safe, sizer, o, lw, metricsFor(graph, sizer, p, lw), maxPerRow, pitchPx / p, dense ? (pitchPx * maxPerRow) / p : undefined);
    return { s, lw, ppu: pxPerUnit(s.fit.cam, vp) };
  };
  // consistente = la escala resultante alcanza la supuesta (entonces nada se pisa); si ninguna lo es (demasiados
  // nodos para el alto), al menos un encuadre que entre en el rectángulo seguro
  const fits = (a: ReturnType<typeof attempt>) => a.s.fit.fill.x <= 1.001 && a.s.fit.fill.y <= 1.001;
  const score = (p: number, a: ReturnType<typeof attempt>) => (fits(a) ? a.ppu / p : -1);
  let lo = 1;
  let hi = Math.max(4, vp.width / 4);
  let best = attempt(lo);
  let bestScore = score(lo, best);
  let found = bestScore >= 0.999;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const a = attempt(mid);
    const sc = score(mid, a);
    if (sc >= 0.999) {
      lo = mid;
      best = a;
      bestScore = sc;
      found = true;
    } else {
      hi = mid;
      if (!found && sc > bestScore) {
        best = a;
        bestScore = sc;
      }
    }
  }
  return { layout: best.s.layout, fit: best.s.fit, orientation: o, labelWidth: best.lw };
}

function solveLandscape(graph: SceneGraph, vp: Viewport, safe: SafeArea, sizer: Sizer): BaseSolution {
  const o: Orientation = 'landscape';
  const W = LABEL_WIDTH[o];
  const step = LAYOUT_DEFAULTS[o].step;
  const maxPerRow = vp.width - safe.left - safe.right < 480 ? 3 : LAYOUT_DEFAULTS.maxPerRow;
  let p = 16;
  let lw: number = W.max;
  let s = solveSpread(graph, vp, safe, sizer, o, lw, metricsFor(graph, sizer, p, lw), maxPerRow);
  for (let k = 0; k < 4; k++) {
    const p2 = pxPerUnit(s.fit.cam, vp);
    // columnas a `spread`, menos sub-columnas y vaivén
    const lw2 = Math.round(MathUtils.clamp((s.layout.spread - step * 0.9) * p2 - 16, W.min, W.max));
    if (p2 >= p && Math.abs(lw2 - lw) <= 3) break;
    p = Math.min(p2, p * 1.5) * 0.98;
    lw = lw2;
    s = solveSpread(graph, vp, safe, sizer, o, lw, metricsFor(graph, sizer, p, lw), maxPerRow);
  }
  return { layout: s.layout, fit: s.fit, orientation: o, labelWidth: lw };
}

/**
 * Apaisado denso: la etapa más grande se reparte en una rejilla de sub-columnas. Se prueban varias rejillas (filas)
 * y proporciones de celda, y gana la que deja ver más etiquetas sin pisarse (sin etapas mudas); a igualdad, la de
 * mayor escala.
 * Los títulos se miden recortados a `DENSE_LINES` líneas, que es como se pintan en la vista general.
 */
function solveDenseLandscape(graph: SceneGraph, vp: Viewport, safe: SafeArea, full: Sizer, maxN: number): OverviewSolution {
  const o: Orientation = 'landscape';
  const sizer = clampSizer(full, DENSE_LINES);
  const W = LABEL_WIDTH[o];
  const step = LAYOUT_DEFAULTS[o].step;
  const camera = scratchCamera(vp);
  const angles = overviewAngles();
  const rowsSet = new Set<number>();
  for (let c = 2; c <= Math.min(12, maxN); c++) rowsSet.add(Math.ceil(maxN / c));
  const evaluate = (rows: number, aspect: number) => {
    const colStep = aspect * step;
    const spread = colStep + step * 0.9;
    let p = 10;
    let lw: number = W.max;
    let layout!: LayoutResult;
    let fit!: FitResult;
    let ppu = p;
    for (let k = 0; k < 3; k++) {
      layout = layoutGraph(graph, { orientation: o, spread, step, maxPerCol: rows, colStep, metrics: metricsFor(graph, sizer, p, lw) });
      fit = fitItems(overviewItems(layout, sizer, lw), vp, safe, contentCenter(layout), angles, { camera });
      ppu = pxPerUnit(fit.cam, vp);
      // el ancho de etiqueta llena la sub-columna a la escala resultante
      const lw2 = Math.round(MathUtils.clamp(colStep * ppu - 14, W.min, W.max));
      if (k === 2 || (Math.abs(lw2 - lw) <= 3 && Math.abs(ppu - p) / p < 0.05)) break;
      p = ppu;
      lw = lw2;
    }
    const visible = declutter(graph, layout, fit.cam, vp, sizer, lw, { margin: DENSE_MARGIN });
    return { sol: { layout, fit, orientation: o, labelWidth: lw, visible, maxLines: DENSE_LINES }, ppu };
  };
  let best: ReturnType<typeof evaluate> | null = null;
  for (const rows of rowsSet)
    for (const aspect of [1.6, 2.1, 2.7, 3.4]) {
      const c = evaluate(rows, aspect);
      if (!best || betterDense(c.sol, best.sol) || (!betterDense(best.sol, c.sol) && c.ppu > best.ppu)) best = c;
    }
  return best!.sol;
}

/** Estimación de tamaño de etiquetas sin DOM (tests, y primer cuadro antes de que carguen las fuentes). */
export function estimateSizer(graph: SceneGraph, portrait = false): Sizer {
  const title = new Map(graph.nodes.map((n) => [n.id, n.title]));
  const fs = portrait ? 12 : 13;
  const cw = fs * 0.56;
  const lh = Math.round(fs * 1.25);
  return {
    node(id, maxWidth, maxLines) {
      const words = (title.get(id) ?? '').split(/\s+/);
      let lines = 1, line = 0, widest = 0;
      for (const w of words) {
        const ww = w.length * cw;
        const add = line ? cw + ww : ww;
        if (line && line + add > maxWidth) {
          lines++;
          widest = Math.max(widest, line);
          line = ww;
        } else line += add;
      }
      widest = Math.max(widest, line);
      // como en el DOM (`width: max-content` + `max-width`): si el título parte, la caja ocupa todo el ancho máximo
      return { w: lines > 1 ? maxWidth : Math.min(maxWidth, Math.ceil(widest)), h: Math.min(lines, maxLines ?? Infinity) * lh };
    },
    header(stage) {
      const st = graph.stages[stage];
      const text = `III · ${st?.name ?? ''}`;
      return portrait ? { w: Math.ceil((text.length + 12) * 10 * 0.8), h: 13 } : { w: Math.ceil(text.length * 11 * 0.86), h: 30 };
    },
  };
}
