import { audio } from '../audio/Audio';
import { ACTIONS, RESERVED, settings, type Action, type Quality, type SettingsData } from './Settings';

// The options window: sound levels, graphics quality, key bindings and a few
// comfort settings. Opened from the pause menu and the hero roster. Every
// change applies at once and is remembered in this browser.

const CSS = `
  .opts { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px));
    background: rgba(5,1,1,.72); color: #e6d6c0; font: 16px/1.45 'EB Garamond', Georgia, serif; }
  .opts-box { position: relative; width: min(660px, 100%); max-height: 100%; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; overflow: hidden;
    background: linear-gradient(180deg, rgba(26,12,10,.985), rgba(10,5,5,.985)); border: 1px solid #5a2a20;
    box-shadow: 0 0 0 1px #1a0a08, inset 0 0 0 1px rgba(200,110,60,.06), 0 18px 50px rgba(0,0,0,.75); }
  .opts-box::before, .opts-box::after { content: ''; position: absolute; width: 14px; height: 14px; border: 1px solid #a0502c; pointer-events: none; }
  .opts-box::before { left: 6px; top: 6px; border-right: 0; border-bottom: 0; }
  .opts-box::after { right: 6px; bottom: 6px; border-left: 0; border-top: 0; }
  .opts-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 22px 10px; }
  .opts h3 { margin: 0; font: 600 20px/1.2 'Cinzel', Georgia, serif; letter-spacing: .14em; color: #e8b070; text-shadow: 0 0 18px rgba(200,80,30,.3); }
  .opts-x { width: 34px; height: 34px; display: grid; place-items: center; font: 20px/1 Georgia, serif; color: #b89a78; background: none; border: 1px solid transparent; cursor: pointer; }
  .opts-x:hover { color: #f0d0a8; border-color: #6a3424; }
  .opts-tabs { display: flex; gap: 2px; padding: 0 22px; border-bottom: 1px solid #3a1a14; overflow-x: auto; scrollbar-width: none; }
  .opts-tab { flex: none; padding: 10px 14px 9px; font: 600 12px/1 'Cinzel', Georgia, serif; letter-spacing: .12em; text-transform: uppercase; color: #8a7060;
    background: none; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; }
  .opts-tab:hover { color: #d8b890; }
  .opts-tab.on { color: #f0c890; border-bottom-color: #c0603a; }
  .opts-body { overflow-y: auto; padding: 8px 22px 6px; overscroll-behavior: contain; }
  .opts-sec { margin: 14px 0 4px; font: 600 11px/1 'Cinzel', Georgia, serif; letter-spacing: .14em; text-transform: uppercase; color: #a07050; }
  .opts-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 16px; min-height: 46px; padding: 6px 0; border-bottom: 1px solid rgba(90,42,32,.35); }
  .opts-row:last-child { border-bottom: 0; }
  .opts-name { min-width: 0; }
  .opts-name b { display: block; font-weight: 500; color: #e8d6bc; }
  .opts-name span { display: block; font-size: 14px; line-height: 1.3; color: #8f7666; font-style: italic; }
  .opts-ctl { display: flex; align-items: center; gap: 10px; justify-self: end; }
  .opts-seg { display: inline-flex; border: 1px solid #5a2a20; }
  .opts-seg button { padding: 8px 12px; font: 600 12px/1 'Cinzel', Georgia, serif; letter-spacing: .08em; color: #a08878; background: #140807; border: 0; border-left: 1px solid #3a1a14; cursor: pointer; }
  .opts-seg button:first-child { border-left: 0; }
  .opts-seg button:hover { color: #e8d0b0; }
  .opts-seg button.on { color: #fff0dc; background: linear-gradient(180deg, #7a1c12, #4e0c08); box-shadow: inset 0 0 0 1px rgba(240,140,80,.35); }
  .opts-sw { position: relative; width: 46px; height: 24px; flex: none; background: #140807; border: 1px solid #5a2a20; cursor: pointer; padding: 0; }
  .opts-sw::after { content: ''; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; background: #5a4038; transition: transform .15s, background .15s; }
  .opts-sw.on { background: #3a0e0a; border-color: #c0603a; }
  .opts-sw.on::after { transform: translateX(22px); background: #f0a060; box-shadow: 0 0 8px rgba(240,140,70,.6); }
  .opts-range { display: flex; align-items: center; gap: 10px; }
  .opts-range output { width: 42px; text-align: right; font: 600 13px/1 'Cinzel', Georgia, serif; color: #d8b890; font-variant-numeric: tabular-nums; }
  .opts input[type=range] { -webkit-appearance: none; appearance: none; width: clamp(120px, 28vw, 200px); height: 22px; margin: 0; background: none; cursor: pointer; --p: 50%; }
  .opts input[type=range]::-webkit-slider-runnable-track { height: 4px; background: linear-gradient(90deg, #c0603a var(--p), #2a1410 var(--p)); border: 1px solid #4a2018; }
  .opts input[type=range]::-moz-range-track { height: 4px; background: linear-gradient(90deg, #c0603a var(--p), #2a1410 var(--p)); border: 1px solid #4a2018; }
  .opts input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 20px; margin-top: -9px; background: #e8c090; border: 1px solid #5a2a20; transform: rotate(45deg) scale(.75); box-shadow: 0 0 8px rgba(240,140,70,.5); }
  .opts input[type=range]::-moz-range-thumb { width: 10px; height: 16px; background: #e8c090; border: 1px solid #5a2a20; border-radius: 0; box-shadow: 0 0 8px rgba(240,140,70,.5); }
  .opts-keys { display: grid; grid-template-columns: minmax(0, 1fr) 96px 96px; gap: 4px 8px; align-items: center; }
  .opts-keys .h { font: 600 10px/1 'Cinzel', Georgia, serif; letter-spacing: .14em; text-transform: uppercase; color: #7a6050; padding: 8px 0 4px; text-align: center; }
  .opts-keys .h:first-child { text-align: left; }
  .opts-keys .a { min-width: 0; padding: 4px 0; color: #e0ccb2; overflow-wrap: anywhere; }
  .opts-key { height: 34px; padding: 0 8px; font: 500 16px/1 'EB Garamond', Georgia, serif; font-variant-numeric: lining-nums; letter-spacing: .02em; color: #f0d8b8; cursor: pointer;
    background: linear-gradient(180deg, #2a1410, #160807); border: 1px solid #5a2a20; border-bottom-width: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .opts-key:hover { border-color: #c0703a; }
  .opts-key.none { color: #5a4840; font-weight: 400; font-style: italic; font-family: 'EB Garamond', Georgia, serif; }
  .opts-key.wait { color: #fff0dc; border-color: #f0a060; background: #4e0c08; animation: optsPulse 1s ease-in-out infinite; }
  @keyframes optsPulse { 50% { box-shadow: 0 0 12px rgba(240,140,70,.55); } }
  .opts-fixed { margin-top: 10px; font-size: 14px; color: #8f7666; }
  .opts-fixed b { color: #c8a878; font-weight: 500; }
  .opts-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 22px 18px; border-top: 1px solid #3a1a14; }
  .opts-note { flex: 1 1 220px; min-height: 20px; font-size: 14px; font-style: italic; color: #b89070; }
  .opts-btn { font: 600 13px/1 'Cinzel', Georgia, serif; letter-spacing: .1em; color: #e8d0b0; background: #2a1210; border: 1px solid #6a3424; padding: 11px 16px; cursor: pointer; }
  .opts-btn:hover { border-color: #c0703a; }
  .opts-btn.primary { color: #fff0dc; background: linear-gradient(180deg, #8a1e14, #5a0c08); border-color: #d0603a; }
  @media (max-width: 520px) {
    .opts-row { grid-template-columns: minmax(0, 1fr); }
    .opts-ctl { justify-self: start; }
    .opts-keys { grid-template-columns: minmax(0, 1fr) 76px 76px; }
  }
`;

type Tab = 'sound' | 'graphics' | 'controls' | 'gameplay';
const TABS: [Tab, string][] = [
  ['sound', 'Sound'],
  ['graphics', 'Graphics'],
  ['controls', 'Controls'],
  ['gameplay', 'Gameplay'],
];
const LABEL: Record<Action, string> = Object.fromEntries(ACTIONS) as Record<Action, string>;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export class Options {
  private el: HTMLDivElement;
  private body: HTMLDivElement;
  private note: HTMLDivElement;
  private tab: Tab = 'sound';
  /** The key button waiting for a key press. */
  private waiting: { action: Action; slot: number } | null = null;
  onClose: () => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'opts';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Options');
    this.el.innerHTML = `<div class="opts-box">
      <div class="opts-head"><h3>Options</h3><button type="button" class="opts-x" data-close aria-label="Close">×</button></div>
      <div class="opts-tabs" role="tablist">${TABS.map(([id, name]) => `<button type="button" role="tab" class="opts-tab" data-tab="${id}">${name}</button>`).join('')}</div>
      <div class="opts-body"></div>
      <div class="opts-foot"><div class="opts-note" aria-live="polite"></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="opts-btn" data-reset>Defaults</button><button type="button" class="opts-btn primary" data-close>Done</button></div></div>
    </div>`;
    this.body = this.el.querySelector('.opts-body')!;
    this.note = this.el.querySelector('.opts-note')!;
    // Clicks inside never reach the game underneath.
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === this.el) this.close();
    });
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    // While open, every key belongs to this window: rebinding listens here,
    // and the game's own shortcuts stay quiet.
    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true });
    document.addEventListener('fullscreenchange', () => this.open && this.render());
    document.body.appendChild(this.el);
    settings.watch(() => this.open && !this.dragging && this.render());
  }

  get open() {
    return !this.el.hidden;
  }

  show(tab?: Tab) {
    if (tab) this.tab = tab;
    this.waiting = null;
    this.note.textContent = '';
    this.el.hidden = false;
    this.render();
  }

  close() {
    if (!this.open) return;
    this.waiting = null;
    this.el.hidden = true;
    this.onClose();
  }

  private say(text: string) {
    this.note.textContent = text;
  }

  // ---- Drawing -------------------------------------------------------------

  private render() {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.opts-tab')) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    const s = settings.data;
    const top = this.body.scrollTop;
    this.body.innerHTML = this.tab === 'sound' ? this.sound(s) : this.tab === 'graphics' ? this.graphics(s) : this.tab === 'controls' ? this.controls(s) : this.gameplay(s);
    this.body.scrollTop = top;
    for (const r of this.body.querySelectorAll<HTMLInputElement>('input[type=range]')) paintRange(r);
  }

  private row(name: string, hint: string, control: string) {
    return `<div class="opts-row"><div class="opts-name"><b>${name}</b>${hint ? `<span>${hint}</span>` : ''}</div><div class="opts-ctl">${control}</div></div>`;
  }

  private range(key: string, value: number, min = 0, shown = pct(value)) {
    return `<div class="opts-range"><input type="range" min="${min}" max="1" step="0.01" value="${value}" data-range="${key}" aria-label="${key}"><output>${shown}</output></div>`;
  }

  private toggle(key: string, on: boolean) {
    return `<button type="button" class="opts-sw${on ? ' on' : ''}" data-toggle="${key}" role="switch" aria-checked="${on}" aria-label="${key}"></button>`;
  }

  private seg(key: string, options: [string, string][], current: string) {
    return `<div class="opts-seg">${options.map(([v, l]) => `<button type="button" data-seg="${key}" data-v="${v}" class="${v === current ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }

  private sound(s: SettingsData) {
    const v = s.volume;
    return `<div class="opts-sec">Volume</div>
      ${this.row('Master', '', this.range('master', v.master))}
      ${this.row('Music', 'The score in town, the fields and the deeps', this.range('music', v.music))}
      ${this.row('Effects', 'Combat, spells, footsteps and the wind', this.range('effects', v.effects))}
      <div class="opts-sec">Output</div>
      ${this.row('Sound', `All sound on or off (${settings.keyOf('mute')})`, this.toggle('sound', !audio.muted))}`;
  }

  private graphics(s: SettingsData) {
    const g = s.graphics;
    const fsOk = !!document.documentElement.requestFullscreen;
    const mist = g.mist <= 0.01 ? '0' : g.mist < 0.5 ? '0.35' : g.mist < 0.85 ? '0.7' : '1';
    return `<div class="opts-sec">Quality</div>
      ${this.row('Preset', g.preset === 'custom' ? 'Custom: changed below' : g.preset === 'low' ? 'For laptops and handhelds' : g.preset === 'medium' ? 'Balanced' : 'Everything on', this.seg('preset', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], g.preset))}
      ${this.row('Ambient occlusion', 'Soft contact shadows in corners and under things; the heaviest effect', this.toggle('ao', g.ao))}
      ${this.row('Bloom', 'Glow around fire, spells and lamps', this.toggle('bloom', g.bloom))}
      ${this.row('Anti-aliasing', 'Smooth edges (4× MSAA)', this.toggle('msaa', g.msaa))}
      ${this.row('Shadows', '', this.seg('shadows', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], g.shadows))}
      ${this.row('Ground mist', 'Drifting fog banks; costly on weak graphics chips', this.seg('mist', [['0', 'Off'], ['0.35', 'Light'], ['0.7', 'Medium'], ['1', 'Full']], mist))}
      <div class="opts-sec">Display</div>
      ${this.row('Sharpness', 'Pixel density on high-resolution screens', this.seg('dpr', [['1', '1×'], ['1.5', '1.5×'], ['2', '2×']], String(g.maxDpr)))}
      ${this.row('Render scale', 'Lower draws fewer pixels for more speed', this.range('scale', g.scale, 0.5))}
      ${fsOk ? this.row('Fullscreen', '', this.toggle('fullscreen', !!document.fullscreenElement)) : ''}`;
  }

  private controls(s: SettingsData) {
    const key = (a: Action, slot: number) => {
      const c = s.keys[a][slot];
      const wait = this.waiting?.action === a && this.waiting.slot === slot;
      const text = wait ? 'Press a key' : c ? settings.label(c) : 'None';
      return `<button type="button" class="opts-key${wait ? ' wait' : c ? '' : ' none'}" data-bind="${a}" data-slot="${slot}" title="${c ? 'Click to change, Delete to clear' : 'Click to set'}">${text}</button>`;
    };
    return `<div class="opts-keys"><div class="h">Action</div><div class="h">Key</div><div class="h">Alternate</div>
      ${ACTIONS.map(([a, name]) => `<div class="a">${name}</div>${key(a, 0)}${key(a, 1)}`).join('')}</div>
      <p class="opts-fixed"><b>Left click</b> move, attack, talk · <b>Right click</b> skill slot 1 · <b>Wheel</b> zoom · <b>Esc</b> close or menu</p>`;
  }

  private gameplay(s: SettingsData) {
    return `<div class="opts-sec">Comfort</div>
      ${this.row('Screen shake', 'From heavy blows, slams and boss attacks', this.range('shake', s.shake, 0, s.shake <= 0.001 ? 'Off' : pct(s.shake)))}
      ${this.row('Frame rate', 'Show frames per second in the corner', this.toggle('fps', s.showFps))}`;
  }

  // ---- Input ---------------------------------------------------------------

  private dragging = false;

  private onInput(e: Event) {
    const r = e.target as HTMLInputElement;
    const key = r.dataset.range;
    if (!key) return;
    const v = Number(r.value);
    paintRange(r);
    // Re-rendering mid-drag would drop the slider out of the pointer's hand.
    this.dragging = true;
    if (key === 'scale') settings.setGraphics('scale', v);
    else
      settings.update((s) => {
        if (key === 'master' || key === 'music' || key === 'effects') s.volume[key] = v;
        if (key === 'shake') s.shake = v;
      });
    this.dragging = false;
    const out = r.parentElement!.querySelector('output')!;
    out.textContent = key === 'shake' && v <= 0.001 ? 'Off' : pct(v);
    if (key === 'effects' || key === 'master') audio.preview();
  }

  private onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) return this.close();
    const tab = t.closest<HTMLElement>('[data-tab]');
    if (tab) {
      this.tab = tab.dataset.tab as Tab;
      this.waiting = null;
      this.say('');
      this.body.scrollTop = 0;
      audio.click();
      return this.render();
    }
    if (t.closest('[data-reset]')) return this.reset();
    const sw = t.closest<HTMLElement>('[data-toggle]');
    if (sw) {
      const k = sw.dataset.toggle!;
      const g = settings.data.graphics;
      if (k === 'sound') audio.toggleMute();
      if (k === 'ao') settings.setGraphics('ao', !g.ao);
      if (k === 'bloom') settings.setGraphics('bloom', !g.bloom);
      if (k === 'msaa') settings.setGraphics('msaa', !g.msaa);
      if (k === 'fps') settings.update((s) => (s.showFps = !s.showFps));
      if (k === 'fullscreen') this.fullscreen();
      audio.click();
      return this.render();
    }
    const seg = t.closest<HTMLElement>('[data-seg]');
    if (seg) {
      const k = seg.dataset.seg!;
      const v = seg.dataset.v!;
      if (k === 'preset') settings.applyPreset(v as Quality);
      if (k === 'shadows') settings.setGraphics('shadows', v as Quality);
      if (k === 'mist') settings.setGraphics('mist', Number(v));
      if (k === 'dpr') settings.setGraphics('maxDpr', Number(v));
      audio.click();
      return this.render();
    }
    const bind = t.closest<HTMLElement>('[data-bind]');
    if (bind) {
      this.waiting = { action: bind.dataset.bind as Action, slot: Number(bind.dataset.slot) };
      this.say(`Press a key for ${LABEL[this.waiting.action]}. Esc cancels, Delete clears.`);
      audio.click();
      this.render();
    }
  }

  private onKey(e: KeyboardEvent) {
    if (!this.open) return;
    e.stopImmediatePropagation();
    const w = this.waiting;
    if (!w) {
      if (e.key === 'Escape') this.close();
      return;
    }
    e.preventDefault();
    if (e.repeat) return;
    this.waiting = null;
    if (e.key === 'Escape') {
      this.say('');
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      settings.unbind(w.action, w.slot);
      this.say(`${LABEL[w.action]} cleared.`);
    } else if (RESERVED.has(e.code)) {
      this.say(`${settings.label(e.code)} is kept for the game or the browser.`);
    } else {
      const moved = settings.bind(w.action, w.slot, e.code);
      this.say(moved ? `${settings.label(e.code)} moved here from ${LABEL[moved]}.` : `${LABEL[w.action]}: ${settings.label(e.code)}.`);
      audio.click();
    }
    this.render();
  }

  private reset() {
    if (this.tab === 'controls') {
      settings.resetKeys();
      this.say('Keys reset to the defaults.');
    } else if (this.tab === 'graphics') {
      settings.resetGraphics();
      this.say('Graphics reset to High.');
    } else if (this.tab === 'sound') {
      settings.update((s) => (s.volume = { master: 1, music: 1, effects: 1 }));
      if (audio.muted) audio.toggleMute();
      this.say('Volume reset.');
    } else {
      settings.update((s) => {
        s.shake = 1;
        s.showFps = false;
      });
      this.say('Gameplay options reset.');
    }
    audio.click();
    this.render();
  }

  private fullscreen() {
    const doc = document;
    const p = doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen();
    p?.catch(() => this.say('Fullscreen is not allowed here; try the browser’s own fullscreen key (F11).'));
  }
}

/** Fills the slider track up to the thumb. */
function paintRange(r: HTMLInputElement) {
  const min = Number(r.min);
  r.style.setProperty('--p', `${((Number(r.value) - min) / (Number(r.max) - min)) * 100}%`);
}

let shared: Options | null = null;
/** The one options window, made on first use. */
export function options(): Options {
  return (shared ??= new Options());
}
