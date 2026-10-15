import * as THREE from 'three';
import type { Waypoint } from './Waypoint';
import type { HeightFn } from '../procgen/terrain';
import type { NavGrid } from './NavGrid';
import type { Npc } from '../actors/Npc';
import type { Monster, MonsterSpawn } from '../actors/Monster';
import type { Effects } from '../game/Effects';

export type AreaName = 'town' | 'zone' | 'dungeon' | 'swamp' | 'gaol1' | 'gaol2';

/** A way out of an area: walk into it to travel. */
export interface Exit {
  pos: THREE.Vector3;
  radius: number;
  to: AreaName;
  entry: string;
  label: string;
}

/** Something in the world the hero can walk up to and use (click its label). */
export interface Interactable {
  pos: THREE.Vector3;
  radius: number;
  label: string;
  active(): boolean;
  use(): void;
}

/** What an area script may do to the game. */
export interface ScriptContext {
  player: { position: THREE.Vector3; alive: boolean };
  monsters: Monster[];
  effects: Effects;
  /** Big centred banner. */
  banner(title: string, subtitle: string): void;
  /** Small floating text over the hero. */
  say(text: string): void;
}

/** Scripted goals for an area (the dungeon's objectives and boss door). */
export interface AreaScript {
  title: string;
  objectives(): { text: string; done: boolean }[];
  interactables: Interactable[];
  /** True once the area's final goal is met. */
  finished: boolean;
  update(dt: number, ctx: ScriptContext): void;
  onKill(m: Monster, ctx: ScriptContext): void;
}

// What a playable area hands to the game loop.
export interface World {
  scene: THREE.Scene;
  moon: THREE.DirectionalLight;
  /** Mesh the mouse ray is cast against for click-to-move. */
  ground: THREE.Object3D;
  heightAt: HeightFn;
  nav?: NavGrid;
  spawn?: THREE.Vector3;
  spawnYaw?: number;
  /** Preferred camera yaw for this area, in radians. */
  cameraYaw?: number;
  /** Half-size of the playable square, used to size mist and fog. */
  extent: number;
  /** Townsfolk the player can click to talk to. */
  npcs?: Npc[];
  /** Area name shown on arrival, with a line beneath it. */
  title?: string;
  subtitle?: string;
  exits?: Exit[];
  /** Named arrival points (other areas' exits lead to these). */
  entries?: Record<string, { pos: THREE.Vector3; yaw: number }>;
  monsterSpawns?: MonsterSpawn[];
  /** This area's waypoint, if it has one. */
  waypoint?: Waypoint;
  /** Underground: no sky, denser fog, the dead stay dead. */
  indoor?: boolean;
  /** Multiplies the distance fog density. */
  fogScale?: number;
  script?: AreaScript;
  update(dt: number, t: number): void;
}

/**
 * Direction to the moon, as an offset from the shadow focus. High in the sky
 * so tall spires cast short shadows instead of long streaks across the field.
 */
export const MOON_OFFSET = new THREE.Vector3(-22, 62, 14);

/** Shared night lighting: red-tinted moon with shadows, dark hemisphere fill, red fog. */
export function createNightScene(): { scene: THREE.Scene; moon: THREE.DirectionalLight } {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x521410, 0.014);
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.62, 0.3, 0.28), new THREE.Color(0.1, 0.06, 0.06), 1.0));
  const moon = new THREE.DirectionalLight(new THREE.Color(1.0, 0.58, 0.52), 2.3);
  moon.position.copy(MOON_OFFSET);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.left = sc.bottom = -38;
  sc.right = sc.top = 38;
  sc.near = 1;
  sc.far = 160;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.04;
  moon.shadow.radius = 3;
  scene.add(moon, moon.target);
  return { scene, moon };
}
