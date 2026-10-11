import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm3, range, type Rng } from './noise';

// Procedural mesh building blocks. Generators return plain BufferGeometry (or
// small groups when a prop mixes materials) so scenes can instance and merge
// them freely.

const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

/** Assigns UVs by projecting each triangle onto the axis plane it faces most. */
export function boxProjectUVs(geo: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
  // Normals are computed before de-indexing so curved surfaces stay smooth.
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const g = ni(geo);
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 3) {
    // Use the face normal so all three vertices share a projection.
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 3; k++) {
      nx += Math.abs(nor.getX(i + k));
      ny += Math.abs(nor.getY(i + k));
      nz += Math.abs(nor.getZ(i + k));
    }
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k);
      const y = pos.getY(i + k);
      const z = pos.getZ(i + k);
      let u: number;
      let v: number;
      if (ny >= nx && ny >= nz) {
        u = x;
        v = z;
      } else if (nx >= nz) {
        u = z;
        v = y;
      } else {
        u = x;
        v = y;
      }
      uv[(i + k) * 2] = u * scale;
      uv[(i + k) * 2 + 1] = v * scale;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** A craggy boulder: noise-displaced icosphere with a flattened base. */
export function rock(rng: Rng, size = 1): THREE.BufferGeometry {
  const seed = Math.floor(rng() * 1e6);
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 5);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.getAttribute('position');
  const sx = range(rng, 0.8, 1.4);
  const sy = range(rng, 0.5, 0.9);
  const sz = range(rng, 0.8, 1.3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const big = fbm3(v.x * 1.2, v.y * 1.2, v.z * 1.2, 4, seed);
    // Ridged term gives sharp faceted breaks rather than blobby lumps.
    const ridged = 1 - Math.abs(fbm3(v.x * 3, v.y * 3, v.z * 3, 3, seed + 9));
    const d = 1 + big * 0.45 + ridged * 0.12;
    v.multiplyScalar(d);
    v.set(v.x * sx, v.y * sy, v.z * sz);
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.15;
    pos.setXYZ(i, v.x * size, v.y * size, v.z * size);
  }
  return boxProjectUVs(geo, 0.6 / size);
}

/** Tapered cylinder from a to b, merged into a list. */
function limb(parts: THREE.BufferGeometry[], a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 7) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, Math.max(1, Math.round(len * 3)), false);
  g.translate(0, len / 2, 0);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(a.x, a.y, a.z);
  // Cylinder UVs wrap around the trunk, which suits the bark texture.
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * 0.8);
  parts.push(g);
}

/** Gnarled leafless tree grown by recursive branching. */
export function deadTree(rng: Rng, height = 4): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, depth: number) => {
    // Each branch is a few kinked segments.
    let p = start.clone();
    let d = dir.clone();
    const segs = 3;
    let r = radius;
    for (let s = 0; s < segs; s++) {
      d.add(new THREE.Vector3(range(rng, -0.35, 0.35), range(rng, -0.1, 0.25), range(rng, -0.35, 0.35))).normalize();
      const next = p.clone().addScaledVector(d, len / segs);
      const r2 = r * 0.82;
      limb(parts, p, next, r, r2, depth > 1 ? 7 : 5);
      p = next;
      r = r2;
    }
    if (depth <= 0 || r < 0.015) return;
    const kids = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < kids; k++) {
      const axis = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize();
      const nd = d.clone().applyAxisAngle(axis, range(rng, 0.5, 1.1));
      grow(p, nd, len * range(rng, 0.55, 0.75), r * range(rng, 0.6, 0.8), depth - 1);
    }
  };
  // Root flare.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rng();
    limb(
      parts,
      new THREE.Vector3(0, 0.35, 0),
      new THREE.Vector3(Math.cos(a) * 0.55, -0.05, Math.sin(a) * 0.55),
      height * 0.045,
      0.03,
      5,
    );
  }
  grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), height * 0.55, height * 0.06, 4);
  const merged = mergeGeometries(parts.map(ni));
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

/**
 * A ruined stone wall built from individually placed blocks. The top edge
 * follows a noise profile so the wall reads as broken rather than cut.
 */
export function ruinedWall(rng: Rng, length = 6, height = 3, thickness = 0.6): THREE.BufferGeometry {
  const seed = Math.floor(rng() * 1e6);
  const parts: THREE.BufferGeometry[] = [];
  const course = 0.32;
  const rows = Math.ceil(height / course);
  for (let row = 0; row < rows; row++) {
    let x = row % 2 ? -0.3 : 0;
    const y = row * course;
    while (x < length) {
      const w = range(rng, 0.55, 0.95);
      const cx = x + w / 2;
      const profile = height * (0.35 + 0.65 * (0.5 + 0.5 * fbm3(cx * 0.35, 0, 0, 3, seed)));
      const missing = rng() < 0.05 + Math.max(0, (y - profile * 0.7) / height) * 0.8;
      if (y < profile && !missing && cx > 0 && cx < length) {
        const h = course * range(rng, 0.88, 0.98);
        const d = thickness * range(rng, 0.9, 1.05);
        const b = new THREE.BoxGeometry(w * 0.96, h, d, 1, 1, 1);
        b.rotateY(range(rng, -0.03, 0.03));
        b.rotateZ(range(rng, -0.02, 0.02));
        b.translate(cx, y + h / 2, range(rng, -0.03, 0.03));
        parts.push(b);
      }
      x += w;
    }
  }
  // Fallen rubble at the base.
  for (let i = 0; i < length * 2; i++) {
    const s = range(rng, 0.15, 0.35);
    const b = new THREE.BoxGeometry(s * 1.6, s, s * 1.2);
    b.rotateX(range(rng, -0.6, 0.6));
    b.rotateY(rng() * Math.PI);
    b.rotateZ(range(rng, -0.6, 0.6));
    b.translate(range(rng, 0, length), s * 0.35, range(rng, -1.0, 1.0) * thickness * 1.6);
    parts.push(b);
  }
  const merged = mergeGeometries(parts.map(ni));
  parts.forEach((p) => p.dispose());
  return boxProjectUVs(merged, 0.5);
}

/** Bulging wooden barrel. */
export function barrel(rng: Rng): THREE.BufferGeometry {
  const h = range(rng, 0.8, 1.0);
  const pts: THREE.Vector2[] = [];
  const steps = 12;
  pts.push(new THREE.Vector2(0, 0));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = 0.3 + Math.sin(t * Math.PI) * 0.06;
    pts.push(new THREE.Vector2(r, t * h));
  }
  pts.push(new THREE.Vector2(0, h));
  const g = new THREE.LatheGeometry(pts, 18);
  g.computeVertexNormals();
  return g;
}

/** Simple plank crate. */
export function crate(rng: Rng): THREE.BufferGeometry {
  const s = range(rng, 0.55, 0.8);
  const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(s, s, s)];
  // Corner battens.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.06, s + 0.02, 0.06);
      b.translate((sx * s) / 2, 0, (sz * s) / 2);
      parts.push(b);
    }
  }
  const merged = mergeGeometries(parts.map(ni));
  merged.translate(0, s / 2, 0);
  return boxProjectUVs(merged, 1.2);
}

/** Leaning, partly broken picket fence along +X. */
export function brokenFence(rng: Rng, length = 5): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const spacing = 0.22;
  for (let x = 0; x < length; x += spacing) {
    if (rng() < 0.15) continue;
    const h = range(rng, 0.9, 1.4) * (rng() < 0.15 ? 0.5 : 1);
    const p = new THREE.BoxGeometry(0.12, h, 0.05);
    // Pointed top.
    const tip = new THREE.ConeGeometry(0.07, 0.18, 4);
    tip.rotateY(Math.PI / 4);
    tip.translate(0, h / 2 + 0.09, 0);
    const picket = mergeGeometries([ni(p), ni(tip)]);
    picket.translate(0, h / 2, 0);
    picket.rotateZ(range(rng, -0.12, 0.12));
    picket.rotateX(range(rng, -0.08, 0.08));
    picket.translate(x, 0, 0);
    parts.push(picket);
  }
  for (const y of [0.3, 0.8]) {
    const rail = new THREE.BoxGeometry(length, 0.08, 0.05);
    rail.translate(length / 2, y, -0.05);
    rail.rotateZ(range(rng, -0.02, 0.02));
    parts.push(rail);
  }
  const merged = mergeGeometries(parts.map(ni));
  return boxProjectUVs(merged, 1.5);
}

/** Cluster of thorny dead spikes, used as blighted shrubs. */
export function thornShrub(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 6 + Math.floor(rng() * 6);
  for (let i = 0; i < n; i++) {
    const h = range(rng, 0.4, 1.3);
    const c = new THREE.ConeGeometry(range(rng, 0.02, 0.05), h, 5);
    c.translate(0, h / 2, 0);
    c.rotateZ(range(rng, -0.7, 0.7));
    c.rotateY(rng() * Math.PI * 2);
    c.translate(range(rng, -0.2, 0.2), 0, range(rng, -0.2, 0.2));
    parts.push(ni(c));
  }
  const merged = mergeGeometries(parts);
  merged.computeVertexNormals();
  return merged;
}

export interface Lantern {
  group: THREE.Group;
  light: THREE.PointLight;
  flame: THREE.Mesh;
}

/** Iron lantern on a wooden post with a warm point light inside. */
export function lanternPost(rng: Rng, wood: THREE.Material, iron: THREE.Material, height = 2.4): Lantern {
  const group = new THREE.Group();
  const post = new THREE.Mesh(boxProjectUVs(new THREE.BoxGeometry(0.14, height, 0.14), 1.5), wood);
  post.position.y = height / 2;
  post.rotation.z = range(rng, -0.04, 0.04);
  post.castShadow = true;
  group.add(post);
  const arm = new THREE.Mesh(boxProjectUVs(new THREE.BoxGeometry(0.6, 0.08, 0.08), 1.5), wood);
  arm.position.set(0.25, height - 0.15, 0);
  arm.castShadow = true;
  group.add(arm);

  const cage = new THREE.Group();
  cage.position.set(0.48, height - 0.5, 0);
  const frameParts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.025, 0.3, 0.025);
      b.translate(sx * 0.09, 0, sz * 0.09);
      frameParts.push(ni(b));
    }
  }
  const top = new THREE.ConeGeometry(0.16, 0.14, 4);
  top.rotateY(Math.PI / 4);
  top.translate(0, 0.22, 0);
  frameParts.push(ni(top));
  const base = new THREE.BoxGeometry(0.22, 0.03, 0.22);
  base.translate(0, -0.15, 0);
  frameParts.push(ni(base));
  const hook = new THREE.BoxGeometry(0.02, 0.12, 0.02);
  hook.translate(0, 0.33, 0);
  frameParts.push(ni(hook));
  const frame = new THREE.Mesh(mergeGeometries(frameParts), iron);
  frame.castShadow = true;
  cage.add(frame);

  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.9, 0.6) }),
  );
  flame.scale.y = 1.5;
  cage.add(flame);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.27, 0.17),
    new THREE.MeshStandardMaterial({
      color: 0xffb070,
      emissive: new THREE.Color(1.0, 0.45, 0.12),
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.35,
      roughness: 0.2,
      depthWrite: false,
    }),
  );
  cage.add(glass);
  group.add(cage);

  const light = new THREE.PointLight(0xff8a3a, 30, 10, 2);
  light.position.copy(cage.position);
  group.add(light);
  return { group, light, flame };
}
