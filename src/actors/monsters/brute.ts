import * as THREE from 'three';
import { Character, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { band, bump, bumpA, sculptLathe, sculptSphere, strapLoop, surfacePoint } from '../sculpt';
import { collapse, flinch, keyedAction } from './humanoid';
import type { MonsterBody, MonsterMaterials } from './materials';

// Brute: a huge bald man gone feral. Every muscle group is sculpted into one
// continuous skin (pecs, abs, traps, deltoids, biceps), a heavy brow and a
// thick beard, a single steel pauldron strapped across the chest, leather
// bracers, a strip kilt, wrapped boots and a butcher's cleaver as long as a leg.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Pauldron on the left shoulder (+X: the rig faces +Z), cleaver in the right hand. */
const PAULDRON_SIDE = 1;

function cleaver(): { blade: THREE.BufferGeometry; grip: THREE.BufferGeometry; wraps: THREE.BufferGeometry[]; fittings: THREE.BufferGeometry[] } {
  // Blade runs along +Y from the grip; spine at x < 0, edge at +X. A long,
  // almost rectangular slab with a hanging hole near the tip and a chipped edge.
  const s = new THREE.Shape();
  s.moveTo(-0.025, 0.15);
  s.lineTo(-0.035, 0.9);
  s.quadraticCurveTo(-0.035, 0.94, 0.0, 0.94);
  s.lineTo(0.17, 0.94);
  s.quadraticCurveTo(0.2, 0.935, 0.2, 0.9);
  const chips = 14;
  for (let i = 1; i <= chips; i++) {
    const y = 0.9 - (i / chips) * 0.68;
    const nick = i % 4 === 1 ? 0.012 : i % 5 === 2 ? 0.007 : 0;
    s.lineTo(0.2 - i * 0.0015 - nick, y);
  }
  s.quadraticCurveTo(0.18, 0.16, 0.08, 0.15);
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0.03, 0.85, 0.024, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.01, bevelSegments: 2, curveSegments: 10 });
  // Turn the edge (+X in the shape) to face +Z: the overhead slam swings the
  // grip about its X axis, so +Z is the direction the blade travels and the
  // edge, not the flat, leads the blow.
  blade.translate(0, 0, -0.007).rotateY(-Math.PI / 2);
  const grip = new THREE.CylinderGeometry(0.026, 0.03, 0.3, 10);
  const wraps: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) wraps.push(new THREE.TorusGeometry(0.03, 0.007, 4, 12).rotateX(Math.PI / 2).rotateZ(0.25).translate(0, -0.12 + i * 0.038, 0));
  const fittings = [
    new THREE.CylinderGeometry(0.036, 0.036, 0.03, 10).translate(0, 0.15, 0), // ferrule
    new THREE.SphereGeometry(0.038, 10, 8).scale(1, 0.7, 1).translate(0, -0.16, 0), // pommel
  ];
  return { blade, grip, wraps, fittings };
}

/**
 * A leather strip hanging from its top edge: curved around a cylinder of
 * radius `curve`, flaring out toward the hem, with a notched, ragged end.
 */
function strip(w: number, len: number, curve: number, rng: Rng): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, len, 4, 8).translate(0, -len / 2, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const notch = range(rng, 0.01, 0.03);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    let y = p.getY(i);
    const t = -y / len;
    if (t > 0.99) y += notch * (1 - Math.abs(x) / (w / 2)) * (Math.sin(x * 90) > 0 ? 1 : 0.4);
    p.setXYZ(i, x, y, -(x * x) / (2 * curve) + t * t * 0.05);
  }
  g.computeVertexNormals();
  return g;
}

export function buildBrute(m: MonsterMaterials, rng: Rng, scale = range(rng, 1.38, 1.5)): MonsterBody {
  const c = new Character({ scale, hunch: 0.35, stride: 1.7 });
  const skin = m.tannedSkin;
  const leather = (m.leather as THREE.MeshStandardMaterial).clone();
  leather.side = THREE.DoubleSide;
  const darkLeather = new THREE.MeshStandardMaterial({ color: 0x150d08, roughness: 0.8, side: THREE.DoubleSide });
  const eye = new THREE.MeshStandardMaterial({ color: 0x060303, roughness: 0.1, emissive: new THREE.Color(0.08, 0.008, 0.004) });
  const P = PAULDRON_SIDE;

  // --- Torso -----------------------------------------------------------
  // Upper body on the chest joint: waist up to the neck in a broad V. Pecs
  // with a hard lower shelf and the sternum groove at the front; shoulder
  // blades, spine groove and lats at the back; traps heaped toward the neck.
  const chestGeo = sculptLathe(
    [[0.18, -0.16], [0.2, -0.06], [0.24, 0.06], [0.272, 0.16], [0.265, 0.25], [0.215, 0.31], [0.13, 0.37], [0.07, 0.41], [0.0, 0.42]],
    (_x, y, _z, t) => {
      let d = 0;
      for (const s of [-1, 1]) {
        const pec = bumpA(t, y, s * 0.5, 0.15, 0.45, 0.08);
        d += 0.075 * pec * smooth(0.035, 0.085, y);
        d -= 0.022 * bumpA(t, y, s * 0.55, 0.04, 0.5, 0.022); // crease under the pec
        d += 0.055 * bumpA(t, y, s * 2.45, 0.17, 0.35, 0.08); // shoulder blade
        d += 0.025 * bumpA(t, y, s * 2.85, -0.08, 0.14, 0.1); // spinal erectors
        d += 0.035 * bumpA(t, y, s * 1.6, 0.03, 0.35, 0.12); // lats
        d += 0.045 * bumpA(t, y, s * 1.0, 0.3, 0.55, 0.045); // traps
        for (const ry of [-0.1, -0.05, 0.0]) d += 0.01 * bumpA(t, y, s * (1.0 + ry), ry, 0.12, 0.018); // serratus
      }
      d -= 0.03 * bumpA(t, y, 0, 0.14, 0.09, 0.1); // sternum
      d -= 0.03 * bumpA(t, y, Math.PI, 0.1, 0.09, 0.3); // spine
      return d;
    },
    { sx: 1.22, sz: 0.76, seg: 64, perSpan: 8 },
  );
  mesh(chestGeo, skin, c.chest);

  // Belly on the spine joint: eight hard blocks over a slight gut, obliques.
  const absGeo = sculptLathe(
    [[0.2, -0.17], [0.19, -0.06], [0.19, 0.06], [0.198, 0.18], [0.205, 0.26]],
    (_x, y, _z, t) => {
      let d = 0.01 * bumpA(t, y, 0, 0.02, 0.6, 0.15);
      for (const s of [-1, 1]) {
        for (const [cy, a] of [[0.17, 0.022], [0.095, 0.024], [0.02, 0.024], [-0.06, 0.016]]) d += a * bumpA(t, y, s * 0.21, cy, 0.15, 0.028);
        d += 0.03 * bumpA(t, y, s * 1.05, -0.04, 0.32, 0.09); // obliques
      }
      d -= 0.012 * bumpA(t, y, 0, 0.06, 0.05, 0.22); // linea alba
      d -= 0.015 * bumpA(t, y, Math.PI, 0.1, 0.12, 0.3);
      return d;
    },
    { sx: 1.16, sz: 0.84, seg: 56, perSpan: 8 },
  );
  mesh(absGeo, skin, c.spine);
  mesh(new THREE.SphereGeometry(0.011, 8, 6), darkLeather, c.spine, 0, -0.1, surfacePoint(absGeo, -0.1, 0).z - 0.007); // navel

  // --- Head ------------------------------------------------------------
  // Unit-sphere layout (z forward): brow y 0.22, eyes 0.1, nose tip -0.12,
  // mouth -0.33, chin -0.75.
  c.head.position.set(0, 0.33, 0.06);
  const headR = 0.112;
  const headScale = new THREE.Vector3(0.93, 0.95, 1.03);
  const headPos = new THREE.Vector3(0, 0.1, 0.01);
  const fy = 0.07; // features sit a little high: a low, heavy crown over a long jaw
  const face = (x: number, y0: number, z: number) => {
    const y = y0 - fy;
    const front = smooth(0.2, 0.85, z);
    const tip = smooth(0.6, 0.98, z);
    let d = 0;
    d += 0.2 * bump(x, y, 0, 0.23, 0.62, 0.075) * front; // brow ridge
    d -= 0.06 * bump(x, y, 0, 0.3, 0.08, 0.12) * front; // scowl furrow
    for (const s of [-1, 1]) {
      d -= 0.13 * bump(x, y, s * 0.31, 0.11, 0.15, 0.07) * front; // eye sockets
      d += 0.12 * bump(x, y, s * 0.52, -0.02, 0.18, 0.09) * front; // cheekbones
      d += 0.1 * bump(x, y, s * 0.52, -0.5, 0.3, 0.25); // heavy jaw
      d += 0.05 * bump(x, y, s * 0.5, -0.25, 0.1, 0.06) * front; // nasolabial folds
    }
    d += 0.36 * bump(x, y, 0, -0.06, 0.12, 0.2) * tip; // nose
    d += 0.12 * bump(x, y, 0, -0.17, 0.3, 0.07) * tip; // nostril wings
    d += 0.06 * bump(x, y, 0, -0.62, 0.35, 0.18) * front; // chin
    d -= 0.1 * bump(x, y, 0, 0.85, 0.8, 0.35); // flat crown
    d += 0.05 * bump(x, y, 0, 0.1, 0.8, 0.5) * smooth(0, -0.6, z); // occiput
    return d;
  };
  // Neck: short and thick, flaring into the traps.
  mesh(lathe([[0.1, -0.17], [0.092, -0.04], [0.082, 0.05]], 18).scale(1.15, 1, 1), skin, c.head, 0, 0, -0.012);
  const skull = sculptSphere(headR, face, headScale, 56, 42);
  mesh(skull, skin, c.head, headPos.x, headPos.y, headPos.z);
  for (const s of [-1, 1]) {
    // Small eyes deep under the brow.
    const e = surfacePoint(skull, (0.1 + fy) * headR, s * 0.32, -0.006);
    mesh(new THREE.SphereGeometry(0.011, 10, 8), eye, c.head, e.x, e.y + headPos.y, e.z + headPos.z);
    // Ears.
    const ear = mesh(sculptSphere(0.028, (_x, y) => 0.15 * bump(0, y, 0, 0.3, 1, 0.3), new THREE.Vector3(0.4, 1.15, 0.8), 16, 12), skin, c.head, s * 0.1, 0.108, -0.005);
    ear.rotation.y = s * 0.35;
  }
  // Beard: the face surface again, pushed out where hair grows and sunk
  // under the skin everywhere else. Cheeks, jaw and chin; thick and clumpy,
  // with a chin tuft jutting forward and down.
  const beard = sculptSphere(
    headR,
    (x, y, z) => {
      // Sideburns down from the temples, a cheek line falling toward the
      // mouth, and the mustache under the nose.
      const cutY = fy + 0.1 - 0.29 * smooth(0.35, 0.78, z) - 0.04 * smooth(0.4, 0.1, Math.abs(x)) * smooth(0.7, 0.9, z);
      const grow = smooth(cutY + 0.07, cutY - 0.07, y) * smooth(-0.6, -0.25, z);
      const clumps = 0.035 * Math.sin(x * 26 + y * 9) * Math.sin(y * 21 - x * 6) + 0.02 * Math.sin(x * 47 + y * 33);
      const tuft = 0.45 * bump(x, y, 0, -0.88, 0.55, 0.35) * smooth(-0.2, 0.6, z);
      return face(x, y, z) + grow * (0.11 + clumps + tuft) - (1 - grow) * 0.05;
    },
    headScale,
    72,
    54,
  );
  mesh(beard, m.hair, c.head, headPos.x, headPos.y, headPos.z);
  // Drooping mustache and a dark mouth line in the beard.
  const strand = lathe([[0.0, 0.03], [0.011, 0.018], [0.013, 0.0], [0.009, -0.025], [0.003, -0.045], [0.0, -0.05]], 10);
  for (const s of [-1, 1]) {
    for (const [dx, dy, rz, k] of [[0.016, -0.004, 1.15, 1], [0.03, -0.022, 0.35, 0.8]]) {
      const mp = surfacePoint(beard, (fy - 0.24) * headR + dy, s * Math.atan2(dx, 0.11), -0.002);
      const mus = mesh(strand.clone().scale(k, k, k * 0.8), m.hair, c.head, mp.x, mp.y + headPos.y, mp.z + headPos.z);
      mus.rotation.set(0.2, 0, s * rz);
    }
  }
  const mouth = surfacePoint(beard, (fy - 0.36) * headR, 0, -0.002);
  mesh(new THREE.BoxGeometry(0.036, 0.006, 0.012), darkLeather, c.head, 0, mouth.y + headPos.y, mouth.z + headPos.z);

  // Tooth necklace on a cord lying around the base of the neck.
  const neckline = (a: number) => {
    const front = 0.5 + 0.5 * Math.cos(a);
    return 0.43 - 0.14 * front * front;
  };
  const cordPts: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    const a = -Math.PI + (i / 24) * Math.PI * 2;
    cordPts.push(surfacePoint(chestGeo, neckline(a), a, 0.006));
  }
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cordPts, true), 64, 0.005, 5, true), darkLeather, c.chest);
  for (let i = -4; i <= 4; i++) {
    const a = i * 0.14;
    const p = surfacePoint(chestGeo, neckline(a) - 0.026, a, 0.012);
    const tooth = mesh(new THREE.ConeGeometry(range(rng, 0.009, 0.012), range(rng, 0.045, 0.06) - Math.abs(i) * 0.003, 6).rotateX(Math.PI), m.bone, c.chest, p.x, p.y, p.z);
    tooth.rotation.set(-0.3, a, range(rng, -0.15, 0.15));
  }

  // --- Arms --------------------------------------------------------------
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    a.shoulder.position.x *= 1.45;
    a.shoulder.position.y = 0.19;
    a.fore.position.y = -0.31;
    a.hand.position.y = -0.33;
    // Deltoid: front, side and rear heads capping the top of the arm.
    const delt = sculptSphere(
      0.104,
      (x, y, z) =>
        0.14 * bump(x * side, z, 0.25, 0.65, 0.45, 0.3) +
        0.12 * bump(x * side, z, 0.25, -0.6, 0.45, 0.3) +
        0.1 * bump(x * side, y, 0.85, 0.0, 0.3, 0.5) -
        0.25 * smooth(-0.3, -0.9, y),
      new THREE.Vector3(1.0, 1.32, 1.1),
      36,
      28,
    );
    mesh(delt, skin, a.shoulder, side * 0.022, -0.05, 0);
    const upper = sculptLathe(
      [[0.098, 0.04], [0.104, -0.06], [0.1, -0.16], [0.086, -0.25], [0.072, -0.33], [0.05, -0.37], [0.001, -0.385]],
      (_x, y, _z, t) =>
        0.04 * bumpA(t, y, 0, -0.15, 0.6, 0.07) + // biceps
        0.035 * bumpA(t, y, Math.PI, -0.1, 0.7, 0.09) + // triceps
        0.015 * bumpA(t, y, side * 1.6, -0.03, 0.4, 0.06) - // lateral head
        0.01 * bumpA(t, y, side * 1.2, -0.17, 0.25, 0.08), // groove between biceps and triceps
      { seg: 36 },
    );
    mesh(upper, skin, a.upper);
    const fore = sculptLathe(
      [[0.001, 0.075], [0.055, 0.06], [0.08, 0.02], [0.092, -0.06], [0.086, -0.15], [0.064, -0.27], [0.054, -0.35]],
      (_x, y, _z, t) => 0.022 * bumpA(t, y, side * 0.9, -0.05, 0.5, 0.07) + 0.016 * bumpA(t, y, -side * 0.8, -0.08, 0.6, 0.08),
      { seg: 36 },
    );
    mesh(fore, skin, a.fore);
    // Fist: palm, four curled fingers in a row and a thumb across them.
    mesh(sculptSphere(0.052, (_x, y) => -0.15 * smooth(0.5, 1, y), new THREE.Vector3(0.85, 1.2, 1.1), 20, 16), skin, a.hand, 0, -0.05, 0.005);
    for (let f = 0; f < 4; f++) {
      const fz = (f - 1.5) * 0.022;
      mesh(new THREE.CapsuleGeometry(0.0125, 0.045, 3, 8).rotateZ(Math.PI / 2), skin, a.hand, 0, -0.098 + Math.abs(f - 1.5) * 0.004, fz);
    }
    const thumb = mesh(new THREE.CapsuleGeometry(0.012, 0.035, 3, 8), skin, a.hand, -side * 0.025, -0.07, 0.04);
    thumb.rotation.set(0.5, 0, side * 0.6);
    a.upper.rotation.z = side * 0.32;
    a.restUpper = -0.2;
    a.restFore = -0.4;
    a.swing = 0.3;

    // Bracers: thick leather cuffs with rolled edges, lacing and steel studs.
    const bracer = sculptLathe([[0.112, -0.1], [0.104, -0.18], [0.084, -0.26], [0.072, -0.31]], (_x, y, _z, t) => 0.004 * Math.sin(t * 9) * smooth(-0.1, -0.3, y), { seg: 32 });
    mesh(bracer, side === P ? leather : darkLeather, a.fore);
    mesh(band(0.108, 0.024, 0.01), darkLeather, a.fore, 0, -0.105, 0);
    mesh(band(0.07, 0.018, 0.008), darkLeather, a.fore, 0, -0.305, 0);
    for (let i = 0; i < 5; i++) {
      // Lacing up the inside of the cuff.
      const y = -0.13 - i * 0.035;
      const r = surfacePoint(bracer, y, -side * Math.PI / 2, 0.003);
      const lace = mesh(new THREE.BoxGeometry(0.006, 0.004, 0.03), darkLeather, a.fore, r.x, r.y, r.z);
      lace.rotation.x = (i % 2 ? 1 : -1) * 0.6;
    }
    for (const t of [0.4, 1.0, 1.6, 2.2]) {
      for (const y of [-0.15, -0.24]) {
        const p = surfacePoint(bracer, y, side * t, 0.002);
        mesh(new THREE.SphereGeometry(0.008, 6, 4), m.steel, a.fore, p.x, p.y, p.z);
      }
    }

    if (side === P) {
      // Steel pauldron: a domed cap with a rolled rim and a raised ridge,
      // over three overlapping lames down the outside of the arm, riveted.
      const plate = (m.steel as THREE.MeshStandardMaterial).clone();
      plate.side = THREE.DoubleSide;
      const capR = 0.165;
      const capTheta = Math.PI * 0.42;
      const cap = mesh(new THREE.SphereGeometry(capR, 32, 12, 0, Math.PI * 2, 0, capTheta).scale(1, 0.72, 1.08), plate, a.shoulder, side * 0.02, 0.035, 0);
      cap.rotation.z = -side * 0.3;
      const rimY = Math.cos(capTheta) * capR * 0.72;
      mesh(new THREE.TorusGeometry(Math.sin(capTheta) * capR, 0.011, 6, 40).rotateX(Math.PI / 2).scale(1, 1, 1.08), plate, cap, 0, rimY, 0);
      const ridge = new THREE.TorusGeometry(capR, 0.012, 6, 24, capTheta * 2).rotateZ(Math.PI / 2 - capTheta).scale(1, 0.72, 1.08).rotateY(Math.PI / 2);
      mesh(ridge, plate, cap);
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const rr = Math.sin(capTheta) * capR * 0.9;
        mesh(new THREE.SphereGeometry(0.009, 6, 4), m.steel, cap, Math.cos(ang) * rr, rimY + 0.012, Math.sin(ang) * rr * 1.08);
      }
      const phiC = side > 0 ? Math.PI : 0; // sphere phi whose direction points out along ±X
      for (let i = 0; i < 3; i++) {
        const r = 0.172 + i * 0.01;
        const th0 = Math.PI * (0.38 + i * 0.07);
        const lame = mesh(new THREE.SphereGeometry(r, 28, 3, phiC - Math.PI * 0.55, Math.PI * 1.1, th0, Math.PI * 0.13).scale(1, 0.95, 1.1), plate, a.shoulder, side * 0.01, -i * 0.028, 0);
        lame.rotation.z = -side * 0.35;
        for (let k = -1; k <= 1; k++) {
          const phi = phiC + k * 0.38 * Math.PI;
          const th = th0 + Math.PI * 0.04;
          mesh(new THREE.SphereGeometry(0.008, 6, 4), m.steel, lame, -Math.cos(phi) * Math.sin(th) * r * 1.02, Math.cos(th) * r * 0.95 * 1.02, Math.sin(phi) * Math.sin(th) * r * 1.1 * 1.02);
        }
      }
    } else {
      const grip = joint(a.hand, 0, -0.06, 0.012);
      grip.rotation.x = 2.5;
      const cl = cleaver();
      mesh(cl.blade, m.steel, grip);
      mesh(cl.grip, m.wood, grip);
      cl.wraps.forEach((g) => mesh(g, darkLeather, grip));
      cl.fittings.forEach((g) => mesh(g, m.iron, grip));
    }
  }
  // Pauldron strap: from the top of the left shoulder diagonally across the
  // chest to under the right arm, and back up across the shoulder blades.
  {
    const path: [number, number][] = [
      [P * 1.25, 0.31], [P * 0.7, 0.24], [P * 0.2, 0.15], [-P * 0.35, 0.07], [-P * 0.95, 0.0], [-P * 1.55, -0.03],
      [-P * 2.2, 0.0], [-P * 2.75, 0.08], [P * 2.95, 0.17], [P * 2.4, 0.26], [P * 1.85, 0.32],
    ];
    // Unwrap the angles so the loop runs one way round, then sample it densely
    // and drop every sample onto the skin, so the strap never cuts inside.
    let prev = path[0][0];
    const unwrapped = path.map(([t, y]) => {
      while (t > prev + Math.PI) t -= Math.PI * 2;
      while (t < prev - Math.PI) t += Math.PI * 2;
      prev = t;
      return new THREE.Vector3(t, y, 0);
    });
    const guide = new THREE.CatmullRomCurve3([...unwrapped, new THREE.Vector3(unwrapped[0].x - P * Math.PI * 2, unwrapped[0].y, 0)]);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 90; i++) {
      const g = guide.getPoint(i / 90);
      pts.push(surfacePoint(chestGeo, g.y, g.x, 0.004));
    }
    mesh(strapLoop(pts, (p) => new THREE.Vector3(p.x, 0, p.z), 0.045, 0.012), leather, c.chest);
    const buckle = surfacePoint(chestGeo, 0.15, P * 0.2, 0.016);
    const bk = mesh(band(0.02, 0.006, 0.006, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4), m.iron, c.chest, buckle.x, buckle.y, buckle.z);
    bk.rotation.set(0, P * 0.2, P * 0.6);
  }

  // --- Legs, belt and kilt ------------------------------------------------
  for (const side of [-1, 1]) {
    const l = c.leg(side);
    const thigh = sculptLathe(
      [[0.13, 0.04], [0.135, -0.08], [0.12, -0.26], [0.098, -0.4], [0.088, -0.46], [0.05, -0.51], [0.001, -0.52]],
      (_x, y, _z, t) => 0.03 * bumpA(t, y, side * 0.3, -0.2, 0.6, 0.12) + 0.02 * bumpA(t, y, -side * 0.5, -0.33, 0.4, 0.06),
      { seg: 32 },
    );
    mesh(thigh, skin, l.thigh);
    const shin = sculptLathe(
      [[0.001, 0.05], [0.05, 0.04], [0.08, 0.0], [0.09, -0.1], [0.072, -0.3], [0.06, -0.44]],
      (_x, y, _z, t) => 0.03 * bumpA(t, y, Math.PI, -0.12, 0.7, 0.08) + 0.012 * bumpA(t, y, 0, 0.0, 0.5, 0.05),
      { seg: 28 },
    );
    mesh(shin, skin, l.shin);
    // Tall wrapped boots with a folded cuff and crossing straps.
    const boot = sculptLathe(
      [[0.104, -0.13], [0.106, -0.17], [0.088, -0.32], [0.078, -0.47]],
      (_x, y, _z, t) => 0.024 * bumpA(t, y, Math.PI, -0.18, 0.7, 0.07) + 0.003 * Math.sin(y * 120 + t * 2),
      { seg: 32 },
    );
    mesh(boot, darkLeather, l.shin);
    mesh(new THREE.TorusGeometry(0.106, 0.014, 6, 28).rotateX(Math.PI / 2), darkLeather, l.shin, 0, -0.13, 0);
    for (let i = 0; i < 4; i++) {
      const y = -0.2 - i * 0.07;
      const r = Math.hypot(surfacePoint(boot, y, 0).z, 0);
      const strapRing = mesh(band(r, 0.018, 0.006), leather, l.shin, 0, y, 0);
      strapRing.rotation.x = (i % 2 ? 1 : -1) * 0.12;
    }
    mesh(new THREE.CapsuleGeometry(0.058, 0.14, 4, 12).rotateX(Math.PI / 2).scale(1.1, 0.8, 1), darkLeather, l.foot, 0, -0.03, 0.05);
    mesh(new THREE.BoxGeometry(0.13, 0.02, 0.25), leather, l.foot, 0, -0.072, 0.05);

    // Kilt strips ride on the thighs so they swing with each stride.
    for (let k = 0; k < 5; k++) {
      const ang = side * (0.15 + k * 0.62);
      const len = range(rng, 0.27, 0.33);
      const s = mesh(strip(0.075, len, 0.15, rng), k % 2 ? darkLeather : leather, l.thigh, Math.sin(ang) * 0.15, 0.07, Math.cos(ang) * 0.15);
      s.rotation.set(0, ang, 0, 'YXZ');
      for (const y of [-0.025]) mesh(new THREE.SphereGeometry(0.008, 5, 4), m.steel, s, 0, y, 0.006);
    }
  }
  c.legs.forEach((l) => (l.thigh.position.x *= 1.35));
  // Hips under the kilt, then a broad belt with an iron buckle.
  mesh(lathe([[0.215, 0.1], [0.23, 0.0], [0.235, -0.1], [0.2, -0.16]], 24).scale(1.12, 1, 0.88), darkLeather, c.hips);
  const belt = sculptLathe([[0.228, 0.135], [0.236, 0.1], [0.236, 0.0], [0.228, -0.03]], (_x, y, _z, t) => 0.003 * Math.sin(t * 7 + y * 30), { sx: 1.14, sz: 0.9, seg: 40 });
  mesh(belt, leather, c.hips);
  const bf = surfacePoint(belt, 0.05, 0, 0);
  mesh(band(0.04, 0.012, 0.012, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 1.3, 1), m.iron, c.hips, 0, 0.05, bf.z + 0.008);
  mesh(new THREE.BoxGeometry(0.008, 0.06, 0.012), m.iron, c.hips, 0, 0.05, bf.z + 0.012);
  for (let k = 0; k < 10; k++) {
    const t = ((k + 0.5) / 10) * Math.PI * 2;
    if (Math.abs(Math.sin(t / 2)) < 0.25) continue;
    const p = surfacePoint(belt, 0.05, t, 0.002);
    mesh(new THREE.SphereGeometry(0.009, 6, 4), m.steel, c.hips, p.x, p.y, p.z);
  }
  // Front and back flaps between the legs.
  const flapF = mesh(strip(0.16, 0.36, 0.3, rng), darkLeather, c.hips, 0, 0.0, 0.215);
  flapF.rotation.x = 0.05;
  const flapB = mesh(strip(0.2, 0.34, 0.3, rng), darkLeather, c.hips, 0, 0.0, -0.205);
  flapB.rotation.set(-0.05, Math.PI, 0);

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
