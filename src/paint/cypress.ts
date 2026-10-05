// The cypress: a dark, flame-like tree licking up into the sky from the foreground.
import { fillPoly, line, trace, wobble, type Field, type Pt } from '../core/brush';
import { jitter, palette } from '../core/color';
import { clamp } from '../core/math';
import { hash, Rng } from '../core/rng';
import { cypressGeom as G, cypressInside, type Cypress } from '../world/world';
import { inPad, L, strokeItem, type ChunkPlan } from './plan';

const P = palette({
  dark: ['#14231b', '#1a2c20', '#0f1a15', '#172619'],
  mid: ['#203626', '#263f28', '#2e4526', '#233629'],
  brown: ['#3e3220', '#4b3b22', '#5a4428'],
  hi: ['#4f6233', '#5f6b3c', '#455e37', '#6b7042', '#3d5a6a'],
  outline: ['#0a120e', '#0d1712'],
});

export function planCypresses(p: ChunkPlan) {
  for (const c of p.near.cypresses) if (inPad(p, c.x, c.w * 1.2)) planCypress(p, c);
}

function planCypress(p: ChunkPlan, c: Cypress) {
  const n = p.world.noise;
  // Cypresses never overlap, so ordering them by x keeps each one's strokes together.
  const base = c.x * 4;
  const steps = 120, left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, y = c.base - t * (c.base - c.top), cx = G.center(c, t);
    left.push([cx - G.halfL(c, n, t), y]);
    right.push([cx + G.halfR(c, n, t), y]);
  }
  const poly = left.concat(right.slice().reverse());
  p.items.push({ layer: L.CYPRESS_BASE, key: base, op: (ctx) => fillPoly(ctx, poly, P.dark[0]) });

  const field: Field = (x, y) => {
    const t = clamp(G.t(c, y), 0, 1), cx = G.center(c, t);
    const half = (x < cx ? G.halfL(c, n, t) : G.halfR(c, n, t)) || 1;
    const u = clamp((x - cx) / half, -1, 1);
    const dc = (G.center(c, t + 0.01) - G.center(c, t)) / (0.01 * (c.base - c.top));
    const a = 0.5 * Math.sin(t * 16 + u * 2 + c.ph) + 0.35 * u + dc;
    return [Math.sin(a), -Math.cos(a)];
  };

  const sp = 6;
  for (let i = Math.floor(-c.w / sp); i <= c.w / sp; i++) {
    for (let j = Math.floor(c.top / sp) - 1; j * sp < c.base + sp; j++) {
      const seed = hash(c.id, i, j), r = new Rng(seed);
      const px = c.x + (i + r.range(-0.5, 0.5)) * sp, py = (j + r.range(-0.5, 0.5)) * sp;
      if (!inPad(p, px) || !cypressInside(c, n, px, py)) continue;
      const u = r.random(), pal = u < 0.45 ? P.dark : u < 0.77 ? P.mid : u < 0.9 ? P.brown : P.hi;
      const pts = trace(field, px, py, r.range(26, 46), 6);
      p.items.push(strokeItem(L.CYPRESS, base + r.random(), seed, pts, r.range(5, 8.5), jitter(r.pick(pal), r, 14)));
    }
  }

  // Dark contour strokes along both edges, in short overlapping pieces.
  [left, right].forEach((edge, side) => {
    const r = new Rng(hash(c.id, 77, side));
    for (let a = 0; a < edge.length - 1; a += r.int(5, 9)) {
      const seg = edge.slice(a, Math.min(edge.length, a + r.int(8, 14)));
      if (seg.length < 2) continue;
      const pts = wobble(seg, r, 1.5, 8), w = r.range(3, 5), col = r.pick(P.outline);
      p.items.push({ layer: L.CYPRESS_EDGE, key: base + a / edge.length, op: (ctx) => line(ctx, pts, w, col, 0.8) });
    }
  });
}
