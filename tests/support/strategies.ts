/**
 * Scripted players used to prove every scenario can be won and lost.
 * Each strategy acts once per simulated day through the same command API
 * the UI uses.
 */
import type { World } from '../../src/sim/world';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../../src/sim/constants';
import { powerDef, type PowerId } from '../../src/sim/powers/defs';
import { habitat } from '../../src/sim/ecology/species';

export type Strategy = (w: World, day: number) => void;

const live = (w: World) => w.civ.settlements.filter((s) => s.alive);
const cast = (w: World, power: PowerId, p: { x: number; y: number; z: number }) => {
  if (w.civ.devotion < powerDef(power).cost) return false;
  return w.command({ kind: 'power', power, x: p.x, y: p.y, z: p.z }).ok;
};
const biggest = (w: World) => live(w).sort((a, b) => b.pop - a.pop)[0];

export const IDLE: Strategy = () => {};

/** Wipe out the world: meteors and plague on every settlement. */
export const DESTROY_ALL: Strategy = (w) => {
  w.divine.boundless = true;
  for (const s of live(w)) { cast(w, 'meteor', s); cast(w, 'plague', s); }
};

export const WIN: Record<string, Strategy> = {
  'first-flame': (w, day) => {
    // Inspire the most advanced people and keep them fed.
    const s = biggest(w);
    if (!s) return;
    if (day % 2 === 0) cast(w, 'inspiration', s);
    if (day % 5 === 1) cast(w, 'blessing', s);
    if (day % 3 === 2) cast(w, 'bloom', s);
  },
  'long-drought': (w, day) => {
    // Break every drought with rain (never rain on wet ground: that is a
    // deluge), and make the fields bloom when devotion allows.
    for (const s of live(w)) {
      if (w.divine.within('drought', s.x, s.y, s.z, w.tick, 0)) cast(w, 'rain', s);
      else if (day % 4 === 1 && w.civ.devotion > 120) cast(w, 'bloom', s);
    }
  },
  ark: (w, day) => {
    // Every species that has fallen below 80% of its original number gets a
    // sacred grove (shelter from the cold) at the best refuge its members can
    // reach; the most endangered is called there with a beacon and fed.
    const A = w.animals;
    const memo = w.scenario!.memo;
    const cl = w.planet.climate, g = w.planet.region;
    const struggling: { sp: number; ratio: number }[] = [];
    for (let sp = 0; sp < A.defs.length; sp++) {
      const start = memo[`sp${sp}`];
      if (!start || A.pop[sp] <= 0) continue;
      const ratio = A.pop[sp] / start;
      // Small populations are at risk even before they fall.
      if (ratio < 0.8 || A.pop[sp] < 40) struggling.push({ sp, ratio: Math.min(ratio, A.pop[sp] / 60) });
    }
    struggling.sort((a, b) => a.ratio - b.ratio);
    let first: { x: number; y: number; z: number } | null = null;
    for (const { sp } of struggling) {
      let best = -1, bt = -Infinity;
      for (let i = 0; i < A.count; i++) {
        if (!A.alive[i] || A.species[i] !== sp) continue;
        const c = g.cellOf(A.x[i], A.y[i], A.z[i]);
        if (w.planet.terrain.oceanFrac[c] > 0.3) continue;
        const h = habitat(A.defs[sp], cl.biome[c], cl.temp[c], A.gCold[i], A.gHeat[i]) + cl.temp[c] * 0.01;
        if (h > bt) { bt = h; best = i; }
      }
      if (best < 0) continue;
      const p = { x: A.x[best], y: A.y[best], z: A.z[best] };
      let grove = null as { x: number; y: number; z: number } | null;
      for (const e of w.divine.effects) if (e.power === 'sanctuary' && e.x * p.x + e.y * p.y + e.z * p.z > Math.cos(250 / 1000)) grove = e;
      if (!grove && cast(w, 'sanctuary', p)) grove = p;
      if (!first) first = grove ?? p;
    }
    if (!first) return;
    const p = { x: first.x, y: first.y, z: first.z };
    if (day % 3 === 0) cast(w, 'beacon', p);
    if (w.civ.devotion >= powerDef('bloom').cost + powerDef('beacon').cost) cast(w, 'bloom', p);
  },
  'holy-war': (w) => {
    const sc = w.scenario!;
    if (w.civ.society.atWar(sc.memo.a, sc.memo.b)) {
      const s = w.civ.settlements[w.civ.tribes[sc.memo.a].capital];
      if (s) cast(w, 'harmony', s);
    }
  },
  chosen: (w, day) => {
    const s = biggest(w);
    if (!s) return;
    if (day % 3 === 0) cast(w, 'blessing', s);
    if (day % 2 === 1) cast(w, 'bloom', s);
    if (day % 6 === 2) cast(w, 'inspiration', s);
    if (day % 6 === 5) cast(w, 'rain', s);
  },
  wrath: (w, day) => {
    // Spare the smallest people; destroy the rest; then thin the survivors with lightning.
    const sets = live(w);
    if (!sets.length) return;
    const tribes = [...new Set(sets.map((s) => s.tribe))];
    const spare = tribes.sort((a, b) => w.civ.tribes[a].population - w.civ.tribes[b].population)[0];
    for (const s of sets) if (s.tribe !== spare) { cast(w, 'meteor', s); cast(w, 'plague', s); }
    if (tribes.length === 1 && w.civ.totalPeople() >= 25) {
      const P = w.civ.people;
      let n = 0;
      for (let i = 0; i < P.count && n < 3; i++) if (P.alive[i] && (i + day) % 5 === 0) { if (cast(w, 'lightning', { x: P.x[i], y: P.y[i], z: P.z[i] })) n++; }
    }
  },
  'green-desert': (w, day) => {
    // Paint the land green around every settlement and far beyond, and water it.
    const g = w.planet.region;
    const rng = (k: number) => ((day * 7919 + k * 104729) % 1000) / 1000;
    for (let k = 0; k < 12; k++) {
      const c = Math.floor(rng(k) * g.count);
      if (w.planet.terrain.oceanFrac[c] > 0.5) continue;
      const p = { x: g.centers[c * 3], y: g.centers[c * 3 + 1], z: g.centers[c * 3 + 2] };
      w.command({ kind: 'brush', tool: 'paint', ...p, radius: 160, strength: 1, paint: 0 });
      cast(w, 'rain', p);
      cast(w, 'bloom', p);
    }
  },
  forgotten: (w, step) => {
    // Acting every few ticks: terrify with cheap lightning beside each village,
    // then awe them with wonders as their faith pays for more.
    const sets = live(w);
    if (!sets.length) return;
    const s = sets[step % sets.length];
    cast(w, 'lightning', { x: s.x + 0.006, y: s.y, z: s.z });
    if (w.civ.devotion > 260) cast(w, 'eclipse', { x: 0, y: 1, z: 0 });
    if (w.civ.devotion > 80) cast(w, 'blessing', s);
  },
};

export const LOSE: Record<string, Strategy> = {
  'first-flame': DESTROY_ALL,
  'long-drought': (w, day) => {
    // The cruel god: deepen the drought and set the dry land burning.
    w.divine.boundless = true;
    for (const s of live(w)) {
      if (day % 6 === 0) cast(w, 'drought', s);
      if (day % 6 === 3) cast(w, 'wildfire', s);
      if (day % 12 === 1) cast(w, 'plague', s);
    }
  },
  ark: (w, day) => {
    // Hunt the rarest species to extinction with fire from the sky.
    w.divine.boundless = true;
    const A = w.animals;
    let rare = -1, n = Infinity;
    for (let sp = 0; sp < A.defs.length; sp++) if (A.pop[sp] > 0 && A.pop[sp] < n && A.defs[sp].parent < 0) { n = A.pop[sp]; rare = sp; }
    if (rare < 0) return;
    for (let i = 0; i < A.count; i++) if (A.alive[i] && A.species[i] === rare) cast(w, 'meteor', { x: A.x[i], y: A.y[i], z: A.z[i] });
    void day;
  },
  'holy-war': (w) => {
    // Side with the aggressor: destroy the defender.
    w.divine.boundless = true;
    const b = w.scenario!.memo.b;
    for (const s of live(w)) if (s.tribe === b) { cast(w, 'meteor', s); cast(w, 'plague', s); }
  },
  chosen: DESTROY_ALL,
  wrath: DESTROY_ALL,
  'green-desert': (w) => { w.divine.boundless = true; for (const s of live(w)) cast(w, 'drought', s); },
  // Terror is also awe (the brief says so): a god who destroys wins their
  // fear. The way to lose this scenario is neglect.
  forgotten: IDLE,
};

/** How often (ticks) a strategy acts; attentive players act many times a day. */
export const CADENCE: Record<string, number> = { forgotten: 8 };

/** Run a scenario world with a strategy until it resolves or times out. */
export function play(w: World, strat: Strategy, maxYears: number): 'active' | 'won' | 'lost' {
  const end = w.tick + maxYears * TICKS_PER_YEAR + TICKS_PER_DAY;
  const every = (w.scenario && CADENCE[w.scenario.id]) || TICKS_PER_DAY;
  let day = 0;
  while (w.tick < end) {
    if (w.tick % every === 0) strat(w, day++);
    w.step();
    if (w.scenario && w.scenario.status !== 'active') return w.scenario.status;
  }
  return w.scenario ? w.scenario.status : 'active';
}
