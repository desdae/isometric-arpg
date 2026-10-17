import * as THREE from 'three';
import { loading } from '../engine/Loading';
import { audio } from '../audio/Audio';
import { bakeSurfaces, pbrMaterial } from '../procgen/textures';
import { maskTexture, splatMaterial } from '../procgen/splat';
import { fbm2, mulberry32, range, smoothstep, type Rng } from '../procgen/noise';
import { barrel, crate, rock } from '../procgen/geometry';
import { terrainMesh } from '../procgen/terrain';
import { MeshBuilder, xf } from '../procgen/builder';
import { bones, brazier } from '../procgen/props';
import { bloodCauldron, candles, cellBars, gibbet, hangingCage, maidenProp, PEDESTAL_BRAZIER_COALS_Y, pedestalBrazier, rack, skeleton, skullPile, spikedChair, stocks, toolTable } from '../procgen/torture';
import { prewarmTelegraph } from '../game/Telegraph';
import { bloodWater } from '../procgen/bloodWater';
import { auraMaterial, prewarmBossFx } from '../game/BossFx';
import { Fire } from '../engine/Fire';
import { LightPool } from '../engine/LightPool';
import { installCutaway } from '../engine/cutaway';
import { NavGrid } from '../world/NavGrid';
import { MOON_OFFSET, type AreaScript, type Exit, type Interactable, type ScriptContext, type World } from '../world/World';
import type { Monster, MonsterKind, MonsterSpawn } from '../actors/Monster';

// A crypt beneath the Blighted Fields, dug fresh every time the hero goes
// down. Rooms are scattered over a grid and joined by an MST of corridors
// (plus a couple of loops) carved with a turn-averse A*. The boss vault sits
// against one edge behind a sealed portcullis; three objectives drawn from a
// pool, spread through the deepest rooms, break the seal. Thick block walls,
// wall torches, blood on the flagstones, chains, rune circles and red fog.
//
// The same generator digs the Drowned Gaol beneath the Bleeding Mire, in two
// levels: torture halls flooded with blood, cages, racks and candles. On the
// upper level the vault is the stairwell down, guarded by the gaolmaster; on
// the lower one it is the Grand Inquisitor's court.

const CELL = 2;
const G = 40;
const SIZE = G * CELL;
const HALF = SIZE / 2;
const WALL_H = 3.0;
const BS = 8; // boss vault size in cells

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Room extends Rect {
  id: number;
  boss: boolean;
  /** 0 at the entrance, 1 at the farthest room. */
  depth: number;
  /** What the room holds (an objective, a nest, the stairs). */
  role?: string;
}


const NAMES = ['The Sunken Ossuary', 'The Weeping Crypt', 'The Charnel Vaults', 'The Red Catacomb', 'The Sepulchre of Thorns'];
const GAOL_NAMES = ['The Drowned Gaol', 'The Weeping Cells', 'The Red Oubliette', 'The Flayed Halls', 'The Gaol of Chains'];

/** Which dungeon is being dug: the crypt under the fields, or a level of the gaol under the mire. */
export type DungeonVariant = 'crypt' | 'gaol1' | 'gaol2' | 'ossuary';

/** Ways to break the vault's seal; each run draws its own from the pool. */
export type Objective = 'runes' | 'warden' | 'key' | 'hearts' | 'brood' | 'braziers' | 'levers' | 'shards' | 'marked';
const UNLOCKS: Objective[] = ['runes', 'warden', 'key', 'hearts', 'brood', 'braziers', 'levers', 'shards', 'marked'];

type BossKind = 'abomination' | 'lich' | 'nightwing' | 'inquisitor';
/** The three vault bosses and how each one's room is lit and coloured. */
const BOSS_THEMES: Record<BossKind, { name: string; rune: THREE.Color; mist: THREE.Color; light: number; ghost: boolean; wakes: string }> = {
  abomination: { name: 'Gorrath the Many-Mouthed', rune: new THREE.Color(0.6, 0.04, 0.02), mist: new THREE.Color(0.11, 0.008, 0.005), light: 0xff3a1a, ghost: false, wakes: 'Something stirs beneath the blood' },
  lich: { name: 'The Hollow King', rune: new THREE.Color(0.32, 0.08, 0.7), mist: new THREE.Color(0.05, 0.015, 0.1), light: 0x9a50ff, ghost: true, wakes: 'The Hollow King lifts his head' },
  nightwing: { name: "Vhal'zereth", rune: new THREE.Color(0.55, 0.03, 0.04), mist: new THREE.Color(0.08, 0.01, 0.012), light: 0x9ab4ff, ghost: false, wakes: 'Wings unfold in the dark above' },
  inquisitor: { name: 'The Grand Inquisitor', rune: new THREE.Color(0.7, 0.05, 0.02), mist: new THREE.Color(0.12, 0.01, 0.006), light: 0xff3418, ghost: false, wakes: 'The Inquisitor rises to pass judgement' },
};
/** The crypt's three bosses; the gaol always ends with the Inquisitor. */
const CRYPT_BOSSES: BossKind[] = ['abomination', 'lich', 'nightwing'];

const cx = (i: number) => -HALF + (i + 0.5) * CELL;
const overlap = (a: Rect, b: Rect, pad = 0) => a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;

// ---- Layout -----------------------------------------------------------------

interface Layout {
  grid: Uint8Array; // 0 rock, 1 room, 2 corridor
  rooms: Room[];
  boss: Room;
  dir: [number, number]; // from the vault out through its door
  start: Room;
}

export function generate(rng: Rng): Layout {
  const grid = new Uint8Array(G * G);
  const get = (i: number, j: number) => (i < 0 || j < 0 || i >= G || j >= G ? 0 : grid[j * G + i]);
  const set = (i: number, j: number, v: number) => {
    if (i >= 0 && j >= 0 && i < G && j < G && (v === 1 || grid[j * G + i] === 0)) grid[j * G + i] = v;
  };

  // Boss vault against a random edge, its door facing the middle of the map.
  const edge = Math.floor(rng() * 4);
  const along = 6 + Math.floor(rng() * (G - 12 - BS));
  const [bx, by, dir]: [number, number, [number, number]] =
    edge === 0 ? [along, 2, [0, 1]] : edge === 1 ? [along, G - 2 - BS, [0, -1]] : edge === 2 ? [2, along, [1, 0]] : [G - 2 - BS, along, [-1, 0]];
  const boss: Room = { id: 0, x: bx, y: by, w: BS, h: BS, boss: true, depth: 1 };
  // A short straight passage from the door, then the anchor the corridor
  // search starts from.
  const stub: [number, number][] = [];
  for (let k = 0; k < 3; k++) {
    for (let s = 0; s < 2; s++) {
      if (dir[1] !== 0) stub.push([bx + 3 + s, dir[1] > 0 ? by + BS + k : by - 1 - k]);
      else stub.push([dir[0] > 0 ? bx + BS + k : bx - 1 - k, by + 3 + s]);
    }
  }
  const startAnchor: [number, number] =
    dir[1] > 0 ? [bx + 3, by + BS + 3] : dir[1] < 0 ? [bx + 3, by - 5] : dir[0] > 0 ? [bx + BS + 3, by + 3] : [bx - 5, by + 3];
  const stubRect: Rect = {
    x: Math.min(...stub.map((c) => c[0]), startAnchor[0]),
    y: Math.min(...stub.map((c) => c[1]), startAnchor[1]),
    w: 0,
    h: 0,
  };
  stubRect.w = Math.max(...stub.map((c) => c[0]), startAnchor[0] + 1) - stubRect.x + 1;
  stubRect.h = Math.max(...stub.map((c) => c[1]), startAnchor[1] + 1) - stubRect.y + 1;

  // Ordinary rooms.
  const rooms: Room[] = [boss];
  for (let tries = 0; tries < 900 && rooms.length < 12; tries++) {
    const w = 4 + Math.floor(rng() * 4);
    const h = 4 + Math.floor(rng() * 4);
    const r: Rect = { x: 2 + Math.floor(rng() * (G - 4 - w)), y: 2 + Math.floor(rng() * (G - 4 - h)), w, h };
    if (overlap(r, boss, 3) || overlap(r, stubRect, 2)) continue;
    if (rooms.some((o) => !o.boss && overlap(r, o, 2))) continue;
    rooms.push({ ...r, id: rooms.length, boss: false, depth: 0 });
  }
  for (const r of rooms) for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) set(i, j, 1);

  // Corridors: A* over 2x2 brush anchors, so passages are two cells (4 m) wide.
  const forbidden = { x: bx - 2, y: by - 2, w: BS + 4, h: BS + 4 };
  const anchorOk = (i: number, j: number) => {
    if (i < 1 || j < 1 || i > G - 3 || j > G - 3) return false;
    return !overlap({ x: i, y: j, w: 2, h: 2 }, forbidden);
  };
  const DIRS: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const carvePath = (a: [number, number], b: [number, number]) => {
    const N = G * G * 4;
    const cost = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap: [number, number][] = [];
    const push = (f: number, s: number) => {
      heap.push([f, s]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    const h = (i: number, j: number) => (Math.abs(i - b[0]) + Math.abs(j - b[1])) * 0.6;
    for (let d = 0; d < 4; d++) {
      const s = (a[1] * G + a[0]) * 4 + d;
      cost[s] = 0;
      push(h(a[0], a[1]), s);
    }
    let end = -1;
    while (heap.length) {
      const [, s] = pop();
      const cell = s >> 2;
      const d = s & 3;
      const i = cell % G;
      const j = (cell / G) | 0;
      if (i === b[0] && j === b[1]) {
        end = s;
        break;
      }
      for (let nd = 0; nd < 4; nd++) {
        const ni = i + DIRS[nd][0];
        const nj = j + DIRS[nd][1];
        if (!anchorOk(ni, nj)) continue;
        // Reusing floor is cheap, digging rock dearer; turning costs extra so
        // passages run straight with few elbows.
        let rockCount = 0;
        for (let q = 0; q < 4; q++) if (get(ni + (q & 1), nj + (q >> 1)) === 0) rockCount++;
        const step = 1 + rockCount * 0.35 + (nd !== d ? 2.5 : 0);
        const ns = (nj * G + ni) * 4 + nd;
        const c = cost[s] + step;
        if (c < cost[ns]) {
          cost[ns] = c;
          prev[ns] = s;
          push(c + h(ni, nj), ns);
        }
      }
    }
    for (let s = end; s >= 0; s = prev[s]) {
      const cell = s >> 2;
      const i = cell % G;
      const j = (cell / G) | 0;
      for (let q = 0; q < 4; q++) set(i + (q & 1), j + (q >> 1), 2);
    }
  };
  const anchor = (r: Room): [number, number] => [r.x + Math.floor(r.w / 2) - 1, r.y + Math.floor(r.h / 2) - 1];
  const others = rooms.filter((r) => !r.boss);
  const dist = (a: Room, b: Room) => Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
  // Prim's MST over the ordinary rooms.
  const inTree = new Set<Room>([others[0]]);
  const edges: [Room, Room][] = [];
  while (inTree.size < others.length) {
    let best: [Room, Room] | null = null;
    let bd = Infinity;
    for (const a of inTree) {
      for (const b of others) {
        if (inTree.has(b)) continue;
        const d = dist(a, b);
        if (d < bd) {
          bd = d;
          best = [a, b];
        }
      }
    }
    inTree.add(best![1]);
    edges.push(best!);
  }
  // A couple of loops so the crypt isn't a pure tree.
  for (let k = 0, tries = 0; k < 2 && tries < 60; tries++) {
    const a = others[Math.floor(rng() * others.length)];
    const b = others[Math.floor(rng() * others.length)];
    if (a === b || dist(a, b) > 16 || edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) continue;
    edges.push([a, b]);
    k++;
  }
  for (const [a, b] of edges) carvePath(anchor(a), anchor(b));
  // The vault's passage joins the nearest room.
  for (const [i, j] of stub) set(i, j, 2);
  const sa = { x: startAnchor[0], y: startAnchor[1], w: 2, h: 2, id: -1, boss: false, depth: 0 };
  const nearest = others.reduce((m, r) => (dist(sa, r) < dist(sa, m) ? r : m), others[0]);
  carvePath(startAnchor, anchor(nearest));

  // Entrance: the room farthest (by walking) from the vault door.
  const walkFrom = (seeds: [number, number][]) => {
    const d = new Int32Array(G * G).fill(-1);
    const q: number[] = [];
    for (const [i, j] of seeds) {
      d[j * G + i] = 0;
      q.push(j * G + i);
    }
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      const i = c % G;
      const j = (c / G) | 0;
      for (const [di, dj] of DIRS) {
        const ni = i + di;
        const nj = j + dj;
        if (get(ni, nj) === 0 || d[nj * G + ni] >= 0) continue;
        d[nj * G + ni] = d[c] + 1;
        q.push(nj * G + ni);
      }
    }
    return d;
  };
  const centre = (r: Room) => (r.y + (r.h >> 1)) * G + r.x + (r.w >> 1);
  const fromDoor = walkFrom(stub);
  const start = others.reduce((m, r) => (fromDoor[centre(r)] > fromDoor[centre(m)] ? r : m), others[0]);
  start.role = 'start';
  const fromStart = walkFrom([[start.x + (start.w >> 1), start.y + (start.h >> 1)]]);
  const maxD = Math.max(1, ...others.map((r) => fromStart[centre(r)]));
  for (const r of others) r.depth = Math.max(0, fromStart[centre(r)]) / maxD;
  return { grid, rooms, boss, dir, start };
}

// ---- Canvas textures --------------------------------------------------------

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Summoning circle: double rings, a band of glyphs, a star and node rings. */
function runeTexture(seed: number): THREE.CanvasTexture {
  const rng = mulberry32(seed);
  return canvasTexture(512, (g, s) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, s, s);
    g.translate(s / 2, s / 2);
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.shadowColor = '#fff';
    g.shadowBlur = 10;
    g.lineCap = 'round';
    const R = s * 0.46;
    const ring = (r: number, w: number) => {
      g.lineWidth = w;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.stroke();
    };
    ring(R, 6);
    ring(R * 0.9, 3);
    ring(R * 0.66, 4);
    // Glyph band between the outer rings.
    const glyphs = 22 + Math.floor(rng() * 8);
    g.lineWidth = 3;
    for (let k = 0; k < glyphs; k++) {
      g.save();
      g.rotate((k / glyphs) * Math.PI * 2);
      g.translate(0, -R * 0.78);
      g.beginPath();
      const strokes = 2 + Math.floor(rng() * 3);
      for (let q = 0; q < strokes; q++) {
        const x0 = range(rng, -9, 9);
        const y0 = range(rng, -12, 12);
        g.moveTo(x0, y0);
        if (rng() < 0.3) g.arc(x0, y0, range(rng, 3, 6), 0, Math.PI * range(rng, 1, 2));
        else g.lineTo(range(rng, -9, 9), range(rng, -12, 12));
      }
      g.stroke();
      g.restore();
    }
    // A star of 5 or 7 points.
    const n = rng() < 0.5 ? 5 : 7;
    const skip = n === 5 ? 2 : 3;
    g.lineWidth = 4;
    g.beginPath();
    for (let k = 0; k <= n; k++) {
      const a = ((k * skip) / n) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * R * 0.64;
      const y = Math.sin(a) * R * 0.64;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 - Math.PI / 2;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(Math.cos(a) * R * 0.66, Math.sin(a) * R * 0.66, R * 0.07, 0, Math.PI * 2);
      g.stroke();
    }
    ring(R * 0.16, 3);
    g.beginPath();
    g.arc(0, 0, R * 0.05, 0, Math.PI * 2);
    g.fill();
  });
}

/** Cobweb: radial threads and a sagging spiral. */
function webTexture(seed: number): THREE.CanvasTexture {
  const rng = mulberry32(seed);
  return canvasTexture(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.strokeStyle = 'rgba(235,230,220,0.85)';
    g.lineWidth = 1.2;
    const spokes = 11 + Math.floor(rng() * 5);
    const angles = Array.from({ length: spokes }, (_, k) => (k / spokes) * Math.PI * 2 + range(rng, -0.12, 0.12));
    const ox = s / 2;
    const oy = s / 2;
    for (const a of angles) {
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ox + Math.cos(a) * s * 0.7, oy + Math.sin(a) * s * 0.7);
      g.stroke();
    }
    for (let r = 10; r < s * 0.48; r += range(rng, 7, 12)) {
      g.beginPath();
      angles.forEach((a, k) => {
        const rr = r * range(rng, 0.92, 1.05);
        const x = ox + Math.cos(a) * rr;
        const y = oy + Math.sin(a) * rr;
        if (k === 0) g.moveTo(x, y);
        else g.quadraticCurveTo(ox + Math.cos(a - 0.15) * rr * 0.9, oy + Math.sin(a - 0.15) * rr * 0.9, x, y);
      });
      g.closePath();
      g.stroke();
    }
  });
}

// ---- Props ------------------------------------------------------------------

/** Iron chain from a to b, sagging, as alternating links. */
function chain(b: MeshBuilder, a: THREE.Vector3, c: THREE.Vector3, sag: number) {
  const link = new THREE.TorusGeometry(0.045, 0.012, 4, 8).scale(1, 1.5, 1);
  const len = a.distanceTo(c);
  const n = Math.max(2, Math.round(len / 0.09));
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    p.lerpVectors(a, c, t0).y -= Math.sin(t0 * Math.PI) * sag;
    q.lerpVectors(a, c, t1).y -= Math.sin(t1 * Math.PI) * sag;
    const m = new THREE.Matrix4().lookAt(p, q, new THREE.Vector3(0, 1, 0).cross(q.clone().sub(p)).lengthSq() < 1e-6 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
    // Link long axis along the chain; every other link turned a quarter.
    m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationY(k % 2 ? Math.PI / 2 : 0));
    m.setPosition(p.clone().add(q).multiplyScalar(0.5));
    b.add('iron', link, m, 0);
  }
}

function pillar(b: MeshBuilder, rng: Rng, x: number, z: number) {
  b.add('trim', new THREE.BoxGeometry(1.0, 0.3, 1.0), xf(x, 0.15, z, 0), 0.6);
  b.add('trim', new THREE.BoxGeometry(0.85, 0.15, 0.85), xf(x, 0.37, z, 0), 0.6);
  const h = WALL_H - 0.55;
  b.add('wall', new THREE.CylinderGeometry(0.33, 0.36, h, 8).rotateY(Math.PI / 8), xf(x, 0.45 + h / 2, z, 0), 0.5);
  b.add('trim', new THREE.BoxGeometry(0.9, 0.25, 0.9), xf(x, WALL_H - 0.12, z, 0), 0.6);
  // Chipped: a chunk knocked off the shaft now and then.
  if (rng() < 0.4) b.add('rubble', rock(rng, 0.35), xf(x + range(rng, -0.8, 0.8), 0.05, z + range(rng, -0.8, 0.8), rng() * 6), 0.5);
}

/** Torch in an iron sconce on a wall; `n` is the wall's outward normal into the room. */
function sconce(b: MeshBuilder, face: THREE.Vector3, n: THREE.Vector3, y: number) {
  const yaw = Math.atan2(n.x, n.z);
  const m = xf(face.x, y, face.z, yaw);
  b.add('iron', new THREE.BoxGeometry(0.16, 0.3, 0.04), m.clone().multiply(xf(0, 0, 0.02)), 0);
  b.add('iron', new THREE.BoxGeometry(0.04, 0.04, 0.3), m.clone().multiply(xf(0, -0.05, 0.15, 0, 1, 1, 1, -0.5)), 0);
  b.add('iron', new THREE.CylinderGeometry(0.07, 0.04, 0.12, 6), m.clone().multiply(xf(0, 0.08, 0.3)), 0);
  b.add('wood', new THREE.CylinderGeometry(0.03, 0.025, 0.42, 5), m.clone().multiply(xf(0, 0.05, 0.3, 0, 1, 1, 1, 0.15)), 0);
}

/** A thrown splash of blood: a ragged blot with droplets flung outward. */
function splatTexture(seed: number): THREE.CanvasTexture {
  const rng = mulberry32(seed);
  return canvasTexture(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = '#fff';
    g.translate(s / 2, s / 2);
    for (let k = 0; k < 9; k++) {
      g.beginPath();
      g.arc(range(rng, -24, 24), range(rng, -24, 24), range(rng, 14, 34), 0, Math.PI * 2);
      g.fill();
    }
    const dir = rng() * Math.PI * 2;
    for (let k = 0; k < 40; k++) {
      const a = dir + range(rng, -1.2, 1.2) * (rng() < 0.3 ? 2.6 : 1);
      const r = range(rng, 40, s * 0.47);
      g.beginPath();
      g.ellipse(Math.cos(a) * r, Math.sin(a) * r, range(rng, 1.5, 6) * (1 - r / s), range(rng, 1.5, 3), a, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Blood running down a wall: streaks from a ragged top edge, beading at their ends. */
function dripTexture(seed: number): THREE.CanvasTexture {
  const rng = mulberry32(seed);
  return canvasTexture(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    g.fillStyle = '#fff';
    for (let x = 0; x < s; x += 3) g.fillRect(x, 0, 3, range(rng, 6, 26));
    for (let k = 0; k < 22; k++) {
      const x = range(rng, 8, s - 8);
      const len = range(rng, 0.2, 0.97) * s;
      const w = range(rng, 2, 7);
      const grd = g.createLinearGradient(0, 0, 0, len);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.85, 'rgba(255,255,255,0.8)');
      grd.addColorStop(1, 'rgba(255,255,255,0.2)');
      g.fillStyle = grd;
      g.fillRect(x - w / 2, 0, w, len);
      g.beginPath();
      g.arc(x, len, w * 0.8, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Soft cloudy blots for mist and pooled light. */
function mistTexture(seed: number): THREE.CanvasTexture {
  const rng = mulberry32(seed);
  return canvasTexture(256, (g, s) => {
    g.clearRect(0, 0, s, s);
    for (let k = 0; k < 26; k++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * s * 0.3;
      const x = s / 2 + Math.cos(a) * r;
      const y = s / 2 + Math.sin(a) * r;
      const rad = range(rng, s * 0.08, s * 0.2);
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
    }
  });
}

/** Vertical fade for a shaft of light: bright at the floor, gone at the top. */
function shaftTexture(): THREE.CanvasTexture {
  return canvasTexture(64, (g, s) => {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  });
}

/** A swollen, knotted lump of flesh about a metre across. */
function fleshLump(rng: Rng): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const seed = Math.floor(rng() * 1000);
  for (let v = 0; v < p.count; v++) {
    const x = p.getX(v);
    const y = p.getY(v);
    const z = p.getZ(v);
    const d = 1 + fbm2(x * 2.2 + seed, y * 2.2 + z * 1.7, 3, seed) * 0.45;
    p.setXYZ(v, x * d, y * d, z * d);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A body bound in a shroud, hanging head down from its ankles. */
function cocoon(): THREE.BufferGeometry {
  const pts = [
    [0.0, 0.0],
    [0.12, 0.05],
    [0.2, 0.3],
    [0.24, 0.65],
    [0.2, 1.0],
    [0.12, 1.3],
    [0.04, 1.45],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 10);
}

// ---- Build ------------------------------------------------------------------

export async function buildDungeon(seed = 1, forcedBoss?: string | null, variant: DungeonVariant = 'crypt', forcedUnlock?: string | null): Promise<World> {
  const rng = mulberry32(seed);
  const gaol = variant !== 'crypt';
  /** The gaol's upper level: no seal and no boss, just the way down. */
  const descent = variant === 'gaol1';
  await loading.step('Carving rooms and passages', 0.02);
  const L = generate(rng);
  const { grid, rooms, boss, start, dir } = L;
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= G || j >= G ? 0 : grid[j * G + i]);
  const floorAt = (x: number, z: number) => at(Math.floor((x + HALF) / CELL), Math.floor((z + HALF) / CELL));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(gaol ? 0x050102 : 0x030102);
  scene.fog = new THREE.FogExp2(gaol ? 0x1e0605 : 0x140607, gaol ? 0.022 : 0.02);
  scene.add(
    gaol
      ? new THREE.HemisphereLight(new THREE.Color(0.66, 0.33, 0.28), new THREE.Color(0.2, 0.08, 0.06), 2.1)
      : new THREE.HemisphereLight(new THREE.Color(0.55, 0.36, 0.32), new THREE.Color(0.14, 0.08, 0.07), 1.7),
  );
  // Dim shadow-casting key light from above (main.ts steers its frustum).
  const moon = new THREE.DirectionalLight(new THREE.Color(0.9, 0.45, 0.4), 1.1);
  moon.position.copy(MOON_OFFSET);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.near = 1;
  sc.far = 160;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.04;
  moon.shadow.radius = 3;
  scene.add(moon, moon.target);

  await loading.step('Cutting stone for the walls', 0.1);
  const [wallSet, capSet, floorSet, cobbleSet, woodSet] = await bakeSurfaces([
    { kind: 'stoneBricks', seed: seed % 997, size: 512, normalStrength: 6 },
    { kind: 'roughStone', seed: (seed % 991) + 3, size: 512, normalStrength: 7 },
    { kind: 'flagstones', seed: (seed % 983) + 5, size: 1024, normalStrength: 6 },
    { kind: 'cobblestone', seed: (seed % 977) + 7, size: 1024, normalStrength: 8 },
    { kind: 'woodPlanks', seed: (seed % 971) + 9, size: 256, normalStrength: 4 },
  ]);
  const mats: Record<string, THREE.Material> = {
    // The gaol's stone is darker, blood-stained and wet.
    wall: pbrMaterial(wallSet, 1, { color: gaol ? new THREE.Color(0.52, 0.38, 0.35) : new THREE.Color(0.85, 0.76, 0.72), roughness: gaol ? 0.7 : undefined }),
    trim: pbrMaterial(capSet, 1, { color: gaol ? new THREE.Color(0.5, 0.4, 0.38) : new THREE.Color(0.75, 0.68, 0.65) }),
    rubble: pbrMaterial(capSet, 1, { color: new THREE.Color(0.45, 0.4, 0.38) }),
    void: new THREE.MeshBasicMaterial({ color: 0x050203 }),
    wood: pbrMaterial(woodSet, 1, { color: new THREE.Color(0.6, 0.5, 0.45) }),
    iron: new THREE.MeshStandardMaterial({ color: 0x24201e, roughness: 0.5, metalness: 0.85 }),
    bone: new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 0.7 }),
    coal: new THREE.MeshStandardMaterial({ color: 0x110805, emissive: new THREE.Color(2.5, 0.5, 0.1), roughness: 1 }),
    flesh: new THREE.MeshStandardMaterial({ color: 0x5a1410, roughness: 0.35, emissive: new THREE.Color(0.25, 0.01, 0.0) }),
    egg: new THREE.MeshStandardMaterial({ color: 0xb4a68a, roughness: 0.35, emissive: new THREE.Color(0.06, 0.04, 0.02) }),
    altar: pbrMaterial(capSet, 1, { color: new THREE.Color(0.35, 0.3, 0.3) }),
    seal: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(3, 0.2, 0.08), roughness: 1 }),
    // Torture-prison dressing (see procgen/torture.ts).
    rust: new THREE.MeshStandardMaterial({ color: 0x4a2414, roughness: 0.85, metalness: 0.5 }),
    wax: new THREE.MeshStandardMaterial({ color: 0xc8b48c, roughness: 0.55, emissive: new THREE.Color(0.08, 0.05, 0.02) }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.4, 0.4), fog: false }),
    gore: new THREE.MeshStandardMaterial({ color: 0x4a0c08, roughness: 0.25, emissive: new THREE.Color(0.12, 0.0, 0.0) }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x3a2a22, roughness: 0.95, side: THREE.DoubleSide }),
    rope: new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.95 }),
    cellVoid: new THREE.MeshBasicMaterial({ color: 0x080101 }),
    ash: new THREE.MeshStandardMaterial({ color: 0x1a1614, roughness: 1 }),
    cellGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.06, 0.02), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  };
  for (const k of ['wall', 'trim', 'rubble', 'void', 'iron', 'wood']) installCutaway(mats[k]);

  await loading.step('Laying flagstones and spilling blood', 0.4);
  // ---- Floor ----------------------------------------------------------
  const blood = (x: number, z: number) => {
    const n = fbm2(x * 0.12, z * 0.12, 4, seed + 80) + fbm2(x * 0.5, z * 0.5, 3, seed + 81) * 0.25;
    return smoothstep(0.38, 0.62, n);
  };
  const mask = maskTexture(512, (u, v) => {
    const x = -HALF + u * SIZE;
    const z = -HALF + v * SIZE;
    const n = fbm2(x * 0.4, z * 0.4, 2, seed + 60) * 0.6;
    const g = floorAt(x + n, z - n);
    let b = blood(x, z) * 0.9;
    // Drag marks and pools in the vault.
    if (floorAt(x, z) && x > -HALF + boss.x * CELL && x < -HALF + (boss.x + BS) * CELL && z > -HALF + boss.y * CELL && z < -HALF + (boss.y + BS) * CELL) b = Math.max(b, smoothstep(0.2, 0.5, fbm2(x * 0.2, z * 0.2, 3, seed + 82) + 0.15));
    const wet = smoothstep(0.1, 0.55, fbm2(x * 0.07, z * 0.07, 3, seed + 90)) * 0.7;
    return [g === 2 ? 1 : 0, b, wet];
  });
  const ground = terrainMesh(() => 0, -HALF, -HALF, SIZE, 40, splatMaterial(floorSet, 26, cobbleSet, 40, mask));
  scene.add(ground);
  // The gaol is flooded: blood stands in wide pools across the flagstones,
  // deepest in the vault, rippling where it drips from the ceiling.
  const waterTime = { value: 0 };
  let dryFlood = (_x: number, _z: number, _hw: number, _hl: number, _yaw: number) => {};
  if (gaol) {
    const R = 256;
    const data = new Uint8Array(R * R * 4);
    for (let v = 0; v < R; v++) {
      for (let u = 0; u < R; u++) {
        const x = -HALF + ((u + 0.5) / R) * SIZE;
        const z = -HALF + ((v + 0.5) / R) * SIZE;
        const inVault = x > -HALF + boss.x * CELL && x < -HALF + (boss.x + BS) * CELL && z > -HALF + boss.y * CELL && z < -HALF + (boss.y + BS) * CELL;
        const n = fbm2(x * 0.09, z * 0.09, 4, seed + 70) + fbm2(x * 0.35, z * 0.35, 2, seed + 71) * 0.18 + (inVault && !descent ? 0.16 : 0) + (descent ? 0 : 0.04);
        // Depth of the pool here: negative is dry stone.
        const depth = (n - 0.53) * 1.4;
        const ground = Math.max(-1.5, Math.min(1, -depth));
        const k = (v * R + u) * 4;
        data[k] = data[k + 1] = data[k + 2] = Math.round(((ground + 1.5) / 2.5) * 255);
        data[k + 3] = 255;
      }
    }
    const depthTex = new THREE.DataTexture(data, R, R);
    depthTex.magFilter = THREE.LinearFilter;
    depthTex.minFilter = THREE.LinearFilter;
    depthTex.needsUpdate = true;
    // Dries out a rotated box (the stairwell), so no pool lies over it.
    dryFlood = (x0, z0, hw, hl, yaw) => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      for (let v = 0; v < R; v++) {
        for (let u = 0; u < R; u++) {
          const dx = -HALF + ((u + 0.5) / R) * SIZE - x0;
          const dz = -HALF + ((v + 0.5) / R) * SIZE - z0;
          if (Math.abs(dx * c - dz * s) > hw || Math.abs(dx * s + dz * c) > hl) continue;
          const k = (v * R + u) * 4;
          data[k] = data[k + 1] = data[k + 2] = 255;
        }
      }
      depthTex.needsUpdate = true;
    };
    const flood = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), bloodWater(SIZE, waterTime, depthTex, true));
    flood.position.y = 0.035;
    flood.receiveShadow = true;
    flood.renderOrder = 1;
    scene.add(flood);
  }

  await loading.step('Flooding the cells', 0.45);
  const nav = new NavGrid(-HALF, -HALF, SIZE, SIZE, 0.5);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) if (!at(i, j)) nav.blockBox(cx(i), cx(j), CELL / 2 + 0.3, CELL / 2 + 0.3, 0);

  await loading.step('Raising the walls', 0.5);
  // ---- Walls ----------------------------------------------------------
  const walls = new MeshBuilder();
  const props = new MeshBuilder();
  const N8: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      if (at(i, j)) continue;
      const x = cx(i);
      const z = cx(j);
      const edge = N8.some(([di, dj]) => at(i + di, j + dj));
      if (!edge) {
        walls.add('void', new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2), xf(x, WALL_H + 0.05, z), 0);
        continue;
      }
      const h = WALL_H + range(rng, -0.05, 0.25);
      walls.add('wall', new THREE.BoxGeometry(CELL, h, CELL), xf(x, h / 2, z), 0.5);
      walls.add('trim', new THREE.BoxGeometry(CELL + 0.06, 0.16, CELL + 0.06), xf(x, h + 0.08, z, range(rng, -0.02, 0.02)), 0.6);
      // Pilasters every other cell along the faces, and a plinth course.
      for (const [di, dj] of N8.slice(0, 4)) {
        if (!at(i + di, j + dj)) continue;
        const fx = x + (di * CELL) / 2;
        const fz = z + (dj * CELL) / 2;
        const yaw = Math.atan2(di, dj);
        walls.add('trim', new THREE.BoxGeometry(CELL, 0.35, 0.16), xf(fx, 0.17, fz, yaw), 0.6);
        if ((i + j) % 2 === 0) walls.add('trim', new THREE.BoxGeometry(0.5, h, 0.24), xf(fx, h / 2, fz, yaw), 0.6);
        if (rng() < 0.12) props.add('rubble', rock(rng, range(rng, 0.25, 0.5)), xf(fx + di * 0.3 + range(rng, -0.6, 0.6), 0, fz + dj * 0.3 + range(rng, -0.6, 0.6), rng() * 6), 0.5);
        if (gaol && rng() < 0.3) {
          // Blood run down the stone from somewhere above.
          const w = range(rng, 0.5, 1.3);
          const hh = range(rng, 1.4, h - 0.1);
          walls.add('drip', new THREE.PlaneGeometry(w, hh), xf(fx - dj * range(rng, -0.6, 0.6) - di * 0.005, h - hh / 2 - 0.05, fz + di * range(rng, -0.6, 0.6) - dj * 0.005, yaw + Math.PI), 0);
        }
        if (gaol && rng() < 0.08) {
          // A pair of shackles on short chains.
          const side = new THREE.Vector3(dj, 0, -di);
          for (const sgn of [-0.3, 0.3]) {
            const top = new THREE.Vector3(fx - di * 0.04, range(rng, 1.6, 2.0), fz - dj * 0.04).addScaledVector(side, sgn);
            const low = top.clone().setY(top.y - range(rng, 0.25, 0.5)).add(new THREE.Vector3(-di * 0.06, 0, -dj * 0.06));
            chain(walls, top, low, 0.01);
            walls.add('iron', new THREE.TorusGeometry(0.07, 0.018, 4, 10), xf(low.x, low.y - 0.07, low.z, yaw), 0);
          }
        }
      }
    }
  }
  if (gaol) {
    mats.drip = new THREE.MeshStandardMaterial({ map: dripTexture(seed + 21), color: 0x6a0806, roughness: 0.15, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    installCutaway(mats.drip as THREE.MeshStandardMaterial);
  }
  scene.add(walls.build(mats));

  await loading.step('Lighting the torches', 0.62);
  // ---- Lights and torches ----------------------------------------------
  const pool = new LightPool(scene, 8, gaol ? 0xff4a22 : 0xff6a28);
  const fires: Fire[] = [];
  const addFire = (pos: THREE.Vector3, size: number, intensity: number, rangeM: number) => {
    const f = new Fire(size, 0, 1);
    f.group.position.copy(pos);
    scene.add(f.group);
    fires.push(f);
    pool.add(pos.clone().setY(pos.y + 0.3), intensity, rangeM, 1);
  };
  /** Wall faces of a room: floor cell centre, wall face point, normal into the room. */
  const faces = (r: Rect) => {
    const out: { face: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let j = r.y; j < r.y + r.h; j++) {
      for (let i = r.x; i < r.x + r.w; i++) {
        for (const [di, dj] of N8.slice(0, 4)) {
          if (at(i + di, j + dj)) continue;
          out.push({ face: new THREE.Vector3(cx(i) + (di * CELL) / 2, 0, cx(j) + (dj * CELL) / 2), n: new THREE.Vector3(-di, 0, -dj) });
        }
      }
    }
    return out;
  };
  const used: THREE.Vector3[] = [];
  const pickFaces = (r: Rect, count: number, minGap: number) => {
    const list = faces(r).sort(() => rng() - 0.5);
    const got: typeof list = [];
    for (const f of list) {
      if (got.length >= count) break;
      if (used.some((u) => u.distanceTo(f.face) < minGap)) continue;
      used.push(f.face);
      got.push(f);
    }
    return got;
  };
  const torch = (f: { face: THREE.Vector3; n: THREE.Vector3 }) => {
    sconce(props, f.face, f.n, 1.95);
    addFire(f.face.clone().addScaledVector(f.n, 0.31).setY(2.2), 0.3, 24, 12);
  };
  for (const r of rooms) if (!r.boss) pickFaces(r, r.w * r.h > 30 ? 3 : 2, 4.5).forEach(torch);
  // Corridor torches, sparse.
  for (let j = 1; j < G - 1; j++) {
    for (let i = 1; i < G - 1; i++) {
      if (at(i, j) !== 2 || rng() > 0.08) continue;
      pickFaces({ x: i, y: j, w: 1, h: 1 }, 1, 9).forEach(torch);
    }
  }

  await loading.step('Hanging chains and drawing runes', 0.7);
  // ---- Room dressing ----------------------------------------------------
  const runeMats: THREE.MeshBasicMaterial[] = [];
  const runeCircle = (x: number, z: number, radius: number, color: THREE.Color, rot = rng() * 6) => {
    const mat = new THREE.MeshBasicMaterial({
      map: runeTexture(Math.floor(rng() * 1e6)),
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), mat);
    m.position.set(x, 0.025, z);
    m.rotation.y = rot;
    m.renderOrder = 5;
    scene.add(m);
    runeMats.push(mat);
    return { mesh: m, mat };
  };
  const roomCentre = (r: Rect) => new THREE.Vector3(-HALF + (r.x + r.w / 2) * CELL, 0, -HALF + (r.y + r.h / 2) * CELL);
  const spotIn = (r: Rect, margin = 1.2, avoid: THREE.Vector3[] = [], gap = 1.5) => {
    for (let k = 0; k < 40; k++) {
      const x = -HALF + r.x * CELL + margin + rng() * (r.w * CELL - 2 * margin);
      const z = -HALF + r.y * CELL + margin + rng() * (r.h * CELL - 2 * margin);
      if (nav.walkable(x, z) && avoid.every((a) => Math.hypot(a.x - x, a.z - z) > gap)) return new THREE.Vector3(x, 0, z);
    }
    return roomCentre(r);
  };

  // Chains hanging down the walls, a skeleton slumped below some of them.
  const hangChains = (r: Rect, count: number) => {
    for (const f of pickFaces(r, count, 2.5)) {
      const side = new THREE.Vector3(f.n.z, 0, -f.n.x);
      for (const s of [-0.35, 0.35]) {
        const top = f.face.clone().addScaledVector(f.n, 0.06).addScaledVector(side, s).setY(WALL_H - 0.2);
        const bottom = f.face.clone().addScaledVector(f.n, 0.12).addScaledVector(side, s * 0.6).setY(range(rng, 0.9, 1.5));
        chain(props, top, bottom, 0.02);
        props.add('iron', new THREE.TorusGeometry(0.09, 0.02, 4, 10), xf(bottom.x, bottom.y - 0.08, bottom.z, Math.atan2(f.n.x, f.n.z)), 0);
      }
      if (gaol && rng() < 0.55) props.addBuilder(skeleton(rng, 'slumped'), xf(f.face.x + f.n.x * 0.45, 0, f.face.z + f.n.z * 0.45, Math.atan2(f.n.x, f.n.z)));
      else if (rng() < 0.6) props.addBuilder(bones(rng), xf(f.face.x + f.n.x * 0.6, 0, f.face.z + f.n.z * 0.6, rng() * 6));
    }
  };
  // A barred cell let into the wall: darkness behind iron, a red glow at its foot.
  const cell = (f: { face: THREE.Vector3; n: THREE.Vector3 }) => {
    const yaw = Math.atan2(f.n.x, f.n.z);
    const m = xf(f.face.x, 0, f.face.z, yaw);
    props.add('cellVoid', new THREE.PlaneGeometry(1.7, 2.3), m.clone().multiply(xf(0, 1.2, 0.012)), 0);
    props.add('cellGlow', new THREE.PlaneGeometry(1.7, 0.7), m.clone().multiply(xf(0, 0.35, 0.02)), 0);
    props.add('trim', new THREE.BoxGeometry(2.1, 0.3, 0.22), m.clone().multiply(xf(0, 2.45, 0.08)), 0.6);
    for (const sx of [-1, 1]) props.add('trim', new THREE.BoxGeometry(0.22, 2.5, 0.24), m.clone().multiply(xf(sx * 0.95, 1.25, 0.08)), 0.6);
    props.addBuilder(cellBars(1.7, 2.3), m.clone().multiply(xf(0, 0, 0.1)));
  };
  // Torture furniture: one or two pieces a room, cages overhead, candles and
  // cells along the walls, braziers on pedestals, low red mist.
  const centrepieces = [() => rack(rng, rng() < 0.6), () => stocks(rng), () => spikedChair(rng), () => gibbet(rng), () => toolTable(rng), () => bloodCauldron(rng), () => maidenProp(rng), () => skullPile(rng)];
  const mistMats: THREE.MeshBasicMaterial[] = [];
  const lowMist = (x: number, z: number, size: number) => {
    if (!mistMats.length) mistMats.push(new THREE.MeshBasicMaterial({ map: mistTexture(seed + 41), color: new THREE.Color(0.1, 0.012, 0.008), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mistMats[0]);
      m.position.set(x + range(rng, -0.8, 0.8), 0.25 + k * 0.3, z + range(rng, -0.8, 0.8));
      m.rotation.y = rng() * 6;
      m.renderOrder = 6;
      scene.add(m);
    }
  };
  const dressGaol = (r: Room) => {
    const big = r.w >= 6 && r.h >= 6;
    const keep = [roomCentre(r)];
    if (r !== start) {
      for (let k = 0; k < (big ? 2 : 1); k++) {
        const p = spotIn(r, 1.9, keep, 2.6);
        keep.push(p);
        props.addBuilder(centrepieces[Math.floor(rng() * centrepieces.length)](), xf(p.x, 0, p.z, Math.floor(rng() * 4) * (Math.PI / 2) + range(rng, -0.2, 0.2)));
        nav.blockCircle(p.x, p.z, 1.05);
      }
    }
    for (let k = 0; k < (big ? 2 : 1) + (rng() < 0.4 ? 1 : 0); k++) {
      const p = spotIn(r, 1.4, keep, 2.0);
      keep.push(p);
      props.addBuilder(hangingCage(rng, { top: WALL_H + 2, skeleton: rng() < 0.7 }), xf(p.x, 0, p.z, rng() * 6));
      nav.blockCircle(p.x, p.z, 0.55);
    }
    for (const f of pickFaces(r, 2 + Math.floor(rng() * 2), 2.2)) {
      const side = new THREE.Vector3(f.n.z, 0, -f.n.x);
      const p = f.face.clone().addScaledVector(f.n, 0.4).addScaledVector(side, range(rng, -0.5, 0.5));
      props.addBuilder(candles(rng, 4 + Math.floor(rng() * 6)), xf(p.x, 0, p.z, rng() * 6));
      pool.add(p.clone().setY(0.6), 7, 5, 0, 0xffa050);
    }
    if (rng() < 0.7) pickFaces(r, big ? 2 : 1, 3).forEach(cell);
    {
      for (let k = 0; k < (big ? 2 : 1); k++) {
        const p = spotIn(r, 1.6, keep, 2.2);
        keep.push(p);
        props.addBuilder(pedestalBrazier(rng), xf(p.x, 0, p.z, rng() * 6));
        addFire(new THREE.Vector3(p.x, PEDESTAL_BRAZIER_COALS_Y + 0.05, p.z), 0.7, 22, 11);
        nav.blockCircle(p.x, p.z, 0.55);
      }
    }
    if (rng() < 0.6) lowMist(roomCentre(r).x, roomCentre(r).z, Math.min(r.w, r.h) * CELL * 0.9);
  };

  let dressed = 0;
  for (const r of rooms) {
    if (r.boss) continue;
    if (++dressed % 2 === 0) await loading.step('Hanging chains and drawing runes', 0.72);
    const big = r.w >= 6 && r.h >= 6;
    const mx = -HALF + r.x * CELL;
    const mz = -HALF + r.y * CELL;
    if (big) {
      for (const fx of [0.25, 0.75]) {
        for (const fz of [0.25, 0.75]) {
          const x = mx + r.w * CELL * fx;
          const z = mz + r.h * CELL * fz;
          pillar(props, rng, x, z);
          nav.blockCircle(x, z, 0.6);
        }
      }
    }
    hangChains(r, 1 + Math.floor(rng() * 2));
    // Barrels and crates stacked into corners, bones on the floor.
    const corners = [
      [mx + 0.9, mz + 0.9],
      [mx + r.w * CELL - 0.9, mz + 0.9],
      [mx + 0.9, mz + r.h * CELL - 0.9],
      [mx + r.w * CELL - 0.9, mz + r.h * CELL - 0.9],
    ].sort(() => rng() - 0.5);
    if (gaol) {
      dressGaol(r);
      if (rng() < 0.3 && r !== start) runeCircle(roomCentre(r).x, roomCentre(r).z, range(rng, 1.6, 2.2), new THREE.Color(0.22, 0.02, 0.01));
      continue;
    }
    for (const [x, z] of corners.slice(0, 1 + Math.floor(rng() * 2))) {
      if (!nav.walkable(x, z)) continue;
      const kind = rng() < 0.5;
      props.add('wood', kind ? barrel(rng) : crate(rng), xf(x, kind ? 0 : 0.3, z, rng() * 6), 0.6);
      if (rng() < 0.5) props.add('wood', barrel(rng), xf(x + range(rng, -0.8, 0.8), 0, z + range(rng, -0.8, 0.8), rng() * 6), 0.6);
      nav.blockCircle(x, z, 0.7);
    }
    for (let k = 0; k < 2; k++) {
      const p = spotIn(r);
      props.addBuilder(bones(rng), xf(p.x, 0, p.z, rng() * 6));
    }
    if (rng() < 0.3 && r !== start) runeCircle(roomCentre(r).x, roomCentre(r).z, range(rng, 1.6, 2.2), new THREE.Color(0.22, 0.02, 0.01));
  }

  await loading.step('Dressing the rooms', 0.76);
  // ---- Entrance stairs ---------------------------------------------------
  // A flight climbing into the wall of the entrance room, back up to the fields.
  const stairFace = (() => {
    let best: { face: THREE.Vector3; n: THREE.Vector3 } | null = null;
    let bestScore = -1;
    for (const f of faces(start)) {
      // Prefer the middle of a solid stretch of wall.
      const side = new THREE.Vector3(f.n.z, 0, -f.n.x);
      let solid = 0;
      for (const s of [-2, -1, 1, 2]) {
        const p = f.face.clone().addScaledVector(side, s * 1.6).addScaledVector(f.n, -0.5);
        const q = f.face.clone().addScaledVector(side, s * 1.6).addScaledVector(f.n, 0.5);
        if (!floorAt(p.x, p.z) && floorAt(q.x, q.z)) solid++;
      }
      const score = solid + rng() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    return best!;
  })();
  {
    const { face, n } = stairFace;
    const yaw = Math.atan2(n.x, n.z); // local +Z points into the room
    const base = xf(face.x, 0, face.z, yaw);
    const steps = 6;
    for (let k = 0; k < steps; k++) {
      const depth = (steps - k) * 0.42;
      props.add('trim', new THREE.BoxGeometry(3.0, 0.3, 0.42), base.clone().multiply(xf(0, 0.15 + k * 0.3, depth - 0.21)), 0.6);
      props.add('trim', new THREE.BoxGeometry(3.0, 0.3 * k + 0.001, 0.42), base.clone().multiply(xf(0, (0.3 * k) / 2, depth - 0.21)), 0.6);
    }
    // Side walls of the flight and a dark arch where it disappears upward.
    for (const s of [-1, 1]) props.add('wall', new THREE.BoxGeometry(0.4, 2.0, steps * 0.42), base.clone().multiply(xf(s * 1.7, 1.0, (steps * 0.42) / 2)), 0.5);
    props.add('void', new THREE.PlaneGeometry(3.0, WALL_H - 0.4), base.clone().multiply(xf(0, (WALL_H - 0.4) / 2 + 0.3, 0.03)), 0);
    props.add('trim', new THREE.BoxGeometry(3.8, 0.45, 0.4), base.clone().multiply(xf(0, WALL_H - 0.1, 0.12)), 0.6);
    nav.blockBox(face.x + n.x * 1.3, face.z + n.z * 1.3, 1.9, 1.35, yaw);
    // Pale light falling down the stairs from the world above.
    pool.add(face.clone().addScaledVector(n, 1.2).setY(2.6), 6, 7, 0);
  }
  const exitPos = stairFace.face.clone().addScaledVector(stairFace.n, 3.2);
  const entryPos = stairFace.face.clone().addScaledVector(stairFace.n, 5.2);
  const entryYaw = Math.atan2(stairFace.n.x, stairFace.n.z);

  await loading.step('Sealing the vault', 0.82);
  // ---- Boss vault ---------------------------------------------------------
  // A round ritual arena: the corners walled off into an octagon, a great
  // layered rune circle, eight braziers on the rim, blood, chains and a low
  // red mist. One of three bosses waits in it, and the room is dressed for
  // whichever one it is.
  const vc = roomCentre(boss);
  const bossKind: BossKind = gaol ? 'inquisitor' : forcedBoss && forcedBoss in BOSS_THEMES ? (forcedBoss as BossKind) : CRYPT_BOSSES[Math.floor(rng() * 3)];
  const theme = BOSS_THEMES[bossKind];
  const bossName = theme.name;
  const doorA = Math.atan2(dir[0], dir[1]);
  const U = (a: number, r = 1, y = 0) => new THREE.Vector3(vc.x + Math.sin(a) * r, y, vc.z + Math.cos(a) * r);
  const APO = BS; // octagon apothem: half the vault, in metres
  const EDGE = 2 * APO * Math.tan(Math.PI / 8);
  const vaultPool = new LightPool(scene, 3, theme.light);
  mats.gore = new THREE.MeshStandardMaterial({ color: 0x4a0c08, roughness: 0.25, emissive: new THREE.Color(0.12, 0.0, 0.0) });
  mats.bloodPool = new THREE.MeshStandardMaterial({ color: 0x1c0101, roughness: 0.05, metalness: 0.3, emissive: new THREE.Color(0.08, 0, 0) });
  mats.shroud = new THREE.MeshStandardMaterial({ color: 0x6e665a, roughness: 0.95 });
  mats.ghostCoal = new THREE.MeshStandardMaterial({ color: 0x08040c, emissive: new THREE.Color(0.9, 0.35, 2.6), roughness: 1 });
  mats.splat = new THREE.MeshStandardMaterial({
    map: splatTexture(seed + 11),
    color: 0x5a0604,
    roughness: 0.12,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
  });
  // Corners walled off at 45 degrees: solid masonry with a capped top.
  for (let k = 1; k < 8; k += 2) {
    const a = doorA + (k * Math.PI) / 4;
    const c = U(a, APO + 1.7);
    props.add('wall', new THREE.BoxGeometry(EDGE + 0.3, WALL_H + 0.1, 3.4), xf(c.x, (WALL_H + 0.1) / 2, c.z, a), 0.5);
    props.add('trim', new THREE.BoxGeometry(EDGE + 0.4, 0.16, 3.5), xf(c.x, WALL_H + 0.18, c.z, a), 0.6);
    props.add('trim', new THREE.BoxGeometry(EDGE + 0.3, 0.35, 0.18), xf(...U(a, APO).toArray().map((v, i) => (i === 1 ? 0.17 : v)) as [number, number, number], a), 0.6);
    for (const t of [-1, 1]) {
      const q = U(a, APO).add(new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(t * EDGE * 0.32));
      props.add('trim', new THREE.BoxGeometry(0.5, WALL_H, 0.24), xf(q.x, WALL_H / 2, q.z, a), 0.6);
    }
    nav.blockBox(c.x, c.z, EDGE / 2 + 0.4, 1.7 + 0.3, a);
    // Big chains sagging across the face of each corner, with a hook in the middle.
    const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    const face = U(a, APO - 0.1);
    const l = face.clone().addScaledVector(side, -EDGE * 0.42).setY(WALL_H - 0.15);
    const r = face.clone().addScaledVector(side, EDGE * 0.42).setY(WALL_H - 0.15);
    chain(props, l, r, 0.9);
    const mid = face.clone().setY(WALL_H - 1.05);
    chain(props, mid, mid.clone().setY(1.1 + rng() * 0.4), 0.0);
    props.add('iron', new THREE.TorusGeometry(0.16, 0.025, 4, 10, Math.PI * 1.4), xf(mid.x, 1.0, mid.z, a, 1, 1, 1, 0, 2.2), 0);
  }
  // The circle itself: a wide outer ring of glyphs, the great circle and a
  // small inner seal that turns the other way.
  const ritual = runeCircle(vc.x, vc.z, 6.0, theme.rune.clone());
  const ritualOuter = runeCircle(vc.x, vc.z, 7.6, theme.rune.clone().multiplyScalar(0.5));
  const ritualInner = runeCircle(vc.x, vc.z, 2.6, theme.rune.clone());
  // Eight braziers on stone plinths at the corners of the octagon.
  const braziers: THREE.Vector3[] = [];
  for (let k = 0; k < 8; k++) {
    const a = doorA + Math.PI / 8 + (k * Math.PI) / 4;
    const p = U(a, 6.55);
    braziers.push(p);
    props.add('trim', new THREE.CylinderGeometry(0.62, 0.72, 0.3, 8), xf(p.x, 0.15, p.z, 0), 0.6);
    props.addBuilder(theme.ghost ? brazier().remap((m) => (m === 'coal' ? 'ghostCoal' : m)) : brazier(), xf(p.x, 0.28, p.z, rng() * 6));
    const fp = new THREE.Vector3(p.x, 1.43, p.z);
    if (theme.ghost) {
      const f = new Fire(0.85, 0, 1, true);
        f.group.position.copy(fp);
      scene.add(f.group);
      fires.push(f);
      vaultPool.add(fp.clone().setY(1.8), 22, 12, 0.6);
    } else addFire(fp, 0.85, 24, 12);
    nav.blockCircle(p.x, p.z, 0.75);
  }
  // Blood thrown across the floor, thickest around the circle's heart.
  for (let k = 0; k < 22; k++) {
    const a = rng() * Math.PI * 2;
    const r = k < 8 ? range(rng, 0.5, 3.2) : range(rng, 2, 7);
    const p = U(a, r);
    const sz = range(rng, 0.9, 2.6) * (k < 8 ? 1.3 : 1);
    props.add('splat', new THREE.PlaneGeometry(sz, sz).rotateX(-Math.PI / 2), xf(p.x, 0.035 + k * 0.0004, p.z, rng() * 6), 0);
  }
  // Chains down the three real walls, bones and skulls at their feet.
  for (const k of [2, 4, 6]) {
    const a = doorA + (k * Math.PI) / 4;
    const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    for (const t of [-2.3, 2.3]) {
      const f = U(a, APO - 0.08).addScaledVector(side, t);
      for (const s2 of [-0.3, 0.3]) {
        const top = f.clone().addScaledVector(side, s2).setY(WALL_H - 0.2);
        const bottom = f.clone().addScaledVector(side, s2 * 0.5).add(U(a, -0.1).sub(vc).setY(0)).setY(range(rng, 0.8, 1.4));
        chain(props, top, bottom, 0.02);
        props.add('iron', new THREE.TorusGeometry(0.09, 0.02, 4, 10), xf(bottom.x, bottom.y - 0.08, bottom.z, a), 0);
      }
      const b = f.clone().addScaledVector(U(a, 1).sub(vc), -0.7);
      props.addBuilder(bones(rng), xf(b.x, 0, b.z, rng() * 6));
    }
  }
  for (let k = 0; k < 6; k++) {
    const p = U(rng() * Math.PI * 2, range(rng, 4.5, 6.8));
    if (nav.walkable(p.x, p.z)) props.addBuilder(bones(rng), xf(p.x, 0, p.z, rng() * 6));
  }
  // A low mist the colour of the room, drifting over the floor.
  const mistMat = new THREE.MeshBasicMaterial({ map: mistTexture(seed + 13), color: theme.mist, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const mists: THREE.Mesh[] = [];
  for (let k = 0; k < 5; k++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(13 - k, 13 - k).rotateX(-Math.PI / 2), mistMat);
    m.position.set(vc.x + range(rng, -1, 1), 0.2 + k * 0.17, vc.z + range(rng, -1, 1));
    m.rotation.y = rng() * 6;
    m.renderOrder = 6;
    scene.add(m);
    mists.push(m);
  }
  const back = U(doorA + Math.PI, APO - 1.6);
  const backYaw = doorA;
  const themed = { pool: null as THREE.Mesh | null, shaft: null as THREE.Mesh | null };
  await loading.step('Sealing the vault', 0.86);
  // The gaol's upper vault: a stairwell sunk in the middle of the floor,
  // walled with a parapet, braziers at its corners, red light from below.
  const stairYaw = Math.atan2(-dir[0], -dir[1]); // local -Z faces the vault door
  const stairTop = vc.clone().add(new THREE.Vector3(dir[0], 0, dir[1]).multiplyScalar(1.7));
  if (descent) {
    for (const r of [ritual, ritualOuter, ritualInner]) r.mesh.visible = false;
    const SW = 3.2;
    const SL = 5.2;
    const m = xf(vc.x, 0, vc.z, stairYaw);
    const at = (x: number, y: number, z: number) => m.clone().multiply(xf(x, y, z));
    // The shaft below the floor, drawn before a depth-only lid so the floor
    // never covers it: steps going down into the dark.
    const shaft = new MeshBuilder();
    const steps = 11;
    for (let k = 0; k < steps; k++) {
      const z0 = -SL / 2 + k * (SL / steps);
      const y = -(k + 1) * 0.33;
      shaft.add('trim', new THREE.BoxGeometry(SW, 0.33, SL / steps + 0.02), at(0, y + 0.165, z0 + SL / steps / 2), 0.6);
      shaft.add('wall', new THREE.BoxGeometry(SW, 4, SL / steps + 0.02), at(0, y - 2, z0 + SL / steps / 2), 0.5);
    }
    for (const sx of [-1, 1]) shaft.add('wall', new THREE.BoxGeometry(0.3, 5, SL), at(sx * (SW / 2 + 0.15), -2.5, 0), 0.5);
    shaft.add('wall', new THREE.BoxGeometry(SW + 0.6, 5, 0.3), at(0, -2.5, SL / 2 + 0.15), 0.5);
    shaft.add('void', new THREE.PlaneGeometry(SW, 2.2), at(0, -3.2, SL / 2 - 0.01).multiply(xf(0, 0, 0, Math.PI)), 0);
    const shaftGroup = shaft.build(mats, false);
    shaftGroup.traverse((o) => (o.renderOrder = -2));
    scene.add(shaftGroup);
    const lid = new THREE.Mesh(new THREE.PlaneGeometry(SW, SL).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ colorWrite: false }));
    lid.applyMatrix4(at(0, 0.012, 0));
    lid.renderOrder = -1;
    scene.add(lid);
    dryFlood(vc.x, vc.z, SW / 2 + 1.2, SL / 2 + 1.2, stairYaw);
    // Red light welling up out of the stair.
    vaultPool.add(new THREE.Vector3().setFromMatrixPosition(at(0, -0.6, 1.2)), 16, 9, 0.3);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(SW, SL).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shaftTexture(), color: new THREE.Color(0.28, 0.02, 0.008), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    glow.applyMatrix4(at(0, 0.05, 0));
    glow.renderOrder = 7;
    scene.add(glow);
    // Parapet on three sides, posts at the corners with chains slung between.
    for (const sx of [-1, 1]) props.add('trim', new THREE.BoxGeometry(0.4, 0.85, SL + 0.4), at(sx * (SW / 2 + 0.2), 0.425, 0.2), 0.6);
    props.add('trim', new THREE.BoxGeometry(SW + 0.8, 0.85, 0.4), at(0, 0.425, SL / 2 + 0.2), 0.6);
    const posts: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pm = at(sx * (SW / 2 + 0.2), 0, sz * (SL / 2 + 0.2));
        props.add('trim', new THREE.BoxGeometry(0.6, 1.5, 0.6), pm.clone().multiply(xf(0, 0.75, 0)), 0.6);
        props.add('trim', new THREE.BoxGeometry(0.72, 0.16, 0.72), pm.clone().multiply(xf(0, 1.55, 0)), 0.6);
        posts.push(new THREE.Vector3().setFromMatrixPosition(pm).setY(1.45));
      }
    }
    chain(props, posts[0], posts[1], 0.35);
    chain(props, posts[2], posts[3], 0.35);
    chain(props, posts[1], posts[3], 0.3);
    nav.blockBox(vc.x + Math.sin(stairYaw) * 0.25, vc.z + Math.cos(stairYaw) * 0.25, SW / 2 + 0.45, SL / 2 + 0.2, stairYaw);
    // Leave the head of the stair open to step down.
    const head = new THREE.Vector3().setFromMatrixPosition(at(0, 0, -SL / 2 + 0.6));
    nav.unblockRect(head.x, head.z, 0.9, 0.9);
    stairTop.copy(head);
    // Skulls and candles heaped by the stair head.
    for (const sx of [-1, 1]) {
      const c = new THREE.Vector3().setFromMatrixPosition(at(sx * (SW / 2 + 1.0), 0, -SL / 2 - 0.4));
      props.addBuilder(candles(rng, 7), xf(c.x, 0, c.z, rng() * 6));
    }
    props.addBuilder(skullPile(rng), at(SW / 2 + 1.4, 0, SL / 2 - 0.5));
    const pile = new THREE.Vector3().setFromMatrixPosition(at(SW / 2 + 1.4, 0, SL / 2 - 0.5));
    nav.blockCircle(pile.x, pile.z, 0.8);
  } else if (bossKind === 'inquisitor') {
    // The Inquisitor's court: a judgement seat on a dais, cages hung over the
    // rim, racks and an open maiden along the walls, candles round the circle.
    const t = xf(back.x, 0, back.z, backYaw);
    const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => t.clone().multiply(xf(x, y, z, 0, sx, sy, sz));
    props.add('altar', new THREE.BoxGeometry(4.0, 0.25, 2.4), at(0, 0.125, 0), 0.6);
    props.add('altar', new THREE.BoxGeometry(3.0, 0.25, 1.8), at(0, 0.375, -0.2), 0.6);
    props.add('altar', new THREE.BoxGeometry(1.5, 0.55, 1.1), at(0, 0.775, -0.35), 0.6);
    props.add('altar', new THREE.BoxGeometry(1.7, 3.2, 0.3), at(0, 2.1, -0.9), 0.6);
    props.add('gore', new THREE.BoxGeometry(1.1, 0.06, 0.9), at(0, 1.08, -0.3), 0.5);
    for (const sx of [-1, 1]) {
      props.add('altar', new THREE.BoxGeometry(0.24, 0.7, 1.1), at(sx * 0.72, 1.3, -0.35), 0.6);
      props.add('iron', new THREE.ConeGeometry(0.1, 1.0, 5), at(sx * 0.7, 4.2, -0.9), 0);
      props.add('iron', new THREE.ConeGeometry(0.07, 0.6, 5), at(sx * 0.4, 4.0, -0.9), 0);
    }
    props.add('iron', new THREE.ConeGeometry(0.12, 1.4, 5), at(0, 4.4, -0.9), 0);
    // A spiked wheel mounted behind the seat.
    props.add('iron', new THREE.TorusGeometry(1.1, 0.07, 6, 28), at(0, 2.6, -1.1), 0);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      props.add('iron', new THREE.ConeGeometry(0.06, 0.4, 5).rotateZ(-a).translate(Math.sin(a) * 1.3, Math.cos(a) * 1.3, 0), at(0, 2.6, -1.1), 0);
    }
    nav.blockBox(back.x, back.z, 2.1, 1.3, backYaw);
    for (const k of [1, 3, 5, 7]) {
      const p = U(doorA + (k * Math.PI) / 4, 4.6);
      props.addBuilder(hangingCage(rng, { top: WALL_H + 2.5, skeleton: rng() < 0.8 }), xf(p.x, 0, p.z, rng() * 6));
      nav.blockCircle(p.x, p.z, 0.55);
    }
    for (const k of [2, 6]) {
      const a = doorA + (k * Math.PI) / 4;
      const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      const p = U(a, APO - 1.3).addScaledVector(side, 2.6);
      props.addBuilder(k === 2 ? rack(rng, true) : maidenProp(rng), xf(p.x, 0, p.z, a + Math.PI));
      nav.blockCircle(p.x, p.z, 1.1);
    }
    for (let k = 0; k < 10; k++) {
      const p = U(doorA + (k / 10) * Math.PI * 2 + 0.2, 7.0);
      if (nav.walkable(p.x, p.z)) props.addBuilder(candles(rng, 5), xf(p.x, 0, p.z, rng() * 6));
    }
    vaultPool.add(vc.clone().setY(1.2), 9, 9, 0.3);
  } else if (bossKind === 'abomination') {
    // A pool of blood at the heart of the circle, the thing below it.
    const g = new THREE.CircleGeometry(2.7, 40);
    const gp = g.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 1; v < gp.count; v++) {
      const x = gp.getX(v);
      const y = gp.getY(v);
      const d = 1 + fbm2(x * 0.9 + seed * 0.01, y * 0.9, 3, seed + 31) * 0.35;
      gp.setXY(v, x * d, y * d);
    }
    const pm = new THREE.Mesh(g.rotateX(-Math.PI / 2), mats.bloodPool);
    pm.position.set(vc.x, 0.04, vc.z);
    pm.receiveShadow = true;
    scene.add(pm);
    themed.pool = pm;
    vaultPool.add(vc.clone().setY(0.8), 9, 7, 0.2);
    // Flesh grown over the walls: swollen lumps, sacs and veins climbing the stone.
    for (let k = 1; k < 8; k++) {
      const a = doorA + (k * Math.PI) / 4;
      const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      for (let q = 0; q < 4; q++) {
        const f = U(a, APO - 0.25).addScaledVector(side, range(rng, -EDGE * 0.45, EDGE * 0.45));
        const sz = range(rng, 0.35, 0.85);
        props.add(rng() < 0.75 ? 'gore' : 'egg', fleshLump(rng), xf(f.x, sz * 0.4, f.z, rng() * 6, sz, sz * range(rng, 0.6, 1.1), sz), 0.5);
      }
      for (let q = 0; q < 3; q++) {
        const f = U(a, APO - 0.06).addScaledVector(side, range(rng, -EDGE * 0.45, EDGE * 0.45));
        const pts = [f.clone().setY(0)];
        for (let h = 1; h <= 4; h++) pts.push(f.clone().addScaledVector(side, Math.sin(h * 1.7 + q) * 0.3).setY((h / 4) * range(rng, 1.6, 2.9)));
        props.add('gore', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, range(rng, 0.03, 0.07), 5), undefined, 0);
      }
    }
    // Butcher's hooks on iron arms over the rim, meat still on some of them.
    for (const k of [2, 3, 5, 6]) {
      const a = doorA + (k * Math.PI) / 4;
      const f = U(a, APO - 0.05);
      const tip = U(a, APO - 1.1, WALL_H - 0.25);
      props.add('iron', new THREE.BoxGeometry(0.08, 0.08, 1.1), xf((f.x + tip.x) / 2, WALL_H - 0.25, (f.z + tip.z) / 2, a), 0);
      const low = tip.clone().setY(range(rng, 1.3, 1.8));
      chain(props, tip, low, 0);
      props.add('iron', new THREE.TorusGeometry(0.14, 0.025, 4, 10, Math.PI * 1.3), xf(low.x, low.y - 0.12, low.z, a, 1, 1, 1, 0, 2.4), 0);
      if (rng() < 0.75) props.add('gore', fleshLump(rng), xf(low.x, low.y - 0.55, low.z, rng() * 6, 0.32, 0.6, 0.28), 0.5);
    }
    // A slab at the back heaped with offal.
    props.add('altar', new THREE.BoxGeometry(2.4, 0.9, 1.1), xf(back.x, 0.45, back.z, backYaw), 0.6);
    for (let q = 0; q < 5; q++) props.add('gore', fleshLump(rng), xf(back.x + range(rng, -0.9, 0.9), 0.95, back.z + range(rng, -0.35, 0.35), rng() * 6, 0.3, 0.2, 0.25), 0.5);
    nav.blockBox(back.x, back.z, 1.4, 0.75, backYaw);
  } else if (bossKind === 'lich') {
    // A throne on a dais at the back, empty while its king kneels in the circle.
    const t = xf(back.x, 0, back.z, backYaw);
    const at = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => t.clone().multiply(xf(x, y, z, 0, sx, sy, sz));
    props.add('altar', new THREE.BoxGeometry(3.6, 0.25, 2.2), at(0, 0.125, 0), 0.6);
    props.add('altar', new THREE.BoxGeometry(2.8, 0.25, 1.6), at(0, 0.375, -0.2), 0.6);
    props.add('altar', new THREE.BoxGeometry(1.3, 0.5, 1.0), at(0, 0.75, -0.35), 0.6);
    props.add('altar', new THREE.BoxGeometry(1.4, 2.6, 0.25), at(0, 1.8, -0.85), 0.6);
    for (const sx of [-1, 1]) {
      props.add('altar', new THREE.BoxGeometry(0.22, 0.6, 1.0), at(sx * 0.62, 1.2, -0.35), 0.6);
      props.add('iron', new THREE.ConeGeometry(0.09, 0.9, 5), at(sx * 0.6, 3.5, -0.85), 0);
    }
    props.add('iron', new THREE.ConeGeometry(0.11, 1.2, 5), at(0, 3.7, -0.85), 0);
    props.addBuilder(bones(rng), at(0, 0.5, 0.7));
    nav.blockBox(back.x, back.z, 1.9, 1.2, backYaw);
    // Sarcophagi along the side walls, one lid shoved aside.
    for (const k of [2, 6]) {
      const a = doorA + (k * Math.PI) / 4;
      const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      for (const s2 of [-1.7, 1.7]) {
        const p = U(a, 6.7).addScaledVector(side, s2);
        props.add('altar', new THREE.BoxGeometry(1.0, 0.75, 2.1), xf(p.x, 0.375, p.z, a), 0.6);
        const open = rng() < 0.35;
        props.add('trim', new THREE.BoxGeometry(1.15, 0.16, 2.25), xf(p.x + (open ? side.x * 0.4 : 0), 0.83, p.z + (open ? side.z * 0.4 : 0), a + (open ? 0.3 : 0)), 0.6);
        props.add('trim', new THREE.BoxGeometry(0.5, 0.12, 0.5), xf(p.x, 0.97, p.z, a), 0.6);
        nav.blockBox(p.x, p.z, 0.6, 1.15, a);
      }
    }
    // Witch-light pooled in the circle.
    vaultPool.add(vc.clone().setY(1.0), 8, 8, 0.3);
  } else {
    // Moonlight falling through a broken roof onto the circle.
    const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTexture(), color: new THREE.Color(0.035, 0.05, 0.085), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.8, 14, 24, 1, true).translate(0, 7, 0), shaftMat);
    shaft.position.copy(vc);
    shaft.renderOrder = 7;
    scene.add(shaft);
    themed.shaft = shaft;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: mistTexture(seed + 17), color: new THREE.Color(0.06, 0.085, 0.14), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    disc.position.set(vc.x, 0.05, vc.z);
    disc.renderOrder = 6;
    scene.add(disc);
    vaultPool.add(vc.clone().setY(6), 16, 14, 0);
    // The ribs of something enormous arch out of the walls on both sides.
    for (const k of [2, 6]) {
      const a = doorA + (k * Math.PI) / 4;
      const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
      const inward = U(a, -1).sub(vc).setY(0);
      for (const s2 of [-2.6, -1.3, 0, 1.3, 2.6]) {
        const base = U(a, APO - 0.3).addScaledVector(side, s2);
        const h = 3.6 - Math.abs(s2) * 0.35;
        const reach = 2.4 - Math.abs(s2) * 0.2;
        const pts = [
          base.clone(),
          base.clone().addScaledVector(inward, reach * 0.1).setY(h * 0.55),
          base.clone().addScaledVector(inward, reach * 0.55).setY(h),
          base.clone().addScaledVector(inward, reach).setY(h * 0.8),
        ];
        props.add('bone', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.12, 6), undefined, 0);
      }
      // Its spine along the wall top.
      const sp = U(a, APO - 0.2);
      props.add('bone', new THREE.CylinderGeometry(0.2, 0.2, 7, 7).rotateZ(Math.PI / 2), xf(sp.x, WALL_H - 0.1, sp.z, a), 0);
      for (let q = -3; q <= 3; q++) {
        const v = sp.clone().addScaledVector(side, q);
        props.add('bone', new THREE.SphereGeometry(0.3, 8, 6), xf(v.x, WALL_H - 0.1, v.z, a, 1, 0.8, 1), 0);
      }
    }
    // The remains of its meals, wrapped and hung from the walls.
    for (const k of [1, 3, 4, 5, 7]) {
      const a = doorA + (k * Math.PI) / 4;
      const tip = U(a, APO - 1.0, WALL_H - 0.2);
      const f = U(a, APO - 0.05);
      props.add('iron', new THREE.BoxGeometry(0.08, 0.08, 1.0), xf((f.x + tip.x) / 2, WALL_H - 0.2, (f.z + tip.z) / 2, a), 0);
      const low = tip.clone().setY(range(rng, 2.1, 2.5));
      chain(props, tip, low, 0);
      props.add('shroud', cocoon(), xf(low.x, low.y - 1.45, low.z, rng() * 6, 1, 1, 1, range(rng, -0.08, 0.08)), 0.5);
    }
    // A great horned skull at the back in place of an altar.
    const t = xf(back.x, 0, back.z, backYaw);
    const at = (x: number, y: number, z: number, rx = 0, sx = 1, sy = 1, sz = 1) => t.clone().multiply(xf(x, y, z, 0, sx, sy, sz, rx));
    props.add('bone', new THREE.SphereGeometry(1, 18, 12), at(0, 0.78, -0.45, 0, 0.85, 0.72, 0.95), 0);
    props.add('bone', new THREE.CylinderGeometry(0.32, 0.55, 1.6, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2), at(0, 0.55, 0.65, 0.12, 1.25, 0.8, 1), 0);
    props.add('bone', new THREE.BoxGeometry(1.5, 0.22, 0.45), at(0, 1.08, 0.12, 0.25), 0);
    props.add('bone', new THREE.CylinderGeometry(0.25, 0.45, 1.5, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2), at(0, 0.14, 0.7, -0.08, 1.2, 0.35, 1), 0);
    for (const sx of [-1, 1]) {
      props.add('void', new THREE.SphereGeometry(0.22, 10, 8), at(sx * 0.42, 0.92, 0.32), 0);
      props.add('void', new THREE.SphereGeometry(0.07, 6, 5), at(sx * 0.13, 0.62, 1.42), 0);
      for (const fz of [1.15, 0.8]) props.add('bone', new THREE.ConeGeometry(0.07, fz > 1 ? 0.55 : 0.32, 6).rotateX(Math.PI), at(sx * (fz > 1 ? 0.28 : 0.36), 0.2, fz), 0);
      const horn = [
        [0.55, 1.05, -0.55],
        [1.05, 1.7, -0.95],
        [1.35, 2.5, -0.75],
        [1.2, 3.05, -0.1],
      ].map(([x, y, z]) => new THREE.Vector3(sx * x, y, z));
      props.add('bone', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(horn), 16, 0.15, 7), t, 0);
      props.add('bone', new THREE.ConeGeometry(0.15, 0.4, 7), t.clone().multiply(new THREE.Matrix4().lookAt(horn[3], horn[3].clone().add(new THREE.Vector3(-sx * 0.2, 0.2, 0.9)), new THREE.Vector3(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).setPosition(horn[3])), 0);
    }
    for (let q = 0; q < 6; q++) props.add('rubble', rock(rng, range(rng, 0.25, 0.5)), at(range(rng, -1.6, 1.6), 0, range(rng, -1.4, 1.2), 0), 0.5);
    nav.blockCircle(back.x, back.z, 1.4);
  }
  // Keep the boss's shaders hot so the first ability doesn't hitch.
  prewarmTelegraph(scene);
  prewarmBossFx(scene);
  {
    const warm = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), auraMaterial(new THREE.Color(1, 0, 1)));
    warm.position.set(vc.x, -5, vc.z);
    warm.frustumCulled = false;
    scene.add(warm);
  }

  // Sealed door: stone jambs, a lintel with the seal rune, and a portcullis
  // that grinds down into the floor when the seal breaks.
  const doorPos = new THREE.Vector3(
    dir[1] !== 0 ? -HALF + (boss.x + 4) * CELL : -HALF + (dir[0] > 0 ? boss.x + BS : boss.x) * CELL,
    0,
    dir[1] !== 0 ? -HALF + (dir[1] > 0 ? boss.y + BS : boss.y) * CELL : -HALF + (boss.y + 4) * CELL,
  );
  const doorYaw = Math.atan2(dir[0], dir[1]); // local +Z faces out of the vault
  if (!descent) {
    const m = xf(doorPos.x, 0, doorPos.z, doorYaw);
    for (const s of [-1, 1]) props.add('trim', new THREE.BoxGeometry(0.7, WALL_H + 0.4, 1.0), m.clone().multiply(xf(s * 2.3, (WALL_H + 0.4) / 2, 0)), 0.6);
    props.add('trim', new THREE.BoxGeometry(5.4, 0.7, 1.1), m.clone().multiply(xf(0, WALL_H + 0.25, 0)), 0.6);
  }
  const door = new THREE.Group();
  door.position.copy(doorPos);
  door.rotation.y = doorYaw;
  {
    const bars = new MeshBuilder();
    for (let x = -1.85; x <= 1.86; x += 0.26) {
      bars.add('iron', new THREE.CylinderGeometry(0.035, 0.035, WALL_H, 6), xf(x, WALL_H / 2, 0), 0);
      bars.add('iron', new THREE.ConeGeometry(0.05, 0.16, 6).rotateX(Math.PI), xf(x, -0.02, 0), 0);
    }
    for (const y of [0.35, 1.2, 2.05, 2.85]) bars.add('iron', new THREE.BoxGeometry(3.9, 0.07, 0.07), xf(0, y, 0), 0);
    door.add(bars.build(mats));
  }
  const sealMat = new THREE.MeshBasicMaterial({
    map: runeTexture(seed + 5),
    color: new THREE.Color(2.4, 0.12, 0.05),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const seal = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), sealMat);
  seal.position.set(0, 1.55, 0.06);
  door.add(seal);
  if (!descent) {
    scene.add(door);
    nav.blockBox(doorPos.x, doorPos.z, 2.1, 0.4, doorYaw);
  }
  pool.add(doorPos.clone().addScaledVector(new THREE.Vector3(dir[0], 0, dir[1]), 0.8).setY(1.6), 7, 6, 0.3);

  await loading.step('Binding the three seals', 0.9);
  // ---- Objectives --------------------------------------------------------
  // Each run draws its own unlocks: three seals on the crypt, two on the
  // Inquisitor's court, none on the gaol's upper level.
  const draw = [...UNLOCKS].sort(() => rng() - 0.5);
  if (forcedUnlock && (UNLOCKS as string[]).includes(forcedUnlock)) draw.unshift(...draw.splice(draw.indexOf(forcedUnlock as Objective), 1));
  const chosen = draw.slice(0, descent ? 0 : gaol ? 2 : 3);
  // Who keeps the dungeon: the crypt's dead, or the gaol's torturers and prisoners.
  const fodder: MonsterKind[] = gaol ? ['gaunt', 'leech'] : ['ghoul', 'crawler'];
  // Deepest rooms first; objectives take rooms from the deep end, packs fill the rest.
  const candidates = rooms.filter((r) => !r.boss && r !== start).sort((a, b) => b.depth - a.depth);
  const free = [...candidates];
  const takeRoom = (role: string) => {
    // Pick among the deeper half so the hunt spreads through the crypt.
    const k = Math.floor(rng() * Math.max(1, Math.ceil(free.length / 2)));
    const r = free.splice(k, 1)[0] ?? candidates[Math.floor(rng() * candidates.length)];
    r.role = role;
    return r;
  };

  const spawns: MonsterSpawn[] = [];
  let pack = 0;
  const levelOf = (r: Room) => (variant === 'gaol1' ? 5 : variant === 'gaol2' ? 7 : 4) + Math.round(r.depth * 2);
  const add = (r: Room, kind: MonsterKind, count: number, opts: Partial<MonsterSpawn> = {}, avoid: THREE.Vector3[] = []) => {
    for (let k = 0; k < count; k++) spawns.push({ kind, pos: spotIn(r, 1.4, avoid, 2), level: levelOf(r), pack, wander: kind === 'cultist' ? 0 : 2.5, ...opts });
  };

  const state = { runes: 0, warden: false, key: false, hearts: 0, brood: false, braziers: 0, levers: 0, shards: 0, marked: 0, guard: false, sealBroken: false, doorT: -1, bossDead: false };
  const levers: { arm: THREE.Object3D; t: number }[] = [];
  const shards: THREE.Object3D[] = [];
  const interactables: Interactable[] = [];
  const runes: { pos: THREE.Vector3; mat: THREE.MeshBasicMaterial; charge: number; lit: boolean }[] = [];
  const hearts: { pos: THREE.Vector3; mesh: THREE.Object3D; burst: boolean }[] = [];
  let keyMesh: THREE.Object3D | null = null;
  const pulsing: THREE.Object3D[] = [];

  for (const obj of chosen) {
    if (obj === 'runes' || obj === 'hearts') {
      for (let k = 0; k < 3; k++) {
        const r = takeRoom(obj);
        const p = roomCentre(r);
        if (obj === 'runes') {
          const c = runeCircle(p.x, p.z, 1.5, new THREE.Color(0.18, 0.025, 0.015));
          runes.push({ pos: p, mat: c.mat, charge: 0, lit: false });
        } else {
          // Blood Heart: a swollen, veined organ on a bone-strewn plinth.
          const g = new THREE.Group();
          g.position.copy(p);
          const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.6, 8), mats.altar);
          plinth.position.y = 0.3;
          plinth.castShadow = plinth.receiveShadow = true;
          const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 3), mats.flesh);
          const hp = heart.geometry.getAttribute('position') as THREE.BufferAttribute;
          for (let v = 0; v < hp.count; v++) {
            const x = hp.getX(v);
            const y = hp.getY(v);
            const z = hp.getZ(v);
            const d = 1 + fbm2(x * 6 + 3, y * 6 + z * 4, 3, seed + v % 7) * 0.25 + (y < 0 ? -y * 0.4 : 0);
            hp.setXYZ(v, x * d, y * d * 1.15, z * d);
          }
          heart.geometry.computeVertexNormals();
          heart.position.y = 1.05;
          heart.castShadow = true;
          for (let k2 = 0; k2 < 5; k2++) {
            const a = (k2 / 5) * Math.PI * 2;
            const vein = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.9, 5), mats.flesh);
            vein.position.set(Math.cos(a) * 0.4, 0.6, Math.sin(a) * 0.4);
            vein.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
            g.add(vein);
          }
          g.add(plinth, heart);
          scene.add(g);
          pulsing.push(heart);
          nav.blockCircle(p.x, p.z, 0.7);
          const h = { pos: p, mesh: g, burst: false };
          hearts.push(h);
          interactables.push({
            pos: p,
            radius: 1.6,
            label: 'Blood Heart',
            active: () => !h.burst,
            use: () => {
              if (h.burst) return;
              h.burst = true;
              state.hearts++;
              g.remove(heart);
              const c = ctxRef.current;
              const at = p.clone().setY(1.05);
              c?.effects.blood(at, p.clone().setY(-1), 46, new THREE.Color(0.3, 0.01, 0.008), 1.6);
              c?.effects.splat(p.x, p.z, 2.6);
              c?.effects.flash(at, 0xff2010, 30, 6, 0.4);
              c?.effects.addShake(0.35);
              audio.heartBurst(at);
              c?.say(`Blood Heart burst (${state.hearts}/3)`);
              if (state.hearts === 3) objectiveDone('The last heart is still');
            },
          });
        }
        pack++;
        add(r, fodder[rng() < 0.5 ? 0 : 1], 3 + Math.floor(rng() * 2));
      }
    } else if (obj === 'warden') {
      const r = takeRoom(obj);
      pack++;
      add(r, gaol ? 'butcher' : 'horror', 1, { elite: 'The Gaoler', tag: 'warden', level: levelOf(r) + 1 });
      add(r, gaol ? 'gaunt' : 'ghoul', 3);
      hangChains(r, 3);
    } else if (obj === 'brood') {
      const r = takeRoom(obj);
      pack++;
      add(r, gaol ? 'leech' : 'spider', 1, { elite: gaol ? 'The Bloated Mother' : 'The Brood Mother', tag: 'brood', level: levelOf(r) + 1 });
      add(r, gaol ? 'leech' : 'crawler', 5);
      // Webs strung across the corners and egg clutches on the floor.
      const webMat = new THREE.MeshBasicMaterial({ map: webTexture(seed + 11), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, color: 0xb8b0a8 });
      const mx = -HALF + r.x * CELL;
      const mz = -HALF + r.y * CELL;
      const W = r.w * CELL;
      const D = r.h * CELL;
      for (const [x, z, yaw] of [
        [mx + 0.9, mz + 0.9, Math.PI / 4],
        [mx + W - 0.9, mz + 0.9, -Math.PI / 4],
        [mx + 0.9, mz + D - 0.9, -Math.PI / 4],
        [mx + W - 0.9, mz + D - 0.9, Math.PI / 4],
      ]) {
        const web = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), webMat);
        web.position.set(x, 1.9, z);
        web.rotation.y = yaw;
        scene.add(web);
      }
      for (let k = 0; k < 4; k++) {
        const p = spotIn(r, 1.2);
        for (let e = 0; e < 5; e++) {
          const s = range(rng, 0.14, 0.24);
          props.add('egg', new THREE.SphereGeometry(1, 8, 6).scale(s, s * 1.3, s), xf(p.x + range(rng, -0.35, 0.35), s, p.z + range(rng, -0.35, 0.35), rng() * 6), 0);
        }
        const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2), webMat);
        w.position.set(p.x, 0.03, p.z);
        scene.add(w);
      }
    } else if (obj === 'key') {
      const r = takeRoom(obj);
      const p = roomCentre(r);
      props.add('altar', new THREE.BoxGeometry(1.2, 0.9, 0.7), xf(p.x, 0.45, p.z, rng() * 6), 0.6);
      nav.blockCircle(p.x, p.z, 0.8);
      // The key: a long bone shaft with a skull bow, glowing faintly.
      const key = new THREE.Group();
      const keyMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.5, emissive: new THREE.Color(0.35, 0.18, 0.08) });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6).rotateZ(Math.PI / 2), keyMat);
      const bow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8).scale(1, 0.9, 1.1), keyMat);
      bow.position.x = -0.28;
      const bit = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.03), keyMat);
      bit.position.set(0.22, -0.06, 0);
      key.add(shaft, bow, bit);
      key.position.set(p.x, 1.15, p.z);
      scene.add(key);
      keyMesh = key;
      pool.add(p.clone().setY(1.6), 4, 5, 0);
      interactables.push({
        pos: p,
        radius: 1.6,
        label: 'Bone Key',
        active: () => !state.key,
        use: () => {
          if (state.key) return;
          state.key = true;
          scene.remove(key);
          ctxRef.current?.effects.sparks(key.position.clone(), 20, new THREE.Color(1.8, 1.2, 0.6), 2, 0.8);
          objectiveDone('The Bone Key is yours');
        },
      });
      pack++;
      add(r, gaol ? 'bonePriest' : 'cultist', 2, {}, [p]);
      add(r, gaol ? 'gaunt' : 'ghoul', 3, {}, [p]);
    } else if (obj === 'braziers') {
      // Four cold braziers; lit, they burn for good.
      for (let k = 0; k < 4; k++) {
        const r = takeRoom(obj);
        const p = spotIn(r, 1.6, [roomCentre(r)], 1.8);
        const fireAt = new THREE.Vector3(p.x, gaol ? PEDESTAL_BRAZIER_COALS_Y + 0.05 : 1.43, p.z);
        if (gaol) props.addBuilder(pedestalBrazier(rng).remap((m) => (m === 'coal' ? 'ash' : m)), xf(p.x, 0, p.z, rng() * 6));
        else {
          props.add('trim', new THREE.CylinderGeometry(0.62, 0.72, 0.3, 8), xf(p.x, 0.15, p.z, 0), 0.6);
          props.addBuilder(brazier().remap((m) => (m === 'coal' ? 'ash' : m)), xf(p.x, 0.28, p.z, rng() * 6));
        }
        nav.blockCircle(p.x, p.z, 0.7);
        let lit = false;
        interactables.push({
          pos: p,
          radius: 1.7,
          label: 'Cold Brazier',
          active: () => !lit,
          use: () => {
            if (lit) return;
            lit = true;
            state.braziers++;
            addFire(fireAt, 0.85, 24, 12);
            const c = ctxRef.current;
            c?.effects.sparks(fireAt.clone(), 26, new THREE.Color(2.2, 0.8, 0.25), 3, 0.8);
            c?.effects.flash(fireAt.clone(), 0xff6020, 30, 8, 0.5);
            audio.runeLit(fireAt);
            c?.say(`Brazier lit (${state.braziers}/4)`);
            if (state.braziers === 4) objectiveDone('The braziers blaze');
          },
        });
        pack++;
        add(r, fodder[k % 2], 3 + Math.floor(rng() * 2), {}, [p]);
      }
    } else if (obj === 'levers') {
      // Three rusted levers on the walls, each drawing a chain up into the dark.
      for (let k = 0; k < 3; k++) {
        const r = takeRoom(obj);
        const f = pickFaces(r, 1, 2)[0] ?? faces(r)[0];
        const yaw = Math.atan2(f.n.x, f.n.z);
        const m = xf(f.face.x, 0, f.face.z, yaw);
        props.add('iron', new THREE.BoxGeometry(0.5, 0.8, 0.08), m.clone().multiply(xf(0, 1.25, 0.04)), 0);
        for (const sx of [-1, 1]) props.add('iron', new THREE.CylinderGeometry(0.03, 0.03, 0.06, 6).rotateX(Math.PI / 2), m.clone().multiply(xf(sx * 0.18, 1.55, 0.1)), 0);
        props.add('iron', new THREE.BoxGeometry(0.1, 0.1, 0.2), m.clone().multiply(xf(0, 1.25, 0.14)), 0);
        const top = new THREE.Vector3().setFromMatrixPosition(m.clone().multiply(xf(0.18, WALL_H - 0.1, 0.08)));
        chain(props, new THREE.Vector3().setFromMatrixPosition(m.clone().multiply(xf(0.18, 1.62, 0.1))), top, 0);
        const arm = new THREE.Group();
        arm.applyMatrix4(m.clone().multiply(xf(0, 1.25, 0.2)));
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6).translate(0, 0.35, 0), mats.iron);
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mats.wood);
        knob.position.y = 0.72;
        const pivot = new THREE.Group();
        pivot.rotation.x = -0.75;
        pivot.add(handle, knob);
        handle.castShadow = knob.castShadow = true;
        arm.add(pivot);
        scene.add(arm);
        const lever = { arm: pivot, t: -1 };
        levers.push(lever);
        const p = f.face.clone().addScaledVector(f.n, 0.9);
        interactables.push({
          pos: p,
          radius: 1.5,
          label: 'Rusted Lever',
          active: () => lever.t < 0,
          use: () => {
            if (lever.t >= 0) return;
            lever.t = 0;
            state.levers++;
            const c = ctxRef.current;
            const at = new THREE.Vector3().setFromMatrixPosition(arm.matrixWorld);
            c?.effects.sparks(at, 14, new THREE.Color(1.6, 0.7, 0.3), 2.5, 0.5);
            c?.effects.addShake(0.2);
            audio.doorOpen(at);
            c?.say(`Lever pulled (${state.levers}/3)`);
            if (state.levers === 3) objectiveDone('Somewhere, the bolts draw back');
          },
        });
        pack++;
        add(r, fodder[k % 2], 3 + Math.floor(rng() * 2), {}, [p]);
      }
    } else if (obj === 'shards') {
      // Four shards of a broken sigil, floating over the bones of those who carried them.
      const shardMat = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: new THREE.Color(3.2, 0.25, 0.1), roughness: 0.2, flatShading: true });
      for (let k = 0; k < 4; k++) {
        const r = takeRoom(obj);
        const p = spotIn(r, 1.6, [roomCentre(r)], 1.8);
        props.addBuilder(gaol ? skeleton(rng, 'lying') : bones(rng), xf(p.x, 0, p.z, rng() * 6));
        runeCircle(p.x, p.z, 0.9, new THREE.Color(0.25, 0.02, 0.01));
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0).scale(0.55, 1.6, 0.4), shardMat);
        shard.position.set(p.x, 1.1, p.z);
        shard.castShadow = true;
        scene.add(shard);
        shards.push(shard);
        let taken = false;
        interactables.push({
          pos: p,
          radius: 1.5,
          label: 'Sigil Shard',
          active: () => !taken,
          use: () => {
            if (taken) return;
            taken = true;
            state.shards++;
            scene.remove(shard);
            const c = ctxRef.current;
            c?.effects.sparks(shard.position.clone(), 24, new THREE.Color(2.4, 0.3, 0.1), 2, 0.8);
            audio.runeLit(shard.position);
            c?.say(`Sigil shard (${state.shards}/4)`);
            if (state.shards === 4) objectiveDone('The sigil is whole');
          },
        });
        pack++;
        add(r, fodder[k % 2], 3, {}, [p]);
      }
    } else if (obj === 'marked') {
      // Three champions branded with the seal's mark; it breaks as they die.
      const kinds: MonsterKind[] = gaol ? ['butcher', 'weeper', 'maiden', 'bonePriest', 'chainWraith'] : ['horror', 'wraith', 'cultist', 'spider'];
      const names = ['Brother Vael', 'Sister Morrow', 'Old Grisk', 'Mother Hesk', 'The Pale Deacon', 'Corvin Ashmouth'].sort(() => rng() - 0.5);
      kinds.sort(() => rng() - 0.5);
      for (let k = 0; k < 3; k++) {
        const r = takeRoom(obj);
        const p = roomCentre(r);
        pack++;
        spawns.push({ kind: kinds[k], pos: p.clone(), level: levelOf(r) + 1, pack, elite: `${names[k]}, the Marked`, tag: 'marked', wander: 1.5 });
        add(r, fodder[k % 2], 2, {}, [p]);
        runeCircle(p.x, p.z, 1.8, new THREE.Color(0.3, 0.02, 0.01));
      }
    }
  }

  // Ordinary packs in the remaining rooms.
  const gaolPack = (r: Room) => {
    const deep = variant === 'gaol2';
    const roll = rng();
    const n = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
    if (roll < 0.16) add(r, 'gaunt', n(4, 6));
    else if (roll < 0.3) {
      add(r, 'butcher', deep ? 2 : 1);
      add(r, 'gaunt', 2);
    } else if (roll < 0.43) {
      add(r, 'chainWraith', 2);
      add(r, deep ? 'weeper' : 'gaunt', deep ? 1 : 2);
    } else if (roll < 0.55) {
      add(r, 'bonePriest', 1);
      add(r, 'hanged', n(2, 3));
    } else if (roll < 0.66) add(r, 'leech', n(3, 5));
    else if (roll < 0.76) add(r, 'gaolCroc', deep ? 2 : 1);
    else if (roll < 0.88) {
      add(r, 'weeper', 1);
      add(r, 'hanged', 2);
    } else {
      add(r, 'maiden', 1);
      add(r, deep ? 'bonePriest' : 'gaunt', deep ? 1 : 3);
    }
  };
  for (const r of free) {
    pack++;
    if (gaol) {
      gaolPack(r);
      continue;
    }
    const roll = rng();
    if (roll < 0.25) add(r, 'ghoul', 4 + Math.floor(rng() * 3));
    else if (roll < 0.45) {
      add(r, 'horror', 1);
      add(r, 'ghoul', 2);
    } else if (roll < 0.62) {
      add(r, 'wraith', 2);
      add(r, 'ghoul', 2);
    } else if (roll < 0.8) {
      add(r, 'spider', 1);
      add(r, 'crawler', 3 + Math.floor(rng() * 2));
    } else {
      add(r, 'cultist', 2);
      add(r, 'ghoul', 3);
    }
  }
  // The vault: the boss alone, asleep behind the seal (it brings its own help).
  pack++;
  if (descent) {
    // The gaol's upper vault: the gaolmaster and his pets keep the stair.
    const g = U(doorA + Math.PI * 0.5, 4.8);
    spawns.push({ kind: 'butcher', pos: g, level: 7, pack, elite: 'Gaolmaster Vorn', tag: 'guard', wander: 2 });
    for (let k = 0; k < 2; k++) spawns.push({ kind: 'chainWraith', pos: U(doorA + Math.PI * (0.25 + k), 5.4), level: 6, pack, wander: 2 });
    for (let k = 0; k < 3; k++) spawns.push({ kind: 'gaunt', pos: U(doorA - Math.PI * 0.5 + (k - 1) * 0.35, 5), level: 6, pack, wander: 2.5 });
  } else spawns.push({ kind: bossKind, pos: vc.clone(), level: gaol ? 9 : 7, pack, boss: true, elite: bossName, tag: 'boss', dormant: true, wander: 0 });

  // ---- Script ------------------------------------------------------------
  const ctxRef: { current: ScriptContext | null } = { current: null };
  // Up the entrance stair: back to the fields, the mire, or the gaol's upper level.
  const upTo: Exit = variant === 'gaol1' ? { pos: exitPos, radius: 1.3, to: 'swamp', entry: 'gaol', label: 'Climb to the Mire' } : variant === 'gaol2' ? { pos: exitPos, radius: 1.3, to: 'gaol1', entry: 'down', label: 'Climb to the Upper Cells' } : { pos: exitPos, radius: 1.3, to: 'zone', entry: 'crypt', label: 'Climb to the Fields' };
  const exits: Exit[] = [upTo];
  if (descent) exits.push({ pos: stairTop.clone(), radius: 1.0, to: 'gaol2', entry: 'start', label: 'Descend Deeper' });
  const homeExit = (pos: THREE.Vector3): Exit => (variant === 'gaol2' ? { pos, radius: 1.2, to: 'road', entry: 'gaol', label: 'Step through to the Pilgrim Road' } : gaol ? { pos, radius: 1.2, to: 'swamp', entry: 'gaol', label: 'Climb to the Mire' } : { pos, radius: 1.2, to: 'zone', entry: 'crypt', label: 'Climb to the Fields' });
  const done = (o: Objective) =>
    o === 'runes' ? state.runes >= 3 : o === 'hearts' ? state.hearts >= 3 : o === 'warden' ? state.warden : o === 'key' ? state.key : o === 'brood' ? state.brood : o === 'braziers' ? state.braziers >= 4 : o === 'levers' ? state.levers >= 3 : o === 'shards' ? state.shards >= 4 : state.marked >= 3;
  function objectiveDone(say: string) {
    audio.objective();
    const left = chosen.filter((o) => !done(o)).length;
    ctxRef.current?.banner(say, left ? `${left} seal${left > 1 ? 's' : ''} remain${left > 1 ? '' : 's'} on the vault` : 'The seal on the vault cracks');
    if (!left) breakSeal();
  }
  function breakSeal() {
    if (state.sealBroken) return;
    state.sealBroken = true;
    state.doorT = 0;
    audio.doorOpen(doorPos);
    ctxRef.current?.effects.addShake(0.5);
    setTimeout(() => ctxRef.current?.banner('The Seal Breaks', theme.wakes), 3600);
  }
  const portal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.1, 7, 24, 1, true).translate(0, 3.5, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  const portalPos = back.clone().addScaledVector(new THREE.Vector3(dir[0], 0, dir[1]), 2.2);
  portal.position.copy(portalPos);
  portal.visible = false;
  let portalT = 0;
  scene.add(portal);

  const text: Record<Objective, () => string> = {
    runes: () => `Kindle the rune circles (${Math.min(3, state.runes)}/3)`,
    hearts: () => `Burst the Blood Hearts (${Math.min(3, state.hearts)}/3)`,
    warden: () => 'Slay The Gaoler',
    key: () => 'Recover the Bone Key',
    brood: () => (gaol ? 'Destroy The Bloated Mother' : 'Destroy The Brood Mother'),
    braziers: () => `Light the cold braziers (${Math.min(4, state.braziers)}/4)`,
    levers: () => `Pull the rusted levers (${Math.min(3, state.levers)}/3)`,
    shards: () => `Gather the sigil shards (${Math.min(4, state.shards)}/4)`,
    marked: () => `Slay the Marked (${Math.min(3, state.marked)}/3)`,
  };
  const script: AreaScript = {
    title: gaol ? GAOL_NAMES[Math.floor(rng() * GAOL_NAMES.length)] : NAMES[Math.floor(rng() * NAMES.length)],
    interactables,
    finished: false,
    objectives: () =>
      descent
        ? [
            { text: 'Find the stair down', done: false },
            { text: 'Slay Gaolmaster Vorn (optional)', done: state.guard },
          ]
        : [
      ...chosen.map((o) => ({ text: text[o](), done: done(o) })),
      ...(state.sealBroken ? [{ text: `Destroy ${bossName}`, done: state.bossDead }] : [{ text: 'Break the seal on the vault', done: false }]),
    ],
    update(dt, ctx) {
      ctxRef.current = ctx;
      // Standing in an unlit circle kindles it.
      for (const r of runes) {
        if (r.lit) continue;
        const inside = ctx.player.alive && Math.hypot(ctx.player.position.x - r.pos.x, ctx.player.position.z - r.pos.z) < 1.3;
        r.charge = Math.max(0, Math.min(1, r.charge + (inside ? dt / 1.4 : -dt)));
        if (inside) audio.runeHum(r.pos, r.charge);
        if (r.charge >= 1) {
          r.lit = true;
          state.runes++;
          audio.runeLit(r.pos);
          ctx.effects.pillar(r.pos.clone(), new THREE.Color(2.2, 0.25, 0.1));
          ctx.say(`Rune circle kindled (${state.runes}/3)`);
          pool.add(r.pos.clone().setY(1.2), 6, 6, 0.4);
          if (state.runes === 3) objectiveDone('The circles burn as one');
        }
      }
      // Once the portcullis is down, the vault's dead come for the hero.
      if (state.doorT >= 3 && state.doorT < 99) {
        state.doorT = 99;
        nav.unblockRect(doorPos.x, doorPos.z, dir[1] !== 0 ? 1.95 : 0.45, dir[1] !== 0 ? 0.45 : 1.95);
        for (const m of ctx.monsters) if (m.spawn.tag === 'boss') m.rouse();
      }
    },
    onKill(m: Monster, ctx: ScriptContext) {
      ctxRef.current = ctx;
      if (m.spawn.tag === 'warden' && !state.warden) {
        state.warden = true;
        objectiveDone('The Gaoler falls');
      } else if (m.spawn.tag === 'brood' && !state.brood) {
        state.brood = true;
        objectiveDone('The brood is broken');
      } else if (m.spawn.tag === 'marked') {
        state.marked++;
        ctx.say(`The mark breaks (${state.marked}/3)`);
        if (state.marked === 3) objectiveDone('The Marked are dead');
      } else if (m.spawn.tag === 'guard' && !state.guard) {
        state.guard = true;
        audio.objective();
        ctx.banner('Gaolmaster Vorn Falls', 'The stair to the lower cells lies open');
      } else if (m.spawn.tag === 'boss' && m.spawn.boss && !state.bossDead) {
        state.bossDead = true;
        script.finished = true;
        audio.objective();
        ctx.banner(`${bossName} Is Destroyed`, 'Light falls into the vault: the way up is open');
        exits.push(homeExit(portalPos.clone()));
        portal.visible = true;
        pool.add(portalPos.clone().setY(2), 14, 10, 0);
        ctx.effects.pillar(portalPos.clone(), new THREE.Color(2.0, 1.4, 0.7));
      }
    },
  };

  scene.add(props.build(mats));

  const world: World & { debug?: unknown } = {
    scene,
    moon,
    ground,
    heightAt: () => 0,
    nav,
    spawn: entryPos,
    spawnYaw: entryYaw,
    title: script.title,
    subtitle: descent
      ? 'Somewhere below, a stair leads deeper'
      : gaol
        ? "Two seals bar the Inquisitor's court. Break them, and face his judgement."
        : 'Three seals bind the vault. Break them, and face what waits within.',
    exits,
    entries: {
      start: { pos: entryPos, yaw: entryYaw },
      // Coming back up from the lower cells: beside the head of the stair.
      ...(descent ? { down: { pos: stairTop.clone().add(new THREE.Vector3(dir[0], 0, dir[1]).multiplyScalar(2.4)), yaw: Math.atan2(dir[0], dir[1]) } } : {}),
    },
    monsterSpawns: spawns,
    cameraYaw: THREE.MathUtils.degToRad(45),
    extent: HALF,
    indoor: true,
    fogScale: 1.35,
    layoutKey: `${variant}:${seed}`,
    script,
    update(dt, t) {
      Fire.tick(t);
      pool.update(t);
      waterTime.value = t;
      // Unlit circles smoulder; charging ones brighten; lit ones burn and pulse.
      for (const r of runes) {
        const k = r.lit ? 1.6 + Math.sin(t * 3 + r.pos.x) * 0.35 : 0.18 + r.charge * 1.2 + Math.sin(t * 2 + r.pos.z) * 0.04;
        r.mat.color.setRGB(k, k * 0.1, k * 0.05);
      }
      const rk = state.sealBroken && !state.bossDead ? 1.3 + Math.sin(t * 4) * 0.4 : 0.45 + Math.sin(t * 1.3) * 0.12;
      ritual.mat.color.copy(theme.rune).multiplyScalar(rk * 1.6);
      ritualOuter.mat.color.copy(theme.rune).multiplyScalar(rk * 0.7);
      ritualInner.mat.color.copy(theme.rune).multiplyScalar(rk * (1.4 + Math.sin(t * 2.2) * 0.4));
      ritualOuter.mesh.rotation.y = t * 0.03;
      ritualInner.mesh.rotation.y = -t * 0.15;
      vaultPool.update(t);
      mists.forEach((m, i) => {
        m.rotation.y += dt * 0.04 * (i % 2 ? 1 : -1);
        (m.material as THREE.MeshBasicMaterial).opacity = 1;
      });
      if (themed.shaft) (themed.shaft.material as THREE.MeshBasicMaterial).opacity = 0.85 + Math.sin(t * 0.7) * 0.15;
      for (const h of pulsing) {
        const b = 1 + Math.max(0, Math.sin(t * 5.5)) ** 6 * 0.12 + Math.max(0, Math.sin(t * 5.5 - 0.6)) ** 8 * 0.06;
        h.scale.setScalar(b);
      }
      for (const l of levers) {
        if (l.t < 0 || l.t >= 1) continue;
        l.t = Math.min(1, l.t + dt * 2.2);
        l.arm.rotation.x = -0.75 + 1.5 * (1 - (1 - l.t) ** 3);
      }
      shards.forEach((sh, i) => {
        sh.rotation.y = t * 1.3 + i;
        sh.position.y = 1.1 + Math.sin(t * 2 + i) * 0.07;
      });
      if (keyMesh) {
        keyMesh.rotation.y = t * 0.8;
        keyMesh.position.y = 1.15 + Math.sin(t * 2) * 0.05;
      }
      // Seal flares and dies, then the portcullis sinks.
      if (state.doorT >= 0 && state.doorT < 99) {
        state.doorT += dt;
        const k = state.doorT;
        sealMat.opacity = Math.max(0, 1 - k / 0.8);
        sealMat.color.setRGB(2.4 + 4 * Math.max(0, 0.4 - k), 0.12 + Math.max(0, 0.4 - k), 0.05);
        door.position.y = -(Math.min(1, Math.max(0, (k - 0.6) / 2.3)) ** 1.3) * (WALL_H + 0.1);
      }
      if (portal.visible) {
        portalT += dt;
        const m = portal.material as THREE.MeshBasicMaterial;
        m.opacity = Math.min(0.5, portalT * 0.3) * (0.85 + Math.sin(t * 3) * 0.15);
        portal.rotation.y = t * 0.4;
      }
    },
  };
  // Positions of interest for automated screenshots and play tests.
  world.debug = {
    rooms: rooms.map((r) => ({ role: r.role ?? (r.boss ? 'boss' : ''), c: roomCentre(r), depth: r.depth })),
    door: doorPos,
    runes: runes.map((r) => r.pos),
    runeState: runes,
    interactables: interactables.map((i) => ({ label: i.label, pos: i.pos })),
    state,
  };
  return world;
}
