// Cielo de fondo (portado del preview): dos capas de campo estelar y la grilla celeste inclinada como la eclíptica.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Points,
  PointsMaterial,
  type Texture,
} from 'three';

/** PRNG determinista: el mismo cielo en cada carga (y en cada captura). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function starfield(rand: () => number, dot: Texture, count: number, rMin: number, rMax: number, size: number, opacity: number): Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const warm = new Color(0xffe2c0), cool = new Color(0xc8dcff), w = new Color(0xffffff), tmp = new Color();
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = rMin + rand() * (rMax - rMin);
    const sq = Math.sqrt(1 - u * u);
    pos.set([r * sq * Math.cos(th), r * u, r * sq * Math.sin(th)], i * 3);
    const k = rand();
    tmp.copy(w).lerp(k < 0.5 ? warm : cool, rand() * 0.6).multiplyScalar(0.35 + rand() * 0.65);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  const m = new PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending, fog: false, sizeAttenuation: true });
  return new Points(g, m);
}

function celestialGrid(): LineSegments {
  const R = 260;
  const pts: number[] = [];
  for (let lat = -75; lat <= 75; lat += 15) {
    const phi = MathUtils.degToRad(lat);
    for (let i = 0; i < 96; i++) {
      const a1 = (i / 96) * Math.PI * 2, a2 = ((i + 1) / 96) * Math.PI * 2;
      pts.push(R * Math.cos(phi) * Math.cos(a1), R * Math.sin(phi), R * Math.cos(phi) * Math.sin(a1), R * Math.cos(phi) * Math.cos(a2), R * Math.sin(phi), R * Math.cos(phi) * Math.sin(a2));
    }
  }
  for (let lon = 0; lon < 360; lon += 15) {
    const th = MathUtils.degToRad(lon);
    for (let i = 0; i < 64; i++) {
      const p1 = -Math.PI / 2 + (i / 64) * Math.PI, p2 = -Math.PI / 2 + ((i + 1) / 64) * Math.PI;
      pts.push(R * Math.cos(p1) * Math.cos(th), R * Math.sin(p1), R * Math.cos(p1) * Math.sin(th), R * Math.cos(p2) * Math.cos(th), R * Math.sin(p2), R * Math.cos(p2) * Math.sin(th));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const m = new LineBasicMaterial({ color: 0x16202f, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
  const l = new LineSegments(g, m);
  l.rotation.z = 0.41; // la oblicuidad de la eclíptica, 23,4°
  return l;
}

export function buildBackdrop(dot: Texture): Group {
  const rand = mulberry32(20261003);
  const sky = new Group();
  sky.add(starfield(rand, dot, 4200, 380, 700, 2.2, 0.75));
  sky.add(starfield(rand, dot, 900, 300, 600, 4.2, 0.55));
  sky.add(celestialGrid());
  return sky;
}
