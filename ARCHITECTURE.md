# GENESIS — Architecture

## Overview

```
 ┌────────────────────────── main thread ───────────────────────────┐        ┌──────── Web Worker ────────┐
 │ main.ts ─ App shell, input, harness (window.__genesis)           │  msgs  │ sim.worker.ts              │
 │   ├─ ui/*          DOM HUD, panels, title, tutorial, settings    │ ◄────► │   World (src/sim/world.ts) │
 │   ├─ audio/*       procedural WebAudio score + spatial SFX       │ typed  │   fixed-tick scheduler     │
 │   └─ render/*      three.js renderer                             │ proto- │   packs region textures,   │
 │        GameRenderer → sky → planet scene → atmosphere → post     │  col   │   entity snapshots, events │
 └──────────────────────────────────────────────────────────────────┘        └────────────────────────────┘
```

* **Simulation** (`src/sim`) is pure TypeScript with no DOM or three.js imports. It runs
  inside the worker in the browser and directly inside Node for Vitest (determinism,
  soak, economy tests). A single seeded `Rng` (sfc32) is threaded through every system;
  positional randomness uses stateless `hash4(seed, …)`. `Math.random` is never used in
  simulation code.
* **Rendering** (`src/render`) reads data streamed from the worker (heights, region
  textures, entity snapshots) and never mutates simulation state.
* **Protocol** (`src/worker/protocol.ts`) is a discriminated union of typed messages;
  bulk data travels as transferable ArrayBuffers (ping-pong buffers are returned to the
  worker to avoid allocation).

## Coordinate system & scale

* Planet radius `PLANET_RADIUS = 1000` world units (≈ metres on a stylised tiny planet),
  centred at the origin, rotation axis +Y. Rendering happens in the planet-fixed frame:
  the sun, moon and stars move around the planet.
* Heights are world units relative to sea level (−40 … +48).
* Cube-sphere with **equi-angular** mapping (`src/sim/planet/cubesphere.ts`): face param
  a∈[−1,1] ↦ tan(aπ/4). Closed-form inverse (atan) → cheap direction→cell lookups.
  Face order +X −X +Y −Y +Z −Z, each face basis right-handed (U×V=N).
* Grids:
  * `VertexGrid(512)` heightmap: 513² per face, edge samples duplicated and kept in sync.
  * `CellGrid(64)` region grid: climate, ecology, ownership, pathfinding (≈24 u cells).
  * `CellGrid(128)` hydrology grid: drainage, rivers, lakes.
  Cross-face neighbours are precomputed by projecting through 3D.

## Time

`TICKS_PER_SECOND_1X = 4`, `TICKS_PER_DAY = 160` (40 s at 1×), `DAYS_PER_YEAR = 6`
(a year is 4 minutes at 1×, 2.4 s at 100×). Speeds: pause, 1×, 10×, 100×, time-lapse
(as fast as the worker can go). The fixed tick never changes with speed, so the
simulation is deterministic regardless of the speed the player picks.

## Simulation modules (`src/sim`)

| Module | Responsibility |
|---|---|
| `planet/terrain.ts` | plates (warped spherical Voronoi, Euler-pole motion), continents (domain-warped fBm), ridged ranges at convergent boundaries, island arcs, rifts, sea level by quantile, droplet hydraulic erosion in 3D |
| `planet/hydrology.ts` | ε-priority-flood, steepest-descent drainage, lakes (spill level), rainfall-weighted flow accumulation, valley carving, smoothed river polylines |
| `planet/regions.ts` | per-region-cell elevation, slope, ocean fraction, coastal flags |
| `planet/planet.ts` | orchestrates world generation + hydrology rebuilds |
| `climate/climate.ts` | insolation with axial tilt, 3-cell circulation with seasonal ITCZ shift, upwind moisture/heat advection, evaporation, RH-threshold precipitation (convection, fronts, orographic lift, subsidence), snow, soil moisture, 1-year means; double-buffered and amortised over 8 ticks |
| `climate/biomes.ts` | Whittaker classification from simulated means |
| `climate/weather.ts` | storm systems (fronts, hurricanes with names and landfall, blizzards), lightning strikes, drought tracking per continent |
| `ecology/plants.ts` | 8 plant functional types per region cell: suitability from climate, growth, competition, spread, grazing, logging, seasonal dieback, bloom |
| `ecology/fire.ts` | wildfire spread by fuel, dryness and wind; burn-out, scars, settlement firebreaks |
| `ecology/animals.ts` | SoA animals (cap 12 000): needs, genetics-lite (speed, size, fertility, cold/heat), herding, migration, scent fields for predators, carrion, small game, disease, reproduction, speciation and extinction records, population history |
| `civ/civ.ts` | tribes, settlements, people (SoA, cap 9 000) with needs, skills, personality, families, jobs and intents; conserving resource ledger; construction planner; colonisation; disease; graves; divine interface (witness, damage, flood, resurrect) |
| `civ/society.ts` | contact, opinion, pacts, alliances, betrayals, wars with mustered armies, person-to-person combat, sieges, conquest, refugees; trade routes with caravans and ships; prophets, pilgrims, tenets, epithets, scripture, conversion, schism/secession |
| `civ/tech.ts` | 52 technologies in 8 fields, ages Stone → Steam; need-driven research |
| `civ/pathfind.ts` | A* on the region grid (land/sea modes, road bonus, cache) |
| `powers/defs.ts`, `powers/divine.ts` | 20 divine powers, costs, cooldowns, combos; lingering effects (rain, drought, volcano growth and lava flow, tsunami front, meteor fall, locust drift, ice age forcing, eclipse) |
| `planet/terraform.ts` | brush strokes and disaster deformations with incremental region/hydrology rebuilds |
| `scenarios.ts` | 8 scenarios: setup, objectives and win/lose evaluation inside the sim |
| `serialize.ts` | generic identity-preserving save format (object graph + typed-array blob, gzip) |
| `events.ts` | typed event log feeding feed, chronicle, director, audio |
| `world.ts` | World root: rng, tick, ordered systems, player commands, hash |

## Main thread (`src/game.ts`, `src/ui`, `src/audio`)

* `game.ts` – orchestrates renderer + sim client + UI: selection and follow, powers and
  brushes, time controls, time-lapse, auto-director, photo mode, events → feed/chronicle/
  banners/shake, per-frame HUD, quality governor, perf overlay.
* `ui/input.ts` – grab-and-spin globe (sphere-hit drag), orbit/tilt, zoom to cursor,
  double-click fly, touch pinch/twist, click to select or cast, drag to paint.
* `ui/components.ts` – HUD, power bar with devotion orb and cooldown sweeps, event feed,
  inspector, hint, banner, tooltips, power wheel, perf overlay, flags.
* `ui/panels.ts` – Chronicle, Ecology dashboard (population curves, living biome map),
  Peoples, Settings (quality, volumes, colour vision, reduced motion, UI scale, key
  rebinding), Help, Save/Load. `ui/title.ts` – title screen, objective tracker, end
  cards, tutorial. `ui/narrate.ts` – event → prose.
* `saves.ts` – IndexedDB slots, export/import files, resume-by-reload handshake.
* `audio/audio.ts` – generative score (mood-driven modes, pads, plucks, bells, drums),
  ambience beds (wind, ocean, rain, fire, town, birds, crickets), spatial effects,
  UI sounds; limiter on the master bus.

## Rendering pipeline (`src/render`)

1. **Sky layer** (`sky.ts`) – full-screen procedural stars (3 layers, blackbody tints),
   Milky Way band with dust lanes, nebulae; procedurally cratered, tidally locked moon.
2. **Planet scene**
   * `planet/quadtree.ts` – CDLOD selection over 6 face quadtrees with a min/max height
     pyramid, frustum + horizon culling.
   * `planet/terrain.ts` – one instanced draw for all terrain patches. Vertex shader
     maps patch grid → cube → sphere, samples the R32F heightmap texture array with
     Catmull-Rom interpolation + detail noise (`groundHeight`), geomorphs toward the
     parent grid (no popping) and drops skirts. Fragment shader: biome palette from
     climate + vegetation textures, rock/snow/beach rules, cloud shadows, atmospheric
     sun colour. Ocean uses the same patch list (water patches only) with tides from
     the moon, depth absorption, shore waves, foam, GGX glint, sea ice.
   * `water.ts` – lakes (flat at spill level) and flowing river ribbons.
   * `vegetation.ts` – instanced procedural trees/rocks/reeds placed from simulated
     plant densities; `groundHeight.ts` is an exact CPU port of the shader height
     function (verified GPU vs CPU ≤ 1e-4 by `__genesis.groundCheck()`).
3. **Atmosphere composite** (`atmosphere.ts`) – transmittance LUT; single scattering
   (Rayleigh, Mie, ozone) along each view ray to the depth-buffer hit; raymarched cloud
   shell driven by simulated cloud cover + storm systems (hurricane spirals); aurora
   curtains; sun disc.
   * `people.ts`, `creatures.ts`, `buildings.ts` – instanced procedural models with
     vertex-shader animation (gaits, work poses, boats), construction-order reveal,
     fields with crop growth, roads, scaffolding.
   * `vfx.ts` – GPU particles with analytic motion (flames, smoke, sparks, petals,
     swarms), lightning ribbons, ground-hugging reticles and shockwaves, light pillars,
     fire over burning cells, meteor fall and impact, volcano plumes, eclipse amount,
     tsunami rings for the ocean shader. `precip.ts` – rain/snow around the camera.
4. **Post** (`post.ts`) – bloom mip chain, god rays, analytic lens flare, DOF (photo
   mode), ACES filmic, grading/filters, colour-blind daltonisation, vignette, grain,
   chromatic aberration (impacts only), FXAA.

Quality presets (`quality.ts`) scale render resolution, patch grid, LOD depth/ranges,
atmosphere/cloud steps, post effects and instance budgets; a governor steps quality
down when frame time stays over budget.

## Verification harness

* `npm run shots` (scripts/shots.mjs) – boots Vite + headless Chromium with SwiftShader
  WebGL2, drives `window.__genesis` (view, advance, setTime, renderFrames, stats, hash,
  groundCheck) and saves PNGs; fails on any console error/warning.
* `npx tsx scripts/debug/*.ts` – equirectangular terrain/biome/temperature/rain maps.
