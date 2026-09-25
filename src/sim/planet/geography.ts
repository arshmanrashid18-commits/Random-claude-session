/**
 * Geography: continents and oceans as connected components of the region grid,
 * each with a procedural name in the "old tongue" of the world. Used by the
 * chronicle ("the Great Drought of Varanor"), weather and civilisation.
 */
import { Language } from '../../core/language';
import type { CellGrid } from './cubesphere';
import type { RegionTerrain } from './regions';

export interface Landmass {
  id: number;
  name: string;
  cells: number[];
  /** Area in region cells. */
  size: number;
  kind: 'continent' | 'island' | 'ocean' | 'sea';
}

export class Geography {
  continents: Landmass[] = [];
  oceans: Landmass[] = [];
  /** Region cell → continent id (-1 water). */
  landOf: Int32Array;
  /** Region cell → ocean id (-1 land). */
  waterOf: Int32Array;
  private lang: Language;

  constructor(cellCount: number, seed: number) {
    this.landOf = new Int32Array(cellCount).fill(-1);
    this.waterOf = new Int32Array(cellCount).fill(-1);
    this.lang = new Language(seed ^ 0x6e0);
  }

  compute(grid: CellGrid, terrain: RegionTerrain): void {
    this.continents = [];
    this.oceans = [];
    this.landOf.fill(-1);
    this.waterOf.fill(-1);
    const stack: number[] = [];
    for (let c0 = 0; c0 < grid.count; c0++) {
      const land = terrain.oceanFrac[c0] < 0.5;
      const map = land ? this.landOf : this.waterOf;
      if (map[c0] !== -1) continue;
      const list = land ? this.continents : this.oceans;
      const id = list.length;
      const cells: number[] = [];
      stack.push(c0);
      map[c0] = id;
      while (stack.length) {
        const c = stack.pop()!;
        cells.push(c);
        for (let k = 0; k < 4; k++) {
          const nb = grid.neighbors[c * 8 + k];
          if ((terrain.oceanFrac[nb] < 0.5) !== land || map[nb] !== -1) continue;
          map[nb] = id;
          stack.push(nb);
        }
      }
      const size = cells.length;
      const kind = land ? (size > 250 ? 'continent' : 'island') : size > 600 ? 'ocean' : 'sea';
      list.push({ id, name: '', cells, size, kind });
    }
    // Names: larger landmasses get grander names; stable under recomputation
    // because they derive from the component's smallest cell index.
    for (const m of this.continents) m.name = this.lang.nameFor(minCell(m.cells), 'place');
    for (const m of this.oceans) m.name = this.lang.nameFor(minCell(m.cells) + 900000, 'place');
  }

  continentOf(cell: number): number {
    return this.landOf[cell];
  }

  /** Display name for any cell: "the Aldora coast", "the Sea of Mirel". */
  describe(cell: number): string {
    const l = this.landOf[cell];
    if (l >= 0) {
      const m = this.continents[l];
      return m.kind === 'island' ? `the isle of ${m.name}` : m.name;
    }
    const w = this.waterOf[cell];
    if (w >= 0) {
      const m = this.oceans[w];
      return m.kind === 'ocean' ? `the ${m.name} Ocean` : `the Sea of ${m.name}`;
    }
    return 'the wilds';
  }
}

function minCell(cells: number[]): number {
  let m = Infinity;
  for (const c of cells) if (c < m) m = c;
  return m;
}
