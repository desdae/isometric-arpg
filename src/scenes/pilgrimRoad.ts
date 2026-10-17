import * as THREE from 'three';
import { loading } from '../engine/Loading';
import { bakeSurfaces, pbrMaterial } from '../procgen/textures';
import { maskTexture, splatMaterial } from '../procgen/splat';
import { fbm2, mulberry32, range, smoothstep, type Rng } from '../procgen/noise';
import { rock, thornShrub } from '../procgen/geometry';
import { terrainMesh, type HeightFn } from '../procgen/terrain';
import { MeshBuilder, xf } from '../procgen/builder';
import { grassTuft } from '../procgen/props';
import { gibbet, hangingCage, skeleton, CAGE_FLOOR_Y } from '../procgen/torture';
import { bellShrine, candleTray, CANDLE_LIGHT_Y, CART_CANDLE, convent, gnarledTree, graveMarker, handcart, kerbStones, moundCottage, ossuaryPorch } from '../procgen/pilgrim';
import { Fire } from '../engine/Fire';
import { LightPool } from '../engine/LightPool';
import { buildWaypoint } from '../world/Waypoint';
import { NavGrid } from '../world/NavGrid';
import { Crows } from '../world/Crows';
import { createNightScene, type World } from '../world/World';
import type { MonsterKind, MonsterSpawn } from '../actors/Monster';
import { installCutaway } from '../engine/cutaway';
import { tiledInstances } from '../procgen/tiles';
import { audio } from '../audio/Audio';

// The Pilgrim Road: the old way up to the convent of the Silent Sisters. A
// cobbled road with worn kerbstones winds north between grey turf mounds and
// dead orchards, past cottages dug into the hillsides, black slabs of red
// pilgrim candles still burning on the verges, handcarts left where they
// stopped and gibbets nobody took down. Carrion crows strut on the cobbles.
// Ash-grey fog lies in the hollows under a low orange moon, and at the end
// of the road the dead convent stands on its rise, the way into its ossuary
// open at its feet.

const SIZE = 200;
const HALF = SIZE / 2;
/** Grid step of the precomputed road distance field. */
const STEP = 0.5;
const N = Math.round(SIZE / STEP) + 1;
const ROAD_HALF = 2.4;
/** The convent's west front, facing down the road. */
const CONVENT = new THREE.Vector3(0, 0, -100);
const FORECOURT_Z = -70;

/**
 * What the road's metal and wet stone reflect: a grey-green overcast, paler
 * toward the horizon, with the orange moon low in the north.
 */
function ashenSky(): THREE.CubeTexture {
  const faces: HTMLCanvasElement[] = [];
  // Face order +X, -X, +Y, -Y, +Z, -Z; each pixel's direction picks its colour.
  const dirs: ((a: number, b: number) => THREE.Vector3)[] = [
    (a, b) => new THREE.Vector3(1, -b, -a),
    (a, b) => new THREE.Vector3(-1, -b, a),
    (a, b) => new THREE.Vector3(a, 1, b),
    (a, b) => new THREE.Vector3(a, -1, -b),
    (a, b) => new THREE.Vector3(a, -b, 1),
    (a, b) => new THREE.Vector3(-a, -b, -1),
  ];
  const moonDir = new THREE.Vector3(0.1, 0.25, -1).normalize();
  const N = 32;
  for (const dir of dirs) {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    const img = g.createImageData(N, N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const d = dir(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1).normalize();
        const y = d.y;
        let r = y > 0 ? 0.2 - y * 0.08 : 0.08 + y * 0.06;
        let gr = y > 0 ? 0.24 - y * 0.09 : 0.08 + y * 0.06;
        let b = y > 0 ? 0.24 - y * 0.08 : 0.075 + y * 0.06;
        const m = Math.pow(Math.max(0, d.dot(moonDir)), 24);
        r += m * 1.4;
        gr += m * 0.7;
        b += m * 0.2;
        const k = (i + j * N) * 4;
        img.data[k] = Math.min(255, Math.max(0, r * 255));
        img.data[k + 1] = Math.min(255, Math.max(0, gr * 255));
        img.data[k + 2] = Math.min(255, Math.max(0, b * 255));
        img.data[k + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    faces.push(c);
  }
  const tex = new THREE.CubeTexture(faces);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export async function buildPilgrimRoad(seed = 31): Promise<World> {
  const rng = mulberry32(seed);
  const { scene, moon } = createNightScene();
  // Ash-grey fog and a low orange moon instead of the blood-red sky.
  scene.fog = new THREE.FogExp2(0x3a4543, 0.017);
  scene.traverse((o) => {
    if ((o as THREE.HemisphereLight).isHemisphereLight) {
      const h = o as THREE.HemisphereLight;
      h.color.setRGB(0.5, 0.58, 0.6);
      h.groundColor.setRGB(0.12, 0.1, 0.09);
      h.intensity = 1.25;
    }
  });
  scene.environment = ashenSky();
  moon.color.setRGB(1.0, 0.6, 0.3);
  moon.intensity = 2.6;

  await loading.step('Baking cobbles, turf and slate', 0.02);
  const [stoneSet, trimSet, woodSet, barkSet, soilSet, cobbleSet, rockSet, turfSet, slateSet, plankSet] = await bakeSurfaces([
    { kind: 'stoneBricks', seed: seed + 1, size: 512, normalStrength: 5 },
    { kind: 'roughStone', seed: seed + 2, size: 512, normalStrength: 6 },
    { kind: 'woodPlanks', seed: seed + 3, size: 256, normalStrength: 4 },
    { kind: 'deadBark', seed: seed + 4, size: 256, normalStrength: 7 },
    { kind: 'redSoil', seed: seed + 5, size: 1024, normalStrength: 5 },
    { kind: 'setts', seed: seed + 6, size: 1024, normalStrength: 9 },
    { kind: 'roughStone', seed: seed + 7, size: 512, normalStrength: 7 },
    { kind: 'turf', seed: seed + 8, size: 1024, normalStrength: 5 },
    { kind: 'slate', seed: seed + 9, size: 512, normalStrength: 5 },
    { kind: 'woodPlanks', seed: seed + 10, size: 256, normalStrength: 5 },
  ]);
  const wax = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.5, 0.025, 0.02), emissive: new THREE.Color(0.16, 0.01, 0.005), roughness: 0.35 });
  const mats: Record<string, THREE.Material> = {
    stone: pbrMaterial(stoneSet, 1, { color: new THREE.Color(0.62, 0.66, 0.68) }),
    trim: pbrMaterial(trimSet, 1, { color: new THREE.Color(0.6, 0.63, 0.64) }),
    wood: pbrMaterial(woodSet, 1, { color: new THREE.Color(0.55, 0.45, 0.38) }),
    plank: pbrMaterial(plankSet, 1, { color: new THREE.Color(0.42, 0.24, 0.15) }),
    door: pbrMaterial(plankSet, 1.5, { color: new THREE.Color(0.5, 0.27, 0.15) }),
    slate: pbrMaterial(slateSet, 1, { color: new THREE.Color(0.48, 0.52, 0.56) }),
    bark: pbrMaterial(barkSet, 1, { color: new THREE.Color(0.32, 0.26, 0.24) }),
    rock: pbrMaterial(rockSet, 1, { color: new THREE.Color(0.55, 0.57, 0.58) }),
    iron: new THREE.MeshStandardMaterial({ color: 0x1d1c1e, roughness: 0.5, metalness: 0.85 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x3a2018, roughness: 0.8, metalness: 0.4 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x6a4a22, roughness: 0.4, metalness: 0.9 }),
    tray: new THREE.MeshStandardMaterial({ color: 0x0c0b0c, roughness: 0.3, metalness: 0.2 }),
    wax,
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.6, 0.4), fog: false }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(2.6, 0.25, 0.12), roughness: 1 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x040303 }),
    bone: new THREE.MeshStandardMaterial({ color: 0x8c8370, roughness: 0.65 }),
    gore: new THREE.MeshStandardMaterial({ color: 0x2a0606, roughness: 0.25 }),
    coal: new THREE.MeshStandardMaterial({ color: 0x110805, emissive: new THREE.Color(2.4, 0.45, 0.08), roughness: 1 }),
    cloth: new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95, side: THREE.DoubleSide }),
  };
  for (const k of ['stone', 'trim', 'wood', 'plank', 'door', 'slate']) installCutaway(mats[k]);

  await loading.step('Laying the pilgrim road', 0.3);
  // ---- The road ------------------------------------------------------------
  // A winding line from the gaol stair in the south to the convent forecourt.
  const ctrl = [
    [6, 92], [4, 80], [-8, 66], [-14, 52], [-6, 36], [10, 24], [16, 8], [6, -8], [-10, -20], [-18, -34], [-12, -48], [2, -58], [4, FORECOURT_Z + 2], [0, FORECOURT_Z - 6],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z));
  const roadCurve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const road = roadCurve.getSpacedPoints(700);
  const roadLen = roadCurve.getLength();
  // Distance to the road centre line on a grid (capped at CAP metres).
  const CAP = 16;
  const field = new Float32Array(N * N).fill(CAP);
  for (let i = 0; i < road.length - 1; i++) {
    const a = road[i];
    const b = road[i + 1];
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - CAP + HALF) / STEP));
    const x1 = Math.min(N - 1, Math.ceil((Math.max(a.x, b.x) + CAP + HALF) / STEP));
    const z0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - CAP + HALF) / STEP));
    const z1 = Math.min(N - 1, Math.ceil((Math.max(a.z, b.z) + CAP + HALF) / STEP));
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const ll = dx * dx + dz * dz || 1;
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const px = gx * STEP - HALF;
        const pz = gz * STEP - HALF;
        const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / ll));
        const d = Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
        const k = gz * N + gx;
        if (d < field[k]) field[k] = d;
      }
    }
  }
  const roadDist = (x: number, z: number) => {
    const fx = Math.max(0, Math.min(N - 1.001, (x + HALF) / STEP));
    const fz = Math.max(0, Math.min(N - 1.001, (z + HALF) / STEP));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const k = iz * N + ix;
    return (field[k] * (1 - tx) + field[k + 1] * tx) * (1 - tz) + (field[k + N] * (1 - tx) + field[k + N + 1] * tx) * tz;
  };
  /** A point beside the road at arc fraction `u`, `off` metres to its right (negative: left), facing the road. */
  const verge = (u: number, off: number) => {
    const p = roadCurve.getPointAt(u);
    const t = roadCurve.getTangentAt(u);
    const right = new THREE.Vector3(-t.z, 0, t.x);
    const q = p.clone().addScaledVector(right, off);
    return { pos: q, face: Math.atan2(-right.x * Math.sign(off), -right.z * Math.sign(off)), along: Math.atan2(t.x, t.z) };
  };

  // ---- Where things stand ---------------------------------------------------
  // Cottages dug into mounds on alternating sides, facing the road.
  const cottageAt = [0.1, 0.24, 0.37, 0.52, 0.66, 0.8];
  const cottages = cottageAt.map((u, i) => {
    const side = i % 2 ? 1 : -1;
    const v = verge(u, side * range(rng, 9.5, 11));
    // Turned toward the road but mostly toward the camera (which looks north
    // from the south), so the doors, windows and porch roofs read as in the art.
    const yaw = Math.atan2(Math.sin(v.face) * 0.6, Math.cos(v.face) * 0.6 + 1.2);
    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-4.2);
    return { pos: v.pos, yaw, mound: v.pos.clone().add(back), u, side };
  });
  // Rolling hills and orchard hollows away from the road.
  const hills = Array.from({ length: 26 }, () => {
    for (let t = 0; t < 40; t++) {
      const x = range(rng, -HALF + 6, HALF - 6);
      const z = range(rng, -62, HALF - 6);
      const r = range(rng, 6, 13);
      if (roadDist(x, z) < r + 4) continue;
      if (cottages.some((c) => Math.hypot(c.mound.x - x, c.mound.z - z) < r + 8)) continue;
      return { x, z, r, h: range(rng, 1.5, 3.8) };
    }
    return { x: 0, z: 0, r: 0, h: 0 };
  }).filter((h) => h.r > 0);
  const orchards = Array.from({ length: 7 }, () => {
    for (let t = 0; t < 60; t++) {
      const x = range(rng, -HALF + 14, HALF - 14);
      const z = range(rng, -60, HALF - 14);
      if (roadDist(x, z) < 12) continue;
      return { x, z, r: range(rng, 8, 13) };
    }
    return { x: 40, z: 0, r: 8 };
  });
  const wp = verge(0.45, -7.5).pos;
  const porch = { pos: new THREE.Vector3(-10, 0, FORECOURT_Z - 4), yaw: 0.35 };
  const stair = verge(0.006, 0).pos.setZ(84);
  const graveyard = (() => {
    const v = verge(0.59, 13);
    return v.pos;
  })();

  // ---- Terrain --------------------------------------------------------------
  const height: HeightFn = (x, z) => {
    let h = fbm2(x * 0.018, z * 0.018, 4, seed + 100) * 2.6 + fbm2(x * 0.09, z * 0.09, 3, seed + 101) * 0.35;
    for (const m of hills) {
      const d = Math.hypot(x - m.x, z - m.z) / m.r;
      if (d < 1) h += m.h * (0.5 + 0.5 * Math.cos(d * Math.PI));
    }
    // Cottage mounds: domes with the cottage front cut into them.
    // Hills rise toward the map edge, closing the road in.
    const edge = Math.max(Math.abs(x), z) - (HALF - 16);
    if (edge > 0) h += edge * edge * 0.035;
    // The road bed and its verges sit flat on the low swell of the land.
    const base = fbm2(x * 0.018, z * 0.018, 4, seed + 100) * 2.6;
    const flat = 1 - smoothstep(ROAD_HALF + 0.8, ROAD_HALF + 7, roadDist(x, z));
    h = h * (1 - flat) + base * flat;
    // Pads: forecourt, waypoint, porch, cottage fronts, the gaol stair.
    const pads: [number, number, number, number][] = [
      [0, FORECOURT_Z - 6, 13, 22],
      [wp.x, wp.z, 4, 8],
      [porch.pos.x, porch.pos.z, 5, 9],
      [stair.x, stair.z, 4, 8],
    ];
    for (const [px, pz, r0, r1] of pads) {
      const k = 1 - smoothstep(r0, r1, Math.hypot(x - px, z - pz));
      h = h * (1 - k) + base * k;
    }
    // Cottage mounds go on last so the road's flattening can't level them: a
    // dome behind each cottage, cut off sharply along the cottage's front wall.
    for (const c of cottages) {
      const d = Math.hypot(x - c.mound.x, z - c.mound.z) / 6.5;
      if (d >= 1) continue;
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      // Signed distance in front of the wall (positive toward the road).
      const front = (x - c.pos.x) * fx + (z - c.pos.z) * fz;
      const side = Math.abs((x - c.pos.x) * fz - (z - c.pos.z) * fx);
      const cut = 1 - smoothstep(-0.6, 0.6, front) * (1 - smoothstep(2.2, 3.4, side));
      h += 4.4 * Math.pow(0.5 + 0.5 * Math.cos(d * Math.PI), 0.7) * cut;
    }
    // Behind the forecourt the convent's rise.
    if (z < FORECOURT_Z - 10) h += smoothstep(FORECOURT_Z - 10, FORECOURT_Z - 18, z) * 1.2;
    return h;
  };

  const turfAmount = (x: number, z: number) => {
    const d = roadDist(x, z);
    const n = fbm2(x * 0.12, z * 0.12, 3, seed + 70);
    // Turf on the rises and away from the road; bare red soil on the verges and in trodden patches.
    const away = smoothstep(ROAD_HALF + 1.5, ROAD_HALF + 5.5, d + n * 2.5);
    const rise = smoothstep(0.6, 2.2, height(x, z) - fbm2(x * 0.018, z * 0.018, 4, seed + 100) * 2.6);
    return Math.max(away * smoothstep(-0.65, -0.3, n), rise);
  };
  const mask = maskTexture(512, (u, v) => {
    const x = -HALF + u * SIZE;
    const z = -HALF + v * SIZE;
    const n = fbm2(x * 0.3, z * 0.3, 3, seed + 60) * 0.35;
    const cob = 1 - smoothstep(ROAD_HALF - 0.4, ROAD_HALF + 0.1, roadDist(x, z) + n);
    const court = (1 - smoothstep(9, 12, Math.hypot((x - 0) * 0.8, z - (FORECOURT_Z - 6)) + n * 4)) * 0.9;
    const blood = smoothstep(0.55, 0.85, fbm2(x * 0.08, z * 0.08, 4, seed + 80) + fbm2(x * 0.4, z * 0.4, 3, seed + 81) * 0.25) * 0.35;
    const wet = smoothstep(0.1, 0.6, fbm2(x * 0.05 + 5, z * 0.05, 4, seed + 90)) * 0.45 + cob * 0.15;
    return [Math.max(cob, court), blood, wet];
  });
  const turfMask = maskTexture(512, (u, v) => [turfAmount(-HALF + u * SIZE, -HALF + v * SIZE), 0, 0]);
  await loading.step('Shaping the hills', 0.36);
  for (const s of [soilSet, turfSet]) s.map.anisotropy = 4;
  const ground = terrainMesh(height, -HALF, -HALF, SIZE, 330, splatMaterial(soilSet, 55, cobbleSet, 90, mask, { set: turfSet, repeat: 40, mask: turfMask }));
  (ground.material as THREE.MeshStandardMaterial).color.setRGB(1, 1, 1);
  scene.add(ground);
  // Turfed hills beyond the edge of the walkable land, so the camera never
  // looks past the end of the world. Sunk a little so the real ground wins.
  {
    const skirtH: HeightFn = (x, z) => {
      const out = Math.max(Math.abs(x), Math.abs(z)) - HALF;
      return Math.min(height(THREE.MathUtils.clamp(x, -HALF, HALF), THREE.MathUtils.clamp(z, -HALF, HALF)) + Math.max(0, out) * 0.35, 18) - 0.25;
    };
    const skirt = terrainMesh(skirtH, -HALF - 50, -HALF - 50, SIZE + 100, 140, pbrMaterial(turfSet, 70));
    scene.add(skirt);
  }

  await loading.step('Shaping the hills', 0.4);
  const nav = new NavGrid(-HALF, -HALF, SIZE, SIZE, 0.5);
  // Too steep to climb: the hills at the map edge and the mound tops.
  for (let gz = -HALF; gz < HALF; gz += 0.5) {
    for (let gx = -HALF; gx < HALF; gx += 0.5) {
      const edge = Math.max(Math.abs(gx), gz) > HALF - 12 || gz < FORECOURT_Z - 13;
      const slope = Math.hypot(height(gx + 0.5, gz) - height(gx - 0.5, gz), height(gx, gz + 0.5) - height(gx, gz - 0.5));
      if (edge || slope > 0.95) nav.blockCircle(gx, gz, 0.3);
    }
  }
  // The stair down to the gaol is at the south edge: let the hero reach it.
  nav.unblockRect(stair.x, stair.z - 1, 3, 4);

  await loading.step('Raising the convent', 0.45);
  // ---- The convent and the ossuary porch -------------------------------------
  {
    const b = new MeshBuilder();
    b.addBuilder(convent(rng), xf(CONVENT.x, height(0, FORECOURT_Z - 12) - 0.3, CONVENT.z, 0));
    scene.add(b.build(mats));
    const pb = new MeshBuilder();
    pb.addBuilder(ossuaryPorch(rng), xf(porch.pos.x, height(porch.pos.x, porch.pos.z) - 0.1, porch.pos.z, porch.yaw));
    scene.add(pb.build(mats));
    nav.blockBox(porch.pos.x, porch.pos.z, 2.9, 3.0, porch.yaw);
    const door = porch.pos.clone().add(new THREE.Vector3(Math.sin(porch.yaw), 0, Math.cos(porch.yaw)).multiplyScalar(2.3));
    nav.unblockRect(door.x, door.z, 0.7, 0.7);
  }
  const porchFront = porch.pos.clone().add(new THREE.Vector3(Math.sin(porch.yaw), 0, Math.cos(porch.yaw)).multiplyScalar(2.6));

  // The gaol stair: a sunken stone well with steps going down, low walls round it.
  {
    const b = new MeshBuilder();
    const y = height(stair.x, stair.z);
    const m = xf(stair.x, y, stair.z, Math.PI);
    for (let k = 0; k < 6; k++) b.add('stone', new THREE.BoxGeometry(2.2, 0.24, 0.5), m.clone().multiply(xf(0, -0.12 - k * 0.24, 0.5 + k * 0.5)));
    for (const s of [-1, 1]) b.add('stone', new THREE.BoxGeometry(0.5, 0.9, 3.6), m.clone().multiply(xf(s * 1.35, 0.2, 1.6)));
    b.add('stone', new THREE.BoxGeometry(3.2, 0.9, 0.5), m.clone().multiply(xf(0, 0.2, 3.5)));
    b.add('dark', new THREE.PlaneGeometry(2.2, 2).rotateX(-Math.PI / 2), m.clone().multiply(xf(0, -1.5, 2.6)), 0);
    scene.add(b.build(mats));
  }

  await loading.step('Lighting the pilgrim candles', 0.5);
  // ---- Candles, shrines, carts, gibbets ---------------------------------------
  const candlePool = new LightPool(scene, 8, 0xff3818);
  const placeBuilder = (bld: MeshBuilder, x: number, z: number, yaw: number, dy = 0) => {
    const g = bld.build(mats);
    g.position.set(x, height(x, z) + dy, z);
    g.rotation.y = yaw;
    scene.add(g);
    return g;
  };
  const props: { x: number; z: number; r: number }[] = [];
  const clear = (x: number, z: number, r: number) => props.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r);
  // Trays of red candles along both verges.
  const trays: THREE.Vector3[] = [];
  for (let s = 6, i = 0; s < roadLen - 6; s += range(rng, 9, 14), i++) {
    const u = s / roadLen;
    const side = (i % 2 ? 1 : -1) * (rng() < 0.2 ? -1 : 1);
    const v = verge(u, side * range(rng, ROAD_HALF + 1.3, ROAD_HALF + 2.6));
    if (!clear(v.pos.x, v.pos.z, 1)) continue;
    placeBuilder(candleTray(rng, 2 + Math.floor(rng() * 3)), v.pos.x, v.pos.z, v.along + range(rng, -0.3, 0.3));
    nav.blockCircle(v.pos.x, v.pos.z, 0.5);
    props.push({ x: v.pos.x, z: v.pos.z, r: 1 });
    trays.push(v.pos.clone());
    candlePool.add(new THREE.Vector3(v.pos.x, height(v.pos.x, v.pos.z) + CANDLE_LIGHT_Y, v.pos.z), 9, 7, 0.5);
  }
  // Candles at every cottage door, too.
  for (const c of cottages) {
    for (const k of [-1, 1]) {
      const p = c.pos.clone().add(new THREE.Vector3(Math.cos(c.yaw) * k * 2.4 + Math.sin(c.yaw) * 1.6, 0, -Math.sin(c.yaw) * k * 2.4 + Math.cos(c.yaw) * 1.6));
      if (k > 0 && rng() < 0.5) continue;
      placeBuilder(candleTray(rng, 2 + Math.floor(rng() * 2)), p.x, p.z, c.yaw + range(rng, -0.4, 0.4));
      nav.blockCircle(p.x, p.z, 0.5);
      candlePool.add(new THREE.Vector3(p.x, height(p.x, p.z) + CANDLE_LIGHT_Y, p.z), 9, 7, 0.5);
    }
  }
  // Wayside bell shrines.
  for (const u of [0.17, 0.31, 0.47, 0.62, 0.74, 0.88]) {
    const side = rng() < 0.5 ? -1 : 1;
    const v = verge(u, side * (ROAD_HALF + 2.2));
    if (!clear(v.pos.x, v.pos.z, 1.2)) continue;
    placeBuilder(bellShrine(rng), v.pos.x, v.pos.z, v.face);
    nav.blockCircle(v.pos.x, v.pos.z, 0.55);
    props.push({ x: v.pos.x, z: v.pos.z, r: 1.2 });
  }
  // Handcarts left on the verge.
  const carts: THREE.Vector3[] = [];
  for (const u of [0.07, 0.29, 0.56, 0.83]) {
    const side = rng() < 0.5 ? -1 : 1;
    const v = verge(u, side * (ROAD_HALF + 1.7));
    if (!clear(v.pos.x, v.pos.z, 1.6)) continue;
    const yaw = v.along + range(rng, -0.6, 0.6) + (rng() < 0.5 ? Math.PI : 0);
    placeBuilder(handcart(rng), v.pos.x, v.pos.z, yaw);
    nav.blockBox(v.pos.x, v.pos.z, 0.75, 1.2, yaw);
    props.push({ x: v.pos.x, z: v.pos.z, r: 1.6 });
    const cp = CART_CANDLE.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    candlePool.add(new THREE.Vector3(v.pos.x + cp.x, height(v.pos.x, v.pos.z) + cp.y, v.pos.z + cp.z), 6, 5, 0.6);
    carts.push(v.pos.clone());
  }
  // Gibbets with what is left of the condemned.
  for (const u of [0.13, 0.42, 0.69, 0.92]) {
    const side = rng() < 0.5 ? -1 : 1;
    const v = verge(u, side * range(rng, 6.5, 8));
    if (!clear(v.pos.x, v.pos.z, 2)) continue;
    const g = new MeshBuilder();
    g.addBuilder(gibbet(rng), xf(0, 0, 0, 0, 1.25));
    if (rng() < 0.5) g.addBuilder(hangingCage(rng, { top: 2.5, skeleton: true }), xf(0.1, 0.15 - CAGE_FLOOR_Y + 0.9, 0, 0, 0.8));
    else g.addBuilder(skeleton(rng, 'slumped'), xf(0.7, 0, 0.5, 2.6));
    placeBuilder(g, v.pos.x, v.pos.z, v.along);
    nav.blockBox(v.pos.x, v.pos.z, 1.2, 0.8, v.along);
    props.push({ x: v.pos.x, z: v.pos.z, r: 2 });
  }
  // The roadside graveyard of the hamlet.
  for (let i = 0; i < 16; i++) {
    const x = graveyard.x + (i % 4) * 1.9 - 2.8 + range(rng, -0.3, 0.3);
    const z = graveyard.z + Math.floor(i / 4) * 2.6 - 3.9 + range(rng, -0.3, 0.3);
    if (roadDist(x, z) < ROAD_HALF + 2) continue;
    placeBuilder(graveMarker(rng), x, z, range(rng, -0.25, 0.25));
    nav.blockCircle(x, z, 0.35);
  }
  props.push({ x: graveyard.x, z: graveyard.z, r: 7 });

  await loading.step('Digging the hillside cottages', 0.56);
  for (const c of cottages) {
    placeBuilder(moundCottage(rng), c.pos.x, c.pos.z, c.yaw, -0.05);
    nav.blockBox(c.pos.x - Math.sin(c.yaw) * 0.6, c.pos.z - Math.cos(c.yaw) * 0.6, 2.2, 1.2, c.yaw);
    props.push({ x: c.pos.x, z: c.pos.z, r: 4 });
    // Stepping slabs from the door out to the road.
    const toRoad = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    const slabs = new MeshBuilder();
    for (let d = 1.2; d < 7; d += range(rng, 0.65, 0.85)) {
      const p = c.pos.clone().addScaledVector(toRoad, d);
      if (roadDist(p.x, p.z) < ROAD_HALF + 0.3) break;
      slabs.add('stone', new THREE.BoxGeometry(range(rng, 0.6, 0.85), 0.08, range(rng, 0.4, 0.5)), xf(p.x, height(p.x, p.z) + 0.02, p.z, c.yaw + range(rng, -0.2, 0.2)));
    }
    scene.add(slabs.build(mats));
    // The cottage window and door glow.
    candlePool.add(c.pos.clone().setY(height(c.pos.x, c.pos.z) + 1.6).addScaledVector(toRoad, 0.6), 5, 5, 0.3);
  }
  // Kerbstones along both edges of the cobbles.
  {
    const geos = kerbStones(rng, 4);
    const per = Math.ceil(2 * roadLen / 0.56 / geos.length) + 4;
    const ims = geos.map((g) => {
      const im = new THREE.InstancedMesh(g, mats.trim, per);
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
      return im;
    });
    const m = new THREE.Matrix4();
    for (let s = 0.3; s < roadLen - 2; s += 0.56) {
      const u = s / roadLen;
      for (const side of [-1, 1]) {
        const v = verge(u, side * (ROAD_HALF + 0.12));
        if (v.pos.z < FORECOURT_Z + 2) continue;
        const im = ims[Math.floor(rng() * ims.length)];
        if (im.count >= per) continue;
        m.compose(
          new THREE.Vector3(v.pos.x, height(v.pos.x, v.pos.z) - 0.05, v.pos.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(range(rng, -0.05, 0.05), v.along + Math.PI / 2 + range(rng, -0.1, 0.1), range(rng, -0.06, 0.06))),
          new THREE.Vector3(1, 1, 1),
        );
        im.setMatrixAt(im.count++, m);
      }
    }
    for (const im of ims) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }

  await loading.step('Planting the dead orchards', 0.62);
  // ---- Trees, shrubs, stones, grass ---------------------------------------------
  const free = (x: number, z: number, r: number) =>
    roadDist(x, z) > ROAD_HALF + 1.5 + r &&
    clear(x, z, r) &&
    Math.hypot(x - wp.x, z - wp.z) > 5 + r &&
    Math.hypot(x - porch.pos.x, z - porch.pos.z) > 6 + r &&
    Math.hypot(x - stair.x, z - stair.z) > 4 + r &&
    !(Math.abs(x) < 14 && z < FORECOURT_Z + 4 && z > FORECOURT_Z - 16) &&
    cottages.every((c) => Math.hypot(c.mound.x - x, c.mound.z - z) > 4.5 + r || Math.hypot(c.pos.x - x, c.pos.z - z) > 4 + r);
  const instanced = (geos: THREE.BufferGeometry[], mat: THREE.Material, pts: { x: number; z: number; s: number }[], block: number, cast = true) => {
    const per = Math.ceil(pts.length / geos.length) + 1;
    const meshes = geos.map((g) => {
      const im = new THREE.InstancedMesh(g, mat, per);
      im.count = 0;
      im.castShadow = cast;
      im.receiveShadow = true;
      scene.add(im);
      return im;
    });
    const m = new THREE.Matrix4();
    for (const p of pts) {
      const im = meshes[Math.floor(rng() * meshes.length)];
      if (im.count >= per) continue;
      m.compose(
        new THREE.Vector3(p.x, height(p.x, p.z) - 0.05 * p.s, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(range(rng, -0.06, 0.06), rng() * Math.PI * 2, range(rng, -0.06, 0.06))),
        new THREE.Vector3(p.s, p.s, p.s),
      );
      im.setMatrixAt(im.count++, m);
      if (block > 0) nav.blockCircle(p.x, p.z, block * p.s);
    }
    meshes.forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    });
  };
  const spots = (count: number, r: number, where: (rng: Rng) => [number, number], scale: [number, number]) => {
    const out: { x: number; z: number; s: number }[] = [];
    for (let tries = 0; out.length < count && tries < count * 30; tries++) {
      const [x, z] = where(rng);
      if (!free(x, z, r) || out.some((o) => Math.hypot(o.x - x, o.z - z) < r * 2)) continue;
      out.push({ x, z, s: range(rng, scale[0], scale[1]) });
    }
    return out;
  };
  const anywhere = (g: Rng): [number, number] => [range(g, -HALF + 4, HALF - 4), range(g, FORECOURT_Z - 22, HALF - 4)];
  const inOrchard = (g: Rng): [number, number] => {
    const o = orchards[Math.floor(g() * orchards.length)];
    const a = g() * Math.PI * 2;
    const d = Math.sqrt(g()) * o.r;
    return [o.x + Math.cos(a) * d, o.z + Math.sin(a) * d];
  };
  const nearRoad = (g: Rng): [number, number] => {
    const v = verge(g(), (g() < 0.5 ? -1 : 1) * range(g, ROAD_HALF + 4, ROAD_HALF + 9));
    return [v.pos.x, v.pos.z];
  };
  const treeGeos = Array.from({ length: 7 }, () => gnarledTree(rng, range(rng, 5, 8)));
  const trees = [...spots(60, 2.2, inOrchard, [0.85, 1.2]), ...spots(28, 2.4, nearRoad, [0.9, 1.25]), ...spots(70, 2.6, anywhere, [0.8, 1.3])];
  instanced(treeGeos, mats.bark, trees, 0.32);
  instanced(Array.from({ length: 5 }, () => rock(rng, 1)), mats.rock, spots(90, 0.9, anywhere, [0.3, 1.2]), 0.8);
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0x1e1612, roughness: 0.95 });
  instanced(Array.from({ length: 5 }, () => thornShrub(rng)), shrubMat, spots(380, 0.35, anywhere, [0.7, 1.6]), 0);

  await loading.step('Growing the grey grass', 0.74);
  const grassMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.17, 0.2, 0.17), vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  const wind = { value: 0 };
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float sway = sin(windTime * 1.4 + ip.x * 0.3 + ip.z * 0.2) * 0.5 + sin(windTime * 2.9 + ip.x * 0.8) * 0.2;
        transformed.x += sway * 0.1 * position.y * position.y * 4.0;
        transformed.z += sway * 0.05 * position.y * position.y * 4.0;`,
      );
  };
  {
    const geos = Array.from({ length: 4 }, () => grassTuft(rng));
    const xforms: THREE.Matrix4[] = [];
    const want = 20000;
    for (let tries = 0; xforms.length < want && tries < want * 5; tries++) {
      const x = range(rng, -HALF + 3, HALF - 3);
      const z = range(rng, FORECOURT_Z - 20, HALF - 3);
      const t = turfAmount(x, z);
      if (roadDist(x, z) < ROAD_HALF + 0.6 || rng() > t * 0.9 + 0.05) continue;
      const s = range(rng, 0.6, 1.3);
      xforms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28), new THREE.Vector3(s, s * range(rng, 0.8, 1.3), s)));
    }
    tiledInstances(scene, geos, grassMat, xforms);
  }

  await loading.step('Calling the crows', 0.84);
  const perches = [...trays, ...carts, ...Array.from({ length: 30 }, () => verge(rng(), range(rng, -1.6, 1.6)).pos)];
  const crows = new Crows(height, perches, 26, 7, (at) => audio.crows?.(at));
  scene.add(crows.group);

  await loading.step('Raising the dead', 0.9);
  // ---- Monsters --------------------------------------------------------------------
  // The dead grow thicker toward the convent. Bellringers walk the road in
  // packs, penitents keep vigil at the candles with a few bellringers, the
  // carrion crawlers hunt the orchards, and three named horrors hold the
  // hamlet, the graveyard and the convent forecourt.
  const spawns: MonsterSpawn[] = [];
  let pack = 0;
  const levelAt = (z: number) => 10 + Math.min(3, Math.floor((HALF - 6 - z) / 42));
  const near = (x: number, z: number, r: number) => {
    for (let i = 0; i < 24; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (nav.walkable(px, pz)) return new THREE.Vector3(px, height(px, pz), pz);
    }
    const p = nav.nearestWalkable(x, z);
    return p ? new THREE.Vector3(p.x, height(p.x, p.y), p.y) : null;
  };
  const group = (x: number, z: number, list: [MonsterKind, number][], spread: number, elite?: { kind: MonsterKind; name: string }) => {
    pack++;
    for (const [kind, count] of list) {
      for (let i = 0; i < count; i++) {
        const p = near(x, z, kind === 'penitent' ? 1.5 : spread);
        if (!p) continue;
        const isElite = !!elite && elite.kind === kind && i === 0;
        spawns.push({ kind, pos: p, level: levelAt(z) + (isElite ? 1 : 0), pack, wander: kind === 'penitent' ? 1 : 4, elite: isElite ? elite!.name : undefined });
      }
    }
  };
  const startSafe = (x: number, z: number) => Math.hypot(x - stair.x, z - stair.z) > 22;
  // Road packs.
  for (let s = 26; s < roadLen - 10; s += range(rng, 16, 22)) {
    const v = verge(s / roadLen, range(rng, -3, 3));
    if (!startSafe(v.pos.x, v.pos.z) || Math.hypot(v.pos.x - wp.x, v.pos.z - wp.z) < 10) continue;
    const roll = rng();
    if (roll < 0.55) group(v.pos.x, v.pos.z, [['bellringer', 3 + Math.floor(rng() * 3)]], 4);
    else if (roll < 0.8) group(v.pos.x, v.pos.z, [['penitent', 1], ['bellringer', 2 + Math.floor(rng() * 2)]], 4);
    else group(v.pos.x, v.pos.z, [['carrion', 1], ['bellringer', 2]], 4);
  }
  // Vigils at the candle trays away from the road packs.
  for (const t of trays) {
    if (rng() > 0.25 || !startSafe(t.x, t.z)) continue;
    group(t.x, t.z, [['penitent', 1]], 1.5);
  }
  // Orchard hunters.
  for (const o of orchards) {
    if (!startSafe(o.x, o.z)) continue;
    group(o.x, o.z, [['carrion', 1 + (rng() < 0.5 ? 1 : 0)]], o.r * 0.6);
  }
  // Wandering packs off the road.
  for (let i = 0; i < 6; i++) {
    const [x, z] = anywhere(rng);
    if (!startSafe(x, z) || !nav.walkable(x, z) || roadDist(x, z) < 10) continue;
    group(x, z, [['bellringer', 3 + Math.floor(rng() * 2)]], 5);
  }
  // Named champions.
  {
    const h = cottages[2];
    group(h.pos.x + Math.sin(h.yaw) * 4, h.pos.z + Math.cos(h.yaw) * 4, [['bellringer', 4]], 4, { kind: 'bellringer', name: 'Sexton Grul, the Bell-Keeper' });
    group(graveyard.x, graveyard.z, [['penitent', 2], ['bellringer', 2]], 5, { kind: 'penitent', name: 'Mother Ilse, the Unshriven' });
    group(porchFront.x + 6, porchFront.z + 8, [['carrion', 1], ['bellringer', 3], ['penitent', 1]], 5, { kind: 'carrion', name: 'The Tithe-Taker' });
  }

  const waypoint = buildWaypoint(scene, height, nav, wp.x, wp.z, mats.stone, seed + 61);
  const start = verge(0.075, 0).pos;
  const startYaw = Math.atan2(...((): [number, number] => {
    const t = roadCurve.getTangentAt(0.075);
    return [t.x, t.z];
  })());

  return {
    scene,
    moon,
    ground,
    heightAt: height,
    nav,
    spawn: new THREE.Vector3(start.x, height(start.x, start.z), start.z),
    spawnYaw: startYaw,
    title: 'The Pilgrim Road',
    subtitle: 'The candles still burn for pilgrims who will never come',
    exits: [
      { pos: stair.clone().setZ(stair.z + 1.5), radius: 1.4, to: 'swamp', entry: 'gaol', label: 'Back down to the Mire' },
      { pos: porchFront.clone().addScaledVector(new THREE.Vector3(Math.sin(porch.yaw), 0, Math.cos(porch.yaw)), -0.6), radius: 0.9, to: 'ossuary', entry: 'start', label: 'Descend into the Ossuary' },
    ],
    entries: {
      gaol: { pos: new THREE.Vector3(start.x, 0, start.z), yaw: startYaw },
      ossuary: { pos: porchFront.clone().addScaledVector(new THREE.Vector3(Math.sin(porch.yaw), 0, Math.cos(porch.yaw)), 3.4), yaw: porch.yaw },
    },
    monsterSpawns: spawns,
    waypoint,
    cameraYaw: THREE.MathUtils.degToRad(10),
    extent: HALF,
    sky: 'ashen',
    mistColor: new THREE.Color(0.34, 0.39, 0.38),
    update(dt, t) {
      wind.value = t;
      Fire.tick(t);
      candlePool.update(t);
      waypoint.update(t);
      crows.update(dt, t, heroPos.current);
      wax.emissive.setRGB(0.16 + Math.sin(t * 7.3) * 0.015, 0.01, 0.005);
    },
    trackHero(p: THREE.Vector3) {
      heroPos.current.copy(p);
    },
  };
}

const heroPos = { current: new THREE.Vector3() };
