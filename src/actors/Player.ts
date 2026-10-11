import * as THREE from 'three';
import { Character } from './Character';
import type { NavGrid } from '../world/NavGrid';
import type { HeightFn } from '../procgen/terrain';

// Click-to-move controller: left click (or hold) sets a destination on the
// terrain, A* plans a path, and the character walks it with smoothed speed
// and turning while the procedural gait follows the actual ground speed.

export class Player {
  readonly position = new THREE.Vector3();
  private path: THREE.Vector2[] = [];
  private velocity = new THREE.Vector2();
  private yaw = 0;
  readonly maxSpeed = 4.6;
  private marker: THREE.Mesh;
  private markerAge = 10;

  constructor(
    readonly character: Character,
    private nav: NavGrid,
    private height: HeightFn,
    scene: THREE.Scene,
    spawn: THREE.Vector3,
    yaw = 0,
  ) {
    this.position.copy(spawn);
    this.yaw = yaw;
    scene.add(character.root);
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.32, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.5, 0.2), transparent: true, depthWrite: false, fog: false }),
    );
    this.marker.visible = false;
    scene.add(this.marker);
    this.syncTransform();
  }

  moveTo(target: THREE.Vector3, showMarker = true) {
    const path = this.nav.findPath(new THREE.Vector2(this.position.x, this.position.z), new THREE.Vector2(target.x, target.z));
    if (!path || path.length === 0) return;
    this.path = path;
    if (showMarker) {
      const end = path[path.length - 1];
      this.marker.position.set(end.x, this.height(end.x, end.y) + 0.04, end.y);
      this.markerAge = 0;
    }
  }

  update(dt: number) {
    const pos2 = new THREE.Vector2(this.position.x, this.position.z);
    let desired = new THREE.Vector2();
    while (this.path.length) {
      const next = this.path[0];
      const toNext = next.clone().sub(pos2);
      const d = toNext.length();
      if (d < 0.15 || (this.path.length > 1 && d < 0.6)) {
        this.path.shift();
        continue;
      }
      // Ease in to the final waypoint.
      const speed = this.path.length === 1 ? Math.min(this.maxSpeed, d * 3.5) : this.maxSpeed;
      desired = toNext.multiplyScalar(speed / d);
      break;
    }
    // Accelerate toward the desired velocity.
    this.velocity.lerp(desired, 1 - Math.exp(-dt * 9));
    const step = this.velocity.clone().multiplyScalar(dt);
    const nx = this.position.x + step.x;
    const nz = this.position.z + step.y;
    if (this.nav.walkable(nx, nz)) {
      this.position.x = nx;
      this.position.z = nz;
    } else {
      this.velocity.set(0, 0);
      this.path = [];
    }
    this.position.y = this.height(this.position.x, this.position.z);

    const speed = this.velocity.length();
    if (speed > 0.2) {
      const targetYaw = Math.atan2(this.velocity.x, this.velocity.y);
      let diff = targetYaw - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * (1 - Math.exp(-dt * 12));
    }
    this.character.update(dt, speed);
    this.syncTransform();

    this.markerAge += dt;
    this.marker.visible = this.markerAge < 0.6;
    if (this.marker.visible) {
      const t = this.markerAge / 0.6;
      this.marker.scale.setScalar(1 + t * 0.8);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
  }

  private syncTransform() {
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;
  }
}

/** Wires mouse input: click or hold the left button on the ground to move. */
export function bindClickToMove(dom: HTMLElement, camera: THREE.Camera, ground: THREE.Object3D, player: Player) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let held = false;
  let lastIssue = 0;
  const issue = (e: PointerEvent, marker: boolean) => {
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(ground, false)[0];
    if (hit) player.moveTo(hit.point, marker);
  };
  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = true;
    issue(e, true);
  });
  window.addEventListener('pointerup', () => (held = false));
  dom.addEventListener('pointermove', (e) => {
    if (!held) return;
    const now = performance.now();
    if (now - lastIssue < 120) return;
    lastIssue = now;
    issue(e, false);
  });
}
