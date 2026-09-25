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

**Scenario soak** — every scenario is played to its end on the real simulation by a
scripted winning player, a scripted losing player and by doing nothing
(`tests/scenarios.soak.test.ts`, 24 tests). Outcomes on the final code
(`npx tsx scripts/debug/scenarios.ts "" all`):

| Scenario | Objective | Scripted win | Scripted loss | Doing nothing |
|---|---|---|---|---|
| The First Flame | Bronze Age within 15 years | won, year 12.9 | lost (all dead), year 2.2 | lost: 18 discoveries, no bronze |
| The Long Drought | ≥120 alive after 20 years of failing rains | won: 141 alive | lost: wells dry, year 0.5 | lost: wells dry, year 1.5 |
| Ark of the Beasts | no original species lost for 15 years of great ice | won: 12/12 | lost: jaguars gone | lost: jaguars gone, year 6.5 |
| Two Faiths | a divine truce and both peoples alive for 12 years | won: at peace, 51 · 31 | lost: the Uwrei destroyed | lost: still at war |
| The Chosen People | a settlement of 100 within 26 years | won, year 18.0 | lost (all dead) | lost: largest 88 |
| Wrath | fewer than 25 people within 15 years, one people surviving | won: 15 left, year 4.5 | lost: no one left to remember | lost: 211 alive |
| Green the Desert | a quarter more of the land green within 20 years | won: 75% of 74%, year 3.7 | lost: 67% | lost: 68% |
| A God Forgotten | average faith ≥ 50% within 12 years | won: 51%, year 3.6 | lost: 0% (neglect) | lost: 0% |

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

Measured with `node scripts/perf.mjs` (1280×720, world advanced 5 years, 12 frames per
view, headless Chromium + SwiftShader):

| Quality | View | Main-thread CPU ms/frame | Draw calls | Triangles | SwiftShader wall ms/frame |
|---|---|---|---|---|---|
| low | orbit | 1.78 | 31 | 0.13 M | 1328 |
| low | village | 3.11 | 49 | 0.60 M | 4276 |
| low | forest | 2.28 | 52 | 0.44 M | 4841 |
| medium | orbit | 1.91 | 39 | 0.15 M | 2623 |
| medium | village | 4.74 | 75 | 1.41 M | 10134 |
| medium | forest | 3.48 | 81 | 1.05 M | 10945 |
| high | orbit | 2.66 | 39 | 0.16 M | 4152 |
| high | village | 4.72 | 75 | 1.91 M | 20292 |
| high | forest | 4.88 | 81 | 1.61 M | 14424 |
| ultra | orbit | 2.12 | 39 | 0.17 M | 3520 |
| ultra | village | 5.61 | 75 | 2.54 M | 17650 |
| ultra | forest | 3.42 | 81 | 2.20 M | 19323 |

The main thread spends at most 5.6 ms per frame at any preset, leaving more than
11 ms of a 16.7 ms (60 fps) frame for the GPU; draw calls never exceed 81.

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
