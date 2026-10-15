import * as THREE from 'three';
import { Character, clothPanel, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { band, bump, sculptSphere } from '../sculpt';
import { flinch, keyedAction } from './humanoid';
import type { MonsterBody, MonsterMaterials } from './materials';

// Ossuary Priest: a skeleton still saying the rites. A bare skull with red
// points burning deep in its sockets, a loose jaw, the ribcage showing
// through vestments of crimson and black that have rotted to rags at the
// hem; a gold-trimmed stole, a tall pointed mitre, wide bell sleeves over
// bony hands, and a staff crowned with a spiked sun disc holding a red orb.
// The dressing is shared with the Grand Inquisitor, who wears a grander
// version of it (taller mitre, spiked collar, censers, heavier staff).

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface BonePriestDressing {
  /** The staff head joint; the orb sits at its origin. */
  orb: THREE.Object3D;
  /** The staff's grip joint (in the right hand). */
  staff: THREE.Object3D;
  /** The open left hand that casts. */
  castHand: THREE.Object3D;
  /** The lower jaw joint (rotation.x opens it). */
  jaw: THREE.Object3D;
  /** Brightness of the orb and eyes; 1 is the resting glow. */
  setGlow(g: number): void;
  /** 0 standing .. 1 a heap of bones and cloth on the floor (robes pool and spread). */
  setCollapse(h: number): void;
  /** Spreads (1) or relaxes (0) the casting hand's fingers. */
  setSpread(s: number): void;
  /** How strongly the staff is held plumb in the world (1, the default) rather than following the hand (0). */
  setStaffUpright(w: number): void;
  /** Forward lean of the held staff, radians (about 0.06 at rest). */
  setStaffLean(a: number): void;
}

/** Flat strip through `pts`, facing `out(i)`; for stoles, lappets and trim. */
function ribbon(pts: THREE.Vector3[], width: number, out: (i: number) => THREE.Vector3, widthAt?: (t: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const curve = new THREE.CatmullRomCurve3(pts);
  const n = Math.max(2, pts.length * 3);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const o = out(Math.min(pts.length - 1, Math.round(t * (pts.length - 1))));
    const side = new THREE.Vector3().crossVectors(tan, o).normalize().multiplyScalar((width * (widthAt?.(t) ?? 1)) / 2);
    const a = p.clone().add(side);
    const b = p.clone().sub(side);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(0, t, 1, t);
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Iron or gold chain laid along `pts`. */
function chain(parent: THREE.Object3D, pts: THREE.Vector3[], mat: THREE.Material, r = 0.011) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const n = Math.max(2, Math.floor(curve.getLength() / (r * 2.1)));
  const link = new THREE.TorusGeometry(r, r * 0.3, 4, 8).scale(0.75, 1.35, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n);
    const l = mesh(link, mat, parent, p.x, p.y, p.z);
    l.quaternion.setFromUnitVectors(up, curve.getTangentAt(i / n));
    if (i % 2) l.rotateY(Math.PI / 2);
  }
}

interface Skirt {
  update(w: number, time: number, heap: number): void;
}

/**
 * A long robe skirt hanging from `parent` (the hips), deformed every frame:
 * the hem trails back with speed and ripples, and wherever it would pass
 * below the floor it pools and spreads out instead, so the robe settles on
 * the ground when the body bobs or collapses. The hem is torn into tatters.
 * `color(t, phi)` paints vertex colours (trim) when given.
 */
function skirt(
  parent: THREE.Object3D,
  floorY: () => number,
  mat: THREE.Material,
  profile: [number, number][],
  rng: Rng,
  opts: { phiStart?: number; phiLength?: number; seg?: number; tatter?: number; color?: (t: number, phi: number) => THREE.Color; sx?: number; sz?: number },
): Skirt {
  const seg = opts.seg ?? 32;
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(18);
  const phiStart = opts.phiStart ?? 0;
  const phiLength = opts.phiLength ?? Math.PI * 2;
  const geo = new THREE.LatheGeometry(pts, seg, phiStart, phiLength);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const top = profile[0][1];
  const len = top - profile[profile.length - 1][1];
  const jag: number[] = [];
  for (let i = 0; i <= seg; i++) jag.push((i % 2 ? range(rng, 0.5, 1) : range(rng, 0, 0.25)) * (opts.tatter ?? 0.1));
  const sx = opts.sx ?? 1;
  const sz = opts.sz ?? 1;
  const rest = new Float32Array(p.count * 4); // radius, y, phi, t
  const col = opts.color ? new Float32Array(p.count * 3) : null;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    let y = p.getY(i);
    const phi = Math.atan2(x, z);
    const t = (top - y) / len;
    const column = Math.round(((((phi - phiStart) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / phiLength * seg);
    y += (jag[Math.min(seg, Math.max(0, column))] ?? 0) * smooth(0.82, 1, t);
    rest.set([Math.hypot(x, z), y, phi, t], i * 4);
    if (col) {
      const c = opts.color!(t, phi);
      col.set([c.r, c.g, c.b], i * 3);
    }
  }
  if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = mesh(geo, mat, parent);
  m.userData.dynamic = true;
  m.frustumCulled = false;
  const seed = range(rng, 0, 10);
  return {
    update(w, time, heap) {
      const floor = floorY() + 0.012;
      for (let i = 0; i < p.count; i++) {
        let r = rest[i * 4];
        let y = rest[i * 4 + 1];
        const phi = rest[i * 4 + 2];
        const t = rest[i * 4 + 3];
        const billow = Math.sin(time * 1.3 + phi * 2 + seed) * 0.012 * t + Math.sin(time * (2.2 + 3 * w) - t * 5 + phi * 3) * 0.016 * t * (0.3 + w);
        r += billow + heap * 0.12 * t;
        y = top - (top - y) * (1 - 0.5 * heap * t);
        let x = Math.sin(phi) * r * sx;
        let z = Math.cos(phi) * r * sz - t * t * (0.22 * w + 0.02);
        if (y < floor) {
          // Pools on the floor: the excess length spreads outward.
          const extra = floor - y;
          y = floor + extra * 0.02;
          const k = 1 + (extra * 0.9) / Math.max(0.05, Math.hypot(x, z));
          x *= k;
          z *= k;
        }
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

/** Skeletal hand: carpals, metacarpals and three jointed bones per finger. */
function boneHand(parent: THREE.Object3D, side: number, bone: THREE.Material, curl: number): THREE.Object3D[][] {
  mesh(new THREE.SphereGeometry(0.02, 8, 6).scale(1.2, 0.8, 0.7), bone, parent, 0, -0.012, 0);
  const fingers: THREE.Object3D[][] = [];
  const phal = [0.032, 0.024, 0.018];
  const cyl = new THREE.CylinderGeometry(0.0048, 0.0042, 1, 5).translate(0, -0.5, 0);
  const knuckle = new THREE.SphereGeometry(0.0062, 6, 4);
  for (let f = 0; f < 5; f++) {
    const thumb = f === 4;
    // Fingers fan along Z (the palm faces inward, toward -side X).
    const fz = thumb ? 0.024 : (f - 1.5) * 0.011;
    const base = joint(parent, thumb ? -side * 0.01 : 0, -0.02, fz * 0.5);
    const mlen = thumb ? 0.026 : 0.045 - Math.abs(f - 1.2) * 0.004;
    base.rotation.x = thumb ? 0.7 : fz * 3;
    base.rotation.z = thumb ? -side * 0.5 : 0;
    const mc = mesh(cyl, bone, base);
    mc.scale.set(1, mlen, 1);
    let j = joint(base, 0, -mlen, 0);
    mesh(knuckle, bone, j);
    const segs: THREE.Object3D[] = [];
    const n = thumb ? 2 : 3;
    for (let s = 0; s < n; s++) {
      const L = phal[s] * (thumb ? 1.1 : f === 3 ? 0.8 : 1);
      j.rotation.z = -side * curl * (s === 0 ? 0.8 : 1);
      const seg = mesh(cyl, bone, j);
      seg.scale.set(1 - s * 0.15, L, 1 - s * 0.15);
      segs.push(j);
      const next = joint(j, 0, -L, 0);
      if (s < n - 1) mesh(knuckle, bone, next).scale.setScalar(0.85 - s * 0.15);
      j = next;
    }
    // Pointed fingertip.
    mesh(new THREE.ConeGeometry(0.0035, 0.008, 4).rotateX(Math.PI), bone, j, 0, -0.003, 0);
    fingers.push(segs);
  }
  return fingers;
}

/**
 * Hangs the Ossuary Priest's skeleton and vestments on `c`. With `boss` the
 * vestments are grander: a taller, jewelled mitre, a high spiked collar, a
 * heavier staff with a double sun, censers swinging on chains, more gold.
 */
export function dressBonePriest(c: Character, m: MonsterMaterials, rng: Rng, opts: { boss?: boolean } = {}): BonePriestDressing {
  const boss = !!opts.boss;
  const crimson = (m.robe as THREE.MeshStandardMaterial).clone();
  crimson.color.setRGB(0.42, 0.035, 0.03);
  crimson.side = THREE.DoubleSide;
  // The skirts carry their trim as vertex colours over a white base.
  const robeVC = (m.robe as THREE.MeshStandardMaterial).clone();
  robeVC.color.setRGB(1, 1, 1);
  robeVC.side = THREE.DoubleSide;
  robeVC.vertexColors = true;
  const black = new THREE.MeshStandardMaterial({ color: 0x0c0707, roughness: 0.95, side: THREE.DoubleSide });
  const gold = new THREE.MeshStandardMaterial({ color: 0xb08a3c, metalness: 1, roughness: 0.32 });
  const goldFlat = gold.clone();
  goldFlat.side = THREE.DoubleSide;
  const bone = (m.bone as THREE.MeshStandardMaterial).clone();
  bone.color.setHex(0xb3a385);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.1), fog: false });
  const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.35, 0.12), fog: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.05, 0.02), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const CRIMSON = new THREE.Color(0.42, 0.035, 0.03);
  const GOLD = new THREE.Color(0.95, 0.62, 0.2);
  const BLACK = new THREE.Color(0.05, 0.03, 0.03);

  // --- Skull --------------------------------------------------------------
  c.head.position.set(0, 0.35, 0.02);
  const sk = new THREE.Vector3(0.84, 0.97, 1.0);
  const R = 0.096;
  const skull = sculptSphere(
    R,
    (x, y, z) => {
      const front = smooth(0.15, 0.7, z);
      let d = 0;
      for (const s of [-1, 1]) {
        d -= 0.3 * bump(x, y, s * 0.36, 0.0, 0.17, 0.15) * front; // eye sockets
        d += 0.13 * bump(x, y, s * 0.6, -0.2, 0.16, 0.09) * front; // cheekbones
        d += 0.06 * bump(x, y, s * 0.85, -0.18, 0.1, 0.06); // zygomatic arches
        d -= 0.1 * bump(x, y, s * 0.88, 0.0, 0.2, 0.25); // temples
        d -= 0.12 * bump(x, y, s * 0.55, -0.55, 0.2, 0.2) * front; // hollow cheeks
      }
      d += 0.07 * bump(x, y, 0, 0.17, 0.75, 0.07) * front; // brow ridge
      d -= 0.28 * bump(x, y, 0, -0.27, 0.08, 0.11) * front; // nasal cavity
      d -= 0.3 * smooth(-0.4, -0.85, y) * (1 - 0.4 * front); // narrow upper jaw
      d += 0.06 * bump(x, y, 0, 0.1, 0.8, 0.5) * smooth(0, -0.6, z); // occiput
      return d;
    },
    sk,
    40,
    30,
  );
  const skullY = 0.06;
  mesh(skull, bone, c.head, 0, skullY, 0);
  const sockets = new THREE.SphereGeometry(0.019, 10, 8);
  const eyes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    mesh(sockets, m.void, c.head, s * 0.03, skullY + 0.001, 0.07);
    eyes.push(mesh(new THREE.SphereGeometry(0.0048, 8, 6), eyeMat, c.head, s * 0.03, skullY + 0.001, 0.086));
  }
  for (const s of [-1, 1]) {
    // Nose: a pointed hole in two halves either side of a thin septum.
    const n = mesh(new THREE.ConeGeometry(0.0065, 0.024, 3).scale(1, 1, 0.5), m.void, c.head, s * 0.0055, skullY - 0.024, 0.083);
    n.rotation.z = s * 0.25;
  }
  // Upper teeth along the front of the maxilla.
  const tooth = new THREE.BoxGeometry(0.008, 0.013, 0.007);
  for (let i = 0; i < 8; i++) {
    const a = ((i - 3.5) / 3.5) * 0.85;
    const t = mesh(tooth, bone, c.head, Math.sin(a) * 0.034, skullY - 0.055, 0.052 + Math.cos(a) * 0.022);
    t.rotation.y = a;
  }
  // Lower jaw on its own hinge.
  const jaw = joint(c.head, 0, skullY - 0.035, 0.0);
  {
    const pts = [
      new THREE.Vector3(-0.05, 0.012, 0.0),
      new THREE.Vector3(-0.048, -0.025, 0.012),
      new THREE.Vector3(-0.036, -0.04, 0.05),
      new THREE.Vector3(0, -0.046, 0.078),
      new THREE.Vector3(0.036, -0.04, 0.05),
      new THREE.Vector3(0.048, -0.025, 0.012),
      new THREE.Vector3(0.05, 0.012, 0.0),
    ];
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0085, 6), bone, jaw);
    mesh(new THREE.SphereGeometry(0.012, 8, 6).scale(1.2, 0.9, 0.8), bone, jaw, 0, -0.044, 0.074); // chin
    for (let i = 0; i < 8; i++) {
      const a = ((i - 3.5) / 3.5) * 0.85;
      const t = mesh(tooth, bone, jaw, Math.sin(a) * 0.031, -0.026, 0.048 + Math.cos(a) * 0.02);
      t.rotation.y = a;
    }
  }
  // Neck: a column of vertebrae.
  for (let i = 0; i < 4; i++) {
    mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.022, 8), bone, c.head, 0, -0.02 - i * 0.032, -0.01);
    mesh(new THREE.BoxGeometry(0.05, 0.008, 0.012), bone, c.head, 0, -0.02 - i * 0.032, -0.022);
  }

  // --- Mitre ----------------------------------------------------------------
  // Pointed front and back panels over a lens-shaped crown, banded in gold.
  const H = boss ? 0.46 : 0.34;
  const W = 0.1;
  const D = 0.112;
  const mitreY = skullY + 0.045;
  const mw = (u: number) => W * Math.pow(Math.max(0, 1 - u), 0.6) * (1 + 1.0 * u);
  const md = (u: number) => D * (1 - 0.82 * u);
  {
    const nx = 32;
    const ny = 14;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= ny; j++) {
      const u = j / ny;
      for (let i = 0; i <= nx; i++) {
        const th = (i / nx) * Math.PI * 2;
        // Front and back panels part near the top into two peaks.
        const cz = Math.cos(th);
        pos.push(Math.sin(th) * mw(u), u * H - 0.03 * smooth(0.55, 1, u) * (1 - Math.abs(cz)), cz * md(u) + Math.sign(cz) * 0.022 * smooth(0.5, 1, u));
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    mesh(g, crimson, c.head, 0, mitreY, -0.008);
  }
  // Gold: the band round the brow, the side seams up to the point, the
  // orphrey down the middle of the front and back, and an emblem.
  mesh(band(1, 0.034, 0.08, 32).scale(W * 0.97, 1, D * 0.97), gold, c.head, 0, mitreY + 0.018, -0.008);
  if (boss) mesh(band(1, 0.018, 0.08, 32).scale(mw(0.36) * 0.97, 1, md(0.36) * 0.97), gold, c.head, 0, mitreY + H * 0.36, -0.008);
  for (const s of [-1, 1]) {
    const seam: THREE.Vector3[] = [];
    for (let j = 0; j <= 10; j++) {
      const u = (j / 10) * 0.995;
      seam.push(new THREE.Vector3(s * mw(u), mitreY + u * H, -0.008));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam), 24, boss ? 0.007 : 0.005, 5), gold, c.head);
  }
  for (const fz of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    for (let j = 0; j <= 8; j++) {
      const u = 0.04 + (j / 8) * 0.9;
      pts.push(new THREE.Vector3(0, mitreY + u * H, -0.008 + fz * (md(u) + 0.022 * smooth(0.5, 1, u) + 0.003)));
    }
    mesh(ribbon(pts, 0.024, () => new THREE.Vector3(0, 0.3, fz).normalize(), (t) => 1 - 0.5 * t), goldFlat, c.head);
    for (const e of [-1, 1]) mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p, i) => p.clone().add(new THREE.Vector3(e * 0.012 * (1 - 0.5 * (i / 8)), 0, fz * 0.002)))), 16, 0.0035, 4), gold, c.head);
  }
  // Emblem: a sun with a red stone on the front panel.
  {
    const u = 0.42;
    const ez = -0.008 + md(u) + 0.022 * smooth(0.5, 1, u) + 0.006;
    const ey = mitreY + u * H;
    const em = joint(c.head, 0, ey, ez);
    em.rotation.x = -Math.atan2(D * 0.82, H) * 0.9;
    mesh(new THREE.TorusGeometry(boss ? 0.026 : 0.02, 0.004, 4, 16), gold, em);
    const rays = boss ? 12 : 8;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const rr = boss ? 0.026 : 0.02;
      const ray = mesh(new THREE.ConeGeometry(0.004, i % 2 ? 0.014 : 0.022, 4).translate(0, 0.008, 0), gold, em, Math.sin(a) * rr, Math.cos(a) * rr, 0);
      ray.rotation.z = -a;
    }
    mesh(new THREE.SphereGeometry(boss ? 0.012 : 0.009, 8, 6).scale(1, 1, 0.6), eyeMat, em, 0, 0, 0.002);
  }
  if (boss) {
    // Studs of gold up the seams and a crest of small spikes at the point.
    for (const s of [-1, 1]) {
      for (let j = 1; j < 8; j++) {
        const u = j / 8.5;
        mesh(new THREE.SphereGeometry(0.0085, 6, 5), j % 2 ? gold : eyeMat, c.head, s * (mw(u) + 0.004), mitreY + u * H, -0.008);
      }
    }
    for (let i = 0; i < 7; i++) {
      const a = ((i - 3) / 3) * 1.1;
      const sp = mesh(new THREE.ConeGeometry(0.006, 0.045 - Math.abs(i - 3) * 0.008, 5).translate(0, 0.02, 0), gold, c.head, Math.sin(a) * 0.012, mitreY + H * 0.97, -0.008 + Math.cos(a) * 0.012);
      sp.rotation.set(Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45);
    }
    mesh(new THREE.SphereGeometry(0.014, 8, 6), gold, c.head, 0, mitreY + H + 0.005, -0.008);
  }
  // Lappets: two gold-fringed tails hanging from the back of the mitre.
  for (const s of [-1, 1]) {
    const len = boss ? 0.3 : 0.24;
    const pts = [new THREE.Vector3(s * 0.045, mitreY + 0.01, -0.1), new THREE.Vector3(s * 0.055, mitreY - 0.1, -0.12), new THREE.Vector3(s * 0.065, mitreY - len, -0.14)];
    mesh(ribbon(pts, 0.045, () => new THREE.Vector3(0, 0, -1)), crimson, c.head);
    mesh(new THREE.BoxGeometry(0.05, 0.018, 0.006), gold, c.head, s * 0.065, mitreY - len - 0.005, -0.142);
  }

  // --- Torso --------------------------------------------------------------
  // Ribcage and spine, glimpsed where the vestments part down the front.
  mesh(lathe([[0.1, -0.2], [0.14, -0.08], [0.15, 0.08], [0.13, 0.22], [0.06, 0.3]], 14).scale(1, 1, 0.75), black, c.chest, 0, 0, -0.01);
  for (let i = 0; i < 9; i++) mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.026, 7), bone, c.chest, 0, -0.18 + i * 0.05, -0.085);
  for (let r = 0; r < 7; r++) {
    const y = 0.21 - r * 0.052;
    const rx = 0.115 + Math.sin(((r + 1) / 8) * Math.PI) * 0.045;
    const rz = 0.105 + Math.sin(((r + 1) / 8) * Math.PI) * 0.02;
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      const end = r < 5 ? 0.2 : 0.55; // the floating ribs stop short of the sternum
      for (let k = 0; k <= 7; k++) {
        const th = Math.PI - 0.25 - (k / 7) * (Math.PI - 0.25 - end);
        const droop = -0.05 * (1 - th / Math.PI);
        pts.push(new THREE.Vector3(s * Math.sin(th) * rx, y + droop, Math.cos(th) * rz - 0.02));
      }
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.0085 - r * 0.0004, 4), bone, c.chest);
    }
  }
  mesh(new THREE.CylinderGeometry(0.014, 0.008, 0.2, 6).scale(1, 1, 0.45), bone, c.chest, 0, 0.12, 0.09); // sternum
  mesh(new THREE.CylinderGeometry(0.022, 0.016, 0.04, 6).scale(1, 1, 0.45), bone, c.chest, 0, 0.235, 0.087);
  for (const s of [-1, 1]) {
    // Collarbones.
    const cl = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.17, 5).rotateZ(Math.PI / 2), bone, c.chest, s * 0.1, 0.27, 0.05);
    cl.rotation.y = s * 0.35;
  }

  // Vestment over the chest: crimson, parted down the front over the ribs.
  const gap = 0.62;
  mesh(new THREE.LatheGeometry([[0.165, -0.21], [0.19, -0.08], [0.205, 0.08], [0.2, 0.2], [0.15, 0.29], [0.08, 0.33]].map(([x, y]) => new THREE.Vector2(x, y)), 24, gap, Math.PI * 2 - gap * 2).scale(1.12, 1, 0.82), crimson, c.chest);
  mesh(new THREE.LatheGeometry([[0.15, -0.2], [0.16, 0.12]].map(([x, y]) => new THREE.Vector2(x, y)), 20, 0.35, Math.PI * 2 - 0.7).scale(1.08, 1, 0.82), crimson, c.spine, 0, 0.04, 0);
  // The stole: a band of crimson edged in gold, round the back of the neck
  // and down each side of the parting.
  const stoleOut = () => new THREE.Vector3(0, 0.1, 1).normalize();
  for (const s of [-1, 1]) {
    const pts = [
      new THREE.Vector3(s * 0.06, 0.34, -0.03),
      new THREE.Vector3(s * 0.085, 0.3, 0.075),
      new THREE.Vector3(s * 0.1, 0.18, 0.15),
      new THREE.Vector3(s * 0.105, 0.05, 0.165),
      new THREE.Vector3(s * 0.1, -0.08, 0.16),
      new THREE.Vector3(s * 0.095, -0.2, 0.15),
    ];
    mesh(ribbon(pts, 0.06, stoleOut), black, c.chest);
    for (const e of [-1, 1]) {
      const edge = pts.map((p) => p.clone().add(new THREE.Vector3(e * 0.027, 0, 0.003)));
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 20, 0.0045, 4), gold, c.chest);
    }
    // Small gold crosses embroidered on the stole.
    for (const y of [0.1, -0.1]) {
      const z = 0.168 - Math.abs(y) * 0.06;
      mesh(new THREE.BoxGeometry(0.01, 0.04, 0.004), gold, c.chest, s * 0.102, y, z);
      mesh(new THREE.BoxGeometry(0.03, 0.01, 0.004), gold, c.chest, s * 0.102, y + 0.008, z);
    }
  }
  // Mozzetta: a short cape over the shoulders, gold at its torn hem.
  {
    const prof: [number, number][] = [[0.09, 0.36], [0.17, 0.32], [0.26, 0.24], [0.31, 0.12], [0.32, 0.05]];
    const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 36, 0.42, Math.PI * 2 - 0.84);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0.06) {
        const a = Math.atan2(p.getX(i), p.getZ(i));
        p.setY(i, y + 0.035 * Math.abs(Math.sin(a * 6)) + 0.015 * Math.abs(Math.sin(a * 17)));
      }
    }
    g.scale(1.12, 1, 0.86);
    g.computeVertexNormals();
    mesh(g, crimson, c.chest);
    const hem: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) {
      const a = 0.42 + (i / 30) * (Math.PI * 2 - 0.84);
      hem.push(new THREE.Vector3(Math.sin(a) * 0.3 * 1.12, 0.14, Math.cos(a) * 0.3 * 0.86));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hem), 60, boss ? 0.009 : 0.006, 4), gold, c.chest);
  }
  // Collar standing up behind the skull; the Inquisitor's is high and spiked.
  {
    const ch = boss ? 0.24 : 0.11;
    const g = new THREE.LatheGeometry([new THREE.Vector2(0.1, 0), new THREE.Vector2(0.12, ch * 0.5), new THREE.Vector2(0.16, ch)], 20, Math.PI * 0.55, Math.PI * 0.9);
    g.scale(1.1, 1, 0.9);
    mesh(g, crimson, c.chest, 0, 0.32, -0.01);
    const rim: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * 0.55 + (i / 16) * Math.PI * 0.9;
      rim.push(new THREE.Vector3(Math.sin(a) * 0.16 * 1.1, 0.32 + ch, Math.cos(a) * 0.16 * 0.9 - 0.01));
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim), 32, 0.006, 4), gold, c.chest);
    if (boss) {
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 0.6 + (i / 8) * Math.PI * 0.8;
        const len = 0.1 + 0.08 * Math.sin((i / 8) * Math.PI);
        const sp = mesh(new THREE.ConeGeometry(0.011, len, 5).translate(0, len / 2, 0), gold, c.chest, Math.sin(a) * 0.17, 0.32 + ch - 0.01, Math.cos(a) * 0.15 - 0.01);
        sp.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
      }
    }
  }
  // Long cape down the back.
  clothPanel(c, c.chest, crimson, 0.48, 1.32, new THREE.Vector3(0, 0.27, -0.16), { flare: 0.55, sweep: 0.35, wrap: 0.1 });

  // --- Skirts ---------------------------------------------------------------
  const floorY = () => -c.hips.position.y;
  const under = skirt(c.hips, floorY, black, [[0.17, 0.1], [0.2, -0.1], [0.26, -0.5], [0.33, -0.9], [0.36, -1.02]], rng, { seg: 28, tatter: 0.06, sz: 0.85 });
  const trimW = boss ? 0.05 : 0.025;
  const over = skirt(
    c.hips,
    floorY,
    robeVC,
    [[0.19, 0.12], [0.22, -0.1], [0.28, -0.5], [0.35, -0.88], [0.39, -1.0]],
    rng,
    {
      seg: 36,
      tatter: 0.16,
      phiStart: 0.42,
      phiLength: Math.PI * 2 - 0.84,
      sz: 0.86,
      color: (t, phi) => {
        // Gold bands above the tatters and up the front edges; blackened rot at the hem.
        const edge = Math.min(Math.abs(phi - 0.42), Math.abs(phi + 0.42));
        if (edge < (boss ? 0.12 : 0.07) && t < 0.86) return GOLD;
        if (Math.abs(t - 0.78) < trimW) return GOLD;
        if (boss && Math.abs(t - 0.7) < 0.015) return GOLD;
        if (t > 0.86) return CRIMSON.clone().lerp(BLACK, smooth(0.86, 1, t));
        return CRIMSON;
      },
    },
  );
  // Sash at the waist, and the stole's ends hanging from it.
  mesh(band(0.172, 0.06, 0.016, 28).scale(1.08, 1, 0.85), black, c.spine, 0, -0.06, 0);
  mesh(band(0.19, 0.008, 0.006, 28).scale(1.08, 1, 0.85), gold, c.spine, 0, -0.03, 0);
  mesh(band(0.19, 0.008, 0.006, 28).scale(1.08, 1, 0.85), gold, c.spine, 0, -0.09, 0);
  const stoleJ = joint(c.hips, 0, 0.0, 0.19);
  for (const s of [-1, 1]) {
    const len = boss ? 0.72 : 0.62;
    const pts = [new THREE.Vector3(s * 0.08, 0, 0), new THREE.Vector3(s * 0.085, -len * 0.5, 0.02), new THREE.Vector3(s * 0.09, -len, 0.04)];
    mesh(ribbon(pts, 0.065, () => new THREE.Vector3(0, 0, 1), (t) => 1 + 0.25 * t), black, stoleJ);
    for (const e of [-1, 1]) {
      const edge = pts.map((p, i) => p.clone().add(new THREE.Vector3(e * (0.03 + i * 0.004), 0, 0.003)));
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge), 16, 0.0045, 4), gold, stoleJ);
    }
    // A gold sun embroidered at the end, and a fringe.
    const ey = -len + 0.08;
    mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 14), gold, stoleJ, s * 0.09, ey, 0.04);
    mesh(new THREE.BoxGeometry(0.006, 0.05, 0.004), gold, stoleJ, s * 0.09, ey, 0.04);
    mesh(new THREE.BoxGeometry(0.05, 0.006, 0.004), gold, stoleJ, s * 0.09, ey, 0.04);
    for (let f = 0; f < 7; f++) mesh(new THREE.BoxGeometry(0.004, 0.04, 0.003), gold, stoleJ, s * 0.09 + (f - 3) * 0.011, -len - 0.02, 0.043);
  }
  // Things hanging from the sash on swinging cords: bone talismans and a
  // small skull; the Inquisitor swings censers on chains.
  const danglers: { j: THREE.Object3D; phase: number; side: number }[] = [];
  const hangAt = (a: number, y = -0.08) => {
    const j = joint(c.spine, Math.sin(a) * 0.185, y, Math.cos(a) * 0.16);
    danglers.push({ j, phase: range(rng, 0, 6), side: Math.sign(Math.sin(a)) || 1 });
    return j;
  };
  for (const a of [0.85, -0.95]) {
    const j = hangAt(a);
    mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.14, 3).translate(0, -0.07, 0), m.leather, j);
    mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.07, 5), bone, j, 0, -0.17, 0); // a finger bone
    mesh(new THREE.SphereGeometry(0.012, 6, 5), bone, j, 0, -0.205, 0);
  }
  {
    const j = hangAt(1.35);
    mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 3).translate(0, -0.05, 0), m.leather, j);
    mesh(sculptSphere(0.026, (x, y, z) => -0.25 * (bump(x, y, -0.35, 0.05, 0.2, 0.18) + bump(x, y, 0.35, 0.05, 0.2, 0.18)) * smooth(0.2, 0.8, z), new THREE.Vector3(0.85, 1, 1), 12, 10), bone, j, 0, -0.125, 0);
  }
  const censerGlow: THREE.Mesh[] = [];
  if (boss) {
    for (const a of [-1.45, 1.6]) {
      const j = hangAt(a);
      const len = 0.22;
      chain(j, [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -len / 2, 0.004), new THREE.Vector3(0, -len, 0)], gold, 0.009);
      // Censer: a pierced, domed gold pot with embers glowing through.
      const cj = joint(j, 0, -len - 0.01, 0);
      mesh(lathe([[0.0, 0.0], [0.02, -0.005], [0.04, -0.03], [0.045, -0.06], [0.035, -0.085], [0.0, -0.09]], 12), gold, cj);
      mesh(lathe([[0.0, 0.05], [0.012, 0.045], [0.03, 0.02], [0.044, 0.002]], 12), gold, cj, 0, -0.005, 0);
      mesh(new THREE.ConeGeometry(0.008, 0.03, 5), gold, cj, 0, 0.06, 0);
      censerGlow.push(mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.012, 12), orbMat, cj, 0, -0.012, 0));
    }
    // Swags of chain across the front of the skirt.
    chain(c.spine, [new THREE.Vector3(-0.17, -0.1, 0.09), new THREE.Vector3(-0.08, -0.2, 0.17), new THREE.Vector3(0.08, -0.2, 0.17), new THREE.Vector3(0.17, -0.1, 0.09)], gold, 0.009);
  }

  // --- Arms -----------------------------------------------------------------
  // Wide bell sleeves, lined black and banded in gold; bare bone below.
  const hands: THREE.Object3D[][][] = [];
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    mesh(lathe([[0.062, 0.04], [0.07, -0.1], [0.08, -0.25], [0.085, -0.31]], 14), crimson, a.upper);
    const bell = lathe([[0.075, 0.02], [0.09, -0.08], [0.12, -0.18], [0.155, -0.27]], 18);
    {
      const p = bell.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        if (y < -0.26) {
          const ang = Math.atan2(p.getX(i), p.getZ(i));
          // Torn edge, hanging lower at the back of the wrist.
          p.setY(i, y + 0.03 * Math.abs(Math.sin(ang * 4 + side)) - 0.04 * smooth(0.5, -1, Math.cos(ang)));
        }
      }
      bell.computeVertexNormals();
    }
    mesh(bell, crimson, a.fore);
    mesh(lathe([[0.07, 0.0], [0.085, -0.1], [0.135, -0.24]], 14), black, a.fore);
    mesh(new THREE.TorusGeometry(0.142, boss ? 0.008 : 0.005, 4, 22).rotateX(Math.PI / 2), gold, a.fore, 0, -0.235, 0);
    if (boss) mesh(new THREE.TorusGeometry(0.1, 0.006, 4, 20).rotateX(Math.PI / 2), gold, a.fore, 0, -0.1, 0);
    // Forearm bones reaching out of the sleeve.
    for (const dz of [-0.012, 0.012]) mesh(new THREE.CylinderGeometry(0.0085, 0.0075, 0.2, 5).translate(0, -0.1, 0), bone, a.fore, 0, -0.13, dz);
    a.hand.position.y = -0.31;
    hands.push(boneHand(a.hand, side, bone, side > 0 ? 1.3 : 0.35));
    a.restUpper = -0.12;
    a.restFore = -0.5;
    a.swing = 0.12;
  }
  const L = c.arm(-1);
  const Rt = c.arm(1);
  Rt.upper.rotation.z = 0.4;
  Rt.restUpper = -0.28;
  Rt.restFore = -0.95;
  Rt.swing = 0.05;
  L.upper.rotation.z = -0.2;
  L.restUpper = -0.3;
  L.restFore = -0.75;

  // --- Staff ----------------------------------------------------------------
  const staff = joint(Rt.hand, 0, -0.045, 0.012);
  staff.rotation.set(1.0, 0, -0.38); // upright beside him, not leaning in
  const shaftR = boss ? 0.026 : 0.018;
  mesh(new THREE.CylinderGeometry(shaftR, shaftR * 1.2, 2.25, 8).translate(0, 0.2, 0), m.wood, staff);
  for (const y of [-0.85, -0.5, 0.45, 0.85, 1.12]) mesh(new THREE.CylinderGeometry(shaftR * 1.35, shaftR * 1.35, 0.03, 8), gold, staff, 0, y, 0);
  mesh(new THREE.ConeGeometry(shaftR * 1.3, 0.08, 6).rotateX(Math.PI), gold, staff, 0, -0.95, 0);
  // Collar where the head meets the shaft.
  mesh(lathe([[shaftR * 1.2, 0], [shaftR * 2.2, 0.04], [shaftR * 1.6, 0.08], [shaftR * 1.1, 0.1]], 10), gold, staff, 0, 1.2, 0);
  const orb = joint(staff, 0, boss ? 1.42 : 1.4, 0);
  {
    const ringR = boss ? 0.15 : 0.11;
    mesh(new THREE.TorusGeometry(ringR, boss ? 0.016 : 0.012, 6, 32), gold, orb);
    mesh(new THREE.TorusGeometry(ringR * 0.62, 0.008, 5, 24), gold, orb);
    if (boss) mesh(new THREE.TorusGeometry(ringR * 1.25, 0.009, 5, 36), gold, orb);
    // Spokes from the orb to the ring, then spikes radiating out of it,
    // long and short in turn.
    const n = boss ? 24 : 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const long = i % 2 === 0;
      const len = (long ? 0.13 : 0.065) * (boss ? 1.3 : 1);
      const sp = mesh(new THREE.ConeGeometry(long ? 0.011 : 0.008, len, 5).translate(0, len / 2, 0), gold, orb, Math.sin(a) * ringR, Math.cos(a) * ringR, 0);
      sp.rotation.z = -a;
      if (i % 4 === 0) {
        const spoke = mesh(new THREE.CylinderGeometry(0.005, 0.005, ringR * 0.62, 4).translate(0, ringR * 0.31 + ringR * 0.38, 0), gold, orb);
        spoke.rotation.z = -a - Math.PI / 4;
      }
    }
    // A lower crossbar under the disc so it reads as a reliquary, not a wheel.
    mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), gold, orb, 0, -ringR - 0.02, 0);
  }
  const orbR = boss ? 0.065 : 0.048;
  mesh(new THREE.SphereGeometry(orbR, 16, 12), orbMat, orb);
  const halo = mesh(new THREE.SphereGeometry(orbR * 2, 14, 10), haloMat, orb);
  halo.renderOrder = 10;
  if (boss) {
    // Chains hanging from the disc, swinging with the staff.
    for (const s of [-1, 1]) {
      chain(orb, [new THREE.Vector3(s * 0.12, -0.09, 0), new THREE.Vector3(s * 0.13, -0.2, 0.004), new THREE.Vector3(s * 0.12, -0.3, 0)], gold, 0.008);
      mesh(new THREE.ConeGeometry(0.012, 0.04, 5).rotateX(Math.PI), gold, orb, s * 0.12, -0.33, 0);
    }
  }

  // --- Motion -----------------------------------------------------------
  const qRest = staff.quaternion.clone();
  const qHand = new THREE.Quaternion();
  const qWant = new THREE.Quaternion();
  const qTmp = new THREE.Quaternion();
  const eTmp = new THREE.Euler();
  let staffUpright = 1;
  let staffLean = 0.06;
  let glow = 1;
  let heap = 0;
  let spread = 0;
  const phase = rng() * 6;
  const stance = range(rng, -0.05, 0.05);
  const castFingers = hands[0];
  const relaxCurl = 0.35;
  c.hooks.push((dt, w, time) => {
    // Gliding: the legs barely stride under the robes and the body hardly bobs.
    for (const l of c.legs) {
      l.thigh.rotation.x *= 0.35;
      l.shin.rotation.x *= 0.35;
      l.foot.rotation.x *= 0.35;
    }
    if (heap === 0) {
      c.hips.position.y = c.hipHeight - 0.012 + Math.sin(time * 1.1 + phase) * 0.006;
      c.hips.rotation.z *= 0.3;
      c.spine.rotation.z = stance + Math.sin(time * 0.7 + phase) * 0.02;
      jaw.rotation.x = Math.max(jaw.rotation.x * 0.9, 0.04 + Math.sin(time * 0.9 + phase) * 0.03);
    }
    if (staffUpright > 0) {
      // Held upright in the world whatever the arm does: the hand's world
      // rotation is undone and replaced by the body's facing plus a lean.
      Rt.hand.updateWorldMatrix(true, false);
      Rt.hand.getWorldQuaternion(qHand);
      c.root.getWorldQuaternion(qWant).multiply(qTmp.setFromEuler(eTmp.set(staffLean, 0, 0.06)));
      qHand.invert().multiply(qWant);
      staff.quaternion.copy(qRest).slerp(qHand, staffUpright);
    }
    under.update(w, time, heap);
    over.update(w, time, heap);
    stoleJ.rotation.x = -Math.max(0, -c.leg(-1).thigh.rotation.x, -c.leg(1).thigh.rotation.x) * 0.8 + 0.06 * w;
    stoleJ.rotation.z = Math.sin(time * 1.2 + phase) * 0.03;
    for (const d of danglers) {
      const target = Math.sin(time * 1.8 + d.phase) * 0.08 + 0.15 * w;
      d.j.rotation.x += (target - d.j.rotation.x) * (1 - Math.exp(-dt * 4));
      d.j.rotation.z = Math.sin(time * 1.3 + d.phase) * 0.06;
    }
    const pulse = glow * (1 + Math.sin(time * 2.7 + phase) * 0.18 + Math.sin(time * 9.3 + phase) * 0.05);
    orbMat.color.setRGB(5 * pulse, 0.35 * pulse, 0.12 * pulse);
    haloMat.opacity = Math.min(1, 0.3 * pulse);
    halo.scale.setScalar(1 + 0.08 * Math.sin(time * 2.7 + phase) + 0.25 * (glow - 1));
    eyeMat.color.setRGB(4 * Math.min(glow, 2.5), 0.3 * Math.min(glow, 2.5), 0.1);
    for (const f of castFingers) for (let s = 0; s < f.length; s++) f[s].rotation.z = 1 * (relaxCurl * (1 - spread) - 0.25 * spread) * (s === 0 ? 0.8 : 1);
    for (const g of censerGlow) (g.material as THREE.MeshBasicMaterial).color.setRGB(3 * pulse, 0.25 * pulse, 0.1);
  });

  return {
    orb,
    staff,
    castHand: L.hand,
    jaw,
    setGlow: (g) => (glow = g),
    setCollapse: (h) => (heap = h),
    setSpread: (s) => (spread = s),
    setStaffUpright: (w) => (staffUpright = w),
    setStaffLean: (a) => (staffLean = a),
  };
}

export function buildBonePriest(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  const c = new Character({ scale: range(rng, 1.0, 1.05) * scale, hunch: 0.1, stride: 1.2 });
  const d = dressBonePriest(c, m, rng);
  bakeRig(c.root);

  const tip = new THREE.Vector3();
  const L = c.arm(-1);
  const R = c.arm(1);
  return {
    rig: c,
    attack(onHit) {
      // Staff lifted high, the free hand thrust out with its fingers spread,
      // the jaw dropping open as the bolt leaves the orb.
      keyedAction(
        c,
        1.15,
        [
          { k: 0, uL: -0.3, uR: -0.28, fL: -0.75, fR: -0.95, zL: -0.2, s: 0 },
          { k: 0.42, uL: -0.9, uR: -1.75, fL: -1.2, fR: -0.55, zL: -0.5, s: -0.2 },
          { k: 0.6, uL: -1.55, uR: -1.4, fL: -0.05, fR: -0.7, zL: -0.15, s: 0.18 },
          { k: 0.78, uL: -1.5, uR: -1.4, fL: -0.08, fR: -0.7, zL: -0.15, s: 0.15 },
          { k: 1, uL: -0.3, uR: -0.28, fL: -0.75, fR: -0.95, zL: -0.2, s: 0 },
        ],
        0.6,
        onHit,
        (k, w) => {
          const charge = smooth(0.1, 0.58, k) * (1 - smooth(0.62, 0.95, k));
          d.setGlow(1 + charge * 2.2);
          d.setSpread(smooth(0.35, 0.58, k) * (1 - smooth(0.8, 1, k)));
          d.jaw.rotation.x = Math.max(d.jaw.rotation.x, (0.1 + 0.45 * smooth(0.5, 0.62, k) * (1 - smooth(0.75, 1, k))) * w);
          c.head.rotation.x += (-0.2 * charge + 0.1 * smooth(0.58, 0.65, k)) * w;
          // The staff rises upright with the arm, then pitches the orb forward.
          d.setStaffLean(0.06 + 0.45 * smooth(0.54, 0.62, k) * (1 - smooth(0.8, 1, k)) * w);
        },
      );
    },
    flinch: () => flinch(c, 0.3),
    die() {
      // The bones give way all at once: the skeleton drops into its robes,
      // the skull lolls, the staff topples and the vestments pool on the floor.
      const tilt = range(rng, -0.3, 0.3);
      d.setStaffUpright(0);
      c.body.attach(d.staff);
      // The skinned parts cull by their rest pose; the falling staff and orb leave it.
      c.root.traverse((o) => (o.frustumCulled = false));
      const q0 = d.staff.quaternion.clone();
      const p0 = d.staff.position.clone();
      const side = range(rng, 0.6, 1.1) * (rng() < 0.5 ? 1 : -1);
      const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.05, side, 0, 'YXZ'));
      const fallDir = new THREE.Vector3(0, 0, 1).applyQuaternion(q1);
      const p1 = new THREE.Vector3(0.12 * Math.sign(side), 0.03, 0).addScaledVector(fallDir, 0.25);
      const pose = (k: number) => {
        const shudder = k < 0.2 ? Math.sin(k * 90) * 0.04 * (1 - k / 0.2) : 0;
        const drop = smooth(0.12, 0.7, k);
        const f = drop * drop;
        d.setCollapse(drop);
        d.setGlow(Math.max(0, 1 - smooth(0.1, 0.8, k)) * 0.8 + 0.2); // the orb dims to an ember
        c.hips.position.y = c.hipHeight - 0.9 * f;
        c.hips.rotation.z = tilt * 0.3 * f;
        for (const l of c.legs) {
          l.thigh.rotation.x = -1.4 * f;
          l.thigh.rotation.z = l.side * 0.3 * f;
          l.shin.rotation.x = 2.3 * f;
          l.foot.rotation.x = 0;
        }
        c.spine.rotation.x = 0.1 + 0.5 * f + shudder;
        c.spine.rotation.z = tilt * f;
        c.chest.rotation.x = 0.04 + 0.35 * f;
        c.head.rotation.x = -0.3 * smooth(0, 0.2, k) * (1 - drop) + 0.25 * f;
        c.head.rotation.z = (tilt + 0.25 * Math.sign(tilt)) * 1.4 * f;
        c.head.position.y = 0.35 - 0.1 * f;
        d.jaw.rotation.x = 0.45 * smooth(0, 0.25, k);
        L.upper.rotation.x = -0.3 * (1 - f) + 0.2 * f;
        L.upper.rotation.z = -0.2 - 0.9 * f;
        L.fore.rotation.x = -0.75 * (1 - f) - 0.2 * f;
        R.upper.rotation.x = -0.28 * (1 - f) + 0.1 * f;
        R.upper.rotation.z = 0.4 + 0.7 * f;
        R.fore.rotation.x = -0.95 * (1 - f) - 0.1 * f;
        const topple = smooth(0.1, 0.85, k);
        const tq = topple * topple;
        d.staff.quaternion.slerpQuaternions(q0, q1, tq);
        d.staff.position.lerpVectors(p0, p1, tq);
      };
      c.play(1.7, pose, () => c.hooks.push(() => pose(1)));
    },
    muzzle: () => {
      d.orb.getWorldPosition(tip);
      return tip;
    },
  };
}
