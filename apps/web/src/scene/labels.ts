// Etiquetas DOM de la escena: títulos de nodos y encabezados de etapa. La escena trae sus propios estilos (prefijo
// `sky-`) para no depender de la hoja de la interfaz; lo que se mide para el encuadre es exactamente lo que se pinta.
import type { NodeStatus } from '../data/types';
import { LABEL, type Size, type Sizer } from './framing';

const STYLE_ID = 'dagyard-sky-style';

const CSS = `
.sky-root { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sky-lbl, .sky-stage { position: absolute; left: 0; top: 0; will-change: transform, opacity; opacity: 0; }
.sky-lbl {
  font: 400 13px/1.25 var(--font-body, "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
  letter-spacing: 0; text-align: center; white-space: normal; text-wrap: balance; overflow-wrap: anywhere;
  width: max-content; color: #8494ad;
  /* halo del color del cielo: las aristas que pasan por debajo desaparecen bajo el texto */
  text-shadow: 0 0 2px #04060a, 0 0 4px #04060a, 0 0 8px #04060a, 0 0 12px #04060a;
  transition: color .6s;
}
.sky-lbl.done { color: #a29c90; }
.sky-lbl.working { color: #9fd3ff; }
.sky-lbl.blocked { color: #ffb547; }
.sky-lbl.hover { color: #f4eee2; }
.sky-portrait .sky-lbl { font-size: 12px; }
.sky-stage {
  display: grid; justify-items: center; gap: 4px; white-space: nowrap; text-align: center;
  font-family: var(--font-mono, "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace);
  text-shadow: 0 0 2px #04060a, 0 0 5px #04060a, 0 0 10px #04060a, 0 0 16px #04060a;
}
.sky-stage b { font-weight: 500; font-size: 11px; line-height: 13px; letter-spacing: .26em; text-transform: uppercase; color: #8e9bb2; }
.sky-stage span { font-size: 10px; line-height: 13px; letter-spacing: .06em; color: #4c5a71; font-variant-numeric: tabular-nums; }
.sky-stage.live b { color: #c4d0e0; }
.sky-portrait .sky-stage { display: flex; align-items: baseline; gap: 10px; }
.sky-portrait .sky-stage b { font-size: 10px; letter-spacing: .22em; }
.sky-fallback { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; color: #6b7a93; font: 13px/1.5 var(--font-mono, ui-monospace, Menlo, monospace); }
`;

export function injectStyles(doc: Document): () => void {
  if (doc.getElementById(STYLE_ID)) return () => {};
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
  return () => el.remove();
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const roman = (i: number) => ROMAN[i] ?? String(i + 1);

export class LabelLayer {
  readonly root: HTMLDivElement;
  private nodes = new Map<string, HTMLDivElement>();
  private stages: HTMLDivElement[] = [];
  private sizes = new Map<string, Size>();
  private headerSizes = new Map<number, Size>();

  constructor(container: HTMLElement) {
    this.root = container.ownerDocument.createElement('div');
    this.root.className = 'sky-root';
    container.appendChild(this.root);
  }

  setPortrait(p: boolean) {
    if (this.root.classList.contains('sky-portrait') === p) return;
    this.root.classList.toggle('sky-portrait', p);
    this.invalidate();
  }

  invalidate() {
    this.sizes.clear();
    this.headerSizes.clear();
  }

  node(id: string): HTMLDivElement {
    let el = this.nodes.get(id);
    if (!el) {
      el = this.root.ownerDocument.createElement('div');
      el.className = 'sky-lbl';
      this.root.appendChild(el);
      this.nodes.set(id, el);
    }
    return el;
  }

  setNode(id: string, title: string, status: NodeStatus) {
    const el = this.node(id);
    if (el.textContent !== title) {
      el.textContent = title;
      for (const k of [...this.sizes.keys()]) if (k.startsWith(id + '|')) this.sizes.delete(k);
    }
    const cls = `sky-lbl ${status}`;
    if (!el.className.startsWith(cls)) el.className = cls + (el.classList.contains('hover') ? ' hover' : '');
  }

  removeNode(id: string) {
    this.nodes.get(id)?.remove();
    this.nodes.delete(id);
  }

  setStages(list: { name: string; done: number; total: number; live: boolean }[]) {
    while (this.stages.length > list.length) this.stages.pop()!.remove();
    list.forEach((s, i) => {
      let el = this.stages[i];
      if (!el) {
        el = this.root.ownerDocument.createElement('div');
        el.className = 'sky-stage';
        el.innerHTML = '<b></b><span></span>';
        this.root.appendChild(el);
        this.stages[i] = el;
      }
      const name = `${roman(i)} · ${s.name}`;
      const count = `${s.done} de ${s.total} ${s.total === 1 ? 'lista' : 'listas'}`;
      const b = el.firstElementChild as HTMLElement, sp = el.lastElementChild as HTMLElement;
      if (b.textContent !== name || sp.textContent !== count) {
        b.textContent = name;
        sp.textContent = count;
        this.headerSizes.delete(i);
      }
      el.classList.toggle('live', s.live);
    });
  }

  stage(i: number): HTMLDivElement | undefined {
    return this.stages[i];
  }

  /** Mide en el DOM real (con la fuente cargada); lo que se mide es lo que el encuadre usa. */
  sizer(): Sizer {
    return {
      node: (id, maxWidth) => {
        const key = `${id}|${maxWidth}`;
        let s = this.sizes.get(key);
        if (!s) {
          const el = this.nodes.get(id);
          if (!el) return { w: 0, h: 0 };
          el.style.maxWidth = `${maxWidth}px`;
          s = { w: Math.ceil(el.offsetWidth), h: Math.ceil(el.offsetHeight) };
          this.sizes.set(key, s);
        }
        return s;
      },
      header: (i) => {
        let s = this.headerSizes.get(i);
        if (!s) {
          const el = this.stages[i];
          s = el ? { w: Math.ceil(el.offsetWidth), h: Math.ceil(el.offsetHeight) } : { w: 0, h: 0 };
          this.headerSizes.set(i, s);
        }
        return s;
      },
    };
  }

  /** Fija el ancho máximo con el que se resolvió el encuadre. */
  applyWidth(maxWidth: number) {
    for (const el of this.nodes.values()) el.style.maxWidth = `${maxWidth}px`;
  }

  /** Coloca una etiqueta de nodo: (x, y) es la proyección del ancla, ya en px de pantalla. */
  placeNode(id: string, x: number, y: number, opacity: number) {
    const el = this.nodes.get(id);
    if (!el) return;
    el.style.transform = `translate(${x.toFixed(1)}px, ${(y + LABEL.gap).toFixed(1)}px) translate(-50%, 0)`;
    el.style.opacity = opacity.toFixed(3);
  }

  placeStage(i: number, x: number, y: number, opacity: number) {
    const el = this.stages[i];
    if (!el) return;
    el.style.transform = `translate(${x.toFixed(1)}px, ${(y - LABEL.headerGap).toFixed(1)}px) translate(-50%, -100%)`;
    el.style.opacity = opacity.toFixed(3);
  }

  setHover(id: string | null) {
    for (const [k, el] of this.nodes) el.classList.toggle('hover', k === id);
  }

  fallback(text: string) {
    const d = this.root.ownerDocument.createElement('div');
    d.className = 'sky-fallback';
    d.textContent = text;
    this.root.appendChild(d);
  }

  dispose() {
    this.root.remove();
    this.nodes.clear();
    this.stages = [];
  }
}
