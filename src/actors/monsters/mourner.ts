import * as THREE from 'three';
import { gridNormals } from '../cloth';
import { Character, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { flinch, keyedAction } from './humanoid';
import type { MonsterBody, MonsterMaterials } from './materials';

// Kneeling Mourner: one of the convent's dead, still at her vigil. A bowed
// figure in a long grey-black robe and a tall peaked hood with nothing but
// darkness inside it; pale bone fingers wrapped round a guttering candle
// whose small flame never goes out. They kneel in rows about the Abbess and
// rise out of the floor at her call, shambling forward to claw at the living.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A grid surface (PlaneGeometry layout) placed by `fn(u, v)`; u across, v down. */
function surface(cols: number, rows: number, fn: (u: number, v: number) => [number, number, number]) {
  const geo = new THREE.PlaneGeometry(1, 1, cols, rows);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) p.setXYZ(r * (cols + 1) + c, ...fn(c / cols, r / rows));
  geo.computeVertexNormals();
  return geo;
}

/** Smoothed lookup in sorted [x, y] pairs. */
function curve(pts: [number, number][], x: number) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t * t * (3 - 2 * t);
    }
  }
  return pts[pts.length - 1][1];
}

export function buildMourner(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  const s = scale * range(rng, 0.88, 0.95);
  const c = new Character({ scale: s, hunch: 0.28, stride: 1.05 });
  const robe = (m.robe as THREE.MeshStandardMaterial).clone();
  const tone = range(rng, 0.13, 0.17);
  robe.color.setRGB(tone, tone, tone * 1.08);
  robe.roughness = 0.92;
  robe.side = THREE.DoubleSide;
  const inner = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1, side: THREE.DoubleSide });
  const bone = (m.bone as THREE.MeshStandardMaterial).clone();
  bone.color.setRGB(0.42, 0.4, 0.35);
  const wax = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.55, emissive: new THREE.Color(0.25, 0.12, 0.03) });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.3, 0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 2.6, 1.4), fog: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.45, 0.1), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  // Torso under the robe.
  mesh(lathe([[0.0, -0.18], [0.16, -0.18], [0.19, 0.0], [0.2, 0.16], [0.15, 0.27], [0.06, 0.3]], 16).scale(1.05, 1, 0.82), robe, c.chest);
  mesh(lathe([[0.15, -0.12], [0.165, 0.12]], 14).scale(1, 1, 0.82), robe, c.spine, 0, 0.04, 0);
  // Rope girdle with its knotted end.
  mesh(new THREE.TorusGeometry(0.17, 0.012, 5, 20).rotateX(Math.PI / 2).scale(1, 1, 0.82), m.leather, c.spine, 0, -0.06, 0);
  const knot = joint(c.spine, 0.06, -0.07, 0.13);
  mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4).translate(0, -0.15, 0), m.leather, knot);
  mesh(new THREE.SphereGeometry(0.018, 6, 5), m.leather, knot, 0, -0.3, 0);

  // A tall peaked hood that falls as one cowl over the shoulders, with
  // only darkness in its mouth; the peak leans back.
  c.head.position.y = 0.34;
  const cowlR: [number, number][] = [[0, 0.0], [0.12, 0.05], [0.28, 0.12], [0.4, 0.15], [0.48, 0.165], [0.55, 0.23], [0.64, 0.3], [0.8, 0.33], [1, 0.36]];
  const gapAt: [number, number][] = [[0.28, 0], [0.38, 0.8], [0.48, 0.7], [0.55, 0.2], [0.6, 0.0], [0.85, 0.05], [1, 0.16]];
  const cowl = surface(28, 16, (u, v) => {
    const y = 0.8 - 1.02 * v;
    const gap = curve(gapAt, v);
    const th = gap + u * (Math.PI * 2 - gap * 2);
    const edge = Math.max(0, 1 - Math.min(u, 1 - u) * 10) * smooth(0.3, 0.4, v) * smooth(0.58, 0.5, v);
    const r = curve(cowlR, v) + 0.012 * Math.sin(th * 8 + v * 4) * smooth(0.6, 1, v);
    const zs = 1.1 - 0.28 * smooth(0.5, 0.75, v);
    const lean = -0.08 * (1 - smooth(0, 0.42, v));
    const rag = v > 0.95 ? (Math.sin(th * 13 + tone * 50) * 0.5 + 0.5) * 0.04 : 0;
    return [Math.sin(th) * r * 1.05, y - rag, Math.cos(th) * r * zs + lean + edge * 0.03 - 0.01];
  });
  mesh(cowl, robe, c.chest);
  mesh(new THREE.SphereGeometry(0.1, 12, 10).scale(0.85, 1.12, 0.6), inner, c.head, 0, 0.045, 0.07);
  mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 8), inner, c.chest, 0, 0.28, 0.02);

  // Sleeves and bone hands.
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    mesh(lathe([[0.06, 0.02], [0.07, -0.12], [0.08, -0.3]], 12), robe, a.upper);
    mesh(lathe([[0.07, 0.0], [0.085, -0.15], [0.105, -0.28]], 12), robe, a.fore);
    mesh(new THREE.BoxGeometry(0.05, 0.07, 0.022), bone, a.hand, 0, -0.02, 0.005);
    for (let i = 0; i < 4; i++) {
      const f = mesh(new THREE.CylinderGeometry(0.0045, 0.006, 0.09, 4).translate(0, -0.045, 0), bone, a.hand, (i - 1.5) * 0.013, -0.05, 0.012);
      f.rotation.x = side < 0 ? 1.1 : 0.7 + i * 0.08;
    }
    mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.05, 4).translate(0, -0.025, 0), bone, a.hand, -side * 0.028, -0.02, 0.02).rotation.z = -side * 0.8;
  }
  // The candle, in the left hand: wax stub with drips, a wick and its flame.
  const L = c.arm(-1);
  const R = c.arm(1);
  const candle = joint(L.hand, 0, -0.06, 0.035);
  candle.rotation.x = Math.PI / 2;
  const ch = range(rng, 0.12, 0.2);
  mesh(new THREE.CylinderGeometry(0.016, 0.018, ch, 8).translate(0, ch / 2 - 0.03, 0), wax, candle);
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.04 + rng() * 0.04, 4), wax, candle, Math.sin(a) * 0.017, ch - 0.06 - rng() * 0.04, Math.cos(a) * 0.017);
  }
  mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.015, 3), m.leather, candle, 0, ch - 0.022, 0);
  const flame = joint(candle, 0, ch - 0.015, 0);
  const tongue = mesh(new THREE.SphereGeometry(0.014, 8, 6).scale(1, 2.6, 1).translate(0, 0.03, 0), flameMat, flame);
  const heart = mesh(new THREE.SphereGeometry(0.006, 6, 4).scale(1, 1.8, 1).translate(0, 0.016, 0), coreMat, flame);
  const halo = mesh(new THREE.SphereGeometry(0.06, 16, 12), haloMat, flame, 0, 0.03, 0);
  for (const f of [tongue, heart, halo]) {
    f.castShadow = false;
    f.userData.dynamic = true;
  }
  L.restUpper = -0.45;
  L.restFore = -1.35;
  L.swing = 0.05;
  L.upper.rotation.z = 0.1;
  R.restUpper = -0.25;
  R.restFore = -0.7;
  R.swing = 0.25;

  // Feet: dark stubs that show at the hem as it walks.
  for (const side of [-1, 1]) mesh(new THREE.BoxGeometry(0.07, 0.05, 0.18), inner, c.leg(side).foot, 0, -0.03, 0.04);

  bakeRig(c.root);

  // The robe skirt: from the hips to the floor, pooling when it kneels.
  const cols = 22;
  const rows = 9;
  const geo = new THREE.PlaneGeometry(1, 1, cols, rows);
  const sk = new THREE.Mesh(geo, robe);
  sk.castShadow = true;
  sk.receiveShadow = true;
  sk.frustumCulled = false;
  sk.userData.dynamic = true;
  c.body.add(sk);
  const jag = Array.from({ length: cols + 1 }, () => rng());
  jag[cols] = jag[0];
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  let flameOn = 1;
  let sinking = 0;
  const seed = rng() * 10;
  c.hooks.push((_dt, w, time) => {
    const hips = c.hips;
    const floor = -c.body.position.y / s + 0.02;
    const top = hips.position.y + 0.05;
    const len = 1.02;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      for (let col = 0; col <= cols; col++) {
        const th = Math.PI + (col / cols) * Math.PI * 2;
        let y = top - t * len;
        let rad = 0.17 + 0.17 * t + 0.02 * Math.sin(th * 6 + seed) * t + jag[col] * 0.02 * t;
        if (y < floor) {
          // The cloth that would go under the floor spreads over it instead.
          rad += (floor - y) * 0.8;
          y = floor + (jag[col] * 0.01);
        }
        v.set(Math.sin(th) * rad, 0, Math.cos(th) * rad * 0.85);
        v.applyAxisAngle(new THREE.Vector3(0, 1, 0), hips.rotation.y * (1 - t));
        const trail = -w * 0.12 * t * t + Math.sin(time * 1.4 + th * 2) * 0.01 * t;
        pos.setXYZ(r * (cols + 1) + col, v.x, y - (r === rows ? jag[col] * 0.04 * (1 - sinking) : 0), v.z + trail);
      }
    }
    pos.needsUpdate = true;
    gridNormals(geo, cols, rows);
    // The flame gutters and leans.
    const fl = flameOn * (0.85 + Math.sin(time * 17 + seed) * 0.08 + Math.sin(time * 31 + seed * 2) * 0.06);
    tongue.scale.set(fl, fl * (1 + Math.sin(time * 23 + seed) * 0.15), fl);
    heart.scale.setScalar(Math.max(0.001, fl));
    halo.scale.setScalar(Math.max(0.001, fl * (0.9 + Math.sin(time * 13) * 0.1)));
    flame.rotation.x = -Math.PI / 2 - c.arm(-1).upper.rotation.x * 0.3 - c.spine.rotation.x - w * 0.4;
    flame.rotation.z = Math.sin(time * 3 + seed) * 0.15;
  });

  /** Kneeling: hips down, shins flat on the floor, bowed over the candle. */
  const kneel = (f: number) => {
    c.hips.position.y -= 0.5 * f;
    for (const l of c.legs) {
      l.thigh.rotation.x = l.thigh.rotation.x * (1 - f) - 0.15 * f;
      l.shin.rotation.x = l.shin.rotation.x * (1 - f) + 1.65 * f;
      l.foot.rotation.x = l.foot.rotation.x * (1 - f) + 0.9 * f;
    }
    c.spine.rotation.x += 0.35 * f;
    c.head.rotation.x += 0.45 * f;
    L.upper.rotation.x = L.upper.rotation.x * (1 - f) - 0.55 * f;
    L.fore.rotation.x = L.fore.rotation.x * (1 - f) - 1.25 * f;
    R.upper.rotation.x = R.upper.rotation.x * (1 - f) - 0.5 * f;
    R.fore.rotation.x = R.fore.rotation.x * (1 - f) - 1.3 * f;
    R.upper.rotation.z = R.upper.rotation.z * (1 - f) - 0.25 * f;
  };

  return {
    rig: c,
    attack(onHit) {
      // The free hand drawn up, then raked down across the hero.
      keyedAction(
        c,
        0.9,
        [
          { k: 0, uR: -0.25, fR: -0.7, s: 0, t: 0 },
          { k: 0.45, uR: -2.4, fR: -0.6, s: -0.15, t: 0.35 },
          { k: 0.62, uR: -0.6, fR: -0.2, s: 0.35, t: -0.3 },
          { k: 1, uR: -0.25, fR: -0.7, s: 0, t: 0 },
        ],
        0.58,
        onHit,
        (k, wt) => (c.head.rotation.x += Math.sin(k * Math.PI) * 0.2 * wt),
      );
    },
    flinch: () => flinch(c, 0.3),
    die() {
      // Down onto its knees, slumping forward; the candle gutters out and it sinks into the floor.
      c.play(2.6, (k) => {
        const f = smooth(0, 0.3, k);
        const slump = smooth(0.25, 0.55, k);
        kneel(f);
        c.spine.rotation.x += 0.5 * slump;
        c.head.rotation.x += 0.4 * slump;
        L.upper.rotation.x += 0.4 * slump;
        R.upper.rotation.x += 0.5 * slump;
        flameOn = 1 - smooth(0.2, 0.45, k);
        sinking = smooth(0.45, 1, k);
        c.body.position.y = -0.55 * s * sinking;
      });
    },
    emerge(dur) {
      // Rising out of the floor still kneeling, then standing up to its full height.
      c.play(dur, (k) => {
        const up = smooth(0, 0.6, k);
        const stand = smooth(0.55, 1, k);
        c.body.position.y = -1.0 * s * (1 - up);
        kneel(1 - stand);
        flameOn = smooth(0.1, 0.5, k);
      }, () => {
        c.body.position.y = 0;
      });
    },
    muzzle() {
      const p = new THREE.Vector3();
      R.hand.getWorldPosition(p);
      return p;
    },
  };
}
