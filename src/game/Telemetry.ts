import type * as THREE from 'three';
import { loading } from '../engine/Loading';
import type { Monster } from '../actors/Monster';
import type { Stats } from './Stats';

// Combat telemetry: counts what happens in real play (damage both ways,
// kills, deaths, potions, time in combat) bucketed by area and hero level,
// and writes each play session as one document to the artifact's `db`
// capability at runs/<viewer id>/sessions/<session id>. That store lives
// server-side and survives republishes, so balance can be tuned from data.
//
// The hooks elsewhere are one-liners and only bump counters. Everything is
// best-effort: with no `window.claude` (local dev, signed out, not served)
// the aggregate still builds in memory and nothing is ever written; no hook
// throws and nothing waits on the network.

declare global {
  interface Window {
    claude?: { use(name: string): Promise<any> };
    __telemetry?: unknown;
  }
}
declare const __BUILD_TIME__: string;

/** Seconds between periodic writes while there is new data. */
const FLUSH_EVERY = 45;

let device: Record<string, unknown> | null = null;
/** The browser and graphics card, so stalls can be compared across machines. */
function deviceInfo() {
  if (device) return device;
  device = { ua: navigator.userAgent.slice(0, 160), cores: navigator.hardwareConcurrency, dpr: window.devicePixelRatio, w: window.innerWidth, h: window.innerHeight };
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) device.gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0, 120);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* unknown */
  }
  return device;
}
/** After a hit or a blow struck, the hero counts as in combat this long. */
const COMBAT_LINGER = 4;
const MAX_DEATHS = 40;
const MAX_LEVELUPS = 100;
const MAX_SOURCES = 30;
/** Past this serialized size the session rolls over into a new document. */
const ROLL_BYTES = 150_000;
const RECENT = 64;

interface Src {
  hits: number;
  dmg: number;
  max: number;
}

interface MonSample {
  /** Lowest and highest level seen; the numbers below are at the highest. */
  lv: [number, number];
  maxHp: number;
  /** Damage range after level and elite scaling, and the kind's base range. */
  dmg: [number, number];
  baseDmg: [number, number];
  armor: number;
  seen: number;
}

interface Bucket {
  zone: string;
  level: number;
  secTotal: number;
  secCombat: number;
  dmgDealt: number;
  dmgTaken: number;
  hitsTaken: number;
  maxHitTaken: number;
  kills: Record<string, number>;
  deaths: number;
  potions: number;
  ttk: Record<string, { n: number; sum: number }>;
  sources: Record<string, Src>;
  player: Record<string, unknown>;
  monsters: Record<string, MonSample>;
}

interface Death {
  at: string;
  sec: number;
  zone: string;
  level: number;
  killer: string;
  attack: string;
  maxHp: number;
  potionsLeft: number;
  last5s: Record<string, number>;
}

/** Ranged kinds throw bolts; these melee kinds have a named blow. */
const MELEE_NAMES: Partial<Record<string, string>> = {
  brute: 'slam',
  butcher: 'slam',
  maiden: 'slam',
  rootHorror: 'roots',
  weeper: 'wail',
  chainWraith: 'chains',
  leech: 'drain',
  toad: 'leap',
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function monKey(m: Monster) {
  return m.spawn.boss ? `${m.kind}#boss` : m.elite ? `${m.kind}#elite` : m.kind;
}

function buildVersion() {
  try {
    return typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'dev';
  } catch {
    return 'dev';
  }
}

function newSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class Telemetry {
  private stats: Stats | null = null;
  private sessionId = newSessionId();
  private part = 1;
  private startedAt = new Date().toISOString();
  private playSec = 0;
  private combatSec = 0;
  private buckets: Record<string, Bucket> = {};
  private bucket: Bucket | null = null;
  private zone = '';
  private level = 0;
  private deaths: Death[] = [];
  private levelUps: { level: number; sec: number }[] = [];
  private firstHit = new WeakMap<Monster, number>();
  private sampledIn = new WeakMap<Monster, Bucket>();
  /** The hero's life as last seen, so a killing blow counts only what was left. */
  private hpSeen = 0;
  private lastFight = -999;
  // Ring of recent incoming hits, for the death breakdown.
  private recentT = new Float64Array(RECENT);
  private recentD = new Float64Array(RECENT);
  private recentS: string[] = new Array<string>(RECENT).fill('');
  private recentI = 0;
  private pending: { kind: string; attack: string } | null = null;
  // Store.
  private db: any = null;
  private uid: string | null = null;
  private off = false;
  private dirty = false;
  private flushing = false;
  private again = false;
  private sinceFlush = 0;
  private every = FLUSH_EVERY;
  lastError: string | null = null;
  writes = 0;
  lastBytes = 0;

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      void this.connect();
      this.watchFrames();
      const away = () => void this.flush('hidden');
      window.addEventListener('pagehide', away);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') away();
      });
      if (import.meta.env.DEV || new URLSearchParams(location.search).has('telemetry')) {
        window.__telemetry = { t: this, doc: () => this.doc(), flush: () => this.flush('manual') };
      }
    } catch {
      /* telemetry is optional */
    }
  }

  private async connect() {
    try {
      const c = window.claude;
      if (!c || typeof c.use !== 'function') return;
      const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      this.db = db;
      this.uid = uid;
      // Data gathered before the store answered goes out soon.
      if (this.dirty) this.sinceFlush = Math.max(this.sinceFlush, this.every - 5);
    } catch {
      /* no store: keep counting in memory */
    }
  }

  // ---- Hooks ----------------------------------------------------------------

  /** Once per game frame (not while paused). */
  tick(dt: number, zone: string, stats: Stats, hunted: boolean) {
    try {
      if (stats !== this.stats) this.begin(stats);
      if (zone !== this.zone || stats.level !== this.level) this.enter(zone, stats);
      const b = this.bucket!;
      this.playSec += dt;
      this.hpSeen = stats.hp;
      b.secTotal += dt;
      if (hunted || this.playSec - this.lastFight < COMBAT_LINGER) {
        b.secCombat += dt;
        this.combatSec += dt;
        this.dirty = true;
      }
      this.sinceFlush += dt;
      // Writes go out at quiet moments only (area changes, page hidden,
      // death); the timer is a fallback and waits for a lull in the fighting.
      const calm = !hunted && this.playSec - this.lastFight > 8;
      if (this.dirty && calm && this.sinceFlush >= Math.max(this.every, 180)) void this.flush('timer');
    } catch {
      /* never break the frame */
    }
  }

  /** Notes something that just happened, so a stall right after it can be traced to it. */
  mark(label: string) {
    this.marks[this.markI] = label;
    this.markT[this.markI] = performance.now();
    this.markI = (this.markI + 1) % 4;
  }
  private marks = ['', '', '', ''];
  private markT = [0, 0, 0, 0];
  private markI = 0;
  private hitches: { sec: number; ms: number; zone: string; step: string; stepAgoMs: number; recent: string[]; flushing: boolean }[] = [];

  /** Watches frame gaps; a long one is logged with what was going on around it. */
  private watchFrames() {
    let last = performance.now();
    const frame = () => {
      const now = performance.now();
      const gap = now - last;
      last = now;
      if (gap > 250 && gap < 20000 && document.visibilityState === 'visible') {
        const recent: string[] = [];
        for (let i = 0; i < 4; i++) if (this.marks[i] && now - this.markT[i] < gap + 3000) recent.push(`${this.marks[i]}@-${Math.round(now - this.markT[i])}ms`);
        this.hitches.push({
          sec: Math.round(this.playSec),
          ms: Math.round(gap),
          zone: this.zone,
          step: loading.lastStep,
          stepAgoMs: Math.round(now - loading.lastStepAt),
          recent,
          flushing: this.flushing,
        });
        if (this.hitches.length > 60) this.hitches.shift();
        this.dirty = true;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** A boss names the ability whose blow is about to land. */
  source(m: Monster, attack: string) {
    this.pending = { kind: monKey(m), attack };
  }

  /** The hero struck a monster for `dealt` (after armour). */
  dealt(m: Monster, dealt: number) {
    const b = this.bucket;
    if (!b || dealt <= 0) return;
    b.dmgDealt += dealt;
    this.lastFight = this.playSec;
    this.dirty = true;
    if (!this.firstHit.has(m)) this.firstHit.set(m, this.playSec);
    this.sample(b, m);
  }

  /** A monster died to the hero. */
  kill(m: Monster) {
    const b = this.bucket;
    if (!b) return;
    const k = monKey(m);
    b.kills[k] = (b.kills[k] ?? 0) + 1;
    const first = this.firstHit.get(m);
    if (first !== undefined) {
      const t = (b.ttk[k] ??= { n: 0, sum: 0 });
      t.n++;
      t.sum += this.playSec - first;
    }
    this.dirty = true;
  }

  potion() {
    if (this.bucket) this.bucket.potions++;
    this.dirty = true;
  }

  /** The hero was hit: `dealt` after armour; `from` is what Monster/Boss passed. */
  playerHit(dealt: number, from: THREE.Vector3, monsters: readonly Monster[], dead: boolean) {
    const pending = this.pending;
    this.pending = null;
    const b = this.bucket;
    if (!b || dealt <= 0) return;
    try {
      let kind = pending?.kind ?? 'unknown';
      let attack = pending?.attack ?? 'hit';
      if (!pending) {
        const m = this.attacker(from, monsters);
        if (m) {
          kind = monKey(m);
          attack = m.def.ranged ? 'bolt' : (MELEE_NAMES[m.kind] ?? 'melee');
          this.sample(b, m);
        }
      }
      const key = `${kind}:${attack}`;
      // Overkill on the last blow is not damage taken.
      if (dead) dealt = Math.min(dealt, Math.max(0, this.hpSeen));
      this.hpSeen = this.stats?.hp ?? 0;
      b.dmgTaken += dealt;
      b.hitsTaken++;
      if (dealt > b.maxHitTaken) b.maxHitTaken = dealt;
      let s = b.sources[key];
      if (!s) {
        if (Object.keys(b.sources).length >= MAX_SOURCES * 2) this.pruneSources(b);
        s = b.sources[key] = { hits: 0, dmg: 0, max: 0 };
      }
      s.hits++;
      s.dmg += dealt;
      if (dealt > s.max) s.max = dealt;
      const i = this.recentI;
      this.recentT[i] = this.playSec;
      this.recentD[i] = dealt;
      this.recentS[i] = key;
      this.recentI = (i + 1) % RECENT;
      this.lastFight = this.playSec;
      this.dirty = true;
      if (dead) this.death(b, kind, attack);
    } catch {
      /* ignore */
    }
  }

  // ---- Aggregation ------------------------------------------------------------

  private begin(stats: Stats) {
    if (this.stats) {
      // A different hero in the same page: the old session is done.
      void this.flush('switch');
      this.reset();
    }
    this.stats = stats;
    this.level = stats.level;
  }

  private reset() {
    this.sessionId = newSessionId();
    this.part = 1;
    this.startedAt = new Date().toISOString();
    this.playSec = this.combatSec = 0;
    this.clearData();
  }

  private clearData() {
    this.buckets = {};
    this.bucket = null;
    this.zone = '';
    this.deaths = [];
    this.levelUps = [];
    this.recentS.fill('');
  }

  private enter(zone: string, stats: Stats) {
    if (stats.level > this.level && this.zone) {
      for (let lv = this.level + 1; lv <= stats.level; lv++) {
        this.levelUps.push({ level: lv, sec: Math.round(this.playSec) });
      }
      if (this.levelUps.length > MAX_LEVELUPS) this.levelUps.splice(0, this.levelUps.length - MAX_LEVELUPS);
      this.dirty = true;
    }
    this.zone = zone;
    this.level = stats.level;
    const key = `${zone}|${stats.level}`;
    let b = this.buckets[key];
    if (!b) {
      b = this.buckets[key] = {
        zone,
        level: stats.level,
        secTotal: 0,
        secCombat: 0,
        dmgDealt: 0,
        dmgTaken: 0,
        hitsTaken: 0,
        maxHitTaken: 0,
        kills: {},
        deaths: 0,
        potions: 0,
        ttk: {},
        sources: {},
        player: {},
        monsters: {},
      };
    }
    b.player = this.snapshot(stats);
    this.bucket = b;
  }

  private snapshot(s: Stats): Record<string, unknown> {
    const gear: Record<string, string> = {};
    let ilvl = 0;
    let n = 0;
    for (const [slot, it] of Object.entries(s.equipped)) {
      if (!it) continue;
      gear[slot] = `${it.rarity}:${it.level}`;
      ilvl += it.level;
      n++;
    }
    return {
      maxHp: s.maxHp,
      maxMana: s.maxMana,
      armor: s.armor,
      dmg: [s.dmgMin, s.dmgMax],
      swingSec: r2(s.swingTime),
      attackSpeed: r2(s.attackSpeed),
      critPct: r2(s.crit * 100),
      lifeStealPct: r2(s.lifeSteal * 100),
      regen: r2(s.regen),
      potions: s.potions,
      gear,
      avgItemLevel: n ? r2(ilvl / n) : 0,
      skills: { ...s.ranks },
    };
  }

  private sample(b: Bucket, m: Monster) {
    if (this.sampledIn.get(m) === b) return;
    this.sampledIn.set(m, b);
    const k = monKey(m);
    // Scaled damage and armour are protected on Monster; read them as data.
    const x = m as unknown as { dmg?: [number, number]; armor?: number };
    const dmg: [number, number] = x.dmg ? [r2(x.dmg[0]), r2(x.dmg[1])] : [m.def.dmg[0], m.def.dmg[1]];
    const s = b.monsters[k];
    if (!s) {
      b.monsters[k] = { lv: [m.level, m.level], maxHp: m.maxHp, dmg, baseDmg: [m.def.dmg[0], m.def.dmg[1]], armor: r2(x.armor ?? 0), seen: 1 };
      return;
    }
    s.seen++;
    if (m.level < s.lv[0]) s.lv[0] = m.level;
    if (m.level >= s.lv[1]) {
      s.lv[1] = m.level;
      s.maxHp = m.maxHp;
      s.dmg = dmg;
      s.armor = r2(x.armor ?? 0);
    }
  }

  /** Who struck from `from`: the monster whose position it is, else the nearest. */
  private attacker(from: THREE.Vector3, monsters: readonly Monster[]): Monster | null {
    let best: Monster | null = null;
    let bestD = 16;
    for (const m of monsters) {
      if (m.position === from) return m;
      const d = (m.position.x - from.x) ** 2 + (m.position.z - from.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  private pruneSources(b: Bucket) {
    const keep = Object.entries(b.sources)
      .sort((x, y) => y[1].dmg - x[1].dmg)
      .slice(0, MAX_SOURCES);
    b.sources = Object.fromEntries(keep);
  }

  private death(b: Bucket, kind: string, attack: string) {
    b.deaths++;
    const last5s: Record<string, number> = {};
    for (let i = 0; i < RECENT; i++) {
      const key = this.recentS[i];
      if (key && this.playSec - this.recentT[i] <= 5) last5s[key] = (last5s[key] ?? 0) + this.recentD[i];
    }
    this.deaths.push({
      at: new Date().toISOString(),
      sec: Math.round(this.playSec),
      zone: b.zone,
      level: b.level,
      killer: kind,
      attack,
      maxHp: this.stats?.maxHp ?? 0,
      potionsLeft: this.stats?.potions ?? 0,
      last5s,
    });
    if (this.deaths.length > MAX_DEATHS) this.deaths.splice(0, this.deaths.length - MAX_DEATHS);
    void this.flush('death');
  }

  // ---- Document -----------------------------------------------------------------

  /** The session as written to the store (also handy to inspect). */
  doc(): Record<string, unknown> {
    const buckets: Record<string, unknown> = {};
    for (const [key, b] of Object.entries(this.buckets)) {
      const ttk: Record<string, { n: number; mean: number }> = {};
      for (const [k, t] of Object.entries(b.ttk)) ttk[k] = { n: t.n, mean: r2(t.sum / t.n) };
      const sources = Object.keys(b.sources).length > MAX_SOURCES ? Object.fromEntries(Object.entries(b.sources).sort((x, y) => y[1].dmg - x[1].dmg).slice(0, MAX_SOURCES)) : b.sources;
      buckets[key] = {
        zone: b.zone,
        level: b.level,
        secTotal: Math.round(b.secTotal),
        secCombat: Math.round(b.secCombat),
        dmgDealt: Math.round(b.dmgDealt),
        dmgTaken: Math.round(b.dmgTaken),
        hitsTaken: b.hitsTaken,
        maxHitTaken: Math.round(b.maxHitTaken),
        kills: b.kills,
        deaths: b.deaths,
        potions: b.potions,
        ttk,
        sources,
        player: b.player,
        monsters: b.monsters,
      };
    }
    const s = this.stats;
    return {
      schema: 1,
      version: buildVersion(),
      sessionId: this.sessionId,
      part: this.part,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      cls: s?.cls.id ?? '',
      level: s?.level ?? 0,
      playSec: Math.round(this.playSec),
      combatSec: Math.round(this.combatSec),
      buckets,
      deaths: this.deaths,
      levelUps: this.levelUps,
      hitches: this.hitches,
      device: deviceInfo(),
    };
  }

  /** Writes the whole session document now (one write in flight at a time). */
  async flush(reason: string): Promise<void> {
    this.mark(`flush:${reason}`);
    if (!this.dirty || this.off) return;
    if (this.flushing) {
      this.again = true;
      return;
    }
    this.sinceFlush = 0;
    const db = this.db;
    const uid = this.uid;
    let body: Record<string, unknown>;
    let bytes = 0;
    try {
      body = JSON.parse(JSON.stringify(this.doc(), (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? r2(v) : v)));
      bytes = JSON.stringify(body).length;
      this.lastBytes = bytes;
    } catch {
      return;
    }
    if (!db || !uid) {
      // Nowhere to write; keep memory bounded all the same.
      if (bytes > ROLL_BYTES) this.roll();
      return;
    }
    this.flushing = true;
    this.dirty = false;
    try {
      await db.doc(`runs/${uid}/sessions/${this.sessionId}`).set(body);
      this.writes++;
      this.every = FLUSH_EVERY;
      this.lastError = null;
      if (bytes > ROLL_BYTES) this.roll();
    } catch (e) {
      const code = (e as { code?: string } | null)?.code ?? 'error';
      this.lastError = code;
      this.dirty = true;
      if (code === 'resource_exhausted') this.every = Math.min(this.every * 2, 600);
      else if (code === 'revoked' || code === 'quota_exceeded' || e instanceof TypeError) this.off = true;
      else if (code === 'invalid_argument') this.roll();
    } finally {
      this.flushing = false;
    }
    if (this.again) {
      this.again = false;
      void this.flush('again');
    }
  }

  /** Starts a fresh document for the same session once one grows large. */
  private roll() {
    this.part++;
    this.sessionId = `${this.sessionId.replace(/-p\d+$/, '')}-p${this.part}`;
    const zone = this.zone;
    this.clearData();
    if (this.stats && zone) this.enter(zone, this.stats);
  }
}

export const telemetry = new Telemetry();
