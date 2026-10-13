import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Renderer } from './Renderer';

// A repeatable 30 second run through the Blighted Fields: same world seed,
// same route, hero untouchable, so runs can be compared. Started with #bench
// (or ?bench). Switches go after it: #bench-noao-noshadows-nobloom-nomsaa-res75.

const WARMUP = 3;
const LENGTH = 30;
/** Route through the fields from the gate: road, grass, crater pools, back. */
const ROUTE: [number, number][] = [
  [-12, 0],
  [12, 18],
  [36, 6],
  [52, -24],
  [30, -46],
  [4, -30],
  [-20, -12],
];

export const FLAGS = ['noao', 'noshadows', 'nobloom', 'nomsaa', 'res75', 'res50'] as const;
type Flag = (typeof FLAGS)[number];

/** The benchmark's switches, or null when this is not a benchmark run. */
export function benchFlags(params: URLSearchParams): Set<Flag> | null {
  const h = location.hash.slice(1);
  const spec = h === 'bench' || h.startsWith('bench-') ? h : params.has('bench') ? `bench-${params.get('bench')}` : null;
  if (spec === null) return null;
  return new Set(spec.split('-').filter((f): f is Flag => (FLAGS as readonly string[]).includes(f)));
}

const CSS = `
  .bench-bar { position: fixed; top: calc(12px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); z-index: 40; pointer-events: none;
    font: 13px/1.3 ui-monospace, Menlo, Consolas, monospace; color: #e8d8c8; background: rgba(10,5,5,.82); border: 1px solid #5a2a20; padding: 6px 12px; }
  .bench-res { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 41; width: min(560px, calc(100vw - 32px)); pointer-events: auto;
    font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; color: #e8d8c8; background: rgba(14,7,6,.97); border: 1px solid #6a3424; padding: 16px; box-shadow: 0 14px 40px rgba(0,0,0,.7); }
  .bench-res h3 { margin: 0 0 8px; font: 600 16px/1.2 'Cinzel', Georgia, serif; letter-spacing: .08em; color: #e8b070; }
  .bench-res .big { display: flex; gap: 18px; flex-wrap: wrap; margin: 4px 0 10px; }
  .bench-res .big b { display: block; font-size: 24px; color: #f0d070; font-variant-numeric: tabular-nums; }
  .bench-res textarea { width: 100%; box-sizing: border-box; height: 170px; resize: vertical; font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; color: #cfc0b0; background: #0a0505; border: 1px solid #3a2418; padding: 6px; }
  .bench-res .row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .bench-res button { font: 12px/1 ui-monospace, Menlo, Consolas, monospace; color: #e8d0b0; background: #2a1210; border: 1px solid #6a3424; padding: 6px 8px; cursor: pointer; }
  .bench-res button:hover { border-color: #c08050; }
  .bench-res .note { color: #8a7060; font-size: 12px; margin-top: 8px; }
`;

export class Benchmark {
  private t = 0;
  private leg = 0;
  private legTime = 0;
  private frames: number[] = [];
  private update: number[] = [];
  private render: number[] = [];
  private bar: HTMLDivElement;
  private done = false;

  constructor(
    private flags: Set<Flag>,
    private game: Game,
    private r: Renderer,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.bar = document.createElement('div');
    this.bar.className = 'bench-bar';
    document.body.appendChild(this.bar);
    document.querySelector<HTMLElement>('.help')?.style.setProperty('display', 'none');
    const p = game.player;
    p.takeDamage = () => 0;
    game.preload = false;
    // Switches apply before the first frame, so shaders compile only once.
    if (flags.has('noao')) r.ao.enabled = false;
    if (flags.has('nobloom')) r.bloom.enabled = false;
    if (flags.has('noshadows')) r.renderer.shadowMap.enabled = false;
    if (flags.has('nomsaa')) for (const t of [r.composer.renderTarget1, r.composer.renderTarget2]) t.samples = 0;
    const scale = flags.has('res50') ? 0.5 : flags.has('res75') ? 0.75 : 1;
    if (scale !== 1) {
      const pr = r.renderer.getPixelRatio() * scale;
      r.renderer.setPixelRatio(pr);
      r.composer.setPixelRatio(pr);
    }
  }

  /** Call once per frame with the real frame interval and the CPU time spent updating and submitting the render. */
  frame(dt: number, updateMs: number, renderMs: number) {
    if (this.done) return;
    this.t += dt;
    const p = this.game.player;
    if (this.t < WARMUP) {
      this.bar.textContent = `Benchmark: warming up… ${Math.ceil(WARMUP - this.t)}`;
      return;
    }
    // Walk the route; a waypoint the hero can't reach is skipped after a while.
    this.legTime += dt;
    const [wx, wz] = ROUTE[this.leg % ROUTE.length];
    if (this.legTime === dt || this.legTime > 9 || Math.hypot(p.position.x - wx, p.position.z - wz) < 2) {
      if (this.legTime !== dt) this.leg++;
      this.legTime = dt;
      const [nx, nz] = ROUTE[this.leg % ROUTE.length];
      p.moveTo(new THREE.Vector3(nx, 0, nz), false);
    }
    this.frames.push(dt * 1000);
    this.update.push(updateMs);
    this.render.push(renderMs);
    const left = WARMUP + LENGTH - this.t;
    this.bar.textContent = `Benchmark running · ${Math.ceil(left)} s left · don't touch the mouse`;
    if (left <= 0) this.finish();
  }

  private finish() {
    this.done = true;
    this.bar.remove();
    this.game.preload = true;
    const n = this.frames.length;
    const total = this.frames.reduce((a, b) => a + b, 0);
    const sorted = [...this.frames].sort((a, b) => a - b);
    const pct = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const fps = (n / total) * 1000;
    const low1 = 1000 / pct(0.99);
    const upd = mean(this.update);
    const ren = mean(this.render);
    const cpu = this.update.map((u, i) => u + this.render[i]).sort((a, b) => a - b);
    const gl = this.r.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const size = this.r.renderer.getDrawingBufferSize(new THREE.Vector2());
    const a = this.game.area;
    const flags = [...this.flags].join(' ') || 'none';
    const lines = [
      `Benchmark · Blighted Fields · ${LENGTH} s`,
      `switches off/changed: ${flags}`,
      `avg FPS ${fps.toFixed(1)} · 1% low ${low1.toFixed(1)} · frames ${n}`,
      `frame ms: avg ${(total / n).toFixed(2)} · median ${pct(0.5).toFixed(2)} · p95 ${pct(0.95).toFixed(2)} · p99 ${pct(0.99).toFixed(2)} · max ${sorted[n - 1].toFixed(2)}`,
      `CPU ms per frame: update ${upd.toFixed(2)} · render submit ${ren.toFixed(2)} · total p95 ${cpu[Math.floor(0.95 * cpu.length)].toFixed(2)}`,
      `GPU-bound share: ${Math.max(0, 100 - ((upd + ren) / (total / n)) * 100).toFixed(0)}% of the frame is spent waiting (GPU or vsync)`,
      `buffer ${size.x}×${size.y} @ dpr ${devicePixelRatio} · ${gpu}`,
      `monsters awake at end: ${a ? a.monsters.filter((m) => m.alive && m.awake).length : 0}`,
      `browser: ${navigator.userAgent}`,
    ];
    const el = document.createElement('div');
    el.className = 'bench-res';
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.innerHTML = `<h3>Benchmark result</h3>
      <div class="big"><span><b>${fps.toFixed(0)}</b>avg FPS</span><span><b>${low1.toFixed(0)}</b>1% low</span><span><b>${(total / n).toFixed(2)}</b>ms / frame</span><span><b>${(upd + ren).toFixed(2)}</b>CPU ms</span></div>
      <textarea readonly></textarea>
      <div class="row"><button data-copy>Copy result</button><button data-run="">Run again</button><button data-run="noao">Without AO</button><button data-run="noshadows">Without shadows</button><button data-run="noao-noshadows">Without both</button><button data-close>Close</button></div>
      <p class="note">Firefox caps FPS at the monitor refresh rate; set layout.frame_rate to 0 in about:config to see the real figure. CPU ms is not capped.</p>`;
    const ta = el.querySelector('textarea')!;
    ta.value = lines.join('\n');
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset.copy !== undefined) {
        navigator.clipboard.writeText(ta.value).then(
          () => (t.textContent = 'Copied'),
          () => ta.select(),
        );
      } else if (t.dataset.run !== undefined) {
        location.hash = t.dataset.run ? `bench-${t.dataset.run}` : 'bench';
        location.reload();
      } else if (t.dataset.close !== undefined) el.remove();
    });
    document.body.appendChild(el);
    console.log(lines.join('\n'));
    (window as unknown as { __bench: string }).__bench = lines.join('\n');
  }
}
