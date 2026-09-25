# Progress

## Current state

Working and verified (tests, screenshots or measurements):
* World generation (plates, ridged mountains, erosion, climate spin-up, hydrology) ≈ 8 s in the worker.
* Climate, weather (fronts, hurricanes, blizzards, lightning, droughts), emergent biomes.
* Ecology: 8 plant species, fire, 13 animal species with genetics, predation, disease,
  migration, speciation, extinction.
* Civilisation: tribes, settlements, logistics economy (conserving ledger), 52 techs,
  construction, colonisation; society layer (diplomacy, war with armies, trade caravans
  and ships, prophets, pilgrims, schisms, conversions).
* 20 divine powers with consequences, costs, cooldowns and 10 combos; terraforming.
* Rendering: CDLOD terrain, ocean, rivers/lakes, atmosphere, clouds, stars, aurora, moon,
  post chain, vegetation, grass, creatures, people (boats), buildings, VFX, precipitation.
* UI: title screen, HUD, power bar/wheel, feed, inspector, chronicle, ecology, peoples,
  settings (rebinding), help, saves (IndexedDB + export/import), tutorial, scenarios.
* Audio: generative score, ambience, spatial effects, UI sounds.
* Tests: 9 fast suites (determinism, sanity, save/load, economy, pathfinding, tech tree,
  powers + NaN scan, ecosystem, worker protocol); soak: scenarios, 500 years.

In progress:
* Scenario calibration (strategies in `tests/support/strategies.ts`).
* Performance pass (sim ≈ 2.3 ms/tick at ~3.5k animals; target ≤ 1.9 ms for true 100×).

Next:
1. Monkey test green; soak suite green.
2. Visual quality loop (screenshots of every viewpoint + UI), fix the worst.
3. README with screenshots, FINAL_REPORT.md, QUALITY_LOG passes, delight pass.

## How to resume

1. Read ARCHITECTURE.md, ROADMAP.md, DECISIONS.md, QUALITY_LOG.md, this file.
2. `npm install && npx tsc --noEmit && npm test`.
3. `npm run shots -- --only=orbit,village --out=/tmp/shots` and look at the images.
4. Debug scripts: `npx tsx scripts/debug/civ.ts <seed> <years> <every>`,
   `npx tsx scripts/debug/powers.ts`, `npx tsx scripts/debug/scenarios.ts <ids>`,
   `node scripts/debug/uicheck.mjs`, `node scripts/debug/title.mjs`.
