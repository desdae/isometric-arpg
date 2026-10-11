import * as THREE from 'three';
import { bakeSurfaces, pbrMaterial } from '../procgen/textures';
import { maskTexture, splatMaterial } from '../procgen/splat';
import { fbm2, mulberry32, perlin2, range, smoothstep } from '../procgen/noise';
import { createNightScene, type World } from '../world/World';
import {
  barrel,
  boxProjectUVs,
  brokenFence,
  crate,
  deadTree,
  lanternPost,
  rock,
  ruinedWall,
  thornShrub,
  type Lantern,
} from '../procgen/geometry';

// A small showcase scene for the rendering foundation: a cobbled plaza with
// ruined stone buildings and lanterns, fading into cracked blighted earth.

const GROUND = 160;

export async function buildTestScene(seed = 1337): Promise<World> {
  const rng = mulberry32(seed);
  const { scene, moon } = createNightScene();

  // Materials, all baked from code.
  const [stoneSet, rockSet, woodSet, barkSet, earthSet, cobbleSet] = await bakeSurfaces([
    { kind: 'stoneBricks', seed: seed + 1, size: 512, normalStrength: 5 },
    { kind: 'roughStone', seed: seed + 2, size: 512, normalStrength: 7 },
    { kind: 'woodPlanks', seed: seed + 3, size: 256, normalStrength: 4 },
    { kind: 'deadBark', seed: seed + 4, size: 256, normalStrength: 6 },
    { kind: 'crackedEarth', seed: seed + 5, size: 1024, normalStrength: 5 },
    { kind: 'cobblestone', seed: seed + 6, size: 1024, normalStrength: 9 },
  ]);
  const stone = pbrMaterial(stoneSet, 1);
  const rockMat = pbrMaterial(rockSet, 1);
  const wood = pbrMaterial(woodSet, 1);
  const bark = pbrMaterial(barkSet, 1);
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.5, metalness: 0.9 });
  const thornMat = new THREE.MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.9 });

  // Ground: cracked earth everywhere, cobbles in the plaza and along a road.
  const plaza = (x: number, z: number) => {
    const n = fbm2(x * 0.08, z * 0.08, 4, seed + 60) * 4;
    const circle = 1 - smoothstep(10, 13, Math.hypot(x, z) + n);
    const road = (1 - smoothstep(2.6, 4.2, Math.abs(z - Math.sin(x * 0.05) * 3) + n * 0.6)) * smoothstep(-2, 6, x);
    return Math.max(circle, road);
  };
  const mask = maskTexture(512, (u, v) => {
    const x = (u - 0.5) * GROUND;
    const z = (v - 0.5) * GROUND;
    const p = plaza(x, z);
    const blood = smoothstep(0.15, 0.5, fbm2(x * 0.12, z * 0.12, 5, seed + 80) + fbm2(x * 0.5, z * 0.5, 3, seed + 81) * 0.3) * (0.4 + p * 0.6);
    const wet = smoothstep(0.0, 0.5, fbm2(x * 0.07 + 5, z * 0.07, 4, seed + 90)) * (0.5 + p * 0.5);
    return [p, blood, wet];
  });
  const groundGeo = new THREE.PlaneGeometry(GROUND, GROUND, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  // PlaneGeometry uv.v runs bottom-up; after rotating, v=0 sits at +z, so flip
  // to keep mask(u, v) aligned with world (x, z).
  const guv = groundGeo.getAttribute('uv');
  for (let i = 0; i < guv.count; i++) guv.setY(i, 1 - guv.getY(i));
  const ground = new THREE.Mesh(
    groundGeo,
    splatMaterial(earthSet, 18, cobbleSet, 24, mask),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, rotY = 0, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };

  // Ruined buildings: four broken walls each, with a doorway gap and rafters.
  const ruin = (cx: number, cz: number, w: number, d: number, h: number, rot: number) => {
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    g.rotation.y = rot;
    const walls: [number, number, number, number][] = [
      [-w / 2, -d / 2, w, 0],
      [w / 2, -d / 2, d, -Math.PI / 2],
      [w / 2, d / 2, w * 0.42, Math.PI],
      [-w / 2, d / 2, d, Math.PI / 2],
    ];
    for (const [x, z, len, r] of walls) {
      const m = new THREE.Mesh(ruinedWall(rng, len, h * range(rng, 0.8, 1.1)), stone);
      m.position.set(x, 0, z);
      m.rotation.y = r;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    // Front wall's other side, leaving a doorway.
    const m = new THREE.Mesh(ruinedWall(rng, w * 0.4, h * 0.7), stone);
    m.position.set(-w / 2 + w * 0.4, 0, d / 2);
    m.rotation.y = Math.PI;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    // Exposed rafters; some fallen.
    for (let i = 0; i < 5; i++) {
      const fallen = rng() < 0.35;
      const beam = new THREE.Mesh(boxProjectUVs(new THREE.BoxGeometry(0.22, 0.22, d * range(rng, 0.7, 1.1)), 1.2), wood);
      const x = -w / 2 + (i + 0.5) * (w / 5);
      if (fallen) {
        beam.position.set(x, 0.9, range(rng, -0.5, 0.5));
        beam.rotation.set(range(rng, 0.3, 0.6), range(rng, -0.4, 0.4), range(rng, -0.2, 0.2));
      } else {
        beam.position.set(x, h * 0.95, 0);
        beam.rotation.set(range(rng, -0.05, 0.05), 0, range(rng, -0.1, 0.1));
      }
      beam.castShadow = beam.receiveShadow = true;
      g.add(beam);
    }
    scene.add(g);
  };
  ruin(-11, -9, 8, 6, 4.2, 0.1);
  ruin(10, -12, 7, 7, 3.6, -0.2);
  ruin(-13, 9, 6, 5, 3.2, 0.35);

  // Lanterns ringing the plaza.
  const lanterns: Lantern[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    const r = range(rng, 8.5, 10.5);
    const l = lanternPost(rng, wood, iron);
    l.group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    l.group.rotation.y = -a + Math.PI;
    scene.add(l.group);
    lanterns.push(l);
  }

  // Clutter near the walls.
  for (let i = 0; i < 10; i++) {
    const near = rng() < 0.5 ? [-8, -6] : [7, -9];
    const x = near[0] + range(rng, -3, 3);
    const z = near[1] + range(rng, 1.5, 4);
    add(rng() < 0.5 ? barrel(rng) : crate(rng), wood, x, z, rng() * Math.PI);
  }
  add(brokenFence(rng, 7), wood, 3, 11, -0.2);
  add(brokenFence(rng, 6), wood, -4, 14, 0.4);

  // Blighted outskirts: rocks, dead trees, thorns.
  const rockGeos = Array.from({ length: 6 }, () => rock(rng, 1));
  const shrubGeos = Array.from({ length: 4 }, () => thornShrub(rng));
  const treeGeos = Array.from({ length: 4 }, () => deadTree(rng, range(rng, 4, 6)));
  const scatter = (count: number, minR: number, fn: (x: number, z: number) => void) => {
    let placed = 0;
    let tries = 0;
    while (placed < count && tries++ < count * 20) {
      const x = range(rng, -GROUND / 2 + 2, GROUND / 2 - 2);
      const z = range(rng, -GROUND / 2 + 2, GROUND / 2 - 2);
      if (plaza(x, z) > 0.05 || Math.hypot(x, z) < minR) continue;
      fn(x, z);
      placed++;
    }
  };
  scatter(90, 14, (x, z) => {
    const m = add(rockGeos[Math.floor(rng() * rockGeos.length)], rockMat, x, z, rng() * 6);
    m.scale.setScalar(range(rng, 0.4, 1.6));
  });
  scatter(40, 16, (x, z) => add(treeGeos[Math.floor(rng() * treeGeos.length)], bark, x, z, rng() * 6));
  scatter(160, 13, (x, z) => {
    const m = add(shrubGeos[Math.floor(rng() * shrubGeos.length)], thornMat, x, z, rng() * 6);
    m.scale.setScalar(range(rng, 0.6, 1.4));
  });

  return {
    scene,
    moon,
    ground,
    heightAt: () => 0,
    extent: 40,
    update(_dt, t) {
      lanterns.forEach((l, i) => {
        const f = 0.8 + 0.2 * perlin2(t * 6, i * 10) + 0.08 * perlin2(t * 23, i * 7);
        l.light.intensity = 30 * f;
        l.flame.scale.set(1, 1.5 * (0.9 + 0.2 * f), 1);
      });
    },
  };
}
