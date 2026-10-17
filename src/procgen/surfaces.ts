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

/** Worn square flagstones with cracked corners and grime in the joints, for crypt floors. */
export function flagstones(seed = 17): SurfaceFn {
  const n = 4;
  return (u, v) => {
    const cu = u * n;
    const cv = v * n;
    const ix = Math.floor(cu);
    const iy = Math.floor(cv);
    const fu = cu - ix;
    const fv = cv - iy;
    const id = Math.abs((Math.sin((((ix % n) + n) % n) * 12.9898 + (((iy % n) + n) % n) * 78.233 + seed) * 43758.5453) % 1);
    const chip = fbm2(u * 30, v * 30, 4, seed + 4, 30) * 0.05;
    const e = Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv)) / n + chip;
    const block = smoothstep(0.003, 0.016, e);
    const vc = voronoi2(u * 7, v * 7, seed + 2, 7, 1);
    const crack = (1 - smoothstep(0, 0.02, vc.f2 - vc.f1)) * smoothstep(0.6, 0.8, fbm2(u * 5, v * 5, 3, seed + 3, 5) * 0.5 + 0.5);
    const surface = fbm2(u * 40, v * 40, 4, seed + 8, 40) * 0.5 + 0.5;
    const tilt = (fu - 0.5) * (id - 0.5) * 0.1 + (fv - 0.5) * (0.5 - id) * 0.08; // stones settle unevenly
    const height = clamp01(block * (0.75 + surface * 0.15 + tilt + id * 0.05) - crack * 0.3);
    const grime = smoothstep(0.2, 0.8, fbm2(u * 3, v * 3, 4, seed + 12, 3)) * 0.5;
    const tone = (0.05 + id * 0.04) * (0.85 + surface * 0.3) * (1 - grime * 0.45);
    const r = mix(0.015, tone, block) * (1 - crack * 0.6);
    const g = mix(0.013, tone * 0.93, block) * (1 - crack * 0.6);
    const b = mix(0.012, tone * 0.88, block) * (1 - crack * 0.6);
    return { height, r, g, b, rough: mix(0.95, 0.7, block * surface), ao: mix(0.45, 1, block) * (1 - crack * 0.3) };
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
  // Weathered sandstone-like rock: wavy strata bands, sparse hairline
  // fractures, pitting and a little lichen, rather than a cell pattern.
  return (u, v) => {
    const big = fbm2(u * 4, v * 4, 5, seed, 4) * 0.5 + 0.5;
    const warp = fbm2(u * 2, v * 2, 3, seed + 1, 2) * 0.08;
    const band = Math.sin((v + warp) * Math.PI * 2 * 6) * 0.5 + 0.5;
    const strata = smoothstep(0.75, 0.95, band);
    const c = voronoi2(u * 3, v * 3, seed + 3, 3, 1);
    const crack = 1 - smoothstep(0.0, 0.035, c.f2 - c.f1);
    const pits = smoothstep(0.55, 0.75, fbm2(u * 24, v * 24, 3, seed + 6, 24) * 0.5 + 0.5);
    const fine = fbm2(u * 48, v * 48, 3, seed + 5, 48) * 0.5 + 0.5;
    const height = clamp01(0.55 + big * 0.25 + fine * 0.12 - strata * 0.12 - crack * 0.35 - pits * 0.08);
    const lichen = smoothstep(0.64, 0.8, fbm2(u * 6 + 3, v * 6, 4, seed + 9, 6) * 0.5 + 0.5);
    const t = (0.045 + big * 0.045 + fine * 0.025 + band * 0.012) * (1 - crack * 0.6) * (1 - pits * 0.2);
    let r = t * 1.04;
    let g = t * 0.95;
    let b = t * 0.88;
    r = mix(r, 0.09, lichen * 0.55);
    g = mix(g, 0.078, lichen * 0.55);
    b = mix(b, 0.04, lichen * 0.55);
    return { height, r, g, b, rough: 0.86 - fine * 0.08 + crack * 0.1, ao: 1 - crack * 0.5 - pits * 0.15 };
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

/** Riveted mail: staggered rows of interlocking rings, dark between them. */
export function chainmail(seed = 10): SurfaceFn {
  const N = 16; // rings across the tile
  return (u, v) => {
    let height = 0;
    let ring = 0;
    // Each texel can be covered by rings from this row and the neighbours;
    // the highest ring wins, which reads as overlap.
    const ry = v * N;
    for (let dy = -1; dy <= 1; dy++) {
      const row = Math.floor(ry) + dy;
      const off = (((row % 2) + 2) % 2) * 0.5;
      const rx = u * N - off;
      for (let dx = -1; dx <= 1; dx++) {
        const col = Math.floor(rx) + dx;
        const cx = col + 0.5;
        const cy = row + 0.5;
        const ddx = rx - cx;
        const ddy = (ry - cy) * 1.25;
        const d = Math.hypot(ddx, ddy);
        const t = 1 - Math.abs(d - 0.42) / 0.13; // torus cross-section
        if (t <= 0) continue;
        // Rings lean: one side sits higher, so rows overlap the next.
        const h = Math.sqrt(t) * (0.75 + 0.25 * Math.sin(Math.atan2(ddy, ddx) + 0.8)) + (row & 1) * 0.04;
        if (h > height) {
          height = h;
          ring = t;
        }
      }
    }
    const grime = smoothstep(0.1, 0.7, fbm2(u * 3, v * 3, 4, seed, 3));
    const lit = ring > 0 ? 0.36 + ring * 0.2 : 0.03;
    const c = lit * (1 - grime * 0.45);
    return { height: clamp01(height), r: c, g: c * 0.97, b: c * 0.93, rough: ring > 0 ? 0.45 + grime * 0.3 : 0.9, metal: ring > 0 ? 1 : 0.2, ao: ring > 0 ? 1 : 0.3 };
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

/**
 * Diseased skin: mottled, wrinkled, with dark veins and sores. Neutral pale
 * albedo; each creature tints it through the material colour.
 */
export function flesh(seed = 13): SurfaceFn {
  return (u, v) => {
    const mottle = fbm2(u * 5, v * 5, 5, seed, 5) * 0.5 + 0.5;
    const pores = fbm2(u * 60, v * 60, 2, seed + 1, 60) * 0.5 + 0.5;
    const wr = fbm2(u * 9, v * 26, 3, seed + 2, 9) * 0.5 + 0.5; // stretched wrinkles
    const wrinkle = 1 - Math.abs(wr - 0.5) * 2;
    const vc = voronoi2(u * 6, v * 6, seed + 3, 6, 1);
    const vein = 1 - smoothstep(0.0, 0.035, vc.f2 - vc.f1 + (fbm2(u * 30, v * 30, 2, seed + 4, 30)) * 0.03);
    const sore = smoothstep(0.72, 0.8, fbm2(u * 7, v * 7, 3, seed + 5, 7) * 0.5 + 0.5);
    const t = (0.5 + mottle * 0.35 + pores * 0.1) * (1 - vein * 0.45) * (1 - wrinkle * 0.15);
    const r = mix(t * 0.62, 0.22, sore);
    const g = mix(t * 0.6, 0.03, sore);
    const b = mix(t * 0.56, 0.025, sore);
    return { height: 0.5 + pores * 0.1 - wrinkle * 0.2 - vein * 0.12 - sore * 0.2, r, g, b, rough: mix(0.6, 0.3, sore) - vein * 0.1, ao: 1 - wrinkle * 0.2 };
  };
}

/**
 * Weathered human skin: soft blotchy colour variation, fine pores, a few
 * pale scars and grime in the creases. Neutral albedo, tinted per creature.
 */
export function skin(seed = 15): SurfaceFn {
  return (u, v) => {
    const blotch = fbm2(u * 4, v * 4, 5, seed, 4) * 0.5 + 0.5;
    const ruddy = smoothstep(0.45, 0.8, fbm2(u * 7, v * 7, 4, seed + 1, 7) * 0.5 + 0.5);
    const pores = smoothstep(0.55, 0.75, fbm2(u * 90, v * 90, 2, seed + 2, 90) * 0.5 + 0.5);
    const fine = fbm2(u * 30, v * 30, 3, seed + 3, 30) * 0.5 + 0.5;
    const sc = fbm2(u * 3, v * 12, 3, seed + 4, 3);
    const scar = smoothstep(0.035, 0.0, Math.abs(sc)) * smoothstep(0.55, 0.7, fbm2(u * 2, v * 2, 3, seed + 5, 2) * 0.5 + 0.5);
    const grime = smoothstep(0.55, 0.9, fbm2(u * 5, v * 5, 4, seed + 6, 5) * 0.5 + 0.5);
    const t = (0.62 + blotch * 0.22 + fine * 0.08) * (1 - pores * 0.08) * (1 - grime * 0.3);
    const r = mix(t * 0.64, t * 0.7, ruddy) + scar * 0.08;
    const g = mix(t * 0.6, t * 0.5, ruddy) + scar * 0.07;
    const b = mix(t * 0.56, t * 0.45, ruddy) + scar * 0.07;
    return { height: 0.5 + fine * 0.15 - pores * 0.12 + scar * 0.15, r, g, b, rough: 0.55 + grime * 0.2 + pores * 0.1 - scar * 0.15, ao: 1 - pores * 0.1 };
  };
}

/** Coarse hair: long strands along V with clumps and flyaways. */
export function hair(seed = 16): SurfaceFn {
  return (u, v) => {
    const strand = fbm2(u * 160, v * 6, 3, seed, 160) * 0.5 + 0.5;
    const clump = fbm2(u * 18, v * 2, 3, seed + 1, 18) * 0.5 + 0.5;
    const t = 0.35 + strand * 0.45 + clump * 0.2;
    return { height: strand * 0.7 + clump * 0.3, r: t * 0.55, g: t * 0.5, b: t * 0.45, rough: 0.7 - strand * 0.2, ao: 0.7 + clump * 0.3 };
  };
}

/** Insect armour: overlapping glossy plates with sutures and pitting. */
export function chitin(seed = 14): SurfaceFn {
  return (u, v) => {
    const c = voronoi2(u * 5, v * 5, seed, 5, 1);
    const suture = 1 - smoothstep(0.0, 0.05, c.f2 - c.f1);
    const dome = clamp01(1 - c.f1 * 1.6);
    const pit = smoothstep(0.65, 0.72, fbm2(u * 40, v * 40, 2, seed + 1, 40) * 0.5 + 0.5);
    const sheen = fbm2(u * 3, v * 3, 3, seed + 2, 3) * 0.5 + 0.5;
    const t = (0.35 + dome * 0.3 + sheen * 0.2) * (1 - suture * 0.7) * (1 - pit * 0.4);
    return { height: dome * 0.6 + 0.3 - suture * 0.3 - pit * 0.1, r: t * 0.6, g: t * 0.55, b: t * 0.55, rough: 0.28 + suture * 0.4 + pit * 0.3, ao: 1 - suture * 0.4 };
  };
}


/** Sodden swamp mud: dark silt with moss mats, rotted leaf litter and pebbles. */
export function swampMud(seed = 19): SurfaceFn {
  return (u, v) => {
    const large = fbm2(u * 3, v * 3, 4, seed, 3) * 0.5 + 0.5;
    const moss = smoothstep(0.52, 0.68, fbm2(u * 6 + 2, v * 6, 5, seed + 3, 6) * 0.5 + 0.5 + large * 0.1);
    const clump = fbm2(u * 90, v * 90, 3, seed + 5, 90) * 0.5 + 0.5;
    const peb = voronoi2(u * 22, v * 22, seed + 7, 22, 1);
    const pebble = (1 - smoothstep(0.12, 0.2, peb.f1)) * smoothstep(0.55, 0.75, fbm2(u * 8, v * 8, 2, seed + 9, 8) * 0.5 + 0.5);
    const litter = smoothstep(0.62, 0.75, fbm2(u * 40, v * 40, 3, seed + 11, 40) * 0.5 + 0.5) * (1 - moss);
    const grain = fbm2(u * 64, v * 64, 3, seed + 13, 64) * 0.5 + 0.5;
    const height = clamp01(0.3 + large * 0.15 + moss * (0.25 + clump * 0.2) + pebble * 0.35 + litter * 0.1 + grain * 0.05);
    let r = mix(0.04, 0.06, large) * (0.85 + grain * 0.3);
    let g = mix(0.033, 0.05, large) * (0.85 + grain * 0.3);
    let b = mix(0.025, 0.035, large) * (0.85 + grain * 0.3);
    // Moss: dull olive, brighter on its tufts.
    r = mix(r, 0.05 * (0.7 + clump * 0.6), moss);
    g = mix(g, 0.07 * (0.7 + clump * 0.6), moss);
    b = mix(b, 0.02, moss);
    r = mix(r, 0.09, litter * 0.6);
    g = mix(g, 0.055, litter * 0.6);
    b = mix(b, 0.03, litter * 0.6);
    r = mix(r, 0.1, pebble);
    g = mix(g, 0.095, pebble);
    b = mix(b, 0.09, pebble);
    return { height, r, g, b, rough: mix(0.55, 0.9, moss * 0.7 + pebble * 0.3), ao: mix(0.6, 1, height) };
  };
}

/** Matted, wind-flattened turf gone grey with the blight: tussocks, bare scuffs and dead stems. */
export function turf(seed = 23): SurfaceFn {
  return (u, v) => {
    const large = fbm2(u * 3, v * 3, 4, seed, 3) * 0.5 + 0.5;
    // Blades: fine grain over a mid-scale clump pattern (real tufts are geometry).
    const blade = (fbm2(u * 110, v * 110, 2, seed + 4, 110) * 0.5 + 0.5) * 0.6 + (fbm2(u * 30, v * 30, 2, seed + 5, 30) * 0.5 + 0.5) * 0.4;
    const tuss = voronoi2(u * 14, v * 14, seed + 6, 14, 1);
    const tussock = 1 - smoothstep(0.1, 0.5, tuss.f1);
    const bare = smoothstep(0.6, 0.75, fbm2(u * 5 + 7, v * 5, 4, seed + 8, 5) * 0.5 + 0.5);
    const grain = fbm2(u * 64, v * 64, 3, seed + 10, 64) * 0.5 + 0.5;
    const dead = smoothstep(0.55, 0.8, fbm2(u * 20, v * 20, 3, seed + 12, 20) * 0.5 + 0.5);
    const height = clamp01(0.35 + tussock * 0.3 * (1 - bare) + blade * 0.25 * (1 - bare) + grain * 0.06 - bare * 0.15);
    // Grey-green, darker in the hollows between tussocks, straw-coloured where it died.
    const lit = 0.75 + blade * 0.45 + tussock * 0.2;
    let r = mix(0.035, 0.05, large) * lit;
    let g = mix(0.045, 0.062, large) * lit;
    let b = mix(0.04, 0.052, large) * lit;
    r = mix(r, 0.085 * lit, dead * 0.6);
    g = mix(g, 0.075 * lit, dead * 0.6);
    b = mix(b, 0.05 * lit, dead * 0.6);
    // Scuffed bare earth, red-brown like the soil by the road.
    r = mix(r, 0.07 * (0.8 + grain * 0.4), bare);
    g = mix(g, 0.04 * (0.8 + grain * 0.4), bare);
    b = mix(b, 0.03 * (0.8 + grain * 0.4), bare);
    return { height, r, g, b, rough: 0.9, ao: mix(0.55, 1, height) };
  };
}

/** Rust-red trodden soil with grit, pebbles and black leaf litter: the verges of the pilgrim road. */
export function redSoil(seed = 29): SurfaceFn {
  return (u, v) => {
    const large = fbm2(u * 3, v * 3, 4, seed, 3) * 0.5 + 0.5;
    const grain = fbm2(u * 72, v * 72, 3, seed + 3, 72) * 0.5 + 0.5;
    const peb = voronoi2(u * 26, v * 26, seed + 5, 26, 1);
    const pebble = (1 - smoothstep(0.1, 0.22, peb.f1)) * smoothstep(0.45, 0.7, fbm2(u * 7, v * 7, 2, seed + 7, 7) * 0.5 + 0.5);
    const litter = smoothstep(0.64, 0.78, fbm2(u * 36, v * 36, 3, seed + 9, 36) * 0.5 + 0.5);
    const rut = smoothstep(0.55, 0.85, fbm2(u * 4, v * 4, 3, seed + 11, 4) * 0.5 + 0.5);
    const height = clamp01(0.32 + large * 0.12 + grain * 0.08 + pebble * 0.42 + litter * 0.08 - rut * 0.08);
    let r = mix(0.05, 0.08, large) * (0.8 + grain * 0.35);
    let g = mix(0.028, 0.04, large) * (0.8 + grain * 0.3);
    let b = mix(0.022, 0.03, large) * (0.8 + grain * 0.3);
    r = mix(r, 0.025, litter * 0.8);
    g = mix(g, 0.02, litter * 0.8);
    b = mix(b, 0.018, litter * 0.8);
    r = mix(r, 0.09 * (0.7 + peb.id * 0.6), pebble);
    g = mix(g, 0.085 * (0.7 + peb.id * 0.6), pebble);
    b = mix(b, 0.085 * (0.7 + peb.id * 0.6), pebble);
    return { height, r, g, b, rough: mix(0.88, 0.6, pebble), ao: mix(0.55, 1, height) };
  };
}

/**
 * Blue-grey granite setts laid in running bond, like a brick path: long
 * rounded blocks in rows, each a slightly different shade, worn smooth on
 * top, with dark grit in the joints. The pilgrim road.
 */
export function setts(seed = 31): SurfaceFn {
  const ROWS = 12;
  const COLS = 6;
  const hash = (i: number, j: number) => {
    const x = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return (u, v) => {
    const rv = v * ROWS;
    const row = Math.floor(rv);
    const fy = rv - row;
    // Every other row is shifted by half a block, and each row wobbles a little.
    const shift = (row % 2) * 0.5 + (hash(row, 7) - 0.5) * 0.2;
    const cu = u * COLS + shift;
    const col = ((Math.floor(cu) % COLS) + COLS) % COLS;
    const fx = cu - Math.floor(cu);
    const id = hash(col, row);
    // Rounded-rectangle profile: distance from the block's edge in block units (x is twice as long).
    const ex = Math.min(fx, 1 - fx) * 2;
    const ey = Math.min(fy, 1 - fy);
    const jitter = fbm2(u * 40, v * 40, 2, seed + 3, 40) * 0.03;
    const edge = Math.min(ex * 1.05, ey) + jitter;
    const dome = smoothstep(0.02, 0.2, edge);
    const chips = smoothstep(0.62, 0.8, fbm2(u * 90, v * 90, 3, seed + 5, 90) * 0.5 + 0.5);
    const grain = fbm2(u * 160, v * 160, 2, seed + 9, 160) * 0.5 + 0.5;
    const height = clamp01(dome * (0.62 + id * 0.12) + grain * 0.06 - chips * 0.08 * dome);
    const tone = mix(0.07, 0.13, id) * (0.85 + grain * 0.3) * (1 - chips * 0.25);
    const grit = 1 - dome;
    const moss = smoothstep(0.55, 0.8, fbm2(u * 9, v * 9, 3, seed + 11, 9) * 0.5 + 0.5) * grit;
    let r = tone * 0.8;
    let g = tone * 0.93;
    let b = tone * 1.1;
    r = mix(r, 0.018, grit * 0.9);
    g = mix(g, 0.018, grit * 0.9);
    b = mix(b, 0.016, grit * 0.9);
    r = mix(r, 0.03, moss);
    g = mix(g, 0.045, moss);
    b = mix(b, 0.03, moss);
    return { height, r, g, b, rough: mix(0.95, 0.55, dome * (0.5 + grain * 0.5)), ao: mix(0.35, 1, dome) };
  };
}

export const SURFACES = { setts, turf, redSoil, swampMud, flesh, skin, hair, flagstones, chitin, cobblestone, crackedEarth, stoneBricks, woodPlanks, deadBark, roughStone, wornMetal, chainmail, cloth, linen, slate, plaster } as const;
export type SurfaceKind = keyof typeof SURFACES;
