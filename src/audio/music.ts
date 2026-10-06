// Procedural soundtrack. Nothing is sampled: a slow chord pad, a sparse music-box melody, a bell
// and the sounds of each region (crickets in the wheat, water along the river, wind on the
// windmill hills) are all synthesised with Web Audio and composed from the seed.
//
// The key and the order of the chords come from the seed; the scale follows the sky's mood, so
// dusk sounds different from a stormy night and the music turns as the colours do while you walk.
// Region sounds crossfade with the same weights the painting uses to blend its regions.

import { hash, Rng } from '../core/rng';
import { World, type Biome, type Mood } from '../world/world';

/** Scale degrees in semitones for each mood. */
const SCALES: Record<Mood, readonly number[]> = {
  classic: [0, 2, 3, 5, 7, 9, 10],   // dorian
  indigo: [0, 2, 3, 5, 7, 8, 10],    // aeolian
  teal: [0, 2, 4, 6, 7, 9, 11],      // lydian
  violet: [0, 1, 3, 5, 7, 8, 10],    // phrygian
  storm: [0, 2, 3, 5, 7, 8, 11],     // harmonic minor
  dawn: [0, 2, 4, 5, 7, 9, 11],      // ionian
  dusk: [0, 2, 4, 5, 7, 9, 10],      // mixolydian
};
/** Seconds per beat; the music is slow everywhere, a little brighter at dawn. */
const BEAT: Record<Mood, number> = { classic: 2.6, indigo: 3, teal: 2.4, violet: 3, storm: 3.4, dawn: 2.2, dusk: 2.8 };

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export interface Scene {
  x: number;
  mode: 'gallery' | 'wander';
}

export class Music {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private world: World | null = null;
  private rng = new Rng(1);
  private enabled = false;
  private timer = 0;

  // Layers whose gain follows the landscape.
  private wind!: GainNode;
  private water!: GainNode;
  private bees!: GainNode;
  private weights = { wind: 0, water: 0, crickets: 0, village: 0, dawn: 0, crows: 0, sun: 0 };

  // Scheduling state, in audio-context seconds.
  private nextChord = 0;
  private nextNote = 0;
  private nextCricket = 0;
  private nextBell = 0;
  private nextBubble = 0;
  private nextBird = 0;
  private nextCaw = 0;
  private root = 50;
  private degree = 0;
  private scene: Scene = { x: 0, mode: 'gallery' };

  get on() { return this.enabled; }

  /** Start (or reseed) the music for this world. Safe to call before audio is allowed. */
  setWorld(world: World) {
    this.world = world;
    this.rng = new Rng(hash(world.s, 0x6d75));
    this.root = 43 + Math.floor(this.rng.random() * 12);   // G2 .. F#3
    this.degree = 0;
    if (this.ctx) this.resetClock();
  }

  setScene(scene: Scene) {
    this.scene = scene;
    if (!this.ctx || !this.world) return;
    const w = this.world, t = this.ctx.currentTime;
    const x = scene.x;
    let wind = 0, water = 0, crickets = 0, village = 0, crows = 0, sun = 0;
    if (scene.mode === 'gallery') {
      const lm = w.landmark;
      water = lm === 'river' ? 0.9 : 0;
      crickets = lm === 'haystacks' ? 1 : lm === 'none' ? 0.3 : 0;
      wind = lm === 'mill' ? 0.8 : 0.15;
      village = lm === 'cafe' || lm === 'none' ? 1 : 0.4;
    } else {
      const b = (k: Biome) => w.biomeWeight(x, k);
      water = Math.max(w.riverWeight(x), 0);
      crickets = Math.max(b('wheat'), b('orchard') * 0.8, b('mill') * 0.4);
      wind = Math.max(b('mill'), b('orchard') * 0.5, b('wheat') * 0.4, b('crows'));
      village = b('village');
      crows = b('crows');
      sun = b('sunflower');
      crickets = Math.max(crickets, sun * 0.6);
    }
    const mood = w.moodAt(x);
    if (mood === 'storm') wind = Math.max(wind, 0.8);
    this.weights = { wind, water, crickets, village, dawn: mood === 'dawn' ? 1 : 0, crows, sun };
    this.wind.gain.setTargetAtTime(0.05 * wind, t, 1.5);
    this.water.gain.setTargetAtTime(0.06 * water, t, 1.5);
    this.bees.gain.setTargetAtTime(0.5 * sun, t, 1.5);
  }

  async setEnabled(on: boolean) {
    this.enabled = on;
    if (on) {
      if (!this.ctx) this.init();
      const ctx = this.ctx!;
      if (ctx.state === 'suspended') await ctx.resume();
      this.resetClock();
      this.setScene(this.scene);
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setTargetAtTime(0.7, ctx.currentTime, 0.8);
      if (!this.timer) this.timer = window.setInterval(() => this.tick(), 120);
    } else if (this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
      clearInterval(this.timer);
      this.timer = 0;
      const ctx = this.ctx;
      setTimeout(() => { if (!this.enabled) ctx.suspend(); }, 1500);
    }
  }

  // ------------------------------------------------------------ graph

  private init() {
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.wind = this.noiseLayer(380, 0.5, 0.11, 0.07);
    this.water = this.noiseLayer(1100, 1.4, 0.35, 0.5, 2300);
    this.bees = this.beeLayer();
  }

  /** A looping noise bed through a bandpass whose centre drifts, so it breathes like wind or running water. */
  private noiseLayer(freq: number, q: number, lfoRate: number, lfoDepth: number, second?: number): GainNode {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    for (const f of second ? [freq, second] : [freq]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = f === freq ? 1 : 1.13;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = lfoRate * (f === freq ? 1 : 1.7);
      depth.gain.value = f * lfoDepth;
      lfo.connect(depth).connect(bp.frequency);
      lfo.start();
      src.start();
      src.connect(bp).connect(out);
    }
    out.connect(this.master);
    out.connect(this.reverb);
    return out;
  }

  /** A faint, restless drone: a few detuned saw waves, wobbling, through a narrow band. Bees in the sunflowers. */
  private beeLayer(): GainNode {
    const ctx = this.ctx!, out = ctx.createGain();
    out.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 1.6;
    const level = ctx.createGain();
    level.gain.value = 0.012;
    bp.connect(level).connect(out);
    for (const [f, rate] of [[148, 0.31], [157, 0.47], [171, 0.23]] as const) {
      const o = ctx.createOscillator(), wob = ctx.createOscillator(), depth = ctx.createGain(), amp = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      wob.frequency.value = rate * 9;
      depth.gain.value = f * 0.05;
      wob.connect(depth).connect(o.frequency);
      // The loudness drifts as each bee passes close and wanders off.
      const drift = ctx.createOscillator(), dd = ctx.createGain();
      drift.frequency.value = rate * 0.25;
      dd.gain.value = 0.5;
      amp.gain.value = 0.5;
      drift.connect(dd).connect(amp.gain);
      o.connect(amp).connect(bp);
      o.start();
      wob.start();
      drift.start();
    }
    out.connect(this.master);
    out.connect(this.reverb);
    return out;
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!, n = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    return buf;
  }

  private resetClock() {
    const t = this.ctx!.currentTime + 0.2;
    this.nextChord = t;
    this.nextNote = t + 4;
    this.nextCricket = t;
    this.nextBell = t + 6;
    this.nextBubble = t;
    this.nextBird = t + 3;
    this.nextCaw = t + 4;
  }

  // ------------------------------------------------------------ scheduling

  private tick() {
    const ctx = this.ctx, w = this.world;
    if (!ctx || !w || !this.enabled) return;
    // Keep the landscape mix current without the app having to call it every frame.
    const horizon = ctx.currentTime + 0.6, mood = w.moodAt(this.scene.x), beat = BEAT[mood];
    const scale = SCALES[mood];

    while (this.nextChord < horizon) {
      this.chord(this.nextChord, scale, beat);
      // Drift to a related chord: mostly stepwise, sometimes a leap.
      const step = this.rng.pick([-2, -1, 1, 1, 2, 3, -3, 0]);
      this.degree = (((this.degree + step) % 7) + 7) % 7;
      this.nextChord += beat * this.rng.pick([4, 4, 6, 8]);
    }
    while (this.nextNote < horizon) {
      if (this.rng.chance(0.78)) this.pluck(this.nextNote, scale);
      this.nextNote += beat * this.rng.pick([0.5, 1, 1, 1.5, 2, 3]);
    }
    const k = this.weights;
    while (this.nextCricket < horizon) {
      if (k.crickets > 0.08 && this.rng.chance(k.crickets)) this.cricket(this.nextCricket, k.crickets);
      this.nextCricket += this.rng.range(0.12, 0.35);
    }
    while (this.nextBell < horizon) {
      if (k.village > 0.3) this.bell(this.nextBell, scale);
      this.nextBell += this.rng.range(16, 34);
    }
    while (this.nextBubble < horizon) {
      if (k.water > 0.2) this.bubble(this.nextBubble, k.water);
      this.nextBubble += this.rng.range(0.25, 1.1);
    }
    while (this.nextCaw < horizon) {
      if (k.crows > 0.3) this.caw(this.nextCaw);
      this.nextCaw += this.rng.range(2.5, 8);
    }
    while (this.nextBird < horizon) {
      if (k.dawn > 0.5) this.bird(this.nextBird);
      this.nextBird += this.rng.range(1.5, 5);
    }
  }

  /** Note number of scale degree d (may exceed one octave) above the root. */
  private note(scale: readonly number[], d: number, octave = 0): number {
    return this.root + octave * 12 + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  }

  private env(t: number, peak: number, attack: number, hold: number, release: number, dest: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(dest);
    return g;
  }

  /** A soft pad: triad (plus a seventh now and then) of detuned triangle and sine pairs through a slow low-pass. */
  private chord(t: number, scale: readonly number[], beat: number) {
    const ctx = this.ctx!, len = beat * 4;
    const d = this.degree, notes = [this.note(scale, d, -1), this.note(scale, d + 2), this.note(scale, d + 4), this.note(scale, d + 7)];
    if (this.rng.chance(0.4)) notes.push(this.note(scale, d + 6));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1100, t + len * 0.5);
    lp.frequency.linearRampToValueAtTime(520, t + len * 1.4);
    lp.connect(this.bus);
    lp.connect(this.reverb);
    for (const [i, n] of notes.entries()) {
      const g = this.env(t, 0.045 / Math.sqrt(notes.length) * (i === 0 ? 1.5 : 1), len * 0.35, len * 0.3, len * 0.9, lp);
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = midi(n);
        o.detune.value = det + this.rng.range(-3, 3);
        o.connect(g);
        o.start(t);
        o.stop(t + len * 1.7);
      }
    }
  }

  /** A music-box note from the upper register. */
  private pluck(t: number, scale: readonly number[]) {
    const ctx = this.ctx!;
    // Favour chord tones of the current degree; wander a little around them.
    const d = this.degree + this.rng.pick([0, 2, 4, 7, 9, 11, 1, 3]);
    const f = midi(this.note(scale, d, 1));
    const g = this.env(t, this.rng.range(0.018, 0.035), 0.008, 0.02, this.rng.range(1.6, 2.8), this.bus);
    g.connect(this.reverb);
    for (const [mult, amp] of [[1, 1], [2, 0.3], [3.01, 0.12], [4.2, 0.05]] as const) {
      const o = ctx.createOscillator(), a = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * mult;
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + 3.5);
    }
  }

  /** A distant church bell: inharmonic partials with long decays. */
  private bell(t: number, scale: readonly number[]) {
    const ctx = this.ctx!, f = midi(this.note(scale, this.degree, 1));
    const g = this.env(t, 0.03, 0.01, 0.05, 6, this.bus);
    g.connect(this.reverb);
    for (const [mult, amp, dec] of [[1, 1, 1], [2.0, 0.5, 0.7], [2.76, 0.35, 0.5], [5.4, 0.18, 0.3], [8.93, 0.08, 0.2]] as const) {
      const o = ctx.createOscillator(), a = ctx.createGain();
      o.frequency.value = f * mult;
      a.gain.setValueAtTime(amp, t);
      a.gain.exponentialRampToValueAtTime(0.0001, t + 6 * dec);
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + 6.5);
    }
  }

  /** A cricket: a burst of short high pulses. */
  private cricket(t: number, level: number) {
    const ctx = this.ctx!, f = this.rng.range(3600, 4800), pulses = this.rng.int(2, 4);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f;
    g.gain.value = 0;
    for (let i = 0; i < pulses; i++) {
      const s = t + i * 0.045;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.0045 * level, s + 0.012);
      g.gain.linearRampToValueAtTime(0, s + 0.034);
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rng.range(-0.8, 0.8);
    o.connect(g).connect(pan).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** A drop in the river. */
  private bubble(t: number, level: number) {
    const ctx = this.ctx!, f = this.rng.range(500, 1500);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * this.rng.range(1.5, 2.2), t + 0.09);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012 * level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rng.range(-0.7, 0.7);
    o.connect(g).connect(pan);
    pan.connect(this.master);
    pan.connect(this.reverb);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** A crow's caw: a rough, falling call, two or three in a row. */
  private caw(t: number) {
    const ctx = this.ctx!, n = this.rng.int(1, 3), base = this.rng.range(420, 620);
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rng.range(-0.9, 0.9);
    pan.connect(this.master);
    pan.connect(this.reverb);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.34, o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 1.2;
      for (const [osc, mult] of [[o, 1], [o2, 1.51]] as const) {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(base * mult * 1.15, s);
        osc.frequency.exponentialRampToValueAtTime(base * mult * 0.8, s + 0.24);
      }
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.02, s + 0.03);
      g.gain.setValueAtTime(0.02, s + 0.14);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.3);
      o.connect(bp);
      o2.connect(bp);
      bp.connect(g).connect(pan);
      for (const osc of [o, o2]) { osc.start(s); osc.stop(s + 0.34); }
    }
  }

  /** A small bird at dawn: two quick glides. */
  private bird(t: number) {
    const ctx = this.ctx!, base = this.rng.range(2400, 3800), n = this.rng.int(2, 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = this.rng.range(-0.9, 0.9);
    pan.connect(this.master);
    pan.connect(this.reverb);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.13, o = ctx.createOscillator(), g = ctx.createGain();
      const up = this.rng.chance(0.5);
      o.frequency.setValueAtTime(base * (up ? 0.8 : 1.15), s);
      o.frequency.exponentialRampToValueAtTime(base * (up ? 1.2 : 0.85), s + 0.09);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.012, s + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.11);
      o.connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.14);
    }
  }
}
