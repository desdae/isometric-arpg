import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Character, clothPanel, joint, lathe, mesh } from '../Character';

// Armoured knight: plate harness from lathe profiles and partial spheres,
// great helm, kite shield, arming sword and a cloth cape.

export interface KnightMaterials {
  steel: THREE.Material;
  darkSteel: THREE.Material;
  leather: THREE.Material;
  cloth: THREE.Material;
  dark: THREE.Material;
}

/** Overlapping shoulder lames: stacked partial spheres. */
function pauldron(side: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const r = 0.15 - i * 0.012;
    const g = new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    g.scale(1.15, 0.8, 1.05);
    g.rotateZ(-side * (0.35 + i * 0.12));
    g.translate(side * i * 0.022, -i * 0.045, 0);
    parts.push(g.toNonIndexed());
  }
  const m = mergeGeometries(parts);
  m.computeVertexNormals();
  return m;
}

function sword(): { blade: THREE.BufferGeometry; hilt: THREE.BufferGeometry } {
  const len = 0.95;
  const w = 0.045;
  const shape = new THREE.Shape();
  shape.moveTo(-w, 0);
  shape.lineTo(-w * 0.85, len * 0.8);
  shape.lineTo(0, len);
  shape.lineTo(w * 0.85, len * 0.8);
  shape.lineTo(w, 0);
  shape.closePath();
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: 1 });
  blade.translate(0, 0.12, -0.003);
  const hiltParts = [
    new THREE.BoxGeometry(0.26, 0.03, 0.04).translate(0, 0.11, 0),
    new THREE.CylinderGeometry(0.018, 0.02, 0.18, 8).translate(0, 0.01, 0),
    new THREE.SphereGeometry(0.032, 10, 8).translate(0, -0.09, 0),
    new THREE.ConeGeometry(0.02, 0.05, 6).rotateZ(Math.PI / 2).translate(0.14, 0.11, 0),
    new THREE.ConeGeometry(0.02, 0.05, 6).rotateZ(-Math.PI / 2).translate(-0.14, 0.11, 0),
  ].map((g) => g.toNonIndexed());
  return { blade, hilt: mergeGeometries(hiltParts) };
}

function kiteShield(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.42);
  s.quadraticCurveTo(0.26, -0.15, 0.25, 0.22);
  s.quadraticCurveTo(0.12, 0.3, 0, 0.3);
  s.quadraticCurveTo(-0.12, 0.3, -0.25, 0.22);
  s.quadraticCurveTo(-0.26, -0.15, 0, -0.42);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 2, curveSegments: 16 });
  // Curve it around the arm.
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, p.getZ(i) - x * x * 0.9);
  }
  g.computeVertexNormals();
  return g;
}

export function dressKnight(c: Character, mats: KnightMaterials): Character {
    const { steel, darkSteel, leather, cloth, dark } = mats;
    
    // Faulds: banded skirt of plates around the hips.
    for (let i = 0; i < 3; i++) {
      const r0 = 0.17 + i * 0.022;
      mesh(lathe([[r0, 0], [r0 + 0.028, -0.07]], 18).scale(1, 1, 0.8), i % 2 ? darkSteel : steel, c.hips, 0, 0.04 - i * 0.06, 0);
    }
    mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.12, 14).scale(1, 1, 0.8), leather, c.hips, 0, 0.06, 0);
    // Mail skirt under the faulds.
    mesh(lathe([[0.2, 0], [0.23, -0.2]], 18).scale(1, 1, 0.82), darkSteel, c.hips, 0, -0.1, 0);

    // Breastplate: lathe profile with a pronounced chest, flattened front-to-back.
    const cuirass = lathe(
      [
        [0.0, -0.18],
        [0.17, -0.18],
        [0.19, -0.08],
        [0.215, 0.05],
        [0.22, 0.16],
        [0.19, 0.24],
        [0.12, 0.29],
        [0.07, 0.3],
      ],
      20,
    ).scale(1.05, 1, 0.78);
    mesh(cuirass, steel, c.chest, 0, 0, 0.01);
    // Central ridge (tapul) down the breastplate.
    mesh(new THREE.BoxGeometry(0.02, 0.36, 0.03), darkSteel, c.chest, 0, 0.05, 0.175);
    // Belt with buckle.
    mesh(new THREE.TorusGeometry(0.18, 0.022, 6, 24).rotateX(Math.PI / 2).scale(1, 0.8, 1), leather, c.spine, 0, 0.0, 0);
    mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), darkSteel, c.spine, 0, 0.0, 0.145);
    // Gorget.
    mesh(lathe([[0.12, 0], [0.1, 0.06], [0.08, 0.1]], 16), darkSteel, c.chest, 0, 0.26, 0);

    // Great helm with visor slit, breaths and a cruciform brow.
    const helm = lathe(
      [
        [0.0, -0.13],
        [0.1, -0.13],
        [0.115, -0.05],
        [0.12, 0.06],
        [0.11, 0.12],
        [0.07, 0.165],
        [0.0, 0.18],
      ],
      18,
    ).scale(1, 1, 1.08);
    mesh(helm, steel, c.head, 0, 0.02, 0);
    mesh(new THREE.BoxGeometry(0.17, 0.018, 0.04), dark, c.head, 0, 0.05, 0.115);
    mesh(new THREE.BoxGeometry(0.018, 0.12, 0.03), darkSteel, c.head, 0, 0.02, 0.125);
    mesh(new THREE.BoxGeometry(0.2, 0.018, 0.03), darkSteel, c.head, 0, 0.085, 0.117);
    for (let i = 0; i < 6; i++) {
      mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 4).rotateX(Math.PI / 2), dark, c.head, 0.03 + (i % 3) * 0.018, -0.03 - Math.floor(i / 3) * 0.022, 0.12);
    }
    // Small crest ridge.
    mesh(new THREE.BoxGeometry(0.012, 0.03, 0.22), darkSteel, c.head, 0, 0.19, 0);

    // Arms.
    const { blade, hilt } = sword();
    for (const side of [-1, 1]) {
      const arm = c.arm(side);
      const { shoulder, upper, fore, hand } = arm;
      mesh(pauldron(side).scale(0.82, 0.82, 0.82), steel, shoulder, side * 0.01, 0.04, 0);
      mesh(lathe([[0.058, 0], [0.062, -0.12], [0.054, -0.26]], 12), steel, upper, 0, -0.02, 0);
      // Couter (elbow cop) with a side wing.
      mesh(new THREE.SphereGeometry(0.06, 12, 8), darkSteel, fore, 0, 0, 0);
      mesh(new THREE.ConeGeometry(0.05, 0.03, 10).rotateZ(side * Math.PI / 2), steel, fore, side * 0.05, 0, 0);
      mesh(lathe([[0.05, 0], [0.056, -0.12], [0.045, -0.24]], 12), steel, fore, 0, -0.02, 0);
      // Gauntlet: flared cuff and a mailed fist.
      mesh(lathe([[0.045, 0], [0.07, -0.07]], 12), darkSteel, fore, 0, -0.22, 0);
      mesh(new THREE.BoxGeometry(0.075, 0.09, 0.085), darkSteel, hand, 0, 0, 0.01);
      if (side === 1) {
        // Sword held point-forward-down in the right hand.
        const grip = joint(hand, 0, 0, 0.02);
        grip.rotation.x = 2.65; // blade angled down and forward at rest
        mesh(blade, steel, grip, 0, 0, 0);
        mesh(hilt, leather, grip, 0, 0, 0);
      } else {
        const strap = joint(fore, -0.06, -0.12, 0.02);
        strap.rotation.y = -Math.PI / 2;
        mesh(kiteShield(), darkSteel, strap, 0, 0, 0.02);
        // Raised boss and rim emblem.
        mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), steel, strap, 0, 0.02, 0.06);
      }
      // Shield arm held up across the body; sword arm low and forward.
      arm.restUpper = side === -1 ? -0.35 : -0.1;
      arm.restFore = side === -1 ? -1.25 : -0.55;
      arm.swing = side === -1 ? 0.2 : 0.35;
    }

    // Legs.
    for (const side of [-1, 1]) {
      const { thigh, shin, foot } = c.leg(side);
      mesh(lathe([[0.095, 0], [0.09, -0.2], [0.07, -0.4]], 14), steel, thigh, 0, -0.02, 0);
      // Poleyn (knee cop) with a fan plate.
      mesh(new THREE.SphereGeometry(0.065, 12, 8).scale(1, 1, 1.15), darkSteel, shin, 0, 0, 0.02);
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).scale(1, 1, 1), steel, shin, side * 0.06, 0, 0.01);
      mesh(lathe([[0.065, 0], [0.072, -0.14], [0.052, -0.38]], 14).scale(1, 1, 1.1), steel, shin, 0, -0.03, 0);
      // Sabaton: overlapping lames tapering to the toe.
      for (let i = 0; i < 4; i++) {
        mesh(new THREE.BoxGeometry(0.1 - i * 0.008, 0.06 - i * 0.008, 0.07), i % 2 ? darkSteel : steel, foot, 0, -0.01 - i * 0.004, 0.01 + i * 0.05);
      }
      mesh(new THREE.BoxGeometry(0.1, 0.03, 0.26), leather, foot, 0, -0.035, 0.06);
    }

    // Cape hanging from the shoulders, swept back by motion.
    clothPanel(c, c.chest, cloth, 0.56, 1.1, new THREE.Vector3(0, 0.24, -0.15));
    (cloth as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  return c;
}
