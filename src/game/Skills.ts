// The hero's skill tree: three branches of eight skills each, in four tiers.
// A point comes with every level (and one to start); deeper tiers open once
// enough points sit in the branch, and the fourth holds a keystone: a big
// passive with a real cost. Every active skill also has two or three
// modifiers (one point each, open once the skill has a rank) that change how
// it plays. Active skills go on the belt (right click and 2 to 5), passives
// fold into the hero's numbers in Stats.recompute.

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
  | 'arcaneBarrage'
  // Deeper trees: new skills
  | 'lunge'
  | 'executioner'
  | 'recklessFury'
  | 'judgement'
  | 'sanctuary'
  | 'ironVow'
  | 'hemorrhage'
  | 'exsanguinate'
  | 'bloodMagic'
  | 'fireWall'
  | 'ignite'
  | 'pyreSoul'
  | 'glacialSpike'
  | 'iceArmor'
  | 'absoluteZero'
  | 'arcaneOrb'
  | 'manaShield'
  | 'overload'
  // Modifiers (one point each, hang off an active skill)
  | 'cleaveRend'
  | 'cleaveWide'
  | 'cleaveTwin'
  | 'leapAftershock'
  | 'leapMolten'
  | 'whirlGyre'
  | 'whirlVortex'
  | 'whirlCrown'
  | 'lungeStun'
  | 'lungeEcho'
  | 'warCryRally'
  | 'warCryFury'
  | 'warCryThunder'
  | 'consecFollow'
  | 'consecSmite'
  | 'judgeTriple'
  | 'judgeHallow'
  | 'lanceFan'
  | 'lanceBarbs'
  | 'novaPool'
  | 'novaEcho'
  | 'hemoContagion'
  | 'hemoFeast'
  | 'fireballSplit'
  | 'fireballRing'
  | 'fireballComet'
  | 'waveTwin'
  | 'waveTrail'
  | 'meteorShower'
  | 'meteorMolten'
  | 'wallRing'
  | 'wallMarch'
  | 'novaSpikes'
  | 'novaField'
  | 'shardsPierce'
  | 'shardsVolley'
  | 'blizzardEye'
  | 'blizzardHail'
  | 'spikeStar'
  | 'spikePermafrost'
  | 'armorRetaliate'
  | 'armorMend'
  | 'blinkEcho'
  | 'blinkPhase'
  | 'barrageChain'
  | 'barrageBurst'
  | 'orbTwin'
  | 'orbSingularity';

export type Branch = 'blade' | 'bulwark' | 'blood' | 'fire' | 'frost' | 'arcane';

export interface SkillDef {
  id: SkillId;
  name: string;
  branch: Branch;
  /** 0 to 3: deeper tiers need points spent in the branch first. */
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
  /** A modifier: the active skill it changes (open once that has a rank). */
  mod?: SkillId;
  /** A keystone passive: a big gain with a price, spelled out in `drawback`. */
  keystone?: boolean;
  drawback?: string;
}

/** Points that must already be in a branch before a tier opens. */
export const TIER_NEEDS = [0, 3, 6, 10];
export const TIER_NAMES = ['I', 'II', 'III', 'IV'];

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
  // Deeper trees (knight)
  lungeMult: (r: number) => 1.2 + 0.25 * r,
  lungeRange: 7,
  executioner: (r: number) => 0.12 * r,
  executeBelow: 0.35,
  recklessDmg: 0.35,
  recklessSpeed: 0.1,
  judgementMult: (r: number) => 2.2 + 0.4 * r,
  judgementStun: (r: number) => 1.0 + 0.2 * r,
  sanctuary: (r: number) => 0.04 * r,
  ironVowArmor: 0.5,
  ironVowLife: 0.15,
  ironVowDmg: -0.2,
  hemoMult: (r: number) => 0.8 + 0.2 * r,
  /** Bleed from Hemorrhage, as weapon damage per second, for `bleedTime` seconds. */
  hemoBleed: (r: number) => 0.3 + 0.08 * r,
  bleedTime: 4,
  exsanguinate: (r: number) => 0.08 * r,
  bloodMagicDmg: 0.15,
  // Deeper trees (mage)
  fireWallMult: (r: number) => 0.35 + 0.1 * r,
  fireWallTime: 4,
  /** Burn left by fire spells, as damage per second for 3s. */
  ignite: (r: number) => 0.15 * r,
  pyreSoulDmg: 0.3,
  spikeMult: (r: number) => 1.8 + 0.3 * r,
  spikeFreeze: (r: number) => 1.0 + 0.2 * r,
  iceArmor: (r: number) => 0.4 + 0.1 * r,
  iceArmorTime: 10,
  zeroChill: 1.5,
  zeroDmg: 0.2,
  zeroSpeed: -0.15,
  orbZap: (r: number) => 0.35 + 0.1 * r,
  orbBlast: (r: number) => 1.5 + 0.3 * r,
  manaShield: (r: number) => 0.12 * r,
  overloadDmg: 0.3,
  overloadSpeed: 0.1,
  // Modifiers
  rendBleed: 0.2, // weapon damage per second for bleedTime: 80% over 4s
  wideReach: 3.6,
  twinMult: 0.6,
  aftershockMult: 0.7,
  moltenTick: 0.2,
  gyreBleed: 0.12,
  echoMult: 0.6,
  crownMult: 0.5,
  wardTime: 4,
  lungeStun: 1.0,
  rallyHeal: 0.15,
  furySpeed: 0.25,
  thunderMult: 0.8,
  smiteMult: 0.8,
  tripleMult: 0.6,
  fanMult: 0.7,
  barbBleed: 0.2,
  novaEchoMult: 0.5,
  novaPoolBleed: 0.25,
  feastHeal: 0.25,
  splitMult: 0.5,
  ringTick: 0.15,
  waveTwinMult: 0.75,
  showerMult: 0.4,
  novaSpikeMult: 0.6,
  hailMult: 1.2,
  starMult: 0.5,
  retaliateMult: 0.6,
  armorMend: 0.02,
  phaseCut: 0.5,
  barrageBurstMult: 0.5,
  twinOrbMult: 0.65,
};

/** Gold Brother Anselm asks to lift every learned skill (see Game.respec). */
export const respecCost = (level: number) => (level <= 2 ? 0 : Math.round(20 * level + 5 * level * level));

const BASE: SkillDef[] = [
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

// ---------------------------------------------------------------- deeper trees

const NEW: SkillDef[] = [
  // ---- Blade ----
  {
    id: 'lunge',
    aimed: true,
    name: 'Lunge',
    branch: 'blade',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 16,
    cooldown: () => 5,
    text: (r) => `Drive forward up to ${SK.lungeRange}m with the blade levelled, striking every foe in your path for ${pct(SK.lungeMult(r))} weapon damage.`,
    icon: svg(`<path d="M3 22h8M3 17h11M5 27h6" stroke="#f0a060" stroke-width="1.6"/><path d="M12 20L27 6l1 4-12 13z" fill="#e0d8d0" stroke="#3a2a20"/><path d="M12 20l-2 3 3 1z" fill="#c08040"/><circle cx="27" cy="7" r="2" fill="#fff0c0"/>`),
  },
  {
    id: 'executioner',
    name: 'Executioner',
    branch: 'blade',
    tier: 3,
    maxRank: 3,
    active: false,
    text: (r) => `+${pct(SK.executioner(r))} damage against foes below ${pct(SK.executeBelow)} life.`,
    icon: svg(`<path d="M8 4h12l4 8-8 3-8-3z" fill="#9a9088" stroke="#3a2a20"/><path d="M16 15v14" stroke="#7a4a2a" stroke-width="3"/><path d="M6 26h20" stroke="#e05040" stroke-width="2"/>`),
  },
  {
    id: 'recklessFury',
    name: 'Reckless Fury',
    branch: 'blade',
    tier: 3,
    maxRank: 1,
    active: false,
    keystone: true,
    text: () => `+${pct(SK.recklessDmg)} damage and +${pct(SK.recklessSpeed)} attack speed.`,
    drawback: 'Your armour is halved.',
    icon: svg(`<path d="M16 2l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z" fill="#7a2a14" stroke="#ffb070" stroke-width="1.4"/><path d="M11 20L21 10M13 22l8-8" stroke="#ffe0b0" stroke-width="1.6"/>`),
  },
  // ---- Bulwark ----
  {
    id: 'judgement',
    aimed: true,
    name: 'Judgement',
    branch: 'bulwark',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 28,
    cooldown: () => 9,
    text: (r) => `Call a hammer of light down on the cursor: it smites everything within 3m for ${pct(SK.judgementMult(r))} weapon damage and stuns for ${SK.judgementStun(r).toFixed(1)}s.`,
    icon: svg(`<path d="M16 1v8" stroke="#fff0c0" stroke-width="1.5"/><rect x="8" y="8" width="16" height="8" rx="1" fill="#d8b860" stroke="#3a2a20"/><path d="M16 16v9" stroke="#8a6030" stroke-width="3"/><path d="M4 29c4-3 20-3 24 0" stroke="#ffe090" stroke-width="2" fill="none"/><path d="M9 26l-3-3M23 26l3-3" stroke="#ffd070" stroke-width="1.4"/>`),
  },
  {
    id: 'sanctuary',
    name: 'Sanctuary',
    branch: 'bulwark',
    tier: 3,
    maxRank: 3,
    active: false,
    text: (r) => `Take ${pct(SK.sanctuary(r))} less damage from every blow.`,
    icon: svg(`<path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#3a3020" stroke="#ffe090" stroke-width="1.5"/><path d="M16 9v13M11 13h10" stroke="#fff0c0" stroke-width="2"/>`),
  },
  {
    id: 'ironVow',
    name: 'Iron Vow',
    branch: 'bulwark',
    tier: 3,
    maxRank: 1,
    active: false,
    keystone: true,
    text: () => `+${pct(SK.ironVowArmor)} armour and +${pct(SK.ironVowLife)} maximum life.`,
    drawback: `You deal ${pct(-SK.ironVowDmg)} less damage.`,
    icon: svg(`<path d="M16 2l12 5v8c0 8-6 13-12 15C10 28 4 23 4 15V7z" fill="#5a5048" stroke="#ffe090" stroke-width="2"/><circle cx="16" cy="15" r="5" fill="none" stroke="#ffe090" stroke-width="2"/><path d="M16 6v4M16 20v4M7 15h4M21 15h4" stroke="#ffe090" stroke-width="1.5"/>`),
  },
  // ---- Blood ----
  {
    id: 'hemorrhage',
    aimed: true,
    name: 'Hemorrhage',
    branch: 'blood',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 22,
    cooldown: () => 7,
    text: (r) => `Tear open the veins of every foe within 3.5m of the cursor: ${pct(SK.hemoMult(r))} weapon damage, then they bleed for ${pct(SK.hemoBleed(r) * SK.bleedTime)} more over ${SK.bleedTime}s.`,
    icon: svg(`<circle cx="16" cy="18" r="10" fill="none" stroke="#a01010" stroke-width="2" stroke-dasharray="3 2"/><path d="M16 4c3 5 5 7 5 10a5 5 0 0 1-10 0c0-3 2-5 5-10z" fill="#d01818" stroke="#ff8070"/><path d="M8 24l-2 4M24 24l2 4M16 28v3" stroke="#ff4030" stroke-width="1.6"/>`),
  },
  {
    id: 'exsanguinate',
    name: 'Exsanguinate',
    branch: 'blood',
    tier: 3,
    maxRank: 3,
    active: false,
    text: (r) => `Bleeding foes take +${pct(SK.exsanguinate(r))} damage from you.`,
    icon: svg(`<path d="M10 4c3 5 5 7 5 10a5 5 0 0 1-10 0c0-3 2-5 5-10zM22 10c3 5 5 7 5 10a5 5 0 0 1-10 0c0-3 2-5 5-10z" fill="#b01010" stroke="#ff7060"/><path d="M6 28h20" stroke="#ff4030" stroke-width="2"/>`),
  },
  {
    id: 'bloodMagic',
    name: 'Blood Magic',
    branch: 'blood',
    tier: 3,
    maxRank: 1,
    active: false,
    keystone: true,
    text: () => `Skills cost life instead of mana, and you deal +${pct(SK.bloodMagicDmg)} damage.`,
    drawback: 'Every skill is paid for in your own blood, and none can be cast with too little life.',
    icon: svg(`<circle cx="16" cy="16" r="13" fill="#2a0606" stroke="#ff4030" stroke-width="1.5"/><path d="M16 6c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z" fill="#e01818"/><path d="M6 16h4M22 16h4M16 26v3" stroke="#6a90ff" stroke-width="1.5"/>`),
  },
  // ---- Fire ----
  {
    id: 'fireWall',
    aimed: true,
    name: 'Fire Wall',
    branch: 'fire',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 30,
    cooldown: () => 10,
    text: (r) => `Raise a 7m wall of roaring flame across the cursor for ${SK.fireWallTime}s; foes in it burn for ${pct(SK.fireWallMult(r))} damage every half second.`,
    icon: svg(`<path d="M3 27h26" stroke="#ffb060" stroke-width="2"/><path d="M5 27c-1-6 3-8 2-14 3 3 4 6 3 9 2-4 1-9 4-14 2 5 5 8 4 14 2-3 2-6 4-8 2 5 3 9 2 13z" fill="#e05a20" stroke="#ffc070" stroke-width="1"/><path d="M11 27c0-3 2-4 2-6 1 2 2 4 1 6M18 27c0-3 2-4 2-6 1 2 2 4 1 6" fill="#fff0b0"/>`),
  },
  {
    id: 'ignite',
    name: 'Ignite',
    branch: 'fire',
    tier: 3,
    maxRank: 3,
    active: false,
    text: (r) => `Your fire spells set foes alight: they burn for ${pct(SK.ignite(r) * 3)} damage over 3s.`,
    icon: svg(`<path d="M16 4c5 6 8 10 8 15a8 8 0 0 1-16 0c0-3 2-5 3-6 0 3 1 4 2 4-1-4 1-9 3-13z" fill="#c84a18" stroke="#ffb060" stroke-width="1.3"/><circle cx="9" cy="8" r="1.5" fill="#ffd070"/><circle cx="24" cy="6" r="1" fill="#ffd070"/><circle cx="26" cy="13" r="1.3" fill="#ffd070"/>`),
  },
  {
    id: 'pyreSoul',
    name: 'Pyre Soul',
    branch: 'fire',
    tier: 3,
    maxRank: 1,
    active: false,
    keystone: true,
    text: () => `You burn hotter: +${pct(SK.pyreSoulDmg)} damage.`,
    drawback: 'Your life no longer regenerates.',
    icon: svg(`<path d="M16 28C7 22 5 16 7 11c2-4 7-5 9 0 2-5 7-4 9 0 2 5 0 11-9 17z" fill="#601808" stroke="#ff8a30" stroke-width="1.5"/><path d="M16 23c-3-2-4-5-3-8 1 1 2 2 2 3 0-3 1-5 2-7 2 3 3 5 2 8 1-1 1-2 2-2 0 3-2 5-5 6z" fill="#ffb040"/>`),
  },
  // ---- Frost ----
  {
    id: 'glacialSpike',
    aimed: true,
    name: 'Glacial Spike',
    branch: 'frost',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 24,
    cooldown: () => 4,
    text: (r) => `Hurl a great spear of ice that bursts into a star of shards on the first foe it meets: ${pct(SK.spikeMult(r))} damage within 2.5m, freezing foes for ${SK.spikeFreeze(r).toFixed(1)}s.`,
    icon: svg(`<path d="M4 28L22 10" stroke="#9ad8ff" stroke-width="3"/><path d="M24 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#e8faff" stroke="#7ac8f0"/><path d="M24 4v12M18 10h12" stroke="#ffffff" stroke-width="0.8"/>`),
  },
  {
    id: 'iceArmor',
    name: 'Ice Armour',
    branch: 'frost',
    tier: 3,
    maxRank: 3,
    active: true,
    cost: () => 30,
    cooldown: () => 20,
    text: (r) => `Sheathe yourself in a circling guard of ice stars for ${SK.iceArmorTime}s: +${pct(SK.iceArmor(r))} armour, and any foe that strikes you is chilled.`,
    icon: svg(`<path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#1a3a58" stroke="#bfe8ff" stroke-width="1.5"/><path d="M16 8v14M10 11.5l12 7M22 11.5l-12 7" stroke="#e8faff" stroke-width="1.6"/><circle cx="16" cy="15" r="2" fill="#ffffff"/>`),
  },
  {
    id: 'absoluteZero',
    name: 'Absolute Zero',
    branch: 'frost',
    tier: 3,
    maxRank: 1,
    active: false,
    keystone: true,
    text: () => `Your chills and freezes last ${pct(SK.zeroChill - 1)} longer, and chilled foes take +${pct(SK.zeroDmg)} damage from you.`,
    drawback: `You cast and attack ${pct(-SK.zeroSpeed)} slower.`,
    icon: svg(`<circle cx="16" cy="16" r="13" fill="#0a1a2a" stroke="#9ad8ff" stroke-width="1.5"/><path d="M16 4v24M5.6 10l20.8 12M26.4 10L5.6 22" stroke="#e8faff" stroke-width="1.8"/><circle cx="16" cy="16" r="3.5" fill="#0a1a2a" stroke="#ffffff"/>`),
  },
  // ---- Arcane ----
  {
    id: 'arcaneOrb',
    aimed: true,
    name: 'Arcane Orb',
    branch: 'arcane',
    tier: 2,
    maxRank: 3,
    active: true,
    cost: () => 32,
    cooldown: () => 8,
    text: (r) => `Send a slow, crackling orb toward the cursor. It lashes up to three foes within 3.5m for ${pct(SK.orbZap(r))} damage every 0.4s, then detonates for ${pct(SK.orbBlast(r))} within 3m.`,
    icon: svg(`<circle cx="16" cy="16" r="8" fill="#6a4ab8" stroke="#e8dcff" stroke-width="1.5"/><circle cx="16" cy="16" r="3.5" fill="#f4eeff"/><path d="M24 12l5-3-2 5 4 1M8 20l-5 3 3 1-2 4M20 24l2 5" fill="none" stroke="#c8b0ff" stroke-width="1.4"/>`),
  },
  {
    id: 'manaShield',
    name: 'Mana Shield',
    branch: 'arcane',
    tier: 3,
    maxRank: 3,
    active: false,
    text: (r) => `${pct(SK.manaShield(r))} of the damage you take is drained from your mana instead of your life.`,
    icon: svg(`<circle cx="16" cy="16" r="12" fill="none" stroke="#a88cff" stroke-width="2"/><circle cx="16" cy="16" r="8" fill="#2a1a58" stroke="#e0d0ff" stroke-width="1"/><path d="M16 10v12M11 14l5-4 5 4" fill="none" stroke="#6a90ff" stroke-width="1.6"/>`),
  },
  {
    id: 'overload',
    name: 'Arcane Overload',
    branch: 'arcane',
    tier: 3,
    maxRank: 1,
    active: false,
    keystone: true,
    text: () => `+${pct(SK.overloadDmg)} damage and +${pct(SK.overloadSpeed)} casting speed.`,
    drawback: 'Your mana regenerates half as fast.',
    icon: svg(`<path d="M16 2l3 9 9-3-6 8 6 8-9-3-3 9-3-9-9 3 6-8-6-8 9 3z" fill="#4a2a90" stroke="#e8dcff" stroke-width="1.3"/><circle cx="16" cy="16" r="4" fill="#ffffff"/>`),
  },
];

// ---------------------------------------------------------------- modifiers

/** Little glyphs for modifier nodes, by what they do. */
const GLYPH = {
  bleed: (c: string) => `<path d="M16 5c4 6 7 9 7 13a7 7 0 0 1-14 0c0-4 3-7 7-13z" fill="${c}"/>`,
  burn: (c: string) => `<path d="M16 4c5 6 8 10 8 15a8 8 0 0 1-16 0c0-4 3-6 4-7 0 3 1 4 2 4-1-4 0-8 2-12z" fill="${c}"/>`,
  split: (c: string) => `<path d="M6 24L16 14M16 14l10-10M16 14h10M16 14l8 8" stroke="${c}" stroke-width="2.5" fill="none"/><circle cx="16" cy="14" r="3" fill="${c}"/>`,
  ring: (c: string) => `<circle cx="16" cy="16" r="10" fill="none" stroke="${c}" stroke-width="3"/><circle cx="16" cy="16" r="3" fill="${c}"/>`,
  echo: (c: string) => `<path d="M8 6c8 4 8 16 0 20M15 6c8 4 8 16 0 20" stroke="${c}" stroke-width="2.5" fill="none"/>`,
  stun: (c: string) => `<path d="M16 3l3 9 9 1-7 6 2 9-7-5-7 5 2-9-7-6 9-1z" fill="${c}"/>`,
  chill: (c: string) => `<path d="M16 3v26M5 9.5l22 13M27 9.5l-22 13" stroke="${c}" stroke-width="2.4"/>`,
  pull: (c: string) => `<path d="M16 16m-2 0a2 2 0 1 1 4 0a5 5 0 0 1-10 0a8 8 0 0 1 16 0a11 11 0 0 1-22 0" stroke="${c}" stroke-width="2" fill="none"/>`,
  heal: (c: string) => `<path d="M12 5h8v7h7v8h-7v7h-8v-7H5v-8h7z" fill="${c}"/>`,
  speed: (c: string) => `<path d="M18 3L8 18h7l-3 11 12-16h-7z" fill="${c}"/>`,
  wide: (c: string) => `<path d="M3 20a13 13 0 0 1 26 0" stroke="${c}" stroke-width="3" fill="none"/><path d="M3 20l4-2M29 20l-4-2" stroke="${c}" stroke-width="2"/>`,
  multi: (c: string) => `<circle cx="9" cy="20" r="4" fill="${c}"/><circle cx="23" cy="20" r="4" fill="${c}"/><circle cx="16" cy="9" r="4" fill="${c}"/>`,
  pierce: (c: string) => `<path d="M3 16h22M20 10l7 6-7 6" stroke="${c}" stroke-width="3" fill="none"/><circle cx="12" cy="16" r="3" fill="none" stroke="${c}" stroke-width="1.5"/>`,
  follow: (c: string) => `<circle cx="16" cy="11" r="4" fill="${c}"/><ellipse cx="16" cy="24" rx="11" ry="4" fill="none" stroke="${c}" stroke-width="2.5"/>`,
  shield: (c: string) => `<path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="none" stroke="${c}" stroke-width="2.5"/>`,
  fall: (c: string) => `<path d="M10 3l4 14M18 3l4 14M4 6l4 10" stroke="${c}" stroke-width="2"/><circle cx="16" cy="23" r="5" fill="${c}"/>`,
};

const MOD_DEFS: [SkillId, SkillId, string, keyof typeof GLYPH, () => string][] = [
  // Knight
  ['cleaveRend', 'cleave', 'Rending Cleave', 'bleed', () => `Foes struck bleed for ${pct(SK.rendBleed * SK.bleedTime)} weapon damage over ${SK.bleedTime}s.`],
  ['cleaveWide', 'cleave', 'Sweeping Arc', 'wide', () => `Reach grows from 2.5m to ${SK.wideReach}m and foes struck are hurled back.`],
  ['cleaveTwin', 'cleave', 'Twin Cleave', 'echo', () => `A second, backhand spin follows for ${pct(SK.twinMult)} of the damage.`],
  ['leapAftershock', 'leapSlam', 'Aftershock', 'ring', () => `Half a second after you land the ground erupts again out to 4.5m for ${pct(SK.aftershockMult)} of the damage.`],
  ['leapMolten', 'leapSlam', 'Molten Landing', 'burn', () => `The landing cracks the ground open: it burns for 3s, ${pct(SK.moltenTick)} weapon damage every half second.`],
  ['whirlGyre', 'whirlwind', 'Crimson Gyre', 'bleed', () => `Every blade that bites leaves the foe bleeding for ${pct(SK.gyreBleed * SK.bleedTime)} weapon damage over ${SK.bleedTime}s.`],
  ['whirlVortex', 'whirlwind', 'Vortex', 'pull', () => `The storm drags foes within 5m in toward you.`],
  ['whirlCrown', 'whirlwind', 'Crown of Blades', 'split', () => `When the storm ends, twelve blades wheel round a burning heart and fly outward, each striking the first foe it meets for ${pct(SK.crownMult)} weapon damage.`],
  ['lungeStun', 'lunge', 'Earthsplitter', 'stun', () => `The blade drags through the ground and splits it open behind you: slabs heave up, fire bursts from the crack, and foes struck are stunned for ${SK.lungeStun.toFixed(1)}s.`],
  ['lungeEcho', 'lunge', 'Phantom Blade', 'echo', () => `A great spectral sword follows your path a moment later, striking again for ${pct(SK.echoMult)} of the damage.`],
  ['warCryRally', 'warCry', 'Rallying Cry', 'heal', () => `The roar also heals you for ${pct(SK.rallyHeal)} of your maximum life.`],
  ['warCryFury', 'warCry', 'Battle Fury', 'speed', () => `+${pct(SK.furySpeed)} attack speed while the armour lasts.`],
  ['warCryThunder', 'warCry', 'Thunderous Roar', 'ring', () => `The roar itself hits for ${pct(SK.thunderMult)} weapon damage.`],
  ['consecFollow', 'consecration', 'Walking Faith', 'follow', () => `The hallowed ground moves with you instead of staying put.`],
  ['consecSmite', 'consecration', 'Smiting Light', 'fall', () => `Once a second a shaft of light strikes a foe inside for ${pct(SK.smiteMult)} weapon damage.`],
  ['judgeTriple', 'judgement', 'Hammers of Wrath', 'multi', () => `Two more hammers fall beside the first, each for ${pct(SK.tripleMult)} of the damage.`],
  ['judgeHallow', 'judgement', 'Hallowed Pillar', 'heal', () => `A pillar of the old cathedral rises from the crater and stands for 4s: the ground round it burns foes and mends you like Consecration.`],
  ['lanceFan', 'bloodLance', 'Splitting Lance', 'split', () => `Hurl three lances in a fan, each for ${pct(SK.fanMult)} of the damage.`],
  ['lanceBarbs', 'bloodLance', 'Barbed Lance', 'bleed', () => `Foes pierced bleed for ${pct(SK.barbBleed * SK.bleedTime)} weapon damage over ${SK.bleedTime}s.`],
  ['novaPool', 'bloodNova', 'Blood Pool', 'bleed', () => `The nova leaves a ring-walled pool of blood for 4s; foes in it bleed ${pct(SK.novaPoolBleed)} weapon damage a second.`],
  ['novaEcho', 'bloodNova', 'Second Pulse', 'echo', () => `A second nova follows the first for ${pct(SK.novaEchoMult)} of the damage, costing no life.`],
  ['hemoContagion', 'hemorrhage', 'Contagion', 'split', () => `A foe that dies bleeding passes its wounds to every foe within 3.5m.`],
  ['hemoFeast', 'hemorrhage', 'Blood Feast', 'heal', () => `Your bleeds heal you for ${pct(SK.feastHeal)} of the damage they deal.`],
  // Mage
  ['fireballSplit', 'fireball', 'Splitting Fireball', 'split', () => `The burst throws three smaller fireballs onward, each for ${pct(SK.splitMult)} of the damage.`],
  ['fireballRing', 'fireball', 'Burning Ground', 'ring', () => `The burst leaves a ring of fire on the ground for 3s, ${pct(SK.ringTick)} damage every half second.`],
  ['fireballComet', 'fireball', 'Comet', 'pierce', () => `Flies half again as fast and tears through the first foe, bursting on the second.`],
  ['waveTwin', 'flameWave', 'Twin Waves', 'split', () => `Two waves roll out side by side at an angle, each for ${pct(SK.waveTwinMult)} of the damage.`],
  ['waveTrail', 'flameWave', 'Scorched Earth', 'burn', () => `The wave leaves its path burning for 3s.`],
  ['meteorShower', 'meteor', 'Meteor Shower', 'fall', () => `Three smaller stones fall around the first, each for ${pct(SK.showerMult)} of the damage.`],
  ['meteorMolten', 'meteor', 'Molten Crater', 'burn', () => `The crater burns for 6s instead of 3, wider and twice as hot.`],
  ['wallRing', 'fireWall', 'Ring of Fire', 'ring', () => `The flames rise in a ring around the cursor instead of a line.`],
  ['wallMarch', 'fireWall', 'Advancing Flames', 'speed', () => `The wall rolls slowly forward, away from you.`],
  ['novaSpikes', 'frostNova', 'Ice Spikes', 'split', () => `Eight shards fly out from the nova, each hitting the first foe it meets for ${pct(SK.novaSpikeMult)} of the damage.`],
  ['novaField', 'frostNova', 'Lingering Cold', 'chill', () => `Leaves a field of rime for 4s that keeps chilling foes inside it.`],
  ['shardsPierce', 'iceShards', 'Piercing Shards', 'pierce', () => `Shards fly through foes, hitting everything in their path.`],
  ['shardsVolley', 'iceShards', 'Volley', 'multi', () => `Fire nine shards in a wider fan.`],
  ['blizzardEye', 'blizzard', 'Eye of the Storm', 'follow', () => `The storm is centred on you and moves with you.`],
  ['blizzardHail', 'blizzard', 'Hailstones', 'fall', () => `Great hailstones crash down on foes inside for ${pct(SK.hailMult)} of the damage, stunning briefly.`],
  ['spikeStar', 'glacialSpike', 'Shatterstar', 'split', () => `The burst throws six ice shards outward, each for ${pct(SK.starMult)} of the damage.`],
  ['spikePermafrost', 'glacialSpike', 'Permafrost', 'chill', () => `Freezes twice as long and leaves a floor of cracked ice for 4s that chills foes on it.`],
  ['armorRetaliate', 'iceArmor', 'Frost Retaliation', 'ring', () => `When struck, the stars burst outward (at most every 1.5s), hitting foes within 3m for ${pct(SK.retaliateMult)} damage and freezing them.`],
  ['armorMend', 'iceArmor', 'Glacial Mending', 'heal', () => `Regain ${pct(SK.armorMend)} of your life every second while it lasts.`],
  ['blinkEcho', 'blink', 'Arcane Echo', 'echo', () => `The place you leave cracks apart too, for the same damage.`],
  ['blinkPhase', 'blink', 'Warding Circle', 'shield', () => `You arrive inside a circle of glyphs and candles that stands for ${SK.wardTime}s; while you are in it you take ${pct(SK.phaseCut)} less damage.`],
  ['barrageChain', 'arcaneBarrage', 'Chain Missiles', 'split', () => `Each missile leaps on to a second foe within 5m.`],
  ['barrageBurst', 'arcaneBarrage', 'Unstable Missiles', 'ring', () => `Each missile bursts on impact, hitting foes within 1.5m for ${pct(SK.barrageBurstMult)} of the damage.`],
  ['orbTwin', 'arcaneOrb', 'Twin Orbs', 'multi', () => `Two orbs fly out, winding around each other, each for ${pct(SK.twinOrbMult)} of the damage.`],
  ['orbSingularity', 'arcaneOrb', 'Singularity', 'pull', () => `The orb drags foes within 5m toward it as it travels, and its detonation tears open a void pit that keeps pulling for 2s.`],
];

const MODS: SkillDef[] = MOD_DEFS.map(([id, parent, name, glyph, text]) => {
  const p = [...BASE, ...NEW].find((d) => d.id === parent)!;
  const color = BRANCHES.find((b) => b.id === p.branch)!.color;
  return { id, name, branch: p.branch, tier: p.tier, maxRank: 1, active: false, mod: parent, text: () => text(), icon: svg(GLYPH[glyph](color)) };
});

export const SKILLS: SkillDef[] = [...BASE, ...NEW, ...MODS];

/** The modifiers that hang off an active skill. */
export const modsOf = (id: SkillId) => MODS.filter((m) => m.mod === id);

export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<SkillId, SkillDef>;

/** Belt keys active skills can sit on, in order. */
export const BELT_KEYS = ['RMB', '2', '3', '4', '5'] as const;
