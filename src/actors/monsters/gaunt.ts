import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { perlin3, range, type Rng } from '../../procgen/noise';
import { boxProjectUVs } from '../../procgen/geometry';
import { angDiff, bump, bumpA, sculptSphere } from '../sculpt';
import { BasicRig, ease, hump, teethArc } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Gaunt: a starved, hairless thing that was a prisoner once and now runs on
// all fours like a spider. Its spine arches high over a cage of ribs, every
// vertebra standing out under grey, blood-streaked skin; the limbs are far
// too long, with knobbed elbows and knees cocked up above the back, and the
// hands splay long clawed fingers on the stones. The head hangs low and
// forward, a lipless jaw of crowded teeth below sunken, glowing eyes, a few
// lank wisps of hair still clinging to the scalp. Its limbs are placed by
// two-bone IK on a scuttling trot; it rears on its hind legs to rake down
// with both hands, and dies curled up on its side.

type V3 = THREE.Vector3;
/** Shade of a skin vertex: [cavity 0..1, blood 0..1]. */
type Shade = [number, number];

const SKIN = new THREE.Color(0.3, 0.32, 0.34);
const CAVITY = new THREE.Color(0.08, 0.065, 0.075);
const BLOOD = new THREE.Color(0.19, 0.009, 0.006);
const tmpC = new THREE.Color();

/** Vertex colour of the skin: mottled grey, darkened in grooves, streaked with blood. */
function skinTone(x: number, y: number, z: number, cav: number, blood: number, out: THREE.Color) {
  const mottle = 0.86 + 0.22 * perlin3(x * 9, y * 9, z * 9, 3) + 0.08 * perlin3(x * 31, y * 31, z * 31, 4);
  out.copy(SKIN).multiplyScalar(mottle);
  // Bruised purple-grey in the hollows.
  out.lerp(CAVITY, Math.min(1, cav));
  out.lerp(BLOOD, Math.min(1, blood));
  return out;
}

/**
 * Smeared blood running downhill: noise stretched along the run, `w`
 * across it and `v` metres down from where it starts, thinning out below.
 */
function streaks(w: number, v: number, seed: number) {
  const n = perlin3(w * 30, v * 3, seed, 7) * 0.7 + perlin3(w * 70, v * 8, seed + 1, 8) * 0.3;
  return THREE.MathUtils.smoothstep(n, 0.12, 0.42) * (1 - THREE.MathUtils.smoothstep(v, 0.08, 0.3)) * 0.95;
}

/** Smooth interpolation through [u, value] keys. */
function prof(u: number, keys: [number, number][]) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [u0, a] = keys[i - 1];
      const [u1, b] = keys[i];
      const t = (u - u0) / (u1 - u0);
      return a + (b - a) * t * t * (3 - 2 * t);
    }
  }
  return keys[keys.length - 1][1];
}

/** Ellipse radius at angle `a` (0 = up) for half-widths rx (side) and ry (up). */
const ellipse = (a: number, rx: number, ry: number) => (rx * ry) / Math.hypot(ry * Math.sin(a), rx * Math.cos(a));

/**
 * Closed tube along a curve. `rad(u, a)` gives the radius at length u (0..1)
 * and angle a around it (0 = toward local up, π/2 toward +X). `shade` gives
 * each vertex its skin cavity and blood. Ends are capped with a rounded tip.
 */
function tubeIndexed(
  pts: V3[],
  rings: number,
  seg: number,
  rad: (u: number, a: number) => number,
  shade?: (u: number, a: number, p: V3) => Shade,
  refUp = new THREE.Vector3(0, 1, 0),
  span: [number, number] = [0, 1],
  caps: [boolean, boolean] = [true, true],
) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  const push = (p: V3, s: Shade) => {
    pos.push(p.x, p.y, p.z);
    skinTone(p.x, p.y, p.z, s[0], s[1], tmpC);
    col.push(tmpC.r, tmpC.g, tmpC.b);
  };
  const frames: { p: V3; t: V3; up: V3; side: V3 }[] = [];
  for (let i = 0; i <= rings; i++) {
    const u = span[0] + ((span[1] - span[0]) * i) / rings;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const up = refUp.clone().addScaledVector(t, -refUp.dot(t));
    if (up.lengthSq() < 1e-6) up.set(0, 0, -1).addScaledVector(t, t.z);
    up.normalize();
    const side = new THREE.Vector3().crossVectors(up, t).normalize();
    frames.push({ p, t, up, side });
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const r = rad(u, a);
      v.copy(p).addScaledVector(up, Math.cos(a) * r).addScaledVector(side, Math.sin(a) * r);
      push(v, shade ? shade(u, a, v) : [0, 0]);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      idx.push(a, a + seg, b, b, a + seg, b + seg);
    }
  }
  // Rounded caps: a centre point pushed out past each end.
  for (const end of [0, 1]) {
    if (!caps[end]) continue;
    const f = frames[end ? rings : 0];
    const ue = span[end];
    const r = rad(ue, 0) * 0.5 + rad(ue, Math.PI / 2) * 0.5;
    v.copy(f.p).addScaledVector(f.t, (end ? 1 : -1) * r * 0.6);
    push(v, shade ? shade(ue, 0, v) : [0, 0]);
    const c = pos.length / 3 - 1;
    const base = end ? rings * seg : 0;
    for (let j = 0; j < seg; j++) {
      const a = base + j;
      const b = base + ((j + 1) % seg);
      if (end) idx.push(a, c, b);
      else idx.push(a, b, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function tube(...args: Parameters<typeof tubeIndexed>) {
  return boxProjectUVs(tubeIndexed(...args), 6);
}

/**
 * A capped tube cut in two at ring `at`, normals shared across the cut so
 * the two halves (hung on different joints) meet without a crease.
 */
function tubeSplit(pts: V3[], rings: number, seg: number, at: number, rad: (u: number, a: number) => number, shade: (u: number, a: number, p: V3) => Shade): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const geo = tubeIndexed(pts, rings, seg, rad, shade);
  const idx = Array.from(geo.index!.array);
  const cut = at * seg * 6;
  const body = rings * seg * 6;
  // The halves overlap by a few rings so the bend never opens a gap.
  const parts = [idx.slice(0, cut + seg * 18).concat(idx.slice(body, body + seg * 3)), idx.slice(cut - seg * 6, body).concat(idx.slice(body + seg * 3))];
  return parts.map((p) => {
    const g = geo.clone();
    g.setIndex(p);
    return boxProjectUVs(g, 6);
  }) as [THREE.BufferGeometry, THREE.BufferGeometry];
}

/** Gives a geometry skin vertex colours from a shade function of its (local) position. */
function painted(geo: THREE.BufferGeometry, shade: (x: number, y: number, z: number) => Shade = () => [0, 0]) {
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const [c, b] = shade(x, y, z);
    skinTone(x, y, z, c, b, tmpC);
    col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

interface Limb {
  side: number;
  front: boolean;
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  end: THREE.Object3D;
  a: number;
  b: number;
  /** Rest foot target (body space) and the direction the knee bows toward. */
  home: V3;
  pole: V3;
  /** The pole in use this frame (actions may swing it). */
  bend: V3;
  target: V3;
  /** Gait phase offset, fraction of a cycle. */
  offset: number;
  lift: number;
  /** Heading of the planted hand or foot. */
  flat: THREE.Quaternion;
  /** 0 planted flat, 1 aligned with the forearm (reaching, curled). */
  raise: number;
}

const HIP_Y = 0.7;
const HIP_Z = -0.32;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _k = new THREE.Vector3();
const _l = new THREE.Vector3();

/** Rotation whose +Z is `z` and +Y leans toward `up`. */
function basis(z: V3, up: V3, out: THREE.Quaternion) {
  _y.copy(up).addScaledVector(z, -up.dot(z)).normalize();
  _x.crossVectors(_y, z);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, z));
}

class Gaunt extends BasicRig {
  readonly hips: THREE.Object3D;
  readonly chest: THREE.Object3D;
  readonly ribs: THREE.Object3D;
  readonly neck: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly jaw: THREE.Object3D;
  readonly limbs: Limb[] = [];
  readonly wisps: THREE.Object3D[] = [];
  dead = false;
  /** Smoothed head scan. */
  private scanYaw = 0;
  private scanPitch = 0;
  private seed: number;

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, 5.5, 4.2);
    this.seed = range(rng, 0, 100);
    const skin = (m.paleSkin as THREE.MeshStandardMaterial).clone();
    skin.color.setRGB(1, 1, 1);
    skin.vertexColors = true;
    // Blood painted into the vertex colours is wet: glossier than the skin.
    skin.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor *= mix(1.0, 0.28, clamp((vColor.r - vColor.b) * 9.0, 0.0, 1.0));');
    };
    const claw = new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.35 });
    const hairMat = (m.hair as THREE.MeshStandardMaterial).clone();
    hairMat.color.setRGB(0.16, 0.15, 0.14);
    const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.0, 0.35), fog: false });
    const gum = new THREE.MeshStandardMaterial({ color: 0x3a0606, roughness: 0.3 });

    // Skin parts are merged per joint here (keeping their vertex colours)
    // before the rig is baked.
    const parts = new Map<THREE.Object3D, THREE.BufferGeometry[]>();
    const add = (geo: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      geo.translate(x, y, z);
      for (const n of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(n)) geo.deleteAttribute(n);
      const list = parts.get(parent) ?? [];
      list.push(geo.index ? geo.toNonIndexed() : geo);
      parts.set(parent, list);
    };

    // Torso: one sculpted surface from the tailbone over the high arch of
    // the back to the shoulders, cut in two where the spine bends: pelvis
    // and lumbar on the hips, the rib cage on the chest.
    this.hips = joint(this.body, 0, HIP_Y, HIP_Z);
    const CHEST = new THREE.Vector3(0, 0.2, 0.3);
    this.chest = joint(this.hips, CHEST.x, CHEST.y, CHEST.z);
    this.ribs = joint(this.chest, 0, 0, 0);
    const SPLIT = 0.4;
    const ribPattern = (u: number, a: number) => {
      const cu = (u - SPLIT) / (1 - SPLIT);
      const da = Math.abs(angDiff(a, 0));
      const s = cu * 9 + da * 0.42;
      const ridge = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * s), 8);
      // Ribs show on the flanks; the lower ones float short of the belly.
      const mask = THREE.MathUtils.smoothstep(da, 0.75, 1.15) * THREE.MathUtils.smoothstep(cu, 0.12, 0.26) * (1 - THREE.MathUtils.smoothstep(cu, 0.84, 0.95)) * (1 - THREE.MathUtils.smoothstep(da, 2.0 + cu * 0.7, 2.4 + cu * 0.7));
      return { ridge, mask, da, cu };
    };
    const vertebra = (u: number, da: number) => Math.pow(Math.max(0, Math.cos(u * Math.PI * 2 * 12.5)), 2) * Math.exp(-((da / 0.24) ** 2)) * THREE.MathUtils.smoothstep(u, 0.06, 0.12);
    const torso = (u: number, a: number) => {
      const close = Math.sqrt(Math.min(1, u / 0.06)) * 0.7 + 0.3;
      const rx = close * prof(u, [[0, 0.1], [0.08, 0.108], [0.17, 0.098], [0.3, 0.066], [0.42, 0.08], [0.56, 0.125], [0.75, 0.133], [0.9, 0.113], [1, 0.075]]);
      const ry = close * prof(u, [[0, 0.088], [0.08, 0.09], [0.17, 0.08], [0.3, 0.06], [0.42, 0.08], [0.56, 0.11], [0.75, 0.117], [0.9, 0.094], [1, 0.062]]);
      const { ridge, mask, da } = ribPattern(u, a);
      let r = ellipse(a, rx, ry);
      // Spine: a knuckled ridge of vertebrae the whole length.
      r += (0.006 + 0.016 * vertebra(u, da)) * Math.exp(-((da / 0.24) ** 2));
      // Hip bones: iliac crests, a flat sacrum, wasted buttocks.
      for (const s of [-1, 1]) {
        r += 0.024 * bumpA(a, s * 1.05, u, 0.15, 0.35, 0.035);
        r += 0.02 * bumpA(a, s * 2.3, u, 0.05, 0.55, 0.05);
        // Sucked-in flanks between hip and ribs.
        r -= 0.01 * bumpA(a, s * 1.7, u, 0.3, 0.6, 0.07);
      }
      r += 0.01 * bumpA(a, 0, u, 0.07, 0.35, 0.05);
      // Ribs and the grooves between them.
      r += mask * (0.009 * ridge - 0.007 * (1 - ridge) * (1 - ridge));
      // Shoulder blades standing out like wings.
      for (const s of [-1, 1]) r += 0.035 * bumpA(a, s * 0.72, u, 0.82, 0.28, 0.066) - 0.012 * bumpA(a, s * 0.4, u, 0.81, 0.12, 0.07);
      // Hollow belly behind the ribs, a sternum ridge under them.
      r -= 0.015 * bumpA(a, Math.PI, u, 0.47, 0.9, 0.08);
      r += 0.01 * bumpA(a, Math.PI, u, 0.76, 0.2, 0.15);
      return r;
    };
    const torsoShade = (u: number, a: number, p: V3): Shade => {
      const { ridge, mask, da } = ribPattern(u, a);
      const vert = (1 - vertebra(u, da)) * Math.exp(-((da / 0.3) ** 2)) * 0.35;
      const under = Math.max(0, -Math.cos(a));
      const flank = 0.3 * (bumpA(a, 1.7, u, 0.3, 0.6, 0.07) + bumpA(a, -1.7, u, 0.3, 0.6, 0.07));
      const blood = under * under * 0.85 + streaks(u * 1.1, da * 0.11, 5) + 0.35 * Math.max(0, perlin3(p.x * 12, p.y * 12, p.z * 12, 11) - 0.1);
      return [mask * (1 - ridge) * 0.85 + vert + flank, blood];
    };
    const spine = [
      new THREE.Vector3(0, -0.03, -0.2),
      new THREE.Vector3(0, 0.02, -0.06),
      new THREE.Vector3(0, 0.1, 0.1),
      new THREE.Vector3(0, 0.19, 0.24),
      new THREE.Vector3(0, 0.225, 0.36),
      new THREE.Vector3(0, 0.21, 0.5),
      new THREE.Vector3(0, 0.13, 0.63),
      new THREE.Vector3(0, 0.07, 0.72),
    ];
    const [lower, upper] = tubeSplit(spine, 86, 30, Math.round(86 * SPLIT), torso, torsoShade);
    add(lower, this.hips);
    add(upper.translate(-CHEST.x, -CHEST.y, -CHEST.z), this.ribs);

    // A stringy neck thrust forward and down.
    this.neck = joint(this.chest, 0, -0.1, 0.4);
    add(
      tube([new THREE.Vector3(0, 0.0, -0.08), new THREE.Vector3(0, -0.01, 0.05), new THREE.Vector3(0, -0.035, 0.15)], 14, 16, (u, a) => {
        const da = Math.abs(angDiff(a, 0));
        let r = ellipse(a, 0.042, 0.05) * (1 - u * 0.12);
        for (const s of [-1, 1]) r += 0.01 * bumpA(a, s * 2.3, u, 0.5, 0.3, 0.5);
        r += 0.012 * Math.pow(Math.max(0, Math.cos(u * Math.PI * 2 * 2.5)), 3) * Math.exp(-((da / 0.25) ** 2));
        return r;
      }, (u, a) => [0.4 * (bumpA(a, 2.7, u, 0.5, 0.25, 0.6) + bumpA(a, -2.7, u, 0.5, 0.25, 0.6)), Math.max(0, -Math.cos(a)) * (0.4 + u * 0.6)]),
      this.neck,
    );

    // Head: a long hairless skull with sunken sockets and a lipless mouth.
    this.head = joint(this.neck, 0, -0.035, 0.15);
    const skullShape = (x: number, y: number, z: number) => {
      let d = 0;
      for (const s of [-1, 1]) {
        d -= 0.26 * Math.exp(-(((x - s * 0.42) ** 2) / 0.05 + ((y - 0.05) ** 2) / 0.04 + ((z - 0.88) ** 2) / 0.08));
        d -= 0.1 * Math.exp(-(((x - s * 0.9) ** 2) / 0.05 + ((y - 0.05) ** 2) / 0.12 + ((z - 0.25) ** 2) / 0.12));
        d += 0.09 * Math.exp(-(((x - s * 0.62) ** 2) / 0.04 + ((y + 0.2) ** 2) / 0.02 + ((z - 0.7) ** 2) / 0.04));
        d -= 0.12 * Math.exp(-(((x - s * 0.75) ** 2) / 0.05 + ((y + 0.55) ** 2) / 0.05 + ((z - 0.45) ** 2) / 0.08));
      }
      d += 0.08 * Math.exp(-((x * x) / 0.3 + ((y - 0.32) ** 2) / 0.02 + ((z - 0.86) ** 2) / 0.03));
      d += 0.06 * Math.exp(-((x * x) / 0.08 + ((y - 0.8) ** 2) / 0.1));
      return d;
    };
    add(
      painted(sculptSphere(0.1, skullShape, new THREE.Vector3(0.64, 0.74, 1.2), 32, 24), (x, y, z) => {
        let cav = 0;
        for (const s of [-1, 1]) {
          cav += 1.6 * Math.exp(-(((x - s * 0.027) ** 2) / 0.0003 + ((y - 0.004) ** 2) / 0.00025 + ((z - 0.1) ** 2) / 0.002));
          cav += 0.6 * Math.exp(-(((x - s * 0.05) ** 2) / 0.0004 + ((y + 0.04) ** 2) / 0.0006 + ((z - 0.05) ** 2) / 0.003));
        }
        cav += 0.4 * Math.max(0, -y / 0.08);
        return [cav, Math.max(0, -y - 0.02) * 10];
      }).translate(0, 0.055, 0.04),
      this.head,
    );
    // Muzzle: cheekbones and a bony upper jaw.
    add(
      painted(
        sculptSphere(0.04, (x, y, z) => -0.25 * Math.exp(-((x * x) / 0.05 + ((y - 0.45) ** 2) / 0.05 + ((z - 0.85) ** 2) / 0.05)) + 0.1 * Math.max(0, z) * Math.max(0, -y), new THREE.Vector3(0.82, 0.5, 1.12), 22, 16),
        (_x, y) => [0.15 + Math.max(0, -y) * 12, 0.2 + Math.max(0, -y) * 20],
      ),
      this.head,
      0,
      -0.004,
      0.1,
    );
    // Nose: a skull's notch, two slits.
    for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.006, 0.022, 3).scale(1, 1, 0.5), m.void, this.head, s * 0.006, 0.03, 0.153).rotation.z = s * 0.35;
    // Eyes burning deep in the sockets.
    for (const s of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.017, 10, 8).scale(1.2, 0.8, 1), m.void, this.head, s * 0.03, 0.056, 0.122);
      mesh(new THREE.SphereGeometry(0.0052, 8, 6), eye, this.head, s * 0.03, 0.056, 0.134);
    }
    // Upper teeth on bare gums.
    mesh(new THREE.TorusGeometry(0.036, 0.006, 5, 16, Math.PI * 0.9).rotateX(Math.PI / 2).rotateY(Math.PI * 0.05).scale(1, 1, 1.3), gum, this.head, 0, -0.022, 0.1);
    for (const g of teethArc(0.034, 0.048, -1.35, 1.35, 13, 0.032, -1)) mesh(g, m.bone, this.head, 0, -0.025, 0.098);

    // Lower jaw hanging open.
    this.jaw = joint(this.head, 0, -0.022, 0.04);
    {
      // A narrow bony bowl, its chin jutting, caked in old blood.
      const jg = new THREE.SphereGeometry(0.05, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.82, 0.42, 1.25);
      const jp = jg.getAttribute('position');
      for (let i = 0; i < jp.count; i++) {
        const z = jp.getZ(i);
        const x = jp.getX(i);
        jp.setY(i, jp.getY(i) * (1 + 0.5 * Math.max(0, z / 0.06)) - 0.006 * Math.exp(-(x * x) / 0.0004) * Math.max(0, z / 0.06));
        jp.setX(i, x * (1 - 0.25 * Math.max(0, z / 0.06)));
      }
      jg.computeVertexNormals();
      add(painted(jg, (_x, y) => [0.2, 0.55 + Math.max(0, -y) * 10]), this.jaw, 0, -0.008, 0.052);
    }
    mesh(new THREE.CircleGeometry(0.04, 14).rotateX(-Math.PI / 2).scale(0.98, 1, 1.5).translate(0, -0.006, 0.052), gum, this.jaw);
    for (const g of teethArc(0.032, 0.05, -1.3, 1.3, 11, 0.03, 1)) mesh(g, m.bone, this.jaw, 0, -0.008, 0.052);
    // A strand of bloody drool.
    mesh(new THREE.CylinderGeometry(0.0025, 0.004, 0.09, 4).translate(0, -0.045, 0), gum, this.jaw, 0.02, -0.02, 0.1);

    // Lank wisps of hair still clinging to the scalp; they swing loose.
    for (let i = 0; i < 18; i++) {
      // Roots on the crown and the back of the skull; strands hang down.
      const ang = (rng() < 0.5 ? -1 : 1) * range(rng, 0.5, 2.9);
      const lift = Math.max(0, Math.cos(ang));
      const root = joint(this.head, Math.sin(ang) * 0.045, 0.1 + lift * 0.035, Math.cos(ang) * 0.06 + 0.035);
      const len = range(rng, 0.16, 0.34);
      const out = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)).normalize();
      const pts = [new THREE.Vector3(), out.clone().multiplyScalar(0.025).add(new THREE.Vector3(0, 0.004, -0.01))];
      for (let k = 1; k <= 3; k++) pts.push(out.clone().multiplyScalar(0.035 + k * 0.006).add(new THREE.Vector3(range(rng, -0.012, 0.012), -len * (k / 3), -0.02 * k)));
      const strand = tube(pts, 10, 4, (u) => 0.004 * (1 - u * 0.7), undefined, new THREE.Vector3(0, 0, 1));
      strand.deleteAttribute('color');
      mesh(strand, hairMat, root);
      this.wisps.push(root);
    }

    // Limbs: overlong, knob-jointed, each a two-bone IK chain.
    const limb = (front: boolean, side: number) => {
      const parent = front ? this.chest : this.hips;
      const at = front ? new THREE.Vector3(side * 0.13, -0.1, 0.33) : new THREE.Vector3(side * 0.115, -0.04, -0.06);
      const a = front ? 0.5 : 0.48;
      const b = front ? 0.53 : 0.52;
      const upper = joint(parent, at.x, at.y, at.z);
      const lower = joint(upper, 0, 0, a);
      const end = joint(lower, 0, 0, b);
      // Shoulder or haunch knob.
      add(painted(sculptSphere(front ? 0.045 : 0.056, (x, y, z) => 0.15 * bump(x, z, side * 0.5, -0.3, 0.4, 0.4) * Math.max(0, y), new THREE.Vector3(1, 0.9, 1.15), 16, 12), () => [0.1, 0.1]), upper);
      // Upper arm or thigh: wasted muscle at the root, thin to the joint,
      // tendons standing out; a bony knob at the far end toward the bend's
      // outside (local +Y, angle 0).
      const upperKeys: [number, number][] = front
        ? [[0, 0.037], [0.12, 0.033], [0.35, 0.023], [0.75, 0.017], [0.92, 0.019], [1, 0.022]]
        : [[0, 0.05], [0.15, 0.045], [0.45, 0.031], [0.82, 0.022], [1, 0.027]];
      const cords = (ang: number, n: number) => Math.pow(Math.max(0, Math.cos(ang * n)), 10);
      add(
        tube([new THREE.Vector3(0, 0, -0.02), new THREE.Vector3(0, 0.004, a * 0.45), new THREE.Vector3(0, 0, a + 0.01)], 22, 14, (u, ang) => {
          const da = Math.abs(angDiff(ang, 0));
          let r = prof(u, upperKeys);
          r += (front ? 0.006 : 0.008) * bumpA(ang, Math.PI, u, 0.3, 0.9, 0.18);
          r += 0.0035 * cords(ang + u, 3) * Math.sin(u * Math.PI);
          r += (front ? 0.012 : 0.016) * Math.exp(-((da / 0.6) ** 2)) * THREE.MathUtils.smoothstep(u, 0.84, 1);
          return r;
        }, (u, ang, p) => [0.35 * (1 - cords(ang + u, 3)) * Math.sin(u * Math.PI) * 0.4, streaks(ang * 0.05, u * 0.5, side * 3 + (front ? 1 : 2)) + 0.3 * Math.max(0, perlin3(p.x * 15, p.y * 15, p.z * 15, 13))]),
        upper,
      );
      // Knobbed elbow or knee: bone pushing at the skin.
      add(
        painted(
          sculptSphere(front ? 0.022 : 0.03, (x, y, z) => 0.3 * Math.max(0, y) * Math.exp(-(z * z) / 0.4) + 0.12 * perlin3(x * 4, y * 4, z * 4, 21), new THREE.Vector3(1, 1.15, 1.1), 16, 12),
          (_x, y) => [0.1 + Math.max(0, y) * 3, 0.15],
        ),
        lower,
      );
      // Forearm or shin: meat near the joint (forearm flexors, calf on the
      // back), down to a bony wrist or ankle with tendons in relief.
      const lowerKeys: [number, number][] = front
        ? [[0, 0.024], [0.15, 0.026], [0.4, 0.02], [0.8, 0.013], [0.95, 0.014], [1, 0.017]]
        : [[0, 0.028], [0.25, 0.025], [0.7, 0.015], [0.95, 0.016], [1, 0.019]];
      add(
        tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.003, b * 0.5), new THREE.Vector3(0, 0, b + 0.012)], 22, 14, (u, ang) => {
          const da = Math.abs(angDiff(ang, 0));
          let r = prof(u, lowerKeys);
          r += 0.004 * Math.exp(-((da / 0.35) ** 2)); // shin or ulna crest
          r += (front ? 0.006 : 0.011) * bumpA(ang, Math.PI, u, 0.22, 0.9, 0.16);
          r += 0.003 * cords(ang + 0.3, 4) * THREE.MathUtils.smoothstep(u, 0.45, 0.85);
          return r;
        }, (u, ang, p) => {
          // Hands and feet are soaked from the blood they wade through.
          const wade = THREE.MathUtils.smoothstep(u, 0.45, 1) * (0.55 + 0.45 * perlin3(p.x * 20, p.y * 20, p.z * 20, 17));
          return [0.2 * (1 - cords(ang + 0.3, 4)) * THREE.MathUtils.smoothstep(u, 0.45, 0.85), wade + streaks(ang * 0.05, u * 0.6, side * 5 + (front ? 3 : 4))];
        }),
        lower,
      );
      // Hand or foot, posed flat to the ground in its own frame.
      const wet = (y: number, ground: number) => 0.35 + 0.55 * Math.min(1, Math.max(0, 1 - (y - ground) * 12));
      if (front) {
        add(
          painted(sculptSphere(0.042, (x, y) => 0.05 * Math.max(0, y) * Math.sin(x * 18), new THREE.Vector3(0.85, 0.32, 1.05), 16, 12), (_x, y) => [0.1, wet(y, -0.07)]),
          end,
          0,
          -0.028,
          0.04,
        );
        for (let i = 0; i < 5; i++) {
          const thumb = i === 4;
          const x0 = thumb ? -side * 0.03 : (i - 1.5) * 0.017 * side;
          const fan = thumb ? -side * 0.9 : (i - 1.5) * 0.17 * side;
          const len = thumb ? 0.7 : i === 0 || i === 3 ? 0.88 : 1;
          const fq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), fan);
          const local = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.032, 0.065), new THREE.Vector3(0, 0.004, 0.135), new THREE.Vector3(0, -0.032, 0.18)].map((p) =>
            p.multiplyScalar(len).applyQuaternion(fq).add(new THREE.Vector3(x0, thumb ? -0.032 : -0.035, thumb ? 0.03 : 0.07)),
          );
          add(
            tube(local, 16, 7, (u) => 0.011 * (1 - u * 0.3) + 0.004 * (Math.exp(-(((u - 0.33) / 0.06) ** 2)) + Math.exp(-(((u - 0.7) / 0.05) ** 2))), (u, _ang, p) => [0.2 * Math.exp(-(((u - 0.5) / 0.1) ** 2)), wet(p.y, -0.07) - 0.1 + u * 0.3]),
            end,
          );
          // Hooked black claw.
          const tip = local[3];
          const dir = local[3].clone().sub(local[2]).normalize();
          const cg = new THREE.ConeGeometry(0.0085, 0.05, 5).translate(0, 0.025, 0).rotateX(0.35);
          cg.applyQuaternion(_q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.add(new THREE.Vector3(0, -0.4, 0)).normalize()));
          mesh(cg, claw, end, tip.x, tip.y, tip.z);
        }
      } else {
        // Long digitigrade foot: heel off the ground, toes splayed.
        add(
          tube([new THREE.Vector3(0, 0.01, -0.035), new THREE.Vector3(0, -0.02, 0.02), new THREE.Vector3(0, -0.075, 0.085), new THREE.Vector3(0, -0.11, 0.13)], 14, 10, (u, ang) => ellipse(ang, 0.03, 0.026) * (1 - u * 0.15) + 0.008 * Math.exp(-((angDiff(ang, 0) / 0.5) ** 2)), (_u, _ang, p) => [0.1, wet(p.y, -0.13)]),
          end,
        );
        for (let i = 0; i < 4; i++) {
          const x0 = (i - 1.5) * 0.017 * side;
          const fan = (i - 1.5) * 0.2 * side;
          const len = i === 0 ? 1.1 : 1 - i * 0.07;
          const fq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), fan);
          const local = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.014, 0.045), new THREE.Vector3(0, -0.01, 0.09)].map((p) => p.multiplyScalar(len).applyQuaternion(fq).add(new THREE.Vector3(x0, -0.112, 0.125)));
          add(tube(local, 10, 6, (u) => 0.011 * (1 - u * 0.3) + 0.003 * Math.exp(-(((u - 0.45) / 0.08) ** 2)), (_u, _ang, p) => [0.1, wet(p.y, -0.13)]), end);
          const tip = local[2];
          const dir = local[2].clone().sub(local[1]).normalize();
          const cg = new THREE.ConeGeometry(0.008, 0.04, 5).translate(0, 0.02, 0);
          cg.applyQuaternion(_q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.add(new THREE.Vector3(0, -0.5, 0)).normalize()));
          mesh(cg, claw, end, tip.x, tip.y, tip.z);
        }
      }
      const heading = new THREE.Vector3(side * (front ? 0.45 : 0.3), 0, 1).normalize();
      const flat = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), heading), new THREE.Vector3(0, 1, 0), heading));
      const home = front ? new THREE.Vector3(side * 0.5, 0.07, 0.46) : new THREE.Vector3(side * 0.42, 0.13, -0.44);
      const pole = front ? new THREE.Vector3(side, 0.55, -0.55).normalize() : new THREE.Vector3(side, 1, 0.4).normalize();
      this.limbs.push({ side, front, upper, lower, end, a, b, home, pole, bend: pole.clone(), target: home.clone(), offset: (front ? 0 : 0.06) + (front === side > 0 ? 0 : 0.5), lift: front ? 0.13 : 0.1, flat, raise: 0 });
    };
    for (const front of [true, false]) for (const side of [-1, 1]) limb(front, side);

    for (const [parent, list] of parts) mesh(mergeGeometries(list)!, skin, parent);
    this.animate(0);
    this.update(0, 0);
    bakeRig(this.root);
  }

  protected animate(dt: number) {
    if (this.dead && !this.acting) return;
    const w = this.walk;
    const t = this.time;
    const p = this.phase;
    const breath = Math.sin(t * 2.4);
    // Torso: two bobs a stride, the spine twisting with the trot.
    this.hips.position.set(0, HIP_Y - 0.07 * w + Math.cos(p * 2) * 0.03 * w + breath * 0.006, HIP_Z);
    this.hips.rotation.set(0.06 * w + Math.sin(p * 2 + 0.6) * 0.03 * w, Math.sin(p) * 0.09 * w, Math.sin(p) * 0.05 * w);
    this.chest.rotation.set(-0.03 * w + breath * 0.012, -Math.sin(p) * 0.14 * w, -Math.sin(p) * 0.05 * w);
    this.ribs.scale.set(1 + breath * 0.025, 1 + breath * 0.035, 1);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);

    // Head: snapping from one point to the next, never still.
    const n = Math.floor(t / 0.85 + this.seed);
    const hash = (k: number) => {
      const s = Math.sin(k * 127.1 + this.seed * 3.7) * 43758.5;
      return s - Math.floor(s);
    };
    const ty = (hash(n) - 0.5) * 1.5 * (1 - w * 0.7) + this.lookYaw;
    const tp = (hash(n + 31) - 0.5) * 0.5 * (1 - w * 0.6);
    const kk = 1 - Math.exp(-dt * 13);
    this.scanYaw += (ty - this.scanYaw) * kk;
    this.scanPitch += (tp - this.scanPitch) * kk;
    const tremor = Math.sin(t * 37) * 0.012 + Math.sin(t * 23) * 0.01;
    this.neck.rotation.set(0.05 + this.scanPitch * 0.5, this.scanYaw * 0.45, 0);
    this.head.rotation.set(-0.12 + this.scanPitch * 0.6 + tremor - Math.cos(p * 2) * 0.05 * w, this.scanYaw * 0.55, Math.sin(t * 0.7) * 0.08 + tremor);
    this.jaw.rotation.x = 0.55 + Math.max(0, Math.sin(t * 1.3)) * 0.15 + Math.max(0, Math.sin(t * 11)) * 0.05;
    this.wisps.forEach((h, i) => {
      h.rotation.x = -this.head.rotation.x * 0.6 + Math.sin(t * 2.3 + i) * 0.1 + w * 0.3;
      h.rotation.z = -this.head.rotation.z * 0.8 + Math.sin(t * 1.7 + i * 2) * 0.12;
    });

    // Limbs: a fast trot with diagonal pairs; fingers tap at rest.
    const stride = (0.62 * Math.PI * 2) / 5.5 / this.body.scale.x;
    const S = stride * Math.min(1, w * 1.5);
    const duty = 0.62;
    for (const l of this.limbs) {
      const c = ((((p / (Math.PI * 2) + l.offset) % 1) + 1) % 1);
      let z: number;
      let y = 0;
      if (c < duty) z = S / 2 - S * (c / duty);
      else {
        const s = (c - duty) / (1 - duty);
        z = -S / 2 + S * (s * s * (3 - 2 * s));
        y = l.lift * Math.sin(Math.PI * s) * Math.min(1, w * 2);
      }
      const idle = 1 - w;
      l.target.copy(l.home);
      l.target.z += z;
      l.target.y += y;
      if (l.front) l.target.y += Math.max(0, Math.sin(t * 1.1 + l.side * 2.2)) ** 8 * 0.05 * idle;
      l.raise = 0;
      l.bend.copy(l.pole);
    }
  }

  update(dt: number, speed: number) {
    if (this.dead && !this.acting) return;
    super.update(dt, speed);
    this.solve();
  }

  /** Places each limb so its hand or foot lands on its target. */
  private solve() {
    this.root.updateMatrixWorld(true);
    const bodyInv = this.body.getWorldQuaternion(_qb).invert();
    for (const l of this.limbs) {
      this.body.worldToLocal(l.upper.getWorldPosition(_r));
      const parentQ = l.upper.parent!.getWorldQuaternion(_q2).premultiply(bodyInv);
      _d.subVectors(l.target, _r);
      const L = THREE.MathUtils.clamp(_d.length(), Math.abs(l.a - l.b) + 0.02, (l.a + l.b) * 0.999);
      _d.normalize();
      _u.copy(l.bend).addScaledVector(_d, -l.bend.dot(_d)).normalize();
      const cosA = THREE.MathUtils.clamp((l.a * l.a + L * L - l.b * l.b) / (2 * l.a * L), -1, 1);
      const upperDir = _k.copy(_d).multiplyScalar(cosA).addScaledVector(_u, Math.sqrt(1 - cosA * cosA));
      const lowerDir = _l.copy(_d).multiplyScalar(L).addScaledVector(upperDir, -l.a).normalize();
      const qU = basis(upperDir, _u, new THREE.Quaternion());
      const qL = basis(lowerDir, _u, new THREE.Quaternion());
      l.upper.quaternion.copy(parentQ.invert()).multiply(qU);
      l.lower.quaternion.copy(qU).invert().multiply(qL);
      const qE = l.flat.clone();
      if (l.raise > 0) qE.slerp(_q.copy(qL).multiply(_q2.setFromAxisAngle(_x.set(1, 0, 0), l.front ? -0.5 : 0.4)), l.raise);
      l.end.quaternion.copy(qL).invert().multiply(qE);
    }
  }
}

export function buildGaunt(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  const g = new Gaunt(m, rng, scale * range(rng, 0.92, 1.05));
  const fronts = g.limbs.filter((l) => l.front);
  return {
    rig: g,
    attack(onHit) {
      let fired = false;
      g.play(0.85, (k) => {
        // Rear up on the hind legs with both hands raised, then rake down
        // and lunge, the jaw gaping; settle back onto all fours.
        const up = ease(k, 0, 0.38) * (1 - ease(k, 0.42, 0.56));
        const rake = ease(k, 0.4, 0.54) * (1 - ease(k, 0.7, 1));
        const back = 1 - ease(k, 0.56, 1);
        g.hips.rotation.x += -0.95 * up + 0.12 * rake;
        g.hips.position.y += 0.1 * up - 0.06 * rake;
        g.hips.position.z += -0.12 * up + 0.22 * rake;
        g.chest.rotation.x += -0.35 * up + 0.2 * rake;
        g.head.rotation.x += 0.6 * up - 0.1 * rake;
        g.neck.rotation.x += 0.3 * up;
        g.jaw.rotation.x = 0.35 + 0.65 * Math.max(up, rake * 0.8);
        for (const l of fronts) {
          const raised = new THREE.Vector3(l.side * 0.34, 1.62, 0.25);
          const struck = new THREE.Vector3(l.side * 0.2, 0.06, 1.05);
          const t = l.target.clone();
          t.lerp(raised, up);
          t.lerp(struck, rake * (k > 0.42 ? 1 : 0));
          l.target.copy(t);
          l.raise = Math.max(up, rake * 0.5) * back;
        }
        if (!fired && k >= 0.5) {
          fired = true;
          onHit();
        }
      });
    },
    flinch() {
      if (g.acting) return;
      g.play(0.3, (k) => {
        const s = Math.sin(k * Math.PI);
        g.chest.rotation.x -= s * 0.3;
        g.hips.position.z -= s * 0.08;
        g.head.rotation.x -= s * 0.4;
        g.jaw.rotation.x = 0.35 + s * 0.5;
      });
    },
    die() {
      g.dead = true;
      g.play(1.4, (k) => {
        // Legs give way, it rolls onto its side and draws its limbs in,
        // twitching, until it lies curled up.
        const drop = ease(k, 0, 0.35);
        const roll = ease(k, 0.2, 0.65);
        const curl = ease(k, 0.3, 0.9);
        const twitch = Math.sin(k * 45) * hump(k, 0.4, 1) * 0.08;
        g.hips.position.y = HIP_Y - drop * 0.52;
        g.hips.rotation.x = 0.2 * curl;
        g.chest.rotation.x = 0.28 * curl + twitch;
        g.neck.rotation.x = 0.6 * curl;
        g.head.rotation.x = 0.6 * curl;
        g.jaw.rotation.x = 0.35 + 0.5 * curl;
        g.body.rotation.z = -1.25 * roll;
        g.body.position.y = (0.1 + 0.03 * Math.sin(roll * Math.PI)) * roll * g.body.scale.y;
        for (const l of g.limbs) {
          // Arms drawn in under the chin, knees folded up to the belly.
          // It lies on its right side (+X down): every limb folds along
          // the body toward the floor, not up into the air.
          const x = l.side > 0 ? 0.05 : -0.14;
          const tucked = l.front ? new THREE.Vector3(x, 0.24, 0.66) : new THREE.Vector3(x, 0.28, 0.2);
          l.target.lerp(tucked, curl);
          l.target.y += twitch * (l.front ? 1 : -1);
          l.bend.lerp(l.front ? new THREE.Vector3(0.5, -0.2, -1) : new THREE.Vector3(0.5, -0.2, 1), curl).normalize();
          l.raise = curl;
        }
      });
    },
    muzzle() {
      return g.head.localToWorld(new THREE.Vector3(0, -0.02, 0.15));
    },
  };
}
