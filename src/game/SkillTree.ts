import type { Stats } from './Stats';
import { BELT_KEYS, BRANCHES, SKILLS, TIER_NEEDS, type SkillId } from './Skills';

// The skill tree screen: three branch columns, three tiers each. Click a
// skill to spend a point on it; an active skill's key chip moves it along
// the belt.

const CSS = `
  .tree { position: fixed; left: 50%; top: calc(14px + env(safe-area-inset-top, 0px)); transform: translateX(-50%); z-index: 12; pointer-events: auto;
    width: min(900px, calc(100vw - 32px)); max-height: calc(100vh - 170px); overflow: auto; padding: 16px 18px 18px;
    background: linear-gradient(180deg, rgba(24,11,9,.97), rgba(10,5,5,.98)); border: 1px solid #5a2a20;
    box-shadow: 0 0 0 1px #1a0a08, 0 14px 40px rgba(0,0,0,.7); color: #d8c8b8; font: 14px/1.4 'EB Garamond', Georgia, serif; }
  .tree * { box-sizing: border-box; }
  .tree header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .tree h3 { margin: 0; font: 600 17px/1.2 'Cinzel', Georgia, serif; letter-spacing: .08em; color: #e8b070; }
  .tree .points { font: 600 14px/1 'Cinzel', Georgia, serif; letter-spacing: .06em; color: #a08070; }
  .tree .points b { color: #f0d070; font-size: 17px; font-variant-numeric: tabular-nums; }
  .tree .points.has b { text-shadow: 0 0 8px rgba(255,180,80,.6); }
  .tree header button { font: 600 12px/1 'Cinzel', Georgia, serif; color: #e8d0b0; background: #2a1210; border: 1px solid #6a3424; padding: 6px 9px; cursor: pointer; }
  .tree .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
  .tree .col { min-width: 0; border: 1px solid #2a1612; background: rgba(0,0,0,.25); padding: 10px; display: grid; gap: 8px; align-content: start; }
  .tree .col h4 { margin: 0; font: 600 15px/1.2 'Cinzel', Georgia, serif; letter-spacing: .1em; display: flex; justify-content: space-between; align-items: baseline; }
  .tree .col h4 span { font: 13px/1 'EB Garamond', Georgia, serif; letter-spacing: 0; color: #8a7060; font-variant-numeric: tabular-nums; }
  .tree .blurb { margin: -4px 0 2px; font-style: italic; color: #8a7060; font-size: 13px; }
  .tree .tier { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #6a5448; display: flex; align-items: center; gap: 8px; margin-top: 2px; }
  .tree .tier::after { content: ''; flex: 1; height: 1px; background: #2a1612; }
  .tree .tier.open { color: #a08868; }
  .node { display: grid; grid-template-columns: 44px 1fr; gap: 9px; align-items: start; text-align: left; width: 100%; padding: 7px; cursor: pointer;
    color: inherit; font: inherit; background: linear-gradient(180deg, #1c0f0b, #100807); border: 1px solid #3a2418; position: relative; }
  .node:hover { border-color: #8a5a3a; }
  .node .ic { width: 44px; height: 44px; border: 1px solid #5a3a24; background: #0c0606; display: grid; place-items: center; box-shadow: inset 0 0 8px #000; }
  .node .ic svg { width: 32px; height: 32px; }
  .node .nm { font: 600 13px/1.2 'Cinzel', Georgia, serif; letter-spacing: .04em; color: #e8d0a8; display: flex; justify-content: space-between; gap: 6px; align-items: center; }
  .node .kind { font: 11px/1 'EB Garamond', Georgia, serif; letter-spacing: .1em; text-transform: uppercase; color: #8a7060; }
  .node .pips { display: flex; gap: 3px; margin: 4px 0 3px; }
  .node .pips i { width: 9px; height: 9px; transform: rotate(45deg); border: 1px solid #6a4a30; background: #120808; }
  .node .pips i.on { background: var(--c); border-color: var(--c); box-shadow: 0 0 5px var(--c); }
  .node .tx { font-size: 13px; color: #c0b0a0; text-wrap: pretty; }
  .node .nx { font-size: 12.5px; color: #8a9a70; margin-top: 2px; }
  .node .why { font-size: 12px; color: #a05040; margin-top: 2px; font-style: italic; }
  .node .meta { font-size: 12px; color: #7088c0; margin-top: 2px; }
  .node.locked { opacity: .5; cursor: default; }
  .node.locked .ic { filter: grayscale(1) brightness(.6); }
  .node.unlearned .ic { filter: grayscale(.7) brightness(.7); }
  .node.can { border-color: #8a6a2a; box-shadow: 0 0 0 1px rgba(240,200,100,.15), inset 0 0 14px rgba(240,180,80,.08); }
  .node.can .ic { animation: glowp 1.8s ease-in-out infinite; }
  @keyframes glowp { 50% { box-shadow: inset 0 0 8px #000, 0 0 10px rgba(255,190,90,.55); } }
  .node.max { border-color: #4a3a24; }
  .node .keychip { font: 600 11px/1 'EB Garamond', Georgia, serif; color: #f0e0c8; background: #2a1a10; border: 1px solid #8a6a40; padding: 3px 6px; cursor: pointer; white-space: nowrap; }
  .node .keychip:hover { border-color: #e0b070; }
  .tree .foot { margin: 12px 0 0; font-size: 13px; font-style: italic; color: #8a7060; }
  @media (max-width: 560px) { .tree { max-height: calc(100vh - 150px); padding: 12px; } }
`;

export class SkillTree {
  private el: HTMLDivElement;
  /** A point was spent; the game refreshes whatever depends on it. */
  onLearn: (id: SkillId) => void = () => {};

  constructor(private stats: Stats) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'tree';
    this.el.hidden = true;
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => this.click(e));
    document.body.appendChild(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(on = !this.open) {
    this.el.hidden = !on;
    if (on) this.render();
  }

  private click(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('[data-close]')) return this.toggle(false);
    const chip = t.closest<HTMLElement>('[data-key]');
    if (chip) {
      this.stats.cycleBelt(chip.dataset.key as SkillId);
      this.onLearn(chip.dataset.key as SkillId);
      return this.render();
    }
    const node = t.closest<HTMLElement>('.node');
    if (node && this.stats.learn(node.dataset.id as SkillId)) {
      this.onLearn(node.dataset.id as SkillId);
      this.render();
    }
  }

  render() {
    const s = this.stats;
    const cols = BRANCHES.filter((b) => b.cls === s.cls.id).map((b) => {
      const spent = s.spentIn(b.id);
      const tiers = TIER_NEEDS.map((need, tier) => {
        const open = spent >= need;
        const nodes = SKILLS.filter((d) => d.branch === b.id && d.tier === tier)
          .map((d) => {
            const r = s.rank(d.id);
            const why = s.blocked(d.id);
            const locked = !open;
            const cls = locked ? 'locked' : r >= d.maxRank ? 'max' : why ? (r ? '' : 'unlearned') : 'can';
            const pips = Array.from({ length: d.maxRank }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('');
            const slot = s.belt.indexOf(d.id);
            const chip = d.active && r > 0 ? `<span class="keychip" data-key="${d.id}" title="Move to the next belt key">${slot >= 0 ? BELT_KEYS[slot] : 'Unbound'} ⟳</span>` : `<span class="kind">${d.active ? 'Active' : 'Passive'}</span>`;
            const now = r > 0 ? `<div class="tx">${d.text(r)}</div>` : `<div class="tx">${d.text(1)}</div>`;
            const next = r > 0 && r < d.maxRank ? `<div class="nx">Next rank: ${d.text(r + 1)}</div>` : '';
            const meta = d.active ? `<div class="meta">${d.cost?.(Math.max(1, r)) ?? 0} mana${d.cooldown?.(1) ? ` · ${d.cooldown(1)}s cooldown` : ''}${d.id === 'bloodNova' ? ' · costs 12% of your life' : ''}</div>` : '';
            const reason = why && why !== 'Fully learned' && (locked || s.skillPoints > 0) ? `<div class="why">${why}</div>` : '';
            return `<button type="button" class="node ${cls}" data-id="${d.id}" style="--c:${b.color}"><div class="ic">${d.icon}</div><div><div class="nm">${d.name} ${chip}</div><div class="pips">${pips}</div>${now}${next}${meta}${reason}</div></button>`;
          })
          .join('');
        return `<div class="tier ${open ? 'open' : ''}">Tier ${['I', 'II', 'III'][tier]}${need ? ` · ${need} points in ${b.name}` : ''}</div>${nodes}`;
      }).join('');
      return `<section class="col"><h4 style="color:${b.color}">${b.name} <span>${spent} spent</span></h4><p class="blurb">${b.blurb}</p>${tiers}</section>`;
    }).join('');
    this.el.innerHTML = `<header><h3>Skill Tree</h3><div class="points ${s.skillPoints ? 'has' : ''}"><b>${s.skillPoints}</b> ${s.skillPoints === 1 ? 'point' : 'points'} to spend</div><button type="button" data-close>Close</button></header><div class="cols">${cols}</div><p class="foot">One point with every level. Active skills go on right click and keys 2 to 5; click a skill's key to move it.</p>`;
  }
}
