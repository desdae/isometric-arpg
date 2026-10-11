// Seeded random numbers and noise functions. Everything procedural in the game
// draws from these so a given seed always produces the same world.

export type Rng = () => number;

/** Fast 32-bit seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const range = (rng: Rng, min: number, max: number) => min + (max - min) * rng();
export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

/** Integer lattice hash -> [0, 1). */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 2D gradient noise in roughly [-1, 1]. Optional period makes it tile. */
export function perlin2(x: number, y: number, seed = 0, period = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const g = (ix: number, iy: number, dx: number, dy: number) => {
    if (period > 0) {
      ix = ((ix % period) + period) % period;
      iy = ((iy % period) + period) % period;
    }
    const a = hash2(ix, iy, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const u = fade(xf);
  const v = fade(yf);
  const n00 = g(xi, yi, xf, yf);
  const n10 = g(xi + 1, yi, xf - 1, yf);
  const n01 = g(xi, yi + 1, xf, yf - 1);
  const n11 = g(xi + 1, yi + 1, xf - 1, yf - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.414;
}

/** 3D value-gradient noise in roughly [-1, 1]. */
export function perlin3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const g = (ix: number, iy: number, iz: number, dx: number, dy: number, dz: number) => {
    const h = hash3(ix, iy, iz, seed);
    const theta = h * Math.PI * 2;
    const phi = Math.acos(2 * hash3(iz, ix, iy, seed + 17) - 1);
    return Math.sin(phi) * Math.cos(theta) * dx + Math.sin(phi) * Math.sin(theta) * dy + Math.cos(phi) * dz;
  };
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);
  const x00 = lerp(g(xi, yi, zi, xf, yf, zf), g(xi + 1, yi, zi, xf - 1, yf, zf), u);
  const x10 = lerp(g(xi, yi + 1, zi, xf, yf - 1, zf), g(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf), u);
  const x01 = lerp(g(xi, yi, zi + 1, xf, yf, zf - 1), g(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), u);
  const x11 = lerp(g(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), g(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 1.5;
}

/** Fractal brownian motion over 2D noise. */
export function fbm2(x: number, y: number, octaves = 5, seed = 0, period = 0, gain = 0.5, lacunarity = 2): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin2(x * freq, y * freq, seed + i * 31, period > 0 ? period * freq : 0);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function fbm3(x: number, y: number, z: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin3(x * freq, y * freq, z * freq, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export interface VoronoiSample {
  /** Distance to nearest feature point. */
  f1: number;
  /** Distance to second nearest feature point. */
  f2: number;
  /** Stable random id of the nearest cell, in [0, 1). */
  id: number;
  /** Offset from the sample to the nearest cell's center. */
  cx: number;
  cy: number;
}

/** Tileable 2D Worley/Voronoi noise. Coordinates are in cell units; period in cells. */
export function voronoi2(x: number, y: number, seed = 0, period = 0, jitter = 0.9): VoronoiSample {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  let id = 0;
  let cx = 0;
  let cy = 0;
  // A 3x3 neighbourhood is exact for F1 and very close for F2 at jitter <= 1.
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      let gx = xi + i;
      let gy = yi + j;
      if (period > 0) {
        gx = ((gx % period) + period) % period;
        gy = ((gy % period) + period) % period;
      }
      const px = xi + i + 0.5 + (hash2(gx, gy, seed) - 0.5) * jitter;
      const py = yi + j + 0.5 + (hash2(gx, gy, seed + 101) - 0.5) * jitter;
      const dx = px - x;
      const dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(gx, gy, seed + 7);
        cx = dx;
        cy = dy;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, f2, id, cx, cy };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
