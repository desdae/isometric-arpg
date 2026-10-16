import * as THREE from 'three';
import type { Effects } from './Effects';
import { fbm2, mulberry32, clamp01, smoothstep } from '../procgen/noise';

// Volumetric-looking spell effects: thousands of GPU-animated, textured
// billboard puffs (fire, smoke, dust, mist, glitter), a churning fire shader
// for projectiles, faceted multi-coloured ice crystals, scorch and rime decals
// draped over the ground, broken shockwave rings, and the blue tint on frozen
// monsters. One SpellFx lives on each area's Effects.

const MAX_PUFFS = 4000;

// ---------------------------------------------------------------- puff atlas

/**
 * 2x2 atlas: three billowy noise puffs and a four-point glint. R is density,
 * G a baked "lit from above" factor so smoke reads as round rather than flat.
 */
function puffAtlas(): THREE.DataTexture {
  const S = 128;
  const W = S * 2;
  const data = new Uint8Array(W * W * 4);
  const dens = (slot: number, x: number, y: number) => {
    const u = x / S - 0.5;
    const v = y / S - 0.5;
    if (slot === 3) {
      // Glint: soft core plus four thin rays.
      const r = Math.hypot(u, v) * 2;
      const rays = Math.max(Math.exp(-Math.abs(u) * 60) * (1 - Math.abs(v) * 2), Math.exp(-Math.abs(v) * 60) * (1 - Math.abs(u) * 2));
      return clamp01(Math.exp(-r * r * 9) + rays * 0.9);
    }
    const seed = slot * 17 + 3;
    const wu = u + fbm2(u * 3 + seed, v * 3, 3, seed) * 0.12;
    const wv = v + fbm2(u * 3, v * 3 + seed, 3, seed + 1) * 0.12;
    const r = Math.hypot(wu, wv) * 2;
    const n = fbm2(wu * 5 + seed * 3, wv * 5, 5, seed + 2) * 0.5 + 0.5;
    const n2 = fbm2(wu * 11 + 9, wv * 11 + seed, 3, seed + 3) * 0.5 + 0.5;
    const body = 1 - smoothstep(0.35, 1.0, r + (0.5 - n) * 0.55);
    return clamp01(body * (0.45 + n * 0.75 + (n2 - 0.5) * 0.4));
  };
  for (let slot = 0; slot < 4; slot++) {
    const ox = (slot % 2) * S;
    const oy = Math.floor(slot / 2) * S;
    const field = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) field[y * S + x] = dens(slot, x, y);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const d = field[y * S + x];
        // Light from up-left: denser further from the light means shadowed.
        const lx = Math.max(0, x - 6);
        const ly = Math.min(S - 1, y + 6);
        const lit = clamp01(0.55 + (d - field[ly * S + lx]) * 2.2);
        const i = ((oy + y) * W + ox + x) * 4;
        data[i] = Math.round(d * 255);
        data[i + 1] = Math.round(lit * 255);
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }
  const t = new THREE.DataTexture(data, W, W, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

let atlas: THREE.DataTexture | null = null;
const puffClock = { value: 0 };

const puffMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.NormalBlending,
    uniforms: { map: { value: (atlas ??= puffAtlas()) }, time: puffClock },
    vertexShader: /* glsl */ `
      uniform float time;
      attribute vec4 a0; // pos, t0
      attribute vec4 a1; // vel, life
      attribute vec4 a2; // size0, size1, gravity, drag
      attribute vec4 a3; // rot, spin, slot, erode
      attribute vec4 a4; // additive, hot, lit, twinkle
      attribute vec4 c0; // start colour, alpha
      attribute vec4 c1; // end colour, fade-in fraction
      varying vec2 vUv;
      varying float vK, vSeed;
      varying vec4 vA3, vA4, vC0, vC1;
      void main() {
        float age = time - a0.w;
        float k = age / a1.w;
        if (k < 0.0 || k > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float d = a2.w;
        vec3 p = a0.xyz + (d > 0.001 ? a1.xyz * (1.0 - exp(-d * age)) / d : a1.xyz * age);
        p.y += 0.5 * a2.z * age * age;
        float size = mix(a2.x, a2.y, 1.0 - (1.0 - k) * (1.0 - k));
        float r = a3.x + a3.y * age;
        vec2 q = mat2(cos(r), sin(r), -sin(r), cos(r)) * position.xy * size;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += q;
        // Pull toward the camera a little so puffs near the ground don't
        // slice into it with a hard line.
        mv.z += size * 0.35;
        gl_Position = projectionMatrix * mv;
        float slot = a3.z;
        vUv = (position.xy + 0.5 + vec2(mod(slot, 2.0), floor(slot / 2.0))) * 0.5;
        vK = k;
        vSeed = a3.x;
        vA3 = a3; vA4 = a4; vC0 = c0; vC1 = c1;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float time;
      varying vec2 vUv;
      varying float vK, vSeed;
      varying vec4 vA3, vA4, vC0, vC1;
      void main() {
        vec4 t = texture2D(map, vUv);
        float dens = t.r;
        // Erosion: the puff thins from its wisps inward as it ages.
        float thr = vK * vA3.w;
        float a = min(1.0, dens * smoothstep(thr, thr + 0.35, dens) * 1.6);
        float fin = vC1.w > 0.0 ? smoothstep(0.0, vC1.w, vK) : 1.0;
        a *= vC0.a * fin * (1.0 - smoothstep(0.55, 1.0, vK));
        if (vA4.w > 0.0) a *= 0.55 + 0.45 * sin(time * 22.0 * vA4.w + vSeed * 31.0);
        if (a < 0.003) discard;
        vec3 col = mix(vC0.rgb, vC1.rgb, smoothstep(0.0, 1.0, vK + (1.0 - dens) * 0.25));
        // Fire: the dense heart of a puff burns white-yellow while young.
        col += vA4.y * pow(dens, 3.0) * (1.0 - vK) * (1.0 - vK) * vec3(1.6, 1.0, 0.35);
        col *= mix(1.0, mix(0.5, 1.25, t.g), vA4.z);
        gl_FragColor = vec4(col * a, a * (1.0 - vA4.x));
      }
    `,
  });

export interface PuffOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  life: number;
  size: number;
  /** Size at the end of its life (defaults to `size`). */
  size1?: number;
  color: THREE.Color;
  alpha?: number;
  /** Colour it fades to over its life (defaults to `color`). */
  color1?: THREE.Color;
  /** Vertical acceleration: negative falls, positive rises (smoke, fire). */
  gravity?: number;
  /** Velocity damping per second. */
  drag?: number;
  spin?: number;
  /** 0-2 noise puffs, 3 a glint. */
  slot?: number;
  /** How much the puff wears away from its wisps as it ages (0-1). */
  erode?: number;
  /** 1 adds light (fire, glow), 0 covers (smoke, dust). */
  add?: number;
  /** White-hot heart while young (fire). */
  hot?: number;
  /** Baked top-lighting strength (smoke, dust, mist). */
  lit?: number;
  /** Flicker rate for glitter. */
  twinkle?: number;
  /** Fraction of life spent fading in. */
  fadeIn?: number;
  /** Seconds before it appears. */
  delay?: number;
}

class Puffs {
  readonly mesh: THREE.Mesh;
  private attrs: THREE.InstancedBufferAttribute[];
  private arr: Float32Array[];
  private next = 0;
  private lo = Infinity;
  private hi = -1;
  private wrapped = false;

  constructor() {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const names = ['a0', 'a1', 'a2', 'a3', 'a4', 'c0', 'c1'];
    this.arr = names.map(() => new Float32Array(MAX_PUFFS * 4));
    // Everything starts dead: born at -inf with a tiny life.
    for (let i = 0; i < MAX_PUFFS; i++) {
      this.arr[0][i * 4 + 3] = -1e6;
      this.arr[1][i * 4 + 3] = 1e-3;
    }
    this.attrs = names.map((n, i) => {
      const a = new THREE.InstancedBufferAttribute(this.arr[i], 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(n, a);
      return a;
    });
    geo.instanceCount = MAX_PUFFS;
    this.mesh = new THREE.Mesh(geo, puffMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
  }

  spawn(o: PuffOpts) {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PUFFS;
    if (this.next === 0) this.wrapped = true;
    this.lo = Math.min(this.lo, i);
    this.hi = Math.max(this.hi, i);
    const j = i * 4;
    const [a0, a1, a2, a3, a4, c0, c1] = this.arr;
    const v = o.vel;
    a0[j] = o.pos.x; a0[j + 1] = o.pos.y; a0[j + 2] = o.pos.z; a0[j + 3] = puffClock.value + (o.delay ?? 0);
    a1[j] = v ? v.x : 0; a1[j + 1] = v ? v.y : 0; a1[j + 2] = v ? v.z : 0; a1[j + 3] = o.life;
    a2[j] = o.size; a2[j + 1] = o.size1 ?? o.size; a2[j + 2] = o.gravity ?? 0; a2[j + 3] = o.drag ?? 0;
    a3[j] = Math.random() * Math.PI * 2; a3[j + 1] = o.spin ?? (Math.random() - 0.5) * 1.6; a3[j + 2] = o.slot ?? Math.floor(Math.random() * 3); a3[j + 3] = o.erode ?? 0.6;
    a4[j] = o.add ?? 0; a4[j + 1] = o.hot ?? 0; a4[j + 2] = o.lit ?? 0; a4[j + 3] = o.twinkle ?? 0;
    const e = o.color1 ?? o.color;
    c0[j] = o.color.r; c0[j + 1] = o.color.g; c0[j + 2] = o.color.b; c0[j + 3] = o.alpha ?? 1;
    c1[j] = e.r; c1[j + 1] = e.g; c1[j + 2] = e.b; c1[j + 3] = o.fadeIn ?? 0.06;
  }

  /** Upload only the slots written this frame. */
  flush() {
    if (this.hi < 0) return;
    const lo = this.wrapped ? 0 : this.lo;
    const hi = this.wrapped ? MAX_PUFFS - 1 : this.hi;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(lo * 4, (hi - lo + 1) * 4);
      a.needsUpdate = true;
    }
    this.lo = Infinity;
    this.hi = -1;
    this.wrapped = false;
  }
}

// ------------------------------------------------------------ churning fire

const snoise3 = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

const churnBase = new THREE.ShaderMaterial({
  uniforms: {
    time: puffClock,
    cold: { value: new THREE.Color() },
    mid: { value: new THREE.Color() },
    hot: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `
    uniform float time;
    varying vec3 vN, vV, vP;
    varying float vD;
    ${snoise3}
    void main() {
      vec3 w = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 o = w * 0.6;
      float n = snoise(position * 1.7 + o + vec3(0.0, -time * 3.2, time * 1.1));
      float n2 = snoise(position * 4.2 + o - vec3(time * 2.3));
      vD = n * 0.24 + n2 * 0.09;
      vec3 p = position + normal * vD;
      vP = position * 2.2 + o + vec3(0.0, -time * 4.0, 0.0);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 cold, mid, hot;
    varying vec3 vN, vV, vP;
    varying float vD;
    ${snoise3}
    void main() {
      float facing = abs(dot(normalize(vN), normalize(vV)));
      float n = snoise(vP) * 0.5 + 0.5;
      float heat = clamp(facing * 0.85 + vD * 1.8 + (n - 0.5) * 0.6 - 0.05, 0.0, 1.0);
      vec3 c = mix(cold, mid, smoothstep(0.05, 0.5, heat));
      c = mix(c, hot, smoothstep(0.55, 1.0, heat));
      gl_FragColor = vec4(c, 1.0);
    }
  `,
});

type Palette = 'fire' | 'arcane' | 'crimson' | 'holy' | 'frost';
const PALETTES: Record<Palette, [THREE.Color, THREE.Color, THREE.Color]> = {
  fire: [new THREE.Color(0.5, 0.04, 0.0), new THREE.Color(3.2, 0.95, 0.12), new THREE.Color(5, 3.6, 1.6)],
  arcane: [new THREE.Color(0.25, 0.05, 0.6), new THREE.Color(1.6, 0.6, 3.6), new THREE.Color(3.6, 3.0, 5.0)],
  crimson: [new THREE.Color(0.35, 0.0, 0.02), new THREE.Color(3.0, 0.25, 0.12), new THREE.Color(5, 2.2, 1.4)],
  holy: [new THREE.Color(0.5, 0.25, 0.02), new THREE.Color(3.0, 2.0, 0.6), new THREE.Color(5, 4.4, 2.6)],
  frost: [new THREE.Color(0.08, 0.2, 0.55), new THREE.Color(0.9, 2.0, 3.2), new THREE.Color(3.6, 4.4, 5.0)],
};
const churnMats = new Map<Palette, THREE.ShaderMaterial>();
function churnMat(p: Palette) {
  let m = churnMats.get(p);
  if (!m) {
    m = churnBase.clone();
    m.uniforms.time = puffClock;
    m.uniforms.cold.value.copy(PALETTES[p][0]);
    m.uniforms.mid.value.copy(PALETTES[p][1]);
    m.uniforms.hot.value.copy(PALETTES[p][2]);
    churnMats.set(p, m);
  }
  return m;
}
const churnGeo = new THREE.IcosahedronGeometry(1, 3);

// Soft additive glow sprite.
let glowTex: THREE.CanvasTexture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
const glowMats = new Map<string, THREE.SpriteMaterial>();
function glowMat(c: THREE.Color) {
  const key = `${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)}`;
  let m = glowMats.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: glowTexture(), color: c.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    glowMats.set(key, m);
  }
  return m;
}

// --------------------------------------------------------------- ice crystals

/** Hexagonal prisms with pointed tips: faceted, so light catches each face. */
const crystalGeos = [
  [0, 0, 0.5, 0, 0.5, 0.72, 0, 1],
  [0, 0, 0.36, 0, 0.42, 0.55, 0.28, 0.8, 0, 1],
  [0, 0, 0.55, 0, 0.5, 0.45, 0, 1],
].map((pts) => {
  const v: THREE.Vector2[] = [];
  for (let i = 0; i < pts.length; i += 2) v.push(new THREE.Vector2(pts[i], pts[i + 1]));
  return new THREE.LatheGeometry(v, 6).toNonIndexed();
});
crystalGeos.forEach((g) => g.computeVertexNormals());

/** White, cyan, pale blue, deep blue and lilac ice. */
const ICE_TINTS = [0xeef8ff, 0x7fe9ff, 0xa9c9ff, 0x3f6cff, 0xc0a8ff];
const crystalMats = ICE_TINTS.map(
  (c) =>
    new THREE.MeshStandardMaterial({
      color: c,
      emissive: new THREE.Color(c).multiplyScalar(0.32),
      roughness: 0.08,
      metalness: 0.15,
      flatShading: true,
      transparent: true,
      opacity: 0.86,
      envMapIntensity: 2.2,
    }),
);
/** Bright glitter colours matching the crystals (HDR, so they bloom). */
const GLITTER = [new THREE.Color(2.6, 2.9, 3.2), new THREE.Color(0.6, 2.4, 3.0), new THREE.Color(1.2, 1.7, 3.2), new THREE.Color(0.35, 0.7, 3.4), new THREE.Color(1.9, 1.2, 3.2)];
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

export function crystalMesh(): THREE.Mesh {
  const m = new THREE.Mesh(pick(crystalGeos), pick(crystalMats));
  m.castShadow = true;
  return m;
}

// --------------------------------------------------------------------- decals

/** R: coverage, G: detail (embers or frost feathers), B: distance from centre. */
function decalTexture(kind: 'scorch' | 'frost'): THREE.DataTexture {
  const S = 256;
  const data = new Uint8Array(S * S * 4);
  const seed = kind === 'scorch' ? 41 : 73;
  const rng = mulberry32(seed);
  // Frost feathers: branching lines rasterised into a mask.
  const feather = new Float32Array(S * S);
  if (kind === 'frost') {
    const plot = (x: number, y: number, w: number) => {
      const xi = Math.round(x);
      const yi = Math.round(y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const px = xi + dx;
          const py = yi + dy;
          if (px < 0 || py < 0 || px >= S || py >= S) continue;
          const f = w * (dx === 0 && dy === 0 ? 1 : 0.35);
          feather[py * S + px] = Math.max(feather[py * S + px], f);
        }
    };
    const grow = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      for (let i = 0; i < len; i++) {
        x += Math.cos(a);
        y += Math.sin(a);
        a += (rng() - 0.5) * 0.08;
        plot(x, y, w * (1 - i / len * 0.5));
        if (depth < 3 && i % 7 === 3) {
          // Side barbs at 60 degrees, like hoarfrost on glass.
          const s = rng() < 0.5 ? -1 : 1;
          grow(x, y, a + s * 1.05, len * 0.3 * (1 - i / len), w * 0.7, depth + 1);
        }
      }
    };
    for (let i = 0; i < 9; i++) grow(S / 2, S / 2, (i / 9) * Math.PI * 2 + rng() * 0.3, S * (0.36 + rng() * 0.1), 1, 0);
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const r = S * (0.12 + rng() * 0.3);
      grow(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, rng() * Math.PI * 2, S * (0.05 + rng() * 0.08), 0.8, 1);
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S - 0.5;
      const v = y / S - 0.5;
      const r = Math.hypot(u, v) * 2;
      const a = Math.atan2(v, u);
      const edge = 0.72 + fbm2(Math.cos(a) * 2 + seed, Math.sin(a) * 2, 4, seed) * 0.3;
      const n = fbm2(u * 7 + seed, v * 7, 5, seed + 1) * 0.5 + 0.5;
      let cover = 1 - smoothstep(edge - 0.3, edge, r);
      let detail = 0;
      if (kind === 'scorch') {
        cover *= 0.55 + n * 0.6;
        // Glowing seams: thin ridges of a noise field, hottest near the centre.
        const ridge = 1 - Math.abs(fbm2(u * 9 + 3, v * 9 + 1, 4, seed + 4)) * 9;
        detail = clamp01(ridge) * (1 - smoothstep(0.1, edge, r)) * (0.5 + n * 0.5);
      } else {
        const f = feather[y * S + x];
        cover = clamp01(cover * (0.3 + n * 0.45) + f * (1 - smoothstep(edge - 0.1, edge + 0.08, r)) * 0.9);
        detail = f;
      }
      const i = (y * S + x) * 4;
      data[i] = Math.round(clamp01(cover) * 255);
      data[i + 1] = Math.round(clamp01(detail) * 255);
      data[i + 2] = Math.round(clamp01(r) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const decalVert = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
let scorchBase: THREE.ShaderMaterial | null = null;
let frostBase: THREE.ShaderMaterial | null = null;
function decalBase(kind: 'scorch' | 'frost'): THREE.ShaderMaterial {
  const make = () =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
      uniforms: { map: { value: decalTexture(kind) }, k: { value: 0 }, life: { value: 1 }, ember: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) }, time: puffClock },
      vertexShader: decalVert,
      fragmentShader:
        kind === 'scorch'
          ? /* glsl */ `
        uniform sampler2D map; uniform float k, life, ember; uniform vec3 tint; varying vec2 vUv;
        void main() {
          vec4 t = texture2D(map, vUv);
          float t1 = k * life;
          float spread = smoothstep(t.b - 0.08, t.b, min(1.0, t1 / 0.12));
          float a = t.r * spread * (1.0 - smoothstep(0.7, 1.0, k)) * 0.88;
          float cool = exp(-t1 * 1.1);
          vec3 glow = vec3(3.4, 1.0, 0.2) * t.g * cool * ember * spread;
          gl_FragColor = vec4(tint * 0.03 * a + glow * t.r, a);
        }`
          : /* glsl */ `
        uniform sampler2D map; uniform float k, life, time; uniform vec3 tint; varying vec2 vUv;
        float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec4 t = texture2D(map, vUv);
          float t1 = k * life;
          // Rime creeps outward from the centre.
          float spread = smoothstep(t.b - 0.1, t.b, min(1.0, t1 / 0.35));
          float a = t.r * spread * (1.0 - smoothstep(0.75, 1.0, k));
          vec2 cell = floor(vUv * 110.0);
          float h = hash(cell);
          float glint = step(0.975, h) * pow(0.5 + 0.5 * sin(time * 5.0 + h * 60.0), 6.0) * t.r;
          vec3 c = mix(vec3(0.45, 0.65, 0.95), vec3(0.85, 0.95, 1.05), t.g) * tint;
          gl_FragColor = vec4(c * a * 0.34 + vec3(2.0, 2.6, 3.2) * glint * spread, a * 0.38);
        }`,
    });
  if (kind === 'scorch') return (scorchBase ??= make());
  return (frostBase ??= make());
}

// ---------------------------------------------------------------- shockwave

const ringBase = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  premultipliedAlpha: true,
  side: THREE.DoubleSide,
  uniforms: { k: { value: 0 }, color: { value: new THREE.Color() }, seed: { value: 0 }, add: { value: 1 } },
  vertexShader: /* glsl */ `varying vec2 vP; varying vec2 vUv; void main() { vP = position.xz; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float k, seed, add; uniform vec3 color; varying vec2 vP; varying vec2 vUv;
    float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 q) { vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
    void main() {
      float r = length(vP);
      float a = atan(vP.y, vP.x);
      float n = noise(vec2(a * 6.0 + seed, r * 3.0 - k * 4.0)) * 0.6 + noise(vec2(a * 17.0 - seed, r * 9.0)) * 0.4;
      // Thick leading edge, ragged and torn, trailing into a faint wash.
      float lead = smoothstep(0.55, 0.95, r) * smoothstep(1.0, 0.93, r);
      float wash = smoothstep(0.5, 0.95, r) * 0.07;
      float alpha = (lead * (0.3 + n * 0.9) + wash * n) * (1.0 - k) * (1.0 - k * 0.5) * 0.7;
      alpha *= smoothstep(0.25, 0.55, n + lead * 0.3);
      gl_FragColor = vec4(color * alpha * (1.0 + lead * 0.8), alpha * (1.0 - add));
    }
  `,
});

// ----------------------------------------------------------- frozen monsters

interface Tintable {
  body: { rig: { root: THREE.Object3D } };
  position: THREE.Vector3;
  height: number;
  radius: number;
}
const frozenCache = [new WeakMap<THREE.Material, THREE.Material>(), new WeakMap<THREE.Material, THREE.Material>()];
const ICE_BODY = [new THREE.Color(0.62, 0.82, 1.0), new THREE.Color(0.7, 0.9, 1.0)];
const ICE_GLOW = [new THREE.Color(0.03, 0.12, 0.28), new THREE.Color(0.08, 0.26, 0.55)];
function frozenOf(m: THREE.Material, level: 1 | 2): THREE.Material {
  const cache = frozenCache[level - 1];
  let f = cache.get(m);
  if (!f) {
    const src = m as THREE.MeshStandardMaterial;
    if (!(src.color instanceof THREE.Color) || !(src.emissive instanceof THREE.Color)) {
      cache.set(m, m);
      return m;
    }
    const c = src.clone();
    // Same shader hooks, so the clone shares the compiled program.
    c.onBeforeCompile = src.onBeforeCompile;
    c.customProgramCacheKey = src.customProgramCacheKey;
    c.userData = src.userData;
    const mix = level === 2 ? 0.7 : 0.45;
    c.color.multiply(new THREE.Color(0.5, 0.7, 1.0)).lerp(ICE_BODY[level - 1], mix);
    c.emissive.add(ICE_GLOW[level - 1]);
    if ('roughness' in c) c.roughness = Math.min(c.roughness, level === 2 ? 0.25 : 0.4);
    f = c;
    cache.set(m, f);
  }
  return f;
}

// ------------------------------------------------------------------- SpellFx

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

export class SpellFx {
  private puffs = new Puffs();
  constructor(private fx: Effects) {
    fx.group.add(this.puffs.mesh);
  }

  /** Advance the shared clock and upload new puffs. */
  update(dt: number) {
    // Game time (only the current area ticks), so pausing freezes puffs too.
    puffClock.value += dt;
    this.puffs.flush();
  }

  puff(o: PuffOpts) {
    this.puffs.spawn(o);
  }

  ground(x: number, z: number) {
    return this.fx.height(x, z);
  }

  // ------------------------------------------------------------ projectiles

  /** A ball of churning fire (or arcane/crimson/holy energy) with a soft glow around it. */
  orb(palette: Palette, radius: number, glowColor: THREE.Color): THREE.Group {
    const g = new THREE.Group();
    const core = new THREE.Mesh(churnGeo, churnMat(palette));
    core.scale.setScalar(radius);
    const halo = new THREE.Sprite(glowMat(glowColor));
    halo.scale.setScalar(radius * 7);
    g.add(core, halo);
    g.userData.core = core;
    return g;
  }

  /** Flames and smoke streaming off a fireball. */
  fireTrail(p: THREE.Vector3, dir: THREE.Vector3, size: number, dt: number) {
    const n = Math.max(1, Math.round(dt * 120));
    for (let i = 0; i < n; i++) {
      const j = v3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(size * 0.5);
      this.puff({
        pos: p.clone().add(j),
        vel: dir.clone().multiplyScalar(-rnd(1, 2.5)).add(v3(0, rnd(0.5, 1.5), 0)),
        life: rnd(0.22, 0.4),
        size: size * rnd(3, 4),
        size1: size * 1.0,
        color: C(2.2, 0.9, 0.2),
        color1: C(0.8, 0.08, 0.02),
        alpha: 0.7,
        add: 1,
        hot: 0.7,
        erode: 0.9,
        drag: 3,
      });
    }
    if (Math.random() < dt * 40) {
      this.puff({
        pos: p.clone(),
        vel: v3(rnd(-0.3, 0.3), rnd(0.6, 1.2), rnd(-0.3, 0.3)),
        life: rnd(0.8, 1.2),
        size: size * 3,
        size1: size * 9,
        color: C(0.025, 0.02, 0.018),
        color1: C(0.07, 0.065, 0.06),
        alpha: 0.5,
        lit: 1,
        erode: 0.8,
        gravity: 0.6,
        fadeIn: 0.2,
        delay: 0.08,
      });
    }
  }

  /** Coloured energy wisps behind an arcane/crimson/holy bolt. */
  energyTrail(p: THREE.Vector3, dir: THREE.Vector3, size: number, c0: THREE.Color, c1: THREE.Color, dt: number, glitter = true) {
    const n = Math.max(1, Math.round(dt * 90));
    for (let i = 0; i < n; i++) {
      this.puff({
        pos: p.clone().add(v3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(size * 0.4)),
        vel: dir.clone().multiplyScalar(-rnd(0.5, 1.5)).add(v3(rnd(-0.4, 0.4), rnd(0, 0.6), rnd(-0.4, 0.4))),
        life: rnd(0.25, 0.45),
        size: size * rnd(3, 4.5),
        size1: size * 0.8,
        color: c0,
        color1: c1,
        add: 1,
        erode: 0.85,
        drag: 2,
      });
    }
    if (glitter && Math.random() < dt * 30) {
      this.puff({ pos: p.clone(), vel: v3(rnd(-0.6, 0.6), rnd(-0.2, 0.8), rnd(-0.6, 0.6)), life: rnd(0.4, 0.7), size: size * 2.5, size1: size, color: c0.clone().multiplyScalar(1.4), add: 1, slot: 3, erode: 0, twinkle: 1, drag: 1.5 });
    }
  }

  /** Frost and glitter shed by an ice shard. */
  frostTrail(p: THREE.Vector3, dir: THREE.Vector3, dt: number) {
    if (Math.random() < dt * 50)
      this.puff({ pos: p.clone(), vel: dir.clone().multiplyScalar(-0.6).add(v3(0, -0.2, 0)), life: rnd(0.5, 0.8), size: rnd(0.08, 0.16), color: pick(GLITTER), add: 1, slot: 3, erode: 0, twinkle: 1, gravity: -1.5 });
    if (Math.random() < dt * 25)
      this.puff({ pos: p.clone(), vel: dir.clone().multiplyScalar(-1), life: rnd(0.4, 0.6), size: 0.25, size1: 0.7, color: C(0.75, 0.88, 1.0), alpha: 0.28, lit: 1, erode: 0.8, drag: 3, fadeIn: 0.1 });
  }

  // ------------------------------------------------------------ explosions

  /** A rolling fireball explosion: white-hot heart, billowing flame, then smoke and a scorch mark. */
  fireBurst(at: THREE.Vector3, r: number, power = 1) {
    const gy = this.ground(at.x, at.z);
    const base = at.clone().setY(Math.max(at.y, gy + r * 0.3));
    this.fx.flash(base.clone().setY(base.y + 0.8), 0xff6a20, 14 * power, r * 3.5, 0.4);
    // White-hot heart.
    for (let i = 0; i < 3; i++)
      this.puff({ pos: base.clone().add(v3(rnd(-0.3, 0.3), rnd(-0.1, 0.3), rnd(-0.3, 0.3)).multiplyScalar(r)), vel: v3(rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1)), life: rnd(0.18, 0.28), size: r * 0.4, size1: r * 1.1, color: C(1.8, 1.0, 0.35), color1: C(1.0, 0.25, 0.04), alpha: 0.45, add: 1, hot: 0.4, erode: 0.7, drag: 4 });
    // Billowing flame.
    const n = Math.round(10 + r * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = rnd(0.1, 0.9);
      const d = v3(Math.cos(a) * (1 - up * 0.6), up, Math.sin(a) * (1 - up * 0.6)).normalize();
      this.puff({
        pos: base.clone().addScaledVector(d, r * 0.35),
        vel: d.multiplyScalar(r * rnd(3, 5.5)),
        life: rnd(0.45, 0.8),
        size: r * rnd(0.35, 0.5),
        size1: r * rnd(0.6, 0.85),
        color: C(1.5, 0.5, 0.1),
        color1: C(0.45, 0.05, 0.01),
        alpha: 0.45,
        add: 1,
        hot: 0.35,
        erode: 0.95,
        drag: 4.5,
        gravity: 2,
      });
    }
    // Smoke rolling up out of it.
    for (let i = 0; i < Math.round(4 + r * 2); i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * r * 0.7;
      this.puff({
        pos: base.clone().add(v3(Math.cos(a) * rr, rnd(0, r * 0.6), Math.sin(a) * rr)),
        vel: v3(Math.cos(a) * rnd(0.6, 1.6), rnd(0.8, 1.8), Math.sin(a) * rnd(0.6, 1.6)),
        life: rnd(1.4, 2.4),
        size: r * 0.45,
        size1: r * rnd(1.0, 1.4),
        color: C(0.025, 0.02, 0.018),
        color1: C(0.07, 0.065, 0.06),
        alpha: 0.42,
        lit: 1,
        erode: 0.85,
        gravity: 0.5,
        drag: 1.2,
        fadeIn: 0.15,
        delay: rnd(0.08, 0.25),
      });
    }
    this.fx.sparks(base, Math.round(20 + r * 8), C(3, 1.1, 0.25), 3 + r * 1.5, 0.9);
    this.decal('scorch', at.x, at.z, r * 1.15, 6);
    this.ring(at, r * 1.35, C(1.6, 0.6, 0.18), 0.45);
    this.fx.addShake(0.12 * power + r * 0.04);
  }

  /** Burning ground: small flames licking up from a patch, for `dt` worth of time. */
  groundFire(at: THREE.Vector3, radius: number, dt: number, rate = 25) {
    const n = Math.random() < (dt * rate) % 1 ? Math.ceil(dt * rate) : Math.floor(dt * rate);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius;
      const x = at.x + Math.cos(a) * rr;
      const z = at.z + Math.sin(a) * rr;
      const s = rnd(0.3, 0.6);
      this.puff({ pos: v3(x, this.ground(x, z) + s * 0.4, z), vel: v3(0, rnd(1.2, 2.2), 0), life: rnd(0.35, 0.6), size: s, size1: s * 0.4, color: C(2.2, 0.9, 0.2), color1: C(0.7, 0.07, 0.02), alpha: 0.8, add: 1, hot: 0.7, erode: 0.9, drag: 1, gravity: 1.5 });
    }
  }

  /** A wall of flame along `side` across `front`, rolling along `dir`. */
  flameWall(front: THREE.Vector3, side: THREE.Vector3, dir: THREE.Vector3, half: number, dt: number, fade = 1) {
    const n = Math.max(1, Math.round(dt * 160 * fade));
    for (let i = 0; i < n; i++) {
      const p = front.clone().addScaledVector(side, rnd(-half, half));
      p.y = this.ground(p.x, p.z) + rnd(0.2, 0.6);
      const s = rnd(0.7, 1.2) * (0.5 + fade * 0.5);
      this.puff({ pos: p, vel: dir.clone().multiplyScalar(rnd(3, 6)).add(v3(0, rnd(1.5, 3), 0)), life: rnd(0.35, 0.55), size: s, size1: s * 1.4, color: C(2.2, 0.9, 0.2), color1: C(0.6, 0.06, 0.015), alpha: 0.75, add: 1, hot: 0.7, erode: 0.95, drag: 3, gravity: 2 });
    }
    if (Math.random() < dt * 30 * fade) {
      const p = front.clone().addScaledVector(side, rnd(-half, half));
      p.y = this.ground(p.x, p.z) + 1;
      this.puff({ pos: p, vel: v3(0, rnd(1, 1.6), 0).addScaledVector(dir, 1), life: rnd(1, 1.6), size: 0.8, size1: 2.2, color: C(0.025, 0.02, 0.018), color1: C(0.07, 0.065, 0.06), alpha: 0.5, lit: 1, erode: 0.85, gravity: 0.4, fadeIn: 0.2 });
    }
  }

  /** Frost blast: crystals spearing up, rolling mist, rime and a cloud of glitter. */
  frostBurst(at: THREE.Vector3, r: number, crystals = 22) {
    if (crystals > 0) this.crystals(at, crystals, r * 0.92, 1.15, 1.0);
    this.decal('frost', at.x, at.z, r * 1.1, 5.5);
    this.ring(at, r * 1.15, C(0.3, 0.7, 1.2), 0.55);
    this.ring(at, r * 0.8, C(0.4, 0.5, 0.65), 0.8, false);
    const gy = this.ground(at.x, at.z);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
      const d = v3(Math.cos(a), 0, Math.sin(a));
      this.puff({ pos: at.clone().setY(gy + 0.35).addScaledVector(d, 0.4), vel: d.multiplyScalar(r * rnd(2.2, 3)).setY(rnd(0.1, 0.5)), life: rnd(1.1, 1.6), size: 0.9, size1: rnd(2.0, 2.6), color: C(0.5, 0.62, 0.8), color1: C(0.35, 0.48, 0.72), alpha: 0.13, lit: 1, erode: 0.85, drag: 2.6, fadeIn: 0.08 });
    }
    this.glitter(at.clone().setY(gy + 0.6), r * 0.8, 70, 3.2);
  }

  /** Multi-coloured ice glitter thrown up from `at`. */
  glitter(at: THREE.Vector3, spread: number, count: number, speed = 2.5) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * spread;
      this.puff({
        pos: at.clone().add(v3(Math.cos(a) * rr, rnd(0, 0.8), Math.sin(a) * rr)),
        vel: v3(rnd(-1, 1), rnd(0.4, 1.4), rnd(-1, 1)).multiplyScalar(speed),
        life: rnd(0.7, 1.5),
        size: rnd(0.1, 0.24),
        size1: 0.05,
        color: pick(GLITTER),
        add: 1,
        slot: 3,
        erode: 0,
        twinkle: rnd(0.6, 1.3),
        drag: 2.2,
        gravity: -1.2,
      });
    }
  }

  /** Faceted ice crystals spearing up, holding, then shattering into glitter. */
  crystals(at: THREE.Vector3, count: number, radius: number, height: number, hold = 0.8) {
    const g = new THREE.Group();
    const list: { m: THREE.Mesh; h: number; w: number; delay: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i === 0 && count > 6 ? 0 : radius * (0.25 + Math.sqrt(Math.random()) * 0.75);
      const x = at.x + Math.cos(a) * r;
      const z = at.z + Math.sin(a) * r;
      const m = crystalMesh();
      const h = height * rnd(0.55, 1.25) * (r < 0.1 ? 1.5 : 1);
      const w = h * rnd(0.16, 0.28);
      m.position.set(x, this.ground(x, z) - 0.05, z);
      // Lean outward, as if the blast drove them up from the centre.
      const lean = r < 0.1 ? 0 : rnd(0.25, 0.75);
      m.lookAt(m.position.clone().add(v3(Math.cos(a) * lean, 1, Math.sin(a) * lean)));
      m.rotateX(Math.PI / 2);
      m.rotateY(Math.random() * 6);
      m.scale.set(w, 0.001, w);
      g.add(m);
      list.push({ m, h, w, delay: (r / Math.max(0.01, radius)) * 0.1 });
      // A few small ones around each big one.
      if (Math.random() < 0.35) {
        const s = crystalMesh();
        s.position.copy(m.position).add(v3(rnd(-0.3, 0.3), 0, rnd(-0.3, 0.3)));
        s.quaternion.copy(m.quaternion);
        s.rotateZ(rnd(-0.5, 0.5));
        s.scale.set(w * 0.5, 0.001, w * 0.5);
        g.add(s);
        list.push({ m: s, h: h * 0.45, w: w * 0.5, delay: list[list.length - 1].delay + 0.04 });
      }
    }
    this.fx.group.add(g);
    const grow = 0.16;
    const total = grow + 0.1 + hold;
    let shattered = false;
    this.fx.after(total, g, (k) => {
      const t = k * total;
      for (const c of list) {
        const u = THREE.MathUtils.clamp((t - c.delay) / grow, 0, 1);
        const over = u < 1 ? 1 - Math.pow(1 - u, 3) + Math.sin(u * Math.PI) * 0.12 : 1;
        c.m.scale.set(c.w, Math.max(0.001, c.h * over), c.w);
      }
      if (!shattered && k >= 0.999) {
        shattered = true;
        this.shatter(list.map((c) => c.m));
      }
    });
  }

  /** Ice breaks apart: shards tumble out, glitter and a puff of frost. */
  private shatter(meshes: THREE.Mesh[]) {
    const tmp = new THREE.Vector3();
    meshes.forEach((m, i) => {
      m.getWorldPosition(tmp);
      tmp.y += m.scale.y * 0.5;
      if (i % 2 === 0) this.glitter(tmp.clone(), 0.2, 4, 1.8);
      if (i % 3 === 0)
        this.puff({ pos: tmp.clone(), vel: v3(0, 0.3, 0), life: 0.9, size: 0.5, size1: 1.4, color: C(0.8, 0.92, 1.05), alpha: 0.3, lit: 1, erode: 0.8, fadeIn: 0.1 });
      if (i % 3 === 1) this.shard(tmp.clone(), m.material as THREE.Material);
    });
  }

  /** One small ice fragment flung out and fading as it falls. */
  shard(at: THREE.Vector3, mat?: THREE.Material) {
    const m = crystalMesh();
    if (mat) m.material = mat;
    const s = rnd(0.06, 0.12);
    m.scale.set(s, s * 2.5, s);
    m.position.copy(at);
    const v = v3(rnd(-2, 2), rnd(2, 4), rnd(-2, 2));
    const spin = v3(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12));
    this.fx.group.add(m);
    this.fx.after(rnd(0.6, 0.9), m, (k, dt) => {
      v.y -= 14 * dt;
      m.position.addScaledVector(v, dt);
      const gy = this.ground(m.position.x, m.position.z);
      if (m.position.y < gy) {
        m.position.y = gy;
        v.multiplyScalar(0.3);
        v.y = Math.abs(v.y);
      }
      m.rotation.x += spin.x * dt;
      m.rotation.y += spin.y * dt;
      m.rotation.z += spin.z * dt;
      if (k > 0.6) m.scale.multiplyScalar(0.9);
    });
  }

  /** Snow and mist drifting through a storm over `at`, for `dt` worth of time. */
  snow(at: THREE.Vector3, radius: number, dt: number) {
    const n = Math.max(1, Math.round(dt * 70));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius;
      const x = at.x + Math.cos(a) * rr - 1.2;
      const z = at.z + Math.sin(a) * rr;
      const y = this.ground(x, z) + rnd(3.5, 5.5);
      this.puff({ pos: v3(x, y, z), vel: v3(rnd(1.5, 2.5), -rnd(4.5, 6.5), rnd(-0.4, 0.4)), life: rnd(0.75, 1.0), size: rnd(0.07, 0.14), color: Math.random() < 0.7 ? C(1.6, 1.8, 2.1) : pick(GLITTER), add: 1, slot: 3, erode: 0, twinkle: 0.7, fadeIn: 0.1 });
    }
    if (Math.random() < dt * 6) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius * 0.85;
      const x = at.x + Math.cos(a) * rr;
      const z = at.z + Math.sin(a) * rr;
      // Mist swirling round the eye of the storm.
      const tang = v3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(rnd(1.2, 2.2));
      this.puff({ pos: v3(x, this.ground(x, z) + rnd(0.3, 0.9), z), vel: tang, life: rnd(1.8, 2.6), size: rnd(1.4, 2), size1: rnd(2.4, 3.2), color: C(0.75, 0.86, 1.0), color1: C(0.6, 0.72, 0.95), alpha: 0.32, lit: 1, erode: 0.8, fadeIn: 0.25, drag: 0.4 });
    }
  }

  /** Billowing dust thrown outward along the ground from a heavy impact. */
  dust(at: THREE.Vector3, r: number, count = 20, color = C(0.05, 0.036, 0.026), speed = 1) {
    const gy = this.ground(at.x, at.z);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const d = v3(Math.cos(a), 0, Math.sin(a));
      this.puff({
        pos: at.clone().setY(gy + rnd(0.2, 0.45)).addScaledVector(d, r * 0.2),
        vel: d.multiplyScalar(r * rnd(2.2, 3.4) * speed).setY(rnd(0.2, 0.9)),
        life: rnd(0.9, 1.5),
        size: r * 0.22,
        size1: r * rnd(0.45, 0.65),
        color,
        color1: color.clone().multiplyScalar(1.2),
        alpha: 0.5,
        lit: 1,
        erode: 0.85,
        drag: 3,
        gravity: 0.15,
        fadeIn: 0.05,
      });
    }
  }

  /** Puffs of coloured light bursting out (arcane, holy, crimson). */
  energyBurst(at: THREE.Vector3, r: number, c0: THREE.Color, c1: THREE.Color, count = 16, glitter = 20) {
    for (let i = 0; i < count; i++) {
      const d = v3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).normalize();
      this.puff({ pos: at.clone().addScaledVector(d, r * 0.1), vel: d.multiplyScalar(r * rnd(2.5, 4.5)), life: rnd(0.3, 0.5), size: r * 0.3, size1: r * rnd(0.6, 0.85), color: c0, color1: c1, alpha: 0.5, add: 1, erode: 0.9, drag: 4.5, hot: 0.15 });
    }
    for (let i = 0; i < glitter; i++) {
      const d = v3(rnd(-1, 1), rnd(0, 1), rnd(-1, 1)).normalize();
      this.puff({ pos: at.clone(), vel: d.multiplyScalar(r * rnd(2, 5)), life: rnd(0.5, 1), size: rnd(0.12, 0.25), size1: 0.04, color: c0.clone().multiplyScalar(1.3), add: 1, slot: 3, erode: 0, twinkle: 1, drag: 2.5 });
    }
  }

  /** A slow column of motes and wisps rising from `at` (consecration, auras). */
  rising(at: THREE.Vector3, radius: number, c0: THREE.Color, c1: THREE.Color, dt: number, rate = 14) {
    const n = Math.random() < (dt * rate) % 1 ? Math.ceil(dt * rate) : Math.floor(dt * rate);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius;
      const x = at.x + Math.cos(a) * rr;
      const z = at.z + Math.sin(a) * rr;
      const glint = Math.random() < 0.4;
      this.puff({ pos: v3(x, this.ground(x, z) + 0.2, z), vel: v3(0, rnd(0.8, 1.6), 0), life: rnd(0.9, 1.5), size: glint ? rnd(0.12, 0.22) : rnd(0.5, 0.8), size1: glint ? 0.05 : 0.2, color: c0, color1: c1, add: 1, slot: glint ? 3 : undefined, twinkle: glint ? 1 : 0, erode: glint ? 0 : 0.9, fadeIn: 0.2 });
    }
  }

  /** Streaks of displaced air and grit along a sword arc. */
  sweep(center: THREE.Vector3, yaw: number, radius: number, arc: number, color: THREE.Color) {
    const n = Math.round(arc * 4);
    void color;
    const gy = this.ground(center.x, center.z);
    for (let i = 0; i < Math.round(n / 2); i++) {
      const a = yaw + (Math.random() - 0.5) * arc;
      const d = v3(Math.sin(a), 0, Math.cos(a));
      this.puff({ pos: center.clone().setY(gy + 0.2).addScaledVector(d, radius * rnd(0.5, 0.9)), vel: d.multiplyScalar(rnd(1, 2)).setY(0.4), life: rnd(0.6, 0.9), size: 0.35, size1: 0.8, color: C(0.05, 0.036, 0.026), alpha: 0.4, lit: 1, erode: 0.85, drag: 3 });
    }
  }

  // ---------------------------------------------------------- decals, rings

  /** A mark burnt or frozen into the ground, draped over its bumps, fading over `life`. */
  decal(kind: 'scorch' | 'frost', x: number, z: number, r: number, life: number, ember = 1) {
    const N = 12;
    const geo = new THREE.PlaneGeometry(1, 1, N, N);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const rot = Math.random() * Math.PI * 2;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i < pos.count; i++) {
      const gx = pos.getX(i) * 2 * r;
      const gz = -pos.getY(i) * 2 * r;
      const wx = x + gx * c - gz * s;
      const wz = z + gx * s + gz * c;
      pos.setXYZ(i, wx, this.ground(wx, wz) + 0.04, wz);
    }
    geo.computeBoundingSphere();
    const mat = decalBase(kind).clone();
    mat.uniforms.time = puffClock;
    mat.uniforms.map.value = decalBase(kind).uniforms.map.value;
    mat.uniforms.life.value = life;
    mat.uniforms.ember.value = ember;
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 3;
    m.frustumCulled = false;
    this.fx.group.add(m);
    this.fx.after(life, m, (k) => (mat.uniforms.k.value = k), () => {
      geo.dispose();
      mat.dispose();
    });
  }

  /** A torn, noisy shockwave ring rushing out over the ground. `add` false makes it a pale dust/frost veil. */
  ring(at: THREE.Vector3, radius: number, color: THREE.Color, life = 0.5, add = true) {
    const geo = new THREE.RingGeometry(0.3, 1, 64, 2).rotateX(-Math.PI / 2);
    const mat = ringBase.clone();
    mat.uniforms.color.value.copy(color);
    mat.uniforms.seed.value = Math.random() * 100;
    mat.uniforms.add.value = add ? 1 : 0.35;
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at).setY(this.ground(at.x, at.z) + 0.1);
    m.renderOrder = 17;
    this.fx.group.add(m);
    this.fx.after(life, m, (k) => {
      mat.uniforms.k.value = k;
      const s = 0.3 + radius * (1 - Math.pow(1 - k, 2.4));
      m.scale.set(s, 1, s);
    }, () => {
      geo.dispose();
      mat.dispose();
    });
  }

  // ---------------------------------------------------------- frozen tint

  /** Tint a monster icy blue while chilled (1) or frozen solid (2), with frost glints. */
  frostTint(m: Tintable, level: 0 | 1 | 2, dt: number) {
    const root = m.body.rig.root;
    const was = (root.userData.frost as number | undefined) ?? 0;
    if (level !== was) {
      root.userData.frost = level;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.noFrost) return;
        const ud = mesh.userData as { warm?: THREE.Material | THREE.Material[] };
        if (level === 0) {
          if (ud.warm) mesh.material = ud.warm;
          ud.warm = undefined;
          return;
        }
        ud.warm ??= mesh.material;
        const warm = ud.warm;
        mesh.material = Array.isArray(warm) ? warm.map((w) => frozenOf(w, level)) : frozenOf(warm, level);
      });
    }
    if (level > 0 && Math.random() < dt * (level === 2 ? 14 : 5)) {
      const a = Math.random() * Math.PI * 2;
      const p = m.position.clone().add(v3(Math.cos(a) * m.radius * 0.8, rnd(0.1, 1) * m.height, Math.sin(a) * m.radius * 0.8));
      this.puff({ pos: p, vel: v3(0, level === 2 ? 0.1 : -0.3, 0), life: rnd(0.4, 0.8), size: rnd(0.1, 0.2), color: pick(GLITTER), add: 1, slot: 3, erode: 0, twinkle: 1 });
      if (level === 2 && Math.random() < 0.3)
        this.puff({ pos: p, vel: v3(0, -0.2, 0), life: 1, size: 0.4, size1: 0.9, color: C(0.8, 0.92, 1.05), alpha: 0.22, lit: 1, erode: 0.8, fadeIn: 0.2 });
    }
  }
}

/** Compile everything new up front so the first cast doesn't hitch. */
export function prewarmSpellFx(scene: THREE.Object3D) {
  if (scene.userData.spellWarm) return;
  scene.userData.spellWarm = true;
  const g = new THREE.Group();
  g.position.y = -40;
  const q = new THREE.PlaneGeometry(0.1, 0.1);
  const mats: THREE.Material[] = [...crystalMats, decalBase('scorch'), decalBase('frost'), ringBase, ...(['fire', 'arcane', 'crimson', 'holy', 'frost'] as Palette[]).map(churnMat)];
  for (const m of mats) g.add(new THREE.Mesh(q, m));
  g.add(new THREE.Sprite(glowMat(C(1, 1, 1))));
  scene.add(g);
}
