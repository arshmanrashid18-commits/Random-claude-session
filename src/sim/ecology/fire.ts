/**
 * Wildfire on the region grid. Fires ignite from lightning, volcanoes, meteors,
 * divine wildfire or careless people, and spread to neighbouring cells with a
 * probability driven by fuel load, dryness and wind alignment (so a divine
 * gale drives fire fronts downwind). Burning consumes vegetation; rain and a
 * lack of fuel put fires out; burn scars fade as plants regrow.
 */
import type { Rng } from '../../core/rng';
import type { Climate } from '../climate/climate';
import type { Plants } from './plants';
import type { RegionTerrain } from '../planet/regions';
import type { EventLog } from '../events';
import type { Geography } from '../planet/geography';

export class Fires {
  intensity: Float32Array;
  scar: Float32Array;
  /** Burning cells (unordered, deduplicated via intensity > 0). */
  active: number[] = [];
  /** Cells burnt by the current large fire complex (for events). */
  private complexSize = 0;
  private complexAnnounced = false;

  /** Cleared, trampled and watched ground around settlements (0..1): fire struggles there. */
  firebreak: Float32Array;

  constructor(count: number) {
    this.intensity = new Float32Array(count);
    this.scar = new Float32Array(count);
    this.firebreak = new Float32Array(count);
  }

  ignite(c: number, strength: number): boolean {
    if (this.intensity[c] > 0) {
      this.intensity[c] = Math.min(1, this.intensity[c] + strength * 0.5);
      return false;
    }
    this.intensity[c] = Math.min(1, strength);
    this.active.push(c);
    return true;
  }

  tick(tick: number, rng: Rng, climate: Climate, plants: Plants, terrain: RegionTerrain, events: EventLog, geo: Geography): void {
    // Scars fade slowly as vegetation regrows (checked on a rotating slice).
    const n = this.scar.length;
    const slice = Math.ceil(n / 64);
    const s0 = (tick % 64) * slice;
    for (let c = s0; c < Math.min(n, s0 + slice); c++) if (this.scar[c] > 0) this.scar[c] = Math.max(0, this.scar[c] - 0.004);
    if (this.active.length === 0) {
      if (this.complexSize > 0) { this.complexSize = 0; this.complexAnnounced = false; }
      return;
    }
    const g = climate.grid;
    const next: number[] = [];
    for (let i = 0; i < this.active.length; i++) {
      const c = this.active[i];
      let I = this.intensity[c];
      if (I <= 0) continue;
      const fuel = plants.fuel(c);
      const rain = climate.rain[c];
      const dry = 1 - Math.min(1, climate.soil[c] * 1.4);
      // Burn biomass: a cell's fuel is consumed within a few dozen ticks.
      plants.burn(c, 0.045 * I);
      this.scar[c] = Math.min(1, this.scar[c] + 0.03 * I);
      // Growth or decay of the fire.
      I += (fuel * 0.25 * (0.4 + dry) * (1 - 0.7 * this.firebreak[c]) - 0.06 - rain * 2.5) * 0.25;
      if (terrain.oceanFrac[c] > 0.5 || climate.snow[c] > 0.4) I = 0;
      if (I <= 0.02) { this.intensity[c] = 0; continue; }
      this.intensity[c] = Math.min(1, I);
      next.push(c);
      // Spread.
      if ((tick + c) % 3 === 0) {
        const we = climate.windE[c], wn = climate.windN[c];
        const ws = Math.hypot(we, wn);
        for (let k = 0; k < 4; k++) {
          const nb = g.neighbors[c * 8 + k];
          if (this.intensity[nb] > 0 || terrain.oceanFrac[nb] > 0.5) continue;
          const nf = plants.fuel(nb) * (1 - 0.8 * this.firebreak[nb]);
          const align = ws > 0.01 ? (we * climate.nbE[c * 4 + k] + wn * climate.nbN[c * 4 + k]) / ws : 0;
          const windK = 1 + Math.max(-0.7, align) * Math.min(2.5, ws * 0.18);
          const ndry = 1 - Math.min(1, climate.soil[nb] * 1.3);
          const p = 0.065 * I * nf * (0.15 + ndry) * windK - climate.rain[nb] * 3 - climate.humid[nb] * 0.006;
          if (p > 0 && rng.chance(Math.min(0.9, p))) {
            this.intensity[nb] = 0.35 + 0.3 * I;
            next.push(nb);
            this.complexSize++;
          }
        }
      }
    }
    this.active = next;
    if (!this.complexAnnounced && this.complexSize > 25) {
      this.complexAnnounced = true;
      const c = next[0] ?? 0;
      events.emit(tick, 'wildfire', { x: g.centers[c * 3], y: g.centers[c * 3 + 1], z: g.centers[c * 3 + 2] }, 0.6, {
        where: geo.describe(c),
        size: this.complexSize,
      });
    }
  }
}
