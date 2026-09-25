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
import { PLANET_RADIUS, TICKS_PER_DAY, TICKS_PER_YEAR, dayFrac } from '../constants';
import type { Planet } from '../planet/planet';
import type { Plants } from '../ecology/plants';
import type { Animals } from '../ecology/animals';
import type { Fires } from '../ecology/fire';
import type { EventLog } from '../events';
import type { Geography } from '../planet/geography';
import { AGE_NAMES } from './defs';

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
}

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
  godMemories: GodMemory[] = [];
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
  devotion = 30;
  devotionRate = 0;
  private scratch = [0, 0, 0];

  constructor(planet: Planet) {
    this.paths = new Pathfinder(planet.region, planet.terrain);
    this.hash = new SpatialHash(planet.region, this.people.cap);
    this.owner = new Int32Array(planet.region.count).fill(-1);
    this.fish = new Float32Array(planet.region.count);
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
      const t = createTribe(this.tribes.length, rng, tick, k, { temp: planet.climate.meanTemp[c], coastal: planet.terrain.coastal[c] === 1 });
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
        const spoil = s.stock[Res.Food] * (s.stock[Res.Food] > s.storage ? 0.0005 : 0.00004);
        s.stock[Res.Food] -= spoil;
        this.destroy(Res.Food, spoil);
      }
    }
    // Farms grow.
    if (tick % 8 === 0) this.growFarms(planet);
    // Fish regenerate.
    if (tick % 32 === 0) for (let c = 0; c < this.fish.length; c++) if (this.fish[c] > 0 && this.fish[c] < 1) this.fish[c] = Math.min(1, this.fish[c] + 0.004);
    // Research once a day.
    if (tick % TICKS_PER_DAY === 17) this.research(tick, events);
    // Devotion from worship.
    if (tick % 16 === 5) this.worship();
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
      b.growth += 0.017 * fert * warm * (0.4 + Math.min(3, b.workers) * 0.25);
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
    gain *= 0.0008;
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
    P.age[i] += 1 / TICKS_PER_YEAR;
    let hp = P.health[i];
    if (P.hunger[i] >= 1) { P.hunger[i] = 1; hp -= 0.0022; }
    const c = this.hash.bucketOf[i];
    if (c >= 0 && fires.intensity[c] > 0.35) hp -= fires.intensity[c] * 0.012;
    if (P.hunger[i] < 0.5 && hp < 1) hp = Math.min(1, hp + 0.0015);
    P.health[i] = hp;
    // Death: health, or old age.
    const age = P.age[i];
    const oldAge = age > 48 ? 0.00012 * Math.exp((age - 48) / 9) : age < 3 ? 0.000012 : 0.000004;
    if (hp <= 0 || rng.chance(oldAge)) {
      this.personDies(i, tick, hp <= 0 ? (P.hunger[i] >= 1 ? 'starvation' : c >= 0 && fires.intensity[c] > 0.35 ? 'fire' : 'hardship') : 'old age', events);
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
      const speed = WALK * (s2 === PState.Flee ? 1.8 : s2 === PState.Carry ? 0.85 : 1) * (age < 12 ? 0.8 : age > 60 ? 0.75 : 1);
      const ox = P.x[i], oy = P.y[i], oz = P.z[i];
      const rem = stepToward(P.x, P.y, P.z, P.tx, P.ty, P.tz, i, speed);
      if ((i + tick) % 2 === 0 && planet.heightAt(P.x[i], P.y[i], P.z[i]) < 0.12) {
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
    // Busy with timed activity or long journeys: don't interrupt.
    if ((st === PState.Work || st === PState.Build || st === PState.Eat || st === PState.Pray) && P.timer[i] > 0) return;
    if (st === PState.Travel || P.intent[i] === Intent.Settle) return;
    // Fire: flee away from the flames, toward the calmest neighbouring ground.
    const c = this.hash.bucketOf[i];
    if (c >= 0 && (fires.intensity[c] > 0.12 || fires.intensity[planet.region.neighbors[c * 8]] > 0.3 || fires.intensity[planet.region.neighbors[c * 8 + 1]] > 0.3 || fires.intensity[planet.region.neighbors[c * 8 + 2]] > 0.3 || fires.intensity[planet.region.neighbors[c * 8 + 3]] > 0.3)) {
      const g = planet.region;
      let best = c, bestV = fires.intensity[c] + 1;
      for (let k = 0; k < 8; k++) {
        const nb = g.neighbors[c * 8 + k];
        if (planet.terrain.oceanFrac[nb] > 0.5) continue;
        let v = fires.intensity[nb];
        for (let q = 0; q < 4; q++) v += fires.intensity[g.neighbors[nb * 8 + q]] * 0.5;
        if (v < bestV) { bestV = v; best = nb; }
      }
      this.goTo(i, g.centers[best * 3], g.centers[best * 3 + 1], g.centers[best * 3 + 2], 6, PState.Flee, Intent.Wander, -1, rng);
      return;
    }
    if (!s) { this.wander(i, rng, 8); return; }
    // Carrying: deliver first.
    if (P.carryRes[i] >= 0 && P.carryAmt[i] > 0 && P.intent[i] !== Intent.Deliver && P.intent[i] !== Intent.Build) {
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
          P.carryAmt[i] -= put;
          if (P.carryAmt[i] <= 0.0001) { P.carryRes[i] = -1; P.carryAmt[i] = 0; }
        }
        if (this.hasMaterials(b)) {
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

  private personDies(i: number, tick: number, cause: string, events: EventLog): void {
    const P = this.people;
    this.deathCauses[cause] = (this.deathCauses[cause] ?? 0) + 1;
    if (P.carryRes[i] >= 0 && P.carryAmt[i] > 0) this.destroy(P.carryRes[i], P.carryAmt[i]);
    P.carryRes[i] = -1; P.carryAmt[i] = 0;
    const sp = P.slot(P.spouse[i]);
    if (sp >= 0) P.spouse[sp] = -1;
    const t = P.tribe[i] >= 0 ? this.tribes[P.tribe[i]] : null;
    if (t) t.stats.deaths++;
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
    if (s.stock[Res.Food] < s.pop * 0.5) { s.famine++; t.stats.famineDays++; t.needs[TechField.Agriculture] += 0.02; }
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
    for (const i of members) { hap += P.happiness[i]; faith += P.love[i] + P.fear[i] * 0.7; P.happiness[i] += (0.55 - P.happiness[i]) * 0.02; }
    s.happiness = hap / members.length;
    s.faith = faith / members.length;
    // Matchmaking: single adults of the settlement pair up over time.
    const singles = members.filter((i) => P.spouse[i] < 0 && P.age[i] >= 17 && P.age[i] <= 48);
    const men = singles.filter((i) => P.sex[i] === 1), women = singles.filter((i) => P.sex[i] === 0);
    for (const w of women) {
      if (!rng.chance(0.18 + P.social[w] * 0.2)) continue;
      const m = men.find((mm) => P.spouse[mm] < 0 && P.mother[mm] !== P.mother[w] && P.uid[mm] !== P.mother[w] && Math.abs(P.age[mm] - P.age[w]) < 14);
      if (m === undefined) continue;
      P.spouse[w] = P.uid[m];
      P.spouse[m] = P.uid[w];
      P.happiness[w] = Math.min(1, P.happiness[w] + 0.2);
      P.happiness[m] = Math.min(1, P.happiness[m] + 0.2);
    }
    // Births: couples, housing and food permitting.
    const roomy = s.pop < s.housing + 4 + (s.housing < 10 ? 14 : 0);
    const fed = s.stock[Res.Food] > s.pop * 1.2;
    if (roomy && fed) {
      for (const i of members) {
        if (P.sex[i] !== 0 || P.pregnant[i] > 0 || P.age[i] < 17 || P.age[i] > 42 || P.spouse[i] < 0) continue;
        if (P.children[i] >= 6) continue;
        if (rng.chance(0.05)) P.pregnant[i] = 300;
      }
    }
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
    // Food.
    const foodDays = s.stock[Res.Food] / Math.max(1, s.pop * 3.2);
    const hungry = foodDays < 6 ? 1.4 : foodDays < 15 ? 1 : 0.7;
    take(Job.Farmer, complete(BType.Farm) * 3);
    if (s.coastal || s.fish > 0) take(Job.Fisher, Math.max(1, adults * 0.12 * hungry) + complete(BType.Harbor) * 3);
    const game = animals.pop.reduce((a, b) => a + b, 0) > 0 ? 1 : 0;
    take(Job.Hunter, adults * 0.1 * hungry * game);
    // Materials.
    const woodNeed = s.stock[Res.Wood] < 25 + s.pop * 0.6 ? 1 : 0.3;
    take(Job.Woodcutter, Math.max(1, adults * 0.12 * woodNeed));
    if (complete(BType.Quarry)) take(Job.Quarrier, complete(BType.Quarry) * (s.stock[Res.Stone] < 40 + s.pop ? 3 : 1));
    if (complete(BType.Mine)) take(Job.Miner, complete(BType.Mine) * (s.stock[Res.Metal] < 20 + s.pop * 0.3 ? 3 : 1));
    take(Job.Scholar, complete(BType.Library) * 3 + complete(BType.Observatory) * 2);
    take(Job.Priest, complete(BType.Temple) * 2 + complete(BType.Healer));
    take(Job.Soldier, complete(BType.Barracks) * 4 + complete(BType.Tower) + (t.stats.warDays > 0 ? adults * 0.1 : 0));
    // The rest gather.
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
    const can = (type: BType) => {
      const d = BUILDINGS[type];
      return knows(d.tech) && s.tier >= d.tier && count(type) < d.max;
    };
    let pick: BType | -1 = -1;
    const foodDays = s.stock[Res.Food] / Math.max(1, s.pop * 3.2);
    if (count(BType.Storehouse) === 0) pick = BType.Storehouse;
    else if (s.housing < s.pop + 4 && can(BType.House)) pick = BType.House;
    else if (can(BType.Farm) && (foodDays < 20 || count(BType.Farm) < Math.ceil(s.pop / 9))) pick = BType.Farm;
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
    else if (can(BType.Monument) && s.id === t.capital) pick = BType.Monument;
    else if (s.housing < s.pop + 12 && can(BType.House)) pick = BType.House;
    else if (can(BType.Farm) && count(BType.Farm) < Math.ceil(s.pop / 7)) pick = BType.Farm;
    if (pick < 0) return;
    const type = pick as BType;
    const site = this.findSite(type, s, planet, rng);
    if (!site) return;
    this.addBuilding(type, s, site[0], site[1], site[2], site[3] + Math.PI / 2, tick);
  }

  private colonise(s: Settlement, members: number[], tick: number, rng: Rng, planet: Planet, animals: Animals, events: EventLog, geo: Geography): void {
    const P = this.people;
    const g = planet.region;
    // Search a ring of candidate cells around the settlement.
    let best = -1, bestScore = 0;
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
    const path = this.paths.find(s.cell, best, 'land', 4000)!;
    const pathId = this.registerPath(path);
    for (const i of group) {
      P.intent[i] = Intent.Settle;
      P.intentArg[i] = best;
      P.state[i] = PState.Travel;
      P.pathId[i] = pathId;
      P.pathPos[i] = 0;
      this.nextWaypoint(i, planet, rng);
      // Carry provisions.
      if (P.carryRes[i] < 0 && s.stock[Res.Food] > 4) { s.stock[Res.Food] -= 4; P.carryRes[i] = Res.Food; P.carryAmt[i] = 4; }
    }
    events.emit(tick, 'migration', s, 0.3, { settlement: s.name, tribe: this.tribes[s.tribe].name, count: group.length, to: geo.describe(best) });
  }

  // Path registry (paths shared by groups of travellers).
  pathTable: Int32Array[] = [];
  registerPath(path: Int32Array): number {
    this.pathTable.push(path);
    if (this.pathTable.length > 2000) this.pathTable.splice(0, 500);
    return this.pathTable.length - 1;
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
      const base = pt.adults * 0.012 * (0.6 + t.traits.curiosity);
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
          t.research[f] -= cost * 0.6;
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
}
