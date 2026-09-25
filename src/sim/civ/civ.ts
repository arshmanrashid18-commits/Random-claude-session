/**
 * Civilisation core: tribes, settlements, buildings and people, with a real
 * logistics economy (people physically carry every unit of food, wood, stone
 * and metal), visible construction, farming, growth, colonisation and
 * research. Diplomacy, war, trade, religion and plague live in sibling modules
 * that operate on this state.
 */
import type { Rng } from '../../core/rng';
import { Language } from '../../core/language';
import { BType, BUILDINGS, Job, PState, Res, RES_COUNT, TIER_POP, type Age } from './defs';
import { People, Intent } from './people';
import { createTribe, type Tribe, type GodMemory } from './tribes';
import { Pathfinder } from './pathfind';
import { TECHS, TECH_INDEX, FIELD_COUNT, TechField, ageOf } from './tech';
import { stepToward, offsetDir } from '../move';
import { SpatialHash } from '../spatial';
import { PLANET_RADIUS, TICKS_PER_DAY, TICKS_PER_YEAR, LIFE_YEARS_PER_YEAR, dayFrac } from '../constants';
import type { Planet } from '../planet/planet';
import type { Plants } from '../ecology/plants';
import type { Animals } from '../ecology/animals';
import type { Fires } from '../ecology/fire';
import type { EventLog } from '../events';
import type { Geography } from '../planet/geography';
import { AGE_NAMES } from './defs';
import { Society } from './society';

const INV_R = 1 / PLANET_RADIUS;
const BRAIN = 8;
const WALK = 0.34 * INV_R;

export interface Ledger {
  created: number[];
  consumed: number[];
  used: number[];
  destroyed: number[];
}

export interface Building {
  id: number;
  type: BType;
  settle: number;
  tribe: number;
  x: number; y: number; z: number;
  rot: number;
  /** Labour progress 0..1 once materials are in. */
  progress: number;
  delivered: number[];
  complete: boolean;
  hp: number;
  age: Age;
  style: number;
  /** Farm crop growth 0..1+, or quarry/mine output waiting to be carried. */
  growth: number;
  stock: number;
  workers: number;
  ruin: boolean;
  built: number;
  /** Last tick anyone delivered to or worked on this site. */
  lastWork: number;
}

export interface Settlement {
  id: number;
  name: string;
  tribe: number;
  x: number; y: number; z: number;
  cell: number;
  founded: number;
  tier: number;
  pop: number;
  stock: number[];
  storage: number;
  housing: number;
  buildings: number[];
  alive: boolean;
  famine: number;
  happiness: number;
  faith: number;
  disease: number;
  coastal: boolean;
  water: boolean;
  fish: number;
  radius: number;
  /** Desired worker counts per job (from the allocator). */
  jobTarget: number[];
  /** Mean position of fields for gatherers etc. */
  lastPlan: number;
  colonyCooldown: number;
  walls: boolean;
  capturedFrom: number;
  /** Tick until which the settlement is blessed (work, health, births). */
  blessed: number;
  /** Where the current sickness came from: settlement id (-1 none) and carrier kind. */
  plagueFrom?: number;
  plagueVia?: 'traders' | 'pilgrims' | 'refugees' | 'crowding';
}

/** A remembered death: enough to bring the person back (Resurrection). */
export interface Grave {
  uid: number;
  tribe: number;
  settle: number;
  x: number; y: number; z: number;
  age: number;
  sex: number;
  tick: number;
  cause: string;
  skills: number[];
  traits: number[];
  love: number;
  fear: number;
  generation: number;
  mother: number;
  father: number;
  role: number;
}

const GRAVE_LIMIT = 900;

export interface RoadSeg {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  level: number;
  settle: number;
}

export class Civ {
  tribes: Tribe[] = [];
  settlements: Settlement[] = [];
  buildings: Building[] = [];
  roads: RoadSeg[] = [];
  people = new People();
  ledger: Ledger = { created: [0, 0, 0, 0], consumed: [0, 0, 0, 0], used: [0, 0, 0, 0], destroyed: [0, 0, 0, 0] };
  /** Recent divine acts as remembered (bounded; indices are absolute via godMemoryBase). */
  godMemories: GodMemory[] = [];
  godMemoryBase = 0;
  paths: Pathfinder;
  hash: SpatialHash;
  /** Region cell → owning settlement id (-1 none). */
  owner: Int32Array;
  /** Fish stock per region cell (0..1), regenerates. */
  fish: Float32Array;
  /** Incremented when buildings/roads change (renderer resync). */
  version = 0;
  /** Death causes (diagnostics and chronicle statistics). */
  deathCauses: Record<string, number> = {};
  /** Devotion (the god's mana) accumulated from worship. */
  devotion = 120;
  devotionRate = 0;
  /** Recent deaths (ring, newest last) for resurrection and mourning. */
  graves: Grave[] = [];
  /** Tick until which an eclipse terrifies the world into prayer. */
  omenUntil = 0;
  /** Divine beacon calling settlers (null when none). */
  beacon: { x: number; y: number; z: number; cell: number; until: number } | null = null;
  /** Region cells consecrated as sacred groves (hunting forbidden). */
  sanctuary: Uint8Array;
  private scratch = [0, 0, 0];
  /** Scratch direction for helpers (society). */
  scratchDir = [0, 0, 0];
  private lastTick = 0;
  /** RNG of the running world (set every tick; used by helpers without an rng parameter). */
  rngRef: Rng | null = null;
  /** The planet this civilisation lives on (set each tick; not saved state). */
  planetRef: Planet | null = null;
  readonly region: import('../planet/cubesphere').CellGrid;
  society = new Society();

  constructor(planet: Planet) {
    this.region = planet.region;
    this.paths = new Pathfinder(planet.region, planet.terrain);
    this.hash = new SpatialHash(planet.region, this.people.cap);
    this.owner = new Int32Array(planet.region.count).fill(-1);
    this.fish = new Float32Array(planet.region.count);
    this.sanctuary = new Uint8Array(planet.region.count);
    for (let c = 0; c < planet.region.count; c++) {
      const t = planet.terrain;
      this.fish[c] = t.oceanFrac[c] > 0.3 || t.lakeFrac[c] > 0.2 || t.river[c] > 2 ? 1 : 0;
    }
  }

  // ------------------------------------------------------------------ ledger
  produce(r: number, a: number): void { this.ledger.created[r] += a; }
  private consume(r: number, a: number): void { this.ledger.consumed[r] += a; }
  private destroy(r: number, a: number): void { this.ledger.destroyed[r] += a; }

  /** Total resources currently held anywhere (for conservation checks). */
  holdings(): number[] {
    const h = [0, 0, 0, 0];
    for (const s of this.settlements) for (let r = 0; r < RES_COUNT; r++) h[r] += s.stock[r];
    for (const b of this.buildings) {
      for (let r = 0; r < RES_COUNT; r++) h[r] += b.delivered[r];
      if (b.type === BType.Farm) h[Res.Food] += b.stock;
      else if (b.type === BType.Quarry) h[Res.Stone] += b.stock;
      else if (b.type === BType.Mine) h[Res.Metal] += b.stock;
    }
    const p = this.people;
    for (let i = 0; i < p.count; i++) if (p.alive[i] && p.carryRes[i] >= 0) h[p.carryRes[i]] += p.carryAmt[i];
    return h;
  }

  // ------------------------------------------------------------------ setup
  /** Place the first tribes at the most habitable, well-separated sites. */
  seedTribes(rng: Rng, tick: number, planet: Planet, animals: Animals, geo: Geography, events: EventLog, count = 5): void {
    const g = planet.region;
    const scores: { c: number; s: number }[] = [];
    for (let c = 0; c < g.count; c += 3) {
      const s = this.siteScore(c, planet, animals, -1);
      if (s > 0) scores.push({ c, s });
    }
    scores.sort((a, b) => b.s - a.s || a.c - b.c);
    const chosen: number[] = [];
    for (const { c } of scores) {
      if (chosen.length >= count) break;
      let ok = true;
      for (const o of chosen) {
        const d = Math.acos(Math.min(1, g.centers[c * 3] * g.centers[o * 3] + g.centers[c * 3 + 1] * g.centers[o * 3 + 1] + g.centers[c * 3 + 2] * g.centers[o * 3 + 2]));
        if (d * PLANET_RADIUS < 650) { ok = false; break; }
      }
      if (ok) chosen.push(c);
    }
    chosen.forEach((c, k) => {
      const t = createTribe(this.tribes.length, rng, tick, k, { temp: planet.climate.meanTemp[c], coastal: planet.terrain.coastal[c] === 1, rain: planet.climate.meanRain[c] });
      this.tribes.push(t);
      const s = this.foundSettlement(t.id, c, planet, tick, events, geo, true);
      // A band of families.
      const cx = g.centers[c * 3], cy = g.centers[c * 3 + 1], cz = g.centers[c * 3 + 2];
      const spawnNear = (age: number, parents: [number, number] | null) => {
        offsetDir(cx, cy, cz, rng.range(-6, 6) * INV_R, rng.range(-6, 6) * INV_R, this.scratch);
        return this.people.spawn(rng, tick, this.scratch[0], this.scratch[1], this.scratch[2], t.id, s.id, age, parents);
      };
      const adults: number[] = [];
      for (let a = 0; a < 10; a++) adults.push(spawnNear(rng.range(17, 38), null));
      // Pair them up.
      const P = this.people;
      for (let a = 0; a + 1 < adults.length; a += 2) {
        const m = adults[a], f = adults[a + 1];
        P.sex[m] = 1; P.sex[f] = 0;
        P.spouse[m] = P.uid[f]; P.spouse[f] = P.uid[m];
        for (let k = 0; k < (a % 4 === 0 ? 2 : 1); k++) spawnNear(rng.range(2, 12), [P.uid[f], P.uid[m]]);
      }
      spawnNear(rng.range(58, 66), null);
      const chief = adults[0];
      P.role[chief] = 1;
      s.stock[Res.Food] += 100;
      s.stock[Res.Wood] += 30;
      this.produce(Res.Food, 100);
      this.produce(Res.Wood, 30);
      events.emit(tick, 'tribe-founded', { x: cx, y: cy, z: cz }, 0.9, { tribe: t.name, settlement: s.name, where: geo.describe(c) });
    });
  }

  /** Habitability of a region cell for a new settlement (higher is better, ≤0 = unusable). */
  siteScore(c: number, planet: Planet, animals: Animals, tribe: number): number {
    const t = planet.terrain, cl = planet.climate;
    if (t.oceanFrac[c] > 0.35 || t.lakeFrac[c] > 0.3 || t.elev[c] < 1 || t.elev[c] > 30 || t.slope[c] > 0.45) return -1;
    const temp = cl.meanTemp[c], rain = cl.meanRain[c];
    let s = 1;
    s *= Math.exp(-(((temp - 17) / 11) ** 2));
    s *= Math.min(1, rain / 0.9) * (rain > 3.5 ? 0.7 : 1);
    const wd = animals.waterDist[c];
    s *= wd === 0 ? 1.3 : wd < 3 ? 1 : wd < 6 ? 0.6 : 0.2;
    if (t.coastal[c]) s *= 1.25;
    s *= 1 - Math.min(0.6, t.slope[c]);
    if (this.owner[c] >= 0) return -1;
    // Keep away from other settlements.
    for (const st of this.settlements) {
      if (!st.alive) continue;
      const d = Math.acos(Math.min(1, st.x * planet.region.centers[c * 3] + st.y * planet.region.centers[c * 3 + 1] + st.z * planet.region.centers[c * 3 + 2])) * PLANET_RADIUS;
      const min = st.tribe === tribe ? 110 : 220;
      if (d < min) return -1;
    }
    return s;
  }

  foundSettlement(tribe: number, cell: number, planet: Planet, tick: number, events: EventLog, geo: Geography, first = false): Settlement {
    const g = planet.region;
    const t = this.tribes[tribe];
    const lang = Language.fromSpec(t.lang);
    const id = this.settlements.length;
    const s: Settlement = {
      id,
      name: lang.nameFor(id * 31 + tribe * 7 + 3, 'place'),
      tribe,
      x: g.centers[cell * 3], y: g.centers[cell * 3 + 1], z: g.centers[cell * 3 + 2],
      cell,
      founded: tick,
      tier: 0,
      pop: 0,
      stock: [0, 0, 0, 0],
      storage: 80,
      housing: 0,
      buildings: [],
      alive: true,
      famine: 0,
      happiness: 0.6,
      faith: 0.2,
      disease: 0,
      coastal: planet.terrain.coastal[cell] === 1 || planet.terrain.oceanFrac[g.neighbors[cell * 8]] > 0.5,
      water: false,
      fish: 0,
      radius: 26,
      jobTarget: new Array(15).fill(0),
      lastPlan: tick - 1000,
      colonyCooldown: TICKS_PER_YEAR * 3,
      walls: false,
      capturedFrom: -1,
      blessed: 0,
    };
    this.settlements.push(s);
    t.settlements.push(id);
    if (t.capital < 0) t.capital = id;
    this.claim(s, planet);
    if (!first) events.emit(tick, 'settlement-founded', s, 0.45, { tribe: t.name, settlement: s.name, where: geo.describe(cell) });
    this.version++;
    return s;
  }

  claim(s: Settlement, planet: Planet): void {
    const g = planet.region;
    const r = (s.radius + 12) * INV_R;
    const rc = Math.ceil((s.radius + 12) / (PLANET_RADIUS * g.spacing)) + 1;
    // BFS over the neighbourhood.
    const seen = new Set<number>([s.cell]);
    const q = [s.cell];
    while (q.length) {
      const c = q.pop()!;
      const d = Math.acos(Math.min(1, s.x * g.centers[c * 3] + s.y * g.centers[c * 3 + 1] + s.z * g.centers[c * 3 + 2]));
      if (d > r) continue;
      if (this.owner[c] < 0 || this.owner[c] === s.id) this.owner[c] = s.id;
      for (let k = 0; k < 4; k++) {
        const nb = g.neighbors[c * 8 + k];
        if (!seen.has(nb) && seen.size < rc * rc * 8) { seen.add(nb); q.push(nb); }
      }
    }
  }

  // ------------------------------------------------------------------ buildings
  private addBuilding(type: BType, s: Settlement, x: number, y: number, z: number, rot: number, tick: number): Building {
    const b: Building = {
      id: this.buildings.length,
      type,
      settle: s.id,
      tribe: s.tribe,
      x, y, z, rot,
      progress: 0,
      delivered: [0, 0, 0, 0],
      complete: false,
      hp: 1,
      age: this.tribes[s.tribe].age,
      style: this.tribes[s.tribe].style,
      growth: 0,
      stock: 0,
      workers: 0,
      ruin: false,
      built: tick,
      lastWork: tick,
    };
    this.buildings.push(b);
    s.buildings.push(b.id);
    this.version++;
    // Road from the settlement centre.
    if (type !== BType.Wall) {
      const len = Math.acos(Math.min(1, x * s.x + y * s.y + z * s.z)) * PLANET_RADIUS;
      if (len > 3) this.roads.push({ ax: s.x, ay: s.y, az: s.z, bx: x, by: y, bz: z, level: Math.min(3, this.tribes[s.tribe].age >> 1), settle: s.id });
    }
    return b;
  }

  /** Materials still missing for a building under construction. */
  private missing(b: Building, r: number): number {
    return Math.max(0, BUILDINGS[b.type].cost[r] - b.delivered[r]);
  }

  private hasMaterials(b: Building): boolean {
    for (let r = 1; r < RES_COUNT; r++) if (this.missing(b, r) > 0.001) return false;
    return true;
  }

  private completeBuilding(b: Building, s: Settlement, tick: number, events: EventLog): void {
    b.complete = true;
    b.progress = 1;
    for (let r = 0; r < RES_COUNT; r++) { this.ledger.used[r] += b.delivered[r]; b.delivered[r] = 0; }
    b.age = this.tribes[s.tribe].age;
    this.recountSettlement(s);
    this.version++;
    const def = BUILDINGS[b.type];
    if (b.type === BType.Temple || b.type === BType.Monument || b.type === BType.Library || b.type === BType.Hall || b.type === BType.Observatory || b.type === BType.Harbor) {
      events.emit(tick, b.type === BType.Monument ? 'monument' : 'building', b, b.type === BType.Monument ? 0.75 : 0.35, { building: def.name, settlement: s.name, tribe: this.tribes[s.tribe].name });
    }
  }

  recountSettlement(s: Settlement): void {
    let housing = 0, storage = 80;
    for (const id of s.buildings) {
      const b = this.buildings[id];
      if (!b.complete || b.ruin) continue;
      housing += BUILDINGS[b.type].housing;
      storage += BUILDINGS[b.type].storage;
      if (b.type === BType.Well) s.water = true;
    }
    s.housing = housing;
    s.storage = storage;
  }

  /** Find a building site near the settlement for a given type. */
  private findSite(type: BType, s: Settlement, planet: Planet, rng: Rng): number[] | null {
    const def = BUILDINGS[type];
    const t = planet.terrain;
    const g = planet.region;
    let best: number[] | null = null;
    let bestScore = -Infinity;
    const maxR = s.radius * (def.site === 'fields' ? 1.25 : def.site === 'ore' || def.site === 'rock' ? 1.6 : 1.0);
    const start = def.site === 'center' ? 3 : def.site === 'edge' ? s.radius * 0.7 : 5;
    const phase = rng.range(0, Math.PI * 2);
    for (let r = start; r <= maxR; r += 3.2) {
      const nAng = Math.max(6, Math.floor((2 * Math.PI * r) / 5));
      for (let k = 0; k < nAng; k++) {
        const a = phase + (k / nAng) * Math.PI * 2;
        offsetDir(s.x, s.y, s.z, Math.cos(a) * r * INV_R, Math.sin(a) * r * INV_R, this.scratch);
        const x = this.scratch[0], y = this.scratch[1], z = this.scratch[2];
        const c = g.cellOf(x, y, z);
        if (t.oceanFrac[c] > 0.7) continue;
        const h = planet.heightAt(x, y, z);
        if (h < 0.6 && def.site !== 'shore') continue;
        // Local flatness from 4 samples.
        const e = def.radius * INV_R;
        let hmin = h, hmax = h;
        for (let q = 0; q < 4; q++) {
          offsetDir(x, y, z, (q === 0 ? e : q === 1 ? -e : 0), (q === 2 ? e : q === 3 ? -e : 0), this.scratch);
          const hh = planet.heightAt(this.scratch[0], this.scratch[1], this.scratch[2]);
          hmin = Math.min(hmin, hh); hmax = Math.max(hmax, hh);
        }
        const rough = hmax - hmin;
        if (hmin < 0.3 && def.site !== 'shore') continue;
        if (rough > (def.site === 'rock' || def.site === 'ore' ? 6 : 2.2)) continue;
        // No overlap.
        let clear = true;
        for (const other of this.buildings) {
          if (other.ruin) continue;
          const dx = other.x - x, dy = other.y - y, dz = other.z - z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * PLANET_RADIUS;
          if (d < BUILDINGS[other.type].radius + def.radius + 1.2) { clear = false; break; }
        }
        if (!clear) continue;
        let score = -r * 0.05 - rough * 0.5;
        switch (def.site) {
          case 'fields': score += planet.climate.soil[c] * 3 + Math.min(2, t.river[c] * 0.3) - t.slope[c] * 4 - Math.abs(r - s.radius * 0.8) * 0.02; break;
          case 'rock': score += t.slope[c] * 6 + (h > 12 ? 2 : 0); break;
          case 'ore': score += planet.ore[c] * 8 + t.slope[c]; break;
          case 'shore': score += (h > -0.5 && h < 1.2 ? 5 : -20) - Math.abs(h - 0.3) * 3; break;
          case 'hill': score += h * 0.15 - r * 0.05; break;
          case 'edge': score += -Math.abs(r - s.radius * 0.85) * 0.2; break;
          case 'center': score += -r * 0.2; break;
          default: score += -r * 0.08;
        }
        if (score > bestScore) { bestScore = score; best = [x, y, z, a]; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ main tick
  tick(tick: number, rng: Rng, planet: Planet, plants: Plants, animals: Animals, fires: Fires, events: EventLog, geo: Geography): void {
    const P = this.people;
    this.lastTick = tick;
    this.rngRef = rng;
    this.planetRef = planet;
    this.hash.rebuild(P.count, P.alive, P.x, P.y, P.z);
    const night = dayFrac(tick);
    const isNight = night < 0.23 || night > 0.8;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i]) continue;
      this.updatePerson(i, tick, rng, planet, plants, animals, fires, events, geo, isNight);
    }
    // Settlements (staggered).
    for (let k = 0; k < this.settlements.length; k++) {
      const s = this.settlements[k];
      if (!s.alive) continue;
      if ((tick + k * 7) % 40 === 0) this.settlementBrain(s, tick, rng, planet, plants, animals, events, geo, fires);
      if (s.stock[Res.Food] > 0) {
        // Spoilage.
        const spoil = s.stock[Res.Food] * (s.stock[Res.Food] > s.storage ? 0.0002 : 0.00004);
        s.stock[Res.Food] -= spoil;
        this.destroy(Res.Food, spoil);
      }
    }
    // Farms grow.
    if (tick % 8 === 0) this.growFarms(planet);
    // Fish regenerate.
    if (tick % 32 === 0) for (let c = 0; c < this.fish.length; c++) if (this.fish[c] > 0 && this.fish[c] < 1) this.fish[c] = Math.min(1, this.fish[c] + 0.004);
    // Research once a day; head counts twice a day.
    if (tick % TICKS_PER_DAY === 17) this.research(tick, events);
    if (tick % 80 === 3) this.census();
    // Devotion from worship.
    if (tick % 16 === 5) this.worship();
    // Diplomacy, war, trade and religion.
    this.society.tick(this, tick, rng, planet, events, geo);
  }

  private growFarms(planet: Planet): void {
    const cl = planet.climate;
    for (const b of this.buildings) {
      if (b.type !== BType.Farm || !b.complete || b.ruin) continue;
      const c = planet.region.cellOf(b.x, b.y, b.z);
      const temp = cl.temp[c];
      if (temp < 4 || cl.snow[c] > 0.3) continue;
      const t = this.tribes[b.tribe];
      const fert = Math.min(1.6, 0.35 + cl.soil[c] * 0.8 + Math.min(0.5, planet.terrain.river[c] * 0.08) + (t.known[TECH_INDEX.get('irrigation')!] ? 0.25 : 0));
      const warm = Math.exp(-(((temp - 20) / 14) ** 2));
      const blessed = this.settlements[b.settle]?.blessed > this.lastTick ? 1.4 : 1;
      // Crops wither when the rains fail (drought pushes the rain bias negative).
      const parched = 1 - 0.8 * Math.min(1, Math.max(0, -cl.rainBias[c]));
      b.growth += 0.017 * fert * warm * (0.4 + Math.min(3, b.workers) * 0.25) * blessed * parched;
    }
  }

  private worship(): void {
    const P = this.people;
    let gain = 0;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.age[i] < 10) continue;
      const faith = P.love[i] + P.fear[i] * 0.7;
      gain += faith * (P.state[i] === PState.Pray ? 3 : 1);
    }
    // ~1 devotion per faithful person per day at full faith.
    gain *= 0.1;
    this.devotionRate = gain * (TICKS_PER_DAY / 16);
    this.devotion = Math.min(9999, this.devotion + gain);
  }

  // ------------------------------------------------------------------ people
  private updatePerson(i: number, tick: number, rng: Rng, planet: Planet, plants: Plants, animals: Animals, fires: Fires, events: EventLog, geo: Geography, isNight: boolean): void {
    const P = this.people;
    // Needs.
    const st = P.state[i];
    P.hunger[i] += (st === PState.Sleep ? 0.0025 : 0.0045) * (P.age[i] < 12 ? 0.6 : 1);
    P.energy[i] += st === PState.Sleep ? 0.006 : -0.0012;
    if (P.energy[i] < 0) P.energy[i] = 0; else if (P.energy[i] > 1) P.energy[i] = 1;
    P.age[i] += LIFE_YEARS_PER_YEAR / TICKS_PER_YEAR;
    let hp = P.health[i];
    if (P.hunger[i] >= 1) { P.hunger[i] = 1; hp -= 0.0022; }
    const c = this.hash.bucketOf[i];
    // Armies on the march live off the land.
    if (P.army[i] >= 0 && st === PState.March && P.hunger[i] > 0.6 && c >= 0 && (i + tick) % 8 === 0) {
      const f = plants.forage(c);
      if (f > 0.04) {
        const meal = Math.min(0.5, f + 0.1) * 0.6;
        this.produce(Res.Food, meal);
        this.consume(Res.Food, meal);
        P.hunger[i] = Math.max(0, P.hunger[i] - meal);
      }
    }
    if (c >= 0 && fires.intensity[c] > 0.35) hp -= fires.intensity[c] * 0.007;
    if (P.sick[i] > 0) hp = this.diseaseStep(i, tick, rng, hp);
    if (P.hunger[i] < 0.5 && hp < 1) hp = Math.min(1, hp + 0.0015);
    P.health[i] = hp;
    // Death: health, or old age.
    const age = P.age[i];
    const oldAge = (age > 48 ? 0.00012 * Math.exp((age - 48) / 9) : age < 3 ? 0.000012 : 0.000004) * LIFE_YEARS_PER_YEAR;
    if (hp <= 0 || rng.chance(oldAge)) {
      this.personDies(i, tick, hp <= 0 ? (P.hunger[i] >= 1 ? 'starvation' : c >= 0 && fires.intensity[c] > 0.35 ? 'fire' : P.sick[i] > 0 ? 'plague' : 'hardship') : 'old age', events);
      return;
    }
    // Pregnancy.
    if (P.pregnant[i] > 0 && --P.pregnant[i] <= 0) this.birth(i, tick, rng, events);
    // Children grow up.
    if (P.job[i] === Job.Child && age >= 14) P.job[i] = Job.None;
    if (age >= 62 && P.job[i] !== Job.Elder) { P.job[i] = Job.Elder; P.role[i] === 1 && this.succession(i, tick, events); }
    // Brain.
    if ((i + tick) % BRAIN === 0 || (P.state[i] === PState.Idle && P.timer[i] <= 0)) this.think(i, tick, rng, planet, plants, animals, fires, isNight);
    // Timed work.
    if (P.timer[i] > 0) P.timer[i]--;
    const s2 = P.state[i];
    if (s2 === PState.Work || s2 === PState.Build || s2 === PState.Pray || s2 === PState.Eat || s2 === PState.Socialize) {
      if (P.timer[i] <= 0) this.finishWork(i, tick, rng, planet, plants, animals, events, geo);
      return;
    }
    if (s2 === PState.Sleep) {
      if (!isNight && P.energy[i] > 0.85) P.state[i] = PState.Idle;
      return;
    }
    // Movement.
    if (s2 === PState.Walk || s2 === PState.Carry || s2 === PState.Travel || s2 === PState.Flee || s2 === PState.March) {
      const speed = WALK * (s2 === PState.Flee ? 1.8 : s2 === PState.Carry ? 0.85 : s2 === PState.March ? 1.5 : 1) * (age < 12 ? 0.8 : age > 60 ? 0.75 : 1) * (P.vessel[i] ? 2.6 : 1);
      const ox = P.x[i], oy = P.y[i], oz = P.z[i];
      const rem = stepToward(P.x, P.y, P.z, P.tx, P.ty, P.tz, i, speed);
      if ((i + tick) % 2 === 0 && P.vessel[i] === 0 && planet.heightAt(P.x[i], P.y[i], P.z[i]) < 0.12 && planet.heightAt(P.x[i], P.y[i], P.z[i]) < planet.heightAt(ox, oy, oz)) {
        // Reached the water's edge: stop here.
        P.x[i] = ox; P.y[i] = oy; P.z[i] = oz;
        if (s2 === PState.Travel && P.intent[i] === Intent.Settle && this.nextWaypoint(i, planet, rng)) return;
        this.arrive(i, tick, rng, planet, plants, animals, events, geo);
        return;
      }
      if (rem <= 0) this.arrive(i, tick, rng, planet, plants, animals, events, geo);
    }
  }

  private think(i: number, tick: number, rng: Rng, planet: Planet, plants: Plants, animals: Animals, fires: Fires, isNight: boolean): void {
    const P = this.people;
    const si = P.settle[i];
    const s = si >= 0 ? this.settlements[si] : null;
    const st = P.state[i];
    // Very hungry and carrying food: eat some of it on the spot.
    if (P.hunger[i] > 0.8 && P.carryRes[i] === Res.Food && P.carryAmt[i] > 0) {
      const eat = Math.min(1, P.carryAmt[i]);
      P.carryAmt[i] -= eat;
      if (P.carryAmt[i] <= 0.0001) { P.carryAmt[i] = 0; P.carryRes[i] = -1; }
      this.consume(Res.Food, eat);
      P.hunger[i] = Math.max(0, P.hunger[i] - 0.95 * eat);
    }
    // An eclipse: everyone who can falls to their knees.
    if (tick < this.omenUntil && st !== PState.Pray && st !== PState.Travel && P.age[i] >= 4) {
      P.state[i] = PState.Pray;
      P.intent[i] = Intent.Pray;
      P.timer[i] = Math.max(8, this.omenUntil - tick);
      return;
    }
    // The sick rest.
    if (P.sick[i] > 0.4 && st !== PState.Sleep && st !== PState.Travel && rng.chance(0.5)) {
      P.state[i] = PState.Sleep;
      P.timer[i] = 30;
      return;
    }
    // Fire: flee away from the flames, toward the calmest neighbouring ground.
    const c = this.hash.bucketOf[i];
    if (c >= 0 && (fires.intensity[c] > 0.12 || fires.intensity[planet.region.neighbors[c * 8]] > 0.3 || fires.intensity[planet.region.neighbors[c * 8 + 1]] > 0.3 || fires.intensity[planet.region.neighbors[c * 8 + 2]] > 0.3 || fires.intensity[planet.region.neighbors[c * 8 + 3]] > 0.3)) {
      const g = planet.region;
      // Safe ground: unburnt-and-calm or already burnt out (no fuel left).
      let best = c, bestV = fires.intensity[c] + 1;
      for (let k = 0; k < 8; k++) {
        const nb = g.neighbors[c * 8 + k];
        if (planet.terrain.oceanFrac[nb] > 0.5) continue;
        let v = fires.intensity[nb] * 1.5 + (fires.scar[nb] > 0.3 && fires.intensity[nb] < 0.05 ? -0.5 : 0);
        for (let q = 0; q < 4; q++) v += fires.intensity[g.neighbors[nb * 8 + q]] * 0.3;
        if (v < bestV) { bestV = v; best = nb; }
      }
      this.goTo(i, g.centers[best * 3], g.centers[best * 3 + 1], g.centers[best * 3 + 2], 6, PState.Flee, Intent.Wander, -1, rng);
      return;
    }
    // Busy with timed activity or long journeys: don't interrupt.
    if ((st === PState.Work || st === PState.Build || st === PState.Eat || st === PState.Pray) && P.timer[i] > 0) return;
    if (st === PState.Travel || P.intent[i] === Intent.Settle) return;
    // Soldiers on campaign follow their army's orders (and rejoin it after a scare).
    if (P.army[i] >= 0) {
      if (P.intent[i] === Intent.March || st === PState.Fight || st === PState.March) return;
      if (st !== PState.Flee && this.society.resumeMarch(this, i, planet, rng)) return;
    }
    if (!s) { this.wander(i, rng, 8); return; }
    // Starving: eat before anything else.
    if (P.hunger[i] > 0.8 && s.stock[Res.Food] >= 1 && P.intent[i] !== Intent.Eat) {
      this.goTo(i, s.x, s.y, s.z, 5, PState.Walk, Intent.Eat, s.id, rng);
      return;
    }
    // Carrying: deliver first (unless already on the way to a meal).
    if (P.carryRes[i] >= 0 && P.carryAmt[i] > 0 && P.intent[i] !== Intent.Deliver && P.intent[i] !== Intent.Build && P.intent[i] !== Intent.Eat) {
      this.goDeliver(i, s, rng);
      return;
    }
    if (st === PState.Walk || st === PState.Carry) return; // en route
    // Hunger.
    if (P.hunger[i] > 0.55 && s.stock[Res.Food] >= 1) {
      this.goTo(i, s.x, s.y, s.z, 5, PState.Walk, Intent.Eat, s.id, rng);
      return;
    }
    // Sleep at night.
    if (isNight && P.energy[i] < 0.75) {
      const h = P.home[i];
      if (h >= 0 && this.buildings[h] && !this.buildings[h].ruin) this.goTo(i, this.buildings[h].x, this.buildings[h].y, this.buildings[h].z, 1.2, PState.Walk, Intent.Sleep, h, rng);
      else this.goTo(i, s.x, s.y, s.z, 6, PState.Walk, Intent.Sleep, -1, rng);
      return;
    }
    const job = P.job[i];
    if (job === Job.Child) {
      // Play near home or follow mother.
      const m = P.slot(P.mother[i]);
      if (m >= 0 && rng.chance(0.6)) this.goTo(i, P.x[m], P.y[m], P.z[m], 3, PState.Walk, Intent.Wander, -1, rng);
      else this.goTo(i, s.x, s.y, s.z, 8, PState.Walk, Intent.Wander, -1, rng);
      return;
    }
    if (job === Job.Elder || isNight) {
      // Evenings: gather at the fire, tell stories, marry, pray.
      if (rng.chance(P.pious[i] * 0.3)) { this.goPray(i, s, rng); return; }
      this.goTo(i, s.x, s.y, s.z, 5, PState.Walk, Intent.Social, -1, rng);
      return;
    }
    // Hungry and no stored food: forage personally.
    if (P.hunger[i] > 0.6 && s.stock[Res.Food] < 1) { this.goGather(i, s, planet, plants, rng); return; }
    if (rng.chance(0.03 * P.pious[i])) { this.goPray(i, s, rng); return; }
    this.doJob(i, job, s, tick, rng, planet, plants, animals);
  }

  private doJob(i: number, job: number, s: Settlement, tick: number, rng: Rng, planet: Planet, plants: Plants, animals: Animals): void {
    const P = this.people;
    switch (job) {
      case Job.Gatherer: this.goGather(i, s, planet, plants, rng); return;
      case Job.Hunter: {
        // Nearest wild herbivore within reach.
        let best = -1, bestD = (70 * INV_R) ** 2;
        const g = planet.region;
        const c0 = g.cellOf(s.x, s.y, s.z);
        const scan = (cell: number) => {
          const hs = animals.hash;
          for (let q = hs.cellStart[cell], qe = hs.cellStart[cell + 1]; q < qe; q++) {
            const a = hs.items[q];
            if (!animals.alive[a] || animals.defs[animals.species[a]].diet !== 'herbivore') continue;
            if (this.sanctuary[cell]) continue;
            const dx = animals.x[a] - P.x[i], dy = animals.y[a] - P.y[i], dz = animals.z[a] - P.z[i];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bestD) { bestD = d; best = a; }
          }
        };
        scan(c0);
        for (let k = 0; k < 8; k++) scan(g.neighbors[c0 * 8 + k]);
        if (best >= 0) {
          this.goTo(i, animals.x[best], animals.y[best], animals.z[best], 0, PState.Walk, Intent.Hunt, best, rng);
          return;
        }
        this.goGather(i, s, planet, plants, rng);
        return;
      }
      case Job.Fisher: {
        const cell = this.findFishing(s, planet);
        if (cell >= 0) {
          const g = planet.region;
          this.goTo(i, g.centers[cell * 3], g.centers[cell * 3 + 1], g.centers[cell * 3 + 2], 6, PState.Walk, Intent.Fish, cell, rng, true);
          return;
        }
        this.goGather(i, s, planet, plants, rng);
        return;
      }
      case Job.Farmer:
      case Job.Quarrier:
      case Job.Miner:
      case Job.Scholar:
      case Job.Priest: {
        const want = job === Job.Farmer ? BType.Farm : job === Job.Quarrier ? BType.Quarry : job === Job.Miner ? BType.Mine : job === Job.Scholar ? BType.Library : BType.Temple;
        const b = this.pickWorkplace(s, want, job);
        if (!b && job === Job.Quarrier) {
          // No quarry yet: pick loose stone from the steepest nearby ground.
          const cell = this.findRocks(s, planet);
          const g = planet.region;
          this.goTo(i, g.centers[cell * 3], g.centers[cell * 3 + 1], g.centers[cell * 3 + 2], 8, PState.Walk, Intent.Quarry, -2 - cell, rng);
          return;
        }
        if (b) {
          this.goTo(i, b.x, b.y, b.z, BUILDINGS[b.type].radius * 0.7, PState.Walk, job === Job.Farmer ? Intent.Farm : job === Job.Quarrier ? Intent.Quarry : job === Job.Miner ? Intent.Mine : job === Job.Scholar ? Intent.Study : Intent.Pray, b.id, rng);
          return;
        }
        if (job === Job.Scholar || job === Job.Priest) { this.goTo(i, s.x, s.y, s.z, 5, PState.Walk, job === Job.Priest ? Intent.Pray : Intent.Study, -1, rng); return; }
        this.goGather(i, s, planet, plants, rng);
        return;
      }
      case Job.Woodcutter: {
        const cell = this.findForest(s, planet, plants);
        if (cell >= 0) {
          const g = planet.region;
          this.goTo(i, g.centers[cell * 3], g.centers[cell * 3 + 1], g.centers[cell * 3 + 2], 9, PState.Walk, Intent.Chop, cell, rng);
          return;
        }
        this.goGather(i, s, planet, plants, rng);
        return;
      }
      case Job.Builder: {
        const site = this.pickSite(s);
        if (!site) { this.goGather(i, s, planet, plants, rng); return; }
        if (this.hasMaterials(site)) {
          this.goTo(i, site.x, site.y, site.z, BUILDINGS[site.type].radius * 0.8, PState.Walk, Intent.Build, site.id, rng);
        } else {
          // Fetch materials from the store.
          let need = -1;
          for (let r = 1; r < RES_COUNT; r++) if (this.missing(site, r) > 0.001 && s.stock[r] >= 0.5) { need = r; break; }
          if (need < 0) { this.doJob(i, this.fallbackJob(s, site), s, tick, rng, planet, plants, animals); return; }
          this.goTo(i, s.x, s.y, s.z, 4, PState.Walk, Intent.Fetch, site.id, rng);
        }
        return;
      }
      case Job.Soldier: {
        const off = rng.range(0, Math.PI * 2);
        offsetDir(s.x, s.y, s.z, Math.cos(off) * s.radius * 0.8 * INV_R, Math.sin(off) * s.radius * 0.8 * INV_R, this.scratch);
        this.goTo(i, this.scratch[0], this.scratch[1], this.scratch[2], 2, PState.Walk, Intent.Patrol, -1, rng);
        return;
      }
      default:
        this.goGather(i, s, planet, plants, rng);
    }
    void P;
  }

  /** When materials for a site are missing and not in stock, builders fetch the raw material. */
  private fallbackJob(s: Settlement, site: Building): number {
    if (this.missing(site, Res.Wood) > 0) return Job.Woodcutter;
    if (this.missing(site, Res.Stone) > 0) return Job.Quarrier;
    if (this.missing(site, Res.Metal) > 0) {
      for (const id of s.buildings) if (this.buildings[id].type === BType.Mine && this.buildings[id].complete) return Job.Miner;
    }
    return Job.Gatherer;
  }

  private pickWorkplace(s: Settlement, type: BType, _job: number): Building | null {
    let best: Building | null = null;
    let bestW = 99;
    for (const id of s.buildings) {
      const b = this.buildings[id];
      if (b.type !== type || !b.complete || b.ruin) continue;
      const w = b.workers;
      if (w < bestW) { bestW = w; best = b; }
    }
    if (best && bestW >= BUILDINGS[type].jobs + 1) return null;
    return best;
  }

  private pickSite(s: Settlement): Building | null {
    for (const id of s.buildings) {
      const b = this.buildings[id];
      if (!b.complete && !b.ruin) return b;
    }
    return null;
  }

  private findForest(s: Settlement, planet: Planet, plants: Plants): number {
    const g = planet.region;
    let best = -1, bestV = 0.15;
    const c0 = s.cell;
    const visit = (c: number, ring: number) => {
      const v = plants.trees(c) - ring * 0.04;
      if (v > bestV && planet.terrain.oceanFrac[c] < 0.5) { bestV = v; best = c; }
    };
    visit(c0, 0);
    for (let k = 0; k < 8; k++) {
      const n1 = g.neighbors[c0 * 8 + k];
      visit(n1, 1);
      for (let q = 0; q < 8; q++) visit(g.neighbors[n1 * 8 + q], 2);
    }
    return best;
  }

  private findRocks(s: Settlement, planet: Planet): number {
    const g = planet.region;
    let best = s.cell, bestV = -1;
    for (let k = 0; k < 8; k++) {
      const n1 = g.neighbors[s.cell * 8 + k];
      for (const c of [n1, g.neighbors[n1 * 8 + k]]) {
        if (planet.terrain.oceanFrac[c] > 0.5) continue;
        const v = planet.terrain.slope[c] + planet.terrain.elev[c] * 0.01;
        if (v > bestV) { bestV = v; best = c; }
      }
    }
    return best;
  }

  private findFishing(s: Settlement, planet: Planet): number {
    const g = planet.region;
    let best = -1, bestV = 0.1;
    const c0 = s.cell;
    const visit = (c: number, ring: number) => {
      if (this.fish[c] <= 0) return;
      const v = this.fish[c] - ring * 0.1;
      if (v > bestV) { bestV = v; best = c; }
    };
    visit(c0, 0);
    for (let k = 0; k < 8; k++) {
      const n1 = g.neighbors[c0 * 8 + k];
      visit(n1, 1);
      for (let q = 0; q < 8; q++) visit(g.neighbors[n1 * 8 + q], 2);
    }
    return best;
  }

  private goGather(i: number, s: Settlement, planet: Planet, plants: Plants, rng: Rng): void {
    // Forage in the settlement's surroundings, favouring the richer side.
    const g = planet.region;
    let best = s.cell, bestV = plants.forage(s.cell) + 0.1;
    for (let k = 0; k < 8; k++) {
      const nb = g.neighbors[s.cell * 8 + k];
      if (planet.terrain.oceanFrac[nb] > 0.5) continue;
      const v = plants.forage(nb) + rng.float() * 0.1;
      if (v > bestV) { bestV = v; best = nb; }
    }
    // Walk 8–20 units toward that side, not all the way to the cell centre.
    const bx = g.centers[best * 3] - s.x, by = g.centers[best * 3 + 1] - s.y, bz = g.centers[best * 3 + 2] - s.z;
    const bl = Math.hypot(bx, by, bz) || 1;
    const dist = rng.range(8, 20) * INV_R;
    let x = s.x + (bx / bl) * dist, y = s.y + (by / bl) * dist, z = s.z + (bz / bl) * dist;
    const l = Math.hypot(x, y, z);
    x /= l; y /= l; z /= l;
    this.goTo(i, x, y, z, 6, PState.Walk, Intent.Gather, best, rng);
  }

  private goPray(i: number, s: Settlement, rng: Rng): void {
    let temple: Building | null = null;
    for (const id of s.buildings) {
      const b = this.buildings[id];
      if (b.type === BType.Temple && b.complete && !b.ruin) { temple = b; break; }
    }
    if (temple) this.goTo(i, temple.x, temple.y, temple.z, 3, PState.Walk, Intent.Pray, temple.id, rng);
    else this.goTo(i, s.x, s.y, s.z, 4, PState.Walk, Intent.Pray, -1, rng);
  }

  private goDeliver(i: number, s: Settlement, rng: Rng): void {
    let store: Building | null = null;
    for (const id of s.buildings) {
      const b = this.buildings[id];
      if (b.type === BType.Storehouse && b.complete && !b.ruin) { store = b; break; }
    }
    if (store) this.goTo(i, store.x, store.y, store.z, 2, PState.Carry, Intent.Deliver, s.id, rng);
    else this.goTo(i, s.x, s.y, s.z, 3, PState.Carry, Intent.Deliver, s.id, rng);
  }

  private wander(i: number, rng: Rng, r: number): void {
    const P = this.people;
    this.goTo(i, P.x[i], P.y[i], P.z[i], r, PState.Walk, Intent.Wander, -1, rng);
  }

  /** Walk to a point with some random scatter (world units). */
  goTo(i: number, x: number, y: number, z: number, scatter: number, state: number, intent: number, arg: number, rng: Rng, toShore = false): void {
    const P = this.people;
    if (scatter > 0) offsetDir(x, y, z, rng.range(-scatter, scatter) * INV_R, rng.range(-scatter, scatter) * INV_R, this.scratch);
    else { this.scratch[0] = x; this.scratch[1] = y; this.scratch[2] = z; }
    let tx = this.scratch[0], ty = this.scratch[1], tz = this.scratch[2];
    if (toShore) {
      // Stop at the water's edge: walk toward the target but end on land.
      const k = 0.92;
      tx = P.x[i] + (tx - P.x[i]) * k; ty = P.y[i] + (ty - P.y[i]) * k; tz = P.z[i] + (tz - P.z[i]) * k;
      const l = Math.hypot(tx, ty, tz);
      tx /= l; ty /= l; tz /= l;
    }
    P.tx[i] = tx; P.ty[i] = ty; P.tz[i] = tz;
    P.state[i] = state;
    P.intent[i] = intent;
    P.intentArg[i] = arg;
  }

  private arrive(i: number, tick: number, rng: Rng, planet: Planet, plants: Plants, animals: Animals, events: EventLog, geo: Geography): void {
    const P = this.people;
    const si = P.settle[i];
    const s = si >= 0 ? this.settlements[si] : null;
    const arg = P.intentArg[i];
    const skill = (a: Float32Array) => 0.7 + a[i] * 0.6;
    switch (P.intent[i]) {
      case Intent.Eat:
        P.state[i] = PState.Eat; P.timer[i] = 10; return;
      case Intent.Sleep:
        P.state[i] = PState.Sleep; return;
      case Intent.Deliver: {
        // Caravans heading home follow their path first.
        if (P.state[i] === PState.Travel && P.pathId[i] >= 0 && this.nextWaypoint(i, planet, rng)) return;
        P.vessel[i] = 0;
        if (s && P.carryRes[i] >= 0) {
          s.stock[P.carryRes[i]] += P.carryAmt[i];
          P.carryRes[i] = -1; P.carryAmt[i] = 0;
        }
        P.state[i] = PState.Idle; P.intent[i] = 0; return;
      }
      case Intent.Gather: P.state[i] = PState.Work; P.timer[i] = Math.round(40 / skill(P.skFarm)); return;
      case Intent.Chop: P.state[i] = PState.Work; P.timer[i] = 50; return;
      case Intent.Fish: P.state[i] = PState.Work; P.timer[i] = 60; return;
      case Intent.Farm: case Intent.Quarry: case Intent.Mine: {
        const b = arg >= 0 ? this.buildings[arg] : null;
        if (b) b.workers++;
        P.state[i] = PState.Work; P.timer[i] = b ? 70 : 90; return;
      }
      case Intent.Study: P.state[i] = PState.Work; P.timer[i] = 80; return;
      case Intent.Pray: P.state[i] = PState.Pray; P.timer[i] = 40; return;
      case Intent.Social: P.state[i] = PState.Socialize; P.timer[i] = 40; return;
      case Intent.Build: P.state[i] = PState.Build; P.timer[i] = 30; return;
      case Intent.Fetch: {
        // Take materials from the store for the site.
        const b = this.buildings[arg];
        if (s && b && !b.complete) {
          for (let r = 1; r < RES_COUNT; r++) {
            const need = this.missing(b, r);
            if (need > 0.001 && s.stock[r] >= 0.5) {
              const take = Math.min(need, s.stock[r], r === Res.Metal ? 2 : 5);
              s.stock[r] -= take;
              P.carryRes[i] = r; P.carryAmt[i] = take;
              this.goTo(i, b.x, b.y, b.z, BUILDINGS[b.type].radius * 0.8, PState.Carry, Intent.Build, b.id, rng);
              return;
            }
          }
        }
        P.state[i] = PState.Idle; P.intent[i] = 0; return;
      }
      case Intent.Hunt: {
        const a = arg;
        if (a >= 0 && animals.alive[a] && animals.defs[animals.species[a]].diet === 'herbivore') {
          const dx = animals.x[a] - P.x[i], dy = animals.y[a] - P.y[i], dz = animals.z[a] - P.z[i];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * PLANET_RADIUS;
          if (d < 2.5) {
            if (rng.chance(0.35 + P.skFight[i] * 0.4)) {
              const def = animals.defs[animals.species[a]];
              const meat = def.meat * 10 * (this.tribes[P.tribe[i]].known[TECH_INDEX.get('husbandry')!] ? 1.3 : 1);
              animals.deaths[animals.species[a] * 8 + 3]++;
              animals.kill(a);
              this.produce(Res.Food, meat);
              P.carryRes[i] = Res.Food; P.carryAmt[i] = meat;
              P.skFight[i] = Math.min(1, P.skFight[i] + 0.01);
              if (s) this.goDeliver(i, s, rng);
              return;
            }
          }
          // Chase: keep following.
          if (d < 70) { this.goTo(i, animals.x[a], animals.y[a], animals.z[a], 0, PState.Walk, Intent.Hunt, a, rng); return; }
        }
        P.state[i] = PState.Idle; P.intent[i] = 0; return;
      }
      case Intent.Settle: {
        this.arriveSettler(i, tick, rng, planet, events, geo);
        return;
      }
      case Intent.Trade: this.society.arriveTrader(this, i, tick, rng, planet); return;
      case Intent.Pilgrim: this.society.arrivePilgrim(this, i, tick, rng, planet, events); return;
      case Intent.March: {
        if (P.state[i] === PState.March && P.pathId[i] >= 0 && this.nextWaypoint(i, planet, rng)) return;
        P.state[i] = PState.March; P.timer[i] = 6; return;
      }

      default:
        P.state[i] = PState.Idle; P.intent[i] = 0; P.timer[i] = rng.int(4, 20);
    }
    void plants;
  }

  private finishWork(i: number, tick: number, rng: Rng, planet: Planet, plants: Plants, _animals: Animals, events: EventLog, _geo: Geography): void {
    const P = this.people;
    const si = P.settle[i];
    const s = si >= 0 ? this.settlements[si] : null;
    const arg = P.intentArg[i];
    const t = P.tribe[i] >= 0 ? this.tribes[P.tribe[i]] : null;
    const st = P.state[i];
    P.state[i] = PState.Idle;
    const intent = P.intent[i];
    P.intent[i] = 0;
    if (st === PState.Eat) {
      if (s && s.stock[Res.Food] >= 1) {
        const eat = Math.min(1, s.stock[Res.Food]);
        s.stock[Res.Food] -= eat;
        this.consume(Res.Food, eat);
        P.hunger[i] = Math.max(0, P.hunger[i] - 0.95 * eat);
        P.happiness[i] = Math.min(1, P.happiness[i] + 0.02);
      }
      return;
    }
    if (st === PState.Pray) {
      P.love[i] = Math.min(1, P.love[i] + 0.004 * (0.5 + P.pious[i]));
      if (t) t.research[TechField.Astronomy] += 0.002;
      return;
    }
    if (st === PState.Socialize) {
      P.happiness[i] = Math.min(1, P.happiness[i] + 0.03 * P.social[i]);
      this.maybeMarry(i, tick, rng, events);
      return;
    }
    if (st === PState.Build) {
      const b = this.buildings[arg];
      if (b && !b.complete && !b.ruin) {
        // Deliver carried materials.
        if (P.carryRes[i] >= 0) {
          const r = P.carryRes[i];
          const put = Math.min(P.carryAmt[i], this.missing(b, r));
          b.delivered[r] += put;
          if (put > 0) b.lastWork = tick;
          P.carryAmt[i] -= put;
          if (P.carryAmt[i] <= 0.0001) { P.carryRes[i] = -1; P.carryAmt[i] = 0; }
        }
        if (this.hasMaterials(b)) {
          b.lastWork = tick;
          b.progress += (8 / BUILDINGS[b.type].work) * (0.7 + P.skBuild[i] * 0.6);
          P.skBuild[i] = Math.min(1, P.skBuild[i] + 0.004);
          if (b.progress >= 1 && s) this.completeBuilding(b, s, tick, events);
        }
      }
      return;
    }
    if (st !== PState.Work || !s) return;
    const skill = (a: Float32Array) => 0.7 + a[i] * 0.6;
    const g = planet.region;
    switch (intent) {
      case Intent.Gather: {
        const c = arg >= 0 ? arg : g.cellOf(P.x[i], P.y[i], P.z[i]);
        const f = plants.forage(c);
        const amt = Math.min(5, 1 + 3 * f * skill(P.skFarm));
        if (amt > 0.05) {
          plants.grazed[c] += amt * 0.004;
          this.produce(Res.Food, amt);
          P.carryRes[i] = Res.Food; P.carryAmt[i] = amt;
          P.skFarm[i] = Math.min(1, P.skFarm[i] + 0.002);
          if (t) t.research[TechField.Agriculture] += 0.003;
          this.goDeliver(i, s, rng);
        }
        return;
      }
      case Intent.Chop: {
        const c = arg;
        const trees = plants.trees(c);
        if (trees > 0.05) {
          const amt = Math.min(5, 3 + trees * 3);
          plants.logged[c] += amt * 0.0022;
          this.produce(Res.Wood, amt);
          P.carryRes[i] = Res.Wood; P.carryAmt[i] = amt;
          this.goDeliver(i, s, rng);
        }
        return;
      }
      case Intent.Fish: {
        const c = arg;
        if (c >= 0 && this.fish[c] > 0.05) {
          const harbor = s.buildings.some((id) => this.buildings[id].type === BType.Harbor && this.buildings[id].complete);
          const amt = Math.min(5, 3.2 * this.fish[c] * (harbor ? 1.5 : 1));
          this.fish[c] = Math.max(0.01, this.fish[c] - amt * 0.012);
          this.produce(Res.Food, amt);
          P.carryRes[i] = Res.Food; P.carryAmt[i] = amt;
          if (t) t.research[TechField.Seafaring] += 0.004;
          this.goDeliver(i, s, rng);
        }
        return;
      }
      case Intent.Farm: {
        const b = this.buildings[arg];
        if (!b) return;
        b.workers = Math.max(0, b.workers - 1);
        P.skFarm[i] = Math.min(1, P.skFarm[i] + 0.003);
        if (t) t.research[TechField.Agriculture] += 0.002;
        if (b.growth >= 1) {
          // Harvest into the field's stock (food now exists).
          const tr = this.tribes[b.tribe];
          let yieldK = 1;
          if (tr.known[TECH_INDEX.get('croprotation')!]) yieldK *= 1.25;
          if (tr.known[TECH_INDEX.get('plough')!]) yieldK *= 1.35;
          if (tr.known[TECH_INDEX.get('windmills')!]) yieldK *= 1.2;
          const harvest = 60 * yieldK;
          b.stock += harvest;
          this.produce(Res.Food, harvest);
          b.growth = 0;
        }
        if (b.stock > 0.5) {
          const take = Math.min(b.stock, 5);
          b.stock -= take;
          P.carryRes[i] = Res.Food; P.carryAmt[i] = take;
          this.goDeliver(i, s, rng);
        }
        return;
      }
      case Intent.Quarry: case Intent.Mine: {
        const b = arg >= 0 ? this.buildings[arg] : null;
        const r = intent === Intent.Quarry ? Res.Stone : Res.Metal;
        if (!b) {
          // Loose surface stone (no quarry): slow but unblocks early building.
          if (r === Res.Stone) {
            const amt = 1.5;
            this.produce(r, amt);
            P.carryRes[i] = r; P.carryAmt[i] = amt;
            this.goDeliver(i, s, rng);
          }
          return;
        }
        b.workers = Math.max(0, b.workers - 1);
        const amt = (r === Res.Stone ? 3 : 1.4) * (0.8 + (r === Res.Metal ? planet.ore[g.cellOf(b.x, b.y, b.z)] : 0.4));
        this.produce(r, amt);
        P.carryRes[i] = r; P.carryAmt[i] = amt;
        if (t) t.research[TechField.Metallurgy] += 0.004;
        this.goDeliver(i, s, rng);
        return;
      }
      case Intent.Study: {
        if (t) {
          const k = 0.035 * skill(P.skLore);
          t.research[TechField.Writing] += k;
          t.research[TechField.Astronomy] += k * 0.6;
          t.research[TechField.Medicine] += k * 0.5;
          t.research[TechField.Industry] += k * 0.5;
        }
        P.skLore[i] = Math.min(1, P.skLore[i] + 0.004);
        return;
      }
    }
  }

  /** Betroth a woman to a single man of another settlement of her people; he travels to her. */
  private fetchSuitor(w: number, s: Settlement, rng: Rng, planet: Planet): void {
    const P = this.people;
    const t = this.tribes[s.tribe];
    let best = -1, bestD = Infinity;
    for (let j = 0; j < P.count; j++) {
      if (!P.alive[j] || P.sex[j] !== 1 || P.spouse[j] >= 0 || P.tribe[j] !== s.tribe || P.settle[j] === s.id || P.settle[j] < 0) continue;
      if (P.age[j] < 17 || Math.abs(P.age[j] - P.age[w]) >= 14 || P.role[j] !== 0 || P.army[j] >= 0) continue;
      if (P.intent[j] === Intent.Settle || P.state[j] === PState.Travel) continue;
      if (!t.settlements.includes(P.settle[j])) continue;
      const o = this.settlements[P.settle[j]];
      const d = (o.x - s.x) ** 2 + (o.y - s.y) ** 2 + (o.z - s.z) ** 2;
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best < 0) return;
    const from = this.settlements[P.settle[best]];
    const path = this.paths.find(from.cell, s.cell, 'land', 4000);
    if (!path) return;
    P.spouse[w] = P.uid[best];
    P.spouse[best] = P.uid[w];
    this.dropCarryAt(best, from);
    P.intent[best] = Intent.Settle;
    P.intentArg[best] = s.cell;
    P.state[best] = PState.Travel;
    P.pathId[best] = this.registerPath(path);
    P.pathPos[best] = 0;
    P.job[best] = Job.None;
    this.nextWaypoint(best, planet, rng);
  }

  private dropCarryAt(i: number, s: Settlement): void {
    const P = this.people;
    if (P.carryRes[i] >= 0 && P.carryAmt[i] > 0) s.stock[P.carryRes[i]] += P.carryAmt[i];
    P.carryRes[i] = -1; P.carryAmt[i] = 0;
  }

  private maybeMarry(i: number, tick: number, rng: Rng, events: EventLog): void {
    const P = this.people;
    if (P.spouse[i] >= 0 || P.age[i] < 17 || P.age[i] > 50) return;
    if (!rng.chance(0.25 * P.social[i] + 0.05)) return;
    const c = this.hash.bucketOf[i];
    if (c < 0) return;
    const hs = this.hash;
    for (let q = hs.cellStart[c], qe = hs.cellStart[c + 1]; q < qe; q++) {
      const j = hs.items[q];
      if (j === i || !P.alive[j] || P.sex[j] === P.sex[i] || P.spouse[j] >= 0 || P.age[j] < 17 || P.age[j] > 50) continue;
      if (P.settle[j] !== P.settle[i]) continue;
      // No marrying close family.
      if (P.mother[j] >= 0 && (P.mother[j] === P.mother[i] || P.uid[j] === P.mother[i] || P.uid[i] === P.mother[j])) continue;
      P.spouse[i] = P.uid[j];
      P.spouse[j] = P.uid[i];
      P.happiness[i] = Math.min(1, P.happiness[i] + 0.2);
      P.happiness[j] = Math.min(1, P.happiness[j] + 0.2);
      void tick; void events;
      return;
    }
  }

  private birth(i: number, tick: number, rng: Rng, events: EventLog): void {
    const P = this.people;
    const si = P.settle[i];
    if (si < 0) return;
    const child = P.spawn(rng, tick, P.x[i], P.y[i], P.z[i], P.tribe[i], si, 0, [P.uid[i], P.spouse[i] >= 0 ? P.spouse[i] : P.uid[i]]);
    if (child < 0) return;
    P.children[i]++;
    const f = P.slot(P.spouse[i]);
    if (f >= 0) P.children[f]++;
    P.home[child] = P.home[i];
    const t = this.tribes[P.tribe[i]];
    t.stats.births++;
    void events;
  }

  personDies(i: number, tick: number, cause: string, events: EventLog): void {
    const P = this.people;
    this.deathCauses[cause] = (this.deathCauses[cause] ?? 0) + 1;
    if (P.carryRes[i] >= 0 && P.carryAmt[i] > 0) this.destroy(P.carryRes[i], P.carryAmt[i]);
    P.carryRes[i] = -1; P.carryAmt[i] = 0;
    const sp = P.slot(P.spouse[i]);
    if (sp >= 0) P.spouse[sp] = -1;
    const t = P.tribe[i] >= 0 ? this.tribes[P.tribe[i]] : null;
    if (t) t.stats.deaths++;
    if (cause === 'plague' && t) t.stats.plagueDays++;
    this.graves.push({
      uid: P.uid[i], tribe: P.tribe[i], settle: P.settle[i], x: P.x[i], y: P.y[i], z: P.z[i], age: P.age[i], sex: P.sex[i], tick, cause,
      skills: [P.skFarm[i], P.skBuild[i], P.skFight[i], P.skLore[i]],
      traits: [P.brave[i], P.pious[i], P.greedy[i], P.social[i], P.curious[i]],
      love: P.love[i], fear: P.fear[i], generation: P.generation[i], mother: P.mother[i], father: P.father[i], role: P.role[i],
    });
    if (this.graves.length > GRAVE_LIMIT) this.graves.splice(0, this.graves.length - GRAVE_LIMIT);
    if (P.role[i] === 1) this.succession(i, tick, events);
    if (P.role[i] >= 1 && t) {
      events.emit(tick, 'death-notable', { x: P.x[i], y: P.y[i], z: P.z[i] }, 0.5, { name: this.personName(i), role: P.role[i], tribe: t.name, cause, age: Math.floor(P.age[i]) });
    }
    P.kill(i);
  }

  /** A new chief is chosen when the old one dies or retires. */
  private succession(old: number, tick: number, events: EventLog): void {
    const P = this.people;
    const t = P.tribe[old];
    if (t < 0) return;
    P.role[old] = 0;
    const s = this.tribes[t].capital;
    let best = -1, bestScore = -1;
    for (let j = 0; j < P.count; j++) {
      if (!P.alive[j] || j === old || P.tribe[j] !== t || P.settle[j] !== s || P.age[j] < 20 || P.age[j] > 60) continue;
      const score = P.brave[j] + P.social[j] + P.skFight[j] + P.skLore[j];
      if (score > bestScore) { bestScore = score; best = j; }
    }
    if (best >= 0) {
      P.role[best] = 1;
      events.emit(tick, 'birth-notable', { x: P.x[best], y: P.y[best], z: P.z[best] }, 0.35, { name: this.personName(best), tribe: this.tribes[t].name, role: 'chief' });
    }
  }

  personName(i: number): string {
    const P = this.people;
    const t = P.tribe[i];
    if (t < 0) return 'Wanderer';
    return Language.fromSpec(this.tribes[t].lang).nameFor(P.uid[i], 'person');
  }

  // ------------------------------------------------------------------ settlements
  private settlementBrain(s: Settlement, tick: number, rng: Rng, planet: Planet, plants: Plants, animals: Animals, events: EventLog, geo: Geography, fireRef?: Fires): void {
    const P = this.people;
    // Census.
    const members: number[] = [];
    let adults = 0;
    for (let i = 0; i < P.count; i++) if (P.alive[i] && P.settle[i] === s.id) members.push(i);
    s.pop = members.length;
    if (s.pop === 0) {
      this.abandon(s, tick, events);
      return;
    }
    const t = this.tribes[s.tribe];
    // Abandon building sites nobody has touched for two years (materials return to the store).
    for (const id of s.buildings) {
      const b = this.buildings[id];
      if (b.complete || b.ruin || tick - (b.lastWork ?? b.built) < TICKS_PER_YEAR * 2) continue;
      for (let r = 0; r < RES_COUNT; r++) { s.stock[r] += b.delivered[r]; b.delivered[r] = 0; }
      b.ruin = true;
      this.version++;
    }
    // Walled once most of the ring stands.
    {
      let wallN = 0;
      for (const id of s.buildings) { const b = this.buildings[id]; if (b.type === BType.Wall && b.complete && !b.ruin) wallN++; }
      s.walls = wallN >= Math.max(8, Math.round((2 * Math.PI * s.radius * 0.92) / 6.2) * 0.6);
    }
    // Cleared, trampled, watched ground around the settlement resists fire.
    if (fireRef) {
      const fb = Math.min(0.92, 0.45 + s.pop / 90 + s.tier * 0.1);
      fireRef.firebreak[s.cell] = fb;
      for (let k = 0; k < 8; k++) {
        const nb = planet.region.neighbors[s.cell * 8 + k];
        fireRef.firebreak[nb] = Math.max(fireRef.firebreak[nb], fb * 0.6);
      }
    }
    // Tier.
    let tier = 0;
    for (let k = TIER_POP.length - 1; k >= 0; k--) if (s.pop >= TIER_POP[k]) { tier = k; break; }
    if (tier > s.tier) {
      s.tier = tier;
      s.radius = 26 + tier * 14;
      this.claim(s, planet);
      events.emit(tick, 'settlement-grew', s, 0.35 + tier * 0.1, { settlement: s.name, tribe: t.name, tier });
    }
    // Housing assignment.
    const houses = s.buildings.map((id) => this.buildings[id]).filter((b) => b.complete && !b.ruin && BUILDINGS[b.type].housing > 0);
    let hi = 0, used = 0;
    for (const i of members) {
      if (P.home[i] >= 0 && this.buildings[P.home[i]] && !this.buildings[P.home[i]].ruin && this.buildings[P.home[i]].settle === s.id) continue;
      while (hi < houses.length && used >= BUILDINGS[houses[hi].type].housing) { hi++; used = 0; }
      if (hi < houses.length) { P.home[i] = houses[hi].id; used++; }
      else P.home[i] = -1;
    }
    // Recount workers at workplaces (people may have died mid-shift).
    for (const id of s.buildings) this.buildings[id].workers = 0;
    for (const i of members) {
      if (P.state[i] === PState.Work && (P.intent[i] === Intent.Farm || P.intent[i] === Intent.Quarry || P.intent[i] === Intent.Mine)) {
        const b = this.buildings[P.intentArg[i]];
        if (b) b.workers++;
      }
    }
    // Fight fires within the settlement's lands and keep the ground clear.
    const firefighters = Math.min(1, members.length / 12);
    const g = planet.region;
    const cells = [s.cell];
    for (let k = 0; k < 8; k++) cells.push(g.neighbors[s.cell * 8 + k]);
    for (const c of cells) {
      if (this.owner[c] !== s.id) continue;
      if (fireRef && fireRef.intensity[c] > 0) fireRef.intensity[c] = Math.max(0, fireRef.intensity[c] - 0.25 * firefighters);
      if (c === s.cell) plants.logged[c] += 0.01;
    }
    // Famine tracking.
    if (s.stock[Res.Food] < s.pop * 0.5) { s.famine++; t.stats.famineDays++; t.needs[TechField.Agriculture] += 0.02; if (s.famine === 3 && s.pop >= 8) events.emit(tick, 'famine', s, 0.45, { settlement: s.name, tribe: t.name }); }
    else s.famine = Math.max(0, s.famine - 1);
    // Job allocation.
    const able = members.filter((i) => P.age[i] >= 14 && P.age[i] < 62 && P.job[i] !== Job.Child);
    adults = able.length;
    const target = this.jobTargets(s, adults, planet, plants, animals);
    s.jobTarget = target;
    const counts = new Array(15).fill(0);
    for (const i of able) counts[P.job[i]]++;
    // Release surplus, then fill deficits with best-suited people.
    for (const i of able) {
      const j = P.job[i];
      if (j === Job.None || counts[j] > target[j]) { counts[j]--; P.job[i] = Job.None; }
    }
    for (const i of able) {
      if (P.job[i] !== Job.None) continue;
      let bestJob: number = Job.Gatherer, bestDef = -1;
      for (let j = 1; j < 13; j++) {
        const deficit = target[j] - counts[j];
        if (deficit <= 0) continue;
        const suit = j === Job.Farmer || j === Job.Gatherer ? P.skFarm[i] : j === Job.Builder ? P.skBuild[i] : j === Job.Soldier || j === Job.Hunter ? P.skFight[i] + P.brave[i] * 0.3 : j === Job.Scholar ? P.skLore[i] + P.curious[i] * 0.5 : j === Job.Priest ? P.pious[i] : 0.3;
        const score = deficit + suit;
        if (score > bestDef) { bestDef = score; bestJob = j; }
      }
      P.job[i] = bestJob;
      counts[bestJob]++;
    }
    // Planning construction.
    if (tick - s.lastPlan > 60) {
      s.lastPlan = tick;
      this.plan(s, tick, rng, planet);
    }
    // Colonisation.
    s.colonyCooldown -= 40;
    const maxSettlements = 2 + t.age * 2 + Math.floor(t.settlements.length / 3);
    const crowded = s.pop > Math.max(22, s.housing + 6) || s.pop > 45 + s.tier * 40;
    const livingSettlements = t.settlements.filter((id) => this.settlements[id].alive).length;
    if (crowded && s.colonyCooldown <= 0 && livingSettlements < maxSettlements && s.stock[Res.Food] > 30) {
      this.colonise(s, members, tick, rng, planet, animals, events, geo);
    }
    // Happiness and faith averages.
    let hap = 0, faith = 0;
    for (const i of members) {
      hap += P.happiness[i];
      faith += P.love[i] + P.fear[i] * 0.7;
      P.happiness[i] += (0.55 - P.happiness[i]) * 0.02;
      // Without new signs, awe fades: fear quickly, love slowly.
      P.fear[i] *= 0.998;
      P.love[i] *= 0.9996;
    }
    s.happiness = hap / members.length;
    s.faith = faith / members.length;
    // Matchmaking: single adults of the settlement pair up over time.
    const singles = members.filter((i) => P.spouse[i] < 0 && P.age[i] >= 17 && P.age[i] <= 48);
    const men = singles.filter((i) => P.sex[i] === 1), women = singles.filter((i) => P.sex[i] === 0);
    const related = (a: number, b: number) => (P.mother[a] >= 0 && P.mother[a] === P.mother[b]) || P.uid[a] === P.mother[b] || P.uid[b] === P.mother[a];
    let unmatched = -1;
    for (const w of women) {
      if (!rng.chance(0.18 + P.social[w] * 0.2)) continue;
      const m = men.find((mm) => P.spouse[mm] < 0 && !related(mm, w) && Math.abs(P.age[mm] - P.age[w]) < 14);
      if (m === undefined) { if (P.age[w] < 40) unmatched = w; continue; }
      P.spouse[w] = P.uid[m];
      P.spouse[m] = P.uid[w];
      P.happiness[w] = Math.min(1, P.happiness[w] + 0.2);
      P.happiness[m] = Math.min(1, P.happiness[m] + 0.2);
    }
    // No match at home: a suitor comes from a sister settlement.
    if (unmatched >= 0 && t.settlements.length > 1 && rng.chance(0.35)) this.fetchSuitor(unmatched, s, rng, planet);
    // Births: couples, housing and food permitting.
    const roomy = s.pop < s.housing + 4 + (s.housing < 10 ? 14 : 0);
    const fed = s.stock[Res.Food] > s.pop * 1.2;
    if (roomy && fed) {
      for (const i of members) {
        if (P.sex[i] !== 0 || P.pregnant[i] > 0 || P.age[i] < 17 || P.age[i] > 42 || P.spouse[i] < 0) continue;
        if (P.children[i] >= 6) continue;
        if (rng.chance(s.blessed > tick ? 0.14 : 0.07)) P.pregnant[i] = 300;
      }
    }
    // Disease burden (drives medicine research and the chronicle).
    let sick = 0;
    for (const i of members) if (P.sick[i] > 0) sick++;
    // Crowded towns breed sickness; trade brings strangers and their fevers.
    if (sick === 0 && s.pop >= 35) {
      const kn = (name: string) => (t.known[TECH_INDEX.get(name)!] ? 1 : 0);
      const crowd = Math.max(1, s.pop / Math.max(1, s.housing));
      const trade = this.society.routes.reduce((n, r) => n + (r.a === s.id || r.b === s.id ? 1 : 0), 0);
      const chance = 0.0022 * (s.pop / 35) * crowd * (1 + trade * 0.4) * (1 - 0.6 * kn('sanitation')) * (1 - 0.8 * kn('vaccination'));
      if (rng.chance(chance)) {
        const zero = members[rng.int(0, members.length)];
        if (P.age[zero] > 5 && !P.immune[zero]) { P.sick[zero] = 0.001; sick = 1; s.plagueFrom = s.id; s.plagueVia = 'crowding'; }
      }
    }
    const wasSick = s.disease;
    s.disease = sick / members.length;
    if (s.disease > 0.05) {
      t.needs[TechField.Medicine] += s.disease * 2;
      if (wasSick <= 0.05 && s.disease > 0.15) {
        const from = s.plagueFrom !== undefined && s.plagueFrom >= 0 && s.plagueFrom !== s.id ? this.settlements[s.plagueFrom] : null;
        events.emit(tick, 'plague', s, 0.6, { settlement: s.name, tribe: t.name, sick, from: from ? from.name : '', via: s.plagueVia ?? '' });
      }
    } else if (sick === 0) { s.plagueFrom = -1; s.plagueVia = undefined; }
  }

  private jobTargets(s: Settlement, adults: number, planet: Planet, plants: Plants, animals: Animals): number[] {
    const tgt = new Array(15).fill(0);
    if (adults <= 0) return tgt;
    const t = this.tribes[s.tribe];
    let remaining = adults;
    const take = (j: number, n: number) => { const k = Math.max(0, Math.min(remaining, Math.round(n))); tgt[j] += k; remaining -= k; };
    const blds = s.buildings.map((id) => this.buildings[id]).filter((b) => !b.ruin);
    const complete = (type: BType) => blds.filter((b) => b.type === type && b.complete).length;
    const unfinished = blds.filter((b) => !b.complete).length;
    // Builders first (if there is work).
    if (unfinished > 0) take(Job.Builder, Math.max(1, Math.min(adults * 0.15, 1 + unfinished)));
    // Food: a person eats about 0.65 food per day.
    const foodDays = s.stock[Res.Food] / Math.max(1, s.pop * 0.65);
    const hungry = foodDays < 3 ? 1.5 : foodDays < 8 ? 1 : foodDays < 16 ? 0.7 : 0.4;
    take(Job.Farmer, complete(BType.Farm) * 3);
    if (s.coastal || s.fish > 0) take(Job.Fisher, Math.max(1, adults * 0.12 * hungry) + complete(BType.Harbor) * 3);
    const game = animals.pop.reduce((a, b) => a + b, 0) > 0 ? 1 : 0;
    take(Job.Hunter, adults * 0.1 * hungry * game);
    // Materials.
    const building = unfinished > 0 || s.housing < s.pop + 2;
    const woodNeed = s.stock[Res.Wood] < 25 + s.pop * 0.6 ? (building ? 2 : 1) : 0.3;
    take(Job.Woodcutter, Math.max(1, adults * 0.12 * woodNeed));
    if (complete(BType.Quarry)) take(Job.Quarrier, complete(BType.Quarry) * (s.stock[Res.Stone] < 40 + s.pop ? 3 : 1));
    if (complete(BType.Mine)) take(Job.Miner, complete(BType.Mine) * (s.stock[Res.Metal] < 20 + s.pop * 0.3 ? 3 : 1));
    take(Job.Scholar, complete(BType.Library) * 3 + complete(BType.Observatory) * 2);
    take(Job.Priest, complete(BType.Temple) * 2 + complete(BType.Healer));
    take(Job.Soldier, complete(BType.Barracks) * 4 + complete(BType.Tower) + (t.stats.warDays > 0 ? adults * 0.1 : 0));
    // The rest gather — or, with full granaries, cut timber for the future.
    if (foodDays > 10 && s.stock[Res.Wood] < 60 + s.pop) take(Job.Woodcutter, remaining * 0.5);
    tgt[Job.Gatherer] += remaining;
    void plants; void planet;
    return tgt;
  }

  /** Decide what to build next. */
  private plan(s: Settlement, tick: number, rng: Rng, planet: Planet): void {
    const t = this.tribes[s.tribe];
    const blds = s.buildings.map((id) => this.buildings[id]).filter((b) => !b.ruin);
    const unfinished = blds.filter((b) => !b.complete).length;
    if (unfinished >= 1 + Math.floor(s.pop / 25)) return;
    const count = (type: BType) => blds.filter((b) => b.type === type).length;
    const knows = (id: string) => id === '' || t.known[TECH_INDEX.get(id)!] === 1;
    // Metal only comes from mines: don't start what can never be finished.
    const hasMine = blds.some((b) => b.type === BType.Mine && b.complete);
    const can = (type: BType) => {
      const d = BUILDINGS[type];
      if (d.cost[Res.Metal] > 0 && !hasMine && s.stock[Res.Metal] < d.cost[Res.Metal]) return false;
      return knows(d.tech) && s.tier >= d.tier && count(type) < d.max;
    };
    let pick: BType | -1 = -1;
    const foodDays = s.stock[Res.Food] / Math.max(1, s.pop * 0.65);
    if (count(BType.Storehouse) === 0) pick = BType.Storehouse;
    else if (s.housing < s.pop + 4 && can(BType.House)) pick = BType.House;
    else if (can(BType.Farm) && (foodDays < 5 || count(BType.Farm) < Math.ceil(s.pop / 9))) pick = BType.Farm;
    else if (!s.water && can(BType.Well) && planet.terrain.river[s.cell] < 1) pick = BType.Well;
    else if (can(BType.Temple) && count(BType.Temple) === 0) pick = BType.Temple;
    else if (can(BType.Quarry) && count(BType.Quarry) === 0) pick = BType.Quarry;
    else if (can(BType.Mine) && count(BType.Mine) === 0 && planet.ore[s.cell] > 0.1) pick = BType.Mine;
    else if (can(BType.Harbor) && s.coastal) pick = BType.Harbor;
    else if (can(BType.Workshop) && count(BType.Workshop) === 0) pick = BType.Workshop;
    else if (can(BType.Healer) && count(BType.Healer) === 0) pick = BType.Healer;
    else if (can(BType.Library) && count(BType.Library) === 0) pick = BType.Library;
    else if (can(BType.Market) && count(BType.Market) === 0) pick = BType.Market;
    else if (can(BType.Barracks) && count(BType.Barracks) === 0 && (t.traits.aggression > 0.5 || t.stats.warDays > 0)) pick = BType.Barracks;
    else if (can(BType.Hall) && s.id === t.capital) pick = BType.Hall;
    else if (can(BType.Observatory)) pick = BType.Observatory;
    else if (can(BType.Tower) && count(BType.Tower) < 4 && (t.stats.warDays > 0 || t.traits.aggression > 0.6)) pick = BType.Tower;
    else if (can(BType.Wall) && s.tier >= 2 && (t.stats.warDays > 0 || t.traits.aggression > 0.55 || this.society.enemies(t.id).length > 0) && this.placeWall(s, planet, tick)) return;
    else if (can(BType.Monument) && s.id === t.capital) pick = BType.Monument;
    else if (s.housing < s.pop + 12 && can(BType.House)) pick = BType.House;
    else if (can(BType.Farm) && count(BType.Farm) < Math.ceil(s.pop / 7)) pick = BType.Farm;
    if (pick < 0) return;
    const type = pick as BType;
    const site = this.findSite(type, s, planet, rng);
    if (!site) return;
    this.addBuilding(type, s, site[0], site[1], site[2], site[3] + Math.PI / 2, tick);
  }

  /** Next segment of a ring wall around the settlement. Returns true if one was started. */
  private placeWall(s: Settlement, planet: Planet, tick: number): boolean {
    const R = s.radius * 0.92;
    const N = Math.max(12, Math.round((2 * Math.PI * R) / 6.2));
    const taken = new Set<number>();
    // Local frame around the settlement for angle bookkeeping.
    let ex = s.z, ez = -s.x;
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const nx = s.y * ez, ny = s.z * ex - s.x * ez, nz = -s.y * ex;
    for (const id of s.buildings) {
      const b = this.buildings[id];
      if (b.type !== BType.Wall || b.ruin) continue;
      const a = Math.atan2(b.x * nx + b.y * ny + b.z * nz, b.x * ex + b.z * ez);
      taken.add(((Math.round((a / (Math.PI * 2)) * N) % N) + N) % N);
    }
    for (let k = 0; k < N; k++) {
      if (taken.has(k)) continue;
      const a = (k / N) * Math.PI * 2;
      offsetDir(s.x, s.y, s.z, Math.cos(a) * R * INV_R, Math.sin(a) * R * INV_R, this.scratch);
      const [x, y, z] = this.scratch;
      const h = planet.heightAt(x, y, z);
      if (h < 0.4) { taken.add(k); continue; }
      // Leave room for other buildings (gates where houses already stand).
      let blocked = false;
      for (const id of s.buildings) {
        const o = this.buildings[id];
        if (o.ruin || o.type === BType.Wall || o.type === BType.Farm) continue;
        const d = Math.acos(Math.min(1, o.x * x + o.y * y + o.z * z)) * PLANET_RADIUS;
        if (d < BUILDINGS[o.type].radius + 3.4) { blocked = true; break; }
      }
      if (blocked) continue;
      this.addBuilding(BType.Wall, s, x, y, z, a + Math.PI / 2, tick);
      return true;
    }
    return false;
  }

  private colonise(s: Settlement, members: number[], tick: number, rng: Rng, planet: Planet, animals: Animals, events: EventLog, geo: Geography): void {
    const P = this.people;
    const g = planet.region;
    // Search a ring of candidate cells around the settlement.
    let best = -1, bestScore = 0;
    const bc = this.beacon;
    if (bc && bc.until > tick) {
      // A divine sign: settle beneath the beacon if the land allows it.
      const d = Math.acos(Math.min(1, bc.x * s.x + bc.y * s.y + bc.z * s.z)) * PLANET_RADIUS;
      if (d < 900) {
        for (let k = 0; k < 9; k++) {
          const c = k === 0 ? bc.cell : g.neighbors[bc.cell * 8 + k - 1];
          const sc = this.siteScore(c, planet, animals, s.tribe);
          if (sc > 0 && sc * 4 > bestScore && this.paths.find(s.cell, c, 'land', 6000)) { bestScore = sc * 4; best = c; }
        }
      }
    }
    for (let k = 0; k < 90; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(110, 260);
      offsetDir(s.x, s.y, s.z, Math.cos(a) * r * INV_R, Math.sin(a) * r * INV_R, this.scratch);
      const c = g.cellOf(this.scratch[0], this.scratch[1], this.scratch[2]);
      const sc = this.siteScore(c, planet, animals, s.tribe);
      if (sc > bestScore) {
        const path = this.paths.find(s.cell, c, 'land', 4000);
        if (!path) continue;
        bestScore = sc; best = c;
      }
    }
    s.colonyCooldown = TICKS_PER_YEAR * 2;
    if (best < 0) return;
    // A group of young adults (and their children) leave.
    const group: number[] = [];
    for (const i of members) {
      if (group.length >= 9) break;
      if (P.age[i] >= 17 && P.age[i] < 35 && P.role[i] === 0) {
        group.push(i);
        const sp = P.slot(P.spouse[i]);
        if (sp >= 0 && !group.includes(sp)) group.push(sp);
      }
    }
    if (group.length < 4) return;
    // Children follow their mothers.
    for (const i of members) if (P.job[i] === Job.Child && group.some((g2) => P.uid[g2] === P.mother[i])) group.push(i);
    const path = this.paths.find(s.cell, best, 'land', 6000)!;
    const pathId = this.registerPath(path);
    for (const i of group) {
      P.intent[i] = Intent.Settle;
      P.intentArg[i] = best;
      P.state[i] = PState.Travel;
      P.pathId[i] = pathId;
      P.pathPos[i] = 0;
      this.nextWaypoint(i, planet, rng);
      // Carry provisions.
      if (P.carryRes[i] < 0 && s.stock[Res.Food] > 8) { s.stock[Res.Food] -= 7; P.carryRes[i] = Res.Food; P.carryAmt[i] = 7; }
    }
    events.emit(tick, 'migration', s, 0.3, { settlement: s.name, tribe: this.tribes[s.tribe].name, count: group.length, to: geo.describe(best) });
  }

  // Path registry (paths shared by groups of travellers). Ids are stable;
  // old paths are evicted unless pinned by a trade route.
  pathTable: Record<number, Int32Array> = {};
  nextPathId = 0;
  /** Trade route id → pinned path id. */
  routePaths = new Map<number, number>();
  registerPath(path: Int32Array): number {
    const id = this.nextPathId++;
    this.pathTable[id] = path;
    if (id % 256 === 255) {
      const pinned = new Set(this.routePaths.values());
      for (const k of Object.keys(this.pathTable)) {
        const n = Number(k);
        if (n < id - 3000 && !pinned.has(n)) delete this.pathTable[n];
      }
    }
    return id;
  }

  /** Lay (or upgrade) a road along a land path. */
  layRoad(path: Int32Array, planet: Planet): void {
    const g = planet.region;
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k], b = path[k + 1];
      this.paths.roads[a] = Math.min(3, this.paths.roads[a] + 1);
      if (k % 2 === 0) {
        const o = this.owner[a];
        const level = o >= 0 ? Math.min(3, this.tribes[this.settlements[o].tribe].age >> 1) : 0;
        this.roads.push({ ax: g.centers[a * 3], ay: g.centers[a * 3 + 1], az: g.centers[a * 3 + 2], bx: g.centers[b * 3], by: g.centers[b * 3 + 1], bz: g.centers[b * 3 + 2], level, settle: o });
      }
    }
    this.paths.clearCache();
    this.version++;
  }

  cellOfDir(x: number, y: number, z: number): number {
    return this.region.cellOf(x, y, z);
  }

  /** Advance a traveller to the next waypoint of its path. */
  nextWaypoint(i: number, planet: Planet, rng: Rng): boolean {
    const P = this.people;
    const path = this.pathTable[P.pathId[i]];
    if (!path) return false;
    const k = P.pathPos[i] + 1;
    if (k >= path.length) return false;
    P.pathPos[i] = k;
    const c = path[k];
    const g = planet.region;
    offsetDir(g.centers[c * 3], g.centers[c * 3 + 1], g.centers[c * 3 + 2], rng.range(-4, 4) * INV_R, rng.range(-4, 4) * INV_R, this.scratch);
    P.tx[i] = this.scratch[0]; P.ty[i] = this.scratch[1]; P.tz[i] = this.scratch[2];
    return true;
  }

  private arriveSettler(i: number, tick: number, rng: Rng, planet: Planet, events: EventLog, geo: Geography): void {
    const P = this.people;
    if (P.state[i] === PState.Travel && this.nextWaypoint(i, planet, rng)) return;
    const target = P.intentArg[i];
    // The first to arrive founds the settlement; the rest join.
    let s: Settlement | null = null;
    for (const o of this.settlements) if (o.alive && o.cell === target && o.tribe === P.tribe[i]) { s = o; break; }
    if (!s) {
      if (this.owner[target] >= 0 && this.settlements[this.owner[target]].alive) {
        s = this.settlements[this.owner[target]].tribe === P.tribe[i] ? this.settlements[this.owner[target]] : null;
      }
      if (!s) s = this.foundSettlement(P.tribe[i], target, planet, tick, events, geo);
    }
    P.settle[i] = s.id;
    P.home[i] = -1;
    P.state[i] = PState.Idle;
    P.intent[i] = 0;
    P.pathId[i] = -1;
    if (P.carryRes[i] >= 0) { s.stock[P.carryRes[i]] += P.carryAmt[i]; P.carryRes[i] = -1; P.carryAmt[i] = 0; }
  }

  private abandon(s: Settlement, tick: number, events: EventLog): void {
    s.alive = false;
    for (let r = 0; r < RES_COUNT; r++) { this.destroy(r, s.stock[r]); s.stock[r] = 0; }
    for (const id of s.buildings) {
      const b = this.buildings[id];
      b.ruin = true;
      for (let r = 0; r < RES_COUNT; r++) { this.destroy(r, b.delivered[r]); b.delivered[r] = 0; }
      if (b.stock > 0) { this.destroy(b.type === BType.Quarry ? Res.Stone : b.type === BType.Mine ? Res.Metal : Res.Food, b.stock); b.stock = 0; }
    }
    for (let c = 0; c < this.owner.length; c++) if (this.owner[c] === s.id) this.owner[c] = -1;
    const t = this.tribes[s.tribe];
    t.settlements = t.settlements.filter((id) => id !== s.id);
    if (t.capital === s.id) t.capital = t.settlements.find((id) => this.settlements[id].alive) ?? -1;
    if (t.capital < 0 && t.alive) {
      t.alive = false;
      events.emit(tick, 'settlement-abandoned', s, 0.8, { settlement: s.name, tribe: t.name, last: 1 });
    } else {
      events.emit(tick, 'settlement-abandoned', s, 0.5, { settlement: s.name, tribe: t.name, last: 0 });
    }
    this.version++;
  }

  // ------------------------------------------------------------------ research
  private research(tick: number, events: EventLog): void {
    const P = this.people;
    const perTribe = this.tribes.map(() => ({ adults: 0, coastal: 0 }));
    for (let i = 0; i < P.count; i++) if (P.alive[i] && P.tribe[i] >= 0 && P.age[i] >= 14) perTribe[P.tribe[i]].adults++;
    for (const s of this.settlements) if (s.alive && s.coastal) perTribe[s.tribe].coastal++;
    for (const t of this.tribes) {
      if (!t.alive) continue;
      const pt = perTribe[t.id];
      // Ideas grow with people, but less than linearly (they share them).
      const base = 0.035 * Math.pow(pt.adults, 0.75) * (0.6 + t.traits.curiosity) * (t.inspired > tick ? 2 : 1);
      for (let f = 0; f < FIELD_COUNT; f++) {
        t.research[f] += base * (f === TechField.Seafaring ? (pt.coastal ? 1 : 0.1) : 1) + t.needs[f];
        t.needs[f] *= 0.97;
      }
      t.research[TechField.War] += base * t.traits.aggression * 0.5;
      t.research[TechField.Writing] += base * t.traits.trade * 0.4;
      // Discover.
      for (let f = 0; f < FIELD_COUNT; f++) {
        let cheapest = -1, cost = Infinity;
        for (let k = 0; k < TECHS.length; k++) {
          const tech = TECHS[k];
          if (tech.field !== f || t.known[k]) continue;
          if (!tech.req.every((r) => t.known[TECH_INDEX.get(r)!])) continue;
          if (tech.cost < cost) { cost = tech.cost; cheapest = k; }
        }
        if (cheapest >= 0 && t.research[f] >= cost) {
          t.known[cheapest] = 1;
          t.research[f] -= cost * 0.85;
          const tech = TECHS[cheapest];
          const cap = this.settlements[t.capital];
          events.emit(tick, 'tech', cap ?? null, tech.age !== undefined ? 0.5 : 0.3, { tribe: t.name, tech: tech.name, desc: tech.desc });
          const newAge = ageOf(Uint8Array.from(t.known));
          if (newAge > t.age) {
            t.age = newAge;
            events.emit(tick, 'age', cap ?? null, 0.9, { tribe: t.name, age: AGE_NAMES[newAge] });
          }
        }
      }
    }
  }

  /** Population per tribe (recomputed on demand). */
  census(): void {
    for (const t of this.tribes) t.population = 0;
    const P = this.people;
    for (let i = 0; i < P.count; i++) if (P.alive[i] && P.tribe[i] >= 0) this.tribes[P.tribe[i]].population++;
  }

  totalPeople(): number {
    let n = 0;
    const P = this.people;
    for (let i = 0; i < P.count; i++) if (P.alive[i]) n++;
    return n;
  }
  // ------------------------------------------------------------------ disease
  /** One tick of an infection: sickness, contagion, recovery. Returns new health. */
  private diseaseStep(i: number, tick: number, rng: Rng, hp: number): number {
    const P = this.people;
    const t = this.tribes[P.tribe[i]];
    const k = (name: string) => (t && t.known[TECH_INDEX.get(name)!] ? 1 : 0);
    const care = 1 - 0.18 * k('herbalism') - 0.2 * k('sanitation') - 0.15 * k('anatomy') - 0.25 * k('vaccination');
    const s = P.settle[i] >= 0 ? this.settlements[P.settle[i]] : null;
    const blessed = s && s.blessed > tick ? 0.3 : 1;
    P.sick[i] += 1 / TICKS_PER_DAY;
    hp -= 0.0019 * care * blessed * (P.age[i] > 55 || P.age[i] < 5 ? 1.6 : 1);
    P.energy[i] = Math.max(0, P.energy[i] - 0.002);
    // Contagion: people sharing this ground may catch it.
    if ((i + tick) % 6 === 0) {
      const b = this.hash.bucketOf[i];
      if (b >= 0) {
        const hs = this.hash;
        const quarantine = 1 - 0.6 * k('quarantine');
        for (let q = hs.cellStart[b], qe = hs.cellStart[b + 1]; q < qe; q++) {
          const j = hs.items[q];
          if (j === i || !P.alive[j] || P.sick[j] > 0 || P.immune[j]) continue;
          const dx = P.x[j] - P.x[i], dy = P.y[j] - P.y[i], dz = P.z[j] - P.z[i];
          if (dx * dx + dy * dy + dz * dz > (6 * INV_R) ** 2) continue;
          if (rng.chance(0.07 * quarantine * (1 - 0.3 * k('sanitation')))) P.sick[j] = 0.001;
        }
      }
    }
    // Recovery after a few days.
    if (P.sick[i] > 3.2 && rng.chance(0.02)) {
      P.sick[i] = 0;
      P.immune[i] = 1;
    }
    return hp;
  }

  /** A sick traveller arriving at a healthy settlement seeds its next outbreak. */
  carrierArrives(i: number, s: Settlement, from: Settlement | null, via: 'traders' | 'pilgrims' | 'refugees'): void {
    if (this.people.sick[i] <= 0 || s.disease > 0.02 || !from || from.id === s.id) return;
    s.plagueFrom = from.id;
    s.plagueVia = via;
  }

  /** Infect people within `radius` of a point (plague power, trade routes). */
  infectArea(x: number, y: number, z: number, radius: number, frac: number, rng: Rng): number {
    const P = this.people;
    const r2 = (radius * INV_R) ** 2;
    let n = 0;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.sick[i] > 0 || P.immune[i]) continue;
      const dx = P.x[i] - x, dy = P.y[i] - y, dz = P.z[i] - z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (rng.chance(frac)) { P.sick[i] = 0.001; n++; }
    }
    return n;
  }

  /** Cure everyone in a settlement (Miracle Cure). */
  cureSettlement(s: Settlement): number {
    const P = this.people;
    let n = 0;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.settle[i] !== s.id || P.sick[i] <= 0) continue;
      P.sick[i] = 0; P.immune[i] = 1; P.health[i] = 1; n++;
    }
    s.disease = 0;
    return n;
  }

  // ------------------------------------------------------------------ divine interface
  /** Nearest living settlement to a direction within `maxDist` world units. */
  nearestSettlement(x: number, y: number, z: number, maxDist: number, tribe = -1): Settlement | null {
    let best: Settlement | null = null, bestD = maxDist;
    for (const s of this.settlements) {
      if (!s.alive || (tribe >= 0 && s.tribe !== tribe)) continue;
      const d = Math.acos(Math.min(1, s.x * x + s.y * y + s.z * z)) * PLANET_RADIUS;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /**
   * Mortals near a divine act react: love and fear rise with proximity and
   * piety; the act enters their memory (and their tribe's scripture).
   */
  witness(x: number, y: number, z: number, radius: number, love: number, fear: number, kind: string, tick: number, place: string, deaths: number): number {
    const P = this.people;
    const cosR = Math.cos(radius * INV_R);
    let n = 0;
    const settlementsHit = new Set<number>();
    const mem = this.godMemoryBase + this.godMemories.length;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i]) continue;
      const dot = P.x[i] * x + P.y[i] * y + P.z[i] * z;
      if (dot < cosR) continue;
      const t = 1 - Math.acos(Math.min(1, dot)) / (radius * INV_R);
      const k = (0.4 + t * 0.6) * (0.6 + P.pious[i] * 0.8);
      P.love[i] = Math.max(0, Math.min(1, P.love[i] + love * k));
      P.fear[i] = Math.max(0, Math.min(1, P.fear[i] + fear * k));
      if (fear > love && fear > 0.05) P.worstMem[i] = mem;
      if (love >= fear && love > 0.05) P.bestMem[i] = mem;
      if (P.settle[i] >= 0) settlementsHit.add(P.settle[i]);
      n++;
    }
    if (n > 0) {
      const settlementName = settlementsHit.size ? this.settlements[[...settlementsHit][0]].name : '';
      const m: GodMemory = { kind, tick, place, deaths, settlement: settlementName };
      this.godMemories.push(m);
      if (this.godMemories.length > 3000) { this.godMemories.splice(0, 1000); this.godMemoryBase += 1000; }
      const tribesHit = new Set<number>();
      for (const sid of settlementsHit) tribesHit.add(this.settlements[sid].tribe);
      for (const tid of tribesHit) {
        const t = this.tribes[tid];
        t.religion.love = Math.max(0, Math.min(1, t.religion.love + love * 0.3));
        t.religion.fear = Math.max(0, Math.min(1, t.religion.fear + fear * 0.3));
        const weight = (love + fear) * (1 + deaths * 0.1);
        if (fear > love && (!t.worst || weight > (t.worst.deaths + 1) * 0.1)) t.worst = m;
        if (love >= fear && (!t.best || love > 0.2)) t.best = m;
      }
    }
    return n;
  }

  /** Ruin one building (disaster), returning its stored goods to the ledger as destroyed. */
  ruinBuilding(b: Building): void {
    if (b.ruin) return;
    b.ruin = true;
    b.hp = 0;
    for (let r = 0; r < RES_COUNT; r++) { this.destroy(r, b.delivered[r]); b.delivered[r] = 0; }
    if (b.stock > 0) { this.destroy(b.type === BType.Quarry ? Res.Stone : b.type === BType.Mine ? Res.Metal : Res.Food, b.stock); b.stock = 0; }
    if (b.type === BType.Storehouse || b.type === BType.Market || b.type === BType.Harbor || b.type === BType.Hall) {
      // Part of the settlement's stores burn or wash away with it.
      const s = this.settlements[b.settle];
      if (s) for (let r = 0; r < RES_COUNT; r++) { const loss = s.stock[r] * 0.25; s.stock[r] -= loss; this.destroy(r, loss); }
    }
    this.version++;
  }

  /**
   * Area damage from quakes, lava, meteors: buildings lose integrity and may
   * collapse; people may be killed. Returns the number of deaths.
   */
  damageArea(x: number, y: number, z: number, radius: number, intensity: number, cause: string, tick: number, rng: Rng, events: EventLog, lethality = intensity * 0.45): { deaths: number; ruined: number } {
    const R = radius * INV_R;
    let ruined = 0, deaths = 0;
    for (const b of this.buildings) {
      if (b.ruin) continue;
      const d = Math.acos(Math.min(1, b.x * x + b.y * y + b.z * z));
      if (d > R) continue;
      const t = 1 - d / R;
      const sturdy = b.type === BType.Wall || b.type === BType.Tower || b.type === BType.Monument ? 0.5 : 1;
      b.hp -= intensity * t * t * sturdy * (0.7 + rng.float() * 0.6);
      if (b.hp <= 0) { this.ruinBuilding(b); ruined++; }
    }
    const P = this.people;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i]) continue;
      const d = Math.acos(Math.min(1, P.x[i] * x + P.y[i] * y + P.z[i] * z));
      if (d > R) continue;
      const t = 1 - d / R;
      if (rng.chance(Math.min(1, lethality * t))) { this.personDies(i, tick, cause, events); deaths++; }
    }
    return { deaths, ruined };
  }

  /** Flood water over a region cell: low buildings wash away, fields are salted, people drown. */
  floodCell(c: number, depth: number, planet: Planet, tick: number, rng: Rng, events: EventLog, cause: string): number {
    const g = planet.region;
    let deaths = 0;
    const cx = g.centers[c * 3], cy = g.centers[c * 3 + 1], cz = g.centers[c * 3 + 2];
    const half = g.spacing * 0.75;
    for (const b of this.buildings) {
      if (b.ruin) continue;
      if (Math.acos(Math.min(1, b.x * cx + b.y * cy + b.z * cz)) > half) continue;
      if (b.type === BType.Farm) { const loss = Math.min(b.growth, 1) * 0.5; b.growth = 0; void loss; }
      b.hp -= depth * 0.45;
      if (b.hp <= 0) this.ruinBuilding(b);
    }
    const P = this.people;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || this.hash.bucketOf[i] !== c) continue;
      if (rng.chance(Math.min(0.9, depth * 0.18))) { this.personDies(i, tick, cause, events); deaths++; }
    }
    return deaths;
  }

  /** Bring back the recently dead near a point. Returns revived slots. */
  resurrect(x: number, y: number, z: number, radius: number, sinceTick: number, tick: number, rng: Rng): number[] {
    const P = this.people;
    const cosR = Math.cos(radius * INV_R);
    const out: number[] = [];
    const keep: Grave[] = [];
    for (const g of this.graves) {
      const dot = g.x * x + g.y * y + g.z * z;
      if (g.tick < sinceTick || dot < cosR || g.cause === 'old age' || out.length >= 60) { keep.push(g); continue; }
      let settle = g.settle;
      if (settle < 0 || !this.settlements[settle]?.alive) {
        const near = this.nearestSettlement(g.x, g.y, g.z, 400, g.tribe);
        settle = near ? near.id : -1;
      }
      let tribe = g.tribe;
      if (tribe < 0 || !this.tribes[tribe]?.alive) {
        const near = this.nearestSettlement(g.x, g.y, g.z, 400);
        if (!near) { keep.push(g); continue; }
        settle = near.id;
        tribe = near.tribe;
      }
      const i = P.spawn(rng, tick, g.x, g.y, g.z, tribe, settle, g.age, null);
      if (i < 0) { keep.push(g); continue; }
      P.assignUid(i, g.uid);
      P.sex[i] = g.sex;
      [P.skFarm[i], P.skBuild[i], P.skFight[i], P.skLore[i]] = g.skills;
      [P.brave[i], P.pious[i], P.greedy[i], P.social[i], P.curious[i]] = g.traits;
      P.love[i] = 1;
      P.fear[i] = Math.min(1, g.fear + 0.2);
      P.generation[i] = g.generation;
      P.mother[i] = g.mother;
      P.father[i] = g.father;
      P.returned[i] = tick + TICKS_PER_DAY * 2;
      P.immune[i] = 1;
      P.hunger[i] = 0.2;
      out.push(i);
      const t = this.tribes[tribe];
      if (t) { t.stats.deaths = Math.max(0, t.stats.deaths - 1); }
    }
    this.graves = keep;
    return out;
  }

  /** A mortal receives a vision and becomes a prophet. */
  raiseProphet(i: number, tick: number, events: EventLog, kind: 'vision' | 'saint' | 'doom'): void {
    const P = this.people;
    const t = this.tribes[P.tribe[i]];
    P.role[i] = 3;
    const s = P.settle[i] >= 0 ? this.settlements[P.settle[i]] : null;
    for (let j = 0; j < P.count; j++) {
      if (!P.alive[j] || P.tribe[j] !== P.tribe[i]) continue;
      if (kind === 'saint') P.love[j] = Math.min(1, P.love[j] + 0.1);
      if (kind === 'doom') P.fear[j] = Math.min(1, P.fear[j] + 0.12);
    }
    if (kind === 'doom') t.religion.fear = Math.min(1, t.religion.fear + 0.2);
    else t.religion.love = Math.min(1, t.religion.love + (kind === 'saint' ? 0.2 : 0.08));
    events.emit(tick, 'prophet', { x: P.x[i], y: P.y[i], z: P.z[i] }, 0.7, { name: this.personName(i), tribe: t.name, settlement: s ? s.name : '', kind });
  }

  /** Harmony: end wars among these tribes. Returns wars ended. */
  truce(tribes: number[], tick: number, events: EventLog): number {
    return this.society.truce(this, tribes, tick, events);
  }

  /** The land changed shape: drowned buildings, swallowed settlements, stale paths. */
  afterTerraform(planet: Planet, tick: number, rng: Rng, events: EventLog): void {
    this.paths.clearCache();
    for (const b of this.buildings) {
      if (b.ruin) continue;
      if (planet.heightAt(b.x, b.y, b.z) < -0.4) this.ruinBuilding(b);
    }
    const P = this.people;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.vessel[i]) continue;
      const h = planet.heightAt(P.x[i], P.y[i], P.z[i]);
      if (h < -1.5 && rng.chance(0.6)) this.personDies(i, tick, 'drowning', events);
    }
    for (const s of this.settlements) {
      if (!s.alive) continue;
      if (planet.heightAt(s.x, s.y, s.z) < -0.3) {
        events.emit(tick, 'flood', s, 0.8, { settlement: s.name, tribe: this.tribes[s.tribe].name, swallowed: 1 });
        this.abandon(s, tick, events);
      }
    }
    this.version++;
  }

  /** The memory a person refers to (undefined if forgotten long ago). */
  memoryAt(idx: number): GodMemory | undefined {
    return idx >= this.godMemoryBase ? this.godMemories[idx - this.godMemoryBase] : undefined;
  }

}
