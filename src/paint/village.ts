// The sleeping village: blocky houses with lit windows, church spires and round trees.
// Every surface is built from loose dabs of paint and broken dark outlines, never clean fills.
import { fillPoly, stroke, type Ctx, type Pt } from '../core/brush';
import { css, darken, jitter, lighten, palette, type RGB } from '../core/color';
import { lerp, TAU } from '../core/math';
import { hashFloat, Rng } from '../core/rng';
import type { Church, House, Tree } from '../world/world';
import { inPad, L, type ChunkPlan } from './plan';

const P = palette({
  wall: ['#6a86a8', '#7f98b0', '#5a7896', '#8ea3a8', '#4f6f8f', '#9fb2b4'],
  wallWarm: ['#b39a6a', '#a48d64', '#c2ab78', '#9c8a62'],
  roof: ['#2a3f6a', '#34507a', '#22365e', '#3d5a6e', '#1d2f55'],
  roofWarm: ['#8a5a3a', '#7a4e34', '#9a6a40', '#6e4a36'],
  window: ['#f4d04a', '#f2b53a', '#f7de6a', '#f0c040'],
  tree: ['#1d3a3a', '#2a4a3a', '#355a45', '#1a2c40', '#24423f', '#3f6250'],
  outline: ['#101c3a', '#0c1630', '#14203f'],
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

/** Random point inside a triangle or a quad given as [tl, tr, br, bl], pulled in from the edges by m. */
function randIn(poly: Poly, rng: Rng, m = 0.1): Pt {
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

/**
 * Cover a face with short dabs going in direction `ang`, over a jittered base fill.
 * `shade` darkens the palette for faces turned away from the moonlight.
 */
function paintFace(ctx: Ctx, rng: Rng, poly: Poly, pal: RGB[], ang: number, sw: number, shade = 0) {
  const tone = (c: RGB) => (shade ? darken(c, shade) : c);
  fillPoly(ctx, poly.map(([x, y]) => [x + rng.range(-0.6, 0.6), y + rng.range(-0.6, 0.6)] as Pt), tone(pal[0]));
  const n = Math.max(3, Math.round((area(poly) / (sw * sw)) * 1.3));
  for (let i = 0; i < n; i++) {
    const [x, y] = randIn(poly, rng, 0.08);
    const a = ang + rng.range(-0.25, 0.25), len = sw * rng.range(1.2, 2.4);
    const dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2;
    const pts: Pt[] = [[x - dx, y - dy], [x + rng.range(-0.5, 0.5), y + rng.range(-0.5, 0.5)], [x + dx, y + dy]];
    stroke(ctx, rng, pts, sw * rng.range(0.8, 1.1), tone(jitter(rng.pick(pal), rng, 24)));
  }
}

/** Broken dark contour: each edge is its own slightly overshooting brush stroke, a few skipped. */
function contour(ctx: Ctx, rng: Rng, poly: Poly, w: number, closed = true) {
  const edges = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < edges; i++) {
    if (rng.chance(0.1)) continue;
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const o = rng.range(0, 0.12);
    const p0: Pt = [lerp(a[0], b[0], -o), lerp(a[1], b[1], -o)];
    const p1: Pt = [lerp(a[0], b[0], 1 + rng.range(0, 0.12)), lerp(a[1], b[1], 1 + rng.range(0, 0.12))];
    const mid: Pt = [lerp(p0[0], p1[0], 0.5) + rng.range(-0.8, 0.8), lerp(p0[1], p1[1], 0.5) + rng.range(-0.8, 0.8)];
    stroke(ctx, rng, [p0, mid, p1], w * rng.range(0.8, 1.2), jitter(rng.pick(P.outline), rng, 10));
  }
}

function windowDab(ctx: Ctx, rng: Rng, x: number, y: number, ww: number, wh: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, ww * 2.8);
  g.addColorStop(0, 'rgba(255,210,90,0.45)');
  g.addColorStop(1, 'rgba(255,190,70,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, ww * 2.8, 0, TAU);
  ctx.fill();
  stroke(ctx, rng, [[x, y - wh / 2], [x + rng.range(-0.4, 0.4), y], [x, y + wh / 2]], ww, jitter(rng.pick(P.window), rng, 20));
  stroke(ctx, rng, [[x, y - wh * 0.2], [x, y + wh * 0.1]], ww * 0.45, lighten(P.window[2], 0.5));
}

function drawHouse(ctx: Ctx, rng: Rng, h: House) {
  // Build in a frame where the side wall is on the right, then mirror for side = -1.
  const mx = (x: number) => h.x + h.side * (x - h.x);
  const M = (pts: Pt[]): Poly => pts.map(([x, y]) => [mx(x), y] as Pt);
  const l = h.x - h.w / 2, r = h.x + h.w / 2, top = h.y - h.h, bot = h.y;
  const d = h.depth, rise = d * 0.35, oh = h.w * 0.07;
  const px = h.x + h.peak * h.w, ridge = top - h.roofH;
  const sw = Math.max(2.2, h.size * 0.15);

  const wallPal = h.warm ? P.wallWarm : P.wall, roofPal = h.warmRoof ? P.roofWarm : P.roof;
  const front = M([[l, top], [r, top], [r, bot], [l, bot]]);
  const side = M([[r, top], [r + d, top - rise], [r + d, bot - rise], [r, bot]]);

  let roofFront: Poly, roofSide: Poly;
  if (h.flatRoof) {
    roofFront = M([[l - oh, top], [r + oh, top], [r + d + oh, top - rise], [l + d - oh, top - rise]]);
    roofSide = [];
  } else {
    roofFront = M([[l - oh, top + 1], [px, ridge], [r + oh, top + 1]]);
    roofSide = M([[px, ridge], [px + d, ridge - rise], [r + d + oh, top - rise + 1], [r + oh, top + 1]]);
  }

  paintFace(ctx, rng, side, wallPal, Math.PI / 2, sw, 0.35);
  paintFace(ctx, rng, front, wallPal, rng.chance(0.5) ? Math.PI / 2 : 0, sw);
  if (roofSide.length) {
    const ang = Math.atan2(-rise, d) + (h.side < 0 ? Math.PI : 0);
    paintFace(ctx, rng, roofSide, roofPal, ang, sw * 0.95, 0.12);
  }
  paintFace(ctx, rng, roofFront, roofPal, 0, sw * 0.95);

  if (h.chimney) {
    const cx = mx(lerp(l, r, 0.7)), cw = h.size * 0.12;
    const ch: Poly = [[cx - cw, ridge + h.roofH * 0.35], [cx + cw, ridge + h.roofH * 0.35], [cx + cw, ridge + h.roofH * 0.8], [cx - cw, ridge + h.roofH * 0.8]];
    paintFace(ctx, rng, ch, roofPal, Math.PI / 2, sw * 0.8, 0.2);
    contour(ctx, rng, ch, sw * 0.4);
  }

  for (let i = 0; i < h.windows; i++) {
    const ww = Math.max(2.5, h.w * 0.13), wh = h.h * 0.36;
    const wx = mx(lerp(l, r, h.windows === 1 ? 0.5 : 0.28 + i * 0.44)), wy = top + h.h * 0.48;
    windowDab(ctx, rng, wx, wy, ww, wh);
  }

  const ow = Math.max(1.6, h.size * 0.07);
  contour(ctx, rng, front, ow);
  contour(ctx, rng, side, ow);
  contour(ctx, rng, roofFront, ow);
  if (roofSide.length) contour(ctx, rng, roofSide, ow);
}

function drawChurch(ctx: Ctx, rng: Rng, c: Church) {
  const l = c.x - c.bodyW / 2, r = c.x + c.bodyW / 2, top = c.base - c.bodyH;
  const tl = l + c.bodyW * 0.08, tr = tl + c.towerW, ttop = top - c.towerH, mid = (tl + tr) / 2;
  const d = c.bodyW * 0.25, rise = d * 0.35;
  const wallPal = c.warm ? P.wallWarm : P.wall;
  const sw = 3.6;

  const body: Poly = [[l, top], [r, top], [r, c.base], [l, c.base]];
  const bodySide: Poly = [[r, top], [r + d, top - rise], [r + d, c.base - rise], [r, c.base]];
  const roof: Poly = [[l + c.towerW, top], [r - c.bodyW * 0.05, top - c.bodyH * 0.45], [r + d, top - rise], [r, top]];
  const tower: Poly = [[tl, ttop], [tr, ttop], [tr, c.base], [tl, c.base]];
  const spire: Poly = [[tl - 2, ttop], [mid, c.spireTop], [tr + 2, ttop]];

  paintFace(ctx, rng, bodySide, wallPal, Math.PI / 2, sw, 0.35);
  paintFace(ctx, rng, roof, P.roof, Math.atan2(-c.bodyH * 0.45, c.bodyW), sw);
  paintFace(ctx, rng, body, wallPal, Math.PI / 2, sw);
  paintFace(ctx, rng, tower, wallPal, Math.PI / 2, sw * 0.9, 0.08);
  // The spire is a few long vertical strokes tapering to the point.
  fillPoly(ctx, spire, P.roof[2]);
  const sh = ttop - c.spireTop;
  for (let i = 0; i < 9; i++) {
    const u = rng.range(-0.4, 0.4), y0 = ttop - rng.range(0, 0.25) * sh, y1 = c.spireTop + sh * rng.range(0.05, 0.4);
    const halfAt = (y: number) => ((c.towerW / 2 + 2) * (y - c.spireTop)) / sh;
    stroke(ctx, rng, [[mid + u * halfAt(y0), y0], [mid + u * halfAt((y0 + y1) / 2), (y0 + y1) / 2], [mid + u * halfAt(y1), y1]], sw * rng.range(0.8, 1.1), jitter(rng.pick(P.roof), rng, 18));
  }
  windowDab(ctx, rng, mid, ttop + c.towerH * 0.45, c.towerW * 0.28, c.towerH * 0.35);
  windowDab(ctx, rng, lerp(tr, r, 0.5), top + c.bodyH * 0.5, 3, c.bodyH * 0.35);

  const ow = 2.6;
  contour(ctx, rng, bodySide, ow);
  contour(ctx, rng, body, ow);
  contour(ctx, rng, roof, ow);
  contour(ctx, rng, tower, ow);
  contour(ctx, rng, spire, ow, false);
}

function drawTree(ctx: Ctx, rng: Rng, t: Tree) {
  const rx = t.r * (t.tall > 1 ? 0.6 : 1), ry = t.r * 0.9 * t.tall, cy = t.y - ry * 0.85;
  ctx.fillStyle = css(P.tree[3]);
  ctx.beginPath();
  ctx.ellipse(t.x, cy, rx, ry, 0, 0, TAU);
  ctx.fill();
  const n = Math.round((rx * ry) / 30);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), rr = Math.sqrt(rng.random()) * 0.95;
    const x = t.x + Math.cos(a) * rr * rx, y = cy + Math.sin(a) * rr * ry;
    const pts: Pt[] = [];
    // Round trees swirl around their center; poplars flick upward.
    for (let j = 0; j < 4; j++) {
      const aj = t.tall > 1 ? -Math.PI / 2 + Math.cos(a) * 0.5 + (j - 1.5) * 0.15 : a + Math.PI / 2 + (j - 1.5) * 0.25;
      pts.push([x + Math.cos(aj) * j * 4, y + Math.sin(aj) * j * 4]);
    }
    stroke(ctx, rng, pts, rng.range(4, 6.5), jitter(rng.pick(P.tree), rng, 18));
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
  for (const t of trees) add(t.x, t.r + 20, t.y, t.id, (ctx, rng) => drawTree(ctx, rng, t));
}
