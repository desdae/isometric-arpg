import * as THREE from 'three';

// See-through cutaway: architecture standing between the camera and the hero
// dissolves in a soft circle around them, so the hero is never lost behind a
// house. The building meshes are merged per material, so fading whole meshes
// isn't an option; instead each fragment checks whether it lies inside a
// cylinder from the camera to the hero and is dithered away. Shadows still
// come from the full geometry (the shadow pass uses its own depth material).

export const cutaway = {
  /** Hero chest position in world space. */
  hero: { value: new THREE.Vector3(0, -1000, 0) },
  /** Cylinder radius in metres. */
  radius: { value: 1.7 },
  /** 0 = off, 1 = full; eased so the cut opens and closes smoothly. */
  amount: { value: 0 },
};

export function installCutaway(mat: THREE.Material) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.cutHero = cutaway.hero;
    shader.uniforms.cutRadius = cutaway.radius;
    shader.uniforms.cutAmount = cutaway.amount;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cutWP = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          cutWP = instanceMatrix * cutWP;
        #endif
        vCutWorld = ( modelMatrix * cutWP ).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCutWorld;
        uniform vec3 cutHero;
        uniform float cutRadius;
        uniform float cutAmount;
        float cutBayer( vec2 p ) {
          // 4x4 ordered dither threshold in [0, 1).
          ivec2 i = ivec2( mod( p, 4.0 ) );
          int idx = i.x + i.y * 4;
          float m[16] = float[16]( 0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5. );
          return ( m[ idx ] + 0.5 ) / 16.0;
        }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if ( cutAmount > 0.0 ) {
          vec3 toHero = cutHero - cameraPosition;
          float heroDist = length( toHero );
          vec3 dir = toHero / heroDist;
          vec3 rel = vCutWorld - cameraPosition;
          float along = dot( rel, dir );
          // Only what is in front of the hero and above their feet; floors and
          // the ground they stand on stay.
          if ( along < heroDist - 0.8 && vCutWorld.y > cutHero.y - 0.85 ) {
            float perp = length( rel - dir * along );
            float k = 1.0 - smoothstep( cutRadius * 0.7, cutRadius, perp );
            // Ease in right in front of the hero so the cut has no hard back edge.
            k *= smoothstep( heroDist - 0.8, heroDist - 2.2, along );
            if ( k * cutAmount > cutBayer( gl_FragCoord.xy ) ) discard;
          }
        }`,
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '|cutaway';
  mat.needsUpdate = true;
}
