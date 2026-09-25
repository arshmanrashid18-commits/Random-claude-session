# GENESIS — Art Direction

## One style: *luminous stylised realism*

The planet should feel like a jewel held in the dark: physically plausible light
(atmospheric scattering, sun colour through air, ocean fresnel), rendered with a
painter's restraint. Forms are simplified and readable at every zoom; light is rich.

### Pillars

1. **Light tells the story.** Golden hours are warm and long, noon is clean, night is
   deep blue-black lit by amber civilisation and green aurora. Every surface takes its
   sun colour from the atmosphere transmittance, so dusk tints everything consistently.
2. **Readable at every scale.** From orbit: continents, weather systems, city lights.
   Mid zoom: biomes, rivers, roads, fields. Ground: silhouettes of trees, people and
   buildings that read instantly (chunky proportions, clear colour blocking).
3. **Soft forms, crisp accents.** Rounded low-poly foliage with flat-shaded facets for
   sparkle; smooth terrain; sharp specular glints on water and snow; warm emissive
   windows and fires.
4. **Nature first, then people.** Natural palettes are slightly desaturated earth
   tones; human-made things carry the saturated accent colours of their culture (flags,
   roofs, banners) so civilisation pops against the land.
5. **Divinity is luminous.** Divine powers are the only things allowed to glow cyan and
   gold; disasters use physically motivated emissive oranges (lava, fire, meteor) and
   grey ash.

### Palette

| Role | Colours (sRGB) |
|---|---|
| Deep ocean → shallows | `#02070F` → `#0B3B45` → `#2FA8A0` (turquoise shelves) |
| Lush grass / meadow | `#557F33` / `#72994A` |
| Dry grass / savanna | `#B8A862` / `#B39A57` |
| Desert sand / red sand | `#DBBD85` / `#CC8F5C` |
| Temperate canopy / conifer / jungle | `#33611F` / `#1F4029` / `#1A5421` |
| Rock light / dark | `#948A7D` / `#6B635C` |
| Snow | `#EDF2FA` |
| Civilisation warm light | `#FFB35C` |
| Divine accent | `#8FE3FF` (cyan), `#F2C572` (gold) |
| UI background | `#05070D` glass at 72% |

### Rules

* Tone mapping is ACES filmic with exposure ≈0.55; no pure white except sun, snow in
  direct sun and specular highlights.
* Bloom threshold is high: only emissives, sun glints and the sun itself bloom.
* Vignette ≈0.45, film grain ≈2%. Chromatic aberration only on impacts (disasters).
* Terrain never shows the underlying grid: all low-resolution fields (climate,
  vegetation) are sampled through noise-warped coordinates.
* UI: dark translucent glass panels, hairline gold borders, display type in a classic
  serif stack (letter-spaced caps for titles), body in the system sans. Motion eases out
  quickly (cubic-bezier(0.16,1,0.3,1)); nothing snaps.
