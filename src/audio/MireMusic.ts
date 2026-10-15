// The Bleeding Mire's own score: a slow symphonic lament in D minor. A
// string section and a low wordless choir move through grieving chord
// progressions (Neapolitan chords, half-diminished seconds, suspensions that
// resolve too late), a solo cello sings sighing appoggiaturas over them, and
// a distant bell and soft timpani mark the phrases. Everything sits in a long,
// cold reverb. The melody is rewritten every cycle, so the loop never seams.
// When something hunts the hero, a low spiccato ostinato and timpani pulse
// rise under the lament.

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

const BPM = 46;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const D = 62; // MIDI D4; every pitch class below is semitones above D
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

interface Chord {
  pcs: number[];
  bass: number;
}
const C: Record<string, Chord> = {
  i: { pcs: [0, 3, 7], bass: 0 },
  i7: { pcs: [0, 3, 7, 10], bass: 10 },
  iv: { pcs: [5, 8, 0], bass: 5 },
  iv6: { pcs: [5, 8, 0], bass: 8 },
  v: { pcs: [7, 10, 2], bass: 7 },
  V: { pcs: [7, 11, 2], bass: 7 },
  V7: { pcs: [7, 11, 2, 5], bass: 7 },
  Vsus: { pcs: [7, 0, 2], bass: 7 },
  VI: { pcs: [8, 0, 3], bass: 8 },
  III: { pcs: [3, 7, 10], bass: 3 },
  VII: { pcs: [10, 2, 5], bass: 10 },
  N6: { pcs: [1, 5, 8], bass: 5 },
  ii7: { pcs: [2, 5, 8, 0], bass: 2 },
};
const PHRASES: string[][] = [
  ['i', 'VI', 'iv', 'V', 'i', 'i7', 'VI', 'V'],
  ['iv', 'i', 'VI', 'III', 'iv6', 'ii7', 'Vsus', 'V'],
  ['i', 'ii7', 'V7', 'i', 'VI', 'N6', 'Vsus', 'V7'],
  ['i', 'v', 'VI', 'VII', 'iv', 'N6', 'V7', 'i'],
];
/** Phrase order of one cycle, with what plays in it. */
const FORM = [
  { p: 0, solo: false, bell: true, roll: false },
  { p: 0, solo: true, bell: false, roll: false },
  { p: 1, solo: true, bell: false, roll: false },
  { p: 2, solo: true, bell: false, roll: true },
  { p: 3, solo: true, bell: true, roll: false },
  { p: 1, solo: false, bell: false, roll: false },
];
const SCALE = [0, 2, 3, 5, 7, 8, 10];

interface MelNote {
  beat: number;
  len: number;
  midi: number;
}
interface BarPlan {
  chord: Chord;
  voices: number[];
  bass: number;
  choir: number[];
  melody: MelNote[];
  bell: boolean;
  roll: boolean;
  phraseStart: boolean;
}

export class MireMusic {
  private bus: GainNode;
  private strings: GainNode;
  private lows: GainNode;
  private choir: GainNode;
  private soloIn: GainNode;
  private tension: GainNode;
  private hall: ConvolverNode;
  private noise: AudioBuffer;
  private solo: OscillatorNode[] = [];
  private soloEnv: GainNode;
  private vibDepth: GainNode;
  private active = false;
  private offAt = -1;
  private nextBar = 0;
  private plan: BarPlan[] = [];
  private barIx = 0;
  private seed: number;
  private cycle = 0;
  private voices = [D, D + 3, D + 7, D + 12];
  private choirV = [D - 12, D - 5];
  private mel = D + 7;

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.seed = seed;
    this.bus = this.gain(0, out);
    // The cold hall: a long, bright-tailed impulse with its lows thinned out.
    this.hall = ctx.createConvolver();
    this.hall.buffer = this.impulse(7.5);
    const wet = this.gain(0.55, this.bus);
    this.hall.connect(this.filter('highpass', 180, 0.6)).connect(wet);
    const send = (node: AudioNode, amount: number) => node.connect(this.gain(amount, this.hall));

    // Strings: warm low-pass, a slight dip in the boxy mids.
    this.strings = this.gain(1);
    const sLp = this.filter('lowpass', 2300, 0.5);
    this.strings.connect(this.filter('highpass', 70, 0.7)).connect(this.filter('peaking', 420, 1, -3)).connect(sLp).connect(this.bus);
    send(sLp, 0.6);
    // Cellos and basses: darker.
    this.lows = this.gain(1);
    const lLp = this.filter('lowpass', 560, 0.6);
    this.lows.connect(this.filter('highpass', 38, 0.7)).connect(lLp).connect(this.bus);
    send(lLp, 0.35);
    // Choir: an "oo" through three formant bands.
    this.choir = this.gain(1);
    const vowel = this.gain(1);
    for (const [f, q, g] of [[380, 6, 1], [820, 8, 0.45], [2600, 10, 0.12]]) this.choir.connect(this.filter('bandpass', f, q)).connect(this.gain(g * 2.4, vowel));
    vowel.connect(this.filter('lowpass', 3000, 0.5)).connect(this.bus);
    send(vowel, 0.9);
    // Solo cello: one bowed voice gliding between notes, a resonant body.
    this.soloIn = this.gain(1);
    const body = this.filter('peaking', 280, 1.2, 5);
    this.soloIn.connect(body).connect(this.filter('peaking', 1300, 1.5, 4)).connect(this.filter('lowpass', 2800, 0.7)).connect(this.gain(0.9, this.bus));
    send(body, 0.55);
    this.soloEnv = this.gain(0);
    this.soloEnv.connect(this.soloIn);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.3;
    this.vibDepth = this.gain(0);
    vib.connect(this.vibDepth);
    vib.start();
    for (const [type, det, lvl] of [['sawtooth', -4, 0.6], ['sawtooth', 5, 0.5], ['triangle', 0, 0.5]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      o.frequency.value = hz(this.mel);
      this.vibDepth.connect(o.frequency);
      o.connect(this.gain(lvl, this.soloEnv));
      o.start();
      this.solo.push(o);
    }
    // The hunt: ostinato and timpani, faded in by `setTension`.
    this.tension = this.gain(0, this.bus);
    send(this.tension, 0.3);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Fades the score in or out; starts a fresh cycle when it comes back. */
  setActive(on: boolean) {
    const t = this.ctx.currentTime;
    if (on && !this.active) {
      if (this.offAt < 0 || t - this.offAt > 9) {
        this.nextBar = Math.max(this.nextBar, t + 0.2);
        this.plan = [];
        this.barIx = 0;
      }
    }
    if (!on && this.active) this.offAt = t;
    this.active = on;
    this.bus.gain.setTargetAtTime(on ? 0.85 : 0, t, on ? 2.2 : 1.6);
  }

  setTension(x: number) {
    this.tension.gain.setTargetAtTime(x, this.ctx.currentTime, x > 0 ? 0.6 : 2.5);
  }

  /** Schedules every bar that starts before `until` (audio time). */
  scheduleUntil(until: number) {
    if (!this.active && (this.offAt < 0 || this.ctx.currentTime - this.offAt > 8)) return;
    if (this.nextBar < this.ctx.currentTime - 0.2) this.nextBar = this.ctx.currentTime + 0.05;
    while (this.nextBar < until) {
      if (this.barIx >= this.plan.length) {
        this.plan = this.compose(this.seed + this.cycle++);
        this.barIx = 0;
      }
      this.playBar(this.plan[this.barIx++], this.nextBar);
      this.nextBar += BAR;
    }
  }

  // ---- Composition -----------------------------------------------------

  private compose(seed: number): BarPlan[] {
    const r = rngFrom(seed);
    const bars: BarPlan[] = [];
    for (const f of FORM) {
      const names = PHRASES[f.p];
      for (let k = 0; k < names.length; k++) {
        const chord = C[names[k]];
        const next = C[names[(k + 1) % names.length]];
        this.voices = this.lead(this.voices, chord, 55, 76);
        this.choirV = this.lead(this.choirV, { pcs: [chord.pcs[0], chord.pcs[2]], bass: 0 }, 48, 62);
        const bass = 38 + ((chord.bass - 38 + D + 120) % 12);
        bars.push({
          chord,
          voices: [...this.voices],
          bass,
          choir: [...this.choirV],
          melody: f.solo ? this.melodyBar(r, chord, next, k, names.length) : [],
          bell: f.bell && k % 4 === 0,
          roll: f.roll && k === names.length - 1,
          phraseStart: k === 0,
        });
      }
    }
    return bars;
  }

  /** Moves each voice to the nearest tone of the chord, keeping them in range. */
  private lead(prev: number[], chord: Chord, lo: number, hi: number): number[] {
    const used = new Set<number>();
    return prev.map((p) => {
      let best = p;
      let bestD = Infinity;
      for (let m = lo; m <= hi; m++) {
        const pc = (((m - D) % 12) + 12) % 12;
        if (!chord.pcs.includes(pc)) continue;
        // Prefer covering a new chord tone over doubling one.
        const dist = Math.abs(m - p) + (used.has(pc) ? 2.5 : 0);
        if (dist < bestD) {
          bestD = dist;
          best = m;
        }
      }
      used.add((((best - D) % 12) + 12) % 12);
      return best;
    });
  }

  private melodyBar(r: Rng, chord: Chord, next: Chord, k: number, n: number): MelNote[] {
    const lo = 57;
    const hi = 77;
    // An arch over the phrase: climbing to its middle, sinking to its end.
    const drift = k < n / 2 ? pick(r, [-2, 1, 2, 3, 4]) : pick(r, [-4, -3, -2, -1, 1]);
    const target = this.nearestTone(chord.pcs, this.mel + drift, lo, hi);
    const above = (m: number, chromatic: boolean) => {
      if (chromatic) return m + 1;
      for (let s = 1; s <= 2; s++) if (SCALE.includes((((m + s - D) % 12) + 12) % 12)) return m + s;
      return m + 1;
    };
    let out: MelNote[];
    if (k === n - 1) {
      out = [{ beat: 0, len: 4, midi: target }];
    } else {
      const shape = pick(r, ['sigh', 'sigh', 'sigh2', 'long', 'rise', 'rest']);
      const app = above(target, r() < 0.3);
      switch (shape) {
        case 'sigh':
          out = [
            { beat: 0, len: 1.5, midi: app },
            { beat: 1.5, len: 2.5, midi: target },
          ];
          break;
        case 'sigh2':
          out = [
            { beat: 0, len: 2, midi: target },
            { beat: 2, len: 1, midi: app },
            { beat: 3, len: 1, midi: target },
          ];
          break;
        case 'long':
          out = [{ beat: 0, len: 4, midi: target }];
          break;
        case 'rise': {
          const to = this.nearestTone(next.pcs, target + 3, lo, hi);
          const mid = Math.round((target + to) / 2);
          out = [
            { beat: 0, len: 2, midi: target },
            { beat: 2, len: 1, midi: this.inScale(mid) },
            { beat: 3, len: 1, midi: this.inScale(to - 1) },
          ];
          break;
        }
        default:
          out = [{ beat: 0, len: 2.5, midi: target }];
      }
    }
    this.mel = out[out.length - 1].midi;
    return out;
  }

  private nearestTone(pcs: number[], near: number, lo: number, hi: number) {
    let best = near;
    let bestD = Infinity;
    for (let m = lo; m <= hi; m++) {
      if (!pcs.includes((((m - D) % 12) + 12) % 12)) continue;
      const d = Math.abs(m - near);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  private inScale(m: number) {
    while (!SCALE.includes((((m - D) % 12) + 12) % 12)) m--;
    return m;
  }

  // ---- Performance -----------------------------------------------------

  private playBar(b: BarPlan, t: number) {
    // Strings: the chord swells and overlaps the next one.
    b.voices.forEach((m, i) => this.bowed(this.strings, hz(m), t, BAR, 0.05 - i * 0.004, 1.4, 2.6, 3));
    this.bowed(this.lows, hz(b.bass), t, BAR, 0.09, 0.9, 2.2, 2);
    this.bowed(this.lows, hz(b.bass - 12), t, BAR, 0.035, 1.2, 2.4, 1);
    b.choir.forEach((m) => this.voice(hz(m), t + 0.2, BAR, 0.05));
    let prevEnd = -1;
    for (const n of b.melody) {
      const at = t + n.beat * BEAT;
      this.cello(hz(n.midi), at, n.len * BEAT, Math.abs(at - prevEnd) < 0.01);
      prevEnd = at + n.len * BEAT;
    }
    if (b.melody.length && b.melody[b.melody.length - 1].beat + b.melody[b.melody.length - 1].len < 4) {
      this.soloEnv.gain.setTargetAtTime(0, prevEnd, 0.4);
    }
    if (b.bell) this.bell(hz(pick(Math.random, [D - 12, D - 5, D])), t + 0.05);
    if (b.phraseStart) this.timpani(hz(38), t, 0.5);
    if (b.roll) for (let s = 0; s < 16; s++) this.timpani(hz(45), t + s * (BEAT / 4), 0.08 + (s / 16) * 0.35, 0.6);
    // The hunt: spiccato eighths on the bass note, timpani on one and three.
    for (let e = 0; e < 8; e++) this.spiccato(hz(b.bass + 12), t + e * (BEAT / 2), e % 4 === 0 ? 0.16 : 0.1);
    for (const beat of [0, 2]) this.timpani(hz(38), t + beat * BEAT, 0.35, 1, this.tension);
  }

  /** A section's bowed note: several detuned saws, slow bow-in, long release. */
  private bowed(dest: AudioNode, f: number, t: number, dur: number, vel: number, attack: number, release: number, players: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + attack);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.setTargetAtTime(0, t + dur, release / 4);
    g.connect(dest);
    const end = t + dur + release + 0.1;
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6 + Math.random() * 0.8;
    const vg = ctx.createGain();
    vg.gain.value = f * 0.003;
    vib.connect(vg);
    vib.start(t);
    vib.stop(end);
    for (let k = 0; k < players; k++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (k - (players - 1) / 2) * 9 + (Math.random() - 0.5) * 4;
      vg.connect(o.frequency);
      o.connect(g);
      o.start(t);
      o.stop(end);
    }
  }

  private voice(f: number, t: number, dur: number, vel: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 2);
    g.gain.setValueAtTime(vel, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.8);
    g.connect(this.choir);
    const end = t + dur + 4;
    const vib = ctx.createOscillator();
    vib.frequency.value = 4 + Math.random();
    const vg = ctx.createGain();
    vg.gain.value = f * 0.005;
    vib.connect(vg);
    vib.start(t);
    vib.stop(end);
    for (const det of [-11, 0, 12]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      vg.connect(o.frequency);
      o.connect(g);
      o.start(t);
      o.stop(end);
    }
  }

  /** The solo cello: glides to the note, swells, and its vibrato blooms late. */
  private cello(f: number, t: number, dur: number, legato: boolean) {
    const glide = legato ? 0.07 : 0.02;
    for (const o of this.solo) o.frequency.setTargetAtTime(f, t, glide);
    const e = this.soloEnv.gain;
    const peak = 0.13;
    if (!legato) {
      e.setTargetAtTime(0.02, t - 0.05, 0.03);
      e.setTargetAtTime(peak, t, 0.18);
    } else {
      e.setTargetAtTime(peak * 0.8, t, 0.05);
      e.setTargetAtTime(peak, t + 0.1, 0.25);
    }
    e.setTargetAtTime(peak * 0.75, t + dur * 0.55, dur * 0.3);
    const v = this.vibDepth.gain;
    v.setTargetAtTime(f * 0.001, t, 0.05);
    v.setTargetAtTime(f * 0.0065, t + Math.min(0.5, dur * 0.4), 0.35);
  }

  /** A far-off bell: inharmonic partials, the low hum ringing longest. */
  private bell(f: number, t: number) {
    const ctx = this.ctx;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.random() * 1.2 - 0.6;
    const level = this.gain(0.5);
    level.connect(p);
    p.connect(this.gain(0.15, this.bus));
    p.connect(this.gain(1, this.hall));
    for (const [ratio, amp, decay] of [[0.5, 0.5, 9], [1, 0.6, 6], [1.19, 0.4, 5], [1.5, 0.25, 4], [2, 0.3, 3.5], [2.52, 0.18, 2.5], [3.01, 0.12, 2], [4.17, 0.08, 1.4]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp * 0.16, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(level);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
  }

  private timpani(f: number, t: number, vel: number, decay = 2.6, dest: AudioNode = this.bus) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(dest);
    if (dest === this.bus) g.connect(this.gain(0.4, this.hall));
    for (const [ratio, amp] of [[1, 1], [1.5, 0.35], [1.98, 0.2]]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * ratio * 1.03, t);
      o.frequency.exponentialRampToValueAtTime(f * ratio, t + 0.12);
      const a = this.gain(amp);
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(this.filter('lowpass', 900, 0.7)).connect(ng).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.12);
  }

  private spiccato(f: number, t: number, vel: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    g.connect(this.filter('lowpass', 1400, 0.8)).connect(this.tension);
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.25);
    }
  }

  // ---- Helpers ---------------------------------------------------------

  /** Stereo impulse: decorrelated noise under an exponential tail, highs fading slower than lows. */
  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const w = Math.random() * 2 - 1;
        lp += (w - lp) * 0.35;
        // Early on the tail is full; later only the airy part lingers.
        const s = lp * (1 - x) + (w - lp) * (0.6 + x);
        d[i] = s * Math.pow(1 - x, 2.2) * Math.exp(-x * 2.5) * (i < ctx.sampleRate * 0.03 ? i / (ctx.sampleRate * 0.03) : 1);
      }
    }
    return buf;
  }

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
