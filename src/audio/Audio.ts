import * as THREE from 'three';
import { Music, type Mood } from './Music';

// All sound is synthesised at runtime with Web Audio: no audio files. Sound
// effects are built per event from oscillators and filtered noise; positional
// ones are attenuated and panned relative to the hero and the camera.
//
// Browsers only allow audio after a user gesture, so the context is created
// on the first click or key press.

export type Voice = 'ghoul' | 'brute' | 'crawler' | 'cultist' | 'spider' | 'horror' | 'wraith' | 'abomination' | 'lich' | 'nightwing';

interface At {
  gain: number;
  pan: number;
}

const MUTE_KEY = 'arpg.muted';

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  sfx!: GainNode;
  private amb!: GainNode;
  /** Shared reverb send; everything that should sit in the space feeds it. */
  reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private shaper!: Float32Array;
  music: Music | null = null;
  muted = false;
  private listener = new THREE.Vector3();
  private right = new THREE.Vector3(1, 0, 0);
  private last = new Map<string, number>();
  private ambience: { wind: BiquadFilterNode; windGain: GainNode; lfoGain: GainNode } | null = null;
  private area = 'town';
  private dripTimer = 2;
  private bellTimer = 6;
  onMuteChange: (muted: boolean) => void = () => {};

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
  }

  /** Creates the context on the first gesture; safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    // Brick-wall limiter so stacked hits never clip.
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.1;
    this.master.connect(comp).connect(limit).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.85;
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.shaper = distortionCurve(40);

    this.startAmbience();
    this.music = new Music(ctx, this.master, this.reverb);
    this.music.setArea(this.area);
    this.music.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    this.onMuteChange(this.muted);
  }

  /** Hero position and camera orientation, once per frame. */
  setListener(pos: THREE.Vector3, camera: THREE.Camera) {
    this.listener.copy(pos);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
  }

  setArea(name: string) {
    this.area = name;
    this.music?.setArea(name);
    if (this.ambience && this.ctx) {
      const t = this.ctx.currentTime;
      // Town: low sheltered wind. Wasteland: louder, higher, gustier.
      // Underground: only a deep draught moaning through the passages.
      this.ambience.windGain.gain.setTargetAtTime(name === 'town' ? 0.18 : name === 'dungeon' ? 0.1 : 0.32, t, 1);
      this.ambience.wind.frequency.setTargetAtTime(name === 'town' ? 380 : name === 'dungeon' ? 170 : 620, t, 1);
    }
  }

  setMood(m: Mood) {
    this.music?.setMood(m);
  }

  update(dt: number) {
    if (!this.ctx || this.muted) return;
    // A distant bell tolls now and then over the town.
    if (this.area === 'town') {
      this.bellTimer -= dt;
      if (this.bellTimer <= 0) {
        this.bellTimer = 18 + Math.random() * 20;
        this.bell(this.ctx.currentTime, 98 * (Math.random() < 0.5 ? 1 : 0.75), 0.07, 7);
      }
    }
    // Water dripping somewhere in the dark, and now and then a far groan of stone.
    if (this.area === 'dungeon') {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) {
        this.dripTimer = 0.6 + Math.random() * 3;
        const t = this.ctx.currentTime;
        const o = this.out({ gain: 1, pan: (Math.random() - 0.5) * 1.4 }, 0.5, 0.9);
        const f = 900 + Math.random() * 1400;
        this.tone(o, t, { f0: f, f1: f * 1.9, gain: 0.05 + Math.random() * 0.05, attack: 0.002, decay: 0.07 });
        if (Math.random() < 0.06) this.burst(o, t + 0.2, { type: 'lowpass', f0: 160, f1: 60, q: 3, gain: 0.25, attack: 0.6, decay: 1.6 });
      }
    }
  }

  // ---- Building blocks -------------------------------------------------

  /** Gain and pan for a sound at `pos`; null when too far to hear. */
  private at(pos?: THREE.Vector3, range = 1): At | null {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const r = 7 * range;
    if (d > r * 6) return null;
    const gain = 1 / (1 + (d / r) * (d / r));
    const pan = THREE.MathUtils.clamp((dx * this.right.x + dz * this.right.z) / (d + 3), -0.8, 0.8);
    return { gain, pan };
  }

  /** Per-event output: gain and stereo position, plus an optional reverb send. */
  private out(a: At, gain: number, send = 0.2): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain * a.gain;
    const p = ctx.createStereoPanner();
    p.pan.value = a.pan;
    g.connect(p).connect(this.sfx);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      p.connect(s).connect(this.reverb);
    }
    return g;
  }

  /** True if `key` fired less than `gap` seconds ago (rate limiting). */
  private busy(key: string, gap: number) {
    const now = this.ctx!.currentTime;
    if (now - (this.last.get(key) ?? -9) < gap) return true;
    this.last.set(key, now);
    return false;
  }

  private ready() {
    return !!this.ctx && !this.muted && this.ctx.state === 'running';
  }

  private env(g: AudioParam, t: number, peak: number, attack: number, decay: number) {
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseSrc(t: number, dur: number) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    return src;
  }

  /** Filtered noise burst. */
  private burst(dest: AudioNode, t: number, o: { type?: BiquadFilterType; f0: number; f1?: number; q?: number; gain: number; attack?: number; decay: number }) {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.attack ?? 0.005) + o.decay);
    const g = ctx.createGain();
    this.env(g.gain, t, o.gain, o.attack ?? 0.005, o.decay);
    this.noiseSrc(t, (o.attack ?? 0.005) + o.decay).connect(f).connect(g).connect(dest);
  }

  /** Oscillator with a pitch sweep and envelope. */
  private tone(dest: AudioNode, t: number, o: { type?: OscillatorType; f0: number; f1?: number; gain: number; attack?: number; decay: number; detune?: number }) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.attack ?? 0.005) + o.decay);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    this.env(g.gain, t, o.gain, o.attack ?? 0.005, o.decay);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + (o.attack ?? 0.005) + o.decay + 0.05);
    return osc;
  }

  /**
   * Throat: a buzzing source (saw + noise) shaped by two formant filters, with
   * a pitch contour and wobble. Every monster voice and the hero's grunts.
   */
  private throat(
    dest: AudioNode,
    t: number,
    o: { f0: number; f1: number; dur: number; formants: [number, number]; gain: number; rough?: number; wobble?: number; drive?: boolean; breath?: number },
  ) {
    const ctx = this.ctx!;
    const src = ctx.createGain();
    for (const det of [-12, 9]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = det;
      osc.frequency.setValueAtTime(o.f0, t);
      osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
      if (o.wobble) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 7 + Math.random() * 6;
        const lg = ctx.createGain();
        lg.gain.value = o.f0 * o.wobble;
        lfo.connect(lg).connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + o.dur + 0.1);
      }
      osc.connect(src);
      osc.start(t);
      osc.stop(t + o.dur + 0.1);
    }
    if (o.rough) {
      // Amplitude-modulated noise gives the gravel in a growl.
      const n = this.noiseSrc(t, o.dur);
      const ng = ctx.createGain();
      ng.gain.value = o.rough;
      n.connect(ng).connect(src);
    }
    let node: AudioNode = src;
    if (o.drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = this.shaper;
      node.connect(ws);
      node = ws;
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(o.gain, t + Math.min(0.06, o.dur * 0.2));
    env.gain.setValueAtTime(o.gain, t + o.dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    env.connect(dest);
    for (const [i, fq] of o.formants.entries()) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = fq;
      f.Q.value = 4;
      const fg = ctx.createGain();
      fg.gain.value = i === 0 ? 1.4 : 0.8;
      node.connect(f).connect(fg).connect(env);
    }
    if (o.breath) this.burst(dest, t, { type: 'highpass', f0: 2500, gain: o.breath, attack: 0.03, decay: o.dur });
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private bell(t: number, f: number, gain: number, decay: number) {
    const o = this.out({ gain: 1, pan: (Math.random() - 0.5) * 0.6 }, 1, 0.9);
    // Inharmonic partials of a cast bell.
    for (const [ratio, g] of [[0.5, 0.6], [1, 1], [1.19, 0.5], [1.56, 0.35], [2, 0.4], [2.66, 0.2], [3.01, 0.15]] as const) {
      this.tone(o, t, { f0: f * ratio * 2, gain: gain * g, attack: 0.004, decay: decay * (1.2 - ratio * 0.25) });
    }
  }

  private startAmbience() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const wind = ctx.createBiquadFilter();
    wind.type = 'bandpass';
    wind.Q.value = 0.8;
    wind.frequency.value = 400;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.18;
    // Slow gusts sweep the filter and the level.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(wind.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.11;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.08;
    lfo2.connect(lfo2Gain).connect(windGain.gain);
    src.connect(wind).connect(windGain).connect(this.amb);
    src.start();
    lfo.start();
    lfo2.start();
    this.ambience = { wind, windGain, lfoGain };
  }

  // ---- Hero ------------------------------------------------------------

  /** Sword whoosh. */
  swing(heavy = false) {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 1, 0.1);
    this.burst(o, t, { f0: 500, f1: heavy ? 1800 : 2600, q: 2.5, gain: heavy ? 0.5 : 0.35, attack: 0.07, decay: heavy ? 0.35 : 0.18 });
    this.burst(o, t + 0.04, { f0: 1500, f1: 700, q: 1.5, gain: 0.15, attack: 0.04, decay: 0.15 });
  }

  /** Spinning cleave: two passes of the blade and a low hum. */
  cleave() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 1, 0.3);
    this.burst(o, t, { f0: 300, f1: 2200, q: 2, gain: 0.5, attack: 0.15, decay: 0.3 });
    this.burst(o, t + 0.18, { f0: 2400, f1: 500, q: 2, gain: 0.4, attack: 0.05, decay: 0.3 });
    this.tone(o, t, { type: 'triangle', f0: 90, f1: 60, gain: 0.25, attack: 0.1, decay: 0.45 });
  }

  /** Blade into flesh; crits add a metallic ring. */
  hit(pos: THREE.Vector3, crit: boolean, armoured = false) {
    if (!this.ready()) return;
    const a = this.at(pos);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, crit ? 1.2 : 1, 0.15);
    this.tone(o, t, { f0: 160, f1: 45, gain: 0.7, decay: 0.16 });
    this.burst(o, t, { type: 'lowpass', f0: 2600, f1: 400, gain: 0.55, decay: 0.12 });
    // Wet squelch.
    this.burst(o, t + 0.02, { f0: 900, f1: 300, q: 6, gain: 0.35, attack: 0.01, decay: 0.15 });
    if (crit || armoured) {
      for (const f of [1870, 2790, 4120]) this.tone(o, t, { type: 'square', f0: f * (0.97 + Math.random() * 0.06), gain: 0.04, decay: 0.35 });
    }
  }

  step(pos: THREE.Vector3, weight: number, armoured = false) {
    if (!this.ready()) return;
    const a = this.at(pos, 0.6 + weight * 0.5);
    if (!a || a.gain < 0.03) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 0.5, 0.05);
    const stone = this.area !== 'zone';
    // Scuff on stone or gravel crunch on cracked earth, with a thump for weight.
    this.burst(o, t, { type: stone ? 'bandpass' : 'lowpass', f0: stone ? 1800 : 1400 + Math.random() * 600, q: stone ? 1.2 : 0.7, gain: 0.22 + Math.random() * 0.08, attack: 0.004, decay: stone ? 0.07 : 0.11 });
    this.tone(o, t, { f0: 90 / Math.sqrt(weight), f1: 40, gain: 0.25 * weight, decay: 0.09 });
    if (armoured) this.burst(o, t + 0.02, { type: 'highpass', f0: 6000, gain: 0.05, decay: 0.08 });
  }

  playerHurt() {
    if (!this.ready() || this.busy('hurt', 0.45)) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 0.8, 0.1);
    this.throat(o, t, { f0: 150, f1: 105, dur: 0.22, formants: [600, 1100], gain: 0.35, rough: 0.2, breath: 0.05 });
  }

  playerDie() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 1, 0.6);
    this.throat(o, t, { f0: 140, f1: 70, dur: 1.1, formants: [550, 950], gain: 0.35, rough: 0.25, breath: 0.08 });
    this.tone(o, t + 0.3, { f0: 70, f1: 30, gain: 0.5, attack: 0.02, decay: 1.5 });
    this.burst(o, t + 0.5, { type: 'lowpass', f0: 900, f1: 200, gain: 0.4, decay: 0.4 });
  }

  potion() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 0.8, 0.3);
    // Glugs, then a warm shimmer.
    for (let i = 0; i < 4; i++) this.tone(o, t + i * 0.11, { f0: 220 + i * 40, f1: 480 + i * 60, gain: 0.25, attack: 0.01, decay: 0.08 });
    for (const f of [523, 659, 784, 1046]) this.tone(o, t + 0.45, { type: 'triangle', f0: f, gain: 0.05, attack: 0.08, decay: 0.9 });
  }

  coins() {
    if (!this.ready() || this.busy('coins', 0.08)) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 0.7, 0.15);
    for (let i = 0; i < 6; i++) {
      const tt = t + i * 0.035 + Math.random() * 0.02;
      const f = 2800 + Math.random() * 2400;
      this.tone(o, tt, { f0: f, gain: 0.08, decay: 0.12 });
      this.tone(o, tt, { f0: f * 1.47, gain: 0.04, decay: 0.08 });
    }
  }

  pickup(rarity: string) {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 0.8, 0.2);
    // Leather and metal into the bag.
    this.burst(o, t, { type: 'lowpass', f0: 1200, f1: 300, gain: 0.35, decay: 0.12 });
    this.tone(o, t, { f0: 140, f1: 70, gain: 0.3, decay: 0.1 });
    if (rarity === 'rare' || rarity === 'unique') this.bell(t + 0.05, rarity === 'unique' ? 330 : 262, 0.05, 2);
  }

  /** Rare and unique items ring out as they hit the ground. */
  drop(pos: THREE.Vector3, rarity: string) {
    if (!this.ready()) return;
    const a = this.at(pos, 2);
    if (!a) return;
    const t = this.ctx!.currentTime + 0.25;
    const o = this.out(a, 0.8, 0.3);
    this.tone(o, t, { f0: 180, f1: 90, gain: 0.25, decay: 0.08 });
    if (rarity === 'unique' || rarity === 'rare') this.bell(t, rarity === 'unique' ? 392 : 294, 0.06, 3);
  }

  levelUp() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 1, 0.8);
    // A dark choir swelling into a minor chord, crowned by a bell.
    for (const f of [110, 165, 220, 262, 330]) {
      for (const det of [-8, 8]) this.tone(o, t, { type: 'sawtooth', f0: f, gain: 0.025, attack: 0.6, decay: 2.2, detune: det });
    }
    this.bell(t + 0.5, 220, 0.08, 4);
  }

  travel() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 1, 0.8);
    this.burst(o, t, { type: 'lowpass', f0: 200, f1: 2000, q: 2, gain: 0.4, attack: 0.8, decay: 0.9 });
    this.tone(o, t, { f0: 55, f1: 41, gain: 0.4, attack: 0.4, decay: 1.4 });
  }

  /** An objective completed: a low struck chord with a dark shimmer. */
  objective() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 1, 0.8);
    this.tone(o, t, { f0: 55, f1: 52, gain: 0.45, attack: 0.01, decay: 2.2 });
    for (const f of [110, 131, 165]) for (const det of [-7, 7]) this.tone(o, t, { type: 'sawtooth', f0: f, gain: 0.03, attack: 0.05, decay: 1.8, detune: det });
    this.bell(t + 0.05, 147, 0.07, 4);
  }

  /** Brother Anselm's blessing: a soft choir rising into a bright chord. */
  heal() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 1, 0.9);
    for (const f of [220, 277, 330, 440]) for (const det of [-6, 6]) this.tone(o, t, { type: 'triangle', f0: f, gain: 0.035, attack: 0.5, decay: 2.2, detune: det });
    this.bell(t + 0.35, 440, 0.05, 3);
  }

  /** A town portal tearing open: a rising airy swirl over a low hum. */
  portal(pos?: THREE.Vector3) {
    if (!this.ready()) return;
    const a = (pos && this.at(pos, 2)) || { gain: 1, pan: 0 };
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1, 0.8);
    this.burst(o, t, { type: 'bandpass', f0: 300, f1: 2400, q: 4, gain: 0.35, attack: 0.5, decay: 1.2 });
    this.tone(o, t, { type: 'sine', f0: 90, f1: 140, gain: 0.3, attack: 0.3, decay: 1.6 });
    this.tone(o, t + 0.2, { type: 'triangle', f0: 660, f1: 990, gain: 0.05, attack: 0.4, decay: 1.2 });
  }

  /** A rune circle kindling under the hero's feet. */
  runeLit(pos: THREE.Vector3) {
    if (!this.ready()) return;
    const a = this.at(pos, 2);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1, 0.7);
    this.burst(o, t, { type: 'lowpass', f0: 300, f1: 3000, q: 3, gain: 0.35, attack: 0.25, decay: 0.8 });
    this.tone(o, t, { type: 'triangle', f0: 220, f1: 440, gain: 0.12, attack: 0.3, decay: 1.2 });
    this.tone(o, t + 0.05, { type: 'triangle', f0: 330, f1: 660, gain: 0.06, attack: 0.3, decay: 1.2 });
  }

  /** The charge building while the hero stands in an unlit circle. */
  runeHum(pos: THREE.Vector3, k: number) {
    if (!this.ready() || this.busy('hum', 0.18)) return;
    const a = this.at(pos, 1.5);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 0.6, 0.5);
    this.tone(o, t, { type: 'sawtooth', f0: 70 + k * 90, gain: 0.04, attack: 0.05, decay: 0.2 });
  }

  /** A Blood Heart bursting: wet rupture and a gush. */
  heartBurst(pos: THREE.Vector3) {
    if (!this.ready()) return;
    const a = this.at(pos, 2);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1, 0.4);
    this.tone(o, t, { f0: 120, f1: 35, gain: 0.7, attack: 0.005, decay: 0.35 });
    this.burst(o, t, { type: 'lowpass', f0: 2400, f1: 300, q: 1.5, gain: 0.6, decay: 0.45 });
    for (let i = 0; i < 5; i++) this.burst(o, t + 0.1 + i * 0.07 + Math.random() * 0.04, { f0: 500 + Math.random() * 900, q: 5, gain: 0.15, decay: 0.08 });
  }

  /** The seal breaking and the portcullis grinding down into the floor. */
  doorOpen(pos: THREE.Vector3) {
    if (!this.ready()) return;
    const a = this.at(pos, 3) ?? { gain: 0.3, pan: 0 };
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1, 0.9);
    // Glass-like crack of the rune, then iron and stone grinding.
    this.burst(o, t, { type: 'highpass', f0: 3000, gain: 0.35, decay: 0.5 });
    this.tone(o, t, { f0: 880, f1: 110, gain: 0.12, decay: 0.8 });
    this.burst(o, t + 0.4, { type: 'bandpass', f0: 220, f1: 140, q: 2, gain: 0.5, attack: 0.3, decay: 2.4 });
    for (let i = 0; i < 14; i++) this.burst(o, t + 0.5 + i * 0.17, { f0: 1200 + Math.random() * 1500, q: 8, gain: 0.08, decay: 0.06 });
    this.tone(o, t + 2.9, { f0: 60, f1: 30, gain: 0.6, decay: 0.8 });
    this.burst(o, t + 2.9, { type: 'lowpass', f0: 800, f1: 150, gain: 0.45, decay: 0.7 });
  }

  click() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const o = this.out({ gain: 1, pan: 0 }, 0.5, 0);
    this.burst(o, t, { f0: 2400, q: 4, gain: 0.2, decay: 0.03 });
    this.tone(o, t, { f0: 400, f1: 200, gain: 0.1, decay: 0.05 });
  }

  // ---- Monsters --------------------------------------------------------

  /** Growls and cries per monster type: 'aggro', 'attack', 'hurt' or 'die'. */
  voice(kind: Voice, what: 'aggro' | 'attack' | 'hurt' | 'die', pos: THREE.Vector3, size = 1) {
    if (!this.ready()) return;
    if (what !== 'die' && this.busy(`${kind}:${what}`, what === 'hurt' ? 0.25 : 0.6)) return;
    const a = this.at(pos, 2);
    if (!a) return;
    const t = this.ctx!.currentTime + Math.random() * 0.04;
    const o = this.out(a, 1, 0.35);
    const p = (1 / size) * (0.9 + Math.random() * 0.2);
    const long = what === 'die' ? 2.2 : what === 'aggro' ? 1.5 : what === 'hurt' ? 0.5 : 1;
    switch (kind) {
      case 'ghoul':
        // Wet, rasping shriek that rises then breaks.
        this.throat(o, t, { f0: 420 * p, f1: (what === 'die' ? 160 : 620) * p, dur: 0.45 * long, formants: [900, 2400], gain: 0.22, rough: 0.6, wobble: 0.06, breath: 0.08 });
        break;
      case 'brute':
        // Deep distorted roar.
        this.throat(o, t, { f0: 85 * p, f1: (what === 'die' ? 45 : 70) * p, dur: 0.6 * long, formants: [380, 800], gain: 0.4, rough: 0.5, wobble: 0.04, drive: true });
        break;
      case 'spider':
      case 'crawler':
        // Chittering clicks and a thin insect squeal.
        for (let i = 0; i < 8 * long; i++) this.burst(o, t + i * 0.035, { f0: 3000 + Math.random() * 2000, q: 8, gain: 0.25, decay: 0.02 });
        this.throat(o, t, { f0: 900 * p, f1: (what === 'die' ? 300 : 1300) * p, dur: 0.3 * long, formants: [2200, 3600], gain: 0.08, wobble: 0.15 });
        break;
      case 'cultist':
        // Whispered chant over a low hum.
        this.burst(o, t, { f0: 1100, q: 5, gain: 0.25, attack: 0.1, decay: 0.5 * long });
        this.burst(o, t, { f0: 2600, q: 6, gain: 0.15, attack: 0.1, decay: 0.45 * long });
        this.throat(o, t, { f0: 110 * p, f1: (what === 'die' ? 60 : 105) * p, dur: 0.6 * long, formants: [500, 900], gain: 0.15, breath: 0.1 });
        break;
      case 'horror':
        // Wet, gurgling bellow from the chest maw.
        this.throat(o, t, { f0: 70 * p, f1: (what === 'die' ? 38 : 95) * p, dur: 0.7 * long, formants: [300, 650], gain: 0.4, rough: 0.8, wobble: 0.12, drive: true });
        this.burst(o, t + 0.05, { f0: 500, f1: 200, q: 5, gain: 0.25, attack: 0.05, decay: 0.5 * long });
        break;
      case 'wraith':
        // A hollow, rising moan with a whispering edge.
        this.throat(o, t, { f0: 330 * p, f1: (what === 'die' ? 120 : 470) * p, dur: 0.9 * long, formants: [700, 1600], gain: 0.12, wobble: 0.03, breath: 0.12 });
        this.tone(o, t, { type: 'sine', f0: 660 * p, f1: (what === 'die' ? 200 : 880) * p, gain: 0.06, attack: 0.2, decay: 0.9 * long });
        break;
      case 'abomination':
        // Many throats at once: a wet, layered bellow, each mouth a little off.
        for (const [f, fm] of [[48, 280], [62, 420], [80, 560], [105, 760]] as const) {
          this.throat(o, t + Math.random() * 0.08, { f0: f * p, f1: (what === 'die' ? f * 0.5 : f * 1.3) * p, dur: 1.0 * long, formants: [fm, fm * 2.1], gain: 0.22, rough: 0.9, wobble: 0.1, drive: true });
        }
        this.burst(o, t, { type: 'lowpass', f0: 900, f1: 200, gain: 0.35, attack: 0.1, decay: 0.9 * long });
        break;
      case 'lich':
        // A voice from inside a tomb: deep, doubled, with a whispering choir behind it.
        this.throat(o, t, { f0: 62 * p, f1: (what === 'die' ? 30 : 55) * p, dur: 1.1 * long, formants: [380, 820], gain: 0.32, rough: 0.35, drive: true });
        this.throat(o, t + 0.03, { f0: 93 * p, f1: (what === 'die' ? 45 : 82) * p, dur: 1.1 * long, formants: [500, 1200], gain: 0.16, breath: 0.2 });
        this.burst(o, t, { f0: 2400, q: 6, gain: 0.18, attack: 0.3, decay: 0.9 * long });
        break;
      case 'nightwing':
        // A shriek that tears up through the octaves, over leathery wing cracks.
        this.throat(o, t, { f0: 500 * p, f1: (what === 'die' ? 160 : 1500) * p, dur: 0.7 * long, formants: [1800, 3200], gain: 0.16, rough: 0.4, wobble: 0.08 });
        this.tone(o, t, { type: 'sawtooth', f0: 1800 * p, f1: 3600 * p, gain: 0.04, attack: 0.05, decay: 0.6 * long });
        for (let i = 0; i < 3; i++) this.burst(o, t + i * 0.12, { type: 'lowpass', f0: 1400, f1: 250, gain: 0.3, decay: 0.08 });
        break;
    }
    if (what === 'die' && kind !== 'wraith') this.burst(o, t + 0.55, { type: 'lowpass', f0: 700 * size, f1: 150, gain: 0.35, decay: 0.35 }); // body hits the ground
  }

  /** A boss's great roar: the voice, a sub-bass swell under it and a long tail. */
  roar(kind: Voice, pos: THREE.Vector3) {
    if (!this.ready()) return;
    const a = this.at(pos, 4) ?? { gain: 0.4, pan: 0 };
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1.3, 0.9);
    this.voice(kind, 'aggro', pos, 2.2);
    this.tone(o, t, { f0: 38, f1: 30, gain: 0.7, attack: 0.25, decay: 2.2 });
    this.burst(o, t, { type: 'lowpass', f0: 400, f1: 120, q: 1.5, gain: 0.4, attack: 0.4, decay: 1.8 });
  }

  /** Something heavy tearing through the air (charges, dives, wing beats). */
  whoosh(pos: THREE.Vector3, size = 1) {
    if (!this.ready()) return;
    const a = this.at(pos, 3);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1, 0.5);
    this.burst(o, t, { type: 'bandpass', f0: 250 / size, f1: 1400 / size, q: 1.2, gain: 0.5, attack: 0.15, decay: 0.45 });
    this.burst(o, t + 0.1, { type: 'bandpass', f0: 1400 / size, f1: 300 / size, q: 1.2, gain: 0.35, attack: 0.05, decay: 0.4 });
  }

  /** A ground-shaking boss impact: deeper and longer than the brute's slam. */
  quake(pos: THREE.Vector3, size = 1) {
    if (!this.ready()) return;
    const a = this.at(pos, 4) ?? { gain: 0.5, pan: 0 };
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1.4, 0.8);
    this.tone(o, t, { f0: 70 / size, f1: 22, gain: 1.0, decay: 1.1 });
    this.burst(o, t, { type: 'lowpass', f0: 2600, f1: 120, gain: 0.8, decay: 0.9 });
    for (let i = 0; i < 10; i++) this.burst(o, t + 0.1 + Math.random() * 0.8, { type: 'bandpass', f0: 600 + Math.random() * 1600, q: 4, gain: 0.08, decay: 0.07 }); // rubble
  }

  /** Dark magic gathering: a rising, detuned drone. */
  charge(pos: THREE.Vector3, dur = 1, color: 'soul' | 'blood' = 'blood') {
    if (!this.ready()) return;
    const a = this.at(pos, 3);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 0.9, 0.7);
    const base = color === 'soul' ? 110 : 70;
    for (const det of [-15, 0, 15]) this.tone(o, t, { type: 'sawtooth', f0: base, f1: base * 2.5, gain: 0.04, attack: dur * 0.9, decay: dur * 0.3, detune: det });
    this.burst(o, t, { type: 'bandpass', f0: 300, f1: 2500, q: 3, gain: 0.2, attack: dur, decay: 0.2 });
  }

  /** A burst of soul-fire or blood magic going off. */
  blast(pos: THREE.Vector3, color: 'soul' | 'blood' = 'blood', size = 1) {
    if (!this.ready()) return;
    const a = this.at(pos, 3);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1.1, 0.9);
    this.burst(o, t, { type: 'lowpass', f0: 5000, f1: 300, gain: 0.6 * size, decay: 0.7 });
    this.tone(o, t, { f0: 120 / size, f1: 35, gain: 0.6 * size, decay: 0.8 });
    if (color === 'soul') for (const f of [440, 523, 622]) this.tone(o, t, { type: 'triangle', f0: f * 2, f1: f, gain: 0.04, decay: 1.2 });
  }

  /** Wet splatter of bile or blood landing. */
  splash(pos: THREE.Vector3) {
    if (!this.ready() || this.busy('splash', 0.05)) return;
    const a = this.at(pos, 2);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 0.9, 0.3);
    this.burst(o, t, { type: 'lowpass', f0: 2200, f1: 300, q: 1.5, gain: 0.5, decay: 0.3 });
    for (let i = 0; i < 4; i++) this.burst(o, t + 0.05 + i * 0.05, { f0: 700 + Math.random() * 900, q: 6, gain: 0.12, decay: 0.06 });
  }

  /** The brute's cleaver slamming into the ground. */
  slam(pos: THREE.Vector3, size = 1) {
    if (!this.ready()) return;
    const a = this.at(pos, 3);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1.2, 0.5);
    this.tone(o, t, { f0: 90 / size, f1: 28, gain: 0.9, decay: 0.6 });
    this.burst(o, t, { type: 'lowpass', f0: 3000, f1: 200, gain: 0.6, decay: 0.5 });
    for (const f of [1300, 2100, 3400]) this.tone(o, t, { type: 'square', f0: f, gain: 0.03, decay: 0.5 });
  }

  /** Cultist casting a blood bolt. */
  cast(pos: THREE.Vector3) {
    if (!this.ready()) return;
    const a = this.at(pos, 2);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1, 0.6);
    this.tone(o, t, { type: 'sawtooth', f0: 180, f1: 900, gain: 0.08, attack: 0.05, decay: 0.35 });
    this.burst(o, t, { f0: 600, f1: 3500, q: 3, gain: 0.3, attack: 0.05, decay: 0.3 });
  }

  boltHit(pos: THREE.Vector3) {
    if (!this.ready()) return;
    const a = this.at(pos, 2);
    if (!a) return;
    const t = this.ctx!.currentTime;
    const o = this.out(a, 1, 0.4);
    this.burst(o, t, { type: 'lowpass', f0: 4000, f1: 300, gain: 0.5, decay: 0.25 });
    this.tone(o, t, { f0: 300, f1: 60, gain: 0.3, decay: 0.2 });
  }
}

function distortionCurve(k: number): Float32Array {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return c;
}

export const audio = new AudioEngine();
