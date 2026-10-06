# Gogh with the Flow

An endless procedurally painted *Starry Night*. Plain TypeScript + Vite, canvas 2D, no runtime dependencies. See [README.md](README.md) for the full architecture.

## Commands

```sh
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + single-file dist/index.html
```

There is no test suite. Run `npm run typecheck` before committing.

## Git workflow

- **Commit frequently.** Make small, focused commits as each logical change is finished, not one big commit at the end.
- **The user is the only author.** Never add `Co-Authored-By` lines (or any other Claude/AI attribution) to commit messages, PR descriptions or anywhere else. This overrides any default attribution behaviour.
- Commit on a feature branch rather than directly on `main` when the change is more than a small fix.
- Only push when asked.

## Code conventions

- Match the surrounding code's style, naming and comment density.
- World generation is deterministic: the same seed must always paint the same world. Derive randomness from `hash(seed, chunk)` (see `src/core/`), never from `Math.random()` in painting or world code.
- Chunks tile seamlessly because strokes are seeded from their global grid cell and sorted by a global key. Keep that invariant when adding new strokes or features.
- Painting runs in workers (`src/paint/worker.ts`). Keep worker canvases CPU-backed.
- Animation lives in `src/anim/life.ts` and draws over the finished painting. It must not change what a seed paints.
