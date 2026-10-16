// Where the game keeps what it remembers: hero saves, options and small
// preferences, as text under string keys. In a browser that is localStorage.
// In the desktop build the Electron preload script offers `window.desktop`,
// and every key becomes a file in the player's save folder, which is what
// Steam Cloud syncs. The calls are synchronous either way.

interface Backend {
  keys(): string[];
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/** What desktop/preload.cjs exposes. */
export interface DesktopBridge {
  store: Backend;
  /** Folder the save files live in, for display. */
  saveDir: string;
  quit(): void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

const browser: Backend = {
  keys() {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null) out.push(k);
    }
    return out;
  },
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
  remove: (k) => localStorage.removeItem(k),
};

/** The desktop app's bridge, when running inside it. */
export const desktop: DesktopBridge | null = typeof window !== 'undefined' && window.desktop ? window.desktop : null;

/**
 * The game's storage. Calls throw like localStorage does when storage is
 * refused (private browsing, a full disk), so callers keep their try/catch.
 */
export const store: Backend = desktop ? desktop.store : browser;
