import * as THREE from 'three';
import { audio } from '../audio/Audio';
import type { Character } from './Character';
import type { NavGrid } from '../world/NavGrid';
import type { HeightFn } from '../procgen/terrain';
import type { Combatant, FloatingText } from '../game/Combat';
import { rollDamage } from '../game/Combat';
import { LEECH_PER_SEC, LEECH_RESERVE, mitigateHero } from '../game/Balance';
import { prewarmTelegraph } from '../game/Telegraph';
import type { Effects } from '../game/Effects';
import type { Stats } from '../game/Stats';
import { BossFx, prewarmBossFx } from '../game/BossFx';
import { prewarmSpellFx } from '../game/SpellFx';
import { prewarmSkillFx } from '../game/SkillFx';
import { SK, SKILL, type SkillId } from '../game/Skills';
import type { Monster } from './Monster';
import { collapse, keyedAction } from './monsters/humanoid';
import { castMage, staffBolt } from './mage';
import { castDeep } from './deepSkills';
import { telemetry } from '../game/Telemetry';

// The hero: click-to-move along the nav grid, walk up to things to interact,
// sword swings at a target (repeating while the button is held), the skills
// learned in the tree (each with its mana cost and cooldown), potions, life
// and death.

export interface Area {
  scene: THREE.Scene;
  nav: NavGrid;
  heightAt: HeightFn;
}

export interface PlayerContext {
  monsters: Monster[];
  effects: Effects;
  floaters: FloatingText;
  onKill: (m: Monster) => void;
}

const GOLD = new THREE.Color(2.2, 1.6, 0.55);
const CRIMSON = new THREE.Color(2.2, 0.12, 0.08);
const EMBER = new THREE.Color(1.9, 0.6, 0.2);

/** A lasting wound on a monster: bleeding or burning, as weapon damage per second. */
interface Dot {
  m: Monster;
  kind: 'bleed' | 'burn';
  dps: number;
  left: number;
  next: number;
}

export class Player implements Combatant {
  readonly position = new THREE.Vector3();
  readonly radius = 0.4;
  readonly height = 1.85;
  readonly maxSpeed = 4.6;
  private path: THREE.Vector2[] = [];
  private velocity = new THREE.Vector2();
  private yaw = 0;
  private marker: THREE.Mesh;
  private markerAge = 10;
  private pending: { target: THREE.Vector3; radius: number; onReach: () => void } | null = null;
  /** The area the hero stands in (spells read its floor and nav). */
  area: Area | null = null;
  /** Monster we're swinging at; kept while the button is held. */
  target: Monster | null = null;
  holdAttack = false;
  private swinging = false;
  /** A skill ordered mid-swing, cast as soon as the swing ends. */
  private queued: SkillId | null = null;
  /** Seconds until each skill can be used again. */
  readonly cooldowns = new Map<SkillId, number>();
  /** Ground point under the cursor, where aimed skills go. */
  readonly aim = new THREE.Vector3();
  private castLeft = 0;
  private castEnd: (() => void) | null = null;
  private lift = 0;
  private leap: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; land: () => void } | null = null;
  private whirl: { left: number; next: number; mult: number } | null = null;
  consecrations: { at: THREE.Vector3; radius: number; left: number; next: number; mult: number; heal: number; follow?: boolean; smite?: number }[] = [];
  private armorLeft = 0;
  private armorAmount = 0;
  private furyOn = false;
  /** Ice Armour while it lasts (see deepSkills). */
  iceArmor: { left: number; amount: number; retaliate: boolean; mend: boolean; cd: number; tick: (dt: number, ctx: PlayerContext) => void } | null = null;
  /** Seconds left of the Warding Circle (less damage taken while inside it), and where it stands. */
  phaseLeft = 0;
  readonly phaseAt = new THREE.Vector3();
  private sanctuaryCd = 0;
  /** Bleeds and burns on monsters. */
  private dots: Dot[] = [];
  /** The context of the last frame, for things that happen outside a cast (being struck). */
  private lastCtx: PlayerContext | null = null;
  /** A straight dash in progress (Lunge). */
  dash: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; step: (at: THREE.Vector3) => void; land: () => void } | null = null;
  private bfx: BossFx | null = null;
  private swingIndex = 0;
  private potionCd = 0;
  /** Life steal still available to heal (see LEECH_PER_SEC). */
  private leechPool = 0;
  private hurtCd = 0;
  dead = false;

  constructor(
    readonly character: Character,
    readonly stats: Stats,
  ) {
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.32, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.5, 0.2), transparent: true, depthWrite: false, fog: false }),
    );
    this.marker.visible = false;
    character.onStep = () => audio.step(this.position, 1, true);
  }

  get alive() {
    return !this.dead;
  }
  get hp() {
    return this.stats.hp;
  }
  set hp(v: number) {
    this.stats.hp = v;
  }
  get maxHp() {
    return this.stats.maxHp;
  }
  set maxHp(v: number) {
    this.stats.maxHp = v;
  }

  /** Moves the hero into an area (initial spawn or after travelling). */
  enter(area: Area, spawn: THREE.Vector3, yaw: number) {
    this.area?.scene.remove(this.character.root, this.marker);
    this.area = area;
    area.scene.add(this.character.root, this.marker);
    this.position.copy(spawn);
    this.position.y = area.heightAt(spawn.x, spawn.z);
    this.yaw = yaw;
    this.path = [];
    this.pending = null;
    this.target = null;
    this.queued = null;
    this.endCast();
    this.consecrations = [];
    this.tickers.length = 0;
    this.dots = [];
    this.dash = null;
    if (this.iceArmor) this.iceArmor.left = 0;
    prewarmBossFx(area.scene);
    prewarmSpellFx(area.scene);
    prewarmSkillFx(area.scene);
    prewarmTelegraph(area.scene);
    this.velocity.set(0, 0);
    this.shove.set(0, 0);
    this.syncTransform();
  }

  /** Moves the hero instantly (Blink). */
  teleport(to: THREE.Vector3) {
    this.position.copy(to);
    this.path = [];
    this.pending = null;
    this.velocity.set(0, 0);
    this.syncTransform();
  }

  /** Walk up to something (an NPC, an item, a gate) and run `onReach` on arrival. */
  interact(target: THREE.Vector3, radius: number, onReach: () => void) {
    if (this.dead || !this.area) return;
    this.target = null;
    this.pending = { target, radius, onReach };
    const d = Math.hypot(target.x - this.position.x, target.z - this.position.z);
    if (d <= radius) return;
    this.path = this.area.nav.findPath(new THREE.Vector2(this.position.x, this.position.z), new THREE.Vector2(target.x, target.z)) ?? [];
  }

  moveTo(target: THREE.Vector3, showMarker = true) {
    if (this.dead || !this.area) return;
    this.pending = null;
    this.target = null;
    const path = this.area.nav.findPath(new THREE.Vector2(this.position.x, this.position.z), new THREE.Vector2(target.x, target.z));
    if (!path || path.length === 0) return;
    this.path = path;
    if (showMarker) {
      const end = path[path.length - 1];
      this.marker.position.set(end.x, this.area.heightAt(end.x, end.y) + 0.04, end.y);
      this.markerAge = 0;
    }
  }

  /** Attack a monster: close in if needed, then swing. */
  attack(m: Monster) {
    if (this.dead || !m.alive) return;
    this.pending = null;
    this.target = m;
    this.path = [];
  }

  private reach(m: Monster) {
    // Casters shoot from range; everyone else closes to sword's length.
    if (this.stats.cls.attack === 'ranged') return 9 + m.radius;
    return 1.35 + m.radius + this.radius * 0.5;
  }

  /** Lasting spell effects (burning ground, storms, missile volleys); each returns false when done. */
  readonly tickers: ((dt: number, ctx: PlayerContext) => boolean)[] = [];

  /**
   * Uses a skill from the belt, aimed at `this.aim`. Returns why it couldn't
   * (no mana, cooling down) or null once it is under way or queued.
   */
  cast(id: SkillId, ctx: PlayerContext): string | null {
    if (this.dead || !this.area) return null;
    telemetry.mark(`cast:${id}`);
    const def = SKILL[id];
    const r = this.stats.rank(id);
    if (!def.active || r <= 0) return 'Not learned';
    if ((this.cooldowns.get(id) ?? 0) > 0) return 'Not ready';
    const cost = def.cost?.(r) ?? 0;
    // Blood Magic: every skill is paid for in life instead.
    const blood = this.stats.has('bloodMagic');
    if (blood ? this.stats.hp <= cost + 1 : this.stats.mana < cost) return blood ? 'Not enough life' : 'Not enough mana';
    // Mid-swing: remember the order and cast as soon as the swing ends.
    if (this.swinging) {
      this.queued = id;
      return null;
    }
    this.queued = null;
    if (blood) {
      this.stats.hp -= cost;
      if (cost > 0) ctx.effects.skill.bloodAura(this.position);
      if (cost > 0) ctx.effects.blood(this.position.clone().setY(this.position.y + 1.2), this.position.clone().setY(this.position.y + 0.5), 6, new THREE.Color(0.3, 0.01, 0.01), 0.5);
    } else this.stats.mana -= cost;
    const cd = def.cooldown?.(r) ?? 0;
    if (cd > 0) this.cooldowns.set(id, cd);
    this.path = [];
    this.pending = null;
    this.velocity.set(0, 0);
    if (def.aimed) {
      const dx = this.aim.x - this.position.x;
      const dz = this.aim.z - this.position.z;
      if (dx * dx + dz * dz > 0.01) this.yaw = Math.atan2(dx, dz);
    }
    const fx = this.fxFor(ctx.effects);
    switch (id) {
      case 'cleave':
        this.doCleave(ctx, SK.cleaveMult(r));
        break;
      case 'leapSlam':
        this.doLeap(ctx, fx, r);
        break;
      case 'whirlwind':
        this.doWhirl(r);
        break;
      case 'warCry':
        this.doWarCry(ctx, fx, r);
        break;
      case 'consecration':
        this.doConsecrate(ctx, fx, r);
        break;
      case 'bloodLance':
        this.doLance(ctx, r);
        break;
      case 'bloodNova':
        this.doNova(ctx, fx, r);
        break;
      case 'lunge':
      case 'judgement':
      case 'hemorrhage':
      case 'fireWall':
      case 'glacialSpike':
      case 'iceArmor':
      case 'arcaneOrb':
        castDeep(this, id, r, ctx, fx);
        break;
      default:
        castMage(this, id, r, ctx, fx);
    }
    return null;
  }

  /** Skill cooldown left as a fraction of its full length (for the belt). */
  cooldownFrac(id: SkillId): number {
    const t = this.cooldowns.get(id) ?? 0;
    if (t <= 0) return 0;
    const full = SKILL[id].cooldown?.(Math.max(1, this.stats.rank(id))) ?? 1;
    return Math.min(1, t / full);
  }

  fxFor(e: Effects): BossFx {
    if (!this.bfx || this.bfx.fx !== e) this.bfx = new BossFx(e);
    return this.bfx;
  }

  /** Locks the hero into a skill for `dur` seconds; `end` tidies the pose. */
  busy(dur: number, end?: () => void) {
    this.swinging = true;
    this.castLeft = dur;
    this.castEnd = end ?? null;
  }

  private endCast() {
    const end = this.castEnd;
    this.castLeft = 0;
    this.castEnd = null;
    this.leap = null;
    this.whirl = null;
    this.dash = null;
    this.lift = 0;
    if (end) {
      this.swinging = false;
      end();
    }
  }

  restPose() {
    const c = this.character;
    c.body.rotation.set(0, 0, 0);
    c.body.position.set(0, 0, 0);
    for (const a of c.arms) a.upper.rotation.z = a.side * 0.12;
  }

  near(ctx: PlayerContext, at: THREE.Vector3, radius: number) {
    return ctx.monsters.filter((m) => m.alive && Math.hypot(m.position.x - at.x, m.position.z - at.z) < radius + m.radius);
  }

  /** Spinning cleave hitting everything around the hero (a backhand spin after it with Twin Cleave). */
  private doCleave(ctx: PlayerContext, mult: number) {
    const c = this.character;
    const st = this.stats;
    const twin = st.has('cleaveTwin');
    const wide = st.has('cleaveWide');
    const rend = st.has('cleaveRend');
    const reach = wide ? SK.wideReach : 2.5;
    const dur = twin ? 0.95 : 0.55;
    let hits = 0;
    const startYaw = this.yaw;
    const strikeAll = (m2: number, back: boolean) => {
      audio.cleave();
      const col = back ? new THREE.Color(1.5, 0.55, 0.4) : new THREE.Color(1.8, 0.7, 0.45);
      ctx.effects.slash(this.position.clone().setY(this.position.y + (back ? 1.15 : 1.0)), startYaw + (back ? Math.PI : 0), reach + 0.2, col, true);
      ctx.effects.spell.dust(this.position, reach * 0.6, wide ? 22 : 14, undefined, wide ? 1.1 : 0.8);
      ctx.effects.sparks(this.position.clone().setY(this.position.y + 0.9), 12, EMBER, 4, 0.35);
      if (wide) ctx.effects.spell.ring(this.position, reach, new THREE.Color(1.3, 0.6, 0.3), 0.35);
      for (const m of this.near(ctx, this.position, reach)) {
        this.strike(m, ctx, m2);
        if (!m.alive) continue;
        if (rend) this.dot(m, 'bleed', SK.rendBleed, SK.bleedTime);
        if (wide) this.push(m, m.position.clone().sub(this.position), 1.6);
      }
    };
    this.busy(dur, () => this.restPose());
    c.play(dur, (k) => {
      const t = k * dur;
      // First spin over 0.08..0.42s; with Twin Cleave a reverse spin over 0.5..0.85s.
      const e1 = THREE.MathUtils.clamp((t - 0.08) / 0.33, 0, 1);
      const e2 = twin ? THREE.MathUtils.clamp((t - 0.5) / 0.32, 0, 1) : 0;
      const s1 = e1 * e1 * (3 - 2 * e1);
      const s2 = e2 * e2 * (3 - 2 * e2);
      c.body.rotation.y = -s1 * Math.PI * 2 + s2 * Math.PI * 2;
      const w = Math.min(1, t / 0.08, (dur - t) / 0.12);
      const R = c.arm(1);
      R.upper.rotation.z = THREE.MathUtils.lerp(0.12, 1.45, w);
      R.upper.rotation.x = THREE.MathUtils.lerp(R.upper.rotation.x, -0.5, w);
      R.fore.rotation.x = THREE.MathUtils.lerp(R.fore.rotation.x, -0.1, w);
      c.spine.rotation.x += 0.15 * w;
      if (hits === 0 && t >= 0.22) {
        hits = 1;
        strikeAll(mult, false);
      }
      if (twin && hits === 1 && t >= 0.64) {
        hits = 2;
        strikeAll(mult * SK.twinMult, true);
      }
    });
  }

  /** Leaps to the cursor and smashes down, stunning everything at the landing. */
  private doLeap(ctx: PlayerContext, fx: BossFx, r: number) {
    const area = this.area!;
    const from = this.position.clone();
    const dir = new THREE.Vector3(this.aim.x - from.x, 0, this.aim.z - from.z);
    const dist = Math.min(7.5, dir.length());
    dir.normalize();
    const to = from.clone();
    // Land as far along as the floor allows.
    for (let s = dist; s > 0; s -= 0.25) {
      const x = from.x + dir.x * s;
      const z = from.z + dir.z * s;
      if (area.nav.walkable(x, z)) {
        to.set(x, area.heightAt(x, z), z);
        break;
      }
    }
    const dur = 0.42 + dist * 0.035;
    audio.whoosh(from, 1.3);
    ctx.effects.sparks(from.clone().setY(from.y + 0.2), 14, EMBER, 2.2, 0.5);
    ctx.effects.spell.dust(from, 1.2, 10, undefined, 0.7);
    const c = this.character;
    this.busy(dur + 0.22, () => this.restPose());
    c.play(dur + 0.22, (k0) => {
      const k = (k0 * (dur + 0.22)) / dur; // 0..1 across the flight, beyond is the follow-through
      const L = c.arm(-1);
      const R = c.arm(1);
      // Overhead in the air, down hard on landing.
      const up = Math.min(1, k / 0.25);
      const down = THREE.MathUtils.clamp((k - 0.72) / 0.22, 0, 1);
      R.upper.rotation.x = THREE.MathUtils.lerp(-0.1, -2.9, up) + down * 2.3;
      L.upper.rotation.x = THREE.MathUtils.lerp(-0.05, -2.5, up) + down * 2.0;
      R.fore.rotation.x = -0.3 - up * 0.6 + down * 0.6;
      c.spine.rotation.x += -0.25 * up * (1 - down) + down * 0.55;
      c.head.rotation.x += down * 0.2;
      // Knees tuck mid-air.
      const tuck = Math.sin(Math.min(1, k) * Math.PI);
      for (const g of c.legs) {
        g.thigh.rotation.x = -0.9 * tuck;
        g.shin.rotation.x = 1.3 * tuck;
      }
      c.body.position.y = k > 1 ? -0.25 * Math.sin(Math.min(1, (k - 1) / 0.5) * Math.PI) : 0;
    });
    this.leap = {
      from,
      to,
      t: 0,
      dur,
      land: () => {
        audio.slam(to, 1.3);
        audio.quake(to, 0.8);
        ctx.effects.shockwave(to, 3.6, new THREE.Color(1.2, 0.55, 0.25));
        ctx.effects.addShake(0.4);
        ctx.effects.flash(to.clone().setY(to.y + 0.6), 0xff7a30, 34, 9, 0.4);
        fx.cracks(to, 3.2, EMBER, 2.8);
        fx.debris(to, 28, 1.35);
        fx.nova(to, 3.2, EMBER.clone().multiplyScalar(0.6), 0.45);
        const sp = ctx.effects.spell;
        sp.dust(to, 3.4, 28, undefined, 1.1);
        sp.energyBurst(to.clone().setY(to.y + 0.3), 1.3, new THREE.Color(3.2, 1.3, 0.35), new THREE.Color(0.8, 0.12, 0.02), 10, 0);
        sp.decal('scorch', to.x, to.z, 2.4, 5, 0.6);
        ctx.effects.sparks(to.clone().setY(to.y + 0.3), 30, EMBER, 5.5, 0.7);
        const stun = SK.leapStun(r);
        for (const m of this.near(ctx, to, 2.8)) {
          this.strike(m, ctx, SK.leapMult(r));
          if (m.alive) m.stun(stun);
        }
        if (this.stats.has('leapMolten')) this.moltenGround(to, 2.6, 3, SK.moltenTick);
        if (this.stats.has('leapAftershock')) {
          let t = 0;
          this.tickers.push((dt, c2) => {
            t += dt;
            if (t < 0.5) return true;
            audio.quake(to, 1.2);
            c2.effects.addShake(0.35);
            c2.effects.shockwave(to, 4.5, new THREE.Color(1.3, 0.5, 0.2));
            fx.cracks(to, 4.2, EMBER, 2.2);
            fx.debris(to, 20, 1.6);
            fx.nova(to, 4.5, EMBER.clone().multiplyScalar(0.5), 0.5, 0.6);
            c2.effects.spell.dust(to, 4.5, 30, undefined, 1.3);
            c2.effects.sparks(to.clone().setY(to.y + 0.3), 26, EMBER, 6, 0.6);
            for (const m of this.near(c2, to, 4.5)) this.strike(m, c2, SK.leapMult(r) * SK.aftershockMult);
            return false;
          });
        }
      },
    };
  }

  private leapTick(dt: number, area: Area) {
    const L = this.leap!;
    L.t += dt;
    const k = Math.min(1, L.t / L.dur);
    const e = k * k * (3 - 2 * k) * 0.35 + k * 0.65;
    this.position.x = THREE.MathUtils.lerp(L.from.x, L.to.x, e);
    this.position.z = THREE.MathUtils.lerp(L.from.z, L.to.z, e);
    this.position.y = area.heightAt(this.position.x, this.position.z);
    this.lift = Math.sin(k * Math.PI) * (1.1 + L.from.distanceTo(L.to) * 0.18);
    if (k >= 1) {
      this.lift = 0;
      this.position.copy(L.to);
      const land = L.land;
      this.leap = null;
      land();
    }
  }

  /** Spins with the sword out, drifting toward the cursor and hitting all around. */
  private doWhirl(r: number) {
    const dur = SK.whirlTime(r);
    if (this.stats.has('whirlCrown')) {
      let t = 0;
      this.tickers.push((dt, c2) => {
        t += dt;
        if (this.dead) return false;
        if (t < dur - 0.1) return true;
        this.crownOfBlades(c2);
        return false;
      });
    }
    this.whirl = { left: dur, next: 0.05, mult: SK.whirlMult(r) };
    const c = this.character;
    let ang = 0;
    let last = 0;
    this.busy(dur, () => this.restPose());
    c.play(dur, (k) => {
      const t = k * dur;
      ang += (t - last) * 15;
      last = t;
      c.body.rotation.y = -ang;
      const w = Math.min(1, t / 0.15, (dur - t) / 0.2);
      const R = c.arm(1);
      const L = c.arm(-1);
      R.upper.rotation.z = THREE.MathUtils.lerp(0.12, 1.5, w);
      R.upper.rotation.x = THREE.MathUtils.lerp(R.upper.rotation.x, -0.35, w);
      R.fore.rotation.x = THREE.MathUtils.lerp(R.fore.rotation.x, -0.05, w);
      L.upper.rotation.z = THREE.MathUtils.lerp(-0.12, -1.1, w);
      c.spine.rotation.x += 0.12 * w;
    });
  }

  /** Crown of Blades: swords wheel round a burning heart over the hero, then fly out along their lines. */
  private crownOfBlades(ctx: PlayerContext) {
    const at = this.position.clone().setY(this.position.y + 1.1);
    audio.whoosh(at, 1.4);
    audio.cleave();
    const sk = ctx.effects.skill;
    sk.bladeCrown(at, 12, 1.4, (dir) => {
      const s = sk.sword(0.55);
      const from = this.position.clone().setY(this.position.y + 1.1).addScaledVector(dir, 0.9);
      s.position.copy(from);
      const holder = new THREE.Group();
      holder.position.copy(from);
      holder.lookAt(from.clone().add(dir));
      s.position.set(0, 0, 0);
      s.rotation.x = Math.PI / 2;
      holder.add(s);
      ctx.effects.group.add(holder);
      const p = from.clone();
      let done = false;
      ctx.effects.after(0.5, holder, (_k, dt) => {
        if (done) return true;
        p.addScaledVector(dir, 13 * dt);
        holder.position.copy(p);
        ctx.effects.spell.puff({ pos: p.clone(), vel: dir.clone().multiplyScalar(-2), life: 0.25, size: 0.25, size1: 0.06, color: new THREE.Color(2.4, 0.6, 0.2), color1: new THREE.Color(0.6, 0.02, 0.02), alpha: 0.7, add: 1, erode: 0.85 });
        if (!this.area!.nav.walkable(p.x, p.z)) {
          done = true;
          ctx.effects.sparks(p, 8, EMBER, 2.5, 0.4);
          return true;
        }
        for (const m of ctx.monsters) {
          if (!m.alive || Math.hypot(m.position.x - p.x, m.position.z - p.z) > m.radius + 0.4) continue;
          this.strike(m, ctx, SK.crownMult);
          ctx.effects.sparks(p, 10, EMBER, 3, 0.4);
          done = true;
          return true;
        }
      });
    });
  }

  /** A shout that stuns everything nearby and hardens the hero's armour for a while. */
  private doWarCry(ctx: PlayerContext, fx: BossFx, r: number) {
    const c = this.character;
    let fired = false;
    this.busy(0.6, () => this.restPose());
    c.play(0.6, (k) => {
      const w = Math.min(1, k / 0.25, (1 - k) / 0.3);
      for (const a of c.arms) {
        a.upper.rotation.x = THREE.MathUtils.lerp(a.upper.rotation.x, -1.0, w);
        a.upper.rotation.z = THREE.MathUtils.lerp(a.side * 0.12, a.side * 1.1, w);
        a.fore.rotation.x = THREE.MathUtils.lerp(a.fore.rotation.x, -1.6, w);
      }
      c.spine.rotation.x -= 0.35 * w;
      c.head.rotation.x -= 0.4 * w;
      if (!fired && k >= 0.32) {
        fired = true;
        const at = this.position.clone();
        audio.quake(at, 1.1);
        audio.slam(at, 0.8);
        ctx.effects.addShake(0.3);
        ctx.effects.shockwave(at, 6, new THREE.Color(1.4, 1.0, 0.35));
        ctx.effects.flash(at.clone().setY(at.y + 1.4), 0xffd070, 26, 9, 0.4);
        fx.nova(at, 6, GOLD.clone().multiplyScalar(0.4), 0.6, 1.3, 0.8);
        ctx.effects.sparks(at.clone().setY(at.y + 1.6), 30, GOLD, 3.5, 0.7);
        ctx.effects.spell.dust(at, 5, 30, undefined, 1.2);
        ctx.effects.spell.energyBurst(at.clone().setY(at.y + 1.4), 1.6, new THREE.Color(2.6, 1.9, 0.6), new THREE.Color(0.7, 0.35, 0.05), 14, 26);
        const stun = SK.warCryStun(r);
        for (const m of this.near(ctx, at, 6)) {
          m.stun(stun);
          const p = m.position.clone().setY(m.position.y + m.height + 0.3);
          ctx.floaters.spawn('Stunned', p, '');
        }
        if (this.stats.has('warCryThunder')) {
          fx.cracks(at, 5, GOLD, 1.5);
          ctx.effects.spell.ring(at, 6, new THREE.Color(1.8, 1.3, 0.4), 0.4);
          for (const m of this.near(ctx, at, 6)) this.strike(m, ctx, SK.thunderMult);
        }
        if (this.stats.has('warCryRally')) {
          const s = this.stats;
          const heal = Math.round(s.maxHp * SK.rallyHeal);
          s.hp = Math.min(s.maxHp, s.hp + heal);
          ctx.floaters.spawn(`+${heal}`, at.clone().setY(at.y + 2.3), 'heal');
          ctx.effects.spell.rising(at, 1.2, new THREE.Color(2.2, 1.7, 0.6), new THREE.Color(0.6, 0.3, 0.05), 1, 40);
        }
        this.armorAmount = SK.warCryArmor(r);
        this.furyOn = this.stats.has('warCryFury');
        this.armorLeft = 8;
        this.refreshBuffs();
      }
    });
  }

  /** Hallows the ground: a pool of light that burns monsters and mends the hero inside it. */
  private doConsecrate(ctx: PlayerContext, fx: BossFx, r: number) {
    const c = this.character;
    let fired = false;
    this.busy(0.65, () => this.restPose());
    c.play(0.65, (k) => {
      // Sword raised in both hands, then driven point-down into the floor.
      const up = Math.min(1, k / 0.35);
      const down = THREE.MathUtils.clamp((k - 0.4) / 0.15, 0, 1);
      const out = Math.min(1, (1 - k) / 0.25);
      for (const a of c.arms) {
        a.upper.rotation.x = THREE.MathUtils.lerp(-0.1, -2.6, up * out) + down * 1.8 * out;
        a.upper.rotation.z = a.side * THREE.MathUtils.lerp(0.12, -0.25, up * out);
        a.fore.rotation.x = -0.4 - down * 0.4 * out;
      }
      c.spine.rotation.x += (down * 0.45 - up * 0.15) * out;
      c.body.position.y = -0.18 * down * out;
      if (!fired && k >= 0.5) {
        fired = true;
        const at = this.position.clone();
        audio.cast(at);
        audio.slam(at, 0.6);
        fx.pool(at, 3.5, new THREE.Color(0.36, 0.25, 0.07), 6);
        fx.column(at, 0.7, 6, GOLD, 0.9);
        fx.cracks(at, 2.6, GOLD, 6);
        ctx.effects.spell.energyBurst(at.clone().setY(at.y + 0.4), 1.8, new THREE.Color(2.8, 2.1, 0.8), new THREE.Color(0.6, 0.35, 0.05), 16, 30);
        ctx.effects.spell.dust(at, 2.2, 16, undefined, 0.8);
        ctx.effects.flash(at.clone().setY(at.y + 1.0), 0xffd27a, 24, 8, 0.5);
        const follow = this.stats.has('consecFollow');
        const z = { at, radius: 3.5, left: 6, next: 0.1, mult: SK.consecrateMult(r), heal: SK.consecrateHeal(r), follow, smite: this.stats.has('consecSmite') ? 0.6 : undefined };
        this.consecrations.push(z);
        // Walking Faith: a ring of hallowed light carried along under the hero.
        if (follow) ctx.effects.skill.rune(at, 3.5, 6, 'holy', { follow: () => z.at, fill: 0.6 });
      }
    });
  }

  /** Hurls a spear of blood that pierces everything in its path. */
  private doLance(ctx: PlayerContext, r: number) {
    const c = this.character;
    let fired = false;
    this.busy(0.38, () => this.restPose());
    c.play(0.38, (k) => {
      const back = Math.min(1, k / 0.35);
      const fwd = THREE.MathUtils.clamp((k - 0.35) / 0.15, 0, 1);
      const out = Math.min(1, (1 - k) / 0.3);
      const L = c.arm(-1);
      L.upper.rotation.x = THREE.MathUtils.lerp(-0.05, -1.0, back) * out - fwd * 0.6 * out;
      L.fore.rotation.x = -0.3 - back * 0.9 * out + fwd * 0.9 * out;
      c.spine.rotation.y += (0.35 * back - 0.6 * fwd) * out;
      if (!fired && k >= 0.42) {
        fired = true;
        if (this.stats.has('lanceFan')) for (const off of [-0.24, 0, 0.24]) this.launchLance(ctx, SK.lanceMult(r) * SK.fanMult, this.yaw + off);
        else this.launchLance(ctx, SK.lanceMult(r), this.yaw);
      }
    });
  }

  private launchLance(ctx: PlayerContext, mult: number, yaw: number) {
    const area = this.area!;
    const barbs = this.stats.has('lanceBarbs');
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const start = this.position.clone().setY(this.position.y + 1.15).addScaledVector(dir, 0.6);
    const sp = ctx.effects.spell;
    const obj = sp.orb('crimson', 0.14, new THREE.Color(1.2, 0.05, 0.03));
    (obj.userData.core as THREE.Object3D).scale.set(0.12, 0.12, 0.7);
    obj.position.copy(start);
    obj.lookAt(start.clone().add(dir));
    ctx.effects.group.add(obj);
    audio.cast(start);
    const range = 14;
    const speed = 24;
    const hitSet = new Set<Monster>();
    let done = false;
    ctx.effects.after(range / speed, obj, (k, dt) => {
      if (done) return;
      const p = start.clone().addScaledVector(dir, range * k);
      obj.position.copy(p);
      if (!area.nav.walkable(p.x, p.z) && k > 0.05) {
        done = true;
        obj.visible = false;
        audio.boltHit(p);
        ctx.effects.sparks(p, 18, CRIMSON, 2.5, 0.5);
        return;
      }
      sp.energyTrail(p, dir, 0.16, new THREE.Color(1.6, 0.1, 0.06), new THREE.Color(0.4, 0.0, 0.02), dt, false);
      if (Math.random() < 0.6) ctx.effects.mote(p.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6), 0.45, 0.07, CRIMSON, true);
      for (const m of ctx.monsters) {
        if (!m.alive || hitSet.has(m)) continue;
        if (Math.hypot(m.position.x - p.x, m.position.z - p.z) < m.radius + 0.45) {
          hitSet.add(m);
          this.strike(m, ctx, mult);
          if (barbs && m.alive) this.dot(m, 'bleed', SK.barbBleed, SK.bleedTime);
          audio.boltHit(p);
          ctx.effects.sparks(p, 12, CRIMSON, 2.2, 0.4);
          sp.energyBurst(p, 0.6, new THREE.Color(1.8, 0.12, 0.06), new THREE.Color(0.4, 0, 0.02), 6, 0);
        }
      }
    });
  }

  /** Spends some of the hero's own life in a burst of blood, healing from what it deals. */
  private doNova(ctx: PlayerContext, fx: BossFx, r: number) {
    const s = this.stats;
    s.hp -= s.hp * 0.12;
    const c = this.character;
    let fired = false;
    const at = this.position.clone();
    audio.charge(at, 0.32, 'blood');
    ctx.effects.blood(at.clone().setY(at.y + 1.2), at.clone().setY(at.y + 3), 14, new THREE.Color(0.5, 0.02, 0.01), 0.6);
    this.busy(0.75, () => this.restPose());
    c.play(0.75, (k) => {
      // Hunch and gather, then fling the arms wide as it bursts.
      const gather = Math.min(1, k / 0.42);
      const burst = THREE.MathUtils.clamp((k - 0.42) / 0.12, 0, 1);
      const out = Math.min(1, (1 - k) / 0.25);
      for (const a of c.arms) {
        a.upper.rotation.x = THREE.MathUtils.lerp(-0.1, -0.9, gather) * (1 - burst) + burst * -0.4 * out;
        a.upper.rotation.z = a.side * (0.12 + burst * 1.3 * out - gather * 0.3 * (1 - burst));
        a.fore.rotation.x = -0.3 - gather * 1.2 * (1 - burst);
      }
      c.spine.rotation.x += (gather * 0.4 * (1 - burst) - burst * 0.3) * out;
      c.body.position.y = -0.15 * gather * (1 - burst);
      if (k < 0.42 && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        const p = at.clone().add(new THREE.Vector3(Math.cos(a) * 2.2, 0.2, Math.sin(a) * 2.2));
        ctx.effects.mote(p, at.clone().setY(at.y + 1.1).sub(p).multiplyScalar(2.4), 0.4, 0.1, CRIMSON, true);
      }
      if (!fired && k >= 0.45) {
        fired = true;
        const p = this.position.clone();
        audio.blast(p, 'blood', 1.3);
        ctx.effects.addShake(0.35);
        ctx.effects.flash(p.clone().setY(p.y + 1), 0xff2010, 34, 10, 0.45);
        ctx.effects.shockwave(p, 7, new THREE.Color(1.3, 0.1, 0.06));
        fx.nova(p, 7, CRIMSON.clone().multiplyScalar(0.35), 0.7, 1.5, 0.6);
        ctx.effects.sparks(p.clone().setY(p.y + 1), 40, CRIMSON, 5, 0.7);
        const sp = ctx.effects.spell;
        sp.energyBurst(p.clone().setY(p.y + 1), 1.5, new THREE.Color(1.8, 0.12, 0.06), new THREE.Color(0.3, 0.0, 0.02), 12, 0);
        // A mist of blood rolling out with the blast.
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          sp.puff({ pos: p.clone().setY(p.y + 0.6).addScaledVector(d, 0.5), vel: d.multiplyScalar(14 + Math.random() * 6).setY(0.6), life: 1 + Math.random() * 0.5, size: 0.8, size1: 1.9, color: new THREE.Color(0.16, 0.008, 0.008), color1: new THREE.Color(0.08, 0.015, 0.015), alpha: 0.5, lit: 1, erode: 0.85, drag: 3.2 });
        }
        let total = 0;
        for (const m of this.near(ctx, p, 7)) total += this.strike(m, ctx, SK.novaMult(r));
        if (this.stats.has('novaPool')) {
          fx.pool(p, 3.2, new THREE.Color(0.32, 0.01, 0.01), 4);
          ctx.effects.skill.stoneRing(p, 3.3, 4);
          ctx.effects.skill.rune(p, 3.6, 4, 'blood');
          this.zone(p, 3.2, 4, 0.5, (at, c2) => {
            for (const m of this.near(c2, at, 3.2)) this.dot(m, 'bleed', SK.novaPoolBleed, 1.2);
          }, (dt, at, left, c2) => {
            if (Math.random() < dt * 8 * Math.min(1, left)) {
              const a = Math.random() * Math.PI * 2;
              const rr = Math.sqrt(Math.random()) * 3;
              c2.effects.mote(at.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0.05, Math.sin(a) * rr)), new THREE.Vector3(0, 0.9 + Math.random(), 0), 0.9, 0.08, CRIMSON.clone().multiplyScalar(0.6), true);
            }
          });
        }
        if (this.stats.has('novaEcho')) {
          let t = 0;
          this.tickers.push((dt, c2) => {
            t += dt;
            if (t < 0.6) return true;
            const q = this.position.clone();
            audio.blast(q, 'blood', 0.9);
            c2.effects.shockwave(q, 7, new THREE.Color(1.1, 0.08, 0.05));
            fx.nova(q, 7, CRIMSON.clone().multiplyScalar(0.25), 0.6, 1.0, 0.6);
            c2.effects.spell.energyBurst(q.clone().setY(q.y + 1), 1.2, new THREE.Color(1.6, 0.1, 0.05), new THREE.Color(0.3, 0, 0.02), 10, 0);
            c2.effects.sparks(q.clone().setY(q.y + 1), 24, CRIMSON, 4.5, 0.6);
            for (const m of this.near(c2, q, 7)) this.strike(m, c2, SK.novaMult(r) * SK.novaEchoMult);
            return false;
          });
        }
        const heal = Math.round(total * SK.novaHeal(r));
        if (heal > 0) {
          s.hp = Math.min(s.maxHp, s.hp + heal);
          ctx.floaters.spawn(`+${heal}`, p.clone().setY(p.y + 2.1), 'heal');
        }
      }
    });
  }

  /** Lasting skill effects: whirlwind hits, consecrated ground, War Cry wearing off. */
  private tickSkills(dt: number, ctx: PlayerContext) {
    if (this.castLeft > 0) {
      this.castLeft -= dt;
      if (this.castLeft <= 0) this.endCast();
    }
    if (this.armorLeft > 0) {
      this.armorLeft -= dt;
      if (this.furyOn && Math.random() < dt * 8) ctx.effects.sparks(this.position.clone().setY(this.position.y + 1.0 + Math.random() * 0.6), 1, EMBER, 1.2, 0.5);
      if (this.armorLeft <= 0) {
        this.armorAmount = 0;
        this.furyOn = false;
        this.refreshBuffs();
      }
    }
    this.sanctuaryCd -= dt;
    if (this.phaseLeft > 0) {
      this.phaseLeft -= dt;
      if (Math.hypot(this.position.x - this.phaseAt.x, this.position.z - this.phaseAt.z) < 2.2 && Math.random() < dt * 20) ctx.effects.spell.puff({ pos: this.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8)), vel: new THREE.Vector3(0, 0.5, 0), life: 0.5, size: 0.3, size1: 0.6, color: new THREE.Color(1.0, 0.6, 2.2), color1: new THREE.Color(0.2, 0.05, 0.6), alpha: 0.5, add: 1, erode: 0.9 });
    }
    const ice = this.iceArmor;
    if (ice) {
      ice.left -= dt;
      ice.cd -= dt;
      ice.tick(dt, ctx);
      if (ice.left <= 0) {
        this.iceArmor = null;
        this.refreshBuffs();
      }
    }
    if (this.dash) this.dashTick(dt);
    this.tickDots(dt, ctx);
    const w = this.whirl;
    if (w && !this.dead) {
      w.left -= dt;
      w.next -= dt;
      if (w.next <= 0) {
        w.next += 0.3;
        audio.whoosh(this.position, 0.9);
        ctx.effects.slash(this.position.clone().setY(this.position.y + 1.0), this.yaw + Math.random() * 6, 2.5, new THREE.Color(1.7, 0.75, 0.45), true);
        ctx.effects.spell.dust(this.position, 1.3, 8, undefined, 0.7);
        ctx.effects.sparks(this.position.clone().setY(this.position.y + 0.9), 8, EMBER, 4.5, 0.3);
        const gyre = this.stats.has('whirlGyre');
        for (const m of this.near(ctx, this.position, 2.4)) {
          this.strike(m, ctx, w.mult);
          if (gyre && m.alive) {
            this.dot(m, 'bleed', SK.gyreBleed, SK.bleedTime);
            ctx.effects.blood(m.position.clone().setY(m.position.y + m.height * 0.6), this.position, 10, m.def.blood, 1.2);
          }
        }
        if (this.stats.has('whirlVortex')) {
          // The storm drags everything nearby in toward the hero.
          for (const m of this.near(ctx, this.position, 5)) {
            const d = this.position.clone().sub(m.position).setY(0);
            if (d.length() > 1.3) this.push(m, d, Math.min(0.7, d.length() - 1.2));
          }
          const sp = ctx.effects.spell;
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            const rr = 3 + Math.random() * 2;
            const at = this.position.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0.3, Math.sin(a) * rr));
            const inward = this.position.clone().sub(at).setY(0).normalize();
            const tang = new THREE.Vector3(-inward.z, 0, inward.x);
            sp.puff({ pos: at, vel: inward.multiplyScalar(4).addScaledVector(tang, 5).setY(0.6), life: 0.7, size: 0.5, size1: 1.1, color: new THREE.Color(0.06, 0.045, 0.035), alpha: 0.45, lit: 1, erode: 0.85, drag: 1.5 });
          }
        }
      }
    }
    for (let i = this.tickers.length - 1; i >= 0; i--) if (!this.tickers[i](dt, ctx)) this.tickers.splice(i, 1);
    for (let i = this.consecrations.length - 1; i >= 0; i--) {
      const z = this.consecrations[i];
      z.left -= dt;
      z.next -= dt;
      if (z.follow) z.at.copy(this.position);
      ctx.effects.spell.rising(z.at, z.radius, new THREE.Color(1.8, 1.3, 0.4), new THREE.Color(0.5, 0.25, 0.03), dt, 16 * Math.min(1, z.left));
      if (z.smite !== undefined && !this.dead) {
        z.smite -= dt;
        if (z.smite <= 0) {
          z.smite += 1;
          const inside = this.near(ctx, z.at, z.radius);
          const m = inside[Math.floor(Math.random() * inside.length)];
          if (m) {
            ctx.effects.skill.lightShaft(m.position, 8, 0.45, 0.4);
            ctx.effects.flash(m.position.clone().setY(m.position.y + 1.5), 0xffe0a0, 16, 6, 0.3);
            ctx.effects.sparks(m.position.clone().setY(m.position.y + 0.3), 16, GOLD, 3, 0.5);
            ctx.effects.spell.energyBurst(m.position.clone().setY(m.position.y + 0.8), 0.8, new THREE.Color(2.8, 2.1, 0.8), new THREE.Color(0.6, 0.35, 0.05), 6, 10);
            audio.boltHit(m.position);
            this.strike(m, ctx, SK.smiteMult);
          }
        }
      }
      if (z.next <= 0 && !this.dead) {
        z.next += 0.5;
        for (const m of this.near(ctx, z.at, z.radius)) this.strike(m, ctx, z.mult);
        const s = this.stats;
        if (Math.hypot(this.position.x - z.at.x, this.position.z - z.at.z) < z.radius && s.hp < s.maxHp) {
          s.hp = Math.min(s.maxHp, s.hp + s.maxHp * z.heal);
          ctx.effects.sparks(this.position.clone().setY(this.position.y + 0.4), 6, GOLD, 1.2, 0.6);
        }
      }
      if (z.left <= 0) this.consecrations.splice(i, 1);
    }
  }

  // ---- Statuses, buffs and lasting ground effects shared by the skills ----

  /** Ends every running buff (before a respec, so no skill outlives its ranks). */
  clearBuffs() {
    this.armorLeft = 0;
    this.furyOn = false;
    this.iceArmor = null;
    this.phaseLeft = 0;
    this.cooldowns.clear();
    this.refreshBuffs();
  }

  /** War Cry's armour and Battle Fury, Ice Armour: fold whatever is running into the hero's numbers. */
  refreshBuffs() {
    const s = this.stats;
    s.armorBuff = (this.armorLeft > 0 ? this.armorAmount : 0) + (this.iceArmor ? this.iceArmor.amount : 0);
    s.speedBuff = this.armorLeft > 0 && this.furyOn ? SK.furySpeed : 0;
    s.recompute();
  }

  /** Sets a monster bleeding or burning for `secs`, `dps` weapon damage a second (the stronger wound wins). */
  dot(m: Monster, kind: 'bleed' | 'burn', dps: number, secs: number) {
    if (!m.alive || dps <= 0) return;
    const d = this.dots.find((x) => x.m === m && x.kind === kind);
    if (d) {
      d.dps = Math.max(d.dps, dps);
      d.left = Math.max(d.left, secs);
    } else this.dots.push({ m, kind, dps, left: secs, next: 0.5 });
  }

  bleeding(m: Monster) {
    return this.dots.some((d) => d.m === m && d.kind === 'bleed' && d.left > 0);
  }

  /** Ignite: a fire spell's hit sets the foe burning. */
  ignite(m: Monster) {
    const r = this.stats.rank('ignite');
    if (r > 0) this.dot(m, 'burn', SK.ignite(r), 3);
  }

  /** Chills, lengthened by Absolute Zero. */
  chillM(m: Monster, secs: number) {
    m.chill(secs * (this.stats.has('absoluteZero') ? SK.zeroChill : 1));
  }

  /** Freezes solid (a stun with the frozen look), lengthened by Absolute Zero. */
  freezeM(m: Monster, secs: number) {
    const k = this.stats.has('absoluteZero') ? SK.zeroChill : 1;
    if (!m.alive) return false;
    const took = m.stun(secs * k);
    m.chill((secs + 2) * k);
    return took;
  }

  /** Shoves a monster along the ground by up to `dist` metres, stopping at walls. */
  push(m: Monster, dir: THREE.Vector3, dist: number) {
    if (!m.alive || m.spawn.boss || !this.area) return;
    const d = dir.clone().setY(0);
    if (d.lengthSq() < 1e-6) return;
    d.normalize();
    const nav = this.area.nav;
    const steps = Math.ceil(dist / 0.2);
    for (let i = 0; i < steps; i++) {
      const nx = m.position.x + d.x * (dist / steps);
      const nz = m.position.z + d.z * (dist / steps);
      if (!nav.walkable(nx, nz)) break;
      m.position.x = nx;
      m.position.z = nz;
    }
    m.position.y = this.area.heightAt(m.position.x, m.position.z);
  }

  /**
   * A patch of ground that does something every `every` seconds for `dur`
   * seconds (`pulse`), with a per-frame `frame` for its look. `at` may be a
   * function to make the patch move (a storm that follows the hero).
   */
  zone(at: THREE.Vector3 | (() => THREE.Vector3), radius: number, dur: number, every: number, pulse: (at: THREE.Vector3, ctx: PlayerContext) => void, frame?: (dt: number, at: THREE.Vector3, left: number, ctx: PlayerContext) => void) {
    let left = dur;
    let next = Math.min(0.15, every);
    void radius;
    this.tickers.push((dt, c) => {
      left -= dt;
      next -= dt;
      const p = typeof at === 'function' ? at() : at;
      frame?.(dt, p, left, c);
      if (next <= 0 && !this.dead) {
        next += every;
        pulse(p, c);
      }
      return left > 0;
    });
  }

  /** Ground cracked open and burning (Molten Landing, Burning Ground, burning craters). */
  moltenGround(at: THREE.Vector3, radius: number, dur: number, tick: number, tongues = true) {
    const ctx = this.lastCtx;
    if (!ctx) return;
    ctx.effects.spell.decal('scorch', at.x, at.z, radius * 1.1, dur + 2, 1);
    const look = ctx.effects.skill.burningRing(at, radius, dur, tongues);
    this.zone(at, radius, dur, 0.5, (p, c) => {
      for (const m of this.near(c, p, radius)) {
        this.strike(m, c, tick, 'burn');
        this.ignite(m);
      }
    }, (dt, _p, left) => look(dt, left / dur));
  }

  /** Moves the hero along a straight dash (Lunge), calling `step` with each new spot. */
  private dashTick(dt: number) {
    const d = this.dash!;
    const area = this.area!;
    d.t += dt;
    const k = Math.min(1, d.t / d.dur);
    const e = 1 - Math.pow(1 - k, 2);
    this.position.x = THREE.MathUtils.lerp(d.from.x, d.to.x, e);
    this.position.z = THREE.MathUtils.lerp(d.from.z, d.to.z, e);
    this.position.y = area.heightAt(this.position.x, this.position.z);
    d.step(this.position);
    if (k >= 1) {
      const land = d.land;
      this.dash = null;
      land();
    }
  }

  /** Bleeds and burns: a tick of damage every half second, and their marks on the foe meanwhile. */
  private tickDots(dt: number, ctx: PlayerContext) {
    const feast = this.stats.has('hemoFeast');
    for (let i = this.dots.length - 1; i >= 0; i--) {
      const d = this.dots[i];
      const m = d.m;
      if (!m.alive || d.left <= 0) {
        this.dots.splice(i, 1);
        continue;
      }
      d.left -= dt;
      d.next -= dt;
      if (d.kind === 'burn') ctx.effects.skill.burnOn(m.position, m.height, m.radius, dt);
      else ctx.effects.skill.bleedOn(m.position, m.height, m.radius, dt);
      if (d.next <= 0 && !this.dead) {
        d.next += 0.5;
        const dealt = this.strike(m, ctx, d.dps * 0.5, d.kind);
        if (feast && d.kind === 'bleed' && dealt > 0) {
          const s = this.stats;
          s.hp = Math.min(s.maxHp, s.hp + dealt * SK.feastHeal);
          if (Math.random() < 0.5) ctx.effects.skill.bloodStream(m.position.clone().setY(m.position.y + m.height * 0.6), this.position.clone().setY(this.position.y + 1.1), 4);
        }
      }
    }
  }

  drinkPotion(ctx: PlayerContext): boolean {
    if (this.dead || this.stats.potions <= 0 || this.potionCd > 0 || this.stats.hp >= this.stats.maxHp) return false;
    this.stats.potions--;
    telemetry.potion();
    this.potionCd = 0.8;
    const heal = Math.round(this.stats.maxHp * (0.45 + SK.secondWindPotion(this.stats.rank('secondWind'))));
    this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + heal);
    audio.potion();
    ctx.floaters.spawn(`+${heal}`, this.position.clone().setY(this.position.y + 2.1), 'heal');
    ctx.effects.sparks(this.position.clone().setY(this.position.y + 1.0), 24, new THREE.Color(2.4, 0.3, 0.2), 1.6, 0.9);
    return true;
  }

  takeDamage(amount: number, crit: boolean, from: THREE.Vector3): number {
    if (this.dead) return 0;
    const s = this.stats;
    // Sanctuary and Phase Shift soften the blow before armour.
    const warded = this.phaseLeft > 0 && Math.hypot(this.position.x - this.phaseAt.x, this.position.z - this.phaseAt.z) < 2.2;
    const softened = amount * s.dmgTaken * (warded ? 1 - SK.phaseCut : 1);
    // Sanctuary: a golden shield flashes up toward the blow.
    if (s.rank('sanctuary') > 0 && this.sanctuaryCd <= 0 && this.lastCtx) {
      this.sanctuaryCd = 1;
      const dir = from.clone().sub(this.position).setY(0);
      if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      dir.normalize();
      const at = this.position.clone().setY(this.position.y + 1.1).addScaledVector(dir, 0.65);
      this.lastCtx.effects.skill.shieldFlash(at, at.clone().addScaledVector(dir, 2));
    }
    let dealt = mitigateHero(softened, s.armor, s.level);
    // Mana Shield: part of the blow drains mana instead of life.
    const share = SK.manaShield(s.rank('manaShield'));
    if (share > 0 && s.mana > 0) {
      const absorb = Math.min(s.mana, Math.round(dealt * share));
      s.mana -= absorb;
      dealt -= absorb;
      if (absorb > 0 && this.lastCtx) this.lastCtx.effects.spell.energyBurst(this.position.clone().setY(this.position.y + 1.1), 0.6, new THREE.Color(0.9, 0.6, 2.4), new THREE.Color(0.15, 0.05, 0.5), 5, 6);
    }
    if (this.iceArmor && this.lastCtx) this.iceStruck(from, this.lastCtx);
    this.stats.hp -= dealt;
    void crit;
    if (this.stats.hp <= 0) {
      this.stats.hp = 0;
      this.dead = true;
      this.path = [];
      this.target = null;
      this.pending = null;
      this.swinging = false;
      this.endCast();
      this.iceArmor = null;
      this.armorLeft = 0;
      this.phaseLeft = 0;
      this.refreshBuffs();
      this.character.cancelAction();
      collapse(this.character, false);
      audio.playerDie();
    } else if (dealt > this.stats.maxHp * 0.12 && !this.swinging && this.hurtCd <= 0) {
      this.hurtCd = 0.8;
      const c = this.character;
      c.play(0.3, (k) => {
        const s = Math.sin(k * Math.PI) * 0.3;
        c.spine.rotation.x -= s;
        c.head.rotation.x -= s;
      });
    }
    return dealt;
  }

  /** Ice Armour answering a blow: the attacker is chilled, and with Frost Retaliation the stars burst out. */
  private iceStruck(from: THREE.Vector3, ctx: PlayerContext) {
    const ice = this.iceArmor!;
    let best: Monster | null = null;
    let bd = 3;
    for (const m of ctx.monsters) {
      if (!m.alive) continue;
      const d = Math.hypot(m.position.x - from.x, m.position.z - from.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best) {
      this.chillM(best, 3);
      ctx.effects.spell.glitter(best.position.clone().setY(best.position.y + best.height * 0.5), 0.4, 14, 1.6);
    }
    if (ice.retaliate && ice.cd <= 0) {
      ice.cd = 1.5;
      const at = this.position.clone();
      audio.iceShatter(at, 0.9);
      ctx.effects.skill.starBurst(at.clone().setY(at.y + 0.9), 2.2);
      for (const m of this.near(ctx, at, 3)) {
        this.strike(m, ctx, SK.retaliateMult);
        this.freezeM(m, 0.8);
      }
    }
  }

  /** Brings the hero back to life (after dying) at full strength. */
  revive() {
    this.dead = false;
    this.stats.hp = this.stats.maxHp;
    this.stats.mana = this.stats.maxMana;
    const c = this.character;
    c.cancelAction();
    c.body.rotation.set(0, 0, 0);
    c.body.position.set(0, 0, 0);
    for (const a of c.arms) a.upper.rotation.z = a.side * 0.12;
  }

  /**
   * Hits a monster with the sword's damage times `mult`; returns the damage
   * dealt. `dot` marks a bleed or burn tick: it can't crit and makes less fuss.
   */
  strike(m: Monster, ctx: PlayerContext, mult = 1, dot?: 'bleed' | 'burn'): number {
    const s = this.stats;
    // Keystones, Executioner, Exsanguinate and Absolute Zero.
    mult *= s.dmgMore;
    const exec = SK.executioner(s.rank('executioner'));
    if (exec > 0 && m.hp < m.maxHp * SK.executeBelow) mult *= 1 + exec;
    const exs = SK.exsanguinate(s.rank('exsanguinate'));
    const wasBleeding = this.bleeding(m);
    if (exs > 0 && wasBleeding) mult *= 1 + exs;
    if (s.has('absoluteZero') && m.chilled > 0) mult *= 1 + SK.zeroDmg;
    const roll = rollDamage(s.dmgMin * mult, s.dmgMax * mult, dot ? 0 : s.crit);
    const dealt = m.takeDamage(roll.amount, roll.crit, this.position);
    if (dealt <= 0) return 0;
    telemetry.dealt(m, dealt);
    const at = m.position.clone().setY(m.position.y + m.height * 0.6);
    if (!dot) audio.hit(at, roll.crit, m.kind === 'crawler');
    ctx.floaters.spawn(String(dealt), at.clone().setY(at.y + m.height * 0.45), roll.crit ? 'crit' : '');
    if (dot !== 'burn') ctx.effects.blood(at, this.position, dot ? 5 : roll.crit ? 30 : 16, m.def.blood, roll.crit ? 1.3 : dot ? 0.5 : 1);
    if (s.lifeSteal > 0) {
      // Leech pays out of a pool that refills with time, so it can't out-heal a fight.
      const heal = Math.min(dealt * s.lifeSteal, this.leechPool);
      this.leechPool -= heal;
      s.hp = Math.min(s.maxHp, s.hp + heal);
    }
    if (!m.alive) {
      ctx.effects.blood(at, this.position, 40, m.def.blood, 1.5);
      ctx.effects.splat(m.position.x, m.position.z, m.radius * 4.2);
      // Contagion: a foe that dies bleeding passes its wounds on.
      const bleed = this.dots.find((d) => d.m === m && d.kind === 'bleed' && d.left > 0);
      if (bleed && s.has('hemoContagion')) {
        for (const o of this.near(ctx, m.position, 3.5)) {
          if (o === m) continue;
          this.dot(o, 'bleed', bleed.dps, SK.bleedTime);
          ctx.effects.skill.bloodStream(at, o.position.clone().setY(o.position.y + o.height * 0.6), 8);
        }
        ctx.effects.spell.energyBurst(at, 0.9, new THREE.Color(1.8, 0.12, 0.06), new THREE.Color(0.3, 0, 0.02), 8, 0);
      }
      ctx.onKill(m);
    }
    return dealt;
  }

  private startSwing(m: Monster, ctx: PlayerContext) {
    this.swinging = true;
    if (this.stats.cls.attack === 'ranged') {
      staffBolt(this, m, ctx);
      const end = this.stats.swingTime;
      let t = 0;
      this.swingTick = (dt) => (t += dt) >= end;
      return;
    }
    const c = this.character;
    const back = this.swingIndex++ % 2 === 1;
    // Forehand: up and out to the right, down across the body. Backhand mirrors it.
    const keys = back
      ? [
          { k: 0, uR: -0.1, fR: -0.55, zR: 0.12, t: 0, s: 0 },
          { k: 0.35, uR: -1.9, fR: -1.4, zR: -0.6, t: -0.5, s: -0.05 },
          { k: 0.55, uR: -1.2, fR: -0.2, zR: 1.0, t: 0.55, s: 0.2 },
          { k: 1, uR: -0.1, fR: -0.55, zR: 0.12, t: 0, s: 0 },
        ]
      : [
          { k: 0, uR: -0.1, fR: -0.55, zR: 0.12, t: 0, s: 0 },
          { k: 0.35, uR: -2.6, fR: -1.2, zR: 0.85, t: 0.5, s: -0.12 },
          { k: 0.55, uR: -0.8, fR: -0.25, zR: -0.4, t: -0.6, s: 0.28 },
          { k: 1, uR: -0.1, fR: -0.55, zR: 0.12, t: 0, s: 0 },
        ];
    keyedAction(
      c,
      this.stats.swingTime,
      keys,
      0.5,
      () => {
        if (this.dead) return;
        audio.swing();
        ctx.effects.slash(this.position.clone().setY(this.position.y + 1.05), this.yaw, 1.8, new THREE.Color(1.5, 0.85, 0.65));
        const d = Math.hypot(m.position.x - this.position.x, m.position.z - this.position.z);
        if (m.alive && d <= this.reach(m) + 0.6) this.strike(m, ctx);
      },
    );
    // keyedAction's own completion doesn't tell us; track the end ourselves.
    const end = this.stats.swingTime;
    let t = 0;
    const tick = (dt: number) => {
      t += dt;
      return t >= end;
    };
    this.swingTick = tick;
  }
  private swingTick: ((dt: number) => boolean) | null = null;

  update(dt: number, ctx: PlayerContext) {
    const area = this.area;
    if (!area) return;
    this.lastCtx = ctx;
    if (this.queued && !this.swinging && !this.dead) {
      const id = this.queued;
      this.queued = null;
      this.cast(id, ctx);
    }
    for (const [id, t] of this.cooldowns) if (t > 0) this.cooldowns.set(id, t - dt);
    this.bfx?.tick(dt);
    this.tickSkills(dt, ctx);
    this.potionCd -= dt;
    this.hurtCd -= dt;
    const s = this.stats;
    if (this.dead) {
      this.character.update(dt, 0);
      return;
    }
    s.hp = Math.min(s.maxHp, s.hp + s.regen * dt);
    this.leechPool = Math.min(s.maxHp * LEECH_RESERVE, this.leechPool + s.maxHp * LEECH_PER_SEC * dt);
    s.mana = Math.min(s.maxMana, s.mana + s.manaRegen * dt);
    if (this.swingTick && this.swingTick(dt)) {
      this.swingTick = null;
      this.swinging = false;
    }

    const pos2 = new THREE.Vector2(this.position.x, this.position.z);
    // Attack target: close in, then swing (again while held).
    if (this.target) {
      const m = this.target;
      if (!m.alive) {
        this.target = null;
      } else {
        const d = Math.hypot(m.position.x - pos2.x, m.position.z - pos2.y);
        if (d <= this.reach(m)) {
          this.path = [];
          this.faceToward(m.position, dt, 18);
          if (!this.swinging) {
            this.startSwing(m, ctx);
            if (!this.holdAttack) this.target = null; // one swing per click
          }
        } else if (!this.swinging && (this.path.length === 0 || Math.random() < dt * 4)) {
          this.path = area.nav.findPath(pos2, new THREE.Vector2(m.position.x, m.position.z)) ?? [];
        }
      }
    }
    if (this.pending && !this.swinging) {
      const t = this.pending.target;
      const d = Math.hypot(t.x - pos2.x, t.z - pos2.y);
      // Something tucked against a wall: once the walk has ended as close as
      // the floor allows, reach a little further for it.
      const stuck = this.path.length === 0 && d <= this.pending.radius + 1.6 && !area.nav.walkable(t.x, t.z);
      if (d <= this.pending.radius || stuck) {
        const act = this.pending.onReach;
        this.pending = null;
        this.path = [];
        this.yaw = Math.atan2(t.x - pos2.x, t.z - pos2.y);
        act();
      }
    }
    let desired = new THREE.Vector2();
    if (this.whirl) {
      // Whirlwind drifts toward the cursor.
      const to = new THREE.Vector2(this.aim.x - pos2.x, this.aim.z - pos2.y);
      const d = to.length();
      if (d > 0.4) desired = to.multiplyScalar(Math.min(3.6, d * 3) / d);
    } else if (!this.swinging) {
      while (this.path.length) {
        const next = this.path[0];
        const toNext = next.clone().sub(pos2);
        const d = toNext.length();
        if (d < 0.15 || (this.path.length > 1 && d < 0.6)) {
          this.path.shift();
          continue;
        }
        const speed = this.path.length === 1 && !this.target ? Math.min(this.maxSpeed, d * 3.5) : this.maxSpeed;
        desired = toNext.multiplyScalar(speed / d);
        break;
      }
    }
    // Shoulder past monsters instead of walking through them.
    for (const m of ctx.monsters) {
      if (!m.alive) continue;
      const dx = this.position.x - m.position.x;
      const dz = this.position.z - m.position.z;
      const d = Math.hypot(dx, dz);
      const min = this.radius + m.radius;
      if (d > 0.001 && d < min) desired.add(new THREE.Vector2(dx / d, dz / d).multiplyScalar((min - d) * 10));
    }
    this.velocity.lerp(desired, 1 - Math.exp(-dt * 9));
    const step = this.velocity.clone().multiplyScalar(dt);
    // A blow strong enough to throw the hero (a wing gust, a charge) slides them back.
    if (this.shove.lengthSq() > 0.01) {
      step.addScaledVector(this.shove, dt);
      this.shove.multiplyScalar(Math.exp(-dt * 5));
    }
    const nx = this.position.x + step.x;
    const nz = this.position.z + step.y;
    if (area.nav.walkable(nx, nz)) {
      this.position.x = nx;
      this.position.z = nz;
    } else if (area.nav.walkable(nx, this.position.z)) this.position.x = nx;
    else if (area.nav.walkable(this.position.x, nz)) this.position.z = nz;
    else {
      this.velocity.set(0, 0);
      this.path = [];
    }
    this.position.y = area.heightAt(this.position.x, this.position.z);
    if (this.leap) this.leapTick(dt, area);

    const speed = this.velocity.length();
    if (speed > 0.2 && !this.swinging) {
      const targetYaw = Math.atan2(this.velocity.x, this.velocity.y);
      let diff = targetYaw - this.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * (1 - Math.exp(-dt * 12));
    }
    this.character.update(dt, this.swinging ? 0 : speed);
    this.syncTransform();

    this.markerAge += dt;
    this.marker.visible = this.markerAge < 0.6;
    if (this.marker.visible) {
      const t = this.markerAge / 0.6;
      this.marker.scale.setScalar(1 + t * 0.8);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
  }

  private shove = new THREE.Vector2();

  /** Throws the hero along `dir` (ground plane), about `metres` far. */
  knock(dir: THREE.Vector2, metres: number) {
    if (this.dead) return;
    this.shove.copy(dir).normalize().multiplyScalar(metres * 5);
    this.path = [];
  }

  faceToward(p: THREE.Vector3, dt: number, rate = 12) {
    const target = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    let diff = target - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * (1 - Math.exp(-dt * rate));
  }

  /** Whirlwind follows the cursor while it lasts. */
  get busyAiming() {
    return this.whirl !== null;
  }

  get facingYaw() {
    return this.yaw;
  }

  private syncTransform() {
    this.character.root.position.copy(this.position);
    this.character.root.position.y += this.lift;
    this.character.root.rotation.y = this.yaw;
  }
}
