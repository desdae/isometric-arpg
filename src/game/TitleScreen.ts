import { audio } from '../audio/Audio';
import { desktop } from '../engine/store';
import { GAME_TAGLINE, GAME_TITLE, GAME_VERSION } from './Brand';
import { classDef } from './Classes';
import { esc } from './Inventory';
import { options } from './Options';
import { listSlots, type CharacterSave } from './Save';
import { TitleScene } from './TitleScene';
import fontLicense from '../fonts/OFL.txt?raw';
import threeLicense from '../licenses/three.txt?raw';

// The first thing a player sees: the painted cathedral under the blood moon,
// the title, and the main menu (continue the last hero, choose a hero,
// options, credits, quit). Credits roll over the same scene.

const CSS = `
  .title { position: fixed; inset: 0; z-index: 33; overflow: hidden; background: #050101; color: #e6d6c0; font: 16px/1.45 'EB Garamond', Georgia, serif; user-select: none; }
  .title-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .title-ui { position: absolute; inset: 0; display: grid; grid-template-rows: auto 1fr auto; padding: calc(7vh + env(safe-area-inset-top, 0px)) 16px calc(20px + env(safe-area-inset-bottom, 0px)); pointer-events: none; }
  .title-head { text-align: center; opacity: 0; transform: translateY(-6px); transition: opacity 2.4s ease, transform 2.4s ease; }
  .title.shown .title-head { opacity: 1; transform: none; }
  .title h1 { margin: 0; font: 600 clamp(34px, 7.4vw, 92px)/1 'Cinzel', Georgia, serif; letter-spacing: .16em; padding-left: .16em; color: #f0d4ae;
    text-shadow: 0 0 2px rgba(0,0,0,.9), 0 4px 22px rgba(0,0,0,.95), 0 0 60px rgba(190,40,20,.55); }
  .title-rule { width: min(380px, 70%); height: 10px; margin: 14px auto 10px; background:
    linear-gradient(90deg, transparent, #a0502c 30%, #a0502c 70%, transparent) center / 100% 1px no-repeat,
    radial-gradient(circle, #e0a060 0 2.5px, transparent 3px) center / 10px 10px no-repeat; }
  .title-tag { margin: 0; font-style: italic; font-size: clamp(15px, 1.9vw, 19px); color: #c8a088; text-shadow: 0 2px 10px #000; }
  .title-menu { align-self: end; justify-self: center; display: grid; gap: 4px; width: min(340px, 100%); margin-bottom: 4vh; pointer-events: auto;
    opacity: 0; transition: opacity 1s ease .2s; }
  .title.ready .title-menu { opacity: 1; }
  .title-menu[hidden] { display: none; }
  .title-item { position: relative; display: block; width: 100%; padding: 10px 16px; background: none; border: 0; cursor: pointer; text-align: center; color: #cdb498;
    font: 600 clamp(16px, 2vw, 19px)/1.2 'Cinzel', Georgia, serif; letter-spacing: .14em; text-shadow: 0 2px 8px #000, 0 0 2px #000; transition: color .2s, letter-spacing .25s; }
  .title-item small { display: block; margin-top: 3px; font: italic 14px/1.2 'EB Garamond', Georgia, serif; letter-spacing: .02em; color: #9a8070; }
  .title-item::before, .title-item::after { content: ''; position: absolute; top: 50%; width: 0; height: 1px; background: linear-gradient(90deg, transparent, #d07040); transition: width .25s; }
  .title-item::before { right: calc(50% + 7.5em); }
  .title-item::after { left: calc(50% + 7.5em); transform: scaleX(-1); }
  .title-item.on, .title-item:hover { color: #fff0d8; letter-spacing: .18em; text-shadow: 0 2px 8px #000, 0 0 18px rgba(240,120,60,.55); }
  .title-item.on::before, .title-item.on::after { width: 36px; }
  .title-press { align-self: end; justify-self: center; margin-bottom: 9vh; font: 600 14px/1 'Cinzel', Georgia, serif; letter-spacing: .3em; color: #d8b890; text-shadow: 0 2px 8px #000;
    animation: titlePulse 2.6s ease-in-out infinite; pointer-events: none; }
  @keyframes titlePulse { 50% { opacity: .35; } }
  .title-foot { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #7a6050; text-shadow: 0 1px 4px #000; }
  .title-fade { position: absolute; inset: 0; background: #000; pointer-events: none; transition: opacity 2.2s ease; }
  .title.shown .title-fade { opacity: 0; }
  .title.leaving .title-fade { opacity: 1; transition-duration: .7s; }

  .title.credits-open .title-head, .title.credits-open .title-menu, .title.credits-open .title-foot { opacity: 0; transition: opacity .5s; pointer-events: none; }
  .credits { position: absolute; inset: 0; z-index: 2; overflow: hidden; background: rgba(4,1,1,.55); pointer-events: auto; cursor: pointer; }
  .credits-roll { position: absolute; left: 0; right: 0; top: 100%; padding: 0 16px; text-align: center; will-change: transform; }
  .credits h2 { margin: 0 0 6px; font: 600 clamp(26px, 4.4vw, 46px)/1.1 'Cinzel', Georgia, serif; letter-spacing: .16em; color: #f0d4ae; text-shadow: 0 0 40px rgba(190,40,20,.5); }
  .credits h3 { margin: 54px 0 10px; font: 600 12px/1 'Cinzel', Georgia, serif; letter-spacing: .26em; text-transform: uppercase; color: #b07050; }
  .credits p { margin: 4px auto; max-width: 34em; font-size: 18px; color: #e0ccb2; }
  .credits p.small { font-size: 15px; color: #a08878; font-style: italic; }
  .credits-end { margin-top: 70px; font: italic 20px/1.5 'EB Garamond', Georgia, serif; color: #c8a088; }
  .credits-bar { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: center; gap: 10px; padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px));
    background: linear-gradient(transparent, rgba(0,0,0,.8)); cursor: default; }
  .credits-btn { font: 600 13px/1 'Cinzel', Georgia, serif; letter-spacing: .1em; color: #e8d0b0; background: rgba(30,10,8,.85); border: 1px solid #6a3424; padding: 11px 16px; cursor: pointer; }
  .credits-btn:hover { border-color: #c0703a; }
  .licenses { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; padding: 16px; background: rgba(4,1,1,.86); cursor: default; }
  .licenses-box { width: min(760px, 100%); max-height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: #0e0505; border: 1px solid #5a2a20; }
  .licenses-box h3 { margin: 0; padding: 16px 20px 10px; font: 600 16px/1.2 'Cinzel', Georgia, serif; letter-spacing: .12em; color: #e8b070; }
  .licenses pre { margin: 0; padding: 0 20px; overflow: auto; font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace; color: #b8a090; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
  .licenses-box .credits-bar { position: static; background: none; justify-content: flex-end; }
`;

type Choice = { kind: 'continue'; save: CharacterSave } | { kind: 'heroes' };

/** The most recently played hero that loads, if any. */
function lastHero(): CharacterSave | null {
  const saves = listSlots().flatMap((e) => ('save' in e ? [e.save] : []));
  return saves.sort((a, b) => b.lastPlayed - a.lastPlayed)[0] ?? null;
}

let shownBefore = false;

/** Shows the title screen until the player continues a hero or opens the roster. */
export function titleScreen(): Promise<Choice> {
  document.title = GAME_TITLE;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'title';
  root.innerHTML = `<div class="title-ui">
      <div class="title-head"><h1>${esc(GAME_TITLE)}</h1><div class="title-rule"></div><p class="title-tag">${esc(GAME_TAGLINE)}</p></div>
      <div class="title-press">Press any key</div>
      <nav class="title-menu" hidden></nav>
      <div class="title-foot"><span>${esc(GAME_VERSION)}</span><span>Arrows and Enter to choose</span></div>
    </div><div class="title-fade"></div>`;
  const scene = new TitleScene(root);
  root.prepend(scene.canvas);
  document.body.appendChild(root);
  const menu = root.querySelector<HTMLElement>('.title-menu')!;
  const press = root.querySelector<HTMLElement>('.title-press')!;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('shown')));

  return new Promise((resolve) => {
    let ready = false;
    let sel = 0;
    let credits: (() => void) | null = null;
    const hero = lastHero();
    const items: { label: string; sub?: string; act: () => void }[] = [];
    if (hero) items.push({ label: 'Continue', sub: `${hero.name} · Level ${hero.hero.level} ${classDef(hero.classId).name}`, act: () => leave({ kind: 'continue', save: hero }) });
    items.push({ label: hero ? 'Heroes' : 'New Game', act: () => leave({ kind: 'heroes' }) });
    items.push({ label: 'Options', act: () => options().show() });
    items.push({ label: 'Credits', act: () => showCredits() });
    if (desktop) items.push({ label: 'Quit', act: () => desktop?.quit() });

    const draw = () => {
      menu.innerHTML = items.map((it, i) => `<button type="button" class="title-item${i === sel ? ' on' : ''}" data-i="${i}">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`).join('');
    };
    menu.addEventListener('pointerover', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (b && Number(b.dataset.i) !== sel) {
        sel = Number(b.dataset.i);
        draw();
      }
    });
    menu.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (!b) return;
      audio.click();
      items[Number(b.dataset.i)].act();
    });

    /** The first key or click wakes the sound (browsers allow it only then) and tolls the bell. */
    const wake = () => {
      if (ready) return;
      ready = true;
      audio.unlock();
      setTimeout(() => audio.toll(), 80);
      press.remove();
      menu.hidden = false;
      draw();
      requestAnimationFrame(() => root.classList.add('ready'));
    };
    if (shownBefore) wake();
    shownBefore = true;

    const onKey = (e: KeyboardEvent) => {
      if (!ready) {
        if (!e.repeat) wake();
        return;
      }
      if (credits) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') credits();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 's' || e.key === 'w') {
        sel = (sel + (e.key === 'ArrowDown' || e.key === 's' ? 1 : items.length - 1)) % items.length;
        audio.click();
        draw();
        e.preventDefault();
      } else if (e.key === 'Enter' || e.key === ' ') {
        audio.click();
        items[sel].act();
        e.preventDefault();
      }
    };
    const onDown = () => wake();
    window.addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', onDown);

    const leave = (c: Choice) => {
      window.removeEventListener('keydown', onKey);
      root.classList.add('leaving');
      setTimeout(() => {
        scene.dispose();
        root.remove();
        style.remove();
        resolve(c);
      }, 700);
    };

    const showCredits = () => {
      const el = document.createElement('div');
      el.className = 'credits';
      el.innerHTML = `<div class="credits-roll">
          <h2>${esc(GAME_TITLE)}</h2>
          <h3>Created by</h3><p>Martins</p>
          <h3>Design and direction</h3><p>Martins</p>
          <h3>Code, art, music and sound</h3><p>Written with Claude, by Anthropic</p>
          <p class="small">Every model, texture, effect, tune and sound in the game is generated by code as it runs. There are no image or audio files.</p>
          <h3>Engine</h3><p>three.js</p>
          ${desktop ? '<p class="small">Desktop build on Electron</p>' : ''}
          <h3>Typefaces</h3><p>Cinzel by Natanael Gama</p><p>EB Garamond by Georg Duffner and Octavio Pardo</p>
          <p class="small">Both under the SIL Open Font License</p>
          <h3>Thanks</h3><p>To everyone who walked into the mire early and came back with notes</p>
          <p class="credits-end">The bells will ring again.</p>
        </div>
        <div class="credits-bar"><button type="button" class="credits-btn" data-lic>Licenses</button><button type="button" class="credits-btn" data-back>Back</button></div>`;
      root.querySelector('.title-ui')!.appendChild(el);
      root.classList.add('credits-open');
      const roll = el.querySelector<HTMLElement>('.credits-roll')!;
      // Roll from below the screen until the last line passes the middle, then hold.
      let y = 0;
      let last = performance.now();
      let raf = 0;
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const end = roll.offsetHeight + window.innerHeight * 0.45;
        y = Math.min(end, y + dt * 42);
        roll.style.transform = `translateY(${-y}px)`;
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      const close = () => {
        cancelAnimationFrame(raf);
        el.remove();
        root.classList.remove('credits-open');
        credits = null;
      };
      credits = close;
      // A click on the roll speeds it past; the bar's buttons do their own thing.
      el.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('[data-back]')) return close();
        if (t.closest('[data-lic]')) return showLicenses(el);
        if (!t.closest('.credits-bar, .licenses')) y += window.innerHeight * 0.35;
      });
    };

    const showLicenses = (host: HTMLElement) => {
      const el = document.createElement('div');
      el.className = 'licenses';
      el.innerHTML = `<div class="licenses-box"><h3>Licenses</h3><pre></pre><div class="credits-bar"><button type="button" class="credits-btn" data-close>Close</button></div></div>`;
      el.querySelector('pre')!.textContent = `three.js\n\n${threeLicense}\n\n${'─'.repeat(40)}\n\n${fontLicense}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if ((e.target as HTMLElement).closest('[data-close]')) el.remove();
      });
      host.appendChild(el);
    };
  });
}
