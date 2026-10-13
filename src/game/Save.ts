import { restoreItem, saveItem, type Item } from './Items';
import { classDef, tabard } from './Classes';
import { SKILL, type SkillId } from './Skills';
import { SLOTS, type Stats } from './Stats';
import type { QuestLog } from './Quests';

// Character saves, kept in the browser's localStorage, one key per character
// so a damaged entry costs one hero, not the whole roster.
//
// Staying loadable across versions:
// - Every save carries `version`. When the shape changes, bump SAVE_VERSION
//   and add a step to MIGRATIONS that turns the old shape into the new one.
//   Steps run in order, so a save from any older version walks up to today.
// - Loading never trusts the data: every field is checked and falls back to
//   a default, and things this version doesn't know (a removed skill, a quest
//   that was cut, an item slot that no longer exists) are dropped instead of
//   throwing. Skill points are recounted from level, so dropped skills refund.
// - Items keep their rolled numbers, so rebalancing affixes never breaks them.
// - Fields this version doesn't recognise, and anything in `ext`, are written
//   back untouched, so opening a newer save in an older build loses nothing.

export const SAVE_VERSION = 1;
export const MAX_SLOTS = 12;
const PREFIX = 'orsolya.hero.';

type Json = Record<string, unknown>;

/** Upgrades from version N to N + 1, keyed by N. */
const MIGRATIONS: Record<number, (d: Json) => Json> = {
  // 1: (d) => ({ ...d, newField: 'default' }),
};

export interface CharacterSave {
  version: number;
  id: string;
  slot: number;
  name: string;
  classId: string;
  look: { tabard: string };
  created: number;
  lastPlayed: number;
  /** Seconds in game. */
  playTime: number;
  hero: {
    level: number;
    xp: number;
    gold: number;
    potions: number;
    ranks: Partial<Record<SkillId, number>>;
    belt: (SkillId | null)[];
    equipped: Partial<Record<string, Omit<Item, 'id'>>>;
    bag: Omit<Item, 'id'>[];
  };
  quests: { active: { id: string; progress: number }[]; done: string[] };
  /** Where the hero was last; play resumes in town. */
  area: string;
  /** Room for systems that don't exist yet (a stash, achievements, a second act). */
  ext: Json;
}

/** One roster entry: a save that loaded, or a slot whose data couldn't be read. */
export type SlotEntry = { slot: number; save: CharacterSave } | { slot: number; broken: string; key: string };

export const storage = {
  /** False when the browser refuses storage (private mode, blocked site data). */
  available(): boolean {
    try {
      const k = PREFIX + 'probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  },
};

const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, d: string, max = 60) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : d);
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

/** Brings any stored save up to the current shape, filling every field it lacks. */
export function upgrade(raw: unknown): CharacterSave {
  let d = obj(raw);
  let v = num(d.version, 1, 1);
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (step) d = step(d);
    v++;
  }
  const hero = obj(d.hero);
  const quests = obj(d.quests);
  // Class and look stay as saved even when this build doesn't know them
  // (a newer class), and are resolved to something playable where they're used.
  const cls = classDef(str(d.classId, 'knight'));
  const look = obj(d.look);
  return {
    ...d,
    version: Math.max(v, num(d.version, 1)),
    id: str(d.id, newId()),
    slot: Math.round(num(d.slot, 0, 0, MAX_SLOTS - 1)),
    name: str(d.name, 'Nameless', 24),
    classId: str(d.classId, cls.id),
    look: { ...look, tabard: str(look.tabard, tabard(undefined).id) },
    created: num(d.created, 0),
    lastPlayed: num(d.lastPlayed, 0),
    playTime: num(d.playTime, 0, 0),
    hero: {
      ...hero,
      level: Math.round(num(hero.level, 1, 1, 999)),
      xp: num(hero.xp, 0, 0),
      gold: Math.round(num(hero.gold, 0, 0)),
      potions: Math.round(num(hero.potions, 3, 0)),
      ranks: obj(hero.ranks) as CharacterSave['hero']['ranks'],
      belt: Array.isArray(hero.belt) ? (hero.belt as (SkillId | null)[]) : [...cls.startBelt],
      equipped: obj(hero.equipped) as CharacterSave['hero']['equipped'],
      bag: Array.isArray(hero.bag) ? (hero.bag as CharacterSave['hero']['bag']) : [],
    },
    quests: { ...quests, active: Array.isArray(quests.active) ? (quests.active as CharacterSave['quests']['active']) : [], done: Array.isArray(quests.done) ? (quests.done as string[]) : [] },
    area: str(d.area, 'town'),
    ext: obj(d.ext),
  };
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Every saved character, by slot; unreadable entries show up as broken so the player can clear them. */
export function listSlots(): SlotEntry[] {
  const out: SlotEntry[] = [];
  let keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && k !== PREFIX + 'probe') keys.push(k);
    }
  } catch {
    keys = [];
  }
  const taken = new Set<number>();
  const later: SlotEntry[] = [];
  for (const key of keys) {
    try {
      const save = upgrade(JSON.parse(localStorage.getItem(key) ?? 'null'));
      save.id = key.slice(PREFIX.length);
      if (taken.has(save.slot)) later.push({ slot: -1, save });
      else {
        taken.add(save.slot);
        out.push({ slot: save.slot, save });
      }
    } catch (e) {
      later.push({ slot: -1, broken: e instanceof Error ? e.message : 'unreadable', key });
    }
  }
  // Two heroes in one slot (or a broken entry) move to the first free slot.
  for (const e of later) {
    let s = 0;
    while (taken.has(s)) s++;
    if (s >= MAX_SLOTS) break;
    taken.add(s);
    e.slot = s;
    if ('save' in e) {
      e.save.slot = s;
      writeSave(e.save);
    }
    out.push(e);
  }
  return out.sort((a, b) => a.slot - b.slot);
}

export function writeSave(save: CharacterSave): boolean {
  try {
    localStorage.setItem(PREFIX + save.id, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function deleteSave(idOrKey: string) {
  try {
    localStorage.removeItem(idOrKey.startsWith(PREFIX) ? idOrKey : PREFIX + idOrKey);
  } catch {
    /* nothing to delete */
  }
}

/** A brand-new level 1 hero. */
export function newCharacter(slot: number, name: string, classId: string, tabardId: string): CharacterSave {
  const cls = classDef(classId);
  const now = Date.now();
  return upgrade({
    version: SAVE_VERSION,
    id: newId(),
    slot,
    name,
    classId: cls.id,
    look: { tabard: tabardId },
    created: now,
    lastPlayed: now,
    playTime: 0,
    hero: { level: 1, xp: 0, gold: 0, potions: 3, ranks: { ...cls.startRanks }, belt: [...cls.startBelt], equipped: {}, bag: [] },
    quests: { active: [], done: [] },
    area: 'town',
    ext: {},
  });
}

/** Saved items this build couldn't read, carried along so saving doesn't drop them. */
const unreadable = new WeakMap<CharacterSave, unknown[]>();

/** Puts a save's hero and quests into the live game state. */
export function applySave(save: CharacterSave, stats: Stats, quests: QuestLog) {
  const h = save.hero;
  const cls = classDef(save.classId);
  stats.level = h.level;
  stats.xp = Math.min(h.xp, stats.xpToNext() - 1);
  stats.gold = h.gold;
  stats.potions = h.potions;
  // Skills: keep the ones that still exist, capped at their max rank.
  for (const k of Object.keys(stats.ranks)) delete stats.ranks[k as SkillId];
  for (const [id, r] of Object.entries(cls.startRanks)) stats.ranks[id as SkillId] = r;
  for (const [id, r] of Object.entries(h.ranks)) {
    const def = SKILL[id as SkillId];
    if (!def || typeof r !== 'number' || !Number.isFinite(r)) continue;
    stats.ranks[id as SkillId] = Math.max(cls.startRanks[id as SkillId] ?? 0, Math.min(def.maxRank, Math.round(r)));
  }
  // One point per level, plus one to start; free starting ranks cost nothing.
  const free = Object.values(cls.startRanks).reduce((n, r) => n + (r ?? 0), 0);
  let spent = Object.values(stats.ranks).reduce((n, r) => n + (r ?? 0), 0) - free;
  // More points spent than the level allows means the data is off: refund the lot.
  if (spent > stats.level) {
    for (const k of Object.keys(stats.ranks)) delete stats.ranks[k as SkillId];
    for (const [id, r] of Object.entries(cls.startRanks)) stats.ranks[id as SkillId] = r;
    spent = 0;
  }
  stats.skillPoints = stats.level - spent;
  const seen = new Set<SkillId>();
  for (let i = 0; i < stats.belt.length; i++) {
    const id = h.belt[i];
    const ok = typeof id === 'string' && SKILL[id]?.active && stats.rank(id) > 0 && !seen.has(id);
    stats.belt[i] = ok ? id : null;
    if (ok) seen.add(id);
  }
  // Gear: worn items must still fit their slot; anything that doesn't goes to the bag.
  for (const s of SLOTS) delete stats.equipped[s];
  stats.bag.length = 0;
  const spill: Item[] = [];
  const lost: unknown[] = [];
  for (const [slot, raw] of Object.entries(h.equipped)) {
    const it = restoreItem(raw);
    if (!it) {
      if (raw && typeof raw === 'object') lost.push(raw);
      continue;
    }
    const worn = SLOTS.find((x) => x === slot && x === it.slot);
    if (worn && !stats.equipped[worn]) stats.equipped[worn] = it;
    else spill.push(it);
  }
  for (const raw of h.bag) {
    const it = restoreItem(raw);
    if (it) spill.push(it);
    else if (raw && typeof raw === 'object') lost.push(raw);
  }
  for (const it of spill) if (!stats.take(it)) lost.push(saveItem(it));
  unreadable.set(save, lost);
  stats.recompute();
  stats.hp = stats.maxHp;
  stats.mana = stats.maxMana;
  quests.restore(save.quests);
}

/** Copies the live game state back into the save (keeping fields this build doesn't know). */
export function captureSave(save: CharacterSave, stats: Stats, quests: QuestLog, area: string, playTime: number) {
  const equipped: CharacterSave['hero']['equipped'] = {};
  for (const s of SLOTS) {
    const it = stats.equipped[s];
    if (it) equipped[s] = saveItem(it);
  }
  save.version = Math.max(save.version, SAVE_VERSION);
  save.lastPlayed = Date.now();
  save.playTime = playTime;
  save.area = area;
  save.hero = {
    ...save.hero,
    level: stats.level,
    xp: stats.xp,
    gold: stats.gold,
    potions: stats.potions,
    // Skills this build doesn't know are kept as they were.
    ranks: { ...Object.fromEntries(Object.entries(save.hero.ranks).filter(([id]) => !SKILL[id as SkillId])), ...stats.ranks },
    belt: [...stats.belt],
    equipped,
    bag: [...stats.bag.map(saveItem), ...((unreadable.get(save) ?? []) as Omit<Item, 'id'>[])],
  };
  save.quests = { ...save.quests, ...quests.toSave() };
}
