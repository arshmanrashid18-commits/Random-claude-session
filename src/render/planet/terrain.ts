/**
 * Terrain and ocean surfaces rendered as instanced quadtree patches.
 */
import * as THREE from 'three';
import { GLSL_ATMOSPHERE, GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_DETAIL, GLSL_HEIGHT, GLSL_NOISE, GLSL_REGION, GLSL_SEABED } from '../glsl/common';
import { GLSL_CLOUDS, GLSL_SKYLIGHT, GLSL_TERRAIN_ALBEDO, GLSL_FOG, GLSL_TOWNLIGHTS } from '../glsl/surface';
import { LodSelector, MAX_LOD_LEVELS, type LodSettings } from './quadtree';
import { GLSL_SHADOW_SAMPLE } from '../shadows';
import type { PlanetData } from './planetData';

/** Grid patch with skirts. position = (gx, gy, skirt) with gx, gy ∈ [0,1]. */
export function createPatchGeometry(G: number): THREE.InstancedBufferGeometry {
  const verts: number[] = [];
  const idx: number[] = [];
  const side = G + 1;
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) verts.push(i / G, j / G, 0);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const a = j * side + i, b = a + 1, c = a + side, d = c + 1;
      // Alternate diagonals for more isotropic triangulation.
      if ((i + j) % 2 === 0) idx.push(a, b, d, a, d, c);
      else idx.push(a, b, c, b, d, c);
    }
  }
  // Skirts along the four edges.
  const edge = (getIndex: (k: number) => number, flip: boolean) => {
    const start = verts.length / 3;
    for (let k = 0; k <= G; k++) {
      const vi = getIndex(k);
      verts.push(verts[vi * 3], verts[vi * 3 + 1], 1);
    }
    for (let k = 0; k < G; k++) {
      const a = getIndex(k), b = getIndex(k + 1), c = start + k, d = start + k + 1;
      if (flip) idx.push(a, c, b, b, c, d);
      else idx.push(a, b, c, b, d, c);
    }
  };
  edge((k) => k, false); // bottom (j = 0)
  edge((k) => G * side + k, true); // top
  edge((k) => k * side, true); // left
  edge((k) => k * side + G, false); // right
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  return geo;
}

export const TERRAIN_VS = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_HEIGHT}
${GLSL_NOISE}
${GLSL_DETAIL}
in vec4 aPatch;
in float aFace;
uniform float uGrid;
uniform float uRanges[${MAX_LOD_LEVELS + 1}];
uniform float uMorphStart;
out vec3 vWorld;
out float vDist;
void main() {
  int face = int(aFace + 0.5);
  int level = int(aPatch.w + 0.5);
  vec2 g = position.xy;
  vec2 ab = aPatch.xy + g * aPatch.z;
  vec3 d0 = faceABToDir(face, ab);
  float h0 = heightFaceAB(face, ab);
  vec3 toV = d0 * (PLANET_R + h0) - uCamPos;
  float len0 = length(toV);
  // Same limb factor as the CPU selection (limbScale in quadtree.ts).
  float ndv = abs(dot(d0, toV)) / max(len0, 1e-3);
  float dist0 = len0 * (1.0 - 0.65 * pow(1.0 - ndv, 4.0));
  float range = uRanges[level];
  float morph = clamp((dist0 - range * uMorphStart) / (range * (0.98 - uMorphStart)), 0.0, 1.0);
  vec2 gg = g * uGrid;
  gg -= fract(gg * 0.5) * 2.0 * morph;
  ab = aPatch.xy + (gg / uGrid) * aPatch.z;
  vec3 dir = faceABToDir(face, ab);
  float h = groundHeightFaceAB(face, ab, dir);
  // Seen from far off, relief right at the silhouette is flattened: mountains
  // 4% of the radius high made the outline lumpy (a potato against the smooth
  // atmosphere rim). Shading still uses the full height field, so only the
  // outline changes.
  float flatten = smoothstep(1200.0, 2800.0, length(uCamPos) - PLANET_R) * (1.0 - smoothstep(0.05, 0.4, ndv));
  h *= 1.0 - 0.7 * flatten;
  float dist = distance(dir * (PLANET_R + h), uCamPos);
  float skirt = position.z * (1.5 + aPatch.z * 45.0);
  vWorld = dir * (PLANET_R + h - skirt);
  vDist = dist;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const TERRAIN_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
precision highp sampler2DArray;
precision highp sampler3D;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_HEIGHT}
${GLSL_REGION}
${GLSL_NOISE}
${GLSL_SEABED}
${GLSL_ATMOSPHERE}
${GLSL_CLOUDS}
${GLSL_SKYLIGHT}
${GLSL_FOG}
${GLSL_TERRAIN_ALBEDO}
${GLSL_SHADOW_SAMPLE}
uniform highp sampler2DArray uNormalTex;
uniform vec3 uCamPos;
${GLSL_TOWNLIGHTS}
uniform float uBorders;
uniform vec3 uTribeCol[32];
in vec3 vWorld;
in float vDist;

// Territory: smooth iso-line between region cells owned by different tribes.
float ownerAt(ivec3 t) { return floor(texelFetch(uOwnerTex, t, 0).r * 255.0 + 0.5); }
float territory(vec3 dir, out float own) {
  vec2 ab;
  int f = dirToFaceAB(dir, ab);
  vec2 p = (ab + 1.0) * 0.5 * uRegionN + 0.5;
  vec2 i0 = floor(p);
  vec2 t = p - i0;
  ivec3 b = ivec3(int(i0.x), int(i0.y), f);
  float o00 = ownerAt(b), o10 = ownerAt(b + ivec3(1, 0, 0)), o01 = ownerAt(b + ivec3(0, 1, 0)), o11 = ownerAt(b + ivec3(1, 1, 0));
  own = t.x < 0.5 ? (t.y < 0.5 ? o00 : o01) : (t.y < 0.5 ? o10 : o11);
  float w = mix(mix(float(o00 == own), float(o10 == own), t.x), mix(float(o01 == own), float(o11 == own), t.x), t.y);
  return w;
}

// Ridged relief for weathered rock: x = height (world units), y and z = the
// squared ridge values of the coarse and fine octaves.
vec3 rockRelief(vec3 p, float fine) {
  float r1 = 1.0 - abs(snoise(p * 0.045));
  float r2 = fine > 0.0 ? 1.0 - abs(snoise(p * 0.14 + 3.3)) : 0.0;
  return vec3(r1 * r1 * 2.5 + r2 * r2 * 0.9 * fine, r1 * r1, r2 * r2);
}

vec3 detailNormal(vec3 N, vec3 dir, float dist) {
  float fade = 1.0 - smoothstep(40.0, 180.0, dist);
  if (fade <= 0.0) return N;
  // Gradient of the same detail field that displaces the vertices (so light
  // matches geometry), plus a faint finer layer for ground texture.
  vec3 p = dir * PLANET_R * 0.12;
  float e = 0.08;
  float n0 = snoise(p) * 0.6 + snoise(p * 2.3 + 5.1) * 0.25;
  vec3 g;
  g.x = snoise(p + vec3(e, 0.0, 0.0)) * 0.6 + snoise((p + vec3(e, 0.0, 0.0)) * 2.3 + 5.1) * 0.25 - n0;
  g.y = snoise(p + vec3(0.0, e, 0.0)) * 0.6 + snoise((p + vec3(0.0, e, 0.0)) * 2.3 + 5.1) * 0.25 - n0;
  g.z = snoise(p + vec3(0.0, 0.0, e)) * 0.6 + snoise((p + vec3(0.0, 0.0, e)) * 2.3 + 5.1) * 0.25 - n0;
  g = g / e * 0.12 * 0.3;
  vec3 q = dir * PLANET_R * 1.6;
  float m0 = snoise(q);
  vec3 g2 = vec3(snoise(q + vec3(0.2, 0.0, 0.0)) - m0, snoise(q + vec3(0.0, 0.2, 0.0)) - m0, snoise(q + vec3(0.0, 0.0, 0.2)) - m0) / 0.2;
  g += g2 * 0.02 * (1.0 - smoothstep(10.0, 60.0, dist));
  g -= dir * dot(g, dir);
  return normalize(N - g * fade);
}

void main() {
  float r = length(vWorld);
  vec3 dir = vWorld / r;
  // Shade by the height field itself, not the mesh's interpolated height: the
  // latter depends on each patch's level of detail, which drew straight seams
  // in sea-floor colour (seen through shallow water) along patch boundaries.
  float h = seabed(heightAtDir(dir), dir);
  vec2 ab;
  int f = dirToFaceAB(dir, ab);
  vec2 nuv = ((ab + 1.0) * 0.5 * uHeightN + 0.5) / (uHeightN + 1.0);
  vec4 nt = texture(uNormalTex, vec3(nuv, float(f)));
  vec3 N = normalize(nt.xyz);
  N = detailNormal(N, dir, vDist);
  SurfaceInfo si = terrainSurface(dir, vWorld, h, N, nt.w, vDist);
  // Weathered rock: ridged relief on steep ground, from the god's usual range
  // out to ~1,400 u (mountainsides read as smooth clay at the height field's
  // resolution). The bump's gradient is taken by finite differences in world
  // space (screen-space derivatives are constant over each 2×2 pixel quad and
  // drew stair-steps across snowfields); the finer octave fades out before it
  // would alias.
  float steepK = smoothstep(0.1, 0.34, 1.0 - dot(N, dir)) * smoothstep(0.3, 1.0, h) * (1.0 - smoothstep(900.0, 1400.0, vDist));
  if (steepK > 0.0) {
    vec3 pr = dir * PLANET_R;
    vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(dir, t1);
    float fineR = 1.0 - smoothstep(220.0, 520.0, vDist);
    float e = 0.6;
    vec3 rr0 = rockRelief(pr, fineR);
    vec3 rrA = rockRelief(pr + t1 * e, fineR);
    vec3 rrB = rockRelief(pr + t2 * e, fineR);
    vec3 bg = (t1 * (rrA.x - rr0.x) + t2 * (rrB.x - rr0.x)) / e * steepK;
    N = normalize(N - bg);
    // Crests catch light and weather pale; the clefts between them hold shadow.
    si.albedo *= mix(1.0, 0.8 + 0.3 * rr0.y + 0.08 * rr0.z * fineR, steepK);
  }
  // Screen footprint of this pixel on the ground (for analytic anti-aliasing).
  float footprint = length(fwidth(vWorld));

  vec3 L = uSunDir;
  float mu = dot(dir, L);
  vec3 sunCol = transmittanceToSun(r, mu) * uSunIntensity;
  float ndl = max(dot(N, L), 0.0);
  // Soften the terminator slightly (scattering in the canopy / subsurface).
  ndl = mix(ndl, smoothstep(-0.1, 0.4, dot(N, L)) * 0.5, 0.08);
  float shadow = cloudShadow(vWorld, L) * sunShadow(vWorld, N);
  // Terrain self-shadowing approximation: grazing sun on the far side of ridges.
  float horizon = smoothstep(-0.02, 0.12, mu + (dot(N, L) - mu) * 0.5);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 Hh = normalize(L + V);
  float spec = pow(max(dot(N, Hh), 0.0), mix(24.0, 90.0, si.wet)) * si.wet * 0.4;
  vec3 direct = sunCol * (si.albedo * ndl / PI + spec * ndl) * shadow * horizon;
  vec3 amb = skyAmbient(dir, N, L) * si.albedo * uSunIntensity * 0.1;
  vec3 color = direct + amb;
  // Underwater light absorption (seabed seen through the ocean surface).
  if (h < 0.0) color *= exp(-vec3(0.35, 0.12, 0.06) * min(-h, 30.0) * 0.35);
  // Lava: a dark crust split by glowing cracks; fresh flows run in bright
  // channels, and steep faces drain and crust over. The field lives in coarse
  // region cells: it is sampled through a ~12 u domain warp and shaped by
  // lobe noise so a flow never ends on a cell's straight edge, and the cracks
  // fade to their mean brightness where the screen cannot resolve them (they
  // aliased into a speckled checker at mid range).
  vec3 lw = vec3(snoise(dir * 90.0), snoise(dir * 90.0 + 5.2), snoise(dir * 90.0 - 3.7));
  float lava = texture(uSurfaceTex, regionUV(normalize(dir + lw * 0.012))).b;
  if (lava > 0.004) {
    vec3 q = dir * PLANET_R;
    float lobe = snoise(q * 0.05) * 0.65 + snoise(q * 0.13 + 2.1) * 0.35;
    float cover = smoothstep(0.05, 0.3, lava * (0.8 + 0.7 * lobe));
    float c1 = snoise(q * 0.14 + vec3(0.0, uTime * 0.02, 0.0));
    float c2 = snoise(q * 0.42 - vec3(uTime * 0.05, 0.0, 0.0));
    float f1 = footprint * 0.14 * 1.8, f2 = footprint * 0.42 * 1.8;
    float v1 = mix(1.0 - smoothstep(0.0, 0.07 + f1, abs(c1)), 0.2, smoothstep(0.12, 0.45, f1));
    float v2 = mix(1.0 - smoothstep(0.0, 0.06 + f2, abs(c2)), 0.15, smoothstep(0.12, 0.45, f2));
    float veins = max(v1, v2 * 0.55);
    float fresh = smoothstep(0.5, 0.95, lava);
    float flatK = smoothstep(0.45, 0.8, dot(N, dir));
    float fl = footprint * 0.05 * 1.8;
    float channel = mix(1.0 - smoothstep(0.0, 0.12 + fl, abs(lobe - 0.15)), 0.3, smoothstep(0.1, 0.4, fl)) * fresh;
    vec3 crust = vec3(0.035, 0.03, 0.028) * (0.35 + ndl) + vec3(0.05, 0.012, 0.0) * veins * fresh;
    color = mix(color, crust, cover * 0.9);
    float glow = (veins * mix(0.3, 1.0, fresh) + channel * flatK * 1.4) * cover * mix(0.2, 1.0, flatK);
    vec3 hot = mix(vec3(2.4, 0.5, 0.1), vec3(4.2, 1.7, 0.4), clamp(channel + veins * fresh * 0.5, 0.0, 1.0));
    color += hot * glow * (0.8 + 0.2 * snoise(q * 0.9 + uTime * 0.5));
  }
  vec3 ruv = regionUV(dir);
  // Floodwater: a muddy, reflective sheet over drowned land.
  float flood = texture(uFxTex, ruv).a;
  if (flood > 0.01 && h > -0.5) {
    float fw = smoothstep(0.01, 0.12, flood + snoise(dir * 1800.0) * 0.03);
    vec3 R = reflect(-V, dir);
    vec3 muddy = mix(vec3(0.16, 0.13, 0.08), vec3(0.06, 0.09, 0.08), smoothstep(0.1, 0.6, flood));
    vec3 water = muddy * (sunCol * max(mu, 0.0) * 0.35 + skyAmbient(dir, dir, L) * uSunIntensity * 0.05);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(V, dir), 0.0), 5.0);
    water += skyAmbient(dir, R, L) * uSunIntensity * 0.025 * fres;
    float ripple = snoise(dir * 3000.0 + uTime * 0.4) * 0.5 + 0.5;
    water *= 0.9 + ripple * 0.2;
    color = mix(color, water, fw * 0.88);
  }
  // Ground fog lying in the valleys and over low land (simulated field).
  float gfog = groundFog(dir, h);
  if (gfog > 0.0) color = mix(color, fogLight(dir, L, sunCol), gfog * 0.85);
  // Night: the lights of settlements.
  vec4 surf = texture(uSurfaceTex, ruv);
  float night = smoothstep(0.02, -0.12, mu);
  if (h > 0.0) color += townLights(dir, surf.a, vDist, night);
  // Borders between peoples, seen from afar.
  if (uBorders > 0.0) {
    float own;
    float w = territory(dir, own);
    float far = smoothstep(120.0, 500.0, vDist);
    if (own > 0.5 && far > 0.0) {
      vec3 tc = uTribeCol[int(own) - 1];
      float line = 1.0 - smoothstep(0.5, 0.72, w);
      float glow = mix(0.02, 0.12, night);
      color = mix(color, color * (0.6 + tc * 0.9), 0.18 * far * uBorders);
      color += tc * line * far * uBorders * (sunCol.g * 0.02 + glow * 2.0);
    }
  }
  outColor = vec4(color, 1.0);
}
`;

const OCEAN_VS = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_NOISE}
in vec4 aPatch;
in float aFace;
uniform vec3 uCamPos;
uniform vec3 uMoonDir;
uniform float uTideAmp;
uniform float uTime;
out vec3 vWorld;
out float vDist;
float tide(vec3 d) { float c = dot(d, uMoonDir); return uTideAmp * (1.5 * c * c - 0.5); }
void main() {
  int face = int(aFace + 0.5);
  vec2 ab = aPatch.xy + position.xy * aPatch.z;
  vec3 dir = faceABToDir(face, ab);
  float dist = distance(dir * PLANET_R, uCamPos);
  float wave = 0.0;
  float fade = 1.0 - smoothstep(30.0, 140.0, dist);
  if (fade > 0.0) {
    vec3 p = dir * PLANET_R;
    wave = (sin(dot(p, vec3(0.31, 0.12, -0.21)) + uTime * 1.3) * 0.12 + sin(dot(p, vec3(-0.17, 0.26, 0.19)) * 1.7 + uTime * 1.9) * 0.07) * fade;
  }
  float skirt = position.z * (1.0 + aPatch.z * 10.0);
  vWorld = dir * (PLANET_R + tide(dir) + wave - skirt);
  vDist = dist;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

export const DEPTH_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
void main() { outColor = vec4(1.0); }
`;

export const OCEAN_SHADING = /* glsl */ `
uniform float uNightLights;
vec3 waterNormal(vec3 dir, vec3 wp, float dist, float rough) {
  float fade = 1.0 - smoothstep(80.0, 1400.0, dist);
  vec3 N = dir;
  if (fade <= 0.0) return N;
  // Sum of directional swells (analytic derivatives) plus fine chop.
  vec3 ref = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 e1 = normalize(cross(ref, dir));
  vec3 e2 = cross(dir, e1);
  vec2 q = vec2(dot(wp, e1), dot(wp, e2));
  float t = uTime;
  vec2 g = vec2(0.0);
  vec2 d1 = normalize(vec2(0.8, 0.6)), d2 = normalize(vec2(-0.3, 0.95)), d3 = normalize(vec2(0.95, -0.3)), d4 = normalize(vec2(-0.7, -0.7));
  float k1 = 0.35, k2 = 0.62, k3 = 1.1, k4 = 1.9;
  g += d1 * k1 * cos(dot(q, d1) * k1 + t * 1.3) * 0.35;
  g += d2 * k2 * cos(dot(q, d2) * k2 + t * 1.8) * 0.18;
  g += d3 * k3 * cos(dot(q, d3) * k3 + t * 2.4) * 0.08;
  g += d4 * k4 * cos(dot(q, d4) * k4 + t * 3.1) * 0.04;
  float nearK = 1.0 - smoothstep(20.0, 200.0, dist);
  if (nearK > 0.0) {
    vec3 p = wp * 1.4 + vec3(t * 0.4, 0.0, t * 0.3);
    float n0 = snoise(p);
    g += vec2(snoise(p + e1 * 0.2) - n0, snoise(p + e2 * 0.2) - n0) * 0.25 * nearK;
  }
  g *= rough * fade;
  return normalize(N - (e1 * g.x + e2 * g.y) * 0.22);
}

vec3 skyReflection(vec3 R, vec3 up, vec3 L) {
  float sunH = dot(up, L);
  float day = smoothstep(-0.2, 0.2, sunH);
  float el = clamp(dot(R, up), 0.0, 1.0);
  vec3 zen = mix(vec3(0.004, 0.006, 0.014), vec3(0.10, 0.22, 0.52), day);
  vec3 hor = mix(vec3(0.01, 0.012, 0.02), mix(vec3(0.75, 0.42, 0.25), vec3(0.55, 0.68, 0.85), smoothstep(0.0, 0.4, sunH)), day);
  return mix(hor, zen, pow(el, 0.45)) * uSunIntensity * 0.06;
}

vec4 shadeWater(vec3 wp, vec3 dir, float depth, float dist, float lakeMode) {
  vec3 L = uSunDir;
  float r = length(wp);
  float mu = dot(dir, L);
  // Clouds shade the water as they shade the land (a hurricane cast no
  // shadow on the sea).
  vec3 sunCol = transmittanceToSun(r, mu) * uSunIntensity * cloudShadow(wp, L);
  vec3 V = normalize(uCamPos - wp);
  vec3 ruv = regionUV(dir);
  vec4 clim = texture(uClimateTex, ruv);
  float temp = clim.r * 80.0 - 40.0;
  float storm = clim.a;
  // Storm seas are rough; lakes and rivers only ripple (storm-rough normals
  // mirrored a pale sky and turned every river into a white strip).
  vec3 N = waterNormal(dir, wp, dist, mix(0.6 + storm * 1.6, 0.45 + storm * 0.3, clamp(lakeMode * 2.0, 0.0, 1.0)));
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = skyReflection(R, dir, L);
  // Sun glint (GGX-ish).
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float a2 = 0.03 + storm * 0.05;
  float dd = nh * nh * (a2 - 1.0) + 1.0;
  float ggx = a2 / (PI * dd * dd);
  vec3 spec = sunCol * ggx * fres * max(dot(N, L), 0.0) * 0.9;
  // Water body colour: absorption with depth.
  vec3 deep = vec3(0.006, 0.028, 0.07);
  // Inland water is darker and greener than the sandy sea shallows (a pale mint
  // lake read as an opaque sheet).
  vec3 shallow = mix(vec3(0.03, 0.26, 0.28), vec3(0.03, 0.14, 0.12), min(lakeMode, 1.0));
  vec3 body = mix(deep, shallow, exp(-depth * 0.16));
  float light = max(mu, 0.0) * 0.8 + 0.08 * smoothstep(-0.2, 0.2, mu);
  vec3 bodyLit = body * (sunCol * light * 0.35 + skyAmbient(dir, dir, L) * uSunIntensity * 0.05);
  float alpha = 1.0 - exp(-depth * 0.55);
  // Shore waves: bands of constant depth marching toward land.
  float band = sin(depth * 5.5 - uTime * 1.6 + snoise(wp * 0.08) * 2.0);
  // lakeMode: 0 sea, 1 lake, 2 river (rivers have no shore waves: their foam
  // bands along both banks made the channel read as a milky sheet). Blends
  // continuously between the three, for estuaries.
  float lakeT = clamp(lakeMode, 0.0, 1.0), riverT = clamp(lakeMode - 1.0, 0.0, 1.0);
  float shoreK = mix(1.0, 0.0, lakeT);
  float shoreFoam = smoothstep(0.75, 1.0, band) * (1.0 - smoothstep(0.0, 1.8, depth)) * shoreK;
  // Lakes have no surf, only a faint lap at the shore (bands of constant depth
  // drew white contour rings round every shallow bump, like a map).
  float edgeFoam = (1.0 - smoothstep(0.0, 0.35, depth)) * mix(mix(1.0, 0.1, lakeT), 0.0, riverT);
  float foamNoise = 0.6 + 0.4 * snoise(wp * 0.9 + uTime * 0.2);
  // Surf is a close-up detail: from orbit it would alias into dotted white rims.
  float foam = clamp((shoreFoam + edgeFoam * 0.8) * foamNoise, 0.0, 1.0) * (1.0 - smoothstep(300.0, 1000.0, dist));
  // Whitecaps: streaky, only under strong storm winds.
  float windy = smoothstep(0.55, 0.9, storm);
  if (windy > 0.0) {
    // Wind-torn foam: thin broken streaks, not blobs.
    float caps = smoothstep(0.78, 0.97, snoise(vec3(wp.x * 0.22, wp.y * 0.9, wp.z * 0.22) + uTime * 0.3));
    caps *= smoothstep(0.1, 0.8, snoise(wp * 1.3 + uTime * 0.5) * 0.5 + 0.5);
    foam = max(foam, caps * windy * 0.4 * (1.0 - smoothstep(150.0, 800.0, dist)));
  }
  vec3 foamCol = vec3(0.9, 0.95, 1.0) * (sunCol * max(mu, 0.0) * 0.3 + skyAmbient(dir, dir, L) * uSunIntensity * 0.06);
  // Inland water mirrors less of the pale analytic sky (lakes read as flat
  // silver sheets); their own dark body colour carries them.
  vec3 col = bodyLit * alpha + refl * fres * mix(1.0, 0.6, lakeT) + spec;
  float a = clamp(max(alpha, fres * 0.9), 0.0, 1.0);
  // At night the lamps of a town shimmer on its river and harbour (dark water
  // punched black holes through every lit town seen from afar).
  float nightW = smoothstep(0.02, -0.12, mu) * uNightLights;
  if (nightW > 0.0) {
    float dev = texture(uSurfaceTex, ruv).a;
    float shimmer = 0.55 + 0.45 * snoise(wp * 0.35 + vec3(0.0, uTime * 0.6, 0.0));
    float lamp = smoothstep(0.02, 0.4, dev) * nightW * shimmer;
    col += vec3(3.2, 1.6, 0.5) * lamp;
    a = max(a, lamp * 0.6);
  }
  col = mix(col, foamCol, foam * 0.85);
  a = max(a, foam * 0.85);
  // Sea ice.
  // Pack ice: large ragged sheets that break into floes toward the margin
  // (a single noise octave here read as a regular polka-dot pattern).
  // Fine floes and leads fade out with distance, where they would only alias.
  float iceFar = smoothstep(350.0, 1300.0, dist);
  float iceN = snoise(wp * 0.007) * 0.55 + snoise(wp * 0.023) * 0.3 + snoise(wp * 0.08) * 0.15 * (1.0 - iceFar);
  float ice = smoothstep(-1.0, -3.0, temp + iceN * 2.2);
  if (ice > 0.0) {
    float cracks = mix(smoothstep(0.02, 0.08, abs(snoise(wp * 0.12))), 0.85, iceFar);
    vec3 iceCol = mix(vec3(0.55, 0.68, 0.78), vec3(0.88, 0.92, 0.96), cracks);
    vec3 iceLit = iceCol * (sunCol * max(dot(dir, L), 0.0) / PI + skyAmbient(dir, dir, L) * uSunIntensity * 0.06);
    col = mix(col, iceLit, ice);
    a = mix(a, 1.0, ice);
  }
  return vec4(col, a);
}
`;

const OCEAN_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
precision highp sampler2DArray;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_HEIGHT}
${GLSL_REGION}
${GLSL_NOISE}
${GLSL_SEABED}
${GLSL_ATMOSPHERE}
${GLSL_SKYLIGHT}
uniform vec3 uCamPos;
${GLSL_CLOUDS}
${GLSL_FOG}
uniform vec4 uTsunami[4];
uniform float uTsunamiAmp[4];
${OCEAN_SHADING}
in vec3 vWorld;
in float vDist;
void main() {
  float r = length(vWorld);
  vec3 dir = vWorld / r;
  float ground = seabed(heightAtDir(dir), dir);
  float depth = (r - PLANET_R) - ground;
  if (depth < -0.02) discard;
  // Estuaries: the lower reaches of rivers are carved below sea level, and a
  // narrow inland channel shaded as open sea (sandy shallows seen through
  // clear water, surf on both banks) read as a milky ribbon through the
  // villages. Where land surrounds the water on most sides it is shaded as
  // river water: no surf, and optically deep like the river ribbons upstream.
  float riverK = 0.0;
  if (depth < 5.0) {
    vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(dir, t1);
    float land = 0.0;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472;
      land += smoothstep(-0.3, 0.8, heightAtDir(normalize(dir + (t1 * cos(a) + t2 * sin(a)) * (14.0 / PLANET_R))));
    }
    riverK = smoothstep(2.6, 4.4, land) * (1.0 - smoothstep(3.0, 5.0, depth));
  }
  float depthW = max(depth, 0.0);
  vec4 c = shadeWater(vWorld, dir, depthW + riverK * 2.5 * smoothstep(0.0, 0.6, depthW), vDist, riverK * 2.0);
  // Sea fog banks (the same simulated field), thickest near the shore.
  float sfog = fogField(dir);
  if (sfog > 0.0) {
    float k = sfog * 0.5;
    c = mix(c, vec4(fogLight(dir, uSunDir, transmittanceToSun(r, dot(dir, uSunDir)) * uSunIntensity), 1.0), k);
  }
  // Tsunami fronts: a white-crested wall of water racing outward.
  float px = max(1.5, vDist * 0.004);
  for (int i = 0; i < 4; i++) {
    float amp = uTsunamiAmp[i];
    if (amp <= 0.0) continue;
    float d = acos(clamp(dot(dir, normalize(uTsunami[i].xyz)), -1.0, 1.0)) * PLANET_R;
    float x = d - uTsunami[i].w;
    float crest = exp(-x * x / (px * px * 4.0)) * amp;
    float trough = exp(-(x + 8.0) * (x + 8.0) / (px * px * 30.0)) * amp * 0.4;
    vec3 L = uSunDir;
    float lit = max(dot(dir, L), 0.0) * 0.8 + 0.1;
    c.rgb = mix(c.rgb, vec3(0.9, 0.97, 1.0) * lit * uSunIntensity * 0.09, clamp(crest * 0.6, 0.0, 0.95));
    c.rgb *= 1.0 - clamp(trough * 0.3, 0.0, 0.5);
    c.a = max(c.a, clamp(crest, 0.0, 1.0));
  }
  outColor = vec4(c.rgb, c.a);
}
`;

export interface SharedUniforms {
  [k: string]: THREE.IUniform;
}

export class TerrainRenderer {
  readonly lod: LodSelector;
  readonly terrainMesh: THREE.Mesh;
  readonly oceanMesh: THREE.Mesh;
  private grid: number;
  private patchGeo: THREE.InstancedBufferGeometry;
  private oceanGeo: THREE.InstancedBufferGeometry;
  private instBuf: THREE.InstancedInterleavedBuffer;
  private waterBuf: THREE.InstancedInterleavedBuffer;
  readonly terrainMat: THREE.ShaderMaterial;
  readonly oceanMat: THREE.ShaderMaterial;
  readonly depthMat: THREE.ShaderMaterial;

  constructor(data: PlanetData, shared: SharedUniforms, lodSettings: LodSettings, gridSize: number) {
    this.grid = gridSize;
    this.lod = new LodSelector(data.pyramid, lodSettings, 6000);
    this.patchGeo = createPatchGeometry(gridSize);
    this.oceanGeo = createPatchGeometry(Math.max(8, gridSize / 2));
    this.instBuf = new THREE.InstancedInterleavedBuffer(this.lod.data, 5, 1);
    this.instBuf.setUsage(THREE.DynamicDrawUsage);
    this.patchGeo.setAttribute('aPatch', new THREE.InterleavedBufferAttribute(this.instBuf, 4, 0));
    this.patchGeo.setAttribute('aFace', new THREE.InterleavedBufferAttribute(this.instBuf, 1, 4));
    this.waterBuf = new THREE.InstancedInterleavedBuffer(this.lod.waterData, 5, 1);
    this.waterBuf.setUsage(THREE.DynamicDrawUsage);
    this.oceanGeo.setAttribute('aPatch', new THREE.InterleavedBufferAttribute(this.waterBuf, 4, 0));
    this.oceanGeo.setAttribute('aFace', new THREE.InterleavedBufferAttribute(this.waterBuf, 1, 4));

    this.terrainMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TERRAIN_VS,
      fragmentShader: TERRAIN_FS,
      uniforms: {
        ...shared,
        uNormalTex: { value: data.normalRT.texture },
        uGrid: { value: gridSize },
        uRanges: { value: Array.from(this.lod.ranges) },
        uMorphStart: { value: 0.7 },
      },
    });
    this.oceanMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: OCEAN_VS,
      fragmentShader: OCEAN_FS,
      uniforms: { ...shared },
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthWrite: true,
    });
    this.depthMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TERRAIN_VS,
      fragmentShader: DEPTH_FS,
      uniforms: this.terrainMat.uniforms,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 4,
    });
    this.terrainMesh = new THREE.Mesh(this.patchGeo, this.terrainMat);
    this.terrainMesh.frustumCulled = false;
    this.oceanMesh = new THREE.Mesh(this.oceanGeo, this.oceanMat);
    this.oceanMesh.frustumCulled = false;
    this.oceanMesh.renderOrder = 10;
  }

  setLod(settings: LodSettings): void {
    this.lod.settings = settings;
    this.lod.updateRanges();
    this.terrainMat.uniforms.uRanges.value = Array.from(this.lod.ranges);
  }

  update(camera: THREE.PerspectiveCamera): void {
    this.lod.select(camera);
    this.patchGeo.instanceCount = this.lod.count;
    this.oceanGeo.instanceCount = this.lod.waterCount;
    this.instBuf.clearUpdateRanges();
    this.instBuf.addUpdateRange(0, this.lod.count * 5);
    this.instBuf.needsUpdate = true;
    this.waterBuf.clearUpdateRanges();
    this.waterBuf.addUpdateRange(0, this.lod.waterCount * 5);
    this.waterBuf.needsUpdate = true;
  }

  get triangleEstimate(): number {
    return this.lod.count * (this.grid * this.grid * 2 + this.grid * 8);
  }

  dispose(): void {
    this.patchGeo.dispose();
    this.oceanGeo.dispose();
    this.terrainMat.dispose();
    this.depthMat.dispose();
    this.oceanMat.dispose();
  }
}
