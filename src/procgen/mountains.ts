import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, perlin2, range, smoothstep, type Rng } from './noise';
import { mistTexture, type PbrSet } from './textures';
import { installCutaway } from '../engine/cutaway';

// The impassable rim of an outdoor area: jagged black mountains rising from
// the map edge, split by glowing lava cracks, with red fog banks drifting
// between the peaks. A ridged heightfield gives the massif; clusters of
// needle spires on top give the broken silhouette.

export type Side = 'n' | 's' | 'e' | 'w';

export interface RimOptions {
  /** Half the playable square's width. */
  half: number;
  sides: Side[];
  seed: number;
  /** How far inside the edge the mountain foot starts (keep it outside the walkable floor). */
  inset?: number;
  /** Sides that face the camera get lower foothills so the hero stays in view. */
  gentle?: Side[];
  /** Stone surface wrapped over the rock (triplanar), for grain and bump. */
  rock?: PbrSet;
  /** The area's ground, laid on ledges and the foot so the rim grows out of the floor. */
  earth?: PbrSet;
  /** Ground texture repeats per metre, to line the foot up with the floor. */
  earthScale?: number;
  /** World x/z where the ground's texture origin sits. */
  earthOrigin?: number;
}

export interface Rim {
  group: THREE.Group;
  update(dt: number, t: number): void;
}

/** How far past the map edge the mountains run (the camera never sees further). */
const OUT = 50;

export function mountainRim(o: RimOptions): Rim {
  const rng = mulberry32(o.seed);
  const inset = o.inset ?? 3.5;
  const group = new THREE.Group();
  const lavaTime = { value: 0 };

  // Distance past the foot line for each side, and how fast that side climbs.
  const sideDist = (s: Side, x: number, z: number) =>
    s === 'n' ? -o.half + inset - z : s === 's' ? z - (o.half - inset) : s === 'e' ? x - (o.half - inset) : -o.half + inset - x;
  const climb = (s: Side) => (o.gentle?.includes(s) ? 18 : 7);
  const seed = o.seed;
  const ridged = (x: number, z: number) => {
    let sum = 0;
    let amp = 0.55;
    let f = 0.05;
    let w = 1;
    for (let i = 0; i < 5; i++) {
      let n = 1 - Math.abs(perlin2(x * f, z * f, seed + 31 + i));
      n *= n * w;
      w = Math.min(1, n * 1.6);
      sum += n * amp;
      amp *= 0.5;
      f *= 2.1;
    }
    return sum;
  };
  /** Mountain height, or -1 inside the playable floor. */
  const heightAt = (x: number, z: number) => {
    let best = -1;
    for (const s of o.sides) {
      const d = sideDist(s, x, z);
      if (d <= 0) continue;
      const k = climb(s);
      const ramp = smoothstep(0.5, k, d);
      const crag = perlin2(x * 0.16, z * 0.16, seed + 50) * 2.2 + perlin2(x * 0.4, z * 0.4, seed + 51) * 0.8;
      const h = 0.7 * smoothstep(0, 2.5, d) + ramp * (2.5 + 13 * Math.pow(ridged(x, z), 2) + crag * (0.5 + ramp)) + ramp * 6 * smoothstep(k, k * 4, d);
      best = Math.max(best, h);
    }
    return best;
  };

  const mat = rockMaterial(lavaTime, o);

  // ---- Massif heightfield ------------------------------------------------
  {
    const min = -o.half - OUT;
    const size = (o.half + OUT) * 2;
    const seg = Math.round(size / 1.25);
    const step = size / seg;
    const row = seg + 1;
    const pos = new Float32Array(row * row * 3);
    const inside = new Uint8Array(row * row);
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        const x = min + i * step;
        const z = min + j * step;
        const h = heightAt(x, z);
        const k = j * row + i;
        inside[k] = h < 0 ? 1 : 0;
        // Small jitter breaks the grid so facets read as rock, not as a mesh.
        const jx = h > 1 ? (rng() - 0.5) * step * 0.5 : 0;
        const jz = h > 1 ? (rng() - 0.5) * step * 0.5 : 0;
        pos.set([x + jx, h < 0 ? -0.5 : h - 0.15, z + jz], k * 3);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * row + i;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        if (inside[a] && inside[b] && inside[c] && inside[d]) continue;
        idx.push(a, c, b, b, c, d);
      }
    }
    let geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- Needle spires -----------------------------------------------------
  {
    const along = (s: Side, u: number, d: number): [number, number] => {
      const e = o.half - inset + d;
      return s === 'n' ? [u, -e] : s === 's' ? [u, e] : s === 'e' ? [e, u] : [-e, u];
    };
    const span = o.half + OUT * 0.6;
    for (const s of o.sides) {
      // One mesh per side, so sides out of view are culled.
      const geos: THREE.BufferGeometry[] = [];
      const count = Math.round(span * 1.5);
      for (let n = 0; n < count; n++) {
        const u = range(rng, -span, span);
        // Most peaks crowd the near slopes; some stand far back as a skyline.
        const gentle = o.gentle?.includes(s);
        const d = (gentle ? 5 : 0.5) + Math.pow(rng(), 1.6) * 40;
        const [x, z] = along(s, u, d);
        if (heightAt(x, z) < 0) continue;
        const k = climb(s);
        const grow = smoothstep(0, k * 1.4, d);
        const h = Math.min(gentle ? 2 + d * 0.55 : 6 + d * 0.9, (7 + rng() * 11) * (0.8 + grow * 1.1));
        const base = heightAt(x, z) - 1.2;
        const cluster = 1 + Math.floor(rng() * 4);
        for (let c = 0; c < cluster; c++) {
          const ch = c === 0 ? h : h * range(rng, 0.35, 0.7);
          const ox = c === 0 ? 0 : range(rng, -1, 1) * h * 0.22;
          const oz = c === 0 ? 0 : range(rng, -1, 1) * h * 0.22;
          // Far peaks are seen small and through fog: fewer facets.
          const g = spire(rng, ch, ch * range(rng, 0.13, 0.2), d > 16 ? 6 : 10);
          g.translate(x + ox, base - (c ? 0.5 : 0), z + oz);
          geos.push(g);
        }
      }
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      const m = new THREE.Mesh(merged, mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---- Fog banks between the peaks ----------------------------------------
  const tex = mistTexture(256, seed + 5);
  const banks: { mesh: THREE.Mesh; side: Side; u: number; d: number; v: number; spin: number; y: number; bob: number }[] = [];
  const span = o.half + OUT * 0.5;
  for (const s of o.sides) {
    const count = Math.round(span * 0.45);
    for (let n = 0; n < count; n++) {
      // A third of the banks hug the mountain foot to soften where rock meets floor.
      const d = n % 3 === 0 ? range(rng, -1, 4) : range(rng, 3, 42);
      // Banks near the playable floor stay small so they don't cover it.
      const size = Math.max(7, Math.min(range(rng, 14, 34), 8 + d * 1.4));
      const y = d < 4 ? range(rng, 0.5, 1.8) : range(rng, 1.5, 3 + d * 0.25);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          map: tex,
          color: new THREE.Color(0.55, 0.07, 0.045),
          transparent: true,
          opacity: range(rng, 0.22, 0.42),
          depthWrite: false,
          fog: false,
        }),
      );
      mesh.renderOrder = 10;
      mesh.rotation.y = rng() * Math.PI * 2;
      group.add(mesh);
      banks.push({ mesh, side: s, u: range(rng, -span, span), d, v: range(rng, 0.25, 0.8) * (rng() < 0.5 ? -1 : 1), spin: range(rng, -0.02, 0.02), y, bob: rng() * 6 });
    }
  }
  const placeBanks = (dt: number, t: number) => {
    for (const b of banks) {
      b.u += b.v * dt;
      if (b.u > span) b.u -= 2 * span;
      if (b.u < -span) b.u += 2 * span;
      const e = o.half - inset + b.d;
      const y = b.y + Math.sin(t * 0.15 + b.bob) * 0.6;
      const p = b.mesh.position;
      if (b.side === 'n') p.set(b.u, y, -e);
      else if (b.side === 's') p.set(b.u, y, e);
      else if (b.side === 'e') p.set(e, y, b.u);
      else p.set(-e, y, b.u);
      b.mesh.rotation.y += b.spin * dt;
    }
  };
  placeBanks(0, 0);

  return {
    group,
    update(dt, t) {
      lavaTime.value = t;
      placeBanks(dt, t);
    },
  };
}

/** One jagged needle of rock: a leaning, lumpy cone with a broken tip. */
function spire(rng: Rng, h: number, r: number, rings: number): THREE.BufferGeometry {
  const sides = rings > 6 ? 7 + Math.floor(rng() * 2) : 6;
  const lean = new THREE.Vector2(range(rng, -1, 1), range(rng, -1, 1)).multiplyScalar(h * 0.12);
  const jag: number[] = [];
  for (let i = 0; i < (rings + 1) * sides; i++) jag.push(range(rng, 0.7, 1.25));
  const pos: number[] = [];
  const ring = (j: number) => {
    const t = j / rings;
    // Bulges and ledges on the way up, tapering to a point.
    const taper = Math.pow(1 - t, 1.5) * (1 + 0.6 * Math.pow(1 - t, 5)) * (1 + 0.2 * Math.sin(t * 11 + r));
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + j * 0.35;
      const rr = r * taper * jag[j * sides + i];
      out.push(new THREE.Vector3(Math.cos(a) * rr + lean.x * t * t, t * h, Math.sin(a) * rr + lean.y * t * t));
    }
    return out;
  };
  const rs = Array.from({ length: rings }, (_, j) => ring(j));
  const tip = new THREE.Vector3(lean.x, h * range(rng, 1.0, 1.08), lean.y);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const a = rs[j][i];
      const b = rs[j][(i + 1) % sides];
      const c = rs[j + 1][i];
      const d = rs[j + 1][(i + 1) % sides];
      tri(a, c, b);
      tri(b, c, d);
    }
  }
  const top = rs[rings - 1];
  for (let i = 0; i < sides; i++) tri(top[i], tip, top[(i + 1) % sides]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Near-black faceted rock with thin veins of lava glowing through it. */
function rockMaterial(time: { value: number }, o: RimOptions): THREE.MeshStandardMaterial {
  // Fully rough: with no texture the facets caught a broad sheen and read as plastic.
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a1c19, roughness: 1, metalness: 0 });
  const textured = !!(o.rock && o.earth);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.lavaTime = time;
    if (textured) {
      shader.uniforms.rockMap = { value: o.rock!.map };
      shader.uniforms.rockNormal = { value: o.rock!.normalMap };
      shader.uniforms.earthMap = { value: o.earth!.map };
      shader.uniforms.earthNormal = { value: o.earth!.normalMap };
      shader.uniforms.earthScale = { value: o.earthScale ?? 0.32 };
      shader.uniforms.earthOrigin = { value: o.earthOrigin ?? 0 };
    }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLavaW;\nvarying vec3 vRockN;').replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vLavaW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
      vRockN = normalize( mat3( modelMatrix ) * objectNormal );`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `${textured ? '#define ROCK_TEX' : ''}
        #include <common>
        varying vec3 vLavaW;
        varying vec3 vRockN;
        uniform float lavaTime;
        #ifdef ROCK_TEX
          uniform sampler2D rockMap, rockNormal, earthMap, earthNormal;
          uniform float earthScale, earthOrigin;
          // Triplanar weights, sharpened so each face takes mostly one projection.
          vec3 rockBlend( vec3 n ) { vec3 b = pow( abs( n ), vec3( 4.0 ) ); return b / ( b.x + b.y + b.z ); }
          vec3 rockTri( sampler2D t, vec3 p, vec3 b, float s ) {
            return texture2D( t, p.zy * s ).rgb * b.x + texture2D( t, p.xz * s ).rgb * b.y + texture2D( t, p.xy * s ).rgb * b.z;
          }
          // Triplanar tangent-space normals, whiteout-blended onto the face normal.
          vec3 rockTriN( sampler2D t, vec3 p, vec3 n, vec3 b, float s, float k ) {
            vec3 tx = texture2D( t, p.zy * s ).xyz * 2.0 - 1.0;
            vec3 ty = texture2D( t, p.xz * s ).xyz * 2.0 - 1.0;
            vec3 tz = texture2D( t, p.xy * s ).xyz * 2.0 - 1.0;
            tx = vec3( tx.xy * k + n.zy, n.x );
            ty = vec3( ty.xy * k + n.xz, n.y );
            tz = vec3( tz.xy * k + n.xy, n.z );
            return normalize( tx.zyx * b.x + ty.xzy * b.y + tz.xyz * b.z );
          }
          float rockEarthW;
          vec3 rockNW;
          float rockLum;
        #endif
        float lavaHash( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
        float lavaNoise( vec3 p ) {
          vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( mix( lavaHash( i ), lavaHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( lavaHash( i + vec3( 0, 1, 0 ) ), lavaHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                      mix( mix( lavaHash( i + vec3( 0, 0, 1 ) ), lavaHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( lavaHash( i + vec3( 0, 1, 1 ) ), lavaHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
        }
        vec3 lavaCell( vec3 c ) { return vec3( lavaHash( c ), lavaHash( c + 17.3 ), lavaHash( c + 41.9 ) ); }
        // Distance to the nearest Voronoi cell border (F2 - F1).
        float lavaEdge( vec3 p ) {
          vec3 i = floor( p ); vec3 f = fract( p );
          float f1 = 8.0; float f2 = 8.0;
          for ( int z = -1; z <= 1; z++ ) for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
            vec3 o = vec3( x, y, z );
            vec3 r = o + lavaCell( i + o ) - f;
            float d = dot( r, r );
            if ( d < f1 ) { f2 = f1; f1 = d; } else if ( d < f2 ) f2 = d;
          }
          return sqrt( f2 ) - sqrt( f1 );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Strata and grit so big facets read as stone, not as flat polygons.
          float g = lavaNoise( vLavaW * 1.7 ) * 0.6 + lavaNoise( vLavaW * 5.0 ) * 0.4;
          float strata = 0.85 + 0.15 * sin( vLavaW.y * 2.3 + lavaNoise( vLavaW * 0.3 ) * 6.0 );
          #ifdef ROCK_TEX
            vec3 rn = normalize( vRockN );
            vec3 rb = rockBlend( rn );
            // Stone grain at two scales, so near faces show chips and far
            // faces still break into patches instead of flat polygons.
            // The last mip is the texture's average, so dividing by it keeps
            // the rock's own tone and only takes the stone's contrast.
            vec3 stoneAvg = max( texture2D( rockMap, vec2( 0.5 ), 16.0 ).rgb, vec3( 0.01 ) );
            float stone = dot( rockTri( rockMap, vLavaW, rb, 0.28 ) / stoneAvg, vec3( 0.333 ) );
            float macro = dot( rockTri( rockMap, vLavaW * 0.16 + 31.0, rb, 0.28 ) / stoneAvg, vec3( 0.333 ) );
            stone = pow( max( stone, 0.0 ), 1.6 ) * ( 0.6 + 0.4 * macro );
            vec3 rock = diffuseColor.rgb * stone * ( 0.75 + g * 0.5 ) * strata * 1.5;
            // Ground creeps up onto ledges and the foot, with a ragged edge.
            vec3 earth = texture2D( earthMap, ( vLavaW.xz - earthOrigin ) * earthScale ).rgb;
            float rag = lavaNoise( vLavaW * 0.9 ) - 0.5;
            float ledge = smoothstep( 0.72, 0.92, rn.y + rag * 0.25 ) * ( 1.0 - smoothstep( 6.0, 22.0, vLavaW.y ) );
            float foot = 1.0 - smoothstep( 0.6, 2.8, vLavaW.y + rag * 2.0 );
            rockEarthW = clamp( max( ledge * 0.85, foot ), 0.0, 1.0 );
            diffuseColor.rgb = mix( rock, earth, rockEarthW );
            rockLum = stone * ( 0.75 + g * 0.5 ) * strata;
          #else
            diffuseColor.rgb *= ( 0.55 + g * 0.8 ) * strata;
          #endif
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        #ifdef ROCK_TEX
        {
          vec3 rn = normalize( vRockN );
          vec3 rb = rockBlend( rn );
          vec3 nr = rockTriN( rockNormal, vLavaW, rn, rb, 0.28, 1.3 );
          vec3 ne = rockTriN( earthNormal, vLavaW, rn, rb, earthScale, 1.0 );
          rockNW = normalize( mix( nr, ne, rockEarthW ) );
          normal = normalize( ( viewMatrix * vec4( rockNW, 0.0 ) ).xyz );
        }
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 p = vLavaW;
          // Cracks run along the borders of 3D Voronoi cells, warped a
          // little so they wander like split stone.
          // Most rock has no cracks; skip the costly Voronoi search there.
          float patchy = smoothstep( 0.6, 0.9, lavaNoise( p * 0.11 + 11.0 ) );
          float low = 1.0 - smoothstep( 1.0, 14.0, p.y );
          float mask = clamp( patchy * ( 0.5 + low ), 0.0, 1.0 );
          if ( mask > 0.0 ) {
            vec3 q = p * 0.42 + vec3( lavaNoise( p * 0.8 ), lavaNoise( p * 0.8 + 5.0 ), lavaNoise( p * 0.8 + 9.0 ) ) * 0.6;
            float v = lavaEdge( q );
            float n = lavaNoise( p * 0.5 );
            float crack = 1.0 - smoothstep( 0.008, 0.03, v );
            float halo = ( 1.0 - smoothstep( 0.0, 0.15, v ) ) * 0.04;
            float pulse = 0.7 + 0.3 * sin( lavaTime * 1.1 + n * 9.0 );
            totalEmissiveRadiance += vec3( 2.1, 0.36, 0.06 ) * ( crack + halo ) * mask * pulse;
          }
          // Red glow of the burning sky on faces turned up to it, so the
          // peaks read as dark rock with lit ledges rather than a black hole.
          float hgt = smoothstep( 0.0, 30.0, p.y );
          #ifdef ROCK_TEX
            // Follow the bumped normal and the stone's grain, or the glow
            // would paint over the texture as a flat wash.
            float up = clamp( rockNW.y, 0.0, 1.0 );
            totalEmissiveRadiance += vec3( 0.075, 0.014, 0.01 ) * ( 0.1 + up * up * 1.3 ) * ( 0.6 + hgt * 0.8 ) * rockLum * 1.3 * ( 1.0 - rockEarthW );
          #else
            vec3 wn = normalize( cross( dFdx( p ), dFdy( p ) ) );
            float up = clamp( wn.y, 0.0, 1.0 );
            totalEmissiveRadiance += vec3( 0.075, 0.014, 0.01 ) * ( 0.2 + up * up * 1.2 ) * ( 0.6 + hgt * 0.8 );
          #endif
        }`,
      );
  };
  installCutaway(mat);
  mat.customProgramCacheKey = () => 'mountainRock';
  return mat;
}
