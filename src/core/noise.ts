// Classic 2D Perlin noise with a seeded permutation table. Output roughly in [-1, 1].
import { Rng } from './rng';

const GRAD: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
];

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const grad = (h: number, dx: number, dy: number) => {
  const g = GRAD[h & 7];
  return g[0] * dx + g[1] * dy;
};

export class Noise {
  private perm = new Uint8Array(512);

  constructor(rng: Rng) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    rng.shuffle(p);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise2(x: number, y: number): number {
    let X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    X &= 255; Y &= 255;
    const p = this.perm;
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const u = fade(xf), v = fade(yf);
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 1.414;
  }

  fbm(x: number, y: number, octaves = 3): number {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
