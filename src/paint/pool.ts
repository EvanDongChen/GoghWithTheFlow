// Hands chunks out to a pool of painting workers and keeps the latest image of each.
// Falls back to painting on the page when workers or OffscreenCanvas aren't available.
import { World } from '../world/world';
import { chunkPixels, paintChunk } from './chunks';
import PaintWorker from './worker?worker&inline';
import type { FromWorker, ToWorker } from './worker';

export interface ChunkImage {
  image: HTMLCanvasElement | null;
  progress: number;
  strokes: number;
  done: boolean;
}

interface Slot { worker: Worker | null; busy: number | null; }

export class ChunkPool {
  readonly scale: number;
  readonly chunkPx: number;
  readonly chunkPy: number;
  private chunks = new Map<number, ChunkImage>();
  private slots: Slot[] = [];
  private local: World | null = null;
  private disposed = false;

  constructor(readonly seed: string, scale: number, private onChange: () => void) {
    const px = chunkPixels(scale);
    this.scale = px.scale;
    this.chunkPx = px.w;
    this.chunkPy = px.h;

    const canWork = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
    // Two workers paint chunks in parallel; more would starve the page's own rendering on smaller machines.
    const n = canWork ? Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 2)) : 0;
    for (let i = 0; i < n; i++) {
      try {
        const worker = new PaintWorker();
        worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(slot, e.data);
        worker.onerror = () => this.fallBack();
        const slot: Slot = { worker, busy: null };
        this.send(slot, { type: 'init', seed, scale: this.scale });
        this.slots.push(slot);
      } catch {
        break;
      }
    }
    if (!this.slots.length) this.fallBack();
  }

  get(c: number): ChunkImage | undefined {
    return this.chunks.get(c);
  }

  /** Make sure the wanted chunks (in priority order) are painting or painted. */
  request(wanted: number[]) {
    for (const slot of this.slots) {
      if (slot.busy !== null) continue;
      const c = wanted.find((k) => !this.chunks.has(k));
      if (c === undefined) return;
      this.chunks.set(c, { image: null, progress: 0, strokes: 0, done: false });
      slot.busy = c;
      if (slot.worker) this.send(slot, { type: 'paint', c });
      else this.paintHere(slot, c);
    }
  }

  /** Free images of chunks outside `keep` that aren't being painted. */
  evict(keep: (c: number) => boolean) {
    const busy = new Set(this.slots.map((s) => s.busy));
    for (const [c, ch] of this.chunks) {
      if (keep(c) || busy.has(c)) continue;
      if (ch.image) ch.image.width = ch.image.height = 0;
      this.chunks.delete(c);
    }
  }

  dispose() {
    this.disposed = true;
    for (const s of this.slots) s.worker?.terminate();
    this.evict(() => false);
  }

  private send(slot: Slot, msg: ToWorker) {
    slot.worker!.postMessage(msg);
  }

  private receive(slot: Slot, msg: FromWorker) {
    if (this.disposed) {
      if (msg.type === 'frame') msg.bitmap.close();
      return;
    }
    if (msg.type === 'error') {
      console.warn(`chunk ${msg.c} failed in worker:`, msg.message);
      this.chunks.delete(msg.c);
      slot.busy = null;
      return;
    }
    // Copy the bitmap into a plain canvas once. Redrawing worker bitmaps every frame is unreliable
    // in some Chrome compositing paths, while page canvases are always safe to draw.
    const prev = this.chunks.get(msg.c);
    const image = prev?.image ?? document.createElement('canvas');
    if (image.width !== this.chunkPx) { image.width = this.chunkPx; image.height = this.chunkPy; }
    const ctx = image.getContext('2d')!;
    ctx.clearRect(0, 0, image.width, image.height);
    ctx.drawImage(msg.bitmap, 0, 0);
    msg.bitmap.close();
    this.chunks.set(msg.c, { image, progress: msg.progress, strokes: msg.strokes, done: msg.done });
    if (msg.done) slot.busy = null;
    this.onChange();
  }

  /** Replace workers with main-thread painting slots. */
  private fallBack() {
    if (this.local) return;
    for (const s of this.slots) s.worker?.terminate();
    for (const s of this.slots) if (s.busy !== null) this.chunks.delete(s.busy);
    this.local = new World(this.seed);
    this.slots = [{ worker: null, busy: null }];
  }

  private paintHere(slot: Slot, c: number) {
    paintChunk(this.local!, c, this.scale, (canvas, progress, strokes, done) => {
      if (this.disposed) return;
      this.chunks.set(c, { image: canvas as unknown as HTMLCanvasElement, progress, strokes, done });
      if (done) slot.busy = null;
      this.onChange();
    }, 6, 0, 10).then(() => this.local?.prune(c));
  }
}
