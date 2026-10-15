import * as THREE from 'three';
import { joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { bump, sculptLathe, sculptSphere, surfacePoint } from '../sculpt';
import { BasicRig, ease, hump } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// The Weeping Matron: a widow two and a half metres tall and thin as a rake,
// in a torn black mourning dress whose skirt and train drag along the floor,
// a long sheer veil over a head with no face to speak of: smooth pale skin,
// two dark hollows where the eyes should be and black tears run down from
// them. Her arms hang to her knees on long bony fingers. She stands hunched,
// face buried in her hands, shoulders heaving with sobs. When she attacks she
// flings her arms wide, throws her head back, the veil blows off her face and
// the face splits from ear to ear into a black, screaming mouth.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const jag = (x: number, seed: number) => Math.sin(x * 12.9898 + seed * 78.233) * 0.6 + Math.sin(x * 31.7 + seed * 3.1) * 0.4;

/** Drops the triangles whose centroid fails `keep` (works on indexed and plain geometry). */
function tear(geo: THREE.BufferGeometry, keep: (x: number, y: number, z: number) => boolean): THREE.BufferGeometry {
  const idx = geo.index;
  const p = geo.getAttribute('position');
  const out: number[] = [];
  const n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    const x = (p.getX(a) + p.getX(b) + p.getX(c)) / 3;
    const y = (p.getY(a) + p.getY(b) + p.getY(c)) / 3;
    const z = (p.getZ(a) + p.getZ(b) + p.getZ(c)) / 3;
    if (keep(x, y, z)) out.push(a, b, c);
  }
  geo.setIndex(out);
  return geo;
}

/** A grid of (cols + 1) x (rows + 1) vertices the cloth code rewrites every frame. */
function clothGrid(cols: number, rows: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = (cols + 1) * (rows + 1);
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  const uv: number[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) uv.push((c / cols) * 4, (r / rows) * 3);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const idx: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  g.setIndex(idx);
  return g;
}

interface Arm {
  side: number;
  shoulder: THREE.Object3D;
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  fingers: THREE.Object3D[][];
}

/** Model units (scale 1). */
const PELVIS_Y = 1.42;
const UPPER = 0.5;
const FORE = 0.48;
const SKIRT_COLS = 40;
const SKIRT_ROWS = 18;
const VEIL_COLS = 30;
const VEIL_CAP = 6;
const VEIL_ROWS = 22;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);

class Weeper extends BasicRig {
  readonly pelvis: THREE.Object3D;
  readonly spine: THREE.Object3D;
  readonly chest: THREE.Object3D;
  readonly neck: THREE.Object3D;
  readonly head: THREE.Object3D;
  readonly jaw: THREE.Object3D;
  readonly arms: Arm[] = [];
  /** Head-local centre of the skull. */
  readonly hc = new THREE.Vector3(0, 0.12, 0.02);
  private skirt: THREE.BufferGeometry;
  private veil: THREE.BufferGeometry;
  private skirtLen: number[] = [];
  private veilLen: number[] = [];
  /** Attack and death drive these; `animate` applies them. */
  fx = { drop: 0, fling: 0, headBack: 0, jaw: 0, blow: 0, shake: 0, flinch: 0, kneel: 0, fold: 0, dead: false, deathSide: 1 };
  private sobT = Math.random() * 10;

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, 1.8, 2.8);
    const crepe = (m.robe as THREE.MeshStandardMaterial).clone();
    crepe.color = new THREE.Color(0.075, 0.065, 0.07);
    crepe.roughness = 0.85;
    crepe.side = THREE.DoubleSide;
    crepe.emissive = new THREE.Color(0.008, 0.006, 0.007);
    const silk = new THREE.MeshStandardMaterial({ color: 0x0c0a0b, roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide });
    const veilMat = new THREE.MeshStandardMaterial({ color: 0x060405, roughness: 0.5, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
    const face = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.6, 0.58), roughness: 0.48, emissive: new THREE.Color(0.02, 0.02, 0.024) });
    const hollow = new THREE.MeshStandardMaterial({ color: 0x030102, roughness: 0.2 });
    const tears = new THREE.MeshStandardMaterial({ color: 0x050102, roughness: 0.08, metalness: 0.2 });
    const nail = new THREE.MeshStandardMaterial({ color: 0x1a1214, roughness: 0.3 });
    const needle = new THREE.MeshStandardMaterial({ color: 0x8a8274, roughness: 0.35 });

    this.pelvis = joint(this.body, 0, PELVIS_Y, 0);
    this.spine = joint(this.pelvis, 0, 0.08, 0);
    this.chest = joint(this.spine, 0, 0.3, 0);
    this.neck = joint(this.chest, 0, 0.29, 0.015);
    this.head = joint(this.neck, 0, 0.15, 0.025);

    // --- Bodice ------------------------------------------------------------
    // A wasp waist, a narrow flat ribcage, bony shoulders and a high collar.
    mesh(lathe([[0.12, 0.12], [0.135, 0.02], [0.12, -0.08], [0.1, -0.12]], 18).scale(1.15, 1, 0.85), silk, this.pelvis);
    mesh(sculptLathe([[0.1, -0.12], [0.088, 0.0], [0.084, 0.12], [0.1, 0.24], [0.11, 0.33]], (_x, _y, _z, t) => 0.004 * Math.sin(t * 14), { seg: 22, perSpan: 3, sx: 1.2, sz: 0.8 }), crepe, this.spine);
    const ribs = sculptLathe(
      [[0.105, -0.06], [0.12, 0.06], [0.125, 0.16], [0.115, 0.23], [0.085, 0.28], [0.045, 0.3], [0.035, 0.31]],
      (_x, y, _z, t) => {
        let d = 0;
        for (const s of [-1, 1]) {
          d += 0.012 * bump(t, y, s * 0.55, 0.12, 0.35, 0.05); // a flat, starved bust
          d += 0.03 * bump(t, y, s * 1.35, 0.25, 0.3, 0.04); // shoulder points
          d += 0.02 * bump(t, y, s * 2.6, 0.17, 0.3, 0.07); // shoulder blades
        }
        d += 0.012 * bump(t, y, Math.PI, 0.1, 0.12, 0.25); // spine knobs under the cloth
        return d;
      },
      { seg: 28, perSpan: 3, sx: 1.25, sz: 0.72 },
    );
    mesh(ribs, crepe, this.chest);
    // Bodice seams and a row of jet buttons down the front.
    for (let i = 0; i < 7; i++) mesh(new THREE.SphereGeometry(0.007, 6, 4), silk, i < 3 ? this.spine : this.chest, 0, i < 3 ? 0.05 + i * 0.09 : 0.0 + (i - 3) * 0.07, (i < 3 ? 0.072 : 0.092) - (i === 6 ? 0.012 : 0));
    // High collar, ruffled at the top, and a cameo brooch with a blood-red stone.
    mesh(lathe([[0.045, -0.04], [0.042, 0.04], [0.048, 0.1]], 16).scale(1, 1, 0.95), crepe, this.neck);
    const ruff = new THREE.TorusGeometry(0.05, 0.008, 4, 28).rotateX(Math.PI / 2);
    const rp = ruff.getAttribute('position');
    for (let i = 0; i < rp.count; i++) rp.setY(i, rp.getY(i) + Math.sin(Math.atan2(rp.getX(i), rp.getZ(i)) * 12) * 0.006);
    ruff.computeVertexNormals();
    mesh(ruff, silk, this.neck, 0, 0.1, 0);
    mesh(new THREE.SphereGeometry(0.018, 10, 8).scale(0.8, 1, 0.35), m.bone, this.neck, 0, 0.0, 0.047);
    mesh(new THREE.SphereGeometry(0.007, 8, 6), m.eyeRed, this.neck, 0, 0.0, 0.054);

    // --- Head --------------------------------------------------------------
    // A long smooth oval: no nose, no mouth, two sunken hollows. It splits
    // along an ear-to-ear curve; everything below rides on the jaw.
    const hc = this.hc;
    const hScale = new THREE.Vector3(0.8, 1.2, 0.92);
    const R = 0.1;
    const skull = sculptSphere(
      R,
      (x, y, z) => {
        const front = smooth(0.2, 0.8, z);
        let d = 0.05 * bump(x, y, 0, 0.3, 0.7, 0.12) * front; // soft brow
        for (const s of [-1, 1]) {
          d -= 0.17 * bump(x, y, s * 0.36, 0.12, 0.17, 0.13) * front; // hollows
          d -= 0.06 * bump(x, y, s * 0.55, -0.3, 0.2, 0.25) * front; // hollow cheeks
        }
        d -= 0.08 * smooth(-0.3, -0.95, y) * (0.6 + 0.4 * Math.abs(x)); // narrow chin
        return d;
      },
      hScale,
      36,
      28,
    );
    // The split line, in skull space: low at the chin, rising toward the ears.
    const cutY = (x: number) => R * hScale.y * (-0.28 + 3.2 * (x / (R * hScale.x)) ** 2 * 0.25);
    const upperFace = skull.clone();
    tear(upperFace, (x, y, z) => y > cutY(x) || z < -0.03);
    mesh(upperFace, face, this.head, hc.x, hc.y, hc.z);
    this.jaw = joint(this.head, 0, hc.y + 0.01, hc.z - 0.02);
    const lowerFace = skull.clone().translate(0, -0.01, 0.02);
    tear(lowerFace, (x, y, z) => y + 0.01 <= cutY(x) && z - 0.02 >= -0.03);
    mesh(lowerFace, face, this.jaw);
    // Black inside: the mouth goes back into the dark and down the throat.
    mesh(new THREE.SphereGeometry(0.075, 14, 10).scale(0.9, 1.05, 0.9), m.void, this.head, hc.x, hc.y - 0.015, hc.z);
    mesh(new THREE.SphereGeometry(0.07, 12, 8).scale(0.9, 0.9, 0.85), m.void, this.jaw, 0, -0.04, 0.0);
    mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.14, 10), m.void, this.neck, 0, 0.11, 0.0);
    // Needle teeth along both lips of the split.
    for (let i = 0; i < 18; i++) {
      const u = (i / 17) * 2 - 1;
      const a = u * 1.15;
      const x = Math.sin(a) * R * hScale.x * 0.92;
      const z = Math.cos(a) * R * hScale.z * 0.9;
      const y = cutY(x);
      const l = 0.016 * (1 - 0.5 * Math.abs(u)) * range(rng, 0.7, 1.2);
      mesh(new THREE.ConeGeometry(0.0022, l, 4).rotateX(Math.PI).translate(0, -l / 2 + 0.002, 0), needle, this.head, hc.x + x, hc.y + y, hc.z + z - 0.004).rotation.y = a;
      const lj = l * range(rng, 0.7, 1.1);
      mesh(new THREE.ConeGeometry(0.0022, lj, 4).translate(0, lj / 2 - 0.002, 0), needle, this.jaw, x, y - 0.01, z + 0.02 - 0.004).rotation.y = a;
    }
    // Dark glossy hollows, and black tears run down from them.
    for (const s of [-1, 1]) {
      const theta = s * Math.atan2(0.36 * hScale.x, 0.93 * hScale.z);
      const e = surfacePoint(skull, 0.12 * R * hScale.y, theta, -0.012);
      mesh(new THREE.SphereGeometry(0.019, 10, 8).scale(1, 1.25, 0.6), hollow, this.head, hc.x + e.x, hc.y + e.y, hc.z + e.z);
      for (let k = 0; k < 2; k++) {
        const off = (k === 0 ? 0.02 : -0.08) * s;
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j <= 8; j++) {
          const y = (0.04 - j * 0.04 - (k ? 0.01 : 0)) * R * hScale.y * 3;
          const wob = Math.sin(j * 1.7 + k * 2 + s) * 0.03;
          pts.push(surfacePoint(skull, y, theta + off + wob - s * j * 0.015, 0.0015));
        }
        // Split the streak where the face splits.
        let run: THREE.Vector3[] = [];
        let below = false;
        const flush = () => {
          if (run.length > 1) {
            const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(run), run.length * 3, k ? 0.0022 : 0.0032, 4);
            if (below) mesh(tube.translate(0, -0.01, 0.02), tears, this.jaw);
            else mesh(tube.translate(hc.x, hc.y, hc.z), tears, this.head);
          }
        };
        for (const p of pts) {
          const b = p.y <= cutY(p.x);
          if (run.length && b !== below) {
            flush();
            run = [];
          }
          below = b;
          run.push(p.clone());
        }
        flush();
      }
    }

    // --- Arms --------------------------------------------------------------
    for (const side of [-1, 1]) {
      const shoulder = joint(this.chest, side * 0.155, 0.245, -0.01);
      const upper = joint(shoulder, 0, 0, 0);
      mesh(new THREE.SphereGeometry(0.042, 10, 8), crepe, shoulder);
      mesh(sculptLathe([[0.036, 0.02], [0.034, -0.12], [0.028, -0.4], [0.026, -0.5]], (_x, y, _z, t) => 0.003 * Math.sin(t * 9 + y * 30), { seg: 12, perSpan: 3 }), crepe, upper);
      const fore = joint(upper, 0, -UPPER, 0);
      mesh(new THREE.SphereGeometry(0.026, 8, 6), crepe, fore);
      mesh(sculptLathe([[0.027, 0.0], [0.028, -0.1], [0.022, -0.36], [0.02, -0.4]], () => 0, { seg: 12, perSpan: 2 }), crepe, fore);
      // Torn lace cuff flaring off the wrist, and the bare bony wrist below.
      const cuff = sculptLathe([[0.022, -0.36], [0.034, -0.42], [0.05, -0.47]], (_x, _y, _z, t) => 0.008 * Math.sin(t * 11), { seg: 16, perSpan: 2 });
      mesh(tear(cuff, (x, y, z) => y > -0.465 + jag(Math.atan2(x, z) * 4, side) * 0.012 && Math.sin(Math.atan2(x, z) * 7 + y * 40) > -0.85), silk, fore);
      mesh(lathe([[0.016, -0.36], [0.017, -0.44], [0.019, -0.48]], 8), face, fore);
      const hand = joint(fore, 0, -FORE, 0);
      // Long narrow palm with knuckles, and spidery fingers.
      mesh(sculptSphere(0.04, (x, y) => 0.08 * smooth(0.2, 0.9, -y) - 0.05 * bump(x, y, 0, 0.6, 0.6, 0.3), new THREE.Vector3(0.75, 1.35, 0.32), 12, 10), face, hand, 0, -0.045, 0);
      const fingers: THREE.Object3D[][] = [];
      for (let f = 0; f < 5; f++) {
        const thumb = f === 4;
        const base = thumb ? joint(hand, -side * 0.026, -0.025, 0.012) : joint(hand, side * (f - 1.5) * 0.014, -0.095, 0);
        if (thumb) base.rotation.set(0.35, 0, -side * 0.55);
        else base.rotation.z = side * (f - 1.5) * 0.06;
        const lens = thumb ? [0.045, 0.04] : [0.07, 0.055, 0.045].map((l) => l * (1 - Math.abs(f - 1.3) * 0.07));
        const chain: THREE.Object3D[] = [];
        let parent = base;
        for (let s = 0; s < lens.length; s++) {
          const j = s === 0 ? base : joint(parent, 0, -lens[s - 1], 0);
          const r = 0.0058 - s * 0.0009;
          mesh(new THREE.CylinderGeometry(r * 0.85, r, lens[s], 5).translate(0, -lens[s] / 2, 0), face, j);
          mesh(new THREE.SphereGeometry(r * 1.2, 6, 4), face, j); // knuckle
          chain.push(j);
          parent = j;
        }
        const tip = joint(parent, 0, -lens[lens.length - 1], 0.002);
        mesh(new THREE.ConeGeometry(0.0045, 0.022, 4).rotateX(Math.PI).translate(0, -0.008, 0).scale(1, 1, 0.5), nail, tip);
        fingers.push(chain);
      }
      this.arms.push({ side, shoulder, upper, fore, hand, fingers });
    }

    // --- Skirt and veil: cloth rebuilt every frame ---------------------------
    this.skirt = clothGrid(SKIRT_COLS, SKIRT_ROWS);
    for (let c = 0; c <= SKIRT_COLS; c++) {
      const a = (c / SKIRT_COLS) * Math.PI * 2;
      const back = (1 - Math.cos(a)) / 2;
      this.skirtLen.push(PELVIS_Y + 0.04 + 0.06 + 0.8 * back ** 2.5 + jag(c * 0.37, 3) * 0.05);
    }
    // A few long rents up from the hem.
    tear(this.skirt, () => true);
    {
      const idx = this.skirt.index!;
      const keep: number[] = [];
      const rents = [range(rng, 0.2, 0.8), range(rng, 2.0, 2.6), range(rng, 3.6, 4.4), range(rng, 5.2, 5.9)].map((a) => Math.round((a / (Math.PI * 2)) * SKIRT_COLS));
      const rentTop = rents.map(() => Math.round(range(rng, 0.45, 0.7) * SKIRT_ROWS));
      for (let i = 0; i < idx.count; i += 3) {
        const v = idx.getX(i);
        const c = v % (SKIRT_COLS + 1);
        const r = Math.floor(v / (SKIRT_COLS + 1));
        const ri = rents.indexOf(c);
        if (ri >= 0 && r >= rentTop[ri]) continue;
        keep.push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      }
      this.skirt.setIndex(keep);
    }
    const skirtMesh = mesh(this.skirt, crepe, this.body);
    skirtMesh.userData.dynamic = true;
    skirtMesh.frustumCulled = false;

    this.veil = clothGrid(VEIL_COLS, VEIL_ROWS);
    for (let c = 0; c <= VEIL_COLS; c++) {
      const a = (c / VEIL_COLS) * Math.PI * 2;
      const back = (1 - Math.cos(a)) / 2;
      this.veilLen.push(0.72 + 1.5 * back ** 1.5 + jag(c * 0.53, 8) * 0.04);
    }
    const veilMesh = mesh(this.veil, veilMat, this.body);
    veilMesh.userData.dynamic = true;
    veilMesh.frustumCulled = false;
    veilMesh.castShadow = false;
    veilMesh.renderOrder = 2;

    this.animate(0);
    bakeRig(this.root);
    this.root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) sm.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.3 * scale, 0), 2.2 * scale);
    });
    this.cloth();
  }

  update(dt: number, speed: number) {
    super.update(dt, speed);
    this.cloth();
  }

  protected animate(dt: number) {
    const t = this.time;
    const w = this.walk;
    const ph = this.phase;
    const fx = this.fx;
    // She sobs when she stands still, in waves: a run of shuddering heaves,
    // then a long shaking breath.
    this.sobT += dt;
    const wave = smooth(-0.2, 0.6, Math.sin(this.sobT * 0.8));
    const heave = Math.pow(Math.max(0, Math.sin(this.sobT * 7.2)), 3) * wave;
    const sobbing = (1 - w) * (1 - fx.drop) * (1 - fx.kneel);
    const sob = heave * sobbing;
    const tremor = Math.sin(t * 33) * 0.004 * sobbing + fx.shake * Math.sin(t * 57) * 0.02;

    // Walking: a slow sway from side to side, the hem dragging.
    const sway = Math.sin(ph);
    this.pelvis.position.set(sway * 0.045 * w, PELVIS_Y - 0.025 * Math.abs(Math.cos(ph)) * w + 0.05 * fx.drop - (PELVIS_Y - 0.5) * fx.kneel, 0.1 * fx.kneel);
    this.pelvis.rotation.set(0.05 * w - 0.15 * fx.fold, Math.sin(ph) * 0.08 * w, -sway * 0.05 * w);
    const hunch = (1 - fx.drop * 0.7) * (1 - fx.fling * 0.3);
    this.spine.rotation.set(0.18 * hunch + 0.08 * w + 0.6 * fx.fold - 0.1 * fx.headBack - 0.15 * fx.flinch, -sway * 0.06 * w, sway * 0.04 * w + tremor);
    this.chest.rotation.set(0.3 * hunch + sob * 0.06 + 0.55 * fx.fold - 0.15 * fx.headBack, 0, -tremor);
    this.chest.position.y = 0.3 + sob * 0.012;
    this.chest.scale.setScalar(1 + 0.05 * fx.fling);
    this.neck.rotation.set(0.32 * hunch - 0.5 * fx.headBack + 0.3 * fx.fold, 0, 0);
    this.head.rotation.set(0.12 * hunch + sob * 0.08 - 0.45 * fx.headBack + 0.3 * fx.fold + Math.sin(t * 0.6) * 0.02, this.lookYaw * 0.3 + Math.sin(t * 0.37) * 0.05 * (1 - w), fx.fold * 0.4 * fx.deathSide + Math.sin(t * 0.5) * 0.03);
    // The face splits wide and stretches down.
    this.jaw.rotation.x = fx.jaw * 0.95;
    this.jaw.scale.set(1 + fx.jaw * 0.15, 1 + fx.jaw * 0.5, 1);
    this.jaw.position.y = this.hc.y + 0.01 - fx.jaw * 0.03;

    // Arms: hanging (walking), wide (screaming), spilled (dying) or covering
    // the face (sobbing), the last solved so the hands stay on the face.
    this.root.updateMatrixWorld(true);
    const headQ = this.head.getWorldQuaternion(new THREE.Quaternion());
    const chestQ = this.chest.getWorldQuaternion(new THREE.Quaternion());
    for (const arm of this.arms) {
      const s = arm.side;
      arm.shoulder.position.y = 0.245 + sob * 0.018;
      // Hanging pose, swinging a little behind the sway.
      const swing = Math.sin(ph + (s > 0 ? 0 : Math.PI)) * 0.12 * w;
      const hang = new THREE.Euler(0.1 + swing + 0.15 * w + Math.sin(t * 0.9 + s) * 0.03 - 0.3 * fx.fold, 0, s * (0.07 + 0.25 * fx.fold));
      let qU = new THREE.Quaternion().setFromEuler(hang);
      let qF = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12 - Math.max(0, swing) * 0.5 - 0.3 * fx.fold, 0, 0));
      let qH = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -s * Math.PI * 0.45, 0));
      // Covering the face.
      const cover = sobbing * (1 - fx.flinch);
      if (cover > 0.001) {
        const ik = this.solveCover(arm, headQ, chestQ);
        qU = qU.slerp(ik[0], cover);
        qF = qF.slerp(ik[1], cover);
        qH = qH.slerp(ik[2], cover);
      }
      // Flung wide, fingers splayed.
      if (fx.fling > 0.001) {
        const wide = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.55, 0, s * 1.45));
        qU.slerp(wide, fx.fling);
        qF.slerp(_q.setFromEuler(new THREE.Euler(-0.25, 0, s * 0.2)), fx.fling);
        qH.slerp(_q.setFromEuler(new THREE.Euler(-0.4, -s * Math.PI * 0.5, 0)), fx.fling);
      }
      arm.upper.quaternion.copy(qU);
      arm.fore.quaternion.copy(qF);
      arm.hand.quaternion.copy(qH);
      for (const [i, chain] of arm.fingers.entries()) {
        const thumb = i === 4;
        const twitch = Math.pow(Math.max(0, Math.sin(t * 1.3 + i * 1.7 + s)), 12) * 0.25;
        const curl = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.25 + twitch, 0.18 + sob * 0.15, cover), -0.25, fx.fling) + 0.4 * fx.fold;
        chain.forEach((j, k) => (j.rotation.x = (thumb ? 0.5 : 1) * curl * (k === 0 ? 0.6 : 1)));
      }
    }
  }

  /** Two-bone solve putting the hand over its side of the face, elbows jutting down and out. */
  private solveCover(arm: Arm, headQ: THREE.Quaternion, chestQ: THREE.Quaternion): [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion] {
    const s = arm.side;
    const hc = this.hc;
    // Wrist under the jaw, the palm laid up over the hollow.
    const target = this.head.localToWorld(_v.set(hc.x + s * 0.04, hc.y - 0.1, hc.z + 0.115));
    const T = this.chest.worldToLocal(target.clone());
    const S = arm.shoulder.position.clone();
    const a = UPPER;
    const b = FORE;
    const D = T.clone().sub(S);
    const d = THREE.MathUtils.clamp(D.length(), Math.abs(a - b) + 1e-3, (a + b) * 0.999);
    const dir = D.normalize();
    const pole = new THREE.Vector3(s * 0.75, -1, 0.15);
    const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const E = S.clone().add(dir.clone().multiplyScalar(cosA * a)).add(perp.multiplyScalar(sinA * a));
    const qU = new THREE.Quaternion().setFromUnitVectors(DOWN, E.clone().sub(S).normalize());
    const toT = S.clone().add(dir.multiplyScalar(d)).sub(E).normalize();
    const qF = new THREE.Quaternion().setFromUnitVectors(DOWN, toT.applyQuaternion(qU.clone().invert()));
    // Hand: fingers up the face, palm toward it, splayed a little outward.
    _m.makeBasis(_v.set(-1, 0, 0), _w.set(0, -1, 0), new THREE.Vector3(0, 0, 1));
    _q2.setFromRotationMatrix(_m).premultiply(_q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * 0.12));
    const handWorld = headQ.clone().multiply(_q2);
    const foreWorld = chestQ.clone().multiply(qU).multiply(qF);
    const qH = foreWorld.invert().multiply(handWorld);
    return [qU, qF, qH];
  }

  /** Rebuilds skirt and veil from the pose: hanging, trailing and pooling on the floor. */
  private cloth() {
    this.root.updateMatrixWorld(true);
    const inv = _m.copy(this.body.matrixWorld).invert();
    const fx = this.fx;
    const w = this.walk;
    const ph = this.phase;
    const t = this.time;

    // Skirt.
    {
      const toBody = new THREE.Matrix4().multiplyMatrices(inv, this.pelvis.matrixWorld);
      const centre = new THREE.Vector3(0, 0, 0).applyMatrix4(toBody);
      const p = this.skirt.getAttribute('position') as THREE.BufferAttribute;
      const W = new THREE.Vector3();
      const knees = [-1, 1].map((s) => Math.max(0, Math.sin(ph + (s > 0 ? 0 : Math.PI))) * w);
      for (let c = 0; c <= SKIRT_COLS; c++) {
        const a = (c / SKIRT_COLS) * Math.PI * 2;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        W.set(sa * 0.135, 0.04, ca * 0.105).applyMatrix4(toBody);
        const ox = W.x - centre.x;
        const oz = W.z - centre.z;
        const ol = Math.hypot(ox, oz) || 1;
        const back = (1 - ca) / 2;
        const hemR = 0.36 + 0.12 * back;
        const len = this.skirtLen[c];
        const H = Math.max(0.05, W.y);
        for (let r = 0; r <= SKIRT_ROWS; r++) {
          const s = (r / SKIRT_ROWS) * len;
          const u = Math.min(s, H);
          const un = u / (PELVIS_Y + 0.04);
          const fold = 0.022 * Math.sin(a * 11 + Math.sin(a * 3) * 1.5) * Math.min(1, un * 1.6) + 0.01 * Math.sin(a * 23 + 1);
          const flare = (hemR - 0.12) * Math.pow(un, 1.5) + fold;
          let x = W.x + (ox / ol) * flare;
          let z = W.z + (oz / ol) * flare;
          let y = W.y - u;
          // Knees push the front out as she walks; the hem drags behind.
          for (const [i, s2] of [-1, 1].entries()) {
            const da = ((a - s2 * 0.35 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            const near = Math.exp(-(da * da) / 0.12);
            z += knees[i] * near * 0.13 * Math.exp(-((un - 0.55) ** 2) / 0.06) * Math.max(0, ca);
          }
          z -= w * 0.16 * un * un;
          x += Math.sin(ph - 1) * 0.05 * un * un * w;
          // Kneeling: knees out in front under the cloth.
          z += fx.kneel * 0.32 * Math.max(0, ca) * smooth(0.1, 0.5, u / H);
          // Past the floor the rest of the length lies on it, spreading out
          // and, behind, trailing back.
          if (s > H) {
            const e = s - H;
            const dx = ox / ol;
            const dz = oz / ol - 0.6 * back - w * 0.4;
            const dl = Math.hypot(dx, dz) || 1;
            x += (dx / dl) * e;
            z += (dz / dl) * e;
            y = 0.012 + 0.006 * Math.sin(a * 9 + e * 20);
          }
          y = Math.max(0.008, y + Math.sin(t * 1.3 + a * 3) * 0.004 * un);
          p.setXYZ(r * (SKIRT_COLS + 1) + c, x, y, z);
        }
      }
      p.needsUpdate = true;
      this.skirt.computeVertexNormals();
    }

    // Veil: a cap over the crown, then cloth falling from the widest part of
    // the head, draped around the hunched shoulders and back and down over
    // the skirt to the floor; the scream blows it back off the face.
    {
      const toBody = new THREE.Matrix4().multiplyMatrices(inv, this.head.matrixWorld);
      const headQ = new THREE.Quaternion().setFromRotationMatrix(toBody);
      const blowDir = new THREE.Vector3(0, 0.35, -1).normalize().applyQuaternion(headQ);
      const at = (o: THREE.Object3D, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      // The body's axis, top to bottom, and the heights its girth changes at.
      const neckP = at(this.neck, 0, 0.02, 0);
      const shoulderP = at(this.chest, 0, 0.22, 0);
      const waistP = at(this.spine, 0, 0.05, 0);
      const pelvisP = at(this.pelvis, 0, 0, 0);
      const axis = [at(this.head, this.hc.x, this.hc.y, this.hc.z), neckP, shoulderP, waistP, pelvisP, new THREE.Vector3(pelvisP.x, 0, pelvisP.z - 0.05)];
      const axisAt = (y: number, out: THREE.Vector3) => {
        if (y >= axis[0].y) return out.copy(axis[0]);
        for (let i = 0; i < axis.length - 1; i++) {
          const a0 = axis[i];
          const a1 = axis[i + 1];
          if (y <= a0.y && y >= a1.y) return out.copy(a0).lerp(a1, a0.y - a1.y > 1e-4 ? (a0.y - y) / (a0.y - a1.y) : 0);
        }
        return out.copy(axis[axis.length - 1]);
      };
      const lerp2 = (y: number, y0: number, y1: number, r0: number, r1: number) => r0 + (r1 - r0) * Math.min(1, Math.max(0, (y - y0) / (y1 - y0 || 1)));
      const girth = (y: number, dx: number, dz: number) => {
        let rx: number;
        let rz: number;
        if (y >= neckP.y) [rx, rz] = [0.06, 0.06];
        else if (y >= shoulderP.y) [rx, rz] = [lerp2(y, shoulderP.y, neckP.y, 0.25, 0.07), lerp2(y, shoulderP.y, neckP.y, 0.18, 0.07)];
        else if (y >= waistP.y) [rx, rz] = [lerp2(y, waistP.y, shoulderP.y, 0.14, 0.25), lerp2(y, waistP.y, shoulderP.y, 0.11, 0.18)];
        else if (y >= pelvisP.y) [rx, rz] = [0.15, 0.12];
        else {
          const f = Math.pow(Math.min(1, (pelvisP.y - y) / Math.max(0.2, pelvisP.y)), 1.5);
          [rx, rz] = [0.16 + 0.24 * f, 0.13 + (dz < 0 ? 0.38 : 0.26) * f];
        }
        return 1 / Math.sqrt((dx / rx) ** 2 + (dz / rz) ** 2) + 0.03;
      };
      const p = this.veil.getAttribute('position') as THREE.BufferAttribute;
      const hc = this.hc;
      const P = new THREE.Vector3();
      const A = new THREE.Vector3();
      const D0 = new THREE.Vector3();
      const u = new THREE.Vector3();
      const col = new THREE.Vector3();
      const blow = fx.blow;
      for (let c = 0; c <= VEIL_COLS; c++) {
        const a = (c / VEIL_COLS) * Math.PI * 2;
        const sa = Math.sin(a);
        const ca = Math.cos(a);
        const front = Math.max(0, ca);
        const len = this.veilLen[c];
        // Front of the cap lifts and folds back with the blast.
        const capEnd = 1.75 - blow * front * 1.1;
        const bw = Math.min(1, blow * (0.2 + front * 1.2));
        D0.set(Math.sin(capEnd) * sa * 0.093, Math.cos(capEnd) * 0.135 + 0.01, Math.sin(capEnd) * ca * 0.107).add(hc).applyMatrix4(toBody);
        col.set(sa, 0, ca).applyQuaternion(headQ).setY(0).normalize();
        axisAt(D0.y, A);
        u.set(D0.x - A.x, 0, D0.z - A.z);
        const r0 = u.length();
        u.multiplyScalar(1 / Math.max(r0, 1e-4)).addScaledVector(col, 0.6).normalize();
        for (let r = 0; r <= VEIL_ROWS; r++) {
          if (r <= VEIL_CAP) {
            const phi = (r / VEIL_CAP) * capEnd;
            P.set(Math.sin(phi) * sa * 0.093, Math.cos(phi) * 0.135 + 0.01, Math.sin(phi) * ca * 0.107).add(hc).applyMatrix4(toBody);
          } else {
            const s = ((r - VEIL_CAP) / (VEIL_ROWS - VEIL_CAP)) * len;
            const flutter = Math.sin(t * (2.0 + 9 * blow) + a * 3 - s * 6) * (0.015 + 0.06 * blow) * s;
            let y = D0.y - s;
            let e = 0;
            if (y < 0.015) {
              e = 0.015 - y;
              y = 0.015 + 0.004 * Math.sin(a * 7 + s * 9);
            }
            axisAt(y, A);
            const rr = Math.max(r0 + 0.06 * s, girth(y, u.x, u.z)) + (0.018 * Math.sin(a * 11) + 0.01 * Math.sin(a * 23 + 2)) * Math.min(1, s * 1.5) + flutter;
            P.set(A.x + u.x * rr, y, A.z + u.z * rr);
            // On the floor it spreads out and back.
            P.x += u.x * e * 0.6;
            P.z += u.z * e * 0.6 - e * 0.7;
            // Walking: the long back of the veil streams behind.
            const tail = ((r - VEIL_CAP) / (VEIL_ROWS - VEIL_CAP)) ** 2;
            P.z -= w * 0.3 * tail * len * (0.3 + 0.7 * (1 - ca) / 2);
            P.x += Math.sin(ph - 1.4) * 0.04 * tail * w;
            if (bw > 0) {
              // Blown back: off the face and streaming behind the head.
              A.copy(D0).addScaledVector(blowDir, s * 0.8).addScaledVector(col, 0.08 * s + flutter);
              A.y += Math.sin(t * 13 + a * 2 + s * 4) * 0.03 * s;
              P.lerp(A, bw);
              P.y = Math.max(0.015, P.y);
            }
          }
          p.setXYZ(r * (VEIL_COLS + 1) + c, P.x, P.y, P.z);
        }
      }
      p.needsUpdate = true;
      this.veil.computeVertexNormals();
    }
  }
}

export function buildWeeper(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  const c = new Weeper(m, rng, scale * range(rng, 0.97, 1.04));
  const fx = c.fx;
  return {
    rig: c,
    attack(onHit) {
      // Hands fall from the face, arms fling wide, head back; the veil blows
      // off and the face tears open into a scream that rolls out before her.
      let fired = false;
      c.play(
        1.7,
        (k) => {
          const out = 1 - ease(k, 0.78, 1);
          fx.drop = ease(k, 0.0, 0.22) * (1 - ease(k, 0.85, 1));
          fx.fling = ease(k, 0.18, 0.38) * out;
          fx.headBack = (ease(k, 0.2, 0.4) - 0.45 * ease(k, 0.44, 0.56)) * out;
          fx.blow = ease(k, 0.3, 0.5) * (1 - ease(k, 0.78, 0.98));
          fx.jaw = ease(k, 0.42, 0.54) * (1 - ease(k, 0.76, 0.92));
          fx.shake = hump(k, 0.5, 0.8);
          if (!fired && k >= 0.55) {
            fired = true;
            onHit();
          }
        },
        () => {
          Object.assign(fx, { drop: 0, fling: 0, headBack: 0, jaw: 0, blow: 0, shake: 0 });
          if (!fired) onHit();
        },
      );
    },
    flinch() {
      if (c.acting) return;
      c.play(
        0.4,
        (k) => {
          fx.flinch = Math.sin(k * Math.PI);
        },
        () => (fx.flinch = 0),
      );
    },
    die() {
      // She crumples to her knees, then folds forward over them.
      Object.assign(fx, { drop: 0, fling: 0, headBack: 0, jaw: 0, blow: 0, shake: 0, flinch: 0, dead: true, deathSide: Math.random() < 0.5 ? -1 : 1 });
      c.play(2.2, (k) => {
        fx.kneel = Math.min(1, k / 0.32) ** 2;
        fx.fold = ease(k, 0.38, 0.85);
        fx.jaw = hump(k, 0.0, 0.3) * 0.4;
      });
    },
  };
}
