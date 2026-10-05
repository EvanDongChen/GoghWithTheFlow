# Gogh with the Flow

An endless *Starry Night*, procedurally painted stroke by stroke. It takes its spirit from
[shan-shui-inf](https://github.com/LingDong-/shan-shui-inf), but works in Van Gogh's brush instead of ink.

![Gallery view](docs/gallery.png)

![Wander view](docs/wander.png)

## Two ways to look at it

- **Gallery**: a close reinterpretation of the 1889 painting, hung in a gilded frame on a museum
  wall, with a placard that names its seed and counts its brushstrokes. It has the flame-shaped
  cypress cluster, the rolling great swirl, eleven haloed stars, a crescent moon, mountains that
  climb to a dark peak on the right, olive groves, and a white church spire. Each seed varies the
  details slightly.
- **Wander**: walk sideways through an infinite night. New swirls, moons, cypresses, villages,
  poplars and fields keep coming, and each stretch is painted just ahead of you as you travel.
  It starts on the gallery painting itself.

Every seed is its own night, and the same seed always paints the same world.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/, deployable anywhere (e.g. GitHub Pages)
```

| Input | Action |
| --- | --- |
| `G` / `W` | Gallery / Wander |
| `N` | A new night |
| `Space` | Pause or resume drifting |
| `←` `→`, drag, scroll | Walk through the night |
| `S` | Save the current view as PNG |
| `F` | Fullscreen |

URL parameters: `?seed=arles`, `&mode=wander`, `&speed=0..160`, `&intro=0`.

## How it works

Vite with plain TypeScript and no runtime dependencies. Everything is canvas 2D, made of tens of
thousands of thick impasto brush strokes, each with a shadow, a body, bristle streaks and a
highlight.

**An infinite world in chunks.** The world is cut into 750px-wide chunks, and each one generates
its own features from `hash(seed, chunk)`. Some features, such as moons, great swirls and
cypresses, may never appear in two neighbouring chunks. Anything that needs to know its
surroundings (flow fields, overlap checks) looks two chunks either side. The first two chunks
are pinned to the classic layout, so the gallery painting is also where the wander begins.

**Seamless tiling.** Each chunk is painted into its own offscreen canvas. Every stroke is seeded
from its global grid cell and given a global sort key. So when two chunks both draw a stroke that
crosses their shared edge, they draw it identically and in the same order, and no seam shows.

**Painted progressively.** A chunk is planned as an ordered list of draw ops, then executed a few
milliseconds per frame. Visible chunks go first, then the road ahead, which is why you can watch
it being painted.

| Path | Role |
| --- | --- |
| `src/core/` | Seeded RNG and hashing, Perlin noise, colour helpers, the impasto brush |
| `src/world/world.ts` | The classic 1889 layout, plus chunked procedural generation of moons, swirls, stars, cypresses, towns, olive trees and peaked terrain |
| `src/paint/sky.ts` | Flow field from base wave + milky-way ribbon + vortices + star halos; concentric glow rings |
| `src/paint/land.ts` | Hills that follow ridgelines, valley floor, field patches |
| `src/paint/village.ts` | Blocky 3/4-view houses built from paint dabs, glowing windows, churches, trees |
| `src/paint/cypress.ts` | Flame-shaped cypress with skewed-sine lobes and upward-curling strokes |
| `src/paint/chunks.ts` | Plans, orders and progressively paints chunks; canvas weave; eviction |
| `src/main.ts`, `src/styles.css` | Gallery, wander, dock, input, export |
