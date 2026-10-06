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

import { css, hex, jitter, lighten, type RGB } from '../core/color';
import { clamp } from '../core/math';
import { hash, Rng } from '../core/rng';
import { stroke, type Field } from '../core/brush';
import { skyColor, skyField } from '../paint/sky';
import { drawCrow, houseWindows, millHub } from '../paint/village';
import { cypressCovers, World, type Crow, type Glow, type Mill } from '../world/world';

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

// Muted, a touch darker than the sky behind them, like the tower: sails that belong to the picture rather than sit on it.
const SAIL_WARM = ['#a89468', '#bba878', '#8c7a54', '#9d8a60'].map(hex);
const SAIL_COOL = ['#6a7fa2', '#8296b6', '#586c90', '#7389ac'].map(hex);
const SAIL_WOOD = ['#2a1e16', '#382a1e', '#201710', '#443222'].map(hex);

let grain: HTMLCanvasElement | null = null;
/** Light and dark speckle with a weave, for texturing painted sprites. */
function grainTile(): HTMLCanvasElement {
  if (grain) return grain;
  const c = grain = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!, img = g.createImageData(64, 64), rng = new Rng(4242);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = (((x >> 1) + (y >> 1)) & 1 ? 0.12 : -0.12) + (rng.random() - 0.5) * 0.7, i = (y * 64 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v > 0 ? 255 : 0;
      img.data[i + 3] = Math.min(255, Math.abs(v) * 150);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const STAR_ARC: RGB[] = [[251, 241, 184], [246, 223, 110], [236, 235, 176], [220, 230, 220], [255, 248, 216]];

export class Life {
  private field: Field;
  private ps: Particle[] = [];
  private rng = new Rng((Math.random() * 2 ** 32) >>> 0);
  private t = 0;
  /** 0..1: scales the number of streaming strokes; the app lowers it when frames run long. */
  quality = 1;
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
    const target = Math.round(clamp((x1 - x0) * 0.65, 150, 1500) * this.quality);

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

  /**
   * Windmill sails. A wheel is painted once into a sprite with the same impasto brush and canvas
   * grain as the chunks, in the muted tones of the tower, then simply turned each frame. Painting
   * it once (instead of drawing lines every frame) is what lets it sit in the picture.
   */
  private drawSails(ctx: CanvasRenderingContext2D, view: View, m: Mill, angle: number) {
    const sx = (x: number) => (x - view.x0) * view.scale + view.offsetX, k = view.scale;
    const [hx, hy] = millHub(m), sprite = this.wheel(m, k), half = (m.sail + 8) * k;
    ctx.save();
    ctx.translate(sx(hx), hy * k);
    ctx.rotate(angle);
    ctx.drawImage(sprite, -half, -half, half * 2, half * 2);
    ctx.restore();
  }

  private wheels = new Map<number, { k: number; img: HTMLCanvasElement }>();

  /** The painted wheel for a mill at (roughly) this render scale. */
  private wheel(m: Mill, k: number): HTMLCanvasElement {
    const cached = this.wheels.get(m.id);
    if (cached && Math.abs(cached.k - k) / k < 0.15) return cached.img;
    const r0 = m.sail + 8, ks = Math.max(k, 0.8) * 1.5, size = Math.ceil(2 * r0 * ks);
    const img = document.createElement('canvas');
    img.width = img.height = size;
    const g = img.getContext('2d')!;
    g.translate(size / 2, size / 2);
    g.scale(ks, ks);
    const L = m.sail, wBlade = L * 0.22, cloth = m.warm ? SAIL_WARM : SAIL_COOL;
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i * Math.PI) / 2);
      const r = new Rng(hash(m.id, i, 77)), rows = 4, rowH = wBlade / rows;
      // Cloth: broad loose strokes along the blade, each a slightly different tone.
      for (let row = 0; row < rows; row++) {
        for (let seg = 0; seg < 3; seg++) {
          const x0 = L * (0.2 + 0.27 * seg) + r.range(-2.5, 2.5), x1 = x0 + L * 0.3;
          const y = 3 + (row + 0.5) * rowH + r.range(-1, 1);
          stroke(g, r, [[x0, y], [(x0 + x1) / 2, y + r.range(-1.2, 1.2)], [x1, y + r.range(-1, 1)]], rowH * 1.25, jitter(r.pick(cloth), r, 22));
        }
      }
      // Dark lattice and rails, laid over the cloth like Van Gogh's contours.
      for (let j = 0; j < 5; j++) {
        const x = L * (0.22 + 0.19 * j) + r.range(-1.5, 1.5);
        stroke(g, r, [[x, 2.5], [x + r.range(-1, 1), 3 + wBlade * 0.5], [x, 3.5 + wBlade]], 2.4, jitter(r.pick(SAIL_WOOD), r, 10));
      }
      stroke(g, r, [[L * 0.2, 3.8 + wBlade], [L * 0.6, 3.8 + wBlade + r.range(-0.8, 0.8)], [L, 3.8 + wBlade]], 3.2, jitter(r.pick(SAIL_WOOD), r, 10));
      stroke(g, r, [[L * 0.2, 2], [L * 0.6, 2 + r.range(-0.8, 0.8)], [L, 2]], 3.2, jitter(r.pick(SAIL_WOOD), r, 10));
      stroke(g, r, [[2, 0], [L * 0.5, r.range(-0.9, 0.9)], [L, 0]], 4.8, jitter(r.pick(SAIL_WOOD), r, 8));
      g.restore();
    }
    const hr = new Rng(hash(m.id, 78));
    for (let j = 0; j < 4; j++) {
      const t = (j / 4) * Math.PI * 2;
      stroke(g, hr, [[Math.cos(t) * 2.2, Math.sin(t) * 2.2], [Math.cos(t + 1.6) * 2.2, Math.sin(t + 1.6) * 2.2]], 5.4, jitter(hr.pick(SAIL_WOOD), hr, 8));
    }
    // Canvas grain over the paint only (source-atop leaves the transparent surround alone).
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = g.createPattern(grainTile(), 'repeat')!;
    g.fillRect(0, 0, size, size);
    this.wheels.set(m.id, { k, img });
    return img;
  }

  /** Crows wheel in slow loops over their wheat field, flapping as they go. Stills freeze them mid-flight. */
  private drawCrows(ctx: CanvasRenderingContext2D, view: View, live: boolean) {
    const sx = (x: number) => (x - view.x0) * view.scale + view.offsetX, k = view.scale;
    for (const c of this.inView(view, (n) => n.crows, 400) as Crow[]) {
      const a = live ? this.t * 0.22 * c.speed + c.ph : c.ph;
      const cx = c.x + Math.cos(a) * 150 * c.loop, cy = c.y + Math.sin(a * 1.3) * 34 * c.loop;
      // Flapping in bursts, with a glide between.
      const flap = live ? Math.sin(this.t * c.speed * 5 + c.ph) * (0.35 + 0.65 * Math.max(0, Math.sin(this.t * 0.4 + c.ph * 3))) : 0.3;
      ctx.save();
      ctx.translate(sx(cx), cy * k);
      ctx.scale(k, k);
      drawCrow(ctx, new Rng(c.id), 0, 0, c.size, flap, Math.sin(a) > 0 ? -1 : 1);
      ctx.restore();
    }
  }

  /** The parts of the scene that live outside the baked chunks; drawn even when the painting is still. */
  drawStatic(ctx: CanvasRenderingContext2D, view: View) {
    for (const m of this.inView(view, (n) => n.mills)) this.drawSails(ctx, view, m, m.ph);
    this.drawCrows(ctx, view, false);
  }

  draw(ctx: CanvasRenderingContext2D, view: View) {
    const sx = (x: number) => (x - view.x0) * view.scale + view.offsetX, k = view.scale;
    const chunks: number[] = [];
    for (let c = World.chunkOf(view.x0) - 1; c <= World.chunkOf(view.x1) + 1; c++) chunks.push(c);
    for (const m of this.inView(view, (n) => n.mills)) this.drawSails(ctx, view, m, m.ph + this.t * m.speed);
    this.drawCrows(ctx, view, true);
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

    // Arcs of paint circling each star and moon. They live above the baked painting, so any stretch
    // that would fall on a cypress is left out: the tree stays in front of the sky.
    for (const g of glows) {
      const trees = this.world.near(World.chunkOf(g.x)).cypresses;
      const behindTree = (x: number, y: number) => trees.some((c) => cypressCovers(c, this.world.noise, x, y, 3));
      const rings = g.kind === 'moon' ? 6 : 4, ph = (g.id % 1000) / 159;
      for (let i = 0; i < rings; i++) {
        const r = g.core * 1.15 + (i + 0.5) * ((g.halo - g.core * 1.15) / rings);
        const speed = (0.35 + 0.12 * ((i * 7 + g.id) % 5)) * g.dir;
        for (let j = 0; j < 2; j++) {
          const a = ph * (i + 1) + j * Math.PI + this.t * speed;
          ctx.strokeStyle = css(STAR_ARC[(i + j + g.id) % STAR_ARC.length], 0.55);
          ctx.lineWidth = Math.max(2, g.ringW * 0.75) * k;
          const span = 0.9 + 0.3 * Math.sin(this.t * 0.7 + i), steps = Math.max(4, Math.ceil((span * r) / 7));
          ctx.beginPath();
          let pen = false;
          for (let s = 0; s <= steps; s++) {
            const ang = a + (span * s) / steps, px = g.x + Math.cos(ang) * r, py = g.y + Math.sin(ang) * r;
            if (trees.length && behindTree(px, py)) { pen = false; continue; }
            if (pen) ctx.lineTo(sx(px), py * k);
            else { ctx.moveTo(sx(px), py * k); pen = true; }
          }
          ctx.stroke();
        }
      }
    }

    ctx.globalCompositeOperation = 'lighter';

    // Breathing cores.
    for (const g of glows) {
      if (this.world.near(World.chunkOf(g.x)).cypresses.some((c) => cypressCovers(c, this.world.noise, g.x, g.y, 0))) continue;
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
