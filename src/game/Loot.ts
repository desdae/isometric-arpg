import * as THREE from 'three';
import type { NavGrid } from '../world/NavGrid';
import type { HeightFn } from '../procgen/terrain';
import { lathe } from '../actors/Character';
import { QUEST_COLOR, RARITY_COLOR, type Item } from './Items';

// Items lying on the ground: a small model that arcs out of the corpse and
// bounces, a light beam for rare finds, and a clickable name label in the
// rarity colour. Gold and potions are scooped up just by walking over them.

const mats = {
  gold: new THREE.MeshStandardMaterial({ color: 0xc89a3a, metalness: 1, roughness: 0.35 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8a8580, metalness: 1, roughness: 0.4 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x3a3430, metalness: 0.8, roughness: 0.5 }),
  leather: new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.8 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x302020, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.6 }),
  potion: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: new THREE.Color(1.4, 0.05, 0.03), roughness: 0.2 }),
  cork: new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 }),
  moss: new THREE.MeshStandardMaterial({ color: 0x2a3a1a, emissive: new THREE.Color(0.05, 0.12, 0.03), roughness: 1 }),
  ichor: new THREE.MeshStandardMaterial({ color: 0x3a0a20, emissive: new THREE.Color(0.35, 0.02, 0.12), roughness: 0.25 }),
  scarf: new THREE.MeshStandardMaterial({ color: 0x8a1410, roughness: 0.9 }),
};

function itemModel(item: Item): THREE.Object3D {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  switch (item.slot) {
    case 'gold': {
      const n = Math.min(14, 3 + Math.floor(item.amount / 6));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28;
        const r = Math.random() * 0.14;
        add(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 12), mats.gold, Math.cos(a) * r, 0.006 + Math.floor(i / 5) * 0.009, Math.sin(a) * r, Math.random() * 0.3, 0, Math.random() * 0.3);
      }
      break;
    }
    case 'potion':
      add(lathe([[0, 0], [0.06, 0.01], [0.075, 0.07], [0.06, 0.13], [0.025, 0.16], [0.025, 0.2], [0, 0.2]], 12), mats.glass, 0, 0, 0, 0, 0, Math.PI / 2 - 0.1).position.y = 0.075;
      add(lathe([[0, 0], [0.055, 0.01], [0.068, 0.07], [0.05, 0.12], [0, 0.12]], 10), mats.potion, 0, 0.075, 0, 0, 0, Math.PI / 2 - 0.1);
      break;
    case 'quest':
      if (item.base === 'Grave Moss') {
        for (let i = 0; i < 5; i++) add(new THREE.SphereGeometry(0.05 + Math.random() * 0.03, 7, 5).scale(1, 0.5, 1), mats.moss, (Math.random() - 0.5) * 0.14, 0.02, (Math.random() - 0.5) * 0.14);
      } else if (item.base === 'Ichor Sac') {
        add(new THREE.SphereGeometry(0.08, 12, 8).scale(1, 0.75, 1.2), mats.ichor, 0, 0.06, 0);
      } else {
        add(new THREE.BoxGeometry(0.36, 0.02, 0.1), mats.scarf, 0, 0.012, 0, 0, 0.3, 0);
        add(new THREE.BoxGeometry(0.1, 0.022, 0.24), mats.scarf, 0.14, 0.014, 0.1, 0, -0.4, 0);
      }
      break;
    case 'weapon':
      add(new THREE.BoxGeometry(0.7, 0.012, 0.06), mats.steel, 0.2, 0.03, 0);
      add(new THREE.BoxGeometry(0.03, 0.03, 0.24), mats.dark, -0.16, 0.03, 0);
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 6).rotateZ(Math.PI / 2), mats.leather, -0.26, 0.03, 0);
      break;
    case 'armor':
      add(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1.3), mats.steel, 0, 0.02, 0, 0, 0, 0);
      add(new THREE.BoxGeometry(0.42, 0.04, 0.12), mats.leather, 0, 0.03, -0.2);
      break;
    case 'helm':
      add(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), mats.steel, 0, 0.0, 0, 0.4, 0, 0.3);
      break;
    case 'gloves':
    case 'boots':
      add(new THREE.BoxGeometry(0.1, 0.07, 0.22), mats.leather, -0.07, 0.035, 0, 0, 0.3, 0);
      add(new THREE.BoxGeometry(0.1, 0.07, 0.22), mats.leather, 0.08, 0.035, 0.02, 0, -0.2, 0);
      break;
    default:
      add(new THREE.TorusGeometry(0.05, 0.013, 6, 16).rotateX(Math.PI / 2), mats.gold, 0, 0.015, 0);
      if (item.slot === 'amulet') add(new THREE.OctahedronGeometry(0.03), mats.potion, 0.07, 0.03, 0);
  }
  return g;
}

export interface GroundItem {
  item: Item;
  obj: THREE.Object3D;
  label: HTMLButtonElement;
  pos: THREE.Vector3;
  age: number;
  from: THREE.Vector3;
  /** Drop sound already played. */
  announced?: boolean;
}

export class LootLayer {
  readonly group = new THREE.Group();
  readonly items: GroundItem[] = [];
  private layer: HTMLDivElement;
  private v = new THREE.Vector3();
  visible = true;

  constructor(
    private height: HeightFn,
    private onClick: (g: GroundItem) => void,
    /** Where things may come to rest: walkable ground the hero can reach. */
    private nav?: NavGrid,
  ) {
    this.layer = document.createElement('div');
    this.layer.className = 'loot-layer';
    document.body.appendChild(this.layer);
    if (!document.getElementById('loot-style')) {
      const style = document.createElement('style');
      style.id = 'loot-style';
      style.textContent = `
        .loot-layer { position: fixed; inset: 0; pointer-events: none; z-index: 3; overflow: hidden; }
        .loot-label { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: pointer; white-space: nowrap;
          font: 500 13px/1 'EB Garamond', Georgia, serif; padding: 3px 7px 4px; border: 1px solid rgba(255,255,255,.08);
          background: rgba(8,4,4,.78); letter-spacing: .02em; text-shadow: 0 1px 1px #000; }
        .loot-label:hover, .loot-label:focus-visible { background: rgba(40,16,12,.92); border-color: currentColor; outline: none; }
        .loot-label.unique, .loot-label.rare { font-weight: 600; }
      `;
      document.head.appendChild(style);
    }
  }

  /** Throws an item out of `from` to land a short way off. */
  drop(item: Item, from: THREE.Vector3) {
    // Land on open floor in plain sight of where it fell from, never inside
    // a wall or behind one, so the hero can always walk up and take it.
    let x = from.x;
    let z = from.z;
    const nav = this.nav;
    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.6 + Math.random() * 1.3) * (1 - tries / 24);
      const px = from.x + Math.cos(a) * r;
      const pz = from.z + Math.sin(a) * r;
      if (!nav || (nav.walkable(px, pz) && nav.lineOfSight(from.x, from.z, px, pz))) {
        x = px;
        z = pz;
        break;
      }
    }
    if (nav && !nav.walkable(x, z)) {
      const p = nav.nearestWalkable(x, z);
      if (p) {
        x = p.x;
        z = p.y;
      }
    }
    const pos = new THREE.Vector3(x, this.height(x, z), z);
    const obj = itemModel(item);
    obj.rotation.y = Math.random() * 6.28;
    this.group.add(obj);
    if (item.rarity === 'rare' || item.rarity === 'unique') {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.12, 5, 8, 1, true).translate(0, 2.5, 0),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(RARITY_COLOR[item.rarity]).multiplyScalar(1.6),
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      beam.userData.beam = true;
      obj.add(beam);
    }
    const label = document.createElement('button');
    label.type = 'button';
    label.className = `loot-label ${item.rarity}`;
    label.style.color = item.slot === 'quest' ? QUEST_COLOR : RARITY_COLOR[item.rarity];
    label.textContent = item.name;
    label.hidden = true;
    const g: GroundItem = { item, obj, label, pos, age: 0, from: from.clone().setY(from.y + 1) };
    label.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.button === 0) this.onClick(g);
    });
    this.layer.appendChild(label);
    this.items.push(g);
    return g;
  }

  remove(g: GroundItem) {
    const i = this.items.indexOf(g);
    if (i >= 0) this.items.splice(i, 1);
    this.group.remove(g.obj);
    g.label.remove();
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (!v) for (const g of this.items) g.label.hidden = true;
  }

  update(dt: number, camera: THREE.Camera, playerPos: THREE.Vector3) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const placed: { x: number; y: number }[] = [];
    for (const g of this.items) {
      g.age += dt;
      // Arc out of the corpse with a couple of bounces.
      const k = Math.min(1, g.age / 0.55);
      const p = g.obj.position;
      p.lerpVectors(g.from, g.pos, k);
      p.y = THREE.MathUtils.lerp(g.from.y, g.pos.y, k) + Math.sin(k * Math.PI) * 1.1;
      if (k >= 1) {
        const b = Math.max(0, g.age - 0.55);
        p.y = g.pos.y + Math.abs(Math.sin(b * 14)) * 0.12 * Math.exp(-b * 9);
      }
      g.obj.rotation.y += dt * (k < 1 ? 9 : 0);
      if (!this.visible) continue;
      // Label above the item; nudge up past labels already placed nearby.
      const far = playerPos.distanceTo(g.pos) > 28;
      this.v.copy(g.pos).setY(g.pos.y + 0.35).project(camera);
      if (far || this.v.z > 1 || k < 1) {
        g.label.hidden = true;
        continue;
      }
      let x = (this.v.x * 0.5 + 0.5) * w;
      let y = (-this.v.y * 0.5 + 0.5) * h;
      for (let n = 0; n < 6; n++) {
        const hitLabel = placed.find((q) => Math.abs(q.x - x) < 90 && Math.abs(q.y - y) < 20);
        if (!hitLabel) break;
        y = hitLabel.y - 22;
      }
      placed.push({ x, y });
      x = Math.round(x);
      y = Math.round(y);
      g.label.hidden = false;
      g.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  dispose() {
    for (const g of [...this.items]) this.remove(g);
    this.layer.remove();
  }
}
