# Decisions

Each entry: decision — why.

1. **Scale: planet radius 1000 u, people ≈1.7 u tall.** A deliberately tiny planet keeps
   continents, cities and individuals legible in one continuous zoom without
   logarithmic depth buffers. Relief is exaggerated (±40 u) for drama from orbit.
2. **Equi-angular cube sphere.** Near-uniform cells (≤1.4× area ratio) with a closed
   form inverse, needed for fast direction→cell lookups in the sim and shaders.
3. **Vertex-centred heightmap with duplicated edges.** Shaders can bilinear/cubic sample
   within a face without neighbour lookups; duplicates are synced after every edit.
4. **Fixed tick (4/s at 1×), speed = ticks per second.** Determinism does not depend on
   the chosen speed; the renderer interpolates. 1 day = 160 ticks, 1 year = 6 days so a
   civilisation's arc plays out in ~20–40 minutes at 100×.
5. **Transferable ping-pong buffers instead of SharedArrayBuffer.** SAB requires
   COOP/COEP headers that break static hosting; transfers are cheap at our sizes.
6. **Climate amortised over 8 ticks, double-buffered.** Keeps per-tick cost low at 100×
   while remaining deterministic (each slice only reads the previous state).
7. **Precipitation by critical relative humidity.** Fixed-fraction rain terms drained
   air before it reached continental interiors; lowering the RH threshold for lifting
   mechanisms (convection, fronts, orography) and raising it for subsidence produced
   rainforests, subtropical deserts and rain shadows.
8. **ShaderMaterial + GLSL3 with explicit `outColor`.** three r186 no longer aliases
   `gl_FragColor` in GLSL3 mode.
9. **Camera-independent ground height (Catmull-Rom + detail noise) with an exact CPU
   port.** Static objects are seated on the rendered surface without per-vertex height
   evaluation; the port matches the GPU within 1e-4 (float32 constants emulated with
   `Math.fround`).
10. **Cloud noise volume generated on the CPU at load.** 64³ Perlin-Worley in ~0.3 s runs
    in parallel with world generation in the worker; no asset files.
11. **Vegetation as instanced procedural archetypes placed on a hashed lattice.**
    World-stable (no swimming), budgeted per quality preset, fades in/out by shrinking.
12. **Divine powers act on simulation state only; visuals are derived.** Every power writes
    to climate fields, plants, animals, people, buildings or terrain inside the worker; the
    renderer reads the resulting fields (fire, lava, flood, ash) and a small effect list.
    This keeps powers deterministic, saveable and testable.
13. **Mortals witness acts, not the player.** Faith (love/fear) rises for people within a
    radius, weighted by piety; memories are per person (indices into a bounded memory
    list with an absolute base) and per tribe (scripture, epithets, sacred sites).
14. **Society as one module (diplomacy, war, trade, religion).** They share the same
    inter-settlement machinery (paths, agents with intents), so they live together in
    `sim/civ/society.ts`, driven by the civ tick.
15. **Armies are ordinary people with an army id.** Marching, fighting, fleeing and
    conquest emerge from people-level behaviour and combat rolls; no abstract battles.
16. **Generic identity-preserving save format.** The whole object graph is walked with a
    class registry (names are not trusted after minification); typed arrays go in a
    binary blob; gzip via CompressionStream. Loading restarts the page into the saved
    world, which guarantees a clean renderer state.
17. **Scenario objectives live in the simulation.** Status is computed deterministically
    and saved with the world; `tests/support/strategies.ts` plays scripted winning and
    losing strategies for every scenario in the soak suite.
18. **Aerial perspective compressed near the camera, clouds part around it.** The
    atmosphere is physically scaled for the planet; at village range it read as fog, so
    haze ramps in with distance (full strength by ~1100 u) and clouds fade within a
    distance proportional to camera altitude.
19. **Animal needs updated every other tick at double rate.** Halves the dominant cost
    of the animal loop with no visible change; movement stays per tick so interpolated
    motion is smooth.
20. **Planner only starts what can be finished.** Metal-using buildings wait for a mine;
    untouched sites are cancelled after two years with materials refunded. This removed
    a deadlock that froze settlement growth.
21. **Fire has firebreaks and burns out.** Settlements clear and watch their ground,
    cells burn out within dozens of ticks and people flee toward burnt ground. Before,
    single fires wiped out whole villages.
22. **Faith fades without signs.** Fear decays ~5%/year, love ~1%/year, so devotion is an
    ongoing relationship rather than a one-off purchase.
23. **Presentation randomness is allowed on the main thread.** The auto-director and
    particle jitter use their own RNG or `Math.random`; they never touch the simulation.
24. **Procedural audio starts on the first user gesture.** Browsers block autoplay;
    the score, ambience and effects are synthesised with WebAudio nodes and a
    generated reverb impulse, mixed through a limiter.
25. **Big cats eat less often.** Lions and jaguars starved slowly even while their prey
    boomed (hunting is opportunistic and rainforest prey is sparse). Their metabolism was
    lowered ~15–20% and jaguars may also take gazelles at the savanna edge; over 12
    unattended years every predator now persists with boom/bust cycles.
26. **Phase tags are local.** Every phase is tagged (`phase-1` … `phase-9`) in the local
    repository; the session's git remote only accepts the development branch (tag pushes
    return HTTP 403), so the tags are not on the remote.
27. **Monkey test tolerates intentional reloads.** Loading a save reloads the page (the
    world is rebuilt from the save before the worker starts); the monkey harness waits for
    the new page instead of counting the navigation as a failure. Console errors on either
    page still fail it.
28. **Two life-years per world year.** A world year is one seasonal cycle (4 min at 1×).
    With one life-year per world year a generation took the whole first hour, so
    settlements stayed child-heavy villages. People now age two years per world year
    (mortality scaled to match), so villages become towns in ~20 world years and cities
    within a long session. Seasons, crops and weather keep their own clock.
29. **Marriages cross settlements.** Small bands exhaust their marriage market quickly
    (and founders with unknown mothers were wrongly treated as siblings). A woman with no
    match at home is betrothed to a single man of a sister settlement, who walks there
    along a real path.
30. **Diplomacy has temperament.** Each pair of peoples gets a fixed cultural affinity at
    first contact (±0.4) so relations polarise into friends and rivals; seafaring peoples
    make contact further away. Before, relations hovered near zero and neither pacts nor
    wars ever triggered.
31. **Armies march on their stomachs.** Campaigns cross hundreds of units, so soldiers
    carry provisions (armies are only as large as the stores can feed), forage on the way,
    force-march at 1.5×, rejoin their column after fleeing fire, and may sail if the
    attacker knows sailing and both towns are coastal. Unreachable campaigns give up.
32. **Plague has provenance.** Crowded towns without sanitation breed outbreaks; sick
    traders, pilgrims and refugees carry them on. The chronicle names the carrier and the
    town it came from.
33. **Research grows sub-linearly with population** (adults^0.75) so large peoples do not
    exhaust the tech tree within a session.
34. **Scenarios must not be won by idling.** Each scenario is checked with a scripted
    winning strategy, a losing strategy and doing nothing; objectives were retuned until
    idling loses (The Long Drought's rains fail every year; Two Faiths' peace only holds
    under a divine truce; First Flame needs Bronze within 12 years; The Chosen need a
    settlement of 100 within 25 years).
35. **The god can see at night.** Sky ambient gains a phase-weighted cool moonlight so the
    night side reads as a moonlit world rather than a black disc; the lens flare is
    occluded by the planet.
