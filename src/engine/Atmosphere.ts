import * as THREE from 'three';
import { mistTexture } from '../procgen/textures';
import { mulberry32, range } from '../procgen/noise';

// Stormy blood-red sky dome and drifting low mist cards.

export class Sky {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float time;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          vec2 uv = d.xz / (abs(d.y) + 0.25) * 1.6;
          vec2 drift = vec2(time * 0.012, time * 0.006);
          float n = fbm(uv + drift + fbm(uv * 0.7 - drift) * 1.5);
          float bright = smoothstep(0.45, 0.85, n);
          vec3 deep = vec3(0.035, 0.006, 0.006);
          vec3 cloud = vec3(0.55, 0.05, 0.03);
          vec3 hot = vec3(1.6, 0.18, 0.08);
          vec3 c = mix(deep, cloud, smoothstep(0.3, 0.7, n));
          c = mix(c, hot, bright * bright * 0.7);
          float horizon = smoothstep(0.35, -0.05, d.y);
          c = mix(c, vec3(0.12, 0.015, 0.012), horizon);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(time: number, cameraPos: THREE.Vector3) {
    this.material.uniforms.time.value = time;
    this.mesh.position.copy(cameraPos);
  }
}

/** Large soft cards lying near the ground, slowly drifting and turning. */
export class Mist {
  readonly group = new THREE.Group();
  private cards: { mesh: THREE.Mesh; vel: THREE.Vector2; spin: number; base: THREE.Vector3 }[] = [];

  constructor(
    private extent: number,
    count = 70,
    color = new THREE.Color(0.3, 0.07, 0.06),
    seed = 9,
  ) {
    const rng = mulberry32(seed);
    const tex = mistTexture(256, seed);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color,
        transparent: true,
        opacity: range(rng, 0.07, 0.16),
        depthWrite: false,
        fog: false,
      });
      const s = range(rng, 6, 14);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s, s), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = rng() * Math.PI * 2;
      const base = new THREE.Vector3(range(rng, -extent, extent), range(rng, 0.3, 1.6), range(rng, -extent, extent));
      mesh.position.copy(base);
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.cards.push({ mesh, vel: new THREE.Vector2(range(rng, 0.2, 0.6), range(rng, -0.15, 0.15)), spin: range(rng, -0.03, 0.03), base });
    }
  }

  update(dt: number) {
    const e = this.extent;
    for (const c of this.cards) {
      c.mesh.position.x += c.vel.x * dt;
      c.mesh.position.z += c.vel.y * dt;
      if (c.mesh.position.x > e) c.mesh.position.x -= 2 * e;
      if (c.mesh.position.z > e) c.mesh.position.z -= 2 * e;
      if (c.mesh.position.z < -e) c.mesh.position.z += 2 * e;
      c.mesh.rotation.z += c.spin * dt;
    }
  }
}
