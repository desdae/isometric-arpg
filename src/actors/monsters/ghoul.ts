import * as THREE from 'three';
import { Character, clothPanel, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { collapse, flinch, keyedAction } from './humanoid';
import type { MonsterBody, MonsterMaterials } from './materials';

// Ghoul: starved, stooped corpse-eater with overlong arms ending in claws,
// rib cage showing through grey-green skin, a lipless jaw and yellow eyes.

function claws(hand: THREE.Object3D, m: MonsterMaterials, side: number) {
  mesh(new THREE.BoxGeometry(0.06, 0.07, 0.045), m.ghoulSkin, hand, 0, -0.02, 0.01);
  for (let i = 0; i < 4; i++) {
    const f = joint(hand, (i - 1.5) * 0.016 * side, -0.055, 0.025);
    f.rotation.x = 0.5 + i * 0.05;
    mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.06, 5).translate(0, -0.03, 0), m.ghoulSkin, f);
    const tip = joint(f, 0, -0.06, 0);
    tip.rotation.x = 0.6;
    mesh(new THREE.ConeGeometry(0.008, 0.07, 5).rotateX(Math.PI).translate(0, -0.035, 0), m.bone, tip);
  }
}

export function buildGhoul(m: MonsterMaterials, rng: Rng): MonsterBody {
  const c = new Character({ scale: range(rng, 0.88, 1.0), hunch: range(rng, 0.65, 0.85), stride: 1.25 });
  const skin = m.ghoulSkin;

  // Pelvis and a strip of rag.
  mesh(new THREE.SphereGeometry(0.13, 12, 8).scale(1.1, 0.7, 0.85), skin, c.hips, 0, 0.0, 0);
  clothPanel(c, c.hips, m.rag, 0.22, 0.32, new THREE.Vector3(0, 0.02, 0.11), { flare: 0.3, sweep: 0.3, wrap: 0.03 });
  clothPanel(c, c.hips, m.rag, 0.24, 0.28, new THREE.Vector3(0, 0.02, -0.11), { flare: 0.3, sweep: 0.2, wrap: 0.03 });
  // Pinched waist and a starved chest with ribs standing proud.
  mesh(lathe([[0.1, -0.08], [0.095, 0.05], [0.12, 0.18]], 12).scale(1, 1, 0.8), skin, c.spine, 0, 0, 0);
  const chest = lathe([[0.0, -0.14], [0.12, -0.14], [0.15, -0.04], [0.165, 0.08], [0.155, 0.18], [0.1, 0.26], [0.05, 0.28]], 16).scale(1, 1, 0.72);
  mesh(chest, skin, c.chest, 0, 0, 0);
  for (let i = 0; i < 5; i++) {
    const r = 0.15 - Math.abs(i - 1.5) * 0.01;
    const rib = new THREE.TorusGeometry(r, 0.011, 4, 18, Math.PI * 0.9).rotateX(Math.PI / 2).rotateY(Math.PI * 0.05).scale(1, 1, 0.72);
    mesh(rib, skin, c.chest, 0, -0.06 + i * 0.045, 0.006);
  }
  // Spine knobs down the back, and jutting shoulder blades.
  for (let i = 0; i < 7; i++) mesh(new THREE.SphereGeometry(0.018, 6, 4), skin, i < 3 ? c.spine : c.chest, 0, (i < 3 ? i * 0.06 : (i - 3) * 0.07) - 0.02, -0.1);
  for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.1, 0.12, 0.025).rotateZ(s * 0.3), skin, c.chest, s * 0.08, 0.15, -0.1);
  // Wounds.
  for (let i = 0; i < 3; i++) mesh(new THREE.SphereGeometry(range(rng, 0.025, 0.04), 6, 4).scale(1, 1.6, 0.4), m.wound, c.chest, range(rng, -0.1, 0.1), range(rng, -0.08, 0.15), 0.11);

  // Neck thrust forward and a long skull with an open, lipless jaw.
  c.head.position.set(0, 0.32, 0.06);
  mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.14, 8).translate(0, -0.05, -0.01), skin, c.head);
  const skull = new THREE.SphereGeometry(0.1, 14, 10).scale(0.85, 0.95, 1.2);
  mesh(skull, skin, c.head, 0, 0.07, 0.02);
  mesh(new THREE.BoxGeometry(0.15, 0.03, 0.08), skin, c.head, 0, 0.1, 0.08); // brow ridge
  const jaw = joint(c.head, 0, 0.03, 0.03);
  jaw.rotation.x = 0.35;
  mesh(new THREE.BoxGeometry(0.1, 0.03, 0.12).translate(0, -0.015, 0.05), skin, jaw);
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.015;
    mesh(new THREE.ConeGeometry(0.006, 0.028, 4), m.bone, c.head, x, 0.035, 0.125);
    mesh(new THREE.ConeGeometry(0.006, 0.025, 4), m.bone, jaw, x, 0.008, 0.1);
  }
  for (const s of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.016, 8, 6), m.eyeYellow, c.head, s * 0.035, 0.08, 0.115);
    mesh(new THREE.ConeGeometry(0.02, 0.09, 5).rotateZ(-s * 1.2), skin, c.head, s * 0.09, 0.09, 0.0); // ears
  }

  // Overlong arms.
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    a.fore.position.y = -0.33;
    a.hand.position.y = -0.4;
    mesh(new THREE.SphereGeometry(0.05, 8, 6), skin, a.shoulder, 0, 0, 0);
    mesh(lathe([[0.042, 0], [0.046, -0.1], [0.034, -0.32]], 10), skin, a.upper, 0, 0, 0);
    mesh(new THREE.SphereGeometry(0.03, 8, 6), skin, a.fore, 0, 0, 0);
    mesh(lathe([[0.036, 0], [0.04, -0.14], [0.026, -0.4]], 10), skin, a.fore, 0, 0, 0);
    claws(a.hand, m, side);
    a.restUpper = -0.5;
    a.restFore = -0.55;
    a.swing = 0.55;
  }
  // Thin legs with knobby knees and clawed feet.
  for (const side of [-1, 1]) {
    const l = c.leg(side);
    mesh(lathe([[0.06, 0], [0.058, -0.18], [0.04, -0.42]], 10), skin, l.thigh, 0, 0, 0);
    mesh(new THREE.SphereGeometry(0.04, 8, 6).scale(1, 1.2, 1), skin, l.shin, 0, 0, 0.01);
    mesh(lathe([[0.042, 0], [0.04, -0.16], [0.028, -0.42]], 10), skin, l.shin, 0, 0, 0);
    mesh(new THREE.BoxGeometry(0.07, 0.04, 0.17), skin, l.foot, 0, -0.025, 0.05);
    for (let i = 0; i < 3; i++) mesh(new THREE.ConeGeometry(0.008, 0.05, 4).rotateX(Math.PI / 2), m.bone, l.foot, (i - 1) * 0.022, -0.035, 0.16);
  }
  bakeRig(c.root);

  return {
    rig: c,
    attack(onHit) {
      // Both claws come up and rake down, the body lunging into it.
      const left = Math.random() < 0.5;
      keyedAction(
        c,
        0.72,
        [
          { k: 0, uL: -0.5, uR: -0.5, fL: -0.55, fR: -0.55, s: 0 },
          { k: 0.4, uL: left ? -2.5 : -1.6, uR: left ? -1.6 : -2.5, fL: -1.1, fR: -1.1, s: -0.25 },
          { k: 0.58, uL: left ? -0.1 : -0.7, uR: left ? -0.7 : -0.1, fL: -0.15, fR: -0.2, s: 0.45 },
          { k: 1, uL: -0.5, uR: -0.5, fL: -0.55, fR: -0.55, s: 0 },
        ],
        0.55,
        onHit,
      );
    },
    flinch: () => flinch(c, 0.4),
    die: () => collapse(c),
  };
}
