import * as THREE from 'three';
import { clamp01, fbm2, mulberry32, smoothstep } from './noise';
import { bakeSurfaceData, SURFACES, toSrgbByte, type SurfaceData, type SurfaceKind } from './surfaces';

// Turns baked surface data into three.js textures. Baking runs on a pool of
// workers so several large texture sets generate in parallel off the main
// thread.

export interface PbrSet {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  ormMap: THREE.DataTexture;
}

export interface BakeRequest {
  kind: SurfaceKind;
  seed: number;
  size?: number;
  normalStrength?: number;
}

function toTexture(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function toPbrSet(d: SurfaceData): PbrSet {
  return {
    map: toTexture(d.albedo, d.size, true),
    normalMap: toTexture(d.normal, d.size, false),
    ormMap: toTexture(d.orm, d.size, false),
  };
}

/** Synchronous bake on the calling thread. */
export function bakeSurface(req: BakeRequest): PbrSet {
  return toPbrSet(bakeSurfaceData(SURFACES[req.kind](req.seed), req.size ?? 512, req.normalStrength ?? 6));
}

/** Bakes many surfaces in parallel on workers, falling back to the main thread. */
export async function bakeSurfaces(reqs: BakeRequest[]): Promise<PbrSet[]> {
  if (typeof Worker === 'undefined') return reqs.map(bakeSurface);
  try {
    return await bakeOnWorkers(reqs);
  } catch {
    // Some sandboxes refuse module workers; bake on the main thread instead.
    return reqs.map(bakeSurface);
  }
}

async function bakeOnWorkers(reqs: BakeRequest[]): Promise<PbrSet[]> {
  const poolSize = Math.max(1, Math.min(reqs.length, (navigator.hardwareConcurrency || 4) - 1));
  const workers = Array.from(
    { length: poolSize },
    () => new Worker(new URL('./bakeWorker.ts', import.meta.url), { type: 'module' }),
  );
  const results: PbrSet[] = new Array(reqs.length);
  let next = 0;
  await Promise.all(
    workers.map(async (w) => {
      while (next < reqs.length) {
        const i = next++;
        const data = await new Promise<SurfaceData>((resolve, reject) => {
          w.onmessage = (e: MessageEvent<SurfaceData>) => resolve(e.data);
          w.onerror = (e) => reject(e);
          w.postMessage(reqs[i]);
        });
        results[i] = toPbrSet(data);
      }
      w.terminate();
    }),
  );
  return results;
}

export function pbrMaterial(set: PbrSet, repeat: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    aoMap: set.ormMap,
    roughnessMap: set.ormMap,
    metalnessMap: set.ormMap,
    roughness: 1,
    metalness: 1,
    ...extra,
  });
  for (const t of [set.map, set.normalMap, set.ormMap]) t.repeat.set(repeat, repeat);
  return mat;
}

/** Soft tileable noise used for fog/mist sprites (alpha in the red channel). */
export function mistTexture(size = 256, seed = 6): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const radial = 1 - smoothstep(0.15, 0.5, Math.hypot(dx, dy));
      const n = fbm2(u * 5, v * 5, 5, seed) * 0.5 + 0.5;
      const a = clamp01(radial * smoothstep(0.3, 0.8, n) * 1.4);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}


/**
 * Leaded medieval glazing: diamond quarries held in lead cames. The panes are
 * greenish, uneven and filmed with grime (thicker toward the bottom of each
 * pane and in patches), so they let only a murky view through. Returns an
 * RGBA albedo/alpha map for unlit windows and an emissive map for windows
 * with a fire or candles behind them. One texture tile holds 3 x 2 diamonds.
 */
export function leadedGlassTextures(size = 256, seed = 41): { map: THREE.DataTexture; emissive: THREE.DataTexture } {
  const albedo = new Uint8Array(size * size * 4);
  const glow = new Uint8Array(size * size * 4);
  const rng = mulberry32(seed);
  const paneTint: number[] = [];
  for (let i = 0; i < 64; i++) paneTint.push(rng());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Diamond lattice: rotate into a grid where each cell is one quarry.
      const a = u * 3 + v * 2;
      const b = u * 3 - v * 2;
      const fa = a - Math.floor(a);
      const fb = b - Math.floor(b);
      const lead = Math.min(fa, 1 - fa, fb, 1 - fb);
      const came = 1 - smoothstep(0.035, 0.06, lead);
      const id = paneTint[(((Math.floor(a) * 7 + Math.floor(b) * 13) % 64) + 64) % 64];
      // Grime: patchy film plus dirt gathered along the lower edges of each pane.
      const film = fbm2(u * 6, v * 6, 4, seed, 6) * 0.5 + 0.5;
      const edgeDirt = 1 - smoothstep(0.06, 0.22, lead);
      const grime = clamp01(film * 0.7 + edgeDirt * 0.5 + id * 0.15);
      // Seeds and ripples in hand-blown glass.
      const ripple = fbm2(u * 24, v * 24, 2, seed + 5, 24) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      const gr = 0.32 + id * 0.12 + ripple * 0.08;
      const pane = [gr * 0.82, gr, gr * 0.62].map((c) => c * (1 - grime * 0.55));
      const lc = 0.035;
      for (let k = 0; k < 3; k++) albedo[i + k] = toSrgbByte(came > 0.5 ? lc : pane[k]);
      albedo[i + 3] = Math.round(255 * (came > 0.5 ? 1 : clamp01(0.45 + grime * 0.45)));
      // Lit: warm light through the panes, dimmed by grime, cames block it.
      const warm = (1 - came) * (1 - grime * 0.65) * (0.75 + ripple * 0.25) * (0.8 + id * 0.3);
      glow[i] = toSrgbByte(warm);
      glow[i + 1] = toSrgbByte(warm * 0.62);
      glow[i + 2] = toSrgbByte(warm * 0.3);
      glow[i + 3] = 255;
    }
  }
  const mk = (data: Uint8Array) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(albedo), emissive: mk(glow) };
}
