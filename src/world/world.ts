// The infinite world. Space is split into vertical chunks; each chunk deterministically
// generates its own features from the seed and chunk index. Anything that needs to know
// about nearby features (flow fields, overlap checks) looks at neighbouring chunks, so a
// point always sees the same features no matter which chunk is being painted.
//
// The first painting frame, x in [0, FRAME_W), is pinned to the classic composition:
// cypress on the left, the great swirl in the middle, the moon top right, the church below.

import { Noise } from '../core/noise';
import { hash, hashFloat, hashString, Rng } from '../core/rng';
import { clamp, dist, lerp } from '../core/math';

export const H = 1200;
export const CW = 750;
export const FRAME_W = 1500;
/** How many chunks either side can influence a point. */
const REACH = 2;

export type GlowKind = 'star' | 'moon';

export interface Vortex { x: number; y: number; R: number; dir: number; }

export interface Glow {
  id: number; kind: GlowKind;
  x: number; y: number; core: number; halo: number; ringW: number; dir: number;
  /** Crescent cutout: the lit part of the moon is the disk outside this offset circle. */
  cut?: { dx: number; dy: number; r: number };
}

export interface Cypress {
  id: number; x: number; top: number; base: number; w: number;
  ph: number; lean: number; o: number; lobes: number;
}

export interface House {
  id: number; x: number; y: number; size: number;
  w: number; h: number; depth: number; side: 1 | -1;
  roofH: number; peak: number; flatRoof: boolean;
  warm: boolean; warmRoof: boolean; windows: number; chimney: boolean;
}

export interface Church {
  id: number; x: number; base: number; bodyW: number; bodyH: number;
  towerW: number; towerH: number; spireTop: number; warm: boolean;
}

export interface Tree { id: number; x: number; y: number; r: number; tall: number; }

interface SkyMajor { moon?: Glow; vortices: Vortex[]; cypress?: Cypress; }
interface Village { houses: House[]; churches: Church[]; trees: Tree[]; }

export interface Nearby {
  vortices: Vortex[]; glows: Glow[]; cypresses: Cypress[];
  houses: House[]; churches: Church[]; trees: Tree[];
}

export class World {
  readonly seed: string;
  readonly s: number;
  readonly noise: Noise;
  readonly horizon: number;
  private readonly landO: number[];
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
    this.landO = [r.range(0, 100), r.range(0, 100), r.range(0, 100), r.range(0, 100)];
  }

  rng(...k: number[]): Rng {
    return new Rng(hash(this.s, ...k));
  }

  static chunkOf(x: number): number {
    return Math.floor(x / CW);
  }

  // ---------------------------------------------------------------- land

  ridgeBack = (x: number): number => {
    const [o1, o4] = [this.landO[0], this.landO[3]];
    return this.horizon + H * 0.05 * this.noise.noise2(x * 0.0004 + o4, o4) + H * 0.065 * this.noise.fbm(x * 0.0018 + o1, o1, 3);
  };

  ridgeFront = (x: number): number => {
    const o2 = this.landO[1];
    return this.ridgeBack(x) + H * 0.06 + H * 0.03 * this.noise.fbm(x * 0.0025 + o2, o2, 2);
  };

  villageTop = (x: number): number => {
    const o3 = this.landO[2];
    return this.ridgeFront(x) + H * 0.05 + H * 0.012 * this.noise.noise2(x * 0.004 + o3, o3);
  };

  /** y of a point a fraction t of the way from the village top to the bottom edge. */
  depthY(x: number, t: number): number {
    const top = this.villageTop(x);
    return top + (H - top) * t;
  }

  // The faint "milky way" ribbon the base sky flow follows.
  bandY = (x: number): number => H * 0.3 + H * 0.06 * this.noise.fbm(x * 0.0009 + 3.3, 7.7, 2);
  bandWidth = H * 0.075;

  // ---------------------------------------------------------------- per-chunk generation

  /** A feature that appears in at most every other chunk, with probability p. */
  private sparse(c: number, kind: number, p: number): boolean {
    return hashFloat(this.s, c, kind) < p && !(hashFloat(this.s, c - 1, kind) < p);
  }

  private major(c: number): SkyMajor {
    let m = this.majorCache.get(c);
    if (m) return m;
    const r = this.rng(c, 1);
    const x0 = c * CW;
    m = { vortices: [] };

    const hasMoon = c === 1 ? true : c === 0 || c === 2 ? false : this.sparse(c, 11, 0.3);
    if (hasMoon) {
      const core = H * r.range(0.034, 0.044);
      m.moon = {
        id: hash(this.s, c, 12), kind: 'moon',
        x: c === 1 ? FRAME_W * r.range(0.8, 0.9) : x0 + CW * r.range(0.2, 0.8),
        y: H * r.range(0.1, 0.17),
        core, halo: core * r.range(2.2, 2.6), ringW: core * 0.3, dir: r.chance(0.5) ? 1 : -1,
        cut: { dx: core * r.range(0.35, 0.5) * (r.chance(0.7) ? 1 : -1), dy: -core * r.range(0.15, 0.35), r: core * 0.86 },
      };
    }

    const hasSwirl = c === 0 ? true : c === 1 || c === -1 ? false : this.sparse(c, 13, 0.5);
    if (hasSwirl) {
      const cx = c === 0 ? FRAME_W * r.range(0.38, 0.5) : x0 + CW * r.range(0.3, 0.7);
      const cy = H * r.range(0.26, 0.34), R = H * r.range(0.12, 0.145);
      const flip = r.chance(0.3) ? -1 : 1;
      // Two counter-rotating vortices side by side make the S-shaped great swirl.
      m.vortices.push({ x: cx - R * 0.95, y: cy + R * 0.08, R, dir: flip });
      m.vortices.push({ x: cx + R * 0.95, y: cy - R * 0.1, R: R * 0.85, dir: -flip });
    }

    const hasCypress = c === 0 ? true : c === 1 || c === -1 ? false : this.sparse(c, 14, 0.34);
    if (hasCypress) {
      const tall = c === 0 || r.chance(0.6);
      m.cypress = {
        id: hash(this.s, c, 15),
        x: c === 0 ? FRAME_W * r.range(0.1, 0.2) : x0 + CW * r.range(0.15, 0.85),
        top: tall ? H * r.range(0.03, 0.1) : H * r.range(0.2, 0.4),
        base: H * 1.02, w: FRAME_W * (tall ? r.range(0.11, 0.15) : r.range(0.08, 0.11)),
        ph: r.range(0, 6.28), lean: r.range(-0.3, 0.3), o: r.range(0, 100), lobes: r.range(22, 34),
      };
    }
    this.majorCache.set(c, m);
    return m;
  }

  private majorsNear(c: number): SkyMajor[] {
    const out: SkyMajor[] = [];
    for (let i = c - REACH; i <= c + REACH; i++) out.push(this.major(i));
    return out;
  }

  private minor(c: number): Vortex[] {
    let v = this.minorCache.get(c);
    if (v) return v;
    const r = this.rng(c, 2);
    const majors = this.majorsNear(c);
    v = [];
    const n = r.int(0, 2);
    for (let tries = 0; v.length < n && tries < 60; tries++) {
      const cand = { x: c * CW + CW * r.range(0.1, 0.9), y: H * r.range(0.08, 0.45), R: H * r.range(0.05, 0.075), dir: r.chance(0.5) ? 1 : -1 };
      const clear = majors.every((m) =>
        (!m.moon || dist(cand.x, cand.y, m.moon.x, m.moon.y) > m.moon.halo + cand.R * 1.6) &&
        m.vortices.every((o) => dist(cand.x, cand.y, o.x, o.y) > o.R * 0.9 + cand.R * 1.6)) &&
        v.every((o) => dist(cand.x, cand.y, o.x, o.y) > (o.R + cand.R) * 1.6);
      if (clear) v.push(cand);
    }
    this.minorCache.set(c, v);
    return v;
  }

  private stars(c: number): Glow[] {
    let s = this.starCache.get(c);
    if (s) return s;
    const majors = this.majorsNear(c);
    const minors: Vortex[] = [];
    for (let i = c - REACH; i <= c + REACH; i++) minors.push(...this.minor(i));
    s = [];
    // One candidate per cell of a 3x3 grid; cell margins keep halos from touching across cells.
    const cols = 3, rows = 3, cellW = CW / cols, yTop = H * 0.04, cellH = (H * 0.5 - yTop) / rows;
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        const r = this.rng(c, 3, cx, cy);
        if (!r.chance(0.42)) continue;
        const core = H * r.range(0.008, 0.015), halo = core * r.range(2.6, 3.6), m = halo + 6;
        const x = c * CW + cx * cellW + r.range(m, cellW - m);
        const y = yTop + cy * cellH + r.range(Math.min(m, cellH / 2), Math.max(cellH - m, cellH / 2));
        const clear = majors.every((mj) =>
          (!mj.moon || dist(x, y, mj.moon.x, mj.moon.y) > mj.moon.halo + halo * 1.2) &&
          mj.vortices.every((o) => dist(x, y, o.x, o.y) > o.R * 0.9 + halo * 1.2) &&
          (!mj.cypress || !cypressCovers(mj.cypress, this.noise, x, y, halo * 0.6))) &&
          minors.every((o) => dist(x, y, o.x, o.y) > o.R * 0.9 + halo * 1.2);
        if (!clear) continue;
        s.push({
          id: hash(this.s, c, 3, cx, cy), kind: 'star', x, y, core, halo,
          ringW: Math.max(4, core * 0.38), dir: r.chance(0.5) ? 1 : -1,
        });
      }
    }
    this.starCache.set(c, s);
    return s;
  }

  private village(c: number): Village {
    let v = this.villageCache.get(c);
    if (v) return v;
    const r = this.rng(c, 4);
    const x0 = c * CW;
    const cypresses = this.majorsNear(c).map((m) => m.cypress).filter((q): q is Cypress => !!q);
    v = { houses: [], churches: [], trees: [] };

    // Towns cluster around a center; some have a church whose spire rises above the hills.
    const town = c === 1 ? true : c === 0 ? false : r.chance(0.6);
    const cx = c === 1 ? FRAME_W * r.range(0.45, 0.62) : x0 + CW * r.range(0.2, 0.8);
    if (town && (c === 1 || r.chance(0.55))) {
      v.churches.push({
        id: hash(this.s, c, 41), x: cx, base: this.depthY(cx, r.range(0.22, 0.3)),
        bodyW: H * r.range(0.06, 0.075), bodyH: H * r.range(0.03, 0.04),
        towerW: H * 0.024, towerH: H * r.range(0.025, 0.035),
        spireTop: this.ridgeBack(cx) - H * r.range(0.01, 0.04), warm: r.chance(0.3),
      });
    }

    const n = town ? r.int(26, 44) : r.int(2, 6);
    for (let tries = 0; v.houses.length < n && tries < 500; tries++) {
      const x = town ? cx + FRAME_W * 0.24 * r.bell() : x0 + CW * r.random();
      const t = Math.pow(r.random(), 0.8);
      const y = this.depthY(x, lerp(0.12, 0.85, t)), size = H * lerp(0.016, 0.036, t);
      if (cypresses.some((q) => cypressCovers(q, this.noise, x, H * 0.95, size * 0.5))) continue;
      if (v.churches.some((ch) => Math.abs(x - ch.x) < ch.bodyW && Math.abs(y - ch.base) < size * 1.6)) continue;
      if (v.houses.some((h) => Math.abs(h.x - x) < (h.size + size) * 0.8 && Math.abs(h.y - y) < (h.size + size) * 0.35)) continue;
      const w = size * r.range(0.9, 1.6);
      v.houses.push({
        id: hash(this.s, c, 42, tries), x, y, size, w, h: size * r.range(0.6, 0.9),
        depth: w * r.range(0.25, 0.45), side: r.chance(0.5) ? 1 : -1,
        roofH: size * r.range(0.45, 0.75), peak: r.range(-0.2, 0.2), flatRoof: r.chance(0.08),
        warm: r.chance(0.2), warmRoof: r.chance(0.35), windows: r.int(0, 2), chimney: r.chance(0.3),
      });
    }

    const nt = r.int(1, town ? 5 : 3);
    for (let j = 0; j < nt; j++) {
      const x = town && r.chance(0.6) ? cx + FRAME_W * 0.35 * r.bell() : x0 + CW * r.random();
      const t = r.range(0.05, 0.9);
      const tall = r.chance(0.25) ? r.range(1.6, 2.4) : 1; // occasional poplar
      v.trees.push({ id: hash(this.s, c, 43, j), x, y: this.depthY(x, t), r: H * r.range(0.022, 0.06) * lerp(0.7, 1.2, t), tall });
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
  return Math.pow(Math.max(0, 1 - t), 0.75) * (0.8 + 0.2 * Math.min(1, t * 5));
}

// Skewed-sine lobes: each edge swells slowly then pulls in quickly, like upward-leaning flame tongues.
function tongue(t: number, freq: number, ph: number) {
  const a = 6.2832 * (t * freq + ph);
  return 0.5 + 0.5 * Math.sin(a + 0.8 * Math.sin(a));
}

export const cypressGeom = {
  t: (c: Cypress, y: number) => (c.base - y) / (c.base - c.top),
  center: (c: Cypress, t: number) => c.x + c.w * (0.12 * Math.sin(t * 4 + c.ph) + c.lean * 0.3 * t),
  halfL: (c: Cypress, n: Noise, t: number) =>
    c.w * 0.5 * prof(t) * (0.72 + 0.5 * tongue(t, c.lobes / 6.28, c.ph) + 0.2 * n.noise2(t * 7, c.o)),
  halfR: (c: Cypress, n: Noise, t: number) =>
    c.w * 0.5 * prof(t) * (0.72 + 0.5 * tongue(t, (c.lobes * 0.85) / 6.28, c.ph + 0.4) + 0.2 * n.noise2(t * 7, c.o + 9)),
};

export function cypressInside(c: Cypress, n: Noise, x: number, y: number): boolean {
  const t = cypressGeom.t(c, y);
  if (t < 0 || t > 1) return false;
  const cx = cypressGeom.center(c, t);
  return x > cx - cypressGeom.halfL(c, n, t) && x < cx + cypressGeom.halfR(c, n, t);
}

export function cypressCovers(c: Cypress, n: Noise, x: number, y: number, pad: number): boolean {
  const t = cypressGeom.t(c, y);
  if (t < -0.02 || t > 1) return false;
  const tc = clamp(t, 0, 1), cx = cypressGeom.center(c, tc);
  return x > cx - cypressGeom.halfL(c, n, tc) - pad && x < cx + cypressGeom.halfR(c, n, tc) + pad;
}
