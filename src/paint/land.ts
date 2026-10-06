// Rolling blue hills along the horizon, and the dark valley floor the village sits in.
import { fillPoly, trace, type Field, type Pt } from '../core/brush';
import { jitter, palette } from '../core/color';
import { clamp, lerp } from '../core/math';
import { hash, Rng } from '../core/rng';
import { H, type World } from '../world/world';
import { cellRange, inPad, L, strokeItem, type ChunkPlan } from './plan';
import { moodTint } from './sky';

const P = palette({
  back: ['#23447f', '#2d5492', '#3a64a2', '#5079b3', '#1c3a72'],
  backHi: ['#6f97c6', '#8aaed3'],
  front: ['#34548c', '#3a5c9a', '#4a6ea8', '#5a7db4', '#2c4a7c', '#4a6e96'],
  frontHi: ['#7c9fcc', '#8eb0d4', '#6f96b8'],
  peak: ['#13235a', '#1a2d6a', '#22377a', '#2c4486', '#3a5596'],
  outline: ['#11234a', '#0f1f40', '#16295a'],
  ground: ['#1b2f4f', '#223a5e', '#2b4a66', '#2a4650', '#1e3548', '#365670', '#28445e'],
  wheat: ['#5e5432', '#6a5e36', '#766a3e', '#4e4a30', '#82744a', '#585a3c'],
  wheatLit: ['#9a8650', '#8e7c4a', '#a8925a'],
  orchard: ['#2e4436', '#38503e', '#2a3e3a', '#44583e', '#24383a'],
  field: ['#3e5a4e', '#4a6450', '#3a5254', '#566a4c'],
});

const slope = (f: (x: number) => number, x: number) => (f(x + 4) - f(x - 4)) / 8;

function landField(w: World): Field {
  return (x, y) => {
    const b = w.ridgeBack(x), f = w.ridgeFront(x), v = w.villageTop(x);
    let sl = y < f
      ? lerp(slope(w.ridgeBack, x), slope(w.ridgeFront, x), clamp((y - b) / (f - b), 0, 1))
      : lerp(slope(w.ridgeFront, x), slope(w.villageTop, x), clamp((y - f) / (v - f), 0, 1));
    sl += 0.15 * w.noise.noise2(x * 0.01, y * 0.01);
    const l = Math.hypot(1, sl);
    return [1 / l, sl / l];
  };
}

function band(p: ChunkPlan, top: (x: number) => number, bottom: (x: number) => number): Pt[] {
  const pts: Pt[] = [];
  const a = p.x0 - p.pad - 10, b = p.x1 + p.pad + 10;
  for (let x = a; x <= b; x += 10) pts.push([x, top(x)]);
  pts.push([b, top(b)]);
  for (let x = b; x >= a; x -= 10) pts.push([x, bottom(x) + 6]);
  pts.push([a, bottom(a) + 6]);
  return pts;
}

export function planLand(p: ChunkPlan) {
  const w = p.world;
  const backPoly = band(p, w.ridgeBack, w.ridgeFront);
  const frontPoly = band(p, w.ridgeFront, w.villageTop);
  const grade = w.gradeAt((p.x0 + p.x1) / 2), backBase = moodTint(grade, P.back[1]), frontBase = moodTint(grade, P.front[1]);
  p.items.push({ layer: L.HILL_BASE, key: 0, op: (ctx) => { fillPoly(ctx, backPoly, backBase); fillPoly(ctx, frontPoly, frontBase); } });

  const field = landField(w), sp = 8;
  const [i0, i1] = cellRange(p, sp);
  const j0 = Math.floor((w.horizon - H * 0.13) / sp), j1 = Math.ceil((w.horizon + H * 0.3) / sp);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const seed = hash(w.s, 5, i, j), r = new Rng(seed);
      const px = (i + r.range(-0.5, 0.5)) * sp, py = (j + r.range(-0.5, 0.5)) * sp;
      if (!inPad(p, px) || py < w.ridgeBack(px) + 2 || py > w.villageTop(px) + 4) continue;
      const isBack = py < w.ridgeFront(px);
      // High peaks are painted in deep navy, like the dark mountain at the right of the original.
      const peak = isBack && r.random() < w.peakness(px) * 0.85;
      const pal = peak ? P.peak : isBack ? (r.chance(0.14) ? P.backHi : P.back) : r.chance(0.1) ? P.frontHi : P.front;
      const pts = trace(field, px, py, r.range(26, 44), 5);
      p.items.push(strokeItem(L.HILL, r.random(), seed, pts, r.range(4.5, 7), moodTint(w.gradeAt(px), jitter(r.pick(pal), r, 18))));
    }
  }

  // Dark ridgelines in short overlapping pieces: Van Gogh's outlines.
  [w.ridgeBack, w.ridgeFront].forEach((f, which) => {
    const step = 70;
    for (let i = Math.floor((p.x0 - p.pad - 120) / step); i * step < p.x1 + p.pad; i++) {
      const seed = hash(w.s, 6, which, i), r = new Rng(seed);
      if (r.chance(0.25)) continue;
      const xs = i * step + r.range(-15, 15), len = r.range(50, 100);
      const seg: Pt[] = [];
      for (let t = 0; t <= 6; t++) {
        const xx = xs + (len * t) / 6;
        seg.push([xx, f(xx) + r.range(-1, 1)]);
      }
      p.items.push(strokeItem(L.RIDGE, r.random(), seed, seg, r.range(3, 4.5), jitter(r.pick(P.outline), r, 14)));
    }
  });

  planGround(p);
}

function planGround(p: ChunkPlan) {
  const w = p.world;
  const poly: Pt[] = [];
  for (let x = p.x0 - p.pad - 10; x <= p.x1 + p.pad + 10; x += 10) poly.push([x, w.villageTop(x)]);
  poly.push([p.x1 + p.pad + 10, H + 20], [p.x0 - p.pad - 10, H + 20]);
  p.items.push({ layer: L.GROUND_BASE, key: 0, op: (ctx) => fillPoly(ctx, poly, P.ground[0]) });

  const sp = 8;
  const [i0, i1] = cellRange(p, sp);
  for (let i = i0; i <= i1; i++) {
    for (let j = Math.floor(w.horizon / sp); j * sp < H + sp; j++) {
      const seed = hash(w.s, 7, i, j), r = new Rng(seed);
      const px = (i + r.range(-0.5, 0.5)) * sp, py = (j + r.range(-0.5, 0.5)) * sp;
      if (!inPad(p, px) || py < w.villageTop(px) - 2) continue;
      // Wheat leans and ripples upward; orchard soil lies in level furrows; the rest swirls gently.
      const wheat = r.random() < w.wheatWeight(px), orchard = !wheat && r.random() < w.biomeWeight(px, 'orchard');
      const a = wheat ? -Math.PI / 2 + 0.55 * Math.sin(px * 0.02 + py * 0.01) + r.range(-0.3, 0.3)
        : orchard ? r.range(-0.12, 0.12)
        : 0.9 * w.noise.noise2(px * 0.006 + 30, py * 0.006) + r.range(-0.25, 0.25);
      const len = wheat ? r.range(14, 26) : r.range(12, 22);
      // Large, slow patches of muted fields break up the dark valley floor.
      const fieldy = !wheat && !orchard && w.noise.noise2(px * 0.0015 + 90, py * 0.004) > 0.5 && r.chance(0.5);
      const pts: Pt[] = [
        [px - (Math.cos(a) * len) / 2, py - (Math.sin(a) * len) / 2],
        [px, py + r.range(-1, 1)],
        [px + (Math.cos(a) * len) / 2, py + (Math.sin(a) * len) / 2],
      ];
      const pal = wheat ? (r.chance(0.15) ? P.wheatLit : P.wheat) : orchard ? P.orchard : fieldy ? P.field : P.ground;
      p.items.push(strokeItem(L.GROUND, r.random(), seed, pts, r.range(4, 6.5), jitter(r.pick(pal), r, 16)));
    }
  }
}
