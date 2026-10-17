// Procedural doom metal. A seeded generator writes slow riffs in a dark
// mode, arranges them into a song (intro, riffs, a crushing breakdown, a
// lead), plays them on synthesised down-tuned guitars, bass and drums, then
// writes a new song when it ends. In town only a low drone and a slow clean
// arpeggio play; out in the wastes the band comes in, and fights bring the
// full kit.

import { MireMusic, type ScoreKind } from './MireMusic';

export type Mood = 'town' | 'explore' | 'combat';

type Rng = () => number;
function rngFrom(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: Rng, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
function weighted<T>(r: Rng, xs: readonly [T, number][]): T {
  let s = 0;
  for (const [, w] of xs) s += w;
  let x = r() * s;
  for (const [v, w] of xs) if ((x -= w) <= 0) return v;
  return xs[xs.length - 1][0];
}

/** One note of a riff: start and length in 16th steps, semitones above the root. */
interface Note {
  step: number;
  len: number;
  deg: number;
  mute: boolean;
}
type DrumStyle = 'none' | 'crash' | 'half' | 'gallop' | 'pound';
interface Section {
  riff: Note[];
  /** Times the 2-bar riff repeats. */
  reps: number;
  drums: DrumStyle;
  lead: number[] | null;
}

const ROOT = 65.41; // C2: a guitar in drop C
const STEPS = 32; // a riff is two bars of 16ths
const SCALE = [0, 1, 3, 5, 6, 7, 8, 10] as const; // phrygian with a flat fifth

function makeRiff(r: Rng, heavy: boolean): Note[] {
  const notes: Note[] = [];
  let pos = 0;
  while (pos < STEPS) {
    // Chugging runs of palm-muted root notes between the big chords.
    if (pos > 0 && r() < (heavy ? 0.22 : 0.1) && pos <= STEPS - 4) {
      const n = pick(r, [2, 3, 4]);
      for (let i = 0; i < n; i++) notes.push({ step: pos + i, len: 1, deg: 0, mute: true });
      pos += n;
      continue;
    }
    const len = Math.min(STEPS - pos, weighted(r, [[2, 0.12], [4, 0.28], [6, 0.18], [8, 0.24], [12, 0.12], [16, 0.06]] as [number, number][]));
    const deg = pos === 0 ? 0 : weighted(r, [[0, 0.45], [1, 0.14], [3, 0.12], [5, 0.08], [6, 0.1], [7, 0.06], [-2, 0.05]] as [number, number][]);
    notes.push({ step: pos, len, deg, mute: false });
    pos += len;
  }
  return notes;
}

function makeLead(r: Rng): number[] {
  // One pitch per half bar, a slow walk over the scale an octave up.
  const tones = [...SCALE.map((d) => d + 12), ...SCALE.map((d) => d + 24)];
  let i = 2 + Math.floor(r() * 5);
  const out: number[] = [];
  for (let k = 0; k < 4; k++) {
    out.push(tones[i]);
    i = Math.max(0, Math.min(tones.length - 1, i + pick(r, [-2, -1, -1, 1, 1, 2])));
  }
  return out;
}

function makeSong(seed: number): { sections: Section[]; tempo: number } {
  const r = rngFrom(seed);
  const A = makeRiff(r, false);
  const B = makeRiff(r, true);
  const breakdown: Note[] = [];
  // Breakdown: a few vast chords left to ring.
  let pos = 0;
  for (const d of [0, pick(r, [1, 6]), pick(r, [3, 5]), pick(r, [0, -2])]) {
    breakdown.push({ step: pos, len: 8, deg: d, mute: false });
    pos += 8;
  }
  const lead = makeLead(r);
  return {
    tempo: 58 + Math.floor(r() * 14),
    sections: [
      { riff: [{ step: 0, len: 32, deg: 0, mute: false }], reps: 1, drums: 'crash', lead: null },
      { riff: A, reps: 2, drums: 'half', lead: null },
      { riff: B, reps: 2, drums: r() < 0.5 ? 'gallop' : 'pound', lead: null },
      { riff: A, reps: 2, drums: 'half', lead },
      { riff: breakdown, reps: 2, drums: 'crash', lead: null },
      { riff: B, reps: 2, drums: 'pound', lead: null },
      { riff: A, reps: 1, drums: 'half', lead },
    ],
  };
}

export class Music {
  private bus: GainNode;
  private band: GainNode;
  private drums: GainNode;
  private pad: GainNode;
  private guitars: GainNode[] = [];
  private bass: GainNode;
  private noise: AudioBuffer;
  private timer = 0;
  private next = 0; // audio time of the next 16th step
  private song = makeSong(Math.floor(Math.random() * 1e9));
  private section = 0;
  private rep = 0;
  private step = 0;
  private mood: Mood = 'town';
  private area = 'town';
  private seed = Math.floor(Math.random() * 1e9);
  private arpRng = rngFrom(7);
  /** The Bleeding Mire and its gaol have their own scores; the band rests while one plays. */
  private scores: Partial<Record<ScoreKind, MireMusic>> = {};
  private mireSince = -1;
  private out: AudioNode;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
    private reverb: AudioNode,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.45;
    this.bus.connect(out);
    this.band = this.gain(0, this.bus);
    this.drums = this.gain(0, this.bus);
    this.pad = this.gain(0, this.bus);

    // Two guitar tracks hard left and right, each through its own amp:
    // high-pass, heavy fuzz, then a cabinet curve (scooped mids, no fizz).
    const shaper = fuzz(160);
    for (const pan of [-0.75, 0.75]) {
      const input = ctx.createGain();
      input.gain.value = 0.6;
      const hp = this.filter('highpass', 120, 0.7);
      const ws = ctx.createWaveShaper();
      ws.curve = shaper;
      ws.oversample = '4x';
      const low = this.filter('peaking', 140, 1, 2);
      const scoop = this.filter('peaking', 750, 1.2, -6);
      const lp = this.filter('lowpass', 3800, 0.8);
      const lp2 = this.filter('lowpass', 5200, 0.7);
      const level = this.gain(0.26);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      input.connect(hp).connect(ws).connect(low).connect(scoop).connect(lp).connect(lp2).connect(level).connect(p).connect(this.band);
      const send = this.gain(0.12);
      p.connect(send).connect(reverb);
      this.guitars.push(input);
    }
    // Bass: a growl under the guitars.
    this.bass = ctx.createGain();
    this.bass.gain.value = 0.5;
    const bws = ctx.createWaveShaper();
    bws.curve = fuzz(6);
    this.bass.connect(bws).connect(this.filter('lowpass', 520, 0.9)).connect(this.gain(0.32, this.band));

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.startDrone();
    this.out = out;
  }

  start() {
    this.next = this.ctx.currentTime + 0.2;
    this.applyMood();
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  stop() {
    window.clearInterval(this.timer);
  }

  setArea(name: string) {
    this.area = name;
    this.applyMood();
  }

  setMood(m: Mood) {
    if (m === this.mood) return;
    this.mood = m;
    this.applyMood();
  }

  private get effective(): Mood {
    return this.area === 'town' ? 'town' : this.mood === 'town' ? 'explore' : this.mood;
  }

  private applyMood() {
    const t = this.ctx.currentTime;
    const m = this.effective;
    const kind: ScoreKind | null = this.area === 'swamp' ? 'mire' : this.area === 'gaol1' || this.area === 'gaol2' || this.area === 'road' || this.area === 'ossuary' ? this.area : null;
    if (kind && !this.scores[kind]) this.scores[kind] = new MireMusic(this.ctx, this.out, Math.floor(Math.random() * 1e9), kind);
    if (kind && this.mireSince < 0) this.mireSince = t;
    if (!kind) this.mireSince = -1;
    this.bus.gain.setTargetAtTime(kind ? 0 : 0.45, t, kind ? 1.6 : 2.2);
    for (const [k, score] of Object.entries(this.scores)) {
      score.setActive(k === kind);
      score.setTension(k === kind && m === 'combat' ? 1 : 0);
    }
    this.band.gain.setTargetAtTime(m === 'combat' ? 1 : m === 'explore' ? 0.42 : 0, t, m === 'combat' ? 0.4 : 2);
    this.drums.gain.setTargetAtTime(m === 'combat' ? 1 : m === 'explore' ? 0.5 : 0, t, m === 'combat' ? 0.3 : 2);
    this.pad.gain.setTargetAtTime(m === 'town' ? 1 : 0.25, t, 2);
  }

  // ---- Scheduling ------------------------------------------------------

  private schedule() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') {
      this.next = ctx.currentTime + 0.1;
      return;
    }
    // Fell behind (tab in background): skip ahead rather than burst.
    if (this.next < ctx.currentTime - 0.1) this.next = ctx.currentTime + 0.05;
    for (const score of Object.values(this.scores)) score.scheduleUntil(ctx.currentTime + 1.2);
    while (this.next < ctx.currentTime + 0.6) {
      this.playStep(this.next);
      this.next += 60 / this.song.tempo / 4;
      this.advance();
    }
  }

  private advance() {
    this.step++;
    if (this.step < STEPS) return;
    this.step = 0;
    this.rep++;
    if (this.rep < this.song.sections[this.section].reps) return;
    this.rep = 0;
    this.section++;
    if (this.section >= this.song.sections.length) {
      this.section = 1; // new song, straight into the riffs
      this.seed++;
      this.song = makeSong(this.seed);
    }
  }

  private playStep(t: number) {
    const sec = this.song.sections[this.section];
    const s16 = 60 / this.song.tempo / 4;
    const m = this.effective;
    const lastBars = this.rep === sec.reps - 1 && this.step >= STEPS - 4;
    // Once the band has faded out under the mire's score, stop playing it.
    if (this.mireSince >= 0 && t - this.mireSince > 8) return;

    if (m !== 'town') {
      for (const n of sec.riff) {
        if (n.step !== this.step) continue;
        this.chord(t, n.deg, n.len * s16 * (n.mute ? 0.6 : 0.97), n.mute);
        this.bassNote(t, n.deg, n.len * s16 * 0.95);
      }
      if (sec.lead && this.step % 8 === 0) this.leadNote(t, sec.lead[this.step / 8], 8 * s16);
      this.drumStep(t, sec.drums, m === 'explore', lastBars);
    } else if (this.step % 8 === 0) {
      // Town: a clean, sparse arpeggio over the drone.
      const r = this.arpRng;
      if (r() < 0.8) this.clean(t, pick(r, [12, 15, 19, 20, 22, 24, 27]), 6 * s16);
    }
  }

  // ---- Instruments -----------------------------------------------------

  private chord(t: number, deg: number, dur: number, mute: boolean) {
    const ctx = this.ctx;
    const f = ROOT * Math.pow(2, deg / 12);
    for (const [ch, input] of this.guitars.entries()) {
      const g = ctx.createGain();
      const peak = mute ? 0.5 : 0.7;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
      g.gain.setValueAtTime(peak, t + Math.max(0.01, dur - 0.06));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node: AudioNode = g;
      if (mute) {
        // Palm mute: darker into the fuzz.
        const lp = this.filter('lowpass', 520, 0.8);
        g.connect(lp);
        node = lp;
      }
      node.connect(input);
      // Power chord: root, fifth, octave; each track detuned differently.
      for (const ratio of mute ? [1, 1.5] : [1, 1.5, 2]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f * ratio;
        o.detune.value = (ch === 0 ? -1 : 1) * (4 + Math.random() * 4);
        if (!mute && dur > 1.2) {
          // Long chords waver a little, like a sustained string.
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 4.5 + Math.random();
          const lg = ctx.createGain();
          lg.gain.setValueAtTime(0, t);
          lg.gain.linearRampToValueAtTime(f * ratio * 0.004, t + dur);
          lfo.connect(lg).connect(o.frequency);
          lfo.start(t);
          lfo.stop(t + dur + 0.05);
        }
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  private bassNote(t: number, deg: number, dur: number) {
    const ctx = this.ctx;
    const f = (ROOT / 2) * Math.pow(2, deg / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
    g.gain.setValueAtTime(0.9, t + Math.max(0.02, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.bass);
    for (const [type, mul] of [['sawtooth', 1], ['sine', 0.5]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul * 2;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private leadNote(t: number, deg: number, dur: number) {
    const ctx = this.ctx;
    const f = ROOT * 2 * Math.pow(2, deg / 12);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    // Bend up into the note, then a wide slow vibrato.
    o.frequency.setValueAtTime(f * Math.pow(2, -2 / 12), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.012, t + dur * 0.6);
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.03);
    g.gain.setValueAtTime(0.32, t + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const tone = this.filter('lowpass', 2400, 1);
    o.connect(g).connect(tone).connect(this.guitars[1]);
    const send = this.gain(0.6);
    tone.connect(send).connect(this.reverb);
    for (const n of [o, lfo]) {
      n.start(t);
      n.stop(t + dur + 0.05);
    }
  }

  private clean(t: number, deg: number, dur: number) {
    const ctx = this.ctx;
    const f = ROOT * Math.pow(2, deg / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.5);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.2 - 0.6;
    g.connect(p).connect(this.pad);
    const send = this.gain(0.9);
    p.connect(send).connect(this.reverb);
    for (const [type, mul, det] of [['triangle', 1, -5], ['triangle', 1, 5], ['sine', 2, 0]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur * 1.5 + 0.05);
    }
  }

  /** A low droning chord that never stops; only its level follows the mood. */
  private startDrone() {
    const ctx = this.ctx;
    const lp = this.filter('lowpass', 420, 2);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lg = this.gain(180);
    lfo.connect(lg).connect(lp.frequency);
    lfo.start();
    const g = this.gain(0.09);
    lp.connect(g).connect(this.pad);
    const send = this.gain(0.5);
    g.connect(send).connect(this.reverb);
    for (const [f, det] of [[ROOT / 2, -6], [ROOT / 2, 6], [ROOT * 0.75, -4], [ROOT, 3]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start();
    }
  }

  // ---- Drums -----------------------------------------------------------

  private drumStep(t: number, style: DrumStyle, sparse: boolean, fill: boolean) {
    const s = this.step;
    const bar = s % 16;
    const first = this.step === 0 && this.rep === 0;
    if (style === 'none') return;
    if (fill && !sparse) {
      // Tom fill into the next section.
      this.tom(t, [140, 120, 100, 80][s - (STEPS - 4)]);
      return;
    }
    if (sparse) {
      // Exploring: just the weight of it.
      if (bar === 0) {
        this.kick(t);
        if (s === 0) this.crash(t, 0.5);
      }
      if (bar % 4 === 0) this.ride(t, 0.35);
      return;
    }
    if (first || (style === 'crash' && bar === 0)) this.crash(t, 1);
    switch (style) {
      case 'crash':
        if (bar === 0 || bar === 8) this.kick(t);
        if (bar === 8 && s >= 16) this.snare(t, 0.8);
        break;
      case 'half':
        if (bar === 0 || bar === 6 || bar === 10) this.kick(t);
        if (bar === 8) this.snare(t, 1);
        if (bar % 4 === 0 && !first) this.ride(t, 0.6);
        break;
      case 'pound':
        if (bar % 4 === 0 || bar === 7 || bar === 14) this.kick(t);
        if (bar === 4 || bar === 12) this.snare(t, 1);
        if (bar % 2 === 0) this.hat(t, 0.5);
        break;
      case 'gallop':
        if (bar % 4 !== 1) this.kick(t, 0.8);
        if (bar === 4 || bar === 12) this.snare(t, 1);
        if (bar % 4 === 0 && !first) this.ride(t, 0.5);
        break;
    }
  }

  private kick(t: number, v = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.1 * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.45);
    this.noiseHit(t, 'highpass', 3500, 0.7, 0.25 * v, 0.015, this.drums);
  }

  private snare(t: number, v = 1) {
    const ctx = this.ctx;
    this.noiseHit(t, 'bandpass', 1900, 0.7, 0.75 * v, 0.28, this.drums, 0.5);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.2);
  }

  private crash(t: number, v = 1) {
    const ctx = this.ctx;
    this.noiseHit(t, 'highpass', 4500, 0.5, 0.35 * v, 2.6, this.drums, 0.4);
    // Metallic partials.
    const hp = this.filter('highpass', 3000, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    hp.connect(g).connect(this.drums);
    for (const f of [341, 587, 893, 1239, 1677]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * 2;
      o.connect(hp);
      o.start(t);
      o.stop(t + 2.1);
    }
  }

  private ride(t: number, v = 1) {
    this.noiseHit(t, 'bandpass', 7500, 2, 0.16 * v, 0.5, this.drums);
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 3150;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.012 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(this.filter('highpass', 2500, 1)).connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.65);
  }

  private hat(t: number, v = 1) {
    this.noiseHit(t, 'highpass', 8000, 0.8, 0.12 * v, 0.05, this.drums);
  }

  private tom(t: number, f: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.5);
    this.noiseHit(t, 'lowpass', 1200, 0.7, 0.2, 0.08, this.drums);
  }

  private noiseHit(t: number, type: BiquadFilterType, f: number, q: number, v: number, decay: number, dest: AudioNode, send = 0.15) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const flt = this.filter(type, f, q);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(flt).connect(g).connect(dest);
    if (send > 0) g.connect(this.gain(send)).connect(this.reverb);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  // ---- Helpers ---------------------------------------------------------

  private gain(v: number, dest?: AudioNode) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  private filter(type: BiquadFilterType, f: number, q: number, gainDb = 0) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    b.gain.value = gainDb;
    return b;
  }
}

/** Soft-clipping fuzz curve; higher `k` is more saturated. */
function fuzz(k: number): Float32Array {
  const n = 4096;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}
