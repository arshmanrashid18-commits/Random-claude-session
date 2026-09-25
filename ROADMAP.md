# GENESIS — Roadmap

Legend: [x] done and verified (test, screenshot or measurement) · [~] in progress · [ ] todo

## Phase 0 — Harness, tooling, docs
- [x] Vite + TS strict + three.js project, Vitest, Playwright (Chromium / PW 1.56.1)
- [x] Headless WebGL2 via SwiftShader verified (float RT + float linear)
- [x] `npm run shots` screenshot harness with console-error gate (HMR off, scripted eruption/hurricane)
- [x] ARCHITECTURE / ROADMAP / PROGRESS / DECISIONS / QUALITY_LOG / ART_DIRECTION
- [x] In-game perf overlay (F3)

## Phase 1 — Planet, LOD, terrain, camera, atmosphere, ocean
- [x] Cube-sphere grids, seeded noise, deterministic RNG
- [x] Tectonic terrain generation + hydraulic erosion; hydrology (lakes, rivers, valleys)
- [x] CDLOD quadtree terrain with geomorphing + skirts, horizon culling
- [x] Atmosphere scattering (LUT), volumetric clouds, aurora, stars, Milky Way, moon, tides, moonlight
- [x] Ocean: depth colour, foam, shore waves, fresnel, glint, sea ice
- [x] Post: bloom, ACES, god rays, flare (planet-occluded), vignette, grain, FXAA, DOF (photo mode)
- [x] Cinematic camera (grab, zoom-to-cursor, auto tilt, fly-to, follow, free)
- [x] Vegetation instancing near camera (9 kinds), grass blades, rocks, reeds

## Phase 2 — Climate, biomes, weather, day/night, seasons, terraforming
- [x] Climate model + emergent biomes (in sim)
- [x] Weather: fronts, hurricanes (named), blizzards, lightning, droughts
- [x] Rain/snow particles, rainbows
- [x] Terraforming brushes (raise, lower, smooth, flatten, flood, drain, biome paint)
- [x] Incremental hydrology/climate updates after edits

## Phase 3 — Ecology + dashboard
- [x] 8 plant species: spread, competition, seasonal dieback, fire
- [x] 8 herbivores, 5 predators; genetics, needs, herding, migration, predation, disease
- [x] Speciation/extinction records; ecosystem dashboard

## Phase 4 — Civilisation core
- [x] People agents (needs, skills, personality, family, memory of the god)
- [x] Tribes, camps → villages → towns → cities; visible construction
- [x] Economy: food, wood, stone, metal; conserving ledger; caravans and ships
- [x] Marriage across sister settlements; two life-years per world year

## Phase 5 — Tech, culture, religion, diplomacy, war
- [x] 52-tech tree, 8 ages; biome-specific architecture
- [x] Religion shaped by the god's deeds: tenets, scripture, prophets, pilgrims, schisms
- [x] Diplomacy: first contact (seafarers reach further), affinity, pacts, alliances, betrayal
- [x] War: armies with provisions, forced marches, naval invasions, sieges, conquest, refugees
- [x] Plague: natural outbreaks in crowded towns, carried by traders, pilgrims and refugees

## Phase 6 — Divine powers & disasters
- [x] 20 powers with costs, cooldowns, VFX, audio, consequences; 10 combos

## Phase 7 — Modes and meta
- [x] Sandbox with seed and presets; 8 scenarios (each scripted win and loss in tests)
- [x] Chronicle, time controls (pause/1×/10×/100×), time-lapse, tutorial, saves, settings
- [x] Title screen over the live planet, loading with real progress, photo mode, auto-director

## Phase 8 — Performance and robustness
- [x] Sim profiling and optimisation (LUT cellOf, half-rate animal needs, climate LUTs)
- [x] 500-year soak, scenario soak, 5-minute monkey test
- [~] Bench documentation (`scripts/bench.mts`), quality presets verified

## Phase 9 — Polish + delight
- [~] Visual quality loop (QUALITY_LOG.md)
- [x] Delight touches (see QUALITY_LOG.md)
- [ ] README with screenshots, FINAL_REPORT.md
