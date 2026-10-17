import type { Rng } from '../../procgen/noise';
import type { MonsterMaterials } from '../monsters/materials';
import type { BossBody, BossDef } from '../Boss';
import { buildInquisitor, INQUISITOR } from './inquisitor';

// Placeholder until the Silent Abbess lands.
export function buildAbbess(m: MonsterMaterials, rng: Rng, scale = 1.9): BossBody {
  return buildInquisitor(m, rng, scale);
}

export const ABBESS: BossDef = INQUISITOR;
