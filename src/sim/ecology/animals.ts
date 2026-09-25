/**
 * Animal agents (structure-of-arrays).
 *
 * Every animal has needs (hunger, thirst, health), genes that drift at birth
 * (speed, size, fertility, cold/heat tolerance), a herd leader to follow, and a
 * small state machine: wander, graze, seek water, drink, flee, hunt, eat, rest,
 * migrate, hibernate. Herbivores graze the plant simulation (so they set their
 * own carrying capacity); predators hunt specific prey; disease spreads
 * through dense herds. Populations therefore boom, crash and cycle.
 *
 * Speciation: populations isolated on another landmass whose mean genes drift
 * far from their species' founders become a new named species. Extinctions
 * are recorded. Population history feeds the ecosystem dashboard.
 */
import type { Rng } from '../../core/rng';
import { BASE_SPECIES, habitat, type SpeciesDef } from './species';
import { SpatialHash } from '../spatial';
import { stepToward, offsetDir } from '../move';
import type { Climate } from '../climate/climate';
import type { Plants } from './plants';
import type { RegionTerrain } from '../planet/regions';
import type { EventLog } from '../events';
import type { Geography } from '../planet/geography';
import type { Fires } from './fire';
import { BIOME_NAMES } from '../climate/biomes';
import { PLANET_RADIUS, TICKS_PER_YEAR, dayFrac } from '../constants';

export const AState = {
  Wander: 0, Graze: 1, SeekWater: 2, Drink: 3, Flee: 4, Hunt: 5, Eat: 6, Rest: 7, Migrate: 8, Hibernate: 9,
} as const;

export const ANIMAL_CAPACITY = 12000;
const BRAIN_INTERVAL = 6;
const INV_R = 1 / PLANET_RADIUS;
export const HISTORY_INTERVAL = 96;
export const HISTORY_LEN = 1200;

export interface EcoRecord {
  tick: number;
  kind: 'speciation' | 'extinction';
  species: number;
  name: string;
  parent?: string;
  where?: string;
}

export class Animals {
  cap: number;
  /** High-water mark of used slots. */
  count = 0;
  alive: Uint8Array;
  species: Uint8Array;
  sex: Uint8Array;
  state: Uint8Array;
  x: Float32Array; y: Float32Array; z: Float32Array;
  tx: Float32Array; ty: Float32Array; tz: Float32Array;
  age: Float32Array;
  hunger: Float32Array;
  thirst: Float32Array;
  health: Float32Array;
  gSpeed: Float32Array; gSize: Float32Array; gFert: Float32Array; gCold: Float32Array; gHeat: Float32Array;
  leader: Int32Array;
  target: Int32Array;
  timer: Int16Array;
  cooldown: Float32Array;
  pregnant: Float32Array;
  infected: Uint8Array;
  infTimer: Int16Array;
  uid: Uint32Array;
  generation: Uint16Array;
  nextUid = 1;
  free: number[] = [];

  defs: SpeciesDef[];
  /** Founder gene means per species (speed,size,fert,cold,heat). */
  founders: number[][];
  pop: Int32Array;
  /** Population history ring buffer: [sample][species] (up to 64 species). */
  history: Uint16Array;
  historyHead = 0;
  historyCount = 0;
  records: EcoRecord[] = [];
  everExisted: Uint8Array;
  hash: SpatialHash;
  /** Region cell → next cell toward nearest fresh water, and distance in cells. */
  waterNext: Int32Array;
  waterDist: Uint16Array;
  /** Kills this tick (for renderer blood/dust effects and people's hunting). */
  kills: { x: number; y: number; z: number; species: number }[] = [];
  /** Diffused prey density per base predator species (scent field) and forage-seeking helpers. */
  preyField: Float32Array[] = [];
  /** Long-range version of preyField (dispersal toward distant herds). */
  preyFar: Float32Array[] = [];
  /** Long-range density of adult males per base predator species (mate seeking). */
  mateField: Float32Array[] = [];
  private fieldTmp: Float32Array;
  private baseCounts: Uint16Array | null = null;
  /** Carcass meat per region cell, left by natural deaths; decays. */
  carrion: Float32Array;
  /** Deaths by cause per species: [species * 8 + cause]. Causes: 0 hunger, 1 thirst, 2 age, 3 predation, 4 disease, 5 fire, 6 climate, 7 other. */
  deaths: Uint32Array = new Uint32Array(64 * 8);
  private scratch = [0, 0, 0];

  readonly grid: import('../planet/cubesphere').CellGrid;

  constructor(regionCount: number, grid: import('../planet/cubesphere').CellGrid, cap = ANIMAL_CAPACITY) {
    this.grid = grid;
    this.cap = cap;
    this.alive = new Uint8Array(cap);
    this.species = new Uint8Array(cap);
    this.sex = new Uint8Array(cap);
    this.state = new Uint8Array(cap);
    this.x = new Float32Array(cap); this.y = new Float32Array(cap); this.z = new Float32Array(cap);
    this.tx = new Float32Array(cap); this.ty = new Float32Array(cap); this.tz = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.hunger = new Float32Array(cap);
    this.thirst = new Float32Array(cap);
    this.health = new Float32Array(cap);
    this.gSpeed = new Float32Array(cap); this.gSize = new Float32Array(cap); this.gFert = new Float32Array(cap);
    this.gCold = new Float32Array(cap); this.gHeat = new Float32Array(cap);
    this.leader = new Int32Array(cap).fill(-1);
    this.target = new Int32Array(cap).fill(-1);
    this.timer = new Int16Array(cap);
    this.cooldown = new Float32Array(cap);
    this.pregnant = new Float32Array(cap);
    this.infected = new Uint8Array(cap);
    this.infTimer = new Int16Array(cap);
    this.uid = new Uint32Array(cap);
    this.generation = new Uint16Array(cap);
    this.defs = BASE_SPECIES.map((d) => ({ ...d, biomes: { ...d.biomes }, prey: [...d.prey] }));
    this.founders = this.defs.map(() => [1, 1, 1, 0, 0]);
    this.pop = new Int32Array(64);
    this.history = new Uint16Array(HISTORY_LEN * 64);
    this.everExisted = new Uint8Array(64);
    this.hash = new SpatialHash(grid, cap);
    this.waterNext = new Int32Array(regionCount).fill(-1);
    this.waterDist = new Uint16Array(regionCount).fill(65535);
    for (let k = 0; k < BASE_SPECIES.length; k++) {
      const pred = BASE_SPECIES[k].diet !== 'herbivore';
      this.preyField.push(pred ? new Float32Array(regionCount) : new Float32Array(0));
      this.preyFar.push(pred ? new Float32Array(regionCount) : new Float32Array(0));
      this.mateField.push(pred ? new Float32Array(regionCount) : new Float32Array(0));
    }
    this.fieldTmp = new Float32Array(regionCount);
    this.carrion = new Float32Array(regionCount);
    this.rebuildMasks();
  }

  /** Base (founding) species id of a possibly derived species. */
  baseOf(sp: number): number {
    const p = this.defs[sp].parent;
    return p >= 0 ? p : sp;
  }

  /** Bitmask of base prey species per species id, and of base predators per species id. */
  preyMask = new Int32Array(64);
  threatMask = new Int32Array(64);

  rebuildMasks(): void {
    this.preyMask.fill(0);
    this.threatMask.fill(0);
    for (let s = 0; s < this.defs.length; s++) {
      let m = 0;
      for (const p of this.defs[s].prey) m |= 1 << p;
      this.preyMask[s] = m;
    }
    for (let s = 0; s < this.defs.length; s++) {
      const b = this.baseOf(s);
      let m = 0;
      for (let p = 0; p < BASE_SPECIES.length; p++) if (BASE_SPECIES[p].prey.includes(b)) m |= 1 << p;
      this.threatMask[s] = m;
    }
  }

  /** Rebuild predators' prey scent fields: counts per cell, blurred over the grid. */
  private updatePreyFields(grid: import('../planet/cubesphere').CellGrid): void {
    const n = grid.count;
    const NB = BASE_SPECIES.length;
    if (!this.baseCounts || this.baseCounts.length !== n * NB) this.baseCounts = new Uint16Array(n * NB);
    const bc = this.baseCounts;
    bc.fill(0);
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const c = this.hash.bucketOf[i];
      if (c >= 0) bc[c * NB + this.baseOf(this.species[i])]++;
    }
    for (let p = 0; p < NB; p++) {
      const def = BASE_SPECIES[p];
      if (def.diet === 'herbivore') continue;
      const f = this.preyField[p];
      const prey = def.prey;
      for (let c = 0; c < n; c++) {
        let v = 0;
        for (let k = 0; k < prey.length; k++) v += bc[c * NB + prey[k]];
        f[c] = v;
      }
      for (let c = 0; c < n; c++) f[c] += this.carrion[c] * 2;
      // Blur: scent spreads a few cells; the far field keeps spreading.
      const tmp = this.fieldTmp;
      const far = this.preyFar[p];
      for (let it = 0; it < 10; it++) {
        const src = it < 3 ? f : far;
        for (let c = 0; c < n; c++) {
          let s = src[c] * 2;
          for (let k = 0; k < 4; k++) s += src[grid.neighbors[c * 8 + k]];
          tmp[c] = s / 6;
        }
        if (it < 3) f.set(tmp);
        if (it === 2) far.set(f);
        else if (it > 2) far.set(tmp);
      }
      // Mate field: adult males of this predator's own base species.
      const mf = this.mateField[p];
      mf.fill(0);
      for (let i = 0; i < this.count; i++) {
        if (!this.alive[i] || this.sex[i] !== 1 || this.baseOf(this.species[i]) !== p) continue;
        const c = this.hash.bucketOf[i];
        if (c >= 0 && this.age[i] > def.adultAge) mf[c] += 1;
      }
      for (let it = 0; it < 7; it++) {
        for (let c = 0; c < n; c++) {
          let s = mf[c] * 2;
          for (let k = 0; k < 4; k++) s += mf[grid.neighbors[c * 8 + k]];
          tmp[c] = s / 6;
        }
        mf.set(tmp);
      }
    }
  }

  /** Multi-source BFS from fresh water (rivers, lakes, wetlands) over land. */
  computeWater(grid: import('../planet/cubesphere').CellGrid, terrain: RegionTerrain): void {
    const n = grid.count;
    this.waterNext.fill(-1);
    this.waterDist.fill(65535);
    const queue = new Int32Array(n);
    let qh = 0, qt = 0;
    for (let c = 0; c < n; c++) {
      if (terrain.oceanFrac[c] > 0.5) continue;
      if (terrain.river[c] > 0.8 || terrain.lakeFrac[c] > 0.05 || (terrain.coastal[c] && terrain.river[c] > 0.2)) {
        this.waterDist[c] = 0;
        this.waterNext[c] = c;
        queue[qt++] = c;
      }
    }
    while (qh < qt) {
      const c = queue[qh++];
      const d = this.waterDist[c];
      if (d > 60) continue;
      for (let k = 0; k < 8; k++) {
        const nb = grid.neighbors[c * 8 + k];
        if (terrain.oceanFrac[nb] > 0.5 || this.waterDist[nb] !== 65535) continue;
        this.waterDist[nb] = d + 1;
        this.waterNext[nb] = c;
        queue[qt++] = nb;
      }
    }
  }

  spawn(rng: Rng, sp: number, x: number, y: number, z: number, genes: number[] | null, leader: number, age: number): number {
    let i: number;
    if (this.free.length) i = this.free.pop()!;
    else if (this.count < this.cap) i = this.count++;
    else return -1;
    const d = this.defs[sp];
    this.alive[i] = 1;
    this.species[i] = sp;
    this.sex[i] = rng.chance(0.5) ? 1 : 0;
    this.state[i] = AState.Wander;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.tx[i] = x; this.ty[i] = y; this.tz[i] = z;
    this.age[i] = age;
    this.hunger[i] = rng.range(0.1, 0.3);
    this.thirst[i] = rng.range(0.1, 0.3);
    this.health[i] = 1;
    const f = this.founders[sp];
    const g = genes ?? f;
    const m = 0.035;
    this.gSpeed[i] = clampG(g[0] + rng.gauss() * m, 0.6, 1.6);
    this.gSize[i] = clampG(g[1] + rng.gauss() * m, 0.6, 1.7);
    this.gFert[i] = clampG(g[2] + rng.gauss() * m, 0.5, 1.8);
    this.gCold[i] = clampG(g[3] + rng.gauss() * m, -1, 2);
    this.gHeat[i] = clampG(g[4] + rng.gauss() * m, -1, 2);
    this.leader[i] = leader;
    this.target[i] = -1;
    this.timer[i] = rng.int(0, 40);
    this.cooldown[i] = rng.range(0, d.gestation);
    this.pregnant[i] = 0;
    this.infected[i] = 0;
    this.infTimer[i] = 0;
    this.uid[i] = this.nextUid++;
    this.generation[i] = 0;
    this.pop[sp]++;
    this.everExisted[sp] = 1;
    return i;
  }

  /** Sacred grove cells (shared with the civilisation): no climate stress, easy breeding. */
  shelter: Uint8Array | null = null;
  /** Grove centres (x,y,z unit dirs): suffering beasts within reach seek them out. */
  refuges: number[] = [];

  /** Divine beacon: animals within reach travel toward it (the scattered find each other). */
  attractor: { x: number; y: number; z: number; cosR: number; until: number } | null = null;

  /** Kill animals within `radius` world units with probability chance·falloff (disasters). */
  killNear(x: number, y: number, z: number, radius: number, chance: number, rng: Rng, carrion = true): number {
    const R = radius / PLANET_RADIUS;
    const cosR = Math.cos(R);
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const dot = this.x[i] * x + this.y[i] * y + this.z[i] * z;
      if (dot < cosR) continue;
      const t = 1 - Math.acos(Math.min(1, dot)) / R;
      if (!rng.chance(chance * (0.3 + 0.7 * t))) continue;
      const sp = this.species[i];
      this.deaths[sp * 8 + 7]++;
      if (carrion) {
        const c = this.grid.cellOf(this.x[i], this.y[i], this.z[i]);
        this.carrion[c] += this.defs[sp].meat * this.gSize[i];
      }
      this.kill(i);
      n++;
    }
    return n;
  }

  /** Murrain: infect animals near a point. */
  infectNear(x: number, y: number, z: number, radius: number, frac: number, rng: Rng): number {
    const cosR = Math.cos(radius / PLANET_RADIUS);
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || this.infected[i] !== 0) continue;
      if (this.x[i] * x + this.y[i] * y + this.z[i] * z < cosR) continue;
      if (rng.chance(frac)) { this.infected[i] = 1; this.infTimer[i] = 480; n++; }
    }
    return n;
  }

  /** Fertile Bloom: well-fed, healthy herds ready to breed. */
  bless(x: number, y: number, z: number, radius: number): number {
    const cosR = Math.cos(radius / PLANET_RADIUS);
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      if (this.x[i] * x + this.y[i] * y + this.z[i] * z < cosR) continue;
      this.hunger[i] = 0; this.thirst[i] = Math.min(this.thirst[i], 0.2); this.health[i] = 1;
      this.cooldown[i] = 0;
      if (this.infected[i] === 1) { this.infected[i] = 2; this.infTimer[i] = 960; }
      n++;
    }
    return n;
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.pop[this.species[i]]--;
    this.free.push(i);
  }

  /** Populate the world with herds in suitable habitat. */
  populate(rng: Rng, climate: Climate, terrain: RegionTerrain, fraction = 0.55): void {
    const g = climate.grid;
    const order = [...this.defs.filter((d) => d.diet === 'herbivore'), ...this.defs.filter((d) => d.diet !== 'herbivore')];
    let fieldsReady = false;
    for (const d of order) {
      if (d.diet !== 'herbivore' && !fieldsReady) {
        this.hash.rebuild(this.count, this.alive, this.x, this.y, this.z);
        this.updatePreyFields(g);
        fieldsReady = true;
      }
      const field = d.diet !== 'herbivore' ? this.preyField[d.id] : null;
      const target = Math.round(d.softCap * fraction);
      let placed = 0, tries = 0;
      while (placed < target && tries < 8000) {
        tries++;
        const c = rng.int(0, g.count);
        if (terrain.oceanFrac[c] > 0.3) continue;
        const h = habitat(d, climate.biome[c], climate.temp[c], 0, 0);
        if (h < 0.5 || !rng.chance(h)) continue;
        if (field && field[c] < 0.4 && tries < 7000) continue;
        const size = rng.int(d.herdMin, d.herdMax + 1);
        let leader = -1;
        for (let k = 0; k < size && placed < target; k++) {
          offsetDir(g.centers[c * 3], g.centers[c * 3 + 1], g.centers[c * 3 + 2], rng.range(-8, 8) * INV_R, rng.range(-8, 8) * INV_R, this.scratch);
          const i = this.spawn(rng, d.id, this.scratch[0], this.scratch[1], this.scratch[2], null, leader, rng.range(d.adultAge, d.maxAge * 0.7));
          if (i < 0) break;
          if (leader < 0) leader = i;
          placed++;
        }
      }
    }
  }

  tick(tick: number, rng: Rng, climate: Climate, plants: Plants, terrain: RegionTerrain, events: EventLog, geo: Geography, fires: Fires): void {
    this.kills.length = 0;
    this.slopeRef = terrain.slope;
    const g = climate.grid;
    this.hash.rebuild(this.count, this.alive, this.x, this.y, this.z);
    if (tick % 160 === 0) this.updatePreyFields(g);
    if (tick % 8 === 0) for (let c = 0; c < this.carrion.length; c++) if (this.carrion[c] > 0) this.carrion[c] = this.carrion[c] < 0.01 ? 0 : this.carrion[c] * 0.93;
    const night = dayFrac(tick);
    const isNight = night < 0.22 || night > 0.78;
    const yearTick = TICKS_PER_YEAR;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const sp = this.species[i];
      const d = this.defs[sp];
      const c = this.hash.bucketOf[i];
      if (c < 0) continue;
      // ---------------- needs & health (every other tick, at double rate)
      if (((i + tick) & 1) === 0) {
      const K = 2;
      const temp = climate.temp[c];
      const lo = d.tMin - this.gCold[i] * 12, hi = d.tMax + this.gHeat[i] * 12;
      const sheltered = this.shelter !== null && this.shelter[c] === 1;
      const stress = sheltered ? 0 : temp < lo ? (lo - temp) / 15 : temp > hi ? (temp - hi) / 15 : 0;
      const st = this.state[i];
      const resting = st === AState.Rest || st === AState.Hibernate;
      let meta = d.metabolism * Math.pow(this.gSize[i], 0.75) * (1 + stress * 0.6) * (resting ? (st === AState.Hibernate ? 0.15 : 0.6) : 1) * (this.age[i] < d.adultAge ? 0.55 : 1);
      if (this.pregnant[i] > 0) meta *= 1.3;
      this.hunger[i] += meta * K;
      this.thirst[i] += (d.body === 'camel' ? 0.0005 : 0.0014) * (1 + Math.max(0, temp - 25) / 15) * (st === AState.Hibernate ? 0.1 : 1) * K;
      // Puddles after rain, snow and dew-soaked forage all quench thirst a little.
      if (climate.rain[c] > 0.04 || climate.snow[c] > 0.25) this.thirst[i] = Math.max(0, this.thirst[i] - 0.004 * K);
      let hp = this.health[i];
      if (this.hunger[i] > 1) { hp -= (d.diet === 'herbivore' ? 0.006 : 0.0025) * K; this.hunger[i] = 1; }
      if (this.thirst[i] > 1) { hp -= 0.01 * K; this.thirst[i] = 1; }
      hp -= stress * 0.004 * K;
      if (this.infected[i] === 1) {
        hp -= 0.0022 * K;
        this.infTimer[i] -= K;
        if (this.infTimer[i] <= 0) { this.infected[i] = 2; this.infTimer[i] = yearTick; }
      } else if (this.infected[i] === 2) {
        this.infTimer[i] -= K;
        if (this.infTimer[i] <= 0) this.infected[i] = 0;
      }
      if (fires.intensity[c] > 0.3) hp -= fires.intensity[c] * 0.02 * K;
      if (this.hunger[i] < 0.3 && this.thirst[i] < 0.4 && this.infected[i] !== 1) hp = Math.min(1, hp + 0.002 * K);
      this.health[i] = hp;
      this.age[i] += K / yearTick;
      if (hp <= 0 || (this.age[i] > d.maxAge * (0.75 + this.gSize[i] * 0.2) && rng.chance(0.003))) {
        const cause = hp > 0 ? 2 : this.hunger[i] >= 1 ? 0 : this.thirst[i] >= 1 ? 1 : this.infected[i] === 1 ? 4 : fires.intensity[c] > 0.3 ? 5 : stress > 0 ? 6 : 7;
        this.deaths[sp * 8 + cause]++;
        if (cause !== 5) this.carrion[c] += d.meat * this.gSize[i];
        this.kill(i);
        continue;
      }
      if (this.cooldown[i] > 0) this.cooldown[i] -= K;
      if (this.pregnant[i] > 0) {
        this.pregnant[i] -= K;
        if (this.pregnant[i] <= 0) this.giveBirth(i, rng);
      }
      }
      // ---------------- brain (staggered)
      if ((i + tick) % BRAIN_INTERVAL === 0) this.think(i, tick, rng, climate, plants, terrain, isNight, fires);
      // ---------------- act
      const stNow = this.state[i];
      if (stNow === AState.Graze && d.diet === 'carnivore') {
        // Small game (rodents, birds, fish) that isn't modelled as agents:
        // keeps predators alive through prey crashes but never fattens them.
        const h = habitat(d, climate.biome[c], climate.temp[c], this.gCold[i], this.gHeat[i]);
        if (this.hunger[i] > 0.5) this.hunger[i] -= 0.0024 * (0.35 + h);
      } else if (stNow === AState.Graze) {
        const food = plants.forage(c);
        if (food > 0.05) {
          const bite = 0.012 * Math.min(1, food);
          this.hunger[i] = Math.max(0, this.hunger[i] - bite * 1.6);
          if (food > 0.7) this.thirst[i] = Math.max(0, this.thirst[i] - 0.0015);
          plants.grazed[c] += bite * 0.07 * this.gSize[i];
        }
      } else if (stNow === AState.Drink) {
        this.thirst[i] = Math.max(0, this.thirst[i] - 0.05);
        if (this.thirst[i] <= 0.02) this.state[i] = AState.Wander;
      } else if (stNow === AState.Eat) {
        this.hunger[i] = Math.max(0, this.hunger[i] - 0.03);
        if (--this.timer[i] <= 0 || this.hunger[i] <= 0) this.state[i] = AState.Wander;
      }
      // ---------------- move
      if (stNow !== AState.Rest && stNow !== AState.Hibernate && stNow !== AState.Drink && stNow !== AState.Eat) {
        let spd = d.speed * this.gSpeed[i] / Math.sqrt(this.gSize[i]) * (this.age[i] < d.adultAge ? 0.8 : 1);
        if (stNow === AState.Flee) spd *= 2.1;
        else if (stNow === AState.Hunt) {
          // Stalk slowly, then a final sprint faster than the prey can run.
          const pr = this.target[i];
          const close = pr >= 0 && this.alive[pr] ? (this.x[pr] - this.x[i]) ** 2 + (this.y[pr] - this.y[i]) ** 2 + (this.z[pr] - this.z[i]) ** 2 : 1;
          spd *= close < (14 * INV_R) ** 2 ? 2.8 : 1.3;
        }
        else if (stNow === AState.Graze) spd *= 0.25;
        else if (stNow === AState.Wander) spd *= 0.55;
        if (this.health[i] < 0.4) spd *= 0.6;
        const ox = this.x[i], oy = this.y[i], oz = this.z[i];
        stepToward(this.x, this.y, this.z, this.tx, this.ty, this.tz, i, spd * INV_R);
        // Land animals stay on land.
        const nc = g.cellOf(this.x[i], this.y[i], this.z[i]);
        if (terrain.oceanFrac[nc] > 0.65 || terrain.lakeFrac[nc] > 0.7) {
          this.x[i] = ox; this.y[i] = oy; this.z[i] = oz;
          this.tx[i] = ox; this.ty[i] = oy; this.tz[i] = oz;
          if (stNow !== AState.Flee) this.state[i] = AState.Wander;
        }
      }
      // ---------------- predation contact
      if (stNow === AState.Hunt) this.tryKill(i, rng);
    }
    // Disease outbreaks in crowded places and spread.
    if (tick % 12 === 0) this.disease(tick, rng, events, geo);
    if (tick % HISTORY_INTERVAL === 0) this.recordHistory();
    if (tick % (TICKS_PER_YEAR * 2) === TICKS_PER_YEAR) this.speciation(tick, rng, climate, geo, events);
    if (tick % 40 === 0) this.checkExtinctions(tick, events);
  }

  private think(i: number, tick: number, rng: Rng, climate: Climate, plants: Plants, terrain: RegionTerrain, isNight: boolean, fires: Fires): void {
    const sp = this.species[i];
    const d = this.defs[sp];
    const c = this.hash.bucketOf[i];
    const g = climate.grid;
    const px = this.x[i], py = this.y[i], pz = this.z[i];
    const st = this.state[i];
    // Hibernation (bears in winter).
    if (d.hibernates && climate.temp[c] < -3 && this.hunger[i] < 0.7) { this.state[i] = AState.Hibernate; return; }
    if (st === AState.Hibernate && climate.temp[c] >= 0) this.state[i] = AState.Wander;
    if (st === AState.Hibernate) return;
    // Continue timed states.
    if (st === AState.Flee) {
      if (--this.timer[i] > 0) return;
      this.state[i] = AState.Wander;
    }
    // ----- threats (herbivores and small predators)
    const sight2 = (d.sight * INV_R) ** 2;
    let threat = -1, threatD = sight2;
    const tmask = this.threatMask[sp];
    const hs = this.hash;
    if (tmask !== 0) {
      for (let k = -1; k < 8; k++) {
        const cell = k < 0 ? c : g.neighbors[c * 8 + k];
        for (let q = hs.cellStart[cell], qe = hs.cellStart[cell + 1]; q < qe; q++) {
          const j = hs.items[q];
          if (!this.alive[j] || j === i) continue;
          if ((tmask & (1 << this.baseOf(this.species[j]))) === 0) continue;
          const sj = this.state[j];
          if (sj === AState.Hibernate || sj === AState.Rest) continue;
          const dx = this.x[j] - px, dy = this.y[j] - py, dz = this.z[j] - pz;
          // A stalking predator is only noticed at close range.
          const dd = (dx * dx + dy * dy + dz * dz) * (sj === AState.Hunt ? 3.5 : 1);
          if (dd < threatD) { threatD = dd; threat = j; }
        }
      }
    }
    // Fire nearby: run upwind/away from the flames.
    if (fires.intensity[c] > 0.15 || fires.intensity[g.neighbors[c * 8]] > 0.15 || fires.intensity[g.neighbors[c * 8 + 1]] > 0.15 || fires.intensity[g.neighbors[c * 8 + 2]] > 0.15 || fires.intensity[g.neighbors[c * 8 + 3]] > 0.15) {
      let best = c, bestV = fires.intensity[c];
      for (let k = 0; k < 8; k++) {
        const nb = g.neighbors[c * 8 + k];
        if (terrain.oceanFrac[nb] > 0.5) continue;
        const v = fires.intensity[nb];
        if (v < bestV) { bestV = v; best = nb; }
      }
      // Two cells further in the same direction.
      const dir = g.neighbors.indexOf(best, c * 8) - c * 8;
      let far = best;
      if (dir >= 0 && dir < 8) for (let s2 = 0; s2 < 2; s2++) far = g.neighbors[far * 8 + dir];
      this.setTargetCell(i, far, g, rng, 4);
      this.state[i] = AState.Flee;
      this.timer[i] = 4;
      return;
    }
    if (threat >= 0) {
      // Run directly away.
      let ax = px - this.x[threat], ay = py - this.y[threat], az = pz - this.z[threat];
      const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1e-6;
      const k = (28 * INV_R) / al;
      ax = px + ax * k; ay = py + ay * k; az = pz + az * k;
      const l = 1 / Math.sqrt(ax * ax + ay * ay + az * az);
      this.tx[i] = ax * l; this.ty[i] = ay * l; this.tz[i] = az * l;
      this.state[i] = AState.Flee;
      this.timer[i] = 5;
      return;
    }
    // A live chase is never interrupted by the daily rhythm.
    if (st === AState.Hunt && this.target[i] >= 0 && this.alive[this.target[i]]) return;
    // ----- rest cycle
    const restTime = d.nocturnal ? !isNight : isNight;
    if (restTime && this.hunger[i] < 0.55 && this.thirst[i] < 0.6 && rng.chance(0.7)) { this.state[i] = AState.Rest; return; }
    if (st === AState.Rest) this.state[i] = AState.Wander;
    // ----- thirst
    if (this.thirst[i] > 0.55) {
      const wd = this.waterDist[c];
      if (wd === 0) { this.state[i] = AState.Drink; return; }
      if (wd !== 65535) {
        let nx = this.waterNext[c];
        // Look a few steps ahead along the path.
        for (let k = 0; k < 3 && this.waterDist[nx] > 0; k++) nx = this.waterNext[nx];
        this.setTargetCell(i, nx, g, rng, 6);
        this.state[i] = AState.SeekWater;
        return;
      }
    }
    // ----- hunger
    if (this.hunger[i] > 0.3) {
      if (d.diet === 'herbivore' || (d.diet === 'omnivore' && plants.density[c * 8 + 1] > 0.3 && rng.chance(0.6))) {
        const here = plants.forage(c);
        if (here > 0.12) { this.state[i] = AState.Graze; this.wanderLocal(i, rng, 4); return; }
        // Move to the best neighbouring cell.
        let best = c, bestV = here;
        for (let k = 0; k < 8; k++) {
          const nb = g.neighbors[c * 8 + k];
          if (terrain.oceanFrac[nb] > 0.5) continue;
          const v = plants.forage(nb) * (0.3 + habitat(d, climate.biome[nb], climate.temp[nb], this.gCold[i], this.gHeat[i]));
          if (v > bestV) { bestV = v; best = nb; }
        }
        this.setTargetCell(i, best, g, rng, 8);
        this.state[i] = best === c ? AState.Graze : AState.Wander;
        return;
      }
      // Scavenge carrion first: easy meals.
      if (this.carrion[c] > 0.15) {
        const take = Math.min(this.carrion[c], 0.6);
        this.carrion[c] -= take;
        this.hunger[i] = Math.max(0, this.hunger[i] - take * 0.9);
        this.state[i] = AState.Eat;
        this.timer[i] = 12;
        return;
      }
      // Predators hunt.
      let prey = this.target[i];
      if (prey >= 0 && (!this.alive[prey] || !this.isPrey(d, this.species[prey]))) prey = -1;
      if (prey < 0) {
        let bestD = sight2 * 1.5;
        const pmask = this.preyMask[sp];
        for (let k = -1; k < 8; k++) {
          const cell = k < 0 ? c : g.neighbors[c * 8 + k];
          for (let q = hs.cellStart[cell], qe = hs.cellStart[cell + 1]; q < qe; q++) {
            const j = hs.items[q];
            if (!this.alive[j] || (pmask & (1 << this.baseOf(this.species[j]))) === 0) continue;
            const dx = this.x[j] - px, dy = this.y[j] - py, dz = this.z[j] - pz;
            // Prefer weak, young or old prey.
            const dd = (dx * dx + dy * dy + dz * dz) * (0.5 + this.health[j] * 0.5);
            if (dd < bestD) { bestD = dd; prey = j; }
          }
        }
      }
      if (prey >= 0) {
        this.target[i] = prey;
        this.tx[i] = this.x[prey]; this.ty[i] = this.y[prey]; this.tz[i] = this.z[prey];
        this.state[i] = AState.Hunt;
        return;
      }
      // No prey in sight. Very hungry predators settle for small game at
      // times; otherwise follow the scent gradient toward prey herds.
      if (this.hunger[i] > 0.6 && rng.chance(0.4)) {
        this.state[i] = AState.Graze;
        this.wanderLocal(i, rng, 6);
        return;
      }
      const near = this.preyField[this.baseOf(sp)];
      if (near && near.length) {
        // Close scent if any, otherwise the faint long-range trail.
        const field = near[c] > 0.02 ? near : this.preyFar[this.baseOf(sp)];
        let best = c, bestV = field[c] * 1.02;
        for (let k = 0; k < 8; k++) {
          const nb = g.neighbors[c * 8 + k];
          if (terrain.oceanFrac[nb] > 0.5) continue;
          if (field[nb] > bestV) { bestV = field[nb]; best = nb; }
        }
        if (best !== c) {
          this.setTargetCell(i, best, g, rng, 6);
          this.state[i] = AState.Wander;
          return;
        }
      }
    }
    // ----- reproduction
    const fedEnough = this.hunger[i] < (d.diet === 'herbivore' ? 0.5 : 0.7);
    if (this.sex[i] === 0 && this.pregnant[i] <= 0 && this.cooldown[i] <= 0 && this.age[i] > d.adultAge && fedEnough && this.health[i] > 0.5) {
      const ratio = this.pop[sp] / d.softCap;
      const popK = ratio < 1 ? 1 - ratio * ratio * 0.9 : Math.max(0, 0.1 * (2 - ratio));
      const hab = this.shelter !== null && this.shelter[c] === 1 ? 1 : habitat(d, climate.biome[c], climate.temp[c], this.gCold[i], this.gHeat[i]);
      if (rng.chance(0.25 * popK * this.gFert[i] * (0.3 + hab))) {
        let mate = -1;
        const Lm = this.leader[i];
        if (Lm >= 0 && this.alive[Lm] && this.species[Lm] === sp && this.sex[Lm] === 1) mate = Lm;
        if (mate < 0) this.hash.forNeighborhood(c, (j) => {
          if (this.alive[j] && this.species[j] === sp && this.sex[j] === 1 && this.age[j] > d.adultAge) { mate = j; return true; }
        });
        if (mate >= 0) {
          this.pregnant[i] = d.gestation;
          this.cooldown[i] = d.gestation * 1.4;
        } else if (d.diet !== 'herbivore') {
          // Solitary predators travel toward others of their kind to breed.
          const mf = this.mateField[this.baseOf(sp)];
          if (mf && mf.length) {
            let best = c, bestV = mf[c] * 1.02;
            for (let k = 0; k < 8; k++) {
              const nb = g.neighbors[c * 8 + k];
              if (terrain.oceanFrac[nb] > 0.5) continue;
              if (mf[nb] > bestV) { bestV = mf[nb]; best = nb; }
            }
            if (best !== c) {
              this.setTargetCell(i, best, g, rng, 6);
              this.state[i] = AState.Wander;
              return;
            }
          }
        }
      }
    }
    // ----- a divine beacon calls the herds
    const at = this.attractor;
    if (at && at.until > tick) {
      const dot = this.x[i] * at.x + this.y[i] * at.y + this.z[i] * at.z;
      if (dot > at.cosR && dot < 0.99998) {
        offsetDir(at.x, at.y, at.z, rng.range(-18, 18) * INV_R, rng.range(-18, 18) * INV_R, this.scratch);
        this.tx[i] = this.scratch[0]; this.ty[i] = this.scratch[1]; this.tz[i] = this.scratch[2];
        this.state[i] = AState.Migrate;
        return;
      }
    }
    // ----- beasts suffering frost or heat seek a sacred grove within reach
    const refuges = this.refuges;
    if (refuges && refuges.length && (tick + i) % 30 < BRAIN_INTERVAL && !(this.shelter && this.shelter[c])) {
      const here = habitat(d, climate.biome[c], climate.temp[c], this.gCold[i], this.gHeat[i]);
      if (here < 0.45) {
        const cosR = Math.cos(380 * INV_R);
        let bestDot = cosR, bi = -1;
        for (let k = 0; k < refuges.length; k += 3) {
          const dot = this.x[i] * refuges[k] + this.y[i] * refuges[k + 1] + this.z[i] * refuges[k + 2];
          if (dot > bestDot) { bestDot = dot; bi = k; }
        }
        if (bi >= 0) {
          offsetDir(refuges[bi], refuges[bi + 1], refuges[bi + 2], rng.range(-20, 20) * INV_R, rng.range(-20, 20) * INV_R, this.scratch);
          this.tx[i] = this.scratch[0]; this.ty[i] = this.scratch[1]; this.tz[i] = this.scratch[2];
          this.state[i] = AState.Migrate;
          return;
        }
      }
    }
    // ----- migration toward better habitat
    if (d.migratory && (tick + i) % 60 < BRAIN_INTERVAL) {
      const here = habitat(d, climate.biome[c], climate.temp[c], this.gCold[i], this.gHeat[i]);
      if (here < 0.45) {
        let best = c, bestV = here;
        // Probe cells ~4 steps away in 8 directions.
        for (let k = 0; k < 8; k++) {
          let nb = c;
          for (let s = 0; s < 4; s++) nb = g.neighbors[nb * 8 + k];
          if (terrain.oceanFrac[nb] > 0.5) continue;
          const v = habitat(d, climate.biome[nb], climate.temp[nb], this.gCold[i], this.gHeat[i]) + plants.forage(nb) * 0.2;
          if (v > bestV + 0.1) { bestV = v; best = nb; }
        }
        if (best !== c) {
          this.setTargetCell(i, best, g, rng, 10);
          this.state[i] = AState.Migrate;
          return;
        }
      }
    }
    if (st === AState.Migrate && this.distToTarget(i) > 5 * INV_R) return;
    // ----- herding / wandering
    const L = this.leader[i];
    if (L >= 0 && this.alive[L] && this.species[L] === sp && L !== i) {
      offsetDir(this.x[L], this.y[L], this.z[L], rng.range(-6, 6) * INV_R, rng.range(-6, 6) * INV_R, this.scratch);
      this.tx[i] = this.scratch[0]; this.ty[i] = this.scratch[1]; this.tz[i] = this.scratch[2];
    } else {
      if (L >= 0 && (!this.alive[L] || this.species[L] !== sp)) this.leader[i] = -1;
      if (this.distToTarget(i) < 1.5 * INV_R || rng.chance(0.15)) this.wanderLocal(i, rng, 14);
    }
    this.state[i] = AState.Wander;
  }

  private isPrey(d: SpeciesDef, other: number): boolean {
    return (this.preyMask[d.id] & (1 << this.baseOf(other))) !== 0;
  }

  private tryKill(i: number, rng: Rng): void {
    const prey = this.target[i];
    if (prey < 0 || !this.alive[prey]) { this.state[i] = AState.Wander; this.target[i] = -1; return; }
    this.tx[i] = this.x[prey]; this.ty[i] = this.y[prey]; this.tz[i] = this.z[prey];
    const dx = this.x[prey] - this.x[i], dy = this.y[prey] - this.y[i], dz = this.z[prey] - this.z[i];
    const dd = (dx * dx + dy * dy + dz * dz) * PLANET_RADIUS * PLANET_RADIUS;
    if (dd > 1.2) {
      // Give up long chases.
      if (dd > (this.defs[this.species[i]].sight * 1.8) ** 2) { this.state[i] = AState.Wander; this.target[i] = -1; }
      return;
    }
    const pd = this.defs[this.species[prey]];
    let odds = 0.35 * this.gSpeed[i] / Math.max(0.5, this.gSpeed[prey]) * (1.4 - this.health[prey] * 0.6) * (pd.size > 1.5 ? 0.5 : 1);
    // Mountain goats escape up cliffs.
    if (pd.body === 'goat') odds *= Math.max(0.1, 1 - this.slopeAt(prey) * 2.2);
    if (rng.chance(Math.min(0.9, odds))) {
      this.kills.push({ x: this.x[prey], y: this.y[prey], z: this.z[prey], species: this.species[prey] });
      this.deaths[this.species[prey] * 8 + 3]++;
      this.kill(prey);
      this.state[i] = AState.Eat;
      this.timer[i] = Math.round(20 + pd.meat * 30);
      // A meal satisfies relative to the hunter's own size.
      const meal = Math.min(0.95, pd.meat * 1.1 * (1.2 / Math.max(0.3, this.defs[this.species[i]].size * this.gSize[i])));
      this.hunger[i] = Math.max(0, this.hunger[i] - meal);
      // Share a big kill with pack mates and young nearby.
      if (pd.meat >= 0.6) {
        const sp = this.species[i];
        let share = pd.meat * 0.8;
        this.hash.forNeighborhood(this.hash.bucketOf[i], (j) => {
          if (share <= 0) return true;
          if (j === i || !this.alive[j] || this.species[j] !== sp || this.hunger[j] < 0.25) return;
          const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i], dz = this.z[j] - this.z[i];
          if ((dx * dx + dy * dy + dz * dz) * PLANET_RADIUS * PLANET_RADIUS > 400) return;
          const give = Math.min(share, 0.45);
          this.hunger[j] = Math.max(0, this.hunger[j] - give);
          share -= give;
        });
      }
      this.target[i] = -1;
    } else {
      // Prey escapes this lunge; predator tires.
      this.hunger[i] += 0.01;
    }
  }

  /** Terrain slope at an animal's cell (set each tick from the region terrain). */
  slopeRef: Float32Array | null = null;
  private slopeAt(i: number): number {
    const c = this.hash.bucketOf[i];
    return c >= 0 && this.slopeRef ? this.slopeRef[c] : 0;
  }

  private giveBirth(i: number, rng: Rng): void {
    const sp = this.species[i];
    const d = this.defs[sp];
    const genes = [this.gSpeed[i], this.gSize[i], this.gFert[i], this.gCold[i], this.gHeat[i]];
    const n = Math.max(1, Math.round(d.litter * (0.6 + rng.float() * 0.8)));
    const leader = this.leader[i] >= 0 && this.alive[this.leader[i]] ? this.leader[i] : i;
    for (let k = 0; k < n; k++) {
      offsetDir(this.x[i], this.y[i], this.z[i], rng.range(-1, 1) * INV_R, rng.range(-1, 1) * INV_R, this.scratch);
      const j = this.spawn(rng, sp, this.scratch[0], this.scratch[1], this.scratch[2], genes, leader, 0);
      if (j < 0) break;
      this.generation[j] = this.generation[i] + 1;
      this.health[j] = 0.8;
      // Herds split when they grow too large.
      if (d.herdMax > 1 && rng.chance(1 / d.herdMax)) this.leader[j] = -1;
    }
  }

  private disease(tick: number, rng: Rng, events: EventLog, geo: Geography): void {
    // Outbreaks where a species is crowded.
    if (rng.chance(0.08)) {
      const i = rng.int(0, Math.max(1, this.count));
      if (this.alive[i] && this.infected[i] === 0) {
        const c = this.hash.bucketOf[i];
        if (c >= 0 && this.hash.countIn(c) > 14) {
          this.infected[i] = 1;
          this.infTimer[i] = 260;
          const d = this.defs[this.species[i]];
          events.emit(tick, 'epidemic', { x: this.x[i], y: this.y[i], z: this.z[i] }, 0.35, { species: d.plural, where: geo.describe(c) });
        }
      }
    }
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || this.infected[i] !== 1) continue;
      const c = this.hash.bucketOf[i];
      if (c < 0) continue;
      const sp = this.species[i];
      this.hash.forNeighborhood(c, (j) => {
        if (!this.alive[j] || this.infected[j] !== 0) return;
        const same = this.species[j] === sp;
        if (!same && !rng.chance(0.1)) return;
        const dx = this.x[j] - this.x[i], dy = this.y[j] - this.y[i], dz = this.z[j] - this.z[i];
        if ((dx * dx + dy * dy + dz * dz) * PLANET_RADIUS * PLANET_RADIUS > 64) return;
        if (rng.chance(0.12 * (1.3 - this.health[j] * 0.5))) {
          this.infected[j] = 1;
          this.infTimer[j] = 200 + rng.int(0, 160);
        }
      });
    }
  }

  private recordHistory(): void {
    const o = this.historyHead * 64;
    for (let s = 0; s < 64; s++) this.history[o + s] = Math.min(65535, Math.max(0, this.pop[s]));
    this.historyHead = (this.historyHead + 1) % HISTORY_LEN;
    this.historyCount = Math.min(HISTORY_LEN, this.historyCount + 1);
  }

  private checkExtinctions(tick: number, events: EventLog): void {
    for (let s = 0; s < this.defs.length; s++) {
      if (this.everExisted[s] === 1 && this.pop[s] <= 0) {
        this.everExisted[s] = 2; // extinct
        const d = this.defs[s];
        this.records.push({ tick, kind: 'extinction', species: s, name: d.name });
        events.emit(tick, 'extinction', null, 0.75, { species: d.name, plural: d.plural });
      } else if (this.everExisted[s] === 2 && this.pop[s] > 0) {
        this.everExisted[s] = 1; // re-introduced (resurrection)
      }
    }
  }

  /**
   * Speciation: a species' population on a landmass that has drifted far from
   * its founders (and holds enough individuals) becomes a new species.
   */
  private speciation(tick: number, rng: Rng, climate: Climate, geo: Geography, events: EventLog): void {
    if (this.defs.length >= 60) return;
    const groups = new Map<string, number[]>();
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const c = this.hash.bucketOf[i];
      if (c < 0) continue;
      const cont = geo.continentOf(c);
      if (cont < 0) continue;
      const key = `${this.species[i]}:${cont}`;
      let arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(i);
    }
    // Keys sorted for determinism.
    const keys = [...groups.keys()].sort();
    for (const key of keys) {
      const members = groups.get(key)!;
      const [spS, contS] = key.split(':');
      const sp = Number(spS);
      if (members.length < 18) continue;
      // Only split when the species also lives elsewhere (isolation).
      if (members.length > this.pop[sp] * 0.85) continue;
      const mean = [0, 0, 0, 0, 0];
      for (const i of members) {
        mean[0] += this.gSpeed[i]; mean[1] += this.gSize[i]; mean[2] += this.gFert[i]; mean[3] += this.gCold[i]; mean[4] += this.gHeat[i];
      }
      for (let k = 0; k < 5; k++) mean[k] /= members.length;
      const f = this.founders[sp];
      const div = Math.hypot(mean[0] - f[0], mean[1] - f[1], (mean[2] - f[2]) * 0.5, mean[3] - f[3], mean[4] - f[4]);
      if (div < 0.32) continue;
      const parent = this.defs[sp];
      const id = this.defs.length;
      const c0 = this.hash.bucketOf[members[0]];
      const biome = BIOME_NAMES[climate.biome[c0]] ?? 'Wild';
      const trait = mean[3] - f[3] > 0.2 ? 'Frost' : mean[4] - f[4] > 0.2 ? 'Sun' : mean[1] - f[1] > 0.15 ? 'Great' : mean[1] - f[1] < -0.15 ? 'Dwarf' : mean[0] - f[0] > 0.15 ? 'Swift' : biome.split(' ')[0];
      const base = parent.parent >= 0 ? this.defs[parent.parent].name : parent.name;
      const def: SpeciesDef = {
        ...parent,
        id,
        name: `${trait} ${base}`,
        plural: `${trait.toLowerCase()} ${parent.plural.split(' ').pop()}`,
        parent: parent.parent >= 0 ? parent.parent : parent.id,
        size: parent.size * mean[1],
        speed: parent.speed * mean[0],
        tMin: parent.tMin - Math.max(0, mean[3]) * 8,
        tMax: parent.tMax + Math.max(0, mean[4]) * 8,
        softCap: Math.round(parent.softCap * 0.6),
        biomes: { ...parent.biomes },
        prey: [...parent.prey],
        colour: tint(parent.colour, rng.range(-0.25, 0.25)),
      };
      this.defs.push(def);
      this.founders.push(mean);
      for (const i of members) {
        this.pop[sp]--;
        this.species[i] = id;
        this.pop[id]++;
      }
      this.everExisted[id] = 1;
      this.rebuildMasks();
      const where = geo.continents[Number(contS)]?.name ?? '';
      this.records.push({ tick, kind: 'speciation', species: id, name: def.name, parent: parent.name, where });
      const i0 = members[0];
      events.emit(tick, 'speciation', { x: this.x[i0], y: this.y[i0], z: this.z[i0] }, 0.7, { species: def.name, parent: parent.name, where });
    }
  }

  private setTargetCell(i: number, cell: number, g: import('../planet/cubesphere').CellGrid, rng: Rng, jitter: number): void {
    offsetDir(g.centers[cell * 3], g.centers[cell * 3 + 1], g.centers[cell * 3 + 2], rng.range(-jitter, jitter) * INV_R, rng.range(-jitter, jitter) * INV_R, this.scratch);
    this.tx[i] = this.scratch[0]; this.ty[i] = this.scratch[1]; this.tz[i] = this.scratch[2];
  }

  private wanderLocal(i: number, rng: Rng, r: number): void {
    offsetDir(this.x[i], this.y[i], this.z[i], rng.range(-r, r) * INV_R, rng.range(-r, r) * INV_R, this.scratch);
    this.tx[i] = this.scratch[0]; this.ty[i] = this.scratch[1]; this.tz[i] = this.scratch[2];
  }

  private distToTarget(i: number): number {
    const dx = this.tx[i] - this.x[i], dy = this.ty[i] - this.y[i], dz = this.tz[i] - this.z[i];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  totalAlive(): number {
    let n = 0;
    for (let s = 0; s < this.defs.length; s++) n += this.pop[s];
    return n;
  }

  /** Shannon diversity index over living species. */
  shannon(): number {
    const total = this.totalAlive();
    if (total <= 0) return 0;
    let h = 0;
    for (let s = 0; s < this.defs.length; s++) {
      const p = this.pop[s] / total;
      if (p > 0) h -= p * Math.log(p);
    }
    return h;
  }

  livingSpecies(): number {
    let n = 0;
    for (let s = 0; s < this.defs.length; s++) if (this.pop[s] > 0) n++;
    return n;
  }
}

function clampG(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function tint(hex: number, k: number): number {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 255) * (1 + k)));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 255) * (1 + k * 0.6)));
  const b = Math.min(255, Math.max(0, (hex & 255) * (1 - k * 0.4)));
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

