import * as THREE from 'three';
import { settings } from '../game/Settings';

// ARPG-style camera: a narrow-FOV perspective camera looking down at a fixed
// yaw and pitch, orbiting a ground target. Narrow FOV keeps the near-isometric
// look while still giving buildings real depth. WASD/arrows pan, the wheel
// zooms, the rotate keys (Q/E unless rebound) turn in 45 degree steps.

export class IsoCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  distance = 32;
  minDistance = 12;
  maxDistance = 70;
  pitch = THREE.MathUtils.degToRad(48);
  yaw = THREE.MathUtils.degToRad(45);
  private targetYaw = this.yaw;
  set targetYawValue(v: number) {
    this.targetYaw = v;
  }
  private keys = new Set<string>();
  private smoothTarget = new THREE.Vector3();
  private smoothDistance = this.distance;

  constructor(aspect: number, dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(30, aspect, 1, 400);
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (settings.is('rotateLeft', e)) this.targetYaw -= Math.PI / 4;
      if (settings.is('rotateRight', e)) this.targetYaw += Math.PI / 4;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), this.minDistance, this.maxDistance);
      },
      { passive: false },
    );
    this.smoothTarget.copy(this.target);
    this.update(0);
  }

  update(dt: number) {
    const speed = this.distance * 0.9 * dt;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) this.target.addScaledVector(forward, speed);
    if (k.has('s') || k.has('arrowdown')) this.target.addScaledVector(forward, -speed);
    if (k.has('d') || k.has('arrowright')) this.target.addScaledVector(right, speed);
    if (k.has('a') || k.has('arrowleft')) this.target.addScaledVector(right, -speed);

    const t = 1 - Math.exp(-dt * 10);
    this.smoothTarget.lerp(this.target, dt > 0 ? t : 1);
    this.smoothDistance += (this.distance - this.smoothDistance) * (dt > 0 ? t : 1);
    this.yaw += (this.targetYaw - this.yaw) * (dt > 0 ? 1 - Math.exp(-dt * 8) : 1);

    const d = this.smoothDistance;
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch) * d,
      Math.sin(this.pitch) * d,
      Math.cos(this.yaw) * Math.cos(this.pitch) * d,
    );
    this.camera.position.copy(this.smoothTarget).add(offset);
    this.camera.lookAt(this.smoothTarget);
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
