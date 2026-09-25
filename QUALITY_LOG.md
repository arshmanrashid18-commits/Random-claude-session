# Quality Log

Scores 1–10 per category; anything below 8 is a defect.

## Pass 0.1 — first light (Phase 1, early)

Screens: orbit, terminator, coast, mountains (1280×720, High).

| Category | Score | Notes |
|---|---|---|
| Visual beauty | 4 | Orbit reads as a planet; close-ups were ugly (leopard-spot canopy, foil ocean, zebra rock strata, needle islands) |
| Visual coherence | 4 | Close and far looks disagree |
| Emergent storytelling | 1 | No life yet |
| Moment-to-moment fun | 1 | No interaction yet |
| Polish / juice | 2 | Loading screen only |
| Performance | ? | Not yet measured on GPU; sim gen 8 s |
| Stability | 6 | Zero console errors in harness |
| First-impression wow | 4 | Orbit + terminator promising |

Fixes applied after this pass: star PSF (chord distance, pixel-sized), sky/planet mask
bug (black ring), thicker atmosphere scale heights, cloud macro structure, calmer water
normals, Catmull-Rom heights, camera-independent detail, forest floor near camera,
rounded island arcs, lighter rock, no strata stripes, stronger sky ambient,
3D vegetation.

## Pass 1 — full harness run (all viewpoints, year 1 and year 3)

Screens: orbit, terminator, coast, mountains, forest, ground, night, aurora, storm,
wildlife, village, volcano (1280×720, High) + HUD, inspector, chronicle, meteor.

| Category | Score | Notes |
|---|---|---|
| Visual beauty | 6 | Ground-level palms/grass lovely; orbit clouds read as cotton balls; night side a black disc with a lens flare through the planet; forest viewpoint showed no forest |
| Visual coherence | 5 | Trees growing in lakes and through the village; cacti in meadows; sand under taiga; a white "plank" of water floating down a valley; checkerboard lakes |
| Emergent storytelling | 6 | Chronicle works but repeats "Drought grips …" six times a year; wars never fought (armies starved on the march) |
| Moment-to-moment fun | 6 | Powers satisfying; civilisation grew too slowly to watch towns form |
| Polish / juice | 7 | Labels, banners, ambient life present; rain streaks too bright, white ovals on the sea |
| Performance | 7 | Sim 2.3–2.6 ms/tick early game; renderer CPU 1–5 ms/frame (SwiftShader) |
| Stability | 8 | Zero console errors in harness; monkey harness raced intentional reloads |
| First-impression wow | 6 | Terminator and orbit good; close shots inconsistent |

Ten worst → fixes: (1) instanced renderers drew only their first 128–512 instances
(three.js caches the count per geometry) — most trees, and crowds, never appeared;
(2) vegetation not rebuilt after camera cuts; (3) trees in villages (clearings added);
(4) trees in lakes (lake mask); (5) night side black + flare through planet (moonlight,
planet occlusion); (6) cloud cells (domain warp, zonal stretch, mid-scale breakup);
(7) floating lake planks (cascading basins split) and checkerboard lakes (edge-exact
quads + shore rim); (8) rain end-on ovals / whitecap blobs; (9) rainbow drawn from orbit;
(10) chronicle spam (merged weather). Plus civilisation growth, working wars, plague
provenance and scenario retuning (see DECISIONS 28–34).

## Pass 2 — after fixes

| Category | Score | Notes |
|---|---|---|
| Visual beauty | 8 | Coast, mountains (oblique with planet curvature), village diorama, dense autumn forest, moonlit night side with city glow |
| Visual coherence | 8 | Clearings, lakes, rivers drape the terrain; steppe instead of sand in cold dry land; remaining: aurora curtains a little comb-like |
| Emergent storytelling | 9 | Wars with battles, conquests and refugees; plagues named with their carriers; merged chronicle |
| Moment-to-moment fun | 8 | Towns within ~20 world years; scenarios need the player (idle loses all eight) |
| Polish / juice | 8 | Rain subtle, rainbows only near the ground, labels and ambient life |
| Performance | 8 | Vegetation LOD (far silhouettes ~1/5 the triangles); sim ≈ 4.8 ms/tick at year 100 with 8,900 agents (bench) |
| Stability | 9 | Zero console errors in all harness runs; 150-year soak green |
| First-impression wow | 8 | Title over the live planet, terminator, village |

## Pass 3 — final

Screens: the full `npm run shots` set on the final code, the UI captures, two monkey runs
and the 500-year soak trajectory.

Five worst → fixes:
1. **No hurricane in the storm view.** A forced full-strength storm plus shader patches
   bisecting `cloudDensity` showed the spiral coverage was right but the fair-weather
   threshold and edge erosion left it a faint haze. Hurricanes now keep their own
   coverage past the weather mask with a density floor frayed by the noise: the storm
   view shows a named hurricane with an eye making landfall (DECISIONS 45).
2. **Polka dots over the poles.** Taken for a cloud lattice in Pass 2 — it was the sea-ice
   mask, one noise octave punching regular holes. Three octaves now give pack ice,
   floes and leads (DECISIONS 46).
3. **Aurora as a picket fence, and over a sunlit pole.** Curtains were sheets at fixed
   longitudes (radial spokes). They now fold along the oval, and the viewpoint looks at
   midnight under the winter hemisphere (DECISIONS 47).
4. **Towns at night as a saturated disc.** Far night lights are now clusters that
   sparkle like a city seen from orbit.
5. **Building list leak.** The 500-year soak showed crumbled ruins accumulating (17,578
   entries by year 500) and ms/tick creeping from 5 to 7.5. Their slots are now reused;
   the soak asserts the bound (DECISIONS 48).

| Category | Score | Notes |
|---|---|---|
| Visual beauty | 9 | Hurricane spiral over the ocean; aurora over a moonlit continent; coast, forest, village, mountains and volcano hold up close |
| Visual coherence | 9 | Pack ice instead of polka dots; vegetation, clearings, lakes and rivers agree near and far; models are stylised low-poly by design |
| Emergent storytelling | 9 | Wars, conquests, refugees, plagues with named carriers, schisms, scripture; merged chronicle |
| Moment-to-moment fun | 9 | Twenty powers with ten combos, terraforming; all eight scenarios won by play, lost by misrule and lost by idling |
| Polish / juice | 9 | Fifteen delight touches (below), labels, banners, pulses, ambient life, audio moods |
| Performance | 8 | Draw calls ≤ 81 and main-thread CPU ≤ 5.6 ms/frame at every preset; simulation 100× early, ~60× at year 100, ~42× with 10,000 agents; no GPU in this container to measure frame rates |
| Stability | 9 | 500-year soak green with bounded structures; two 5-minute monkey runs and every harness run with zero console errors |
| First-impression wow | 9 | Title over the live, lit planet; the terminator; the village diorama; the storm and aurora views |

Performance stays at 8, explained: the single simulation thread cannot hold 100× once
thousands of people and animals live (it shows the achieved rate instead), and real GPU
frame rates cannot be measured in a container that renders WebGL on the CPU.

## Delight pass

Small touches nobody asked for, each verified in a screenshot or in play:

1. Bird flocks wheel over green land by day (tangent-plane flocks, never through the ground).
2. Fireflies drift over warm meadows at night.
3. Autumn leaves fall from cooling broadleaf forests.
4. Shooting stars streak across clear night skies.
5. Whales breach and fish leap in coastal seas.
6. Campfires glow at the heart of settlements after dusk; chimney smoke rises from
   houses, more of it when the weather is cold.
7. Rainbows appear opposite a low sun when it rains around a low camera.
8. Map labels carry each people's procedural flag; hurricanes are named and
   categorised on the map.
9. The devotion orb pulses when a wave of faith arrives; power buttons flash when a
   cooldown ends.
10. The resurrected glow faintly for the rest of their lives.
11. Boats bob and roll on the swell; sails are dyed in the tribe's colour.
12. An eclipse shows a corona — and every mortal kneels.
13. Moonlight: the night side is a moonlit world whose brightness follows the phase.
14. Chronicle eras are named from what happened in them ("The Years of Wrath", "An
    Age of Spears", "The Years of Wonders").
15. Plagues are traced in the chronicle to the traders, pilgrims or refugees who
    carried them.
