import * as THREE from 'three';
import { audio } from '../../audio/Audio';
import { Character, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { bumpA, sculptLathe, sculptSphere, surfacePoint } from '../sculpt';
import { collapse } from '../monsters/humanoid';
import type { MonsterMaterials } from '../monsters/materials';
import type { MonsterContext } from '../Monster';
import type { Boss, BossBody, BossDef, Script } from '../Boss';
import type { Telegraph } from '../../game/Telegraph';
import { easeOut, hold, lerp, poseAction, smooth } from './common';

// Gorrath, the Many-Mouthed: a hill of stitched meat on legs like tree
// stumps. Five heads grow out of its shoulders on thick necks, each with its
// own jaw and burning eyes, and they never stop moving. Iron staples and
// chain hold the seams of its hide together.

const RED = 0xff2a12;
const BILE = new THREE.Color(0.55, 0.85, 0.08);
const BLOOD = new THREE.Color(0.32, 0.01, 0.008);

interface Head {
  root: THREE.Object3D;
  jaw: THREE.Object3D;
  neck: THREE.Object3D[];
  mouth: THREE.Object3D;
  phase: number;
  side: number;
  /** Extra jaw opening asked for by a pose (0..1). */
  open: number;
  /** Extra forward thrust asked for by a pose (0..1). */
  thrust: number;
}

function makeHead(m: MonsterMaterials, parent: THREE.Object3D, size: number, rng: Rng, eyes: number): Omit<Head, 'neck' | 'phase' | 'side' | 'open' | 'thrust'> {
  const root = joint(parent, 0, 0, 0);
  const skin = m.bruteSkin;
  // Skull: a long, low brow over a snout, lumpy and scarred.
  const seed = rng() * 10;
  mesh(
    sculptSphere(
      size,
      (x, y, z) => {
        let d = 0.25 * smooth(0.0, 0.9, z) - 0.15 * smooth(0.2, -0.8, y);
        d += 0.06 * Math.sin(x * 9 + seed) * Math.sin(y * 7 + z * 5);
        d -= 0.22 * Math.exp(-((x * x) / 0.08 + ((y + 0.15) * (y + 0.15)) / 0.05)) * smooth(0.3, 0.9, z); // mouth cleft
        return d;
      },
      new THREE.Vector3(0.95, 0.8, 1.15),
      24,
      18,
    ),
    skin,
    root,
  );
  // Eyes in a ragged row across the brow.
  for (let i = 0; i < eyes; i++) {
    const t = eyes === 1 ? 0 : i / (eyes - 1) - 0.5;
    mesh(new THREE.SphereGeometry(size * 0.13, 8, 6), m.eyeRed, root, t * size * 1.1, size * 0.32, size * 1.02 - Math.abs(t) * size * 0.25);
  }
  // Upper teeth.
  for (let i = 0; i < 7; i++) {
    const a = (i / 6 - 0.5) * 1.8;
    const tooth = mesh(new THREE.ConeGeometry(size * 0.06, size * range(rng, 0.3, 0.45), 5).rotateX(Math.PI), m.bone, root, Math.sin(a) * size * 0.62, -size * 0.18, Math.cos(a) * size * 0.95);
    tooth.rotation.x = 0.15;
  }
  // Wet dark gullet.
  const mouth = joint(root, 0, -size * 0.3, size * 0.75);
  mesh(new THREE.SphereGeometry(size * 0.5, 12, 8).scale(1, 0.5, 0.9), m.void, root, 0, -size * 0.3, size * 0.45);
  mesh(new THREE.SphereGeometry(size * 0.42, 12, 8).scale(1, 0.4, 0.9), m.wound, root, 0, -size * 0.38, size * 0.4);
  // Hinged lower jaw.
  const jaw = joint(root, 0, -size * 0.35, -size * 0.1);
  mesh(sculptSphere(size * 0.75, (x, y) => 0.05 * Math.sin(x * 10 + y * 5) - 0.3 * smooth(0, 0.8, y), new THREE.Vector3(0.85, 0.32, 1.25), 18, 12), skin, jaw, 0, 0, size * 0.55);
  for (let i = 0; i < 6; i++) {
    const a = (i / 5 - 0.5) * 1.6;
    mesh(new THREE.ConeGeometry(size * 0.055, size * range(rng, 0.25, 0.38), 5), m.bone, jaw, Math.sin(a) * size * 0.5, size * 0.14, size * 0.55 + Math.cos(a) * size * 0.45);
  }
  return { root, jaw, mouth };
}

export function buildAbomination(m: MonsterMaterials, rng: Rng, scale = 2.05): BossBody {
  const c = new Character({ scale, hunch: 0.55, stride: 1.6 });
  const skin = m.bruteSkin;
  const raw = m.wound;
  const seedA = rng() * 10;
  const lumps = (t: number, y: number) => 0.03 * Math.sin(t * 5 + seedA + y * 9) * Math.sin(y * 11 + t * 3) + 0.015 * Math.sin(t * 13 + y * 23);

  // --- Torso: a swollen barrel of meat with a hump --------------------------
  const chestGeo = sculptLathe(
    [[0.34, -0.22], [0.42, -0.06], [0.46, 0.1], [0.44, 0.26], [0.34, 0.38], [0.18, 0.45], [0.0, 0.47]],
    (_x, y, _z, t) => {
      let d = lumps(t, y);
      d += 0.08 * bumpA(t, y, Math.PI, 0.25, 0.9, 0.16); // hump
      d += 0.07 * (bumpA(t, y, 1.25, 0.3, 0.45, 0.1) + bumpA(t, y, -1.25, 0.3, 0.45, 0.1)); // shoulders
      d += 0.035 * (bumpA(t, y, 0.35, 0.12, 0.3, 0.12) + bumpA(t, y, -0.35, 0.12, 0.3, 0.12)); // slabs of chest
      d -= 0.025 * bumpA(t, y, 0, 0.0, 0.15, 0.25); // sternum groove
      return d;
    },
    { sx: 1.18, sz: 0.95, seg: 60, perSpan: 8 },
  );
  mesh(chestGeo, skin, c.chest);
  const gutGeo = sculptLathe(
    [[0.36, -0.24], [0.42, -0.1], [0.4, 0.06], [0.36, 0.22]],
    (_x, y, _z, t) => lumps(t + 2, y) + 0.06 * bumpA(t, y, 0, -0.1, 0.9, 0.12),
    { sx: 1.12, sz: 1.0, seg: 48 },
  );
  mesh(gutGeo, skin, c.spine);
  mesh(lathe([[0.36, 0.06], [0.38, -0.08], [0.33, -0.22], [0.2, -0.3]], 20).scale(1.15, 1, 1), skin, c.hips);

  // Torn patches, stitched seams with iron staples, and a ripped-open belly.
  for (let i = 0; i < 12; i++) {
    const t = range(rng, -Math.PI, Math.PI);
    const y = range(rng, -0.12, 0.34);
    const p = surfacePoint(chestGeo, y, t, -0.012);
    const patch = mesh(sculptSphere(range(rng, 0.06, 0.11), (x, yy) => 0.15 * Math.sin(x * 9 + yy * 7), new THREE.Vector3(1, 0.8, 0.3), 14, 10), raw, c.chest, p.x, p.y, p.z);
    patch.rotation.y = t;
  }
  for (const [t0, y0, t1, y1] of [[0.5, 0.35, 0.2, -0.15], [-0.9, 0.3, -0.6, -0.1], [2.4, 0.38, 2.9, -0.05]]) {
    for (let k = 0; k <= 7; k++) {
      const f = k / 7;
      const t = lerp(t0, t1, f);
      const y = lerp(y0, y1, f);
      const p = surfacePoint(chestGeo, y, t, 0.004);
      const st = mesh(new THREE.BoxGeometry(0.08, 0.012, 0.012), m.iron, c.chest, p.x, p.y, p.z);
      st.rotation.set(0, t, Math.atan2(y1 - y0, (t1 - t0) * 0.45) + Math.PI / 2);
    }
  }
  // The belly wound: a lipped gash with ribs showing through.
  mesh(new THREE.SphereGeometry(0.16, 16, 10).scale(1.3, 0.55, 0.4), raw, c.spine, 0, 0.02, 0.4);
  mesh(new THREE.SphereGeometry(0.12, 12, 8).scale(1.2, 0.4, 0.3), m.void, c.spine, 0, 0.02, 0.43);
  for (let i = 0; i < 4; i++) {
    const rib = mesh(new THREE.TorusGeometry(0.15, 0.012, 5, 14, Math.PI * 0.8).rotateX(-Math.PI / 2), m.bone, c.spine, 0, 0.07 - i * 0.04, 0.34);
    rib.rotation.z = Math.PI * 0.1;
  }

  // Chains wrapped around the torso and dragging from the waist.
  const linkGeo = new THREE.TorusGeometry(0.035, 0.011, 4, 8).scale(1, 1.5, 1);
  for (let k = 0; k < 26; k++) {
    const t = -1.8 + (k / 25) * 3.8;
    const y = 0.32 - (k / 25) * 0.42;
    const p = surfacePoint(chestGeo, y, t, 0.01);
    const l = mesh(linkGeo, m.iron, c.chest, p.x, p.y, p.z);
    l.rotation.set(k % 2 ? Math.PI / 2 : 0, t, 0.5);
  }
  const dangling: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    let parent = joint(c.hips, side * 0.3, 0.0, 0.18);
    for (let k = 0; k < 9; k++) {
      const j = joint(parent, 0, k === 0 ? 0 : -0.06, 0);
      mesh(linkGeo, m.iron, j, 0, -0.03, 0).rotation.y = k % 2 ? Math.PI / 2 : 0;
      dangling.push(j);
      parent = j;
    }
  }

  // Bone spurs breaking out of the hump, and swollen sacs that pulse.
  for (let i = 0; i < 9; i++) {
    const t = Math.PI + range(rng, -0.9, 0.9);
    const y = range(rng, 0.05, 0.38);
    const p = surfacePoint(chestGeo, y, t, -0.02);
    const len = range(rng, 0.14, 0.32);
    const spur = mesh(new THREE.ConeGeometry(0.035, len, 6).translate(0, len / 2, 0), m.bone, c.chest, p.x, p.y, p.z);
    spur.rotation.set(-0.8 + range(rng, -0.3, 0.3), t, range(rng, -0.3, 0.3), 'YXZ');
  }
  const sacs: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const t = range(rng, 1.6, 2.6) * (i % 2 ? 1 : -1);
    const y = range(rng, -0.05, 0.25);
    const p = surfacePoint(chestGeo, y, t, 0.02);
    const sac = mesh(new THREE.SphereGeometry(range(rng, 0.07, 0.11), 14, 10), m.crystal, c.chest, p.x, p.y, p.z);
    sac.userData.dynamic = true;
    sacs.push(sac);
  }

  // --- Heads -------------------------------------------------------------------
  const heads: Head[] = [];
  // The main head, low and forward between the shoulders.
  c.head.position.set(0, 0.3, 0.26);
  {
    const h = makeHead(m, c.head, 0.16, rng, 3);
    heads.push({ ...h, neck: [], phase: rng() * 10, side: 0, open: 0, thrust: 0 });
  }
  // Four more on thick necks out of the shoulders.
  for (const [x, y, z, yaw, pitch, size, eyes] of [
    [-0.24, 0.4, 0.02, -0.55, -0.55, 0.13, 2],
    [0.24, 0.4, 0.02, 0.55, -0.55, 0.13, 3],
    [-0.4, 0.3, -0.1, -1.1, -0.35, 0.11, 2],
    [0.4, 0.3, -0.1, 1.1, -0.35, 0.115, 2],
  ] as const) {
    const base = joint(c.chest, x, y, z);
    base.rotation.set(pitch, yaw, 0, 'YXZ');
    const neck: THREE.Object3D[] = [];
    let parent: THREE.Object3D = base;
    let r = 0.085;
    for (let i = 0; i < 4; i++) {
      const j = joint(parent, 0, i === 0 ? 0 : 0.11, 0);
      mesh(sculptLathe([[r, 0], [r * 1.05, 0.06], [r * 0.92, 0.12]], (_x, yy, _z, t) => 0.012 * Math.sin(t * 6 + yy * 30 + i), { seg: 16 }), skin, j);
      neck.push(j);
      parent = j;
      r *= 0.9;
    }
    const tip = joint(parent, 0, 0.12, 0.02);
    tip.rotation.x = 1.25; // head looks forward off the end of the neck
    const h = makeHead(m, tip, size, rng, eyes);
    heads.push({ ...h, neck, phase: rng() * 10, side: Math.sign(x), open: 0, thrust: 0 });
  }

  // --- Arms: enormous, knuckles nearly on the floor ---------------------------
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    a.shoulder.position.set(side * 0.5, 0.26, 0.02);
    a.fore.position.y = -0.42;
    a.hand.position.y = -0.44;
    const big = side === 1 ? 1.12 : 1;
    mesh(sculptSphere(0.2 * big, (x, _y, z) => 0.08 * Math.sin(x * 8 + z * 5 + seedA), new THREE.Vector3(1.05, 1, 1), 22, 16), skin, a.shoulder);
    mesh(sculptLathe([[0.16, 0.04], [0.17, -0.1], [0.14, -0.26], [0.11, -0.4], [0.05, -0.45], [0, -0.46]].map(([r, y]) => [r * big, y] as [number, number]), (_x, y, _z, t) => 0.03 * bumpA(t, y, 0, -0.16, 0.8, 0.1) + lumps(t, y), { seg: 26 }), skin, a.upper);
    mesh(sculptLathe([[0, 0.08], [0.11, 0.06], [0.13, -0.06], [0.12, -0.26], [0.1, -0.42], [0.08, -0.45]].map(([r, y]) => [r * big, y] as [number, number]), (_x, y, _z, t) => 0.025 * bumpA(t, y, side * 0.9, -0.08, 0.5, 0.1) + lumps(t + 1, y), { seg: 26 }), skin, a.fore);
    // Spikes along the forearm, and a fist like a boulder.
    for (let i = 0; i < 3; i++) mesh(new THREE.ConeGeometry(0.025, 0.14, 5).rotateZ(-side * 1.2), m.bone, a.fore, side * 0.12 * big, -0.1 - i * 0.1, -0.03);
    mesh(sculptSphere(0.12 * big, (x, y) => 0.08 * Math.sin(x * 12 + y * 9), new THREE.Vector3(1.05, 1.1, 1.15), 18, 14), skin, a.hand, 0, -0.07, 0.01);
    for (let f = 0; f < 4; f++) {
      const claw = mesh(new THREE.ConeGeometry(0.022, 0.2, 6).translate(0, -0.1, 0), m.bone, a.hand, (f - 1.5) * 0.05 * big, -0.15, 0.06);
      claw.rotation.set(0.6, 0, (f - 1.5) * 0.12);
    }
    a.upper.rotation.z = side * 0.35;
    a.restUpper = -0.25;
    a.restFore = -0.35;
    a.swing = 0.3;
  }

  // --- Legs: short and massive --------------------------------------------------
  for (const side of [-1, 1]) {
    const l = c.leg(side);
    l.thigh.position.x = side * 0.24;
    mesh(sculptLathe([[0.19, 0.06], [0.21, -0.1], [0.17, -0.3], [0.12, -0.44], [0, -0.48]], (_x, y, _z, t) => lumps(t, y), { seg: 26 }), skin, l.thigh);
    mesh(sculptLathe([[0, 0.06], [0.13, 0.03], [0.13, -0.12], [0.09, -0.36], [0.08, -0.44]], (_x, y, _z, t) => 0.03 * bumpA(t, y, Math.PI, -0.12, 0.7, 0.08), { seg: 24 }), skin, l.shin);
    mesh(sculptSphere(0.1, () => 0, new THREE.Vector3(1.2, 0.6, 1.6), 14, 10), skin, l.foot, 0, -0.03, 0.05);
    for (let f = 0; f < 3; f++) mesh(new THREE.ConeGeometry(0.02, 0.12, 5).rotateX(Math.PI / 2).translate(0, 0, 0.06), m.bone, l.foot, (f - 1) * 0.05, -0.05, 0.16).rotation.y = (f - 1) * 0.2;
  }
  bakeRig(c.root);

  // Everything alive about it: heads weaving and snapping, chains swinging, sacs throbbing.
  let lookYaw = 0;
  c.hooks.push((dt, w, time) => {
    lookYaw += (c.lookYaw - lookYaw) * (1 - Math.exp(-dt * 3));
    for (const h of heads) {
      const tw = time + h.phase;
      h.neck.forEach((j, i) => {
        j.rotation.x = Math.sin(tw * 1.3 - i * 0.6) * 0.14 - h.thrust * 0.25;
        j.rotation.z = Math.cos(tw * 0.9 - i * 0.7) * 0.12 + (i === 0 ? -lookYaw * 0.2 : 0);
      });
      const snap = Math.max(0, Math.sin(tw * 0.7)) ** 12; // now and then a head snaps its jaw
      h.jaw.rotation.x = 0.12 + snap * 0.5 + h.open * 0.9 + Math.sin(tw * 3) * 0.04;
      if (h.side === 0) h.root.rotation.set(Math.sin(tw * 0.8) * 0.08 - h.thrust * 0.3, lookYaw * 0.6, 0);
      else h.root.rotation.z = Math.sin(tw * 1.1) * 0.15;
    }
    dangling.forEach((j, i) => {
      j.rotation.x = Math.sin(time * 2.4 + i * 0.5) * 0.12 * (1 + w * 2);
      j.rotation.z = Math.cos(time * 1.8 + i * 0.4) * 0.08;
    });
    sacs.forEach((s, i) => s.scale.setScalar(1 + Math.max(0, Math.sin(time * 4 + i * 1.7)) ** 4 * 0.25));
  });

  const L = c.arm(-1);
  const R = c.arm(1);
  const poses: Record<string, (k: number, w: number) => void> = {
    // Rears up with both fists high, holds, then hammers the floor.
    slam: (k, w) => {
      const up = hold(k, 0.42, 0.58) * (k < 0.62 ? 1 : 0);
      const down = k >= 0.58 ? hold((k - 0.58) / 0.42, 0.08, 0.55) : 0;
      L.upper.rotation.x = lerp(L.upper.rotation.x, -2.9 * up - 0.9 * down, w);
      R.upper.rotation.x = lerp(R.upper.rotation.x, -2.9 * up - 0.9 * down, w);
      L.fore.rotation.x = lerp(L.fore.rotation.x, -0.8 * up - 0.1 * down, w);
      R.fore.rotation.x = lerp(R.fore.rotation.x, -0.8 * up - 0.1 * down, w);
      L.upper.rotation.z = lerp(L.upper.rotation.z, -0.35 + 0.2 * up, w);
      R.upper.rotation.z = lerp(R.upper.rotation.z, 0.35 - 0.2 * up, w);
      c.spine.rotation.x += (-0.55 * up + 0.75 * down) * w;
      c.hips.position.y -= 0.12 * down * w;
      for (const h of heads) h.open = up * 0.8 + down * 0.4;
    },
    // Heads lunge forward one after another to spit.
    spit: (k, w) => {
      heads.forEach((h, i) => {
        const at = 0.12 + i * 0.15;
        const f = Math.exp(-(((k - at) / 0.07) ** 2));
        h.thrust = f * w;
        h.open = (0.3 + f) * w;
      });
      c.spine.rotation.x += -0.15 * w;
    },
    // Drops low with arms swept back, about to run.
    crouch: (k, w) => {
      const s = smooth(0, 0.6, k) * w;
      L.upper.rotation.x = lerp(L.upper.rotation.x, 0.9, s);
      R.upper.rotation.x = lerp(R.upper.rotation.x, 0.9, s);
      c.spine.rotation.x += 0.55 * s;
      c.hips.position.y -= 0.14 * s;
      for (const leg of c.legs) {
        leg.thigh.rotation.x -= 0.5 * s;
        leg.shin.rotation.x += 0.8 * s;
      }
      for (const h of heads) h.open = 0.5 * s;
    },
    // Charging: head down, arms forward to batter through.
    charge: (_k, w) => {
      L.upper.rotation.x = lerp(L.upper.rotation.x, -1.3, w);
      R.upper.rotation.x = lerp(R.upper.rotation.x, -1.3, w);
      c.spine.rotation.x += 0.45 * w;
      for (const h of heads) {
        h.open = 0.7 * w;
        h.thrust = 0.6 * w;
      }
    },
    // One leg up, then stamped down.
    stomp: (k, w) => {
      const up = k < 0.5 ? smooth(0, 0.45, k) : 1 - smooth(0.5, 0.6, k);
      const leg = c.leg(1);
      leg.thigh.rotation.x -= 1.2 * up * w;
      leg.shin.rotation.x += 1.1 * up * w;
      c.spine.rotation.x += (-0.25 * up + (k > 0.5 ? 0.35 * (1 - smooth(0.6, 1, k)) : 0)) * w;
      c.spine.rotation.z = -0.15 * up * w;
      L.upper.rotation.z = lerp(L.upper.rotation.z, -0.9, up * w);
      R.upper.rotation.z = lerp(R.upper.rotation.z, 0.9, up * w);
    },
    // Rears back, arms wide, every mouth open.
    roar: (k, w) => {
      const s = hold(k, 0.18, 0.8) * w;
      L.upper.rotation.z = lerp(L.upper.rotation.z, -1.3, s);
      R.upper.rotation.z = lerp(R.upper.rotation.z, 1.3, s);
      L.upper.rotation.x = lerp(L.upper.rotation.x, -0.6, s);
      R.upper.rotation.x = lerp(R.upper.rotation.x, -0.6, s);
      L.fore.rotation.x = lerp(L.fore.rotation.x, -1.0, s);
      R.fore.rotation.x = lerp(R.fore.rotation.x, -1.0, s);
      c.spine.rotation.x += -0.5 * s;
      c.chest.rotation.y = Math.sin(k * 30) * 0.03 * s;
      for (const h of heads) {
        h.open = s;
        h.thrust = -0.4 * s;
      }
    },
    recover: (k, w) => {
      c.spine.rotation.x += 0.35 * (1 - k) * w;
    },
  };

  const body: BossBody = {
    rig: c,
    lift: 0,
    attack(onHit) {
      // A backhand swipe with the big right arm, the heads snapping in with it.
      const side = Math.random() < 0.5 ? 1 : -1;
      const A = c.arm(side);
      poseAction(
        c,
        1.1,
        (k, w) => {
          const wind = smooth(0, 0.45, k) * (1 - smooth(0.5, 0.6, k));
          const swing = smooth(0.5, 0.62, k) * (1 - smooth(0.75, 1, k));
          A.upper.rotation.x = lerp(A.upper.rotation.x, -2.2 * wind - 0.6 * swing, w);
          A.upper.rotation.z = lerp(A.upper.rotation.z, side * (0.9 * wind - 0.4 * swing), w);
          A.fore.rotation.x = lerp(A.fore.rotation.x, -1.2 * wind, w);
          c.spine.rotation.y += side * (0.45 * wind - 0.6 * swing) * w;
          for (const h of heads) h.open = (wind + swing) * 0.6;
        },
        [0.58],
        () => onHit(),
      );
      audio.whoosh(c.root.position, 1.6);
    },
    flinch() {},
    die() {
      for (const h of heads) {
        h.open = 0.9;
        h.thrust = -0.5;
      }
      collapse(c, true);
    },
    muzzle() {
      const p = new THREE.Vector3();
      heads[0].mouth.getWorldPosition(p);
      return p;
    },
    move(name, dur, hits = [], onHit) {
      const fn = poses[name];
      if (!fn) return;
      poseAction(c, dur, fn, hits, onHit);
    },
  };
  (body as BossBody & { mouths: () => THREE.Vector3[] }).mouths = () =>
    heads.map((h) => {
      const p = new THREE.Vector3();
      h.mouth.getWorldPosition(p);
      return p;
    });
  return body;
}

// ---- Abilities ---------------------------------------------------------------

const mouthsOf = (b: Boss) => (b.bossBody as BossBody & { mouths: () => THREE.Vector3[] }).mouths();

/** Rears up and brings both fists down: everything near it is crushed. */
function* slam(b: Boss, ctx: MonsterContext): Script {
  const at = b.position.clone();
  b.face(ctx.player.position, 100);
  const r = b.phase === 2 ? 7 : 6;
  b.bossBody.move('slam', 2.3, [0.6]);
  audio.charge(at, 1.3);
  b.voice('attack');
  const t = b.tele({ kind: 'circle', r }, at, 0, 1.38);
  yield 1.38;
  t.fire();
  const fx = b.fx;
  const front = at.clone().add(new THREE.Vector3(Math.sin(b.facingYaw), 0, Math.cos(b.facingYaw)).multiplyScalar(1.6));
  fx.nova(at, r + 1, new THREE.Color(1.6, 0.25, 0.08), 0.7, 1.4);
  fx.cracks(front, r * 0.9, new THREE.Color(1.8, 0.35, 0.08), 3.5);
  fx.debris(front, 34, 1.3);
  ctx.effects.shockwave(front, r, new THREE.Color(1.0, 0.4, 0.2));
  ctx.effects.flash(front.clone().setY(1), 0xff5020, 40, 12, 0.5);
  ctx.effects.addShake(1.3);
  audio.quake(front, 1.4);
  if (b.caught(ctx, t)) {
    b.hurt(ctx, 1.7);
    b.knock(ctx, at, 3);
  }
  yield 0.9;
}

/** Every head spits a glob of bile that splashes where it lands and lingers. */
function* bile(b: Boss, ctx: MonsterContext): Script {
  const count = b.phase === 2 ? 7 : 5;
  const dur = 2.4;
  const hits = Array.from({ length: count }, (_, i) => 0.14 + (i / count) * 0.68);
  const p0 = ctx.player.position.clone();
  // Where each glob will land: one on the hero, the rest scattered around them.
  const targets = hits.map((_, i) => (i === 0 ? b.floorNear(ctx, p0) : b.floorNear(ctx, p0.clone().add(new THREE.Vector3((Math.random() - 0.5) * 7, 0, (Math.random() - 0.5) * 7)), 0.5)));
  const lobT = 0.85;
  const teles = targets.map((p, i) => b.tele({ kind: 'circle', r: 1.7 }, p, 0, hits[i] * dur + lobT, 0x9aff20));
  b.face(p0, 100);
  b.bossBody.move('spit', dur, hits, (i) => {
    const mouths = mouthsOf(b);
    const from = mouths[i % mouths.length];
    audio.splash(from);
    b.fx.lob(from, targets[i], lobT, BILE, 0.22, 3.2, () => landBile(b, ctx, teles[i], targets[i]));
  });
  b.voice('attack');
  for (let t = 0; t < dur; t += b.dt) {
    b.face(ctx.player.position, 3);
    yield 0;
  }
  yield 0.6;
}

function landBile(b: Boss, ctx: MonsterContext, t: Telegraph, at: THREE.Vector3) {
  t.fire();
  audio.splash(at);
  ctx.effects.blood(at.clone().setY(0.3), at.clone().setY(-1), 26, new THREE.Color(0.25, 0.4, 0.02), 1.3);
  ctx.effects.flash(at.clone().setY(0.6), 0x9aff20, 14, 5, 0.3);
  b.fx.nova(at, 2.2, BILE, 0.4);
  if (b.caught(ctx, t)) b.hurt(ctx, 0.7, at);
  hazard(b, ctx, b.fx.pool(at, 1.6, new THREE.Color(0.35, 0.6, 0.04), 5.5), 0.22);
}

/** Lingering ground hazard: hurts the hero every half second they stand in it. */
function hazard(b: Boss, ctx: MonsterContext, pool: { pos: THREE.Vector3; radius: number; alive: () => boolean }, mult: number) {
  const holder = new THREE.Object3D();
  let tick = 0;
  ctx.effects.after(30, holder, (_k, dt) => {
    if (!pool.alive() || !b.alive) return true;
    tick -= dt;
    const p = ctx.player;
    if (tick <= 0 && p.alive && Math.hypot(p.position.x - pool.pos.x, p.position.z - pool.pos.z) < pool.radius + p.radius * 0.5) {
      tick = 0.5;
      b.hurt(ctx, mult, pool.pos);
    }
    return false;
  });
}

/** Lowers its head and charges through the hero in a straight line. */
function* charge(b: Boss, ctx: MonsterContext): Script {
  const dir = new THREE.Vector3().subVectors(ctx.player.position, b.position).setY(0).normalize();
  const yaw = Math.atan2(dir.x, dir.z);
  b.facingYaw = yaw;
  // Measure the run: up to the hero and beyond, until stone stops it.
  let len = 0;
  const want = Math.min(20, b.position.distanceTo(ctx.player.position) + 5);
  while (len < want && ctx.nav.walkable(b.position.x + dir.x * (len + 1.4), b.position.z + dir.z * (len + 1.4))) len += 0.25;
  len = Math.max(3, len);
  const windup = b.phase === 2 ? 0.85 : 1.1;
  b.bossBody.move('crouch', windup + 0.1);
  const t = b.tele({ kind: 'rect', len, w: 3 }, b.position, yaw, windup);
  audio.charge(b.position, windup);
  b.voice('aggro');
  yield windup;
  audio.whoosh(b.position, 2);
  b.bossBody.move('charge', len / 17 + 0.2);
  let hit = false;
  let run = 0;
  while (run < len) {
    const step = 17 * b.dt;
    if (!b.push(ctx, dir.x, dir.z, 17)) break;
    run += step;
    if (Math.random() < 0.6) ctx.effects.blood(b.position.clone().setY(0.2), b.position.clone().addScaledVector(dir, 2), 3, new THREE.Color(0.16, 0.12, 0.1), 1);
    const p = ctx.player;
    if (!hit && p.alive && Math.hypot(p.position.x - b.position.x, p.position.z - b.position.z) < b.radius + p.radius + 0.4) {
      hit = true;
      b.hurt(ctx, 1.5);
      // Thrown aside, off the line of the charge.
      const side = new THREE.Vector3(dir.z, 0, -dir.x);
      const s = (p.position.x - b.position.x) * side.x + (p.position.z - b.position.z) * side.z >= 0 ? 1 : -1;
      b.knock(ctx, b.position.clone().addScaledVector(side, -s * 2), 4);
      ctx.effects.addShake(0.6);
    }
    yield 0;
  }
  t.fire();
  const front = b.position.clone().addScaledVector(dir, 1.5);
  ctx.effects.shockwave(front, 3.5);
  b.fx.debris(front, 18, 1);
  b.fx.cracks(front, 2.5, new THREE.Color(1.4, 0.3, 0.08), 2);
  audio.quake(front, 1);
  ctx.effects.addShake(0.8);
  b.bossBody.move('recover', 0.8);
  yield 0.9;
}

/** Stamps, and lines of bone spikes burst out of the floor toward the hero. */
function* eruption(b: Boss, ctx: MonsterContext): Script {
  const yaw = b.yawTo(ctx.player.position);
  b.facingYaw = yaw;
  const lines = b.phase === 2 ? [-1.0, -0.5, 0, 0.5, 1.0] : [-0.55, 0, 0.55];
  const items: { at: number; t: Telegraph; p: THREE.Vector3 }[] = [];
  for (const off of lines) {
    for (let j = 0; j < 8; j++) {
      const d = 2.2 + j * 1.6;
      const p = new THREE.Vector3(b.position.x + Math.sin(yaw + off) * d, 0, b.position.z + Math.cos(yaw + off) * d);
      if (!ctx.nav.walkable(p.x, p.z)) break;
      const at = 1.0 + j * 0.14;
      items.push({ at, p, t: b.tele({ kind: 'circle', r: 1.05 }, p, 0, at, 0xe8d8b0) });
    }
  }
  items.sort((a, c) => a.at - c.at);
  b.bossBody.move('stomp', 1.1, [0.55], () => {
    ctx.effects.shockwave(b.position.clone(), 2.5);
    audio.quake(b.position, 0.8);
  });
  let now = 0;
  let hit = false;
  for (const it of items) {
    yield it.at - now;
    now = it.at;
    it.t.fire();
    b.fx.spikes(it.p, 6, 0.85, 1.7, undefined, 0.7);
    audio.slam(it.p, 0.7);
    if (!hit && b.caught(ctx, it.t)) {
      hit = true;
      b.hurt(ctx, 1.0, it.p);
    }
  }
  ctx.effects.addShake(0.4);
  yield 0.6;
}

/** Enraged: its belly splits and a brood of crawlers spills out. */
function* brood(b: Boss, ctx: MonsterContext): Script {
  b.bossBody.move('roar', 1.8);
  audio.roar('abomination', b.position);
  const spots = [0, 1, 2].slice(0, Math.max(1, b.spareMinions(ctx))).map((i) => b.floorNear(ctx, b.position.clone().add(new THREE.Vector3(Math.sin(b.facingYaw + (i - 1) * 1.1) * 3, 0, Math.cos(b.facingYaw + (i - 1) * 1.1) * 3)), 0.5));
  const teles = spots.map((p) => b.tele({ kind: 'circle', r: 1.2 }, p, 0, 1.3));
  yield 1.3;
  spots.forEach((p, i) => {
    teles[i].fire();
    b.fx.column(p, 0.7, 3, new THREE.Color(1.2, 0.08, 0.04), 0.9);
    ctx.effects.blood(p.clone().setY(0.4), p.clone().setY(-1), 40, BLOOD, 1.6);
    ctx.effects.splat(p.x, p.z, 2.2);
    audio.splash(p);
    b.summon(ctx, 'crawler', p);
  });
  yield 0.8;
}

export const ABOMINATION: BossDef = {
  epithet: 'Every mouth it has is hungry',
  color: RED,
  abilities: [
    { name: 'Cataclysm', cooldown: 9, range: [0, 5.5], weight: 1.4, run: slam },
    { name: 'Bile Barrage', cooldown: 8, range: [3, 20], run: bile },
    { name: 'Flesh Charge', cooldown: 10, range: [5, 20], run: charge },
    { name: 'Bone Eruption', cooldown: 10, range: [0, 14], run: eruption },
    { name: 'Spawn Brood', cooldown: 20, range: [0, 30], weight: 0.8, enraged: true, can: (b, ctx) => b.spareMinions(ctx) >= 2, run: brood },
  ],
  sleep(b) {
    b.bossBody.lift = -5.5;
  },
  *intro(b, ctx) {
    // It waits under a pool of blood in the middle of the vault, and rises out of it.
    const at = b.position.clone();
    b.face(ctx.player.position, 100);
    b.bossBody.lift = -5.5;
    b.hidden = false;
    b.body.rig.root.visible = true;
    audio.quake(at, 1.6);
    ctx.effects.addShake(0.6);
    const t = b.tele({ kind: 'circle', r: 3.2 }, at, 0, 1.8);
    b.fx.pool(at, 3, new THREE.Color(0.5, 0.02, 0.01), 8);
    for (let k = 0; k < 1.8; k += b.dt) {
      if (Math.random() < 0.4) ctx.effects.blood(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 0.1, (Math.random() - 0.5) * 4)), at.clone().setY(-2), 6, BLOOD, 1.2);
      yield 0;
    }
    t.fire();
    b.fx.column(at, 2.2, 7, new THREE.Color(1.3, 0.06, 0.03), 1.6);
    ctx.effects.splat(at.x, at.z, 6);
    audio.splash(at);
    yield* b.over(1.5, (k) => {
      b.bossBody.lift = -5.5 * (1 - easeOut(k));
      b.face(ctx.player.position, 4);
      ctx.effects.blood(b.position.clone().setY(1.5 + Math.random() * 2), b.position.clone().setY(-3), 5, BLOOD, 1.6);
    });
    b.bossBody.lift = 0;
    b.bossBody.move('roar', 2.4);
    audio.roar('abomination', b.position);
    ctx.effects.addShake(1.0);
    b.fx.nova(at, 9, new THREE.Color(1.4, 0.1, 0.05), 0.9, 1.6);
    ctx.banner?.(b.name, ABOMINATION.epithet);
    yield 2.3;
  },
  *enrage(b, ctx) {
    b.bossBody.move('roar', 2.2);
    audio.roar('abomination', b.position);
    ctx.banner?.(`${b.name} Rages`, 'Its seams split and the brood stirs inside');
    for (let i = 0; i < 4; i++) b.fx.column(b.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)), 0.5, 5, new THREE.Color(1.2, 0.05, 0.03), 1.4);
    ctx.effects.blood(b.position.clone().setY(3), b.position.clone(), 80, BLOOD, 2.2);
    b.fx.nova(b.position, 8, new THREE.Color(1.5, 0.1, 0.05), 0.8, 1.2);
    ctx.effects.addShake(0.9);
    yield 2.2;
  },
  death(b, ctx) {
    const at = b.position.clone();
    audio.roar('abomination', at);
    ctx.effects.blood(at.clone().setY(2.5), at.clone().setY(0), 160, BLOOD, 2.6);
    for (let i = 0; i < 4; i++) ctx.effects.splat(at.x + (Math.random() - 0.5) * 4, at.z + (Math.random() - 0.5) * 4, 4);
    b.fx.column(at, 2, 8, new THREE.Color(1.4, 0.1, 0.05), 2);
    b.fx.debris(at, 20, 1);
    ctx.effects.addShake(1.4);
    setTimeout(() => audio.quake(at, 1.6), 700);
  },
};
