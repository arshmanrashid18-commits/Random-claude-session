# Progress

## Current state (Phase 1 in progress)

Working:
* World generation (terrain, erosion, climate spin-up, hydrology) ≈ 8 s in the worker.
* Renderer: terrain LOD, ocean, lakes, rivers, atmosphere, clouds, aurora, stars,
  moon, post chain, vegetation instancing.
* Harness: `npm run shots` (use `--only=a,b` and `--out=dir` to iterate).

Next:
1. Evaluate close-up shots with vegetation; iterate on ground look (grass blades).
2. Perf overlay (F3), camera input handling, title screen.
3. Phase 2: weather systems, terraforming.

Known issues:
* Vegetation densities currently derived from climate (proxy) inside the worker's
  texture packer — to be replaced by the plant simulation (Phase 3).
* Headless SwiftShader frames take 4–40 s; the harness allows long timeouts.

## How to resume

1. Read ARCHITECTURE.md, ROADMAP.md, DECISIONS.md, QUALITY_LOG.md, this file.
2. `npm install && npm test && npx tsc --noEmit`.
3. `npm run shots -- --only=orbit,coast --out=/tmp/shots` and look at the images.
