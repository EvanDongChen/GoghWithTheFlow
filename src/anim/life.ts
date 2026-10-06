// The living painting: an animation layer drawn over the finished brushwork each frame.
//
//  - Brush strokes stream along the same flow field the sky was painted with, so the swirls
//    visibly turn and the bright band drifts.
//  - Star and moon halos shimmer: arcs of paint circle them and their cores breathe.
//  - Village windows flicker like candlelight.
//  - Now and then a shooting star crosses the sky.
//  - Windmill sails turn, gaslights flicker and their reflections shimmer on the river.
//
// Everything lives in world coordinates, so it works the same in the gallery and while wandering.

import { css, lighten, type RGB } from '../core/color';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { Field } from '../core/brush';
import { skyColor, skyField } from '../paint/sky';
import { houseWindows, millHub } from '../paint/village';
import { cypressCovers, World, type Glow, type Mill } from '../world/world';

interface Particle {
  x: number; y: number;
  /** Recent positions, oldest first, as flat x,y pairs. */
  trail: number[];
  age: number; life: number; speed: number; w: number; col: RGB;
}

interface Shooter { x: number; y: number; vx: number; vy: number; age: number; life: number; }

/** Maps world coordinates to canvas pixels. */
export interface View { x0: number; x1: number; scale: number; offsetX: number; }

const TRAIL_STEP = 5;
const TRAIL_POINTS = 7;

function glowSprite(rgb: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!, rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, `rgba(${rgb},1)`);
  rg.addColorStop(0.35, `rgba(${rgb},0.45)`);
  rg.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  return c;
}

const STAR_ARC: RGB[] = [[251, 241, 184], [246, 223, 110], [236, 235, 176], [220, 230, 220], [255, 248, 216]];

export class Life {
  private field: Field;
  private ps: Particle[] = [];
  private rng = new Rng((Math.random() * 2 ** 32) >>> 0);
  private t = 0;
  private shooter: Shooter | null = null;
  private nextShooter = 6 + Math.random() * 8;
  private warm = glowSprite('255,214,110');
  private white = glowSprite('255,250,225');

  constructor(private world: World) {
    this.field = skyField(world);
  }

  private inSky(x: number, y: number) {
    if (y < 0 || y > this.world.ridgeBack(x) - 4) return false;
    const near = this.world.near(World.chunkOf(x));
    return !near.cypresses.some((c) => cypressCovers(c, this.world.noise, x, y, 2));
  }

  private spawn(x0: number, x1: number): Particle | null {
    const r = this.rng;
    for (let tries = 0; tries < 6; tries++) {
      const x = r.range(x0, x1), y = r.range(0, this.world.ridgeBack(x));
      if (!this.inSky(x, y)) continue;
      const col = lighten(skyColor(this.world, x, y, r), r.range(0.15, 0.35));
      return { x, y, trail: [x, y], age: 0, life: r.range(2.5, 6), speed: r.range(30, 70), w: r.range(3.5, 6), col };
    }
    return null;
  }

  update(dt: number, view: View) {
    this.t += dt;
    const margin = 60, x0 = view.x0 - margin, x1 = view.x1 + margin;
    const target = Math.round(clamp((x1 - x0) * 0.65, 150, 1500));

    // Retire particles that aged out, left the sky or scrolled away; then top back up.
    this.ps = this.ps.filter((p) => p.age < p.life && p.x > x0 - 40 && p.x < x1 + 40 && this.inSky(p.x, p.y));
    for (let i = 0; this.ps.length < target && i < 60; i++) {
      const p = this.spawn(x0, x1);
      if (p) this.ps.push(p);
    }

    for (const p of this.ps) {
      p.age += dt;
      const v = this.field(p.x, p.y);
      p.x += v[0] * p.speed * dt;
      p.y += v[1] * p.speed * dt;
      const lx = p.trail[p.trail.length - 2], ly = p.trail[p.trail.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) >= TRAIL_STEP) {
        p.trail.push(p.x, p.y);
        if (p.trail.length > TRAIL_POINTS * 2) p.trail.splice(0, 2);
      }
    }

    this.nextShooter -= dt;
    if (!this.shooter && this.nextShooter <= 0) {
      const r = this.rng, dir = r.chance(0.5) ? 1 : -1, speed = r.range(700, 1000), a = r.range(0.25, 0.5);
      this.shooter = { x: r.range(x0 + 100, x1 - 100), y: r.range(40, 260), vx: Math.cos(a) * speed * dir, vy: Math.sin(a) * speed, age: 0, life: r.range(0.7, 1.1) };
      this.nextShooter = r.range(12, 26);
    }
    if (this.shooter) {
      const s = this.shooter;
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.age > s.life) this.shooter = null;
    }
  }

  /** Things in view from every chunk near it, without duplicates. */
  private inView<T extends { id: number; x: number }>(view: View, pick: (n: ReturnType<World['near']>) => T[], margin = 300): T[] {
    const seen = new Set<number>(), out: T[] = [];
    for (let c = World.chunkOf(view.x0) - 1; c <= World.chunkOf(view.x1) + 1; c++) {
      for (const it of pick(this.world.near(c))) {
        if (seen.has(it.id) || it.x < view.x0 - margin || it.x > view.x1 + margin) continue;
        seen.add(it.id);
        out.push(it);
      }
    }
    return out;
  }

  /** Windmill sails: four latticed blades round a hub, turned to `angle`. */
  private drawSails(ctx: CanvasRenderingContext2D, view: View, m: Mill, angle: number) {
    const sx = (x: number) => (x - view.x0) * view.scale + view.offsetX, k = view.scale;
    const [hx, hy] = millHub(m), L = m.sail, wBlade = L * 0.2;
    ctx.save();
    ctx.translate(sx(hx), hy * k);
    ctx.scale(k, k);
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate(angle + (i * Math.PI) / 2);
      // The spar, then the lattice frame of the sail beside it.
      ctx.strokeStyle = 'rgba(42,30,22,0.95)';
      ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L, 0); ctx.stroke();
      ctx.strokeStyle = m.warm ? 'rgba(214,196,150,0.9)' : 'rgba(178,196,214,0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(L * 0.2, 1, L * 0.8, wBlade);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let j = 1; j < 6; j++) { const x = L * 0.2 + (L * 0.8 * j) / 6; ctx.moveTo(x, 1); ctx.lineTo(x, 1 + wBlade); }
      ctx.moveTo(L * 0.2, 1 + wBlade / 2); ctx.lineTo(L, 1 + wBlade / 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#2a1e16';
    ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** The parts of the scene that live outside the baked chunks; drawn even when the painting is still. */
  drawStatic(ctx: CanvasRenderingContext2D, view: View) {
    for (const m of this.inView(view, (n) => n.mills)) this.drawSails(ctx, view, m, m.ph);
  }

  draw(ctx: CanvasRenderingContext2D, view: View) {
    const sx = (x: number) => (x - view.x0) * view.scale + view.offsetX, k = view.scale;
    const chunks: number[] = [];
    for (let c = World.chunkOf(view.x0) - 1; c <= World.chunkOf(view.x1) + 1; c++) chunks.push(c);
    for (const m of this.inView(view, (n) => n.mills)) this.drawSails(ctx, view, m, m.ph + this.t * m.speed);
    const seen = new Set<number>(), glows: Glow[] = [];
    for (const c of chunks) for (const g of this.world.near(c).glows) if (!seen.has(g.id) && g.x > view.x0 - 300 && g.x < view.x1 + 300) { seen.add(g.id); glows.push(g); }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Streaming brush strokes.
    for (const p of this.ps) {
      const n = p.trail.length / 2;
      if (n < 2) continue;
      const fade = Math.sin(Math.PI * clamp(p.age / p.life, 0, 1));
      ctx.strokeStyle = css(p.col, 0.88 * fade);
      ctx.lineWidth = p.w * k;
      ctx.beginPath();
      ctx.moveTo(sx(p.trail[0]), p.trail[1] * k);
      for (let i = 1; i < n; i++) ctx.lineTo(sx(p.trail[i * 2]), p.trail[i * 2 + 1] * k);
      ctx.lineTo(sx(p.x), p.y * k);
      ctx.stroke();
    }

    // Arcs of paint circling each star and moon.
    for (const g of glows) {
      const rings = g.kind === 'moon' ? 6 : 4, ph = (g.id % 1000) / 159;
      for (let i = 0; i < rings; i++) {
        const r = g.core * 1.15 + (i + 0.5) * ((g.halo - g.core * 1.15) / rings);
        const speed = (0.35 + 0.12 * ((i * 7 + g.id) % 5)) * g.dir;
        for (let j = 0; j < 2; j++) {
          const a = ph * (i + 1) + j * Math.PI + this.t * speed;
          ctx.strokeStyle = css(STAR_ARC[(i + j + g.id) % STAR_ARC.length], 0.55);
          ctx.lineWidth = Math.max(2, g.ringW * 0.75) * k;
          ctx.beginPath();
          ctx.arc(sx(g.x), g.y * k, r * k, a, a + 0.9 + 0.3 * Math.sin(this.t * 0.7 + i));
          ctx.stroke();
        }
      }
    }

    ctx.globalCompositeOperation = 'lighter';

    // Breathing cores.
    for (const g of glows) {
      const moon = g.kind === 'moon', ph = g.id % 97;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * (moon ? 0.8 : 1.6 + (ph % 7) * 0.15) + ph);
      const R = (moon ? g.core * 2.4 : g.core * 2.6) * (0.9 + 0.2 * pulse) * k;
      ctx.globalAlpha = (moon ? 0.16 : 0.2) + (moon ? 0.1 : 0.22) * pulse;
      ctx.drawImage(moon ? this.warm : this.white, sx(g.x) - R, g.y * k - R, R * 2, R * 2);
    }

    // Candlelit windows.
    const seenHouse = new Set<number>();
    for (const c of chunks) {
      for (const h of this.world.near(c).houses) {
        if (seenHouse.has(h.id) || h.x < view.x0 - 50 || h.x > view.x1 + 50) continue;
        seenHouse.add(h.id);
        for (const w of houseWindows(h)) {
          const f = 0.55 + 0.25 * Math.sin(this.t * 3.1 + h.id % 13) + 0.2 * Math.sin(this.t * 7.3 + (h.id % 31));
          const R = w.w * 4 * k;
          ctx.globalAlpha = 0.18 * f;
          ctx.drawImage(this.warm, sx(w.x) - R, w.y * k - R, R * 2, R * 2);
        }
      }
    }

    // Gaslights flicker, and their reflections shimmer on the water below.
    for (const l of this.inView(view, (n) => n.lamps, 60)) {
      const f = 0.7 + 0.2 * Math.sin(this.t * 5.3 + (l.id % 17)) + 0.1 * Math.sin(this.t * 11 + (l.id % 7));
      const R = l.h * 1.1 * k, ly = (l.y - l.h) * k;
      ctx.globalAlpha = 0.45 * f;
      ctx.drawImage(this.warm, sx(l.x) - R, ly - R, R * 2, R * 2);
      if (this.world.riverWeight(l.x) < 0.3) continue;
      const y0 = this.world.riverTop(l.x) + 4, y1 = this.world.riverBottom(l.x) - 3;
      ctx.globalAlpha = 0.5 * f;
      ctx.strokeStyle = 'rgba(255,214,110,1)';
      ctx.lineWidth = 2.6 * k;
      ctx.beginPath();
      for (let y = y0, i = 0; y < y1; y += 7, i++) {
        const half = (3 + 8 * ((y - y0) / Math.max(1, y1 - y0))) * (0.6 + 0.4 * Math.sin(this.t * 3 + i * 1.3 + l.id));
        const x = l.x + 3 * Math.sin(this.t * 2.1 + i * 0.9 + (l.id % 5));
        ctx.moveTo(sx(x - half), y * k);
        ctx.lineTo(sx(x + half), y * k);
      }
      ctx.stroke();
    }

    // Shooting star.
    if (this.shooter) {
      const s = this.shooter, f = Math.sin(Math.PI * clamp(s.age / s.life, 0, 1));
      const tail = 0.16, hx = sx(s.x), hy = s.y * k, tx = sx(s.x - s.vx * tail), ty = (s.y - s.vy * tail) * k;
      const grad = ctx.createLinearGradient(tx, ty, hx, hy);
      grad.addColorStop(0, 'rgba(255,250,220,0)');
      grad.addColorStop(1, `rgba(255,250,225,${0.9 * f})`);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3 * k;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      const R = 18 * k;
      ctx.globalAlpha = f;
      ctx.drawImage(this.white, hx - R, hy - R, R * 2, R * 2);
    }
    ctx.restore();
  }
}
