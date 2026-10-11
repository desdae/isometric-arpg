import * as THREE from 'three';
import type { Character } from './Character';
import type { NavGrid } from '../world/NavGrid';
import type { HeightFn } from '../procgen/terrain';

// Townsperson behaviour: stand at a home spot (or wander near it), turn to
// face the player when they come close, and offer lines of dialogue.

export interface NpcDef {
  name: string;
  role: string;
  lines: string[];
  home: THREE.Vector3;
  /** Facing (radians) when idle at home. */
  yaw: number;
  /** Wander radius in metres; 0 stays put. */
  wander: number;
}

export class Npc {
  readonly position: THREE.Vector3;
  /** Invisible cylinder used to pick the NPC with the mouse. */
  readonly hit: THREE.Mesh;
  private yaw: number;
  private path: THREE.Vector2[] = [];
  private idleTimer = 2 + Math.random() * 5;
  private speed = 0;
  private lineIndex = 0;
  talking = false;

  constructor(
    readonly def: NpcDef,
    readonly character: Character,
    private nav: NavGrid,
    private height: HeightFn,
    scene: THREE.Scene,
  ) {
    this.position = def.home.clone();
    this.position.y = height(this.position.x, this.position.z);
    this.yaw = def.yaw;
    scene.add(character.root);
    this.hit = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 2, 8).translate(0, 1, 0), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.userData.npc = this;
    this.hit.userData.dynamic = true;
    character.root.add(this.hit);
    this.sync();
  }

  /** Next line of dialogue, cycling. */
  nextLine(): string {
    const line = this.def.lines[this.lineIndex % this.def.lines.length];
    this.lineIndex++;
    return line;
  }

  update(dt: number, player: THREE.Vector3 | null) {
    const toPlayer = player ? new THREE.Vector2(player.x - this.position.x, player.z - this.position.z) : null;
    const near = toPlayer !== null && toPlayer.length() < 5;
    let targetSpeed = 0;

    if ((near && this.path.length === 0) || this.talking) {
      // Hold still and attend to the player.
      this.path = [];
    } else if (this.path.length) {
      const next = this.path[0];
      const d = new THREE.Vector2(next.x - this.position.x, next.y - this.position.z);
      const len = d.length();
      if (len < 0.2) {
        this.path.shift();
      } else {
        targetSpeed = 1.25;
        this.turnToward(Math.atan2(d.x, d.y), dt, 6);
      }
    } else if (this.def.wander > 0) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleTimer = 4 + Math.random() * 8;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * this.def.wander;
        const goal = new THREE.Vector2(this.def.home.x + Math.cos(a) * r, this.def.home.z + Math.sin(a) * r);
        this.path = this.nav.findPath(new THREE.Vector2(this.position.x, this.position.z), goal) ?? [];
      }
    }

    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-dt * 6));
    if (this.speed > 0.01) {
      const step = this.speed * dt;
      const nx = this.position.x + Math.sin(this.yaw) * step;
      const nz = this.position.z + Math.cos(this.yaw) * step;
      if (this.nav.walkable(nx, nz)) {
        this.position.x = nx;
        this.position.z = nz;
      } else {
        this.path = [];
      }
    }
    this.position.y = this.height(this.position.x, this.position.z);

    if (toPlayer && (near || this.talking) && this.path.length === 0) {
      const want = Math.atan2(toPlayer.x, toPlayer.y);
      this.turnToward(want, dt, 3);
      let rel = want - this.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      this.character.lookYaw = THREE.MathUtils.clamp(rel, -0.8, 0.8);
    } else {
      this.character.lookYaw = 0;
      if (this.path.length === 0 && this.def.wander === 0) this.turnToward(this.def.yaw, dt, 1.5);
    }
    this.character.update(dt, this.speed);
    this.sync();
  }

  private turnToward(target: number, dt: number, rate: number) {
    let diff = target - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * (1 - Math.exp(-dt * rate));
  }

  private sync() {
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;
  }
}
