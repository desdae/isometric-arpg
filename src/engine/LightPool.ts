import * as THREE from 'three';
import { perlin2, smoothstep } from '../procgen/noise';
import { cutaway } from './cutaway';

// Many small flames (hearths, oil lamps, wall torches), few real lights. A
// fixed handful of point lights follows the hero and is handed each frame to
// the nearest emitters. The light count never changes, so no shader
// recompiles, and lights fade out before they are reassigned, so nothing pops.

export interface Emitter {
  pos: THREE.Vector3;
  intensity: number;
  range: number;
  phase: number;
  /** 0 = steady oil flame, 1 = lively open fire. */
  lively: number;
}

export class LightPool {
  readonly emitters: Emitter[] = [];
  private lights: THREE.PointLight[] = [];
  private order: { e: Emitter; d: number }[] = [];

  constructor(scene: THREE.Scene, count: number, color: THREE.ColorRepresentation = 0xff7a30) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(color, 0, 8, 2);
      scene.add(l);
      this.lights.push(l);
    }
  }

  add(pos: THREE.Vector3, intensity: number, range: number, lively = 1): Emitter {
    const e = { pos: pos.clone(), intensity, range, phase: Math.random() * 100, lively };
    this.emitters.push(e);
    return e;
  }

  update(t: number, focus: THREE.Vector3 = cutaway.hero.value) {
    const o = this.order;
    o.length = 0;
    for (const e of this.emitters) o.push({ e, d: e.pos.distanceTo(focus) });
    o.sort((a, b) => a.d - b.d);
    const n = this.lights.length;
    // The first emitter left out sets the fade edge, so a light reaches zero
    // exactly when its emitter is about to lose its slot.
    const edge = o.length > n ? o[n].d : Infinity;
    for (let i = 0; i < n; i++) {
      const l = this.lights[i];
      const s = o[i];
      if (!s) {
        l.intensity = 0;
        continue;
      }
      const { e, d } = s;
      const fade = edge === Infinity ? 1 : 1 - smoothstep(edge * 0.7, edge, d);
      const k = e.lively;
      const flick = 0.82 + (0.12 + 0.1 * k) * perlin2(t * (2.5 + 4 * k) + e.phase, e.phase) + 0.06 * k * perlin2(t * 19, e.phase * 3);
      l.position.copy(e.pos);
      l.distance = e.range;
      l.intensity = e.intensity * flick * fade;
    }
  }
}

/** Shared clock for flickering emissive surfaces (windows, doorways). */
export const flickerTime = { value: 0 };

/**
 * Makes a material's emissive glow breathe like firelight behind it. Each
 * 3 m cell of the world gets its own phase and brightness, so one house's
 * windows flicker together while the next house burns lower.
 */
export function installFlicker(mat: THREE.MeshStandardMaterial) {
  const prev = mat.onBeforeCompile;
  mat.customProgramCacheKey = () => 'flicker';
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.flickTime = flickerTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFlickW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFlickW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFlickW;\nuniform float flickTime;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec2 cell = floor( vFlickW.xz / 3.0 );
          float ph = fract( sin( dot( cell, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 40.0;
          float f = 0.74 + 0.13 * sin( flickTime * 5.3 + ph ) + 0.08 * sin( flickTime * 11.7 + ph * 1.7 ) + 0.05 * sin( flickTime * 23.1 + ph * 2.3 );
          float level = 0.45 + 0.7 * fract( ph * 7.13 );
          totalEmissiveRadiance *= f * level;
        }`,
      );
  };
}
