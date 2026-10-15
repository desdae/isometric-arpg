import * as THREE from 'three';
import { loading } from '../engine/Loading';
import { bakeSurfaces, pbrMaterial } from '../procgen/textures';
import { maskTexture, splatMaterial } from '../procgen/splat';
import { fbm2, mulberry32, range, smoothstep, type Rng } from '../procgen/noise';
import { deadTree, rock, ruinedWall, thornShrub } from '../procgen/geometry';
import { terrainMesh, type HeightFn } from '../procgen/terrain';
import { MeshBuilder, xf } from '../procgen/builder';
import { curtainWall, gatehouse, pinnacle, pointedArch, spireTower } from '../procgen/gothic';
import { bones, brazier, brokenWagon, grassTuft, stakes } from '../procgen/props';
import { Fire } from '../engine/Fire';
import { LightPool } from '../engine/LightPool';
import { buildWaypoint } from '../world/Waypoint';
import { NavGrid } from '../world/NavGrid';
import { createNightScene, type World } from '../world/World';
import type { MonsterSpawn } from '../actors/Monster';
import { installCutaway } from '../engine/cutaway';
import { mountainRim } from '../procgen/mountains';
import { tiledInstances } from '../procgen/tiles';

// The first combat zone: a blighted wasteland outside the spired walls of the
// town. A cobbled road leaves the gatehouse and peters out into cracked earth
// strewn with wreckage, stakes, bones, thorns and dead grass, under red mist.

const SIZE = 140;
const HALF = SIZE / 2;
const WALL_X = -42;
/** The ruined gate east, through a pass in the mountains, to the Bleeding Mire. */
const MIRE_X = 36;
const MIRE_Z = -HALF + 6;

export async function buildWastelandZone(seed = 7): Promise<World> {
  const rng = mulberry32(seed);
  const { scene, moon } = createNightScene();

  await loading.step('Baking earth, stone and bark', 0.02);
  const [stoneSet, trimSet, woodSet, barkSet, earthSet, cobbleSet, rockSet] = await bakeSurfaces([
    { kind: 'stoneBricks', seed: seed + 1, size: 512, normalStrength: 5 },
    { kind: 'roughStone', seed: seed + 2, size: 512, normalStrength: 6 },
    { kind: 'woodPlanks', seed: seed + 3, size: 256, normalStrength: 4 },
    { kind: 'deadBark', seed: seed + 4, size: 256, normalStrength: 6 },
    { kind: 'crackedEarth', seed: seed + 5, size: 1024, normalStrength: 5 },
    { kind: 'cobblestone', seed: seed + 6, size: 1024, normalStrength: 9 },
    { kind: 'roughStone', seed: seed + 7, size: 512, normalStrength: 7 },
  ]);
  const mats = {
    stone: pbrMaterial(stoneSet, 1),
    trim: pbrMaterial(trimSet, 1, { color: 0x9a9090 }),
    wood: pbrMaterial(woodSet, 1),
    bark: pbrMaterial(barkSet, 1),
    rock: pbrMaterial(rockSet, 1),
    iron: new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.45, metalness: 0.9 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(2.2, 0.75, 0.25), roughness: 1 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x050202 }),
    bone: new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 0.7 }),
    coal: new THREE.MeshStandardMaterial({ color: 0x110805, emissive: new THREE.Color(2.5, 0.5, 0.1), roughness: 1 }),
    thorn: new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.9 }),
  };

  // Architecture dissolves around the hero when it stands in the way.
  for (const m of Object.values(mats)) installCutaway(m);

  await loading.step('Shaping the blighted earth', 0.35);
  // ---- Terrain -----------------------------------------------------------
  const roadZ = (x: number) => Math.sin(x * 0.07) * 4 + Math.sin(x * 0.023 + 1) * 3;
  const roadDist = (x: number, z: number) => Math.abs(z - roadZ(x));
  const roadFade = (x: number) => 1 - smoothstep(5, 30, x); // road peters out eastward
  const craters = Array.from({ length: 6 }, () => ({ x: range(rng, -25, 55), z: range(rng, -55, 55), r: range(rng, 3, 7) }));
  // The crypt entrance moves every time the fields are walked: its own
  // throwaway seed, so the rest of the zone stays as it was.
  const crng = mulberry32(Math.floor(Math.random() * 1e9));
  const crypt = (() => {
    for (let i = 0; i < 200; i++) {
      const x = range(crng, WALL_X + 34, HALF - 14);
      const z = range(crng, -HALF + 14, HALF - 16);
      if (roadDist(x, z) < 12) continue;
      if (craters.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 7)) continue;
      if (Math.hypot(x - MIRE_X, z - MIRE_Z) < 20) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(30, 0, -40);
  })();
  const cryptYaw = range(crng, -0.35, 0.35); // door faces roughly +Z, toward the camera
  // The waypoint moves with it, somewhere open in the middle of the fields.
  const wp = (() => {
    for (let i = 0; i < 300; i++) {
      const x = range(crng, WALL_X + 22, HALF - 14);
      const z = range(crng, -HALF + 16, HALF - 16);
      if (roadDist(x, z) < 7) continue;
      if (craters.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 6)) continue;
      if (Math.hypot(x - crypt.x, z - crypt.z) < 18 || Math.hypot(x - MIRE_X, z - MIRE_Z) < 18) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(0, 0, 30);
  })();
  const cryptDoor = crypt.clone().add(new THREE.Vector3(Math.sin(cryptYaw), 0, Math.cos(cryptYaw)).multiplyScalar(3.4));
  const height: HeightFn = (x, z) => {
    let h = fbm2(x * 0.02, z * 0.02, 5, seed + 100) * 4.5 + fbm2(x * 0.08, z * 0.08, 3, seed + 101) * 0.45;
    // Flat apron along the wall and along the road.
    const nearWall = 1 - smoothstep(0, 14, x - WALL_X);
    const road = (1 - smoothstep(2.5, 9, roadDist(x, z))) * (0.4 + 0.6 * roadFade(x));
    const cryptPad = 1 - smoothstep(6, 12, Math.hypot(x - crypt.x, z - crypt.z));
    const mirePad = 1 - smoothstep(7, 15, Math.hypot(x - MIRE_X, z - MIRE_Z));
    const wpPad = 1 - smoothstep(3.5, 8, Math.hypot(x - wp.x, z - wp.z));
    h *= 1 - Math.max(nearWall, road, cryptPad, mirePad, wpPad);
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d < 1.4) h += -Math.cos(Math.min(d, 1) * Math.PI * 0.5) * 0.9 * (d < 1 ? 1 : 0) + (d > 0.8 && d < 1.4 ? Math.sin(((d - 0.8) / 0.6) * Math.PI) * 0.35 : 0);
    }
    return h;
  };

  const mask = maskTexture(512, (u, v) => {
    const x = -HALF + u * SIZE;
    const z = -HALF + v * SIZE;
    const n = fbm2(x * 0.15, z * 0.15, 3, seed + 60) * 1.2;
    const road = (1 - smoothstep(1.6, 3.2, roadDist(x, z) + n)) * smoothstep(0.15, 0.6, roadFade(x) + n * 0.15);
    const apron = (1 - smoothstep(2, 6, x - WALL_X - 3 + n * 2)) * (1 - smoothstep(6, 12, Math.abs(z) + n * 2));
    let blood = smoothstep(0.32, 0.7, fbm2(x * 0.1, z * 0.1, 5, seed + 80) + fbm2(x * 0.45, z * 0.45, 3, seed + 81) * 0.3) * 0.6;
    for (const c of craters) blood = Math.max(blood, (1 - smoothstep(0.2, 0.9, Math.hypot(x - c.x, z - c.z) / c.r + n * 0.2)) * 0.95);
    const wet = smoothstep(0.1, 0.6, fbm2(x * 0.05 + 5, z * 0.05, 4, seed + 90)) * 0.6 + road * 0.3;
    return [Math.max(road, apron), blood, wet];
  });
  const ground = terrainMesh(height, -HALF, -HALF, SIZE, 280, splatMaterial(earthSet, 45, cobbleSet, 64, mask));
  scene.add(ground);

  await loading.step('Shaping the blighted earth', 0.4);
  const nav = new NavGrid(-HALF, -HALF, SIZE, SIZE, 0.5);
  // The town is out of bounds for now; so is the map edge.
  for (let z = -HALF; z < HALF; z += 0.5) nav.blockBox(WALL_X - 15, z, 14.5, 0.5, 0);
  for (let i = -HALF; i < HALF; i += 1) {
    nav.blockCircle(i, -HALF + 1, 2);
    nav.blockCircle(i, HALF - 1, 2);
    nav.blockCircle(HALF - 1, i, 2);
  }

  // Black mountains seal off the north, south and east, lava glowing through
  // their cracks and red fog drifting between the peaks. The south faces the
  // camera, so its foothills climb more gently.
  const rim = mountainRim({
    half: HALF, sides: ['n', 's', 'e'], gentle: ['s'], seed: seed + 400,
    rock: rockSet, earth: earthSet, earthScale: 45 / SIZE, earthOrigin: -HALF,
    gaps: [{ side: 'n', u: MIRE_X, width: 12 }],
  });
  scene.add(rim.group);

  // The mire gate: a drowned-looking gatehouse in the pass, its towers solid,
  // only the arch open. Nothing beyond it is walkable.
  for (const k of [-1, 1]) nav.blockBox(MIRE_X + k * 5.6, MIRE_Z, 3.4, 2.6, 0);
  nav.blockBox(MIRE_X, -HALF + 1, 14, 3.4, 0);

  // The gatehouse towers and the buttresses along the wall are solid; only
  // the gate arch itself is open (walking into it leads back to town).
  for (const s of [-1, 1]) nav.blockBox(WALL_X + 0.6, s * 5.6, 2.6, 3.4, 0);
  for (let z = -HALF; z < HALF; z += 1) if (Math.abs(z) > 8.5) nav.blockBox(WALL_X + 0.4, z, 1.2, 0.6, 0);

  await loading.step('Raising the town walls', 0.45);
  // ---- Town walls and skyline ------------------------------------------
  const arch = new MeshBuilder();
  const wallH = 9;
  // Local +Z (outer face) points to world +X; local +X runs toward world -Z.
  const wallRot = Math.PI / 2;
  arch.addBuilder(
    (() => {
      const b = new MeshBuilder();
      gatehouse(b, rng, new THREE.Matrix4(), 8, wallH + 3, 3.5);
      return b;
    })(),
    xf(WALL_X, 0, 0, wallRot),
  );
  const segment = 13.5;
  for (const dir of [-1, 1]) {
    let z = dir * 8.5;
    let n = 0;
    while (Math.abs(z) < HALF + 10) {
      const start = dir > 0 ? z + segment : z; // walls run toward -Z from their origin
      curtainWall(arch, rng, xf(WALL_X - 0.6, 0, start, wallRot), segment, wallH);
      z += dir * segment;
      if (++n % 2 === 0) {
        spireTower(arch, rng, xf(WALL_X - 0.6, 0, z, wallRot), 2.2, wallH + 4, 7 + rng() * 3);
        z += dir * 1.5;
      }
    }
  }
  scene.add(arch.build(mats));

  // Cathedral spires and tall roofs rising behind the wall. They are backdrop
  // only, so they skip shadow casting (their shadows would streak the field).
  const skyline = new MeshBuilder();
  for (let i = 0; i < 9; i++) {
    const z = range(rng, -HALF, HALF);
    const x = WALL_X - range(rng, 9, 26);
    const big = i < 3;
    spireTower(skyline, rng, xf(x, 0, z, rng() * 6), big ? 3.6 : 2.4, big ? 22 : range(rng, 12, 17), big ? 18 : range(rng, 8, 12));
  }
  for (let i = 0; i < 16; i++) {
    const z = range(rng, -HALF, HALF);
    const x = WALL_X - range(rng, 4, 24);
    const w = range(rng, 4, 7);
    const d = range(rng, 6, 10);
    const h = range(rng, 8, 13);
    const m = xf(x, 0, z, Math.round(rng() * 4) * (Math.PI / 2));
    skyline.add('stone', new THREE.BoxGeometry(w, h, d), m.clone().multiply(xf(0, h / 2, 0)));
    const roof = new THREE.CylinderGeometry(0, w * 0.62, d, 4, 1);
    roof.rotateY(Math.PI / 4);
    roof.rotateX(Math.PI / 2);
    skyline.add('trim', roof, m.clone().multiply(xf(0, h + w * 0.42, 0, 0, 1, 1.25, 1)));
  }
  scene.add(skyline.build(mats, false));

  await loading.step('Raising the town walls', 0.5);
  // ---- Fires -----------------------------------------------------------
  // A handful of real lights handed to the braziers nearest the hero.
  const firePool = new LightPool(scene, 6, 0xff7a2a);
  const brazierB = brazier();
  const placeBrazier = (x: number, z: number) => {
    const y = height(x, z);
    const g = brazierB.build(mats);
    g.position.set(x, y, z);
    scene.add(g);
    const f = new Fire(0.9, 0, 1);
    f.group.position.set(x, y + 1.15, z);
    scene.add(f.group);
    firePool.add(new THREE.Vector3(x, y + 1.78, z), 35, 13, 1);
    nav.blockCircle(x, z, 0.6);
  };
  placeBrazier(WALL_X + 4, 5);
  placeBrazier(WALL_X + 4, -5);
  for (let z = -HALF + 12; z < HALF - 6; z += 16) if (Math.abs(z) > 12) placeBrazier(WALL_X + 3.5, z);
  for (let x = WALL_X + 14; x < 10; x += 13) placeBrazier(x, roadZ(x) + (x % 2 ? 3.2 : -3.2));

  {
    const b = new MeshBuilder();
    const gb = new MeshBuilder();
    gatehouse(gb, rng, new THREE.Matrix4(), 8, 9, 3);
    b.addBuilder(gb, xf(MIRE_X, height(MIRE_X, MIRE_Z) - 0.3, MIRE_Z, 0));
    // Broken walls running from the towers into the mountain foot.
    for (const k of [-1, 1]) {
      const g = ruinedWall(rng, 9, 4, 1.0);
      b.add('stone', g, xf(MIRE_X + k * 8.2, height(MIRE_X + k * 8, MIRE_Z - 1) - 0.2, MIRE_Z - 1, k > 0 ? 0 : Math.PI));
      nav.blockBox(MIRE_X + k * 12.7, MIRE_Z - 1, 4.5, 0.8, 0);
    }
    scene.add(b.build(mats));
    placeBrazier(MIRE_X + 3.6, MIRE_Z + 4.5);
    placeBrazier(MIRE_X - 3.6, MIRE_Z + 4.5);
    // Red light spilling out of the arch.
    firePool.add(new THREE.Vector3(MIRE_X, height(MIRE_X, MIRE_Z) + 2, MIRE_Z - 0.5), 16, 10, 0.4, 0xff2a10);
  }

  await loading.step('Hiding the crypt entrance', 0.55);
  // ---- Crypt entrance ----------------------------------------------------
  // A sunken mausoleum: plinth, buttressed walls, a steep stone roof with
  // pinnacles, and a pointed doorway onto stairs going down into red light.
  {
    const cy = height(crypt.x, crypt.z);
    const m = xf(crypt.x, cy - 0.1, crypt.z, cryptYaw);
    const b = new MeshBuilder();
    const W = 5.2;
    const D = 6.2;
    const H = 4.2;
    b.add('trim', new THREE.BoxGeometry(W + 1.2, 0.5, D + 1.2), m.clone().multiply(xf(0, 0.25, 0)));
    b.add('trim', new THREE.BoxGeometry(W + 0.6, 0.3, D + 0.6), m.clone().multiply(xf(0, 0.6, 0)));
    // Walls; the front one is split around the doorway.
    const t = 0.6;
    b.add('stone', new THREE.BoxGeometry(W, H, t), m.clone().multiply(xf(0, H / 2 + 0.6, -D / 2 + t / 2)));
    for (const s of [-1, 1]) b.add('stone', new THREE.BoxGeometry(t, H, D), m.clone().multiply(xf(s * (W / 2 - t / 2), H / 2 + 0.6, 0)));
    const doorW = 1.9;
    const side = (W - doorW) / 2;
    for (const s of [-1, 1]) b.add('stone', new THREE.BoxGeometry(side, H, t), m.clone().multiply(xf(s * (doorW / 2 + side / 2), H / 2 + 0.6, D / 2 - t / 2)));
    // Pointed arch over the door, the wall above it, and a dark stairwell.
    const archH = 3.0;
    const opening = pointedArch(doorW, archH);
    // Wall above the arch: the arch curve below, the wall top above.
    const spring = archH - doorW * Math.sin(Math.PI / 3);
    const curve = opening.getPoints(24).filter((p, i, a) => p.y >= spring - 1e-4 && (i === 0 || p.distanceTo(a[i - 1]) > 1e-4));
    const spandrel = new THREE.Shape([...curve, new THREE.Vector2(doorW / 2, H), new THREE.Vector2(-doorW / 2, H)]);
    b.add('stone', new THREE.ExtrudeGeometry(spandrel, { depth: t, bevelEnabled: false }), m.clone().multiply(xf(0, 0.6, D / 2 - t)));
    // Moulded frame: a horseshoe of the outer arch curve and the inner one reversed.
    const pts = (sh: THREE.Shape) => sh.getPoints(24).filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]) > 1e-4);
    const outer = pts(pointedArch(doorW + 0.5, archH + 0.3));
    const inner = pts(opening);
    while (outer.length > 1 && outer[outer.length - 1].distanceTo(outer[0]) < 1e-4) outer.pop();
    while (inner.length > 1 && inner[inner.length - 1].distanceTo(inner[0]) < 1e-4) inner.pop();
    b.add('trim', new THREE.ExtrudeGeometry(new THREE.Shape([...outer, ...inner.reverse()]), { depth: 0.14, bevelEnabled: false }), m.clone().multiply(xf(0, 0.6, D / 2 + 0.01)));
    b.add('dark', new THREE.ShapeGeometry(opening), m.clone().multiply(xf(0, 0.6, D / 2 - t + 0.05)), 0);
    b.add('dark', new THREE.PlaneGeometry(doorW, D - 2 * t).rotateX(-Math.PI / 2), m.clone().multiply(xf(0, 0.62, 0)), 0);
    // Steps up onto the plinth.
    for (let k = 0; k < 2; k++) b.add('trim', new THREE.BoxGeometry(doorW + 1, 0.25, 0.45), m.clone().multiply(xf(0, 0.12 + k * 0.25, D / 2 + 1.05 - k * 0.4)));
    // Steep gable roof and its end walls.
    const roofH = 2.6;
    const gable = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.3, 0), new THREE.Vector2(W / 2 + 0.3, 0), new THREE.Vector2(0, roofH)]);
    const roof = new THREE.ExtrudeGeometry(gable, { depth: D + 0.6, bevelEnabled: false }).translate(0, 0, -(D + 0.6) / 2);
    b.add('trim', roof, m.clone().multiply(xf(0, H + 0.6, 0)));
    // Buttresses at the corners, each crowned with a pinnacle.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const c = m.clone().multiply(xf(sx * (W / 2 + 0.15), 0.6, sz * (D / 2 + 0.15)));
        b.add('stone', new THREE.BoxGeometry(0.8, H, 0.8), c.clone().multiply(xf(0, H / 2, 0)));
        pinnacle(b, c.clone().multiply(xf(0, H, 0)), 0.32, 2.2);
      }
    }
    // A carved seal over the door, glowing faintly red.
    b.add('glow', new THREE.TorusGeometry(0.32, 0.04, 6, 20), m.clone().multiply(xf(0, 0.6 + archH + 0.55, D / 2 + 0.03)), 0);
    b.add('glow', new THREE.CircleGeometry(0.08, 10), m.clone().multiply(xf(0, 0.6 + archH + 0.55, D / 2 + 0.04)), 0);
    scene.add(b.build(mats));
    nav.blockBox(crypt.x, crypt.z, W / 2 + 0.7, D / 2 + 0.7, cryptYaw);
    // Leave the doorway itself walkable so the hero can step into it.
    const dIn = crypt.clone().add(new THREE.Vector3(Math.sin(cryptYaw), 0, Math.cos(cryptYaw)).multiplyScalar(D / 2 - 0.2));
    nav.unblockRect(dIn.x, dIn.z, 0.6, 0.6);
    nav.unblockRect(cryptDoor.x, cryptDoor.z, 0.8, 0.8);
    // Red light welling up out of the stairwell.
    firePool.add(dIn.clone().setY(cy + 1.4), 14, 9, 0.3, 0xff2a10);
    for (const s of [-1, 1]) {
      const bp = crypt.clone().add(new THREE.Vector3(Math.cos(cryptYaw) * s * 2.6 + Math.sin(cryptYaw) * (D / 2 + 1.8), 0, -Math.sin(cryptYaw) * s * 2.6 + Math.cos(cryptYaw) * (D / 2 + 1.8)));
      placeBrazier(bp.x, bp.z);
    }
  }

  await loading.step('Scattering wreckage, bones and thorns', 0.6);
  // ---- Scatter ---------------------------------------------------------
  const free = (x: number, z: number, r: number) =>
    Math.hypot(x - crypt.x, z - crypt.z) > 8 + r &&
    Math.hypot(x - MIRE_X, z - MIRE_Z) > 10 + r &&
    Math.hypot(x - wp.x, z - wp.z) > 4.5 + r &&
    x > WALL_X + 6 && roadDist(x, z) > 3.5 + r && nav.walkable(x, z) && Math.abs(x) < HALF - 3 && Math.abs(z) < HALF - 3;
  const scatter = (count: number, r: number, fn: (x: number, z: number, rng: Rng) => void) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 30; tries++) {
      const x = range(rng, WALL_X + 6, HALF - 3);
      const z = range(rng, -HALF + 3, HALF - 3);
      if (!free(x, z, r)) continue;
      fn(x, z, rng);
      placed++;
    }
  };
  const placeBuilder = (b: MeshBuilder, x: number, z: number, rot: number) => {
    const g = b.build(mats);
    g.position.set(x, height(x, z), z);
    g.rotation.y = rot;
    scene.add(g);
  };

  scatter(11, 3, (x, z) => {
    const rot = rng() * Math.PI * 2;
    placeBuilder(brokenWagon(rng), x, z, rot);
    nav.blockBox(x, z, 1.8, 0.9, rot);
  });
  scatter(26, 1.2, (x, z) => {
    placeBuilder(stakes(rng), x, z, rng() * 6);
    nav.blockCircle(x, z, 1.1);
  });
  scatter(40, 0.5, (x, z) => placeBuilder(bones(rng), x, z, rng() * 6));

  // Instanced vegetation and rocks.
  const instanced = (geos: THREE.BufferGeometry[], mat: THREE.Material, count: number, r: number, scale: [number, number], block: number, cast = true) => {
    const per = Math.ceil(count / geos.length);
    const meshes = geos.map((g) => {
      const im = new THREE.InstancedMesh(g, mat, per);
      im.count = 0;
      im.castShadow = cast;
      im.receiveShadow = true;
      scene.add(im);
      return im;
    });
    const m = new THREE.Matrix4();
    scatter(count, r, (x, z) => {
      const im = meshes[Math.floor(rng() * meshes.length)];
      if (im.count >= per) return;
      const s = range(rng, scale[0], scale[1]);
      m.compose(
        new THREE.Vector3(x, height(x, z) - 0.05 * s, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(range(rng, -0.08, 0.08), rng() * Math.PI * 2, range(rng, -0.08, 0.08))),
        new THREE.Vector3(s, s, s),
      );
      im.setMatrixAt(im.count++, m);
      if (block > 0) nav.blockCircle(x, z, block * s);
    });
    meshes.forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    });
  };
  instanced(Array.from({ length: 6 }, () => rock(rng, 1)), mats.rock, 130, 1.2, [0.4, 1.7], 0.9);
  instanced(Array.from({ length: 5 }, () => deadTree(rng, range(rng, 4, 7))), mats.bark, 45, 1, [0.8, 1.2], 0.35);
  instanced(Array.from({ length: 5 }, () => thornShrub(rng)), mats.thorn, 800, 0.4, [0.6, 1.5], 0);

  await loading.step('Growing dead grass', 0.78);
  // Dead grass, swaying in the wind.
  const grassMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.15, 0.08), vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  const wind = { value: 0 };
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float sway = sin(windTime * 1.7 + ip.x * 0.35 + ip.z * 0.2) * 0.5 + sin(windTime * 3.1 + ip.x * 0.9) * 0.2;
        transformed.x += sway * 0.12 * position.y * position.y * 4.0;
        transformed.z += sway * 0.05 * position.y * position.y * 4.0;`,
      );
  };
  const grassGeos = Array.from({ length: 4 }, () => grassTuft(rng));
  const grassCount = 16000;
  {
    const xforms: THREE.Matrix4[] = [];
    for (let tries = 0; xforms.length < grassCount && tries < grassCount * 6; tries++) {
      const x = range(rng, WALL_X + 3, HALF - 2);
      const z = range(rng, -HALF + 2, HALF - 2);
      // Clumped: grass grows in patches, thinning near the road.
      const patch = fbm2(x * 0.06, z * 0.06, 3, seed + 200);
      if (patch < 0.05 || roadDist(x, z) < 2.6 || rng() > smoothstep(0.05, 0.4, patch)) continue;
      const s = range(rng, 0.7, 1.5);
      xforms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28), new THREE.Vector3(s, s, s)));
    }
    tiledInstances(scene, grassGeos, grassMat, xforms);
  }

  await loading.step('Raising the dead', 0.92);
  // ---- Monsters ----------------------------------------------------------
  // Danger rises with distance from the gate. Blood priests stand in the
  // crater pools with ghouls about them; ghoul packs roam the open ground,
  // crawlers nest among the dead trees, brutes lumber with an escort, and
  // Vrask the Flayer holds the far end of the fields.
  const spawns: MonsterSpawn[] = [];
  let pack = 0;
  const levelAt = (x: number) => 1 + Math.min(3, Math.floor((x - WALL_X - 10) / 28));
  const near = (x: number, z: number, r: number) => {
    for (let i = 0; i < 20; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (nav.walkable(px, pz)) return new THREE.Vector3(px, height(px, pz), pz);
    }
    const p = nav.nearestWalkable(x, z);
    return p ? new THREE.Vector3(p.x, height(p.x, p.y), p.y) : null;
  };
  const group = (x: number, z: number, list: [MonsterSpawn['kind'], number][], spread: number, elite?: string) => {
    pack++;
    for (const [kind, count] of list) {
      for (let i = 0; i < count; i++) {
        const p = near(x, z, kind === 'cultist' ? 0.8 : spread);
        if (p) spawns.push({ kind, pos: p, level: levelAt(x) + (elite ? 1 : 0), pack, wander: kind === 'cultist' ? 0 : 3.5, elite: i === 0 && kind === 'brute' ? elite : undefined });
      }
    }
  };
  const farFromGate = (x: number, z: number) => Math.hypot(x - (WALL_X + 7), z - roadZ(WALL_X + 7)) > 20;
  const spot = (minX: number, maxX: number) => {
    for (let i = 0; i < 60; i++) {
      const x = range(rng, minX, maxX);
      const z = range(rng, -HALF + 10, HALF - 10);
      if (farFromGate(x, z) && Math.hypot(x - crypt.x, z - crypt.z) > 14 && Math.hypot(x - MIRE_X, z - MIRE_Z) > 14 && Math.hypot(x - wp.x, z - wp.z) > 12 && nav.walkable(x, z)) return [x, z];
    }
    return [range(rng, minX, maxX), range(rng, -20, 20)];
  };
  for (const c of craters) if (farFromGate(c.x, c.z) && Math.hypot(c.x - crypt.x, c.z - crypt.z) > 12) group(c.x, c.z, [['cultist', 1], ['ghoul', 2 + Math.floor(rng() * 2)]], 4.5);
  for (let i = 0; i < 6; i++) {
    const [x, z] = spot(WALL_X + 18, HALF - 10);
    group(x, z, [['ghoul', 3 + Math.floor(rng() * 3)]], 4);
  }
  for (let i = 0; i < 4; i++) {
    const [x, z] = spot(WALL_X + 25, HALF - 8);
    group(x, z, [['crawler', 4 + Math.floor(rng() * 3)]], 3);
  }
  for (let i = 0; i < 3; i++) {
    const [x, z] = spot(WALL_X + 35, HALF - 10);
    group(x, z, [['brute', 1], ['ghoul', 2]], 4);
  }
  {
    const [x, z] = spot(HALF - 24, HALF - 10);
    group(x, z, [['brute', 1], ['ghoul', 4], ['cultist', 0]], 5, 'Vrask the Flayer');
    group(x + 4, z + 3, [['cultist', 1]], 1);
    group(x - 3, z - 4, [['cultist', 1]], 1);
    spawns.filter((s) => s.pack >= pack - 2).forEach((s) => (s.pack = pack));
  }

  const waypoint = buildWaypoint(scene, height, nav, wp.x, wp.z, mats.stone, seed + 61);

  const spawnX = WALL_X + 7;
  return {
    scene,
    moon,
    ground,
    heightAt: height,
    nav,
    spawn: new THREE.Vector3(spawnX, height(spawnX, roadZ(spawnX)), roadZ(spawnX)),
    spawnYaw: Math.PI / 2,
    title: 'The Blighted Fields',
    subtitle: 'Where the dead were buried, they do not rest',
    exits: [
      { pos: new THREE.Vector3(WALL_X + 0.6, 0, 0), radius: 1.5, to: 'town', entry: 'gate', label: 'To Saint Orsolya' },
      { pos: crypt.clone().add(new THREE.Vector3(Math.sin(cryptYaw), 0, Math.cos(cryptYaw)).multiplyScalar(2.9)), radius: 0.9, to: 'dungeon', entry: 'start', label: 'Descend into the Crypt' },
      { pos: new THREE.Vector3(MIRE_X, 0, MIRE_Z - 0.4), radius: 1.5, to: 'swamp', entry: 'gate', label: 'To the Bleeding Mire' },
    ],
    entries: {
      gate: { pos: new THREE.Vector3(spawnX, 0, roadZ(spawnX)), yaw: Math.PI / 2 },
      mire: { pos: new THREE.Vector3(MIRE_X, 0, MIRE_Z + 7), yaw: 0 },
      crypt: { pos: crypt.clone().add(new THREE.Vector3(Math.sin(cryptYaw), 0, Math.cos(cryptYaw)).multiplyScalar(6.2)), yaw: cryptYaw },
    },
    monsterSpawns: spawns,
    waypoint,
    // Walls on the left of the screen, the wasteland opening out to the right.
    cameraYaw: THREE.MathUtils.degToRad(20),
    extent: HALF,
    update(_dt, t) {
      wind.value = t;
      rim.update(_dt, t);
      Fire.tick(t);
      firePool.update(t);
      waypoint.update(t);
    },
  };
}
