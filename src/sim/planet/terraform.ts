/**
 * Terraforming: brush strokes and disaster deformations applied to the
 * vertex heightmap, followed by an incremental refresh of everything derived
 * from terrain (region statistics, drainage, rivers, lakes, climate gradients).
 *
 * Deformations are accumulated during a stroke; `commit()` performs the
 * expensive hydrology rebuild once and reports which cube faces changed so
 * the renderer can re-upload just those layers.
 */
import { FACE_N, FACE_U, FACE_V } from './cubesphere';
import type { Planet } from './planet';
import { PLANET_RADIUS } from '../constants';

export type BrushTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'flood' | 'drain' | 'paint';
export const BRUSH_TOOLS: BrushTool[] = ['raise', 'lower', 'smooth', 'flatten', 'flood', 'drain', 'paint'];

/** Biome paint targets (temperature °C offset, rainfall multiplier-ish offset). */
export const PAINT_TARGETS = [
  { name: 'Forest', temp: 0, rain: 1.1 },
  { name: 'Grassland', temp: 1, rain: 0.2 },
  { name: 'Desert', temp: 5, rain: -1.6 },
  { name: 'Jungle', temp: 7, rain: 2.2 },
  { name: 'Tundra', temp: -14, rain: -0.2 },
  { name: 'Wetland', temp: 0, rain: 2.0 },
] as const;

export const MIN_HEIGHT = -40;
export const MAX_HEIGHT = 48;

export interface BrushStroke {
  tool: BrushTool;
  x: number;
  y: number;
  z: number;
  /** Brush radius in world units. */
  radius: number;
  /** 0..1 strength per application. */
  strength: number;
  /** Paint target index (PAINT_TARGETS) for the paint tool. */
  paint?: number;
  /** Flatten target height (captured at stroke start). */
  level?: number;
}

export class Terraformer {
  readonly planet: Planet;
  readonly dirtyFaces = new Set<number>();
  readonly dirtyCells = new Set<number>();
  private scratch = new Float32Array(3);
  /** Total absolute height change since the last commit. */
  changed = 0;
  /** Faces changed since the renderer last fetched them. */
  readonly renderDirty = new Set<number>();
  /** Called after derived data was rebuilt (world reacts: water, paths, flooding). */
  onCommit: () => void = () => {};

  constructor(planet: Planet) {
    this.planet = planet;
  }

  /**
   * Visit every height vertex within `radiusAng` (radians) of direction c.
   * The callback receives the vertex index, its direction and the normalised
   * angular distance t ∈ [0,1).
   */
  forEachVertex(cx: number, cy: number, cz: number, radiusAng: number, fn: (idx: number, x: number, y: number, z: number, t: number) => void): void {
    const hg = this.planet.hg;
    const n = hg.n;
    const cosR = Math.cos(radiusAng);
    const span = Math.ceil((radiusAng / (Math.PI / 2)) * n * 1.6) + 2;
    const d = this.scratch;
    for (let f = 0; f < 6; f++) {
      const N = FACE_N[f], U = FACE_U[f], V = FACE_V[f];
      const dn = cx * N[0] + cy * N[1] + cz * N[2];
      if (dn < 0.05) continue;
      const u = (cx * U[0] + cy * U[1] + cz * U[2]) / dn;
      const v = (cx * V[0] + cy * V[1] + cz * V[2]) / dn;
      const a = Math.atan(u) * (4 / Math.PI), b = Math.atan(v) * (4 / Math.PI);
      const ci = Math.round(((a + 1) / 2) * n), cj = Math.round(((b + 1) / 2) * n);
      const i0 = Math.max(0, ci - span), i1 = Math.min(n, ci + span);
      const j0 = Math.max(0, cj - span), j1 = Math.min(n, cj + span);
      let any = false;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          hg.dirOf(f, i, j, d);
          const dot = d[0] * cx + d[1] * cy + d[2] * cz;
          if (dot <= cosR) continue;
          const t = Math.acos(Math.min(1, dot)) / radiusAng;
          fn(hg.index(f, i, j), d[0], d[1], d[2], t);
          any = true;
        }
      }
      if (any) { this.dirtyFaces.add(f); this.renderDirty.add(f); }
    }
  }

  private touchCell(x: number, y: number, z: number): void {
    this.dirtyCells.add(this.planet.region.cellOf(x, y, z));
  }

  /** Apply one dab of a brush. Returns true when anything changed. */
  brush(s: BrushStroke): boolean {
    const p = this.planet;
    const H = p.heights;
    const radiusAng = Math.max(2, s.radius) / PLANET_RADIUS;
    const k = Math.max(0, Math.min(1, s.strength));
    let delta = 0;
    if (s.tool === 'paint') {
      const target = PAINT_TARGETS[s.paint ?? 0] ?? PAINT_TARGETS[0];
      const cl = p.climate;
      const R = p.region;
      for (let c = 0; c < R.count; c++) {
        const dot = R.centers[c * 3] * s.x + R.centers[c * 3 + 1] * s.y + R.centers[c * 3 + 2] * s.z;
        if (dot < Math.cos(radiusAng * 1.1)) continue;
        const t = Math.acos(Math.min(1, dot)) / (radiusAng * 1.1);
        const w = (1 - t * t) * (1 - t * t) * k * 0.35;
        cl.tempPaint[c] += (target.temp - cl.tempPaint[c]) * w;
        cl.rainPaint[c] += (target.rain - cl.rainPaint[c]) * w;
        delta += w;
      }
      this.changed += delta;
      return delta > 0;
    }
    // Smoothing reads from a snapshot so the result is order-independent.
    const hg = p.hg;
    let snapshot: Map<number, number> | null = null;
    if (s.tool === 'smooth') {
      snapshot = new Map();
      this.forEachVertex(s.x, s.y, s.z, radiusAng * 1.15, (idx) => snapshot!.set(idx, H[idx]));
    }
    const side = hg.side;
    const rate = k * Math.max(0.35, s.radius * 0.035);
    this.forEachVertex(s.x, s.y, s.z, radiusAng, (idx, x, y, z, t) => {
      const w = (1 - t * t) * (1 - t * t);
      const h = H[idx];
      let nh = h;
      switch (s.tool) {
        case 'raise': nh = h + rate * w * (1 + Math.max(0, -h) * 0.05); break;
        case 'lower': nh = h - rate * w; break;
        case 'smooth': {
          const f = Math.floor(idx / hg.faceSize);
          const rem = idx - f * hg.faceSize;
          const j = Math.floor(rem / side), i = rem - j * side;
          let sum = 0, cnt = 0;
          for (let dj = -2; dj <= 2; dj++) {
            for (let di = -2; di <= 2; di++) {
              const ii = i + di, jj = j + dj;
              if (ii < 0 || jj < 0 || ii >= side || jj >= side) continue;
              const q = f * hg.faceSize + jj * side + ii;
              sum += snapshot!.get(q) ?? H[q];
              cnt++;
            }
          }
          nh = h + (sum / cnt - h) * Math.min(1, k * 1.2) * w;
          break;
        }
        case 'flatten': nh = h + ((s.level ?? 1) - h) * Math.min(1, k * 0.9) * w; break;
        case 'flood': {
          // Sink the land below sea level into a shallow basin.
          const target = -1.2 - 4 * w;
          if (h > target) nh = h + (target - h) * Math.min(1, k * 0.6) * w;
          break;
        }
        case 'drain': {
          // Reclaim water: lift sea floor and lake beds just above the water line.
          const target = 0.7 + 0.5 * w;
          if (h < target) nh = h + (target - h) * Math.min(1, k * 0.6) * w;
          break;
        }
      }
      nh = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, nh));
      if (nh !== h) {
        H[idx] = nh;
        delta += Math.abs(nh - h);
        this.touchCell(x, y, z);
      }
    });
    hg.syncEdges(H);
    this.changed += delta;
    return delta > 0;
  }

  /**
   * Generic deformation used by disasters: `fn(h, t)` returns the new height
   * for a vertex at normalised distance t from the centre.
   */
  deform(x: number, y: number, z: number, radius: number, fn: (h: number, t: number, vx: number, vy: number, vz: number) => number): void {
    const H = this.planet.heights;
    let delta = 0;
    this.forEachVertex(x, y, z, radius / PLANET_RADIUS, (idx, vx, vy, vz, t) => {
      const h = H[idx];
      const nh = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, fn(h, t, vx, vy, vz)));
      if (nh !== h) {
        H[idx] = nh;
        delta += Math.abs(nh - h);
        this.touchCell(vx, vy, vz);
      }
    });
    this.planet.hg.syncEdges(H);
    this.changed += delta;
  }

  get pending(): boolean {
    return this.dirtyFaces.size > 0 || this.changed > 0;
  }

  /**
   * Recompute derived terrain data. Returns the faces whose heights changed
   * (empty for paint-only strokes).
   */
  commit(): number[] {
    const p = this.planet;
    const faces = [...this.dirtyFaces].sort((a, b) => a - b);
    if (this.dirtyCells.size > 0) {
      // Include neighbours: region statistics sample slightly past cell edges.
      const cells = new Set<number>();
      for (const c of this.dirtyCells) {
        cells.add(c);
        for (let k = 0; k < 8; k++) cells.add(p.region.neighbors[c * 8 + k]);
      }
      p.terrain.recompute(cells, p.heights, p.hg);
      p.rebuildHydrology(false);
    }
    this.dirtyFaces.clear();
    this.dirtyCells.clear();
    this.changed = 0;
    this.onCommit();
    return faces;
  }
}
