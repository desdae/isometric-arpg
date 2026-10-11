import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collapses the many small meshes an outfit hangs on each joint into one mesh
 * per material per joint. A dressed character goes from ~60 draw calls to
 * ~15, which matters with a few dozen monsters on screen. Meshes flagged
 * `userData.dynamic` (cloth, pick volumes) are left alone.
 */
export function bakeRig(root: THREE.Object3D) {
  const joints: THREE.Object3D[] = [];
  root.traverse((o) => joints.push(o));
  for (const j of joints) {
    const groups = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of j.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.children.length || m.userData.dynamic || Array.isArray(m.material)) continue;
      const list = groups.get(m.material as THREE.Material) ?? [];
      list.push(m);
      groups.set(m.material as THREE.Material, list);
    }
    for (const [mat, list] of groups) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        g.clearGroups();
        return g;
      });
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      const cast = list.some((m) => m.castShadow);
      for (const m of list) j.remove(m);
      const out = new THREE.Mesh(merged, mat);
      out.castShadow = cast;
      out.receiveShadow = true;
      j.add(out);
    }
  }
}
