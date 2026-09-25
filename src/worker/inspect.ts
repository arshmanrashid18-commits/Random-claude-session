/**
 * Builds inspector payloads (people, animals, settlements, tribes, places)
 * from live simulation state inside the worker.
 */
import type { World } from '../sim/world';
import type { InspectInfo, InspectTarget, TribeInfo } from './protocol';
import { AGE_NAMES, BUILDINGS, JOB_NAMES, PSTATE_NAMES, TIER_NAMES, RES_COUNT } from '../sim/civ/defs';
import { ROLE_NAMES } from '../sim/civ/people';
import { TECHS, TECH_INDEX, FIELD_NAMES } from '../sim/civ/tech';
import { BIOME_NAMES } from '../sim/climate/biomes';
import { PLANT_NAMES } from '../sim/ecology/plants';
import { TICKS_PER_YEAR } from '../sim/constants';
import type { GodMemory } from '../sim/civ/tribes';

const ASTATE_NAMES = ['Wandering', 'Grazing', 'Seeking water', 'Drinking', 'Fleeing', 'Hunting', 'Eating', 'Resting', 'Migrating', 'Hibernating'];

const MEMORY_TEXT: Record<string, string> = {
  lightning: 'the bolt from the sky', rain: 'the rain that came when called', mercy: 'the rain that ended the drought', drought: 'the year without rain',
  fire: 'the burning of the land', earthquake: 'the day the earth shook', volcano: 'the mountain of fire', tsunami: 'the wave that swallowed the shore',
  meteor: 'the falling star', bloom: 'the great blooming', blessing: 'the blessing', cure: 'the miraculous cure', plague: 'the sickness',
  resurrection: 'the dead who walked again', locusts: 'the cloud of locusts', inspiration: 'the dream of knowledge', vision: 'the vision',
  harmony: 'the laying down of spears', beacon: 'the pillar of light', eclipse: 'the day the sun was eaten', grove: 'the sacred grove',
};

function memoryText(m: GodMemory | undefined, yearNow: number): string {
  if (!m) return '';
  const what = MEMORY_TEXT[m.kind] ?? m.kind;
  const ago = yearNow - Math.floor(m.tick / TICKS_PER_YEAR);
  return `${what[0].toUpperCase()}${what.slice(1)} at ${m.place}${ago > 0 ? `, ${ago} year${ago > 1 ? 's' : ''} ago` : ''}${m.deaths ? ` (${m.deaths} died)` : ''}`;
}

export function inspect(w: World, target: InspectTarget): InspectInfo | null {
  const civ = w.civ;
  const yearNow = Math.floor(w.tick / TICKS_PER_YEAR);
  switch (target.kind) {
    case 'person': {
      const P = civ.people;
      const i = P.slot(target.uid);
      if (i < 0) return null;
      const t = P.tribe[i] >= 0 ? civ.tribes[P.tribe[i]] : null;
      const s = P.settle[i] >= 0 ? civ.settlements[P.settle[i]] : null;
      const sp = P.slot(P.spouse[i]);
      const worst = P.worstMem[i] >= 0 ? civ.memoryAt(P.worstMem[i]) : undefined;
      const best = P.bestMem[i] >= 0 ? civ.memoryAt(P.bestMem[i]) : undefined;
      const mem = P.love[i] >= P.fear[i] ? memoryText(best, yearNow) || memoryText(worst, yearNow) : memoryText(worst, yearNow) || memoryText(best, yearNow);
      return {
        kind: 'person', uid: target.uid, name: civ.personName(i), age: P.age[i], sex: P.sex[i],
        tribe: P.tribe[i], tribeName: t ? t.name : '', settlement: s ? s.name : 'wandering', settlementId: s ? s.id : -1,
        job: JOB_NAMES[P.job[i]], role: ROLE_NAMES[P.role[i]] ?? '', state: PSTATE_NAMES[P.state[i]],
        health: P.health[i], hunger: P.hunger[i], happiness: P.happiness[i], love: P.love[i], fear: P.fear[i],
        skills: { farm: P.skFarm[i], build: P.skBuild[i], fight: P.skFight[i], lore: P.skLore[i] },
        traits: { brave: P.brave[i], pious: P.pious[i], greedy: P.greedy[i], social: P.social[i], curious: P.curious[i] },
        spouse: sp >= 0 ? civ.personName(sp) : '', children: P.children[i], generation: P.generation[i], kills: P.kills[i],
        sick: P.sick[i] > 0, returned: P.returned[i] > 0, memory: mem,
        x: P.x[i], y: P.y[i], z: P.z[i],
      };
    }
    case 'animal': {
      const A = w.animals;
      let i = -1;
      for (let k = 0; k < A.count; k++) if (A.alive[k] && A.uid[k] === target.uid) { i = k; break; }
      if (i < 0) return null;
      const d = A.defs[A.species[i]];
      return {
        kind: 'animal', uid: target.uid, species: d.name, speciesId: d.id, diet: d.diet, age: A.age[i], sex: A.sex[i],
        health: A.health[i], hunger: A.hunger[i], thirst: A.thirst[i], state: ASTATE_NAMES[A.state[i]] ?? '',
        genes: { speed: A.gSpeed[i], size: A.gSize[i], fertility: A.gFert[i], cold: A.gCold[i], heat: A.gHeat[i] },
        generation: A.generation[i], infected: A.infected[i] === 1, population: A.pop[A.species[i]],
        x: A.x[i], y: A.y[i], z: A.z[i],
      };
    }
    case 'settlement': {
      const s = civ.settlements[target.id];
      if (!s) return null;
      const t = civ.tribes[s.tribe];
      const counts = new Map<number, number>();
      for (const id of s.buildings) {
        const b = civ.buildings[id];
        if (b.ruin || !b.complete) continue;
        counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
      }
      const jobs = new Map<number, number>();
      const P = civ.people;
      for (let i = 0; i < P.count; i++) if (P.alive[i] && P.settle[i] === s.id) jobs.set(P.job[i], (jobs.get(P.job[i]) ?? 0) + 1);
      return {
        kind: 'settlement', id: s.id, name: s.name, tribe: s.tribe, tribeName: t.name, tier: TIER_NAMES[s.tier], pop: s.pop,
        stock: s.stock.slice(0, RES_COUNT), storage: s.storage, housing: s.housing, happiness: s.happiness, faith: s.faith,
        disease: s.disease, famine: s.famine, founded: Math.floor(s.founded / TICKS_PER_YEAR) + 1, walls: s.walls, blessed: s.blessed > w.tick,
        buildings: [...counts.entries()].map(([b, count]) => ({ name: BUILDINGS[b].name, count, building: b })).sort((a, b) => b.count - a.count),
        jobs: [...jobs.entries()].map(([j, count]) => ({ name: JOB_NAMES[j], count })).sort((a, b) => b.count - a.count),
        capital: t.capital === s.id, where: w.geo.describe(s.cell), x: s.x, y: s.y, z: s.z,
      };
    }
    case 'tribe': {
      const t = civ.tribes[target.id];
      if (!t) return null;
      const so = civ.society;
      so.ensure(civ.tribes.length);
      const rel: TribeInfo['relations'] = [];
      for (const o of civ.tribes) {
        if (o.id === t.id || !o.alive || !so.contact[t.id][o.id]) continue;
        rel.push({ tribe: o.name, opinion: so.rel[t.id][o.id], pact: so.pact[t.id][o.id], war: !!so.atWar(t.id, o.id) });
      }
      const researching: string[] = [];
      for (let f = 0; f < t.research.length; f++) {
        const next = TECHS.filter((tech, k) => tech.field === f && !t.known[k] && tech.req.every((r) => t.known[TECH_INDEX.get(r)!])).sort((a, b) => a.cost - b.cost)[0];
        if (next) researching.push(`${FIELD_NAMES[f]}: ${next.name} (${Math.min(100, Math.floor((t.research[f] / next.cost) * 100))}%)`);
      }
      return {
        kind: 'tribe', id: t.id, name: t.name, adjective: t.adjective, color: t.color, color2: t.color2, flag: t.flag, alive: t.alive,
        age: AGE_NAMES[t.age], population: t.population,
        settlements: t.settlements.map((id) => civ.settlements[id]).filter((s) => s.alive).map((s) => ({ id: s.id, name: s.name, pop: s.pop, tier: TIER_NAMES[s.tier] })),
        religion: t.religion.name, deity: t.religion.deity, love: t.religion.love, fear: t.religion.fear,
        tenets: Object.entries(t.religion.tenets).map(([concept, weight]) => ({ concept, weight: weight ?? 0 })).sort((a, b) => b.weight - a.weight).slice(0, 5),
        scripture: t.religion.scripture.slice(-6),
        techs: TECHS.filter((_, k) => t.known[k]).map((x) => x.name),
        researching,
        traits: { ...t.traits },
        relations: rel,
        stats: { births: t.stats.births, deaths: t.stats.deaths, kills: t.stats.kills },
        worst: memoryText(t.worst ?? undefined, yearNow),
        best: memoryText(t.best ?? undefined, yearNow),
      };
    }
    case 'place': {
      const p = w.planet;
      const c = p.region.cellOf(target.x, target.y, target.z);
      const cl = p.climate;
      const o = civ.owner[c];
      const plants: { name: string; density: number }[] = [];
      for (let s = 0; s < 8; s++) if (w.plants.density[c * 8 + s] > 0.04) plants.push({ name: PLANT_NAMES[s], density: w.plants.density[c * 8 + s] });
      plants.sort((a, b) => b.density - a.density);
      return {
        kind: 'place', biome: BIOME_NAMES[cl.biome[c]], temp: cl.temp[c], rain: cl.meanRain[c], elevation: p.heightAt(target.x, target.y, target.z),
        soil: cl.soil[c], region: w.geo.describe(c), owner: o >= 0 && civ.settlements[o].alive ? `${civ.settlements[o].name} (${civ.tribes[civ.settlements[o].tribe].name})` : '',
        plants, fire: w.fires.intensity[c], x: target.x, y: target.y, z: target.z,
      };
    }
  }
}
