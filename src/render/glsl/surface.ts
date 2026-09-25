/**
 * Shared surface-shading GLSL: cloud density (used by the atmosphere pass and
 * for cloud shadows on the ground), sky ambient approximation, and the
 * terrain albedo model (biome palette driven by simulated climate).
 */

export const GLSL_CLOUDS = /* glsl */ `
uniform highp sampler3D uCloudNoise;
uniform float uTime;
uniform vec3 uCloudWind;
uniform float uCloudCoverBias;
// Storms (hurricanes, fronts, blizzards): xyz = centre dir, w = radius (rad)
uniform vec4 uStorms[8];
uniform vec4 uStormParams[8]; // x = intensity, y = spin, z = type (0 front,1 hurricane,2 blizzard)
uniform int uStormCount;

float remap(float v, float a, float b, float c, float d) { return c + (v - a) * (d - c) / (b - a); }

float stormCoverage(vec3 dir, out float swirl) {
  float cov = 0.0;
  swirl = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uStormCount) break;
    vec4 s = uStorms[i];
    vec4 sp = uStormParams[i];
    float d = acos(clamp(dot(dir, s.xyz), -1.0, 1.0));
    float r = d / s.w;
    if (r > 2.2) continue;
    if (sp.z > 0.5 && sp.z < 1.5) {
      // hurricane: spiral arms + clear eye
      vec3 t1 = normalize(cross(s.xyz, abs(s.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 t2 = cross(s.xyz, t1);
      vec3 q = dir - s.xyz * dot(dir, s.xyz);
      float ang = atan(dot(q, t2), dot(q, t1));
      float spiral = 0.5 + 0.5 * sin(ang * 2.0 * sp.y + log(max(r, 0.02)) * 7.0 - uTime * 0.6 * sp.y);
      float arms = mix(1.0, spiral, smoothstep(0.25, 0.8, r));
      float eye = smoothstep(0.05, 0.14, r);
      cov = max(cov, sp.x * arms * eye * (1.0 - smoothstep(0.9, 2.1, r)));
      swirl = max(swirl, sp.x * (1.0 - smoothstep(0.0, 1.8, r)));
    } else {
      cov = max(cov, sp.x * (1.0 - smoothstep(0.4, 1.6, r)));
    }
  }
  return cov;
}

// Returns cloud density in [0,1] at world position p (inside the shell).
float cloudDensity(vec3 p, float lod) {
  float r = length(p);
  float hf = (r - CLOUD_R0) / (CLOUD_R1 - CLOUD_R0);
  if (hf < 0.0 || hf > 1.0) return 0.0;
  vec3 dir = p / r;
  float swirl;
  float cov = texture(uClimateTex, regionUV(dir)).a;
  cov = max(cov, stormCoverage(dir, swirl));
  cov = clamp(cov * 1.05 + uCloudCoverBias, 0.0, 1.0);
  if (cov < 0.04) return 0.0;
  // Large-scale weather systems: low-frequency noise sculpts cloud fields
  // into fronts and cells; the climate cover decides where they can exist.
  vec3 qw = dir * 1.9 + uCloudWind * uTime * 0.35;
  float wx = texture(uCloudNoise, qw * 0.5).a * 0.55 + texture(uCloudNoise, qw * 1.4 + 0.37).a * 0.3 + texture(uCloudNoise, qw * 3.1 + 0.71).a * 0.15;
  cov = smoothstep(0.12, 0.75, cov);
  cov = clamp(cov * smoothstep(0.34, 0.66, wx) * 1.5, 0.0, 1.0);
  if (cov < 0.04) return 0.0;
  vec3 q = p * 0.0048 + uCloudWind * uTime;
  vec4 n = texture(uCloudNoise, q);
  float base = n.r * 0.65 + n.g * 0.35;
  // Height profile: flat-ish bases, rounded tops; storms tower.
  float prof = smoothstep(0.0, 0.12, hf) * (1.0 - smoothstep(mix(0.45, 1.0, cov), 1.0, hf));
  float d = remap(base * prof, 1.0 - cov * 0.92, 1.0, 0.0, 1.0);
  if (d <= 0.0) return 0.0;
  if (lod < 0.5) {
    float det = texture(uCloudNoise, q * 3.1 + vec3(0.3, 0.1, 0.7) * uTime * 0.02).b;
    d = remap(d, det * 0.35, 1.0, 0.0, 1.0);
  }
  return clamp(d, 0.0, 1.0);
}

// Cheap 2D cloud opacity along the sun direction for ground shadows.
float cloudShadow(vec3 wp, vec3 sunDir) {
  float r = length(wp);
  vec3 up = wp / r;
  float mu = dot(up, sunDir);
  if (mu < 0.02) return 1.0;
  float t = ((CLOUD_R0 + CLOUD_R1) * 0.5 - r) / mu;
  vec3 p = wp + sunDir * t;
  float d = cloudDensity(p, 1.0);
  return 1.0 - clamp(d * 1.6, 0.0, 0.78);
}
`;

export const GLSL_SKYLIGHT = /* glsl */ `
// Approximate sky irradiance on a surface with normal N at up direction 'up'.
vec3 skyAmbient(vec3 up, vec3 N, vec3 sunDir) {
  float sunH = dot(up, sunDir);
  float day = smoothstep(-0.18, 0.25, sunH);
  vec3 dayCol = vec3(0.30, 0.45, 0.75) * 0.9;
  vec3 duskCol = vec3(0.55, 0.32, 0.30) * 0.5;
  vec3 nightCol = vec3(0.012, 0.018, 0.035);
  vec3 sky = mix(nightCol, mix(duskCol, dayCol, smoothstep(0.0, 0.35, sunH)), day);
  float hemi = 0.55 + 0.45 * dot(N, up);
  return sky * hemi;
}
`;

export const GLSL_TERRAIN_ALBEDO = /* glsl */ `
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

struct SurfaceInfo {
  vec3 albedo;
  float wet;       // specular wetness
  float snow;
  float emissive;  // lava/fire glow strength
};

SurfaceInfo terrainSurface(vec3 dir, vec3 wp, float h, vec3 N, float cavity, float dist) {
  // Warp region lookups with noise so the coarse climate grid never shows.
  vec3 wn = vec3(snoise(dir * 38.0), snoise(dir * 38.0 + 11.3), snoise(dir * 38.0 - 7.1));
  vec3 wdir = normalize(dir + wn * 0.006);
  vec3 ruv = regionUV(wdir);
  vec4 clim = texture(uClimateTex, ruv);
  vec4 vA = texture(uVegATex, ruv);
  vec4 vB = texture(uVegBTex, ruv);
  vec4 surf = texture(uSurfaceTex, ruv);
  float temp = clim.r * 80.0 - 40.0;
  float moist = clim.g * 4.0;
  float snowCover = clim.b;

  float slope = 1.0 - clamp(dot(N, dir), 0.0, 1.0);
  float macro = fbm3(dir * 55.0);
  float micro = dist < 400.0 ? snoise(dir * 2600.0) * (1.0 - smoothstep(80.0, 400.0, dist)) : 0.0;

  // --- ground layer from climate
  vec3 sand = srgb(vec3(0.86, 0.74, 0.52));
  vec3 redSand = srgb(vec3(0.80, 0.56, 0.36));
  vec3 dryGrass = srgb(vec3(0.72, 0.66, 0.38));
  vec3 savanna = srgb(vec3(0.70, 0.60, 0.34));
  vec3 lush = srgb(vec3(0.33, 0.55, 0.20));
  vec3 meadow = srgb(vec3(0.45, 0.60, 0.26));
  vec3 tundra = srgb(vec3(0.52, 0.52, 0.40));
  vec3 soil = srgb(vec3(0.42, 0.34, 0.25));

  float wetness = smoothstep(0.35, 1.5, moist + macro * 0.25);
  float warm = smoothstep(8.0, 24.0, temp + macro * 3.0);
  vec3 desert = mix(sand, redSand, smoothstep(-0.2, 0.6, fbm3(dir * 21.0)) * 0.6);
  vec3 grass = mix(meadow, lush, smoothstep(1.0, 2.5, moist));
  grass = mix(grass, mix(dryGrass, savanna, warm), 1.0 - smoothstep(0.7, 1.4, moist));
  // Close-range ground detail: grass mottling, sand ripples, pebbles.
  float closeK = 1.0 - smoothstep(30.0, 140.0, dist);
  if (closeK > 0.0) {
    vec3 pp = dir * PLANET_R;
    float mott = snoise(pp * 0.9) * 0.5 + snoise(pp * 2.7) * 0.3;
    grass *= 1.0 + mott * 0.16 * closeK;
    grass = mix(grass, soil, smoothstep(0.55, 0.9, snoise(pp * 0.35 + 3.0)) * 0.35 * closeK);
    float ripple = sin(dot(pp, vec3(1.7, 0.4, 1.1)) * 2.2 + snoise(pp * 0.4) * 3.0) * 0.5 + 0.5;
    desert *= 1.0 + (ripple - 0.5) * 0.12 * closeK;
    float pebble = smoothstep(0.62, 0.8, snoise(pp * 3.3)) * closeK;
    desert = mix(desert, desert * 0.7, pebble * 0.5);
  }
  vec3 ground = mix(desert, grass, wetness);
  ground = mix(ground, tundra, 1.0 - smoothstep(-6.0, 3.0, temp + macro * 2.0));
  ground *= 0.9 + macro * 0.18 + micro * 0.08;

  // --- vegetation canopy (from the plant simulation)
  float grassD = vA.r, shrubD = vA.g, broad = vA.b, conifer = vA.a;
  float tropical = vB.r, xeric = vB.g, reeds = vB.b, moss = vB.a;
  vec3 cBroad = srgb(vec3(0.20, 0.38, 0.13));
  vec3 cConifer = srgb(vec3(0.12, 0.25, 0.16));
  vec3 cTrop = srgb(vec3(0.10, 0.33, 0.12));
  vec3 cShrub = srgb(vec3(0.40, 0.45, 0.24));
  vec3 cMoss = srgb(vec3(0.50, 0.55, 0.40));
  vec3 cReed = srgb(vec3(0.38, 0.48, 0.28));
  // Autumn colour for broadleaf forests when cooling.
  float autumn = smoothstep(12.0, 4.0, temp) * smoothstep(-4.0, 3.0, temp);
  cBroad = mix(cBroad, srgb(vec3(0.62, 0.36, 0.12)), autumn * 0.75);
  // Deciduous leaves drop in cold months.
  float leaf = smoothstep(-2.0, 5.0, temp);
  float trees = broad * mix(0.35, 1.0, leaf) + conifer + tropical;
  // Far away, forests read as a textured canopy; near the camera real 3D
  // trees take over and the ground beneath becomes forest floor.
  float nearTrees = 1.0 - smoothstep(220.0, 380.0, dist);
  float treeNoise = smoothstep(-0.35, 0.55, snoise(dir * 420.0) * 0.6 + snoise(dir * 1300.0) * 0.4 * (1.0 - nearTrees) + trees * 1.2 - 0.6);
  treeNoise = mix(treeNoise, 0.7, nearTrees);
  float canopy = clamp(trees * 1.2, 0.0, 1.0) * mix(0.55, 1.0, treeNoise);
  vec3 canopyCol = (cBroad * broad * leaf + cConifer * conifer + cTrop * tropical + ground * broad * (1.0 - leaf) * 0.8) / max(trees, 1e-3);
  canopyCol *= 0.85 + 0.3 * treeNoise;
  vec3 forestFloor = mix(srgb(vec3(0.24, 0.33, 0.14)), srgb(vec3(0.32, 0.33, 0.17)), smoothstep(-0.3, 0.5, macro));
  canopyCol = mix(canopyCol, forestFloor, nearTrees * 0.85);
  vec3 col = ground;
  col = mix(col, cShrub, clamp(shrubD * 0.6, 0.0, 0.5));
  col = mix(col, cMoss, clamp(moss * 0.6, 0.0, 0.6));
  col = mix(col, cReed, clamp(reeds * 0.7, 0.0, 0.7));
  col = mix(col, srgb(vec3(0.55, 0.50, 0.30)), clamp(xeric * 0.3, 0.0, 0.3));
  col = mix(col, canopyCol, canopy);
  // Grass fades in winter/drought.
  col = mix(col, col * vec3(1.08, 0.95, 0.75), clamp(1.0 - grassD * 1.4, 0.0, 1.0) * (1.0 - canopy) * 0.35);

  // --- rock on steep slopes, bare peaks
  vec3 rockA = srgb(vec3(0.55, 0.49, 0.42));
  vec3 rockB = srgb(vec3(0.38, 0.34, 0.30));
  float strata = sin(h * 0.9 + fbm3(dir * 60.0) * 2.5) * 0.5 + 0.5;
  vec3 rock = mix(rockB, rockA, 0.45 + strata * 0.15 + macro * 0.3 + micro * 0.1);
  float rockMask = smoothstep(0.34, 0.52, slope + macro * 0.07 + micro * 0.03);
  rockMask = max(rockMask, smoothstep(30.0, 42.0, h + macro * 5.0) * 0.8);
  col = mix(col, rock, rockMask);

  // --- beaches and shallow seabed
  float beach = (1.0 - smoothstep(0.25, 0.9, h + macro * 0.35)) * (1.0 - rockMask) * smoothstep(-4.0, 0.0, temp);
  col = mix(col, sand * (0.95 + micro * 0.05), beach * 0.9);
  if (h < 0.0) {
    vec3 seabed = mix(srgb(vec3(0.70, 0.64, 0.48)), srgb(vec3(0.20, 0.26, 0.28)), smoothstep(-1.0, -14.0, h));
    col = mix(col, seabed, smoothstep(0.2, -1.2, h));
  }

  // --- snow: simulated snow cover + permanent snowline on peaks
  float snowLine = smoothstep(26.0, 40.0, h + macro * 6.0) * smoothstep(12.0, 2.0, temp + 10.0);
  float snowAmt = clamp(snowCover * 1.6, 0.0, 1.0);
  snowAmt = max(snowAmt, snowLine);
  snowAmt *= 1.0 - smoothstep(0.35, 0.6, slope);
  snowAmt = smoothstep(0.25, 0.65, snowAmt + macro * 0.2 + micro * 0.05);
  if (h < -0.3) snowAmt *= 0.0;
  vec3 snowCol = srgb(vec3(0.93, 0.95, 0.98));
  col = mix(col, snowCol, snowAmt);

  // --- surface effects: burn scars, ash, development
  float burn = surf.r;
  col = mix(col, srgb(vec3(0.08, 0.07, 0.06)), burn * 0.85);
  col = mix(col, srgb(vec3(0.35, 0.34, 0.33)), surf.g * 0.8);
  col = mix(col, srgb(vec3(0.45, 0.38, 0.30)), surf.a * 0.35 * (1.0 - snowAmt));

  // Ambient occlusion from cavity (concave valleys darker).
  col *= clamp(1.0 - cavity * 0.04, 0.72, 1.06);

  SurfaceInfo si;
  si.albedo = col;
  si.wet = beach * 0.4 + snowAmt * 0.25 + (h < 0.3 ? 0.3 : 0.0);
  si.snow = snowAmt;
  si.emissive = surf.b;
  return si;
}
`;
