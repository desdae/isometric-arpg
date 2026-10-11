import * as THREE from 'three';
import { Character, clothPanel, lathe, mesh } from '../Character';
import { pick, range, type Rng } from '../../procgen/noise';

// Townsfolk: robes or tunics, hoods or bare heads, aprons, beards and a prop
// in hand, all varied from a seed. Clothing materials are tinted linen.

export type VillagerProp = 'none' | 'staff' | 'lantern' | 'hammer' | 'basket' | 'book';

export interface VillagerLook {
  robe: THREE.Material;
  under: THREE.Material;
  accent: THREE.Material;
  skin: THREE.Material;
  hair: THREE.Material;
  leather: THREE.Material;
  wood: THREE.Material;
  iron: THREE.Material;
  glow: THREE.Material;
  dark: THREE.Material;
  longRobe: boolean;
  hood: boolean;
  apron: boolean;
  beard: boolean;
  bald: boolean;
  prop: VillagerProp;
}

const PALETTE = [
  [0.08, 0.06, 0.05], // soot brown
  [0.05, 0.05, 0.055], // charcoal
  [0.12, 0.03, 0.025], // dried blood
  [0.06, 0.065, 0.045], // moss
  [0.1, 0.085, 0.06], // undyed wool
  [0.035, 0.03, 0.05], // dusk violet
];
const SKIN = [0x8a6a58, 0x9c7b66, 0x6e5040, 0xa88a78, 0x5a4034];
const HAIR = [0x1a1410, 0x3a2a1e, 0x6a6058, 0x2a1a12, 0x8a8278];

/** Random but coherent look for a townsperson. */
export function randomLook(
  rng: Rng,
  shared: { linen: THREE.MeshStandardMaterial; leather: THREE.Material; wood: THREE.Material; iron: THREE.Material; glow: THREE.Material; dark: THREE.Material },
  overrides: Partial<VillagerLook> = {},
): VillagerLook {
  const tint = (c: number[]) => {
    const m = shared.linen.clone();
    // Linen albedo is ~0.3; scale the dye so the result lands on the palette.
    m.color.setRGB(c[0] * 3.2, c[1] * 3.2, c[2] * 3.2);
    return m;
  };
  return {
    robe: tint(pick(rng, PALETTE)),
    under: tint(pick(rng, PALETTE)),
    accent: tint(pick(rng, PALETTE)),
    skin: new THREE.MeshStandardMaterial({ color: pick(rng, SKIN), roughness: 0.65 }),
    hair: new THREE.MeshStandardMaterial({ color: pick(rng, HAIR), roughness: 0.85 }),
    leather: shared.leather,
    wood: shared.wood,
    iron: shared.iron,
    glow: shared.glow,
    dark: shared.dark,
    longRobe: rng() < 0.5,
    hood: rng() < 0.55,
    apron: rng() < 0.3,
    beard: rng() < 0.4,
    bald: rng() < 0.25,
    prop: pick(rng, ['none', 'none', 'staff', 'lantern', 'basket', 'book'] as const),
    ...overrides,
  };
}

export function dressVillager(c: Character, look: VillagerLook, rng: Rng): Character {
  const { robe, under, accent, skin, hair, leather } = look;

  // Legs: hose and turnshoe boots.
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = c.leg(side);
    mesh(lathe([[0.075, 0], [0.07, -0.2], [0.055, -0.42]], 10), under, thigh, 0, 0, 0);
    mesh(lathe([[0.055, 0], [0.058, -0.15], [0.045, -0.38]], 10), under, shin, 0, -0.02, 0);
    mesh(lathe([[0.05, 0.02], [0.058, -0.06]], 10), leather, shin, 0, -0.34, 0);
    mesh(new THREE.BoxGeometry(0.09, 0.07, 0.22).translate(0, -0.03, 0.05), leather, foot, 0, 0, 0);
  }

  // Torso: a belted tunic, flattened front to back.
  const tunic = lathe(
    [
      [0.0, -0.2],
      [0.18, -0.2],
      [0.2, -0.05],
      [0.2, 0.12],
      [0.17, 0.24],
      [0.09, 0.3],
      [0.06, 0.31],
    ],
    16,
  ).scale(1.05, 1, 0.8);
  mesh(tunic, robe, c.chest, 0, 0, 0);
  mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.18, 14).scale(1, 1, 0.82), robe, c.spine, 0, 0.02, 0);
  // Skirt: knee length or a full robe to the ankles, flared at the hem.
  const hem = look.longRobe ? -0.82 : -0.42;
  const flare = look.longRobe ? 0.34 : 0.26;
  mesh(lathe([[0.17, 0.08], [0.21, -0.1], [flare, hem]], 18).scale(1, 1, 0.85), robe, c.hips, 0, 0, 0);
  // Rope or leather belt.
  mesh(new THREE.TorusGeometry(0.175, 0.016, 5, 20).rotateX(Math.PI / 2).scale(1.02, 1, 0.82), look.longRobe ? accent : leather, c.spine, 0, -0.04, 0);
  if (look.apron) {
    const apron = new THREE.PlaneGeometry(0.3, 0.6, 1, 4).translate(0, -0.3, 0);
    const a = mesh(apron, leather, c.hips, 0, 0.05, 0.19);
    a.rotation.x = -0.12;
  }
  // Mantle over the shoulders.
  mesh(lathe([[0.1, 0.1], [0.24, -0.02], [0.27, -0.14]], 16).scale(1, 1, 0.85), accent, c.chest, 0, 0.2, 0);

  // Arms: loose sleeves widening at the wrist, bare hands.
  for (const side of [-1, 1]) {
    const arm = c.arm(side);
    mesh(lathe([[0.065, 0.02], [0.07, -0.15], [0.07, -0.29]], 10), robe, arm.upper, 0, 0, 0);
    mesh(lathe([[0.065, 0.02], [0.08, -0.15], [0.1, -0.27]], 10), robe, arm.fore, 0, 0, 0);
    mesh(new THREE.SphereGeometry(0.045, 8, 6).scale(0.9, 1.2, 0.7), skin, arm.hand, 0, 0.0, 0);
    arm.restUpper = -0.05 + range(rng, -0.05, 0.05);
    arm.restFore = -0.35 + range(rng, -0.1, 0.1);
    arm.swing = 0.3;
  }

  // Head: skull, jaw, nose, brow and shadowed eyes.
  const head = c.head;
  mesh(new THREE.SphereGeometry(0.1, 16, 12).scale(0.92, 1.08, 1), skin, head, 0, 0.04, 0);
  mesh(new THREE.SphereGeometry(0.075, 12, 8).scale(1, 0.8, 1), skin, head, 0, -0.03, 0.02);
  mesh(new THREE.ConeGeometry(0.018, 0.05, 6).rotateX(Math.PI / 2), skin, head, 0, 0.03, 0.1);
  mesh(new THREE.BoxGeometry(0.13, 0.018, 0.03), skin, head, 0, 0.065, 0.085);
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.011, 6, 4), look.dark, head, s * 0.035, 0.047, 0.088);
  mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), skin, head, 0, -0.1, -0.01);
  if (look.beard) {
    mesh(new THREE.ConeGeometry(0.07, 0.16, 10).rotateX(Math.PI).scale(1, 1, 0.7), hair, head, 0, -0.1, 0.05);
  }
  if (look.hood) {
    // Deep cowl: an open-fronted shell around the head, with a drape behind.
    const cowl = new THREE.SphereGeometry(0.135, 18, 12, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.8);
    mesh(cowl.scale(1, 1.15, 1.08), look.robe, head, 0, 0.04, -0.005);
    clothPanel(c, c.chest, look.robe, 0.3, 0.32, new THREE.Vector3(0, 0.33, -0.12), { flare: 0.6, wrap: 0.05, sweep: 0.2 });
  } else if (!look.bald) {
    mesh(new THREE.SphereGeometry(0.106, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.05, 1.03), hair, head, 0, 0.045, -0.008);
  }

  // Prop in the right hand.
  const hand = c.arm(1).hand;
  switch (look.prop) {
    case 'staff': {
      const staff = new THREE.CylinderGeometry(0.018, 0.022, 1.7, 6);
      const m = mesh(staff, look.wood, hand, 0, 0.35, 0.03);
      m.rotation.x = 0.1;
      mesh(new THREE.SphereGeometry(0.035, 6, 5), look.wood, m, 0, 0.86, 0);
      c.arm(1).restUpper = -0.25;
      c.arm(1).restFore = -0.75;
      c.arm(1).swing = 0.12;
      break;
    }
    case 'lantern': {
      const g = new THREE.Group();
      g.position.set(0, -0.12, 0.02);
      hand.add(g);
      mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), look.glow, g, 0, -0.06, 0);
      mesh(new THREE.ConeGeometry(0.08, 0.06, 4).rotateY(Math.PI / 4), look.iron, g, 0, 0.04, 0);
      mesh(new THREE.BoxGeometry(0.11, 0.015, 0.11), look.iron, g, 0, -0.135, 0);
      c.arm(1).restFore = -0.2;
      break;
    }
    case 'hammer': {
      const m = mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.45, 6), look.wood, hand, 0, -0.12, 0.03);
      mesh(new THREE.BoxGeometry(0.06, 0.06, 0.14), look.iron, m, 0, -0.22, 0);
      break;
    }
    case 'basket': {
      const left = c.arm(-1);
      const b = lathe([[0.0, 0], [0.12, 0.01], [0.15, 0.14], [0.14, 0.15]], 12);
      mesh(b, look.wood, left.hand, 0, -0.18, 0.04);
      mesh(new THREE.TorusGeometry(0.1, 0.01, 4, 12, Math.PI), look.wood, left.hand, 0, -0.04, 0.04);
      left.restFore = -0.15;
      left.swing = 0.1;
      break;
    }
    case 'book': {
      mesh(new THREE.BoxGeometry(0.15, 0.04, 0.2), look.leather, hand, 0, 0.0, 0.07);
      c.arm(1).restUpper = -0.35;
      c.arm(1).restFore = -1.3;
      c.arm(1).swing = 0.05;
      break;
    }
    case 'none':
      break;
  }
  return c;
}
