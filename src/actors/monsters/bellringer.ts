import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { perlin3, range, type Rng } from '../../procgen/noise';
import { bump, sculptLathe, sculptSphere } from '../sculpt';
import { boxProjectUVs } from '../../procgen/geometry';
import { BasicRig, ease, hump } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Bellringer Ghoul: the starved dead that walk the Pilgrim Road in packs,
// ringing the pilgrims home. A gaunt, stooped thing in a deep pointed hood
// and a tattered near-black green robe that hangs open down the front over a
// grey-green torso of nothing but ribs and breastbone, the belly sucked in
// beneath them. Under the hood a skull wears its taut grey skin like
// parchment: hollow cheeks, a lipless grin of long teeth and two red coals
// for eyes. A brown sash is knotted at the waist, its ends hanging down the
// front; the robe is torn into strips that end at the shins, over legs wound
// in dark rags and cord, and long-toed bare feet. In its right fist it drags
// a length of heavy rusted chain ending in a shackle; from its left hangs a
// brass lantern by its ring, a red flame behind the panes. The chain is
// simulated link by link and the lantern swings as a pendulum; it lashes the
// chain overhead and slams it down in front of it.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = THREE.MathUtils.lerp;

/** Drops the triangles of an indexed geometry whose centroid fails `keep`: ragged hems and holes. */
function tear(geo: THREE.BufferGeometry, keep: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const idx = geo.index;
  const p = geo.getAttribute('position');
  const out: number[] = [];
  const n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    if (keep((p.getX(a) + p.getX(b) + p.getX(c)) / 3, (p.getY(a) + p.getY(b) + p.getY(c)) / 3, (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3)) out.push(a, b, c);
  }
  geo.setIndex(out);
  return geo;
}

/** Cheap deterministic 1D hash noise in [-1, 1] for ragged edges. */
const jag = (x: number, seed: number) => Math.sin(x * 12.9898 + seed * 78.233) * 0.6 + Math.sin(x * 31.7 + seed * 3.1) * 0.4;
/** Sawtooth tatters: 0 between points, 1 at each point. */
const tatter = (u: number) => Math.pow(1 - Math.abs(2 * (u - Math.floor(u)) - 1), 1.6);

/** Grey-green dead skin; the face paler, like old bone. */
const SKIN = new THREE.Color(0.13, 0.19, 0.11);
const FACE = new THREE.Color(0.34, 0.36, 0.28);
const HOLLOW = new THREE.Color(0.07, 0.08, 0.06);
const tmpC = new THREE.Color();

/** Paints vertex colours on a skin part: mottled tone, `shade(p)` = [cavity, paleness]. */
function paint(geo: THREE.BufferGeometry, shade?: (p: THREE.Vector3) => [number, number]): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const [cav, pale] = shade ? shade(p) : [0, 0];
    const mottle = 0.88 + 0.16 * perlin3(p.x * 11 + 3, p.y * 11, p.z * 11, 7) + 0.07 * perlin3(p.x * 37, p.y * 37, p.z * 37, 8);
    tmpC.copy(SKIN).lerp(FACE, Math.min(1, pale)).multiplyScalar(mottle).lerp(HOLLOW, Math.min(1, Math.max(0, cav)));
    col[i * 3] = tmpC.r;
    col[i * 3 + 1] = tmpC.g;
    col[i * 3 + 2] = tmpC.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * Rotten cloth: grime and mildew mottling, darker low down and in the folds,
 * the torn edges frayed lighter. Works in bind-pose space.
 */
function rotCloth(base: THREE.Material, color: THREE.Color, key: string, mildew = new THREE.Color(0.75, 0.85, 0.55)): THREE.MeshStandardMaterial {
  const mat = (base as THREE.MeshStandardMaterial).clone();
  mat.color = color;
  mat.side = THREE.DoubleSide;
  mat.customProgramCacheKey = () => key;
  const uniforms = { uMildew: { value: mildew } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRotP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRotP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRotP;
        uniform vec3 uMildew;
        float cHash( vec3 p ) { return fract( sin( dot( p, vec3( 269.5, 183.3, 246.1 ) ) ) * 43758.5453 ); }
        float cNoise( vec3 p ) {
          vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( cHash( i ), cHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( cHash( i + vec3( 0, 1, 0 ) ), cHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( cHash( i + vec3( 0, 0, 1 ) ), cHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( cHash( i + vec3( 0, 1, 1 ) ), cHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 p = vRotP;
          float n = cNoise( p * 5.0 ) * 0.6 + cNoise( p * 15.0 ) * 0.4;
          float mold = smoothstep( 0.55, 0.85, cNoise( p * 3.0 + 11.0 ) * 0.7 + cNoise( p * 21.0 ) * 0.3 );
          vec3 c = mix( vec3( 1.15 ), vec3( 0.6 ), smoothstep( 0.3, 0.75, n ) );
          c *= mix( 0.7, 1.0, smoothstep( 0.0, 0.9, p.y ) );
          c = mix( c, uMildew, mold * 0.45 );
          diffuseColor.rgb *= c;
        }`,
      );
  };
  return mat;
}

/** A grid surface: `at(u, v)` gives the point for u, v in [0, 1]. */
function gridSurface(cols: number, rows: number, at: (u: number, v: number, out: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      at(i / cols, j / rows, p);
      pos.push(p.x, p.y, p.z);
      uv.push((i / cols) * 2, (j / rows) * 3);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface Arm {
  side: number;
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  fingers: THREE.Object3D[][];
}
interface Leg {
  side: number;
  thigh: THREE.Object3D;
  shin: THREE.Object3D;
  foot: THREE.Object3D;
}
interface Panel {
  j: THREE.Object3D;
  /** Angle of the panel's centre around the body (0 front, + toward +X). */
  a: number;
}

const HIP_Y = 0.97;
const THIGH = 0.43;
const SHIN = 0.42;
const ANKLE = 0.07;
/** Chain: link pitch and count (about 1.3 m; the end drags on the floor at rest). */
const PITCH = 0.085;
const LINKS = 15;
/** Lantern: distance from the hand's ring to its centre of mass. */
const LANTERN_ARM = 0.17;

class Bellringer extends BasicRig {
  readonly hips: THREE.Object3D;
  readonly spine: THREE.Object3D;
  readonly chest: THREE.Object3D;
  readonly ribs: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly arms: Arm[] = [];
  readonly legs: Leg[] = [];
  readonly panels: Panel[] = [];
  readonly tails: THREE.Object3D[] = [];
  readonly links: THREE.Object3D[] = [];
  readonly shackle: THREE.Object3D;
  readonly lantern: THREE.Object3D;
  readonly flameMat: THREE.MeshBasicMaterial;
  readonly paneMat: THREE.MeshBasicMaterial;
  readonly eyeMat: THREE.MeshBasicMaterial;
  dead = false;
  /** 0..1: the flame and eyes, faded out as it dies. */
  glow = 1;
  /** Attack chain shape: blend weight and the proximal/distal angles (from up, toward +Z). */
  lash = { w: 0, a0: 0, a1: 0, x: 0 };
  /** Chain and lantern let go of (on death). */
  chainFree = false;
  lanternFree = false;
  private seed: number;
  private pts: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  /** Lantern as a two-point stick in world space: ring (pivot) and centre of mass. */
  private lp = [new THREE.Vector3(), new THREE.Vector3()];
  private lq = [new THREE.Vector3(), new THREE.Vector3()];
  private inited = false;
  private gripR = new THREE.Vector3(0, -0.085, 0.012);
  private gripL = new THREE.Vector3(0, -0.085, 0.012);
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, 4.6, 3.4);
    this.seed = range(rng, 0, 100);
    const skin = (m.ghoulSkin as THREE.MeshStandardMaterial).clone();
    skin.color.setRGB(1, 1, 1);
    skin.vertexColors = true;
    const robe = rotCloth(m.robe, new THREE.Color(0.085, 0.12, 0.095), 'bellRobe');
    const olive = rotCloth(m.robe, new THREE.Color(0.45, 0.47, 0.16), 'bellOlive');
    const sash = rotCloth(m.rag, new THREE.Color(0.3, 0.2, 0.085), 'bellSash', new THREE.Color(0.6, 0.55, 0.45));
    const wraps = rotCloth(m.rag, new THREE.Color(0.1, 0.11, 0.14), 'bellWraps');
    const trim = new THREE.MeshStandardMaterial({ color: 0x3a0e0a, roughness: 0.8 });
    const cord = new THREE.MeshStandardMaterial({ color: 0x3b2414, roughness: 0.85 });
    const wristCord = new THREE.MeshStandardMaterial({ color: 0x4a1c14, roughness: 0.7 });
    const nail = new THREE.MeshStandardMaterial({ color: 0x8c7a2c, roughness: 0.45 });
    const tooth = new THREE.MeshStandardMaterial({ color: 0xb0a47e, roughness: 0.45 });
    const iron = (m.iron as THREE.MeshStandardMaterial).clone();
    iron.color = new THREE.Color(0.4, 0.27, 0.2);
    const brass = (m.steel as THREE.MeshStandardMaterial).clone();
    brass.color = new THREE.Color(0.95, 0.68, 0.28);
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.12), fog: false });
    this.flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 1.6, 0.4), fog: false });
    this.paneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.12, 0.04), fog: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });

    // Skin parts are merged per joint (keeping their vertex colours) before the bake.
    const parts = new Map<THREE.Object3D, THREE.BufferGeometry[]>();
    const add = (geo: THREE.BufferGeometry, parent: THREE.Object3D, x = 0, y = 0, z = 0, rot?: THREE.Euler, shade?: (p: THREE.Vector3) => [number, number]) => {
      if (!geo.getAttribute('color')) paint(geo, shade);
      if (rot) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot));
      geo.translate(x, y, z);
      for (const n of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(n)) geo.deleteAttribute(n);
      if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
      const list = parts.get(parent) ?? [];
      list.push(geo.index ? geo.toNonIndexed() : geo);
      parts.set(parent, list);
    };

    // --- Torso -----------------------------------------------------------
    this.hips = joint(this.body, 0, HIP_Y, 0);
    this.spine = joint(this.hips, 0, 0.1, 0);
    this.chest = joint(this.spine, 0, 0.18, 0);
    this.ribs = joint(this.chest, 0, 0, 0);

    // Rib cage: chevrons of ribs running down and out from the breastbone,
    // the lower ones starting further out so the cage arches over the belly.
    const RX = 1.02;
    const RZ = 0.72;
    const ribField = (y: number, t: number) => {
      const at = Math.abs(t);
      let ridge = 0;
      let mask = 0;
      for (let i = 0; i < 7; i++) {
        const ys = 0.205 - i * 0.034;
        const yr = ys - 0.085 * Math.pow(Math.min(at, 2.2), 1.15);
        const arch = Math.max(0, (0.165 - ys) * 7);
        const mi = smooth(arch, arch + 0.22, at) * smooth(2.4, 1.8, at);
        ridge += mi * Math.exp(-(((y - yr) / 0.0115) ** 2));
        mask = Math.max(mask, mi * Math.exp(-(((y - yr) / 0.03) ** 2)));
      }
      return { ridge: Math.min(1, ridge), mask };
    };
    const ribDisp = (y: number, t: number) => {
      const { ridge, mask } = ribField(y, t);
      let d = mask * (0.012 * ridge - 0.007 * (1 - ridge));
      d += 0.011 * Math.exp(-((t / 0.1) ** 2)) * smooth(0.0, 0.07, y) * smooth(0.25, 0.2, y); // breastbone
      d -= 0.006 * Math.exp(-(((Math.abs(t) - 0.2) / 0.07) ** 2)) * smooth(0.04, 0.1, y) * smooth(0.24, 0.18, y);
      // Collarbones, and the hollows above and below them.
      const yc = 0.262 - 0.03 * Math.abs(t);
      d += 0.008 * Math.exp(-(((y - yc) / 0.01) ** 2)) * smooth(1.2, 0.8, Math.abs(t)) * smooth(0.05, 0.15, Math.abs(t));
      d -= 0.008 * Math.exp(-(((y - yc + 0.025) / 0.012) ** 2)) * smooth(1.1, 0.7, Math.abs(t)) * smooth(0.1, 0.3, Math.abs(t));
      // Shoulder blades.
      for (const s of [-1, 1]) d += 0.014 * bump(t, y, s * 2.55, 0.17, 0.35, 0.07);
      return d;
    };
    const ribProfile: [number, number][] = [
      [0.128, -0.1],
      [0.142, -0.03],
      [0.152, 0.05],
      [0.153, 0.13],
      [0.143, 0.2],
      [0.118, 0.25],
      [0.075, 0.29],
      [0.045, 0.31],
    ];
    const cage = sculptLathe(ribProfile, (_x, y, _z, t) => ribDisp(y, t), { seg: 28, perSpan: 7, sx: RX, sz: RZ });
    add(cage, this.ribs, 0, 0, 0, undefined, (p) => {
      const t = Math.atan2(p.x / RX, p.z / RZ);
      const { ridge, mask } = ribField(p.y, t);
      const yc = 0.262 - 0.03 * Math.abs(t);
      const pit = Math.exp(-(((p.y - yc + 0.025) / 0.014) ** 2)) * smooth(1.1, 0.7, Math.abs(t)) * smooth(0.1, 0.3, Math.abs(t));
      return [mask * (1 - ridge) * 0.75 + pit * 0.4, ridge * mask * 0.9 + Math.exp(-((t / 0.1) ** 2)) * smooth(0.0, 0.07, p.y) * 0.5];
    });

    // Belly: sucked in under the arch of the ribs, hip bones jutting.
    const BX = 1.02;
    const BZ = 0.74;
    const bellyDisp = (y: number, t: number) => {
      let d = -0.016 * bump(t, y, 0, 0.06, 0.75, 0.07);
      d += 0.004 * bump(t, y, 0, -0.02, 0.18, 0.05); // a last stringy band of muscle
      for (const s of [-1, 1]) d += 0.012 * bump(t, y, s * 1.0, -0.1, 0.25, 0.035);
      return d;
    };
    const belly = sculptLathe(
      [
        [0.125, -0.13],
        [0.117, -0.05],
        [0.106, 0.04],
        [0.112, 0.1],
        [0.124, 0.15],
      ],
      (_x, y, _z, t) => bellyDisp(y, t),
      { seg: 24, perSpan: 4, sx: BX, sz: BZ },
    );
    add(belly, this.spine, 0, 0, 0, undefined, (p) => {
      const t = Math.atan2(p.x / BX, p.z / BZ);
      return [bump(t, p.y, 0, 0.07, 0.6, 0.06) * 0.45 + bump(t, p.y, 0, 0.14, 0.5, 0.03) * 0.35, 0];
    });

    // --- Head ------------------------------------------------------------
    this.head = joint(this.chest, 0, 0.29, 0.025);
    add(
      sculptLathe(
        [
          [0.042, -0.05],
          [0.034, 0.0],
          [0.031, 0.05],
          [0.036, 0.1],
        ],
        (_x, y, _z, t) => 0.006 * bump(t, y, 0.5, 0.02, 0.25, 0.06) + 0.006 * bump(t, y, -0.5, 0.02, 0.25, 0.06) + 0.004 * bump(t, y, 0, 0.03, 0.2, 0.02),
        { seg: 14, perSpan: 3, sz: 0.95 },
      ),
      this.head,
      0,
      0,
      -0.01,
      undefined,
      () => [0.25, 0.1],
    );
    // Skull under taut skin. Unit-sphere layout: eyes y 0.1, nose -0.12, mouth -0.5.
    const face = (x: number, y: number, z: number) => {
      const front = smooth(0.35, 0.85, z);
      let d = 0;
      for (const s of [-1, 1]) {
        d -= 0.3 * bump(x, y, s * 0.38, 0.08, 0.25, 0.21) * front; // eye sockets
        d += 0.09 * bump(x, y, s * 0.56, -0.1, 0.17, 0.1) * smooth(0.1, 0.6, z); // cheekbones
        d -= 0.2 * bump(x, y, s * 0.52, -0.42, 0.2, 0.17) * smooth(0.0, 0.6, z); // hollow cheeks
        d -= 0.07 * bump(x, y, s * 0.78, 0.25, 0.18, 0.25); // temples
      }
      d += 0.07 * bump(x, y, 0, 0.32, 0.65, 0.08) * front; // brow
      d -= 0.13 * bump(x, y, 0, -0.14, 0.08, 0.1) * front; // nose hole
      d += 0.1 * bump(x, y, 0, -0.55, 0.32, 0.17) * front; // teeth jut
      d -= 0.17 * smooth(-0.55, -1, y) * (1 - 0.5 * front); // narrow jaw
      d += 0.08 * smooth(0.3, 0.9, y) * smooth(0.2, -0.6, z); // long cranium
      return d;
    };
    const SK = new THREE.Vector3(0.8, 1.04, 0.92);
    const SKR = 0.1;
    const skullC = new THREE.Vector3(0, 0.125, 0.012);
    const faceShade = (ux: number, uy: number, uz: number): [number, number] => {
      const front = smooth(0.35, 0.85, uz);
      let cav = 0;
      for (const s of [-1, 1]) {
        cav += 1.7 * bump(ux, uy, s * 0.38, 0.08, 0.23, 0.19) * front;
        cav += 0.85 * bump(ux, uy, s * 0.52, -0.42, 0.17, 0.15) * smooth(0.0, 0.6, uz);
        cav += 0.35 * bump(ux, uy, s * 0.8, 0.2, 0.2, 0.3);
        cav -= 0.2 * bump(ux, uy, s * 0.56, -0.1, 0.15, 0.08) * smooth(0.1, 0.6, uz);
      }
      cav += 1.5 * bump(ux, uy, 0, -0.15, 0.07, 0.09) * front;
      cav -= 0.25 * bump(ux, uy, 0, 0.33, 0.6, 0.08) * front;
      return [cav, 1 - smooth(-0.2, -0.7, uz) * 0.5];
    };
    // The face is a dense patch over the front of the skull, so the sockets
    // and cheeks hold their shape; the back of the skull is coarse.
    const unitAt = (lon: number, lat: number) => new THREE.Vector3(Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat));
    const mask = gridSurface(30, 28, (u, v, out) => {
      const n = unitAt(lerp(-1.3, 1.3, u), lerp(1.15, -1.4, v));
      const r = SKR * (1 + face(n.x, n.y, n.z));
      out.set(n.x * r * SK.x, n.y * r * SK.y, n.z * r * SK.z);
    });
    // No lips: the skin is torn away from the teeth.
    tear(mask, (x, y, z) => {
      const ux = x / (SKR * SK.x);
      const uy = y / (SKR * SK.y);
      return !(z > 0 && Math.abs(ux) < 0.4 - (uy + 0.53) * (uy + 0.53) * 2.2 && uy > -0.7 && uy < -0.36);
    });
    mask.deleteAttribute('uv');
    const mp = mask.getAttribute('position');
    const mcol = new Float32Array(mp.count * 3);
    for (let i = 0; i < mp.count; i++) {
      const x = mp.getX(i) / (SKR * SK.x);
      const y = mp.getY(i) / (SKR * SK.y);
      const z = mp.getZ(i) / (SKR * SK.z);
      const l = Math.hypot(x, y, z) || 1;
      const [cav, pale] = faceShade(x / l, y / l, z / l);
      const mottle = 0.9 + 0.12 * perlin3(x * 3, y * 3, z * 3, 9);
      tmpC.copy(SKIN).lerp(FACE, pale).multiplyScalar(mottle).lerp(HOLLOW, Math.min(1, Math.max(0, cav)));
      mcol.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    }
    mask.setAttribute('color', new THREE.BufferAttribute(mcol, 3));
    boxProjectUVs(mask, 6);
    add(mask, this.head, skullC.x, skullC.y, skullC.z);
    const back = sculptSphere(SKR * 0.985, face, SK, 18, 14);
    tear(back, (x, y, z) => {
      const n = new THREE.Vector3(x / SK.x, y / SK.y, z / SK.z).normalize();
      const lon = Math.atan2(n.x, n.z);
      const lat = Math.asin(n.y);
      return !(Math.abs(lon) < 1.15 && lat < 1.05 && lat > -1.3);
    });
    add(back, this.head, skullC.x, skullC.y, skullC.z, undefined, (p) => {
      const n = p.clone().divide(SK).normalize();
      return faceShade(n.x, n.y, n.z);
    });
    // Lipless grin: long upper and lower teeth over a dark gap.
    const mouthY = skullC.y - 0.052;
    mesh(new THREE.BoxGeometry(0.05, 0.026, 0.02), m.void, this.head, 0, mouthY, skullC.z + 0.072);
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < 8; i++) {
        const a = (i - 3.5) * 0.25;
        const h = (row ? 0.016 : 0.02) * (1 - Math.abs(i - 3.5) * 0.07);
        const g = new THREE.CylinderGeometry(0.0032, 0.0026, h, 5).scale(1, 1, 0.7);
        g.translate(0, row ? h / 2 : -h / 2, 0);
        const t = mesh(g, tooth, this.head, Math.sin(a) * 0.03, mouthY + (row ? -0.012 : 0.012), skullC.z + 0.082 + (Math.cos(a) - 1) * 0.03);
        t.rotation.set(row ? -0.1 : 0.1, a, range(rng, -0.08, 0.08));
      }
    // Sockets: dark pits, a coal of red in each.
    for (const s of [-1, 1]) {
      const ex = s * 0.38 * SKR * SK.x;
      const ey = skullC.y + 0.08 * SKR * SK.y;
      mesh(new THREE.SphereGeometry(0.02, 10, 8).scale(1, 0.9, 0.6), m.void, this.head, ex, ey, skullC.z + 0.056);
      const eye = mesh(new THREE.SphereGeometry(0.0095, 10, 8), this.eyeMat, this.head, ex * 0.95, ey - 0.002, skullC.z + 0.066);
      eye.castShadow = false;
    }
    // Nose hole: an inverted heart of shadow.
    mesh(new THREE.ConeGeometry(0.011, 0.026, 3).rotateZ(Math.PI).scale(1, 1, 0.6), m.void, this.head, 0, skullC.y - 0.015, skullC.z + 0.083);

    // Hood: deep and pointed, the peak drawn up and back, flaring down onto
    // the shoulders; the face recessed in its opening.
    const HS = new THREE.Vector3(1.0, 1.16, 1.12);
    const HR = 0.138;
    const hoodC = new THREE.Vector3(0, 0.128, 0.012);
    const hoodDisp = (x: number, y: number, z: number) => {
      let d = 0.62 * Math.exp(-((x / 0.32) ** 2) - (((y - 0.85) / 0.35) ** 2) - (((z + 0.4) / 0.5) ** 2)); // peak
      d += 0.035 * Math.sin(Math.atan2(x, z) * 5 + y * 4) * smooth(0.6, -0.6, y); // folds
      d += 0.4 * smooth(-0.3, -1, y); // flare to the shoulders
      d += 0.1 * bump(x, y, 0, 0.55, 0.6, 0.3) * smooth(0.2, 0.9, z); // brim over the brow
      return d;
    };
    const EX = 0.64;
    const EY = 0.8;
    const EY0 = -0.08;
    const hood = sculptSphere(HR, hoodDisp, HS, 28, 22);
    tear(hood, (x, y, z) => {
      const ux = x / (HR * HS.x);
      const uy = y / (HR * HS.y);
      const uz = z / (HR * HS.z);
      const l = Math.hypot(ux, uy, uz) || 1;
      const nx = ux / l;
      const ny = uy / l;
      const nz = uz / l;
      if (ny < -0.86) return false;
      return !(nz > 0 && (nx / EX) ** 2 + ((ny - EY0) / EY) ** 2 < 1);
    });
    mesh(hood, robe, this.head, hoodC.x, hoodC.y, hoodC.z);
    // A thin dark-red hem around the opening.
    const rim: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) {
      const f = (i / 40) * Math.PI * 2;
      const ux = EX * Math.cos(f);
      const uy = EY0 + EY * Math.sin(f);
      if (uy < -0.83) continue;
      const uz = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
      const r = HR * (1 + hoodDisp(ux, uy, uz));
      rim.push(new THREE.Vector3(ux * r * HS.x, uy * r * HS.y, uz * r * HS.z).add(hoodC));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, false), 48, 0.0045, 4, false), trim, this.head);
    // Shadow filling the hood behind the face.
    mesh(new THREE.SphereGeometry(0.1, 12, 10).scale(1, 1.15, 0.8), m.void, this.head, 0, 0.13, -0.035);

    // --- Mantle, back of the robe and the olive under-rags -----------------
    const CX = 1.17;
    const CZ = 0.86;
    const mantle = sculptLathe(
      [
        [0.07, 0.33],
        [0.15, 0.3],
        [0.207, 0.255],
        [0.229, 0.19],
        [0.237, 0.11],
        [0.242, 0.03],
        [0.247, -0.07],
      ],
      (_x, y, _z, t) => (0.012 * Math.sin(t * 7 + 1) + 0.006 * Math.sin(t * 13 + y * 9)) * smooth(0.28, 0.0, y),
      { seg: 44, perSpan: 3, sx: CX, sz: CZ },
    );
    tear(mantle, (x, y, z) => {
      const t = Math.atan2(x / CX, z / CZ);
      const at = Math.abs(t);
      // Open down the front from the throat.
      if (at < 0.18 + (0.31 - y) * 2.6 + jag(y * 9, 1) * 0.04) return false;
      // Hem: higher at the front, lower behind, torn into points.
      const backness = smooth(0.8, 2.6, at);
      const hem = lerp(0.12, -0.03, backness) - 0.07 * tatter(t * 2.2 + 0.5) * (0.4 + backness) + jag(t * 3, 2) * 0.012;
      return y > hem;
    });
    mesh(mantle, robe, this.chest);
    // Dark-red edge along the mantle's front opening.
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const y = 0.31 - i * 0.026;
        const t = s * (0.2 + (0.31 - y) * 2.6);
        const r = y > 0.255 ? lerp(0.15, 0.207, (0.3 - y) / 0.045) : lerp(0.207, 0.237, Math.min(1, (0.255 - y) / 0.145));
        pts.push(new THREE.Vector3(Math.sin(t) * r * CX * 1.02, y, Math.cos(t) * r * CZ * 1.02));
      }
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.0035, 4, false), trim, this.chest);
    }
    // Back of the robe, from the shoulders to the waist (open at the front).
    const backPanel = sculptLathe(
      [
        [0.15, 0.25],
        [0.168, 0.18],
        [0.172, 0.05],
        [0.158, -0.1],
        [0.152, -0.2],
        [0.165, -0.32],
      ],
      (_x, y, _z, t) => 0.005 * Math.sin(t * 6 + y * 4),
      { seg: 30, perSpan: 3, sx: 1.2, sz: 0.85 },
    );
    tear(backPanel, (x, _y, z) => Math.abs(Math.atan2(x / 1.2, z / 0.85)) > 1.3);
    mesh(backPanel, robe, this.chest);
    // Olive under-rags showing in jagged points below the mantle at the back.
    const rags = sculptLathe(
      [
        [0.232, 0.04],
        [0.226, -0.08],
        [0.21, -0.24],
      ],
      (_x, y, _z, t) => 0.004 * Math.sin(t * 9 + y * 20),
      { seg: 48, perSpan: 4, sx: CX, sz: CZ },
    );
    tear(rags, (x, y, z) => {
      const t = Math.atan2(x / CX, z / CZ);
      if (Math.abs(t) < 2.05) return false;
      return y > -0.1 - 0.13 * tatter(t * 3.3 + 0.3) + jag(t * 5, 3) * 0.012;
    });
    mesh(rags, olive, this.chest);

    // --- Arms --------------------------------------------------------------
    for (const side of [-1, 1]) {
      const shoulder = joint(this.chest, side * 0.162, 0.24, -0.012);
      const up = joint(shoulder, 0, 0, 0);
      add(sculptSphere(0.04, (x, y) => 0.15 * bump(x, y, side * 0.5, 0.3, 0.4, 0.4), new THREE.Vector3(1, 0.95, 0.9), 12, 10), shoulder, side * 0.008, 0.005, 0);
      add(
        sculptLathe(
          [
            [0.034, 0.02],
            [0.036, -0.04],
            [0.03, -0.15],
            [0.025, -0.25],
            [0.031, -0.3],
          ],
          (_x, y, _z, t) => 0.008 * bump(t, y, Math.PI, -0.29, 0.5, 0.03) + 0.004 * bump(t, y, 0, -0.08, 0.5, 0.06),
          { seg: 12, perSpan: 3, sz: 0.92 },
        ),
        up,
        0,
        0,
        0,
        undefined,
        (p) => [0.15 * smooth(0, -0.03, p.z) * smooth(-0.1, -0.2, p.y), 0],
      );
      const fore = joint(up, 0, -0.295, 0);
      add(
        sculptLathe(
          [
            [0.028, 0.03],
            [0.03, -0.04],
            [0.025, -0.16],
            [0.018, -0.26],
            [0.02, -0.29],
          ],
          (_x, y, _z, t) => 0.006 * bump(t, y, 0.5, -0.06, 0.6, 0.06) + 0.004 * bump(t, y, side * 1.5, -0.27, 0.4, 0.02),
          { seg: 12, perSpan: 3, sx: 1.1, sz: 0.85 },
        ),
        fore,
      );
      // Twists of cord round the wrist.
      for (let i = 0; i < 2; i++) {
        const b = mesh(new THREE.TorusGeometry(0.022, 0.0055, 3, 12).rotateX(Math.PI / 2), wristCord, fore, 0, -0.235 - i * 0.017, 0);
        b.rotation.z = (i - 0.5) * 0.25;
      }
      const hand = joint(fore, 0, -0.29, 0);
      add(sculptSphere(0.034, (x, y, z) => 0.12 * smooth(0.2, 0.8, y) + 0.05 * bump(x, z, 0, -1, 1, 0.4) * smooth(0, -0.6, y), new THREE.Vector3(0.95, 1.25, 0.42), 12, 10), hand, 0, -0.04, 0.003);
      const fingers: THREE.Object3D[][] = [];
      for (let f = 0; f < 5; f++) {
        const thumb = f === 4;
        const base = thumb ? joint(hand, -side * 0.028, -0.025, 0.016) : joint(hand, -side * (f - 1.5) * 0.0165, -0.08, 0.004);
        if (thumb) base.rotation.set(0.25, 0, side * 0.55);
        const lens = thumb ? [0.034, 0.028] : [0.042 - Math.abs(f - 1.2) * 0.004, 0.032, 0.026];
        const chain: THREE.Object3D[] = [];
        let parent = base;
        for (let s = 0; s < lens.length; s++) {
          const j = s === 0 ? base : joint(parent, 0, -lens[s - 1], 0);
          const r = 0.0072 - s * 0.0011;
          add(new THREE.CylinderGeometry(r * 0.85, r, lens[s], 5, 1, true).translate(0, -lens[s] / 2, 0), j);
          add(new THREE.SphereGeometry(r * 1.2, 5, 3), j, 0, 0, 0, undefined, () => [0, 0.15]);
          chain.push(j);
          parent = j;
        }
        mesh(new THREE.SphereGeometry(0.005, 4, 3).scale(1, 1.4, 0.45), nail, parent, 0, -lens[lens.length - 1] + 0.003, 0.004);
        fingers.push(chain);
      }
      this.arms.push({ side, upper: up, fore, hand, fingers });
    }

    // --- Legs, wrapped in dark rags and cord; bare bony feet --------------
    for (const side of [-1, 1]) {
      const thigh = joint(this.hips, side * 0.085, -0.05, 0);
      const tg = sculptLathe(
        [
          [0.062, 0.05],
          [0.062, -0.05],
          [0.054, -0.22],
          [0.046, -0.38],
          [0.044, -0.45],
        ],
        (_x, y, _z, t) => 0.005 * Math.sin(t * 5 + y * 30) + 0.003 * Math.sin(t * 11 - y * 17),
        { seg: 14, perSpan: 3, sz: 0.95 },
      );
      mesh(tg, wraps, thigh);
      const shin = joint(thigh, 0, -THIGH, 0);
      const sg = sculptLathe(
        [
          [0.046, 0.04],
          [0.047, -0.05],
          [0.04, -0.18],
          [0.033, -0.3],
          [0.03, -0.34],
        ],
        (_x, y, _z, t) => 0.004 * Math.sin(t * 6 + y * 40),
        { seg: 14, perSpan: 3, sz: 0.95 },
      );
      mesh(
        tear(sg, (x, y, z) => y > -0.33 + jag(Math.atan2(x, z) * 2, side + 5) * 0.03),
        wraps,
        shin,
      );
      // Criss-crossed cord binding the rags to the shin.
      for (let i = 0; i < 5; i++) {
        const y = -0.08 - i * 0.05;
        const r = lerp(0.047, 0.032, (i * 0.05 + 0.03) / 0.28) + 0.004;
        const b = mesh(new THREE.TorusGeometry(r, 0.0045, 3, 12).rotateX(Math.PI / 2).scale(1, 1, 0.95), cord, shin, 0, y, 0);
        b.rotation.x = (i % 2 ? 1 : -1) * 0.32;
      }
      add(
        sculptLathe(
          [
            [0.03, -0.27],
            [0.025, -0.36],
            [0.028, -0.42],
          ],
          (_x, y, _z, t) => 0.006 * bump(t, y, side * 1.6, -0.4, 0.4, 0.02) + 0.006 * bump(t, y, Math.PI, -0.37, 0.3, 0.04),
          { seg: 10, perSpan: 3 },
        ),
        shin,
      );
      const foot = joint(shin, 0, -SHIN, 0);
      // A long bony foot: tendons and metatarsals standing out on top.
      add(
        sculptSphere(
          0.048,
          (x, y, z) => {
            let d = -0.35 * smooth(-0.35, -0.9, y);
            for (let i = 0; i < 4; i++) d += 0.06 * Math.exp(-(((x - (i - 1.5) * 0.42) / 0.12) ** 2)) * smooth(0.0, 0.6, y) * smooth(-0.6, 0.5, z);
            d += 0.15 * bump(y, z, -0.2, -0.9, 0.5, 0.3); // heel
            return d;
          },
          new THREE.Vector3(0.88, 0.8, 2.3),
          16,
          12,
        ),
        foot,
        0,
        -0.04,
        0.052,
        undefined,
        (p) => [0.2 + 0.2 * smooth(-0.04, -0.07, p.y), 0],
      );
      for (let i = 0; i < 5; i++) {
        const big = i === 0;
        const x = -side * (0.026 - i * 0.012) * (big ? 1.05 : 1);
        const len = big ? 0.04 : 0.036 - i * 0.003;
        const r = big ? 0.011 : 0.0075 - i * 0.0005;
        const toe = joint(foot, x, -0.058, 0.152 - i * 0.008);
        toe.rotation.set(Math.PI / 2 + 0.1, 0, 0);
        add(new THREE.CapsuleGeometry(r, len, 1, 5).translate(0, len / 2, 0), toe);
        add(new THREE.SphereGeometry(r * 1.25, 5, 3), toe, 0, len * 0.35, 0, undefined, () => [0, 0.15]);
        mesh(new THREE.SphereGeometry(r * 0.85, 5, 3).scale(1, 1.2, 0.45), nail, toe, 0, len + r * 0.5, -r * 0.55);
      }
      this.legs.push({ side, thigh, shin, foot });
    }
    // Rag loincloth over the pelvis.
    mesh(
      sculptLathe(
        [
          [0.135, 0.09],
          [0.14, 0.0],
          [0.13, -0.08],
          [0.1, -0.12],
        ],
        (_x, y, _z, t) => 0.004 * Math.sin(t * 7 + y * 20),
        { seg: 20, perSpan: 3, sx: 1.15, sz: 0.8 },
      ),
      wraps,
      this.hips,
    );

    // --- Robe skirt: panels round the hips torn into strips at the hem -----
    const GAP = 0.33;
    const N = 8;
    const span = (Math.PI * 2 - GAP * 2) / N;
    for (let i = 0; i < N; i++) {
      const a0 = GAP + i * span - 0.05;
      const a1 = GAP + (i + 1) * span + 0.05;
      const ac = (a0 + a1) / 2;
      const j = joint(this.hips, 0, 0.07, 0);
      const lift = (i % 2) * 0.004;
      const g = gridSurface(10, 10, (u, v, out) => {
        const t = lerp(a0, a1, u);
        const back = 0.5 - 0.5 * Math.cos(t);
        const len = 0.66 + 0.07 * back + 0.08 * tatter(t * 2.4 + i * 0.37) + jag(t * 4, i) * 0.025;
        const r = lerp(0.152 + lift, 0.235 + lift, Math.pow(v, 1.4)) + (0.012 * Math.sin(t * 9 + i) + 0.008 * Math.sin(t * 17)) * v;
        out.set(Math.sin(t) * r * 1.2, -v * len, Math.cos(t) * r * 0.92);
      });
      tear(g, (x, y, z) => {
        const t = Math.atan2(x / 1.2, z / 0.92);
        const tt = t < 0 ? t + Math.PI * 2 : t;
        const v = -y / 0.7;
        // Opening down the front widens toward the hem.
        if (tt < GAP + v * 0.22 || tt > Math.PI * 2 - GAP - v * 0.22) return false;
        // Strips: narrow rents up from the hem.
        const s = (tt * 4.1 + i * 0.29) % 1;
        if (v > 0.58 + jag(tt * 3, i + 2) * 0.1 && (s < 0.07 || s > 0.95)) return false;
        return true;
      });
      mesh(g, robe, j);
      this.panels.push({ j, a: ac });
    }

    // --- Sash: knotted at the waist, the ends hanging down the front --------
    mesh(
      sculptLathe(
        [
          [0.158, 0.12],
          [0.162, 0.08],
          [0.16, 0.035],
        ],
        (_x, y, _z, t) => 0.006 * Math.sin(t * 6 + y * 50) + 0.004 * Math.sin(t * 13),
        { seg: 28, perSpan: 3, sx: 1.2, sz: 0.93 },
      ),
      sash,
      this.hips,
    );
    // A second twisted loop slung lower round the hips.
    mesh(new THREE.TorusGeometry(0.165, 0.012, 5, 28).rotateX(Math.PI / 2).scale(1.2, 1, 0.93), sash, this.hips, 0, 0.03, 0).rotation.z = 0.06;
    const knotT = -0.32;
    const knot = new THREE.Vector3(Math.sin(knotT) * 0.163 * 1.2, 0.07, Math.cos(knotT) * 0.163 * 0.93 + 0.01);
    mesh(sculptSphere(0.03, (x, y) => 0.15 * Math.sin(x * 6 + y * 4), new THREE.Vector3(1.2, 0.95, 0.7), 10, 8), sash, this.hips, knot.x, knot.y, knot.z);
    const tailDefs: [number, number, number, number][] = [
      // [x offset, length, width, yaw]
      [-0.012, 0.6, 0.075, 0.1],
      [0.02, 0.36, 0.062, -0.25],
    ];
    for (const [ox, len, wid, yaw] of tailDefs) {
      const tj = joint(this.hips, knot.x + ox, knot.y - 0.01, knot.z + 0.008);
      tj.rotation.y = yaw;
      const g = gridSurface(4, 10, (u, v, out) => {
        const w = wid * (0.85 + 0.25 * v) * (1 - 0.3 * Math.sin(v * 5));
        out.set((u - 0.5) * w + Math.sin(v * 4) * 0.008, -v * len, 0.006 * Math.sin(u * 6 + v * 8) + v * 0.02);
      });
      tear(g, (x, y) => -y < len - 0.05 + jag(x * 60, len) * 0.04);
      mesh(g, sash, tj);
      this.tails.push(tj);
    }
    // One more end hanging at the back on the left.
    const bt = joint(this.hips, Math.sin(2.4) * 0.17 * 1.2, 0.06, Math.cos(2.4) * 0.17 * 0.93);
    bt.rotation.y = 2.4;
    const bg = gridSurface(4, 10, (u, v, out) => out.set((u - 0.5) * 0.065 * (1 + 0.3 * v), -v * 0.5, 0.008 * Math.sin(u * 5 + v * 9) + v * 0.025));
    mesh(
      tear(bg, (x, y) => -y < 0.45 + jag(x * 50, 3) * 0.04),
      sash,
      bt,
    );
    this.tails.push(bt);

    // --- Chain ---------------------------------------------------------------
    // Links are positioned every frame from the simulation, in body space.
    const linkGeo = new THREE.TorusGeometry(0.026, 0.0088, 4, 10).scale(1, 1.55, 1);
    for (let i = 0; i < LINKS; i++) {
      const l = joint(this.body, 0, 0, 0);
      const lm = mesh(linkGeo, iron, l);
      lm.rotation.y = i % 2 ? Math.PI / 2 : 0;
      this.links.push(l);
    }
    // The shackle: a heavy oval ring and its pin.
    this.shackle = joint(this.body, 0, 0, 0);
    mesh(new THREE.TorusGeometry(0.044, 0.011, 6, 16).scale(1, 1.45, 1), iron, this.shackle, 0, -0.07, 0);
    mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.1, 6).rotateZ(Math.PI / 2), iron, this.shackle, 0, -0.012, 0);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.013, 6, 5), iron, this.shackle, s * 0.05, -0.012, 0);

    // --- Lantern ---------------------------------------------------------------
    // Hangs from its ring in the left fist; pivot at the ring, hanging down -Y.
    this.lantern = joint(this.body, 0, 0, 0);
    const L = this.lantern;
    mesh(new THREE.TorusGeometry(0.016, 0.004, 5, 12), brass, L, 0, -0.004, 0);
    for (let i = 0; i < 2; i++) mesh(new THREE.TorusGeometry(0.01, 0.0028, 4, 10).rotateY(i ? 0 : Math.PI / 2), brass, L, 0, -0.03 - i * 0.017, 0);
    mesh(new THREE.TorusGeometry(0.018, 0.004, 5, 12), brass, L, 0, -0.064, 0);
    // Cap: a stepped dome with a finial collar.
    mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.014, 8), brass, L, 0, -0.084, 0);
    mesh(new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), brass, L, 0, -0.118, 0);
    mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.012, 12), brass, L, 0, -0.122, 0);
    // Cage: six posts, arched windows of red glass.
    const cageTop = -0.128;
    const cageBot = -0.25;
    const R = 0.055;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      mesh(new THREE.BoxGeometry(0.008, cageTop - cageBot, 0.008), brass, L, Math.sin(a) * R, (cageTop + cageBot) / 2, Math.cos(a) * R).rotation.y = a;
      const am = a + Math.PI / 6;
      const w = R * 0.95;
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(w / 2, 0);
      shape.lineTo(w / 2, 0.07);
      shape.absarc(0, 0.07, w / 2, 0, Math.PI, false);
      shape.lineTo(-w / 2, 0);
      const pane = mesh(new THREE.ShapeGeometry(shape, 6), this.paneMat, L, Math.sin(am) * R * 0.86, cageBot + 0.012, Math.cos(am) * R * 0.86);
      pane.rotation.y = am;
      pane.castShadow = false;
      // Arched brass frame over each window.
      const arch = mesh(new THREE.TorusGeometry(w / 2, 0.003, 4, 10, Math.PI), brass, L, Math.sin(am) * R * 0.88, cageBot + 0.082, Math.cos(am) * R * 0.88);
      arch.rotation.y = am;
    }
    mesh(new THREE.CylinderGeometry(0.064, 0.06, 0.014, 12), brass, L, 0, cageBot - 0.004, 0);
    mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.02, 12), brass, L, 0, cageBot - 0.02, 0);
    // Spikes round the base and one long one beneath.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const sp = mesh(new THREE.ConeGeometry(0.008, 0.05, 5).rotateX(Math.PI), brass, L, Math.sin(a) * 0.056, cageBot - 0.032, Math.cos(a) * 0.056);
      sp.rotation.set(Math.cos(a) * -0.25, 0, Math.sin(a) * 0.25);
    }
    mesh(new THREE.ConeGeometry(0.01, 0.05, 6).rotateX(Math.PI), brass, L, 0, cageBot - 0.055, 0);
    // The candle's red flame.
    const flame = mesh(new THREE.SphereGeometry(0.018, 10, 8).scale(1, 1.7, 1), this.flameMat, L, 0, cageBot + 0.045, 0);
    flame.castShadow = false;
    mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 8), new THREE.MeshStandardMaterial({ color: 0x6a1a10, roughness: 0.6 }), L, 0, cageBot + 0.017, 0);
    const halo = mesh(new THREE.SphereGeometry(0.04, 10, 8), this.paneMat, L, 0, cageBot + 0.05, 0);
    halo.castShadow = false;

    // Pose once, finish the skin and bake.
    for (const [parent, list] of parts) {
      const merged = mergeGeometries(list);
      if (merged) mesh(merged, skin, parent);
    }
    this.animate(0);
    this.root.updateMatrixWorld(true);
    bakeRig(this.root);
    this.root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9 * scale, 0.4 * scale), 2.4 * scale);
    });
  }

  update(dt: number, speed: number) {
    super.update(dt, speed);
    this.simulate(Math.min(dt, 1 / 20));
    // The flame gutters; dying, it fades out with the eyes.
    const t = this.time;
    const flick = 0.82 + 0.1 * Math.sin(t * 13.1 + this.seed) + 0.06 * Math.sin(t * 29.7) + 0.05 * Math.sin(t * 5.3 + 2);
    const g = this.glow;
    this.flameMat.color.setRGB(6 * flick * g, 1.6 * flick * flick * g, 0.4 * g);
    this.paneMat.color.setRGB(2.4 * (0.75 + 0.25 * flick) * g + 0.05, 0.12 * flick * g + 0.01, 0.04 * g + 0.005);
    this.eyeMat.color.setRGB(5 * g + 0.02, 0.35 * g, 0.14 * g);
  }

  protected animate(_dt: number) {
    if (this.dead) return;
    const t = this.time;
    const w = this.walk;
    const ph = this.phase;
    const breath = Math.sin(t * 1.6 + this.seed);

    // Legs: a loping shamble, the right foot dragging a short step.
    let hipY = 0;
    const thighs: number[] = [];
    for (const leg of this.legs) {
      const s = leg.side;
      const p = ph + (s > 0 ? 0 : Math.PI);
      const amp = s > 0 ? 0.42 : 0.32;
      const lift = s > 0 ? 1.0 : 0.65;
      const th = -Math.sin(p) * amp * w - 0.05 + 0.03 * (1 - w) * s;
      const sh = 0.14 + w * (0.95 * lift * Math.pow(Math.max(0, Math.cos(p)), 1.3) + 0.1);
      leg.thigh.rotation.x = th;
      leg.thigh.rotation.z = s * (0.035 + 0.02 * (1 - w));
      leg.shin.rotation.x = sh;
      leg.foot.rotation.x = -(th + sh) + w * 0.25 * Math.sin(p - 0.6) * (s > 0 ? 1 : 0.6);
      hipY = Math.max(hipY, THIGH * Math.cos(th) + SHIN * Math.cos(th + sh));
      thighs.push(th);
    }
    this.hips.position.y = hipY + ANKLE + 0.05 - 0.008 * breath * (1 - w);
    this.hips.position.z = 0.02;
    // The lurch: hips roll and the body lists toward the planted foot.
    this.hips.rotation.y = Math.sin(ph) * 0.13 * w;
    this.hips.rotation.z = Math.sin(ph) * 0.05 * w;
    this.hips.rotation.x = 0.04 + 0.05 * w;

    // Stooped and hunched, breathing in slow heaves; leaning into the walk.
    this.spine.rotation.x = 0.16 + 0.1 * w + 0.015 * breath;
    this.spine.rotation.y = -Math.sin(ph) * 0.1 * w;
    this.spine.rotation.z = -Math.sin(ph) * 0.04 * w;
    this.chest.rotation.x = 0.14 + 0.02 * breath + 0.04 * Math.abs(Math.sin(ph)) * w;
    this.chest.rotation.z = Math.sin(t * 0.7 + this.seed) * 0.02;
    this.ribs.scale.set(1 + breath * 0.02, 1 + breath * 0.025, 1 + breath * 0.03);
    this.head.rotation.x = -0.32 - 0.06 * w + 0.03 * Math.sin(t * 1.6 + this.seed + 0.6) + Math.sin(ph * 2) * 0.05 * w;
    this.head.rotation.y = this.lookYaw * 0.6 + Math.sin(t * 0.37 + this.seed) * 0.12 * (1 - w);
    this.head.rotation.z = Math.sin(t * 0.5 + this.seed) * 0.06 + Math.sin(ph) * 0.05 * w;

    for (const arm of this.arms) {
      const s = arm.side;
      // Right arm hangs with the chain; left holds the lantern a little out.
      const lantern = s > 0;
      const swing = Math.sin(ph + (s > 0 ? Math.PI : 0)) * w;
      arm.upper.rotation.x = (lantern ? -0.18 : -0.06) + swing * (lantern ? 0.18 : 0.42) - 0.02 * breath;
      arm.upper.rotation.z = s * (lantern ? 0.2 : 0.17) + s * 0.01 * breath;
      arm.upper.rotation.y = 0;
      arm.fore.rotation.x = (lantern ? -0.5 : -0.18) - Math.max(0, swing) * 0.2 - 0.04 * breath;
      arm.fore.rotation.y = lantern ? -0.3 : 0.25;
      arm.hand.rotation.x = lantern ? 0.25 : 0.05;
      arm.hand.rotation.z = 0;
      // Both fists closed: one round the chain, one through the lantern ring.
      for (const [i, chain] of arm.fingers.entries())
        chain.forEach((j, n) => (j.rotation.x = i === 4 ? (n ? 0.5 : 0.3) : n === 0 ? 1.2 : 1.35));
    }

    // Robe panels: pushed by the knees, trailing in the walk, swaying.
    const [thL, thR] = this.legs[0].side > 0 ? [thighs[0], thighs[1]] : [thighs[1], thighs[0]];
    for (const p of this.panels) {
      const sa = Math.sin(p.a);
      const ca = Math.cos(p.a);
      const th = thL * (0.5 + 0.5 * sa) + thR * (0.5 - 0.5 * sa);
      const push = ca > 0 ? Math.min(0, th) * ca * 1.05 : Math.max(0, th) * -ca * 0.85;
      p.j.rotation.x = push + w * 0.12 * (0.6 - 0.4 * ca) + 0.02 * Math.sin(t * 1.7 + p.a * 2) + 0.05 * w * Math.sin(ph * 2 + p.a * 1.7);
      p.j.rotation.z = sa * (0.02 * Math.sin(t * 1.3 + p.a) + 0.04 * w * Math.sin(ph + p.a));
    }
    for (const [i, tj] of this.tails.entries()) {
      tj.rotation.x = (i < 2 ? Math.min(0, thR) * 0.9 : Math.max(0, thL) * 0.7) + 0.05 * Math.sin(t * 1.9 + i * 2) + 0.12 * w * (0.5 + 0.5 * Math.sin(ph * 2 + i));
      tj.rotation.z = 0.06 * Math.sin(t * 1.4 + i) + 0.07 * w * Math.sin(ph + i);
    }
  }

  private gripWorld(side: number, out: THREE.Vector3) {
    const arm = this.arms.find((a) => a.side === side)!;
    return arm.hand.localToWorld(out.copy(side > 0 ? this.gripL : this.gripR));
  }

  /** Verlet chain from the right fist and the lantern pendulum from the left, in world space. */
  private simulate(dt: number) {
    this.root.updateMatrixWorld(true);
    const sc = this.body.scale.x;
    const pitch = PITCH * sc;
    const groundY = this.root.getWorldPosition(this.v1).y;
    const hand = this.gripWorld(-1, new THREE.Vector3());
    const ring = this.gripWorld(1, new THREE.Vector3());
    if (!this.inited || this.pts[0].distanceTo(hand) > 3 * sc) {
      this.inited = true;
      this.pts = [];
      this.prev = [];
      for (let i = 0; i <= LINKS; i++) {
        const p = hand.clone();
        p.y = Math.max(groundY + 0.012 * sc, hand.y - i * pitch);
        // Whatever doesn't fit hangs out behind along the floor.
        const over = i * pitch - (hand.y - groundY);
        if (over > 0) p.z -= over;
        this.pts.push(p);
        this.prev.push(p.clone());
      }
      this.lp[0].copy(ring);
      this.lp[1].copy(ring).y -= LANTERN_ARM * sc;
      this.lq[0].copy(this.lp[0]);
      this.lq[1].copy(this.lp[1]);
    }
    const g = 9.8 * dt * dt;
    const bodyQ = this.body.getWorldQuaternion(this.q1);
    const steps = 2;
    const h = dt / steps;
    const gh = g / (steps * steps);
    const P = this.pts;
    const Q = this.prev;
    const floor = groundY + 0.012 * sc;
    for (let s = 0; s < steps; s++) {
      for (let i = this.chainFree ? 0 : 1; i < P.length; i++) {
        const p = P[i];
        const q = Q[i];
        const vx = (p.x - q.x) * 0.985;
        const vy = (p.y - q.y) * 0.985;
        const vz = (p.z - q.z) * 0.985;
        q.copy(p);
        p.x += vx;
        p.y += vy - gh;
        p.z += vz;
      }
      if (!this.chainFree) P[0].copy(hand);
      // The lash pulls the chain toward its scripted arc.
      const L = this.lash;
      if (L.w > 0 && !this.chainFree) {
        const d = this.v2;
        const cur = hand.clone();
        for (let i = 1; i < P.length; i++) {
          const a = lerp(L.a0, L.a1, i / (P.length - 1));
          d.set(L.x, Math.cos(a), Math.sin(a)).normalize().applyQuaternion(bodyQ);
          cur.addScaledVector(d, pitch);
          const tx = Math.max(cur.y, floor);
          const dx = (cur.x - P[i].x) * L.w;
          const dy = (tx - P[i].y) * L.w;
          const dz = (cur.z - P[i].z) * L.w;
          P[i].x += dx;
          P[i].y += dy;
          P[i].z += dz;
          Q[i].x += dx * 0.75;
          Q[i].y += dy * 0.75;
          Q[i].z += dz * 0.75;
        }
      }
      for (let it = 0; it < 8; it++) {
        for (let i = 0; i < P.length - 1; i++) {
          const a = P[i];
          const b = P[i + 1];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const len = Math.hypot(dx, dy, dz) || 1e-6;
          const k = (len - pitch) / len;
          const pinned = i === 0 && !this.chainFree;
          const wa = pinned ? 0 : 0.5;
          const wb = pinned ? 1 : 0.5;
          a.x += dx * k * wa;
          a.y += dy * k * wa;
          a.z += dz * k * wa;
          b.x -= dx * k * wb;
          b.y -= dy * k * wb;
          b.z -= dz * k * wb;
        }
        for (let i = 0; i < P.length; i++) {
          if (P[i].y < floor) {
            P[i].y = floor;
            // Friction: links on the floor drag rather than slide.
            Q[i].x = lerp(Q[i].x, P[i].x, 0.25);
            Q[i].z = lerp(Q[i].z, P[i].z, 0.25);
            Q[i].y = P[i].y;
          }
        }
      }
      // Lantern: ring pinned to the fist (until dropped), a stick to the body of it.
      const [r, c] = this.lp;
      const [rq, cq] = this.lq;
      const sway = 0.15 * Math.sin(this.time * 0.9 + this.seed) * h * h;
      for (const [p, q, free] of [
        [r, rq, this.lanternFree],
        [c, cq, true],
      ] as const) {
        if (!free) continue;
        const vx = (p.x - q.x) * 0.975;
        const vy = (p.y - q.y) * 0.975;
        const vz = (p.z - q.z) * 0.975;
        q.copy(p);
        p.x += vx + sway;
        p.y += vy - gh;
        p.z += vz + sway * 0.6;
      }
      if (!this.lanternFree) {
        rq.copy(r);
        r.copy(ring);
      }
      const len = LANTERN_ARM * sc;
      for (let it = 0; it < 3; it++) {
        const d = this.v2.subVectors(c, r);
        const k = (d.length() - len) / (d.length() || 1e-6);
        if (this.lanternFree) {
          r.addScaledVector(d, k * 0.5);
          c.addScaledVector(d, -k * 0.5);
        } else c.addScaledVector(d, -k);
        const lf = groundY + 0.05 * sc;
        for (const [p, q] of [
          [r, rq],
          [c, cq],
        ] as const)
          if (p.y < lf) {
            p.y = lf;
            q.x = lerp(q.x, p.x, 0.3);
            q.z = lerp(q.z, p.z, 0.3);
            q.y = p.y;
          }
      }
    }

    // Place the links and the shackle along the simulated points (body space).
    const inv = this.q2.copy(bodyQ).invert();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = 0; i < LINKS; i++) {
      this.body.worldToLocal(a.copy(P[i]));
      this.body.worldToLocal(b.copy(P[i + 1]));
      const link = this.links[i];
      link.position.addVectors(a, b).multiplyScalar(0.5);
      dir.subVectors(a, b);
      if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
      link.quaternion.setFromUnitVectors(this.up, dir.normalize());
    }
    this.body.worldToLocal(a.copy(P[LINKS]));
    this.body.worldToLocal(b.copy(P[LINKS - 1]));
    this.shackle.position.copy(a);
    dir.subVectors(b, a);
    if (dir.lengthSq() > 1e-10) this.shackle.quaternion.setFromUnitVectors(this.up, dir.normalize());
    // The lantern hangs from its ring toward its centre of mass.
    const [r, c] = this.lp;
    this.body.worldToLocal(a.copy(r));
    this.lantern.position.copy(a);
    dir.subVectors(r, c).applyQuaternion(inv);
    if (dir.lengthSq() > 1e-10) this.lantern.quaternion.setFromUnitVectors(this.up, dir.normalize());
  }
}

export function buildBellringer(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  const c = new Bellringer(m, rng, scale * range(rng, 0.97, 1.04));
  const R = c.arms.find((a) => a.side < 0)!;
  return {
    rig: c,
    attack(onHit) {
      // The chain lash: the right arm draws back and up, the chain trailing
      // behind it; then the arm whips over and down, the chain arcs over its
      // head and slams onto the floor in front of it.
      let fired = false;
      c.play(
        1.35,
        (k) => {
          const wind = ease(k, 0.05, 0.36) * (1 - ease(k, 0.4, 0.52));
          const strike = ease(k, 0.38, 0.54) * (1 - ease(k, 0.72, 1.0));
          const shake = hump(k, 0.54, 0.64) * Math.sin(k * 140) * 0.03;
          c.spine.rotation.y += -0.45 * wind + 0.3 * strike;
          c.spine.rotation.x += -0.18 * wind + 0.34 * strike + shake;
          c.chest.rotation.x += -0.08 * wind + 0.12 * strike;
          c.head.rotation.x += 0.1 * wind - 0.15 * strike;
          c.hips.position.z += 0.16 * strike - 0.04 * wind;
          c.hips.position.y -= 0.05 * strike;
          for (const l of c.legs) {
            const lead = l.side < 0;
            l.thigh.rotation.x += lead ? -0.45 * strike : 0.22 * strike;
            l.shin.rotation.x += lead ? 0.3 * strike : 0.12 * strike;
            l.foot.rotation.x += lead ? 0.15 * strike : -0.3 * strike;
          }
          // Right arm: overhead behind, then whipped down and forward.
          const up = lerp(lerp(R.upper.rotation.x, -2.7, wind), -1.05, strike);
          R.upper.rotation.x = up;
          R.upper.rotation.z = lerp(R.upper.rotation.z, -0.35, wind) * (1 - strike) + -0.12 * strike;
          R.upper.rotation.y = 0.3 * wind;
          R.fore.rotation.x = lerp(R.fore.rotation.x, -1.1, wind) * (1 - strike) - 0.12 * strike;
          R.hand.rotation.x = 0.3 * wind - 0.2 * strike;
          // The other arm flung out for balance, the lantern swinging.
          const Lf = c.arms.find((a) => a.side > 0)!;
          Lf.upper.rotation.x += 0.15 * wind - 0.2 * strike;
          Lf.upper.rotation.z += 0.15 * strike;
          // Chain: hanging back from the raised fist, then sweeping over the
          // top and down to the floor, the end lagging behind the fist.
          const sweep = ease(k, 0.38, 0.55);
          const a0 = sweep < 0.5 ? lerp(-2.6, -0.2, sweep * 2) : lerp(-0.2, 2.6, sweep * 2 - 1);
          const a1 = sweep < 0.5 ? lerp(-2.9, -1.5, sweep * 2) : lerp(-1.5, 2.15, sweep * 2 - 1);
          const settle = ease(k, 0.55, 0.65);
          c.lash.a0 = a0;
          c.lash.a1 = lerp(a1, 1.6, settle);
          c.lash.x = -0.12 * wind;
          c.lash.w = 0.55 * ease(k, 0.1, 0.3) * (1 - ease(k, 0.62, 0.85));
          if (!fired && k >= 0.55) {
            fired = true;
            onHit();
          }
        },
        () => {
          c.lash.w = 0;
          if (!fired) onHit();
        },
      );
    },
    flinch() {
      if (c.acting) return;
      c.play(0.36, (k) => {
        const s = Math.sin(k * Math.PI);
        c.spine.rotation.x -= 0.3 * s;
        c.chest.rotation.x -= 0.12 * s;
        c.head.rotation.x -= 0.3 * s;
        c.hips.position.z -= 0.05 * s;
        for (const a of c.arms) {
          a.upper.rotation.x += 0.35 * s;
          a.upper.rotation.z += a.side * 0.15 * s;
        }
      });
    },
    die() {
      // It jerks back and lets go: the lantern drops from its fist, the chain
      // slithers to the floor; the knees give and it folds forward onto the
      // stones, the flame inside the fallen lantern dying.
      c.cancelAction();
      c.lash.w = 0;
      c.dead = true;
      const roll = Math.random() < 0.5 ? -1 : 1;
      const st = {
        sp: c.spine.rotation.x,
        ch: c.chest.rotation.x,
        hd: c.head.rotation.x,
        hy: c.hips.position.y,
        legs: c.legs.map((l) => [l.thigh.rotation.x, l.shin.rotation.x, l.foot.rotation.x]),
        arms: c.arms.map((a) => [a.upper.rotation.x, a.upper.rotation.z, a.fore.rotation.x]),
      };
      c.play(2.6, (k) => {
        const s = k * 2.6;
        if (s > 0.12) c.lanternFree = true;
        if (s > 0.3) c.chainFree = true;
        c.glow = 1 - ease(s, 0.5, 1.7);
        const jerk = hump(s, 0, 0.25);
        const buckle = ease(s, 0.15, 0.55);
        const fall = Math.min(1, Math.max(0, (s - 0.45) / 0.55)) ** 2;
        const settle = ease(s, 0.95, 1.4);
        const bounce = hump(s, 1.0, 1.2) * 0.02;
        // Knees give: it drops onto them, then topples forward over them.
        c.body.rotation.x = 1.38 * fall;
        c.body.rotation.y = roll * 0.3 * fall;
        c.body.rotation.z = roll * 0.12 * settle;
        c.body.position.y = 0.1 * fall + bounce;
        c.body.position.z = -0.25 * fall;
        c.hips.position.y = lerp(st.hy, 0.62, buckle * (1 - fall));
        c.hips.rotation.y = 0;
        c.hips.rotation.z = 0;
        c.hips.rotation.x = 0;
        for (const [i, l] of c.legs.entries()) {
          const [t0, s0, f0] = st.legs[i];
          l.thigh.rotation.x = lerp(lerp(t0, -0.85, buckle), -0.15 - (l.side === roll ? 0.2 : 0), fall);
          l.shin.rotation.x = lerp(lerp(s0, 1.55, buckle), 0.5 + (l.side === roll ? 0.4 : 0.1), fall);
          l.foot.rotation.x = lerp(lerp(f0, -0.6, buckle), 0.6, fall);
        }
        c.spine.rotation.x = lerp(st.sp, 0.35, buckle) - 0.2 * jerk - 0.25 * settle;
        c.chest.rotation.x = lerp(st.ch, 0.2, buckle) - 0.1 * jerk - 0.1 * settle;
        c.head.rotation.x = lerp(st.hd, 0.3, buckle) - 0.3 * jerk - 0.5 * settle;
        c.head.rotation.y = roll * 0.6 * settle;
        c.head.rotation.z = roll * 0.3 * settle;
        for (const [i, a] of c.arms.entries()) {
          const [u0, z0, f0] = st.arms[i];
          const flop = ease(s, 0.5, 1.2);
          a.upper.rotation.x = lerp(u0 + 0.4 * jerk, a.side === roll ? -2.6 : -0.4, flop);
          a.upper.rotation.z = lerp(z0, a.side * (a.side === roll ? 0.5 : 0.25), flop);
          a.fore.rotation.x = lerp(f0, -0.3, flop);
          // The fists open.
          const open = ease(s, a.side > 0 ? 0.05 : 0.25, a.side > 0 ? 0.2 : 0.45);
          for (const [fi, chain] of a.fingers.entries()) for (const j of chain) j.rotation.x = lerp(j.rotation.x, fi === 4 ? 0.1 : 0.35, open);
        }
        for (const p of c.panels) {
          const ca = Math.cos(p.a);
          p.j.rotation.x = lerp(p.j.rotation.x, ca > 0 ? -0.9 * fall : 0.2 + 0.5 * fall, 0.2);
        }
      });
    },
  };
}
