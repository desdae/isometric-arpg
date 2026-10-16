import * as THREE from 'three';
import { audio } from '../audio/Audio';
import type { Effects } from '../game/Effects';
import { Monster, type MonsterContext } from './Monster';

// A mire leech that lies hidden under deep blood water. While it lurks it is
// out of sight and out of reach: only a slow ripple and a few bubbles give
// it away. When the hero comes near it heaves up out of the water, thrashing
// and streaming blood water, then drags itself slowly to the nearest bank
// (straight through water the nav grid won't walk) and from there hunts
// like any other monster. Lose it and it slides back under.

/** The water surface of the mire. */
const WATER = 0;
/** How deep it lies while hidden. */
const LURK_Y = -0.95;
/** Riding the surface while it swims and crawls: the back just breaks it. */
const SWIM_Y = -0.1;
const RISE_SECS = 1.6;
const WATER_COLOR = new THREE.Color(0.42, 0.035, 0.022);
const BUBBLE_COLOR = new THREE.Color(0.55, 0.07, 0.035);

type Phase = 'lurk' | 'rise' | 'crawl' | 'land' | 'sink';

let ringGeo: THREE.CircleGeometry | null = null;
let ringMat: THREE.ShaderMaterial | null = null;

/**
 * A ripple spreading over the water's surface: a soft, wobbling crest of
 * light on the blood with a fainter trough inside it, thinning as it grows.
 */
function ripple(fx: Effects, x: number, z: number, radius: number, life: number, strength = 0.5) {
  ringGeo ??= new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  ringMat ??= new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { k: { value: 0 }, strength: { value: 0 }, seed: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float k, strength, seed;
      varying vec2 vP;
      void main() {
        float a = atan(vP.y, vP.x);
        float r = length(vP) + sin(a * 5.0 + seed) * 0.025 + sin(a * 11.0 - seed * 2.0) * 0.012;
        float w = mix(0.07, 0.03, k);
        float crest = exp(-pow((r - 0.9) / w, 2.0));
        float inner = exp(-pow((r - 0.68) / (w * 0.8), 2.0)) * 0.45;
        float trough = exp(-pow((r - 0.8) / w, 2.0)) * 0.25;
        float alpha = max(0.0, crest + inner - trough) * strength * (1.0 - k) * (1.0 - k);
        gl_FragColor = vec4(vec3(1.0, 0.32, 0.22) * alpha, alpha);
      }
    `,
  });
  const mat = ringMat.clone();
  mat.uniforms.seed.value = Math.random() * 6.28;
  const m = new THREE.Mesh(ringGeo, mat);
  m.position.set(x, WATER + 0.02, z);
  m.renderOrder = 3;
  fx.group.add(m);
  fx.after(life, m, (k) => {
    const s = 0.15 + radius * (1 - (1 - k) * (1 - k));
    m.scale.set(s, 1, s);
    mat.uniforms.k.value = k;
    mat.uniforms.strength.value = strength;
  }, () => mat.dispose());
}

export class SurfacingLeech extends Monster {
  phase: Phase = 'lurk';
  private t = 0;
  private fxTimer = Math.random() * 3;
  private dripTimer = 0;
  /** Where on the bank it is crawling to. */
  private landing = new THREE.Vector2();
  private wet = 0;
  private surfaced = false;

  constructor(...args: ConstructorParameters<typeof Monster>) {
    super(...args);
    this.submerge();
  }

  /** Hidden under the water it can be neither seen nor struck. */
  get alive() {
    return super.alive && !this.hidden;
  }

  takeDamage(amount: number, crit: boolean, from: THREE.Vector3): number {
    if (this.hidden) return 0;
    return super.takeDamage(amount, crit, from);
  }

  reset() {
    super.reset();
    this.submerge();
  }

  private submerge() {
    this.phase = 'lurk';
    this.hidden = true;
    this.awake = false;
    this.state = 'idle';
    this.position.set(this.spawn.pos.x, LURK_Y, this.spawn.pos.z);
    this.sync();
  }

  update(dt: number, ctx: MonsterContext) {
    if (this.state === 'dead' || (this.phase === 'land' && this.state !== 'return')) {
      super.update(dt, ctx);
      if (this.state !== 'dead') this.drip(dt, ctx);
      return;
    }
    const p = ctx.player;
    const dist = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
    if (this.phase === 'lurk') this.lurk(dt, ctx, dist);
    else if (this.phase === 'rise') this.rise(dt, ctx);
    else if (this.phase === 'crawl') this.crawl(dt, ctx);
    else this.sink(dt, ctx, dist);
  }

  /** Still under the water: a ripple and some bubbles now and then; surfaces when the hero is near (or its brood stirs). */
  private lurk(dt: number, ctx: MonsterContext, dist: number) {
    const p = ctx.player;
    if (this.dormant) return;
    if (dist < 40) {
      this.fxTimer -= dt;
      if (this.fxTimer <= 0) {
        this.fxTimer = 2.2 + Math.random() * 3;
        const x = this.position.x + (Math.random() - 0.5) * 0.8;
        const z = this.position.z + (Math.random() - 0.5) * 0.8;
        ripple(ctx.effects, x, z, 0.9 + Math.random() * 0.5, 2.4, 0.35);
        for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
          ctx.effects.mote(new THREE.Vector3(x + (Math.random() - 0.5) * 0.4, WATER + 0.02, z + (Math.random() - 0.5) * 0.4), new THREE.Vector3(0, 0.15 + Math.random() * 0.25, 0), 0.5 + Math.random() * 0.6, 0.05 + Math.random() * 0.04, BUBBLE_COLOR);
        }
      }
    }
    if (dist > 30) return;
    const near = p.alive && dist < this.def.aggro * (this.elite ? 1.2 : 1);
    // The first of a brood to rise brings the rest up after it.
    const roused = !near && ctx.monsters.some((o) => o !== this && o.spawn.pack === this.spawn.pack && o instanceof SurfacingLeech && o.phase !== 'lurk' && o.phase !== 'sink' && o.state !== 'dead');
    if (near || roused) {
      this.phase = 'rise';
      this.surfaced = false;
      this.t = roused ? -0.2 - Math.random() * 0.9 : 0;
      this.pickLanding(ctx);
      const to = new THREE.Vector2(this.landing.x - this.position.x, this.landing.y - this.position.z);
      this.yaw = Math.atan2(to.x, to.y) + (Math.random() - 0.5) * 0.6;
      this.state = 'chase';
      this.awake = true;
    }
  }

  /** Breaks the surface: heaves up from the deep, rears and thrashes. */
  private rise(dt: number, ctx: MonsterContext) {
    const fx = ctx.effects;
    const before = this.t;
    this.t += dt;
    if (this.t < 0) return;
    const rig = this.body.rig;
    if (!this.surfaced) {
      this.surfaced = true;
      this.hidden = false;
      rig.root.visible = true;
      audio.voice(this.kind, 'aggro', this.position, 1);
      this.body.emerge?.(RISE_SECS);
      audio.splash(this.position);
      ripple(fx, this.position.x, this.position.z, 2.8, 1.6, 0.7);
      ripple(fx, this.position.x, this.position.z, 1.5, 1.1, 0.5);
      this.splashUp(fx, 26, 1.2);
    }
    const k = Math.min(1, this.t / RISE_SECS);
    const up = 1 - Math.pow(1 - Math.min(1, k / 0.45), 3);
    this.position.y = Math.max(this.groundY(ctx), LURK_Y + (SWIM_Y - LURK_Y) * up);
    // Lurches a little toward the bank as it comes up.
    this.advance(dt, 0.35 * k);
    if (Math.random() < dt * 2) ripple(fx, this.position.x, this.position.z, 1.2 + Math.random(), 1.3, 0.35);
    if (k > 0.5 && before / RISE_SECS <= 0.5) {
      this.splashUp(fx, 14, 0.8);
      audio.splash(this.position);
    }
    this.wet = 1;
    this.drip(dt, ctx, 3);
    rig.update(dt, 1.4);
    this.sync();
    if (k >= 1) {
      this.phase = 'crawl';
      this.t = 0;
    }
  }

  /** Drags itself through the shallows to the bank, slow in the water, quicker as it finds its belly on mud. */
  private crawl(dt: number, ctx: MonsterContext) {
    this.t += dt;
    const fx = ctx.effects;
    const depth = Math.max(0, WATER - ctx.height(this.position.x, this.position.z));
    const shallow = 1 - Math.min(1, depth / 0.7);
    const target = 0.7 + (this.def.speed * 0.65 - 0.7) * shallow * shallow;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * 3));
    const d = this.advance(dt, this.speed);
    this.position.y = Math.max(this.groundY(ctx), SWIM_Y);
    this.wet = 1;
    this.drip(dt, ctx, 1.6);
    if (depth > 0.05) {
      this.fxTimer -= dt;
      if (this.fxTimer <= 0) {
        // A wake behind it and a slop of water ahead.
        this.fxTimer = 0.5 + Math.random() * 0.3;
        ripple(fx, this.position.x, this.position.z, 1.4, 1.5, 0.3);
        if (Math.random() < 0.4) audio.splash(this.position);
      }
    }
    this.body.rig.update(dt, Math.max(this.speed, 1.1));
    this.sync();
    if (d < 0.3 || (this.t > 10 && ctx.nav.walkable(this.position.x, this.position.z))) {
      // On land: the normal hunt takes over from here.
      this.phase = 'land';
      this.path = [];
      this.state = 'chase';
    }
  }

  /** Lost the hero: slides back into the water and sinks out of sight. */
  private sink(dt: number, ctx: MonsterContext, dist: number) {
    const p = ctx.player;
    const home = this.spawn.pos;
    this.phase = 'sink';
    if (p.alive && dist < this.def.aggro * 0.8) {
      this.phase = 'crawl';
      this.t = 0;
      this.state = 'chase';
      this.pickLanding(ctx);
      return;
    }
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.1 * dt);
    this.speed += (1.6 - this.speed) * (1 - Math.exp(-dt * 3));
    this.landing.set(home.x, home.z);
    const d = this.advance(dt, this.speed);
    const ground = this.groundY(ctx);
    const under = Math.min(1, Math.max(0, d < 1.5 ? 1 - d / 1.5 : 0));
    this.position.y = Math.max(ground, SWIM_Y + (LURK_Y - SWIM_Y) * under);
    this.body.rig.update(dt, this.speed);
    this.sync();
    if (d < 0.2) {
      ripple(ctx.effects, this.position.x, this.position.z, 1.6, 1.4, 0.5);
      this.hp = this.maxHp;
      this.submerge();
    }
  }

  private groundY(ctx: MonsterContext) {
    return ctx.height(this.position.x, this.position.z);
  }

  /** Moves straight for the landing point (ignoring the nav grid), turning toward it. Returns the distance left. */
  private advance(dt: number, speed: number) {
    const to = new THREE.Vector2(this.landing.x - this.position.x, this.landing.y - this.position.z);
    const d = to.length();
    if (d > 0.01) {
      this.turn(Math.atan2(to.x, to.y), dt, 3);
      // Only moves the way it faces, so it swings round before it goes.
      const fwd = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
      const step = Math.min(d, speed * dt * Math.max(0, fwd.dot(to) / d));
      this.position.x += fwd.x * step;
      this.position.z += fwd.y * step;
    }
    return d;
  }

  /** The nearest bank it can hunt from, leaning toward the hero, a step in from the edge. */
  private pickLanding(ctx: MonsterContext) {
    const nav = ctx.nav;
    const p = ctx.player.position;
    const x0 = this.position.x;
    const z0 = this.position.z;
    const cands: { x: number; z: number; s: number }[] = [];
    for (let r = 0.5; r <= 9; r += 0.5) {
      const n = Math.max(8, Math.round(r * 8));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = x0 + Math.cos(a) * r;
        const z = z0 + Math.sin(a) * r;
        // A step in from the edge, so it isn't left teetering on it.
        if (!nav.walkable(x, z) || !nav.walkable(x + Math.cos(a) * 0.7, z + Math.sin(a) * 0.7)) continue;
        cands.push({ x: x + Math.cos(a) * 0.5, z: z + Math.sin(a) * 0.5, s: r + 0.3 * Math.hypot(p.x - x, p.z - z) });
      }
      if (cands.length > 12) break;
    }
    cands.sort((a, b) => a.s - b.s);
    // Prefer a bank that connects to where the hero stands, not a lone hummock.
    const here = new THREE.Vector2(p.x, p.z);
    for (const c of cands.slice(0, 4)) {
      if (nav.findPath(new THREE.Vector2(c.x, c.z), here)) {
        this.landing.set(c.x, c.z);
        return;
      }
    }
    if (cands.length) this.landing.set(cands[0].x, cands[0].z);
    else this.landing.copy(nav.nearestWalkable(x0, z0) ?? here);
  }

  /** A crown of blood water thrown up as it breaks the surface. */
  private splashUp(fx: Effects, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.5;
      fx.mote(
        new THREE.Vector3(this.position.x + Math.cos(a) * r, WATER + 0.05, this.position.z + Math.sin(a) * r),
        new THREE.Vector3(Math.cos(a) * (0.6 + Math.random() * 1.4) * power, (2 + Math.random() * 2.5) * power, Math.sin(a) * (0.6 + Math.random() * 1.4) * power),
        0.8 + Math.random() * 0.6,
        0.05 + Math.random() * 0.07,
        WATER_COLOR,
        false,
      );
    }
  }

  /** Blood water streaming off its body; it dries off a few seconds after it leaves the water. */
  private drip(dt: number, ctx: MonsterContext, rate = 1) {
    if (this.phase === 'land') this.wet = Math.max(0, this.wet - dt / 4);
    if (this.wet <= 0 || this.hidden) return;
    this.dripTimer -= dt * rate * (0.25 + this.wet);
    while (this.dripTimer <= 0) {
      this.dripTimer += 0.05;
      // Anywhere along its length, off the raised front most of all.
      const along = (Math.random() - 0.35) * 1.4 * 1;
      const side = (Math.random() - 0.5) * 0.25;
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const lift = this.phase === 'rise' ? Math.max(0, along) * 0.9 : 0.1;
      const at = new THREE.Vector3(this.position.x + fx * along + fz * side, this.position.y + 0.15 + lift * Math.random(), this.position.z + fz * along - fx * side);
      ctx.effects.mote(at, new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.2 - Math.random() * 0.4, (Math.random() - 0.5) * 0.4), 0.6 + Math.random() * 0.5, 0.035 + Math.random() * 0.04, WATER_COLOR, false);
    }
  }
}
