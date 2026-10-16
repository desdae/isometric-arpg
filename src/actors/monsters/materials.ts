import * as THREE from 'three';
import { bakeSurfaces, pbrMaterial } from '../../procgen/textures';
import type { Rig } from '../Rig';

export interface MonsterMaterials {
  ghoulSkin: THREE.Material;
  bruteSkin: THREE.Material;
  /** Weathered human skin for the brute. */
  tannedSkin: THREE.Material;
  hair: THREE.Material;
  steel: THREE.Material;
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
  /** Mire beasts: warty olive toad hide, its pale belly and dark blotches. */
  toadSkin: THREE.Material;
  toadBelly: THREE.Material;
  toadDark: THREE.Material;
  /** Ridged, near-black swamp lizard hide. */
  crocHide: THREE.Material;
  /** Waterlogged, moss-dark bark for the root horror. */
  swampBark: THREE.Material;
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
  /** Bursts up out of water it lay hidden in (mire leeches), over `dur` seconds. */
  emerge?(dur: number): void;
}

let cached: Promise<MonsterMaterials> | null = null;

export function monsterMaterials(): Promise<MonsterMaterials> {
  cached ??= (async () => {
    const [flesh, chitin, cloth, metal, wood, skin, hair] = await bakeSurfaces([
      { kind: 'flesh', seed: 61, size: 512, normalStrength: 3 },
      { kind: 'chitin', seed: 62, size: 512, normalStrength: 4 },
      { kind: 'cloth', seed: 63, size: 256, normalStrength: 1.5 },
      { kind: 'wornMetal', seed: 64, size: 256, normalStrength: 2 },
      { kind: 'deadBark', seed: 65, size: 256, normalStrength: 4 },
      { kind: 'skin', seed: 66, size: 512, normalStrength: 2 },
      { kind: 'hair', seed: 67, size: 256, normalStrength: 5 },
    ]);
    const robe = pbrMaterial(cloth, 2, { color: new THREE.Color(0.42, 0.26, 0.26), side: THREE.DoubleSide });
    return {
      ghoulSkin: pbrMaterial(flesh, 2, { color: new THREE.Color(0.26, 0.29, 0.22) }),
      bruteSkin: pbrMaterial(flesh, 2, { color: new THREE.Color(0.36, 0.2, 0.17) }),
      tannedSkin: pbrMaterial(skin, 2, { color: new THREE.Color(0.74, 0.52, 0.39), metalness: 0 }),
      hair: pbrMaterial(hair, 3, { color: new THREE.Color(0.17, 0.1, 0.055), metalness: 0 }),
      steel: pbrMaterial(metal, 2, { color: new THREE.Color(0.5, 0.49, 0.48) }),
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
      toadSkin: pbrMaterial(flesh, 3, { color: new THREE.Color(0.16, 0.22, 0.06), roughness: 0.55 }),
      toadBelly: pbrMaterial(flesh, 2, { color: new THREE.Color(0.42, 0.4, 0.2) }),
      toadDark: new THREE.MeshStandardMaterial({ color: 0x1a1c08, roughness: 0.55 }),
      crocHide: pbrMaterial(chitin, 3, { color: new THREE.Color(0.1, 0.12, 0.08) }),
      swampBark: pbrMaterial(wood, 1.5, { color: new THREE.Color(0.42, 0.36, 0.3) }),
    };
  })();
  return cached;
}
