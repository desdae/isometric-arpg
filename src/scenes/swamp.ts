import * as THREE from 'three';
import { loading } from '../engine/Loading';
import { bakeSurfaces, pbrMaterial } from '../procgen/textures';
import { maskTexture, splatMaterial } from '../procgen/splat';
import { fbm2, mulberry32, pick, range, smoothstep, type Rng } from '../procgen/noise';
import { deadTree, rock, ruinedWall } from '../procgen/geometry';
import { terrainMesh } from '../procgen/terrain';
import { MeshBuilder, xf } from '../procgen/builder';
import { archPath, gatehouse, pointedArch } from '../procgen/gothic';
import { bones, brazier, grassTuft } from '../procgen/props';
import { Fire } from '../engine/Fire';
import { LightPool } from '../engine/LightPool';
import { NavGrid } from '../world/NavGrid';
import { createNightScene, type World } from '../world/World';
import type { MonsterKind, MonsterSpawn } from '../actors/Monster';
import { installCutaway } from '../engine/cutaway';
import { mountainRim } from '../procgen/mountains';
import { tiledInstances } from '../procgen/tiles';

// The Bleeding Mire: a drowned ruin of a city in a swamp of blood. Each hero
// gets their own, laid out from a seed rolled when the hero is made: islands of sodden mud and moss, each
// crowned with a ruin (a roofless chapel, a broken arcade, a tower stump, a
// blood altar, a grove of dead trees), joined by winding brick causeways
// over red water that glows where something stirs beneath it.

const SIZE = 196;
const HALF = SIZE / 2;
/** Grid step of the precomputed height field. */
const STEP = 0.5;
const N = Math.round(SIZE / STEP) + 1;
/** Ground deeper than this under the water is too deep to wade. */
const DEEP = -0.28;
const CAUSEWAY = 0.24;

type SiteKind = 'chapel' | 'arcade' | 'tower' | 'altar' | 'grove';
interface Site {
  x: number;
  z: number;
  r: number;
  kind: SiteKind | 'gate';
  rot: number;
}

/** Moss on what faces the sky, wet blood-dark stain along the waterline. */
function mossy(mat: THREE.Material, mossAmount = 1) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.mossAmount = { value: mossAmount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMossW;\nvarying vec3 vMossN;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 mossP = vec4( transformed, 1.0 );
        vec3 mossN = objectNormal;
        #ifdef USE_INSTANCING
          mossP = instanceMatrix * mossP;
          mossN = mat3( instanceMatrix ) * mossN;
        #endif
        vMossW = ( modelMatrix * mossP ).xyz;
        vMossN = normalize( mat3( modelMatrix ) * mossN );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vMossW;
        varying vec3 vMossN;
        uniform float mossAmount;
        float mossHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
        float mossNoise( vec2 p ) {
          vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mossHash( i ), mossHash( i + vec2( 1, 0 ) ), f.x ), mix( mossHash( i + vec2( 0, 1 ) ), mossHash( i + vec2( 1, 1 ) ), f.x ), f.y );
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 mp = vMossW.xz + vMossW.y * 0.6;
          float n = mossNoise( mp * 0.7 ) * 0.65 + mossNoise( mp * 2.9 ) * 0.35;
          float up = smoothstep( 0.3, 0.85, vMossN.y );
          // Moss creeps up the walls from the water too.
          float low = 1.0 - smoothstep( 0.3, 1.8, vMossW.y );
          float moss = smoothstep( 0.45, 0.7, n + up * 0.35 + low * 0.25 ) * max( up, low * 0.8 ) * mossAmount;
          vec3 mossCol = vec3( 0.04, 0.055, 0.016 ) * ( 0.7 + 0.7 * mossNoise( mp * 11.0 ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, mossCol, moss * 0.9 );
          float wet = 1.0 - smoothstep( 0.05, 0.45, vMossW.y );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.006, 0.004 ), wet * 0.75 );
        }`,
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '|mossy';
  mat.needsUpdate = true;
}

/** Blood-red swamp water: glossy, wind-rippled, with rings of red light spreading where things move beneath. */
function bloodWater(time: { value: number }, depthMap: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.022, 0.0015, 0.0015), roughness: 0.16, metalness: 0.0, envMapIntensity: 0.3 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.uniforms.waterDepth = { value: depthMap };
    shader.uniforms.waterSize = { value: SIZE };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWaterP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterP = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vWaterP;
        uniform float waterTime;
        uniform sampler2D waterDepth;
        uniform float waterSize;
        float waterShallow;
        float waterShore;
        vec2 waterHash( vec2 p ) { p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) ); return fract( sin( p ) * 43758.5453 ); }
        float waterNoise( vec2 p ) {
          vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( waterHash( i ).x, waterHash( i + vec2( 1, 0 ) ).x, f.x ), mix( waterHash( i + vec2( 0, 1 ) ).x, waterHash( i + vec2( 1, 1 ) ).x, f.x ), f.y );
        }
        // Expanding rings from a jittered point per 7 m cell. Returns intensity, writes the slope.
        float waterRings( vec2 p, float t, out vec2 grad ) {
          vec2 cell = floor( p / 7.0 );
          float sum = 0.0;
          grad = vec2( 0.0 );
          for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
            vec2 c = cell + vec2( float( i ), float( j ) );
            vec2 h = waterHash( c );
            if ( h.x > 0.3 ) continue;
            vec2 center = ( c + 0.2 + h * 0.6 ) * 7.0;
            float period = 2.6 + h.y * 3.0;
            float ph = fract( t / period + h.x * 7.0 );
            float r = ph * 4.2;
            vec2 rel = p - center;
            float d = length( rel ) + 1e-4;
            float fade = ( 1.0 - ph ) * ( 1.0 - ph );
            float e1 = exp( -pow( ( d - r ) * 5.0, 2.0 ) );
            float e2 = exp( -pow( ( d - r * 0.55 ) * 5.5, 2.0 ) ) * 0.45;
            sum += ( e1 + e2 ) * fade;
            float de = ( -2.0 * 25.0 * ( d - r ) * e1 - 2.0 * 30.25 * ( d - r * 0.55 ) * e2 ) * fade;
            grad += de * rel / d;
          }
          return sum;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Depth from the height field: the bottom shows through the shallows,
          // and a rim of red light runs along every shore.
          float ground = texture2D( waterDepth, vWaterP / waterSize + 0.5 ).r * 2.5 - 1.5;
          float depth = -ground;
          waterShallow = 1.0 - smoothstep( 0.0, 0.4, depth );
          float wob = waterNoise( vWaterP * 1.3 + waterTime * 0.3 ) * 0.04;
          waterShore = exp( -pow( ( depth - 0.03 - wob ) * 30.0, 2.0 ) ) * step( -0.05, depth );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.045, 0.014, 0.008 ), waterShallow * 0.8 );
          diffuseColor.rgb *= 0.75 + 0.5 * waterNoise( vWaterP * 0.35 );
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        vec2 ringGrad;
        float ringI = waterRings( vWaterP, waterTime, ringGrad );
        {
          float t = waterTime;
          vec2 p = vWaterP;
          // Slow wind ripples plus the rings, tilted into the view-space normal.
          vec2 slope = vec2(
            sin( p.x * 1.7 + t * 1.3 + sin( p.y * 0.9 ) ) * 0.04 + sin( p.x * 4.1 - t * 2.1 + p.y * 2.3 ) * 0.02,
            sin( p.y * 1.5 - t * 1.1 + sin( p.x * 0.8 ) ) * 0.04 + sin( p.y * 3.7 + t * 1.7 - p.x * 1.9 ) * 0.02 );
          slope += ringGrad * 0.012;
          vec3 wn = normalize( vec3( -slope.x, 1.0, -slope.y ) );
          normal = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz );
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float slow = waterNoise( vWaterP * 0.09 + waterTime * 0.015 ) * waterNoise( vWaterP * 0.23 - waterTime * 0.02 );
          totalEmissiveRadiance += vec3( 1.5, 0.05, 0.02 ) * min( ringI, 1.5 ) * 0.4 * ( 1.0 - waterShallow * 0.7 ) + vec3( 0.06, 0.003, 0.002 ) * slow;
          totalEmissiveRadiance += vec3( 0.9, 0.035, 0.015 ) * waterShore * smoothstep( 0.3, 0.7, waterNoise( vWaterP * 0.5 ) ) * ( 0.2 + 0.15 * sin( waterTime * 1.5 + vWaterP.x * 0.4 + vWaterP.y * 0.3 ) );
        }`,
      );
  };
  return mat;
}

/** Hanging moss strands for a dead tree: thin ribbons drooping from its upper branches. */
function hangingMoss(tree: THREE.BufferGeometry, rng: Rng, h: number): THREE.BufferGeometry {
  const p = tree.getAttribute('position');
  const pos: number[] = [];
  const v = new THREE.Vector3();
  for (let n = 0, tries = 0; n < 34 && tries < 400; tries++) {
    v.fromBufferAttribute(p, Math.floor(rng() * p.count));
    if (v.y < h * 0.42) continue;
    n++;
    const len = range(rng, 0.4, 1.5);
    const w = range(rng, 0.03, 0.07);
    const a = rng() * Math.PI;
    const dx = Math.cos(a) * w;
    const dz = Math.sin(a) * w;
    const sway = range(rng, -0.1, 0.1);
    // Two segments, narrowing to a point.
    const m = [v.x + sway * 0.5, v.y - len * 0.5, v.z];
    const e = [v.x + sway, v.y - len, v.z + sway * 0.4];
    pos.push(v.x - dx, v.y, v.z - dz, v.x + dx, v.y, v.z + dz, m[0] + dx * 0.7, m[1], m[2] + dz * 0.7);
    pos.push(v.x - dx, v.y, v.z - dz, m[0] + dx * 0.7, m[1], m[2] + dz * 0.7, m[0] - dx * 0.7, m[1], m[2] - dz * 0.7);
    pos.push(m[0] - dx * 0.7, m[1], m[2] - dz * 0.7, m[0] + dx * 0.7, m[1], m[2] + dz * 0.7, e[0], e[1], e[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export async function buildSwamp(seed: number): Promise<World> {
  const rng = mulberry32(seed);
  const { scene, moon } = createNightScene();
  (scene.fog as THREE.FogExp2).color.setRGB(0.17, 0.035, 0.028);

  await loading.step('Baking mud, moss and brick', 0.02);
  const [stoneSet, trimSet, barkSet, mudSet, brickSet, rockSet] = await bakeSurfaces([
    { kind: 'stoneBricks', seed: seed + 1, size: 512, normalStrength: 6 },
    { kind: 'roughStone', seed: seed + 2, size: 512, normalStrength: 6 },
    { kind: 'deadBark', seed: seed + 4, size: 256, normalStrength: 6 },
    { kind: 'swampMud', seed: seed + 5, size: 1024, normalStrength: 5 },
    { kind: 'stoneBricks', seed: seed + 6, size: 1024, normalStrength: 8 },
    { kind: 'roughStone', seed: seed + 7, size: 512, normalStrength: 7 },
  ]);
  const mats: Record<string, THREE.Material> = {
    stone: pbrMaterial(stoneSet, 1, { color: 0x8a7a72 }),
    trim: pbrMaterial(trimSet, 1, { color: 0x6e6460 }),
    bark: pbrMaterial(barkSet, 1, { color: 0x6a5c50 }),
    rock: pbrMaterial(rockSet, 1),
    iron: new THREE.MeshStandardMaterial({ color: 0x2a2522, roughness: 0.45, metalness: 0.9 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(2.2, 0.3, 0.12), roughness: 1 }),
    dark: new THREE.MeshBasicMaterial({ color: 0x050202 }),
    bone: new THREE.MeshStandardMaterial({ color: 0x8a7f6a, roughness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x2a1c14, roughness: 0.9 }),
    coal: new THREE.MeshStandardMaterial({ color: 0x110805, emissive: new THREE.Color(2.5, 0.5, 0.1), roughness: 1 }),
    blood: new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: new THREE.Color(0.9, 0.04, 0.02), roughness: 0.1 }),
  };
  mossy(mats.stone);
  mossy(mats.trim);
  mossy(mats.rock, 0.8);
  mossy(mats.bark, 0.6);
  for (const k of ['stone', 'trim', 'iron', 'wood']) installCutaway(mats[k]);

  await loading.step('Drowning the old city', 0.3);
  // ---- Layout: ruin sites joined by causeways --------------------------------
  // The gate stands in a pass on the north edge, facing the camera.
  const gateX = range(rng, -HALF * 0.55, HALF * 0.55);
  const gateZ = -HALF + 6;
  const sites: Site[] = [{ x: gateX, z: gateZ + 9, r: 9, kind: 'gate', rot: 0 }];
  const kinds: SiteKind[] = ['chapel', 'arcade', 'tower', 'altar', 'grove'];
  for (let tries = 0; sites.length < 17 && tries < 3000; tries++) {
    const x = range(rng, -HALF + 20, HALF - 16);
    const z = range(rng, -HALF + 16, HALF - 16);
    const min = tries < 1500 ? 30 : 24;
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < min)) continue;
    // The first few cycle through every kind so each ruin appears at least once.
    const kind = sites.length <= kinds.length ? kinds[sites.length - 1] : pick(rng, kinds);
    sites.push({ x, z, r: range(rng, 8, 12), kind, rot: rng() * Math.PI * 2 });
  }
  // Minimum spanning tree, then a few extra links so there are loops to circle.
  const edges: [number, number][] = [];
  {
    const inTree = new Set([0]);
    while (inTree.size < sites.length) {
      let best: [number, number, number] | null = null;
      for (const a of inTree) {
        for (let b = 0; b < sites.length; b++) {
          if (inTree.has(b)) continue;
          const d = Math.hypot(sites[a].x - sites[b].x, sites[a].z - sites[b].z);
          if (!best || d < best[2]) best = [a, b, d];
        }
      }
      edges.push([best![0], best![1]]);
      inTree.add(best![1]);
    }
    for (let a = 1; a < sites.length; a++) {
      for (let b = a + 1; b < sites.length; b++) {
        const d = Math.hypot(sites[a].x - sites[b].x, sites[a].z - sites[b].z);
        if (d < 42 && rng() < 0.3 && !edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))) edges.push([a, b]);
      }
    }
  }
  // Each link is a winding causeway, sampled every half metre.
  const paths = edges.map(([a, b]) => {
    const A = sites[a];
    const B = sites[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const nx = -(B.z - A.z) / len;
    const nz = (B.x - A.x) / len;
    const amp = range(rng, -0.18, 0.18) * len;
    const wig = range(rng, 1.5, 3);
    const ph = rng() * 6;
    const pts: THREE.Vector2[] = [];
    const steps = Math.ceil(len / 0.5);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = Math.sin(t * Math.PI) * amp + Math.sin(t * Math.PI * 2 * wig + ph) * 1.6 * Math.sin(t * Math.PI);
      pts.push(new THREE.Vector2(A.x + (B.x - A.x) * t + nx * off, A.z + (B.z - A.z) * t + nz * off));
    }
    return { pts, w: range(rng, 3.2, 4.4) };
  });

  // ---- Fields: distance outside the nearest causeway, nearest site --------------
  const idx = (i: number, j: number) => j * N + i;
  const pathOut = new Float32Array(N * N).fill(99);
  const siteK = new Float32Array(N * N).fill(99);
  for (const p of paths) {
    const R = p.w / 2 + 5;
    for (const q of p.pts) {
      const i0 = Math.max(0, Math.floor((q.x - R + HALF) / STEP));
      const i1 = Math.min(N - 1, Math.ceil((q.x + R + HALF) / STEP));
      const j0 = Math.max(0, Math.floor((q.y - R + HALF) / STEP));
      const j1 = Math.min(N - 1, Math.ceil((q.y + R + HALF) / STEP));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(-HALF + i * STEP - q.x, -HALF + j * STEP - q.y) - p.w / 2;
          const k = idx(i, j);
          if (d < pathOut[k]) pathOut[k] = d;
        }
      }
    }
  }
  for (const s of sites) {
    const R = s.r * 1.5;
    for (let j = Math.max(0, Math.floor((s.z - R + HALF) / STEP)); j <= Math.min(N - 1, Math.ceil((s.z + R + HALF) / STEP)); j++) {
      for (let i = Math.max(0, Math.floor((s.x - R + HALF) / STEP)); i <= Math.min(N - 1, Math.ceil((s.x + R + HALF) / STEP)); i++) {
        const x = -HALF + i * STEP;
        const z = -HALF + j * STEP;
        // Ragged island edges.
        const d = Math.hypot(x - s.x, z - s.z) / (s.r * (1 + fbm2(x * 0.15, z * 0.15, 3, seed + 20) * 0.35));
        const k = idx(i, j);
        if (d < siteK[k]) siteK[k] = d;
      }
    }
  }
  const sample = (f: Float32Array, x: number, z: number) => {
    const fx = Math.min(N - 1.001, Math.max(0, (x + HALF) / STEP));
    const fz = Math.min(N - 1.001, Math.max(0, (z + HALF) / STEP));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    return (f[idx(i, j)] * (1 - u) + f[idx(i + 1, j)] * u) * (1 - v) + (f[idx(i, j + 1)] * (1 - u) + f[idx(i + 1, j + 1)] * u) * v;
  };
  const pathDist = (x: number, z: number) => sample(pathOut, x, z);

  // ---- Height -----------------------------------------------------------------
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * STEP;
      const z = -HALF + j * STEP;
      const k = idx(i, j);
      // Mostly drowned ground, with hummocks breaking the surface here and there.
      let h = -0.5 + fbm2(x * 0.025, z * 0.025, 4, seed + 30) * 1.3 + fbm2(x * 0.09, z * 0.09, 3, seed + 31) * 0.5;
      const pd = pathOut[k];
      h = Math.max(h, CAUSEWAY - smoothstep(0, 2.6, pd) * 1.0 + fbm2(x * 0.4, z * 0.4, 2, seed + 32) * 0.04 * smoothstep(0, 1, pd));
      const sk = siteK[k];
      if (sk < 1.6) h = Math.max(h, 0.38 + fbm2(x * 0.1, z * 0.1, 3, seed + 33) * 0.35 - smoothstep(0.8, 1.35, sk) * 1.1);
      // The approach from the gate is solid ground.
      if (z < gateZ + 6) h = Math.max(h, 0.3 - smoothstep(9, 15, Math.abs(x - gateX)) * 1.2);
      H[k] = h;
    }
  }
  const height = (x: number, z: number) => sample(H, x, z);

  await loading.step('Flooding the ruins', 0.4);
  const mask = maskTexture(512, (u, v) => {
    const x = -HALF + u * SIZE;
    const z = -HALF + v * SIZE;
    const h = height(x, z);
    const n = fbm2(x * 0.3, z * 0.3, 3, seed + 60);
    const pd = pathDist(x, z);
    // Brick on the causeways (ragged where it has crumbled) and paving around some ruins.
    let brick = 1 - smoothstep(-0.6, 0.1, pd + n * 0.9 + Math.max(0, fbm2(x * 0.08, z * 0.08, 2, seed + 61)) * 1.2);
    for (const s of sites) {
      if (s.kind === 'chapel' || s.kind === 'altar' || s.kind === 'gate') {
        const d = Math.hypot(x - s.x, z - s.z) / s.r;
        brick = Math.max(brick, (1 - smoothstep(0.45, 0.8, d + n * 0.3)) * 0.95);
      }
    }
    const blood = Math.max(1 - smoothstep(-0.12, 0.12, h + n * 0.06), smoothstep(0.45, 0.75, fbm2(x * 0.12, z * 0.12, 4, seed + 62)) * 0.4);
    const wet = 0.55 + 0.45 * (1 - smoothstep(0.1, 0.7, h));
    return [brick, blood, wet];
  });
  const ground = terrainMesh(height, -HALF, -HALF, SIZE, 340, splatMaterial(mudSet, 55, brickSet, 70, mask));
  scene.add(ground);

  const waterTime = { value: 0 };
  const depthTex = (() => {
    const R = 256;
    const data = new Uint8Array(R * R * 4);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const v = Math.round(Math.min(1, Math.max(0, (height(-HALF + ((i + 0.5) / R) * SIZE, -HALF + ((j + 0.5) / R) * SIZE) + 1.5) / 2.5)) * 255);
        data.set([v, v, v, 255], (j * R + i) * 4);
      }
    }
    const t = new THREE.DataTexture(data, R, R, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  })();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 30, SIZE + 30).rotateX(-Math.PI / 2), bloodWater(waterTime, depthTex));
  water.receiveShadow = true;
  scene.add(water);

  // ---- Walkability ------------------------------------------------------------
  const nav = new NavGrid(-HALF, -HALF, SIZE, SIZE, 0.5);
  for (let cz = 0; cz < nav.rows; cz++) {
    for (let cx = 0; cx < nav.cols; cx++) {
      if (height(-HALF + (cx + 0.5) * 0.5, -HALF + (cz + 0.5) * 0.5) < DEEP) nav.blocked[cz * nav.cols + cx] = 1;
    }
  }
  for (let i = -HALF; i < HALF; i += 1) {
    nav.blockCircle(i, -HALF + 1, 3);
    nav.blockCircle(i, HALF - 1, 3);
    nav.blockCircle(HALF - 1, i, 3);
    nav.blockCircle(-HALF + 1, i, 3);
  }
  // Behind the gate is out of bounds.
  nav.blockBox(0, gateZ - 6, HALF, 4.8, 0);

  // Mountains all round, with a pass behind the gate back to the fields.
  const rim = mountainRim({
    half: HALF, sides: ['n', 's', 'e', 'w'], gentle: ['s'], seed: seed + 400,
    rock: rockSet, earth: mudSet, earthScale: 55 / SIZE, earthOrigin: -HALF,
    gaps: [{ side: 'n', u: gateX, width: 12 }],
  });
  scene.add(rim.group);

  await loading.step('Raising broken walls and arches', 0.5);
  // ---- Ruins ------------------------------------------------------------------
  const clearOfPaths = (x: number, z: number, r: number) => pathDist(x, z) > r + 0.4;
  const nearSite = (x: number, z: number, pad: number) => sites.some((s) => Math.hypot(x - s.x, z - s.z) < s.r * 0.55 + pad);
  const firePool = new LightPool(scene, 6, 0xff5a20);
  const brazierB = brazier();
  const placeBrazier = (x: number, z: number) => {
    if (!clearOfPaths(x, z, 0.6)) return;
    const y = height(x, z);
    const g = brazierB.build(mats);
    g.position.set(x, y, z);
    scene.add(g);
    const f = new Fire(0.9, 0, 1);
    f.group.position.set(x, y + 1.15, z);
    scene.add(f.group);
    firePool.add(new THREE.Vector3(x, y + 1.78, z), 30, 12, 1);
    nav.blockCircle(x, z, 0.6);
  };

  const ruinGroups: MeshBuilder[] = [];
  /** Broken brick wall from (x0, z0) to (x1, z1), skipping any stretch over a causeway. */
  const wall = (b: MeshBuilder, x0: number, z0: number, x1: number, z1: number, h: number, thick = 0.75) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / len;
    const dz = (z1 - z0) / len;
    // Split into runs that stay off the causeways.
    let start = -1;
    const flush = (a: number, e: number) => {
      const l = e - a;
      if (l < 1.2) return;
      const sx = x0 + dx * a;
      const sz = z0 + dz * a;
      const rot = Math.atan2(-dz, dx);
      const y = Math.min(height(sx, sz), height(sx + dx * l, sz + dz * l)) - 0.2;
      b.add('stone', ruinedWall(rng, l, h * range(rng, 0.7, 1.15), thick), xf(sx, y, sz, rot));
      nav.blockBox(sx + dx * l * 0.5, sz + dz * l * 0.5, l / 2, thick / 2 + 0.25, rot);
    };
    for (let t = 0; t <= len; t += 0.5) {
      const ok = clearOfPaths(x0 + dx * t, z0 + dz * t, thick);
      if (ok && start < 0) start = t;
      if (!ok && start >= 0) {
        flush(start, t - 0.5);
        start = -1;
      }
    }
    if (start >= 0) flush(start, len);
  };
  /** A square pier, ragged at the top where it broke. */
  const pier = (b: MeshBuilder, x: number, z: number, h: number, w = 0.9, rot = 0) => {
    if (!clearOfPaths(x, z, w * 0.7)) return;
    const y = height(x, z) - 0.2;
    b.add('trim', new THREE.BoxGeometry(w + 0.3, 0.5, w + 0.3), xf(x, y + 0.25, z, rot));
    b.add('stone', new THREE.BoxGeometry(w, h, w), xf(x, y + h / 2, z, rot));
    b.add('stone', new THREE.BoxGeometry(w * 0.7, 0.5, w * 0.6), xf(x + range(rng, -0.1, 0.1), y + h + 0.1, z, rot + 0.3, 1, 1, 1, range(rng, -0.4, 0.4)));
    nav.blockCircle(x, z, w * 0.7 + 0.25);
  };
  /** A round column, whole or snapped off. */
  const column = (b: MeshBuilder, x: number, z: number, h: number) => {
    if (!clearOfPaths(x, z, 0.6)) return;
    const y = height(x, z) - 0.15;
    b.add('trim', new THREE.BoxGeometry(1.0, 0.45, 1.0), xf(x, y + 0.22, z));
    b.add('stone', new THREE.CylinderGeometry(0.33, 0.38, h, 10), xf(x, y + 0.45 + h / 2, z));
    if (h > 3.5) b.add('trim', new THREE.BoxGeometry(0.95, 0.35, 0.95), xf(x, y + 0.45 + h + 0.17, z));
    else b.add('stone', new THREE.CylinderGeometry(0.2, 0.33, 0.4, 7), xf(x, y + 0.45 + h + 0.1, z, 0, 1, 1, 1, range(rng, -0.5, 0.5), range(rng, -0.5, 0.5)));
    nav.blockCircle(x, z, 0.6);
  };
  /** A fallen column drum lying in the mud or the water. */
  const fallen = (b: MeshBuilder, x: number, z: number) => {
    const l = range(rng, 1.4, 3.2);
    b.add('stone', new THREE.CylinderGeometry(0.34, 0.36, l, 10), xf(x, height(x, z) + 0.15, z, rng() * 6, 1, 1, 1, Math.PI / 2 + range(rng, -0.1, 0.1)));
    if (clearOfPaths(x, z, 1.2)) nav.blockCircle(x, z, 0.8);
  };
  /** A freestanding pointed arch (both piers and the head), span across local X. */
  const standingArch = (b: MeshBuilder, x: number, z: number, rot: number, span: number, h: number) => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const pierW = 0.9;
    // Both feet must stand clear of the causeways (the opening itself can straddle one).
    for (const k of [-1, 1]) {
      const px = x + c * k * (span / 2 + pierW / 2);
      const pz = z - s * k * (span / 2 + pierW / 2);
      if (!clearOfPaths(px, pz, 0.6)) return;
    }
    const outer = pointedArch(span + pierW * 2, h + pierW);
    outer.holes.push(archPath(span, h));
    const y = Math.min(height(x + c * span / 2, z - s * span / 2), height(x - c * span / 2, z + s * span / 2)) - 0.2;
    b.add('stone', new THREE.ExtrudeGeometry(outer, { depth: 0.9, bevelEnabled: false, curveSegments: 12 }), xf(x, y, z, rot).multiply(xf(0, 0, -0.45)));
    const ring = pointedArch(span + 0.35, h + 0.2);
    ring.holes.push(archPath(span, h));
    for (const side of [-1, 1]) b.add('trim', new THREE.ExtrudeGeometry(ring, { depth: 0.12, bevelEnabled: false, curveSegments: 12 }), xf(x, y, z, rot).multiply(xf(0, 0, side * 0.5 - 0.06)));
    for (const k of [-1, 1]) nav.blockBox(x + c * k * (span / 2 + pierW / 2), z - s * k * (span / 2 + pierW / 2), pierW / 2 + 0.2, 0.65, rot);
  };
  const rubble = (b: MeshBuilder, x: number, z: number, r: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * r;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      const s = range(rng, 0.25, 0.6);
      b.add('stone', new THREE.BoxGeometry(s * 1.7, s * 0.8, s), xf(px, height(px, pz) + s * 0.2, pz, rng() * 6, 1, 1, 1, range(rng, -0.4, 0.4), range(rng, -0.4, 0.4)));
    }
  };
  const local = (s: Site, lx: number, lz: number): [number, number] => {
    const c = Math.cos(s.rot);
    const sn = Math.sin(s.rot);
    return [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
  };

  for (const s of sites) {
    const b = new MeshBuilder();
    ruinGroups.push(b);
    if (s.kind === 'chapel') {
      // A roofless chapel: four broken walls, corner piers, an arch over the door.
      const W = range(rng, 8, 11) / 2;
      const D = range(rng, 10, 14) / 2;
      const corners = [local(s, -W, -D), local(s, W, -D), local(s, W, D), local(s, -W, D)];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(2, Math.round(len / 3.5));
        for (let i = 0; i < n; i++) {
          if (rng() < 0.28) continue; // collapsed
          // The front wall (k === 2) leaves the doorway open.
          const t0 = i / n;
          const t1 = (i + 1) / n;
          if (k === 2 && t0 < 0.62 && t1 > 0.38) continue;
          wall(b, ax + (bx - ax) * t0, az + (bz - az) * t0, ax + (bx - ax) * t1, az + (bz - az) * t1, range(rng, 1.8, 5));
        }
        pier(b, ax, az, range(rng, 4, 7.5), 1.1, s.rot);
      }
      const [dx, dz] = local(s, 0, D);
      standingArch(b, dx, dz, s.rot, 2.6, 4.2);
      placeBrazier(...local(s, 2.6, D + 1.4));
      placeBrazier(...local(s, -2.6, D + 1.4));
      rubble(b, s.x, s.z, Math.max(W, D), 26);
    } else if (s.kind === 'arcade') {
      // A broken arcade: a row of arches, some fallen to their piers.
      const n = 3 + Math.floor(rng() * 3);
      const span = range(rng, 2.6, 3.4);
      const step = span + 0.9;
      for (let i = 0; i < n; i++) {
        const [x, z] = local(s, (i - (n - 1) / 2) * step, 0);
        if (rng() < 0.7) standingArch(b, x, z, s.rot, span, range(rng, 3.8, 5));
        else {
          const [p1x, p1z] = local(s, (i - (n - 1) / 2) * step - step / 2, 0);
          pier(b, p1x, p1z, range(rng, 1, 3.5), 0.9, s.rot);
          fallen(b, x + range(rng, -2, 2), z + range(rng, -2, 2));
        }
      }
      wall(b, ...local(s, -(n / 2) * step, -3), ...local(s, (n / 2) * step, -3), range(rng, 1.2, 2.6), 0.6);
      placeBrazier(...local(s, (n / 2) * step + 1.5, 1.5));
      rubble(b, s.x, s.z, s.r * 0.8, 22);
    } else if (s.kind === 'tower') {
      // The stump of a round tower, one side still standing tall.
      const R = range(rng, 2.8, 3.6);
      const seg = 11;
      const tall = rng() * Math.PI * 2;
      const gap = Math.floor(rng() * seg);
      for (let i = 0; i < seg; i++) {
        if (i === gap) continue;
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const hh = 1.5 + 6 * Math.max(0, Math.cos((a0 + a1) / 2 - tall)) ** 2;
        wall(b, s.x + Math.cos(a0) * R, s.z + Math.sin(a0) * R, s.x + Math.cos(a1) * R, s.z + Math.sin(a1) * R, hh, 0.9);
      }
      placeBrazier(s.x + Math.cos(gap / seg * Math.PI * 2 + 0.3) * (R + 2.2), s.z + Math.sin(gap / seg * Math.PI * 2 + 0.3) * (R + 2.2));
      rubble(b, s.x, s.z, R + 3, 30);
      for (let i = 0; i < 3; i++) fallen(b, s.x + range(rng, -6, 6), s.z + range(rng, -6, 6));
    } else if (s.kind === 'altar') {
      // A blood altar in a ring of columns.
      const y = height(s.x, s.z);
      if (clearOfPaths(s.x, s.z, 1.4)) {
        b.add('trim', new THREE.BoxGeometry(3.2, 0.4, 2.2), xf(s.x, y + 0.1, s.z, s.rot));
        b.add('stone', new THREE.BoxGeometry(2.4, 0.9, 1.4), xf(s.x, y + 0.65, s.z, s.rot));
        b.add('trim', new THREE.BoxGeometry(2.6, 0.18, 1.6), xf(s.x, y + 1.18, s.z, s.rot));
        b.add('blood', new THREE.BoxGeometry(2.1, 0.02, 1.1), xf(s.x, y + 1.28, s.z, s.rot), 0);
        nav.blockBox(s.x, s.z, 1.7, 1.2, s.rot);
        firePool.add(new THREE.Vector3(s.x, y + 1.6, s.z), 8, 7, 0.4, 0xff1a0a);
      }
      const n = 7 + Math.floor(rng() * 3);
      const R = range(rng, 5, 6.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + s.rot;
        if (rng() < 0.25) fallen(b, s.x + Math.cos(a) * (R + 1), s.z + Math.sin(a) * (R + 1));
        else column(b, s.x + Math.cos(a) * R, s.z + Math.sin(a) * R, rng() < 0.5 ? range(rng, 4, 5.5) : range(rng, 1, 3));
      }
      placeBrazier(...local(s, 2.6, 2.2));
      placeBrazier(...local(s, -2.6, -2.2));
      rubble(b, s.x, s.z, R + 2, 16);
      for (let i = 0; i < 4; i++) {
        const a = rng() * 6.28;
        const bx = s.x + Math.cos(a) * range(rng, 2, 4);
        const bz = s.z + Math.sin(a) * range(rng, 2, 4);
        const g = bones(rng).build(mats);
        g.position.set(bx, height(bx, bz), bz);
        g.rotation.y = rng() * 6;
        scene.add(g);
      }
    } else if (s.kind === 'grove') {
      // Dead trees grown up through a fallen hall: stumps of walls and columns.
      for (let i = 0; i < 4; i++) {
        const a = rng() * Math.PI * 2;
        const d = range(rng, 3, s.r * 0.8);
        column(b, s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, range(rng, 1, 3.5));
      }
      const [w0x, w0z] = local(s, -4, range(rng, -3, 3));
      wall(b, w0x, w0z, ...local(s, 3, range(rng, -3, 3)), range(rng, 1.2, 2.8));
      rubble(b, s.x, s.z, s.r, 20);
      for (let i = 0; i < 2; i++) fallen(b, s.x + range(rng, -5, 5), s.z + range(rng, -5, 5));
    } else {
      // The gate: a drowned gatehouse in the pass back to the fields.
      const gb = new MeshBuilder();
      gatehouse(gb, rng, new THREE.Matrix4(), 8, 9, 3);
      b.addBuilder(gb, xf(gateX, height(gateX, gateZ) - 0.3, gateZ, 0));
      for (const k of [-1, 1]) nav.blockBox(gateX + k * 5.6, gateZ, 3.4, 2.6, 0);
      for (const k of [-1, 1]) wall(b, gateX + k * 8.5, gateZ + 0.5, gateX + k * 20, gateZ + 2.5, range(rng, 2.5, 4.5), 1.1);
      placeBrazier(gateX + 3.6, gateZ + 4.5);
      placeBrazier(gateX - 3.6, gateZ + 4.5);
      firePool.add(new THREE.Vector3(gateX, height(gateX, gateZ) + 2, gateZ - 0.5), 14, 9, 0.4, 0xff2a10);
    }
  }
  // Fragments of the drowned city between the ruins: stubs of wall, piers,
  // columns, the odd arch, standing on whatever ground broke the surface.
  {
    const cells = new Map<string, MeshBuilder>();
    const cellOf = (x: number, z: number) => {
      const key = Math.floor(x / 40) + ',' + Math.floor(z / 40);
      let b = cells.get(key);
      if (!b) {
        cells.set(key, (b = new MeshBuilder()));
        ruinGroups.push(b);
      }
      return b;
    };
    let placed = 0;
    for (let tries = 0; placed < 70 && tries < 4000; tries++) {
      const x = range(rng, -HALF + 6, HALF - 6);
      const z = range(rng, gateZ + 14, HALF - 6);
      if (height(x, z) < 0.02 || !clearOfPaths(x, z, 2) || nearSite(x, z, 3)) continue;
      const b = cellOf(x, z);
      const r = rng();
      const rot = rng() * Math.PI;
      if (r < 0.4) {
        const l = range(rng, 2, 6);
        wall(b, x, z, x + Math.cos(rot) * l, z + Math.sin(rot) * l, range(rng, 1, 3.5), range(rng, 0.6, 0.9));
      } else if (r < 0.6) column(b, x, z, rng() < 0.3 ? range(rng, 3.5, 5) : range(rng, 0.8, 2.6));
      else if (r < 0.75) pier(b, x, z, range(rng, 1.5, 5), range(rng, 0.8, 1.2), rot);
      else if (r < 0.9) fallen(b, x, z);
      else standingArch(b, x, z, rot, range(rng, 2.4, 3.2), range(rng, 3.6, 4.6));
      rubble(b, x, z, 2.5, 6);
      placed++;
    }
  }
  for (const b of ruinGroups) scene.add(b.build(mats));

  // Kerb stones along the causeway edges, some lost to the water.
  {
    const kerbGeos = [new THREE.BoxGeometry(0.9, 0.38, 0.5), new THREE.BoxGeometry(0.7, 0.34, 0.45), new THREE.BoxGeometry(1.1, 0.4, 0.55)];
    const lists: THREE.Matrix4[][] = kerbGeos.map(() => []);
    for (const p of paths) {
      for (let i = 1; i < p.pts.length - 1; i += 2) {
        const a = p.pts[i - 1];
        const c = p.pts[i + 1];
        const dir = new THREE.Vector2(c.x - a.x, c.y - a.y).normalize();
        for (const side of [-1, 1]) {
          if (rng() < 0.3) continue;
          const x = p.pts[i].x - dir.y * side * (p.w / 2 - 0.2);
          const z = p.pts[i].y + dir.x * side * (p.w / 2 - 0.2);
          // Not inside the islands, where the causeway runs into the ruin.
          if (sample(siteK, x, z) < 0.75) continue;
          const lost = rng() < 0.1;
          const y = height(x, z) + (lost ? -0.25 : 0.05);
          lists[Math.floor(rng() * lists.length)].push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(x + (lost ? side * dir.y * -0.6 : 0), y, z),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(range(rng, -0.08, 0.08) + (lost ? 0.4 : 0), Math.atan2(-dir.y, dir.x) + range(rng, -0.1, 0.1), range(rng, -0.08, 0.08))),
              new THREE.Vector3(1, 1, 1),
            ),
          );
        }
      }
    }
    kerbGeos.forEach((g, i) => tiledInstances(scene, [g], mats.trim, lists[i], 24).forEach((im) => (im.castShadow = true)));
  }

  await loading.step('Hanging moss on dead trees', 0.62);
  // ---- Scatter ------------------------------------------------------------------
  const scatter = (count: number, test: (x: number, z: number) => boolean, fn: (x: number, z: number) => void) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = range(rng, -HALF + 4, HALF - 4);
      const z = range(rng, -HALF + 4, HALF - 4);
      if (!test(x, z)) continue;
      fn(x, z);
      placed++;
    }
  };
  const instanced = (geos: THREE.BufferGeometry[], mat: THREE.Material, count: number, scale: [number, number], test: (x: number, z: number) => boolean, block: number, extra?: { geos: THREE.BufferGeometry[]; mat: THREE.Material }) => {
    const per = Math.ceil(count / geos.length) + 1;
    const make = (g: THREE.BufferGeometry, m: THREE.Material, cast: boolean) => {
      const im = new THREE.InstancedMesh(g, m, per);
      im.count = 0;
      im.castShadow = cast;
      im.receiveShadow = true;
      scene.add(im);
      return im;
    };
    const meshes = geos.map((g) => make(g, mat, true));
    const extras = extra ? extra.geos.map((g) => make(g, extra.mat, false)) : [];
    const m = new THREE.Matrix4();
    scatter(count, test, (x, z) => {
      const k = Math.floor(rng() * meshes.length);
      const im = meshes[k];
      if (im.count >= per) return;
      const s = range(rng, scale[0], scale[1]);
      m.compose(
        new THREE.Vector3(x, height(x, z) - 0.06 * s, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(range(rng, -0.1, 0.1), rng() * Math.PI * 2, range(rng, -0.1, 0.1))),
        new THREE.Vector3(s, s, s),
      );
      im.setMatrixAt(im.count++, m);
      if (extras[k]) extras[k].setMatrixAt(extras[k].count++, m);
      if (block > 0 && height(x, z) > DEEP) nav.blockCircle(x, z, block * s);
    });
    for (const im of [...meshes, ...extras]) {
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
  };
  const treeHeights = Array.from({ length: 6 }, () => range(rng, 5, 9));
  const trees = treeHeights.map((h) => deadTree(rng, h));
  const mossMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.06, 0.02), roughness: 0.9, side: THREE.DoubleSide });
  const strands = trees.map((t, i) => hangingMoss(t, rng, treeHeights[i]));
  const landFree = (x: number, z: number, r: number) => height(x, z) > -0.15 && clearOfPaths(x, z, r) && !nearSite(x, z, r) && z > gateZ + 8;
  instanced(trees, mats.bark, 150, [0.8, 1.25], (x, z) => landFree(x, z, 0.8) || (height(x, z) > -0.6 && height(x, z) < -0.2 && clearOfPaths(x, z, 1.5) && rng() < 0.3), 0.4, { geos: strands, mat: mossMat });
  // A few trees inside the groves.
  for (const s of sites.filter((q) => q.kind === 'grove')) {
    instanced(trees.slice(0, 3), mats.bark, 7, [1.1, 1.5], (x, z) => Math.hypot(x - s.x, z - s.z) < s.r * 0.85 && clearOfPaths(x, z, 1) && nav.walkable(x, z), 0.45, { geos: strands.slice(0, 3), mat: mossMat });
  }
  instanced(Array.from({ length: 5 }, () => rock(rng, 1)), mats.rock, 90, [0.4, 1.4], (x, z) => height(x, z) > -0.7 && clearOfPaths(x, z, 1) && !nearSite(x, z, 0) && z > gateZ + 6, 0.8);
  // Loose bricks everywhere, some sunk in the shallows.
  instanced([new THREE.BoxGeometry(0.5, 0.22, 0.28), new THREE.BoxGeometry(0.7, 0.3, 0.4), new THREE.BoxGeometry(0.42, 0.2, 0.25)], mats.stone, 500, [0.8, 1.4], (x, z) => height(x, z) > -0.35, 0);
  const placeBuilder = (b: MeshBuilder, x: number, z: number) => {
    const g = b.build(mats);
    g.position.set(x, height(x, z), z);
    g.rotation.y = rng() * 6;
    scene.add(g);
  };
  scatter(30, (x, z) => height(x, z) > 0 && nav.walkable(x, z), (x, z) => placeBuilder(bones(rng), x, z));

  await loading.step('Growing reeds', 0.74);
  // Reeds crowding the shorelines, swaying.
  const reedMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.09, 0.1, 0.035), vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const wind = { value: 0 };
  reedMat.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float sway = sin(windTime * 1.3 + ip.x * 0.35 + ip.z * 0.2) * 0.5 + sin(windTime * 2.6 + ip.x * 0.9) * 0.2;
        transformed.x += sway * 0.05 * position.y * position.y;
        transformed.z += sway * 0.03 * position.y * position.y;`,
      );
  };
  const reedGeos = Array.from({ length: 4 }, () => grassTuft(rng).scale(1.3, 3.2, 1.3));
  {
    const xforms: THREE.Matrix4[] = [];
    for (let tries = 0; xforms.length < 12000 && tries < 90000; tries++) {
      const x = range(rng, -HALF + 3, HALF - 3);
      const z = range(rng, gateZ + 3, HALF - 3);
      const h = height(x, z);
      // Thickest right at the water's edge and in the shallows.
      const shore = 1 - smoothstep(0.05, 0.45, Math.abs(h + 0.05));
      if (h < -0.45 || rng() > shore * smoothstep(-0.1, 0.4, fbm2(x * 0.08, z * 0.08, 3, seed + 200) + 0.2) || pathDist(x, z) < 0.2) continue;
      const s = range(rng, 0.7, 1.4);
      xforms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28), new THREE.Vector3(s, s, s)));
    }
    tiledInstances(scene, reedGeos, reedMat, xforms);
  }

  await loading.step('Waking what lives in the mire', 0.9);
  // ---- Monsters ---------------------------------------------------------------
  // Only ground the hero can reach from the gate counts: flood the nav grid.
  const reach = new Uint8Array(nav.cols * nav.rows);
  {
    const start = nav.nearestWalkable(gateX, gateZ + 10)!;
    const sx = Math.floor((start.x + HALF) / 0.5);
    const sz = Math.floor((start.y + HALF) / 0.5);
    const queue = [sz * nav.cols + sx];
    reach[queue[0]] = 1;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      const cx = c % nav.cols;
      const cz = (c - cx) / nav.cols;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox;
        const nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= nav.cols || nz >= nav.rows) continue;
        const k = nz * nav.cols + nx;
        if (reach[k] || nav.blocked[k]) continue;
        reach[k] = 1;
        queue.push(k);
      }
    }
  }
  const reachable = (x: number, z: number) => {
    const cx = Math.floor((x + HALF) / 0.5);
    const cz = Math.floor((z + HALF) / 0.5);
    return cx >= 0 && cz >= 0 && cx < nav.cols && cz < nav.rows && reach[cz * nav.cols + cx] === 1;
  };
  const spawns: MonsterSpawn[] = [];
  let pack = 0;
  // Deeper in (further from the gate) is deadlier.
  const levelAt = (x: number, z: number) => 3 + Math.min(3, Math.floor(Math.hypot(x - gateX, z - gateZ) / 45));
  const near = (x: number, z: number, r: number) => {
    for (let i = 0; i < 30; i++) {
      const a = rng() * Math.PI * 2;
      const d = rng() * r;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (reachable(px, pz)) return new THREE.Vector3(px, height(px, pz), pz);
    }
    return null;
  };
  const farFromGate = (x: number, z: number) => Math.hypot(x - gateX, z - (gateZ + 10)) > 24;
  const group = (x: number, z: number, list: [MonsterKind, number][], spread: number, elite?: { kind: MonsterKind; name: string }) => {
    pack++;
    for (const [kind, count] of list) {
      for (let i = 0; i < count; i++) {
        const p = near(x, z, spread);
        if (!p) continue;
        const champ = elite && elite.kind === kind && i === 0 ? elite.name : undefined;
        spawns.push({ kind, pos: p, level: levelAt(x, z) + (champ ? 1 : 0), pack, wander: kind === 'rootHorror' ? 1.5 : 4, elite: champ });
      }
    }
  };
  const ruins = sites.slice(1).filter((s) => farFromGate(s.x, s.z));
  // The farthest ruin from the gate is the lair of the mire's mother.
  const lair = ruins.reduce((best, s) => (Math.hypot(s.x - gateX, s.z - gateZ) > Math.hypot(best.x - gateX, best.z - gateZ) ? s : best), ruins[0]);
  const n = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
  for (const s of ruins) {
    if (s === lair) continue;
    if (s.kind === 'chapel') group(s.x, s.z, [['mireWraith', n(2, 3)], ['toad', n(1, 3)]], s.r * 0.6);
    else if (s.kind === 'arcade') group(s.x, s.z, [['toad', n(3, 5)]], s.r * 0.6);
    else if (s.kind === 'tower') group(s.x, s.z, [['mireWraith', 2], ['croc', 1]], s.r * 0.7);
    else if (s.kind === 'altar') group(s.x, s.z, [['rootHorror', 1], ['toad', 2], ['mireWraith', 1]], s.r * 0.7);
    else group(s.x, s.z, [['rootHorror', n(1, 2)]], s.r * 0.6);
  }
  // Crocs lurk in pairs at the water's edge along the causeways.
  for (let i = 0; i < 9; i++) {
    for (let tries = 0; tries < 80; tries++) {
      const p = paths[Math.floor(rng() * paths.length)];
      const q = p.pts[Math.floor(rng() * p.pts.length)];
      if (!farFromGate(q.x, q.y) || nearSite(q.x, q.y, 4)) continue;
      group(q.x, q.y, [['croc', n(1, 2)]], 3);
      break;
    }
  }
  // Toads squat on the open islands.
  for (let i = 0; i < 9; i++) {
    for (let tries = 0; tries < 120; tries++) {
      const x = range(rng, -HALF + 8, HALF - 8);
      const z = range(rng, gateZ + 20, HALF - 8);
      if (!farFromGate(x, z) || !reachable(x, z) || nearSite(x, z, 6) || pathDist(x, z) < 1.5) continue;
      group(x, z, [['toad', n(2, 4)]], 4);
      break;
    }
  }
  // Two named champions somewhere in the middle reaches.
  const mid = ruins.filter((s) => s !== lair);
  if (mid.length) {
    const a = mid[Math.floor(rng() * mid.length)];
    group(a.x + 3, a.z + 3, [['toad', 3]], 4, { kind: 'toad', name: 'Bloatgut the Drowned' });
    const b = mid[Math.floor(rng() * mid.length)];
    group(b.x - 3, b.z - 2, [['croc', 2]], 4, { kind: 'croc', name: 'Old Ironjaw' });
  }
  group(lair.x, lair.z, [['rootHorror', 2], ['toad', 3], ['mireWraith', 2]], lair.r * 0.6, { kind: 'rootHorror', name: 'Mother Rot' });

  const entryZ = gateZ + 10;
  return {
    scene,
    moon,
    ground,
    heightAt: height,
    nav,
    spawn: new THREE.Vector3(gateX, height(gateX, entryZ), entryZ),
    spawnYaw: 0,
    title: 'The Bleeding Mire',
    subtitle: 'The old city drowned, and something still walks its ruins',
    exits: [{ pos: new THREE.Vector3(gateX, 0, gateZ - 0.4), radius: 1.6, to: 'zone', entry: 'mire', label: 'To the Blighted Fields' }],
    entries: { gate: { pos: new THREE.Vector3(gateX, 0, entryZ), yaw: 0 } },
    monsterSpawns: spawns,
    cameraYaw: THREE.MathUtils.degToRad(20),
    extent: HALF,
    fogScale: 0.85,
    update(dt, t) {
      wind.value = t;
      waterTime.value = t;
      rim.update(dt, t);
      Fire.tick(t);
      firePool.update(t);
    },
  };
}
