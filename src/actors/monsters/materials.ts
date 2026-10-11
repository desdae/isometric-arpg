import * as THREE from 'three';
import { bakeSurfaces, pbrMaterial } from '../../procgen/textures';
import type { Rig } from '../Rig';

export interface MonsterMaterials {
  ghoulSkin: THREE.Material;
  bruteSkin: THREE.Material;
  paleSkin: THREE.Material;
  wound: THREE.Material;
  chitin: THREE.Material;
  chitinRed: THREE.Material;
  robe: THREE.Material;
  rag: THREE.Material;
  leather: THREE.Material;
  iron: THREE.Material;
  bone: THREE.Material;
  wood: THREE.Material;
  eyeYellow: THREE.Material;
  eyeRed: THREE.Material;
  crystal: THREE.Material;
  void: THREE.Material;
}

/** A dressed monster body plus the animations its behaviour can call. */
export interface MonsterBody {
  rig: Rig;
  /** Plays the attack; `onHit` fires at the moment of impact (or release). */
  attack(onHit: () => void): void;
  flinch(): void;
  die(): void;
  /** Point the attack comes from (staff tip, mouth), in world space. */
  muzzle?(): THREE.Vector3;
}

let cached: Promise<MonsterMaterials> | null = null;

export function monsterMaterials(): Promise<MonsterMaterials> {
  cached ??= (async () => {
    const [flesh, chitin, cloth, metal, wood] = await bakeSurfaces([
      { kind: 'flesh', seed: 61, size: 512, normalStrength: 3 },
      { kind: 'chitin', seed: 62, size: 512, normalStrength: 4 },
      { kind: 'cloth', seed: 63, size: 256, normalStrength: 1.5 },
      { kind: 'wornMetal', seed: 64, size: 256, normalStrength: 2 },
      { kind: 'deadBark', seed: 65, size: 256, normalStrength: 4 },
    ]);
    const robe = pbrMaterial(cloth, 2, { color: new THREE.Color(0.42, 0.26, 0.26), side: THREE.DoubleSide });
    return {
      ghoulSkin: pbrMaterial(flesh, 2, { color: new THREE.Color(0.26, 0.29, 0.22) }),
      bruteSkin: pbrMaterial(flesh, 2, { color: new THREE.Color(0.36, 0.2, 0.17) }),
      paleSkin: pbrMaterial(flesh, 2, { color: new THREE.Color(0.38, 0.35, 0.32) }),
      wound: new THREE.MeshStandardMaterial({ color: 0x2a0303, roughness: 0.25 }),
      chitin: pbrMaterial(chitin, 2, { color: new THREE.Color(0.16, 0.13, 0.13) }),
      chitinRed: pbrMaterial(chitin, 2, { color: new THREE.Color(0.5, 0.06, 0.04) }),
      robe,
      rag: pbrMaterial(cloth, 2, { color: new THREE.Color(0.55, 0.5, 0.42), side: THREE.DoubleSide }),
      leather: new THREE.MeshStandardMaterial({ color: 0x24170f, roughness: 0.75 }),
      iron: pbrMaterial(metal, 2, { color: new THREE.Color(0.55, 0.42, 0.34) }),
      bone: new THREE.MeshStandardMaterial({ color: 0x9a8c72, roughness: 0.6 }),
      wood: pbrMaterial(wood, 2),
      eyeYellow: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.6, 0.5), fog: false }),
      eyeRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.35, 0.15), fog: false }),
      crystal: new THREE.MeshStandardMaterial({ color: 0x200000, emissive: new THREE.Color(3.5, 0.15, 0.08), roughness: 0.2 }),
      void: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    };
  })();
  return cached;
}
