import * as THREE from 'three';
import { perlin2 } from '../procgen/noise';

// Procedural fire: camera-facing flame cards shaded with scrolling noise,
// rising embers animated entirely on the GPU, and a flickering point light.

const flameMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false,
  uniforms: { time: { value: 0 }, hot: { value: new THREE.Vector3(2.2, 1.25, 0.45) }, mid: { value: new THREE.Vector3(1.5, 0.42, 0.08) }, cool: { value: new THREE.Vector3(0.45, 0.05, 0.015) } },
  vertexShader: /* glsl */ `
    attribute float seed;
    varying vec2 vUv;
    varying float vSeed;
    void main() {
      vUv = uv;
      vSeed = seed;
      // Cylindrical billboard: keep the card upright, turn it to the camera.
      vec3 center = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      vec3 toCam = cameraPosition - center;
      toCam.y = 0.0;
      vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
      float sx = length(modelMatrix[0].xyz);
      float sy = length(modelMatrix[1].xyz);
      vec3 world = center + right * position.x * sx + vec3(0.0, position.y * sy, 0.0);
      gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float time;
    uniform vec3 hot, mid, cool;
    varying vec2 vUv;
    varying float vSeed;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.1; a *= 0.5; } return s; }
    void main() {
      vec2 uv = vUv;
      float t = time * 1.6 + vSeed * 10.0;
      float n = fbm(vec2(uv.x * 3.0 + vSeed * 7.0, uv.y * 2.5 - t * 1.4));
      float n2 = fbm(vec2(uv.x * 6.0 - vSeed * 3.0, uv.y * 5.0 - t * 2.3));
      // Teardrop envelope, narrowing towards the top.
      float width = mix(0.3, 0.02, pow(uv.y, 0.7));
      float dx = abs(uv.x - 0.5 + (n - 0.5) * 0.25 * uv.y);
      float body = smoothstep(width, width * 0.3, dx);
      float heightFade = smoothstep(1.0, 0.25, uv.y + (n2 - 0.5) * 0.45);
      float base = smoothstep(0.0, 0.08, uv.y);
      float a = body * heightFade * base;
      a *= smoothstep(0.15, 0.55, n * 0.6 + n2 * 0.6 + (1.0 - uv.y) * 0.4);
      float heat = clamp(a * 1.6 - uv.y * 0.5, 0.0, 1.0);
      vec3 col = mix(cool, mid, smoothstep(0.0, 0.5, heat));
      col = mix(col, hot, smoothstep(0.5, 1.0, heat));
      gl_FragColor = vec4(col * a * 0.7, a);
    }
  `,
});

/** Witch-fire for the Hollow King's vault: violet flames over a cold white core. */
const ghostFlameMaterial = flameMaterial.clone();
ghostFlameMaterial.uniforms.hot.value.set(1.6, 1.2, 2.4);
ghostFlameMaterial.uniforms.mid.value.set(0.75, 0.16, 1.5);
ghostFlameMaterial.uniforms.cool.value.set(0.16, 0.02, 0.4);

const emberMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false,
  uniforms: { time: { value: 0 }, pixelRatio: { value: Math.min(window.devicePixelRatio, 2) }, tint: { value: new THREE.Vector3(3.0, 0.9, 0.2) } },
  vertexShader: /* glsl */ `
    uniform float time, pixelRatio;
    attribute vec3 rnd;
    varying float vLife;
    void main() {
      float life = fract(time * (0.25 + rnd.x * 0.35) + rnd.y);
      vLife = life;
      vec3 p = position;
      p.y += life * (2.5 + rnd.z * 2.0);
      p.x += sin(life * 6.0 + rnd.y * 20.0) * 0.35 * life;
      p.z += cos(life * 5.0 + rnd.x * 20.0) * 0.35 * life;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = (1.0 - life) * (2.0 + rnd.z * 3.0) * pixelRatio * (40.0 / -mv.z);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 tint;
    varying float vLife;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife);
      gl_FragColor = vec4(tint * a, a);
    }
  `,
});

const ghostEmberMaterial = emberMaterial.clone();
ghostEmberMaterial.uniforms.tint.value.set(1.6, 0.5, 3.0);

// Smoke: soft dark puffs that rise from smouldering ruins, swell, drift
// downwind and thin out. Each point's whole life is computed from time in the
// shader, so a column costs nothing on the CPU.
const smokeMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  fog: false,
  uniforms: { time: { value: 0 }, pixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
  vertexShader: /* glsl */ `
    uniform float time, pixelRatio;
    attribute vec4 rnd;
    attribute float height;
    varying float vLife;
    varying float vSeed;
    varying float vRot;
    void main() {
      float life = fract(time * (0.045 + rnd.x * 0.03) + rnd.y);
      vLife = life;
      vSeed = rnd.z;
      vRot = rnd.w * 6.283 + life * (rnd.z - 0.5) * 2.0;
      vec3 p = position;
      float h = height * (0.5 + rnd.z * 0.5);
      p.y += pow(life, 0.8) * h;
      // Wind leans the column, with a slow meander.
      p.x += life * life * h * 0.55 + sin(life * 4.0 + rnd.w * 9.0) * 0.6 * life;
      p.z += life * life * h * 0.2 + cos(life * 3.0 + rnd.x * 9.0) * 0.6 * life;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float size = 2.0 + life * (6.5 + rnd.w * 3.0);
      gl_PointSize = size * pixelRatio * (520.0 / -mv.z);
    }
  `,
  fragmentShader: /* glsl */ `
    varying float vLife;
    varying float vSeed;
    varying float vRot;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
    }
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float cs = cos(vRot), sn = sin(vRot);
      c = mat2(cs, -sn, sn, cs) * c;
      float n = vnoise(c * 5.0 + vSeed * 17.0) * 0.6 + vnoise(c * 11.0 - vSeed * 9.0) * 0.4;
      float d = length(c) + (n - 0.5) * 0.35;
      float a = smoothstep(0.5, 0.1, d);
      // Fade in quickly near the embers, thin out as it climbs.
      a *= smoothstep(0.0, 0.08, vLife) * pow(1.0 - vLife, 1.4) * 0.8;
      if (a < 0.004) discard;
      // Ember glow lights the base of the column from below.
      vec3 col = mix(vec3(0.75, 0.22, 0.08), vec3(0.17, 0.14, 0.135), smoothstep(0.0, 0.18, vLife));
      gl_FragColor = vec4(col * (0.8 + n * 0.4), a);
    }
  `,
});

export class Smoke {
  readonly points: THREE.Points;
  /** Column of `count` puffs from a w x d patch, rising roughly `height` metres. */
  constructor(w: number, d: number, height = 12, count = 40) {
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count * 4);
    const hgt = new Float32Array(count).fill(height);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * w;
      pos[i * 3 + 1] = 0.3;
      pos[i * 3 + 2] = (Math.random() - 0.5) * d;
      for (let k = 0; k < 4; k++) rnd[i * 4 + k] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 4));
    g.setAttribute('height', new THREE.BufferAttribute(hgt, 1));
    this.points = new THREE.Points(g, smokeMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 22;
  }
}

export class Fire {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  private baseIntensity: number;
  private phase = Math.random() * 100;

  constructor(size = 1, lightIntensity = 40, lightRange = 12, ghost = false) {
    const cards = 3;
    for (let i = 0; i < cards; i++) {
      const geo = new THREE.PlaneGeometry(0.9, 1.6);
      geo.translate(0, 0.8, 0);
      geo.setAttribute('seed', new THREE.Float32BufferAttribute(new Array(4).fill(Math.random()), 1));
      const card = new THREE.Mesh(geo, ghost ? ghostFlameMaterial : flameMaterial);
      card.scale.set(size * (1 - i * 0.18), size * (1 - i * 0.12), 1);
      card.position.set((i - 1) * 0.08 * size, 0, (i % 2) * 0.05 * size);
      card.renderOrder = 20;
      card.frustumCulled = false;
      this.group.add(card);
    }

    const count = 24;
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 0.4 * size;
      pos[i * 3 + 1] = 0.3 * size;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.4 * size;
      rnd[i * 3] = Math.random();
      rnd[i * 3 + 1] = Math.random();
      rnd[i * 3 + 2] = Math.random();
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    eg.setAttribute('rnd', new THREE.BufferAttribute(rnd, 3));
    const embers = new THREE.Points(eg, ghost ? ghostEmberMaterial : emberMaterial);
    embers.frustumCulled = false;
    embers.renderOrder = 21;
    this.group.add(embers);

    this.baseIntensity = lightIntensity;
    this.light = new THREE.PointLight(0xff7a2a, lightIntensity, lightRange, 2);
    this.light.position.y = 0.7 * size;
    this.group.add(this.light);
  }

  update(t: number) {
    const f = 0.78 + 0.22 * perlin2(t * 7 + this.phase, this.phase) + 0.1 * perlin2(t * 19, this.phase * 3);
    this.light.intensity = this.baseIntensity * f;
  }

  /** Advance the shared shader clocks once per frame. */
  static tick(t: number) {
    flameMaterial.uniforms.time.value = t;
    ghostFlameMaterial.uniforms.time.value = t;
    emberMaterial.uniforms.time.value = t;
    ghostEmberMaterial.uniforms.time.value = t;
    smokeMaterial.uniforms.time.value = t;
  }
}
