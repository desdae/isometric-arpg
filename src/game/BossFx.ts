import * as THREE from 'three';
import type { Effects } from './Effects';
import { rock } from '../procgen/geometry';
import { mulberry32 } from '../procgen/noise';

// The heavy effects boss abilities are built from: flying rubble, glowing
// floor cracks, spikes bursting out of the stone, columns of soul-fire,
// expanding novas, lobbed globs, lingering pools and falling bolts. Each is
// short-lived and runs on the area's Effects timeline.

const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x3a302c, roughness: 0.95 });
const rubbleGeos = Array.from({ length: 5 }, (_, i) => rock(mulberry32(400 + i), 1));
const boneMat = new THREE.MeshStandardMaterial({ color: 0xb8a888, roughness: 0.55 });

const glowVert = /* glsl */ `varying vec2 vUv; varying vec3 vP; void main() { vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const noiseFns = /* glsl */ `
  float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 q) {
    vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 q) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(q); q *= 2.07; a *= 0.5; } return s; }
`;

/** Column of rising fire: scrolling noise up a open cylinder. */
const columnMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { color: { value: new THREE.Color() }, k: { value: 0 }, time: { value: 0 } },
  vertexShader: glowVert,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform float k, time; varying vec2 vUv;
    ${noiseFns}
    void main() {
      float n = fbm(vec2(vUv.x * 7.0, vUv.y * 2.5 - time * 2.6));
      float n2 = fbm(vec2(vUv.x * 13.0 + 3.0, vUv.y * 5.0 - time * 4.0));
      float env = sin(min(1.0, k * 1.4) * 3.14159) * (1.0 - smoothstep(0.55, 1.0, vUv.y + n * 0.3));
      float a = env * smoothstep(0.25, 0.75, n * 0.7 + n2 * 0.5 + (1.0 - vUv.y) * 0.35);
      gl_FragColor = vec4(color * a * 1.4 + vec3(a * a * 0.6), a);
    }
  `,
});

/** Thick expanding band of force for novas and screeches. */
const novaMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { color: { value: new THREE.Color() }, k: { value: 0 }, time: { value: 0 } },
  vertexShader: glowVert,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform float k, time; varying vec2 vUv; varying vec3 vP;
    ${noiseFns}
    void main() {
      // vUv.y runs across the band (inner to outer).
      float a = atan(vP.z, vP.x);
      float n = fbm(vec2(a * 5.0, vUv.y * 3.0 - time * 3.0));
      float band = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
      float alpha = band * (0.55 + n * 0.8) * (1.0 - k) * (1.0 - k);
      gl_FragColor = vec4(color * alpha * 1.6 + vec3(alpha * alpha * 0.5), alpha);
    }
  `,
});

/** Glowing cracks spidering out from an impact, cooling as they fade. */
let crackTex: THREE.CanvasTexture | null = null;
function crackTexture(): THREE.CanvasTexture {
  if (crackTex) return crackTex;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#fff';
  g.shadowColor = '#fff';
  g.shadowBlur = 6;
  g.lineCap = 'round';
  const rng = mulberry32(77);
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    let px = x;
    let py = y;
    const steps = Math.ceil(len / 9);
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(px, py);
    for (let i = 0; i < steps; i++) {
      a += (rng() - 0.5) * 0.6;
      px += Math.cos(a) * 9;
      py += Math.sin(a) * 9;
      g.lineTo(px, py);
      if (depth < 3 && rng() < 0.12) {
        g.stroke();
        branch(px, py, a + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6), len * 0.45 * (1 - i / steps), w * 0.6, depth + 1);
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(px, py);
      }
    }
    g.stroke();
  };
  for (let i = 0; i < 11; i++) branch(size / 2, size / 2, (i / 11) * Math.PI * 2 + rng() * 0.4, size * (0.32 + rng() * 0.16), 5, 0);
  // Ring fracture where the stone gave way.
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = size * (0.13 + rng() * 0.025);
    if (i === 0) g.moveTo(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r);
    else g.lineTo(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r);
  }
  g.stroke();
  crackTex = new THREE.CanvasTexture(c);
  return crackTex;
}

/**
 * Standing flames for auras: the column shader without a life envelope,
 * licking up an open shell forever. One material per colour, sharing the clock.
 */
export function auraMaterial(color: THREE.Color, strength = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { color: { value: color.clone() }, strength: { value: strength }, time: columnMat.uniforms.time },
    vertexShader: glowVert,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float strength, time; varying vec2 vUv;
      ${noiseFns}
      void main() {
        float n = fbm(vec2(vUv.x * 9.0, vUv.y * 2.2 - time * 1.8));
        float n2 = fbm(vec2(vUv.x * 17.0 + 5.0, vUv.y * 4.0 - time * 3.1));
        float env = (1.0 - smoothstep(0.2, 1.0, vUv.y + n * 0.35)) * smoothstep(0.0, 0.12, vUv.y);
        float a = env * smoothstep(0.3, 0.8, n * 0.7 + n2 * 0.5 + (1.0 - vUv.y) * 0.3) * strength;
        gl_FragColor = vec4(color * a, a);
      }
    `,
  });
}

/** Steady shared clock for aura flames even when no boss effect is running. */
export function tickAuras(t: number) {
  columnMat.uniforms.time.value = t;
}

export class BossFx {
  private time = 0;
  constructor(readonly fx: Effects) {}

  /** Advance shared shader clocks. */
  tick(dt: number) {
    // Wall clock, so several users ticking in one frame don't speed it up.
    void dt;
    this.time = performance.now() / 1000;
    columnMat.uniforms.time.value = this.time;
    novaMat.uniforms.time.value = this.time;
  }

  /** Chunks of floor thrown up by a blow, tumbling and bouncing. */
  debris(at: THREE.Vector3, count: number, power = 1, size = 0.18) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(rubbleGeos[i % rubbleGeos.length], rubbleMat);
      const s = size * (0.4 + Math.random());
      m.scale.setScalar(s);
      m.castShadow = true;
      const a = Math.random() * Math.PI * 2;
      const out = (1.5 + Math.random() * 4) * power;
      const v = new THREE.Vector3(Math.cos(a) * out, (3 + Math.random() * 5) * power, Math.sin(a) * out);
      const spin = new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      m.position.copy(at).add(new THREE.Vector3(Math.cos(a) * 0.4, 0.2, Math.sin(a) * 0.4));
      this.fx.group.add(m);
      const life = 1.6 + Math.random() * 0.8;
      this.fx.after(life, m, (k, dt) => {
        v.y -= 16 * dt;
        m.position.addScaledVector(v, dt);
        if (m.position.y < s * 0.5) {
          m.position.y = s * 0.5;
          v.y = Math.abs(v.y) * 0.3;
          v.x *= 0.5;
          v.z *= 0.5;
          spin.multiplyScalar(0.5);
        }
        m.rotation.x += spin.x * dt;
        m.rotation.y += spin.y * dt;
        m.rotation.z += spin.z * dt;
        if (k > 0.75) m.scale.setScalar(s * (1 - (k - 0.75) / 0.25));
      });
    }
    // Grit and dust: drops that fall and settle.
    this.fx.blood(at.clone().setY(at.y + 0.3), at.clone().setY(at.y - 1), Math.round(count * 1.4), new THREE.Color(0.16, 0.12, 0.1), 1.2 * power);
  }

  /** Molten cracks across the floor from an impact. */
  cracks(at: THREE.Vector3, radius: number, color: THREE.Color, life = 3) {
    const mat = new THREE.MeshBasicMaterial({
      map: crackTexture(),
      color: color.clone(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      fog: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), mat);
    m.position.copy(at).setY(at.y + 0.04);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.renderOrder = 3;
    this.fx.group.add(m);
    const base = color.clone();
    this.fx.after(life, m, (k) => {
      // Flash hot, then cool from white through the colour to nothing.
      const heat = k < 0.08 ? 1 + (1 - k / 0.08) * 1.5 : 1;
      const f = Math.pow(1 - k, 1.6);
      mat.color.copy(base).multiplyScalar(heat * f * 1.6);
      m.scale.setScalar(Math.min(1, 0.4 + k * 9));
    }, () => {
      m.geometry.dispose();
      mat.dispose();
    });
  }

  /** Spikes bursting up out of the floor, then sinking back. */
  spikes(at: THREE.Vector3, count: number, radius: number, height: number, mat: THREE.Material = boneMat, hold = 0.6) {
    const g = new THREE.Group();
    g.position.copy(at);
    const list: { m: THREE.Mesh; h: number }[] = [];
    for (let i = 0; i < count; i++) {
      const h = height * (0.55 + Math.random() * 0.6);
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.09 + Math.random() * 0.08, h, 6).translate(0, h / 2, 0), mat);
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      m.position.set(Math.cos(a) * r, -h, Math.sin(a) * r);
      m.rotation.set((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7);
      m.castShadow = true;
      g.add(m);
      list.push({ m, h });
    }
    this.fx.group.add(g);
    const total = 0.14 + hold + 0.5;
    this.fx.after(total, g, (k) => {
      const t = k * total;
      const up = t < 0.14 ? t / 0.14 : t < 0.14 + hold ? 1 : 1 - (t - 0.14 - hold) / 0.5;
      const over = t < 0.14 ? 1 + Math.sin((t / 0.14) * Math.PI) * 0.15 : 1;
      for (const s of list) s.m.position.y = -s.h + s.h * up * over;
    }, () => list.forEach((s) => s.m.geometry.dispose()));
    this.debris(at, Math.max(3, count), 0.6, 0.1);
  }

  /** A pillar of fire roaring up from the floor. */
  column(at: THREE.Vector3, radius: number, height: number, color: THREE.Color, life = 1.2) {
    const mat = columnMat.clone();
    mat.uniforms.color.value.copy(color);
    mat.uniforms.time = columnMat.uniforms.time;
    const geo = new THREE.CylinderGeometry(radius * 0.7, radius, height, 28, 1, true).translate(0, height / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    m.renderOrder = 17;
    this.fx.group.add(m);
    this.fx.after(life, m, (k) => {
      mat.uniforms.k.value = k;
      m.scale.set(0.6 + k * 0.6, 0.3 + Math.min(1, k * 4) * 0.7, 0.6 + k * 0.6);
      m.rotation.y += 0.05;
    }, () => {
      geo.dispose();
      mat.dispose();
    });
  }

  /** A band of force rushing outward from `at` to `radius`. */
  nova(at: THREE.Vector3, radius: number, color: THREE.Color, life = 0.6, height = 0.0, from = 0) {
    const mat = novaMat.clone();
    mat.uniforms.color.value.copy(color);
    mat.uniforms.time = novaMat.uniforms.time;
    // Flat ring on the floor, plus a low wall of force if `height`.
    const geo = new THREE.RingGeometry(0.75, 1, 64, 2).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at).setY(at.y + 0.1);
    m.renderOrder = 17;
    this.fx.group.add(m);
    let wall: THREE.Mesh | null = null;
    if (height > 0) {
      const wg = new THREE.CylinderGeometry(1, 1, height, 64, 1, true).translate(0, height / 2, 0);
      // Remap uv.y to run across the wall's height for the band envelope.
      wall = new THREE.Mesh(wg, mat);
      wall.position.copy(at);
      wall.renderOrder = 17;
      this.fx.group.add(wall);
    }
    this.fx.after(life, m, (k) => {
      mat.uniforms.k.value = k;
      const s = from + (radius - from) * (1 - Math.pow(1 - k, 2.2));
      m.scale.set(s, 1, s);
      if (wall) wall.scale.set(s * 0.92, 1 - k * 0.6, s * 0.92);
    }, () => {
      wall?.removeFromParent();
      wall?.geometry.dispose();
      geo.dispose();
      mat.dispose();
    });
  }

  /** A glowing glob arcing from `from` to `to` over `dur` seconds. */
  lob(from: THREE.Vector3, to: THREE.Vector3, dur: number, color: THREE.Color, size: number, arc: number, onLand: () => void) {
    const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.4), fog: false });
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), mat);
    m.position.copy(from);
    this.fx.group.add(m);
    const p = new THREE.Vector3();
    this.fx.after(dur, m, (k) => {
      p.lerpVectors(from, to, k);
      p.y += Math.sin(k * Math.PI) * arc;
      m.position.copy(p);
      m.rotation.x += 0.3;
      m.scale.set(1 + Math.sin(k * 30) * 0.12, 1 - Math.sin(k * 30) * 0.12, 1);
      if (Math.random() < 0.8) this.fx.mote(p.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.5, -0.3, (Math.random() - 0.5) * 0.5), 0.5, size * 0.9, color, true);
      if (k >= 1) onLand();
    }, () => {
      m.geometry.dispose();
      mat.dispose();
    });
  }

  /** A bolt dropping straight out of the dark onto `at`. */
  fall(at: THREE.Vector3, dur: number, color: THREE.Color, onLand: () => void) {
    const geo = new THREE.CylinderGeometry(0.02, 0.14, 2.4, 8, 1, true).translate(0, 1.2, 0);
    const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 17;
    this.fx.group.add(m);
    const top = 14;
    this.fx.after(dur, m, (k) => {
      m.position.set(at.x, at.y + top * (1 - k * k), at.z);
      if (k >= 1) onLand();
    }, () => {
      geo.dispose();
      mat.dispose();
    });
  }

  /** A pool on the floor that lingers (bile, blood); `alive()` says whether it is still there. */
  pool(at: THREE.Vector3, radius: number, color: THREE.Color, life: number): { pos: THREE.Vector3; radius: number; alive: () => boolean } {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      uniforms: { color: { value: color.clone() }, k: { value: 0 }, time: columnMat.uniforms.time },
      vertexShader: glowVert,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float k, time; varying vec2 vUv;
        ${noiseFns}
        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          float edge = 0.8 + fbm(normalize(c + 1e-4) * 3.0 + 4.0) * 0.25;
          float body = smoothstep(edge, edge - 0.12, r);
          float bub = smoothstep(0.62, 0.8, noise(c * 9.0 + vec2(time * 0.6, -time * 0.4)));
          float life = smoothstep(0.0, 0.08, k) * smoothstep(1.0, 0.8, k);
          float a = body * life * (0.35 + bub * 0.6 + smoothstep(edge - 0.18, edge, r) * 0.5);
          gl_FragColor = vec4(color * a, a);
        }
      `,
    });
    // Draped over the floor so slopes and steps don't cut it off.
    const geo = new THREE.PlaneGeometry(radius * 2.3, radius * 2.3, 16, 16).rotateX(-Math.PI / 2).rotateY(Math.random() * 6);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.fx.height(at.x + pos.getX(i), at.z + pos.getZ(i)) - at.y + 0.06);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    m.renderOrder = 3;
    this.fx.group.add(m);
    let gone = false;
    this.fx.after(life, m, (k) => {
      mat.uniforms.k.value = k;
      if (Math.random() < 0.15) this.fx.mote(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * radius * 1.4, 0.1, (Math.random() - 0.5) * radius * 1.4)), new THREE.Vector3(0, 0.6, 0), 0.8, 0.07, color, true);
    }, () => {
      gone = true;
      m.geometry.dispose();
      mat.dispose();
    });
    return { pos: at.clone(), radius, alive: () => !gone };
  }

  /** Curved streaks of wind sweeping out across a cone (a wing beat). */
  gust(at: THREE.Vector3, yaw: number, radius: number, half: number, color: THREE.Color) {
    for (let i = 0; i < 7; i++) {
      const a = yaw + (i / 6 - 0.5) * half * 2;
      const geo = new THREE.PlaneGeometry(0.22, 2.2).rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: color.clone(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.y = a;
      m.renderOrder = 17;
      this.fx.group.add(m);
      const h = 0.4 + Math.random() * 1.4;
      const delay = Math.random() * 0.12;
      this.fx.after(0.55 + delay, m, (k) => {
        const t = Math.max(0, (k * (0.55 + delay) - delay) / 0.55);
        const d = 1 + t * radius;
        m.position.set(at.x + Math.sin(a) * d, at.y + h, at.z + Math.cos(a) * d);
        m.scale.set(1 + t, 1, 1 + t * 1.5);
        mat.opacity = Math.sin(t * Math.PI) * 0.7;
      }, () => {
        geo.dispose();
        mat.dispose();
      });
    }
    this.fx.blood(at.clone().setY(at.y + 0.2), at.clone().addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), -2), 30, new THREE.Color(0.14, 0.11, 0.1), 2);
  }
}

/** Materials and shaders compiled with the scene so the first cast does not hitch. */
export function prewarmBossFx(scene: THREE.Object3D) {
  const g = new THREE.Group();
  g.position.y = -40;
  for (const mat of [columnMat, novaMat, rubbleMat, boneMat]) g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), mat));
  scene.add(g);
}
