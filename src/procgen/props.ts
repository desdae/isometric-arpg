import * as THREE from 'three';
import { MeshBuilder, xf } from './builder';
import { range, type Rng } from './noise';

// Wasteland props. Material keys: wood, iron, stone, bone.

function wheel(b: MeshBuilder, m: THREE.Matrix4, r: number, broken: boolean, rng: Rng) {
  const rim = new THREE.TorusGeometry(r, 0.05, 6, 20, broken ? Math.PI * range(rng, 1.1, 1.6) : Math.PI * 2);
  b.add('wood', rim, m, 1.5);
  const tyre = new THREE.TorusGeometry(r + 0.03, 0.025, 4, 24, broken ? Math.PI * 1.1 : Math.PI * 2);
  b.add('iron', tyre, m, 1.5);
  b.add('wood', new THREE.CylinderGeometry(0.1, 0.1, 0.22, 8).rotateX(Math.PI / 2), m, 1.5);
  const spokes = 10;
  for (let i = 0; i < spokes; i++) {
    if (broken && rng() < 0.4) continue;
    const a = (i / spokes) * Math.PI * 2;
    const s = new THREE.BoxGeometry(0.035, r, 0.04);
    s.translate(0, r / 2, 0);
    s.rotateZ(a);
    b.add('wood', s, m, 1.5);
  }
}

/** A wrecked cart: tilted bed, smashed boards, one wheel off and lying flat. */
export function brokenWagon(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const L = 3.2;
  const W = 1.5;
  const tilt = range(rng, 0.12, 0.28);
  const bed = xf(0, 0.55, 0, 0, 1, 1, 1, 0, tilt);
  // Floor boards, some missing or shortened.
  for (let z = -W / 2 + 0.12; z < W / 2; z += 0.24) {
    if (rng() < 0.15) continue;
    const len = rng() < 0.25 ? L * range(rng, 0.4, 0.7) : L;
    b.add('wood', new THREE.BoxGeometry(len, 0.06, 0.22), bed.clone().multiply(xf((L - len) / 2 * (rng() < 0.5 ? 1 : -1), 0, z, range(rng, -0.02, 0.02))), 1.2);
  }
  // Side rails and stakes.
  for (const side of [-1, 1]) {
    const broken = rng() < 0.5;
    b.add('wood', new THREE.BoxGeometry(broken ? L * 0.55 : L, 0.12, 0.08), bed.clone().multiply(xf(broken ? -L * 0.22 : 0, 0.5, side * W / 2)), 1.2);
    for (let x = -L / 2 + 0.2; x < L / 2; x += 0.65) {
      if (broken && x > 0) continue;
      b.add('wood', new THREE.BoxGeometry(0.08, 0.6, 0.08), bed.clone().multiply(xf(x, 0.3, side * W / 2, 0, 1, 1, 1, range(rng, -0.1, 0.1))), 1.2);
    }
  }
  // Axles and wheels: one side still attached, the other wheel fallen.
  b.add('wood', new THREE.BoxGeometry(0.1, 0.1, W + 0.3), bed.clone().multiply(xf(-L * 0.3, -0.12, 0)), 1.2);
  wheel(b, xf(-L * 0.3 - 0.05, 0.55 - Math.sin(tilt) * L * 0.3, W / 2 + 0.22), 0.55, false, rng);
  wheel(b, xf(L * 0.6, 0.06, W * 0.4, range(rng, 0, 3), 1, 1, 1, Math.PI / 2), 0.55, true, rng);
  // Shaft resting on the ground.
  b.add('wood', new THREE.BoxGeometry(2.2, 0.08, 0.08), xf(-L / 2 - 0.9, 0.2, 0.25, 0.2, 1, 1, 1, 0, 0.25), 1.2);
  // Loose debris.
  for (let i = 0; i < 6; i++) {
    b.add('wood', new THREE.BoxGeometry(range(rng, 0.4, 1.2), 0.05, 0.18), xf(range(rng, -2, 2.5), 0.03, range(rng, -1.5, 1.5), rng() * 3), 1.2);
  }
  return b;
}

/** Ring of sharpened stakes, some leaning or snapped. */
export function stakes(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const n = 5 + Math.floor(rng() * 6);
  for (let i = 0; i < n; i++) {
    const h = range(rng, 1.2, 2.4) * (rng() < 0.2 ? 0.45 : 1);
    const r = range(rng, 0.06, 0.1);
    const shaft = new THREE.CylinderGeometry(r * 0.9, r, h, 6);
    shaft.translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r * 0.9, r * 4, 6);
    tip.translate(0, h + r * 2, 0);
    const m = xf(range(rng, -0.8, 0.8), 0, range(rng, -0.8, 0.8), rng() * 6, 1, 1, 1, range(rng, -0.35, 0.35), range(rng, -0.35, 0.35));
    b.add('wood', shaft, m, 2);
    b.add('wood', tip, m, 2);
  }
  return b;
}

/** Scattered bones and a skull. */
export function bones(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  for (let i = 0; i < 5; i++) {
    const len = range(rng, 0.25, 0.5);
    const m = xf(range(rng, -0.5, 0.5), 0.03, range(rng, -0.5, 0.5), rng() * 6, 1, 1, 1, 0, Math.PI / 2);
    b.add('bone', new THREE.CylinderGeometry(0.025, 0.025, len, 5), m, 3);
    b.add('bone', new THREE.SphereGeometry(0.045, 6, 4), m.clone().multiply(xf(0, len / 2, 0)), 3);
    b.add('bone', new THREE.SphereGeometry(0.045, 6, 4), m.clone().multiply(xf(0, -len / 2, 0)), 3);
  }
  const skull = new THREE.SphereGeometry(0.12, 10, 8);
  skull.scale(1, 0.9, 1.2);
  b.add('bone', skull, xf(range(rng, -0.3, 0.3), 0.1, range(rng, -0.3, 0.3), rng() * 6), 3);
  return b;
}

/** Iron fire bowl on a tripod. Fire sits at y = 1.25. */
export function brazier(): MeshBuilder {
  const b = new MeshBuilder();
  const pts = [
    new THREE.Vector2(0.0, 0),
    new THREE.Vector2(0.35, 0.05),
    new THREE.Vector2(0.55, 0.3),
    new THREE.Vector2(0.6, 0.38),
    new THREE.Vector2(0.52, 0.36),
    new THREE.Vector2(0.3, 0.1),
    new THREE.Vector2(0.0, 0.08),
  ];
  b.add('iron', new THREE.LatheGeometry(pts, 14), xf(0, 0.9, 0), 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.CylinderGeometry(0.035, 0.045, 1.1, 5);
    b.add('iron', leg, xf(Math.cos(a) * 0.25, 0.5, Math.sin(a) * 0.25, 0, 1, 1, 1, Math.sin(a) * 0.3, -Math.cos(a) * 0.3), 0);
  }
  // Glowing coals.
  b.add('coal', new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1), xf(0, 1.12, 0), 0);
  return b;
}

/** A tuft of dead grass blades; vertex colour darkens toward the roots. */
export function grassTuft(rng: Rng): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const blades = 9;
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2;
    const lean = range(rng, 0.1, 0.6);
    const h = range(rng, 0.25, 0.6);
    const w = 0.025;
    const ox = Math.cos(a) * 0.08 * rng();
    const oz = Math.sin(a) * 0.08 * rng();
    const dx = Math.cos(a) * lean * h;
    const dz = Math.sin(a) * lean * h;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    const segs = 3;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const p = (t: number) => [ox + dx * t * t, h * t, oz + dz * t * t];
      const [x0, y0, z0] = p(t0);
      const [x1, y1, z1] = p(t1);
      const w0 = 1 - t0;
      const w1 = 1 - t1;
      const quad = [
        [x0 - px * w0, y0, z0 - pz * w0, t0],
        [x0 + px * w0, y0, z0 + pz * w0, t0],
        [x1 + px * w1, y1, z1 + pz * w1, t1],
        [x0 - px * w0, y0, z0 - pz * w0, t0],
        [x1 + px * w1, y1, z1 + pz * w1, t1],
        [x1 - px * w1, y1, z1 - pz * w1, t1],
      ];
      for (const [x, y, z, t] of quad) {
        pos.push(x, y, z);
        const shade = 0.25 + t * 0.75;
        col.push(shade, shade, shade);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Point normals mostly up so the tuft is lit like the ground under it.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return g;
}
