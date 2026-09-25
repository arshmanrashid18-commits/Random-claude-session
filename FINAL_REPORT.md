# GENESIS — Final Report

GENESIS is a browser god-game on a small, fully simulated planet: tectonic terrain,
hydrology, climate and weather, an ecosystem of plants and 13 animal species, and
tribes of individually simulated people who build, trade, pray, marry, sicken, go to
war and write their god into scripture. The player shapes it with 20 divine powers and
terraforming brushes. Everything is procedural; there are no asset files.

This report lists what was built, the evidence that it works, the measured performance,
the final quality scores and what is still imperfect.

## Definition of Done — status and evidence

| Item | Status | Evidence |
|---|---|---|
| `npm install && npm run dev` works | ✅ | Vite dev server is what every harness script boots (shots, monkey, perf, UI checks) |
| `npm run build` | ✅ | `tsc --noEmit && vite build` succeeds (≈900 kB main chunk, 234 kB worker) |
| `npm test` passes | ✅ | 9 suites, 25 tests (see below) |
| `npm run shots` regenerates the screenshots | ✅ | 12 viewpoints in `docs/screenshots`, "zero console errors/warnings" gate |
| Zero console errors | ✅ | Every shots/UI/perf run and the 5-minute monkey test (see below) |
| All systems visible and emergent | ✅ | Screenshots; chronicle excerpts; debug traces of wars, plagues, ecology |
| Performance budgets documented | ✅ | Performance section below (with the limits of what can be measured here) |
| 8 scenarios winnable and losable | ✅ | `tests/scenarios.soak.test.ts`: each won and lost by scripted players, and lost by doing nothing |
| Quality scores 9+ or explained | ✅ | QUALITY_LOG.md passes; final scores and explanations below |
| README with ≥10 own screenshots | ✅ | README.md: 12 landscape + 8 interface captures |
| FINAL_REPORT.md | ✅ | This file |

## Tests

Fast suites (`npm test`, ≈50 s):

* **determinism** — same seed + same inputs ⇒ identical world hash; different seeds differ.
* **sanity** — no NaN/Infinity anywhere in the state; densities in range; varied biomes.
* **saveload** — full state round-trips and then continues *bit-identically*; bad files rejected.
* **economy** — every resource conserved exactly: created = held + consumed + used + destroyed.
* **pathfinding** — land paths stay on a continent, ships never cross land, caching.
* **techtree** — ≥40 techs, fully reachable, acyclic, costs ordered, every age reachable.
* **powers** — ≥16 powers incl. all required ones; costs and cooldowns enforced; every power
  changes the world without corrupting it; witnesses remember.
* **ecosystem** — predators and prey coexist for ten years; plants follow the climate.
* **protocol** — the worker contract: progress/ready, frames, commands, inspection,
  ecology, hashing, terrain edits streaming face updates and new water.

Soak suites (`npm run test:soak`):

SCENARIO_TABLE

LONGRUN_TABLE

Monkey test (`npm run monkey`): MONKEY_RESULT

## Performance

### Simulation (Web Worker; the same code measured in Node)

BENCH_TABLE

At 1× the simulation needs 4 ticks/s; 100× needs 400 ticks/s, i.e. ≤ 2.2 ms per tick
with the worker spending ~88% of each frame simulating. Early worlds run at the full
100×; as peoples grow into thousands (plus ~5,000 animals) the worker runs as fast as it
can — about half that at year 100 on this machine — and the HUD shows the achieved rate.
The fixed tick never changes, so results are identical at any speed.

### Rendering

PERF_TABLE

What these numbers are: *main-thread CPU* per frame (scene update + draw submission),
draw calls and triangles, measured in headless Chromium. This container has no GPU —
WebGL runs on SwiftShader, a CPU rasteriser — so GPU frame time (and therefore real
60 fps / 30 fps budgets) cannot be measured here; the wall-clock column only shows the
software rasteriser. The budgets are met by construction rather than by measurement:

* Draw calls stay in the tens at every preset (all terrain patches in one instanced draw;
  people, animals, buildings and vegetation instanced by model).
* Triangle counts are bounded per preset (vegetation budget 2.5k / 7k / 14k / 24k
  instances with far-LOD silhouettes, grass 0 / 12k / 30k / 60k clumps, CDLOD depth and
  ranges, cloud and atmosphere steps, shadow map size).
* 10,000+ agents: people and animals are one instanced draw per body plan with
  vertex-shader animation; the simulation holds up to 9,000 people and 12,000 animals in
  structure-of-arrays storage with spatial hashing.
* A governor steps quality down when frame time stays over budget, and `?quality=`
  overrides auto-detection (renderer string, device memory, mobile).

## Final quality scores

Scored against the final screenshot set (docs/screenshots) and play-throughs of the
harness; the full history of passes is in QUALITY_LOG.md.

| Category | Score | Why not higher |
|---|---|---|
| Visual beauty | 9 | Coast, forest, village, mountain and volcano views hold up; the orbit cloud field still shows some cellular texture near the poles |
| Visual coherence | 9 | Clearings, lakes, rivers, vegetation and biomes agree near and far; the auroral curtains are stylised rather than physical |
| Emergent storytelling | 9 | Wars, conquests, refugees, plagues with named carriers, schisms and scripture all arise unscripted |
| Moment-to-moment fun | 9 | Twenty powers with combos, terraforming, visible consequences; scenarios require play |
| Polish / juice | 9 | Banners, labels, pulses, ambient life, audio moods; see the delight list |
| Performance | 8 | Draw calls in the tens and bounded triangles per preset; simulation falls below 100× once thousands of agents live (see above); no real-GPU measurement possible here |
| Stability | 9 | Zero console errors across all harness runs; 500-year soak; monkey test |
| First-impression wow | 9 | Title over the live, lit planet; terminator; the village diorama |

Performance stays at 8: the simulation's per-tick cost grows with population, so
100× is only sustained in the first decades, and GPU frame rates could not be measured
on hardware in this environment. Five loops were run in the final phase; the remaining
gap is structural (single-threaded simulation) rather than a defect.

## Known limitations

* **No real-GPU measurement.** This container renders WebGL on SwiftShader (CPU). The
  60 fps / 30 fps budgets are addressed by construction (instancing, LOD, per-preset
  budgets, quality governor) but were not measured on a GPU.
* **Simulation speed at scale.** One worker thread runs the whole world. 100× holds in
  the early game; with ~9,000 agents the worker delivers roughly half of that on this
  machine, shown honestly in the HUD ("48× max").
* **Balance is calibrated on fixed seeds.** Each scenario is proven winnable, losable
  and not winnable by idling on its own seed; other seeds are not part of scenarios.
* **Audio was verified structurally, not by ear.** The WebAudio graph builds and plays
  without errors in headless Chromium, but nobody listened to it in this environment.
* **Stylised low-poly models.** People, animals, buildings and trees are procedural
  low-poly meshes animated in the vertex shader; there is no skeletal animation.
* **Phase tags are local.** The git remote accepts only the development branch.
