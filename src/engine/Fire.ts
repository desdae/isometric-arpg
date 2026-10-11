import * as THREE from 'three';
import { perlin2 } from '../procgen/noise';

// Procedural fire: camera-facing flame cards shaded with scrolling noise,
// rising embers animated entirely on the GPU, and a flickering point light.

const flameMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false,
  uniforms: { time: { value: 0 } },
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
      vec3 hot = vec3(2.2, 1.25, 0.45);
      vec3 mid = vec3(1.5, 0.42, 0.08);
      vec3 cool = vec3(0.45, 0.05, 0.015);
      float heat = clamp(a * 1.6 - uv.y * 0.5, 0.0, 1.0);
      vec3 col = mix(cool, mid, smoothstep(0.0, 0.5, heat));
      col = mix(col, hot, smoothstep(0.5, 1.0, heat));
      gl_FragColor = vec4(col * a * 0.7, a);
    }
  `,
});

const emberMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false,
  uniforms: { time: { value: 0 }, pixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
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
    varying float vLife;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife);
      gl_FragColor = vec4(vec3(3.0, 0.9, 0.2) * a, a);
    }
  `,
});

export class Fire {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  private baseIntensity: number;
  private phase = Math.random() * 100;

  constructor(size = 1, lightIntensity = 40, lightRange = 12) {
    const cards = 3;
    for (let i = 0; i < cards; i++) {
      const geo = new THREE.PlaneGeometry(0.9, 1.6);
      geo.translate(0, 0.8, 0);
      geo.setAttribute('seed', new THREE.Float32BufferAttribute(new Array(4).fill(Math.random()), 1));
      const card = new THREE.Mesh(geo, flameMaterial);
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
    const embers = new THREE.Points(eg, emberMaterial);
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
    emberMaterial.uniforms.time.value = t;
  }
}
