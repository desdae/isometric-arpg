import * as THREE from 'three';
import { audio } from '../audio/Audio';
import type { NavGrid } from '../world/NavGrid';
import type { HeightFn } from '../procgen/terrain';
import type { Combatant } from '../game/Combat';
import { mitigate, rollDamage } from '../game/Combat';
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
import { buildAbomination } from './bosses/abomination';
import { buildLich } from './bosses/lich';
import { buildNightwing } from './bosses/nightwing';
import { mulberry32 } from '../procgen/noise';

// Monster behaviour: idle and wander near home, notice the player, chase
// along the nav grid (straight at them when there's a clear line), attack
// in range, flinch, die and leave a corpse. Casters keep their distance and
// throw blood bolts. Packs wake together.

export type MonsterKind = 'ghoul' | 'brute' | 'crawler' | 'cultist' | 'spider' | 'horror' | 'wraith' | 'abomination' | 'lich' | 'nightwing' | 'toad' | 'croc' | 'rootHorror' | 'mireWraith';

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
  readonly level: number;
  readonly elite: boolean;
  /** Invisible pick volume for the mouse. */
  readonly hit: THREE.Mesh;
  hp: number;
  maxHp: number;
  state: State = 'idle';
  protected yaw = Math.random() * Math.PI * 2;
  protected speed = 0;
  protected path: THREE.Vector2[] = [];
  protected repath = 0;
  protected cooldown = 0;
  protected idleTimer = 1 + Math.random() * 4;
  protected dmg: [number, number];
  protected armor: number;
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
    const lv = 1 + (spawn.level - 1) * 0.28;
    const eliteMul = spawn.boss ? 7 : this.elite ? 3.2 : 1;
    this.maxHp = this.hp = Math.round(this.def.hp * lv * eliteMul);
    const dm = (1 + (spawn.level - 1) * 0.16) * (spawn.boss ? 1.7 : this.elite ? 1.5 : 1);
    this.dmg = [this.def.dmg[0] * dm, this.def.dmg[1] * dm];
    this.armor = this.def.armor * lv;
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
    const weight = { ghoul: 0.7, brute: 2.2, crawler: 0.5, cultist: 0.8, spider: 1.2, horror: 2, wraith: 0, abomination: 3, lich: 1.6, nightwing: 1.2, toad: 1.1, croc: 0.9, rootHorror: 2.4, mireWraith: 0 }[this.kind] * (this.elite ? 1.3 : 1);
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

  update(dt: number, ctx: MonsterContext) {
    const rig = this.body.rig;
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
      rig.update(dt, 0);
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
          );
        }
        ctx.effects.flash(from, 0xff2010, 30, 6, 0.3);
        audio.cast(from);
        return;
      }
      const d = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
      if (this.kind === 'brute') {
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

  protected get voiceSize() {
    return (this.kind === 'brute' || this.kind === 'horror' ? 1.15 : this.kind === 'spider' || this.kind === 'rootHorror' ? 1.8 : this.kind === 'toad' ? 1.3 : 1) * (this.spawn.boss ? 1.8 : this.elite ? 1.3 : 1);
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
