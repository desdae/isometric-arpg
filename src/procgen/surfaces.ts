import { clamp01, fbm2, mulberry32, perlin2, smoothstep, voronoi2 } from './noise';

// Procedural PBR texture sets. Each generator describes a surface as a function
// of tileable UV coordinates; the baker turns that into albedo, normal and an
// ORM map (R = ambient occlusion, G = roughness, B = metalness), which is the
// channel layout three.js expects when one texture feeds all three slots.
// This module has no three.js dependency so it can run inside bake workers.

export interface SurfaceSample {
  height: number; // 0..1
  r: number; // linear albedo 0..1 (stored sRGB-encoded)
  g: number;
  b: number;
  rough: number;
  ao?: number;
  metal?: number;
}

export type SurfaceFn = (u: number, v: number) => SurfaceSample;

export interface SurfaceData {
  albedo: Uint8Array;
  normal: Uint8Array;
  orm: Uint8Array;
  size: number;
}

/** Generators work in linear albedo; textures are stored sRGB-encoded. */
export function toSrgbByte(linear: number): number {
  const c = clamp01(linear);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** Bakes a surface function into tileable albedo / normal / ORM pixel data. */
export function bakeSurfaceData(fn: SurfaceFn, size = 512, normalStrength = 6): SurfaceData {
  const n = size * size;
  const height = new Float32Array(n);
  const albedo = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  const aoField = new Float32Array(n);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const s = fn(x / size, y / size);
      height[i] = s.height;
      albedo[i * 4] = toSrgbByte(s.r);
      albedo[i * 4 + 1] = toSrgbByte(s.g);
      albedo[i * 4 + 2] = toSrgbByte(s.b);
      albedo[i * 4 + 3] = 255;
      aoField[i] = s.ao ?? 1;
      orm[i * 4 + 1] = Math.round(clamp01(s.rough) * 255);
      orm[i * 4 + 2] = Math.round(clamp01(s.metal ?? 0) * 255);
      orm[i * 4 + 3] = 255;
    }
  }

  // Normals from height via wrapped central differences, plus a cheap cavity
  // term so crevices darken even where the generator gave no explicit AO.
  const normal = new Uint8Array(n * 4);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // Scale by resolution so a given strength looks the same at any size.
      const dx = (h(x + 1, y) - h(x - 1, y)) * normalStrength * (size / 512);
      const dy = (h(x, y + 1) - h(x, y - 1)) * normalStrength * (size / 512);
      const len = Math.hypot(dx, dy, 1);
      normal[i * 4] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      normal[i * 4 + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      normal[i * 4 + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      normal[i * 4 + 3] = 255;

      let avg = 0;
      for (let k = 1; k <= 3; k++) {
        const r = k * 2;
        avg += (h(x + r, y) + h(x - r, y) + h(x, y + r) + h(x, y - r)) * 0.25;
      }
      avg /= 3;
      const cavity = clamp01(1 - Math.max(0, avg - height[i]) * 4);
      orm[i * 4] = Math.round(clamp01(aoField[i] * cavity) * 255);
    }
  }

  return { albedo, normal, orm, size };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Dark, uneven cobblestones like the town streets. */
export function cobblestone(seed = 1): SurfaceFn {
  const cells = 16;
  return (u, v) => {
    const wu = u * cells + fbm2(u * 6, v * 6, 3, seed, 6) * 0.3;
    const wv = v * cells + fbm2(u * 6 + 9, v * 6, 3, seed + 3, 6) * 0.3;
    const c = voronoi2(wu, wv, seed, cells, 0.8);
    const edge = c.f2 - c.f1;
    // Rounded tops: rise quickly from the gap, then flatten.
    const stone = smoothstep(0.02, 0.26, edge);
    const bumps = fbm2(u * 40, v * 40, 4, seed + 11, 40) * 0.5 + 0.5;
    const height = clamp01(Math.pow(stone, 0.6) * (0.8 + 0.2 * bumps) + (c.id - 0.5) * 0.12 * stone);

    // Per-stone tone (some notably darker), grime and fine speckle.
    const dark = c.id < 0.2 ? 0.55 : 1;
    const tone = (0.045 + c.id * 0.05) * dark;
    const grime = fbm2(u * 4, v * 4, 4, seed + 21, 4) * 0.5 + 0.5;
    const worn = smoothstep(0.5, 1, stone) * 0.25; // polished stone tops
    let r = tone * (0.9 + bumps * 0.25 + worn);
    let g = tone * (0.86 + bumps * 0.2 + worn);
    let b = tone * (0.84 + bumps * 0.18 + worn);
    const mud = 1 - stone;
    r = mix(r, 0.022, mud);
    g = mix(g, 0.016, mud);
    b = mix(b, 0.013, mud);
    r *= 0.85 + grime * 0.3;
    g *= 0.85 + grime * 0.28;
    b *= 0.85 + grime * 0.26;

    // Blood and wetness are applied in world space by the ground shader so
    // they don't repeat with the tile.
    const rough = clamp01(0.78 - worn * 0.6 + mud * 0.15);
    return { height, r, g, b, rough, ao: mix(0.35, 1, stone) };
  };
}

/** Cracked, dried earth with dead grass patches, for the blighted zone. */
export function crackedEarth(seed = 2): SurfaceFn {
  const cells = 12;
  return (u, v) => {
    const wu = u * cells + fbm2(u * 5, v * 5, 4, seed, 5) * 0.4;
    const wv = v * cells + fbm2(u * 5 + 3, v * 5, 4, seed + 1, 5) * 0.4;
    const c = voronoi2(wu, wv, seed, cells, 1);
    const fine = voronoi2(u * cells * 3, v * cells * 3, seed + 9, cells * 3, 1);
    const crack = 1 - smoothstep(0.0, 0.06, c.f2 - c.f1);
    const fineCrack = (1 - smoothstep(0.0, 0.04, fine.f2 - fine.f1)) * 0.5;
    const grain = fbm2(u * 64, v * 64, 3, seed + 5, 64) * 0.5 + 0.5;
    const plate = 0.7 + 0.3 * (1 - c.f1);
    const height = clamp01(plate * (1 - crack) * (1 - fineCrack * 0.6) * (0.9 + grain * 0.1));

    const large = fbm2(u * 3, v * 3, 4, seed + 30, 3) * 0.5 + 0.5;
    let r = mix(0.045, 0.085, large) * (0.8 + grain * 0.35);
    let g = mix(0.036, 0.064, large) * (0.8 + grain * 0.3);
    let b = mix(0.03, 0.05, large) * (0.8 + grain * 0.3);

    // Grass is placed as real geometry, so the tile stays bare to avoid visible repeats.
    const dark = 1 - crack * 0.85;
    return { height, r: r * dark, g: g * dark, b: b * dark, rough: 0.92, ao: 1 - crack * 0.7 };
  };
}

/** Rough-cut, chipped stone blocks with dark mortar for gothic walls. */
export function stoneBricks(seed = 3): SurfaceFn {
  const rows = 8;
  const cols = 4;
  const rng = mulberry32(seed);
  const rowOffsets = Array.from({ length: rows }, () => rng() * 0.5);
  return (u, v) => {
    const row = Math.floor(v * rows);
    const fv = v * rows - row;
    const off = (row % 2) * 0.5 + rowOffsets[row] * 0.3;
    const cu = u * cols + off;
    const col = Math.floor(cu);
    const fu = cu - col;
    const id = (Math.sin((((col % cols) + cols) % cols) * 12.9898 + row * 78.233) * 43758.5453) % 1;
    const idAbs = Math.abs(id);

    const chip = fbm2(u * 24, v * 24, 4, seed + 4, 24) * 0.06;
    const ex = Math.min(fu, 1 - fu) / cols;
    const ey = Math.min(fv, 1 - fv) / rows;
    const e = Math.min(ex * 2, ey) + chip;
    const block = smoothstep(0.004, 0.02, e);
    const surface = fbm2(u * 48, v * 48, 4, seed + 8, 48) * 0.5 + 0.5;
    const height = clamp01(block * (0.8 + surface * 0.2 + idAbs * 0.05));

    const tone = 0.05 + idAbs * 0.05;
    const stain = smoothstep(0.0, 0.5, fbm2(u * 3, v * 2, 4, seed + 12, 2)) * 0.5;
    let r = tone * (0.9 + surface * 0.2);
    let g = tone * (0.86 + surface * 0.18);
    let b = tone * (0.85 + surface * 0.16);
    r = mix(r, 0.02, 1 - block);
    g = mix(g, 0.017, 1 - block);
    b = mix(b, 0.015, 1 - block);
    // Soot streaks running down from the top.
    const soot = stain * smoothstep(0.2, 1, perlin2(u * 20, v * 2, seed + 16, 20) * 0.5 + 0.5);
    r *= 1 - soot * 0.5;
    g *= 1 - soot * 0.5;
    b *= 1 - soot * 0.5;
    return { height, r, g, b, rough: mix(0.95, 0.75, block * surface), ao: mix(0.5, 1, block) };
  };
}

/** Weathered dark wooden planks. */
export function woodPlanks(seed = 4): SurfaceFn {
  const planks = 5;
  return (u, v) => {
    const p = Math.floor(u * planks);
    const fu = u * planks - p;
    const pid = Math.abs((Math.sin(p * 91.7 + seed) * 43758.5453) % 1);
    const grainWarp = fbm2(u * 4, v * 1, 3, seed + p, 0) * 2;
    const grain = Math.sin((u * planks * 40 + grainWarp * 6 + pid * 10) * 1.0) * 0.5 + 0.5;
    const fine = fbm2(u * 80, v * 8, 3, seed + 20, 0) * 0.5 + 0.5;
    const gap = smoothstep(0.0, 0.04, Math.min(fu, 1 - fu));
    const height = clamp01(gap * (0.85 + grain * 0.1 + fine * 0.05));
    const tone = 0.035 + pid * 0.03;
    const r = tone * (1.2 + grain * 0.25) * gap + 0.02 * (1 - gap);
    const g = tone * (0.85 + grain * 0.18) * gap + 0.015 * (1 - gap);
    const b = tone * (0.6 + grain * 0.1) * gap + 0.012 * (1 - gap);
    return { height, r, g, b, rough: 0.85 - fine * 0.1, ao: mix(0.4, 1, gap) };
  };
}

/** Deep-ridged dead bark for gnarled trees. */
export function deadBark(seed = 5): SurfaceFn {
  return (u, v) => {
    const warp = fbm2(u * 6, v * 2, 3, seed, 6) * 0.6;
    const ridges = Math.abs(perlin2(u * 14 + warp, v * 2.5, seed + 2, 14));
    const ridge = 1 - smoothstep(0, 0.35, ridges);
    const fine = fbm2(u * 50, v * 20, 3, seed + 6, 50) * 0.5 + 0.5;
    const height = clamp01(0.3 + ridge * 0.6 + fine * 0.1);
    const t = 0.025 + ridge * 0.03 + fine * 0.01;
    return { height, r: t * 1.05, g: t * 0.92, b: t * 0.82, rough: 0.95, ao: mix(0.5, 1, ridge) };
  };
}

/** Weathered dark rock for boulders and rubble. */
export function roughStone(seed = 7): SurfaceFn {
  return (u, v) => {
    const big = fbm2(u * 4, v * 4, 5, seed, 4) * 0.5 + 0.5;
    const c = voronoi2(u * 7, v * 7, seed + 3, 7, 1);
    const facet = smoothstep(0.0, 0.25, c.f2 - c.f1);
    const fine = fbm2(u * 48, v * 48, 3, seed + 5, 48) * 0.5 + 0.5;
    const height = clamp01(big * 0.6 + facet * 0.3 + fine * 0.1);
    const lichen = smoothstep(0.62, 0.78, fbm2(u * 6 + 3, v * 6, 4, seed + 9, 6) * 0.5 + 0.5);
    const t = 0.04 + big * 0.05 + fine * 0.02;
    let r = t;
    let g = t * 0.94;
    let b = t * 0.9;
    r = mix(r, 0.09, lichen * 0.6);
    g = mix(g, 0.075, lichen * 0.6);
    b = mix(b, 0.04, lichen * 0.6);
    return { height, r, g, b, rough: 0.88 - fine * 0.1, ao: mix(0.6, 1, facet) };
  };
}

/** Battle-worn steel: brushed base, scratches, dents and grime in recesses. */
export function wornMetal(seed = 8): SurfaceFn {
  const rng = mulberry32(seed);
  const scratches = Array.from({ length: 60 }, () => ({
    x: rng(), y: rng(), a: rng() * Math.PI, len: 0.05 + rng() * 0.25, w: 0.0015 + rng() * 0.003,
  }));
  return (u, v) => {
    const brush = fbm2(u * 4, v * 120, 3, seed, 4) * 0.5 + 0.5;
    const dents = fbm2(u * 6, v * 6, 4, seed + 3, 6);
    const grime = smoothstep(0.1, 0.6, fbm2(u * 3 + 5, v * 3, 5, seed + 7, 3));
    let scratch = 0;
    for (const s of scratches) {
      // Distance to a wrapped line segment.
      let dx = u - s.x;
      let dy = v - s.y;
      dx -= Math.round(dx);
      dy -= Math.round(dy);
      const ca = Math.cos(s.a);
      const sa = Math.sin(s.a);
      const along = dx * ca + dy * sa;
      if (Math.abs(along) > s.len / 2) continue;
      const across = Math.abs(-dx * sa + dy * ca);
      scratch = Math.max(scratch, 1 - smoothstep(0, s.w, across));
    }
    const height = clamp01(0.6 + dents * 0.25 - scratch * 0.15);
    const base = 0.42 + brush * 0.08;
    const g = base * (1 - grime * 0.55) + scratch * 0.2;
    return {
      height,
      r: g,
      g: g * 0.98,
      b: g * 0.96,
      rough: clamp01(0.32 + brush * 0.1 + grime * 0.4 - scratch * 0.2),
      metal: clamp01(1 - grime * 0.5),
      ao: 1 - grime * 0.25,
    };
  };
}

/** Coarse woven cloth, dyed dark crimson and frayed with dirt. */
export function cloth(seed = 9): SurfaceFn {
  return (u, v) => {
    const weaveU = Math.sin(u * 2 * Math.PI * 96) * 0.5 + 0.5;
    const weaveV = Math.sin(v * 2 * Math.PI * 96) * 0.5 + 0.5;
    const weave = Math.max(weaveU * (Math.floor(v * 96) % 2), weaveV * (Math.floor(u * 96) % 2));
    const dirt = smoothstep(0.0, 0.6, fbm2(u * 4, v * 4, 5, seed, 4));
    const fine = fbm2(u * 30, v * 30, 3, seed + 2, 30) * 0.5 + 0.5;
    const t = 0.55 + weave * 0.25 + fine * 0.2;
    const r = 0.16 * t * (1 - dirt * 0.5);
    const g = 0.018 * t * (1 - dirt * 0.3) + dirt * 0.012;
    const b = 0.016 * t;
    return { height: 0.5 + weave * 0.3 + fine * 0.2, r, g, b, rough: 0.92, ao: 1 };
  };
}

/** Undyed coarse linen / wool; tinted per garment through material colour. */
export function linen(seed = 10): SurfaceFn {
  return (u, v) => {
    const wu = Math.sin(u * 2 * Math.PI * 80) * 0.5 + 0.5;
    const wv = Math.sin(v * 2 * Math.PI * 80) * 0.5 + 0.5;
    const weave = Math.max(wu * (Math.floor(v * 80) % 2), wv * (Math.floor(u * 80) % 2));
    const dirt = smoothstep(0.0, 0.7, fbm2(u * 3, v * 3, 5, seed, 3));
    const fine = fbm2(u * 24, v * 24, 3, seed + 2, 24) * 0.5 + 0.5;
    const t = (0.5 + weave * 0.2 + fine * 0.25) * (1 - dirt * 0.45);
    return { height: 0.5 + weave * 0.3 + fine * 0.2, r: t * 0.55, g: t * 0.52, b: t * 0.47, rough: 0.95, ao: 1 - dirt * 0.2 };
  };
}

/** Grey slate roof tiles in staggered courses, chipped and stained. */
export function slate(seed = 11): SurfaceFn {
  const rows = 8;
  const cols = 6;
  return (u, v) => {
    const row = Math.floor(v * rows);
    const fv = v * rows - row;
    const cu = u * cols + (row % 2) * 0.5;
    const col = Math.floor(cu);
    const fu = cu - col;
    const id = Math.abs(Math.sin((((col % cols) + cols) % cols) * 17.3 + row * 47.1 + seed) * 43758.5453) % 1;
    const chip = fbm2(u * 30, v * 30, 3, seed + 3, 30) * 0.08;
    const edge = Math.min(Math.min(fu, 1 - fu) / cols * 2.2, (1 - fv) / rows) + chip;
    const tile = smoothstep(0.003, 0.012, edge);
    // Each tile is thicker at its lower edge, overlapping the course below.
    const height = clamp01(tile * (0.4 + fv * 0.6) + id * 0.05);
    const stain = smoothstep(0.1, 0.7, fbm2(u * 2, v * 2, 4, seed + 7, 2));
    const t = (0.035 + id * 0.035) * (1 - stain * 0.4);
    const r = mix(0.01, t * 0.95, tile);
    const g = mix(0.01, t, tile);
    const b = mix(0.012, t * 1.08, tile);
    return { height, r, g, b, rough: 0.6 + stain * 0.3, ao: mix(0.4, 1, tile) };
  };
}

/** Dirty lime plaster with cracks, for timber-framed panels. */
export function plaster(seed = 12): SurfaceFn {
  return (u, v) => {
    const big = fbm2(u * 3, v * 3, 5, seed, 3) * 0.5 + 0.5;
    const c = voronoi2(u * 5, v * 5, seed + 2, 5, 1);
    const crack = 1 - smoothstep(0, 0.025, c.f2 - c.f1 + fbm2(u * 20, v * 20, 2, seed + 4, 20) * 0.02);
    const fine = fbm2(u * 40, v * 40, 3, seed + 5, 40) * 0.5 + 0.5;
    const grime = smoothstep(0.3, 1, 1 - v + fbm2(u * 6, v * 2, 3, seed + 9, 6) * 0.5) * 0.6;
    const t = (0.16 + big * 0.06 + fine * 0.03) * (1 - grime * 0.6) * (1 - crack * 0.6);
    return { height: clamp01(0.6 + fine * 0.2 - crack * 0.5), r: t, g: t * 0.9, b: t * 0.78, rough: 0.95 };
  };
}

export const SURFACES = { cobblestone, crackedEarth, stoneBricks, woodPlanks, deadBark, roughStone, wornMetal, cloth, linen, slate, plaster } as const;
export type SurfaceKind = keyof typeof SURFACES;
