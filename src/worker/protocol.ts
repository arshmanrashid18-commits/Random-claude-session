/**
 * Typed message protocol between the main thread (renderer/UI) and the
 * simulation worker. Every message is a discriminated union member; large
 * payloads travel as transferable ArrayBuffers.
 */
import type { WorldPresetId } from '../sim/planet/presets';

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

export interface StaticWorldData {
  seed: number;
  preset: WorldPresetId;
  heightN: number;
  regionN: number;
  hydroN: number;
  heights: Float32Array;
  rivers: RiverData;
  lakes: LakeData;
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

export type MainToWorker =
  | { type: 'init'; seed: number; preset: WorldPresetId }
  | { type: 'speed'; speed: number; paused: boolean }
  | { type: 'advance'; ticks: number; id: number }
  | { type: 'hash'; id: number }
  | { type: 'returnTextures'; tex: RegionTextures };

export type WorkerToMain =
  | { type: 'progress'; stage: string; frac: number }
  | { type: 'ready'; data: StaticWorldData }
  | { type: 'frame'; header: FrameHeader }
  | { type: 'textures'; tex: RegionTextures; tick: number }
  | { type: 'advanced'; id: number; tick: number }
  | { type: 'hash'; id: number; hash: number }
  | { type: 'error'; message: string };
