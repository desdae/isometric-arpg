import * as THREE from 'three';

// Blood water: a dark, glossy surface with wind ripples, rings spreading from
// drips, the bottom showing through the shallows and a red glow along every
// shore. `depthMap` holds the ground under it: ground = r * 2.5 - 1.5 metres
// relative to the surface. With `dryDiscard`, ground above the surface cuts
// the water away (pools on a flat floor).

/** Blood-red swamp water: glossy, wind-rippled, with rings of red light spreading where things move beneath. */
export function bloodWater(size: number, time: { value: number }, depthMap: THREE.Texture, dryDiscard = false): THREE.MeshStandardMaterial {
  // Pools on a floor are thinner and redder, and let the stone show through.
  const mat = new THREE.MeshStandardMaterial({
    color: dryDiscard ? new THREE.Color(0.11, 0.006, 0.004) : new THREE.Color(0.022, 0.0015, 0.0015),
    roughness: dryDiscard ? 0.1 : 0.16,
    metalness: 0.0,
    envMapIntensity: 0.3,
    transparent: dryDiscard,
    depthWrite: !dryDiscard,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = time;
    shader.uniforms.waterDepth = { value: depthMap };
    shader.uniforms.waterSize = { value: size };
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
          ${dryDiscard ? 'if ( depth < 0.0 ) discard;' : ''}
          waterShallow = 1.0 - smoothstep( 0.0, 0.4, depth );
          float wob = waterNoise( vWaterP * 1.3 + waterTime * 0.3 ) * 0.04;
          waterShore = exp( -pow( ( depth - 0.03 - wob ) * 30.0, 2.0 ) ) * step( -0.05, depth );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.045, 0.014, 0.008 ), waterShallow * 0.8 );
          diffuseColor.rgb *= 0.75 + 0.5 * waterNoise( vWaterP * 0.35 );
          ${dryDiscard ? 'diffuseColor.a = mix( 0.45, 0.9, smoothstep( 0.0, 0.5, depth ) );' : ''}
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
  // The two flavours compile differently; don't let them share a program.
  mat.customProgramCacheKey = () => `bloodWater:${dryDiscard}`;
  return mat;
}
