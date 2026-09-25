/**
 * Inland water: lakes (flat surfaces at their spill level) and rivers
 * (ribbons following the simulated drainage network, flowing downstream).
 */
import * as THREE from 'three';
import { GLSL_ATMOSPHERE, GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_HEIGHT, GLSL_NOISE, GLSL_REGION } from './glsl/common';
import { GLSL_SKYLIGHT } from './glsl/surface';
import { OCEAN_SHADING, type SharedUniforms } from './planet/terrain';
import { faceABToDir } from '../sim/planet/cubesphere';
import { PLANET_RADIUS } from '../sim/constants';
import type { StaticWorldData } from '../worker/protocol';
import type { PlanetData } from './planet/planetData';

const LAKE_VS = /* glsl */ `
in float aLevel;
out vec3 vWorld;
out float vLevel;
out float vDist;
uniform vec3 uCamPos;
void main() {
  vWorld = position;
  vLevel = aLevel;
  vDist = distance(position, uCamPos);
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const WATER_FS_HEAD = /* glsl */ `
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
`;

const LAKE_FS = /* glsl */ `
${WATER_FS_HEAD}
in vec3 vWorld;
in float vLevel;
in float vDist;
void main() {
  vec3 dir = normalize(vWorld);
  float ground = heightAtDir(dir);
  float depth = vLevel - ground;
  if (depth < -0.02) discard;
  vec4 c = shadeWater(vWorld, dir, max(depth, 0.0) * 1.6, vDist, 1.0);
  outColor = c;
}
`;

const RIVER_VS = /* glsl */ `
in vec2 aRiver; // x: across (-1..1), y: distance along (world units)
in float aWidth;
out vec3 vWorld;
out vec2 vRiver;
out float vWidth;
out float vDist;
uniform vec3 uCamPos;
void main() {
  vWorld = position;
  vRiver = aRiver;
  vWidth = aWidth;
  vDist = distance(position, uCamPos);
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const RIVER_FS = /* glsl */ `
${WATER_FS_HEAD}
in vec3 vWorld;
in vec2 vRiver;
in float vWidth;
in float vDist;
void main() {
  vec3 dir = normalize(vWorld);
  float across = abs(vRiver.x);
  // Optical depth for colour: rivers read as a clear green-blue channel,
  // not as shallow surf (no shore foam across the whole ribbon).
  float depth = (1.0 - across * across) * (2.2 + vWidth * 0.9) + 0.45;
  vec4 c = shadeWater(vWorld, dir, depth, vDist, 1.0);
  // Flow streaks moving downstream.
  float streak = snoise(vec3(vRiver.y * 0.35 - uTime * 1.4, vRiver.x * 2.5, 0.0));
  streak = smoothstep(0.55, 0.9, streak) * (1.0 - smoothstep(150.0, 600.0, vDist));
  vec3 L = uSunDir;
  float lit = max(dot(dir, L), 0.0) * 0.5 + 0.05;
  c.rgb += vec3(0.8, 0.9, 1.0) * streak * 0.25 * lit * uSunIntensity * 0.1;
  float edge = 1.0 - smoothstep(0.75, 1.0, across);
  c *= edge;
  outColor = c;
}
`;

export class WaterBodies {
  readonly group = new THREE.Group();
  private lakeMat: THREE.ShaderMaterial;
  private riverMat: THREE.ShaderMaterial;
  private lakeMesh: THREE.Mesh | null = null;
  private riverMesh: THREE.Mesh | null = null;

  constructor(shared: SharedUniforms, world: StaticWorldData, data: PlanetData) {
    const common = {
      glslVersion: THREE.GLSL3,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthWrite: false,
      side: THREE.DoubleSide,
    } as const;
    this.lakeMat = new THREE.ShaderMaterial({ ...common, vertexShader: LAKE_VS, fragmentShader: LAKE_FS, uniforms: { ...shared } });
    this.riverMat = new THREE.ShaderMaterial({
      ...common,
      vertexShader: RIVER_VS,
      fragmentShader: RIVER_FS,
      uniforms: { ...shared },
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.rebuild(world, data);
  }

  rebuild(world: StaticWorldData, data: PlanetData): void {
    if (this.lakeMesh) { this.group.remove(this.lakeMesh); this.lakeMesh.geometry.dispose(); }
    if (this.riverMesh) { this.group.remove(this.riverMesh); this.riverMesh.geometry.dispose(); }
    this.lakeMesh = this.buildLakes(world, data);
    this.riverMesh = this.buildRivers(world, data);
    if (this.lakeMesh) this.group.add(this.lakeMesh);
    if (this.riverMesh) this.group.add(this.riverMesh);
  }

  private buildLakes(world: StaticWorldData, _data: PlanetData): THREE.Mesh | null {
    const { cells, levels } = world.lakes;
    if (cells.length === 0) return null;
    const n = world.hydroN;
    const fs = n * n;
    // Edge-exact quads: neighbours share edges, nothing overlaps, so the
    // translucent surface is never blended twice.
    const all: [number, number][] = [];
    for (let k = 0; k < cells.length; k++) all.push([cells[k], levels[k]]);
    const pos = new Float32Array(all.length * 4 * 3);
    const lvl = new Float32Array(all.length * 4);
    const idx: number[] = [];
    const d = [0, 0, 0];
    const half = 1 / n;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (let k = 0; k < all.length; k++) {
      const [c, lv] = all[k];
      const f = Math.floor(c / fs);
      const rem = c - f * fs;
      const j = Math.floor(rem / n), i = rem - j * n;
      const ca = -1 + (2 * i + 1) / n, cb = -1 + (2 * j + 1) / n;
      const r = PLANET_RADIUS + lv;
      for (let q = 0; q < 4; q++) {
        faceABToDir(f, ca + corners[q][0] * half, cb + corners[q][1] * half, d, 0);
        pos[(k * 4 + q) * 3] = d[0] * r;
        pos[(k * 4 + q) * 3 + 1] = d[1] * r;
        pos[(k * 4 + q) * 3 + 2] = d[2] * r;
        lvl[k * 4 + q] = lv;
      }
      const b = k * 4;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aLevel', new THREE.BufferAttribute(lvl, 1));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.lakeMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    return mesh;
  }

  private buildRivers(world: StaticWorldData, data: PlanetData): THREE.Mesh | null {
    const { points, width, level, offsets } = world.rivers;
    const nr = offsets.length - 1;
    if (nr <= 0) return null;
    const pos: number[] = [];
    const riv: number[] = [];
    const wid: number[] = [];
    const idx: number[] = [];
    // Rivers are traced on the coarse hydrology grid; subdivide each span so
    // the ribbon drapes over the terrain instead of bridging hills.
    const SUB = 4;
    const px: number[] = [], lv: number[] = [], wv: number[] = [];
    for (let r = 0; r < nr; r++) {
      const s = offsets[r], e = offsets[r + 1];
      if (e - s < 2) continue;
      px.length = 0; lv.length = 0; wv.length = 0;
      for (let k = s; k < e; k++) {
        const last = k === e - 1;
        for (let q = 0; q < (last ? 1 : SUB); q++) {
          const t = q / SUB;
          const k2 = last ? k : k + 1;
          let x = points[k * 3] + (points[k2 * 3] - points[k * 3]) * t;
          let y = points[k * 3 + 1] + (points[k2 * 3 + 1] - points[k * 3 + 1]) * t;
          let z = points[k * 3 + 2] + (points[k2 * 3 + 2] - points[k * 3 + 2]) * t;
          const l = Math.hypot(x, y, z) || 1;
          x /= l; y /= l; z /= l;
          px.push(x, y, z);
          lv.push(level[k] + (level[k2] - level[k]) * t);
          wv.push(width[k] + (width[k2] - width[k]) * t);
        }
      }
      const m = px.length / 3;
      let along = 0;
      const base = pos.length / 3;
      for (let k = 0; k < m; k++) {
        const x = px[k * 3], y = px[k * 3 + 1], z = px[k * 3 + 2];
        const kp = Math.max(0, k - 1), kn = Math.min(m - 1, k + 1);
        let tx = px[kn * 3] - px[kp * 3], ty = px[kn * 3 + 1] - px[kp * 3 + 1], tz = px[kn * 3 + 2] - px[kp * 3 + 2];
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        // side = p × t
        let sx = y * tz - z * ty, sy = z * tx - x * tz, sz = x * ty - y * tx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        sx /= sl; sy /= sl; sz /= sl;
        if (k > 0) along += Math.hypot(x - px[(k - 1) * 3], y - px[(k - 1) * 3 + 1], z - px[(k - 1) * 3 + 2]) * PLANET_RADIUS;
        const w = wv[k] * 0.5 * 1.25 / PLANET_RADIUS;
        // Keep water slightly above the local ground (and never float far above it).
        const ground = data.heightAt(x, y, z);
        const l2 = Math.min(Math.max(lv[k], ground + 0.12), ground + 0.6);
        const rr = PLANET_RADIUS + l2;
        for (const side of [-1, 1]) {
          let vx = x + sx * w * side, vy = y + sy * w * side, vz = z + sz * w * side;
          const vl = Math.hypot(vx, vy, vz);
          vx /= vl; vy /= vl; vz /= vl;
          pos.push(vx * rr, vy * rr, vz * rr);
          riv.push(side, along);
          wid.push(wv[k]);
        }
        if (k < m - 1) {
          const a = base + k * 2;
          idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aRiver', new THREE.Float32BufferAttribute(riv, 2));
    geo.setAttribute('aWidth', new THREE.Float32BufferAttribute(wid, 1));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.riverMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    return mesh;
  }
}
