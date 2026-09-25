/**
 * Plant communities on the region grid. Eight functional species live in
 * every land cell as densities in [0,1]:
 *
 *   0 grass   1 shrub   2 broadleaf   3 conifer
 *   4 tropical   5 xeric (cactus/succulent)   6 reeds   7 moss/lichen
 *
 * Each plant step, species grow logistically according to their climate
 * suitability (temperature curve, rainfall and soil moisture), compete for
 * light (taller species shade shorter ones) and water (total demand is
 * limited by supply), spread by seed rain from neighbouring cells, and die
 * back from frost, drought and heat. Herbivores graze, people log and fire
 * burns through the same fields, so ecology and civilisation reshape the
 * visible land.
 */
import type { Climate } from '../climate/climate';
import type { RegionTerrain } from '../planet/regions';
import type { CellGrid } from '../planet/cubesphere';

export const PLANT_SPECIES = 8;
export const PLANT_NAMES = ['Grasses', 'Shrubs', 'Broadleaf trees', 'Conifers', 'Tropical trees', 'Cacti & succulents', 'Reeds', 'Mosses & lichens'];
/** Ticks between plant updates of a given cell. */
export const PLANT_PHASES = 32;

interface PlantSpec {
  tOpt: number; tWidth: number; tMin: number; tMax: number;
  rainMin: number; rainOpt: number; rainMax: number;
  growth: number; maxD: number; height: number; spread: number; water: number;
  wetland: number; // affinity for lake/river margins
}

export const PLANTS: PlantSpec[] = [
  { tOpt: 18, tWidth: 16, tMin: -8, tMax: 42, rainMin: 0.25, rainOpt: 1.4, rainMax: 4.5, growth: 0.5, maxD: 1, height: 0.2, spread: 0.06, water: 0.4, wetland: 0.2 },
  { tOpt: 14, tWidth: 16, tMin: -14, tMax: 40, rainMin: 0.35, rainOpt: 1.1, rainMax: 3.5, growth: 0.25, maxD: 0.8, height: 0.45, spread: 0.035, water: 0.45, wetland: 0 },
  { tOpt: 13, tWidth: 9, tMin: -8, tMax: 30, rainMin: 1.0, rainOpt: 2.0, rainMax: 4.5, growth: 0.14, maxD: 0.95, height: 1, spread: 0.02, water: 0.8, wetland: 0 },
  { tOpt: 2, tWidth: 9, tMin: -24, tMax: 22, rainMin: 0.55, rainOpt: 1.3, rainMax: 3.5, growth: 0.12, maxD: 0.95, height: 0.95, spread: 0.02, water: 0.55, wetland: 0 },
  { tOpt: 26, tWidth: 5, tMin: 12, tMax: 40, rainMin: 1.6, rainOpt: 3.2, rainMax: 8, growth: 0.18, maxD: 1, height: 1.1, spread: 0.02, water: 1.0, wetland: 0 },
  { tOpt: 25, tWidth: 12, tMin: -2, tMax: 50, rainMin: 0.0, rainOpt: 0.35, rainMax: 1.0, growth: 0.1, maxD: 0.5, height: 0.5, spread: 0.02, water: 0.1, wetland: 0 },
  { tOpt: 18, tWidth: 14, tMin: -2, tMax: 38, rainMin: 0.8, rainOpt: 2.5, rainMax: 8, growth: 0.3, maxD: 0.9, height: 0.35, spread: 0.03, water: 1.0, wetland: 1 },
  { tOpt: -4, tWidth: 9, tMin: -40, tMax: 16, rainMin: 0.15, rainOpt: 0.8, rainMax: 3.5, growth: 0.12, maxD: 0.9, height: 0.05, spread: 0.03, water: 0.2, wetland: 0.1 },
];

export class Plants {
  readonly grid: CellGrid;
  /** density[c * 8 + s] */
  density: Float32Array;
  /** Accumulated grazing pressure to apply next step (herbivores). */
  grazed: Float32Array;
  /** Accumulated logging (people) per cell, removed from trees next step. */
  logged: Float32Array;
  /** Divine fertility bonus per cell (fertile bloom), decays. */
  bloom: Float32Array;
  phase = 0;
  private scratch = new Float32Array(PLANT_SPECIES);

  constructor(grid: CellGrid) {
    this.grid = grid;
    this.density = new Float32Array(grid.count * PLANT_SPECIES);
    this.grazed = new Float32Array(grid.count);
    this.logged = new Float32Array(grid.count);
    this.bloom = new Float32Array(grid.count);
  }

  /** Climate suitability of species s in cell c, in [-1,1]. */
  suitability(s: number, c: number, climate: Climate, terrain: RegionTerrain, tempOverride?: number): number {
    const sp = PLANTS[s];
    const t = tempOverride ?? climate.temp[c];
    const rain = climate.meanRain[c];
    if (t < sp.tMin || t > sp.tMax) return -1;
    const tf = Math.exp(-(((t - sp.tOpt) / sp.tWidth) ** 2));
    let rf: number;
    if (rain < sp.rainMin) rf = -0.5 + (rain / Math.max(0.01, sp.rainMin)) * 0.5;
    else if (rain < sp.rainOpt) rf = (rain - sp.rainMin) / Math.max(0.01, sp.rainOpt - sp.rainMin);
    else if (rain < sp.rainMax) rf = 1 - ((rain - sp.rainOpt) / (sp.rainMax - sp.rainOpt)) * 0.5;
    else rf = 0.3;
    const soil = climate.soil[c];
    const wet = Math.max(terrain.lakeFrac[c] > 0 ? 0.6 : 0, Math.min(1, terrain.river[c] * 0.15));
    let s0 = tf * Math.max(-0.5, rf) * (0.6 + soil * 0.6);
    if (sp.wetland > 0) s0 = s0 * (1 - sp.wetland) + sp.wetland * wet * tf * 1.2;
    // Steep slopes and high altitude thin everything but mosses.
    const slope = terrain.slope[c];
    if (s !== 7) s0 *= 1 - Math.min(0.8, Math.max(0, slope - 0.25) * 1.5);
    if (climate.snow[c] > 0.5 && s !== 7) s0 -= 0.3;
    return Math.max(-1, Math.min(1, s0));
  }

  /** Seed initial vegetation proportionally to suitability. */
  initialise(climate: Climate, terrain: RegionTerrain): void {
    for (let c = 0; c < this.grid.count; c++) {
      if (terrain.oceanFrac[c] > 0.5) continue;
      for (let s = 0; s < PLANT_SPECIES; s++) {
        const su = this.suitability(s, c, climate, terrain, climate.meanTemp[c]);
        this.density[c * PLANT_SPECIES + s] = su > 0 ? su * 0.2 : 0;
      }
    }
  }

  /** Fast-forward to equilibrium at world creation. */
  spinUp(climate: Climate, terrain: RegionTerrain, steps: number, dtScale: number): void {
    for (let i = 0; i < steps; i++) {
      for (let c = 0; c < this.grid.count; c++) this.updateCell(c, climate, terrain, dtScale, true);
    }
  }

  /** Called every tick: processes 1/PLANT_PHASES of the cells. */
  tick(climate: Climate, terrain: RegionTerrain): void {
    const n = this.grid.count;
    const start = Math.floor((this.phase * n) / PLANT_PHASES);
    const end = Math.floor(((this.phase + 1) * n) / PLANT_PHASES);
    for (let c = start; c < end; c++) this.updateCell(c, climate, terrain, 1, false);
    this.phase = (this.phase + 1) % PLANT_PHASES;
  }

  updateCell(c: number, climate: Climate, terrain: RegionTerrain, dt: number, spin: boolean): void {
    const D = this.density;
    const base = c * PLANT_SPECIES;
    if (terrain.oceanFrac[c] > 0.5) {
      for (let s = 0; s < PLANT_SPECIES; s++) D[base + s] = 0;
      this.grazed[c] = 0;
      this.logged[c] = 0;
      return;
    }
    const lake = terrain.lakeFrac[c];
    const temp = spin ? climate.meanTemp[c] : climate.temp[c];
    // Water: supply from soil + rain vs. demand.
    let demand = 0;
    for (let s = 0; s < PLANT_SPECIES; s++) demand += D[base + s] * PLANTS[s].water;
    const supply = 0.25 + climate.soil[c] * 1.1 + Math.min(1.5, climate.meanRain[c] * 0.45) + Math.min(0.8, terrain.river[c] * 0.1);
    const waterK = demand > supply ? supply / demand : 1;
    const bloom = this.bloom[c];
    const sc = this.scratch;
    for (let s = 0; s < PLANT_SPECIES; s++) sc[s] = D[base + s];
    for (let s = 0; s < PLANT_SPECIES; s++) {
      const sp = PLANTS[s];
      let d = sc[s];
      // Light: shading by taller species.
      let shade = 0;
      for (let t = 0; t < PLANT_SPECIES; t++) if (PLANTS[t].height > sp.height + 0.1) shade += sc[t] * (PLANTS[t].height - sp.height) * 0.9;
      const light = Math.max(0.05, 1 - shade);
      const su = this.suitability(s, c, climate, terrain, temp);
      // Seed rain from neighbours.
      let nb = 0;
      for (let k = 0; k < 4; k++) nb += D[this.grid.neighbors[c * 8 + k] * PLANT_SPECIES + s];
      nb *= 0.25;
      if (su > 0) {
        const g = sp.growth * su * light * waterK * (1 + bloom);
        d += dt * (g * d * (1 - d / (sp.maxD * (1 - lake * 0.8))) + sp.spread * (nb + 0.002) * su * light);
      } else {
        d += dt * su * 0.08 * d;
      }
      // Frost dieback of above-ground biomass (seasonal), drought stress.
      if (!spin) {
        if (temp < sp.tMin + 6 && (s === 0 || s === 1 || s === 6)) d *= 1 - 0.01 * dt;
        if (climate.soil[c] < 0.08 && sp.water > 0.5) d *= 1 - 0.01 * dt;
      }
      sc[s] = Math.min(1, Math.max(0, d));
    }
    // Grazing and logging.
    const gz = this.grazed[c];
    if (gz > 0) {
      const food = sc[0] + sc[1] * 0.6 + sc[6] * 0.4 + sc[7] * 0.5 + 1e-6;
      const k = Math.min(0.9, gz / food);
      sc[0] *= 1 - k; sc[1] *= 1 - k * 0.6; sc[6] *= 1 - k * 0.4; sc[7] *= 1 - k * 0.5;
      this.grazed[c] = 0;
    }
    const lg = this.logged[c];
    if (lg > 0) {
      const trees = sc[2] + sc[3] + sc[4] + 1e-6;
      const k = Math.min(0.95, lg / trees);
      sc[2] *= 1 - k; sc[3] *= 1 - k; sc[4] *= 1 - k;
      this.logged[c] = 0;
    }
    if (bloom > 0) this.bloom[c] = Math.max(0, bloom - 0.01 * dt);
    for (let s = 0; s < PLANT_SPECIES; s++) D[base + s] = sc[s];
  }

  /** Food available to grazers in cell c (0..~2). */
  forage(c: number): number {
    const b = c * PLANT_SPECIES;
    const D = this.density;
    return D[b] + D[b + 1] * 0.6 + D[b + 6] * 0.4 + D[b + 7] * 0.5 + D[b + 2] * 0.15 + D[b + 4] * 0.2 + D[b + 5] * 0.3;
  }

  trees(c: number): number {
    const b = c * PLANT_SPECIES;
    return this.density[b + 2] + this.density[b + 3] + this.density[b + 4];
  }

  /** Burn: removes a fraction of all biomass, returns fuel consumed. */
  burn(c: number, frac: number): number {
    const b = c * PLANT_SPECIES;
    let fuel = 0;
    for (let s = 0; s < PLANT_SPECIES; s++) {
      const loss = this.density[b + s] * frac * (s === 5 ? 0.3 : 1);
      fuel += loss * (PLANTS[s].height + 0.2);
      this.density[b + s] -= loss;
    }
    return fuel;
  }

  /** Total fuel load (for fire spread). */
  fuel(c: number): number {
    const b = c * PLANT_SPECIES;
    let f = 0;
    for (let s = 0; s < PLANT_SPECIES; s++) f += this.density[b + s] * (PLANTS[s].height + 0.2);
    return f;
  }

  /** Species richness for biodiversity: count of species above threshold. */
  richness(c: number): number {
    const b = c * PLANT_SPECIES;
    let n = 0;
    for (let s = 0; s < PLANT_SPECIES; s++) if (this.density[b + s] > 0.08) n++;
    return n;
  }
}
