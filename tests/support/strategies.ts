/**
 * Scripted players used to prove every scenario can be won and lost.
 * Each strategy acts once per simulated day through the same command API
 * the UI uses.
 */
import type { World } from '../../src/sim/world';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../../src/sim/constants';
import { powerDef, type PowerId } from '../../src/sim/powers/defs';

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
    for (const s of live(w)) {
      if (day % 2 === 0) cast(w, 'rain', s);
      if (day % 4 === 1) cast(w, 'bloom', s);
    }
  },
  ark: (w, day) => {
    // Gather the rarest species with a beacon and feed the land around it.
    const A = w.animals;
    let rare = -1, n = Infinity;
    for (let sp = 0; sp < A.defs.length; sp++) if (A.pop[sp] > 0 && A.pop[sp] < n) { n = A.pop[sp]; rare = sp; }
    if (rare < 0 || n > 80) return;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < A.count; i++) if (A.alive[i] && A.species[i] === rare) { cx += A.x[i]; cy += A.y[i]; cz += A.z[i]; }
    const l = Math.hypot(cx, cy, cz) || 1;
    // The centroid can fall in the sea; use the member nearest to it.
    let best = -1, bd = -2;
    for (let i = 0; i < A.count; i++) if (A.alive[i] && A.species[i] === rare) { const d = (A.x[i] * cx + A.y[i] * cy + A.z[i] * cz) / l; if (d > bd) { bd = d; best = i; } }
    const p = { x: A.x[best], y: A.y[best], z: A.z[best] };
    if (day % 3 === 0) cast(w, 'beacon', p);
    cast(w, 'bloom', p);
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
  forgotten: (w, day) => {
    // Wonders where the people are, and an eclipse when it can be afforded.
    if (day % 20 === 5) cast(w, 'eclipse', { x: 0, y: 1, z: 0 });
    for (const s of live(w)) {
      if (day % 2 === 0) cast(w, 'blessing', s);
      else cast(w, 'rain', s);
      if (day % 3 === 0) cast(w, 'lightning', { x: s.x + 0.006, y: s.y, z: s.z });
    }
  },
};

export const LOSE: Record<string, Strategy> = {
  'first-flame': DESTROY_ALL,
  'long-drought': (w) => { w.divine.boundless = true; for (const s of live(w)) cast(w, 'plague', s); },
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
  forgotten: DESTROY_ALL,
};

/** Run a scenario world with a strategy until it resolves or times out. */
export function play(w: World, strat: Strategy, maxYears: number): 'active' | 'won' | 'lost' {
  const end = w.tick + maxYears * TICKS_PER_YEAR + TICKS_PER_DAY;
  let day = 0;
  while (w.tick < end) {
    if (w.tick % TICKS_PER_DAY === 0) strat(w, day++);
    w.step();
    if (w.scenario && w.scenario.status !== 'active') return w.scenario.status;
  }
  return w.scenario ? w.scenario.status : 'active';
}
