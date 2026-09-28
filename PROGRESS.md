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
* Tests: 9 fast suites (25 tests); soak: scenarios (8 × win / lose / idle-loses, 24 tests),
  500-year soak with bounded structures (building slots reused, DECISIONS 48).
* Harness: `npm run shots` (12 viewpoints, zero console errors), UI captures, 5-minute
  monkey test (two seeds, zero errors), `scripts/perf.mjs` renderer table,
  `scripts/bench.mts` simulation table.
* Docs: README (screenshots, design notes), FINAL_REPORT (evidence, perf tables, scores,
  proudest, limitations, next five), QUALITY_LOG passes 0.1–3 and the delight list.

Final phase (Phase 9) status:
* Adversarial reviews: Pass 4 (5/4/4/4 on beauty/coherence/polish/wow) and Pass 5
  (5/3/4/4). Every finding verified and dispositioned in QUALITY_LOG; ~40 fixes across
  sky, clouds, water, lakes, terrain palette, fog (now rendered), VFX, night, UI.
* Fog: the simulated field (dawn cycle, rain washout, shores) is drawn in valleys, over
  the sea and around a camera standing in it; `fog` viewpoint and screenshot.
* Remaining known limitations are listed in FINAL_REPORT.md (no GPU in the container,
  single-threaded simulation below 100× at scale, stylised low-poly models, and the
  reviewer's view that the art reads as a strong indie rather than a studio title).

Next (if resumed): act on the latest review in QUALITY_LOG, re-run `npm run shots`,
the UI and title captures, `npm test`, and the soaks if simulation code changed.

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
