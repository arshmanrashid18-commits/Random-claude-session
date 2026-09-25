# GENESIS — Final Report

GENESIS is a browser god-game on a small, fully simulated planet: tectonic terrain,
hydrology, climate and weather, an ecosystem of plants and 13 animal species, and
tribes of individually simulated people who build, trade, pray, marry, sicken, go to
war and write their god into scripture. The player shapes it with 20 divine powers and
terraforming brushes. Everything is procedural; there are no asset files.

This report lists what was built, the evidence that it works, the measured performance,
the final quality scores, what I am proudest of, what is still imperfect and what I
would build next.

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

**500-year soak** (`tests/longrun.soak.test.ts`, seed 424242, default settings, no god):
passes on the final code in 46 minutes — no NaN or Infinity anywhere in the state, event
history, memories, graves and path cache within their bounds, the building list bounded
(crumbled ruins free their slots), life endures, and the world still saves and loads to
an identical hash after five centuries. Trajectory (`test-results/soak-500y.txt`):

| Year | People | Tribes | Animals | Species | Buildings (live / slots) | Cached paths | ms/tick |
|---|---|---|---|---|---|---|---|
| 25 | 523 | 5 | 4,614 | 13 | 281 / 281 | 83 | 2.95 |
| 50 | 1,554 | 5 | 4,824 | 13 | 942 / 942 | 537 | 3.88 |
| 100 | 2,714 | 5 | 5,430 | 15 | 1,976 / 1,976 | 2,654 | 5.14 |
| 150 | 2,884 | 5 | 6,754 | 18 | 2,423 / 2,423 | 3,213 | 5.92 |
| 200 | 2,869 | 5 | 6,568 | 20 | 2,532 / 2,547 | 3,100 | 5.44 |
| 300 | 2,939 | 5 | 7,806 | 30 | 3,318 / 3,322 | 3,335 | 6.68 |
| 400 | 2,817 | 5 | 8,270 | 42 | 3,641 / 3,687 | 3,213 | 6.34 |
| 500 | 2,903 | 5 | 8,335 | 34 | 3,671 / 3,687 | 3,272 | 6.23 |

Peoples grow logistically to a plateau near 2,900; animals diversify through speciation
(13 → 42 species, then extinctions bring it to 34). Before the slot fix the same run
ended with 17,578 building entries and 6.9 ms/tick.

Monkey test (`npm run monkey`): five minutes of random play against the real game —
drags, zooms, clicks, hotkeys, power casts, terraforming strokes, panels, settings,
quick save and a page reload — failing on any console error or warning. Two runs on the
final code, both with **zero console errors or warnings**: seed 1337 at 1280×720 (46
actions) and seed 7 at 640×360 (81 actions, including 11 casts, 10 terraforming strokes,
17 zooms and a quick save). The action rate is bounded by software WebGL, which takes
0.5–2 s per frame in this container.

## Performance

### Simulation (Web Worker; the same code measured in Node)

Measured with `npx tsx scripts/bench.mts` (Node 22, one core of this container; 400
ticks per row; the agent count is raised by cloning herds into their own habitat):

| World | Agents | Animals | People | ms/tick | Max speed | By system (ms/tick) |
|---|---|---|---|---|---|---|
| natural, year 1 | 1,968 | 1,876 | 92 | 1.83 | 100× | animals 0.89 · climate 0.56 · plants 0.22 · civilisation 0.13 |
| year 1, raised to 5,000 | 5,023 | 4,919 | 104 | 2.92 | 75× | animals 1.89 · climate 0.62 · plants 0.24 · civilisation 0.11 |
| year 1, raised to 10,000 | 9,622 | 9,514 | 108 | 4.66 | 47× | animals 3.66 · climate 0.58 · plants 0.23 · civilisation 0.11 |
| natural, year 100 | 6,778 | 4,582 | 2,196 | 3.60 | 61× | animals 1.92 · civilisation 0.80 · climate 0.61 · plants 0.23 |
| year 100, raised to 10,000 | 9,939 | 7,705 | 2,234 | 5.23 | 42× | animals 3.39 · civilisation 0.89 · climate 0.66 · plants 0.24 |

"Max speed" is the time multiplier the worker can sustain (1× = 4 ticks/s, with ~88% of
each frame spent simulating). World generation takes 4.7 s.

At 1× the simulation needs 4 ticks/s; 100× needs 400 ticks/s, i.e. ≤ 2.2 ms per tick.
Early worlds run at the full 100×; with thousands of people and ~5,000 animals at year
100 the worker sustains about 60×, and about 40–47× with 10,000 agents. When the
requested speed is out of reach the HUD shows the achieved rate ("42× max"). The fixed
tick never changes, so results are identical at any speed; at 1×–10× the simulation
uses at most a few percent of the worker's time.

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
| Visual beauty | 9 | Coast, forest, village, mountain and volcano views hold up; a hurricane spirals over the ocean and the aurora folds over a moonlit continent; models are stylised low-poly |
| Visual coherence | 9 | Clearings, lakes, rivers, vegetation, pack ice and biomes agree near and far; clouds are a single volumetric layer (no high cirrus) |
| Emergent storytelling | 9 | Wars, conquests, refugees, plagues with named carriers, schisms and scripture all arise unscripted |
| Moment-to-moment fun | 9 | Twenty powers with combos, terraforming, visible consequences; scenarios require play |
| Polish / juice | 9 | Banners, labels, pulses, ambient life, audio moods; see the delight list |
| Performance | 8 | Draw calls in the tens and bounded triangles per preset; simulation falls below 100× once thousands of agents live (see above); no real-GPU measurement possible here |
| Stability | 9 | Zero console errors across all harness runs; 500-year soak; monkey test |
| First-impression wow | 9 | Title over the live, lit planet; terminator; the village diorama |

Performance stays at 8: the simulation's per-tick cost grows with population, so
100× is only sustained in the first decades, and GPU frame rates could not be measured
on hardware in this environment. Four scored passes are logged (0.1, 1, 2 and the final
Pass 3); the remaining gap is structural (single-threaded simulation) rather than a
defect.

## What I am proudest of

1. **Stories nobody wrote.** A plague in the chronicle is traced to the merchant or
   pilgrim who carried it along a real trade route; an army marches with the food it
   can carry or sails when the enemy is overseas; a drought is survived by the towns on
   great rivers; scripture quotes what the god actually did. None of it is scripted —
   debug traces (`scripts/debug/rel.mts`, `plague.mts`) show the causal chains.
2. **Bit-exact determinism, including saves.** Every system draws from one seeded
   generator, and a save restores the object graph with its identities, so a loaded
   world continues exactly as the original would have. That is what lets the test suite
   play all eight scenarios on the real simulation and assert who wins.
3. **A conserving economy.** Every unit of food, wood, stone and metal is carried by a
   person and accounted for; the test asserts created = held + consumed + used +
   destroyed, to the unit.
4. **Evidence over belief.** Several of the worst bugs were invisible until measured: a
   three.js cache that drew only the first few hundred instances (most trees and crowds
   never appeared), hurricanes thresholded into haze (found by bisecting the shader
   with forced storms), and a building list that grew for five centuries (found by the
   500-year soak's trajectory, not its pass/fail).
5. **Nothing downloaded.** Terrain, clouds, stars, the moon, every model, the music and
   the sound effects are generated by code at load time.

## Known limitations

* **No real-GPU measurement.** This container renders WebGL on SwiftShader (CPU). The
  60 fps / 30 fps budgets are addressed by construction (instancing, LOD, per-preset
  budgets, quality governor) but were not measured on a GPU.
* **Simulation speed at scale.** One worker thread runs the whole world. 100× holds in
  the early game; at year 100 the worker sustains ~60×, and ~42× with 10,000 agents on
  this machine, shown honestly in the HUD ("42× max").
* **Balance is calibrated on fixed seeds.** Each scenario is proven winnable, losable
  and not winnable by idling on its own seed; other seeds are not part of scenarios.
* **Audio was verified structurally, not by ear.** The WebAudio graph builds and plays
  without errors in headless Chromium, but nobody listened to it in this environment.
* **Stylised low-poly models.** People, animals, buildings and trees are procedural
  low-poly meshes animated in the vertex shader; there is no skeletal animation.
* **Phase tags are local.** The git remote accepts only the development branch.

## Five things I would build next

1. **A parallel simulation.** Split ecology and civilisation across workers over
   `SharedArrayBuffer` (the structure-of-arrays layout already suits it) so 100× holds
   with 10,000+ agents.
2. **Measured GPU budgets.** GPU timer queries feeding the quality governor, and a
   benchmark pass on real integrated and discrete GPUs to replace the budgets-by-
   construction argument with numbers.
3. **"What if" — forking history.** Determinism makes rewinding cheap: keep a save every
   in-game decade and let the player branch from any of them, with the chronicle of the
   abandoned timeline kept as apocrypha.
4. **Animated bodies and richer towns.** Procedural walk cycles with foot placement on
   the terrain for people and animals, and per-age building kits with more variety
   (market halls, aqueducts, rail yards).
5. **Seed-robust scenarios and a richer sky.** Tune each scenario across many seeds
   rather than one, and add a high cirrus layer, cloud shadows on the sea and a sea state
   driven by the wind.
