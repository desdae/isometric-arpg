import * as THREE from 'three';
import { Character, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { bumpA, sculptLathe, sculptSphere, surfacePoint } from '../sculpt';
import { collapse, flinch, keyedAction } from './humanoid';
import type { MonsterBody, MonsterMaterials } from './materials';

// Flesh horror: a hunched heap of flayed meat on two thick legs. Its chest
// splits into a vertical maw ringed with teeth, long arms end in bone hooks,
// and tentacles writhe from its back. Lives in the crypts under the fields.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildHorror(m: MonsterMaterials, rng: Rng, scale = range(rng, 1.25, 1.4)): MonsterBody {
  const c = new Character({ scale, hunch: 0.75, stride: 1.4 });
  const skin = m.bruteSkin;
  const raw = m.wound;
  const seedA = rng() * 10;
  const seedB = rng() * 10;

  // --- Torso with the maw ----------------------------------------------
  const lumps = (t: number, y: number) => 0.022 * Math.sin(t * 5 + seedA + y * 9) * Math.sin(y * 13 + t * 3 + seedB) + 0.012 * Math.sin(t * 11 + y * 21);
  const MAW_TOP = 0.32;
  const MAW_BOTTOM = -0.15;
  const chestGeo = sculptLathe(
    [[0.24, -0.2], [0.31, -0.06], [0.34, 0.08], [0.32, 0.22], [0.24, 0.32], [0.14, 0.38], [0.0, 0.41]],
    (_x, y, _z, t) => {
      const inMaw = smooth(MAW_BOTTOM - 0.02, MAW_BOTTOM + 0.06, y) * (1 - smooth(MAW_TOP - 0.06, MAW_TOP + 0.02, y));
      let d = lumps(t, y) * (1 - smooth(0.3, 0.4, y));
      d -= 0.17 * Math.exp(-((t / 0.22) ** 2)) * inMaw; // the split
      d += 0.035 * (bumpA(t, y, 0.32, 0.1, 0.12, 0.2) + bumpA(t, y, -0.32, 0.1, 0.12, 0.2)) * inMaw; // swollen lips
      d += 0.06 * bumpA(t, y, 1.2, 0.26, 0.4, 0.08) + 0.06 * bumpA(t, y, -1.2, 0.26, 0.4, 0.08); // hunched shoulders
      d += 0.05 * bumpA(t, y, Math.PI, 0.2, 0.7, 0.12); // humped back
      return d;
    },
    { sx: 1.12, sz: 0.95, seg: 56, perSpan: 8 },
  );
  mesh(chestGeo, skin, c.chest);
  // Wet throat inside the split.
  mesh(new THREE.SphereGeometry(0.16, 16, 12).scale(0.6, 1.35, 0.6), raw, c.chest, 0, 0.09, 0.17);
  mesh(new THREE.SphereGeometry(0.1, 12, 10).scale(0.5, 1.4, 0.5), m.void, c.chest, 0, 0.09, 0.2);
  // Teeth along both lips, angled in toward the gap, plus a tongue.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const y = MAW_BOTTOM + 0.03 + (i / 8) * (MAW_TOP - MAW_BOTTOM - 0.06);
      const p = surfacePoint(chestGeo, y, s * 0.26, -0.012);
      const len = range(rng, 0.06, 0.1) * (1 - Math.abs(i - 4) / 10);
      const tooth = mesh(new THREE.ConeGeometry(0.014, len, 5).translate(0, len / 2, 0), m.bone, c.chest, p.x, p.y, p.z);
      tooth.rotation.set(0, 0, s * (Math.PI / 2 + range(rng, -0.25, 0.25)));
      tooth.rotateX(range(rng, -0.3, 0.3));
    }
  }
  mesh(lathe([[0.0, 0.02], [0.03, 0.0], [0.035, -0.12], [0.02, -0.2], [0.0, -0.22]], 10).rotateX(-0.5), raw, c.chest, 0, 0.0, 0.2);

  // Raw, glistening patches torn through the skin.
  for (let i = 0; i < 9; i++) {
    const t = range(rng, -Math.PI, Math.PI);
    if (Math.abs(t) < 0.45) continue;
    const y = range(rng, -0.12, 0.3);
    const p = surfacePoint(chestGeo, y, t, -0.01);
    const patch = mesh(sculptSphere(range(rng, 0.05, 0.09), (x, yy) => 0.15 * Math.sin(x * 9 + yy * 7), new THREE.Vector3(1, 0.8, 0.35), 14, 10), raw, c.chest, p.x, p.y, p.z);
    patch.rotation.y = t;
  }
  // Bone spurs breaking out along the hump.
  for (let i = 0; i < 6; i++) {
    const t = Math.PI + range(rng, -0.7, 0.7);
    const y = range(rng, 0.05, 0.3);
    const p = surfacePoint(chestGeo, y, t, -0.02);
    const len = range(rng, 0.1, 0.2);
    const spur = mesh(new THREE.ConeGeometry(0.025, len, 6).translate(0, len / 2, 0), m.bone, c.chest, p.x, p.y, p.z);
    spur.rotation.set(-0.9 + range(rng, -0.3, 0.3), t, range(rng, -0.3, 0.3), 'YXZ');
  }

  // Gut hanging over the hips.
  const gutGeo = sculptLathe(
    [[0.26, -0.2], [0.29, -0.08], [0.27, 0.06], [0.25, 0.22]],
    (_x, y, _z, t) => lumps(t + 1, y) + 0.04 * bumpA(t, y, 0, -0.08, 0.8, 0.1),
    { sx: 1.1, sz: 0.95, seg: 44 },
  );
  mesh(gutGeo, skin, c.spine);
  mesh(lathe([[0.27, 0.06], [0.29, -0.06], [0.26, -0.2], [0.18, -0.3]], 18).scale(1.1, 1, 0.92), skin, c.hips);

  // --- Head: a blind lump sunk into the shoulders ------------------------
  c.head.position.set(0, 0.3, 0.12);
  mesh(sculptSphere(0.1, (x, y, z) => 0.1 * Math.sin(x * 7 + y * 5) * Math.sin(z * 6) - 0.25 * smooth(0.0, -0.8, y), new THREE.Vector3(1, 0.85, 1.05), 24, 18), skin, c.head, 0, 0.04, 0);
  for (const [x, y] of [[-0.03, 0.07], [0.03, 0.07], [-0.055, 0.045], [0.055, 0.045]]) mesh(new THREE.SphereGeometry(0.011, 8, 6), m.eyeRed, c.head, x, y, 0.095);

  // --- Arms: long, sinewy, bone hooks for fingers -----------------------
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    a.shoulder.position.x *= 1.35;
    a.shoulder.position.y = 0.2;
    a.fore.position.y = -0.36;
    a.hand.position.y = -0.4;
    mesh(sculptSphere(0.13, (x, _y, z) => 0.1 * Math.sin(x * 8 + z * 5 + seedA), new THREE.Vector3(1, 1.1, 1), 20, 16), skin, a.shoulder);
    mesh(sculptLathe([[0.11, 0.03], [0.118, -0.08], [0.1, -0.22], [0.075, -0.36], [0.035, -0.41], [0.0, -0.42]], (_x, y, _z, t) => 0.025 * bumpA(t, y, 0, -0.14, 0.7, 0.08) + lumps(t, y) * 0.6, { seg: 24 }), skin, a.upper);
    mesh(sculptLathe([[0.0, 0.07], [0.07, 0.05], [0.095, -0.04], [0.085, -0.2], [0.06, -0.38], [0.05, -0.41]], (_x, y, _z, t) => 0.02 * bumpA(t, y, side * 0.9, -0.06, 0.5, 0.08), { seg: 24 }), skin, a.fore);
    mesh(sculptSphere(0.06, () => 0, new THREE.Vector3(0.9, 1.1, 1.1), 14, 10), skin, a.hand, 0, -0.04, 0);
    for (let f = 0; f < 3; f++) {
      const claw = mesh(new THREE.ConeGeometry(0.016, 0.24, 6).translate(0, -0.12, 0), m.bone, a.hand, (f - 1) * 0.03, -0.07, 0.03);
      claw.rotation.set(0.5 + f * 0.05, 0, (f - 1) * 0.15);
    }
    a.upper.rotation.z = side * 0.3;
    a.restUpper = -0.35;
    a.restFore = -0.5;
    a.swing = 0.25;
  }

  // --- Tentacles writhing from the back ---------------------------------
  const tentacles: { joints: THREE.Object3D[]; phase: number; side: number }[] = [];
  for (const [side, y, t] of [[-1, 0.28, Math.PI - 0.6], [1, 0.28, Math.PI + 0.6], [-1, 0.12, Math.PI - 1.0], [1, 0.12, Math.PI + 1.0]] as const) {
    const p = surfacePoint(chestGeo, y, t, -0.02);
    let parent: THREE.Object3D = joint(c.chest, p.x, p.y, p.z);
    parent.rotation.set(1.0, t, side * 0.4, 'YXZ');
    const joints: THREE.Object3D[] = [];
    let r = 0.05;
    for (let i = 0; i < 8; i++) {
      const j = joint(parent, 0, i === 0 ? 0 : 0.1, 0);
      mesh(new THREE.CylinderGeometry(r * 0.85, r, 0.11, 10).translate(0, 0.05, 0), skin, j);
      mesh(new THREE.SphereGeometry(r * 0.95, 10, 8), skin, j);
      if (i > 1 && i % 2 === 0) mesh(new THREE.ConeGeometry(0.008, 0.035, 4).rotateZ(Math.PI / 2), m.bone, j, r * 0.85, 0.05, 0);
      joints.push(j);
      parent = j;
      r *= 0.84;
    }
    tentacles.push({ joints, phase: rng() * 10, side });
  }
  c.hooks.push((_dt, w, time) => {
    for (const tn of tentacles) {
      tn.joints.forEach((j, i) => {
        if (i === 0) return;
        j.rotation.x = Math.sin(time * (2.2 + w) + tn.phase - i * 0.7) * 0.3 + 0.22;
        j.rotation.z = Math.cos(time * 1.7 + tn.phase - i * 0.9) * 0.28 * tn.side;
      });
    }
  });

  // --- Legs: short, massive, clawed ---------------------------------------
  for (const side of [-1, 1]) {
    const l = c.leg(side);
    mesh(sculptLathe([[0.14, 0.04], [0.15, -0.1], [0.12, -0.3], [0.09, -0.44], [0.0, -0.48]], (_x, y, _z, t) => lumps(t, y), { seg: 24 }), skin, l.thigh);
    mesh(sculptLathe([[0.0, 0.05], [0.09, 0.02], [0.095, -0.12], [0.065, -0.36], [0.06, -0.44]], (_x, y, _z, t) => 0.03 * bumpA(t, y, Math.PI, -0.12, 0.7, 0.08), { seg: 24 }), skin, l.shin);
    mesh(sculptSphere(0.075, () => 0, new THREE.Vector3(1.1, 0.6, 1.6), 14, 10), skin, l.foot, 0, -0.03, 0.04);
    for (let f = 0; f < 3; f++) {
      const claw = mesh(new THREE.ConeGeometry(0.014, 0.1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.05), m.bone, l.foot, (f - 1) * 0.04, -0.05, 0.13);
      claw.rotation.y = (f - 1) * 0.2;
    }
  }
  c.legs.forEach((l) => (l.thigh.position.x *= 1.4));
  bakeRig(c.root);

  return {
    rig: c,
    attack(onHit) {
      // Rears up with both hooks raised, then rakes them down and lunges the maw.
      keyedAction(
        c,
        1.05,
        [
          { k: 0, uL: -0.35, uR: -0.35, fL: -0.5, fR: -0.5, zL: -0.3, zR: 0.3, s: 0 },
          { k: 0.4, uL: -2.6, uR: -2.6, fL: -0.9, fR: -0.9, zL: -0.6, zR: 0.6, s: -0.45 },
          { k: 0.55, uL: -0.4, uR: -0.4, fL: -0.2, fR: -0.2, zL: 0.1, zR: -0.1, s: 0.6 },
          { k: 0.75, uL: -0.4, uR: -0.4, fL: -0.2, fR: -0.2, zL: 0.1, zR: -0.1, s: 0.5 },
          { k: 1, uL: -0.35, uR: -0.35, fL: -0.5, fR: -0.5, zL: -0.3, zR: 0.3, s: 0 },
        ],
        0.55,
        onHit,
      );
    },
    flinch: () => flinch(c, 0.2),
    die: () => collapse(c, true),
  };
}
