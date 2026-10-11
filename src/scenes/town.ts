import * as THREE from 'three';
import { bakeSurfaces, pbrMaterial } from '../procgen/textures';
import { maskTexture, splatMaterial } from '../procgen/splat';
import { fbm2, mulberry32, range, smoothstep } from '../procgen/noise';
import { barrel, brokenFence, crate, deadTree, lanternPost, type Lantern } from '../procgen/geometry';
import { terrainMesh, type HeightFn } from '../procgen/terrain';
import { MeshBuilder, xf } from '../procgen/builder';
import { curtainWall, gatehouse, spireTower } from '../procgen/gothic';
import { marketStall, ruinedHouse, well } from '../procgen/building';
import { brazier, brokenWagon, grassTuft } from '../procgen/props';
import { Fire } from '../engine/Fire';
import { NavGrid } from '../world/NavGrid';
import { createNightScene, type World } from '../world/World';
import { Character } from '../actors/Character';
import { dressVillager, randomLook } from '../actors/outfits/villager';
import { Npc, type NpcDef } from '../actors/Npc';
import { perlin2 } from '../procgen/noise';

// The NPC town: a walled, half-ruined gothic town around a market square
// with a well. Four streets lead out from the square: east to the gate onto
// the wasteland, north to a broken cathedral. Townsfolk keep to their spots
// or wander, and will talk when approached.

const SIZE = 124;
const HALF = SIZE / 2;
const SQUARE_R = 13;
const STREET_HALF = 3.4;

interface Street {
  dir: THREE.Vector2; // unit direction out of the square
  bend: number; // sideways wobble amplitude
  phase: number;
}

export async function buildTown(seed = 31): Promise<World> {
  const rng = mulberry32(seed);
  const { scene, moon } = createNightScene();

  const sets = await bakeSurfaces([
    { kind: 'stoneBricks', seed: seed + 1, size: 512, normalStrength: 5 },
    { kind: 'roughStone', seed: seed + 2, size: 512, normalStrength: 6 },
    { kind: 'woodPlanks', seed: seed + 3, size: 256, normalStrength: 4 },
    { kind: 'plaster', seed: seed + 4, size: 512, normalStrength: 3 },
    { kind: 'slate', seed: seed + 5, size: 512, normalStrength: 4 },
    { kind: 'crackedEarth', seed: seed + 6, size: 1024, normalStrength: 5 },
    { kind: 'cobblestone', seed: seed + 7, size: 1024, normalStrength: 9 },
    { kind: 'linen', seed: seed + 8, size: 512, normalStrength: 1.2 },
    { kind: 'deadBark', seed: seed + 9, size: 256, normalStrength: 6 },
  ]);
  const [stoneSet, trimSet, woodSet, plasterSet, slateSet, earthSet, cobbleSet, linenSet, barkSet] = sets;
  const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(2.0, 0.8, 0.28), roughness: 1 });
  const linenMat = pbrMaterial(linenSet, 2);
  const mats: Record<string, THREE.Material> = {
    stone: pbrMaterial(stoneSet, 1),
    trim: pbrMaterial(trimSet, 1, { color: 0x9a9090 }),
    wood: pbrMaterial(woodSet, 1),
    plaster: pbrMaterial(plasterSet, 1),
    slate: pbrMaterial(slateSet, 1, { color: new THREE.Color(1.35, 1.2, 1.2) }),
    bark: pbrMaterial(barkSet, 1),
    iron: new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.45, metalness: 0.9 }),
    glow,
    dark: new THREE.MeshBasicMaterial({ color: 0x050202 }),
    coal: new THREE.MeshStandardMaterial({ color: 0x110805, emissive: new THREE.Color(2.5, 0.5, 0.1), roughness: 1 }),
    awning: (() => {
      const m = linenMat.clone();
      m.color.setRGB(0.38, 0.08, 0.06);
      m.side = THREE.DoubleSide;
      return m;
    })(),
    clay: new THREE.MeshStandardMaterial({ color: 0x5a3020, roughness: 0.8 }),
    sack: (() => {
      const m = linenMat.clone();
      m.color.setRGB(0.6, 0.5, 0.36);
      return m;
    })(),
  };

  // ---- Street plan ------------------------------------------------------
  const streets: Street[] = [
    { dir: new THREE.Vector2(1, 0.04).normalize(), bend: 2.5, phase: 0.3 },
    { dir: new THREE.Vector2(-1, -0.06).normalize(), bend: 3, phase: 1.7 },
    { dir: new THREE.Vector2(0.05, -1).normalize(), bend: 2, phase: 2.9 },
    { dir: new THREE.Vector2(-0.04, 1).normalize(), bend: 3, phase: 4.1 },
  ];
  /** Point on a street at distance t from the centre, plus its sideways normal. */
  const streetAt = (s: Street, t: number) => {
    const n = new THREE.Vector2(-s.dir.y, s.dir.x);
    const wob = Math.sin(t * 0.08 + s.phase) * s.bend * smoothstep(SQUARE_R, SQUARE_R + 10, t);
    return { p: s.dir.clone().multiplyScalar(t).addScaledVector(n, wob), n };
  };
  const streetDist = (x: number, z: number) => {
    let best = Infinity;
    for (const s of streets) {
      const t = x * s.dir.x + z * s.dir.y;
      if (t < 0) continue;
      const { p } = streetAt(s, t);
      best = Math.min(best, Math.hypot(x - p.x, z - p.y));
    }
    return best;
  };
  const paved = (x: number, z: number) => Math.max(1 - smoothstep(SQUARE_R - 1, SQUARE_R + 1.5, Math.hypot(x, z)), 1 - smoothstep(STREET_HALF - 0.6, STREET_HALF + 0.6, streetDist(x, z)));

  const height: HeightFn = (x, z) => {
    const h = fbm2(x * 0.025, z * 0.025, 4, seed + 100) * 1.4;
    return h * (1 - paved(x, z) * 0.85) * (1 - smoothstep(HALF - 10, HALF - 4, Math.max(Math.abs(x), Math.abs(z))));
  };

  const mask = maskTexture(512, (u, v) => {
    const x = -HALF + u * SIZE;
    const z = -HALF + v * SIZE;
    const n = fbm2(x * 0.2, z * 0.2, 3, seed + 60) * 0.8;
    const p = smoothstep(0.3, 0.7, paved(x, z) + n * 0.25);
    const blood = smoothstep(0.35, 0.7, fbm2(x * 0.12, z * 0.12, 5, seed + 80) + fbm2(x * 0.5, z * 0.5, 3, seed + 81) * 0.3) * 0.55;
    const wet = smoothstep(0.0, 0.5, fbm2(x * 0.06 + 5, z * 0.06, 4, seed + 90)) * (0.4 + p * 0.5);
    return [p, blood, wet];
  });
  const ground = terrainMesh(height, -HALF, -HALF, SIZE, 248, splatMaterial(earthSet, 48, cobbleSet, 64, mask));
  scene.add(ground);

  const nav = new NavGrid(-HALF, -HALF, SIZE, SIZE, 0.5);
  const lights: { update: (t: number) => void }[] = [];
  const fires: Fire[] = [];

  // ---- Houses -----------------------------------------------------------
  const houses = new MeshBuilder();
  const placeHouse = (x: number, z: number, faceYaw: number, w: number, d: number) => {
    const damage = Math.pow(rng(), 1.7);
    const lit = damage < 0.5 && rng() < 0.75;
    const b = ruinedHouse(rng, { w, d, floors: rng() < 0.6 ? 2 : 1, damage, lit });
    houses.addBuilder(b, xf(x, height(x, z), z, faceYaw));
    nav.blockBox(x, z, w / 2 + 0.1, d / 2 + 0.1, faceYaw);
    return { damage, lit };
  };
  const occupied: { x: number; z: number; r: number }[] = [];
  const clear = (x: number, z: number, r: number) =>
    occupied.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + r) && Math.max(Math.abs(x), Math.abs(z)) < HALF - 7 - r * 0.5;

  // Along each street, both sides, facing the street.
  for (const s of streets) {
    for (const side of [-1, 1]) {
      let t = SQUARE_R + 6 + rng() * 3;
      while (t < HALF - 10) {
        const w = range(rng, 6, 8.5);
        const d = range(rng, 6, 8);
        const { p, n } = streetAt(s, t);
        const off = STREET_HALF + 1.2 + d / 2;
        const x = p.x + n.x * side * off;
        const z = p.y + n.y * side * off;
        // Front (+Z local) must face back toward the street: direction -n*side.
        const yaw = Math.atan2(-n.x * side, -n.y * side);
        const r = Math.max(w, d) * 0.55;
        if (rng() < 0.85 && clear(x, z, r)) {
          placeHouse(x, z, yaw, w, d);
          occupied.push({ x, z, r });
        }
        t += w + range(rng, 1.2, 4);
      }
    }
  }
  // Ring of houses fronting the square, between the street mouths.
  for (let i = 0; i < 4; i++) {
    for (const k of [0.3, 0.7]) {
      const a = Math.atan2(streets[0].dir.y, streets[0].dir.x) + (i + k) * (Math.PI / 2) + range(rng, -0.05, 0.05);
      const w = range(rng, 7, 9);
      const d = range(rng, 6, 7.5);
      const rr = SQUARE_R + 1.5 + d / 2;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const yaw = Math.atan2(-x, -z);
      if (clear(x, z, Math.max(w, d) * 0.5)) {
        placeHouse(x, z, yaw, w, d);
        occupied.push({ x, z, r: Math.max(w, d) * 0.5 });
      }
    }
  }
  scene.add(houses.build(mats));

  // ---- Walls, gate and cathedral ----------------------------------------
  const arch = new MeshBuilder();
  const wallH = 8;
  const inset = HALF - 3;
  const gateZ = streetAt(streets[0], inset).p.y;
  // East wall (outer face +X) with the gate onto the wasteland.
  arch.addBuilder(
    (() => {
      const b = new MeshBuilder();
      gatehouse(b, rng, new THREE.Matrix4(), 8, wallH + 3, 3.5);
      return b;
    })(),
    xf(inset, 0, gateZ, Math.PI / 2),
  );
  const ring = (fixed: number, along: 'x' | 'z', outward: number, gap?: [number, number]) => {
    const seg = 12;
    for (let a = -inset; a < inset; a += seg) {
      const len = Math.min(seg, inset - a);
      if (gap && a + len > gap[0] && a < gap[1]) {
        // Split around the gate.
        if (a < gap[0]) segment(fixed, along, outward, a, gap[0] - a);
        if (a + len > gap[1]) segment(fixed, along, outward, gap[1], a + len - gap[1]);
        continue;
      }
      segment(fixed, along, outward, a, len);
    }
  };
  const segment = (fixed: number, along: 'x' | 'z', outward: number, a: number, len: number) => {
    if (len < 1) return;
    let m: THREE.Matrix4;
    if (along === 'x') {
      // Wall along X at z = fixed; outer face toward outward*Z.
      m = outward > 0 ? xf(a, 0, fixed) : xf(a + len, 0, fixed, Math.PI);
    } else {
      m = outward > 0 ? xf(fixed, 0, a + len, Math.PI / 2) : xf(fixed, 0, a, -Math.PI / 2);
    }
    curtainWall(arch, rng, m, len, wallH);
    for (let k = 0; k < len; k += 0.5) {
      const along1 = a + k;
      if (along === 'x') nav.blockCircle(along1, fixed, 2);
      else nav.blockCircle(fixed, along1, 2);
    }
  };
  ring(inset, 'z', 1, [gateZ - 8.5, gateZ + 8.5]);
  ring(-inset, 'z', -1);
  ring(inset, 'x', 1);
  ring(-inset, 'x', -1);
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) spireTower(arch, rng, xf(cx * inset, 0, cz * inset, rng() * 6), 3, wallH + 5, 9 + rng() * 3);
  // Block the gate passage until travel between areas exists.
  nav.blockBox(inset, gateZ, 2.5, 6, 0);
  // Broken cathedral at the end of the north street.
  const north = streetAt(streets[2], HALF - 14).p;
  arch.addBuilder(
    (() => {
      const b = new MeshBuilder();
      gatehouse(b, rng, new THREE.Matrix4(), 11, 15, 4);
      return b;
    })(),
    xf(north.x, 0, north.y, 0),
  );
  nav.blockBox(north.x, north.y, 11, 3, 0);
  scene.add(arch.build(mats));

  // Distant spires beyond the walls (backdrop, no shadows).
  const skyline = new MeshBuilder();
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2;
    const r = range(rng, HALF + 8, HALF + 30);
    spireTower(skyline, rng, xf(Math.cos(a) * r, 0, Math.sin(a) * r, rng() * 6), range(rng, 2.4, 3.6), range(rng, 12, 22), range(rng, 8, 16));
  }
  scene.add(skyline.build(mats, false));

  // ---- Square: well, stalls, braziers -----------------------------------
  const place = (b: MeshBuilder, x: number, z: number, yaw: number, cast = true) => {
    const g = b.build(mats, cast);
    g.position.set(x, height(x, z), z);
    g.rotation.y = yaw;
    scene.add(g);
    return g;
  };
  place(well(), 0, 0, 0.3);
  nav.blockCircle(0, 0, 1.4);
  const stallSpots: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * (Math.PI / 2) + range(rng, -0.2, 0.2);
    const r = SQUARE_R - 3.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const yaw = Math.atan2(-x, -z);
    place(marketStall(rng), x, z, yaw);
    nav.blockBox(x, z, 1.7, 1.0, yaw);
    stallSpots.push(new THREE.Vector3(x - Math.sin(yaw) * 0.0, 0, z).addScaledVector(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), 0.4));
  }
  const brazierB = brazier();
  const placeBrazier = (x: number, z: number) => {
    place(brazierB, x, z, 0);
    const f = new Fire(0.9, 35, 13);
    f.group.position.set(x, height(x, z) + 1.15, z);
    scene.add(f.group);
    fires.push(f);
    nav.blockCircle(x, z, 0.6);
  };
  placeBrazier(4.5, 4.5);
  placeBrazier(-4.5, -4.5);
  placeBrazier(inset - 4, gateZ + 4.5);
  placeBrazier(inset - 4, gateZ - 4.5);

  // ---- Street furniture -------------------------------------------------
  const wood = mats.wood;
  const iron = mats.iron;
  const lanterns: Lantern[] = [];
  for (const s of streets) {
    let side = 1;
    for (let t = SQUARE_R + 4; t < HALF - 8; t += 13) {
      const { p, n } = streetAt(s, t);
      const x = p.x + n.x * side * (STREET_HALF + 0.3);
      const z = p.y + n.y * side * (STREET_HALF + 0.3);
      if (!nav.walkable(x, z)) continue;
      const l = lanternPost(rng, wood, iron);
      l.group.position.set(x, height(x, z), z);
      l.group.rotation.y = Math.atan2(-n.x * side, -n.y * side) - Math.PI / 2;
      scene.add(l.group);
      lanterns.push(l);
      nav.blockCircle(x, z, 0.3);
      side = -side;
    }
  }
  lights.push({
    update: (t) =>
      lanterns.forEach((l, i) => {
        const f = 0.8 + 0.2 * perlin2(t * 6, i * 10) + 0.08 * perlin2(t * 23, i * 7);
        l.light.intensity = 30 * f;
        l.flame.scale.set(1, 1.5 * (0.9 + 0.2 * f), 1);
      }),
  });

  // Carts, barrels, crates, fences and dead trees in the gaps between houses.
  const scatterNear = (count: number, fn: (x: number, z: number) => void, minStreet: number, maxStreet: number) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = range(rng, -HALF + 8, HALF - 8);
      const z = range(rng, -HALF + 8, HALF - 8);
      const sd = streetDist(x, z);
      if (Math.hypot(x, z) < SQUARE_R + 1 || sd < minStreet || sd > maxStreet || !nav.walkable(x, z)) continue;
      fn(x, z);
      placed++;
    }
  };
  scatterNear(5, (x, z) => {
    const yaw = rng() * Math.PI * 2;
    place(brokenWagon(rng), x, z, yaw);
    nav.blockBox(x, z, 1.8, 0.9, yaw);
  }, STREET_HALF + 1, STREET_HALF + 4);
  const clutter = new MeshBuilder();
  scatterNear(40, (x, z) => {
    const g = rng() < 0.5 ? barrel(rng) : crate(rng);
    clutter.add('wood', g, xf(x, height(x, z), z, rng() * 6), 1.2);
    nav.blockCircle(x, z, 0.45);
  }, STREET_HALF + 0.6, STREET_HALF + 3);
  scatterNear(14, (x, z) => {
    clutter.add('wood', brokenFence(rng, range(rng, 3, 6)), xf(x, height(x, z), z, rng() * 6), 1.5);
  }, STREET_HALF + 2, 30);
  scene.add(clutter.build(mats));
  const treeGeo = [deadTree(rng, 5), deadTree(rng, 6.5)];
  scatterNear(10, (x, z) => {
    const t = new THREE.Mesh(treeGeo[Math.floor(rng() * 2)], mats.bark);
    t.position.set(x, height(x, z), z);
    t.rotation.y = rng() * 6;
    t.castShadow = true;
    scene.add(t);
    nav.blockCircle(x, z, 0.4);
  }, STREET_HALF + 4, 40);

  // Sparse dead grass in yards.
  const grassMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.15, 0.08), vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  const tuft = grassTuft(rng);
  const grass = new THREE.InstancedMesh(tuft, grassMat, 5000);
  grass.count = 0;
  {
    const m = new THREE.Matrix4();
    for (let i = 0; i < 20000 && grass.count < 5000; i++) {
      const x = range(rng, -HALF + 4, HALF - 4);
      const z = range(rng, -HALF + 4, HALF - 4);
      if (paved(x, z) > 0.1 || !nav.walkable(x, z) || fbm2(x * 0.08, z * 0.08, 3, seed + 200) < 0.05) continue;
      const s = range(rng, 0.6, 1.3);
      m.compose(new THREE.Vector3(x, height(x, z), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28), new THREE.Vector3(s, s, s));
      grass.setMatrixAt(grass.count++, m);
    }
    grass.instanceMatrix.needsUpdate = true;
    grass.computeBoundingSphere();
    grass.receiveShadow = true;
    scene.add(grass);
  }

  // ---- Townsfolk --------------------------------------------------------
  const shared = { linen: linenMat, leather: new THREE.MeshStandardMaterial({ color: 0x1c120c, roughness: 0.75 }), wood, iron, glow, dark: mats.dark };
  const gate = new THREE.Vector3(inset - 7, 0, gateZ);
  const cathedralStep = new THREE.Vector3(north.x + 1.5, 0, north.y + 5);
  const defs: (NpcDef & { look: Parameters<typeof randomLook>[2]; scale?: number; hunch?: number })[] = [
    {
      name: 'Elder Vasko',
      role: 'Town elder',
      home: new THREE.Vector3(1.6, 0, 2.2),
      yaw: 0.4,
      wander: 0,
      look: { hood: true, longRobe: true, prop: 'staff', beard: true },
      hunch: 0.35,
      scale: 0.96,
      lines: [
        'The bells of Saint Orsolya stopped three nights ago. Since then the dead have walked the fields beyond the east gate.',
        'We sealed the gate when the first of them came back. What is left of the watch keeps it shut.',
        'If you mean to go out there, speak to Mirela for oil and to Brother Anselm for a blessing. You will want both.',
      ],
    },
    {
      name: 'Mirela',
      role: 'Chandler',
      home: stallSpots[0],
      yaw: 0,
      wander: 0,
      look: { hood: false, apron: true, longRobe: true, prop: 'none', beard: false },
      scale: 0.93,
      lines: [
        'Candles, lamp oil, tallow. Light is the only coin anyone takes now.',
        'The braziers burn day and night. Folk say the things outside will not cross fire. I hope they are right.',
      ],
    },
    {
      name: 'Brother Anselm',
      role: 'Keeper of the cathedral',
      home: cathedralStep,
      yaw: 0,
      wander: 2,
      look: { hood: true, longRobe: true, prop: 'book', beard: false },
      lines: [
        'The roof of the nave fell in on the night of the red sky. The relics are still under it.',
        'I pray for the ones in the fields. They were our neighbours once.',
      ],
    },
    {
      name: 'Old Petra',
      role: 'Herb woman',
      home: new THREE.Vector3(-6, 0, 3),
      yaw: 1,
      wander: 7,
      look: { hood: true, longRobe: true, prop: 'basket', beard: false },
      hunch: 0.25,
      scale: 0.9,
      lines: [
        'Nightshade grows thick where the blood soaked in. I would not eat anything that grows out there now.',
        'Bring me grave moss from the wasteland and I will make you something to keep your wounds closed.',
      ],
    },
    {
      name: 'Dusan',
      role: 'Smith',
      home: stallSpots[2],
      yaw: 0,
      wander: 0,
      look: { hood: false, bald: true, beard: true, apron: true, longRobe: false, prop: 'hammer' },
      scale: 1.05,
      lines: [
        'My forge is cold. No charcoal has come through the gate in a week.',
        'That plate of yours has seen worse than rust. Come back when I have fire and I will see to the dents.',
      ],
    },
    {
      name: 'Ilja',
      role: 'Gate watchman',
      home: gate,
      yaw: -Math.PI / 2,
      wander: 0,
      look: { hood: true, longRobe: false, prop: 'lantern' },
      lines: [
        'The gate stays barred. I have orders, and I have seen what scratches at it after dark.',
        'You want out? Then you are braver than me, or a fool. Either way, not tonight.',
      ],
    },
    {
      name: 'Hana',
      role: 'Refugee',
      home: new THREE.Vector3(8, 0, -14),
      yaw: 0,
      wander: 9,
      look: { hood: false, longRobe: true, prop: 'none' },
      scale: 0.9,
      lines: ['We came from the farms past the ridge. We were eleven when we set out.', 'Have you seen a boy with a red scarf? He would be about this high.'],
    },
    {
      name: 'Marek',
      role: 'Gravedigger',
      home: new THREE.Vector3(-14, 0, -18),
      yaw: 0,
      wander: 10,
      look: { hood: true, longRobe: false, prop: 'staff' },
      lines: ['Plenty of work, and no one to pay for it.', 'Dig them deep, I tell them. Deeper than that.'],
    },
  ];
  const npcs: Npc[] = [];
  for (const d of defs) {
    const c = new Character({ scale: d.scale ?? range(rng, 0.92, 1.02), hunch: d.hunch ?? range(rng, 0, 0.12) });
    dressVillager(c, randomLook(rng, shared, d.look), rng);
    npcs.push(new Npc(d, c, nav, height, scene));
  }
  // Ilja's lantern actually gives light.
  const watchLight = new THREE.PointLight(0xffa060, 8, 7, 1.8);
  watchLight.position.set(0.3, 1.2, 0.4);
  npcs[5].character.root.add(watchLight);

  const spawnPt = streetAt(streets[0], SQUARE_R + 4).p;
  return {
    scene,
    moon,
    ground,
    heightAt: height,
    nav,
    npcs,
    spawn: new THREE.Vector3(spawnPt.x, height(spawnPt.x, spawnPt.y), spawnPt.y),
    spawnYaw: -Math.PI / 2,
    cameraYaw: THREE.MathUtils.degToRad(35),
    extent: HALF,
    update(_dt, t) {
      Fire.tick(t);
      fires.forEach((f) => f.update(t));
      lights.forEach((l) => l.update(t));
    },
  };
}
