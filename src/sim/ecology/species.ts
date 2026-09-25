/**
 * Animal species definitions. Base species are fixed; new species can arise
 * through speciation (a drifted population on another landmass) or divine
 * creation. Each species references a body plan used by the renderer.
 */
import { Biome } from '../climate/biomes';

export type Diet = 'herbivore' | 'carnivore' | 'omnivore';
export type BodyPlan = 'deer' | 'hare' | 'bovine' | 'gazelle' | 'camel' | 'goat' | 'caribou' | 'tapir' | 'wolf' | 'lion' | 'bear' | 'cat' | 'fox';

export interface SpeciesDef {
  id: number;
  name: string;
  plural: string;
  diet: Diet;
  body: BodyPlan;
  /** Base body size (world units, ~shoulder height). */
  size: number;
  /** Base speed (world units per tick). */
  speed: number;
  /** Biomes it thrives in, with weights. */
  biomes: Partial<Record<Biome, number>>;
  /** Comfortable temperature range (°C). */
  tMin: number;
  tMax: number;
  herdMin: number;
  herdMax: number;
  /** Maturity and max age in years. */
  adultAge: number;
  maxAge: number;
  /** Offspring per birth and gestation in ticks. */
  litter: number;
  gestation: number;
  /** Hunger gained per tick at size 1 (0..1 scale). */
  metabolism: number;
  /** Prey species ids (predators). */
  prey: number[];
  /** Sight radius (world units). */
  sight: number;
  /** Food value when eaten. */
  meat: number;
  migratory: boolean;
  nocturnal: boolean;
  hibernates: boolean;
  colour: number;
  colour2: number;
  /** Parent species for derived species (speciation), -1 for base species. */
  parent: number;
  /** Soft population target (density dependence). */
  softCap: number;
}

const B = Biome;

export const BASE_SPECIES: SpeciesDef[] = [
  { id: 0, name: 'Deer', plural: 'deer', diet: 'herbivore', body: 'deer', size: 1.1, speed: 0.34, biomes: { [B.TemperateForest]: 1, [B.Taiga]: 0.6, [B.Grassland]: 0.5, [B.Wetland]: 0.3 }, tMin: -12, tMax: 28, herdMin: 3, herdMax: 7, adultAge: 1.5, maxAge: 12, litter: 1, gestation: 500, metabolism: 0.0022, prey: [], sight: 22, meat: 0.8, migratory: false, nocturnal: false, hibernates: false, colour: 0x8a5a36, colour2: 0xd8c2a0, parent: -1, softCap: 364 },
  { id: 1, name: 'Hare', plural: 'hares', diet: 'herbivore', body: 'hare', size: 0.35, speed: 0.38, biomes: { [B.Grassland]: 1, [B.Tundra]: 0.6, [B.TemperateForest]: 0.5, [B.Savanna]: 0.4, [B.Taiga]: 0.4 }, tMin: -25, tMax: 32, herdMin: 1, herdMax: 2, adultAge: 0.4, maxAge: 5, litter: 3, gestation: 220, metabolism: 0.0026, prey: [], sight: 14, meat: 0.3, migratory: false, nocturnal: false, hibernates: false, colour: 0x9c8466, colour2: 0xe8e0d0, parent: -1, softCap: 490 },
  { id: 2, name: 'Bison', plural: 'bison', diet: 'herbivore', body: 'bovine', size: 1.8, speed: 0.26, biomes: { [B.Grassland]: 1, [B.Savanna]: 0.3, [B.Taiga]: 0.2 }, tMin: -20, tMax: 30, herdMin: 8, herdMax: 22, adultAge: 2.5, maxAge: 18, litter: 1, gestation: 700, metabolism: 0.0018, prey: [], sight: 20, meat: 2.2, migratory: true, nocturnal: false, hibernates: false, colour: 0x4a3222, colour2: 0x2a1c14, parent: -1, softCap: 336 },
  { id: 3, name: 'Gazelle', plural: 'gazelles', diet: 'herbivore', body: 'gazelle', size: 0.9, speed: 0.44, biomes: { [B.Savanna]: 1, [B.Grassland]: 0.5, [B.Desert]: 0.2 }, tMin: 5, tMax: 42, herdMin: 6, herdMax: 18, adultAge: 1.2, maxAge: 11, litter: 1, gestation: 420, metabolism: 0.0021, prey: [], sight: 26, meat: 0.7, migratory: true, nocturnal: false, hibernates: false, colour: 0xc2894a, colour2: 0xf0e2c8, parent: -1, softCap: 392 },
  { id: 4, name: 'Camel', plural: 'camels', diet: 'herbivore', body: 'camel', size: 2.0, speed: 0.24, biomes: { [B.Desert]: 1, [B.Savanna]: 0.4 }, tMin: -5, tMax: 48, herdMin: 2, herdMax: 7, adultAge: 3, maxAge: 25, litter: 1, gestation: 800, metabolism: 0.0014, prey: [], sight: 24, meat: 2.0, migratory: false, nocturnal: false, hibernates: false, colour: 0xc19a64, colour2: 0xa27a48, parent: -1, softCap: 182 },
  { id: 5, name: 'Ibex', plural: 'ibex', diet: 'herbivore', body: 'goat', size: 0.9, speed: 0.32, biomes: { [B.Alpine]: 1, [B.Tundra]: 0.3, [B.Taiga]: 0.2 }, tMin: -30, tMax: 22, herdMin: 3, herdMax: 9, adultAge: 1.5, maxAge: 14, litter: 1, gestation: 440, metabolism: 0.0019, prey: [], sight: 24, meat: 0.8, migratory: false, nocturnal: false, hibernates: false, colour: 0x8c7a62, colour2: 0x5a4a38, parent: -1, softCap: 210 },
  { id: 6, name: 'Caribou', plural: 'caribou', diet: 'herbivore', body: 'caribou', size: 1.4, speed: 0.33, biomes: { [B.Tundra]: 1, [B.Taiga]: 0.7, [B.Ice]: 0.1 }, tMin: -40, tMax: 18, herdMin: 8, herdMax: 25, adultAge: 2, maxAge: 15, litter: 1, gestation: 560, metabolism: 0.002, prey: [], sight: 22, meat: 1.4, migratory: true, nocturnal: false, hibernates: false, colour: 0x7a6a58, colour2: 0xd8d0c0, parent: -1, softCap: 364 },
  { id: 7, name: 'Tapir', plural: 'tapirs', diet: 'herbivore', body: 'tapir', size: 1.0, speed: 0.24, biomes: { [B.Rainforest]: 1, [B.Wetland]: 0.8 }, tMin: 12, tMax: 38, herdMin: 1, herdMax: 3, adultAge: 2, maxAge: 20, litter: 1, gestation: 700, metabolism: 0.0018, prey: [], sight: 16, meat: 1.2, migratory: false, nocturnal: true, hibernates: false, colour: 0x3a3a3e, colour2: 0xd0d0d0, parent: -1, softCap: 210 },
  { id: 8, name: 'Wolf', plural: 'wolves', diet: 'carnivore', body: 'wolf', size: 0.8, speed: 0.42, biomes: { [B.Taiga]: 1, [B.TemperateForest]: 0.7, [B.Tundra]: 0.8, [B.Grassland]: 0.4 }, tMin: -35, tMax: 26, herdMin: 3, herdMax: 7, adultAge: 1.5, maxAge: 11, litter: 3, gestation: 360, metabolism: 0.00105, prey: [0, 1, 2, 6, 5], sight: 44, meat: 0.6, migratory: false, nocturnal: true, hibernates: false, colour: 0x6f6a64, colour2: 0xbab4ac, parent: -1, softCap: 77 },
  { id: 9, name: 'Lion', plural: 'lions', diet: 'carnivore', body: 'lion', size: 1.1, speed: 0.46, biomes: { [B.Savanna]: 1, [B.Grassland]: 0.6, [B.Desert]: 0.2 }, tMin: 8, tMax: 44, herdMin: 2, herdMax: 6, adultAge: 2.5, maxAge: 14, litter: 2, gestation: 460, metabolism: 0.00082, prey: [3, 2, 4, 1], sight: 47, meat: 1.0, migratory: false, nocturnal: true, hibernates: false, colour: 0xc9964e, colour2: 0x7a4a24, parent: -1, softCap: 56 },
  { id: 10, name: 'Bear', plural: 'bears', diet: 'omnivore', body: 'bear', size: 1.3, speed: 0.34, biomes: { [B.TemperateForest]: 1, [B.Taiga]: 1, [B.Tundra]: 0.3, [B.Alpine]: 0.3 }, tMin: -30, tMax: 26, herdMin: 1, herdMax: 1, adultAge: 3, maxAge: 22, litter: 2, gestation: 820, metabolism: 0.00088, prey: [0, 1, 5, 7], sight: 34, meat: 1.6, migratory: false, nocturnal: false, hibernates: true, colour: 0x4a3526, colour2: 0x3a281c, parent: -1, softCap: 49 },
  { id: 11, name: 'Jaguar', plural: 'jaguars', diet: 'carnivore', body: 'cat', size: 0.8, speed: 0.44, biomes: { [B.Rainforest]: 1, [B.Wetland]: 0.5, [B.Savanna]: 0.2 }, tMin: 14, tMax: 40, herdMin: 1, herdMax: 1, adultAge: 2.5, maxAge: 13, litter: 2, gestation: 420, metabolism: 0.00076, prey: [7, 0, 1, 3], sight: 39, meat: 0.8, migratory: false, nocturnal: true, hibernates: false, colour: 0xd49a3a, colour2: 0x2a1e12, parent: -1, softCap: 42 },
  { id: 12, name: 'Fox', plural: 'foxes', diet: 'carnivore', body: 'fox', size: 0.45, speed: 0.4, biomes: { [B.TemperateForest]: 0.8, [B.Grassland]: 0.8, [B.Tundra]: 0.8, [B.Taiga]: 0.6, [B.Desert]: 0.3 }, tMin: -30, tMax: 36, herdMin: 1, herdMax: 1, adultAge: 1, maxAge: 8, litter: 3, gestation: 300, metabolism: 0.00121, prey: [1], sight: 31, meat: 0.3, migratory: false, nocturnal: true, hibernates: false, colour: 0xc86a2a, colour2: 0xf2ece4, parent: -1, softCap: 84 },
];

export const HERBIVORE_IDS = BASE_SPECIES.filter((s) => s.diet === 'herbivore').map((s) => s.id);
export const PREDATOR_IDS = BASE_SPECIES.filter((s) => s.diet !== 'herbivore').map((s) => s.id);

/** Habitat suitability of a species for a biome and temperature (0..1). */
export function habitat(def: SpeciesDef, biome: number, temp: number, coldTol: number, heatTol: number): number {
  const b = def.biomes[biome as Biome] ?? 0;
  const lo = def.tMin - coldTol * 12, hi = def.tMax + heatTol * 12;
  const tf = temp < lo ? Math.max(0, 1 - (lo - temp) / 10) : temp > hi ? Math.max(0, 1 - (temp - hi) / 10) : 1;
  return b * tf;
}
