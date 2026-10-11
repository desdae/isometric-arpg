# Isometric ARPG

A dark gothic isometric action RPG built on three.js, where every mesh, texture
and environment is generated in code. There are no imported art assets.

## Run

```
npm install
npm run dev
```

Open http://localhost:5173 to play the first zone. Click (or hold) the left
mouse button to walk, the mouse wheel zooms, Q/E rotate the camera.

Other views:

- `?scene=test` – the step 1 plaza test scene (WASD to pan).
- `?scene=character&speed=4` – the knight on a bare stage, walking in place at
  the given speed (0 for idle).
- `?dist=40&x=0&z=0&pitch=48&yaw=20` – camera overrides; `x`/`z` switch to a
  free camera for inspection.

## Layout

- `src/engine` – renderer and post-processing (GTAO, bloom, colour grade),
  ARPG camera, height fog shader patch, sky dome and drifting mist.
- `src/procgen/noise.ts` – seeded RNG, Perlin, fBm and Voronoi noise.
- `src/procgen/surfaces.ts` – procedural PBR surfaces (cobblestone, cracked
  earth, stone bricks, wood, bark, rock) baked to albedo/normal/ORM data.
- `src/procgen/textures.ts` – turns baked data into textures; bakes run in
  parallel on a worker pool.
- `src/procgen/splat.ts` – ground material blending two surfaces through a
  world-space mask, with world-space blood and wetness.
- `src/procgen/geometry.ts` – rocks, dead trees, ruined walls, barrels,
  crates, fences, thorn shrubs, lantern posts.
- `src/procgen/gothic.ts` – gothic architecture kit: pointed arches, traceried
  windows, pinnacles with crockets, buttresses, curtain walls, octagonal spire
  towers, gatehouse.
- `src/procgen/props.ts` – wagons, stakes, bones, braziers, grass tufts.
- `src/procgen/builder.ts` – merges generated pieces per material.
- `src/procgen/terrain.ts` – heightfield terrain.
- `src/engine/Fire.ts` – shader flames, GPU embers, flickering light.
- `src/engine/environment.ts` – procedural environment map for reflections.
- `src/world/NavGrid.ts` – walkability grid with A* and path smoothing.
- `src/actors/Character.ts` – procedurally modelled knight with a procedural
  walk and idle cycle and a cloth cape.
- `src/actors/Player.ts` – click-to-move controller.
- `src/scenes/wastelandZone.ts` – the first combat zone.
- `src/scenes/testScene.ts` – showcase scene for the rendering foundation.

## Roadmap

1. Rendering foundation (done)
2. First zone: blighted wasteland outside the town walls, player character (done)
3. NPC town: ruined gothic town with NPCs
4. Monsters, combat, loot, town-to-zone transition, polish
