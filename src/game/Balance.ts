// Difficulty curves, all in one place, built to hold from level 1 to the cap.
//
// The hero's numbers grow roughly like this with level: life and armour in a
// straight line (class base plus gear whose rolls scale with item level), and
// damage faster than that (gear damage times a per-level multiplier), so a
// monster that only grew in a straight line would fall further behind every
// level. Monsters therefore grow along gentle quadratics, and the hero's
// defences are measured against their own level so that stacking armour or
// leech flattens out instead of running away to immortality.

/** Planned maximum hero level; the curves are tuned to stay sane up to here. */
export const LEVEL_CAP = 60;

/** Monster life multiplier at a level (1 at level 1). */
export function monsterLifeScale(level: number) {
  const x = Math.max(0, level - 1);
  return 1 + 0.28 * x + 0.015 * x * x;
}

/** Monster damage multiplier at a level (1 at level 1). */
export function monsterDamageScale(level: number) {
  const x = Math.max(0, level - 1);
  return 1 + 0.16 * x + 0.04 * Math.pow(x, 1.5);
}

/**
 * Monster armour multiplier at a level. Armour is measured against a fixed
 * yardstick when the hero strikes, so it rises early (deeper monsters feel
 * sturdier) and then levels off rather than turning every blow into a scratch;
 * life carries the later growth.
 */
export function monsterArmorScale(level: number) {
  const x = Math.max(0, level - 1);
  return 1 + 2.6 * (1 - Math.exp(-x / 9));
}

/**
 * The hero's armour yardstick: the armour that halves a blow at their level.
 * It holds at 50 for the first few levels (as it always was) and then climbs
 * with level, so gear armour keeps its worth without ever soaking everything.
 */
export function heroArmorHalf(level: number) {
  return 50 + 8 * Math.max(0, level - 3);
}

/** The most armour can ever soak, however much is stacked. */
export const MAX_ARMOR_SOAK = 0.75;

/** Damage the hero actually takes from a blow after armour, at their level. */
export function mitigateHero(amount: number, armor: number, level: number) {
  const k = heroArmorHalf(level);
  const taken = Math.max(1 - MAX_ARMOR_SOAK, k / (k + Math.max(0, armor)));
  return Math.max(1, Math.round(amount * taken));
}

/**
 * Life steal heals at most this share of maximum life per second (with a
 * small reserve so a single big hit still pays out), however fast or wide
 * the hero swings. Leech helps in a fight; it should not out-heal one.
 */
export const LEECH_PER_SEC = 0.02;
export const LEECH_RESERVE = 0.04;

/**
 * Signature attacks: a monster's heavy, telegraphed blow, as a multiple of
 * its ordinary hit at its level. Low-level heroes wear little armour, so the
 * multiple starts small and grows as gear does; across the whole range a
 * same-level hero in level-appropriate gear loses roughly a third of their
 * life to one (a champion's hits harder still).
 */
export function signatureMult(level: number) {
  return 4 + 3.4 * (1 - Math.exp(-Math.max(0, level - 3) / 3));
}

/**
 * Monsters never fall more than one level below the hero, so the early zones
 * stay dangerous to an over-levelled hero instead of turning into a faceroll.
 * Game keeps this in step with the hero's level.
 */
export const heroLevel = { value: 1 };
export function levelFloor() {
  return Math.min(LEVEL_CAP, heroLevel.value - 1);
}
