/**
 * CDLOD-style quadtree over the six cube faces.
 *
 * Every frame we walk each face's quadtree, splitting nodes whose distance to
 * the camera is inside the next level's range. Emitted nodes become instances
 * of one shared grid mesh; the vertex shader geomorphs vertices toward the
 * parent grid as they approach the edge of their level's range, so LOD
 * transitions are continuous (no popping) and neighbouring levels meet.
 *
 * A min/max height pyramid gives tight bounding spheres for frustum and
 * horizon culling.
 */
import { faceABToDir } from '../../sim/planet/cubesphere';
import { PLANET_RADIUS, MIN_ELEVATION } from '../../sim/constants';
import * as THREE from 'three';

export const MAX_LOD_LEVELS = 10;

class FacePyramid {
  /** min/max per level: level L has (2^L)² nodes. */
  mins: Float32Array[] = [];
  maxs: Float32Array[] = [];
}

export class HeightPyramid {
  readonly n: number;
  readonly maxLevel: number;
  faces: FacePyramid[] = [];

  constructor(n: number, maxLevel: number) {
    this.n = n;
    this.maxLevel = maxLevel;
    for (let f = 0; f < 6; f++) {
      const fp = new FacePyramid();
      for (let L = 0; L <= maxLevel; L++) {
        const k = 1 << L;
        fp.mins.push(new Float32Array(k * k));
        fp.maxs.push(new Float32Array(k * k));
      }
      this.faces.push(fp);
    }
  }

  build(heights: Float32Array, face?: number): void {
    const n = this.n;
    const side = n + 1;
    const faceSize = side * side;
    const faces = face === undefined ? [0, 1, 2, 3, 4, 5] : [face];
    for (const f of faces) {
      const fp = this.faces[f];
      const L = this.maxLevel;
      const k = 1 << L;
      const span = n / k;
      const mn = fp.mins[L], mx = fp.maxs[L];
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          let lo = 1e9, hi = -1e9;
          const i0 = Math.floor(i * span), i1 = Math.ceil((i + 1) * span);
          const j0 = Math.floor(j * span), j1 = Math.ceil((j + 1) * span);
          for (let y = j0; y <= j1; y++) {
            const row = f * faceSize + y * side;
            for (let x = i0; x <= i1; x++) {
              const h = heights[row + x];
              if (h < lo) lo = h;
              if (h > hi) hi = h;
            }
          }
          mn[j * k + i] = lo;
          mx[j * k + i] = hi;
        }
      }
      for (let l = L - 1; l >= 0; l--) {
        const kk = 1 << l;
        const cmn = fp.mins[l + 1], cmx = fp.maxs[l + 1];
        const pmn = fp.mins[l], pmx = fp.maxs[l];
        for (let j = 0; j < kk; j++) {
          for (let i = 0; i < kk; i++) {
            const c0 = (2 * j) * (2 * kk) + 2 * i;
            const c1 = c0 + 1, c2 = c0 + 2 * kk, c3 = c2 + 1;
            pmn[j * kk + i] = Math.min(cmn[c0], cmn[c1], cmn[c2], cmn[c3]);
            pmx[j * kk + i] = Math.max(cmx[c0], cmx[c1], cmx[c2], cmx[c3]);
          }
        }
      }
    }
  }
}

export interface LodSettings {
  maxLevel: number;
  /** Range multiplier: split distance = patch size × rangeK. */
  rangeK: number;
}

const tmp = [0, 0, 0];
const sphere = new THREE.Sphere();

export class LodSelector {
  readonly pyramid: HeightPyramid;
  settings: LodSettings;
  /** Level → max distance at which that level is used. */
  ranges = new Float32Array(MAX_LOD_LEVELS + 1);
  /** Emitted patches: a0, b0, size, level, face (stride 5). */
  data: Float32Array;
  count = 0;
  /** Same list, restricted to patches that contain water (min height < 2). */
  waterData: Float32Array;
  waterCount = 0;
  capacity: number;
  private camX = 0; private camY = 0; private camZ = 0;
  private camDist = 0;
  private frustum = new THREE.Frustum();
  private horizonCos = 0;
  nodesVisited = 0;

  constructor(pyramid: HeightPyramid, settings: LodSettings, capacity = 4096) {
    this.pyramid = pyramid;
    this.settings = settings;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * 5);
    this.waterData = new Float32Array(capacity * 5);
    this.updateRanges();
  }

  updateRanges(): void {
    const faceSize = (Math.PI / 2) * PLANET_RADIUS;
    for (let L = 0; L <= MAX_LOD_LEVELS; L++) this.ranges[L] = (faceSize / (1 << L)) * this.settings.rangeK;
  }

  select(camera: THREE.PerspectiveCamera): void {
    this.camX = camera.position.x;
    this.camY = camera.position.y;
    this.camZ = camera.position.z;
    this.camDist = Math.hypot(this.camX, this.camY, this.camZ);
    const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(m);
    const occR = PLANET_RADIUS + MIN_ELEVATION * 0.5;
    this.horizonCos = this.camDist > occR ? occR / this.camDist : 0;
    this.count = 0;
    this.waterCount = 0;
    this.nodesVisited = 0;
    for (let f = 0; f < 6; f++) this.visit(f, 0, 0, 0);
  }

  private visit(f: number, L: number, i: number, j: number): void {
    this.nodesVisited++;
    const k = 1 << L;
    const size = 2 / k;
    const a0 = -1 + i * size, b0 = -1 + j * size;
    const fp = this.pyramid.faces[f];
    const pl = Math.min(L, this.pyramid.maxLevel);
    const shift = L - pl;
    const pi = i >> shift, pj = j >> shift;
    const pk = 1 << pl;
    const hmin = fp.mins[pl][pj * pk + pi];
    const hmax = fp.maxs[pl][pj * pk + pi];
    // Bounding sphere of the curved patch.
    faceABToDir(f, a0 + size * 0.5, b0 + size * 0.5, tmp, 0);
    const cx = tmp[0], cy = tmp[1], cz = tmp[2];
    faceABToDir(f, a0, b0, tmp, 0);
    const cornerDot = cx * tmp[0] + cy * tmp[1] + cz * tmp[2];
    faceABToDir(f, a0 + size, b0 + size, tmp, 0);
    const cornerDot2 = cx * tmp[0] + cy * tmp[1] + cz * tmp[2];
    const cosA = Math.min(cornerDot, cornerDot2);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const rTop = PLANET_RADIUS + Math.max(hmax, 1.5);
    const rBot = PLANET_RADIUS + Math.min(hmin, 0) - 2;
    const rMid = (rTop + rBot * cosA) * 0.5;
    const radius = Math.max(rTop * sinA, 0) + (rTop - rBot * cosA) * 0.5 + 1;
    const sx = cx * rMid, sy = cy * rMid, sz = cz * rMid;
    // Horizon culling: the patch is hidden if it lies entirely beyond the
    // planet's horizon as seen from the camera.
    if (this.horizonCos > 0) {
      const camDot = (cx * this.camX + cy * this.camY + cz * this.camZ) / this.camDist;
      const angCam = Math.acos(Math.min(1, Math.max(-1, camDot)));
      const occR = PLANET_RADIUS + MIN_ELEVATION * 0.5;
      const visAng = Math.acos(this.horizonCos) + Math.acos(Math.min(1, occR / rTop));
      if (angCam - Math.asin(Math.min(1, sinA)) > visAng + 0.002) return;
    }
    sphere.center.set(sx, sy, sz);
    sphere.radius = radius;
    if (!this.frustum.intersectsSphere(sphere)) return;
    const dx = sx - this.camX, dy = sy - this.camY, dz = sz - this.camZ;
    const dist = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - radius);
    if (L < this.settings.maxLevel && dist < this.ranges[L + 1]) {
      this.visit(f, L + 1, 2 * i, 2 * j);
      this.visit(f, L + 1, 2 * i + 1, 2 * j);
      this.visit(f, L + 1, 2 * i, 2 * j + 1);
      this.visit(f, L + 1, 2 * i + 1, 2 * j + 1);
      return;
    }
    if (this.count < this.capacity) {
      const o = this.count * 5;
      const d = this.data;
      d[o] = a0; d[o + 1] = b0; d[o + 2] = size; d[o + 3] = L; d[o + 4] = f;
      this.count++;
    }
    if (hmin < 2.5 && this.waterCount < this.capacity) {
      const o = this.waterCount * 5;
      const d = this.waterData;
      d[o] = a0; d[o + 1] = b0; d[o + 2] = size; d[o + 3] = L; d[o + 4] = f;
      this.waterCount++;
    }
  }
}
