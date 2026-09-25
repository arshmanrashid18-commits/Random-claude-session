/**
 * Planet: bundles the geometric grids, heightmap, derived terrain statistics,
 * hydrology and climate, and orchestrates world generation.
 */
import { CellGrid, VertexGrid } from './cubesphere';
import { generateTerrain, type Plate, type ProgressFn } from './terrain';
import { RegionTerrain } from './regions';
import { Hydrology } from './hydrology';
import { Climate } from '../climate/climate';
import { HEIGHT_N, HYDRO_N, REGION_N } from '../constants';
import type { WorldParams } from './presets';

let sharedGrids: { hg: VertexGrid; region: CellGrid; hydro: CellGrid } | null = null;
/** Grids are pure geometry; build once per process and share. */
export function getGrids(): { hg: VertexGrid; region: CellGrid; hydro: CellGrid } {
  if (!sharedGrids) {
    sharedGrids = { hg: new VertexGrid(HEIGHT_N), region: new CellGrid(REGION_N), hydro: new CellGrid(HYDRO_N) };
  }
  return sharedGrids;
}

export class Planet {
  readonly hg: VertexGrid;
  readonly region: CellGrid;
  readonly hydroGrid: CellGrid;
  heights: Float32Array;
  plates: Plate[];
  plateOf: Uint8Array;
  stress: Float32Array;
  ore: Float32Array;
  terrain: RegionTerrain;
  hydro: Hydrology;
  climate: Climate;
  /** Incremented on every height change (renderer resync). */
  heightVersion = 0;

  constructor(seed: number, params: WorldParams, progress: ProgressFn = () => {}) {
    const g = getGrids();
    this.hg = g.hg;
    this.region = g.region;
    this.hydroGrid = g.hydro;
    const t = generateTerrain(seed, params, this.hg, this.region, progress);
    this.heights = t.heights;
    this.plates = t.plates;
    this.plateOf = t.plateOf;
    this.stress = t.stress;
    this.ore = t.ore;
    this.terrain = new RegionTerrain(this.region);
    this.terrain.computeAll(this.heights, this.hg);
    this.hydro = new Hydrology(this.hydroGrid);
    this.climate = new Climate(this.region, this.terrain, {
      baseOffset: params.temperatureOffset,
      transientOffset: 0,
      moisture: params.moisture,
      oscillation: 0.35,
      oscillationPhase: 0,
    });
    progress('Stirring the winds', 0);
    this.climate.initialise(0);
    this.climate.spinUp(0, 2.5, (f) => progress('Stirring the winds', f));
    progress('Carving rivers', 0);
    this.rebuildHydrology(true);
    progress('Carving rivers', 1);
    // A short second spin-up lets rivers and lakes feed back into the climate.
    this.climate.spinUp(0, 1.0);
    this.climate.classifyAll();
  }

  /** Recompute drainage, rivers and lakes; optionally carve valleys. */
  rebuildHydrology(carve: boolean): void {
    const hy = this.hydro;
    hy.sampleHeights(this.heights, this.hg);
    hy.computeDrainage();
    const clim = this.climate;
    const hydroG = this.hydroGrid;
    hy.accumulate((c) => clim.grid.sample(clim.meanRain, hydroG.centers[c * 3], hydroG.centers[c * 3 + 1], hydroG.centers[c * 3 + 2]));
    if (carve) {
      hy.carve(this.heights, this.hg);
      this.terrain.computeAll(this.heights, this.hg);
      hy.sampleHeights(this.heights, this.hg);
    }
    this.syncHydroToRegions();
    hy.buildRivers((x, y, z) => this.heightAt(x, y, z));
    this.climate.computeGradients();
    this.heightVersion++;
  }

  /** Refresh river discharge from current rainfall (droughts shrink rivers). */
  refreshFlow(): void {
    const clim = this.climate;
    const hydroG = this.hydroGrid;
    this.hydro.accumulate((c) => clim.grid.sample(clim.meanRain, hydroG.centers[c * 3], hydroG.centers[c * 3 + 1], hydroG.centers[c * 3 + 2]));
    this.syncHydroToRegions();
  }

  syncHydroToRegions(): void {
    const R = this.region, H = this.hydroGrid, hy = this.hydro;
    const ratio = H.n / R.n;
    for (let c = 0; c < R.count; c++) {
      const face = Math.floor(c / R.faceSize);
      const rem = c - face * R.faceSize;
      const j = Math.floor(rem / R.n), i = rem - j * R.n;
      let lake = 0, river = 0, cnt = 0;
      for (let dj = 0; dj < ratio; dj++) {
        for (let di = 0; di < ratio; di++) {
          const hc = face * H.faceSize + (j * ratio + dj) * H.n + (i * ratio + di);
          if (hy.lakeId[hc] >= 0) lake++;
          if (hy.h[hc] >= 0 && hy.flow[hc] > river) river = hy.flow[hc];
          cnt++;
        }
      }
      this.terrain.lakeFrac[c] = lake / cnt;
      this.terrain.river[c] = river / 55;
    }
  }

  heightAt(x: number, y: number, z: number): number {
    return this.hg.sample(this.heights, x, y, z);
  }
}
