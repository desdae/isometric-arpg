import * as THREE from 'three';
import { Character, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { collapse, flinch, keyedAction } from './humanoid';
import type { MonsterBody, MonsterMaterials } from './materials';

// Flesh brute: a hulking stitched-together thing, barrel chest and tiny head
// sunk between its shoulders, iron strapped to one arm, dragging a cleaver
// the size of a door.

function cleaver(): THREE.BufferGeometry[] {
  // Blade runs along +Y from the grip; the spine is straight, the edge chipped.
  const s = new THREE.Shape();
  s.moveTo(-0.03, 0.18);
  s.lineTo(-0.05, 0.95);
  s.lineTo(0.06, 1.02);
  s.lineTo(0.3, 0.96);
  const notches = 7;
  for (let i = 0; i <= notches; i++) {
    const y = 0.96 - (i / notches) * 0.74;
    s.lineTo(0.3 - (i % 2) * 0.025 - i * 0.004, y);
  }
  s.lineTo(0.05, 0.18);
  s.closePath();
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.012, bevelSegments: 1 });
  blade.translate(0, 0, -0.0125);
  const grip = new THREE.CylinderGeometry(0.028, 0.032, 0.36, 8).translate(0, 0.02, 0);
  return [blade, grip];
}

export function buildBrute(m: MonsterMaterials, rng: Rng, scale = range(rng, 1.38, 1.5)): MonsterBody {
  const c = new Character({ scale, hunch: 0.35, stride: 1.7 });
  const skin = m.bruteSkin;

  // Thick legs and a hide loin wrap with a chain belt.
  for (const side of [-1, 1]) {
    const l = c.leg(side);
    mesh(lathe([[0.11, 0], [0.12, -0.18], [0.085, -0.42]], 12), skin, l.thigh, 0, 0, 0);
    mesh(lathe([[0.088, 0], [0.095, -0.14], [0.07, -0.42]], 12), skin, l.shin, 0, 0, 0);
    mesh(new THREE.BoxGeometry(0.13, 0.07, 0.22), m.leather, l.foot, 0, -0.03, 0.05);
    mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10), m.leather, l.shin, 0, -0.3, 0); // wrappings
  }
  c.legs.forEach((l) => (l.thigh.position.x *= 1.35));
  mesh(lathe([[0.2, 0.06], [0.23, -0.06], [0.26, -0.28]], 14).scale(1.1, 1, 0.9), m.leather, c.hips, 0, 0, 0);
  mesh(new THREE.TorusGeometry(0.21, 0.018, 5, 22).rotateX(Math.PI / 2).scale(1.1, 1, 0.9), m.iron, c.hips, 0, 0.05, 0);

  // Gut, barrel chest and heaped trapezius.
  mesh(new THREE.SphereGeometry(0.22, 14, 10).scale(1.05, 0.95, 1), skin, c.spine, 0, 0.06, 0.04);
  const chest = lathe([[0.0, -0.18], [0.22, -0.16], [0.27, -0.04], [0.3, 0.08], [0.3, 0.2], [0.24, 0.29], [0.12, 0.34]], 18).scale(1.15, 1, 0.88);
  mesh(chest, skin, c.chest, 0, 0, 0);
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.13, 10, 8).scale(1.2, 0.8, 1), skin, c.chest, s * 0.17, 0.27, -0.02);
  // Crude stitches across scars, and a leather strap over the chest.
  for (let i = 0; i < 3; i++) {
    const y = range(rng, -0.05, 0.2);
    const x0 = range(rng, -0.2, 0.05);
    mesh(new THREE.BoxGeometry(0.22, 0.012, 0.01).rotateZ(range(rng, -0.4, 0.4)), m.wound, c.chest, x0 + 0.1, y, 0.255);
    for (let k = 0; k < 5; k++) mesh(new THREE.BoxGeometry(0.008, 0.05, 0.012), m.leather, c.chest, x0 + 0.02 + k * 0.04, y, 0.262);
  }
  mesh(new THREE.TorusGeometry(0.29, 0.025, 4, 24).scale(1.12, 1.1, 0.9).rotateZ(0.7), m.leather, c.chest, 0, 0.08, 0);

  // Small head sunk low: heavy brow, tusks, red eyes.
  c.head.position.set(0, 0.3, 0.08);
  mesh(new THREE.SphereGeometry(0.11, 12, 10).scale(1, 0.95, 1.05), skin, c.head, 0, 0.05, 0);
  mesh(new THREE.BoxGeometry(0.18, 0.04, 0.08), skin, c.head, 0, 0.09, 0.07);
  mesh(new THREE.BoxGeometry(0.15, 0.06, 0.1), skin, c.head, 0, 0.0, 0.06);
  for (const s of [-1, 1]) {
    mesh(new THREE.ConeGeometry(0.014, 0.07, 5).rotateX(-0.3), m.bone, c.head, s * 0.05, 0.04, 0.11);
    mesh(new THREE.SphereGeometry(0.014, 8, 6), m.eyeRed, c.head, s * 0.04, 0.07, 0.105);
  }

  // Massive arms; iron pauldron and bracer on the left, cleaver in the right.
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    a.shoulder.position.x *= 1.45;
    a.fore.position.y = -0.31;
    a.hand.position.y = -0.33;
    mesh(new THREE.SphereGeometry(0.12, 10, 8), skin, a.shoulder, 0, 0, 0);
    mesh(lathe([[0.09, 0], [0.105, -0.12], [0.08, -0.31]], 12), skin, a.upper, 0, 0, 0);
    mesh(lathe([[0.085, 0], [0.1, -0.12], [0.07, -0.33]], 12), skin, a.fore, 0, 0, 0);
    mesh(new THREE.SphereGeometry(0.085, 10, 8).scale(1, 1.1, 1), skin, a.hand, 0, -0.03, 0.01);
    a.upper.rotation.z = side * 0.32;
    a.restUpper = -0.2;
    a.restFore = -0.4;
    a.swing = 0.3;
    if (side === -1) {
      mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.1, 0.8, 1.1), m.iron, a.shoulder, 0, 0.03, 0);
      for (let i = 0; i < 3; i++) mesh(new THREE.ConeGeometry(0.02, 0.08, 5), m.iron, a.shoulder, (i - 1) * 0.06, 0.12, 0);
      mesh(new THREE.CylinderGeometry(0.105, 0.09, 0.2, 10), m.iron, a.fore, 0, -0.18, 0);
    } else {
      const grip = joint(a.hand, 0, -0.02, 0.03);
      grip.rotation.x = 2.5;
      const [blade, handle] = cleaver();
      mesh(blade, m.iron, grip);
      mesh(handle, m.leather, grip);
    }
  }
  bakeRig(c.root);

  return {
    rig: c,
    attack(onHit) {
      // Both arms heave the cleaver overhead and slam it down.
      keyedAction(
        c,
        1.25,
        [
          { k: 0, uL: -0.2, uR: -0.2, fL: -0.4, fR: -0.4, zL: -0.32, zR: 0.32, s: 0 },
          { k: 0.42, uL: -2.9, uR: -3.0, fL: -0.5, fR: -0.4, zL: -0.05, zR: 0.05, s: -0.3 },
          { k: 0.56, uL: -0.6, uR: -0.5, fL: -0.2, fR: -0.15, zL: -0.15, zR: 0.15, s: 0.55 },
          { k: 0.75, uL: -0.6, uR: -0.5, fL: -0.2, fR: -0.15, zL: -0.15, zR: 0.15, s: 0.5 },
          { k: 1, uL: -0.2, uR: -0.2, fL: -0.4, fR: -0.4, zL: -0.32, zR: 0.32, s: 0 },
        ],
        0.56,
        onHit,
      );
    },
    flinch: () => flinch(c, 0.15),
    die: () => collapse(c, true),
  };
}
