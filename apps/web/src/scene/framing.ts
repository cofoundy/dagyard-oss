// Encuadre exacto: proyecta cada nodo, su halo y la caja de su etiqueta a píxeles y resuelve la distancia de la
// cámara por búsqueda binaria hasta que todo entra en el rectángulo seguro (viewport menos el HUD).
// El centro del encuadre es el centro del rectángulo seguro: se logra con camera.setViewOffset (traslación 2D pura).
// Solo usa matemática de three (sin WebGL), así que corre en tests.

import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
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
  /** Tamaño en px de la etiqueta del nodo con ese ancho máximo. */
  node(id: string, maxWidth: number): Size;
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

export interface OverviewSolution {
  layout: LayoutResult;
  fit: FitResult;
  orientation: Orientation;
  /** Ancho máximo de las etiquetas de nodo (px) con el que se resolvió el encuadre. */
  labelWidth: number;
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
) {
  const D = LAYOUT_DEFAULTS[o];
  const step = D.step;
  const camera = scratchCamera(vp);
  const angles = overviewAngles();
  const run = (spread: number) => {
    const layout = layoutGraph(graph, { orientation: o, spread, step, maxPerRow, metrics });
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

/**
 * Resuelve la vista general completa: orientación, espaciado entre etapas que llena el cuadro, ancho de etiquetas
 * y cámara exacta. Las etiquetas miden en píxeles y el mundo en unidades, así que se supone una escala, se apila
 * con ella y se acepta solo si la escala resultante es al menos la supuesta (así nada se pisa).
 */
export function solveOverview(graph: SceneGraph, vp: Viewport, safe: SafeArea, sizer: Sizer): OverviewSolution {
  const o = orientationFor(vp.width, vp.height);
  const W = LABEL_WIDTH[o];
  const step = LAYOUT_DEFAULTS[o].step;
  // en pantallas angostas una fila de 4 deja etiquetas de 80 px: se parte desde 4
  const maxPerRow = vp.width - safe.left - safe.right < 480 ? 3 : LAYOUT_DEFAULTS.maxPerRow;

  if (o === 'portrait') {
    const lwFor = (p: number) => Math.round(MathUtils.clamp(step * p - 12, W.min, W.max));
    const attempt = (p: number) => {
      const lw = lwFor(p);
      const s = solveSpread(graph, vp, safe, sizer, o, lw, metricsFor(graph, sizer, p, lw), maxPerRow);
      return { s, lw, ppu: pxPerUnit(s.fit.cam, vp) };
    };
    // consistente = la escala resultante alcanza la supuesta y la etiqueta cabe entre vecinos de fila
    const score = (p: number, a: ReturnType<typeof attempt>) => Math.min(a.ppu / p, (step * a.ppu - 12) / a.lw);
    let lo = 2;
    let hi = Math.max(4, (vp.width - safe.left - safe.right) / step);
    let best = attempt(lo);
    let bestScore = score(lo, best);
    let found = bestScore >= 0.999;
    for (let i = 0; i < 11; i++) {
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
        // sin solución exacta (pantalla demasiado baja): el intento que menos se pisa
        if (!found && sc > bestScore) {
          best = a;
          bestScore = sc;
        }
      }
    }
    return { layout: best.s.layout, fit: best.s.fit, orientation: o, labelWidth: best.lw };
  }

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

/** Estimación de tamaño de etiquetas sin DOM (tests, y primer cuadro antes de que carguen las fuentes). */
export function estimateSizer(graph: SceneGraph, portrait = false): Sizer {
  const title = new Map(graph.nodes.map((n) => [n.id, n.title]));
  const fs = portrait ? 12 : 13;
  const cw = fs * 0.56;
  const lh = Math.round(fs * 1.25);
  return {
    node(id, maxWidth) {
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
      return { w: Math.min(maxWidth, Math.ceil(widest)), h: lines * lh };
    },
    header(stage) {
      const st = graph.stages[stage];
      const text = `III · ${st?.name ?? ''}`;
      return portrait ? { w: Math.ceil((text.length + 12) * 10 * 0.8), h: 13 } : { w: Math.ceil(text.length * 11 * 0.86), h: 30 };
    },
  };
}
