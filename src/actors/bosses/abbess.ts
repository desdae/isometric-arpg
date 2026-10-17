import * as THREE from 'three';
import { audio } from '../../audio/Audio';
import { gridNormals } from '../cloth';
import { joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { mulberry32, range, type Rng } from '../../procgen/noise';
import { bump, sculptSphere } from '../sculpt';
import type { Rig } from '../Rig';
import type { MonsterMaterials } from '../monsters/materials';
import type { MonsterContext } from '../Monster';
import type { Boss, BossBody, BossDef, Script } from '../Boss';
import type { Telegraph } from '../../game/Telegraph';
import type { Effects } from '../../game/Effects';
import { easeIn, easeOut, hold, lerp, poseAction, smooth } from './common';

// The Silent Abbess: the last abbess of Saint Orsolya, who kept the convent's
// vow of silence until the bells fell still and her sisters filled the
// ossuary. Now she is a towering, gaunt skeleton in a tattered black habit,
// a bare skull deep in her hood with a faint ember in each socket, long
// bone arms held out from her sides ending in hooked claws. Before her chest
// hangs the convent's great bell, tarnished bronze crazed with cracks, its
// clapper and tassels swinging beneath. Her sleeves and hem fray into long
// ribbons of black cloth that never stop streaming about her; she glides, the
// hem brushing the floor. She strikes the bell and its knell rolls out in
// rings, breathes grave frost, lashes with her ribbons and calls her kneeling
// sisters up out of the floor.

const ICE = 0x4aa8ff;
const KNELL = 0x6a94ff;
const SHADOW = 0x9a6cff;
const VOID = 0x7050ff;
const PALE = new THREE.Color(0.75, 0.9, 1.4);
const PALE_HOT = new THREE.Color(1.3, 1.6, 2.4);
const FROST = new THREE.Color(0.45, 0.8, 1.6);
const UMBRA = new THREE.Color(0.5, 0.3, 1.3);
/** Ember in her sockets (the art's faint red-orange glow). */
const EYE = new THREE.Color(0.8, 0.15, 0.035);

const UP = new THREE.Vector3(0, 1, 0);
/** Waist height above the floor (scale 1) while she floats. */
const WAIST = 1.04;

// ---- Procedural textures -------------------------------------------------------

/** Tarnished bronze crazed with cracks (map), and the cracks alone (emissive map). */
function bellTextures(seed: number): { map: THREE.CanvasTexture; cracks: THREE.CanvasTexture } {
  const W = 512;
  const H = 256;
  const rng = mulberry32(seed);
  const a = document.createElement('canvas');
  a.width = W;
  a.height = H;
  const g = a.getContext('2d')!;
  const b = document.createElement('canvas');
  b.width = W;
  b.height = H;
  const e = b.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  // Bronze ground, mottled with dark tarnish and a little verdigris.
  g.fillStyle = '#5f573f';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const r = 6 + rng() * 40;
    const tone = rng();
    const col = tone < 0.55 ? `rgba(38,30,18,${0.12 + rng() * 0.25})` : tone < 0.8 ? `rgba(150,124,78,${0.08 + rng() * 0.15})` : `rgba(58,74,58,${0.1 + rng() * 0.18})`;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, col);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    for (const dx of [-W, 0, W]) g.fillRect(x - r + dx, y - r, r * 2, r * 2);
  }
  // Grime pooled in the lower lip and the shoulder.
  const v = g.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(20,16,10,0.45)');
  v.addColorStop(0.15, 'rgba(20,16,10,0)');
  v.addColorStop(0.85, 'rgba(20,16,10,0)');
  v.addColorStop(1, 'rgba(20,16,10,0.5)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  // Cracks: jagged dark lines with a bright lip, branching, wrapping round.
  const crack = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    const pts: [number, number][] = [[x, y]];
    let px = x;
    let py = y;
    const steps = Math.ceil(len / 7);
    for (let i = 0; i < steps; i++) {
      ang += (rng() - 0.5) * 0.9;
      px += Math.cos(ang) * 7;
      py += Math.sin(ang) * 7;
      pts.push([px, py]);
      if (depth < 2 && rng() < 0.1) crack(px, py, ang + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.7), len * 0.45, w * 0.6, depth + 1);
    }
    for (const dx of [-W, 0, W]) {
      const line = (ctx: CanvasRenderingContext2D, style: string, lw: number, ox: number, oy: number) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = lw;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach(([qx, qy], i) => (i ? ctx.lineTo(qx + dx + ox, qy + oy) : ctx.moveTo(qx + dx + ox, qy + oy)));
        ctx.stroke();
      };
      line(g, 'rgba(170,140,90,0.7)', w * 0.7, 0.8, 1.2);
      line(g, 'rgba(14,10,6,0.95)', w, 0, 0);
      line(e, '#fff', w * 0.9, 0, 0);
    }
  };
  for (let i = 0; i < 14; i++) crack(rng() * W, H * (0.25 + rng() * 0.7), -Math.PI / 2 + (rng() - 0.5) * 1.6, 60 + rng() * 110, 3.2 + rng() * 2, 0);
  for (let i = 0; i < 5; i++) crack(rng() * W, H * 0.95, -Math.PI / 2 + (rng() - 0.5) * 0.8, 50 + rng() * 60, 2, 1);
  const map = new THREE.CanvasTexture(a);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  const cracks = new THREE.CanvasTexture(b);
  cracks.wrapS = THREE.RepeatWrapping;
  return { map, cracks };
}

/** A six-pointed star of ice: long barbed spikes, short ones between, fine rays and a glowing heart. */
let starTex: THREE.CanvasTexture | null = null;
function iceStarTexture(): THREE.CanvasTexture {
  if (starTex) return starTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rng = mulberry32(911);
  g.translate(S / 2, S / 2);
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.45);
  halo.addColorStop(0, 'rgba(140,190,255,0.3)');
  halo.addColorStop(0.3, 'rgba(70,120,220,0.08)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(-S / 2, -S / 2, S, S);
  // Fine rays.
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2;
    const l = S * (0.2 + rng() * 0.25);
    g.strokeStyle = `rgba(170,210,255,${0.15 + rng() * 0.25})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * l, Math.sin(a) * l);
    g.stroke();
  }
  const spike = (a: number, len: number, w: number, alpha: number) => {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const P = (u: number, v: number) => [ca * u - sa * v, sa * u + ca * v] as const;
    const grad = g.createLinearGradient(0, 0, ca * len, sa * len);
    grad.addColorStop(0, `rgba(235,245,255,${alpha})`);
    grad.addColorStop(0.6, `rgba(150,200,255,${alpha * 0.8})`);
    grad.addColorStop(1, `rgba(90,150,240,${alpha * 0.4})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(...P(0, -w));
    // Barbs along the flanks.
    g.lineTo(...P(len * 0.35, -w * 0.7));
    g.lineTo(...P(len * 0.45, -w * 1.6));
    g.lineTo(...P(len * 0.5, -w * 0.55));
    g.lineTo(...P(len * 0.68, -w * 1.0));
    g.lineTo(...P(len * 0.72, -w * 0.35));
    g.lineTo(...P(len, 0));
    g.lineTo(...P(len * 0.72, w * 0.35));
    g.lineTo(...P(len * 0.68, w * 1.0));
    g.lineTo(...P(len * 0.5, w * 0.55));
    g.lineTo(...P(len * 0.45, w * 1.6));
    g.lineTo(...P(len * 0.35, w * 0.7));
    g.lineTo(...P(0, w));
    g.closePath();
    g.fill();
  };
  for (let i = 0; i < 6; i++) spike((i / 6) * Math.PI * 2 - Math.PI / 2, S * 0.48, S * 0.035, 0.9);
  for (let i = 0; i < 6; i++) spike(((i + 0.5) / 6) * Math.PI * 2 - Math.PI / 2, S * 0.24, S * 0.025, 0.6);
  const core = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.1);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(160,210,255,0)');
  g.fillStyle = core;
  g.fillRect(-S / 2, -S / 2, S, S);
  starTex = new THREE.CanvasTexture(c);
  starTex.colorSpace = THREE.SRGBColorSpace;
  return starTex;
}

// ---- Cloth helpers ---------------------------------------------------------------

/** A grid surface (PlaneGeometry layout, for gridNormals) placed by `fn(u, v)`; u across, v down. */
function surface(cols: number, rows: number, fn: (u: number, v: number) => [number, number, number]) {
  const geo = new THREE.PlaneGeometry(1, 1, cols, rows);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) p.setXYZ(r * (cols + 1) + c, ...fn(c / cols, r / rows));
  geo.computeVertexNormals();
  return geo;
}

/** Piecewise-linear lookup in sorted [x, y] pairs. */
function curve(pts: [number, number][], x: number) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const t = (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * s;
    }
  }
  return pts[pts.length - 1][1];
}

interface Ribbon {
  geo: THREE.BufferGeometry;
  n: number;
  anchor: () => THREE.Vector3;
  len: number;
  w: number;
  /** Rest heading (root space yaw) and how steeply it falls. */
  yaw: number;
  fall: number;
  phase: number;
  freq: number;
  amp: number;
  twist: number;
  /** Lashing ribbons from the sleeves follow the lash lines. */
  slot: number;
  jag: number[];
}

interface Drape {
  geo: THREE.BufferGeometry;
  side: number;
  jag: number[];
  bottom: THREE.Vector3[];
}

interface Finger {
  a: THREE.Object3D;
  b: THREE.Object3D;
  c: THREE.Object3D;
  thumb: boolean;
}

interface Arm {
  side: number;
  shoulder: THREE.Object3D;
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  cuff: THREE.Object3D;
  fingers: Finger[];
  /** 0 open claw .. 1 clenched. */
  curl: number;
}

// ---- The rig -------------------------------------------------------------------

class AbbessRig implements Rig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly core: THREE.Object3D;
  readonly chest: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly jaw: THREE.Object3D;
  readonly arms: Arm[] = [];
  readonly bell: THREE.Object3D;
  readonly bellBody: THREE.Object3D;
  readonly clapper: THREE.Object3D;
  readonly tassels: THREE.Object3D[] = [];
  lookYaw = 0;
  onStep = null;
  readonly S: number;
  time = Math.random() * 10;
  /** Smoothed glide speed 0..1. */
  glide = 0;
  // Pose state written by the base pose and then by actions.
  glow = 1;
  crack = 0;
  /** Ribbon length unfurled (0 furled .. 1 full). */
  unfurl = 1;
  /** Ribbons going slack onto the floor (sleep, death). */
  limp = 0;
  /** 0 standing .. 1 lying flat (her sleep). */
  lying = 0;
  /** Extra float height (rise, lying lift). */
  float = 0;
  /** Death: 0 alive .. 1 collapsed into her robes. */
  sink = 0;
  /** The lash: weight, stretch and the root-space yaws of the lines. */
  lash = { w: 0, ext: 1, yaws: [0] as number[] };
  /** Bell held still by the pose (0 free to swing). */
  bellHold = 0;
  /** Bell dropped at death: 0 hanging .. 1 lying on the floor. */
  bellDrop = 0;
  private swing = new THREE.Vector2();
  private swingV = new THREE.Vector2();
  private clap = 0;
  private clapV = 0;
  private lastYaw = 0;
  private ribbons: Ribbon[] = [];
  private drapes: Drape[] = [];
  private skirt: { geo: THREE.BufferGeometry; cols: number; rows: number; jag: number[] };
  readonly eyeMat: THREE.MeshBasicMaterial;
  readonly bronze: THREE.MeshStandardMaterial;
  readonly cloth: THREE.Material;
  private action: { t: number; dur: number; fn: (k: number) => void; done?: () => void } | null = null;
  private dropFrom = new THREE.Matrix4();
  private dropTo = new THREE.Vector3();

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    this.S = scale;
    this.body.scale.setScalar(scale);
    this.root.add(this.body);

    // Materials: a near-black habit with a cold blue cast, grey-ivory bone,
    // tarnished bronze, the sockets' ember.
    const habit = (m.robe as THREE.MeshStandardMaterial).clone();
    habit.color.setRGB(0.07, 0.075, 0.095);
    habit.roughness = 0.88;
    habit.side = THREE.DoubleSide;
    habit.emissive = new THREE.Color(0.006, 0.008, 0.016);
    this.cloth = habit;
    const ribbonMat = habit.clone();
    ribbonMat.color.setRGB(0.06, 0.065, 0.085);
    const inner = new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 1, side: THREE.DoubleSide });
    const bone = (m.bone as THREE.MeshStandardMaterial).clone();
    bone.color.setRGB(0.66, 0.63, 0.56);
    bone.roughness = 0.62;
    const darkBone = bone.clone();
    darkBone.color.setRGB(0.36, 0.33, 0.28);
    const claw = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.4, metalness: 0.1 });
    const tex = bellTextures(Math.floor(rng() * 1e6));
    this.bronze = new THREE.MeshStandardMaterial({
      map: tex.map,
      color: new THREE.Color(0.86, 0.82, 0.72),
      metalness: 0.82,
      roughness: 0.46,
      emissiveMap: tex.cracks,
      emissive: new THREE.Color(0, 0, 0),
    });
    const bronzeDark = new THREE.MeshStandardMaterial({ color: 0x3c2e1a, metalness: 0.85, roughness: 0.5 });
    const bronzeEdge = new THREE.MeshStandardMaterial({ color: 0x6c6046, metalness: 0.88, roughness: 0.4 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x24201c, metalness: 0.8, roughness: 0.5 });
    const tasselMat = new THREE.MeshStandardMaterial({ color: 0x4a3418, roughness: 0.85, side: THREE.DoubleSide });
    const cord = new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.9 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: EYE.clone(), fog: false });

    this.core = joint(this.body, 0, WAIST, 0);

    // Torso: a narrow, wasted trunk of dark cloth; ribs bare under the mantle.
    mesh(lathe([[0.0, -0.08], [0.13, -0.08], [0.14, 0.06], [0.15, 0.2], [0.16, 0.3], [0.0, 0.32]], 16).scale(1, 1, 0.7), habit, this.core, 0, 0, -0.02);
    this.chest = joint(this.core, 0, 0.32, 0);
    mesh(lathe([[0.0, -0.06], [0.15, -0.06], [0.17, 0.08], [0.15, 0.22], [0.08, 0.3], [0.0, 0.31]], 16).scale(1, 1, 0.68), inner, this.chest, 0, 0, -0.03);
    // Ribs, sternum and spine glimpsed between the mantle's edges.
    for (let i = 0; i < 6; i++) {
      const y = 0.2 - i * 0.045;
      const r = 0.14 - Math.abs(i - 1.5) * 0.009;
      const rib = new THREE.TorusGeometry(r, 0.0075, 4, 16, Math.PI * 0.85).rotateX(Math.PI / 2).rotateY(-Math.PI * 0.075).scale(1, 1, 0.75);
      const rb = mesh(rib, i % 2 ? darkBone : bone, this.chest, 0, y, -0.005);
      rb.rotation.x = -0.25;
    }
    mesh(new THREE.BoxGeometry(0.018, 0.2, 0.012), darkBone, this.chest, 0, 0.11, 0.1).rotation.x = 0.12;
    for (let i = 0; i < 5; i++) mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.04, 6), darkBone, this.core, 0, 0.02 + i * 0.06, -0.06);

    // Mantle: a heavy shoulder cape falling over the arms, open at the front.
    const mantle = surface(30, 10, (u, v) => {
      const y = lerp(0.31, -0.26, v);
      const r = curve([[-0.26, 0.42], [0.0, 0.37], [0.18, 0.31], [0.24, 0.24], [0.31, 0.11]], y);
      const gap = lerp(0.42, 0.62, v);
      const th = gap + u * (Math.PI * 2 - gap * 2);
      const fold = 0.022 * Math.sin(th * 9 + v * 2) * v + 0.01 * Math.sin(th * 23) * v;
      const rr = r + fold;
      const ragged = v > 0.92 ? (Math.sin(th * 31) * 0.5 + 0.5) * 0.04 : 0;
      return [Math.sin(th) * rr * 1.08, y - ragged, Math.cos(th) * rr * 0.62 - 0.02];
    });
    mesh(mantle, habit, this.chest);
    // A rolled edge down the mantle's front.
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const v = i / 10;
        const y = lerp(0.31, -0.24, v);
        const r = curve([[-0.26, 0.42], [0.0, 0.37], [0.18, 0.31], [0.24, 0.24], [0.31, 0.11]], y) + 0.005;
        const th = s * lerp(0.42, 0.62, v);
        pts.push(new THREE.Vector3(Math.sin(th) * r * 1.08, y, Math.cos(th) * r * 0.62 - 0.02));
      }
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.011, 5), habit, this.chest);
    }

    // Neck: bare vertebrae rising into the hood, dark behind them.
    mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 10).translate(0, 0.38, -0.05), inner, this.chest);
    for (let i = 0; i < 4; i++) {
      mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.032, 7), bone, this.chest, 0, 0.3 + i * 0.045, -0.01 - i * 0.004);
      mesh(new THREE.BoxGeometry(0.05, 0.01, 0.02), darkBone, this.chest, 0, 0.3 + i * 0.045, -0.02);
    }

    // Head: skull in a deep, peaked hood.
    this.head = joint(this.chest, 0, 0.47, 0.01);
    const skull = sculptSphere(
      0.1,
      (x, y, z) => {
        const front = smooth(0.2, 0.7, z);
        let d = 0;
        for (const s of [-1, 1]) {
          // Sockets: wide, deep and crisp-rimmed.
          const e = Math.hypot((x - s * 0.36) / 0.3, (y - 0.04) / 0.27);
          d -= 0.5 * (1 - smooth(0.6, 1.0, e)) * front;
          d += 0.05 * Math.exp(-((e - 1.08) ** 2) / 0.02) * front;
          // Cheekbones and their arch running back.
          d += 0.12 * bump(x, y, s * 0.6, -0.26, 0.17, 0.09) * smooth(-0.2, 0.5, z);
        }
        d += 0.06 * bump(x, y, 0, 0.27, 0.6, 0.07) * front; // brow
        // The nose: an inverted heart.
        const ne = Math.hypot(x / (0.1 + (y + 0.24) * 0.3), (y + 0.3) / 0.15);
        d -= 0.45 * (1 - smooth(0.55, 1.0, ne)) * front;
        d -= 0.1 * bump(y, z, 0.05, 0.1, 0.3, 0.35) * smooth(0.7, 0.95, Math.abs(x)); // temples
        // Below the cheeks the face narrows to the teeth.
        const low = smooth(-0.34, -0.75, y);
        d -= low * (0.14 + 0.36 * smooth(0.1, 0.7, Math.abs(x)));
        // Nothing hangs under the cranium at the back.
        d -= 0.35 * smooth(-0.2, -0.8, y) * smooth(0.3, -0.5, z);
        return d;
      },
      new THREE.Vector3(0.8, 1.0, 0.98),
      36,
      28,
    );
    // Skull joint, scaled up so the skull fills the hood's mouth as in the art.
    const sk = joint(this.head, 0, -0.025, 0.012);
    sk.scale.setScalar(1.22);
    {
      // Grime and shadow baked into the sockets, nose and crevices as vertex colour.
      const pos = skull.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      const u = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        u.set(pos.getX(i) / 0.8, pos.getY(i), pos.getZ(i) / 0.98).normalize();
        const front = smooth(0.2, 0.7, u.z);
        let dark = 0;
        for (const s of [-1, 1]) dark = Math.max(dark, (1 - smooth(0.6, 1.3, Math.hypot((u.x - s * 0.36) / 0.3, (u.y - 0.04) / 0.27))) * front);
        dark = Math.max(dark, (1 - smooth(0.4, 0.95, Math.hypot(u.x / 0.1, (u.y + 0.3) / 0.15))) * front);
        dark = Math.max(dark, 0.35 * smooth(-0.35, -0.6, u.y) * smooth(0.3, 0.6, Math.abs(u.x)));
        const c = 1 - 0.9 * dark;
        col.set([c, c * 0.97, c * 0.94], i * 3);
      }
      skull.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const skullMat = bone.clone();
    skullMat.vertexColors = true;
    const skm = mesh(skull, skullMat, sk, 0, 0.1, 0.0);
    skm.userData.dynamic = true; // keep its vertex colours out of the bake
    for (const s of [-1, 1]) {
      mesh(new THREE.SphereGeometry(0.03, 12, 8).scale(1, 0.9, 0.5), m.void, sk, s * 0.029, 0.104, 0.052);
      const eye = mesh(new THREE.SphereGeometry(0.007, 8, 6), this.eyeMat, sk, s * 0.03, 0.1, 0.064);
      eye.castShadow = false;
    }
    // Upper teeth in a long grin.
    for (let i = 0; i < 12; i++) {
      const a = (i - 5.5) * 0.19;
      const t = mesh(new THREE.BoxGeometry(0.0085, 0.019, 0.008), bone, sk, Math.sin(a) * 0.034, 0.036 + Math.abs(a) * 0.004, 0.034 + Math.cos(a) * 0.027);
      t.rotation.y = a;
    }
    // The jaw, hinged under the ears: a U of bone with its own row of teeth.
    this.jaw = joint(sk, 0, 0.05, -0.005);
    {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 14; i++) {
        const a = (i / 14 - 0.5) * Math.PI * 1.15;
        pts.push(new THREE.Vector3(Math.sin(a) * 0.038, -0.035 + Math.cos(a) * 0.004, 0.004 + Math.cos(a) * 0.058));
      }
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0075, 5).scale(1, 1.6, 1), bone, this.jaw, 0, 0.02, 0);
      mesh(new THREE.SphereGeometry(0.012, 8, 6).scale(1.4, 1, 0.8), bone, this.jaw, 0, -0.03, 0.062);
      for (const s of [-1, 1]) {
        const ram = mesh(new THREE.BoxGeometry(0.008, 0.05, 0.018), bone, this.jaw, s * 0.04, -0.005, 0.0);
        ram.rotation.x = -0.2;
      }
      for (let i = 0; i < 10; i++) {
        const a = (i - 4.5) * 0.2;
        const t = mesh(new THREE.BoxGeometry(0.008, 0.016, 0.007), bone, this.jaw, Math.sin(a) * 0.032, -0.008, 0.008 + Math.cos(a) * 0.05);
        t.rotation.y = a;
      }
    }
    // Hood: a deep cowl with a peak, framing the skull; dark within.
    const hoodR: [number, number][] = [[0, 0.02], [0.1, 0.11], [0.25, 0.165], [0.45, 0.18], [0.62, 0.165], [0.8, 0.19], [1, 0.27]];
    const hoodGap = (v: number) => curve([[0.12, 0], [0.42, 0.85], [0.7, 0.62], [1, 0.42]], v);
    const hoodPt = (u: number, v: number): [number, number, number] => {
      const y = lerp(0.37, -0.2, v);
      const gap = hoodGap(v);
      const th = gap + u * (Math.PI * 2 - gap * 2);
      const edge = Math.max(0, 1 - Math.min(u, 1 - u) * 8);
      const r = curve(hoodR, v) * 1.1 + 0.012 * Math.sin(th * 7 + v * 3) * v;
      const peak = -0.07 * (1 - smooth(0, 0.3, v));
      return [Math.sin(th) * r, y, Math.cos(th) * r * 1.15 - 0.01 + peak + edge * 0.03 * smooth(0.2, 0.5, v)];
    };
    mesh(surface(30, 14, hoodPt), habit, this.head);
    {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) pts.push(new THREE.Vector3(...hoodPt(0, 1 - (i / 12) * 0.86)));
      for (let i = 12; i >= 0; i--) pts.push(new THREE.Vector3(...hoodPt(1, 1 - (i / 12) * 0.86)));
      mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.012, 5), habit, this.head);
    }
    mesh(new THREE.SphereGeometry(0.15, 16, 12).scale(0.95, 1.2, 0.75), inner, this.head, 0, 0.12, -0.04);

    // Arms: long bare bones within the sleeves, flared cuffs, clawed hands.
    for (const side of [-1, 1]) {
      const shoulder = joint(this.chest, side * 0.24, 0.2, -0.01);
      const upper = joint(shoulder, 0, 0, 0);
      mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.34, 7).translate(0, -0.17, 0), bone, upper);
      mesh(new THREE.SphereGeometry(0.03, 8, 6), bone, upper);
      // The upper sleeve: a loose tube of habit around the humerus.
      mesh(lathe([[0.07, 0.03], [0.085, -0.12], [0.095, -0.3], [0.1, -0.37]], 12), habit, upper);
      const fore = joint(upper, 0, -0.36, 0);
      mesh(new THREE.SphereGeometry(0.026, 8, 6), darkBone, fore);
      mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.34, 6).translate(0, -0.17, 0), bone, fore, side * 0.012, 0, 0.004);
      mesh(new THREE.CylinderGeometry(0.009, 0.013, 0.34, 6).translate(0, -0.17, 0), bone, fore, -side * 0.012, 0, -0.004);
      // Wide bell cuff flaring open round the wrist.
      mesh(lathe([[0.09, 0.02], [0.1, -0.06], [0.12, -0.14], [0.155, -0.21], [0.175, -0.24]], 14).scale(1, 1, 0.85), habit, fore);
      const cuff = joint(fore, 0, -0.23, 0);
      const hand = joint(fore, 0, -0.35, 0);
      // Carpals and the palm's long bones.
      mesh(new THREE.BoxGeometry(0.05, 0.035, 0.022), darkBone, hand, 0, -0.015, 0);
      const fingers: Finger[] = [];
      for (let f = 0; f < 5; f++) {
        const thumb = f === 4;
        const x = thumb ? -side * 0.03 : (f - 1.5) * 0.017 * -side;
        const len = thumb ? 0.06 : [0.1, 0.115, 0.108, 0.088][f];
        mesh(new THREE.CylinderGeometry(0.0055, 0.007, 0.06, 5).translate(0, -0.03, 0), bone, hand, x * 0.8, -0.03, 0.002).rotation.z = x * 1.5;
        const a = joint(hand, x, -0.06, thumb ? 0.018 : 0.002);
        a.rotation.z = thumb ? -side * 0.7 : x * 2.5;
        const seg = (parent: THREE.Object3D, l: number, r: number) => {
          mesh(new THREE.CylinderGeometry(r * 0.8, r, l, 5).translate(0, -l / 2, 0), bone, parent);
          mesh(new THREE.SphereGeometry(r * 1.25, 5, 4), darkBone, parent);
        };
        seg(a, len, 0.0065);
        const b = joint(a, 0, -len, 0);
        seg(b, len * 0.8, 0.0055);
        const c = joint(b, 0, -len * 0.8, 0);
        seg(c, len * 0.55, 0.0045);
        // Hooked claw on the last joint.
        const cl = mesh(new THREE.ConeGeometry(0.0055, 0.05, 5).translate(0, -0.025, 0), claw, c, 0, -len * 0.55, 0);
        cl.rotation.x = 0.45;
        fingers.push({ a, b, c, thumb });
      }
      this.arms.push({ side, shoulder, upper, fore, hand, cuff, fingers, curl: 0.35 });
    }

    // The bell: hung from cords round her neck, before her chest.
    this.bell = joint(this.chest, 0, 0.13, 0.36);
    this.bellBody = joint(this.bell, 0, 0, 0);
    const bb = this.bellBody;
    // Crown: the great hoop with a figure-of-eight shackle inside it.
    mesh(new THREE.TorusGeometry(0.095, 0.014, 8, 32), bronzeDark, bb, 0, 0.0, 0);
    mesh(new THREE.TorusGeometry(0.022, 0.0065, 6, 14), bronzeEdge, bb, 0, 0.02, 0);
    mesh(new THREE.TorusGeometry(0.018, 0.006, 6, 14), bronzeEdge, bb, 0, -0.018, 0);
    for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.016, 0.022, 0.045, 8), bronzeDark, bb, s * 0.088, -0.07, 0);
    // Body: a lathed bell with a flat crown, domed shoulder, waist and flared lip.
    const prof = new THREE.SplineCurve(
      ([[0.0, -0.08], [0.1, -0.08], [0.16, -0.1], [0.21, -0.14], [0.245, -0.2], [0.266, -0.27], [0.276, -0.34], [0.282, -0.4], [0.292, -0.45], [0.306, -0.485], [0.312, -0.505], [0.3, -0.515], [0.27, -0.505], [0.24, -0.45]] as [number, number][]).map(([r, y]) => new THREE.Vector2(r, y)),
    );
    const bellGeo = new THREE.LatheGeometry(prof.getPoints(36).reverse(), 36);
    mesh(bellGeo, this.bronze, bb);
    mesh(new THREE.CircleGeometry(0.24, 24).rotateX(Math.PI / 2), inner, bb, 0, -0.45, 0);
    // Raised bands: crown, shoulder, waist and the sound bow.
    const bandAt = (y: number, r: number, t: number, mat: THREE.Material) => mesh(new THREE.TorusGeometry(r, t, 6, 40).rotateX(Math.PI / 2), mat, bb, 0, y, 0);
    bandAt(-0.085, 0.104, 0.01, bronzeEdge);
    bandAt(-0.15, 0.214, 0.006, bronzeDark);
    bandAt(-0.36, 0.279, 0.012, bronzeDark);
    bandAt(-0.46, 0.296, 0.006, bronzeDark);
    // Clapper: an iron rod and a heavy ball that just shows below the lip.
    this.clapper = joint(bb, 0, -0.1, 0);
    mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.44, 6).translate(0, -0.22, 0), iron, this.clapper);
    mesh(new THREE.SphereGeometry(0.035, 10, 8).scale(1, 1.25, 1), iron, this.clapper, 0, -0.45, 0);
    mesh(new THREE.ConeGeometry(0.02, 0.05, 8).rotateX(Math.PI), iron, this.clapper, 0, -0.51, 0);
    // Tassels hanging from the clapper and the lip.
    for (const [x, z, l] of [[0, 0, 0.3], [-0.12, 0.08, 0.26], [0.13, 0.05, 0.28]] as [number, number, number][]) {
      const t = joint(x === 0 ? this.clapper : bb, x, x === 0 ? -0.53 : -0.5, z);
      mesh(new THREE.CylinderGeometry(0.004, 0.004, l * 0.45, 4).translate(0, -l * 0.225, 0), cord, t);
      mesh(new THREE.SphereGeometry(0.014, 6, 5), tasselMat, t, 0, -l * 0.45, 0);
      const fr = mesh(new THREE.ConeGeometry(0.03, l * 0.55, 8, 1, true).translate(0, -l * 0.275, 0), tasselMat, t, 0, -l * 0.45, 0);
      fr.scale.set(1, 1, 0.6);
      this.tassels.push(t);
    }
    // Cords from the back of the neck to the crown.
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(s * 0.07, 0.32, 0.02);
      const b = new THREE.Vector3(s * 0.05, 0.16, 0.33);
      const cm = mesh(new THREE.CylinderGeometry(0.006, 0.006, a.distanceTo(b), 4), cord, this.chest, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      cm.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    }

    bakeRig(this.root);

    // Habit skirt: dynamic, from the waist to the floor, its hem brushing it.
    {
      const cols = 40;
      const rows = 14;
      const geo = new THREE.PlaneGeometry(1, 1, cols, rows);
      const sk = new THREE.Mesh(geo, habit);
      sk.castShadow = true;
      sk.receiveShadow = true;
      sk.frustumCulled = false;
      sk.userData.dynamic = true;
      this.body.add(sk);
      this.skirt = { geo, cols, rows, jag: Array.from({ length: cols + 1 }, (_, i) => (i === cols ? 0 : rng())) };
      this.skirt.jag[cols] = this.skirt.jag[0];
    }

    // Sleeve drapes: the great hanging sleeves, from shoulder to wrist, in root space so they hang.
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(1, 1, 10, 12);
      const dm = new THREE.Mesh(geo, habit);
      dm.castShadow = true;
      dm.frustumCulled = false;
      dm.userData.dynamic = true;
      this.root.add(dm);
      this.drapes.push({ geo, side, jag: Array.from({ length: 11 }, () => rng()), bottom: Array.from({ length: 11 }, () => new THREE.Vector3()) });
    }

    // Ribbons: from the sleeve drapes' torn ends, the hem and the back of the mantle.
    const addRibbon = (anchor: () => THREE.Vector3, len: number, w: number, yaw: number, fall: number, slot: number) => {
      const n = 26;
      const geo = new THREE.PlaneGeometry(1, 1, 1, n);
      const rm = new THREE.Mesh(geo, ribbonMat);
      rm.castShadow = true;
      rm.frustumCulled = false;
      rm.userData.dynamic = true;
      this.root.add(rm);
      this.ribbons.push({ geo, n, anchor, len, w, yaw, fall, phase: rng() * 10, freq: range(rng, 0.8, 1.4), amp: range(rng, 0.35, 0.6), twist: range(rng, 0.8, 1.8), slot, jag: Array.from({ length: n + 1 }, () => 0.75 + rng() * 0.5) });
    };
    for (const side of [-1, 1]) {
      const d = this.drapes[side < 0 ? 0 : 1];
      let slot = side < 0 ? 0 : 1;
      for (const [u, len, w, yaw, fall] of [[1, 2.2, 0.15, 1.3, 0.28], [0.85, 1.9, 0.12, 0.85, 0.34], [0.6, 1.7, 0.13, 1.75, 0.26], [0.95, 1.6, 0.09, 0.4, 0.4], [0.4, 1.4, 0.1, 2.3, 0.3]] as number[][]) {
        addRibbon(() => d.bottom[Math.round(u * 10)], len, w, side * yaw, fall, slot);
        slot += 2;
      }
    }
    const hemAnchor = (a: number) => {
      const j = joint(this.body, Math.sin(a) * 0.4, 0.03, Math.cos(a) * 0.36);
      const v = new THREE.Vector3();
      return () => this.local(j, v);
    };
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6 - 0.5) * 3.4;
      addRibbon(hemAnchor(a), range(rng, 1.2, 1.9), range(rng, 0.09, 0.15), a + range(rng, -0.2, 0.2), 0.85, -1);
    }
    for (const s of [-1, 1]) {
      const j = joint(this.chest, s * 0.3, -0.1, -0.2);
      const v = new THREE.Vector3();
      addRibbon(() => this.local(j, v), 2.0, 0.13, Math.PI - s * 0.7, 0.5, -1);
    }
    this.lastYaw = this.root.rotation.y;
  }

  private rootInv = new THREE.Matrix4();
  /** A joint's position in root space (metres). */
  local(j: THREE.Object3D, out: THREE.Vector3) {
    return out.setFromMatrixPosition(j.matrixWorld).applyMatrix4(this.rootInv);
  }

  arm(side: number) {
    return this.arms.find((a) => a.side === side)!;
  }

  play(dur: number, fn: (k: number) => void, done?: () => void) {
    this.action = { t: 0, dur, fn, done };
  }
  get acting() {
    return this.action !== null;
  }
  cancelAction() {
    this.action = null;
    this.lash.w = 0;
  }

  /** Knocks the bell swinging (an angular kick, radians per second about X and Z). */
  kick(x: number, z: number) {
    this.swingV.x += x;
    this.swingV.y += z;
    this.clapV -= z * 1.6;
  }

  update(dt: number, speed: number) {
    this.time += dt;
    const t = this.time;
    this.glide += (Math.min(1, speed / 3) - this.glide) * (1 - Math.exp(-dt * 4));
    const g = this.glide;
    const alive = this.sink < 1;

    // ---- Base pose: floating, bent over her bell, claws held out. ----
    this.core.position.set(0, WAIST + Math.sin(t * 1.3) * 0.035 + 0.02, 0);
    this.core.rotation.set(0.05 + g * 0.22, Math.sin(t * 0.5) * 0.05, Math.sin(t * 0.7) * 0.025);
    this.chest.rotation.set(0.1 + Math.sin(t * 1.3 + 0.6) * 0.02, 0, 0);
    this.chest.scale.setScalar(1);
    this.head.rotation.y += (this.lookYaw + Math.sin(t * 0.37) * 0.12 - this.head.rotation.y) * (1 - Math.exp(-dt * 4));
    this.head.rotation.x = -0.02 + Math.sin(t * 0.9) * 0.04 - g * 0.1;
    this.head.rotation.z = Math.sin(t * 0.45) * 0.06;
    this.jaw.rotation.x = 0.06 + Math.max(0, Math.sin(t * 0.8)) ** 6 * 0.08;
    for (const a of this.arms) {
      const s = a.side;
      const sway = Math.sin(t * 1.1 + s) * 0.06;
      if (s < 0) {
        // Out to her side, forearm drooping, claws hanging.
        a.upper.rotation.set(-0.25 + sway - g * 0.3, 0.2, -1.38 + g * 0.3);
        a.fore.rotation.set(-0.3 + sway, 0, 0.4);
        a.hand.rotation.set(0.4, 0, 0.3);
        a.curl = 0.4 + Math.sin(t * 1.7) * 0.06;
      } else {
        // Raised forward, elbow bent, the claw lifted and curled.
        a.upper.rotation.set(-0.85 + sway - g * 0.2, -0.3, 1.15 - g * 0.3);
        a.fore.rotation.set(-1.05 + sway * 0.5, 0, -0.2);
        a.hand.rotation.set(0.75, 0, -0.15);
        a.curl = 0.55 + Math.sin(t * 1.4 + 1) * 0.08;
      }
    }
    this.lash.w = 0;
    this.bellHold = 0;
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);

    // ---- One-shot action over the base pose. ----
    if (this.action) {
      const a = this.action;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.fn(k);
      if (k >= 1 && this.action === a) {
        this.action = null;
        a.done?.();
      }
    }

    // Lying in her tomb, or lifting out of it.
    if (this.lying > 0 || this.float > 0) {
      const l = this.lying;
      this.body.rotation.x = -Math.PI / 2 * l;
      this.body.position.set(0, (0.3 * l + this.float) * this.S, 0.95 * l * this.S);
    }
    // Collapsing into her robes.
    if (this.sink > 0) {
      const f = this.sink;
      this.core.position.y = lerp(this.core.position.y, 0.2, easeIn(Math.min(1, f * 1.15)));
      this.core.rotation.x = lerp(this.core.rotation.x, 0.9, f);
      this.chest.rotation.x = lerp(this.chest.rotation.x, 0.5, f);
      this.head.rotation.x = lerp(this.head.rotation.x, 0.7, f);
      this.jaw.rotation.x = lerp(this.jaw.rotation.x, 0.35, f);
      for (const a of this.arms) {
        a.upper.rotation.x = lerp(a.upper.rotation.x, -1.1, f);
        a.upper.rotation.z = lerp(a.upper.rotation.z, a.side * 0.9, f);
        a.fore.rotation.x = lerp(a.fore.rotation.x, -0.2, f);
        a.fore.rotation.z = lerp(a.fore.rotation.z, 0, f);
        a.curl = lerp(a.curl, 0.8, f);
      }
    }

    // Fingers: curl each joint by the hand's curl.
    for (const a of this.arms) {
      for (const f of a.fingers) {
        const c = a.curl * (f.thumb ? 0.6 : 1);
        f.a.rotation.x = 0.25 + c * 0.6;
        f.b.rotation.x = 0.2 + c * 0.9;
        f.c.rotation.x = 0.15 + c * 0.8;
      }
    }

    // Bell: a damped pendulum (unless held), its clapper and tassels lagging.
    {
      const sw = this.swing;
      const v = this.swingV;
      const hold = Math.max(this.bellHold, this.lying);
      // The glide tips it back a little.
      const tx = -this.core.rotation.x * 0.6 - g * 0.15;
      v.x += (-(sw.x - tx) * 18 - v.x * 2.2) * dt;
      v.y += (-sw.y * 18 - v.y * 2.2) * dt;
      sw.x += v.x * dt;
      sw.y += v.y * dt;
      this.bell.rotation.x = sw.x * (1 - hold);
      this.bell.rotation.z = sw.y * (1 - hold);
      this.clapV += (-(this.clap + sw.y * 0.5) * 30 - this.clapV * 3) * dt;
      this.clap += this.clapV * dt;
      this.clapper.rotation.z = this.clap * (1 - hold);
      this.clapper.rotation.x = -sw.x * 0.4 * (1 - hold);
      this.tassels.forEach((ts, i) => {
        ts.rotation.z = -sw.y * 0.8 + Math.sin(t * 2.1 + i * 2) * 0.08;
        ts.rotation.x = -sw.x * 0.8 + Math.sin(t * 1.7 + i) * 0.06 + g * 0.3;
      });
    }
    // The bell torn free at her death, falling to the floor and toppling.
    if (this.bellDrop > 0) {
      if (this.bell.parent !== this.body) {
        this.root.updateMatrixWorld(true);
        const m = new THREE.Matrix4().copy(this.body.matrixWorld).invert().multiply(this.bell.matrixWorld);
        this.dropFrom.copy(m);
        this.body.add(this.bell);
        this.dropTo.setFromMatrixPosition(m);
      }
      const f = this.bellDrop;
      const fall = easeIn(Math.min(1, f / 0.45));
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      this.dropFrom.decompose(p, q, sc);
      const tip = smooth(0.4, 0.8, f) * 1.35 + Math.sin(smooth(0.45, 1, f) * Math.PI * 3) * 0.08 * (1 - f);
      this.bell.position.set(this.dropTo.x + smooth(0.4, 1, f) * 0.15, lerp(this.dropTo.y, 0.6, fall) - smooth(0.4, 0.8, f) * 0.3 + 0.01, this.dropTo.z + smooth(0.4, 1, f) * 0.12);
      this.bell.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -tip));
      this.bell.scale.setScalar(1);
    }

    // Glows.
    const k = this.glow * (0.85 + Math.sin(t * 2.3) * 0.1 + Math.sin(t * 7.1) * 0.05);
    this.eyeMat.color.setRGB(EYE.r * k, EYE.g * k, EYE.b * k);
    const ck = this.crack * (0.8 + Math.sin(t * 3.3) * 0.2);
    this.bronze.emissive.setRGB(0.5 * ck, 0.8 * ck, 1.6 * ck);

    // ---- Cloth: skirt, sleeve drapes and ribbons. ----
    this.root.updateMatrixWorld(true);
    this.rootInv.copy(this.root.matrixWorld).invert();
    let dYaw = this.root.rotation.y - this.lastYaw;
    this.lastYaw = this.root.rotation.y;
    if (Math.abs(dYaw) > 1) dYaw = 0;
    if (alive || this.action) {
      this.updateSkirt(t);
      this.updateDrapes(t);
      this.updateRibbons(t, dYaw / Math.max(dt, 1e-3));
    }
  }

  private updateSkirt(t: number) {
    const { geo, cols, rows, jag } = this.skirt;
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    const core = this.core;
    const q = core.quaternion;
    const top = core.position;
    const g = this.glide;
    const sink = this.sink;
    const hemY = 0.015;
    const v = new THREE.Vector3();
    for (let r = 0; r <= rows; r++) {
      const s = r / rows;
      for (let c = 0; c <= cols; c++) {
        const th = Math.PI + (c / cols) * Math.PI * 2;
        const jg = jag[c];
        // Radius down the habit: waist, a slight hip, then a long flare to the hem.
        let rad = curve([[0, 0.135], [0.18, 0.17], [0.55, 0.25], [1, 0.36 + jg * 0.04]], s);
        rad *= 1 + sink * 0.9 * s;
        const folds = 0.04 * Math.sin(th * 9 + Math.sin(t * 0.9 + th) * 0.6) * s + 0.012 * Math.sin(th * 17 + t * 1.3) * s * s;
        rad += folds;
        // Top rides on the waist (its tilt); the hem is pinned near the floor, trailing.
        v.set(Math.sin(th) * rad * 1.08, 0, Math.cos(th) * rad * 0.88);
        const wTop = (1 - s) * (1 - s);
        const rotated = v.clone().applyQuaternion(q);
        const x = lerp(v.x, rotated.x, wTop);
        const zz = lerp(v.z, rotated.z, wTop);
        const yy = lerp(top.y + rotated.y * wTop, hemY + (s > 0.97 ? jg * 0.03 : 0), s);
        const trail = -(g * 0.28 + Math.sin(t * 1.1 + th * 2) * 0.012) * s * s;
        const sway = Math.sin(t * 1.3 + s * 2) * 0.02 * s;
        p.setXYZ(r * (cols + 1) + c, top.x + x + sway, yy, top.z + zz + trail);
      }
    }
    p.needsUpdate = true;
    gridNormals(geo, cols, rows);
  }

  private updateDrapes(t: number) {
    const S = this.S;
    const a0 = new THREE.Vector3();
    const a1 = new THREE.Vector3();
    const a2 = new THREE.Vector3();
    const c0 = new THREE.Vector3();
    this.local(this.core, c0);
    for (const d of this.drapes) {
      const arm = this.arm(d.side);
      this.local(arm.upper, a0);
      this.local(arm.fore, a1);
      this.local(arm.cuff, a2);
      const l0 = a0.distanceTo(a1);
      const l1 = a1.distanceTo(a2);
      const p = d.geo.getAttribute('position') as THREE.BufferAttribute;
      const cols = 10;
      const rows = 12;
      const top = new THREE.Vector3();
      const out = new THREE.Vector3();
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const s = u * (l0 + l1);
        if (s < l0) top.lerpVectors(a0, a1, s / l0);
        else top.lerpVectors(a1, a2, (s - l0) / l1);
        out.set(top.x - c0.x, 0, top.z - c0.z);
        if (out.lengthSq() < 1e-6) out.set(d.side, 0, 0);
        out.normalize();
        const H = S * (0.15 + 0.6 * Math.pow(u, 1.2)) * (0.85 + d.jag[c] * 0.3) * (0.5 + 0.5 * this.unfurl);
        for (let r = 0; r <= rows; r++) {
          const v = r / rows;
          const wave = Math.sin(t * 1.6 + u * 3 - v * 2.4 + d.side) * 0.05 * S * v;
          const bil = Math.sin(t * 1.1 + u * 5 + d.side * 2) * 0.03 * S * v;
          let x = top.x + out.x * (0.04 * S * v + bil) + wave * 0.5;
          let y = top.y - v * H;
          let z = top.z + out.z * (0.04 * S * v + bil) - (this.glide * 0.35 * S * v * v) + wave;
          if (y < 0.02) {
            // Pooling on the floor: slide outward instead of through it.
            const extra = 0.02 - y;
            x += out.x * extra * 0.6;
            z += out.z * extra * 0.6;
            y = 0.02 + extra * 0.02;
          }
          p.setXYZ(r * (cols + 1) + c, x, y, z);
          if (r === rows) d.bottom[c].set(x, y, z);
        }
      }
      p.needsUpdate = true;
      gridNormals(d.geo, cols, rows);
    }
  }

  private updateRibbons(t: number, yawRate: number) {
    const S = this.S;
    const d = new THREE.Vector3();
    const a1 = new THREE.Vector3();
    const a2 = new THREE.Vector3();
    const P = new THREE.Vector3();
    const side = new THREE.Vector3();
    const bin = new THREE.Vector3();
    const lashDir = new THREE.Vector3();
    const flat = new THREE.Vector3();
    const stream = this.glide;
    const lash = this.lash;
    for (const rb of this.ribbons) {
      const n = rb.n;
      const pos = rb.geo.getAttribute('position') as THREE.BufferAttribute;
      const lashing = rb.slot >= 0 && lash.w > 0;
      const lw = lashing ? lash.w : 0;
      const ext = lashing ? lerp(1, lash.ext, lw) : 1;
      const L = rb.len * S * (0.3 + 0.7 * this.unfurl) * ext;
      const ds = L / n;
      P.copy(rb.anchor());
      const yaw = rb.yaw;
      if (lashing) {
        const ly = lash.yaws[rb.slot % lash.yaws.length];
        lashDir.set(Math.sin(ly), -0.02, Math.cos(ly)).normalize();
      }
      flat.set(Math.sin(yaw), 0, Math.cos(yaw));
      const amp = rb.amp * (1 - this.limp * 0.85);
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        // Heading: out and down, drifting up again as if under water.
        // Swooping down, then curling up again as if borne on water.
        const fall = lerp(rb.fall * (1 - s * 1.35) + Math.sin(s * 4 + rb.phase) * 0.12, 0.5 * (1 - s) + 0.08, this.limp);
        d.set(flat.x * (1 - fall), -fall, flat.z * (1 - fall));
        // Streaming back as she glides; swinging wide as she turns.
        d.z -= stream * 0.9 * s;
        d.x += -yawRate * 0.08 * s * Math.cos(yaw);
        // Two travelling waves across and along it.
        a1.crossVectors(d, UP);
        if (a1.lengthSq() < 1e-4) a1.set(1, 0, 0);
        a1.normalize();
        a2.crossVectors(a1, d).normalize();
        const ph = rb.freq * s * 7 - t * (1.8 + stream * 1.5) + rb.phase;
        d.addScaledVector(a1, amp * Math.sin(ph) * (0.25 + s));
        d.addScaledVector(a2, amp * 0.55 * Math.sin(ph * 0.7 + 1.3) * (0.2 + s));
        if (lashing) {
          const wob = Math.sin(s * 9 - t * 14 + rb.phase) * 0.12 * (1 - lw * 0.6);
          lashDir.y = -0.02 + (s < 0.1 ? -0.5 : 0);
          d.lerp(new THREE.Vector3(lashDir.x + a1.x * wob, lashDir.y, lashDir.z + a1.z * wob), lw);
        }
        if (this.limp > 0) d.lerp(new THREE.Vector3(flat.x, -0.6 * (1 - s), flat.z), this.limp * 0.8);
        d.normalize();
        if (i > 0) {
          P.addScaledVector(d, ds);
          if (P.y < 0.02) P.y = 0.02 + i * 0.0004;
        }
        // Side vector across the band, twisted along it.
        side.crossVectors(d, UP);
        if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
        side.normalize();
        bin.crossVectors(d, side);
        const tw = rb.twist * Math.sin(s * 3.1 - t * 1.2 + rb.phase) * (1 - this.limp);
        side.multiplyScalar(Math.cos(tw)).addScaledVector(bin, Math.sin(tw));
        const w = rb.w * S * (1 - s * 0.82) * rb.jag[i] * 0.5 * (lashing ? 1 - lw * 0.3 : 1);
        pos.setXYZ(i * 2, P.x - side.x * w, P.y - side.y * w, P.z - side.z * w);
        pos.setXYZ(i * 2 + 1, P.x + side.x * w, P.y + side.y * w, P.z + side.z * w);
      }
      pos.needsUpdate = true;
      gridNormals(rb.geo, 1, n);
    }
  }
}

// ---- Body and poses ----------------------------------------------------------------

type AbbessBody = BossBody & { rig: AbbessRig; setGlow(g: number): void; setCrack(c: number): void; bellAt(): THREE.Vector3; ribbons(yaws: number[], ext: number): void };

export function buildAbbess(m: MonsterMaterials, rng: Rng, scale = 1.9): BossBody {
  const c = new AbbessRig(m, rng, scale);
  const L = c.arm(-1);
  const R = c.arm(1);
  let lashYaws: number[] = [0];
  let lashExt = 3.5;

  const poses: Record<string, (k: number, w: number) => void> = {
    // Death Knell: the claw drawn back, then struck against the bell's flank.
    knell: (k, w) => {
      const draw = smooth(0, 0.42, k) * (1 - smooth(0.46, 0.52, k));
      const hit = smooth(0.46, 0.52, k) * (1 - smooth(0.75, 1, k));
      R.upper.rotation.x = lerp(R.upper.rotation.x, -1.1 * draw - 0.9 * hit, w);
      R.upper.rotation.z = lerp(R.upper.rotation.z, 1.35 * draw + 0.3 * hit, w);
      R.upper.rotation.y = lerp(R.upper.rotation.y, -0.2 * draw - 0.7 * hit, w);
      R.fore.rotation.x = lerp(R.fore.rotation.x, -1.6 * draw - 0.8 * hit, w);
      R.fore.rotation.z = lerp(R.fore.rotation.z, 0.3 * draw - 0.5 * hit, w);
      R.curl = lerp(R.curl, 0.2 * draw + 0.95 * hit, w);
      // The other hand steadies the bell's lip.
      L.upper.rotation.x = lerp(L.upper.rotation.x, -0.75, w * (draw + hit));
      L.upper.rotation.z = lerp(L.upper.rotation.z, -0.55, w * (draw + hit));
      L.fore.rotation.x = lerp(L.fore.rotation.x, -1.1, w * (draw + hit));
      L.fore.rotation.z = lerp(L.fore.rotation.z, 0.2, w * (draw + hit));
      c.core.rotation.y += (0.3 * draw - 0.25 * hit) * w;
      c.chest.rotation.x += 0.12 * hit * w;
      c.head.rotation.x += (-0.25 * draw + 0.15 * hit) * w;
      c.jaw.rotation.x += 0.3 * hit * w;
      c.glow = 1 + hit * 1.5;
    },
    // Grave Frost: arms spread and raised, then flung down and out.
    frost: (k, w) => {
      const up = smooth(0, 0.5, k) * (1 - smooth(0.55, 0.62, k));
      const fling = smooth(0.55, 0.64, k) * (1 - smooth(0.82, 1, k));
      for (const a of [L, R]) {
        a.upper.rotation.x = lerp(a.upper.rotation.x, -1.3 * up - 0.9 * fling, w);
        a.upper.rotation.z = lerp(a.upper.rotation.z, a.side * (1.5 * up + 1.0 * fling), w);
        a.upper.rotation.y = lerp(a.upper.rotation.y, 0, w);
        a.fore.rotation.x = lerp(a.fore.rotation.x, -0.5 * up - 0.1 * fling, w);
        a.fore.rotation.z = lerp(a.fore.rotation.z, 0, w);
        a.hand.rotation.x = lerp(a.hand.rotation.x, -0.5 * up + 0.4 * fling, w);
        a.curl = lerp(a.curl, 0.1 + 0.5 * up, w);
      }
      c.core.position.y += 0.12 * up * w;
      c.chest.rotation.x += (-0.25 * up + 0.2 * fling) * w;
      c.head.rotation.x += (-0.45 * up + 0.2 * fling) * w;
      c.jaw.rotation.x += 0.35 * (up + fling) * w;
      c.glow = 1 + (up + fling) * 1.4;
    },
    // Shadow Ribbons: arms swept back, then thrown forward; the ribbons lash out.
    lash: (k, w) => {
      const back = smooth(0, 0.4, k) * (1 - smooth(0.42, 0.5, k));
      const throwF = smooth(0.42, 0.5, k) * (1 - smooth(0.8, 1, k));
      for (const a of [L, R]) {
        a.upper.rotation.x = lerp(a.upper.rotation.x, 0.5 * back - 1.4 * throwF, w);
        a.upper.rotation.z = lerp(a.upper.rotation.z, a.side * (1.3 * back + 0.45 * throwF), w);
        a.upper.rotation.y = lerp(a.upper.rotation.y, 0, w);
        a.fore.rotation.x = lerp(a.fore.rotation.x, -0.4 * back - 0.1 * throwF, w);
        a.fore.rotation.z = lerp(a.fore.rotation.z, 0, w);
        a.curl = lerp(a.curl, 0.1, w);
      }
      c.core.rotation.x += (-0.12 * back + 0.25 * throwF) * w;
      c.head.rotation.x += 0.1 * throwF * w;
      c.lash.w = smooth(0.42, 0.52, k) * (1 - smooth(0.7, 0.95, k));
      c.lash.ext = lashExt;
      c.lash.yaws = lashYaws;
      c.glow = 1 + throwF;
    },
    // The Kneeling Dead: arms spread wide and raised, palms down, then pressed toward the floor.
    summon: (k, w) => {
      const s = hold(k, 0.25, 0.7) * w;
      const press = smooth(0.55, 0.75, k) * (1 - smooth(0.85, 1, k)) * w;
      for (const a of [L, R]) {
        a.upper.rotation.x = lerp(a.upper.rotation.x, -0.9 + 0.5 * press, s);
        a.upper.rotation.z = lerp(a.upper.rotation.z, a.side * 1.45, s);
        a.upper.rotation.y = lerp(a.upper.rotation.y, 0, s);
        a.fore.rotation.x = lerp(a.fore.rotation.x, -0.25, s);
        a.fore.rotation.z = lerp(a.fore.rotation.z, a.side * -0.3 * press, s);
        a.hand.rotation.x = lerp(a.hand.rotation.x, 0.6, s);
        a.curl = lerp(a.curl, 0.15, s);
      }
      c.core.position.y += 0.1 * s - 0.15 * press;
      c.head.rotation.x += -0.35 * s + 0.6 * press;
      c.jaw.rotation.x += 0.3 * s;
      c.glow = 1 + s * 1.5;
    },
    // Vow of Silence: the bell clutched to her chest in both hands, head bowed over it.
    clasp: (k, w) => {
      const s = hold(k, 0.2, 0.85) * w;
      const open = smooth(0.85, 0.92, k) * (1 - smooth(0.92, 1, k)) * w;
      for (const a of [L, R]) {
        a.upper.rotation.x = lerp(a.upper.rotation.x, -0.65 - 0.6 * open, s);
        a.upper.rotation.z = lerp(a.upper.rotation.z, a.side * (0.4 + 1.1 * open), s);
        a.upper.rotation.y = lerp(a.upper.rotation.y, 0, s);
        a.fore.rotation.x = lerp(a.fore.rotation.x, -1.35 + open, s);
        a.fore.rotation.z = lerp(a.fore.rotation.z, a.side * -0.45, s);
        a.curl = lerp(a.curl, 0.85, s);
      }
      c.bellHold = s;
      c.core.position.y -= 0.12 * s;
      c.chest.rotation.x += 0.3 * s - 0.5 * open;
      c.head.rotation.x += 0.45 * s - 0.6 * open;
      c.glow = 0.5 + (1 - s) * 0.5 + open * 3;
    },
    // The bell cracks: both claws grip it, wrench it, and she rears back.
    crack: (k, w) => {
      const grip = hold(k, 0.15, 0.55) * w;
      const rear = smooth(0.5, 0.62, k) * (1 - smooth(0.85, 1, k)) * w;
      for (const a of [L, R]) {
        a.upper.rotation.x = lerp(a.upper.rotation.x, -0.7 * grip - 1.6 * rear, Math.max(grip, rear));
        a.upper.rotation.z = lerp(a.upper.rotation.z, a.side * (0.5 * grip + 1.2 * rear), Math.max(grip, rear));
        a.upper.rotation.y = lerp(a.upper.rotation.y, 0, Math.max(grip, rear));
        a.fore.rotation.x = lerp(a.fore.rotation.x, -1.2 * grip - 0.4 * rear, Math.max(grip, rear));
        a.fore.rotation.z = lerp(a.fore.rotation.z, a.side * -0.4 * grip, Math.max(grip, rear));
        a.curl = lerp(a.curl, 0.9 * grip + 0.1 * rear, Math.max(grip, rear));
      }
      c.bellHold = grip * (1 - rear);
      const shake = Math.sin(k * 90) * 0.04 * grip;
      c.core.rotation.z += shake;
      c.core.position.y += 0.2 * rear;
      c.chest.rotation.x += 0.2 * grip - 0.45 * rear;
      c.head.rotation.x += 0.3 * grip - 0.8 * rear;
      c.jaw.rotation.x += 0.5 * rear;
      c.glow = 1 + rear * 3;
    },
    // Asleep: lying flat in her tomb, claws folded over the bell on her breast.
    sleep: () => {
      c.lying = 1;
      c.float = 0;
      c.unfurl = 0.3;
      c.limp = 1;
      for (const a of [L, R]) {
        a.upper.rotation.set(-0.55, 0, a.side * 0.18);
        a.fore.rotation.set(-1.25, 0, a.side * -0.5);
        a.hand.rotation.set(0.3, 0, 0);
        a.curl = 0.6;
      }
      c.core.position.y = WAIST;
      c.core.rotation.set(0, 0, 0);
      c.chest.rotation.x = 0;
      c.head.rotation.set(-0.15, 0, 0);
      c.jaw.rotation.x = 0.02;
      c.glow = 0;
    },
    // Rising: she lifts out of the tomb, still flat, then swings upright as her ribbons unfurl.
    rise: (k) => {
      poses.sleep(k, 1);
      const lift = smooth(0, 0.35, k);
      const upright = smooth(0.3, 0.8, k);
      c.lying = 1 - upright;
      c.float = 0.55 * lift * (1 - smooth(0.6, 1, k));
      c.unfurl = 0.3 + 0.7 * smooth(0.5, 1, k);
      c.limp = 1 - smooth(0.4, 0.9, k);
      c.glow = smooth(0, 0.3, k);
      // Arms unfold from the bell out to her sides.
      const open = smooth(0.55, 1, k);
      for (const a of [L, R]) {
        a.upper.rotation.x = lerp(-0.55, -0.5, open);
        a.upper.rotation.z = lerp(a.side * 0.18, a.side * 1.4, open);
        a.fore.rotation.x = lerp(-1.25, -0.3, open);
        a.fore.rotation.z = lerp(a.side * -0.5, 0, open);
        a.curl = lerp(0.6, 0.2, open);
      }
      c.head.rotation.x = lerp(-0.15, -0.3, open);
      c.jaw.rotation.x = 0.02 + 0.3 * open;
    },
  };

  const body: AbbessBody = {
    rig: c,
    lift: 0,
    attack(onHit) {
      // A raking swipe of the raised claw.
      poseAction(
        c,
        1.0,
        (k, w) => {
          const wind = smooth(0, 0.45, k) * (1 - smooth(0.5, 0.58, k));
          const rake = smooth(0.5, 0.62, k) * (1 - smooth(0.8, 1, k));
          R.upper.rotation.x = lerp(R.upper.rotation.x, -1.9 * wind - 0.9 * rake, w);
          R.upper.rotation.z = lerp(R.upper.rotation.z, 1.1 * wind + 0.1 * rake, w);
          R.upper.rotation.y = lerp(R.upper.rotation.y, 0.2 * wind - 0.8 * rake, w);
          R.fore.rotation.x = lerp(R.fore.rotation.x, -1.0 * wind - 0.2 * rake, w);
          R.curl = lerp(R.curl, 0.05 * wind + 0.7 * rake, w);
          c.core.rotation.y += (0.35 * wind - 0.45 * rake) * w;
          c.core.rotation.x += 0.15 * rake * w;
          c.jaw.rotation.x += 0.25 * wind * w;
        },
        [0.58],
        () => onHit(),
      );
      audio.whoosh(c.root.position, 1.2);
    },
    flinch() {},
    die() {
      // The bell drops and cracks; she folds down into her robes and the ribbons sink.
      c.cancelAction();
      const glow0 = c.glow;
      c.play(3.2, (k) => {
        c.lying = 0;
        c.float = 0;
        c.bellDrop = smooth(0, 0.5, k);
        c.crack = Math.max(0, 1.5 * (1 - smooth(0.2, 0.9, k))) * smooth(0, 0.15, k);
        c.sink = easeOut(smooth(0.15, 0.85, k));
        c.limp = smooth(0.3, 1, k);
        c.unfurl = 1 - smooth(0.5, 1, k) * 0.5;
        c.glow = glow0 * (1 - smooth(0.2, 0.7, k)) + Math.sin(k * 30) * 0.2 * (1 - smooth(0.1, 0.5, k));
      });
    },
    muzzle() {
      const p = new THREE.Vector3();
      R.hand.getWorldPosition(p);
      return p;
    },
    move(name, dur, hits = [], onHit) {
      const fn = poses[name];
      if (!fn) return;
      if (name === 'sleep' || name === 'rise') {
        c.play(dur, (k) => fn(k, 1), () => {
          if (name === 'rise') {
            c.lying = 0;
            c.float = 0;
            c.unfurl = 1;
            c.limp = 0;
          }
          let next = 0;
          while (next < hits.length) onHit?.(next++);
        });
        if (name === 'sleep') fn(0, 1);
        return;
      }
      poseAction(c, dur, fn, hits, onHit);
    },
    setGlow: (g) => (c.glow = g),
    setCrack: (v) => (c.crack = v),
    bellAt() {
      const p = new THREE.Vector3(0, -0.3, 0);
      return c.bellBody.localToWorld(p);
    },
    ribbons(yaws, ext) {
      lashYaws = yaws;
      lashExt = ext;
    },
  };
  return body;
}

// ---- Effects ----------------------------------------------------------------------

/** A six-pointed ice star blooming: a standing sprite and its twin flat on the floor. */
function iceStar(fx: Effects, at: THREE.Vector3, r: number, life = 0.9) {
  const tex = iceStarTexture();
  const sm = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(0.8, 1.0, 1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const sp = new THREE.Sprite(sm);
  sp.position.copy(at).setY(at.y + 1.1);
  sp.renderOrder = 18;
  fx.group.add(sp);
  const rot0 = Math.random() * Math.PI;
  fx.after(life, sp, (k) => {
    const s = r * 1.7 * (0.3 + 0.7 * easeOut(Math.min(1, k * 4)));
    sp.scale.set(s, s, 1);
    sm.rotation = rot0 + k * 0.6;
    sm.opacity = 0.85 * (k < 0.15 ? 1 : 1 - smooth(0.15, 1, k));
  }, () => sm.dispose());
  const fm = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.55, 0.75, 1.25), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), fm);
  fl.position.copy(at).setY(fx.height(at.x, at.z) + 0.06);
  fl.rotation.y = rot0;
  fl.renderOrder = 4;
  fx.group.add(fl);
  fx.after(life * 1.8, fl, (k) => {
    const s = r * 2.6 * (0.4 + 0.6 * easeOut(Math.min(1, k * 6)));
    fl.scale.set(s, 1, s);
    fl.rotation.y = rot0 - k * 0.3;
    fm.opacity = 1 - smooth(0.2, 1, k);
  }, () => {
    fl.geometry.dispose();
    fm.dispose();
  });
}

/** Ghostly blue mist pooling where frost is about to bloom. */
function frostMist(fx: Effects, at: THREE.Vector3, r: number, count: number) {
  const gy = fx.height(at.x, at.z);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * r;
    fx.spell.puff({
      pos: new THREE.Vector3(at.x + Math.cos(a) * rr, gy + 0.2 + Math.random() * 0.3, at.z + Math.sin(a) * rr),
      vel: new THREE.Vector3(Math.cos(a + 1.6) * 0.4, 0.25 + Math.random() * 0.3, Math.sin(a + 1.6) * 0.4),
      life: 1.1 + Math.random() * 0.6,
      size: 0.5,
      size1: 1.3,
      color: new THREE.Color(0.35, 0.6, 1.1),
      color1: new THREE.Color(0.2, 0.35, 0.8),
      alpha: 0.22,
      add: 1,
      erode: 0.85,
      fadeIn: 0.3,
      drag: 1,
    });
  }
}

/** A lash of shadow-cloth whipping out along a line, with a violet glow under it. */
function shadowLash(fx: Effects, from: THREE.Vector3, yaw: number, len: number, cloth: THREE.Material) {
  const n = 40;
  const geo = new THREE.PlaneGeometry(1, 1, 1, n);
  const m = new THREE.Mesh(geo, cloth);
  m.frustumCulled = false;
  m.castShadow = true;
  fx.group.add(m);
  const glowMat = new THREE.MeshBasicMaterial({ color: UMBRA.clone(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1).translate(0, 0.5, 0).rotateX(-Math.PI / 2), glowMat);
  glow.position.copy(from).setY(fx.height(from.x, from.z) + 0.05);
  glow.rotation.y = yaw + Math.PI;
  glow.renderOrder = 4;
  fx.group.add(glow);
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const side = new THREE.Vector3(dir.z, 0, -dir.x);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const ph = Math.random() * 6;
  const life = 0.75;
  fx.after(life, m, (k) => {
    // Out in a tenth of a second, a moment taut, then pulled back.
    const reach = len * (k < 0.18 ? easeOut(k / 0.18) : k < 0.55 ? 1 : 1 - easeIn((k - 0.55) / 0.45));
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const d = s * reach;
      const wob = Math.sin(s * 14 - k * 30 + ph) * 0.25 * s;
      const h = 1.3 - s * 0.7 + Math.sin(s * 6 + ph) * 0.15;
      const w = 0.16 * (1 - s * 0.7);
      const x = from.x + dir.x * d + side.x * wob;
      const z = from.z + dir.z * d + side.z * wob;
      const y = fx.height(x, z) + h;
      p.setXYZ(i * 2, x - side.x * w, y + w * 0.3, z - side.z * w);
      p.setXYZ(i * 2 + 1, x + side.x * w, y - w * 0.3, z + side.z * w);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
    glow.scale.set(1, 1, Math.max(0.01, reach));
    glowMat.opacity = 0.8 * (1 - smooth(0.5, 1, k));
  }, () => geo.dispose());
  fx.after(life, glow, () => {}, () => {
    glow.geometry.dispose();
    glowMat.dispose();
  });
  // Shadow smoke along the line.
  for (let i = 0; i < 10; i++) {
    const d = (i / 10) * len;
    const at = from.clone().addScaledVector(dir, d);
    fx.spell.puff({ pos: at.setY(fx.height(at.x, at.z) + 0.8), vel: new THREE.Vector3(0, 0.4, 0), life: 0.9, size: 0.5, size1: 1.2, color: new THREE.Color(0.02, 0.015, 0.03), alpha: 0.5, lit: 1, erode: 0.85, delay: (i / 10) * 0.12, fadeIn: 0.1 });
  }
}

/** The dark dome of her vow: a hemisphere of silence with a violet rim. */
const domeMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  uniforms: { k: { value: 0 }, time: { value: 0 }, fade: { value: 1 } },
  vertexShader: /* glsl */ `
    varying vec3 vN; varying vec3 vV; varying vec3 vP;
    void main() {
      vP = position;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float k, time, fade; varying vec3 vN; varying vec3 vV; varying vec3 vP;
    float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 q) { vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
    void main() {
      float fres = pow(1.0 - abs(dot(vN, vV)), 2.5);
      float a = atan(vP.z, vP.x);
      float n = noise(vec2(a * 6.0, vP.y * 4.0 - time * 1.5));
      float veins = smoothstep(0.62, 0.8, noise(vec2(a * 14.0 + time * 0.3, vP.y * 9.0)));
      // Dark within; only the rim and a few veins of violet light.
      vec3 col = mix(vec3(0.012, 0.004, 0.03), vec3(0.4, 0.22, 1.1), clamp(fres * 1.3 + veins * 0.5, 0.0, 1.0)) * (0.8 + n * 0.4);
      float alpha = (0.5 + fres * 0.4 + veins * 0.1) * fade;
      gl_FragColor = vec4(col, alpha);
    }
  `,
});

// ---- Abilities ----------------------------------------------------------------------

const ab = (b: Boss) => b.bossBody as AbbessBody;
/** Enraged she casts faster: shorter wind-ups. */
const pace = (b: Boss) => (b.phase === 2 ? 0.8 : 1);

/** Death Knell: she strikes the bell and its knell rolls out in rings, band after band. */
function* deathKnell(b: Boss, ctx: MonsterContext): Script {
  const f = pace(b);
  const at = b.position.clone();
  b.face(ctx.player.position, 100);
  const bands = b.phase === 2 ? 5 : 4;
  const width = 3.2;
  const gap = b.phase === 2 ? 0.45 : 0.6;
  const first = 1.25 * f;
  const teles: Telegraph[] = [];
  for (let i = 0; i < bands; i++) {
    teles.push(i === 0 ? b.tele({ kind: 'circle', r: width }, at, 0, first, KNELL) : b.tele({ kind: 'ring', r0: i * width, r1: (i + 1) * width }, at, 0, first + i * gap, KNELL));
  }
  b.bossBody.move('knell', first / 0.49, [0.49], () => {
    ab(b).rig.kick(0.4, 4.5);
  });
  audio.charge(at, first, 'soul');
  yield first;
  audio.toll();
  let hit = false;
  for (let i = 0; i < bands; i++) {
    if (i) yield gap;
    teles[i].fire();
    const r0 = i * width;
    const r1 = (i + 1) * width;
    b.fx.nova(at, r1 + 0.4, PALE, 0.55, 1.6 - i * 0.15, Math.max(0, r0 - 0.4));
    ctx.effects.spell.ring(at, r1, PALE_HOT, 0.45);
    ctx.effects.addShake(i === 0 ? 0.7 : 0.35);
    if (i === 0) {
      ctx.effects.flash(ab(b).bellAt(), 0xa0c0ff, 40, 10, 0.4);
      ctx.effects.spell.energyBurst(ab(b).bellAt(), 1.2, PALE_HOT, FROST, 12, 20);
    }
    audio.quake(at, 0.5 + 0.1 * (bands - i));
    if (!hit && b.caught(ctx, teles[i])) {
      hit = true;
      b.hurt(ctx, 1.25, at);
    }
  }
  yield 0.7;
}

/** Grave Frost: six-pointed stars of ice bloom under and around the hero. */
function* graveFrost(b: Boss, ctx: MonsterContext): Script {
  const f = pace(b);
  const n = b.phase === 2 ? 7 : 5;
  b.face(ctx.player.position, 100);
  const wind = 1.25 * f;
  b.bossBody.move('frost', wind / 0.58 , [0.58]);
  b.voice('attack');
  audio.charge(b.position, wind, 'soul');
  const p = ctx.player.position.clone();
  const spots = [b.floorNear(ctx, p, 0)];
  for (let i = 1; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI * 2 + Math.random() * 0.6;
    spots.push(b.floorNear(ctx, p.clone().add(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)).multiplyScalar(2.6 + Math.random() * 2.6)), 0.4));
  }
  const r = 1.75;
  const items = spots.map((s, i) => ({ s, at: wind + i * 0.12, t: b.tele({ kind: 'circle', r }, s, 0, wind + i * 0.12, ICE) }));
  spots.forEach((s) => frostMist(ctx.effects, s, r, 7));
  let now = 0;
  let hit = false;
  for (const it of items) {
    yield it.at - now;
    now = it.at;
    it.t.fire();
    iceStar(ctx.effects, it.s, r);
    ctx.effects.spell.crystals(it.s, 7, r * 0.75, 1.3, 0.5);
    ctx.effects.spell.decal('frost', it.s.x, it.s.z, r * 1.1, 4);
    ctx.effects.spell.ring(it.s, r * 1.2, FROST, 0.45);
    ctx.effects.spell.glitter(it.s.clone().setY(it.s.y + 0.5), r * 0.7, 14, 3);
    frostMist(ctx.effects, it.s, r * 0.8, 5);
    audio.blast(it.s, 'soul', 0.5);
    if (!hit && b.caught(ctx, it.t)) {
      hit = true;
      b.hurt(ctx, 1.15, it.s);
    }
  }
  yield 0.6;
}

/** Shadow Ribbons: her ribbons lash out in long lines at the hero, twice. */
function* shadowRibbons(b: Boss, ctx: MonsterContext): Script {
  const f = pace(b);
  const volleys = b.phase === 2 ? 3 : 2;
  const offs = b.phase === 2 ? [-0.5, -0.25, 0, 0.25, 0.5] : [-0.32, 0, 0.32];
  const len = 14;
  for (let v = 0; v < volleys; v++) {
    const yaw = b.yawTo(ctx.player.position) + (v % 2 ? 0.16 : 0);
    b.facingYaw = yaw;
    const wind = (v === 0 ? 1.1 : 0.85) * f;
    const teles = offs.map((o) => b.tele({ kind: 'rect', len, w: 1.25 }, b.position.clone(), yaw + o, wind, SHADOW));
    // Ribbon lines in the root's frame: the rig faces `yaw`, so offsets are relative.
    ab(b).ribbons(offs, (len * 0.55) / 1.9 / 1.8);
    b.bossBody.move('lash', wind / 0.46, [0.46]);
    audio.whoosh(b.position, 0.8);
    yield wind;
    let hit = false;
    offs.forEach((o, i) => {
      teles[i].fire();
      shadowLash(ctx.effects, b.position.clone().add(new THREE.Vector3(Math.sin(yaw + o), 0, Math.cos(yaw + o)).multiplyScalar(1.2)), yaw + o, len, ab(b).rig.cloth);
      if (!hit && b.caught(ctx, teles[i])) hit = true;
    });
    audio.whoosh(b.position, 1.5);
    ctx.effects.addShake(0.3);
    if (hit) b.hurt(ctx, 1.0);
    yield 0.45;
  }
  yield 0.5;
}

/** The Kneeling Dead: her sisters rise out of the floor around the hero. */
function* kneelingDead(b: Boss, ctx: MonsterContext): Script {
  b.bossBody.move('summon', 2.2);
  b.voice('aggro');
  audio.charge(b.position, 1.4, 'soul');
  const p = ctx.player.position.clone();
  const n = Math.min(b.phase === 2 ? 5 : 4, b.spareMinions(ctx, 6));
  const spots = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.random();
    return b.floorNear(ctx, p.clone().add(new THREE.Vector3(Math.sin(a) * 4, 0, Math.cos(a) * 4)), 0.6);
  });
  const teles = spots.map((s) => b.tele({ kind: 'circle', r: 1.1 }, s, 0, 1.4, KNELL));
  spots.forEach((s) => {
    b.fx.cracks(s, 1.4, new THREE.Color(0.4, 0.55, 1.0), 3);
    frostMist(ctx.effects, s, 1, 5);
  });
  yield 1.4;
  spots.forEach((s, i) => {
    teles[i].fire();
    b.fx.column(s, 0.6, 2.4, PALE, 0.9);
    b.fx.debris(s, 8, 0.5, 0.1);
    audio.blast(s, 'soul', 0.5);
    if (b.caught(ctx, teles[i])) b.hurt(ctx, 0.5, s);
    const m = b.summon(ctx, 'mourner', s, b.level - 2);
    // Held kneeling while it climbs out of the floor.
    m.stun(1.5);
    m.body.emerge?.(1.5);
  });
  yield 0.9;
}

/** Enraged: the Vow of Silence, a dome of dark that swells round her and implodes. Get out. */
function* vowOfSilence(b: Boss, ctx: MonsterContext): Script {
  const at = b.position.clone();
  const R = 7;
  const wind = 2.3;
  const t = b.tele({ kind: 'circle', r: R }, at, 0, wind, VOID);
  b.bossBody.move('clasp', wind + 0.5, [wind / (wind + 0.5)]);
  audio.charge(at, wind, 'soul');
  const mat = domeMat.clone();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.position.copy(at);
  dome.renderOrder = 16;
  ctx.effects.group.add(dome);
  let done = false;
  ctx.effects.after(wind + 0.6, dome, (k, dt) => {
    const tt = k * (wind + 0.6);
    mat.uniforms.time.value += dt;
    // Swells to the rim of the telegraph, then caves in on her.
    const r = tt < wind ? R * (0.15 + 0.85 * easeOut(tt / wind)) : R * Math.max(0.02, 1 - (tt - wind) / 0.25);
    dome.scale.set(r, r * 0.55, r);
    mat.uniforms.fade.value = tt < wind ? Math.min(1, tt * 2) : Math.max(0, 1 - (tt - wind) / 0.4);
    return done && tt > wind + 0.5;
  }, () => {
    dome.geometry.dispose();
    mat.dispose();
  });
  for (let e = 0; e < wind - 1e-4; ) {
    const st = Math.min(0.25, wind - e);
    ctx.effects.spell.rising(at, R * 0.8, UMBRA, new THREE.Color(0.1, 0.05, 0.3), st, 30);
    yield st;
    e += st;
  }
  t.fire();
  done = true;
  b.fx.nova(at, R, UMBRA, 0.5, 2.2);
  b.fx.column(at, 1.6, 7, UMBRA, 0.9);
  ctx.effects.flash(at.clone().setY(2), 0x8060ff, 50, 14, 0.5);
  ctx.effects.addShake(1.0);
  audio.blast(at, 'soul', 1.4);
  audio.toll();
  if (b.caught(ctx, t)) b.hurt(ctx, 1.9, at);
  yield 0.9;
}

export const ABBESS: BossDef = {
  epithet: 'The last bell of Saint Orsolya',
  color: KNELL,
  abilities: [
    { name: 'Death Knell', cooldown: 9, range: [0, 13], weight: 1.3, run: deathKnell },
    { name: 'Grave Frost', cooldown: 8, range: [0, 20], weight: 1.1, run: graveFrost },
    { name: 'Shadow Ribbons', cooldown: 7, range: [2.5, 15], run: shadowRibbons },
    { name: 'The Kneeling Dead', cooldown: 18, range: [0, 30], weight: 0.7, can: (b, ctx) => b.spareMinions(ctx, 6) >= 2, run: kneelingDead },
    { name: 'Vow of Silence', cooldown: 12, range: [0, 8], enraged: true, weight: 1.4, run: vowOfSilence },
  ],
  sleep(b) {
    b.bossBody.move('sleep', 1e6);
  },
  *intro(b, ctx) {
    // Lying in her tomb; the embers kindle; she lifts out of it, swings
    // upright with her ribbons unfurling, and the bell tolls once.
    b.face(ctx.player.position, 100);
    const at = b.position.clone();
    b.bossBody.move('sleep', 1.2);
    audio.charge(at, 1.2, 'soul');
    frostMist(ctx.effects, at, 2.5, 18);
    yield 1.2;
    b.bossBody.move('rise', 3.0);
    ctx.effects.spell.rising(at, 2, PALE, FROST, 0.5, 40);
    yield 1.6;
    b.fx.column(at, 1.6, 8, PALE, 1.6);
    yield 1.4;
    b.bossBody.move('knell', 1.6, [0.49], () => {
      ab(b).rig.kick(0.4, 4.5);
      audio.toll();
      b.fx.nova(at, 10, PALE_HOT, 1.0, 1.8);
      ctx.effects.spell.ring(at, 9, PALE_HOT, 0.8);
      ctx.effects.flash(ab(b).bellAt(), 0xa0c0ff, 45, 14, 0.6);
      ctx.effects.addShake(0.9);
      audio.quake(at, 1.1);
    });
    yield 0.9;
    audio.roar('abbess', at);
    ctx.banner?.(b.name, ABBESS.epithet);
    yield 1.1;
  },
  *enrage(b, ctx) {
    // The bell cracks: she wrenches it, the bronze splits with a scream of
    // cold light, and the cracks stay lit.
    const at = b.position.clone();
    b.bossBody.move('crack', 2.6, [0.55], () => {
      ab(b).setCrack(1);
      ab(b).rig.kick(-1.5, 6);
      audio.toll();
      audio.blast(at, 'soul', 1.3);
      b.fx.nova(at, 10, PALE_HOT, 0.9, 2);
      ctx.effects.spell.frostBurst(at, 3.5, 16);
      ctx.effects.flash(ab(b).bellAt(), 0xa0d0ff, 55, 14, 0.7);
      ctx.effects.addShake(1.1);
    });
    yield* b.over(1.3, (k) => ab(b).setCrack(k * 0.4));
    yield 0.2;
    audio.roar('abbess', at);
    ctx.banner?.('The Bell Cracks', 'The Silent Abbess breaks her vow');
    // The cracks cool to a steady cold glow for the rest of the fight.
    yield* b.over(1.1, (k) => ab(b).setCrack(1 - 0.45 * k));
  },
  death(b, ctx) {
    const at = b.position.clone();
    audio.roar('abbess', at);
    setTimeout(() => audio.toll(), 700);
    b.fx.column(at, 2, 9, PALE_HOT, 2.2);
    b.fx.nova(at, 10, PALE_HOT, 1.0, 2);
    ctx.effects.spell.frostBurst(at, 4, 20);
    for (let i = 0; i < 3; i++) setTimeout(() => ctx.effects.sparks(at.clone().setY(1.5), 50, PALE_HOT, 4, 1.4), i * 250);
    ctx.effects.addShake(1.2);
    setTimeout(() => {
      ctx.effects.addShake(0.6);
      audio.slam(at, 1.3);
      audio.blast(at, 'soul', 1.2);
    }, 900);
  },
};
