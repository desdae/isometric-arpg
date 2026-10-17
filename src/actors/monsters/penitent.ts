import * as THREE from 'three';
import { Character, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { bump, sculptLathe, sculptSphere, surfacePoint } from '../sculpt';
import { flinch, keyedAction } from './humanoid';
import type { MonsterBody, MonsterMaterials } from './materials';

// Penitent Elder: an old monk of the Pilgrim Road who walked until his feet
// bled and kept walking. Gaunt and stooped, with long white hair falling past
// his shoulders, a white beard to his belly, heavy white brows over deep-set
// dark eyes and a lined, weathered face set in a sad, stern look. He wears a
// heavy, worn habit of olive-brown wool with wide sleeves and the cowl thrown
// back on his shoulders, a twisted dark-gold sash knotted at the waist, and
// iron chains: one wound round his waist, one across his chest from a band
// on his arm, a loop of it held in his left fist and a brass bell hanging
// from it. He walks barefoot, and blood stains his feet and the hem.
// His tall staff is black wood ringed in brass, crowned with a censer cage
// whose embers glow through its bars and a brass flame finial over it that
// burns with hallowed gold fire when he casts.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Drops the triangles whose centroid fails `keep` (works on indexed and plain geometry). */
function keepTris(geo: THREE.BufferGeometry, keep: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
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

/**
 * Tapered tube along `pts` whose section is an ellipse, flattened along
 * `out(t)` (the direction away from whatever it lies on): a lock of hair or
 * beard. Each vertex also records how far along the lock it is (`aT`), so
 * the lock can be swayed more toward its tip.
 */
function lock(pts: THREE.Vector3[], r: (t: number) => number, out: (t: number) => THREE.Vector3, flat = 0.5, tubular = 16, radial = 6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const pos: number[] = [];
  const tt: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    N.copy(out(t));
    N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N).normalize();
    const rr = r(t);
    for (let j = 0; j < radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      const cn = Math.cos(v) * rr * flat;
      const cb = Math.sin(v) * rr;
      pos.push(P.x + N.x * cn + B.x * cb, P.y + N.y * cn + B.y * cb, P.z + N.z * cn + B.z * cb);
      tt.push(t);
    }
  }
  for (let i = 0; i < tubular; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      idx.push(a, a + radial, b, b, a + radial, b + radial);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Merges locks into one geometry (positions, normals and `aT` only). */
function mergeLocks(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const tt: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('aT');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      tt.push(t.getX(i));
    }
    for (let i = 0; i < g.index!.count; i++) idx.push(g.index!.getX(i) + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
  out.setIndex(idx);
  return out;
}

/**
 * Three-strand laid rope (or twisted cloth) along a curve: a tube whose
 * section has three lobes spiralling along it.
 */
function laidRope(curve: THREE.Curve<THREE.Vector3>, r: number, tubular: number, closed = false, pitch = 0.07): THREE.BufferGeometry {
  const radial = 9;
  const frames = curve.computeFrenetFrames(tubular, closed);
  const len = curve.getLength();
  const pos: number[] = [];
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
      const rr = r * (0.78 + 0.32 * Math.pow(Math.abs(Math.cos(1.5 * (v + (along / pitch) * ((Math.PI * 2) / 3)))), 0.7));
      pos.push(P.x + rr * (Math.cos(v) * N.x + Math.sin(v) * B.x), P.y + rr * (Math.cos(v) * N.y + Math.sin(v) * B.y), P.z + rr * (Math.cos(v) * N.z + Math.sin(v) * B.z));
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
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Iron chain laid along `pts`: alternating links turned a quarter apart. */
function chain(parent: THREE.Object3D, pts: THREE.Vector3[], mat: THREE.Material, r = 0.013, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts, closed);
  const n = Math.max(2, Math.floor(curve.getLength() / (r * 1.75)));
  const link = new THREE.TorusGeometry(r, r * 0.3, 4, 7).scale(0.72, 1.3, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n + (closed ? 0 : 1); i++) {
    const u = i / n;
    const p = curve.getPointAt(u);
    const l = mesh(link, mat, parent, p.x, p.y, p.z);
    l.quaternion.setFromUnitVectors(up, curve.getTangentAt(u));
    if (i % 2) l.rotateY(Math.PI / 2);
  }
}

/** Shared GLSL value noise for the material tweaks below. */
const NOISE = `
  float pHash( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
  float pNoise( vec3 p ) {
    vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( mix( pHash( i ), pHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( pHash( i + vec3( 0, 1, 0 ) ), pHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                mix( mix( pHash( i + vec3( 0, 0, 1 ) ), pHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( pHash( i + vec3( 0, 1, 1 ) ), pHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
  }`;

/**
 * Adds a colour pass to a cloned material, working from object-space
 * positions (which after rig baking are the rest pose, so stains stay put).
 */
function tweak(base: THREE.Material, key: string, color: THREE.Color, glsl: string, uniforms: Record<string, { value: unknown }> = {}, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
  const mat = (base as THREE.MeshStandardMaterial).clone();
  mat.color = color;
  mat.side = side;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const decl = Object.entries(uniforms)
      .map(([n, u]) => `uniform ${u.value instanceof THREE.Vector3 ? 'vec3' : 'float'} ${n};`)
      .join('\n');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObjP;\n${decl}\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n{\n${glsl}\n}`);
  };
  return mat;
}

interface Skirt {
  update(w: number, time: number, pool: number): void;
}

/**
 * The habit's long skirt hanging from the hips, deformed every frame: heavy
 * vertical folds, the hem dragging back and swinging with the stride, pushed
 * forward over each knee as it comes through, and pooling on the floor
 * wherever it would pass below it (kneeling, the bob of the walk).
 */
function habitSkirt(parent: THREE.Object3D, floorY: () => number, mat: THREE.Material, profile: [number, number][], rng: Rng, thighs: { side: number; thigh: THREE.Object3D }[], sz: number): Skirt {
  const seg = 40;
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const geo = new THREE.LatheGeometry(curve.getPoints(22), seg);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const top = profile[0][1];
  const len = top - profile[profile.length - 1][1];
  const jag: number[] = [];
  for (let i = 0; i <= seg; i++) jag.push(range(rng, 0, 1));
  const rest = new Float32Array(p.count * 4);
  const foldSeed = range(rng, 0, 6);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    let y = p.getY(i);
    const phi = Math.atan2(x, z);
    const t = (top - y) / len;
    // Deep folds that open toward the hem, and a worn, uneven hem: shorter
    // at the front over the feet, ragged and torn at the right front corner.
    const fold = (0.016 * Math.sin(phi * 9 + foldSeed) + 0.01 * Math.sin(phi * 17 + foldSeed * 2)) * smooth(0.05, 0.9, t);
    const col = Math.round((((phi % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * seg);
    const torn = smooth(0.4, 1.3, Math.cos(phi - 0.75)) * 0.07 * (jag[col % seg] ** 2);
    y += (0.05 * smooth(0.2, 1, Math.cos(phi)) + 0.012 * jag[col % seg] + torn) * smooth(0.85, 1, t);
    rest.set([Math.hypot(x, z) + fold, y, phi, t], i * 4);
  }
  const m = mesh(geo, mat, parent);
  m.userData.dynamic = true;
  m.frustumCulled = false;
  const seed = range(rng, 0, 10);
  return {
    update(w, time, pool) {
      const floor = floorY() + 0.012;
      const push = thighs.map((l) => ({ side: l.side, fwd: Math.max(0, -l.thigh.rotation.x), back: Math.max(0, l.thigh.rotation.x) }));
      for (let i = 0; i < p.count; i++) {
        let r = rest[i * 4];
        let y = rest[i * 4 + 1];
        const phi = rest[i * 4 + 2];
        const t = rest[i * 4 + 3];
        r += Math.sin(time * 1.1 + phi * 2 + seed) * 0.006 * t + Math.sin(time * (2 + 3 * w) - t * 4 + phi * 3) * 0.012 * t * (0.2 + w);
        let x = Math.sin(phi) * r;
        let z = Math.cos(phi) * r * sz - t * t * (0.12 * w + 0.015);
        for (const l of push) {
          // The knee drives the cloth in front of it forward, the heel the back.
          const front = Math.max(0, Math.cos(phi - l.side * 0.45));
          const behind = Math.max(0, -Math.cos(phi - l.side * 0.45));
          z += (l.fwd * front * front * 0.42 - l.back * behind * behind * 0.3) * smooth(0.1, 0.8, t);
        }
        if (pool > 0 && y < floor) {
          const extra = floor - y;
          y = floor + extra * 0.03;
          const k = 1 + (extra * 0.8 * pool) / Math.max(0.05, Math.hypot(x, z));
          x *= k;
          z *= k;
        }
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

/**
 * An old man's hand: a bony palm with raised knuckles and three-jointed
 * fingers that fan along Z and curl about it (so a staff held along the
 * hand's Z passes through the fist).
 */
function oldHand(parent: THREE.Object3D, side: number, skin: THREE.Material, curl: number): THREE.Object3D[][] {
  mesh(
    sculptSphere(0.042, (x, y, z) => 0.12 * bump(z, y, 0, -0.75, 0.9, 0.25) - 0.1 * smooth(0.4, 1, y) + 0.05 * bump(x * side, y, -0.8, 0, 0.3, 0.6), new THREE.Vector3(0.62, 1.15, 1.05), 18, 14),
    skin,
    parent,
    0,
    -0.045,
    0,
  );
  const fingers: THREE.Object3D[][] = [];
  const knuckle = new THREE.SphereGeometry(0.0105, 7, 5);
  for (let f = 0; f < 4; f++) {
    const fz = (f - 1.5) * 0.019;
    const base = joint(parent, 0, -0.085 + Math.abs(f - 1.5) * 0.005, fz);
    mesh(knuckle, skin, base);
    const segs: THREE.Object3D[] = [];
    let j = base;
    const L = [0.034, 0.024, 0.019].map((l) => l * (f === 3 ? 0.8 : f === 0 ? 0.95 : 1));
    for (let s = 0; s < 3; s++) {
      const r = 0.0095 - s * 0.0012;
      j.rotation.z = -side * curl * (s === 0 ? 0.9 : 1.1);
      mesh(new THREE.CapsuleGeometry(r, L[s] - r, 2, 6).translate(0, -L[s] / 2, 0), skin, j);
      segs.push(j);
      j = joint(j, 0, -L[s], 0);
    }
    fingers.push(segs);
  }
  // Thumb, across the front of the fist.
  const tb = joint(parent, -side * 0.018, -0.035, 0.03);
  tb.rotation.set(0.7, 0, -side * 0.5);
  mesh(new THREE.CapsuleGeometry(0.011, 0.03, 2, 6).translate(0, -0.02, 0), skin, tb);
  const tt = joint(tb, 0, -0.04, 0);
  tt.rotation.z = -side * curl * 0.6;
  mesh(new THREE.CapsuleGeometry(0.0095, 0.02, 2, 6).translate(0, -0.014, 0), skin, tt);
  return fingers;
}

/** Where along the staff the hand grips it when holding it up (casting). */
const GRIP = 1.32;

export interface PenitentBody extends MonsterBody {
  /** The long two-handed invocation: staff raised skyward, the finial blazing, for `dur` seconds. */
  invoke(dur: number): void;
}

export function buildPenitent(m: MonsterMaterials, rng: Rng, scale = 1): PenitentBody {
  const s = range(rng, 0.99, 1.03) * scale;
  const c = new Character({ scale: s, hunch: 0.14, stride: 1.7 });

  // --- Materials ------------------------------------------------------------
  const HABIT = new THREE.Color(0.19, 0.155, 0.095);
  // Worn wool: lighter where it rubs, grime gathered in patches, and blood
  // soaked into the lowest part (the dynamic skirt passes its hem height).
  const wool = (key: string, hemY: number) =>
    tweak(
      m.robe,
      key,
      HABIT.clone(),
      `vec3 p = vObjP;
      float n = pNoise( p * 7.0 ) * 0.6 + pNoise( p * 19.0 ) * 0.4;
      float wear = smoothstep( 0.55, 0.85, pNoise( p * 3.5 + 9.0 ) );
      vec3 col = mix( vec3( 1.0 ), vec3( 0.72, 0.66, 0.55 ), smoothstep( 0.3, 0.8, n ) );
      col = mix( col, vec3( 1.25, 1.18, 1.0 ), wear * 0.35 );
      float low = smoothstep( uHemY + 0.32, uHemY, p.y );
      float blood = smoothstep( 0.62, 0.8, pNoise( p * 9.0 + 4.0 ) * 0.6 + pNoise( p * 27.0 ) * 0.4 + low * 0.2 ) * low;
      col = mix( col, vec3( 0.55, 0.09, 0.06 ), blood * 0.75 );
      col *= mix( 1.0, 0.6, low * 0.6 );
      diffuseColor.rgb *= col;`,
      { uHemY: { value: hemY } },
      THREE.DoubleSide,
    );
  const habit = wool('penitentHabit', 0.08 * s);
  const skirtMat = wool('penitentSkirt', -0.95);
  const lining = new THREE.MeshStandardMaterial({ color: 0x141413, roughness: 0.95, side: THREE.DoubleSide });
  const sash = (m.rag as THREE.MeshStandardMaterial).clone();
  sash.color.setRGB(0.44, 0.42, 0.15);
  sash.side = THREE.FrontSide;
  const ironMat = (m.iron as THREE.MeshStandardMaterial).clone();
  ironMat.color.setRGB(0.32, 0.31, 0.31);
  const brass = (m.steel as THREE.MeshStandardMaterial).clone();
  brass.color.setRGB(0.8, 0.58, 0.26);
  brass.metalness = 1;
  brass.roughness = 0.42;
  const darkBrass = brass.clone();
  darkBrass.color.setRGB(0.42, 0.3, 0.14);
  const staffWood = (m.wood as THREE.MeshStandardMaterial).clone();
  staffWood.color.setRGB(0.12, 0.105, 0.1);
  staffWood.roughness = 0.55;
  const ferrule = new THREE.MeshStandardMaterial({ color: 0x121212, metalness: 0.8, roughness: 0.45 });
  const hairMat = (m.hair as THREE.MeshStandardMaterial).clone();
  hairMat.color.setRGB(1.45, 1.45, 1.42);
  hairMat.roughness = 0.62;
  hairMat.side = THREE.DoubleSide;
  // Ruddy, weathered skin; age spots, and the feet caked with dried blood.
  const skin = tweak(
    m.tannedSkin,
    'penitentSkin',
    new THREE.Color(0.86, 0.6, 0.52),
    `vec3 p = vObjP;
    float spots = smoothstep( 0.72, 0.8, pNoise( p * 60.0 ) );
    float blot = pNoise( p * 14.0 );
    vec3 col = mix( vec3( 1.0 ), vec3( 0.82, 0.62, 0.55 ), spots * 0.6 );
    col = mix( col, vec3( 1.05, 0.88, 0.85 ), smoothstep( 0.4, 0.8, blot ) * 0.25 );
    float feet = smoothstep( uFeetY, uFeetY * 0.4, p.y );
    float blood = smoothstep( 0.42, 0.62, pNoise( p * 22.0 + 2.0 ) * 0.7 + pNoise( p * 61.0 ) * 0.3 + feet * 0.25 ) * feet;
    col = mix( col, vec3( 0.42, 0.04, 0.03 ), blood );
    diffuseColor.rgb *= col;`,
    { uFeetY: { value: 0.11 * s } },
  );
  // The face carries its lines in colour: a furrowed brow, crow's feet, the
  // bags under the eyes and a reddened nose. Works in head space.
  const headCentre = new THREE.Vector3();
  const faceUniforms = { uHead: { value: headCentre }, uScale: { value: s } };
  const faceSkin = tweak(
    m.tannedSkin,
    'penitentFace',
    new THREE.Color(0.86, 0.6, 0.52),
    `vec3 p = ( vObjP - uHead ) / uScale;
    float front = smoothstep( 0.03, 0.08, p.z );
    float n = pNoise( p * 90.0 );
    float fh = smoothstep( 0.035, 0.05, p.y ) * smoothstep( 0.1, 0.075, p.y ) * front;
    float lines = smoothstep( 0.82, 0.98, sin( p.y * 520.0 + n * 2.5 + sin( p.x * 60.0 ) * 1.2 ) ) * fh;
    float knit = smoothstep( 0.012, 0.0, abs( abs( p.x ) - 0.008 ) ) * smoothstep( 0.065, 0.03, p.y ) * smoothstep( 0.012, 0.03, p.y ) * front;
    vec2 e = vec2( abs( p.x ) - 0.062, p.y - 0.012 );
    float crow = smoothstep( 0.035, 0.008, length( e ) ) * smoothstep( 0.6, 0.95, sin( atan( e.y, e.x ) * 14.0 + n ) ) * step( 0.0, e.x + 0.004 );
    float bags = smoothstep( 0.02, 0.0, abs( p.y + 0.005 - abs( p.x - sign( p.x ) * 0.04 ) * 0.2 ) - 0.002 ) * smoothstep( 0.06, 0.02, abs( abs( p.x ) - 0.038 ) ) * front;
    float nose = smoothstep( 0.035, 0.0, length( vec2( p.x, p.y + 0.03 ) ) ) * smoothstep( 0.08, 0.1, p.z );
    float sockets = smoothstep( 0.03, 0.005, length( vec2( abs( p.x ) - 0.034, ( p.y - 0.012 ) * 1.4 ) ) ) * front;
    vec3 col = vec3( 1.0 );
    col = mix( col, vec3( 1.1, 0.78, 0.74 ), nose * 0.5 );
    col *= 1.0 - 0.45 * max( max( lines, knit * 0.8 ), crow * 0.7 );
    col *= 1.0 - 0.25 * bags;
    col = mix( col, vec3( 0.38, 0.24, 0.22 ), sockets * 0.75 );
    diffuseColor.rgb *= col;`,
    faceUniforms,
  );
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0x5e534b, roughness: 0.3 });
  const iris = new THREE.MeshStandardMaterial({ color: 0x120c09, roughness: 0.2 });
  // Hallowed fire: HDR gold; its strength is animated (dim at rest, blazing in casts).
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2, 0.6), fog: false });
  const emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.1, 0.25), fog: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 0.9, 0.25), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const smokeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.5, 0.45), transparent: true, opacity: 0.25, depthWrite: false });

  const L = c.arm(-1); // the staff arm (his right hand)
  const Rt = c.arm(1); // the chain hand

  // --- Head -----------------------------------------------------------------
  // Unit-sphere layout (z forward): brow y 0.22, eyes 0.1, nose tip -0.1,
  // mouth -0.36, chin -0.72.
  c.head.position.set(0, 0.37, 0.05);
  const headR = 0.104;
  const headScale = new THREE.Vector3(0.88, 1.02, 1.0);
  const headPos = new THREE.Vector3(0, 0.1, 0.0);
  const face = (x: number, y: number, z: number) => {
    const front = smooth(0.2, 0.85, z);
    const tip = smooth(0.6, 0.98, z);
    let d = 0;
    d += 0.15 * bump(x, y, 0, 0.24, 0.6, 0.07) * front; // heavy brow
    d -= 0.04 * bump(x, y, 0, 0.3, 0.07, 0.12) * front; // furrow between the brows
    for (const sd of [-1, 1]) {
      d -= 0.17 * bump(x, y, sd * 0.32, 0.1, 0.15, 0.075) * front; // deep-set eyes
      d += 0.04 * bump(x, y, sd * 0.33, 0.015, 0.12, 0.03) * front; // bags under them
      d += 0.1 * bump(x, y, sd * 0.52, -0.02, 0.16, 0.08) * front; // cheekbones
      d -= 0.1 * bump(x, y, sd * 0.55, -0.3, 0.18, 0.16) * front; // hollow cheeks
      d -= 0.07 * bump(x, y, sd * 0.86, 0.18, 0.2, 0.2); // sunken temples
    }
    d += 0.4 * bump(x, y, 0, -0.04, 0.11, 0.2) * tip; // a long, broad nose
    d += 0.14 * bump(x, y, 0, -0.16, 0.3, 0.07) * tip; // nostril wings
    d += 0.05 * bump(x, y, 0, 0.1, 0.06, 0.1) * tip; // bridge
    d -= 0.08 * smooth(-0.3, -0.85, y) * (1 - 0.3 * front); // narrow old jaw under the beard
    d += 0.05 * bump(x, y, 0, 0.1, 0.8, 0.5) * smooth(0, -0.6, z); // occiput
    return d;
  };
  mesh(lathe([[0.062, -0.1], [0.055, 0.0], [0.05, 0.07]], 14), skin, c.head, 0, 0, -0.012); // scrawny neck
  const skull = sculptSphere(headR, face, headScale, 60, 46);
  const skullMesh = mesh(skull, faceSkin, c.head, headPos.x, headPos.y, headPos.z);
  const facePt = (fy: number, theta: number, lift = 0) => surfacePoint(skull, fy * headR, theta, lift).add(headPos);
  // Eyes: dark, wet and sunk deep under the brow, half hidden by heavy lids.
  for (const sd of [-1, 1]) {
    const e = facePt(0.1, sd * 0.33, -0.012);
    mesh(new THREE.SphereGeometry(0.0125, 10, 8), eyeWhite, c.head, e.x, e.y, e.z);
    mesh(new THREE.SphereGeometry(0.0072, 8, 6), iris, c.head, e.x + sd * 0.001, e.y - 0.001, e.z + 0.008);
    const lid = mesh(new THREE.SphereGeometry(0.0145, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.1, 0.75, 1.05), faceSkin, c.head, e.x, e.y + 0.002, e.z + 0.001);
    lid.rotation.x = 0.55;
    lid.rotation.z = -sd * 0.18; // drooping at the outer corners: the sad look
  }
  // Bushy white brows: tufts sprouting from the brow ridge, knitted low at
  // the centre and spilling down at the outer ends.
  const brow = new THREE.ConeGeometry(0.008, 0.032, 5).scale(1, 1, 0.6).translate(0, 0.014, 0);
  for (const sd of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const u = i / 11;
      const th = sd * (0.12 + u * 0.55);
      const p = facePt(0.215 - u * 0.02 + 0.015 * Math.sin(u * 3), th, 0.002);
      const b = mesh(brow, hairMat, c.head, p.x, p.y, p.z);
      b.rotation.set(-0.5 - 0.3 * rng(), sd * 0.3, -sd * (1.35 + u * 0.6 + range(rng, -0.15, 0.15)));
      b.scale.set(1.3, range(rng, 0.8, 1.25), 1.1);
    }
  }
  // Ears, mostly lost in the hair.
  for (const sd of [-1, 1]) {
    const ear = mesh(sculptSphere(0.026, (_x, y) => 0.15 * bump(0, y, 0, 0.3, 1, 0.3), new THREE.Vector3(0.4, 1.25, 0.8), 12, 10), skin, c.head, sd * 0.092, 0.09, -0.005);
    ear.rotation.y = sd * 0.4;
  }

  // Scalp: swept back from a high forehead, grooved with strands.
  {
    const cap = sculptSphere(
      headR * 1.04,
      (x, y, z) => face(x, y, z) * 0.6 + 0.04 + 0.012 * Math.sin(Math.atan2(x, z) * 34 + y * 4) + 0.03 * smooth(0.2, -0.8, z),
      headScale,
      48,
      30,
    );
    keepTris(cap, (x, y, z) => {
      const u = new THREE.Vector3(x, y, z).normalize();
      // Hairline high on the brow, down past the temples, low at the nape.
      const line = 0.62 - 0.85 * smooth(0.55, -0.1, u.z) - 0.6 * smooth(0.0, -0.8, u.z);
      return u.y > line && !(u.z > 0.5 && u.y < 0.2);
    });
    mesh(cap, hairMat, c.head, headPos.x, headPos.y, headPos.z);
  }

  // Beard base: the face surface pushed out where the beard grows (cheeks,
  // jaw, chin) and the mustache over the mouth.
  const beardBase = sculptSphere(
    headR,
    (x, y, z) => {
      const cutY = 0.08 - 0.26 * smooth(0.3, 0.8, z) - 0.06 * smooth(0.35, 0.1, Math.abs(x)) * smooth(0.75, 0.95, z);
      const grow = smooth(cutY + 0.06, cutY - 0.06, y) * smooth(-0.55, -0.15, z);
      const clumps = 0.03 * Math.sin(x * 30 + y * 7) * Math.sin(y * 23 - x * 5) + 0.015 * Math.sin(x * 51 + y * 37);
      return face(x, y, z) + grow * (0.13 + clumps + 0.25 * bump(x, y, 0, -0.8, 0.6, 0.35)) - (1 - grow) * 0.05;
    },
    headScale,
    60,
    46,
  );
  mesh(beardBase, hairMat, c.head, headPos.x, headPos.y, headPos.z);

  // The long beard and the mustache: locks from the chin and jaw that lie
  // down the chest to the belly, narrowing to a point. One dynamic mesh that
  // sways more toward its ends.
  const beardJ = joint(c.head, 0, headPos.y - 0.06, 0.07);
  const beardLocks: THREE.BufferGeometry[] = [];
  // Distance in front of the chest the beard lies at, by drop below the chin.
  const beardZ = (dy: number) => 0.015 + 0.08 * smooth(0, 0.18, dy) + 0.02 * smooth(0.2, 0.45, dy);
  // Two layers of locks (the back one a little wider) over a solid core.
  for (let layer = 0; layer < 2; layer++) {
    const n = layer ? 11 : 13;
    for (let i = 0; i < n; i++) {
      const u = (i / (n - 1)) * 2 - 1 + range(rng, -0.03, 0.03);
      const x0 = u * (layer ? 0.062 : 0.072);
      const y0 = 0.03 - Math.abs(u) * 0.04 + range(rng, -0.008, 0.008);
      const z0 = 0.015 - Math.abs(u) * 0.05 + (layer ? 0.012 : 0);
      const len = (0.46 - Math.abs(u) ** 1.5 * 0.17 + range(rng, -0.035, 0.025)) * (layer ? 0.95 : 1);
      const pts: THREE.Vector3[] = [];
      const ph = range(rng, 0, 6);
      for (let k = 0; k <= 7; k++) {
        const t = k / 7;
        const dy = t * len;
        // Fans out a little below the chin, then draws in to a point.
        const x = x0 * (1 + 0.3 * Math.sin(Math.PI * Math.min(1, t * 1.6))) * (1 - 0.8 * t ** 1.4) + Math.sin(t * 8 + ph) * 0.007 * t;
        pts.push(new THREE.Vector3(x, y0 - dy, z0 * (1 - smooth(0, 0.3, t)) + beardZ(dy) - Math.abs(x) * 0.3 + (layer ? 0.012 : 0)));
      }
      const r0 = range(rng, 0.024, 0.032);
      beardLocks.push(lock(pts, (t) => r0 * (0.75 + 0.25 * smooth(0, 0.15, t)) * (1 - 0.8 * t ** 1.5), () => new THREE.Vector3(0, 0.15, 1), 0.45, 16, 6));
    }
  }
  {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 6; k++) {
      const dy = (k / 6) * 0.36;
      pts.push(new THREE.Vector3(0, 0.02 - dy, beardZ(dy) - 0.012));
    }
    beardLocks.push(lock(pts, (t) => 0.075 * (1 - 0.85 * t ** 1.3) * (0.8 + 0.2 * smooth(0, 0.2, t)), () => new THREE.Vector3(0, 0.15, 1), 0.35, 12, 10));
  }
  // Wisps loose at the edges.
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const pts = [new THREE.Vector3(sd * (0.065 + k * 0.012), 0.02, -0.02), new THREE.Vector3(sd * (0.075 + k * 0.01), -0.1, 0.06), new THREE.Vector3(sd * (0.06 + k * 0.02), -0.22, 0.1), new THREE.Vector3(sd * (0.05 + k * 0.03), -0.3 + k * 0.03, 0.1)];
      beardLocks.push(lock(pts, (t) => 0.012 * (1 - 0.85 * t), () => new THREE.Vector3(0, 0, 1), 0.5, 10, 5));
    }
  }
  const beardGeo = mergeLocks(beardLocks);
  const beard = mesh(beardGeo, hairMat, beardJ);
  beard.userData.dynamic = true;
  // Mustache: thick, drooping over the mouth into the beard.
  const mus = facePt(-0.25, 0, -0.008);
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const a = mus.clone().add(new THREE.Vector3(sd * (0.004 + k * 0.005), -k * 0.004, -k * 0.004));
      const pts = [a, a.clone().add(new THREE.Vector3(sd * 0.022, -0.012, 0.0)), a.clone().add(new THREE.Vector3(sd * 0.036, -0.035, -0.008)), a.clone().add(new THREE.Vector3(sd * 0.04, -0.065, -0.01))];
      mesh(lock(pts, (t) => 0.012 * (1 - 0.6 * t), () => new THREE.Vector3(0, 0, 1), 0.6, 8, 5), hairMat, c.head);
    }
  }

  // Long hair: locks from round the back and sides of the scalp falling over
  // the cowl to below the shoulders, a few spilling forward over the
  // shoulders. Dynamic, swaying.
  const hairJ = joint(c.head, 0, 0, 0);
  const hairLocks: THREE.BufferGeometry[] = [];
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < 30; i++) {
    const a = Math.PI + ((i / 29) * 2 - 1) * (Math.PI - 1.45) + range(rng, -0.04, 0.04); // 0 is the front, pi the back
    const sn = Math.sin(a);
    const sd = Math.sign(sn) || 1;
    const back = smooth(1.6, 2.7, Math.abs(Math.atan2(sn, Math.cos(a)))); // 0 at the sides, 1 at the back
    const j = () => range(rng, -0.012, 0.012);
    // Side locks lie over the cowl and fall down the front of the shoulders;
    // the rest fall over the hood down the back.
    const side = [V(sd * 0.17, 0.02, 0.0), V(sd * 0.225, -0.1, 0.05), V(sd * 0.215, -0.26, 0.1), V(sd * 0.2, -0.38, 0.11)];
    const rear = [V(sn * 0.15, 0.02, -0.2), V(sn * 0.17, -0.12, -0.285), V(sn * 0.18, -0.3, -0.3), V(sn * 0.18, -0.46, -0.29)];
    const len = range(rng, 0.85, 1.05);
    const pts = [V(sn * 0.088, 0.13, Math.cos(a) * 0.095), V(sn * 0.122, 0.07, Math.cos(a) * 0.112 - 0.012)];
    for (let k = 0; k < 4; k++) {
      const p = side[k].clone().lerp(rear[k], back);
      if (k > 1) p.y = 0.02 + (p.y - 0.02) * len;
      pts.push(p.add(V(j(), 0, j() * 0.5)));
    }
    const rr = range(rng, 0.02, 0.028);
    const out = V(sn, 0.25, Math.cos(a) * (0.3 + 0.7 * back)).normalize();
    hairLocks.push(lock(pts, (t) => rr * (1 - 0.8 * t ** 1.5), () => out, 0.4, 18, 6));
  }
  const hairGeo = mergeLocks(hairLocks);
  const hair = mesh(hairGeo, hairMat, hairJ);
  hair.userData.dynamic = true;

  // --- Habit: body ---------------------------------------------------------
  c.chest.position.y = 0.2;
  const chestGeo = sculptLathe(
    [[0.17, -0.22], [0.2, -0.08], [0.215, 0.06], [0.22, 0.16], [0.2, 0.24], [0.13, 0.32], [0.07, 0.36]],
    (_x, y, _z, t) => 0.008 * Math.sin(t * 7 + 0.5) * smooth(0.2, -0.2, y) + 0.012 * Math.cos(t * 2) * smooth(0.1, 0.25, y),
    { sx: 1.18, sz: 0.84, seg: 36 },
  );
  mesh(chestGeo, habit, c.chest);
  mesh(sculptLathe([[0.2, -0.16], [0.205, 0.0], [0.195, 0.14]], (_x, _y, _z, t) => 0.006 * Math.sin(t * 9), { sx: 1.16, sz: 0.86, seg: 32 }), habit, c.spine);
  // The cowl thrown back: a heavy roll of wool round the neck, its dark
  // lining showing on top, and the hood lying in a bag down the upper back.
  {
    const roll = new THREE.LatheGeometry(
      [[0.1, 0.3], [0.12, 0.285], [0.165, 0.285], [0.19, 0.305], [0.185, 0.335], [0.155, 0.35], [0.115, 0.345]].map(([r, y]) => new THREE.Vector2(r, y)),
      32,
    );
    roll.scale(1.12, 1, 0.92);
    mesh(roll, habit, c.chest, 0, 0, -0.01);
    mesh(new THREE.LatheGeometry([[0.092, 0.3], [0.105, 0.335], [0.14, 0.352]].map(([r, y]) => new THREE.Vector2(r, y)), 28).scale(1.12, 1, 0.92), lining, c.chest, 0, 0.0, -0.01);
    const bag = sculptSphere(0.2, (x, y) => -0.15 * smooth(0.2, 1, y) * (1 - Math.abs(x)) + 0.04 * Math.sin(x * 9 + y * 3), new THREE.Vector3(0.82, 1.0, 0.36), 24, 16);
    mesh(bag, habit, c.chest, 0, 0.13, -0.17);
    const opening = mesh(new THREE.SphereGeometry(0.12, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(0.95, 0.2, 0.32), lining, c.chest, 0, 0.27, -0.18);
    opening.rotation.x = -0.25;
  }

  // --- Habit: skirt ----------------------------------------------------------
  const skirt = habitSkirt(
    c.hips,
    () => -c.hips.position.y,
    skirtMat,
    [[0.21, 0.12], [0.23, -0.08], [0.27, -0.45], [0.32, -0.8], [0.345, -0.94]],
    rng,
    c.legs,
    0.86,
  );

  // --- Sash, chains and bell ---------------------------------------------------
  const waistY = -0.07;
  const ell = (a: number, k = 1) => new THREE.Vector3(Math.sin(a) * 0.232 * k, 0, Math.cos(a) * 0.18 * k);
  {
    // Twisted sash, wound twice round the waist and knotted at the front left.
    for (const [dy, k] of [[0.0, 1.04], [-0.035, 1.07]]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        pts.push(ell(a, k).add(new THREE.Vector3(0, waistY + dy + 0.008 * Math.sin(a * 3), 0)));
      }
      mesh(laidRope(new THREE.CatmullRomCurve3(pts, true), 0.019, 96, true, 0.09), sash, c.spine);
    }
    const knot = ell(-0.35, 1.12).add(new THREE.Vector3(0, waistY - 0.02, 0.01));
    mesh(sculptSphere(0.035, (x, y) => 0.15 * Math.sin(x * 6 + y * 5), new THREE.Vector3(1.1, 0.9, 0.8), 14, 10), sash, c.spine, knot.x, knot.y, knot.z);
    for (const [dx, len] of [[-0.012, 0.26], [0.02, 0.2]]) {
      const pts = [knot.clone(), knot.clone().add(new THREE.Vector3(dx, -0.08, 0.02)), knot.clone().add(new THREE.Vector3(dx * 1.6, -len * 0.6, 0.03)), knot.clone().add(new THREE.Vector3(dx * 2, -len, 0.025))];
      mesh(laidRope(new THREE.CatmullRomCurve3(pts), 0.016, 24), sash, c.hips, 0, c.spine.position.y, 0);
    }
  }
  // Iron chain round the waist, over the sash, sagging in a loop at the front.
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI + (i / 20) * Math.PI * 2;
      const sag = 0.05 * smooth(1.2, 0.0, Math.abs(a - 0.35));
      pts.push(ell(a, 1.13).add(new THREE.Vector3(0, waistY - 0.012 - sag + 0.01 * Math.sin(a * 2), 0)));
    }
    chain(c.spine, pts, ironMat, 0.013, true);
  }
  // Chain across the chest from a sash band round his left upper arm.
  {
    const band = new THREE.TorusGeometry(0.083, 0.017, 6, 20).rotateX(Math.PI / 2).scale(1, 1, 0.95);
    mesh(band, sash, Rt.upper, 0, -0.05, 0);
    mesh(band, sash, Rt.upper, 0, -0.085, 0).rotation.z = 0.15;
    const pts = [new THREE.Vector3(0.24, 0.17, 0.08), new THREE.Vector3(0.19, 0.08, 0.17), new THREE.Vector3(0.11, -0.04, 0.2), new THREE.Vector3(0.03, -0.17, 0.205), new THREE.Vector3(-0.04, -0.27, 0.2)];
    chain(c.chest, pts, ironMat, 0.012);
  }
  // Brass bell on a short chain at the front of the waist, swinging.
  const bellJ = joint(c.spine, 0.1, waistY - 0.03, 0.2);
  {
    chain(bellJ, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.035, 0.004), new THREE.Vector3(0, -0.07, 0)], ironMat, 0.01);
    const bj = joint(bellJ, 0, -0.08, 0);
    mesh(new THREE.TorusGeometry(0.012, 0.004, 4, 10), brass, bj, 0, 0.0, 0);
    mesh(lathe([[0.0, -0.01], [0.022, -0.012], [0.03, -0.03], [0.032, -0.08], [0.036, -0.12], [0.042, -0.135], [0.034, -0.138], [0.03, -0.13]], 16), brass, bj).scale.setScalar(1.75);
    mesh(new THREE.TorusGeometry(0.035, 0.004, 4, 16).rotateX(Math.PI / 2), darkBrass, bj, 0, -0.06, 0);
    mesh(new THREE.SphereGeometry(0.011, 8, 6), darkBrass, bj, 0, -0.13, 0); // clapper
  }
  // A second bell at his back, as in the art.
  const bell2 = joint(c.spine, -0.17, waistY - 0.03, -0.12);
  {
    chain(bell2, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.05, -0.004), new THREE.Vector3(0, -0.09, 0)], ironMat, 0.01);
    mesh(lathe([[0.0, -0.09], [0.02, -0.095], [0.027, -0.12], [0.03, -0.17], [0.036, -0.19], [0.028, -0.192]], 14), brass, bell2);
  }

  // --- Arms -----------------------------------------------------------------
  // Wide sleeves of the habit, lined dark, over thin old forearms.
  const sleeveHang: { j: THREE.Object3D; arm: typeof L }[] = [];
  const sleeves: THREE.Object3D[] = [];
  const hands: THREE.Object3D[][][] = [];
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    a.shoulder.position.set(side * 0.24, 0.2, -0.01);
    mesh(sculptSphere(0.095, (x, y) => -0.2 * smooth(-0.2, -0.9, y) + 0.02 * Math.sin(x * 8), new THREE.Vector3(1.0, 0.85, 1.05), 18, 12), habit, a.shoulder, -side * 0.01, -0.03, 0);
    mesh(sculptLathe([[0.075, 0.03], [0.08, -0.1], [0.086, -0.22], [0.09, -0.3]], (_x, y, _z, t) => 0.008 * Math.sin(t * 5 + side) * smooth(0, -0.2, y), { seg: 22 }), habit, a.upper);
    const bell = lathe([[0.088, 0.03], [0.095, -0.08], [0.11, -0.2], [0.13, -0.32], [0.134, -0.34]], 26);
    {
      const p = bell.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const ang = Math.atan2(p.getX(i), p.getZ(i));
        // Folds, and an opening cut longer underneath (where it hangs).
        p.setX(i, p.getX(i) * (1 + 0.06 * Math.sin(ang * 6) * smooth(-0.05, -0.3, y)));
        if (y < -0.2) p.setY(i, y - 0.06 * smooth(0.3, -1, Math.cos(ang)) * smooth(-0.2, -0.34, y) + 0.01 * Math.sin(ang * 9));
      }
      bell.computeVertexNormals();
    }
    // The sleeve on its own joint: it slides back down the arm toward the
    // elbow when the arm is raised.
    const sj = joint(a.fore, 0, 0, 0);
    sleeves.push(sj);
    mesh(bell, habit, sj);
    mesh(lathe([[0.08, -0.02], [0.092, -0.15], [0.118, -0.31]], 20), lining, sj);
    // The loose underside of the sleeve, hanging plumb from the elbow.
    const hj = joint(sj, 0, -0.04, 0);
    const flap = new THREE.ConeGeometry(0.1, 0.24, 16, 4, true, Math.PI * 0.5, Math.PI).translate(0, -0.12, 0);
    {
      const p = flap.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * 0.9 + 0.01 * Math.sin(p.getY(i) * 30));
      flap.computeVertexNormals();
    }
    mesh(flap, habit, hj, 0, 0, 0).scale.set(1, 1, 0.75);
    sleeveHang.push({ j: hj, arm: a });
    // Thin forearm and wrist reaching out of the sleeve.
    mesh(lathe([[0.038, 0.0], [0.036, -0.12], [0.034, -0.22], [0.028, -0.31]], 10), skin, a.fore);
    a.hand.position.y = -0.315;
    hands.push(oldHand(a.hand, side, skin, side < 0 ? 1.45 : 1.05));
  }
  // His right hand grips the staff high, his left holds a loop of the chain.
  L.upper.rotation.z = -0.32;
  L.restUpper = -0.12;
  L.restFore = -1.45;
  L.swing = 0;
  Rt.upper.rotation.z = -0.12;
  Rt.restUpper = -0.16;
  Rt.restFore = -1.2;
  Rt.swing = 0.08;
  // The chain end in his left fist, hanging in a loop.
  chain(Rt.hand, [new THREE.Vector3(0.022, -0.06, -0.02), new THREE.Vector3(0.025, -0.12, 0.0), new THREE.Vector3(0.03, -0.19, 0.03), new THREE.Vector3(0.02, -0.15, 0.06), new THREE.Vector3(0.018, -0.07, 0.04)], ironMat, 0.011);

  // --- Legs and bare feet ------------------------------------------------------
  for (const l of c.legs) {
    mesh(lathe([[0.04, -0.1], [0.038, -0.3], [0.032, -0.44]], 10), skin, l.shin);
    const foot = sculptSphere(
      0.05,
      (x, y, z) => 0.25 * bump(x, z, 0, 0.6, 0.8, 0.5) * smooth(0.2, -0.6, y) - 0.25 * smooth(0, 0.9, y) * smooth(0.0, 0.9, z) + 0.2 * bump(y, z, 0.5, -0.6, 0.5, 0.4),
      new THREE.Vector3(0.95, 0.75, 2.3),
      20,
      14,
    );
    mesh(foot, skin, l.foot, 0, -0.035, 0.05);
    for (let t = 0; t < 5; t++) {
      const tx = (t - 2) * 0.017 * -l.side + l.side * 0.004;
      const big = t === 0 ? 1.35 : 1 - t * 0.06;
      mesh(new THREE.SphereGeometry(0.011 * big, 8, 6).scale(1, 0.8, 1.3), skin, l.foot, -tx, -0.062, 0.15 - Math.abs(t - 0.5) * 0.008);
    }
    mesh(new THREE.SphereGeometry(0.033, 10, 8).scale(1, 1, 1.15), skin, l.foot, 0, -0.03, -0.025); // heel
  }

  // --- Staff ------------------------------------------------------------------
  // Origin at the ferrule's point, +Y up the shaft. Black wood ringed with
  // brass, a turned brass head, a censer cage of bars over a bowl with embers
  // glowing inside, and over it a slim brass flame finial whose window holds
  // the hallowed fire.
  const staff = joint(c.root, 0, 0, 0);
  staff.scale.setScalar(s);
  mesh(new THREE.ConeGeometry(0.02, 0.09, 8).rotateX(Math.PI).translate(0, 0.045, 0), ferrule, staff);
  mesh(new THREE.CylinderGeometry(0.016, 0.019, 1.72, 9).translate(0, 0.09 + 0.86, 0), staffWood, staff);
  const ring = (y: number, r: number, h: number, mat = brass) => mesh(lathe([[r * 0.85, -h / 2], [r, -h * 0.25], [r, h * 0.25], [r * 0.85, h / 2]], 10), mat, staff, 0, y, 0);
  ring(0.1, 0.024, 0.03);
  ring(0.24, 0.022, 0.018);
  ring(0.27, 0.022, 0.018);
  ring(1.12, 0.022, 0.02);
  ring(1.6, 0.022, 0.025);
  ring(1.64, 0.02, 0.012, darkBrass);
  // Turned brass column up to the censer.
  mesh(
    lathe(
      [[0.017, 0], [0.026, 0.015], [0.026, 0.03], [0.02, 0.045], [0.03, 0.07], [0.034, 0.09], [0.028, 0.11], [0.02, 0.125], [0.024, 0.14], [0.034, 0.16], [0.03, 0.175], [0.02, 0.185]],
      14,
    ),
    brass,
    staff,
    0,
    1.8,
    0,
  );
  const cy = 1.985; // censer bowl base
  // The bowl: a flared, ribbed cup with a heavy lip.
  mesh(lathe([[0.02, 0], [0.04, 0.008], [0.06, 0.022], [0.072, 0.04], [0.08, 0.05], [0.083, 0.058], [0.075, 0.062]], 18), brass, staff, 0, cy, 0);
  mesh(new THREE.TorusGeometry(0.066, 0.006, 5, 22).rotateX(Math.PI / 2), darkBrass, staff, 0, cy + 0.03, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    mesh(new THREE.SphereGeometry(0.007, 5, 4), darkBrass, staff, Math.sin(a) * 0.07, cy + 0.042, Math.cos(a) * 0.07);
  }
  // Cage of bars round the embers, and a domed lid.
  const cageBase = cy + 0.06;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bar = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.075, 4).translate(0, 0.0375, 0), brass, staff, Math.sin(a) * 0.05, cageBase, Math.cos(a) * 0.05);
    bar.rotation.set(-Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
  }
  mesh(new THREE.TorusGeometry(0.075, 0.005, 4, 20).rotateX(Math.PI / 2), brass, staff, 0, cageBase + 0.073, 0);
  const ember = mesh(new THREE.SphereGeometry(0.04, 12, 8).scale(1, 0.75, 1), emberMat, staff, 0, cageBase + 0.022, 0);
  ember.userData.dynamic = true;
  mesh(lathe([[0.075, 0], [0.068, 0.018], [0.048, 0.04], [0.025, 0.055], [0.016, 0.07], [0.022, 0.08], [0.012, 0.095]], 18), brass, staff, 0, cageBase + 0.075, 0);
  // Tassels: short chains from the lip, each ending in a brass drop.
  for (const sd of [-1, 1]) {
    for (const dz of [0, 1]) {
      const a = sd * Math.PI * 0.5 + dz * Math.PI * 0.18;
      const hx = Math.sin(a) * 0.085;
      const hz = Math.cos(a) * 0.085;
      chain(staff, [new THREE.Vector3(hx, cy + 0.055, hz), new THREE.Vector3(hx * 1.04, cy - 0.01, hz), new THREE.Vector3(hx * 1.05, cy - 0.06, hz)], darkBrass, 0.007);
      mesh(new THREE.ConeGeometry(0.009, 0.04, 6).rotateX(Math.PI), brass, staff, hx * 1.05, cy - 0.085, hz);
    }
  }
  // The flame finial: two crossed brass frames shaped like a spear flame,
  // the fire burning in the window between them.
  const fy = cageBase + 0.17;
  const flamePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = t * Math.PI * 2;
    // Teardrop: wide low, drawn up to a point.
    const v = (1 - Math.cos(a)) / 2; // 0 at the bottom, 1 at the top
    const w = 0.036 * Math.sin(Math.PI * Math.pow(v, 0.7)) * (1 - 0.15 * v);
    flamePts.push(new THREE.Vector3(Math.sin(a) >= 0 ? w : -w, v * 0.17, 0));
  }
  const frame = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(flamePts, true), 48, 0.0055, 5, true);
  mesh(frame, brass, staff, 0, fy, 0);
  mesh(frame.clone().rotateY(Math.PI / 2), darkBrass, staff, 0, fy, 0);
  mesh(new THREE.ConeGeometry(0.008, 0.06, 6).translate(0, 0.03, 0), brass, staff, 0, fy + 0.165, 0); // the point
  mesh(lathe([[0.012, -0.012], [0.02, 0.0], [0.016, 0.012], [0.008, 0.02]], 10), brass, staff, 0, fy - 0.005, 0);
  const flame = mesh(lathe(flamePts.slice(0, 13).map((p) => [Math.abs(p.x) * 0.75, p.y * 0.92 + 0.005] as [number, number]), 12), flameMat, staff, 0, fy, 0);
  flame.userData.dynamic = true;
  const halo = mesh(new THREE.SphereGeometry(0.11, 14, 10).scale(0.8, 1.2, 0.8), haloMat, staff, 0, fy + 0.07, 0);
  halo.userData.dynamic = true;
  halo.renderOrder = 10;
  const tipLocal = new THREE.Vector3(0, fy + 0.08, 0);
  // Censer smoke: a few puffs rising out of the cage and fading.
  const puffs: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const pf = mesh(new THREE.SphereGeometry(0.03, 8, 6), smokeMat.clone(), staff, 0, cageBase + 0.1, 0);
    pf.userData.dynamic = true;
    pf.castShadow = false;
    puffs.push(pf);
  }

  // Head centre (rest pose, root space) for the face shader.
  c.root.updateMatrixWorld(true);
  skullMesh.getWorldPosition(headCentre);
  bakeRig(c.root);

  // --- Motion ---------------------------------------------------------------
  const phase0 = rng() * 6;
  const gait = c as unknown as { phase: number };
  const beardRest = (beardGeo.getAttribute('position').array as Float32Array).slice();
  const hairRest = (hairGeo.getAttribute('position').array as Float32Array).slice();
  const beardT = beardGeo.getAttribute('aT').array as Float32Array;
  const hairT = hairGeo.getAttribute('aT').array as Float32Array;
  const swayLock = (geo: THREE.BufferGeometry, rest: Float32Array, tt: Float32Array, sx: number, sz: number, wave: number, time: number) => {
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const a = p.array as Float32Array;
    for (let i = 0; i < p.count; i++) {
      const t = tt[i];
      const k = t * t;
      const y = rest[i * 3 + 1];
      a[i * 3] = rest[i * 3] + sx * k + Math.sin(time * 2.1 + y * 14) * wave * k;
      a[i * 3 + 1] = y;
      a[i * 3 + 2] = rest[i * 3 + 2] + sz * k;
    }
    p.needsUpdate = true;
  };

  // Staff state: where its ferrule stands on the floor (world), how much it
  // is held up in the hand instead (casting), and the lean while held.
  const plant = new THREE.Vector3();
  let planted = false;
  let lastU = 0;
  let held = 0;
  let heldLean = 0.08;
  let heldRoll = 0.04;
  let heldGrip = GRIP;
  let glow = 1;
  const slide = [0, 0];
  let dead = false;
  let pool = 1;
  const grip = new THREE.Vector3();
  const gripL = new THREE.Vector3();
  const ferruleL = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const qPlant = new THREE.Quaternion();
  const qHeld = new THREE.Quaternion();
  const eTmp = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);
  const rootInv = new THREE.Matrix4();
  let prevHeadX = 0;
  let headVel = 0;

  const placeStaff = (dt: number, w: number) => {
    c.root.updateWorldMatrix(true, true);
    rootInv.copy(c.root.matrixWorld).invert();
    // The grip point in the fist, in root space.
    L.hand.localToWorld(grip.set(0.025, -0.07, 0));
    gripL.copy(grip).applyMatrix4(rootInv);
    // Where the ferrule wants to stand: under the grip, a little ahead.
    const lean = 0.07;
    const g = (gripL.y - 0.0) / Math.cos(lean);
    const ideal = tmp.set(gripL.x - 0.015 * s, 0, gripL.z - Math.sin(lean) * g);
    const u = (((gait.phase + 0.6) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (!planted) {
      plant.copy(ideal).applyMatrix4(c.root.matrixWorld);
      planted = true;
    }
    ferruleL.copy(plant).applyMatrix4(rootInv);
    if (w > 0.15) {
      if (u >= Math.PI) {
        // Swinging forward to the next strike, lifted clear of the floor.
        const k = smooth(Math.PI, Math.PI * 1.9, u);
        const ahead = tmp2.copy(ideal).add(new THREE.Vector3(0, 0, 0.32 * w * s));
        ferruleL.lerp(ahead, k);
        ferruleL.y = Math.sin(((u - Math.PI) / Math.PI) * Math.PI) * 0.12 * s;
      } else if (lastU >= Math.PI) {
        // Strike: the ferrule comes down where it is.
        ferruleL.y = 0;
        plant.copy(ferruleL).applyMatrix4(c.root.matrixWorld);
      }
      if (u >= Math.PI) plant.copy(ferruleL).setY(0).applyMatrix4(c.root.matrixWorld);
    } else {
      // Standing: the ferrule settles under the hand.
      ferruleL.lerp(ideal, 1 - Math.exp(-dt * 3));
      ferruleL.y *= 0.8;
      plant.copy(ferruleL).applyMatrix4(c.root.matrixWorld);
    }
    lastU = u;
    // Planted: the shaft runs from the ferrule up through the fist.
    tmp2.copy(gripL).sub(ferruleL);
    if (tmp2.y < 0.3) tmp2.set(0, 1, 0);
    qPlant.setFromUnitVectors(UP, tmp2.normalize());
    // Held: fixed in the fist at its grip, at the lean the action asks for.
    qHeld.setFromEuler(eTmp.set(heldLean, 0, heldRoll));
    const axis = tmp.set(0, 1, 0).applyQuaternion(qHeld);
    const heldPos = tmp2.copy(gripL).addScaledVector(axis, -heldGrip * s);
    staff.position.copy(ferruleL).lerp(heldPos, held);
    staff.quaternion.copy(qPlant).slerp(qHeld, held);
  };

  c.hooks.push((dt, w, time) => {
    const breathe = Math.sin(time * 1.3 + phase0);
    if (!dead) {
      // Small, careful steps under the habit; a slow stoop of a walk.
      for (const l of c.legs) {
        l.thigh.rotation.x *= 0.6;
        l.shin.rotation.x *= 0.7;
        l.foot.rotation.x *= 0.6;
      }
      c.hips.position.y += breathe * 0.004 * (1 - w);
      c.spine.rotation.x += 0.03 * breathe * (1 - w) + 0.05 * w;
      c.head.rotation.x += 0.12 - 0.02 * breathe;
      // The staff arm swings with the staff: forward as it comes through,
      // back as he walks past the planted ferrule.
      const u = (((gait.phase + 0.6) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      L.restUpper = -0.12 - 0.22 * Math.cos(u - Math.PI) * w;
      L.restFore = -1.45 + 0.12 * w;
      placeStaff(dt, w);
    }
    skirt.update(w, time, pool);
    sleeves.forEach((sj, i) => {
      sj.scale.set(1 - 0.12 * slide[i], 1 - 0.6 * slide[i], 1 - 0.12 * slide[i]);
      sj.position.y = 0.03 * slide[i];
    });
    // Sleeve undersides hang plumb whatever the forearm does.
    for (const sh of sleeveHang) {
      const tilt = sh.arm.upper.rotation.x + sh.arm.fore.rotation.x;
      sh.j.rotation.x = -tilt * 0.85 + Math.sin(time * 1.6 + sh.arm.side) * 0.04;
    }
    // Beard and hair: lag behind the head's nod and the walk, and breathe in the air.
    headVel += (c.head.rotation.x - prevHeadX) / Math.max(dt, 1e-3) * 0.02 - headVel * Math.min(1, dt * 6);
    prevHeadX = c.head.rotation.x;
    beardJ.rotation.x = -c.head.rotation.x * 0.8 - (c.spine.rotation.x + c.chest.rotation.x - 0.12) * 0.5 + headVel;
    hairJ.rotation.x = -(c.head.rotation.x + c.chest.rotation.x + c.spine.rotation.x - 0.1) * 0.6 + headVel * 0.5;
    swayLock(beardGeo, beardRest, beardT, Math.sin(time * 0.9 + phase0) * 0.012, 0.01 * breathe + 0.03 * w, 0.004 + 0.006 * w, time);
    swayLock(hairGeo, hairRest, hairT, Math.sin(time * 0.8 + phase0 + 1) * 0.012, -0.04 * w - 0.01 * Math.max(0, breathe), 0.004 + 0.008 * w, time);
    bellJ.rotation.x = Math.sin(time * 2 + phase0) * 0.08 + 0.25 * w + Math.sin(gait.phase * 2) * 0.2 * w;
    bellJ.rotation.z = Math.sin(time * 1.4 + phase0) * 0.06;
    bell2.rotation.x = Math.sin(time * 1.7 + phase0 + 1) * 0.06 - 0.15 * w;
    // The hallowed fire: a dim, slow flicker at rest, a blaze when casting.
    const flick = 1 + Math.sin(time * 7.3 + phase0) * 0.08 + Math.sin(time * 17.1) * 0.05;
    const g = 0.3 * glow * flick;
    flameMat.color.setRGB(3 * g, 2 * g, 0.6 * g);
    emberMat.color.setRGB(2.4 * (0.6 + 0.4 * glow) * flick, 1.1 * (0.6 + 0.4 * glow) * flick, 0.25);
    haloMat.opacity = Math.min(0.4, 0.035 * (glow * glow - 1) * flick);
    halo.visible = glow > 1.05;
    halo.scale.setScalar(0.55 + 0.12 * glow);
    flame.scale.set(1, 1 + 0.06 * Math.sin(time * 9.7) + 0.04 * (glow - 1), 1);
    for (let i = 0; i < puffs.length; i++) {
      const k = (time * 0.35 + i / puffs.length + phase0) % 1;
      const pf = puffs[i];
      pf.position.set(Math.sin(time * 0.7 + i * 2) * 0.03 * k, cageBase + 0.09 + k * 0.45, Math.cos(time * 0.6 + i) * 0.02 * k);
      pf.scale.set(0.4 + k * 1.2, 0.7 + k * 2.2, 0.4 + k * 1.2);
      (pf.material as THREE.MeshBasicMaterial).opacity = 0.1 * Math.sin(k * Math.PI) * (dead ? 0 : 1);
    }
  });

  const tip = new THREE.Vector3();
  const body: PenitentBody = {
    rig: c,
    attack(onHit) {
      // He lifts the staff off the floor and up before him, the finial
      // kindling, then thrusts it at the target and the fire leaves it.
      keyedAction(
        c,
        1.25,
        [
          { k: 0, uL: -0.12, fL: -1.45, uR: -0.12, fR: -1.05, s: 0, t: 0 },
          { k: 0.42, uL: -0.95, fL: -1.55, uR: -0.25, fR: -1.25, s: -0.12, t: 0.18 },
          { k: 0.55, uL: -1.35, fL: -0.35, uR: -0.1, fR: -0.95, s: 0.16, t: -0.12 },
          { k: 0.72, uL: -1.3, fL: -0.4, uR: -0.1, fR: -0.95, s: 0.14, t: -0.1 },
          { k: 1, uL: -0.12, fL: -1.45, uR: -0.12, fR: -1.05, s: 0, t: 0 },
        ],
        0.56,
        onHit,
        (k, w) => {
          held = smooth(0.0, 0.25, k) * (1 - smooth(0.8, 1, k));
          const raise = smooth(0.1, 0.45, k);
          const thrust = smooth(0.46, 0.56, k) * (1 - smooth(0.72, 0.98, k));
          heldLean = 0.06 - 0.18 * raise * (1 - thrust) + 0.85 * thrust;
          heldRoll = 0.04;
          heldGrip = GRIP - 0.25 * raise;
          slide[0] = 0.5 * raise;
          glow = 1 + 3.2 * smooth(0.1, 0.5, k) * (1 - smooth(0.6, 0.9, k));
          c.head.rotation.x += (-0.12 * raise * (1 - thrust) + 0.06 * thrust) * w;
        },
      );
    },
    invoke(dur) {
      // Both hands on the staff, raised high over his head to the sky, head
      // thrown back; the finial blazes brighter and brighter, then he lowers it.
      keyedAction(
        c,
        Math.max(0.8, dur),
        [
          { k: 0, uL: -0.12, fL: -1.45, uR: -0.12, fR: -1.05, zL: -0.32, zR: 0.02, s: 0 },
          { k: 0.22, uL: -2.35, fL: -0.5, uR: -2.2, fR: -0.7, zL: -0.05, zR: -0.42, s: -0.2 },
          { k: 0.85, uL: -2.5, fL: -0.4, uR: -2.35, fR: -0.6, zL: -0.06, zR: -0.42, s: -0.24 },
          { k: 1, uL: -0.12, fL: -1.45, uR: -0.12, fR: -1.05, zL: -0.32, zR: 0.02, s: 0 },
        ],
        0.5,
        () => {},
        (k, w) => {
          held = smooth(0, 0.12, k) * (1 - smooth(0.88, 1, k));
          const up = smooth(0.02, 0.22, k) * (1 - smooth(0.85, 1, k));
          heldLean = 0.06 - 0.05 * up;
          heldRoll = 0.04 - 0.1 * up;
          heldGrip = GRIP - 0.45 * up;
          slide[0] = slide[1] = up;
          const tremble = Math.sin(k * dur * 40) * 0.015 * up;
          glow = 1 + up * (3 + 3.5 * smooth(0.2, 0.85, k)) + tremble * 20;
          c.head.rotation.x += -0.55 * up * w;
          c.chest.rotation.x += -0.12 * up * w + tremble;
        },
      );
    },
    flinch: () => flinch(c, 0.28),
    die() {
      // His knees give and he sinks onto them, sways, then pitches forward
      // onto his face; the staff slips from his hand and clatters down.
      dead = true;
      held = 0;
      c.root.traverse((o) => (o.frustumCulled = false));
      const p0 = staff.position.clone();
      const q0 = staff.quaternion.clone();
      const side = rng() < 0.5 ? -1 : 1;
      const fallYaw = -range(rng, 0.9, 1.5); // out to his right, away from where he falls
      const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.04, fallYaw, 0, 'YXZ'));
      const p1 = p0.clone().setY(0.03);
      const tilt = range(rng, -0.15, 0.15);
      const pose = (k: number) => {
        // 0 .. 0.45: knees buckle onto the floor. 0.55 .. 1: falls forward.
        const kneel = smooth(0.0, 0.4, k);
        const fall = smooth(0.52, 0.95, k);
        const f = fall * fall;
        c.hips.position.y = THREE.MathUtils.lerp(c.hipHeight, 0.5, kneel) - 0.03 * Math.sin(Math.min(1, k / 0.45) * Math.PI) * (1 - fall);
        c.hips.rotation.set(0, 0, tilt * kneel);
        c.body.rotation.x = 1.4 * f;
        c.body.position.y = 0.06 * f;
        c.body.position.z = -0.42 * f;
        for (const l of c.legs) {
          l.thigh.rotation.x = -0.15 * kneel * (1 - f) - 0.05 * f;
          l.thigh.rotation.z = l.side * 0.08 * kneel;
          l.shin.rotation.x = 1.62 * kneel * (1 - f) + 0.1 * f;
          l.foot.rotation.x = 0.5 * kneel * (1 - f) + 0.6 * f;
        }
        c.spine.rotation.x = 0.25 * kneel + 0.1 * Math.sin(Math.min(1, Math.max(0, (k - 0.4) / 0.15)) * Math.PI) - 0.15 * f;
        c.chest.rotation.x = 0.15 * kneel - 0.1 * f;
        c.head.rotation.x = 0.35 * kneel - 0.6 * f;
        c.head.rotation.y = side * 0.5 * f;
        L.upper.rotation.x = THREE.MathUtils.lerp(-0.12, 0.1, kneel) - 2.4 * f;
        L.upper.rotation.z = -0.32 - 0.25 * f;
        L.fore.rotation.x = THREE.MathUtils.lerp(-1.45, -0.3, kneel) - 0.3 * f;
        Rt.upper.rotation.x = THREE.MathUtils.lerp(-0.12, 0.05, kneel) - 0.4 * f;
        Rt.upper.rotation.z = 0.02 + 0.5 * f;
        Rt.fore.rotation.x = THREE.MathUtils.lerp(-1.05, -0.4, kneel) - 0.6 * f;
        pool = 1 - fall;
        glow = Math.max(0.05, 1 - smooth(0.1, 0.9, k));
        // The staff topples from where it stood, with one bounce at the end.
        const st = smooth(0.12, 0.62, k);
        const sq = st * st;
        const bounce = Math.sin(smooth(0.62, 0.78, k) * Math.PI) * 0.06;
        staff.quaternion.slerpQuaternions(q0, q1, Math.min(1, sq) - bounce);
        staff.position.lerpVectors(p0, p1, sq);
      };
      c.play(2.0, pose, () => c.hooks.push(() => pose(1)));
    },
    muzzle: () => staff.localToWorld(tip.copy(tipLocal)),
  };
  return body;
}
