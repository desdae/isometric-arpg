import * as THREE from 'three';
import { MeshBuilder, xf } from './builder';
import { clamp01, fbm2, range, type Rng } from './noise';

// Ruined town houses: a coursed stone ground floor with door and window
// openings, an optional jettied timber-framed upper storey with plaster
// panels, and a slate gable roof whose tiles, battens and rafters fall away
// where the house has collapsed. Material keys:
//   stone, trim, wood, plaster, slate (+ slateMoss, slateDark, slateLight),
//   glass, glassLit, iron, glow, dark

export interface HouseSpec {
  w: number; // along X (the street front faces +Z)
  d: number; // along Z
  floors: 1 | 2;
  /** 0 = intact, 1 = roofless shell with broken walls. */
  damage: number;
  /** Lit windows (someone still lives here). */
  lit: boolean;
  /** Burnt out: sooted stone, charcoal timbers, embers still glowing in the rubble. */
  charred?: boolean;
}

interface Opening {
  x: number; // centre along the wall
  w: number;
  y: number; // sill height
  h: number;
  door?: boolean;
}

/** A pane of leaded glass, w x h, facing +Z, with diamonds at a constant size. */
function glazing(b: MeshBuilder, key: string, w: number, h: number, m: THREE.Matrix4) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 0.6, (uv.getY(i) * h) / 0.6);
  b.add(key, g, m, 0);
}

/**
 * Plank door hung on its left edge, `open` radians ajar (swinging inward).
 * Frame origin: bottom centre of the doorway, +Z outward.
 */
function plankDoor(b: MeshBuilder, rng: Rng, frame: THREE.Matrix4, w: number, h: number, open: number) {
  const hinge = frame.clone().multiply(xf(-w / 2 + 0.03, 0, 0, -open));
  const n = Math.max(3, Math.round(w / 0.22));
  const pw = (w - 0.06) / n;
  for (let i = 0; i < n; i++) {
    const ph = h - 0.03 - rng() * 0.05;
    // Planks run vertically: map the wood grain along their length.
    const plank = new THREE.BoxGeometry(pw * 0.96, ph, 0.06).rotateZ(Math.PI / 2);
    b.add('wood', plank, hinge.clone().multiply(xf(pw * (i + 0.5), ph / 2, range(rng, -0.005, 0.005), 0, 1, 1, 1, 0, -Math.PI / 2)), 0.9);
  }
  // Ledges and a brace on the back, iron straps and a ring on the face.
  for (const y of [0.35, h - 0.4]) {
    b.add('wood', new THREE.BoxGeometry(w - 0.12, 0.14, 0.05), hinge.clone().multiply(xf(w / 2 - 0.03, y, -0.055)), 0.9);
    b.add('iron', new THREE.BoxGeometry(w * 0.8, 0.06, 0.015), hinge.clone().multiply(xf(w * 0.4, y, 0.038)), 0);
  }
  b.add('iron', new THREE.TorusGeometry(0.06, 0.012, 6, 14), hinge.clone().multiply(xf(w - 0.2, h * 0.48, 0.05)), 0);
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
  fill?: (o: Opening, frame: THREE.Matrix4) => void,
): (x: number) => number {
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
    fill?.(o, m.clone().multiply(xf(o.x, o.y, 0)));
    b.add('wood', new THREE.BoxGeometry(o.w + 0.4, 0.2, thick + 0.04), m.clone().multiply(xf(o.x, o.y + o.h + 0.1, 0)), 1.2);
    if (!o.door) b.add('trim', new THREE.BoxGeometry(o.w + 0.15, 0.08, thick + 0.12), m.clone().multiply(xf(o.x, o.y - 0.04, 0.03)));
  }
  return profile;
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
        if (rng() > damage * 0.8) glazing(b, lit && rng() < 0.75 ? 'glassLit' : 'glass', bay - t, wy1 - wy0, m.clone().multiply(xf(x0 + bay / 2, (wy0 + wy1) / 2, -0.03)));
        else b.add('dark', new THREE.PlaneGeometry(bay - t, wy1 - wy0), m.clone().multiply(xf(x0 + bay / 2, (wy0 + wy1) / 2, -0.06)), 0);
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

/** One course strip of slates, UV-mapped to a random row of the slate texture. */
function slateStrip(rng: Rng, len: number, course: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(len, course, 0.025);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const rows = 8; // matches the slate surface generator
  const row = Math.floor(rng() * rows);
  const u0 = rng() * 4;
  const uSpan = len / 1.8; // six slates per texture width, ~0.3 m each
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * uSpan, (row + 0.04 + uv.getY(i) * 0.92) / rows);
  }
  return g;
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
  // Weathering. Old roofs sag between the gables and halfway down each slope.
  const sag = range(rng, 0.03, 0.09) + damage * 0.18;
  const sagAt = (x: number, t: number) => -sag * Math.sin(Math.PI * clamp01(x / w + 0.5)) * Math.sin(Math.PI * t);
  // Which slate material a strip gets: moss creeps up from the damp eaves and
  // gathers in patches, soot and rain streak down the slope, and odd slates
  // are replacements of a different colour.
  const mossy = range(rng, -0.3, 0.2);
  const weatherKey = (x: number, t: number, side: number) => {
    const moss = fbm2(x * 0.7 + side * 7, t * 2.5 + seed * 0.1, 3, seed + 11) * 0.5 + 0.5 + (1 - t) * 0.25 + mossy + damage * 0.2;
    if (moss > 0.9) return 'slateMoss';
    const streak = fbm2(x * 3.2 + side * 3, t * 0.6 + seed, 2, seed + 21) * 0.5 + 0.5;
    if (streak > 0.68) return 'slateDark';
    if (rng() < 0.03) return 'slateLight';
    return 'slate';
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
    // Rafters run eave to ridge so every one is carried at both ends; where
    // the roof caved in some are simply gone (they lie inside as rubble).
    for (let x = -w / 2; x <= w / 2 + 0.01; x += rafterGap) {
      if (hole(x, 0.5, side) && rng() < damage * 0.8) continue;
      // Built in short lengths that follow the sag, so the slates resting on
      // them never have a rafter poking through.
      const segs = 6;
      for (let k = 0; k < segs; k++) {
        const s0 = (k / segs) * slope;
        const s1 = ((k + 1) / segs) * slope;
        const l0 = sagAt(x, s0 / slope);
        const l1 = sagAt(x, s1 / slope);
        const tilt = Math.atan2(l1 - l0, s1 - s0);
        b.add('wood', new THREE.BoxGeometry(0.1, Math.hypot(s1 - s0, l1 - l0) + 0.02, 0.16), toSlope(x, (s0 + s1) / 2, (l0 + l1) / 2 - 0.1).multiply(xf(0, 0, 0, 0, 1, 1, 1, tilt)), 1.2);
      }
    }
    // Slate courses: strips of tiles, broken off around holes. Each strip
    // samples one random row of the slate texture so individual slates line
    // up with the course they sit in.
    const course = 0.32;
    for (let s = 0.05; s < slope - 0.05; s += course * 0.82) {
      const t = s / slope;
      // Both verges are straight: every course starts and ends on the same
      // line, and only the joints between strips are staggered.
      const edge = w / 2 + 0.25;
      let x = -edge;
      while (x < edge - 0.01) {
        let xe = Math.min(x + range(rng, 0.5, 1.1), edge);
        if (edge - xe < 0.3) xe = edge; // no sliver at the end
        const cx = (x + xe) / 2;
        const len = xe - x;
        if (!hole(cx, t, side)) {
          if (rng() < 0.03 + damage * 0.12) {
            // A slate or two slipped out, leaving a dark gap over the battens.
            if (rng() < 0.5) b.add('wood', new THREE.BoxGeometry(len, 0.04, 0.05), toSlope(cx, s, sagAt(cx, t)), 1.2);
          } else {
            const tile = slateStrip(rng, len - 0.01, course);
            const slip = rng() < 0.04 ? range(rng, 0.04, 0.12) : 0; // slid down the slope a little
            b.add(
              weatherKey(cx, t, side),
              tile,
              toSlope(cx, s + course / 2 - slip, 0.03 + sagAt(cx, t) + range(rng, -0.006, 0.006)).multiply(
                // Outward tilt so each course's lower edge stands proud of the
                // one below, plus a slight twist so courses don't read as ruled lines.
                xf(0, 0, 0, 0, 1, 1, 1, -side * (0.06 + range(rng, -0.025, 0.025)), range(rng, -0.012, 0.012) + slip * 0.6 * (rng() < 0.5 ? -1 : 1)),
              ),
              0,
            );
          }
        } else if (rng() < 0.25) {
          // Battens left exposed in the hole.
          b.add('wood', new THREE.BoxGeometry(len, 0.04, 0.05), toSlope(cx, s, sagAt(cx, t) - 0.01), 1.2);
        }
        x = xe;
      }
    }
  }
  // Ridge beam and ridge tiles.
  {
    b.add('wood', new THREE.BoxGeometry(w + 0.4, 0.2, 0.2), m.clone().multiply(xf(0, eaveY + rise - 0.05, 0)), 1.2);
    b.add('slate', new THREE.CylinderGeometry(0.14, 0.14, w + 0.5, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), m.clone().multiply(xf(0, eaveY + rise + 0.03, 0)), 1);
  }
  return { rise, eaveY };
}

/** Builds one house in local space: footprint centred on the origin, front facing +Z. */
export function ruinedHouse(rng: Rng, spec: HouseSpec): MeshBuilder {
  const b = new MeshBuilder();
  const { w, d, floors, damage, lit, charred = false } = spec;
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
  // Two kinds of ruin: a standing house keeps full-height walls that carry its
  // upper storey and (holed) roof; a gutted one has lost everything above the
  // ground floor and its walls have crumbled. Nothing is left in mid-air.
  const standing = damage < 0.5;
  // Doors and windows: plank doors (ajar where someone is home, hanging off
  // or gone in ruins) and leaded glass, lit from inside or murky and dark.
  const fill = (o: Opening, frame: THREE.Matrix4) => {
    if (o.door) {
      if (!standing && rng() < 0.5) return;
      const open = standing ? (lit ? range(rng, 0.5, 0.9) : range(rng, 0, 0.06)) : range(rng, 1.0, 1.5);
      plankDoor(b, rng, frame.clone().multiply(xf(0, 0, -thick / 2 + 0.12)), o.w, o.h, open);
      return;
    }
    const inner = frame.clone().multiply(xf(0, 0, -0.05));
    // Frame and mullion.
    b.add('wood', new THREE.BoxGeometry(o.w, 0.07, 0.1), inner.clone().multiply(xf(0, 0.035, 0)), 1.2);
    b.add('wood', new THREE.BoxGeometry(o.w, 0.07, 0.1), inner.clone().multiply(xf(0, o.h - 0.035, 0)), 1.2);
    b.add('wood', new THREE.BoxGeometry(0.06, o.h, 0.1), inner.clone().multiply(xf(0, o.h / 2, 0)), 1.2);
    if (standing && rng() > damage * 0.7) glazing(b, lit && rng() < 0.8 ? 'glassLit' : 'glass', o.w, o.h, inner.clone().multiply(xf(0, o.h / 2, 0)));
    else b.add('dark', new THREE.PlaneGeometry(o.w, o.h), inner.clone().multiply(xf(0, o.h / 2, -0.12)), 0);
    // A shutter, sometimes hanging by one hinge.
    if (rng() < 0.35) {
      const hang = !standing || rng() < 0.3 ? range(rng, 0.4, 0.9) : 0;
      const sw = o.w / 2;
      const sm = frame.clone().multiply(xf(o.w / 2 + 0.02, o.h, thick / 2 + 0.03, range(rng, 1.2, 1.6), 1, 1, 1, 0, 0));
      b.add('wood', new THREE.BoxGeometry(sw, o.h - 0.05, 0.04), sm.multiply(xf(sw / 2, 0, 0, 0, 1, 1, 1, 0, hang)).multiply(xf(0, -(o.h - 0.05) / 2, 0)), 0.9);
    }
  };
  const profiles = walls.map(([m, len, open], i) =>
    masonryWall(b, rng, m, len, groundH, thick, open, standing ? 0 : Math.min(1, damage * (i === 0 ? 0.8 : 1.1)), seed + i * 7, fill),
  );
  // Lit doorway: warm light spilling from inside.
  if (lit) b.add('glow', new THREE.PlaneGeometry(1.0, 2.05), xf(-w / 2 + doorX, 1.03, d / 2 - thick - 0.05), 0);

  let top = groundH;
  if (floors === 2 && standing) {
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
    upperWalls.forEach(([m, len], i) => timberStorey(b, rng, m, len, upperH, damage * (0.7 + i * 0.15), lit, seed + 31 + i));
    top = groundH + 0.18 + upperH;
  }

  if (standing) {
    const roofZ = floors === 2 ? 0.15 : 0;
    const { rise, eaveY } = gableRoof(b, rng, xf(0, 0, roofZ), w, d + (floors === 2 ? 0.3 : 0), top, damage, seed + 50);
    // Gable end triangles (plaster over timber), crumbled when badly damaged.
    if (damage < 0.35) {
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
  // Fallen beams lying on the floor, one end propped on rubble.
  for (let i = 0; i < Math.round(damage * 5); i++) {
    const len = range(rng, 2, Math.min(w, d) - 1);
    const tilt = range(rng, 0.02, 0.12);
    b.add('wood', new THREE.BoxGeometry(len, 0.18, 0.18), xf(range(rng, -w / 5, w / 5), 0.09 + Math.sin(tilt) * len * 0.5, range(rng, -d / 5, d / 5), rng() * 3, 1, 1, 1, 0, tilt), 1.2);
  }
  // In gutted houses, a few roof timbers still lean from a wall top down to the floor.
  if (!standing) {
    for (let i = 0; i < 3; i++) {
      const wi = Math.floor(rng() * 4);
      const [m, len] = walls[wi];
      const ax = range(rng, 0.6, len - 0.6);
      const topY = profiles[wi](ax) - 0.1;
      if (topY < 1.2) continue;
      // Wall-top point (just inside the wall) and a floor point further in.
      const pTop = new THREE.Vector3(ax, topY, -thick / 2 - 0.05).applyMatrix4(m);
      const reach = range(rng, 1.4, 2.6);
      const pFloor = new THREE.Vector3(ax + range(rng, -0.8, 0.8), 0.09, -thick / 2 - reach).applyMatrix4(m);
      pFloor.y = 0.09;
      const dir = pFloor.clone().sub(pTop);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, dir.length(), 0.16));
      beam.position.copy(pTop).addScaledVector(dir, 0.5);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      beam.updateMatrix();
      b.add('wood', beam.geometry, beam.matrix, 1.2);
    }
  }
  if (charred) {
    // Heaps of ash with embers still glowing in them, and burnt stumps of
    // timber poking out.
    for (let i = 0; i < 5; i++) {
      const hx = range(rng, -w / 2 + 1.2, w / 2 - 1.2);
      const hz = range(rng, -d / 2 + 1.2, d / 2 - 1.2);
      const r = range(rng, 0.7, 1.3);
      b.add('ash', new THREE.SphereGeometry(r, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), xf(hx, -0.05, hz, rng() * 3, 1, range(rng, 0.25, 0.4), range(rng, 0.7, 1.1)), 1);
      for (let k = 0; k < 7; k++) {
        const a = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * r * 0.8;
        const es = range(rng, 0.05, 0.12);
        const ember = new THREE.DodecahedronGeometry(es, 0);
        // Mostly buried in the ash, only their tops showing.
        const y = Math.max(0.0, (1 - (rr / r) ** 2) * r * 0.32 - es * 0.6);
        b.add(rng() < 0.15 ? 'emberHot' : 'ember', ember, xf(hx + Math.cos(a) * rr, y, hz + Math.sin(a) * rr, rng() * 3, 1, 0.7, 1.2, rng(), rng()), 0);
      }
      for (let k = 0; k < 2; k++) {
        const len = range(rng, 0.8, 1.8);
        b.add('wood', new THREE.BoxGeometry(0.16, len, 0.16), xf(hx + range(rng, -0.5, 0.5), len * 0.35, hz + range(rng, -0.5, 0.5), rng() * 3, 1, 1, 1, range(rng, -0.6, 0.6), range(rng, -0.6, 0.6)), 1.2);
      }
    }
    b.remap((k) => (k === 'stone' || k === 'trim' ? 'stoneBurnt' : k === 'wood' || k === 'plaster' ? 'charcoal' : k));
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
  // Two posts carry a ridge beam and a small pitched roof (ridge along X).
  const postH = 2.35;
  for (const sx of [-1, 1]) {
    b.add('wood', new THREE.BoxGeometry(0.16, postH, 0.16), xf(sx * 1.0, postH / 2, 0), 1.5);
    // Knee braces up to the ridge.
    b.add('wood', new THREE.BoxGeometry(0.08, 0.6, 0.08), xf(sx * 0.82, postH - 0.25, 0, 0, 1, 1, 1, 0, sx * 0.7), 1.5);
  }
  b.add('wood', new THREE.BoxGeometry(2.5, 0.16, 0.16), xf(0, postH + 0.08, 0), 1.5);
  const pitch = Math.PI / 4;
  const slope = 1.15;
  for (const side of [-1, 1]) {
    // Slope frame: origin at the ridge, local Y running down the slope toward +Z*side.
    const down = (x: number, sd: number, lift: number) =>
      xf(x, postH + 0.16 - Math.sin(pitch) * sd + Math.cos(pitch) * lift, side * (Math.cos(pitch) * sd + Math.sin(pitch) * lift), 0, 1, 1, 1, -side * (Math.PI / 2 - pitch));
    // Boarding, then overlapping slate courses.
    b.add('wood', new THREE.BoxGeometry(2.7, slope, 0.04), down(0, slope / 2, 0), 1.2);
    for (let sd = 0.12; sd < slope; sd += 0.24) {
      let x = -1.4;
      while (x < 1.39) {
        const xe = Math.min(x + 0.45 + (Math.abs(Math.sin(x * 91.7 + sd * 37.1 + side)) * 0.4), 1.4);
        b.add('slate', slateStrip(Math.random, xe - x - 0.01, 0.28), down((x + xe) / 2, sd, 0.04).multiply(xf(0, 0, 0, -side * 0.07)), 0);
        x = xe;
      }
    }
  }
  b.add('slate', new THREE.CylinderGeometry(0.1, 0.1, 2.8, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), xf(0, postH + 0.26, 0), 1);
  // Winch drum with a crank, rope and bucket.
  b.add('wood', new THREE.CylinderGeometry(0.1, 0.1, 1.8, 10).rotateZ(Math.PI / 2), xf(0, 1.55, 0), 1.5);
  b.add('iron', new THREE.CylinderGeometry(0.02, 0.02, 0.35, 5).rotateZ(Math.PI / 2), xf(1.17, 1.55, 0), 0);
  b.add('iron', new THREE.BoxGeometry(0.03, 0.32, 0.03), xf(1.32, 1.43, 0), 0);
  b.add('wood', new THREE.CylinderGeometry(0.03, 0.03, 0.18, 6).rotateZ(Math.PI / 2), xf(1.4, 1.3, 0), 1.5);
  b.add('iron', new THREE.CylinderGeometry(0.012, 0.012, 0.75, 4), xf(0.15, 1.12, 0.1), 0);
  b.add('wood', new THREE.CylinderGeometry(0.15, 0.12, 0.26, 10, 1, true), xf(0.15, 0.62, 0.1), 1.5);
  b.add('iron', new THREE.TorusGeometry(0.15, 0.01, 4, 16, Math.PI), xf(0.15, 0.75, 0.1), 0);
  return b;
}
