// The night sky: a flow field of swirls along a wavy ribbon, haloed stars and crescent moons.
import { trace, type Field, type Pt } from '../core/brush';
import { css, jitter, palette } from '../core/color';
import { clamp, dist, lerp, smoothstep, TAU } from '../core/math';
import { hash, hashFloat, Rng } from '../core/rng';
import { H, World, type Glow } from '../world/world';
import { cellRange, inPad, L, strokeItem, type ChunkPlan } from './plan';

const P = palette({
  deep: ['#152a63', '#1b3577', '#22408a', '#1a2f6e'],
  mid: ['#2f58a0', '#3a66ad', '#4673b8', '#3560a6'],
  light: ['#6e98cc', '#86abd6', '#9fbedd', '#7aa3c9'],
  pale: ['#c4d8e0', '#dce6dc', '#b2cbd9', '#e8edd2'],
  teal: ['#5f95a6', '#7aaaa8', '#4e86a0'],
  dark: ['#101f4a', '#14275a', '#0e1c44'],
  yellow: ['#f4d24a', '#f6df6e', '#eec23a'],
  cream: ['#fbf1b8', '#fff8d8', '#f6eaa0'],
  leaf: ['#cbd88a', '#b9cf8c', '#dfe39a'],
  orange: ['#e99a2c', '#f0ae3c', '#dd8a25'],
});
type Key = keyof typeof P;

const STAR_RINGS: Key[] = ['cream', 'yellow', 'cream', 'leaf', 'yellow', 'pale', 'light', 'leaf', 'light', 'pale', 'light'];
const MOON_RINGS: Key[] = ['yellow', 'orange', 'yellow', 'cream', 'orange', 'yellow', 'leaf', 'cream', 'light', 'pale', 'light', 'light'];

const SP = 8.5;
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
      const dx = x - o.x, dy = y - o.y, r = Math.hypot(dx, dy) || 1e-3;
      const f = 3.2 * Math.exp(-(r * r) / (o.R * o.R));
      if (f < 1e-4) continue;
      vx += f * ((-dy / r) * o.dir - (0.18 * dx) / r);
      vy += f * ((dx / r) * o.dir - (0.18 * dy) / r);
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
function colorKey(w: World, x: number, y: number, rng: Rng): Key {
  const near = w.near(World.chunkOf(x));
  for (const g of near.glows) {
    const r = dist(x, y, g.x, g.y);
    if (r > g.halo * 1.1) continue;
    if (r < g.core) {
      if (g.kind === 'moon') return inCrescent(g, x, y) ? 'yellow' : 'orange';
      return rng.chance(0.6) ? 'cream' : 'yellow';
    }
    const rings = g.kind === 'moon' ? MOON_RINGS : STAR_RINGS;
    return rings[Math.min(rings.length - 1, Math.floor((r - g.core) / g.ringW))];
  }

  for (const o of near.vortices) {
    const r = dist(x, y, o.x, o.y);
    const wgt = 1 - smoothstep(o.R * 0.75, o.R * 1.1, r);
    if (wgt <= 0 || rng.random() > wgt) continue;
    if (r < o.R * 0.15) return rng.chance(0.5) ? 'pale' : 'cream';
    const ang = Math.atan2(y - o.y, x - o.x);
    const phase = r / (o.R * 0.2) + (o.dir * ang) / TAU * 2;
    const f = phase - Math.floor(phase);
    return f < 0.25 ? 'pale' : f < 0.5 ? 'light' : f < 0.75 ? 'mid' : f < 0.88 ? 'teal' : 'dark';
  }

  const bd = Math.abs(y - w.bandY(x)) / w.bandWidth;
  if (bd < 1 && rng.random() < (1 - bd) * 0.9) {
    const bn = w.noise.noise2(x * 0.01 + 7, y * 0.01);
    return bn > 0.15 ? 'pale' : bn > -0.2 ? 'light' : 'teal';
  }

  const t = clamp(y / w.horizon, 0, 1) + 0.25 * w.noise.noise2(x * 0.004 + 50, y * 0.004);
  const u = rng.random();
  if (u < 0.05) return 'dark';
  if (t < 0.3) return u < 0.7 ? 'deep' : 'mid';
  if (t < 0.65) return u < 0.25 ? 'deep' : u < 0.8 ? 'mid' : 'light';
  return u < 0.15 ? 'mid' : u < 0.6 ? 'light' : u < 0.8 ? 'pale' : 'teal';
}

export function planSky(p: ChunkPlan) {
  const w = p.world;
  const bottom = w.horizon + H * 0.17;

  p.items.push({
    layer: L.SKY_BASE, key: 0, op: (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, bottom);
      g.addColorStop(0, '#16296a');
      g.addColorStop(0.55, '#2f58a0');
      g.addColorStop(1, '#6e98cc');
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
      const col = jitter(r.pick(P[colorKey(w, px, py, r)]), r, 22);
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
      p.items.push(strokeItem(L.GLOW, rng.random(), seed, pts, width, jitter(rng.pick(P[key]), rng, 18)));
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
