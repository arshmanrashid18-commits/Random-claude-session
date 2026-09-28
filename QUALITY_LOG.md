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

## Pass 3 — self-scored (inflated; see Pass 4)

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

## Pass 4 — adversarial review

An independent reviewer (a separate agent with no stake in the work, told to be brutal)
looked at every landscape and interface capture. Its scores were far below mine:

| Category | Pass 3 (self) | Reviewer |
|---|---|---|
| Visual beauty | 9 | 5 |
| Visual coherence | 9 | 4 |
| Polish / juice (visible) | 9 | 4 |
| First-impression wow | 9 | 4 |

The Pass 3 scores were inflated: several of the reviewer's findings were real rendering
bugs I had looked at and not seen. Each finding was checked by cropping and zooming;
dispositions:

| Finding | Verdict | Root cause → fix |
|---|---|---|
| Grey sky slab with a hard edge (mountains, volcano) | real bug | the low-camera sky dome was added at full strength to any ray that clips the 90-u shell → weighted by the lowest altitude the ray passes through; the limb now fades into space |
| Fog "rectangle" with straight cuts (mountains) | real | edge-on cloud deck seen through a gap between silhouettes; the march ran to the far side of the shell with a fixed step count → march ends where the deck has dissolved, before the camera's own horizon; erosion LOD continuous; tops billow; haze by distance along the ray, not by what the ray hits |
| Straight seam in the shallows (coast) | real | not a face or LOD seam (tested by tinting faces, then by picking heights: a 1-u step in 5 px): the generator's shelf follows bilinearly upsampled coarse fields → gentle seabed relief below the shoreline in both terrain and water shading; terrain also shaded by the height field rather than the LOD mesh |
| Stair-stepped lakes, pale overlays (storm) | real | one quad per hydrology cell → a fringe ring clipped per pixel against the terrain so shores follow contours; distant lakes read as deep water |
| White halos round every coast (storm) | real | shore foam aliasing from orbit → fades beyond ~300–1,000 u |
| Faceted limb (storm) | real | coarse patches at the silhouette → silhouette-aware LOD in selection and geomorph |
| Meteor invisible while falling | real | approach fixed in world space came in low from the horizon, usually outside the view → falls from beyond the target, high in the watcher's sky |
| White square blob at impact | real | additive HDR stack (160 flames at 5×) and an unwindowed gaussian whose tail drew the quad → windowed sprites, dimmer orange fireball with its own smoke |
| Perfect beige ring over the ocean | real | a uniform band → a shock front: sharp leading edge, trailing dust, uneven round the ring, fading faster |
| "Candy corn" flames | real | identical HDR teardrops → varied size and heat, flickering outlines, yellow cores reddening |
| Lava as an orange rectangle, brown plume (volcano) | real | uniform glow over a coarse region cell, even down cliffs → dark crust with glowing veins in world-space noise, steep faces crust over; ash paler and varied |
| Milky river through the village | real | rivers were shaded with shore-wave foam along both banks → rivers have no shore waves |
| Neon greens vs the art direction | real | nature desaturated at the source (trees, grass, land); global saturation neutral; culture colours untouched |
| Night side murky brown-green | real | a scotopic shift: dim areas lose colour and cool toward blue; lamps and fires stay warm |
| Sticker-like starburst (night) | real | six long rays → short, uneven, two sets |
| Labels showing through panels; ghosted nameplate | real | labels hidden while a panel is open; close-range fade now only among the rooftops |
| Chronicle effect before cause; repeated era names | real | the year's top sentences are told in the order they happened; era names rotate per theme |
| Scenario cards misaligned and clipped | real | cards align to the top; the panel gets the room on sub-pages |
| "∞ boundless" in the captures | real | the capture script used the cheat; it now casts on the devotion the world earned |
| Moon shading ignores the sun | not a bug | the moon's normal is in world space; in the orbit shot the sun is behind the camera, so both planet and moon are full |
| Pale trunks without canopy (forest) | intended | snags — standing dead trees — are one of the vegetation types |
| Meteor captures frozen at the first instant | harness | simulation ticks jump instantly while effects age per rendered frame; captures now render enough frames for their moment |

Pass 5 below re-scores after these fixes, with the same reviewer brief.

## Pass 5 — second adversarial review

Same reviewer brief, fresh agent, no knowledge of what changed. Scores barely moved:

| Category | Pass 4 review | Pass 5 review |
|---|---|---|
| Visual beauty | 5 | 5 |
| Visual coherence | 4 | 3 |
| Polish / juice (visible) | 4 | 4 |
| First-impression wow | 4 | 4 |

Its verdict: "from orbit pleasant; at mid and ground zoom a good hobby or jam project,
not a studio". The Pass 4 fixes removed the bugs it had named (no finding repeated
verbatim), but the reviewer's core objection is the art itself: a near-photographic globe
beside chunky toy props, and a bleached palette. Findings and dispositions:

| Finding | Verdict | Fix |
|---|---|---|
| River a milky double ribbon over the village | real | ribbon no wider than its channel, optically deeper |
| Starfield over sunlit ground; rainbow across space; rainbow over near foliage | real | sky glow above the horizon for low cameras; rainbows only against a bright sky or distant land |
| Bleached sand everywhere; mountains read as dunes | real | grass at moderate moisture, gravel on dry uplands, rock in the art direction's greys |
| Volcano: blown-out snow; straight-edged "ice sheets"; square smoke; pixel checker lava | real | snow albedo lowered; lake fringes fade toward their outer side; smoke windowed; veins thinner |
| Meteor: crater a flat teal disc; fires as cones | partly | distant fires now soft glows; the disc is the crater lake the hydrology fills (kept) |
| Night side grey-olive; one light cluster; aurora a flat squiggle | real | half the moonlight; a floor on distant town lights; taller curtains |
| Green/magenta flecks at the limb; dark ring round the planet | real / physical | flecks were aurora curtains edge-on against space → faded for far cameras; the ring is the atmosphere's extinction of starlight (kept) |
| Chronicle under the power bar; inspector showing through; ragged header; black cooldown square | real | modal placement, opaque panels, header layout, lighter cooldown sweep |
| Lake white outline; reeds and fences aliasing | real / limit | faint lake lap instead of an outline; thin geometry aliasing is a limit of FXAA on SwiftShader |
| Hurricane like a "6" | seed | two hurricanes spinning side by side in this world at that moment (kept) |
| Roofs uniform straw, no banners | real | hut apex caps and house pennants in the people's colour |
| Title "S" collides with the planet | real | planet framed right of the wordmark |

Pass 6 re-scores after these fixes.

## Pass 6 — third adversarial review

| Category | Pass 4 | Pass 5 | Pass 6 |
|---|---|---|---|
| Visual beauty | 5 | 5 | 5 |
| Visual coherence | 4 | 3 | 4 |
| Polish / juice (visible) | 4 | 4 | 3 |
| First-impression wow | 4 | 4 | 5 |

Three reviews, no meaningful movement. Each round fixed every bug it named (none of the
Pass 4 or Pass 5 findings recur as stated), and each round found the next layer. Asked
for the single change that would most raise the scores, the reviewer answered with an
approach, not a bug: art-direct a fixed ladder of hero shots (orbit, descent, village
mid-zoom, one disaster) against paintovers every build — real ground materials, a water
shader that sits exactly on the terrain, consistently lit soft clouds, disasters as layered
sequences with light cast on their surroundings, and dense night-light clusters.

Findings and dispositions:

| Finding | Verdict | Fix |
|---|---|---|
| Night town a square amber sprite with black shapes punched through | real | distant buildings glow as lamplight at night |
| Lava a speckled rectangle with a straight top edge | real | lava field edges frayed by noise |
| Flat crackled "ice sheets" with straight edges | real | frozen lakes lie under the surrounding snow |
| Stars in the ocean | misread → real | they were raindrops seen from above; rain fades out by 70 u of altitude |
| River a frosted-glass strip | real | storm-rough normals on rivers mirrored a pale sky; rivers and lakes only ripple |
| Aurora vertical seam | real | noise on a ring instead of raw longitude (±180° jump) |
| Lake straight-edged tint patches, contour rings | real | fringe keeps the lake's tint; faint lake shore bands |
| Flat khaki ground at mid zoom | real | mid-scale variation (10–40 u) |
| Stars as fat discs in night shots | real | star peak brightness lowered below the bloom threshold |
| Inspector behind panels | real | hidden under modal panels |
| First frame 60% black void | real | the opening view looks sunward of the people at dusk |
| Thin volcano plume | harness | captured ~6 s into the eruption instead of 3 |
| Jagged limb and horizon | limit | FXAA on SwiftShader at DPR 1; the silhouette-aware LOD removed the faceting, the remaining steps are aliasing |
| Orbit clouds "torn paper"; hurricane rings | partly open | cloud edges from orbit remain crisp |
| Serif renders as Times; generated names hard to pronounce | open | no bundled fonts (zero external assets); the name generator is tied to the simulation's random stream and is left unchanged to keep the scenario calibration |

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
