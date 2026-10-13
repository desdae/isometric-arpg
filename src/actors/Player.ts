import * as THREE from 'three';
import { audio } from '../audio/Audio';
import type { Character } from './Character';
import type { NavGrid } from '../world/NavGrid';
import type { HeightFn } from '../procgen/terrain';
import type { Combatant, FloatingText } from '../game/Combat';
import { mitigate, rollDamage } from '../game/Combat';
import type { Effects } from '../game/Effects';
import type { Stats } from '../game/Stats';
import { BossFx, prewarmBossFx } from '../game/BossFx';
import { SK, SKILL, type SkillId } from '../game/Skills';
import type { Monster } from './Monster';
import { collapse, keyedAction } from './monsters/humanoid';

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
  private area: Area | null = null;
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
  private consecrations: { at: THREE.Vector3; radius: number; left: number; next: number; mult: number; heal: number }[] = [];
  private armorLeft = 0;
  private bfx: BossFx | null = null;
  private swingIndex = 0;
  private potionCd = 0;
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
    prewarmBossFx(area.scene);
    this.velocity.set(0, 0);
    this.shove.set(0, 0);
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
    return 1.35 + m.radius + this.radius * 0.5;
  }

  /**
   * Uses a skill from the belt, aimed at `this.aim`. Returns why it couldn't
   * (no mana, cooling down) or null once it is under way or queued.
   */
  cast(id: SkillId, ctx: PlayerContext): string | null {
    if (this.dead || !this.area) return null;
    const def = SKILL[id];
    const r = this.stats.rank(id);
    if (!def.active || r <= 0) return 'Not learned';
    if ((this.cooldowns.get(id) ?? 0) > 0) return 'Not ready';
    const cost = def.cost?.(r) ?? 0;
    if (this.stats.mana < cost) return 'Not enough mana';
    // Mid-swing: remember the order and cast as soon as the swing ends.
    if (this.swinging) {
      this.queued = id;
      return null;
    }
    this.queued = null;
    this.stats.mana -= cost;
    const cd = def.cooldown?.(r) ?? 0;
    if (cd > 0) this.cooldowns.set(id, cd);
    this.path = [];
    this.pending = null;
    this.velocity.set(0, 0);
    if (id === 'leapSlam' || id === 'bloodLance' || id === 'whirlwind') {
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

  private fxFor(e: Effects): BossFx {
    if (!this.bfx || this.bfx.fx !== e) this.bfx = new BossFx(e);
    return this.bfx;
  }

  /** Locks the hero into a skill for `dur` seconds; `end` tidies the pose. */
  private busy(dur: number, end?: () => void) {
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
    this.lift = 0;
    if (end) {
      this.swinging = false;
      end();
    }
  }

  private restPose() {
    const c = this.character;
    c.body.rotation.set(0, 0, 0);
    c.body.position.set(0, 0, 0);
    for (const a of c.arms) a.upper.rotation.z = a.side * 0.12;
  }

  private near(ctx: PlayerContext, at: THREE.Vector3, radius: number) {
    return ctx.monsters.filter((m) => m.alive && Math.hypot(m.position.x - at.x, m.position.z - at.z) < radius + m.radius);
  }

  /** Spinning cleave hitting everything around the hero. */
  private doCleave(ctx: PlayerContext, mult: number) {
    const c = this.character;
    let hit = false;
    const startYaw = this.yaw;
    this.busy(0.55, () => this.restPose());
    c.play(0.55, (k) => {
      const e = k < 0.15 ? 0 : Math.min(1, (k - 0.15) / 0.6);
      const spin = e * e * (3 - 2 * e);
      c.body.rotation.y = -spin * Math.PI * 2;
      const w = Math.min(1, k / 0.15, (1 - k) / 0.2);
      const R = c.arm(1);
      R.upper.rotation.z = THREE.MathUtils.lerp(0.12, 1.45, w);
      R.upper.rotation.x = THREE.MathUtils.lerp(R.upper.rotation.x, -0.5, w);
      R.fore.rotation.x = THREE.MathUtils.lerp(R.fore.rotation.x, -0.1, w);
      c.spine.rotation.x += 0.15 * w;
      if (!hit && k >= 0.4) {
        hit = true;
        audio.cleave();
        ctx.effects.slash(this.position.clone().setY(this.position.y + 1.0), startYaw, 2.7, new THREE.Color(1.8, 0.7, 0.45), true);
        for (const m of this.near(ctx, this.position, 2.5)) this.strike(m, ctx, mult);
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
        ctx.effects.addShake(0.45);
        ctx.effects.shockwave(to, 3.4, new THREE.Color(1.2, 0.55, 0.25));
        ctx.effects.flash(to.clone().setY(to.y + 0.6), 0xff7a30, 30, 8, 0.35);
        fx.cracks(to, 3.2, EMBER, 2.4);
        fx.debris(to, 18, 1.1);
        fx.nova(to, 3.2, EMBER, 0.45);
        const stun = SK.leapStun(r);
        for (const m of this.near(ctx, to, 2.8)) {
          this.strike(m, ctx, SK.leapMult(r));
          if (m.alive) m.stun(stun);
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
        fx.nova(at, 6, GOLD, 0.6, 1.3, 0.8);
        ctx.effects.sparks(at.clone().setY(at.y + 1.6), 30, GOLD, 3.5, 0.7);
        const stun = SK.warCryStun(r);
        for (const m of this.near(ctx, at, 6)) {
          m.stun(stun);
          const p = m.position.clone().setY(m.position.y + m.height + 0.3);
          ctx.floaters.spawn('Stunned', p, '');
        }
        this.stats.armorBuff = SK.warCryArmor(r);
        this.stats.recompute();
        this.armorLeft = 8;
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
        ctx.effects.flash(at.clone().setY(at.y + 1.0), 0xffd27a, 24, 8, 0.5);
        this.consecrations.push({ at, radius: 3.5, left: 6, next: 0.1, mult: SK.consecrateMult(r), heal: SK.consecrateHeal(r) });
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
        this.launchLance(ctx, SK.lanceMult(r));
      }
    });
  }

  private launchLance(ctx: PlayerContext, mult: number) {
    const area = this.area!;
    const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const start = this.position.clone().setY(this.position.y + 1.15).addScaledVector(dir, 0.6);
    const obj = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.25, 0.15), fog: false });
    const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.04, 0.02), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const coreGeo = new THREE.ConeGeometry(0.07, 1.3, 8).rotateX(Math.PI / 2);
    const haloGeo = new THREE.ConeGeometry(0.2, 1.8, 10).rotateX(Math.PI / 2).translate(0, 0, -0.2);
    obj.add(new THREE.Mesh(coreGeo, coreMat), new THREE.Mesh(haloGeo, haloMat));
    obj.position.copy(start);
    obj.lookAt(start.clone().add(dir));
    ctx.effects.group.add(obj);
    audio.cast(start);
    const range = 14;
    const speed = 24;
    const hitSet = new Set<Monster>();
    let done = false;
    ctx.effects.after(range / speed, obj, (k) => {
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
      if (Math.random() < 0.9) ctx.effects.mote(p.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.2, (Math.random() - 0.5) * 0.6), 0.45, 0.09, CRIMSON, true);
      for (const m of ctx.monsters) {
        if (!m.alive || hitSet.has(m)) continue;
        if (Math.hypot(m.position.x - p.x, m.position.z - p.z) < m.radius + 0.45) {
          hitSet.add(m);
          this.strike(m, ctx, mult);
          audio.boltHit(p);
          ctx.effects.sparks(p, 12, CRIMSON, 2.2, 0.4);
        }
      }
    }, () => {
      coreGeo.dispose();
      haloGeo.dispose();
      coreMat.dispose();
      haloMat.dispose();
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
        fx.nova(p, 7, CRIMSON, 0.7, 1.5, 0.6);
        ctx.effects.sparks(p.clone().setY(p.y + 1), 40, CRIMSON, 5, 0.7);
        let total = 0;
        for (const m of this.near(ctx, p, 7)) total += this.strike(m, ctx, SK.novaMult(r));
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
      if (this.armorLeft <= 0) {
        this.stats.armorBuff = 0;
        this.stats.recompute();
      }
    }
    const w = this.whirl;
    if (w && !this.dead) {
      w.left -= dt;
      w.next -= dt;
      if (w.next <= 0) {
        w.next += 0.3;
        audio.whoosh(this.position, 0.9);
        ctx.effects.slash(this.position.clone().setY(this.position.y + 1.0), this.yaw + Math.random() * 6, 2.5, new THREE.Color(1.7, 0.75, 0.45), true);
        for (const m of this.near(ctx, this.position, 2.4)) this.strike(m, ctx, w.mult);
      }
    }
    for (let i = this.consecrations.length - 1; i >= 0; i--) {
      const z = this.consecrations[i];
      z.left -= dt;
      z.next -= dt;
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

  drinkPotion(ctx: PlayerContext): boolean {
    if (this.dead || this.stats.potions <= 0 || this.potionCd > 0 || this.stats.hp >= this.stats.maxHp) return false;
    this.stats.potions--;
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
    const dealt = mitigate(amount, this.stats.armor);
    this.stats.hp -= dealt;
    void crit;
    void from;
    if (this.stats.hp <= 0) {
      this.stats.hp = 0;
      this.dead = true;
      this.path = [];
      this.target = null;
      this.pending = null;
      this.swinging = false;
      this.endCast();
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

  /** Hits a monster with the sword's damage times `mult`; returns the damage dealt. */
  private strike(m: Monster, ctx: PlayerContext, mult = 1): number {
    const s = this.stats;
    const roll = rollDamage(s.dmgMin * mult, s.dmgMax * mult, s.crit);
    const dealt = m.takeDamage(roll.amount, roll.crit, this.position);
    if (dealt <= 0) return 0;
    const at = m.position.clone().setY(m.position.y + m.height * 0.6);
    audio.hit(at, roll.crit, m.kind === 'crawler');
    ctx.floaters.spawn(String(dealt), at.clone().setY(at.y + m.height * 0.45), roll.crit ? 'crit' : '');
    ctx.effects.blood(at, this.position, roll.crit ? 30 : 16, m.def.blood, roll.crit ? 1.3 : 1);
    if (s.lifeSteal > 0) s.hp = Math.min(s.maxHp, s.hp + dealt * s.lifeSteal);
    if (!m.alive) {
      ctx.effects.blood(at, this.position, 40, m.def.blood, 1.5);
      ctx.effects.splat(m.position.x, m.position.z, m.radius * 4.2);
      ctx.onKill(m);
    }
    return dealt;
  }

  private startSwing(m: Monster, ctx: PlayerContext) {
    this.swinging = true;
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
    s.mana = Math.min(s.maxMana, s.mana + 3.2 * dt);
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
