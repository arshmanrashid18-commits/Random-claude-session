# Progress

## Current state

Working and verified (tests, screenshots or measurements):
* World generation (plates, ridged mountains, erosion, climate spin-up, hydrology) ≈ 8 s in the worker.
* Climate, weather (fronts, named hurricanes, blizzards, lightning, droughts), emergent biomes.
* Ecology: 8 plant species, fire, 13 animal species with genetics, predation, disease,
  migration, speciation, extinction; every predator persists unattended for 12+ years.
* Civilisation: tribes, settlements (camp → village → town → city), logistics economy
  (conserving ledger), 52 techs / 8 ages, construction, colonisation, marriage across
  settlements, two life-years per world year (≈2,000 people by year 60, Age of Steam ≈ year 70).
* Society: diplomacy with affinity, pacts, alliances, betrayal; wars with provisioned
  armies, naval invasions, sieges, conquest, refugees; natural plague outbreaks carried
  along trade routes; prophets, pilgrims, schisms, conversions.
* 20 divine powers with consequences, costs, cooldowns and 10 combos; terraforming.
* Rendering: CDLOD terrain, ocean, rivers/lakes, atmosphere with moonlight, clouds, stars,
  aurora, moon, rainbows, post chain, vegetation (fixed instancing cap), grass, creatures,
  people, boats, buildings with clearings, VFX, precipitation, map labels.
* UI: title screen, HUD, power bar/wheel, feed, inspector, chronicle (merged weather),
  ecology, peoples, settings (rebinding), help, saves (IndexedDB + export/import),
  tutorial, 8 scenarios.
* Audio: generative score, ambience, spatial effects, UI sounds.
* Tests: 9 fast suites (25 tests); soak: scenarios (8 × win/lose, and idle loses), 150-year
  soak green; monkey test harness tolerates intentional save-load reloads.

In progress:
* Visual quality loop (full `npm run shots` after the instancing fix).
* 500-year soak with the faster-growing civilisation; performance at large populations.

Next:
1. Clean bench numbers → FINAL_REPORT perf section.
2. UI screenshots into docs/screenshots/ui (uicheck + title scripts).
3. Monkey test rerun; scenario soak rerun; QUALITY_LOG pass; FINAL_REPORT.

## How to resume

1. Read ARCHITECTURE.md, ROADMAP.md, DECISIONS.md, QUALITY_LOG.md, this file.
2. `npm install && npx tsc --noEmit && npm test`.
3. `npm run shots -- --only=orbit,village --out=/tmp/shots` and look at the images.
4. Debug scripts: `npx tsx scripts/debug/civ.ts <seed> <years> <every>`,
   `npx tsx scripts/debug/scenarios.ts <ids|""> <win|lose|idle|both|all>`,
   `npx tsx scripts/debug/rel.mts <seed> <years>` (diplomacy/war trace),
   `npx tsx scripts/bench.mts --years=N`, `node scripts/debug/vp.mjs <viewpoints>`
   (viewpoint probe + screenshot), `node scripts/debug/uicheck.mjs <outdir>`,
   `node scripts/debug/title.mjs <outdir>`.
