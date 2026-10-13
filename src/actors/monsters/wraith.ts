import * as THREE from 'three';
import { gridNormals } from '../cloth';
import { joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { bump, sculptSphere } from '../sculpt';
import type { Rig } from '../Rig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Wraith: a hooded shade drifting a hand's breadth above the floor. A cold
// blue skull glows inside the cowl; its robe hangs in rags that never stop
// moving, trailing threads of red light. It keeps its distance and casts.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Rag {
  geo: THREE.BufferGeometry;
  rest: Float32Array;
  len: number;
  phase: number;
  wisp: boolean;
}

class Wraith implements Rig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly core: THREE.Object3D;
  readonly hood: THREE.Object3D;
  readonly arms: { side: number; shoulder: THREE.Object3D; fore: THREE.Object3D }[] = [];
  lookYaw = 0;
  onStep = null;
  private rags: Rag[] = [];
  private time = Math.random() * 10;
  private lean = 0;
  heart: THREE.Mesh | null = null;
  private action: { t: number; dur: number; fn: (k: number) => void; done?: () => void } | null = null;

  constructor(m: MonsterMaterials, rng: Rng, scale: number, mire = false) {
    this.body.scale.setScalar(scale);
    this.root.add(this.body);
    // The mire wraith is a drowned shade: a bone skull, mud-dark rags, and a
    // heart of red fire burning behind its ribs.
    const cloth = mire
      ? new THREE.MeshStandardMaterial({ color: 0x0d0a08, roughness: 0.95, side: THREE.DoubleSide, emissive: new THREE.Color(0.02, 0.004, 0.002) })
      : new THREE.MeshStandardMaterial({ color: 0x0b0c16, roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color(0.01, 0.012, 0.04) });
    const spirit = mire ? new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.02, 0.01), fog: false }) : new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.75, 2.6), fog: false });
    const skullMat = mire ? m.bone : spirit;
    const eyes = mire ? m.eyeRed : new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.2, 6), fog: false });
    const wisp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.08, 0.04), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });

    this.core = joint(this.body, 0, 1.15, 0);
    // Shoulders and chest: a narrow mantle the rags hang from.
    mesh(lathe([[0.08, 0.32], [0.2, 0.24], [0.24, 0.1], [0.2, -0.1], [0.16, -0.3]], 18).scale(1.15, 1, 0.85), cloth, this.core);
    // Ribcage glimpsed through a rent in the robe.
    for (let i = 0; i < 4; i++) mesh(new THREE.TorusGeometry(0.1 - i * 0.012, 0.008, 4, 14, Math.PI).rotateX(-Math.PI / 2), mire ? m.bone : spirit, this.core, 0, 0.12 - i * 0.055, mire ? 0.17 : 0.12);
    if (mire) {
      // The burning heart, and the dark hollow of the chest around it.
      mesh(new THREE.SphereGeometry(0.12, 12, 8).scale(1, 1.1, 0.6), m.void, this.core, 0, 0.04, 0.13);
      this.heart = mesh(new THREE.SphereGeometry(0.07, 12, 8), spirit, this.core, 0, 0.04, 0.17);
      this.heart.userData.dynamic = true;
    }

    // Hood: a deep cowl around a glowing skull.
    this.hood = joint(this.core, 0, 0.36, 0.04);
    mesh(
      sculptSphere(0.17, (x, y, z) => 0.2 * smooth(0.2, -0.6, y) + 0.25 * bump(x, y, 0, 0.75, 0.2, 0.3) * smooth(0, -0.8, z), new THREE.Vector3(1, 1.15, 1.1), 24, 18),
      cloth,
      this.hood,
      0,
      0.02,
      -0.03,
    );
    mesh(new THREE.SphereGeometry(0.135, 14, 10).scale(0.9, 1.1, 0.5), m.void, this.hood, 0, 0.0, 0.1);
    const skull = sculptSphere(
      0.075,
      (x, y, z) => {
        const front = smooth(0.3, 0.9, z);
        let d = -0.25 * (bump(x, y, -0.35, 0.1, 0.18, 0.15) + bump(x, y, 0.35, 0.1, 0.18, 0.15)) * front; // sockets
        d -= 0.2 * bump(x, y, 0, -0.25, 0.1, 0.1) * front; // nose hole
        d -= 0.18 * smooth(-0.3, -0.9, y) * (1 - Math.abs(x)); // narrow jaw
        return d;
      },
      new THREE.Vector3(0.85, 1.05, 0.9),
      20,
      16,
    );
    mesh(skull, skullMat, this.hood, 0, -0.01, 0.12);
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.013, 8, 6), eyes, this.hood, s * 0.026, 0.0, 0.175);
    // Jaw hanging open.
    mesh(new THREE.BoxGeometry(0.06, 0.02, 0.04), skullMat, this.hood, 0, -0.085, 0.14).rotation.x = 0.4;

    // Sleeves and skeletal hands.
    for (const side of [-1, 1]) {
      const shoulder = joint(this.core, side * 0.24, 0.16, 0);
      shoulder.rotation.z = side * 0.25;
      mesh(lathe([[0.06, 0], [0.075, -0.15], [0.09, -0.32], [0.12, -0.42]], 12), cloth, shoulder);
      const fore = joint(shoulder, 0, -0.38, 0);
      mesh(lathe([[0.07, 0.02], [0.1, -0.12], [0.14, -0.26]], 12), cloth, fore);
      for (let f = 0; f < 4; f++) {
        const finger = mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.16, 5).translate(0, -0.08, 0), skullMat, fore, (f - 1.5) * 0.022, -0.26, 0.02);
        finger.rotation.set(0.35 + f * 0.05, 0, (f - 1.5) * 0.12);
      }
      this.arms.push({ side, shoulder, fore });
    }

    // Rags around the mantle and wisps of red light trailing among them.
    const count = 14;
    for (let i = 0; i < count + 6; i++) {
      const isWisp = i >= count;
      const a = isWisp ? range(rng, 0, Math.PI * 2) : (i / count) * Math.PI * 2;
      const len = isWisp ? range(rng, 0.7, 1.1) : range(rng, 0.85, 1.15);
      const w = isWisp ? 0.025 : range(rng, 0.11, 0.17);
      const g = new THREE.PlaneGeometry(w, len, 1, 10).translate(0, -len / 2, 0);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const t = -p.getY(k) / len;
        // Taper to a ragged point.
        p.setX(k, p.getX(k) * (1 - t * (isWisp ? 0.6 : 0.75)));
      }
      const r = 0.2;
      const mk = mesh(g, isWisp ? wisp : cloth, this.core, Math.sin(a) * r * 1.1, -0.15, Math.cos(a) * r * 0.85);
      mk.rotation.y = a;
      mk.userData.dynamic = true;
      mk.castShadow = !isWisp;
      this.rags.push({ geo: g, rest: (p.array as Float32Array).slice(), len, phase: rng() * 10, wisp: isWisp });
    }
    bakeRig(this.root);
  }

  update(dt: number, speed: number) {
    this.time += dt;
    const t = this.time;
    this.lean += (Math.min(1, speed / 3) - this.lean) * (1 - Math.exp(-dt * 4));
    this.core.position.y = 1.15 + Math.sin(t * 1.6) * 0.06;
    this.core.rotation.x = this.lean * 0.3;
    this.core.rotation.z = Math.sin(t * 0.9) * 0.04;
    this.hood.rotation.y += (this.lookYaw - this.hood.rotation.y) * (1 - Math.exp(-dt * 5));
    this.hood.rotation.x = -0.15 + Math.sin(t * 1.1) * 0.05;
    if (this.heart) this.heart.scale.setScalar(1 + Math.max(0, Math.sin(t * 5.5)) ** 4 * 0.35);
    for (const a of this.arms) {
      a.shoulder.rotation.x = -0.2 + Math.sin(t * 1.3 + a.side) * 0.12 + this.lean * 0.4;
      a.shoulder.rotation.z = a.side * 0.25;
      a.fore.rotation.x = -0.35 + Math.sin(t * 1.7 + a.side) * 0.1;
    }
    // Rags billow and stream back as it moves.
    for (const r of this.rags) {
      const p = r.geo.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const x = r.rest[k * 3];
        const y = r.rest[k * 3 + 1];
        const f = -y / r.len;
        const wave = Math.sin(t * (r.wisp ? 4.5 : 2.6) + r.phase - f * 4) * f * (r.wisp ? 0.12 : 0.07);
        p.setXYZ(k, x + wave * 0.6, y + f * f * this.lean * 0.18, -wave - f * f * this.lean * 0.45);
      }
      p.needsUpdate = true;
      gridNormals(r.geo, 1, 10);
    }
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

export function buildWraith(m: MonsterMaterials, rng: Rng, scale = range(rng, 1.0, 1.1), mire = false): MonsterBody {
  const c = new Wraith(m, rng, scale, mire);
  return {
    rig: c,
    attack(onHit) {
      let fired = false;
      c.play(0.9, (k) => {
        // Both hands rise and thrust forward; the bolt leaves at full reach.
        const raise = Math.sin(Math.min(1, k / 0.55) * Math.PI * 0.5) * (k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3));
        for (const a of c.arms) {
          a.shoulder.rotation.x = -0.2 - raise * 1.5;
          a.shoulder.rotation.z = a.side * (0.25 - raise * 0.15);
          a.fore.rotation.x = -0.35 + raise * 0.2;
        }
        c.hood.rotation.x = -0.15 - raise * 0.25;
        if (!fired && k >= 0.55) {
          fired = true;
          onHit();
        }
      });
    },
    flinch() {
      if (c.acting) return;
      c.play(0.3, (k) => {
        c.core.rotation.x = -Math.sin(k * Math.PI) * 0.35;
      });
    },
    die() {
      // Rises, twists and unravels into nothing.
      c.play(1.6, (k) => {
        c.body.position.y = k * 0.8;
        c.body.rotation.y = k * k * 6;
        c.body.scale.setScalar(Math.max(0.001, scale * (1 - k) ** 1.5));
      });
    },
    muzzle() {
      const p = new THREE.Vector3();
      c.arms[1].fore.getWorldPosition(p);
      return p;
    },
  };
}
