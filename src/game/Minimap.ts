import { loading } from '../engine/Loading';
import type { Monster } from '../actors/Monster';
import type { Npc } from '../actors/Npc';
import type { World } from '../world/World';

// The corner minimap, the full map overlay (M or Tab) and the fog of war.
//
// Nothing here renders the 3D scene again. Each area gets a base image built
// once, when the area is generated, from its nav grid (walkable ground, walls
// and obstacles) and its heights (hill shading, standing water): one pixel per
// nav cell. The fog is a one-metre grid of how well each spot has been seen;
// it is cut out of the base image with `destination-out`, scaled up smoothly
// so its edge stays soft. Both maps redraw about ten times a second from those
// two cached images plus a handful of markers, with no per-frame allocation.
//
// Explored ground is saved with the hero, one entry per area, as a run-length
// bitmask in base64, and tagged with the area's layout key so a seeded area
// that has been dug anew starts unexplored again.

/** Metres per fog cell. */
const FOG_CELL = 1;
/** How far the hero sees on the map, and how soft that edge is. */
const REVEAL_R = 14;
const REVEAL_SOFT = 4.5;
/** Seconds between fog reveals and redraws. */
const TICK = 0.1;
/** World radius (m) the corner map shows at each zoom step. */
const ZOOMS = [16, 24, 34, 48, 68];
/** Awake monsters this close to the hero show on the map. */
const MONSTER_RANGE = 40;
const PREFS_KEY = 'orsolya.minimap';

/** How explored ground is kept in the save: run-length bits, base64. */
export interface FogSave {
  /** The layout key it belongs to. */
  k: string;
  w: number;
  h: number;
  d: string;
}

/** The pre-drawn ground of one area, one pixel per nav cell. */
export interface MapBase {
  canvas: HTMLCanvasElement;
  minX: number;
  minZ: number;
  width: number;
  depth: number;
}

/** What the map needs from a live area (the game's AreaState fits). */
export interface MapArea {
  world: World;
  monsters: Monster[];
}

// ---- Base layer --------------------------------------------------------

const rgba = (data: Uint8ClampedArray, i: number, r: number, g: number, b: number, a = 255) => {
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
};

/**
 * Draws an area's map from its nav grid and heights. Works through the grid
 * a few milliseconds at a time, yielding through `loading.step` between
 * chunks, so it never holds up a frame while an area builds in the background.
 */
export async function buildMapBase(world: World, stepText: string, stepAt: number): Promise<MapBase | null> {
  const nav = world.nav;
  if (!nav || typeof document === 'undefined') return null;
  const { cols, rows, cell, blocked } = nav;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(cols, rows);
  const data = img.data;
  const indoor = !!world.indoor;
  const water = world.waterLevel;
  const needHeights = !indoor || water !== undefined;
  const heights = needHeights ? new Float32Array(cols * rows) : null;
  const BUDGET = 5;
  let t0 = performance.now();
  const breathe = async () => {
    if (performance.now() - t0 < BUDGET) return;
    await loading.step(stepText, stepAt);
    t0 = performance.now();
  };
  if (heights) {
    for (let r = 0; r < rows; r++) {
      const z = nav.minZ + (r + 0.5) * cell;
      for (let c = 0; c < cols; c++) heights[r * cols + c] = world.heightAt(nav.minX + (c + 0.5) * cell, z);
      await breathe();
    }
  }
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && blocked[r * cols + c] === 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const p = i * 4;
      const h = heights ? heights[i] : 0;
      const wet = water !== undefined && h < water;
      // Cheap per-cell grain, so floors don't read as flat paint.
      const grain = (((c * 73856093) ^ (r * 19349663)) >>> 0) % 13;
      if (blocked[i] === 0) {
        if (wet) {
          rgba(data, p, 84 + grain, 18, 14);
          continue;
        }
        let shade = 1;
        if (heights && !indoor) {
          // Hill shading, lit from the top left of the map.
          const hx = heights[r * cols + Math.min(cols - 1, c + 1)] - heights[r * cols + Math.max(0, c - 1)];
          const hz = heights[Math.min(rows - 1, r + 1) * cols + c] - heights[Math.max(0, r - 1) * cols + c];
          shade = Math.min(1.45, Math.max(0.6, 1 + (hx + hz) * 0.9));
        }
        if (indoor) rgba(data, p, 74 + grain, 60 + grain, 50 + grain);
        else rgba(data, p, (76 + grain) * shade, (58 + grain) * shade, (40 + grain) * shade);
        continue;
      }
      // Blocked: a lit edge where it meets open ground, else wall mass or nothing.
      let edge = false;
      for (let dr = -1; dr <= 1 && !edge; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && open(c + dc, r + dr)) {
        edge = true;
        break;
      }
      if (wet) rgba(data, p, edge ? 150 : 44 + (grain >> 1), edge ? 52 : 7, edge ? 40 : 6, 255);
      else if (edge) rgba(data, p, 168, 132, 92);
      else if (indoor) rgba(data, p, 0, 0, 0, 0);
      else rgba(data, p, 30 + (grain >> 1), 21, 17, 235);
    }
    await breathe();
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, minX: nav.minX, minZ: nav.minZ, width: cols * cell, depth: rows * cell };
}

// ---- Fog of war --------------------------------------------------------

class Fog {
  readonly cols: number;
  readonly rows: number;
  /** How well each cell has been seen, 0 to 255. */
  readonly seen: Uint8Array;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Alpha is the unexplored share, for cutting the base image away. */
  private img: ImageData;
  private dx0 = Infinity;
  private dz0 = Infinity;
  private dx1 = -1;
  private dz1 = -1;
  /** Explored since the last save. */
  dirty = false;
  /** Bounds of the explored cells (empty while x0 > x1). */
  x0 = Infinity;
  z0 = Infinity;
  x1 = -1;
  z1 = -1;

  constructor(
    readonly key: string,
    readonly minX: number,
    readonly minZ: number,
    width: number,
    depth: number,
  ) {
    this.cols = Math.ceil(width / FOG_CELL);
    this.rows = Math.ceil(depth / FOG_CELL);
    this.seen = new Uint8Array(this.cols * this.rows);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(this.cols, this.rows);
    const d = this.img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    this.ctx.putImageData(this.img, 0, 0);
  }

  explored(x: number, z: number) {
    const c = Math.floor((x - this.minX) / FOG_CELL);
    const r = Math.floor((z - this.minZ) / FOG_CELL);
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.seen[r * this.cols + c] >= 128;
  }

  private set(i: number, c: number, r: number, v: number) {
    if (v <= this.seen[i]) return;
    if (v >= 128 && this.seen[i] < 128) {
      this.dirty = true;
      if (c < this.x0) this.x0 = c;
      if (c > this.x1) this.x1 = c;
      if (r < this.z0) this.z0 = r;
      if (r > this.z1) this.z1 = r;
    }
    this.seen[i] = v;
    this.img.data[i * 4 + 3] = 255 - v;
    if (c < this.dx0) this.dx0 = c;
    if (c > this.dx1) this.dx1 = c;
    if (r < this.dz0) this.dz0 = r;
    if (r > this.dz1) this.dz1 = r;
  }

  /** Uncovers a soft-edged disc around (x, z). */
  reveal(x: number, z: number) {
    const R = REVEAL_R;
    const fx = (x - this.minX) / FOG_CELL;
    const fz = (z - this.minZ) / FOG_CELL;
    const rc = R / FOG_CELL;
    const c0 = Math.max(0, Math.floor(fx - rc));
    const c1 = Math.min(this.cols - 1, Math.ceil(fx + rc));
    const r0 = Math.max(0, Math.floor(fz - rc));
    const r1 = Math.min(this.rows - 1, Math.ceil(fz + rc));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot(c + 0.5 - fx, r + 0.5 - fz) * FOG_CELL;
        if (d >= R) continue;
        const t = Math.min(1, (R - d) / REVEAL_SOFT);
        this.set(r * this.cols + c, c, r, Math.round(t * t * (3 - 2 * t) * 255));
      }
    }
  }

  /** Pushes changed cells to the fog canvas. */
  flush() {
    if (this.dx1 < 0) return;
    this.ctx.putImageData(this.img, 0, 0, this.dx0, this.dz0, this.dx1 - this.dx0 + 1, this.dz1 - this.dz0 + 1);
    this.dx0 = this.dz0 = Infinity;
    this.dx1 = this.dz1 = -1;
  }

  /** Explored cells as alternating run lengths (unexplored first), LEB128 varints, base64. */
  encode(): FogSave {
    const bytes: number[] = [];
    const push = (n: number) => {
      while (n >= 0x80) {
        bytes.push((n & 0x7f) | 0x80);
        n >>>= 7;
      }
      bytes.push(n);
    };
    let bit = 0;
    let run = 0;
    for (let i = 0; i < this.seen.length; i++) {
      const b = this.seen[i] >= 128 ? 1 : 0;
      if (b === bit) run++;
      else {
        push(run);
        bit = b;
        run = 1;
      }
    }
    push(run);
    let s = '';
    for (let i = 0; i < bytes.length; i += 4096) s += String.fromCharCode(...bytes.slice(i, i + 4096));
    return { k: this.key, w: this.cols, h: this.rows, d: btoa(s) };
  }

  /** Restores a saved bitmask; false (and nothing changed) if it doesn't fit. */
  decode(save: FogSave): boolean {
    if (save.k !== this.key || save.w !== this.cols || save.h !== this.rows) return false;
    let raw: string;
    try {
      raw = atob(save.d);
    } catch {
      return false;
    }
    const runs: number[] = [];
    let n = 0;
    let shift = 0;
    for (let i = 0; i < raw.length; i++) {
      const b = raw.charCodeAt(i);
      n += (b & 0x7f) * 2 ** shift;
      if (b & 0x80) shift += 7;
      else {
        runs.push(n);
        n = 0;
        shift = 0;
      }
    }
    if (runs.reduce((a, b) => a + b, 0) !== this.seen.length) return false;
    let i = 0;
    let bit = 0;
    for (const len of runs) {
      if (bit) for (let j = i; j < i + len; j++) this.set(j, j % this.cols, (j / this.cols) | 0, 255);
      i += len;
      bit ^= 1;
    }
    this.dirty = false;
    this.flush();
    return true;
  }
}

// ---- The maps ----------------------------------------------------------

const CSS = `
  .minimap { position: absolute; right: 16px; top: calc(50px + env(safe-area-inset-top, 0px)); width: 176px; pointer-events: none; }
  .mm-disc { position: relative; width: 176px; height: 176px; border-radius: 50%; overflow: hidden; pointer-events: auto; cursor: pointer;
    background: radial-gradient(circle at 50% 45%, #140807 0%, #070303 75%);
    box-shadow: 0 0 0 2px #3a2418, 0 0 0 5px #120a07, 0 0 0 6px #5a3a24, 0 6px 18px rgba(0,0,0,.7); }
  .mm-disc canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .mm-disc::after { content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
    background: radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 62%, rgba(0,0,0,.65) 100%),
                radial-gradient(ellipse 60% 34% at 40% 14%, rgba(255,230,200,.07), rgba(255,255,255,0) 70%); }
  .mm-north { position: absolute; left: 50%; top: -4px; width: 0; height: 0; pointer-events: none; z-index: 1; }
  .mm-north::before { content: 'N'; position: absolute; left: -7px; top: -7px; width: 14px; height: 14px; display: grid; place-items: center;
    font: 600 9px/1 'Cinzel', Georgia, serif; color: #e8c890; background: #1a0c09; border: 1px solid #6a3424; border-radius: 50%; }
  .mm-wrap { position: relative; }
  .mm-ctrl { position: absolute; left: -8px; bottom: -4px; display: flex; flex-direction: column; gap: 3px; pointer-events: auto; z-index: 1; }
  .mm-ctrl button, .mm-show { width: 22px; height: 22px; padding: 0; display: grid; place-items: center; cursor: pointer;
    font: 600 13px/1 'Cinzel', Georgia, serif; color: #e8d0b0; background: rgba(30,12,10,.92); border: 1px solid #6a3424; }
  .mm-ctrl button:hover, .mm-show:hover { border-color: #a85a3a; }
  .mm-label { margin-top: 9px; text-align: center; font: 600 11px/1.2 'Cinzel', Georgia, serif; letter-spacing: .1em; color: #c8a878;
    text-shadow: 0 1px 2px #000, 0 0 6px #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mm-show { position: absolute; right: 16px; top: calc(50px + env(safe-area-inset-top, 0px)); width: auto; padding: 0 9px; font-size: 11px;
    letter-spacing: .08em; pointer-events: auto; }
  .hud.has-minimap .tracker { top: calc(262px + env(safe-area-inset-top, 0px)); }
  .map-overlay { position: fixed; inset: 0; z-index: 4; pointer-events: none; background: radial-gradient(ellipse at center, rgba(8,3,3,.62), rgba(4,1,1,.84));
    font-family: 'EB Garamond', Georgia, serif; color: #e6d6c0; }
  .map-overlay canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .map-overlay h2 { position: absolute; left: 0; right: 0; top: calc(64px + env(safe-area-inset-top, 0px)); margin: 0; text-align: center;
    font: 600 clamp(20px, 3.4vw, 30px)/1.1 'Cinzel', Georgia, serif; letter-spacing: .12em; color: #e8c8a0; text-shadow: 0 2px 10px #000, 0 0 24px rgba(160,30,20,.45); }
  .map-overlay .mo-sub { position: absolute; left: 0; right: 0; top: calc(100px + env(safe-area-inset-top, 0px)); text-align: center; font-style: italic;
    font-size: 15px; color: #a89080; text-shadow: 0 1px 3px #000; }
  .map-overlay .mo-legend { position: absolute; left: 50%; bottom: calc(150px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
    display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 16px; width: min(640px, calc(100vw - 32px)); font-size: 14px; color: #c8b8a4;
    text-shadow: 0 1px 2px #000; }
  .mo-legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: -1px; border-radius: 50%; }
  .mo-legend i.hero { border-radius: 0; width: 0; height: 0; border: 6px solid transparent; border-bottom: 11px solid #f4dca0; border-top: 0; }
  .mo-legend i.exit { border-radius: 2px; background: #e89a40; }
  .mo-legend i.wp { border-radius: 0; transform: rotate(45deg) scale(.85); background: #70a8ff; }
  .mo-legend i.goal { border-radius: 0; transform: rotate(45deg) scale(.85); background: #f0c850; }
  .mo-legend i.npc { background: #d8c8a8; }
  .mo-legend i.foe { background: #e02818; }
  @media (max-width: 560px) {
    .minimap { top: calc(46px + env(safe-area-inset-top, 0px)); width: 120px; }
    .mm-disc { width: 120px; height: 120px; }
    .mm-label { font-size: 10px; margin-top: 7px; }
    .hud.has-minimap .tracker { top: calc(196px + env(safe-area-inset-top, 0px)); }
    .map-overlay .mo-legend { bottom: calc(120px + env(safe-area-inset-bottom, 0px)); font-size: 12px; }
  }
`;

const C_HERO = '#f4dca0';
const C_EXIT = '#e89a40';
const C_PORTAL = '#8ab8ff';
const C_WP = '#70a8ff';
const C_GOAL = '#f0c850';
const C_NPC = '#d8c8a8';
const C_FOE = '#e02818';
const C_ELITE = '#ff9a30';
const C_OUTLINE = '#120605';

export class Minimap {
  private root: HTMLDivElement;
  private disc: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private label: HTMLDivElement;
  private showBtn: HTMLButtonElement;
  private overlay: HTMLDivElement;
  private oCanvas: HTMLCanvasElement;
  private oCtx: CanvasRenderingContext2D;
  private oTitle: HTMLHeadingElement;
  private oSub: HTMLDivElement;
  private fogs = new Map<string, Fog>();
  private fog: Fog | null = null;
  private base: MapBase | null = null;
  private area: MapArea | null = null;
  private zoomIx = 1;
  private hidden = false;
  private timer = TICK;
  private drawTimer = 0;
  private lastYaw = NaN;
  private size = 0;
  private oW = 0;
  private oH = 0;
  /** 0 none, 1 has an errand to give, 2 waiting on one, 3 ready to be turned in. */
  npcMark: (n: Npc) => number = () => 0;

  constructor(private hud: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'minimap';
    this.root.hidden = true;
    this.root.innerHTML = `<div class="mm-wrap"><div class="mm-disc" title="Open the map (M)"><canvas></canvas></div>
      <div class="mm-ctrl"><button type="button" data-z="1" title="Zoom in (+)">+</button><button type="button" data-z="-1" title="Zoom out (−)">−</button><button type="button" data-hide title="Hide the minimap">×</button></div></div>
      <div class="mm-label"></div>`;
    hud.appendChild(this.root);
    this.disc = this.root.querySelector('.mm-disc')!;
    this.canvas = this.disc.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.label = this.root.querySelector('.mm-label')!;
    this.showBtn = document.createElement('button');
    this.showBtn.type = 'button';
    this.showBtn.className = 'mm-show';
    this.showBtn.textContent = 'Map';
    this.showBtn.title = 'Show the minimap';
    this.showBtn.hidden = true;
    hud.appendChild(this.showBtn);
    for (const el of [this.root, this.showBtn]) el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.disc.addEventListener('click', () => this.toggleOverlay());
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-z]')) b.addEventListener('click', () => this.zoom(Number(b.dataset.z)));
    this.root.querySelector('[data-hide]')!.addEventListener('click', () => this.setHidden(true));
    this.showBtn.addEventListener('click', () => this.setHidden(false));

    this.overlay = document.createElement('div');
    this.overlay.className = 'map-overlay';
    this.overlay.hidden = true;
    this.overlay.innerHTML = `<canvas></canvas><h2></h2><div class="mo-sub"></div><div class="mo-legend">
      <span><i class="hero"></i>You</span><span><i class="exit"></i>Way out</span><span><i class="wp"></i>Waypoint</span>
      <span><i class="goal"></i>Objective</span><span><i class="npc"></i>Townsfolk</span><span><i class="foe"></i>Foes nearby</span></div>`;
    document.body.appendChild(this.overlay);
    this.oCanvas = this.overlay.querySelector('canvas')!;
    this.oCtx = this.oCanvas.getContext('2d')!;
    this.oTitle = this.overlay.querySelector('h2')!;
    this.oSub = this.overlay.querySelector('.mo-sub')!;
    window.addEventListener('resize', () => {
      this.size = 0;
      this.oW = 0;
      this.timer = TICK;
    });
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as { zoom?: unknown; hidden?: unknown };
      if (typeof p.zoom === 'number' && p.zoom >= 0 && p.zoom < ZOOMS.length) this.zoomIx = Math.floor(p.zoom);
      this.hidden = p.hidden === true;
    } catch {
      /* defaults */
    }
  }

  get overlayOpen() {
    return !this.overlay.hidden;
  }

  private savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ zoom: this.zoomIx, hidden: this.hidden }));
    } catch {
      /* per-browser nicety only */
    }
  }

  private layout() {
    const on = !!this.area && !this.hidden;
    this.root.hidden = !on;
    this.showBtn.hidden = !this.area || !this.hidden;
    this.hud.classList.toggle('has-minimap', on);
  }

  setHidden(on: boolean) {
    this.hidden = on;
    this.savePrefs();
    this.layout();
    this.timer = TICK;
  }

  toggleHidden() {
    this.setHidden(!this.hidden);
  }

  zoom(dir: number) {
    if (this.hidden) {
      this.setHidden(false);
      return;
    }
    this.zoomIx = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomIx - Math.sign(dir)));
    this.savePrefs();
    this.timer = TICK;
  }

  toggleOverlay(on = this.overlay.hidden) {
    this.overlay.hidden = !on || !this.area;
    this.oW = 0;
    this.timer = TICK;
  }

  /** Forgets every area's fog (another hero was loaded). */
  reset() {
    this.fogs.clear();
    this.fog = null;
  }

  /**
   * Switches to an area. Its fog comes from this session if the layout is
   * the same, else from the save, else it starts unexplored.
   */
  setArea(name: string, title: string, sub: string, area: MapArea, base: MapBase | null, store: Record<string, FogSave>) {
    const w = area.world;
    const nav = w.nav;
    this.area = area;
    this.base = base;
    this.label.textContent = title;
    this.oTitle.textContent = title;
    this.oSub.textContent = sub;
    if (!nav) {
      this.fog = null;
    } else {
      const key = w.layoutKey ?? name;
      let fog = this.fogs.get(name);
      if (!fog || fog.key !== key) {
        fog = new Fog(key, nav.minX, nav.minZ, nav.cols * nav.cell, nav.rows * nav.cell);
        const saved = store[name];
        if (saved && typeof saved === 'object') fog.decode(saved);
        this.fogs.set(name, fog);
      }
      this.fog = fog;
    }
    this.timer = TICK;
    this.layout();
  }

  /** Writes explored ground that changed since the last save into the store. */
  store(store: Record<string, FogSave>) {
    for (const [name, fog] of this.fogs) {
      if (!fog.dirty && store[name]?.k === fog.key) continue;
      store[name] = fog.encode();
      fog.dirty = false;
    }
  }

  /** Fraction of the current area explored, for tests and the debug overlay. */
  get explored(): number {
    const f = this.fog;
    if (!f) return 0;
    let n = 0;
    for (let i = 0; i < f.seen.length; i++) if (f.seen[i] >= 128) n++;
    return n / f.seen.length;
  }

  update(dt: number, px: number, pz: number, facing: number, yaw: number) {
    if (!this.area) return;
    this.timer += dt;
    this.drawTimer += dt;
    const turning = Math.abs(yaw - this.lastYaw) > 0.004 || this.lastYaw !== this.lastYaw;
    if (this.timer >= TICK) {
      this.timer = 0;
      if (this.fog) {
        this.fog.reveal(px, pz);
        this.fog.flush();
      }
    } else if (!(turning && this.drawTimer >= 1 / 40)) return;
    // Redraw on the tick, and more often while the camera swings round.
    this.drawTimer = 0;
    this.lastYaw = yaw;
    if (!this.hidden) this.drawMini(px, pz, facing, yaw);
    if (!this.overlay.hidden) this.drawOverlay(px, pz, facing, yaw);
  }

  private drawMini(px: number, pz: number, facing: number, yaw: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!this.size) {
      const css = this.disc.clientWidth || 176;
      this.size = Math.round(css * dpr);
      this.canvas.width = this.canvas.height = this.size;
    }
    const S = this.size;
    const scale = S / 2 / ZOOMS[this.zoomIx];
    this.render(this.ctx, S, S, px, pz, scale, yaw, dpr, true, px, pz, facing);
  }

  private drawOverlay(px: number, pz: number, facing: number, yaw: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!this.oW) {
      this.oW = Math.round(window.innerWidth * dpr);
      this.oH = Math.round(window.innerHeight * dpr);
      this.oCanvas.width = this.oW;
      this.oCanvas.height = this.oH;
    }
    const W = this.oW;
    const H = this.oH;
    // Fit the explored ground (turned to match the screen) between the title and the HUD.
    const f = this.fog;
    let cx = px;
    let cz = pz;
    let scale = 7 * dpr;
    if (f && f.x0 <= f.x1) {
      const pad = 6;
      const x0 = f.minX + f.x0 * FOG_CELL - pad;
      const x1 = f.minX + (f.x1 + 1) * FOG_CELL + pad;
      const z0 = f.minZ + f.z0 * FOG_CELL - pad;
      const z1 = f.minZ + (f.z1 + 1) * FOG_CELL + pad;
      cx = (x0 + x1) / 2;
      cz = (z0 + z1) / 2;
      const c = Math.abs(Math.cos(yaw));
      const s = Math.abs(Math.sin(yaw));
      const ew = (x1 - x0) * c + (z1 - z0) * s;
      const eh = (x1 - x0) * s + (z1 - z0) * c;
      const availW = W - 64 * dpr;
      const availH = H - 300 * dpr;
      scale = Math.min(9 * dpr, availW / ew, Math.max(80 * dpr, availH) / eh);
    }
    // Shift down a little so the map sits between the title and the belt.
    this.render(this.oCtx, W, H, cx, cz, scale, yaw, dpr, false, px, pz, facing, 16 * dpr);
  }

  /**
   * Draws the map centred on world (cx, cz), turned by the camera yaw so that
   * up on the map is up on screen. All marker maths is done by hand to keep
   * this allocation-free.
   */
  private render(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    cx: number,
    cz: number,
    scale: number,
    yaw: number,
    dpr: number,
    round: boolean,
    px: number,
    pz: number,
    facing: number,
    shiftY = 0,
  ) {
    const area = this.area!;
    const w = area.world;
    const fog = this.fog;
    const ox = W / 2;
    const oy = H / 2 + shiftY;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const rim = W / 2 - 7 * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (round) {
      ctx.beginPath();
      ctx.arc(ox, oy, W / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    // Ground, then the fog cut out of it.
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cz);
    ctx.imageSmoothingEnabled = true;
    if (!round) ctx.globalAlpha = 0.94;
    if (this.base) ctx.drawImage(this.base.canvas, this.base.minX, this.base.minZ, this.base.width, this.base.depth);
    ctx.globalAlpha = 1;
    if (fog) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(fog.canvas, fog.minX, fog.minZ, fog.cols * FOG_CELL, fog.rows * FOG_CELL);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // Markers, placed by project() into this.sx / this.sy.
    const P = this.proj;
    P.ox = ox;
    P.oy = oy;
    P.cx = cx;
    P.cz = cz;
    P.cos = cos;
    P.sin = sin;
    P.scale = scale;
    P.rim = rim;
    P.round = round;
    const u = 1 * dpr;
    const big = round ? 1 : 1.35;
    this.fonts(u, big);
    // Townsfolk.
    if (w.npcs) {
      for (const n of w.npcs) {
        if (fog && !fog.explored(n.position.x, n.position.z)) continue;
        if (!this.project(n.position.x, n.position.z, false)) continue;
        const mark = this.npcMark(n);
        ctx.fillStyle = C_OUTLINE;
        ctx.beginPath();
        ctx.arc(this.sx, this.sy, 3.6 * u * big, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = mark === 1 || mark === 3 ? C_GOAL : C_NPC;
        ctx.beginPath();
        ctx.arc(this.sx, this.sy, 2.5 * u * big, 0, Math.PI * 2);
        ctx.fill();
        if (mark) {
          ctx.font = this.fontMark;
          ctx.textAlign = 'center';
          ctx.fillStyle = mark === 2 ? '#b8b0a4' : C_GOAL;
          ctx.fillText(mark === 1 ? '!' : '?', this.sx, this.sy - 5 * u * big);
        }
      }
    }
    // Objectives: the area script's usable things that are still live.
    const usable = w.script?.interactables;
    if (usable) {
      for (const it of usable) {
        if (!it.active() || (fog && !fog.explored(it.pos.x, it.pos.z))) continue;
        if (!this.project(it.pos.x, it.pos.z, true)) continue;
        this.diamond(ctx, this.sx, this.sy, 4.6 * u * big, C_GOAL);
      }
    }
    // Waypoint.
    const wp = w.waypoint;
    if (wp && (!fog || fog.explored(wp.pos.x, wp.pos.z)) && this.project(wp.pos.x, wp.pos.z, true)) this.diamond(ctx, this.sx, this.sy, 5.4 * u * big, C_WP);
    // Ways out (a portal shows wherever it is; gates once seen).
    if (w.exits) {
      for (const e of w.exits) {
        const portal = e.entry === 'portal';
        if (!portal && fog && !fog.explored(e.pos.x, e.pos.z)) continue;
        if (!this.project(e.pos.x, e.pos.z, true)) continue;
        const r = 4.4 * u * big;
        ctx.fillStyle = C_OUTLINE;
        ctx.fillRect(this.sx - r - u, this.sy - r - u, (r + u) * 2, (r + u) * 2);
        ctx.fillStyle = portal ? C_PORTAL : C_EXIT;
        ctx.fillRect(this.sx - r, this.sy - r, r * 2, r * 2);
        // An arch cut into the square reads as a doorway.
        ctx.fillStyle = C_OUTLINE;
        ctx.beginPath();
        ctx.arc(this.sx, this.sy, r * 0.42, Math.PI, 0);
        ctx.rect(this.sx - r * 0.42, this.sy, r * 0.84, r);
        ctx.fill();
        if (!round) {
          ctx.font = this.fontLabel;
          ctx.textAlign = 'center';
          ctx.lineWidth = 3 * u;
          ctx.strokeStyle = 'rgba(8,3,2,.9)';
          ctx.strokeText(e.label, this.sx, this.sy - r - 6 * u);
          ctx.fillStyle = portal ? '#d0e4ff' : '#f0d8b0';
          ctx.fillText(e.label, this.sx, this.sy - r - 6 * u);
        }
      }
    }
    // Awake monsters near the hero.
    for (const m of area.monsters) {
      if (!m.awake || m.removed || m.hidden || !m.alive) continue;
      const dx = m.position.x - px;
      const dz = m.position.z - pz;
      if (dx * dx + dz * dz > MONSTER_RANGE * MONSTER_RANGE) continue;
      if (!this.project(m.position.x, m.position.z, false)) continue;
      ctx.fillStyle = C_OUTLINE;
      ctx.beginPath();
      ctx.arc(this.sx, this.sy, (m.elite ? 3.8 : 3) * u * big, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = m.elite ? C_ELITE : C_FOE;
      ctx.beginPath();
      ctx.arc(this.sx, this.sy, (m.elite ? 2.8 : 2) * u * big, 0, Math.PI * 2);
      ctx.fill();
    }
    // The hero: an arrow pointing the way they face, as seen on screen.
    this.project(px, pz, true);
    const sx = this.sx;
    const sy = this.sy;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.PI - (facing - yaw));
    const a = 7 * u * big;
    ctx.beginPath();
    ctx.moveTo(0, -a);
    ctx.lineTo(a * 0.68, a * 0.72);
    ctx.lineTo(0, a * 0.34);
    ctx.lineTo(-a * 0.68, a * 0.72);
    ctx.closePath();
    ctx.lineWidth = 2.2 * u;
    ctx.strokeStyle = C_OUTLINE;
    ctx.stroke();
    ctx.fillStyle = C_HERO;
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  private sx = 0;
  private sy = 0;
  private proj = { ox: 0, oy: 0, cx: 0, cz: 0, cos: 1, sin: 0, scale: 1, rim: 0, round: true };

  /** Turns world (x, z) into canvas pixels in sx/sy; on the round map, clamps to the rim when `pin`, else returns false off the map. */
  private project(x: number, z: number, pin: boolean): boolean {
    const P = this.proj;
    const dx = (x - P.cx) * P.scale;
    const dz = (z - P.cz) * P.scale;
    this.sx = P.ox + P.cos * dx - P.sin * dz;
    this.sy = P.oy + P.sin * dx + P.cos * dz;
    if (!P.round) return true;
    const ex = this.sx - P.ox;
    const ey = this.sy - P.oy;
    const d = Math.hypot(ex, ey);
    if (d <= P.rim) return true;
    if (!pin) return false;
    this.sx = P.ox + (ex / d) * P.rim;
    this.sy = P.oy + (ey / d) * P.rim;
    return true;
  }

  private fontKey = -1;
  private fontMark = '';
  private fontLabel = '';
  private fonts(u: number, big: number) {
    const key = u * 1000 + big;
    if (key === this.fontKey) return;
    this.fontKey = key;
    this.fontMark = `700 ${Math.round(11 * u * big)}px Cinzel, Georgia, serif`;
    this.fontLabel = `600 ${Math.round(12 * u)}px Cinzel, Georgia, serif`;
  }

  private diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    ctx.beginPath();
    ctx.moveTo(x, y - r - 1.5);
    ctx.lineTo(x + r + 1.5, y);
    ctx.lineTo(x, y + r + 1.5);
    ctx.lineTo(x - r - 1.5, y);
    ctx.closePath();
    ctx.fillStyle = C_OUTLINE;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
