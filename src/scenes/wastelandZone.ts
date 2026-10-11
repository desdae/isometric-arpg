import * as THREE from 'three';
import { bakeSurfaces, pbrMaterial } from '../procgen/textures';
import { maskTexture, splatMaterial } from '../procgen/splat';
import { fbm2, mulberry32, range, smoothstep, type Rng } from '../procgen/noise';
import { deadTree, rock, thornShrub } from '../procgen/geometry';
import { terrainMesh, type HeightFn } from '../procgen/terrain';
import { MeshBuilder, xf } from '../procgen/builder';
import { curtainWall, gatehouse, spireTower } from '../procgen/gothic';
import { bones, brazier, brokenWagon, grassTuft, stakes } from '../procgen/props';
import { Fire } from '../engine/Fire';
import { NavGrid } from '../world/NavGrid';
import { createNightScene, type World } from '../world/World';

// The first combat zone: a blighted wasteland outside the spired walls of the
// town. A cobbled road leaves the gatehouse and peters out into cracked earth
// strewn with wreckage, stakes, bones, thorns and dead grass, under red mist.

const SIZE = 140;
const HALF = SIZE / 2;
const WALL_X = -42;

export async function buildWastelandZone(seed = 7): Promise<World> {
  const rng = mulberry32(seed);
  const { scene, moon } = createNightScene();

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

  // ---- Terrain -----------------------------------------------------------
  const roadZ = (x: number) => Math.sin(x * 0.07) * 4 + Math.sin(x * 0.023 + 1) * 3;
  const roadDist = (x: number, z: number) => Math.abs(z - roadZ(x));
  const roadFade = (x: number) => 1 - smoothstep(5, 30, x); // road peters out eastward
  const craters = Array.from({ length: 6 }, () => ({ x: range(rng, -25, 55), z: range(rng, -55, 55), r: range(rng, 3, 7) }));
  const height: HeightFn = (x, z) => {
    let h = fbm2(x * 0.02, z * 0.02, 5, seed + 100) * 4.5 + fbm2(x * 0.08, z * 0.08, 3, seed + 101) * 0.45;
    // Flat apron along the wall and along the road.
    const nearWall = 1 - smoothstep(0, 14, x - WALL_X);
    const road = (1 - smoothstep(2.5, 9, roadDist(x, z))) * (0.4 + 0.6 * roadFade(x));
    h *= 1 - Math.max(nearWall, road);
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

  const nav = new NavGrid(-HALF, -HALF, SIZE, SIZE, 0.5);
  // The town is out of bounds for now; so is the map edge.
  for (let z = -HALF; z < HALF; z += 0.5) nav.blockBox(WALL_X - 15, z, 14.5, 0.5, 0);
  for (let i = -HALF; i < HALF; i += 1) {
    nav.blockCircle(i, -HALF + 1, 2);
    nav.blockCircle(i, HALF - 1, 2);
    nav.blockCircle(HALF - 1, i, 2);
  }

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

  // ---- Fires -----------------------------------------------------------
  const fires: Fire[] = [];
  const brazierB = brazier();
  const placeBrazier = (x: number, z: number) => {
    const y = height(x, z);
    const g = brazierB.build(mats);
    g.position.set(x, y, z);
    scene.add(g);
    const f = new Fire(0.9, 35, 13);
    f.group.position.set(x, y + 1.15, z);
    scene.add(f.group);
    fires.push(f);
    nav.blockCircle(x, z, 0.6);
  };
  placeBrazier(WALL_X + 4, 5);
  placeBrazier(WALL_X + 4, -5);
  for (let z = -HALF + 12; z < HALF - 6; z += 16) if (Math.abs(z) > 12) placeBrazier(WALL_X + 3.5, z);
  for (let x = WALL_X + 14; x < 10; x += 13) placeBrazier(x, roadZ(x) + (x % 2 ? 3.2 : -3.2));

  // ---- Scatter ---------------------------------------------------------
  const free = (x: number, z: number, r: number) =>
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
  const grassMeshes = grassGeos.map((g) => {
    const im = new THREE.InstancedMesh(g, grassMat, Math.ceil(grassCount / grassGeos.length));
    im.count = 0;
    im.receiveShadow = true;
    scene.add(im);
    return im;
  });
  {
    const m = new THREE.Matrix4();
    let placed = 0;
    for (let tries = 0; placed < grassCount && tries < grassCount * 6; tries++) {
      const x = range(rng, WALL_X + 3, HALF - 2);
      const z = range(rng, -HALF + 2, HALF - 2);
      // Clumped: grass grows in patches, thinning near the road.
      const patch = fbm2(x * 0.06, z * 0.06, 3, seed + 200);
      if (patch < 0.05 || roadDist(x, z) < 2.6 || rng() > smoothstep(0.05, 0.4, patch)) continue;
      const im = grassMeshes[placed % grassMeshes.length];
      const s = range(rng, 0.7, 1.5);
      m.compose(new THREE.Vector3(x, height(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28), new THREE.Vector3(s, s, s));
      im.setMatrixAt(im.count++, m);
      placed++;
    }
    grassMeshes.forEach((im) => {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    });
  }

  const spawnX = WALL_X + 7;
  return {
    scene,
    moon,
    ground,
    heightAt: height,
    nav,
    spawn: new THREE.Vector3(spawnX, height(spawnX, roadZ(spawnX)), roadZ(spawnX)),
    spawnYaw: Math.PI / 2,
    // Walls on the left of the screen, the wasteland opening out to the right.
    cameraYaw: THREE.MathUtils.degToRad(20),
    extent: HALF,
    update(_dt, t) {
      wind.value = t;
      Fire.tick(t);
      fires.forEach((f) => f.update(t));
    },
  };
}
