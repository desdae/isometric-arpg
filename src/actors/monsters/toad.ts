import * as THREE from 'three';
import { joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { sculptSphere } from '../sculpt';
import { BasicRig, ease, hump, teethArc } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Bloated mire toad: a squat, wart-crusted sack of a body that is mostly
// mouth. Under the brow ridge two red eyes bulge; the lower jaw hangs on a
// hinge at the back of the skull and swings wide on a ring of needle teeth.
// It hops, and attacks by leaping in with its maw gaping.

class Toad extends BasicRig {
  readonly trunk: THREE.Object3D;
  readonly jaw: THREE.Object3D;
  readonly throat: THREE.Mesh;
  readonly hind: { hip: THREE.Object3D; knee: THREE.Object3D; ankle: THREE.Object3D }[] = [];
  readonly fore: THREE.Object3D[] = [];

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, 4.2, 3);
    const skin = m.toadSkin;
    // Warts: random bumps all over the hide, bigger along the back.
    const warts = Array.from({ length: 70 }, () => {
      const v = new THREE.Vector3(range(rng, -1, 1), range(rng, -0.3, 1), range(rng, -1, 1)).normalize();
      return { v, r: range(rng, 0.008, 0.025) * (1 + Math.max(0, v.y)), h: range(rng, 0.05, 0.11) };
    });
    const hide = (x: number, y: number, z: number) => {
      let d = 0;
      for (const w of warts) {
        const dx = x - w.v.x;
        const dy = y - w.v.y;
        const dz = z - w.v.z;
        d += w.h * Math.exp(-(dx * dx + dy * dy + dz * dz) / w.r);
      }
      // Sagging belly, brow ridge over the eyes, flat underside.
      d += 0.12 * Math.max(0, -y) * Math.max(0, 0.6 - Math.abs(z));
      d += 0.1 * Math.exp(-((x * x) / 0.02 + (y - 0.45) ** 2 / 0.02 + (z - 0.75) ** 2 / 0.05));
      return d;
    };

    this.trunk = joint(this.body, 0, 0.55, 0);
    mesh(sculptSphere(0.5, hide, new THREE.Vector3(1.25, 0.78, 1.15), 36, 26), skin, this.trunk);
    // Pale throat sac that swells as it breathes.
    this.throat = mesh(new THREE.SphereGeometry(0.3, 16, 10).scale(1.25, 0.65, 1), m.toadBelly, this.trunk, 0, -0.2, 0.28);
    // Mouth: a red cavity behind the lips, seen when the jaw drops.
    mesh(new THREE.SphereGeometry(0.33, 16, 10).scale(1.3, 0.55, 1.1), m.wound, this.trunk, 0, -0.06, 0.22);
    for (const g of teethArc(0.55, 0.55, -1.15, 1.15, 16, 0.11, -1)) mesh(g, m.bone, this.trunk, 0, -0.04, 0.02);
    // Eyes on raised domes.
    for (const s of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.11, 12, 8).scale(1, 0.85, 1), skin, this.trunk, s * 0.27, 0.27, 0.33);
      mesh(new THREE.SphereGeometry(0.048, 10, 8), m.eyeRed, this.trunk, s * 0.3, 0.3, 0.41);
      mesh(new THREE.SphereGeometry(0.022, 6, 4).scale(0.4, 1.2, 0.4), m.void, this.trunk, s * 0.31, 0.3, 0.455);
    }
    // Nostrils.
    for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.02, 6, 4), m.void, this.trunk, s * 0.07, 0.1, 0.62);
    // Dark blotches.
    for (let i = 0; i < 9; i++) {
      const a = range(rng, -2.6, 2.6);
      mesh(new THREE.SphereGeometry(range(rng, 0.05, 0.09), 8, 6).scale(1, 0.4, 1), m.toadDark, this.trunk, Math.sin(a) * 0.45, range(rng, 0.2, 0.32), Math.cos(a) * 0.3 - 0.12);
    }

    // Lower jaw on a hinge at the back of the mouth.
    this.jaw = joint(this.trunk, 0, -0.06, -0.2);
    const jawGeo = new THREE.SphereGeometry(0.45, 22, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1.2, 0.48, 1.05).translate(0, 0, 0.32);
    mesh(jawGeo, skin, this.jaw);
    mesh(new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2).scale(1.2, 1, 1.0).translate(0, 0.005, 0.32), m.wound, this.jaw);
    for (const g of teethArc(0.5, 0.45, -1.1, 1.1, 14, 0.09, 1)) mesh(g, m.bone, this.jaw, 0, 0, 0.32);
    // A fat tongue.
    mesh(new THREE.SphereGeometry(0.16, 10, 8).scale(1, 0.4, 1.6), m.wound, this.jaw, 0, 0.03, 0.3);

    // Folded hind legs and stubby forelegs.
    for (const s of [-1, 1]) {
      const hip = joint(this.trunk, s * 0.42, -0.12, -0.28);
      mesh(new THREE.SphereGeometry(0.2, 12, 8).scale(0.8, 0.85, 1.5).translate(0, -0.05, 0.12), skin, hip);
      const knee = joint(hip, 0, -0.12, 0.32);
      mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 8).rotateX(Math.PI / 2 - 0.2).translate(0, -0.08, -0.18), skin, knee);
      const ankle = joint(knee, 0, -0.2, -0.36);
      mesh(new THREE.BoxGeometry(0.2, 0.04, 0.3).translate(0, -0.02, 0.12), m.toadBelly, ankle);
      for (let t = -1; t <= 1; t++) mesh(new THREE.ConeGeometry(0.025, 0.12, 4).rotateX(Math.PI / 2).translate(t * 0.07, -0.02, 0.3), m.toadDark, ankle);
      this.hind.push({ hip, knee, ankle });
      const fore = joint(this.trunk, s * 0.36, -0.15, 0.35);
      mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.34, 8).translate(0, -0.15, 0), skin, fore);
      mesh(new THREE.BoxGeometry(0.15, 0.03, 0.15).translate(0, -0.33, 0.04), m.toadBelly, fore);
      fore.rotation.z = s * 0.3;
      this.fore.push(fore);
    }
    bakeRig(this.root);
    this.throat.userData.dynamic = true;
  }

  protected animate() {
    const w = this.walk;
    const t = this.time;
    // Hops: up and forward on each half cycle, legs kicking out behind.
    const hop = Math.abs(Math.sin(this.phase * 0.5)) * w;
    this.trunk.position.y = 0.55 + hop * 0.3;
    this.trunk.rotation.x = -hop * 0.25 + Math.sin(t * 1.3) * 0.02;
    this.trunk.rotation.z = 0;
    this.trunk.rotation.y += (this.lookYaw * 0.3 - this.trunk.rotation.y) * 0.1;
    for (const l of this.hind) {
      l.hip.rotation.x = hop * 0.9;
      l.knee.rotation.x = -hop * 0.6;
      l.ankle.rotation.x = hop * 0.8;
    }
    for (const f of this.fore) f.rotation.x = -hop * 0.7;
    // Breathing: the throat sac swells and the jaw works.
    const breath = 0.5 + 0.5 * Math.sin(t * 2.4);
    this.throat.scale.set(1 + breath * 0.18, 1 + breath * 0.35, 1 + breath * 0.15);
    this.jaw.rotation.x = 0.05 + Math.max(0, Math.sin(t * 0.7)) * 0.08;
    this.body.position.set(0, 0, 0);
    this.trunk.scale.set(1, 1, 1);
  }
}

export function buildToad(m: MonsterMaterials, rng: Rng, scale = range(rng, 0.85, 1.05)): MonsterBody {
  const c = new Toad(m, rng, scale);
  return {
    rig: c,
    attack(onHit) {
      let fired = false;
      c.play(0.85, (k) => {
        // Squat, spring in with the maw wide, snap shut, settle back.
        const crouch = hump(k, 0, 0.4);
        const leap = hump(k, 0.3, 0.85);
        c.trunk.position.y = 0.55 - crouch * 0.18 + hump(k, 0.32, 0.62) * 0.45;
        c.trunk.rotation.x = crouch * 0.2 - hump(k, 0.3, 0.55) * 0.35;
        c.body.position.z = leap * 1.1;
        c.jaw.rotation.x = 0.05 + ease(k, 0.2, 0.5) * 1.0 * (1 - ease(k, 0.56, 0.64));
        for (const l of c.hind) {
          const kick = hump(k, 0.35, 0.65);
          l.hip.rotation.x = -crouch * 0.3 + kick * 1.2;
          l.knee.rotation.x = crouch * 0.3 - kick * 0.9;
          l.ankle.rotation.x = kick;
        }
        if (!fired && k >= 0.6) {
          fired = true;
          onHit();
        }
      });
    },
    flinch() {
      if (c.acting) return;
      c.play(0.3, (k) => {
        const s = Math.sin(k * Math.PI);
        c.trunk.scale.set(1 + s * 0.12, 1 - s * 0.15, 1 + s * 0.08);
        c.body.position.z = -s * 0.12;
      });
    },
    die() {
      // Rolls over onto its back, legs twitching, the throat deflating.
      c.play(1.1, (k) => {
        const f = ease(k, 0, 0.6);
        c.body.rotation.z = Math.PI * 0.92 * f;
        c.body.position.y = Math.sin(f * Math.PI) * 0.4 + f * 0.9 * c.body.scale.y;
        c.jaw.rotation.x = 0.6 * f;
        for (const l of c.hind) {
          l.hip.rotation.x = 0.8 * f + Math.sin(k * 40) * 0.2 * (1 - k);
          l.knee.rotation.x = -0.5 * f;
        }
        c.throat.scale.setScalar(1 - 0.5 * f);
      });
    },
    muzzle() {
      const p = new THREE.Vector3(0, 0, 0.6);
      return c.trunk.localToWorld(p);
    },
  };
}
