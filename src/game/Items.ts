// Item model and procedural generation: base types per slot, rarity rolls,
// affixes with grim names, and gold. Everything is plain data so the
// inventory UI and stats can read it directly.

export type Slot = 'weapon' | 'armor' | 'helm' | 'gloves' | 'boots' | 'ring' | 'amulet';
export type Rarity = 'common' | 'magic' | 'rare' | 'unique';

export interface ItemStats {
  dmgMin?: number;
  dmgMax?: number;
  armor?: number;
  life?: number;
  mana?: number;
  crit?: number; // fraction
  attackSpeed?: number; // fraction faster
  lifeSteal?: number; // fraction of damage healed
  regen?: number; // life per second
}

export interface Item {
  id: number;
  name: string;
  base: string;
  slot: Slot | 'potion' | 'gold' | 'quest';
  rarity: Rarity;
  level: number;
  stats: ItemStats;
  /** Gold amount or potion count. */
  amount: number;
  /** Short flavour line for uniques. */
  lore?: string;
}

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#d8d0c4',
  magic: '#7c8cff',
  rare: '#f0d060',
  unique: '#c8803a',
};

/** Label colour for quest items lying on the ground. */
export const QUEST_COLOR = '#8ad08a';

interface Base {
  name: string;
  slot: Slot;
  minLevel: number;
  stats: (lv: number) => ItemStats;
}

const r = (a: number, b: number) => a + Math.random() * (b - a);
const ri = (a: number, b: number) => Math.round(r(a, b));
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

const BASES: Base[] = [
  { name: 'Rusted Falchion', slot: 'weapon', minLevel: 1, stats: (l) => ({ dmgMin: ri(3, 4) + l, dmgMax: ri(7, 9) + l * 2 }) },
  { name: 'Gravedigger Spade', slot: 'weapon', minLevel: 1, stats: (l) => ({ dmgMin: ri(2, 3) + l, dmgMax: ri(9, 11) + l * 2, attackSpeed: -0.05 }) },
  { name: 'Arming Sword', slot: 'weapon', minLevel: 2, stats: (l) => ({ dmgMin: ri(4, 6) + l, dmgMax: ri(9, 12) + l * 2 }) },
  { name: 'Executioner Axe', slot: 'weapon', minLevel: 3, stats: (l) => ({ dmgMin: ri(6, 8) + l, dmgMax: ri(14, 18) + l * 2, attackSpeed: -0.1 }) },
  { name: 'Pilgrim Mace', slot: 'weapon', minLevel: 2, stats: (l) => ({ dmgMin: ri(5, 7) + l, dmgMax: ri(10, 12) + l * 2 }) },
  { name: 'Padded Gambeson', slot: 'armor', minLevel: 1, stats: (l) => ({ armor: ri(8, 12) + l * 2 }) },
  { name: 'Riveted Hauberk', slot: 'armor', minLevel: 2, stats: (l) => ({ armor: ri(16, 22) + l * 3 }) },
  { name: 'Blackened Cuirass', slot: 'armor', minLevel: 3, stats: (l) => ({ armor: ri(24, 32) + l * 3 }) },
  { name: 'Leather Coif', slot: 'helm', minLevel: 1, stats: (l) => ({ armor: ri(3, 5) + l }) },
  { name: 'Kettle Helm', slot: 'helm', minLevel: 2, stats: (l) => ({ armor: ri(6, 9) + l }) },
  { name: 'Visored Bascinet', slot: 'helm', minLevel: 3, stats: (l) => ({ armor: ri(10, 13) + l }) },
  { name: 'Tattered Gloves', slot: 'gloves', minLevel: 1, stats: (l) => ({ armor: ri(2, 3) + l }) },
  { name: 'Mail Mittens', slot: 'gloves', minLevel: 2, stats: (l) => ({ armor: ri(4, 6) + l }) },
  { name: 'Worn Boots', slot: 'boots', minLevel: 1, stats: (l) => ({ armor: ri(2, 3) + l }) },
  { name: 'Iron-shod Boots', slot: 'boots', minLevel: 2, stats: (l) => ({ armor: ri(4, 6) + l }) },
  { name: 'Bone Ring', slot: 'ring', minLevel: 1, stats: () => ({}) },
  { name: 'Iron Band', slot: 'ring', minLevel: 1, stats: () => ({}) },
  { name: 'Reliquary Amulet', slot: 'amulet', minLevel: 2, stats: () => ({}) },
];

interface Affix {
  name: string;
  slots: Slot[] | 'any';
  roll: (lv: number) => ItemStats;
}

const PREFIXES: Affix[] = [
  { name: 'Cruel', slots: ['weapon'], roll: (l) => ({ dmgMin: ri(1, 2) + l, dmgMax: ri(2, 4) + l }) },
  { name: 'Serrated', slots: ['weapon', 'ring'], roll: (l) => ({ dmgMax: ri(2, 5) + l }) },
  { name: 'Hallowed', slots: 'any', roll: (l) => ({ life: ri(8, 14) + l * 4 }) },
  { name: 'Sturdy', slots: ['armor', 'helm', 'gloves', 'boots'], roll: (l) => ({ armor: ri(4, 8) + l * 2 }) },
  { name: 'Vampiric', slots: ['weapon', 'ring', 'amulet'], roll: () => ({ lifeSteal: r(0.03, 0.06) }) },
  { name: 'Keen', slots: ['weapon', 'ring', 'amulet', 'gloves'], roll: () => ({ crit: r(0.03, 0.07) }) },
  { name: 'Mystic', slots: ['ring', 'amulet', 'helm'], roll: (l) => ({ mana: ri(8, 15) + l * 3 }) },
];
const SUFFIXES: Affix[] = [
  { name: 'of the Ash', slots: 'any', roll: (l) => ({ life: ri(6, 12) + l * 3 }) },
  { name: 'of Haste', slots: ['weapon', 'gloves', 'ring'], roll: () => ({ attackSpeed: r(0.06, 0.14) }) },
  { name: 'of the Leech', slots: ['weapon', 'ring', 'amulet'], roll: () => ({ lifeSteal: r(0.02, 0.05) }) },
  { name: 'of Mending', slots: 'any', roll: (l) => ({ regen: r(0.6, 1.4) + l * 0.2 }) },
  { name: 'of the Bulwark', slots: ['armor', 'helm', 'boots'], roll: (l) => ({ armor: ri(5, 9) + l * 2 }) },
  { name: 'of Slaughter', slots: ['weapon', 'amulet'], roll: (l) => ({ dmgMin: ri(1, 3) + l, dmgMax: ri(3, 6) + l }) },
  { name: 'of the Grave', slots: ['ring', 'amulet', 'helm'], roll: () => ({ crit: r(0.03, 0.06) }) },
];

const RARE_A = ['Grave', 'Blood', 'Ash', 'Bone', 'Dusk', 'Rot', 'Pyre', 'Hollow', 'Gloom', 'Carrion', 'Wraith', 'Thorn'];
const RARE_B: Record<Slot, string[]> = {
  weapon: ['Bite', 'Song', 'Cleaver', 'Edge', 'Fang', 'Toll', 'Mercy'],
  armor: ['Shell', 'Shroud', 'Carapace', 'Mantle', 'Hide'],
  helm: ['Visage', 'Crown', 'Cowl', 'Brow', 'Mask'],
  gloves: ['Grasp', 'Hands', 'Clutch', 'Knuckle'],
  boots: ['Stride', 'Tread', 'March', 'Path'],
  ring: ['Loop', 'Coil', 'Seal', 'Circle', 'Eye'],
  amulet: ['Heart', 'Charm', 'Ward', 'Relic', 'Talisman'],
};

const UNIQUES: { base: string; name: string; lore: string; stats: ItemStats }[] = [
  { base: 'Arming Sword', name: 'Saint Orsolya\'s Last Mercy', lore: 'Its bell rang for the dying. Now it rings for the dead.', stats: { dmgMin: 9, dmgMax: 19, lifeSteal: 0.06, crit: 0.06 } },
  { base: 'Riveted Hauberk', name: 'The Gravewarden\'s Mail', lore: 'Each link was forged from a coffin nail.', stats: { armor: 40, life: 35, regen: 1.5 } },
  { base: 'Bone Ring', name: 'Coil of the Hungry Saint', lore: 'It tightens when blood is near.', stats: { lifeSteal: 0.05, dmgMax: 6, attackSpeed: 0.12 } },
];

let nextId = 1;

function addStats(into: ItemStats, more: ItemStats) {
  for (const [k, v] of Object.entries(more) as [keyof ItemStats, number][]) into[k] = (into[k] ?? 0) + v;
}

export function rollRarity(level: number, magicFind = 0): Rarity {
  const x = Math.random();
  const boost = 1 + magicFind + level * 0.05;
  if (x < 0.012 * boost) return 'unique';
  if (x < 0.07 * boost) return 'rare';
  if (x < 0.3 * boost) return 'magic';
  return 'common';
}

export function makeItem(level: number, rarity: Rarity = rollRarity(level), slot?: Slot): Item {
  if (rarity === 'unique') {
    const u = pick(UNIQUES);
    const base = BASES.find((b) => b.name === u.base)!;
    return { id: nextId++, name: u.name, base: base.name, slot: base.slot, rarity, level: Math.max(level, 2), stats: { ...u.stats }, amount: 1, lore: u.lore };
  }
  const pool = BASES.filter((b) => b.minLevel <= level + 1 && (!slot || b.slot === slot));
  const base = pick(pool.length ? pool : BASES);
  const stats = base.stats(level);
  let name = base.name;
  const fits = (a: Affix) => a.slots === 'any' || a.slots.includes(base.slot);
  if (rarity === 'magic') {
    const pre = Math.random() < 0.6 ? pick(PREFIXES.filter(fits)) : null;
    const suf = !pre || Math.random() < 0.5 ? pick(SUFFIXES.filter(fits)) : null;
    if (pre) addStats(stats, pre.roll(level));
    if (suf) addStats(stats, suf.roll(level));
    name = [pre?.name, base.name, suf?.name].filter(Boolean).join(' ');
  } else if (rarity === 'rare') {
    const affixes = [...PREFIXES, ...SUFFIXES].filter(fits).sort(() => Math.random() - 0.5).slice(0, 3 + Math.floor(Math.random() * 2));
    for (const a of affixes) addStats(stats, a.roll(level));
    name = `${pick(RARE_A)} ${pick(RARE_B[base.slot])}`;
  }
  return { id: nextId++, name, base: base.name, slot: base.slot, rarity, level, stats, amount: 1 };
}

export function makeGold(level: number, mult = 1): Item {
  const amount = Math.max(1, Math.round((4 + Math.random() * 10) * (1 + level * 0.6) * mult));
  return { id: nextId++, name: `${amount} Gold`, base: 'Gold', slot: 'gold', rarity: 'common', level, stats: {}, amount };
}

export function makePotion(): Item {
  return { id: nextId++, name: 'Healing Draught', base: 'Healing Draught', slot: 'potion', rarity: 'common', level: 1, stats: {}, amount: 1 };
}

/** Something a townsperson asked for (grave moss, a lost scarf). It goes to the quest, not the bag. */
export function makeQuestItem(name: string): Item {
  return { id: nextId++, name, base: name, slot: 'quest', rarity: 'common', level: 1, stats: {}, amount: 1 };
}

const RARITY_PRICE: Record<Rarity, number> = { common: 12, magic: 34, rare: 95, unique: 320 };

/** What a merchant asks for an item; they pay a quarter of it back. */
export function itemPrice(item: Item): number {
  if (item.slot === 'potion') return 25 * item.amount;
  if (item.slot === 'gold' || item.slot === 'quest') return 0;
  const affixes = Object.keys(item.stats).length;
  return Math.round(RARITY_PRICE[item.rarity] * (1 + item.level * 0.35) * (1 + affixes * 0.08));
}

export const sellPrice = (item: Item) => Math.max(1, Math.floor(itemPrice(item) / 4));

/** Human-readable stat lines for tooltips. */
export function statLines(s: ItemStats): string[] {
  const out: string[] = [];
  if (s.dmgMin || s.dmgMax) out.push(`Damage: ${Math.round(s.dmgMin ?? 0)}–${Math.round(s.dmgMax ?? 0)}`);
  if (s.armor) out.push(`Armour: ${Math.round(s.armor)}`);
  if (s.life) out.push(`+${Math.round(s.life)} Life`);
  if (s.mana) out.push(`+${Math.round(s.mana)} Mana`);
  if (s.crit) out.push(`+${Math.round(s.crit * 100)}% Critical Strike`);
  if (s.attackSpeed) out.push(`${s.attackSpeed > 0 ? '+' : ''}${Math.round(s.attackSpeed * 100)}% Attack Speed`);
  if (s.lifeSteal) out.push(`${(s.lifeSteal * 100).toFixed(1)}% Life Stolen per Hit`);
  if (s.regen) out.push(`+${s.regen.toFixed(1)} Life per Second`);
  return out;
}
