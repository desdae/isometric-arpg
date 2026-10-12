import * as THREE from 'three';
import { blendWeight, type Character } from '../Character';

// Small shared pieces for the boss bodies and their ability scripts.

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const easeOut = (k: number) => 1 - (1 - k) ** 3;
export const easeIn = (k: number) => k * k * k;
/** 0 → 1 → 0 over k, with a held plateau between `a` and `b`. */
export const hold = (k: number, a: number, b: number) => (k < a ? smooth(0, a, k) : k > b ? 1 - smooth(b, 1, k) : 1);

/**
 * One-shot pose over the gait: `fn(k, w)` gets progress and a blend weight
 * that eases in and out, and may write any joint. `onHit(i)` fires when
 * progress first passes each of `hits`.
 */
export function poseAction(c: { play: Character['play'] }, dur: number, fn: (k: number, w: number) => void, hits: number[] = [], onHit?: (i: number) => void, inK = 0.12, outK = 0.2) {
  let next = 0;
  c.play(
    dur,
    (k) => {
      fn(k, blendWeight(k, inK, outK));
      while (next < hits.length && k >= hits[next]) {
        const i = next++;
        onHit?.(i);
      }
    },
    () => {
      while (next < hits.length) {
        const i = next++;
        onHit?.(i);
      }
    },
  );
}

export const lerp = THREE.MathUtils.lerp;
