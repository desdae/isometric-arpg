import * as THREE from 'three';
import { joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { bump, sculptSphere } from '../sculpt';
import type { Rng } from '../../procgen/noise';
import { BasicRig, ease, hump } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Carrion crawler: a horse-sized eight-legged horror of the Pilgrim Road and
// the Ossuary. Its body is a great skull-shaped carapace of tarnished bronze,
// cranium plates riveted along their seams, a heavy brow over two sockets that
// burn red and a nasal pit above a row of long teeth. Two curved bone-and-bronze
// fangs hang beneath it, dripping. Behind the skull trails a plated maroon
// abdomen. The legs are tall and angular, crimson armour over near-black
// chitin with spurs at every joint, brass bands at the knuckles and hooked
// claws that glow at the tips. Feet are placed by inverse kinematics: an
// alternating-tetrapod gait plants them and the skull bobs over them.

const RIDE = 0.98;
/** Ground covered per gait cycle at scale 1 (metres). */
const STRIDE = 1.5;
/** Share of the cycle a foot spends planted. */
const DUTY = 0.56;
const LIFT = 0.32;
const FEMUR = 0.82;
const TIBIA = 0.7;
const META = 0.9;
const CLAW = 0.26;
/** Skull ellipsoid radii (x across, y up, z along). */
const SK = new THREE.Vector3(0.52, 0.47, 0.6);
const SKC = new THREE.Vector3(0, 0.06, 0.08);

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Displacement of the unit skull sphere: cranium dome, brow, sockets, nose, cheeks. */
function skullDisp(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const front = smooth(0.35, 0.85, z);
  let d = 0;
  // A flattish face; the lower face narrows into a muzzle; the underside is flat.
  d -= 0.1 * smooth(0.55, 1, z);
  d -= 0.2 * smooth(-0.05, -0.6, y) * smooth(0.1, 0.8, z) * (0.35 + ax);
  d -= 0.22 * smooth(-0.45, -0.95, y);
  // Heavy brow ridge, dipping to a scowl between the eyes.
  d += 0.075 * Math.exp(-(((y - 0.13 - 0.16 * Math.min(ax, 0.45)) / 0.09) ** 2)) * front * smooth(0.95, 0.55, ax);
  for (const s of [-1, 1]) {
    // Deep eye sockets, the nasal pit between them lower down, cheekbones.
    d -= 0.34 * bump(x, y, s * 0.33, 0.0, 0.2, 0.17) * front;
    d += 0.08 * bump(x, y, s * 0.58, -0.3, 0.14, 0.1) * smooth(0.2, 0.6, z);
    d -= 0.05 * bump(z, y, 0.3, -0.12, 0.25, 0.18) * smooth(0.7, 0.95, s * x);
  }
  d -= 0.3 * bump(x, y, 0, -0.38, 0.1, 0.13) * front;
  // Raised central plate down the crown, and the brow plate standing proud of the side plates behind it.
  d += 0.03 * smooth(0.25, 0.17, ax) * smooth(0.15, 0.4, y) * smooth(0.95, 0.7, z);
  d += 0.018 * smooth(0.1, 0.22, z + 0.1 * y) * smooth(-0.1, 0.1, y) * smooth(0.18, 0.26, ax);
  return d;
}

/** Point on the sculpted skull (skull-joint space) in unit direction `n`, lifted `lift` along it. */
function skullPoint(n: THREE.Vector3, lift = 0): THREE.Vector3 {
  const u = n.clone().normalize();
  const k = 1 + skullDisp(u.x, u.y, u.z);
  return new THREE.Vector3(u.x * k * SK.x, u.y * k * SK.y, u.z * k * SK.z).addScaledVector(u, lift);
}

/** Tube of tapering radius along a curve. */
function taper(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 10, radial = 6): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(seg, false);
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const p = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const v = p.clone().addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      idx.push(a, a + radial, b, b, a + radial, b + radial);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const curve = (...p: [number, number, number][]) => new THREE.CatmullRomCurve3(p.map(([x, y, z]) => new THREE.Vector3(x, y, z)));

/** Angular prism along local +X from r0 to r1, its section squashed by sy / sz. */
function prism(len: number, r0: number, r1: number, sides = 6, sy = 1, sz = 1) {
  return new THREE.CylinderGeometry(r1, r0, len, sides).rotateZ(-Math.PI / 2).translate(len / 2, 0, 0).scale(1, sy, sz);
}

/** Armour plate: an open angular shell over the top and sides of a segment along +X. */
function shell(len: number, r0: number, r1: number) {
  return new THREE.CylinderGeometry(r1, r0, len, 5, 1, true, -Math.PI / 2 - 1.05, 2.1).rotateZ(-Math.PI / 2).translate(len / 2, 0, 0);
}

const NOISE = `
  float cnH( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
  float cn( vec3 p ) {
    vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( mix( cnH( i ), cnH( i + vec3( 1, 0, 0 ) ), f.x ), mix( cnH( i + vec3( 0, 1, 0 ) ), cnH( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                mix( mix( cnH( i + vec3( 0, 0, 1 ) ), cnH( i + vec3( 1, 0, 1 ) ), f.x ), mix( cnH( i + vec3( 0, 1, 1 ) ), cnH( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
  }`;

/** Perturbs `normal` by the screen-space gradient of a height `h` (metres). */
const BUMP = (h: string) => `
  {
    vec3 dpx = dFdx( -vViewPosition ); vec3 dpy = dFdy( -vViewPosition );
    float hx = dFdx( ${h} ); float hy = dFdy( ${h} );
    vec3 r1 = cross( dpy, normal ); vec3 r2 = cross( normal, dpx );
    float det = dot( dpx, r1 );
    vec3 grad = sign( det ) * ( hx * r1 + hy * r2 );
    normal = normalize( abs( det ) * normal - grad );
  }`;

/**
 * The skull's own bronze: vertex colours carry the unit-sphere direction of
 * each vertex, so plate seams, tarnish, the soot in the sockets and the red
 * spill of the eyes are drawn in skull space at any scale. `uGlow` dims the
 * spill as it dies.
 */
function skullBronze(normalMap: THREE.Texture | null, glow: { value: number }) {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.46, 0.34, 0.18), metalness: 0.85, roughness: 0.4, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uGlow;
        float skH; float skTarn; float skSeam;
        ${NOISE}
        float seamLine( float d ) { return 1.0 - smoothstep( 0.0, 0.016, abs( d ) ); }`,
      )
      .replace(
        '#include <color_fragment>',
        `{
          vec3 u = vColor * 2.0 - 1.0;
          float ax = abs( u.x );
          float n = cn( u * 4.0 ) * 0.5 + cn( u * 11.0 ) * 0.32 + cn( u * 29.0 ) * 0.18;
          skTarn = smoothstep( 0.35, 0.85, n );
          // Plate seams: either side of the crown plate, across the crown, round the back and along the temples.
          float s1 = seamLine( ax - 0.2 ) * smoothstep( 0.22, 0.34, u.y ) * smoothstep( 0.9, 0.78, u.z );
          float s2 = seamLine( u.z - 0.16 + 0.1 * u.y ) * smoothstep( -0.08, 0.04, u.y ) * smoothstep( 0.19, 0.24, ax );
          float s3 = seamLine( u.z + 0.46 ) * smoothstep( -0.2, -0.08, u.y ) * smoothstep( 0.19, 0.24, ax );
          float s4 = seamLine( u.y - 0.02 + 0.08 * u.z ) * smoothstep( 0.5, 0.35, u.z ) * smoothstep( 0.55, 0.7, ax );
          float s5 = seamLine( u.y - 0.3 ) * smoothstep( 0.62, 0.72, u.z ) * smoothstep( 0.24, 0.2, ax ) ;
          skSeam = max( max( max( s1, s2 ), max( s3, s4 ) ), s5 );
          float scratch = smoothstep( 0.93, 1.0, cn( vec3( u.x * 70.0 + u.z * 9.0, u.y * 6.0, u.z * 4.0 ) ) ) * ( 1.0 - skTarn );
          float front = smoothstep( 0.55, 0.85, u.z );
          float sock = 0.0;
          float spill = 0.0;
          for ( int i = 0; i < 2; i++ ) {
            float sx = i == 0 ? -0.33 : 0.33;
            vec2 d = ( u.xy - vec2( sx, 0.0 ) ) / vec2( 0.2, 0.17 );
            sock = max( sock, exp( -dot( d, d ) ) * front );
            vec2 e = ( u.xy - vec2( sx * 0.85, -0.28 ) ) / vec2( 0.2, 0.24 );
            spill = max( spill, exp( -dot( e, e ) ) * front );
          }
          vec2 nd = ( u.xy - vec2( 0.0, -0.37 ) ) / vec2( 0.09 + 0.08 * ( u.y + 0.37 ), 0.12 );
          float nose = smoothstep( 0.2, 0.55, exp( -dot( nd, nd ) ) ) * front;
          float under = smoothstep( -0.55, -0.85, u.y );
          vec3 c = mix( vec3( 1.08, 1.02, 0.9 ), vec3( 0.42, 0.32, 0.2 ), skTarn * 0.75 );
          c = mix( c, vec3( 0.42, 0.44, 0.3 ), smoothstep( 0.72, 0.86, cn( u * 7.0 + 13.0 ) ) * 0.35 );
          c *= 1.0 - 0.55 * skSeam;
          c *= 1.0 + 0.5 * scratch;
          c = mix( c, vec3( 0.05, 0.02, 0.015 ), smoothstep( 0.12, 0.6, sock ) );
          c *= 1.0 - 0.6 * spill * smoothstep( 0.5, 0.2, sock );
          c = mix( c, vec3( 0.03, 0.012, 0.01 ), nose );
          c *= 1.0 - 0.55 * under;
          diffuseColor.rgb *= c;
          skH = ( -skSeam * 0.004 + scratch * 0.0004 - skTarn * 0.0012 + n * 0.0015 );
          skTarn = skTarn + skSeam * 0.5 + nose + sock * 0.4;
          skSeam = ( smoothstep( 0.8, 1.0, sock ) * 0.5 + spill * 0.04 ) * uGlow;
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp( roughnessFactor + skTarn * 0.32, 0.0, 1.0 );')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BUMP('skH'))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3( 1.7, 0.16, 0.04 ) * skSeam;');
  };
  if (normalMap) {
    mat.normalMap = normalMap;
    mat.normalScale.set(0.35, 0.35);
  }
  return mat;
}

interface CarrionMats {
  bronze: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  maroon: THREE.MeshStandardMaterial;
  fang: THREE.MeshStandardMaterial;
  fangTip: THREE.MeshStandardMaterial;
  gore: THREE.MeshStandardMaterial;
  blood: THREE.MeshStandardMaterial;
  clawGlow: THREE.MeshBasicMaterial;
}

const shared = new WeakMap<MonsterMaterials, CarrionMats>();

function carrionMats(m: MonsterMaterials): CarrionMats {
  const hit = shared.get(m);
  if (hit) return hit;
  const metalNormal = (m.iron as THREE.MeshStandardMaterial).normalMap;
  // Tarnished bronze for the loose plates, teeth roots and rivets.
  const bronze = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.42, 0.31, 0.16), metalness: 0.85, roughness: 0.42, normalMap: metalNormal });
  bronze.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBrP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBrP;\nfloat brT;\n${NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        brT = smoothstep( 0.4, 0.75, cn( vBrP * 9.0 ) * 0.6 + cn( vBrP * 27.0 ) * 0.4 );
        diffuseColor.rgb *= mix( vec3( 1.05 ), vec3( 0.4, 0.28, 0.17 ), brT * 0.8 );`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp( roughnessFactor + brT * 0.3, 0.0, 1.0 );');
  };
  const brass = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.85, 0.6, 0.24), metalness: 0.95, roughness: 0.3 });
  const red = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.055, 0.005, 0.008), roughness: 0.28, metalness: 0.1, flatShading: true });
  // Near-black chitin with a fine ring-mail grain between the plates.
  const black = (m.chitin as THREE.MeshStandardMaterial).clone();
  black.color.setRGB(0.085, 0.06, 0.06);
  black.roughness = 0.62;
  black.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMlP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMlP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMlP;\nfloat mlH;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 q = fract( vMlP * 55.0 ) - 0.5;
          float r = length( q );
          float ring = 1.0 - smoothstep( 0.04, 0.11, abs( r - 0.3 ) );
          mlH = ring * 0.0012;
          diffuseColor.rgb *= 0.7 + ring * 0.6;
        }`,
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BUMP('mlH'));
  };
  const maroon = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.013, 0.011), roughness: 0.5, metalness: 0.15 });
  const mats: CarrionMats = {
    bronze,
    brass,
    red,
    black,
    maroon,
    fang: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.24, 0.15, 0.08), metalness: 0.1, roughness: 0.48 }),
    fangTip: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.86, 0.74, 0.56), emissive: new THREE.Color(0.12, 0.035, 0.01), roughness: 0.18, transparent: true, opacity: 0.72 }),
    gore: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.06, 0.012, 0.01), roughness: 0.4 }),
    blood: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.26, 0.012, 0.01), roughness: 0.12, metalness: 0.1 }),
    clawGlow: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.3, 0.08), fog: false }),
  };
  shared.set(m, mats);
  return mats;
}

interface CarrionLeg {
  side: number;
  index: number;
  hip: THREE.Vector3;
  base: THREE.Object3D;
  femur: THREE.Object3D;
  tibia: THREE.Object3D;
  meta: THREE.Object3D;
  claw: THREE.Object3D;
  /** Neutral foot spot, body space on the floor. */
  rest: THREE.Vector3;
  /** Where the claw tip goes this frame (body space). */
  foot: THREE.Vector3;
  /** How folded the lower leg is (a step lifting it). */
  tuck: number;
  /** Death curl blend. */
  curl: number;
  offset: number;
  seed: number;
}

const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

class CarrionRig extends BasicRig {
  readonly thorax: THREE.Object3D;
  readonly abdomen: THREE.Object3D;
  readonly skull: THREE.Object3D;
  readonly mandibles: THREE.Object3D[] = [];
  readonly palps: THREE.Object3D[] = [];
  readonly strands: THREE.Object3D[] = [];
  readonly legs: CarrionLeg[] = [];
  readonly glow = { value: 1 };
  readonly eyeMats: { mat: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];
  /** Extra spread of the fangs set by actions (radians). */
  spread = 0;
  dead = false;
  private look = 0;
  private inv = new THREE.Matrix4();
  private tmp = new THREE.Vector3();

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, (Math.PI * 2) / (STRIDE * scale), 4.4);
    const c = carrionMats(m);
    this.thorax = joint(this.body, 0, RIDE, 0);
    // The skull tips its face up a little, toward the camera above.
    this.skull = joint(this.thorax, SKC.x, SKC.y, SKC.z);
    this.skull.rotation.x = -0.26;
    this.buildSkull(m, c, rng);
    this.buildMouth(c, rng);
    this.abdomen = joint(this.thorax, 0, 0.14, -0.42);
    this.abdomen.scale.setScalar(0.85);
    this.buildAbdomen(c);
    this.buildUnderside(c);
    this.buildLegs(c, rng);
    this.animate(0);
    this.solve();
    bakeRig(this.root);
  }

  private buildSkull(m: MonsterMaterials, c: CarrionMats, rng: Rng) {
    const geo = sculptSphere(1, skullDisp, SK, 72, 54);
    // Vertex colours carry the undisplaced direction for the skull shader.
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i) / SK.x, pos.getY(i) / SK.y, pos.getZ(i) / SK.z).normalize();
      col.set([v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, v.z * 0.5 + 0.5], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    mesh(geo, skullBronze((m.iron as THREE.MeshStandardMaterial).normalMap, this.glow), this.skull);

    // Rivets along the plate seams.
    const rivet = new THREE.SphereGeometry(0.013, 6, 4);
    const put = (n: THREE.Vector3) => {
      const p = skullPoint(n, 0.004);
      mesh(rivet, c.bronze, this.skull, p.x, p.y, p.z);
    };
    for (const s of [-1, 1]) {
      for (let a = 0.35; a < 2.5; a += 0.21) {
        // Down both edges of the crown plate.
        const r = Math.sqrt(1 - 0.25 * 0.25);
        if (Math.sin(a) * r > 0.3) put(new THREE.Vector3(s * 0.25, Math.sin(a) * r, Math.cos(a) * r));
      }
      for (const zc of [0.22, -0.4]) {
        // Across the crown seam and the rear seam.
        const r = Math.sqrt(1 - zc * zc);
        for (let a = 0.25; a < 1.35; a += 0.2) put(new THREE.Vector3(s * Math.cos(a) * r, Math.sin(a) * r, zc + (rng() - 0.5) * 0.01));
      }
    }

    // A helmet flange flares out over the back and sides of the cranium.
    const fl: number[] = [];
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const a = 0.95 + (i / steps) * (Math.PI * 2 - 1.9);
      const n = new THREE.Vector3(Math.sin(a), -0.12, Math.cos(a));
      const p = skullPoint(n, -0.015);
      const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const w = 0.08 + 0.1 * Math.sin((i / steps) * Math.PI) ** 0.7;
      const o = p.clone().addScaledVector(out, w).add(new THREE.Vector3(0, -0.06, 0));
      fl.push(p.x, p.y + 0.02, p.z, o.x, o.y + 0.012, o.z, o.x, o.y - 0.012, o.z, p.x, p.y - 0.03, p.z);
    }
    const flIdx: number[] = [];
    for (let i = 0; i < steps; i++)
      for (let k = 0; k < 4; k++) {
        const a = i * 4 + k;
        const b = i * 4 + ((k + 1) % 4);
        flIdx.push(a, b, a + 4, b, b + 4, a + 4);
      }
    const flange = new THREE.BufferGeometry();
    flange.setAttribute('position', new THREE.Float32BufferAttribute(fl, 3));
    flange.setIndex(flIdx);
    flange.computeVertexNormals();
    mesh(flange, c.bronze, this.skull);

    // Hot eyes deep in the sockets, each with a soft red halo.
    for (const s of [-1, 1]) {
      const n = new THREE.Vector3(s * 0.33, 0.0, 0.93);
      const p = skullPoint(n, 0.02);
      const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 1.9, 0.35), fog: false });
      const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.18, 0.04), fog: false, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
      this.eyeMats.push({ mat: core, base: core.color.clone() }, { mat: halo, base: halo.color.clone() });
      mesh(new THREE.SphereGeometry(0.068, 12, 8).scale(1.25, 0.85, 0.7), core, this.skull, p.x, p.y, p.z - 0.02);
      mesh(new THREE.SphereGeometry(0.11, 12, 8).scale(1.2, 0.9, 0.5), halo, this.skull, p.x, p.y, p.z + 0.005).castShadow = false;
    }
  }

  private buildMouth(c: CarrionMats, rng: Rng) {
    const th = this.thorax;
    // Dark gullet under the muzzle.
    mesh(new THREE.SphereGeometry(0.2, 14, 10).scale(0.9, 0.45, 0.8), c.gore, th, 0, -0.2, 0.27);
    // Upper teeth along the rim of the muzzle.
    const n = 7;
    for (let i = 0; i < n; i++) {
      const x = -0.3 + (0.6 * i) / (n - 1) + (rng() - 0.5) * 0.04;
      const p = skullPoint(new THREE.Vector3(x, -0.66, 0.74), -0.02);
      const len = 0.13 + 0.1 * (1 - Math.abs(x) / 0.32) * (i % 2 ? 0.6 : 1) + rng() * 0.05;
      const g = taper(curve([0, 0, 0], [0, -len * 0.5, 0.015], [-x * 0.08, -len, -0.004]), 0.019, 0.002, 6, 5);
      mesh(g, c.fang, this.skull, p.x, p.y + 0.02, p.z - 0.015);
    }
    // The two great fangs hang from mandibles under the cheeks.
    for (const s of [-1, 1]) {
      const md = joint(th, s * 0.15, -0.2, 0.42);
      mesh(new THREE.SphereGeometry(0.045, 8, 6).scale(1, 1.1, 1.2), c.black, md);
      mesh(new THREE.ConeGeometry(0.06, 0.12, 6).rotateX(Math.PI).translate(0, -0.06, 0.01), c.black, md);
      const fangCurve = curve([0, 0, 0], [s * 0.025, -0.17, 0.08], [0, -0.36, 0.09], [-s * 0.05, -0.52, 0.01]);
      mesh(taper(fangCurve, 0.055, 0.013, 12, 7), c.fang, md);
      // Translucent tip.
      const tipCurve = curve([-s * 0.05, -0.52, 0.01], [-s * 0.063, -0.56, -0.02], [-s * 0.07, -0.6, -0.06]);
      mesh(taper(tipCurve, 0.013, 0.001, 5, 7), c.fangTip, md);
      // Ribbed bronze collar at the root.
      mesh(new THREE.TorusGeometry(0.045, 0.012, 5, 10).rotateX(Math.PI / 2), c.bronze, md, 0, -0.05, 0.02);
      // Blood smeared down the fang and a strand swinging from it.
      mesh(taper(curve([s * 0.03, -0.12, 0.09], [s * 0.035, -0.2, 0.1], [s * 0.025, -0.3, 0.09]), 0.012, 0.004, 5, 4), c.blood, md);
      const strand = joint(md, -s * 0.035, -0.44, 0.05);
      mesh(taper(curve([0, 0, 0], [0.005, -0.08, 0.01], [0, -0.17, 0]), 0.007, 0.003, 5, 4), c.blood, strand);
      mesh(new THREE.SphereGeometry(0.014, 6, 5).scale(1, 1.4, 1), c.blood, strand, 0, -0.18, 0);
      this.strands.push(strand);
      this.mandibles.push(md);

      // Small pedipalps beside the fangs.
      const pp = joint(th, s * 0.3, -0.24, 0.34);
      pp.rotation.y = s * 0.35;
      const seg1 = joint(pp, 0, 0, 0);
      seg1.rotation.x = 0.9;
      mesh(prism(0.2, 0.03, 0.024, 5).rotateY(-Math.PI / 2), c.red, seg1);
      const seg2 = joint(seg1, 0, 0, 0.2);
      seg2.rotation.x = 0.7;
      mesh(prism(0.16, 0.022, 0.012, 5).rotateY(-Math.PI / 2), c.black, seg2);
      mesh(new THREE.ConeGeometry(0.012, 0.05, 4).rotateX(Math.PI / 2).translate(0, 0, 0.18), c.clawGlow, seg2);
      this.palps.push(seg1);
    }
    // A loose strand between the teeth.
    const st = joint(th, 0.05, -0.32, 0.43);
    mesh(taper(curve([0, 0, 0], [0, -0.1, 0.01], [0.005, -0.2, 0]), 0.008, 0.003, 5, 4), c.blood, st);
    mesh(new THREE.SphereGeometry(0.016, 6, 5).scale(1, 1.4, 1), c.blood, st, 0.005, -0.21, 0);
    this.strands.push(st);
  }

  private buildAbdomen(c: CarrionMats) {
    const ab = this.abdomen;
    ab.rotation.x = -0.12;
    mesh(new THREE.SphereGeometry(0.4, 18, 12).scale(1, 0.8, 1.3).translate(0, 0, -0.4), c.black, ab);
    // Overlapping maroon plates, each lipped by a darker band.
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const r = 0.42 * Math.sin(0.5 + t * 2.3) + 0.06;
      const z = -0.06 - t * 0.78;
      const cap = new THREE.SphereGeometry(r, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1.06, 0.82, 0.5).rotateX(0.3);
      mesh(cap, c.maroon, ab, 0, 0.04 - t * 0.05, z);
      mesh(new THREE.TorusGeometry(r * 0.96, 0.014, 4, 18).rotateX(Math.PI / 2 + 0.3).scale(1.06, 0.82, 0.5), c.black, ab, 0, 0.04 - t * 0.05 - 0.04, z - 0.05);
    }
    // Spinneret knot at the tail.
    mesh(new THREE.ConeGeometry(0.08, 0.16, 6).rotateX(-Math.PI / 2 - 0.4), c.red, ab, 0, -0.08, -0.92);
  }

  private buildUnderside(c: CarrionMats) {
    const th = this.thorax;
    mesh(new THREE.SphereGeometry(0.38, 16, 10).scale(0.95, 0.42, 1.15), c.black, th, 0, -0.18, -0.02);
    // Ribbed belly plates between the legs.
    for (let i = 0; i < 4; i++) mesh(new THREE.SphereGeometry(0.16, 10, 6).scale(1.4, 0.35, 0.6), c.red, th, 0, -0.32 + i * 0.005, 0.2 - i * 0.16);
  }

  private buildLegs(c: CarrionMats, rng: Rng) {
    const restA = [0.78, 1.3, 1.84, 2.36];
    const restR = [1.55, 1.56, 1.54, 1.55];
    const thick = [1.12, 1.0, 0.96, 1.02];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const hip = new THREE.Vector3(side * [0.27, 0.33, 0.33, 0.27][i], -0.16, [0.26, 0.09, -0.08, -0.25][i]);
        const base = joint(this.thorax, hip.x, hip.y, hip.z);
        const T = thick[i];
        // Coxa knuckle.
        mesh(new THREE.SphereGeometry(0.075 * T, 10, 8), c.black, base);
        const femur = joint(base, 0, 0, 0);
        this.segment(c, femur, FEMUR, 0.088 * T, 0.074 * T, side, 'femur', rng);
        const tibia = joint(femur, FEMUR, 0, 0);
        this.segment(c, tibia, TIBIA, 0.077 * T, 0.066 * T, side, 'tibia', rng);
        const meta = joint(tibia, TIBIA, 0, 0);
        this.segment(c, meta, META, 0.068 * T, 0.04 * T, side, 'meta', rng);
        const claw = joint(meta, META, 0, 0);
        // Hooked claw, curling inward, its tip burning.
        const hook = curve([0, 0, 0], [CLAW * 0.45, 0.012, 0], [CLAW * 0.85, -0.01, 0], [CLAW, -0.05, 0]);
        mesh(taper(hook, 0.03 * T, 0.006, 8, 6), c.black, claw);
        mesh(new THREE.ConeGeometry(0.012, 0.06, 5).rotateZ(-Math.PI / 2 - 0.5).translate(CLAW + 0.012, -0.065, 0), c.clawGlow, claw);
        // Second barb behind the claw.
        mesh(new THREE.ConeGeometry(0.018, 0.1, 4).rotateZ(-0.9).translate(0.05, 0.05, 0), c.red, claw);
        const a = restA[i];
        const rest = new THREE.Vector3(side * Math.sin(a) * restR[i], 0, Math.cos(a) * restR[i] - 0.05);
        // Tetrapod: L1 L3 R2 R4 step together, then the other four, with a small ripple front to back.
        const group = (i + (side > 0 ? 1 : 0)) % 2;
        this.legs.push({ side, index: i, hip, base, femur, tibia, meta, claw, rest, foot: rest.clone(), tuck: 0, curl: 0, offset: group * 0.5 + i * 0.05, seed: rng() });
      }
    }
  }

  /** One armoured leg segment along local +X: black core, two crimson plates, brass knuckle band, spurs. */
  private segment(c: CarrionMats, j: THREE.Object3D, len: number, r0: number, r1: number, side: number, kind: 'femur' | 'tibia' | 'meta', rng: Rng) {
    const fwd = side; // local +Z faces forward on the right side, backward on the left
    mesh(prism(len, r0, r1, 6, 1, 0.9), c.black, j);
    // Two overlapping plates flaring toward their lower edge.
    for (const [a, b] of [
      [0.06, 0.5],
      [0.44, 0.88],
    ]) {
      const ra = r0 + (r1 - r0) * a;
      const rb = r0 + (r1 - r0) * b;
      mesh(shell(len * (b - a), ra * 1.06, rb * 1.34).translate(len * a, 0.01, 0), c.red, j);
      mesh(shell(0.018, rb * 1.38, rb * 1.38).translate(len * b - 0.014, 0.01, 0), c.black, j);
    }
    // Brass band and the knuckle at the far end.
    mesh(prism(0.028, r1 * 1.16, r1 * 1.16, 8).translate(len * 0.91, 0, 0), c.brass, j);
    mesh(new THREE.SphereGeometry(r1 * 1.3, 8, 6), c.black, j, len, 0, 0);
    if (kind === 'femur') {
      // A crown of spurs on the knee.
      mesh(new THREE.ConeGeometry(0.034, 0.2, 5).rotateZ(0.35).translate(len - 0.02, r1 + 0.09, 0), c.red, j);
      mesh(new THREE.ConeGeometry(0.022, 0.13, 4).rotateX(-fwd * 0.8).translate(len - 0.06, r1 * 0.6, -fwd * (r1 + 0.04)), c.black, j);
      mesh(new THREE.ConeGeometry(0.02, 0.11, 4).rotateZ(0.6).translate(len * 0.55, r0 + 0.04, 0), c.black, j);
      // Brass plate edging on the thigh.
      mesh(prism(len * 0.36, 0.016, 0.016, 4).translate(len * 0.46, r0 * 1.1, 0), c.brass, j);
    } else if (kind === 'tibia') {
      // Gilded arrowhead boss on top, spur under the joint.
      mesh(new THREE.ConeGeometry(0.045, 0.12, 3).rotateZ(-Math.PI / 2).scale(1, 0.45, 1).translate(len * 0.3, r0 * 1.25, 0), c.brass, j);
      mesh(new THREE.ConeGeometry(0.026, 0.16, 4).rotateZ(Math.PI - 0.5).translate(len * 0.85, -r1 - 0.05, 0), c.red, j);
      mesh(new THREE.ConeGeometry(0.018, 0.1, 4).rotateX(fwd * 1.2).translate(len * 0.5, 0.01, fwd * (r0 + 0.03)), c.black, j);
    } else {
      // Serrated blades down the outer edge of the shin, a gold boss at the top.
      for (let k = 0; k < 4; k++) {
        const t = 0.2 + k * 0.19;
        const h = 0.13 - k * 0.02 + rng() * 0.02;
        mesh(new THREE.ConeGeometry(0.022, h, 4).scale(1, 1, 0.45).rotateZ(0.75).translate(len * t, r0 * (1.25 - t * 0.5) + h * 0.3, 0), k % 2 ? c.black : c.red, j);
      }
      mesh(new THREE.ConeGeometry(0.05, 0.13, 3).rotateZ(Math.PI / 2).scale(1, 0.45, 1).translate(len * 0.12, r0 * 1.3, 0), c.brass, j);
      mesh(new THREE.SphereGeometry(0.018, 6, 4), c.clawGlow, j, len * 0.12, r0 * 1.42, 0);
    }
  }

  protected animate(dt: number) {
    if (this.dead) return;
    const w = this.walk;
    const idle = 1 - w;
    const t = this.time;
    const ph = this.phase;
    const breath = Math.sin(t * 1.7);
    this.look += (THREE.MathUtils.clamp(this.lookYaw, -0.6, 0.6) - this.look) * (1 - Math.exp(-dt * 5));
    // The skull rides high, dipping each time a set of four feet plants.
    const th = this.thorax;
    th.position.set(Math.sin(ph) * 0.025 * w, RIDE + breath * 0.012 * idle - 0.04 * w + Math.cos(ph * 2) * 0.035 * w, 0);
    th.rotation.set(0.05 * w + breath * 0.015 * idle + Math.sin(ph * 2 + 0.6) * 0.02 * w, this.look * 0.55 + Math.sin(ph) * 0.05 * w + Math.sin(t * 0.37) * 0.04 * idle, Math.sin(ph) * 0.035 * w);
    this.abdomen.rotation.set(-0.12 - breath * 0.04 + Math.cos(ph * 2) * 0.05 * w, -Math.sin(ph) * 0.1 * w - this.look * 0.3 + Math.sin(t * 0.5) * 0.04, 0);
    this.abdomen.scale.set(0.85 + breath * 0.02, 0.85 + breath * 0.03, 0.85);
    // Mandibles twitch in uneven bursts.
    const twitch = Math.max(0, Math.sin(t * 5.3) * Math.sin(t * 1.3)) ** 2 * 0.35 + Math.sin(t * 21) * 0.02;
    this.spread = 0;
    this.mandibles.forEach((md, i) => {
      const s = i === 0 ? -1 : 1;
      md.rotation.set(Math.sin(t * 2.2 + i) * 0.04 - 0.1 * w, 0, s * (0.06 + twitch + Math.sin(t * 4.1 + i * 2) * 0.03 * idle));
    });
    this.palps.forEach((p, i) => (p.rotation.x = 0.9 + Math.sin(t * 3.1 + i * 1.7) * 0.12 + Math.sin(ph * 2 + i * Math.PI) * 0.25 * w));
    this.strands.forEach((s, i) => (s.rotation.set(Math.sin(t * 2.6 + i) * 0.12 - 0.35 * w + Math.sin(ph * 2) * 0.15 * w, 0, Math.sin(t * 1.9 + i * 2) * 0.1)));
    // Feet: planted feet slide back under the body as it moves, swinging feet arc forward.
    const half = (STRIDE * DUTY) / 2;
    for (const l of this.legs) {
      const u = ph / (Math.PI * 2) + l.offset;
      const f = u - Math.floor(u);
      let dz: number;
      let lift = 0;
      if (f < DUTY) dz = half * (1 - (2 * f) / DUTY);
      else {
        const s = (f - DUTY) / (1 - DUTY);
        dz = half * (-1 + 2 * s * s * (3 - 2 * s));
        lift = Math.sin(Math.PI * s);
      }
      // Standing, a leg now and then lifts and shifts its footing.
      const cyc = t * 0.23 + l.seed * 7;
      const ci = Math.floor(cyc);
      const q = cyc - ci;
      const shift = q < 0.16 ? ease(q, 0, 0.16) : 1;
      const ox = THREE.MathUtils.lerp(hash(ci - 1, l.index + l.side * 5) - 0.5, hash(ci, l.index + l.side * 5) - 0.5, shift) * 0.18;
      const oz = THREE.MathUtils.lerp(hash(ci - 1, l.index * 3 + l.side) - 0.5, hash(ci, l.index * 3 + l.side) - 0.5, shift) * 0.2;
      const idleLift = q < 0.16 ? Math.sin((q / 0.16) * Math.PI) * 0.14 : 0;
      const tuck = lift * w + idleLift * idle * 2;
      l.foot.set(l.rest.x * (1 - 0.08 * lift * w) + ox * l.side * idle, LIFT * lift * w + idleLift * idle, l.rest.z + dz * w + oz * idle);
      l.tuck = tuck;
      l.curl = 0;
    }
  }

  override update(dt: number, speed: number) {
    super.update(dt, speed);
    this.solve();
  }

  /** Places every leg on its foot target: yaw toward it, then a two-bone solve with the shin hanging nearly plumb. */
  solve() {
    const th = this.thorax;
    th.updateMatrix();
    this.inv.copy(th.matrix).invert();
    for (const l of this.legs) {
      const v = this.tmp.copy(l.foot).applyMatrix4(this.inv).sub(l.hip);
      l.base.rotation.set(0, Math.atan2(-v.z, v.x), 0);
      let tx = Math.hypot(v.x, v.z);
      const ty = v.y;
      const clawA = -1.95 - l.tuck * 0.5;
      const metaA = -1.32 + l.tuck * 0.55;
      const offX = -CLAW * Math.cos(clawA) - META * Math.cos(metaA);
      const by = ty - CLAW * Math.sin(clawA);
      const py = by - META * Math.sin(metaA);
      // Out of reach: the foot lands short rather than the leg locking straight.
      const reach = FEMUR + TIBIA - 0.04;
      const maxPx = Math.sqrt(Math.max(0, reach * reach - py * py));
      if (tx + offX > maxPx) tx = maxPx - offX;
      const bx = tx - CLAW * Math.cos(clawA);
      const px = tx + offX;
      const d = THREE.MathUtils.clamp(Math.hypot(px, py), Math.abs(FEMUR - TIBIA) + 0.02, FEMUR + TIBIA - 0.001);
      const cosK = THREE.MathUtils.clamp((FEMUR * FEMUR + d * d - TIBIA * TIBIA) / (2 * FEMUR * d), -1, 1);
      const th1 = Math.atan2(py, px) + Math.acos(cosK);
      const kx = FEMUR * Math.cos(th1);
      const ky = FEMUR * Math.sin(th1);
      const th2 = Math.atan2(py - ky, px - kx);
      const ex = kx + TIBIA * Math.cos(th2);
      const ey = ky + TIBIA * Math.sin(th2);
      const th3 = Math.atan2(by - ey, bx - ex);
      let a1 = th1;
      let a2 = th2 - th1;
      let a3 = th3 - th2;
      let a4 = clawA - th3;
      if (l.curl > 0) {
        // Dead legs fold up under the body.
        const k = l.curl;
        a1 = THREE.MathUtils.lerp(a1, 1.15, k);
        a2 = THREE.MathUtils.lerp(a2, -2.35, k);
        a3 = THREE.MathUtils.lerp(a3, -1.85, k);
        a4 = THREE.MathUtils.lerp(a4, -1.2, k);
      }
      l.femur.rotation.z = a1;
      l.tibia.rotation.z = a2;
      l.meta.rotation.z = a3;
      l.claw.rotation.z = a4;
    }
  }

  setGlow(g: number) {
    this.glow.value = g;
    for (const e of this.eyeMats) e.mat.color.copy(e.base).multiplyScalar(g);
  }

  /** Front legs (and less so the second pair) lifted toward `to` (body space) by `k`. */
  raiseFront(k: number, up: number, reach: number, second = 0.35) {
    for (const l of this.legs) {
      const w = l.index === 0 ? 1 : l.index === 1 ? second : 0;
      if (!w) continue;
      l.foot.x = THREE.MathUtils.lerp(l.foot.x, l.rest.x * 0.72, k * w);
      l.foot.y += up * k * w;
      l.foot.z += reach * k * w;
      l.tuck += 0.6 * k * w;
    }
  }
}

export function buildCarrion(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody & { lunge(onHit: () => void): void } {
  const c = new CarrionRig(m, rng, scale);
  const th = c.thorax;
  /** Rear up, then drive the fangs down; `rear` 0..1 and `slam` 0..1. */
  const strike = (rear: number, slam: number, crouch = 0) => {
    th.rotation.x += -0.6 * rear + 0.32 * slam + 0.12 * crouch;
    th.position.y += 0.34 * rear - 0.16 * slam - 0.28 * crouch;
    th.position.z += -0.18 * rear + 0.42 * slam - 0.05 * crouch;
    c.raiseFront(rear, 1.05, 0.35);
    // Slamming, the front claws stab down ahead of the skull.
    for (const l of c.legs)
      if (l.index === 0) {
        l.foot.z += 0.55 * slam;
        l.foot.x = THREE.MathUtils.lerp(l.foot.x, l.rest.x * 0.8, slam);
      }
    c.mandibles.forEach((md, i) => {
      const s = i === 0 ? -1 : 1;
      md.rotation.z = s * (0.06 + 0.5 * rear - 0.12 * slam);
      md.rotation.x += -0.45 * rear + 0.25 * slam;
    });
  };
  const keyed = (dur: number, hitAt: number, onHit: (() => void) | null, fn: (k: number) => void) => {
    let fired = false;
    c.play(dur, (k) => {
      fn(k);
      if (!fired && k >= hitAt) {
        fired = true;
        onHit?.();
      }
    });
  };
  return {
    rig: c,
    attack(onHit) {
      // Wind up high on the hind legs, then slam the fangs into the target.
      keyed(0.95, 0.5, onHit, (k) => {
        const rear = ease(k, 0.02, 0.4) * (1 - ease(k, 0.4, 0.5));
        const slam = ease(k, 0.4, 0.5) * (1 - ease(k, 0.62, 1));
        c.setGlow(1 + rear * 0.4);
        strike(rear, slam);
      });
    },
    lunge(onHit) {
      // Crouch low, spring up and forward with the forelegs reaching, land fangs first.
      keyed(1.0, 0.62, onHit, (k) => {
        const crouch = ease(k, 0, 0.32) * (1 - ease(k, 0.32, 0.42));
        const air = hump(k, 0.36, 0.66);
        const slam = ease(k, 0.55, 0.62) * (1 - ease(k, 0.72, 1));
        strike(air * 0.75, slam, crouch);
        th.position.y += air * 0.25;
        for (const l of c.legs) {
          // Airborne, the hind legs trail and the rest tuck.
          if (l.index >= 2) {
            l.foot.z -= air * 0.6 * (l.index - 1);
            l.foot.y += air * 0.3;
          } else l.foot.z += air * 0.5;
          l.foot.x *= 1 + crouch * 0.08;
          l.tuck += air * 0.4;
        }
        c.setGlow(1 + crouch * 0.6);
      });
    },
    flinch() {
      if (c.acting) return;
      const side = Math.random() < 0.5 ? -1 : 1;
      c.play(0.32, (k) => {
        const h = hump(k, 0, 1);
        th.rotation.x -= 0.22 * h;
        th.rotation.z += 0.08 * h * side;
        th.position.z -= 0.12 * h;
        th.position.y += 0.05 * h;
        c.mandibles.forEach((md, i) => (md.rotation.z = (i === 0 ? -1 : 1) * (0.06 + 0.45 * h)));
        c.setGlow(1 + 0.5 * h);
      });
    },
    die() {
      // The legs splay and buckle, the skull crashes down, the legs curl in
      // under it with a last twitch and the eyes gutter out.
      c.dead = true;
      const flick = Math.random() * 10;
      c.play(1.6, (k) => {
        const drop = ease(k, 0.05, 0.42);
        const bounce = hump(k, 0.42, 0.56) * 0.06;
        th.position.set(0, THREE.MathUtils.lerp(RIDE, 0.4, drop) + bounce, -0.05 * drop);
        th.rotation.set(0.1 * drop - hump(k, 0, 0.2) * 0.2, 0, 0.06 * drop);
        c.abdomen.rotation.set(-0.12 + 0.3 * drop, 0, 0.1 * drop);
        c.abdomen.scale.setScalar(0.85);
        for (const l of c.legs) {
          l.foot.set(l.rest.x * (1 + 0.05 * drop), 0, l.rest.z * (1 + 0.05 * drop));
          const tw = Math.sin(k * 34 + l.index * 1.9 + l.side) * 0.18 * hump(k, 0.35, 1);
          l.curl = THREE.MathUtils.clamp(ease(k, 0.3, 0.85) * 0.9 + tw, 0, 1);
          l.tuck = 0;
        }
        c.mandibles.forEach((md, i) => md.rotation.set(-0.9 * drop, 0, (i === 0 ? -1 : 1) * (0.06 + 0.35 * drop)));
        c.strands.forEach((s) => s.rotation.set(0.8 * drop, 0, 0));
        const g = 1 - ease(k, 0.15, 0.95);
        c.setGlow(Math.max(0, g * (0.75 + 0.25 * Math.sin(k * 40 + flick))));
      });
    },
  };
}
