/**
 * People (structure-of-arrays). Every person has needs, skills, personality,
 * a family, a job, carried goods, faith (love and fear of the god) and a
 * personal memory of the god's most terrible and most wonderful acts that they
 * witnessed or were told about.
 */
import type { Rng } from '../../core/rng';
import { Job, PState } from './defs';

export const PEOPLE_CAPACITY = 9000;

export const Role = { None: 0, Chief: 1, Priest: 2, Prophet: 3, Hero: 4, Scholar: 5, Explorer: 6 } as const;
export const Intent = {
  None: 0, Eat: 1, Sleep: 2, Deliver: 3, Gather: 4, Hunt: 5, Fish: 6, Farm: 7, Chop: 8, Quarry: 9, Mine: 10,
  Fetch: 11, Build: 12, Study: 13, Pray: 14, Social: 15, Patrol: 16, Settle: 17, Trade: 18, Wander: 19, Flee: 20, March: 21, Pilgrim: 22,
} as const;

export const ROLE_NAMES = ['', 'Chief', 'High Priest', 'Prophet', 'Hero', 'Sage', 'Explorer'];

export class People {
  cap: number;
  count = 0;
  free: number[] = [];
  nextUid = 1;
  alive: Uint8Array;
  uid: Uint32Array;
  x: Float32Array; y: Float32Array; z: Float32Array;
  tx: Float32Array; ty: Float32Array; tz: Float32Array;
  state: Uint8Array;
  job: Uint8Array;
  role: Uint8Array;
  settle: Int32Array;
  tribe: Int16Array;
  home: Int32Array;
  /** Work target: building id, or -2 - cell for field work, -1 none. */
  work: Int32Array;
  age: Float32Array;
  sex: Uint8Array;
  health: Float32Array;
  hunger: Float32Array;
  energy: Float32Array;
  happiness: Float32Array;
  love: Float32Array;
  fear: Float32Array;
  /** Skills 0..1: farming, building, combat, lore. */
  skFarm: Float32Array; skBuild: Float32Array; skFight: Float32Array; skLore: Float32Array;
  /** Personality 0..1. */
  brave: Float32Array; pious: Float32Array; greedy: Float32Array; social: Float32Array; curious: Float32Array;
  mother: Int32Array; father: Int32Array; spouse: Int32Array;
  children: Uint8Array;
  pregnant: Float32Array;
  carryRes: Int8Array;
  carryAmt: Float32Array;
  timer: Int16Array;
  /** What to do on arrival (Intent) and its argument (building, cell, animal slot...). */
  intent: Uint8Array;
  intentArg: Int32Array;
  /** Path following: path id (cache key index) and position along it. */
  pathId: Int32Array;
  pathPos: Int16Array;
  /** Index into the civ's god-memory table (-1 none): worst and best acts. */
  worstMem: Int32Array;
  bestMem: Int32Array;
  army: Int32Array;
  generation: Uint16Array;
  kills: Uint16Array;
  born: Int32Array;
  /** Days of active infection (0 = healthy). */
  sick: Float32Array;
  /** 1 after surviving the plague (or a divine cure). */
  immune: Uint8Array;
  /** Tick until which this person is recovering from resurrection (glow). */
  returned: Int32Array;
  /** 1 while travelling by ship. */
  vessel: Uint8Array;
  /** Slot of each uid (for fast lookup of family members). */
  slotOfUid = new Map<number, number>();

  constructor(cap = PEOPLE_CAPACITY) {
    this.cap = cap;
    this.alive = new Uint8Array(cap);
    this.uid = new Uint32Array(cap);
    this.x = new Float32Array(cap); this.y = new Float32Array(cap); this.z = new Float32Array(cap);
    this.tx = new Float32Array(cap); this.ty = new Float32Array(cap); this.tz = new Float32Array(cap);
    this.state = new Uint8Array(cap);
    this.job = new Uint8Array(cap);
    this.role = new Uint8Array(cap);
    this.settle = new Int32Array(cap).fill(-1);
    this.tribe = new Int16Array(cap).fill(-1);
    this.home = new Int32Array(cap).fill(-1);
    this.work = new Int32Array(cap).fill(-1);
    this.age = new Float32Array(cap);
    this.sex = new Uint8Array(cap);
    this.health = new Float32Array(cap);
    this.hunger = new Float32Array(cap);
    this.energy = new Float32Array(cap);
    this.happiness = new Float32Array(cap);
    this.love = new Float32Array(cap);
    this.fear = new Float32Array(cap);
    this.skFarm = new Float32Array(cap); this.skBuild = new Float32Array(cap); this.skFight = new Float32Array(cap); this.skLore = new Float32Array(cap);
    this.brave = new Float32Array(cap); this.pious = new Float32Array(cap); this.greedy = new Float32Array(cap); this.social = new Float32Array(cap); this.curious = new Float32Array(cap);
    this.mother = new Int32Array(cap).fill(-1);
    this.father = new Int32Array(cap).fill(-1);
    this.spouse = new Int32Array(cap).fill(-1);
    this.children = new Uint8Array(cap);
    this.pregnant = new Float32Array(cap);
    this.carryRes = new Int8Array(cap).fill(-1);
    this.carryAmt = new Float32Array(cap);
    this.timer = new Int16Array(cap);
    this.intent = new Uint8Array(cap);
    this.intentArg = new Int32Array(cap).fill(-1);
    this.pathId = new Int32Array(cap).fill(-1);
    this.pathPos = new Int16Array(cap);
    this.worstMem = new Int32Array(cap).fill(-1);
    this.bestMem = new Int32Array(cap).fill(-1);
    this.army = new Int32Array(cap).fill(-1);
    this.generation = new Uint16Array(cap);
    this.kills = new Uint16Array(cap);
    this.born = new Int32Array(cap);
    this.sick = new Float32Array(cap);
    this.immune = new Uint8Array(cap);
    this.returned = new Int32Array(cap);
    this.vessel = new Uint8Array(cap);
  }

  spawn(rng: Rng, tick: number, x: number, y: number, z: number, tribe: number, settle: number, age: number, parents: [number, number] | null): number {
    let i: number;
    if (this.free.length) i = this.free.pop()!;
    else if (this.count < this.cap) i = this.count++;
    else return -1;
    this.alive[i] = 1;
    const uid = this.nextUid++;
    this.uid[i] = uid;
    this.slotOfUid.set(uid, i);
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.tx[i] = x; this.ty[i] = y; this.tz[i] = z;
    this.state[i] = PState.Idle;
    this.job[i] = age < 14 ? Job.Child : Job.None;
    this.role[i] = 0;
    this.settle[i] = settle;
    this.tribe[i] = tribe;
    this.home[i] = -1;
    this.work[i] = -1;
    this.age[i] = age;
    this.sex[i] = rng.chance(0.5) ? 1 : 0;
    this.health[i] = 1;
    this.hunger[i] = rng.range(0.1, 0.35);
    this.energy[i] = rng.range(0.6, 1);
    this.happiness[i] = 0.6;
    this.skFarm[i] = rng.range(0, 0.3); this.skBuild[i] = rng.range(0, 0.3); this.skFight[i] = rng.range(0, 0.3); this.skLore[i] = rng.range(0, 0.3);
    const inherit = (a: Float32Array, pa: number, pb: number) => (pa >= 0 && pb >= 0 ? Math.min(1, Math.max(0, (a[pa] + a[pb]) / 2 + rng.gauss() * 0.15)) : rng.float());
    const pa = parents ? this.slotOfUid.get(parents[0]) ?? -1 : -1;
    const pb = parents ? this.slotOfUid.get(parents[1]) ?? -1 : -1;
    this.brave[i] = inherit(this.brave, pa, pb);
    this.pious[i] = inherit(this.pious, pa, pb);
    this.greedy[i] = inherit(this.greedy, pa, pb);
    this.social[i] = inherit(this.social, pa, pb);
    this.curious[i] = inherit(this.curious, pa, pb);
    this.love[i] = pa >= 0 ? this.love[pa] * 0.8 : 0.15;
    this.fear[i] = pa >= 0 ? this.fear[pa] * 0.7 : 0.05;
    this.mother[i] = parents ? parents[0] : -1;
    this.father[i] = parents ? parents[1] : -1;
    this.spouse[i] = -1;
    this.children[i] = 0;
    this.pregnant[i] = 0;
    this.carryRes[i] = -1;
    this.carryAmt[i] = 0;
    this.timer[i] = rng.int(0, 20);
    this.intent[i] = 0;
    this.intentArg[i] = -1;
    this.pathId[i] = -1;
    this.pathPos[i] = 0;
    // Children inherit their mother's memories of the god, as stories.
    this.worstMem[i] = pa >= 0 ? this.worstMem[pa] : -1;
    this.bestMem[i] = pa >= 0 ? this.bestMem[pa] : -1;
    this.army[i] = -1;
    this.generation[i] = pa >= 0 ? this.generation[pa] + 1 : 0;
    this.kills[i] = 0;
    this.born[i] = tick;
    this.sick[i] = 0;
    this.immune[i] = 0;
    this.returned[i] = 0;
    this.vessel[i] = 0;
    return i;
  }

  /** Give slot i a specific uid (resurrection keeps a person's identity). */
  assignUid(i: number, uid: number): void {
    this.slotOfUid.delete(this.uid[i]);
    this.uid[i] = uid;
    this.slotOfUid.set(uid, i);
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.slotOfUid.delete(this.uid[i]);
    this.free.push(i);
  }

  slot(uid: number): number {
    return this.slotOfUid.get(uid) ?? -1;
  }

  /** Rebuild the uid index after deserialisation (free list is serialised). */
  rebuildIndex(): void {
    this.slotOfUid.clear();
    for (let i = 0; i < this.count; i++) if (this.alive[i]) this.slotOfUid.set(this.uid[i], i);
  }
}
