// Impasto brush: thick strokes with shadow, bristle streaks and a highlight ridge.
import { css, darken, lighten, type RGB } from './color';
import type { Rng } from './rng';

export type Pt = [number, number];
export type Ctx = CanvasRenderingContext2D;
export type Field = (x: number, y: number) => Pt;

/** Smooth path through points using midpoint quadratic curves. */
function pathOf(ctx: Ctx, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1];
  ctx.lineTo(l[0], l[1]);
}

/** Shift a polyline sideways along its normal by distance d. */
function offset(pts: Pt[], d: number): Pt[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [p[0] - (ty / l) * d, p[1] + (tx / l) * d];
  });
}

/** Drop a point from either end so streaks look shorter than the body. */
function trim(pts: Pt[], rng: Rng): Pt[] {
  if (pts.length < 4) return pts;
  return pts.slice(rng.chance(0.5) ? 1 : 0, pts.length - (rng.chance(0.5) ? 1 : 0));
}

export function stroke(ctx: Ctx, rng: Rng, pts: Pt[], w: number, col: RGB) {
  if (pts.length < 2) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.lineWidth = w * 1.1;
  ctx.strokeStyle = css(darken(col, 0.5), 0.3);
  pathOf(ctx, offset(pts, w * 0.22));
  ctx.stroke();

  ctx.lineWidth = w;
  ctx.strokeStyle = css(col);
  pathOf(ctx, pts);
  ctx.stroke();

  const n = w > 6 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const light = rng.chance(0.55);
    ctx.lineWidth = Math.max(0.7, w * rng.range(0.1, 0.22));
    ctx.strokeStyle = css(light ? lighten(col, rng.range(0.12, 0.3)) : darken(col, rng.range(0.1, 0.28)), rng.range(0.4, 0.7));
    pathOf(ctx, offset(trim(pts, rng), rng.range(-0.38, 0.38) * w));
    ctx.stroke();
  }

  ctx.lineWidth = Math.max(0.6, w * 0.14);
  ctx.strokeStyle = css(lighten(col, 0.4), 0.35);
  pathOf(ctx, offset(pts, -w * 0.28));
  ctx.stroke();
}

/** Plain line, used for outlines. */
export function line(ctx: Ctx, pts: Pt[], w: number, col: RGB, alpha?: number) {
  if (pts.length < 2) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = w;
  ctx.strokeStyle = css(col, alpha);
  pathOf(ctx, pts);
  ctx.stroke();
}

export function fillPoly(ctx: Ctx, pts: Pt[], col: RGB, alpha?: number) {
  ctx.fillStyle = css(col, alpha);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

/** Trace a stroke through a vector field, centered on (x, y). */
export function trace(field: Field, x: number, y: number, len: number, steps: number): Pt[] {
  const h = len / steps, half = Math.max(1, Math.floor(steps / 2));
  const back: Pt[] = [], fwd: Pt[] = [[x, y]];
  let px = x, py = y;
  for (let i = 0; i < half; i++) {
    const v = field(px, py);
    px -= v[0] * h; py -= v[1] * h;
    back.push([px, py]);
  }
  px = x; py = y;
  for (let i = 0; i < steps - half; i++) {
    const v = field(px, py);
    px += v[0] * h; py += v[1] * h;
    fwd.push([px, py]);
  }
  return back.reverse().concat(fwd);
}

/** Break a polyline into wobbly segments of roughly segLen. */
export function wobble(pts: Pt[], rng: Rng, amt: number, segLen: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / segLen));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      out.push([a[0] + (b[0] - a[0]) * t + rng.range(-amt, amt), a[1] + (b[1] - a[1]) * t + rng.range(-amt, amt)]);
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}
