/**
 * Shared GLSL chunks. Written by hand; composed into shaders by string
 * interpolation. All shaders use GLSL ES 3.00 (WebGL2) via three.js
 * RawShaderMaterial/ShaderMaterial with glslVersion = GLSL3.
 */
import { ATMOSPHERE_HEIGHT, CLOUD_BASE, CLOUD_TOP, PLANET_RADIUS } from '../../sim/constants';

const f = (x: number) => (Number.isInteger(x) ? `${x}.0` : `${x}`);

export const GLSL_CONSTANTS = /* glsl */ `
#define PI 3.14159265359
#define TAU 6.28318530718
const float PLANET_R = ${f(PLANET_RADIUS)};
const float ATMO_H = ${f(ATMOSPHERE_HEIGHT)};
const float ATMO_R = ${f(PLANET_RADIUS + ATMOSPHERE_HEIGHT)};
const float CLOUD_R0 = ${f(PLANET_RADIUS + CLOUD_BASE)};
const float CLOUD_R1 = ${f(PLANET_RADIUS + CLOUD_TOP)};
`;

/** Cube-sphere mapping identical to src/sim/planet/cubesphere.ts. */
export const GLSL_CUBESPHERE = /* glsl */ `
vec3 faceN(int f) {
  if (f == 0) return vec3(1.0, 0.0, 0.0);
  if (f == 1) return vec3(-1.0, 0.0, 0.0);
  if (f == 2) return vec3(0.0, 1.0, 0.0);
  if (f == 3) return vec3(0.0, -1.0, 0.0);
  if (f == 4) return vec3(0.0, 0.0, 1.0);
  return vec3(0.0, 0.0, -1.0);
}
vec3 faceU(int f) {
  if (f == 0) return vec3(0.0, 0.0, -1.0);
  if (f == 1) return vec3(0.0, 0.0, 1.0);
  if (f == 5) return vec3(-1.0, 0.0, 0.0);
  return vec3(1.0, 0.0, 0.0);
}
vec3 faceV(int f) {
  if (f == 2) return vec3(0.0, 0.0, -1.0);
  if (f == 3) return vec3(0.0, 0.0, 1.0);
  return vec3(0.0, 1.0, 0.0);
}
vec3 faceABToDir(int f, vec2 ab) {
  vec2 uv = tan(ab * 0.78539816339);
  return normalize(faceN(f) + uv.x * faceU(f) + uv.y * faceV(f));
}
// Returns face index; writes equi-angular params to ab.
int dirToFaceAB(vec3 d, out vec2 ab) {
  vec3 a = abs(d);
  int f;
  vec2 uv;
  if (a.x >= a.y && a.x >= a.z) {
    if (d.x > 0.0) { f = 0; uv = vec2(-d.z, d.y) / a.x; } else { f = 1; uv = vec2(d.z, d.y) / a.x; }
  } else if (a.y >= a.z) {
    if (d.y > 0.0) { f = 2; uv = vec2(d.x, -d.z) / a.y; } else { f = 3; uv = vec2(d.x, d.z) / a.y; }
  } else {
    if (d.z > 0.0) { f = 4; uv = vec2(d.x, d.y) / a.z; } else { f = 5; uv = vec2(-d.x, d.y) / a.z; }
  }
  ab = atan(uv) * 1.27323954474;
  return f;
}
`;

/** Heightmap sampling (R32F texture array, (N+1)² per layer), manual bilinear. */
export const GLSL_HEIGHT = /* glsl */ `
uniform highp sampler2DArray uHeightTex;
uniform float uHeightN;
float heightFaceAB(int f, vec2 ab) {
  vec2 p = clamp((ab + 1.0) * 0.5 * uHeightN, vec2(0.0), vec2(uHeightN));
  vec2 i0 = min(floor(p), vec2(uHeightN - 1.0));
  vec2 t = p - i0;
  ivec3 b = ivec3(int(i0.x), int(i0.y), f);
  float h00 = texelFetch(uHeightTex, b, 0).r;
  float h10 = texelFetch(uHeightTex, b + ivec3(1, 0, 0), 0).r;
  float h01 = texelFetch(uHeightTex, b + ivec3(0, 1, 0), 0).r;
  float h11 = texelFetch(uHeightTex, b + ivec3(1, 1, 0), 0).r;
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y);
}
float heightAtDir(vec3 d) {
  vec2 ab;
  int f = dirToFaceAB(d, ab);
  return heightFaceAB(f, ab);
}
`;

/** Region (climate/vegetation/surface) texture arrays: padded (n+2)² per face. */
export const GLSL_REGION = /* glsl */ `
uniform highp sampler2DArray uClimateTex;
uniform highp sampler2DArray uVegATex;
uniform highp sampler2DArray uVegBTex;
uniform highp sampler2DArray uSurfaceTex;
uniform float uRegionN;
vec3 regionUV(vec3 d) {
  vec2 ab;
  int f = dirToFaceAB(d, ab);
  vec2 uv = ((ab + 1.0) * 0.5 * uRegionN + 1.0) / (uRegionN + 2.0);
  return vec3(uv, float(f));
}
`;

/**
 * 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT) and derived
 * fractal helpers.
 */
export const GLSL_NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm3(vec3 p) {
  return snoise(p) * 0.5714 + snoise(p * 2.03 + 17.1) * 0.2857 + snoise(p * 4.07 - 9.3) * 0.1429;
}
float fbm4(vec3 p) {
  return snoise(p) * 0.5333 + snoise(p * 2.03 + 17.1) * 0.2667 + snoise(p * 4.07 - 9.3) * 0.1333 + snoise(p * 8.11 + 3.7) * 0.0667;
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
`;

/**
 * Procedural ground-detail height shared by terrain and every object placed
 * on the ground, so feet and foundations sit exactly on the rendered surface.
 */
export const GLSL_DETAIL = /* glsl */ `
uniform vec3 uCamPos;
float detailFade(float dist) { return 1.0 - smoothstep(60.0, 160.0, dist); }
float detailHeight(vec3 dir, float h, float dist) {
  float fade = detailFade(dist);
  if (fade <= 0.0) return 0.0;
  vec3 p = dir * (PLANET_R * 0.22);
  float n = snoise(p) * 0.55 + snoise(p * 2.7 + 5.1) * 0.22;
  float land = smoothstep(-0.5, 1.2, h);
  return n * fade * mix(0.25, 0.75, land);
}
`;

/**
 * Atmosphere model shared by the composite pass and surface shaders.
 * Rayleigh + Mie single scattering with a precomputed transmittance LUT
 * (Bruneton-style parameterisation: height × cos zenith).
 */
export const GLSL_ATMOSPHERE = /* glsl */ `
const vec3 BETA_R = vec3(0.0058, 0.0135, 0.0331) * 0.62;
const float BETA_M = 0.011;
const vec3 BETA_O = vec3(0.00065, 0.00188, 0.000085) * 0.9;
const float H_R = 12.0;
const float H_M = 2.6;
const float MIE_G = 0.78;
uniform sampler2D uTransmittanceLUT;
uniform vec3 uSunDir;
uniform float uSunIntensity;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
float phaseR(float mu) { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
float phaseM(float mu, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
// Ozone density: tent centred at 25% of atmosphere height.
float ozoneDensity(float h) { return max(0.0, 1.0 - abs(h - ATMO_H * 0.3) / (ATMO_H * 0.18)); }
vec2 lutUV(float r, float muS) {
  float h = clamp((r - PLANET_R) / ATMO_H, 0.0, 1.0);
  return vec2(clamp(muS * 0.5 + 0.5, 0.0, 1.0), sqrt(h));
}
vec3 transmittanceToSun(float r, float muS) {
  return texture(uTransmittanceLUT, lutUV(r, muS)).rgb;
}
`;

/** ACES filmic tone mapping (Stephen Hill's fit) and colour helpers. */
export const GLSL_TONEMAP = /* glsl */ `
const mat3 ACESInputMat = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777);
const mat3 ACESOutputMat = mat3(
  1.60475, -0.10208, -0.00327,
  -0.53108, 1.10813, -0.07276,
  -0.07367, -0.00605, 1.07602);
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFitted(vec3 color) {
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
