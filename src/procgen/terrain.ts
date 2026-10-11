import * as THREE from 'three';

// Heightfield terrain mesh. The height function is the single source of truth:
// the mesh is built from it, and props and characters sample it directly.

export type HeightFn = (x: number, z: number) => number;

export function terrainMesh(
  height: HeightFn,
  minX: number,
  minZ: number,
  size: number,
  segments: number,
  material: THREE.Material,
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + minX + size / 2;
    const z = pos.getZ(i) + minZ + size / 2;
    pos.setXYZ(i, x, height(x, z), z);
    // UV (0..1) follows world x/z so world-space masks line up.
    uv.setXY(i, (x - minX) / size, (z - minZ) / size);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** Surface normal of a height function by central differences. */
export function heightNormal(height: HeightFn, x: number, z: number, e = 0.25): THREE.Vector3 {
  const dx = height(x + e, z) - height(x - e, z);
  const dz = height(x, z + e) - height(x, z - e);
  return new THREE.Vector3(-dx, 2 * e, -dz).normalize();
}
