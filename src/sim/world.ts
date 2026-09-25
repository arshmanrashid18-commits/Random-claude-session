/**
 * World: the root of all simulation state. Owns the single seeded PRNG that is
 * threaded through every system, the tick counter, and the ordered list of
 * systems executed each tick. Pure data + logic: no DOM, no rendering, runs
 * identically in the Web Worker and in Node (tests, soak).
 */
import { Rng } from '../core/rng';
import { Planet } from './planet/planet';
import { WORLD_PRESETS, type WorldParams, type WorldPresetId } from './planet/presets';
import type { ProgressFn } from './planet/terrain';
import { Geography } from './planet/geography';
import { Weather } from './climate/weather';
import { Plants } from './ecology/plants';
import { Fires } from './ecology/fire';
import { Animals } from './ecology/animals';
import { EventLog } from './events';
import { TICKS_PER_YEAR } from './constants';

export interface WorldOptions {
  seed: number;
  preset: WorldPresetId;
}

export class World {
  readonly seed: number;
  readonly preset: WorldPresetId;
  readonly params: WorldParams;
  rng: Rng;
  tick = 0;
  planet: Planet;
  geo: Geography;
  weather: Weather;
  plants: Plants;
  fires: Fires;
  animals: Animals;
  events = new EventLog();

  constructor(opts: WorldOptions, progress: ProgressFn = () => {}) {
    this.seed = opts.seed >>> 0;
    this.preset = opts.preset;
    this.params = WORLD_PRESETS[opts.preset].params;
    this.rng = new Rng(this.seed);
    this.planet = new Planet(this.seed, this.params, progress);
    const p = this.planet;
    this.geo = new Geography(p.region.count, this.seed);
    this.geo.compute(p.region, p.terrain);
    this.weather = new Weather(p.region.count, this.seed);
    this.weather.initBaseline(p.climate);
    progress('Seeding life', 0);
    this.plants = new Plants(p.region);
    this.plants.initialise(p.climate, p.terrain);
    this.plants.spinUp(p.climate, p.terrain, 45, 2.5);
    progress('Seeding life', 0.6);
    this.fires = new Fires(p.region.count);
    this.animals = new Animals(p.region.count, p.region);
    this.animals.computeWater(p.region, p.terrain);
    this.animals.populate(this.rng, p.climate, p.terrain);
    progress('Seeding life', 1);
  }

  /** Advance the simulation by one fixed tick. */
  step(): void {
    const t = this.tick;
    const p = this.planet;
    const cl = p.climate;
    cl.tick(t);
    this.weather.update(t, cl, this.rng, this.events, this.geo);
    // Lightning can ignite dry vegetation.
    for (const s of this.weather.strikes) {
      const c = p.region.cellOf(s.x, s.y, s.z);
      if (p.terrain.oceanFrac[c] > 0.5) continue;
      const dry = 1 - Math.min(1, cl.soil[c] * 1.5);
      if (this.plants.fuel(c) > 0.35 && this.rng.chance(0.25 * dry * s.power)) this.fires.ignite(c, 0.6);
    }
    this.fires.tick(t, this.rng, cl, this.plants, p.terrain, this.events, this.geo);
    this.plants.tick(cl, p.terrain);
    this.animals.tick(t, this.rng, cl, this.plants, p.terrain, this.events, this.geo, this.fires);
    if (t % TICKS_PER_YEAR === TICKS_PER_YEAR - 1) {
      p.refreshFlow();
      this.animals.computeWater(p.region, p.terrain);
    }
    this.tick = t + 1;
  }

  /** Stable hash of the complete simulation state (for determinism tests). */
  hash(): number {
    let h = 0x811c9dc5;
    const f = new Float32Array(1);
    const u = new Uint32Array(f.buffer);
    const mix = (arr: ArrayLike<number>) => {
      for (let i = 0; i < arr.length; i++) {
        f[0] = arr[i];
        h ^= u[0];
        h = Math.imul(h, 0x01000193);
      }
    };
    const c = this.planet.climate;
    const a = this.animals;
    mix([this.tick]);
    mix(this.rng.getState());
    mix(this.planet.heights);
    mix(c.temp); mix(c.humid); mix(c.snow); mix(c.soil); mix(c.meanRain); mix(c.meanTemp);
    mix(this.plants.density);
    mix(this.fires.intensity);
    mix(a.x); mix(a.y); mix(a.z); mix(a.alive); mix(a.hunger); mix(a.health);
    mix(this.weather.storms.flatMap((s) => [s.x, s.y, s.z, s.intensity]));
    return h >>> 0;
  }
}
