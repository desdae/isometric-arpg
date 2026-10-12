import * as THREE from 'three';
import { audio } from '../audio/Audio';
import type { Character } from './Character';
import type { NavGrid } from '../world/NavGrid';
import type { HeightFn } from '../procgen/terrain';
import type { Combatant, FloatingText } from '../game/Combat';
import { mitigate, rollDamage } from '../game/Combat';
import type { Effects } from '../game/Effects';
import type { Stats } from '../game/Stats';
import type { Monster } from './Monster';
import { collapse, keyedAction } from './monsters/humanoid';

// The hero: click-to-move along the nav grid, walk up to things to interact,
// sword swings at a target (repeating while the button is held), a spinning
// cleave that costs mana, potions, life and death.

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

export const CLEAVE_COST = 18;

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
  private queuedCleave = false;
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
    this.queuedCleave = false;
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
    return 1.35 + m.radius + this.radius * 0.5;
  }

  /** Spinning cleave hitting everything around the hero. Returns false if not enough mana. */
  cleave(ctx: PlayerContext): boolean {
    if (this.dead) return true;
    if (this.stats.mana < CLEAVE_COST) return false;
    // Mid-swing: remember the order and spin as soon as the swing ends.
    if (this.swinging) {
      this.queuedCleave = true;
      return true;
    }
    this.queuedCleave = false;
    this.stats.mana -= CLEAVE_COST;
    this.path = [];
    this.pending = null;
    this.swinging = true;
    const c = this.character;
    let hit = false;
    const startYaw = this.yaw;
    c.play(
      0.55,
      (k) => {
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
          for (const m of ctx.monsters) {
            if (!m.alive) continue;
            const d = Math.hypot(m.position.x - this.position.x, m.position.z - this.position.z);
            if (d < 2.5 + m.radius) this.strike(m, ctx, 1.25);
          }
        }
      },
      () => {
        c.body.rotation.y = 0;
        c.arm(1).upper.rotation.z = 0.12;
        this.swinging = false;
      },
    );
    return true;
  }

  drinkPotion(ctx: PlayerContext): boolean {
    if (this.dead || this.stats.potions <= 0 || this.potionCd > 0 || this.stats.hp >= this.stats.maxHp) return false;
    this.stats.potions--;
    this.potionCd = 0.8;
    const heal = Math.round(this.stats.maxHp * 0.45);
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

  private strike(m: Monster, ctx: PlayerContext, mult = 1) {
    const s = this.stats;
    const roll = rollDamage(s.dmgMin * mult, s.dmgMax * mult, s.crit);
    const dealt = m.takeDamage(roll.amount, roll.crit, this.position);
    if (dealt <= 0) return;
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
    if (this.queuedCleave && !this.swinging && !this.dead) {
      this.queuedCleave = false;
      this.cleave(ctx);
    }
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
    if (!this.swinging) {
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

  faceToward(p: THREE.Vector3, dt: number, rate = 12) {
    const target = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    let diff = target - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * (1 - Math.exp(-dt * rate));
  }

  get facingYaw() {
    return this.yaw;
  }

  private syncTransform() {
    this.character.root.position.copy(this.position);
    this.character.root.rotation.y = this.yaw;
  }
}
