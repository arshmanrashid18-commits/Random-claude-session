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
