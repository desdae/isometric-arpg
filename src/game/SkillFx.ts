import * as THREE from 'three';
import type { Effects } from './Effects';
import { GLITTER, glowMat, puffClock, type Palette } from './SpellFx';

// Effects for the deeper skill trees, built on SpellFx's puffs. The fire and
// frost work follows the two concept sheets: fire as tall licking tongues,
// comet bolts and burning rings of cracked ground with embers; frost as
// faceted six-pointed ice stars, spiky shard bursts and ghostly blue mist.
// Also: hallowed hammers, blood rites, arcane lightning and the marks that
// bleeding and burning foes carry. One SkillFx lives on each area's Effects.

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------- star textures

/** A spiky ice starburst: six great rays, six lesser, and a fringe of fine splinters. */
let burstTex: THREE.CanvasTexture | null = null;
function starburstTexture() {
  if (burstTex) return burstTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  const spike = (a: number, len: number, w: number, alpha: number) => {
    g.save();
    g.rotate(a);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.5, `rgba(200,235,255,${alpha * 0.7})`);
    grad.addColorStop(1, 'rgba(120,190,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -w);
    g.lineTo(len * 0.55, -w * 0.45);
    g.lineTo(len, 0);
    g.lineTo(len * 0.55, w * 0.45);
    g.lineTo(0, w);
    g.closePath();
    g.fill();
    g.restore();
  };
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) spike(r() * Math.PI * 2, S * (0.12 + r() * 0.22), 1.5 + r() * 2, 0.35 + r() * 0.3);
  for (let i = 0; i < 12; i++) spike((i / 12) * Math.PI * 2 + Math.PI / 12, S * (0.26 + r() * 0.08), 5, 0.75);
  for (let i = 0; i < 6; i++) spike((i / 6) * Math.PI * 2, S * 0.49, 9, 1);
  const core = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.2);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.35, 'rgba(210,240,255,0.7)');
  core.addColorStop(1, 'rgba(120,180,255,0)');
  g.fillStyle = core;
  g.beginPath();
  g.arc(0, 0, S * 0.2, 0, Math.PI * 2);
  g.fill();
  burstTex = new THREE.CanvasTexture(c);
  return burstTex;
}

const burstMats = new Map<string, THREE.SpriteMaterial>();
function burstMat(c: THREE.Color) {
  const key = c.getHexString() + c.r.toFixed(1);
  let m = burstMats.get(key);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: starburstTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    burstMats.set(key, m);
  }
  return m;
}

// --------------------------------------------------------------- ice stars

/**
 * A six-pointed ice star: each arm a jagged spear with barbs down its sides,
 * raised to a ridge front and back so every facet catches the light.
 */
function iceStarGeometry(arms = 6, depth = 0.2) {
  const outline: [number, number][] = [];
  const step = (Math.PI * 2) / arms;
  const deg = Math.PI / 180;
  for (let k = 0; k < arms; k++) {
    const a = k * step;
    outline.push(
      [0.3, a - step / 2],
      [0.58, a - 16 * deg],
      [0.47, a - 10 * deg],
      [0.62, a - 5 * deg],
      [1, a],
      [0.62, a + 5 * deg],
      [0.47, a + 10 * deg],
      [0.58, a + 16 * deg],
    );
  }
  const pos: number[] = [];
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const [r0, a0] = outline[i];
    const [r1, a1] = outline[(i + 1) % n];
    const p0 = [Math.cos(a0) * r0, Math.sin(a0) * r0, 0];
    const p1 = [Math.cos(a1) * r1, Math.sin(a1) * r1, 0];
    pos.push(0, 0, depth, ...p0, ...p1);
    pos.push(0, 0, -depth, ...p1, ...p0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
const starGeo = iceStarGeometry();
const starMat = new THREE.MeshStandardMaterial({
  color: 0xd8f0ff,
  emissive: new THREE.Color(0.18, 0.42, 0.8),
  roughness: 0.06,
  metalness: 0.25,
  flatShading: true,
  transparent: true,
  opacity: 0.9,
  side: THREE.DoubleSide,
  envMapIntensity: 2.4,
});
const starMatDeep = starMat.clone();
starMatDeep.color.set(0x6fa8ff);
starMatDeep.emissive.setRGB(0.1, 0.25, 0.7);

// -------------------------------------------------------------- ground runes

export type RuneKind = 'fire' | 'blood' | 'holy' | 'frost' | 'arcane';
const RUNE_COLORS: Record<RuneKind, [THREE.Color, THREE.Color, THREE.Color]> = {
  // hot line, glowing cracks, dark ground
  fire: [C(3.4, 1.5, 0.35), C(1.9, 0.5, 0.08), C(0.08, 0.02, 0.0)],
  blood: [C(2.6, 0.18, 0.1), C(0.9, 0.03, 0.02), C(0.07, 0.0, 0.0)],
  holy: [C(3.2, 2.5, 1.0), C(1.6, 1.1, 0.3), C(0.06, 0.04, 0.0)],
  frost: [C(1.4, 2.4, 3.4), C(0.4, 0.9, 1.6), C(0.0, 0.03, 0.07)],
  arcane: [C(2.2, 1.2, 3.6), C(0.8, 0.35, 1.8), C(0.03, 0.0, 0.07)],
};

/**
 * Burning ring on the ground: a bright wavering circle, the ground inside
 * cracked open and glowing, its outer edge torn into flame-licked tatters
 * (the "burning ground ring" on the fire sheet). `star` overlays a hexagram
 * for frost and holy runes.
 */
const runeBase = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  premultipliedAlpha: true,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
  uniforms: { k: { value: 0 }, time: puffClock, hot: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, dark: { value: new THREE.Color() }, star: { value: 0 }, hex: { value: 0 }, seed: { value: 0 }, fill: { value: 1 }, grow: { value: 0.15 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float k, time, star, hex, seed, fill, grow; uniform vec3 hot, mid, dark; varying vec2 vUv;
    float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 q) { vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
    float fbm(vec2 q) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(q); q *= 2.03; a *= 0.5; } return s; }
    // Distance to a segment, for the hexagram's lines.
    float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
    void main() {
      vec2 p = (vUv - 0.5) * 2.0;
      float r = length(p);
      float a = atan(p.y, p.x);
      float t = time;
      float appear = smoothstep(0.0, grow, k);
      float fade = 1.0 - smoothstep(0.7, 1.0, k);
      // The ring itself, wavering like a flame line.
      float wob = (fbm(vec2(a * 3.0 + seed, t * 1.5)) - 0.5) * 0.06;
      float R = 0.78 * (0.6 + 0.4 * appear);
      float line = exp(-pow((r - R - wob) / 0.022, 2.0));
      float line2 = exp(-pow((r - R * 0.64 + wob) / 0.014, 2.0)) * 0.55;
      // Cracked, glowing ground inside: thin ridges of a noise field.
      float n = fbm(p * 4.0 + seed);
      float crack = pow(1.0 - abs(fbm(p * 5.5 + seed * 1.7) - 0.5) * 2.0, 10.0);
      float inside = 1.0 - smoothstep(R - 0.02, R + 0.18 + (n - 0.5) * 0.25, r);
      // Torn, licked outer edge.
      float tatter = smoothstep(0.35, 0.65, fbm(vec2(a * 5.0 + seed, r * 6.0 - t * 0.8)));
      float outer = (1.0 - smoothstep(R, 1.0, r + (tatter - 0.5) * 0.35)) * fill;
      float flick = 0.75 + 0.25 * sin(t * 9.0 + n * 12.0);
      vec3 col = hot * (line + line2) * flick + mid * crack * inside * (0.6 + 0.6 * n) * fill + mid * 0.25 * outer * tatter * flick;
      // Hexagram for frost and holy runes.
      if (star > 0.5) {
        float d = 10.0;
        for (int i = 0; i < 6; i++) {
          float a0 = float(i) * 1.0471976;
          vec2 v0 = vec2(cos(a0), sin(a0)) * R;
          vec2 v2 = vec2(cos(a0 + 2.0943951), sin(a0 + 2.0943951)) * R;
          d = min(d, seg(p, v0, v2));
        }
        float hex = exp(-pow(d / 0.012, 2.0));
        float spokes = exp(-pow(abs(sin(a * 3.0)) * r / 0.01, 2.0)) * smoothstep(R * 0.95, 0.1, r) * 0.5;
        col += hot * (hex + spokes) * flick;
      }
      // Hexagonal floor of light (the arcane sheet's lightning circle).
      if (hex > 0.5) {
        vec2 q = p * 7.0;
        vec2 hs = vec2(1.0, 1.7320508);
        vec2 ha = mod(q, hs) - hs * 0.5;
        vec2 hb = mod(q - hs * 0.5, hs) - hs * 0.5;
        vec2 hg = dot(ha, ha) < dot(hb, hb) ? ha : hb;
        hg = abs(hg);
        float he = max(dot(hg, normalize(hs)), hg.x);
        float cell = exp(-pow((he - 0.5) / 0.035, 2.0)) * inside;
        col += mid * cell * (0.7 + 0.5 * n) * flick + mid * 0.18 * inside;
      }
      float alpha = clamp(outer * 0.55 + line, 0.0, 1.0) * appear * fade;
      gl_FragColor = vec4((col + dark * outer * 0.0) * appear * fade, alpha * 0.85);
    }
  `,
});

// ------------------------------------------------------------- lightning

const zapMats = new Map<string, THREE.MeshBasicMaterial>();
function zapMat(c: THREE.Color) {
  const key = c.getHexString() + c.r.toFixed(1);
  let m = zapMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    zapMats.set(key, m);
  }
  return m;
}

// -------------------------------------------------------------- the hammer

const hammerGold = new THREE.MeshStandardMaterial({ color: 0xe8c878, metalness: 0.9, roughness: 0.25, emissive: new THREE.Color(1.1, 0.75, 0.25) });
const hammerHaft = new THREE.MeshStandardMaterial({ color: 0xfff0c8, metalness: 0.3, roughness: 0.4, emissive: new THREE.Color(1.6, 1.3, 0.7) });

// ------------------------------------------------- props from the skill sheets

const slabMat = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.92, flatShading: true });
const slabHot = new THREE.MeshStandardMaterial({ color: 0x5a3020, roughness: 0.8, flatShading: true, emissive: new THREE.Color(1.6, 0.45, 0.08) });
const slabGeo = new THREE.BoxGeometry(1, 1, 1);
// Broken rock for the ground split: a flattened, jittered dodecahedron so
// the heaved-up slabs read as chunks of earth, not boxes.
const rockGeo = (() => {
  const g = new THREE.DodecahedronGeometry(0.6, 0);
  const pos = g.attributes.position;
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    const j = seen.get(key) ?? 0.8 + ((i * 7919) % 41) / 100;
    seen.set(key, j);
    pos.setXYZ(i, pos.getX(i) * j, pos.getY(i) * j, pos.getZ(i) * j);
  }
  g.computeVertexNormals();
  return g;
})();
const rockHot = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.85, flatShading: true, emissive: new THREE.Color(0.7, 0.18, 0.03) });
const steelMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 0.95, roughness: 0.18, emissive: new THREE.Color(0.12, 0.13, 0.16) });
const hiltMat = new THREE.MeshStandardMaterial({ color: 0xd8a840, metalness: 0.9, roughness: 0.3, emissive: new THREE.Color(0.35, 0.22, 0.04) });
const gripMat = new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.7 });
const tasselMat = new THREE.MeshStandardMaterial({ color: 0x9a1010, roughness: 0.6, emissive: new THREE.Color(0.25, 0.0, 0.0) });
const shieldMat = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.7, roughness: 0.35, emissive: new THREE.Color(0.5, 0.32, 0.06), side: THREE.DoubleSide });
const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.85, flatShading: true });
const windowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.2, 0.3) });
const bloodMat = new THREE.MeshStandardMaterial({ color: 0x8a0606, roughness: 0.25, metalness: 0.1, emissive: new THREE.Color(0.9, 0.02, 0.02) });
const iceFloorMat = new THREE.MeshStandardMaterial({ color: 0xbfe0f4, roughness: 0.25, metalness: 0.05, emissive: new THREE.Color(0.08, 0.16, 0.26), flatShading: true, transparent: true, opacity: 0.92 });
const voidMat = new THREE.MeshBasicMaterial({ color: 0x07020c, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 });
const amethystMat = new THREE.MeshStandardMaterial({ color: 0xd070ff, emissive: new THREE.Color(1.4, 0.3, 1.8), roughness: 0.15, flatShading: true });
const waxMat = new THREE.MeshStandardMaterial({ color: 0xe8c8a8, roughness: 0.6, emissive: new THREE.Color(0.2, 0.1, 0.05) });
const twistMat = new THREE.MeshStandardMaterial({ color: 0xd8a0d0, roughness: 0.3, emissive: new THREE.Color(0.6, 0.25, 0.55), flatShading: true });
const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.4, 0.3) });

/** A steel blade along +Y: a flat diamond section tapering to a point. */
const bladeGeo = (() => {
  const shape = [
    [0, 0], [0.09, 0.05], [0.08, 1.0], [0, 1.25], [-0.08, 1.0], [-0.09, 0.05],
  ];
  const pos: number[] = [];
  const d = 0.025;
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i];
    const b = shape[(i + 1) % shape.length];
    pos.push(0, 0.6, d, a[0], a[1], 0, b[0], b[1], 0);
    pos.push(0, 0.6, -d, b[0], b[1], 0, a[0], a[1], 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
})();

/** A twisted four-sided column (the ritual circle's pillar). */
const twistGeo = (() => {
  const g = new THREE.BoxGeometry(0.22, 1.4, 0.22, 1, 14, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const a = (y + 0.7) * 2.6;
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y + 0.7, x * Math.sin(a) + z * Math.cos(a));
  }
  g.computeVertexNormals();
  return g;
})();

// ---------------------------------------------------------------- streaks

const streakBase = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { k: { value: 0 }, color: { value: new THREE.Color() } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform float k; uniform vec3 color; varying vec2 vUv;
    void main() {
      // Bright at the head (u = 1), thinning toward the tail, with torn streaks.
      float u = vUv.x, v = abs(vUv.y - 0.5) * 2.0;
      float body = smoothstep(1.0, 0.0, v / max(0.05, u)) * u;
      float streak = 0.6 + 0.4 * sin(vUv.y * 40.0 + u * 7.0) * sin(vUv.y * 17.0 - u * 3.0);
      float a = body * streak * (1.0 - k) * smoothstep(0.0, 0.15, u);
      gl_FragColor = vec4(color * a + vec3(1.0) * pow(body, 6.0) * (1.0 - k) * 0.6, a);
    }
  `,
});

export class SkillFx {
  constructor(private fx: Effects) {}

  private get sp() {
    return this.fx.spell;
  }

  ground(x: number, z: number) {
    return this.fx.height(x, z);
  }

  // ------------------------------------------------------------------ frost

  /** A six-pointed ice star with a smaller one turned inside it, a glow and a starburst flare. */
  iceStar(size: number, flare = true): THREE.Group {
    const g = new THREE.Group();
    const a = new THREE.Mesh(starGeo, starMat);
    a.scale.setScalar(size);
    const b = new THREE.Mesh(starGeo, starMatDeep);
    b.scale.setScalar(size * 0.58);
    b.rotation.z = Math.PI / 6;
    b.position.z = size * 0.04;
    const glow = new THREE.Sprite(glowMat(C(0.35, 0.75, 1.4)));
    glow.scale.setScalar(size * 4.2);
    g.add(glow, a, b);
    if (flare) {
      const f = new THREE.Sprite(burstMat(C(0.6, 1.1, 1.8)));
      f.scale.setScalar(size * 3.2);
      g.add(f);
      g.userData.flare = f;
    }
    g.userData.star = a;
    g.userData.inner = b;
    return g;
  }

  /**
   * The shard burst from the frost sheet: a spiky starburst flare, a flat star
   * of frost racing over the ground, crystal spears thrown out along six
   * lines, ghost-blue mist rolling out and a cloud of glitter.
   */
  starBurst(at: THREE.Vector3, r: number) {
    const gy = this.ground(at.x, at.z);
    const centre = at.clone().setY(Math.max(at.y, gy + 0.6));
    this.fx.flash(centre.clone().setY(centre.y + 0.4), 0x8ad8ff, 26, r * 4, 0.45);
    // Starburst flare, spinning a little as it blows out.
    const flare = new THREE.Sprite(burstMat(C(1.2, 2.0, 3.0)).clone());
    flare.position.copy(centre);
    flare.renderOrder = 20;
    const rot = Math.random() * Math.PI;
    this.fx.group.add(flare);
    this.fx.after(0.5, flare, (k) => {
      const e = 1 - Math.pow(1 - k, 3);
      flare.scale.setScalar(0.5 + r * 2.6 * e);
      flare.material.rotation = rot + k * 0.6;
      flare.material.opacity = (1 - k) * (1 - k);
    }, () => flare.material.dispose());
    // A flat star of frost spreading over the ground.
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: starburstTexture(), color: C(0.7, 1.3, 2.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const flat = new THREE.Mesh(geo, mat);
    flat.position.set(at.x, gy + 0.08, at.z);
    flat.rotation.y = Math.random() * Math.PI;
    flat.renderOrder = 4;
    this.fx.group.add(flat);
    this.fx.after(0.9, flat, (k) => {
      flat.scale.setScalar(0.3 + r * 2.4 * (1 - Math.pow(1 - k, 4)));
      mat.opacity = 1 - k;
    }, () => {
      geo.dispose();
      mat.dispose();
    });
    this.radialSpikes(at, 6, r * 0.9, 0.55);
    this.sp.decal('frost', at.x, at.z, r * 1.2, 5);
    this.sp.ring(at, r * 1.3, C(0.35, 0.8, 1.4), 0.5);
    this.ghostBurst(at, r);
    this.sp.glitter(centre, r * 0.5, 60, 4);
    // Splinters thrown out flat along the star's arms.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const d = v3(Math.cos(a), rnd(0.05, 0.4), Math.sin(a));
      this.sp.puff({ pos: centre.clone(), vel: d.multiplyScalar(r * rnd(4, 7)), life: rnd(0.3, 0.5), size: rnd(0.12, 0.22), size1: 0.04, color: pick(GLITTER), add: 1, slot: 3, erode: 0, twinkle: 1, drag: 3 });
    }
    for (let i = 0; i < 5; i++) this.sp.shard(centre.clone());
  }

  /** Crystal spears driven out along `count` lines from `at`, low over the ground, then shattering. */
  radialSpikes(at: THREE.Vector3, count: number, len: number, hold = 0.6) {
    const g = new THREE.Group();
    const list: { m: THREE.Mesh; s: number; w: number; delay: number }[] = [];
    const base = Math.random() * Math.PI * 2;
    const add = (a: number, l: number, w: number, delay: number) => {
      const m = new THREE.Mesh(spearGeo, Math.random() < 0.7 ? starMat : starMatDeep);
      const x = at.x + Math.cos(a) * 0.2;
      const z = at.z + Math.sin(a) * 0.2;
      m.position.set(x, this.ground(x, z) + 0.15, z);
      m.lookAt(m.position.clone().add(v3(Math.cos(a), rnd(0.25, 0.55), Math.sin(a))));
      m.scale.set(w, w, 0.001);
      g.add(m);
      list.push({ m, s: l, w, delay });
    };
    for (let i = 0; i < count; i++) {
      const a = base + (i / count) * Math.PI * 2;
      add(a, len * rnd(0.9, 1.15), len * 0.16, 0);
      add(a + Math.PI / count, len * rnd(0.45, 0.6), len * 0.1, 0.04);
      if (Math.random() < 0.6) add(a + rnd(-0.25, 0.25), len * rnd(0.3, 0.45), len * 0.07, 0.06);
    }
    this.fx.group.add(g);
    const grow = 0.12;
    const total = grow + hold;
    let broke = false;
    this.fx.after(total, g, (k) => {
      const t = k * total;
      for (const c of list) {
        const u = THREE.MathUtils.clamp((t - c.delay) / grow, 0, 1);
        const e = 1 - Math.pow(1 - u, 3);
        c.m.scale.set(c.w, c.w, Math.max(0.001, c.s * e));
      }
      if (!broke && k >= 0.999) {
        broke = true;
        const tmp = new THREE.Vector3();
        list.forEach((c, i) => {
          tmp.set(0, 0, 0.5).applyMatrix4(c.m.matrixWorld);
          if (i % 2 === 0) this.sp.glitter(tmp.clone(), 0.2, 5, 1.6);
          if (i % 3 === 0) this.sp.shard(tmp.clone());
        });
      }
    });
  }

  /** Ghostly blue mist billowing out from a frost blast, curling as it goes. */
  ghostBurst(at: THREE.Vector3, r: number) {
    const gy = this.ground(at.x, at.z);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rnd(-0.2, 0.2);
      const d = v3(Math.cos(a), 0, Math.sin(a));
      const curl = v3(-d.z, 0, d.x).multiplyScalar(rnd(-1, 1) * r);
      this.sp.puff({ pos: at.clone().setY(gy + rnd(0.3, 0.8)).addScaledVector(d, 0.3), vel: d.multiplyScalar(r * rnd(2.5, 3.6)).add(curl).setY(rnd(0.2, 0.8)), life: rnd(1.0, 1.6), size: 0.7, size1: rnd(1.8, 2.6), color: C(0.3, 0.6, 1.1), color1: C(0.08, 0.2, 0.5), alpha: 0.32, add: 1, erode: 0.9, drag: 2.4, fadeIn: 0.06 });
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = v3(Math.cos(a), 0, Math.sin(a));
      this.sp.puff({ pos: at.clone().setY(gy + 0.4), vel: d.multiplyScalar(r * rnd(1.5, 2.5)).setY(0.3), life: rnd(1.4, 2), size: 1, size1: 2.4, color: C(0.4, 0.55, 0.75), color1: C(0.25, 0.35, 0.55), alpha: 0.18, lit: 1, erode: 0.85, drag: 2, fadeIn: 0.1 });
    }
  }

  /** Ghostly blue mist curling and rising around `at`, for `dt` worth of time. */
  ghostMist(at: THREE.Vector3, radius: number, dt: number, rate = 10, height = 0.4) {
    const n = Math.random() < (dt * rate) % 1 ? Math.ceil(dt * rate) : Math.floor(dt * rate);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = radius * rnd(0.4, 1);
      const x = at.x + Math.cos(a) * rr;
      const z = at.z + Math.sin(a) * rr;
      const tang = v3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(rnd(0.6, 1.4));
      this.sp.puff({ pos: v3(x, this.ground(x, z) + height * rnd(0.5, 1.5), z), vel: tang.setY(rnd(0.3, 0.8)), life: rnd(1.0, 1.6), size: rnd(0.4, 0.7), size1: rnd(1.0, 1.5), color: C(0.25, 0.55, 1.0), color1: C(0.06, 0.15, 0.45), alpha: 0.3, add: 1, erode: 0.92, drag: 0.6, fadeIn: 0.2 });
    }
  }

  // ------------------------------------------------------------------- fire

  /**
   * A tongue of flame licking up from `p` for `dt` worth of time: a tall,
   * wavering column of fire that narrows to a flicker, white-hot at its root.
   */
  flame(p: THREE.Vector3, height: number, size: number, dt: number, rate = 40, seed = 0, heat = 1) {
    const n = Math.random() < (dt * rate) % 1 ? Math.ceil(dt * rate) : Math.floor(dt * rate);
    const t = puffClock.value;
    for (let i = 0; i < n; i++) {
      const sway = Math.sin(t * 5 + seed * 7.3) * 0.7 + Math.sin(t * 11 + seed * 3.1) * 0.3;
      const life = rnd(0.42, 0.62);
      const up = height / life;
      this.sp.puff({
        pos: p.clone().add(v3(rnd(-0.12, 0.12) * size, rnd(0, 0.15), rnd(-0.12, 0.12) * size)),
        vel: v3(sway * 0.9 * size, up * 0.45, Math.cos(t * 4 + seed * 5) * 0.5 * size),
        life,
        size: size * rnd(0.9, 1.2),
        size1: size * 0.3,
        color: C(2.4 * heat, 1.0 * heat, 0.22 * heat),
        color1: C(0.9, 0.12, 0.02),
        alpha: 0.85 * (0.5 + 0.5 * heat),
        add: 1,
        hot: 0.9 * heat,
        erode: 0.92,
        gravity: up * 1.1,
        drag: 0.6,
        spin: rnd(-1, 1),
      });
    }
    if (Math.random() < dt * rate * 0.08)
      this.fx.mote(p.clone().setY(p.y + height * rnd(0.3, 0.9)), v3(rnd(-0.6, 0.6), rnd(1.4, 2.6), rnd(-0.6, 0.6)), rnd(0.8, 1.4), rnd(0.04, 0.07), C(3, 1.2, 0.3), true);
    if (Math.random() < dt * rate * 0.03)
      this.sp.puff({ pos: p.clone().setY(p.y + height * 0.9), vel: v3(rnd(-0.2, 0.2), rnd(0.8, 1.3), rnd(-0.2, 0.2)), life: rnd(1.2, 1.8), size: size * 1.2, size1: size * 3, color: C(0.03, 0.022, 0.02), color1: C(0.07, 0.065, 0.06), alpha: 0.4, lit: 1, erode: 0.85, gravity: 0.4, fadeIn: 0.2 });
  }

  /**
   * A burning ring on the ground (the fire sheet's ground rings): the rune
   * decal plus flame tongues licking up along its circle, low fire inside and
   * embers drifting up. Returns a tick to call each frame with how much of the
   * fire is left (0-1).
   */
  burningRing(at: THREE.Vector3, radius: number, life: number, tongues = true): (dt: number, left: number) => void {
    this.rune(at, radius * 1.15, life + 0.4, 'fire');
    const N = Math.max(5, Math.round(radius * 3.2));
    const pts = Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2 + rnd(-0.15, 0.15);
      const x = at.x + Math.cos(a) * radius * 0.9;
      const z = at.z + Math.sin(a) * radius * 0.9;
      return { p: v3(x, this.ground(x, z) + 0.05, z), h: rnd(0.7, 1.5), seed: Math.random() * 10 };
    });
    return (dt, left) => {
      const f = Math.min(1, left * 3);
      if (tongues) for (const q of pts) this.flame(q.p, q.h * (0.5 + 0.5 * f), 0.42 * (0.6 + 0.4 * f), dt, 14 * f, q.seed);
      this.sp.groundFire(at, radius * 0.75, dt, 14 * f);
      if (Math.random() < dt * 10 * f) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * radius;
        this.fx.mote(at.clone().add(v3(Math.cos(a) * rr, 0.15, Math.sin(a) * rr)), v3(rnd(-0.3, 0.3), rnd(1, 2), rnd(-0.3, 0.3)), rnd(0.8, 1.5), 0.05, C(3, 1.1, 0.25), true);
      }
    };
  }

  /** A comet's tail: long streaming flame and sparks behind a fire bolt. */
  cometTail(p: THREE.Vector3, dir: THREE.Vector3, size: number, dt: number) {
    const n = Math.max(1, Math.round(dt * 90));
    for (let i = 0; i < n; i++) {
      this.sp.puff({ pos: p.clone().add(v3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(size * 0.3)), vel: dir.clone().multiplyScalar(-rnd(4, 7)).add(v3(rnd(-0.4, 0.4), rnd(0.4, 1.4), rnd(-0.4, 0.4))), life: rnd(0.3, 0.5), size: size * rnd(2.2, 3.2), size1: size * 0.3, color: C(2.6, 1.2, 0.3), color1: C(0.8, 0.08, 0.02), alpha: 0.75, add: 1, hot: 0.8, erode: 0.9, drag: 2.5, gravity: 1.5 });
    }
    if (Math.random() < dt * 30) this.fx.mote(p.clone(), dir.clone().multiplyScalar(-2).add(v3(rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1))), rnd(0.5, 0.9), 0.05, C(3, 1.3, 0.3), true);
    // The billowing cloud of smoke the fire sheet's comet drags behind it.
    if (Math.random() < dt * 22) this.sp.puff({ pos: p.clone().addScaledVector(dir, -0.4), vel: dir.clone().multiplyScalar(-1.2).add(v3(rnd(-0.3, 0.3), rnd(0.3, 0.8), rnd(-0.3, 0.3))), life: rnd(1.0, 1.5), size: size * 3, size1: size * 8, color: C(0.32, 0.26, 0.2), color1: C(0.12, 0.1, 0.09), alpha: 0.35, lit: 1, erode: 0.85, drag: 1.5, fadeIn: 0.15 });
  }

  /** Little flames licking a burning foe. */
  burnOn(at: THREE.Vector3, height: number, radius: number, dt: number) {
    if (Math.random() < dt * 14) {
      const a = Math.random() * Math.PI * 2;
      const p = at.clone().add(v3(Math.cos(a) * radius * 0.6, rnd(0.1, 0.85) * height, Math.sin(a) * radius * 0.6));
      const s = rnd(0.22, 0.38);
      this.sp.puff({ pos: p, vel: v3(0, rnd(1.2, 2), 0), life: rnd(0.3, 0.5), size: s, size1: s * 0.25, color: C(2.4, 1.0, 0.22), color1: C(0.8, 0.1, 0.02), alpha: 0.8, add: 1, hot: 0.8, erode: 0.9, gravity: 2 });
    }
    if (Math.random() < dt * 3) this.sp.puff({ pos: at.clone().setY(at.y + height), vel: v3(0, 1, 0), life: 1.2, size: 0.3, size1: 0.9, color: C(0.03, 0.025, 0.02), color1: C(0.06, 0.055, 0.05), alpha: 0.35, lit: 1, erode: 0.85, gravity: 0.3, fadeIn: 0.2 });
    if (Math.random() < dt * 4) this.fx.mote(at.clone().setY(at.y + height * rnd(0.3, 1)), v3(rnd(-0.4, 0.4), rnd(1, 2), rnd(-0.4, 0.4)), 0.8, 0.045, C(3, 1.2, 0.3), true);
  }

  /** Blood welling from a bleeding foe's wounds and dripping to the ground. */
  bleedOn(at: THREE.Vector3, height: number, radius: number, dt: number) {
    if (Math.random() < dt * 9) {
      const a = Math.random() * Math.PI * 2;
      const p = at.clone().add(v3(Math.cos(a) * radius * 0.7, rnd(0.35, 0.8) * height, Math.sin(a) * radius * 0.7));
      this.fx.mote(p, v3(Math.cos(a) * 0.6, rnd(0.2, 0.8), Math.sin(a) * 0.6), rnd(0.6, 1), rnd(0.05, 0.08), C(0.3, 0.01, 0.01), false);
    }
    if (Math.random() < dt * 2.5) {
      const p = at.clone().setY(at.y + height * rnd(0.4, 0.7));
      this.sp.puff({ pos: p, vel: v3(rnd(-0.3, 0.3), 0.2, rnd(-0.3, 0.3)), life: 0.7, size: 0.25, size1: 0.6, color: C(0.5, 0.02, 0.02), color1: C(0.15, 0.0, 0.0), alpha: 0.4, add: 1, erode: 0.9, drag: 2 });
    }
  }

  /** Blood ripped out of a foe and flung through the air toward `to` (a hero feeding). */
  bloodStream(from: THREE.Vector3, to: THREE.Vector3, count = 10) {
    for (let i = 0; i < count; i++) {
      const delay = i * 0.03;
      const p = from.clone().add(v3(rnd(-0.2, 0.2), rnd(-0.2, 0.2), rnd(-0.2, 0.2)));
      const dur = 0.45 + rnd(0, 0.15);
      const vel = to.clone().sub(p).multiplyScalar(1 / dur).add(v3(0, 4.9 * dur * 0.5 + rnd(0.5, 1.5), 0));
      this.sp.puff({ pos: p, vel, gravity: -6, life: dur, size: rnd(0.16, 0.26), size1: 0.08, color: C(2.2, 0.12, 0.06), color1: C(0.8, 0.0, 0.0), alpha: 0.85, add: 1, erode: 0.4, delay, hot: 0.2 });
    }
  }

  // ------------------------------------------------------------------ runes

  /** A ring rune draped over the ground: fire, blood, holy, frost (with a hexagram) or arcane. */
  rune(at: THREE.Vector3, r: number, life: number, kind: RuneKind, opts: { star?: boolean; hex?: boolean; fill?: number; grow?: number; follow?: () => THREE.Vector3 } = {}) {
    const N = 16;
    const geo = new THREE.PlaneGeometry(1, 1, N, N);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const rot = Math.random() * Math.PI * 2;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i < pos.count; i++) {
      const gx = pos.getX(i) * 2 * r;
      const gz = -pos.getY(i) * 2 * r;
      // Following a moving centre: a flat disc carried along; otherwise draped over the ground.
      if (opts.follow) pos.setXYZ(i, gx * c - gz * s, 0.06, gx * s + gz * c);
      else {
        const wx = at.x + gx * c - gz * s;
        const wz = at.z + gx * s + gz * c;
        pos.setXYZ(i, wx, this.ground(wx, wz) + 0.06, wz);
      }
    }
    geo.computeBoundingSphere();
    const mat = runeBase.clone();
    mat.uniforms.time = puffClock;
    const [h, m, d] = RUNE_COLORS[kind];
    mat.uniforms.hot.value.copy(h);
    mat.uniforms.mid.value.copy(m);
    mat.uniforms.dark.value.copy(d);
    mat.uniforms.star.value = (opts.star ?? (kind === 'frost' || kind === 'holy')) ? 1 : 0;
    mat.uniforms.seed.value = Math.random() * 50;
    mat.uniforms.hex.value = opts.hex ? 1 : 0;
    mat.uniforms.fill.value = opts.fill ?? 1;
    mat.uniforms.grow.value = Math.min(0.5, (opts.grow ?? 0.25) / life);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    this.fx.group.add(mesh);
    const follow = opts.follow;
    this.fx.after(life, mesh, (k) => {
      mat.uniforms.k.value = k;
      if (follow) {
        const p = follow();
        mesh.position.set(p.x, this.ground(p.x, p.z), p.z);
      }
    }, () => {
      geo.dispose();
      mat.dispose();
    });
    return mesh;
  }

  // ---------------------------------------------------------------- arcane

  /** A forked bolt of arcane lightning from `from` to `to`, gone in a blink. */
  zap(from: THREE.Vector3, to: THREE.Vector3, color = C(1.6, 0.9, 3.2), life = 0.16, width = 0.035) {
    const pts: THREE.Vector3[] = [from.clone()];
    const d = to.clone().sub(from);
    const len = d.length();
    const segs = Math.max(4, Math.round(len * 2.5));
    const side = v3(-d.z, 0, d.x).normalize();
    for (let i = 1; i < segs; i++) {
      const k = i / segs;
      const off = Math.sin(k * Math.PI) * len * 0.12;
      pts.push(from.clone().addScaledVector(d, k).addScaledVector(side, rnd(-off, off)).add(v3(0, rnd(-off, off) * 0.6, 0)));
    }
    pts.push(to.clone());
    const g = new THREE.Group();
    const build = (list: THREE.Vector3[], w: number, mat: THREE.Material) => {
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 0; i < list.length - 1; i++) path.add(new THREE.LineCurve3(list[i], list[i + 1]));
      const geo = new THREE.TubeGeometry(path, list.length * 2, w, 4, false);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 21;
      g.add(m);
      return geo;
    };
    const geos = [build(pts, width, zapMat(C(3, 2.8, 4))), build(pts, width * 3, zapMat(color.clone().multiplyScalar(0.35)))];
    // A fork splitting off partway.
    const at = Math.floor(segs * rnd(0.3, 0.6));
    const fork = [pts[at].clone()];
    for (let i = 1; i < 4; i++) fork.push(fork[i - 1].clone().add(v3(rnd(-0.5, 0.5), rnd(-0.4, 0.2), rnd(-0.5, 0.5)).addScaledVector(d, 0.12 / Math.max(1, len) * len * 0.3)));
    geos.push(build(fork, width * 0.7, zapMat(C(2.4, 1.8, 3.6))));
    this.fx.group.add(g);
    this.fx.after(life, g, (k) => (g.visible = k < 0.4 || Math.random() < 0.7), () => geos.forEach((x) => x.dispose()));
    this.sp.puff({ pos: to.clone(), vel: v3(0, 0.3, 0), life: 0.25, size: 0.3, size1: 0.8, color: color.clone().multiplyScalar(0.6), add: 1, erode: 0.8 });
    this.sp.puff({ pos: to.clone(), life: 0.3, size: 0.35, size1: 0.1, color: C(3, 2.6, 4), add: 1, slot: 3, erode: 0 });
  }

  /** Arcane wisps and glints swirling around an orb. */
  orbAura(p: THREE.Vector3, size: number, dt: number) {
    const n = Math.max(1, Math.round(dt * 50));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const d = v3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
      const tang = v3(-d.z, 0, d.x).multiplyScalar(size * 6);
      this.sp.puff({ pos: p.clone().addScaledVector(d, size * 1.6), vel: tang.addScaledVector(d, -size * 2), life: rnd(0.25, 0.4), size: size * rnd(0.6, 1), size1: size * 0.2, color: C(1.4, 0.6, 3.0), color1: C(0.3, 0.05, 0.8), alpha: 0.7, add: 1, erode: 0.9, drag: 1 });
    }
    if (Math.random() < dt * 30) this.sp.puff({ pos: p.clone().add(v3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(size * 1.4)), vel: v3(rnd(-0.5, 0.5), rnd(-0.2, 0.6), rnd(-0.5, 0.5)), life: rnd(0.4, 0.7), size: rnd(0.1, 0.2), size1: 0.03, color: C(2.6, 2.0, 3.6), add: 1, slot: 3, erode: 0, twinkle: 1, drag: 1.5 });
  }

  // ------------------------------------------------------------------ holy

  /**
   * The hammer of Judgement as the Bulwark sheet draws it: a great golden
   * dome banded and riveted, a cross standing on its crown, and a red tassel
   * hanging from the neck below. It falls dome-down.
   */
  hammer(scale = 1): THREE.Group {
    const g = new THREE.Group();
    const prof = [
      [0.0, -0.62], [0.32, -0.58], [0.5, -0.45], [0.6, -0.25], [0.62, -0.05], [0.66, 0.0], [0.66, 0.08], [0.6, 0.1], [0.56, 0.22], [0.46, 0.4], [0.3, 0.52], [0.18, 0.56], [0.0, 0.58],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const dome = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), hammerGold);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.045, 6, 24).rotateX(Math.PI / 2), hammerGold);
    band.position.y = 0.03;
    const band2 = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 6, 24).rotateX(Math.PI / 2), hammerGold);
    band2.position.y = -0.42;
    g.add(dome, band, band2);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rv = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), hammerHaft);
      rv.position.set(Math.cos(a) * 0.67, 0.04, Math.sin(a) * 0.67);
      g.add(rv);
    }
    // Neck, crown and cross on top.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 10), hammerGold);
    neck.position.y = 0.7;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.08, 10), hammerHaft);
    crown.position.y = 0.88;
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), hammerHaft);
    crossV.position.y = 1.15;
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.08), hammerHaft);
    crossH.position.y = 1.24;
    g.add(neck, crown, crossV, crossH);
    // The red tassel, hanging from the dome's foot.
    const knot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 8), hammerGold);
    knot.position.y = -0.7;
    const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.55, 8, 1, true).rotateX(Math.PI), tasselMat);
    tassel.position.y = -1.02;
    g.add(knot, tassel);
    g.userData.tassel = tassel;
    const glow = new THREE.Sprite(glowMat(C(2.2, 1.6, 0.6)));
    glow.scale.setScalar(3.6);
    g.add(glow);
    g.scale.setScalar(scale);
    return g;
  }

  /** A shaft of light striking down on `at` (Smiting Light, the hammer's fall). */
  lightShaft(at: THREE.Vector3, height = 9, width = 0.5, life = 0.45) {
    const geo = new THREE.CylinderGeometry(width, width * 1.3, height, 16, 1, true);
    geo.translate(0, height / 2, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { k: { value: 0 }, time: puffClock },
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN, vV; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform float k, time; varying vec2 vUv; varying vec3 vN, vV;
        void main() {
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float rays = 0.6 + 0.4 * sin(vUv.x * 40.0 + time * 3.0) * sin(vUv.x * 13.0 - time * 2.0);
          float a = pow(facing, 1.5) * rays * (1.0 - smoothstep(0.6, 1.0, vUv.y)) * (1.0 - k) * smoothstep(0.0, 0.08, k + 0.02);
          gl_FragColor = vec4(vec3(1.7, 1.25, 0.5) * a, a);
        }
      `,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at).setY(this.ground(at.x, at.z));
    m.renderOrder = 20;
    this.fx.group.add(m);
    this.fx.after(life, m, (k) => {
      mat.uniforms.k.value = k;
      m.scale.set(1 - k * 0.6, 1, 1 - k * 0.6);
    }, () => {
      geo.dispose();
      mat.dispose();
    });
  }

  // ------------------------------------------------- effects from the skill sheets

  /**
   * The Blade sheet's ground-splitting slash: a fissure torn along the line,
   * stone slabs heaved up and tilted on either side, fire bursting out of the
   * crack and grit flying. The slabs settle and sink after `life` seconds.
   */
  groundSplit(from: THREE.Vector3, to: THREE.Vector3, life = 1.6) {
    const d = to.clone().sub(from).setY(0);
    const len = d.length();
    if (len < 0.3) return;
    d.normalize();
    const side = v3(d.z, 0, -d.x);
    const g = new THREE.Group();
    const slabs: { m: THREE.Mesh; base: THREE.Vector3; tilt: THREE.Euler; delay: number; h: number }[] = [];
    const n = Math.round(len / 0.55);
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n;
      for (const sgn of [-1, 1]) {
        if (Math.random() < 0.2) continue;
        const c = from.clone().addScaledVector(d, len * k + rnd(-0.15, 0.15)).addScaledVector(side, sgn * rnd(0.3, 0.6));
        const m = new THREE.Mesh(rockGeo, Math.random() < 0.3 ? rockHot : slabMat);
        const w = rnd(0.35, 0.6);
        m.scale.set(w, rnd(0.14, 0.24), rnd(0.35, 0.55));
        const base = v3(c.x, this.ground(c.x, c.z), c.z);
        m.position.copy(base).setY(base.y - 0.3);
        const yaw = Math.atan2(d.x, d.z) + rnd(-0.3, 0.3);
        const tilt = new THREE.Euler(rnd(-0.25, 0.25), yaw, sgn * rnd(0.35, 0.7));
        m.rotation.copy(tilt);
        g.add(m);
        slabs.push({ m, base, tilt, delay: k * 0.18, h: rnd(0.12, 0.3) });
      }
    }
    this.fx.group.add(g);
    this.sp.decal('scorch', from.x + d.x * len * 0.5, from.z + d.z * len * 0.5, Math.max(0.8, len * 0.45), life + 2, 1.4);
    // Fire bursting out along the crack, staggered from the near end.
    for (let i = 0; i <= n; i++) {
      const k = i / Math.max(1, n);
      const q = from.clone().addScaledVector(d, len * k);
      q.y = this.ground(q.x, q.z) + 0.1;
      for (let j = 0; j < 4; j++)
        this.sp.puff({ pos: q.clone().add(v3(rnd(-0.15, 0.15), 0, rnd(-0.15, 0.15))), vel: v3(rnd(-0.6, 0.6), rnd(2.5, 4.5), rnd(-0.6, 0.6)).addScaledVector(d, rnd(0.5, 2)), life: rnd(0.35, 0.6), size: rnd(0.35, 0.6), size1: 0.12, color: C(2.6, 1.1, 0.25), color1: C(0.9, 0.1, 0.02), alpha: 0.85, add: 1, hot: 0.9, erode: 0.9, gravity: 3, delay: k * 0.18 });
      if (Math.random() < 0.6) this.fx.mote(q.clone().setY(q.y + 0.2), v3(rnd(-1.5, 1.5), rnd(2, 4), rnd(-1.5, 1.5)), rnd(0.6, 1.1), 0.06, C(3, 1.2, 0.3), true);
    }
    this.sp.dust(from.clone().addScaledVector(d, len * 0.5), Math.max(1, len * 0.4), 16, undefined, 0.8);
    this.fx.after(life, g, (k) => {
      const t = k * life;
      for (const c of slabs) {
        const u = THREE.MathUtils.clamp((t - c.delay) / 0.12, 0, 1);
        const sink = THREE.MathUtils.clamp((t - life + 0.5) / 0.5, 0, 1);
        const e = 1 - Math.pow(1 - u, 3);
        c.m.position.set(c.base.x, c.base.y - 0.3 + (0.3 + c.h) * e - sink * 0.5, c.base.z);
        c.m.rotation.set(c.tilt.x * e, c.tilt.y, c.tilt.z * e);
      }
    });
  }

  /** The Blade sheet's sword: a long steel blade, golden crossguard and pommel, the tip glowing like an ember. */
  sword(scale = 1): THREE.Group {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(bladeGeo, steelMat);
    blade.scale.set(1.2, 1.25, 1);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.08), hiltMat);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 6), gripMat);
    grip.position.y = -0.18;
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), hiltMat);
    pommel.position.y = -0.37;
    const tip = new THREE.Sprite(glowMat(C(2.4, 0.9, 0.2)));
    tip.position.y = 1.45;
    tip.scale.setScalar(0.7);
    g.add(blade, guard, grip, pommel, tip);
    g.scale.setScalar(scale);
    g.userData.tip = tip;
    return g;
  }

  /**
   * The Blade sheet's crown of swords: a ring of blades pointing outward
   * around a burning core, wheeling, then flung out along their own lines.
   * `onFly` is called with each blade's direction as it is loosed.
   */
  bladeCrown(at: THREE.Vector3, count: number, radius: number, onFly: (dir: THREE.Vector3, sword: THREE.Group) => void) {
    const g = new THREE.Group();
    g.position.copy(at);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 2), sunMat);
    const halo = new THREE.Sprite(glowMat(C(2.6, 0.9, 0.2)));
    halo.scale.setScalar(2.4);
    g.add(core, halo);
    const swords = Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2;
      const s = this.sword(0.55);
      const holder = new THREE.Group();
      holder.rotation.y = a;
      s.rotation.x = Math.PI / 2;
      s.position.z = 0.3;
      holder.add(s);
      g.add(holder);
      return { holder, s, a };
    });
    this.fx.group.add(g);
    let flown = false;
    const hold = 0.45;
    this.fx.after(hold + 0.05, g, (k, dt) => {
      const t = k * (hold + 0.05);
      const grow = Math.min(1, t / 0.18);
      g.rotation.y += dt * 9;
      core.scale.setScalar(0.6 + 0.4 * grow + Math.sin(t * 40) * 0.05);
      for (const w of swords) w.s.position.z = 0.3 + radius * 0.4 * grow;
      // Blood and embers shed by the wheel.
      this.sp.puff({ pos: at.clone().add(v3(rnd(-0.3, 0.3), rnd(-0.2, 0.2), rnd(-0.3, 0.3))), vel: v3(rnd(-2, 2), rnd(0, 1.5), rnd(-2, 2)), life: 0.35, size: 0.35, size1: 0.1, color: C(2.6, 1.0, 0.2), color1: C(0.7, 0.03, 0.02), alpha: 0.8, add: 1, hot: 0.6, erode: 0.85 });
      if (!flown && k >= 0.999) {
        flown = true;
        const tmp = new THREE.Vector3();
        for (const w of swords) {
          w.s.getWorldPosition(tmp);
          const dir = tmp.clone().sub(at).setY(0).normalize();
          onFly(dir, w.s);
        }
        this.sp.fireBurst(at, 1.1, 0.5);
        this.fx.blood(at, at.clone().setY(at.y - 1), 30, C(0.3, 0.01, 0.01), 1.4);
      }
    });
  }

  /** The Bulwark sheet's shield flash: a golden shield turned toward the blow, a starburst blazing off its face. */
  shieldFlash(at: THREE.Vector3, toward: THREE.Vector3) {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.55);
    shape.quadraticCurveTo(0.38, 0.58, 0.42, 0.42);
    shape.quadraticCurveTo(0.42, -0.2, 0, -0.62);
    shape.quadraticCurveTo(-0.42, -0.2, -0.42, 0.42);
    shape.quadraticCurveTo(-0.38, 0.58, 0, 0.55);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
    const sh = new THREE.Mesh(geo, shieldMat);
    const flare = new THREE.Sprite(burstMat(C(3, 2.0, 0.6)).clone());
    flare.position.z = 0.15;
    g.add(sh, flare);
    g.position.copy(at);
    g.lookAt(toward.clone().setY(at.y));
    this.fx.group.add(g);
    this.fx.flash(at, 0xffd070, 16, 5, 0.25);
    for (let i = 0; i < 10; i++) this.fx.mote(at.clone(), v3(rnd(-2, 2), rnd(0.5, 2.5), rnd(-2, 2)), 0.5, 0.05, C(3, 2, 0.6), true);
    this.fx.after(0.45, g, (k) => {
      g.scale.setScalar(0.6 + 0.4 * Math.min(1, k * 5));
      flare.scale.setScalar(0.4 + k * 2.4);
      flare.material.opacity = 1 - k;
      flare.material.rotation = k;
      g.visible = k < 0.9;
    }, () => {
      geo.dispose();
      flare.material.dispose();
    });
  }

  /**
   * The Bulwark sheet's hallowed pillar: a stepped stone pedestal with glowing
   * arched windows, a golden column rising from it, and a radiant star blazing
   * at its head. Rises out of the ground, stands for `life`, then sinks.
   */
  holyPillar(at: THREE.Vector3, life: number) {
    const g = new THREE.Group();
    const gy = this.ground(at.x, at.z);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 1.5), pedestalMat);
    plinth.position.y = 0.09;
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.6, 0.85), pedestalMat);
    block.position.y = 0.48;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.62), pedestalMat);
    cap.position.y = 0.86;
    g.add(plinth, block, cap);
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), windowMat);
      const a = (i / 4) * Math.PI * 2;
      w.position.set(Math.sin(a) * 0.43, 0.45, Math.cos(a) * 0.43);
      w.rotation.y = a;
      g.add(w);
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.3, 10), hiltMat);
    col.position.y = 1.6;
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.04, 6, 12).rotateX(Math.PI / 2), hiltMat);
    ringA.position.y = 1.0;
    const ringB = ringA.clone();
    ringB.position.y = 2.22;
    const star = new THREE.Sprite(burstMat(C(3.2, 1.6, 0.5)).clone());
    star.position.y = 2.6;
    star.scale.setScalar(1.8);
    const halo = new THREE.Sprite(glowMat(C(2.4, 1.6, 0.5)));
    halo.position.y = 2.6;
    halo.scale.setScalar(2.6);
    g.add(col, ringA, ringB, star, halo);
    g.position.set(at.x, gy - 2.8, at.z);
    this.fx.group.add(g);
    this.fx.after(life, g, (k, dt) => {
      const t = k * life;
      const up = 1 - Math.pow(1 - Math.min(1, t / 0.35), 3);
      const down = THREE.MathUtils.clamp((t - life + 0.4) / 0.4, 0, 1);
      g.position.y = gy - 2.8 * (1 - up) - down * 2.8;
      star.material.rotation += dt * 0.8;
      star.scale.setScalar(1.6 + Math.sin(t * 6) * 0.25);
      if (Math.random() < dt * 25) this.fx.mote(g.position.clone().setY(g.position.y + 2.6), v3(rnd(-1.2, 1.2), rnd(-0.5, 1.5), rnd(-1.2, 1.2)), rnd(0.5, 1), 0.05, C(3, 2.2, 0.7), true);
      if (Math.random() < dt * 6) this.sp.puff({ pos: v3(at.x + rnd(-0.8, 0.8), gy + 0.2, at.z + rnd(-0.8, 0.8)), vel: v3(rnd(-0.3, 0.3), 0.3, rnd(-0.3, 0.3)), life: 1.5, size: 0.6, size1: 1.4, color: C(0.2, 0.17, 0.12), alpha: 0.3, lit: 1, erode: 0.85, fadeIn: 0.2 });
    }, () => star.material.dispose());
  }

  /**
   * The Blood sheet's tendrils: ropes of blood whipping up out of cracked
   * ground, curling and splitting as they rise, then splashing down.
   */
  bloodTendrils(at: THREE.Vector3, count: number, height: number, life = 0.9) {
    const g = new THREE.Group();
    const gy = this.ground(at.x, at.z);
    const items: { mesh: THREE.Mesh; total: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rnd(-0.4, 0.4);
      const out = rnd(0.3, 1.0);
      const pts: THREE.Vector3[] = [];
      const curl = rnd(-1, 1);
      for (let j = 0; j <= 6; j++) {
        const k = j / 6;
        const r = out * k * (1 + k);
        const aa = a + curl * k * 2;
        pts.push(v3(Math.cos(aa) * r, height * rnd(0.6, 1.1) * Math.sin(k * Math.PI * 0.6) + k * 0.2, Math.sin(aa) * r));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 24, rnd(0.04, 0.08), 6, false);
      // Taper toward the tip.
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const tmp = new THREE.Vector3();
      for (let v = 0; v < pos.count; v++) {
        const ring = Math.floor(v / 7);
        const k = ring / 24;
        const c = curve.getPointAt(Math.min(1, k));
        tmp.fromBufferAttribute(pos, v).sub(c).multiplyScalar(1 - k * 0.85).add(c);
        pos.setXYZ(v, tmp.x, tmp.y, tmp.z);
      }
      const mesh = new THREE.Mesh(geo, bloodMat);
      const total = geo.index ? geo.index.count : pos.count;
      geo.setDrawRange(0, 0);
      g.add(mesh);
      items.push({ mesh, total });
    }
    g.position.set(at.x, gy, at.z);
    this.fx.group.add(g);
    this.rune(at, 1.1, life + 0.8, 'blood', { fill: 0.9, grow: 0.1 });
    this.fx.after(life, g, (k) => {
      const grow = Math.min(1, k / 0.35);
      const fall = THREE.MathUtils.clamp((k - 0.6) / 0.4, 0, 1);
      for (const it of items) {
        const n = Math.floor(it.total * grow / 3) * 3;
        it.mesh.geometry.setDrawRange(0, n);
      }
      g.scale.set(1, 1 - fall * 0.9, 1);
      if (k > 0.6 && Math.random() < 0.5) this.fx.blood(at.clone().setY(gy + height * 0.6 * (1 - fall)), at.clone().setY(gy + height * 2), 6, C(0.3, 0.01, 0.01), 0.8);
    }, () => items.forEach((it) => it.mesh.geometry.dispose()));
    this.fx.blood(at.clone().setY(gy + 0.3), at.clone().setY(gy - 1), 26, C(0.32, 0.01, 0.01), 1.3);
  }

  /** A broken ring of stone slabs around a pit (the fire sheet's ring of fire, the blood sheet's pool). */
  stoneRing(at: THREE.Vector3, r: number, life: number, hot = false) {
    const g = new THREE.Group();
    const n = Math.max(8, Math.round(r * 5));
    const slabs: { m: THREE.Mesh; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.06, 0.06);
      const x = at.x + Math.cos(a) * r;
      const z = at.z + Math.sin(a) * r;
      const m = new THREE.Mesh(slabGeo, hot && i % 3 === 0 ? slabHot : slabMat);
      m.scale.set(((Math.PI * 2 * r) / n) * rnd(0.8, 0.95), rnd(0.18, 0.3), rnd(0.35, 0.5));
      m.rotation.set(rnd(-0.12, 0.12), -a + Math.PI / 2, rnd(-0.15, 0.15));
      const y = this.ground(x, z) + m.scale.y * 0.3;
      m.position.set(x, y - 0.4, z);
      g.add(m);
      slabs.push({ m, y });
    }
    this.fx.group.add(g);
    this.fx.after(life, g, (k) => {
      const t = k * life;
      const up = 1 - Math.pow(1 - Math.min(1, t / 0.2), 3);
      const down = THREE.MathUtils.clamp((t - life + 0.5) / 0.5, 0, 1);
      for (const s2 of slabs) s2.m.position.y = s2.y - 0.4 * (1 - up) - 0.4 * down;
    });
  }

  /** The red mist and swirling ring of blood around a knight paying in blood (Blood Magic). */
  bloodAura(at: THREE.Vector3) {
    const gy = this.ground(at.x, at.z);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rr = 1.1 + rnd(-0.1, 0.1);
      const p = v3(at.x + Math.cos(a) * rr, gy + rnd(0.1, 0.35), at.z + Math.sin(a) * rr);
      const tang = v3(-Math.sin(a), 0.15, Math.cos(a)).multiplyScalar(rnd(3, 4.5));
      this.sp.puff({ pos: p, vel: tang, life: rnd(0.4, 0.6), size: 0.3, size1: 0.12, color: C(2.6, 0.15, 0.08), color1: C(0.6, 0.0, 0.0), alpha: 0.85, add: 1, erode: 0.7, drag: 1.5 });
    }
    for (let i = 0; i < 8; i++)
      this.sp.puff({ pos: at.clone().add(v3(rnd(-0.6, 0.6), rnd(0.8, 2), rnd(-0.6, 0.6))), vel: v3(rnd(-0.4, 0.4), rnd(0.3, 0.8), rnd(-0.4, 0.4)), life: rnd(0.9, 1.4), size: 0.6, size1: 1.5, color: C(0.4, 0.02, 0.02), color1: C(0.15, 0.01, 0.01), alpha: 0.4, add: 1, erode: 0.9, fadeIn: 0.15 });
  }

  /** The Frost sheet's glacial lance: a long ornate spear of ice with ridged collars and a barbed head. */
  glacialLance(): THREE.Group {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.8, 6).rotateX(Math.PI / 2), starMat);
    shaft.position.z = -0.6;
    g.add(shaft);
    for (const z of [-1.35, -0.9, -0.2, 0.15]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 6).rotateX(Math.PI / 2), starMatDeep);
      collar.position.z = z;
      g.add(collar);
    }
    const head = new THREE.Mesh(spearGeo, starMat);
    head.scale.set(0.3, 0.3, 0.75);
    head.position.z = 0.25;
    const barbA = new THREE.Mesh(spearGeo, starMatDeep);
    barbA.scale.set(0.12, 0.12, 0.45);
    barbA.position.set(0.1, 0, 0.1);
    barbA.rotation.y = -2.5;
    const barbB = barbA.clone();
    barbB.position.x = -0.1;
    barbB.rotation.y = 2.5;
    const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), starMat);
    pommel.position.z = -1.55;
    const glow = new THREE.Sprite(glowMat(C(0.4, 0.8, 1.5)));
    glow.scale.setScalar(1.6);
    glow.position.z = 0.4;
    g.add(head, barbA, barbB, pommel, glow);
    return g;
  }

  /**
   * The Frost sheet's spiked ice orb: a translucent globe of ice bristling
   * with spikes, a cracked ember-red heart glowing inside, that swells out of
   * the impact and bursts.
   */
  spikedOrb(at: THREE.Vector3, r: number) {
    const g = new THREE.Group();
    const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), starMat);
    const heart = new THREE.Sprite(glowMat(C(3, 1.0, 0.4)));
    heart.scale.setScalar(1.4);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), sunMat);
    g.add(globe, core, heart);
    const ico = new THREE.IcosahedronGeometry(1, 0);
    const p = ico.getAttribute('position') as THREE.BufferAttribute;
    const seen = new Set<string>();
    for (let i = 0; i < p.count; i++) {
      const v = v3(p.getX(i), p.getY(i), p.getZ(i));
      const key = v.toArray().map((x) => x.toFixed(2)).join();
      if (seen.has(key)) continue;
      seen.add(key);
      const sp2 = new THREE.Mesh(spearGeo, starMat);
      sp2.position.copy(v).multiplyScalar(0.85);
      sp2.lookAt(v.clone().multiplyScalar(3));
      sp2.scale.set(0.35, 0.35, rnd(0.7, 1.0));
      g.add(sp2);
    }
    ico.dispose();
    g.position.copy(at);
    this.fx.group.add(g);
    this.fx.after(0.32, g, (k, dt) => {
      g.scale.setScalar(r * 0.45 * (0.3 + 0.7 * (1 - Math.pow(1 - Math.min(1, k * 2), 3))));
      g.rotation.y += dt * 2;
      if (k >= 0.999) {
        const tmp = new THREE.Vector3();
        g.children.forEach((c, i) => {
          if (i % 2) return;
          c.getWorldPosition(tmp);
          this.sp.shard(tmp.clone());
        });
      }
    }, () => globe.geometry.dispose());
  }

  /** The Frost sheet's floor of cracked ice: plates of pale ice spreading over the ground, gaps between them. */
  iceFloor(at: THREE.Vector3, r: number, life: number) {
    const g = new THREE.Group();
    const plates: { m: THREE.Mesh; y: number; delay: number }[] = [];
    const cell = 0.62;
    for (let gx = -r; gx <= r; gx += cell) {
      for (let gz = -r; gz <= r; gz += cell * 0.87) {
        const ox = gx + (Math.round(gz / (cell * 0.87)) % 2 ? cell / 2 : 0) + rnd(-0.1, 0.1);
        const oz = gz + rnd(-0.1, 0.1);
        const d = Math.hypot(ox, oz);
        if (d > r * rnd(0.8, 1.05)) continue;
        const x = at.x + ox;
        const z = at.z + oz;
        const sides = Math.random() < 0.5 ? 5 : 6;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(cell * rnd(0.42, 0.52), cell * rnd(0.45, 0.55), rnd(0.05, 0.1), sides), iceFloorMat);
        m.rotation.y = Math.random() * 6;
        const y = this.ground(x, z) + 0.03;
        m.position.set(x, y - 0.15, z);
        m.scale.setScalar(0.01);
        g.add(m);
        plates.push({ m, y, delay: (d / r) * 0.25 });
      }
    }
    this.fx.group.add(g);
    this.fx.after(life, g, (k) => {
      const t = k * life;
      const fade = THREE.MathUtils.clamp((t - life + 0.6) / 0.6, 0, 1);
      for (const c of plates) {
        const u = 1 - Math.pow(1 - THREE.MathUtils.clamp((t - c.delay) / 0.18, 0, 1), 3);
        c.m.scale.setScalar(Math.max(0.01, u * (1 - fade * 0.4)));
        c.m.position.y = c.y - 0.15 * (1 - u) - fade * 0.12;
      }
      if (Math.random() < 0.3) this.sp.puff({ pos: at.clone().add(v3(rnd(-r, r) * 0.7, 0.3, rnd(-r, r) * 0.7)), life: 0.6, size: 0.12, size1: 0.03, color: pick(GLITTER), add: 1, slot: 3, erode: 0, twinkle: 1 });
    }, () => plates.forEach((c) => c.m.geometry.dispose()));
  }

  /**
   * The Arcane sheet's warding circle: a ring of golden glyphs on dark ground,
   * three lit candles round it and a twisted crystal pillar at its heart.
   */
  ritualCircle(at: THREE.Vector3, r: number, life: number) {
    this.rune(at, r * 1.1, life, 'fire', { fill: 0.25, star: true, grow: 0.2 });
    const g = new THREE.Group();
    const gy = this.ground(at.x, at.z);
    const pillar = new THREE.Mesh(twistGeo, twistMat);
    pillar.scale.set(1.3, 1.1, 1.3);
    const top = new THREE.Sprite(glowMat(C(3, 2.2, 1.2)));
    top.position.y = 1.6;
    top.scale.setScalar(0.9);
    g.add(pillar, top);
    const flames: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const cnd = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.32, 8), waxMat);
      cnd.position.set(Math.cos(a) * r * 0.85, 0.16, Math.sin(a) * r * 0.85);
      g.add(cnd);
      const fl = new THREE.Sprite(glowMat(C(3, 2.0, 0.6)));
      fl.position.copy(cnd.position).setY(0.42);
      fl.scale.setScalar(0.45);
      g.add(fl);
      flames.push(cnd.position.clone().setY(0.36));
    }
    g.position.set(at.x, gy - 1.6, at.z);
    this.fx.group.add(g);
    this.fx.after(life, g, (k, dt) => {
      const t = k * life;
      const up = 1 - Math.pow(1 - Math.min(1, t / 0.3), 3);
      const down = THREE.MathUtils.clamp((t - life + 0.4) / 0.4, 0, 1);
      g.position.y = gy - 1.6 * (1 - up) - 1.6 * down;
      pillar.rotation.y += dt * 0.8;
      for (const f of flames) if (Math.random() < dt * 12) this.sp.puff({ pos: g.position.clone().add(f), vel: v3(0, 0.6, 0), life: 0.3, size: 0.12, size1: 0.04, color: C(2.6, 1.6, 0.4), color1: C(0.8, 0.2, 0.02), alpha: 0.9, add: 1, hot: 0.8, erode: 0.8 });
      if (Math.random() < dt * 10) this.sp.puff({ pos: g.position.clone().add(v3(rnd(-r, r) * 0.8, rnd(0.3, 1.8), rnd(-r, r) * 0.8)), life: 0.7, size: 0.1, size1: 0.03, color: C(3, 2.6, 1.0), add: 1, slot: 3, erode: 0, twinkle: 1 });
    });
  }

  /**
   * The Arcane sheet's void pit: a hole of darkness opened in the ground, a
   * crown of magenta crystal spikes round its lip and violet light swirling in.
   */
  voidPit(at: THREE.Vector3, r: number, life: number) {
    const g = new THREE.Group();
    const gy = this.ground(at.x, at.z);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.75, 32).rotateX(-Math.PI / 2), voidMat.clone());
    disc.position.y = 0.07;
    disc.renderOrder = 5;
    g.add(disc);
    const spikes: THREE.Mesh[] = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const m = new THREE.Mesh(spearGeo, amethystMat);
      m.position.set(Math.cos(a) * r * 0.78, 0, Math.sin(a) * r * 0.78);
      m.lookAt(v3(Math.cos(a) * r * 2, rnd(1.6, 2.6), Math.sin(a) * r * 2));
      m.scale.set(0.22, 0.22, 0.001);
      g.add(m);
      spikes.push(m);
    }
    g.position.set(at.x, gy, at.z);
    this.fx.group.add(g);
    this.rune(at, r * 1.25, life, 'arcane', { fill: 0.6, grow: 0.15 });
    const lens = spikes.map(() => rnd(0.5, 0.9) * r * 0.6);
    this.fx.after(life, g, (k, dt) => {
      const t = k * life;
      const up = 1 - Math.pow(1 - Math.min(1, t / 0.2), 3);
      const down = THREE.MathUtils.clamp((t - life + 0.3) / 0.3, 0, 1);
      spikes.forEach((m, i) => m.scale.set(0.22, 0.22, Math.max(0.001, lens[i] * up * (1 - down))));
      (disc.material as THREE.MeshBasicMaterial).opacity = 0.92 * up * (1 - down);
      disc.scale.setScalar(0.4 + 0.6 * up);
      // Violet light spiralling down into the dark.
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = r * rnd(0.6, 1.1);
        const p = v3(at.x + Math.cos(a) * rr, gy + rnd(0.1, 0.5), at.z + Math.sin(a) * rr);
        const inward = v3(at.x - p.x, -0.4, at.z - p.z);
        const tang = v3(-inward.z, 0, inward.x);
        this.sp.puff({ pos: p, vel: inward.multiplyScalar(2.2).add(tang.multiplyScalar(2)), life: 0.45, size: 0.22, size1: 0.05, color: C(2.2, 0.6, 2.8), color1: C(0.4, 0.05, 0.8), alpha: 0.8, add: 1, erode: 0.7 });
      }
      if (Math.random() < dt * 12) this.fx.mote(g.position.clone().add(v3(rnd(-r, r), 0.2, rnd(-r, r))), v3(0, 1.2, 0), 0.6, 0.05, C(2.4, 0.6, 2.8), true);
    }, () => (disc.material as THREE.Material).dispose());
  }

  // ---------------------------------------------------------------- motion

  /** A streak of torn air and light from `from` to `to` (Lunge, Phantom Blade). */
  streak(from: THREE.Vector3, to: THREE.Vector3, width: number, color: THREE.Color, life = 0.35) {
    const d = to.clone().sub(from);
    const len = d.length();
    if (len < 0.1) return;
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = streakBase.clone();
    mat.uniforms.color.value.copy(color);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from).addScaledVector(d, 0.5);
    m.rotation.y = Math.atan2(d.x, d.z) - Math.PI / 2;
    m.scale.set(len, 1, width);
    m.renderOrder = 18;
    this.fx.group.add(m);
    this.fx.after(life, m, (k) => (mat.uniforms.k.value = k), () => {
      geo.dispose();
      mat.dispose();
    });
  }

  /** Burst of coloured wisps (shared helper for palettes other effects already use). */
  burst(at: THREE.Vector3, r: number, palette: Palette) {
    const cols: Record<Palette, [THREE.Color, THREE.Color]> = {
      fire: [C(2.4, 0.9, 0.2), C(0.6, 0.06, 0.01)],
      arcane: [C(1.6, 0.8, 3.2), C(0.25, 0.05, 0.6)],
      crimson: [C(1.8, 0.12, 0.06), C(0.3, 0, 0.02)],
      holy: [C(2.8, 2.1, 0.8), C(0.6, 0.35, 0.05)],
      frost: [C(0.9, 1.9, 2.8), C(0.1, 0.3, 0.7)],
    };
    this.sp.energyBurst(at, r, cols[palette][0], cols[palette][1], Math.round(8 + r * 6), Math.round(8 + r * 8));
  }
}

/** A long four-sided crystal spear along +Z, base at the origin (radial ice spikes). */
const spearGeo = (() => {
  const g = new THREE.BufferGeometry();
  const w = 0.5;
  const v = [
    [0, 0, 0],
    [w, 0, 0.3],
    [0, w, 0.3],
    [-w, 0, 0.3],
    [0, -w, 0.3],
    [0, 0, 1],
  ];
  const tris = [
    [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4],
    [5, 1, 2], [5, 2, 3], [5, 3, 4], [5, 4, 1],
  ];
  const pos: number[] = [];
  for (const t of tris) for (const i of t) pos.push(...v[i]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
})();

/** Compile the new materials up front so the first cast doesn't hitch. */
export function prewarmSkillFx(scene: THREE.Object3D) {
  if (scene.userData.skillWarm) return;
  scene.userData.skillWarm = true;
  const g = new THREE.Group();
  g.position.y = -40;
  const q = new THREE.PlaneGeometry(0.1, 0.1);
  for (const m of [starMat, starMatDeep, runeBase, streakBase, hammerGold, hammerHaft, slabMat, slabHot, steelMat, hiltMat, gripMat, tasselMat, shieldMat, pedestalMat, windowMat, bloodMat, iceFloorMat, voidMat, amethystMat, waxMat, twistMat, sunMat]) g.add(new THREE.Mesh(q, m));
  g.add(new THREE.Sprite(burstMat(C(1, 1, 1))));
  scene.add(g);
}
