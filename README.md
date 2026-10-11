# Isometric ARPG

A dark gothic isometric action RPG built on three.js, where every mesh, texture
and environment is generated in code. There are no imported art assets.

## Run

```
npm install
npm run dev
```

Open http://localhost:5173. WASD or arrows pan, the mouse wheel zooms, Q/E rotate.
URL parameters `?dist=40&x=0&z=0` set the starting camera.

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
- `src/scenes/testScene.ts` – showcase scene for the rendering foundation.

## Roadmap

1. Rendering foundation (this commit)
2. First zone: blighted wasteland outside the town walls, player character
3. NPC town: ruined gothic town with NPCs
4. Monsters, combat, loot, town-to-zone transition, polish
