import * as THREE from 'three';
import { joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { sculptSphere } from '../sculpt';
import { BasicRig, ease, hump } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Spined mire-croc: a long, low swamp lizard armoured in dark ridged hide,
// a double row of hooked spines running from its neck to the tip of its
// tail. Red eyes sit high on the skull; the long snout is lined with uneven
// teeth. It sprawls and waddles, its body and tail swinging in an S, and
// lunges with its jaws thrown wide.

interface Leg {
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  side: number;
  front: boolean;
}

class Croc extends BasicRig {
  readonly pelvis: THREE.Object3D;
  readonly chest: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly jaw: THREE.Object3D;
  readonly tail: THREE.Object3D[] = [];
  readonly legs: Leg[] = [];

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, 6, 3.5);
    const hide = m.crocHide;
    const spine = m.chitin;
    const spikeRow = (parent: THREE.Object3D, z0: number, z1: number, n: number, y: number, w: number, h: number) => {
      for (let i = 0; i < n; i++) {
        const z = z0 + ((z1 - z0) * i) / Math.max(1, n - 1);
        const hh = h * range(rng, 0.75, 1.15);
        mesh(new THREE.ConeGeometry(hh * 0.3, hh, 5).rotateX(-0.45).translate(0, hh * 0.4, 0), spine, parent, 0, y, z);
        for (const s of [-1, 1]) {
          const side = mesh(new THREE.ConeGeometry(hh * 0.22, hh * 0.65, 4).rotateX(-0.5).rotateZ(-s * 0.35).translate(0, hh * 0.25, 0), spine, parent, s * w, y - 0.02, z + 0.04);
          side.rotation.y = s * 0.2;
        }
      }
    };
    // Scaly ridges: little bumps across the back.
    const scutes = (x: number, y: number, z: number) => 0.035 * Math.max(0, y) * (Math.sin(x * 22) * Math.sin(z * 18) > 0.3 ? 1 : 0.3) - 0.1 * Math.max(0, -y) * 0.5;

    this.pelvis = joint(this.body, 0, 0.36, -0.25);
    mesh(sculptSphere(0.3, scutes, new THREE.Vector3(0.95, 0.5, 1.7), 28, 18), hide, this.pelvis, 0, 0, 0.12);
    this.chest = joint(this.pelvis, 0, 0.02, 0.5);
    mesh(sculptSphere(0.3, scutes, new THREE.Vector3(0.9, 0.48, 1.5), 28, 18), hide, this.chest, 0, 0, 0.05);
    mesh(new THREE.SphereGeometry(0.26, 14, 8).scale(1.05, 0.45, 1.6), m.toadBelly, this.chest, 0, -0.1, -0.1);
    spikeRow(this.pelvis, -0.3, 0.4, 5, 0.13, 0.12, 0.24);
    spikeRow(this.chest, -0.1, 0.38, 4, 0.13, 0.11, 0.2);

    // Head: a low skull, a long snout and a hinged lower jaw.
    const neck = joint(this.chest, 0, 0.02, 0.42);
    this.head = neck;
    mesh(sculptSphere(0.18, (x, y) => 0.15 * Math.exp(-((x * x) / 0.08 + (y - 0.7) ** 2 / 0.05)), new THREE.Vector3(1.15, 0.6, 1.1), 22, 14), hide, neck, 0, 0.02, 0.05);
    const snout = new THREE.CylinderGeometry(0.055, 0.15, 0.62, 10, 1).rotateX(Math.PI / 2).scale(1.35, 0.5, 1).translate(0, 0.0, 0.45);
    mesh(snout, hide, neck);
    mesh(new THREE.SphereGeometry(0.075, 10, 6).scale(1.3, 0.55, 1), hide, neck, 0, 0.0, 0.76);
    for (const s of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.8, 1.1), hide, neck, s * 0.1, 0.1, 0.07);
      mesh(new THREE.SphereGeometry(0.035, 8, 6), m.eyeRed, neck, s * 0.11, 0.12, 0.11);
      mesh(new THREE.SphereGeometry(0.016, 6, 4), m.void, neck, s * 0.035, 0.035, 0.78);
      // Upper teeth along the snout, uneven and hooked.
      for (let i = 0; i < 9; i++) {
        const z = 0.2 + i * 0.065;
        const half = 0.15 - (z - 0.14) * 0.15;
        const l = range(rng, 0.04, 0.085) * (i === 2 || i === 6 ? 1.5 : 1);
        mesh(new THREE.ConeGeometry(0.012, l, 4).rotateX(Math.PI).translate(0, -l / 2, 0), m.bone, neck, s * half * 1.25, -0.04, z);
      }
    }
    this.jaw = joint(neck, 0, -0.05, 0.02);
    mesh(new THREE.CylinderGeometry(0.045, 0.13, 0.72, 10, 1).rotateX(Math.PI / 2).scale(1.3, 0.38, 1).translate(0, -0.02, 0.38), hide, this.jaw);
    mesh(new THREE.PlaneGeometry(0.2, 0.6).rotateX(-Math.PI / 2).translate(0, 0.01, 0.38), m.wound, this.jaw);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        const z = 0.18 + i * 0.07;
        const half = 0.14 - (z - 0.12) * 0.15;
        const l = range(rng, 0.035, 0.075);
        mesh(new THREE.ConeGeometry(0.011, l, 4).translate(0, l / 2, 0), m.bone, this.jaw, s * half * 1.1, 0.01, z);
      }
    }

    // Tail: seven tapering segments, each crowned with spines.
    let parent: THREE.Object3D = this.pelvis;
    let z = -0.38;
    for (let i = 0; i < 7; i++) {
      const r = 0.22 * (1 - i / 8.5);
      const len = 0.32 - i * 0.012;
      const seg = joint(parent, 0, i === 0 ? 0 : 0.0, z);
      mesh(new THREE.CylinderGeometry(r * 0.8, r, len + 0.05, 9).rotateX(Math.PI / 2).scale(1, 0.75, 1).translate(0, 0, -len / 2), hide, seg);
      spikeRow(seg, -len * 0.3, -len * 0.3, 1, r * 0.65, r * 0.55, 0.22 * (1 - i / 9));
      this.tail.push(seg);
      parent = seg;
      z = -len;
    }
    mesh(new THREE.ConeGeometry(0.06, 0.3, 7).rotateX(-Math.PI / 2).translate(0, 0, -0.15), hide, parent, 0, 0, z);

    // Four sprawling legs.
    for (const front of [true, false]) {
      for (const side of [-1, 1]) {
        const hip = joint(front ? this.chest : this.pelvis, side * 0.27, -0.05, front ? 0.12 : 0.12);
        mesh(new THREE.CapsuleGeometry(0.05, 0.2, 3, 8).rotateZ(Math.PI / 2).translate(side * 0.12, 0, 0), hide, hip);
        const knee = joint(hip, side * 0.24, 0, 0);
        mesh(new THREE.CapsuleGeometry(0.04, 0.22, 3, 8).translate(0, -0.13, 0), hide, knee);
        mesh(new THREE.BoxGeometry(0.13, 0.04, 0.16).translate(0, -0.28, 0.04), hide, knee);
        for (let t = -1; t <= 1; t++) mesh(new THREE.ConeGeometry(0.015, 0.08, 4).rotateX(Math.PI / 2).translate(t * 0.04, -0.29, 0.15), m.bone, knee);
        this.legs.push({ hip, knee, side, front });
      }
    }
    bakeRig(this.root);
  }

  protected animate() {
    const w = this.walk;
    const t = this.time;
    const p = this.phase;
    // The S-curve swing of a sprawling walk; a lazy sway when still.
    const sway = Math.sin(p) * 0.16 * w;
    this.pelvis.position.y = 0.36 + Math.abs(Math.cos(p)) * 0.025 * w;
    this.pelvis.rotation.set(0, sway, Math.sin(p) * 0.04 * w);
    this.chest.rotation.set(0, -sway * 1.5, 0);
    this.head.rotation.set(Math.sin(t * 0.8) * 0.03, sway * 1.2 + Math.sin(t * 0.4) * 0.08 * (1 - w), 0);
    this.jaw.rotation.x = Math.max(0, Math.sin(t * 0.5)) * 0.06;
    this.tail.forEach((s, i) => {
      s.rotation.y = Math.sin(p - (i + 1) * 0.7) * 0.22 * w + Math.sin(t * 1.1 - i * 0.6) * 0.06 * (1 - w);
      s.rotation.x = 0.03;
    });
    for (const l of this.legs) {
      // Diagonal pairs step together.
      const ph = p + (l.front === (l.side > 0) ? 0 : Math.PI);
      const lift = Math.max(0, Math.sin(ph)) * w;
      l.hip.rotation.set(0, -l.side * Math.cos(ph) * 0.45 * w, -l.side * (0.25 - lift * 0.35));
      l.knee.rotation.set(0, 0, l.side * (0.25 - lift * 0.1));
    }
    this.body.position.set(0, 0, 0);
  }
}

export function buildCroc(m: MonsterMaterials, rng: Rng, scale = range(rng, 0.95, 1.15), spiked = false): MonsterBody {
  void spiked;
  const c = new Croc(m, rng, scale);
  return {
    rig: c,
    attack(onHit) {
      let fired = false;
      c.play(0.75, (k) => {
        // Rear the head back, jaws gaping, then lunge and slam them shut;
        // the tail lashes to the side for balance.
        const open = ease(k, 0.05, 0.45) * (1 - ease(k, 0.5, 0.58));
        const lunge = hump(k, 0.35, 0.95);
        c.head.rotation.x = -open * 0.45 + hump(k, 0.5, 0.75) * 0.15;
        c.jaw.rotation.x = open * 0.95;
        c.body.position.z = lunge * 0.75;
        c.chest.rotation.x = -open * 0.12;
        c.tail.forEach((s, i) => (s.rotation.y += Math.sin(k * Math.PI * 2 - i * 0.5) * 0.25 * hump(k, 0, 1)));
        if (!fired && k >= 0.55) {
          fired = true;
          onHit();
        }
      });
    },
    flinch() {
      if (c.acting) return;
      c.play(0.3, (k) => {
        const s = Math.sin(k * Math.PI);
        c.chest.rotation.x = -s * 0.25;
        c.jaw.rotation.x = s * 0.5;
        c.body.position.z = -s * 0.15;
      });
    },
    die() {
      // The death roll: over onto its back, jaws agape, tail curling.
      c.play(1.2, (k) => {
        const f = ease(k, 0, 0.7);
        c.body.rotation.z = Math.PI * f;
        c.body.position.y = f * 0.72 * c.body.scale.y + Math.sin(f * Math.PI) * 0.2;
        c.jaw.rotation.x = 0.7 * f;
        c.tail.forEach((s) => (s.rotation.y = 0.25 * f));
        for (const l of c.legs) l.knee.rotation.z = l.side * (0.25 + 0.6 * f + Math.sin(k * 30) * 0.15 * (1 - k));
      });
    },
    muzzle() {
      return c.head.localToWorld(new THREE.Vector3(0, 0, 0.6));
    },
  };
}
