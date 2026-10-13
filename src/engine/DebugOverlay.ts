import * as THREE from 'three';
import type { Renderer } from './Renderer';

// F3 performance overlay: FPS and frame-time graphs (with the update / render
// / GPU split), what the renderer drew this frame, what the scene holds, and
// memory. Timing runs every frame (it is cheap); the panel only redraws while
// it is open.

const CSS = `
  .dbg { position: fixed; left: 8px; top: calc(8px + env(safe-area-inset-top, 0px)); z-index: 30; pointer-events: none;
    width: 300px; max-width: calc(100vw - 16px); padding: 8px 10px 9px; background: rgba(6,8,10,.82); border: 1px solid rgba(120,160,190,.35);
    font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #cfe0ea; font-variant-numeric: tabular-nums; }
  .dbg canvas { display: block; width: 100%; height: 56px; margin: 3px 0 2px; background: rgba(0,0,0,.45); }
  .dbg .hd { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: #fff; font-weight: 700; font-size: 13px; }
  .dbg .hd small { font-weight: 400; font-size: 11px; color: #9fb4c0; white-space: nowrap; }
  .dbg-on .help { visibility: hidden; }
  .dbg .lg { color: #7d93a0; display: flex; gap: 8px; flex-wrap: wrap; }
  .dbg .lg i { display: inline-block; width: 8px; height: 8px; margin-right: 3px; vertical-align: -1px; }
  .dbg dl { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; margin: 6px 0 0; }
  .dbg dt { color: #7d93a0; }
  .dbg dd { margin: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dbg h5 { margin: 7px 0 0; font: 700 10px/1 ui-monospace, Menlo, monospace; letter-spacing: .12em; color: #8fb8d0; text-transform: uppercase;
    border-top: 1px solid rgba(120,160,190,.2); padding-top: 5px; grid-column: 1 / -1; }
  .dbg .warn { color: #ffb060; }
  .dbg .bad { color: #ff6a5a; }
`;

const N = 240;

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

export type DebugRows = [section: string, rows: [string, string][]][];

export class DebugOverlay {
  private el: HTMLDivElement;
  private body: HTMLDivElement;
  private head: HTMLDivElement;
  private fpsCanvas: HTMLCanvasElement;
  private msCanvas: HTMLCanvasElement;
  // Ring buffers, one entry per frame (ms) or per FPS sample.
  private frameMs = new Float32Array(N);
  private updMs = new Float32Array(N);
  private renMs = new Float32Array(N);
  private gpuMs = new Float32Array(N).fill(-1);
  private fpsHist = new Float32Array(N);
  private i = 0;
  private fi = 0;
  private last = performance.now();
  private t0 = 0;
  private tUpd = 0;
  private sampleT = 0;
  private sampleN = 0;
  private fps = 0;
  private draw = { calls: 0, tris: 0, lines: 0, points: 0 };
  private mainPass = { calls: 0, tris: 0 };
  private redrawT = 0;
  private sceneT = 0;
  private sceneStats: [string, string][] = [];
  private gl: WebGL2RenderingContext;
  private timer: TimerExt | null;
  private queries: { q: WebGLQuery; slot: number }[] = [];
  private openQuery: WebGLQuery | null = null;

  constructor(
    private r: Renderer,
    private extra: () => DebugRows = () => [],
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'dbg';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="hd"></div><canvas data-c="fps"></canvas><div class="lg"><span><i style="background:#6fe08a"></i>FPS (60 line)</span><span>${N / 4}s</span></div><canvas data-c="ms"></canvas><div class="lg"><span><i style="background:#4fb4ff"></i>update</span><span><i style="background:#ffa040"></i>render CPU</span><span><i style="background:#c080ff"></i>GPU</span><span><i style="background:#56636b"></i>frame</span></div><div class="body"></div>`;
    document.body.appendChild(this.el);
    this.head = this.el.querySelector('.hd')!;
    this.body = this.el.querySelector('.body')!;
    this.fpsCanvas = this.el.querySelector('[data-c="fps"]')!;
    this.msCanvas = this.el.querySelector('[data-c="ms"]')!;
    for (const c of [this.fpsCanvas, this.msCanvas]) {
      c.width = N * 2;
      c.height = 112;
    }
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'F3') return;
      e.preventDefault();
      this.toggle();
    });
    // Count everything drawn in a frame (shadows, every post pass), not just the last render call.
    r.renderer.info.autoReset = false;
    this.gl = r.renderer.getContext() as WebGL2RenderingContext;
    this.timer = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    // Measure the main scene pass on its own too.
    const pass = r.composer.passes[0];
    const render = pass.render.bind(pass);
    pass.render = (...args: Parameters<typeof render>) => {
      const info = r.renderer.info.render;
      const c0 = info.calls;
      const t0 = info.triangles;
      render(...args);
      this.mainPass.calls = info.calls - c0;
      this.mainPass.tris = info.triangles - t0;
    };
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(on = !this.open) {
    this.el.hidden = !on;
    document.body.classList.toggle('dbg-on', on);
  }

  /** Call at the start of a frame, before game logic. */
  begin() {
    const now = performance.now();
    this.frameMs[this.i] = now - this.last;
    this.last = now;
    this.t0 = now;
    this.r.renderer.info.reset();
  }

  /** Game logic done; rendering starts. */
  updated() {
    this.tUpd = performance.now();
    this.updMs[this.i] = this.tUpd - this.t0;
    this.pollGpu();
    if (this.timer && !this.openQuery && this.queries.length < 4) {
      const q = this.gl.createQuery()!;
      this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, q);
      this.openQuery = q;
      this.queries.push({ q, slot: this.i });
    }
  }

  /** Rendering submitted; `scene` is what was drawn (for the object census). */
  end(scene: THREE.Scene, dt: number) {
    if (this.openQuery && this.timer) {
      this.gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.openQuery = null;
    }
    this.renMs[this.i] = performance.now() - this.tUpd;
    const info = this.r.renderer.info.render;
    this.draw = { calls: info.calls, tris: info.triangles, lines: info.lines, points: info.points };
    this.i = (this.i + 1) % N;
    this.gpuMs[this.i] = -1;
    this.sampleT += dt;
    this.sampleN++;
    if (this.sampleT >= 0.25) {
      this.fps = this.sampleN / this.sampleT;
      this.fpsHist[this.fi] = this.fps;
      this.fi = (this.fi + 1) % N;
      this.sampleT = 0;
      this.sampleN = 0;
    }
    if (!this.open) return;
    const now = performance.now();
    if (now - this.sceneT > 1000) {
      this.sceneT = now;
      this.sceneStats = census(scene);
    }
    if (now - this.redrawT > 200) {
      this.redrawT = now;
      this.redraw();
    }
  }

  private pollGpu() {
    const gl = this.gl;
    const ext = this.timer;
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.queries.length) {
      const { q, slot } = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) this.gpuMs[slot] = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(q);
      this.queries.shift();
    }
  }

  private redraw() {
    // Frame time stats over the window.
    const ms = Array.from(this.frameMs).filter((v) => v > 0);
    const sorted = [...ms].sort((a, b) => b - a);
    const avg = ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length);
    const low1 = sorted[Math.floor(sorted.length * 0.01)] ?? 0;
    const worst = sorted[0] ?? 0;
    const mean = (a: Float32Array) => {
      let s = 0;
      let n = 0;
      for (const v of a) if (v >= 0) (s += v), n++;
      return n ? s / n : -1;
    };
    const gpu = mean(this.gpuMs);
    const fpsCls = this.fps < 30 ? 'bad' : this.fps < 55 ? 'warn' : '';
    this.head.innerHTML = `<span class="${fpsCls}">${this.fps.toFixed(0)} FPS</span><small>${avg.toFixed(1)} ms avg · 1% low ${low1.toFixed(0)} · max ${worst.toFixed(0)}</small>`;
    this.graphFps();
    this.graphMs();

    const ri = this.r.renderer.info;
    const size = this.r.renderer.getDrawingBufferSize(new THREE.Vector2());
    const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    const sections: DebugRows = [
      [
        'Timing (avg ms)',
        [
          ['update', mean(this.updMs).toFixed(2)],
          ['render CPU', mean(this.renMs).toFixed(2)],
          ['GPU', gpu >= 0 ? gpu.toFixed(2) : this.timer ? '…' : 'n/a'],
        ],
      ],
      [
        'Renderer (this frame)',
        [
          ['draw calls', `${this.draw.calls} (scene ${this.mainPass.calls})`],
          ['triangles', `${k(this.draw.tris)} (scene ${k(this.mainPass.tris)})`],
          ['lines / points', `${k(this.draw.lines)} / ${k(this.draw.points)}`],
          ['geometries', String(ri.memory.geometries)],
          ['textures', String(ri.memory.textures)],
          ['shader programs', String(ri.programs?.length ?? 0)],
          ['buffer', `${size.x}×${size.y} @${this.r.renderer.getPixelRatio().toFixed(2)}x`],
        ],
      ],
      ['Scene', this.sceneStats],
      ...this.extra(),
    ];
    if (mem) sections.push(['Memory', [['JS heap', `${(mem.usedJSHeapSize / 1048576).toFixed(0)} / ${(mem.totalJSHeapSize / 1048576).toFixed(0)} MB`]]]);
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
    this.body.innerHTML = `<dl>${sections.map(([h, rows]) => `<h5>${esc(h)}</h5>${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}`).join('')}</dl>`;
  }

  private graphFps() {
    const c = this.fpsCanvas;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    g.clearRect(0, 0, W, H);
    const top = Math.max(75, ...this.fpsHist);
    const y = (v: number) => H - (v / top) * (H - 4);
    for (const [v, col] of [[60, 'rgba(111,224,138,.35)'], [30, 'rgba(255,120,90,.35)']] as const) {
      g.fillStyle = col;
      g.fillRect(0, y(v), W, 1);
    }
    g.strokeStyle = '#6fe08a';
    g.lineWidth = 2;
    g.beginPath();
    for (let n = 0; n < N; n++) {
      const v = this.fpsHist[(this.fi + n) % N];
      const x = (n / (N - 1)) * W;
      if (n === 0) g.moveTo(x, y(v));
      else g.lineTo(x, y(v));
    }
    g.stroke();
  }

  private graphMs() {
    const c = this.msCanvas;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    g.clearRect(0, 0, W, H);
    const top = 50;
    const y = (v: number) => H - (Math.min(v, top) / top) * H;
    const bw = W / N;
    for (let n = 0; n < N; n++) {
      const s = (this.i + n) % N;
      const x = n * bw;
      g.fillStyle = '#56636b';
      g.fillRect(x, y(this.frameMs[s]), bw, H - y(this.frameMs[s]));
      const u = this.updMs[s];
      const r = this.renMs[s];
      g.fillStyle = '#4fb4ff';
      g.fillRect(x, y(u), bw, H - y(u));
      g.fillStyle = '#ffa040';
      g.fillRect(x, y(u + r), bw, y(u) - y(u + r));
      const gp = this.gpuMs[s];
      if (gp >= 0) {
        g.fillStyle = '#c080ff';
        g.fillRect(x, y(gp) - 1, bw, 2);
      }
    }
    g.font = '18px ui-monospace, monospace';
    for (const [v, label] of [[16.7, '16.7ms'], [33.3, '33ms']] as const) {
      g.fillStyle = 'rgba(255,255,255,.3)';
      g.fillRect(0, y(v), W, 1);
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.fillText(label, 4, y(v) - 4);
    }
  }
}

/** Counts what the scene holds: objects, visible meshes, instances, lights. */
function census(scene: THREE.Scene): [string, string][] {
  let objects = 0;
  let meshes = 0;
  let visible = 0;
  let instanced = 0;
  let instances = 0;
  let lights = 0;
  let litOn = 0;
  let shadowLights = 0;
  let casters = 0;
  scene.traverse((o) => {
    objects++;
    if ((o as THREE.Light).isLight) {
      lights++;
      const l = o as THREE.Light;
      if (l.visible && l.intensity > 0) litOn++;
      if (l.castShadow) shadowLights++;
    }
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      meshes++;
      if (m.castShadow) casters++;
      if ((m as THREE.InstancedMesh).isInstancedMesh) {
        instanced++;
        instances += (m as THREE.InstancedMesh).count;
      }
    }
  });
  scene.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) visible++;
  });
  return [
    ['objects', String(objects)],
    ['meshes (visible)', `${meshes} (${visible})`],
    ['instanced meshes', `${instanced} · ${instances} instances`],
    ['shadow casters', String(casters)],
    ['lights (lit / shadow)', `${lights} (${litOn} / ${shadowLights})`],
  ];
}
