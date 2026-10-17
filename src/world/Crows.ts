import * as THREE from 'three';
import { mulberry32, range } from '../procgen/noise';
import type { HeightFn } from '../procgen/terrain';

// Carrion crows of the pilgrim road. They strut and peck on the cobbles and
// on the verges until the hero comes near, then burst up with a clatter of
// wings, wheel away over the dead trees and come down somewhere else along
// the road. A few more circle high overhead all the time, their shadows
// sweeping the ground.

interface Crow {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Object3D;
  wings: THREE.Object3D[];
  tail: THREE.Object3D;
  state: 'ground' | 'fly' | 'circle';
  pos: THREE.Vector3;
  yaw: number;
  /** Ground: seconds to the next hop or peck. Flight: progress along the path. */
  t: number;
  peck: number;
  hop: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  dur: number;
  /** Circling: centre, radius, height and phase. */
  orbit: { c: THREE.Vector3; r: number; h: number; a: number; w: number };
  flap: number;
}

function crowParts(feather: THREE.Material, beak: THREE.Material, eye: THREE.Material) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 7).scale(0.85, 0.8, 1.55), feather);
  torso.position.set(0, 0.17, 0);
  torso.castShadow = true;
  body.add(torso);
  const head = new THREE.Group();
  head.position.set(0, 0.25, 0.14);
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.058, 9, 7).scale(0.9, 0.95, 1.1), feather);
  head.add(skull);
  const bill = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 6).rotateX(Math.PI / 2).translate(0, -0.008, 0.085), beak);
  head.add(bill);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.009, 5, 4), eye);
    e.position.set(s * 0.038, 0.012, 0.03);
    head.add(e);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.17, -0.14);
  body.add(tail);
  const fan = new THREE.Shape([new THREE.Vector2(-0.025, 0), new THREE.Vector2(0.025, 0), new THREE.Vector2(0.06, -0.17), new THREE.Vector2(-0.06, -0.17)]);
  const tailMesh = new THREE.Mesh(new THREE.ShapeGeometry(fan).rotateX(Math.PI / 2), feather);
  tailMesh.rotation.x = -0.25;
  tail.add(tailMesh);
  // Wings: long fingered blades, folded along the back on the ground, spread in flight.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.05);
  wingShape.lineTo(0.12, 0.06);
  wingShape.lineTo(0.3, 0.02);
  for (let i = 0; i < 5; i++) {
    const x = 0.34 - i * 0.035;
    wingShape.lineTo(x + 0.02, -0.03 - i * 0.012);
    wingShape.lineTo(x - 0.005, -0.015 - i * 0.01);
  }
  wingShape.lineTo(0.12, -0.08);
  wingShape.lineTo(0, -0.07);
  const wingGeo = new THREE.ShapeGeometry(wingShape).rotateX(-Math.PI / 2);
  const wings: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.06, 0.21, 0.02);
    const w = new THREE.Mesh(wingGeo, feather);
    w.scale.x = s;
    w.castShadow = true;
    pivot.add(w);
    body.add(pivot);
    wings.push(pivot);
  }
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 4), beak);
    leg.position.set(s * 0.03, 0.05, 0.01);
    body.add(leg);
  }
  return { root, body, head, wings, tail };
}

export class Crows {
  readonly group = new THREE.Group();
  private crows: Crow[] = [];
  private rng = mulberry32(77);

  /**
   * `perches` are ground spots the crows settle on (along the road); `count`
   * of them start on the ground and `circling` wheel overhead.
   */
  constructor(
    private heightAt: HeightFn,
    private perches: THREE.Vector3[],
    count: number,
    circling: number,
    private onTakeOff?: (at: THREE.Vector3) => void,
  ) {
    const feather = new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide });
    const beak = new THREE.MeshStandardMaterial({ color: 0x161412, roughness: 0.35 });
    const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.45, 0.2) });
    for (let i = 0; i < count + circling; i++) {
      const parts = crowParts(feather, beak, eye);
      const s = range(this.rng, 0.95, 1.2);
      parts.root.scale.setScalar(s);
      const p = this.perch();
      const c: Crow = {
        ...parts,
        state: i < count ? 'ground' : 'circle',
        pos: p,
        yaw: this.rng() * Math.PI * 2,
        t: this.rng() * 2,
        peck: 0,
        hop: 0,
        from: p.clone(),
        to: p.clone(),
        dur: 1,
        orbit: { c: this.perch(), r: range(this.rng, 6, 14), h: range(this.rng, 9, 15), a: this.rng() * Math.PI * 2, w: range(this.rng, 0.25, 0.45) * (this.rng() < 0.5 ? -1 : 1) },
        flap: this.rng() * 10,
      };
      this.crows.push(c);
      this.group.add(c.root);
    }
  }

  private perch(): THREE.Vector3 {
    const p = this.perches[Math.floor(this.rng() * this.perches.length)];
    const x = p.x + range(this.rng, -1.5, 1.5);
    const z = p.z + range(this.rng, -1.5, 1.5);
    return new THREE.Vector3(x, this.heightAt(x, z), z);
  }

  update(dt: number, t: number, hero: THREE.Vector3) {
    for (const c of this.crows) {
      c.flap += dt;
      if (c.state === 'ground') this.walk(c, dt, hero);
      else if (c.state === 'fly') this.fly(c, dt);
      else this.circle(c, dt, t);
      c.root.position.copy(c.pos);
      c.root.rotation.y = c.yaw;
    }
  }

  private fold(c: Crow) {
    for (const [i, w] of c.wings.entries()) {
      const s = i === 0 ? -1 : 1;
      w.rotation.set(0.1, s * 1.45, s * -0.15);
    }
  }

  private spread(c: Crow, beat: number) {
    for (const [i, w] of c.wings.entries()) {
      const s = i === 0 ? -1 : 1;
      w.rotation.set(0, 0, s * beat);
    }
  }

  private walk(c: Crow, dt: number, hero: THREE.Vector3) {
    this.fold(c);
    c.body.rotation.x = 0;
    // Startled: up and away from the hero, toward another perch.
    const d = Math.hypot(hero.x - c.pos.x, hero.z - c.pos.z);
    if (d < 4.5) {
      c.state = 'fly';
      c.from.copy(c.pos);
      let to = this.perch();
      for (let i = 0; i < 6 && Math.hypot(to.x - hero.x, to.z - hero.z) < 18; i++) to = this.perch();
      c.to.copy(to);
      c.t = 0;
      c.dur = Math.max(3, c.from.distanceTo(c.to) / 7);
      this.onTakeOff?.(c.pos);
      return;
    }
    c.t -= dt;
    // Peck: head dips to the ground and back.
    if (c.peck > 0) {
      c.peck = Math.max(0, c.peck - dt * 3);
      const k = Math.sin(c.peck * Math.PI);
      c.body.rotation.x = k * 0.55;
      c.head.rotation.x = k * 0.6;
    } else c.head.rotation.x = Math.sin(c.flap * 1.7) * 0.08;
    // Hop: a little bounce forward.
    if (c.hop > 0) {
      c.hop = Math.max(0, c.hop - dt * 4);
      const k = 1 - c.hop;
      c.pos.x += Math.sin(c.yaw) * dt * 1.2;
      c.pos.z += Math.cos(c.yaw) * dt * 1.2;
      c.pos.y = this.heightAt(c.pos.x, c.pos.z) + Math.sin(k * Math.PI) * 0.08;
    }
    if (c.t <= 0) {
      const r = this.rng();
      if (r < 0.45) c.peck = 1;
      else if (r < 0.8) {
        c.yaw += range(this.rng, -0.9, 0.9);
        c.hop = 1;
      } else c.yaw += range(this.rng, -1.5, 1.5);
      c.t = range(this.rng, 0.5, 2.2);
    }
    c.tail.rotation.x = Math.sin(c.flap * 2.3) * 0.05;
  }

  private fly(c: Crow, dt: number) {
    c.t += dt / c.dur;
    const k = Math.min(1, c.t);
    // An arc: climb hard, glide, then drop onto the new perch.
    const lift = Math.sin(k * Math.PI) * (6 + c.dur) + (1 - k) * 0;
    const prev = c.pos.clone();
    c.pos.lerpVectors(c.from, c.to, k);
    c.pos.y = THREE.MathUtils.lerp(c.from.y, c.to.y, k) + lift;
    const v = c.pos.clone().sub(prev);
    if (v.lengthSq() > 1e-6) c.yaw = Math.atan2(v.x, v.z);
    c.body.rotation.x = -Math.atan2(v.y, Math.hypot(v.x, v.z) || 1e-3) * 0.6;
    // Hard flapping on take-off and landing, a glide in between.
    const hard = k < 0.25 || k > 0.85;
    this.spread(c, hard ? Math.sin(c.flap * 22) * 0.9 : 0.1 + Math.sin(c.flap * 9) * 0.25);
    c.head.rotation.x = 0;
    if (k >= 1) {
      c.state = 'ground';
      c.t = range(this.rng, 1, 3);
      c.body.rotation.x = 0;
    }
  }

  private circle(c: Crow, dt: number, t: number) {
    const o = c.orbit;
    o.a += o.w * dt;
    const x = o.c.x + Math.cos(o.a) * o.r;
    const z = o.c.z + Math.sin(o.a) * o.r;
    c.pos.set(x, this.heightAt(x, z) + o.h + Math.sin(t * 0.7 + o.r) * 0.6, z);
    c.yaw = Math.atan2(-Math.sin(o.a) * Math.sign(o.w), Math.cos(o.a) * Math.sign(o.w));
    c.body.rotation.z = -Math.sign(o.w) * 0.35;
    // Mostly gliding, a few lazy beats now and then.
    const beat = Math.sin(t * 0.4 + o.r) > 0.6 ? Math.sin(c.flap * 10) * 0.6 : 0.12;
    this.spread(c, beat);
  }
}
