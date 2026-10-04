// Texturas generadas en canvas (portadas del preview): halo, picos de difracción, retícula y punto.
import { CanvasTexture, SRGBColorSpace } from 'three';

function tex(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 256): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (g) draw(g, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface SkyTextures {
  glow: CanvasTexture;
  spike: CanvasTexture;
  ring: CanvasTexture;
  dot: CanvasTexture;
  dispose(): void;
}

export function makeTextures(): SkyTextures {
  const glow = tex((g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.08, 'rgba(255,255,255,.9)');
    r.addColorStop(0.22, 'rgba(255,255,255,.28)');
    r.addColorStop(0.5, 'rgba(255,255,255,.06)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
  // picos de difracción de un reflector con soporte de 4 brazos
  const spike = tex((g, s) => {
    const m = s / 2;
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const lg = g.createLinearGradient(m - dx * m, m - dy * m, m + dx * m, m + dy * m);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.42, 'rgba(255,255,255,.18)');
      lg.addColorStop(0.5, 'rgba(255,255,255,.95)');
      lg.addColorStop(0.58, 'rgba(255,255,255,.18)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = lg;
      g.lineWidth = s * 0.012;
      g.beginPath();
      g.moveTo(m - dx * m, m - dy * m);
      g.lineTo(m + dx * m, m + dy * m);
      g.stroke();
    }
  });
  // anillo con marcas de retícula, como la de un buscador
  const ring = tex((g, s) => {
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = s * 0.018;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = s * 0.012;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.beginPath();
      g.moveTo(s / 2 + Math.cos(a) * s * 0.36, s / 2 + Math.sin(a) * s * 0.36);
      g.lineTo(s / 2 + Math.cos(a) * s * 0.48, s / 2 + Math.sin(a) * s * 0.48);
      g.stroke();
    }
  });
  const dot = tex((g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,.5)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  }, 64);
  return {
    glow,
    spike,
    ring,
    dot,
    dispose() {
      for (const t of [glow, spike, ring, dot]) t.dispose();
    },
  };
}
