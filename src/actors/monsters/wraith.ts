import * as THREE from 'three';
import { gridNormals } from '../cloth';
import { joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { bump, sculptSphere } from '../sculpt';
import { ease } from './BasicRig';
import type { Rig } from '../Rig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Wraith: a hooded shade drifting a hand's breadth above the floor. A cold
// blue skull glows inside the cowl; its robe hangs in rags that never stop
// moving, trailing threads of red light. It keeps its distance and casts.
//
// The chained wraith is a gaoler's ghost still wearing its fetters: a tall
// spectre of shredded black rags with a bone skull in the cowl and a heart
// of red fire whose veins crack across its chest. Heavy iron chains bind its
// body and arms, manacles close on its wrists, and long chain ends trail and
// drag along the floor behind it. It lashes with the longest of them.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Rag {
  geo: THREE.BufferGeometry;
  rest: Float32Array;
  len: number;
  phase: number;
  wisp: boolean;
}

// Chains: heavy forged oval links, long axis along Y, each one a quarter
// turn from the last.
let linkGeo: THREE.BufferGeometry | null = null;
const chainLink = () => (linkGeo ??= new THREE.TorusGeometry(0.026, 0.0095, 4, 8).scale(1, 1.5, 1));
const PITCH = 0.066;
const UP = new THREE.Vector3(0, 1, 0);
const QUARTER = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);

/** Static links laid along a dense polyline (closed for a loop). */
function chainAlong(pts: THREE.Vector3[], mat: THREE.Material, parent: THREE.Object3D, closed: boolean) {
  const path = closed ? [...pts, pts[0]] : pts;
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = cum[cum.length - 1];
  const at = (s: number) => {
    s = closed ? ((s % total) + total) % total : Math.min(total, Math.max(0, s));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return path[i - 1].clone().lerp(path[i], f);
  };
  const n = Math.max(1, Math.round(total / PITCH));
  const pitch = total / n;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * pitch;
    const p = at(s);
    const dir = at(s + pitch / 2).sub(at(s - pitch / 2)).normalize();
    const lk = mesh(chainLink(), mat, parent, p.x, p.y, p.z);
    lk.quaternion.setFromUnitVectors(UP, dir);
    if (i % 2) lk.quaternion.multiply(QUARTER);
  }
}

/** A hanging chain end, simulated as a verlet rope in body space. */
interface Chain {
  anchor: THREE.Object3D;
  n: number;
  p: Float32Array;
  q: Float32Array;
  first: number;
  a0: THREE.Vector3;
  a1: THREE.Vector3;
}

class Wraith implements Rig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly core: THREE.Object3D;
  readonly hood: THREE.Object3D;
  readonly arms: { side: number; shoulder: THREE.Object3D; fore: THREE.Object3D }[] = [];
  lookYaw = 0;
  onStep = null;
  private rags: Rag[] = [];
  private time = Math.random() * 10;
  private lean = 0;
  heart: THREE.Mesh | null = null;
  private action: { t: number; dur: number; fn: (k: number) => void; done?: () => void } | null = null;
  // Chained variant only.
  readonly chained: boolean;
  private readonly baseY: number;
  readonly chains: Chain[] = [];
  private links: THREE.InstancedMesh | null = null;
  halo: THREE.Mesh | null = null;
  readonly ragMeshes: THREE.Mesh[] = [];
  wispMat: THREE.MeshBasicMaterial | null = null;
  dead = false;
  /** The lash: 0..1 hold on the long chain, its sweep angle, stretch and tip height. */
  lash = { w: 0, angle: 0, ext: 0, tipY: 0.8 };
  private lastYaw = 0;

  constructor(m: MonsterMaterials, rng: Rng, scale: number, mire = false, chained = false) {
    this.chained = chained;
    this.baseY = chained ? 1.3 : 1.15;
    this.body.scale.setScalar(scale);
    this.root.add(this.body);
    // The mire wraith is a drowned shade: a bone skull, mud-dark rags, and a
    // heart of red fire burning behind its ribs.
    const cloth = chained
      ? new THREE.MeshStandardMaterial({ color: 0x0e0b0a, roughness: 0.85, side: THREE.DoubleSide, emissive: new THREE.Color(0.018, 0.003, 0.002) })
      : mire
        ? new THREE.MeshStandardMaterial({ color: 0x0d0a08, roughness: 0.95, side: THREE.DoubleSide, emissive: new THREE.Color(0.02, 0.004, 0.002) })
        : new THREE.MeshStandardMaterial({ color: 0x0b0c16, roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color(0.01, 0.012, 0.04) });
    const spirit = mire ? new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.02, 0.01), fog: false }) : new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.75, 2.6), fog: false });
    const skullMat = mire ? m.bone : spirit;
    const eyes = mire ? m.eyeRed : new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.2, 6), fog: false });
    const wisp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.08, 0.04), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.wispMat = wisp;

    this.core = joint(this.body, 0, this.baseY, 0);
    // Shoulders and chest: a narrow mantle the rags hang from.
    mesh(lathe([[0.08, 0.32], [0.2, 0.24], [0.24, 0.1], [0.2, -0.1], [0.16, -0.3]], 18).scale(1.15, 1, 0.85), cloth, this.core);
    // Ribcage glimpsed through a rent in the robe.
    for (let i = 0; i < 4; i++) mesh(new THREE.TorusGeometry(0.1 - i * 0.012, 0.008, 4, 14, Math.PI).rotateX(-Math.PI / 2), mire ? m.bone : spirit, this.core, 0, 0.12 - i * 0.055, mire ? 0.17 : 0.12);
    if (mire) {
      // The burning heart, and the dark hollow of the chest around it.
      mesh(new THREE.SphereGeometry(0.12, 12, 8).scale(1, 1.1, 0.6), m.void, this.core, 0, 0.04, 0.13);
      this.heart = mesh(new THREE.SphereGeometry(0.07, 12, 8), spirit, this.core, 0, 0.04, 0.17);
      this.heart.userData.dynamic = true;
    }

    // Hood: a deep cowl around a glowing skull.
    this.hood = joint(this.core, 0, 0.36, 0.04);
    mesh(
      sculptSphere(0.17, (x, y, z) => 0.2 * smooth(0.2, -0.6, y) + 0.25 * bump(x, y, 0, 0.75, 0.2, 0.3) * smooth(0, -0.8, z), new THREE.Vector3(1, 1.15, 1.1), 24, 18),
      cloth,
      this.hood,
      0,
      0.02,
      -0.03,
    );
    mesh(new THREE.SphereGeometry(0.135, 14, 10).scale(0.9, 1.1, 0.5), m.void, this.hood, 0, 0.0, 0.1);
    const skull = sculptSphere(
      0.075,
      (x, y, z) => {
        const front = smooth(0.3, 0.9, z);
        let d = -0.25 * (bump(x, y, -0.35, 0.1, 0.18, 0.15) + bump(x, y, 0.35, 0.1, 0.18, 0.15)) * front; // sockets
        d -= 0.2 * bump(x, y, 0, -0.25, 0.1, 0.1) * front; // nose hole
        d -= 0.18 * smooth(-0.3, -0.9, y) * (1 - Math.abs(x)); // narrow jaw
        return d;
      },
      new THREE.Vector3(0.85, 1.05, 0.9),
      20,
      16,
    );
    mesh(skull, skullMat, this.hood, 0, -0.01, 0.12);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.013, 8, 6), eyes, this.hood, s * 0.026, 0.0, 0.175);
    // Jaw hanging open.
    mesh(new THREE.BoxGeometry(0.06, 0.02, 0.04), skullMat, this.hood, 0, -0.085, 0.14).rotation.x = 0.4;

    if (chained) {
      this.buildChained(m, rng, cloth, wisp);
      return;
    }

    // Sleeves and skeletal hands.
    for (const side of [-1, 1]) {
      const shoulder = joint(this.core, side * 0.24, 0.16, 0);
      shoulder.rotation.z = side * 0.25;
      mesh(lathe([[0.06, 0], [0.075, -0.15], [0.09, -0.32], [0.12, -0.42]], 12), cloth, shoulder);
      const fore = joint(shoulder, 0, -0.38, 0);
      mesh(lathe([[0.07, 0.02], [0.1, -0.12], [0.14, -0.26]], 12), cloth, fore);
      for (let f = 0; f < 4; f++) {
        const finger = mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.16, 5).translate(0, -0.08, 0), skullMat, fore, (f - 1.5) * 0.022, -0.26, 0.02);
        finger.rotation.set(0.35 + f * 0.05, 0, (f - 1.5) * 0.12);
      }
      this.arms.push({ side, shoulder, fore });
    }

    // Rags around the mantle and wisps of red light trailing among them.
    const count = 14;
    for (let i = 0; i < count + 6; i++) {
      const isWisp = i >= count;
      const a = isWisp ? range(rng, 0, Math.PI * 2) : (i / count) * Math.PI * 2;
      const len = isWisp ? range(rng, 0.7, 1.1) : range(rng, 0.85, 1.15);
      const w = isWisp ? 0.025 : range(rng, 0.11, 0.17);
      const g = new THREE.PlaneGeometry(w, len, 1, 10).translate(0, -len / 2, 0);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const t = -p.getY(k) / len;
        // Taper to a ragged point.
        p.setX(k, p.getX(k) * (1 - t * (isWisp ? 0.6 : 0.75)));
      }
      const r = 0.2;
      const mk = mesh(g, isWisp ? wisp : cloth, this.core, Math.sin(a) * r * 1.1, -0.15, Math.cos(a) * r * 0.85);
      mk.rotation.y = a;
      mk.userData.dynamic = true;
      mk.castShadow = !isWisp;
      this.rags.push({ geo: g, rest: (p.array as Float32Array).slice(), len, phase: rng() * 10, wisp: isWisp });
    }
    bakeRig(this.root);
  }

  /** A shredded strip of cloth (or a wisp of light) hanging from `parent`. */
  private strip(rng: Rng, parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, yaw: number, w: number, len: number, isWisp = false) {
    const g = new THREE.PlaneGeometry(w, len, 1, 10).translate(0, -len / 2, 0);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    // Ragged width down its length, torn to a point at the end.
    const jag = Array.from({ length: 11 }, () => 0.7 + rng() * 0.6);
    for (let k = 0; k < p.count; k++) {
      const t = -p.getY(k) / len;
      p.setX(k, p.getX(k) * (1 - t * (isWisp ? 0.6 : 0.85)) * (isWisp ? 1 : jag[Math.round(t * 10)]));
    }
    const mk = mesh(g, mat, parent, x, y, z);
    mk.rotation.y = yaw;
    mk.userData.dynamic = true;
    mk.castShadow = !isWisp;
    this.ragMeshes.push(mk);
    this.rags.push({ geo: g, rest: (p.array as Float32Array).slice(), len, phase: rng() * 10, wisp: isWisp });
  }

  private buildChained(m: MonsterMaterials, rng: Rng, cloth: THREE.Material, wisp: THREE.Material) {
    const iron = (m.iron as THREE.MeshStandardMaterial).clone();
    iron.color.setRGB(0.3, 0.22, 0.18);
    iron.roughness = 0.42;
    const cuffIron = iron.clone();
    cuffIron.color.setRGB(0.22, 0.17, 0.14);
    const vein = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.025, 0.01), fog: false });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.08, 0.03), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const bone = (m.bone as THREE.MeshStandardMaterial).clone();
    bone.color.set(0x6a5c48);
    bone.roughness = 0.55;

    // Mantle radius at a height on the core (the lathe profile, then the rags).
    const prof: [number, number][] = [[0.08, 0.32], [0.2, 0.24], [0.24, 0.1], [0.2, -0.1], [0.16, -0.3], [0.19, -0.45], [0.2, -0.7]];
    const rad = (y: number) => {
      for (let i = 1; i < prof.length; i++) {
        const [r0, y0] = prof[i - 1];
        const [r1, y1] = prof[i];
        if (y <= y0 && y >= y1) return r0 + ((r1 - r0) * (y0 - y)) / (y0 - y1);
      }
      return y > 0.32 ? 0.08 : 0.2;
    };
    const surface = (x: number, y: number, out = 0) => {
      const r = rad(y);
      const rx = r * 1.15;
      const rz = r * 0.85;
      return new THREE.Vector3(x, y, Math.sqrt(Math.max(0, 1 - (x * x) / (rx * rx))) * rz + out);
    };

    // The heart burns brighter here: a halo of light, and veins of fire
    // cracking out across the chest from it.
    this.halo = mesh(new THREE.SphereGeometry(0.11, 12, 8).scale(1, 1.1, 0.7), glow, this.core, 0, 0.04, 0.17);
    this.halo.userData.dynamic = true;
    this.halo.castShadow = false;
    const crack = (x: number, y: number, a: number, len: number, depth: number) => {
      let px = x;
      let py = y;
      const steps = 3 + Math.floor(rng() * 2);
      for (let s = 0; s < steps; s++) {
        a += range(rng, -0.5, 0.5);
        const l = (len / steps) * range(rng, 0.7, 1.2);
        const nx = px + Math.sin(a) * l;
        const ny = py + Math.cos(a) * l;
        const p0 = surface(px, py, 0.004);
        const p1 = surface(nx, ny, 0.004);
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        const seg = mesh(new THREE.BoxGeometry(0.0065 * (1 - s / (steps + 1)) * (depth ? 0.7 : 1), p0.distanceTo(p1) + 0.006, 0.004), vein, this.core, mid.x, mid.y, mid.z);
        seg.quaternion.setFromUnitVectors(UP, p1.clone().sub(p0).normalize());
        seg.castShadow = false;
        if (depth < 1 && rng() < 0.6) crack(nx, ny, a + (rng() < 0.5 ? -1 : 1) * range(rng, 0.6, 1.1), len * 0.5, depth + 1);
        px = nx;
        py = ny;
      }
    };
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + range(rng, -0.25, 0.25);
      crack(Math.sin(a) * 0.07, 0.04 + Math.cos(a) * 0.075, a, range(rng, 0.13, 0.22), 0);
    }
    // A grinning row of teeth in the skull.
    for (let i = 0; i < 6; i++) mesh(new THREE.BoxGeometry(0.008, 0.014, 0.006), bone, this.hood, (i - 2.5) * 0.0095, -0.058, 0.18 - Math.abs(i - 2.5) * 0.004);

    // Arms: tattered sleeves to the elbow, then bare bone, iron cuffs and
    // long clawed hands.
    const anchors: THREE.Object3D[] = [];
    for (const side of [-1, 1]) {
      const shoulder = joint(this.core, side * 0.24, 0.16, 0);
      shoulder.rotation.z = side * 0.3;
      mesh(lathe([[0.065, 0.02], [0.08, -0.12], [0.085, -0.28], [0.1, -0.4]], 12), cloth, shoulder);
      const fore = joint(shoulder, 0, -0.38, 0);
      mesh(lathe([[0.075, 0.03], [0.09, -0.06], [0.1, -0.12]], 12), cloth, fore);
      mesh(new THREE.SphereGeometry(0.03, 8, 6), bone, fore, 0, -0.02, -0.01);
      mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.27, 6).translate(0, -0.15, 0), bone, fore, side * 0.012, 0, 0);
      mesh(new THREE.CylinderGeometry(0.01, 0.013, 0.27, 6).translate(0, -0.15, 0), bone, fore, -side * 0.014, 0, 0.004);
      // The manacle: a riveted iron cuff, its hinge and the ring the chain hangs from.
      mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.075, 12, 1, true), cuffIron, fore, 0, -0.27, 0);
      for (const dy of [-0.035, 0.035]) mesh(new THREE.TorusGeometry(0.049, 0.008, 4, 14).rotateX(Math.PI / 2), iron, fore, 0, -0.27 + dy, 0);
      for (let r = 0; r < 5; r++) {
        const a = (r / 5) * Math.PI * 2;
        mesh(new THREE.SphereGeometry(0.007, 5, 4), iron, fore, Math.sin(a) * 0.051, -0.27, Math.cos(a) * 0.051);
      }
      mesh(new THREE.TorusGeometry(0.022, 0.007, 4, 10), iron, fore, side * 0.058, -0.29, 0).rotation.y = Math.PI / 2;
      anchors.push(joint(fore, side * 0.06, -0.31, 0));
      // Hand: knuckled palm, four long jointed fingers ending in hooked claws, a thumb.
      mesh(new THREE.BoxGeometry(0.075, 0.07, 0.026).translate(0, -0.035, 0), bone, fore, 0, -0.31, 0.005);
      const finger = (bx: number, bz: number, spread: number, l1: number, l2: number, curl: number) => {
        let p = new THREE.Vector3(bx, -0.38, bz);
        let a = 0.25;
        for (const [l, r] of [[l1, 0.009], [l2, 0.007], [l2 * 0.75, 0.005]]) {
          const dir = new THREE.Vector3(Math.sin(spread) * Math.cos(a), -Math.cos(a), Math.sin(a)).normalize();
          const end = p.clone().addScaledVector(dir, l);
          const s = mesh(new THREE.CylinderGeometry(r * 0.8, r, l, 5), bone, fore, (p.x + end.x) / 2, (p.y + end.y) / 2, (p.z + end.z) / 2);
          s.quaternion.setFromUnitVectors(UP, dir.clone().negate());
          mesh(new THREE.SphereGeometry(r * 1.15, 5, 4), bone, fore, p.x, p.y, p.z);
          p = end;
          a += curl;
        }
        const tip = mesh(new THREE.ConeGeometry(0.006, 0.04, 4).translate(0, 0.02, 0), m.chitin, fore, p.x, p.y, p.z);
        tip.quaternion.setFromUnitVectors(UP, new THREE.Vector3(Math.sin(spread) * 0.3, -Math.cos(a), Math.sin(a)).normalize());
      };
      for (let f = 0; f < 4; f++) finger((f - 1.5) * 0.02, 0.008, (f - 1.5) * 0.1, 0.07 + (f === 1 || f === 2 ? 0.015 : 0), 0.06, 0.32 + f * 0.04);
      finger(-side * 0.04, 0.02, -side * 0.6, 0.05, 0.045, 0.3);
      this.arms.push({ side, shoulder, fore });
      // Chain coiled up each arm: round the upper sleeve and the bare forearm.
      const coil = (parent: THREE.Object3D, y0: number, y1: number, r0: number, r1: number, turns: number, a0: number) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 60; i++) {
          const t = i / 60;
          const a = a0 + t * turns * Math.PI * 2;
          const r = r0 + (r1 - r0) * t;
          pts.push(new THREE.Vector3(Math.sin(a) * r, y0 + (y1 - y0) * t, Math.cos(a) * r));
        }
        chainAlong(pts, iron, parent, false);
      };
      coil(shoulder, -0.08, -0.3, 0.1, 0.112, 1.6, side);
      coil(fore, -0.1, -0.22, 0.05, 0.05, 1.4, side * 2);
      // Ragged strips hanging from the arms.
      for (let i = 0; i < 3; i++) this.strip(rng, shoulder, cloth, side * 0.04 + range(rng, -0.04, 0.04), -0.34, range(rng, -0.08, 0.02), side * Math.PI * 0.5 + range(rng, -0.6, 0.6), range(rng, 0.04, 0.07), range(rng, 0.3, 0.5));
      for (let i = 0; i < 3; i++) this.strip(rng, fore, cloth, range(rng, -0.04, 0.04), -0.08, range(rng, -0.08, 0.0), side * Math.PI * 0.5 + range(rng, -0.8, 0.8), range(rng, 0.03, 0.055), range(rng, 0.25, 0.45));
    }

    // Chains wound round the body: a sash from left ribs to right hip, a
    // loop at the waist and a heavy swag sagging across the front.
    const loop = (c: number, tilt: number, out: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const y = c + Math.sin(a) * tilt;
        const r = rad(y) + out;
        pts.push(new THREE.Vector3(Math.sin(a) * r * 1.15, y, Math.cos(a) * r * 0.88));
      }
      chainAlong(pts, iron, this.core, true);
    };
    loop(-0.17, 0.15, 0.035);
    loop(-0.38, -0.04, 0.04);
    const swag: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const x = -0.2 + 0.4 * t;
      const y = -0.36 - Math.sin(t * Math.PI) * 0.2 + t * 0.03;
      swag.push(new THREE.Vector3(x * 1.1, y, 0.2 + Math.sin(t * Math.PI) * 0.05));
    }
    chainAlong(swag, iron, this.core, false);
    anchors.push(joint(this.core, -0.1, -0.39, -0.17), joint(this.core, 0.12, -0.39, -0.17));

    // Rags: two layers of shredded strips, a short cape off the shoulders and
    // long tatters from the mantle almost to the floor; hair-like rags off
    // the cowl; a few wisps of red light among them.
    const count = 13;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + range(rng, -0.12, 0.12);
      const back = 0.5 - 0.5 * Math.cos(a); // longer behind
      const n = 1 + Math.floor(rng() * 2);
      for (let s = 0; s < n; s++) {
        const off = (s - (n - 1) / 2) * 0.06;
        const r = 0.2;
        this.strip(rng, this.core, cloth, Math.sin(a) * r * 1.1 + Math.cos(a) * off, -0.15, Math.cos(a) * r * 0.85 - Math.sin(a) * off, a, range(rng, 0.04, 0.07), range(rng, 0.6, 1.0) + back * range(rng, 0.05, 0.3));
      }
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + range(rng, -0.15, 0.15);
      if (Math.cos(a) > 0.6) continue; // keep the heart bare
      this.strip(rng, this.core, cloth, Math.sin(a) * 0.25, 0.14, Math.cos(a) * 0.19, a, range(rng, 0.06, 0.1), range(rng, 0.35, 0.6));
    }
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6 - 0.5) * 3.4;
      this.strip(rng, this.hood, cloth, Math.sin(a) * 0.16, -0.06, Math.cos(a) * 0.15 - 0.02, a, range(rng, 0.04, 0.07), range(rng, 0.35, 0.65));
    }
    for (let i = 0; i < 5; i++) {
      const a = range(rng, 0, Math.PI * 2);
      this.strip(rng, this.core, wisp, Math.sin(a) * 0.2, -0.15, Math.cos(a) * 0.16, a, 0.025, range(rng, 0.7, 1.05), true);
    }
    bakeRig(this.root);

    // The hanging chain ends: a long lash from the right wrist, a shorter end
    // from the left, and two dragging from the back of the waist loop.
    const lengths = [44, 15, 22, 27];
    let total = 0;
    anchors.forEach((anchor, i) => {
      const n = lengths[i] + 1;
      this.chains.push({ anchor, n, p: new Float32Array(n * 3), q: new Float32Array(n * 3), first: total, a0: new THREE.Vector3(), a1: new THREE.Vector3() });
      total += lengths[i];
    });
    this.links = new THREE.InstancedMesh(chainLink(), iron, total);
    this.links.userData.dynamic = true;
    this.links.castShadow = true;
    this.links.frustumCulled = false;
    this.body.add(this.links);
    // Lay them out hanging and trailing behind, then let them settle.
    this.root.updateMatrixWorld(true);
    for (const c of this.chains) {
      this.anchorPos(c, c.a1);
      c.a0.copy(c.a1);
      for (let i = 0; i < c.n; i++) {
        const d = i * PITCH;
        const drop = Math.min(d, c.a1.y - 0.03);
        const x = c.a1.x * (1 + d * 0.3);
        const y = c.a1.y - drop;
        const z = c.a1.z - Math.max(0, d - drop);
        c.p.set([x, y, z], i * 3);
        c.q.set([x, y, z], i * 3);
      }
    }
    for (let i = 0; i < 40; i++) this.simulate(1 / 30, 0);
  }

  private anchorPos(c: Chain, out: THREE.Vector3) {
    c.anchor.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(c.anchor.matrixWorld);
    return this.body.worldToLocal(out);
  }

  /** Steps the hanging chains (verlet, in body space) and poses their links. */
  private simulate(dt: number, speed: number) {
    // Turning the root swings the world past the chains: counter-rotate them.
    const yaw = this.root.rotation.y;
    let dYaw = yaw - this.lastYaw;
    this.lastYaw = yaw;
    if (Math.abs(dYaw) > 1) dYaw = 0;
    const cs = Math.cos(-dYaw);
    const sn = Math.sin(-dYaw);
    for (const c of this.chains) {
      c.a0.copy(c.a1);
      this.anchorPos(c, c.a1);
      if (dYaw)
        for (const arr of [c.p, c.q])
          for (let i = 3; i < arr.length; i += 3) {
            const x = arr[i];
            const z = arr[i + 2];
            arr[i] = x * cs + z * sn;
            arr[i + 2] = -x * sn + z * cs;
          }
    }
    const steps = Math.min(6, Math.max(1, Math.ceil(dt * 60)));
    const h = dt / steps;
    // The floor (and the air) slide back past a drifting wraith.
    const flow = (-speed / this.body.scale.x) * h;
    const g = 9.8 * h * h;
    const floor = 0.022;
    const L = PITCH;
    const lash = this.lash;
    const a = new THREE.Vector3();
    for (let s = 1; s <= steps; s++) {
      for (let ci = 0; ci < this.chains.length; ci++) {
        const c = this.chains[ci];
        const p = c.p;
        const q = c.q;
        a.lerpVectors(c.a0, c.a1, s / steps);
        const damp = 0.985 * (ci === 0 ? 1 - lash.w * 0.5 : 1);
        for (let i = 1; i < c.n; i++) {
          const k = i * 3;
          const vx = (p[k] - q[k]) * damp;
          const vy = (p[k + 1] - q[k + 1]) * damp;
          let vz = (p[k + 2] - q[k + 2]) * damp;
          vz += (flow - vz) * 0.03;
          q[k] = p[k];
          q[k + 1] = p[k + 1];
          q[k + 2] = p[k + 2];
          p[k] += vx;
          p[k + 1] += vy - g;
          p[k + 2] += vz;
        }
        p[0] = a.x;
        p[1] = a.y;
        p[2] = a.z;
        // The lash: the long chain is whipped out along an arc.
        if (ci === 0 && lash.w > 0) {
          const w = lash.w * 0.85;
          for (let i = 1; i < c.n; i++) {
            const u = i / (c.n - 1);
            const th = lash.angle - 0.4 * u;
            const d = i * L * lash.ext;
            const k = i * 3;
            p[k] += (a.x + Math.sin(th) * d - p[k]) * w;
            p[k + 1] += (a.y + (lash.tipY - a.y) * u + Math.sin(u * Math.PI) * 0.12 - p[k + 1]) * w;
            p[k + 2] += (a.z + Math.cos(th) * d - p[k + 2]) * w;
          }
        }
        for (let it = 0; it < 8; it++) {
          for (let i = 0; i < c.n - 1; i++) {
            const k = i * 3;
            const dx = p[k + 3] - p[k];
            const dy = p[k + 4] - p[k + 1];
            const dz = p[k + 5] - p[k + 2];
            const len = Math.hypot(dx, dy, dz) || 1e-6;
            const f = (len - L) / len;
            if (i === 0) {
              p[k + 3] -= dx * f;
              p[k + 4] -= dy * f;
              p[k + 5] -= dz * f;
            } else {
              p[k] += dx * f * 0.5;
              p[k + 1] += dy * f * 0.5;
              p[k + 2] += dz * f * 0.5;
              p[k + 3] -= dx * f * 0.5;
              p[k + 4] -= dy * f * 0.5;
              p[k + 5] -= dz * f * 0.5;
            }
          }
        }
        // Links on the floor drag along it.
        for (let i = 1; i < c.n; i++) {
          const k = i * 3;
          if (p[k + 1] < floor) {
            p[k + 1] = floor;
            q[k + 1] = floor;
            const vx = p[k] - q[k];
            const vz = p[k + 2] - q[k + 2];
            q[k] = p[k] - vx * 0.45;
            q[k + 2] = p[k + 2] - (vz + (flow - vz) * 0.55);
          }
        }
      }
    }
    // Pose the links between successive points.
    const links = this.links!;
    const mat = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const mid = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (const c of this.chains) {
      for (let i = 0; i < c.n - 1; i++) {
        const k = i * 3;
        dir.set(c.p[k + 3] - c.p[k], c.p[k + 4] - c.p[k + 1], c.p[k + 5] - c.p[k + 2]);
        const l = dir.length();
        if (l > 1e-6) dir.multiplyScalar(1 / l);
        else dir.copy(UP);
        mid.set(c.p[k] + c.p[k + 3], c.p[k + 1] + c.p[k + 4], c.p[k + 2] + c.p[k + 5]).multiplyScalar(0.5);
        quat.setFromUnitVectors(UP, dir);
        if (i % 2) quat.multiply(QUARTER);
        mat.compose(mid, quat, one);
        links.setMatrixAt(c.first + i, mat);
      }
    }
    links.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, speed: number) {
    this.time += dt;
    const t = this.time;
    if (!this.dead) {
      this.lean += (Math.min(1, speed / 3) - this.lean) * (1 - Math.exp(-dt * 4));
      this.core.position.y = this.baseY + Math.sin(t * 1.6) * 0.06;
      this.core.rotation.x = this.lean * 0.3;
      this.core.rotation.z = Math.sin(t * 0.9) * 0.04;
      this.hood.rotation.y += (this.lookYaw - this.hood.rotation.y) * (1 - Math.exp(-dt * 5));
      this.hood.rotation.x = -0.15 + Math.sin(t * 1.1) * 0.05;
      const pulse = 1 + Math.max(0, Math.sin(t * 5.5)) ** 4 * 0.35;
      if (this.heart) this.heart.scale.setScalar(pulse);
      if (this.chained) {
        this.halo!.scale.setScalar(0.8 + (pulse - 1) * 0.8);
        this.core.rotation.y = 0;
        // Claws held forward and open, swaying as it drifts.
        for (const a of this.arms) {
          a.shoulder.rotation.x = -0.45 + Math.sin(t * 1.3 + a.side) * 0.12 + this.lean * 0.5;
          a.shoulder.rotation.z = a.side * (0.3 + Math.sin(t * 0.8 + a.side * 2) * 0.05);
          a.fore.rotation.x = -0.55 + Math.sin(t * 1.7 + a.side) * 0.12;
        }
      } else
        for (const a of this.arms) {
          a.shoulder.rotation.x = -0.2 + Math.sin(t * 1.3 + a.side) * 0.12 + this.lean * 0.4;
          a.shoulder.rotation.z = a.side * 0.25;
          a.fore.rotation.x = -0.35 + Math.sin(t * 1.7 + a.side) * 0.1;
        }
    }
    // Rags billow and stream back as it moves.
    if (!this.dead || this.action)
      for (const r of this.rags) {
        const p = r.geo.getAttribute('position') as THREE.BufferAttribute;
        for (let k = 0; k < p.count; k++) {
          const x = r.rest[k * 3];
          const y = r.rest[k * 3 + 1];
          const f = -y / r.len;
          const wave = Math.sin(t * (r.wisp ? 4.5 : 2.6) + r.phase - f * 4) * f * (r.wisp ? 0.12 : 0.07);
          p.setXYZ(k, x + wave * 0.6, y + f * f * this.lean * 0.18, -wave - f * f * this.lean * 0.45);
        }
        p.needsUpdate = true;
        gridNormals(r.geo, 1, 10);
      }
    const acting = !!this.action;
    if (this.action) {
      const a = this.action;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.fn(k);
      if (k >= 1 && this.action === a) {
        this.action = null;
        a.done?.();
      }
    }
    if (this.links && (!this.dead || acting)) this.simulate(dt, this.dead ? 0 : speed);
  }

  play(dur: number, fn: (k: number) => void, done?: () => void) {
    this.action = { t: 0, dur, fn, done };
  }
  get acting() {
    return this.action !== null;
  }
  cancelAction() {
    this.action = null;
    this.lash.w = 0;
  }
}

export function buildWraith(m: MonsterMaterials, rng: Rng, scale = range(rng, 1.0, 1.1), variant: boolean | 'chained' = false): MonsterBody {
  const mire = variant !== false;
  if (variant === 'chained') return chainedBody(new Wraith(m, rng, scale, true, true), scale);
  const c = new Wraith(m, rng, scale, mire);
  return {
    rig: c,
    attack(onHit) {
      let fired = false;
      c.play(0.9, (k) => {
        // Both hands rise and thrust forward; the bolt leaves at full reach.
        const raise = Math.sin(Math.min(1, k / 0.55) * Math.PI * 0.5) * (k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3));
        for (const a of c.arms) {
          a.shoulder.rotation.x = -0.2 - raise * 1.5;
          a.shoulder.rotation.z = a.side * (0.25 - raise * 0.15);
          a.fore.rotation.x = -0.35 + raise * 0.2;
        }
        c.hood.rotation.x = -0.15 - raise * 0.25;
        if (!fired && k >= 0.55) {
          fired = true;
          onHit();
        }
      });
    },
    flinch() {
      if (c.acting) return;
      c.play(0.3, (k) => {
        c.core.rotation.x = -Math.sin(k * Math.PI) * 0.35;
      });
    },
    die() {
      // Rises, twists and unravels into nothing.
      c.play(1.6, (k) => {
        c.body.position.y = k * 0.8;
        c.body.rotation.y = k * k * 6;
        c.body.scale.setScalar(Math.max(0.001, scale * (1 - k) ** 1.5));
      });
    },
    muzzle() {
      const p = new THREE.Vector3();
      c.arms[1].fore.getWorldPosition(p);
      return p;
    },
  };
}

function chainedBody(c: Wraith, scale: number): MonsterBody {
  void scale;
  const [lashArm, other] = c.arms;
  return {
    rig: c,
    attack(onHit) {
      let fired = false;
      c.play(1.1, (k) => {
        // Wind the right arm out and back, twisting away; then whip it
        // across the front so the long chain sweeps out in an arc at full
        // stretch, and let it fall slack as the arm recovers.
        const wind = ease(k, 0, 0.38);
        const whip = ease(k, 0.38, 0.62);
        const back = ease(k, 0.7, 1);
        const sx = lashArm.shoulder.rotation.x;
        const sz = lashArm.shoulder.rotation.z;
        const fx = lashArm.fore.rotation.x;
        const ax = 0.6 * wind - 2.1 * whip;
        const az = lashArm.side * (1.15 * wind - 1.05 * whip);
        lashArm.shoulder.rotation.x = THREE.MathUtils.lerp(-0.45 + ax, sx, back);
        lashArm.shoulder.rotation.z = THREE.MathUtils.lerp(lashArm.side * 0.3 + az, sz, back);
        lashArm.fore.rotation.x = THREE.MathUtils.lerp(-0.55 + 0.25 * wind + 0.4 * whip, fx, back);
        other.shoulder.rotation.x += (-0.3 * wind + 0.35 * whip) * (1 - back);
        c.core.rotation.y = (-0.5 * wind + 0.95 * whip) * (1 - back);
        c.core.rotation.x += (-0.15 * wind + 0.3 * whip) * (1 - back);
        c.hood.rotation.x += (-0.2 * wind + 0.25 * whip) * (1 - back);
        c.lash.w = ease(k, 0.34, 0.45) * (1 - ease(k, 0.64, 0.86));
        c.lash.angle = -0.85 + 2.0 * ease(k, 0.36, 0.7);
        c.lash.ext = 0.55 + 0.43 * ease(k, 0.38, 0.55);
        c.lash.tipY = 0.85;
        if (!fired && k >= 0.55) {
          fired = true;
          onHit();
        }
        if (k >= 1) c.lash.w = 0;
      });
    },
    flinch() {
      if (c.acting) return;
      c.play(0.3, (k) => {
        c.core.rotation.x = -Math.sin(k * Math.PI) * 0.35;
      });
    },
    die() {
      // The fire in its heart gutters out and the shade collapses into a
      // heap of rags on the floor, its chains clattering down around it.
      c.dead = true;
      c.lash.w = 0;
      const y0 = c.core.position.y;
      const x0 = c.core.rotation.x;
      const wisp0 = c.wispMat?.opacity ?? 0.8;
      c.play(2.2, (k) => {
        const f = ease(k, 0.05, 0.7);
        const fade = 1 - ease(k, 0.1, 0.6);
        c.core.position.y = THREE.MathUtils.lerp(y0, 0.32, f) - Math.sin(Math.min(1, k * 4) * Math.PI) * 0.04;
        c.core.rotation.x = THREE.MathUtils.lerp(x0, 0.75, f);
        c.core.rotation.y = 0;
        c.hood.rotation.x = -0.15 + 0.6 * f;
        for (const a of c.arms) {
          a.shoulder.rotation.x = THREE.MathUtils.lerp(-0.45, -0.9, f);
          a.shoulder.rotation.z = a.side * THREE.MathUtils.lerp(0.3, 1.0, f);
          a.fore.rotation.x = THREE.MathUtils.lerp(-0.55, -0.1, f);
        }
        c.heart?.scale.setScalar(Math.max(0.001, fade * (1 + Math.sin(k * 40) * 0.2 * fade)));
        c.halo?.scale.setScalar(Math.max(0.001, fade));
        for (const r of c.ragMeshes) r.scale.y = 1 - 0.68 * f;
        if (c.wispMat) c.wispMat.opacity = wisp0 * fade;
      });
    },
    muzzle() {
      const p = new THREE.Vector3();
      lashArm.fore.getWorldPosition(p);
      return p;
    },
  };
}
