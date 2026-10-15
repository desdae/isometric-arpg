import * as THREE from 'three';
import { Character, joint, lathe, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { boxProjectUVs } from '../../procgen/geometry';
import { band, bumpA, sculptLathe, strapLoop, surfacePoint } from '../sculpt';
import { flinch, keyedAction } from './humanoid';
import type { MonsterBody, MonsterMaterials } from './materials';

// Gaol Butcher: the prison's executioner, a hulking, hunched man half again
// as tall as a man. A pointed leather hood hides everything but a dark slot
// and two red sparks; riveted iron lames and layered pauldrons are strapped
// over a leather jerkin and a gut like a barrel. A blood-soaked apron hangs
// to his shins, chains and meat hooks swing from his belt, his forearms are
// bare and bound with filthy wraps, and he drags a notched cleaver as long as
// a child, its edge black with old blood.

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// --- Procedural textures (built once, shared by every butcher) ------------

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, rnd: () => number) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  draw(g, rnd);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A soft, soaked-in stain. */
function blot(g: CanvasRenderingContext2D, x: number, y: number, r: number, sy: number, col: [number, number, number], a: number) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
  grad.addColorStop(0.6, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.7})`);
  grad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
  g.fillStyle = grad;
  g.save();
  g.translate(x, y);
  g.scale(1, sy);
  g.translate(-x, -y);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** A run of blood: a thin wavering line down from (x, y) ending in a bead. */
function drip(g: CanvasRenderingContext2D, rnd: () => number, x: number, y: number, len: number, w: number, a: number) {
  g.strokeStyle = `rgba(${70 + rnd() * 40},4,3,${a})`;
  g.fillStyle = g.strokeStyle;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  const wob = (rnd() - 0.5) * 3;
  g.bezierCurveTo(x + wob, y + len * 0.3, x - wob, y + len * 0.7, x + wob * 0.5, y + len);
  g.stroke();
  g.beginPath();
  g.arc(x + wob * 0.5, y + len, w * 0.9, 0, Math.PI * 2);
  g.fill();
}

let apronTex: THREE.CanvasTexture | null = null;
let bladeTex: THREE.CanvasTexture | null = null;

/** Stiff hide apron: brown leather gone black-red with blood from the hem up. */
function getApronTexture() {
  apronTex ??= canvasTexture(128, 256, (g, rnd) => {
    g.fillStyle = '#3e2e22';
    g.fillRect(0, 0, 128, 256);
    // Mottled, greasy hide.
    g.filter = 'blur(3px)';
    for (let i = 0; i < 60; i++) blot(g, rnd() * 128, rnd() * 256, 6 + rnd() * 16, 0.6 + rnd(), rnd() < 0.5 ? [30, 20, 14] : [96, 74, 56], 0.35);
    // Soaked from the hem up, darkest at the bottom; old brown stains above.
    g.filter = 'none';
    const grad = g.createLinearGradient(0, 70, 0, 256);
    grad.addColorStop(0, 'rgba(80,6,4,0)');
    grad.addColorStop(0.4, 'rgba(70,6,4,0.75)');
    grad.addColorStop(1, 'rgba(26,2,2,0.97)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 256);
    g.filter = 'blur(2px)';
    for (let i = 0; i < 18; i++) blot(g, rnd() * 128, 20 + rnd() * 200, 5 + rnd() * 14, 0.5 + rnd() * 0.8, rnd() < 0.4 ? [60, 22, 12] : [115, 8, 5], 0.55 + rnd() * 0.35);
    // Wiped hands: broad smears dragged down and sideways.
    for (let i = 0; i < 5; i++) {
      const x = 15 + rnd() * 98;
      const y = 40 + rnd() * 90;
      for (let k = 0; k < 4; k++) blot(g, x + k * (rnd() * 6 - 3), y + k * 8, 7 - k, 0.6, [120, 10, 6], 0.5);
    }
    // Runs dripping toward the hem.
    g.filter = 'blur(0.6px)';
    for (let i = 0; i < 26; i++) drip(g, rnd, rnd() * 128, 50 + rnd() * 110, 20 + rnd() * 70, 1.2 + rnd() * 2.2, 0.55 + rnd() * 0.4);
    g.filter = 'none';
  });
  return apronTex;
}

/** Cleaver steel: dull grey, rust along the spine, the edge half black with blood. */
function getBladeTexture() {
  bladeTex ??= canvasTexture(128, 256, (g, rnd) => {
    g.fillStyle = '#7d7975';
    g.fillRect(0, 0, 128, 256);
    g.filter = 'blur(2px)';
    for (let i = 0; i < 70; i++) blot(g, rnd() * 128, rnd() * 256, 4 + rnd() * 14, 0.5 + rnd(), rnd() < 0.5 ? [60, 58, 56] : [150, 146, 140], 0.35);
    // Rust bloom along the spine (u = 0 side) and round the hanging hole.
    for (let i = 0; i < 40; i++) blot(g, rnd() * 30, rnd() * 256, 4 + rnd() * 10, 0.8 + rnd(), [95 + rnd() * 30, 45, 18], 0.55);
    // Blood caked along the edge (u = 1), soaked back across the flat.
    g.filter = 'none';
    const grad = g.createLinearGradient(128, 0, 40, 0);
    grad.addColorStop(0, 'rgba(60,3,2,0.95)');
    grad.addColorStop(0.35, 'rgba(105,7,4,0.7)');
    grad.addColorStop(1, 'rgba(105,7,4,0)');
    g.fillStyle = grad;
    g.fillRect(30, 0, 98, 256);
    g.filter = 'blur(2px)';
    for (let i = 0; i < 22; i++) blot(g, 50 + rnd() * 78, rnd() * 256, 4 + rnd() * 12, 0.5 + rnd(), [110, 8, 5], 0.5 + rnd() * 0.4);
    // Smears where it was wiped on a sleeve: long streaks back from the edge.
    for (let i = 0; i < 7; i++) {
      const y = rnd() * 240;
      for (let k = 0; k < 6; k++) blot(g, 120 - k * 12, y - k * 3, 5 - k * 0.5, 0.45, [100, 6, 4], 0.45);
    }
    g.filter = 'blur(0.5px)';
    for (let i = 0; i < 14; i++) drip(g, rnd, 50 + rnd() * 75, 20 + rnd() * 200, 15 + rnd() * 35, 1.2 + rnd() * 1.8, 0.8);
    g.filter = 'none';
  });
  return bladeTex;
}

// --- Geometry helpers -----------------------------------------------------

/**
 * A patch of a sculpted lathe's surface (heights y0..y1, angles t0..t1),
 * lifted off it by `lift`: plates, bibs and bracers that sit exactly on the
 * sculpted body.
 */
function surfacePatch(geo: THREE.BufferGeometry, y0: number, y1: number, t0: number, t1: number, lift: number, nx = 10, ny = 3): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const v = j / ny;
      const p = surfacePoint(geo, y0 + (y1 - y0) * v, t0 + (t1 - t0) * u, lift);
      pos.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      idx.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Iron chain laid along `pts`: alternating links, each turned a quarter. */
function chain(parent: THREE.Object3D, pts: THREE.Vector3[], mat: THREE.Material, r = 0.017) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const len = curve.getLength();
  const step = r * 2.1;
  const n = Math.max(2, Math.floor(len / step));
  const link = new THREE.TorusGeometry(r, r * 0.32, 4, 8).scale(0.75, 1.35, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const l = mesh(link, mat, parent, p.x, p.y, p.z);
    l.quaternion.setFromUnitVectors(up, t);
    if (i % 2) l.rotateY(Math.PI / 2);
  }
}

/** A meat hook: an eye, a short shank and a J ending in a point. */
function meatHook(parent: THREE.Object3D, mat: THREE.Material, rust: THREE.Material, s = 1) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.07, 0),
    new THREE.Vector3(0, -0.14, 0),
    new THREE.Vector3(0.012, -0.19, 0),
    new THREE.Vector3(0.05, -0.215, 0),
    new THREE.Vector3(0.082, -0.19, 0),
    new THREE.Vector3(0.088, -0.15, 0),
  ]);
  mesh(new THREE.TubeGeometry(curve, 20, 0.0085, 6).scale(s, s, s), mat, parent);
  const tip = mesh(new THREE.ConeGeometry(0.0085 * s, 0.04 * s, 6), mat, parent, 0.088 * s, -0.135 * s, 0);
  tip.rotation.z = -0.15;
  mesh(new THREE.TorusGeometry(0.018 * s, 0.006 * s, 4, 10), mat, parent, 0, 0.012 * s, 0);
  // Gore crusted in the bend.
  mesh(new THREE.SphereGeometry(0.022 * s, 6, 5).scale(1.4, 0.8, 1), rust, parent, 0.045 * s, -0.2 * s, 0);
}

/** A strip of rag wound round a limb: a lumpy, slightly spiralled band. */
function wrap(r: number, h: number, turn: number, rng: Rng): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, 18, 1, true);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const lump = range(rng, 0, 6);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(x, z);
    const k = 1 + 0.06 * Math.sin(a * 3 + lump);
    p.setXYZ(i, x * k, p.getY(i) + Math.sin(a) * turn, z * k);
  }
  g.computeVertexNormals();
  return boxProjectUVs(g, 8);
}

/** The cleaver: blade along +Y with its edge toward +Z, grip below the origin. */
function cleaverParts(rng: Rng) {
  const L = 0.7;
  const W = 0.3;
  const s = new THREE.Shape();
  // Spine (x < 0) runs nearly straight; the edge (x = W) is hacked with notches.
  s.moveTo(-0.03, 0.12);
  s.lineTo(-0.04, L - 0.06);
  s.quadraticCurveTo(-0.04, L, 0.02, L);
  s.lineTo(W - 0.07, L + 0.02);
  s.lineTo(W, L - 0.06); // clipped corner
  const notches = 9;
  let y = L - 0.06;
  for (let i = 0; i < notches; i++) {
    const seg = (L - 0.22) / notches;
    const ny = y - seg * range(rng, 0.35, 0.65);
    const depth = i % 3 === 1 ? range(rng, 0.035, 0.06) : range(rng, 0.008, 0.02);
    s.lineTo(W - depth, ny);
    s.lineTo(W - 0.002 * i, ny - 0.012);
    y -= seg;
    s.lineTo(W - 0.002 * (i + 1), y);
  }
  s.quadraticCurveTo(W - 0.02, 0.13, W * 0.45, 0.1);
  s.lineTo(0.05, 0.1);
  s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0.035, L - 0.08, 0.03, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: 1, curveSegments: 8 });
  // UVs span the blade's outline so the texture's edge side follows the edge.
  blade.computeBoundingBox();
  const bb = blade.boundingBox!;
  const p = blade.getAttribute('position') as THREE.BufferAttribute;
  const uv = blade.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), 1 - (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
  blade.translate(0, 0, -0.01).rotateY(-Math.PI / 2);
  return { blade, length: L };
}

/** A big fist: palm, a row of curled fingers and a thumb across them. */
function fist(parent: THREE.Object3D, skin: THREE.Material, side: number, open = false) {
  mesh(new THREE.SphereGeometry(0.06, 16, 12).scale(0.85, 1.15, 1.05), skin, parent, 0, -0.055, 0.005);
  for (let f = 0; f < 4; f++) {
    const fz = (f - 1.5) * 0.026;
    if (open) {
      const fg = mesh(new THREE.CapsuleGeometry(0.014, 0.06, 3, 8), skin, parent, 0.01, -0.13, fz);
      fg.rotation.x = (f - 1.5) * 0.12;
      fg.rotation.z = side * 0.35;
    } else {
      mesh(new THREE.CapsuleGeometry(0.0145, 0.05, 3, 8).rotateZ(Math.PI / 2), skin, parent, 0, -0.112 + Math.abs(f - 1.5) * 0.005, fz);
    }
  }
  const thumb = mesh(new THREE.CapsuleGeometry(0.014, 0.04, 3, 8), skin, parent, -side * 0.03, -0.08, 0.045);
  thumb.rotation.set(0.5, 0, side * 0.6);
}

export function buildButcher(m: MonsterMaterials, rng: Rng, scale = 1): MonsterBody {
  const c = new Character({ scale: 1.4 * scale, hunch: 0.42, stride: 1.75 });
  const skin = (m.tannedSkin as THREE.MeshStandardMaterial).clone();
  skin.color.setRGB(0.6, 0.44, 0.36);
  const leather = (m.leather as THREE.MeshStandardMaterial).clone();
  leather.color.setHex(0x2e1f15);
  leather.side = THREE.DoubleSide;
  const darkLeather = new THREE.MeshStandardMaterial({ color: 0x160f0b, roughness: 0.7, side: THREE.DoubleSide });
  const hoodMat = new THREE.MeshStandardMaterial({ color: 0x231812, roughness: 0.5, metalness: 0.05, vertexColors: true });
  const iron = (m.iron as THREE.MeshStandardMaterial).clone();
  iron.color.setRGB(0.3, 0.26, 0.23); // blackened, not bright
  const blood = new THREE.MeshStandardMaterial({ color: 0x3a0404, roughness: 0.18, metalness: 0.1 });
  const ragMat = (m.rag as THREE.MeshStandardMaterial).clone();
  ragMat.color.setRGB(0.42, 0.33, 0.26);
  const apronMat = new THREE.MeshStandardMaterial({ map: getApronTexture(), roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
  const bladeMat = new THREE.MeshStandardMaterial({ map: getBladeTexture(), roughness: 0.42, metalness: 0.75 });

  // --- Torso ------------------------------------------------------------
  // A barrel chest in a leather jerkin, broad as a door at the shoulders.
  const chestGeo = sculptLathe(
    [[0.22, -0.18], [0.27, -0.05], [0.31, 0.08], [0.33, 0.18], [0.3, 0.28], [0.2, 0.36], [0.1, 0.41], [0.0, 0.43]],
    (_x, y, _z, t) => {
      let d = 0;
      for (const s of [-1, 1]) {
        d += 0.04 * bumpA(t, y, s * 0.55, 0.17, 0.5, 0.09); // pecs under the leather
        d += 0.05 * bumpA(t, y, s * 1.0, 0.33, 0.6, 0.06); // traps
        d += 0.04 * bumpA(t, y, s * 2.5, 0.18, 0.5, 0.1); // shoulder blades
      }
      d += 0.05 * bumpA(t, y, Math.PI, 0.3, 0.7, 0.1); // the hump of the back
      return d;
    },
    { sx: 1.25, sz: 0.92, seg: 48, perSpan: 5 },
  );
  mesh(chestGeo, leather, c.chest);

  // Gut on the spine joint: a hard, sagging barrel under the jerkin.
  const gutGeo = sculptLathe(
    [[0.25, -0.2], [0.29, -0.1], [0.31, 0.02], [0.3, 0.12], [0.25, 0.22]],
    (_x, y, _z, t) => 0.11 * bumpA(t, y, 0, -0.02, 0.95, 0.13) + 0.03 * bumpA(t, y, Math.PI * 0.5, -0.05, 0.4, 0.1) + 0.03 * bumpA(t, y, -Math.PI * 0.5, -0.05, 0.4, 0.1),
    { sx: 1.18, sz: 0.95, seg: 40, perSpan: 5 },
  );
  mesh(gutGeo, darkLeather, c.spine);

  // Riveted iron lames over the chest, each overlapping the one below it.
  const lames: [number, number, number, number][] = [
    [0.26, 0.37, 1.05, 0.03],
    [0.15, 0.27, 1.2, 0.022],
    [0.04, 0.16, 1.25, 0.014],
  ];
  const rivet = new THREE.SphereGeometry(0.011, 6, 4);
  for (const [y0, y1, half, lift] of lames) {
    mesh(surfacePatch(chestGeo, y0, y1, -half, half, lift, 14, 3), iron, c.chest);
    // Rolled lower edge and a row of rivets above it.
    const rim: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) rim.push(surfacePoint(chestGeo, y0, -half + (i / 14) * half * 2, lift + 0.004));
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim), 28, 0.008, 5), iron, c.chest);
    for (let i = 0; i < 7; i++) {
      const p = surfacePoint(chestGeo, y0 + 0.022, -half * 0.9 + (i / 6) * half * 1.8, lift + 0.006);
      mesh(rivet, m.steel, c.chest, p.x, p.y, p.z);
    }
    // Buckled side straps holding each lame.
    for (const s of [-1, 1]) {
      const p = surfacePoint(chestGeo, (y0 + y1) / 2, s * (half + 0.12), 0.006);
      const st = mesh(new THREE.BoxGeometry(0.1, 0.035, 0.012), darkLeather, c.chest, p.x, p.y, p.z);
      st.rotation.y = s * (half + 0.12);
    }
  }
  // Gorget: a ring of iron round the base of the neck.
  mesh(band(0.15, 0.05, 0.02, 24).scale(1.15, 1, 1), iron, c.chest, 0, 0.385, 0.01);
  // A strap round the jerkin under the lames, and its buckle.
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 40; i++) pts.push(surfacePoint(chestGeo, -0.02, -Math.PI + (i / 40) * Math.PI * 2, 0.004));
    mesh(strapLoop(pts, (p) => new THREE.Vector3(p.x, 0, p.z), 0.05, 0.012), darkLeather, c.chest);
    const b = surfacePoint(chestGeo, -0.02, 0.35, 0.02);
    mesh(band(0.022, 0.012, 0.008, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 1.4, 1), iron, c.chest, b.x, b.y, b.z).rotation.y = 0.35;
  }

  // --- Apron ------------------------------------------------------------
  // The bib lies on the gut; the skirt hangs from the belt on its own joint so
  // it stays plumb under the stoop and is kicked forward by each stride.
    {
    const bib = surfacePatch(gutGeo, -0.13, 0.2, -0.72, 0.72, 0.012, 10, 5);
    const uv = bib.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 0.74 + 0.26 * uv.getY(i)); // the top of the hide, above the skirt
    mesh(bib, apronMat, c.spine);
  }
  for (const s of [-1, 1]) {
    // Neck straps running up under the lames.
    const a = surfacePoint(gutGeo, 0.19, s * 0.7, 0.014);
    const st = mesh(new THREE.BoxGeometry(0.04, 0.12, 0.008), darkLeather, c.spine, a.x, a.y + 0.05, a.z);
    st.rotation.set(-0.3, s * 0.6, 0);
  }
  const apronJ = joint(c.hips, 0, 0.04, 0.27);
  {
    const W = 0.56;
    const H = 0.92;
    const g = new THREE.PlaneGeometry(W, H, 8, 12).translate(0, -H / 2, 0);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const yv = p.getY(i);
      const t = -yv / H;
      // Wraps round the hips at the top, falls flatter and wider below, with a
      // ragged, cut hem and a slight fold down the middle.
      const xx = x * (1 + 0.18 * t);
      const hem = t > 0.99 ? 0.03 * Math.sin(x * 37) + 0.02 * Math.sin(x * 91) : 0;
      p.setXYZ(i, xx, yv + hem, -(x * x) * (1.4 - 0.9 * t) + 0.012 * Math.cos(x * 18) * t + 0.04 * t);
      uv.setXY(i, uv.getX(i), 0.72 * uv.getY(i));
    }
    g.computeVertexNormals();
    mesh(g, apronMat, apronJ);
  }

  // --- Hood ---------------------------------------------------------------
  // A tall cone of greased hide, its point bent back, the mantle spread over
  // the shoulders; inside the slot, darkness and two red sparks.
  c.head.position.set(0, 0.4, 0.13);
  const hoodGeo = sculptLathe(
    [[0.185, -0.2], [0.158, -0.13], [0.142, -0.04], [0.14, 0.06], [0.124, 0.16], [0.094, 0.26], [0.058, 0.36], [0.022, 0.45], [0.001, 0.5]],
    (_x, y, _z, t) =>
      0.012 * Math.sin(t * 5 + y * 20) * smooth(0.1, 0.4, y) +
      // The face slot: a deep oval pressed into the front, with a thick lip.
      0.03 * bumpA(t, y, 0, 0.0, 0.85, 0.12) -
      0.1 * bumpA(t, y, 0, 0.0, 0.5, 0.075),
    { sx: 1.0, sz: 1.08, seg: 36, perSpan: 5 },
  );
  {
    const p = hoodGeo.getAttribute('position') as THREE.BufferAttribute;
    // The slot goes dark toward its floor (vertex colours), so the hollow
    // reads as shadow with no hard-edged plug inside it.
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const deep = bumpA(Math.atan2(p.getX(i), p.getZ(i) / 1.08), p.getY(i), 0, 0.0, 0.5, 0.075);
      const k = 1 - 0.97 * smooth(0.2, 0.75, deep);
      col.set([k, k, k], i * 3);
    }
    hoodGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const bend = smooth(0.08, 0.5, y);
      p.setZ(i, p.getZ(i) - bend * bend * 0.16);
      p.setY(i, y - bend * bend * 0.03);
    }
    hoodGeo.computeVertexNormals();
  }
  mesh(hoodGeo, hoodMat, c.head, 0, 0.04, -0.01);
  // Stitched seam over the crown.
  {
    const seam: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const y = -0.04 + i * 0.045;
      const p = surfacePoint(hoodGeo, y, Math.PI, 0.003);
      seam.push(p);
    }
    mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seam), 20, 0.006, 4), darkLeather, c.head, 0, 0.04, -0.01);
  }
  // Darkness fills the slot: a black core inside the hood shows only where
  // the slot is pressed in past it. Two red sparks sit deep within.
  const eyeMat = (m.eyeRed as THREE.MeshBasicMaterial).clone();
  for (const s of [-1, 1]) {
    const e = surfacePoint(hoodGeo, 0.012, s * 0.24, 0.003);
    mesh(new THREE.SphereGeometry(0.012, 8, 6).scale(1.5, 0.7, 0.6), eyeMat, c.head, e.x, e.y + 0.04, e.z - 0.01);
  }
  // Mantle: a short cape of the same hide over the shoulders, slit at the hem.
  {
    const g = lathe([[0.13, 0.05], [0.2, 0.02], [0.29, -0.05], [0.35, -0.14]], 32).scale(1.18, 1, 0.95);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < -0.14) {
        const a = Math.atan2(p.getX(i), p.getZ(i));
        p.setY(i, y + 0.04 * Math.abs(Math.sin(a * 5)));
      }
    }
    g.computeVertexNormals();
    mesh(g, hoodMat, c.chest, 0, 0.4, -0.03);
  }

  // --- Arms -------------------------------------------------------------
  for (const side of [-1, 1]) {
    const a = c.arm(side);
    a.shoulder.position.set(side * 0.37, 0.22, -0.01);
    a.fore.position.y = -0.31;
    a.hand.position.y = -0.33;
    // Upper arm: bare, slab-muscled; a leather band above the elbow.
    const upper = sculptLathe(
      [[0.11, 0.04], [0.115, -0.06], [0.108, -0.17], [0.092, -0.26], [0.078, -0.33], [0.05, -0.37], [0.001, -0.38]],
      (_x, y, _z, t) => 0.04 * bumpA(t, y, 0, -0.15, 0.6, 0.07) + 0.035 * bumpA(t, y, Math.PI, -0.1, 0.7, 0.09),
      { seg: 24, perSpan: 4 },
    );
    mesh(upper, skin, a.upper);
    {
      let r = 0;
      for (let k = 0; k < 12; k++) {
        const p = surfacePoint(upper, -0.23, (k / 12) * Math.PI * 2);
        r = Math.max(r, Math.hypot(p.x, p.z));
      }
      mesh(band(r, 0.05, 0.012, 20), darkLeather, a.upper, 0, -0.23, 0);
    }
    // Forearm: thick as a thigh, bound in filthy wraps from wrist to mid-arm.
    const fore = sculptLathe(
      [[0.001, 0.08], [0.06, 0.065], [0.092, 0.02], [0.102, -0.06], [0.094, -0.15], [0.072, -0.27], [0.06, -0.34]],
      (_x, y, _z, t) => 0.024 * bumpA(t, y, side * 0.9, -0.05, 0.5, 0.07) + 0.018 * bumpA(t, y, -side * 0.8, -0.08, 0.6, 0.08),
      { seg: 24, perSpan: 4 },
    );
    mesh(fore, skin, a.fore);
    for (let i = 0; i < 5; i++) {
      const y = -0.15 - i * 0.04;
      const r = surfacePoint(fore, y, 0).z + 0.004;
      mesh(wrap(r + (i % 2) * 0.003, 0.046, (i % 2 ? 1 : -1) * 0.01, rng), i === 1 || i === 3 ? blood : ragMat, a.fore, 0, y, 0);
    }
    const fistJ = joint(a.hand, 0, 0, 0);
    fistJ.scale.setScalar(1.22);
    fist(fistJ, skin, side, false);
    mesh(wrap(0.058, 0.04, 0.006, rng), ragMat, a.hand, 0, -0.03, 0.004);
    a.upper.rotation.z = side * 0.26;
    a.restUpper = -0.22;
    a.restFore = side > 0 ? -0.45 : -0.45;
    a.swing = side > 0 ? 0.18 : 0.32;

    // Pauldron: a riveted iron dome over three lames and a leather undercap.
    mesh(new THREE.SphereGeometry(0.155, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.05, 0.8, 1.05), darkLeather, a.shoulder, side * 0.01, 0.0, 0);
    const capR = 0.172;
    const cap = mesh(new THREE.SphereGeometry(capR, 24, 9, 0, Math.PI * 2, 0, Math.PI * 0.4).scale(1.05, 0.72, 1.12), iron, a.shoulder, side * 0.025, 0.04, 0);
    cap.rotation.z = -side * 0.32;
    const rimR = Math.sin(Math.PI * 0.4) * capR;
    const rimY = Math.cos(Math.PI * 0.4) * capR * 0.72;
    mesh(new THREE.TorusGeometry(rimR, 0.013, 5, 30).rotateX(Math.PI / 2).scale(1.05, 1, 1.12), iron, cap, 0, rimY, 0);
    for (let k = 0; k < 9; k++) {
      const ang = (k / 9) * Math.PI * 2;
      mesh(rivet, m.steel, cap, Math.cos(ang) * rimR * 0.93, rimY + 0.013, Math.sin(ang) * rimR * 1.04);
    }
    // A raised comb along the top of the dome.
    mesh(new THREE.TorusGeometry(capR * 0.98, 0.014, 5, 16, Math.PI * 0.8).rotateZ(Math.PI * 0.1).scale(1.05, 0.72, 1.12).rotateY(Math.PI / 2), iron, cap);
    const phiC = side > 0 ? Math.PI : 0;
    for (let i = 0; i < 3; i++) {
      const r = 0.172 + i * 0.012;
      const th0 = Math.PI * (0.36 + i * 0.075);
      const lame = mesh(new THREE.SphereGeometry(r, 20, 3, phiC - Math.PI * 0.55, Math.PI * 1.1, th0, Math.PI * 0.13).scale(1, 0.95, 1.1), iron, a.shoulder, side * 0.012, -i * 0.032, 0);
      lame.rotation.z = -side * 0.36;
      for (let k = -1; k <= 1; k++) {
        const phi = phiC + k * 0.38 * Math.PI;
        const th = th0 + Math.PI * 0.04;
        mesh(rivet, m.steel, lame, -Math.cos(phi) * Math.sin(th) * r * 1.02, Math.cos(th) * r * 0.95 * 1.02, Math.sin(phi) * Math.sin(th) * r * 1.1 * 1.02);
      }
    }
  }

  // The cleaver, gripped in the right fist.
  const grip = joint(c.arm(1).hand, 0, -0.085, 0.01);
  grip.rotation.set(2.55, 0, 0);
  const cl = cleaverParts(rng);
  mesh(cl.blade, bladeMat, grip, 0, 0.06, 0);
  mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.36, 10).translate(0, -0.05, 0), m.wood, grip);
  for (let i = 0; i < 6; i++) mesh(new THREE.TorusGeometry(0.034, 0.007, 4, 12).rotateX(Math.PI / 2).rotateZ(0.25), darkLeather, grip, 0, -0.17 + i * 0.045, 0);
  mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.04, 10), iron, grip, 0, 0.14, 0);
  mesh(new THREE.SphereGeometry(0.045, 10, 8).scale(1, 0.7, 1), iron, grip, 0, -0.24, 0);
  // Gore clotted at the heel of the blade, and a rag knotted round the haft.
  mesh(new THREE.SphereGeometry(0.03, 7, 5).scale(1, 1.6, 0.6), blood, grip, 0, 0.2, 0.25);
  mesh(new THREE.BoxGeometry(0.012, 0.16, 0.05), ragMat, grip, 0.035, -0.12, -0.02).rotation.z = 0.2;

  // --- Legs, belt, chains and hooks ---------------------------------------
  for (const side of [-1, 1]) {
    const l = c.leg(side);
    l.thigh.position.x = side * 0.16;
    // Thick leather breeches.
    const thigh = sculptLathe(
      [[0.15, 0.05], [0.155, -0.08], [0.135, -0.26], [0.11, -0.4], [0.098, -0.47], [0.05, -0.52], [0.001, -0.53]],
      (_x, y, _z, t) => 0.025 * bumpA(t, y, side * 0.3, -0.2, 0.6, 0.12) + 0.004 * Math.sin(t * 9 + y * 25),
      { seg: 24, perSpan: 4 },
    );
    mesh(thigh, darkLeather, l.thigh);
    const shin = sculptLathe(
      [[0.001, 0.05], [0.06, 0.04], [0.09, 0.0], [0.1, -0.1], [0.085, -0.3], [0.075, -0.44]],
      (_x, y, _z, t) => 0.03 * bumpA(t, y, Math.PI, -0.12, 0.7, 0.08),
      { seg: 22, perSpan: 4 },
    );
    mesh(shin, darkLeather, l.shin);
    // Iron knee cop.
    mesh(new THREE.SphereGeometry(0.085, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(Math.PI / 2).scale(1, 1.1, 0.7), iron, l.shin, 0, 0.0, 0.05);
    mesh(new THREE.SphereGeometry(0.012, 6, 4), m.steel, l.shin, 0, 0.0, 0.112);
    // Heavy boots: tall shafts with a folded cuff, two strap buckles, iron toes.
    const boot = sculptLathe([[0.118, -0.12], [0.12, -0.17], [0.1, -0.32], [0.092, -0.47]], (_x, y, _z, t) => 0.02 * bumpA(t, y, Math.PI, -0.2, 0.7, 0.07) + 0.003 * Math.sin(y * 90 + t * 3), { seg: 24, perSpan: 4 });
    mesh(boot, leather, l.shin);
    mesh(new THREE.TorusGeometry(0.12, 0.018, 5, 22).rotateX(Math.PI / 2), leather, l.shin, 0, -0.12, 0);
    for (const y of [-0.22, -0.36]) {
      const r = surfacePoint(boot, y, 0).z;
      mesh(band(r, 0.024, 0.008, 22), darkLeather, l.shin, 0, y, 0);
      mesh(new THREE.BoxGeometry(0.03, 0.03, 0.012), iron, l.shin, side * r * 0.7, y, r * 0.7).rotation.y = side * 0.78;
    }
    mesh(new THREE.CapsuleGeometry(0.068, 0.17, 4, 12).rotateX(Math.PI / 2).scale(1.12, 0.85, 1), leather, l.foot, 0, -0.035, 0.065);
    mesh(new THREE.SphereGeometry(0.07, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(Math.PI / 2).scale(1.1, 0.75, 0.9), iron, l.foot, 0, -0.04, 0.15);
    mesh(new THREE.BoxGeometry(0.15, 0.025, 0.3), darkLeather, l.foot, 0, -0.085, 0.06);
  }
  // Hips and a broad, studded belt with an iron buckle the size of a hand.
  mesh(lathe([[0.25, 0.12], [0.27, 0.0], [0.27, -0.1], [0.23, -0.17]], 24).scale(1.14, 1, 0.92), darkLeather, c.hips);
  const beltGeo = sculptLathe([[0.29, 0.13], [0.3, 0.1], [0.3, -0.0], [0.29, -0.03]], (_x, y, _z, t) => 0.003 * Math.sin(t * 7 + y * 30), { sx: 1.12, sz: 0.95, seg: 32, perSpan: 3 });
  mesh(beltGeo, leather, c.hips);
  const bf = surfacePoint(beltGeo, 0.05, 0, 0);
  mesh(band(0.05, 0.016, 0.014, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 1.25, 1), iron, c.hips, 0, 0.05, bf.z + 0.01);
  mesh(new THREE.BoxGeometry(0.01, 0.075, 0.014), iron, c.hips, 0, 0.05, bf.z + 0.016);
  for (let k = 0; k < 12; k++) {
    const t = ((k + 0.5) / 12) * Math.PI * 2;
    if (Math.abs(Math.sin(t / 2)) < 0.2) continue;
    const p = surfacePoint(beltGeo, 0.05, t, 0.003);
    mesh(new THREE.SphereGeometry(0.011, 6, 4), m.steel, c.hips, p.x, p.y, p.z);
  }
  // A swag of chain slung from hip to hip across the back of the belt.
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = Math.PI * 0.55 + (i / 8) * Math.PI * 0.9;
      const sag = Math.sin((i / 8) * Math.PI) * 0.13;
      const p = surfacePoint(beltGeo, 0.02 - sag, t, 0.03 + sag * 0.15);
      pts.push(p);
    }
    chain(c.hips, pts, iron, 0.017);
  }
  // Hanging chains and hooks on swinging joints round the belt.
  const danglers: { j: THREE.Object3D; side: number; phase: number; len: number }[] = [];
  const hang = (t: number, len: number, hook: boolean) => {
    const p = surfacePoint(beltGeo, 0.0, t, 0.025);
    const j = joint(c.hips, p.x, p.y, p.z);
    j.rotation.y = t;
    mesh(new THREE.TorusGeometry(0.022, 0.007, 4, 10), iron, j, 0, 0.012, 0); // ring on the belt
    chain(j, [new THREE.Vector3(0, -0.01, 0), new THREE.Vector3(0, -len / 2, 0.003), new THREE.Vector3(0, -len, 0)], iron, 0.015);
    if (hook) {
      const hj = joint(j, 0, -len - 0.02, 0);
      hj.rotation.y = Math.PI / 2;
      meatHook(hj, iron, blood, 1.25);
    } else {
      mesh(new THREE.TorusGeometry(0.04, 0.009, 4, 14), iron, j, 0, -len - 0.04, 0); // a shackle
    }
    danglers.push({ j, side: Math.sign(Math.sin(t)) || 1, phase: range(rng, 0, 6), len });
  };
  hang(1.25, 0.2, true);
  hang(1.75, 0.3, false);
  hang(-1.3, 0.24, true);
  hang(-1.9, 0.16, true);
  hang(2.6, 0.22, false);
  // Butcher's tools tucked at the back: a skinning knife in a sheath.
  {
    const p = surfacePoint(beltGeo, 0.0, Math.PI * 0.85, 0.02);
    const j = joint(c.hips, p.x, p.y, p.z);
    j.rotation.set(0.15, Math.PI * 0.85, 0.2);
    mesh(new THREE.BoxGeometry(0.06, 0.22, 0.025).translate(0, -0.11, 0), darkLeather, j);
    mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.1, 6).translate(0, 0.05, 0), m.wood, j);
  }

  bakeRig(c.root);

  // --- Motion -----------------------------------------------------------
  // A heavy, rolling gait: the body lurches over each planted foot and the
  // shoulders roll against it; the apron is kicked by the knees, the hooks
  // swing. Idle: slow, deep breaths heaving the shoulders.
  let dead = false;
  const baseHeadZ = c.head.position.z;
  c.hooks.push((dt, w, time) => {
    if (dead) return;
    const tl = c.leg(-1).thigh.rotation.x;
    const tr = c.leg(1).thigh.rotation.x;
    const sway = w > 0.01 ? -tl / (0.55 * w) : 0; // sin(gait phase)
    c.body.rotation.z = sway * 0.07 * w;
    c.chest.rotation.z = -sway * 0.1 * w;
    c.chest.rotation.y = sway * 0.08 * w;
    c.hips.position.y -= Math.abs(sway) * 0.03 * w;
    const heave = Math.sin(time * 1.3);
    c.chest.position.y = 0.2 + heave * 0.008 * (1 - w);
    for (const a of c.arms) a.shoulder.position.y = 0.22 + heave * 0.01 * (1 - w);
    c.head.position.z = baseHeadZ + Math.sin(time * 1.3 - 0.6) * 0.008;
    // Apron: pushed out by whichever knee leads, settling back with lag.
    const kick = Math.max(0, -tl, -tr) * 0.75 + 0.04;
    apronJ.rotation.x += (-kick - apronJ.rotation.x) * (1 - Math.exp(-dt * 9));
    apronJ.rotation.z = sway * 0.04 * w;
    for (const d of danglers) {
      const swing = Math.sin(time * 2.2 + d.phase) * 0.06 + (d.side > 0 ? tr : tl) * 0.35;
      d.j.rotation.x += (swing - d.j.rotation.x) * (1 - Math.exp(-dt * 6));
      d.j.rotation.z = Math.sin(time * 1.7 + d.phase) * 0.05;
    }
  });

  const L = c.arm(-1);
  const R = c.arm(1);
  return {
    rig: c,
    attack(onHit) {
      // Hoists the cleaver two-handed high over the hood, holds it a beat,
      // then drives it down into the floor in front of him and wrenches it out.
      keyedAction(
        c,
        1.8,
        [
          { k: 0, uL: -0.22, uR: -0.22, fL: -0.45, fR: -0.75, zL: -0.26, zR: 0.26, s: 0 },
          { k: 0.36, uL: -2.75, uR: -2.95, fL: -0.9, fR: -0.55, zL: 0.32, zR: -0.12, s: -0.3 },
          { k: 0.54, uL: -2.95, uR: -3.1, fL: -0.95, fR: -0.6, zL: 0.36, zR: -0.14, s: -0.42 },
          { k: 0.62, uL: -1.62, uR: -1.55, fL: -0.4, fR: -0.2, zL: 0.4, zR: -0.22, s: 0.55 },
          { k: 0.8, uL: -1.55, uR: -1.5, fL: -0.4, fR: -0.2, zL: 0.4, zR: -0.22, s: 0.52 },
          { k: 1, uL: -0.22, uR: -0.22, fL: -0.45, fR: -0.75, zL: -0.26, zR: 0.26, s: 0 },
        ],
        0.62,
        onHit,
        (k, w) => {
          // Rises on the wind-up, then the knees give under the blow.
          const up = smooth(0.1, 0.5, k) * (1 - smooth(0.55, 0.62, k));
          const slam = smooth(0.56, 0.63, k) * (1 - smooth(0.82, 1, k));
          c.hips.position.y += (0.03 * up - 0.17 * slam) * w;
          c.spine.rotation.y += 0.15 * up * w;
          for (const l of c.legs) {
            l.thigh.rotation.x += (-0.55 * slam - (l.side < 0 ? 0.25 : 0) * slam) * w;
            l.shin.rotation.x += 0.7 * slam * w;
            l.foot.rotation.x -= 0.15 * slam * w;
          }
          c.head.rotation.x += (0.25 * up - 0.3 * slam) * w;
          grip.rotation.x = 2.55 - 0.5 * up * w + 0.1 * slam * w;
        },
      );
    },
    flinch: () => flinch(c, 0.12),
    die() {
      // Drops to his knees, sways, then topples forward onto his face.
      dead = true;
      const twist = range(rng, -0.25, 0.25);
      const pose = (k: number) => {
        const kneel = smooth(0, 0.3, k);
        const fall = smooth(0.42, 1, k);
        const f = fall * fall;
        c.hips.position.y = c.hipHeight - 0.42 * kneel + 0.06 * f;
        c.body.rotation.x = 1.42 * f;
        c.body.rotation.z = twist * f;
        c.body.position.z = 0.05 * f;
        c.body.position.y = 0.02 * f;
        for (const l of c.legs) {
          l.thigh.rotation.x = -0.1 * kneel * (1 - f) + (l.side < 0 ? -0.2 : 0.05) * f;
          l.thigh.rotation.z = l.side * (0.05 + 0.1 * kneel);
          l.shin.rotation.x = 1.55 * kneel * (1 - f) + 0.25 * f;
          l.foot.rotation.x = 0.6 * kneel;
        }
        const slump = smooth(0.25, 0.45, k) * (1 - fall);
        c.spine.rotation.x = 0.25 + 0.25 * slump - 0.15 * f;
        c.chest.rotation.x = 0.17;
        c.chest.rotation.z = 0;
        c.head.rotation.x = 0.35 * slump - 0.55 * f;
        c.head.rotation.y = twist * 1.5 * f;
        L.upper.rotation.x = -0.1 * kneel * (1 - f) - 0.6 * f;
        L.upper.rotation.z = -0.3 - 0.6 * f;
        L.fore.rotation.x = -0.2 - 0.3 * f;
        R.upper.rotation.x = -0.15 * kneel * (1 - f) - 1.2 * f;
        R.upper.rotation.z = 0.3 + 0.55 * f;
        R.fore.rotation.x = -0.4 * (1 - f) - 0.1 * f;
        apronJ.rotation.x = -0.1 - 0.5 * kneel * (1 - f) - 0.1 * f;
        grip.rotation.x = 2.55 + 0.4 * f;
      };
      c.play(1.6, pose, () => c.hooks.push(() => pose(1)));
    },
  };
}
