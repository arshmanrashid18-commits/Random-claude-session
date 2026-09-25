/**
 * Spatial hash over the sphere using a CellGrid as buckets. Rebuilt with a
 * counting sort (O(n), allocation-free) whenever agents move; neighbourhood
 * queries visit a cell and its 8 neighbours.
 */
import type { CellGrid } from './planet/cubesphere';

export class SpatialHash {
  readonly grid: CellGrid;
  cellStart: Int32Array;
  cellCount: Int32Array;
  items: Int32Array;
  /** Bucket of each agent at the last rebuild. */
  bucketOf: Int32Array;
  private cursor: Int32Array;

  constructor(grid: CellGrid, capacity: number) {
    this.grid = grid;
    this.cellStart = new Int32Array(grid.count + 1);
    this.cellCount = new Int32Array(grid.count);
    this.cursor = new Int32Array(grid.count);
    this.items = new Int32Array(capacity);
    this.bucketOf = new Int32Array(capacity).fill(-1);
  }

  ensureCapacity(n: number): void {
    if (n <= this.items.length) return;
    let cap = this.items.length;
    while (cap < n) cap *= 2;
    this.items = new Int32Array(cap);
    const b = new Int32Array(cap).fill(-1);
    b.set(this.bucketOf);
    this.bucketOf = b;
  }

  /** Rebuild from positions of alive agents. */
  rebuild(count: number, alive: Uint8Array, x: Float32Array, y: Float32Array, z: Float32Array): void {
    this.ensureCapacity(count);
    const g = this.grid;
    const cnt = this.cellCount;
    cnt.fill(0);
    for (let i = 0; i < count; i++) {
      if (!alive[i]) { this.bucketOf[i] = -1; continue; }
      const c = g.cellOf(x[i], y[i], z[i]);
      this.bucketOf[i] = c;
      cnt[c]++;
    }
    let acc = 0;
    for (let c = 0; c < g.count; c++) {
      this.cellStart[c] = acc;
      this.cursor[c] = acc;
      acc += cnt[c];
    }
    this.cellStart[g.count] = acc;
    for (let i = 0; i < count; i++) {
      const c = this.bucketOf[i];
      if (c < 0) continue;
      this.items[this.cursor[c]++] = i;
    }
  }

  /**
   * Visit agents within the 3×3 neighbourhood of cell c. The callback
   * returns true to stop early.
   */
  forNeighborhood(c: number, fn: (i: number) => boolean | void): void {
    const g = this.grid;
    if (this.visitCell(c, fn)) return;
    for (let k = 0; k < 8; k++) {
      const nb = g.neighbors[c * 8 + k];
      if (nb === c) continue;
      if (this.visitCell(nb, fn)) return;
    }
  }

  private visitCell(c: number, fn: (i: number) => boolean | void): boolean {
    const s = this.cellStart[c], e = this.cellStart[c + 1];
    for (let k = s; k < e; k++) if (fn(this.items[k])) return true;
    return false;
  }

  countIn(c: number): number {
    return this.cellCount[c];
  }
}
