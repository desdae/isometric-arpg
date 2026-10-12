// Loading splash: a full-screen card with a title, a progress bar and a line
// naming the step under way. World builders report steps as they go; while
// the splash is up each report waits for a painted frame, so the bar really
// moves between the heavy synchronous chunks of generation. When the splash
// is down (an area being built in the background) reports only yield briefly.

const CSS = `
  .splash { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 0 16px;
    background: radial-gradient(ellipse at 50% 45%, #2a0907 0%, #120403 45%, #050101 100%);
    color: #e6d6c0; font-family: 'EB Garamond', Georgia, serif; opacity: 1; transition: opacity .6s ease; }
  .splash.out { opacity: 0; pointer-events: none; }
  .splash-inner { width: min(520px, 100%); text-align: center; }
  .splash-sigil { width: 76px; height: 76px; margin: 0 auto 18px; opacity: .8; animation: splash-turn 24s linear infinite; }
  @keyframes splash-turn { to { transform: rotate(360deg); } }
  .splash h1 { margin: 0; font: 600 clamp(26px, 6vw, 40px)/1.15 'Cinzel', Georgia, serif; letter-spacing: .14em; color: #e8c8a0;
    text-shadow: 0 2px 12px #000, 0 0 34px rgba(170,30,20,.45); text-wrap: balance; }
  .splash-sub { margin: 8px 0 30px; font-style: italic; font-size: 17px; color: #a88a78; }
  .splash-bar { position: relative; height: 10px; border: 1px solid #5a2a20; background: #0c0404;
    box-shadow: inset 0 0 8px #000, 0 0 0 4px rgba(10,4,3,.8), 0 0 0 5px #3a1c14; }
  .splash-fill { position: absolute; inset: 0 auto 0 0; width: 0; background: linear-gradient(90deg, #5a0806, #b0201a 70%, #e8603a);
    box-shadow: 0 0 14px rgba(220,60,30,.6); transition: width .25s ease-out; }
  .splash-row { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px; font-size: 15px; color: #b89a88; }
  .splash-step { font-style: italic; text-align: left; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .splash-pct { font: 600 13px/1.6 'Cinzel', Georgia, serif; color: #c8a878; font-variant-numeric: tabular-nums; }
`;

const SIGIL = `<svg class="splash-sigil" viewBox="0 0 100 100" fill="none" stroke="#b0281c" stroke-width="2">
  <circle cx="50" cy="50" r="46"/><circle cx="50" cy="50" r="40" stroke-width="1"/>
  <path d="M50 12 L72 80 L14 37 H86 L28 80 Z" stroke-linejoin="round"/>
  <circle cx="50" cy="50" r="6" fill="#b0281c"/></svg>`;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

class Loading {
  private root: HTMLDivElement | null = null;
  private fill!: HTMLDivElement;
  private stepEl!: HTMLDivElement;
  private pctEl!: HTMLDivElement;
  private titleEl!: HTMLHeadingElement;
  private subEl!: HTMLParagraphElement;
  private lo = 0;
  private hi = 1;
  private shown = 0;
  private ceiling = 0;
  private creep: ReturnType<typeof setInterval> | undefined;
  active = false;

  /** How full the bar is now, 0..1. */
  get progress() {
    return this.shown;
  }

  private build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.className = 'splash out';
    root.setAttribute('role', 'progressbar');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', '100');
    root.innerHTML = `<div class="splash-inner">${SIGIL}<h1></h1><p class="splash-sub"></p>
      <div class="splash-bar"><div class="splash-fill"></div></div>
      <div class="splash-row"><div class="splash-step"></div><div class="splash-pct">0%</div></div></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.fill = root.querySelector('.splash-fill')!;
    this.stepEl = root.querySelector('.splash-step')!;
    this.pctEl = root.querySelector('.splash-pct')!;
    this.titleEl = root.querySelector('h1')!;
    this.subEl = root.querySelector('.splash-sub')!;
  }

  /** Raises the splash at 0%. */
  async show(title: string, subtitle: string) {
    if (!this.root) this.build();
    document.getElementById('boot')?.remove();
    this.titleEl.textContent = title;
    this.subEl.textContent = subtitle;
    this.shown = 0;
    this.lo = 0;
    this.hi = 1;
    this.set(0, '');
    this.root!.classList.remove('out');
    this.active = true;
    this.ceiling = 0;
    clearInterval(this.creep);
    this.creep = setInterval(() => {
      if (this.ceiling > this.shown + 0.002) this.set(this.shown + (this.ceiling - this.shown) * 0.04, '');
    }, 120);
    await nextFrame();
  }

  /** The share of the bar the next steps fill (their 0..1 maps onto lo..hi). */
  range(lo: number, hi: number) {
    this.lo = lo;
    this.hi = hi;
  }

  /** Reports a step; `f` is how far through the current range it starts. */
  async step(text: string, f: number) {
    if (!this.active) return tick();
    this.set(this.lo + (this.hi - this.lo) * f, text);
    // Long waits (texture baking in a worker, shader compiles) give no
    // progress of their own, so the bar creeps on toward the next step.
    this.ceiling = Math.min(this.hi, this.lo + (this.hi - this.lo) * (f + 0.2));
    if (location.search.includes('debug')) console.log('SIM step', (performance.now() / 1000).toFixed(1), Math.round(this.shown * 100), text);
    await nextFrame();
  }

  private set(v: number, text: string) {
    this.shown = Math.max(this.shown, Math.min(1, v));
    const pct = Math.round(this.shown * 100);
    this.fill.style.width = `${pct}%`;
    this.pctEl.textContent = `${pct}%`;
    this.root!.setAttribute('aria-valuenow', String(pct));
    if (text) this.stepEl.textContent = text;
  }

  /** Fills the bar and fades the splash away. */
  async hide() {
    if (!this.active) return;
    this.set(1, 'Ready');
    await nextFrame();
    this.active = false;
    clearInterval(this.creep);
    this.root!.classList.add('out');
    await new Promise((r) => setTimeout(r, 600));
  }
}

export const loading = new Loading();
