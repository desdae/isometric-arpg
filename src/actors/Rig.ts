import type * as THREE from 'three';

/** What behaviours need from an animated body: humanoid Character or the crawler. */
export interface Rig {
  readonly root: THREE.Object3D;
  /** The scaled body under `root`; death and lunge poses move it. */
  readonly body: THREE.Object3D;
  lookYaw: number;
  update(dt: number, speed: number): void;
  play(dur: number, fn: (k: number) => void, done?: () => void): void;
  readonly acting: boolean;
  cancelAction(): void;
}
