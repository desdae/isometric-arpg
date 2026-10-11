import * as THREE from 'three';

// Replaces three's built-in exponential fog with distance fog plus a ground-
// hugging height fog, broken up by world-space noise so it pools unevenly.
// The FogExp2 density drives the distance part; the height part is set here.
// Must run before any material compiles. Sprites are not supported (their
// shader has no `transformed`), so the game avoids SpriteMaterial.

export const heightFog = {
  /** World height where the ground fog is thickest. */
  base: 0.0,
  /** How quickly the ground fog thins with height. */
  falloff: 0.55,
  /** Maximum opacity contributed by the ground fog. */
  amount: 0.35,
};

export function installHeightFog() {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWP = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    fogWP = instanceMatrix * fogWP;
  #endif
  vFogWorld = ( modelMatrix * fogWP ).xyz;
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float fogHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float fogNoise( vec2 p ) {
    vec2 i = floor( p ); vec2 f = fract( p );
    vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( fogHash( i ), fogHash( i + vec2( 1, 0 ) ), u.x ),
                mix( fogHash( i + vec2( 0, 1 ) ), fogHash( i + vec2( 1, 1 ) ), u.x ), u.y );
  }
#endif
`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  float fogN = fogNoise( vFogWorld.xz * 0.12 ) * 0.65 + fogNoise( vFogWorld.xz * 0.37 + 11.0 ) * 0.35;
  float hf = exp( - max( vFogWorld.y - ${heightFog.base.toFixed(3)}, 0.0 ) / ${heightFog.falloff.toFixed(3)} );
  float groundFog = hf * ${heightFog.amount.toFixed(3)} * smoothstep( 0.15, 0.85, fogN );
  fogFactor = clamp( fogFactor + groundFog * ( 1.0 - fogFactor ), 0.0, 1.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
}
