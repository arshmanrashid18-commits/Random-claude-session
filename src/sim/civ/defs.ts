/**
 * Static civilisation definitions: resources, jobs, person states, building
 * types and cultural ages.
 */

export const Res = { Food: 0, Wood: 1, Stone: 2, Metal: 3 } as const;
export type Res = (typeof Res)[keyof typeof Res];
export const RES_COUNT = 4;
export const RES_NAMES = ['food', 'wood', 'stone', 'metal'];

export const Job = {
  None: 0, Gatherer: 1, Hunter: 2, Fisher: 3, Farmer: 4, Woodcutter: 5, Quarrier: 6, Miner: 7,
  Builder: 8, Scholar: 9, Priest: 10, Merchant: 11, Soldier: 12, Child: 13, Elder: 14,
} as const;
export type Job = (typeof Job)[keyof typeof Job];
export const JOB_NAMES = ['Idle', 'Gatherer', 'Hunter', 'Fisher', 'Farmer', 'Woodcutter', 'Quarrier', 'Miner', 'Builder', 'Scholar', 'Priest', 'Merchant', 'Soldier', 'Child', 'Elder'];

export const PState = {
  Idle: 0, Walk: 1, Work: 2, Carry: 3, Eat: 4, Sleep: 5, Pray: 6, Socialize: 7, Build: 8, Flee: 9,
  Fight: 10, March: 11, Travel: 12, Mourn: 13, Celebrate: 14,
} as const;
export type PState = (typeof PState)[keyof typeof PState];
export const PSTATE_NAMES = ['Idle', 'Walking', 'Working', 'Carrying', 'Eating', 'Sleeping', 'Praying', 'Socialising', 'Building', 'Fleeing', 'Fighting', 'Marching', 'Travelling', 'Mourning', 'Celebrating'];

export const Age = { Stone: 0, Bronze: 1, Iron: 2, Classical: 3, Medieval: 4, Renaissance: 5, Industrial: 6 } as const;
export type Age = (typeof Age)[keyof typeof Age];
export const AGE_NAMES = ['Stone Age', 'Bronze Age', 'Iron Age', 'Classical Age', 'Medieval Age', 'Renaissance', 'Age of Steam'];

export const BType = {
  House: 0, Storehouse: 1, Farm: 2, Quarry: 3, Mine: 4, Temple: 5, Library: 6, Market: 7, Barracks: 8,
  Wall: 9, Tower: 10, Harbor: 11, Monument: 12, Well: 13, Workshop: 14, Observatory: 15, Healer: 16, Hall: 17,
} as const;
export type BType = (typeof BType)[keyof typeof BType];

export interface BuildingDef {
  id: BType;
  name: string;
  cost: [number, number, number, number]; // food, wood, stone, metal
  /** Labour units after materials arrive. */
  work: number;
  /** Footprint radius in world units. */
  radius: number;
  /** Tech id required (or '' for none). */
  tech: string;
  /** Minimum settlement tier: 0 camp, 1 village, 2 town, 3 city. */
  tier: number;
  /** Housing capacity. */
  housing: number;
  /** Storage capacity added. */
  storage: number;
  /** Jobs provided. */
  jobs: number;
  job: Job;
  /** Placement constraint. */
  site: 'near' | 'fields' | 'rock' | 'ore' | 'shore' | 'edge' | 'center' | 'hill';
  max: number;
}

export const BUILDINGS: BuildingDef[] = [
  { id: BType.House, name: 'House', cost: [0, 9, 0, 0], work: 30, radius: 2.4, tech: '', tier: 0, housing: 5, storage: 0, jobs: 0, job: Job.None, site: 'near', max: 999 },
  { id: BType.Storehouse, name: 'Storehouse', cost: [0, 16, 0, 0], work: 45, radius: 3.0, tech: '', tier: 0, housing: 0, storage: 120, jobs: 0, job: Job.None, site: 'center', max: 6 },
  { id: BType.Farm, name: 'Farm', cost: [0, 6, 0, 0], work: 25, radius: 5.5, tech: 'agriculture', tier: 0, housing: 0, storage: 0, jobs: 3, job: Job.Farmer, site: 'fields', max: 40 },
  { id: BType.Quarry, name: 'Quarry', cost: [0, 8, 0, 0], work: 30, radius: 3.5, tech: 'stoneworking', tier: 0, housing: 0, storage: 0, jobs: 3, job: Job.Quarrier, site: 'rock', max: 3 },
  { id: BType.Mine, name: 'Mine', cost: [0, 14, 6, 0], work: 50, radius: 3.0, tech: 'mining', tier: 1, housing: 0, storage: 0, jobs: 3, job: Job.Miner, site: 'ore', max: 3 },
  { id: BType.Temple, name: 'Temple', cost: [0, 16, 24, 2], work: 80, radius: 3.8, tech: 'ritual', tier: 1, housing: 0, storage: 0, jobs: 2, job: Job.Priest, site: 'hill', max: 2 },
  { id: BType.Library, name: 'Library', cost: [0, 20, 20, 4], work: 90, radius: 3.2, tech: 'writing', tier: 2, housing: 0, storage: 0, jobs: 3, job: Job.Scholar, site: 'center', max: 2 },
  { id: BType.Market, name: 'Market', cost: [0, 22, 10, 2], work: 60, radius: 4.0, tech: 'trade', tier: 2, housing: 0, storage: 60, jobs: 2, job: Job.Merchant, site: 'center', max: 1 },
  { id: BType.Barracks, name: 'Barracks', cost: [0, 20, 16, 8], work: 70, radius: 3.4, tech: 'warfare', tier: 1, housing: 6, storage: 0, jobs: 6, job: Job.Soldier, site: 'edge', max: 2 },
  { id: BType.Wall, name: 'Wall', cost: [0, 6, 14, 0], work: 26, radius: 3.2, tech: 'fortification', tier: 2, housing: 0, storage: 0, jobs: 0, job: Job.None, site: 'edge', max: 80 },
  { id: BType.Tower, name: 'Watchtower', cost: [0, 8, 14, 2], work: 40, radius: 1.8, tech: 'fortification', tier: 2, housing: 0, storage: 0, jobs: 1, job: Job.Soldier, site: 'edge', max: 8 },
  { id: BType.Harbor, name: 'Harbor', cost: [0, 30, 10, 4], work: 70, radius: 3.6, tech: 'sailing', tier: 1, housing: 0, storage: 40, jobs: 3, job: Job.Fisher, site: 'shore', max: 1 },
  { id: BType.Monument, name: 'Monument', cost: [0, 30, 90, 10], work: 260, radius: 4.5, tech: 'monuments', tier: 3, housing: 0, storage: 0, jobs: 0, job: Job.None, site: 'hill', max: 1 },
  { id: BType.Well, name: 'Well', cost: [0, 2, 6, 0], work: 15, radius: 1.2, tech: '', tier: 0, housing: 0, storage: 0, jobs: 0, job: Job.None, site: 'near', max: 3 },
  { id: BType.Workshop, name: 'Workshop', cost: [0, 24, 20, 12], work: 90, radius: 3.4, tech: 'smithing', tier: 1, housing: 0, storage: 0, jobs: 3, job: Job.Miner, site: 'near', max: 3 },
  { id: BType.Observatory, name: 'Observatory', cost: [0, 16, 30, 6], work: 110, radius: 3.0, tech: 'astronomy', tier: 2, housing: 0, storage: 0, jobs: 2, job: Job.Scholar, site: 'hill', max: 1 },
  { id: BType.Healer, name: 'House of Healing', cost: [0, 14, 12, 2], work: 60, radius: 3.0, tech: 'herbalism', tier: 1, housing: 0, storage: 0, jobs: 2, job: Job.Priest, site: 'near', max: 2 },
  { id: BType.Hall, name: 'Great Hall', cost: [0, 30, 30, 6], work: 120, radius: 4.2, tech: 'governance', tier: 2, housing: 4, storage: 40, jobs: 0, job: Job.None, site: 'center', max: 1 },
];

export const TIER_NAMES = ['Camp', 'Village', 'Town', 'City'];
export const TIER_POP = [0, 30, 90, 220];
