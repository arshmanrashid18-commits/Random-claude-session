/**
 * Society: everything that happens *between* settlements and tribes.
 *
 *  - Diplomacy: contact, opinion, trade pacts, alliances, betrayals, wars
 *    and peace — driven by borders, faith, history, traits and the god.
 *  - War: armies muster from soldiers and militia, march along real paths,
 *    fight person-to-person battles, besiege walls, conquer settlements;
 *    the conquered assimilate or flee as refugees.
 *  - Trade: caravans (and ships between harbours) physically carry goods
 *    between settlements; internal routes relieve famine, foreign routes
 *    exchange surpluses. Sick travellers carry plague along the roads.
 *  - Religion: prophets preach and travel, pilgrims visit sacred sites,
 *    tenets evolve with the god's deeds, distant congregations schism.
 *
 * All state is plain data (serialisable); all randomness uses the world RNG.
 */
import type { Rng } from '../../core/rng';
import type { Civ, Settlement } from './civ';
import type { Planet } from '../planet/planet';
import type { EventLog } from '../events';
import type { Geography } from '../planet/geography';
import type { Concept } from '../../core/language';
import { Language } from '../../core/language';
import { BType, Job, PState, Res, RES_COUNT } from './defs';
import { Intent } from './people';
import { TECH_INDEX } from './tech';
import { PLANET_RADIUS, TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants';
import { offsetDir } from '../move';
import { createTribe } from './tribes';

const INV_R = 1 / PLANET_RADIUS;

export type WarCause = 'border' | 'holy' | 'revenge' | 'conquest' | 'betrayal' | 'alliance' | 'rebellion';

export interface War {
  id: number;
  a: number; // aggressor tribe
  b: number; // defender tribe
  start: number;
  end: number; // -1 while active
  cause: WarCause;
  deaths: [number, number];
  conquests: [number, number];
}

export interface Army {
  id: number;
  tribe: number;
  war: number;
  from: number; // settlement
  target: number; // settlement
  members: number[]; // person uids
  stage: 0 | 1 | 2 | 3; // 0 muster, 1 march, 2 battle/siege, 3 return
  start: number;
  pathId: number;
  stageTick: number;
}

export interface TradeRoute {
  id: number;
  a: number; // settlement
  b: number;
  mode: 'land' | 'sea';
  foreign: boolean;
  established: number;
  lastTrip: number;
  trips: number;
  /** Goods moved in each direction (for statistics). */
  moved: number;
  alive: boolean;
}

/** What each divine act teaches a religion. */
const DEED_TENETS: Record<string, Concept[]> = {
  lightning: ['storm', 'sky'], rain: ['water', 'sky'], mercy: ['water', 'life'], drought: ['sun', 'fire'], fire: ['fire'],
  earthquake: ['earth', 'stone'], volcano: ['fire', 'mountain'], tsunami: ['sea', 'death'], meteor: ['star', 'fire'],
  bloom: ['life', 'harvest'], blessing: ['life', 'hand'], cure: ['life', 'hand'], plague: ['death', 'blood'],
  resurrection: ['life', 'death'], locusts: ['harvest', 'death'], inspiration: ['dream', 'eye'], vision: ['voice', 'dream'],
  harmony: ['peace'], beacon: ['light'], eclipse: ['dark', 'moon'], grove: ['forest', 'life'],
};

const EPITHETS: Partial<Record<Concept, [string, string]>> = {
  storm: ['the Thunderer', 'Lord of Storms'], sky: ['the Sky-Father', 'Who Dwells Above'], water: ['the Rain-Giver', 'Giver of Rain'],
  sun: ['the Burning Eye', 'Lord of the Sun'], fire: ['the Flame', 'Lord of Fire'], earth: ['the Shaker', 'Who Moves the Earth'],
  stone: ['the Unmoved', 'the Stone'], mountain: ['the Mountain', 'Who Sleeps Beneath'], sea: ['the Deep', 'Lord of Waves'],
  death: ['the Reaper', 'Keeper of the Dead'], star: ['the Star-Caller', 'Who Throws Stars'], life: ['the Mother', 'Giver of Life'],
  harvest: ['the Sower', 'Lord of the Harvest'], hand: ['the Healer', 'the Open Hand'], blood: ['the Hungry', 'Drinker of Blood'],
  dream: ['the Dreamer', 'Who Whispers'], eye: ['the Watcher', 'the Eye'], voice: ['the Voice', 'Who Speaks'],
  peace: ['the Peacemaker', 'the Quiet One'], light: ['the Lamp', 'Bringer of Light'], dark: ['the Devourer of Suns', 'the Dark'],
  moon: ['the Moon', 'the Pale One'], forest: ['the Green', 'Lord of the Forest'], ice: ['the White', 'the Frost'],
  wind: ['the Wind', 'the Breath'], river: ['the River', 'the Flowing'], spirit: ['the Spirit', 'the Unseen'],
};

export class Society {
  /** Opinion between tribes (−1 hatred .. 1 friendship). */
  rel: number[][] = [];
  contact: boolean[][] = [];
  /** 0 none, 1 trade pact, 2 alliance. */
  pact: number[][] = [];
  /** Lingering resentment from past wars (decays). */
  grudge: number[][] = [];
  wars: War[] = [];
  armies: Army[] = [];
  routes: TradeRoute[] = [];
  private nextId = 1;

  // ------------------------------------------------------------------ bookkeeping
  ensure(n: number): void {
    const grow = (m: number[][] | boolean[][], v: number | boolean) => {
      while (m.length < n) (m as unknown[][]).push([]);
      for (const row of m as unknown[][]) while (row.length < n) row.push(v);
    };
    grow(this.rel, 0);
    grow(this.contact, false);
    grow(this.pact, 0);
    grow(this.grudge, 0);
  }

  atWar(a: number, b: number): War | null {
    for (const w of this.wars) if (w.end < 0 && ((w.a === a && w.b === b) || (w.a === b && w.b === a))) return w;
    return null;
  }

  enemies(t: number): number[] {
    const out: number[] = [];
    for (const w of this.wars) if (w.end < 0) { if (w.a === t) out.push(w.b); else if (w.b === t) out.push(w.a); }
    return out;
  }

  // ------------------------------------------------------------------ tick
  tick(civ: Civ, tick: number, rng: Rng, planet: Planet, events: EventLog, geo: Geography): void {
    this.ensure(civ.tribes.length);
    if (tick % TICKS_PER_DAY === 61) this.daily(civ, tick, rng, planet, events, geo);
    if (tick % 20 === 7) this.updateArmies(civ, tick, rng, planet, events, geo);
    if (tick % 2 === 0) this.combat(civ, tick, rng, events);
    if (tick % 40 === 23) this.updateTrade(civ, tick, rng, planet, events);
    if (tick % 32 === 11) this.preach(civ, tick, rng);
  }

  private daily(civ: Civ, tick: number, rng: Rng, planet: Planet, events: EventLog, geo: Geography): void {
    const T = civ.tribes;
    const n = T.length;
    // Territory friction: count adjacent cells owned by different tribes.
    const friction: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = planet.region;
    for (let c = 0; c < civ.owner.length; c += 1) {
      const o = civ.owner[c];
      if (o < 0) continue;
      const ta = civ.settlements[o].tribe;
      for (let k = 0; k < 4; k++) {
        const nb = g.neighbors[c * 8 + k];
        const o2 = civ.owner[nb];
        if (o2 < 0) continue;
        const tb = civ.settlements[o2].tribe;
        if (tb !== ta) friction[ta][tb]++;
      }
    }
    for (let a = 0; a < n; a++) {
      if (!T[a].alive) continue;
      for (let b = a + 1; b < n; b++) {
        if (!T[b].alive) continue;
        // First contact.
        if (!this.contact[a][b]) {
          const d = this.tribeDistance(civ, a, b);
          if (d < 700) {
            this.contact[a][b] = this.contact[b][a] = true;
            const sa = civ.settlements[T[a].capital];
            events.emit(tick, 'first-contact', sa ?? null, 0.6, { a: T[a].name, b: T[b].name });
            this.rel[a][b] = this.rel[b][a] = (T[a].traits.honor + T[b].traits.honor) * 0.2 - (T[a].traits.aggression + T[b].traits.aggression) * 0.15;
          } else continue;
        }
        // Opinion drift.
        const sameFaith = T[a].religion.name === T[b].religion.name;
        const fervor = (T[a].religion.fear + T[b].religion.fear) * 0.5;
        const target = (T[a].traits.honor + T[b].traits.honor - T[a].traits.aggression - T[b].traits.aggression) * 0.2
          + (this.pact[a][b] === 1 ? 0.3 : this.pact[a][b] === 2 ? 0.5 : 0)
          + (sameFaith ? 0.25 : -0.15 - fervor * 0.35)
          - Math.min(0.5, (friction[a][b] + friction[b][a]) * 0.012)
          - this.grudge[a][b];
        const r = this.rel[a][b] + (target - this.rel[a][b]) * 0.04 + rng.range(-0.03, 0.03);
        this.rel[a][b] = this.rel[b][a] = Math.max(-1, Math.min(1, r));
        this.grudge[a][b] = this.grudge[b][a] = this.grudge[a][b] * 0.995;
        const war = this.atWar(a, b);
        if (war) {
          this.considerPeace(civ, war, tick, rng, events);
          continue;
        }
        // Pacts.
        const canTrade = T[a].known[TECH_INDEX.get('trade')!] && T[b].known[TECH_INDEX.get('trade')!];
        if (this.pact[a][b] === 0 && canTrade && this.rel[a][b] > 0.15 && rng.chance(0.05)) {
          this.pact[a][b] = this.pact[b][a] = 1;
          events.emit(tick, 'trade-route', civ.settlements[T[a].capital] ?? null, 0.5, { a: T[a].name, b: T[b].name, pact: 1 });
          this.openForeignRoute(civ, a, b, tick, planet, events);
        }
        if (this.pact[a][b] === 1 && this.rel[a][b] > 0.55 && rng.chance(0.02)) {
          this.pact[a][b] = this.pact[b][a] = 2;
          events.emit(tick, 'alliance', civ.settlements[T[a].capital] ?? null, 0.65, { a: T[a].name, b: T[b].name });
        }
        if (this.pact[a][b] > 0 && this.rel[a][b] < -0.1) {
          const was = this.pact[a][b];
          this.pact[a][b] = this.pact[b][a] = 0;
          if (was === 2) {
            // Betrayal: the less honourable ally strikes.
            const traitor = T[a].traits.honor < T[b].traits.honor ? a : b;
            const victim = traitor === a ? b : a;
            if (T[traitor].traits.honor < 0.4 && rng.chance(0.5)) {
              events.emit(tick, 'betrayal', civ.settlements[T[traitor].capital] ?? null, 0.8, { traitor: T[traitor].name, victim: T[victim].name });
              this.declareWar(civ, traitor, victim, 'betrayal', tick, events);
              continue;
            }
          }
          for (const rt of this.routes) if (rt.foreign && rt.alive && ((civ.settlements[rt.a].tribe === a && civ.settlements[rt.b].tribe === b) || (civ.settlements[rt.a].tribe === b && civ.settlements[rt.b].tribe === a))) rt.alive = false;
        }
        // War.
        this.considerWar(civ, a, b, friction, tick, rng, events);
      }
    }
    this.religionDaily(civ, tick, rng, planet, events, geo);
    this.planRoutes(civ, tick, planet);
  }

  private tribeDistance(civ: Civ, a: number, b: number): number {
    let best = Infinity;
    for (const ia of civ.tribes[a].settlements) {
      const sa = civ.settlements[ia];
      if (!sa.alive) continue;
      for (const ib of civ.tribes[b].settlements) {
        const sb = civ.settlements[ib];
        if (!sb.alive) continue;
        best = Math.min(best, Math.acos(Math.min(1, sa.x * sb.x + sa.y * sb.y + sa.z * sb.z)) * PLANET_RADIUS);
      }
    }
    return best;
  }

  strength(civ: Civ, t: number): number {
    const P = civ.people;
    const tr = civ.tribes[t];
    const weapons = 1 + (tr.known[TECH_INDEX.get('bronze')!] ? 0.3 : 0) + (tr.known[TECH_INDEX.get('ironworking')!] ? 0.4 : 0) + (tr.known[TECH_INDEX.get('warfare')!] ? 0.3 : 0);
    let s = 0;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.tribe[i] !== t || P.age[i] < 16 || P.age[i] > 55) continue;
      s += P.job[i] === Job.Soldier ? 2 + P.skFight[i] * 2 : P.sex[i] === 1 ? 0.5 + P.skFight[i] : 0.1;
    }
    return s * weapons;
  }

  private considerWar(civ: Civ, a: number, b: number, friction: number[][], tick: number, rng: Rng, events: EventLog): void {
    const T = civ.tribes;
    if (this.rel[a][b] > -0.3) return;
    // Who would strike first?
    const sa = this.strength(civ, a), sb = this.strength(civ, b);
    for (const [x, y, sx, sy] of [[a, b, sa, sb], [b, a, sb, sa]] as const) {
      const tx = T[x];
      const ratio = sx / Math.max(1, sy);
      const p = 0.012 * tx.traits.aggression * Math.min(2.5, ratio) * (-this.rel[x][y]);
      if (ratio < 0.7 || !rng.chance(p)) continue;
      // Why?
      let cause: WarCause = 'border';
      const holySite = T[x].religion.sacredSites.some((site) => {
        const c = civ.cellOfDir(site.x, site.y, site.z);
        const o = civ.owner[c];
        return o >= 0 && civ.settlements[o].tribe === y;
      });
      if (T[x].religion.name !== T[y].religion.name && (holySite || T[x].religion.fear > 0.45)) cause = 'holy';
      else if (this.grudge[x][y] > 0.2) cause = 'revenge';
      else if (friction[x][y] + friction[y][x] < 3) cause = 'conquest';
      this.declareWar(civ, x, y, cause, tick, events);
      return;
    }
  }

  declareWar(civ: Civ, a: number, b: number, cause: WarCause, tick: number, events: EventLog): War {
    const w: War = { id: this.nextId++, a, b, start: tick, end: -1, cause, deaths: [0, 0], conquests: [0, 0] };
    this.wars.push(w);
    this.pact[a][b] = this.pact[b][a] = 0;
    this.rel[a][b] = this.rel[b][a] = Math.min(this.rel[a][b], -0.5);
    const T = civ.tribes;
    events.emit(tick, cause === 'holy' ? 'holy-war' : 'war', civ.settlements[T[a].capital] ?? null, 0.85, { a: T[a].name, b: T[b].name, cause });
    // Allies of the defender answer the call.
    for (let c = 0; c < T.length; c++) {
      if (c === a || c === b || !T[c].alive) continue;
      if (this.pact[b][c] === 2 && !this.atWar(c, a)) {
        const w2: War = { id: this.nextId++, a: c, b: a, start: tick, end: -1, cause: 'alliance', deaths: [0, 0], conquests: [0, 0] };
        this.wars.push(w2);
        events.emit(tick, 'war', civ.settlements[T[c].capital] ?? null, 0.6, { a: T[c].name, b: T[a].name, cause: 'alliance' });
      }
    }
    return w;
  }

  private considerPeace(civ: Civ, w: War, tick: number, rng: Rng, events: EventLog): void {
    const T = civ.tribes;
    const years = (tick - w.start) / TICKS_PER_YEAR;
    const popA = Math.max(1, T[w.a].population), popB = Math.max(1, T[w.b].population);
    const exhaustion = w.deaths[0] / popA + w.deaths[1] / popB + years * 0.15 + (w.conquests[0] + w.conquests[1]) * 0.2;
    if (rng.chance(Math.min(0.2, exhaustion * 0.05 * (T[w.a].traits.honor + T[w.b].traits.honor)))) this.endWar(civ, w, tick, events, 'peace');
  }

  endWar(civ: Civ, w: War, tick: number, events: EventLog, how: 'peace' | 'truce' | 'destroyed'): void {
    if (w.end >= 0) return;
    w.end = tick;
    const T = civ.tribes;
    this.grudge[w.a][w.b] = this.grudge[w.b][w.a] = Math.min(0.8, this.grudge[w.a][w.b] + 0.1 + (w.deaths[0] + w.deaths[1]) * 0.005);
    this.rel[w.a][w.b] = this.rel[w.b][w.a] = Math.max(this.rel[w.a][w.b], how === 'truce' ? 0.1 : -0.15);
    if (how !== 'destroyed') events.emit(tick, 'peace', civ.settlements[T[w.a].capital] ?? null, 0.7, { a: T[w.a].name, b: T[w.b].name, how, deaths: w.deaths[0] + w.deaths[1] });
    // Armies go home.
    for (const ar of this.armies) if (ar.war === w.id && ar.stage < 3) this.sendHome(civ, ar, tick);
  }

  /** Harmony: every war among these tribes ends in truce. Returns wars ended. */
  truce(civ: Civ, tribes: number[], tick: number, events: EventLog): number {
    const set = new Set(tribes);
    let n = 0;
    for (const w of this.wars) {
      if (w.end >= 0) continue;
      if (set.has(w.a) || set.has(w.b)) { this.endWar(civ, w, tick, events, 'truce'); n++; }
    }
    for (const a of tribes) for (const b of tribes) if (a !== b) { this.grudge[a][b] *= 0.3; this.rel[a][b] = Math.max(this.rel[a][b], 0.2); }
    return n;
  }

  // ------------------------------------------------------------------ armies
  private updateArmies(civ: Civ, tick: number, rng: Rng, planet: Planet, events: EventLog, geo: Geography): void {
    const P = civ.people;
    // Raise new armies for active wars.
    for (const w of this.wars) {
      if (w.end >= 0) continue;
      if (!civ.tribes[w.a].alive || !civ.tribes[w.b].alive) { this.endWar(civ, w, tick, events, 'destroyed'); continue; }
      for (const [att, def] of [[w.a, w.b], [w.b, w.a]] as const) {
        if (this.armies.some((ar) => ar.war === w.id && ar.tribe === att && ar.stage < 3)) continue;
        // The aggressor attacks; the defender counter-attacks once it is the stronger.
        if (att === w.b && this.strength(civ, w.b) < this.strength(civ, w.a) * 1.3) continue;
        if (!rng.chance(0.25)) continue;
        this.raiseArmy(civ, w, att, def, tick, rng, planet, events);
      }
    }
    for (const ar of this.armies) {
      if (ar.stage === 3 && tick - ar.stageTick > TICKS_PER_DAY * 2) { this.disband(civ, ar); continue; }
      const members = ar.members.map((u) => P.slot(u)).filter((i) => i >= 0);
      ar.members = members.map((i) => P.uid[i]);
      if (members.length === 0) { ar.stage = 3; ar.members = []; continue; }
      const target = civ.settlements[ar.target];
      if (ar.stage === 0 && tick - ar.stageTick > 60) {
        // March.
        ar.stage = 1;
        ar.stageTick = tick;
        for (const i of members) {
          P.intent[i] = Intent.March;
          P.state[i] = PState.March;
          P.pathId[i] = ar.pathId;
          P.pathPos[i] = 0;
          civ.nextWaypoint(i, planet, rng);
        }
        events.emit(tick, 'battle', civ.settlements[ar.from] ?? null, 0.45, { stage: 'march', a: civ.tribes[ar.tribe].name, target: target.name, size: members.length });
      } else if (ar.stage === 1 || ar.stage === 2) {
        if (!target.alive || target.tribe === ar.tribe) { this.sendHome(civ, ar, tick); continue; }
        // Arrived when most members are near the target.
        let near = 0;
        for (const i of members) if (this.distTo(P.x[i], P.y[i], P.z[i], target) < target.radius + 20) near++;
        if (ar.stage === 1 && near >= members.length * 0.5) {
          ar.stage = 2;
          ar.stageTick = tick;
          events.emit(tick, target.walls ? 'siege' : 'battle', target, 0.75, { a: civ.tribes[ar.tribe].name, b: civ.tribes[target.tribe].name, settlement: target.name, size: members.length, where: geo.describe(target.cell) });
        }
        if (ar.stage === 2) {
          // Advance on the heart of the settlement; attack walls in the way.
          for (const i of members) {
            if (P.state[i] === PState.Fight) continue;
            const off = rng.range(0, Math.PI * 2);
            const r = target.walls && !this.breached(civ, target) ? target.radius * 0.95 : rng.range(0, target.radius * 0.4);
            offsetDir(target.x, target.y, target.z, Math.cos(off) * r * INV_R, Math.sin(off) * r * INV_R, civ.scratchDir);
            P.tx[i] = civ.scratchDir[0]; P.ty[i] = civ.scratchDir[1]; P.tz[i] = civ.scratchDir[2];
            P.state[i] = PState.March;
            P.intent[i] = Intent.March;
            P.pathId[i] = -1;
          }
          if (target.walls) this.siegeDamage(civ, ar, members, target, rng);
          this.checkConquest(civ, ar, members, target, tick, rng, planet, events);
          // Give up after a long failed siege or heavy losses.
          if (tick - ar.stageTick > TICKS_PER_DAY * 6) this.sendHome(civ, ar, tick);
        }
      }
    }
    this.armies = this.armies.filter((ar) => !(ar.stage === 3 && ar.members.length === 0));
  }

  private distTo(x: number, y: number, z: number, s: { x: number; y: number; z: number }): number {
    return Math.acos(Math.min(1, x * s.x + y * s.y + z * s.z)) * PLANET_RADIUS;
  }

  private raiseArmy(civ: Civ, w: War, att: number, def: number, tick: number, rng: Rng, planet: Planet, events: EventLog): void {
    const T = civ.tribes;
    // Nearest pair of settlements.
    let from: Settlement | null = null, to: Settlement | null = null, best = Infinity;
    for (const ia of T[att].settlements) {
      const sa = civ.settlements[ia];
      if (!sa.alive || sa.pop < 10) continue;
      for (const ib of T[def].settlements) {
        const sb = civ.settlements[ib];
        if (!sb.alive) continue;
        const d = this.distTo(sa.x, sa.y, sa.z, sb);
        if (d < best) { best = d; from = sa; to = sb; }
      }
    }
    if (!from || !to || best > 1100) return;
    const path = civ.paths.find(from.cell, to.cell, 'land', 8000);
    if (!path) return;
    const P = civ.people;
    const members: number[] = [];
    const soldiers: number[] = [], militia: number[] = [];
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.settle[i] !== from.id || P.army[i] >= 0 || P.age[i] < 16 || P.age[i] > 50) continue;
      if (P.role[i] === 1 || P.role[i] === 3) continue;
      if (P.job[i] === Job.Soldier) soldiers.push(i);
      else if (P.sex[i] === 1 && (P.job[i] === Job.Hunter || P.brave[i] > 0.5)) militia.push(i);
    }
    members.push(...soldiers);
    for (const i of militia) { if (members.length >= Math.max(6, soldiers.length + from.pop * 0.18)) break; members.push(i); }
    if (members.length < 4) return;
    const ar: Army = { id: this.nextId++, tribe: att, war: w.id, from: from.id, target: to.id, members: members.map((i) => P.uid[i]), stage: 0, start: tick, pathId: civ.registerPath(path), stageTick: tick };
    this.armies.push(ar);
    for (const i of members) {
      P.army[i] = ar.id;
      P.carryRes[i] >= 0 && this.dropCarry(civ, i, from);
      civ.goTo(i, from.x, from.y, from.z, 4, PState.Walk, Intent.March, -1, rng);
    }
    events.emit(tick, 'battle', from, 0.5, { stage: 'muster', a: T[att].name, b: T[def].name, target: to.name, size: members.length });
    void planet;
  }

  private dropCarry(civ: Civ, i: number, s: Settlement): void {
    const P = civ.people;
    if (P.carryRes[i] >= 0) { s.stock[P.carryRes[i]] += P.carryAmt[i]; P.carryRes[i] = -1; P.carryAmt[i] = 0; }
  }

  private sendHome(civ: Civ, ar: Army, tick: number): void {
    ar.stage = 3;
    ar.stageTick = tick;
    const P = civ.people;
    const home = civ.settlements[ar.from];
    for (const u of ar.members) {
      const i = P.slot(u);
      if (i < 0) continue;
      P.army[i] = -1;
      P.pathId[i] = -1;
      if (home && home.alive && P.tribe[i] === home.tribe) {
        P.settle[i] = home.id;
        civ.goTo(i, home.x, home.y, home.z, 6, PState.Walk, Intent.Wander, -1, civ.rngRef!);
      } else {
        P.state[i] = PState.Idle; P.intent[i] = 0;
      }
    }
  }

  private disband(civ: Civ, ar: Army): void {
    const P = civ.people;
    for (const u of ar.members) { const i = P.slot(u); if (i >= 0) P.army[i] = -1; }
    ar.members = [];
  }

  private breached(civ: Civ, s: Settlement): boolean {
    let walls = 0, standing = 0;
    for (const id of s.buildings) {
      const b = civ.buildings[id];
      if (b.type !== BType.Wall && b.type !== BType.Tower) continue;
      walls++;
      if (!b.ruin && b.complete) standing++;
    }
    return walls === 0 || standing < walls * 0.75;
  }

  private siegeDamage(civ: Civ, ar: Army, members: number[], s: Settlement, rng: Rng): void {
    const P = civ.people;
    const siegeTech = civ.tribes[ar.tribe].known[TECH_INDEX.get('engineering')!] ? 2 : 1;
    for (const id of s.buildings) {
      const b = civ.buildings[id];
      if (b.ruin || (b.type !== BType.Wall && b.type !== BType.Tower)) continue;
      let close = 0;
      for (const i of members) {
        const dx = P.x[i] - b.x, dy = P.y[i] - b.y, dz = P.z[i] - b.z;
        if (dx * dx + dy * dy + dz * dz < (6 * INV_R) ** 2) close++;
      }
      if (close > 0) {
        b.hp -= 0.012 * close * siegeTech * rng.range(0.5, 1.5);
        if (b.hp <= 0) civ.ruinBuilding(b);
      }
    }
  }

  private checkConquest(civ: Civ, ar: Army, members: number[], s: Settlement, tick: number, rng: Rng, planet: Planet, events: EventLog): void {
    const P = civ.people;
    let inside = 0;
    for (const i of members) if (this.distTo(P.x[i], P.y[i], P.z[i], s) < s.radius * 0.5) inside++;
    if (inside < 3) return;
    // Any defenders still able to fight?
    let defenders = 0;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.tribe[i] !== s.tribe || P.age[i] < 16) continue;
      if (P.job[i] !== Job.Soldier && !(P.sex[i] === 1 && P.age[i] < 50)) continue;
      if (this.distTo(P.x[i], P.y[i], P.z[i], s) < s.radius) defenders++;
    }
    if (defenders > inside * 0.3) return;
    this.conquer(civ, ar, s, tick, rng, planet, events);
  }

  private conquer(civ: Civ, ar: Army, s: Settlement, tick: number, rng: Rng, planet: Planet, events: EventLog): void {
    const T = civ.tribes;
    const loser = s.tribe, winner = ar.tribe;
    const w = this.wars.find((x) => x.id === ar.war);
    if (w) w.conquests[w.a === winner ? 0 : 1]++;
    const P = civ.people;
    // Refugees flee to the nearest settlement of their own people.
    let refuge: Settlement | null = null, best = Infinity;
    for (const id of T[loser].settlements) {
      const o = civ.settlements[id];
      if (!o.alive || o.id === s.id) continue;
      const d = this.distTo(s.x, s.y, s.z, o);
      if (d < best) { best = d; refuge = o; }
    }
    const path = refuge ? civ.paths.find(s.cell, refuge.cell, 'land', 8000) : null;
    const pathId = path ? civ.registerPath(path) : -1;
    let fled = 0, stayed = 0;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.settle[i] !== s.id || P.tribe[i] !== loser) continue;
      if (refuge && pathId >= 0 && (P.job[i] === Job.Soldier || rng.chance(0.45))) {
        this.dropCarry(civ, i, s);
        P.intent[i] = Intent.Settle;
        P.intentArg[i] = refuge.cell;
        P.state[i] = PState.Travel;
        P.pathId[i] = pathId;
        P.pathPos[i] = 0;
        P.home[i] = -1;
        civ.nextWaypoint(i, planet, rng);
        fled++;
      } else {
        // Assimilated: they now serve the conqueror (and fear their god).
        P.tribe[i] = winner;
        P.fear[i] = Math.min(1, P.fear[i] + 0.1);
        P.happiness[i] = Math.max(0, P.happiness[i] - 0.3);
        if (P.job[i] === Job.Soldier) P.job[i] = Job.None;
        if (P.role[i] === 1) P.role[i] = 0;
        stayed++;
      }
    }
    // The settlement changes hands.
    T[loser].settlements = T[loser].settlements.filter((id) => id !== s.id);
    if (T[loser].capital === s.id) T[loser].capital = T[loser].settlements.find((id) => civ.settlements[id].alive) ?? -1;
    s.tribe = winner;
    s.capturedFrom = loser;
    T[winner].settlements.push(s.id);
    for (const id of s.buildings) civ.buildings[id].tribe = winner;
    civ.version++;
    events.emit(tick, 'conquest', s, 0.9, { settlement: s.name, winner: T[winner].name, loser: T[loser].name, fled, stayed });
    if (fled > 0 && refuge) events.emit(tick, 'refugees', refuge, 0.55, { count: fled, from: s.name, to: refuge.name, tribe: T[loser].name });
    // Soldiers settle into the conquered town.
    for (const u of ar.members) {
      const i = P.slot(u);
      if (i < 0) continue;
      P.army[i] = -1;
    }
    ar.stage = 3;
    ar.stageTick = tick;
    ar.members = [];
    if (T[loser].capital < 0) {
      T[loser].alive = false;
      events.emit(tick, 'conquest', s, 1, { settlement: s.name, winner: T[winner].name, loser: T[loser].name, destroyed: 1 });
      for (const x of this.wars) if (x.end < 0 && (x.a === loser || x.b === loser)) this.endWar(civ, x, tick, events, 'destroyed');
    }
  }

  /** Person-to-person combat between enemies sharing ground. */
  private combat(civ: Civ, tick: number, rng: Rng, events: EventLog): void {
    if (this.armies.length === 0) return;
    const P = civ.people;
    const hs = civ.hash;
    const T = civ.tribes;
    const weapon = (t: number) => {
      const k = T[t].known;
      return 0.2 + (k[TECH_INDEX.get('bronze')!] ? 0.25 : 0) + (k[TECH_INDEX.get('ironworking')!] ? 0.35 : 0) + (k[TECH_INDEX.get('warfare')!] ? 0.2 : 0) + (k[TECH_INDEX.get('gunpowder')!] ? 0.6 : 0);
    };
    for (const ar of this.armies) {
      if (ar.stage !== 1 && ar.stage !== 2) continue;
      for (const u of ar.members) {
        const i = P.slot(u);
        if (i < 0) continue;
        const b = hs.bucketOf[i];
        if (b < 0) continue;
        // Nearest enemy combatant in this cell.
        let foe = -1, bestD = (3 * INV_R) ** 2;
        for (let q = hs.cellStart[b], qe = hs.cellStart[b + 1]; q < qe; q++) {
          const j = hs.items[q];
          if (!P.alive[j] || P.tribe[j] === P.tribe[i] || P.age[j] < 14) continue;
          if (!this.atWar(P.tribe[i], P.tribe[j])) continue;
          const dx = P.x[j] - P.x[i], dy = P.y[j] - P.y[i], dz = P.z[j] - P.z[i];
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; foe = j; }
        }
        if (foe < 0) {
          if (P.state[i] === PState.Fight) P.state[i] = PState.March;
          continue;
        }
        // Both fight.
        P.state[i] = PState.Fight;
        if (P.state[foe] !== PState.Fight && P.state[foe] !== PState.Flee) {
          // Civilians flee; fighters stand.
          const fighter = P.job[foe] === Job.Soldier || (P.sex[foe] === 1 && P.age[foe] < 50 && P.brave[foe] > 0.3);
          if (fighter) { P.state[foe] = PState.Fight; P.timer[foe] = 4; P.tx[foe] = P.x[i]; P.ty[foe] = P.y[i]; P.tz[foe] = P.z[i]; }
          else {
            civ.goTo(foe, P.x[foe] * 2 - P.x[i], P.y[foe] * 2 - P.y[i], P.z[foe] * 2 - P.z[i], 3, PState.Flee, Intent.Flee, -1, rng);
            continue;
          }
        }
        P.tx[i] = P.x[foe]; P.ty[i] = P.y[foe]; P.tz[i] = P.z[foe];
        const s = P.settle[foe] >= 0 ? civ.settlements[P.settle[foe]] : null;
        const wall = s && s.walls && !this.breached(civ, s) && this.distTo(P.x[foe], P.y[foe], P.z[foe], s) < s.radius ? 0.5 : 0;
        const atk = 0.4 + P.skFight[i] + weapon(P.tribe[i]) + (P.job[i] === Job.Soldier ? 0.4 : 0);
        const dfn = 0.4 + P.skFight[foe] + weapon(P.tribe[foe]) + (P.job[foe] === Job.Soldier ? 0.4 : 0) + wall;
        const pWin = atk / (atk + dfn);
        if (!rng.chance(0.06)) continue;
        const loserI = rng.chance(pWin) ? foe : i;
        const winnerI = loserI === i ? foe : i;
        P.skFight[winnerI] = Math.min(1, P.skFight[winnerI] + 0.02);
        P.kills[winnerI]++;
        const war = this.atWar(P.tribe[i], P.tribe[foe]);
        if (war) war.deaths[P.tribe[loserI] === war.a ? 0 : 1]++;
        T[P.tribe[winnerI]].stats.kills++;
        if (P.kills[winnerI] === 5) {
          P.role[winnerI] = P.role[winnerI] === 0 ? 4 : P.role[winnerI];
          events.emit(tick, 'birth-notable', { x: P.x[winnerI], y: P.y[winnerI], z: P.z[winnerI] }, 0.4, { name: civ.personName(winnerI), tribe: T[P.tribe[winnerI]].name, role: 'hero' });
        }
        civ.personDies(loserI, tick, 'battle', events);
      }
    }
  }

  // ------------------------------------------------------------------ trade
  private planRoutes(civ: Civ, tick: number, planet: Planet): void {
    // Internal routes: every settlement links to its nearest kin within reach.
    for (const s of civ.settlements) {
      if (!s.alive) continue;
      if (this.routes.some((r) => r.alive && !r.foreign && (r.a === s.id || r.b === s.id))) continue;
      let best: Settlement | null = null, bestD = 700;
      for (const o of civ.settlements) {
        if (!o.alive || o.id === s.id || o.tribe !== s.tribe) continue;
        const d = this.distTo(s.x, s.y, s.z, o);
        if (d < bestD) { bestD = d; best = o; }
      }
      if (!best) continue;
      this.openRoute(civ, s, best, false, tick, planet);
    }
    // Retire routes whose ends died or changed hands.
    for (const r of this.routes) {
      if (!r.alive) continue;
      const a = civ.settlements[r.a], b = civ.settlements[r.b];
      if (!a.alive || !b.alive) r.alive = false;
      else if (!r.foreign && a.tribe !== b.tribe) r.alive = false;
      else if (r.foreign && (a.tribe === b.tribe || this.atWar(a.tribe, b.tribe))) r.alive = false;
    }
  }

  private openRoute(civ: Civ, a: Settlement, b: Settlement, foreign: boolean, tick: number, planet: Planet): TradeRoute | null {
    let mode: 'land' | 'sea' = 'land';
    let path = civ.paths.find(a.cell, b.cell, 'land', 9000);
    const harborA = a.buildings.some((id) => civ.buildings[id].type === BType.Harbor && civ.buildings[id].complete && !civ.buildings[id].ruin);
    const harborB = b.buildings.some((id) => civ.buildings[id].type === BType.Harbor && civ.buildings[id].complete && !civ.buildings[id].ruin);
    if ((!path || path.length > 60) && harborA && harborB) {
      const sea = civ.paths.find(a.cell, b.cell, 'sea', 12000);
      if (sea) { path = sea; mode = 'sea'; }
    }
    if (!path) return null;
    const r: TradeRoute = { id: this.nextId++, a: a.id, b: b.id, mode, foreign, established: tick, lastTrip: tick, trips: 0, moved: 0, alive: true };
    this.routes.push(r);
    civ.routePaths.set(r.id, civ.registerPath(path));
    // Roads grow along busy land routes.
    if (mode === 'land') civ.layRoad(path, planet);
    void planet;
    return r;
  }

  private openForeignRoute(civ: Civ, ta: number, tb: number, tick: number, planet: Planet, events: EventLog): void {
    let best: [Settlement, Settlement] | null = null, bestD = 1200;
    for (const ia of civ.tribes[ta].settlements) {
      const sa = civ.settlements[ia];
      if (!sa.alive) continue;
      for (const ib of civ.tribes[tb].settlements) {
        const sb = civ.settlements[ib];
        if (!sb.alive) continue;
        const d = this.distTo(sa.x, sa.y, sa.z, sb);
        if (d < bestD) { bestD = d; best = [sa, sb]; }
      }
    }
    if (!best) return;
    const r = this.openRoute(civ, best[0], best[1], true, tick, planet);
    if (r && r.mode === 'sea') events.emit(tick, 'trade-route', best[0], 0.4, { a: best[0].name, b: best[1].name, sea: 1 });
  }

  /** Dispatch caravans where one end has a surplus the other lacks. */
  private updateTrade(civ: Civ, tick: number, rng: Rng, planet: Planet, events: EventLog): void {
    const P = civ.people;
    for (const r of this.routes) {
      if (!r.alive || tick - r.lastTrip < (r.foreign ? 240 : 120)) continue;
      const a = civ.settlements[r.a], b = civ.settlements[r.b];
      // Pick the direction and good with the largest need.
      let best: { from: Settlement; to: Settlement; res: number; amt: number } | null = null, bestNeed = 0;
      for (const [from, to] of [[a, b], [b, a]] as const) {
        for (let res = 0; res < RES_COUNT; res++) {
          const perHead = (s: Settlement) => s.stock[res] / Math.max(4, s.pop);
          const surplus = res === Res.Food ? from.stock[res] - from.pop * 3 : from.stock[res] - 30;
          if (surplus < 8) continue;
          const hungry = to.famine > 0 || to.stock[Res.Food] < to.pop * 1.5;
          const need = (res === Res.Food ? (hungry ? 3 : 1) : 0.6) * (perHead(from) - perHead(to));
          if (need > bestNeed) { bestNeed = need; best = { from, to, res, amt: Math.min(surplus * 0.5, res === Res.Food ? 30 : 20) }; }
        }
      }
      if (!best || bestNeed < 0.6) continue;
      // Choose a carrier.
      const merchant = this.pickCarrier(civ, best.from, best.res === Res.Food && (best.to.famine > 0 || best.to.stock[Res.Food] < best.to.pop * 1.5));
      if (merchant < 0) continue;
      const amt = Math.min(best.amt, best.from.stock[best.res]);
      if (amt < 4) continue;
      best.from.stock[best.res] -= amt;
      P.carryRes[merchant] = best.res;
      P.carryAmt[merchant] = amt;
      P.intent[merchant] = Intent.Trade;
      P.intentArg[merchant] = r.id;
      P.state[merchant] = PState.Travel;
      P.vessel[merchant] = r.mode === 'sea' ? 1 : 0;
      const pid = civ.routePaths.get(r.id)!;
      const path = civ.pathTable[pid];
      // Paths run a→b; travelling b→a uses a reversed copy.
      if (best.from.id === r.a) P.pathId[merchant] = pid;
      else P.pathId[merchant] = civ.registerPath(path ? path.slice().reverse() : Int32Array.of(best.to.cell));
      P.pathPos[merchant] = 0;
      civ.nextWaypoint(merchant, planet, rng);
      r.lastTrip = tick;
      r.trips++;
      r.moved += amt;
      if (r.trips === 1 && r.foreign) events.emit(tick, 'trade-route', best.from, 0.35, { a: best.from.name, b: best.to.name, first: 1 });
    }
  }

  private pickCarrier(civ: Civ, s: Settlement, relief: boolean): number {
    const P = civ.people;
    let best = -1, bestScore = -1;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.settle[i] !== s.id || P.age[i] < 16 || P.age[i] > 55 || P.army[i] >= 0) continue;
      if (P.intent[i] === Intent.Trade || P.intent[i] === Intent.Settle || P.role[i] === 1) continue;
      if (P.carryRes[i] >= 0) continue;
      const score = P.job[i] === Job.Merchant ? 3 : relief && (P.job[i] === Job.Gatherer || P.job[i] === Job.None) ? 1 + P.brave[i] : -1;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore > 0 ? best : -1;
  }

  /** A caravan (or ship) reached the end of its path. Returns true if handled. */
  arriveTrader(civ: Civ, i: number, tick: number, rng: Rng, planet: Planet): boolean {
    const P = civ.people;
    if (P.state[i] === PState.Travel && civ.nextWaypoint(i, planet, rng)) return true;
    const r = this.routes.find((x) => x.id === P.intentArg[i]);
    const home = P.settle[i] >= 0 ? civ.settlements[P.settle[i]] : null;
    P.vessel[i] = 0;
    if (!r || !home) { P.intent[i] = 0; P.state[i] = PState.Idle; return true; }
    const dest = civ.settlements[r.a === home.id ? r.b : r.a];
    if (P.carryRes[i] >= 0 && dest && dest.alive) {
      // Deliver the goods.
      const res = P.carryRes[i], amt = P.carryAmt[i];
      dest.stock[res] += amt;
      P.carryRes[i] = -1; P.carryAmt[i] = 0;
      // Foreign trade: paid in the destination's most plentiful other good.
      if (r.foreign) {
        let payRes = -1, payAmt = 0;
        for (let k = 0; k < RES_COUNT; k++) {
          if (k === res) continue;
          const spare = dest.stock[k] - (k === Res.Food ? dest.pop * 3 : 25);
          if (spare > payAmt) { payAmt = spare; payRes = k; }
        }
        if (payRes >= 0 && payAmt > 2) {
          const pay = Math.min(payAmt * 0.5, amt * 0.9);
          dest.stock[payRes] -= pay;
          P.carryRes[i] = payRes; P.carryAmt[i] = pay;
        }
        const ta = home.tribe, tb = dest.tribe;
        this.ensure(civ.tribes.length);
        this.rel[ta][tb] = this.rel[tb][ta] = Math.min(1, this.rel[ta][tb] + 0.03);
        civ.tribes[ta].research[3] += 0.4; // writing/ledgers
        civ.tribes[tb].research[3] += 0.4;
      }
      dest.happiness = Math.min(1, dest.happiness + 0.02);
    }
    // Head home along the reversed path.
    const pid = civ.routePaths.get(r.id);
    const path = pid !== undefined ? civ.pathTable[pid] : null;
    if (path && P.intentArg[i] === r.id && dest && dest.alive && this.distTo(P.x[i], P.y[i], P.z[i], home) > home.radius) {
      const back = dest.id === r.b ? path.slice().reverse() : path;
      P.pathId[i] = civ.registerPath(back);
      P.pathPos[i] = 0;
      P.intent[i] = Intent.Deliver;
      P.state[i] = PState.Travel;
      P.vessel[i] = r.mode === 'sea' ? 1 : 0;
      civ.nextWaypoint(i, planet, rng);
      return true;
    }
    P.intent[i] = 0;
    P.state[i] = PState.Idle;
    void tick;
    return true;
  }

  // ------------------------------------------------------------------ religion
  /** Prophets preach to those around them (every 32 ticks). */
  private preach(civ: Civ, tick: number, rng: Rng): void {
    const P = civ.people;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.role[i] !== 3) continue;
      const b = civ.hash.bucketOf[i];
      if (b < 0) continue;
      const hs = civ.hash;
      for (let q = hs.cellStart[b], qe = hs.cellStart[b + 1]; q < qe; q++) {
        const j = hs.items[q];
        if (j === i || !P.alive[j]) continue;
        const k = 0.012 * (0.5 + P.pious[j]);
        P.love[j] = Math.min(1, P.love[j] + k);
        if (P.tribe[j] !== P.tribe[i]) P.fear[j] = Math.min(1, P.fear[j] + k * 0.3);
      }
    }
    void tick; void rng;
  }

  private religionDaily(civ: Civ, tick: number, rng: Rng, planet: Planet, events: EventLog, geo: Geography): void {
    const P = civ.people;
    const T = civ.tribes;
    // Prophets travel: to a sister settlement, or to preach to foreigners.
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.role[i] !== 3 || P.state[i] === PState.Travel || !rng.chance(0.12)) continue;
      const t = P.tribe[i];
      const here = P.settle[i] >= 0 ? civ.settlements[P.settle[i]] : null;
      if (!here) continue;
      const options = civ.settlements.filter((s) => s.alive && s.id !== here.id && this.distTo(here.x, here.y, here.z, s) < 700 && (s.tribe === t || (this.contact[t]?.[s.tribe] && !this.atWar(t, s.tribe))));
      if (!options.length) continue;
      const dest = rng.pick(options);
      const path = civ.paths.find(here.cell, dest.cell, 'land', 6000);
      if (!path) continue;
      P.intent[i] = Intent.Pilgrim;
      P.intentArg[i] = -1 - dest.id;
      P.state[i] = PState.Travel;
      P.pathId[i] = civ.registerPath(path);
      P.pathPos[i] = 0;
      civ.nextWaypoint(i, planet, rng);
    }
    // Pilgrimages to sacred sites.
    for (const s of civ.settlements) {
      if (!s.alive || !rng.chance(0.15)) continue;
      const t = T[s.tribe];
      const site = t.religion.sacredSites.find((st) => this.distTo(st.x, st.y, st.z, s) < 600);
      if (!site) continue;
      let pilgrim = -1, best = 0.55;
      for (let i = 0; i < P.count; i++) {
        if (!P.alive[i] || P.settle[i] !== s.id || P.age[i] < 16 || P.intent[i] === Intent.Pilgrim || P.army[i] >= 0 || P.carryRes[i] >= 0) continue;
        if (P.pious[i] > best) { best = P.pious[i]; pilgrim = i; }
      }
      if (pilgrim < 0) continue;
      const cell = civ.cellOfDir(site.x, site.y, site.z);
      const path = civ.paths.find(s.cell, cell, 'land', 6000);
      if (!path) continue;
      P.intent[pilgrim] = Intent.Pilgrim;
      P.intentArg[pilgrim] = cell;
      P.state[pilgrim] = PState.Travel;
      P.pathId[pilgrim] = civ.registerPath(path);
      P.pathPos[pilgrim] = 0;
      civ.nextWaypoint(pilgrim, planet, rng);
    }
    // Tenets grow from what the god has done lately; the god gains a new name.
    for (const t of T) {
      if (!t.alive) continue;
      const rel = t.religion;
      const recent = civ.godMemories.filter((m) => m.tick > tick - TICKS_PER_DAY && (m.settlement === '' || t.settlements.some((id) => civ.settlements[id].name === m.settlement)));
      for (const m of recent) {
        for (const c of DEED_TENETS[m.kind] ?? []) rel.tenets[c] = Math.min(1.5, (rel.tenets[c] ?? 0) + 0.12);
        if (rel.scripture.length < 40) rel.scripture.push(this.verse(civ, t.id, m.kind, m.place, m.deaths, tick));
      }
      for (const k of Object.keys(rel.tenets) as Concept[]) rel.tenets[k] = (rel.tenets[k] ?? 0) * 0.998;
      const top = (Object.entries(rel.tenets) as [Concept, number][]).sort((x, y) => y[1] - x[1])[0];
      if (top && EPITHETS[top[0]]) {
        const base = rel.deity.split(' ')[0];
        const ep = EPITHETS[top[0]]![rel.fear > rel.love ? 1 : 0];
        const name = `${base} ${ep}`;
        if (name !== rel.deity && top[1] > 0.6) {
          rel.deity = name;
          events.emit(tick, 'religion', civ.settlements[t.capital] ?? null, 0.45, { tribe: t.name, deity: name, tenet: top[0] });
        }
      }
    }
    this.schisms(civ, tick, rng, planet, events, geo);
  }

  private verse(civ: Civ, tribe: number, kind: string, place: string, deaths: number, tick: number): string {
    const t = civ.tribes[tribe];
    const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
    const god = t.religion.deity;
    const lines: Record<string, string> = {
      lightning: `In the year ${year}, ${god} spoke in fire at ${place}${deaths ? `, and ${deaths} were taken` : ''}.`,
      rain: `In the year ${year}, ${god} opened the sky over ${place}.`,
      mercy: `In the year ${year} the land was dust, and ${god} wept for us at ${place}.`,
      drought: `In the year ${year}, ${god} closed the sky over ${place}, and the springs were silent.`,
      fire: `In the year ${year} the forests of ${place} burned at the word of ${god}.`,
      earthquake: `In the year ${year} the earth shook at ${place}${deaths ? `, and ${deaths} lie beneath it` : ''}.`,
      volcano: `In the year ${year} a mountain of fire rose at ${place}.`,
      tsunami: `In the year ${year} the sea rose against ${place}${deaths ? ` and took ${deaths}` : ''}.`,
      meteor: `In the year ${year} a star fell upon ${place}${deaths ? `, and ${deaths} were no more` : ''}.`,
      bloom: `In the year ${year} every seed at ${place} woke at once.`,
      blessing: `In the year ${year}, ${god} laid a hand upon ${place}.`,
      cure: `In the year ${year} the sickness left ${place} at the touch of ${god}.`,
      plague: `In the year ${year} a sickness came to ${place}, sent by ${god}.`,
      resurrection: `In the year ${year} the dead of ${place} rose and walked, and we knew ${god} was Lord of Death.`,
      locusts: `In the year ${year} a cloud of mouths came upon ${place}.`,
      inspiration: `In the year ${year} a dream came to ${place}, and we learned.`,
      vision: `In the year ${year}, ${god} showed a face to one of ${place}.`,
      harmony: `In the year ${year} the spears were laid down at ${place}.`,
      beacon: `In the year ${year} a pillar of light stood at ${place}, and the herds came.`,
      eclipse: `In the year ${year} the sun was eaten, and all knelt.`,
      grove: `In the year ${year}, ${god} made ${place} holy.`,
    };
    return lines[kind] ?? `In the year ${year}, ${god} was seen at ${place}.`;
  }

  /** Distant, fervent congregations break away and found a new people. */
  private schisms(civ: Civ, tick: number, rng: Rng, planet: Planet, events: EventLog, geo: Geography): void {
    const T = civ.tribes;
    const P = civ.people;
    for (const t of [...T]) {
      if (!t.alive || t.settlements.length < 2) continue;
      const cap = civ.settlements[t.capital];
      if (!cap) continue;
      for (const sid of t.settlements) {
        const s = civ.settlements[sid];
        if (!s.alive || s.id === cap.id || s.pop < 20) continue;
        const d = this.distTo(s.x, s.y, s.z, cap);
        let prophet = false;
        for (let i = 0; i < P.count; i++) if (P.alive[i] && P.role[i] === 3 && P.settle[i] === s.id) { prophet = true; break; }
        const divergence = Math.abs(s.faith - cap.faith) + (prophet ? 0.3 : 0) + Math.max(0, d - 300) / 1000 + (s.happiness < 0.35 ? 0.2 : 0);
        if (divergence < 0.55 || !rng.chance(0.004 * divergence)) continue;
        this.secede(civ, s, tick, rng, events, geo);
        void planet;
        return;
      }
    }
  }

  private secede(civ: Civ, s: Settlement, tick: number, rng: Rng, events: EventLog, geo: Geography): void {
    const T = civ.tribes;
    const parent = T[s.tribe];
    const nt = createTribe(T.length, rng, tick, T.length, { temp: 15, coastal: s.coastal });
    // Same tongue (a dialect), new faith, a palette shifted from the parent.
    nt.lang = parent.lang;
    nt.name = Language.fromSpec(parent.lang).nameFor(tick + s.id * 17, 'tribe');
    nt.adjective = nt.name.endsWith('a') ? `${nt.name}n` : `${nt.name}i`;
    nt.known = parent.known.slice();
    nt.age = parent.age;
    nt.style = parent.style;
    nt.traits = { ...parent.traits, piety: Math.min(1, parent.traits.piety + 0.2), aggression: Math.min(1, parent.traits.aggression + 0.1) };
    const newTenets = { ...parent.religion.tenets };
    const mem = civ.godMemories.filter((m) => m.settlement === s.name).slice(-3);
    for (const m of mem) for (const c of DEED_TENETS[m.kind] ?? []) newTenets[c] = (newTenets[c] ?? 0) + 0.5;
    const topT = (Object.entries(newTenets) as [Concept, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'spirit';
    const lang = Language.fromSpec(parent.lang);
    nt.religion = {
      name: `the ${capital(lang.term(topT))} Heresy`,
      deity: parent.religion.deity.split(' ')[0],
      tenets: newTenets,
      love: parent.religion.love,
      fear: parent.religion.fear + 0.1,
      sacredSites: parent.religion.sacredSites.slice(),
      scripture: parent.religion.scripture.slice(-5),
      parentTribe: parent.id,
    };
    T.push(nt);
    this.ensure(T.length);
    parent.settlements = parent.settlements.filter((id) => id !== s.id);
    nt.settlements.push(s.id);
    nt.capital = s.id;
    s.tribe = nt.id;
    for (const id of s.buildings) civ.buildings[id].tribe = nt.id;
    const P = civ.people;
    for (let i = 0; i < P.count; i++) if (P.alive[i] && P.settle[i] === s.id) { P.tribe[i] = nt.id; if (P.role[i] === 1) P.role[i] = 0; }
    // The most pious becomes chief.
    let chief = -1, best = -1;
    for (let i = 0; i < P.count; i++) if (P.alive[i] && P.settle[i] === s.id && P.age[i] >= 20 && P.pious[i] > best) { best = P.pious[i]; chief = i; }
    if (chief >= 0) P.role[chief] = 1;
    this.contact[parent.id][nt.id] = this.contact[nt.id][parent.id] = true;
    this.rel[parent.id][nt.id] = this.rel[nt.id][parent.id] = -0.55;
    civ.version++;
    events.emit(tick, 'schism', s, 0.85, { parent: parent.name, tribe: nt.name, settlement: s.name, faith: nt.religion.name, where: geo.describe(s.cell) });
    if (rng.chance(parent.traits.aggression)) this.declareWar(civ, parent.id, nt.id, 'rebellion', tick, events);
  }

  /** A pilgrim or travelling prophet arrived. */
  arrivePilgrim(civ: Civ, i: number, tick: number, rng: Rng, planet: Planet, events: EventLog): boolean {
    const P = civ.people;
    if (P.state[i] === PState.Travel && civ.nextWaypoint(i, planet, rng)) return true;
    const arg = P.intentArg[i];
    if (arg <= -1) {
      // Prophet arriving at a settlement: preach, maybe convert foreigners.
      const s = civ.settlements[-1 - arg];
      if (s && s.alive && s.tribe !== P.tribe[i]) {
        const mine = civ.tribes[P.tribe[i]], theirs = civ.tribes[s.tribe];
        const pull = mine.religion.love + mine.religion.fear * 0.5 - (theirs.religion.love + theirs.religion.fear * 0.5) + P.social[i] * 0.3;
        if (pull > 0.15 && theirs.religion.name !== mine.religion.name && rng.chance(0.25) && s.id === theirs.capital) {
          const old = theirs.religion.name;
          theirs.religion = { ...mine.religion, tenets: { ...mine.religion.tenets }, sacredSites: mine.religion.sacredSites.slice(), scripture: mine.religion.scripture.slice(-8), parentTribe: mine.id };
          events.emit(tick, 'religion', s, 0.7, { tribe: theirs.name, converted: 1, faith: mine.religion.name, old, prophet: civ.personName(i) });
          this.ensure(civ.tribes.length);
          this.rel[mine.id][theirs.id] = this.rel[theirs.id][mine.id] = Math.min(1, this.rel[mine.id][theirs.id] + 0.35);
        }
      }
      if (s && s.alive && s.tribe === P.tribe[i]) P.settle[i] = s.id;
    } else {
      // Pilgrim at a sacred site: pray, then go home.
      P.love[i] = Math.min(1, P.love[i] + 0.15);
      P.happiness[i] = Math.min(1, P.happiness[i] + 0.15);
    }
    P.state[i] = PState.Pray;
    P.intent[i] = Intent.Pray;
    P.timer[i] = 60;
    return true;
  }
}

function capital(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1) : w;
}
