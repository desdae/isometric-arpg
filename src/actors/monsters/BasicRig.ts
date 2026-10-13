import * as THREE from 'three';
import type { Rig } from '../Rig';

/**
 * The shared plumbing of a hand-animated monster rig: a root and a scaled
 * body, one timed action at a time, and a per-frame `animate` the subclass
 * fills in with its idle, walk and breathing motion.
 */
export abstract class BasicRig implements Rig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  lookYaw = 0;
  onStep: (() => void) | null = null;
  protected time = Math.random() * 10;
  /** Walk cycle phase, advanced by speed. */
  protected phase = Math.random() * 10;
  /** 0 standing, 1 at full stride (smoothed). */
  protected walk = 0;
  private action: { t: number; dur: number; fn: (k: number) => void; done?: () => void } | null = null;

  constructor(scale: number, private stride: number, private fullSpeed: number) {
    this.body.scale.setScalar(scale);
    this.root.add(this.body);
  }

  protected abstract animate(dt: number): void;

  update(dt: number, speed: number) {
    this.time += dt;
    const before = this.phase;
    this.phase += speed * dt * this.stride;
    // A footfall twice per cycle.
    if (this.onStep && Math.floor(before / Math.PI) !== Math.floor(this.phase / Math.PI) && speed > 0.5) this.onStep();
    const target = THREE.MathUtils.clamp(speed / this.fullSpeed, 0, 1);
    this.walk += (target - this.walk) * (1 - Math.exp(-dt * 8));
    this.animate(dt);
    if (this.action) {
      const a = this.action;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.fn(k);
      if (k >= 1 && this.action === a) {
        this.action = null;
        a.done?.();
      }
    }
  }

  play(dur: number, fn: (k: number) => void, done?: () => void) {
    this.action = { t: 0, dur, fn, done };
  }
  get acting() {
    return this.action !== null;
  }
  cancelAction() {
    this.action = null;
  }
}

/** 0 → 1 → 0 over k in [a, b]. */
export const hump = (k: number, a: number, b: number) => (k <= a || k >= b ? 0 : Math.sin(((k - a) / (b - a)) * Math.PI));
/** 0 → 1 over k in [a, b], eased. */
export const ease = (k: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (k - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A ring of cone teeth along an arc, pointing along `dir` (local), for a jaw. */
export function teethArc(rx: number, rz: number, from: number, to: number, n: number, len: number, up: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = from + ((to - from) * (i + 0.5)) / n;
    const l = len * (0.6 + 0.4 * Math.abs(Math.sin(i * 2.3)) ) * (1 - 0.35 * Math.abs(Math.sin(a)));
    const g = new THREE.ConeGeometry(l * 0.28, l, 4);
    if (up < 0) g.rotateX(Math.PI);
    g.translate(Math.sin(a) * rx, (up * l) / 2, Math.cos(a) * rz);
    out.push(g);
  }
  return out;
}
