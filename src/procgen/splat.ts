import * as THREE from 'three';
import type { PbrSet } from './textures';
import { clamp01 } from './noise';

// Ground material that blends two PBR sets through a mask. The blend is
// height-aware: where layer B's albedo is brighter (stone tops) it wins
// earlier, so cobbles poke through mud instead of fading like a crossfade.

/**
 * World-scale control map. R = layer B weight, G = blood, B = wetness. These
 * vary over the whole ground rather than repeating with the material tiles.
 */
export function maskTexture(size: number, fn: (u: number, v: number) => [number, number, number]): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [m, blood, wet] = fn(x / (size - 1), y / (size - 1));
      const i = (y * size + x) * 4;
      data[i] = Math.round(clamp01(m) * 255);
      data[i + 1] = Math.round(clamp01(blood) * 255);
      data[i + 2] = Math.round(clamp01(wet) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function splatMaterial(a: PbrSet, repeatA: number, b: PbrSet, repeatB: number, mask: THREE.Texture) {
  for (const t of [a.map, a.normalMap, a.ormMap]) t.repeat.set(repeatA, repeatA);
  const mat = new THREE.MeshStandardMaterial({
    map: a.map,
    normalMap: a.normalMap,
    aoMap: a.ormMap,
    roughnessMap: a.ormMap,
    metalnessMap: a.ormMap,
    roughness: 1,
    metalness: 1,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.splatMap = { value: b.map };
    shader.uniforms.splatNormal = { value: b.normalMap };
    shader.uniforms.splatOrm = { value: b.ormMap };
    shader.uniforms.splatMask = { value: mask };
    shader.uniforms.splatRepeat = { value: repeatB };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSplatUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSplatUv = uv;');
    const C = THREE.ShaderChunk;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vSplatUv;
        uniform sampler2D splatMap, splatNormal, splatOrm, splatMask;
        uniform float splatRepeat;`,
      )
      .replace(
        '#include <map_fragment>',
        C.map_fragment.replace(
          'vec4 sampledDiffuseColor = texture2D( map, vMapUv );',
          `vec2 splatUv = vSplatUv * splatRepeat;
          vec4 splatAlbedo = texture2D( splatMap, splatUv );
          vec3 splatCtl = texture2D( splatMask, vSplatUv ).rgb;
          float splatM = splatCtl.r;
          float splatH = dot( splatAlbedo.rgb, vec3( 0.33 ) ) * 3.0;
          float splatW = smoothstep( 0.35, 0.65, splatM + ( splatH - 0.35 ) * 0.35 );
          vec4 sampledDiffuseColor = mix( texture2D( map, vMapUv ), splatAlbedo, splatW );
          // Low spots (dark texels) collect blood and water first.
          float splatLow = 1.0 - smoothstep( 0.02, 0.12, dot( sampledDiffuseColor.rgb, vec3( 0.33 ) ) );
          float splatBlood = smoothstep( 0.25, 0.75, splatCtl.g + splatLow * 0.25 );
          float splatWet = smoothstep( 0.2, 0.8, splatCtl.b + splatLow * 0.3 );
          sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, vec3( 0.13, 0.008, 0.006 ), splatBlood * 0.85 );
          sampledDiffuseColor.rgb *= 1.0 - splatWet * 0.35;`,
        ),
      )
      .replace(
        '#include <roughnessmap_fragment>',
        C.roughnessmap_fragment.replace(
          'vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );',
          `vec4 texelRoughness = mix( texture2D( roughnessMap, vRoughnessMapUv ), texture2D( splatOrm, splatUv ), splatW );
          texelRoughness.g = mix( texelRoughness.g, 0.18, max( splatWet, splatBlood * 0.8 ) );`,
        ),
      )
      .replace(
        '#include <metalnessmap_fragment>',
        C.metalnessmap_fragment.replace(
          'vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );',
          'vec4 texelMetalness = mix( texture2D( metalnessMap, vMetalnessMapUv ), texture2D( splatOrm, splatUv ), splatW );',
        ),
      )
      .replace(
        '#include <normal_fragment_maps>',
        C.normal_fragment_maps.replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          'vec3 mapN = mix( texture2D( normalMap, vNormalMapUv ).xyz, texture2D( splatNormal, splatUv ).xyz, splatW ) * 2.0 - 1.0;',
        ),
      )
      .replace(
        '#include <aomap_fragment>',
        C.aomap_fragment.replace(
          'texture2D( aoMap, vAoMapUv ).r',
          'mix( texture2D( aoMap, vAoMapUv ).r, texture2D( splatOrm, splatUv ).r, splatW )',
        ),
      );
  };
  return mat;
}
