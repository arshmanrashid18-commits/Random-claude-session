/**
 * Static per-region-cell terrain statistics derived from the heightmap and
 * hydrology. Recomputed locally after terraforming.
 */
import { CellGrid, VertexGrid } from './cubesphere';

const SUB = 5; // sub-samples per axis per region cell

export class RegionTerrain {
  readonly region: CellGrid;
  /** Mean height (world units, sea level 0). */
  elev: Float32Array;
  maxElev: Float32Array;
  minElev: Float32Array;
  /** Mean gradient magnitude (height units per world unit). */
  slope: Float32Array;
  /** Fraction of sub-samples below sea level. */
  oceanFrac: Float32Array;
  /** Fraction of the cell covered by lakes (set by hydrology). */
  lakeFrac: Float32Array;
  /** Max river discharge in the cell (set by hydrology). */
  river: Float32Array;
  /** 1 if cell has both land and sea within its neighbourhood. */
  coastal: Uint8Array;

  constructor(region: CellGrid) {
    this.region = region;
    const n = region.count;
    this.elev = new Float32Array(n);
    this.maxElev = new Float32Array(n);
    this.minElev = new Float32Array(n);
    this.slope = new Float32Array(n);
    this.oceanFrac = new Float32Array(n);
    this.lakeFrac = new Float32Array(n);
    this.river = new Float32Array(n);
    this.coastal = new Uint8Array(n);
  }

  computeAll(heights: Float32Array, hg: VertexGrid): void {
    for (let c = 0; c < this.region.count; c++) this.computeCell(c, heights, hg);
    for (let c = 0; c < this.region.count; c++) this.computeCoastal(c);
  }

  /** Recompute a set of cells (and their neighbours' coastal flags). */
  recompute(cells: Iterable<number>, heights: Float32Array, hg: VertexGrid): void {
    const touched = new Set<number>();
    for (const c of cells) {
      this.computeCell(c, heights, hg);
      touched.add(c);
      for (let k = 0; k < 8; k++) touched.add(this.region.neighbors[c * 8 + k]);
    }
    for (const c of touched) this.computeCoastal(c);
  }

  private computeCell(c: number, heights: Float32Array, hg: VertexGrid): void {
    const R = this.region;
    const n = R.n;
    const face = Math.floor(c / R.faceSize);
    const rem = c - face * R.faceSize;
    const j = Math.floor(rem / n), i = rem - j * n;
    const hn = hg.n;
    let sum = 0, mx = -1e9, mn = 1e9, below = 0, slopeSum = 0;
    const cellWorld = (Math.PI / 2 / n) * 1000; // approximate cell size in world units
    for (let sj = 0; sj < SUB; sj++) {
      for (let si = 0; si < SUB; si++) {
        // Sample positions in face-param space spanning the cell.
        const a = -1 + (2 * (i + (si + 0.5) / SUB)) / n;
        const b = -1 + (2 * (j + (sj + 0.5) / SUB)) / n;
        const fx = (a + 1) * 0.5 * hn, fy = (b + 1) * 0.5 * hn;
        let i0 = Math.floor(fx), j0 = Math.floor(fy);
        if (i0 >= hn) i0 = hn - 1;
        if (j0 >= hn) j0 = hn - 1;
        const tx = fx - i0, ty = fy - j0;
        const base = face * hg.faceSize + j0 * hg.side + i0;
        const h00 = heights[base], h10 = heights[base + 1], h01 = heights[base + hg.side], h11 = heights[base + hg.side + 1];
        const h = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
        sum += h;
        if (h > mx) mx = h;
        if (h < mn) mn = h;
        if (h < 0) below++;
        const gx = (h10 - h00 + h11 - h01) * 0.5, gy = (h01 - h00 + h11 - h10) * 0.5;
        slopeSum += Math.hypot(gx, gy);
      }
    }
    const cnt = SUB * SUB;
    this.elev[c] = sum / cnt;
    this.maxElev[c] = mx;
    this.minElev[c] = mn;
    this.oceanFrac[c] = below / cnt;
    // Heightmap spacing in world units ≈ cellWorld * n / hn.
    this.slope[c] = slopeSum / cnt / ((cellWorld * n) / hn);
  }

  private computeCoastal(c: number): void {
    const of = this.oceanFrac[c];
    let coastal = of > 0.02 && of < 0.98 ? 1 : 0;
    if (!coastal) {
      for (let k = 0; k < 4; k++) {
        const nb = this.region.neighbors[c * 8 + k];
        if ((of < 0.5) !== (this.oceanFrac[nb] < 0.5)) { coastal = 1; break; }
      }
    }
    this.coastal[c] = coastal;
  }

  isLand(c: number): boolean {
    return this.oceanFrac[c] < 0.5;
  }
}
