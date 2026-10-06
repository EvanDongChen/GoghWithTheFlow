// The river, after "Starry Night Over the Rhône": horizontal strokes of deep and light blue,
// a dark far bank, and the gaslights doubled in the water as broken columns of gold.
import { fillPoly, type Pt } from '../core/brush';
import { jitter, palette } from '../core/color';
import { lerp } from '../core/math';
import { hash, Rng } from '../core/rng';
import { cellRange, inPad, L, strokeItem, type ChunkPlan } from './plan';

const P = palette({
  water: ['#1f3a78', '#2a4a8a', '#355aa0', '#24418a', '#2e5296'],
  waterLight: ['#4a70b4', '#6a8cc8', '#5a7cbc', '#8eaad4'],
  bank: ['#0f1a3c', '#14214a', '#18284e'],
  gold: ['#f4d04a', '#f2b53a', '#f7de6a', '#e89a30'],
});

export function planWater(p: ChunkPlan) {
  const w = p.world;
  let any = false;
  for (let x = p.x0 - p.pad; x <= p.x1 + p.pad; x += 25) if (w.riverWeight(x) > 0.02) { any = true; break; }
  if (!any) return;

  const top: Pt[] = [], bottom: Pt[] = [];
  for (let x = p.x0 - p.pad - 10; x <= p.x1 + p.pad + 10; x += 8) {
    top.push([x, w.riverTop(x)]);
    bottom.push([x, w.riverBottom(x)]);
  }
  const poly = top.concat(bottom.reverse());
  p.items.push({ layer: L.WATER_BASE, key: 0, op: (ctx) => fillPoly(ctx, poly, P.water[0]) });

  // Water: long horizontal strokes, lighter toward the near bank where the sky reflects.
  const sp = 7;
  const [i0, i1] = cellRange(p, sp);
  let yMin = Infinity, yMax = -Infinity;
  for (const [, y] of top) yMin = Math.min(yMin, y);
  for (const [, y] of bottom) yMax = Math.max(yMax, y);
  for (let i = i0; i <= i1; i++) {
    for (let j = Math.floor(yMin / sp) - 1; j * sp < yMax + sp; j++) {
      const seed = hash(w.s, 9, i, j), r = new Rng(seed);
      const px = (i + r.range(-0.5, 0.5)) * sp, py = (j + r.range(-0.5, 0.5)) * sp;
      if (!inPad(p, px) || !w.inRiver(px, py, -2)) continue;
      const depth = (py - w.riverTop(px)) / Math.max(1, w.riverBottom(px) - w.riverTop(px));
      const pal = r.random() < 0.15 + depth * 0.35 ? P.waterLight : P.water;
      const len = r.range(16, 34);
      const pts: Pt[] = [[px - len / 2, py + r.range(-1, 1)], [px, py + r.range(-1.5, 1.5)], [px + len / 2, py + r.range(-1, 1)]];
      p.items.push(strokeItem(L.WATER, r.random(), seed, pts, r.range(3.5, 5.5), jitter(r.pick(pal), r, 16)));
    }
  }

  // The far bank: a dark seam where the town meets the water.
  for (let i = Math.floor((p.x0 - p.pad) / 50); i * 50 < p.x1 + p.pad; i++) {
    const seed = hash(w.s, 10, i), r = new Rng(seed), x = i * 50 + r.range(-10, 10);
    if (w.riverWeight(x) < 0.15) continue;
    const pts: Pt[] = [0, 0.5, 1].map((t) => { const xx = x + t * 60; return [xx, w.riverTop(xx) + 1] as Pt; });
    p.items.push(strokeItem(L.WATER, 2 + r.random(), seed, pts, r.range(3, 4.5), jitter(r.pick(P.bank), r, 8)));
  }

  // Reflections of the gaslights: broken, wavering columns of gold reaching toward us.
  for (const lamp of p.near.lamps) {
    if (!inPad(p, lamp.x, 40) || w.riverWeight(lamp.x) < 0.3) continue;
    const y0 = w.riverTop(lamp.x) + 3, y1 = w.riverBottom(lamp.x) - 2;
    if (lamp.y > y0 + 6) continue;
    for (let k = 0, y = y0; y < y1; k++, y += 6) {
      const seed = hash(lamp.id, 11, k), r = new Rng(seed);
      if (r.chance(0.18)) continue;
      const t = (y - y0) / Math.max(1, y1 - y0), half = lerp(3, 11, t) * r.range(0.6, 1.2);
      const x = lamp.x + r.range(-2, 2) + Math.sin(k * 1.7) * 2;
      p.items.push(strokeItem(L.WATER, 3 + r.random(), seed, [[x - half, y], [x + half, y + r.range(-0.8, 0.8)]], r.range(3, 4.2), jitter(r.pick(P.gold), r, 20)));
    }
  }
}
