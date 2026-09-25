/**
 * Tribes (cultures/factions): procedural name, language, palette, flag,
 * personality traits, knowledge, religion and memory of the god.
 */
import { Language, type LanguageSpec, type Concept, CONCEPTS } from '../../core/language';
import type { Rng } from '../../core/rng';
import { FIELD_COUNT, STARTING_TECHS, TECH_COUNT, TECH_INDEX } from './tech';
import { Age } from './defs';

export interface Flag {
  bg: number;
  fg: number;
  /** 0 plain, 1 horizontal band, 2 vertical band, 3 cross, 4 diagonal, 5 quartered, 6 border, 7 chevron. */
  pattern: number;
  /** 0 none, 1 sun, 2 moon, 3 star, 4 tree, 5 mountain, 6 wave, 7 eye, 8 flame. */
  symbol: number;
  symColor: number;
}

export interface SacredSite {
  x: number;
  y: number;
  z: number;
  origin: string;
  tick: number;
  shrine: number; // building id or -1
}

export interface GodMemory {
  kind: string;
  tick: number;
  place: string;
  deaths: number;
  settlement: string;
}

export interface Religion {
  name: string;
  deity: string;
  /** Tenet weights, e.g. sky 0.8 = "the sky is holy/terrible". */
  tenets: Partial<Record<Concept, number>>;
  love: number;
  fear: number;
  sacredSites: SacredSite[];
  /** Lines of scripture accumulated from history. */
  scripture: string[];
  /** Tribe this faith split from (schism), -1 original. */
  parentTribe: number;
}

export interface Tribe {
  id: number;
  name: string;
  adjective: string;
  lang: LanguageSpec;
  color: number;
  color2: number;
  flag: Flag;
  founded: number;
  alive: boolean;
  capital: number;
  settlements: number[];
  known: number[]; // 0/1 per tech
  research: number[];
  age: Age;
  traits: { aggression: number; piety: number; trade: number; curiosity: number; honor: number };
  religion: Religion;
  favor: number;
  worst: GodMemory | null;
  best: GodMemory | null;
  population: number;
  soldiers: number;
  stats: { births: number; deaths: number; famineDays: number; warDays: number; plagueDays: number; kills: number };
  /** Architecture flavour 0..3 (pitched, flat-roof, round, tiered). */
  style: number;
  /** Research boosts by need (decay over time). */
  needs: number[];
}

const PATTERN_NAMES = ['plain', 'band', 'pale', 'cross', 'bend', 'quartered', 'bordure', 'chevron'];
const SYMBOL_NAMES = ['', 'sun', 'moon', 'star', 'tree', 'mountain', 'wave', 'eye', 'flame'];
export const FLAG_PATTERNS = PATTERN_NAMES;
export const FLAG_SYMBOLS = SYMBOL_NAMES;

function hsvToHex(h: number, s: number, v: number): number {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q;
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

export function createTribe(id: number, rng: Rng, tick: number, hueSlot: number, climateHint: { temp: number; coastal: boolean }): Tribe {
  const lang = new Language(rng.next());
  const name = lang.nameFor(id * 7 + 1, 'tribe');
  const hue = (hueSlot * 0.61803398875 + rng.range(-0.04, 0.04) + 1) % 1;
  const color = hsvToHex(hue, rng.range(0.62, 0.82), rng.range(0.72, 0.9));
  const color2 = hsvToHex((hue + rng.range(0.35, 0.65)) % 1, rng.range(0.25, 0.55), rng.range(0.82, 0.96));
  const known = new Array(TECH_COUNT).fill(0);
  for (const t of STARTING_TECHS) known[TECH_INDEX.get(t)!] = 1;
  if (climateHint.coastal) known[TECH_INDEX.get('rafts')!] = 1;
  const tenets: Partial<Record<Concept, number>> = {};
  // Every culture starts revering a couple of natural forces around it.
  const pool: Concept[] = climateHint.coastal ? ['sea', 'sky', 'sun', 'harvest', 'moon', 'storm'] : climateHint.temp < 5 ? ['ice', 'fire', 'sky', 'moon', 'star', 'wind'] : climateHint.temp > 22 ? ['sun', 'water', 'earth', 'fire', 'harvest', 'star'] : ['earth', 'forest', 'sky', 'sun', 'river', 'harvest'];
  for (let k = 0; k < 2; k++) tenets[rng.pick(pool)] = rng.range(0.3, 0.6);
  const deity = lang.nameFor(id * 13 + 5, 'god');
  const firstTenet = Object.keys(tenets)[0] as Concept;
  const tribe: Tribe = {
    id,
    name,
    adjective: adjectiveOf(name),
    lang: lang.spec,
    color,
    color2,
    flag: {
      bg: color,
      fg: color2,
      pattern: rng.int(0, PATTERN_NAMES.length),
      symbol: rng.int(1, SYMBOL_NAMES.length),
      symColor: rng.chance(0.5) ? 0xf2e6c8 : 0x1c1a18,
    },
    founded: tick,
    alive: true,
    capital: -1,
    settlements: [],
    known,
    research: new Array(FIELD_COUNT).fill(0),
    age: Age.Stone,
    traits: {
      aggression: rng.range(0.1, 0.9),
      piety: rng.range(0.2, 0.95),
      trade: rng.range(0.1, 0.9),
      curiosity: rng.range(0.2, 0.9),
      honor: rng.range(0.2, 0.95),
    },
    religion: {
      name: `the Way of ${capitalizeWord(lang.term(firstTenet))}`,
      deity,
      tenets,
      love: 0.1,
      fear: 0.05,
      sacredSites: [],
      scripture: [],
      parentTribe: -1,
    },
    favor: 0,
    worst: null,
    best: null,
    population: 0,
    soldiers: 0,
    stats: { births: 0, deaths: 0, famineDays: 0, warDays: 0, plagueDays: 0, kills: 0 },
    style: rng.int(0, 4),
    needs: new Array(FIELD_COUNT).fill(0),
  };
  void CONCEPTS;
  return tribe;
}

function capitalizeWord(w: string): string {
  return w ? w[0].toUpperCase() + w.slice(1) : w;
}

export function adjectiveOf(name: string): string {
  const last = name[name.length - 1];
  if ('aeiou'.includes(last)) return `${name}n`;
  if (last === 'y') return `${name.slice(0, -1)}ian`;
  return `${name}i`;
}

export function tribeLanguage(t: Tribe): Language {
  return Language.fromSpec(t.lang);
}
