/**
 * A* pathfinding on the region grid. Land paths avoid water and prefer gentle
 * slopes and roads; sea paths (ships) travel over ocean cells between harbors.
 * Results are cached; caches are invalidated when terrain changes.
 */
import type { CellGrid } from '../planet/cubesphere';
import type { RegionTerrain } from '../planet/regions';

export type PathMode = 'land' | 'sea';

export class Heap {
  k: Float64Array;
  v: Int32Array;
  n = 0;
  constructor(cap: number) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
  }
  push(key: number, val: number): void {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2); k2.set(this.k); this.k = k2;
      const v2 = new Int32Array(this.v.length * 2); v2.set(this.v); this.v = v2;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p];
      i = p;
    }
    this.k[i] = key; this.v[i] = val;
  }
  pop(): number {
    const top = this.v[0];
    const key = this.k[--this.n], val = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c];
      i = c;
    }
    this.k[i] = key; this.v[i] = val;
    return top;
  }
}

export class Pathfinder {
  readonly grid: CellGrid;
  terrain: RegionTerrain;
  /** Per-cell road level (0 none .. 3 paved) lowers travel cost. */
  roads: Uint8Array;
  private g: Float32Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private curStamp = 1;
  private heap = new Heap(4096);
  private cache = new Map<string, Int32Array | null>();
  private cacheOrder: string[] = [];
  searches = 0;

  constructor(grid: CellGrid, terrain: RegionTerrain) {
    this.grid = grid;
    this.terrain = terrain;
    this.roads = new Uint8Array(grid.count);
    this.g = new Float32Array(grid.count);
    this.came = new Int32Array(grid.count);
    this.stamp = new Uint32Array(grid.count);
    this.closed = new Uint32Array(grid.count);
  }

  invalidate(): void {
    this.cache.clear();
    this.cacheOrder = [];
  }

  passable(c: number, mode: PathMode): boolean {
    const t = this.terrain;
    if (mode === 'land') return t.oceanFrac[c] < 0.55 && t.lakeFrac[c] < 0.6;
    return t.oceanFrac[c] > 0.45 || t.lakeFrac[c] > 0.5;
  }

  private cost(a: number, b: number, mode: PathMode): number {
    const G = this.grid;
    const dx = G.centers[a * 3] - G.centers[b * 3], dy = G.centers[a * 3 + 1] - G.centers[b * 3 + 1], dz = G.centers[a * 3 + 2] - G.centers[b * 3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (mode === 'sea') return d;
    const t = this.terrain;
    const climb = Math.max(0, t.elev[b] - t.elev[a]) * 0.02;
    const road = this.roads[b];
    return d * (1 + t.slope[b] * 4 + climb) * (road ? 1 - road * 0.22 : 1) + (t.river[b] > 2 ? d * 0.8 : 0);
  }

  /** Forget cached paths (terrain or roads changed). */
  clearCache(): void {
    this.cache.clear();
    this.cacheOrder.length = 0;
  }

  /** Returns cells from start to goal (inclusive) or null if unreachable. */
  find(start: number, goal: number, mode: PathMode, maxExpand = 12000): Int32Array | null {
    if (start === goal) return Int32Array.of(start);
    const key = `${mode}:${start}:${goal}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    this.searches++;
    const G = this.grid;
    const stampV = ++this.curStamp;
    const gx = G.centers[goal * 3], gy = G.centers[goal * 3 + 1], gz = G.centers[goal * 3 + 2];
    const h = (c: number) => {
      const dx = G.centers[c * 3] - gx, dy = G.centers[c * 3 + 1] - gy, dz = G.centers[c * 3 + 2] - gz;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
    const heap = this.heap;
    heap.n = 0;
    this.stamp[start] = stampV;
    this.g[start] = 0;
    this.came[start] = -1;
    heap.push(h(start), start);
    let expanded = 0;
    let found = false;
    while (heap.n > 0 && expanded < maxExpand) {
      const c = heap.pop();
      if (this.closed[c] === stampV) continue;
      this.closed[c] = stampV;
      expanded++;
      if (c === goal) { found = true; break; }
      const gc = this.g[c];
      for (let k = 0; k < 8; k++) {
        const nb = G.neighbors[c * 8 + k];
        if (nb === c || this.closed[nb] === stampV) continue;
        if (nb !== goal && !this.passable(nb, mode)) continue;
        const ng = gc + this.cost(c, nb, mode);
        if (this.stamp[nb] !== stampV || ng < this.g[nb]) {
          this.stamp[nb] = stampV;
          this.g[nb] = ng;
          this.came[nb] = c;
          heap.push(ng + h(nb), nb);
        }
      }
    }
    let result: Int32Array | null = null;
    if (found) {
      const out: number[] = [];
      for (let c = goal; c !== -1; c = this.came[c]) out.push(c);
      out.reverse();
      result = Int32Array.from(out);
    }
    this.cache.set(key, result);
    this.cacheOrder.push(key);
    if (this.cacheOrder.length > 400) this.cache.delete(this.cacheOrder.shift()!);
    return result;
  }
}
