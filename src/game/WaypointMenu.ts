// The list a waypoint opens: every waypoint in the world, the found ones to
// travel to, the rest greyed out. Borrows the pause menu's look.

const CSS = `
  .wpmenu .gmenu-box { width: min(340px, 100%); }
  .wpmenu .wp-row { display: grid; gap: 4px; text-align: left; padding: 11px 14px; }
  .wpmenu .wp-row small { font: italic 13px/1.2 'EB Garamond', Georgia, serif; letter-spacing: 0; color: #8aa8c8; }
  .wpmenu .wp-row:disabled { cursor: default; color: #6a5a52; background: #160b0a; border-color: #3a1e18; }
  .wpmenu .wp-row:disabled small { color: #5a4a44; }
  .wpmenu .wp-row.here { border-color: #4a7090; }
  .wpmenu .wp-close { margin-top: 4px; }
`;

export interface WaypointEntry {
  area: string;
  name: string;
  found: boolean;
  here: boolean;
}

export class WaypointMenu {
  private el: HTMLDivElement;
  private list: HTMLDivElement;
  onTravel: (area: string) => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'gmenu wpmenu';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="gmenu-box"><h3>Waypoints</h3><p>Step through to any waypoint you have found.</p>
      <div class="wp-list" style="display:grid;gap:8px"></div>
      <button type="button" class="wp-close">Close</button></div>`;
    this.list = this.el.querySelector('.wp-list')!;
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === this.el) this.toggle(false);
    });
    this.el.querySelector('.wp-close')!.addEventListener('click', () => this.toggle(false));
    document.body.appendChild(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  show(entries: WaypointEntry[]) {
    this.list.replaceChildren(
      ...entries.map((e) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wp-row' + (e.here ? ' here' : '');
        b.disabled = !e.found || e.here;
        b.innerHTML = `<span></span><small>${e.here ? 'You are here' : e.found ? 'Travel' : 'Not yet found'}</small>`;
        b.querySelector('span')!.textContent = e.name;
        b.addEventListener('click', () => {
          this.toggle(false);
          this.onTravel(e.area);
        });
        return b;
      }),
    );
    this.toggle(true);
  }

  toggle(on = !this.open) {
    this.el.hidden = !on;
  }
}
