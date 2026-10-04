// Laboratorio de la escena (scene-lab.html): monta el cielo con el grafo local de 20 nodos y un HUD de réplica.
// Parámetros: ?w=390&h=844 fuerza un marco de ese tamaño · ?mode=overview|focus|stage · ?node=comision · ?stage=1
// · ?debug=1 dibuja el rectángulo seguro · ?live=1 simula eventos (estado, nacimiento) para ver las animaciones.
// · ?graph=basalt monta un proyecto importado sintético (88 nodos, 63 en una etapa) para ver la vista densa.
import type { SafeArea, SceneGraph } from './contract';
import { createSky } from './index';
import { basaltGraph } from './fixtures/basalt';
import { labGraph } from './lab-graph';
import { roman } from './labels';

const q = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const frame = $<HTMLDivElement>('#frame');
const w = Number(q.get('w')) || 0;
const h = Number(q.get('h')) || 0;
if (w || h) {
  frame.classList.add('boxed');
  frame.style.width = `${w || innerWidth}px`;
  frame.style.height = `${h || innerHeight}px`;
  if ((w || innerWidth) <= 720) frame.classList.add('narrow');
}
if (q.get('debug')) document.body.classList.add('debug');

const graph: SceneGraph = q.get('graph') === 'basalt' ? basaltGraph() : labGraph();

function renderRail(sel: number | null) {
  $<HTMLElement>('#rail').innerHTML = graph.stages
    .map((s, i) => {
      const list = graph.nodes.filter((n) => n.stage === i);
      const d = list.filter((n) => n.status === 'done').length;
      return `<button type="button" class="stage" data-s="${i}"><div class="bar"><span style="width:${(d / list.length) * 100}%"></span></div><span class="nm" style="${sel === i ? 'color:#f4eee2' : ''}">${roman(i)} · ${s.name}</span><span class="ct">${d} de ${list.length} listas</span></button>`;
    })
    .join('');
  document.querySelectorAll<HTMLButtonElement>('.stage').forEach((b) => (b.onclick = () => sky.flyStage(Number(b.dataset.s))));
}

/** SafeArea medido como lo hace la interfaz: borde del HUD + 12 px. */
function measureSafe(): SafeArea {
  const fr = frame.getBoundingClientRect();
  const brand = $('#brand').getBoundingClientRect();
  const actions = $('#actions').getBoundingClientRect();
  const rail = $('#rail').getBoundingClientRect();
  const narrow = fr.width <= 720;
  const s = {
    top: Math.round(Math.max(brand.bottom, actions.bottom) - fr.top + 12),
    bottom: Math.round(fr.bottom - rail.top + 12),
    left: narrow ? 16 : 20,
    right: narrow ? 16 : 20,
  };
  const box = $<HTMLDivElement>('#safe');
  Object.assign(box.style, { top: `${s.top}px`, left: `${s.left}px`, right: `${s.right}px`, bottom: `${s.bottom}px` });
  return s;
}

renderRail(null);
const sky = createSky({
  canvas: $<HTMLCanvasElement>('#c'),
  labels: $<HTMLDivElement>('#labels'),
  safeArea: measureSafe(),
  handlers: {
    onPick: (id) => (id ? sky.focus(id) : sky.overview()),
    onModeChange: (m) => document.body.setAttribute('data-mode', m),
  },
});
sky.setGraph(graph);
new ResizeObserver(() => sky.setSafeArea(measureSafe())).observe(frame);
addEventListener('keydown', (e) => e.key === 'Escape' && sky.overview());
$('#overview').addEventListener('click', () => sky.overview());
const blocked = graph.nodes.filter((n) => n.status === 'blocked');
let bi = -1;
$('#waiting').addEventListener('click', () => blocked.length && sky.focus(blocked[(bi = (bi + 1) % blocked.length)]!.id));

const mode = q.get('mode');
if (mode && mode !== 'overview') {
  setTimeout(() => {
    if (mode === 'focus') sky.focus(q.get('node') ?? 'comision');
    if (mode === 'stage') {
      const s = Number(q.get('stage') ?? 1);
      sky.flyStage(s);
      renderRail(s);
    }
  }, Number(q.get('delay') ?? 4600));
}

if (q.get('live')) {
  // eventos simulados, solo para ver las animaciones en el laboratorio
  const later = (ms: number, fn: () => void) => setTimeout(fn, ms);
  later(6000, () => {
    const n = graph.nodes.find((x) => x.id === 'registro')!;
    n.status = 'done';
    n.progress = 1;
    sky.setGraph(graph);
    sky.pulse('registro', 'done');
    renderRail(null);
  });
  later(8000, () => {
    const n = graph.nodes.find((x) => x.id === 'whatsapp')!;
    n.status = 'working';
    sky.setGraph(graph);
    sky.pulse('whatsapp', 'working');
  });
  later(10000, () => {
    graph.nodes.push({ id: 'recuperar', stage: 2, title: 'Recuperar contraseña', status: 'pending', progress: 0 });
    graph.edges.push({ from: 'registro', to: 'recuperar' });
    sky.setGraph(graph);
    sky.pulse('recuperar', 'born');
    renderRail(null);
  });
}

Object.assign(window, { sky, graph });
