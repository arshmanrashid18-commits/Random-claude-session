/**
 * Scenarios: hand-authored starting conditions with objectives evaluated by
 * the simulation itself (deterministic, saved with the world, testable).
 * Each scenario can be won and can be lost; tests/scenarios.soak.test.ts
 * plays a winning and a losing strategy for every one of them.
 */
import type { World } from './world';
import type { WorldPresetId } from './planet/presets';
import { TICKS_PER_YEAR } from './constants';
import { Age, Res } from './civ/defs';
import { TECH_INDEX } from './civ/tech';

export type ScenarioStatus = 'active' | 'won' | 'lost';

export interface ScenarioState {
  id: string;
  status: ScenarioStatus;
  startTick: number;
  /** Objective progress 0..1 (for the HUD). */
  progress: number;
  /** Short live status line. */
  detail: string;
  /** Why it ended. */
  outcome: string;
  /** Scenario-specific memory (e.g. initial species). */
  memo: Record<string, number>;
}

export interface ScenarioDef {
  id: string;
  name: string;
  tagline: string;
  brief: string;
  objective: string;
  difficulty: 1 | 2 | 3;
  seed: number;
  preset: WorldPresetId;
  years: number;
  setup(w: World, s: ScenarioState): void;
  /** Evaluate; set s.progress/detail and return a status. */
  check(w: World, s: ScenarioState): ScenarioStatus;
}

const years = (w: World, s: ScenarioState) => (w.tick - s.startTick) / TICKS_PER_YEAR;
const alivePeople = (w: World) => w.civ.totalPeople();
const aliveTribes = (w: World) => w.civ.tribes.filter((t) => t.alive).length;

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'first-flame',
    name: 'The First Flame',
    tagline: 'From stone to bronze.',
    brief: 'Five small bands huddle around their fires. They do not know you yet. Teach them — gently or terribly — and carry one people out of the Stone Age.',
    objective: 'A people reaches the Bronze Age within 14 years.',
    difficulty: 1,
    seed: 20260925,
    preset: 'earthlike',
    years: 14,
    setup(w) { w.civ.devotion = 150; },
    check(w, s) {
      const best = Math.max(...w.civ.tribes.filter((t) => t.alive).map((t) => t.known.reduce((a, b) => a + b, 0)), 0);
      s.progress = Math.min(1, best / 16);
      s.detail = `${best} discoveries · ${Math.max(0, 14 - years(w, s)).toFixed(1)} years left`;
      if (w.civ.tribes.some((t) => t.alive && t.age >= Age.Bronze)) { s.outcome = 'Bronze is poured for the first time. Your people will never again be only hunters.'; return 'won'; }
      if (aliveTribes(w) === 0) { s.outcome = 'The last fire has gone out.'; return 'lost'; }
      if (years(w, s) >= 14) { s.outcome = 'Fourteen years pass, and still they work only in stone.'; return 'lost'; }
      return 'active';
    },
  },
  {
    id: 'long-drought',
    name: 'The Long Drought',
    tagline: 'Water is life.',
    brief: 'On a world of sand and shrinking seas the rains have failed. The peoples of Dune will not survive the decade alone.',
    objective: 'The rains fail every year. Without rain the wells run dry. After 20 years at least 120 people must live; fewer than 30 and all is lost.',
    difficulty: 2,
    seed: 7117,
    preset: 'arid',
    years: 20,
    setup(w) {
      w.civ.devotion = 200;
      // A drier age: the whole world's moisture falls.
      w.planet.climate.forcing.moisture *= 0.6;
      // The skies close over every people.
      for (const t of w.civ.tribes) {
        const c = w.civ.settlements[t.capital];
        if (c) w.divine.cast(w, { power: 'drought', x: c.x, y: c.y, z: c.z });
      }
    },
    check(w, s) {
      // The rains keep failing: each year the drought returns over every
      // settlement that is not already parched. Only rain can break it.
      if (w.tick - (s.memo.dry ?? s.startTick) >= TICKS_PER_YEAR) {
        s.memo.dry = w.tick;
        const was = w.divine.boundless;
        w.divine.boundless = true;
        for (const st of w.civ.settlements) {
          if (st.alive && !w.divine.within('drought', st.x, st.y, st.z, w.tick, 60)) w.divine.cast(w, { power: 'drought', x: st.x, y: st.y, z: st.z });
        }
        w.divine.boundless = was;
      }
      // Under the unbroken drought the heat spoils what the granaries hold.
      for (const st of w.civ.settlements) {
        if (st.alive && w.divine.within('drought', st.x, st.y, st.z, w.tick, 0)) w.civ.spoil(st, Res.Food, 0.03);
      }
      const pop = alivePeople(w);
      s.progress = Math.min(1, years(w, s) / 20) * (pop >= 120 ? 1 : pop / 120);
      s.detail = `${pop} people · ${Math.max(0, 20 - years(w, s)).toFixed(1)} years left`;
      if (pop < 30) { s.outcome = 'The last wells are dry. The sand keeps their bones.'; return 'lost'; }
      if (years(w, s) >= 20) {
        if (pop >= 120) { s.outcome = 'The rains came because you willed them. They will sing of it for a thousand years.'; return 'won'; }
        s.outcome = 'They survived — barely. Too few remain to call this a victory.';
        return 'lost';
      }
      return 'active';
    },
  },
  {
    id: 'ark',
    name: 'Ark of the Beasts',
    tagline: 'Let nothing be lost.',
    brief: 'An ice age is coming — you have already set it in motion. The herds must find refuge, or whole kinds of life will vanish forever.',
    objective: 'A great ice is coming. No original species may go extinct for 15 years.',
    difficulty: 2,
    seed: 5150,
    preset: 'earthlike',
    years: 15,
    setup(w, s) {
      w.civ.devotion = 700;
      w.divine.cast(w, { power: 'iceage', x: 0, y: 1, z: 0 });
      // A great ice: deeper and longer than any the god could call alone.
      const ice = w.divine.effects.find((e) => e.power === 'iceage');
      if (ice) { ice.strength = 1.3; ice.end = ice.start + TICKS_PER_YEAR * 9; }
      // Remember every original species and how many there were.
      w.animals.pop.forEach((p, i) => { if (i < w.animals.defs.length && p > 0 && w.animals.defs[i].parent < 0) s.memo[`sp${i}`] = p; });
    },
    check(w, s) {
      const originals = Object.keys(s.memo).filter((k) => k.startsWith('sp')).map((k) => Number(k.slice(2)));
      const alive = originals.filter((i) => w.animals.pop[i] > 0).length;
      s.progress = Math.min(1, years(w, s) / 15) * (alive / Math.max(1, originals.length));
      s.detail = `${alive}/${originals.length} species · ${Math.max(0, 15 - years(w, s)).toFixed(1)} years left`;
      if (alive < originals.length) {
        const lost = originals.find((i) => w.animals.pop[i] <= 0)!;
        s.outcome = `The ${w.animals.defs[lost].plural} are gone. The ark was not large enough.`;
        return 'lost';
      }
      if (years(w, s) >= 15) { s.outcome = 'The ice retreats. Every kind of beast walks out into the new spring.'; return 'won'; }
      return 'active';
    },
  },
  {
    id: 'holy-war',
    name: 'Two Faiths',
    tagline: 'Blessed are the peacemakers.',
    brief: 'Two neighbouring peoples have come to hate each other in your name. Their war will end with one of them erased — unless you intervene.',
    objective: 'Impose a lasting truce and keep both peoples alive for 12 years. Left alone, their peace never holds.',
    difficulty: 2,
    seed: 20260925,
    preset: 'earthlike',
    years: 12,
    setup(w, s) {
      const so = w.civ.society;
      so.ensure(w.civ.tribes.length);
      // The two closest peoples meet, differ in faith, and go to war.
      let pair: [number, number] = [0, 1], best = Infinity;
      for (const a of w.civ.tribes) for (const b of w.civ.tribes) {
        if (a.id >= b.id) continue;
        const sa = w.civ.settlements[a.capital], sb = w.civ.settlements[b.capital];
        const d = Math.acos(Math.min(1, sa.x * sb.x + sa.y * sb.y + sa.z * sb.z));
        if (d < best) { best = d; pair = [a.id, b.id]; }
      }
      const [a, b] = pair;
      so.contact[a][b] = so.contact[b][a] = true;
      so.rel[a][b] = so.rel[b][a] = -0.9;
      so.grudge[a][b] = so.grudge[b][a] = 0.6;
      const ta = w.civ.tribes[a], tb = w.civ.tribes[b];
      ta.traits.aggression = 0.95; tb.traits.aggression = 0.85;
      ta.traits.honor = 0.15; tb.traits.honor = 0.2;
      ta.religion.fear = 0.7;
      if (!ta.known[TECH_INDEX.get('warfare')!]) ta.known[TECH_INDEX.get('warfare')!] = 1;
      so.declareWar(w.civ, a, b, 'holy', w.tick, w.events);
      s.memo.a = a; s.memo.b = b;
      w.civ.devotion = 250;
    },
    check(w, s) {
      const a = s.memo.a, b = s.memo.b;
      const ta = w.civ.tribes[a], tb = w.civ.tribes[b];
      const so = w.civ.society;
      let war = so.atWar(a, b);
      // A holy war's peace does not hold: unless the god imposes a truce,
      // the priests call the faithful back to arms within months.
      let last = null as (typeof so.wars)[number] | null;
      for (const x of so.wars) if ((x.a === a && x.b === b) || (x.a === b && x.b === a)) last = x;
      if (!war && last && last.how !== 'truce' && ta.alive && tb.alive && w.tick - last.end > TICKS_PER_YEAR * 0.4) {
        war = so.declareWar(w.civ, a, b, 'holy', w.tick, w.events);
        last = war;
      }
      const truce = !war && !!last && last.how === 'truce';
      s.progress = Math.min(1, years(w, s) / 12) * (truce ? 1 : 0.5);
      s.detail = `${ta.name} ${ta.population} · ${tb.name} ${tb.population} · ${war ? 'at war' : 'at peace'}`;
      if (!ta.alive || !tb.alive) { s.outcome = `The ${(ta.alive ? tb : ta).name} are no more. Their faith is ash.`; return 'lost'; }
      if (years(w, s) >= 12) {
        if (truce) { s.outcome = 'The spears are hung above the hearths. Their children will trade, not fight.'; return 'won'; }
        s.outcome = 'Twelve years of war, and no end in sight.';
        return 'lost';
      }
      return 'active';
    },
  },
  {
    id: 'chosen',
    name: 'The Chosen People',
    tagline: 'A city on a hill.',
    brief: 'Choose a people and raise them above all others. Great cities are built on full granaries, safe walls and bold ideas.',
    objective: 'Any settlement grows to 100 people within 25 years.',
    difficulty: 3,
    seed: 3141,
    preset: 'earthlike',
    years: 25,
    setup(w) { w.civ.devotion = 300; },
    check(w, s) {
      const best = Math.max(0, ...w.civ.settlements.filter((x) => x.alive).map((x) => x.pop));
      s.progress = Math.min(1, best / 100);
      s.detail = `largest settlement ${best} · ${Math.max(0, 25 - years(w, s)).toFixed(1)} years left`;
      if (best >= 100) { s.outcome = 'Streets, fields to the horizon, a temple on the hill: your chosen people flourish.'; return 'won'; }
      if (aliveTribes(w) === 0) { s.outcome = 'No one is left to build anything.'; return 'lost'; }
      if (years(w, s) >= 25) { s.outcome = 'A generation passes, and still only villages.'; return 'lost'; }
      return 'active';
    },
  },
  {
    id: 'wrath',
    name: 'Wrath',
    tagline: 'Remember me.',
    brief: 'Their pride offends you. Cull the world — but leave one people alive, so that someone remembers what you did.',
    objective: 'Reduce the world below 25 people within 15 years, with at least one people surviving.',
    difficulty: 1,
    seed: 777,
    preset: 'earthlike',
    years: 15,
    setup(w) { w.civ.devotion = 2500; },
    check(w, s) {
      const pop = alivePeople(w);
      const tribes = aliveTribes(w);
      s.progress = Math.min(1, Math.max(0, 1 - (pop - 25) / Math.max(1, (s.memo.start ?? pop) - 25)));
      if (s.memo.start === undefined) s.memo.start = pop;
      s.detail = `${pop} people · ${tribes} peoples · ${Math.max(0, 15 - years(w, s)).toFixed(1)} years left`;
      if (tribes === 0 || pop === 0) { s.outcome = 'No one is left to remember. Wrath without witness is only noise.'; return 'lost'; }
      if (pop < 25) { s.outcome = 'A handful remain, and they will tell their children what their god can do.'; return 'won'; }
      if (years(w, s) >= 15) { s.outcome = 'They multiplied faster than your anger.'; return 'lost'; }
      return 'active';
    },
  },
  {
    id: 'green-desert',
    name: 'Green the Desert',
    tagline: 'Make the wasteland bloom.',
    brief: 'Dune is dying of thirst. Shape the land, call the rain, paint the climate — turn the sand to grass and forest.',
    objective: 'Turn a quarter more of the land green (grass, shrubs, forests) within 20 years.',
    difficulty: 2,
    seed: 4040,
    preset: 'arid',
    years: 20,
    setup(w, s) { w.civ.devotion = 600; s.memo.cover0 = greenCover(w); },
    check(w, s) {
      const cover = greenCover(w);
      const target = s.memo.cover0 + 0.25;
      s.progress = Math.min(1, Math.max(0, (cover - s.memo.cover0) / 0.25));
      s.detail = `green land ${(cover * 100).toFixed(0)}% (goal ${(target * 100).toFixed(0)}%) · ${Math.max(0, 20 - years(w, s)).toFixed(1)} years left`;
      if (cover >= target) { s.outcome = 'Where there was sand, there are meadows. The desert remembers it was once a garden.'; return 'won'; }
      if (years(w, s) >= 20) { s.outcome = 'The dunes still march. The garden will have to wait.'; return 'lost'; }
      return 'active';
    },
  },
  {
    id: 'forgotten',
    name: 'A God Forgotten',
    tagline: 'Make them believe.',
    brief: 'These peoples have forgotten you entirely. Without their faith you are nothing. Show them wonders — or terrors — until they cannot look away.',
    objective: 'Within 12 years, make the average mortal hold you in awe (faith above 50%).',
    difficulty: 2,
    seed: 9001,
    preset: 'highlands',
    years: 12,
    setup(w) {
      w.civ.devotion = 60;
      const P = w.civ.people;
      for (let i = 0; i < P.count; i++) { P.love[i] = 0; P.fear[i] = 0; }
    },
    check(w, s) {
      const f = meanFaith(w);
      s.progress = Math.min(1, f / 0.5);
      s.detail = `faith ${(f * 100).toFixed(0)}% · ${Math.max(0, 12 - years(w, s)).toFixed(1)} years left`;
      if (f >= 0.5) { s.outcome = 'Every hearth has a shrine now. You will not be forgotten again.'; return 'won'; }
      if (aliveTribes(w) === 0) { s.outcome = 'No one is left to believe.'; return 'lost'; }
      if (years(w, s) >= 12) { s.outcome = 'They shrug at your wonders. The silence closes over you.'; return 'lost'; }
      return 'active';
    },
  },
];

export function plantCover(w: World): number {
  const terr = w.planet.terrain, pd = w.plants.density;
  let cover = 0, land = 0;
  for (let c = 0; c < terr.oceanFrac.length; c++) {
    if (terr.oceanFrac[c] > 0.5) continue;
    land++;
    let s = 0;
    for (let k = 0; k < 8; k++) s += pd[c * 8 + k];
    cover += Math.min(1, s);
  }
  return land ? cover / land : 0;
}

/** Fraction of land covered by grass, shrubs, forests or reeds (not cactus or lichen). */
export function greenCover(w: World): number {
  const terr = w.planet.terrain, pd = w.plants.density;
  let cover = 0, land = 0;
  for (let c = 0; c < terr.oceanFrac.length; c++) {
    if (terr.oceanFrac[c] > 0.5) continue;
    land++;
    const o = c * 8;
    cover += Math.min(1, pd[o] + pd[o + 1] + pd[o + 2] + pd[o + 3] + pd[o + 4] + pd[o + 6]);
  }
  return land ? cover / land : 0;
}

/** Mean faith (the stronger of love and fear) of adult mortals. */
export function meanFaith(w: World): number {
  const P = w.civ.people;
  let sum = 0, n = 0;
  for (let i = 0; i < P.count; i++) {
    if (!P.alive[i] || P.age[i] < 14) continue;
    sum += Math.max(P.love[i], P.fear[i]);
    n++;
  }
  return n ? sum / n : 0;
}

export function scenarioDef(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Begin a scenario on a freshly generated world. */
export function startScenario(w: World, id: string): ScenarioState {
  const def = scenarioDef(id);
  if (!def) throw new Error(`Unknown scenario ${id}`);
  const s: ScenarioState = { id, status: 'active', startTick: w.tick, progress: 0, detail: '', outcome: '', memo: {} };
  // Setup acts are the scenario's, not the player's: free and without cooldown.
  const was = w.divine.boundless;
  w.divine.boundless = true;
  def.setup(w, s);
  w.divine.boundless = was;
  w.scenario = s;
  w.events.emit(w.tick, 'scenario', null, 0.9, { title: def.name, text: def.objective, stage: 'start' });
  return s;
}

/** Evaluate once a day; emits the ending event. */
export function tickScenario(w: World): void {
  const s = w.scenario;
  if (!s || s.status !== 'active') return;
  const def = scenarioDef(s.id);
  if (!def) return;
  const st = def.check(w, s);
  if (st !== 'active') {
    s.status = st;
    w.events.emit(w.tick, 'scenario', null, 1, { title: st === 'won' ? 'Victory' : 'Defeat', text: s.outcome, stage: st });
  }
}
