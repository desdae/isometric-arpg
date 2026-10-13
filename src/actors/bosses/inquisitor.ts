import type { Rng } from '../../procgen/noise';
import type { MonsterMaterials } from '../monsters/materials';
import type { BossBody, BossDef } from '../Boss';
import { buildLich, LICH } from './lich';

// Placeholder until the Grand Inquisitor lands.
export function buildInquisitor(m: MonsterMaterials, rng: Rng): BossBody {
  return buildLich(m, rng);
}
export const INQUISITOR: BossDef = LICH;
