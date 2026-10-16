import { CLASSES, TABARDS, classDef, tabard } from './Classes';
import { MAX_SLOTS, SAVE_VERSION, deleteSave, listSlots, newCharacter, storage, writeSave, type CharacterSave, type SlotEntry } from './Save';
import { esc } from './Inventory';
import { options } from './Options';
import { desktop } from '../engine/store';

// The first screen: a roster of character slots down the left, the chosen
// slot on the right. A filled slot shows the hero and plays them; an empty
// one opens character creation (name, class, tabard colour).

const CSS = `
  .csel { position: fixed; inset: 0; z-index: 32; overflow: auto; color: #e6d6c0; font: 16px/1.45 'EB Garamond', Georgia, serif;
    background: radial-gradient(ellipse at 50% 40%, #2a0907 0%, #120403 50%, #050101 100%); }
  .csel-wrap { width: min(980px, 100%); margin: 0 auto; padding: calc(28px + env(safe-area-inset-top, 0px)) 16px calc(28px + env(safe-area-inset-bottom, 0px)); }
  .csel h1 { margin: 0; text-align: center; font: 600 clamp(24px, 5vw, 36px)/1.15 'Cinzel', Georgia, serif; letter-spacing: .14em; color: #e8c8a0;
    text-shadow: 0 2px 12px #000, 0 0 34px rgba(170,30,20,.45); }
  .csel-sub { margin: 6px 0 22px; text-align: center; font-style: italic; color: #a88a78; }
  .csel-warn { margin: 0 auto 16px; max-width: 640px; padding: 8px 12px; border: 1px solid #7a3a20; background: rgba(60,20,10,.5); color: #f0c090; font-size: 15px; text-align: center; }
  .csel-cols { display: grid; grid-template-columns: minmax(0, 340px) minmax(0, 1fr); gap: 20px; align-items: start; }
  @media (max-width: 720px) { .csel-cols { grid-template-columns: minmax(0, 1fr); } }
  .csel-list { display: grid; gap: 4px; }
  .csel-slot { display: grid; grid-template-columns: 26px 14px minmax(0, 1fr) auto; gap: 10px; align-items: center; width: 100%; min-height: 50px; padding: 6px 12px;
    text-align: left; color: inherit; font: inherit; cursor: pointer; background: rgba(0,0,0,.35); border: 1px solid #2a1612; }
  .csel-slot:hover { border-color: #6a3424; }
  .csel-slot.on { border-color: #c0703a; background: rgba(70,20,12,.55); box-shadow: inset 0 0 0 1px rgba(200,110,50,.25); }
  .csel-slot .n { font: 600 11px/1 'Cinzel', Georgia, serif; color: #6a5448; font-variant-numeric: tabular-nums; }
  .csel-slot .sw { width: 12px; height: 22px; border: 1px solid rgba(255,220,180,.25); }
  .csel-slot .nm { font: 600 15px/1.2 'Cinzel', Georgia, serif; letter-spacing: .04em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .csel-slot .meta { font-size: 13px; color: #a08878; }
  .csel-slot .lv { font: 600 12px/1 'Cinzel', Georgia, serif; color: #c8a878; font-variant-numeric: tabular-nums; }
  .csel-slot.empty .nm { color: #7a6458; font-weight: 400; font-family: 'EB Garamond', Georgia, serif; font-style: italic; letter-spacing: 0; }
  .csel-slot.broken .nm { color: #c06048; }
  .csel-panel { padding: 22px 24px 24px; background: linear-gradient(180deg, rgba(24,11,9,.94), rgba(10,5,5,.96)); border: 1px solid #5a2a20;
    box-shadow: 0 0 0 1px #1a0a08, 0 14px 40px rgba(0,0,0,.6); min-width: 0; }
  .csel-panel h2 { margin: 0 0 2px; font: 600 26px/1.2 'Cinzel', Georgia, serif; letter-spacing: .06em; color: #f0d0a8; overflow-wrap: anywhere; }
  .csel-panel .cls { color: #c8a878; font-style: italic; margin-bottom: 16px; }
  .csel-facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; margin: 0 0 20px; font-size: 15px; font-variant-numeric: tabular-nums; }
  .csel-facts dt { color: #8a7060; font: 600 11px/1.9 'Cinzel', Georgia, serif; letter-spacing: .1em; text-transform: uppercase; }
  .csel-facts dd { margin: 0; color: #e0d0c0; }
  .csel-label { display: block; margin: 16px 0 6px; font: 600 11px/1 'Cinzel', Georgia, serif; letter-spacing: .12em; text-transform: uppercase; color: #a08070; }
  .csel input[type=text] { width: 100%; box-sizing: border-box; padding: 10px 12px; font: 600 18px/1.2 'Cinzel', Georgia, serif; letter-spacing: .04em; color: #f0d8b8;
    background: #0c0505; border: 1px solid #5a2a20; outline: none; }
  .csel input[type=text]:focus { border-color: #c0703a; }
  .csel-classes { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
  .csel-class { display: flex; flex-direction: column; justify-content: flex-start; gap: 2px; padding: 10px 12px; text-align: left; color: inherit; font: inherit; cursor: pointer; background: rgba(0,0,0,.35); border: 1px solid #2a1612; }
  .csel-class.on { border-color: #c0703a; background: rgba(70,20,12,.5); }
  .csel-class b { display: block; font: 600 15px/1.3 'Cinzel', Georgia, serif; color: #f0d0a8; }
  .csel-class span { font-size: 14px; color: #a89080; }
  .csel-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
  .csel-swatch { width: 38px; height: 46px; cursor: pointer; border: 2px solid #2a1612; clip-path: polygon(0 0, 100% 0, 100% 78%, 50% 100%, 0 78%); }
  .csel-swatch.on { border-color: #f0c080; outline: 2px solid #f0c080; outline-offset: 2px; clip-path: none; }
  .csel-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; align-items: center; }
  .csel-btn { font: 600 14px/1 'Cinzel', Georgia, serif; letter-spacing: .1em; color: #e8d0b0; background: #2a1210; border: 1px solid #6a3424; padding: 12px 16px; cursor: pointer; }
  .csel-btn:hover { border-color: #c0703a; }
  .csel-btn.primary { color: #fff0dc; background: linear-gradient(180deg, #8a1e14, #5a0c08); border-color: #d0603a; box-shadow: 0 0 18px rgba(200,60,30,.35); padding: 13px 22px; }
  .csel-btn.primary:disabled { opacity: .45; cursor: default; box-shadow: none; }
  .csel-btn.danger { color: #e09080; }
  .csel-err { color: #e08060; font-size: 14px; min-height: 20px; margin-top: 6px; }
  .csel-confirm { color: #f0b090; font-style: italic; }
  .csel-opts { position: absolute; top: calc(20px + env(safe-area-inset-top, 0px)); right: 16px; }
  @media (max-width: 720px) { .csel-opts { position: static; display: flex; justify-content: center; margin-top: 22px; } }
  .csel-opts .csel-btn { background: rgba(0,0,0,.35); border-color: #3a1a14; color: #c8a888; }
  .csel-opts .csel-btn:hover { border-color: #c0703a; color: #f0d8b8; }
`;

const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};
const fmtDate = (t: number) => !t ? 'unknown' : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const AREA = (a: string) => (a === 'zone' ? 'The Blighted Fields' : a === 'dungeon' ? 'The Crypt' : 'Saint Orsolya');
const swatchCss = (id: string) => {
  const [r, g, b] = tabard(id).rgb.map((c) => Math.round(Math.pow(c, 1 / 2.2) * 255));
  return `rgb(${r},${g},${b})`;
};
/** What the chosen colour dyes: the knight's tabard, the mage's mantle and stole. */
const colourWord = (classId: string) => (classDef(classId).id === 'mage' ? 'Mantle' : 'Tabard');
const NAME_OK = /^[\p{L}][\p{L}' -]*$/u;

/** Shows the roster until the player picks or creates a hero. */
export function chooseCharacter(): Promise<CharacterSave> {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'csel';
  document.body.appendChild(root);
  const canStore = storage.available();

  return new Promise((resolve) => {
    let slots: SlotEntry[] = [];
    let selected = 0;
    let confirming = false;
    let draft = { name: '', classId: CLASSES[0].id, tabard: TABARDS[0].id };

    const finish = (save: CharacterSave) => {
      root.remove();
      style.remove();
      window.removeEventListener('keydown', onKey);
      resolve(save);
    };
    const entry = (i: number) => slots.find((s) => s.slot === i);

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        selected = (selected + (e.key === 'ArrowDown' ? 1 : MAX_SLOTS - 1)) % MAX_SLOTS;
        confirming = false;
        render();
        e.preventDefault();
      }
      const en = entry(selected);
      if (e.key === 'Enter' && en && 'save' in en) play(en.save);
    };
    window.addEventListener('keydown', onKey);

    const play = (save: CharacterSave) => finish(save);

    const render = () => {
      slots = listSlots();
      const list = Array.from({ length: MAX_SLOTS }, (_, i) => {
        const en = entry(i);
        const cls = `csel-slot${i === selected ? ' on' : ''}${!en ? ' empty' : 'broken' in en ? ' broken' : ''}`;
        const n = `<span class="n">${String(i + 1).padStart(2, '0')}</span>`;
        if (!en) return `<button type="button" class="${cls}" data-slot="${i}">${n}<span></span><span class="nm">Empty slot</span><span></span></button>`;
        if ('broken' in en) return `<button type="button" class="${cls}" data-slot="${i}">${n}<span></span><span class="nm">Damaged save</span><span></span></button>`;
        const s = en.save;
        return `<button type="button" class="${cls}" data-slot="${i}">${n}<span class="sw" style="background:${swatchCss(s.look.tabard)}"></span>
          <span style="min-width:0"><div class="nm">${esc(s.name)}</div><div class="meta">${classDef(s.classId).name} · ${fmtDate(s.lastPlayed)}</div></span>
          <span class="lv">Lv ${s.hero.level}</span></button>`;
      }).join('');
      const used = slots.length;
      root.innerHTML = `<div class="csel-wrap">
        <h1>Choose Your Hero</h1>
        <p class="csel-sub">${used} of ${MAX_SLOTS} slots taken</p>
        ${canStore ? '' : '<div class="csel-warn">This browser is blocking site storage, so heroes made now will be lost when the page closes.</div>'}
        <div class="csel-cols"><div class="csel-list">${list}</div><div class="csel-panel">${panel()}</div></div>
        <div class="csel-opts"><button type="button" class="csel-btn" data-options>Options</button>${desktop ? ' <button type="button" class="csel-btn" data-exit>Quit</button>' : ''}</div>
      </div>`;
      root.querySelectorAll<HTMLElement>('[data-slot]').forEach((b) =>
        b.addEventListener('click', () => {
          selected = Number(b.dataset.slot);
          confirming = false;
          render();
        }),
      );
      root.querySelector('[data-options]')!.addEventListener('click', () => options().show());
      root.querySelector('[data-exit]')?.addEventListener('click', () => desktop?.quit());
      wire();
    };

    const panel = (): string => {
      const en = entry(selected);
      if (!en) {
        const err = nameError(draft.name);
        return `<h2>New Hero</h2><div class="cls">Slot ${selected + 1}</div>
          <label class="csel-label" for="csel-name">Name</label>
          <input id="csel-name" type="text" maxlength="20" autocomplete="off" spellcheck="false" placeholder="Name your hero" value="${esc(draft.name)}">
          <div class="csel-err" data-err>${draft.name && err ? err : ''}</div>
          <span class="csel-label">Class</span>
          <div class="csel-classes">${CLASSES.map((c) => `<button type="button" class="csel-class${c.id === draft.classId ? ' on' : ''}" data-class="${c.id}"><b>${c.name}</b><span>${c.blurb}</span></button>`).join('')}</div>
          <span class="csel-label">${colourWord(draft.classId)} · ${tabard(draft.tabard).name}</span>
          <div class="csel-swatches">${TABARDS.map((t) => `<button type="button" class="csel-swatch${t.id === draft.tabard ? ' on' : ''}" data-tabard="${t.id}" title="${t.name}" aria-label="${t.name}" style="background:${swatchCss(t.id)}"></button>`).join('')}</div>
          <div class="csel-actions"><button type="button" class="csel-btn primary" data-create ${err ? 'disabled' : ''}>Begin</button></div>`;
      }
      if ('broken' in en) {
        return `<h2>Damaged Save</h2><div class="cls">Slot ${selected + 1}</div>
          <p>This hero's save could not be read (${esc(en.broken)}). Clearing the slot frees it for a new hero.</p>
          <div class="csel-actions">${confirming ? '<span class="csel-confirm">Clear it for good?</span><button type="button" class="csel-btn danger" data-del-yes>Clear</button><button type="button" class="csel-btn" data-del-no>Keep</button>' : '<button type="button" class="csel-btn danger" data-del>Clear slot</button>'}</div>`;
      }
      const s = en.save;
      const newer = s.version > SAVE_VERSION;
      return `<h2>${esc(s.name)}</h2><div class="cls">Level ${s.hero.level} ${classDef(s.classId).name} · ${tabard(s.look.tabard).name} ${colourWord(s.classId).toLowerCase()}</div>
        <dl class="csel-facts">
          <dt>Gold</dt><dd>${s.hero.gold}</dd>
          <dt>Errands done</dt><dd>${s.quests.done.length}</dd>
          <dt>Last seen</dt><dd>${AREA(s.area)}</dd>
          <dt>Played</dt><dd>${fmtTime(s.playTime)}</dd>
          <dt>Created</dt><dd>${fmtDate(s.created)}</dd>
        </dl>${newer ? '<p class="csel-confirm">Saved by a newer version of the game. Anything this version doesn\'t know about is kept safe but won\'t show.</p>' : ''}
        <div class="csel-actions"><button type="button" class="csel-btn primary" data-play>Enter the World</button>
          ${confirming ? `<span class="csel-confirm">Delete ${esc(s.name)} for good?</span><button type="button" class="csel-btn danger" data-del-yes>Delete</button><button type="button" class="csel-btn" data-del-no>Keep</button>` : '<button type="button" class="csel-btn danger" data-del>Delete</button>'}
        </div>`;
    };

    const nameError = (name: string): string | null => {
      const n = name.trim();
      if (!n) return 'Your hero needs a name.';
      if (n.length < 2) return 'At least two letters.';
      if (!NAME_OK.test(n)) return 'Letters, spaces, hyphens and apostrophes only.';
      return null;
    };

    const wire = () => {
      const q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s);
      const en = entry(selected);
      q('[data-play]')?.addEventListener('click', () => en && 'save' in en && play(en.save));
      q('[data-del]')?.addEventListener('click', () => {
        confirming = true;
        render();
      });
      q('[data-del-no]')?.addEventListener('click', () => {
        confirming = false;
        render();
      });
      q('[data-del-yes]')?.addEventListener('click', () => {
        if (en) deleteSave('save' in en ? en.save.id : en.key);
        confirming = false;
        render();
      });
      const input = q<HTMLInputElement>('#csel-name');
      if (input) {
        const btn = q<HTMLButtonElement>('[data-create]')!;
        const errEl = q('[data-err]')!;
        input.addEventListener('input', () => {
          draft.name = input.value;
          const err = nameError(draft.name);
          btn.disabled = !!err;
          errEl.textContent = draft.name && err ? err : '';
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !btn.disabled) btn.click();
        });
        if (window.matchMedia('(pointer: fine)').matches) input.focus();
        btn.addEventListener('click', () => {
          if (nameError(draft.name)) return;
          const save = newCharacter(selected, draft.name.trim().replace(/\s+/g, ' '), draft.classId, draft.tabard);
          writeSave(save);
          draft = { name: '', classId: CLASSES[0].id, tabard: TABARDS[0].id };
          play(save);
        });
      }
      root.querySelectorAll<HTMLElement>('[data-class]').forEach((b) =>
        b.addEventListener('click', () => {
          draft.classId = b.dataset.class!;
          render();
        }),
      );
      root.querySelectorAll<HTMLElement>('[data-tabard]').forEach((b) =>
        b.addEventListener('click', () => {
          draft.tabard = b.dataset.tabard!;
          render();
        }),
      );
    };

    // Start on the most recently played hero, or the first empty slot.
    const initial = listSlots();
    const recent = initial.filter((e): e is { slot: number; save: CharacterSave } => 'save' in e).sort((a, b) => b.save.lastPlayed - a.save.lastPlayed)[0];
    if (recent) selected = recent.slot;
    else {
      while (initial.some((e) => e.slot === selected) && selected < MAX_SLOTS - 1) selected++;
    }
    render();
  });
}
