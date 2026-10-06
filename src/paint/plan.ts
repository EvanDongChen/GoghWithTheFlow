// Shared types for planning a chunk as an ordered list of draw operations.
//
// Chunks are painted independently into their own canvases. To make them tile with no
// seams, every stroke is generated from global coordinates and gets a global sort key:
// two neighbouring chunks that both include a stroke near their shared edge draw it with
// the same shape, the same colour, and in the same order relative to its neighbours.

import { stroke, type Ctx, type Pt } from '../core/brush';
import type { RGB } from '../core/color';
import { Rng } from '../core/rng';
import type { Nearby, World } from '../world/world';

export type Op = (ctx: Ctx) => void;

export const L = {
  SKY_BASE: 0, SKY: 1, GLOW: 2, GLOW_CORE: 3,
  HILL_BASE: 4, HILL: 5, RIDGE: 6,
  GROUND_BASE: 7, GROUND: 8, WATER_BASE: 8.4, WATER: 8.5, VILLAGE: 9,
  CYPRESS_BASE: 10, CYPRESS: 11, CYPRESS_EDGE: 12,
} as const;

export interface Item { layer: number; key: number; op: Op; }

export interface ChunkPlan {
  world: World;
  c: number;
  /** Chunk x range, plus padding wide enough for any stroke that could reach inside. */
  x0: number; x1: number; pad: number;
  near: Nearby;
  items: Item[];
}

export function strokeItem(layer: number, key: number, seed: number, pts: Pt[], w: number, col: RGB): Item {
  return { layer, key, op: (ctx) => stroke(ctx, new Rng(seed), pts, w, col) };
}

/** Global grid cells (i, j) whose jittered point could land within the padded chunk. */
export function cellRange(p: ChunkPlan, sp: number): [number, number] {
  return [Math.floor((p.x0 - p.pad) / sp) - 1, Math.ceil((p.x1 + p.pad) / sp) + 1];
}

export const inPad = (p: ChunkPlan, x: number, reach = 0) => x + reach >= p.x0 - p.pad && x - reach <= p.x1 + p.pad;
