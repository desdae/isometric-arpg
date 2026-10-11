import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxProjectUVs } from './geometry';

// Collects transformed geometry per material slot and merges each slot into a
// single mesh, so a whole building costs a handful of draw calls.

export class MeshBuilder {
  private parts = new Map<string, THREE.BufferGeometry[]>();

  /**
   * Adds geometry under a material key. `uvScale` re-projects UVs in world
   * space after transforming (pass 0 to keep the geometry's own UVs).
   */
  add(key: string, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4, uvScale = 0.5) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (uvScale > 0 || !g.getAttribute('uv')) g = boxProjectUVs(g, uvScale > 0 ? uvScale : 0.5);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
    return this;
  }

  /** Renames material keys (e.g. to swap in charred variants). */
  remap(fn: (key: string) => string) {
    const next = new Map<string, THREE.BufferGeometry[]>();
    for (const [key, list] of this.parts) {
      const k = fn(key);
      next.set(k, [...(next.get(k) ?? []), ...list]);
    }
    this.parts = next;
    return this;
  }

  /** Merges another builder's parts into this one under a transform. */
  addBuilder(other: MeshBuilder, matrix: THREE.Matrix4) {
    for (const [key, list] of other.parts) {
      for (const g of list) {
        const c = g.clone();
        c.applyMatrix4(matrix);
        let mine = this.parts.get(key);
        if (!mine) this.parts.set(key, (mine = []));
        mine.push(c);
      }
    }
    return this;
  }

  build(materials: Record<string, THREE.Material>, castShadow = true): THREE.Group {
    const group = new THREE.Group();
    for (const [key, list] of this.parts) {
      const mat = materials[key];
      if (!mat) throw new Error(`MeshBuilder: no material for "${key}"`);
      const merged = mergeGeometries(list);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow && !(mat as THREE.MeshBasicMaterial).transparent;
      mesh.receiveShadow = true;
      mesh.name = key;
      group.add(mesh);
    }
    return group;
  }
}

/** Compose a transform from position, Y rotation (plus optional X/Z) and scale. */
export function xf(
  x: number,
  y: number,
  z: number,
  rotY = 0,
  sx = 1,
  sy = sx,
  sz = sx,
  rotX = 0,
  rotZ = 0,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
    new THREE.Vector3(sx, sy, sz),
  );
}
