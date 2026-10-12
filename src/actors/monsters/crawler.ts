import * as THREE from 'three';
import { joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import type { Rig } from '../Rig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Blood crawler: a dog-sized spider with a bloated, red-banded abdomen,
// four glowing eyes and hooked mandibles. Eight three-part legs walk an
// alternating-tetrapod gait; nothing is keyframed.

interface SpiderLeg {
  side: number;
  index: number;
  yaw: number;
  base: THREE.Object3D;
  femur: THREE.Object3D;
  tibia: THREE.Object3D;
  tarsus: THREE.Object3D;
  phase: number;
}

const FEMUR = 0.42;
const TIBIA = 0.5;
const TARSUS = 0.32;
const FEMUR_UP = 0.85;
const TIBIA_DOWN = -1.75;
const TARSUS_DOWN = -0.55;

/** Tapered segment along local +X. */
function segment(len: number, r0: number, r1: number) {
  return new THREE.CylinderGeometry(r1, r0, len, 6).rotateZ(-Math.PI / 2).translate(len / 2, 0, 0);
}

class Crawler implements Rig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly thorax: THREE.Object3D;
  readonly abdomen: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly mandibles: THREE.Object3D[] = [];
  readonly legs: SpiderLeg[] = [];
  lookYaw = 0;
  private phase = Math.random() * 10;
  private time = Math.random() * 10;
  private walk = 0;
  private action: { t: number; dur: number; fn: (k: number) => void; done?: () => void } | null = null;
  readonly rideHeight = 0.42;

  constructor(m: MonsterMaterials, scale: number, tomb = false) {
    // Tomb spiders are armoured all in black; only their eyes burn.
    const accent = tomb ? m.chitin : m.chitinRed;
    this.body.scale.setScalar(scale);
    this.root.add(this.body);
    this.thorax = joint(this.body, 0, this.rideHeight, 0);
    mesh(new THREE.SphereGeometry(0.2, 14, 10).scale(1, 0.62, 1.15), m.chitin, this.thorax);
    mesh(new THREE.SphereGeometry(0.12, 10, 8).scale(1.1, 0.5, 1.2), accent, this.thorax, 0, 0.09, -0.02);
    // Abdomen hangs off the back and sways.
    this.abdomen = joint(this.thorax, 0, 0.06, -0.2);
    mesh(new THREE.SphereGeometry(0.34, 16, 12).scale(1, 0.85, 1.25).translate(0, 0.08, -0.36), m.chitin, this.abdomen);
    for (let i = 0; i < 3; i++) {
      mesh(new THREE.TorusGeometry(0.27 - i * 0.05, 0.03, 5, 20).rotateY(Math.PI / 2).rotateZ(Math.PI / 2).scale(1, 0.85, 1), accent, this.abdomen, 0, 0.12, -0.26 - i * 0.16);
    }
    for (let i = 0; i < 14; i++) {
      // Bristles.
      const a = Math.random() * Math.PI;
      mesh(new THREE.ConeGeometry(0.008, 0.08, 3).rotateX(-0.5), m.chitin, this.abdomen, Math.cos(a) * 0.28, 0.12 + Math.sin(a) * 0.24, -0.36 + (Math.random() - 0.5) * 0.5);
    }
    if (tomb) {
      // Ridged armour plates and spines down the abdomen.
      for (let i = 0; i < 5; i++) {
        mesh(new THREE.SphereGeometry(0.2 - i * 0.025, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.05, 0.45, 0.6), m.chitin, this.abdomen, 0, 0.2 + Math.sin((i / 4) * Math.PI) * 0.1, -0.12 - i * 0.13);
        for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.02, 0.12, 5).rotateZ(-s * 0.6), m.bone, this.abdomen, s * 0.12, 0.32 + Math.sin((i / 4) * Math.PI) * 0.06, -0.12 - i * 0.13);
      }
    }
    // Head: eyes and mandibles.
    this.head = joint(this.thorax, 0, 0.02, 0.22);
    mesh(new THREE.SphereGeometry(0.11, 12, 8).scale(1.1, 0.8, 1), m.chitin, this.head);
    for (const [x, y] of [[-0.045, 0.06], [0.045, 0.06], [-0.075, 0.035], [0.075, 0.035]]) mesh(new THREE.SphereGeometry(0.02, 8, 6), m.eyeRed, this.head, x, y, 0.08);
    for (const s of [-1, 1]) {
      const md = joint(this.head, s * 0.045, -0.04, 0.08);
      mesh(new THREE.ConeGeometry(0.025, 0.16, 6).rotateX(Math.PI / 2 + 0.6).translate(0, -0.04, 0.06), accent, md);
      mesh(new THREE.ConeGeometry(0.012, 0.08, 5).rotateX(Math.PI / 2 + 1.4).rotateY(-s * 0.8).translate(-s * 0.02, -0.09, 0.11), m.bone, md);
      this.mandibles.push(md);
      // Pedipalps.
      const p = joint(this.head, s * 0.08, -0.03, 0.06);
      p.rotation.y = -s * 0.4;
      mesh(segment(0.14, 0.018, 0.012).rotateY(-Math.PI / 2), m.chitin, p);
    }
    // Legs: 4 per side, fanned from front to back.
    const yaws = [0.55, 0.15, -0.25, -0.65];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const base = joint(this.thorax, side * 0.14, 0.0, 0.12 - i * 0.08);
        // Leg chain extends along local +X; mirror the yaw for the left side.
        const yaw = side > 0 ? -yaws[i] : Math.PI + yaws[i];
        base.rotation.y = yaw;
        const femur = joint(base, 0, 0, 0);
        mesh(segment(FEMUR, 0.035, 0.028), m.chitin, femur);
        mesh(new THREE.SphereGeometry(0.035, 8, 6), accent, femur, FEMUR, 0, 0);
        const tibia = joint(femur, FEMUR, 0, 0);
        mesh(segment(TIBIA, 0.028, 0.018), m.chitin, tibia);
        const tarsus = joint(tibia, TIBIA, 0, 0);
        mesh(segment(TARSUS, 0.018, 0.006), accent, tarsus);
        // Tetrapod gait: legs 0 and 2 on one side step with 1 and 3 on the other.
        const group = (i + (side > 0 ? 1 : 0)) % 2;
        this.legs.push({ side, index: i, yaw, base, femur, tibia, tarsus, phase: group * Math.PI + i * 0.25 });
      }
    }
    this.pose(0, 0);
    bakeRig(this.root);
  }

  private pose(w: number, idle: number) {
    const ph = this.phase;
    for (const l of this.legs) {
      const p = ph + l.phase;
      const lift = Math.max(0, Math.sin(p)) * 0.55 * w;
      const swing = Math.cos(p) * 0.32 * w;
      l.base.rotation.y = l.yaw + swing * -l.side;
      l.femur.rotation.z = FEMUR_UP + lift + Math.sin(this.time * 2 + l.index) * 0.03 * idle;
      l.tibia.rotation.z = TIBIA_DOWN - lift * 0.6;
      l.tarsus.rotation.z = TARSUS_DOWN + lift * 0.3;
    }
  }

  update(dt: number, speed: number) {
    this.time += dt;
    this.phase += speed * dt * 7;
    const target = THREE.MathUtils.clamp(speed / 3, 0, 1);
    this.walk += (target - this.walk) * (1 - Math.exp(-dt * 10));
    const w = this.walk;
    this.pose(w, 1 - w);
    this.thorax.position.y = this.rideHeight + Math.abs(Math.sin(this.phase * 2)) * 0.03 * w + Math.sin(this.time * 1.5) * 0.008;
    this.thorax.rotation.z = Math.sin(this.phase) * 0.05 * w;
    this.thorax.rotation.x = 0;
    this.abdomen.rotation.y = Math.sin(this.phase * 0.5) * 0.12 * w + Math.sin(this.time * 0.9) * 0.05;
    this.abdomen.rotation.x = Math.sin(this.time * 1.7) * 0.04;
    this.head.rotation.y += (this.lookYaw - this.head.rotation.y) * (1 - Math.exp(-dt * 6));
    this.head.rotation.x = 0;
    // Mandibles twitch.
    const click = Math.max(0, Math.sin(this.time * 9)) * 0.25;
    this.mandibles.forEach((md, i) => (md.rotation.y = (i === 0 ? 1 : -1) * (0.1 + click)));
    this.body.position.z = 0;
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

export function buildCrawler(m: MonsterMaterials, rng: Rng, scale = range(rng, 0.75, 0.95), tomb = false): MonsterBody {
  const c = new Crawler(m, scale, tomb);
  return {
    rig: c,
    attack(onHit) {
      let fired = false;
      c.play(0.62, (k) => {
        // Rear back with the front legs raised, then lunge and bite.
        const rear = Math.sin(Math.min(1, k / 0.45) * Math.PI * 0.5) * (k < 0.45 ? 1 : Math.max(0, 1 - (k - 0.45) / 0.15));
        const lunge = k > 0.4 ? Math.sin(Math.min(1, (k - 0.4) / 0.6) * Math.PI) : 0;
        c.thorax.rotation.x = -rear * 0.45 + lunge * 0.15;
        c.body.position.z = lunge * 0.35;
        for (const l of c.legs) if (l.index === 0) l.femur.rotation.z = FEMUR_UP + rear * 1.1;
        c.mandibles.forEach((md, i) => (md.rotation.y = (i === 0 ? 1 : -1) * (0.6 * rear - 0.25 * lunge)));
        if (!fired && k >= 0.5) {
          fired = true;
          onHit();
        }
      });
    },
    flinch() {
      if (c.acting) return;
      c.play(0.25, (k) => {
        c.thorax.rotation.x = -Math.sin(k * Math.PI) * 0.3;
        c.body.position.z = -Math.sin(k * Math.PI) * 0.1;
      });
    },
    die() {
      // Flips over onto its back and the legs curl in.
      c.play(0.9, (k) => {
        const f = Math.min(1, k * 1.4);
        c.body.rotation.z = Math.PI * f * f;
        c.body.position.y = Math.sin(f * Math.PI) * 0.3 + f * 0.65 * c.body.scale.y;
        for (const l of c.legs) {
          l.femur.rotation.z = FEMUR_UP + 0.9 * k + Math.sin(k * 30 + l.index) * 0.2 * (1 - k);
          l.tibia.rotation.z = TIBIA_DOWN - 0.6 * k;
          l.tarsus.rotation.z = TARSUS_DOWN - 0.6 * k;
        }
      });
    },
  };
}
