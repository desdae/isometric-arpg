import { desktop } from '../engine/store';

// The pause menu (Escape, or the Menu button): resume, options, or save and
// go back to the character roster.

const CSS = `
  .gmenu { position: fixed; inset: 0; z-index: 28; display: grid; place-items: center; padding: 0 16px; background: rgba(5,1,1,.6); }
  .gmenu-box { width: min(320px, 100%); padding: 20px 22px 22px; display: grid; gap: 10px; text-align: center;
    background: linear-gradient(180deg, rgba(24,11,9,.98), rgba(10,5,5,.98)); border: 1px solid #5a2a20; box-shadow: 0 0 0 1px #1a0a08, 0 14px 40px rgba(0,0,0,.7); }
  .gmenu h3 { margin: 0 0 2px; font: 600 18px/1.2 'Cinzel', Georgia, serif; letter-spacing: .1em; color: #e8b070; }
  .gmenu p { margin: 0 0 8px; font: italic 15px/1.4 'EB Garamond', Georgia, serif; color: #a88a78; overflow-wrap: anywhere; }
  .gmenu button { font: 600 14px/1 'Cinzel', Georgia, serif; letter-spacing: .1em; color: #e8d0b0; background: #2a1210; border: 1px solid #6a3424; padding: 12px; cursor: pointer; }
  .gmenu button:hover { border-color: #c0703a; }
`;

export class GameMenu {
  private el: HTMLDivElement;
  private sub: HTMLParagraphElement;
  onQuit: () => void = () => {};
  onOptions: () => void = () => {};
  /** Desktop build only: save and close the game. */
  onExit: () => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.className = 'gmenu';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="gmenu-box"><h3>Paused</h3><p></p>
      <button type="button" data-resume>Resume</button>
      <button type="button" data-options>Options</button>
      <button type="button" data-quit>Save and Change Hero</button>
      ${desktop ? '<button type="button" data-exit>Save and Quit to Desktop</button>' : ''}</div>`;
    this.sub = this.el.querySelector('p')!;
    this.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (e.target === this.el) this.toggle(false);
    });
    this.el.querySelector('[data-resume]')!.addEventListener('click', () => this.toggle(false));
    this.el.querySelector('[data-options]')!.addEventListener('click', () => this.onOptions());
    this.el.querySelector('[data-exit]')?.addEventListener('click', () => this.onExit());
    this.el.querySelector('[data-quit]')!.addEventListener('click', () => this.onQuit());
    document.body.appendChild(this.el);
  }

  get open() {
    return !this.el.hidden;
  }

  toggle(on = !this.open, line = '') {
    this.el.hidden = !on;
    if (on) this.sub.textContent = line;
  }
}
