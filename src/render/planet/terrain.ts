/**
 * Terrain and ocean surfaces rendered as instanced quadtree patches.
 */
import * as THREE from 'three';
import { GLSL_ATMOSPHERE, GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_DETAIL, GLSL_HEIGHT, GLSL_NOISE, GLSL_REGION } from '../glsl/common';
import { GLSL_CLOUDS, GLSL_SKYLIGHT, GLSL_TERRAIN_ALBEDO } from '../glsl/surface';
import { LodSelector, MAX_LOD_LEVELS, type LodSettings } from './quadtree';
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

const TERRAIN_VS = /* glsl */ `
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
  float h = heightFaceAB(face, ab);
  vec3 wp0 = dir * (PLANET_R + h);
  float dist = distance(wp0, uCamPos);
  h += detailHeight(dir, h, dist);
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
uniform highp sampler2DArray uNormalTex;
uniform vec3 uCamPos;
uniform float uNightLights;
in vec3 vWorld;
in float vDist;

vec3 detailNormal(vec3 N, vec3 dir, float dist) {
  float fade = 1.0 - smoothstep(40.0, 220.0, dist);
  if (fade <= 0.0) return N;
  vec3 p = dir * PLANET_R * 0.9;
  float e = 0.35;
  float n0 = snoise(p);
  vec3 grad = vec3(snoise(p + vec3(e, 0.0, 0.0)) - n0, snoise(p + vec3(0.0, e, 0.0)) - n0, snoise(p + vec3(0.0, 0.0, e)) - n0) / e;
  grad -= dir * dot(grad, dir);
  return normalize(N - grad * 0.35 * fade);
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
  float shadow = cloudShadow(vWorld, L);
  // Terrain self-shadowing approximation: grazing sun on the far side of ridges.
  float horizon = smoothstep(-0.02, 0.12, mu + (dot(N, L) - mu) * 0.5);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 Hh = normalize(L + V);
  float spec = pow(max(dot(N, Hh), 0.0), mix(24.0, 90.0, si.wet)) * si.wet * 0.4;
  vec3 direct = sunCol * (si.albedo * ndl / PI + spec * ndl) * shadow * horizon;
  vec3 amb = skyAmbient(dir, N, L) * si.albedo * uSunIntensity * 0.06;
  vec3 color = direct + amb;
  // Underwater light absorption (seabed seen through the ocean surface).
  if (h < 0.0) color *= exp(-vec3(0.35, 0.12, 0.06) * min(-h, 30.0) * 0.35);
  // Emissive lava glow.
  color += vec3(4.0, 1.2, 0.25) * si.emissive * (0.7 + 0.3 * snoise(dir * 900.0 + uTime * 0.3));
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

export const OCEAN_SHADING = /* glsl */ `
vec3 waterNormal(vec3 dir, vec3 wp, float dist, float rough) {
  float fade = 1.0 - smoothstep(60.0, 900.0, dist);
  vec3 N = dir;
  if (fade <= 0.0) return N;
  vec3 p = wp * 0.35;
  float t = uTime;
  float e = 0.25;
  float n0 = snoise(p + vec3(t * 0.3, 0.0, t * 0.2)) + 0.5 * snoise(p * 2.3 - vec3(0.0, t * 0.5, t * 0.3));
  float nx = snoise(p + vec3(e, 0.0, 0.0) + vec3(t * 0.3, 0.0, t * 0.2)) + 0.5 * snoise((p + vec3(e, 0.0, 0.0)) * 2.3 - vec3(0.0, t * 0.5, t * 0.3));
  float ny = snoise(p + vec3(0.0, e, 0.0) + vec3(t * 0.3, 0.0, t * 0.2)) + 0.5 * snoise((p + vec3(0.0, e, 0.0)) * 2.3 - vec3(0.0, t * 0.5, t * 0.3));
  float nz = snoise(p + vec3(0.0, 0.0, e) + vec3(t * 0.3, 0.0, t * 0.2)) + 0.5 * snoise((p + vec3(0.0, 0.0, e)) * 2.3 - vec3(0.0, t * 0.5, t * 0.3));
  vec3 g = vec3(nx - n0, ny - n0, nz - n0) / e;
  g -= dir * dot(g, dir);
  return normalize(N - g * 0.06 * rough * fade);
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
  vec3 N = waterNormal(dir, wp, dist, 1.0 + storm * 2.0);
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = skyReflection(R, dir, L);
  // Sun glint (GGX-ish).
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  float a2 = 0.012 + storm * 0.03;
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
  // Whitecaps in storms.
  foam = max(foam, smoothstep(0.55, 0.95, snoise(wp * 0.25 + uTime * 0.4)) * storm * 0.7 * (1.0 - smoothstep(200.0, 900.0, dist)));
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
    this.oceanMat.dispose();
  }
}
