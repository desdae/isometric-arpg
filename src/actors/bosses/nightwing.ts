import * as THREE from 'three';
import { audio } from '../../audio/Audio';
import { Character, joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { bumpA, sculptLathe, sculptSphere } from '../sculpt';
import type { MonsterMaterials } from '../monsters/materials';
import type { MonsterContext } from '../Monster';
import type { Boss, BossBody, BossDef, Script } from '../Boss';
import type { Telegraph } from '../../game/Telegraph';
import { easeIn, easeOut, hold, lerp, poseAction, smooth } from './common';

// Vhal'zereth, the Night Wing: a gaunt bat-demon the size of a cart, all
// sinew and leather, on wings that could cover the vault. Ears like blades,
// a muzzle full of needles, eyes like coals. It hangs from the vault's
// ceiling until something wakes it, and it fights from the air.

const CRIMSON = 0xff3030;
const BLOOD = new THREE.Color(0.32, 0.01, 0.008);
const BLOOD_GLOW = new THREE.Color(1.6, 0.08, 0.05);

interface Wing {
  side: number;
  root: THREE.Object3D;
  elbow: THREE.Object3D;
  wrist: THREE.Object3D;
  fingers: THREE.Object3D[];
  tips: THREE.Object3D[];
  geo: THREE.BufferGeometry;
  membrane: THREE.Mesh;
}

export function buildNightwing(m: MonsterMaterials, rng: Rng, scale = 1.85): BossBody {
  const c = new Character({ scale, hunch: 0.5, stride: 1.4 });
  const hide = (m.bruteSkin as THREE.MeshStandardMaterial).clone();
  hide.color.setRGB(0.16, 0.08, 0.085);
  const dark = (m.chitin as THREE.MeshStandardMaterial).clone();
  dark.color.setRGB(0.07, 0.05, 0.05);
  const membraneMat = new THREE.MeshStandardMaterial({
    color: 0x2a0b0d,
    roughness: 0.75,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0.09, 0.008, 0.008),
    transparent: true,
    opacity: 0.94,
  });
  const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.5, 0.15), fog: false });
  const seed = rng() * 10;
  const sinew = (t: number, y: number) => 0.012 * Math.sin(t * 7 + y * 30 + seed) + 0.006 * Math.sin(t * 15 + y * 50);

  // --- Torso: a deep keel of a chest over a wasp waist ------------------------
  const chestGeo = sculptLathe(
    [[0.16, -0.2], [0.24, -0.08], [0.3, 0.08], [0.31, 0.2], [0.24, 0.32], [0.12, 0.38], [0, 0.4]],
    (_x, y, _z, t) => {
      let d = sinew(t, y);
      d += 0.06 * bumpA(t, y, 0, 0.12, 0.5, 0.18); // keel
      d += 0.05 * (bumpA(t, y, 2.4, 0.22, 0.4, 0.14) + bumpA(t, y, -2.4, 0.22, 0.4, 0.14)); // wing muscles
      for (let i = 0; i < 4; i++) d -= 0.012 * bumpA(t, y, 0.8, -0.1 + i * 0.07, 0.4, 0.02) + 0.012 * bumpA(t, y, -0.8, -0.1 + i * 0.07, 0.4, 0.02); // ribs
      return d;
    },
    { sx: 1.1, sz: 0.95, seg: 48, perSpan: 7 },
  );
  mesh(chestGeo, hide, c.chest);
  mesh(sculptLathe([[0.17, -0.18], [0.15, -0.05], [0.16, 0.1], [0.2, 0.22]], (_x, y, _z, t) => sinew(t + 1, y) + 0.02 * bumpA(t, y, 0, 0, 0.5, 0.1), { sx: 1.05, seg: 32 }), hide, c.spine);
  mesh(sculptLathe([[0.18, 0.06], [0.2, -0.06], [0.16, -0.18], [0.08, -0.24]], (_x, y, _z, t) => sinew(t, y), { sx: 1.1, seg: 28 }), hide, c.hips);
  // Mane of coarse fur at the shoulders and a ridge of spines down the back.
  for (let i = 0; i < 26; i++) {
    const a = (i / 25 - 0.5) * 3.6 + Math.PI;
    const tuft = mesh(new THREE.ConeGeometry(0.03, range(rng, 0.12, 0.2), 4).translate(0, 0.07, 0), dark, c.chest, Math.sin(a) * 0.24, 0.3 + range(rng, -0.03, 0.03), Math.cos(a) * 0.2);
    tuft.rotation.set(-0.9, a, 0);
  }
  for (let i = 0; i < 7; i++) mesh(new THREE.ConeGeometry(0.02, 0.1 - i * 0.008, 5).rotateX(-1.9), dark, c.chest, 0, 0.32 - i * 0.07, -0.25 + i * 0.012);

  // --- Head: a bat's skull, all ears and teeth --------------------------------
  c.head.position.set(0, 0.42, 0.12);
  const skullGeo = sculptSphere(
    0.13,
    (x, y, z) => {
      let d = 0.45 * smooth(0.1, 1, z) * smooth(0.3, -0.5, y); // muzzle
      d -= 0.12 * smooth(0.2, 0.9, y) * smooth(0.0, 0.9, z); // sloped brow
      d += 0.1 * bumpA(Math.atan2(x, z), y, 0.8, 0.2, 0.25, 0.25) + 0.1 * bumpA(Math.atan2(x, z), y, -0.8, 0.2, 0.25, 0.25); // cheekbones
      d -= 0.18 * Math.exp(-((x * x) / 0.02 + ((y - 0.05) * (y - 0.05)) / 0.02)) * smooth(0.6, 1, z); // nose pit
      return d;
    },
    new THREE.Vector3(0.9, 0.85, 1.05),
    26,
    20,
  );
  mesh(skullGeo, hide, c.head);
  for (const s of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.02, 8, 6).scale(1.4, 0.8, 1), eye, c.head, s * 0.06, 0.04, 0.12);
    // Ears: tall, ribbed blades.
    const ear = joint(c.head, s * 0.08, 0.1, -0.02);
    ear.rotation.set(-0.25, s * 0.35, s * -0.35);
    const eg = new THREE.ConeGeometry(0.07, 0.32, 4, 3, true).translate(0, 0.16, 0).scale(1, 1, 0.35);
    mesh(eg, membraneMat, ear).userData.dynamic = true;
    mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.3, 5).translate(0, 0.15, 0), dark, ear, 0, 0, -0.01);
    // Swept-back horns.
    const horn = mesh(new THREE.ConeGeometry(0.022, 0.24, 6).translate(0, 0.12, 0), dark, c.head, s * 0.05, 0.11, -0.04);
    horn.rotation.set(-1.1, 0, s * -0.3);
  }
  // Snout, fangs and a jaw that drops wide.
  mesh(new THREE.SphereGeometry(0.035, 10, 8).scale(1.3, 0.8, 1), dark, c.head, 0, 0.0, 0.2);
  for (const s of [-1, 1]) {
    mesh(new THREE.ConeGeometry(0.012, 0.08, 5).rotateX(Math.PI), m.bone, c.head, s * 0.03, -0.06, 0.17);
    for (let i = 0; i < 4; i++) mesh(new THREE.ConeGeometry(0.005, 0.03, 4).rotateX(Math.PI), m.bone, c.head, s * (0.04 + i * 0.012), -0.05, 0.15 - i * 0.02);
  }
  mesh(new THREE.SphereGeometry(0.07, 12, 8).scale(1, 0.4, 1.2), m.wound, c.head, 0, -0.06, 0.1);
  const jaw = joint(c.head, 0, -0.06, 0.02);
  mesh(sculptSphere(0.09, (x, y) => 0.05 * Math.sin(x * 10) - 0.3 * smooth(0, 0.8, y), new THREE.Vector3(0.8, 0.32, 1.35), 16, 10), hide, jaw, 0, -0.01, 0.1);
  for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.01, 0.07, 5), m.bone, jaw, s * 0.03, 0.02, 0.17);

  // --- Arms: long, thin, three hooked talons -----------------------------------
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    a.shoulder.position.set(side * 0.26, 0.24, 0.06);
    a.fore.position.y = -0.34;
    a.hand.position.y = -0.36;
    mesh(sculptSphere(0.085, () => 0, new THREE.Vector3(1, 1, 1), 14, 10), hide, a.shoulder);
    mesh(sculptLathe([[0.075, 0.02], [0.08, -0.08], [0.06, -0.24], [0.045, -0.34], [0, -0.35]], (_x, y, _z, t) => sinew(t, y) + 0.015 * bumpA(t, y, 0, -0.1, 0.6, 0.08), { seg: 18 }), hide, a.upper);
    mesh(sculptLathe([[0, 0.04], [0.05, 0.02], [0.055, -0.08], [0.04, -0.3], [0.035, -0.36]], (_x, y, _z, t) => sinew(t + 2, y), { seg: 18 }), hide, a.fore);
    mesh(sculptSphere(0.045, () => 0, new THREE.Vector3(1, 1.2, 1), 12, 8), hide, a.hand, 0, -0.03, 0);
    for (let f = 0; f < 3; f++) {
      const claw = mesh(new THREE.ConeGeometry(0.012, 0.18, 5).translate(0, -0.09, 0), m.bone, a.hand, (f - 1) * 0.03, -0.06, 0.02);
      claw.rotation.set(0.6, 0, (f - 1) * 0.2);
    }
    a.upper.rotation.z = side * 0.3;
    a.restUpper = -0.5;
    a.restFore = -1.1;
    a.swing = 0.2;
  }

  // --- Legs: crooked, with grasping feet ----------------------------------------
  for (const side of [-1, 1]) {
    const l = c.leg(side);
    mesh(sculptLathe([[0.1, 0.04], [0.11, -0.1], [0.08, -0.3], [0.05, -0.44], [0, -0.46]], (_x, y, _z, t) => sinew(t, y), { seg: 18 }), hide, l.thigh);
    mesh(sculptLathe([[0, 0.04], [0.06, 0.02], [0.055, -0.15], [0.035, -0.42], [0.03, -0.44]], (_x, y, _z, t) => sinew(t + 3, y), { seg: 18 }), hide, l.shin);
    mesh(sculptSphere(0.05, () => 0, new THREE.Vector3(1, 0.6, 1.4), 12, 8), hide, l.foot, 0, -0.02, 0.03);
    for (let f = 0; f < 4; f++) {
      const t = mesh(new THREE.ConeGeometry(0.012, 0.16, 5).rotateX(Math.PI / 2 + 0.6).translate(0, -0.03, 0.08), m.bone, l.foot, (f - 1.5) * 0.03, -0.03, 0.06);
      t.rotation.y = (f - 1.5) * 0.25;
    }
  }

  // --- Tail -----------------------------------------------------------------------
  const tail: THREE.Object3D[] = [];
  {
    let parent: THREE.Object3D = joint(c.hips, 0, -0.08, -0.15);
    parent.rotation.x = -2.2;
    let r = 0.05;
    for (let i = 0; i < 9; i++) {
      const j = joint(parent, 0, i === 0 ? 0 : 0.11, 0);
      mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.12, 8).translate(0, 0.06, 0), hide, j);
      tail.push(j);
      parent = j;
      r *= 0.85;
    }
    mesh(new THREE.ConeGeometry(0.035, 0.14, 4).translate(0, 0.07, 0).scale(1.8, 1, 0.3), dark, parent, 0, 0.11, 0);
  }

  // --- Wings: bones you can see through the membrane ------------------------------
  const wings: Wing[] = [];
  const BODY_ANCHORS = [new THREE.Vector3(0, 0.3, -0.18), new THREE.Vector3(0, 0.05, -0.16), new THREE.Vector3(0, -0.2, -0.1)];
  for (const side of [-1, 1]) {
    const root = joint(c.chest, side * 0.16, 0.3, -0.16);
    mesh(new THREE.SphereGeometry(0.07, 12, 8), hide, root);
    // Humerus.
    mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.62, 8).rotateZ(Math.PI / 2).translate(side * 0.31, 0, 0), hide, root);
    const elbow = joint(root, side * 0.62, 0, 0);
    mesh(new THREE.SphereGeometry(0.045, 10, 8), hide, elbow);
    mesh(new THREE.CylinderGeometry(0.022, 0.035, 0.85, 8).rotateZ(Math.PI / 2).translate(side * 0.42, 0, 0), hide, elbow);
    const wrist = joint(elbow, side * 0.85, 0, 0);
    mesh(new THREE.SphereGeometry(0.035, 10, 8), hide, wrist);
    // The thumb claw at the wrist.
    mesh(new THREE.ConeGeometry(0.018, 0.16, 5).rotateZ(side * -1.2).translate(side * 0.06, 0.06, 0), m.bone, wrist);
    const fingers: THREE.Object3D[] = [];
    const tips: THREE.Object3D[] = [];
    const lens = [1.25, 1.15, 0.95, 0.75];
    for (let f = 0; f < 4; f++) {
      const fj = joint(wrist, 0, 0, 0);
      const len = lens[f];
      mesh(new THREE.CylinderGeometry(0.008, 0.02, len, 6).rotateZ(Math.PI / 2).translate(side * len / 2, 0, 0), dark, fj);
      const tip = joint(fj, side * len, 0, 0);
      mesh(new THREE.ConeGeometry(0.012, 0.08, 4).rotateZ(side * -Math.PI / 2).translate(side * 0.04, 0, 0), m.bone, tip);
      fingers.push(fj);
      tips.push(tip);
    }
    // Membrane: a fan of quads spanned between the bones, rebuilt every frame
    // from where the bones are, with sag between the fingers.
    const geo = new THREE.BufferGeometry();
    const SAG = 6; // samples along each scalloped trailing edge
    const vertCount = 3 + 4 + BODY_ANCHORS.length + SAG * 5;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
    const membrane = new THREE.Mesh(geo, membraneMat);
    membrane.userData.dynamic = true;
    membrane.castShadow = true;
    membrane.frustumCulled = false;
    c.chest.add(membrane);
    wings.push({ side, root, elbow, wrist, fingers, tips, geo, membrane });
  }
  // Triangulate the membrane once: index layout follows `buildMembrane`.
  for (const w of wings) {
    const idx: number[] = [];
    // vertices: 0 root, 1 elbow, 2 wrist, 3..6 tips (outer to inner), 7..9 body anchors, then sag runs.
    const SAG = 6;
    const sagBase = 10;
    // Edge loop from the leading edge round the trailing edge back to the body.
    const loop: number[] = [0, 1, 2, 3];
    const runs: [number, number][] = [[3, 4], [4, 5], [5, 6], [6, 7], [7, 8]];
    runs.forEach((_, r) => {
      for (let s = 0; s < SAG; s++) loop.push(sagBase + r * SAG + s);
      loop.push([4, 5, 6, 7, 8][r]);
    });
    loop.push(9);
    // Fan from the wrist and elbow for a sturdy triangulation.
    for (let i = 3; i < loop.length - 1; i++) idx.push(2, loop[i], loop[i + 1]);
    idx.push(2, loop[loop.length - 1], 1, 1, loop[loop.length - 1], 0);
    w.geo.setIndex(idx);
  }

  bakeRig(c.root);

  const tmp = new THREE.Vector3();
  const local = (o: THREE.Object3D) => c.chest.worldToLocal(o.getWorldPosition(tmp)).clone();
  function buildMembrane(w: Wing, time: number) {
    const pos = w.geo.getAttribute('position') as THREE.BufferAttribute;
    const pts: THREE.Vector3[] = [local(w.root), local(w.elbow), local(w.wrist), ...w.tips.map(local)];
    for (const a of BODY_ANCHORS) pts.push(a.clone().setX(w.side * 0.12));
    // pts: 0 root, 1 elbow, 2 wrist, 3..6 tips, 7..9 anchors. Re-pack to match the index layout:
    const ordered = [pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7], pts[8], pts[9]];
    ordered.forEach((p, i) => pos.setXYZ(i, p.x, p.y, p.z));
    const SAG = 6;
    const ends: [THREE.Vector3, THREE.Vector3][] = [[pts[3], pts[4]], [pts[4], pts[5]], [pts[5], pts[6]], [pts[6], pts[7]], [pts[7], pts[8]]];
    const wrist = pts[2];
    ends.forEach(([a, b], r) => {
      for (let s = 0; s < SAG; s++) {
        const f = (s + 1) / (SAG + 1);
        const p = a.clone().lerp(b, f);
        // The membrane scallops in toward the wrist between bones, and ripples.
        const sag = Math.sin(f * Math.PI) * (r < 3 ? 0.22 : 0.12);
        p.lerp(wrist, sag);
        p.y += Math.sin(time * 9 + f * 6 + r) * 0.012;
        pos.setXYZ(10 + r * SAG + s, p.x, p.y, p.z);
      }
    });
    pos.needsUpdate = true;
    w.geo.computeVertexNormals();
    w.geo.computeBoundingSphere();
  }

  // Wing pose: spread 0 (folded) .. 1 (wide), beat -1..1 (down..up), sweep forward.
  const wingPose = { spread: 0.25, beat: 0, sweep: 0, wrap: 0 };
  function poseWings() {
    const { spread, beat, sweep, wrap } = wingPose;
    for (const w of wings) {
      const s = w.side;
      // Root: lift and sweep. Folded wings tuck back along the body.
      w.root.rotation.set(0, 0, 0);
      w.root.rotation.y = s * (lerp(1.3, 0.25, spread) - sweep * 0.9 + wrap * 0.5);
      w.root.rotation.z = s * (lerp(0.9, 0.15, spread) + beat * 0.6 - wrap * 0.6);
      w.root.rotation.x = -wrap * 0.4;
      w.elbow.rotation.set(0, s * lerp(-2.4, -0.35, spread) * (1 - wrap * 0.3), s * beat * 0.25);
      w.wrist.rotation.set(0, s * lerp(2.6, 0.5, spread), 0);
      w.fingers.forEach((f, i) => {
        const fan = lerp(0.05, 0.42, spread) * i;
        f.rotation.set(0, 0, 0);
        f.rotation.y = s * (fan * 0.6) - s * wrap * 0.4;
        f.rotation.z = -s * (fan + beat * 0.15 * i);
      });
    }
  }

  let lift = 0;
  let flapT = 0;
  const L = c.arm(-1);
  const R = c.arm(1);
  c.hooks.push((dt, walkW, time) => {
    // In the air the wings beat and the legs hang; on the ground they half-fold.
    const flying = smooth(0.15, 0.9, lift);
    flapT += dt * lerp(1.6, 7.5, flying);
    if (!c.acting) {
      wingPose.spread += (lerp(0.3 + walkW * 0.1, 0.95, flying) - wingPose.spread) * (1 - Math.exp(-dt * 4));
      wingPose.beat = Math.sin(flapT) * lerp(0.08, 0.85, flying);
      wingPose.sweep *= Math.exp(-dt * 5);
      wingPose.wrap *= Math.exp(-dt * 5);
    }
    if (flying > 0.01) {
      for (const l of c.legs) {
        l.thigh.rotation.x = lerp(l.thigh.rotation.x, -0.5, flying);
        l.shin.rotation.x = lerp(l.shin.rotation.x, 1.2, flying);
        l.foot.rotation.x = lerp(l.foot.rotation.x, 0.9, flying);
      }
      c.hips.position.y += Math.sin(flapT) * 0.05 * flying;
    }
    poseWings();
    tail.forEach((j, i) => {
      if (i === 0) return;
      j.rotation.x = Math.sin(time * 2 - i * 0.6) * 0.12 + 0.05;
      j.rotation.z = Math.cos(time * 1.4 - i * 0.5) * 0.18;
    });
    jaw.rotation.x = Math.max(jaw.rotation.x * Math.exp(-dt * 6), 0.08 + Math.max(0, Math.sin(time * 0.9)) ** 16 * 0.4);
    for (const w of wings) buildMembrane(w, time);
  });

  const poses: Record<string, (k: number, w: number) => void> = {
    // Upside down from the ceiling, wrapped in its wings.
    hang: () => {
      c.body.rotation.x = Math.PI;
      c.body.position.y = 1.85 * scale * 0.95;
      wingPose.spread = 0.2;
      wingPose.wrap = 1;
      wingPose.beat = 0;
      for (const l of c.legs) {
        l.thigh.rotation.x = 0;
        l.shin.rotation.x = 0.1;
        l.foot.rotation.x = -1.2;
      }
      L.upper.rotation.x = -0.2;
      R.upper.rotation.x = -0.2;
      c.head.rotation.x = 0.5;
    },
    // Drops off the ceiling and rights itself in the fall.
    drop: (k) => {
      const f = smooth(0.1, 0.7, k);
      c.body.rotation.x = Math.PI * (1 - f);
      c.body.position.y = 1.85 * scale * 0.95 * (1 - f);
      wingPose.wrap = 1 - smooth(0.3, 0.8, k);
      wingPose.spread = lerp(0.2, 1, smooth(0.4, 0.9, k));
      wingPose.beat = -0.4 * smooth(0.6, 1, k);
    },
    // Crouched for a spring, then a huge downbeat.
    takeoff: (k, w) => {
      const crouch = hold(k, 0.3, 0.45) * w;
      c.hips.position.y -= 0.2 * crouch;
      for (const l of c.legs) {
        l.thigh.rotation.x -= 0.7 * crouch;
        l.shin.rotation.x += 1.1 * crouch;
      }
      wingPose.spread = lerp(wingPose.spread, 1, w);
      wingPose.beat = k < 0.45 ? smooth(0, 0.45, k) : 1 - 2 * smooth(0.45, 0.65, k);
    },
    // Wings swept back, plunging head first.
    dive: (_k, w) => {
      wingPose.spread = lerp(wingPose.spread, 0.45, w);
      wingPose.sweep = -0.8 * w;
      wingPose.beat = 0.6 * w;
      c.spine.rotation.x += 0.6 * w;
      L.upper.rotation.x = lerp(L.upper.rotation.x, -2.4, w);
      R.upper.rotation.x = lerp(R.upper.rotation.x, -2.4, w);
      jaw.rotation.x = 0.7 * w;
    },
    // Hits the floor in a crouch, wings flung wide.
    land: (k, w) => {
      const s = (1 - smooth(0.2, 1, k)) * w;
      c.hips.position.y -= 0.3 * s;
      c.spine.rotation.x += 0.5 * s;
      for (const l of c.legs) {
        l.thigh.rotation.x -= 0.9 * s;
        l.shin.rotation.x += 1.4 * s;
      }
      wingPose.spread = lerp(wingPose.spread, 1, s);
      wingPose.beat = -0.5 * s;
    },
    // Wings brought round in front in one great beat.
    gust: (k, w) => {
      const back = smooth(0, 0.55, k) * (1 - smooth(0.6, 0.72, k));
      const fwd = smooth(0.6, 0.75, k) * (1 - smooth(0.85, 1, k));
      wingPose.spread = lerp(wingPose.spread, 1, w);
      wingPose.sweep = (-0.9 * back + 1.2 * fwd) * w;
      wingPose.beat = (0.9 * back - 0.7 * fwd) * w;
      c.spine.rotation.x += (-0.35 * back + 0.3 * fwd) * w;
      jaw.rotation.x = 0.6 * fwd;
    },
    // Head thrust out, jaw wide, wings shaking.
    screech: (k, w) => {
      const s = hold(k, 0.35, 0.85) * w;
      c.spine.rotation.x += 0.35 * s;
      c.head.rotation.x -= 0.6 * s;
      jaw.rotation.x = 1.0 * s;
      wingPose.spread = lerp(wingPose.spread, 1, s);
      wingPose.beat = -0.3 * s + Math.sin(k * 90) * 0.06 * s;
      L.upper.rotation.z = lerp(L.upper.rotation.z, -1.1, s);
      R.upper.rotation.z = lerp(R.upper.rotation.z, 1.1, s);
    },
    // Hovering, talons raised to the dark, calling the blood down.
    rain: (k, w) => {
      const s = hold(k, 0.2, 0.85) * w;
      L.upper.rotation.x = lerp(L.upper.rotation.x, -2.8, s);
      R.upper.rotation.x = lerp(R.upper.rotation.x, -2.8, s);
      L.fore.rotation.x = lerp(L.fore.rotation.x, -0.3, s);
      R.fore.rotation.x = lerp(R.fore.rotation.x, -0.3, s);
      c.head.rotation.x -= 0.7 * s;
      jaw.rotation.x = 0.8 * s;
    },
  };

  const body: BossBody = {
    rig: c,
    get lift() {
      return lift;
    },
    set lift(v: number) {
      lift = v;
    },
    attack(onHit) {
      // Rakes with both talons in a lunging double swipe.
      poseAction(
        c,
        0.95,
        (k, w) => {
          const a1 = Math.exp(-(((k - 0.45) / 0.1) ** 2));
          const a2 = Math.exp(-(((k - 0.65) / 0.1) ** 2));
          R.upper.rotation.x = lerp(R.upper.rotation.x, -1.8 * a1 - 0.6, w);
          L.upper.rotation.x = lerp(L.upper.rotation.x, -1.8 * a2 - 0.6, w);
          R.upper.rotation.z = lerp(R.upper.rotation.z, 0.3 - a1 * 0.8, w);
          L.upper.rotation.z = lerp(L.upper.rotation.z, -0.3 + a2 * 0.8, w);
          c.spine.rotation.x += (a1 + a2) * 0.3 * w;
          jaw.rotation.x = 0.6 * (a1 + a2);
          wingPose.spread = lerp(wingPose.spread, 0.7, w);
        },
        [0.5],
        () => onHit(),
      );
    },
    flinch() {},
    die() {
      c.play(1.6, (k) => {
        const f = easeIn(Math.min(1, k * 1.4));
        lift *= 0.9;
        c.body.rotation.x = -1.4 * f;
        c.body.position.y = 0.2 * f;
        wingPose.spread = lerp(0.9, 1, f);
        wingPose.beat = lerp(0, -0.9, f);
        wingPose.sweep = 0.3 * f;
        jaw.rotation.x = 0.9;
        for (const l of c.legs) l.thigh.rotation.x = -0.4 * f;
      });
    },
    muzzle() {
      const p = new THREE.Vector3();
      jaw.getWorldPosition(p);
      return p;
    },
    move(name, dur, hits = [], onHit) {
      const fn = poses[name];
      if (!fn) return;
      if (name === 'hang' || name === 'drop') {
        c.play(dur, (k) => fn(k, 1), () => {
          if (name === 'drop') {
            c.body.rotation.x = 0;
            c.body.position.y = 0;
          }
          let i = 0;
          while (i < hits.length) onHit?.(i++);
        });
        return;
      }
      poseAction(c, dur, fn, hits, onHit);
    },
  };
  return body;
}

// ---- Abilities ---------------------------------------------------------------

/** Climbs out of sight, hunts the hero's shadow, and falls on it. */
function* deathFromAbove(b: Boss, ctx: MonsterContext): Script {
  const body = b.bossBody;
  body.move('takeoff', 0.9);
  b.voice('aggro');
  yield 0.4;
  audio.whoosh(b.position, 2);
  b.fx.gust(b.position, b.facingYaw, 4, Math.PI, new THREE.Color(0.4, 0.3, 0.3));
  ctx.effects.addShake(0.4);
  b.invulnerable = true;
  yield* b.over(0.8, (k) => (body.lift = easeIn(k) * 16));
  b.hidden = true;
  b.body.rig.root.visible = false;
  const t = b.tele({ kind: 'circle', r: 3.4 }, ctx.player.position, 0, b.phase === 2 ? 1.5 : 1.9);
  for (let k = 0; k < (b.phase === 2 ? 1.0 : 1.35); k += b.dt) {
    t.moveTo(ctx.player.position.clone().setY(0));
    yield 0;
  }
  yield 0.5;
  const at = t.origin.clone();
  b.place(ctx, at);
  b.hidden = false;
  b.body.rig.root.visible = true;
  body.move('dive', 0.3);
  audio.whoosh(at, 2.4);
  yield* b.over(0.25, (k) => (body.lift = 16 * (1 - easeIn(k))));
  body.lift = 0;
  b.invulnerable = false;
  t.fire();
  body.move('land', 0.9);
  b.fx.nova(at, 6, new THREE.Color(1.4, 0.2, 0.15), 0.6, 1.4);
  b.fx.cracks(at, 4.5, new THREE.Color(1.8, 0.3, 0.1), 3);
  b.fx.debris(at, 32, 1.3);
  ctx.effects.shockwave(at, 5, new THREE.Color(1, 0.4, 0.3));
  ctx.effects.flash(at.clone().setY(1), 0xff4030, 40, 10, 0.5);
  ctx.effects.addShake(1.4);
  audio.quake(at, 1.5);
  if (b.caught(ctx, t)) {
    b.hurt(ctx, 1.8, at);
    b.knock(ctx, at, 3.5);
  }
  yield 1.0;
}

/** One enormous wing beat that flattens everything in front of it. */
function* tempest(b: Boss, ctx: MonsterContext): Script {
  const yaw = b.yawTo(ctx.player.position);
  b.facingYaw = yaw;
  const t = b.tele({ kind: 'cone', r: 8.5, half: 1.05 }, b.position, yaw, 1.1);
  b.bossBody.move('gust', 1.6, [0.68], () => {
    t.fire();
    b.fx.gust(b.position, yaw, 8.5, 1.05, new THREE.Color(0.55, 0.35, 0.35));
    b.fx.nova(b.position.clone().add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(1.5)), 4, new THREE.Color(0.7, 0.3, 0.3), 0.4);
    audio.whoosh(b.position, 3);
    ctx.effects.addShake(0.6);
    if (b.caught(ctx, t)) {
      b.hurt(ctx, 1.1);
      b.knock(ctx, b.position, 5);
    }
  });
  audio.whoosh(b.position, 1.2);
  yield 1.8;
}

/** Hovers and calls a rain of blood bolts down across the vault. */
function* bloodRain(b: Boss, ctx: MonsterContext): Script {
  const body = b.bossBody;
  body.move('rain', 3.2);
  b.voice('aggro');
  yield* b.over(0.5, (k) => (body.lift = easeOut(k) * 1.6));
  const n = b.phase === 2 ? 22 : 14;
  const p = ctx.player.position.clone();
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const near = i < 5;
    const c = near ? p : b.position;
    spots.push(b.floorNear(ctx, c.clone().add(new THREE.Vector3((Math.random() - 0.5) * (near ? 5 : 16), 0, (Math.random() - 0.5) * (near ? 5 : 16))), 0.4));
  }
  const items = spots.map((s, i) => ({ s, at: 0.8 + i * (1.8 / n), t: null as Telegraph | null }));
  items.forEach((it) => (it.t = b.tele({ kind: 'circle', r: 1.15 }, it.s, 0, it.at)));
  let now = 0;
  let hits = 0;
  for (const it of items) {
    yield Math.max(0, it.at - 0.18 - now);
    now = Math.max(now, it.at - 0.18);
    b.fx.fall(it.s, 0.18, BLOOD_GLOW, () => {
      it.t!.fire();
      ctx.effects.blood(it.s.clone().setY(0.2), it.s.clone().setY(-1), 14, BLOOD, 1);
      ctx.effects.sparks(it.s.clone().setY(0.2), 10, BLOOD_GLOW, 2.5, 0.4);
      b.fx.nova(it.s, 1.6, BLOOD_GLOW, 0.3);
      audio.splash(it.s);
      if (hits < 3 && b.caught(ctx, it.t!)) {
        hits++;
        b.hurt(ctx, 0.65, it.s);
      }
    });
  }
  yield 0.5;
  yield* b.over(0.4, (k) => (body.lift = 1.6 * (1 - k)));
  body.lift = 0;
  yield 0.3;
}

/** A shriek that breaks against everything close around it. */
function* screech(b: Boss, ctx: MonsterContext): Script {
  const at = b.position.clone();
  const t = b.tele({ kind: 'circle', r: 5.2 }, at, 0, 0.85);
  b.bossBody.move('screech', 1.6, [0.53], () => {
    t.fire();
    audio.roar('nightwing', at);
    for (let i = 0; i < 3; i++) setTimeout(() => b.fx.nova(at, 5.8 + i * 1.5, new THREE.Color(1.3, 0.5, 0.45), 0.5, 1.6), i * 110);
    ctx.effects.addShake(0.7);
    if (b.caught(ctx, t)) {
      b.hurt(ctx, 1.2, at);
      b.knock(ctx, at, 5);
    }
  });
  yield 1.7;
}

/** Enraged: takes off low and sweeps the length of the vault through the hero. */
function* sweep(b: Boss, ctx: MonsterContext): Script {
  const body = b.bossBody;
  const dir = new THREE.Vector3().subVectors(ctx.player.position, b.position).setY(0).normalize();
  const yaw = Math.atan2(dir.x, dir.z);
  b.facingYaw = yaw;
  let len = 0;
  while (len < 24 && ctx.nav.walkable(b.position.x + dir.x * (len + 1), b.position.z + dir.z * (len + 1))) len += 0.25;
  len = Math.max(4, len);
  const t = b.tele({ kind: 'rect', len, w: 3.4 }, b.position, yaw, 1.2);
  body.move('takeoff', 0.9);
  yield 0.4;
  yield* b.over(0.8, (k) => (body.lift = easeOut(k) * 1.5));
  body.move('dive', len / 20 + 0.2);
  audio.whoosh(b.position, 2.4);
  let run = 0;
  let hit = false;
  while (run < len) {
    if (!b.push(ctx, dir.x, dir.z, 20)) break;
    run += 20 * b.dt;
    b.fx.fx.mote(b.position.clone().setY(1.6), new THREE.Vector3(0, 0.4, 0), 0.5, 0.12, BLOOD_GLOW, true);
    const p = ctx.player;
    if (!hit && p.alive && Math.hypot(p.position.x - b.position.x, p.position.z - b.position.z) < b.radius + 1.2) {
      hit = true;
      b.hurt(ctx, 1.4);
      b.knock(ctx, b.position, 4);
    }
    yield 0;
  }
  t.fire();
  yield* b.over(0.3, (k) => (body.lift = 1.5 * (1 - k)));
  body.lift = 0;
  body.move('land', 0.7);
  ctx.effects.shockwave(b.position.clone(), 3);
  audio.quake(b.position, 0.8);
  yield 0.8;
}

export const NIGHTWING: BossDef = {
  epithet: 'It has been waiting in the dark above you',
  color: CRIMSON,
  abilities: [
    { name: 'Death From Above', cooldown: 10, range: [3, 24], weight: 1.3, run: deathFromAbove },
    { name: 'Wing Tempest', cooldown: 8, range: [0, 7], run: tempest },
    { name: 'Blood Rain', cooldown: 12, range: [0, 30], run: bloodRain },
    { name: 'Sonic Screech', cooldown: 9, range: [0, 5], weight: 1.2, run: screech },
    { name: 'Sweeping Dive', cooldown: 9, range: [3.5, 24], enraged: true, run: sweep },
  ],
  sleep(b) {
    b.bossBody.lift = 6.5;
    b.bossBody.move('hang', 1e6);
  },
  *intro(b, ctx) {
    const body = b.bossBody;
    // Shivers awake where it hangs, drops, and unfurls on landing.
    b.face(ctx.player.position, 100);
    body.move('hang', 0.8);
    for (let k = 0; k < 0.8; k += b.dt) {
      b.body.rig.root.position.x += (Math.random() - 0.5) * 0.04;
      yield 0;
    }
    audio.voice('nightwing', 'hurt', b.position, 2);
    body.move('drop', 0.75);
    yield* b.over(0.6, (k) => (body.lift = 6.5 * (1 - easeIn(k))));
    body.lift = 0;
    yield 0.15;
    const at = b.position.clone();
    b.fx.cracks(at, 4, new THREE.Color(1.6, 0.3, 0.1), 3);
    b.fx.debris(at, 26, 1.1);
    ctx.effects.shockwave(at, 4.5);
    ctx.effects.addShake(1.0);
    audio.quake(at, 1.3);
    body.move('screech', 2.2, [0.45], () => {
      audio.roar('nightwing', at);
      for (let i = 0; i < 3; i++) setTimeout(() => b.fx.nova(at, 8 + i * 2, new THREE.Color(1.3, 0.4, 0.35), 0.6, 1.5), i * 140);
      ctx.effects.addShake(0.8);
      ctx.banner?.(b.name, NIGHTWING.epithet);
    });
    yield 2.2;
  },
  *enrage(b, ctx) {
    const body = b.bossBody;
    body.move('screech', 2.0, [0.4], () => {
      audio.roar('nightwing', b.position);
      b.fx.nova(b.position, 9, BLOOD_GLOW, 0.8, 1.6);
      ctx.effects.addShake(0.8);
    });
    ctx.banner?.(`${b.name} Is Frenzied`, 'Its wounds only make it faster');
    for (let i = 0; i < 40; i++) ctx.effects.blood(b.position.clone().setY(2.5), b.position.clone(), 2, BLOOD, 2);
    yield 2.0;
  },
  death(b, ctx) {
    const at = b.position.clone();
    audio.voice('nightwing', 'die', at, 2.2);
    ctx.effects.blood(at.clone().setY(2), at.clone(), 120, BLOOD, 2.2);
    for (let i = 0; i < 3; i++) ctx.effects.splat(at.x + (Math.random() - 0.5) * 4, at.z + (Math.random() - 0.5) * 4, 3.5);
    b.fx.nova(at, 7, BLOOD_GLOW, 0.8, 1.4);
    ctx.effects.addShake(1.0);
    setTimeout(() => {
      audio.quake(at, 1.2);
      b.fx.debris(at, 18, 0.8);
    }, 900);
  },
};
