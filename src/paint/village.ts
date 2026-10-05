// The sleeping village: blocky houses with lit windows, church spires, olive trees and bushes.
// Forms are modelled with light and shadow from loose dabs of paint, not drawn outlines:
// moonlit pale fronts, shadowed side walls, dark roofs, and a few dark seams of shadow.
import { fillPoly, stroke, type Ctx, type Pt } from '../core/brush';
import { darken, jitter, lighten, palette, type RGB } from '../core/color';
import { lerp, TAU } from '../core/math';
import { hashFloat, Rng } from '../core/rng';
import type { Church, House, Tree } from '../world/world';
import { inPad, L, type ChunkPlan } from './plan';

const P = palette({
  wallLight: ['#9fb2c6', '#8ea4bc', '#b4c2c8', '#7d94b0', '#c8cfc8', '#a8b8c0'],
  wallWarm: ['#d6bd86', '#c8a970', '#dfc694', '#bfa877'],
  wallShade: ['#4f6888', '#5a7290', '#46607f', '#617a92'],
  roofBlue: ['#1f3567', '#283f73', '#2c4a6e', '#1b2f5a', '#33507e'],
  roofRust: ['#a2552e', '#8c4a2a', '#b5653a', '#7e4426', '#c07444'],
  roofGreen: ['#3a5a4a', '#4a6a50', '#33524a'],
  window: ['#f4d04a', '#f2b53a', '#f7de6a', '#f0c040'],
  seam: ['#14214a', '#1a2a55', '#0f1a3c'],
  treeDark: ['#16293a', '#1b3340', '#20403f', '#152a30'],
  treeMid: ['#2c5070', '#335a74', '#3c6680', '#2e5660'],
  treeLight: ['#7aa4b8', '#8db4c0', '#6a98b0', '#9cc0bc'],
  bushDark: ['#112030', '#152a2c', '#1a2a3a'],
  bushMid: ['#22403c', '#284a44', '#2a4458'],
  bushLight: ['#4a7068', '#557a6a', '#4a6f80'],
});

type Poly = Pt[];

function area(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** Random point inside a triangle or a quad given as [tl, tr, br, bl]. Negative m spills past the edges. */
function randIn(poly: Poly, rng: Rng, m: number): Pt {
  if (poly.length === 3) {
    let a = rng.random(), b = rng.random();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }
    const [p0, p1, p2] = poly;
    const x = p0[0] + a * (p1[0] - p0[0]) + b * (p2[0] - p0[0]);
    const y = p0[1] + a * (p1[1] - p0[1]) + b * (p2[1] - p0[1]);
    const cx = (p0[0] + p1[0] + p2[0]) / 3, cy = (p0[1] + p1[1] + p2[1]) / 3;
    return [lerp(x, cx, m * 2), lerp(y, cy, m * 2)];
  }
  const u = rng.range(m, 1 - m), v = rng.range(m, 1 - m);
  const [tl, tr, br, bl] = poly;
  const top: Pt = [lerp(tl[0], tr[0], u), lerp(tl[1], tr[1], u)];
  const bot: Pt = [lerp(bl[0], br[0], u), lerp(bl[1], br[1], u)];
  return [lerp(top[0], bot[0], v), lerp(top[1], bot[1], v)];
}

/** Cover a face with chunky dabs going in direction `ang` over a rough base fill. */
function paintFace(ctx: Ctx, rng: Rng, poly: Poly, pal: RGB[], ang: number, sw: number, density = 1.5) {
  fillPoly(ctx, poly.map(([x, y]) => [x + rng.range(-0.8, 0.8), y + rng.range(-0.8, 0.8)] as Pt), pal[0]);
  const n = Math.max(3, Math.round((area(poly) / (sw * sw)) * density));
  for (let i = 0; i < n; i++) {
    const [x, y] = randIn(poly, rng, 0.06);
    const a = ang + rng.range(-0.22, 0.22), len = sw * rng.range(1.1, 2.2);
    const dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2;
    const pts: Pt[] = [[x - dx, y - dy], [x + rng.range(-0.5, 0.5), y + rng.range(-0.5, 0.5)], [x + dx, y + dy]];
    stroke(ctx, rng, pts, sw * rng.range(0.85, 1.15), jitter(rng.pick(pal), rng, 26));
  }
}

/** A dark seam of shadow along a->b, painted as one tapering brush stroke. */
function seam(ctx: Ctx, rng: Rng, a: Pt, b: Pt, w: number) {
  const mid: Pt = [lerp(a[0], b[0], 0.5) + rng.range(-0.6, 0.6), lerp(a[1], b[1], 0.5) + rng.range(-0.6, 0.6)];
  stroke(ctx, rng, [a, mid, b], w * rng.range(0.8, 1.15), jitter(rng.pick(P.seam), rng, 10));
}

function windowDab(ctx: Ctx, rng: Rng, x: number, y: number, ww: number, wh: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, ww * 3);
  g.addColorStop(0, 'rgba(255,210,90,0.4)');
  g.addColorStop(1, 'rgba(255,190,70,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, ww * 3, 0, TAU);
  ctx.fill();
  stroke(ctx, rng, [[x, y - wh / 2], [x + rng.range(-0.4, 0.4), y], [x, y + wh / 2]], ww, jitter(rng.pick(P.window), rng, 20));
  stroke(ctx, rng, [[x, y - wh * 0.2], [x, y + wh * 0.1]], ww * 0.45, lighten(P.window[2], 0.5));
}

function roofPalette(kind: House['roof']) {
  return kind === 'rust' ? P.roofRust : kind === 'green' ? P.roofGreen : P.roofBlue;
}

function drawHouse(ctx: Ctx, rng: Rng, h: House) {
  // Build in a frame where the side wall is on the right, then mirror for side = -1.
  const mx = (x: number) => h.x + h.side * (x - h.x);
  const M = (pts: Pt[]): Poly => pts.map(([x, y]) => [mx(x), y] as Pt);
  const l = h.x - h.w / 2, r = h.x + h.w / 2, top = h.y - h.h, bot = h.y;
  const d = h.depth, rise = d * 0.35, oh = h.w * 0.08;
  const px = h.x + h.peak * h.w, ridge = top - h.roofH;
  const sw = Math.max(3, h.size * 0.26);
  const wallPal = h.wall === 'warm' ? P.wallWarm : P.wallLight, roofPal = roofPalette(h.roof);

  const front = M([[l, top], [r, top], [r, bot], [l, bot]]);
  const side = M([[r, top], [r + d, top - rise], [r + d, bot - rise], [r, bot]]);

  // Cast shadow on the ground first, so the house sits in the landscape.
  stroke(ctx, rng, M([[l - sw * 0.3, bot + sw * 0.25], [h.x, bot + sw * 0.35], [r + d * 0.8, bot + sw * 0.1 - rise * 0.5]]), sw * 0.9, jitter(darken(P.seam[0], 0.1), rng, 8));

  paintFace(ctx, rng, side, P.wallShade, Math.PI / 2, sw);
  paintFace(ctx, rng, front, wallPal, rng.chance(0.6) ? Math.PI / 2 : 0, sw);

  if (h.flatRoof) {
    paintFace(ctx, rng, M([[l - oh, top], [r + oh, top], [r + d + oh, top - rise], [l + d - oh, top - rise]]), roofPal, 0, sw * 0.9);
  } else {
    const roofSide = M([[px, ridge], [px + d, ridge - rise], [r + d + oh, top - rise + 1], [r + oh, top + 1]]);
    const shadeRoof = roofPal.map((c) => darken(c, 0.18));
    paintFace(ctx, rng, roofSide, shadeRoof, Math.atan2(-rise, d) + (h.side < 0 ? Math.PI : 0), sw * 0.9);
    paintFace(ctx, rng, M([[l - oh, top + 1], [px, ridge], [r + oh, top + 1]]), roofPal, 0, sw * 0.9);
  }

  if (h.chimney && !h.flatRoof) {
    const t = 0.55, slopeY = lerp(ridge, top, t), cx = mx(lerp(px, r, t)), cw = h.size * 0.1;
    paintFace(ctx, rng, [[cx - cw, slopeY - h.roofH * 0.45], [cx + cw, slopeY - h.roofH * 0.45], [cx + cw, slopeY + 2], [cx - cw, slopeY + 2]], P.wallShade, Math.PI / 2, sw * 0.7);
  }

  for (let i = 0; i < h.windows; i++) {
    const ww = Math.max(2.5, h.w * 0.13), wh = h.h * 0.36;
    windowDab(ctx, rng, mx(lerp(l, r, h.windows === 1 ? 0.5 : 0.28 + i * 0.44)), top + h.h * 0.5, ww, wh);
  }

  // A few seams of shadow: under the eave and down the corner between front and side.
  const sw2 = Math.max(1.6, h.size * 0.07);
  const [e0, e1] = M([[l - oh * 0.5, top + sw2 * 0.4], [r + oh * 0.5, top + sw2 * 0.4]]);
  seam(ctx, rng, e0, e1, sw2);
  if (rng.chance(0.7)) {
    const [c0, c1] = M([[r, top + sw2], [r, bot]]);
    seam(ctx, rng, c0, c1, sw2 * 0.8);
  }
}

function drawChurch(ctx: Ctx, rng: Rng, c: Church) {
  const l = c.x - c.bodyW / 2, r = c.x + c.bodyW / 2, top = c.base - c.bodyH;
  const tl = l + c.bodyW * 0.08, tr = tl + c.towerW, ttop = top - c.towerH, mid = (tl + tr) / 2;
  const d = c.bodyW * 0.25, rise = d * 0.35;
  const wallPal = c.warm ? P.wallWarm : P.wallLight;
  const sw = 4;

  stroke(ctx, rng, [[l - 4, c.base + 3], [c.x, c.base + 4], [r + d, c.base + 1 - rise * 0.5]], sw, P.seam[0]);
  paintFace(ctx, rng, [[r, top], [r + d, top - rise], [r + d, c.base - rise], [r, c.base]], P.wallShade, Math.PI / 2, sw);
  paintFace(ctx, rng, [[l + c.towerW, top], [r - c.bodyW * 0.05, top - c.bodyH * 0.5], [r + d, top - rise], [r, top]], P.roofBlue, Math.atan2(-c.bodyH * 0.5, c.bodyW), sw);
  paintFace(ctx, rng, [[l, top], [r, top], [r, c.base], [l, c.base]], wallPal, Math.PI / 2, sw);
  paintFace(ctx, rng, [[tl, ttop], [tr, ttop], [tr, c.base], [tl, c.base]], wallPal.map((x) => darken(x, 0.08)), Math.PI / 2, sw * 0.9);

  // The spire: long dark strokes tapering to a needle point, lit down one side.
  const sh = ttop - c.spireTop;
  fillPoly(ctx, [[tl - 2, ttop], [mid, c.spireTop], [tr + 2, ttop]], P.roofBlue[3]);
  const halfAt = (y: number) => ((c.towerW / 2 + 2) * (y - c.spireTop)) / sh;
  for (let i = 0; i < 12; i++) {
    const u = rng.range(-0.75, 0.75), y0 = ttop - rng.range(0, 0.3) * sh, y1 = c.spireTop + sh * rng.range(0, 0.35);
    const pal = u > 0.25 ? P.roofGreen : P.roofBlue;
    stroke(ctx, rng, [[mid + u * halfAt(y0), y0], [mid + u * halfAt((y0 + y1) / 2), (y0 + y1) / 2], [mid + u * halfAt(y1), y1]], sw * rng.range(0.7, 1), jitter(rng.pick(pal), rng, 18));
  }
  seam(ctx, rng, [tl - 1, ttop], [mid, c.spireTop], 2);
  seam(ctx, rng, [l, top + 1], [r, top + 1], 2.2);
  windowDab(ctx, rng, mid, ttop + c.towerH * 0.45, c.towerW * 0.28, c.towerH * 0.35);
  windowDab(ctx, rng, lerp(tr, r, 0.5), top + c.bodyH * 0.5, 3, c.bodyH * 0.35);
}

/** A rough blob, so tree silhouettes aren't perfect ellipses. */
function blob(rng: Rng, x: number, y: number, rx: number, ry: number): Poly {
  const pts: Poly = [], n = 18, ph = rng.range(0, TAU);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, k = 1 + 0.12 * Math.sin(a * 3 + ph) + rng.range(-0.06, 0.06);
    pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]);
  }
  return pts;
}

function drawTree(ctx: Ctx, rng: Rng, t: Tree) {
  const poplar = t.kind === 'poplar', olive = t.kind === 'olive';
  const rx = t.r * (poplar ? 0.55 : olive ? 1.25 : 1), ry = t.r * (poplar ? 2.1 : olive ? 0.65 : 0.9), cy = t.y - ry * 0.8;
  const dark = olive ? P.treeDark : P.bushDark, mid = olive ? P.treeMid : P.bushMid, light = olive ? P.treeLight : P.bushLight;
  fillPoly(ctx, blob(rng, t.x, cy, rx, ry), dark[0]);
  const n = Math.round((rx * ry) / 9);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), rr = Math.sqrt(rng.random()) * 0.98;
    const ox = Math.cos(a) * rr, oy = Math.sin(a) * rr;
    const x = t.x + ox * rx, y = cy + oy * ry;
    // Moonlight from the upper left: lighter strokes up there, darker below.
    const lit = -ox * 0.5 - oy + rng.range(-0.6, 0.6);
    const pal = lit > 0.55 ? light : lit > -0.3 ? mid : dark;
    const pts: Pt[] = [];
    for (let j = 0; j < 4; j++) {
      // Rounded crowns swirl around their center; poplars flick upward.
      const aj = poplar ? -Math.PI / 2 + ox * 0.7 + (j - 1.5) * 0.12 : a + Math.PI / 2 + (j - 1.5) * 0.3;
      pts.push([x + Math.cos(aj) * j * 4.5, y + Math.sin(aj) * j * 4.5]);
    }
    stroke(ctx, rng, pts, rng.range(4, 6.5), jitter(rng.pick(pal), rng, 16));
  }
}

export function planVillage(p: ChunkPlan) {
  const { houses, churches, trees } = p.near;
  const add = (x: number, reach: number, y: number, id: number, draw: (ctx: Ctx, rng: Rng) => void) => {
    if (!inPad(p, x, reach)) return;
    // Back to front: farther (higher on the canvas) things are drawn first.
    p.items.push({ layer: L.VILLAGE, key: y + hashFloat(id) * 0.01, op: (ctx) => draw(ctx, new Rng(id)) });
  };
  for (const h of houses) add(h.x, h.w + h.depth + 10, h.y, h.id, (ctx, rng) => drawHouse(ctx, rng, h));
  for (const c of churches) add(c.x, c.bodyW + 20, c.base, c.id, (ctx, rng) => drawChurch(ctx, rng, c));
  for (const t of trees) add(t.x, t.r * 1.4 + 20, t.y, t.id, (ctx, rng) => drawTree(ctx, rng, t));
}
