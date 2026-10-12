import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxProjectUVs } from '../procgen/geometry';

// Sculpting helpers for organic bodies. Instead of piling up spheres (which
// reads as a ball-jointed doll), a limb or torso is one smooth lathed surface
// whose vertices are pushed out along the surface by a displacement function:
// gaussian bumps for muscles, negative ones for grooves between them.

type V2 = [number, number];

/** 2D gaussian bump of height 1 at (cx, cy). */
export function bump(x: number, y: number, cx: number, cy: number, sx: number, sy: number): number {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-(dx * dx + dy * dy));
}

/**
 * Lathed surface around Y through a spline of `profile` ([radius, y] pairs).
 * `disp(x, y, z, theta)` gets the undeformed point (theta 0 = front, +Z;
 * positive theta toward +X) and returns how far to push it out along its
 * radial direction. The seam sits at the back. Cross-sections are then
 * scaled by sx / sz into ellipses.
 */
export function sculptLathe(
  profile: V2[],
  disp: (x: number, y: number, z: number, theta: number) => number,
  opts: { seg?: number; perSpan?: number; sx?: number; sz?: number; uvScale?: number } = {},
): THREE.BufferGeometry {
  const seg = opts.seg ?? 40;
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints((profile.length - 1) * (opts.perSpan ?? 6));
  const geo = new THREE.LatheGeometry(pts, seg, Math.PI, Math.PI * 2);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const sx = opts.sx ?? 1;
  const sz = opts.sz ?? 1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-5) {
      pos.setXYZ(i, x, y, z);
      continue;
    }
    const theta = Math.atan2(x, z);
    const d = disp(x, y, z, theta);
    const k = (r + d) / r;
    pos.setXYZ(i, x * k * sx, y, z * k * sz);
  }
  return finish(geo, opts.uvScale ?? 6);
}

/** Sphere pushed along its normals by `disp(x, y, z)` (unit-sphere coords), then scaled. */
export function sculptSphere(
  radius: number,
  disp: (x: number, y: number, z: number) => number,
  scale = new THREE.Vector3(1, 1, 1),
  wSeg = 40,
  hSeg = 30,
): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, wSeg, hSeg);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = radius * (1 + disp(x, y, z));
    pos.setXYZ(i, x * k * scale.x, y * k * scale.y, z * k * scale.z);
  }
  return finish(geo, 6);
}

/**
 * Welds the seam so normals are smooth across it, then box-projects UVs in
 * object space (tiling the skin texture `uvScale` times per metre).
 */
function finish(geo: THREE.BufferGeometry, uvScale: number): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const welded = mergeVertices(geo, 1e-5);
  welded.computeVertexNormals();
  return boxProjectUVs(welded, uvScale);
}

/** Signed shortest difference between two angles. */
export function angDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Gaussian bump over (angle, y) that wraps correctly around the lathe. */
export function bumpA(theta: number, y: number, ct: number, cy: number, st: number, sy: number): number {
  const dt = angDiff(theta, ct) / st;
  const dy = (y - cy) / sy;
  return Math.exp(-(dt * dt + dy * dy));
}

const ray = new THREE.Raycaster();
const probe = new THREE.Mesh();
/**
 * Point on the surface of a sculpted lathe at height `y` and angle `theta`
 * (0 = front), found by casting in toward the axis. Lets straps, necklaces
 * and plates sit exactly on the sculpted muscle instead of guessed radii.
 */
export function surfacePoint(geo: THREE.BufferGeometry, y: number, theta: number, lift = 0): THREE.Vector3 {
  probe.geometry = geo;
  probe.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  probe.updateMatrixWorld();
  const from = new THREE.Vector3(Math.sin(theta) * 3, y, Math.cos(theta) * 3);
  ray.set(from, new THREE.Vector3(-Math.sin(theta), 0, -Math.cos(theta)));
  const hit = ray.intersectObject(probe, false)[0];
  if (!hit) return new THREE.Vector3(0, y, 0);
  return hit.point.add(new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta)).multiplyScalar(lift));
}

/**
 * Flat strap with a rectangular section following a closed loop of surface
 * points; `out(p)` gives the outward surface direction at each point so the
 * strap lies flat against the body instead of reading as a rope.
 */
export function strapLoop(points: THREE.Vector3[], out: (p: THREE.Vector3) => THREE.Vector3, width: number, thick: number, samples = 120): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < samples; i++) {
    const u = i / samples;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = out(p).normalize();
    const w = new THREE.Vector3().crossVectors(n, t).normalize().multiplyScalar(width / 2);
    const o = n.clone().multiplyScalar(thick);
    // Four corners of the section: inner-left, outer-left, outer-right, inner-right.
    for (const c of [p.clone().add(w), p.clone().add(w).add(o), p.clone().sub(w).add(o), p.clone().sub(w)]) pos.push(c.x, c.y, c.z);
  }
  for (let i = 0; i < samples; i++) {
    const a = i * 4;
    const b = ((i + 1) % samples) * 4;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      idx.push(a + k, b + k, a + k2, a + k2, b + k, b + k2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return boxProjectUVs(geo, 6);
}

/** Flat ring band (a short thick tube) of radius r, height h, thickness t. */
export function band(r: number, h: number, t: number, seg = 28): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(r, h / 2), new THREE.Vector2(r + t, h / 2), new THREE.Vector2(r + t, -h / 2), new THREE.Vector2(r, -h / 2), new THREE.Vector2(r, h / 2)];
  return boxProjectUVs(new THREE.LatheGeometry(pts, seg), 6);
}
