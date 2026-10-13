import * as THREE from 'three';

/**
 * Vertex normals for a deformed PlaneGeometry grid (cols × rows segments),
 * from the slope to each vertex's neighbours. Much faster than
 * computeVertexNormals for cloth that bends every frame.
 */
export function gridNormals(geo: THREE.BufferGeometry, cols: number, rows: number) {
  const p = geo.getAttribute('position').array as Float32Array;
  const nAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
  const n = nAttr.array as Float32Array;
  const w = cols + 1;
  for (let r = 0; r <= rows; r++) {
    const up = Math.max(0, r - 1) * w;
    const down = Math.min(rows, r + 1) * w;
    for (let c = 0; c <= cols; c++) {
      const l = (r * w + Math.max(0, c - 1)) * 3;
      const rt = (r * w + Math.min(cols, c + 1)) * 3;
      const u = (up + c) * 3;
      const d = (down + c) * 3;
      // Across the row (+x) and up the column (+y); their cross is the +z face normal.
      const ax = p[rt] - p[l], ay = p[rt + 1] - p[l + 1], az = p[rt + 2] - p[l + 2];
      const bx = p[u] - p[d], by = p[u + 1] - p[d + 1], bz = p[u + 2] - p[d + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (r * w + c) * 3;
      n[i] = nx; n[i + 1] = ny; n[i + 2] = nz;
    }
  }
  nAttr.needsUpdate = true;
}
