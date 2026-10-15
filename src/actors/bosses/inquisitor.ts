import * as THREE from 'three';
import { audio } from '../../audio/Audio';
import { Character } from '../Character';
import { bakeRig } from '../bake';
import type { Rng } from '../../procgen/noise';
import { collapse } from '../monsters/humanoid';
import { dressBonePriest } from '../monsters/bonePriest';
import type { MonsterMaterials } from '../monsters/materials';
import type { MonsterContext } from '../Monster';
import type { Boss, BossBody, BossDef, Script } from '../Boss';
import type { Telegraph } from '../../game/Telegraph';
import { easeOut, hold, lerp, poseAction, smooth } from './common';

// The Grand Inquisitor: the gaol's master, a giant skeletal priest in
// crimson vestments and a towering mitre, his staff crowned with a spiked sun
// that burns blood-red. He kneels in prayer in the middle of his court until
// the seals break. He preaches in volleys of blood, drags the hero in with
// chains that burst from the floor, drops iron cages from the dark, calls up
// his penitents, and flays everything near him with a nova of thorns.

const RED = 0xff2a14;
const BLOOD = new THREE.Color(1.6, 0.08, 0.04);
const BLOOD_HOT = new THREE.Color(2.6, 0.3, 0.12);

export function buildInquisitor(m: MonsterMaterials, rng: Rng, scale = 1.9): BossBody {
  const c = new Character({ scale, hunch: 0.08, stride: 1.6 });
  const dress = dressBonePriest(c, m, rng, { boss: true });
  bakeRig(c.root);
  const L = c.arm(-1);
  const R = c.arm(1);
  let glow = 1;
  c.hooks.push((_dt, _w, time) => dress.setGlow(glow * (0.9 + Math.sin(time * 4.3) * 0.1)));

  const poses: Record<string, (k: number, w: number) => void> = {
    // Both arms and the staff raised high, gathering power.
    raise: (k, w) => {
      const s = hold(k, 0.25, 0.8) * w;
      R.upper.rotation.x = lerp(R.upper.rotation.x, -2.8, s);
      R.fore.rotation.x = lerp(R.fore.rotation.x, -0.3, s);
      L.upper.rotation.x = lerp(L.upper.rotation.x, -2.6, s);
      L.fore.rotation.x = lerp(L.fore.rotation.x, -0.2, s);
      L.upper.rotation.z = lerp(L.upper.rotation.z, -0.4, s);
      R.upper.rotation.z = lerp(R.upper.rotation.z, 0.3, s);
      c.spine.rotation.x += -0.22 * s;
      c.head.rotation.x -= 0.35 * s;
      glow = 1 + s * 2;
    },
    // The staff driven down into the floor before him.
    slam: (k, w) => {
      const up = smooth(0, 0.35, k) * (1 - smooth(0.38, 0.46, k));
      const down = smooth(0.38, 0.48, k) * (1 - smooth(0.85, 1, k));
      R.upper.rotation.x = lerp(R.upper.rotation.x, -2.6 * up - 0.7 * down, w);
      R.fore.rotation.x = lerp(R.fore.rotation.x, -0.3 * up - 0.6 * down, w);
      L.upper.rotation.x = lerp(L.upper.rotation.x, -2.3 * up - 0.9 * down, w);
      L.fore.rotation.x = lerp(L.fore.rotation.x, -0.4 * up - 0.5 * down, w);
      c.spine.rotation.x += (-0.25 * up + 0.45 * down) * w;
      c.hips.position.y -= 0.12 * down * w;
      glow = 1 + down * 2;
    },
    // The free hand thrust out, palm first: a sermon of blood.
    thrust: (k, w) => {
      const draw = smooth(0, 0.4, k) * (1 - smooth(0.42, 0.5, k));
      const out = smooth(0.42, 0.52, k) * (1 - smooth(0.85, 1, k));
      L.upper.rotation.x = lerp(L.upper.rotation.x, -0.6 * draw - 1.55 * out, w);
      L.upper.rotation.z = lerp(L.upper.rotation.z, 0.5 * draw + 0.1 * out, w);
      L.fore.rotation.x = lerp(L.fore.rotation.x, -1.6 * draw - 0.05 * out, w);
      R.upper.rotation.x = lerp(R.upper.rotation.x, -0.8 * (draw + out), w);
      c.spine.rotation.y += (0.45 * draw - 0.3 * out) * w;
      c.spine.rotation.x += 0.12 * out * w;
      glow = 1 + out * 1.5;
    },
    // Arms spread wide, head thrown back: calling the penitents.
    summon: (k, w) => {
      const s = hold(k, 0.25, 0.8) * w;
      for (const a of [L, R]) {
        a.upper.rotation.x = lerp(a.upper.rotation.x, -1.2, s);
        a.upper.rotation.z = lerp(a.upper.rotation.z, a.side * 1.1, s);
        a.fore.rotation.x = lerp(a.fore.rotation.x, -0.3, s);
      }
      c.spine.rotation.x -= 0.3 * s;
      c.head.rotation.x -= 0.5 * s;
      glow = 1 + s * 2.5;
    },
    // Kneeling in prayer, head bowed over folded hands.
    pray: () => {
      c.hips.position.y -= 0.4;
      const l = c.leg(-1);
      const r = c.leg(1);
      l.thigh.rotation.x = -1.45;
      l.shin.rotation.x = 1.5;
      r.thigh.rotation.x = 0.15;
      r.shin.rotation.x = 1.75;
      c.spine.rotation.x += 0.3;
      c.head.rotation.x = 0.55;
      for (const a of [L, R]) {
        a.upper.rotation.x = -0.9;
        a.upper.rotation.z = -a.side * 0.35;
        a.fore.rotation.x = -1.3;
      }
      glow = 0.08;
    },
    rise: (k, w) => {
      poses.pray(k, w);
      const s = 1 - easeOut(k);
      c.hips.position.y += 0.4 * (1 - s);
      c.spine.rotation.x -= 0.3 * (1 - s);
      c.head.rotation.x = 0.55 * s - 0.3 * (1 - s);
      for (const l of c.legs) {
        l.thigh.rotation.x *= s;
        l.shin.rotation.x *= s;
      }
      for (const a of [L, R]) {
        a.upper.rotation.x = lerp(-0.9, -2.4, smooth(0.3, 0.8, k));
        a.upper.rotation.z = lerp(-a.side * 0.35, a.side * 0.4, smooth(0.3, 0.8, k));
        a.fore.rotation.x = lerp(-1.3, -0.2, smooth(0.3, 0.8, k));
      }
      glow = 0.08 + smooth(0, 0.5, k) * 2.5;
    },
  };

  const body: BossBody = {
    rig: c,
    lift: 0,
    attack(onHit) {
      // A backhanded sweep of the staff.
      poseAction(
        c,
        1.0,
        (k, w) => {
          const wind = smooth(0, 0.45, k) * (1 - smooth(0.5, 0.6, k));
          const sweep = smooth(0.5, 0.62, k) * (1 - smooth(0.8, 1, k));
          R.upper.rotation.x = lerp(R.upper.rotation.x, -1.4 * (wind + sweep), w);
          R.upper.rotation.z = lerp(R.upper.rotation.z, 1.2 * wind - 0.9 * sweep, w);
          c.spine.rotation.y += (0.8 * wind - 1.0 * sweep) * w;
          glow = 1 + sweep;
        },
        [0.6],
        () => onHit(),
      );
      audio.whoosh(c.root.position, 1.3);
    },
    flinch() {},
    die() {
      glow = 0;
      collapse(c, true);
    },
    muzzle() {
      const p = new THREE.Vector3();
      dress.orb.getWorldPosition(p);
      return p;
    },
    move(name, dur, hits = [], onHit) {
      const fn = poses[name];
      if (!fn) return;
      if (name === 'pray') {
        c.play(dur, (k) => fn(k, 1));
        return;
      }
      poseAction(c, dur, fn, hits, onHit);
    },
  };
  (body as BossBody & { setGlow: (g: number) => void }).setGlow = (g) => (glow = g);
  return body;
}

// ---- Abilities ---------------------------------------------------------------

const glowOf = (b: Boss) => (b.bossBody as BossBody & { setGlow: (g: number) => void }).setGlow;

/** A sermon in blood: three waves of bolts fanned at the hero. */
function* sermon(b: Boss, ctx: MonsterContext): Script {
  const waves = b.phase === 2 ? 4 : 3;
  b.voice('attack');
  for (let w = 0; w < waves; w++) {
    b.face(ctx.player.position, 100);
    b.bossBody.move('thrust', 0.7, [0.5], () => {
      const from = b.body.muzzle!().clone();
      const p = ctx.player;
      const aim = p.position.clone().setY(p.position.y + 1).sub(from).normalize();
      const n = b.phase === 2 ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const a = (i - (n - 1) / 2) * 0.16 + (w % 2 ? 0.08 : 0);
        ctx.effects.bolt(
          from,
          aim.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a),
          (pos) => p.alive && Math.hypot(pos.x - p.position.x, pos.z - p.position.z) < p.radius + 0.3 && pos.y < p.position.y + 2,
          () => {
            audio.boltHit(p.position);
            b.hurt(ctx, 0.55, b.position);
          },
          11,
        );
      }
      ctx.effects.flash(from, RED, 30, 7, 0.3);
      audio.cast(from);
    });
    yield 0.75;
  }
  yield 0.4;
}

/** Chains of Penance: three chains burst from the floor along lines at the hero; caught, they drag the hero to him. */
function* chains(b: Boss, ctx: MonsterContext): Script {
  const yaw = b.yawTo(ctx.player.position);
  b.facingYaw = yaw;
  const offs = b.phase === 2 ? [-0.45, -0.22, 0, 0.22, 0.45] : [-0.3, 0, 0.3];
  const teles = offs.map((o) => b.tele({ kind: 'rect', len: 15, w: 1.3 }, b.position.clone(), yaw + o, 1.2));
  b.bossBody.move('slam', 1.6, [0.45], () => {
    const tipAt = b.position.clone().add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(1.6));
    ctx.effects.shockwave(tipAt, 2.5, new THREE.Color(0.8, 0.1, 0.05));
    audio.quake(tipAt, 0.8);
  });
  audio.charge(b.position, 1.1, 'blood');
  yield 1.2;
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2220, metalness: 0.9, roughness: 0.4 });
  let hit = false;
  offs.forEach((o, i) => {
    teles[i].fire();
    for (let d = 1.5; d < 15; d += 1.3) {
      const p = new THREE.Vector3(b.position.x + Math.sin(yaw + o) * d, 0, b.position.z + Math.cos(yaw + o) * d);
      if (!ctx.nav.walkable(p.x, p.z)) break;
      b.fx.spikes(p, 2, 0.35, 1.4, iron, 0.5);
    }
    if (!hit && b.caught(ctx, teles[i])) hit = true;
  });
  ctx.effects.addShake(0.5);
  audio.blast(b.position, 'blood', 0.8);
  if (hit) {
    b.hurt(ctx, 1.0);
    // Dragged in: thrown toward him, to land at his feet.
    const p = ctx.player as { position: THREE.Vector3; knock?: (d: THREE.Vector2, m: number) => void };
    const toward = new THREE.Vector2(b.position.x - p.position.x, b.position.z - p.position.z);
    const dist = toward.length();
    if (dist > 2.5) p.knock?.(toward, Math.min(dist - 2, 9));
  }
  yield 0.9;
}

/** Judgement: iron cages fall from the dark onto the hero and around them. */
function* judgement(b: Boss, ctx: MonsterContext): Script {
  b.bossBody.move('raise', 2.2);
  b.voice('aggro');
  audio.charge(b.position, 1.6, 'blood');
  const n = b.phase === 2 ? 5 : 3;
  const spots = [ctx.player.position.clone()];
  for (let i = 1; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    spots.push(b.floorNear(ctx, ctx.player.position.clone().add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(2.5 + Math.random() * 3)), 0.5));
  }
  const teles: Telegraph[] = spots.map((s) => b.tele({ kind: 'circle', r: 1.6 }, s, 0, 1.6));
  yield 1.3;
  let hit = false;
  spots.forEach((s, i) => {
    b.fx.fall(s, 0.3, BLOOD_HOT, () => {
      teles[i].fire();
      b.fx.debris(s, 12, 0.9);
      b.fx.cracks(s, 2, new THREE.Color(1.2, 0.1, 0.05), 2.5);
      ctx.effects.shockwave(s, 2.2, new THREE.Color(0.7, 0.2, 0.1));
      ctx.effects.sparks(s.clone().setY(0.4), 18, new THREE.Color(1.6, 0.7, 0.3), 3, 0.5);
      audio.slam(s, 1.1);
      if (!hit && b.caught(ctx, teles[i])) {
        hit = true;
        b.hurt(ctx, 1.6, s);
      }
    });
  });
  yield 0.5;
  ctx.effects.addShake(0.8);
  yield 0.6;
}

/** Penitents: chained wraiths and gaunts rise from the blood around the hero. */
function* penitents(b: Boss, ctx: MonsterContext): Script {
  b.bossBody.move('summon', 2.2);
  b.voice('aggro');
  audio.charge(b.position, 1.4, 'blood');
  const p = ctx.player.position.clone();
  const n = Math.min(b.phase === 2 ? 4 : 3, b.spareMinions(ctx, 5));
  const spots = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.random();
    return b.floorNear(ctx, p.clone().add(new THREE.Vector3(Math.sin(a) * 4.5, 0, Math.cos(a) * 4.5)), 0.6);
  });
  const teles = spots.map((s) => b.tele({ kind: 'circle', r: 1.2 }, s, 0, 1.4));
  yield 1.4;
  spots.forEach((s, i) => {
    teles[i].fire();
    b.fx.column(s, 0.8, 3.5, BLOOD, 1.0);
    ctx.effects.blood(s.clone().setY(0.3), s.clone().setY(-1), 20, new THREE.Color(0.3, 0.01, 0.008), 1.2);
    audio.blast(s, 'blood', 0.6);
    if (b.caught(ctx, teles[i])) b.hurt(ctx, 0.5, s);
    const m = b.summon(ctx, i % 2 ? 'gaunt' : 'chainWraith', s, b.level - 2);
    m.body.rig.root.position.y = -1;
  });
  yield 0.8;
}

/** Flaying Nova: thorns of blood burst outward around him; get away from him. */
function* flay(b: Boss, ctx: MonsterContext): Script {
  const at = b.position.clone();
  b.bossBody.move('slam', 1.9, [0.45]);
  audio.charge(at, 1.2, 'blood');
  b.voice('attack');
  const t = b.tele({ kind: 'circle', r: 5.5 }, at, 0, 1.25);
  b.fx.column(at, 1.0, 4, BLOOD, 1.3);
  yield 1.25;
  t.fire();
  b.fx.nova(at, 6, BLOOD_HOT, 0.6, 1.4);
  const thorn = new THREE.MeshStandardMaterial({ color: 0x3a0604, roughness: 0.3, emissive: new THREE.Color(0.4, 0.02, 0.01) });
  b.fx.spikes(at, 26, 5, 1.8, thorn, 0.7);
  ctx.effects.flash(at.clone().setY(1.5), RED, 40, 12, 0.5);
  ctx.effects.addShake(0.8);
  audio.blast(at, 'blood', 1.2);
  if (b.caught(ctx, t)) {
    b.hurt(ctx, 1.4, at);
    b.knock(ctx, at, 3);
  }
  yield 0.8;
}

/** Enraged: a rain of blood falls in a widening spread of circles around the hero. */
function* bloodRain(b: Boss, ctx: MonsterContext): Script {
  b.bossBody.move('raise', 3.2);
  audio.charge(b.position, 2.6, 'blood');
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = b.floorNear(ctx, ctx.player.position.clone().add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(i === 0 ? 0 : 1 + Math.random() * 4)), 0.4);
    const t = b.tele({ kind: 'circle', r: 1.3 }, s, 0, 0.9);
    b.fx.fall(s, 0.9, BLOOD_HOT, () => {
      t.fire();
      b.fx.nova(s, 1.6, BLOOD_HOT, 0.4, 0.6);
      ctx.effects.splat(s.x, s.z, 1.4);
      audio.blast(s, 'blood', 0.4);
      if (b.caught(ctx, t)) b.hurt(ctx, 0.7, s);
    });
    yield 0.28;
  }
  yield 1.0;
}

export const INQUISITOR: BossDef = {
  epithet: 'All confess, in the end',
  color: RED,
  abilities: [
    { name: 'Sermon of Blood', cooldown: 7, range: [3, 20], weight: 1.2, run: sermon },
    { name: 'Chains of Penance', cooldown: 9, range: [4, 15], run: chains },
    { name: 'Judgement', cooldown: 10, range: [0, 25], run: judgement },
    { name: 'Penitents', cooldown: 18, range: [0, 30], weight: 0.7, can: (b, ctx) => b.spareMinions(ctx, 5) >= 2, run: penitents },
    { name: 'Flaying Nova', cooldown: 8, range: [0, 5], weight: 1.4, run: flay },
    { name: 'Rain of Blood', cooldown: 12, range: [0, 30], enraged: true, weight: 1.2, run: bloodRain },
  ],
  sleep(b) {
    b.bossBody.move('pray', 1e6);
  },
  *intro(b, ctx) {
    b.face(ctx.player.position, 100);
    const at = b.position.clone();
    b.bossBody.move('pray', 1.4);
    audio.charge(at, 1.4, 'blood');
    yield* b.over(1.4, (k) => glowOf(b)(0.08 + k * 2));
    b.fx.column(at, 1.6, 8, BLOOD, 2.0);
    ctx.effects.flash(at.clone().setY(1.5), RED, 40, 12, 1.0);
    audio.blast(at, 'blood', 1.2);
    b.bossBody.move('rise', 1.8);
    yield 1.8;
    b.bossBody.move('slam', 1.6, [0.45], () => {
      b.fx.nova(at, 8, BLOOD_HOT, 0.9, 1.4);
      b.fx.cracks(at, 4.5, new THREE.Color(1.2, 0.12, 0.05), 3);
      ctx.effects.addShake(0.9);
      audio.quake(at, 1.2);
    });
    yield 0.7;
    audio.roar('inquisitor', at);
    ctx.banner?.(b.name, INQUISITOR.epithet);
    yield 1.2;
  },
  *enrage(b, ctx) {
    b.bossBody.move('summon', 2.2);
    audio.roar('inquisitor', b.position);
    ctx.banner?.(`${b.name} Unbound`, 'His robes burn; the blood answers him');
    b.fx.column(b.position, 2.2, 9, BLOOD_HOT, 2.0);
    b.fx.nova(b.position, 8, BLOOD_HOT, 0.8, 1.4);
    ctx.effects.addShake(0.8);
    yield 2.2;
  },
  death(b, ctx) {
    const at = b.position.clone();
    audio.roar('inquisitor', at);
    b.fx.column(at, 2, 10, BLOOD_HOT, 2.4);
    b.fx.nova(at, 10, BLOOD_HOT, 1.0, 2);
    for (let i = 0; i < 3; i++) setTimeout(() => ctx.effects.sparks(at.clone().setY(1.5), 60, BLOOD_HOT, 4, 1.4), i * 250);
    ctx.effects.blood(at.clone().setY(1.5), at.clone().setY(-1), 60, new THREE.Color(0.3, 0.01, 0.008), 2);
    ctx.effects.addShake(1.2);
    setTimeout(() => audio.blast(at, 'blood', 1.5), 400);
  },
};
