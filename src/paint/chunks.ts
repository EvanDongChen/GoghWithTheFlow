// Plans and progressively paints world chunks into their own offscreen canvases.
import { Rng } from '../core/rng';
import { CW, H, World } from '../world/world';
import { planCypresses } from './cypress';
import { planLand } from './land';
import type { ChunkPlan, Op } from './plan';
import { planSky } from './sky';
import { planVillage } from './village';

const PAD = 48;

export function planChunk(world: World, c: number): Op[] {
  const p: ChunkPlan = { world, c, x0: c * CW, x1: (c + 1) * CW, pad: PAD, near: world.near(c), items: [] };
  planSky(p);
  planLand(p);
  planVillage(p);
  planCypresses(p);
  p.items.sort((a, b) => a.layer - b.layer || a.key - b.key);
  const ops = p.items.map((i) => i.op);
  ops.push((ctx) => weave(ctx, p.x0, p.x1));
  return ops;
}

let weaveTile: HTMLCanvasElement | null = null;

/** Canvas-weave texture. The pattern is anchored to world coordinates, so it tiles across chunks. */
function weave(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
  if (!weaveTile) {
    const rng = new Rng(12345);
    weaveTile = document.createElement('canvas');
    weaveTile.width = weaveTile.height = 64;
    const tc = weaveTile.getContext('2d')!, img = tc.createImageData(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const v = 128 + (((x >> 1) + (y >> 1)) & 1 ? 6 : -6) + (rng.random() - 0.5) * 36;
        const i = (y * 64 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    tc.putImageData(img, 0, 0);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = ctx.createPattern(weaveTile, 'repeat')!;
  ctx.fillRect(x0, 0, x1 - x0, H);
  ctx.restore();
}

export class Chunk {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  ops: Op[] | null = null;
  i = 0;
  lastUsed = 0;

  constructor(readonly c: number, readonly px: number, readonly scale: number) {
    this.canvas.width = px;
    this.canvas.height = Math.round(H * scale);
    this.ctx = this.canvas.getContext('2d')!;
  }

  get done() { return !!this.ops && this.i >= this.ops.length; }
  get progress() { return this.ops ? this.i / this.ops.length : 0; }
  get started() { return this.i > 0; }
}

export class ChunkPainter {
  readonly scale: number;
  /** Pixel width of one chunk canvas; scale is snapped so this is a whole number. */
  readonly chunkPx: number;
  private chunks = new Map<number, Chunk>();
  private clock = 0;

  constructor(readonly world: World, scale: number) {
    this.chunkPx = Math.round(CW * scale);
    this.scale = this.chunkPx / CW;
  }

  get(c: number): Chunk {
    let ch = this.chunks.get(c);
    if (!ch) {
      ch = new Chunk(c, this.chunkPx, this.scale);
      this.chunks.set(c, ch);
    }
    ch.lastUsed = ++this.clock;
    return ch;
  }

  peek(c: number): Chunk | undefined {
    return this.chunks.get(c);
  }

  /** Paint wanted chunks in priority order for up to budgetMs. Returns true if anything changed. */
  work(wanted: number[], budgetMs: number): boolean {
    const t0 = performance.now();
    let changed = false;
    for (const c of wanted) {
      const ch = this.get(c);
      if (ch.done) continue;
      if (!ch.ops) {
        ch.ops = planChunk(this.world, c);
        ch.ctx.setTransform(this.scale, 0, 0, this.scale, -c * CW * this.scale, 0);
      }
      while (ch.i < ch.ops.length) {
        ch.ops[ch.i++](ch.ctx);
        changed = true;
        if ((ch.i & 7) === 0 && performance.now() - t0 > budgetMs) return true;
      }
      if (performance.now() - t0 > budgetMs) return changed;
    }
    return changed;
  }

  /** Keep at most `max` chunks, dropping the least recently wanted ones. */
  evict(max = 14) {
    if (this.chunks.size <= max) return;
    const sorted = [...this.chunks.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const ch of sorted.slice(0, this.chunks.size - max)) {
      ch.canvas.width = ch.canvas.height = 0;
      this.chunks.delete(ch.c);
    }
  }

  dispose() {
    for (const ch of this.chunks.values()) ch.canvas.width = ch.canvas.height = 0;
    this.chunks.clear();
  }
}
