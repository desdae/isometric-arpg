import type { Item, ItemStats, Slot } from './Items';
import { BELT_KEYS, SK, SKILL, SKILLS, TIER_NEEDS, type Branch, type SkillId } from './Skills';

// The hero's numbers: level and experience, life and mana, damage and armour,
// all recomputed from level plus whatever is equipped.

export const SLOTS: Slot[] = ['weapon', 'helm', 'armor', 'gloves', 'boots', 'ring', 'amulet'];

export class Stats {
  level = 1;
  xp = 0;
  gold = 0;
  potions = 3;
  hp = 100;
  mana = 60;
  maxHp = 100;
  maxMana = 60;
  dmgMin = 7;
  dmgMax = 13;
  armor = 10;
  crit = 0.05;
  attackSpeed = 0;
  lifeSteal = 0;
  regen = 0.6;
  /** Ranks learned in the skill tree (Cleave comes free). */
  readonly ranks: Partial<Record<SkillId, number>> = { cleave: 1 };
  /** Unspent skill points: one per level, plus one to start. */
  skillPoints = 1;
  /** Which active skill sits on each belt key. */
  readonly belt: (SkillId | null)[] = ['cleave', null, null, null, null];
  /** Extra armour from War Cry while it lasts. */
  armorBuff = 0;
  readonly equipped: Partial<Record<Slot, Item>> = {};
  readonly bag: Item[] = [];
  readonly bagSize = 40;

  constructor() {
    this.recompute();
    this.hp = this.maxHp;
    this.mana = this.maxMana;
  }

  xpToNext(level = this.level) {
    return Math.round(80 * Math.pow(level, 1.55));
  }

  /** Adds experience; returns the number of levels gained. */
  gainXp(amount: number): number {
    this.xp += amount;
    let gained = 0;
    while (this.xp >= this.xpToNext()) {
      this.xp -= this.xpToNext();
      this.level++;
      gained++;
      this.skillPoints++;
    }
    if (gained) {
      this.recompute();
      this.hp = this.maxHp;
      this.mana = this.maxMana;
    }
    return gained;
  }

  recompute() {
    const total: ItemStats = {};
    for (const it of Object.values(this.equipped)) {
      if (!it) continue;
      for (const [k, v] of Object.entries(it.stats) as [keyof ItemStats, number][]) total[k] = (total[k] ?? 0) + v;
    }
    const L = this.level - 1;
    this.maxHp = Math.round(100 + L * 14 + (total.life ?? 0));
    this.maxMana = Math.round(60 + L * 6 + (total.mana ?? 0));
    const weapon = this.equipped.weapon;
    // Bare base damage is the knight's starting sword; a found weapon adds to a smaller strength base.
    const baseMin = weapon ? 3 : 7;
    const baseMax = weapon ? 4 : 13;
    this.dmgMin = Math.round((baseMin + (total.dmgMin ?? 0)) * (1 + L * 0.06) + L);
    this.dmgMax = Math.max(this.dmgMin + 1, Math.round((baseMax + (total.dmgMax ?? 0)) * (1 + L * 0.06) + L * 1.5));
    this.armor = Math.round(10 + L * 2 + (total.armor ?? 0));
    this.crit = 0.05 + (total.crit ?? 0);
    this.attackSpeed = total.attackSpeed ?? 0;
    this.lifeSteal = total.lifeSteal ?? 0;
    this.regen = 0.6 + L * 0.1 + (total.regen ?? 0);
    // Passives from the skill tree.
    const keen = 1 + SK.keenEdge(this.rank('keenEdge'));
    this.dmgMin = Math.round(this.dmgMin * keen);
    this.dmgMax = Math.max(this.dmgMin + 1, Math.round(this.dmgMax * keen));
    this.crit += SK.precision(this.rank('precision'));
    this.armor = Math.round(this.armor * (1 + SK.ironSkin(this.rank('ironSkin')) + this.armorBuff));
    this.maxHp = Math.round(this.maxHp * (1 + SK.vigor(this.rank('vigor'))));
    this.regen += SK.secondWindRegen(this.rank('secondWind'));
    this.lifeSteal += SK.bloodthirst(this.rank('bloodthirst'));
    this.attackSpeed += SK.fervor(this.rank('fervor'));
    this.hp = Math.min(this.hp, this.maxHp);
    this.mana = Math.min(this.mana, this.maxMana);
  }

  /** Equips a bag item, swapping out whatever was in its slot. */
  equip(item: Item) {
    if (item.slot === 'gold' || item.slot === 'potion' || item.slot === 'quest') return;
    const i = this.bag.indexOf(item);
    if (i < 0) return;
    this.bag.splice(i, 1);
    const old = this.equipped[item.slot];
    this.equipped[item.slot] = item;
    if (old) this.bag.splice(i, 0, old);
    this.recompute();
  }

  unequip(slot: Slot) {
    const it = this.equipped[slot];
    if (!it || this.bag.length >= this.bagSize) return;
    delete this.equipped[slot];
    this.bag.push(it);
    this.recompute();
  }

  /** Tries to take an item from the ground; false when the bag is full. */
  take(item: Item): boolean {
    if (item.slot === 'gold') {
      this.gold += item.amount;
      return true;
    }
    if (item.slot === 'potion') {
      this.potions += item.amount;
      return true;
    }
    if (item.slot === 'quest') return true;
    if (this.bag.length >= this.bagSize) return false;
    this.bag.push(item);
    return true;
  }

  rank(id: SkillId) {
    return this.ranks[id] ?? 0;
  }

  /** Points already spent in a branch. */
  spentIn(branch: Branch) {
    return SKILLS.filter((d) => d.branch === branch).reduce((n, d) => n + this.rank(d.id) - (d.id === 'cleave' ? 1 : 0), 0);
  }

  /** Why a skill can't take another point right now, or null if it can. */
  blocked(id: SkillId): string | null {
    const d = SKILL[id];
    if (this.rank(id) >= d.maxRank) return 'Fully learned';
    const need = TIER_NEEDS[d.tier];
    if (this.spentIn(d.branch) < need) return `Needs ${need} points in ${d.branch[0].toUpperCase() + d.branch.slice(1)}`;
    if (this.skillPoints <= 0) return 'No skill points';
    return null;
  }

  /** Spends a point on a skill; a newly learned active goes on the first free belt key. */
  learn(id: SkillId): boolean {
    if (this.blocked(id)) return false;
    this.skillPoints--;
    const first = this.rank(id) === 0;
    this.ranks[id] = this.rank(id) + 1;
    if (first && SKILL[id].active) {
      const free = this.belt.indexOf(null);
      if (free >= 0) this.belt[free] = id;
    }
    const hpFrac = this.hp / this.maxHp;
    this.recompute();
    if (id === 'vigor') this.hp = this.maxHp * hpFrac;
    return true;
  }

  /** Moves a learned active skill to the next belt key, swapping with whatever is there. */
  cycleBelt(id: SkillId) {
    const at = this.belt.indexOf(id);
    const to = (at + 1) % BELT_KEYS.length;
    if (at >= 0) this.belt[at] = this.belt[to];
    this.belt[to] = id;
  }

  /** Seconds per sword swing. */
  get swingTime() {
    return 0.62 / (1 + this.attackSpeed);
  }
}
