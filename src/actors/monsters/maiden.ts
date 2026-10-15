import * as THREE from 'three';
import { joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { boxProjectUVs } from '../../procgen/geometry';
import { range, type Rng } from '../../procgen/noise';
import { sculptSphere } from '../sculpt';
import { BasicRig, ease, hump } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Iron maiden: a walking torture coffin. A woman-shaped sarcophagus of black,
// rust-streaked iron, a stern face under a cast veil and a crown of spikes on
// top, riveted bands round its body and spines down its sides. The front is
// two hinged doors studded inside with long bloody spikes; behind them, in a
// red-lit hollow, hangs what is left of its last prisoner. It waddles on four
// stubby claw feet like a bathtub come alive, its doors creaking open as it
// breathes, and bites by lurching in and slamming them shut.

const BASE = 0.2; // underside of the hem, over the feet
const SHOULDER = 1.5; // top of the doors
const NECK = 1.69;
/** Angle from the front where the doors meet the back shell. */
const HINGE = 1.3;
/** Shell wall: the inner surface sits at this fraction of the outer. */
const INNER = 0.88;
const SEAM = 0.006;

// Body profile knots: [y, half width, half depth].
const KNOTS: [number, number, number][] = [
  [BASE, 0.275, 0.235],
  [0.5, 0.29, 0.245],
  [0.9, 0.33, 0.26],
  [1.2, 0.38, 0.272],
  [1.42, 0.415, 0.28],
  [1.52, 0.405, 0.272],
  [1.59, 0.36, 0.25],
  [1.645, 0.25, 0.19],
  [NECK, 0.13, 0.12],
];
const LUT: { y: number; w: number; d: number }[] = (() => {
  const curve = new THREE.CatmullRomCurve3(KNOTS.map(([y, w, d]) => new THREE.Vector3(w, y, d)), false, 'centripetal');
  return curve.getPoints(240).map((p) => ({ y: p.y, w: p.x, d: p.z }));
})();
function prof(y: number) {
  if (y <= LUT[0].y) return LUT[0];
  for (let i = 1; i < LUT.length; i++) {
    const b = LUT[i];
    if (b.y >= y) {
      const a = LUT[i - 1];
      const t = (y - a.y) / Math.max(1e-6, b.y - a.y);
      return { y, w: a.w + (b.w - a.w) * t, d: a.d + (b.d - a.d) * t };
    }
  }
  return LUT[LUT.length - 1];
}

/** Point on the shell: theta 0 is the front (+Z), toward +X positive; k scales outward. A slightly squared ellipse. */
function S(theta: number, y: number, k: number) {
  const p = prof(y);
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const e = 0.82;
  return new THREE.Vector3(k * p.w * Math.sign(s) * Math.abs(s) ** e, y, k * p.d * Math.sign(c) * Math.abs(c) ** e);
}
/** Outward direction of the shell at (theta, y). */
function N(theta: number, y: number) {
  const p = prof(y);
  return new THREE.Vector3(Math.sin(theta) / p.w, 0, Math.cos(theta) / p.d).normalize();
}

/** A grid of the shell surface over a theta and y range at scale k. */
function grid(t0: number, t1: number, y0: number, y1: number, nt: number, ny: number, k: number | ((t: number, y: number) => number), flip = false) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= ny; j++) {
    const y = y0 + ((y1 - y0) * j) / ny;
    for (let i = 0; i <= nt; i++) {
      const t = t0 + ((t1 - t0) * i) / nt;
      const p = S(t, y, typeof k === 'number' ? k : k(t, y));
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nt; i++) {
      const a = j * (nt + 1) + i;
      const b = a + 1;
      const c = a + nt + 1;
      const d = c + 1;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return boxProjectUVs(g, 4);
}

/** A thin wall joining two shell scales along a path of (theta, y), double-sided. */
function wall(path: [number, number][], k0: number, k1: number | ((t: number, y: number) => number)) {
  const K = typeof k1 === 'number' ? () => k1 : k1;
  const pos: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [ta, ya] = path[i];
    const [tb, yb] = path[i + 1];
    const a0 = S(ta, ya, k0);
    const a1 = S(ta, ya, K(ta, ya));
    const b0 = S(tb, yb, k0);
    const b1 = S(tb, yb, K(tb, yb));
    for (const [p, q, r] of [
      [a0, b0, a1],
      [b0, b1, a1],
      [a0, a1, b0],
      [b0, a1, b1],
    ]) pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return boxProjectUVs(g, 4);
}
const win = (y: number, a: number, b: number) => Math.min(1, Math.max(0, (y - a) / (b - a))) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (y - a) / (b - a))));
/** Outer skin: a cast robe falling in folds from the waist band to the hem band. */
const robe = (t: number, y: number) => 1 + 0.034 * (0.5 + 0.5 * Math.cos(t * 11)) ** 2 * win(y, 0.4, 0.52) * (1 - win(y, 0.96, 1.05)) * (0.6 + 0.4 * win(y, 1, 0.45));
const vPath = (t: number, y0: number, y1: number, n = 12): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [t, y0 + ((y1 - y0) * i) / n]);
const hPath = (t0: number, t1: number, y: number, n = 12): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [t0 + ((t1 - t0) * i) / n, y]);

/** A raised slab on the shell (band, strap, flange): face plus its four edges. */
function slab(t0: number, t1: number, y0: number, y1: number, k0: number, k1: number, nt = 12, ny = 2): THREE.BufferGeometry[] {
  return [grid(t0, t1, y0, y1, nt, ny, k1), wall(hPath(t0, t1, y0, nt), k0, k1), wall(hPath(t0, t1, y1, nt), k0, k1), wall(vPath(t0, y0, y1, ny), k0, k1), wall(vPath(t1, y0, y1, ny), k0, k1)];
}

const UP = new THREE.Vector3(0, 1, 0);
/** A cone spike with its base at p pointing along dir; the outer part of it bloodied when `tip` is given. */
function spike(p: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, mat: THREE.Material, parent: THREE.Object3D, tip?: THREE.Material) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  const split = tip ? 0.45 : 1;
  const g = (tip ? new THREE.CylinderGeometry(r * (1 - split) + 0.002, r, len * split, 6) : new THREE.ConeGeometry(r, len, 6)).translate(0, (len * split) / 2, 0);
  g.applyQuaternion(q).translate(p.x, p.y, p.z);
  mesh(g, mat, parent);
  if (tip) {
    const t = new THREE.ConeGeometry(r * (1 - split) + 0.002, len * (1 - split), 6).translate(0, len * split + (len * (1 - split)) / 2, 0);
    t.applyQuaternion(q).translate(p.x, p.y, p.z);
    mesh(t, tip, parent);
  }
}

/** A tube along points with a taper toward the end (claws, drips, bones). */
function taperTube(pts: THREE.Vector3[], r0: number, r1: number, seg = 10, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  // Tube vertices are laid out ring by ring; rescale each ring about its centre.
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const c = curve.getPointAt(u);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const v = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** The front of a sphere, finely divided, pushed out by `disp` (unit coords) for a sculpted face. */
function facePatch(radius: number, disp: (x: number, y: number, z: number) => number, scale: THREE.Vector3) {
  const g = new THREE.SphereGeometry(1, 44, 40, Math.PI / 2 - 1.25, 2.5, 0.3, 2.45);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = radius * (1 + disp(x, y, z));
    pos.setXYZ(i, x * k * scale.x, y * k * scale.y, z * k * scale.z);
  }
  g.computeVertexNormals();
  return boxProjectUVs(g, 6);
}

let hazeTex: THREE.Texture | null = null;
function haze() {
  if (hazeTex) return hazeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  hazeTex = new THREE.CanvasTexture(c);
  return hazeTex;
}

class Maiden extends BasicRig {
  readonly trunk: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly doors: THREE.Object3D[] = [];
  readonly feet: { j: THREE.Object3D; side: number; front: number }[] = [];
  readonly chains: THREE.Object3D[] = [];
  readonly inmate: THREE.Object3D;
  readonly inmateHead: THREE.Object3D;
  readonly glowInside: THREE.MeshStandardMaterial;
  readonly seamGlow: THREE.MeshBasicMaterial;
  readonly hazeMat: THREE.MeshBasicMaterial;
  readonly eyes: THREE.MeshBasicMaterial;
  private seed: number;
  /** Doors' resting gap from the idle creak, read by the actions. */
  ajar = 0;
  /** 0..1 how strongly the inside glows (dimmed on death). */
  life = 1;

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, 8.5, 2.2);
    this.seed = rng() * 10;
    const dark = (m.steel as THREE.MeshStandardMaterial).clone();
    dark.color = new THREE.Color(0.27, 0.24, 0.22);
    dark.metalness = 0.7;
    const rust = (m.iron as THREE.MeshStandardMaterial).clone();
    rust.color = new THREE.Color(0.5, 0.25, 0.13);
    const iron = m.iron;
    const veilMat = dark.clone();
    veilMat.side = THREE.DoubleSide;
    const blood = m.wound;
    this.glowInside = new THREE.MeshStandardMaterial({ color: 0x1c0605, roughness: 0.35, metalness: 0.3, emissive: new THREE.Color(0.55, 0.03, 0.01), emissiveIntensity: 0.6 });
    this.seamGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.35, 0.1), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.hazeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.15, 0.05), map: haze(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.eyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.35, 0.15), fog: false });

    this.trunk = joint(this.body, 0, 0, 0);
    const T = this.trunk;
    const bandYs = [0.34, 1.1];
    const B = Math.PI * 2 - HINGE;

    // --- Back shell: outer iron, inner red-lit hollow, hinge edges.
    mesh(grid(HINGE, B, BASE, SHOULDER, 40, 30, robe), dark, T);
    mesh(grid(HINGE, B, BASE, SHOULDER, 30, 24, INNER, true), this.glowInside, T);
    for (const t of [HINGE, B]) mesh(wall(vPath(t, BASE, SHOULDER, 30), INNER, robe), dark, T);
    for (const y of bandYs) {
      for (const g of slab(HINGE + 0.02, B - 0.02, y - 0.03, y + 0.03, 0.99, 1.035, 30)) mesh(g, iron, T);
      for (let t = HINGE + 0.12; t < B - 0.05; t += 0.36) mesh(new THREE.SphereGeometry(0.014, 6, 4), iron, T).position.copy(S(t, y, 1.04));
    }
    // Spine flange down the back.
    for (const g of slab(Math.PI - 0.05, Math.PI + 0.05, BASE + 0.04, SHOULDER, 0.99, 1.04, 2, 12)) mesh(g, rust, T);
    // Hinge knuckles.
    for (const s of [1, -1]) {
      for (const y of [0.5, 0.95, 1.3]) {
        const p = S(s * HINGE, y, 1.03);
        mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.12, 8), iron, T, p.x, p.y, p.z);
      }
    }
    // Spines down both flanks, just behind the hinges, and over the shoulders.
    for (const s of [1, -1]) {
      for (let y = 0.32; y < 1.45; y += 0.16) {
        const t = s * (HINGE + 0.2);
        spike(S(t, y, 0.99), N(t, y).add(new THREE.Vector3(0, 0.25, 0)), range(rng, 0.13, 0.18), 0.03, rust, T);
      }
      for (let i = 0; i < 6; i++) {
        const t = s * (0.75 + i * 0.32);
        const y = 1.55;
        spike(S(t, y, 0.98), N(t, y).multiplyScalar(0.6).add(new THREE.Vector3(0, 1, 0)), range(rng, 0.13, 0.19), 0.024, rust, T);
      }
    }
    // A few spikes inside the back, mostly hidden by the prisoner.
    for (let y = 0.45; y < 1.4; y += 0.2) {
      for (const t of [Math.PI - 0.55, Math.PI + 0.55]) spike(S(t, y, INNER), N(t, y).negate(), 0.13, 0.016, iron, T, blood);
    }

    // --- Shoulder cap up to the neck, and the hem.
    mesh(grid(0, Math.PI * 2, SHOULDER, NECK, 48, 10, 1), dark, T);
    for (const g of slab(0, Math.PI * 2, SHOULDER - 0.005, SHOULDER + 0.045, 0.99, 1.04, 48)) mesh(g, iron, T);
    for (let t = 0.1; t < Math.PI * 2; t += 0.4) mesh(new THREE.SphereGeometry(0.014, 6, 4), iron, T).position.copy(S(t, SHOULDER + 0.02, 1.045));
    const p0 = prof(BASE);
    mesh(new THREE.CylinderGeometry(1, 1.05, 0.09, 32).scale(p0.w * 1.04, 1, p0.d * 1.04), rust, T, 0, BASE - 0.02, 0);
    mesh(new THREE.CylinderGeometry(1, 1, 0.03, 32).scale(p0.w * 0.98, 1, p0.d * 0.98), iron, T, 0, BASE + 0.03, 0);
    // Blood pooled on the floor of the hollow.
    mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2).scale(p0.w * 0.8, 1, p0.d * 0.8), blood, T, 0, BASE + 0.05, 0);
    // Red light: a slit of glow behind the door seam and a haze deep inside.
    mesh(new THREE.PlaneGeometry(0.03, SHOULDER - BASE - 0.12), this.seamGlow, T, 0, (SHOULDER + BASE) / 2, prof(0.9).d * INNER - 0.03);
    mesh(new THREE.PlaneGeometry(0.75, 1.45), this.hazeMat, T, 0, 0.9, -0.13);

    // --- The doors: curved shells on hinges, spiked inside.
    for (const s of [1, -1]) {
      const hp = S(s * HINGE, 0.95, 1);
      const door = joint(T, hp.x, 0, hp.z);
      this.doors.push(door);
      const [t0, t1] = s > 0 ? [SEAM, HINGE] : [-HINGE, -SEAM];
      const off = (g: THREE.BufferGeometry) => g.translate(-hp.x, 0, -hp.z);
      const add = (g: THREE.BufferGeometry, mat: THREE.Material) => mesh(off(g), mat, door);
      add(grid(t0, t1, BASE, SHOULDER - 0.005, 22, 30, robe), dark);
      add(grid(t0, t1, BASE, SHOULDER - 0.005, 14, 24, INNER, true), this.glowInside);
      add(wall(vPath(t0, BASE, SHOULDER - 0.005, 30), INNER, robe), dark);
      add(wall(vPath(t1, BASE, SHOULDER - 0.005, 30), INNER, robe), dark);
      add(wall(hPath(t0, t1, BASE), INNER, 1), dark);
      add(wall(hPath(t0, t1, SHOULDER - 0.005), INNER, 1), dark);
      // Riveted bands, the front flange and strap hinges.
      for (const y of bandYs) {
        for (const g of slab(t0 + 0.06, t1 - 0.02, y - 0.03, y + 0.03, 0.99, 1.035)) add(g, iron);
        for (let t = 0.2; t < HINGE - 0.05; t += 0.38) add(new THREE.SphereGeometry(0.014, 6, 4).translate(...S(s * t, y, 1.04).toArray()), iron);
      }
      for (const g of slab(s > 0 ? SEAM : -0.085, s > 0 ? 0.085 : -SEAM, BASE + 0.01, SHOULDER - 0.01, 0.99, 1.05, 2, 16)) add(g, rust);
      for (let y = 0.28; y < SHOULDER; y += 0.2) add(new THREE.SphereGeometry(0.013, 6, 4).translate(...S(s * 0.045, y, 1.06).toArray()), iron);
      for (const y of [0.5, 0.95, 1.3]) {
        const ta = s > 0 ? HINGE - 0.62 : -HINGE;
        const tb = s > 0 ? HINGE : -HINGE + 0.62;
        for (const g of slab(ta, tb, y - 0.04, y + 0.04, 1.03, 1.07, 8)) add(g, rust);
        // Spade-shaped strap end.
        const e = S(s * (HINGE - 0.66), y, 1.06);
        const n = N(s * (HINGE - 0.66), y);
        add(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 4).rotateX(Math.PI / 2).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)).translate(e.x, e.y, e.z), rust);
        for (const t of [HINGE - 0.15, HINGE - 0.45]) add(new THREE.SphereGeometry(0.015, 6, 4).translate(...S(s * t, y, 1.075).toArray()), iron);
      }
      // Long spikes in rows on the inside, bloodied toward the tips.
      let row = 0;
      for (let y = 0.34; y < SHOULDER - 0.06; y += 0.125, row++) {
        for (const tt of row % 2 ? [0.32, 0.72, 1.08] : [0.14, 0.52, 0.92]) {
          const t = s * tt;
          const p = S(t, y, INNER);
          const dir = new THREE.Vector3(-p.x * 0.75, 0.02, -p.z).normalize();
          add(new THREE.SphereGeometry(0.018, 6, 4).translate(p.x, p.y, p.z), iron);
          const g = new THREE.Group();
          spike(p, dir, range(rng, 0.16, 0.22), 0.017, iron, g, blood);
          for (const c of [...g.children] as THREE.Mesh[]) add(c.geometry, c.material as THREE.Material);
        }
      }
      // Blood seeping from under the doors and down the seam.
      for (let i = 0; i < 3; i++) {
        const t = s * range(rng, 0.03, 0.5);
        const len = range(rng, 0.12, 0.4);
        const top = BASE + len + range(rng, 0, 0.3);
        const a = S(t, top, 1.012);
        const b = S(t, top - len, 1.012);
        add(taperTube([a, a.clone().lerp(b, 0.5), b], 0.006, 0.011, 6, 5), blood);
        add(new THREE.SphereGeometry(0.013, 6, 4).translate(b.x, b.y, b.z), blood);
      }
      if (s > 0) {
        // Ring handle and hasp at the chest.
        const p = S(0.13, 1.0, 1.05);
        add(new THREE.BoxGeometry(0.06, 0.09, 0.02).translate(p.x, p.y, p.z), rust);
        add(new THREE.TorusGeometry(0.05, 0.009, 6, 16).translate(p.x, p.y - 0.06, p.z + 0.02), iron);
      } else {
        const p = S(-0.1, 1.0, 1.05);
        add(new THREE.BoxGeometry(0.11, 0.04, 0.025).translate(p.x + 0.03, p.y, p.z), rust);
      }
    }

    // --- Head: a stern woman's face cast in rust under a veil and spiked crown.
    this.head = joint(T, 0, NECK - 0.04, 0.01);
    const H = this.head;
    mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.12, 14), dark, H, 0, 0.03, 0);
    const face = (x: number, y: number, z: number) => {
      const f = win(z, 0.35, 0.85);
      const ax = Math.abs(x);
      let d = 0;
      d -= 0.09 * f * Math.exp(-((y - 0.05) ** 2) / 0.3); // flatter face plane
      d += 0.17 * f * Math.exp(-(x * x) / 0.006 - ((y + 0.0) ** 2) / 0.03) * (y < 0.2 ? 1 : 0.4); // nose bridge
      d += 0.08 * f * Math.exp(-(x * x) / 0.012 - ((y + 0.15) ** 2) / 0.003); // nose tip
      const browY = 0.25 - 0.1 * Math.max(0, 0.4 - ax);
      d += 0.11 * f * Math.exp(-((y - browY) ** 2) / 0.003 - (x * x) / 0.22); // stern, knitted brow
      d -= 0.2 * f * Math.exp(-((ax - 0.31) ** 2) / 0.013 - ((y - 0.12) ** 2) / 0.006); // eye sockets
      d += 0.07 * f * Math.exp(-((ax - 0.45) ** 2) / 0.02 - ((y + 0.06) ** 2) / 0.008); // cheekbones
      d -= 0.07 * f * Math.exp(-((ax - 0.38) ** 2) / 0.02 - ((y + 0.27) ** 2) / 0.012); // hollow cheeks
      d += 0.07 * f * Math.exp(-(x * x) / 0.022 - ((y + 0.33 + 0.25 * x * x) ** 2) / 0.0016) * (1 - 0.4 * Math.exp(-(x * x) / 0.002)); // upper lip, bowed
      d += 0.075 * f * Math.exp(-(x * x) / 0.018 - ((y + 0.43) ** 2) / 0.0022); // full lower lip
      d -= 0.06 * f * Math.exp(-(x * x) / 0.04 - ((y + 0.38 + 0.6 * x * x) ** 2) / 0.0004); // mouth line, corners turned down
      d += 0.08 * f * Math.exp(-(x * x) / 0.02 - ((y + 0.6) ** 2) / 0.01); // chin
      d -= 0.16 * Math.max(0, -y - 0.1) ** 2 * (1 + ax); // narrow jaw
      return d;
    };
    H.scale.setScalar(1.1);
    const faceMat = rust.clone();
    faceMat.color = new THREE.Color(0.44, 0.25, 0.16);
    faceMat.metalness = 0.45;
    mesh(new THREE.SphereGeometry(0.175, 20, 14).scale(0.8, 1.08, 0.8), rust, H, 0, 0.22, 0.0);
    mesh(facePatch(0.19, face, new THREE.Vector3(0.8, 1.12, 0.92)), faceMat, H, 0, 0.22, 0.02);
    for (const s of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.019, 8, 6).scale(1.3, 0.75, 0.6), m.void, H, s * 0.05, 0.245, 0.152);
      mesh(new THREE.SphereGeometry(0.0065, 6, 4), this.eyes, H, s * 0.05, 0.245, 0.166);
      // Tears of blood down the cheeks.
      const onFace = (ux: number, uy: number) => {
        const v = new THREE.Vector3(ux, uy, Math.sqrt(1 - ux * ux - uy * uy));
        const k = 0.19 * (1 + face(v.x, v.y, v.z)) + 0.003;
        return new THREE.Vector3(v.x * k * 0.8, v.y * k * 1.12 + 0.22, v.z * k * 0.92 + 0.02);
      };
      const tear = [0.06, -0.05, -0.18, -0.32, -0.42].map((uy, i) => onFace(s * (0.3 + i * 0.012), uy));
      mesh(taperTube(tear, 0.0045, 0.003, 14, 5), blood, H);
      mesh(new THREE.SphereGeometry(0.005, 6, 4), blood, H).position.copy(tear[4]);
    }
    // Veil: a cast hood open at the face, flowing onto the shoulders.
    const veilPts = [
      [0.34, -0.2],
      [0.28, -0.13],
      [0.22, -0.03],
      [0.185, 0.05],
      [0.175, 0.12],
      [0.18, 0.24],
      [0.17, 0.34],
      [0.13, 0.43],
      [0.06, 0.48],
      [0.001, 0.49],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const veil = new THREE.LatheGeometry(new THREE.SplineCurve(veilPts).getPoints(30), 32, 0.95, Math.PI * 2 - 1.9).scale(1, 1, 0.85);
    mesh(boxProjectUVs(veil, 4), veilMat, H);
    // Veil front hem as a rolled edge, and a brow band.
    for (const s of [-1, 1]) {
      const pts = veilPts.slice(0, 9).map((v) => new THREE.Vector3(Math.sin(0.95) * v.x * s, v.y, Math.cos(0.95) * v.x * 0.85));
      mesh(taperTube(pts, 0.012, 0.01, 20, 6), dark, H);
    }
    // Spiked crown.
    mesh(new THREE.TorusGeometry(0.15, 0.016, 6, 28).rotateX(Math.PI / 2), rust, H, 0, 0.41, -0.005);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a) * 0.45, 1, Math.cos(a) * 0.45);
      const len = i % 2 ? 0.12 : 0.19;
      spike(new THREE.Vector3(Math.sin(a) * 0.15, 0.41, Math.cos(a) * 0.15 - 0.005), dir, len, 0.017, rust, H);
    }

    // --- Prisoner: a pale withered thing slumped in the hollow.
    this.inmate = joint(T, 0, BASE - 0.2, -0.03);
    this.inmate.scale.setScalar(1.05);
    const I = this.inmate;
    const bone = m.bone;
    const skin = m.paleSkin;
    mesh(taperTube([new THREE.Vector3(0, 0.62, -0.06), new THREE.Vector3(0, 0.85, -0.1), new THREE.Vector3(0, 1.05, -0.08), new THREE.Vector3(0, 1.17, 0.0)], 0.022, 0.018, 10, 6), bone, I);
    // Pelvis: two flared hip wings either side of the sacrum.
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.1, 0.45), bone, I, s * 0.07, 0.64, -0.05).rotation.set(0, s * 0.6, s * 0.4);
    mesh(new THREE.ConeGeometry(0.04, 0.1, 5).rotateX(Math.PI), bone, I, 0, 0.6, -0.08);
    // Shrunken belly.
    mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.2, 10).scale(1, 1, 0.7), skin, I, 0, 0.76, -0.08);
    // Withered chest with ribs standing out of it.
    mesh(new THREE.SphereGeometry(0.11, 14, 10).scale(1.05, 1.45, 0.72), skin, I, 0, 0.98, -0.08);
    for (let i = 0; i < 6; i++) {
      const y = 1.13 - i * 0.05;
      const r = 0.1 + Math.sin((i / 5) * Math.PI * 0.8) * 0.02;
      const gap = 0.35 + i * 0.12;
      mesh(new THREE.TorusGeometry(r, 0.007, 4, 14, Math.PI * 2 - gap * 2).rotateZ(Math.PI / 2 + gap).rotateX(Math.PI / 2).scale(1, 1, 0.72).rotateX(0.4), bone, I, 0, y, -0.075);
    }
    mesh(new THREE.BoxGeometry(0.025, 0.22, 0.015), bone, I, 0, 1.0, 0.025);
    for (const s of [-1, 1]) {
      // Collarbones, then arms hanging limp with long fingers.
      mesh(taperTube([new THREE.Vector3(0, 1.15, 0.0), new THREE.Vector3(s * 0.1, 1.16, -0.02), new THREE.Vector3(s * 0.17, 1.14, -0.06)], 0.009, 0.008, 5, 4), bone, I);
      const arm = [new THREE.Vector3(s * 0.18, 1.13, -0.07), new THREE.Vector3(s * 0.22, 0.95, -0.02), new THREE.Vector3(s * 0.2, 0.78, 0.07), new THREE.Vector3(s * 0.16, 0.66, 0.12)];
      mesh(taperTube(arm, 0.022, 0.014, 12, 6), skin, I);
      for (let f = 0; f < 4; f++) {
        const h = arm[3];
        mesh(taperTube([h, new THREE.Vector3(h.x + s * (f - 1.5) * 0.012, h.y - 0.06, h.z + 0.03), new THREE.Vector3(h.x + s * (f - 1.5) * 0.016, h.y - 0.11, h.z + 0.02)], 0.006, 0.003, 4, 4), bone, I);
      }
      mesh(taperTube([new THREE.Vector3(s * 0.08, 0.6, -0.05), new THREE.Vector3(s * 0.09, 0.32, -0.02), new THREE.Vector3(s * 0.08, 0.03, -0.04)], 0.024, 0.016, 8, 6), skin, I);
    }
    this.inmateHead = joint(I, 0, 1.18, 0.0);
    const IH = this.inmateHead;
    const skullD = (x: number, y: number, z: number) => -0.25 * Math.max(0, -y) * Math.max(0, z) - 0.12 * Math.exp(-((Math.abs(x) - 0.38) ** 2) / 0.02 - ((y - 0.05) ** 2) / 0.02) * Math.max(0, z);
    mesh(sculptSphere(0.085, skullD, new THREE.Vector3(0.9, 1.05, 1.05), 20, 14), bone, IH, 0, 0.08, 0.02);
    mesh(new THREE.BoxGeometry(0.09, 0.03, 0.07).translate(0, -0.015, 0.03), bone, IH, 0, 0.01, 0.04).rotation.x = 0.5;
    for (const s of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.022, 8, 6), m.void, IH, s * 0.03, 0.085, 0.09);
      mesh(new THREE.SphereGeometry(0.006, 6, 4), this.eyes, IH, s * 0.03, 0.085, 0.105);
    }
    // Lank strands of hair.
    for (let i = 0; i < 9; i++) {
      const a = range(rng, -1.6, 1.6);
      const r0 = new THREE.Vector3(Math.sin(a) * 0.07, 0.15, Math.cos(a) * 0.07 - 0.01);
      mesh(taperTube([r0, r0.clone().add(new THREE.Vector3(Math.sin(a) * 0.03, -0.1, Math.cos(a) * 0.025)), r0.clone().add(new THREE.Vector3(Math.sin(a) * 0.035, -range(rng, 0.2, 0.32), Math.cos(a) * 0.03))], 0.006, 0.002, 6, 4), m.hair, IH);
    }

    // --- Four stubby claw feet: iron balls gripped in talons.
    for (const [side, front] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      const j = joint(T, side * 0.16, BASE, front * 0.12);
      mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.1, 10), rust, j, 0, -0.03, 0);
      mesh(new THREE.SphereGeometry(0.068, 12, 8), dark, j, 0, -0.125, 0);
      const out = new THREE.Vector3(side * 0.6, 0, front).normalize();
      for (let c = 0; c < 4; c++) {
        const a = Math.atan2(out.x, out.z) + (c - 1.5) * 0.75 + (c === 3 ? 0.9 : 0);
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        const pts = [new THREE.Vector3(dx * 0.05, -0.06, dz * 0.05), new THREE.Vector3(dx * 0.085, -0.11, dz * 0.085), new THREE.Vector3(dx * 0.08, -0.17, dz * 0.08), new THREE.Vector3(dx * 0.055, -0.2, dz * 0.055)];
        mesh(taperTube(pts, 0.024, 0.008, 8, 6), rust, j);
      }
      this.feet.push({ j, side, front });
    }

    // --- Broken shackle chains swinging from the flanks.
    for (const s of [1, -1]) {
      const p = S(s * 1.95, 1.22, 1.02);
      const c = joint(T, p.x, p.y, p.z);
      for (let i = 0; i < 7; i++) {
        const l = mesh(new THREE.TorusGeometry(0.028, 0.0075, 5, 10).scale(1, 1.45, 1), iron, c, 0, -0.03 - i * 0.058, 0);
        l.rotation.y = i % 2 ? Math.PI / 2 : 0;
      }
      mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 14, Math.PI * 1.6).rotateZ(-Math.PI * 0.3), rust, c, 0, -0.5, 0).rotation.y = Math.PI / 2;
      this.chains.push(c);
    }

    bakeRig(this.root);
  }

  setDoors(a: number, b = a) {
    this.doors[0].rotation.y = a;
    this.doors[1].rotation.y = -b;
  }

  /** Glow follows how far the doors stand open, flickering like embers. */
  light(open: number) {
    const fl = 0.85 + 0.15 * Math.sin(this.time * 13.1) * Math.sin(this.time * 7.3 + 1);
    const crack = Math.min(1, open * 8) * (1 - Math.min(1, Math.max(0, (open - 0.25) * 3)));
    this.seamGlow.opacity = crack * fl * this.life;
    this.hazeMat.opacity = Math.min(1, open * 1.6) * 0.75 * fl * this.life;
    this.glowInside.emissiveIntensity = (0.35 + Math.min(1, open * 2) * 0.9 * fl) * this.life;
    this.eyes.color.setRGB(4 * (0.6 + 0.4 * fl) * this.life, 0.35 * this.life, 0.15 * this.life);
  }

  protected animate() {
    const w = this.walk;
    const t = this.time;
    const p = this.phase;
    // Waddle: rock onto one side's feet, swing the others forward, a grinding hop each step.
    const sway = Math.sin(p);
    this.trunk.rotation.set(0.05 * w + Math.sin(t * 0.9) * 0.008, Math.cos(p) * 0.09 * w + this.lookYaw * 0.15, -sway * 0.085 * w);
    this.trunk.position.set(0, Math.abs(sway) * 0.035 * w, 0);
    for (const f of this.feet) {
      const up = Math.max(0, f.side * sway) * w;
      f.j.position.y = BASE + up * 0.06;
      f.j.position.z = f.front * 0.12 + Math.cos(p) * f.side * 0.07 * w;
      f.j.rotation.x = -up * 0.4;
    }
    // Idle breath: the doors creak ajar and settle, a little each step too.
    const creak = Math.max(0, Math.sin(t * 0.55 + this.seed)) ** 4;
    const jit = Math.sin(t * 31) * 0.006 * creak;
    this.ajar = creak * 0.2 + Math.abs(sway) * 0.05 * w;
    this.setDoors(this.ajar + jit, this.ajar * 0.85 - jit + Math.max(0, Math.sin(t * 0.55 + this.seed - 0.3)) ** 4 * 0.03);
    this.light(this.ajar);
    this.head.rotation.set(Math.sin(t * 0.7) * 0.02, this.lookYaw * 0.3, 0);
    this.inmate.position.z = -0.03;
    this.inmateHead.rotation.set(0.55 + Math.sin(t * 0.6) * 0.05 + creak * 0.15, Math.sin(t * 0.4) * 0.2 + (creak > 0.6 ? Math.sin(t * 40) * 0.05 : 0), 0.15);
    for (const [i, c] of this.chains.entries()) {
      c.rotation.x = Math.sin(p + i) * 0.25 * w + Math.sin(t * 1.3 + i) * 0.04 - 0.05 * w;
      c.rotation.z = (i ? 1 : -1) * (Math.cos(p) * 0.15 * w + 0.05);
    }
    this.body.position.set(0, 0, 0);
  }
}

export function buildMaiden(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  const c = new Maiden(m, rng, scale);
  return {
    rig: c,
    attack(onHit) {
      let fired = false;
      c.play(1.15, (k) => {
        // Rear back with the doors swinging wide, lurch in, slam them shut.
        const open = 1.8 * ease(k, 0.02, 0.3) * (1 - ease(k, 0.54, 0.6));
        c.setDoors(Math.max(open, c.ajar * (1 - ease(k, 0, 0.1))) + hump(k, 0.6, 0.7) * 0.06);
        c.light(Math.max(open, hump(k, 0.6, 0.66) * 0.1));
        const lurch = ease(k, 0.3, 0.56) * (1 - ease(k, 0.72, 1));
        c.body.position.z = lurch * 0.6;
        c.trunk.rotation.x = -0.14 * ease(k, 0, 0.3) * (1 - ease(k, 0.3, 0.45)) + 0.32 * lurch + Math.sin(k * 90) * 0.03 * hump(k, 0.6, 0.78);
        c.trunk.position.y = hump(k, 0.3, 0.56) * 0.14;
        c.head.rotation.x = -0.15 * hump(k, 0.1, 0.55);
        c.inmateHead.rotation.x = 0.55 - 0.6 * hump(k, 0.1, 0.55);
        c.inmate.position.z = -0.03 + 0.07 * hump(k, 0.15, 0.55);
        if (!fired && k >= 0.6) {
          fired = true;
          onHit();
        }
      });
    },
    flinch() {
      if (c.acting) return;
      c.play(0.32, (k) => {
        const s = Math.sin(k * Math.PI);
        c.trunk.rotation.x = -s * 0.09;
        c.body.position.z = -s * 0.07;
        c.setDoors(c.ajar + s * 0.18 * (1 + Math.sin(k * 40) * 0.3));
        c.light(c.ajar + s * 0.15);
      });
    },
    die() {
      // Totters, topples face down with a crash, and the doors fall open.
      const zf = 0.29;
      c.play(1.7, (k) => {
        c.life = 1 - ease(k, 0.5, 1) * 0.85;
        const fall = Math.min(1, Math.max(0, (k - 0.16) / 0.5)) ** 2;
        const a = -0.07 * hump(k, 0, 0.2) + fall * 1.5 - hump(k, 0.66, 0.8) * 0.07;
        c.trunk.rotation.set(a, 0, 0.04 * fall);
        c.trunk.position.set(0, zf * Math.sin(a), zf - zf * Math.cos(a));
        const open = ease(k, 0.68, 0.95) * 2.15 + hump(k, 0.88, 1) * 0.08;
        c.setDoors(open, open * 0.95);
        c.light(Math.max(c.ajar * (1 - fall), open * 0.3));
        c.head.rotation.x = 0.1 * fall;
        c.inmateHead.rotation.x = 0.55 + 0.4 * fall;
        for (const f of c.feet) f.j.position.y = BASE;
      });
    },
    muzzle() {
      return c.trunk.localToWorld(new THREE.Vector3(0, 1.1, 0.4));
    },
  };
}
