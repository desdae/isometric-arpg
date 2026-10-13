import * as THREE from 'three';
import { MeshBuilder, xf } from '../procgen/builder';
import { mulberry32, range, type Rng } from '../procgen/noise';
import type { HeightFn } from '../procgen/terrain';
import type { NavGrid } from './NavGrid';

// A waypoint: a low octagonal dais ringed by four rune-cut obelisks, with a
// crystal turning above a ring of runes. Cold blue against the red night so
// it reads from across an area. Dim until the hero has found it; once found,
// the runes burn and a pale column of light rises from it.

export interface Waypoint {
  pos: THREE.Vector3;
  setActive(on: boolean): void;
  update(t: number): void;
}

const BLUE = new THREE.Color(0.42, 0.72, 1.6);
const PILLAR_R = 1.75;

/** Ring of scratched runes on black, for additive blending. */
function runeTexture(rng: Rng): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  const circle = (r: number, w: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  };
  circle(S * 0.47, 5);
  circle(S * 0.36, 3);
  circle(S * 0.17, 4);
  // Glyphs between the two outer circles: a few strokes each on a 3x3 lattice.
  const n = 18;
  for (let i = 0; i < n; i++) {
    g.save();
    g.rotate((i / n) * Math.PI * 2);
    g.translate(0, -S * 0.415);
    g.lineWidth = 4;
    const p = () => [(Math.floor(rng() * 3) - 1) * 9, (Math.floor(rng() * 3) - 1) * 13] as const;
    g.beginPath();
    for (let k = 0, m = 2 + Math.floor(rng() * 3); k < m; k++) {
      const [ax, ay] = p();
      const [bx, by] = p();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
    }
    g.stroke();
    g.restore();
  }
  // An eight-pointed star joining the inner circles.
  g.lineWidth = 3;
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const a = (i * 3 * Math.PI * 2) / 8;
    const r = S * 0.36;
    if (i === 0) g.moveTo(Math.sin(a) * r, -Math.cos(a) * r);
    else g.lineTo(Math.sin(a) * r, -Math.cos(a) * r);
  }
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Soft glow falling off from the centre, for the floor pool and the light column. */
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const additive = (map: THREE.Texture, opacity = 1) =>
  new THREE.MeshBasicMaterial({ map, color: BLUE, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

/**
 * Builds a waypoint at (x, z) and blocks its obelisks on the nav grid; the
 * dais itself stays walkable. `stone` is the area's own stone material.
 */
export function buildWaypoint(scene: THREE.Scene, heightAt: HeightFn, nav: NavGrid | undefined, x: number, z: number, stone: THREE.Material, seed = 7): Waypoint {
  const rng = mulberry32(seed);
  // Sit the dais on the lowest ground under it so no edge floats.
  let low = Infinity;
  let high = -Infinity;
  for (let a = 0; a < 8; a++) {
    const h = heightAt(x + Math.cos(a * 0.785) * 2.1, z + Math.sin(a * 0.785) * 2.1);
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  const top = Math.max(heightAt(x, z), high) + 0.06;
  const base = low - 0.2;

  const group = new THREE.Group();
  group.position.set(x, 0, z);
  scene.add(group);

  const b = new MeshBuilder();
  const oct = (r: number, y0: number, y1: number) => new THREE.CylinderGeometry(r, r * 1.04, y1 - y0, 8).translate(0, (y0 + y1) / 2, 0);
  b.add('stone', oct(2.25, base, top - 0.1), xf(0, 0, 0, Math.PI / 8));
  b.add('stone', oct(1.95, top - 0.12, top), xf(0, 0, 0, Math.PI / 8));
  // Obelisks on the diagonals, chipped and leaning a touch.
  const slits: THREE.Matrix4[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const px = Math.cos(a) * PILLAR_R;
    const pz = Math.sin(a) * PILLAR_R;
    const h = range(rng, 1.45, 1.75);
    const lean = range(rng, -0.04, 0.04);
    const yaw = -a + Math.PI / 2;
    b.add('stone', new THREE.BoxGeometry(0.5, 0.18, 0.5), xf(px, top + 0.09, pz, yaw));
    const shaft = new THREE.CylinderGeometry(0.13, 0.2, h, 4, 1).rotateY(Math.PI / 4);
    b.add('stone', shaft, xf(px, top + 0.18 + h / 2, pz, yaw, 1, 1, 1, lean, lean));
    b.add('stone', new THREE.ConeGeometry(0.15, 0.3, 4).rotateY(Math.PI / 4), xf(px, top + 0.18 + h + 0.15, pz, yaw, 1, 1, 1, lean, lean));
    // A rune slit facing the centre.
    slits.push(xf(px * 0.9, top + 0.18 + h * 0.55, pz * 0.9, yaw, 1, 1, 1, lean, lean));
    nav?.blockCircle(x + px, z + pz, 0.42);
  }
  const body = b.build({ stone });
  group.add(body);

  const runeMat = additive(runeTexture(rng));
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 3.7).rotateX(-Math.PI / 2), runeMat);
  ring.position.y = top + 0.012;
  ring.renderOrder = 2;
  group.add(ring);

  const glowTex = glowTexture();
  const poolMat = additive(glowTex, 0.5);
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), poolMat);
  pool.position.y = top + 0.02;
  pool.renderOrder = 3;
  group.add(pool);

  const slitMat = new THREE.MeshBasicMaterial({ color: BLUE.clone(), fog: false });
  const slitGeo = new THREE.BoxGeometry(0.05, 0.42, 0.05);
  for (const m of slits) {
    const s = new THREE.Mesh(slitGeo, slitMat);
    s.applyMatrix4(m);
    group.add(s);
  }

  // The crystal: a stretched octahedron with a brighter core.
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0x0a1420, emissive: BLUE.clone(), emissiveIntensity: 1, roughness: 0.15, metalness: 0.1, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0).scale(1, 1.9, 1), crystalMat);
  crystal.position.y = top + 1.55;
  crystal.castShadow = true;
  group.add(crystal);

  // Column of light, crossed planes so it reads from any camera angle.
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: BLUE, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beam = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 7), beamMat);
    p.rotation.y = (i * Math.PI) / 2;
    beam.add(p);
  }
  beam.position.y = top + 3.5;
  beam.renderOrder = 4;
  group.add(beam);

  const light = new THREE.PointLight(BLUE, 0, 9, 1.6);
  light.position.y = top + 1.6;
  group.add(light);

  let active = false;
  let level = 0;
  let last = 0;
  return {
    pos: new THREE.Vector3(x, top, z),
    setActive(on) {
      active = on;
    },
    update(t) {
      const dt = Math.min(0.1, Math.max(0, t - last));
      last = t;
      level += ((active ? 1 : 0) - level) * Math.min(1, dt * 2.5);
      const pulse = 0.85 + 0.15 * Math.sin(t * 2.1);
      const k = 0.18 + 0.82 * level;
      runeMat.opacity = k * pulse;
      poolMat.opacity = 0.12 + 0.4 * level * pulse;
      slitMat.color.copy(BLUE).multiplyScalar(0.25 + 0.75 * level * pulse);
      crystalMat.emissiveIntensity = 0.3 + 1.1 * level * pulse;
      beamMat.opacity = 0.32 * level * pulse;
      light.intensity = 6 * level * pulse;
      ring.rotation.y = t * 0.06;
      crystal.rotation.y = t * 0.9;
      crystal.position.y = top + 1.55 + Math.sin(t * 1.4) * 0.08 * (0.3 + level);
    },
  };
}

/** Vertical fade: bright at the foot, gone at the top, soft at the sides. */
function beamTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) {
    const v = Math.pow(y / 255, 1.6);
    for (let x = 0; x < 64; x++) {
      const u = 1 - Math.abs(x / 31.5 - 1);
      const a = v * Math.pow(Math.max(0, u), 2.2) * 255;
      const i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = a;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

/**
 * A random spot for a waypoint: the dais and a ring around it walkable, and
 * `ok` agreeing. Falls back to the last candidate tried.
 */
export function findWaypointSpot(rng: Rng, nav: NavGrid, half: number, ok: (x: number, z: number) => boolean, tries = 400): THREE.Vector2 {
  let x = 0;
  let z = 0;
  for (let i = 0; i < tries; i++) {
    x = range(rng, -half, half);
    z = range(rng, -half, half);
    if (!ok(x, z)) continue;
    let clear = nav.walkable(x, z);
    for (let a = 0; clear && a < 12; a++) {
      for (const r of [1.2, 2.4, 3.4]) {
        if (!nav.walkable(x + Math.cos(a * 0.5236) * r, z + Math.sin(a * 0.5236) * r)) clear = false;
      }
    }
    if (clear) return new THREE.Vector2(x, z);
  }
  return new THREE.Vector2(x, z);
}
