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
  private cards: { mesh: THREE.Mesh; vel: THREE.Vector2; spin: number; lift: number; half: number }[] = [];

  constructor(
    private extent: number,
    private heightAt: (x: number, z: number) => number = () => 0,
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
      mesh.position.set(range(rng, -extent, extent), 0, range(rng, -extent, extent));
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.cards.push({ mesh, vel: new THREE.Vector2(range(rng, 0.2, 0.6), range(rng, -0.15, 0.15)), spin: range(rng, -0.03, 0.03), lift: range(rng, 0.3, 1.4), half: s / 2 });
    }
  }

  update(dt: number) {
    const e = this.extent;
    for (const c of this.cards) {
      const p = c.mesh.position;
      p.x += c.vel.x * dt;
      p.z += c.vel.y * dt;
      if (p.x > e) p.x -= 2 * e;
      if (p.z > e) p.z -= 2 * e;
      if (p.z < -e) p.z += 2 * e;
      c.mesh.rotation.z += c.spin * dt;
      // Ride above the highest ground under the card so it never slices into
      // the terrain (which shows as hard, drifting lines).
      const h = c.half;
      const top = Math.max(
        this.heightAt(p.x, p.z),
        this.heightAt(p.x - h, p.z - h),
        this.heightAt(p.x + h, p.z - h),
        this.heightAt(p.x - h, p.z + h),
        this.heightAt(p.x + h, p.z + h),
        this.heightAt(p.x - h, p.z),
        this.heightAt(p.x + h, p.z),
        this.heightAt(p.x, p.z - h),
        this.heightAt(p.x, p.z + h),
      );
      p.y = p.y === 0 ? top + c.lift : p.y + (top + c.lift - p.y) * Math.min(1, dt * 2);
    }
  }
}
