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
  skinRig(root);
}

/**
 * Turns a whole rigid rig into one skinned mesh per material: every node
 * (joints, and part meshes that are themselves animated) becomes a bone, and
 * each part's triangles are bound fully to the node they hung from. The rig
 * animates exactly as before (the nodes still move), but a character draws in
 * a handful of calls instead of one per part, and casts its shadow the same
 * way. The original part meshes stay in the tree as invisible bones.
 * Meshes flagged `userData.dynamic`, hidden ones and non-plain meshes are
 * left alone.
 */
export function skinRig(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const bones: THREE.Object3D[] = [];
  const boneIndex = new Map<THREE.Object3D, number>();
  root.traverse((o) => {
    boneIndex.set(o, bones.length);
    bones.push(o);
  });
  const groups = new Map<string, { mat: THREE.Material; cast: boolean; parts: THREE.Mesh[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
    if (m.userData.dynamic || Array.isArray(m.material) || !m.visible || !m.material.visible) return;
    // Hidden ancestors (a weapon put away) mean the part is toggled at runtime.
    for (let p = m.parent; p && p !== root; p = p.parent) if (!p.visible) return;
    const key = `${m.material.uuid}|${m.castShadow}`;
    const g = groups.get(key) ?? { mat: m.material, cast: m.castShadow, parts: [] };
    g.parts.push(m);
    groups.set(key, g);
  });
  if (!groups.size) return;
  const skeleton = new THREE.Skeleton(bones as THREE.Bone[]);
  for (const { mat, cast, parts } of groups.values()) {
    const wantColor = (mat as THREE.MeshStandardMaterial).vertexColors;
    const geos = parts.map((m) => {
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(rootInv.clone().multiply(m.matrixWorld));
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', wantColor ? 'color' : ''].includes(name)) g.deleteAttribute(name);
      const n = g.getAttribute('position').count;
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      if (wantColor && !g.getAttribute('color')) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      const bi = boneIndex.get(m)!;
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? bi : 0)), 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
      g.clearGroups();
      return g;
    });
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const sm = new THREE.SkinnedMesh(merged, mat);
    sm.castShadow = cast;
    sm.receiveShadow = true;
    root.add(sm);
    sm.updateMatrixWorld(true);
    sm.bind(skeleton, sm.matrixWorld);
    // Culling uses the rest pose; leave room for limbs swinging out of it.
    merged.computeBoundingSphere();
    sm.boundingSphere = merged.boundingSphere!.clone();
    sm.boundingSphere.radius *= 1.6;
    // The parts keep moving as bones but no longer draw (children still do).
    for (const m of parts) m.layers.disableAll();
  }
}
