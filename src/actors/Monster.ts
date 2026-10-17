import * as THREE from 'three';
import { audio } from '../audio/Audio';
import type { NavGrid } from '../world/NavGrid';
import type { HeightFn } from '../procgen/terrain';
import type { Combatant } from '../game/Combat';
import { mitigate, rollDamage } from '../game/Combat';
import { levelFloor, monsterArmorScale, monsterDamageScale, monsterLifeScale, signatureMult } from '../game/Balance';
import { Telegraph, type Shape } from '../game/Telegraph';
import type { Effects } from '../game/Effects';
import type { FloatingText } from '../game/Combat';
import type { MonsterBody, MonsterMaterials } from './monsters/materials';
import { buildGhoul } from './monsters/ghoul';
import { buildBrute } from './monsters/brute';
import { buildCultist } from './monsters/cultist';
import { buildCrawler } from './monsters/crawler';
import { buildHorror } from './monsters/horror';
import { buildWraith } from './monsters/wraith';
import { buildToad } from './monsters/toad';
import { buildCroc } from './monsters/croc';
import { buildRootHorror } from './monsters/rootHorror';
import { buildButcher } from './monsters/butcher';
import { buildBonePriest } from './monsters/bonePriest';
import { buildGaunt } from './monsters/gaunt';
import { buildLeech } from './monsters/leech';
import { buildHanged } from './monsters/hanged';
import { buildWeeper } from './monsters/weeper';
import { buildMaiden } from './monsters/maiden';
import { buildBellringer } from './monsters/bellringer';
import { buildCarrion } from './monsters/carrion';
import { buildPenitent } from './monsters/penitent';
import { buildMourner } from './monsters/mourner';
import { buildAbbess } from './bosses/abbess';
import { buildInquisitor } from './bosses/inquisitor';
import { buildAbomination } from './bosses/abomination';
import { buildLich } from './bosses/lich';
import { buildNightwing } from './bosses/nightwing';
import { mulberry32 } from '../procgen/noise';

// Monster behaviour: idle and wander near home, notice the player, chase
// along the nav grid (straight at them when there's a clear line), attack
// in range, flinch, die and leave a corpse. Casters keep their distance and
// throw blood bolts. Packs wake together.

export type MonsterKind = 'ghoul' | 'brute' | 'crawler' | 'cultist' | 'spider' | 'horror' | 'wraith' | 'abomination' | 'lich' | 'nightwing' | 'toad' | 'croc' | 'rootHorror' | 'mireWraith'
  // The Drowned Gaol beneath the mire.
  | 'butcher' | 'chainWraith' | 'gaunt' | 'bonePriest' | 'gaolCroc' | 'leech' | 'hanged' | 'weeper' | 'maiden' | 'inquisitor'
  // The Pilgrim Road and the Ossuary beneath it.
  | 'bellringer' | 'carrion' | 'penitent' | 'mourner' | 'abbess';

interface KindDef {
  name: string;
  hp: number;
  dmg: [number, number];
  armor: number;
  speed: number;
  radius: number;
  height: number;
  reach: number;
  cooldown: number;
  aggro: number;
  xp: number;
  blood: THREE.Color;
  /** Casters: preferred distance band. */
  ranged?: { min: number; max: number; boltSpeed: number };
  build: (m: MonsterMaterials, seed: number, elite: boolean, boss: boolean) => MonsterBody;
}

export const KINDS: Record<MonsterKind, KindDef> = {
  ghoul: {
    name: 'Ghoul',
    hp: 34,
    dmg: [3, 7],
    armor: 4,
    speed: 3.9,
    radius: 0.42,
    height: 1.5,
    reach: 1.25,
    cooldown: 0.8,
    aggro: 11,
    xp: 14,
    blood: new THREE.Color(0.14, 0.03, 0.01),
    build: (m, seed) => buildGhoul(m, mulberry32(seed)),
  },
  brute: {
    name: 'Flesh Brute',
    hp: 150,
    dmg: [11, 19],
    armor: 18,
    speed: 2.6,
    radius: 0.85,
    height: 2.6,
    reach: 2.1,
    cooldown: 1.6,
    aggro: 8,
    xp: 60,
    blood: new THREE.Color(0.22, 0.01, 0.008),
    build: (m, seed, elite) => buildBrute(m, mulberry32(seed), elite ? 1.75 : undefined),
  },
  crawler: {
    name: 'Blood Crawler',
    hp: 22,
    dmg: [2, 4],
    armor: 10,
    speed: 4.8,
    radius: 0.55,
    height: 0.8,
    reach: 1.15,
    cooldown: 1.0,
    aggro: 12,
    xp: 10,
    blood: new THREE.Color(0.12, 0.16, 0.04),
    build: (m, seed) => buildCrawler(m, mulberry32(seed)),
  },
  cultist: {
    name: 'Blood Priest',
    hp: 45,
    dmg: [7, 12],
    armor: 2,
    speed: 3.0,
    radius: 0.42,
    height: 1.8,
    reach: 13,
    cooldown: 1.6,
    aggro: 14,
    xp: 30,
    blood: new THREE.Color(0.22, 0.01, 0.008),
    ranged: { min: 5.5, max: 11, boltSpeed: 11 },
    build: (m, seed) => buildCultist(m, mulberry32(seed)),
  },
  spider: {
    name: 'Tomb Spider',
    hp: 110,
    dmg: [8, 14],
    armor: 22,
    speed: 4.0,
    radius: 1.0,
    height: 1.3,
    reach: 1.7,
    cooldown: 1.2,
    aggro: 12,
    xp: 55,
    blood: new THREE.Color(0.1, 0.14, 0.03),
    build: (m, seed, elite) => buildCrawler(m, mulberry32(seed), elite ? 2.5 : 1.9, true),
  },
  horror: {
    name: 'Flesh Horror',
    hp: 190,
    dmg: [12, 21],
    armor: 16,
    speed: 2.7,
    radius: 0.9,
    height: 2.4,
    reach: 2.0,
    cooldown: 1.4,
    aggro: 9,
    xp: 75,
    blood: new THREE.Color(0.24, 0.01, 0.008),
    build: (m, seed, elite) => buildHorror(m, mulberry32(seed), elite ? 1.7 : undefined),
  },
  wraith: {
    name: 'Wraith',
    hp: 70,
    dmg: [9, 15],
    armor: 6,
    speed: 3.3,
    radius: 0.5,
    height: 2.0,
    reach: 14,
    cooldown: 1.5,
    aggro: 14,
    xp: 45,
    blood: new THREE.Color(0.05, 0.06, 0.12),
    ranged: { min: 5, max: 11, boltSpeed: 12 },
    build: (m, seed, elite, boss) => buildWraith(m, mulberry32(seed), boss ? 2.2 : elite ? 1.45 : undefined),
  },
  // The Bleeding Mire.
  toad: {
    name: 'Bloated Mire Toad',
    hp: 58,
    dmg: [6, 11],
    armor: 8,
    speed: 3.4,
    radius: 0.7,
    height: 1.2,
    reach: 1.6,
    cooldown: 1.3,
    aggro: 11,
    xp: 28,
    blood: new THREE.Color(0.1, 0.12, 0.02),
    build: (m, seed, elite) => buildToad(m, mulberry32(seed), elite ? 1.55 : undefined),
  },
  croc: {
    name: 'Spined Mire-Croc',
    hp: 90,
    dmg: [9, 15],
    armor: 20,
    speed: 4.3,
    radius: 0.75,
    height: 0.9,
    reach: 1.8,
    cooldown: 1.1,
    aggro: 10,
    xp: 42,
    blood: new THREE.Color(0.2, 0.01, 0.008),
    build: (m, seed, elite) => buildCroc(m, mulberry32(seed), elite ? 1.5 : undefined),
  },
  rootHorror: {
    name: 'Root Horror',
    hp: 210,
    dmg: [13, 22],
    armor: 22,
    speed: 2.1,
    radius: 1.0,
    height: 2.7,
    reach: 2.8,
    cooldown: 1.8,
    aggro: 9,
    xp: 90,
    blood: new THREE.Color(0.09, 0.06, 0.03),
    build: (m, seed, elite) => buildRootHorror(m, mulberry32(seed), elite ? 1.45 : undefined),
  },
  mireWraith: {
    name: 'Mire Wraith',
    hp: 62,
    dmg: [6, 10],
    armor: 6,
    speed: 3.4,
    radius: 0.5,
    height: 2.0,
    reach: 14,
    cooldown: 1.9,
    aggro: 14,
    xp: 45,
    blood: new THREE.Color(0.2, 0.02, 0.01),
    ranged: { min: 5, max: 11, boltSpeed: 10 },
    build: (m, seed, elite) => buildWraith(m, mulberry32(seed), elite ? 1.45 : undefined, true),
  },
  // The Drowned Gaol.
  butcher: {
    name: 'Gaol Butcher',
    hp: 180,
    dmg: [13, 22],
    armor: 20,
    speed: 2.5,
    radius: 0.85,
    height: 2.7,
    reach: 2.2,
    cooldown: 1.7,
    aggro: 9,
    xp: 80,
    blood: new THREE.Color(0.22, 0.01, 0.008),
    build: (m, seed, elite) => buildButcher(m, mulberry32(seed), elite ? 1.35 : 1),
  },
  chainWraith: {
    name: 'Chained Wraith',
    hp: 80,
    dmg: [8, 14],
    armor: 8,
    speed: 3.2,
    radius: 0.5,
    height: 2.1,
    reach: 3.6,
    cooldown: 1.6,
    aggro: 13,
    xp: 50,
    blood: new THREE.Color(0.2, 0.02, 0.01),
    build: (m, seed, elite) => buildWraith(m, mulberry32(seed), elite ? 1.45 : undefined, 'chained'),
  },
  gaunt: {
    name: 'Gaunt',
    hp: 30,
    dmg: [4, 8],
    armor: 3,
    speed: 5.0,
    radius: 0.45,
    height: 0.9,
    reach: 1.2,
    cooldown: 0.8,
    aggro: 13,
    xp: 14,
    blood: new THREE.Color(0.16, 0.02, 0.01),
    build: (m, seed, elite) => buildGaunt(m, mulberry32(seed), elite ? 1.4 : 1),
  },
  bonePriest: {
    name: 'Ossuary Priest',
    hp: 60,
    dmg: [8, 13],
    armor: 6,
    speed: 2.9,
    radius: 0.45,
    height: 2.0,
    reach: 13,
    cooldown: 1.8,
    aggro: 14,
    xp: 40,
    blood: new THREE.Color(0.1, 0.08, 0.06),
    ranged: { min: 6, max: 12, boltSpeed: 10 },
    build: (m, seed, elite) => buildBonePriest(m, mulberry32(seed), elite ? 1.3 : 1),
  },
  gaolCroc: {
    name: 'Spiked Gaol-Croc',
    hp: 120,
    dmg: [11, 18],
    armor: 26,
    speed: 4.2,
    radius: 0.8,
    height: 1.0,
    reach: 1.9,
    cooldown: 1.2,
    aggro: 10,
    xp: 55,
    blood: new THREE.Color(0.22, 0.01, 0.008),
    build: (m, seed, elite) => buildCroc(m, mulberry32(seed), elite ? 1.6 : 1.15, true),
  },
  leech: {
    name: 'Blood Leech',
    hp: 50,
    dmg: [6, 10],
    armor: 10,
    speed: 3.0,
    radius: 0.55,
    height: 0.6,
    reach: 1.5,
    cooldown: 1.2,
    aggro: 10,
    xp: 30,
    blood: new THREE.Color(0.3, 0.01, 0.01),
    build: (m, seed, elite) => buildLeech(m, mulberry32(seed), elite ? 1.5 : 1),
  },
  hanged: {
    name: 'The Hanged',
    hp: 70,
    dmg: [9, 14],
    armor: 6,
    speed: 2.4,
    radius: 0.45,
    height: 2.0,
    reach: 1.4,
    cooldown: 1.5,
    aggro: 10,
    xp: 40,
    blood: new THREE.Color(0.12, 0.04, 0.03),
    build: (m, seed, elite) => buildHanged(m, mulberry32(seed), elite ? 1.3 : 1),
  },
  weeper: {
    name: 'Weeping Matron',
    hp: 90,
    dmg: [10, 16],
    armor: 8,
    speed: 2.8,
    radius: 0.5,
    height: 2.5,
    reach: 4.6,
    cooldown: 2.4,
    aggro: 12,
    xp: 55,
    blood: new THREE.Color(0.14, 0.02, 0.02),
    build: (m, seed, elite) => buildWeeper(m, mulberry32(seed), elite ? 1.3 : 1),
  },
  maiden: {
    name: 'Iron Maiden',
    hp: 160,
    dmg: [14, 22],
    armor: 34,
    speed: 2.2,
    radius: 0.6,
    height: 2.1,
    reach: 1.6,
    cooldown: 1.9,
    aggro: 8,
    xp: 70,
    blood: new THREE.Color(0.22, 0.01, 0.008),
    build: (m, seed, elite) => buildMaiden(m, mulberry32(seed), elite ? 1.3 : 1),
  },
  // The Pilgrim Road and the Ossuary.
  bellringer: {
    name: 'Bellringer Ghoul',
    hp: 40,
    dmg: [5, 9],
    armor: 6,
    speed: 3.7,
    radius: 0.45,
    height: 1.8,
    reach: 1.7,
    cooldown: 0.9,
    aggro: 12,
    xp: 18,
    blood: new THREE.Color(0.12, 0.05, 0.02),
    build: (m, seed, elite) => buildBellringer(m, mulberry32(seed), elite ? 1.3 : 1),
  },
  carrion: {
    name: 'Carrion Crawler',
    hp: 125,
    dmg: [9, 15],
    armor: 22,
    speed: 4.4,
    radius: 1.0,
    height: 1.4,
    reach: 1.8,
    cooldown: 1.2,
    aggro: 12,
    xp: 60,
    blood: new THREE.Color(0.22, 0.02, 0.01),
    build: (m, seed, elite) => buildCarrion(m, mulberry32(seed), elite ? 1.35 : 1),
  },
  penitent: {
    name: 'Penitent Elder',
    hp: 58,
    dmg: [8, 13],
    armor: 5,
    speed: 2.8,
    radius: 0.45,
    height: 1.9,
    reach: 13,
    cooldown: 1.8,
    aggro: 14,
    xp: 42,
    blood: new THREE.Color(0.22, 0.01, 0.008),
    ranged: { min: 6, max: 12, boltSpeed: 10 },
    build: (m, seed, elite) => buildPenitent(m, mulberry32(seed), elite ? 1.25 : 1),
  },
  mourner: {
    name: 'Kneeling Mourner',
    hp: 28,
    dmg: [4, 8],
    armor: 4,
    speed: 3.3,
    radius: 0.42,
    height: 1.7,
    reach: 1.3,
    cooldown: 1.0,
    aggro: 14,
    xp: 10,
    blood: new THREE.Color(0.06, 0.05, 0.08),
    build: (m, seed, elite) => buildMourner(m, mulberry32(seed), elite ? 1.25 : 1),
  },
  // Vault bosses (see Boss.ts). Radius and height here are before the boss multipliers.
  abomination: {
    name: 'Gorrath',
    hp: 100,
    dmg: [6, 10],
    armor: 14,
    speed: 2.9,
    radius: 0.8,
    height: 1.9,
    reach: 2.4,
    cooldown: 1.5,
    aggro: 14,
    xp: 420,
    blood: new THREE.Color(0.24, 0.01, 0.008),
    build: (m, seed) => buildAbomination(m, mulberry32(seed)),
  },
  lich: {
    name: 'The Hollow King',
    hp: 88,
    dmg: [6, 10],
    armor: 18,
    speed: 3.2,
    radius: 0.6,
    height: 1.8,
    reach: 2.5,
    cooldown: 1.4,
    aggro: 14,
    xp: 420,
    blood: new THREE.Color(0.08, 0.04, 0.14),
    build: (m, seed) => buildLich(m, mulberry32(seed)),
  },
  nightwing: {
    name: "Vhal'zereth",
    hp: 82,
    dmg: [6, 10],
    armor: 10,
    speed: 3.8,
    radius: 0.65,
    height: 1.7,
    reach: 2.2,
    cooldown: 1.2,
    aggro: 14,
    xp: 420,
    blood: new THREE.Color(0.2, 0.01, 0.01),
    build: (m, seed) => buildNightwing(m, mulberry32(seed)),
  },
  inquisitor: {
    name: 'The Grand Inquisitor',
    hp: 100,
    dmg: [6, 10],
    armor: 16,
    speed: 3.0,
    radius: 0.6,
    height: 2.0,
    reach: 2.6,
    cooldown: 1.5,
    aggro: 14,
    xp: 480,
    blood: new THREE.Color(0.1, 0.08, 0.06),
    build: (m, seed) => buildInquisitor(m, mulberry32(seed)),
  },
  abbess: {
    name: 'The Silent Abbess',
    hp: 104,
    dmg: [6, 10],
    armor: 16,
    speed: 3.0,
    radius: 0.6,
    height: 2.0,
    reach: 2.6,
    cooldown: 1.5,
    aggro: 14,
    xp: 600,
    blood: new THREE.Color(0.05, 0.05, 0.09),
    build: (m, seed) => buildAbbess(m, mulberry32(seed)),
  },
};

/** A monster's heavy, telegraphed attack (see Monster.signature). */
interface SignatureDef {
  name: string;
  /** Telegraph shape; `size` grows for champions. */
  shape: (size: number) => Shape;
  /** Mark it on the hero's feet, or ahead of the monster (by `ahead` metres). */
  at: 'self' | 'target';
  ahead: number;
  /** Seconds the mark fills before the blow lands. */
  windup: number;
  /** Seconds before landing that the attack animation starts (its own wind-up). */
  swingLead: number;
  /** Seconds it stands spent after the blow. */
  recover: number;
  cooldown: number;
  /** Distance to the hero it is used from. */
  range: [number, number];
  /** Share of the standard signature blow (Balance.signatureMult). */
  factor: number;
  /** Metres the hero is thrown back when caught. */
  knock: number;
  /** Metres the body travels as it lands (a lunge). */
  lunge?: number;
  color: number;
  look: 'slam' | 'chop' | 'lunge' | 'wail' | 'roots' | 'mire' | 'chain' | 'hallow';
}

export const SIGNATURES: Partial<Record<MonsterKind, SignatureDef>> = {
  brute: { name: 'Overhead Slam', shape: (k) => ({ kind: 'circle', r: 2.4 * k }), at: 'self', ahead: 1.9, windup: 1.25, swingLead: 0.7, recover: 0.7, cooldown: 9, range: [0, 4.5], factor: 1, knock: 2.2, color: 0xff4a1a, look: 'slam' },
  butcher: { name: 'Cleaver Chop', shape: (k) => ({ kind: 'rect', len: 5 * k, w: 1.7 * k }), at: 'self', ahead: 0.4, windup: 1.3, swingLead: 1.1, recover: 0.6, cooldown: 8, range: [0, 5], factor: 1.05, knock: 1.8, color: 0xff3010, look: 'chop' },
  maiden: { name: 'Iron Embrace', shape: (k) => ({ kind: 'circle', r: 3.2 * k }), at: 'self', ahead: 0.6, windup: 1.45, swingLead: 0.6, recover: 0.8, cooldown: 10, range: [0, 3.8], factor: 1.1, knock: 2.6, color: 0xff5a20, look: 'slam' },
  croc: { name: 'Death Lunge', shape: (k) => ({ kind: 'rect', len: 6 * k, w: 1.5 * k }), at: 'self', ahead: 0, windup: 0.95, swingLead: 0.4, recover: 0.5, cooldown: 7, range: [2.5, 6], factor: 0.85, knock: 1.2, lunge: 4.5, color: 0xff6a20, look: 'lunge' },
  gaolCroc: { name: 'Death Lunge', shape: (k) => ({ kind: 'rect', len: 6.5 * k, w: 1.6 * k }), at: 'self', ahead: 0, windup: 0.95, swingLead: 0.4, recover: 0.5, cooldown: 7, range: [2.5, 6.5], factor: 0.9, knock: 1.4, lunge: 5, color: 0xff6a20, look: 'lunge' },
  weeper: { name: 'Keening Wail', shape: (k) => ({ kind: 'cone', r: 7 * k, half: 0.55 }), at: 'self', ahead: 0, windup: 1.35, swingLead: 0.9, recover: 0.6, cooldown: 9, range: [0, 6.5], factor: 0.9, knock: 1.5, color: 0x7f8cff, look: 'wail' },
  rootHorror: { name: 'Grasping Roots', shape: (k) => ({ kind: 'circle', r: 2.3 * k }), at: 'target', ahead: 0, windup: 1.4, swingLead: 0.6, recover: 0.6, cooldown: 8, range: [0, 10], factor: 1, knock: 1, color: 0x9ac02a, look: 'roots' },
  bellringer: { name: 'Chain Lash', shape: (k) => ({ kind: 'rect', len: 3.8 * k, w: 1.2 * k }), at: 'self', ahead: 0.2, windup: 1.1, swingLead: 0.75, recover: 0.6, cooldown: 8, range: [0, 3.6], factor: 1.1, knock: 1.4, color: 0xff4a1a, look: 'chain' },
  carrion: { name: 'Pounce', shape: (k) => ({ kind: 'rect', len: 6.5 * k, w: 2.0 * k }), at: 'self', ahead: 0, windup: 1.0, swingLead: 0.5, recover: 0.6, cooldown: 7, range: [2.5, 6.5], factor: 0.95, knock: 1.8, lunge: 5, color: 0xff6a20, look: 'lunge' },
  penitent: { name: 'Hallowed Fire', shape: (k) => ({ kind: 'circle', r: 2.2 * k }), at: 'target', ahead: 0, windup: 1.6, swingLead: 1.6, recover: 0.6, cooldown: 9, range: [2, 12], factor: 1.05, knock: 0.6, color: 0xffb030, look: 'hallow' },
  mireWraith: { name: 'Drowning Mire', shape: (k) => ({ kind: 'circle', r: 2.4 * k }), at: 'target', ahead: 0, windup: 1.5, swingLead: 0.7, recover: 0.5, cooldown: 9, range: [3, 13], factor: 0.8, knock: 0, color: 0x5cd04a, look: 'mire' },
};

export interface MonsterSpawn {
  kind: MonsterKind;
  pos: THREE.Vector3;
  level: number;
  pack: number;
  /** Named champion: tougher, bigger, better loot. */
  elite?: string;
  wander?: number;
  /** Dungeon boss: far tougher than an ordinary champion, and bigger. */
  boss?: boolean;
  /** Free-form marker scripted encounters use to find their monsters. */
  tag?: string;
  /** Will not wake until a script rouses it (sealed behind a door). */
  dormant?: boolean;
  /** Lies hidden under deep water and surfaces when the hero comes near (see SurfacingLeech). */
  submerged?: boolean;
}

/** What a monster sees of the world each frame. */
export interface MonsterContext {
  player: Combatant;
  nav: NavGrid;
  height: HeightFn;
  monsters: Monster[];
  effects: Effects;
  floaters: FloatingText;
  onKilled: (m: Monster) => void;
  onPlayerHit: (amount: number, crit: boolean, from: THREE.Vector3) => void;
  /** Big centred title (boss entrances). */
  banner?(title: string, sub: string): void;
}

type State = 'idle' | 'chase' | 'attack' | 'return' | 'dead';

let nextId = 1;

export class Monster implements Combatant {
  readonly id = nextId++;
  readonly def: KindDef;
  readonly body: MonsterBody;
  readonly position = new THREE.Vector3();
  readonly radius: number;
  readonly height: number;
  readonly name: string;
  level: number;
  readonly elite: boolean;
  /** Invisible pick volume for the mouse. */
  readonly hit: THREE.Mesh;
  hp = 0;
  maxHp = 0;
  state: State = 'idle';
  protected yaw = Math.random() * Math.PI * 2;
  protected speed = 0;
  protected path: THREE.Vector2[] = [];
  protected repath = 0;
  protected cooldown = 0;
  protected idleTimer = 1 + Math.random() * 4;
  protected dmg: [number, number] = [0, 0];
  protected armor = 0;
  protected flinchCd = 0;
  /** Seconds since death; corpses sink and are removed later. */
  deadFor = 0;
  removed = false;
  awake = false;
  /** Kept out of sight by a script (a boss that vanished or flew off). */
  hidden = false;

  constructor(
    readonly spawn: MonsterSpawn,
    protected mats: MonsterMaterials,
    protected scene: THREE.Scene,
  ) {
    this.def = KINDS[spawn.kind];
    this.elite = !!spawn.elite;
    this.level = spawn.level;
    this.body = this.def.build(mats, Math.floor(Math.random() * 1e6), this.elite, !!spawn.boss);
    this.relevel(Math.max(spawn.level, levelFloor()));
    this.radius = this.def.radius * (spawn.boss ? 1.9 : this.elite ? 1.2 : 1);
    this.height = this.def.height * (spawn.boss ? 2 : this.elite ? 1.2 : 1);
    this.name = spawn.elite ?? this.def.name;
    this.position.copy(spawn.pos);
    this.dormant = !!spawn.dormant;
    this.hit = new THREE.Mesh(
      new THREE.CylinderGeometry(this.radius * 1.1, this.radius * 1.1, this.height, 8).translate(0, this.height / 2, 0),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hit.userData.monster = this;
    this.body.rig.root.add(this.hit);
    scene.add(this.body.rig.root);
    this.sync();
    const weight = { ghoul: 0.7, brute: 2.2, crawler: 0.5, cultist: 0.8, spider: 1.2, horror: 2, wraith: 0, abomination: 3, lich: 1.6, nightwing: 1.2, toad: 1.1, croc: 0.9, rootHorror: 2.4, mireWraith: 0, butcher: 2.3, chainWraith: 0, gaunt: 0.5, bonePriest: 0.6, gaolCroc: 1, leech: 0, hanged: 0, weeper: 0.5, maiden: 2.6, inquisitor: 1.4, bellringer: 0.7, carrion: 1.4, penitent: 0.7, mourner: 0.5, abbess: 0 }[this.kind] * (this.elite ? 1.3 : 1);
    if (weight > 0) this.body.rig.onStep = () => audio.step(this.position, weight);
  }

  get alive() {
    return this.state !== 'dead';
  }

  /** Called when this monster is struck; returns the damage dealt after armour. */
  takeDamage(amount: number, crit: boolean, from: THREE.Vector3): number {
    if (!this.alive) return 0;
    const dealt = mitigate(amount, this.armor);
    this.hp -= dealt;
    this.awake = true;
    if (this.state === 'idle' || this.state === 'return') this.state = 'chase';
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'dead';
      this.speed = 0;
      this.body.rig.cancelAction();
      this.body.die();
      audio.voice(this.kind, 'die', this.position, this.voiceSize);
      this.hit.visible = false;
      this.hit.userData.monster = null;
    } else if (this.flinchCd <= 0 && (crit || dealt > this.maxHp * 0.12)) {
      this.flinchCd = 1.2;
      this.body.flinch();
      audio.voice(this.kind, 'hurt', this.position, this.voiceSize);
    }
    void from;
    return dealt;
  }

  /** Sets its level and the stats that follow from it (curves in game/Balance.ts), keeping its share of life. */
  relevel(level: number) {
    const frac = this.maxHp ? this.hp / this.maxHp : 1;
    this.level = level;
    const boss = !!this.spawn.boss;
    const eliteMul = boss ? 7 : this.elite ? 3.2 : 1;
    this.maxHp = Math.round(this.def.hp * monsterLifeScale(level) * eliteMul);
    this.hp = Math.max(1, Math.round(this.maxHp * frac));
    const dm = monsterDamageScale(level) * (boss ? 1.7 : this.elite ? 1.5 : 1);
    this.dmg = [this.def.dmg[0] * dm, this.def.dmg[1] * dm];
    this.armor = this.def.armor * monsterArmorScale(level);
  }

  update(dt: number, ctx: MonsterContext) {
    const rig = this.body.rig;
    // Catch up with an out-levelling hero, but never mid-fight.
    if (!this.awake && this.state !== 'dead' && levelFloor() > this.level) this.relevel(levelFloor());
    ctx.effects.spell.frostTint(this, this.state === 'dead' ? 0 : this.chilled > 0 ? (this.stunned > 0 ? 2 : 1) : 0, dt);
    if (this.sig && (this.state === 'dead' || this.stunned > 0)) this.cancelSignature();
    if (this.state === 'dead') {
      this.deadFor += dt;
      if (rig.acting) rig.update(dt, 0);
      // After a while the corpse sinks into the ground and is cleared away.
      if (this.deadFor > 14) {
        rig.root.position.y = ctx.height(this.position.x, this.position.z) - (this.deadFor - 14) * 0.3;
        if (this.deadFor > 17) this.remove();
      }
      return;
    }
    if (this.chilled > 0) this.chilled -= dt;
    if (this.stunned > 0) {
      // Dazed: stands swaying, does nothing.
      this.stunned -= dt;
      // Frozen solid holds still; merely dazed sways.
      if (this.chilled <= 0) rig.update(dt, 0);
      this.position.y = ctx.height(this.position.x, this.position.z);
      this.sync();
      rig.root.rotation.z = Math.sin(this.stunned * 9) * 0.06;
      if (this.stunned <= 0) rig.root.rotation.z = 0;
      return;
    }
    this.cooldown -= dt;
    this.flinchCd -= dt;
    this.repath -= dt;
    const p = ctx.player;
    const toPlayer = new THREE.Vector2(p.position.x - this.position.x, p.position.z - this.position.z);
    const dist = toPlayer.length();

    // Wake on sight; wake the pack too.
    if (this.state === 'idle' && p.alive && dist < this.def.aggro * (this.elite ? 1.2 : 1)) this.wake(ctx);
    if ((this.state === 'chase' || this.state === 'attack') && (!p.alive || dist > 32)) {
      this.state = 'return';
      this.path = [];
    }
    if (this.signature(dt, ctx, dist)) return;

    let want = new THREE.Vector2();
    let faceTarget = false;
    if (this.state === 'chase' || this.state === 'attack') {
      faceTarget = true;
      const reach = this.def.reach + p.radius + (this.def.ranged ? 0 : this.radius * 0.5);
      const ranged = this.def.ranged;
      const inRange = ranged ? dist <= ranged.max && dist >= ranged.min * 0.6 && ctx.nav.lineOfSight(this.position.x, this.position.z, p.position.x, p.position.z) : dist <= reach;
      if (rig.acting && this.state === 'attack') {
        // Committed to the swing.
      } else if (inRange) {
        this.state = 'attack';
        this.path = [];
        if (this.cooldown <= 0 && this.facing(toPlayer) < 0.5) this.startAttack(ctx);
      } else {
        this.state = 'chase';
        if (ranged && dist < ranged.min * 0.6) {
          // Too close for comfort: back off.
          want = toPlayer.clone().normalize().multiplyScalar(-this.def.speed * 0.7);
        } else {
          want = this.steer(p.position, ctx);
        }
      }
    } else if (this.state === 'return') {
      const home = this.spawn.pos;
      if (Math.hypot(home.x - this.position.x, home.z - this.position.z) < 1) {
        this.state = 'idle';
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
      } else want = this.steer(home, ctx, 0.7);
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.1 * dt);
    } else {
      // Idle: shuffle about near home.
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleTimer = 3 + Math.random() * 6;
        const r = this.spawn.wander ?? 4;
        const a = Math.random() * Math.PI * 2;
        const goal = new THREE.Vector2(this.spawn.pos.x + Math.cos(a) * r * Math.random(), this.spawn.pos.z + Math.sin(a) * r * Math.random());
        if (r > 0) this.path = ctx.nav.findPath(new THREE.Vector2(this.position.x, this.position.z), goal) ?? [];
      }
      want = this.follow(0.35);
    }
    if (rig.acting && this.state === 'attack') want.set(0, 0);

    // Keep apart from the pack and out of the player.
    for (const o of ctx.monsters) {
      if (o === this || !o.alive) continue;
      const dx = this.position.x - o.position.x;
      const dz = this.position.z - o.position.z;
      const d = Math.hypot(dx, dz);
      const min = this.radius + o.radius;
      if (d > 0.001 && d < min) want.add(new THREE.Vector2(dx / d, dz / d).multiplyScalar((min - d) * 6));
    }
    if (dist < this.radius + p.radius && dist > 0.001) want.add(toPlayer.clone().multiplyScalar(-(this.radius + p.radius - dist) * 8 / dist));

    // Integrate with a little inertia.
    const targetSpeed = Math.min(want.length(), this.def.speed * 1.2) * (this.chilled > 0 ? 0.35 : 1);
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-dt * 8));
    if (want.lengthSq() > 0.01) {
      const step = want.clone().normalize().multiplyScalar(this.speed * dt);
      const nx = this.position.x + step.x;
      const nz = this.position.z + step.y;
      if (ctx.nav.walkable(nx, nz)) {
        this.position.x = nx;
        this.position.z = nz;
      } else if (ctx.nav.walkable(nx, this.position.z)) this.position.x = nx;
      else if (ctx.nav.walkable(this.position.x, nz)) this.position.z = nz;
      if (!faceTarget || this.speed > 0.5) this.turn(Math.atan2(want.x, want.y), dt, 9);
    }
    if (faceTarget && (this.state === 'attack' || this.speed < 0.5)) this.turn(Math.atan2(toPlayer.x, toPlayer.y), dt, rig.acting ? 3 : 10);
    this.position.y = ctx.height(this.position.x, this.position.z);
    rig.update(dt, this.speed);
    this.sync();
  }

  /** Seconds left dazed by a hero's skill. */
  stunned = 0;
  /** Seconds left slowed by frost. */
  chilled = 0;

  /** Slows it to a crawl for `secs` (frost spells). */
  chill(secs: number) {
    if (!this.alive || this.dormant) return;
    this.chilled = Math.max(this.chilled, secs);
    this.awake = true;
  }

  /** Dazes it for `secs` (and wakes it: being stunned is a fight). Returns whether it took. */
  stun(secs: number): boolean {
    if (!this.alive || this.dormant) return false;
    this.stunned = Math.max(this.stunned, secs);
    this.body.rig.cancelAction();
    this.awake = true;
    if (this.state === 'idle' || this.state === 'return') this.state = 'chase';
    return true;
  }

  /** Sleeping behind a seal until a script rouses it. */
  dormant = false;

  /** Lifts the seal: from now on it hunts like any other monster. */
  rouse() {
    this.dormant = false;
  }

  protected wake(ctx: MonsterContext) {
    if (this.dormant) return;
    this.state = 'chase';
    this.awake = true;
    audio.voice(this.kind, 'aggro', this.position, this.voiceSize);
    for (const o of ctx.monsters) {
      if (o.alive && !o.dormant && o.spawn.pack === this.spawn.pack && o.state === 'idle') {
        o.state = 'chase';
        o.awake = true;
      }
    }
  }

  /** How far (radians) we are from facing along `dir`. */
  protected facing(dir: THREE.Vector2) {
    let d = Math.atan2(dir.x, dir.y) - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.abs(d);
  }

  protected steer(goal: THREE.Vector3, ctx: MonsterContext, speedMul = 1): THREE.Vector2 {
    const here = new THREE.Vector2(this.position.x, this.position.z);
    if (ctx.nav.lineOfSight(here.x, here.y, goal.x, goal.z)) {
      this.path = [];
      return new THREE.Vector2(goal.x - here.x, goal.z - here.y).normalize().multiplyScalar(this.def.speed * speedMul);
    }
    if (this.repath <= 0 || this.path.length === 0) {
      this.repath = 0.6 + Math.random() * 0.3;
      this.path = ctx.nav.findPath(here, new THREE.Vector2(goal.x, goal.z)) ?? [];
    }
    return this.follow(speedMul);
  }

  protected follow(speedMul: number): THREE.Vector2 {
    while (this.path.length) {
      const n = this.path[0];
      const d = Math.hypot(n.x - this.position.x, n.y - this.position.z);
      if (d < 0.4) {
        this.path.shift();
        continue;
      }
      return new THREE.Vector2(n.x - this.position.x, n.y - this.position.z).multiplyScalar((this.def.speed * speedMul) / d);
    }
    return new THREE.Vector2();
  }

  protected startAttack(ctx: MonsterContext) {
    this.cooldown = this.def.cooldown + 0.6 + Math.random() * 0.4;
    const ranged = this.def.ranged;
    if (!ranged) audio.voice(this.kind, 'attack', this.position, this.voiceSize);
    this.body.attack(() => {
      if (!this.alive) return;
      const p = ctx.player;
      if (ranged) {
        const from = this.body.muzzle ? this.body.muzzle().clone() : this.position.clone().setY(this.position.y + 1.4);
        const aim = p.position.clone().setY(p.position.y + 1.0);
        const dir = aim.sub(from).normalize();
        // The mire wraith throws a fan of three; one in the face is the usual cost.
        const fan = this.kind === 'mireWraith' ? [-0.28, 0, 0.28] : [0];
        for (const a of fan) {
          ctx.effects.bolt(
            from,
            dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a),
            (pos) => p.alive && Math.hypot(pos.x - p.position.x, pos.z - p.position.z) < p.radius + 0.25 && pos.y < p.position.y + 2,
            () => {
              audio.boltHit(p.position);
              const roll = rollDamage(this.dmg[0], this.dmg[1], 0.05);
              ctx.onPlayerHit(roll.amount, roll.crit, this.position);
            },
            ranged.boltSpeed,
            this.kind === 'penitent' ? 'gold' : 'blood',
          );
        }
        ctx.effects.flash(from, this.kind === 'penitent' ? 0xffa030 : 0xff2010, 30, 6, 0.3);
        audio.cast(from);
        if (this.kind === 'bonePriest') this.mendAlly(ctx);
        return;
      }
      const d = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
      if (this.kind === 'brute' || this.kind === 'butcher' || this.kind === 'maiden') {
        const at = this.position.clone().add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(1.6 * (this.elite ? 1.2 : 1)));
        ctx.effects.shockwave(at, this.elite ? 4.5 : 3.5);
        audio.slam(at, this.elite ? 1.3 : 1);
        ctx.effects.sparks(at.clone().setY(at.y + 0.2), 14, new THREE.Color(1.4, 0.6, 0.3), 3, 0.5);
      }
      if (this.kind === 'rootHorror') {
        // Roots burst up under the target (or where it stood, if it got away).
        const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const at = d <= this.def.reach + 1.5 ? p.position.clone() : this.position.clone().addScaledVector(fwd, this.def.reach);
        ctx.effects.rootSpikes(at, this.elite ? 2.3 : 1.6);
        audio.slam(at, this.elite ? 1.2 : 0.9);
        const hit = Math.hypot(p.position.x - at.x, p.position.z - at.z) <= (this.elite ? 2.3 : 1.6) + p.radius;
        if (p.alive && hit) {
          const roll = rollDamage(this.dmg[0], this.dmg[1], 0.06);
          ctx.onPlayerHit(roll.amount, roll.crit, this.position);
        }
        return;
      }
      if (this.kind === 'chainWraith') {
        // The chains lash out in a wide arc.
        ctx.effects.slash(this.position.clone().setY(this.position.y + 1.1), this.yaw, this.def.reach * (this.elite ? 1.2 : 1), new THREE.Color(0.9, 0.12, 0.06));
        ctx.effects.sparks(this.position.clone().setY(this.position.y + 1.1), 10, new THREE.Color(1.2, 0.4, 0.2), 3, 0.4);
      }
      if (this.kind === 'weeper') {
        // A wail in a cone before her: everything in it is struck.
        const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const reach = this.def.reach * (this.elite ? 1.2 : 1) + 0.8;
        ctx.effects.slash(this.position.clone().setY(this.position.y + 0.6), this.yaw, reach, new THREE.Color(0.55, 0.6, 0.75));
        ctx.effects.shockwave(this.position.clone().addScaledVector(fwd, 1.2), reach * 0.8, new THREE.Color(0.4, 0.42, 0.55));
        const toP = new THREE.Vector3(p.position.x - this.position.x, 0, p.position.z - this.position.z);
        if (p.alive && d <= reach + p.radius && toP.normalize().dot(fwd) > Math.cos(0.65)) {
          const roll = rollDamage(this.dmg[0], this.dmg[1], 0.05);
          ctx.onPlayerHit(roll.amount, roll.crit, this.position);
        }
        return;
      }
      if (this.kind === 'leech' && p.alive && d <= this.def.reach + p.radius + this.radius * 0.5 + 0.6) {
        // It drinks what it draws.
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.12);
        ctx.effects.blood(p.position.clone().setY(p.position.y + 1), this.position.clone().setY(this.position.y + 0.3), 12, this.def.blood, 0.7);
      }
      if (this.kind === 'toad') {
        // The landing splashes blood and mire.
        const at = this.position.clone().add(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(1.1 * this.radius / 0.7));
        ctx.effects.shockwave(at, 1.8, new THREE.Color(0.35, 0.05, 0.03));
        audio.splash(at);
      }
      if (p.alive && d <= this.def.reach + p.radius + this.radius * 0.5 + 0.6) {
        const roll = rollDamage(this.dmg[0], this.dmg[1], 0.06);
        ctx.onPlayerHit(roll.amount, roll.crit, this.position);
      }
    });
  }

  /** Ossuary priests knit the worst-hurt ally nearby back together. */
  protected mendAlly(ctx: MonsterContext) {
    let best: Monster | null = null;
    for (const o of ctx.monsters) {
      if (o === this || !o.alive || o.spawn.boss || o.hp > o.maxHp * 0.8) continue;
      if (Math.hypot(o.position.x - this.position.x, o.position.z - this.position.z) > 9) continue;
      if (!best || o.hp / o.maxHp < best.hp / best.maxHp) best = o;
    }
    if (!best) return;
    best.hp = Math.min(best.maxHp, best.hp + best.maxHp * 0.2);
    const at = best.position.clone().setY(best.position.y + best.height * 0.6);
    ctx.effects.sparks(at, 18, new THREE.Color(1.6, 0.25, 0.1), 2, 0.7);
    ctx.effects.flash(at, 0xff3020, 14, 4, 0.3);
  }

  // ---- Signature attacks ---------------------------------------------------
  // A few kinds have one heavy blow they wind up behind a telegraph on the
  // floor (the same one bosses paint). It lands for a third or so of a
  // same-level hero's life, but only on whoever still stands in the mark when
  // the wind-up runs out. Champions use theirs more often, and wider.

  /** The signature attack being wound up or played out. */
  protected sig: { def: SignatureDef; tele: Telegraph; t: number; swung: boolean; landed: boolean; at: THREE.Vector3; yaw: number; after: number } | null = null;
  /** Seconds until this monster may use its signature again (null: not yet in a fight). */
  protected sigCd: number | null = null;

  protected cancelSignature() {
    this.sig?.tele.cancel();
    this.sig = null;
  }

  /** Starts, runs and resolves the signature attack; true while it owns the frame. */
  protected signature(dt: number, ctx: MonsterContext, dist: number): boolean {
    const def = SIGNATURES[this.kind];
    if (!def || this.spawn.boss) return false;
    const p = ctx.player;
    const rig = this.body.rig;
    if (!this.sig) {
      if (this.state !== 'chase' && this.state !== 'attack') {
        if (this.state === 'idle') this.sigCd = null;
        return false;
      }
      // The first one comes a little after the fight starts, not on sight.
      this.sigCd ??= def.cooldown * (this.elite ? 0.3 : 0.5) * (0.6 + Math.random() * 0.6);
      this.sigCd -= dt;
      if (this.sigCd > 0 || rig.acting || !p.alive || dist < def.range[0] || dist > def.range[1]) return false;
      if (!ctx.nav.lineOfSight(this.position.x, this.position.z, p.position.x, p.position.z)) return false;
      this.sigCd = def.cooldown * (this.elite ? 0.55 : 1) * (0.85 + Math.random() * 0.3);
      const yaw = Math.atan2(p.position.x - this.position.x, p.position.z - this.position.z);
      const size = this.elite ? 1.2 : 1;
      const at = def.at === 'target' ? p.position.clone() : this.position.clone().add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(def.ahead * size));
      at.y = ctx.height(at.x, at.z) + 0.06;
      const tele = new Telegraph(ctx.effects, def.shape(size), at, yaw, def.windup, def.color);
      this.sig = { def, tele, t: 0, swung: false, landed: false, at, yaw, after: 0 };
      this.yaw = yaw;
      this.speed = 0;
      this.path = [];
      this.state = 'attack';
      rig.cancelAction();
      audio.voice(this.kind, 'aggro', this.position, this.voiceSize * 1.1);
    }
    const s = this.sig;
    s.t += dt;
    // Hold still through the wind-up; swing so the blow falls as the mark fills.
    if (!s.swung && s.t >= Math.max(0, s.def.windup - s.def.swingLead)) {
      s.swung = true;
      // Casters with a long invocation raise it for the whole wind-up.
      const invoke = (this.body as { invoke?: (dur: number) => void }).invoke;
      if (invoke) invoke.call(this.body, s.def.swingLead + 0.3);
      else this.body.attack(() => undefined);
      if (s.def.look === 'hallow') audio.charge(s.at, s.def.swingLead, 'soul');
    }
    if (!s.landed && s.t >= s.def.windup) {
      s.landed = true;
      s.tele.fire();
      this.landSignature(ctx);
    }
    if (s.landed) {
      // A lunge carries the body down the lane it marked.
      if (s.def.lunge && s.after < 0.22) {
        const step = Math.min(dt, 0.22 - s.after) * (s.def.lunge / 0.22);
        const nx = this.position.x + Math.sin(s.yaw) * step;
        const nz = this.position.z + Math.cos(s.yaw) * step;
        if (ctx.nav.walkable(nx, nz)) {
          this.position.x = nx;
          this.position.z = nz;
        }
      }
      s.after += dt;
      if (s.after >= s.def.recover) {
        this.sig = null;
        this.cooldown = Math.max(this.cooldown, 0.4);
      }
    }
    this.yaw = s.yaw;
    this.position.y = ctx.height(this.position.x, this.position.z);
    rig.update(dt, 0);
    this.sync();
    return true;
  }

  private landSignature(ctx: MonsterContext) {
    const s = this.sig!;
    const p = ctx.player;
    const fx = ctx.effects;
    const size = this.elite ? 1.2 : 1;
    const shape = s.def.shape(size);
    const at = s.at;
    const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const ext = shape.kind === 'circle' ? shape.r : shape.kind === 'cone' ? shape.r : shape.kind === 'rect' ? shape.len : shape.r1;
    switch (s.def.look) {
      case 'slam':
        fx.shockwave(at, ext * 1.15);
        fx.shockwave(at, ext * 0.6, new THREE.Color(1.2, 0.5, 0.25));
        fx.sparks(at.clone().setY(at.y + 0.3), 26, new THREE.Color(1.4, 0.6, 0.3), 4.5, 0.7);
        fx.blood(at.clone().setY(at.y + 0.2), this.position, 14, new THREE.Color(0.2, 0.12, 0.08), 1.2);
        fx.flash(at.clone().setY(at.y + 0.5), 0xff7030, 26, ext * 2.5, 0.3);
        audio.slam(at, 1.4 * size);
        fx.addShake(0.45);
        break;
      case 'chop':
        for (let i = 1; i <= 3; i++) {
          const q = at.clone().addScaledVector(fwd, (ext * i) / 3.5);
          fx.shockwave(q, 1.3, new THREE.Color(0.9, 0.3, 0.15));
          fx.sparks(q.clone().setY(q.y + 0.2), 10, new THREE.Color(1.4, 0.5, 0.25), 3.5, 0.5);
        }
        fx.splat(at.x + fwd.x * ext * 0.5, at.z + fwd.z * ext * 0.5, 1.6);
        audio.slam(at, 1.3 * size);
        fx.addShake(0.4);
        break;
      case 'lunge': {
        const end = at.clone().addScaledVector(fwd, s.def.lunge ?? 4);
        fx.shockwave(end, 1.6, new THREE.Color(0.3, 0.12, 0.06));
        fx.blood(end.clone().setY(end.y + 0.4), this.position, 16, this.def.blood, 1.1);
        audio.splash(end);
        audio.slam(end, 0.8);
        fx.addShake(0.25);
        break;
      }
      case 'wail':
        for (let i = 1; i <= 3; i++) fx.shockwave(this.position.clone().addScaledVector(fwd, (ext * i) / 3.3), ext * 0.15 * i, new THREE.Color(0.45, 0.5, 0.75));
        fx.slash(this.position.clone().setY(this.position.y + 0.8), s.yaw, ext, new THREE.Color(0.6, 0.7, 1.1));
        fx.flash(this.position.clone().setY(this.position.y + 1.5), 0x8090ff, 18, ext, 0.4);
        audio.voice(this.kind, 'attack', this.position, this.voiceSize * 1.3);
        fx.addShake(0.2);
        break;
      case 'roots':
        fx.rootSpikes(at, ext, 16);
        fx.rootSpikes(at, ext * 0.55, 7);
        fx.shockwave(at, ext * 1.1, new THREE.Color(0.35, 0.4, 0.12));
        audio.slam(at, 1.2 * size);
        fx.addShake(0.35);
        break;
      case 'chain': {
        // The chain cracks down along the lane: sparks and grit where the links strike.
        for (let i = 1; i <= 4; i++) {
          const q = at.clone().addScaledVector(fwd, (ext * i) / 4.2);
          fx.sparks(q.clone().setY(q.y + 0.15), 8, new THREE.Color(1.5, 0.7, 0.3), 3, 0.45);
        }
        fx.shockwave(at.clone().addScaledVector(fwd, ext * 0.8), 1.4, new THREE.Color(0.5, 0.3, 0.2));
        fx.slash(this.position.clone().setY(this.position.y + 0.6), s.yaw, ext, new THREE.Color(1.0, 0.5, 0.25));
        audio.slam(at.clone().addScaledVector(fwd, ext * 0.8), 0.7);
        fx.addShake(0.25);
        break;
      }
      case 'hallow':
        // A pillar of golden fire falls on the marked ground.
        fx.pillar(at.clone(), new THREE.Color(2.6, 1.8, 0.6));
        fx.shockwave(at, ext * 1.1, new THREE.Color(1.4, 0.9, 0.3));
        fx.sparks(at.clone().setY(at.y + 0.4), 30, new THREE.Color(2.2, 1.5, 0.5), 4, 0.9);
        fx.flash(at.clone().setY(at.y + 1.2), 0xffc050, 30, ext * 3, 0.45);
        audio.blast(at, 'soul', 1);
        fx.addShake(0.3);
        break;
      case 'mire':
        fx.shockwave(at, ext * 1.1, new THREE.Color(0.25, 0.45, 0.2));
        fx.shockwave(at, ext * 0.5, new THREE.Color(0.4, 0.7, 0.3));
        fx.blood(at.clone().setY(at.y + 0.1), at.clone().setY(at.y - 1), 30, new THREE.Color(0.06, 0.1, 0.04), 1.4);
        fx.sparks(at.clone().setY(at.y + 0.3), 18, new THREE.Color(0.5, 1.2, 0.4), 3, 0.8);
        fx.flash(at.clone().setY(at.y + 0.6), 0x60ff60, 16, ext * 2.5, 0.35);
        audio.splash(at);
        break;
    }
    if (!p.alive || !s.tele.hits(p.position, p.radius)) return;
    // Reckoned from the kind's damage at its level without the champion
    // multiplier: a champion's mark is wider and comes more often instead.
    const dm = monsterDamageScale(this.level) * signatureMult(this.level) * s.def.factor * (this.elite ? 1.15 : 1);
    const roll = rollDamage(this.def.dmg[0] * dm, this.def.dmg[1] * dm, 0);
    ctx.onPlayerHit(roll.amount, true, this.position);
    if (s.def.knock > 0) {
      const push = new THREE.Vector2(p.position.x - this.position.x, p.position.z - this.position.z);
      if (push.lengthSq() < 1e-4) push.set(Math.sin(s.yaw), Math.cos(s.yaw));
      (p as { knock?: (d: THREE.Vector2, m: number) => void }).knock?.(push, s.def.knock);
    }
  }

  protected get voiceSize() {
    return (this.kind === 'brute' || this.kind === 'horror' || this.kind === 'butcher' || this.kind === 'maiden' ? 1.15 : this.kind === 'gaunt' ? 0.85 : this.kind === 'spider' || this.kind === 'rootHorror' ? 1.8 : this.kind === 'toad' ? 1.3 : 1) * (this.spawn.boss ? 1.8 : this.elite ? 1.3 : 1);
  }

  get kind(): MonsterKind {
    return this.spawn.kind;
  }

  protected turn(target: number, dt: number, rate: number) {
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-dt * rate));
  }

  protected sync() {
    const r = this.body.rig.root;
    r.position.copy(this.position);
    r.rotation.y = this.yaw;
  }

  /** Puts the monster back at home at full health (area re-entered). */
  reset() {
    if (this.removed) this.scene.add(this.body.rig.root);
    this.removed = false;
    this.cancelSignature();
    this.sigCd = null;
    this.deadFor = 0;
    this.state = 'idle';
    this.awake = false;
    this.hp = this.maxHp;
    this.path = [];
    this.position.copy(this.spawn.pos);
    const r = this.body.rig;
    r.cancelAction();
    r.body.rotation.set(0, 0, 0);
    r.body.position.set(0, 0, 0);
    this.hit.visible = true;
    this.hit.userData.monster = this;
    this.sync();
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.scene.remove(this.body.rig.root);
  }
}
