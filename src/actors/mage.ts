import * as THREE from 'three';
import { audio } from '../audio/Audio';
import type { BossFx } from '../game/BossFx';
import { crystalMesh } from '../game/SpellFx';
import { SK, type SkillId } from '../game/Skills';
import type { Monster } from './Monster';
import type { Player, PlayerContext } from './Player';

// The mage's spells and staff attack. Everything hits through Player.strike,
// so gear, crits, life steal and kills work exactly as they do for the knight.

const ARCANE = new THREE.Color(1.6, 0.9, 3.2);
const FIRE = new THREE.Color(2.6, 0.9, 0.22);
const EMBER = new THREE.Color(1.9, 0.5, 0.12);
const ICE = new THREE.Color(0.9, 1.9, 2.8);
const FROST = new THREE.Color(0.35, 0.8, 1.4);

const dirOf = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Where spells leave the staff: the crystal, held forward. */
function staffTip(p: Player) {
  return p.position.clone().setY(p.position.y + 1.45).addScaledVector(dirOf(p.facingYaw), 0.55);
}

/** Staff thrust forward, the off hand flung out after it; `fire` runs at the release. */
function thrust(p: Player, dur: number, fire: () => void) {
  const c = p.character;
  let fired = false;
  p.busy(dur, () => p.restPose());
  c.play(dur, (k) => {
    const up = Math.min(1, k / 0.4);
    const out = Math.min(1, (1 - k) / 0.35);
    const R = c.arm(1);
    const L = c.arm(-1);
    R.upper.rotation.x = THREE.MathUtils.lerp(R.upper.rotation.x, -1.35, up * out);
    R.fore.rotation.x = THREE.MathUtils.lerp(R.fore.rotation.x, -0.25, up * out);
    L.upper.rotation.x = THREE.MathUtils.lerp(L.upper.rotation.x, -1.2, up * out);
    L.fore.rotation.x = THREE.MathUtils.lerp(L.fore.rotation.x, -0.15, up * out);
    c.spine.rotation.x += 0.12 * up * out;
    c.spine.rotation.y += -0.25 * up * out;
    if (!fired && k >= 0.45) {
      fired = true;
      fire();
    }
  });
}

/** Staff raised high in both hands, then driven down; `fire` runs as it strikes. */
function invoke(p: Player, dur: number, fire: () => void, at = 0.55) {
  const c = p.character;
  let fired = false;
  p.busy(dur, () => p.restPose());
  c.play(dur, (k) => {
    const up = Math.min(1, k / (at * 0.8));
    const down = THREE.MathUtils.clamp((k - at * 0.85) / 0.15, 0, 1);
    const out = Math.min(1, (1 - k) / 0.3);
    for (const a of c.arms) {
      a.upper.rotation.x = THREE.MathUtils.lerp(a.upper.rotation.x, -2.7 + down * 1.6, up * out);
      a.upper.rotation.z = THREE.MathUtils.lerp(a.upper.rotation.z, a.side * (0.35 - down * 0.2), up * out);
      a.fore.rotation.x = THREE.MathUtils.lerp(a.fore.rotation.x, -0.3, up * out);
    }
    c.spine.rotation.x += (-0.2 * up + down * 0.4) * out;
    c.head.rotation.x -= 0.2 * up * (1 - down) * out;
    if (!fired && k >= at) {
      fired = true;
      fire();
    }
  });
}

interface BoltOpts {
  from: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  range: number;
  color: THREE.Color;
  size: number;
  /** Long thin shard instead of a ball. */
  shard?: boolean;
  /** A churning ball of fire rather than arcane force. */
  fire?: boolean;
  /** Keeps turning toward this monster while it lives. */
  home?: Monster;
  /** Flies through foes, hitting each once, instead of stopping on the first. */
  pierce?: boolean;
  hitRadius?: number;
  onHit: (m: Monster, at: THREE.Vector3) => void;
  /** Where it ended: a wall, a foe (unless piercing) or the end of its range. */
  onEnd?: (at: THREE.Vector3, hit: boolean) => void;
}

/** A glowing projectile with a trail of motes. */
function bolt(p: Player, ctx: PlayerContext, o: BoltOpts) {
  const area = p.area!;
  const sfx = ctx.effects.spell;
  let obj: THREE.Group;
  if (o.shard) {
    obj = new THREE.Group();
    const core = crystalMesh();
    core.castShadow = false;
    core.rotation.x = Math.PI / 2;
    core.position.z = -o.size * 2.5;
    core.scale.set(o.size * 0.9, o.size * 5, o.size * 0.9);
    obj.add(core);
  } else if (o.fire) {
    obj = sfx.orb('fire', o.size * 1.25, new THREE.Color(1.4, 0.45, 0.08));
  } else {
    obj = sfx.orb('arcane', o.size * 1.1, ARCANE.clone().multiplyScalar(0.35));
  }
  const core = obj.userData.core as THREE.Object3D | undefined;
  const pos = o.from.clone();
  const dir = o.dir.clone().setY(0).normalize();
  obj.position.copy(pos);
  obj.lookAt(pos.clone().add(dir));
  ctx.effects.group.add(obj);
  const hit = new Set<Monster>();
  const hitR = o.hitRadius ?? 0.45;
  let travelled = 0;
  let done = false;
  const finish = (at: THREE.Vector3, struck: boolean) => {
    done = true;
    obj.visible = false;
    o.onEnd?.(at, struck);
    return true;
  };
  ctx.effects.after((o.range / o.speed) * 1.6, obj, (_k, dt) => {
    if (done) return true;
    if (o.home?.alive) {
      const want = o.home.position.clone().setY(o.home.position.y + o.home.height * 0.55).sub(pos).setY(0).normalize();
      dir.lerp(want, 1 - Math.exp(-dt * 7)).normalize();
    }
    const step = Math.min(o.speed * dt, o.range - travelled);
    pos.addScaledVector(dir, step);
    travelled += step;
    obj.position.copy(pos);
    obj.lookAt(pos.clone().add(dir));
    if (core) core.rotation.set(core.rotation.x + dt * 5, core.rotation.y + dt * 7, 0);
    if (o.shard) sfx.frostTrail(pos, dir, dt);
    else if (o.fire) {
      sfx.fireTrail(pos, dir, o.size, dt);
      if (Math.random() < 0.5) ctx.effects.mote(pos.clone(), new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random(), (Math.random() - 0.5) * 1.2), 0.5, 0.06, EMBER, true);
    } else sfx.energyTrail(pos, dir, o.size, ARCANE.clone().multiplyScalar(0.55), new THREE.Color(0.3, 0.08, 0.7), dt);
    if (!area.nav.walkable(pos.x, pos.z) && travelled > 0.6) return finish(pos.clone(), false);
    for (const m of ctx.monsters) {
      if (!m.alive || hit.has(m)) continue;
      if (flat(m.position, pos) < m.radius + hitR) {
        hit.add(m);
        o.onHit(m, pos.clone());
        if (!o.pierce) return finish(pos.clone(), true);
      }
    }
    if (travelled >= o.range - 1e-3) finish(pos.clone(), false);
  });
}

/** The basic attack: a bolt of force from the staff that seeks its target. */
export function staffBolt(p: Player, m: Monster, ctx: PlayerContext) {
  thrust(p, p.stats.swingTime * 0.9, () => {
    if (p.dead) return;
    const from = staffTip(p);
    const dir = m.position.clone().sub(from).setY(0);
    audio.whoosh(from, 0.6);
    bolt(p, ctx, {
      from,
      dir,
      speed: 17,
      range: 13,
      color: ARCANE,
      size: 0.1,
      home: m,
      onHit: (t, at) => {
        p.strike(t, ctx, SK.staffMult);
        ctx.effects.sparks(at, 8, ARCANE, 2, 0.35);
        ctx.effects.spell.energyBurst(at, 0.5, ARCANE.clone().multiplyScalar(0.6), new THREE.Color(0.25, 0.05, 0.6), 5, 6);
      },
    });
  });
}

/** Casts one of the mage's skills (mana and cooldown are already paid). */
export function castMage(p: Player, id: SkillId, r: number, ctx: PlayerContext, fx: BossFx) {
  const aimDir = p.aim.clone().sub(p.position).setY(0);
  if (aimDir.lengthSq() < 0.01) aimDir.copy(dirOf(p.facingYaw));
  const speedUp = 1 / (1 + p.stats.attackSpeed);
  switch (id) {
    case 'fireball':
      return thrust(p, 0.5 * speedUp, () => {
        const from = staffTip(p);
        audio.cast(from);
        const burst = (at: THREE.Vector3) => {
          at.y = p.area!.heightAt(at.x, at.z) + 0.6;
          audio.blast(at, 'blood', 0.7);
          ctx.effects.spell.fireBurst(at, 2.2);
          for (const m of p.near(ctx, at, 2.2)) p.strike(m, ctx, SK.fireballMult(r));
        };
        bolt(p, ctx, { from, dir: aimDir, speed: 16, range: 15, color: FIRE, size: 0.2, fire: true, onHit: () => {}, onEnd: (at, struck) => (struck || flat(at, from) > 1) && burst(at) });
      });
    case 'flameWave':
      return thrust(p, 0.55 * speedUp, () => flameWave(p, ctx, aimDir, SK.flameWaveMult(r)));
    case 'meteor': {
      const at = p.aim.clone();
      at.y = p.area!.heightAt(at.x, at.z);
      return invoke(p, 0.7 * speedUp, () => {
        audio.charge(at, 0.8, 'blood');
        // A ring on the ground warns where it will land.
        fx.nova(at, 3.5, EMBER, 0.85, 0.05);
        meteorFall(ctx, at, 0.85, () => meteorLands(p, ctx, fx, at, SK.meteorMult(r)));
      });
    }
    case 'frostNova':
      return invoke(p, 0.6 * speedUp, () => {
        const at = p.position.clone();
        audio.blast(at, 'soul', 1.1);
        ctx.effects.addShake(0.2);
        ctx.effects.flash(at.clone().setY(at.y + 1), 0x8ad8ff, 26, 9, 0.4);
        fx.nova(at, 5, FROST.clone().multiplyScalar(0.3), 0.5, 0.5);
        ctx.effects.spell.frostBurst(at, 5, 26);
        ctx.effects.sparks(at.clone().setY(at.y + 0.5), 24, ICE, 4.5, 0.7);
        const freeze = SK.frostNovaFreeze(r);
        for (const m of p.near(ctx, at, 5)) {
          p.strike(m, ctx, SK.frostNovaMult(r));
          if (m.alive) {
            m.stun(freeze);
            m.chill(freeze + 2);
            ctx.floaters.spawn('Frozen', m.position.clone().setY(m.position.y + m.height + 0.3), '');
          }
        }
      }, 0.5);
    case 'iceShards':
      return thrust(p, 0.45 * speedUp, () => {
        const from = staffTip(p);
        audio.whoosh(from, 1);
        const yaw = Math.atan2(aimDir.x, aimDir.z);
        for (let i = -2; i <= 2; i++) {
          bolt(p, ctx, {
            from,
            dir: dirOf(yaw + i * 0.17),
            speed: 20,
            range: 12,
            color: ICE,
            size: 0.09,
            shard: true,
            onHit: (m, at) => {
              p.strike(m, ctx, SK.shardsMult(r));
              m.chill(1.5);
              ctx.effects.sparks(at, 6, ICE, 2.4, 0.4);
              ctx.effects.spell.glitter(at, 0.2, 10, 1.8);
              ctx.effects.spell.shard(at.clone());
              ctx.effects.spell.shard(at.clone());
            },
            onEnd: (at) => audio.boltHit(at),
          });
        }
      });
    case 'blizzard': {
      const at = p.aim.clone();
      at.y = p.area!.heightAt(at.x, at.z);
      return invoke(p, 0.65 * speedUp, () => blizzard(p, ctx, fx, at, SK.blizzardMult(r)));
    }
    case 'blink':
      return blink(p, ctx, fx, SK.blinkMult(r));
    case 'arcaneBarrage':
      return thrust(p, 0.6 * speedUp, () => barrage(p, ctx, SK.barrageMult(r)));
  }
}

/** A wall of fire rolling forward, burning everything it passes. */
function flameWave(p: Player, ctx: PlayerContext, dir: THREE.Vector3, mult: number) {
  const area = p.area!;
  const d = dir.clone().normalize();
  const side = new THREE.Vector3(d.z, 0, -d.x);
  const start = p.position.clone().addScaledVector(d, 0.8);
  const range = 11;
  const half = 1.7;
  const hit = new Set<Monster>();
  const g = new THREE.Group();
  ctx.effects.group.add(g);
  const sfx = ctx.effects.spell;
  let lastScorch = 0;
  audio.whoosh(start, 1.4);
  audio.cast(start);
  ctx.effects.after(0.75, g, (k, dt) => {
    const front = start.clone().addScaledVector(d, range * k);
    g.position.set(front.x, area.heightAt(front.x, front.z), front.z);
    const fade = Math.min(1, (1 - k) / 0.25, k / 0.1);
    sfx.flameWall(front, side, d, half, dt, Math.max(0.2, fade));
    // A burnt swathe left behind it.
    if (k - lastScorch > 0.12) {
      lastScorch = k;
      sfx.decal('scorch', front.x, front.z, half * 0.9, 4, 0.6);
    }
    for (let i = 0; i < 2; i++) {
      const at = front.clone().addScaledVector(side, (Math.random() - 0.5) * half * 2);
      at.y = area.heightAt(at.x, at.z) + 0.2;
      ctx.effects.mote(at, new THREE.Vector3(0, 1.6 + Math.random(), 0).addScaledVector(d, 2), 0.45, 0.18, FIRE, true);
    }
    for (const m of ctx.monsters) {
      if (!m.alive || hit.has(m)) continue;
      const rel = m.position.clone().sub(front);
      if (Math.abs(rel.dot(d)) < 0.9 + m.radius && Math.abs(rel.dot(side)) < half + m.radius) {
        hit.add(m);
        p.strike(m, ctx, mult);
      }
    }
  });
}

/** A blazing rock dropping out of the sky at a slant, trailing fire and smoke. */
function meteorFall(ctx: PlayerContext, at: THREE.Vector3, dur: number, onLand: () => void) {
  const sfx = ctx.effects.spell;
  const ball = sfx.orb('fire', 0.55, new THREE.Color(1.6, 0.5, 0.1));
  const from = at.clone().add(new THREE.Vector3(-5, 15, -3));
  const dir = at.clone().sub(from).normalize();
  ctx.effects.group.add(ball);
  let landed = false;
  ctx.effects.after(dur, ball, (k, dt) => {
    ball.position.lerpVectors(from, at, k * k);
    (ball.userData.core as THREE.Object3D).rotation.x += dt * 6;
    sfx.fireTrail(ball.position, dir, 0.45, dt);
    sfx.fireTrail(ball.position, dir, 0.3, dt);
    if (!landed && k >= 1) {
      landed = true;
      onLand();
    }
  });
}

function meteorLands(p: Player, ctx: PlayerContext, fx: BossFx, at: THREE.Vector3, mult: number) {
  audio.slam(at, 1.5);
  audio.quake(at, 1.1);
  ctx.effects.addShake(0.55);
  ctx.effects.flash(at.clone().setY(at.y + 1), 0xff6a20, 40, 11, 0.5);
  ctx.effects.spell.fireBurst(at.clone().setY(at.y + 0.6), 3.5, 1.6);
  ctx.effects.spell.dust(at, 3.5, 22, undefined, 1.2);
  fx.nova(at, 3.5, FIRE.clone().multiplyScalar(0.5), 0.6, 0.8);
  fx.cracks(at, 3.2, EMBER, 3);
  fx.debris(at, 26, 1.4);
  ctx.effects.sparks(at.clone().setY(at.y + 0.5), 40, FIRE, 6, 0.8);
  for (const m of p.near(ctx, at, 3.5)) p.strike(m, ctx, mult);
  // The ground keeps burning for a few seconds.
  fx.pool(at, 2.6, new THREE.Color(0.22, 0.05, 0.01), 3);
  let left = 3;
  let next = 0.5;
  p.tickers.push((dt, c) => {
    left -= dt;
    next -= dt;
    c.effects.spell.groundFire(at, 2.3, dt, 30 * Math.min(1, left / 1.5));
    if (Math.random() < 0.4) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * 2.4;
      c.effects.mote(at.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0.1, Math.sin(a) * rr)), new THREE.Vector3(0, 1.4, 0), 0.6, 0.06, EMBER, true);
    }
    if (next <= 0) {
      next += 0.5;
      for (const m of p.near(c, at, 2.6)) p.strike(m, c, mult * 0.12);
    }
    return left > 0;
  });
}

function blizzard(p: Player, _ctx: PlayerContext, fx: BossFx, at: THREE.Vector3, mult: number) {
  const radius = 4;
  const dur = 5;
  audio.blast(at, 'soul', 0.8);
  fx.pool(at, radius, new THREE.Color(0.03, 0.07, 0.11), dur);
  fx.nova(at, radius, FROST.clone().multiplyScalar(0.4), 0.6, 0.3);
  _ctx.effects.spell.decal('frost', at.x, at.z, radius * 1.1, dur + 1);
  _ctx.effects.spell.ring(at, radius, new THREE.Color(0.75, 0.85, 1.0), 0.9, false);
  let left = dur;
  let next = 0.2;
  p.tickers.push((dt, c) => {
    left -= dt;
    next -= dt;
    // Snow and ice falling slantwise through swirling mist.
    c.effects.spell.snow(at, radius, dt);
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius;
      const top = at.clone().add(new THREE.Vector3(Math.cos(a) * rr - 1, 5 + Math.random() * 2, Math.sin(a) * rr));
      c.effects.mote(top, new THREE.Vector3(1.4, -9, 0), 0.6, 0.07, ICE, true);
    }
    if (next <= 0 && !p.dead) {
      next += 0.5;
      audio.whoosh(at, 0.5);
      // Ice crystals keep forming where the storm bites.
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * radius * 0.8;
      c.effects.spell.crystals(at.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr)), 3, 0.5, 0.7, 0.6);
      for (const m of p.near(c, at, radius)) {
        p.strike(m, c, mult);
        m.chill(0.8);
      }
    }
    return left > 0;
  });
}

function blink(p: Player, ctx: PlayerContext, fx: BossFx, mult: number) {
  const area = p.area!;
  const from = p.position.clone();
  const dir = p.aim.clone().sub(from).setY(0);
  const dist = Math.min(8, dir.length());
  dir.normalize();
  let to = from.clone();
  for (let s = dist; s > 0; s -= 0.25) {
    const x = from.x + dir.x * s;
    const z = from.z + dir.z * s;
    if (area.nav.walkable(x, z)) {
      to = new THREE.Vector3(x, area.heightAt(x, z), z);
      break;
    }
  }
  audio.whoosh(from, 1.2);
  ctx.effects.sparks(from.clone().setY(from.y + 1), 20, ARCANE, 3, 0.5);
  ctx.effects.spell.energyBurst(from.clone().setY(from.y + 1), 1, ARCANE.clone().multiplyScalar(0.5), new THREE.Color(0.2, 0.04, 0.5), 14, 18);
  fx.nova(from, 1.4, ARCANE, 0.35, 1.6);
  p.teleport(to);
  audio.boltHit(to);
  ctx.effects.flash(to.clone().setY(to.y + 1), 0xb08cff, 24, 7, 0.3);
  ctx.effects.shockwave(to, 2.5, new THREE.Color(0.9, 0.6, 1.6));
  ctx.effects.spell.energyBurst(to.clone().setY(to.y + 0.8), 1.4, ARCANE.clone().multiplyScalar(0.55), new THREE.Color(0.2, 0.04, 0.5), 18, 24);
  ctx.effects.sparks(to.clone().setY(to.y + 1), 20, ARCANE, 3.5, 0.5);
  for (const m of p.near(ctx, to, 2.5)) p.strike(m, ctx, mult);
  const c = p.character;
  p.busy(0.25, () => p.restPose());
  c.play(0.25, (k) => {
    c.spine.rotation.x += Math.sin(k * Math.PI) * 0.3;
  });
}

/** Ten seeking missiles, loosed one after another at foes near the cursor. */
function barrage(p: Player, _ctx: PlayerContext, mult: number) {
  const aim = p.aim.clone();
  let fired = 0;
  let next = 0;
  p.tickers.push((dt, c) => {
    next -= dt;
    while (next <= 0 && fired < 10) {
      next += 0.08;
      fired++;
      const near = p.near(c, aim, 6);
      const target = near.length ? near[Math.floor(Math.random() * near.length)] : undefined;
      const from = staffTip(p);
      const toward = (target ? target.position : aim).clone().sub(from).setY(0);
      // Each leaves at an angle and curls in.
      const yaw = Math.atan2(toward.x, toward.z) + (Math.random() - 0.5) * 1.6;
      audio.whoosh(from, 0.4);
      bolt(p, c, {
        from,
        dir: dirOf(yaw),
        speed: 15,
        range: 14,
        color: ARCANE,
        size: 0.08,
        home: target,
        onHit: (m, at) => {
          p.strike(m, c, mult);
          c.effects.sparks(at, 6, ARCANE, 2, 0.3);
          c.effects.spell.energyBurst(at, 0.4, ARCANE.clone().multiplyScalar(0.5), new THREE.Color(0.25, 0.05, 0.6), 4, 4);
        },
      });
    }
    return fired < 10 && !p.dead;
  });
}
