import type { Rng } from '../../procgen/noise';
import { buildGhoul } from './ghoul';
import type { MonsterBody, MonsterMaterials } from './materials';

// Placeholder body until the real model lands.
export function buildBonePriest(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  void scale;
  return buildGhoul(m, rng);
}
