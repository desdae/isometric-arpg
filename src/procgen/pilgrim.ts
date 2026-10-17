import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBuilder, xf } from './builder';
import { range, type Rng } from './noise';
import { taperTube, skullGeos } from './torture';
import { archWindow, buttress, pinnacle, pointedArch, spireTower } from './gothic';

// Props of the pilgrim road: gnarled dead orchard trees, turf-roofed cottages
// dug into the hillsides, black stone trays of red pilgrim candles, handcarts
// left where they stopped, wayside bell shrines, grave markers, kerbstones
// and the dead cathedral of Saint Orsolya's sisters at the end of the road.
// Builders write under these material keys:
//   stone  - dressed grey stone     trim   - lighter carved stone
//   wood   - weathered timber       plank  - door planks, dark and oiled
//   slate  - roof slates            iron   - black iron
//   rust   - rusted iron            bronze - old bell bronze
//   tray   - black candle slabs     wax    - red candle wax
//   flame  - candle flames          glow   - lit windows and sigils
//   dark   - unlit openings         bone   - bones and skulls
//   cloth  - rags                   rock   - loose stones
//   coal   - embers

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * A dead orchard tree like the ones in the concept: a squat, twisting trunk
 * with roots clawing into the ground and a wide crown of contorted limbs that
 * fork down to fine black twigs. About `h` metres tall; one merged geometry.
 */
export function gnarledTree(rng: Rng, h = 6): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const up = V(0, 1, 0);
  /** A limb from `p` heading `dir` for `len`, bending as it goes; recurses into smaller limbs. */
  const limb = (p: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const n = depth === 0 ? 7 : depth < 3 ? 5 : 3;
    const pts = [p.clone()];
    const d = dir.clone().normalize();
    const q = p.clone();
    for (let i = 1; i <= n; i++) {
      // Gnarl: a kink each step, plus a pull toward the sky that weakens as limbs thin.
      d.add(V(range(rng, -0.55, 0.55), range(rng, -0.25, 0.35) + (depth === 0 ? 0.35 : 0.08), range(rng, -0.55, 0.55))).normalize();
      if (depth > 1) d.y -= 0.05 * (i / n); // tips droop
      q.addScaledVector(d, len / n);
      pts.push(q.clone());
    }
    const r1 = r * (depth === 0 ? 0.45 : 0.3);
    parts.push(taperTube(pts, r, r1, depth === 0 ? 14 : depth < 2 ? 8 : 4, depth === 0 ? 8 : depth === 1 ? 6 : depth === 2 ? 4 : 3));
    if (depth >= 3 || r < 0.012) return;
    const kids = depth === 0 ? 4 + Math.floor(rng() * 2) : depth === 1 ? 3 : 2 + (rng() < 0.5 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const t = depth === 0 ? range(rng, 0.45, 1) : range(rng, 0.35, 1);
      const idx = Math.min(pts.length - 1, Math.max(1, Math.round(t * (pts.length - 1))));
      const at = pts[idx];
      const base = pts[idx].clone().sub(pts[idx - 1]).normalize();
      const a = (k / kids) * Math.PI * 2 + rng() * 1.2;
      // Spread: limbs fan outward, wide and low like an old apple tree.
      const out = V(Math.cos(a), depth === 0 ? range(rng, 0.1, 0.55) : range(rng, -0.15, 0.45), Math.sin(a));
      const nd = base.clone().multiplyScalar(0.45).add(out).normalize();
      const rr = r * (0.42 + (1 - t) * 0.25) * (depth === 0 ? 1 : 0.85);
      limb(at, nd, len * range(rng, 0.5, 0.75), rr, depth + 1);
    }
  };
  const trunkR = 0.06 * h;
  limb(V(0, -0.2, 0), up.clone().add(V(range(rng, -0.3, 0.3), 0, range(rng, -0.3, 0.3))), h * 0.42, trunkR, 0);
  // Roots: thick flares that dive into the soil.
  const roots = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rng() * 0.6;
    const len = range(rng, 0.7, 1.4) * h * 0.18;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    parts.push(
      taperTube(
        [V(ca * trunkR * 0.3, 0.55 * trunkR * 4, sa * trunkR * 0.3), V(ca * trunkR * 1.2, trunkR * 1.2, sa * trunkR * 1.2), V(ca * len * 0.7, 0.05, sa * len * 0.7), V(ca * len, -0.25, sa * len)],
        trunkR * 0.7,
        trunkR * 0.12,
        6,
        5,
      ),
    );
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  g.computeVertexNormals();
  return g;
}

/**
 * A cottage dug into a turf mound (the mound itself is terrain): a timber
 * front wall, an arched plank door with iron straps and a ring pull, a porch
 * roof of slates on two posts, a round sigil window glowing red, and a bench
 * with jars beside a little stool. Faces +Z with its door at the origin.
 * Footprint about 2.6 x 1.4 in front of the mound.
 */
export function moundCottage(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const W = 3.4;
  const H = 2.6;
  // Front wall: rough stone footing, timber posts and rails, filled with dark plaster boards.
  b.add('stone', new THREE.BoxGeometry(W + 0.3, 0.45, 0.6), xf(0, 0.22, -0.2));
  b.add('trim', new THREE.BoxGeometry(W, H, 0.22), xf(0, 0.45 + H / 2, -0.3));
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1, -0.85, 0.85]) b.add('plank', new THREE.BoxGeometry(0.2, H + 0.1, 0.12), xf(x, 0.45 + H / 2, -0.15));
  b.add('plank', new THREE.BoxGeometry(W + 0.2, 0.18, 0.14), xf(0, 0.45 + H, -0.14));
  b.add('plank', new THREE.BoxGeometry(W, 0.14, 0.12), xf(0, 1.6, -0.15));
  // Arched door: planks cut to a round head, iron straps and a ring.
  const doorW = 1.15;
  const doorH = 2.0;
  const head = new THREE.Shape();
  head.moveTo(-doorW / 2, 0);
  head.lineTo(-doorW / 2, doorH - doorW / 2);
  head.absarc(0, doorH - doorW / 2, doorW / 2, Math.PI, 0, true);
  head.lineTo(doorW / 2, 0);
  head.lineTo(-doorW / 2, 0);
  // Frame: the arch outline in heavy timber.
  const frame = new THREE.Shape();
  const fw = doorW + 0.32;
  frame.moveTo(-fw / 2, 0);
  frame.lineTo(-fw / 2, doorH - doorW / 2);
  frame.absarc(0, doorH - doorW / 2, fw / 2, Math.PI, 0, true);
  frame.lineTo(fw / 2, 0);
  frame.lineTo(-fw / 2, 0);
  frame.holes.push(new THREE.Path(head.getPoints(24).reverse()));
  b.add('plank', new THREE.ExtrudeGeometry(frame, { depth: 0.2, bevelEnabled: false, curveSegments: 16 }), xf(0, 0.42, -0.12));
  const doorGeo = new THREE.ExtrudeGeometry(head, { depth: 0.08, bevelEnabled: false, curveSegments: 16 });
  b.add('door', doorGeo, xf(0, 0.42, -0.16), 0);
  // Plank seams as shallow battens.
  for (let i = -2; i <= 2; i++) b.add('plank', new THREE.BoxGeometry(0.02, doorH - 0.15 - Math.abs(i) * 0.08, 0.02), xf(i * 0.2, 0.42 + (doorH - Math.abs(i) * 0.08) / 2, -0.07));
  for (const y of [0.55, 1.45]) b.add('iron', new THREE.BoxGeometry(doorW * 0.9, 0.07, 0.03), xf(0, 0.42 + y, -0.06));
  b.add('iron', new THREE.TorusGeometry(0.07, 0.015, 6, 14), xf(doorW * 0.28, 0.42 + 1.0, -0.04));
  b.add('iron', new THREE.SphereGeometry(0.03, 6, 5), xf(doorW * 0.28, 0.42 + 1.07, -0.05));
  // Threshold slabs leading out.
  b.add('stone', new THREE.BoxGeometry(1.5, 0.12, 0.7), xf(0, 0.06, 0.45));
  // Round sigil window: a wooden frame round a red-lit wheel of tracery.
  const wx = 1.25;
  const wy = 1.55;
  b.add('plank', new THREE.BoxGeometry(0.9, 0.9, 0.12), xf(wx, wy, -0.1));
  b.add('glow', new THREE.CircleGeometry(0.34, 20), xf(wx, wy, -0.035), 0);
  b.add('iron', new THREE.TorusGeometry(0.34, 0.025, 5, 24), xf(wx, wy, -0.02));
  b.add('iron', new THREE.TorusGeometry(0.15, 0.018, 5, 18), xf(wx, wy, -0.02));
  for (let i = 0; i < 8; i++) b.add('iron', new THREE.BoxGeometry(0.02, 0.36, 0.02), xf(wx, wy, -0.02, 0, 1, 1, 1, 0, (i / 8) * Math.PI));
  // Front gable: the plastered wall rises to a point under a steep slate roof
  // whose ridge runs back into the mound, eaves overhanging the door.
  const top = 0.45 + H;
  const half = W / 2 + 0.38;
  const pitch = 0.62;
  const rise = half * Math.tan(pitch);
  const gable = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, (W / 2) * Math.tan(pitch))]);
  b.add('trim', new THREE.ExtrudeGeometry(gable, { depth: 0.22, bevelEnabled: false }), xf(0, top, -0.41));
  // Kingpost and collar in the gable.
  b.add('plank', new THREE.BoxGeometry(0.14, (W / 2) * Math.tan(pitch) - 0.1, 0.1), xf(0, top + ((W / 2) * Math.tan(pitch)) / 2 - 0.05, -0.14));
  const back = -3.6;
  const front = 0.55;
  const len = front - back;
  for (const s of [-1, 1]) {
    const slope = Math.hypot(half, rise);
    // Courses of slates from eave to ridge, each a row of overlapping tiles.
    const courses = 7;
    for (let c = 0; c < courses; c++) {
      const t = (c + 0.5) / courses;
      const x = s * half * (1 - t);
      const y = top - 0.08 + rise * t;
      const n = 9;
      for (let i = 0; i < n; i++) {
        const z = back + ((i + (c % 2) * 0.5) / n) * len;
        if (z > front) continue;
        b.add('slate', new THREE.BoxGeometry(slope / courses + 0.06, 0.04, len / n + 0.02), xf(x, y + range(rng, -0.012, 0.012), z + len / n / 2, range(rng, -0.03, 0.03), 1, 1, 1, 0, -s * pitch + range(rng, -0.03, 0.03)));
      }
    }
    // Barge board along the front edge of each slope.
    b.add('wood', new THREE.BoxGeometry(slope + 0.1, 0.16, 0.08), xf((s * half) / 2, top - 0.08 + rise / 2 - 0.06, front + 0.02, 0, 1, 1, 1, 0, -s * pitch));
  }
  b.add('slate', new THREE.BoxGeometry(0.2, 0.14, len + 0.1), xf(0, top - 0.04 + rise, back + len / 2));
  // A bench with jars and a stool with a round painted sign, by the wall.
  const bx = -1.35;
  b.add('wood', new THREE.BoxGeometry(1.0, 0.07, 0.38), xf(bx, 0.62, 0.35));
  for (const sx of [-0.4, 0.4]) for (const sz of [0.2, 0.5]) b.add('wood', new THREE.BoxGeometry(0.06, 0.6, 0.06), xf(bx + sx, 0.3, sz));
  for (let i = 0; i < 3; i++) {
    const r = range(rng, 0.05, 0.08);
    b.add('rock', new THREE.CylinderGeometry(r * 0.8, r, range(rng, 0.1, 0.18), 10), xf(bx - 0.25 + i * 0.22, 0.72, 0.35 + range(rng, -0.06, 0.06)));
  }
  const sx = 2.1;
  b.add('wood', new THREE.CylinderGeometry(0.16, 0.18, 0.05, 12), xf(sx, 0.45, 0.6));
  for (let i = 0; i < 3; i++) b.add('wood', new THREE.CylinderGeometry(0.02, 0.025, 0.45, 5), xf(sx + Math.cos(i * 2.1) * 0.12, 0.22, 0.6 + Math.sin(i * 2.1) * 0.12, 0, 1, 1, 1, Math.sin(i * 2.1) * 0.12, -Math.cos(i * 2.1) * 0.12));
  b.add('wood', new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16), xf(sx, 0.75, 0.62, 0, 1, 1, 1, Math.PI / 2 - 0.2));
  b.add('glow', new THREE.RingGeometry(0.08, 0.15, 16), xf(sx, 0.755, 0.645, 0, 1, 1, 1, -0.2), 0);
  return b;
}

/**
 * A black stone tray of red pilgrim candles: thick pillars of red wax burnt
 * to different heights, drips down their sides, a small flame on each, and a
 * glossy pool of melted wax spread over the slab. Footprint about 0.5 x 0.4.
 */
export function candleTray(rng: Rng, n = 3): MeshBuilder {
  const b = new MeshBuilder();
  const W = range(rng, 0.85, 1.05);
  const D = range(rng, 0.6, 0.75);
  b.add('tray', new THREE.BoxGeometry(W, 0.1, D), xf(0, 0.05, 0, 0), 2);
  b.add('tray', new THREE.BoxGeometry(W - 0.12, 0.03, D - 0.12), xf(0, 0.11, 0), 2);
  const spots: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let x = 0;
    let z = 0;
    for (let t = 0; t < 20; t++) {
      x = range(rng, -W / 2 + 0.17, W / 2 - 0.17);
      z = range(rng, -D / 2 + 0.17, D / 2 - 0.17);
      if (spots.every(([px, pz]) => Math.hypot(px - x, pz - z) > 0.24)) break;
    }
    spots.push([x, z]);
    const r = i === 0 ? range(rng, 0.09, 0.11) : range(rng, 0.06, 0.09);
    const h = i === 0 ? range(rng, 0.42, 0.55) : range(rng, 0.12, 0.34);
    const prof = [V(0, 0, 0), V(r * 1.15, 0, 0), V(r, 0.03, 0), V(r * 1.01, h * 0.7, 0), V(r, h - 0.01, 0), V(r * 0.9, h, 0), V(r * 0.6, h - 0.015, 0), V(0.001, h - 0.02, 0)].map((p) => new THREE.Vector2(p.x, p.y));
    b.add('wax', new THREE.LatheGeometry(prof, 16), xf(x, 0.12, z), 4);
    for (let k = 0; k < 3; k++) {
      const a = rng() * Math.PI * 2;
      const len = Math.min(h - 0.03, range(rng, 0.05, 0.2));
      const p0 = V(x + Math.sin(a) * r, 0.12 + h - 0.01, z + Math.cos(a) * r);
      const p1 = V(x + Math.sin(a) * r * 1.07, 0.12 + h - len, z + Math.cos(a) * r * 1.07);
      b.add('wax', taperTube([p0, p0.clone().lerp(p1, 0.5), p1], 0.012, 0.016, 4, 5), undefined, 4);
    }
    b.add('iron', new THREE.CylinderGeometry(0.003, 0.004, 0.03, 4), xf(x, 0.12 + h + 0.005, z), 4);
    const fh = range(rng, 0.09, 0.13);
    const flame = new THREE.LatheGeometry([V(0, 0, 0), V(0.017, 0.012, 0), V(0.022, fh * 0.3, 0), V(0.014, fh * 0.65, 0), V(0, fh, 0)].map((p) => new THREE.Vector2(p.x, p.y)), 8);
    b.add('flame', flame, xf(x, 0.12 + h + 0.008, z), 0);
  }
  // Spilled wax pooled on the slab.
  for (let i = 0; i < 5; i++) b.add('wax', new THREE.CylinderGeometry(range(rng, 0.05, 0.12), range(rng, 0.06, 0.13), 0.01, 12).scale(1, 1, range(rng, 0.6, 1)), xf(range(rng, -W / 2 + 0.1, W / 2 - 0.1), 0.125, range(rng, -D / 2 + 0.1, D / 2 - 0.1), rng() * 6), 4);
  return b;
}

/** Heights of each candle flame above the tray's origin, to hang lights at. */
export const CANDLE_LIGHT_Y = 0.7;

/**
 * A two-wheeled handcart left on the verge: a plank tray on iron-bound spoked
 * wheels, its shafts resting on the ground, heaped with stones and a few
 * embers, a lone candle burning on its rim. Footprint about 1.0 x 0.7.
 */
export function handcart(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const L = 1.5;
  const W = 0.95;
  const tilt = 0.12;
  const m = xf(0, 0.62, 0, 0, 1, 1, 1, 0, tilt);
  b.add('plank', new THREE.BoxGeometry(W, 0.06, L), m);
  for (const s of [-1, 1]) b.add('wood', new THREE.BoxGeometry(0.06, 0.3, L), m.clone().multiply(xf(s * (W / 2 - 0.03), 0.15, 0)));
  for (const s of [-1, 1]) b.add('wood', new THREE.BoxGeometry(W, 0.3, 0.06), m.clone().multiply(xf(0, 0.15, s * (L / 2 - 0.03))));
  for (const s of [-1, 1]) for (const zz of [-0.5, 0, 0.5]) b.add('iron', new THREE.BoxGeometry(0.075, 0.32, 0.03), m.clone().multiply(xf(s * (W / 2 + 0.005), 0.15, zz)));
  // Shafts running to the ground ahead.
  for (const s of [-1, 1]) b.add('wood', new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6), xf(s * 0.35, 0.33, L / 2 + 0.55, 0, 1, 1, 1, Math.PI / 2 - 0.42));
  // Spoked wheels.
  for (const s of [-1, 1]) {
    const wm = xf(s * (W / 2 + 0.1), 0.46, -0.15, 0, 1, 1, 1, 0, Math.PI / 2);
    b.add('iron', new THREE.TorusGeometry(0.42, 0.035, 6, 24), wm);
    b.add('wood', new THREE.TorusGeometry(0.39, 0.03, 5, 20), wm);
    b.add('wood', new THREE.CylinderGeometry(0.08, 0.08, 0.14, 10).rotateX(Math.PI / 2), wm);
    for (let i = 0; i < 10; i++) b.add('wood', new THREE.BoxGeometry(0.03, 0.78, 0.03), wm.clone().multiply(xf(0, 0, 0, 0, 1, 1, 1, 0, 0).multiply(new THREE.Matrix4().makeRotationZ((i / 10) * Math.PI))));
  }
  b.add('iron', new THREE.CylinderGeometry(0.03, 0.03, W + 0.32, 6).rotateZ(Math.PI / 2), xf(0, 0.46, -0.15));
  // The load: stones and embers heaped in the tray.
  for (let i = 0; i < 22; i++) {
    const x = range(rng, -W / 2 + 0.12, W / 2 - 0.12);
    const z = range(rng, -L / 2 + 0.12, L / 2 - 0.12);
    const r = range(rng, 0.05, 0.12);
    const mound = 0.08 + (1 - Math.abs(z) / (L / 2)) * 0.12;
    b.add(i % 5 === 0 ? 'coal' : 'rock', new THREE.IcosahedronGeometry(r, 0).scale(1, 0.7, 1), m.clone().multiply(xf(x, mound + r * 0.5, z, rng() * 6)));
  }
  // A candle on the front corner.
  b.add('wax', new THREE.CylinderGeometry(0.06, 0.065, 0.2, 12), m.clone().multiply(xf(W / 2 - 0.12, 0.4, L / 2 - 0.12)));
  b.add('flame', new THREE.ConeGeometry(0.02, 0.08, 8).translate(0, 0.04, 0), m.clone().multiply(xf(W / 2 - 0.12, 0.51, L / 2 - 0.12)), 0);
  return b;
}

/** Where the cart's candle flame sits, for its light. */
export const CART_CANDLE = V(0.355, 1.2, 0.55);

/**
 * A wayside shrine: a stone pillar on a stepped base carrying a little gabled
 * house of stone with a small bronze bell hung in its open belfry and a
 * candle niche below. Footprint about 0.5 x 0.5.
 */
export function bellShrine(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  b.add('stone', new THREE.BoxGeometry(0.9, 0.2, 0.9), xf(0, 0.1, 0));
  b.add('stone', new THREE.BoxGeometry(0.65, 0.18, 0.65), xf(0, 0.29, 0));
  b.add('trim', new THREE.CylinderGeometry(0.16, 0.2, 1.6, 8), xf(0, 1.18, 0, Math.PI / 8));
  b.add('trim', new THREE.BoxGeometry(0.6, 0.12, 0.6), xf(0, 2.02, 0));
  // Belfry: four corner posts and a gabled roof.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('stone', new THREE.BoxGeometry(0.09, 0.62, 0.09), xf(sx * 0.24, 2.39, sz * 0.24));
  const gable = new THREE.Shape([new THREE.Vector2(-0.4, 0), new THREE.Vector2(0.4, 0), new THREE.Vector2(0, 0.42)]);
  b.add('slate', new THREE.ExtrudeGeometry(gable, { depth: 0.72, bevelEnabled: false }).translate(0, 0, -0.36), xf(0, 2.7, 0));
  b.add('iron', new THREE.BoxGeometry(0.05, 0.3, 0.05), xf(0, 3.25, 0));
  b.add('iron', new THREE.BoxGeometry(0.2, 0.05, 0.05), xf(0, 3.3, 0));
  // The bell.
  const bell = [V(0.012, 0.2, 0), V(0.07, 0.19, 0), V(0.085, 0.12, 0), V(0.1, 0.04, 0), V(0.13, 0, 0), V(0.12, -0.01, 0), V(0.085, 0.02, 0), V(0.07, 0.11, 0), V(0.05, 0.17, 0)].map((p) => new THREE.Vector2(p.x, p.y));
  b.add('bronze', new THREE.LatheGeometry(bell, 16), xf(0, 2.3, 0), 4);
  b.add('bronze', new THREE.TorusGeometry(0.03, 0.01, 5, 10), xf(0, 2.52, 0));
  b.add('iron', new THREE.SphereGeometry(0.025, 6, 5), xf(0, 2.3, 0));
  // Candle niche cut into the pillar.
  b.add('dark', new THREE.ShapeGeometry(pointedArch(0.18, 0.3)), xf(0, 1.25, 0.181, 0), 0);
  b.add('wax', new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), xf(0, 1.3, 0.16));
  b.add('flame', new THREE.ConeGeometry(0.014, 0.05, 6).translate(0, 0.025, 0), xf(0, 1.345, 0.16), 0);
  void rng;
  return b;
}

/** A leaning grave marker: a cross or a round-headed stone. */
export function graveMarker(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const lean = xf(0, 0, 0, rng() * 0.3 - 0.15, 1, 1, 1, range(rng, -0.12, 0.12), range(rng, -0.12, 0.12));
  if (rng() < 0.5) {
    const h = range(rng, 0.9, 1.3);
    b.add('stone', new THREE.BoxGeometry(0.12, h, 0.1), lean.clone().multiply(xf(0, h / 2 - 0.1, 0)));
    b.add('stone', new THREE.BoxGeometry(0.55, 0.11, 0.1), lean.clone().multiply(xf(0, h * 0.68, 0)));
  } else {
    const s = new THREE.Shape();
    const w = range(rng, 0.45, 0.6);
    const h = range(rng, 0.6, 0.9);
    s.moveTo(-w / 2, -0.15);
    s.lineTo(-w / 2, h - w / 2);
    s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true);
    s.lineTo(w / 2, -0.15);
    b.add('stone', new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1, curveSegments: 10 }).translate(0, 0, -0.06), lean);
  }
  // A heap of earth in front.
  b.add('rock', new THREE.SphereGeometry(0.4, 10, 6).scale(1, 0.18, 1.6), xf(0, 0, 0.75));
  return b;
}

/**
 * Kerbstones laid along both sides of a road: one geometry per stone shape,
 * placed by the caller as instances. Each stone is roughly 0.5 long.
 */
export function kerbStones(rng: Rng, n = 4): THREE.BufferGeometry[] {
  return Array.from({ length: n }, () => {
    const g = new THREE.BoxGeometry(range(rng, 0.42, 0.62), range(rng, 0.2, 0.28), range(rng, 0.24, 0.32), 2, 1, 1);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      // Round the top edges and roughen the faces.
      const y = p.getY(i);
      const k = y > 0 ? 0.82 : 1;
      p.setXYZ(i, p.getX(i) * (k + range(rng, -0.03, 0.03)), y + range(rng, -0.015, 0.015), p.getZ(i) * (k + range(rng, -0.04, 0.04)));
    }
    g.translate(0, 0.02, 0);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * The convent church of the Silent Sisters at the end of the road, dead and
 * roofless in places: a long nave of buttressed bays with tall pointed
 * windows (a few still glowing), a west front of two spired towers flanking
 * a great rose window and a sealed portal, a crossing spire, and a cross on
 * every peak. Faces +Z (the west front toward the road); about 16 m wide,
 * 34 m long, the crossing spire some 40 m high.
 */
export function convent(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const W = 11;
  const L = 30;
  const H = 13;
  const front = L / 2;
  b.add('trim', new THREE.BoxGeometry(W + 8, 0.8, L + 4), xf(0, 0.4, 0));
  // Nave walls with buttresses and windows between them.
  const bays = 6;
  for (const s of [-1, 1]) {
    b.add('stone', new THREE.BoxGeometry(1, H, L - 4), xf(s * (W / 2), 0.8 + H / 2, -2));
    for (let i = 0; i <= bays; i++) {
      const z = -L / 2 + 1 + (i * (L - 6)) / bays;
      buttress(b, xf(s * (W / 2 + 0.5), 0.8, z, s > 0 ? Math.PI / 2 : -Math.PI / 2), H * 0.85, 2.6);
      pinnacle(b, xf(s * (W / 2 + 1.6), 0.8 + H * 0.85, z), 0.35, 3);
      if (i < bays) archWindow(b, xf(s * (W / 2 + 0.52), 0.8 + 3, z + (L - 6) / bays / 2, s > 0 ? Math.PI / 2 : -Math.PI / 2), 1.6, 6.5, rng() < 0.3);
    }
  }
  // Steep roof over the nave, broken open toward the crossing.
  const gable = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.8, 0), new THREE.Vector2(W / 2 + 0.8, 0), new THREE.Vector2(0, 7)]);
  b.add('slate', new THREE.ExtrudeGeometry(gable, { depth: L - 6, bevelEnabled: false }).translate(0, 0, -(L - 6) / 2), xf(0, 0.8 + H, -3));
  // Apse at the east end.
  b.add('stone', new THREE.CylinderGeometry(W / 2, W / 2, H, 10, 1, false, 0, Math.PI), xf(0, 0.8 + H / 2, -L / 2 + 1, Math.PI / 2 + Math.PI / 2));
  b.add('slate', new THREE.ConeGeometry(W / 2 + 0.5, 6, 10, 1, false, 0, Math.PI), xf(0, 0.8 + H + 3, -L / 2 + 1, Math.PI));
  // West front: a wall with the rose window and the portal, between two towers.
  b.add('stone', new THREE.BoxGeometry(W + 1, H + 4, 1.6), xf(0, 0.8 + (H + 4) / 2, front - 1.5));
  const g2 = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.5, 0), new THREE.Vector2(W / 2 + 0.5, 0), new THREE.Vector2(0, 6)]);
  b.add('trim', new THREE.ExtrudeGeometry(g2, { depth: 1.6, bevelEnabled: false }).translate(0, 0, -0.8), xf(0, 0.8 + H + 4, front - 1.5));
  // Rose window.
  const ry = 0.8 + H - 1;
  b.add('glow', new THREE.CircleGeometry(2.6, 32), xf(0, ry, front - 0.65), 0);
  b.add('trim', new THREE.TorusGeometry(2.75, 0.25, 6, 32), xf(0, ry, front - 0.55));
  b.add('trim', new THREE.TorusGeometry(1.0, 0.14, 6, 24), xf(0, ry, front - 0.6));
  for (let i = 0; i < 12; i++) b.add('trim', new THREE.BoxGeometry(0.14, 5.2, 0.16), xf(0, ry, front - 0.6, 0, 1, 1, 1, 0, (i / 12) * Math.PI));
  // The great portal: stepped pointed arches round sealed doors.
  for (let k = 0; k < 4; k++) {
    const w = 3.2 + k * 0.6;
    const h = 5.2 + k * 0.45;
    const sh = pointedArch(w, h);
    sh.holes.push(new THREE.Path(pointedArch(w - 0.5, h - 0.3).getPoints(20).reverse()));
    b.add('trim', new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false, curveSegments: 12 }), xf(0, 0.8, front - 0.6 + (3 - k) * 0.12));
  }
  b.add('plank', new THREE.ShapeGeometry(pointedArch(3.0, 5.0), 12), xf(0, 0.8, front - 0.66), 0);
  b.add('iron', new THREE.BoxGeometry(3.0, 0.14, 0.06), xf(0, 0.8 + 1.5, front - 0.6));
  b.add('iron', new THREE.BoxGeometry(3.0, 0.14, 0.06), xf(0, 0.8 + 3.2, front - 0.6));
  b.add('iron', new THREE.BoxGeometry(0.12, 4.8, 0.06), xf(0, 0.8 + 2.4, front - 0.6));
  // Steps up to the portal.
  for (let k = 0; k < 4; k++) b.add('trim', new THREE.BoxGeometry(8 - k * 0.8, 0.22, 0.5), xf(0, 0.11 + k * 0.22 - 0.1, front + 1.6 - k * 0.45));
  // Towers and spires.
  for (const s of [-1, 1]) spireTower(b, rng, xf(s * (W / 2 + 1.6), 0.8, front - 2, rng() * 0.2), 2.8, H + 9, 14);
  spireTower(b, rng, xf(0, 0.8 + H, -4), 2.2, 6, 17);
  return b;
}

/**
 * The way down into the Ossuary: a squat stone porch with a pointed doorway
 * onto a stair, its arch studded with skulls and lit red from below, iron
 * gates thrown open. Faces +Z; the stair runs down toward -Z. Footprint
 * about 2.6 x 3.0.
 */
export function ossuaryPorch(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const W = 4.6;
  const D = 5;
  const H = 3.6;
  b.add('trim', new THREE.BoxGeometry(W + 1, 0.4, D + 1), xf(0, 0.2, 0));
  for (const s of [-1, 1]) b.add('stone', new THREE.BoxGeometry(0.7, H, D), xf(s * (W / 2 - 0.35), 0.4 + H / 2, 0));
  b.add('stone', new THREE.BoxGeometry(W, H, 0.7), xf(0, 0.4 + H / 2, -D / 2 + 0.35));
  // Front with the doorway.
  const doorW = 1.9;
  const archH = 2.9;
  const face = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(W / 2, H), new THREE.Vector2(-W / 2, H)]);
  face.holes.push(new THREE.Path(pointedArch(doorW, archH).getPoints(20).reverse()));
  b.add('stone', new THREE.ExtrudeGeometry(face, { depth: 0.7, bevelEnabled: false, curveSegments: 12 }), xf(0, 0.4, D / 2 - 0.7));
  // Gabled roof with a cross.
  const gable = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.35, 0), new THREE.Vector2(W / 2 + 0.35, 0), new THREE.Vector2(0, 2.2)]);
  b.add('slate', new THREE.ExtrudeGeometry(gable, { depth: D + 0.5, bevelEnabled: false }).translate(0, 0, -(D + 0.5) / 2), xf(0, 0.4 + H, 0));
  b.add('trim', new THREE.BoxGeometry(0.16, 1.2, 0.16), xf(0, 0.4 + H + 2.6, D / 2));
  b.add('trim', new THREE.BoxGeometry(0.7, 0.16, 0.16), xf(0, 0.4 + H + 2.85, D / 2));
  // A ring of skulls round the arch.
  const skull = skullGeos(0, 0)[0];
  const arch = pointedArch(doorW + 0.45, archH + 0.25).getPoints(30);
  for (let i = 1; i < arch.length - 1; i += 2) {
    const p = arch[i];
    if (p.y < 0.4) continue;
    b.add('bone', skull, xf(p.x, 0.4 + p.y, D / 2 + 0.07, range(rng, -0.2, 0.2), 1.25), 0);
  }
  // Niches with more skulls either side.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const y = 0.9 + k * 0.75;
      b.add('dark', new THREE.PlaneGeometry(0.42, 0.5), xf(s * 1.65, 0.4 + y, D / 2 + 0.01), 0);
      b.add('bone', skull, xf(s * 1.65, 0.4 + y - 0.08, D / 2 - 0.05, range(rng, -0.4, 0.4), 1.4), 0);
    }
  }
  // The stairwell: dark descending steps.
  for (let k = 0; k < 7; k++) b.add('stone', new THREE.BoxGeometry(doorW, 0.25, 0.5), xf(0, 0.25 - k * 0.25, D / 2 - 0.9 - k * 0.5));
  b.add('dark', new THREE.PlaneGeometry(doorW, D - 1).rotateX(-Math.PI / 2), xf(0, -1.6, -0.2), 0);
  b.add('dark', new THREE.ShapeGeometry(pointedArch(doorW, archH), 12), xf(0, 0.4, -D / 2 + 0.75), 0);
  // Gates swung open against the jambs.
  for (const s of [-1, 1]) {
    const gm = xf(s * (doorW / 2 + 0.05), 0.4, D / 2 + 0.1, s * 1.35);
    for (let i = 0; i < 6; i++) b.add('iron', new THREE.CylinderGeometry(0.02, 0.02, 2.3, 5), gm.clone().multiply(xf(s * (0.08 + i * 0.15), 1.15, 0)));
    for (const y of [0.25, 1.2, 2.2]) b.add('iron', new THREE.BoxGeometry(0.9, 0.05, 0.04), gm.clone().multiply(xf(s * 0.45, y, 0)));
  }
  return b;
}
