/**
 * Instanced 3D vegetation and rocks near the camera.
 *
 * Placement is deterministic and world-stable: candidate points are hashed
 * from heightmap cells, accepted according to the simulated plant densities
 * and chosen species, then seated exactly on the rendered ground with the CPU
 * port of the shader height function. Trees fade (shrink) in and out at the
 * edge of the vegetation radius where the terrain's far canopy shading takes
 * over, so there is no popping.
 */
import * as THREE from 'three';
import { GLSL_CONSTANTS } from './glsl/common';
import { GLSL_FRAME, OBJECT_FS_HEAD } from './glsl/objects';
import { MeshBuilder, lin } from './meshkit';
import { faceABToDir, FACE_N, FACE_U, FACE_V } from '../sim/planet/cubesphere';
import { PLANET_RADIUS } from '../sim/constants';
import { hash4 } from '../core/rng';
import { groundHeight } from './groundHeight';
import type { PlanetData } from './planet/planetData';
import { DEPTH_FS, type SharedUniforms } from './planet/terrain';

export const VEG_TYPES = ['broadleaf', 'conifer', 'palm', 'cactus', 'bush', 'snag', 'rock', 'reeds', 'birch'] as const;
export type VegType = (typeof VEG_TYPES)[number];

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const E = (x: number, y: number, z: number) => new THREE.Euler(x, y, z);

function buildModel(type: VegType): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const bark = lin(0x5a4230), barkLight = lin(0xb9b2a4);
  switch (type) {
    case 'broadleaf': {
      b.cylinder(0.2, 0.36, 3.2, 7, V3(0, -0.4, 0), { color: bark, jitter: 0.15, ao: 0.4 });
      b.cylinder(0.08, 0.14, 1.6, 5, V3(0, 2.2, 0), { color: bark, sway: 0.2 }, E(0, 0, 0.9));
      b.cylinder(0.08, 0.14, 1.5, 5, V3(0, 2.0, 0), { color: bark, sway: 0.2 }, E(0.8, 0, -0.5));
      const leaf = lin(0x3d6526), leaf2 = lin(0x4b7530), leaf3 = lin(0x355a22);
      b.blob(1.9, 1, V3(0, 4.6, 0), V3(1.1, 0.85, 1.1), { color: leaf, sway: 0.7, jitter: 0.25, ao: 0.45, flat: true });
      b.blob(1.4, 1, V3(1.2, 3.9, 0.3), V3(1, 0.85, 1), { color: leaf2, sway: 0.7, jitter: 0.25, ao: 0.5, flat: true });
      b.blob(1.3, 1, V3(-1.1, 4.0, -0.4), V3(1, 0.85, 1), { color: leaf3, sway: 0.7, jitter: 0.25, ao: 0.5, flat: true });
      b.blob(1.2, 1, V3(0.2, 5.6, -0.3), V3(1, 0.9, 1), { color: leaf2, sway: 0.8, jitter: 0.25, ao: 0.3, flat: true });
      break;
    }
    case 'birch': {
      b.cylinder(0.12, 0.2, 4.4, 7, V3(0, -0.4, 0), { color: barkLight, jitter: 0.2, ao: 0.3 });
      const leaf = lin(0x6b8e36), leaf2 = lin(0x7d9c40);
      b.blob(1.15, 1, V3(0, 4.6, 0), V3(0.95, 1.35, 0.95), { color: leaf, sway: 0.8, jitter: 0.3, ao: 0.4, flat: true });
      b.blob(0.95, 1, V3(0.55, 3.5, 0.2), V3(1, 1.15, 1), { color: leaf2, sway: 0.8, jitter: 0.3, ao: 0.45, flat: true });
      b.blob(0.9, 1, V3(-0.5, 3.8, -0.3), V3(1, 1.15, 1), { color: leaf, sway: 0.8, jitter: 0.3, ao: 0.45, flat: true });
      b.blob(0.8, 1, V3(0.1, 2.8, 0.45), V3(1, 1.1, 1), { color: leaf2, sway: 0.7, jitter: 0.3, ao: 0.5, flat: true });
      break;
    }
    case 'conifer': {
      b.cylinder(0.16, 0.3, 2.2, 6, V3(0, -0.4, 0), { color: bark, ao: 0.4 });
      const needle = lin(0x1f3d28), needle2 = lin(0x284a31);
      const tiers = [[2.3, 2.6, 1.2], [1.9, 2.4, 2.6], [1.5, 2.2, 3.9], [1.05, 2.0, 5.1], [0.6, 1.7, 6.2]];
      tiers.forEach(([r, h, y], i) => b.cone(r, h, 8, V3(0, y, 0), { color: i % 2 ? needle : needle2, sway: 0.25 + i * 0.1, jitter: 0.2, ao: 0.55, flat: true }));
      break;
    }
    case 'palm': {
      const trunk = lin(0x8a6f4c);
      let x = 0, y = -0.3;
      for (let i = 0; i < 6; i++) {
        const lean = 0.08 + i * 0.03;
        b.cylinder(0.17 - i * 0.012, 0.2 - i * 0.012, 1.1, 6, V3(x, y, 0), { color: trunk, jitter: 0.2, sway: i * 0.06 }, E(0, 0, -lean));
        x += Math.sin(lean) * 1.1;
        y += Math.cos(lean) * 1.1;
      }
      const frond = lin(0x3f6a2a), frond2 = lin(0x55782f);
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + (k % 2) * 0.2;
        const up = k % 3 === 0;
        b.leaf(up ? 2.4 : 3.1, 0.42, up ? 0.9 : 0.45, up ? 1.3 : 1.9, V3(x, y, 0), a, { color: k % 2 ? frond : frond2, sway: 0.9, jitter: 0.2 });
      }
      b.blob(0.22, 0, V3(x + 0.1, y - 0.2, 0.1), V3(1, 1, 1), { color: lin(0x6b4e2a) });
      break;
    }
    case 'cactus': {
      const g = lin(0x5d8043);
      b.cylinder(0.32, 0.36, 3.0, 8, V3(0, -0.3, 0), { color: g, jitter: 0.1, ao: 0.3 });
      b.blob(0.33, 1, V3(0, 2.7, 0), V3(1, 0.8, 1), { color: g });
      b.cylinder(0.2, 0.22, 0.8, 7, V3(0.3, 1.2, 0), { color: g }, E(0, 0, -1.3));
      b.cylinder(0.2, 0.2, 1.0, 7, V3(1.0, 1.35, 0), { color: g });
      b.cylinder(0.18, 0.2, 0.6, 7, V3(-0.3, 1.6, 0), { color: g }, E(0, 0, 1.3));
      b.cylinder(0.18, 0.18, 0.8, 7, V3(-0.85, 1.75, 0), { color: g });
      break;
    }
    case 'bush': {
      const c1 = lin(0x4a6a2e), c2 = lin(0x3d5a27);
      b.blob(0.8, 1, V3(0, 0.45, 0), V3(1.1, 0.8, 1.1), { color: c1, sway: 0.4, jitter: 0.3, ao: 0.6, flat: true });
      b.blob(0.6, 1, V3(0.6, 0.35, 0.2), V3(1, 0.8, 1), { color: c2, sway: 0.4, jitter: 0.3, ao: 0.6, flat: true });
      b.blob(0.55, 1, V3(-0.5, 0.3, -0.3), V3(1, 0.8, 1), { color: c1, sway: 0.4, jitter: 0.3, ao: 0.6, flat: true });
      break;
    }
    case 'snag': {
      const grey = lin(0x6e665c);
      b.cylinder(0.1, 0.18, 2.6, 5, V3(0, -0.3, 0), { color: grey, jitter: 0.2 });
      b.cylinder(0.04, 0.07, 0.9, 4, V3(0, 1.5, 0), { color: grey, sway: 0.2 }, E(0, 0, 0.9));
      b.cylinder(0.04, 0.07, 0.8, 4, V3(0, 1.9, 0), { color: grey, sway: 0.2 }, E(0.6, 0, -0.8));
      b.blob(0.35, 0, V3(0.1, 0.05, 0.1), V3(1.6, 0.4, 1.4), { color: lin(0x6b7355), jitter: 0.3 });
      break;
    }
    case 'rock': {
      const r = lin(0x7d766c);
      b.blob(1.0, 1, V3(0, 0.25, 0), V3(1.2, 0.75, 1.0), { color: r, jitter: 0.25, ao: 0.5, flat: true }, 0.35);
      b.blob(0.55, 1, V3(0.9, 0.1, 0.3), V3(1, 0.7, 1), { color: lin(0x8a8378), jitter: 0.25, ao: 0.5, flat: true }, 0.35);
      break;
    }
    case 'reeds': {
      const c = lin(0x7a8a45), c2 = lin(0x8c7a45);
      for (let k = 0; k < 9; k++) {
        const a = k * 2.4;
        const rr = 0.15 + (k % 3) * 0.12;
        b.quad(0.08, 1.4 + (k % 4) * 0.25, V3(Math.cos(a) * rr, -0.1, Math.sin(a) * rr), E(0, a, 0), { color: k % 2 ? c : c2, sway: 0.9 }, 0.25);
      }
      break;
    }
  }
  return b.build();
}

const VEG_VS = /* glsl */ `
precision highp float;
${GLSL_CONSTANTS}
${GLSL_FRAME}
in vec3 aDir;
in float aGround;
in vec2 aXf;   // scale, rotation
in vec3 aTint; // hue variation, autumn, snow
in float aSway;
in vec3 color;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uWind;
uniform float uVegFar;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out vec3 vTint;
out float vFoliage;
out float vUpness;
void main() {
  vec3 up = aDir;
  vec3 ax, az;
  tangentFrame(up, aXf.y, ax, az);
  vec3 base = up * (PLANET_R + aGround);
  float dist = distance(base, uCamPos);
  float fade = 1.0 - smoothstep(uVegFar * 0.75, uVegFar, dist);
  vec3 lp = position * aXf.x * fade;
  float ph = dot(aDir, vec3(129.9, 782.2, 377.7));
  float gust = sin(uTime * 1.3 + ph) * 0.65 + sin(uTime * 3.1 + ph * 1.7) * 0.25 + sin(uTime * 0.37 + ph * 0.3) * 0.4;
  float w = aSway * uWind * gust * 0.06 * max(position.y, 0.0);
  lp.x += w;
  lp.z += w * 0.4;
  vWorld = base + ax * lp.x + up * lp.y + az * lp.z;
  vNormal = normalize(ax * normal.x + up * normal.y + az * normal.z);
  vUpness = normal.y;
  vColor = color;
  vTint = aTint;
  vFoliage = step(0.3, aSway);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const VEG_FS = /* glsl */ `
${OBJECT_FS_HEAD}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in vec3 vTint;
in float vFoliage;
in float vUpness;
void main() {
  vec3 col = vColor * (1.0 + vTint.x * 0.3) * mix(vec3(1.0), vec3(1.12, 1.02, 0.7), max(vTint.x, 0.0) * vFoliage) * mix(vec3(1.0), vec3(0.85, 0.97, 1.1), max(-vTint.x, 0.0) * vFoliage);
  // Autumn: foliage turns gold and red; at the extreme leaves thin out.
  vec3 autumnCol = mix(vec3(0.55, 0.25, 0.04), vec3(0.62, 0.12, 0.03), fract(vTint.x * 7.0));
  col = mix(col, autumnCol, vTint.y * vFoliage);
  // Snow settles on upward-facing surfaces.
  float snow = vTint.z * smoothstep(0.05, 0.6, vUpness);
  col = mix(col, vec3(0.85, 0.88, 0.92), snow);
  vec3 N = normalize(vNormal);
  vec3 c = shadeObject(vWorld, N, col, vFoliage * (1.0 - snow), 0.0, vec3(0.0));
  outColor = vec4(c, 1.0);
}
`;

interface Candidate {
  type: number;
  x: number; y: number; z: number;
  h: number;
  scale: number;
  rot: number;
  hue: number;
  autumn: number;
  snow: number;
  dist: number;
}

const STRIDE = 10;

export class Vegetation {
  readonly group = new THREE.Group();
  private geos: THREE.InstancedBufferGeometry[] = [];
  private bufs: THREE.InstancedInterleavedBuffer[] = [];
  private data: Float32Array[] = [];
  private caps: number[] = [];
  readonly material: THREE.ShaderMaterial;
  readonly depthMaterial: THREE.ShaderMaterial;
  readonly meshes: THREE.Mesh[] = [];
  budget = 14000;
  private lastFocus = new THREE.Vector3(9, 9, 9);
  private lastRadius = 0;
  private lastVersion = -1;
  private lastBuild = -1e9;
  count = 0;
  enabled = true;
  seed: number;

  constructor(shared: SharedUniforms, seed: number) {
    this.seed = seed;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VEG_VS,
      fragmentShader: VEG_FS,
      uniforms: { ...shared, uWind: { value: 1 }, uVegFar: { value: 400 } },
    });
    this.depthMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VEG_VS,
      fragmentShader: DEPTH_FS,
      uniforms: this.material.uniforms,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 4,
    });
    VEG_TYPES.forEach((t, i) => {
      const src = buildModel(t);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = src.index;
      for (const name of ['position', 'normal', 'color', 'aSway']) geo.setAttribute(name, src.getAttribute(name));
      const cap = 256;
      const arr = new Float32Array(cap * STRIDE);
      const buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aDir', new THREE.InterleavedBufferAttribute(buf, 3, 0));
      geo.setAttribute('aGround', new THREE.InterleavedBufferAttribute(buf, 1, 3));
      geo.setAttribute('aXf', new THREE.InterleavedBufferAttribute(buf, 2, 4));
      geo.setAttribute('aTint', new THREE.InterleavedBufferAttribute(buf, 3, 6));
      geo.instanceCount = 0;
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.frustumCulled = false;
      mesh.name = `veg-${t}`;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.geos[i] = geo;
      this.bufs[i] = buf;
      this.data[i] = arr;
      this.caps[i] = cap;
    });
  }

  private ensureCapacity(i: number, n: number): void {
    if (n <= this.caps[i]) return;
    let cap = this.caps[i];
    while (cap < n) cap *= 2;
    const arr = new Float32Array(cap * STRIDE);
    const buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    const geo = this.geos[i];
    geo.setAttribute('aDir', new THREE.InterleavedBufferAttribute(buf, 3, 0));
    geo.setAttribute('aGround', new THREE.InterleavedBufferAttribute(buf, 1, 3));
    geo.setAttribute('aXf', new THREE.InterleavedBufferAttribute(buf, 2, 4));
    geo.setAttribute('aTint', new THREE.InterleavedBufferAttribute(buf, 3, 6));
    this.bufs[i] = buf;
    this.data[i] = arr;
    this.caps[i] = cap;
  }

  /**
   * Rebuild placement around `focus` (unit dir) when the view has moved
   * enough or the vegetation data changed.
   */
  update(focus: THREE.Vector3, camDistance: number, data: PlanetData, now: number, force = false): void {
    if (!this.enabled || camDistance > 1100) {
      if (this.count > 0) { for (const g of this.geos) g.instanceCount = 0; this.count = 0; }
      this.lastRadius = 0;
      return;
    }
    const radius = Math.min(430, Math.max(110, camDistance * 1.6 + 60));
    this.material.uniforms.uVegFar.value = radius;
    const moved = focus.angleTo(this.lastFocus) * PLANET_RADIUS;
    const needs = force || moved > radius * 0.12 || Math.abs(radius - this.lastRadius) > this.lastRadius * 0.25 ||
      (data.regionVersion !== this.lastVersion && now - this.lastBuild > 3000);
    if (!needs || now - this.lastBuild < 250) return;
    this.lastBuild = now;
    this.lastFocus.copy(focus);
    this.lastRadius = radius;
    this.lastVersion = data.regionVersion;
    this.rebuild(focus, radius, data);
  }

  private rebuild(focus: THREE.Vector3, radius: number, data: PlanetData): void {
    const n = data.n;
    const cellWorld = ((Math.PI / 2) * PLANET_RADIUS) / n;
    const win = Math.ceil(radius / cellWorld) + 2;
    const cands: Candidate[] = [];
    const d = [0, 0, 0];
    const fx = focus.x, fy = focus.y, fz = focus.z;
    const maxChord2 = (radius / PLANET_RADIUS) ** 2;
    const heights = data.heights;
    for (let f = 0; f < 6; f++) {
      const N = FACE_N[f], U = FACE_U[f], V = FACE_V[f];
      const dn = fx * N[0] + fy * N[1] + fz * N[2];
      if (dn < 0.3) continue;
      const u = (fx * U[0] + fy * U[1] + fz * U[2]) / dn;
      const v = (fx * V[0] + fy * V[1] + fz * V[2]) / dn;
      const ca = Math.atan(u) * 4 / Math.PI, cb = Math.atan(v) * 4 / Math.PI;
      const ci = Math.floor((ca + 1) * 0.5 * n), cj = Math.floor((cb + 1) * 0.5 * n);
      const i0 = Math.max(0, ci - win), i1 = Math.min(n - 1, ci + win);
      const j0 = Math.max(0, cj - win), j1 = Math.min(n - 1, cj + win);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          for (let k = 0; k < 2; k++) {
            const hsh = hash4(this.seed, f * 1000003 + i, j, k);
            const jx = (hsh & 0xffff) / 65536, jy = (hsh >>> 16) / 65536;
            const a = -1 + (2 * (i + jx)) / n, b = -1 + (2 * (j + jy)) / n;
            faceABToDir(f, a, b, d, 0);
            const dx = d[0] - fx, dy = d[1] - fy, dz = d[2] - fz;
            const c2 = dx * dx + dy * dy + dz * dz;
            if (c2 > maxChord2) continue;
            this.consider(cands, f, a, b, d, Math.sqrt(c2) * PLANET_RADIUS, radius, hash4(hsh, 7, i, j), data, heights);
          }
        }
      }
    }
    if (cands.length > this.budget) {
      cands.sort((p, q) => p.dist - q.dist);
      cands.length = this.budget;
    }
    const counts = new Array(VEG_TYPES.length).fill(0);
    for (const c of cands) counts[c.type]++;
    counts.forEach((cnt, i) => this.ensureCapacity(i, cnt));
    const fill = new Array(VEG_TYPES.length).fill(0);
    for (const c of cands) {
      const arr = this.data[c.type];
      const o = fill[c.type]++ * STRIDE;
      arr[o] = c.x; arr[o + 1] = c.y; arr[o + 2] = c.z;
      arr[o + 3] = c.h;
      arr[o + 4] = c.scale; arr[o + 5] = c.rot;
      arr[o + 6] = c.hue; arr[o + 7] = c.autumn; arr[o + 8] = c.snow;
    }
    for (let i = 0; i < VEG_TYPES.length; i++) {
      this.geos[i].instanceCount = counts[i];
      const buf = this.bufs[i];
      buf.clearUpdateRanges();
      buf.addUpdateRange(0, counts[i] * STRIDE);
      buf.needsUpdate = true;
    }
    this.count = cands.length;
  }

  private consider(out: Candidate[], face: number, a: number, b: number, d: number[], dist: number, radius: number, h2: number, data: PlanetData, heights: Float32Array): void {
    const r0 = (h2 & 0xffff) / 65536;
    const r1 = ((h2 >>> 16) & 0xff) / 256;
    const r2 = (h2 >>> 24) / 256;
    const vA = data.vegACPU, vB = data.vegBCPU;
    const grass = data.sampleRegion(vA, face, a, b, 0);
    const shrub = data.sampleRegion(vA, face, a, b, 1);
    const broad = data.sampleRegion(vA, face, a, b, 2);
    const conifer = data.sampleRegion(vA, face, a, b, 3);
    const tropical = data.sampleRegion(vB, face, a, b, 0);
    const xeric = data.sampleRegion(vB, face, a, b, 1);
    const reeds = data.sampleRegion(vB, face, a, b, 2);
    const moss = data.sampleRegion(vB, face, a, b, 3);
    const hb = data.grid.sample(heights, d[0], d[1], d[2]);
    if (hb < -0.4) return;
    // Local clustering so forests form groves and clearings.
    const cluster = 0.55 + 0.9 * (Math.sin(d[0] * 211 + d[1] * 97) * Math.sin(d[2] * 173 - d[1] * 59) * 0.5 + 0.5);
    const w = [
      broad * 0.62 * cluster,          // broadleaf
      conifer * 0.72 * cluster,        // conifer
      tropical * 0.7 * cluster,        // palm
      xeric * 0.05,                    // cactus
      shrub * 0.12 + grass * 0.02,     // bush
      moss * 0.05 + conifer * 0.02,    // snag
      0.012 + xeric * 0.03,            // rock
      reeds * 0.4,                     // reeds
      broad * conifer * 1.2 * cluster, // birch (mixed forests)
    ];
    if (hb < 0.35) {
      // Shore: only reeds and rocks.
      for (let k = 0; k < 7; k++) if (k !== 6) w[k] = 0;
      w[8] = 0;
      w[7] *= 2.5;
    } else {
      w[7] *= 0.3;
    }
    let total = 0;
    for (const x of w) total += x;
    // Thin slightly toward the edge of the radius (the canopy shading takes over).
    const edge = 1 - Math.max(0, (dist - radius * 0.7) / (radius * 0.3)) * 0.4;
    if (r0 > total * edge) return;
    let pick = r1 * total, type = 0;
    for (; type < w.length - 1; type++) {
      if (pick < w[type]) break;
      pick -= w[type];
    }
    const x = d[0], y = d[1], z = d[2];
    const h = groundHeight(heights, data.n, x, y, z);
    if (h < -0.2 && type !== 7 && type !== 6) return;
    // Slope from neighbouring bilinear samples: trees avoid cliffs, rocks like them.
    const e = 0.004;
    const hx = data.grid.sample(heights, x + e, y, z) - hb;
    const hz = data.grid.sample(heights, x, y, z + e) - hb;
    const slope = Math.hypot(hx, hz) / (e * PLANET_RADIUS);
    if (slope > 0.9 && type !== 6) return;
    const temp = data.sampleRegion(data.climateCPU, face, a, b, 0) * 80 - 40;
    const snow = Math.min(1, data.sampleRegion(data.climateCPU, face, a, b, 2) * 1.8);
    const autumn = type === 0 || type === 8 ? Math.max(0, Math.min(1, (12 - temp) / 8)) * Math.max(0, Math.min(1, (temp + 4) / 6)) : 0;
    const baseScale = [1.0, 1.05, 0.95, 0.9, 1.0, 1.0, 0.9, 1.0, 1.0][type];
    const scale = baseScale * (0.65 + r2 * 0.7) * (type === 6 ? 0.6 + slope : 1);
    out.push({ type, x, y, z, h, scale, rot: r0 * 40, hue: r2 - 0.5, autumn, snow, dist });
  }
}
