// La escena del cielo: three.js directo. Porta del preview el campo estelar, la grilla celeste, las texturas,
// el bloom, la niebla, las partículas, los anillos, las ondas de choque y los nacimientos; la vista general es la
// «carta estelar» (layout.ts + framing.ts) con encuadre exacto dentro del rectángulo seguro.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CubicBezierCurve3,
  FogExp2,
  Group,
  Line,
  LineDashedMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
  type Texture,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { NodeStatus } from '../data/types';
import type { CreateSkyOptions, Pulse, SafeArea, SceneGraph, SceneMode, SceneNode, Sky } from './contract';
import { buildBackdrop } from './backdrop';
import {
  BREATH,
  LABEL,
  PARALLAX,
  contentCenter,
  declutter,
  fitItems,
  fovFor,
  overviewItems,
  placeCamera,
  pxPerUnit,
  solveOverview,
  type CamState,
  type OverviewSolution,
  type Viewport,
} from './framing';
import { LabelLayer, injectStyles } from './labels';
import type { LayoutResult } from './layout';
import { makeTextures, type SkyTextures } from './textures';

const COL: Record<NodeStatus, number> = { done: 0xf4eee2, working: 0x9fd3ff, blocked: 0xffb547, pending: 0x8494ad };
const PULSE_COL: Record<Pulse, number> = { done: 0xffffff, working: 0x9fd3ff, blocked: 0xffb547, born: 0x9fd3ff };
const SEGMENTS = 64;
const PCOUNT = 160;
const FAR: Omit<CamState, 'tx' | 'ty' | 'tz' | 'ox' | 'oy'> = { r: 190, theta: -0.9, phi: 0.75 };
const NO_WEBGL = 'Este navegador no tiene WebGL. Ábrelo en Chrome, Safari o Firefox de escritorio.';

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface NodeView {
  id: string;
  data: SceneNode;
  pos: Vector3;
  home: Vector3;
  group: Group;
  glow: Sprite;
  spike: Sprite;
  ring: Sprite;
  shock: Sprite;
  hit: Mesh;
  color: Color;
  target: Color;
  dim: number;
  born: number;
  dying: number;
  flash: number;
  seed: number;
  shockT: number;
}

interface EdgeView {
  key: string;
  from: string;
  to: string;
  curve: CubicBezierCurve3;
  line: Line;
  geo: BufferGeometry;
  mat: LineDashedMaterial;
  draw: number;
  baseO: number;
  dying: number;
}

interface StageView {
  ring: Line;
  mat: LineDashedMaterial;
}

function noop(): Sky {
  return { setGraph() {}, pulse() {}, overview() {}, flyStage() {}, focus() {}, setSafeArea() {}, dispose() {} };
}

export function createSky(opts: CreateSkyOptions): Sky {
  const { canvas, handlers } = opts;
  const doc = canvas.ownerDocument;
  const win = doc.defaultView ?? window;
  const removeStyles = injectStyles(doc);
  const labels = new LabelLayer(opts.labels);

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    labels.fallback(NO_WEBGL);
    const sky = noop();
    sky.dispose = () => {
      labels.dispose();
      removeStyles();
    };
    return sky;
  }

  const REDUCED = typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE_POINTER = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: fine)').matches;

  renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new Scene();
  scene.background = new Color(0x04060a);
  const fog = new FogExp2(0x04060a, 0.0065);
  scene.fog = fog;
  const camera = new PerspectiveCamera(40, 1, 0.1, 2000);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.8, 0.38, 0.16);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const T: SkyTextures = makeTextures();
  const backdrop = buildBackdrop(T.dot);
  scene.add(backdrop);
  const world = new Group();
  scene.add(world);

  // ---------- estado ----------
  let graph: SceneGraph = { stages: [], nodes: [], edges: [] };
  const nodes = new Map<string, NodeView>();
  const edges = new Map<string, EdgeView>();
  let stageViews: StageView[] = [];
  let safe: SafeArea = { ...opts.safeArea };
  let vp: Viewport = { width: 1, height: 1 };
  let solution: OverviewSolution | null = null;
  let overviewCam: CamState | null = null;
  let mode: SceneMode = 'intro';
  let focusId: string | null = null;
  let stageSel: number | null = null;
  let hoverId: string | null = null;
  /** Al volar a una etapa densa: qué etiquetas de esa etapa caben con la cámara de la etapa (títulos completos). */
  let stageVisible: Set<string> | null = null;
  /** Opacidad suavizada de cada etiqueta: ocultar o mostrar por choque es un fundido, no un parpadeo. */
  const labelK = new Map<string, number>();
  let started = false;
  let structureKey = '';
  let dirtyLayout = true;
  let dirtySize = true;
  let introK = 0;
  /** Escala de los nodos en la carta: la vista general está más cerca que el arco del preview (y el retrato es más denso). */
  let nodeScale = 0.82;
  const labelBelow = new Map<string, number>();
  const cam: CamState = { tx: 0, ty: 0, tz: 0, r: 60, theta: FAR.theta, phi: 1.2, ox: 0, oy: 0 };
  let tween: { from: CamState; to: CamState; t: number; dur: number; onEnd?: () => void } | null = null;
  // respiración, paralaje y arrastre elástico (solo se suman a la cámara, nunca cambian el encuadre base)
  let breathK = 0;
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };
  const drag = { theta: 0, phi: 0 };
  let down: { x: number; y: number; moved: boolean; id: number } | null = null;

  // ---------- partículas: fluyen de lo hecho hacia lo que está en curso ----------
  const pGeo = new BufferGeometry();
  const pPos = new Float32Array(PCOUNT * 3);
  pGeo.setAttribute('position', new BufferAttribute(pPos, 3));
  const pMat = new PointsMaterial({ size: 0.3, map: T.dot, color: COL.working, transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending });
  const particles = new Points(pGeo, pMat);
  particles.frustumCulled = false;
  world.add(particles);

  // ---------- construcción ----------
  const sprite = (map: Texture, color: number, opacity = 1) =>
    new Sprite(new SpriteMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending }));
  const hitGeo = new SphereGeometry(1.1, 10, 10);
  const hitMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

  function buildNode(n: SceneNode, home: Vector3, born: number): NodeView {
    const group = new Group();
    group.position.copy(home);
    const glow = sprite(T.glow, COL[n.status], 0.9);
    const spike = sprite(T.spike, COL[n.status], 0);
    spike.material.rotation = 0.12;
    const ring = sprite(T.ring, COL.blocked, 0);
    const shock = sprite(T.ring, 0xffffff, 0);
    shock.scale.setScalar(0.01);
    const hit = new Mesh(hitGeo, hitMat);
    hit.userData.id = n.id;
    group.add(glow, spike, ring, shock, hit);
    world.add(group);
    labels.setNode(n.id, n.title, n.status);
    return {
      id: n.id,
      data: { ...n },
      pos: home.clone(),
      home: home.clone(),
      group,
      glow,
      spike,
      ring,
      shock,
      hit,
      color: new Color(COL[n.status]),
      target: new Color(COL[n.status]),
      dim: 1,
      born,
      dying: -1,
      flash: 0,
      seed: (hashSeed(n.id) % 1000) / 100,
      shockT: -1,
    };
  }

  function disposeNode(v: NodeView) {
    world.remove(v.group);
    for (const s of [v.glow, v.spike, v.ring, v.shock]) s.material.dispose();
    labels.removeNode(v.id);
    labelK.delete(v.id);
  }

  function buildEdge(from: string, to: string, draw: number): EdgeView {
    const curve = new CubicBezierCurve3(new Vector3(), new Vector3(), new Vector3(), new Vector3());
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array((SEGMENTS + 1) * 3).fill(1), 3));
    const mat = new LineDashedMaterial({ color: COL.pending, vertexColors: true, transparent: true, opacity: 0.25, dashSize: 0.3, gapSize: 0.3, depthWrite: false, blending: AdditiveBlending });
    const line = new Line(geo, mat);
    line.frustumCulled = false;
    world.add(line);
    const e: EdgeView = { key: `${from}→${to}`, from, to, curve, line, geo, mat, draw, baseO: 0.25, dying: -1 };
    shapeEdge(e);
    styleEdge(e);
    return e;
  }

  function disposeEdge(e: EdgeView) {
    world.remove(e.line);
    e.geo.dispose();
    e.mat.dispose();
  }

  /**
   * Curva suave en el plano de la carta, con un leve arco en z. Apaisado: sale del nodo hacia la derecha.
   * Retrato: como un organigrama, sale del borde inferior de la etiqueta y entra al nodo por arriba, así no
   * atraviesa ningún título.
   */
  function shapeEdge(e: EdgeView) {
    const a = nodes.get(e.from)?.pos, b = nodes.get(e.to)?.pos;
    if (!a || !b) return;
    const c = e.curve;
    const portrait = solution?.orientation === 'portrait';
    const d = b.clone().sub(a);
    const arc = 0.5 + d.length() * 0.025;
    if (portrait) {
      const ba = labelBelow.get(e.from) ?? 1.6;
      c.v0.set(a.x, a.y - ba, a.z);
      if (-d.y > ba + 0.6) {
        c.v3.set(b.x, b.y + LABEL.halo, b.z);
        const k = Math.max((c.v0.y - c.v3.y) * 0.5, 0.8);
        c.v1.set(c.v0.x, c.v0.y - k, a.z + arc);
        c.v2.set(c.v3.x, c.v3.y + k, b.z + arc);
      } else {
        // misma fila: una U por debajo de las dos etiquetas
        const bb = labelBelow.get(e.to) ?? 1.6;
        c.v3.set(b.x, b.y - bb, b.z);
        const low = Math.min(c.v0.y, c.v3.y) - 1.4;
        c.v1.set(c.v0.x, low, a.z + arc);
        c.v2.set(c.v3.x, low, b.z + arc);
      }
    } else {
      c.v0.copy(a);
      c.v3.copy(b);
      if (d.x > 1.2) {
        const k = Math.max(d.x * 0.45, 1.6);
        c.v1.set(a.x + k, a.y, a.z + arc);
        c.v2.set(b.x - k, b.y, b.z + arc);
      } else {
        // misma columna: un arco que se abre hacia el lado del flujo
        const bow = new Vector3(1.6, 0, arc);
        c.v1.copy(a).addScaledVector(d, 0.3).add(bow);
        c.v2.copy(a).addScaledVector(d, 0.7).add(bow);
      }
    }
    const attr = e.geo.getAttribute('position') as BufferAttribute;
    const p = new Vector3();
    for (let i = 0; i <= SEGMENTS; i++) {
      c.getPoint(i / SEGMENTS, p);
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
    e.geo.computeBoundingSphere();
    e.line.computeLineDistances();
    e.geo.setDrawRange(0, Math.floor(e.draw));
  }

  function styleEdge(e: EdgeView) {
    const a = nodes.get(e.from)?.data.status, b = nodes.get(e.to)?.data.status;
    let c = COL.pending, o = 0.2, solid = false;
    if (a === 'done' && b === 'done') { c = 0xcfc6b6; o = 0.28; solid = true; }
    else if (a === 'done' && b === 'working') { c = COL.working; o = 0.55; solid = true; }
    else if (a === 'blocked' || b === 'blocked') { c = COL.blocked; o = 0.32; }
    else if (a === 'done') { c = 0x8fa0b8; o = 0.3; }
    // las que saltan etapas cruzan media carta: más tenues para no ensuciarla
    const sa = nodes.get(e.from)?.data.stage ?? 0, sb = nodes.get(e.to)?.data.stage ?? 0;
    if (Math.abs(sb - sa) >= 2) o *= solution?.orientation === 'portrait' ? 0.3 : 0.5;
    e.mat.color.set(c);
    e.baseO = o;
    e.mat.dashSize = solid ? 1000 : 0.3;
    e.mat.gapSize = solid ? 0 : 0.3;
  }

  function buildStageRings(layout: LayoutResult) {
    for (const s of stageViews) {
      world.remove(s.ring);
      s.ring.geometry.dispose();
      s.mat.dispose();
    }
    stageViews = layout.stages.map((st) => {
      const pts: Vector3[] = [];
      for (let k = 0; k <= 160; k++) {
        const a = (k / 160) * Math.PI * 2;
        pts.push(new Vector3(st.center.x + Math.cos(a) * st.rx, st.center.y + Math.sin(a) * st.ry, st.center.z));
      }
      const g = new BufferGeometry().setFromPoints(pts);
      g.setAttribute('color', new BufferAttribute(new Float32Array(pts.length * 3).fill(1), 3));
      const mat = new LineDashedMaterial({ color: 0x2a3a52, vertexColors: true, dashSize: 0.22, gapSize: 0.34, transparent: true, opacity: st.count ? 0.9 : 0, depthWrite: false });
      const ring = new Line(g, mat);
      ring.computeLineDistances();
      world.add(ring);
      return { ring, mat };
    });
  }

  // ---------- disposición y encuadre ----------
  function measureViewport(): boolean {
    const w = Math.max(1, Math.round(canvas.clientWidth || win.innerWidth));
    const h = Math.max(1, Math.round(canvas.clientHeight || win.innerHeight));
    if (w === vp.width && h === vp.height) return false;
    vp = { width: w, height: h };
    renderer.setSize(w, h, false);
    composer.setPixelRatio(Math.min(win.devicePixelRatio || 1, 2));
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = fovFor(vp);
    camera.updateProjectionMatrix();
    return true;
  }

  function stageSummary() {
    return graph.stages.map((s, i) => {
      const list = graph.nodes.filter((n) => n.stage === i);
      return {
        name: s.name,
        done: list.filter((n) => n.status === 'done').length,
        total: list.length,
        live: list.some((n) => n.status === 'working' || n.status === 'blocked'),
      };
    });
  }

  function relayout() {
    dirtyLayout = false;
    if (!graph.nodes.length) {
      solution = null;
      overviewCam = null;
      labels.setStages([]);
      buildStageRings({ orientation: 'landscape', positions: new Map(), stageOf: new Map(), stages: [], spread: 0 });
      return;
    }
    labels.setPortrait(vp.width / vp.height < 0.8);
    labels.setStages(stageSummary());
    const sol = solveOverview(graph, vp, safe, labels.sizer());
    solution = sol;
    labels.applyWidth(sol.labelWidth);
    for (const [id, p] of sol.layout.positions) {
      const v = nodes.get(id);
      if (v) v.home.set(p.x, p.y, p.z);
    }
    buildStageRings(sol.layout);
    overviewCam = sol.fit.cam;
    nodeScale = sol.orientation === 'portrait' ? 0.6 : 0.82;
    // cuánto baja cada etiqueta (mundo), para que las aristas del retrato salgan por debajo del título
    const ppu = pxPerUnit(sol.fit.cam, vp);
    const sz = labels.sizer();
    labelBelow.clear();
    for (const id of sol.layout.positions.keys()) labelBelow.set(id, LABEL.drop + (LABEL.gap + sz.node(id, sol.labelWidth, sol.maxLines).h + 3) / ppu);
    stageVisible = null;
    if (mode === 'stage' && stageSel !== null) stageVisible = stageLabels(stageSel, stageCam(stageSel));
    // la orientación cambia el trazo y la opacidad de las aristas que saltan etapas
    for (const e of edges.values()) {
      shapeEdge(e);
      styleEdge(e);
    }
  }

  function stageCam(i: number): CamState | null {
    if (!solution) return null;
    const items = overviewItems(solution.layout, labels.sizer(), solution.labelWidth, i);
    const angle = { theta: 0.5, phi: 1.3 };
    const fit = fitItems(items, vp, safe, contentCenter(solution.layout, i), [angle]);
    return { ...fit.cam, r: Math.max(fit.cam.r, 14) };
  }

  /** Etiquetas de la etapa `i` que caben sin pisarse con la cámara de esa etapa (títulos completos). */
  function stageLabels(i: number, c: CamState | null): Set<string> | null {
    if (!solution || !c) return null;
    return declutter(graph, solution.layout, c, vp, labels.sizer(), solution.labelWidth, {
      onlyStage: i,
      angles: [{ theta: c.theta, phi: c.phi }],
    });
  }

  /** Desplazamiento que pone el punto mirado en el centro del rectángulo seguro (y más arriba en retrato, sobre la hoja). */
  function centerOffset(): { ox: number; oy: number } {
    const portrait = vp.width / vp.height < 0.8;
    const sw = vp.width - safe.left - safe.right;
    const sh = vp.height - safe.top - safe.bottom;
    const tx = safe.left + sw / 2;
    const ty = portrait ? safe.top + sh * 0.17 : safe.top + sh / 2;
    return { ox: vp.width / 2 - tx, oy: vp.height / 2 - ty };
  }

  function flyTo(to: CamState, dur: number, onEnd?: () => void) {
    const target = { ...to };
    let d = target.theta - cam.theta;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    target.theta = cam.theta + d;
    tween = { from: { ...cam }, to: target, t: 0, dur: REDUCED ? 0.001 : dur, onEnd };
  }

  function setMode(m: SceneMode, notify: boolean) {
    if (mode === m) return;
    mode = m;
    if (notify) handlers.onModeChange?.(m);
  }

  function startIntro() {
    if (!overviewCam) return;
    started = true;
    Object.assign(cam, { ...overviewCam, ...FAR });
    mode = 'intro';
    flyTo(overviewCam, 4.2, () => setMode('overview', true));
  }

  // ---------- reconciliación ----------
  function setGraph(next: SceneGraph) {
    const first = !graph.nodes.length && next.nodes.length > 0;
    graph = { stages: next.stages.map((s) => ({ ...s })), nodes: next.nodes.map((n) => ({ ...n })), edges: next.edges.map((e) => ({ ...e })) };
    const ids = new Set(graph.nodes.map((n) => n.id));
    let i = 0;
    for (const n of graph.nodes) {
      const v = nodes.get(n.id);
      if (!v) {
        // primer grafo: aparecen escalonados durante el intro; luego, nacimiento elástico
        const born = first && !REDUCED ? -0.25 - i++ * 0.06 : REDUCED ? 1 : 0;
        const home = new Vector3();
        nodes.set(n.id, buildNode(n, home, born));
        continue;
      }
      if (v.dying >= 0) {
        v.dying = -1;
        v.born = Math.min(v.born, 0.6);
      }
      if (v.data.status !== n.status) {
        v.target.set(COL[n.status]);
        v.flash = 1;
      }
      v.data = { ...n };
      labels.setNode(n.id, n.title, n.status);
    }
    for (const v of nodes.values()) if (!ids.has(v.id) && v.dying < 0) v.dying = 1;

    const keys = new Set<string>();
    for (const e of graph.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) continue;
      const key = `${e.from}→${e.to}`;
      keys.add(key);
      const ev = edges.get(key);
      if (!ev) edges.set(key, buildEdge(e.from, e.to, REDUCED ? SEGMENTS + 1 : 0));
      else ev.dying = -1;
    }
    for (const e of edges.values()) {
      if (!keys.has(e.key) && e.dying < 0) e.dying = 1;
      styleEdge(e);
    }
    labels.setStages(stageSummary());

    const key = `${graph.stages.map((s) => s.name).join('|')}#${graph.nodes.map((n) => `${n.id}@${n.stage}`).sort().join(',')}#${graph.edges.map((e) => `${e.from}>${e.to}`).sort().join(',')}`;
    if (key !== structureKey) {
      structureKey = key;
      relayout();
      // los nodos nuevos nacen en su sitio
      for (const v of nodes.values()) if (v.born < 1 && v.pos.lengthSq() === 0) v.pos.copy(v.home);
      for (const e of edges.values()) shapeEdge(e);
      if (!started && overviewCam) startIntro();
      else if (mode === 'overview' && overviewCam) flyTo(overviewCam, 1.2);
    }
    if (!graph.nodes.length) {
      started = false;
      if (mode !== 'intro') mode = 'intro';
    }
  }

  // ---------- interacción ----------
  const ray = new Raycaster();
  const ndc = new Vector2();
  function pick(ev: PointerEvent): string | null {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(
      [...nodes.values()].filter((v) => v.dying < 0).map((v) => v.hit),
      false,
    );
    return (hits[0]?.object.userData.id as string | undefined) ?? null;
  }
  const onDown = (ev: PointerEvent) => {
    down = { x: ev.clientX, y: ev.clientY, moved: false, id: ev.pointerId };
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* sin captura */ }
  };
  const onMove = (ev: PointerEvent) => {
    if (FINE_POINTER) {
      parallax.tx = (ev.clientX / Math.max(1, vp.width)) * 2 - 1;
      parallax.ty = (ev.clientY / Math.max(1, vp.height)) * 2 - 1;
    }
    if (down) {
      const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      if (!down.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        down.moved = true;
        canvas.style.cursor = 'grabbing';
      }
      if (down.moved) {
        if (mode === 'overview' || mode === 'intro') {
          // en la vista general el giro es elástico: vuelve solo al soltar
          drag.theta = MathUtils.clamp(drag.theta - dx * 0.003, -0.4, 0.4);
          drag.phi = MathUtils.clamp(drag.phi - dy * 0.003, -0.25, 0.25);
        } else {
          tween = null;
          cam.theta -= dx * 0.0045;
          cam.phi = MathUtils.clamp(cam.phi - dy * 0.0045, 0.35, 2.75);
        }
        down.x = ev.clientX;
        down.y = ev.clientY;
      }
      return;
    }
    const id = pick(ev);
    if (id !== hoverId) {
      hoverId = id;
      labels.setHover(id);
      canvas.style.cursor = id ? 'pointer' : '';
    }
  };
  const onUp = (ev: PointerEvent) => {
    if (down && !down.moved) handlers.onPick(pick(ev));
    down = null;
    canvas.style.cursor = hoverId ? 'pointer' : '';
  };
  const onLeave = () => {
    parallax.tx = parallax.ty = 0;
  };
  const onWheel = (ev: WheelEvent) => {
    if (mode !== 'focus' && mode !== 'stage') return;
    ev.preventDefault();
    tween = null;
    cam.r = MathUtils.clamp(cam.r * (1 + ev.deltaY * 0.0012), 5, 200);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.style.touchAction = 'none';

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (dirtySize = true)) : null;
  ro?.observe(canvas);
  const onResize = () => (dirtySize = true);
  win.addEventListener('resize', onResize);
  // con la fuente real las etiquetas miden distinto: se vuelve a encuadrar
  doc.fonts?.ready.then(() => {
    labels.invalidate();
    dirtyLayout = true;
  });

  // ---------- líneas bajo el texto ----------
  const boxes: { x0: number; x1: number; y0: number; y1: number; o: number }[] = [];
  const pv = new Vector3();
  /** Multiplica el color de cada vértice por cuánto lo tapa un título (en px de pantalla, con la cámara actual). */
  function shadeUnderText(geo: BufferGeometry, upTo: number) {
    const pos = geo.getAttribute('position') as BufferAttribute;
    const col = geo.getAttribute('color') as BufferAttribute | undefined;
    if (!col) return;
    const n = Math.min(pos.count, upTo);
    const w = vp.width, h = vp.height;
    let changed = false;
    for (let i = 0; i < n; i++) {
      pv.fromBufferAttribute(pos, i).project(camera);
      const x = (pv.x * 0.5 + 0.5) * w, y = (-pv.y * 0.5 + 0.5) * h;
      let cover = 0;
      for (const b of boxes) if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && b.o > cover) cover = b.o;
      const k = 1 - 0.92 * cover;
      if (Math.abs(col.getX(i) - k) > 0.01) {
        col.setXYZ(i, k, k, k);
        changed = true;
      }
    }
    if (changed) col.needsUpdate = true;
  }

  // ---------- loop ----------
  let last = performance.now();
  let elapsed = 0;
  let raf = 0;
  const v3 = new Vector3();
  const tmpCam: CamState = { ...cam };

  function frame(now: number) {
    raf = win.requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    elapsed += dt;
    const t = elapsed;

    if (dirtySize && measureViewport()) {
      dirtyLayout = true;
    }
    dirtySize = false;
    if (dirtyLayout) {
      const wasOverview = mode === 'overview' && !tween;
      relayout();
      if (overviewCam && wasOverview) Object.assign(cam, overviewCam); // en resize la vista general se ajusta al instante
      else if (overviewCam && tween && (mode === 'overview' || mode === 'intro')) tween.to = { ...overviewCam, theta: tween.to.theta };
      if (focusId && mode === 'focus' && !tween) Object.assign(cam, centerOffset());
      if (overviewCam && !started) startIntro();
    }

    // cámara
    if (tween) {
      tween.t += dt;
      const k = ease(Math.min(1, tween.t / tween.dur));
      for (const key of Object.keys(tween.to) as (keyof CamState)[]) cam[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * k;
      if (mode === 'intro') introK = k;
      if (tween.t >= tween.dur) {
        const end = tween.onEnd;
        tween = null;
        end?.();
      }
    } else if (!graph.nodes.length && !REDUCED) {
      cam.theta += dt * 0.01; // sin plan: el cielo gira despacio de fondo
    }
    if (mode !== 'intro') introK = 1;
    breathK += ((mode === 'overview' && !REDUCED ? 1 : 0) - breathK) * Math.min(1, dt * 1.5);
    parallax.x += (parallax.tx - parallax.x) * Math.min(1, dt * 2);
    parallax.y += (parallax.ty - parallax.y) * Math.min(1, dt * 2);
    if (!down) {
      drag.theta *= Math.pow(0.02, dt);
      drag.phi *= Math.pow(0.02, dt);
    }
    Object.assign(tmpCam, cam);
    tmpCam.theta += breathK * (Math.sin((t * Math.PI * 2) / 46) * BREATH + parallax.x * PARALLAX.theta) + drag.theta;
    tmpCam.phi += breathK * parallax.y * PARALLAX.phi + drag.phi;
    placeCamera(camera, tmpCam);
    camera.setViewOffset(vp.width, vp.height, cam.ox, cam.oy, vp.width, vp.height);
    fog.density = Math.min(0.012, 0.3 / Math.max(cam.r, 20));
    if (!REDUCED) backdrop.rotation.y += dt * 0.002;

    // relación con el foco: lo que no es dependencia ni dependiente se apaga
    const rel = new Set<string>();
    if (focusId) {
      rel.add(focusId);
      for (const e of edges.values()) {
        if (e.dying >= 0) continue;
        if (e.from === focusId) rel.add(e.to);
        if (e.to === focusId) rel.add(e.from);
      }
    }

    // nodos
    for (const v of [...nodes.values()]) {
      v.pos.lerp(v.home, 1 - Math.pow(0.02, dt));
      v.group.position.copy(v.pos);
      if (v.born < 1) v.born = Math.min(1, v.born + dt * (mode === 'intro' ? 0.9 : 0.7));
      const b = Math.max(0, v.born);
      const bornK = v.born < 1 ? Math.max(0, 1 - Math.pow(1 - b, 3) * Math.cos(b * 9)) * (b > 0 ? 1 : 0) : 1;
      let alive = 1;
      if (v.dying >= 0) {
        v.dying = Math.max(0, v.dying - dt * 1.6);
        alive = v.dying;
        if (v.dying === 0) {
          disposeNode(v);
          nodes.delete(v.id);
          continue;
        }
      }
      const st = v.data.status;
      const inStage = stageSel === null || v.data.stage === stageSel;
      const want = focusId ? (rel.has(v.id) ? 1 : 0.18) : mode === 'stage' && !inStage ? 0.35 : 1;
      v.dim += (want - v.dim) * Math.min(1, dt * 4);
      v.color.lerp(v.target, Math.min(1, dt * 2.5));
      v.flash = Math.max(0, v.flash - dt * 1.2);
      let size = 1.0, spike = 0.1, glowO = 0.72;
      if (st === 'done') { size = 1.9; spike = 0.55; glowO = 0.95; }
      else if (st === 'working') {
        const k = REDUCED ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2.2 + v.seed);
        size = 1.35 + k * 0.45; spike = 0.18 + k * 0.12; glowO = 0.75 + k * 0.25;
      } else if (st === 'blocked') { size = 1.4; spike = 0.1; glowO = 0.9; }
      size *= nodeScale * (1 + v.flash * 1.4) * bornK * (0.6 + 0.4 * alive);
      const o = v.dim * alive;
      v.glow.material.color.copy(v.color);
      v.glow.material.opacity = glowO * o;
      v.glow.scale.setScalar(Math.max(1e-4, size * 2.2));
      v.spike.material.color.copy(v.color);
      v.spike.material.opacity = spike * o;
      v.spike.scale.setScalar(Math.max(1e-4, size * 4.2));
      if (st === 'blocked') {
        const k = REDUCED ? 0.35 : (t * 0.7 + v.seed) % 1;
        v.ring.material.opacity = (1 - k) * 0.9 * o;
        v.ring.scale.setScalar((2 + k * 3.5) * nodeScale);
      } else v.ring.material.opacity = 0;
      if (v.shockT >= 0) {
        v.shockT += dt;
        const k = Math.min(1, v.shockT / 1.4);
        v.shock.scale.setScalar(1 + ease(k) * 11 * nodeScale);
        v.shock.material.opacity = (1 - k) * 0.85;
        if (k >= 1) {
          v.shockT = -1;
          v.shock.material.opacity = 0;
        }
      }
    }

    // aristas
    for (const e of [...edges.values()]) {
      const a = nodes.get(e.from), b = nodes.get(e.to);
      if (!a || !b) {
        disposeEdge(e);
        edges.delete(e.key);
        continue;
      }
      if (e.dying >= 0) {
        e.dying = Math.max(0, e.dying - dt * 1.6);
        if (e.dying === 0) {
          disposeEdge(e);
          edges.delete(e.key);
          continue;
        }
      }
      const canDraw = a.born > 0.3 && b.born > 0.3;
      let redraw = false;
      if (e.draw < SEGMENTS + 1 && canDraw) {
        e.draw = Math.min(SEGMENTS + 1, e.draw + dt * 40);
        e.geo.setDrawRange(0, Math.floor(e.draw));
      }
      if (a.pos.distanceToSquared(a.home) > 1e-5 || b.pos.distanceToSquared(b.home) > 1e-5) redraw = true;
      if (redraw) shapeEdge(e);
      const d = focusId ? (e.from === focusId || e.to === focusId ? 1.8 : 0.25) : mode === 'stage' && stageSel !== null && a.data.stage !== stageSel && b.data.stage !== stageSel ? 0.4 : 1;
      e.mat.opacity = Math.min(1, e.baseO * d) * (e.dying >= 0 ? e.dying : 1) * Math.min(1, introK * 1.4);
    }

    // partículas
    const active = [...edges.values()].filter((e) => e.dying < 0 && e.draw > SEGMENTS && nodes.get(e.from)?.data.status === 'done' && nodes.get(e.to)?.data.status === 'working');
    for (let k = 0; k < PCOUNT; k++) {
      const e = active[k % Math.max(1, active.length)];
      if (!e) {
        pPos[k * 3 + 1] = 9999;
        continue;
      }
      const u = ((REDUCED ? 0 : t * 0.22) + k * 0.6180339) % 1;
      e.curve.getPoint(u, v3);
      pPos[k * 3] = v3.x;
      pPos[k * 3 + 1] = v3.y;
      pPos[k * 3 + 2] = v3.z;
    }
    (pGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    pMat.opacity = (focusId ? 0.45 : 0.85) * introK;
    pMat.size = 0.3 * nodeScale;

    // anillos de etapa
    stageViews.forEach((s, i) => {
      const count = solution?.layout.stages[i]?.count ?? 0;
      const base = count ? 0.9 : 0;
      const w = focusId ? 0.25 : mode === 'stage' ? (i === stageSel ? 1 : 0.3) : 1;
      s.mat.opacity = base * w * Math.min(1, introK * 1.2);
    });

    // etiquetas: proyección con la cámara real (view offset incluido)
    const w = vp.width, h = vp.height;
    const labelIn = mode === 'intro' ? MathUtils.clamp((introK - 0.55) / 0.4, 0, 1) : 1;
    const sizer = labels.sizer();
    const lw = solution?.labelWidth ?? 160;
    boxes.length = 0;
    // Proyecto denso: no todas las etiquetas caben. Se ven las que eligió el encuadre (`visible`); las demás
    // aparecen al pasar el mouse, al enfocar su nodo (o uno vecino) o al volar a su etapa.
    const shown = solution?.visible;
    const clampLines = solution?.maxLines;
    const placed: { v: NodeView; x: number; y: number; o: number; lines?: number }[] = [];
    let hovered: { x0: number; x1: number; y0: number; y1: number } | null = null;
    for (const v of nodes.values()) {
      v3.set(v.pos.x, v.pos.y - LABEL.drop, v.pos.z).project(camera);
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.2 && Math.abs(v3.y) < 1.2;
      const x = (v3.x * 0.5 + 0.5) * w, y = (-v3.y * 0.5 + 0.5) * h;
      const inStage = mode === 'stage' && stageSel === v.data.stage;
      const asked = v.id === hoverId || (!!focusId && rel.has(v.id)) || inStage;
      const fits = !shown || shown.has(v.id);
      let o: number;
      if (!vis) o = 0;
      else if (focusId) o = rel.has(v.id) ? 1 : 0.1;
      else if (mode === 'stage') o = stageSel === v.data.stage ? 1 : 0.12;
      else o = v.data.status === 'done' ? 0.78 : 1;
      if (v.id === hoverId) o = Math.max(o, 1);
      // compuerta por choque (en la demo siempre 1): se funde para que ocultar o mostrar no parpadee
      const gate = inStage ? (!stageVisible || stageVisible.has(v.id) ? 1 : 0) : v.id === hoverId || (!!focusId && rel.has(v.id)) || fits ? 1 : 0;
      const k0 = labelK.get(v.id) ?? gate;
      const k = k0 + (gate - k0) * Math.min(1, dt * 7);
      labelK.set(v.id, k);
      o *= k * labelIn * Math.max(0, Math.min(1, v.born * 1.4)) * (v.dying >= 0 ? v.dying : 1);
      // recortado salvo que se pida verlo entero
      const lines = clampLines && !asked ? clampLines : undefined;
      labels.setClamp(v.id, !!lines);
      placed.push({ v, x, y, o, lines });
      // oculta o recortada: al pedirla con el mouse crece, así que se le abre espacio
      if (v.id === hoverId && (!fits || !!clampLines) && o > 0.05) {
        const sz = sizer.node(v.id, lw);
        hovered = { x0: x - sz.w / 2 - 4, x1: x + sz.w / 2 + 4, y0: y + LABEL.gap - 4, y1: y + LABEL.gap + sz.h + 4 };
      }
    }
    for (const it of placed) {
      const sz = sizer.node(it.v.id, lw, it.lines);
      let o = it.o;
      // la etiqueta oculta que se pidió con el mouse se lee limpia: lo que choca con ella se apaga
      if (hovered && it.v.id !== hoverId) {
        const hb = hovered;
        if (it.x - sz.w / 2 < hb.x1 && hb.x0 < it.x + sz.w / 2 && it.y + LABEL.gap < hb.y1 && hb.y0 < it.y + LABEL.gap + sz.h) o *= 0.12;
      }
      labels.placeNode(it.v.id, it.x, it.y, o);
      if (o > 0.05) boxes.push({ x0: it.x - sz.w / 2 - 3, x1: it.x + sz.w / 2 + 3, y0: it.y + LABEL.gap - 2, y1: it.y + LABEL.gap + sz.h + 2, o });
    }
    solution?.layout.stages.forEach((st, i) => {
      v3.set(st.header.x, st.header.y, st.header.z).project(camera);
      const vis = v3.z < 1;
      let o = vis ? 0.95 : 0;
      if (focusId) o *= 0.1;
      else if (mode === 'stage') o *= i === stageSel ? 1 : 0.15;
      const hx = (v3.x * 0.5 + 0.5) * w, hy = (-v3.y * 0.5 + 0.5) * h;
      labels.placeStage(i, hx, hy, o * labelIn);
      if (o * labelIn > 0.05) {
        const sz = sizer.header(i);
        boxes.push({ x0: hx - sz.w / 2 - 6, x1: hx + sz.w / 2 + 6, y0: hy - LABEL.headerGap - sz.h - 3, y1: hy - LABEL.headerGap + 3, o: o * labelIn });
      }
    });
    // ninguna línea pasa por encima de un título: bajo cada caja de texto la arista o la órbita se apaga
    for (const e of edges.values()) shadeUnderText(e.geo, Math.floor(e.draw));
    for (const st of stageViews) shadeUnderText(st.ring.geometry, Infinity);

    composer.render();
  }
  raf = win.requestAnimationFrame(frame);

  // ---------- API ----------
  return {
    setGraph,
    pulse(nodeId: string, kind: Pulse) {
      const v = nodes.get(nodeId);
      if (!v) return;
      v.flash = 1;
      if (REDUCED) return;
      v.shock.material.color.set(PULSE_COL[kind]);
      v.shockT = 0;
    },
    overview() {
      focusId = null;
      stageSel = null;
      if (!overviewCam) {
        mode = 'overview';
        return;
      }
      mode = 'overview';
      flyTo(overviewCam, 2.2);
    },
    flyStage(i: number) {
      const c = stageCam(i);
      stageVisible = stageLabels(i, c);
      focusId = null;
      stageSel = i;
      mode = 'stage';
      if (c) flyTo(c, 2);
    },
    focus(id: string) {
      const v = nodes.get(id);
      if (!v) return;
      focusId = id;
      stageSel = v.data.stage;
      mode = 'focus';
      const side = solution ? Math.sign(v.home.x - (solution.layout.stages[v.data.stage]?.center.x ?? 0)) || 1 : 1;
      const portrait = solution?.orientation === 'portrait';
      flyTo({ tx: v.home.x, ty: v.home.y, tz: v.home.z, r: portrait ? 15 : 11, theta: 0.22 * side, phi: 1.28, ...centerOffset() }, 1.9);
    },
    setSafeArea(area: SafeArea) {
      if (area.top === safe.top && area.right === safe.right && area.bottom === safe.bottom && area.left === safe.left) return;
      safe = { ...area };
      dirtyLayout = true;
    },
    dispose() {
      win.cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      win.removeEventListener('resize', onResize);
      ro?.disconnect();
      for (const v of nodes.values()) disposeNode(v);
      for (const e of edges.values()) disposeEdge(e);
      nodes.clear();
      edges.clear();
      for (const s of stageViews) {
        s.ring.geometry.dispose();
        s.mat.dispose();
      }
      backdrop.traverse((o) => {
        const m = o as unknown as { geometry?: BufferGeometry; material?: { dispose(): void } };
        m.geometry?.dispose();
        m.material?.dispose();
      });
      pGeo.dispose();
      pMat.dispose();
      hitGeo.dispose();
      hitMat.dispose();
      T.dispose();
      composer.dispose();
      renderer.dispose();
      labels.dispose();
      removeStyles();
    },
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
