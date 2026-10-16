import { store } from '../engine/store';

// Player options: sound levels, graphics quality, screen shake and key
// bindings. Kept in this browser's storage, separate from the hero saves, so
// every hero shares them. Listeners hear every change and apply it live.

export type Quality = 'low' | 'medium' | 'high';
export type Preset = Quality | 'custom';

export interface Graphics {
  preset: Preset;
  /** Ambient occlusion (GTAO), the costliest post effect. */
  ao: boolean;
  bloom: boolean;
  /** 4× multisampled scene. */
  msaa: boolean;
  shadows: Quality;
  /** Share of the drifting ground mist cards drawn, 0 to 1. */
  mist: number;
  /** Highest device pixel ratio rendered (sharpness on high-density screens). */
  maxDpr: number;
  /** Render resolution as a share of the screen's, 0.5 to 1. */
  scale: number;
}

export const ACTIONS = [
  ['potion', 'Drink potion'],
  ['skill1', 'Skill slot 2'],
  ['skill2', 'Skill slot 3'],
  ['skill3', 'Skill slot 4'],
  ['skill4', 'Skill slot 5'],
  ['portal', 'Town portal'],
  ['inventory', 'Inventory'],
  ['skills', 'Skill tree'],
  ['quests', 'Quest log'],
  ['map', 'Map'],
  ['zoomIn', 'Minimap zoom in'],
  ['zoomOut', 'Minimap zoom out'],
  ['rotateLeft', 'Rotate camera left'],
  ['rotateRight', 'Rotate camera right'],
  ['mute', 'Sound on / off'],
] as const;
export type Action = (typeof ACTIONS)[number][0];

const DEFAULT_KEYS: Record<Action, string[]> = {
  potion: ['Digit1'],
  skill1: ['Digit2'],
  skill2: ['Digit3'],
  skill3: ['Digit4'],
  skill4: ['Digit5'],
  portal: ['KeyT'],
  inventory: ['KeyI', 'KeyB'],
  skills: ['KeyK'],
  quests: ['KeyL', 'KeyJ'],
  map: ['KeyM', 'Tab'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
  rotateLeft: ['KeyQ'],
  rotateRight: ['KeyE'],
  mute: ['KeyN'],
};

/** Keys the game or the browser keeps for itself. */
export const RESERVED = new Set(['Escape', 'F3', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu', 'PrintScreen']);

export const PRESETS: Record<Quality, Omit<Graphics, 'preset' | 'scale'>> = {
  // Laptops and handhelds: no AO or MSAA, a smaller shadow map, light mist,
  // and never above one pixel per CSS pixel.
  low: { ao: false, bloom: true, msaa: false, shadows: 'low', mist: 0.35, maxDpr: 1 },
  medium: { ao: true, bloom: true, msaa: false, shadows: 'medium', mist: 0.7, maxDpr: 1.5 },
  high: { ao: true, bloom: true, msaa: true, shadows: 'high', mist: 1, maxDpr: 2 },
};

export const SHADOW_SIZE: Record<Quality, number> = { low: 1024, medium: 2048, high: 2048 };

export interface SettingsData {
  volume: { master: number; music: number; effects: number };
  graphics: Graphics;
  /** Screen shake strength, 0 to 1. */
  shake: number;
  showFps: boolean;
  keys: Record<Action, string[]>;
}

const KEY = 'arpg.settings';

function defaults(): SettingsData {
  return {
    volume: { master: 1, music: 1, effects: 1 },
    graphics: { preset: 'high', scale: 1, ...PRESETS.high },
    shake: 1,
    showFps: false,
    keys: structuredClone(DEFAULT_KEYS),
  };
}

const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

/** Reads stored options over the defaults, ignoring anything malformed. */
function load(): SettingsData {
  const d = defaults();
  let raw: Partial<SettingsData> | null = null;
  try {
    raw = JSON.parse(store.get(KEY) ?? 'null');
  } catch {
    /* storage unavailable or corrupt */
  }
  if (!raw || typeof raw !== 'object') return d;
  const v = raw.volume;
  if (v) d.volume = { master: clamp01(v.master, 1), music: clamp01(v.music, 1), effects: clamp01(v.effects, 1) };
  const g = raw.graphics;
  if (g) {
    const q = (x: unknown, def: Quality): Quality => (x === 'low' || x === 'medium' || x === 'high' ? x : def);
    d.graphics = {
      preset: g.preset === 'custom' ? 'custom' : q(g.preset, 'high'),
      ao: g.ao !== false,
      bloom: g.bloom !== false,
      msaa: g.msaa !== false,
      shadows: q(g.shadows, 'high'),
      mist: clamp01(g.mist, 1),
      maxDpr: typeof g.maxDpr === 'number' ? Math.min(2, Math.max(1, g.maxDpr)) : 2,
      scale: Math.max(0.5, clamp01(g.scale, 1)),
    };
  }
  d.shake = clamp01(raw.shake, 1);
  d.showFps = raw.showFps === true;
  if (raw.keys && typeof raw.keys === 'object') {
    for (const [a] of ACTIONS) {
      const k = (raw.keys as Record<string, unknown>)[a];
      if (Array.isArray(k)) d.keys[a] = k.filter((c): c is string => typeof c === 'string' && !RESERVED.has(c)).slice(0, 2);
    }
  }
  return d;
}

class Settings {
  data: SettingsData = load();
  private listeners = new Set<(s: SettingsData) => void>();
  /** Key labels from the player's own keyboard layout, where the browser tells us. */
  private layout = new Map<string, string>();

  constructor() {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
    try {
      kb?.getLayoutMap?.()
        .then((m) => {
          m.forEach((v, k) => this.layout.set(k, v));
          this.emit();
        })
        .catch(() => {});
    } catch {
      /* not allowed in this frame */
    }
  }

  /** Calls `fn` now and after every change; returns an unsubscribe. */
  watch(fn: (s: SettingsData) => void) {
    this.listeners.add(fn);
    fn(this.data);
    return () => this.listeners.delete(fn);
  }

  /** Changes options in place, then saves and tells every listener. */
  update(fn: (s: SettingsData) => void) {
    fn(this.data);
    try {
      store.set(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable: the change lasts this session */
    }
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn(this.data);
  }

  applyPreset(q: Quality) {
    this.update((s) => Object.assign(s.graphics, PRESETS[q], { preset: q }));
  }

  /** Changes one graphics option; the preset becomes Custom unless it still matches one. */
  setGraphics<K extends keyof Graphics>(key: K, value: Graphics[K]) {
    this.update((s) => {
      s.graphics[key] = value;
      const g = s.graphics;
      const match = (Object.keys(PRESETS) as Quality[]).find((q) => (Object.keys(PRESETS[q]) as (keyof typeof PRESETS.low)[]).every((k) => PRESETS[q][k] === g[k]));
      g.preset = match ?? 'custom';
    });
  }

  resetGraphics() {
    this.update((s) => (s.graphics = defaults().graphics));
  }

  resetKeys() {
    this.update((s) => (s.keys = structuredClone(DEFAULT_KEYS)));
  }

  /**
   * Binds `code` to `action` in slot 0 (main) or 1 (alternate). A key bound
   * elsewhere moves here; the action it left is returned so the menu can say so.
   */
  bind(action: Action, slot: number, code: string): Action | null {
    let moved: Action | null = null;
    this.update((s) => {
      for (const [a] of ACTIONS) {
        if (a === action) continue;
        const i = s.keys[a].indexOf(code);
        if (i >= 0) {
          s.keys[a].splice(i, 1);
          moved = a;
        }
      }
      // The new key replaces whatever held that slot.
      const keys = s.keys[action].slice(0, 2);
      const was = keys.indexOf(code);
      if (was >= 0 && was !== slot) keys.splice(was, 1);
      keys[Math.min(slot, keys.length)] = code;
      s.keys[action] = keys.filter(Boolean).slice(0, 2);
    });
    return moved;
  }

  unbind(action: Action, slot: number) {
    this.update((s) => s.keys[action].splice(slot, 1));
  }

  /** True if the key event is bound to `action`. */
  is(action: Action, e: KeyboardEvent) {
    return this.data.keys[action].includes(codeOf(e));
  }

  /** The action a key event triggers, if any. */
  actionFor(e: KeyboardEvent): Action | null {
    const c = codeOf(e);
    for (const [a] of ACTIONS) if (this.data.keys[a].includes(c)) return a;
    return null;
  }

  /** Short label of a key code, as printed on the player's keyboard. */
  label(code: string): string {
    const named = NAMES[code];
    if (named) return named;
    if (code.startsWith('Numpad')) return `Num ${NAMES[code.slice(6)] ?? code.slice(6)}`;
    const l = this.layout.get(code);
    if (l && l.trim()) return l.toUpperCase();
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code;
  }

  /** Label of an action's main key, or a dash when it has none. */
  keyOf(action: Action): string {
    const c = this.data.keys[action][0];
    return c ? this.label(c) : '–';
  }

  /** Key label of a belt slot: slot 0 is the right mouse button. */
  beltLabel(slot: number): string {
    return slot === 0 ? 'RMB' : this.keyOf(`skill${slot}` as Action);
  }

  /** Both keys of an action, joined for help text. */
  keysOf(action: Action): string {
    const k = this.data.keys[action];
    return k.length ? k.map((c) => this.label(c)).join(' / ') : 'unbound';
  }
}

/** The physical key, or a guess from the character when the browser gives none. */
function codeOf(e: KeyboardEvent): string {
  if (e.code) return e.code;
  const k = e.key;
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  return k;
}

const NAMES: Record<string, string> = {
  Tab: 'Tab',
  Space: 'Space',
  Enter: 'Enter',
  Backspace: 'Backspace',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  CapsLock: 'Caps',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Insert: 'Ins',
  Delete: 'Del',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Add: '+',
  Subtract: '−',
  Multiply: '×',
  Divide: '÷',
  Decimal: '.',
  Equal: '=',
  Minus: '−',
};

export const settings = new Settings();
