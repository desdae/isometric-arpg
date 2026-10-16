import * as THREE from 'three';
import { joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { perlin3, range, type Rng } from '../../procgen/noise';
import { BasicRig, ease, hump } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Blood leech: a fat, glistening leech as long as a man is tall, grown huge
// in the flooded cells. Its red-black body is ringed with fine annuli and
// two dull orange stripes run down its back; swallowing waves bulge along
// it as it swims. The front sucker opens into a round mouth lined with
// rings of hooked teeth; a broad sucker grips at the tail. The body is one
// surface rebuilt every frame from a swimming spine: it slithers in a
// travelling S, lifts its front to sniff the air when still, rears back with
// its mouth flaring, lunges, latches and pulls away swollen.

const L = 1.6;
/** Rings along the body, and vertices around each ring. */
const N = 150;
const SEG = 20;
/** Inside the mouth: [depth behind the rim, radius as a share of it]. */
const MOUTH: [number, number][] = [
  [0.004, 0.94],
  [0.012, 0.8],
  [0.03, 0.62],
  [0.06, 0.42],
  [0.095, 0.2],
];
/** The rear sucker: a flared disc behind the tail, [depth, radius factor]. */
const TAIL: [number, number][] = [
  [0.01, 1.18],
  [0.02, 1.3],
  [0.028, 1.14],
  [0.033, 0.7],
];
const RINGS = N + 1 + MOUTH.length + TAIL.length;

const smooth = THREE.MathUtils.smoothstep;

function prof(u: number, keys: [number, number][]) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [u0, a] = keys[i - 1];
      const [u1, b] = keys[i];
      const t = (u - u0) / (u1 - u0);
      return a + (b - a) * t * t * (3 - 2 * t);
    }
  }
  return keys[keys.length - 1][1];
}
const BODY: [number, number][] = [[0, 0.06], [0.04, 0.074], [0.1, 0.088], [0.3, 0.128], [0.55, 0.148], [0.75, 0.13], [0.9, 0.096], [0.97, 0.078], [1, 0.072]];

/** A cone bent into a hook: base at the origin, along +Y, tip curling to -Z. */
function hook(len: number, r: number) {
  const g = new THREE.ConeGeometry(r, len, 5, 4).translate(0, len / 2, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    p.setZ(i, p.getZ(i) - t * t * len * 0.65);
    p.setY(i, p.getY(i) * (1 - t * 0.2));
  }
  g.computeVertexNormals();
  return g;
}

class Leech extends BasicRig {
  readonly skin: THREE.Mesh;
  readonly mouth: THREE.Object3D;
  readonly teeth: { j: THREE.Object3D; th: number; f: number }[] = [];
  dead = false;
  // Pose parameters: set by the idle/swim motion, overridden by actions.
  open = 0;
  lift = 0;
  tipDown = 0;
  sniffYaw = 0;
  shift = 0;
  bulge = 0;
  bulgeRate = 0;
  swell = 0;
  deflate = 0;
  swim = 0;
  /** A gentle resting curve for the corpse. */
  private limpBend: number;
  private bulgeT = 0;
  private positions: Float32Array;
  // Per-ring scratch.
  private px = new Float32Array(N + 1);
  private py = new Float32Array(N + 1);
  private pz = new Float32Array(N + 1);
  private rad = new Float32Array(N + 1);
  private yaw = new Float32Array(N + 1);
  private pitch = new Float32Array(N + 1);

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, 4.5, 3);
    this.limpBend = range(rng, -0.5, 0.5);
    const seed = range(rng, 0, 50);

    // The body: one indexed surface of rings, colours fixed, positions
    // rewritten every frame.
    this.positions = new Float32Array((RINGS * SEG + 2) * 3);
    const colors = new Float32Array((RINGS * SEG + 2) * 3);
    const c = new THREE.Color();
    const dark = new THREE.Color(0.022, 0.004, 0.004);
    const stripe = new THREE.Color(0.42, 0.11, 0.03);
    const belly = new THREE.Color(0.075, 0.02, 0.016);
    const margin = new THREE.Color(0.11, 0.025, 0.012);
    const maw = new THREE.Color(0.5, 0.025, 0.02);
    const throat = new THREE.Color(0.02, 0.0, 0.0);
    // Ring order: tail disc (outermost first), body tail → head, mouth.
    const ringKind: ('tail' | 'body' | 'mouth')[] = [];
    for (let k = TAIL.length - 1; k >= 0; k--) ringKind.push('tail');
    for (let i = 0; i <= N; i++) ringKind.push('body');
    for (let k = 0; k < MOUTH.length; k++) ringKind.push('mouth');
    for (let r = 0; r < RINGS; r++) {
      const kind = ringKind[r];
      const i = r - TAIL.length;
      const s = kind === 'body' ? (i / N) * L : kind === 'tail' ? 0 : L;
      for (let j = 0; j < SEG; j++) {
        const a = (j / SEG) * Math.PI * 2;
        const ca = Math.cos(a);
        const o = (r * SEG + j) * 3;
        if (kind === 'mouth') {
          const k = r - TAIL.length - N - 1;
          c.copy(maw).lerp(throat, k / (MOUTH.length - 1));
        } else if (kind === 'tail') {
          c.copy(belly).multiplyScalar(0.7);
        } else {
          const aa = Math.abs(Math.atan2(Math.sin(a), ca));
          const n = perlin3(s * 9, a * 1.3, seed, 3) * 0.5 + 0.5;
          // Dark back, two spotted stripes, a pale margin and a mottled belly.
          c.copy(dark).lerp(margin, smooth(aa, 1.2, 1.7));
          c.lerp(belly, smooth(aa, 1.9, 2.4) * (0.7 + 0.3 * n));
          const band = Math.exp(-(((aa - 0.5) / 0.13) ** 2));
          const spots = smooth(perlin3(s * 22, a * 4, seed + 7, 5), -0.15, 0.25);
          c.lerp(stripe, band * (0.35 + 0.65 * spots));
          c.multiplyScalar(0.8 + 0.4 * n);
          // Darker in each groove between annuli.
          const groove = Math.pow(0.5 + 0.5 * Math.cos((Math.PI * 2 * s) / 0.053), 8);
          c.multiplyScalar(1 - 0.45 * groove);
          // The lips of the front sucker are flushed red.
          c.lerp(maw, smooth(s, L - 0.05, L) * 0.6);
        }
        colors.set([c.r, c.g, c.b], o);
      }
    }
    // Cap centres: rear sucker, throat.
    colors.set([0.03, 0.005, 0.005], RINGS * SEG * 3);
    colors.set([throat.r, throat.g, throat.b], (RINGS * SEG + 1) * 3);
    const idx: number[] = [];
    for (let r = 0; r < RINGS - 1; r++) {
      for (let j = 0; j < SEG; j++) {
        const a = r * SEG + j;
        const b = r * SEG + ((j + 1) % SEG);
        idx.push(a, a + SEG, b, b, a + SEG, b + SEG);
      }
    }
    for (let j = 0; j < SEG; j++) {
      idx.push(RINGS * SEG, (j + 1) % SEG, j);
      const last = (RINGS - 1) * SEG;
      idx.push(last + j, last + ((j + 1) % SEG), RINGS * SEG + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(idx);
    // Wet and glistening: a clear coat over dark flesh.
    const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 0.5 });
    this.skin = mesh(geo, mat, this.body);
    this.skin.userData.dynamic = true;
    this.skin.frustumCulled = false;

    // The mouth: rings of hooked teeth inside the front sucker, scaled with
    // how wide it opens. The joint follows the rim each frame.
    this.mouth = joint(this.body, 0, 0, 0);
    const tooth = m.bone;
    [
      [0.012, 0.8, 14, 0.032],
      [0.032, 0.6, 12, 0.026],
      [0.058, 0.4, 9, 0.02],
    ].forEach(([depth, f, n, len], ring) => {
      for (let i = 0; i < n; i++) {
        const th = ((i + ring * 0.5) / n) * Math.PI * 2;
        const l = len * range(rng, 0.75, 1.2);
        // Each tooth on its own joint so it can ride the opening wall;
        // its base sits on the wall, the hook curling in toward the throat.
        const j = joint(this.mouth, 0, 0, -depth);
        j.rotation.z = th + Math.PI / 2;
        mesh(hook(l, l * 0.22), tooth, j);
        this.teeth.push({ j, th, f });
      }
    });
    this.update(0, 0);
    bakeRig(this.root);
  }

  protected animate(dt: number) {
    if (this.dead && !this.acting) return;
    const w = this.walk;
    const t = this.time;
    const idle = 1 - w;
    this.swim = 0.35 + 0.65 * w;
    this.open = 0.1 + Math.pow(Math.max(0, Math.sin(t * 1.6)), 4) * 0.25 * idle + 0.05 * w;
    this.lift = 0.55 * idle + 0.1 * w + Math.sin(t * 2.1) * 0.06 * idle;
    this.tipDown = 0.25 * idle + 0.05 * w;
    this.sniffYaw = (Math.sin(t * 0.7) * 0.45 + Math.sin(t * 2.7) * 0.12) * idle + this.lookYaw * 0.5;
    this.shift = 0;
    this.bulge = 0.04 + 0.1 * w;
    this.bulgeRate = 2 + 5 * w;
    this.swell += (0 - this.swell) * (1 - Math.exp(-dt * 0.2));
    this.deflate = 0;
  }

  update(dt: number, speed: number) {
    if (this.dead && !this.acting) return;
    super.update(dt, speed);
    this.bulgeT += dt * this.bulgeRate;
    this.build();
  }

  /** Rebuilds the body surface from the current pose. */
  private build() {
    const { px, py, pz, rad, yaw, pitch } = this;
    const ds = L / N;
    const ph = this.phase;
    const limp = this.deflate;
    // Headings along the spine: the travelling wave, the lifted front, the
    // tail curling down to grip.
    let mean = 0;
    for (let i = 0; i <= N; i++) {
      const s = i * ds;
      const wave = Math.sin((Math.PI * 2 * s) / 1.15 + ph) * (0.42 * this.swim) * (1 - limp);
      yaw[i] = wave;
      mean += wave;
      pitch[i] = Math.sin((Math.PI * 2 * s) / 0.8 + ph * 1.3 + 1) * 0.1 * this.swim * (1 - limp);
    }
    mean /= N + 1;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const front = smooth(u, 0.45, 0.85);
      yaw[i] += -mean + this.sniffYaw * front + this.limpBend * Math.sin(u * Math.PI * 2) * limp;
      pitch[i] += this.lift * front - this.tipDown * smooth(u, 0.85, 1) - 0.45 * (1 - smooth(u, 0, 0.1)) * (1 - limp);
    }
    // Radius: annuli, the swallowing bulge, the flaring mouth, swelling.
    const rimF = 0.55 + 0.75 * this.open;
    for (let i = 0; i <= N; i++) {
      const s = i * ds;
      const u = s / L;
      let r = prof(u, BODY);
      r *= 1 - 0.045 * Math.pow(0.5 + 0.5 * Math.cos((Math.PI * 2 * s) / 0.053), 4);
      r *= 1 + this.bulge * Math.pow(0.5 + 0.5 * Math.sin((Math.PI * 2 * s) / 0.55 + this.bulgeT), 3) * Math.sin(u * Math.PI);
      r *= 1 + (rimF - 1) * smooth(u, 0.92, 1);
      r *= 1 + 0.24 * this.swell * Math.sqrt(Math.max(0, Math.sin(u * Math.PI)));
      r *= 1 - 0.3 * limp;
      rad[i] = r;
    }
    // Integrate the spine from the tail, then anchor it near the middle.
    px[0] = py[0] = pz[0] = 0;
    for (let i = 1; i <= N; i++) {
      const y = (yaw[i] + yaw[i - 1]) / 2;
      const p = (pitch[i] + pitch[i - 1]) / 2;
      px[i] = px[i - 1] + Math.sin(y) * Math.cos(p) * ds;
      py[i] = py[i - 1] + Math.sin(p) * ds;
      pz[i] = pz[i - 1] + Math.cos(y) * Math.cos(p) * ds;
    }
    const a = Math.round(N * 0.4);
    let mx = 0;
    for (let i = 0; i <= N; i++) mx += px[i];
    mx /= N + 1;
    const ox = -mx;
    const oy = -py[a];
    const oz = -pz[a] + this.shift;
    const flat = 1 - 0.45 * limp;
    for (let i = 0; i <= N; i++) {
      px[i] += ox;
      // Lower rings rest on the floor; the lifted front rises off it.
      // (Smooth radius only, so the annuli and bulges don't kink the spine.)
      const y = py[i] + oy;
      const u = i / N;
      py[i] = (y + Math.sqrt(y * y + 0.0004)) / 2 + prof(u, BODY) * (1 + 0.24 * this.swell * Math.sqrt(Math.max(0, Math.sin(u * Math.PI)))) * (1 - 0.3 * limp) * 0.6 * flat;
      pz[i] += oz;
    }
    // Lay the rings out.
    const pos = this.positions;
    const P = new THREE.Vector3();
    const T = new THREE.Vector3();
    const U = new THREE.Vector3();
    const S = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const frame = (i: number) => {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(N, i + 1);
      P.set(px[i], py[i], pz[i]);
      T.set(px[i1] - px[i0], py[i1] - py[i0], pz[i1] - pz[i0]).normalize();
      U.copy(Y).addScaledVector(T, -Y.dot(T)).normalize();
      S.crossVectors(U, T).normalize();
    };
    const ring = (r: number, c: THREE.Vector3, rr: number, kx: number, top: number, bot: number) => {
      for (let j = 0; j < SEG; j++) {
        const an = (j / SEG) * Math.PI * 2;
        const ca = Math.cos(an);
        const k = ca > 0 ? top : bot;
        const o = (r * SEG + j) * 3;
        pos[o] = c.x + U.x * ca * rr * k + S.x * Math.sin(an) * rr * kx;
        pos[o + 1] = c.y + U.y * ca * rr * k + S.y * Math.sin(an) * rr * kx;
        pos[o + 2] = c.z + U.z * ca * rr * k + S.z * Math.sin(an) * rr * kx;
      }
    };
    const C = new THREE.Vector3();
    const kx = 1.18 * (1 + 0.15 * limp);
    const top = 0.9 * flat;
    const bot = 0.62 * flat;
    // Rear sucker.
    frame(0);
    TAIL.forEach(([d, f], k) => {
      C.copy(P).addScaledVector(T, -d);
      ring(TAIL.length - 1 - k, C, rad[0] * f, kx * 0.95, top * 0.75, bot * 0.75);
    });
    const tailC = P.clone().addScaledVector(T, -0.034);
    for (let i = 0; i <= N; i++) {
      frame(i);
      ring(TAIL.length + i, P, rad[i], kx, top, bot);
    }
    // Mouth: the rim, then the throat going back inside.
    const rr = rad[N];
    MOUTH.forEach(([d, f], k) => {
      C.copy(P).addScaledVector(T, -d * (0.6 + 0.6 * this.open));
      // Shut, the lips purse to a small hole; open, the throat gapes.
      const ff = k === 0 ? f : f * (0.3 + 0.7 * this.open);
      ring(TAIL.length + N + 1 + k, C, rr * ff, kx * 0.92, top * 0.95, bot * 1.1);
    });
    const throatC = P.clone().addScaledVector(T, -0.11);
    pos.set([tailC.x, tailC.y, tailC.z], RINGS * SEG * 3);
    pos.set([throatC.x, throatC.y, throatC.z], (RINGS * SEG + 1) * 3);
    const geo = this.skin.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.computeVertexNormals();
    // The teeth ride the rim, their rings opening with it.
    this.mouth.position.copy(P);
    this.mouth.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(S, U, T));
    for (const { j, th, f } of this.teeth) j.position.set(Math.cos(th) * f * rr * kx * 0.92, Math.sin(th) * f * rr * (Math.sin(th) > 0 ? top : bot), j.position.z);
  }
}

export function buildLeech(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  const l = new Leech(m, rng, scale * range(rng, 0.92, 1.06));
  return {
    rig: l,
    attack(onHit) {
      let fired = false;
      l.play(1.15, (k) => {
        // Rear back with the mouth flaring open, lunge, latch on and gulp
        // (waves of swallowing running down the body), then pull away
        // swollen.
        const rear = ease(k, 0, 0.32) * (1 - ease(k, 0.34, 0.46));
        const lunge = ease(k, 0.34, 0.46) * (1 - ease(k, 0.8, 1));
        const hold = hump(k, 0.46, 0.82);
        l.lift = l.lift * (1 - Math.max(rear, lunge)) + 1.15 * rear + 0.5 * lunge;
        l.tipDown = l.tipDown * (1 - rear) + 0.15 * rear + 0.45 * lunge;
        l.sniffYaw *= 1 - Math.max(rear, lunge);
        l.shift = -0.18 * rear + 0.6 * lunge;
        l.open = Math.max(l.open, ease(k, 0.1, 0.36) * (1 - ease(k, 0.46, 0.52) * 0.3) * (1 - ease(k, 0.82, 1)));
        l.bulge = l.bulge * (1 - hold) + 0.3 * hold;
        l.bulgeRate = l.bulgeRate * (1 - hold) + 11 * hold;
        if (k > 0.5) l.swell = Math.max(l.swell, ease(k, 0.5, 0.85));
        if (!fired && k >= 0.46) {
          fired = true;
          onHit();
        }
      });
    },
    flinch() {
      if (l.acting) return;
      l.play(0.35, (k) => {
        const s = Math.sin(k * Math.PI);
        l.shift = -0.12 * s;
        l.lift += 0.3 * s;
        l.open = Math.max(l.open, 0.6 * s);
        l.bulge = 0.2 * s;
      });
    },
    die() {
      l.dead = true;
      l.play(1.6, (k) => {
        // A last spasm, then it deflates and slumps, the mouth slack.
        const f = ease(k, 0.15, 1);
        const spasm = hump(k, 0, 0.35);
        l.lift = l.lift * (1 - f) + spasm * 0.5 * (1 - f);
        l.tipDown = l.tipDown * (1 - f) - 0.15 * f;
        l.swim = l.swim * (1 - f) + spasm * 0.6;
        l.sniffYaw *= 1 - f;
        l.open = 0.1 + 0.5 * spasm + 0.25 * f;
        l.bulge = 0.25 * spasm;
        l.bulgeRate = 14;
        l.deflate = f;
        l.swell = 0;
      });
    },
    emerge(dur) {
      l.play(dur, (k) => {
        // Breaking the surface: the front heaves up out of the water and
        // rears, thrashing side to side with the mouth gaping, then the
        // weight comes down onto the bank to crawl.
        const rear = ease(k, 0.05, 0.45) * (1 - ease(k, 0.72, 1));
        const thrash = hump(k, 0, 1);
        l.lift = l.lift * (1 - rear) + 1.3 * rear;
        l.tipDown = l.tipDown * (1 - rear) + 0.05 * rear;
        l.swim = Math.max(l.swim, 0.55 + 0.6 * thrash);
        l.sniffYaw = l.sniffYaw * (1 - thrash) + Math.sin(k * 19) * 0.45 * thrash;
        l.open = Math.max(l.open, hump(k, 0.2, 0.85) * 0.95);
        l.bulge = l.bulge * (1 - thrash) + 0.28 * thrash;
        l.bulgeRate = l.bulgeRate * (1 - thrash) + 12 * thrash;
      });
    },
    muzzle() {
      return l.mouth.localToWorld(new THREE.Vector3());
    },
  };
}
