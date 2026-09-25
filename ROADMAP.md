# GENESIS — Roadmap

Legend: [x] done · [~] in progress · [ ] todo

## Phase 0 — Harness, tooling, docs
- [x] Vite + TS strict + three.js project, Vitest, Playwright (Chromium 141 / PW 1.56.1)
- [x] Headless WebGL2 via SwiftShader verified (float RT + float linear)
- [x] `npm run shots` screenshot harness with console-error gate
- [x] ARCHITECTURE / ROADMAP / PROGRESS / DECISIONS / QUALITY_LOG / ART_DIRECTION
- [ ] In-game perf overlay (F3)

## Phase 1 — Planet, LOD, terrain, camera, atmosphere, ocean
- [x] Cube-sphere grids, seeded noise, deterministic RNG
- [x] Tectonic terrain generation + hydraulic erosion
- [x] Hydrology: lakes, rivers, valley carving
- [x] CDLOD quadtree terrain with geomorphing + skirts, horizon culling
- [x] Atmosphere scattering (LUT), clouds, aurora, stars, Milky Way, moon, tides
- [x] Ocean: depth colour, foam, shore waves, fresnel, glint, sea ice
- [x] Post: bloom, ACES, god rays, flare, vignette, grain, FXAA
- [x] Cinematic camera (grab, zoom-to-cursor, auto tilt, fly-to, follow, free)
- [~] Vegetation instancing near camera (trees, rocks, reeds)
- [ ] Grass blades near the camera
- [ ] GATE: orbit + ground screenshots look stunning

## Phase 2 — Climate, biomes, weather, day/night, seasons, terraforming
- [x] Climate model + emergent biomes (in sim)
- [ ] Weather systems: storm fronts, hurricanes, blizzards, fog, drought oscillation
- [ ] Rain/snow particles, fog near camera
- [ ] Terraforming brushes (raise, lower, smooth, flatten, flood, drain, biome paint)
- [ ] Incremental hydrology/climate updates after edits

## Phase 3 — Ecology + dashboard
- [ ] Plant species grid (8 species): spread, competition, seasonal dieback
- [ ] 8 herbivores, 5 predators; genetics, needs, herding, migration, predation, disease
- [ ] Speciation/extinction records; ecosystem dashboard

## Phase 4 — Civilisation core
- [ ] People agents (needs, skills, personality, family, memory of the god)
- [ ] Tribes, villages → towns → cities; visible construction
- [ ] Economy: food, wood, stone, metal; logistics; trade caravans and ships

## Phase 5 — Tech, culture, religion, diplomacy, war
## Phase 6 — Divine powers & disasters (16+) with VFX + audio
## Phase 7 — Scenarios (8), chronicle, time-lapse, tutorial, saves, settings
## Phase 8 — Performance pass
## Phase 9 — Polish + delight pass
