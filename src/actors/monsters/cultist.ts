import * as THREE from 'three';
import { Character, clothPanel, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { collapse, flinch, keyedAction } from './humanoid';
import type { MonsterBody, MonsterMaterials } from './materials';

// Hooded blood priest: a long crimson robe, a deep cowl with nothing but two
// embers for eyes, bone talismans on a rope belt and a staff crowned with a
// horned skull holding a glowing blood crystal.

export function buildCultist(m: MonsterMaterials, rng: Rng): MonsterBody {
  const c = new Character({ scale: range(rng, 0.98, 1.06), hunch: 0.15, stride: 1.3 });
  const robe = m.robe;

  // Robe: lathe from chest to the ground, flared hem; sleeves and cowl.
  const body = lathe([[0.0, 0.0], [0.16, 0.0], [0.19, -0.2], [0.23, -0.55], [0.3, -0.9], [0.34, -1.0], [0.0, -1.0]], 18).scale(1, 1, 0.85);
  mesh(body, robe, c.hips, 0, 0.06, 0);
  mesh(lathe([[0.0, -0.18], [0.17, -0.18], [0.2, 0.0], [0.2, 0.16], [0.15, 0.27], [0.06, 0.3]], 16).scale(1.05, 1, 0.8), robe, c.chest, 0, 0, 0);
  mesh(lathe([[0.15, -0.12], [0.16, 0.12]], 14).scale(1, 1, 0.82), robe, c.spine, 0, 0.04, 0);
  clothPanel(c, c.hips, robe, 0.42, 0.9, new THREE.Vector3(0, 0.02, -0.17), { flare: 0.35, sweep: 0.3, wrap: 0.08 });
  // Rope belt with dangling bone talismans.
  mesh(new THREE.TorusGeometry(0.17, 0.014, 5, 20).rotateX(Math.PI / 2).scale(1, 1, 0.82), m.leather, c.spine, 0, -0.04, 0);
  for (let i = 0; i < 3; i++) {
    const t = joint(c.spine, -0.08 + i * 0.07, -0.06, 0.14);
    mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 3).translate(0, -0.06, 0), m.leather, t);
    mesh(new THREE.BoxGeometry(0.025, 0.05, 0.012), m.bone, t, 0, -0.13, 0);
  }

  // Hood: an outer shell and a void where the face should be.
  c.head.position.y = 0.36;
  mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).scale(1, 1.15, 1.1), robe, c.head, 0, 0.04, -0.01);
  mesh(lathe([[0.12, -0.12], [0.15, 0.0], [0.15, 0.1]], 14).scale(1, 1, 1.05), robe, c.head, 0, 0.0, -0.02);
  mesh(new THREE.SphereGeometry(0.105, 12, 8).scale(0.95, 1.05, 0.6), m.void, c.head, 0, 0.02, 0.07);
  clothPanel(c, c.chest, robe, 0.36, 0.42, new THREE.Vector3(0, 0.32, -0.14), { flare: 0.25, sweep: 0.2, wrap: 0.1 });
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.013, 8, 6), m.eyeRed, c.head, s * 0.035, 0.035, 0.115);

  // Wide sleeves and bony grey hands.
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    mesh(lathe([[0.06, 0.02], [0.065, -0.12], [0.075, -0.3]], 12), robe, a.upper, 0, 0, 0);
    mesh(lathe([[0.07, 0], [0.09, -0.15], [0.11, -0.28]], 12), robe, a.fore, 0, 0, 0);
    mesh(new THREE.BoxGeometry(0.06, 0.08, 0.035), m.paleSkin, a.hand, 0, -0.01, 0.01);
    for (let i = 0; i < 4; i++) mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.07, 4), m.paleSkin, a.hand, (i - 1.5) * 0.014, -0.08, 0.015);
  }
  const staffArm = c.arm(1);
  staffArm.upper.rotation.z = 0.32; // staff held out at the side
  staffArm.restUpper = -0.25;
  staffArm.restFore = -1.0;
  staffArm.swing = 0.1;
  c.arm(-1).restUpper = -0.15;
  c.arm(-1).restFore = -0.6;

  // Staff held upright; horned skull and blood crystal on top.
  const grip = joint(staffArm.hand, 0, -0.04, 0.02);
  grip.rotation.x = 1.0;
  mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.8, 7).translate(0, 0.25, 0), m.wood, grip);
  const top = joint(grip, 0, 1.15, 0);
  mesh(new THREE.SphereGeometry(0.06, 10, 8).scale(0.9, 1, 1.1), m.bone, top, 0, 0.04, 0);
  for (const s of [-1, 1]) {
    mesh(new THREE.TorusGeometry(0.06, 0.012, 5, 10, Math.PI * 0.8).rotateY(Math.PI / 2).rotateZ(s * 0.6), m.bone, top, s * 0.05, 0.08, -0.02);
    mesh(new THREE.SphereGeometry(0.012, 6, 4), m.void, top, s * 0.022, 0.05, 0.05);
  }
  const crystal = new THREE.OctahedronGeometry(0.055, 0).scale(0.7, 1.4, 0.7);
  // Its own crystal material so each priest's glow pulses on its own. No
  // point light: bloom carries the glow, and lights coming and going with
  // monsters would force shader recompiles.
  const crystalMat = (m.crystal as THREE.MeshStandardMaterial).clone();
  mesh(crystal, crystalMat, top, 0, 0.18, 0);
  let boost = 0;
  let lit = 1;
  const phase = rng() * 6;
  c.hooks.push((_dt, _w, time) => (crystalMat.emissiveIntensity = lit * (1.8 + Math.sin(time * 3.1 + phase) * 0.5 + Math.sin(time * 11 + phase) * 0.12 + boost * 0.12)));
  bakeRig(c.root);

  const tip = new THREE.Vector3();
  return {
    rig: c,
    attack(onHit) {
      // Staff raised high, off hand thrust forward, then the bolt is released.
      keyedAction(
        c,
        1.05,
        [
          { k: 0, uL: -0.15, uR: -0.25, fL: -0.6, fR: -1.0, s: 0 },
          { k: 0.45, uL: -1.2, uR: -2.6, fL: -0.3, fR: -0.4, s: -0.25 },
          { k: 0.62, uL: -1.5, uR: -1.6, fL: -0.05, fR: -0.6, s: 0.2 },
          { k: 1, uL: -0.15, uR: -0.25, fL: -0.6, fR: -1.0, s: 0 },
        ],
        0.6,
        onHit,
        (k) => (boost = k < 0.95 ? Math.sin(Math.min(1, k / 0.62) * Math.PI) * 25 : 0),
      );
    },
    flinch: () => flinch(c, 0.35),
    die: () => {
      lit = 0.08;
      collapse(c);
    },
    muzzle: () => {
      c.arm(-1).hand.getWorldPosition(tip);
      return tip;
    },
  };
}
