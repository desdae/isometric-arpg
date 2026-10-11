import * as THREE from 'three';
import { createNightScene, type World } from '../world/World';

// Bare stage for inspecting the procedural character and its gait.
export async function buildCharacterPreview(): Promise<World> {
  const { scene, moon } = createNightScene();
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(12, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.9 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);
  const key = new THREE.PointLight(0xffc8a0, 25, 12, 1.5);
  key.position.set(2.5, 3, 3);
  scene.add(key);
  return { scene, moon, ground, heightAt: () => 0, spawn: new THREE.Vector3(), extent: 12, update() {} };
}
