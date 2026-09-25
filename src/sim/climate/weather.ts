/**
 * Weather systems layered on the climate model:
 *  - Mid-latitude storm fronts carried by the westerlies.
 *  - Hurricanes that form over warm tropical ocean late in each hemisphere's
 *    summer, drift west with the trade winds, recurve poleward, intensify over
 *    warm water and decay over land (landfall events).
 *  - Blizzards over cold land in winter.
 *  - Lightning from active storms (can ignite wildfires).
 *  - A slow ENSO-like oscillation that shifts rainfall between longitudes and
 *    produces multi-year droughts, detected per continent.
 * Storms feed back into the climate as vortices with extra precipitation.
 */
import { Rng } from '../../core/rng';
import { Language } from '../../core/language';
import { Climate, type StormInfluence } from './climate';
import { TICKS_PER_YEAR, yearFrac } from '../constants';
import type { EventLog } from '../events';
import type { Geography } from '../planet/geography';

export const StormType = { Front: 0, Hurricane: 1, Blizzard: 2 } as const;

export interface Storm {
  id: number;
  type: number;
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  intensity: number;
  peak: number;
  age: number;
  life: number;
  overLand: boolean;
  landfalls: number;
  /** Continent of the last announced landfall. */
  lastLand?: number;
}

export interface LightningStrike {
  x: number;
  y: number;
  z: number;
  power: number;
}

export class Weather {
  storms: Storm[] = [];
  nextId = 1;
  oscPeriod = TICKS_PER_YEAR * 5;
  oscAmp = 0.35;
  /** Strikes generated during the current tick (consumed by fire system / renderer). */
  strikes: LightningStrike[] = [];
  /** Recent strikes for the renderer (drained by the worker). */
  strikeLog: LightningStrike[] = [];
  /** Slow 8-year rainfall baseline per region cell. */
  baseline: Float32Array;
  /** Per-continent drought flag to emit start/end events once. */
  droughtOn: Record<number, boolean> = {};
  private lang: Language;

  constructor(cellCount: number, seed: number) {
    this.baseline = new Float32Array(cellCount).fill(1);
    this.lang = new Language(seed ^ 0x57021);
  }

  initBaseline(climate: Climate): void {
    this.baseline.set(climate.meanRain);
  }

  private spawn(rng: Rng, type: number, x: number, y: number, z: number, tick: number, events: EventLog): void {
    const id = this.nextId++;
    const s: Storm = {
      id, type, name: this.lang.nameFor(id, 'storm'), x, y, z,
      radius: type === StormType.Hurricane ? rng.range(0.055, 0.085) : type === StormType.Front ? rng.range(0.1, 0.17) : rng.range(0.07, 0.11),
      intensity: type === StormType.Hurricane ? 0.35 : rng.range(0.45, 0.8),
      peak: 0,
      age: 0,
      life: type === StormType.Hurricane ? rng.int(700, 1300) : rng.int(220, 520),
      overLand: false,
      landfalls: 0,
    };
    this.storms.push(s);
    if (type === StormType.Hurricane) events.emit(tick, 'hurricane', s, 0.45, { name: s.name, stage: 'formed' });
    else if (type === StormType.Blizzard) events.emit(tick, 'blizzard', s, 0.25, { name: s.name });
    else events.emit(tick, 'storm', s, 0.12, { name: s.name });
  }

  update(tick: number, climate: Climate, rng: Rng, events: EventLog, geo: Geography): void {
    const g = climate.grid;
    const terr = climate.terrain;
    this.strikes.length = 0;
    // ---- oscillation
    const f = climate.forcing;
    f.oscillationPhase += (Math.PI * 2) / this.oscPeriod;
    if (f.oscillationPhase > Math.PI * 2) {
      f.oscillationPhase -= Math.PI * 2;
      this.oscPeriod = Math.round(TICKS_PER_YEAR * rng.range(3, 7.5));
      this.oscAmp = rng.range(0.2, 0.55);
    }
    f.oscillation = this.oscAmp;

    // ---- spawning (checked periodically)
    if (tick % 24 === 0) {
      const yf = yearFrac(tick);
      const fronts = this.storms.filter((s) => s.type === StormType.Front).length;
      if (fronts < 6 && rng.chance(0.55)) {
        const c = rng.int(0, g.count);
        const al = Math.abs(g.lat[c]);
        if (al > 0.55 && al < 1.15 && climate.humid[c] > 3) this.spawn(rng, StormType.Front, g.centers[c * 3], g.centers[c * 3 + 1], g.centers[c * 3 + 2], tick, events);
      }
      const hurricanes = this.storms.filter((s) => s.type === StormType.Hurricane).length;
      const northSeason = yf > 0.25 && yf < 0.55;
      const southSeason = yf > 0.75 || yf < 0.05;
      if (hurricanes < 2 && (northSeason || southSeason) && rng.chance(0.12)) {
        // Look for warm open ocean in the season's tropical band.
        for (let k = 0; k < 24; k++) {
          const c = rng.int(0, g.count);
          const lat = g.lat[c];
          const inBand = (northSeason && lat > 0.12 && lat < 0.4) || (southSeason && lat < -0.12 && lat > -0.4);
          if (inBand && terr.oceanFrac[c] > 0.9 && climate.temp[c] > 24.5) {
            this.spawn(rng, StormType.Hurricane, g.centers[c * 3], g.centers[c * 3 + 1], g.centers[c * 3 + 2], tick, events);
            break;
          }
        }
      }
      const blizzards = this.storms.filter((s) => s.type === StormType.Blizzard).length;
      if (blizzards < 2 && rng.chance(0.2)) {
        const c = rng.int(0, g.count);
        const winterN = yf > 0.7 || yf < 0.05;
        const winterS = yf > 0.2 && yf < 0.55;
        const lat = g.lat[c];
        if (((winterN && lat > 0.6) || (winterS && lat < -0.6)) && terr.oceanFrac[c] < 0.5 && climate.temp[c] < -6 && climate.humid[c] > 0.4) {
          this.spawn(rng, StormType.Blizzard, g.centers[c * 3], g.centers[c * 3 + 1], g.centers[c * 3 + 2], tick, events);
        }
      }
    }

    // ---- motion and life cycle
    const influences: StormInfluence[] = [];
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const s = this.storms[i];
      s.age++;
      const c = g.cellOf(s.x, s.y, s.z);
      const lat = g.lat[c];
      // Local east/north.
      let ex = s.z, ez = -s.x;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el; ez /= el;
      // north = p × east
      const nx = s.y * ez, ny = s.z * ex - s.x * ez, nz = -s.y * ex;
      let we = climate.windE[c], wn = climate.windN[c];
      if (s.type === StormType.Hurricane) {
        // Beta drift: poleward and slightly west.
        wn += Math.sign(lat || 1) * 2.2;
        we -= 1.0;
      }
      const k = 0.0001;
      let px = s.x + (ex * we + nx * wn) * k;
      let py = s.y + ny * wn * k;
      let pz = s.z + (ez * we + nz * wn) * k;
      const pl = Math.hypot(px, py, pz);
      px /= pl; py /= pl; pz /= pl;
      s.x = px; s.y = py; s.z = pz;
      const overLand = terr.oceanFrac[c] < 0.4;
      if (s.type === StormType.Hurricane) {
        // Warm water (the same threshold they form over) feeds them; cooler
        // seas wear them down slowly, land quickly.
        const warm = climate.temp[c] > 24.5 && !overLand;
        s.intensity += warm ? 0.0022 : overLand ? -0.006 : -0.0009;
        s.intensity = Math.min(1.6, s.intensity);
        if (overLand && !s.overLand && s.intensity > 0.55) {
          s.landfalls++;
          const cont = geo.continentOf(c);
          // Announce a landfall once per land, not at every wobble along a coast.
          if (cont !== (s.lastLand ?? -2)) events.emit(tick, 'landfall', s, 0.75, {
            name: s.name,
            category: Math.max(1, Math.min(5, Math.round(s.intensity * 3.3))),
            continent: cont >= 0 ? geo.continents[cont].name : '',
          });
          s.lastLand = cont;
        }
      } else {
        const life = s.age / s.life;
        s.intensity = Math.max(0, (s.type === StormType.Front ? 0.8 : 0.9) * Math.sin(Math.min(1, life) * Math.PI) + 0.15);
        if (s.type === StormType.Blizzard && climate.temp[c] > 0) s.intensity *= 0.97;
      }
      s.overLand = overLand;
      s.peak = Math.max(s.peak, s.intensity);
      if (s.age > s.life || s.intensity < 0.08) {
        this.storms.splice(i, 1);
        continue;
      }
      influences.push({
        x: s.x, y: s.y, z: s.z,
        radius: s.radius,
        intensity: s.intensity,
        rain: s.type === StormType.Hurricane ? 2.2 : 1.2,
        spin: (lat >= 0 ? 1 : -1) * (s.type === StormType.Hurricane ? 1 : 0.4),
        cold: s.type === StormType.Blizzard,
      });
      // Lightning.
      if (s.type !== StormType.Blizzard && rng.chance(0.06 * s.intensity)) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.float()) * s.radius * 0.8;
        let lx = s.x + (ex * Math.cos(a) + nx * Math.sin(a)) * r;
        let ly = s.y + ny * Math.sin(a) * r;
        let lz = s.z + (ez * Math.cos(a) + nz * Math.sin(a)) * r;
        const ll = Math.hypot(lx, ly, lz);
        lx /= ll; ly /= ll; lz /= ll;
        const strike = { x: lx, y: ly, z: lz, power: s.intensity };
        this.strikes.push(strike);
        this.strikeLog.push(strike);
        if (this.strikeLog.length > 64) this.strikeLog.shift();
      }
    }
    climate.storms = influences;

    // ---- drought tracking (once per in-game day)
    if (tick % 160 === 80) this.trackDroughts(tick, climate, events, geo);
  }

  private trackDroughts(tick: number, climate: Climate, events: EventLog, geo: Geography): void {
    const alpha = 160 / (TICKS_PER_YEAR * 8);
    for (let c = 0; c < this.baseline.length; c++) this.baseline[c] += (climate.meanRain[c] - this.baseline[c]) * alpha;
    for (const cont of geo.continents) {
      if (cont.cells.length < 40) continue;
      let dry = 0, n = 0;
      for (let k = 0; k < cont.cells.length; k += 3) {
        const c = cont.cells[k];
        n++;
        if (climate.meanRain[c] < this.baseline[c] * 0.72 && this.baseline[c] > 0.3) dry++;
      }
      const frac = dry / Math.max(1, n);
      const on = this.droughtOn[cont.id] ?? false;
      if (!on && frac > 0.32) {
        this.droughtOn[cont.id] = true;
        const c0 = cont.cells[Math.floor(cont.cells.length / 2)];
        events.emit(tick, 'drought', { x: climate.grid.centers[c0 * 3], y: climate.grid.centers[c0 * 3 + 1], z: climate.grid.centers[c0 * 3 + 2] }, 0.6, { continent: cont.name, severity: Math.round(frac * 100) });
      } else if (on && frac < 0.12) {
        this.droughtOn[cont.id] = false;
        events.emit(tick, 'drought-end', null, 0.4, { continent: cont.name });
      }
    }
  }
}
