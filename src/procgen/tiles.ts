import * as THREE from 'three';

/**
 * Splits a big scatter of instances (grass across a whole map) into one
 * InstancedMesh per square tile, so the camera only draws the tiles it can
 * see. Each tile uses one of the shape variants; random turns and sizes hide
 * the repeat.
 */
export function tiledInstances(
  scene: THREE.Object3D,
  geos: THREE.BufferGeometry[],
  mat: THREE.Material,
  xforms: THREE.Matrix4[],
  tile = 20,
): THREE.InstancedMesh[] {
  const cells = new Map<string, { ix: number; iz: number; list: THREE.Matrix4[] }>();
  for (const m of xforms) {
    const ix = Math.floor(m.elements[12] / tile);
    const iz = Math.floor(m.elements[14] / tile);
    const key = ix + ',' + iz;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { ix, iz, list: [] }));
    c.list.push(m);
  }
  const out: THREE.InstancedMesh[] = [];
  for (const { ix, iz, list } of cells.values()) {
    const geo = geos[(((ix * 7 + iz * 3) % geos.length) + geos.length) % geos.length];
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.receiveShadow = true;
    scene.add(im);
    out.push(im);
  }
  return out;
}
