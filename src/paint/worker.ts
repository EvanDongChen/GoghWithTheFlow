// A painting worker: paints chunks off the main thread and sends them back as bitmaps.
import { World } from '../world/world';
import { paintChunk } from './chunks';

export type ToWorker = { type: 'init'; seed: string; scale: number } | { type: 'paint'; c: number };
export type FromWorker =
  | { type: 'frame'; c: number; bitmap: ImageBitmap; progress: number; strokes: number; done: boolean }
  | { type: 'error'; c: number; message: string };

let world: World | null = null;
let scale = 1;

const post = (msg: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'init') {
    world = new World(m.seed);
    scale = m.scale;
    return;
  }
  if (!world) return;
  try {
    await paintChunk(world, m.c, scale, async (canvas, progress, strokes, done) => {
      const bitmap = done ? (canvas as OffscreenCanvas).transferToImageBitmap() : await createImageBitmap(canvas as OffscreenCanvas);
      post({ type: 'frame', c: m.c, bitmap, progress, strokes, done }, [bitmap]);
    });
    world.prune(m.c);
  } catch (err) {
    post({ type: 'error', c: m.c, message: String(err) });
  }
};
