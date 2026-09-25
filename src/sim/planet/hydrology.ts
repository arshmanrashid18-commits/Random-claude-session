/**
 * Hydrology on the hydro grid (HYDRO_N² cells per face).
 *
 *  - Depressions are filled with an ε-priority-flood (Barnes et al. 2014)
 *    seeded from every below-sea-level cell, which guarantees that every land
 *    cell drains to the sea.
 *  - Each cell drains to its steepest-descent neighbour on the filled surface.
 *  - Depressions deep enough become lakes whose level is their spill height.
 *  - Flow accumulation weighted by long-term rainfall gives river discharge;
 *    rivers carve valleys into the fine heightmap and are exported as smooth
 *    polylines for the renderer.
 */
import { CellGrid, VertexGrid, dirToFaceAB } from './cubesphere';
import { PLANET_RADIUS } from '../constants';

export const RIVER_THRESHOLD = 55;
const LAKE_MIN_DEPTH = 0.45;
const LAKE_MIN_CELLS = 5;

export interface Lake {
  id: number;
  level: number;
  cells: number[];
}

export interface RiverPath {
  /** Unit directions, xyz interleaved. */
  points: number[];
  /** Discharge at each point. */
  flow: number[];
  /** Channel width (world units) at each point. */
  width: number[];
  /** Water surface height (world units) at each point. */
  level: number[];
}

/** Binary min-heap of (key, value) pairs using typed arrays. */
class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  constructor(cap: number) {
    this.keys = new Float64Array(cap);
    this.vals = new Int32Array(cap);
  }
  push(k: number, v: number): void {
    let i = this.size++;
    const K = this.keys, V = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= k) break;
      K[i] = K[p]; V[i] = V[p];
      i = p;
    }
    K[i] = k; V[i] = v;
  }
  popVal(): number {
    const K = this.keys, V = this.vals;
    const top = V[0];
    const k = K[--this.size], v = V[this.size];
    let i = 0;
    const n = this.size;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && K[c + 1] < K[c]) c++;
      if (K[c] >= k) break;
      K[i] = K[c]; V[i] = V[c];
      i = c;
    }
    K[i] = k; V[i] = v;
    return top;
  }
}

export class Hydrology {
  readonly grid: CellGrid;
  h: Float32Array;
  filled: Float32Array;
  recv: Int32Array;
  order: Int32Array;
  flow: Float32Array;
  lakeId: Int32Array;
  lakes: Lake[] = [];
  rivers: RiverPath[] = [];
  /** Incremented whenever river/lake geometry changes (renderer resync). */
  version = 0;

  constructor(grid: CellGrid) {
    this.grid = grid;
    const n = grid.count;
    this.h = new Float32Array(n);
    this.filled = new Float32Array(n);
    this.recv = new Int32Array(n);
    this.order = new Int32Array(n);
    this.flow = new Float32Array(n);
    this.lakeId = new Int32Array(n).fill(-1);
  }

  /** Sample the fine heightmap at hydro cell centres (mean of 3×3 sub-samples). */
  sampleHeights(heights: Float32Array, hg: VertexGrid): void {
    const g = this.grid;
    const n = g.n;
    for (let c = 0; c < g.count; c++) {
      const face = Math.floor(c / g.faceSize);
      const rem = c - face * g.faceSize;
      const j = Math.floor(rem / n), i = rem - j * n;
      let s = 0;
      for (let sj = 0; sj < 3; sj++) {
        for (let si = 0; si < 3; si++) {
          const a = -1 + (2 * (i + (si + 0.5) / 3)) / n;
          const b = -1 + (2 * (j + (sj + 0.5) / 3)) / n;
          const fx = (a + 1) * 0.5 * hg.n, fy = (b + 1) * 0.5 * hg.n;
          let i0 = Math.floor(fx), j0 = Math.floor(fy);
          if (i0 >= hg.n) i0 = hg.n - 1;
          if (j0 >= hg.n) j0 = hg.n - 1;
          const tx = fx - i0, ty = fy - j0;
          const base = face * hg.faceSize + j0 * hg.side + i0;
          s += (heights[base] * (1 - tx) + heights[base + 1] * tx) * (1 - ty) +
            (heights[base + hg.side] * (1 - tx) + heights[base + hg.side + 1] * tx) * ty;
        }
      }
      this.h[c] = s / 9;
    }
  }

  /** Priority-flood fill + drainage directions + processing order + lakes. */
  computeDrainage(): void {
    const g = this.grid;
    const N = g.count;
    const h = this.h, F = this.filled, recv = this.recv;
    const visited = new Uint8Array(N);
    const heap = new MinHeap(N + 16);
    const eps = 1e-4;
    for (let c = 0; c < N; c++) {
      recv[c] = -1;
      if (h[c] < 0) {
        F[c] = h[c];
        visited[c] = 1;
      }
    }
    // Seed the flood from ocean cells that border land.
    for (let c = 0; c < N; c++) {
      if (!visited[c]) continue;
      for (let k = 0; k < 8; k++) {
        const nb = g.neighbors[c * 8 + k];
        if (!visited[nb]) { heap.push(0, c); break; }
      }
    }
    // Degenerate world with no ocean: seed from the lowest cell.
    if (heap.size === 0) {
      let lo = 0;
      for (let c = 1; c < N; c++) if (h[c] < h[lo]) lo = c;
      visited[lo] = 1;
      F[lo] = h[lo];
      heap.push(h[lo], lo);
    }
    let orderIdx = 0;
    const floodOrder = new Int32Array(N);
    while (heap.size > 0) {
      const c = heap.popVal();
      const fc = Math.max(F[c], 0);
      for (let k = 0; k < 8; k++) {
        const nb = g.neighbors[c * 8 + k];
        if (visited[nb]) continue;
        visited[nb] = 1;
        F[nb] = Math.max(h[nb], fc + eps);
        floodOrder[orderIdx++] = nb;
        heap.push(F[nb], nb);
      }
    }
    // Steepest-descent receivers on the filled surface.
    for (let c = 0; c < N; c++) {
      if (h[c] < 0) { recv[c] = -1; continue; }
      let best = -1, bestS = 0;
      for (let k = 0; k < 8; k++) {
        const nb = g.neighbors[c * 8 + k];
        const nbF = h[nb] < 0 ? Math.min(F[nb], 0) : F[nb];
        const s = (F[c] - nbF) / (k < 4 ? 1 : 1.4142);
        if (s > bestS) { bestS = s; best = nb; }
      }
      recv[c] = best;
    }
    // Processing order: land cells in decreasing flood order (upstream first).
    let o = 0;
    for (let i = orderIdx - 1; i >= 0; i--) this.order[o++] = floodOrder[i];
    for (; o < N; o++) this.order[o] = -1;
    this.findLakes();
  }

  private findLakes(): void {
    const g = this.grid;
    const N = g.count;
    this.lakeId.fill(-1);
    this.lakes = [];
    const stack: number[] = [];
    for (let c = 0; c < N; c++) {
      if (this.lakeId[c] !== -1 || this.h[c] < 0) continue;
      if (this.filled[c] - this.h[c] < LAKE_MIN_DEPTH) continue;
      const id = this.lakes.length;
      const cells: number[] = [];
      let level = 0;
      stack.push(c);
      this.lakeId[c] = id;
      while (stack.length) {
        const cur = stack.pop()!;
        cells.push(cur);
        level = Math.max(level, this.filled[cur]);
        for (let k = 0; k < 4; k++) {
          const nb = g.neighbors[cur * 8 + k];
          if (this.lakeId[nb] !== -1 || this.h[nb] < 0) continue;
          if (this.filled[nb] - this.h[nb] < 0.05) continue;
          this.lakeId[nb] = id;
          stack.push(nb);
        }
      }
      if (cells.length < LAKE_MIN_CELLS) {
        for (const cc of cells) this.lakeId[cc] = -2; // pond: wetland, not rendered
        this.lakes.push({ id, level, cells: [] });
      } else {
        this.lakes.push({ id, level, cells });
      }
    }
    // Compact: drop empty lakes, renumber.
    const remap = new Map<number, number>();
    const kept: Lake[] = [];
    for (const l of this.lakes) {
      if (l.cells.length === 0) continue;
      remap.set(l.id, kept.length);
      kept.push({ id: kept.length, level: l.level, cells: l.cells });
    }
    for (let c = 0; c < N; c++) {
      const id = this.lakeId[c];
      if (id >= 0) this.lakeId[c] = remap.get(id) ?? -1;
    }
    this.lakes = kept;
  }

  /** Rainfall-weighted flow accumulation. rain(c) returns rain for hydro cell c. */
  accumulate(rain: (c: number) => number): void {
    const g = this.grid;
    const F = this.flow;
    for (let c = 0; c < g.count; c++) F[c] = this.h[c] < 0 ? 0 : Math.max(0, rain(c)) * g.area[c];
    for (let i = 0; i < g.count; i++) {
      const c = this.order[i];
      if (c < 0) break;
      const r = this.recv[c];
      if (r >= 0 && this.h[r] >= 0) F[r] += F[c];
    }
  }

  riverWidth(flow: number): number {
    return 0.9 + 1.25 * Math.sqrt(flow / RIVER_THRESHOLD);
  }

  riverDepth(flow: number): number {
    return Math.min(4.2, 0.7 + 0.55 * Math.log2(1 + flow / RIVER_THRESHOLD));
  }

  /** Carve river valleys into the fine heightmap. */
  carve(heights: Float32Array, hg: VertexGrid): void {
    const g = this.grid;
    const a = [0, 0, 0];
    for (let c = 0; c < g.count; c++) {
      const f = this.flow[c];
      if (f < RIVER_THRESHOLD || this.h[c] < 0 || this.lakeId[c] >= 0) continue;
      const r = this.recv[c];
      if (r < 0) continue;
      const depth = this.riverDepth(f);
      const width = this.riverWidth(f);
      const b0 = this.filled[c] - depth;
      const b1 = (this.h[r] < 0 ? Math.min(0, this.filled[r]) - 1 : this.filled[r]) - depth;
      const steps = 4;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        a[0] = g.centers[c * 3] * (1 - t) + g.centers[r * 3] * t;
        a[1] = g.centers[c * 3 + 1] * (1 - t) + g.centers[r * 3 + 1] * t;
        a[2] = g.centers[c * 3 + 2] * (1 - t) + g.centers[r * 3 + 2] * t;
        const l = Math.hypot(a[0], a[1], a[2]);
        carveDisk(heights, hg, a[0] / l, a[1] / l, a[2] / l, width, b0 * (1 - t) + b1 * t);
      }
    }
    hg.syncEdges(heights);
  }

  /** Build smoothed river polylines for rendering. */
  buildRivers(sampleHeight: (x: number, y: number, z: number) => number): void {
    const g = this.grid;
    const N = g.count;
    const isRiver = (c: number) => this.flow[c] >= RIVER_THRESHOLD && this.h[c] >= 0 && this.lakeId[c] < 0;
    // Count river inflows to find sources and confluences.
    const inflow = new Uint8Array(N);
    for (let c = 0; c < N; c++) {
      if (!isRiver(c)) continue;
      const r = this.recv[c];
      if (r >= 0) inflow[r]++;
    }
    const rivers: RiverPath[] = [];
    // Main stems first: for each cell that has a river receiver, the largest
    // inflow continues the stem; smaller tributaries end at the confluence.
    const mainChild = new Int32Array(N).fill(-1);
    for (let c = 0; c < N; c++) {
      if (!isRiver(c)) continue;
      const r = this.recv[c];
      if (r < 0) continue;
      if (mainChild[r] < 0 || this.flow[c] > this.flow[mainChild[r]]) mainChild[r] = c;
    }
    const used = new Uint8Array(N);
    for (let c0 = 0; c0 < N; c0++) {
      if (!isRiver(c0) || used[c0]) continue;
      // Start only at heads: cells that are nobody's main child's receiver chain continuation.
      let isHead = true;
      for (let k = 0; k < 8; k++) {
        const nb = g.neighbors[c0 * 8 + k];
        if (this.recv[nb] === c0 && isRiver(nb) && mainChild[c0] === nb) { isHead = false; break; }
      }
      if (!isHead) continue;
      const cells: number[] = [];
      let c = c0;
      for (let guard = 0; guard < 4000; guard++) {
        cells.push(c);
        used[c] = 1;
        const r = this.recv[c];
        if (r < 0) break;
        if (!isRiver(r) || used[r] || mainChild[r] !== c) { cells.push(r); break; }
        c = r;
      }
      if (cells.length < 3) continue;
      rivers.push(this.makePath(cells, sampleHeight));
    }
    this.rivers = rivers;
    this.version++;
  }

  private makePath(cells: number[], sampleHeight: (x: number, y: number, z: number) => number): RiverPath {
    const g = this.grid;
    let pts: number[][] = cells.map((c) => [g.centers[c * 3], g.centers[c * 3 + 1], g.centers[c * 3 + 2], this.flow[c]]);
    // Chaikin smoothing ×2 (keep endpoints).
    for (let it = 0; it < 2; it++) {
      const out: number[][] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        out.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25, p[2] * 0.75 + q[2] * 0.25, p[3] * 0.75 + q[3] * 0.25]);
        out.push([p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75, p[2] * 0.25 + q[2] * 0.75, p[3] * 0.25 + q[3] * 0.75]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    const path: RiverPath = { points: [], flow: [], width: [], level: [] };
    let prevLevel = Infinity;
    for (const p of pts) {
      const l = Math.hypot(p[0], p[1], p[2]);
      const x = p[0] / l, y = p[1] / l, z = p[2] / l;
      const f = p[3] < RIVER_THRESHOLD ? RIVER_THRESHOLD : p[3];
      const ground = sampleHeight(x, y, z);
      // Water sits a little above the carved bed and never flows uphill.
      let level = ground + Math.min(0.6, 0.18 * this.riverDepth(f));
      if (level > prevLevel) level = prevLevel;
      prevLevel = level;
      path.points.push(x, y, z);
      path.flow.push(f);
      path.width.push(this.riverWidth(f));
      path.level.push(level);
    }
    return path;
  }
}

/** Lower heightmap samples inside a disk to form a channel with sloped banks. */
export function carveDisk(heights: Float32Array, hg: VertexGrid, x: number, y: number, z: number, width: number, bed: number): void {
  const f = dirToFaceAB(x, y, z);
  const n = hg.n;
  const cellWorld = ((Math.PI / 2) * PLANET_RADIUS) / n;
  const reach = width * 0.5 + 9;
  const rc = Math.ceil(reach / cellWorld) + 1;
  const ci = Math.round((f.a + 1) * 0.5 * n), cj = Math.round((f.b + 1) * 0.5 * n);
  const face = f.face;
  const d = [0, 0, 0];
  for (let j = Math.max(0, cj - rc); j <= Math.min(n, cj + rc); j++) {
    for (let i = Math.max(0, ci - rc); i <= Math.min(n, ci + rc); i++) {
      hg.dirOf(face, i, j, d);
      const dx = d[0] - x, dy = d[1] - y, dz = d[2] - z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) * PLANET_RADIUS;
      if (dist > reach) continue;
      const bank = Math.max(0, dist - width * 0.5);
      const target = bed + bank * 0.42 + bank * bank * 0.02;
      const idx = hg.index(face, i, j);
      if (heights[idx] > target) heights[idx] = target;
    }
  }
}
