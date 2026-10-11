import * as THREE from 'three';
import type { HeightFn } from '../procgen/terrain';
import { fbm2, clamp01, smoothstep } from '../procgen/noise';

// Combat effects for one area: blood spray and pooled splats, sword arcs,
// blood bolts with trails, shockwaves and flashes. Everything is pooled or
// short-lived and lives under one group in the area's scene.

const MAX_DROPS = 900;
const MAX_SPLATS = 70;

/** Splatter alpha mask: a lumpy blot with droplets thrown around it. */
function splatTexture(size = 128, seed = 3): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size - 0.5;
      const v = y / size - 0.5;
      const r = Math.hypot(u, v) * 2;
      const a = Math.atan2(v, u);
      const edge = 0.55 + fbm2(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + 5, 4, seed) * 0.35;
      let m = 1 - smoothstep(edge - 0.06, edge + 0.02, r);
      // Droplets beyond the main blot.
      const drops = fbm2(u * 14, v * 14, 2, seed + 4) * 0.5 + 0.5;
      m = Math.max(m, smoothstep(0.78, 0.84, drops) * (1 - smoothstep(0.7, 1.0, r)));
      const i = (y * size + x) * 4;
      const depth = clamp01(1 - r / edge) * 0.5 + 0.5; // darker, thicker centre
      data[i] = Math.round(255 * depth);
      data[i + 1] = data[i + 2] = data[i];
      data[i + 3] = Math.round(255 * clamp01(m));
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const dropMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { pixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
  vertexShader: /* glsl */ `
    uniform float pixelRatio;
    attribute vec4 dropColor;
    attribute float dropSize;
    varying vec4 vColor;
    void main() {
      vColor = dropColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = dropSize * pixelRatio * (320.0 / -mv.z);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec4 vColor;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5 || vColor.a < 0.01) discard;
      // A tiny highlight makes the drops read as wet.
      float spec = smoothstep(0.18, 0.0, length(c - vec2(-0.15, -0.15)));
      gl_FragColor = vec4(vColor.rgb + spec * 0.12, vColor.a * smoothstep(0.5, 0.35, d));
    }
  `,
});

type Drop = { pos: THREE.Vector3; vel: THREE.Vector3; age: number; life: number; size: number; color: THREE.Color; glow: boolean; landed: boolean };
type Timed = { obj: THREE.Object3D; age: number; life: number; update: (k: number, dt: number) => void; dispose?: () => void };

export interface Bolt {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  age: number;
  life: number;
  obj: THREE.Object3D;
  light: THREE.PointLight | null;
  /** Return true when the bolt hits something and should burst. */
  test: (pos: THREE.Vector3) => boolean;
}

export class Effects {
  readonly group = new THREE.Group();
  private drops: Drop[] = [];
  private dropGeo = new THREE.BufferGeometry();
  private dropPos = new Float32Array(MAX_DROPS * 3);
  private dropCol = new Float32Array(MAX_DROPS * 4);
  private dropSize = new Float32Array(MAX_DROPS);
  private glowGeo = new THREE.BufferGeometry();
  private splats: THREE.Mesh[] = [];
  private splatIndex = 0;
  private splatMat: THREE.MeshStandardMaterial;
  private timed: Timed[] = [];
  private bolts: Bolt[] = [];
  private shake = 0;
  /**
   * Point lights for flashes and bolts. They stay in the scene at zero
   * intensity when idle: adding or removing a light makes three.js recompile
   * every lit material, which hitches the frame.
   */
  private lights: THREE.PointLight[] = [];
  private freeLights: THREE.PointLight[] = [];

  constructor(private height: HeightFn) {
    this.dropGeo.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dropGeo.setAttribute('dropColor', new THREE.BufferAttribute(this.dropCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.dropGeo.setAttribute('dropSize', new THREE.BufferAttribute(this.dropSize, 1).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(this.dropGeo, dropMaterial);
    pts.frustumCulled = false;
    pts.renderOrder = 15;
    this.group.add(pts);
    // Glowing sparks share the buffers' layout but blend additively.
    this.glowGeo = this.dropGeo.clone();
    const glowMat = dropMaterial.clone();
    glowMat.blending = THREE.AdditiveBlending;
    const glowPts = new THREE.Points(this.glowGeo, glowMat);
    glowPts.frustumCulled = false;
    glowPts.renderOrder = 16;
    this.group.add(glowPts);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 2);
      this.lights.push(l);
      this.freeLights.push(l);
      this.group.add(l);
    }

    this.splatMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.16, 0.008, 0.006),
      alphaMap: splatTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 0.18,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /** Spray of blood (or ichor) from a wound, thrown away from `from`. */
  blood(at: THREE.Vector3, from: THREE.Vector3, count = 18, color = new THREE.Color(0.22, 0.01, 0.008), power = 1) {
    const away = new THREE.Vector3().subVectors(at, from).setY(0);
    if (away.lengthSq() < 1e-4) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    away.normalize();
    for (let i = 0; i < count; i++) {
      const v = away
        .clone()
        .multiplyScalar((1.5 + Math.random() * 3) * power)
        .add(new THREE.Vector3((Math.random() - 0.5) * 2.4, 1 + Math.random() * 2.8, (Math.random() - 0.5) * 2.4).multiplyScalar(power));
      this.addDrop(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2)), v, 0.9 + Math.random() * 1.4, 0.05 + Math.random() * 0.08, color, false);
    }
  }

  sparks(at: THREE.Vector3, count: number, color: THREE.Color, speed = 3, life = 0.6) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
      this.addDrop(at.clone(), v, life * (0.5 + Math.random() * 0.8), 0.06 + Math.random() * 0.06, color, true);
    }
  }

  private addDrop(pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number, color: THREE.Color, glow: boolean) {
    if (this.drops.length >= MAX_DROPS) this.drops.shift();
    this.drops.push({ pos, vel, age: 0, life, size, color, glow, landed: false });
  }

  /** Pool of blood soaking into the ground. */
  splat(x: number, z: number, size: number) {
    let m = this.splats[this.splatIndex % MAX_SPLATS];
    if (!m) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.splatMat);
      m.receiveShadow = true;
      m.renderOrder = 2;
      this.splats.push(m);
      this.group.add(m);
    }
    this.splatIndex++;
    // Sit on the terrain, tilted to its slope.
    const e = 0.3;
    const y = this.height(x, z);
    const nx = this.height(x - e, z) - this.height(x + e, z);
    const nz = this.height(x, z - e) - this.height(x, z + e);
    const n = new THREE.Vector3(nx, 2 * e, nz).normalize();
    m.position.set(x, y + 0.03, z);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28));
    m.scale.set(0.01, 1, 0.01);
    const target = size * (0.8 + Math.random() * 0.4);
    // Spreads out over a second or so.
    this.after(1.2, m, (k) => m.scale.set(target * (0.3 + 0.7 * Math.sqrt(k)), 1, target * (0.3 + 0.7 * Math.sqrt(k))));
  }

  /** Run `update(k)` for `life` seconds on an object (removed afterwards unless `keep`). */
  after(life: number, obj: THREE.Object3D, update: (k: number, dt: number) => void, dispose?: () => void) {
    this.timed.push({ obj, age: 0, life, update, dispose });
  }

  /** Pale crescent left by a sword stroke, around `center` facing `yaw`. */
  slash(center: THREE.Vector3, yaw: number, radius = 1.6, color = new THREE.Color(1.6, 0.9, 0.7), spin = false) {
    const arc = spin ? Math.PI * 2 : 2.4;
    const geo = new THREE.RingGeometry(radius * 0.45, radius, 40, 1, -arc / 2, arc);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { k: { value: 0 }, color: { value: color }, arc: { value: arc } },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float k, arc;
        uniform vec3 color;
        varying vec2 vP;
        void main() {
          float a = atan(vP.y, vP.x) / (arc * 0.5); // -1..1 across the arc
          float r = length(vP);
          // Bright leading edge sweeping across, fading behind it.
          float sweep = smoothstep(-1.0, 1.0, a - (k * 2.6 - 1.3));
          float edge = smoothstep(0.0, 0.25, 1.0 - abs(a));
          float band = smoothstep(0.0, 1.0, fract(r));
          float alpha = (1.0 - sweep) * edge * (1.0 - k) * 0.85 * (0.6 + 0.4 * band);
          gl_FragColor = vec4(color * alpha, alpha);
        }
      `,
    });
    const m = new THREE.Mesh(geo, mat);
    // Lay the ring flat with the middle of the arc pointing along local +Z
    // (the direction a character faces at yaw 0).
    m.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    const holder = new THREE.Group();
    holder.position.copy(center);
    holder.rotation.y = yaw;
    holder.add(m);
    holder.renderOrder = 18;
    m.renderOrder = 18;
    this.group.add(holder);
    this.after(spin ? 0.42 : 0.22, holder, (k) => (mat.uniforms.k.value = k), () => {
      geo.dispose();
      mat.dispose();
    });
  }

  /** Expanding dust ring where something heavy hit the ground. */
  shockwave(at: THREE.Vector3, radius = 3, color = new THREE.Color(0.9, 0.45, 0.3)) {
    const geo = new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at).setY(this.height(at.x, at.z) + 0.08);
    this.group.add(m);
    this.after(0.5, m, (k) => {
      const s = 0.3 + k * radius;
      m.scale.set(s, 1, s);
      mat.opacity = (1 - k) * 0.9;
    }, () => {
      geo.dispose();
      mat.dispose();
    });
    this.addShake(0.35);
  }

  /** Brief point-light flash (hits, casts). */
  flash(at: THREE.Vector3, color: number, intensity = 20, range = 6, life = 0.25) {
    const l = this.borrowLight(color, intensity, range);
    if (!l) return;
    l.position.copy(at);
    const holder = new THREE.Object3D();
    this.group.add(holder);
    this.after(life, holder, (k) => (l.intensity = intensity * (1 - k) * (1 - k)), () => this.returnLight(l));
  }

  private borrowLight(color: THREE.ColorRepresentation, intensity: number, range: number): THREE.PointLight | null {
    const l = this.freeLights.pop();
    if (!l) return null;
    l.color.set(color);
    l.intensity = intensity;
    l.distance = range;
    return l;
  }

  private returnLight(l: THREE.PointLight) {
    l.intensity = 0;
    this.freeLights.push(l);
  }

  /** Column of light for a level up. */
  pillar(at: THREE.Vector3, color = new THREE.Color(2.0, 1.4, 0.6)) {
    const geo = new THREE.CylinderGeometry(0.7, 0.9, 8, 24, 1, true).translate(0, 4, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { k: { value: 0 }, color: { value: color } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float k; uniform vec3 color; varying vec2 vUv;
        void main() { float a = (1.0 - vUv.y) * (1.0 - vUv.y) * sin(k * 3.14159) * 0.8; gl_FragColor = vec4(color * a, a); }
      `,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    this.group.add(m);
    this.after(1.6, m, (k) => {
      mat.uniforms.k.value = k;
      m.scale.set(1 + k * 0.3, 1, 1 + k * 0.3);
    }, () => {
      geo.dispose();
      mat.dispose();
    });
    this.sparks(at.clone().setY(at.y + 0.3), 40, new THREE.Color(2.2, 1.5, 0.6), 4, 1.4);
    this.flash(at.clone().setY(at.y + 1.5), 0xffc070, 40, 10, 1.2);
  }

  /** Glowing blood bolt flying from `from` along `dir` until `test` says it hit. */
  bolt(from: THREE.Vector3, dir: THREE.Vector3, test: (p: THREE.Vector3) => boolean, onHit: (p: THREE.Vector3) => void, speed = 10) {
    const obj = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.25), fog: false }));
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.05, 0.03), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    obj.add(core, halo);
    const light = this.borrowLight(0xff2a14, 18, 7);
    obj.position.copy(from);
    this.group.add(obj);
    const b: Bolt = { pos: obj.position, dir: dir.clone().normalize(), speed, age: 0, life: 2.4, obj, light, test };
    (b as Bolt & { onHit: typeof onHit }).onHit = onHit;
    this.bolts.push(b);
  }

  addShake(amount: number) {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Camera shake offset for this frame. */
  shakeOffset(t: number): THREE.Vector3 {
    const s = this.shake * this.shake * 0.25;
    return new THREE.Vector3(Math.sin(t * 61) * s, Math.sin(t * 47 + 1) * s * 0.6, Math.cos(t * 53) * s);
  }

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 2.2);
    // Drops: ballistic until they land, then a quick fade where they fell.
    let n = 0;
    let g = 0;
    const glowPos = this.glowGeo.getAttribute('position') as THREE.BufferAttribute;
    const glowCol = this.glowGeo.getAttribute('dropColor') as THREE.BufferAttribute;
    const glowSize = this.glowGeo.getAttribute('dropSize') as THREE.BufferAttribute;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age >= d.life) {
        this.drops.splice(i, 1);
        continue;
      }
      if (!d.landed) {
        d.vel.y -= (d.glow ? 3 : 14) * dt;
        d.vel.multiplyScalar(d.glow ? 1 - dt * 1.5 : 1);
        d.pos.addScaledVector(d.vel, dt);
        const gy = this.height(d.pos.x, d.pos.z) + 0.02;
        if (d.pos.y < gy) {
          d.pos.y = gy;
          if (d.glow) d.vel.set(0, 0, 0);
          d.landed = !d.glow;
        }
      }
      const fade = d.landed ? 1 - (d.age - (d.life - 0.6)) / 0.6 : d.glow ? 1 - d.age / d.life : 1;
      const a = Math.min(1, Math.max(0, fade));
      if (d.glow) {
        if (g >= MAX_DROPS) continue;
        glowPos.setXYZ(g, d.pos.x, d.pos.y, d.pos.z);
        glowCol.setXYZW(g, d.color.r * a, d.color.g * a, d.color.b * a, a);
        glowSize.setX(g, d.size * (d.landed ? 1.6 : 1));
        g++;
      } else {
        this.dropPos[n * 3] = d.pos.x;
        this.dropPos[n * 3 + 1] = d.pos.y;
        this.dropPos[n * 3 + 2] = d.pos.z;
        this.dropCol[n * 4] = d.color.r;
        this.dropCol[n * 4 + 1] = d.color.g;
        this.dropCol[n * 4 + 2] = d.color.b;
        this.dropCol[n * 4 + 3] = a;
        this.dropSize[n] = d.size * (d.landed ? 1.7 : 1);
        n++;
      }
    }
    this.dropGeo.setDrawRange(0, n);
    this.glowGeo.setDrawRange(0, g);
    for (const name of ['position', 'dropColor', 'dropSize']) {
      (this.dropGeo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
      (this.glowGeo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }

    for (let i = this.timed.length - 1; i >= 0; i--) {
      const t = this.timed[i];
      t.age += dt;
      const k = Math.min(1, t.age / t.life);
      t.update(k, dt);
      if (k >= 1) {
        this.timed.splice(i, 1);
        if (!this.splats.includes(t.obj as THREE.Mesh)) {
          t.obj.parent?.remove(t.obj);
          t.dispose?.();
        }
      }
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i] as Bolt & { onHit: (p: THREE.Vector3) => void };
      b.age += dt;
      b.pos.addScaledVector(b.dir, b.speed * dt);
      b.light?.position.copy(b.pos);
      // Trail of glowing motes.
      if (Math.random() < 0.9) this.addDrop(b.pos.clone(), new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4), 0.35, 0.12, new THREE.Color(2.4, 0.15, 0.08), true);
      const ground = b.pos.y < this.height(b.pos.x, b.pos.z) + 0.1;
      const hit = b.test(b.pos);
      if (hit || ground || b.age > b.life) {
        this.sparks(b.pos.clone(), 18, new THREE.Color(2.6, 0.2, 0.1), 3.5, 0.5);
        this.flash(b.pos.clone(), 0xff3018, 25, 6, 0.3);
        if (hit) b.onHit(b.pos.clone());
        if (b.light) this.returnLight(b.light);
        this.group.remove(b.obj);
        this.bolts.splice(i, 1);
      }
    }
  }
}
