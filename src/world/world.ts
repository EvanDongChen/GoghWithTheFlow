// The infinite world. Space is split into vertical chunks; each chunk deterministically
// generates its own features from the seed and chunk index. Anything that needs to know
// about nearby features (flow fields, overlap checks) looks at neighbouring chunks, so a
// point always sees the same features no matter which chunk is being painted.
//
// The first painting frame, x in [0, FRAME_W), follows the composition of the 1889 original
// (see CLASSIC below). Each seed varies it: it may be mirrored, gets its own sky mood and moon
// phase, and one landmark (a windmill, a river, haystacks or a lit café). Terrain blends
// smoothly from that layout into fully procedural country on either side.
//
// Beyond the frame the world is a sequence of regions, each with its own character, borrowed
// from other paintings of Van Gogh's: villages, wheat fields with haystacks, a river lined with
// gaslights, olive orchards in rows, and windmill hills.

import { Noise } from '../core/noise';
import { hash, hashFloat, hashString, Rng } from '../core/rng';
import { clamp, dist, lerp, smoothstep } from '../core/math';
import type { RGB } from '../core/color';

export const H = 1200;
export const CW = 750;
export const FRAME_W = 1500;
/** How many chunks either side can influence a point. */
const REACH = 2;

type Curve = readonly (readonly [number, number])[];

/** The Starry Night, as fractions of the frame width and height. */
const CLASSIC = {
  moon: { x: 0.885, y: 0.165, core: 0.062 },
  /** x, y, size */
  stars: [
    [0.1, 0.05, 1], [0.235, 0.035, 0.75], [0.345, 0.045, 0.9], [0.418, 0.068, 0.72],
    [0.238, 0.172, 1.05], [0.61, 0.09, 1.15], [0.705, 0.235, 1.0], [0.326, 0.322, 0.8],
    [0.046, 0.45, 0.8], [0.13, 0.478, 1.0], [0.352, 0.535, 1.5],
  ] as const,
  swirls: [
    { x: 0.53, y: 0.33, R: 0.17, dir: 1 },
    { x: 0.695, y: 0.47, R: 0.1, dir: -1 },
  ],
  /** The bright wave that streams in from the left and through the great swirl. */
  band: [[-0.6, 0.45], [-0.2, 0.46], [0, 0.44], [0.15, 0.4], [0.3, 0.37], [0.45, 0.4], [0.6, 0.46], [0.75, 0.465], [0.9, 0.425], [1.0, 0.4], [1.2, 0.42], [1.6, 0.45]] as Curve,
  /** Mountains rise to the right and end in a dark pointed peak. */
  ridgeBack: [[-0.6, 0.64], [-0.2, 0.655], [0, 0.66], [0.15, 0.645], [0.3, 0.655], [0.45, 0.63], [0.6, 0.6], [0.7, 0.572], [0.8, 0.548], [0.87, 0.52], [0.925, 0.485], [0.965, 0.497], [1.0, 0.512], [1.2, 0.56], [1.6, 0.6]] as Curve,
  ridgeFront: [[-0.6, 0.7], [-0.2, 0.71], [0, 0.712], [0.3, 0.71], [0.5, 0.69], [0.65, 0.66], [0.8, 0.63], [0.9, 0.612], [1.0, 0.6], [1.2, 0.63], [1.6, 0.66]] as Curve,
  villageTop: [[-0.6, 0.75], [-0.2, 0.76], [0, 0.765], [0.4, 0.752], [0.6, 0.732], [0.8, 0.712], [1.0, 0.7], [1.2, 0.72], [1.6, 0.73]] as Curve,
  /** The cypress is a cluster of flame tongues: x, top, width, lean. */
  cypress: [
    [0.3, 0.74, 0.3, 0.05], [0.218, 0.035, 0.15, -0.1], [0.158, 0.38, 0.085, -0.2],
    [0.315, 0.56, 0.13, 0.42], [0.398, 0.74, 0.11, 0.5],
  ] as const,
  church: { x: 0.575, spireTop: 0.615, base: 0.2 },
};

export type GlowKind = 'star' | 'moon';
export type Biome = 'village' | 'wheat' | 'river' | 'orchard' | 'mill' | 'sunflower' | 'crows';
export type Mood = 'classic' | 'indigo' | 'teal' | 'violet' | 'storm' | 'dawn' | 'dusk';
export type Landmark = 'none' | 'mill' | 'river' | 'haystacks' | 'cafe' | 'sunflowers' | 'crows';
export type MoonPhase = 'crescent' | 'half' | 'full';

export interface Vortex { x: number; y: number; R: number; dir: number; }

export interface Glow {
  id: number; kind: GlowKind;
  x: number; y: number; core: number; halo: number; ringW: number; dir: number;
  /** Crescent cutout: the lit part of the moon is the disk outside this offset circle. */
  cut?: { dx: number; dy: number; r: number };
  phase?: MoonPhase;
}

/** One flame-shaped lobe of a cypress. */
export interface Tongue {
  x: number; top: number; base: number; w: number; lean: number; ph: number; lobes: number; o: number;
}

export interface Cypress { id: number; x: number; tongues: Tongue[]; }

export interface House {
  id: number; x: number; y: number; size: number;
  w: number; h: number; depth: number; side: 1 | -1;
  roofH: number; peak: number; flatRoof: boolean;
  wall: 'light' | 'warm'; roof: 'blue' | 'rust' | 'green'; windows: number; chimney: boolean;
  /** block: the classic cube; cottage: low with a thatched roof; tall: a narrow townhouse; cafe: lit terrace. */
  style: 'block' | 'cottage' | 'tall' | 'cafe';
}

export interface Church {
  id: number; x: number; base: number; bodyW: number; bodyH: number;
  towerW: number; towerH: number; spireTop: number; warm: boolean;
  style: 'spire' | 'tower' | 'dome';
}

export type TreeKind = 'round' | 'poplar' | 'olive' | 'pine' | 'iris' | 'sunflower';
export interface Tree { id: number; x: number; y: number; r: number; kind: TreeKind; }

/** A windmill standing on a hill; its sails are drawn by the animation layer so they can turn. */
export interface Mill { id: number; x: number; y: number; h: number; w: number; sail: number; ph: number; speed: number; warm: boolean; }
export interface Haystack { id: number; x: number; y: number; w: number; h: number; }
export interface Lamp { id: number; x: number; y: number; h: number; }
/** A crow circling over the wheat. Its flight is drawn by the animation layer, around (x, y). */
export interface Crow { id: number; x: number; y: number; size: number; ph: number; speed: number; loop: number; }
export interface Boat { id: number; x: number; y: number; w: number; dir: 1 | -1; hue: number; }

interface SkyMajor { moon?: Glow; vortices: Vortex[]; cypress?: Cypress; }
interface Village {
  houses: House[]; churches: Church[]; trees: Tree[];
  mills: Mill[]; stacks: Haystack[]; lamps: Lamp[]; boats: Boat[]; crows: Crow[];
}

export interface Nearby extends Village {
  vortices: Vortex[]; glows: Glow[]; cypresses: Cypress[];
}

const emptyVillage = (): Village => ({ houses: [], churches: [], trees: [], mills: [], stacks: [], lamps: [], boats: [], crows: [] });

/** Regions are a few screens wide; region 0 holds the classic frame. */
const REGION = 3000;
const REGION0 = -750;
const BIOMES: readonly [Biome, number][] = [['village', 0.22], ['wheat', 0.14], ['river', 0.17], ['orchard', 0.12], ['mill', 0.11], ['sunflower', 0.12], ['crows', 0.12]];
const MOODS: readonly [Mood, number][] = [['classic', 0.28], ['indigo', 0.12], ['teal', 0.1], ['violet', 0.1], ['storm', 0.12], ['dawn', 0.14], ['dusk', 0.14]];

/**
 * How a mood shifts the sky's blues: darken, lighten, then mix toward `to`. Glows keep their gold.
 * Dawn and dusk are the warm twilights; the rest are different nights.
 */
export interface Grade { to: RGB; t: number; dark: number; lift: number; }
export const GRADES: Record<Mood, Grade> = {
  classic: { to: [0, 0, 0], t: 0, dark: 0, lift: 0 },
  indigo: { to: [72, 48, 150], t: 0.2, dark: 0.04, lift: 0 },
  teal: { to: [36, 128, 138], t: 0.2, dark: 0, lift: 0 },
  violet: { to: [124, 80, 172], t: 0.22, dark: 0, lift: 0 },
  storm: { to: [92, 102, 124], t: 0.2, dark: 0.16, lift: 0 },
  dawn: { to: [238, 156, 142], t: 0.34, dark: 0, lift: 0.05 },
  dusk: { to: [212, 104, 74], t: 0.32, dark: 0.1, lift: 0 },
};
/** The heavy, cold grade over fields of crows, darker than an ordinary stormy night. */
const CROW_SKY: Grade = { to: [66, 82, 104], t: 0.4, dark: 0.3, lift: 0 };
export const MOOD_NAMES: Record<Mood, string> = {
  classic: 'Starry night', indigo: 'Indigo night', teal: 'Teal night', violet: 'Violet night', storm: 'Stormy night', dawn: 'Dawn', dusk: 'Dusk',
};
/** The sky changes mood every ZONE units of walking, easing over the middle of each border. */
const ZONE = 6000;
const ZONE0 = -1500;

function mixGrade(a: Grade, b: Grade, t: number): Grade {
  return {
    to: [lerp(a.to[0], b.to[0], t), lerp(a.to[1], b.to[1], t), lerp(a.to[2], b.to[2], t)],
    t: lerp(a.t, b.t, t), dark: lerp(a.dark, b.dark, t), lift: lerp(a.lift, b.lift, t),
  };
}
const LANDMARKS: readonly [Landmark, number][] = [['none', 0.22], ['mill', 0.15], ['river', 0.17], ['haystacks', 0.13], ['cafe', 0.11], ['sunflowers', 0.11], ['crows', 0.11]];

function weighted<T>(table: readonly [T, number][], u: number): T {
  for (const [v, w] of table) { if (u < w) return v; u -= w; }
  return table[table.length - 1][0];
}

type ClassicLayout = typeof CLASSIC;

/** Mirror the classic layout left to right. */
function mirrorClassic(): ClassicLayout {
  const fx = (x: number) => 1 - x;
  const curve = (c: Curve): Curve => c.map(([x, y]) => [fx(x), y] as const).sort((a, b) => a[0] - b[0]);
  return {
    moon: { ...CLASSIC.moon, x: fx(CLASSIC.moon.x) },
    stars: CLASSIC.stars.map(([x, y, s]) => [fx(x), y, s] as const) as unknown as ClassicLayout['stars'],
    swirls: CLASSIC.swirls.map((sw) => ({ ...sw, x: fx(sw.x), dir: -sw.dir })),
    band: curve(CLASSIC.band), ridgeBack: curve(CLASSIC.ridgeBack), ridgeFront: curve(CLASSIC.ridgeFront), villageTop: curve(CLASSIC.villageTop),
    cypress: CLASSIC.cypress.map(([x, top, w, lean]) => [fx(x), top, w, -lean] as const) as unknown as ClassicLayout['cypress'],
    church: { ...CLASSIC.church, x: fx(CLASSIC.church.x) },
  };
}

/** A smooth curve through control points (in frame fractions), sampled for fast lookup. */
class Sampled {
  private ys: Float32Array;
  private static readonly X0 = -0.6 * FRAME_W;
  private static readonly STEP = 4;

  constructor(points: Curve, jitter: (i: number) => number) {
    const pts = points.map(([x, y], i) => [x * FRAME_W, (y + jitter(i)) * H] as const);
    const n = Math.ceil((2.2 * FRAME_W) / Sampled.STEP) + 1;
    this.ys = new Float32Array(n);
    let seg = 0;
    for (let i = 0; i < n; i++) {
      const x = Sampled.X0 + i * Sampled.STEP;
      while (seg < pts.length - 2 && x > pts[seg + 1][0]) seg++;
      // Catmull-Rom between pts[seg] and pts[seg + 1].
      const p0 = pts[Math.max(0, seg - 1)], p1 = pts[seg], p2 = pts[seg + 1], p3 = pts[Math.min(pts.length - 1, seg + 2)];
      const t = clamp((x - p1[0]) / (p2[0] - p1[0]), 0, 1), t2 = t * t, t3 = t2 * t;
      this.ys[i] = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
    }
  }

  at(x: number): number {
    const f = clamp((x - Sampled.X0) / Sampled.STEP, 0, this.ys.length - 1.001);
    const i = Math.floor(f);
    return lerp(this.ys[i], this.ys[i + 1], f - i);
  }
}

export class World {
  readonly seed: string;
  readonly s: number;
  readonly noise: Noise;
  readonly horizon: number;
  private readonly landO: number[];
  private readonly classic: { band: Sampled; back: Sampled; front: Sampled; village: Sampled };
  /** The classic layout for this seed (possibly mirrored). */
  private readonly C: ClassicLayout;
  /** Mirrors a classic-frame fraction when the layout is flipped. */
  private readonly fx: (x: number) => number;
  readonly flipped: boolean;
  mood: Mood;
  readonly landmark: Landmark;
  private majorCache = new Map<number, SkyMajor>();
  private minorCache = new Map<number, Vortex[]>();
  private starCache = new Map<number, Glow[]>();
  private villageCache = new Map<number, Village>();
  private nearCache = new Map<number, Nearby>();

  constructor(seed: string) {
    this.seed = seed;
    this.s = hashString(seed);
    this.noise = new Noise(new Rng(hash(this.s, 0x4e015e)));
    const r = this.rng(-999, 0);
    this.horizon = H * r.range(0.58, 0.62);
    this.landO = Array.from({ length: 6 }, () => r.range(0, 100));
    const j = (k: number, amt: number) => (i: number) => (hashFloat(this.s, 77, k, i) - 0.5) * 2 * amt;
    this.flipped = r.chance(0.28);
    this.fx = this.flipped ? (x) => 1 - x : (x) => x;
    this.C = this.flipped ? mirrorClassic() : CLASSIC;
    this.mood = weighted(MOODS, r.random());
    this.landmark = weighted(LANDMARKS, r.random());
    // Crows come with weather: most nights that feature them are stormy.
    if (this.landmark === 'crows' && r.chance(0.65)) this.mood = 'storm';
    this.moodCache.set(0, this.mood);
    this.classic = {
      band: new Sampled(this.C.band, j(1, 0.03)),
      back: new Sampled(this.C.ridgeBack, j(2, 0.018)),
      front: new Sampled(this.C.ridgeFront, j(3, 0.012)),
      village: new Sampled(this.C.villageTop, j(4, 0.01)),
    };
  }

  rng(...k: number[]): Rng {
    return new Rng(hash(this.s, ...k));
  }

  static chunkOf(x: number): number {
    return Math.floor(x / CW);
  }

  /** 1 inside the classic frame, fading to 0 a few hundred px outside it. */
  private classicWeight(x: number): number {
    return smoothstep(-0.45 * FRAME_W, -0.05 * FRAME_W, x) * (1 - smoothstep(1.05 * FRAME_W, 1.45 * FRAME_W, x));
  }

  private blend(x: number, classic: Sampled, procedural: () => number): number {
    const w = this.classicWeight(x);
    if (w >= 1) return classic.at(x);
    if (w <= 0) return procedural();
    return lerp(procedural(), classic.at(x), w);
  }

  // ---------------------------------------------------------------- land

  /** Sparse sharp peaks: ridged noise raised to a high power, only in mountainous stretches. */
  private peaks(x: number): number {
    const [, , , , o5, o6] = this.landO;
    const ridged = Math.pow(1 - Math.abs(this.noise.noise2(x * 0.0016 + o5, o5)), 6);
    const range = smoothstep(-0.1, 0.45, this.noise.noise2(x * 0.0003 + o6, o6));
    return H * 0.14 * ridged * range;
  }

  ridgeBack = (x: number): number => {
    const [o1, , , o4] = this.landO;
    const texture = H * 0.008 * this.noise.noise2(x * 0.012 + o1, 3.1);
    return texture + this.blend(x, this.classic.back, () =>
      this.horizon + H * 0.045 * this.noise.noise2(x * 0.0004 + o4, o4) + H * 0.05 * this.noise.fbm(x * 0.0018 + o1, o1, 3) - this.peaks(x));
  };

  ridgeFront = (x: number): number => {
    const o2 = this.landO[1];
    const f = this.blend(x, this.classic.front, () => this.ridgeBack(x) + this.peaks(x) * 0.6 + H * 0.06 + H * 0.03 * this.noise.fbm(x * 0.0025 + o2, o2, 2));
    return Math.max(f, this.ridgeBack(x) + H * 0.03);
  };

  villageTop = (x: number): number => {
    const o3 = this.landO[2];
    const v = this.blend(x, this.classic.village, () => this.ridgeFront(x) + H * 0.05 + H * 0.012 * this.noise.noise2(x * 0.004 + o3, o3));
    return Math.max(v, this.ridgeFront(x) + H * 0.03);
  };

  /** How much a hill point sits on a high peak (0..1); peaks are painted darker. */
  peakness(x: number): number {
    return smoothstep(0.05, 0.13, (this.horizon - this.ridgeBack(x)) / H);
  }

  // ---------------------------------------------------------------- sky mood

  private moodCache = new Map<number, Mood>();

  /** Mood of zone k. Zone 0 holds the classic frame and has the seed's own mood; the others are drawn by lot. */
  moodOf(k: number): Mood {
    const cached = this.moodCache.get(k);
    if (cached) return cached;
    const step = k > 0 ? 1 : -1;
    let j = k - step;
    while (!this.moodCache.has(j)) j -= step;
    for (j += step; ; j += step) {
      const prev = this.moodCache.get(j - step)!;
      let m = weighted(MOODS, hashFloat(this.s, j, 951));
      for (let t = 0; m === prev && t < 8; t++) m = weighted(MOODS, hashFloat(this.s, j, 952 + t));
      this.moodCache.set(j, m);
      if (j === k) return m;
    }
  }

  private zoneAt(x: number): { k: number; u: number } {
    const f = (x - ZONE0) / ZONE;
    const k = Math.floor(f);
    return { k, u: f - k };
  }

  /** The mood that dominates at x. Fields of crows lie under their own storm. */
  moodAt(x: number): Mood {
    if (this.biomeWeight(x, 'crows') > 0.5) return 'storm';
    const { k, u } = this.zoneAt(x);
    return this.moodOf(u < 0.05 ? k - 1 : u > 0.95 ? k + 1 : k);
  }

  /** The sky grade at x: a smooth blend between neighbouring moods, so dusk drifts into night as you walk. */
  gradeAt(x: number): Grade {
    const { k, u } = this.zoneAt(x);
    const base = u < 0.2 ? mixGrade(GRADES[this.moodOf(k - 1)], GRADES[this.moodOf(k)], smoothstep(-0.2, 0.2, u))
      : u > 0.8 ? mixGrade(GRADES[this.moodOf(k)], GRADES[this.moodOf(k + 1)], smoothstep(0.8, 1.2, u))
      : GRADES[this.moodOf(k)];
    const crows = this.biomeWeight(x, 'crows');
    return crows > 0.01 ? mixGrade(base, CROW_SKY, crows) : base;
  }

  // ---------------------------------------------------------------- regions

  /** Which region x falls in, and how far through it (0..1). Borders wander with noise. */
  private regionAt(x: number): { idx: number; u: number } {
    const f = (x + 260 * this.noise.noise2(x * 0.0012 + 11, 4.4) - REGION0) / REGION;
    const idx = Math.floor(f);
    return { idx, u: f - idx };
  }

  private biomeRaw(idx: number): Biome {
    return weighted(BIOMES, hashFloat(this.s, idx, 901));
  }

  private biomeCache = new Map<number, Biome>([[0, 'village']]);

  /**
   * Region 0 is the classic village; the others are drawn by lot, never repeating the region
   * next to them (resolved outward from region 0, so neighbours always agree).
   */
  biomeOf(idx: number): Biome {
    const cached = this.biomeCache.get(idx);
    if (cached) return cached;
    const step = idx > 0 ? 1 : -1;
    let k = idx - step;
    while (!this.biomeCache.has(k)) k -= step;
    for (k += step; ; k += step) {
      const prev = this.biomeCache.get(k - step)!;
      let b = this.biomeRaw(k);
      for (let t = 0; b === prev && t < 8; t++) b = weighted(BIOMES, hashFloat(this.s, k, 902 + t));
      this.biomeCache.set(k, b);
      if (k === idx) return b;
    }
  }

  biomeAt(x: number): Biome {
    return this.biomeOf(this.regionAt(x).idx);
  }

  /** How strongly x belongs to biome b: 1 inside its region, easing to 0 at the borders. */
  biomeWeight(x: number, b: Biome): number {
    const { idx, u } = this.regionAt(x);
    if (this.biomeOf(idx) !== b) return 0;
    return smoothstep(0, 0.1, u) * (1 - smoothstep(0.9, 1, u));
  }

  /** How much river there is at x (0..1): river regions, or the classic frame's river landmark. */
  riverWeight(x: number): number {
    const classic = this.landmark === 'river' ? this.classicWeight(x) * smoothstep(0.32, 0.4, this.fx(x / FRAME_W)) : 0;
    return Math.max(classic, this.biomeWeight(x, 'river'));
  }

  /** How much of the ground at x is wheat field: wheat and mill regions, or the haystack landmark. */
  wheatWeight(x: number): number {
    const f = this.fx(x / FRAME_W);
    const classic = this.landmark === 'haystacks' || this.landmark === 'crows' ? 0.85 * this.classicWeight(x) * smoothstep(0.3, 0.46, f) * (1 - smoothstep(0.62, 0.78, f)) : 0;
    return Math.max(classic, this.biomeWeight(x, 'wheat'), this.biomeWeight(x, 'crows'), 0.6 * this.biomeWeight(x, 'mill'));
  }

  /** How much sunflower field there is at x: sunflower regions, or the sunflower landmark in the frame. */
  sunflowerWeight(x: number): number {
    const f = this.fx(x / FRAME_W);
    const classic = this.landmark === 'sunflowers' ? 0.9 * this.classicWeight(x) * smoothstep(0.28, 0.42, f) : 0;
    return Math.max(classic, this.biomeWeight(x, 'sunflower'));
  }

  /** How much of the wheat at x lies under the crows' storm: crow regions, or the crow landmark. */
  crowsWeight(x: number): number {
    const f = this.fx(x / FRAME_W);
    const classic = this.landmark === 'crows' ? 0.9 * this.classicWeight(x) * smoothstep(0.3, 0.46, f) * (1 - smoothstep(0.62, 0.78, f)) : 0;
    return Math.max(classic, this.biomeWeight(x, 'crows'));
  }

  /** Centre line of the river, as a depth into the valley. */
  private riverCenter(x: number): number {
    const t = this.landmark === 'river' ? lerp(0.36, 0.64, this.classicWeight(x)) : 0.36;
    return this.depthY(x, t) + H * 0.008 * this.noise.noise2(x * 0.004 + 21, 9.1);
  }

  riverTop = (x: number): number => this.riverCenter(x) - H * 0.034 * this.riverWeight(x);
  riverBottom = (x: number): number => this.riverCenter(x) + H * 0.034 * this.riverWeight(x);

  inRiver(x: number, y: number, pad = 0): boolean {
    if (this.riverWeight(x) < 0.02) return false;
    return y > this.riverTop(x) - pad && y < this.riverBottom(x) + pad;
  }

  /** y of a point a fraction t of the way from the village top to the bottom edge. */
  depthY(x: number, t: number): number {
    const top = this.villageTop(x);
    return top + (H - top) * t;
  }

  /** The bright ribbon the base sky flow follows. */
  bandY = (x: number): number =>
    this.blend(x, this.classic.band, () => H * 0.3 + H * 0.06 * this.noise.fbm(x * 0.0009 + 3.3, 7.7, 2));
  bandWidth = H * 0.095;

  // ---------------------------------------------------------------- per-chunk generation

  /** A feature that appears in at most every other chunk, with probability p. */
  private sparse(c: number, kind: number, p: number): boolean {
    return hashFloat(this.s, c, kind) < p && !(hashFloat(this.s, c - 1, kind) < p);
  }

  private isClassic(c: number) {
    return c === 0 || c === 1;
  }

  private major(c: number): SkyMajor {
    let m = this.majorCache.get(c);
    if (m) return m;
    const r = this.rng(c, 1);
    const x0 = c * CW;
    m = { vortices: [] };
    const jx = () => r.range(-0.015, 0.015) * FRAME_W, jy = () => r.range(-0.012, 0.012) * H;
    const C = this.C, moonChunk = World.chunkOf(C.moon.x * FRAME_W), cypressChunk = 1 - moonChunk;

    if (c === moonChunk) {
      const core = H * C.moon.core * r.range(0.9, 1.1);
      m.moon = this.makeMoon(c, C.moon.x * FRAME_W + jx() * 1.5, C.moon.y * H + jy() * 1.5, core, r);
    } else if (!this.isClassic(c) && c !== 2 && c !== -1 && this.sparse(c, 11, 0.3)) {
      m.moon = this.makeMoon(c, x0 + CW * r.range(0.2, 0.8), H * r.range(0.1, 0.17), H * r.range(0.045, 0.06), r);
    }

    if (c === 0) {
      // The great swirl wanders a little further from seed to seed than the rest of the layout.
      for (const sw of C.swirls) m.vortices.push({ x: sw.x * FRAME_W + jx() * 2.5, y: sw.y * H + jy() * 2.5, R: sw.R * H * r.range(0.88, 1.12), dir: sw.dir });
    } else if (c !== 1 && c !== -1 && this.sparse(c, 13, 0.5)) {
      const cx = x0 + CW * r.range(0.3, 0.7), cy = H * r.range(0.26, 0.36), R = H * r.range(0.13, 0.17);
      const dir = r.chance(0.5) ? 1 : -1, side = r.chance(0.5) ? 1 : -1;
      // A big spiral with a smaller counter-rotating one tucked below and to the side.
      m.vortices.push({ x: cx, y: cy, R, dir });
      m.vortices.push({ x: cx + side * R * 0.95, y: cy + R * 0.8, R: R * r.range(0.5, 0.65), dir: -dir });
    }

    if (c === cypressChunk) {
      m.cypress = {
        id: hash(this.s, c, 15), x: this.fx(0.25) * FRAME_W,
        tongues: this.cypressVariant().map(([x, top, w, lean], i) => this.makeTongue(r, x * FRAME_W + jx() * 0.5, top * H + jy() * 2, w * FRAME_W * r.range(0.92, 1.08), lean, i)),
      };
    } else if (!this.isClassic(c) && c !== -1 && c !== 2 && this.sparse(c, 14, 0.34)) {
      const x = x0 + CW * r.range(0.15, 0.85), tall = r.chance(0.6);
      const w = FRAME_W * (tall ? r.range(0.11, 0.14) : r.range(0.08, 0.1));
      const tongues = [this.makeTongue(r, x, tall ? H * r.range(0.03, 0.12) : H * r.range(0.25, 0.4), w, r.range(-0.2, 0.2), 0)];
      tongues.push(this.makeTongue(r, x + w * r.range(0.1, 0.4), H * r.range(0.75, 0.85), w * 2, 0, 1));
      const extra = r.int(0, 3);
      for (let i = 0; i < extra; i++) {
        const side = r.chance(0.5) ? 1 : -1;
        tongues.push(this.makeTongue(r, x + side * w * r.range(0.5, 1.3), H * r.range(0.35, 0.75), w * r.range(0.5, 0.8), side * r.range(0.2, 0.55), i + 2));
      }
      m.cypress = { id: hash(this.s, c, 15), x, tongues };
    }
    this.majorCache.set(c, m);
    return m;
  }

  /**
   * The foreground tree on the near side of the frame. Each seed picks one of several silhouettes
   * (x, top, width, lean as frame fractions; the first entry is the low dark mass at the foot) and
   * nudges every flame, so the tree stops being the same one from night to night. Mirrored
   * layouts flip the whole thing.
   */
  private cypressVariant(): (readonly [number, number, number, number])[] {
    type T = readonly [number, number, number, number];
    const r = this.rng(-998, 61), u = r.random(), fx = this.fx, flip = this.flipped ? -1 : 1;
    // x positions of the base mass and flames, as written, are for the unflipped layout.
    const variants: Record<string, T[]> = {
      twin: [[0.27, 0.7, 0.28, 0], [0.2, 0.08, 0.11, -0.12], [0.32, 0.22, 0.1, 0.16]],
      spire: [[0.27, 0.72, 0.2, 0], [0.26, 0.02, 0.09, 0.04], [0.35, 0.52, 0.07, 0.3]],
      sprawl: [[0.25, 0.66, 0.38, 0], [0.15, 0.34, 0.1, -0.2], [0.26, 0.26, 0.11, 0], [0.36, 0.4, 0.1, 0.25], [0.43, 0.62, 0.09, 0.4]],
      leaning: [[0.3, 0.74, 0.28, 0.1], [0.23, 0.1, 0.14, 0.5], [0.13, 0.42, 0.08, -0.3]],
      steps: [[0.27, 0.72, 0.34, 0], [0.17, 0.42, 0.09, -0.1], [0.27, 0.12, 0.12, 0], [0.37, 0.32, 0.09, 0.2]],
      grove: [[0.25, 0.72, 0.42, 0], [0.12, 0.3, 0.09, -0.15], [0.39, 0.08, 0.1, 0.12]],
    };
    let tongues: T[];
    if (u < 0.22) {
      // The original cluster, but with its flames re-rolled a little more boldly than the rest of the layout.
      // (CLASSIC is already mirrored for flipped layouts.)
      tongues = this.C.cypress.map(([x, top, w, lean], i) => i === 0 ? [x, top, w, lean] as const
        : [x, clamp(top + r.range(-0.06, 0.1), 0.02, 0.7), w * r.range(0.8, 1.25), lean * r.range(0.5, 1.4)] as const);
      if (r.chance(0.35)) tongues.splice(r.int(2, tongues.length - 1), 1);
    } else {
      const names = Object.keys(variants);
      tongues = variants[names[Math.min(names.length - 1, Math.floor(((u - 0.22) / 0.78) * names.length))]]
        .map(([x, top, w, lean]) => [fx(x), top, w, lean * flip] as const);
    }
    const dx = r.range(-0.03, 0.03), stretch = r.range(0.85, 1.15);
    return tongues.map(([x, top, w, lean], i) => [x + dx, i ? clamp(top * stretch, 0.01, 0.74) : top, w, lean] as const);
  }

  private makeMoon(c: number, x: number, y: number, core: number, r: Rng): Glow {
    const phase: MoonPhase = r.random() < 0.6 ? 'crescent' : r.chance(0.45) ? 'half' : 'full';
    // The lit side faces away from the cutout; mirrored layouts light the other side.
    const side = (this.flipped ? -1 : 1) * (this.isClassic(c) || r.chance(0.6) ? 1 : -1);
    const cut = phase === 'full' ? undefined
      : phase === 'half' ? { dx: -side * core * 0.62, dy: -core * 0.08, r: core * 0.95 }
      : { dx: -side * core * r.range(0.4, 0.46), dy: -core * r.range(0.26, 0.32), r: core * 0.72 };
    return {
      id: hash(this.s, c, 12), kind: 'moon', x, y, core, phase, cut,
      halo: core * r.range(2.0, 2.3), ringW: core * 0.3, dir: r.chance(0.5) ? 1 : -1,
    };
  }

  private makeTongue(r: Rng, x: number, top: number, w: number, lean: number, i: number): Tongue {
    return { x, top, base: H * 1.03, w, lean, ph: r.range(0, 6.28) + i, lobes: r.range(20, 32), o: r.range(0, 100) };
  }

  private majorsNear(c: number): SkyMajor[] {
    const out: SkyMajor[] = [];
    for (let i = c - REACH; i <= c + REACH; i++) out.push(this.major(i));
    return out;
  }

  private minor(c: number): Vortex[] {
    let v = this.minorCache.get(c);
    if (v) return v;
    v = [];
    if (c === 0 && hashFloat(this.s, 0, 31) < 0.35) {
      // Sometimes a small eddy curls in an empty patch of the classic sky.
      const r = this.rng(c, 2);
      const majors = this.majorsNear(c);
      for (let tries = 0; tries < 40 && !v.length; tries++) {
        const cand = { x: FRAME_W * r.range(0.05, 0.95), y: H * r.range(0.1, 0.4), R: H * r.range(0.05, 0.07), dir: r.chance(0.5) ? 1 : -1 };
        const clear = majors.every((mj) =>
          (!mj.moon || dist(cand.x, cand.y, mj.moon.x, mj.moon.y) > mj.moon.halo + cand.R * 1.5) &&
          mj.vortices.every((o) => dist(cand.x, cand.y, o.x, o.y) > o.R + cand.R * 1.4) &&
          (!mj.cypress || !cypressCovers(mj.cypress, this.noise, cand.x, cand.y, cand.R)));
        if (clear) v.push(cand);
      }
    }
    if (!this.isClassic(c)) {
      const r = this.rng(c, 2);
      const majors = this.majorsNear(c);
      const n = r.int(0, 2);
      for (let tries = 0; v.length < n && tries < 60; tries++) {
        const cand = { x: c * CW + CW * r.range(0.1, 0.9), y: H * r.range(0.08, 0.45), R: H * r.range(0.05, 0.075), dir: r.chance(0.5) ? 1 : -1 };
        const clear = majors.every((m) =>
          (!m.moon || dist(cand.x, cand.y, m.moon.x, m.moon.y) > m.moon.halo + cand.R * 1.6) &&
          m.vortices.every((o) => dist(cand.x, cand.y, o.x, o.y) > o.R * 0.9 + cand.R * 1.6)) &&
          v.every((o) => dist(cand.x, cand.y, o.x, o.y) > (o.R + cand.R) * 1.6);
        if (clear) v.push(cand);
      }
    }
    this.minorCache.set(c, v);
    return v;
  }

  private stars(c: number): Glow[] {
    let s = this.starCache.get(c);
    if (s) return s;
    s = this.isClassic(c) ? this.classicStars(c) : this.proceduralStars(c);
    this.starCache.set(c, s);
    return s;
  }

  private classicStars(c: number): Glow[] {
    const r = this.rng(c, 3);
    // Each seed leaves out a couple of the eleven stars, so the constellation changes.
    const drop = new Set<number>();
    const nDrop = Math.floor(hashFloat(this.s, 0, 33) * 3);
    for (let k = 0; k < nDrop; k++) drop.add(Math.floor(hashFloat(this.s, 0, 34, k) * this.C.stars.length));
    return this.C.stars
      .map(([x, y, size], i) => ({ x: x * FRAME_W, y: y * H, size, i }))
      .filter((st) => World.chunkOf(st.x) === c && !drop.has(st.i))
      .map(({ x, y, size, i }) => {
        const core = H * 0.0115 * size * r.range(0.82, 1.18);
        return {
          id: hash(this.s, c, 3, i), kind: 'star' as const,
          x: x + r.range(-0.012, 0.012) * FRAME_W, y: y + r.range(-0.01, 0.01) * H,
          core, halo: core * r.range(2.8, 3.2), ringW: Math.max(4, core * 0.36), dir: r.chance(0.5) ? 1 : -1,
        };
      });
  }

  private proceduralStars(c: number): Glow[] {
    const majors = this.majorsNear(c);
    const minors: Vortex[] = [];
    for (let i = c - REACH; i <= c + REACH; i++) minors.push(...this.minor(i));
    // Classic stars near the frame edges must not be crowded by a neighbour's stars.
    const fixed = [c - 1, c + 1].filter((k) => this.isClassic(k)).flatMap((k) => this.stars(k));
    const s: Glow[] = [];
    // One candidate per cell of a 3x3 grid; cell margins keep halos from touching across cells.
    const cols = 3, rows = 3, cellW = CW / cols, yTop = H * 0.04, cellH = (H * 0.5 - yTop) / rows;
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        const r = this.rng(c, 3, cx, cy);
        if (!r.chance(0.42)) continue;
        const core = H * r.range(0.008, 0.016), halo = core * r.range(2.8, 3.6), m = halo + 6;
        const x = c * CW + cx * cellW + r.range(m, cellW - m);
        const y = yTop + cy * cellH + r.range(Math.min(m, cellH / 2), Math.max(cellH - m, cellH / 2));
        const clear = majors.every((mj) =>
          (!mj.moon || dist(x, y, mj.moon.x, mj.moon.y) > mj.moon.halo + halo * 1.2) &&
          mj.vortices.every((o) => dist(x, y, o.x, o.y) > o.R * 0.9 + halo * 1.2) &&
          (!mj.cypress || !cypressCovers(mj.cypress, this.noise, x, y, halo * 0.6))) &&
          minors.every((o) => dist(x, y, o.x, o.y) > o.R * 0.9 + halo * 1.2) &&
          fixed.every((o) => dist(x, y, o.x, o.y) > o.halo + halo + 20);
        if (!clear) continue;
        s.push({
          id: hash(this.s, c, 3, cx, cy), kind: 'star', x, y, core, halo,
          ringW: Math.max(4, core * 0.36), dir: r.chance(0.5) ? 1 : -1,
        });
      }
    }
    return s;
  }

  private village(c: number): Village {
    let v = this.villageCache.get(c);
    if (v) return v;
    v = this.isClassic(c) ? this.classicVillage(c) : this.regionVillage(c);
    this.villageCache.set(c, v);
    return v;
  }

  private cypressesNear(c: number): Cypress[] {
    return this.majorsNear(c).map((m) => m.cypress).filter((q): q is Cypress => !!q);
  }

  private makeHouse(r: Rng, id: number, x: number, y: number, size: number, style: House['style']): House {
    const u = r.random();
    const w = size * (style === 'tall' ? r.range(0.7, 0.95) : style === 'cottage' ? r.range(1.3, 1.8) : style === 'cafe' ? 1.6 : r.range(0.9, 1.6));
    const h = size * (style === 'tall' ? r.range(1.2, 1.6) : style === 'cottage' ? r.range(0.5, 0.65) : r.range(0.6, 0.9));
    return {
      id, x, y, size, w, h, style,
      depth: w * r.range(0.25, 0.45), side: r.chance(0.5) ? 1 : -1,
      roofH: size * (style === 'cottage' ? r.range(0.55, 0.8) : r.range(0.45, 0.75)), peak: r.range(-0.2, 0.2),
      flatRoof: style === 'tall' ? r.chance(0.35) : style === 'block' && r.chance(0.08),
      wall: style === 'cafe' || r.chance(0.12) ? 'warm' : 'light',
      roof: u < 0.62 ? 'blue' : u < 0.82 ? 'rust' : 'green',
      windows: style === 'tall' ? r.int(1, 2) : style === 'cafe' ? 2 : r.int(0, 2), chimney: r.chance(0.3),
    };
  }

  private makeChurch(r: Rng, id: number, x: number, base: number, spireTop: number, warm: boolean): Church {
    const u = r.random();
    return {
      id, x, base, spireTop, warm,
      bodyW: H * r.range(0.065, 0.078), bodyH: H * r.range(0.036, 0.046),
      towerW: H * r.range(0.02, 0.026), towerH: H * r.range(0.025, 0.035),
      style: u < 0.6 ? 'spire' : u < 0.82 ? 'tower' : 'dome',
    };
  }

  /** Place houses with rejection sampling; `at` proposes a position, or null to skip a try. */
  private placeHouses(v: Village, r: Rng, c: number, n: number, tries: number,
    at: () => { x: number; y: number; size: number; style: House['style'] } | null,
    blocked: (x: number, y: number, pad: number) => boolean) {
    for (let k = 0; v.houses.length < n && k < tries; k++) {
      const p = at();
      if (!p || blocked(p.x, p.y, p.size * 0.6)) continue;
      if (v.churches.some((ch) => Math.abs(p.x - ch.x) < ch.bodyW && Math.abs(p.y - ch.base) < p.size * 1.6)) continue;
      if (v.houses.some((h) => Math.abs(h.x - p.x) < (h.size + p.size) * 0.75 && Math.abs(h.y - p.y) < (h.size + p.size) * 0.3)) continue;
      if (v.stacks.some((s) => Math.abs(s.x - p.x) < s.w + p.size && Math.abs(s.y - p.y) < p.size)) continue;
      v.houses.push(this.makeHouse(r, hash(this.s, c, 42, k), p.x, p.y, p.size, p.style));
    }
  }

  /** A line of rounded olive trees along the foot of the hills. */
  private treeLine(v: Village, r: Rng, c: number, from: number, to: number, gappy: boolean, blocked: (x: number, y: number, pad: number) => boolean) {
    for (let x = from, k = 0; x < to; x += r.range(26, 48), k++) {
      if (gappy && this.noise.noise2(x * 0.004 + 40, 2.2) < -0.1) continue;
      const y = this.villageTop(x) + H * r.range(0.0, 0.03);
      if (blocked(x, y, 0)) continue;
      v.trees.push({ id: hash(this.s, c, 44, k), x, y, r: H * r.range(0.018, 0.032), kind: 'olive' });
    }
  }

  private makeMill(r: Rng, id: number, x: number, y: number, scale = 1): Mill {
    const h = H * r.range(0.1, 0.14) * scale;
    return {
      id, x, y, h, w: h * r.range(0.3, 0.38), sail: h * r.range(0.62, 0.78), ph: r.range(0, 6.28),
      speed: r.range(0.15, 0.35) * (r.chance(0.5) ? 1 : -1), warm: r.chance(0.5),
    };
  }

  private addStacks(v: Village, r: Rng, c: number, n: number, xs: () => number, ts: () => number, blocked: (x: number, y: number, pad: number) => boolean) {
    for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
      const x = xs(), t = ts(), y = this.depthY(x, t), w = H * lerp(0.035, 0.085, t);
      if (blocked(x, y, w * 0.5) || v.stacks.some((s) => Math.abs(s.x - x) < (s.w + w) * 0.6 && Math.abs(s.y - y) < w * 0.5)) continue;
      v.stacks.push({ id: hash(this.s, c, 46, tries), x, y, w, h: w * r.range(0.65, 0.9) });
      k++;
    }
  }

  private addLampsAlong(v: Village, r: Rng, c: number, from: number, to: number, yAt: (x: number) => number, blocked: (x: number, y: number, pad: number) => boolean) {
    for (let x = from + r.range(0, 40), k = 0; x < to; x += r.range(65, 105), k++) {
      const y = yAt(x);
      if (blocked(x, y, 0)) continue;
      v.lamps.push({ id: hash(this.s, c, 47, k), x, y, h: H * r.range(0.035, 0.045) });
    }
  }

  /** Clumps of irises along the bottom edge. */
  private foregroundPlants(v: Village, r: Rng, c: number, x0: number, x1: number, n: number, blocked: (x: number, y: number, pad: number) => boolean) {
    for (let k = 0; k < n; k++) {
      const x = r.range(x0, x1), t = r.range(0.82, 1.0), y = this.depthY(x, t);
      if (blocked(x, y, 0)) continue;
      v.trees.push({ id: hash(this.s, c, 48, k), x, y, r: H * r.range(0.025, 0.045), kind: 'iris' });
    }
  }

  /** The classic frame's village: the faithful layout plus this seed's landmark. */
  private classicVillage(c: number): Village {
    const r = this.rng(c, 4), v = emptyVillage(), fx = this.fx, lm = this.landmark;
    // Everything in the classic village is generated by the chunk holding the church.
    if (World.chunkOf(this.C.church.x * FRAME_W) !== c) return v;
    const cypresses = this.cypressesNear(c);
    const X = (f: number) => fx(f) * FRAME_W;
    const span = (a: number, b: number): [number, number] => [Math.min(X(a), X(b)), Math.max(X(a), X(b))];
    const millX = X(0.84);
    const blocked = (x: number, y: number, pad: number) =>
      cypresses.some((q) => cypressCovers(q, this.noise, x, y, pad)) || this.inRiver(x, y, pad + 4) ||
      (lm === 'mill' && Math.abs(x - millX) < H * 0.07 && y < this.villageTop(x) + H * 0.08);

    const cx = this.C.church.x * FRAME_W + r.range(-0.03, 0.03) * FRAME_W;
    v.churches.push(this.makeChurch(r, hash(this.s, c, 41), cx, this.depthY(cx, this.C.church.base), this.C.church.spireTop * H + r.range(-0.02, 0.02) * H, false));

    if (lm === 'haystacks') {
      const [a, b] = span(0.42, 0.68);
      this.addStacks(v, r, c, r.int(4, 6), () => r.range(a, b), () => r.range(0.55, 0.85), blocked);
    }
    if (lm === 'mill') v.mills.push(this.makeMill(r, hash(this.s, c, 49), millX, this.ridgeFront(millX) + H * 0.012, 1.25));
    if (lm === 'sunflowers') {
      // Sunflowers fill the foreground below the village, tallest at the bottom edge.
      const [a, b] = span(0.4, 1.0);
      for (let j = 0, n = r.int(18, 26); j < n; j++) {
        const x = r.range(a, b), t = r.range(0.62, 1.0), y = this.depthY(x, t);
        if (blocked(x, y, 0)) continue;
        v.trees.push({ id: hash(this.s, c, 55, j), x, y, r: H * r.range(0.02, 0.032) * lerp(0.75, 1.45, t), kind: 'sunflower' });
      }
    }
    if (lm === 'crows') {
      const [a, b] = span(0.42, 1.0);
      this.addStacks(v, r, c, r.int(2, 4), () => r.range(a, b), () => r.range(0.55, 0.85), blocked);
      for (let k = 0, n = r.int(6, 9); k < n; k++) {
        const x = r.range(a, b), y = H * r.range(0.3, 0.55);
        v.crows.push({ id: hash(this.s, c, 56, k), x, y, size: H * r.range(0.016, 0.024), ph: r.range(0, 6.28), speed: r.range(1.4, 2.4), loop: r.range(0.6, 1.2) });
      }
    }
    if (lm === 'cafe') {
      const x = cx + (this.flipped ? -1 : 1) * FRAME_W * r.range(0.05, 0.1);
      v.houses.push(this.makeHouse(r, hash(this.s, c, 50), x, this.depthY(x, 0.55), H * 0.042, 'cafe'));
      this.addLampsAlong(v, r, c, x - 120, x + 140, (xx) => this.depthY(xx, 0.62), blocked);
    }
    if (lm === 'river') {
      const [a, b] = span(0.4, 1.03);
      this.addLampsAlong(v, r, c, a, b, (x) => this.riverTop(x) - 2, () => false);
      for (let k = 0, n = r.int(1, 3); k < n; k++) {
        const x = r.range(a + 60, b - 60);
        v.boats.push({ id: hash(this.s, c, 51, k), x, y: this.riverBottom(x) - H * 0.008, w: H * r.range(0.05, 0.07), dir: r.chance(0.5) ? 1 : -1, hue: r.random() });
      }
    }

    const [lo, hi] = span(0.36, 1.03);
    this.placeHouses(v, r, c, r.int(46, 56), 800, () => {
      const t = Math.pow(r.random(), 0.85), x = r.range(lo, hi);
      const style: House['style'] = r.chance(0.12) ? 'tall' : r.chance(0.1) ? 'cottage' : 'block';
      return { x, y: this.depthY(x, lerp(0.1, 0.88, t)), size: H * lerp(0.016, 0.036, t), style };
    }, blocked);

    const [tlo, thi] = span(0.4, 1.02);
    this.treeLine(v, r, c, tlo, thi, false, blocked);
    for (let j = 0, n = r.int(14, 18); j < n; j++) {
      const x = r.range(tlo, thi), t = r.range(0.08, 0.95);
      if (blocked(x, this.depthY(x, t), 0)) continue;
      const kind: TreeKind = r.chance(0.14) ? 'poplar' : r.chance(0.08) ? 'pine' : r.chance(0.5) ? 'olive' : 'round';
      v.trees.push({ id: hash(this.s, c, 43, j), x, y: this.depthY(x, t), r: H * r.range(0.022, 0.05) * lerp(0.7, 1.3, t), kind });
    }
    // The dark bushes in the corner opposite the cypress.
    for (let j = 0; j < 3; j++) {
      const x = X(r.range(0.86, 1.02));
      v.trees.push({ id: hash(this.s, c, 45, j), x, y: H * r.range(0.97, 1.03), r: H * r.range(0.05, 0.075), kind: 'round' });
    }
    return v;
  }

  /** A chunk outside the classic frame, furnished according to its region. */
  private regionVillage(c: number): Village {
    const r = this.rng(c, 4), v = emptyVillage(), x0 = c * CW, x1 = x0 + CW;
    const biome = this.biomeAt(x0 + CW / 2);
    const cypresses = this.cypressesNear(c);
    const blocked = (x: number, y: number, pad: number) =>
      cypresses.some((q) => cypressCovers(q, this.noise, x, y, pad)) || this.inRiver(x, y, pad + 4);
    const anyX = () => r.range(x0, x1);
    const scatter = (n: number, kinds: [TreeKind, number][], tLo = 0.08, tHi = 0.95) => {
      for (let j = 0; j < n; j++) {
        const x = anyX(), t = r.range(tLo, tHi), y = this.depthY(x, t);
        if (blocked(x, y, 0)) continue;
        v.trees.push({ id: hash(this.s, c, 43, j), x, y, r: H * r.range(0.022, 0.05) * lerp(0.7, 1.3, t), kind: weighted(kinds, r.random()) });
      }
    };

    if (biome === 'village') {
      const town = r.chance(0.7), cx = x0 + CW * r.range(0.2, 0.8);
      if (town && r.chance(0.6)) {
        v.churches.push(this.makeChurch(r, hash(this.s, c, 41), cx, this.depthY(cx, r.range(0.2, 0.28)), this.ridgeBack(cx) - H * r.range(0.01, 0.05), r.chance(0.3)));
      }
      if (town && r.chance(0.45)) {
        const x = cx + r.range(-160, 160), y = this.depthY(x, r.range(0.45, 0.65));
        if (!blocked(x, y, 20)) {
          v.houses.push(this.makeHouse(r, hash(this.s, c, 50), x, y, H * 0.04, 'cafe'));
          this.addLampsAlong(v, r, c, x - 120, x + 140, (xx) => this.depthY(xx, 0.68), blocked);
        }
      }
      this.placeHouses(v, r, c, town ? r.int(26, 44) : r.int(3, 7), 700, () => {
        const t = Math.pow(r.random(), 0.85), x = town ? cx + FRAME_W * 0.22 * r.bell() : anyX();
        const style: House['style'] = r.chance(0.15) ? 'tall' : r.chance(0.15) ? 'cottage' : 'block';
        return { x, y: this.depthY(x, lerp(0.1, 0.88, t)), size: H * lerp(0.016, 0.036, t), style };
      }, blocked);
      this.treeLine(v, r, c, x0, x1, true, blocked);
      scatter(r.int(3, 8), [['round', 0.4], ['olive', 0.3], ['poplar', 0.15], ['pine', 0.15]]);
    } else if (biome === 'wheat') {
      this.addStacks(v, r, c, r.int(3, 7), anyX, () => r.range(0.2, 0.85), blocked);
      this.placeHouses(v, r, c, r.int(0, 2), 60, () => {
        const x = anyX(), t = r.range(0.1, 0.4);
        return { x, y: this.depthY(x, t), size: H * lerp(0.022, 0.034, t), style: 'cottage' };
      }, blocked);
      scatter(r.int(1, 4), [['poplar', 0.5], ['round', 0.3], ['pine', 0.2]], 0.05, 0.6);
      this.foregroundPlants(v, r, c, x0, x1, r.int(0, 2), blocked);
    } else if (biome === 'river') {
      // A town strung along the far bank, its gaslights doubled in the water.
      this.placeHouses(v, r, c, r.int(14, 24), 300, () => {
        const x = anyX();
        if (this.riverWeight(x) < 0.4) return null;
        return { x, y: this.riverTop(x) - H * r.range(0.004, 0.03), size: H * r.range(0.016, 0.026), style: r.chance(0.3) ? 'tall' : 'block' };
      }, () => false);
      this.addLampsAlong(v, r, c, x0, x1, (x) => this.riverTop(x) - 2, (x) => this.riverWeight(x) < 0.5);
      for (let k = 0, n = r.int(1, 3); k < n; k++) {
        const x = anyX();
        if (this.riverWeight(x) < 0.6) continue;
        v.boats.push({ id: hash(this.s, c, 51, k), x, y: this.riverBottom(x) - H * 0.008, w: H * r.range(0.05, 0.075), dir: r.chance(0.5) ? 1 : -1, hue: r.random() });
      }
      this.treeLine(v, r, c, x0, x1, true, blocked);
      scatter(r.int(1, 3), [['round', 0.5], ['poplar', 0.5]], 0.75, 0.95);
      this.foregroundPlants(v, r, c, x0, x1, r.int(1, 4), blocked);
    } else if (biome === 'orchard') {
      // Olive trees planted in rows that recede toward the hills.
      for (const t of [0.14, 0.36, 0.62, 0.9]) {
        const step = lerp(70, 150, t), off = r.range(0, step);
        for (let x = x0 + off, k = 0; x < x1; x += step * r.range(0.85, 1.15), k++) {
          const y = this.depthY(x, t + r.range(-0.02, 0.02));
          if (blocked(x, y, 0)) continue;
          v.trees.push({ id: hash(this.s, c, 52, Math.round(t * 100), k), x, y, r: H * lerp(0.016, 0.042, t), kind: 'olive' });
        }
      }
      this.placeHouses(v, r, c, r.int(0, 1), 40, () => {
        const x = anyX(), t = r.range(0.05, 0.2);
        return { x, y: this.depthY(x, t), size: H * 0.024, style: 'cottage' };
      }, blocked);
    } else if (biome === 'sunflower') {
      // A field of sunflowers, tall in the foreground and small toward the hills, with a farmhouse or two.
      for (let j = 0, n = r.int(38, 56); j < n; j++) {
        const x = anyX(), t = Math.pow(r.random(), 0.8) * 0.9 + 0.08, y = this.depthY(x, t);
        if (blocked(x, y, 0)) continue;
        v.trees.push({ id: hash(this.s, c, 53, j), x, y, r: H * r.range(0.02, 0.034) * lerp(0.55, 1.45, t), kind: 'sunflower' });
      }
      this.placeHouses(v, r, c, r.int(0, 2), 80, () => {
        const x = anyX(), t = r.range(0.08, 0.25);
        return { x, y: this.depthY(x, t), size: H * lerp(0.022, 0.032, t), style: 'cottage' };
      }, blocked);
      this.addStacks(v, r, c, r.int(0, 2), anyX, () => r.range(0.25, 0.5), blocked);
      scatter(r.int(1, 3), [['poplar', 0.5], ['round', 0.3], ['pine', 0.2]], 0.05, 0.4);
    } else if (biome === 'crows') {
      // Wheat under a storm, with a lone cypress or poplar and a flock circling overhead.
      this.addStacks(v, r, c, r.int(0, 2), anyX, () => r.range(0.3, 0.8), blocked);
      scatter(r.int(0, 2), [['poplar', 0.7], ['pine', 0.3]], 0.05, 0.5);
      this.foregroundPlants(v, r, c, x0, x1, r.int(0, 2), blocked);
      for (let k = 0, n = r.int(5, 11); k < n; k++) {
        const x = anyX(), y = H * r.range(0.12, 0.5);
        v.crows.push({ id: hash(this.s, c, 54, k), x, y, size: H * r.range(0.016, 0.026), ph: r.range(0, 6.28), speed: r.range(1.4, 2.4), loop: r.range(0.6, 1.4) });
      }
    } else {
      // Windmill hills: one or two mills on the ridge, a hamlet and a few haystacks.
      for (let k = 0, n = r.int(1, 2); k < n; k++) {
        const x = x0 + CW * (n === 1 ? r.range(0.3, 0.7) : r.range(0.15, 0.4) + k * 0.45);
        v.mills.push(this.makeMill(r, hash(this.s, c, 49, k), x, this.ridgeFront(x) + H * 0.012, r.range(0.85, 1.15)));
      }
      this.placeHouses(v, r, c, r.int(2, 6), 120, () => {
        const x = anyX(), t = r.range(0.1, 0.6);
        return { x, y: this.depthY(x, t), size: H * lerp(0.018, 0.032, t), style: r.chance(0.6) ? 'cottage' : 'block' };
      }, blocked);
      this.addStacks(v, r, c, r.int(0, 3), anyX, () => r.range(0.5, 0.85), blocked);
      this.treeLine(v, r, c, x0, x1, true, (x, y, p) => blocked(x, y, p) || v.mills.some((m) => Math.abs(m.x - x) < m.w * 1.5));
      scatter(r.int(1, 4), [['pine', 0.4], ['round', 0.3], ['poplar', 0.3]]);
    }
    return v;
  }

  /** Every feature that can affect chunk c (from chunks c - REACH .. c + REACH). */
  near(c: number): Nearby {
    let n = this.nearCache.get(c);
    if (n) return n;
    n = { vortices: [], glows: [], cypresses: [], ...emptyVillage() };
    for (let i = c - REACH; i <= c + REACH; i++) {
      const m = this.major(i), vil = this.village(i);
      n.vortices.push(...m.vortices, ...this.minor(i));
      n.glows.push(...this.stars(i));
      if (m.moon) n.glows.push(m.moon);
      if (m.cypress) n.cypresses.push(m.cypress);
      n.houses.push(...vil.houses);
      n.churches.push(...vil.churches);
      n.trees.push(...vil.trees);
      n.mills.push(...vil.mills);
      n.stacks.push(...vil.stacks);
      n.lamps.push(...vil.lamps);
      n.boats.push(...vil.boats);
      n.crows.push(...vil.crows);
    }
    this.nearCache.set(c, n);
    return n;
  }

  /** Drop cached chunk data far from the given chunk, so wandering forever stays bounded. */
  prune(c: number, keep = 24) {
    for (const cache of [this.majorCache, this.minorCache, this.starCache, this.villageCache, this.nearCache] as Map<number, unknown>[]) {
      for (const k of cache.keys()) if (Math.abs(k - c) > keep) cache.delete(k);
    }
  }
}

// ------------------------------------------------------------------ cypress geometry

function prof(t: number) {
  return Math.pow(Math.max(0, 1 - t), 0.8) * (0.85 + 0.15 * Math.min(1, t * 5));
}

// Skewed-sine lobes: each edge swells slowly then pulls in quickly, like upward-leaning flame tongues.
function lobe(t: number, freq: number, ph: number) {
  const a = 6.2832 * (t * freq + ph);
  return 0.5 + 0.5 * Math.sin(a + 0.8 * Math.sin(a));
}

export const tongueGeom = {
  t: (g: Tongue, y: number) => (g.base - y) / (g.base - g.top),
  /** The axis sways a little and curls toward `lean` near the tip, like a flame. */
  center: (g: Tongue, t: number) => g.x + g.w * (0.1 * Math.sin(t * 4 + g.ph) + g.lean * 1.1 * Math.pow(t, 2)),
  halfL: (g: Tongue, n: Noise, t: number) =>
    g.w * 0.5 * prof(t) * (0.74 + 0.45 * lobe(t, g.lobes / 6.28, g.ph) + 0.2 * n.noise2(t * 7, g.o)),
  halfR: (g: Tongue, n: Noise, t: number) =>
    g.w * 0.5 * prof(t) * (0.74 + 0.45 * lobe(t, (g.lobes * 0.85) / 6.28, g.ph + 0.4) + 0.2 * n.noise2(t * 7, g.o + 9)),
};

export function tongueInside(g: Tongue, n: Noise, x: number, y: number, pad = 0): boolean {
  const t = tongueGeom.t(g, y);
  if (t < -0.02 || t > 1) return false;
  const tc = clamp(t, 0, 1), cx = tongueGeom.center(g, tc);
  return x > cx - tongueGeom.halfL(g, n, tc) - pad && x < cx + tongueGeom.halfR(g, n, tc) + pad;
}

export function cypressInside(c: Cypress, n: Noise, x: number, y: number): boolean {
  return c.tongues.some((g) => tongueInside(g, n, x, y));
}

export function cypressCovers(c: Cypress, n: Noise, x: number, y: number, pad: number): boolean {
  return c.tongues.some((g) => tongueInside(g, n, x, y, pad));
}

/** Horizontal extent of a cypress, for culling. */
export function cypressSpan(c: Cypress): [number, number] {
  let a = Infinity, b = -Infinity;
  for (const g of c.tongues) {
    a = Math.min(a, g.x - g.w * (0.7 + Math.abs(g.lean) * 1.2));
    b = Math.max(b, g.x + g.w * (0.7 + Math.abs(g.lean) * 1.2));
  }
  return [a, b];
}
