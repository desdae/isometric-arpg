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
  | 'bloodNova';

export type Branch = 'blade' | 'bulwark' | 'blood';

export interface SkillDef {
  id: SkillId;
  name: string;
  branch: Branch;
  /** 0, 1 or 2: deeper tiers need points spent in the branch first. */
  tier: number;
  maxRank: number;
  active: boolean;
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

export const BRANCHES: { id: Branch; name: string; blurb: string; color: string }[] = [
  { id: 'blade', name: 'Blade', blurb: 'Steel and fury', color: '#e0804a' },
  { id: 'bulwark', name: 'Bulwark', blurb: 'Faith and iron', color: '#d8c070' },
  { id: 'blood', name: 'Blood', blurb: 'The crypt’s dark gift', color: '#e03a3a' },
];

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
];

export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<SkillId, SkillDef>;

/** Belt keys active skills can sit on, in order. */
export const BELT_KEYS = ['RMB', '2', '3', '4', '5'] as const;
