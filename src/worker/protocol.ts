/**
 * Typed message protocol between the main thread (renderer/UI) and the
 * simulation worker. Every message is a discriminated union member; large
 * payloads travel as transferable ArrayBuffers that are returned to the
 * worker after use (ping-pong), so steady-state streaming allocates nothing.
 */
import type { WorldPresetId } from '../sim/planet/presets';
import type { GameEvent } from '../sim/events';

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

export interface FrameData {
  header: FrameHeader;
  storms: StormData[];
  strikes: { x: number; y: number; z: number; power: number }[];
  events: GameEvent[];
  animals: EntitySnapshot | null;
  stats: WorldStats | null;
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
  | { type: 'init'; seed: number; preset: WorldPresetId }
  | { type: 'speed'; speed: number; paused: boolean }
  | { type: 'advance'; ticks: number; id: number }
  | { type: 'hash'; id: number }
  | { type: 'returnTextures'; tex: RegionTextures }
  | { type: 'returnSnapshot'; snap: EntitySnapshot };

export type WorkerToMain =
  | { type: 'progress'; stage: string; frac: number }
  | { type: 'ready'; data: StaticWorldData }
  | { type: 'frame'; frame: FrameData }
  | { type: 'textures'; tex: RegionTextures; tick: number }
  | { type: 'species'; species: SpeciesInfo[] }
  | { type: 'advanced'; id: number; tick: number }
  | { type: 'hash'; id: number; hash: number }
  | { type: 'error'; message: string };
