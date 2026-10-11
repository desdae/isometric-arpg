import * as THREE from 'three';
import { clamp01, fbm2, smoothstep } from './noise';
import { bakeSurfaceData, SURFACES, type SurfaceData, type SurfaceKind } from './surfaces';

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

