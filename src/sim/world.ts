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
import { Civ } from './civ/civ';
import { TICKS_PER_YEAR } from './constants';
import { Terraformer, type BrushTool } from './planet/terraform';
import { Divine, type CastResult } from './powers/divine';
import type { PowerId } from './powers/defs';
import { tickScenario, type ScenarioState } from './scenarios';

/** Player commands (from the UI, applied between ticks). */
export type Command =
  | { kind: 'power'; power: PowerId; x: number; y: number; z: number }
  | { kind: 'brush'; tool: BrushTool; x: number; y: number; z: number; radius: number; strength: number; paint?: number; level?: number }
  | { kind: 'brushEnd' }
  | { kind: 'boundless'; on: boolean };

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
  civ: Civ;
  events = new EventLog();
  terraform: Terraformer;
  divine: Divine;
  /** Active scenario (null in sandbox). */
  scenario: ScenarioState | null = null;

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
    progress('Seeding life', 0.85);
    this.civ = new Civ(p);
    this.civ.seedTribes(this.rng, 0, p, this.animals, this.geo, this.events);
    this.divine = new Divine(p.region.count);
    this.terraform = new Terraformer(p);
    this.wire();
    progress('Seeding life', 1);
  }

  /** Reconnect callbacks (after construction or after loading a save). */
  wire(): void {
    const p = this.planet;
    this.terraform.onCommit = () => {
      this.animals.computeWater(p.region, p.terrain);
      this.civ.afterTerraform(p, this.tick, this.rng, this.events);
    };
  }

  /** Apply a player command immediately (between ticks). */
  command(cmd: Command): CastResult {
    switch (cmd.kind) {
      case 'power':
        return this.divine.cast(this, cmd);
      case 'brush': {
        const l = Math.hypot(cmd.x, cmd.y, cmd.z) || 1;
        const changed = this.terraform.brush({ ...cmd, x: cmd.x / l, y: cmd.y / l, z: cmd.z / l });
        return { ok: changed, message: changed ? '' : 'Nothing to change here' };
      }
      case 'brushEnd':
        if (this.terraform.pending) this.terraform.commit();
        return { ok: true, message: '' };
      case 'boundless':
        this.divine.boundless = cmd.on;
        return { ok: true, message: '' };
    }
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
    this.civ.tick(t, this.rng, p, this.plants, this.animals, this.fires, this.events, this.geo);
    this.divine.tick(this);
    if (t % 40 === 39) tickScenario(this);
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
    const P = this.civ.people;
    mix(P.x); mix(P.y); mix(P.z); mix(P.alive); mix(P.hunger); mix(P.job);
    mix(this.civ.settlements.flatMap((s) => s.stock));
    mix(this.civ.buildings.map((b) => b.progress));
    mix(this.divine.lava); mix(this.divine.flood);
    mix([this.civ.devotion, this.divine.effects.length, this.civ.tribes.length, this.civ.society.wars.length]);
    return h >>> 0;
  }
}
