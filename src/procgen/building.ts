import * as THREE from 'three';
import { MeshBuilder, xf } from './builder';
import { fbm2, range, type Rng } from './noise';

// Ruined town houses: a coursed stone ground floor with door and window
// openings, an optional jettied timber-framed upper storey with plaster
// panels, and a slate gable roof whose tiles, battens and rafters fall away
// where the house has collapsed. Material keys:
//   stone, trim, wood, plaster, slate, glow, dark

export interface HouseSpec {
  w: number; // along X (the street front faces +Z)
  d: number; // along Z
  floors: 1 | 2;
  /** 0 = intact, 1 = roofless shell with broken walls. */
  damage: number;
  /** Lit windows (someone still lives here). */
  lit: boolean;
}

interface Opening {
  x: number; // centre along the wall
  w: number;
  y: number; // sill height
  h: number;
  door?: boolean;
}

/**
 * Coursed masonry wall along +X from 0..length, outer face toward +Z. Blocks
 * are skipped inside openings and above a broken top line driven by noise.
 */
function masonryWall(
  b: MeshBuilder,
  rng: Rng,
  m: THREE.Matrix4,
  length: number,
  height: number,
  thick: number,
  openings: Opening[],
  damage: number,
  seed: number,
) {
  const course = 0.36;
  const rows = Math.ceil(height / course);
  const inOpening = (x0: number, x1: number, y0: number, y1: number) =>
    openings.some((o) => x1 > o.x - o.w / 2 && x0 < o.x + o.w / 2 && y1 > o.y && y0 < o.y + o.h);
  // Broken top profile; corners stay taller since they're stronger.
  const profile = (x: number) => {
    const n = fbm2(x * 0.45 + seed, seed * 0.37, 3, seed) * 0.5 + 0.5;
    const corner = Math.min(x, length - x) < 0.8 ? 0.35 : 0;
    return height * (1 - damage * Math.max(0, n * 1.3 - corner) * 0.9);
  };
  for (let r = 0; r < rows; r++) {
    const y = r * course;
    const h = Math.min(course, height - y);
    let x = r % 2 ? -0.18 : 0;
    while (x < length) {
      const bw = range(rng, 0.45, 0.8);
      const x0 = Math.max(0, x);
      const x1 = Math.min(length, x + bw);
      x += bw;
      if (x1 - x0 < 0.12) continue;
      const cx = (x0 + x1) / 2;
      if (y + h > profile(cx)) continue;
      if (inOpening(x0, x1, y, y + h)) continue;
      if (damage > 0.3 && rng() < damage * 0.04) continue; // a missing block here and there
      const blk = new THREE.BoxGeometry((x1 - x0) * 0.97, h * 0.95, thick * range(rng, 0.94, 1.04));
      b.add('stone', blk, m.clone().multiply(xf(cx, y + h / 2, range(rng, -0.02, 0.02), range(rng, -0.015, 0.015))));
    }
  }
  // Openings: timber lintels, stone sills, dark or lit reveals.
  for (const o of openings) {
    if (o.y + o.h > profile(o.x) + 0.2) continue; // lintel fell with the wall
    b.add('wood', new THREE.BoxGeometry(o.w + 0.4, 0.2, thick + 0.04), m.clone().multiply(xf(o.x, o.y + o.h + 0.1, 0)), 1.2);
    if (!o.door) b.add('trim', new THREE.BoxGeometry(o.w + 0.15, 0.08, thick + 0.12), m.clone().multiply(xf(o.x, o.y - 0.04, 0.03)));
  }
}

/** Timber-framed storey along +X: sill and head beams, posts, braces, plaster infill. */
function timberStorey(b: MeshBuilder, rng: Rng, m: THREE.Matrix4, length: number, height: number, damage: number, lit: boolean, seed: number) {
  const bays = Math.max(2, Math.round(length / 1.25));
  const bay = length / bays;
  const t = 0.18;
  b.add('wood', new THREE.BoxGeometry(length + 0.2, t, t), m.clone().multiply(xf(length / 2, t / 2, 0)), 1.2);
  const headIntact = damage < 0.75;
  if (headIntact) b.add('wood', new THREE.BoxGeometry(length + 0.2, t, t), m.clone().multiply(xf(length / 2, height - t / 2, 0)), 1.2);
  for (let i = 0; i <= bays; i++) {
    const x = i * bay;
    const broken = fbm2(x * 0.8, seed, 2, seed) * 0.5 + 0.5 < damage * 0.7;
    const ph = broken ? height * range(rng, 0.3, 0.7) : height;
    b.add('wood', new THREE.BoxGeometry(t, ph, t), m.clone().multiply(xf(x, ph / 2, 0.01)), 1.2);
  }
  for (let i = 0; i < bays; i++) {
    const x0 = i * bay;
    const n = fbm2((x0 + bay / 2) * 0.7, seed + 3, 2, seed + 1) * 0.5 + 0.5;
    const gone = n < damage * 0.9;
    const window = i % 2 === 1 && rng() < 0.6;
    if (!gone) {
      if (window) {
        // Small window: plaster below and above, glazing in between.
        const wy0 = height * 0.4;
        const wy1 = height * 0.8;
        b.add('plaster', new THREE.BoxGeometry(bay - t, wy0 - t, 0.08), m.clone().multiply(xf(x0 + bay / 2, t + (wy0 - t) / 2, -0.02)));
        b.add('plaster', new THREE.BoxGeometry(bay - t, height - wy1 - t, 0.08), m.clone().multiply(xf(x0 + bay / 2, wy1 + (height - wy1 - t) / 2, -0.02)));
        b.add(lit && rng() < 0.7 ? 'glow' : 'dark', new THREE.PlaneGeometry(bay - t, wy1 - wy0), m.clone().multiply(xf(x0 + bay / 2, (wy0 + wy1) / 2, -0.05)), 0);
        b.add('wood', new THREE.BoxGeometry(0.06, wy1 - wy0, 0.06), m.clone().multiply(xf(x0 + bay / 2, (wy0 + wy1) / 2, 0)), 1.2);
      } else {
        b.add('plaster', new THREE.BoxGeometry(bay - t, height - 2 * t, 0.08), m.clone().multiply(xf(x0 + bay / 2, height / 2, -0.02)));
        if (rng() < 0.55) {
          // Diagonal brace across the panel.
          const len = Math.hypot(bay, height - 2 * t);
          const ang = Math.atan2(height - 2 * t, bay) * (rng() < 0.5 ? 1 : -1);
          b.add('wood', new THREE.BoxGeometry(len, 0.12, 0.12), m.clone().multiply(xf(x0 + bay / 2, height / 2, 0.02, 0, 1, 1, 1, 0, ang)), 1.2);
        }
      }
    } else if (rng() < 0.5) {
      // Hanging remains of a brace.
      b.add('wood', new THREE.BoxGeometry(bay * 0.6, 0.12, 0.12), m.clone().multiply(xf(x0 + bay * 0.3, t + 0.1, 0.02, 0, 1, 1, 1, 0, 0.5)), 1.2);
    }
  }
}

/** Slate gable roof over a w x d footprint (ridge along X) starting at height y. */
function gableRoof(b: MeshBuilder, rng: Rng, m: THREE.Matrix4, w: number, d: number, y: number, damage: number, seed: number) {
  const pitch = THREE.MathUtils.degToRad(range(rng, 48, 56));
  const over = 0.45;
  const run = d / 2 + over;
  const rise = run * Math.tan(pitch);
  const slope = run / Math.cos(pitch);
  const eaveY = y - over * Math.tan(pitch);
  // Holes in the roof: noise over (along ridge, down slope) per side.
  const hole = (x: number, t: number, side: number) => {
    const n = fbm2(x * 0.35 + side * 13, t * 1.6 + seed, 3, seed + side) * 0.5 + 0.5;
    return n + (1 - t) * 0.12 < damage * 1.05;
  };
  const rafterGap = 0.6;
  for (const side of [-1, 1]) {
    // Transform onto this slope: x along the ridge, s metres up from the
    // eave, lifted `lift` along the roof normal. Local Y runs up the slope.
    const toSlope = (x: number, s: number, lift: number) =>
      m.clone().multiply(
        xf(
          x,
          eaveY + Math.sin(pitch) * s + Math.cos(pitch) * lift,
          side * (run - Math.cos(pitch) * s) + side * Math.sin(pitch) * lift,
          0,
          1,
          1,
          1,
          -side * (Math.PI / 2 - pitch),
        ),
      );
    // Rafters: some snapped part way up where the roof caved in.
    for (let x = -w / 2; x <= w / 2 + 0.01; x += rafterGap) {
      const t0 = hole(x, 0.5, side) ? range(rng, 0.2, 0.6) : 1;
      if (hole(x, 0.2, side) && rng() < damage * 0.6) continue;
      const len = slope * t0;
      b.add('wood', new THREE.BoxGeometry(0.1, len, 0.16), toSlope(x, len / 2, -0.08), 1.2);
    }
    // Slate courses: strips of tiles, broken off around holes.
    const course = 0.32;
    for (let s = 0.05; s < slope - 0.05; s += course * 0.82) {
      const t = s / slope;
      let x = -w / 2 - 0.2 + rng() * 0.2;
      while (x < w / 2 + 0.2) {
        const seg = range(rng, 0.5, 1.1);
        const xe = Math.min(x + seg, w / 2 + 0.25);
        const cx = (x + xe) / 2;
        if (!hole(cx, t, side)) {
          const tile = new THREE.BoxGeometry(xe - x - 0.01, course, 0.025);
          // Slight outward tilt so each course's lower edge stands proud of the one below.
          b.add('slate', tile, toSlope(cx, s + course / 2, 0.03).multiply(xf(0, 0, 0, 0, 1, 1, 1, -side * (0.06 + range(rng, -0.02, 0.02)))), 0);
        } else if (rng() < 0.25) {
          // Battens left exposed in the hole.
          b.add('wood', new THREE.BoxGeometry(xe - x, 0.04, 0.05), toSlope(cx, s, 0.0), 1.2);
        }
        x = xe;
      }
    }
  }
  // Ridge beam and ridge tiles.
  if (damage < 0.85) {
    b.add('wood', new THREE.BoxGeometry(w + 0.4, 0.2, 0.2), m.clone().multiply(xf(0, eaveY + rise - 0.05, 0)), 1.2);
    b.add('slate', new THREE.CylinderGeometry(0.14, 0.14, w + 0.5, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), m.clone().multiply(xf(0, eaveY + rise + 0.03, 0)), 1);
  }
  return { rise, eaveY };
}

/** Builds one house in local space: footprint centred on the origin, front facing +Z. */
export function ruinedHouse(rng: Rng, spec: HouseSpec): MeshBuilder {
  const b = new MeshBuilder();
  const { w, d, floors, damage, lit } = spec;
  const seed = Math.floor(rng() * 1000);
  const thick = 0.5;
  const groundH = range(rng, 2.8, 3.3);
  const upperH = 2.5;
  const doorX = range(rng, 1.0, w - 1.6);
  const front: Opening[] = [{ x: doorX, w: 1.1, y: 0, h: 2.15, door: true }];
  for (let x = 1.0; x < w - 0.8; x += 2.0) {
    if (Math.abs(x - doorX) > 1.4) front.push({ x, w: 0.7, y: 1.0, h: 1.05 });
  }
  const sideOpen = (len: number): Opening[] => (len > 4 ? [{ x: len / 2, w: 0.6, y: 1.1, h: 0.9 }] : []);

  // Ground floor walls. Each wall's local frame runs along +X with its outer face toward +Z.
  const walls: [THREE.Matrix4, number, Opening[]][] = [
    [xf(-w / 2, 0, d / 2 - thick / 2, 0), w, front],
    [xf(w / 2, 0, -d / 2 + thick / 2, Math.PI), w, [{ x: w * 0.6, w: 0.6, y: 1.1, h: 0.9 }]],
    [xf(w / 2 - thick / 2, 0, d / 2, Math.PI / 2), d, sideOpen(d)],
    [xf(-w / 2 + thick / 2, 0, -d / 2, -Math.PI / 2), d, sideOpen(d)],
  ];
  walls.forEach(([m, len, open], i) => masonryWall(b, rng, m, len, groundH, thick, open, Math.min(1, damage * (i === 0 ? 0.8 : 1.1)), seed + i * 7));
  // Lit doorway: warm light spilling from inside.
  if (lit) b.add('glow', new THREE.PlaneGeometry(1.0, 2.05), xf(-w / 2 + doorX, 1.03, d / 2 - thick - 0.05), 0);

  let top = groundH;
  if (floors === 2 && damage < 0.9) {
    // Floor joists (seen from above through holes in the roof).
    for (let x = -w / 2 + 0.3; x < w / 2; x += 0.5) {
      if (rng() < damage * 0.5) continue;
      b.add('wood', new THREE.BoxGeometry(0.14, 0.18, d + 0.5), xf(x, groundH + 0.09, 0.15), 1.2);
    }
    const jetty = 0.3;
    const upperWalls: [THREE.Matrix4, number][] = [
      [xf(-w / 2, groundH + 0.18, d / 2 + jetty - 0.1, 0), w],
      [xf(w / 2, groundH + 0.18, -d / 2 + 0.1, Math.PI), w],
      [xf(w / 2 - 0.1, groundH + 0.18, d / 2 + jetty, Math.PI / 2), d + jetty],
      [xf(-w / 2 + 0.1, groundH + 0.18, -d / 2, -Math.PI / 2), d + jetty],
    ];
    upperWalls.forEach(([m, len], i) => timberStorey(b, rng, m, len, upperH, Math.min(1, damage * (0.7 + i * 0.15)), lit, seed + 31 + i));
    top = groundH + 0.18 + upperH;
  }

  if (damage < 0.92) {
    const roofZ = floors === 2 ? 0.15 : 0;
    const { rise, eaveY } = gableRoof(b, rng, xf(0, 0, roofZ), w, d + (floors === 2 ? 0.3 : 0), top, damage, seed + 50);
    // Gable end triangles (plaster over timber), crumbled when badly damaged.
    if (damage < 0.6) {
      for (const sx of [-1, 1]) {
        const tri = new THREE.Shape();
        const half = d / 2 + (floors === 2 ? 0.15 : 0);
        tri.moveTo(-half, 0);
        tri.lineTo(half, 0);
        tri.lineTo(0, rise - (top - eaveY));
        tri.closePath();
        const g = new THREE.ExtrudeGeometry(tri, { depth: 0.12, bevelEnabled: false });
        b.add('plaster', g, xf(sx * (w / 2 - 0.06), top, roofZ, Math.PI / 2 * sx).multiply(xf(0, 0, -0.06)));
        b.add('wood', new THREE.BoxGeometry(0.16, rise - (top - eaveY), 0.16), xf(sx * (w / 2 - 0.02), top + (rise - (top - eaveY)) / 2, roofZ), 1.2);
      }
    }
  }

  // Chimney stack on one gable.
  if (damage < 0.7 && rng() < 0.7) {
    const cx = (rng() < 0.5 ? -1 : 1) * (w / 2 - 0.5);
    const ch = top + range(rng, 2.2, 3.2);
    b.add('stone', new THREE.BoxGeometry(0.8, ch, 0.9), xf(cx, ch / 2, -d * 0.15));
    b.add('trim', new THREE.BoxGeometry(0.95, 0.12, 1.05), xf(cx, ch, -d * 0.15));
  }

  // Interior rubble and fallen timbers.
  const rubble = Math.round(4 + damage * 14);
  for (let i = 0; i < rubble; i++) {
    const s = range(rng, 0.2, 0.45);
    b.add('stone', new THREE.BoxGeometry(s * 1.5, s, s * 1.1), xf(range(rng, -w / 2 + 0.6, w / 2 - 0.6), s * 0.35, range(rng, -d / 2 + 0.6, d / 2 - 0.6), rng() * 3, 1, 1, 1, range(rng, -0.4, 0.4), range(rng, -0.4, 0.4)));
  }
  for (let i = 0; i < Math.round(damage * 5); i++) {
    const len = range(rng, 2, Math.min(w, d));
    b.add('wood', new THREE.BoxGeometry(len, 0.18, 0.18), xf(range(rng, -w / 4, w / 4), range(rng, 0.3, 1.1), range(rng, -d / 4, d / 4), rng() * 3, 1, 1, 1, 0, range(rng, 0.2, 0.6)), 1.2);
  }
  return b;
}

/** Market stall: four posts, a sagging tattered awning, a counter with wares. */
export function marketStall(rng: Rng): MeshBuilder {
  const b = new MeshBuilder();
  const w = range(rng, 2.4, 3.2);
  const d = 1.6;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const h = sz > 0 ? 2.2 : 2.6;
      b.add('wood', new THREE.BoxGeometry(0.1, h, 0.1), xf((sx * w) / 2, h / 2, (sz * d) / 2), 1.5);
    }
  }
  // Awning: a cloth sheet sagging between the posts, ragged at the front edge.
  const awn = new THREE.PlaneGeometry(w + 0.3, d + 0.5, 12, 6);
  awn.rotateX(-Math.PI / 2);
  const p = awn.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const tz = (z + (d + 0.5) / 2) / (d + 0.5);
    const sag = Math.sin(((x + (w + 0.3) / 2) / (w + 0.3)) * Math.PI) * 0.15;
    let y = 2.6 - tz * 0.45 - sag;
    if (tz > 0.95) y -= rng() * 0.2; // torn hem
    p.setY(i, y);
  }
  awn.computeVertexNormals();
  b.add('awning', awn, new THREE.Matrix4(), 0);
  // Counter and wares.
  b.add('wood', new THREE.BoxGeometry(w, 0.08, 0.7), xf(0, 0.95, d / 2 - 0.2), 1.5);
  b.add('wood', new THREE.BoxGeometry(w, 0.9, 0.06), xf(0, 0.45, d / 2 + 0.1), 1.5);
  for (let i = 0; i < 7; i++) {
    const x = range(rng, -w / 2 + 0.25, w / 2 - 0.25);
    const kind = rng();
    if (kind < 0.4) {
      const jar = new THREE.LatheGeometry(
        [new THREE.Vector2(0, 0), new THREE.Vector2(0.08, 0.02), new THREE.Vector2(0.1, 0.12), new THREE.Vector2(0.05, 0.22), new THREE.Vector2(0.055, 0.26)],
        10,
      );
      b.add('clay', jar, xf(x, 0.99, d / 2 - 0.2 + range(rng, -0.15, 0.15)), 0);
    } else if (kind < 0.75) {
      b.add('sack', new THREE.SphereGeometry(0.16, 10, 8).scale(1, 0.8, 1), xf(x, 1.1, d / 2 - 0.2), 2);
    } else {
      b.add('wood', new THREE.BoxGeometry(0.35, 0.22, 0.3), xf(x, 1.1, d / 2 - 0.2, rng()), 2);
    }
  }
  return b;
}

/** Stone well with a timber windlass and a little roof. */
export function well(): MeshBuilder {
  const b = new MeshBuilder();
  const ring = new THREE.Shape();
  ring.absarc(0, 0, 1.15, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 0.8, 0, Math.PI * 2, true);
  ring.holes.push(hole);
  const wall = new THREE.ExtrudeGeometry(ring, { depth: 0.9, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, curveSegments: 24 });
  wall.rotateX(-Math.PI / 2);
  b.add('stone', wall, new THREE.Matrix4(), 1.2);
  b.add('dark', new THREE.CircleGeometry(0.8, 20).rotateX(-Math.PI / 2), xf(0, 0.4, 0), 0);
  for (const sx of [-1, 1]) b.add('wood', new THREE.BoxGeometry(0.14, 2.3, 0.14), xf(sx * 1.0, 1.15, 0), 1.5);
  b.add('wood', new THREE.CylinderGeometry(0.08, 0.08, 2.1, 8).rotateZ(Math.PI / 2), xf(0, 1.7, 0), 1.5);
  b.add('iron', new THREE.CylinderGeometry(0.01, 0.01, 0.9, 4), xf(0, 1.2, 0), 0);
  b.add('wood', new THREE.CylinderGeometry(0.12, 0.1, 0.22, 10), xf(0, 0.72, 0), 1.5);
  const roof = new THREE.CylinderGeometry(0, 1.6, 2.6, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.rotateX(Math.PI / 2);
  b.add('slate', roof, xf(0, 2.75, 0, Math.PI / 2, 1, 0.55, 1), 1);
  return b;
}
