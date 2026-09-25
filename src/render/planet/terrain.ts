/**
 * Terrain and ocean surfaces rendered as instanced quadtree patches.
 */
import * as THREE from 'three';
import { GLSL_ATMOSPHERE, GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_DETAIL, GLSL_HEIGHT, GLSL_NOISE, GLSL_REGION } from '../glsl/common';
import { GLSL_CLOUDS, GLSL_SKYLIGHT, GLSL_TERRAIN_ALBEDO } from '../glsl/surface';
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
  float dist0 = distance(d0 * (PLANET_R + h0), uCamPos);
  float range = uRanges[level];
  float morph = clamp((dist0 - range * uMorphStart) / (range * (0.98 - uMorphStart)), 0.0, 1.0);
  vec2 gg = g * uGrid;
  gg -= fract(gg * 0.5) * 2.0 * morph;
  ab = aPatch.xy + (gg / uGrid) * aPatch.z;
  vec3 dir = faceABToDir(face, ab);
  float h = groundHeightFaceAB(face, ab, dir);
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
${GLSL_ATMOSPHERE}
${GLSL_CLOUDS}
${GLSL_SKYLIGHT}
${GLSL_TERRAIN_ALBEDO}
${GLSL_SHADOW_SAMPLE}
uniform highp sampler2DArray uNormalTex;
uniform vec3 uCamPos;
uniform float uNightLights;
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
  float h = r - PLANET_R;
  vec2 ab;
  int f = dirToFaceAB(dir, ab);
  vec2 nuv = ((ab + 1.0) * 0.5 * uHeightN + 0.5) / (uHeightN + 1.0);
  vec4 nt = texture(uNormalTex, vec3(nuv, float(f)));
  vec3 N = normalize(nt.xyz);
  N = detailNormal(N, dir, vDist);
  SurfaceInfo si = terrainSurface(dir, vWorld, h, N, nt.w, vDist);

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
  // Emissive lava glow.
  color += vec3(4.0, 1.2, 0.25) * si.emissive * (0.7 + 0.3 * snoise(dir * 900.0 + uTime * 0.3));
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
  // Night: the lights of settlements.
  vec4 surf = texture(uSurfaceTex, ruv);
  float night = smoothstep(0.02, -0.12, mu);
  if (night > 0.0 && surf.a > 0.02 && h > 0.0) {
    float speck = smoothstep(0.35, 0.9, snoise(dir * 2600.0) * 0.5 + snoise(dir * 700.0) * 0.5 + surf.a);
    float farGlow = smoothstep(200.0, 900.0, vDist);
    float lights = surf.a * mix(speck, 0.6, farGlow) * night * uNightLights;
    color += vec3(3.2, 1.9, 0.8) * lights * 0.9;
  }
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
  vec3 sunCol = transmittanceToSun(r, mu) * uSunIntensity;
  vec3 V = normalize(uCamPos - wp);
  vec3 ruv = regionUV(dir);
  vec4 clim = texture(uClimateTex, ruv);
  float temp = clim.r * 80.0 - 40.0;
  float storm = clim.a;
  vec3 N = waterNormal(dir, wp, dist, 0.6 + storm * 1.6);
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
  vec3 shallow = mix(vec3(0.03, 0.26, 0.28), vec3(0.05, 0.20, 0.16), lakeMode);
  vec3 body = mix(deep, shallow, exp(-depth * 0.16));
  float light = max(mu, 0.0) * 0.8 + 0.08 * smoothstep(-0.2, 0.2, mu);
  vec3 bodyLit = body * (sunCol * light * 0.35 + skyAmbient(dir, dir, L) * uSunIntensity * 0.05);
  float alpha = 1.0 - exp(-depth * 0.55);
  // Shore waves: bands of constant depth marching toward land.
  float band = sin(depth * 5.5 - uTime * 1.6 + snoise(wp * 0.08) * 2.0);
  float shoreFoam = smoothstep(0.75, 1.0, band) * (1.0 - smoothstep(0.0, 1.8, depth)) * (1.0 - lakeMode * 0.7);
  float edgeFoam = 1.0 - smoothstep(0.0, 0.35, depth);
  float foamNoise = 0.6 + 0.4 * snoise(wp * 0.9 + uTime * 0.2);
  float foam = clamp((shoreFoam + edgeFoam * 0.8) * foamNoise, 0.0, 1.0);
  // Whitecaps: streaky, only under strong storm winds.
  float windy = smoothstep(0.55, 0.9, storm);
  if (windy > 0.0) {
    // Wind-torn foam: thin broken streaks, not blobs.
    float caps = smoothstep(0.78, 0.97, snoise(vec3(wp.x * 0.22, wp.y * 0.9, wp.z * 0.22) + uTime * 0.3));
    caps *= smoothstep(0.1, 0.8, snoise(wp * 1.3 + uTime * 0.5) * 0.5 + 0.5);
    foam = max(foam, caps * windy * 0.4 * (1.0 - smoothstep(150.0, 800.0, dist)));
  }
  vec3 foamCol = vec3(0.9, 0.95, 1.0) * (sunCol * max(mu, 0.0) * 0.3 + skyAmbient(dir, dir, L) * uSunIntensity * 0.06);
  vec3 col = bodyLit * alpha + refl * fres + spec;
  float a = clamp(max(alpha, fres * 0.9), 0.0, 1.0);
  col = mix(col, foamCol, foam * 0.85);
  a = max(a, foam * 0.85);
  // Sea ice.
  float ice = smoothstep(-1.0, -3.5, temp + snoise(wp * 0.03) * 1.5);
  if (ice > 0.0) {
    float cracks = smoothstep(0.02, 0.08, abs(snoise(wp * 0.12)));
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
${GLSL_ATMOSPHERE}
${GLSL_SKYLIGHT}
uniform vec3 uCamPos;
uniform float uTime;
uniform vec4 uTsunami[4];
uniform float uTsunamiAmp[4];
${OCEAN_SHADING}
in vec3 vWorld;
in float vDist;
void main() {
  float r = length(vWorld);
  vec3 dir = vWorld / r;
  float ground = heightAtDir(dir);
  float depth = (r - PLANET_R) - ground;
  if (depth < -0.02) discard;
  vec4 c = shadeWater(vWorld, dir, max(depth, 0.0), vDist, 0.0);
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
