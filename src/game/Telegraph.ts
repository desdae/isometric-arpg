import * as THREE from 'three';
import type { Effects } from './Effects';

// Ground telegraphs: the glowing outline a boss paints on the floor before a
// blow lands there. A dim field marks the danger zone, a bright rim traces
// its edge, and a hot front sweeps across it as the wind-up runs out, so the
// player can read both where and when. On firing it flares white and fades.

export type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'ring'; r0: number; r1: number }
  | { kind: 'cone'; r: number; half: number }
  | { kind: 'rect'; len: number; w: number };

const KIND_ID = { circle: 0, ring: 1, cone: 2, rect: 3 } as const;

const material = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -4,
  polygonOffsetUnits: -4,
  uniforms: {
    color: { value: new THREE.Color() },
    fill: { value: 0 },
    flash: { value: 0 },
    fade: { value: 1 },
    time: { value: 0 },
    kind: { value: 0 },
    p: { value: new THREE.Vector4() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vP;
    void main() {
      vP = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float fill, flash, fade, time;
    uniform int kind;
    uniform vec4 p;
    varying vec2 vP;
    float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 q) {
      vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    void main() {
      float r = length(vP);
      float sd;      // signed distance to the edge, negative inside (metres)
      float prog;    // 0..1 coordinate the warning front sweeps along
      if (kind == 0) {
        sd = r - p.x;
        prog = r / p.x;
      } else if (kind == 1) {
        sd = max(p.x - r, r - p.y);
        prog = (r - p.x) / (p.y - p.x);
      } else if (kind == 2) {
        float a = abs(atan(vP.x, vP.y));
        float side = (a - p.y) * r; // metres off the cone's flank
        sd = max(r - p.x, side);
        if (vP.y < 0.0 && a > 1.5708) sd = max(sd, r);
        prog = r / p.x;
      } else {
        sd = max(abs(vP.x) - p.y * 0.5, max(-vP.y, vP.y - p.x));
        prog = vP.y / p.x;
      }
      if (sd > 0.12) discard;
      float inside = 1.0 - smoothstep(-0.02, 0.03, sd);
      // Bright rim, slightly ragged so it reads as burning rather than drawn.
      float jag = noise(vec2(atan(vP.x, vP.y) * 6.0, time * 2.0)) * 0.03;
      float rim = smoothstep(0.11, 0.0, abs(sd + 0.05 + jag)) * (0.8 + 0.2 * sin(time * 14.0));
      // Faint field with slow crawling veins.
      float veins = noise(vP * 2.2 + vec2(time * 0.4, -time * 0.3));
      veins = smoothstep(0.55, 0.85, veins) * 0.35;
      float field = (0.13 + veins) * inside;
      // The filled share glows hotter, with a white-hot front at its edge.
      float filled = step(prog, fill) * inside;
      float front = smoothstep(0.07, 0.0, abs(prog - fill)) * inside * step(0.001, fill) * step(fill, 0.999);
      float pulse = 0.85 + 0.15 * sin(time * 9.0 - prog * 12.0);
      vec3 col = color * (field + filled * 0.42 * pulse + rim * 1.2) + vec3(1.0, 0.85, 0.7) * front * 0.9;
      col += (color * 2.0 + vec3(1.2)) * flash * inside;
      col *= fade;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

export class Telegraph {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private t = 0;
  private fired = false;
  private holder = new THREE.Object3D();
  done = false;

  constructor(
    private fx: Effects,
    readonly shape: Shape,
    readonly origin: THREE.Vector3,
    public yaw: number,
    readonly duration: number,
    color: THREE.ColorRepresentation,
  ) {
    const ext = shape.kind === 'circle' ? shape.r : shape.kind === 'ring' ? shape.r1 : shape.kind === 'cone' ? shape.r : 0;
    let geo: THREE.BufferGeometry;
    if (shape.kind === 'rect') geo = new THREE.PlaneGeometry(shape.w + 0.3, shape.len + 0.3).rotateX(-Math.PI / 2).translate(0, 0, shape.len / 2);
    else geo = new THREE.PlaneGeometry(ext * 2 + 0.3, ext * 2 + 0.3).rotateX(-Math.PI / 2);
    this.mat = material.clone();
    const u = this.mat.uniforms;
    u.color.value.set(color);
    u.kind.value = KIND_ID[shape.kind];
    if (shape.kind === 'circle') u.p.value.set(shape.r, 0, 0, 0);
    if (shape.kind === 'ring') u.p.value.set(shape.r0, shape.r1, 0, 0);
    if (shape.kind === 'cone') u.p.value.set(shape.r, shape.half, 0, 0);
    if (shape.kind === 'rect') u.p.value.set(shape.len, shape.w, 0, 0);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.place();
    fx.group.add(this.mesh);
    fx.after(1e6, this.holder, (_k, dt) => this.tick(dt));
  }

  /** Moves the telegraph (one that tracks the hero until it locks). */
  moveTo(p: THREE.Vector3, yaw = this.yaw) {
    this.origin.copy(p);
    this.yaw = yaw;
    this.place();
  }

  private place() {
    this.mesh.position.set(this.origin.x, this.origin.y + 0.05, this.origin.z);
    this.mesh.rotation.y = this.yaw;
  }

  private tick(dt: number): boolean {
    if (this.done) return true;
    this.t += dt;
    const u = this.mat.uniforms;
    u.time.value += dt;
    if (!this.fired) {
      u.fill.value = Math.min(1, this.t / this.duration);
      u.fade.value = Math.min(1, this.t / 0.15);
    } else {
      const k = this.t / 0.45;
      u.flash.value = Math.max(0, 1 - k * 2.2);
      u.fade.value = Math.max(0, 1 - k);
      if (k >= 1) this.cancel();
    }
    return this.done;
  }

  /** True when a body of radius `pr` at `pos` stands in the danger zone. */
  hits(pos: THREE.Vector3, pr = 0.4): boolean {
    const dx = pos.x - this.origin.x;
    const dz = pos.z - this.origin.z;
    // Into the shape's frame: +Z along yaw.
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const r = Math.hypot(lx, lz);
    const sh = this.shape;
    if (sh.kind === 'circle') return r < sh.r + pr * 0.6;
    if (sh.kind === 'ring') return r > sh.r0 - pr * 0.6 && r < sh.r1 + pr * 0.6;
    if (sh.kind === 'cone') return r < sh.r + pr * 0.6 && (r < pr || Math.abs(Math.atan2(lx, lz)) < sh.half + Math.atan2(pr * 0.6, Math.max(r, 0.01)));
    return lz > -pr && lz < sh.len + pr * 0.6 && Math.abs(lx) < sh.w / 2 + pr * 0.6;
  }

  /** The blow lands: flare and fade. */
  fire() {
    if (this.fired) return;
    this.fired = true;
    this.t = 0;
    this.mat.uniforms.fill.value = 1;
  }

  /** Gone at once (the caster died mid-cast). */
  cancel() {
    if (this.done) return;
    this.done = true;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.dispose();
    void this.fx;
  }
}

/** A hidden telegraph so its shader is compiled with the scene, not on the first cast. */
export function prewarmTelegraph(scene: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1).rotateX(-Math.PI / 2), material);
  m.position.y = -40;
  scene.add(m);
}
