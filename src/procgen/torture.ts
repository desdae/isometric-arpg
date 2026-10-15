import * as THREE from 'three';
import { MeshBuilder, xf } from './builder';
import { boxProjectUVs } from './geometry';
import { range, type Rng } from './noise';
import { sculptSphere } from '../actors/sculpt';

// Torture-prison props for the blood dungeon: skeletons, gibbet cages, the
// rack, stocks, a spiked chair, the gallows frame, melted candles, a table of
// tools, cell bars, skull heaps, pedestal braziers, a blood cauldron and an
// open iron maiden. Every prop sits on the floor with its origin at its
// centre, faces +Z, and writes into a MeshBuilder under these keys only:
//   iron   - dark metal            rust   - rusted iron
//   wood   - old dark wood         bone   - bones and skulls
//   trim   - dressed stone         wall   - brick
//   rubble - rough stone           coal   - glowing embers
//   wax    - candle wax            flame  - emissive candle flames
//   gore   - wet flesh and blood   cloth  - rags and straps
//   rope   - rope
// Each function's doc gives its footprint as half sizes (x, z) for nav blocking.

const UP = new THREE.Vector3(0, 1, 0);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = (v: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Transform taking a unit Y-axis piece to run from a to b (centred between them). */
function along(a: THREE.Vector3, b: THREE.Vector3, sx = 1, sz = sx): THREE.Matrix4 {
  const d = b.clone().sub(a);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(sx, len, sz));
}

/** A tube through points whose radius tapers from r0 to r1 (bones, claws, drips, rope). */
export function taperTube(pts: THREE.Vector3[], r0: number, r1: number, seg = 10, radial = 6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const c = curve.getPointAt(u);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const v = V(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** A chain of alternating links from a to b, with optional sag at the middle. */
function chain(b: MeshBuilder, key: string, a: THREE.Vector3, c: THREE.Vector3, link = 0.035, sag = 0) {
  const len = a.distanceTo(c);
  const n = Math.max(2, Math.round(len / (link * 1.55)));
  const mid = a.clone().lerp(c, 0.5).add(V(0, -sag, 0));
  const curve = new THREE.QuadraticBezierCurve3(a, mid, c);
  const torus = new THREE.TorusGeometry(link * 0.5, link * 0.13, 4, 8).scale(1, 1.5, 1);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, t);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, i % 2 ? Math.PI / 2 : 0));
    b.add(key, torus, new THREE.Matrix4().compose(p, q, V(1, 1, 1)), 3);
  }
}

/** A cone spike with its base at p pointing along dir. */
function spikeAt(b: MeshBuilder, key: string, p: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, tipKey?: string) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  if (!tipKey) {
    b.add(key, new THREE.ConeGeometry(r, len, 6).translate(0, len / 2, 0), new THREE.Matrix4().compose(p, q, V(1, 1, 1)), 3);
    return;
  }
  b.add(key, new THREE.CylinderGeometry(r * 0.55, r, len * 0.45, 6).translate(0, len * 0.225, 0), new THREE.Matrix4().compose(p, q, V(1, 1, 1)), 3);
  b.add(tipKey, new THREE.ConeGeometry(r * 0.55, len * 0.55, 6).translate(0, len * 0.725, 0), new THREE.Matrix4().compose(p, q, V(1, 1, 1)), 3);
}

/** A flat, irregular splash of blood lying on a surface at height y. */
function splat(b: MeshBuilder, rng: Rng, x: number, y: number, z: number, r: number) {
  const s = new THREE.Shape();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * range(rng, 0.6, 1.15);
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  b.add('gore', new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), xf(x, y, z, rng() * 6), 2);
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    const d = r * range(rng, 1.1, 1.6);
    b.add('gore', new THREE.CircleGeometry(r * range(rng, 0.1, 0.22), 7).rotateX(-Math.PI / 2), xf(x + Math.cos(a) * d, y, z + Math.sin(a) * d), 2);
  }
}

// ---------------------------------------------------------------------------
// Skulls and skeletons

/** Cranium shape on the unit sphere (face toward +Z): sockets, nasal hole, cheekbones, pinched temples. */
function skullDisp(x: number, y: number, z: number) {
  const ax = Math.abs(x);
  const f = smooth(z, 0.1, 0.6);
  let d = 0;
  d -= 0.5 * f * Math.exp(-((ax - 0.36) ** 2) / 0.032 - ((y + 0.06) ** 2) / 0.03);
  d -= 0.38 * f * Math.exp(-(x * x) / 0.01 - ((y + 0.36) ** 2) / 0.018);
  d += 0.08 * f * Math.exp(-((y - 0.15) ** 2) / 0.006 - (x * x) / 0.4);
  d += 0.14 * Math.exp(-((ax - 0.62) ** 2) / 0.015 - ((y + 0.3) ** 2) / 0.012) * smooth(z, -0.3, 0.3);
  d -= 0.12 * Math.exp(-((ax - 0.86) ** 2) / 0.02 - ((y + 0.12) ** 2) / 0.04);
  d += 0.06 * Math.max(0, -z) * smooth(y, -0.4, 0.2);
  d -= 0.55 * Math.max(0, -y - 0.45) * (1 - 0.6 * f);
  d += 0.08 * f * Math.exp(-(x * x) / 0.08 - ((y + 0.62) ** 2) / 0.02);
  return d;
}
const skullCache = new Map<number, THREE.BufferGeometry>();

/**
 * A human skull centred at the origin, face toward +Z (about 0.15 wide and
 * 0.21 tall with the jaw). `jaw` opens the mandible by that many radians;
 * `detail` thins the mesh for heaps. Returned pieces are all bone.
 */
export function skullGeos(jaw = 0.15, detail = 1): THREE.BufferGeometry[] {
  const key = Math.round(detail * 10);
  let cran = skullCache.get(key);
  if (!cran) {
    cran = sculptSphere(0.072, skullDisp, V(0.92, 1, 1.18), Math.max(12, Math.round(38 * detail)), Math.max(9, Math.round(28 * detail)));
    skullCache.set(key, cran);
  }
  const out: THREE.BufferGeometry[] = [cran.clone()];
  const lo = detail < 0.8;
  // Upper teeth on an arc under the maxilla.
  const nT = lo ? 0 : 10;
  for (let i = 0; i < nT; i++) {
    const a = -1.0 + (2.0 * (i + 0.5)) / nT;
    out.push(new THREE.BoxGeometry(0.0085, 0.013, 0.007).translate(Math.sin(a) * 0.027, -0.058, Math.cos(a) * 0.03 + 0.042).rotateY(0));
  }
  // Mandible: a U of bone hinged under the ears.
  const hinge = V(0, -0.03, 0.0);
  const rot = new THREE.Matrix4().makeTranslation(hinge.x, hinge.y, hinge.z).multiply(new THREE.Matrix4().makeRotationX(jaw)).multiply(new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z));
  const jawPts: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const side = [V(s * 0.05, -0.025, -0.005), V(s * 0.047, -0.062, 0.008), V(s * 0.036, -0.078, 0.048), V(s * 0.012, -0.084, 0.074)];
    if (s < 0) jawPts.push(...side);
    else jawPts.push(V(0, -0.086, 0.078), ...side.reverse());
  }
  out.push(taperTube(jawPts, 0.0085, 0.0085, lo ? 12 : 20, lo ? 4 : 6).applyMatrix4(rot));
  out.push(new THREE.BoxGeometry(0.03, 0.022, 0.012).translate(0, -0.08, 0.075).applyMatrix4(rot));
  for (let i = 0; i < nT - 2; i++) {
    const a = -0.9 + (1.8 * (i + 0.5)) / (nT - 2);
    out.push(new THREE.BoxGeometry(0.008, 0.011, 0.006).translate(Math.sin(a) * 0.026, -0.068, Math.cos(a) * 0.028 + 0.04).applyMatrix4(rot));
  }
  return out;
}

type Pose = 'slumped' | 'lying' | 'sitting' | 'hanging';
type SkelPose = Pose | 'stretched' | 'cramped';

/** A long bone from a to b: a tapered shaft with knobbed ends. */
function longBone(b: MeshBuilder, m: THREE.Matrix4, len: number, r: number, knob = 1.7) {
  b.add('bone', new THREE.CylinderGeometry(r * 0.85, r, len, 6).translate(0, -len / 2, 0), m, 3);
  b.add('bone', new THREE.SphereGeometry(r * knob, 7, 5).scale(1.25, 0.9, 1), m, 3);
  b.add('bone', new THREE.SphereGeometry(r * knob, 7, 5).scale(1.35, 0.85, 1).translate(0, -len, 0), m, 3);
}

/**
 * A skeleton built on a small joint hierarchy, posed, then baked into the
 * builder. Shared by `skeleton`, the rack and the cage.
 */
function buildSkeleton(b: MeshBuilder, rng: Rng, pose: SkelPose, at: THREE.Matrix4) {
  const j = (parent: THREE.Object3D, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz, 'YXZ');
    parent.add(o);
    return o;
  };
  const jit = (s: number) => range(rng, -s, s);
  const root = new THREE.Object3D();
  const pelvis = j(root, 0, 0, 0);
  const spine = j(pelvis, 0, 0.04, -0.03);
  const chest = j(spine, 0, 0.2, 0);
  const neck = j(chest, 0, 0.33, -0.015);
  const head = j(neck, 0, 0.08, 0.01);
  const sh: THREE.Object3D[] = [];
  const el: THREE.Object3D[] = [];
  const wr: THREE.Object3D[] = [];
  const hip: THREE.Object3D[] = [];
  const kn: THREE.Object3D[] = [];
  const an: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const S = j(chest, s * 0.18, 0.29, -0.02);
    const E = j(S, 0, -0.3, 0);
    const W = j(E, 0, -0.26, 0);
    sh.push(S);
    el.push(E);
    wr.push(W);
    const H = j(pelvis, s * 0.09, -0.04, 0.01);
    const K = j(H, 0, -0.44, 0);
    const A = j(K, 0, -0.42, 0);
    hip.push(H);
    kn.push(K);
    an.push(A);
  }

  // Poses. Index 0 is the -X side.
  if (pose === 'lying' || pose === 'stretched') {
    root.position.set(0, 0.11, 0);
    root.rotation.set(-Math.PI / 2, 0, jit(0.05));
    head.rotation.set(jit(0.2), range(rng, 0.4, 0.8) * (rng() < 0.5 ? -1 : 1), 0);
    spine.rotation.set(0, 0, jit(0.08));
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      if (pose === 'stretched') {
        sh[i].rotation.set(Math.PI, 0, -s * 0.18);
        el[i].rotation.set(0, 0, jit(0.05));
        hip[i].rotation.set(0, 0, s * 0.06);
        an[i].rotation.set(-1.0, 0, 0);
      } else {
        sh[i].rotation.set(jit(0.15), 0, s * range(rng, 0.15, 0.6));
        el[i].rotation.set(range(rng, -0.6, 0), 0, 0);
        hip[i].rotation.set(jit(0.05), 0, s * range(rng, 0.03, 0.2));
        kn[i].rotation.set(range(rng, 0, 0.15), 0, 0);
        an[i].rotation.set(-1.0, s * 0.5, 0);
      }
    }
  } else if (pose === 'sitting') {
    root.position.set(0, 0.5, -0.05);
    spine.rotation.set(-0.08, 0, jit(0.06));
    chest.rotation.set(0.12, jit(0.1), 0);
    head.rotation.set(range(rng, 0.4, 0.8), jit(0.3), range(rng, 0.15, 0.4) * (rng() < 0.5 ? -1 : 1));
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      sh[i].rotation.set(-0.35 + jit(0.1), 0, s * 0.12);
      el[i].rotation.set(-0.9 + jit(0.15), 0, 0);
      hip[i].rotation.set(-Math.PI / 2 + jit(0.05), 0, s * range(rng, 0.04, 0.12));
      kn[i].rotation.set(Math.PI / 2 + jit(0.1), 0, 0);
      an[i].rotation.set(-1.2, 0, 0);
    }
  } else if (pose === 'slumped' || pose === 'cramped') {
    root.position.set(0, 0.1, -0.12);
    spine.rotation.set(-0.3, 0, jit(0.1));
    chest.rotation.set(0.35, jit(0.15), jit(0.08));
    neck.rotation.set(0.3, 0, 0);
    head.rotation.set(range(rng, 0.5, 0.9), jit(0.4), range(rng, 0.2, 0.5) * (rng() < 0.5 ? -1 : 1));
    const upKnee = pose === 'cramped' ? -1 : rng() < 0.5 ? 0 : 1;
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      sh[i].rotation.set(-0.25 + jit(0.15), 0, s * range(rng, 0.25, 0.45));
      el[i].rotation.set(-0.5 + jit(0.2), 0, 0);
      if (i === upKnee || upKnee < 0) {
        hip[i].rotation.set(-2.1, 0, s * 0.2);
        kn[i].rotation.set(2.0, 0, 0);
      } else {
        hip[i].rotation.set(-1.62, s * 0.2, s * range(rng, 0.15, 0.35));
        kn[i].rotation.set(range(rng, 0.1, 0.35), 0, 0);
      }
      an[i].rotation.set(-1.1, s * 0.3, 0);
    }
  } else {
    // Hanging by the wrists from two chains, arms up in a V, legs dangling.
    root.position.set(0, 1.12, 0);
    root.rotation.set(jit(0.04), jit(0.3), jit(0.04));
    head.rotation.set(range(rng, 0.6, 0.9), jit(0.3), range(rng, 0.2, 0.45) * (rng() < 0.5 ? -1 : 1));
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1;
      sh[i].rotation.set(Math.PI, 0, -s * 0.32);
      el[i].rotation.set(0.05, 0, s * 0.05);
      wr[i].rotation.set(-0.3, 0, 0);
      hip[i].rotation.set(jit(0.15), 0, s * 0.05);
      kn[i].rotation.set(range(rng, 0.05, 0.3), 0, 0);
      an[i].rotation.set(-0.3, 0, 0);
    }
  }
  root.updateMatrixWorld(true);
  const M = (o: THREE.Object3D, local?: THREE.Matrix4) => {
    const m = at.clone().multiply(o.matrixWorld);
    return local ? m.multiply(local) : m;
  };

  // Pelvis: a basin of bone open at the front (flared hip wings), sacrum, pubic arch.
  const basin = [
    [0.1, 0.07],
    [0.085, 0.0],
    [0.06, -0.05],
    [0.05, -0.045],
    [0.072, 0.0],
    [0.088, 0.065],
    [0.1, 0.07],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  b.add('bone', new THREE.LatheGeometry(basin, 14, 0.7, Math.PI * 2 - 1.4).scale(1.15, 1, 0.75), M(pelvis, xf(0, 0.0, -0.01)), 3);
  b.add('bone', new THREE.ConeGeometry(0.04, 0.11, 6).rotateX(Math.PI).scale(1, 1, 0.6), M(pelvis, xf(0, 0.0, -0.05, 0, 1, 1, 1, -0.3)), 3);
  b.add('bone', new THREE.TorusGeometry(0.06, 0.012, 4, 10, Math.PI).rotateZ(Math.PI).rotateX(-0.4), M(pelvis, xf(0, -0.035, 0.03)), 3);
  // Spine: lumbar vertebrae up to the ribcage, cervical up to the skull.
  for (let i = 0; i < 5; i++) {
    const m = M(spine, xf(0, i * 0.042, 0));
    b.add('bone', new THREE.CylinderGeometry(0.02, 0.021, 0.026, 7), m, 3);
    b.add('bone', new THREE.BoxGeometry(0.012, 0.016, 0.035).translate(0, 0, -0.03), m, 3);
  }
  for (let i = 0; i < 9; i++) b.add('bone', new THREE.CylinderGeometry(0.014, 0.015, 0.022, 6), M(chest, xf(0, 0.02 + i * 0.033, -0.06 - Math.sin((i / 8) * Math.PI) * 0.012)), 3);
  for (let i = 0; i < 3; i++) b.add('bone', new THREE.CylinderGeometry(0.012, 0.013, 0.02, 6), M(neck, xf(0, i * 0.027, 0)), 3);
  // Ribcage: rib pairs sweeping round from the spine and down to the sternum.
  for (let i = 0; i < 7; i++) {
    const y = 0.27 - i * 0.034;
    const w = 0.09 + 0.04 * Math.sin((Math.PI * (i + 1.5)) / 8.5);
    const d = 0.085 + 0.01 * Math.sin((Math.PI * (i + 1)) / 8);
    const end = i < 5 ? 0.38 : 1.0 + (i - 5) * 0.5;
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = Math.PI - 0.12 - ((Math.PI - 0.12 - end) * k) / 6;
        const drop = 0.07 * (1 - (t - end) / (Math.PI - end));
        pts.push(V(s * w * Math.sin(t), y - drop, d * Math.cos(t) - 0.005));
      }
      b.add('bone', taperTube(pts, 0.0075, 0.0055, 10, 4), M(chest), 3);
    }
  }
  b.add('bone', new THREE.BoxGeometry(0.026, 0.17, 0.012), M(chest, xf(0, 0.19, 0.088, 0, 1, 1, 1, -0.15)), 3);
  for (const s of [-1, 1]) {
    // Collarbone and shoulder blade.
    b.add('bone', taperTube([V(0.0, 0.29, 0.07), V(s * 0.09, 0.305, 0.05), V(s * 0.17, 0.3, -0.01)], 0.008, 0.008, 6, 4), M(chest), 3);
    b.add('bone', new THREE.SphereGeometry(0.07, 7, 5).scale(0.75, 1, 0.12), M(chest, xf(s * 0.1, 0.21, -0.095, s * 0.35)), 3);
  }
  // Skull.
  for (const g of skullGeos(pose === 'hanging' || pose === 'stretched' ? range(rng, 0.25, 0.45) : range(rng, 0.05, 0.4))) b.add('bone', g, M(head, xf(0, 0.075, 0.02)), 3);
  // Arms, hands, legs, feet.
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1;
    longBone(b, M(sh[i]), 0.3, 0.013);
    b.add('bone', new THREE.CylinderGeometry(0.008, 0.01, 0.26, 5).translate(0, -0.13, 0), M(el[i], xf(0.012, 0, 0)), 3);
    b.add('bone', new THREE.CylinderGeometry(0.008, 0.009, 0.26, 5).translate(0, -0.13, 0), M(el[i], xf(-0.012, 0, 0)), 3);
    b.add('bone', new THREE.BoxGeometry(0.05, 0.06, 0.018).translate(0, -0.035, 0), M(wr[i]), 3);
    for (let f = 0; f < 5; f++) {
      const fx = (f - 2) * 0.012 * s;
      const curl = pose === 'hanging' ? 0.9 : range(rng, 0.2, 1.0);
      const thumb = f === 0;
      const p0 = thumb ? V(-s * 0.03, -0.03, 0.01) : V(fx, -0.065, 0);
      const l = thumb ? 0.045 : 0.07 - Math.abs(f - 2) * 0.008;
      b.add('bone', taperTube([p0, p0.clone().add(V(thumb ? -s * 0.015 : 0, -l * 0.55, l * 0.15 * curl)), p0.clone().add(V(thumb ? -s * 0.02 : 0, -l * (1 - 0.25 * curl), l * 0.55 * curl))], 0.0045, 0.003, 4, 4), M(wr[i]), 3);
    }
    longBone(b, M(hip[i]), 0.44, 0.017, 1.6);
    b.add('bone', new THREE.SphereGeometry(0.02, 6, 4), M(hip[i], xf(-s * 0.02, 0.01, 0)), 3);
    b.add('bone', new THREE.SphereGeometry(0.018, 6, 4).scale(1, 1, 0.6), M(kn[i], xf(0, 0.005, 0.03)), 3);
    b.add('bone', new THREE.CylinderGeometry(0.012, 0.016, 0.42, 6).translate(0, -0.21, 0), M(kn[i]), 3);
    b.add('bone', new THREE.CylinderGeometry(0.006, 0.007, 0.4, 5).translate(0, -0.2, 0), M(kn[i], xf(s * 0.022, 0, -0.005)), 3);
    // Foot: heel and five metatarsals forward along local +Z after the ankle flex.
    b.add('bone', new THREE.SphereGeometry(0.025, 6, 5).scale(1, 0.9, 1.3), M(an[i], xf(0, -0.02, -0.015)), 3);
    for (let t = 0; t < 5; t++) {
      const tx = (t - 2) * 0.014;
      const l = 0.11 - Math.abs(t - 1) * 0.012;
      b.add('bone', new THREE.CylinderGeometry(0.0045, 0.006, l, 4).rotateX(Math.PI / 2).translate(tx, -0.03, l / 2), M(an[i]), 3);
    }
  }
  return { wrists: wr.map((w) => V(0, -0.07, 0).applyMatrix4(M(w))), ankles: an.map((a) => V(0, -0.02, 0).applyMatrix4(M(a))) };
}

/** Height of the hook ring the hanging skeleton's chains rise to. */
export const SKELETON_HANG_TOP = 2.55;

/**
 * A full human skeleton (about 1.75 m standing). Poses:
 * 'slumped' sits on the floor leaning back against something at -Z, head
 * lolling; 'lying' lies on its back, head toward -Z; 'sitting' sits upright
 * on a seat 0.45 m high (supply the seat); 'hanging' dangles by the wrists
 * from shackles whose chains rise to SKELETON_HANG_TOP (attach them there).
 * Footprint: slumped 0.35 x 0.45, lying 0.4 x 0.95, sitting 0.3 x 0.45,
 * hanging 0.3 x 0.3.
 */
export function skeleton(rng: Rng, pose: Pose): MeshBuilder {
  const b = new MeshBuilder();
  const { wrists } = buildSkeleton(b, rng, pose, new THREE.Matrix4());
  if (pose === 'hanging') {
    for (const w of wrists) {
      b.add('rust', new THREE.TorusGeometry(0.035, 0.011, 5, 12).rotateX(Math.PI / 2), xf(w.x, w.y + 0.02, w.z), 3);
      chain(b, 'iron', V(w.x, w.y + 0.06, w.z), V(w.x * 0.4, SKELETON_HANG_TOP - 0.05, 0), 0.04);
    }
    b.add('rust', new THREE.TorusGeometry(0.05, 0.012, 5, 14), xf(0, SKELETON_HANG_TOP, 0), 3);
  }
  // A dark stain and a few dropped finger bones under it.
  if (pose !== 'hanging') splat(b, rng, range(rng, -0.1, 0.1), 0.004, range(rng, -0.1, 0.1), range(rng, 0.25, 0.4));
  else splat(b, rng, 0, 0.004, 0, 0.3);
  return b;
}

// ---------------------------------------------------------------------------
// Cages, racks, stocks, chairs, gallows

/** Height of the hanging cage's floor above the ground. */
export const CAGE_FLOOR_Y = 1.0;

/**
 * A gibbet cage: a barrel of round bars on an iron floor, a domed top of bent
 * bars under a hanging ring, and a chain up to height `top`. Its floor hangs
 * 1.0 m above the ground; optionally a slumped skeleton sits inside.
 * Footprint 0.5 x 0.5 (only if the space under it should be blocked).
 */
export function hangingCage(rng: Rng, opts: { top: number; skeleton?: boolean }): MeshBuilder {
  const b = new MeshBuilder();
  const R = 0.44;
  const H = 1.3;
  const y0 = CAGE_FLOOR_Y;
  const tilt = xf(0, 0, 0, rng() * 6.28, 1, 1, 1, range(rng, -0.04, 0.04), range(rng, -0.04, 0.04));
  const c = new MeshBuilder();
  // Floor plate and rim band, middle bands, top band.
  c.add('iron', new THREE.CylinderGeometry(R, R - 0.03, 0.04, 20), xf(0, y0, 0), 2);
  for (const [y, h] of [
    [y0 + 0.03, 0.06],
    [y0 + H * 0.5, 0.04],
    [y0 + H, 0.05],
  ]) {
    const pts = [V(R - 0.01, -h / 2, 0), V(R + 0.015, -h / 2, 0), V(R + 0.015, h / 2, 0), V(R - 0.01, h / 2, 0), V(R - 0.01, -h / 2, 0)].map((p) => new THREE.Vector2(p.x, p.y));
    c.add(y === y0 + H * 0.5 ? 'rust' : 'iron', new THREE.LatheGeometry(pts, 24), xf(0, y, 0), 2);
  }
  // Vertical bars, a couple bent outward, then the dome straps meeting at the ring.
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const bend = rng() < 0.18 ? range(rng, 0.05, 0.12) : 0;
    const p0 = V(Math.cos(a) * R, y0, Math.sin(a) * R);
    const p2 = V(Math.cos(a) * R, y0 + H, Math.sin(a) * R);
    const p1 = V(Math.cos(a) * (R + bend), y0 + H * 0.5, Math.sin(a) * (R + bend));
    c.add(rng() < 0.3 ? 'rust' : 'iron', taperTube([p0, p1, p2], 0.012, 0.012, bend ? 8 : 2, 5), undefined, 3);
    if (i % 2 === 0) {
      const dome: THREE.Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const t = (k / 6) * (Math.PI / 2);
        const r = Math.cos(t) * R;
        dome.push(V(Math.cos(a) * r, y0 + H + Math.sin(t) * 0.36, Math.sin(a) * r));
      }
      c.add('iron', taperTube(dome, 0.018, 0.016, 10, 5), undefined, 3);
    }
  }
  // Rivets where bars meet the bands.
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const y of [y0 + 0.03, y0 + H * 0.5, y0 + H]) c.add('rust', new THREE.SphereGeometry(0.014, 5, 4), xf(Math.cos(a) * (R + 0.017), y, Math.sin(a) * (R + 0.017)), 3);
  }
  // Door: hinge knuckles and a hasp on one side.
  c.add('rust', new THREE.BoxGeometry(0.03, 0.1, 0.06), xf(R + 0.02, y0 + H * 0.5, 0), 3);
  c.add('iron', new THREE.TorusGeometry(0.035, 0.008, 4, 10), xf(R + 0.04, y0 + H * 0.5 - 0.07, 0, Math.PI / 2), 3);
  // Top ring and the chain.
  const topY = y0 + H + 0.36;
  c.add('iron', new THREE.SphereGeometry(0.05, 8, 6).scale(1, 0.6, 1), xf(0, topY, 0), 3);
  c.add('rust', new THREE.TorusGeometry(0.06, 0.015, 5, 14), xf(0, topY + 0.09, 0), 3);
  if (opts.skeleton) {
    // Squeezed in on the cage floor, its back to the bars.
    buildSkeleton(c, rng, 'cramped', xf(0, y0 + 0.02, 0.0, rng() * 6.28, 0.88));
  }
  // Blood dripping through the floor.
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    const r = range(rng, 0.05, R - 0.08);
    const len = range(rng, 0.04, 0.16);
    c.add('gore', taperTube([V(Math.cos(a) * r, y0 - 0.02, Math.sin(a) * r), V(Math.cos(a) * r, y0 - 0.02 - len, Math.sin(a) * r)], 0.008, 0.004, 2, 4), undefined, 3);
  }
  b.addBuilder(c, tilt);
  chain(b, 'iron', V(0, topY + 0.15, 0), V(0, opts.top, 0), 0.06);
  splat(b, rng, range(rng, -0.1, 0.1), 0.004, range(rng, -0.1, 0.1), range(rng, 0.2, 0.35));
  return b;
}

/** A spoked hand wheel in the YZ plane (axle along X). */
function handWheel(b: MeshBuilder, m: THREE.Matrix4, r: number) {
  b.add('wood', new THREE.TorusGeometry(r, 0.03, 6, 20).rotateY(Math.PI / 2), m, 2);
  b.add('iron', new THREE.TorusGeometry(r + 0.022, 0.01, 4, 24).rotateY(Math.PI / 2), m, 2);
  b.add('wood', new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10).rotateZ(Math.PI / 2), m, 2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add('wood', new THREE.CylinderGeometry(0.018, 0.022, r, 5).translate(0, r / 2, 0).rotateX(a), m, 2);
    // Handles poking out past the rim.
    b.add('wood', new THREE.CylinderGeometry(0.02, 0.024, 0.16, 5).translate(0, r + 0.08, 0).rotateX(a), m, 2);
  }
}

/**
 * Torture rack: a heavy wooden frame table with a ladder of rungs, rollers at
 * both ends turned by spoked wheels, ropes wound on them, and optionally a
 * skeleton stretched out between them. Long axis along X, about 2.8 m long.
 * Footprint 1.45 x 0.65.
 */
export function rack(rng: Rng, body = true): MeshBuilder {
  const b = new MeshBuilder();
  const L = 2.7;
  const W = 0.86;
  const top = 0.74;
  // Legs, rails, stretchers.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add('wood', new THREE.BoxGeometry(0.13, top + 0.12, 0.13), xf(sx * (L / 2 - 0.08), (top + 0.12) / 2, sz * (W / 2 - 0.02), range(rng, -0.02, 0.02)), 1.5);
      b.add('rust', new THREE.BoxGeometry(0.14, 0.04, 0.14), xf(sx * (L / 2 - 0.08), top - 0.12, sz * (W / 2 - 0.02)), 2);
    }
  }
  for (const sz of [-1, 1]) {
    b.add('wood', new THREE.BoxGeometry(L + 0.12, 0.14, 0.11), xf(0, top, sz * (W / 2 - 0.02)), 1.5);
    b.add('wood', new THREE.BoxGeometry(L - 0.2, 0.08, 0.08), xf(0, 0.18, sz * (W / 2 - 0.02)), 1.5);
    // Iron straps and studs along the rails.
    for (let x = -L / 2 + 0.3; x < L / 2 - 0.2; x += 0.42) {
      b.add('iron', new THREE.BoxGeometry(0.05, 0.15, 0.118), xf(x, top, sz * (W / 2 - 0.02)), 2);
    }
  }
  for (const sx of [-1, 1]) b.add('wood', new THREE.BoxGeometry(0.08, 0.08, W), xf(sx * (L / 2 - 0.08), 0.18, 0), 1.5);
  // Ladder of round rungs the victim lies on.
  for (let x = -L / 2 + 0.38; x <= L / 2 - 0.38; x += 0.17) {
    b.add('wood', new THREE.CylinderGeometry(0.028, 0.028, W - 0.06, 6).rotateX(Math.PI / 2), xf(x + range(rng, -0.01, 0.01), top + 0.07, 0), 2);
  }
  // Rollers at the ends, through the rails, with wheels on the +Z side.
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.2);
    b.add('wood', new THREE.CylinderGeometry(0.075, 0.075, W + 0.2, 10).rotateX(Math.PI / 2), xf(x, top + 0.05, 0), 2);
    for (const z of [-0.2, 0.2]) b.add('iron', new THREE.CylinderGeometry(0.08, 0.08, 0.025, 12).rotateX(Math.PI / 2), xf(x, top + 0.05, z), 2);
    handWheel(b, xf(x, top + 0.05, W / 2 + 0.16, Math.PI / 2), 0.3);
    // Pawl and ratchet teeth.
    b.add('iron', new THREE.BoxGeometry(0.03, 0.18, 0.025), xf(x - sx * 0.1, top + 0.1, W / 2 + 0.06, 0, 1, 1, 1, 0, sx * 0.5), 2);
  }
  // The victim and ropes from wrists and ankles to the rollers.
  const hx = -(L / 2 - 0.2); // head end roller
  let ends: THREE.Vector3[] = [];
  if (body) {
    const m = xf(0.05, top + 0.105, 0, Math.PI / 2);
    const { wrists, ankles } = buildSkeleton(b, rng, 'stretched', m);
    ends = [...wrists, ...ankles];
  } else {
    ends = [V(-0.55, top + 0.06, -0.12), V(-0.6, top + 0.06, 0.15), V(0.5, top + 0.06, -0.1), V(0.55, top + 0.06, 0.12)];
  }
  for (const e of ends) {
    const rx = e.x < 0 ? hx : -hx;
    const r0 = V(rx + (e.x < 0 ? 0.06 : -0.06), top + 0.11, e.z * 0.8);
    b.add('rope', taperTube([e, e.clone().lerp(r0, 0.5).add(V(0, 0.01, 0)), r0], 0.011, 0.011, 6, 5), undefined, 3);
    // Loops round the wrist or ankle and coils on the roller.
    b.add('rope', new THREE.TorusGeometry(0.03, 0.009, 4, 10).rotateY(Math.PI / 2), xf(e.x, e.y, e.z), 3);
    for (let k = 0; k < 3; k++) b.add('rope', new THREE.TorusGeometry(0.083, 0.011, 4, 14), xf(rx, top + 0.05, e.z * 0.8 + (k - 1) * 0.024, 0, 1, 1, 1, 0, 0), 3);
  }
  // Blood soaked into the rungs and pooled below.
  splat(b, rng, range(rng, -0.2, 0.3), 0.004, range(rng, -0.15, 0.15), range(rng, 0.35, 0.5));
  for (const sz of [-1, 1]) for (let i = 0; i < 2; i++) splat(b, rng, range(rng, -0.8, 0.8), top + 0.072, sz * (W / 2 - 0.02), range(rng, 0.03, 0.05));
  return b;
}

/** A board with semicircular notches along its joining edge, extruded along Z. */
function notchedBoard(w: number, h: number, depth: number, notches: [number, number][], upper: boolean): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const sg = upper ? 1 : -1;
  s.moveTo(-w / 2, 0);
  for (const [x, r] of notches) {
    s.lineTo(x - r, 0);
    // Upper board: notch arcs up into it; lower: down.
    if (upper) s.absarc(x, 0, r, Math.PI, 0, true);
    else s.absarc(x, 0, r, Math.PI, Math.PI * 2, false);
  }
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, sg * h);
  s.lineTo(-w / 2, sg * h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 10 });
  return g.translate(0, 0, -depth / 2);
}

/**
 * Pillory stocks: two posts on cross feet holding a split board with holes
 * for the neck and wrists, iron hinge and hasp. Board faces +Z.
 * Footprint 0.75 x 0.35.
 */
export function stocks(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const by = 1.32;
  for (const sx of [-1, 1]) {
    const x = sx * 0.62;
    b.add('wood', new THREE.BoxGeometry(0.13, 1.72, 0.14), xf(x, 0.86, 0, range(rng, -0.02, 0.02)), 1.5);
    b.add('wood', new THREE.BoxGeometry(0.16, 0.12, 0.7), xf(x, 0.06, 0), 1.5);
    // Diagonal braces from foot to post.
    for (const sz of [-1, 1]) b.add('wood', new THREE.BoxGeometry(1, 1, 1), along(V(x, 0.1, sz * 0.3), V(x, 0.5, sz * 0.06), 0.065, 0.065), 1.5);
    b.add('iron', new THREE.BoxGeometry(0.15, 0.05, 0.16), xf(x, by + 0.26, 0), 2);
  }
  b.add('wood', new THREE.BoxGeometry(1.5, 0.12, 0.18), xf(0, 1.78, 0), 1.5);
  const notches: [number, number][] = [
    [-0.34, 0.055],
    [0, 0.1],
    [0.34, 0.055],
  ];
  b.add('wood', notchedBoard(1.12, 0.21, 0.09, notches, true), xf(0, by + 0.005, 0), 1.5);
  b.add('wood', notchedBoard(1.12, 0.21, 0.09, notches, false), xf(0, by - 0.005, 0), 1.5);
  // Iron hinge straps on one end, hasp and padlock on the other.
  b.add('iron', new THREE.BoxGeometry(0.18, 0.05, 0.1), xf(-0.48, by + 0.08, 0.005), 2);
  b.add('iron', new THREE.BoxGeometry(0.18, 0.05, 0.1), xf(-0.48, by - 0.08, 0.005), 2);
  b.add('rust', new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6), xf(-0.56, by, 0.055), 2);
  b.add('rust', new THREE.BoxGeometry(0.05, 0.2, 0.02), xf(0.5, by, 0.055), 2);
  b.add('iron', new THREE.BoxGeometry(0.06, 0.07, 0.03), xf(0.5, by - 0.13, 0.06), 2);
  b.add('iron', new THREE.TorusGeometry(0.022, 0.006, 4, 10, Math.PI), xf(0.5, by - 0.095, 0.06), 2);
  // Blood on the board edge and stained ground under the holes.
  for (const [x] of notches) b.add('gore', taperTube([V(x, by - 0.06, 0.05), V(x + 0.005, by - 0.14, 0.052), V(x, by - 0.2, 0.05)], 0.008, 0.005, 4, 4), undefined, 3);
  splat(b, rng, 0, 0.004, 0.25, 0.3);
  return b;
}

/**
 * Interrogation chair: an iron seat, back, arms and legs bristling with
 * spikes, leather straps at the wrists and chest, cuffs at the ankles.
 * Faces +Z. Footprint 0.4 x 0.4.
 */
export function spikedChair(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const sw = 0.56;
  const seatY = 0.5;
  // Frame: square legs, seat plate, reclined back, arms.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.add('iron', new THREE.BoxGeometry(0.05, seatY, 0.05), xf(sx * (sw / 2 - 0.02), seatY / 2, sz * 0.25), 2);
    b.add('iron', new THREE.BoxGeometry(0.04, 0.04, 0.54), xf(sx * (sw / 2 - 0.02), 0.12, 0), 2);
  }
  b.add('iron', new THREE.BoxGeometry(sw, 0.05, 0.56), xf(0, seatY, 0), 2);
  const back = xf(0, seatY, -0.27, 0, 1, 1, 1, -0.12);
  b.add('iron', new THREE.BoxGeometry(sw, 0.95, 0.05).translate(0, 0.475, 0), back, 2);
  for (const sx of [-1, 1]) b.add('rust', new THREE.BoxGeometry(0.06, 1.05, 0.07).translate(sx * (sw / 2), 0.5, 0), back, 2);
  b.add('rust', new THREE.BoxGeometry(sw + 0.1, 0.07, 0.08).translate(0, 0.98, 0), back, 2);
  for (const sx of [-1, 1]) {
    b.add('iron', new THREE.BoxGeometry(0.09, 0.04, 0.5), xf(sx * (sw / 2 + 0.03), seatY + 0.26, 0), 2);
    b.add('iron', new THREE.BoxGeometry(0.04, 0.26, 0.04), xf(sx * (sw / 2 + 0.03), seatY + 0.13, 0.2), 2);
  }
  // Foot board.
  b.add('iron', new THREE.BoxGeometry(sw, 0.03, 0.18), xf(0, 0.1, 0.36), 2);
  // Spikes: a bed of them over every surface a body would touch.
  const sp = (p: THREE.Vector3, dir: THREE.Vector3, m?: THREE.Matrix4) => {
    const q = m ? p.clone().applyMatrix4(m) : p;
    const d = m ? dir.clone().transformDirection(m) : dir;
    spikeAt(b, rng() < 0.4 ? 'rust' : 'iron', q, d, range(rng, 0.06, 0.085), 0.01, rng() < 0.15 ? 'gore' : undefined);
  };
  for (let i = 0; i < 7; i++) for (let k = 0; k < 7; k++) sp(V(-0.22 + i * 0.073 + (k % 2) * 0.03, seatY + 0.025, -0.22 + k * 0.073), V(0, 1, 0));
  for (let i = 0; i < 7; i++) for (let k = 0; k < 11; k++) sp(V(-0.22 + i * 0.073 + (k % 2) * 0.03, 0.08 + k * 0.08, 0.025), V(0, 0, 1), back);
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 7; k++) sp(V(sx * (sw / 2 + 0.03), seatY + 0.28, -0.21 + k * 0.07), V(0, 1, 0));
    for (let k = 0; k < 4; k++) sp(V(sx * (sw / 2 - 0.02), 0.12 + k * 0.1, 0.275), V(0, 0, 1));
  }
  for (let i = 0; i < 6; i++) sp(V(-0.2 + i * 0.08, 0.115, 0.36), V(0, 1, 0.3));
  // Straps: wrists, chest, and iron cuffs on the front legs.
  for (const sx of [-1, 1]) {
    b.add('cloth', new THREE.BoxGeometry(0.13, 0.03, 0.06), xf(sx * (sw / 2 + 0.03), seatY + 0.31, 0.05), 3);
    b.add('rust', new THREE.BoxGeometry(0.025, 0.034, 0.03), xf(sx * (sw / 2 + 0.03) + sx * 0.06, seatY + 0.31, 0.05), 3);
    b.add('rust', new THREE.TorusGeometry(0.05, 0.012, 4, 12).rotateX(Math.PI / 2), xf(sx * (sw / 2 - 0.02), 0.2, 0.25), 3);
  }
  b.add('cloth', new THREE.BoxGeometry(sw + 0.04, 0.07, 0.02).translate(0, 0.66, 0.085), back, 3);
  b.add('cloth', new THREE.BoxGeometry(0.05, 0.25, 0.012).translate(sw / 2 - 0.02, 0.5, 0.1), back, 3);
  b.add('rust', new THREE.BoxGeometry(0.05, 0.05, 0.02).translate(0, 0.66, 0.1), back, 3);
  splat(b, rng, 0, 0.004, 0.15, 0.32);
  splat(b, rng, range(rng, -0.1, 0.1), seatY + 0.028, 0, 0.12);
  return b;
}

/**
 * The gallows frame: two wooden A-frames on sills joined by a ridge beam, a
 * cross brace, iron brackets, and a chain with a meat hook hanging from the
 * middle of the beam. Beam along X, about 2.3 m tall. Footprint 0.95 x 0.6.
 */
export function gibbet(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const H = 2.3;
  const half = 0.82;
  const spread = 0.52;
  for (const sx of [-1, 1]) {
    const x = sx * half;
    b.add('wood', new THREE.BoxGeometry(0.16, 0.12, spread * 2 + 0.3), xf(x, 0.06, 0), 1.5);
    for (const sz of [-1, 1]) {
      const foot = V(x, 0.1, sz * spread);
      const apex = V(x, H - 0.05, sz * 0.03);
      b.add('wood', new THREE.BoxGeometry(1, 1, 1), along(foot, apex, 0.12, 0.11), 1.5);
    }
    b.add('wood', new THREE.BoxGeometry(0.09, 0.09, spread * 1.1), xf(x, 0.9, 0), 1.5);
    b.add('iron', new THREE.BoxGeometry(0.18, 0.2, 0.18), xf(x, H - 0.09, 0), 2);
    for (const sz of [-1, 1]) b.add('rust', new THREE.SphereGeometry(0.018, 5, 4), xf(x + sx * 0.09, H - 0.09, sz * 0.05), 3);
  }
  b.add('wood', new THREE.BoxGeometry(half * 2 + 0.5, 0.15, 0.14), xf(0, H + 0.02, 0, range(rng, -0.02, 0.02)), 1.5);
  // Diagonal brace from one leg up to the beam.
  b.add('wood', new THREE.BoxGeometry(1, 1, 1), along(V(-half, 1.35, 0.05), V(-0.2, H - 0.05, 0.05), 0.08, 0.07), 1.5);
  // Chain and hook.
  const hx = range(rng, -0.1, 0.25);
  b.add('iron', new THREE.TorusGeometry(0.05, 0.012, 5, 12).rotateY(Math.PI / 2), xf(hx, H - 0.08, 0), 3);
  const drop = range(rng, 0.7, 1.0);
  chain(b, 'iron', V(hx, H - 0.13, 0), V(hx, H - 0.13 - drop, 0), 0.045);
  const hy = H - 0.16 - drop;
  b.add('rust', taperTube([V(hx, hy, 0), V(hx, hy - 0.12, 0), V(hx + 0.02, hy - 0.2, 0.06), V(hx, hy - 0.2, 0.13), V(hx - 0.01, hy - 0.14, 0.15)], 0.014, 0.006, 10, 5), undefined, 3);
  b.add('gore', new THREE.SphereGeometry(0.03, 6, 4).scale(1, 1.6, 1), xf(hx, hy - 0.2, 0.08), 3);
  splat(b, rng, hx, 0.004, 0.05, 0.3);
  return b;
}

// ---------------------------------------------------------------------------
// Candles, tools, bars, bones, fire, blood

/**
 * A cluster of `n` melted candles of mixed heights standing in a shared
 * puddle of wax, with drips down their sides and small flames on the wicks.
 * Footprint about 0.06 + 0.04 n each way (decorative; usually not blocked).
 */
export function candles(rng: Rng, n: number): MeshBuilder {
  const b = new MeshBuilder();
  const spread = 0.04 + 0.035 * Math.sqrt(n);
  const placed: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let z = 0;
    const r = range(rng, 0.018, 0.04);
    for (let t = 0; t < 12; t++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * spread;
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
      if (placed.every(([px, pz, pr]) => Math.hypot(px - x, pz - z) > pr + r + 0.008)) break;
    }
    placed.push([x, z, r]);
    const h = range(rng, 0.05, 0.32) * (i === 0 ? 1.2 : 1);
    // Body: a lathed stub, flared at the foot, with a melted cup at the top.
    const prof = [
      [0, 0],
      [r * 1.5, 0],
      [r * 1.12, 0.012],
      [r, 0.03],
      [r * range(rng, 0.97, 1.03), h * 0.6],
      [r, h - 0.006],
      [r * 1.04, h],
      [r * 0.75, h - 0.006],
      [0.001, h - 0.012],
    ].map(([a, c]) => new THREE.Vector2(a, c));
    const body = new THREE.LatheGeometry(prof, 12);
    // A lopsided rim: melt one side lower.
    const pos = body.getAttribute('position') as THREE.BufferAttribute;
    const ml = rng() * Math.PI * 2;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      if (y > h * 0.8) {
        const a = Math.atan2(pos.getX(k), pos.getZ(k));
        pos.setY(k, y - 0.012 * Math.max(0, Math.cos(a - ml)) * ((y - h * 0.8) / (h * 0.2)));
      }
    }
    body.computeVertexNormals();
    b.add('wax', body, xf(x, 0, z), 4);
    // Drips: runs of wax down the side ending in a bead.
    const nd = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < nd; k++) {
      const a = ml + range(rng, -0.9, 0.9);
      const len = Math.min(h - 0.02, range(rng, 0.03, 0.14));
      const top = h - 0.004;
      const p0 = V(x + Math.sin(a) * r * 1.02, top, z + Math.cos(a) * r * 1.02);
      const p1 = V(x + Math.sin(a) * r * 1.06, top - len, z + Math.cos(a) * r * 1.06);
      b.add('wax', taperTube([p0, p0.clone().lerp(p1, 0.5), p1], 0.0045, 0.006, 4, 5), undefined, 4);
      b.add('wax', new THREE.SphereGeometry(0.0075, 6, 4).scale(1, 1.3, 1), xf(p1.x, p1.y, p1.z), 4);
    }
    // Wick and flame.
    const wy = h - 0.012;
    b.add('iron', new THREE.CylinderGeometry(0.0015, 0.0018, 0.016, 4), xf(x, wy + 0.008, z), 4);
    const fh = range(rng, 0.03, 0.05);
    const flame = new THREE.LatheGeometry(
      [
        [0, 0],
        [0.006, 0.004],
        [0.0085, fh * 0.3],
        [0.006, fh * 0.65],
        [0, fh],
      ].map(([a, c]) => new THREE.Vector2(a, c)),
      8,
    );
    b.add('flame', flame, xf(x, wy + 0.012, z, 0, 1, 1, 1, range(rng, -0.12, 0.12), range(rng, -0.12, 0.12)), 0);
  }
  // Shared puddle with lumps of spilled wax.
  b.add('wax', new THREE.CylinderGeometry(spread + 0.05, spread + 0.07, 0.008, 18).scale(1, 1, range(rng, 0.75, 1)), xf(0, 0.004, 0, rng() * 6), 4);
  for (let i = 0; i < 5 + n; i++) {
    const a = rng() * Math.PI * 2;
    const d = range(rng, 0.2, 1.1) * (spread + 0.04);
    b.add('wax', new THREE.SphereGeometry(range(rng, 0.012, 0.03), 7, 4).scale(1, 0.3, 1), xf(Math.cos(a) * d, 0.008, Math.sin(a) * d), 4);
  }
  return b;
}

/** Bucket: wooden staves bound with iron hoops, full of `fill` to near the brim. */
function bucket(b: MeshBuilder, m: THREE.Matrix4, r: number, h: number, fill: string) {
  const prof = [
    [0, 0.01],
    [r * 0.82, 0.01],
    [r * 0.82, 0],
    [r, h],
    [r * 0.93, h],
    [r * 0.76, 0.03],
    [0, 0.03],
  ].map(([a, c]) => new THREE.Vector2(a, c));
  b.add('wood', new THREE.LatheGeometry(prof, 16), m, 3);
  for (const t of [0.18, 0.82]) {
    const rr = r * 0.82 + (r - r * 0.82) * t + 0.006;
    b.add('iron', new THREE.TorusGeometry(rr, 0.008, 4, 18).rotateX(Math.PI / 2), m.clone().multiply(xf(0, h * t, 0)), 3);
  }
  b.add(fill, new THREE.CircleGeometry(r * 0.93, 16).rotateX(-Math.PI / 2), m.clone().multiply(xf(0, h * 0.86, 0)), 3);
  b.add('iron', new THREE.TorusGeometry(r * 1.02, 0.006, 4, 16, Math.PI), m.clone().multiply(xf(0, h, 0, 0, 1, 1, 1, 0, 0.5)), 3);
}

/** Blade outline extruded thin, lying flat (XZ) after rotation. */
function blade(pts: [number, number][], depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2).rotateX(-Math.PI / 2);
}

/**
 * Wooden table of torture tools: a bow saw, pincers, knives, a cleaver
 * and a hand drill laid on a blood-smeared top, a bucket of blood beside a
 * leg, chain hanging off the edge. Long axis along X.
 * Footprint 0.72 x 0.4.
 */
export function toolTable(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const L = 1.3;
  const W = 0.62;
  const T = 0.82;
  b.add('wood', new THREE.BoxGeometry(L, 0.06, W), xf(0, T - 0.03, 0), 1.5);
  for (let i = 0; i < 4; i++) b.add('wood', new THREE.BoxGeometry(L - 0.02, 0.012, 0.004), xf(0, T + 0.0, -W / 2 + (i + 1) * (W / 5)), 1.5);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.add('wood', new THREE.BoxGeometry(0.075, T - 0.06, 0.075), xf(sx * (L / 2 - 0.08), (T - 0.06) / 2, sz * (W / 2 - 0.06)), 1.5);
    b.add('wood', new THREE.BoxGeometry(0.05, 0.06, W - 0.1), xf(sx * (L / 2 - 0.08), 0.18, 0), 1.5);
  }
  b.add('wood', new THREE.BoxGeometry(L - 0.16, 0.05, 0.05), xf(0, 0.18, 0), 1.5);
  b.add('wood', new THREE.BoxGeometry(L - 0.16, 0.025, W - 0.14), xf(0, 0.22, 0), 1.5);
  const on = T + 0.006;
  // Bow saw: wooden frame, toothed blade.
  const sawM = xf(-0.36, on, -0.12, range(rng, -0.2, 0.2));
  const teeth: [number, number][] = [[-0.22, 0]];
  for (let i = 0; i <= 22; i++) teeth.push([-0.22 + i * 0.02, i % 2 ? -0.012 : 0]);
  teeth.push([0.22, 0.025], [-0.22, 0.025]);
  b.add('iron', blade(teeth, 0.002), sawM.clone().multiply(xf(0, 0.012, 0.06)), 3);
  b.add('wood', new THREE.BoxGeometry(0.5, 0.022, 0.025), sawM.clone().multiply(xf(0, 0.012, -0.08)), 3);
  for (const sx of [-1, 1]) b.add('wood', new THREE.BoxGeometry(0.03, 0.025, 0.2), sawM.clone().multiply(xf(sx * 0.24, 0.012, -0.01)), 3);
  b.add('wood', new THREE.CylinderGeometry(0.016, 0.018, 0.1, 6).rotateZ(Math.PI / 2), sawM.clone().multiply(xf(-0.3, 0.016, 0.07)), 3);
  // Pincers: two crossed arms with curved jaws.
  const pm = xf(0.02, on + 0.008, -0.1, range(rng, 0, 6));
  for (const s of [-1, 1]) {
    b.add('iron', taperTube([V(s * 0.03, 0, -0.18), V(s * 0.015, 0, -0.06), V(-s * 0.012, 0, 0.02), V(-s * 0.025, 0, 0.07), V(-s * 0.005, 0, 0.1)], 0.007, 0.006, 10, 5), pm, 3);
  }
  b.add('rust', new THREE.CylinderGeometry(0.012, 0.012, 0.016, 8), pm.clone().multiply(xf(0, 0, -0.005)), 3);
  // Knives.
  for (let i = 0; i < 2; i++) {
    const km = xf(0.22 + i * 0.1, on + 0.004, 0.08 + i * 0.03, Math.PI / 2 + range(rng, -0.3, 0.3));
    b.add('iron', blade([[0, 0.012], [0.16, 0.01], [0.21, 0], [0.15, -0.012], [0, -0.01]], 0.003), km, 3);
    b.add('wood', new THREE.CylinderGeometry(0.011, 0.012, 0.1, 6).rotateZ(Math.PI / 2), km.clone().multiply(xf(-0.05, 0.006, 0)), 3);
    b.add('iron', new THREE.BoxGeometry(0.008, 0.012, 0.035), km.clone().multiply(xf(0, 0.006, 0)), 3);
  }
  // Cleaver with a hanging hole.
  const cm = xf(0.42, on + 0.004, -0.12, range(rng, -0.4, 0.4));
  b.add('iron', blade([[0, 0.05], [0.18, 0.06], [0.19, -0.05], [0.0, -0.035]], 0.006), cm, 3);
  b.add('wood', new THREE.CylinderGeometry(0.014, 0.016, 0.12, 6).rotateZ(Math.PI / 2), cm.clone().multiply(xf(-0.06, 0.012, 0.01)), 3);
  b.add('gore', blade([[0.12, 0.06], [0.18, 0.06], [0.19, -0.04], [0.14, -0.045], [0.16, 0.01]], 0.0012), cm.clone().multiply(xf(0, 0.0035, 0)), 3);
  // Hand drill.
  const dm = xf(-0.05, on + 0.015, 0.16, range(rng, 0, 6));
  b.add('iron', taperTube([V(-0.12, 0, 0), V(-0.05, 0, 0), V(-0.03, 0, 0.06), V(0.03, 0, 0.06), V(0.05, 0, 0), V(0.14, 0, 0)], 0.006, 0.004, 14, 5), dm, 3);
  b.add('wood', new THREE.SphereGeometry(0.022, 8, 6).scale(1, 0.8, 1), dm.clone().multiply(xf(-0.13, 0, 0)), 3);
  // A bloodied rag and smears.
  b.add('cloth', new THREE.BoxGeometry(0.2, 0.012, 0.16).translate(0, 0.006, 0), xf(-0.4, on, 0.17, rng() * 3, 1, 1, 1, 0.04, 0.03), 3);
  for (let i = 0; i < 4; i++) splat(b, rng, range(rng, -0.5, 0.5), on - 0.003, range(rng, -0.2, 0.2), range(rng, 0.05, 0.12));
  // Blood dribbling off the edge.
  for (let i = 0; i < 3; i++) {
    const x = range(rng, -0.5, 0.5);
    const len = range(rng, 0.06, 0.2);
    b.add('gore', taperTube([V(x, T, W / 2 + 0.004), V(x, T - len * 0.5, W / 2 + 0.006), V(x, T - len, W / 2 + 0.004)], 0.006, 0.004, 4, 4), undefined, 3);
  }
  // Chain trailing off the end.
  chain(b, 'iron', V(L / 2 - 0.1, on + 0.01, -0.2), V(L / 2 + 0.03, 0.4, -0.18), 0.035, 0.05);
  // Bucket of blood under the table and a pool.
  bucket(b, xf(L / 2 - 0.2, 0.235, 0.05, rng() * 6), 0.12, 0.24, 'gore');
  splat(b, rng, range(rng, -0.2, 0.2), 0.004, range(rng, 0.1, 0.25), 0.35);
  return b;
}

/**
 * A wall of iron prison bars `width` wide and `height` tall along X: top and
 * bottom rails, round bars, two riveted cross bands, and a barred door in the
 * middle with hinges, a lock box and a ring handle.
 * Footprint width/2 x 0.07.
 */
export function cellBars(width: number, height: number): MeshBuilder {
  const b = new MeshBuilder();
  const doorW = Math.min(0.95, width * 0.45);
  const dx0 = -doorW / 2;
  const dx1 = doorW / 2;
  b.add('iron', new THREE.BoxGeometry(width, 0.1, 0.12), xf(0, height - 0.05, 0), 2);
  b.add('iron', new THREE.BoxGeometry(width, 0.07, 0.1), xf(0, 0.035, 0), 2);
  // End posts and door posts.
  for (const x of [-width / 2 + 0.04, width / 2 - 0.04, dx0 - 0.03, dx1 + 0.03]) b.add('rust', new THREE.BoxGeometry(0.07, height, 0.09), xf(x, height / 2, 0), 2);
  const bandYs = [height * 0.34, height * 0.68];
  const gap = 0.14;
  const bars = (x0: number, x1: number, y0: number, y1: number) => {
    const n = Math.max(1, Math.round((x1 - x0) / gap));
    for (let i = 1; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      b.add(i % 4 === 1 ? 'rust' : 'iron', new THREE.CylinderGeometry(0.018, 0.018, y1 - y0, 6), xf(x, (y0 + y1) / 2, 0), 3);
      for (const y of bandYs) b.add('rust', new THREE.SphereGeometry(0.016, 5, 4), xf(x, y, 0.035), 3);
    }
  };
  bars(-width / 2 + 0.04, dx0 - 0.03, 0.07, height - 0.1);
  bars(dx1 + 0.03, width / 2 - 0.04, 0.07, height - 0.1);
  for (const y of bandYs) {
    b.add('iron', new THREE.BoxGeometry(dx0 - 0.03 + width / 2 - 0.04, 0.05, 0.03), xf((-width / 2 + dx0) / 2, y, 0.02), 2);
    b.add('iron', new THREE.BoxGeometry(width / 2 - 0.04 - dx1 - 0.03, 0.05, 0.03), xf((width / 2 + dx1) / 2, y, 0.02), 2);
  }
  // Door: its own frame, bars and bands, hung on the left post.
  const dh = Math.min(height - 0.15, 2.05);
  const d0 = dx0 + 0.005;
  const d1 = dx1 - 0.005;
  for (const y of [0.1, dh]) b.add('iron', new THREE.BoxGeometry(d1 - d0, 0.06, 0.05), xf(0, y, 0.01), 2);
  for (const x of [d0 + 0.025, d1 - 0.025]) b.add('iron', new THREE.BoxGeometry(0.05, dh - 0.1, 0.05), xf(x, (dh + 0.1) / 2, 0.01), 2);
  for (let i = 1; i < 6; i++) b.add('iron', new THREE.CylinderGeometry(0.017, 0.017, dh - 0.1, 6), xf(d0 + ((d1 - d0) * i) / 6, (dh + 0.1) / 2, 0.01), 3);
  for (const y of [dh * 0.36, dh * 0.7]) b.add('rust', new THREE.BoxGeometry(d1 - d0, 0.05, 0.03), xf(0, y, 0.03), 2);
  if (height - dh > 0.25) {
    // Fixed transom bars above a short door.
    for (let i = 1; i < 6; i++) b.add('iron', new THREE.CylinderGeometry(0.016, 0.016, height - dh - 0.13, 6), xf(d0 + ((d1 - d0) * i) / 6, (height + dh) / 2 - 0.03, 0), 3);
  }
  for (const y of [0.35, dh - 0.25]) b.add('rust', new THREE.CylinderGeometry(0.024, 0.024, 0.14, 8), xf(d0 - 0.01, y, 0.03), 2);
  // Lock box, keyhole plate and ring handle.
  b.add('rust', new THREE.BoxGeometry(0.14, 0.18, 0.05), xf(d1 - 0.07, dh * 0.5, 0.04), 2);
  b.add('iron', new THREE.BoxGeometry(0.016, 0.04, 0.01), xf(d1 - 0.07, dh * 0.5, 0.07), 3);
  b.add('iron', new THREE.TorusGeometry(0.055, 0.011, 5, 14), xf(d1 - 0.07, dh * 0.5 - 0.13, 0.075), 3);
  b.add('iron', new THREE.TorusGeometry(0.055, 0.011, 5, 14), xf(d1 - 0.07, dh * 0.5 - 0.13, -0.075), 3);
  return b;
}

/**
 * A heap of skulls stacked into a mound over a litter of long bones and
 * ribs. Footprint 0.65 x 0.65.
 */
export function skullPile(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  // Bone litter first.
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.62;
    const len = range(rng, 0.22, 0.45);
    const y = 0.02 + Math.max(0, 0.12 - d * 0.15) * rng();
    const m = xf(Math.cos(a) * d, y, Math.sin(a) * d, rng() * 6.28, 1, 1, 1, Math.PI / 2 + range(rng, -0.3, 0.3), 0);
    longBone(b, m.multiply(xf(0, len / 2, 0)), len, range(rng, 0.011, 0.016));
  }
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const d = range(rng, 0.2, 0.6);
    b.add('bone', new THREE.TorusGeometry(range(rng, 0.08, 0.12), 0.007, 4, 10, Math.PI * 0.8), xf(Math.cos(a) * d, 0.012, Math.sin(a) * d, rng() * 6, 1, 1, 1, Math.PI / 2), 3);
  }
  // Skulls in rings, smaller and higher toward the top.
  const rings: [number, number, number][] = [
    [0.36, 0.075, 9],
    [0.21, 0.175, 6],
    [0.07, 0.275, 3],
  ];
  for (const [r, y, n] of rings) {
    const off = rng() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + range(rng, -0.15, 0.15);
      const rr = r + range(rng, -0.04, 0.04);
      const facing = a + range(rng, -0.45, 0.45);
      const m = xf(Math.cos(a) * rr, y + range(rng, -0.02, 0.02), Math.sin(a) * rr, Math.PI / 2 - facing, 1.05, 1.05, 1.05, range(rng, -0.45, 0.25), range(rng, -0.35, 0.35));
      for (const g of skullGeos(range(rng, 0, 0.18), 0.75)) b.add('bone', g, m, 3);
    }
  }
  for (const g of skullGeos(0.12, 1)) b.add('bone', g, xf(0, 0.37, 0.02, range(rng, -0.6, 0.6), 1.1, 1.1, 1.1, -0.2), 3);
  // Rubble under the heap.
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const d = range(rng, 0.3, 0.65);
    b.add('rubble', new THREE.DodecahedronGeometry(range(rng, 0.04, 0.08), 0).scale(1, 0.6, 1), xf(Math.cos(a) * d, 0.02, Math.sin(a) * d, rng() * 6), 3);
  }
  return b;
}

/** Height of the top of the coals in the pedestal brazier (flames go here). */
export const PEDESTAL_BRAZIER_COALS_Y = 1.55;

/**
 * Tall pedestal brazier: a stepped plinth, a panelled stone shaft and capital
 * holding an iron bowl of glowing coals on claw feet. Coals top out at
 * PEDESTAL_BRAZIER_COALS_Y. Footprint 0.35 x 0.35.
 */
export function pedestalBrazier(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  b.add('trim', new THREE.BoxGeometry(0.66, 0.14, 0.66), xf(0, 0.07, 0), 1);
  b.add('trim', new THREE.BoxGeometry(0.54, 0.1, 0.54), xf(0, 0.19, 0), 1);
  b.add('trim', new THREE.CylinderGeometry(0.25, 0.29, 0.06, 4, 1).rotateY(Math.PI / 4), xf(0, 0.27, 0), 1);
  b.add('trim', new THREE.BoxGeometry(0.34, 0.76, 0.34), xf(0, 0.68, 0), 1);
  // Recessed panels and corner beads on the shaft.
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    b.add('rubble', new THREE.BoxGeometry(0.2, 0.56, 0.02), xf(Math.sin(a) * 0.165, 0.68, Math.cos(a) * 0.165, a), 1);
    b.add('trim', new THREE.CylinderGeometry(0.025, 0.025, 0.74, 6), xf(Math.sin(a + Math.PI / 4) * 0.24, 0.68, Math.cos(a + Math.PI / 4) * 0.24), 1);
  }
  b.add('trim', new THREE.CylinderGeometry(0.31, 0.25, 0.08, 4, 1).rotateY(Math.PI / 4), xf(0, 1.1, 0), 1);
  b.add('trim', new THREE.BoxGeometry(0.5, 0.07, 0.5), xf(0, 1.175, 0), 1);
  // Chips knocked off the edges.
  for (let i = 0; i < 4; i++) b.add('rubble', new THREE.DodecahedronGeometry(range(rng, 0.03, 0.06), 0), xf(range(rng, -0.4, 0.4), 0.025, range(rng, -0.4, 0.4), rng() * 6), 2);
  // Bowl on three claw feet.
  const y0 = 1.21;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.add('iron', taperTube([V(Math.sin(a) * 0.14, y0 + 0.09, Math.cos(a) * 0.14), V(Math.sin(a) * 0.19, y0 + 0.04, Math.cos(a) * 0.19), V(Math.sin(a) * 0.2, y0, Math.cos(a) * 0.2)], 0.02, 0.012, 5, 5), undefined, 3);
  }
  const prof = [
    [0.0, 0.07],
    [0.12, 0.07],
    [0.27, 0.15],
    [0.36, 0.27],
    [0.38, 0.3],
    [0.355, 0.3],
    [0.33, 0.27],
    [0.24, 0.17],
    [0.0, 0.13],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  b.add('iron', new THREE.LatheGeometry(prof, 20), xf(0, y0, 0), 2);
  b.add('rust', new THREE.TorusGeometry(0.37, 0.016, 5, 24).rotateX(Math.PI / 2), xf(0, y0 + 0.3, 0), 2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add('rust', new THREE.BoxGeometry(0.03, 0.12, 0.02), xf(Math.sin(a) * 0.31, y0 + 0.21, Math.cos(a) * 0.31, a, 1, 1, 1, -0.75), 2);
  }
  // Coals heaped in the bowl.
  b.add('coal', new THREE.SphereGeometry(0.33, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1), xf(0, y0 + 0.21, 0), 0);
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.27;
    const y = y0 + 0.21 + 0.0825 * Math.sqrt(1 - (d / 0.33) ** 2) + 0.012;
    b.add('coal', new THREE.DodecahedronGeometry(range(rng, 0.035, 0.06), 0), xf(Math.cos(a) * d, y, Math.sin(a) * d, rng() * 6, 1, 0.7, 1), 0);
  }
  return b;
}

/**
 * A pot-bellied iron cauldron on three legs, brimming with blood, with ring
 * handles, blood run down its sides and embers glowing under it.
 * Footprint 0.5 x 0.5.
 */
export function bloodCauldron(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const y0 = 0.22;
  const prof = [
    [0.0, 0.0],
    [0.2, 0.01],
    [0.36, 0.1],
    [0.43, 0.25],
    [0.42, 0.4],
    [0.36, 0.5],
    [0.38, 0.54],
    [0.4, 0.56],
    [0.37, 0.57],
    [0.33, 0.52],
    [0.35, 0.42],
    [0.36, 0.25],
    [0.3, 0.12],
    [0.0, 0.06],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  b.add('iron', new THREE.LatheGeometry(prof, 24), xf(0, y0, 0), 2);
  b.add('rust', new THREE.TorusGeometry(0.425, 0.015, 5, 28).rotateX(Math.PI / 2), xf(0, y0 + 0.3, 0), 2);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    b.add('iron', taperTube([V(Math.sin(a) * 0.26, y0 + 0.08, Math.cos(a) * 0.26), V(Math.sin(a) * 0.36, y0 - 0.06, Math.cos(a) * 0.36), V(Math.sin(a) * 0.36, 0.02, Math.cos(a) * 0.36)], 0.035, 0.025, 6, 6), undefined, 3);
    b.add('iron', new THREE.SphereGeometry(0.04, 6, 4).scale(1, 0.5, 1), xf(Math.sin(a) * 0.36, 0.02, Math.cos(a) * 0.36), 3);
  }
  for (const s of [-1, 1]) {
    b.add('iron', new THREE.BoxGeometry(0.06, 0.05, 0.06), xf(s * 0.4, y0 + 0.47, 0), 2);
    b.add('rust', new THREE.TorusGeometry(0.07, 0.014, 5, 14).rotateY(Math.PI / 2), xf(s * 0.45, y0 + 0.4, 0, 0, 1, 1, 1, 0, s * 0.3), 3);
  }
  // The blood: a surface just under the rim, bubbles, spill over the lip.
  b.add('gore', new THREE.CircleGeometry(0.35, 24).rotateX(-Math.PI / 2), xf(0, y0 + 0.535, 0), 2);
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.28;
    b.add('gore', new THREE.SphereGeometry(range(rng, 0.015, 0.035), 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), xf(Math.cos(a) * d, y0 + 0.535, Math.sin(a) * d), 3);
  }
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    const len = range(rng, 0.1, 0.35);
    const pts = [V(0.39, y0 + 0.565, 0), V(0.415, y0 + 0.5, 0), V(0.425, y0 + 0.5 - len * 0.5, 0), V(0.43 - len * 0.05, y0 + 0.5 - len, 0)].map((p) => p.applyAxisAngle(UP, a));
    b.add('gore', taperTube(pts, 0.012, 0.008, 6, 5), undefined, 3);
  }
  // Embers and blackened stones underneath, a pool beside.
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.2;
    b.add('coal', new THREE.DodecahedronGeometry(range(rng, 0.03, 0.055), 0), xf(Math.cos(a) * d, 0.03, Math.sin(a) * d, rng() * 6, 1, 0.6, 1), 0);
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.add('rubble', new THREE.DodecahedronGeometry(range(rng, 0.05, 0.08), 0), xf(Math.cos(a) * 0.27, 0.035, Math.sin(a) * 0.27, rng() * 6, 1, 0.65, 1), 2);
  }
  splat(b, rng, range(rng, 0.25, 0.4), 0.004, range(rng, -0.2, 0.2), 0.3);
  return b;
}

// ---------------------------------------------------------------------------
// Iron maiden shell, shared with the walking Iron Maiden monster

/** Shell heights and angles (metres; theta from the front, +X positive). */
export const MAIDEN = {
  BASE: 0.2,
  SHOULDER: 1.5,
  NECK: 1.69,
  /** Angle from the front where the doors meet the back shell. */
  HINGE: 1.3,
  /** The inner wall surface sits at this fraction of the outer. */
  INNER: 0.88,
  SEAM: 0.006,
};

// Body profile knots: [y, half width, half depth].
const KNOTS: [number, number, number][] = [
  [MAIDEN.BASE, 0.275, 0.235],
  [0.5, 0.29, 0.245],
  [0.9, 0.33, 0.26],
  [1.2, 0.38, 0.272],
  [1.42, 0.415, 0.28],
  [1.52, 0.405, 0.272],
  [1.59, 0.36, 0.25],
  [1.645, 0.25, 0.19],
  [MAIDEN.NECK, 0.13, 0.12],
];
let LUT: { y: number; w: number; d: number }[] | null = null;
/** Half width and depth of the shell at height y. */
export function maidenProfile(y: number) {
  LUT ??= new THREE.CatmullRomCurve3(KNOTS.map(([y, w, d]) => V(w, y, d)), false, 'centripetal').getPoints(240).map((p) => ({ y: p.y, w: p.x, d: p.z }));
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
/** Point on the shell at (theta, y) scaled out by k: a slightly squared ellipse. */
export function maidenS(theta: number, y: number, k: number) {
  const p = maidenProfile(y);
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  const e = 0.82;
  return V(k * p.w * Math.sign(s) * Math.abs(s) ** e, y, k * p.d * Math.sign(c) * Math.abs(c) ** e);
}
/** Outward direction of the shell at (theta, y). */
export function maidenN(theta: number, y: number) {
  const p = maidenProfile(y);
  return V(Math.sin(theta) / p.w, 0, Math.cos(theta) / p.d).normalize();
}
/** Outer skin: a cast robe falling in folds from the waist band to the hem band. */
export const maidenRobe = (t: number, y: number) => 1 + 0.034 * (0.5 + 0.5 * Math.cos(t * 11)) ** 2 * smooth(y, 0.4, 0.52) * (1 - smooth(y, 0.96, 1.05)) * (0.6 + 0.4 * smooth(y, 1, 0.45));

type K = number | ((t: number, y: number) => number);
const kf = (k: K) => (typeof k === 'number' ? () => k : k);

/** A grid of the shell surface over theta and y ranges at scale k (flip for inward-facing). */
export function shellGrid(t0: number, t1: number, y0: number, y1: number, nt: number, ny: number, k: K, flip = false) {
  const K = kf(k);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= ny; j++) {
    const y = y0 + ((y1 - y0) * j) / ny;
    for (let i = 0; i <= nt; i++) {
      const t = t0 + ((t1 - t0) * i) / nt;
      const p = maidenS(t, y, K(t, y));
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

/** A thin double-sided wall joining shell scales k0 and k1 along a path of (theta, y). */
export function shellWall(path: [number, number][], k0: number, k1: K) {
  const K = kf(k1);
  const pos: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [ta, ya] = path[i];
    const [tb, yb] = path[i + 1];
    const a0 = maidenS(ta, ya, k0);
    const a1 = maidenS(ta, ya, K(ta, ya));
    const b0 = maidenS(tb, yb, k0);
    const b1 = maidenS(tb, yb, K(tb, yb));
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
export const vPath = (t: number, y0: number, y1: number, n = 12): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [t, y0 + ((y1 - y0) * i) / n]);
export const hPath = (t0: number, t1: number, y: number, n = 12): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [t0 + ((t1 - t0) * i) / n, y]);

/** A raised slab on the shell (band, strap, flange): face plus its four edges. */
export function shellSlab(t0: number, t1: number, y0: number, y1: number, k0: number, k1: number, nt = 12, ny = 2): THREE.BufferGeometry[] {
  return [shellGrid(t0, t1, y0, y1, nt, ny, k1), shellWall(hPath(t0, t1, y0, nt), k0, k1), shellWall(hPath(t0, t1, y1, nt), k0, k1), shellWall(vPath(t0, y0, y1, ny), k0, k1), shellWall(vPath(t1, y0, y1, ny), k0, k1)];
}

/** The maiden's stern cast face on the unit sphere (face toward +Z). */
export function maidenFace(x: number, y: number, z: number) {
  const f = smooth(z, 0.35, 0.85);
  const ax = Math.abs(x);
  let d = 0;
  d -= 0.09 * f * Math.exp(-((y - 0.05) ** 2) / 0.3); // flatter face plane
  d += 0.17 * f * Math.exp(-(x * x) / 0.006 - (y * y) / 0.03) * (y < 0.2 ? 1 : 0.4); // nose bridge
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
}
/** Face sphere size and scale, in head-local metres (centre at FACE_C). */
export const FACE_R = 0.19;
export const FACE_S = V(0.8, 1.12, 0.92);
export const FACE_C = V(0, 0.22, 0.02);
/** Head-local point on the face for unit-sphere coords (ux, uy) on its front, lifted by `lift`. */
export function onMaidenFace(ux: number, uy: number, lift = 0.003) {
  const v = V(ux, uy, Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy)));
  const k = FACE_R * (1 + maidenFace(v.x, v.y, v.z)) + lift;
  return V(v.x * k * FACE_S.x + FACE_C.x, v.y * k * FACE_S.y + FACE_C.y, v.z * k * FACE_S.z + FACE_C.z);
}
/** The face: the front of a finely divided sphere sculpted by maidenFace, in head-local space. */
export function maidenFaceGeo() {
  const g = new THREE.SphereGeometry(1, 44, 40, Math.PI / 2 - 1.25, 2.5, 0.3, 2.45);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = FACE_R * (1 + maidenFace(x, y, z));
    pos.setXYZ(i, x * k * FACE_S.x + FACE_C.x, y * k * FACE_S.y + FACE_C.y, z * k * FACE_S.z + FACE_C.z);
  }
  g.computeVertexNormals();
  return boxProjectUVs(g, 6);
}
const VEIL = [
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
/** The cast veil round the head, open at the face, in head-local space (render double-sided). */
export function maidenVeilGeo() {
  const g = new THREE.LatheGeometry(new THREE.SplineCurve(VEIL).getPoints(30), 32, 0.95, Math.PI * 2 - 1.9).scale(1, 1, 0.85);
  return boxProjectUVs(g, 4);
}
/** The rolled front hems of the veil. */
export function maidenVeilHems(): THREE.BufferGeometry[] {
  return [-1, 1].map((s) => taperTube(VEIL.slice(0, 9).map((v) => V(Math.sin(0.95) * v.x * s, v.y, Math.cos(0.95) * v.x * 0.85)), 0.012, 0.01, 20, 6));
}

/**
 * A static iron maiden standing open: riveted body and shoulders under a
 * veiled, crowned woman's face, both doors swung wide on their hinges to
 * show the bloody spikes inside, a skull and bones fallen in the bottom.
 * Faces +Z, 2 m tall. Footprint 0.75 x 0.55 (the open doors reach forward).
 */
export function maidenProp(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const { BASE, SHOULDER, NECK, HINGE, INNER, SEAM } = MAIDEN;
  const lift = xf(0, 0.06 - BASE, 0);
  const s = new MeshBuilder();
  const BK = Math.PI * 2 - HINGE;
  const bandYs = [0.34, 1.1];
  s.add('iron', shellGrid(HINGE, BK, BASE, SHOULDER, 34, 26, maidenRobe), undefined, 0);
  s.add('rust', shellGrid(HINGE, BK, BASE, SHOULDER, 34, 26, INNER, true), undefined, 0);
  for (const t of [HINGE, BK]) s.add('iron', shellWall(vPath(t, BASE, SHOULDER, 26), INNER, maidenRobe), undefined, 0);
  for (const y of bandYs) for (const g of shellSlab(HINGE + 0.02, BK - 0.02, y - 0.03, y + 0.03, 0.99, 1.035, 30)) s.add('rust', g, undefined, 0);
  s.add('iron', shellGrid(0, Math.PI * 2, SHOULDER, NECK, 48, 10, 1), undefined, 0);
  for (const g of shellSlab(0, Math.PI * 2, SHOULDER - 0.005, SHOULDER + 0.045, 0.99, 1.04, 48)) s.add('rust', g, undefined, 0);
  const p0 = maidenProfile(BASE);
  s.add('rust', new THREE.CylinderGeometry(1, 1.05, 0.09, 32).scale(p0.w * 1.04, 1, p0.d * 1.04), xf(0, BASE - 0.02, 0), 2);
  s.add('iron', new THREE.CylinderGeometry(1, 1, 0.03, 32).scale(p0.w * 0.98, 1, p0.d * 0.98), xf(0, BASE + 0.03, 0), 2);
  s.add('gore', new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2).scale(p0.w * 0.8, 1, p0.d * 0.8), xf(0, BASE + 0.05, 0), 2);
  for (let y = 0.45; y < 1.4; y += 0.16) for (const t of [Math.PI - 0.5, Math.PI, Math.PI + 0.5]) spikeAt(s, 'iron', maidenS(t, y, INNER), maidenN(t, y).negate(), 0.15, 0.016, 'gore');
  // Flank spikes.
  for (const sd of [1, -1]) {
    for (let y = 0.32; y < 1.45; y += 0.16) spikeAt(s, 'rust', maidenS(sd * (HINGE + 0.2), y, 0.99), maidenN(sd * (HINGE + 0.2), y).add(V(0, 0.25, 0)), range(rng, 0.13, 0.18), 0.028);
    for (let i = 0; i < 6; i++) spikeAt(s, 'rust', maidenS(sd * (0.75 + i * 0.32), 1.55, 0.98), maidenN(sd * (0.75 + i * 0.32), 1.55).multiplyScalar(0.6).add(V(0, 1, 0)), range(rng, 0.13, 0.19), 0.024);
  }
  // Doors, swung open.
  for (const sd of [1, -1]) {
    const hp = maidenS(sd * HINGE, 0.95, 1);
    const d = new MeshBuilder();
    const [t0, t1] = sd > 0 ? [SEAM, HINGE] : [-HINGE, -SEAM];
    d.add('iron', shellGrid(t0, t1, BASE, SHOULDER - 0.005, 22, 26, maidenRobe), undefined, 0);
    d.add('rust', shellGrid(t0, t1, BASE, SHOULDER - 0.005, 22, 26, INNER, true), undefined, 0);
    for (const t of [t0, t1]) d.add('iron', shellWall(vPath(t, BASE, SHOULDER - 0.005, 26), INNER, maidenRobe), undefined, 0);
    for (const y of [BASE, SHOULDER - 0.005]) d.add('iron', shellWall(hPath(t0, t1, y), INNER, 1), undefined, 0);
    for (const y of bandYs) for (const g of shellSlab(t0 + 0.06, t1 - 0.02, y - 0.03, y + 0.03, 0.99, 1.035)) d.add('rust', g, undefined, 0);
    for (const g of shellSlab(sd > 0 ? SEAM : -0.085, sd > 0 ? 0.085 : -SEAM, BASE + 0.01, SHOULDER - 0.01, 0.99, 1.05, 2, 16)) d.add('rust', g, undefined, 0);
    for (const y of [0.5, 0.95, 1.3]) for (const g of shellSlab(sd > 0 ? HINGE - 0.62 : -HINGE, sd > 0 ? HINGE : -HINGE + 0.62, y - 0.04, y + 0.04, 1.03, 1.07, 8)) d.add('rust', g, undefined, 0);
    let row = 0;
    for (let y = 0.34; y < SHOULDER - 0.06; y += 0.125, row++) {
      for (const tt of row % 2 ? [0.32, 0.72, 1.08] : [0.14, 0.52, 0.92]) {
        const p = maidenS(sd * tt, y, INNER);
        spikeAt(d, 'iron', p, V(-p.x * 0.75, 0.02, -p.z), range(rng, 0.16, 0.22), 0.017, 'gore');
      }
    }
    for (let i = 0; i < 3; i++) {
      const t = sd * range(rng, 0.1, 1.0);
      const y = range(rng, 0.5, 1.3);
      const a = maidenS(t, y, INNER - 0.005);
      const c = maidenS(t, y - range(rng, 0.15, 0.4), INNER - 0.005);
      d.add('gore', taperTube([a, a.clone().lerp(c, 0.5), c], 0.01, 0.006, 5, 4), undefined, 3);
    }
    const open = sd * (range(rng, 1.7, 2.05));
    s.addBuilder(d, new THREE.Matrix4().makeTranslation(hp.x, 0, hp.z).multiply(new THREE.Matrix4().makeRotationY(open)).multiply(new THREE.Matrix4().makeTranslation(-hp.x, 0, -hp.z)));
    for (const y of [0.5, 0.95, 1.3]) s.add('iron', new THREE.CylinderGeometry(0.024, 0.024, 0.12, 8), xf(hp.x, y, hp.z), 3);
  }
  // Head: face, veil, spiked crown.
  const H = xf(0, NECK - 0.04, 0.01, 0, 1.1);
  s.add('iron', new THREE.CylinderGeometry(0.1, 0.13, 0.12, 14), H.clone().multiply(xf(0, 0.03, 0)), 2);
  s.add('rust', new THREE.SphereGeometry(0.175, 20, 14).scale(0.8, 1.08, 0.8), H.clone().multiply(xf(0, 0.22, 0)), 4);
  s.add('rust', maidenFaceGeo(), H, 0);
  s.add('iron', maidenVeilGeo(), H, 0);
  for (const g of maidenVeilHems()) s.add('iron', g, H, 3);
  for (const sd of [-1, 1]) {
    const tear = [0.06, -0.05, -0.18, -0.32, -0.42].map((uy, i) => onMaidenFace(sd * (0.3 + i * 0.012), uy));
    s.add('gore', taperTube(tear, 0.0045, 0.003, 14, 5), H, 3);
  }
  s.add('rust', new THREE.TorusGeometry(0.15, 0.016, 6, 28).rotateX(Math.PI / 2), H.clone().multiply(xf(0, 0.41, -0.005)), 3);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const m = H.clone();
    const tmp = new MeshBuilder();
    spikeAt(tmp, 'rust', V(Math.sin(a) * 0.15, 0.41, Math.cos(a) * 0.15 - 0.005), V(Math.sin(a) * 0.45, 1, Math.cos(a) * 0.45), i % 2 ? 0.12 : 0.19, 0.017);
    s.addBuilder(tmp, m);
  }
  // A skull and bones fallen into the bottom of it.
  for (const g of skullGeos(0.35)) s.add('bone', g, xf(range(rng, -0.08, 0.08), BASE + 0.12, range(rng, -0.05, 0.05), range(rng, -0.8, 0.8), 1, 1, 1, -0.5, range(rng, -0.4, 0.4)), 3);
  for (let i = 0; i < 2; i++) longBone(s, xf(i ? 0.12 : -0.13, BASE + 0.12, -0.12, range(rng, -0.4, 0.4), 1, 1, 1, range(rng, 0.2, 0.5), i ? -0.25 : 0.25).multiply(xf(0, 0.3, 0)), 0.32, 0.014);
  b.addBuilder(s, lift);
  splat(b, rng, 0, 0.004, 0.35, 0.35);
  return b;
}
