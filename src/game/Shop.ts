import { RARITY_COLOR, itemPrice, makeItem, makePotion, sellPrice, type Item, type Rarity } from './Items';
import { esc, type Inventory } from './Inventory';
import type { Stats } from './Stats';

// Trading with a townsperson: their wares on the left, the hero's bag on the
// right. Click a ware to buy it, click something in the bag to sell it.
// Mirela sells draughts; Dusan sells arms and armour, restocked whenever the
// hero comes back into town.

const CSS = `
  .shop { position: fixed; left: 50%; top: calc(14px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); z-index: 12;
    width: min(680px, calc(100vw - 32px)); max-height: calc(100vh - 190px); overflow: auto; box-sizing: border-box; padding: 16px 18px 18px;
    background: linear-gradient(180deg, rgba(24,11,9,.97), rgba(10,5,5,.98)); border: 1px solid #5a2a20;
    box-shadow: 0 0 0 1px #1a0a08, 0 14px 40px rgba(0,0,0,.7); color: #d8c8b8; font: 14px/1.45 'EB Garamond', Georgia, serif; }
  .shop h3 { margin: 0 0 4px; font: 600 16px/1.2 'Cinzel', Georgia, serif; letter-spacing: .08em; color: #e8b070; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .shop h3 button { font: 600 12px/1 'Cinzel', Georgia, serif; color: #e8d0b0; background: #2a1210; border: 1px solid #6a3424; padding: 6px 9px; cursor: pointer; }
  .shop-gold { margin-bottom: 10px; color: #e8c060; font: 600 13px/1 'Cinzel', Georgia, serif; font-variant-numeric: tabular-nums; }
  .shop-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
  @media (max-width: 560px) { .shop-cols { grid-template-columns: minmax(0, 1fr); } }
  .shop h4 { margin: 0 0 6px; font: 600 11px/1 'Cinzel', Georgia, serif; letter-spacing: .12em; text-transform: uppercase; color: #8a7060; }
  .shop-list { display: grid; gap: 4px; }
  .shop-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 5px 8px; min-height: 30px;
    border: 1px solid #2a1612; background: rgba(0,0,0,.28); cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .shop-row:hover, .shop-row:focus-visible { border-color: #8a5a34; background: rgba(60,20,14,.4); outline: none; }
  .shop-row.poor { opacity: .45; }
  .shop-row .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .shop-row .pr { font: 600 12px/1 'Cinzel', Georgia, serif; color: #e8c060; font-variant-numeric: tabular-nums; }
  .shop-empty { font-style: italic; color: #6a5a4a; padding: 4px 2px; }
  .shop-note { margin-top: 10px; font-size: 12px; font-style: italic; color: #8a7060; }
`;

interface Ware {
  item: Item;
  /** Draughts never run out. */
  endless?: boolean;
  label?: string;
}

export class Shop {
  private el: HTMLDivElement;
  private wares: Ware[] = [];
  private title = '';
  private stockedAt = -1;
  open = false;
  merchant = '';
  onTrade: (kind: 'buy' | 'sell' | 'poor', item: Item) => void = () => {};

  constructor(private stats: Stats, private inventory: Inventory) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'shop';
    this.el.hidden = true;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  /** Opens `merchant`'s stall. `visit` counts trips into town, so stock turns over between them. */
  show(merchant: string, visit: number) {
    if (merchant !== this.merchant || visit !== this.stockedAt) this.restock(merchant, visit);
    this.open = true;
    this.el.hidden = false;
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.hidden = true;
    this.inventory.hideTip();
  }

  private restock(merchant: string, visit: number) {
    this.merchant = merchant;
    this.stockedAt = visit;
    const lv = this.stats.level;
    if (merchant === 'Mirela') {
      this.title = 'Mirela’s Stall';
      const five = makePotion();
      five.amount = 5;
      this.wares = [
        { item: makePotion(), endless: true, label: 'Healing Draught' },
        { item: five, endless: true, label: 'Healing Draught ×5' },
      ];
      // A trinket or two from whoever could not pay her in coin.
      for (let i = 0; i < 2; i++) this.wares.push({ item: makeItem(lv, Math.random() < 0.3 ? 'rare' : 'magic', Math.random() < 0.5 ? 'ring' : 'amulet') });
    } else {
      this.title = 'Dusan’s Forge';
      const rarities: Rarity[] = ['common', 'magic', 'magic', 'magic', 'rare', 'magic', 'common', Math.random() < 0.5 ? 'rare' : 'magic'];
      this.wares = rarities.map((r) => ({ item: makeItem(lv + (Math.random() < 0.3 ? 1 : 0), r) }));
    }
  }

  private render() {
    if (!this.open) return;
    const s = this.stats;
    const wares = this.wares
      .map((w, i) => {
        const price = itemPrice(w.item);
        const color = w.item.slot === 'potion' ? '#e07060' : RARITY_COLOR[w.item.rarity];
        return `<button type="button" class="shop-row${price > s.gold ? ' poor' : ''}" data-ware="${i}"><span class="nm" style="color:${color}">${esc(w.label ?? w.item.name)}</span><span class="pr">${price}g</span></button>`;
      })
      .join('');
    const bag = s.bag
      .map((it, i) => `<button type="button" class="shop-row" data-bag="${i}"><span class="nm" style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}</span><span class="pr">+${sellPrice(it)}g</span></button>`)
      .join('');
    this.el.innerHTML = `
      <h3>${esc(this.title)} <button type="button" data-close>Close</button></h3>
      <div class="shop-gold">${s.gold} gold · ${s.potions} draughts</div>
      <div class="shop-cols">
        <div><h4>Wares</h4><div class="shop-list">${wares || '<div class="shop-empty">Sold out until your next return.</div>'}</div></div>
        <div><h4>Sell from your bag</h4><div class="shop-list">${bag || '<div class="shop-empty">Your bag is empty.</div>'}</div></div>
      </div>
      <div class="shop-note">Click a ware to buy it. Click something from your bag to sell it for a third of its worth.</div>`;
    this.el.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    this.el.querySelectorAll<HTMLElement>('[data-ware]').forEach((row) => {
      const w = this.wares[Number(row.dataset.ware)];
      row.addEventListener('click', () => this.buy(w));
      if (w.item.slot !== 'potion') this.inventory.hover(row, () => w.item, true, () => `<div class="tcmp">Price: ${itemPrice(w.item)} gold</div>`);
    });
    this.el.querySelectorAll<HTMLElement>('[data-bag]').forEach((row) => {
      const it = s.bag[Number(row.dataset.bag)];
      row.addEventListener('click', () => this.sell(it));
      this.inventory.hover(row, () => it, true, () => `<div class="tcmp">Sells for ${sellPrice(it)} gold</div>`);
    });
  }

  private buy(w: Ware) {
    const s = this.stats;
    const price = itemPrice(w.item);
    if (price > s.gold || (w.item.slot !== 'potion' && s.bag.length >= s.bagSize)) {
      this.onTrade('poor', w.item);
      return;
    }
    s.gold -= price;
    if (w.item.slot === 'potion') s.potions += w.item.amount;
    else s.bag.push(w.item);
    if (!w.endless) this.wares.splice(this.wares.indexOf(w), 1);
    this.inventory.hideTip();
    this.onTrade('buy', w.item);
    this.render();
  }

  private sell(it: Item) {
    const s = this.stats;
    const i = s.bag.indexOf(it);
    if (i < 0) return;
    s.bag.splice(i, 1);
    s.gold += sellPrice(it);
    // Dusan puts what you sell him back on his rack, at his price.
    if (this.merchant === 'Dusan' && it.slot !== 'ring' && it.slot !== 'amulet') this.wares.push({ item: it });
    this.inventory.hideTip();
    this.onTrade('sell', it);
    this.render();
  }
}
