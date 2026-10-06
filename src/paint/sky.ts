// The night sky: a flow field of swirls along a wavy ribbon, haloed stars and crescent moons.
import { trace, type Field, type Pt } from '../core/brush';
import { css, darken, hex, jitter, lighten, mix, palette, type RGB } from '../core/color';
import { clamp, dist, lerp, smoothstep, TAU } from '../core/math';
import { hash, hashFloat, Rng } from '../core/rng';
import { H, World, type Glow, type Grade } from '../world/world';
import { cellRange, inPad, L, strokeItem, type ChunkPlan } from './plan';

const P = palette({
  deep: ['#1a3585', '#1f3d91', '#24449c', '#173078'],
  mid: ['#2f5fb0', '#3a6cbc', '#4a79c4', '#3464b4'],
  light: ['#7aa5dc', '#8fb5e2', '#a6c4e4', '#6d98d2'],
  pale: ['#d4e2ea', '#e6ecdc', '#c2d6e6', '#f0f0d8'],
  teal: ['#6a9cc0', '#7fb0c8', '#5f92bc'],
  dark: ['#132a6e', '#16307a', '#102563'],
  yellow: ['#f4d24a', '#f6df6e', '#eec23a'],
  cream: ['#fbf1b8', '#fff8d8', '#f6eaa0'],
  leaf: ['#e0e09a', '#d6dc9a', '#ecebb0'],
  orange: ['#f2a93b', '#f7c04a', '#eb9a2e'],
});
type Key = keyof typeof P;

const TINTED = new Set<Key>(['deep', 'mid', 'light', 'pale', 'teal', 'dark']);

/** Shift a blue toward the mood's grade (an indigo night, a rose dawn, a burning dusk); glows keep their gold. */
export function moodTint(g: Grade, c: RGB): RGB {
  if (!g.t && !g.dark && !g.lift) return c;
  let out = c;
  if (g.dark) out = darken(out, g.dark);
  if (g.lift) out = lighten(out, g.lift);
  return mix(out, g.to, g.t);
}

function paint(w: World, x: number, key: Key, rng: Rng, amt: number): RGB {
  const c = jitter(rng.pick(P[key]), rng, amt);
  return TINTED.has(key) ? moodTint(w.gradeAt(x), c) : c;
}

const STAR_RINGS: Key[] = ['cream', 'yellow', 'cream', 'pale', 'leaf', 'pale', 'cream', 'light', 'pale', 'light', 'light'];
const MOON_RINGS: Key[] = ['leaf', 'cream', 'leaf', 'leaf', 'cream', 'leaf', 'pale', 'leaf', 'pale', 'light'];

const SP = 8.5;
/** Swirls are squashed vertically, so they read as rolling waves rather than targets. */
const SQUASH = 1.4;
const LAYER_SKY = 1;

export function skyField(w: World): Field {
  return (x, y) => {
    const near = w.near(World.chunkOf(x));
    const n = w.noise.noise2(x * 0.003, y * 0.003);
    let vx = 1;
    let vy = 0.3 * Math.sin(x * 0.0045 + y * 0.003 + n * 2.2) + 0.35 * n;

    const by = w.bandY(x), d = (y - by) / w.bandWidth;
    const slope = (w.bandY(x + 4) - w.bandY(x - 4)) / 8;
    vy = lerp(vy, slope * 1.4, Math.exp(-d * d));

    for (const o of near.vortices) {
      const dx = x - o.x, dy = y - o.y, r = Math.hypot(dx, dy * SQUASH) || 1e-3;
      const f = 3.2 * Math.exp(-(r * r) / (o.R * o.R));
      if (f < 1e-4) continue;
      // Tangent and inward normal of the ellipse through (x, y).
      const gx = dx, gy = dy * SQUASH * SQUASH, gl = Math.hypot(gx, gy) || 1e-3;
      vx += f * ((-gy / gl) * o.dir - (0.18 * gx) / gl);
      vy += f * ((gx / gl) * o.dir - (0.18 * gy) / gl);
    }
    for (const g of near.glows) {
      const dx = x - g.x, dy = y - g.y, r = Math.hypot(dx, dy) || 1e-3, G = g.halo * 1.25;
      const f = 4 * Math.exp(-(r * r) / (G * G));
      if (f < 1e-4) continue;
      vx += f * ((-dy / r) * g.dir);
      vy += f * ((dx / r) * g.dir);
    }
    const l = Math.hypot(vx, vy) || 1;
    return [vx / l, vy / l];
  };
}

function inCrescent(m: Glow, x: number, y: number) {
  return !!m.cut && dist(x, y, m.x, m.y) < m.core && dist(x, y, m.x + m.cut.dx, m.y + m.cut.dy) > m.cut.r;
}

/** Which palette a sky stroke at (x, y) draws from. */
/** A sky paint colour at (x, y), as the painting would choose it. Used by the animation layer. */
export function skyColor(w: World, x: number, y: number, rng: Rng) {
  return paint(w, x, colorKey(w, x, y, rng), rng, 22);
}

function colorKey(w: World, x: number, y: number, rng: Rng): Key {
  const near = w.near(World.chunkOf(x));
  for (const g of near.glows) {
    const r = dist(x, y, g.x, g.y);
    if (r > g.halo * 1.1) continue;
    if (r < g.core) {
      if (g.kind === 'moon') {
        // A full moon is lit all over; otherwise only the crescent or half is.
        if (g.phase === 'full' || inCrescent(g, x, y)) return rng.chance(0.7) ? 'orange' : 'yellow';
        return rng.chance(0.5) ? 'leaf' : 'pale';
      }
      return rng.chance(0.6) ? 'cream' : 'yellow';
    }
    const rings = g.kind === 'moon' ? MOON_RINGS : STAR_RINGS;
    return rings[Math.min(rings.length - 1, Math.floor((r - g.core) / g.ringW))];
  }

  for (const o of near.vortices) {
    const r = Math.hypot(x - o.x, (y - o.y) * SQUASH);
    const wgt = 1 - smoothstep(o.R * 0.75, o.R * 1.1, r);
    if (wgt <= 0 || rng.random() > wgt) continue;
    if (r < o.R * 0.15) return rng.chance(0.5) ? 'pale' : 'cream';
    const ang = Math.atan2((y - o.y) * SQUASH, x - o.x);
    const phase = r / (o.R * 0.2) + (o.dir * ang) / TAU * 2;
    const f = phase - Math.floor(phase);
    return f < 0.28 ? 'pale' : f < 0.55 ? 'light' : f < 0.8 ? 'mid' : f < 0.9 ? 'teal' : 'deep';
  }

  const bd = Math.abs(y - w.bandY(x)) / w.bandWidth;
  if (bd < 1 && rng.random() < (1 - bd * bd) * 0.95) {
    const bn = w.noise.noise2(x * 0.01 + 7, y * 0.01) + (1 - bd) * 0.3;
    return bn > 0.1 ? 'pale' : bn > -0.25 ? 'light' : 'teal';
  }

  const t = clamp(y / w.horizon, 0, 1) + 0.25 * w.noise.noise2(x * 0.004 + 50, y * 0.004);
  const u = rng.random();
  if (u < 0.025) return 'dark';
  if (t < 0.3) return u < 0.7 ? 'deep' : 'mid';
  if (t < 0.65) return u < 0.25 ? 'deep' : u < 0.8 ? 'mid' : 'light';
  return u < 0.15 ? 'mid' : u < 0.6 ? 'light' : u < 0.8 ? 'pale' : 'teal';
}

export function planSky(p: ChunkPlan) {
  const w = p.world;
  const bottom = w.horizon + H * 0.17;

  p.items.push({
    layer: L.SKY_BASE, key: 0, op: (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, bottom), grade = w.gradeAt((p.x0 + p.x1) / 2);
      g.addColorStop(0, css(moodTint(grade, hex('#16296a'))));
      g.addColorStop(0.55, css(moodTint(grade, hex('#2f58a0'))));
      g.addColorStop(1, css(moodTint(grade, hex('#6e98cc'))));
      ctx.fillStyle = g;
      ctx.fillRect(p.x0 - p.pad, 0, p.x1 - p.x0 + p.pad * 2, bottom);
    },
  });

  const field = skyField(w);
  const [i0, i1] = cellRange(p, SP);
  for (let i = i0; i <= i1; i++) {
    for (let j = -1; j * SP < bottom; j++) {
      const seed = hash(w.s, LAYER_SKY, i, j), r = new Rng(seed);
      const px = (i + r.range(-0.5, 0.5)) * SP, py = (j + r.range(-0.5, 0.5)) * SP;
      if (!inPad(p, px)) continue;
      const col = paint(w, px, colorKey(w, px, py, r), r, 22);
      const pts = trace(field, px, py, r.range(18, 32), 5);
      p.items.push(strokeItem(L.SKY, r.random(), seed, pts, r.range(5, 8), col));
    }
  }

  for (const g of p.near.glows) if (inPad(p, g.x, g.halo + 20)) planGlow(p, g);
}

/** Explicit concentric arcs around a star or moon, painted over the field strokes. */
function planGlow(p: ChunkPlan, g: Glow) {
  const w = p.world;
  let ri = 0;
  for (let r = g.core * 0.35; r < g.halo; r += g.ringW * 0.8, ri++) {
    const seg = clamp(r * 0.9, 6, 26);
    const n = Math.max(3, Math.ceil((TAU * r) / seg));
    const a0 = hashFloat(g.id, ri) * TAU, span = (seg * 1.2) / r;
    for (let i = 0; i < n; i++) {
      const seed = hash(g.id, ri, i), rng = new Rng(seed);
      const a = a0 + (i / n) * TAU + rng.range(-0.1, 0.1);
      const rr = r + rng.range(-0.25, 0.25) * g.ringW;
      const pts: Pt[] = [];
      for (let j = 0; j <= 4; j++) {
        const aj = a + g.dir * span * (j / 4 - 0.5);
        pts.push([g.x + Math.cos(aj) * rr, g.y + Math.sin(aj) * rr]);
      }
      const key = colorKey(w, pts[2][0], pts[2][1], rng);
      const width = clamp(g.ringW * rng.range(0.75, 1.05), 2.5, 8);
      p.items.push(strokeItem(L.GLOW, rng.random(), seed, pts, width, paint(w, pts[2][0], key, rng, 18)));
    }
  }

  if (g.kind === 'star') {
    p.items.push({
      layer: L.GLOW_CORE, key: hashFloat(g.id, 99), op: (ctx) => {
        const rg = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.core * 0.9);
        rg.addColorStop(0, 'rgba(255,253,240,0.95)');
        rg.addColorStop(1, css([250, 236, 160], 0));
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.core * 0.9, 0, TAU);
        ctx.fill();
      },
    });
  }
}
