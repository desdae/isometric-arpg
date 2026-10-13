import * as THREE from 'three';
import { Character, clothPanel, joint, lathe, mesh } from '../Character';

// The mage: a deep-hooded scholar's robe over a long under-robe, wide bell
// sleeves, a stole and mantle in the hero's chosen colour, a belt hung with
// pouches and a chained grimoire, and a gnarled staff caging a glowing
// crystal. Under the hood only two embers of eyes show.

export interface MageMaterials {
  robe: THREE.Material;
  under: THREE.Material;
  accent: THREE.Material;
  leather: THREE.Material;
  skin: THREE.Material;
  wood: THREE.Material;
  iron: THREE.Material;
  gold: THREE.Material;
  crystal: THREE.Material;
  eyes: THREE.Material;
  dark: THREE.Material;
}

/** A gnarled staff shaft: a tapering tube that wanders a little as it rises. */
function shaft(len: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(Math.sin(t * 9) * 0.012, t * len, Math.cos(t * 7) * 0.01));
  }
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.02, 7);
  // Thicker at the head, thinner at the heel, with knots.
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = v.y / len;
    const c = new THREE.Vector3(Math.sin(t * 9) * 0.012, v.y, Math.cos(t * 7) * 0.01);
    const k = 0.75 + t * 0.45 + Math.max(0, Math.sin(t * 31)) * 0.18;
    v.sub(c).multiplyScalar(k).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function dressMage(c: Character, mats: MageMaterials): Character {
  const { robe, under, accent, leather, skin, wood, iron, gold, crystal, eyes, dark } = mats;

  // Legs: soft boots under the robe.
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = c.leg(side);
    mesh(lathe([[0.075, 0], [0.07, -0.2], [0.055, -0.42]], 10), under, thigh, 0, 0, 0);
    mesh(lathe([[0.058, 0.02], [0.062, -0.15], [0.05, -0.38]], 12), leather, shin, 0, -0.02, 0);
    mesh(new THREE.SphereGeometry(0.055, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.85, 0.8, 2.0), leather, foot, 0, -0.04, 0.07);
  }

  // Under-robe to the ankles, and the open outer robe over it.
  mesh(lathe([[0.16, 0.08], [0.2, -0.1], [0.27, -0.6], [0.31, -0.86]], 22).scale(1, 1, 0.86), under, c.hips, 0, 0, 0);
  const outer = new THREE.LatheGeometry(
    [new THREE.Vector2(0.18, 0.09), new THREE.Vector2(0.215, -0.1), new THREE.Vector2(0.29, -0.58), new THREE.Vector2(0.34, -0.84)],
    24,
    Math.PI * 0.18,
    Math.PI * 1.64,
  ).scale(1, 1, 0.88);
  mesh(outer, robe, c.hips, 0, 0, 0);
  // Hem band.
  mesh(new THREE.TorusGeometry(0.335, 0.012, 5, 30, Math.PI * 1.64).rotateX(Math.PI / 2).rotateY(Math.PI * 0.18 - Math.PI / 2).scale(1, 1, 0.88), gold, c.hips, 0, -0.83, 0);

  // Torso: a fitted robe, belted.
  const torso = lathe(
    [
      [0.0, -0.2],
      [0.175, -0.2],
      [0.195, -0.05],
      [0.2, 0.12],
      [0.17, 0.24],
      [0.09, 0.3],
      [0.06, 0.31],
    ],
    20,
  ).scale(1.05, 1, 0.8);
  mesh(torso, robe, c.chest, 0, 0, 0);
  mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.18, 18).scale(1, 1, 0.82), robe, c.spine, 0, 0.02, 0);
  // Sash belt in the hero's colour, a gold clasp, pouches and a chained book.
  mesh(new THREE.TorusGeometry(0.18, 0.022, 6, 28).rotateX(Math.PI / 2).scale(1.02, 1, 0.83), accent, c.spine, 0, -0.04, 0);
  mesh(new THREE.TorusGeometry(0.024, 0.007, 6, 14), gold, c.spine, 0, -0.04, 0.15);
  mesh(new THREE.BoxGeometry(0.07, 0.08, 0.04), leather, c.spine, 0.15, -0.1, 0.08).rotation.y = 0.6;
  mesh(new THREE.BoxGeometry(0.06, 0.07, 0.04), leather, c.spine, 0.17, -0.1, -0.04).rotation.y = 1.3;
  const book = joint(c.hips, -0.21, -0.12, 0.02);
  book.rotation.set(0.1, 0.25, 0.12);
  mesh(new THREE.BoxGeometry(0.035, 0.17, 0.13), leather, book, 0, 0, 0);
  mesh(new THREE.BoxGeometry(0.03, 0.155, 0.12), new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 0.9 }), book, 0.004, 0, 0);
  mesh(new THREE.BoxGeometry(0.038, 0.03, 0.03), gold, book, 0, 0.05, 0.05);
  for (let i = 0; i < 4; i++) mesh(new THREE.TorusGeometry(0.012, 0.003, 4, 8), iron, c.hips, -0.2 + i * 0.006, -0.02 - i * 0.025, 0.04).rotation.y = i * 1.2;

  // Stole hanging down the front, in the hero's colour, with gold ends.
  for (const s of [-1, 1]) {
    const stole = clothPanel(c, c.chest, accent, 0.07, 0.95, new THREE.Vector3(s * 0.07, 0.26, 0.16), { flare: 0.15, wrap: 0.01, sweep: 0.12 });
    stole.rotation.x = -0.12;
  }
  // Mantle over the shoulders.
  mesh(lathe([[0.09, 0.11], [0.22, 0.02], [0.27, -0.1], [0.28, -0.14]], 22).scale(1.02, 1, 0.86), accent, c.chest, 0, 0.2, 0);
  mesh(new THREE.TorusGeometry(0.275, 0.008, 5, 32).rotateX(Math.PI / 2).scale(1.02, 1, 0.86), gold, c.chest, 0, 0.06, 0);
  // Long cloak behind.
  clothPanel(c, c.chest, robe, 0.5, 1.15, new THREE.Vector3(0, 0.25, -0.16), { flare: 0.5, wrap: 0.07, sweep: 0.5 });

  // Bell sleeves and bare hands.
  for (const side of [-1, 1]) {
    const arm = c.arm(side);
    mesh(lathe([[0.068, 0.02], [0.074, -0.15], [0.076, -0.29]], 12), robe, arm.upper, 0, 0, 0);
    mesh(lathe([[0.07, 0.02], [0.09, -0.14], [0.13, -0.27], [0.125, -0.28]], 14), robe, arm.fore, 0, 0, 0);
    mesh(new THREE.TorusGeometry(0.127, 0.007, 5, 20).rotateX(Math.PI / 2), gold, arm.fore, 0, -0.275, 0);
    mesh(new THREE.SphereGeometry(0.044, 10, 8).scale(0.9, 1.2, 0.7), skin, arm.hand, 0, 0, 0);
  }

  // Head: a face kept in shadow inside a deep peaked hood, eyes like embers.
  const head = c.head;
  mesh(new THREE.SphereGeometry(0.095, 16, 12).scale(0.92, 1.08, 1), dark, head, 0, 0.03, 0);
  mesh(new THREE.ConeGeometry(0.07, 0.15, 10).rotateX(Math.PI).scale(1, 1, 0.7), new THREE.MeshStandardMaterial({ color: 0x6a6058, roughness: 0.9 }), head, 0, -0.1, 0.05);
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.011, 8, 6), eyes, head, s * 0.032, 0.045, 0.085);
  const hood = new THREE.SphereGeometry(0.145, 22, 14, Math.PI * 0.68, Math.PI * 1.64, 0, Math.PI * 0.82);
  mesh(hood.scale(1, 1.2, 1.12), robe, head, 0, 0.04, -0.01);
  // The peak, drooping back.
  const peak = mesh(new THREE.ConeGeometry(0.1, 0.22, 14).scale(1, 1, 0.9), robe, head, 0, 0.17, -0.07);
  peak.rotation.x = -0.75;
  mesh(new THREE.TorusGeometry(0.12, 0.008, 5, 24, Math.PI * 1.15).rotateZ(-Math.PI * 0.07).scale(1, 1.25, 1), gold, head, 0, 0.04, 0.08).rotation.y = 0;
  clothPanel(c, c.chest, robe, 0.28, 0.3, new THREE.Vector3(0, 0.33, -0.13), { flare: 0.6, wrap: 0.05, sweep: 0.2 });

  // Staff in the right hand: gnarled wood, an iron cage, a burning crystal.
  const R = c.arm(1);
  const grip = joint(R.hand, 0, 0, 0.03);
  // Undo the bent arm's tilt so the staff stands upright beside the hero.
  grip.rotation.x = 0.95;
  const len = 1.75;
  mesh(shaft(len), wood, grip, 0, -0.62, 0);
  mesh(new THREE.ConeGeometry(0.02, 0.06, 6).rotateX(Math.PI), iron, grip, 0, -0.65, 0);
  mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 8), leather, grip, 0, 0.02, 0);
  const headJ = joint(grip, 0, len - 0.62, 0);
  mesh(new THREE.TorusGeometry(0.03, 0.008, 5, 12).rotateX(Math.PI / 2), iron, headJ, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const prong = mesh(new THREE.TorusGeometry(0.075, 0.006, 4, 10, Math.PI * 0.75), iron, headJ, Math.cos(a) * 0.012, 0.08, Math.sin(a) * 0.012);
    prong.rotation.set(0, -a, Math.PI * 0.35);
  }
  const gem = mesh(new THREE.OctahedronGeometry(0.055, 0).scale(0.8, 1.35, 0.8), crystal, headJ, 0, 0.1, 0);
  gem.castShadow = false;
  c.hooks.push((dt, _walk, time) => {
    gem.rotation.y += dt * 0.9;
    gem.position.y = 0.1 + Math.sin(time * 2.2) * 0.008;
  });

  R.restUpper = -0.28;
  R.restFore = -0.7;
  R.swing = 0.12;
  const L = c.arm(-1);
  L.restUpper = -0.08;
  L.restFore = -0.45;
  L.swing = 0.28;

  for (const m of [robe, accent, under] as THREE.MeshStandardMaterial[]) m.side = THREE.DoubleSide;
  return c;
}
