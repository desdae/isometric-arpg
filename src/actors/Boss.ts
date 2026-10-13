import * as THREE from 'three';
import { audio } from '../audio/Audio';
import { rollDamage } from '../game/Combat';
import { BossFx } from '../game/BossFx';
import { Telegraph, type Shape } from '../game/Telegraph';
import { Monster, type MonsterContext, type MonsterKind, type MonsterSpawn } from './Monster';
import type { MonsterBody, MonsterMaterials } from './monsters/materials';
import { ABOMINATION } from './bosses/abomination';
import { LICH } from './bosses/lich';
import { NIGHTWING } from './bosses/nightwing';

// Crypt bosses: a monster with a playbook. Between abilities it hunts and
// strikes like any other; every few seconds it picks one of its abilities
// that suits the distance and plays it as a little script (a generator that
// yields how long to wait), painting telegraphs on the floor before each
// blow lands. At half health it enrages: a roar, faster abilities and one
// more trick. It wakes with an entrance and dies with a show.

/** A boss body: the usual monster body plus named ability poses. */
export interface BossBody extends MonsterBody {
  /** Plays a named pose over `dur` seconds; `onHit(i)` fires as progress passes each of `hits`. */
  move(name: string, dur: number, hits?: number[], onHit?: (i: number) => void): void;
  /** Height above the floor the body floats or flies at (set by abilities). */
  lift: number;
}

/** A running ability: yield seconds to wait (0 = until next frame). */
export type Script = Generator<number, void, void>;

export interface Ability {
  name: string;
  cooldown: number;
  /** Distance to the hero this ability is used at. */
  range: [number, number];
  weight?: number;
  /** Only once enraged. */
  enraged?: boolean;
  /** Extra condition to use it at all (e.g. room for more minions). */
  can?(b: Boss, ctx: MonsterContext): boolean;
  run(b: Boss, ctx: MonsterContext): Script;
}

export interface BossDef {
  /** Line under the name when it wakes. */
  epithet: string;
  /** Telegraph colour. */
  color: number;
  abilities: Ability[];
  /** Pose it holds while asleep, before the entrance. */
  sleep?(b: Boss): void;
  intro(b: Boss, ctx: MonsterContext): Script;
  enrage(b: Boss, ctx: MonsterContext): Script;
  death(b: Boss, ctx: MonsterContext): void;
}

export const BOSS_DEFS: Partial<Record<MonsterKind, BossDef>> = { abomination: ABOMINATION, lich: LICH, nightwing: NIGHTWING };

export class Boss extends Monster {
  readonly brain: BossDef;
  fx!: BossFx;
  phase = 1;
  invulnerable = false;
  introduced = false;
  /** Seconds since the current script started (handy for timing inside abilities). */
  dt = 0;
  /** Ground speed this frame while a script moves the body (drives the gait). */
  scriptSpeed = 0;
  private script: Script | null = null;
  private wait = 0;
  private gcd = 2.2;
  private cds = new Map<Ability, number>();
  private teles: Telegraph[] = [];
  private deathShown = false;
  private slept = false;
  private lastAbility: Ability | null = null;

  constructor(spawn: MonsterSpawn, mats: MonsterMaterials, scene: THREE.Scene) {
    super(spawn, mats, scene);
    this.brain = BOSS_DEFS[spawn.kind]!;
    for (const a of this.brain.abilities) this.cds.set(a, a.cooldown * (0.3 + Math.random() * 0.4));
  }

  get bossBody(): BossBody {
    return this.body as BossBody;
  }

  get facingYaw() {
    return this.yaw;
  }

  set facingYaw(v: number) {
    this.yaw = v;
  }

  get busy() {
    return this.script !== null;
  }

  /** Bosses shrug off stuns: a skill cannot interrupt a playbook. */
  stun(): boolean {
    return false;
  }

  takeDamage(amount: number, crit: boolean, from: THREE.Vector3): number {
    if (this.invulnerable || !this.introduced) return 0;
    return super.takeDamage(amount, crit, from);
  }

  update(dt: number, ctx: MonsterContext) {
    this.fx ??= new BossFx(ctx.effects);
    this.fx.tick(dt);
    this.dt = dt;
    // Bosses never flinch: a hit should not cancel a wind-up.
    this.flinchCd = 99;
    if (!this.alive) {
      if (!this.deathShown) {
        this.deathShown = true;
        this.stop();
        this.bossBody.lift = 0;
        this.hidden = false;
        this.body.rig.root.visible = true;
        this.brain.death(this, ctx);
      }
      super.update(dt, ctx);
      return;
    }
    if (!this.introduced) {
      // Asleep until the seal breaks, then the entrance plays.
      if (!this.script) {
        if (!this.slept) {
          this.slept = true;
          this.brain.sleep?.(this);
        }
        const p = ctx.player;
        const near = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z) < this.def.aggro;
        if (this.dormant || !p.alive || (!near && this.state === 'idle')) {
          this.position.y = ctx.height(this.position.x, this.position.z);
          this.body.rig.update(dt, 0);
          this.sync();
          this.body.rig.root.position.y += this.bossBody.lift;
          return;
        }
        this.state = 'chase';
        this.awake = true;
        this.invulnerable = true;
        this.run(this.brain.intro(this, ctx), () => {
          this.introduced = true;
          this.invulnerable = false;
        });
      }
    } else if (!this.script && this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      this.body.rig.cancelAction();
      this.run(this.brain.enrage(this, ctx));
    }
    if (this.script) {
      this.scriptSpeed = 0;
      this.stepScript(dt);
      this.position.y = ctx.height(this.position.x, this.position.z);
      this.body.rig.update(dt, this.scriptSpeed);
      this.sync();
      this.body.rig.root.position.y += this.bossBody.lift;
      return;
    }
    // Hunting: count down, then pick an ability that fits the distance.
    this.gcd -= dt;
    for (const [a, cd] of this.cds) this.cds.set(a, cd - dt * (this.phase === 2 ? 1.35 : 1));
    const p = ctx.player;
    const dist = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
    if (this.gcd <= 0 && p.alive && !this.body.rig.acting && (this.state === 'chase' || this.state === 'attack')) {
      const ready = this.brain.abilities.filter(
        (a) => (this.cds.get(a) ?? 0) <= 0 && dist >= a.range[0] && dist <= a.range[1] && (!a.enraged || this.phase === 2) && (!a.can || a.can(this, ctx)) && (a !== this.lastAbility || this.brain.abilities.length < 2),
      );
      if (ready.length) {
        let total = ready.reduce((s, a) => s + (a.weight ?? 1), 0) * Math.random();
        const pick = ready.find((a) => (total -= a.weight ?? 1) <= 0) ?? ready[0];
        this.cds.set(pick, pick.cooldown);
        this.lastAbility = pick;
        this.speed = 0;
        this.path = [];
        this.run(pick.run(this, ctx), () => (this.gcd = this.phase === 2 ? 1.0 : 1.7));
        return;
      }
    }
    super.update(dt, ctx);
    this.body.rig.root.position.y += this.bossBody.lift;
  }

  private onScriptEnd: (() => void) | null = null;

  private run(s: Script, then?: () => void) {
    this.script = s;
    this.wait = 0;
    this.onScriptEnd = then ?? null;
  }

  private stepScript(dt: number) {
    this.wait -= dt;
    while (this.script && this.wait <= 0) {
      const r = this.script.next();
      if (r.done) {
        this.script = null;
        const cb = this.onScriptEnd;
        this.onScriptEnd = null;
        cb?.();
        break;
      }
      if (r.value <= 0) {
        this.wait = 0;
        break;
      }
      this.wait += r.value;
    }
  }

  /** Abandons the current ability and clears its telegraphs. */
  stop() {
    this.script = null;
    this.onScriptEnd = null;
    for (const t of this.teles) t.cancel();
    this.teles = [];
  }

  // ---- Helpers for ability scripts ------------------------------------------

  /** Runs `fn(k)` every frame for `secs` seconds (k from 0 to 1). */
  *over(secs: number, fn: (k: number) => void): Script {
    let t = 0;
    while (t < secs) {
      t += this.dt;
      fn(Math.min(1, t / secs));
      yield 0;
    }
  }

  /** Paints a telegraph on the floor. */
  tele(shape: Shape, origin: THREE.Vector3, yaw: number, dur: number, color: number = this.brain.color): Telegraph {
    const t = new Telegraph(this.fx.fx, shape, origin.clone().setY(0), yaw, dur, color);
    this.teles = this.teles.filter((x) => !x.done);
    this.teles.push(t);
    return t;
  }

  /** Turns toward a point at `rate`. */
  face(p: THREE.Vector3, rate = 10) {
    this.turn(Math.atan2(p.x - this.position.x, p.z - this.position.z), this.dt, rate);
  }

  /** Yaw straight at a point. */
  yawTo(p: THREE.Vector3) {
    return Math.atan2(p.x - this.position.x, p.z - this.position.z);
  }

  /** Moves along `dir` at `speed` m/s for this frame; false when a wall stops it. */
  push(ctx: MonsterContext, dirX: number, dirZ: number, speed: number): boolean {
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = this.position.x + (dirX / len) * speed * this.dt;
    const nz = this.position.z + (dirZ / len) * speed * this.dt;
    // Keep the boss's bulk off the walls, not just its centre.
    const r = this.radius * 0.6;
    const ok = ctx.nav.walkable(nx, nz) && ctx.nav.walkable(nx + (dirX / len) * r, nz + (dirZ / len) * r);
    if (!ok) return false;
    this.position.x = nx;
    this.position.z = nz;
    this.scriptSpeed = speed;
    return true;
  }

  /** Puts the boss at `p` at once (blinks, landings), if the floor allows. */
  place(ctx: MonsterContext, p: THREE.Vector3) {
    const at = ctx.nav.walkable(p.x, p.z) ? new THREE.Vector2(p.x, p.z) : ctx.nav.nearestWalkable(p.x, p.z);
    if (!at) return;
    this.position.set(at.x, ctx.height(at.x, at.y), at.y);
  }

  /** Deals `mult` times the boss's damage to the hero. */
  hurt(ctx: MonsterContext, mult: number, from: THREE.Vector3 = this.position) {
    const roll = rollDamage(this.dmg[0] * mult, this.dmg[1] * mult, 0.05);
    ctx.onPlayerHit(roll.amount, roll.crit, from);
  }

  /** Throws the hero away from `from` by `metres`. */
  knock(ctx: MonsterContext, from: THREE.Vector3, metres: number) {
    const p = ctx.player as { position: THREE.Vector3; knock?: (d: THREE.Vector2, m: number) => void };
    const d = new THREE.Vector2(p.position.x - from.x, p.position.z - from.z);
    if (d.lengthSq() < 1e-4) d.set(Math.sin(this.yaw), Math.cos(this.yaw));
    p.knock?.(d, metres);
  }

  /** A walkable point near `p` (for targeting, summons and landings). */
  floorNear(ctx: MonsterContext, p: THREE.Vector3, jitter = 0): THREE.Vector3 {
    for (let i = 0; i < 12; i++) {
      const x = p.x + (Math.random() - 0.5) * 2 * jitter;
      const z = p.z + (Math.random() - 0.5) * 2 * jitter;
      if (ctx.nav.walkable(x, z)) return new THREE.Vector3(x, ctx.height(x, z), z);
    }
    const q = ctx.nav.nearestWalkable(p.x, p.z);
    return q ? new THREE.Vector3(q.x, 0, q.y) : p.clone();
  }

  /** Calls up a minion beside the boss; it hunts at once. */
  summon(ctx: MonsterContext, kind: MonsterKind, at: THREE.Vector3, level = this.level - 1): Monster {
    const m = new Monster({ kind, pos: at.clone(), level, pack: this.spawn.pack, wander: 2, tag: 'minion' }, this.mats, this.scene);
    m.state = 'chase';
    m.awake = true;
    ctx.monsters.push(m);
    return m;
  }

  /** How many more minions it may raise before the room is full. */
  spareMinions(ctx: MonsterContext, max = 6) {
    return Math.max(0, max - ctx.monsters.filter((m) => m.alive && m.spawn.tag === 'minion').length);
  }

  /** Is the hero standing inside this telegraph? */
  caught(ctx: MonsterContext, t: Telegraph) {
    return ctx.player.alive && t.hits(ctx.player.position, ctx.player.radius);
  }

  voice(what: 'aggro' | 'attack' | 'hurt' | 'die' = 'attack') {
    audio.voice(this.kind, what, this.position, 2);
  }
}

/** Builds the right kind of monster for a spawn. */
export function createMonster(spawn: MonsterSpawn, mats: MonsterMaterials, scene: THREE.Scene): Monster {
  return BOSS_DEFS[spawn.kind] ? new Boss(spawn, mats, scene) : new Monster(spawn, mats, scene);
}
