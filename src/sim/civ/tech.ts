/**
 * Technology tree: 50 discoveries across eight fields. Tribes earn research
 * in each field from their population and scholars, and far more from *need*:
 * famine pushes agriculture, war pushes weapons and metallurgy, a coastline
 * pushes seafaring, plague pushes medicine, and omens in the sky (meteors,
 * eclipses, aurorae — often the god's doing) push astronomy. A technology is
 * discovered once its field has enough research and its prerequisites are
 * known. Key technologies mark the transition between ages.
 */
import { Age } from './defs';

export const TechField = {
  Agriculture: 0, Metallurgy: 1, Seafaring: 2, Writing: 3, Medicine: 4, Astronomy: 5, War: 6, Industry: 7,
} as const;
export type TechField = (typeof TechField)[keyof typeof TechField];
export const FIELD_NAMES = ['Agriculture', 'Metallurgy', 'Seafaring', 'Writing', 'Medicine', 'Astronomy', 'War', 'Industry'];
export const FIELD_COUNT = 8;

export interface TechDef {
  id: string;
  name: string;
  field: TechField;
  cost: number;
  req: string[];
  /** Reaching this technology begins an age. */
  age?: Age;
  desc: string;
}

const A = TechField.Agriculture, M = TechField.Metallurgy, S = TechField.Seafaring, W = TechField.Writing;
const H = TechField.Medicine, X = TechField.Astronomy, R = TechField.War, I = TechField.Industry;

export const TECHS: TechDef[] = [
  // Agriculture (7)
  { id: 'foraging', name: 'Foraging', field: A, cost: 0, req: [], desc: 'Gather berries, roots and nuts.' },
  { id: 'agriculture', name: 'Agriculture', field: A, cost: 6, req: ['foraging'], desc: 'Sow and harvest fields.' },
  { id: 'husbandry', name: 'Animal Husbandry', field: A, cost: 14, req: ['agriculture'], desc: 'Herd and breed animals; hunting yields more.' },
  { id: 'irrigation', name: 'Irrigation', field: A, cost: 26, req: ['agriculture', 'pottery'], desc: 'Canals carry river water to fields.' },
  { id: 'croprotation', name: 'Crop Rotation', field: A, cost: 60, req: ['irrigation'], desc: 'Fields stay fertile year after year.' },
  { id: 'plough', name: 'Heavy Plough', field: A, cost: 90, req: ['croprotation', 'ironworking'], desc: 'Iron ploughs break heavy soils.' },
  { id: 'windmills', name: 'Windmills', field: A, cost: 150, req: ['plough', 'engineering'], desc: 'Grain is milled by the wind.' },
  // Metallurgy (7)
  { id: 'stoneworking', name: 'Stoneworking', field: M, cost: 0, req: [], desc: 'Shape stone into tools and walls.' },
  { id: 'mining', name: 'Mining', field: M, cost: 10, req: ['stoneworking'], desc: 'Dig ore from the mountains.' },
  { id: 'copper', name: 'Copper Working', field: M, cost: 18, req: ['mining'], desc: 'The first soft metal.' },
  { id: 'bronze', name: 'Bronze Casting', field: M, cost: 30, req: ['copper', 'pottery'], age: Age.Bronze, desc: 'Copper and tin make bronze. The Bronze Age dawns.' },
  { id: 'smithing', name: 'Smithing', field: M, cost: 40, req: ['bronze'], desc: 'Workshops forge tools and blades.' },
  { id: 'ironworking', name: 'Iron Smelting', field: M, cost: 64, req: ['smithing'], age: Age.Iron, desc: 'Iron from bog and hill. The Iron Age begins.' },
  { id: 'steel', name: 'Steel', field: M, cost: 130, req: ['ironworking', 'engineering'], desc: 'Hard, bright steel.' },
  // Seafaring (6)
  { id: 'rafts', name: 'Rafts', field: S, cost: 5, req: [], desc: 'Logs lashed together float.' },
  { id: 'sailing', name: 'Sailing', field: S, cost: 20, req: ['rafts'], desc: 'Harbors and sailing boats; fishing fleets.' },
  { id: 'navigation', name: 'Navigation', field: S, cost: 50, req: ['sailing', 'starlore'], desc: 'Steer by the stars across open sea.' },
  { id: 'cartography', name: 'Cartography', field: S, cost: 80, req: ['navigation', 'writing'], desc: 'Maps of distant shores.' },
  { id: 'galleons', name: 'Galleons', field: S, cost: 150, req: ['cartography', 'steel'], desc: 'Great ships cross oceans.' },
  { id: 'steamships', name: 'Steamships', field: S, cost: 320, req: ['galleons', 'steam'], desc: 'Ships that need no wind.' },
  // Writing & society (8)
  { id: 'ritual', name: 'Ritual', field: W, cost: 3, req: [], desc: 'Shrines and offerings to the one above.' },
  { id: 'pottery', name: 'Pottery', field: W, cost: 8, req: [], desc: 'Clay vessels store food and water.' },
  { id: 'pictographs', name: 'Pictographs', field: W, cost: 16, req: ['ritual'], desc: 'Marks that hold meaning.' },
  { id: 'writing', name: 'Writing', field: W, cost: 34, req: ['pictographs'], desc: 'Libraries and records.' },
  { id: 'trade', name: 'Currency & Trade', field: W, cost: 28, req: ['pottery'], desc: 'Markets and caravans.' },
  { id: 'governance', name: 'Governance', field: W, cost: 55, req: ['writing', 'trade'], desc: 'Laws, councils and great halls.' },
  { id: 'philosophy', name: 'Philosophy', field: W, cost: 90, req: ['governance', 'mathematics'], age: Age.Classical, desc: 'Questions without end. The Classical Age.' },
  { id: 'printing', name: 'Printing Press', field: W, cost: 200, req: ['philosophy', 'engineering'], age: Age.Renaissance, desc: 'Ideas spread like fire. The Renaissance.' },
  // Medicine (5)
  { id: 'herbalism', name: 'Herbalism', field: H, cost: 12, req: ['foraging'], desc: 'Healing plants and houses of healing.' },
  { id: 'sanitation', name: 'Sanitation', field: H, cost: 40, req: ['herbalism', 'pottery'], desc: 'Clean water slows disease.' },
  { id: 'anatomy', name: 'Anatomy', field: H, cost: 85, req: ['sanitation', 'writing'], desc: 'The body understood.' },
  { id: 'quarantine', name: 'Quarantine', field: H, cost: 110, req: ['anatomy', 'governance'], desc: 'Plagues are contained.' },
  { id: 'vaccination', name: 'Vaccination', field: H, cost: 240, req: ['quarantine', 'optics'], desc: 'Disease itself is tamed.' },
  // Astronomy (6)
  { id: 'starlore', name: 'Star Lore', field: X, cost: 8, req: ['ritual'], desc: 'Stories written in the night sky.' },
  { id: 'calendar', name: 'Calendar', field: X, cost: 22, req: ['starlore'], desc: 'Seasons counted; harvests planned.' },
  { id: 'mathematics', name: 'Mathematics', field: X, cost: 45, req: ['calendar', 'pictographs'], desc: 'Numbers to measure the world.' },
  { id: 'astronomy', name: 'Astronomy', field: X, cost: 70, req: ['mathematics'], desc: 'Observatories chart the heavens.' },
  { id: 'optics', name: 'Optics', field: X, cost: 150, req: ['astronomy', 'steel'], desc: 'Lenses reveal the small and the far.' },
  { id: 'physics', name: 'Physics', field: X, cost: 210, req: ['optics', 'printing'], desc: 'The laws beneath all things.' },
  // War (7)
  { id: 'warfare', name: 'Organised Warfare', field: R, cost: 12, req: ['stoneworking'], desc: 'Warriors, barracks and raids.' },
  { id: 'archery', name: 'Archery', field: R, cost: 20, req: ['warfare'], desc: 'Death from a distance.' },
  { id: 'fortification', name: 'Fortification', field: R, cost: 34, req: ['warfare', 'masonry'], desc: 'Walls and watchtowers.' },
  { id: 'bronzeweapons', name: 'Bronze Weapons', field: R, cost: 40, req: ['bronze', 'warfare'], desc: 'Bronze spears and shields.' },
  { id: 'siegecraft', name: 'Siegecraft', field: R, cost: 90, req: ['fortification', 'engineering'], desc: 'Rams and catapults break walls.' },
  { id: 'castles', name: 'Castles', field: R, cost: 140, req: ['siegecraft', 'steel'], age: Age.Medieval, desc: 'Keeps and curtain walls. The Middle Ages.' },
  { id: 'gunpowder', name: 'Gunpowder', field: R, cost: 230, req: ['castles', 'physics'], desc: 'Fire and thunder in a tube.' },
  // Industry (6)
  { id: 'masonry', name: 'Masonry', field: I, cost: 14, req: ['stoneworking'], desc: 'Cut stone buildings.' },
  { id: 'monuments', name: 'Monuments', field: I, cost: 50, req: ['masonry', 'ritual', 'mathematics'], desc: 'Great works to outlast their makers.' },
  { id: 'engineering', name: 'Engineering', field: I, cost: 80, req: ['masonry', 'mathematics'], desc: 'Arches, aqueducts and cranes.' },
  { id: 'architecture', name: 'Architecture', field: I, cost: 120, req: ['engineering', 'philosophy'], desc: 'Grand domes and spires.' },
  { id: 'steam', name: 'Steam Power', field: I, cost: 300, req: ['physics', 'steel', 'architecture'], age: Age.Industrial, desc: 'Fire made to work. The Age of Steam.' },
  { id: 'factories', name: 'Factories', field: I, cost: 360, req: ['steam'], desc: 'Smoke and plenty.' },
];

export const TECH_INDEX = new Map(TECHS.map((t, i) => [t.id, i]));
export const TECH_COUNT = TECHS.length;

/** Techs every tribe starts with. */
export const STARTING_TECHS = ['foraging', 'stoneworking', 'ritual'];

/** Verify the tree: every requirement exists and every tech is reachable. */
export function validateTechTree(): { ok: boolean; unreachable: string[]; missing: string[] } {
  const missing: string[] = [];
  for (const t of TECHS) for (const r of t.req) if (!TECH_INDEX.has(r)) missing.push(`${t.id}->${r}`);
  const known = new Set(STARTING_TECHS);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of TECHS) {
      if (known.has(t.id)) continue;
      if (t.req.every((r) => known.has(r))) { known.add(t.id); changed = true; }
    }
  }
  const unreachable = TECHS.filter((t) => !known.has(t.id)).map((t) => t.id);
  return { ok: missing.length === 0 && unreachable.length === 0, unreachable, missing };
}

/** Age reached with a set of known techs. */
export function ageOf(known: Uint8Array): Age {
  let age: Age = Age.Stone;
  for (let i = 0; i < TECHS.length; i++) {
    const a = TECHS[i].age;
    if (known[i] && a !== undefined && a > age) age = a;
  }
  return age;
}
