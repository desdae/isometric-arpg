import * as THREE from 'three';
import type { HeightFn } from '../procgen/terrain';
import { fbm2, clamp01, smoothstep } from '../procgen/noise';
import { SpellFx } from './SpellFx';
import { BossFx } from './BossFx';

// Combat effects for one area: blood spray and pooled splats, sword arcs,
// blood bolts with trails, shockwaves and flashes. Everything is pooled or
// short-lived and lives under one group in the area's scene.

const MAX_DROPS = 900;
const MAX_SPLATS = 70;

/**
 * Blood pool flow field. G holds the "arrival time" of the spreading pool at
 * each texel (0 at the centre, 1 at the furthest finger), so raising a
 * threshold over time makes the blood run outward along uneven fingers
 * instead of scaling up a disc. R holds thickness (darker, glossier centre).
 * Pixels the pool never reaches are 1.
 */
function splatTexture(size = 256, seed = 3): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  // A few satellite drips thrown from the wound, reached early.
  const drips = Array.from({ length: 9 }, (_, i) => {
    const a = i * 2.39996 + seed;
    const r = 0.3 + ((i * 0.618) % 1) * 0.15;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, s: 0.012 + ((i * 0.37) % 1) * 0.022 };
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let u = x / size - 0.5;
      let v = y / size - 0.5;
      // Domain warp so the outline wanders.
      u += fbm2(u * 5 + 11, v * 5, 3, seed + 1) * 0.05;
      v += fbm2(u * 5, v * 5 + 7, 3, seed + 2) * 0.05;
      const r = Math.hypot(u, v) * 2;
      const a = Math.atan2(v, u);
      // Reach in this direction: a lumpy base plus a few long runnels where
      // the blood found a downhill path.
      const lump = 0.5 + fbm2(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5, 4, seed) * 0.22;
      const finger = Math.pow(Math.max(0, fbm2(Math.cos(a) * 3.2 + 9, Math.sin(a) * 3.2 + 2, 3, seed + 5)), 1.6) * 0.75;
      const reach = Math.min(0.96, lump + finger);
      let t = r / reach; // < 1 inside the final pool
      for (const d of drips) {
        const dd = Math.hypot(u - d.x, v - d.y) / d.s;
        if (dd < 1) t = Math.min(t, 0.35 + dd * 0.2);
      }
      const i = (y * size + x) * 4;
      data[i] = Math.round(255 * clamp01(1 - smoothstep(0, 1, t)));
      data[i + 1] = Math.round(255 * clamp01(t));
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Wet pool material: alpha from the flow field against a per-pool spread. */
function poolMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.34, 0.012, 0.008),
    alphaMap: tex,
    envMapIntensity: 1.6,
    transparent: true,
    depthWrite: false,
    roughness: 0.06,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const spread = { value: 0 };
  mat.userData.spread = spread;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.spread = spread;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float spread;')
      .replace(
        '#include <alphamap_fragment>',
        `vec4 flow = texture2D( alphaMap, vAlphaMapUv );
        // Leading edge: a soft rim that is slightly darker, like blood
        // beading where it meets dry ground.
        float edge = spread - flow.g;
        diffuseColor.a *= smoothstep( 0.0, 0.035, edge );
        diffuseColor.rgb *= mix( 1.3, 0.7, flow.r ) * mix( 0.55, 1.0, smoothstep( 0.0, 0.06, edge ) );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Thin edges soak in and dull; the thick centre stays glossy.
        roughnessFactor = mix( 0.55, roughnessFactor, flow.r );`,
      );
  };
  mat.customProgramCacheKey = () => 'bloodpool';
  return mat;
}

const dropMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { pixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
  vertexShader: /* glsl */ `
    uniform float pixelRatio;
    attribute vec4 dropColor;
    attribute float dropSize;
    varying vec4 vColor;
    void main() {
      vColor = dropColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = dropSize * pixelRatio * (320.0 / -mv.z);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec4 vColor;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5 || vColor.a < 0.01) discard;
      // A tiny highlight makes the drops read as wet.
      float spec = smoothstep(0.18, 0.0, length(c - vec2(-0.15, -0.15)));
      gl_FragColor = vec4(vColor.rgb + spec * 0.12, vColor.a * smoothstep(0.5, 0.35, d));
    }
  `,
});

type Drop = { pos: THREE.Vector3; vel: THREE.Vector3; age: number; life: number; size: number; color: THREE.Color; glow: boolean; landed: boolean };
type Timed = { obj: THREE.Object3D; age: number; life: number; update: (k: number, dt: number) => unknown; dispose?: () => void };

export interface Bolt {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  age: number;
  life: number;
  obj: THREE.Object3D;
  light: THREE.PointLight | null;
  /** Return true when the bolt hits something and should burst. */
  test: (pos: THREE.Vector3) => boolean;
}

export class Effects {
  readonly group = new THREE.Group();
  private drops: Drop[] = [];
  private dropGeo = new THREE.BufferGeometry();
  private dropPos = new Float32Array(MAX_DROPS * 3);
  private dropCol = new Float32Array(MAX_DROPS * 4);
  private dropSize = new Float32Array(MAX_DROPS);
  private glowGeo = new THREE.BufferGeometry();
  private splats: THREE.Mesh[] = [];
  private splatIndex = 0;
  private splatTex = splatTexture();
  private timed: Timed[] = [];
  private bolts: Bolt[] = [];
  private shake = 0;
  /**
   * Point lights for flashes and bolts. They stay in the scene at zero
   * intensity when idle: adding or removing a light makes three.js recompile
   * every lit material, which hitches the frame.
   */
  private lights: THREE.PointLight[] = [];
  private freeLights: THREE.PointLight[] = [];
  /** Textured particle puffs, fire, ice and decals for spells and skills. */
  readonly spell: SpellFx;

  constructor(readonly height: HeightFn) {
    this.dropGeo.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dropGeo.setAttribute('dropColor', new THREE.BufferAttribute(this.dropCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.dropGeo.setAttribute('dropSize', new THREE.BufferAttribute(this.dropSize, 1).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(this.dropGeo, dropMaterial);
    pts.frustumCulled = false;
    pts.renderOrder = 15;
    this.group.add(pts);
    // Glowing sparks share the buffers' layout but blend additively.
    this.glowGeo = this.dropGeo.clone();
    const glowMat = dropMaterial.clone();
    glowMat.blending = THREE.AdditiveBlending;
    const glowPts = new THREE.Points(this.glowGeo, glowMat);
    glowPts.frustumCulled = false;
    glowPts.renderOrder = 16;
    this.group.add(glowPts);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 2);
      this.lights.push(l);
      this.freeLights.push(l);
      this.group.add(l);
    }
    this.spell = new SpellFx(this);
  }

  /** Spray of blood (or ichor) from a wound, thrown away from `from`. */
  blood(at: THREE.Vector3, from: THREE.Vector3, count = 18, color = new THREE.Color(0.22, 0.01, 0.008), power = 1) {
    const away = new THREE.Vector3().subVectors(at, from).setY(0);
    if (away.lengthSq() < 1e-4) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    away.normalize();
    for (let i = 0; i < count; i++) {
      const v = away
        .clone()
        .multiplyScalar((1.5 + Math.random() * 3) * power)
        .add(new THREE.Vector3((Math.random() - 0.5) * 2.4, 1 + Math.random() * 2.8, (Math.random() - 0.5) * 2.4).multiplyScalar(power));
      this.addDrop(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2)), v, 0.9 + Math.random() * 1.4, 0.05 + Math.random() * 0.08, color, false);
    }
  }

  sparks(at: THREE.Vector3, count: number, color: THREE.Color, speed = 3, life = 0.6) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.addDrop(at.clone(), v, life * (0.5 + Math.random() * 0.8), 0.06 + Math.random() * 0.06, color, true);
    }
  }

  /** One particle: glowing motes float and fade, plain drops fall and land. */
  mote(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, color: THREE.Color, glow = true) {
    this.addDrop(pos, vel, life, size, color, glow);
  }

  private addDrop(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, color: THREE.Color, glow: boolean) {
    if (this.drops.length >= MAX_DROPS) this.drops.shift();
    this.drops.push({ pos, vel, age: 0, life, size, color, glow, landed: false });
  }

  /** Pool of blood running out over the ground from where a body fell. */
  splat(x: number, z: number, size: number) {
    const N = 16;
    let m = this.splats[this.splatIndex % MAX_SPLATS];
    if (!m) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, N, N).rotateX(-Math.PI / 2), poolMaterial(this.splatTex));
      m.receiveShadow = true;
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.splats.push(m);
      this.group.add(m);
    }
    this.splatIndex++;
    // Drape the grid over the terrain in world space so the pool hugs bumps
    // instead of a flat card cutting through them.
    const half = (size * (0.85 + Math.random() * 0.35)) / 2;
    const rot = Math.random() * Math.PI * 2;
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const gx = ((i % (N + 1)) / N - 0.5) * 2 * half;
      const gz = (Math.floor(i / (N + 1)) / N - 0.5) * 2 * half;
      const wx = x + gx * c - gz * sn;
      const wz = z + gx * sn + gz * c;
      pos.setXYZ(i, wx, this.height(wx, wz) + 0.03, wz);
    }
    pos.needsUpdate = true;
    m.geometry.computeVertexNormals();
    m.geometry.computeBoundingSphere();
    const spread = (m.material as THREE.Material).userData.spread as { value: number };
    spread.value = 0;
    // Gushes out fast, then creeps along its runnels for a few seconds.
    this.after(5, m, (k) => (spread.value = 0.08 + 0.88 * (1 - Math.pow(1 - k, 3))));
  }

  /** Run `update(k)` for `life` seconds on an object, then remove it; `update` returning true ends it early. */
  after(life: number, obj: THREE.Object3D, update: (k: number, dt: number) => unknown, dispose?: () => void) {
    this.timed.push({ obj, age: 0, life, update, dispose });
  }

  /** Pale crescent left by a sword stroke, around `center` facing `yaw`. */
  slash(center: THREE.Vector3, yaw: number, radius = 1.6, color = new THREE.Color(1.6, 0.9, 0.7), spin = false) {
    const arc = spin ? Math.PI * 2 : 2.4;
    const geo = new THREE.RingGeometry(radius * 0.45, radius, 40, 1, -arc / 2, arc);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { k: { value: 0 }, color: { value: color }, arc: { value: arc }, outer: { value: radius } },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float k, arc, outer;
        uniform vec3 color;
        varying vec2 vP;
        void main() {
          float a = atan(vP.y, vP.x) / (arc * 0.5); // -1..1 across the arc
          float r = length(vP);
          // Bright leading edge sweeping across, fading behind it.
          float sweep = smoothstep(-1.0, 1.0, a - (k * 2.6 - 1.3));
          float edge = smoothstep(0.0, 0.25, 1.0 - abs(a));
          float rr = r / outer; // 0.45..1 across the blade's band
          // Streaks along the stroke, like air torn by the edge.
          float streak = 0.55 + 0.45 * sin(rr * 46.0 + sin(a * 3.0) * 2.0) * sin(rr * 19.0 - a * 1.5);
          float across = smoothstep(0.45, 0.62, rr) * smoothstep(1.0, 0.86, rr);
          float rim = smoothstep(0.86, 0.97, rr) * smoothstep(1.0, 0.97, rr);
          float alpha = (1.0 - sweep) * edge * (1.0 - k) * (across * streak * 0.8 + rim * 1.4);
          gl_FragColor = vec4(color * alpha + vec3(rim * alpha * 1.2), alpha);
        }
      `,
    });
    const m = new THREE.Mesh(geo, mat);
    // Lay the ring flat with the middle of the arc pointing along local +Z
    // (the direction a character faces at yaw 0).
    m.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    const holder = new THREE.Group();
    holder.position.copy(center);
    holder.rotation.y = yaw;
    holder.add(m);
    holder.renderOrder = 18;
    m.renderOrder = 18;
    this.group.add(holder);
    this.spell.sweep(center, yaw, radius, arc, color.clone().multiplyScalar(0.45));
    this.after(spin ? 0.42 : 0.22, holder, (k) => (mat.uniforms.k.value = k), () => {
      geo.dispose();
      mat.dispose();
    });
  }

  /** Expanding ring of force and grit where something heavy hit the ground. */
  shockwave(at: THREE.Vector3, radius = 3, color = new THREE.Color(0.9, 0.45, 0.3)) {
    this.spell.ring(at, radius, color, 0.5);
    this.addShake(0.35);
  }

  /** Barbed roots bursting up out of the ground around `at`, then sinking back. */
  rootSpikes(at: THREE.Vector3, radius = 1.6, count = 9) {
    const mat = Effects.rootMat ??= new THREE.MeshStandardMaterial({ color: 0x2a1e16, roughness: 0.85 });
    const holder = new THREE.Group();
    const spikes: { m: THREE.Mesh; h: number; delay: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const d = i === 0 ? 0 : radius * (0.3 + Math.random() * 0.7);
      const h = (i === 0 ? 1.7 : 0.8 + Math.random() * 0.9) * (radius / 1.6);
      const geo = new THREE.ConeGeometry(0.09 + h * 0.06, h, 5).translate(0, h / 2, 0);
      const m = new THREE.Mesh(geo, mat);
      const x = at.x + Math.cos(a) * d;
      const z = at.z + Math.sin(a) * d;
      m.position.set(x, this.height(x, z) - h, z);
      m.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * 6, (Math.random() - 0.5) * 0.6);
      m.castShadow = true;
      holder.add(m);
      spikes.push({ m, h, delay: d / radius * 0.12 });
    }
    this.group.add(holder);
    this.after(1.3, holder, (k) => {
      for (const s of spikes) {
        const t = Math.max(0, k * 1.3 - s.delay);
        // Shoot up fast, hold, then sink back.
        const up = Math.min(1, t / 0.08) * (1 - Math.max(0, (t - 0.75) / 0.35));
        s.m.position.y = this.height(s.m.position.x, s.m.position.z) - s.h * (1 - Math.max(0, up)) - 0.05;
      }
    }, () => {
      for (const s of spikes) s.m.geometry.dispose();
    });
    this.shockwave(at, radius * 1.4, new THREE.Color(0.5, 0.08, 0.04));
    this.sparks(at.clone().setY(at.y + 0.2), 16, new THREE.Color(0.3, 0.22, 0.12), 3, 0.6);
  }
  private static rootMat: THREE.MeshStandardMaterial | undefined;

  /** Brief point-light flash (hits, casts). */
  flash(at: THREE.Vector3, color: number, intensity = 20, range = 6, life = 0.25) {
    const l = this.borrowLight(color, intensity, range);
    if (!l) return;
    l.position.copy(at);
    const holder = new THREE.Object3D();
    this.group.add(holder);
    this.after(life, holder, (k) => (l.intensity = intensity * (1 - k) * (1 - k)), () => this.returnLight(l));
  }

  private borrowLight(color: THREE.ColorRepresentation, intensity: number, range: number): THREE.PointLight | null {
    const l = this.freeLights.pop();
    if (!l) return null;
    l.color.set(color);
    l.intensity = intensity;
    l.distance = range;
    return l;
  }

  private returnLight(l: THREE.PointLight) {
    l.intensity = 0;
    this.freeLights.push(l);
  }

  /**
   * Hallowed fire falling on marked ground: a burning sigil spreads across the
   * floor, rings of flame racing round it, and a tall twisting column of gold
   * and orange fire roars up from its heart, shedding embers.
   */
  hallowFire(at: THREE.Vector3, radius = 2.2) {
    const noise = /* glsl */ `
      float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float nn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hh(i), hh(i + vec2(1, 0)), u.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), u.x), u.y); }
      float fb(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * nn(p); p *= 2.07; a *= 0.5; } return s; }
      vec3 fireRamp(float t) { return mix(mix(vec3(0.5, 0.06, 0.01), vec3(1.3, 0.45, 0.06), smoothstep(0.1, 0.55, t)), vec3(1.8, 1.25, 0.45), smoothstep(0.6, 1.0, t)); }
    `;
    const vs = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
    const base = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false };
    // The sigil: rings and radial tongues of flame, eating outward from the centre.
    const discGeo = new THREE.CircleGeometry(radius * 1.25, 48).rotateX(-Math.PI / 2);
    const discMat = new THREE.ShaderMaterial({
      ...base,
      uniforms: { k: { value: 0 }, time: { value: 0 } },
      vertexShader: vs,
      fragmentShader: /* glsl */ `
        uniform float k, time; varying vec2 vUv;
        ${noise}
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float r = length(p);
          float a = atan(p.y, p.x);
          float spread = smoothstep(0.0, 0.25, k);
          float n = fb(vec2(a * 3.0, r * 4.0 - time * 3.0)) ;
          float ring = (exp(-pow((r - 0.78) * 18.0, 2.0)) + 0.7 * exp(-pow((r - 0.42) * 20.0, 2.0))) * (0.5 + 0.5 * smoothstep(0.3, 0.7, nn(vec2(a * 6.0, time))));
          float tongues = pow(max(0.0, sin(a * 9.0 + n * 4.0 - time * 2.0)), 6.0) * smoothstep(0.85, 0.3, r) * smoothstep(0.05, 0.3, r);
          float core = smoothstep(0.45, 0.0, r);
          float heat = (ring * (0.6 + n) + tongues * 0.8 + core * (0.5 + n * 0.8)) * smoothstep(1.0, 0.75, r);
          heat *= step(r, spread * 1.05) * (1.0 - smoothstep(0.55, 1.0, k));
          heat = clamp(heat, 0.0, 1.0);
          gl_FragColor = vec4(fireRamp(heat * 0.85) * heat * 0.5, heat);
        }
      `,
    });
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.copy(at).setY(at.y + 0.05);
    disc.renderOrder = 11;
    this.group.add(disc);
    // The column: a twisting sheet of flame, wide at the foot and licking up to a point.
    const colGeo = new THREE.CylinderGeometry(0.12, radius * 0.36, 6.5, 32, 24, true).translate(0, 3.25, 0);
    const colMat = new THREE.ShaderMaterial({
      ...base,
      uniforms: { k: { value: 0 }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float time; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          // Twist the column and let it sway as it climbs.
          float t = uv.y;
          float ang = t * 2.6 + time * 1.5;
          p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
          p.x += sin(t * 5.0 - time * 4.0) * 0.25 * t;
          p.z += cos(t * 4.0 - time * 3.3) * 0.2 * t;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float k, time; varying vec2 vUv;
        ${noise}
        void main() {
          float y = vUv.y;
          float n = fb(vec2(vUv.x * 6.0 + y * 2.0, y * 3.0 - time * 2.6));
          float n2 = fb(vec2(vUv.x * 11.0 - y * 3.0, y * 5.0 - time * 4.0));
          float rise = smoothstep(0.0, 0.2, k);
          float top = rise * 1.05 - y;
          float body = smoothstep(0.0, 0.25, top) * (1.0 - smoothstep(0.6, 1.0, k));
          float heat = clamp((n * 1.25 + n2 * 0.45 - y * 0.75) * body, 0.0, 1.0);
          heat = smoothstep(0.3, 0.95, heat);
          // Bright licks with dark gaps between them, not a solid glow.
          float licks = smoothstep(0.35, 0.65, fb(vec2(vUv.x * 9.0, y * 2.0 - time * 3.2)));
          heat *= 0.35 + 0.65 * licks;
          gl_FragColor = vec4(fireRamp(heat) * heat * 0.6, heat);
        }
      `,
    });
    const col = new THREE.Mesh(colGeo, colMat);
    col.position.copy(at);
    col.renderOrder = 12;
    this.group.add(col);
    const life = 1.5;
    this.after(life, disc, (k, dt) => {
      discMat.uniforms.k.value = k;
      discMat.uniforms.time.value += dt;
    }, () => {
      discGeo.dispose();
      discMat.dispose();
    });
    this.after(life, col, (k, dt) => {
      colMat.uniforms.k.value = k;
      colMat.uniforms.time.value += dt;
      col.scale.set(1 + k * 0.15, 0.85 + Math.min(k * 4, 1) * 0.15, 1 + k * 0.15);
    }, () => {
      colGeo.dispose();
      colMat.dispose();
    });
    this.spell.decal('scorch', at.x, at.z, radius * 1.1, 4);
    this.sparks(at.clone().setY(at.y + 0.4), 36, new THREE.Color(2.6, 1.4, 0.35), 4.5, 1.3);
    this.sparks(at.clone().setY(at.y + 2.2), 18, new THREE.Color(2.4, 1.0, 0.2), 2.5, 1.6);
    this.flash(at.clone().setY(at.y + 1.6), 0xff9030, 10, radius * 2.5, 0.8);
  }

  /** Column of light for a level up. */
  pillar(at: THREE.Vector3, color = new THREE.Color(2.0, 1.4, 0.6)) {
    const geo = new THREE.CylinderGeometry(0.7, 0.9, 8, 24, 1, true).translate(0, 4, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { k: { value: 0 }, color: { value: color } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float k; uniform vec3 color; varying vec2 vUv;
        void main() { float a = (1.0 - vUv.y) * (1.0 - vUv.y) * sin(k * 3.14159) * 0.8; gl_FragColor = vec4(color * a, a); }
      `,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    this.group.add(m);
    this.after(1.6, m, (k) => {
      mat.uniforms.k.value = k;
      m.scale.set(1 + k * 0.3, 1, 1 + k * 0.3);
    }, () => {
      geo.dispose();
      mat.dispose();
    });
    this.sparks(at.clone().setY(at.y + 0.3), 40, new THREE.Color(2.2, 1.5, 0.6), 4, 1.4);
    this.flash(at.clone().setY(at.y + 1.5), 0xffc070, 40, 10, 1.2);
  }

  /** Glowing blood bolt flying from `from` along `dir` until `test` says it hit. */
  bolt(from: THREE.Vector3, dir: THREE.Vector3, test: (p: THREE.Vector3) => boolean, onHit: (p: THREE.Vector3) => void, speed = 10, tint: 'blood' | 'gold' = 'blood') {
    const gold = tint === 'gold';
    const obj = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: gold ? new THREE.Color(4, 2.6, 0.8) : new THREE.Color(4, 0.4, 0.25), fog: false }));
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 12, 8),
      new THREE.MeshBasicMaterial({ color: gold ? new THREE.Color(1.2, 0.7, 0.15) : new THREE.Color(1.2, 0.05, 0.03), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    obj.add(core, halo);
    const light = this.borrowLight(gold ? 0xffa030 : 0xff2a14, 18, 7);
    obj.position.copy(from);
    this.group.add(obj);
    const b: Bolt = { pos: obj.position, dir: dir.clone().normalize(), speed, age: 0, life: 2.4, obj, light, test };
    (b as Bolt & { onHit: typeof onHit }).onHit = onHit;
    this.bolts.push(b);
  }

  /**
   * Fires one of every kind of effect at `at` while the screen is covered, so
   * the frame drawn next builds every shader and texture they need on the GPU
   * (some drivers only finish that on a real draw). Clear with clearAll().
   */
  rehearse(at: THREE.Vector3): boolean {
    if (this.rehearsed) return false;
    this.rehearsed = true;
    const p = at.clone();
    const up = p.clone().setY(p.y + 1);
    const sp = this.spell;
    const c = new THREE.Color(1.5, 0.6, 0.2);
    sp.fireBurst(up, 2);
    sp.frostBurst(p, 3, 6);
    sp.crystals(p, 4, 1, 1, 0.5);
    sp.shard(up.clone());
    sp.decal('scorch', p.x, p.z, 1, 1);
    sp.decal('frost', p.x, p.z, 1, 1);
    sp.ring(p, 2, c, 0.5);
    sp.ring(p, 2, c, 0.5, false);
    sp.dust(p, 1, 4);
    sp.energyBurst(up, 1, c, c, 4, 4);
    sp.glitter(up, 1, 4);
    for (const pal of ['fire', 'arcane', 'crimson', 'holy', 'frost'] as const) {
      const o = sp.orb(pal, 0.2, c);
      o.position.copy(up);
      this.group.add(o);
      this.after(0.2, o, () => {});
    }
    this.hallowFire(p.clone(), 1);
    this.slash(up, 0, 1.5, c, true);
    this.slash(up, 0, 1.5, c, false);
    this.shockwave(p, 2, c);
    this.sparks(up, 4, c);
    this.blood(up, p, 4);
    this.splat(p.x, p.z, 1);
    this.rootSpikes(p, 1, 3);
    this.pillar(p);
    this.bolt(up, new THREE.Vector3(1, 0, 0), () => false, () => {});
    for (const l of this.lights) l.intensity = Math.max(l.intensity, 1);
    const b = new BossFx(this);
    b.debris(p, 3);
    b.cracks(p, 1, c);
    b.spikes(p, 3, 1, 1);
    b.column(p, 0.5, 2, c);
    b.nova(p, 2, c, 0.5, 1);
    b.lob(up, p, 0.5, c, 0.2, 1, () => {});
    b.fall(p, 0.5, c, () => {});
    b.pool(p, 1, c, 1);
    b.gust(p, 0, 2, 0.5, c);
    this.shake = 0;
    return true;
  }
  private rehearsed = false;

  /**
   * Removes every running effect at once. After a rehearsal their materials
   * are deliberately not disposed: three.js frees a shader program when the
   * last material using it is disposed, and later casts would then build it
   * all over again. Keeping one material of each kind alive pins them.
   */
  clearAll(keepMaterials = true) {
    for (const t of this.timed) {
      if (this.splats.includes(t.obj as THREE.Mesh)) continue;
      t.obj.parent?.remove(t.obj);
      if (!keepMaterials) t.dispose?.();
    }
    this.timed.length = 0;
    for (const b of this.bolts) {
      if (b.light) this.returnLight(b.light);
      this.group.remove(b.obj);
    }
    this.bolts.length = 0;
    for (const l of this.lights) l.intensity = 0;
    this.freeLights = [...this.lights];
    this.drops.length = 0;
    this.dropGeo.setDrawRange(0, 0);
    this.glowGeo.setDrawRange(0, 0);
    for (const m of this.splats) {
      ((m.material as THREE.Material).userData.spread as { value: number }).value = 0;
    }
    this.spell.clear();
    this.shake = 0;
  }

  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Camera shake offset for this frame. */
  shakeOffset(t: number): THREE.Vector3 {
    const s = this.shake * this.shake * 0.25;
    return new THREE.Vector3(Math.sin(t * 61) * s, Math.sin(t * 47 + 1) * s * 0.6, Math.cos(t * 53) * s);
  }

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 2.2);
    // Drops: ballistic until they land, then a quick fade where they fell.
    let n = 0;
    let g = 0;
    const glowPos = this.glowGeo.getAttribute('position') as THREE.BufferAttribute;
    const glowCol = this.glowGeo.getAttribute('dropColor') as THREE.BufferAttribute;
    const glowSize = this.glowGeo.getAttribute('dropSize') as THREE.BufferAttribute;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age >= d.life) {
        this.drops.splice(i, 1);
        continue;
      }
      if (!d.landed) {
        d.vel.y -= (d.glow ? 3 : 14) * dt;
        d.vel.multiplyScalar(d.glow ? 1 - dt * 1.5 : 1);
        d.pos.addScaledVector(d.vel, dt);
        const gy = this.height(d.pos.x, d.pos.z) + 0.02;
        if (d.pos.y < gy) {
          d.pos.y = gy;
          if (d.glow) d.vel.set(0, 0, 0);
          d.landed = !d.glow;
        }
      }
      const fade = d.landed ? 1 - (d.age - (d.life - 0.6)) / 0.6 : d.glow ? 1 - d.age / d.life : 1;
      const a = Math.min(1, Math.max(0, fade));
      if (d.glow) {
        if (g >= MAX_DROPS) continue;
        glowPos.setXYZ(g, d.pos.x, d.pos.y, d.pos.z);
        glowCol.setXYZW(g, d.color.r * a, d.color.g * a, d.color.b * a, a);
        glowSize.setX(g, d.size * (d.landed ? 1.6 : 1));
        g++;
      } else {
        this.dropPos[n * 3] = d.pos.x;
        this.dropPos[n * 3 + 1] = d.pos.y;
        this.dropPos[n * 3 + 2] = d.pos.z;
        this.dropCol[n * 4] = d.color.r;
        this.dropCol[n * 4 + 1] = d.color.g;
        this.dropCol[n * 4 + 2] = d.color.b;
        this.dropCol[n * 4 + 3] = a;
        this.dropSize[n] = d.size * (d.landed ? 1.7 : 1);
        n++;
      }
    }
    this.dropGeo.setDrawRange(0, n);
    this.glowGeo.setDrawRange(0, g);
    for (const name of ['position', 'dropColor', 'dropSize']) {
      (this.dropGeo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
      (this.glowGeo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }

    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.age += dt;
      const k = Math.min(1, t.age / t.life);
      const early = t.update(k, dt) === true;
      if (k >= 1 || early) {
        this.timed.splice(i, 1);
        if (!this.splats.includes(t.obj as THREE.Mesh)) {
          t.obj.parent?.remove(t.obj);
          t.dispose?.();
        }
      }
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i] as Bolt & { onHit: (p: THREE.Vector3) => void };
      b.age += dt;
      b.pos.addScaledVector(b.dir, b.speed * dt);
      b.light?.position.copy(b.pos);
      // Trail of glowing motes.
      if (Math.random() < 0.9) this.addDrop(b.pos.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4), 0.35, 0.12, new THREE.Color(2.4, 0.15, 0.08), true);
      const ground = b.pos.y < this.height(b.pos.x, b.pos.z) + 0.1;
      const hit = b.test(b.pos);
      if (hit || ground || b.age > b.life) {
        this.sparks(b.pos.clone(), 18, new THREE.Color(2.6, 0.2, 0.1), 3.5, 0.5);
        this.flash(b.pos.clone(), 0xff3018, 25, 6, 0.3);
        if (hit) b.onHit(b.pos.clone());
        if (b.light) this.returnLight(b.light);
        this.group.remove(b.obj);
        this.bolts.splice(i, 1);
      }
    }
    this.spell.update(dt);
  }
}
