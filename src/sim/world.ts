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

  constructor(opts: WorldOptions, progress: ProgressFn = () => {}) {
    this.seed = opts.seed >>> 0;
    this.preset = opts.preset;
    this.params = WORLD_PRESETS[opts.preset].params;
    this.rng = new Rng(this.seed);
    this.planet = new Planet(this.seed, this.params, progress);
  }

  /** Advance the simulation by one fixed tick. */
  step(): void {
    const t = this.tick;
    this.planet.climate.tick(t);
    this.tick = t + 1;
  }

  /** Stable hash of the complete simulation state (for determinism tests). */
  hash(): number {
    let h = 0x811c9dc5;
    const mix = (arr: ArrayLike<number>) => {
      const f = new Float32Array(1);
      const u = new Uint32Array(f.buffer);
      for (let i = 0; i < arr.length; i++) {
        f[0] = arr[i];
        h ^= u[0];
        h = Math.imul(h, 0x01000193);
      }
    };
    const c = this.planet.climate;
    mix([this.tick]);
    mix(this.rng.getState());
    mix(this.planet.heights);
    mix(c.temp); mix(c.humid); mix(c.snow); mix(c.soil); mix(c.meanRain); mix(c.meanTemp);
    return h >>> 0;
  }
}
