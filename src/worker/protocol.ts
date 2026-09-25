/**
 * Typed message protocol between the main thread (renderer/UI) and the
 * simulation worker. Every message is a discriminated union member; large
 * payloads travel as transferable ArrayBuffers that are returned to the
 * worker after use (ping-pong), so steady-state streaming allocates nothing.
 */
import type { WorldPresetId } from '../sim/planet/presets';
import type { GameEvent } from '../sim/events';
import type { Command } from '../sim/world';
import type { PowerId } from '../sim/powers/defs';

export type { Command };

export interface RiverData {
  points: Float32Array;
  width: Float32Array;
  level: Float32Array;
  /** Start offset (in points) of each river; length = rivers + 1. */
  offsets: Int32Array;
}

export interface LakeData {
  /** Hydro cell indices of all lake cells. */
  cells: Int32Array;
  /** Water level per lake cell. */
  levels: Float32Array;
}

export interface SpeciesInfo {
  id: number;
  name: string;
  plural: string;
  body: string;
  diet: string;
  size: number;
  colour: number;
  colour2: number;
  parent: number;
}

export interface StaticWorldData {
  seed: number;
  preset: WorldPresetId;
  heightN: number;
  regionN: number;
  hydroN: number;
  heights: Float32Array;
  rivers: RiverData;
  lakes: LakeData;
  species: SpeciesInfo[];
  /** Past events (only when resuming a saved world). */
  history?: GameEvent[];
}

export interface SaveInfo {
  seed: number;
  preset: string;
  tick: number;
  name: string;
  people: number;
  when: number;
}

/** Region textures: padded (n+2)²×6 RGBA8 arrays. */
export interface RegionTextures {
  /** R: temperature, G: long-term moisture, B: snow cover, A: cloud cover. */
  climate: Uint8Array;
  /** R: grass, G: shrub, B: broadleaf, A: conifer. */
  vegA: Uint8Array;
  /** R: tropical, G: cactus/xeric, B: reeds, A: moss. */
  vegB: Uint8Array;
  /** R: burn scar, G: ash, B: lava, A: settlement/development. */
  surface: Uint8Array;
  /** R: current rain rate, G: fog, B: fire intensity, A: flood water. */
  fx: Uint8Array;
  /** R: owning tribe + 1 (0 = none), G: settlement tier, B: war front, A: unused. Nearest-filtered. */
  owner: Uint8Array;
}

export interface StormData {
  id: number;
  type: number;
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  intensity: number;
}

/**
 * Entity snapshot for one kind of agent. `pos` holds unit directions
 * (xyz per slot); `info` holds two uint32 per slot: uid and a packed word
 * (species/kind 8 bits | state 8 bits | size 8 bits | flags 8 bits).
 */
export interface EntitySnapshot {
  kind: 'animals' | 'people';
  tick: number;
  count: number;
  pos: Float32Array;
  info: Uint32Array;
}

export interface FrameHeader {
  tick: number;
  /** Effective simulation ticks per real second over the last interval. */
  tps: number;
  /** Milliseconds of simulation work per tick (moving average). */
  simMs: number;
  speed: number;
  paused: boolean;
}

/** A divine effect as the renderer needs it. */
export interface EffectData {
  id: number;
  power: PowerId;
  x: number; y: number; z: number;
  radius: number;
  start: number;
  end: number;
  phase: number;
  combo: string;
  dx: number; dy: number; dz: number;
}

export interface FrameData {
  header: FrameHeader;
  effects: EffectData[];
  /** Remaining cooldown ticks per power (POWERS order). */
  cooldowns: number[];
  boundless: boolean;
  /** Global temperature offset (ice ages). */
  chill: number;
  scenario: { id: string; status: 'active' | 'won' | 'lost'; progress: number; detail: string; outcome: string } | null;
  storms: StormData[];
  strikes: { x: number; y: number; z: number; power: number }[];
  events: GameEvent[];
  animals: EntitySnapshot | null;
  people: EntitySnapshot | null;
  stats: WorldStats | null;
  devotion: number;
  devotionRate: number;
}

export interface BuildingData {
  id: number;
  type: number;
  x: number; y: number; z: number;
  rot: number;
  progress: number;
  complete: boolean;
  ruin: boolean;
  age: number;
  style: number;
  tribe: number;
  settle: number;
  growth: number;
}

export interface SettlementData {
  id: number;
  name: string;
  tribe: number;
  x: number; y: number; z: number;
  tier: number;
  pop: number;
  alive: boolean;
  radius: number;
  stock: number[];
  walls: boolean;
}

export interface TribeData {
  id: number;
  name: string;
  adjective: string;
  color: number;
  color2: number;
  flag: { bg: number; fg: number; pattern: number; symbol: number; symColor: number };
  alive: boolean;
  age: number;
  population: number;
  religion: string;
  deity: string;
  capital: number;
  techCount: number;
}

export interface CivData {
  version: number;
  buildings: BuildingData[];
  roads: Float32Array; // ax,ay,az,bx,by,bz,level per segment
  settlements: SettlementData[];
  tribes: TribeData[];
}

export type InspectTarget =
  | { kind: 'person'; uid: number }
  | { kind: 'animal'; uid: number }
  | { kind: 'settlement'; id: number }
  | { kind: 'tribe'; id: number }
  | { kind: 'place'; x: number; y: number; z: number };

export interface PersonInfo {
  kind: 'person';
  uid: number;
  name: string;
  age: number;
  sex: number;
  tribe: number;
  tribeName: string;
  settlement: string;
  settlementId: number;
  job: string;
  role: string;
  state: string;
  health: number;
  hunger: number;
  happiness: number;
  love: number;
  fear: number;
  skills: { farm: number; build: number; fight: number; lore: number };
  traits: { brave: number; pious: number; greedy: number; social: number; curious: number };
  spouse: string;
  children: number;
  generation: number;
  kills: number;
  sick: boolean;
  returned: boolean;
  memory: string;
  x: number; y: number; z: number;
}

export interface AnimalInfo {
  kind: 'animal';
  uid: number;
  species: string;
  speciesId: number;
  diet: string;
  age: number;
  sex: number;
  health: number;
  hunger: number;
  thirst: number;
  state: string;
  genes: { speed: number; size: number; fertility: number; cold: number; heat: number };
  generation: number;
  infected: boolean;
  population: number;
  x: number; y: number; z: number;
}

export interface SettlementInfo {
  kind: 'settlement';
  id: number;
  name: string;
  tribe: number;
  tribeName: string;
  tier: string;
  pop: number;
  stock: number[];
  storage: number;
  housing: number;
  happiness: number;
  faith: number;
  disease: number;
  famine: number;
  founded: number;
  walls: boolean;
  blessed: boolean;
  buildings: { name: string; count: number; building: number }[];
  jobs: { name: string; count: number }[];
  capital: boolean;
  where: string;
  x: number; y: number; z: number;
}

export interface TribeInfo {
  kind: 'tribe';
  id: number;
  name: string;
  adjective: string;
  color: number;
  color2: number;
  flag: TribeData['flag'];
  alive: boolean;
  age: string;
  population: number;
  settlements: { id: number; name: string; pop: number; tier: string }[];
  religion: string;
  deity: string;
  love: number;
  fear: number;
  tenets: { concept: string; weight: number }[];
  scripture: string[];
  techs: string[];
  researching: string[];
  traits: { aggression: number; piety: number; trade: number; curiosity: number; honor: number };
  relations: { tribe: string; opinion: number; pact: number; war: boolean }[];
  stats: { births: number; deaths: number; kills: number };
  worst: string;
  best: string;
}

export interface PlaceInfo {
  kind: 'place';
  biome: string;
  temp: number;
  rain: number;
  elevation: number;
  soil: number;
  region: string;
  owner: string;
  plants: { name: string; density: number }[];
  fire: number;
  x: number; y: number; z: number;
}

export type InspectInfo = PersonInfo | AnimalInfo | SettlementInfo | TribeInfo | PlaceInfo;

export interface EcologyData {
  tick: number;
  species: SpeciesInfo[];
  alive: number[];
  /** Population history per species id, oldest first. */
  history: number[][];
  /** Ticks between history samples. */
  interval: number;
  records: { tick: number; kind: 'speciation' | 'extinction'; name: string; parent?: string; where?: string }[];
  /** Deaths per species by cause (starvation, thirst, old age, predation, disease, fire, cold/heat, disaster). */
  deaths: number[][];
  biomes: Uint8Array;
  regionN: number;
  shannon: number;
  plantCover: number;
  people: number;
}

export interface WorldStats {
  animals: number;
  species: number;
  biodiversity: number;
  plantCover: number;
  /** Population per species (index = species id). */
  pop: number[];
  fires: number;
}

export type MainToWorker =
  | { type: 'init'; seed: number; preset: WorldPresetId; scenario?: string; boundless?: boolean }
  | { type: 'speed'; speed: number; paused: boolean }
  | { type: 'advance'; ticks: number; id: number }
  | { type: 'hash'; id: number }
  | { type: 'returnTextures'; tex: RegionTextures }
  | { type: 'returnSnapshot'; snap: EntitySnapshot }
  | { type: 'command'; cmd: Command; id: number }
  | { type: 'inspect'; target: InspectTarget; id: number }
  | { type: 'ecology'; id: number }
  | { type: 'save'; id: number; name: string }
  | { type: 'load'; data: Uint8Array };

export type WorkerToMain =
  | { type: 'progress'; stage: string; frac: number }
  | { type: 'ready'; data: StaticWorldData }
  | { type: 'frame'; frame: FrameData }
  | { type: 'textures'; tex: RegionTextures; tick: number }
  | { type: 'species'; species: SpeciesInfo[] }
  | { type: 'civ'; civ: CivData }
  | { type: 'advanced'; id: number; tick: number }
  | { type: 'hash'; id: number; hash: number }
  | { type: 'error'; message: string }
  | { type: 'commandResult'; id: number; ok: boolean; message: string; combo?: string }
  | { type: 'heights'; faces: number[]; data: Float32Array[] }
  | { type: 'water'; rivers: RiverData; lakes: LakeData }
  | { type: 'inspect'; id: number; info: InspectInfo | null }
  | { type: 'ecology'; id: number; data: EcologyData }
  | { type: 'saved'; id: number; data: Uint8Array | null; meta?: SaveInfo; error?: string };
