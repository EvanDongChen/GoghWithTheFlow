// Plans a world chunk as an ordered list of draw operations. Runs in a worker or on the page.
import { Rng } from '../core/rng';
import { CW, H, World } from '../world/world';
import { planCypresses } from './cypress';
import { planLand } from './land';
import type { ChunkPlan, Op } from './plan';
import { planSky } from './sky';
import { planVillage } from './village';

const PAD = 48;

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/** A 2D canvas that works both in a worker and on the page. */
export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Brush code is written against the page's context type; an offscreen one has the same drawing API.
 * Chunk canvases are rasterised on the CPU (willReadFrequently): tens of thousands of strokes sent to
 * the GPU would queue up in front of the page's own frames and make scrolling stutter.
 */
export function context2d(c: AnyCanvas): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
}

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

let weaveTile: AnyCanvas | null = null;

/** Canvas-weave texture. The pattern is anchored to world coordinates, so it tiles across chunks. */
function weave(ctx: CanvasRenderingContext2D, x0: number, x1: number) {
  if (!weaveTile) {
    const rng = new Rng(12345);
    weaveTile = makeCanvas(64, 64);
    const tc = context2d(weaveTile), img = tc.createImageData(64, 64);
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
  ctx.fillStyle = ctx.createPattern(weaveTile as CanvasImageSource, 'repeat')!;
  ctx.fillRect(x0, 0, x1 - x0, H);
  ctx.restore();
}

/** Pixel size of a chunk canvas at a render scale; the scale is snapped so the width is whole. */
export function chunkPixels(scale: number) {
  const w = Math.round(CW * scale), s = w / CW;
  return { w, h: Math.round(H * s), scale: s };
}

/**
 * Paints one chunk in time slices, yielding between them. Reports partial images so the
 * painting can be watched as it forms. Shared by the worker and the main-thread fallback.
 */
export async function paintChunk(
  world: World, c: number, scale: number,
  report: (canvas: AnyCanvas, progress: number, strokes: number, done: boolean) => Promise<void> | void,
  sliceMs = 14, reportEveryMs = 160, restMs = 3,
) {
  const { w, h, scale: s } = chunkPixels(scale);
  const canvas = makeCanvas(w, h), ctx = context2d(canvas);
  ctx.setTransform(s, 0, 0, s, -c * CW * s, 0);
  const ops = planChunk(world, c);
  let i = 0, last = performance.now();
  await report(canvas, 0, ops.length, false);
  while (i < ops.length) {
    const t0 = performance.now();
    while (i < ops.length && performance.now() - t0 < sliceMs) ops[i++](ctx);
    if (i < ops.length && performance.now() - last > reportEveryMs) {
      last = performance.now();
      await report(canvas, i / ops.length, ops.length, false);
    }
    // A short rest between slices leaves CPU time for the page to keep animating smoothly.
    await new Promise((r) => setTimeout(r, restMs));
  }
  await report(canvas, 1, ops.length, true);
}
