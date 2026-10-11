import * as THREE from 'three';

// Shared combat types and the floating damage numbers.

export interface Combatant {
  readonly position: THREE.Vector3;
  /** Body radius on the ground plane, for reach and separation. */
  readonly radius: number;
  /** Height of the head above the feet, for numbers and projectiles. */
  readonly height: number;
  hp: number;
  maxHp: number;
  readonly alive: boolean;
  /** Applies damage after the target's own mitigation; returns damage dealt. */
  takeDamage(amount: number, crit: boolean, from: THREE.Vector3): number;
}

export interface HitRoll {
  amount: number;
  crit: boolean;
}

export function rollDamage(min: number, max: number, critChance: number, critMult = 1.8): HitRoll {
  const base = min + Math.random() * (max - min);
  const crit = Math.random() < critChance;
  return { amount: Math.max(1, Math.round(base * (crit ? critMult : 1))), crit };
}

/** Armour soaks a share of each hit: 50 armour halves an equal-level blow. */
export function mitigate(amount: number, armor: number) {
  return Math.max(1, Math.round(amount * (50 / (50 + armor))));
}

type Floater = { el: HTMLDivElement; pos: THREE.Vector3; vel: THREE.Vector2; age: number; life: number };

/**
 * Damage numbers that pop above a target and drift up and aside. They are DOM
 * text positioned from world space each frame, so they stay crisp at any zoom.
 */
export class FloatingText {
  private layer: HTMLDivElement;
  private items: Floater[] = [];
  private v = new THREE.Vector3();

  constructor() {
    this.layer = document.createElement('div');
    this.layer.className = 'floaters';
    const style = document.createElement('style');
    style.textContent = `
      .floaters { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 4; }
      .floater { position: absolute; left: 0; top: 0; font: 700 17px/1 'Cinzel', Georgia, serif; color: #f0e2c8;
        text-shadow: 0 0 3px #000, 0 1px 2px #000, 0 0 8px rgba(0,0,0,.8); white-space: nowrap; will-change: transform, opacity; }
      .floater.crit { font-size: 24px; color: #ffcf5a; }
      .floater.hurt { color: #ff4a3a; }
      .floater.heal { color: #7ae07a; }
      .floater.info { font: 600 14px/1 'Cinzel', Georgia, serif; color: #e8c890; letter-spacing: .06em; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(this.layer);
  }

  spawn(text: string, pos: THREE.Vector3, kind: '' | 'crit' | 'hurt' | 'heal' | 'info' = '', life = 0.9) {
    const el = document.createElement('div');
    el.className = `floater ${kind}`;
    el.textContent = text;
    this.layer.appendChild(el);
    const side = (Math.random() - 0.5) * 2;
    this.items.push({ el, pos: pos.clone(), vel: new THREE.Vector2(side * 30, kind === 'crit' ? -95 : -75), age: 0, life });
  }

  update(dt: number, camera: THREE.Camera) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.age += dt;
      if (f.age >= f.life) {
        f.el.remove();
        this.items.splice(i, 1);
        continue;
      }
      this.v.copy(f.pos).project(camera);
      const k = f.age / f.life;
      const x = (this.v.x * 0.5 + 0.5) * w + f.vel.x * f.age;
      // Pops up fast then slows, like it's been flicked.
      const y = (-this.v.y * 0.5 + 0.5) * h + f.vel.y * (1 - Math.pow(1 - Math.min(1, k * 1.6), 2)) * 0.8;
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.7 : 1.3 - Math.min(0.3, (k - 0.12) * 1.5);
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${pop})`;
      f.el.style.opacity = String(k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1);
    }
  }

  clear() {
    for (const f of this.items) f.el.remove();
    this.items = [];
  }
}
