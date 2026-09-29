# GENESIS — Final Report

GENESIS is a browser god-game on a small, fully simulated planet: tectonic terrain,
hydrology, climate and weather, an ecosystem of plants and 13 animal species, and
tribes of individually simulated people who build, trade, pray, marry, sicken, go to
war and write their god into scripture. The player shapes it with 20 divine powers and
terraforming brushes. Everything in the world is procedural; there are no asset files
(the interface's three typefaces are bundled open-source fonts).

This report lists what was built, the evidence that it works, the measured performance,
the final quality scores, what I am proudest of, what is still imperfect and what I
would build next.

## Definition of Done — status and evidence

| Item | Status | Evidence |
|---|---|---|
| `npm install && npm run dev` works | ✅ | Vite dev server is what every harness script boots (shots, monkey, perf, UI checks) |
| `npm run build` | ✅ | `tsc --noEmit && vite build` succeeds (943 kB main chunk, 238 kB worker, nine woff2 typeface subsets of ~23 kB each) |
| `npm test` passes | ✅ | 9 suites, 25 tests (see below) |
| `npm run shots` regenerates the screenshots | ✅ | 13 viewpoints in `docs/screenshots`, "zero console errors/warnings" gate |
| Zero console errors | ✅ | Every shots/UI/perf run and the 5-minute monkey test (see below) |
| All systems visible and emergent | ✅ | Screenshots; chronicle excerpts; debug traces of wars, plagues, ecology |
| Performance budgets documented | ✅ | Performance section below (with the limits of what can be measured here) |
| 8 scenarios winnable and losable | ✅ | `tests/scenarios.soak.test.ts`: each won and lost by scripted players, and lost by doing nothing |
| Quality scores 9+ or explained | ✅ (explained) | Below 9: independent reviewer scores 4–5 on the visual categories; the shortfall and its causes are explained below and in QUALITY_LOG.md |
| README with ≥10 own screenshots | ✅ | README.md: 13 landscape + 8 interface captures |
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
final code, both with **zero console errors or warnings**: seed 1337 at 1280×720 (36
actions, including 3 casts, 3 terraforming strokes and a page reload) and seed 7 at
640×360 (80 actions, including 11 casts, 10 terraforming strokes, 17 zooms, a quick save
and a reload). The action rate is bounded by software WebGL, which takes
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

Measured with `node scripts/perf.mjs` (1280×720, world advanced 5 years, 20 frames per
view, headless Chromium + SwiftShader; each preset pinned by the URL, re-measured after
the governor fix, DECISIONS 61):

| Quality | View | Main-thread CPU ms/frame | Draw calls | Triangles | SwiftShader wall ms/frame |
|---|---|---|---|---|---|
| low | orbit | 2.11 | 31 | 0.15 M | 1223 |
| low | village | 3.28 | 48 | 0.61 M | 3454 |
| low | forest | 2.84 | 51 | 0.48 M | 3445 |
| medium | orbit | 2.58 | 39 | 0.20 M | 2011 |
| medium | village | 4.79 | 73 | 1.51 M | 7211 |
| medium | forest | 3.84 | 79 | 1.22 M | 7136 |
| high | orbit | 2.66 | 39 | 0.24 M | 3217 |
| high | village | 4.72 | 73 | 2.16 M | 13538 |
| high | forest | 4.11 | 79 | 1.84 M | 13153 |
| ultra | orbit | 2.49 | 39 | 0.37 M | 3807 |
| ultra | village | 5.79 | 73 | 2.86 M | 17261 |
| ultra | forest | 4.37 | 79 | 2.59 M | 16343 |

The main thread spends at most 5.8 ms per frame at any preset, leaving more than
10 ms of a 16.7 ms (60 fps) frame for the GPU; draw calls never exceed 79.

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

These are not my scores. From Pass 4 onward every round was scored by an independent
adversarial reviewer: a fresh agent with a brutal art-director brief ("a stranger
believes it was made by a studio over years"), no knowledge of what had changed, told
to crop and upscale anything suspicious rather than guess. My own earlier 9s (Pass 3)
turned out to be inflated and are kept in QUALITY_LOG.md only as a record of that. The
reviewer scores the four visual categories; the other four rest on measurements.

| Category | Score | Basis |
|---|---|---|
| Visual beauty | 5 | reviewer, Passes 4–9: 5 · 5 · 5 · 5 · 5 · 5 (title, terminator and coast rated 6–7) |
| Visual coherence | 4 | reviewer: 4 · 3 · 4 · 4 · 4 · 4 |
| Polish / juice (visible) | 5 | reviewer: 4 · 4 · 3 · 4 · 5 · 5 (the interface alone about 7) |
| First-impression wow | 5 | reviewer: 4 · 4 · 5 · 4 · 5 · 5 |
| Emergent storytelling | 8 | measured: wars, plagues traced to their carriers, schisms and scripture arise unscripted (debug traces; chronicle); the chronicle still reads partly as a log |
| Moment-to-moment fun | 7 | twenty powers with combos and eight scenarios proven winnable and losable, but play-tested only by scripts and a monkey, never by a person |
| Performance | 7 | simulation measured (100× early, ~42× with 10,000 agents); GPU budgets met by construction only, never measured on a GPU |
| Stability | 9 | zero console errors in every harness run, a 500-year soak, save/load bit-identical, monkey runs clean |

### Why the shortfall

The quality loop's exit rule is "every category 9+, or five consecutive loops without
meaningful improvement, explained". Passes 5 to 9 are five such loops: no category moved
more than one point from its Pass 4 score, and each round was read by a different
reviewer. Each round fixed the concrete defects its review named — about 130 findings,
each confirmed by cropping, by picking heights or by hiding components one at a time,
each with its root cause in QUALITY_LOG.md — and almost none recurred as stated. One
root cause was in the evidence itself: until Pass 8 the harness's screenshots were
silently rendered below the requested preset (DECISIONS 61), so Passes 4–7 judged
partly degraded images. The scores did not move further because each review found the
next layer, and because the reviewers' standing objections are to the approach, not to
bugs:

1. **Two art languages.** The globe is shaded semi-physically (atmosphere, volumetric
   clouds, water optics) while people, animals, trees and buildings are procedural
   low-poly props. Soft foliage and weathered rock relief narrowed the gap; closing it
   means authored-quality models and tri-planar ground materials in the globe's palette,
   or a stylised globe: a rebuild rather than a fix.
2. **Water as carved channels.** Rivers are ribbons over a height field whose lower
   reaches were carved below sea level at world creation; channels with banks that widen
   downstream need the generator to change, which reshapes every world and the eight
   calibrated scenarios.
3. **No art-directed hero shots.** A studio iterates a fixed ladder of shots against
   paintovers with artists; here every image is the unedited output of simulation and
   procedural code, judged only at 1280×720 on a CPU rasteriser.
4. **Software rendering.** Every image was rendered by SwiftShader at DPR 1 with FXAA:
   thin geometry aliases, and a frame takes seconds, which limits how many look
   iterations fit in a pass.

The four measured categories are held back by the limits listed below: no human
play-testing, and no real GPU.

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
   with forced storms), a building list that grew for five centuries (found by the
   500-year soak's trajectory, not its pass/fail), and screenshots silently rendered
   below the preset they claimed (found because stars blurred only in full runs).
5. **Nothing downloaded.** Terrain, clouds, stars, the moon, every model, the music and
   the sound effects are generated by code at load time; only the interface typefaces
   are bundled files.

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
* **Stylised low-poly models beside a semi-physical globe.** People, animals, buildings
  and trees are procedural low-poly meshes animated in the vertex shader (no skeletal
  animation); up close they do not share the globe's art language, which is the
  reviewer's main objection (see Final quality scores).
* **Never played by a person.** Balance, fun and the tutorial were exercised by
  scripted players, a monkey test and screenshots, not by human play-testers.
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
4. **One art language, near and far.** Tri-planar rock, soil and grass materials in the
   globe's own biome palette, two or three procedural tree species with real silhouettes,
   procedural walk cycles with foot placement, and per-age building kits — the change
   every reviewer asked for first.
5. **Carved rivers and seed-robust scenarios.** Regenerate the hydrology so rivers cut
   banked channels that widen downstream (with fords and bridges where roads cross), then
   re-tune each scenario across many seeds rather than one, since the new terrain
   invalidates the current calibration anyway.
