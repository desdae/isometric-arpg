// The hero's skill tree: three branches of five skills each. A point comes
// with every level (and one to start); deeper tiers open once enough points
// sit in the branch. Active skills go on the belt (right click and 2 to 5),
// passives fold into the hero's numbers in Stats.recompute.

export type SkillId =
  | 'cleave'
  | 'keenEdge'
  | 'leapSlam'
  | 'precision'
  | 'whirlwind'
  | 'ironSkin'
  | 'vigor'
  | 'warCry'
  | 'secondWind'
  | 'consecration'
  | 'bloodLance'
  | 'bloodthirst'
  | 'fervor'
  | 'siphon'
  | 'bloodNova'
  // Mage
  | 'fireball'
  | 'pyromancy'
  | 'flameWave'
  | 'combustion'
  | 'meteor'
  | 'frostNova'
  | 'frostSkin'
  | 'iceShards'
  | 'wintersResolve'
  | 'blizzard'
  | 'manaFlow'
  | 'focus'
  | 'blink'
  | 'arcaneHaste'
  | 'arcaneBarrage';

export type Branch = 'blade' | 'bulwark' | 'blood' | 'fire' | 'frost' | 'arcane';

export interface SkillDef {
  id: SkillId;
  name: string;
  branch: Branch;
  /** 0, 1 or 2: deeper tiers need points spent in the branch first. */
  tier: number;
  maxRank: number;
  active: boolean;
  /** Turns the hero toward the cursor when cast. */
  aimed?: boolean;
  /** Mana per use at a rank (actives). */
  cost?: (r: number) => number;
  /** Seconds between uses at a rank (actives). */
  cooldown?: (r: number) => number;
  /** What the skill does at a given rank, one line. */
  text: (r: number) => string;
  icon: string;
}

/** Points that must already be in a branch before a tier opens. */
export const TIER_NEEDS = [0, 3, 6];

/** Each class has its own three branches; `cls` is the class id. */
export const BRANCHES: { id: Branch; cls: string; name: string; blurb: string; color: string }[] = [
  { id: 'blade', cls: 'knight', name: 'Blade', blurb: 'Steel and fury', color: '#e0804a' },
  { id: 'bulwark', cls: 'knight', name: 'Bulwark', blurb: 'Faith and iron', color: '#d8c070' },
  { id: 'blood', cls: 'knight', name: 'Blood', blurb: 'The crypt’s dark gift', color: '#e03a3a' },
  { id: 'fire', cls: 'mage', name: 'Fire', blurb: 'Cinders of the burning sky', color: '#f07a34' },
  { id: 'frost', cls: 'mage', name: 'Frost', blurb: 'The cold between stars', color: '#7ac8f0' },
  { id: 'arcane', cls: 'mage', name: 'Arcane', blurb: 'Will made into force', color: '#b88cff' },
];

/** The class a branch belongs to. */
export const branchClass = (b: Branch) => BRANCHES.find((x) => x.id === b)!.cls;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const svg = (body: string) => `<svg viewBox="0 0 32 32">${body}</svg>`;

// Skill numbers, shared with the code that casts them.
export const SK = {
  cleaveMult: (r: number) => 1.1 + 0.15 * r,
  keenEdge: (r: number) => 0.06 * r,
  leapMult: (r: number) => 1.4 + 0.25 * r,
  leapStun: (r: number) => 0.6 + 0.15 * r,
  precision: (r: number) => 0.03 * r,
  whirlTime: (r: number) => 2 + 0.6 * r,
  whirlMult: (r: number) => 0.45 + 0.12 * r,
  ironSkin: (r: number) => 0.1 * r,
  vigor: (r: number) => 0.06 * r,
  warCryStun: (r: number) => 1.2 + 0.3 * r,
  warCryArmor: (r: number) => 0.3 + 0.1 * r,
  secondWindRegen: (r: number) => 1.2 * r,
  secondWindPotion: (r: number) => 0.1 * r,
  consecrateMult: (r: number) => 0.3 + 0.1 * r,
  consecrateHeal: (r: number) => 0.012 + 0.006 * r,
  lanceMult: (r: number) => 1.0 + 0.2 * r,
  bloodthirst: (r: number) => 0.01 * r,
  fervor: (r: number) => 0.06 * r,
  siphon: (r: number) => 3 * r,
  novaMult: (r: number) => 2.0 + 0.5 * r,
  novaHeal: (r: number) => 0.2 + 0.05 * r,
  // Mage
  staffMult: 0.9,
  fireballMult: (r: number) => 1.25 + 0.2 * r,
  pyromancy: (r: number) => 0.07 * r,
  flameWaveMult: (r: number) => 1.1 + 0.2 * r,
  combustion: (r: number) => 0.03 * r,
  meteorMult: (r: number) => 3.0 + 0.6 * r,
  frostNovaMult: (r: number) => 0.8 + 0.15 * r,
  frostNovaFreeze: (r: number) => 1.2 + 0.3 * r,
  frostSkin: (r: number) => 0.15 * r,
  shardsMult: (r: number) => 0.75 + 0.15 * r,
  wintersResolve: (r: number) => 0.07 * r,
  blizzardMult: (r: number) => 0.35 + 0.1 * r,
  manaFlow: (r: number) => 1.5 * r,
  focus: (r: number) => 0.1 * r,
  blinkMult: (r: number) => 0.6 + 0.2 * r,
  arcaneHaste: (r: number) => 0.06 * r,
  barrageMult: (r: number) => 0.55 + 0.1 * r,
};

export const SKILLS: SkillDef[] = [
  // ---- Blade ----
  {
    id: 'cleave',
    name: 'Cleave',
    branch: 'blade',
    tier: 0,
    maxRank: 5,
    active: true,
    cost: () => 18,
    cooldown: () => 0,
    text: (r) => `Spin and strike everything around you for ${pct(SK.cleaveMult(r))} weapon damage.`,
    icon: svg(`<circle cx="16" cy="16" r="11" fill="none" stroke="#e08050" stroke-width="2.5" stroke-dasharray="40 10"/><path d="M16 5l3 4h-6z" fill="#e08050"/><circle cx="16" cy="16" r="3" fill="#c8c0b8"/>`),
  },
  {
    id: 'keenEdge',
    name: 'Keen Edge',
    branch: 'blade',
    tier: 0,
    maxRank: 5,
    active: false,
    text: (r) => `+${pct(SK.keenEdge(r))} weapon damage.`,
    icon: svg(`<path d="M8 26L24 6l2 2L10 28z" fill="#d8d0c8" stroke="#3a2a20"/><path d="M22 4l6 6" stroke="#ffb070" stroke-width="2"/><circle cx="25" cy="7" r="2" fill="#fff0c0"/>`),
  },
  {
    id: 'leapSlam',
    aimed: true,
    name: 'Leap Slam',
    branch: 'blade',
    tier: 1,
    maxRank: 5,
    active: true,
    cost: () => 22,
    cooldown: () => 6,
    text: (r) => `Leap to the cursor and smash the ground for ${pct(SK.leapMult(r))} weapon damage, stunning for ${SK.leapStun(r).toFixed(1)}s.`,
    icon: svg(`<path d="M5 24c4-14 14-18 22-14" fill="none" stroke="#e8a060" stroke-width="2" stroke-dasharray="3 3"/><path d="M22 6l6 4-6 3z" fill="#e8a060"/><path d="M4 27h24" stroke="#c06030" stroke-width="2.5"/><path d="M10 27l-3-4M16 27v-5M22 27l3-4" stroke="#ffcf90" stroke-width="1.5"/>`),
  },
  {
    id: 'precision',
    name: 'Precision',
    branch: 'blade',
    tier: 1,
    maxRank: 3,
    active: false,
    text: (r) => `+${pct(SK.precision(r))} critical strike chance.`,
    icon: svg(`<circle cx="16" cy="16" r="10" fill="none" stroke="#e09050" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="none" stroke="#ffd0a0" stroke-width="2"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="#e09050" stroke-width="2"/>`),
  },
  {
    id: 'whirlwind',
    aimed: true,
    name: 'Whirlwind',
    branch: 'blade',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 30,
    cooldown: () => 10,
    text: (r) => `Become a storm of steel for ${SK.whirlTime(r).toFixed(1)}s, moving toward the cursor and hitting everything near you for ${pct(SK.whirlMult(r))} weapon damage several times a second.`,
    icon: svg(`<path d="M16 16m-12 0a12 12 0 0 1 12-12M16 16m12 0a12 12 0 0 1-12 12M16 16m0-8a8 8 0 0 1 8 8M16 16m0 8a8 8 0 0 1-8-8" fill="none" stroke="#f0a060" stroke-width="2.2"/><circle cx="16" cy="16" r="2.5" fill="#fff0d0"/>`),
  },
  // ---- Bulwark ----
  {
    id: 'ironSkin',
    name: 'Iron Skin',
    branch: 'bulwark',
    tier: 0,
    maxRank: 5,
    active: false,
    text: (r) => `+${pct(SK.ironSkin(r))} armour.`,
    icon: svg(`<path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#5a5048" stroke="#d8c070" stroke-width="1.5"/><path d="M16 8v16M10 14h12" stroke="#d8c070" stroke-width="1.5"/>`),
  },
  {
    id: 'vigor',
    name: 'Vigour',
    branch: 'bulwark',
    tier: 0,
    maxRank: 5,
    active: false,
    text: (r) => `+${pct(SK.vigor(r))} maximum life.`,
    icon: svg(`<path d="M16 27C6 20 4 14 6 10c2-4 8-5 10 0 2-5 8-4 10 0 2 4 0 10-10 17z" fill="#b02018" stroke="#e8c070" stroke-width="1.5"/><path d="M9 15h4l2-3 2 6 2-3h4" fill="none" stroke="#ffe0a0" stroke-width="1.5"/>`),
  },
  {
    id: 'warCry',
    name: 'War Cry',
    branch: 'bulwark',
    tier: 1,
    maxRank: 5,
    active: true,
    cost: () => 20,
    cooldown: () => 14,
    text: (r) => `A roar that stuns foes within 6m for ${SK.warCryStun(r).toFixed(1)}s and hardens your armour by ${pct(SK.warCryArmor(r))} for 8s.`,
    icon: svg(`<path d="M8 12h5l7-6v20l-7-6H8z" fill="#c8b070" stroke="#3a2a20"/><path d="M23 10c3 3 3 9 0 12M26 7c5 5 5 13 0 18" fill="none" stroke="#f0d890" stroke-width="2"/>`),
  },
  {
    id: 'secondWind',
    name: 'Second Wind',
    branch: 'bulwark',
    tier: 1,
    maxRank: 3,
    active: false,
    text: (r) => `+${SK.secondWindRegen(r).toFixed(1)} life per second, and potions heal ${pct(SK.secondWindPotion(r))} more.`,
    icon: svg(`<path d="M6 12c6-4 12 4 20 0M6 18c6-4 12 4 20 0M6 24c6-4 12 4 16 0" fill="none" stroke="#e8d890" stroke-width="2"/>`),
  },
  {
    id: 'consecration',
    name: 'Consecration',
    branch: 'bulwark',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 35,
    cooldown: () => 16,
    text: (r) => `Hallow the ground around you for 6s: foes in it burn for ${pct(SK.consecrateMult(r))} weapon damage every half second, and you heal ${pct(SK.consecrateHeal(r))} of your life each pulse.`,
    icon: svg(`<ellipse cx="16" cy="23" rx="13" ry="5" fill="none" stroke="#ffe090" stroke-width="2"/><path d="M16 4v16M10 10h12" stroke="#fff0c0" stroke-width="2.5"/><path d="M7 23l2-4M25 23l-2-4" stroke="#ffd070" stroke-width="1.5"/>`),
  },
  // ---- Blood ----
  {
    id: 'bloodLance',
    aimed: true,
    name: 'Blood Lance',
    branch: 'blood',
    tier: 0,
    maxRank: 5,
    active: true,
    cost: () => 14,
    cooldown: () => 0.7,
    text: (r) => `Hurl a spear of blood toward the cursor that pierces everything in its path for ${pct(SK.lanceMult(r))} weapon damage.`,
    icon: svg(`<path d="M4 28L24 8" stroke="#e02a20" stroke-width="3"/><path d="M22 4l6 6-6 0z" fill="#ff5040"/><circle cx="8" cy="24" r="1.5" fill="#ff8070"/><circle cx="12" cy="22" r="1" fill="#ff8070"/>`),
  },
  {
    id: 'bloodthirst',
    name: 'Bloodthirst',
    branch: 'blood',
    tier: 0,
    maxRank: 5,
    active: false,
    text: (r) => `${pct(SK.bloodthirst(r))} of damage dealt heals you.`,
    icon: svg(`<path d="M16 4c5 8 9 12 9 17a9 9 0 0 1-18 0c0-5 4-9 9-17z" fill="#a01010" stroke="#ff6050" stroke-width="1.5"/><path d="M12 20a4 4 0 0 0 4 4" fill="none" stroke="#ffb0a0" stroke-width="1.5"/>`),
  },
  {
    id: 'fervor',
    name: 'Fervour',
    branch: 'blood',
    tier: 1,
    maxRank: 3,
    active: false,
    text: (r) => `+${pct(SK.fervor(r))} attack speed.`,
    icon: svg(`<path d="M18 3L8 18h7l-3 11 12-16h-7z" fill="#e03a20" stroke="#ffb070" stroke-width="1.2"/>`),
  },
  {
    id: 'siphon',
    name: 'Siphon',
    branch: 'blood',
    tier: 1,
    maxRank: 3,
    active: false,
    text: (r) => `Each kill restores ${SK.siphon(r)} mana.`,
    icon: svg(`<path d="M6 8c8 0 8 16 20 16" fill="none" stroke="#e03030" stroke-width="2.5"/><path d="M24 20l4 4-4 4" fill="none" stroke="#6a90ff" stroke-width="2.5"/><circle cx="6" cy="8" r="3" fill="#a01010"/>`),
  },
  {
    id: 'bloodNova',
    name: 'Blood Nova',
    branch: 'blood',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 25,
    cooldown: () => 12,
    text: (r) => `Spend 12% of your life to burst in a 7m nova for ${pct(SK.novaMult(r))} weapon damage, healing ${pct(SK.novaHeal(r))} of the damage dealt.`,
    icon: svg(`<circle cx="16" cy="16" r="5" fill="#c01010"/><circle cx="16" cy="16" r="10" fill="none" stroke="#ff4030" stroke-width="2"/><circle cx="16" cy="16" r="14" fill="none" stroke="#ff4030" stroke-width="1" stroke-dasharray="3 3"/>`),
  },
  // ---- Fire (mage) ----
  {
    id: 'fireball',
    aimed: true,
    name: 'Fireball',
    branch: 'fire',
    tier: 0,
    maxRank: 5,
    active: true,
    cost: () => 10,
    cooldown: () => 0,
    text: (r) => `Hurl a ball of fire toward the cursor that bursts on the first foe it meets, burning everything within 2m for ${pct(SK.fireballMult(r))} damage.`,
    icon: svg(`<circle cx="19" cy="13" r="7" fill="#ff8a30"/><circle cx="19" cy="13" r="3.5" fill="#fff0b0"/><path d="M4 28c3-6 6-9 10-11M7 23c2-3 4-5 7-6" stroke="#ff6020" stroke-width="2.2" fill="none"/>`),
  },
  {
    id: 'pyromancy',
    name: 'Pyromancy',
    branch: 'fire',
    tier: 0,
    maxRank: 5,
    active: false,
    text: (r) => `+${pct(SK.pyromancy(r))} damage.`,
    icon: svg(`<path d="M16 3c6 7 9 11 9 16a9 9 0 0 1-18 0c0-4 2-6 4-8 0 4 2 5 3 5-1-5 0-9 2-13z" fill="#e05a20" stroke="#ffc070" stroke-width="1.3"/><path d="M16 17c2 2 3 3 3 5a3 3 0 0 1-6 0c0-2 1-3 3-5z" fill="#fff0b0"/>`),
  },
  {
    id: 'flameWave',
    aimed: true,
    name: 'Flame Wave',
    branch: 'fire',
    tier: 1,
    maxRank: 5,
    active: true,
    cost: () => 18,
    cooldown: () => 3,
    text: (r) => `Send a rolling wall of flame toward the cursor that sears everything it passes through for ${pct(SK.flameWaveMult(r))} damage.`,
    icon: svg(`<path d="M3 24c4-2 6-10 9-10s4 6 7 6 4-8 7-10" fill="none" stroke="#ff7a28" stroke-width="3"/><path d="M3 28h26" stroke="#ffb060" stroke-width="2"/><path d="M8 20l1-5M15 22l1-6M22 19l1-6" stroke="#fff0b0" stroke-width="1.4"/>`),
  },
  {
    id: 'combustion',
    name: 'Combustion',
    branch: 'fire',
    tier: 1,
    maxRank: 3,
    active: false,
    text: (r) => `+${pct(SK.combustion(r))} critical strike chance.`,
    icon: svg(`<circle cx="16" cy="16" r="5" fill="#fff0b0"/><path d="M16 2v7M16 23v7M2 16h7M23 16h7M6 6l5 5M21 21l5 5M26 6l-5 5M11 21l-5 5" stroke="#ff7a28" stroke-width="2.2"/>`),
  },
  {
    id: 'meteor',
    aimed: true,
    name: 'Meteor',
    branch: 'fire',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 40,
    cooldown: () => 10,
    text: (r) => `Call a burning stone down on the cursor. It lands a moment later, crushing everything within 3.5m for ${pct(SK.meteorMult(r))} damage and leaving the ground on fire.`,
    icon: svg(`<circle cx="21" cy="21" r="7" fill="#c84a18" stroke="#ffb060" stroke-width="1.5"/><path d="M3 3l13 13M8 2l10 10M2 8l10 10" stroke="#ff8a30" stroke-width="2"/><circle cx="19" cy="19" r="2" fill="#fff0b0"/>`),
  },
  // ---- Frost (mage) ----
  {
    id: 'frostNova',
    name: 'Frost Nova',
    branch: 'frost',
    tier: 0,
    maxRank: 5,
    active: true,
    cost: () => 22,
    cooldown: () => 8,
    text: (r) => `A ring of ice bursts out to 5m, dealing ${pct(SK.frostNovaMult(r))} damage and freezing foes in place for ${SK.frostNovaFreeze(r).toFixed(1)}s.`,
    icon: svg(`<circle cx="16" cy="16" r="12" fill="none" stroke="#8ad8ff" stroke-width="2" stroke-dasharray="4 3"/><path d="M16 6v20M7 11l18 10M25 11L7 21" stroke="#e0f6ff" stroke-width="2"/>`),
  },
  {
    id: 'frostSkin',
    name: 'Frost Skin',
    branch: 'frost',
    tier: 0,
    maxRank: 5,
    active: false,
    text: (r) => `+${pct(SK.frostSkin(r))} armour.`,
    icon: svg(`<path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#2a4a68" stroke="#9ad8ff" stroke-width="1.5"/><path d="M16 8v14M10 12l12 6M22 12l-12 6" stroke="#e0f6ff" stroke-width="1.4"/>`),
  },
  {
    id: 'iceShards',
    aimed: true,
    name: 'Ice Shards',
    branch: 'frost',
    tier: 1,
    maxRank: 5,
    active: true,
    cost: () => 16,
    cooldown: () => 1.5,
    text: (r) => `Fire a fan of five ice shards toward the cursor; each strikes the first foe it meets for ${pct(SK.shardsMult(r))} damage and chills it briefly.`,
    icon: svg(`<path d="M4 26L20 6M4 26l22-8M4 26l10-22" stroke="#9ad8ff" stroke-width="2.4"/><path d="M18 4l4 1-1 4zM25 16l3 3-4 1zM12 2l4 1-2 3z" fill="#e8faff"/>`),
  },
  {
    id: 'wintersResolve',
    name: 'Winter’s Resolve',
    branch: 'frost',
    tier: 1,
    maxRank: 3,
    active: false,
    text: (r) => `+${pct(SK.wintersResolve(r))} maximum life.`,
    icon: svg(`<path d="M16 27C6 20 4 14 6 10c2-4 8-5 10 0 2-5 8-4 10 0 2 4 0 10-10 17z" fill="#2a5a80" stroke="#bfe8ff" stroke-width="1.5"/><path d="M16 11v10M12 13l8 6M20 13l-8 6" stroke="#e8faff" stroke-width="1.3"/>`),
  },
  {
    id: 'blizzard',
    aimed: true,
    name: 'Blizzard',
    branch: 'frost',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 45,
    cooldown: () => 14,
    text: (r) => `Summon a storm of ice over the cursor for 5s: foes within 4m take ${pct(SK.blizzardMult(r))} damage every half second and are slowed to a crawl.`,
    icon: svg(`<path d="M6 12a6 6 0 0 1 6-6 8 8 0 0 1 14 3 5 5 0 0 1-1 10H8a4 4 0 0 1-2-7z" fill="#3a5a78" stroke="#bfe8ff" stroke-width="1.3"/><path d="M10 22l-2 6M16 22l-2 7M22 22l-2 6" stroke="#e8faff" stroke-width="1.8"/>`),
  },
  // ---- Arcane (mage) ----
  {
    id: 'manaFlow',
    name: 'Mana Flow',
    branch: 'arcane',
    tier: 0,
    maxRank: 5,
    active: false,
    text: (r) => `+${SK.manaFlow(r).toFixed(1)} mana per second.`,
    icon: svg(`<path d="M6 10c6-4 12 4 20 0M6 16c6-4 12 4 20 0M6 22c6-4 12 4 20 0" fill="none" stroke="#a88cff" stroke-width="2"/><circle cx="26" cy="22" r="2" fill="#e8dcff"/>`),
  },
  {
    id: 'focus',
    name: 'Focus',
    branch: 'arcane',
    tier: 0,
    maxRank: 5,
    active: false,
    text: (r) => `+${pct(SK.focus(r))} maximum mana.`,
    icon: svg(`<path d="M16 3l5 13-5 13-5-13z" fill="#6a4ab8" stroke="#e0d0ff" stroke-width="1.4"/><circle cx="16" cy="16" r="3" fill="#f4eeff"/>`),
  },
  {
    id: 'blink',
    aimed: true,
    name: 'Blink',
    branch: 'arcane',
    tier: 1,
    maxRank: 5,
    active: true,
    cost: () => 15,
    cooldown: () => 5,
    text: (r) => `Vanish and reappear at the cursor (up to 8m), the air cracking around you for ${pct(SK.blinkMult(r))} damage.`,
    icon: svg(`<circle cx="7" cy="22" r="4" fill="none" stroke="#a88cff" stroke-width="1.5" stroke-dasharray="2 2"/><circle cx="24" cy="10" r="5" fill="#8a6ae0" stroke="#e8dcff" stroke-width="1.5"/><path d="M10 19l10-6" stroke="#e8dcff" stroke-width="1.6" stroke-dasharray="3 2"/>`),
  },
  {
    id: 'arcaneHaste',
    name: 'Arcane Haste',
    branch: 'arcane',
    tier: 1,
    maxRank: 3,
    active: false,
    text: (r) => `+${pct(SK.arcaneHaste(r))} casting and attack speed.`,
    icon: svg(`<path d="M18 3L8 18h7l-3 11 12-16h-7z" fill="#7a5ad0" stroke="#e0d0ff" stroke-width="1.2"/>`),
  },
  {
    id: 'arcaneBarrage',
    aimed: true,
    name: 'Arcane Barrage',
    branch: 'arcane',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 35,
    cooldown: () => 9,
    text: (r) => `Loose ten seeking arcane missiles at foes near the cursor, each dealing ${pct(SK.barrageMult(r))} damage.`,
    icon: svg(`<circle cx="24" cy="8" r="3" fill="#e8dcff"/><circle cx="10" cy="12" r="2.5" fill="#c8b0ff"/><circle cx="20" cy="22" r="2.5" fill="#c8b0ff"/><path d="M4 28c4-8 10-14 18-18M4 28c6-2 11-4 14-5M4 28c1-6 3-11 5-14" fill="none" stroke="#a88cff" stroke-width="1.6"/>`),
  },
];

export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<SkillId, SkillDef>;

/** Belt keys active skills can sit on, in order. */
export const BELT_KEYS = ['RMB', '2', '3', '4', '5'] as const;
