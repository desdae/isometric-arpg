import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Character, clothPanel, joint, mesh } from '../Character';

// Armoured knight: a 15th-century style harness. Plates are lathed from
// spline-smoothed profiles so they read as forged curves rather than facets,
// edged with brass, over mail and a heraldic tabard, with a kite shield, an
// arming sword and a cloth cape.

export interface KnightMaterials {
  steel: THREE.Material;
  darkSteel: THREE.Material;
  leather: THREE.Material;
  cloth: THREE.Material;
  dark: THREE.Material;
  brass: THREE.Material;
  tabard: THREE.Material;
  mail: THREE.Material;
}

type V2 = [number, number];

/** Lathe through a Catmull-Rom spline of the profile: smooth, rounded plates. */
function plate(pts: V2[], seg = 32, perSpan = 5): THREE.BufferGeometry {
  const curve = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.LatheGeometry(curve.getPoints((pts.length - 1) * perSpan), seg);
}

/** Thin rolled edge (a brass band) around a lathed plate at radius r. */
function rim(r: number, tube = 0.007, seg = 40): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, tube, 6, seg).rotateX(Math.PI / 2);
}

/** Overlapping shoulder lames: stacked, flared partial spheres with rolled edges. */
function pauldron(side: number): { plates: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  const plates: THREE.BufferGeometry[] = [];
  const trim: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const r = 0.15 - i * 0.01;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(side * i * 0.024, -i * 0.042, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -side * (0.32 + i * 0.13))),
      new THREE.Vector3(1.15, 0.78, 1.05),
    );
    plates.push(new THREE.SphereGeometry(r, 28, 10, 0, Math.PI * 2, 0, Math.PI * 0.5).applyMatrix4(m).toNonIndexed());
    trim.push(rim(r, 0.006, 36).applyMatrix4(m).toNonIndexed());
  }
  // Keep the spheres' own smooth normals (recomputing on non-indexed
  // geometry would facet them).
  return { plates: mergeGeometries(plates), trim: mergeGeometries(trim) };
}

function sword(): { blade: THREE.BufferGeometry; fuller: THREE.BufferGeometry; guard: THREE.BufferGeometry; grip: THREE.BufferGeometry; pommel: THREE.BufferGeometry } {
  const len = 0.84;
  const w = 0.03;
  // Diamond-section blade, tapering to a point: two lofted halves.
  const shape = new THREE.Shape();
  shape.moveTo(-w, 0);
  shape.bezierCurveTo(-w * 0.95, len * 0.5, -w * 0.7, len * 0.85, 0, len);
  shape.bezierCurveTo(w * 0.7, len * 0.85, w * 0.95, len * 0.5, w, 0);
  shape.closePath();
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 18 });
  blade.translate(0, 0.12, -0.001);
  const fuller = new THREE.BoxGeometry(0.008, len * 0.62, 0.0125).translate(0, 0.12 + len * 0.33, 0);
  // Gently down-swept quillons with knobbed ends.
  const guard = mergeGeometries(
    [
      new THREE.TorusGeometry(0.4, 0.011, 6, 20, 0.68).rotateZ(Math.PI / 2 - 0.34).translate(0, -0.29, 0),
      new THREE.SphereGeometry(0.017, 10, 8).translate(0.135, 0.088, 0),
      new THREE.SphereGeometry(0.017, 10, 8).translate(-0.135, 0.088, 0),
      new THREE.BoxGeometry(0.05, 0.03, 0.03).translate(0, 0.11, 0),
    ].map((g) => g.toNonIndexed()),
  );
  // Leather-wrapped grip with spiral ridges.
  const grip = mergeGeometries(
    [new THREE.CylinderGeometry(0.016, 0.018, 0.17, 10).translate(0, 0.015, 0), ...Array.from({ length: 6 }, (_, i) => new THREE.TorusGeometry(0.0175, 0.0035, 4, 10).rotateX(Math.PI / 2 + 0.25).translate(0, -0.055 + i * 0.026, 0))].map((g) =>
      g.toNonIndexed(),
    ),
  );
  const pommel = new THREE.SphereGeometry(0.03, 14, 10).scale(1, 0.85, 0.6).translate(0, -0.088, 0);
  return { blade, fuller, guard, grip, pommel };
}

function kiteShield(): { face: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const outline = (k: number) => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.42 * k);
    s.quadraticCurveTo(0.26 * k, -0.15 * k, 0.25 * k, 0.22 * k);
    s.quadraticCurveTo(0.12 * k, 0.3 * k, 0, 0.3 * k);
    s.quadraticCurveTo(-0.12 * k, 0.3 * k, -0.25 * k, 0.22 * k);
    s.quadraticCurveTo(-0.26 * k, -0.15 * k, 0, -0.42 * k);
    return s;
  };
  const curve = (g: THREE.BufferGeometry) => {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setZ(i, p.getZ(i) - x * x * 0.9);
    }
    g.computeVertexNormals();
    return g;
  };
  const face = curve(new THREE.ExtrudeGeometry(outline(1), { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.014, bevelSegments: 3, curveSegments: 24 }));
  // A metal rim just proud of the face.
  const ring = outline(1.03);
  ring.holes.push(new THREE.Path(outline(0.95).getPoints(48)));
  const rimGeo = curve(new THREE.ExtrudeGeometry(ring, { depth: 0.03, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, 0.012));
  return { face, rim: rimGeo };
}

export function dressKnight(c: Character, mats: KnightMaterials): Character {
  const { steel, darkSteel, leather, cloth, dark, brass, tabard, mail } = mats;

  // Mail skirt and the leather arming belt at the hips.
  mesh(plate([[0.19, 0.04], [0.205, -0.06], [0.235, -0.22]], 32, 3).scale(1, 1, 0.82), mail, c.hips, 0, -0.02, 0);
  mesh(new THREE.CylinderGeometry(0.165, 0.175, 0.1, 24).scale(1, 1, 0.8), leather, c.hips, 0, 0.06, 0);
  // Faulds: three overlapping hooped lames.
  for (let i = 0; i < 3; i++) {
    const r0 = 0.172 + i * 0.016;
    const g = plate([[r0, 0], [r0 + 0.012, -0.035], [r0 + 0.03, -0.07]], 32, 3).scale(1, 1, 0.8);
    mesh(g, i === 2 ? darkSteel : steel, c.hips, 0, 0.05 - i * 0.05, 0);
  }

  // Breastplate: globose, waisted, with a flared lower edge.
  const cuirass = plate(
    [
      [0.0, -0.19],
      [0.165, -0.19],
      [0.18, -0.1],
      [0.205, 0.03],
      [0.218, 0.15],
      [0.19, 0.24],
      [0.12, 0.292],
      [0.06, 0.3],
    ],
    36,
    5,
  ).scale(1.05, 1, 0.78);
  mesh(cuirass, steel, c.chest, 0, 0, 0.01);
  // Brass-edged neck opening and waist line.
  mesh(rim(0.125, 0.008).scale(1.05, 1, 0.78), brass, c.chest, 0, 0.29, 0.01);
  mesh(rim(0.168, 0.008).scale(1.05, 1, 0.78), brass, c.chest, 0, -0.185, 0.01);
  // Central ridge, and a plackart rising over the belly.
  mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.38, 6), darkSteel, c.chest, 0, 0.05, 0.176);
  const plackart = new THREE.SphereGeometry(0.2, 32, 12, -0.9, 1.8, Math.PI * 0.42, Math.PI * 0.36).scale(1, 1.15, 0.72);
  mesh(plackart, steel, c.chest, 0, -0.03, 0.02);
  // Rivets down the flanks.
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) mesh(new THREE.SphereGeometry(0.008, 6, 4), brass, c.chest, s * 0.19, -0.14 + i * 0.09, 0.07);

  // Heraldic tabard over the harness: front and back panels below the plate.
  clothPanel(c, c.spine, tabard, 0.3, 0.52, new THREE.Vector3(0, 0.0, 0.168), { flare: 0.18, wrap: 0.05, sweep: 0.15 });
  clothPanel(c, c.spine, tabard, 0.32, 0.5, new THREE.Vector3(0, 0.0, -0.15), { flare: 0.2, wrap: -0.05, sweep: 0.35 });
  // Sword belt slung over it, with a brass buckle.
  mesh(new THREE.TorusGeometry(0.19, 0.016, 6, 32).rotateX(Math.PI / 2 - 0.12).scale(1, 1, 0.84), leather, c.spine, 0, -0.03, 0);
  mesh(new THREE.TorusGeometry(0.026, 0.006, 6, 14), brass, c.spine, 0, -0.04, 0.165);

  // Gorget in two lames.
  mesh(plate([[0.13, 0], [0.115, 0.04], [0.095, 0.065]], 28, 3), darkSteel, c.chest, 0, 0.255, 0);
  mesh(plate([[0.1, 0], [0.088, 0.035], [0.08, 0.06]], 28, 3), steel, c.chest, 0, 0.3, 0);

  // Great helm: rounded crown, flat-sided face with a recessed vision slit,
  // brass reinforcing cross, breaths on the right cheek.
  const helm = plate(
    [
      [0.0, -0.14],
      [0.105, -0.14],
      [0.118, -0.06],
      [0.122, 0.04],
      [0.118, 0.11],
      [0.09, 0.158],
      [0.04, 0.178],
      [0.0, 0.182],
    ],
    36,
    5,
  ).scale(0.96, 1, 1.1);
  mesh(helm, steel, c.head, 0, 0.02, 0);
  mesh(new THREE.BoxGeometry(0.19, 0.016, 0.05), dark, c.head, 0, 0.05, 0.112);
  mesh(new THREE.BoxGeometry(0.2, 0.014, 0.03).translate(0, 0.018, 0), brass, c.head, 0, 0.05, 0.12);
  mesh(new THREE.BoxGeometry(0.2, 0.012, 0.03), brass, c.head, 0, 0.034, 0.12);
  mesh(new THREE.BoxGeometry(0.016, 0.16, 0.02), brass, c.head, 0, -0.01, 0.13);
  mesh(rim(0.119, 0.006).scale(0.96, 1, 1.1), brass, c.head, 0, -0.118, 0);
  for (let i = 0; i < 8; i++) {
    mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 5).rotateX(Math.PI / 2), dark, c.head, 0.035 + (i % 4) * 0.014, -0.03 - Math.floor(i / 4) * 0.02, 0.122 - (i % 4) * 0.008);
  }
  // Crest: a short ridge and a trailing red lambrequin.
  mesh(new THREE.BoxGeometry(0.01, 0.028, 0.2).translate(0, 0.014, 0), darkSteel, c.head, 0, 0.19, 0);
  const lamb = clothPanel(c, c.head, tabard, 0.12, 0.26, new THREE.Vector3(0, 0.17, -0.09), { flare: 0.9, wrap: 0.04, sweep: 0.8 });
  lamb.rotation.x = -0.5;

  // Arms.
  const sw = sword();
  for (const side of [-1, 1]) {
    const arm = c.arm(side);
    const { shoulder, upper, fore, hand } = arm;
    const pd = pauldron(side);
    mesh(pd.plates.scale(0.84, 0.84, 0.84), steel, shoulder, side * 0.01, 0.04, 0);
    mesh(pd.trim.scale(0.84, 0.84, 0.84), brass, shoulder, side * 0.01, 0.04, 0);
    mesh(plate([[0.055, 0.02], [0.06, -0.06], [0.06, -0.16], [0.053, -0.27]], 24, 4), mail, upper, 0, 0, 0);
    mesh(plate([[0.063, 0], [0.066, -0.06], [0.062, -0.14]], 24, 4), steel, upper, 0, -0.1, 0);
    // Couter (elbow cop) with a fan-shaped side wing.
    mesh(new THREE.SphereGeometry(0.062, 20, 12).scale(1, 1, 1.1), steel, fore, 0, 0, 0);
    mesh(new THREE.SphereGeometry(0.075, 20, 8, -Math.PI / 2, Math.PI, Math.PI * 0.3, Math.PI * 0.4).scale(0.35, 1, 1).rotateY(side > 0 ? 0 : Math.PI), darkSteel, fore, side * 0.045, 0, 0);
    mesh(plate([[0.05, 0], [0.056, -0.08], [0.052, -0.16], [0.045, -0.23]], 24, 4), steel, fore, 0, -0.02, 0);
    // Gauntlet: flared cuff, knuckle plates and fingers.
    mesh(plate([[0.045, 0], [0.058, -0.04], [0.074, -0.075]], 24, 3), darkSteel, fore, 0, -0.2, 0);
    mesh(new THREE.SphereGeometry(0.05, 16, 10).scale(0.85, 1.05, 0.95), darkSteel, hand, 0, -0.005, 0.012);
    for (let f = 0; f < 4; f++) mesh(new THREE.CapsuleGeometry(0.012, 0.035, 3, 6).rotateX(0.9), darkSteel, hand, (f - 1.5) * 0.022, -0.05, 0.035);
    if (side === 1) {
      // Sword held point-forward-down in the right hand.
      const grip = joint(hand, 0, 0, 0.02);
      grip.rotation.x = 2.65;
      mesh(sw.blade, steel, grip, 0, 0, 0);
      mesh(sw.fuller, darkSteel, grip, 0, 0, 0);
      mesh(sw.guard, brass, grip, 0, 0, 0);
      mesh(sw.grip, leather, grip, 0, 0, 0);
      mesh(sw.pommel, brass, grip, 0, 0, 0);
    } else {
      // Strapped well out on the forearm so the shield clears the breastplate.
      const strap = joint(fore, -0.13, -0.13, 0.02);
      strap.rotation.y = -Math.PI / 2;
      const ks = kiteShield();
      mesh(ks.face, tabard, strap, 0, 0, 0.02);
      mesh(ks.rim, darkSteel, strap, 0, 0, 0.02);
      // Raised boss, and a brass cross charge on the field.
      mesh(new THREE.SphereGeometry(0.05, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), steel, strap, 0, 0.04, 0.062);
      mesh(new THREE.BoxGeometry(0.035, 0.5, 0.01), brass, strap, 0, -0.04, 0.058);
      mesh(new THREE.BoxGeometry(0.36, 0.035, 0.01).translate(0, 0, -0.012), brass, strap, 0, 0.12, 0.06);
    }
    arm.restUpper = side === -1 ? -0.35 : -0.1;
    arm.restFore = side === -1 ? -1.05 : -0.55;
    arm.swing = side === -1 ? 0.2 : 0.35;
  }

  // Legs.
  for (const side of [-1, 1]) {
    const { thigh, shin, foot } = c.leg(side);
    mesh(plate([[0.09, 0.02], [0.095, -0.08], [0.088, -0.22], [0.072, -0.38]], 28, 4).scale(1, 1, 1.05), steel, thigh, 0, -0.02, 0);
    mesh(new THREE.BoxGeometry(0.01, 0.34, 0.012), darkSteel, thigh, 0, -0.2, 0.093);
    // Poleyn (knee cop) with a fan plate.
    mesh(new THREE.SphereGeometry(0.066, 20, 12).scale(1, 1, 1.15), steel, shin, 0, 0, 0.02);
    mesh(new THREE.SphereGeometry(0.075, 20, 8, -Math.PI / 2, Math.PI, Math.PI * 0.3, Math.PI * 0.4).scale(0.35, 1, 1).rotateY(side > 0 ? 0 : Math.PI), darkSteel, shin, side * 0.055, 0, 0.01);
    mesh(rim(0.066, 0.005).scale(1, 1, 1.15), brass, shin, 0, -0.03, 0.02);
    // Greave, swelling over the calf.
    mesh(plate([[0.06, 0], [0.07, -0.09], [0.066, -0.2], [0.05, -0.38]], 28, 4).scale(1, 1, 1.12), steel, shin, 0, -0.03, 0);
    // Sabaton: lames tapering to a rounded toe over a leather sole.
    // One domed shell over the foot, with the lame joins picked out in dark steel.
    mesh(new THREE.SphereGeometry(0.06, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.85, 0.75, 2.1), steel, foot, 0, -0.04, 0.075);
    for (let i = 0; i < 4; i++) {
      const z = 0.02 + i * 0.045;
      const t = 1 - Math.pow((z - 0.075) / 0.126, 2); // shell profile at this z
      mesh(new THREE.TorusGeometry(0.051 * Math.sqrt(Math.max(0.05, t)), 0.004, 4, 20, Math.PI).scale(1, 0.88, 1), darkSteel, foot, 0, -0.04, z);
    }
    mesh(new THREE.BoxGeometry(0.1, 0.022, 0.27).translate(0, 0, 0.005), leather, foot, 0, -0.05, 0.08);
  }

  // Cape hanging from the shoulders, swept back by motion.
  clothPanel(c, c.chest, cloth, 0.56, 1.1, new THREE.Vector3(0, 0.24, -0.17));
  for (const m of [cloth, tabard] as THREE.MeshStandardMaterial[]) m.side = THREE.DoubleSide;
  return c;
}
