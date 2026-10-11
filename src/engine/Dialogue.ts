// Dialogue box: a dark panel along the bottom of the screen with the
// speaker's name and role, their line, and buttons to continue or leave.

export class Dialogue {
  private root: HTMLDivElement;
  private nameEl: HTMLDivElement;
  private roleEl: HTMLDivElement;
  private textEl: HTMLParagraphElement;
  private onNext: (() => void) | null = null;
  private onClose: (() => void) | null = null;
  open = false;

  constructor() {
    const style = document.createElement('style');
    style.textContent = `
      .dlg { position: fixed; left: 50%; bottom: calc(28px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
        width: min(640px, calc(100vw - 32px)); box-sizing: border-box; padding: 18px 22px 16px;
        background: linear-gradient(180deg, rgba(22,10,9,.94), rgba(10,5,5,.96));
        border: 1px solid #5a2a20; box-shadow: 0 0 0 1px #1a0a08, 0 12px 40px rgba(0,0,0,.6), inset 0 0 30px rgba(120,30,20,.15);
        color: #d8c8b8; font: 15px/1.55 'EB Garamond', Georgia, serif; z-index: 10; }
      .dlg[hidden] { display: none; }
      .dlg-name { font: 600 18px/1.2 'Cinzel', 'Trajan Pro', Georgia, serif; letter-spacing: .06em; color: #e8b070; }
      .dlg-role { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: #9a7a6a; margin-top: 2px; }
      .dlg-text { margin: 10px 0 14px; text-wrap: pretty; }
      .dlg-actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
      .dlg button { font: 600 13px/1 'Cinzel', Georgia, serif; letter-spacing: .08em; color: #e8d0b0; background: #2a1210;
        border: 1px solid #6a3424; padding: 9px 14px; cursor: pointer; }
      .dlg button:hover, .dlg button:focus-visible { background: #3a1814; border-color: #a85a3a; outline: none; }
    `;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'dlg';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="dlg-name"></div>
      <div class="dlg-role"></div>
      <p class="dlg-text"></p>
      <div class="dlg-actions">
        <button type="button" id="dlg-next">Ask more</button>
        <button type="button" id="dlg-close">Farewell</button>
      </div>`;
    document.body.appendChild(this.root);
    this.nameEl = this.root.querySelector('.dlg-name')!;
    this.roleEl = this.root.querySelector('.dlg-role')!;
    this.textEl = this.root.querySelector('.dlg-text')!;
    // Clicks on the panel shouldn't fall through to click-to-move.
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.querySelector('#dlg-next')!.addEventListener('click', () => this.onNext?.());
    this.root.querySelector('#dlg-close')!.addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.close();
    });
  }

  show(name: string, role: string, text: string, onNext: () => void, onClose: () => void) {
    this.nameEl.textContent = name;
    this.roleEl.textContent = role;
    this.textEl.textContent = text;
    this.onNext = onNext;
    this.onClose = onClose;
    this.root.hidden = false;
    this.open = true;
  }

  setText(text: string) {
    this.textEl.textContent = text;
  }

  close() {
    if (!this.open) return;
    this.root.hidden = true;
    this.open = false;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }
}
