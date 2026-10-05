// The cypress: a dark cluster of flame tongues licking up into the sky from the foreground.
import { fillPoly, trace, type Field, type Pt } from '../core/brush';
import { jitter, palette } from '../core/color';
import { clamp } from '../core/math';
import { hash, Rng } from '../core/rng';
import { cypressSpan, tongueGeom as G, tongueInside, type Cypress, type Tongue } from '../world/world';
import type { Noise } from '../core/noise';
import { inPad, L, strokeItem, type ChunkPlan } from './plan';

const P = palette({
  dark: ['#0f1a14', '#14211a', '#0b140f', '#18261b'],
  mid: ['#18291d', '#1d3021', '#233522', '#1a2824'],
  brown: ['#3a3220', '#4a3c22', '#5a4628', '#3f3524'],
  hi: ['#56663a', '#677044', '#4a6239', '#7a7a48', '#3b5866'],
  edge: ['#070d0a', '#0b120e', '#101a14'],
});

/** The tongue a point belongs to: the narrowest one containing it, so side flames win over the trunk. */
function owner(c: Cypress, n: Noise, x: number, y: number): Tongue | null {
  let best: Tongue | null = null;
  for (const g of c.tongues) if (tongueInside(g, n, x, y) && (!best || g.w < best.w)) best = g;
  return best;
}

function outline(g: Tongue, n: Noise): [Pt[], Pt[]] {
  const left: Pt[] = [], right: Pt[] = [], steps = 90;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, y = g.base - t * (g.base - g.top), cx = G.center(g, t);
    left.push([cx - G.halfL(g, n, t), y]);
    right.push([cx + G.halfR(g, n, t), y]);
  }
  return [left, right];
}

export function planCypresses(p: ChunkPlan) {
  for (const c of p.near.cypresses) {
    const [a, b] = cypressSpan(c);
    if (b >= p.x0 - p.pad && a <= p.x1 + p.pad) planCypress(p, c, a, b);
  }
}

function planCypress(p: ChunkPlan, c: Cypress, spanA: number, spanB: number) {
  const n = p.world.noise;
  // Cypresses never overlap each other, so ordering them by x keeps each one's strokes together.
  const base = c.x * 4;
  const outlines = c.tongues.map((g) => outline(g, n));
  p.items.push({
    layer: L.CYPRESS_BASE, key: base, op: (ctx) => {
      for (const [l, r] of outlines) fillPoly(ctx, l.concat(r.slice().reverse()), P.dark[0]);
    },
  });

  const field: Field = (x, y) => {
    const g = owner(c, n, x, y) ?? c.tongues[0];
    const t = clamp(G.t(g, y), 0, 1), cx = G.center(g, t);
    const half = (x < cx ? G.halfL(g, n, t) : G.halfR(g, n, t)) || 1;
    const u = clamp((x - cx) / half, -1, 1);
    const dc = (G.center(g, t + 0.01) - G.center(g, t)) / (0.01 * (g.base - g.top));
    // Strokes run up the flame, ripple, and splay toward the edges.
    const a = Math.atan(dc) + 0.45 * Math.sin(t * 15 + u * 2 + g.ph) + 0.4 * u;
    return [Math.sin(a), -Math.cos(a)];
  };

  const sp = 6.5;
  const top = Math.min(...c.tongues.map((g) => g.top));
  for (let i = Math.floor(spanA / sp); i <= spanB / sp; i++) {
    for (let j = Math.floor(top / sp) - 1; j * sp < c.tongues[0].base + sp; j++) {
      const seed = hash(c.id, i, j), r = new Rng(seed);
      const px = (i + r.range(-0.5, 0.5)) * sp, py = (j + r.range(-0.5, 0.5)) * sp;
      if (!inPad(p, px) || !owner(c, n, px, py)) continue;
      const u = r.random(), pal = u < 0.55 ? P.dark : u < 0.82 ? P.mid : u < 0.95 ? P.brown : P.hi;
      const pts = trace(field, px, py, r.range(34, 64), 7);
      p.items.push(strokeItem(L.CYPRESS, base + r.random(), seed, pts, r.range(5.5, 9.5), jitter(r.pick(pal), r, 14)));
    }
  }

  // Dark edges are painted as short overlapping strokes that follow the silhouette,
  // skipping stretches that fall inside a neighbouring tongue.
  c.tongues.forEach((_g, gi) => {
    outlines[gi].forEach((edge, side) => {
      const r = new Rng(hash(c.id, 77, gi, side));
      for (let a = 0; a < edge.length - 2; a += r.int(3, 6)) {
        const seg = edge.slice(a, Math.min(edge.length, a + r.int(4, 8)));
        const mid = seg[Math.floor(seg.length / 2)];
        if (seg.length < 2 || !inPad(p, mid[0], 40)) continue;
        if (c.tongues.some((o, oi) => oi !== gi && tongueInside(o, n, mid[0] + (side ? 6 : -6), mid[1]))) continue;
        const seed = hash(c.id, 78, gi, side, a), sr = new Rng(seed);
        const pts = seg.map(([x, y]) => [x + sr.range(-1.5, 1.5), y] as Pt);
        p.items.push(strokeItem(L.CYPRESS_EDGE, base + sr.random(), seed, pts, sr.range(4, 7), jitter(sr.pick(P.edge), sr, 8)));
      }
    });
  });
}
