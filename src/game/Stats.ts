import type { Item, ItemStats, Slot } from './Items';
import { BELT_KEYS, SK, SKILL, SKILLS, TIER_NEEDS, type Branch, type SkillId, branchClass } from './Skills';
import { classDef, type ClassDef } from './Classes';

// The hero's numbers: level and experience, life and mana, damage and armour,
// all recomputed from level plus whatever is equipped.

export const SLOTS: Slot[] = ['weapon', 'helm', 'armor', 'gloves', 'boots', 'ring', 'amulet'];

export class Stats {
  /** The hero's class: base numbers, starting skills, which skill tree. */
  cls: ClassDef = classDef('knight');
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
  manaRegen = 3.2;
  /** Ranks learned in the skill tree (Cleave comes free). */
  readonly ranks: Partial<Record<SkillId, number>> = { cleave: 1 };
  /** Unspent skill points: one per level, plus one to start. */
  skillPoints = 1;
  /** Which active skill sits on each belt key. */
  readonly belt: (SkillId | null)[] = ['cleave', null, null, null, null];
  /** Extra armour from War Cry and Ice Armour while they last. */
  armorBuff = 0;
  /** Extra attack speed from Battle Fury while it lasts. */
  speedBuff = 0;
  /** Multiplier on all damage dealt (keystones). */
  dmgMore = 1;
  /** Multiplier on all damage taken (Sanctuary). */
  dmgTaken = 1;
  readonly equipped: Partial<Record<Slot, Item>> = {};
  readonly bag: Item[] = [];
  readonly bagSize = 40;

  constructor(classId = 'knight') {
    this.setClass(classId);
    this.recompute();
    this.hp = this.maxHp;
    this.mana = this.maxMana;
  }

  /** Switches class: starting skills and belt, then fresh numbers. */
  setClass(id: string) {
    this.cls = classDef(id);
    for (const k of Object.keys(this.ranks)) delete this.ranks[k as SkillId];
    Object.assign(this.ranks, this.cls.startRanks);
    this.belt.splice(0, this.belt.length, ...this.cls.startBelt);
    this.recompute();
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
    const b = this.cls.base(this.level);
    this.maxHp = Math.round(b.life + (total.life ?? 0));
    this.maxMana = Math.round(b.mana + (total.mana ?? 0));
    this.manaRegen = b.manaRegen;
    const weapon = this.equipped.weapon;
    // Bare base damage is the class's own weapon; a found weapon adds to a smaller strength base.
    const baseMin = weapon ? 3 : b.dmgMin;
    const baseMax = weapon ? 4 : b.dmgMax;
    this.dmgMin = Math.round((baseMin + (total.dmgMin ?? 0)) * (1 + L * 0.06) + L);
    this.dmgMax = Math.max(this.dmgMin + 1, Math.round((baseMax + (total.dmgMax ?? 0)) * (1 + L * 0.06) + L * 1.5));
    this.armor = Math.round(b.armor + (total.armor ?? 0));
    this.crit = 0.05 + (total.crit ?? 0);
    this.attackSpeed = total.attackSpeed ?? 0;
    this.lifeSteal = total.lifeSteal ?? 0;
    this.regen = 0.6 + L * 0.1 + (total.regen ?? 0);
    // Passives from the skill tree.
    const keen = 1 + SK.keenEdge(this.rank('keenEdge')) + SK.pyromancy(this.rank('pyromancy'));
    this.dmgMin = Math.round(this.dmgMin * keen);
    this.dmgMax = Math.max(this.dmgMin + 1, Math.round(this.dmgMax * keen));
    this.crit += SK.precision(this.rank('precision')) + SK.combustion(this.rank('combustion'));
    this.armor = Math.round(this.armor * (1 + SK.ironSkin(this.rank('ironSkin')) + SK.frostSkin(this.rank('frostSkin')) + this.armorBuff));
    this.maxHp = Math.round(this.maxHp * (1 + SK.vigor(this.rank('vigor')) + SK.wintersResolve(this.rank('wintersResolve'))));
    this.maxMana = Math.round(this.maxMana * (1 + SK.focus(this.rank('focus'))));
    this.manaRegen += SK.manaFlow(this.rank('manaFlow'));
    this.regen += SK.secondWindRegen(this.rank('secondWind'));
    this.lifeSteal += SK.bloodthirst(this.rank('bloodthirst'));
    this.attackSpeed += SK.fervor(this.rank('fervor')) + SK.arcaneHaste(this.rank('arcaneHaste')) + this.speedBuff;
    this.dmgTaken = 1 - SK.sanctuary(this.rank('sanctuary'));
    // Keystones: each a big gain with a price.
    let more = 1;
    if (this.has('recklessFury')) {
      more += SK.recklessDmg;
      this.attackSpeed += SK.recklessSpeed;
      this.armor = Math.round(this.armor * 0.5);
    }
    if (this.has('ironVow')) {
      more += SK.ironVowDmg;
      this.armor = Math.round(this.armor * (1 + SK.ironVowArmor));
      this.maxHp = Math.round(this.maxHp * (1 + SK.ironVowLife));
    }
    if (this.has('bloodMagic')) more += SK.bloodMagicDmg;
    if (this.has('pyreSoul')) {
      more += SK.pyreSoulDmg;
      this.regen = 0;
    }
    if (this.has('absoluteZero')) this.attackSpeed += SK.zeroSpeed;
    if (this.has('overload')) {
      more += SK.overloadDmg;
      this.attackSpeed += SK.overloadSpeed;
      this.manaRegen *= 0.5;
    }
    this.dmgMore = more;
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

  /** Whether a modifier or keystone (or any skill) has been learned. */
  has(id: SkillId) {
    return (this.ranks[id] ?? 0) > 0;
  }

  /** Whether the hero can pay for a skill right now (mana, or life under Blood Magic). */
  canAfford(id: SkillId) {
    const cost = SKILL[id].cost?.(Math.max(1, this.rank(id))) ?? 0;
    return this.has('bloodMagic') ? this.hp > cost + 1 : this.mana >= cost;
  }

  /** Points spent in the tree beyond the free starting ranks. */
  get spentPoints() {
    return SKILLS.reduce((n, d) => n + Math.max(0, this.rank(d.id) - (this.cls.startRanks[d.id] ?? 0)), 0);
  }

  /** Forgets every learned skill: back to the class's starting ranks and belt, all points refunded. */
  respec() {
    const hpFrac = this.hp / this.maxHp;
    const refund = this.spentPoints;
    for (const k of Object.keys(this.ranks)) delete this.ranks[k as SkillId];
    Object.assign(this.ranks, this.cls.startRanks);
    this.belt.splice(0, this.belt.length, ...this.cls.startBelt);
    this.skillPoints += refund;
    this.armorBuff = 0;
    this.speedBuff = 0;
    this.recompute();
    this.hp = Math.max(1, this.maxHp * hpFrac);
  }

  /** Points already spent in a branch. */
  spentIn(branch: Branch) {
    return SKILLS.filter((d) => d.branch === branch).reduce((n, d) => n + this.rank(d.id) - (this.cls.startRanks[d.id] ?? 0), 0);
  }

  /** Why a skill can't take another point right now, or null if it can. */
  blocked(id: SkillId): string | null {
    const d = SKILL[id];
    if (branchClass(d.branch) !== this.cls.id) return 'Another class';
    if (this.rank(id) >= d.maxRank) return 'Fully learned';
    if (d.mod && !this.has(d.mod)) return `Learn ${SKILL[d.mod].name} first`;
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
    if (id === 'vigor' || id === 'wintersResolve' || id === 'ironVow') this.hp = this.maxHp * hpFrac;
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
