import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedurally modelled armoured knight on a joint hierarchy, animated by a
// procedural gait (no keyframes). Every plate is generated from lathe
// profiles, partial spheres and extrusions.

export interface CharacterMaterials {
  steel: THREE.Material;
  darkSteel: THREE.Material;
  leather: THREE.Material;
  cloth: THREE.Material;
  dark: THREE.Material;
}

type V2 = [number, number];
const lathe = (pts: V2[], seg = 16) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function joint(parent: THREE.Object3D, x: number, y: number, z: number) {
  const j = new THREE.Object3D();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
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

export class Character {
  readonly root = new THREE.Group();
  private hips: THREE.Object3D;
  private spine: THREE.Object3D;
  private chest: THREE.Object3D;
  private head: THREE.Object3D;
  private legs: { thigh: THREE.Object3D; shin: THREE.Object3D; foot: THREE.Object3D; side: number }[] = [];
  private arms: { upper: THREE.Object3D; fore: THREE.Object3D; side: number }[] = [];
  private cape: THREE.Mesh;
  private capeRest: Float32Array;
  private phase = 0;
  private walk = 0;
  private time = 0;
  readonly hipHeight = 0.98;

  constructor(mats: CharacterMaterials) {
    const { steel, darkSteel, leather, cloth, dark } = mats;
    this.hips = joint(this.root, 0, this.hipHeight, 0);

    // Faulds: banded skirt of plates around the hips.
    for (let i = 0; i < 3; i++) {
      const r0 = 0.17 + i * 0.022;
      mesh(lathe([[r0, 0], [r0 + 0.028, -0.07]], 18).scale(1, 1, 0.8), i % 2 ? darkSteel : steel, this.hips, 0, 0.04 - i * 0.06, 0);
    }
    mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.12, 14).scale(1, 1, 0.8), leather, this.hips, 0, 0.06, 0);
    // Mail skirt under the faulds.
    mesh(lathe([[0.2, 0], [0.23, -0.2]], 18).scale(1, 1, 0.82), darkSteel, this.hips, 0, -0.1, 0);

    this.spine = joint(this.hips, 0, 0.1, 0);
    this.chest = joint(this.spine, 0, 0.2, 0);
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
    mesh(cuirass, steel, this.chest, 0, 0, 0.01);
    // Central ridge (tapul) down the breastplate.
    mesh(new THREE.BoxGeometry(0.02, 0.36, 0.03), darkSteel, this.chest, 0, 0.05, 0.175);
    // Belt with buckle.
    mesh(new THREE.TorusGeometry(0.18, 0.022, 6, 24).rotateX(Math.PI / 2).scale(1, 0.8, 1), leather, this.spine, 0, 0.0, 0);
    mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), darkSteel, this.spine, 0, 0.0, 0.145);
    // Gorget.
    mesh(lathe([[0.12, 0], [0.1, 0.06], [0.08, 0.1]], 16), darkSteel, this.chest, 0, 0.26, 0);

    // Great helm with visor slit, breaths and a cruciform brow.
    this.head = joint(this.chest, 0, 0.38, 0);
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
    mesh(helm, steel, this.head, 0, 0.02, 0);
    mesh(new THREE.BoxGeometry(0.17, 0.018, 0.04), dark, this.head, 0, 0.05, 0.115);
    mesh(new THREE.BoxGeometry(0.018, 0.12, 0.03), darkSteel, this.head, 0, 0.02, 0.125);
    mesh(new THREE.BoxGeometry(0.2, 0.018, 0.03), darkSteel, this.head, 0, 0.085, 0.117);
    for (let i = 0; i < 6; i++) {
      mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 4).rotateX(Math.PI / 2), dark, this.head, 0.03 + (i % 3) * 0.018, -0.03 - Math.floor(i / 3) * 0.022, 0.12);
    }
    // Small crest ridge.
    mesh(new THREE.BoxGeometry(0.012, 0.03, 0.22), darkSteel, this.head, 0, 0.19, 0);

    // Arms.
    const { blade, hilt } = sword();
    for (const side of [-1, 1]) {
      const shoulder = joint(this.chest, side * 0.25, 0.2, 0);
      mesh(pauldron(side).scale(0.82, 0.82, 0.82), steel, shoulder, side * 0.01, 0.04, 0);
      const upper = joint(shoulder, 0, 0, 0);
      upper.rotation.z = side * 0.12;
      mesh(lathe([[0.058, 0], [0.062, -0.12], [0.054, -0.26]], 12), steel, upper, 0, -0.02, 0);
      const fore = joint(upper, 0, -0.29, 0);
      // Couter (elbow cop) with a side wing.
      mesh(new THREE.SphereGeometry(0.06, 12, 8), darkSteel, fore, 0, 0, 0);
      mesh(new THREE.ConeGeometry(0.05, 0.03, 10).rotateZ(side * Math.PI / 2), steel, fore, side * 0.05, 0, 0);
      mesh(lathe([[0.05, 0], [0.056, -0.12], [0.045, -0.24]], 12), steel, fore, 0, -0.02, 0);
      // Gauntlet: flared cuff and a mailed fist.
      mesh(lathe([[0.045, 0], [0.07, -0.07]], 12), darkSteel, fore, 0, -0.22, 0);
      const hand = joint(fore, 0, -0.32, 0);
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
      this.arms.push({ upper, fore, side });
    }

    // Legs.
    for (const side of [-1, 1]) {
      const thigh = joint(this.hips, side * 0.115, -0.05, 0);
      mesh(lathe([[0.095, 0], [0.09, -0.2], [0.07, -0.4]], 14), steel, thigh, 0, -0.02, 0);
      const shin = joint(thigh, 0, -0.44, 0);
      // Poleyn (knee cop) with a fan plate.
      mesh(new THREE.SphereGeometry(0.065, 12, 8).scale(1, 1, 1.15), darkSteel, shin, 0, 0, 0.02);
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).scale(1, 1, 1), steel, shin, side * 0.06, 0, 0.01);
      mesh(lathe([[0.065, 0], [0.072, -0.14], [0.052, -0.38]], 14).scale(1, 1, 1.1), steel, shin, 0, -0.03, 0);
      const foot = joint(shin, 0, -0.44, 0);
      // Sabaton: overlapping lames tapering to the toe.
      for (let i = 0; i < 4; i++) {
        mesh(new THREE.BoxGeometry(0.1 - i * 0.008, 0.06 - i * 0.008, 0.07), i % 2 ? darkSteel : steel, foot, 0, -0.01 - i * 0.004, 0.01 + i * 0.05);
      }
      mesh(new THREE.BoxGeometry(0.1, 0.03, 0.26), leather, foot, 0, -0.035, 0.06);
      this.legs.push({ thigh, shin, foot, side });
    }

    // Cape: a cloth grid hanging from the shoulders, swept back by motion.
    const capeGeo = new THREE.PlaneGeometry(0.56, 1.1, 8, 14);
    capeGeo.translate(0, -0.55, 0);
    const p = capeGeo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      // Wrap around the shoulders at the top, flare toward the hem.
      const flare = 1 + (-y / 1.1) * 0.45;
      p.setX(i, x * flare);
      p.setZ(i, -Math.cos((x / 0.28) * 0.9) * 0.06 * (1 + y));
    }
    capeGeo.computeVertexNormals();
    this.capeRest = (capeGeo.getAttribute('position').array as Float32Array).slice();
    this.cape = mesh(capeGeo, cloth, this.chest, 0, 0.24, -0.15);
    (this.cape.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  }

  /** Advance the procedural animation. `speed` is ground speed in m/s. */
  update(dt: number, speed: number) {
    this.time += dt;
    const stride = 1.5;
    this.phase += (speed / stride) * Math.PI * 2 * dt;
    const target = THREE.MathUtils.clamp(speed / 4.2, 0, 1);
    this.walk += (target - this.walk) * (1 - Math.exp(-dt * 10));
    const w = this.walk;
    const ph = this.phase;
    const breathe = Math.sin(this.time * 1.8);

    this.hips.position.y = this.hipHeight - 0.035 * w * (0.5 + 0.5 * Math.cos(ph * 2)) - 0.015 * (1 - w);
    this.hips.rotation.y = Math.sin(ph) * 0.12 * w;
    this.hips.rotation.z = Math.cos(ph) * 0.04 * w;
    this.spine.rotation.x = 0.12 * w + 0.01 * breathe * (1 - w);
    this.spine.rotation.y = -Math.sin(ph) * 0.18 * w;
    this.chest.scale.setScalar(1 + 0.008 * breathe * (1 - w));
    this.head.rotation.y = Math.sin(ph) * 0.06 * w + Math.sin(this.time * 0.4) * 0.15 * (1 - w);
    this.head.rotation.x = -0.08 * w;

    for (const leg of this.legs) {
      const lp = ph + (leg.side === 1 ? Math.PI : 0);
      const swing = Math.sin(lp);
      const knee = Math.max(0, Math.cos(lp)) * 1.05 + 0.12;
      // Idle: slightly bent knees, weight shifted to one leg.
      const idleBend = leg.side === 1 ? 0.12 : 0.04;
      leg.thigh.rotation.x = -swing * 0.55 * w - idleBend * 0.5 * (1 - w);
      leg.shin.rotation.x = knee * w + idleBend * (1 - w);
      leg.foot.rotation.x = -(leg.thigh.rotation.x + leg.shin.rotation.x) * 0.7 + Math.max(0, -Math.cos(lp)) * 0.25 * w;
      leg.thigh.rotation.z = leg.side * 0.03;
    }
    for (const arm of this.arms) {
      const ap = ph + (arm.side === 1 ? 0 : Math.PI);
      const amount = arm.side === 1 ? 0.35 : 0.2; // shield arm swings less
      arm.upper.rotation.x = Math.sin(ap) * amount * w + 0.03 * breathe * (1 - w) - (arm.side === -1 ? 0.35 : 0.1);
      arm.fore.rotation.x = -(0.35 + Math.max(0, Math.sin(ap)) * 0.35 * w) - (arm.side === -1 ? 0.9 : 0.2);
    }

    // Cape: sweep back with speed, ripple along its length.
    const pos = this.cape.geometry.getAttribute('position');
    const rest = this.capeRest;
    for (let i = 0; i < pos.count; i++) {
      const x = rest[i * 3];
      const y = rest[i * 3 + 1];
      const z = rest[i * 3 + 2];
      const t = -y / 1.1; // 0 at the shoulders, 1 at the hem
      const lift = t * t * (0.55 * w + 0.06);
      const ripple = Math.sin(this.time * (3 + 5 * w) - t * 5 + x * 4) * 0.05 * t * (0.3 + w);
      pos.setXYZ(i, x, y + lift * 0.35, z - lift - ripple - t * 0.05);
    }
    pos.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();
  }
}
