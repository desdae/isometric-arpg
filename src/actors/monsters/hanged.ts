import * as THREE from 'three';
import { joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { bump, sculptLathe, sculptSphere } from '../sculpt';
import { BasicRig, ease, hump } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// The Hanged: a corpse that never came down. It drifts a metre above the
// floor on a hemp rope that runs up out of sight, toes pointing at the
// ground, turning slowly as hanged men do. A burlap execution sack is pulled
// over its head and torn at the mouth, where a few teeth show; the noose bites
// into a neck stretched long and broken, so the head lolls away from the knot.
// It wears a filthy, torn shift over ragged breeches; its skin is grey and
// bloated, mottled with bruises, and the blood has settled dark and purple in
// its hands and feet. It reaches for the throat.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Drops the triangles of an indexed geometry whose centroid fails `keep`: ragged holes and torn hems. */
function tear(geo: THREE.BufferGeometry, keep: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const idx = geo.index;
  const p = geo.getAttribute('position');
  const out: number[] = [];
  const n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    const x = (p.getX(a) + p.getX(b) + p.getX(c)) / 3;
    const y = (p.getY(a) + p.getY(b) + p.getY(c)) / 3;
    const z = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
    if (keep(x, y, z)) out.push(a, b, c);
  }
  geo.setIndex(out);
  return geo;
}

/** Cheap deterministic 1D hash noise in [-1, 1] for ragged edges. */
const jag = (x: number, seed: number) => Math.sin(x * 12.9898 + seed * 78.233) * 0.6 + Math.sin(x * 31.7 + seed * 3.1) * 0.4;

/**
 * Three-strand laid rope along a curve: a tube whose section has three lobes
 * that spiral along its length, so it reads as twisted hemp up close.
 */
function laidRope(curve: THREE.Curve<THREE.Vector3>, r: number, tubular: number, closed = false, pitch = 0.055): THREE.BufferGeometry {
  const radial = 9;
  const frames = curve.computeFrenetFrames(tubular, closed);
  const len = curve.getLength();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    curve.getPointAt(u, P);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const along = u * len;
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      const lobe = 0.8 + 0.32 * Math.pow(Math.abs(Math.cos(1.5 * (v + (along / pitch) * ((Math.PI * 2) / 3)))), 0.7);
      const rr = r * lobe;
      pos.push(P.x + rr * (Math.cos(v) * N.x + Math.sin(v) * B.x), P.y + rr * (Math.cos(v) * N.y + Math.sin(v) * B.y), P.z + rr * (Math.cos(v) * N.z + Math.sin(v) * B.z));
      uv.push(along * 6, j / radial);
    }
  }
  for (let i = 0; i < tubular; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const line = (a: THREE.Vector3, b: THREE.Vector3) => new THREE.LineCurve3(a, b);

/**
 * Dead skin: grey, with bruises and greenish decay mottling it and fine dark
 * marbling, and the blood settled into whatever hangs lowest (feet, shins,
 * hands). Works from bind-pose positions, so the pattern sticks to the body.
 */
function deadSkin(base: THREE.Material, hands: THREE.Vector3[], liveY: number): THREE.MeshStandardMaterial {
  const mat = (base as THREE.MeshStandardMaterial).clone();
  mat.color = new THREE.Color(0.5, 0.5, 0.5);
  mat.roughness = 0.62;
  const uniforms = { uHandL: { value: hands[0] }, uHandR: { value: hands[1] }, uLiveY: { value: liveY } };
  mat.customProgramCacheKey = () => 'hangedSkin';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDeadP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDeadP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vDeadP;
        uniform vec3 uHandL;
        uniform vec3 uHandR;
        uniform float uLiveY;
        float dHash( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
        float dNoise( vec3 p ) {
          vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( dHash( i ), dHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( dHash( i + vec3( 0, 1, 0 ) ), dHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( dHash( i + vec3( 0, 0, 1 ) ), dHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( dHash( i + vec3( 0, 1, 1 ) ), dHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 p = vDeadP;
          float n = dNoise( p * 7.0 ) * 0.6 + dNoise( p * 19.0 ) * 0.4;
          float bruise = smoothstep( 0.6, 0.78, n );
          float rot = smoothstep( 0.55, 0.8, dNoise( p * 4.5 + 17.0 ) );
          float vein = 1.0 - smoothstep( 0.0, 0.035, abs( dNoise( p * 26.0 + 5.0 ) - 0.5 ) );
          float livid = smoothstep( uLiveY, uLiveY - 0.45, p.y );
          livid = max( livid, smoothstep( 0.16, 0.03, min( distance( p, uHandL ), distance( p, uHandR ) ) ) );
          vec3 c = vec3( 0.47, 0.49, 0.5 );
          c = mix( c, vec3( 0.42, 0.47, 0.34 ), rot * 0.7 );
          c = mix( c, vec3( 0.3, 0.17, 0.27 ), bruise * 0.85 );
          c = mix( c, vec3( 0.24, 0.1, 0.17 ), livid * 0.85 );
          c *= 1.0 - vein * 0.35 * ( 1.0 - livid );
          diffuseColor.rgb *= c * 1.05;
        }`,
      );
  };
  return mat;
}

/** Filthy linen: grime gathered low, and brown-red stains soaked through. */
function filthyCloth(base: THREE.Material, color: THREE.Color, key: string): THREE.MeshStandardMaterial {
  const mat = (base as THREE.MeshStandardMaterial).clone();
  mat.color = color;
  mat.side = THREE.DoubleSide;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRagP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRagP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRagP;
        float rHash( vec3 p ) { return fract( sin( dot( p, vec3( 269.5, 183.3, 246.1 ) ) ) * 43758.5453 ); }
        float rNoise( vec3 p ) {
          vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( rHash( i ), rHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( rHash( i + vec3( 0, 1, 0 ) ), rHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( rHash( i + vec3( 0, 0, 1 ) ), rHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( rHash( i + vec3( 0, 1, 1 ) ), rHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 p = vRagP;
          float n = rNoise( p * 6.0 ) * 0.65 + rNoise( p * 17.0 ) * 0.35;
          float grime = smoothstep( 0.35, 0.75, n );
          float blood = smoothstep( 0.66, 0.8, rNoise( p * 5.0 + 31.0 ) * 0.7 + rNoise( p * 23.0 ) * 0.3 );
          vec3 c = mix( vec3( 1.0 ), vec3( 0.55, 0.5, 0.42 ), grime );
          c = mix( c, vec3( 0.32, 0.07, 0.05 ), blood );
          diffuseColor.rgb *= c;
        }`,
      );
  };
  return mat;
}

interface Arm {
  side: number;
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  /** Finger joints, knuckle to tip, for curling. */
  fingers: THREE.Object3D[][];
}
interface Leg {
  side: number;
  thigh: THREE.Object3D;
  shin: THREE.Object3D;
  foot: THREE.Object3D;
  restThigh: number;
  restShin: number;
}

/** Rope length from the anchor to the knot, and the knot's height at rest (toes 0.72 m up). */
const ROPE = 6.2;
const STUB = 0.55;
const TOE_HEIGHT = 0.72;
const KNOT_Y = TOE_HEIGHT + 1.79;

class Hanged extends BasicRig {
  /** The unseen point the rope hangs from; tilting it swings the whole corpse. */
  readonly anchor: THREE.Object3D;
  /** Turns the corpse about the rope. */
  readonly twist: THREE.Object3D;
  /** Upper rope, which springs away when it snaps. */
  readonly ropeTop: THREE.Object3D;
  /** The knot; the corpse hangs from here. */
  readonly hang: THREE.Object3D;
  readonly corpse: THREE.Object3D;
  readonly hips: THREE.Object3D;
  readonly spine: THREE.Object3D;
  readonly chest: THREE.Object3D;
  readonly head: THREE.Object3D;
  /** Rope stub from the knot up to where it will snap; aimed at the rope above every frame. */
  readonly stub: THREE.Object3D;
  readonly flapF: THREE.Object3D;
  readonly flapB: THREE.Object3D;
  readonly arms: Arm[] = [];
  readonly legs: Leg[] = [];
  /** 0 limp, 1 head snapped straight (the attack). */
  alert = 0;
  dead = false;
  /** Rope end the stub aims at, while it is still whole. */
  private ropeEnd = new THREE.Vector3();
  private v = new THREE.Vector3();

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, 3, 2.4);
    const hemp = (m.rag as THREE.MeshStandardMaterial).clone();
    hemp.color = new THREE.Color(0.5, 0.4, 0.25);
    hemp.side = THREE.FrontSide;
    const hempFade = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.22, 0.17, 0.11), roughness: 0.9, transparent: true, depthWrite: false, vertexColors: true });
    const shift = filthyCloth(m.rag, new THREE.Color(0.62, 0.58, 0.5), 'hangedShift');
    const breeches = filthyCloth(m.rag, new THREE.Color(0.3, 0.22, 0.15), 'hangedBreeches');
    const sackMat = filthyCloth(m.rag, new THREE.Color(0.55, 0.42, 0.26), 'hangedSack');
    const nail = new THREE.MeshStandardMaterial({ color: 0x3a3018, roughness: 0.45 });
    const tooth = new THREE.MeshStandardMaterial({ color: 0x8c7d58, roughness: 0.4 });
    const lips = new THREE.MeshStandardMaterial({ color: 0x2c1520, roughness: 0.35 });
    const welt = new THREE.MeshStandardMaterial({ color: 0x3a0d12, roughness: 0.3 });
    const eyeMilk = new THREE.MeshStandardMaterial({ color: 0x9a9a88, roughness: 0.15 });
    // Skin needs to know where the hands hang; patched below once the rig is posed.
    const handPts = [new THREE.Vector3(), new THREE.Vector3()];
    const skin = deadSkin(m.paleSkin, handPts, (TOE_HEIGHT + 0.55) * scale);

    // --- Rope -------------------------------------------------------------
    this.anchor = joint(this.body, 0, KNOT_Y + ROPE, 0);
    this.twist = joint(this.anchor, 0, 0, 0);
    this.ropeTop = joint(this.twist, 0, 0, 0);
    const upper = ROPE - STUB;
    // Laid rope near the corpse; higher up a plain cord that fades into the dark.
    const detail = 1.6;
    mesh(laidRope(line(new THREE.Vector3(0, -upper, 0), new THREE.Vector3(0, -upper + detail, 0)), 0.021, 64), hemp, this.ropeTop);
    const fade = new THREE.CylinderGeometry(0.02, 0.021, upper - detail, 7, 6, true).translate(0, -(upper - detail) / 2, 0);
    const fp = fade.getAttribute('position');
    const cols: number[] = [];
    for (let i = 0; i < fp.count; i++) {
      const t = -fp.getY(i) / (upper - detail); // 0 at the top
      cols.push(1, 1, 1, smooth(0.15, 0.85, t));
    }
    fade.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    const fadeMesh = mesh(fade, hempFade, this.ropeTop);
    fadeMesh.userData.dynamic = true;
    fadeMesh.castShadow = false;
    // Frayed fibres where the rope will part.
    for (let i = 0; i < 7; i++) {
      const f = mesh(new THREE.CylinderGeometry(0.0015, 0.003, range(rng, 0.03, 0.07), 3).translate(0, -0.025, 0), hemp, this.ropeTop, range(rng, -0.012, 0.012), -upper + 0.01, range(rng, -0.012, 0.012));
      f.rotation.set(range(rng, -0.8, 0.8), 0, range(rng, -0.8, 0.8));
    }

    this.hang = joint(this.twist, 0, -ROPE, 0);
    this.corpse = joint(this.hang, 0, 0, 0);

    // --- Body joints (corpse space: toe tips at y = 0) --------------------
    this.hips = joint(this.corpse, 0, 1.06, 0);
    this.spine = joint(this.hips, 0, 0.1, 0);
    this.chest = joint(this.spine, 0, 0.2, 0);
    this.head = joint(this.chest, 0, 0.33, 0.01);

    // Bloated belly and grey ribcage; mostly under the shift, seen through
    // its torn neck and holes.
    const belly = (_x: number, y: number, _z: number, t: number) => 0.05 * bump(t, y, 0, 0.04, 0.9, 0.12) + 0.015 * bump(t, y, 1.4, 0.0, 0.5, 0.1) + 0.015 * bump(t, y, -1.4, 0.0, 0.5, 0.1);
    const bellyProfile: [number, number][] = [[0.15, -0.14], [0.165, -0.04], [0.17, 0.06], [0.165, 0.16], [0.16, 0.22]];
    mesh(sculptLathe(bellyProfile, belly, { seg: 24, perSpan: 3, sx: 1.12, sz: 0.85 }), skin, this.spine);
    const ribs = (_x: number, y: number, _z: number, t: number) => {
      let d = 0;
      for (const s of [-1, 1]) {
        d += 0.025 * bump(t, y, s * 0.5, 0.13, 0.4, 0.07); // slack pecs
        d += 0.03 * bump(t, y, s * 2.5, 0.14, 0.35, 0.08); // shoulder blades
        d += 0.022 * bump(t, y, s * 1.0, 0.24, 0.5, 0.04); // traps
      }
      d -= 0.015 * bump(t, y, 0, 0.16, 0.08, 0.1); // sternum
      return d;
    };
    const ribProfile: [number, number][] = [[0.155, -0.08], [0.17, 0.02], [0.18, 0.12], [0.17, 0.2], [0.13, 0.25], [0.065, 0.285], [0.0, 0.295]];
    mesh(sculptLathe(ribProfile, ribs, { seg: 28, perSpan: 3, sx: 1.18, sz: 0.74 }), skin, this.chest);
    // Collarbones standing proud of the slack skin.
    for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.14, 5).rotateZ(Math.PI / 2 - s * 0.22), skin, this.chest, s * 0.075, 0.245, 0.075);

    // The shift: the torso again a little larger, torn open at the neck and
    // holed; side-slit flaps hang to mid-thigh.
    const neckV = (x: number, y: number, z: number) => !(z > 0 && y > 0.225 - Math.abs(x) * 1.1 + jag(x * 40, 1) * 0.008 && Math.abs(x) < 0.06);
    const holes: [number, number, number, number][] = [];
    for (let i = 0; i < 3; i++) holes.push([range(rng, -Math.PI, Math.PI), range(rng, -0.06, 0.16), range(rng, 0.022, 0.04), rng() < 0.5 ? 0 : 1]);
    const holed = (part: number) => (x: number, y: number, z: number) => {
      const t = Math.atan2(x, z);
      for (const [ht, hy, hr, hp] of holes) {
        if (hp !== part) continue;
        const dt = Math.atan2(Math.sin(t - ht), Math.cos(t - ht)) * 0.17;
        if (Math.hypot(dt, y - hy) < hr * (0.8 + 0.3 * jag(t * 7 + y * 30, hy))) return false;
      }
      return true;
    };
    const folds = (_x: number, y: number, _z: number, t: number) => 0.006 * Math.sin(t * 9 + y * 6) + 0.004 * Math.sin(t * 17 - y * 11);
    const shirtBelly = sculptLathe(bellyProfile.map(([r, y]) => [r + 0.016, y] as [number, number]), (x, y, z, t) => belly(x, y, z, t) + folds(x, y, z, t) + 0.01 * smooth(0.0, -0.14, y), {
      seg: 48,
      perSpan: 6,
      sx: 1.12,
      sz: 0.85,
    });
    mesh(tear(shirtBelly, holed(0)), shift, this.spine);
    const shirtChest = sculptLathe(ribProfile.slice(0, 5).map(([r, y]) => [r + 0.014, y] as [number, number]).concat([[0.11, 0.27], [0.085, 0.285]]), (x, y, z, t) => ribs(x, y, z, t) + folds(x, y, z, t), {
      seg: 48,
      perSpan: 5,
      sx: 1.18,
      sz: 0.74,
    });
    mesh(tear(shirtChest, (x, y, z) => neckV(x / 1.18, y, z) && holed(1)(x, y, z)), shift, this.chest);

    // Flaps: half-cylinders hung from the hips, ragged and torn at the hem,
    // that follow the swinging thighs.
    this.flapF = joint(this.hips, 0, 0.04, 0.0);
    this.flapB = joint(this.hips, 0, 0.04, 0.0);
    for (const [flap, front] of [[this.flapF, 1], [this.flapB, -1]] as const) {
      const cols = 16;
      const rows = 8;
      const g = new THREE.PlaneGeometry(1, 1, cols, rows);
      const p = g.getAttribute('position');
      const seed = front > 0 ? 3 : 7;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) + 0.5; // 0..1 across
        const t = 0.5 - p.getY(i); // 0 top, 1 hem
        const a = (u - 0.5) * 3.5 + (front > 0 ? 0 : Math.PI);
        const len = 0.44 + jag(u * 5, seed) * 0.05 + (Math.abs(u - 0.5) > 0.4 ? -0.05 : 0);
        const r = (0.175 + t * 0.05) * (1 + 0.04 * Math.sin(a * 7 + seed));
        p.setXYZ(i, Math.sin(a) * r * 1.1, -t * len, Math.cos(a) * r * 0.85);
      }
      g.computeVertexNormals();
      tear(g, (x, y, z) => {
        // Rents: a few long tears up from the hem.
        const t = Math.atan2(x, z);
        const rent = Math.abs(Math.sin(t * 2.2 + seed)) < 0.09 && y < -0.24 + jag(t * 3, seed) * 0.05;
        return !rent && !(Math.hypot(t - (front > 0 ? 0.6 : 2.6), y + 0.22) < 0.07);
      });
      mesh(g, shift, flap);
    }
    // Breeches' waistband and seat.
    mesh(lathe([[0.17, 0.06], [0.175, -0.02], [0.17, -0.1], [0.14, -0.15]], 18).scale(1.1, 1, 0.85), breeches, this.hips);

    // --- Neck, noose and sack ----------------------------------------------
    // The neck is stretched long and kinked; the noose bites a raw welt into it.
    const neck = sculptLathe(
      [[0.06, -0.1], [0.05, -0.04], [0.042, 0.02], [0.044, 0.06], [0.05, 0.1]],
      (_x, y, _z, t) => -0.012 * bump(t, y, 0, 0.02, 9, 0.012) + 0.008 * bump(t, y, 0, -0.02, 0.4, 0.03), // groove, larynx
      { seg: 16, perSpan: 3, sz: 0.95 },
    );
    mesh(neck, skin, this.head, 0, -0.02, 0);
    mesh(new THREE.TorusGeometry(0.045, 0.006, 5, 18).rotateX(Math.PI / 2), welt, this.head, 0, 0.003, 0);

    // Head: a congested skull under the sack, its lower face showing through
    // a rip. Unit-sphere layout: mouth y -0.4, chin -0.75.
    const hp = new THREE.Vector3(0, 0.12, 0.015);
    const skull = sculptSphere(0.1, (x, y, z) => 0.06 * bump(x, y, 0, -0.75, 0.4, 0.25) * smooth(0.2, 0.8, z) + 0.05 * bump(x, y, 0, -0.35, 0.5, 0.15) * smooth(0.3, 0.9, z), new THREE.Vector3(0.88, 1.0, 1.0), 20, 16);
    mesh(skull, skin, this.head, hp.x, hp.y, hp.z);
    // Grey lips drawn back from yellow teeth, a dark gap, a swollen tongue.
    mesh(new THREE.SphereGeometry(0.03, 10, 6).scale(1.2, 0.6, 0.5), m.void, this.head, 0, hp.y - 0.04, hp.z + 0.088);
    mesh(new THREE.TorusGeometry(0.028, 0.007, 5, 14).scale(1.15, 0.55, 1), lips, this.head, 0, hp.y - 0.04, hp.z + 0.094);
    const gaps = [1, 0, 1, 1, 0, 1, 1];
    for (let i = 0; i < gaps.length; i++) {
      if (!gaps[i]) continue;
      const a = (i - 3) * 0.26;
      const t = mesh(new THREE.BoxGeometry(0.009, range(rng, 0.011, 0.017), 0.006), tooth, this.head, Math.sin(a) * 0.026, hp.y - 0.031, hp.z + 0.09 + Math.cos(a) * 0.006 - 0.006);
      t.rotation.set(0.1, a, range(rng, -0.2, 0.2));
    }
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.3;
      mesh(new THREE.BoxGeometry(0.008, 0.01, 0.006), tooth, this.head, Math.sin(a) * 0.022, hp.y - 0.05, hp.z + 0.086 + Math.cos(a) * 0.004 - 0.004).rotation.y = a;
    }
    mesh(new THREE.SphereGeometry(0.014, 8, 6).scale(1.1, 0.7, 1), lips, this.head, 0.004, hp.y - 0.047, hp.z + 0.095);

    // The sack: loose burlap over the head, its two bag corners standing up,
    // gathered under the jaw, ripped across the mouth and over one eye.
    const sack = sculptSphere(
      0.118,
      (x, y, z) => {
        let d = 0.25 * (bump(x, y, -0.75, 0.62, 0.22, 0.25) + bump(x, y, 0.75, 0.62, 0.22, 0.25)); // bag corners
        d += 0.04 * Math.sin(Math.atan2(x, z) * 7 + y * 3) * smooth(0.2, -0.6, y); // gathered folds
        d -= 0.16 * smooth(-0.35, -0.95, y); // drawn in under the jaw
        d += 0.05 * bump(x, y, 0, -0.35, 0.4, 0.2) * smooth(0.3, 0.9, z); // over the mouth
        return d;
      },
      new THREE.Vector3(0.95, 1.0, 1.02),
      28,
      20,
    );
    tear(sack, (x, y, z) => {
      const ux = x / 0.112;
      const uy = y / 0.118;
      const uz = z / 0.12;
      if (uy < -0.62 + jag(Math.atan2(x, z) * 4, 2) * 0.08) return false; // ragged hem under the jaw
      if (uz > 0.55 && Math.abs(ux + 0.08) < 0.5 + jag(uy * 6, 4) * 0.08 && uy < -0.18 + jag(ux * 8, 5) * 0.09 && uy > -0.62) return false; // mouth rip
      if (uz > 0.6 && Math.hypot(ux - 0.33, uy - 0.12) < 0.13 + jag(ux * 20 + uy * 10, 6) * 0.04) return false; // eye hole
      return true;
    });
    mesh(sack, sackMat, this.head, hp.x, hp.y + 0.005, hp.z);
    // Dark wet stains seeping through where the eyes and nose are.
    const stain = new THREE.MeshStandardMaterial({ color: 0x1c0d08, roughness: 0.3, transparent: true, opacity: 0.75, depthWrite: false });
    for (const [sx, sy, sr] of [[-0.035, 0.012, 0.022], [0.0, -0.01, 0.014]] as const) {
      const s = mesh(new THREE.CircleGeometry(sr, 10).scale(1, 1.3, 1), stain, this.head, sx, hp.y + sy, hp.z + 0.118);
      s.rotation.y = sx * 2;
    }
    // One filmy eye through the hole, a pinprick of red in it.
    mesh(new THREE.SphereGeometry(0.014, 10, 8), eyeMilk, this.head, 0.036, hp.y + 0.014, hp.z + 0.085);
    mesh(new THREE.SphereGeometry(0.0045, 6, 4), m.eyeRed, this.head, 0.037, hp.y + 0.013, hp.z + 0.098);

    // Noose: a loop of laid rope cinched under the jaw, rising to the
    // hangman's knot behind the right ear.
    const knotAt = new THREE.Vector3(0.068, 0.06, -0.035);
    const loop: THREE.Vector3[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const x = Math.sin(a) * 0.056;
      const z = Math.cos(a) * 0.054;
      // Tilted up toward the knot side.
      loop.push(new THREE.Vector3(x, 0.006 + (x / 0.056) * 0.022 + (-z / 0.054) * 0.012, z));
    }
    mesh(laidRope(new THREE.CatmullRomCurve3(loop, true), 0.016, 56, true, 0.045), hemp, this.head);
    this.stub = joint(this.head, knotAt.x, knotAt.y, knotAt.z);
    // The knot: wraps stacked along the standing part, then the stub of rope.
    for (let i = 0; i < 7; i++) mesh(new THREE.TorusGeometry(0.03, 0.013, 6, 12).rotateX(Math.PI / 2), hemp, this.stub, 0, 0.012 + i * 0.019, 0);
    mesh(new THREE.TorusGeometry(0.02, 0.011, 6, 10), hemp, this.stub, 0, 0.0, 0); // the loop through the knot
    mesh(laidRope(line(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, STUB, 0)), 0.021, 22), hemp, this.stub);
    for (let i = 0; i < 6; i++) {
      const f = mesh(new THREE.CylinderGeometry(0.0015, 0.003, range(rng, 0.03, 0.06), 3).translate(0, 0.02, 0), hemp, this.stub, range(rng, -0.012, 0.012), STUB - 0.01, range(rng, -0.012, 0.012));
      f.rotation.set(range(rng, -0.7, 0.7), 0, range(rng, -0.7, 0.7));
    }
    // A tag end hanging out of the knot.
    mesh(laidRope(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0.02, -0.04, -0.01), new THREE.Vector3(0.025, -0.11, 0.0)]), 0.012, 12), hemp, this.stub);

    // --- Arms ---------------------------------------------------------------
    for (const side of [-1, 1]) {
      const shoulder = joint(this.chest, side * 0.2, 0.2, -0.005);
      const up = joint(shoulder, 0, 0, 0);
      mesh(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.9, 0.9), shift, shoulder);
      // Loose sleeve torn off ragged at the elbow.
      const sleeve = sculptLathe([[0.068, 0.02], [0.07, -0.08], [0.066, -0.2], [0.07, -0.3]], (_x, y, _z, t) => 0.006 * Math.sin(t * 6 + y * 20), { seg: 14, perSpan: 2 });
      mesh(
        tear(sleeve, (x, y, z) => y > -0.29 + jag(Math.atan2(x, z) * 3, side + 4) * 0.035),
        shift,
        up,
      );
      mesh(lathe([[0.048, 0.0], [0.054, -0.15], [0.046, -0.27], [0.036, -0.32]], 10), skin, up);
      const fore = joint(up, 0, -0.29, 0);
      mesh(
        sculptLathe([[0.04, 0.05], [0.047, 0.0], [0.05, -0.07], [0.043, -0.2], [0.032, -0.31]], (_x, y, _z, t) => 0.008 * bump(t, y, 0.6, -0.08, 0.6, 0.06), { seg: 14, perSpan: 3, sz: 0.85 }),
        skin,
        fore,
      );
      const hand = joint(fore, 0, -0.31, 0);
      // Puffy palm, then long fingers ending in long, dirty nails.
      mesh(sculptSphere(0.045, (_x, y) => 0.1 * smooth(0.2, 0.8, y), new THREE.Vector3(0.95, 1.15, 0.45), 12, 10), skin, hand, 0, -0.045, 0.004);
      const fingers: THREE.Object3D[][] = [];
      for (let f = 0; f < 5; f++) {
        const thumb = f === 4;
        const base = thumb ? joint(hand, -side * 0.035, -0.03, 0.02) : joint(hand, side * (f - 1.5) * 0.019, -0.088, 0.003);
        if (thumb) base.rotation.set(0.3, 0, -side * 0.5);
        const lens = thumb ? [0.035, 0.03] : [0.042 - Math.abs(f - 1.2) * 0.004, 0.032, 0.026];
        const chain: THREE.Object3D[] = [];
        let parent = base;
        for (let s = 0; s < lens.length; s++) {
          const j = s === 0 ? base : joint(parent, 0, -lens[s - 1], 0);
          const r = 0.0095 - s * 0.0012;
          mesh(new THREE.CylinderGeometry(r * 0.9, r, lens[s], 6).translate(0, -lens[s] / 2, 0), skin, j);
          mesh(new THREE.SphereGeometry(r * 1.05, 6, 4), skin, j);
          chain.push(j);
          parent = j;
        }
        // Long curved nail.
        const tip = joint(parent, 0, -lens[lens.length - 1], 0.003);
        tip.rotation.x = 0.35;
        mesh(new THREE.ConeGeometry(0.0065, 0.045, 4).rotateX(Math.PI).translate(0, -0.018, 0).scale(1, 1, 0.45), nail, tip);
        fingers.push(chain);
      }
      this.arms.push({ side, upper: up, fore, hand, fingers });
    }

    // --- Legs ---------------------------------------------------------------
    for (const side of [-1, 1]) {
      const thigh = joint(this.hips, side * 0.095, -0.06, 0);
      // Breeches leg, torn ragged below the knee on one side, above it on the other.
      const cut = side > 0 ? -0.5 : -0.4;
      const leg = sculptLathe([[0.094, 0.04], [0.092, -0.1], [0.082, -0.3], [0.078, -0.42], [0.076, -0.52]], (_x, y, _z, t) => 0.006 * Math.sin(t * 5 + y * 25) + 0.004 * Math.sin(t * 11), { seg: 16, perSpan: 3, sz: 0.95 });
      mesh(
        tear(leg, (x, y, z) => y > cut + jag(Math.atan2(x, z) * 2.5, side + 9) * 0.045),
        breeches,
        thigh,
      );
      mesh(lathe([[0.08, 0.0], [0.078, -0.2], [0.062, -0.44]], 12), skin, thigh);
      const shin = joint(thigh, 0, -0.44, 0);
      mesh(
        sculptLathe([[0.06, 0.06], [0.064, -0.02], [0.066, -0.1], [0.056, -0.24], [0.04, -0.4], [0.036, -0.44]], (_x, y, _z, t) => 0.014 * bump(t, y, Math.PI, -0.12, 0.8, 0.08), { seg: 14, perSpan: 3, sz: 0.92 }),
        skin,
        shin,
      );
      const foot = joint(shin, 0, -0.44, 0);
      // Foot pointing straight down: heel at the back, instep facing forward.
      mesh(
        sculptSphere(0.05, (x, y, z) => 0.25 * bump(x, z, 0, -0.9, 0.5, 0.4) * smooth(0.0, 0.7, y) - 0.1 * smooth(0, -0.9, z) * smooth(0.3, -0.5, y), new THREE.Vector3(0.75, 1.75, 0.85), 14, 12),
        skin,
        foot,
        0,
        -0.075,
        0.012,
      );
      for (let i = 0; i < 5; i++) {
        const x = side * (0.022 - i * 0.011);
        const len = i === 0 ? 0.034 : 0.028 - i * 0.002;
        mesh(new THREE.CapsuleGeometry(i === 0 ? 0.0095 : 0.007, len, 2, 6), skin, foot, x, -0.16 - len * 0.4 + Math.abs(i - 0.5) * 0.004, 0.022 - i * 0.002);
        mesh(new THREE.SphereGeometry(i === 0 ? 0.007 : 0.005, 5, 4).scale(1, 1.2, 0.4), nail, foot, x, -0.165 - len * 0.6, 0.029 - i * 0.002);
      }
      const restThigh = side > 0 ? -0.06 : 0.04;
      const restShin = side > 0 ? 0.28 : 0.1;
      this.legs.push({ side, thigh, shin, foot, restThigh, restShin });
    }

    // Hang the corpse so the knot meets the rope: tilt the body slightly so
    // its weight sits under the knot, pose it, then offset it onto the knot.
    this.corpse.rotation.z = 0.04;
    this.animate(0);
    this.root.updateMatrixWorld(true);
    const knot = this.stub.getWorldPosition(new THREE.Vector3());
    const hangPos = this.hang.getWorldPosition(new THREE.Vector3());
    this.corpse.position.sub(this.hang.worldToLocal(knot.clone()).sub(this.hang.worldToLocal(hangPos.clone())));
    this.root.updateMatrixWorld(true);
    // Blood settles in the hanging hands.
    for (const [i, a] of this.arms.entries()) this.root.worldToLocal(a.hand.getWorldPosition(handPts[i]).add(new THREE.Vector3(0, -0.06 * scale, 0)));
    bakeRig(this.root);
    // Skinned parts cull against their rest pose; give them room for the
    // swing, the lunge and the drop to the floor.
    this.root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.6 * scale, 0), 2.6 * scale);
    });
  }

  protected animate(_dt: number) {
    if (this.dead) return;
    const t = this.time;
    const w = this.walk;
    const ph = this.phase;
    // Now and then a dead twitch runs through it.
    const twitch = Math.pow(Math.max(0, Math.sin(t * 0.47 + 1.3)), 60) * Math.sin(t * 40);

    // The rope swings slowly; moving, the corpse drags behind and bobs.
    this.anchor.rotation.x = Math.sin(t * 0.83) * 0.012 + Math.sin(t * 0.31 + 2) * 0.008 + w * 0.05 + Math.sin(ph * 2) * 0.006 * w;
    this.anchor.rotation.z = Math.sin(t * 0.67 + 1) * 0.012 + Math.sin(t * 0.29) * 0.006;
    // Turning on the rope, slowly winding and unwinding.
    this.twist.rotation.y = (Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.53 + 1) * 0.15) * (1 - 0.85 * w);
    // The body pivots a little at the knot, behind the swing.
    this.hang.rotation.x = -this.anchor.rotation.x * 0.8 + Math.sin(t * 1.3 + 0.5) * 0.02 + w * 0.05;
    this.hang.rotation.z = Math.sin(t * 1.1) * 0.015;

    // Head lolls away from the knot, chin sunk; snaps straight when it attacks.
    const a = this.alert;
    this.head.rotation.z = (0.5 + Math.sin(t * 0.7) * 0.03) * (1 - a) + twitch * 0.06;
    this.head.rotation.x = 0.32 * (1 - a) - 0.12 * a;
    this.head.rotation.y = -0.18 * (1 - a) + this.lookYaw * a;
    this.spine.rotation.x = 0.04 * (1 - w) - 0.06 * w;
    this.spine.rotation.z = -0.04;
    this.chest.rotation.x = 0.05;
    this.chest.rotation.z = -0.03 + twitch * 0.03;

    for (const arm of this.arms) {
      const s = arm.side;
      // Limp, swinging a beat behind the body; trailing back when it glides.
      arm.upper.rotation.x = Math.sin(t * 1.3 + s) * 0.04 + w * (0.35 + Math.sin(ph + s) * 0.08) + 0.02;
      arm.upper.rotation.z = s * (0.09 + Math.sin(t * 0.9 + s * 2) * 0.02);
      arm.upper.rotation.y = 0;
      arm.fore.rotation.x = -0.18 - Math.sin(t * 1.3 + s + 0.6) * 0.03 + w * 0.12;
      arm.hand.rotation.x = 0.1;
      arm.hand.rotation.z = -s * 0.1;
      for (const [i, chain] of arm.fingers.entries()) {
        const curl = (i === 4 ? 0.2 : 0.35 + i * 0.06) + twitch * 0.4;
        for (const j of chain) j.rotation.x = i === 4 ? -curl * 0.5 : curl;
      }
    }
    for (const leg of this.legs) {
      const s = leg.side;
      // Dangling: in idle a faint drift, moving they swing to and fro.
      const swing = Math.sin(ph + (s > 0 ? 0 : Math.PI));
      leg.thigh.rotation.x = leg.restThigh + Math.sin(t * 1.1 + s) * 0.025 + w * (0.28 + swing * 0.32);
      leg.thigh.rotation.z = s * 0.03;
      leg.shin.rotation.x = leg.restShin + w * (0.15 + Math.max(0, -swing) * 0.45) + twitch * 0.08 * s;
      leg.foot.rotation.x = 0.05 + Math.sin(t * 1.1 + s + 0.8) * 0.04 + w * 0.15;
    }
    const thighs = this.legs.map((l) => l.thigh.rotation.x);
    this.flapF.rotation.x = Math.min(0, ...thighs) * 0.9 + w * 0.12;
    this.flapB.rotation.x = Math.max(0, ...thighs) * 0.9 + w * 0.2 + Math.sin(t * 2.3) * 0.02 * w;
    this.aimStub();
  }

  /** Keep the rope stub pointed from the knot at the end of the rope above. */
  aimStub() {
    this.root.updateMatrixWorld(true);
    this.ropeTop.localToWorld(this.ropeEnd.set(0, -(ROPE - STUB), 0));
    const local = this.head.worldToLocal(this.ropeEnd.clone()).sub(this.stub.position);
    const len = local.length();
    this.stub.quaternion.setFromUnitVectors(this.v.set(0, 1, 0), local.normalize());
    this.stub.scale.y = len / STUB;
  }
}

export function buildHanged(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  const c = new Hanged(m, rng, scale * range(rng, 0.97, 1.04));
  return {
    rig: c,
    attack(onHit) {
      // The head snaps up, both arms jerk out and it swings in on the rope to
      // seize the throat; it shakes its prey, then lets go and goes limp.
      let fired = false;
      c.play(
        1.3,
        (k) => {
          const shudder = hump(k, 0, 0.14) * Math.sin(k * 120) * 0.04;
          c.alert = ease(k, 0.1, 0.17) * (1 - ease(k, 0.8, 0.97));
          const raise = ease(k, 0.14, 0.3) * (1 - ease(k, 0.75, 0.97));
          const lunge = ease(k, 0.25, 0.48) * (1 - ease(k, 0.62, 0.95));
          const grip = ease(k, 0.42, 0.5) * (1 - ease(k, 0.72, 0.85));
          const shake = hump(k, 0.5, 0.74) * Math.sin(k * 90) * 0.06;
          c.anchor.rotation.x += -0.11 * lunge;
          c.hang.rotation.x += 0.1 * lunge + shake * 0.5;
          c.chest.rotation.x += -0.12 * lunge + shudder;
          c.head.rotation.z += shudder;
          for (const a of c.arms) {
            a.upper.rotation.x = THREE.MathUtils.lerp(a.upper.rotation.x, -1.5 - 0.1 * grip, raise) + shake;
            a.upper.rotation.z = THREE.MathUtils.lerp(a.upper.rotation.z, a.side * (0.3 - 0.42 * grip), raise);
            a.upper.rotation.y = -a.side * 0.2 * raise;
            a.fore.rotation.x = THREE.MathUtils.lerp(a.fore.rotation.x, -0.25 - 0.3 * grip, raise);
            a.hand.rotation.x = THREE.MathUtils.lerp(a.hand.rotation.x, -0.2 + 0.4 * grip, raise);
            for (const [i, chain] of a.fingers.entries()) {
              // Splayed while reaching, clenched once they close.
              const curl = THREE.MathUtils.lerp(-0.25, 0.9, grip);
              for (const j of chain) j.rotation.x = THREE.MathUtils.lerp(j.rotation.x, i === 4 ? -curl * 0.5 : curl, raise);
            }
          }
          for (const l of c.legs) l.thigh.rotation.x += 0.35 * lunge + shake * 0.6;
          c.aimStub();
          if (!fired && k >= 0.5) {
            fired = true;
            onHit();
          }
        },
        () => {
          c.alert = 0;
          if (!fired) onHit();
        },
      );
    },
    flinch() {
      if (c.acting) return;
      c.play(0.45, (k) => {
        const s = Math.sin(k * Math.PI);
        c.anchor.rotation.x += 0.03 * s;
        c.hang.rotation.x -= 0.12 * s;
        c.head.rotation.x -= 0.25 * s;
        c.head.rotation.z -= 0.15 * s;
        for (const a of c.arms) a.upper.rotation.x -= 0.3 * s;
        for (const l of c.legs) l.thigh.rotation.x -= 0.25 * s;
        c.aimStub();
      });
    },
    die() {
      // A jerk, the rope parts above the knot and the body drops. The legs
      // fold under it on landing and it slumps into a heap; the cut rope
      // springs up and swings.
      c.cancelAction();
      c.dead = true;
      const g = 9.8 / (c.body.scale.y || 1);
      const dur = 2.4;
      const tSnap = 0.12;
      const tFall = Math.sqrt((2 * TOE_HEIGHT) / g);
      const land = tSnap + tFall;
      const start = {
        ax: c.anchor.rotation.x,
        az: c.anchor.rotation.z,
        hx: c.hang.rotation.x,
        hz: c.hang.rotation.z,
        cy: c.corpse.position.y,
        cz: c.corpse.position.z,
        stub: c.stub.quaternion.clone(),
        sp: c.spine.rotation.x,
        hx2: c.head.rotation.x,
        hz2: c.head.rotation.z,
        hy2: c.head.rotation.y,
      };
      const roll = Math.random() < 0.5 ? -1 : 1;
      const limp = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.9, 0, roll * 0.8));
      c.play(dur, (k) => {
        const s = k * dur;
        const fallT = Math.max(0, Math.min(tFall, s - tSnap));
        const after = Math.max(0, s - land);
        // Upper rope: a hard jerk, then it whips up and sways, slowing.
        const jerk = hump(s, 0, tSnap) * 0.04;
        const up = s > tSnap ? Math.min(1, (s - tSnap) / 0.25) : 0;
        c.ropeTop.position.y = up * (0.9 - 0.35 * Math.min(1, Math.max(0, s - tSnap - 0.25) / 0.6)) + jerk;
        c.ropeTop.rotation.z = Math.sin(s * 5) * 0.06 * Math.exp(-s * 1.2) * up;
        c.ropeTop.rotation.x = Math.sin(s * 4.2 + 1) * 0.05 * Math.exp(-s * 1.2) * up;
        // The body: straightens under the swing as it falls.
        const settle = Math.min(1, fallT / tFall);
        c.anchor.rotation.x = start.ax * (1 - settle);
        c.anchor.rotation.z = start.az * (1 - settle);
        c.hang.rotation.x = start.hx * (1 - settle);
        c.hang.rotation.z = start.hz * (1 - settle);
        c.hang.position.y = -ROPE + jerk - 0.5 * g * fallT * fallT;
        // On landing the knees give and it drops onto them, folds forward over
        // its thighs until the head meets the floor and slumps to one side:
        // a heap, hips on heels, the arms spilled out beside it.
        const buckle = ease(after, 0, 0.24);
        const drop = Math.min(1, after / 0.3) ** 2;
        const fold = ease(after, 0.1, 0.7);
        const slump = ease(after, 0.4, 1.0);
        const bounce = Math.sin(Math.min(1, Math.max(0, after - 0.3) / 0.18) * Math.PI) * 0.03 * (after > 0.3 ? 1 : 0);
        c.corpse.position.y = start.cy - 0.76 * drop + bounce;
        c.corpse.position.z = start.cz;
        c.corpse.rotation.x = 0;
        c.corpse.rotation.z = 0.04 * (1 - buckle);
        c.hips.rotation.x = 1.0 * fold;
        c.hips.rotation.z = roll * 0.12 * slump;
        for (const l of c.legs) {
          l.thigh.rotation.x = THREE.MathUtils.lerp(l.restThigh, -0.96 - (l.side === roll ? 0.12 : 0), buckle) - 1.0 * fold;
          l.thigh.rotation.z = l.side * (0.03 + 0.14 * buckle);
          l.shin.rotation.x = THREE.MathUtils.lerp(l.restShin, 2.5, buckle);
          l.foot.rotation.x = THREE.MathUtils.lerp(0.05, 0.1, buckle);
        }
        c.spine.rotation.x = THREE.MathUtils.lerp(start.sp, 0.45, fold);
        c.spine.rotation.z = THREE.MathUtils.lerp(-0.04, roll * 0.2, slump);
        c.chest.rotation.x = THREE.MathUtils.lerp(0.05, 0.35, fold);
        c.chest.rotation.z = roll * 0.1 * slump;
        c.head.rotation.x = THREE.MathUtils.lerp(start.hx2, 0.2, fold);
        c.head.rotation.z = THREE.MathUtils.lerp(start.hz2, roll * 0.7, slump);
        c.head.rotation.y = THREE.MathUtils.lerp(start.hy2, roll * 0.5, slump);
        for (const a of c.arms) {
          const flop = ease(after, 0.15 + (a.side === roll ? 0.15 : 0), 0.75 + (a.side === roll ? 0.15 : 0));
          a.upper.rotation.x = THREE.MathUtils.lerp(0.02, a.side === roll ? -0.5 : -1.2, flop);
          a.upper.rotation.z = a.side * THREE.MathUtils.lerp(0.09, a.side === roll ? 0.6 : 0.25, flop);
          a.upper.rotation.y = 0;
          a.fore.rotation.x = THREE.MathUtils.lerp(-0.18, -0.5, flop);
        }
        c.flapF.rotation.x = -1.1 * buckle;
        c.flapB.rotation.x = 0.3 * buckle - 1.1 * fold;
        // The rope stub flops over once there is nothing pulling on it.
        c.stub.quaternion.copy(start.stub).slerp(limp, ease(s, tSnap, land + 0.3));
        c.stub.scale.y = 1;
      });
    },
  };
}
