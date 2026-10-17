import * as THREE from 'three';
import { audio } from '../audio/Audio';
import type { BossFx } from '../game/BossFx';
import { SK, type SkillId } from '../game/Skills';
import type { Monster } from './Monster';
import type { Player, PlayerContext } from './Player';
import { bolt, dirOf, flat, invoke, staffTip, thrust } from './mage';

// The actives added with the deeper skill trees, one per branch (two for
// Frost): Lunge, Judgement and Hemorrhage for the knight; Fire Wall, Glacial
// Spike, Ice Armour and Arcane Orb for the mage. Each hits through
// Player.strike, so gear, crits, keystones and kills work as everywhere else.

const GOLD = new THREE.Color(2.2, 1.6, 0.55);
const HOLY0 = new THREE.Color(2.8, 2.1, 0.8);
const HOLY1 = new THREE.Color(0.6, 0.35, 0.05);
const CRIMSON = new THREE.Color(2.2, 0.12, 0.08);
const BLOOD0 = new THREE.Color(1.8, 0.12, 0.06);
const BLOOD1 = new THREE.Color(0.3, 0.0, 0.02);
const EMBER = new THREE.Color(1.9, 0.6, 0.2);
const ICE = new THREE.Color(0.9, 1.9, 2.8);
const ARCANE = new THREE.Color(1.6, 0.9, 3.2);
const GHOST = new THREE.Color(0.9, 1.4, 2.4);

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function castDeep(p: Player, id: SkillId, r: number, ctx: PlayerContext, fx: BossFx) {
  const aimDir = p.aim.clone().sub(p.position).setY(0);
  if (aimDir.lengthSq() < 0.01) aimDir.copy(dirOf(p.facingYaw));
  aimDir.normalize();
  const speedUp = 1 / (1 + p.stats.attackSpeed);
  switch (id) {
    case 'lunge':
      return lunge(p, ctx, aimDir, r);
    case 'judgement':
      return judgement(p, ctx, fx, r);
    case 'hemorrhage':
      return hemorrhage(p, ctx, fx, r);
    case 'fireWall': {
      const at = p.aim.clone();
      at.y = p.area!.heightAt(at.x, at.z);
      return invoke(p, 0.6 * speedUp, () => fireWall(p, ctx, at, aimDir, r), 0.5);
    }
    case 'glacialSpike':
      return thrust(p, 0.55 * speedUp, () => glacialSpike(p, ctx, aimDir, r));
    case 'iceArmor':
      return invoke(p, 0.6 * speedUp, () => iceArmor(p, ctx, r), 0.5);
    case 'arcaneOrb':
      return thrust(p, 0.55 * speedUp, () => arcaneOrb(p, ctx, fx, aimDir, r));
  }
}

// ---------------------------------------------------------------- Lunge

/** Drives the knight forward along the aim, blade levelled, hitting everything on the way. */
function lunge(p: Player, ctx: PlayerContext, dir: THREE.Vector3, r: number) {
  const area = p.area!;
  const from = p.position.clone();
  const want = Math.min(SK.lungeRange, Math.max(2.5, flat(p.aim, from) + 1));
  const to = from.clone();
  for (let s = 0.25; s <= want; s += 0.25) {
    const x = from.x + dir.x * s;
    const z = from.z + dir.z * s;
    if (!area.nav.walkable(x, z)) break;
    to.set(x, area.heightAt(x, z), z);
  }
  const dist = flat(from, to);
  const wind = 0.1;
  const dur = 0.12 + dist * 0.03;
  const total = wind + dur + 0.2;
  const mult = SK.lungeMult(r);
  const stun = p.stats.has('lungeStun');
  const hit = new Set<Monster>();
  const sp = ctx.effects.spell;
  const sk = ctx.effects.skill;
  const c = p.character;
  p.busy(total, () => p.restPose());
  c.play(total, (k) => {
    const t = k * total;
    const crouch = Math.min(1, t / wind);
    const go = THREE.MathUtils.clamp((t - wind) / 0.06, 0, 1);
    const out = Math.min(1, (total - t) / 0.18);
    const R = c.arm(1);
    const L = c.arm(-1);
    // Blade drawn back, then thrust straight out along the charge.
    R.upper.rotation.x = THREE.MathUtils.lerp(-0.2, -0.6, crouch) * (1 - go) + -1.55 * go * out + -0.1 * (1 - out);
    R.upper.rotation.z = 0.12 + 0.2 * crouch * (1 - go);
    R.fore.rotation.x = -1.2 * crouch * (1 - go) + -0.05 * go;
    L.upper.rotation.x = 0.6 * go * out;
    L.upper.rotation.z = -0.12 - 0.5 * go * out;
    c.spine.rotation.x += (0.25 * crouch + 0.3 * go) * out;
    c.body.position.y = -0.15 * crouch * (1 - go * 0.6) * out;
    for (const g of c.legs) {
      g.thigh.rotation.x = -0.4 * crouch * out * (g === c.legs[0] ? 1 : -0.6);
      g.shin.rotation.x = 0.6 * crouch * out;
    }
  });
  let started = false;
  let wait = wind;
  p.tickers.push((dt) => {
    wait -= dt;
    if (wait > 0) return true;
    if (started) return false;
    started = true;
    audio.lunge(from);
    sp.dust(from, 1.4, 14, undefined, 0.9);
    ctx.effects.sparks(from.clone().setY(from.y + 0.15), 10, EMBER, 2.5, 0.4);
    let last = from.clone();
    p.dash = {
      from,
      to,
      t: 0,
      dur,
      step: (at) => {
        // Kicked-up grit at the heels and torn air along the path.
        const seg = at.clone().sub(last);
        const n = Math.ceil(seg.length() / 0.35);
        for (let i = 0; i < n; i++) {
          const q = last.clone().addScaledVector(seg, i / Math.max(1, n));
          sp.puff({ pos: q.clone().setY(q.y + 0.25), vel: dir.clone().multiplyScalar(-1.5).add(new THREE.Vector3(rnd(-0.5, 0.5), rnd(0.3, 0.9), rnd(-0.5, 0.5))), life: rnd(0.6, 0.9), size: 0.35, size1: 0.9, color: new THREE.Color(0.06, 0.045, 0.035), alpha: 0.45, lit: 1, erode: 0.85, drag: 2.5 });
          sp.puff({ pos: q.clone().setY(q.y + rnd(0.7, 1.4)), vel: dir.clone().multiplyScalar(-2), life: 0.25, size: 0.35, size1: 0.1, color: new THREE.Color(1.6, 0.8, 0.4), color1: new THREE.Color(0.4, 0.1, 0.02), alpha: 0.5, add: 1, erode: 0.9 });
        }
        last = at.clone();
        for (const m of ctx.monsters) {
          if (!m.alive || hit.has(m)) continue;
          if (flat(m.position, at) < m.radius + 1.1) {
            hit.add(m);
            const chest = m.position.clone().setY(m.position.y + m.height * 0.6);
            p.strike(m, ctx, mult);
            ctx.effects.sparks(chest, 14, EMBER, 3.5, 0.4);
            if (stun && m.alive && m.stun(SK.lungeStun)) ctx.floaters.spawn('Stunned', m.position.clone().setY(m.position.y + m.height + 0.3), '');
          }
        }
      },
      land: () => {
        if (stun) {
          sk.groundSplit(from.clone().addScaledVector(dir, 0.6), to, 1.8);
          audio.quake(to, 0.7);
        }
        sk.streak(from.clone().setY(from.y + 1.05), to.clone().setY(to.y + 1.05), 1.1, new THREE.Color(1.8, 0.8, 0.4), 0.4);
        ctx.effects.slash(to.clone().setY(to.y + 1.05), Math.atan2(dir.x, dir.z), 2.0, new THREE.Color(1.8, 0.75, 0.45));
        sp.dust(to, 1.6, 16, undefined, 0.9);
        ctx.effects.addShake(0.15);
        if (p.stats.has('lungeEcho')) phantomBlade(p, ctx, from, to, dir, mult * SK.echoMult);
      },
    };
    return false;
  });
}

/** Phantom Blade: a spectral sword retraces the lunge a moment later. */
function phantomBlade(p: Player, ctx: PlayerContext, from: THREE.Vector3, to: THREE.Vector3, dir: THREE.Vector3, mult: number) {
  const sp = ctx.effects.spell;
  const sk = ctx.effects.skill;
  let wait = 0.3;
  p.tickers.push((dt) => {
    wait -= dt;
    if (wait > 0) return true;
    // The Blade sheet's great sword, flying point-first along the path.
    const blade = new THREE.Group();
    const sword = sk.sword(1.1);
    sword.rotation.x = Math.PI / 2;
    sword.position.z = -0.7;
    blade.add(sword);
    const a = from.clone().setY(from.y + 1.05);
    const b = to.clone().setY(to.y + 1.05);
    blade.position.copy(a);
    blade.lookAt(b);
    ctx.effects.group.add(blade);
    audio.whoosh(a, 0.8);
    const hit = new Set<Monster>();
    ctx.effects.after(0.24, blade, (k, dt2) => {
      blade.position.lerpVectors(a, b, k);
      sp.energyTrail(blade.position, dir, 0.16, new THREE.Color(1.8, 0.8, 0.3), new THREE.Color(0.5, 0.08, 0.02), dt2, false);
      if (Math.random() < 0.6) ctx.effects.mote(blade.position.clone().addScaledVector(dir, 0.9), dir.clone().multiplyScalar(-1).add(new THREE.Vector3(0, 0.8, 0)), 0.5, 0.05, EMBER, true);
      for (const m of ctx.monsters) {
        if (!m.alive || hit.has(m)) continue;
        if (flat(m.position, blade.position) < m.radius + 1) {
          hit.add(m);
          p.strike(m, ctx, mult);
          sp.energyBurst(m.position.clone().setY(m.position.y + m.height * 0.6), 0.6, GHOST, new THREE.Color(0.1, 0.2, 0.6), 6, 8);
        }
      }
      if (k >= 1) {
        blade.visible = false;
        sk.streak(a, b, 0.9, new THREE.Color(1.6, 0.9, 0.5), 0.35);
      }
    });
    return false;
  });
}

// ------------------------------------------------------------ Judgement

/** A hammer of light dropped from the sky on the cursor (two more with Hammers of Wrath). */
function judgement(p: Player, ctx: PlayerContext, fx: BossFx, r: number) {
  const at = p.aim.clone();
  at.y = p.area!.heightAt(at.x, at.z);
  const c = p.character;
  let fired = false;
  p.busy(0.7, () => p.restPose());
  c.play(0.7, (k) => {
    // Sword raised to the sky, then swept down to point at the target.
    const up = Math.min(1, k / 0.35);
    const down = THREE.MathUtils.clamp((k - 0.45) / 0.15, 0, 1);
    const out = Math.min(1, (1 - k) / 0.25);
    const R = c.arm(1);
    const L = c.arm(-1);
    R.upper.rotation.x = THREE.MathUtils.lerp(-0.1, -2.9, up) * (1 - down) * out + -1.3 * down * out;
    R.fore.rotation.x = -0.2;
    L.upper.rotation.x = -1.2 * up * (1 - down) * out;
    L.upper.rotation.z = -0.12 - 0.8 * up * out;
    c.spine.rotation.x += (-0.2 * up * (1 - down) + 0.25 * down) * out;
    c.head.rotation.x -= 0.3 * up * (1 - down) * out;
    if (!fired && k >= 0.4) {
      fired = true;
      ctx.effects.sparks(p.position.clone().setY(p.position.y + 2.6), 14, GOLD, 2, 0.6);
      const side = new THREE.Vector3(-(at.z - p.position.z), 0, at.x - p.position.x).normalize();
      dropHammer(p, ctx, fx, at, 3, SK.judgementMult(r), SK.judgementStun(r), 0, 1.1);
      if (p.stats.has('judgeTriple')) {
        for (const [s, delay] of [[-1, 0.18], [1, 0.34]] as const) {
          const q = at.clone().addScaledVector(side, s * 2.4);
          if (!p.area!.nav.walkable(q.x, q.z)) continue;
          q.y = p.area!.heightAt(q.x, q.z);
          dropHammer(p, ctx, fx, q, 2.2, SK.judgementMult(r) * SK.tripleMult, SK.judgementStun(r) * 0.6, delay, 0.75);
        }
      }
    }
  });
}

function dropHammer(p: Player, ctx: PlayerContext, fx: BossFx, at: THREE.Vector3, radius: number, mult: number, stun: number, delay: number, scale: number) {
  const sk = ctx.effects.skill;
  const sp = ctx.effects.spell;
  let wait = delay;
  p.tickers.push((dt) => {
    wait -= dt;
    if (wait > 0) return true;
    // A hallowed circle marks where it will land.
    sk.rune(at, radius * 1.1, 1.3, 'holy', { fill: 0.3, grow: 0.3 });
    audio.judgement(at, 'fall');
    const fall = 0.5;
    const hammer = sk.hammer(scale);
    const top = at.clone().add(new THREE.Vector3(1.2, 12, 0.8));
    ctx.effects.group.add(hammer);
    let landed = false;
    const spin = rnd(-1, 1);
    ctx.effects.after(fall + 0.55, hammer, (k, dt2) => {
      const t = k * (fall + 0.55);
      if (t < fall) {
        const e = (t / fall) * (t / fall);
        hammer.position.lerpVectors(top, at, e);
        hammer.rotation.set(0, spin * (1 - e) * 2, -0.25 * (1 - e));
        sp.puff({ pos: hammer.position.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), 1 + rnd(0, 1.5), rnd(-0.3, 0.3)).multiplyScalar(scale)), vel: new THREE.Vector3(0, 2, 0), life: 0.35, size: 0.5 * scale, size1: 0.15, color: HOLY0, color1: HOLY1, alpha: 0.6, add: 1, erode: 0.9 });
        if (Math.random() < dt2 * 40) ctx.effects.mote(hammer.position.clone(), new THREE.Vector3(rnd(-1, 1), 2, rnd(-1, 1)), 0.6, 0.06, GOLD, true);
      } else {
        if (!landed) {
          landed = true;
          hammer.position.copy(at).setY(at.y - 0.25 * scale);
          hammerLands(p, ctx, fx, at, radius, mult, stun, scale);
        }
        // Stands embedded a moment, then sinks away in light.
        const u = (t - fall) / 0.55;
        hammer.position.y = at.y - 0.25 * scale - u * u * 1.5 * scale;
        hammer.scale.setScalar(scale * (1 - u * u * 0.4));
      }
    });
    return false;
  });
}

function hammerLands(p: Player, ctx: PlayerContext, fx: BossFx, at: THREE.Vector3, radius: number, mult: number, stun: number, scale: number) {
  const sk = ctx.effects.skill;
  const sp = ctx.effects.spell;
  audio.judgement(at, 'land');
  audio.slam(at, 1.2);
  ctx.effects.addShake(0.45 * scale);
  // The lesser hammers of Hammers of Wrath land without their own shaft of
  // light, so three together don't wash the screen out.
  const main = scale >= 1;
  ctx.effects.flash(at.clone().setY(at.y + 1.2), 0xffe0a0, main ? 24 : 10, main ? 9 : 6, 0.45);
  if (main) sk.lightShaft(at, 10, 0.9, 0.5);
  if (!main) fx.column(at, 0.8, 2.5, GOLD, 0.45);
  fx.cracks(at, radius * 1.05, GOLD, 3);
  fx.debris(at, Math.round(22 * scale), 1.3);
  fx.nova(at, radius * 1.2, GOLD.clone().multiplyScalar(0.45), 0.55, 0.9, 0.4);
  sp.ring(at, radius * 1.4, new THREE.Color(2.2, 1.6, 0.5), 0.5);
  sp.dust(at, radius, 26, undefined, 1.2);
  sp.energyBurst(at.clone().setY(at.y + 0.6), 1.1 * scale, HOLY0, HOLY1, 12, 30);
  ctx.effects.sparks(at.clone().setY(at.y + 0.4), Math.round(36 * scale), GOLD, 6, 0.8);
  for (const m of p.near(ctx, at, radius)) {
    p.strike(m, ctx, mult);
    if (m.alive && m.stun(stun)) ctx.floaters.spawn('Stunned', m.position.clone().setY(m.position.y + m.height + 0.3), '');
  }
  if (scale >= 1 && p.stats.has('judgeHallow')) {
    const cr = p.stats.rank('consecration');
    sk.rune(at, radius * 1.05, 4, 'holy', { fill: 0.8 });
    sk.holyPillar(at, 4);
    p.consecrations.push({ at: at.clone(), radius: radius * 0.9, left: 4, next: 0.3, mult: SK.consecrateMult(cr), heal: SK.consecrateHeal(cr) });
  }
}

// ----------------------------------------------------------- Hemorrhage

/** Tears open every foe near the cursor: a burst of blood out of each, then bleeding. */
function hemorrhage(p: Player, ctx: PlayerContext, fx: BossFx, r: number) {
  const at = p.aim.clone();
  at.y = p.area!.heightAt(at.x, at.z);
  const c = p.character;
  const sk = ctx.effects.skill;
  const sp = ctx.effects.spell;
  let fired = false;
  // The rite's circle opens as the hand reaches out.
  sk.rune(at, 3.9, 1.6, 'blood', { fill: 0.35, grow: 0.3 });
  audio.charge(at, 0.35, 'blood');
  p.busy(0.62, () => p.restPose());
  c.play(0.62, (k) => {
    // Off hand thrust at the target, fingers clawing, then wrenched back.
    const reach = Math.min(1, k / 0.35);
    const rip = THREE.MathUtils.clamp((k - 0.45) / 0.12, 0, 1);
    const out = Math.min(1, (1 - k) / 0.25);
    const L = c.arm(-1);
    L.upper.rotation.x = (-1.45 * reach + rip * 0.9) * out;
    L.upper.rotation.z = -0.12 - 0.15 * reach * out;
    L.fore.rotation.x = (-0.1 - rip * 1.3) * out;
    c.spine.rotation.y += (-0.3 * reach + 0.5 * rip) * out;
    c.spine.rotation.x += (0.15 * reach - 0.25 * rip) * out;
    if (k < 0.45 && Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2;
      const q = at.clone().add(new THREE.Vector3(Math.cos(a) * 3.5, 0.1, Math.sin(a) * 3.5));
      ctx.effects.mote(q, at.clone().setY(at.y + 0.5).sub(q).multiplyScalar(2), 0.45, 0.09, CRIMSON, true);
    }
    if (!fired && k >= 0.48) {
      fired = true;
      audio.hemorrhage(at);
      ctx.effects.addShake(0.2);
      ctx.effects.flash(at.clone().setY(at.y + 1), 0xff2010, 26, 8, 0.4);
      fx.pool(at, 3.2, new THREE.Color(0.3, 0.01, 0.01), 3);
      sp.ring(at, 3.8, new THREE.Color(1.4, 0.08, 0.05), 0.5);
      sk.bloodTendrils(at, 9, 1.8, 1.1);
      // Blood mist rolling out from the circle's heart.
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        sp.puff({ pos: at.clone().setY(at.y + 0.5), vel: d.multiplyScalar(rnd(6, 9)).setY(0.6), life: rnd(0.9, 1.3), size: 0.7, size1: 1.7, color: new THREE.Color(0.16, 0.008, 0.008), color1: new THREE.Color(0.08, 0.015, 0.015), alpha: 0.5, lit: 1, erode: 0.85, drag: 3 });
      }
      const chestOf = (m: Monster) => m.position.clone().setY(m.position.y + m.height * 0.6);
      const hero = p.position.clone().setY(p.position.y + 1.1);
      for (const m of p.near(ctx, at, 3.5)) {
        const ch = chestOf(m);
        // Wounds burst open: a fountain of blood thrown up out of the foe.
        ctx.effects.blood(ch, ch.clone().setY(ch.y - 2), 34, m.def.blood, 1.4);
        sk.bloodTendrils(m.position, 6, Math.max(1.2, m.height * 0.9), 0.95);
        sp.energyBurst(ch, 0.8, BLOOD0, BLOOD1, 10, 0);
        sk.bloodStream(ch, hero, 8);
        p.strike(m, ctx, SK.hemoMult(r));
        p.dot(m, 'bleed', SK.hemoBleed(r), SK.bleedTime);
      }
    }
  });
}

// ------------------------------------------------------------ Fire Wall

/** A wall (or ring) of tall flame tongues across the cursor, burning whatever stands in it. */
function fireWall(p: Player, ctx: PlayerContext, at: THREE.Vector3, dir: THREE.Vector3, r: number) {
  const area = p.area!;
  const sk = ctx.effects.skill;
  const sp = ctx.effects.spell;
  const ring = p.stats.has('wallRing');
  const march = p.stats.has('wallMarch');
  const dur = SK.fireWallTime;
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  const half = 3.5;
  const ringR = 3;
  const centre = at.clone();
  // Flame emitters along the line (or round the ring), each its own tongue.
  const N = ring ? 14 : 11;
  const emitters = Array.from({ length: N }, (_, i) => {
    const off = ring ? new THREE.Vector3(Math.cos((i / N) * Math.PI * 2) * ringR, 0, Math.sin((i / N) * Math.PI * 2) * ringR) : side.clone().multiplyScalar(-half + (2 * half * (i + 0.5)) / N);
    return { off, h: rnd(1.9, 2.9), seed: Math.random() * 10, size: rnd(0.5, 0.65) };
  });
  audio.flameRoar(centre, 1.2);
  ctx.effects.flash(centre.clone().setY(centre.y + 1.2), 0xff7a30, 30, 9, 0.6);
  const scorch = (c0: THREE.Vector3) => {
    if (ring) {
      sk.rune(c0, ringR * 1.25, dur + 0.6, 'fire', { fill: 0.5 });
      sk.stoneRing(c0, ringR + 0.55, dur + 0.4, true);
      return;
    }
    for (let s = -half; s <= half; s += 1.4) {
      const q = c0.clone().addScaledVector(side, s);
      sp.decal('scorch', q.x, q.z, 1.1, dur + 2, 1.2);
    }
  };
  scorch(centre);
  // The flames burst up out of a seam of fire racing along the line.
  for (const e of emitters) {
    const q = centre.clone().add(e.off);
    q.y = area.heightAt(q.x, q.z) + 0.2;
    sp.fireBurst(q, 0.45, 0.25);
  }
  let left = dur;
  let next = 0.25;
  let lastDecal = 0;
  let roar = 2;
  p.tickers.push((dt, c) => {
    left -= dt;
    next -= dt;
    roar -= dt;
    const f = Math.min(1, left / 0.6, (dur - left) / 0.2 + 0.3);
    if (march) {
      const n = centre.clone().addScaledVector(dir, 1.5 * dt);
      if (area.nav.walkable(n.x, n.z)) centre.copy(n);
      lastDecal += 1.5 * dt;
      if (lastDecal > 1.2) {
        lastDecal = 0;
        scorch(centre);
      }
    }
    if (roar <= 0) {
      roar = 99;
      audio.flameRoar(centre, 0.7);
    }
    for (const e of emitters) {
      const q = centre.clone().add(e.off);
      if (!area.nav.walkable(q.x, q.z)) continue;
      q.y = area.heightAt(q.x, q.z) + 0.05;
      sk.flame(q, e.h * (0.4 + 0.6 * f), e.size * 1.35, dt, 16 * f, e.seed, 0.5);
    }
    // Low fire and a heat glow along the base.
    for (let i = 0; i < 2; i++) {
      const e = emitters[Math.floor(Math.random() * N)];
      const q = centre.clone().add(e.off);
      q.y = area.heightAt(q.x, q.z) + 0.25;
      sp.puff({ pos: q, vel: new THREE.Vector3(0, 0.8, 0), life: 0.5, size: 1.1, size1: 0.6, color: new THREE.Color(1.4, 0.45, 0.08), color1: new THREE.Color(0.4, 0.04, 0.01), alpha: 0.22 * f, add: 1, erode: 0.9 });
    }
    if (next <= 0 && !p.dead) {
      next += 0.5;
      for (const m of c.monsters) {
        if (!m.alive) continue;
        const rel = m.position.clone().sub(centre).setY(0);
        const inside = ring ? Math.abs(rel.length() - ringR) < 0.9 + m.radius : Math.abs(rel.dot(dir)) < 0.9 + m.radius && Math.abs(rel.dot(side)) < half + m.radius;
        if (inside) {
          p.strike(m, c, SK.fireWallMult(r), undefined);
          p.ignite(m);
        }
      }
    }
    return left > 0;
  });
}

// --------------------------------------------------------- Glacial Spike

/** A great spear of ice with a six-pointed star at its head, bursting into a star of shards. */
function glacialSpike(p: Player, ctx: PlayerContext, dir: THREE.Vector3, r: number) {
  const from = staffTip(p);
  const sk = ctx.effects.skill;
  const sp = ctx.effects.spell;
  audio.whoosh(from, 1.2);
  audio.cast(from);
  // The Frost sheet's glacial lance, a small ice star spinning at its head.
  const g = sk.glacialLance();
  const star = sk.iceStar(0.22);
  star.position.z = 0.75;
  g.add(star);
  const freeze = SK.spikeFreeze(r) * (p.stats.has('spikePermafrost') ? 2 : 1);
  bolt(p, ctx, {
    from,
    dir,
    speed: 17,
    range: 14,
    color: ICE,
    size: 0.2,
    obj: g,
    trail: (pos, d, dt) => {
      star.rotation.z += dt * 9;
      (star.userData.inner as THREE.Object3D).rotation.z -= dt * 14;
      sp.frostTrail(pos, d, dt);
      sp.frostTrail(pos, d, dt);
      sk.ghostMist(pos.clone().setY(pos.y - 0.6), 0.25, dt, 30, 0.6);
    },
    onHit: () => {},
    onEnd: (at, struck) => {
      if (!struck && flat(at, from) < 1) return;
      const burst = at.clone();
      burst.y = p.area!.heightAt(at.x, at.z) + 0.9;
      audio.iceShatter(burst, 1.2);
      ctx.effects.addShake(0.25);
      sk.starBurst(burst, 2.5);
      sk.spikedOrb(burst, 2.5);
      for (const m of p.near(ctx, burst, 2.5)) {
        p.strike(m, ctx, SK.spikeMult(r));
        if (p.freezeM(m, freeze)) ctx.floaters.spawn('Frozen', m.position.clone().setY(m.position.y + m.height + 0.3), '');
      }
      if (p.stats.has('spikeStar')) {
        for (let i = 0; i < 6; i++) {
          bolt(p, ctx, {
            from: burst.clone(),
            dir: dirOf((i / 6) * Math.PI * 2 + Math.random() * 0.3),
            speed: 16,
            range: 7,
            color: ICE,
            size: 0.08,
            shard: true,
            onHit: (m, q) => {
              p.strike(m, ctx, SK.spikeMult(r) * SK.starMult);
              p.chillM(m, 2);
              sp.glitter(q, 0.2, 8, 1.6);
            },
          });
        }
      }
      if (p.stats.has('spikePermafrost')) {
        const g0 = burst.clone().setY(p.area!.heightAt(burst.x, burst.z));
        sk.rune(g0, 3, 4, 'frost', { fill: 0.4 });
        sk.iceFloor(g0, 2.8, 4);
        p.zone(g0, 2.8, 4, 0.5, (q, c) => {
          for (const m of p.near(c, q, 2.8)) p.chillM(m, 1);
        }, (dt, q) => sk.ghostMist(q, 2.6, dt, 8, 0.3));
      }
    },
  });
}

// ------------------------------------------------------------ Ice Armour

/** A guard of six ice stars circling the mage, ghost mist curling round their feet. */
function iceArmor(p: Player, ctx: PlayerContext, r: number) {
  const sk = ctx.effects.skill;
  const sp = ctx.effects.spell;
  const dur = SK.iceArmorTime;
  const at = p.position.clone();
  audio.iceForm(at);
  ctx.effects.flash(at.clone().setY(at.y + 1.2), 0x8ad8ff, 22, 6, 0.5);
  sp.frostBurst(at, 2.2, 8);
  sk.ghostBurst(at, 1.6);
  const record = {
    left: dur,
    amount: SK.iceArmor(r),
    retaliate: p.stats.has('armorRetaliate'),
    mend: p.stats.has('armorMend'),
    cd: 0,
    tick: (dt: number, c: PlayerContext) => {
      c.effects.skill.ghostMist(p.position, 0.9, dt, 9, 0.25);
      if (Math.random() < dt * 10) c.effects.spell.glitter(p.position.clone().setY(p.position.y + 0.4 + Math.random() * 1.4), 0.6, 1, 0.8);
      if (record.mend) {
        const s = p.stats;
        s.hp = Math.min(s.maxHp, s.hp + s.maxHp * SK.armorMend * dt);
      }
    },
  };
  p.iceArmor = record;
  p.refreshBuffs();
  const rune = sk.rune(at, 1.6, dur, 'frost', { follow: () => p.position, fill: 0.4 });
  // The circling stars.
  const g = new THREE.Group();
  const stars = Array.from({ length: 6 }, (_, i) => {
    const s = sk.iceStar(0.2, i % 2 === 0);
    g.add(s);
    return { s, a: (i / 6) * Math.PI * 2, bob: Math.random() * 6 };
  });
  ctx.effects.group.add(g);
  let t = 0;
  ctx.effects.after(dur + 0.3, g, (_k, dt) => {
    t += dt;
    const grow = Math.min(1, t / 0.35);
    const live = p.iceArmor === record && !p.dead;
    g.position.copy(p.position);
    for (const q of stars) {
      const a = q.a + t * 1.8;
      const rr = 1.05 * (0.4 + 0.6 * grow);
      q.s.position.set(Math.cos(a) * rr, 1.0 + Math.sin(t * 2.2 + q.bob) * 0.25, Math.sin(a) * rr);
      // Face outward, tilted up toward the camera, spinning on their own axis.
      q.s.rotation.set(-0.7, -a + Math.PI / 2, t * 3 + q.bob);
      q.s.scale.setScalar(grow);
    }
    if (!live) {
      // Gone: the stars shatter.
      const tmp = new THREE.Vector3();
      for (const q of stars) {
        q.s.getWorldPosition(tmp);
        sp.glitter(tmp.clone(), 0.2, 8, 2);
        sp.shard(tmp.clone());
      }
      audio.iceShatter(p.position, 0.6);
      rune.visible = false;
      return true;
    }
  });
}

// ------------------------------------------------------------ Arcane Orb

/** A slow, crackling orb lashing foes with lightning as it goes, then detonating. */
function arcaneOrb(p: Player, ctx: PlayerContext, fx: BossFx, dir: THREE.Vector3, r: number) {
  const twin = p.stats.has('orbTwin');
  const from = staffTip(p);
  audio.orbHum(from);
  const mult = twin ? SK.twinOrbMult : 1;
  if (twin) {
    launchOrb(p, ctx, fx, from, dir, r, mult, 1);
    launchOrb(p, ctx, fx, from, dir, r, mult, -1);
  } else launchOrb(p, ctx, fx, from, dir, r, mult, 0);
}

function launchOrb(p: Player, ctx: PlayerContext, fx: BossFx, from: THREE.Vector3, dir: THREE.Vector3, r: number, mult: number, wind: number) {
  const area = p.area!;
  const sk = ctx.effects.skill;
  const sp = ctx.effects.spell;
  const pull = p.stats.has('orbSingularity');
  const size = wind ? 0.32 : 0.42;
  const orb = sp.orb('arcane', size, ARCANE.clone().multiplyScalar(0.45));
  ctx.effects.group.add(orb);
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  const speed = 4.5;
  const range = 12;
  const life = range / speed;
  let travelled = 0;
  let zapT = 0.2;
  let done = false;
  const base = from.clone().setY(from.y - 0.2);
  const pos = base.clone();
  const detonate = () => {
    if (done) return;
    done = true;
    orb.visible = false;
    const at = pos.clone();
    audio.blast(at, 'soul', 1.2);
    ctx.effects.addShake(0.3);
    ctx.effects.flash(at, 0xb08cff, 30, 9, 0.45);
    sp.energyBurst(at, 2, ARCANE.clone().multiplyScalar(0.7), new THREE.Color(0.25, 0.05, 0.6), 24, 40);
    fx.nova(at.clone().setY(area.heightAt(at.x, at.z)), 3, ARCANE.clone().multiplyScalar(0.4), 0.5, 1.2);
    sp.ring(at, 3.4, new THREE.Color(1.0, 0.6, 2.0), 0.45);
    const ground = at.clone().setY(area.heightAt(at.x, at.z));
    sk.rune(ground, 3.2, 1.2, 'arcane', { fill: 0.5, grow: 0.1, hex: true });
    if (pull) {
      // Singularity: the detonation tears open a void pit that keeps dragging foes in.
      sk.voidPit(ground, 2.2, 2.2);
      p.zone(ground, 4.5, 2, 0.05, (q, c) => {
        for (const m of p.near(c, q, 4.5)) {
          const d = q.clone().sub(m.position).setY(0);
          if (d.length() > 0.6) p.push(m, d, 0.16);
        }
      });
    }
    for (const m of p.near(ctx, at, 3)) {
      sk.zap(at, m.position.clone().setY(m.position.y + m.height * 0.6), ARCANE, 0.2, 0.05);
      p.strike(m, ctx, SK.orbBlast(r) * mult);
    }
  };
  ctx.effects.after(life + 0.1, orb, (_k, dt) => {
    if (done) return true;
    travelled = Math.min(range, travelled + speed * dt);
    pos.copy(base).addScaledVector(dir, travelled);
    if (wind) pos.addScaledVector(side, Math.sin(travelled * 1.4) * 0.9 * wind);
    pos.y = area.heightAt(pos.x, pos.z) + 1.2 + Math.sin(travelled * 2) * 0.1;
    orb.position.copy(pos);
    const core = orb.userData.core as THREE.Object3D;
    core.rotation.x += dt * 3;
    core.rotation.y += dt * 4;
    const pulse = 1 + Math.sin(travelled * 6) * 0.08;
    core.scale.setScalar(size * pulse);
    sk.orbAura(pos, size, dt);
    if (pull) {
      // Singularity: everything within 5m is dragged toward the orb.
      for (const m of p.near(ctx, pos, 5)) {
        const d = pos.clone().sub(m.position).setY(0);
        if (d.length() > 0.8) p.push(m, d, 2.4 * dt);
      }
      if (Math.random() < dt * 25) {
        const a = Math.random() * Math.PI * 2;
        const q = pos.clone().add(new THREE.Vector3(Math.cos(a) * 3.5, -0.8, Math.sin(a) * 3.5));
        sp.puff({ pos: q, vel: pos.clone().sub(q).multiplyScalar(2.2), life: 0.45, size: 0.25, size1: 0.05, color: ARCANE.clone().multiplyScalar(0.6), add: 1, erode: 0.6 });
      }
    }
    zapT -= dt;
    if (zapT <= 0) {
      zapT += 0.4;
      const near = p.near(ctx, pos, 3.5).sort((a, b) => flat(a.position, pos) - flat(b.position, pos)).slice(0, 3);
      for (const m of near) {
        const to = m.position.clone().setY(m.position.y + m.height * 0.6);
        sk.zap(pos, to, ARCANE);
        audio.zap(to);
        p.strike(m, ctx, SK.orbZap(r) * mult);
      }
      // A stray arc to the ground when nothing is near.
      if (!near.length && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        const g = pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6));
        g.y = area.heightAt(g.x, g.z);
        sk.zap(pos, g, ARCANE, 0.12, 0.025);
      }
    }
    if (!area.nav.walkable(pos.x, pos.z) && travelled > 0.8) return detonate(), true;
    if (travelled >= range - 1e-3) return detonate(), true;
  });
}
