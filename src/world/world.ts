// The infinite world. Space is split into vertical chunks; each chunk deterministically
// generates its own features from the seed and chunk index. Anything that needs to know
// about nearby features (flow fields, overlap checks) looks at neighbouring chunks, so a
// point always sees the same features no matter which chunk is being painted.
//
// The first painting frame, x in [0, FRAME_W), follows the composition of the 1889 original
// (see CLASSIC below) with small seeded variations. Terrain blends smoothly from that layout
// into fully procedural hills on either side.

import { Noise } from '../core/noise';
import { hash, hashFloat, hashString, Rng } from '../core/rng';
import { clamp, dist, lerp, smoothstep } from '../core/math';

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

export interface Vortex { x: number; y: number; R: number; dir: number; }

export interface Glow {
  id: number; kind: GlowKind;
  x: number; y: number; core: number; halo: number; ringW: number; dir: number;
  /** Crescent cutout: the lit part of the moon is the disk outside this offset circle. */
  cut?: { dx: number; dy: number; r: number };
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
}

export interface Church {
  id: number; x: number; base: number; bodyW: number; bodyH: number;
  towerW: number; towerH: number; spireTop: number; warm: boolean;
}

export type TreeKind = 'round' | 'poplar' | 'olive';
export interface Tree { id: number; x: number; y: number; r: number; kind: TreeKind; }

interface SkyMajor { moon?: Glow; vortices: Vortex[]; cypress?: Cypress; }
interface Village { houses: House[]; churches: Church[]; trees: Tree[]; }

export interface Nearby {
  vortices: Vortex[]; glows: Glow[]; cypresses: Cypress[];
  houses: House[]; churches: Church[]; trees: Tree[];
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
    this.classic = {
      band: new Sampled(CLASSIC.band, j(1, 0.02)),
      back: new Sampled(CLASSIC.ridgeBack, j(2, 0.012)),
      front: new Sampled(CLASSIC.ridgeFront, j(3, 0.01)),
      village: new Sampled(CLASSIC.villageTop, j(4, 0.008)),
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

    if (c === 1) {
      const cm = CLASSIC.moon, core = H * cm.core * r.range(0.92, 1.08);
      m.moon = this.makeMoon(c, cm.x * FRAME_W + jx(), cm.y * H + jy(), core, r);
    } else if (c !== 0 && c !== 2 && this.sparse(c, 11, 0.3)) {
      m.moon = this.makeMoon(c, x0 + CW * r.range(0.2, 0.8), H * r.range(0.1, 0.17), H * r.range(0.045, 0.06), r);
    }

    if (c === 0) {
      for (const sw of CLASSIC.swirls) m.vortices.push({ x: sw.x * FRAME_W + jx(), y: sw.y * H + jy(), R: sw.R * H * r.range(0.93, 1.07), dir: sw.dir });
    } else if (c !== 1 && c !== -1 && this.sparse(c, 13, 0.5)) {
      const cx = x0 + CW * r.range(0.3, 0.7), cy = H * r.range(0.26, 0.36), R = H * r.range(0.13, 0.17);
      const dir = r.chance(0.5) ? 1 : -1, side = r.chance(0.5) ? 1 : -1;
      // A big spiral with a smaller counter-rotating one tucked below and to the side.
      m.vortices.push({ x: cx, y: cy, R, dir });
      m.vortices.push({ x: cx + side * R * 0.95, y: cy + R * 0.8, R: R * r.range(0.5, 0.65), dir: -dir });
    }

    if (c === 0) {
      m.cypress = {
        id: hash(this.s, c, 15), x: 0.25 * FRAME_W,
        tongues: CLASSIC.cypress.map(([x, top, w, lean], i) => this.makeTongue(r, x * FRAME_W + jx() * 0.5, top * H + jy(), w * FRAME_W * r.range(0.95, 1.05), lean, i)),
      };
    } else if (c !== 1 && c !== -1 && this.sparse(c, 14, 0.34)) {
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

  private makeMoon(c: number, x: number, y: number, core: number, r: Rng): Glow {
    return {
      id: hash(this.s, c, 12), kind: 'moon', x, y, core,
      halo: core * r.range(2.0, 2.2), ringW: core * 0.3, dir: r.chance(0.5) ? 1 : -1,
      // A thick lit crescent on the lower right, like the original's waning moon.
      cut: { dx: -core * r.range(0.4, 0.46), dy: -core * r.range(0.26, 0.32), r: core * 0.72 },
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
    return CLASSIC.stars
      .map(([x, y, size], i) => ({ x: x * FRAME_W, y: y * H, size, i }))
      .filter((st) => World.chunkOf(st.x) === c)
      .map(({ x, y, size, i }) => {
        const core = H * 0.0115 * size * r.range(0.9, 1.1);
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
    const r = this.rng(c, 4);
    const x0 = c * CW;
    const cypresses = this.majorsNear(c).map((m) => m.cypress).filter((q): q is Cypress => !!q);
    const blocked = (x: number, y: number, pad: number) => cypresses.some((q) => cypressCovers(q, this.noise, x, y, pad));
    v = { houses: [], churches: [], trees: [] };
    const classic = c === 1;

    // Towns cluster around a center; some have a church whose spire rises above the hills.
    const town = classic ? true : c === 0 ? false : r.chance(0.6);
    const cx = classic ? CLASSIC.church.x * FRAME_W + r.range(-0.02, 0.02) * FRAME_W : x0 + CW * r.range(0.2, 0.8);
    if (town && (classic || r.chance(0.55))) {
      v.churches.push({
        id: hash(this.s, c, 41), x: cx, base: this.depthY(cx, classic ? CLASSIC.church.base : r.range(0.2, 0.28)),
        bodyW: H * r.range(0.065, 0.075), bodyH: H * r.range(0.036, 0.044),
        towerW: H * 0.022, towerH: H * r.range(0.025, 0.035),
        spireTop: classic ? CLASSIC.church.spireTop * H : this.ridgeBack(cx) - H * r.range(0.01, 0.04), warm: !classic && r.chance(0.3),
      });
    }

    const n = classic ? r.int(48, 58) : town ? r.int(26, 44) : r.int(2, 6);
    for (let tries = 0; v.houses.length < n && tries < 700; tries++) {
      const x = classic ? FRAME_W * r.range(0.36, 1.03) : town ? cx + FRAME_W * 0.24 * r.bell() : x0 + CW * r.random();
      const t = Math.pow(r.random(), 0.85);
      const y = this.depthY(x, lerp(0.1, 0.88, t)), size = H * lerp(0.016, 0.036, t);
      if (blocked(x, y, size * 0.6)) continue;
      if (v.churches.some((ch) => Math.abs(x - ch.x) < ch.bodyW && Math.abs(y - ch.base) < size * 1.6)) continue;
      if (v.houses.some((h) => Math.abs(h.x - x) < (h.size + size) * 0.75 && Math.abs(h.y - y) < (h.size + size) * 0.3)) continue;
      const w = size * r.range(0.9, 1.6), u = r.random();
      v.houses.push({
        id: hash(this.s, c, 42, tries), x, y, size, w, h: size * r.range(0.6, 0.9),
        depth: w * r.range(0.25, 0.45), side: r.chance(0.5) ? 1 : -1,
        roofH: size * r.range(0.45, 0.75), peak: r.range(-0.2, 0.2), flatRoof: r.chance(0.08),
        wall: r.chance(0.12) ? 'warm' : 'light', roof: u < 0.62 ? 'blue' : u < 0.82 ? 'rust' : 'green',
        windows: r.int(0, 2), chimney: r.chance(0.3),
      });
    }

    // A line of rounded olive trees along the foot of the hills, gappy where the noise says so.
    const lineFrom = classic ? 0.4 * FRAME_W : x0, lineTo = classic ? FRAME_W * 1.02 : x0 + CW;
    if (classic || c !== 0) {
      for (let x = lineFrom, k = 0; x < lineTo; x += r.range(26, 48), k++) {
        if (!classic && this.noise.noise2(x * 0.004 + 40, 2.2) < -0.1) continue;
        const y = this.villageTop(x) + H * r.range(0.0, 0.03);
        if (blocked(x, y, 0)) continue;
        v.trees.push({ id: hash(this.s, c, 44, k), x, y, r: H * r.range(0.018, 0.032), kind: 'olive' });
      }
    }

    // Bushes and trees scattered through the village and the foreground.
    const nt = classic ? r.int(14, 18) : r.int(3, town ? 10 : 5);
    for (let j = 0; j < nt; j++) {
      const x = classic ? FRAME_W * r.range(0.4, 1.02) : town && r.chance(0.6) ? cx + FRAME_W * 0.3 * r.bell() : x0 + CW * r.random();
      const t = r.range(0.08, 0.95);
      if (blocked(x, this.depthY(x, t), 0)) continue;
      const kind: TreeKind = r.chance(0.15) ? 'poplar' : r.chance(0.5) ? 'olive' : 'round';
      v.trees.push({ id: hash(this.s, c, 43, j), x, y: this.depthY(x, t), r: H * r.range(0.022, 0.05) * lerp(0.7, 1.3, t), kind });
    }
    if (classic) {
      // The dark bushes in the bottom right corner.
      for (let j = 0; j < 3; j++) {
        const x = FRAME_W * r.range(0.86, 1.02);
        v.trees.push({ id: hash(this.s, c, 45, j), x, y: H * r.range(0.97, 1.03), r: H * r.range(0.05, 0.075), kind: 'round' });
      }
    }

    this.villageCache.set(c, v);
    return v;
  }

  /** Every feature that can affect chunk c (from chunks c - REACH .. c + REACH). */
  near(c: number): Nearby {
    let n = this.nearCache.get(c);
    if (n) return n;
    n = { vortices: [], glows: [], cypresses: [], houses: [], churches: [], trees: [] };
    for (let i = c - REACH; i <= c + REACH; i++) {
      const m = this.major(i), vil = this.village(i);
      n.vortices.push(...m.vortices, ...this.minor(i));
      n.glows.push(...this.stars(i));
      if (m.moon) n.glows.push(m.moon);
      if (m.cypress) n.cypresses.push(m.cypress);
      n.houses.push(...vil.houses);
      n.churches.push(...vil.churches);
      n.trees.push(...vil.trees);
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
