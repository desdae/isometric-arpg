import type { Stats } from './Stats';
import { CLEAVE_COST } from '../actors/Player';

// The in-game HUD: life and mana orbs, the skill belt with potions and the
// experience bar, gold, the target frame, area banners, the hurt vignette,
// fades between areas and the death screen. Plain DOM over the canvas.

const CSS = `
  [hidden] { display: none !important; }
  .hud { position: fixed; inset: 0; pointer-events: none; z-index: 5; font-family: 'EB Garamond', Georgia, serif; color: #e6d6c0; }
  .hud * { box-sizing: border-box; }
  .hud-bottom { position: absolute; left: 50%; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
    display: flex; align-items: flex-end; gap: 14px; }
  .orb { position: relative; width: 108px; height: 108px; border-radius: 50%; overflow: hidden; pointer-events: auto;
    background: radial-gradient(circle at 50% 50%, #120707 0%, #050202 70%);
    box-shadow: 0 0 0 2px #3a2418, 0 0 0 5px #120a07, 0 0 0 6px #5a3a24, 0 6px 18px rgba(0,0,0,.7), inset 0 0 18px #000; }
  .orb-fill { position: absolute; left: 0; right: 0; bottom: 0; height: 100%; transition: height .12s linear; }
  .orb.life .orb-fill { background: radial-gradient(circle at 40% 85%, #c41a10 0%, #7a0806 45%, #3a0202 100%); }
  .orb.mana .orb-fill { background: radial-gradient(circle at 40% 85%, #3050d8 0%, #142a8a 45%, #060c3a 100%); }
  .orb-fill::before { content: ''; position: absolute; left: -10%; right: -10%; top: -6px; height: 12px; border-radius: 50%;
    background: rgba(255,255,255,.12); animation: slosh 3.2s ease-in-out infinite; }
  @keyframes slosh { 0%,100% { transform: translateX(-4%) rotate(-2deg); } 50% { transform: translateX(4%) rotate(2deg); } }
  .orb-glass { position: absolute; inset: 0; border-radius: 50%;
    background: radial-gradient(ellipse 60% 40% at 38% 22%, rgba(255,255,255,.28), rgba(255,255,255,0) 70%),
                radial-gradient(circle at 50% 120%, rgba(0,0,0,0) 40%, rgba(0,0,0,.6) 75%); }
  .orb-text { position: absolute; inset: 0; display: grid; place-items: center; font: 600 15px/1 'Cinzel', Georgia, serif;
    text-shadow: 0 1px 2px #000, 0 0 6px #000; opacity: .9; font-variant-numeric: tabular-nums; }
  .belt { display: flex; flex-direction: column; gap: 6px; align-items: center; margin-bottom: 6px; }
  .xp { width: 100%; height: 6px; background: #0c0606; border: 1px solid #3a2418; position: relative; }
  .xp-fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #8a6a2a, #e8c060); width: 0; transition: width .3s; }
  .slots { display: flex; gap: 6px; }
  .slot { position: relative; width: 52px; height: 52px; border: 1px solid #5a3a24; background: linear-gradient(180deg, #1c0f0b, #0c0606);
    box-shadow: inset 0 0 10px #000; display: grid; place-items: center; pointer-events: auto; cursor: pointer; }
  .slot svg { width: 34px; height: 34px; }
  .slot .key { position: absolute; left: 3px; top: 2px; font: 600 11px/1 'EB Garamond', Georgia, serif; color: #b89a78; }
  .slot .count { position: absolute; right: 3px; bottom: 2px; font: 600 13px/1 'EB Garamond', Georgia, serif; color: #f0e0c8; text-shadow: 0 1px 2px #000; }
  .slot.dim { filter: grayscale(.8) brightness(.55); }
  .slot .cd { position: absolute; inset: 0; background: rgba(0,0,0,.6); transform-origin: bottom; transform: scaleY(0); }
  .level { font: 600 12px/1 'Cinzel', Georgia, serif; color: #c8a878; letter-spacing: .08em; }
  .gold { position: absolute; right: 16px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); font: 600 15px/1 'Cinzel', Georgia, serif;
    color: #e8c060; text-shadow: 0 1px 2px #000; display: flex; gap: 6px; align-items: center; font-variant-numeric: tabular-nums; }
  .gold::before { content: ''; width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #fff0a0, #c8902a 60%, #6a4410); }
  .menu { position: absolute; right: 16px; top: calc(14px + env(safe-area-inset-top, 0px)); display: flex; gap: 6px; pointer-events: auto; }
  .menu button, .death button { font: 600 12px/1 'Cinzel', Georgia, serif; letter-spacing: .08em; color: #e8d0b0; background: rgba(30,12,10,.85);
    border: 1px solid #6a3424; padding: 7px 10px; cursor: pointer; }
  .menu button:hover, .death button:hover { border-color: #a85a3a; }
  .target { position: absolute; left: 50%; top: calc(14px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); width: min(340px, 70vw);
    text-align: center; transition: opacity .2s; }
  .target-name { font: 600 16px/1.2 'Cinzel', Georgia, serif; letter-spacing: .06em; text-shadow: 0 1px 3px #000; }
  .target-name.elite { color: #e8b050; }
  .target-bar { margin-top: 4px; height: 12px; border: 1px solid #5a2a20; background: #120606; position: relative; box-shadow: 0 2px 8px rgba(0,0,0,.6); }
  .target-fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(180deg, #b0201a, #5a0806); }
  .target-sub { margin-top: 3px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: #a08070; }
  .banner { position: absolute; left: 0; right: 0; top: 22%; text-align: center; opacity: 0; transition: opacity 1.2s; }
  .banner.show { opacity: 1; }
  .banner h2 { margin: 0; font: 600 clamp(28px, 6vw, 52px)/1.1 'Cinzel', Georgia, serif; letter-spacing: .12em; color: #e8c8a0;
    text-shadow: 0 2px 10px #000, 0 0 30px rgba(160,30,20,.5); text-wrap: balance; }
  .banner p { margin: 8px 0 0; font-style: italic; font-size: 17px; color: #b89a88; text-shadow: 0 1px 4px #000; }
  .hud-hurt { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(150,0,0,.55) 100%); transition: opacity .25s; }
  .fade { position: fixed; inset: 0; background: #050202; opacity: 0; transition: opacity .45s; pointer-events: none; z-index: 20;
    display: grid; place-items: center; font: 600 16px/1 'Cinzel', Georgia, serif; letter-spacing: .14em; color: #a08070; }
  .fade.show { opacity: 1; pointer-events: auto; }
  .death { position: fixed; inset: 0; display: grid; place-items: center; z-index: 15; pointer-events: auto;
    background: radial-gradient(ellipse at center, rgba(40,0,0,.35), rgba(0,0,0,.85)); opacity: 0; transition: opacity 1.5s; }
  .death.show { opacity: 1; }
  .death-inner { text-align: center; padding: 0 16px; }
  .death h2 { margin: 0 0 18px; font: 600 clamp(30px, 7vw, 60px)/1.1 'Cinzel', Georgia, serif; color: #b01810; letter-spacing: .1em; text-shadow: 0 0 30px rgba(0,0,0,.9); }
  .death p { margin: 0 0 20px; color: #b89a88; font-style: italic; }
  .death button { font-size: 14px; padding: 11px 18px; }
  .help { position: absolute; left: 16px; top: calc(14px + env(safe-area-inset-top, 0px)); font-size: 13px; line-height: 1.5; color: #a89080;
    text-shadow: 0 1px 2px #000; max-width: 260px; transition: opacity 1s; }
  .help b { font-weight: 600; color: #d8b890; }
  @media (max-width: 560px) {
    .orb { width: 78px; height: 78px; }
    .slot { width: 42px; height: 42px; }
    .slot svg { width: 26px; height: 26px; }
    .hud-bottom { gap: 8px; }
    .help { display: none; }
  }
`;

const ICON_SWORD = `<svg viewBox="0 0 32 32"><path d="M24 4l4 0 0 4-13 13-3-1-1-3z" fill="#c8c0b8" stroke="#3a2a20"/><path d="M8 18l6 6-2 2-2-1-3 3-2-2 3-3-1-2z" fill="#6a4020" stroke="#2a1a10"/></svg>`;
const ICON_CLEAVE = `<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke="#e08050" stroke-width="2.5" stroke-dasharray="40 10"/><path d="M16 5l3 4h-6z" fill="#e08050"/><circle cx="16" cy="16" r="3" fill="#c8c0b8"/></svg>`;
const ICON_POTION = `<svg viewBox="0 0 32 32"><path d="M13 4h6v5l5 6v9a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4v-9l5-6z" fill="#2a1010" stroke="#8a6a50"/><path d="M9 17h14v7a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3z" fill="#c01810"/><rect x="12" y="2" width="8" height="3" fill="#6a4a30"/></svg>`;

export class Hud {
  readonly root: HTMLDivElement;
  private lifeFill: HTMLDivElement;
  private manaFill: HTMLDivElement;
  private lifeText: HTMLDivElement;
  private manaText: HTMLDivElement;
  private xpFill: HTMLDivElement;
  private levelEl: HTMLDivElement;
  private goldEl: HTMLDivElement;
  private potionCount: HTMLSpanElement;
  private cleaveSlot: HTMLDivElement;
  private potionSlot: HTMLDivElement;
  private target: HTMLDivElement;
  private targetName: HTMLDivElement;
  private targetFill: HTMLDivElement;
  private targetSub: HTMLDivElement;
  private banner: HTMLDivElement;
  private hurt: HTMLDivElement;
  private fadeEl: HTMLDivElement;
  private death: HTMLDivElement;
  private help: HTMLDivElement;
  private hurtLevel = 0;
  onInventory: () => void = () => {};
  onPotion: () => void = () => {};
  onCleave: () => void = () => {};
  onRevive: () => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="hud-hurt"></div>
      <div class="help"><b>Left click</b> move, attack, talk, pick up · hold to keep swinging<br><b>Right click</b> Cleave · <b>1</b> potion · <b>I</b> inventory<br><b>Wheel</b> zoom · <b>Q/E</b> rotate</div>
      <div class="target" style="opacity:0"><div class="target-name"></div><div class="target-bar"><div class="target-fill"></div></div><div class="target-sub"></div></div>
      <div class="banner"><h2></h2><p></p></div>
      <div class="menu"><button type="button" data-act="inv">Inventory (I)</button></div>
      <div class="hud-bottom">
        <div class="orb life"><div class="orb-fill"></div><div class="orb-glass"></div><div class="orb-text"></div></div>
        <div class="belt">
          <div class="level"></div>
          <div class="xp"><div class="xp-fill"></div></div>
          <div class="slots">
            <div class="slot" title="Strike (left click a foe)"><span class="key">LMB</span>${ICON_SWORD}</div>
            <div class="slot" data-act="cleave" title="Cleave: spin and hit everything around you (${CLEAVE_COST} mana)"><span class="key">RMB</span>${ICON_CLEAVE}</div>
            <div class="slot" data-act="potion" title="Healing Draught"><span class="key">1</span>${ICON_POTION}<span class="count"></span></div>
          </div>
        </div>
        <div class="orb mana"><div class="orb-fill"></div><div class="orb-glass"></div><div class="orb-text"></div></div>
      </div>
      <div class="gold"></div>`;
    document.body.appendChild(root);
    this.root = root;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.lifeFill = q('.orb.life .orb-fill');
    this.manaFill = q('.orb.mana .orb-fill');
    this.lifeText = q('.orb.life .orb-text');
    this.manaText = q('.orb.mana .orb-text');
    this.xpFill = q('.xp-fill');
    this.levelEl = q('.level');
    this.goldEl = q('.gold');
    this.potionCount = q('.slot[data-act="potion"] .count');
    this.cleaveSlot = q('.slot[data-act="cleave"]');
    this.potionSlot = q('.slot[data-act="potion"]');
    this.target = q('.target');
    this.targetName = q('.target-name');
    this.targetFill = q('.target-fill');
    this.targetSub = q('.target-sub');
    this.banner = q('.banner');
    this.hurt = q('.hud-hurt');
    this.help = q('.help');
    for (const el of root.querySelectorAll<HTMLElement>('.orb, .slot, .menu')) el.addEventListener('pointerdown', (e) => e.stopPropagation());
    q<HTMLButtonElement>('[data-act="inv"]').addEventListener('click', () => this.onInventory());
    this.potionSlot.addEventListener('click', () => this.onPotion());
    this.cleaveSlot.addEventListener('click', () => this.onCleave());

    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'fade';
    document.body.appendChild(this.fadeEl);
    this.death = document.createElement('div');
    this.death.className = 'death';
    this.death.hidden = true;
    this.death.innerHTML = `<div class="death-inner"><h2>You Have Perished</h2><p>The fields keep what they take. Some of your gold stays with them.</p><button type="button">Rise in Saint Orsolya</button></div>`;
    this.death.querySelector('button')!.addEventListener('click', () => this.onRevive());
    this.death.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(this.death);
    setTimeout(() => (this.help.style.opacity = '0.55'), 20000);
  }

  update(dt: number, s: Stats) {
    this.lifeFill.style.height = `${(s.hp / s.maxHp) * 100}%`;
    this.manaFill.style.height = `${(s.mana / s.maxMana) * 100}%`;
    this.lifeText.textContent = `${Math.ceil(s.hp)}`;
    this.manaText.textContent = `${Math.floor(s.mana)}`;
    this.xpFill.style.width = `${(s.xp / s.xpToNext()) * 100}%`;
    this.levelEl.textContent = `Level ${s.level}`;
    this.goldEl.textContent = String(s.gold);
    this.potionCount.textContent = String(s.potions);
    this.cleaveSlot.classList.toggle('dim', s.mana < CLEAVE_COST);
    this.potionSlot.classList.toggle('dim', s.potions <= 0);
    // Vignette: flashes on hits, pulses when close to death.
    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 2.2);
    const low = s.hp / s.maxHp < 0.3 ? 0.35 + Math.sin(performance.now() / 260) * 0.2 : 0;
    this.hurt.style.opacity = String(Math.min(1, Math.max(this.hurtLevel, low)));
  }

  flashHurt(amount: number) {
    this.hurtLevel = Math.min(1, this.hurtLevel + 0.35 + amount);
  }

  showTarget(t: { name: string; hp: number; maxHp: number; level: number; elite: boolean; kind: string } | null) {
    if (!t) {
      this.target.style.opacity = '0';
      return;
    }
    this.target.style.opacity = '1';
    this.targetName.textContent = t.name;
    this.targetName.classList.toggle('elite', t.elite);
    this.targetFill.style.width = `${Math.max(0, t.hp / t.maxHp) * 100}%`;
    this.targetSub.textContent = t.elite ? `Champion ${t.kind} · Level ${t.level}` : `Level ${t.level}`;
  }

  showBanner(title: string, sub: string) {
    this.banner.querySelector('h2')!.textContent = title;
    this.banner.querySelector('p')!.textContent = sub;
    this.banner.classList.add('show');
    setTimeout(() => this.banner.classList.remove('show'), 3200);
  }

  async fade(on: boolean, text = '') {
    this.fadeEl.textContent = text;
    this.fadeEl.classList.toggle('show', on);
    await new Promise((r) => setTimeout(r, 480));
  }

  setFadeText(text: string) {
    this.fadeEl.textContent = text;
  }

  showDeath(on: boolean) {
    if (on) {
      this.death.hidden = false;
      requestAnimationFrame(() => {
        if (!this.death.hidden) this.death.classList.add('show');
      });
    } else {
      this.death.classList.remove('show');
      this.death.hidden = true;
    }
  }
}
