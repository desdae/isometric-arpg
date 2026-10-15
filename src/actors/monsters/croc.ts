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
//
// The spiked gaol-croc is what the mire-croc grows into fed on the gaol's
// blood: far bigger and heavier, its near-black hide slick and wet, its back
// tiled with raised bony plates each crowned with a great hooked spike, row
// on row down the back, flanks and tail. Bony ridges hood its burning red
// eyes, and its jaws hang with long uneven teeth, dripping.

interface Leg {
  hip: THREE.Object3D;
  knee: THREE.Object3D;
  side: number;
  front: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

/** A hooked spike: a cone, base at the origin, bent back (toward -Z) along its length. */
function hookSpike(len: number, r: number, hook: number, seg = 5) {
  const g = new THREE.CylinderGeometry(0, r, len, seg, 4, true).translate(0, len / 2, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    p.setZ(i, p.getZ(i) - hook * len * t * t);
  }
  g.computeVertexNormals();
  return g;
}

class Croc extends BasicRig {
  pelvis!: THREE.Object3D;
  chest!: THREE.Object3D;
  head!: THREE.Object3D;
  jaw!: THREE.Object3D;
  readonly tail: THREE.Object3D[] = [];
  readonly legs: Leg[] = [];
  readonly hipY: number;
  readonly spiked: boolean;
  dead = false;
  /** Strands of bloody slaver between the jaws (spiked only), head space. */
  private strands: { mesh: THREE.Mesh; top: THREE.Vector3; bottom: THREE.Vector3 }[] = [];
  /** Drops falling from the lower jaw (spiked only). */
  private drops: { mesh: THREE.Mesh; y: number; phase: number; rate: number }[] = [];

  constructor(m: MonsterMaterials, rng: Rng, scale: number, spiked: boolean) {
    super(spiked ? scale * 1.15 : scale, spiked ? 5 : 6, 3.5);
    this.spiked = spiked;
    this.hipY = spiked ? 0.46 : 0.36;
    if (spiked) this.buildSpiked(m, rng);
    else this.buildMire(m, rng);
    bakeRig(this.root);
  }

  private buildMire(m: MonsterMaterials, rng: Rng) {
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
  }

  private buildSpiked(m: MonsterMaterials, rng: Rng) {
    // Wet near-black hide, darker plates, horn spikes, and fresh blood.
    const hide = (m.crocHide as THREE.MeshStandardMaterial).clone();
    hide.color.setRGB(0.075, 0.058, 0.048);
    hide.roughness = 0.4;
    hide.metalness = 0.05;
    const plate = (m.chitin as THREE.MeshStandardMaterial).clone();
    plate.color.setRGB(0.1, 0.075, 0.065);
    plate.roughness = 0.32;
    plate.metalness = 0.08;
    const belly = (m.crocHide as THREE.MeshStandardMaterial).clone();
    belly.color.setRGB(0.17, 0.12, 0.09);
    belly.roughness = 0.4;
    const horn = new THREE.MeshStandardMaterial({ color: 0x2a1c16, roughness: 0.3, metalness: 0.1 });
    const blood = new THREE.MeshStandardMaterial({ color: 0x3a0206, roughness: 0.1, metalness: 0.3, emissive: new THREE.Color(0.03, 0.0, 0.0) });
    const slaver = new THREE.MeshStandardMaterial({ color: 0x6a0a0c, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.75 });
    const tooth = (m.bone as THREE.MeshStandardMaterial).clone();
    tooth.color.set(0x8a7658);
    tooth.roughness = 0.35;
    const mouth = new THREE.MeshStandardMaterial({ color: 0x5a0a0a, roughness: 0.2, emissive: new THREE.Color(0.12, 0.005, 0.0) });

    // Heavy, lumpy armoured hide; flatter underneath.
    const lumps = (x: number, y: number, z: number) => 0.045 * Math.max(0, y) * (Math.sin(x * 19 + 1) * Math.sin(z * 15) > 0.2 ? 1 : 0.35) - 0.12 * Math.max(0, -y) * 0.5 + 0.02 * Math.sin(z * 9 + x * 4);

    /**
     * Plates and spikes on an ellipsoid body part (centre cz, radii rx ry rz).
     * phi is the angle down from the top of the back; size is the spike length.
     */
    const armour = (parent: THREE.Object3D, cy: number, cz: number, rx: number, ry: number, rz: number, rows: [number, number][], z0: number, z1: number, step: number) => {
      for (let z = z0; z <= z1 + 1e-6; z += step) {
        const s = Math.sqrt(Math.max(0, 1 - ((z - cz) / rz) ** 2));
        const taper = 0.55 + 0.45 * s;
        for (const [phi, size] of rows) {
          for (const side of phi === 0 ? [0] : [-1, 1]) {
            const ph = phi * (side || 1);
            const zz = z + (Math.abs(phi) > 0.5 ? step * 0.5 : 0) + range(rng, -0.015, 0.015);
            const ss = Math.sqrt(Math.max(0, 1 - ((zz - cz) / rz) ** 2));
            const x = rx * Math.sin(ph) * ss;
            const y = cy + ry * Math.cos(ph) * ss;
            const n = new THREE.Vector3(x / (rx * rx), (y - cy) / (ry * ry), (zz - cz) / (rz * rz) * 0.3).normalize();
            // The raised bony scute.
            const pw = 0.05 + size * 0.28;
            const pl = mesh(new THREE.CylinderGeometry(pw * 0.42, pw * 0.6, 0.04, 6).scale(1, 1, 1.2), plate, parent, x, y, zz);
            pl.quaternion.setFromUnitVectors(UP, n);
            // Its hooked spike, raked back.
            const len = size * taper * range(rng, 0.8, 1.2);
            const dir = n.clone().add(new THREE.Vector3(0, 0, -0.2)).normalize();
            const sp = mesh(hookSpike(len, len * 0.3, 0.55), horn, parent, x + n.x * 0.01, y + n.y * 0.01, zz);
            sp.quaternion.setFromUnitVectors(UP, dir);
          }
        }
      }
    };
    /** Glossy blood streaks running down the flanks. */
    const streaks = (parent: THREE.Object3D, cy: number, cz: number, rx: number, ry: number, rz: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const side = rng() < 0.5 ? -1 : 1;
        const ph = side * range(rng, 1.0, 1.75);
        const z = cz + range(rng, -0.75, 0.75) * rz;
        const ss = Math.sqrt(Math.max(0, 1 - ((z - cz) / rz) ** 2));
        const x = rx * Math.sin(ph) * ss;
        const y = cy + ry * Math.cos(ph) * ss;
        const l = range(rng, 0.06, 0.16);
        const st = mesh(new THREE.SphereGeometry(1, 6, 5).scale(0.022, l, 0.006), blood, parent, x * 0.985, y - l * 0.4, z);
        st.rotation.set(0, side * Math.PI * 0.5 - side * 0.0, side * (ph - side * Math.PI * 0.5) * 0.3);
        st.castShadow = false;
        // A drop hanging from the lowest.
        if (rng() < 0.35) mesh(new THREE.ConeGeometry(0.012, 0.06, 5).rotateX(Math.PI).translate(0, -0.03, 0), blood, parent, x, y - l * 1.3, z).castShadow = false;
      }
    };

    const backRows: [number, number][] = [
      [0.2, 0.27],
      [0.62, 0.19],
      [1.02, 0.12],
      [1.38, 0.07],
    ];
    this.pelvis = joint(this.body, 0, this.hipY, -0.3);
    mesh(sculptSphere(0.36, lumps, new THREE.Vector3(1.0, 0.52, 1.65), 30, 20), hide, this.pelvis, 0, 0, 0.1);
    mesh(new THREE.SphereGeometry(0.33, 14, 8).scale(1.0, 0.42, 1.6), belly, this.pelvis, 0, -0.07, 0.08);
    armour(this.pelvis, 0, 0.1, 0.36, 0.187, 0.594, backRows, -0.36, 0.44, 0.13);
    streaks(this.pelvis, 0, 0.1, 0.36, 0.187, 0.594, 6);
    this.chest = joint(this.pelvis, 0, 0.03, 0.6);
    mesh(sculptSphere(0.36, lumps, new THREE.Vector3(0.97, 0.55, 1.45), 30, 20), hide, this.chest, 0, 0, 0.05);
    mesh(new THREE.SphereGeometry(0.32, 14, 8).scale(1.05, 0.45, 1.55), belly, this.chest, 0, -0.08, -0.05);
    armour(this.chest, 0, 0.05, 0.35, 0.198, 0.52, backRows, -0.12, 0.42, 0.13);
    streaks(this.chest, 0, 0.05, 0.35, 0.198, 0.52, 5);

    // Head: a broad, heavy skull under bony brows, a long armoured snout and
    // a hinged lower jaw, both full of long uneven teeth.
    const neck = joint(this.chest, 0, 0.04, 0.5);
    this.head = neck;
    mesh(
      sculptSphere(0.22, (x, y, z) => 0.18 * Math.exp(-((x * x) / 0.08 + (y - 0.7) ** 2 / 0.05)) + 0.03 * Math.sin(x * 14) * Math.max(0, y) - 0.05 * Math.max(0, -z) * 0, new THREE.Vector3(1.22, 0.62, 1.15), 24, 16),
      hide,
      neck,
      0,
      0.03,
      0.06,
    );
    const snout = new THREE.CylinderGeometry(0.075, 0.19, 0.74, 12, 3).rotateX(Math.PI / 2).scale(1.35, 0.5, 1).translate(0, 0.0, 0.52);
    const sp = snout.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) if (sp.getY(i) > 0) sp.setY(i, sp.getY(i) + 0.012 * Math.sin(sp.getZ(i) * 40) * Math.sin(sp.getX(i) * 30)); // knobbly top
    snout.computeVertexNormals();
    mesh(snout, hide, neck);
    mesh(new THREE.SphereGeometry(0.095, 12, 8).scale(1.3, 0.55, 1), hide, neck, 0, 0.005, 0.88);
    // Bony plates down the snout.
    for (let i = 0; i < 5; i++) mesh(new THREE.BoxGeometry(0.08 - i * 0.008, 0.02, 0.07), plate, neck, 0, 0.065 - i * 0.004, 0.25 + i * 0.12).rotation.x = 0.06;
    for (const s of [-1, 1]) {
      // Nostril knob.
      mesh(new THREE.SphereGeometry(0.03, 8, 6), hide, neck, s * 0.04, 0.05, 0.9);
      mesh(new THREE.SphereGeometry(0.014, 6, 4), m.void, neck, s * 0.045, 0.07, 0.915);
      // Brow ridge: a thick bony arch over the eye, studded with knobs.
      const brow = mesh(new THREE.SphereGeometry(0.075, 12, 8).scale(1.1, 0.5, 1.7), plate, neck, s * 0.13, 0.155, 0.12);
      brow.rotation.set(-0.15, s * 0.35, s * 0.25);
      for (let k = 0; k < 3; k++) {
        const kn = mesh(hookSpike(0.06 - k * 0.012, 0.018, 0.3), horn, neck, s * (0.11 + k * 0.03), 0.19 - k * 0.012, 0.16 - k * 0.07);
        kn.quaternion.setFromUnitVectors(UP, new THREE.Vector3(s * 0.5, 1, -0.6).normalize());
      }
      // The eye: a sunken socket and a glowing red orb.
      mesh(new THREE.SphereGeometry(0.05, 10, 8), m.void, neck, s * 0.13, 0.12, 0.17);
      mesh(new THREE.SphereGeometry(0.038, 10, 8), m.eyeRed, neck, s * 0.14, 0.125, 0.19);
      // Upper teeth: long, uneven, some fangs jutting past the lower jaw.
      for (let i = 0; i < 13; i++) {
        const z = 0.18 + i * 0.058;
        const half = 0.19 - (z - 0.14) * 0.17;
        const fang = i === 2 || i === 3 || i === 8 || i === 12;
        const l = range(rng, 0.05, 0.1) * (fang ? 1.7 : 1);
        const t = mesh(hookSpike(l, 0.011 + l * 0.08, -0.25, 5), tooth, neck, s * half * 1.25, -0.04, z);
        t.rotation.set(Math.PI + range(rng, -0.15, 0.15), 0, s * range(rng, -0.25, 0.05));
        if (fang && rng() < 0.7) mesh(new THREE.ConeGeometry(0.006, 0.05, 4).rotateX(Math.PI).translate(0, -0.025, 0), blood, neck, s * half * 1.25, -0.04 - l, z).castShadow = false;
      }
    }
    // The palate: wet red flesh behind the teeth.
    mesh(new THREE.PlaneGeometry(0.26, 0.7).rotateX(Math.PI / 2).translate(0, -0.035, 0.48), mouth, neck);

    this.jaw = joint(neck, 0, -0.06, 0.02);
    mesh(new THREE.CylinderGeometry(0.06, 0.17, 0.86, 12, 1).rotateX(Math.PI / 2).scale(1.3, 0.4, 1).translate(0, -0.03, 0.45), hide, this.jaw);
    mesh(new THREE.PlaneGeometry(0.24, 0.72).rotateX(-Math.PI / 2).translate(0, 0.012, 0.45), mouth, this.jaw);
    mesh(new THREE.CapsuleGeometry(0.04, 0.32, 3, 8).rotateX(Math.PI / 2).scale(1.4, 0.5, 1), mouth, this.jaw, 0, 0.02, 0.35); // tongue
    for (const s of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        const z = 0.18 + i * 0.062;
        const half = 0.17 - (z - 0.12) * 0.17;
        const fang = i === 1 || i === 6 || i === 11;
        const l = range(rng, 0.045, 0.09) * (fang ? 1.6 : 1);
        const t = mesh(hookSpike(l, 0.01 + l * 0.08, -0.25, 5), tooth, this.jaw, s * half * 1.1, 0.01, z);
        t.rotation.set(range(rng, -0.15, 0.15), 0, s * range(rng, -0.05, 0.25));
      }
      // Blood running off the jaw's lip.
      for (let i = 0; i < 4; i++) {
        const z = range(rng, 0.25, 0.75);
        const half = 0.17 - (z - 0.12) * 0.17;
        const l = range(rng, 0.04, 0.12);
        mesh(new THREE.CylinderGeometry(0.005, 0.009, l, 5).translate(0, -l / 2, 0), blood, this.jaw, s * half * 1.32, -0.05, z).castShadow = false;
        mesh(new THREE.SphereGeometry(0.011, 6, 4).scale(1, 1.3, 1), blood, this.jaw, s * half * 1.32, -0.05 - l, z).castShadow = false;
      }
    }
    // Slaver strands between the jaws and drops falling from the chin.
    for (const [x, z] of [[-0.11, 0.3], [0.09, 0.42], [-0.05, 0.6], [0.12, 0.22]]) {
      const st = mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 4).translate(0, 0.5, 0), slaver, neck);
      st.userData.dynamic = true;
      st.castShadow = false;
      this.strands.push({ mesh: st, top: new THREE.Vector3(x, -0.04, z), bottom: new THREE.Vector3(x * 0.9, 0.01, z - 0.02) });
    }
    for (let i = 0; i < 3; i++) {
      const y = -0.07;
      const d = mesh(new THREE.SphereGeometry(0.014, 6, 5).scale(1, 1.6, 1), blood, this.jaw, range(rng, -0.12, 0.12), y, range(rng, 0.3, 0.75));
      d.userData.dynamic = true;
      d.castShadow = false;
      this.drops.push({ mesh: d, y, phase: rng(), rate: range(rng, 0.5, 0.9) });
    }

    // Tail: eight heavy segments, plated and spiked to the tip.
    let parent: THREE.Object3D = this.pelvis;
    let z = -0.42;
    for (let i = 0; i < 8; i++) {
      const r = 0.27 * (1 - i / 9);
      const len = 0.3 - i * 0.01;
      const seg = joint(parent, 0, 0, z);
      mesh(new THREE.CylinderGeometry(r * 0.82, r, len + 0.06, 10).rotateX(Math.PI / 2).scale(1, 0.75, 1).translate(0, 0, -len / 2), hide, seg);
      const k = 1 - i / 9.5;
      for (const [phi, size] of [[0.28, 0.24 * k], [1.0, 0.13 * k]] as [number, number][]) {
        for (const side of [-1, 1]) {
          const x = r * 0.9 * Math.sin(phi) * side;
          const y = r * 0.75 * 0.9 * Math.cos(phi);
          const n = new THREE.Vector3(x / r, y / (r * 0.75), 0).normalize();
          const pl = mesh(new THREE.CylinderGeometry(0.02 + size * 0.14, 0.03 + size * 0.18, 0.035, 6).scale(1, 1, 1.3), plate, seg, x, y, -len * 0.45);
          pl.quaternion.setFromUnitVectors(UP, n);
          const l = size * range(rng, 0.85, 1.15);
          const s2 = mesh(hookSpike(l, l * 0.3, 0.55), horn, seg, x, y, -len * 0.45);
          s2.quaternion.setFromUnitVectors(UP, n.clone().add(new THREE.Vector3(0, 0, -0.4)).normalize());
        }
      }
      this.tail.push(seg);
      parent = seg;
      z = -len;
    }
    mesh(new THREE.ConeGeometry(0.07, 0.32, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.16), hide, parent, 0, 0, z);
    mesh(hookSpike(0.12, 0.025, 0.4), horn, parent, 0, 0.03, z - 0.05).rotation.x = -0.9;

    // Four massive sprawling legs: plated thighs, thick forearms, wide
    // feet with hooked black claws.
    for (const front of [true, false]) {
      for (const side of [-1, 1]) {
        const hip = joint(front ? this.chest : this.pelvis, side * 0.31, -0.07, front ? 0.12 : 0.14);
        mesh(new THREE.CapsuleGeometry(0.085, 0.2, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 1.15).translate(side * 0.13, 0, 0), hide, hip);
        mesh(new THREE.SphereGeometry(0.1, 10, 8).scale(1.2, 0.85, 1), hide, hip, side * 0.08, 0.02, 0);
        for (let k = 0; k < 3; k++) {
          const pl = mesh(new THREE.BoxGeometry(0.06, 0.025, 0.06), plate, hip, side * (0.06 + k * 0.07), 0.085, (k % 2) * 0.03);
          pl.rotation.z = -side * 0.2;
          if (k < 2) mesh(hookSpike(0.07, 0.016, 0.4), horn, hip, side * (0.06 + k * 0.07), 0.095, (k % 2) * 0.03).rotation.x = -0.6;
        }
        const knee = joint(hip, side * 0.28, 0, 0);
        mesh(new THREE.SphereGeometry(0.075, 10, 8), hide, knee);
        mesh(new THREE.CapsuleGeometry(0.06, 0.22, 4, 10).translate(0, -0.14, 0), hide, knee);
        mesh(new THREE.SphereGeometry(0.07, 10, 8).scale(1, 1.5, 1), hide, knee, 0, -0.1, -0.02);
        mesh(new THREE.BoxGeometry(0.19, 0.055, 0.2).translate(0, -0.3, 0.05), hide, knee);
        for (let t = -1.5; t <= 1.5; t++) {
          mesh(new THREE.CapsuleGeometry(0.022, 0.06, 2, 6).rotateX(Math.PI / 2).translate(t * 0.045, -0.31, 0.17), hide, knee);
          const cl = mesh(hookSpike(0.08, 0.016, 0.5), m.chitin, knee, t * 0.045, -0.31, 0.21);
          cl.rotation.x = Math.PI / 2 + 0.25;
          cl.rotation.z = Math.PI;
        }
        this.legs.push({ hip, knee, side, front });
      }
    }
  }

  protected animate() {
    if (this.dead && !this.acting) return;
    const w = this.walk;
    const t = this.time;
    const p = this.phase;
    // The S-curve swing of a sprawling walk; a lazy sway when still.
    const sway = Math.sin(p) * 0.16 * w;
    this.pelvis.position.y = this.hipY + Math.abs(Math.cos(p)) * 0.025 * w;
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
    if (this.spiked) {
      // Heavy breathing swells the flanks; the jaw hangs a little open.
      this.chest.scale.set(1 + Math.sin(t * 1.6) * 0.02, 1 + Math.sin(t * 1.6) * 0.025, 1);
      this.jaw.rotation.x = 0.07 + Math.max(0, Math.sin(t * 0.5)) * 0.08;
    }
  }

  update(dt: number, speed: number) {
    super.update(dt, speed);
    if (!this.spiked || (this.dead && !this.acting)) return;
    // Slaver stretches between the jaws; drops gather and fall from the chin.
    this.jaw.updateMatrix();
    const b = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (const s of this.strands) {
      b.copy(s.bottom).applyMatrix4(this.jaw.matrix);
      d.subVectors(b, s.top);
      const l = d.length();
      s.mesh.position.copy(s.top);
      s.mesh.scale.set(1, Math.max(0.001, l), 1);
      if (l > 1e-4) s.mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / l));
    }
    for (const dr of this.drops) {
      dr.phase = (dr.phase + dt * dr.rate) % 1;
      const f = dr.phase;
      // Swell for most of the cycle, then drop.
      const fall = Math.max(0, (f - 0.7) / 0.3);
      dr.mesh.position.y = dr.y - 0.02 * Math.min(1, f / 0.7) - fall * fall * 0.6;
      dr.mesh.scale.setScalar(Math.max(0.001, Math.min(1, f / 0.5)) * (fall > 0.95 ? 0.001 : 1));
    }
  }
}

export function buildCroc(m: MonsterMaterials, rng: Rng, scale = range(rng, 0.95, 1.15), spiked = false): MonsterBody {
  const c = new Croc(m, rng, scale, spiked);
  const reach = spiked ? 0.95 : 0.75;
  return {
    rig: c,
    attack(onHit) {
      let fired = false;
      c.play(spiked ? 0.85 : 0.75, (k) => {
        // Rear the head back, jaws gaping, then lunge and slam them shut;
        // the tail lashes to the side for balance.
        const open = ease(k, 0.05, 0.45) * (1 - ease(k, 0.5, 0.58));
        const lunge = hump(k, 0.35, 0.95);
        c.head.rotation.x = -open * 0.45 + hump(k, 0.5, 0.75) * 0.15;
        c.jaw.rotation.x = open * 0.95;
        c.body.position.z = lunge * reach;
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
      if (spiked) {
        // Too heavy and spiked to roll: it heaves, its legs give way and it
        // slumps onto its belly and side, jaws agape, tail sprawled.
        c.dead = true;
        c.play(1.4, (k) => {
          const f = ease(k, 0.15, 0.65);
          const heave = hump(k, 0, 0.3);
          c.pelvis.position.y = THREE.MathUtils.lerp(c.hipY + heave * 0.06, 0.2, f);
          c.body.rotation.z = 0.32 * f;
          c.body.position.y = 0.04 * f;
          c.chest.rotation.x = -heave * 0.2 + 0.05 * f;
          c.head.rotation.x = -heave * 0.35 + 0.22 * f;
          c.head.rotation.y = 0.25 * f;
          c.jaw.rotation.x = 0.1 + 0.55 * f + heave * 0.3;
          c.tail.forEach((s, i) => {
            s.rotation.y = (0.1 + Math.sin(i * 1.3) * 0.12) * f;
            s.rotation.x = 0.03 + 0.03 * f;
          });
          for (const l of c.legs) {
            l.hip.rotation.set(0, l.side * (l.front ? -0.3 : 0.3) * f, l.side * (-0.25 + 0.35 * f));
            l.knee.rotation.z = l.side * (0.25 + 1.0 * f + Math.sin(k * 30) * 0.12 * (1 - k) * f);
          }
        });
        return;
      }
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
