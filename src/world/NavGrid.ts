import * as THREE from 'three';

// Walkability grid over the zone with A* pathfinding. Obstacles are stamped in
// as circles or oriented boxes when props are placed, and paths are smoothed
// with line-of-sight checks so characters walk straight where they can.

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly blocked: Uint8Array;

  constructor(
    readonly minX: number,
    readonly minZ: number,
    readonly width: number,
    readonly depth: number,
    readonly cell = 0.5,
  ) {
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(depth / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  private toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)];
  }

  private center(cx: number, cz: number): [number, number] {
    return [this.minX + (cx + 0.5) * this.cell, this.minZ + (cz + 0.5) * this.cell];
  }

  private inside(cx: number, cz: number) {
    return cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows;
  }

  isBlocked(cx: number, cz: number) {
    return !this.inside(cx, cz) || this.blocked[cz * this.cols + cx] === 1;
  }

  walkable(x: number, z: number) {
    const [cx, cz] = this.toCell(x, z);
    return !this.isBlocked(cx, cz);
  }

  /** Blocks every cell whose centre lies within r of (x, z). */
  blockCircle(x: number, z: number, r: number) {
    const [x0, z0] = this.toCell(x - r, z - r);
    const [x1, z1] = this.toCell(x + r, z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.inside(cx, cz)) continue;
        const [px, pz] = this.center(cx, cz);
        if ((px - x) ** 2 + (pz - z) ** 2 <= r * r) this.blocked[cz * this.cols + cx] = 1;
      }
    }
  }

  /** Blocks an oriented rectangle of half-extents (hx, hz) rotated by rotY. */
  blockBox(x: number, z: number, hx: number, hz: number, rotY: number) {
    const r = Math.hypot(hx, hz);
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const [x0, z0] = this.toCell(x - r, z - r);
    const [x1, z1] = this.toCell(x + r, z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (!this.inside(cx, cz)) continue;
        const [px, pz] = this.center(cx, cz);
        const dx = px - x;
        const dz = pz - z;
        // Inverse-rotate into the box's local frame (three.js Y rotation).
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) this.blocked[cz * this.cols + cx] = 1;
      }
    }
  }

  /** Nearest walkable point to (x, z), searching outward in rings. */
  nearestWalkable(x: number, z: number): THREE.Vector2 | null {
    const [cx, cz] = this.toCell(x, z);
    for (let r = 0; r < 40; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.isBlocked(cx + dx, cz + dz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = [cx + dx, cz + dz];
          }
        }
      }
      if (best) {
        const [px, pz] = this.center(best[0], best[1]);
        return new THREE.Vector2(px, pz);
      }
    }
    return null;
  }

  /** True if a straight walk between two points crosses no blocked cell. */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / (this.cell * 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** A* with 8-way moves (no corner cutting), then string-pulled. */
  findPath(from: THREE.Vector2, to: THREE.Vector2): THREE.Vector2[] | null {
    const goalPt = this.walkable(to.x, to.y) ? to : this.nearestWalkable(to.x, to.y);
    if (!goalPt) return null;
    const [sx, sz] = this.toCell(from.x, from.y);
    const [gx, gz] = this.toCell(goalPt.x, goalPt.y);
    if (this.lineOfSight(from.x, from.y, goalPt.x, goalPt.y)) return [goalPt.clone()];

    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const start = sz * this.cols + sx;
    const goal = gz * this.cols + gx;
    const h = (cx: number, cz: number) => {
      const dx = Math.abs(cx - gx);
      const dz = Math.abs(cz - gz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    g[start] = 0;
    heap.push(start, h(sx, sz));
    let expanded = 0;
    while (heap.size > 0 && expanded < 60000) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      expanded++;
      const cx = cur % this.cols;
      const cz = (cur - cx) / this.cols;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (this.isBlocked(nx, nz)) continue;
          if (dx !== 0 && dz !== 0 && (this.isBlocked(cx + dx, cz) || this.isBlocked(cx, cz + dz))) continue;
          const ni = nz * this.cols + nx;
          const ng = g[cur] + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            parent[ni] = cur;
            heap.push(ni, ng + h(nx, nz));
          }
        }
      }
    }
    if (parent[goal] === -1 && goal !== start) return null;

    const cells: THREE.Vector2[] = [];
    for (let c = goal; c !== -1 && c !== start; c = parent[c]) {
      const cx = c % this.cols;
      const [px, pz] = this.center(cx, (c - cx) / this.cols);
      cells.push(new THREE.Vector2(px, pz));
    }
    cells.reverse();
    if (cells.length) cells[cells.length - 1] = goalPt.clone();

    // String pulling: skip ahead to the farthest visible waypoint.
    const out: THREE.Vector2[] = [];
    let anchor = from.clone();
    let i = 0;
    while (i < cells.length) {
      let far = i;
      for (let j = cells.length - 1; j > i; j--) {
        if (this.lineOfSight(anchor.x, anchor.y, cells[j].x, cells[j].y)) {
          far = j;
          break;
        }
      }
      out.push(cells[far]);
      anchor = cells[far];
      i = far + 1;
    }
    return out;
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [ids[p], ids[i]] = [ids[i], ids[p]];
      [keys[p], keys[i]] = [keys[i], keys[p]];
      i = p;
    }
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length > 0) {
      ids[0] = lastId;
      keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < ids.length && keys[l] < keys[m]) m = l;
        if (r < ids.length && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [ids[m], ids[i]] = [ids[i], ids[m]];
        [keys[m], keys[i]] = [keys[i], keys[m]];
        i = m;
      }
    }
    return top;
  }
}
