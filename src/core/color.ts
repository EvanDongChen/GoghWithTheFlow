import type { Rng } from './rng';
import { clamp, lerp } from './math';

export type RGB = readonly [number, number, number];

export function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function css(c: RGB, a?: number): string {
  const r = c[0] | 0, g = c[1] | 0, b = c[2] | 0;
  return a === undefined ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export const lighten = (c: RGB, t: number) => mix(c, [255, 255, 255], t);
export const darken = (c: RGB, t: number) => mix(c, [0, 0, 0], t);

/** Shift brightness with a shared offset plus a little per-channel noise. */
export function jitter(c: RGB, rng: Rng, amt: number): RGB {
  const d = (rng.random() - 0.5) * amt;
  return [
    clamp(c[0] + d + (rng.random() - 0.5) * amt * 0.5, 0, 255),
    clamp(c[1] + d + (rng.random() - 0.5) * amt * 0.5, 0, 255),
    clamp(c[2] + d + (rng.random() - 0.5) * amt * 0.5, 0, 255),
  ];
}

export function palette<K extends string>(obj: Record<K, string[]>): Record<K, RGB[]> {
  const out = {} as Record<K, RGB[]>;
  for (const k in obj) out[k] = obj[k].map(hex);
  return out;
}
