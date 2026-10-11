import * as THREE from 'three';
import { MeshBuilder, xf } from './builder';
import { range, type Rng } from './noise';

// Gothic architecture kit: pointed arches, pinnacles with crockets, buttresses,
// octagonal spire towers, crenellated curtain walls and a gatehouse. Pieces
// write into a MeshBuilder under these material keys:
//   stone  - wall masonry        trim  - darker carved stone, spires, caps
//   glow   - lit window panes    dark  - unlit openings / recesses
//   iron   - portcullis, finials

/** Equilateral pointed arch outline, base centred at the origin. */
export function pointedArch(w: number, h: number): THREE.Shape {
  const r = w;
  const spring = Math.max(0, h - r * Math.sin(Math.PI / 3));
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, spring);
  s.absarc(w / 2, spring, r, Math.PI, (2 * Math.PI) / 3, true);
  s.absarc(-w / 2, spring, r, Math.PI / 3, 0, true);
  s.lineTo(w / 2, 0);
  s.closePath();
  return s;
}

function archPath(w: number, h: number): THREE.Path {
  const p = new THREE.Path();
  const pts = pointedArch(w, h).getPoints(12);
  p.setFromPoints(pts.reverse());
  return p;
}

/**
 * Arched window facing +Z: moulded frame, recessed pane (lit or dark), a
 * central mullion and a round tracery ring in the head.
 */
export function archWindow(b: MeshBuilder, m: THREE.Matrix4, w: number, h: number, lit: boolean) {
  const frameW = Math.max(0.08, w * 0.12);
  const outer = pointedArch(w + frameW * 2, h + frameW);
  outer.holes.push(archPath(w, h));
  const frame = new THREE.ExtrudeGeometry(outer, { depth: 0.18, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1, curveSegments: 12 });
  b.add('trim', frame, m.clone().multiply(xf(0, 0, -0.05)));

  const pane = new THREE.ShapeGeometry(pointedArch(w, h), 12);
  b.add(lit ? 'glow' : 'dark', pane, m.clone().multiply(xf(0, 0, -0.08)), 0);

  const mullion = new THREE.BoxGeometry(w * 0.07, h * 0.72, 0.08);
  b.add('trim', mullion, m.clone().multiply(xf(0, h * 0.36, -0.03)));
  const sill = new THREE.BoxGeometry(w + frameW * 2.6, 0.1, 0.32);
  b.add('trim', sill, m.clone().multiply(xf(0, -0.05, 0.04)));
  const ringR = w * 0.22;
  const ring = new THREE.TorusGeometry(ringR, w * 0.035, 6, 16);
  b.add('trim', ring, m.clone().multiply(xf(0, h - w * 0.5, -0.03)));
}

/** Square pinnacle with gablets, a four-sided spirelet, crockets and a finial. */
export function pinnacle(b: MeshBuilder, m: THREE.Matrix4, r: number, h: number) {
  const shaftH = h * 0.4;
  b.add('trim', new THREE.BoxGeometry(r * 2, shaftH, r * 2), m.clone().multiply(xf(0, shaftH / 2, 0)));
  // Gablets on four sides.
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(0, r * 1.15, r * 0.9, 3, 1);
    g.rotateZ(Math.PI / 2);
    g.rotateX(Math.PI / 2);
    b.add('trim', g, m.clone().multiply(xf(0, shaftH + r * 0.1, 0, (i * Math.PI) / 2)).multiply(xf(0, 0, r * 0.75, 0, 1, 1, 0.5)));
  }
  const spireH = h * 0.6;
  const spire = new THREE.ConeGeometry(r * 1.1, spireH, 4, 1);
  spire.rotateY(Math.PI / 4);
  b.add('trim', spire, m.clone().multiply(xf(0, shaftH + spireH / 2, 0)));
  // Crockets climbing the four edges.
  const n = Math.max(2, Math.round(spireH / (r * 1.4)));
  for (let e = 0; e < 4; e++) {
    const a = (e * Math.PI) / 2;
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      const rr = r * 1.1 * (1 - t) * Math.SQRT1_2 * 1.35;
      const c = new THREE.ConeGeometry(r * 0.18, r * 0.45, 4);
      c.rotateZ(-0.9);
      b.add('trim', c, m.clone().multiply(xf(Math.cos(a) * rr, shaftH + t * spireH, Math.sin(a) * rr, -a)));
    }
  }
  b.add('iron', new THREE.SphereGeometry(r * 0.22, 8, 6), m.clone().multiply(xf(0, shaftH + spireH + r * 0.1, 0)), 0);
}

/** Stepped buttress projecting along +Z from a wall face, capped with a pinnacle. */
export function buttress(b: MeshBuilder, m: THREE.Matrix4, h: number, depth: number, w = 0.8) {
  const steps = 3;
  let y = 0;
  for (let i = 0; i < steps; i++) {
    const sh = (h * (i === steps - 1 ? 0.3 : 0.35));
    const d = depth * (1 - i * 0.28);
    b.add('stone', new THREE.BoxGeometry(w, sh, d), m.clone().multiply(xf(0, y + sh / 2, d / 2)));
    // Sloped weathering cap.
    const cap = new THREE.CylinderGeometry(0, d * 0.75, w * 1.02, 3, 1);
    cap.rotateZ(Math.PI / 2);
    b.add('trim', cap, m.clone().multiply(xf(0, y + sh, d / 2 - 0.02, 0, 1, 0.45, 1).multiply(xf(0, 0, 0, Math.PI / 2))));
    y += sh;
  }
  pinnacle(b, m.clone().multiply(xf(0, y - 0.05, depth * 0.25)), w * 0.32, h * 0.45);
}

/** Crenellated parapet along +X of a given length at height y. */
export function parapet(b: MeshBuilder, m: THREE.Matrix4, length: number, y: number, thick: number) {
  b.add('trim', new THREE.BoxGeometry(length, 0.22, thick + 0.25), m.clone().multiply(xf(length / 2, y + 0.11, 0)));
  const merlon = 0.55;
  const gap = 0.4;
  for (let x = 0.2; x + merlon <= length; x += merlon + gap) {
    b.add('stone', new THREE.BoxGeometry(merlon, 0.75, thick), m.clone().multiply(xf(x + merlon / 2, y + 0.22 + 0.375, 0)));
    const cap = new THREE.BoxGeometry(merlon + 0.08, 0.08, thick + 0.08);
    b.add('trim', cap, m.clone().multiply(xf(x + merlon / 2, y + 0.22 + 0.79, 0)));
  }
}

/** Curtain wall segment running along +X with its outer face toward +Z. */
export function curtainWall(b: MeshBuilder, rng: Rng, m: THREE.Matrix4, length: number, h: number, thick = 1.4) {
  b.add('stone', new THREE.BoxGeometry(length, h, thick), m.clone().multiply(xf(length / 2, h / 2, 0)));
  // Plinth and string course.
  b.add('trim', new THREE.BoxGeometry(length, 0.6, thick + 0.35), m.clone().multiply(xf(length / 2, 0.3, 0)));
  b.add('trim', new THREE.BoxGeometry(length, 0.16, thick + 0.18), m.clone().multiply(xf(length / 2, h * 0.62, 0)));
  parapet(b, m, length, h, thick);
  const bays = Math.max(1, Math.round(length / 4.5));
  const bay = length / bays;
  for (let i = 0; i <= bays; i++) buttress(b, m.clone().multiply(xf(i * bay, 0, thick / 2)), h * 0.95, 1.5);
  for (let i = 0; i < bays; i++) {
    if (rng() < 0.75) {
      const ww = range(rng, 0.8, 1.1);
      archWindow(b, m.clone().multiply(xf((i + 0.5) * bay, h * 0.66, thick / 2 + 0.02)), ww, ww * 2.2, rng() < 0.35);
    }
    // Arrow slit low on the wall.
    b.add('dark', new THREE.PlaneGeometry(0.14, 0.9), m.clone().multiply(xf((i + 0.5) * bay, h * 0.3, thick / 2 + 0.01)), 0);
  }
}

/** Octagonal tower with tiered windows, string courses and a crocketed spire. */
export function spireTower(b: MeshBuilder, rng: Rng, m: THREE.Matrix4, r: number, bodyH: number, spireH: number) {
  const sides = 8;
  const rot = Math.PI / sides;
  const body = new THREE.CylinderGeometry(r, r * 1.04, bodyH, sides, 1);
  body.rotateY(rot);
  b.add('stone', body, m.clone().multiply(xf(0, bodyH / 2, 0)));
  const plinth = new THREE.CylinderGeometry(r * 1.18, r * 1.25, 1.0, sides, 1);
  plinth.rotateY(rot);
  b.add('trim', plinth, m.clone().multiply(xf(0, 0.5, 0)));

  const tiers = Math.max(2, Math.floor(bodyH / 5));
  const apothem = r * Math.cos(Math.PI / sides);
  for (let t = 1; t <= tiers; t++) {
    const y = (bodyH * t) / (tiers + 0.4);
    const course = new THREE.CylinderGeometry(r * 1.08, r * 1.08, 0.18, sides, 1);
    course.rotateY(rot);
    b.add('trim', course, m.clone().multiply(xf(0, y, 0)));
    // Windows on alternating faces, staggered per tier.
    for (let f = 0; f < sides; f++) {
      if ((f + t) % 2) continue;
      const a = (f / sides) * Math.PI * 2;
      const wy = y - bodyH / (tiers + 0.4) + 0.6;
      const ww = r * 0.42;
      archWindow(
        b,
        m.clone().multiply(xf(Math.sin(a) * apothem, wy, Math.cos(a) * apothem, a)),
        ww,
        Math.min(ww * 2.6, bodyH / (tiers + 0.4) - 1.2),
        rng() < 0.3,
      );
    }
  }

  // Gallery: parapet ring with corner pinnacles.
  const top = bodyH;
  const ring = new THREE.CylinderGeometry(r * 1.2, r * 1.05, 0.5, sides, 1);
  ring.rotateY(rot);
  b.add('trim', ring, m.clone().multiply(xf(0, top + 0.25, 0)));
  for (let f = 0; f < sides; f++) {
    const a = (f / sides) * Math.PI * 2 + rot;
    pinnacle(b, m.clone().multiply(xf(Math.sin(a) * r * 1.1, top + 0.5, Math.cos(a) * r * 1.1, a)), r * 0.13, spireH * 0.22);
  }

  // Spire with crockets along its eight arrises.
  const spire = new THREE.ConeGeometry(r * 0.92, spireH, sides, 6);
  spire.rotateY(rot);
  b.add('trim', spire, m.clone().multiply(xf(0, top + 0.5 + spireH / 2, 0)));
  const crockets = Math.round(spireH / 1.3);
  for (let f = 0; f < sides; f++) {
    const a = (f / sides) * Math.PI * 2;
    for (let k = 1; k < crockets; k++) {
      const t = k / crockets;
      const rr = r * 0.92 * (1 - t) + 0.05;
      const c = new THREE.ConeGeometry(0.09, 0.35, 4);
      c.rotateX(0.9);
      b.add('trim', c, m.clone().multiply(xf(Math.sin(a) * rr, top + 0.5 + t * spireH, Math.cos(a) * rr, a)));
    }
  }
  // Lucarnes (small gabled openings) at the spire base.
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * Math.PI * 2;
    const lm = m.clone().multiply(xf(Math.sin(a) * r * 0.7, top + 1.2, Math.cos(a) * r * 0.7, a));
    b.add('trim', new THREE.BoxGeometry(r * 0.5, 1.2, 0.5), lm.clone().multiply(xf(0, 0.3, 0)));
    archWindow(b, lm.clone().multiply(xf(0, -0.2, 0.26)), r * 0.25, 0.9, rng() < 0.5);
    const g = new THREE.CylinderGeometry(0, r * 0.32, 0.6, 3, 1);
    g.rotateZ(Math.PI / 2);
    g.rotateY(Math.PI / 2);
    b.add('trim', g, lm.clone().multiply(xf(0, 1.15, 0, 0, 1, 1.4, 0.9)));
  }
  b.add('iron', new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), m.clone().multiply(xf(0, top + 0.5 + spireH + 0.6, 0)), 0);
  const cross = new THREE.BoxGeometry(0.7, 0.07, 0.07);
  b.add('iron', cross, m.clone().multiply(xf(0, top + 0.5 + spireH + 1.0, 0)), 0);
}

/** Gatehouse spanning `width` along X, outer face toward +Z, opening centred. */
export function gatehouse(b: MeshBuilder, rng: Rng, m: THREE.Matrix4, width: number, h: number, thick = 3) {
  const openW = 4.2;
  const openH = 6.0;
  // Front and back faces with an arched opening, joined by side blocks.
  const face = new THREE.Shape();
  face.moveTo(-width / 2, 0);
  face.lineTo(width / 2, 0);
  face.lineTo(width / 2, h);
  face.lineTo(-width / 2, h);
  face.closePath();
  face.holes.push(archPath(openW, openH));
  const faceGeo = new THREE.ExtrudeGeometry(face, { depth: thick, bevelEnabled: false, curveSegments: 14 });
  b.add('stone', faceGeo, m.clone().multiply(xf(0, 0, -thick / 2)));
  // Deep voussoir rings around the opening.
  for (let i = 0; i < 3; i++) {
    const o = pointedArch(openW + 0.5 + i * 0.5, openH + 0.25 + i * 0.25);
    o.holes.push(archPath(openW + i * 0.5, openH + i * 0.25));
    const ring = new THREE.ExtrudeGeometry(o, { depth: 0.25, bevelEnabled: false, curveSegments: 14 });
    b.add('trim', ring, m.clone().multiply(xf(0, 0, thick / 2 - 0.05 - i * 0.2)));
  }
  // Raised portcullis bars just visible in the arch head.
  for (let x = -openW / 2 + 0.3; x < openW / 2; x += 0.42) {
    b.add('iron', new THREE.BoxGeometry(0.07, 1.6, 0.07), m.clone().multiply(xf(x, openH - 1.0, 0.4)), 0);
  }
  b.add('iron', new THREE.BoxGeometry(openW, 0.09, 0.09), m.clone().multiply(xf(0, openH - 1.75, 0.4)), 0);
  // Dark passage ceiling so the arch reads as deep.
  b.add('dark', new THREE.BoxGeometry(openW, 0.1, thick), m.clone().multiply(xf(0, openH - 0.4, 0)), 0);
  parapet(b, m.clone().multiply(xf(-width / 2, 0, thick / 2 - 0.4)), width, h, 0.8);
  // A traceried rose window above the gate.
  archWindow(b, m.clone().multiply(xf(0, openH + 1.2, thick / 2 + 0.02)), 1.2, 2.4, true);
  for (const sx of [-1, 1]) {
    spireTower(b, rng, m.clone().multiply(xf(sx * (width / 2 + 1.6), 0, 0.6)), 2.6, h + 5, 10 + rng() * 3);
  }
}
