import * as THREE from 'three';
import { audio } from '../../audio/Audio';
import { Character, clothPanel, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { sculptSphere } from '../sculpt';
import { collapse } from '../monsters/humanoid';
import type { MonsterMaterials } from '../monsters/materials';
import type { MonsterContext } from '../Monster';
import type { Boss, BossBody, BossDef, Script } from '../Boss';
import type { Telegraph } from '../../game/Telegraph';
import { auraMaterial } from '../../game/BossFx';
import { easeOut, hold, lerp, poseAction, smooth } from './common';

// Malgrave, the Hollow King: a dead king in blackened, spined plate, crowned
// with iron horns, drifting a hand above the floor in a cloak of violet
// witch-fire. Nothing is inside the helm but two cold flames. He carries a
// greatsword taller than a man, its fuller burning with runes.

const VIOLET = 0xb050ff;
const SOUL = new THREE.Color(0.7, 0.25, 1.6);
const SOUL_HOT = new THREE.Color(1.2, 0.7, 2.2);

type V2 = [number, number];
const plate = (pts: V2[], seg = 28, per = 5) => {
  const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.LatheGeometry(curve.getPoints((pts.length - 1) * per), seg);
};

/** A row of backswept spines (pauldrons, crown, spine of the back). */
function spines(parent: THREE.Object3D, mat: THREE.Material, n: number, place: (i: number) => [number, number, number, number, number, number], len: number, r: number) {
  for (let i = 0; i < n; i++) {
    const [x, y, z, rx, ry, rz] = place(i);
    const s = mesh(new THREE.ConeGeometry(r, len * (0.75 + 0.5 * Math.sin(i * 2.3) ** 2), 5).translate(0, len / 2, 0), mat, parent, x, y, z);
    s.rotation.set(rx, ry, rz);
  }
}

export function buildLich(m: MonsterMaterials, rng: Rng, scale = 1.95): BossBody {
  const c = new Character({ scale, hunch: 0.05, stride: 1.7 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1a1820, metalness: 0.9, roughness: 0.42, emissive: new THREE.Color(0.02, 0.0, 0.04) });
  const edge = new THREE.MeshStandardMaterial({ color: 0x4a3a5a, metalness: 1, roughness: 0.3 });
  const iron = m.iron;
  const cloth = new THREE.MeshStandardMaterial({ color: 0x120c18, roughness: 0.95, side: THREE.DoubleSide, emissive: new THREE.Color(0.015, 0.0, 0.03) });
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.5, 4), fog: false });
  const rune = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.35, 2.6), fog: false });

  // Hips: a skirt of riveted lames over hanging rags.
  for (let i = 0; i < 4; i++) {
    const r0 = 0.19 + i * 0.022;
    mesh(plate([[r0, 0], [r0 + 0.015, -0.05], [r0 + 0.04, -0.1]], 28, 3).scale(1, 1, 0.82), i % 2 ? edge : black, c.hips, 0, 0.05 - i * 0.07, 0);
  }
  clothPanel(c, c.hips, cloth, 0.42, 0.9, new THREE.Vector3(0, -0.12, 0.2), { flare: 0.5, wrap: 0.08, sweep: 0.3 });
  clothPanel(c, c.hips, cloth, 0.5, 0.95, new THREE.Vector3(0, -0.12, -0.18), { flare: 0.6, wrap: -0.08, sweep: 0.5 });

  // Cuirass: deep-chested, waisted, with a ridged plastron and a skull boss.
  const cuirass = plate([[0.0, -0.2], [0.19, -0.2], [0.21, -0.08], [0.25, 0.06], [0.27, 0.18], [0.22, 0.28], [0.13, 0.33], [0.06, 0.34]], 36).scale(1.12, 1, 0.8);
  mesh(cuirass, black, c.chest, 0, 0, 0.01);
  mesh(new THREE.BoxGeometry(0.02, 0.42, 0.03), edge, c.chest, 0, 0.06, 0.205);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) mesh(new THREE.TorusGeometry(0.1 - i * 0.012, 0.008, 4, 16, Math.PI * 0.9).rotateZ(s > 0 ? -0.2 : Math.PI + 0.2), edge, c.chest, s * 0.11, 0.18 - i * 0.07, 0.19 - i * 0.008);
  }
  // A skull set into the breastplate, its sockets lit from within.
  const skull = sculptSphere(0.07, (x, y, z) => -0.25 * (Math.exp(-(((x + 0.35) ** 2 + (y - 0.1) ** 2) / 0.03)) + Math.exp(-(((x - 0.35) ** 2 + (y - 0.1) ** 2) / 0.03))) * smooth(0.3, 0.9, z), new THREE.Vector3(0.9, 1, 0.6), 18, 14);
  mesh(skull, m.bone, c.chest, 0, 0.12, 0.21);
  for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(0.012, 6, 4), eyeMat, c.chest, s * 0.024, 0.128, 0.252);
  // Backplate spines down the back.
  spines(c.chest, black, 6, (i) => [0, 0.3 - i * 0.075, -0.2, -2.2, 0, 0], 0.14, 0.022);
  // Gorget.
  mesh(plate([[0.15, 0], [0.13, 0.05], [0.1, 0.08]], 28, 3), edge, c.chest, 0, 0.29, 0);

  // Helm: a closed, bucket-crowned helm with a T-slit, horned iron crown above.
  c.head.position.y = 0.42;
  const helm = plate([[0.0, -0.15], [0.11, -0.15], [0.125, -0.05], [0.128, 0.06], [0.12, 0.13], [0.08, 0.17], [0.0, 0.18]], 32).scale(0.95, 1, 1.1);
  mesh(helm, black, c.head, 0, 0.02, 0);
  mesh(new THREE.BoxGeometry(0.17, 0.02, 0.04), m.void, c.head, 0, 0.05, 0.118);
  mesh(new THREE.BoxGeometry(0.025, 0.1, 0.04), m.void, c.head, 0, 0.0, 0.122);
  const eyes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) eyes.push(mesh(new THREE.SphereGeometry(0.016, 8, 6).scale(1.6, 0.8, 1), eyeMat, c.head, s * 0.04, 0.05, 0.12));
  // Crown: a circlet of iron with tall, backswept horns.
  mesh(new THREE.TorusGeometry(0.13, 0.014, 5, 24).rotateX(Math.PI / 2).scale(0.95, 1, 1.1), iron, c.head, 0, 0.12, 0);
  spines(c.head, iron, 9, (i) => {
    const a = ((i - 4) / 8) * Math.PI * 1.25;
    return [Math.sin(a) * 0.12, 0.13, Math.cos(a) * 0.13, -0.25 - Math.abs(i - 4) * 0.04, a, 0];
  }, 0.13, 0.014);
  for (const s of [-1, 1]) {
    // Two great horns curling back from the temples.
    let parent: THREE.Object3D = joint(c.head, s * 0.11, 0.1, 0.0);
    parent.rotation.set(-0.5, 0, s * -0.7);
    let r = 0.03;
    for (let i = 0; i < 6; i++) {
      const j = joint(parent, 0, i === 0 ? 0 : 0.07, 0);
      j.rotation.set(-0.32, 0, s * 0.12);
      mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.075, 8).translate(0, 0.037, 0), iron, j);
      parent = j;
      r *= 0.8;
    }
  }

  // Arms: spined pauldrons, plate and clawed gauntlets.
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    a.shoulder.position.x = side * 0.3;
    for (let i = 0; i < 4; i++) {
      const g = new THREE.SphereGeometry(0.17 - i * 0.012, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.15, 0.8, 1.05).rotateZ(-side * (0.3 + i * 0.14));
      mesh(g, i % 2 ? edge : black, a.shoulder, side * i * 0.026, 0.05 - i * 0.045, 0);
    }
    spines(a.shoulder, black, 4, (i) => [side * (0.05 + i * 0.03), 0.14 - i * 0.02, -0.04 + i * 0.03, -0.5, 0, -side * (0.4 + i * 0.15)], 0.2, 0.025);
    mesh(plate([[0.065, 0.02], [0.07, -0.08], [0.066, -0.2], [0.058, -0.28]], 22), black, a.upper);
    mesh(new THREE.SphereGeometry(0.07, 18, 12), edge, a.fore);
    mesh(new THREE.ConeGeometry(0.03, 0.14, 5).rotateX(Math.PI / 2 + 0.6), black, a.fore, 0, 0.01, -0.07);
    mesh(plate([[0.058, 0], [0.064, -0.1], [0.058, -0.2], [0.05, -0.26]], 22), black, a.fore, 0, -0.02, 0);
    mesh(plate([[0.05, 0], [0.068, -0.05], [0.085, -0.09]], 22, 3), edge, a.fore, 0, -0.22, 0);
    mesh(new THREE.SphereGeometry(0.055, 16, 10).scale(0.9, 1.05, 1), black, a.hand, 0, -0.01, 0.012);
    for (let f = 0; f < 4; f++) {
      const claw = mesh(new THREE.ConeGeometry(0.012, 0.09, 5).translate(0, -0.045, 0), iron, a.hand, (f - 1.5) * 0.024, -0.05, 0.035);
      claw.rotation.x = 0.7;
    }
    a.restUpper = -0.15;
    a.restFore = -0.45;
    a.swing = 0.2;
  }

  // The greatsword, held in the right hand.
  const grip = joint(c.arm(1).hand, 0, -0.02, 0.02);
  grip.rotation.x = Math.PI / 2 + 0.1;
  const BL = 1.3;
  {
    const shape = new THREE.Shape();
    const w = 0.055;
    shape.moveTo(-w, 0);
    shape.lineTo(-w * 1.1, BL * 0.7);
    shape.quadraticCurveTo(-w * 0.9, BL * 0.92, 0, BL);
    shape.quadraticCurveTo(w * 0.9, BL * 0.92, w * 1.1, BL * 0.7);
    shape.lineTo(w, 0);
    const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 1 }).translate(0, 0.16, -0.006);
    mesh(blade, black, grip);
    // Burning runes down the fuller.
    for (let i = 0; i < 9; i++) mesh(new THREE.BoxGeometry(0.018, 0.05 + (i % 3) * 0.02, 0.022), rune, grip, 0, 0.26 + i * 0.12, 0);
    mesh(new THREE.BoxGeometry(0.34, 0.035, 0.05), iron, grip, 0, 0.14, 0);
    for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.02, 0.1, 5).rotateZ(-s * Math.PI / 2 - s * 0.5), iron, grip, s * 0.19, 0.16, 0);
    mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.28, 8), m.leather, grip, 0, 0.0, 0);
    mesh(new THREE.SphereGeometry(0.035, 10, 8), rune, grip, 0, -0.15, 0);
  }
  const tip = joint(grip, 0, 0.16 + BL, 0);

  // Legs: plate over nothing; they barely touch the floor.
  for (const side of [-1, 1]) {
    const l = c.leg(side);
    mesh(plate([[0.095, 0.02], [0.1, -0.1], [0.09, -0.26], [0.075, -0.4]], 26), black, l.thigh);
    mesh(new THREE.SphereGeometry(0.07, 18, 12).scale(1, 1, 1.2), edge, l.shin, 0, 0, 0.02);
    mesh(new THREE.ConeGeometry(0.03, 0.14, 5).rotateX(-0.7), black, l.shin, 0, 0.04, 0.08);
    mesh(plate([[0.066, 0], [0.074, -0.1], [0.068, -0.24], [0.055, -0.4]], 26).scale(1, 1, 1.1), black, l.shin, 0, -0.03, 0);
    mesh(new THREE.SphereGeometry(0.065, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.85, 0.7, 2.2), black, l.foot, 0, -0.04, 0.07);
  }

  // A long ragged cloak from the shoulders.
  clothPanel(c, c.chest, cloth, 0.7, 1.45, new THREE.Vector3(0, 0.26, -0.2), { flare: 0.7, sweep: 0.4 });

  bakeRig(c.root);

  // Witch-fire: shells of violet flame around the legs and a mist from the hem.
  const aura = new THREE.Group();
  const auraMats = [auraMaterial(new THREE.Color(0.5, 0.15, 1.3), 1), auraMaterial(new THREE.Color(0.9, 0.4, 2.0), 0.6)];
  const shellA = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 1.2, 24, 1, true).translate(0, 0.55, 0), auraMats[0]);
  const shellB = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 0.9, 20, 1, true).translate(0, 0.4, 0), auraMats[1]);
  const shellC = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.6, 18, 1, true).translate(0, 0.25, 0), auraMats[1]);
  shellC.position.set(0, 0.95, -0.05);
  for (const s of [shellA, shellB, shellC]) {
    s.renderOrder = 16;
    s.userData.dynamic = true;
    aura.add(s);
  }
  aura.position.y = 0;
  c.body.add(aura);
  // Glow pooled on the floor beneath him.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(0.9, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.08, 0.8), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  pool.position.y = 0.03;
  pool.renderOrder = 3;
  c.root.add(pool);

  const L = c.arm(-1);
  const R = c.arm(1);
  let glow = 1;
  c.hooks.push((dt, _w, time) => {
    shellA.rotation.y += dt * 0.6;
    shellB.rotation.y -= dt * 0.9;
    const k = glow * (0.85 + Math.sin(time * 5.3) * 0.1 + Math.sin(time * 13.7) * 0.05);
    eyeMat.color.setRGB(1.2 * k, 0.5 * k, 4 * k);
    rune.color.setRGB(1.1 * k, 0.35 * k, 2.6 * k);
    // Floats: the body bobs above the floor, legs trailing.
    c.hips.position.y += 0.12 + Math.sin(time * 1.4) * 0.04;
    for (const l of c.legs) {
      l.shin.rotation.x += 0.25;
      l.foot.rotation.x = 0.5;
    }
  });

  let baseScale = scale;
  const poses: Record<string, (k: number, w: number) => void> = {
    // Sword raised overhead in both hands, gathering.
    raise: (k, w) => {
      const s = hold(k, 0.25, 0.75) * w;
      R.upper.rotation.x = lerp(R.upper.rotation.x, -2.9, s);
      R.fore.rotation.x = lerp(R.fore.rotation.x, -0.4, s);
      L.upper.rotation.x = lerp(L.upper.rotation.x, -2.7, s);
      L.fore.rotation.x = lerp(L.fore.rotation.x, -0.6, s);
      L.upper.rotation.z = lerp(L.upper.rotation.z, 0.25, s);
      R.upper.rotation.z = lerp(R.upper.rotation.z, -0.15, s);
      c.spine.rotation.x += -0.2 * s;
      c.hips.position.y += 0.25 * s;
      glow = 1 + s * 1.5;
    },
    // A great horizontal sweep from right to left.
    cleave: (k, w) => {
      const wind = smooth(0, 0.5, k) * (1 - smooth(0.55, 0.65, k));
      const sweep = smooth(0.55, 0.7, k) * (1 - smooth(0.8, 1, k));
      R.upper.rotation.x = lerp(R.upper.rotation.x, -1.5 * (wind + sweep), w);
      R.upper.rotation.z = lerp(R.upper.rotation.z, 1.4 * wind - 1.1 * sweep, w);
      R.fore.rotation.x = lerp(R.fore.rotation.x, -0.4, w);
      L.upper.rotation.x = lerp(L.upper.rotation.x, -1.2 * (wind + sweep), w);
      L.upper.rotation.z = lerp(L.upper.rotation.z, 0.9 * wind - 1.0 * sweep, w);
      c.spine.rotation.y += (0.9 * wind - 1.1 * sweep) * w;
      glow = 1 + (wind + sweep);
    },
    // Drives the sword point down into the floor before him.
    plunge: (k, w) => {
      const up = smooth(0, 0.3, k) * (1 - smooth(0.32, 0.38, k));
      const down = smooth(0.32, 0.4, k) * (1 - smooth(0.82, 1, k));
      R.upper.rotation.x = lerp(R.upper.rotation.x, -2.8 * up - 0.9 * down, w);
      L.upper.rotation.x = lerp(L.upper.rotation.x, -2.6 * up - 0.8 * down, w);
      R.fore.rotation.x = lerp(R.fore.rotation.x, -0.3 * up - 1.0 * down, w);
      L.fore.rotation.x = lerp(L.fore.rotation.x, -0.5 * up - 1.0 * down, w);
      c.spine.rotation.x += (-0.25 * up + 0.5 * down) * w;
      c.hips.position.y -= 0.2 * down * w;
      glow = 1 + down * 1.5;
    },
    // Left hand raised, palm up, calling the dead.
    summon: (k, w) => {
      const s = hold(k, 0.25, 0.8) * w;
      L.upper.rotation.x = lerp(L.upper.rotation.x, -2.4, s);
      L.upper.rotation.z = lerp(L.upper.rotation.z, -0.6, s);
      L.fore.rotation.x = lerp(L.fore.rotation.x, -0.2, s);
      c.spine.rotation.x += -0.25 * s;
      c.head.rotation.x -= 0.4 * s;
      glow = 1 + s * 2;
    },
    // Kneeling in state, head bowed, hands on the pommel of the planted sword.
    kneel: (_k, _w) => {
      c.hips.position.y -= 0.42;
      const l = c.leg(-1);
      const r = c.leg(1);
      l.thigh.rotation.x = -1.5;
      l.shin.rotation.x = 1.5;
      r.thigh.rotation.x = 0.1;
      r.shin.rotation.x = 1.8;
      c.spine.rotation.x += 0.35;
      c.head.rotation.x = 0.6;
      R.upper.rotation.x = -0.9;
      R.fore.rotation.x = -0.9;
      L.upper.rotation.x = -0.8;
      L.fore.rotation.x = -1.0;
      L.upper.rotation.z = 0.35;
      glow = 0.05;
    },
    // From kneeling to standing, sword drawn up.
    rise: (k, w) => {
      const s = 1 - easeOut(k);
      poses.kneel(k, w);
      // Blend back toward the gait pose as k advances.
      c.hips.position.y += 0.42 * (1 - s);
      c.spine.rotation.x -= 0.35 * (1 - s);
      c.head.rotation.x = 0.6 * s - 0.2 * (1 - s);
      const l = c.leg(-1);
      const r = c.leg(1);
      l.thigh.rotation.x *= s;
      l.shin.rotation.x *= s;
      r.thigh.rotation.x *= s;
      r.shin.rotation.x *= s;
      R.upper.rotation.x = lerp(-0.9, -2.6, smooth(0.3, 0.8, k));
      glow = 0.05 + smooth(0.0, 0.4, k) * 2;
    },
    // Fades into smoke (body shrinks into the floor) or rises out of it.
    vanish: (k) => {
      c.body.scale.set(baseScale * (1 - k * 0.6), baseScale * Math.max(0.001, 1 - easeOut(k)), baseScale * (1 - k * 0.6));
    },
    appear: (k) => {
      const e = easeOut(k);
      c.body.scale.set(baseScale * (0.4 + e * 0.6), baseScale * Math.max(0.001, e), baseScale * (0.4 + e * 0.6));
    },
  };

  const body: BossBody = {
    rig: c,
    lift: 0,
    attack(onHit) {
      // An overhead chop.
      poseAction(
        c,
        1.0,
        (k, w) => {
          const up = smooth(0, 0.45, k) * (1 - smooth(0.48, 0.58, k));
          const down = smooth(0.48, 0.6, k) * (1 - smooth(0.8, 1, k));
          R.upper.rotation.x = lerp(R.upper.rotation.x, -2.8 * up - 0.8 * down, w);
          L.upper.rotation.x = lerp(L.upper.rotation.x, -2.6 * up - 0.7 * down, w);
          R.fore.rotation.x = lerp(R.fore.rotation.x, -0.6 * up - 0.2 * down, w);
          c.spine.rotation.x += (-0.2 * up + 0.35 * down) * w;
          glow = 1 + down;
        },
        [0.58],
        () => onHit(),
      );
      audio.whoosh(c.root.position, 1.3);
    },
    flinch() {},
    die() {
      glow = 0;
      collapse(c, false);
    },
    muzzle() {
      const p = new THREE.Vector3();
      tip.getWorldPosition(p);
      return p;
    },
    move(name, dur, hits = [], onHit) {
      const fn = poses[name];
      if (!fn) return;
      if (name === 'vanish' || name === 'appear' || name === 'kneel') {
        c.play(dur, (k) => fn(k, 1), () => {
          if (name === 'appear') c.body.scale.setScalar(baseScale);
          let next = 0;
          while (next < hits.length) onHit?.(next++);
        });
        return;
      }
      poseAction(c, dur, fn, hits, onHit);
    },
  };
  void range;
  void rng;
  void lathe;
  baseScale = scale;
  (body as BossBody & { swordTip: () => THREE.Vector3; setGlow: (g: number) => void }).swordTip = () => {
    const p = new THREE.Vector3();
    tip.getWorldPosition(p);
    return p;
  };
  (body as BossBody & { setGlow: (g: number) => void }).setGlow = (g) => (glow = g);
  return body;
}

// ---- Abilities ---------------------------------------------------------------

/** Lifts the sword and a ring of soul-fire bursts outward; the only safety is close to him. */
function* soulNova(b: Boss, ctx: MonsterContext): Script {
  const at = b.position.clone();
  b.bossBody.move('raise', 2.3);
  audio.charge(at, 1.6, 'soul');
  b.voice('attack');
  const t = b.tele({ kind: 'ring', r0: 2.6, r1: 8.5 }, at, 0, 1.65);
  b.fx.column(at, 1.0, 5, SOUL, 1.7);
  yield 1.65;
  t.fire();
  b.fx.nova(at, 9, SOUL_HOT, 0.75, 1.8, 2.6);
  b.fx.cracks(at, 5, new THREE.Color(0.9, 0.35, 2.0), 3);
  ctx.effects.flash(at.clone().setY(2), 0xb060ff, 45, 14, 0.6);
  ctx.effects.addShake(0.9);
  audio.blast(at, 'soul', 1.3);
  if (b.caught(ctx, t)) b.hurt(ctx, 1.5, at);
  if (b.phase === 2) {
    // Enraged, the fire folds back in on him: now get out.
    const t2 = b.tele({ kind: 'circle', r: 3.2 }, at, 0, 0.9);
    audio.charge(at, 0.9, 'soul');
    yield 0.9;
    t2.fire();
    b.fx.column(at, 3, 6, SOUL_HOT, 0.9);
    b.fx.nova(at, 4, SOUL_HOT, 0.4, 1.2);
    audio.blast(at, 'soul', 1);
    if (b.caught(ctx, t2)) b.hurt(ctx, 1.3, at);
  }
  yield 0.6;
}

/** Melts into smoke and steps out of it beside the hero, sword already swinging. */
function* shadowStep(b: Boss, ctx: MonsterContext): Script {
  const from = b.position.clone();
  b.invulnerable = true;
  b.bossBody.move('vanish', 0.45);
  b.fx.column(from, 1.0, 4.5, SOUL, 0.9);
  ctx.effects.sparks(from.clone().setY(1.5), 30, SOUL_HOT, 3, 0.8);
  audio.whoosh(from, 1);
  yield 0.45;
  b.hidden = true;
  b.body.rig.root.visible = false;
  // Somewhere around the hero, preferably flanking them.
  const p = ctx.player.position.clone();
  const away = new THREE.Vector3().subVectors(p, from).setY(0).normalize();
  let dest = p.clone();
  for (let i = 0; i < 10; i++) {
    const a = Math.atan2(away.x, away.z) + (Math.random() - 0.5) * 2.4;
    const q = p.clone().add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(2.8));
    if (ctx.nav.walkable(q.x, q.z)) {
      dest = q;
      break;
    }
  }
  const yaw = Math.atan2(p.x - dest.x, p.z - dest.z);
  const t = b.tele({ kind: 'cone', r: 5.2, half: 0.95 }, dest, yaw, 1.05);
  yield 0.3;
  b.place(ctx, dest);
  b.facingYaw = yaw;
  b.hidden = false;
  b.body.rig.root.visible = true;
  b.bossBody.move('appear', 0.35);
  b.fx.column(b.position, 1.0, 4.5, SOUL, 0.8);
  audio.blast(b.position, 'soul', 0.6);
  yield 0.35;
  b.invulnerable = false;
  b.bossBody.move('cleave', 0.9, [0.62], () => {
    t.fire();
    ctx.effects.slash(b.position.clone().setY(1.4), yaw, 5.2, new THREE.Color(1.2, 0.5, 2.6));
    ctx.effects.slash(b.position.clone().setY(1.0), yaw, 4.6, new THREE.Color(0.8, 0.3, 1.8));
    ctx.effects.flash(b.position.clone().setY(1.5), 0xb060ff, 30, 8, 0.4);
    audio.whoosh(b.position, 1.4);
    ctx.effects.addShake(0.5);
    if (b.caught(ctx, t)) {
      b.hurt(ctx, 1.4);
      b.knock(ctx, b.position, 2.5);
    }
  });
  yield 1.1;
}

/** Drives the sword into the floor; lances of bone and soul-fire march out toward the hero. */
function* graveLances(b: Boss, ctx: MonsterContext): Script {
  const yaw = b.yawTo(ctx.player.position);
  b.facingYaw = yaw;
  const offs = b.phase === 2 ? [-0.7, -0.35, 0, 0.35, 0.7] : [-0.35, 0, 0.35];
  const items: { at: number; t: Telegraph; p: THREE.Vector3 }[] = [];
  const start = 0.85;
  for (const o of offs) {
    for (let j = 0; j < 10; j++) {
      const d = 1.8 + j * 1.5;
      const p = new THREE.Vector3(b.position.x + Math.sin(yaw + o) * d, 0, b.position.z + Math.cos(yaw + o) * d);
      if (!ctx.nav.walkable(p.x, p.z)) break;
      const at = start + j * 0.1;
      items.push({ at, p, t: b.tele({ kind: 'circle', r: 0.95 }, p, 0, at) });
    }
  }
  items.sort((a, c) => a.at - c.at);
  b.bossBody.move('plunge', 2.2, [0.38], () => {
    const tipAt = b.position.clone().add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(1.4));
    b.fx.cracks(tipAt, 3, new THREE.Color(0.9, 0.3, 2.0), 2.5);
    ctx.effects.shockwave(tipAt, 2.5, new THREE.Color(0.7, 0.3, 1.4));
    audio.quake(tipAt, 0.8);
  });
  audio.charge(b.position, 0.8, 'soul');
  const lance = new THREE.MeshStandardMaterial({ color: 0xc8b8d8, roughness: 0.4, emissive: new THREE.Color(0.35, 0.1, 0.7) });
  let now = 0;
  let hit = false;
  for (const it of items) {
    yield it.at - now;
    now = it.at;
    it.t.fire();
    b.fx.spikes(it.p, 5, 0.7, 2.1, lance, 0.6);
    b.fx.column(it.p, 0.5, 2.5, SOUL, 0.6);
    if (Math.random() < 0.4) audio.blast(it.p, 'soul', 0.4);
    if (!hit && b.caught(ctx, it.t)) {
      hit = true;
      b.hurt(ctx, 1.0, it.p);
    }
  }
  yield 0.9;
}

/** Calls the vault's dead up out of the floor around the hero. */
function* raiseDead(b: Boss, ctx: MonsterContext): Script {
  b.bossBody.move('summon', 2.2);
  b.voice('aggro');
  audio.charge(b.position, 1.4, 'soul');
  const p = ctx.player.position.clone();
  const n = Math.min(b.phase === 2 ? 4 : 3, b.spareMinions(ctx));
  const spots = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.random();
    return b.floorNear(ctx, p.clone().add(new THREE.Vector3(Math.sin(a) * 4, 0, Math.cos(a) * 4)), 0.6);
  });
  const teles = spots.map((s) => b.tele({ kind: 'circle', r: 1.3 }, s, 0, 1.4));
  spots.forEach((s) => b.fx.cracks(s, 1.6, new THREE.Color(0.7, 0.25, 1.6), 3));
  yield 1.4;
  spots.forEach((s, i) => {
    teles[i].fire();
    b.fx.column(s, 0.8, 4, SOUL, 1.1);
    b.fx.debris(s, 8, 0.6, 0.12);
    audio.blast(s, 'soul', 0.6);
    if (b.caught(ctx, teles[i])) b.hurt(ctx, 0.6, s);
    const m = b.summon(ctx, 'ghoul', s);
    m.body.rig.root.position.y = -1;
  });
  yield 0.9;
}

/** Enraged: a circle of doom follows the hero, locks, and a pillar of soul-fire falls on it. */
function* deathsGrasp(b: Boss, ctx: MonsterContext): Script {
  b.bossBody.move('summon', 2.6);
  audio.charge(b.position, 2, 'soul');
  b.voice('attack');
  const t = b.tele({ kind: 'circle', r: 2.7 }, ctx.player.position, 0, 2.1);
  for (let k = 0; k < 1.5; k += b.dt) {
    t.moveTo(ctx.player.position.clone().setY(0));
    b.face(ctx.player.position, 6);
    yield 0;
  }
  yield 0.6;
  const at = t.origin.clone();
  t.fire();
  b.fx.fall(at, 0.15, SOUL_HOT, () => {});
  yield 0.15;
  b.fx.column(at, 2.6, 9, SOUL_HOT, 1.2);
  b.fx.nova(at, 5, SOUL_HOT, 0.6, 1.5);
  b.fx.cracks(at, 3.5, new THREE.Color(1.0, 0.4, 2.2), 3);
  b.fx.debris(at, 22, 1.1);
  ctx.effects.flash(at.clone().setY(2), 0xc070ff, 50, 12, 0.6);
  ctx.effects.addShake(1.1);
  audio.quake(at, 1.2);
  audio.blast(at, 'soul', 1.4);
  if (b.caught(ctx, t)) b.hurt(ctx, 2.0, at);
  yield 0.8;
}

const glowOf = (b: Boss) => (b.bossBody as BossBody & { setGlow: (g: number) => void }).setGlow;

export const LICH: BossDef = {
  epithet: 'The crown outlived the king',
  color: VIOLET,
  abilities: [
    { name: 'Soul Nova', cooldown: 10, range: [0, 9], weight: 1.3, run: soulNova },
    { name: 'Shadow Step', cooldown: 8, range: [2.5, 18], run: shadowStep },
    { name: 'Grave Lances', cooldown: 9, range: [3, 18], run: graveLances },
    { name: 'Raise the Fallen', cooldown: 18, range: [0, 30], weight: 0.7, can: (b, ctx) => b.spareMinions(ctx) >= 2, run: raiseDead },
    { name: "Death's Grasp", cooldown: 11, range: [0, 30], enraged: true, weight: 1.2, run: deathsGrasp },
  ],
  sleep(b) {
    b.bossBody.move('kneel', 1e6);
  },
  *intro(b, ctx) {
    // Kneeling in the circle; the eyes kindle, witch-fire roars up, he stands.
    b.face(ctx.player.position, 100);
    const at = b.position.clone();
    b.bossBody.move('kneel', 1.4);
    audio.charge(at, 1.4, 'soul');
    yield* b.over(1.4, (k) => glowOf(b)(0.05 + k * 1.5));
    b.fx.column(at, 1.6, 8, SOUL, 2.0);
    ctx.effects.flash(at.clone().setY(1.5), 0xb060ff, 40, 12, 1.0);
    audio.blast(at, 'soul', 1.2);
    b.bossBody.move('rise', 1.8);
    yield 1.8;
    b.bossBody.move('plunge', 1.6, [0.38], () => {
      b.fx.nova(at, 9, SOUL_HOT, 0.9, 1.6);
      b.fx.cracks(at, 4.5, new THREE.Color(0.9, 0.35, 2.0), 3);
      ctx.effects.addShake(0.9);
      audio.quake(at, 1.2);
    });
    yield 0.65;
    audio.roar('lich', at);
    ctx.banner?.(b.name, LICH.epithet);
    yield 1.2;
  },
  *enrage(b, ctx) {
    b.bossBody.move('raise', 2.2);
    audio.roar('lich', b.position);
    ctx.banner?.(`${b.name} Unbound`, 'The witch-fire burns through his armour');
    b.fx.column(b.position, 2.2, 9, SOUL_HOT, 2.0);
    b.fx.nova(b.position, 8, SOUL_HOT, 0.8, 1.4);
    ctx.effects.addShake(0.8);
    yield 2.2;
  },
  death(b, ctx) {
    const at = b.position.clone();
    audio.roar('lich', at);
    b.fx.column(at, 2, 10, SOUL_HOT, 2.4);
    b.fx.nova(at, 10, SOUL_HOT, 1.0, 2);
    for (let i = 0; i < 3; i++) setTimeout(() => ctx.effects.sparks(at.clone().setY(1.5), 60, SOUL_HOT, 4, 1.4), i * 250);
    ctx.effects.addShake(1.2);
    setTimeout(() => audio.blast(at, 'soul', 1.5), 400);
  },
};
