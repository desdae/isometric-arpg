import * as THREE from 'three';
import { Character, blendWeight, sampleKeys, type PoseKey } from '../Character';

// Shared poses for the humanoid monsters.

/** Rocks the upper body back as if struck. */
export function flinch(c: Character, amount = 0.35) {
  if (c.acting) return; // never interrupt an attack wind-up
  c.play(0.32, (k) => {
    const s = Math.sin(k * Math.PI) * amount;
    c.spine.rotation.x -= s;
    c.head.rotation.x -= s * 0.8;
    for (const a of c.arms) a.upper.rotation.x += s * 0.8;
  });
}

/** Topples backward (or forward) and goes limp; the pose then stays frozen. */
export function collapse(c: Character, forward = Math.random() < 0.35) {
  const dir = forward ? 1 : -1;
  const twist = (Math.random() - 0.5) * 0.8;
  c.play(0.85, (k) => {
    // Knees buckle first, then the body falls with gravity's ease-in.
    const fall = Math.min(1, Math.max(0, (k - 0.15) / 0.85));
    const f = fall * fall;
    c.body.rotation.x = dir * f * 1.42;
    c.body.rotation.y = twist * f;
    c.body.position.y = 0.08 * f;
    c.body.position.z = -dir * 0.15 * f;
    const buckle = Math.sin(Math.min(1, k * 2) * Math.PI * 0.5);
    for (const l of c.legs) {
      l.thigh.rotation.x = -0.6 * buckle * (1 - f) - 0.2 * f;
      l.shin.rotation.x = 1.0 * buckle * (1 - f) + 0.15 * f;
    }
    for (const a of c.arms) {
      a.upper.rotation.x = -dir * 1.4 * f + a.restUpper * (1 - f);
      a.upper.rotation.z = a.side * (0.12 + 0.9 * f);
      a.fore.rotation.x = -0.25 * f + a.restFore * (1 - f);
    }
    c.spine.rotation.x = dir * 0.15 * f;
    c.head.rotation.x = -dir * 0.4 * f;
    c.head.rotation.y = twist * 1.4 * f;
  });
}

/** Plays keyed arm/spine poses blended over the gait. Keys use u{L,R}, f{L,R}, s (spine X), t (spine Y). */
export function keyedAction(c: Character, dur: number, keys: PoseKey[], hitAt: number, onHit: () => void, extra?: (k: number, w: number, p: Record<string, number>) => void) {
  let fired = false;
  const zL0 = c.arm(-1).upper.rotation.z;
  const zR0 = c.arm(1).upper.rotation.z;
  c.play(
    dur,
    (k) => {
      const p = sampleKeys(keys, k);
      const w = blendWeight(k, 0.12, 0.22);
      const L = c.arm(-1);
      const R = c.arm(1);
      if ('uL' in p) L.upper.rotation.x = THREE.MathUtils.lerp(L.upper.rotation.x, p.uL, w);
      if ('uR' in p) R.upper.rotation.x = THREE.MathUtils.lerp(R.upper.rotation.x, p.uR, w);
      if ('fL' in p) L.fore.rotation.x = THREE.MathUtils.lerp(L.fore.rotation.x, p.fL, w);
      if ('fR' in p) R.fore.rotation.x = THREE.MathUtils.lerp(R.fore.rotation.x, p.fR, w);
      if ('zL' in p) L.upper.rotation.z = THREE.MathUtils.lerp(zL0, p.zL, w);
      if ('zR' in p) R.upper.rotation.z = THREE.MathUtils.lerp(zR0, p.zR, w);
      if ('s' in p) c.spine.rotation.x += p.s * w;
      if ('t' in p) c.spine.rotation.y += p.t * w;
      extra?.(k, w, p);
      if (!fired && k >= hitAt) {
        fired = true;
        onHit();
      }
    },
    () => {
      if (!fired) onHit();
    },
  );
}
