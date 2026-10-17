import { mulberry32, type Rng } from '../procgen/noise';

// The title screen's backdrop, painted in 2D so it shows at once, before any
// 3D world exists: the cathedral of Saint Orsolya and the town roofs against
// a storm-red sky and a blood moon, a dead tree and a gallows in the
// foreground, drifting ground fog, rising embers, crows and far lightning.
// Still layers are painted once per size; only what moves is drawn each frame.

type Layer = HTMLCanvasElement;
interface Lit {
  /** Pointed-arch window rather than a plain square one. */
  arch?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  phase: number;
  warm: number;
}
interface Ember {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  sway: number;
}
interface Crow {
  x: number;
  y: number;
  vx: number;
  phase: number;
  size: number;
}

const HORIZON = 0.7;

/** Value noise that wraps every `period` cells along x, so strips tile. */
function wrapNoise(rng: Rng, period: number, rows: number) {
  const g = Array.from({ length: (rows + 2) * period }, () => rng());
  const at = (i: number, j: number) => g[(((j % (rows + 2)) + rows + 2) % (rows + 2)) * period + (((i % period) + period) % period)];
  return (x: number, y: number) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
}

/** A tileable strip of soft cloud, as an image: alpha follows the noise. */
function cloudStrip(seed: number, w: number, h: number, rgb: [number, number, number], shape: (y: number) => number, cover: number, scale = 1): Layer {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const rng = mulberry32(seed);
  const octaves = [8, 16, 32, 64].map((p) => ({ p: Math.round(p * scale), n: wrapNoise(rng, Math.round(p * scale), Math.round(p * scale)) }));
  for (let y = 0; y < h; y++) {
    const fall = shape(y / h);
    for (let x = 0; x < w; x++) {
      let n = 0;
      let a = 0.55;
      for (const o of octaves) {
        n += o.n((x / w) * o.p, (y / h) * o.p * (h / w) * 2) * a;
        a *= 0.5;
      }
      const d = Math.max(0, Math.min(1, (n - cover) / 0.35)) * fall;
      const k = (y * w + x) * 4;
      img.data[k] = rgb[0] * (0.7 + n * 0.5);
      img.data[k + 1] = rgb[1] * (0.7 + n * 0.5);
      img.data[k + 2] = rgb[2] * (0.7 + n * 0.5);
      img.data[k + 3] = d * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class TitleScene {
  readonly canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private far!: Layer;
  private town!: Layer;
  private fore!: Layer;
  private lit: Lit[] = [];
  private clouds: Layer[];
  private fog: Layer[];
  private embers: Ember[] = [];
  private crows: Crow[] = [];
  private crowTimer = 4;
  private flash = 0;
  private flashTimer = 6;
  private t = 0;
  private mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  private rng = mulberry32(1931);
  /** Where the bell hangs and the gallows stands, in layer pixels (set when painting). */
  private bell = { x: 0, y: 0, s: 1 };
  private gallows = { x: 0, y: 0, s: 1 };
  private raf = 0;
  private last = 0;

  constructor(parent: HTMLElement) {
    this.canvas.className = 'title-canvas';
    parent.appendChild(this.canvas);
    this.clouds = [
      cloudStrip(11, 512, 160, [120, 18, 14], (y) => Math.sin(y * Math.PI), 0.42),
      cloudStrip(12, 512, 160, [60, 8, 8], (y) => Math.sin(y * Math.PI), 0.38, 0.75),
    ];
    this.fog = [0, 1, 2].map((i) => cloudStrip(30 + i, 512, 64, [92, 22, 18], (y) => Math.exp(-((y - 0.55) ** 2) / 0.06), 0.3, 0.5));
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', this.onMove);
    this.onResize();
    for (let i = 0; i < 70; i++) this.embers.push(this.ember(true));
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('pointermove', this.onMove);
    this.canvas.remove();
  }

  private onMove = (e: PointerEvent) => {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  };

  private onResize = () => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.paintStill();
  };

  // ---- Still layers -----------------------------------------------------

  /** A layer a little wider than the screen, so parallax never shows an edge. */
  private layer(): [Layer, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = Math.round((this.w + 60) * this.dpr);
    c.height = Math.round((this.h + 30) * this.dpr);
    const ctx = c.getContext('2d')!;
    ctx.scale(this.dpr, this.dpr);
    ctx.translate(30, 15);
    return [c, ctx];
  }

  private paintStill() {
    const { w, h } = this;
    const rng = mulberry32(77);
    const base = h * HORIZON;
    const s = Math.min(w / 900, h / 560);

    // Far hills and the town wall, hazy with distance.
    {
      const [c, g] = this.layer();
      const ridge = (y0: number, amp: number, color: string, seed: number) => {
        const n = wrapNoise(mulberry32(seed), 12, 2);
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(-30, h + 20);
        for (let x = -30; x <= w + 30; x += 6) g.lineTo(x, y0 - (n((x / w) * 6, 0.5) * 0.7 + n((x / w) * 12, 1.2) * 0.3) * amp);
        g.lineTo(w + 30, h + 20);
        g.fill();
      };
      ridge(base - 10 * s, 60 * s, '#2a0a09', 3);
      ridge(base + 6 * s, 34 * s, '#1c0607', 4);
      this.far = c;
    }

    // The cathedral and the town around it.
    {
      const [c, g] = this.layer();
      this.lit = [];
      const cx = w * 0.5;
      const grad = g.createLinearGradient(0, base - 300 * s, 0, base + 40 * s);
      grad.addColorStop(0, '#1a0507');
      grad.addColorStop(1, '#070102');
      g.fillStyle = grad;
      const rect = (x: number, y: number, ww: number, hh: number) => g.fillRect(cx + x * s, base - (y + hh) * s, ww * s, hh * s);
      const tri = (x0: number, x1: number, y: number, peak: number) => {
        g.beginPath();
        g.moveTo(cx + x0 * s, base - y * s);
        g.lineTo(cx + ((x0 + x1) / 2) * s, base - peak * s);
        g.lineTo(cx + x1 * s, base - y * s);
        g.fill();
      };
      const pinnacle = (x: number, y: number, hh: number, ww = 4) => tri(x - ww / 2, x + ww / 2, y, y + hh);
      // Nave and its steep roof, with pinnacles along the buttresses.
      rect(-70, 0, 170, 78);
      tri(-74, 104, 76, 118);
      for (let x = -60; x <= 90; x += 25) {
        rect(x - 3, 0, 6, 92);
        pinnacle(x, 92, 16, 5);
      }
      // Apse at the east end.
      rect(100, 0, 34, 66);
      tri(98, 136, 64, 92);
      // The west front: two towers with spires and a gabled facade between.
      for (const tx of [-118, -82]) {
        rect(tx, 0, 26, 176);
        rect(tx - 2, 170, 30, 6);
        tri(tx - 1, tx + 27, 176, 262);
        pinnacle(tx - 1, 176, 18);
        pinnacle(tx + 27, 176, 18);
      }
      rect(-92, 0, 22, 128);
      tri(-94, -68, 128, 150);
      // The crossing tower, where the silent bell hangs.
      rect(14, 0, 40, 214);
      rect(10, 206, 48, 8);
      tri(12, 56, 214, 330);
      pinnacle(10, 214, 26, 6);
      pinnacle(58, 214, 26, 6);
      // Windows: tall pointed arches, a rose window, a few faintly lit.
      const arch = (x: number, y: number, ww: number, hh: number, color: string) => {
        g.fillStyle = color;
        g.beginPath();
        g.moveTo(cx + x * s, base - y * s);
        g.lineTo(cx + x * s, base - (y + hh - ww * 0.6) * s);
        g.quadraticCurveTo(cx + x * s, base - (y + hh) * s, cx + (x + ww / 2) * s, base - (y + hh) * s);
        g.quadraticCurveTo(cx + (x + ww) * s, base - (y + hh) * s, cx + (x + ww) * s, base - (y + hh - ww * 0.6) * s);
        g.lineTo(cx + (x + ww) * s, base - y * s);
        g.fill();
      };
      const dark = '#040001';
      for (let x = -48; x < 90; x += 25) {
        const lit = rng() < 0.45;
        arch(x + 5, 22, 9, 40, dark);
        if (lit) this.lit.push({ arch: true, x: cx + (x + 5) * s, y: base - 62 * s, w: 9 * s, h: 40 * s, phase: rng() * 10, warm: 0.3 + rng() * 0.35 });
      }
      for (const tx of [-118, -82]) {
        arch(tx + 9, 120, 8, 34, dark);
        arch(tx + 9, 40, 8, 40, dark);
      }
      // The belfry: an open arch showing the sky, the bell hanging in it.
      arch(24, 150, 20, 46, '#3a0b09');
      this.bell = { x: cx + 34 * s, y: base - 190 * s, s };
      // Rose window.
      g.fillStyle = dark;
      g.beginPath();
      g.arc(cx - 81 * s, base - 102 * s, 9 * s, 0, Math.PI * 2);
      g.fill();
      this.lit.push({ x: cx - 87 * s, y: base - 108 * s, w: 12 * s, h: 12 * s, phase: 3, warm: 0.45 });
      g.fillStyle = grad;

      // Houses in front, left and right of the cathedral, some windows lit.
      const houses = (from: number, to: number) => {
        let x = from;
        while (x < to) {
          const ww = 22 + rng() * 26;
          const hh = 26 + rng() * 34;
          const roof = ww * (0.55 + rng() * 0.5);
          const y0 = rng() * 6;
          g.fillStyle = rng() < 0.5 ? '#0d0304' : '#100405';
          g.fillRect(cx + x * s, base - (y0 + hh) * s + 18 * s, ww * s, (hh + y0) * s);
          g.beginPath();
          g.moveTo(cx + (x - 2) * s, base - (y0 + hh) * s + 18 * s);
          g.lineTo(cx + (x + ww / 2) * s, base - (y0 + hh + roof) * s + 18 * s);
          g.lineTo(cx + (x + ww + 2) * s, base - (y0 + hh) * s + 18 * s);
          g.fill();
          if (rng() < 0.5) g.fillRect(cx + (x + ww * 0.7) * s, base - (y0 + hh + roof * 0.7) * s + 18 * s, 4 * s, roof * 0.5 * s);
          if (rng() < 0.55) this.lit.push({ x: cx + (x + ww * (0.2 + rng() * 0.5)) * s, y: base - (y0 + hh * (0.35 + rng() * 0.4)) * s + 18 * s, w: 4 * s, h: 5 * s, phase: rng() * 10, warm: 0.6 + rng() * 0.4 });
          x += ww + rng() * 6 - 1;
        }
      };
      houses(-w / s / 2 - 20, -140);
      houses(150, w / s / 2 + 20);
      houses(-150, -100);
      houses(60, 160);
      this.town = c;
    }

    // The foreground: dark ground, a dead tree, grave crosses and a gallows.
    {
      const [c, g] = this.layer();
      const groundY = h * 0.88;
      const n = wrapNoise(mulberry32(9), 10, 2);
      g.fillStyle = '#030001';
      g.beginPath();
      g.moveTo(-30, h + 20);
      for (let x = -30; x <= w + 30; x += 5) g.lineTo(x, groundY - n((x / w) * 5, 0.3) * 26 * s - Math.max(0, 1 - Math.abs(x / w - 0.08) * 6) * 30 * s);
      g.lineTo(w + 30, h + 20);
      g.fill();
      // Dead tree: recursive branches, thinner as they split.
      g.strokeStyle = '#030001';
      g.lineCap = 'round';
      const branch = (x: number, y: number, ang: number, len: number, width: number, depth: number) => {
        const x2 = x + Math.cos(ang) * len;
        const y2 = y + Math.sin(ang) * len;
        g.lineWidth = width;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(ang + 0.3) * len * 0.5, y + Math.sin(ang + 0.3) * len * 0.5, x2, y2);
        g.stroke();
        if (depth <= 0) return;
        const kids = depth > 4 ? 2 : 2 + (rng() < 0.4 ? 1 : 0);
        for (let i = 0; i < kids; i++) branch(x2, y2, ang + (rng() - 0.5) * 1.3, len * (0.62 + rng() * 0.18), width * 0.66, depth - 1);
      };
      branch(w * 0.07, groundY - 20 * s, -Math.PI / 2 - 0.12, 120 * s, 16 * s, 7);
      // Grave crosses, leaning.
      g.fillStyle = '#030001';
      for (let i = 0; i < 9; i++) {
        const x = w * (0.16 + rng() * 0.22 + (i > 5 ? 0.42 : 0));
        const y = groundY + 6 * s - n((x / w) * 5, 0.3) * 26 * s;
        g.save();
        g.translate(x, y);
        g.rotate((rng() - 0.5) * 0.35);
        const k = (0.6 + rng() * 0.6) * s;
        g.fillRect(-2 * k, -30 * k, 4 * k, 32 * k);
        g.fillRect(-9 * k, -23 * k, 18 * k, 4 * k);
        g.restore();
      }
      // Gallows: two posts, a beam and a brace. The hanged figure sways (drawn per frame).
      const gx = w * 0.86;
      const gy = groundY - n((gx / w) * 5, 0.3) * 26 * s + 4 * s;
      g.fillRect(gx - 4 * s, gy - 150 * s, 8 * s, 152 * s);
      g.fillRect(gx - 4 * s, gy - 150 * s, 80 * s, 7 * s);
      g.lineWidth = 5 * s;
      g.beginPath();
      g.moveTo(gx, gy - 112 * s);
      g.lineTo(gx + 36 * s, gy - 146 * s);
      g.stroke();
      this.gallows = { x: gx + 64 * s, y: gy - 144 * s, s };
      this.fore = c;
    }
  }

  // ---- Moving parts -------------------------------------------------------

  private ember(anywhere = false): Ember {
    const r = this.rng;
    const max = 5 + r() * 7;
    return { x: r() * (this.w || 1600), y: anywhere ? r() * (this.h || 900) : (this.h || 900) + 10, vy: 18 + r() * 40, life: anywhere ? r() * max : 0, max, size: 0.8 + r() * 1.8, sway: r() * 10 };
  }

  private frame = (now: number) => {
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.t += dt;
    this.draw(dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw(dt: number) {
    const { ctx: g, w, h, t } = this;
    const m = this.mouse;
    m.sx += (m.x - m.sx) * Math.min(1, dt * 2);
    m.sy += (m.y - m.sy) * Math.min(1, dt * 2);
    const par = (depth: number): [number, number] => [-30 - m.sx * depth * 14, -15 - m.sy * depth * 6];
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const base = h * HORIZON;

    // Sky: near-black overhead, a smouldering red band above the horizon.
    const sky = g.createLinearGradient(0, 0, 0, base);
    sky.addColorStop(0, '#060102');
    sky.addColorStop(0.55, '#230505');
    sky.addColorStop(0.9, '#5a110b');
    sky.addColorStop(1, '#7a1a0e');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    // Lightning far behind the clouds: a double flicker every so often.
    if ((this.flashTimer -= dt) <= 0) {
      this.flashTimer = 7 + this.rng() * 14;
      this.flash = 1;
    }
    this.flash = Math.max(0, this.flash - dt * 2.4);
    const fl = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40)) : 0;

    // The blood moon, behind the high clouds.
    const mx = w * 0.7 - m.sx * 3;
    const my = h * 0.26 - m.sy * 2;
    const mr = Math.min(w, h) * 0.085;
    const glow = g.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 4.5);
    glow.addColorStop(0, 'rgba(200,60,30,0.35)');
    glow.addColorStop(1, 'rgba(120,20,10,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    const disc = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
    disc.addColorStop(0, '#f0a070');
    disc.addColorStop(0.6, '#c8462a');
    disc.addColorStop(1, '#8a2014');
    g.fillStyle = disc;
    g.beginPath();
    g.arc(mx, my, mr, 0, Math.PI * 2);
    g.fill();
    // Darker seas on its face.
    g.save();
    g.clip();
    for (const [ox, oy, r, a] of [[-0.3, -0.15, 0.42, 0.22], [0.25, 0.2, 0.35, 0.18], [0.1, -0.4, 0.22, 0.15], [-0.15, 0.45, 0.25, 0.12]]) {
      const sea = g.createRadialGradient(mx + ox * mr, my + oy * mr, 0, mx + ox * mr, my + oy * mr, r * mr);
      sea.addColorStop(0, `rgba(90,15,10,${a})`);
      sea.addColorStop(1, 'rgba(90,15,10,0)');
      g.fillStyle = sea;
      g.fillRect(mx - mr, my - mr, mr * 2, mr * 2);
    }
    g.restore();

    // Two cloud decks drifting at different speeds; the lightning lights them from within.
    const deck = (img: Layer, y: number, hh: number, speed: number, alpha: number) => {
      const ww = w * 1.6;
      const off = -((t * speed) % ww);
      g.globalAlpha = alpha;
      for (let x = off; x < w; x += ww) g.drawImage(img, x, y, ww, hh);
      if (fl > 0) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = alpha * fl * 0.8;
        for (let x = off; x < w; x += ww) g.drawImage(img, x, y, ww, hh);
        g.globalCompositeOperation = 'source-over';
      }
      g.globalAlpha = 1;
    };
    deck(this.clouds[1], -h * 0.05, h * 0.5, 6, 0.9);
    deck(this.clouds[0], h * 0.12, h * 0.55, 14, 0.85);

    // Crows crossing the sky in small flocks.
    if ((this.crowTimer -= dt) <= 0) {
      this.crowTimer = 9 + this.rng() * 12;
      const n = 3 + Math.floor(this.rng() * 4);
      const y = h * (0.14 + this.rng() * 0.2);
      for (let i = 0; i < n; i++) this.crows.push({ x: -40 - i * (20 + this.rng() * 30), y: y + (this.rng() - 0.5) * 40, vx: 55 + this.rng() * 25, phase: this.rng() * 6, size: 5 + this.rng() * 3 });
    }
    g.strokeStyle = '#090102';
    g.lineCap = 'round';
    for (const c of this.crows) {
      c.x += c.vx * dt;
      c.phase += dt * 9;
      const f = Math.sin(c.phase) * c.size * 0.7;
      g.lineWidth = c.size * 0.35;
      g.beginPath();
      g.moveTo(c.x - c.size, c.y - f);
      g.quadraticCurveTo(c.x - c.size * 0.4, c.y - f * 0.2, c.x, c.y);
      g.quadraticCurveTo(c.x + c.size * 0.4, c.y - f * 0.2, c.x + c.size, c.y - f);
      g.stroke();
    }
    this.crows = this.crows.filter((c) => c.x < w + 60);

    // Far hills, then the cathedral and town.
    g.drawImage(this.far, ...par(0.3), this.far.width / this.dpr, this.far.height / this.dpr);
    const [tx, ty] = par(0.6);
    g.drawImage(this.town, tx, ty, this.town.width / this.dpr, this.town.height / this.dpr);
    // The bell barely stirs: it hasn't rung in three nights.
    {
      const b = this.bell;
      const a = Math.sin(t * 0.5) * 0.04;
      g.save();
      g.translate(b.x + tx + 30, b.y + ty + 15);
      g.rotate(a);
      g.fillStyle = '#060102';
      const s = b.s;
      g.fillRect(-1 * s, -8 * s, 2 * s, 6 * s);
      g.beginPath();
      g.moveTo(-4 * s, -3 * s);
      g.quadraticCurveTo(-5 * s, 8 * s, -9 * s, 14 * s);
      g.lineTo(9 * s, 14 * s);
      g.quadraticCurveTo(5 * s, 8 * s, 4 * s, -3 * s);
      g.quadraticCurveTo(0, -6 * s, -4 * s, -3 * s);
      g.fill();
      g.restore();
    }
    // Lit windows flicker like candles.
    g.globalCompositeOperation = 'lighter';
    for (const l of this.lit) {
      const k = 0.55 + 0.25 * Math.sin(t * 2.3 + l.phase) + 0.2 * Math.sin(t * 7.1 + l.phase * 3);
      g.fillStyle = `rgba(${Math.round(200 + 55 * l.warm)},${Math.round(90 + 40 * l.warm)},40,${(0.35 + k * 0.4) * l.warm})`;
      const x = l.x + tx + 30;
      const y = l.y + ty + 15;
      if (!l.arch) {
        g.fillRect(x, y, l.w, l.h);
        continue;
      }
      // Candlelight through a tall window: brighter low down, split by a mullion.
      const shade = g.createLinearGradient(0, y, 0, y + l.h);
      shade.addColorStop(0, 'rgba(0,0,0,0)');
      shade.addColorStop(1, g.fillStyle as string);
      g.fillStyle = shade;
      g.beginPath();
      g.moveTo(x, y + l.h);
      g.lineTo(x, y + l.w * 0.6);
      g.quadraticCurveTo(x, y, x + l.w / 2, y);
      g.quadraticCurveTo(x + l.w, y, x + l.w, y + l.w * 0.6);
      g.lineTo(x + l.w, y + l.h);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#040001';
      g.fillRect(x + l.w / 2 - l.w * 0.08, y + l.w * 0.3, l.w * 0.16, l.h - l.w * 0.3);
      g.fillRect(x, y + l.h * 0.55, l.w, l.w * 0.12);
      g.globalCompositeOperation = 'lighter';
    }
    g.globalCompositeOperation = 'source-over';

    // Ground fog in three bands, the nearest fastest.
    const fogBand = (img: Layer, y: number, hh: number, speed: number, alpha: number) => {
      const ww = w * 1.4;
      const off = -((t * speed) % ww);
      g.globalAlpha = alpha;
      for (let x = off; x < w; x += ww) g.drawImage(img, x, y, ww, hh);
      g.globalAlpha = 1;
    };
    fogBand(this.fog[0], base - h * 0.09, h * 0.2, 9, 0.75);
    fogBand(this.fog[1], base + h * 0.02, h * 0.22, 15, 0.7);

    // Foreground silhouettes and the hanged man turning on his rope.
    const [fx, fy] = par(1);
    g.drawImage(this.fore, fx, fy, this.fore.width / this.dpr, this.fore.height / this.dpr);
    {
      const p = this.gallows;
      const s = p.s;
      const a = Math.sin(t * 0.9) * 0.07;
      g.save();
      g.translate(p.x + fx + 30, p.y + fy + 15);
      g.rotate(a);
      g.strokeStyle = '#030001';
      g.fillStyle = '#030001';
      g.lineWidth = 1.5 * s;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, 30 * s);
      g.stroke();
      g.beginPath();
      g.arc(0, 35 * s, 5 * s, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(-6 * s, 40 * s);
      g.lineTo(6 * s, 40 * s);
      g.lineTo(5 * s, 72 * s);
      g.lineTo(-5 * s, 72 * s);
      g.fill();
      g.fillRect(-5 * s, 72 * s, 4 * s, 26 * s);
      g.fillRect(1 * s, 72 * s, 4 * s, 25 * s);
      g.restore();
    }
    fogBand(this.fog[2], h * 0.8, h * 0.26, 24, 0.55);

    // Embers rising on the warm air.
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.embers.length; i++) {
      const e = this.embers[i];
      e.life += dt;
      e.y -= e.vy * dt;
      const x = e.x + Math.sin(t * 0.8 + e.sway) * 18;
      const k = Math.sin((e.life / e.max) * Math.PI) * (0.6 + 0.4 * Math.sin(t * 9 + e.sway * 5));
      if (e.life > e.max || e.y < -10) {
        this.embers[i] = this.ember();
        continue;
      }
      const r = e.size * 3;
      const eg = g.createRadialGradient(x, e.y, 0, x, e.y, r);
      eg.addColorStop(0, `rgba(255,190,110,${0.9 * k})`);
      eg.addColorStop(0.35, `rgba(240,90,30,${0.45 * k})`);
      eg.addColorStop(1, 'rgba(160,30,10,0)');
      g.fillStyle = eg;
      g.fillRect(x - r, e.y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';

    // Vignette.
    const v = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.72)');
    g.fillStyle = v;
    g.fillRect(0, 0, w, h);
  }
}
