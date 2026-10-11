import * as THREE from 'three';

// Humanoid joint rig with a procedural gait (no keyframes). Outfits (knight,
// villager, ...) hang generated meshes on the joints; the rig only moves them.

type V2 = [number, number];
export const lathe = (pts: V2[], seg = 16) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function joint(parent: THREE.Object3D, x: number, y: number, z: number) {
  const j = new THREE.Object3D();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

export interface Limb {
  side: number; // -1 left, +1 right
}
export interface Arm extends Limb {
  shoulder: THREE.Object3D;
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  /** Rest pose (radians about X) for the upper arm and forearm. */
  restUpper: number;
  restFore: number;
  /** How much the arm swings while walking. */
  swing: number;
}
export interface Leg extends Limb {
  thigh: THREE.Object3D;
  shin: THREE.Object3D;
  foot: THREE.Object3D;
}

export interface RigOptions {
  /** Overall scale; 1 is about 1.85 m tall. */
  scale?: number;
  /** Forward stoop of the upper body in radians (old or weary folk). */
  hunch?: number;
  /** Walk cycle length in metres at scale 1. */
  stride?: number;
}

export type UpdateHook = (dt: number, walk: number, time: number) => void;

export class Character {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly hips: THREE.Object3D;
  readonly spine: THREE.Object3D;
  readonly chest: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly arms: Arm[] = [];
  readonly legs: Leg[] = [];
  /** Per-frame callbacks registered by outfits (capes, robes...). */
  readonly hooks: UpdateHook[] = [];
  readonly hipHeight = 0.98;
  private hunch: number;
  private stride: number;
  private phase = Math.random() * 10;
  private walk = 0;
  private time = Math.random() * 10;
  /** Head turn toward a point of interest, set by behaviours. */
  lookYaw = 0;

  constructor(opts: RigOptions = {}) {
    const s = opts.scale ?? 1;
    this.hunch = opts.hunch ?? 0;
    this.stride = (opts.stride ?? 1.5) * s;
    this.body.scale.setScalar(s);
    this.root.add(this.body);
    this.hips = joint(this.body, 0, this.hipHeight, 0);
    this.spine = joint(this.hips, 0, 0.1, 0);
    this.chest = joint(this.spine, 0, 0.2, 0);
    this.head = joint(this.chest, 0, 0.38, 0);
    for (const side of [-1, 1]) {
      const shoulder = joint(this.chest, side * 0.25, 0.2, 0);
      const upper = joint(shoulder, 0, 0, 0);
      upper.rotation.z = side * 0.12;
      const fore = joint(upper, 0, -0.29, 0);
      const hand = joint(fore, 0, -0.32, 0);
      this.arms.push({ side, shoulder, upper, fore, hand, restUpper: -0.05, restFore: -0.3, swing: 0.35 });
    }
    for (const side of [-1, 1]) {
      const thigh = joint(this.hips, side * 0.115, -0.05, 0);
      const shin = joint(thigh, 0, -0.44, 0);
      const foot = joint(shin, 0, -0.44, 0);
      this.legs.push({ side, thigh, shin, foot });
    }
  }

  arm(side: number) {
    return this.arms.find((a) => a.side === side)!;
  }
  leg(side: number) {
    return this.legs.find((l) => l.side === side)!;
  }

  /** Advance the procedural animation. `speed` is ground speed in m/s. */
  update(dt: number, speed: number) {
    this.time += dt;
    this.phase += (speed / this.stride) * Math.PI * 2 * dt;
    const target = THREE.MathUtils.clamp(speed / 4.2, 0, 1);
    this.walk += (target - this.walk) * (1 - Math.exp(-dt * 10));
    const w = this.walk;
    const ph = this.phase;
    const breathe = Math.sin(this.time * 1.8);

    this.hips.position.y = this.hipHeight - 0.035 * w * (0.5 + 0.5 * Math.cos(ph * 2)) - 0.015 * (1 - w);
    this.hips.rotation.y = Math.sin(ph) * 0.12 * w;
    this.hips.rotation.z = Math.cos(ph) * 0.04 * w;
    this.spine.rotation.x = 0.12 * w + 0.01 * breathe * (1 - w) + this.hunch * 0.6;
    this.spine.rotation.y = -Math.sin(ph) * 0.18 * w;
    this.chest.rotation.x = this.hunch * 0.4;
    this.chest.scale.setScalar(1 + 0.008 * breathe * (1 - w));
    const idleLook = Math.sin(this.time * 0.4) * 0.15 * (1 - w);
    this.head.rotation.y += (this.lookYaw + Math.sin(ph) * 0.06 * w + idleLook - this.head.rotation.y) * (1 - Math.exp(-dt * 5));
    this.head.rotation.x = -0.08 * w - this.hunch * 0.7;

    for (const leg of this.legs) {
      const lp = ph + (leg.side === 1 ? Math.PI : 0);
      const swing = Math.sin(lp);
      const knee = Math.max(0, Math.cos(lp)) * 1.05 + 0.12;
      // Idle: slightly bent knees, weight shifted to one leg.
      const idleBend = (leg.side === 1 ? 0.12 : 0.04) + this.hunch * 0.3;
      leg.thigh.rotation.x = -swing * 0.55 * w - idleBend * 0.5 * (1 - w);
      leg.shin.rotation.x = knee * w + idleBend * (1 - w);
      leg.foot.rotation.x = -(leg.thigh.rotation.x + leg.shin.rotation.x) * 0.7 + Math.max(0, -Math.cos(lp)) * 0.25 * w;
      leg.thigh.rotation.z = leg.side * 0.03;
    }
    for (const arm of this.arms) {
      const ap = ph + (arm.side === 1 ? 0 : Math.PI);
      arm.upper.rotation.x = Math.sin(ap) * arm.swing * w + 0.03 * breathe * (1 - w) + arm.restUpper;
      arm.fore.rotation.x = -Math.max(0, Math.sin(ap)) * 0.35 * w + arm.restFore;
    }
    for (const hook of this.hooks) hook(dt, w, this.time);
  }
}

/**
 * A cloth sheet hanging from `parent` that sweeps back and ripples with
 * motion. Used for capes and robe tails.
 */
export function clothPanel(
  c: Character,
  parent: THREE.Object3D,
  mat: THREE.Material,
  width: number,
  length: number,
  pos: THREE.Vector3,
  opts: { flare?: number; wrap?: number; sweep?: number } = {},
): THREE.Mesh {
  const flare = opts.flare ?? 0.45;
  const wrap = opts.wrap ?? 0.06;
  const sweep = opts.sweep ?? 0.55;
  const geo = new THREE.PlaneGeometry(width, length, 8, 14);
  geo.translate(0, -length / 2, 0);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    p.setX(i, x * (1 + (-y / length) * flare));
    p.setZ(i, -Math.cos((x / (width / 2)) * 0.9) * wrap * (1 + y / length));
  }
  geo.computeVertexNormals();
  const rest = (p.array as Float32Array).slice();
  const m = mesh(geo, mat, parent, pos.x, pos.y, pos.z);
  c.hooks.push((_dt, w, time) => {
    for (let i = 0; i < p.count; i++) {
      const x = rest[i * 3];
      const y = rest[i * 3 + 1];
      const z = rest[i * 3 + 2];
      const t = -y / length; // 0 at the top edge, 1 at the hem
      const lift = t * t * (sweep * w + 0.06);
      const ripple = Math.sin(time * (3 + 5 * w) - t * 5 + x * 4) * 0.05 * t * (0.3 + w);
      p.setXYZ(i, x, y + lift * 0.35, z - lift - ripple - t * 0.05);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
  });
  return m;
}
