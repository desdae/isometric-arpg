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
  private cards: { pos: THREE.Vector3; rot: number; size: number; vel: THREE.Vector2; spin: number; lift: number; half: number }[] = [];
  /** All cards in one instanced draw; each card's opacity rides in its instance colour. */
  private mesh: THREE.InstancedMesh;

  constructor(
    private extent: number,
    private heightAt: (x: number, z: number) => number = () => 0,
    count = 70,
    color = new THREE.Color(0.3, 0.07, 0.06),
    seed = 9,
  ) {
    const rng = mulberry32(seed);
    const tex = mistTexture(256, seed);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false, fog: false });
    // The instance colour scales alpha instead of tinting.
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#ifdef USE_COLOR\n\tdiffuseColor.a *= vColor.r;\n#endif');
    };
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, count);
    this.mesh.renderOrder = 10;
    // Cards drift over the whole area; it is one draw either way.
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    const opacity = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = range(rng, 0.07, 0.16);
      this.mesh.setColorAt(i, opacity.setRGB(a, a, a));
      const s = range(rng, 6, 14);
      const rot = rng() * Math.PI * 2;
      const pos = new THREE.Vector3(range(rng, -extent, extent), 0, range(rng, -extent, extent));
      this.cards.push({ pos, rot, size: s, vel: new THREE.Vector2(range(rng, 0.2, 0.6), range(rng, -0.15, 0.15)), spin: range(rng, -0.03, 0.03), lift: range(rng, 0.3, 1.4), half: s / 2 });
      this.place(i);
    }
  }

  // Ground heights on a 2 m grid, filled in as cards drift over it: the
  // terrain functions are noise sums, too slow to call 600 times a frame.
  private cells = new Map<number, number>();
  private cell(i: number, j: number) {
    const key = i * 4096 + j;
    let v = this.cells.get(key);
    if (v === undefined) this.cells.set(key, (v = this.heightAt(i * 2, j * 2)));
    return v;
  }
  /** Highest grid corner around a point: never below the ground it covers. */
  private ground(x: number, z: number) {
    const i = Math.floor(x / 2);
    const j = Math.floor(z / 2);
    return Math.max(this.cell(i, j), this.cell(i + 1, j), this.cell(i, j + 1), this.cell(i + 1, j + 1));
  }

  update(dt: number) {
    const e = this.extent;
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      const p = c.pos;
      p.x += c.vel.x * dt;
      p.z += c.vel.y * dt;
      if (p.x > e) p.x -= 2 * e;
      if (p.z > e) p.z -= 2 * e;
      if (p.z < -e) p.z += 2 * e;
      c.rot += c.spin * dt;
      // Ride above the highest ground under the card so it never slices into
      // the terrain (which shows as hard, drifting lines).
      const h = c.half;
      const top = Math.max(
        this.ground(p.x, p.z),
        this.ground(p.x - h, p.z - h),
        this.ground(p.x + h, p.z - h),
        this.ground(p.x - h, p.z + h),
        this.ground(p.x + h, p.z + h),
        this.ground(p.x - h, p.z),
        this.ground(p.x + h, p.z),
        this.ground(p.x, p.z - h),
        this.ground(p.x, p.z + h),
      );
      p.y = p.y === 0 ? top + c.lift : p.y + (top + c.lift - p.y) * Math.min(1, dt * 2);
      this.place(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private static q = new THREE.Quaternion();
  private static m = new THREE.Matrix4();
  private static s = new THREE.Vector3();
  private static up = new THREE.Vector3(0, 1, 0);
  private place(i: number) {
    const c = this.cards[i];
    Mist.q.setFromAxisAngle(Mist.up, c.rot);
    this.mesh.setMatrixAt(i, Mist.m.compose(c.pos, Mist.q, Mist.s.set(c.size, 1, c.size)));
  }
}
