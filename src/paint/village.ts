// The sleeping village and the countryside around it: houses, cottages, a lit café, churches,
// trees and irises, haystacks, gaslights, boats and windmills.
// Forms are modelled with light and shadow from loose dabs of paint, not drawn outlines:
// moonlit pale fronts, shadowed side walls, dark roofs, and a few dark seams of shadow.
import { fillPoly, stroke, type Ctx, type Pt } from '../core/brush';
import { darken, jitter, lighten, palette, type RGB } from '../core/color';
import { lerp, TAU } from '../core/math';
import { hashFloat, Rng } from '../core/rng';
import type { Boat, Church, Haystack, House, Lamp, Mill, Season, Tree } from '../world/world';
import { inPad, L, type ChunkPlan } from './plan';
import { treeSeason } from './season';

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
  pineDark: ['#10221e', '#142a26', '#18302a'],
  pineLight: ['#2f5446', '#3a604c', '#2c4c50'],
  thatch: ['#7a6438', '#8a7040', '#6a5530', '#9a7e48', '#5e4c2c'],
  cafeWall: ['#e8b84a', '#f0c860', '#d9a43a', '#f4d27a'],
  awning: ['#d9822b', '#c8702a', '#e8963a', '#b85e24'],
  irisLeaf: ['#24483a', '#2e5a44', '#1e3c34', '#3a6a4c'],
  irisFlower: ['#5a5ab4', '#6e62c8', '#4a4aa0', '#7c6ad6', '#3e4c9c'],
  hay: ['#a08850', '#b89a5a', '#8a7440', '#c8a868', '#94804a'],
  hayLit: ['#dcc080', '#e6cc8c', '#d2b674'],
  mill: ['#5a4a3a', '#4a3c30', '#6a5844', '#3e3228'],
  millWarm: ['#9a8a6a', '#a8987a', '#8a7a5c'],
  boat: ['#2e5a6a', '#3a6a5a', '#7a4a2e', '#2a4a7a', '#5a6a3a'],
  post: ['#141a2a', '#1a2030'],
  sunPetal: ['#f4c430', '#f7d452', '#e8a820', '#fbe27a', '#e09a1c'],
  sunPetalLit: ['#fbe88a', '#fff0a0'],
  sunCore: ['#3a2412', '#4a3018', '#2c1a0e', '#5a3c1c'],
  sunStem: ['#3e5a2c', '#4a6a34', '#2e4a26', '#58763c'],
  crow: ['#0c0e14', '#14161e', '#1a1c26', '#080a10'],
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
  const cafe = h.style === 'cafe', cottage = h.style === 'cottage';
  const wallPal = cafe ? P.cafeWall : h.wall === 'warm' ? P.wallWarm : P.wallLight;
  const roofPal = cottage ? P.thatch : cafe ? P.roofBlue : roofPalette(h.roof);

  if (cafe) {
    // The café spills warm light onto the ground in front of it.
    const g = ctx.createRadialGradient(h.x, bot, 0, h.x, bot, h.w * 1.6);
    g.addColorStop(0, 'rgba(255,200,90,0.5)');
    g.addColorStop(1, 'rgba(255,180,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(h.x, bot + h.size * 0.1, h.w * 1.6, h.w * 0.6, 0, 0, TAU);
    ctx.fill();
  }

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
    if (cottage) {
      // Thatch: a few long ragged strokes along the eave.
      for (let i = 0; i < 3; i++) {
        const yy = top - h.roofH * (0.1 + i * 0.22);
        const k = (yy - ridge) / (top - ridge);
        stroke(ctx, rng, M([[lerp(px, l - oh, k), yy], [h.x, yy + rng.range(-1, 1)], [lerp(px, r + oh, k), yy]]), sw * 0.55, jitter(rng.pick(P.thatch), rng, 20));
      }
    }
  }

  if (cafe) {
    // A striped orange awning over the terrace, with tables picked out below.
    const ay = top + h.h * 0.6, ah = h.h * 0.16;
    paintFace(ctx, rng, M([[l - oh, ay], [r + oh, ay], [r + oh * 2, ay + ah], [l - oh * 2, ay + ah]]), P.awning, 0, sw * 0.7, 2);
    for (let i = 0; i < 3; i++) {
      const tx = mx(lerp(l, r, 0.2 + i * 0.3)), ty = bot - h.h * 0.08;
      stroke(ctx, rng, [[tx - sw * 0.6, ty], [tx + sw * 0.6, ty]], sw * 0.5, P.cafeWall[3]);
    }
  }

  if (h.chimney && !h.flatRoof) {
    const t = 0.55, slopeY = lerp(ridge, top, t), cx = mx(lerp(px, r, t)), cw = h.size * 0.1;
    paintFace(ctx, rng, [[cx - cw, slopeY - h.roofH * 0.45], [cx + cw, slopeY - h.roofH * 0.45], [cx + cw, slopeY + 2], [cx - cw, slopeY + 2]], P.wallShade, Math.PI / 2, sw * 0.7);
  }

  for (const win of houseWindows(h)) windowDab(ctx, rng, win.x, win.y, win.w, win.h);

  // A few seams of shadow: under the eave and down the corner between front and side.
  const sw2 = Math.max(1.6, h.size * 0.07);
  const [e0, e1] = M([[l - oh * 0.5, top + sw2 * 0.4], [r + oh * 0.5, top + sw2 * 0.4]]);
  seam(ctx, rng, e0, e1, sw2);
  if (rng.chance(0.7)) {
    const [c0, c1] = M([[r, top + sw2], [r, bot]]);
    seam(ctx, rng, c0, c1, sw2 * 0.8);
  }
}

/** Where a house's lit windows are, shared with the animation layer so they can flicker. */
export function houseWindows(h: House): { x: number; y: number; w: number; h: number }[] {
  const l = h.x - h.w / 2, r = h.x + h.w / 2, top = h.y - h.h;
  const out = [];
  const rows = h.style === 'tall' ? [0.3, 0.68] : h.style === 'cafe' ? [0.36] : [0.5];
  const wh = h.style === 'tall' ? 0.2 : h.style === 'cafe' ? 0.3 : 0.36;
  for (const row of rows) {
    for (let i = 0; i < h.windows; i++) {
      const x = lerp(l, r, h.windows === 1 ? 0.5 : 0.28 + i * 0.44);
      out.push({ x: h.x + h.side * (x - h.x), y: top + h.h * row, w: Math.max(2.5, h.w * 0.13), h: h.h * wh });
    }
  }
  return out;
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

  if (c.style === 'tower') {
    drawBellTower(ctx, rng, c, tl, tr, ttop, sw);
    seam(ctx, rng, [l, top + 1], [r, top + 1], 2.2);
    windowDab(ctx, rng, lerp(tr, r, 0.5), top + c.bodyH * 0.5, 3, c.bodyH * 0.35);
    return;
  }
  if (c.style === 'dome') {
    drawDome(ctx, rng, c, top, sw);
    seam(ctx, rng, [l, top + 1], [r, top + 1], 2.2);
    windowDab(ctx, rng, c.x, top + c.bodyH * 0.5, 3, c.bodyH * 0.35);
    return;
  }

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

/** A square bell tower that rises above the roof and ends in a short pyramid cap. */
function drawBellTower(ctx: Ctx, rng: Rng, c: Church, tl: number, tr: number, ttop: number, sw: number) {
  const tw = tr - tl, top2 = ttop - c.towerH * 1.4, mid = (tl + tr) / 2;
  paintFace(ctx, rng, [[tl - 1, top2], [tr + 1, top2], [tr + 1, ttop + 2], [tl - 1, ttop + 2]], P.wallLight.map((x) => darken(x, 0.05)), Math.PI / 2, sw * 0.9);
  paintFace(ctx, rng, [[tl - 3, top2], [mid, top2 - tw * 0.9], [tr + 3, top2]], P.roofRust, -Math.PI / 2, sw * 0.8);
  windowDab(ctx, rng, mid, top2 + c.towerH * 0.4, tw * 0.25, c.towerH * 0.45);
  seam(ctx, rng, [tl - 3, top2 + 1], [tr + 3, top2 + 1], 2);
}

/** A dome on a drum, with a little lantern on top. */
function drawDome(ctx: Ctx, rng: Rng, c: Church, top: number, sw: number) {
  const R = c.bodyW * 0.32, cy = top - c.bodyH * 0.25;
  paintFace(ctx, rng, [[c.x - R * 0.9, cy], [c.x + R * 0.9, cy], [c.x + R * 0.9, top + 2], [c.x - R * 0.9, top + 2]], P.wallLight, Math.PI / 2, sw * 0.8);
  ctx.fillStyle = 'rgba(31,53,103,1)';
  ctx.beginPath();
  ctx.ellipse(c.x, cy, R, R * 0.95, 0, Math.PI, TAU);
  ctx.fill();
  for (let i = 0; i < 14; i++) {
    // Ribs of the dome: arcs from the drum up to the crown.
    const u = rng.range(-0.9, 0.9), pts: Pt[] = [];
    for (let j = 0; j <= 4; j++) {
      const a = Math.PI + (Math.PI / 2) * (j / 4);
      pts.push([c.x + u * R * Math.cos(a - Math.PI) * -1 * (1 - j / 5), cy - Math.sin(a - Math.PI) * R * 0.95 * (j / 4)]);
    }
    stroke(ctx, rng, pts, sw * 0.8, jitter(rng.pick(u > 0.3 ? P.roofGreen : P.roofBlue), rng, 16));
  }
  paintFace(ctx, rng, [[c.x - R * 0.15, cy - R * 1.2], [c.x + R * 0.15, cy - R * 1.2], [c.x + R * 0.15, cy - R * 0.85], [c.x - R * 0.15, cy - R * 0.85]], P.wallLight, Math.PI / 2, sw * 0.5);
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

function drawPine(ctx: Ctx, rng: Rng, t: Tree) {
  // Umbrella pine: a bare, leaning trunk under a flat, wide canopy.
  const lean = rng.range(-0.25, 0.25), trunkTop = t.y - t.r * 2.2, cx = t.x + lean * t.r * 2;
  for (let i = 0; i < 3; i++) {
    stroke(ctx, rng, [[t.x + rng.range(-2, 2), t.y], [lerp(t.x, cx, 0.5) + rng.range(-2, 2), (t.y + trunkTop) / 2], [cx + rng.range(-2, 2), trunkTop]], rng.range(3, 4.5), jitter(rng.pick(P.mill), rng, 12));
  }
  const rx = t.r * 1.8, ry = t.r * 0.55, cy = trunkTop - ry * 0.4;
  fillPoly(ctx, blob(rng, cx, cy, rx, ry), P.pineDark[0]);
  const n = Math.round((rx * ry) / 8);
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, TAU), rr = Math.sqrt(rng.random()) * 0.97;
    const ox = Math.cos(a) * rr, oy = Math.sin(a) * rr, x = cx + ox * rx, y = cy + oy * ry;
    const pal = -oy + rng.range(-0.5, 0.5) > 0.3 ? P.pineLight : P.pineDark;
    stroke(ctx, rng, [[x - 6, y + rng.range(-1, 1)], [x, y + rng.range(-1.5, 1.5)], [x + 6, y + rng.range(-1, 1)]], rng.range(3.5, 5.5), jitter(rng.pick(pal), rng, 14));
  }
}

function drawSunflower(ctx: Ctx, rng: Rng, t: Tree) {
  // A tall stem with broad leaves, and a big head of radiating petals around a dark seeded eye.
  const hh = t.r * 3.4, lean = rng.range(-0.35, 0.35), hx = t.x + lean * t.r, hy = t.y - hh, R = t.r * 0.95;
  for (let i = 0; i < 2; i++) {
    stroke(ctx, rng, [[t.x + rng.range(-1, 1), t.y], [lerp(t.x, hx, 0.5) + rng.range(-1.5, 1.5), (t.y + hy) / 2], [hx, hy]], rng.range(3, 4.4), jitter(rng.pick(P.sunStem), rng, 12));
  }
  for (let i = 0; i < 2; i++) {
    const side = i ? 1 : -1, ly = t.y - hh * rng.range(0.25, 0.6);
    stroke(ctx, rng, [[t.x, ly], [t.x + side * R * 0.6, ly - R * 0.25], [t.x + side * R * 1.15, ly + R * 0.1]], rng.range(4.5, 6.5), jitter(rng.pick(P.sunStem), rng, 18));
  }
  // The head is a touch oval, tilted toward the lean; petals first, ragged and overlapping.
  const n = 16, tilt = lean * 0.6;
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + ring * 0.2 + rng.range(-0.1, 0.1), len = R * (ring ? 0.8 : 1) * rng.range(0.85, 1.1);
      const ca = Math.cos(a), sa = Math.sin(a), x0 = hx + ca * R * 0.35, y0 = hy + sa * R * 0.3 * (1 + tilt * 0.3);
      const pal = ca + sa < -0.4 ? P.sunPetalLit : P.sunPetal;
      stroke(ctx, rng, [[x0, y0], [hx + ca * len * 0.7, hy + sa * len * 0.62], [hx + ca * len + rng.range(-1, 1), hy + sa * len * 0.85]], rng.range(3.4, 5), jitter(rng.pick(pal), rng, 16));
    }
  }
  fillPoly(ctx, blob(rng, hx, hy, R * 0.42, R * 0.38), P.sunCore[2]);
  for (let i = 0, m = Math.round(R * 1.2); i < m; i++) {
    const a = rng.range(0, TAU), rr = Math.sqrt(rng.random()) * 0.4, x = hx + Math.cos(a) * R * rr, y = hy + Math.sin(a) * R * rr * 0.9;
    stroke(ctx, rng, [[x - 1.5, y], [x + 1.5, y + rng.range(-0.6, 0.6)]], rng.range(2.6, 3.8), jitter(rng.pick(P.sunCore), rng, 12));
  }
}

/** A crow in flight, wings raised by `flap` (-1..1), facing `dir`. Used by the animation layer and for stills. */
export function drawCrow(ctx: Ctx, rng: Rng, x: number, y: number, size: number, flap: number, dir: 1 | -1) {
  const wing = size * 1.15, lift = flap * size * 0.7;
  const body: Pt[] = [[x - dir * size * 0.5, y + size * 0.06], [x, y], [x + dir * size * 0.5, y - size * 0.05]];
  stroke(ctx, rng, body, size * 0.5, jitter(rng.pick(P.crow), rng, 8));
  for (const side of [-1, 1]) {
    const tip: Pt = [x + side * wing, y - lift - size * 0.1], mid: Pt = [x + side * wing * 0.5, y - lift * 0.55 - size * 0.32];
    stroke(ctx, rng, [[x + side * size * 0.1, y - size * 0.05], mid, tip], size * 0.36, jitter(rng.pick(P.crow), rng, 8));
  }
  stroke(ctx, rng, [[x + dir * size * 0.5, y - size * 0.05], [x + dir * size * 0.75, y - size * 0.02]], size * 0.2, P.crow[3]);
}

function drawIris(ctx: Ctx, rng: Rng, t: Tree) {
  // A clump of sword-shaped leaves with violet flowers among them.
  const n = rng.int(9, 15);
  for (let i = 0; i < n; i++) {
    const bx = t.x + rng.range(-t.r, t.r), len = t.r * rng.range(1.2, 2.2), bend = rng.range(-0.6, 0.6);
    const pts: Pt[] = [[bx, t.y], [bx + bend * len * 0.2, t.y - len * 0.5], [bx + bend * len * 0.55, t.y - len]];
    stroke(ctx, rng, pts, rng.range(3, 4.5), jitter(rng.pick(P.irisLeaf), rng, 14));
  }
  for (let i = 0, m = rng.int(3, 6); i < m; i++) {
    const fx = t.x + rng.range(-t.r, t.r), fy = t.y - t.r * rng.range(1.1, 2);
    for (let k = 0; k < 3; k++) {
      const a = rng.range(0, TAU);
      stroke(ctx, rng, [[fx, fy], [fx + Math.cos(a) * 5, fy + Math.sin(a) * 4]], rng.range(4, 5.5), jitter(rng.pick(P.irisFlower), rng, 18));
    }
    stroke(ctx, rng, [[fx, fy - 1], [fx + 1, fy]], 2.2, P.window[2]);
  }
}

function drawStack(ctx: Ctx, rng: Rng, s: Haystack) {
  // A haystack: a rounded dome built from curved golden strokes, moonlit along the top.
  stroke(ctx, rng, [[s.x - s.w * 0.6, s.y + 2], [s.x, s.y + 4], [s.x + s.w * 0.6, s.y + 2]], s.w * 0.18, jitter(P.seam[0], rng, 8));
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI + (Math.PI * i) / 16;
    pts.push([s.x + Math.cos(a) * s.w * 0.5, s.y + Math.sin(a) * s.h * (1 + 0.15 * Math.sin(a * 2))]);
  }
  fillPoly(ctx, pts, P.hay[2]);
  const n = Math.round((s.w * s.h) / 22);
  for (let i = 0; i < n; i++) {
    const u = rng.range(-0.95, 0.95), v = rng.random() * Math.sqrt(1 - u * u);
    const x = s.x + u * s.w * 0.5, y = s.y - v * s.h * 0.95;
    const a = Math.atan2(-v, u) + Math.PI / 2 + rng.range(-0.3, 0.3);
    const len = rng.range(6, 11);
    const pal = v > 0.6 && u < 0.3 ? P.hayLit : P.hay;
    stroke(ctx, rng, [[x - Math.cos(a) * len / 2, y - Math.sin(a) * len / 2], [x + Math.cos(a) * len / 2, y + Math.sin(a) * len / 2]], rng.range(3, 4.5), jitter(rng.pick(pal), rng, 18));
  }
}

function drawLamp(ctx: Ctx, rng: Rng, l: Lamp) {
  // A gaslight: a dark post and a bright lantern; the animation layer adds its glow.
  const top = l.y - l.h;
  stroke(ctx, rng, [[l.x, l.y], [l.x + rng.range(-0.5, 0.5), (l.y + top) / 2], [l.x, top]], 2.6, rng.pick(P.post));
  const g = ctx.createRadialGradient(l.x, top, 0, l.x, top, l.h * 0.7);
  g.addColorStop(0, 'rgba(255,220,120,0.55)');
  g.addColorStop(1, 'rgba(255,200,90,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(l.x, top, l.h * 0.7, 0, TAU);
  ctx.fill();
  stroke(ctx, rng, [[l.x, top - 3], [l.x, top + 3]], 5, P.window[2]);
  stroke(ctx, rng, [[l.x, top - 1], [l.x, top + 1]], 2.5, [255, 250, 220]);
}

function drawBoat(ctx: Ctx, rng: Rng, b: Boat) {
  // A rowing boat pulled up at the water's edge: a curved hull and a bright gunwale.
  const half = b.w / 2, d = b.dir;
  const hull: Pt[] = [[b.x - half * d, b.y - b.w * 0.12], [b.x, b.y + b.w * 0.08], [b.x + half * d, b.y - b.w * 0.2]];
  const col = P.boat[Math.floor(b.hue * P.boat.length)];
  for (let i = 0; i < 3; i++) stroke(ctx, rng, hull.map(([x, y]) => [x, y + i * 2.5] as Pt), b.w * 0.12, jitter(darken(col, i * 0.15), rng, 14));
  stroke(ctx, rng, hull.map(([x, y]) => [x, y - 2] as Pt), 2.4, lighten(col, 0.45));
}

function drawMill(ctx: Ctx, rng: Rng, m: Mill) {
  // The tower of a windmill: a tapering body with a cap. The turning sails are added by the animation layer.
  const bw = m.w, tw = m.w * 0.62, top = m.y - m.h;
  const pal = m.warm ? P.millWarm : P.mill;
  stroke(ctx, rng, [[m.x - bw * 0.8, m.y + 2], [m.x, m.y + 4], [m.x + bw * 0.8, m.y + 2]], bw * 0.3, jitter(P.seam[0], rng, 8));
  paintFace(ctx, rng, [[m.x - tw / 2, top], [m.x + tw / 2, top], [m.x + bw / 2, m.y], [m.x - bw / 2, m.y]], pal, Math.PI / 2, Math.max(3, bw * 0.16));
  paintFace(ctx, rng, [[m.x + tw * 0.1, top], [m.x + tw / 2, top], [m.x + bw / 2, m.y], [m.x + bw * 0.15, m.y]], pal.map((c) => darken(c, 0.3)), Math.PI / 2, Math.max(3, bw * 0.14), 1);
  paintFace(ctx, rng, [[m.x - tw * 0.7, top + 2], [m.x, top - m.h * 0.16], [m.x + tw * 0.7, top + 2]], P.roofBlue, 0, Math.max(3, bw * 0.14));
  windowDab(ctx, rng, m.x - bw * 0.1, m.y - m.h * 0.18, Math.max(2.5, bw * 0.12), m.h * 0.1);
  windowDab(ctx, rng, m.x, top + m.h * 0.3, Math.max(2, bw * 0.08), m.h * 0.06);
}

/** Where a windmill's sails are hung, shared with the animation layer that turns them. */
export function millHub(m: Mill): Pt {
  return [m.x, m.y - m.h * 0.92];
}

function drawTree(ctx: Ctx, rng: Rng, t: Tree, season: Season) {
  if (t.kind === 'pine') return drawPine(ctx, rng, t);
  if (t.kind === 'iris') return drawIris(ctx, rng, t);
  if (t.kind === 'sunflower') return drawSunflower(ctx, rng, t);
  const poplar = t.kind === 'poplar', olive = t.kind === 'olive';
  const rx = t.r * (poplar ? 0.55 : olive ? 1.25 : 1), ry = t.r * (poplar ? 2.1 : olive ? 0.65 : 0.9), cy = t.y - ry * 0.8;
  const { dark, mid, light } = treeSeason(season, t.kind, olive ? { dark: P.treeDark, mid: P.treeMid, light: P.treeLight } : { dark: P.bushDark, mid: P.bushMid, light: P.bushLight });
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
  const { houses, churches, trees, mills, stacks, lamps, boats } = p.near;
  const add = (x: number, reach: number, y: number, id: number, draw: (ctx: Ctx, rng: Rng) => void) => {
    if (!inPad(p, x, reach)) return;
    // Back to front: farther (higher on the canvas) things are drawn first.
    p.items.push({ layer: L.VILLAGE, key: y + hashFloat(id) * 0.01, op: (ctx) => draw(ctx, new Rng(id)) });
  };
  for (const h of houses) add(h.x, h.w + h.depth + 10, h.y, h.id, (ctx, rng) => drawHouse(ctx, rng, h));
  for (const c of churches) add(c.x, c.bodyW + 20, c.base, c.id, (ctx, rng) => drawChurch(ctx, rng, c));
  for (const t of trees) add(t.x, t.r * (t.kind === 'sunflower' ? 3.4 : 2.2) + 20, t.y, t.id, (ctx, rng) => drawTree(ctx, rng, t, p.world.season));
  for (const m of mills) add(m.x, m.w + 10, m.y, m.id, (ctx, rng) => drawMill(ctx, rng, m));
  for (const s of stacks) add(s.x, s.w + 10, s.y, s.id, (ctx, rng) => drawStack(ctx, rng, s));
  for (const l of lamps) add(l.x, l.h + 10, l.y, l.id, (ctx, rng) => drawLamp(ctx, rng, l));
  for (const b of boats) add(b.x, b.w + 10, b.y, b.id, (ctx, rng) => drawBoat(ctx, rng, b));
}
