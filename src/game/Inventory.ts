import { RARITY_COLOR, statLines, type Item, type Slot } from './Items';
import { SLOTS, type Stats } from './Stats';

// Inventory panel: worn equipment on the left with the hero's totals, the bag
// grid on the right. Click a bag item to wear it, click worn gear to take it
// off. Hovering shows a tooltip comparing against what's worn.

const CSS = `
  .inv { position: fixed; right: 16px; top: calc(14px + env(safe-area-inset-top, 0px)); width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 200px); overflow: auto; z-index: 12; padding: 16px 18px 18px;
    background: linear-gradient(180deg, rgba(24,11,9,.97), rgba(10,5,5,.98)); border: 1px solid #5a2a20;
    box-shadow: 0 0 0 1px #1a0a08, 0 14px 40px rgba(0,0,0,.7); color: #d8c8b8; font: 14px/1.45 'EB Garamond', Georgia, serif; }
  .inv h3 { margin: 0 0 10px; font: 600 16px/1.2 'Cinzel', Georgia, serif; letter-spacing: .08em; color: #e8b070; display: flex; justify-content: space-between; align-items: center; }
  .inv h3 button { font: 600 12px/1 'Cinzel', Georgia, serif; color: #e8d0b0; background: #2a1210; border: 1px solid #6a3424; padding: 6px 9px; cursor: pointer; }
  .inv-cols { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr); gap: 18px; }
  @media (max-width: 520px) { .inv-cols { grid-template-columns: minmax(0, 1fr); } }
  .inv-worn { display: grid; gap: 5px; align-content: start; }
  .inv-row { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 8px; align-items: center; min-height: 30px; padding: 3px 6px;
    border: 1px solid #2a1612; background: rgba(0,0,0,.25); cursor: pointer; }
  .inv-row:hover { border-color: #6a3424; }
  .inv-row .slotname { font: 600 10px/1 'Cinzel', Georgia, serif; letter-spacing: .1em; text-transform: uppercase; color: #8a7060; }
  .inv-row .itemname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .inv-row .empty { color: #5a4a40; font-style: italic; }
  .inv-totals { margin-top: 10px; font-size: 13px; color: #b8a090; display: grid; grid-template-columns: auto auto; gap: 1px 10px; font-variant-numeric: tabular-nums; }
  .inv-totals span:nth-child(even) { text-align: right; color: #e0d0c0; }
  .inv-bag { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 4px; align-content: start; }
  .inv-cell { aspect-ratio: 1; max-width: 100%; border: 1px solid #2a1612; background: rgba(0,0,0,.35); display: grid; place-items: center;
    font: 600 11px/1 'Cinzel', Georgia, serif; cursor: pointer; text-align: center; padding: 2px; overflow: hidden; }
  .inv-cell:hover { border-color: currentColor; background: rgba(60,20,14,.4); }
  .inv-cell.blank { cursor: default; color: transparent; }
  .inv-hint { margin-top: 8px; font-size: 12px; color: #8a7060; font-style: italic; }
  .tip { position: fixed; z-index: 30; pointer-events: none; max-width: 280px; padding: 10px 12px; background: rgba(6,3,3,.96);
    border: 1px solid #5a3a24; font: 14px/1.4 'EB Garamond', Georgia, serif; color: #c8b8a8; box-shadow: 0 8px 24px rgba(0,0,0,.7); }
  .tip .tname { font: 600 15px/1.25 'Cinzel', Georgia, serif; margin-bottom: 2px; }
  .tip .tbase { font-size: 12px; color: #8a7a70; margin-bottom: 6px; }
  .tip .tlore { margin-top: 6px; font-style: italic; color: #b07040; }
  .tip .tcmp { margin-top: 6px; font-size: 12px; color: #8a7a70; }
`;

const ABBR: Record<string, string> = { weapon: 'WPN', armor: 'ARM', helm: 'HLM', gloves: 'GLV', boots: 'BTS', ring: 'RNG', amulet: 'AMU' };

export class Inventory {
  private el: HTMLDivElement;
  private tip: HTMLDivElement;
  open = false;
  onChange: () => void = () => {};

  constructor(private stats: Stats) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'inv';
    this.el.hidden = true;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(this.el);
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    this.tip.hidden = true;
    document.body.appendChild(this.tip);
  }

  toggle(force?: boolean) {
    this.open = force ?? !this.open;
    this.el.hidden = !this.open;
    this.tip.hidden = true;
    if (this.open) this.render();
  }

  render() {
    if (!this.open) return;
    const s = this.stats;
    const worn = SLOTS.map((slot) => {
      const it = s.equipped[slot];
      return `<div class="inv-row" data-slot="${slot}"><span class="slotname">${slot}</span>${
        it ? `<span class="itemname" style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}</span>` : '<span class="empty">empty</span>'
      }</div>`;
    }).join('');
    const cells: string[] = [];
    for (let i = 0; i < s.bagSize; i++) {
      const it = s.bag[i];
      cells.push(it ? `<div class="inv-cell" data-bag="${i}" style="color:${RARITY_COLOR[it.rarity]}">${ABBR[it.slot] ?? '?'}</div>` : '<div class="inv-cell blank"></div>');
    }
    this.el.innerHTML = `
      <h3>Inventory <button type="button" data-close>Close</button></h3>
      <div class="inv-cols">
        <div>
          <div class="inv-worn">${worn}</div>
          <div class="inv-totals">
            <span>Damage</span><span>${s.dmgMin}–${s.dmgMax}</span>
            <span>Armour</span><span>${s.armor}</span>
            <span>Life</span><span>${s.maxHp}</span>
            <span>Mana</span><span>${s.maxMana}</span>
            <span>Critical</span><span>${Math.round(s.crit * 100)}%</span>
            <span>Attack speed</span><span>${s.attackSpeed >= 0 ? '+' : ''}${Math.round(s.attackSpeed * 100)}%</span>
            ${s.lifeSteal ? `<span>Life steal</span><span>${(s.lifeSteal * 100).toFixed(1)}%</span>` : ''}
          </div>
        </div>
        <div>
          <div class="inv-bag">${cells.join('')}</div>
          <div class="inv-hint">Click an item to wear it. Click worn gear to take it off.</div>
        </div>
      </div>`;
    this.el.querySelector('[data-close]')!.addEventListener('click', () => this.toggle(false));
    this.el.querySelectorAll<HTMLElement>('[data-slot]').forEach((row) => {
      const slot = row.dataset.slot as Slot;
      row.addEventListener('click', () => {
        s.unequip(slot);
        this.changed();
      });
      this.hover(row, () => s.equipped[slot]);
    });
    this.el.querySelectorAll<HTMLElement>('[data-bag]').forEach((cell) => {
      const it = s.bag[Number(cell.dataset.bag)];
      cell.addEventListener('click', () => {
        s.equip(it);
        this.changed();
      });
      this.hover(cell, () => it, true);
    });
  }

  hideTip() {
    this.tip.hidden = true;
  }

  private changed() {
    this.tip.hidden = true;
    this.onChange();
    this.render();
  }

  /** Shows the item tooltip while the pointer is over `el` (the shop uses it too). */
  hover(el: HTMLElement, get: () => Item | undefined, compare = false, extra?: (it: Item) => string) {
    el.addEventListener('pointerenter', (e) => {
      const it = get();
      if (!it) return;
      const worn = compare && it.slot !== 'gold' && it.slot !== 'potion' && it.slot !== 'quest' ? this.stats.equipped[it.slot as Slot] : undefined;
      this.tip.innerHTML = `
        <div class="tname" style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}</div>
        <div class="tbase">${it.rarity === 'common' ? '' : cap(it.rarity) + ' · '}${esc(it.base)} · Level ${it.level}</div>
        ${statLines(it.stats).map((l) => `<div>${l}</div>`).join('')}
        ${it.lore ? `<div class="tlore">${esc(it.lore)}</div>` : ''}
        ${worn ? `<div class="tcmp">Worn: <span style="color:${RARITY_COLOR[worn.rarity]}">${esc(worn.name)}</span><br>${statLines(worn.stats).join(' · ')}</div>` : ''}
        ${extra ? extra(it) : ''}`;
      this.tip.hidden = false;
      this.placeTip(e);
    });
    el.addEventListener('pointermove', (e) => this.placeTip(e));
    el.addEventListener('pointerleave', () => (this.tip.hidden = true));
  }

  private placeTip(e: PointerEvent) {
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    let x = e.clientX - w - 14;
    if (x < 8) x = e.clientX + 14;
    const y = Math.min(window.innerHeight - h - 8, Math.max(8, e.clientY - h / 2));
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
  }
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
