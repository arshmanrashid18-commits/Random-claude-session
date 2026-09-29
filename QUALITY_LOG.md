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

## Pass 7 — fourth adversarial review

| Category | Pass 4 | Pass 5 | Pass 6 | Pass 7 |
|---|---|---|---|---|
| Visual beauty | 5 | 5 | 5 | 5 |
| Visual coherence | 4 | 3 | 4 | 4 |
| Polish / juice (visible) | 4 | 4 | 3 | 4 |
| First-impression wow | 4 | 4 | 5 | 4 |

A fourth consecutive round without meaningful movement. The reviewer's top three asks
were again approaches rather than bugs: one material language and scale for close-range
art, one depth-based water shader, and hero effects. Every concrete finding was checked
by cropping or by hiding components one at a time; the causes and fixes:

| Finding | Verdict | Root cause → fix |
|---|---|---|
| First frame of play is night | real | Begin flew to the largest settlement even at midnight (the Pass 6 fix covered scenarios only) → both open on the largest settlement in daylight; the capture now waits out the 4.5 s flight |
| Village river a milky sheet with white wavy outlines, fields and paths showing through | real | hiding lakes, then rivers, then the ocean isolated it: the river's lower reach is carved below sea level, so the *sea* fills it, shaded as sandy shallows with surf → water hemmed in by land is shaded as river water (no surf, optically deep); fields and roads are not drawn below sea level |
| Night town a tan blob with black holes | real | hiding the vegetation ruled out trees: the holes were the dark estuary and lakes over the lit ground → town lamps shimmer on nearby water; lights cluster toward the town's heart instead of a flat floor |
| Volcano plume cut off at the horizon | real | particles were drawn before the atmosphere composite, which added the whole ray's sky haze over any particle seen against the sky → particles now draw after the composite with a soft manual depth test |
| Crater a dark rectangle sprinkled with orange squares | real | lava sampled straight from 24-u region cells and cracks at 1–3 u aliasing → field sampled through a 12 u domain warp and lobe noise; cracks anti-aliased analytically, bright flow channels; snow melts round the field |
| Meteor a lone disc on the ground | real | the wake was emitted only at the head's current position, so frames far apart left dots or nothing → the wake is laid along the whole stretch fallen since the last frame, and the head is drawn out into a streak |
| Stars as fat blurry discs at night; an eight-ray flare beside the limb | real | the god-ray pass took bright *stars* as light sources and smeared them; the sun's flare switched on 45 u above the limb, while the sun was still behind the atmosphere → rays only from the sun, flare fades in across the shell |
| Starfield over sunlit mountains | real | star brightness was constant → a camera low over daylight is dazzled (stars fade), as in any daylight photograph |
| Orbit clouds as confetti | real | evenly scattered cells with paper-cut edges → cover saturates into systems with holes and clears outside them; edges thin into translucent veils from afar (three variants rendered and compared) |
| Hurricane a one-armed doughnut, no shadow on the sea | real | two broad arms → three tight bands with clear lanes; clouds now shade the ocean and lakes |
| Jagged "potato" limb | real | relief of up to 4% of the radius → relief at the silhouette flattened for distant cameras (shading keeps the full height field) |
| Lake an opaque mint sheet with white contour rings | real | shore-wave bands of constant depth drew a ring round every shallow bump; clear shallows showed the bed → no bands on lakes, darker inland water, optically deeper |
| Mountains as smooth clay (earlier passes) | real | the height field's resolution → ridged, weathered rock relief as a surface-gradient bump on steep ground to 1,400 u |
| Autumn forest reads as bread | real | pale orange blended with snow on leaves → deep amber, gold and crimson, little snow on turning leaves, darker crown undersides |
| Wildlife scene flat, no shadows | real | a noon sun put every shadow under its tree → mid-morning light |
| Reeds as black "barcodes"; white stone cubes; hut-sized boulders | real | hair-thin quads aliasing; pale quarry blocks; rock scale → broad blades, reeds only up close; quarry stone in rock greys; loose rocks halved |
| Times/DejaVu fallbacks everywhere | real | no bundled fonts → Cormorant Garamond, Inter and JetBrains Mono bundled (OFL, latin subsets) |
| Unpronounceable names | real | syllable concatenation → a pure letter-level pass trims clusters ("Tsoujlatltspec" → "Soujlaspec"); it draws no random numbers, so worlds and scenarios are unchanged (tests re-run) |
| "Disease spreads among…" six times in three years | real | epidemics were not merged → one sentence per year naming each herd |
| Modal over the date widget, text hard-clipped, inspector overlapping by 3 px | real | layout → panels clear the top bar, long pages fade out with a visible scrollbar, inspector moved down |
| Scenario goals at different heights | real | bottom-pinned goals of 2 and 3 lines → goals reserve three lines, so rows start level |
| Settlement label hides the town hall | real | anchored 6 u above the centre → hung above the rooftops with a leader line |
| Ecology chart: series flat on zero, unrounded ticks | real | linear axis → square-root scale with round ticks and a time axis |
| Title logo glow banding; dot grid | real | one wide strong glow on 8-bit output; film grain from a sin() hash that loses precision → two-layer glow; integer-hash grain |
| Faceted icosphere crowns beside the soft globe (the "two art languages") | real, partly | three.js icospheres are unindexed, so every blob was flat-shaded whatever its option said → blobs are welded and smooth-shaded, crowns carry billowy leaf-clump relief; rocks and buildings stay faceted |
| Trees bigger than huts | not a defect | a broadleaf crown is 6–10 m and a hut 4–5 m; the loose rocks were the scale breakers and are fixed |
| Aurora a flat green smear | partly open | the curtains are marched in the atmosphere pass; seen from 1,150 u they lie across the night side — left for the next pass |

### Found after Pass 7: the captures themselves were degraded

Night-sky stars were fat discs in the full screenshot run but pinpoints in every
isolated render of the same view at the same tick. Bisecting the run order showed the
cause was state carried between views, not the sky: the saved setting `quality: auto`
re-enabled the quality governor even when the URL pinned `?quality=high`, and over a
long software-rendered run the governor stepped the preset down. Every view after the
first few (fog, wildlife, village, night, storm, volcano and the interface captures)
was rendered at Medium or Low: lower resolution, fewer grass blades and cloud steps,
blurred stars. (The village view drew 53 calls in the run against 84 at true High.)
So Passes 4–7 judged partly degraded images, and the renderer benchmark's presets were
not what they claimed. A preset named in the URL now pins the session; all screenshots
and the benchmark are re-captured.

## Pass 8 — fifth adversarial review (first on true-High captures)

| Category | Pass 4 | Pass 5 | Pass 6 | Pass 7 | Pass 8 |
|---|---|---|---|---|---|
| Visual beauty | 5 | 5 | 5 | 5 | 5 |
| Visual coherence | 4 | 3 | 4 | 4 | 4 |
| Polish / juice (visible) | 4 | 4 | 3 | 4 | 5 |
| First-impression wow | 4 | 4 | 5 | 4 | 5 |

The best round so far (the reviewer put the title, terminator and coast at 6–7 and the
UI at about 7), but +1 in two categories is within the ±1 the reviewers swing between
rounds on unchanged images, so it is not counted as a meaningful improvement.
Findings and dispositions:

| Finding | Verdict | Root cause → fix |
|---|---|---|
| "Year 11" reads "Year II", "910" as "9IO", "0 new" as "O new" | real | the display face's default old-style figures → lining, tabular figures everywhere (the bundled subset carries `lnum`/`tnum`) |
| Tutorial "Click" in bare monospace | real | the keycap style was not applied inside the tutorial → it is |
| World name under the date at ~1.5:1 contrast | real | faint text colour → dim text colour, a size up |
| Scenario cards out of line by 4 px | harness | the pointer stayed over a card after the click (hover lifts it) → the capture parks the pointer |
| Ecology chart: four orange/salmon and two blue series | real | 13 series on 8 hues, matched only through the legend → each line labelled at its end, labels nudged apart |
| Ecology cut mid-content with no fade | partly | the fade was 30 px and easy to miss → 48 px |
| Meteor trail a vertical column from the top of the frame | real | the approach ran straight down the screen → it slants, and the wake widens and wanders as it ages |
| Meteor impact a "glass bubble" | explained | the crater lake the hydrology fills, lit by the fireball's glare |
| After the impact, the river "drawn over the smoke" | misread → real | the brown disc is the burn scar on the ground (the river rightly lies on it), drawn as even region-cell splats → burn and ash are broken up by noise into char, a singed rim and ash drifts |
| Volcano: grey translucent disc round the lava; red trees on the snow | real | ash as a flat region-cell tint; autumn crowns computed without the snow → patchy ash; no autumn colour under snow |
| Night town a hard-edged gold square; green specks on the lit rim | real | the glow sampled straight from the region cells; aurora curtains edge-on at the limb over the ground → the glow is sampled through a domain warp; the aurora fades at the limb for distant cameras over the ground as well as the sky |
| Title planet: neon-green smear on the lit edge | real | the same edge-on aurora |
| Ocean covered in single white pixels (fog view) | real | leaping-fish spray emitted for cameras up to 260 u, where it is one pixel → only below 110 u |
| Cloud bank with a vertical seam beside a mountain | partly | the march's step size and erosion detail came from the segment cut short by terrain → both now come from the uncut segment; what remains is the mountain's sheer flank seen through thin cloud |
| Huts as identical map pins | real | a cone in the people's colour on every apex → a smoke-hole collar and a wooden finial; the band under the eaves keeps the colour |
| Cacti inside oak woodland | real | cactus weight ignored the trees → none where trees grow |
| White poles in the forest | real | paper-white birch bark → pale grey bark |
| Lake almost white (coast) | real | full-strength sun glint on inland water → halved |
| Saturated rainbow across the whole sky | real | too strong → a faint veil |
| River a flat overlay whose width jumps at the village | open | the lower reach is carved below sea level, so the estuary is as wide as its valley; widening channels upstream would change the height field and the calibrated scenarios |
| Close-range art (cone pines, faceted cliffs, plain meadows) and the near/far palette gap | open | the reviewer's first recommendation in every round: rebuilding the close-range art in the globe's language (tri-planar rock, a unified biome palette, new tree species) is a rebuild, not a fix |
| Fireball, dust ring and debris; caldera geometry; lit smoke | open | effects are particles and terrain shading only; lit volumetric smoke and crater geometry are future work |

## Pass 9 — sixth adversarial review, and why the loop ends here

| Category | Pass 4 | Pass 5 | Pass 6 | Pass 7 | Pass 8 | Pass 9 |
|---|---|---|---|---|---|---|
| Visual beauty | 5 | 5 | 5 | 5 | 5 | 5 |
| Visual coherence | 4 | 3 | 4 | 4 | 4 | 4 |
| Polish / juice (visible) | 4 | 4 | 3 | 4 | 5 | 5 |
| First-impression wow | 4 | 4 | 5 | 4 | 5 | 5 |

Scores identical to Pass 8. The loop's exit rule is "every category 9+, or five
consecutive loops with no meaningful improvement (then explain why)". Passes 5 to 9 are
five such loops: no category ever moved more than one point from its Pass 4 score
(beauty never moved; coherence 3–4, polish 3–5, wow 4–5, going up and down between
rounds), and a fresh reviewer reads each round, so one point is within what a different
reader alone can change. Over those rounds about 130 concrete findings were verified and
fixed, each with its root cause above, and almost none recurred as stated. What did not
move is what the reviews ask for in their "three changes" every time:

1. **One art language from orbit to the ground.** The globe is shaded semi-physically; the
   props (trees, rocks, huts, people, animals) are procedural low-poly meshes. Soft
   foliage (Pass 7) and rock relief narrowed the gap but did not close it. Closing it means
   authored-quality models and tri-planar ground materials in the globe's palette, or a
   stylised globe: a rebuild of the close-range art, not a defect to fix.
2. **Water as carved channels.** Rivers are ribbons over a heightfield whose lower reaches
   were carved below sea level at world creation. Channels with banks that widen
   downstream need the generator to change, which reshapes every world and invalidates
   the eight calibrated scenarios (DECISIONS 50, 57).
3. **Hero effects.** Fireballs, dust curtains, caldera geometry and lit volumetric smoke are
   authored sequences in a studio pipeline; here they are particles and shading.

The limit is the approach and the environment (software rendering at 1280×720, no artist,
no paintovers), not a list of bugs, so a sixth loop of fixes would move the same ±1.

Pass 9 findings acted on:

| Finding | Verdict | Fix |
|---|---|---|
| "Hare" label cut by the top of the chart | real | end labels clamped inside the plot |
| "You cast Meteor upon Noukaih" reads like a template | real | each power has its own sentence ("You hurled a star at Noukaih.") |
| Double spaces between chronicle sentences | real | the sentence spans' side padding added to the space |
| Power slots showing "–" for a hotkey | real | unbound slots show nothing |
| Scaffolds as dotted debug-wireframe lines | real | poles thick enough to stay solid at village range |
| A lone orange "cone" at the end of the meteor's wake | real | flames have soft edges; the wake's flames are smaller and shorter-lived |
| A third of the wildlife frame is giant dark pine polygons | real | plants right against the lens dissolve; the view is lit from a mid-morning sun |
| A snowy pine at the lip of an erupting crater | real | nothing grows in lava or fresh ash |
| Rivers broken into dashes in the opening frame | real | ribbons never thinner than about two pixels (up to four times their width) |
| Grey cracked polygons on the volcano's snowfields (found in the final captures) | real | frozen lakes were still drawn at a tenth of their strength, so their ice pattern and cell edges showed → hidden entirely under the snow |
| Village untouched inside the meteor's scorch; fireball a "glass dome" | open | impact damage to buildings is drawn only as the population loss; the dome is the crater lake under the fireball's glare |
| Blurry terrain in the opening frame, orbit vs ground palette | open | region-cell climate and vegetation fields (64 per face) are the colour source at that height — the art-language gap above |

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
