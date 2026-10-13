import * as THREE from 'three';
import { joint, mesh } from '../Character';
import { bakeRig } from '../bake';
import { range, type Rng } from '../../procgen/noise';
import { bump, sculptLathe } from '../sculpt';
import { BasicRig, ease, hump, teethArc } from './BasicRig';
import type { MonsterBody, MonsterMaterials } from './materials';

// Root horror: a drowned tree that got up. A twisted, grooved trunk split by
// a fanged maw, a cluster of red eyes above it, a crown of bare spiked
// branches, and long root tentacles for arms that never stop curling. It
// drags itself along on a writhing mass of roots and attacks by hammering
// its arms into the ground, so that roots burst up under its victim.

interface Tentacle {
  shoulder: THREE.Object3D;
  segs: THREE.Object3D[];
  side: number;
  phase: number;
  out: number;
}

function curvedTube(pts: THREE.Vector3[], r0: number, r1: number, seg = 10): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, 6);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  // TubeGeometry has (seg + 1) rings of (6 + 1) vertices; taper each ring.
  for (let i = 0; i <= seg; i++) {
    const c = curve.getPoint(i / seg);
    const r = r0 + (r1 - r0) * (i / seg);
    for (let j = 0; j <= 6; j++) {
      const k = i * 7 + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

class RootHorror extends BasicRig {
  readonly trunk: THREE.Object3D;
  readonly crown: THREE.Object3D;
  readonly jaw: THREE.Object3D;
  readonly arms: Tentacle[] = [];
  readonly roots: THREE.Object3D[] = [];

  constructor(m: MonsterMaterials, rng: Rng, scale: number) {
    super(scale, 3, 2);
    const bark = m.swampBark;
    const twist = range(rng, 2, 4);
    this.trunk = joint(this.body, 0, 0, 0);
    // Grooved, twisting trunk with the maw hollowed into its front.
    const trunk = sculptLathe(
      [
        [0.6, 0.0],
        [0.46, 0.3],
        [0.38, 0.8],
        [0.44, 1.3],
        [0.5, 1.75],
        [0.36, 2.15],
        [0.18, 2.45],
      ],
      (_x, y, _z, th) => {
        let d = 0.05 * Math.sin(th * 7 + y * twist) + 0.025 * Math.sin(th * 17 - y * 5);
        d -= 0.22 * bump(th, y, 0, 1.3, 0.45, 0.2); // the maw
        d -= 0.06 * (bump(th, y, -0.28, 1.72, 0.12, 0.07) + bump(th, y, 0.25, 1.68, 0.12, 0.07) + bump(th, y, 0.02, 1.86, 0.1, 0.06)); // eye sockets
        return d;
      },
      { seg: 36, perSpan: 5, sx: 1.05, sz: 0.9, uvScale: 2.5 },
    );
    mesh(trunk, bark, this.trunk);
    // Inside the maw: dark, with a red glow at the back.
    mesh(new THREE.SphereGeometry(0.2, 14, 8).scale(1.4, 0.7, 0.6), m.void, this.trunk, 0, 1.3, 0.24);
    mesh(new THREE.SphereGeometry(0.08, 10, 6).scale(1.5, 0.8, 0.5), m.crystal, this.trunk, 0, 1.28, 0.2);
    for (const g of teethArc(0.3, 0.2, -1.2, 1.2, 9, 0.12, -1)) mesh(g, m.bone, this.trunk, 0, 1.44, 0.17);
    this.jaw = joint(this.trunk, 0, 1.17, 0.12);
    for (const g of teethArc(0.28, 0.2, -1.2, 1.2, 8, 0.11, 1)) mesh(g, m.bone, this.jaw, 0, 0, 0.05);
    mesh(new THREE.TorusGeometry(0.26, 0.05, 6, 16, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI).scale(1.1, 1, 0.8), bark, this.jaw, 0, -0.02, 0.06);
    // A cluster of glowing eyes.
    for (const [x, y, r] of [[-0.12, 1.72, 0.045], [0.11, 1.68, 0.04], [0.01, 1.86, 0.035], [-0.2, 1.58, 0.022], [0.19, 1.55, 0.025]]) {
      mesh(new THREE.SphereGeometry(r, 8, 6), m.eyeRed, this.trunk, x, y, 0.36 + (1.8 - y) * 0.1);
    }

    // Crown of bare, spiked branches.
    this.crown = joint(this.trunk, 0, 2.2, 0);
    const nBranch = 7 + Math.floor(rng() * 3);
    for (let i = 0; i < nBranch; i++) {
      const a = (i / nBranch) * Math.PI * 2 + range(rng, -0.3, 0.3);
      const out = range(rng, 0.4, 0.9);
      const up = range(rng, 0.5, 1.1);
      const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.sin(a) * out * 0.4, up * 0.5, Math.cos(a) * out * 0.4), new THREE.Vector3(Math.sin(a + 0.3) * out, up, Math.cos(a + 0.3) * out)];
      mesh(curvedTube(pts, 0.07, 0.008, 8), bark, this.crown);
      // A twig or two off each branch.
      const mid = pts[1];
      const b = a + range(rng, -1, 1);
      mesh(curvedTube([mid, mid.clone().add(new THREE.Vector3(Math.sin(b) * 0.3, 0.25, Math.cos(b) * 0.3))], 0.03, 0.004, 4), bark, this.crown);
    }

    // Root tentacles for arms: two big, two smaller.
    for (const [side, y, big] of [[-1, 1.8, 1], [1, 1.8, 1], [-1, 1.5, 0], [1, 1.5, 0]] as const) {
      const shoulder = joint(this.trunk, side * (big ? 0.42 : 0.4), y, big ? 0.05 : -0.05);
      const segs: THREE.Object3D[] = [];
      let parent: THREE.Object3D = shoulder;
      const n = 7;
      const len = big ? 0.24 : 0.19;
      for (let i = 0; i < n; i++) {
        const seg = joint(parent, 0, i === 0 ? 0 : -len, 0);
        const r0 = (big ? 0.085 : 0.065) * (1 - i / (n + 1.5));
        const r1 = (big ? 0.085 : 0.065) * (1 - (i + 1) / (n + 1.5));
        mesh(new THREE.CylinderGeometry(r1, r0, len * 1.08, 6).translate(0, -len / 2, 0), bark, seg);
        // Thorns.
        if (i % 2 === 1) mesh(new THREE.ConeGeometry(0.015, 0.09, 4).rotateZ(side * 1.2).translate(side * r0, -len / 2, 0), m.chitin, seg);
        segs.push(seg);
        parent = seg;
      }
      // Clawed tip of splayed rootlets.
      for (let f = 0; f < 3; f++) mesh(new THREE.ConeGeometry(0.02, 0.2, 4).rotateX(Math.PI).rotateZ((f - 1) * 0.5).translate((f - 1) * 0.04, -len - 0.08, 0), bark, parent);
      this.arms.push({ shoulder, segs, side, phase: rng() * 6, out: big ? 0.5 : 0.85 });
    }

    // Root mass it drags itself on.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + range(rng, -0.2, 0.2);
      const r = joint(this.body, Math.sin(a) * 0.3, 0.25, Math.cos(a) * 0.3);
      r.rotation.y = a;
      const reach = range(rng, 0.7, 1.15);
      mesh(curvedTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.05, reach * 0.4), new THREE.Vector3(range(rng, -0.15, 0.15), -0.25, reach * 0.8), new THREE.Vector3(0, -0.32, reach)], 0.13, 0.015, 10), bark, r);
      this.roots.push(r);
    }
    bakeRig(this.root);
  }

  protected animate() {
    const w = this.walk;
    const t = this.time;
    this.trunk.rotation.set(0.12 * w + Math.sin(t * 0.7) * 0.03, 0, Math.sin(this.phase * 0.5) * 0.06 * w + Math.sin(t * 0.5) * 0.02);
    this.trunk.position.y = Math.abs(Math.sin(this.phase * 0.5)) * 0.05 * w;
    this.crown.rotation.set(Math.sin(t * 0.9) * 0.05, 0, Math.sin(t * 0.6) * 0.06);
    this.jaw.rotation.x = 0.1 + Math.max(0, Math.sin(t * 1.3)) * 0.12;
    for (const a of this.arms) {
      a.shoulder.rotation.set(-0.25 - w * 0.2 + Math.sin(t * 0.8 + a.phase) * 0.15, 0, a.side * (a.out + Math.sin(t * 0.6 + a.phase) * 0.1));
      a.segs.forEach((s, i) => {
        if (i === 0) return;
        s.rotation.set(Math.sin(t * 1.6 + a.phase - i * 0.7) * 0.22 - 0.06, 0, a.side * Math.sin(t * 1.2 + a.phase - i * 0.5) * 0.18);
      });
    }
    this.roots.forEach((r, i) => {
      r.rotation.x = Math.sin(this.phase + i * 1.7) * 0.25 * w + Math.sin(t * 1.4 + i) * 0.05;
    });
    this.body.position.set(0, 0, 0);
  }
}

export function buildRootHorror(m: MonsterMaterials, rng: Rng, scale = range(rng, 0.95, 1.1)): MonsterBody {
  const c = new RootHorror(m, rng, scale);
  return {
    rig: c,
    attack(onHit) {
      let fired = false;
      c.play(1.15, (k) => {
        // Arms rise high over the crown, then hammer down into the earth.
        const raise = ease(k, 0, 0.45) * (1 - ease(k, 0.48, 0.58));
        const slam = ease(k, 0.48, 0.58) * (1 - ease(k, 0.75, 1));
        c.trunk.rotation.x = -raise * 0.2 + slam * 0.3;
        c.jaw.rotation.x = 0.1 + raise * 0.5;
        for (const a of c.arms) {
          a.shoulder.rotation.x = -0.25 - raise * 2.4 - slam * 1.1;
          a.shoulder.rotation.z = a.side * (a.out * (1 - raise * 0.6) + slam * 0.1);
          a.segs.forEach((s, i) => {
            if (i > 0) s.rotation.x = -raise * 0.12 + slam * 0.12;
          });
        }
        if (!fired && k >= 0.57) {
          fired = true;
          onHit();
        }
      });
    },
    flinch() {
      if (c.acting) return;
      c.play(0.35, (k) => {
        const s = Math.sin(k * Math.PI);
        c.trunk.rotation.x = -s * 0.15;
        for (const a of c.arms) a.shoulder.rotation.z = a.side * (a.out + s * 0.5);
      });
    },
    die() {
      // Topples backwards like a felled tree, arms flailing then going limp.
      c.play(1.6, (k) => {
        const f = ease(k, 0, 0.75);
        c.body.rotation.x = -Math.PI * 0.47 * f * f;
        c.body.position.y = hump(k, 0.6, 0.85) * 0.12;
        for (const a of c.arms) a.shoulder.rotation.z = a.side * (a.out + Math.sin(k * 20 + a.phase) * 0.4 * (1 - k));
      });
    },
    muzzle() {
      return c.trunk.localToWorld(new THREE.Vector3(0, 1.3, 0.4));
    },
  };
}
