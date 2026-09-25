/**
 * Climate model on the region grid.
 *
 * Each region cell carries temperature, humidity, precipitation, a wind
 * vector, snow cover and soil moisture. Per climate step:
 *  - Temperature relaxes toward a radiative target computed from daily-mean
 *    insolation (latitude, seasonal declination), a lapse rate with elevation,
 *    snow albedo and global forcings (ice age, dust winters, industry).
 *    Oceans have far higher thermal inertia than land.
 *  - Winds follow a three-cell (Hadley/Ferrel/Polar) circulation whose bands
 *    shift with the seasons, are deflected around mountains, and are swirled
 *    by storms from the weather system.
 *  - Humidity evaporates from warm water, is advected semi-Lagrangially along
 *    the wind, and precipitates when air saturates or is lifted over terrain
 *    (giving rain shadows) or converges in storms.
 * Long-term means (≈1 year EMA) of temperature and rain drive biomes.
 *
 * The update is double-buffered and amortised across CLIMATE_PHASES ticks: each
 * tick processes one slice of cells reading only the previous state.
 */
import { CellGrid } from '../planet/cubesphere';
import { RegionTerrain } from '../planet/regions';
import { solarDeclination, TICKS_PER_YEAR } from '../constants';
import { Biome, classifyBiome } from './biomes';

export const CLIMATE_PHASES = 8;
const QTABLE_N = 256;
/** Climate steps per year (each step spans CLIMATE_PHASES ticks). */
export const CLIMATE_STEPS_PER_YEAR = TICKS_PER_YEAR / CLIMATE_PHASES;

/** Saturation humidity (g/kg) – Clausius–Clapeyron approximation. */
export function saturation(tC: number): number {
  return 3.8 * Math.exp(0.0687 * Math.max(-45, Math.min(45, tC)));
}

/** Daily-mean insolation (normalised: equator at equinox ≈ 0.318). */
export function dailyInsolation(lat: number, dec: number): number {
  const t = -Math.tan(lat) * Math.tan(dec);
  let h0: number;
  if (t >= 1) h0 = 0;
  else if (t <= -1) h0 = Math.PI;
  else h0 = Math.acos(t);
  return Math.max(0, (h0 * Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.sin(h0)) / Math.PI);
}

export interface StormInfluence {
  x: number; y: number; z: number;
  radius: number; // radians
  intensity: number; // 0..1+
  rain: number; // rain multiplier
  spin: number; // +1 cyclonic N, -1 S
  cold: boolean;
}

export interface ClimateForcing {
  /** Global temperature offset from world preset. */
  baseOffset: number;
  /** Additional temporary offset (ice age, meteor winter, volcanic ash). */
  transientOffset: number;
  /** Global moisture multiplier. */
  moisture: number;
  /** Drought oscillation: per-longitude modulation amplitude (0..1). */
  oscillation: number;
  oscillationPhase: number;
}

export class Climate {
  readonly grid: CellGrid;
  readonly terrain: RegionTerrain;
  // State (double buffered where advected).
  temp: Float32Array;
  humid: Float32Array;
  private tempNext: Float32Array;
  private humidNext: Float32Array;
  rain: Float32Array;
  windE: Float32Array; // eastward component
  windN: Float32Array; // northward component
  snow: Float32Array;
  soil: Float32Array;
  cloud: Float32Array;
  meanTemp: Float32Array;
  meanRain: Float32Array;
  biome: Uint8Array;
  /** Local modifiers written by disasters: ash (cooling, darkening), 0..1. */
  ash: Float32Array;
  /** Local drought/rain overrides from divine powers: + wetter, − drier. */
  rainBias: Float32Array;
  // Precomputed geometry.
  private eastX: Float32Array; private eastY: Float32Array; private eastZ: Float32Array;
  private northX: Float32Array; private northY: Float32Array; private northZ: Float32Array;
  private gradE: Float32Array; private gradN: Float32Array;
  /** Unit (east,north) direction to each of the 4 edge neighbours. */
  private nbE: Float32Array; private nbN: Float32Array;
  private qAnnual: Float32Array;
  /** Per-step insolation lookup over latitude (rebuilt when declination changes). */
  private qTable = new Float32Array(QTABLE_N + 1);
  private qTableDec = NaN;
  phase = 0;
  step = 0;
  forcing: ClimateForcing;
  storms: StormInfluence[] = [];

  constructor(grid: CellGrid, terrain: RegionTerrain, forcing: ClimateForcing) {
    this.grid = grid;
    this.terrain = terrain;
    this.forcing = forcing;
    const n = grid.count;
    this.temp = new Float32Array(n);
    this.humid = new Float32Array(n);
    this.tempNext = new Float32Array(n);
    this.humidNext = new Float32Array(n);
    this.rain = new Float32Array(n);
    this.windE = new Float32Array(n);
    this.windN = new Float32Array(n);
    this.snow = new Float32Array(n);
    this.soil = new Float32Array(n);
    this.cloud = new Float32Array(n);
    this.meanTemp = new Float32Array(n);
    this.meanRain = new Float32Array(n);
    this.biome = new Uint8Array(n);
    this.ash = new Float32Array(n);
    this.rainBias = new Float32Array(n);
    this.eastX = new Float32Array(n); this.eastY = new Float32Array(n); this.eastZ = new Float32Array(n);
    this.northX = new Float32Array(n); this.northY = new Float32Array(n); this.northZ = new Float32Array(n);
    this.gradE = new Float32Array(n); this.gradN = new Float32Array(n);
    this.nbE = new Float32Array(n * 4); this.nbN = new Float32Array(n * 4);
    this.qAnnual = new Float32Array(n);
    this.computeFrames();
    this.computeGradients();
  }

  private computeFrames(): void {
    const g = this.grid;
    for (let c = 0; c < g.count; c++) {
      const x = g.centers[c * 3], y = g.centers[c * 3 + 1], z = g.centers[c * 3 + 2];
      // east = normalize(Y × p)
      let ex = z, ey = 0, ez = -x;
      let l = Math.hypot(ex, ey, ez);
      if (l < 1e-6) { ex = 1; ey = 0; ez = 0; l = 1; }
      ex /= l; ey /= l; ez /= l;
      this.eastX[c] = ex; this.eastY[c] = ey; this.eastZ[c] = ez;
      // north = p × east
      this.northX[c] = y * ez - z * ey;
      this.northY[c] = z * ex - x * ez;
      this.northZ[c] = x * ey - y * ex;
    }
    for (let c = 0; c < g.count; c++) {
      const cx = g.centers[c * 3], cy = g.centers[c * 3 + 1], cz = g.centers[c * 3 + 2];
      for (let k = 0; k < 4; k++) {
        const nb = g.neighbors[c * 8 + k];
        const dx = g.centers[nb * 3] - cx, dy = g.centers[nb * 3 + 1] - cy, dz = g.centers[nb * 3 + 2] - cz;
        const de = dx * this.eastX[c] + dy * this.eastY[c] + dz * this.eastZ[c];
        const dn = dx * this.northX[c] + dy * this.northY[c] + dz * this.northZ[c];
        const l = Math.hypot(de, dn) || 1;
        this.nbE[c * 4 + k] = de / l;
        this.nbN[c * 4 + k] = dn / l;
      }
      this.qAnnual[c] = annualMeanInsolation(g.lat[c]);
    }
  }

  private ensureQTable(dec: number): void {
    if (dec === this.qTableDec) return;
    this.qTableDec = dec;
    for (let i = 0; i <= QTABLE_N; i++) {
      const lat = -Math.PI / 2 + (Math.PI * i) / QTABLE_N;
      this.qTable[i] = dailyInsolation(lat, dec);
    }
  }

  private insolation(lat: number): number {
    const f = ((lat + Math.PI / 2) / Math.PI) * QTABLE_N;
    let i = Math.floor(f);
    if (i < 0) i = 0; else if (i >= QTABLE_N) i = QTABLE_N - 1;
    const t = f - i;
    return this.qTable[i] * (1 - t) + this.qTable[i + 1] * t;
  }

  /** Elevation gradient in (east, north) per radian; recomputed after terraforming. */
  computeGradients(cells?: Iterable<number>): void {
    const g = this.grid;
    const it = cells ?? Array.from({ length: g.count }, (_, i) => i);
    for (const c of it) {
      let ge = 0, gn = 0;
      const cx = g.centers[c * 3], cy = g.centers[c * 3 + 1], cz = g.centers[c * 3 + 2];
      for (let k = 0; k < 4; k++) {
        const nb = g.neighbors[c * 8 + k];
        const dx = g.centers[nb * 3] - cx, dy = g.centers[nb * 3 + 1] - cy, dz = g.centers[nb * 3 + 2] - cz;
        const de = dx * this.eastX[c] + dy * this.eastY[c] + dz * this.eastZ[c];
        const dn = dx * this.northX[c] + dy * this.northY[c] + dz * this.northZ[c];
        const d2 = de * de + dn * dn || 1e-9;
        const dh = Math.max(0, this.terrain.elev[nb]) - Math.max(0, this.terrain.elev[c]);
        ge += (dh * de) / d2;
        gn += (dh * dn) / d2;
      }
      this.gradE[c] = ge * 0.5;
      this.gradN[c] = gn * 0.5;
    }
  }

  /** Initialise to a plausible equilibrium for the given tick. */
  initialise(tick: number): void {
    for (let c = 0; c < this.grid.count; c++) {
      const t = this.targetTemp(c, tick, 0.5);
      this.temp[c] = t;
      this.meanTemp[c] = t;
      this.humid[c] = saturation(t) * 0.6;
      this.meanRain[c] = 1;
      this.soil[c] = 0.5;
    }
    this.tempNext.set(this.temp);
    this.humidNext.set(this.humid);
  }

  /** Run the model forward quickly (world generation spin-up). */
  spinUp(startTick: number, years: number, progress?: (f: number) => void): void {
    const steps = Math.round(years * CLIMATE_STEPS_PER_YEAR);
    const meanAlpha = 3 / CLIMATE_STEPS_PER_YEAR; // faster convergence of means
    for (let s = 0; s < steps; s++) {
      const tick = startTick + s * CLIMATE_PHASES;
      for (let p = 0; p < CLIMATE_PHASES; p++) this.updateSlice(p, tick, meanAlpha);
      this.swap();
      if (progress && s % 20 === 0) progress(s / steps);
    }
    this.classifyAll();
  }

  private isOcean(c: number): boolean {
    return this.terrain.oceanFrac[c] > 0.5;
  }

  /** Radiative-equilibrium temperature target (°C). */
  targetTemp(c: number, tick: number, inertiaMix: number): number {
    this.ensureQTable(solarDeclination(tick));
    const q = this.insolation(this.grid.lat[c]);
    const qMean = this.qAnnual[c];
    const ocean = this.isOcean(c);
    const mix = ocean ? 0.8 : inertiaMix;
    const qEff = q * (1 - mix) + qMean * mix;
    let t = 30 + (qEff - 0.318) * 200;
    const elev = this.terrain.elev[c];
    if (elev > 0) t -= elev * 0.42;
    t -= Math.min(1, this.snow[c]) * 4;
    t -= this.ash[c] * 14;
    if (ocean) t = Math.max(t, -2.5);
    return t + this.forcing.baseOffset + this.forcing.transientOffset;
  }

  /** Process one slice of cells for the current climate step. */
  updateSlice(phase: number, tick: number, meanAlpha = 1 / CLIMATE_STEPS_PER_YEAR): void {
    const g = this.grid;
    const n = g.count;
    const start = Math.floor((phase * n) / CLIMATE_PHASES);
    const end = Math.floor(((phase + 1) * n) / CLIMATE_PHASES);
    const dec = solarDeclination(tick);
    const T = this.temp, H = this.humid;
    const Tn = this.tempNext, Hn = this.humidNext;
    const terr = this.terrain;
    const moistK = this.forcing.moisture;
    const osc = this.forcing.oscillation;
    const oscPh = this.forcing.oscillationPhase;
    const storms = this.storms;

    for (let c = start; c < end; c++) {
      const cx = g.centers[c * 3], cy = g.centers[c * 3 + 1], cz = g.centers[c * 3 + 2];
      const lat = g.lat[c];
      // --- winds: three-cell circulation with seasonal shift
      const latS = lat - dec * 0.55;
      const al = Math.abs(latS);
      const band = al < 0.5236 ? 6 : al < 1.0472 ? 8 : 3.5;
      const s6 = Math.sin(6 * al);
      let we = -s6 * band;
      let wn = -Math.sign(latS) * s6 * 1.8;
      // storm vortices
      let stormRain = 0;
      let stormCold = 0;
      for (let si = 0; si < storms.length; si++) {
        const s = storms[si];
        const dx = cx - s.x, dy = cy - s.y, dz = cz - s.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const r2 = s.radius * s.radius;
        if (d2 > r2 * 4) continue;
        const fall = Math.exp(-d2 / r2);
        // tangential swirl: spin * (p × (p - s)) projected to east/north
        const tx = cy * dz - cz * dy, ty = cz * dx - cx * dz, tz = cx * dy - cy * dx;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        const sw = (s.spin * s.intensity * 22 * fall) / tl;
        we += (tx * this.eastX[c] + ty * this.eastY[c] + tz * this.eastZ[c]) * sw;
        wn += (tx * this.northX[c] + ty * this.northY[c] + tz * this.northZ[c]) * sw;
        stormRain += fall * s.intensity * s.rain;
        if (s.cold) stormCold += fall * s.intensity;
      }
      // orographic lift (before deflection)
      const lift = Math.max(0, we * this.gradE[c] + wn * this.gradN[c]);
      // deflect around mountains: remove part of the uphill component
      const gE = this.gradE[c], gN = this.gradN[c];
      const g2 = gE * gE + gN * gN;
      if (g2 > 1e-6) {
        const up = (we * gE + wn * gN) / g2;
        if (up > 0) {
          const k = Math.min(0.8, Math.sqrt(g2) * 0.004);
          we -= up * gE * k;
          wn -= up * gN * k;
        }
      }
      this.windE[c] = we;
      this.windN[c] = wn;

      // --- upwind advection from the 4 edge neighbours
      const cour = 0.055;
      const ue = we * cour, un = wn * cour;
      let wsum = 0, tUp = 0, hUp = 0, nbT = 0, nbH = 0;
      for (let k = 0; k < 4; k++) {
        const nb = g.neighbors[c * 8 + k];
        const tv = T[nb], hv = H[nb];
        nbT += tv; nbH += hv;
        const w = -(ue * this.nbE[c * 4 + k] + un * this.nbN[c * 4 + k]);
        if (w > 0) { wsum += w; tUp += w * tv; hUp += w * hv; }
      }
      const tc = T[c], hc = H[c];
      let t: number, h: number;
      if (wsum > 0) {
        const a = wsum > 0.9 ? 0.9 : wsum;
        t = tc * (1 - a) + (tUp / wsum) * a;
        h = hc * (1 - a) + (hUp / wsum) * a;
      } else { t = tc; h = hc; }
      // lateral mixing (eddy diffusion / heat transport)
      t = t * 0.86 + nbT * 0.035;
      h = h * 0.9 + nbH * 0.025;

      // --- temperature relaxation
      const ocean = this.isOcean(c);
      const target = this.targetTemp(c, tick, 0.45);
      const relax = ocean ? 0.012 : 0.08;
      t += (target - t) * relax;
      t -= stormCold * 0.4;
      if (ocean && t < -2.5) t = -2.5;

      const itcz = Math.exp(-(latS * latS) / 0.035) * Math.min(1, Math.max(0, (t - 10) / 12));
      // --- evaporation
      const sat = saturation(t);
      const water = ocean ? 1 : Math.max(terr.lakeFrac[c], Math.min(0.35, terr.river[c] * 0.02));
      const lon = Math.atan2(cz, cx);
      const oscMod = 1 + osc * Math.sin(lon * 2 + oscPh) * Math.exp(-lat * lat * 3);
      let evap = 0;
      if (water > 0) evap += water * Math.max(0, sat - h) * 0.09 * moistK * oscMod;
      // land transpiration from moist soils and vegetation
      if (!ocean) evap += (1 - water) * (0.3 + this.soil[c]) * Math.max(0, sat * 0.85 - h) * (0.04 + 0.05 * itcz) * moistK;
      h += evap;

      // --- precipitation: condensation above a critical relative humidity.
      // Lifting (ITCZ convection, fronts, orography, storms) lowers the
      // threshold; subtropical subsidence raises it.
      const rh = h / sat;
      const front = Math.exp(-((al - 0.95) * (al - 0.95)) / 0.06);
      const subs = Math.exp(-((al - 0.47) * (al - 0.47)) / 0.014);
      let rhCrit = 0.86 - 0.4 * itcz - 0.16 * front + 0.2 * subs - Math.min(0.22, lift * 0.003) - Math.min(0.4, stormRain * 0.25);
      if (rhCrit < 0.35) rhCrit = 0.35;
      let p = rh > rhCrit ? (h - rhCrit * sat) * 0.35 : 0;
      // divine rain / drought
      const bias = this.rainBias[c];
      if (bias > 0) p += h * Math.min(0.6, bias * 0.3) + bias * 0.8;
      else if (bias < 0) p *= Math.max(0, 1 + bias);
      p = Math.max(0, Math.min(p, h + (bias > 0 ? bias * 0.8 : 0)));
      h = Math.max(0, h - p);
      Tn[c] = t;
      Hn[c] = h;
      this.rain[c] = p;
      this.cloud[c] = Math.min(1, Math.max(0, (rh - 0.45) * 1.6) + p * 0.15 + stormRain * 0.35);

      // --- surface: snow and soil moisture
      if (!ocean) {
        if (t < 0) this.snow[c] = Math.min(3, this.snow[c] + p * 0.25);
        else this.snow[c] = Math.max(0, this.snow[c] - (t * 0.02 + p * 0.05));
        this.soil[c] = Math.min(1, Math.max(0, this.soil[c] * 0.985 + p * 0.03 - Math.max(0, t) * 0.0006));
      } else {
        this.snow[c] = t < -1.5 ? Math.min(1.5, this.snow[c] + 0.02) : Math.max(0, this.snow[c] - 0.03);
      }
      // --- long-term means
      this.meanTemp[c] += (t - this.meanTemp[c]) * meanAlpha;
      this.meanRain[c] += (p * RAIN_SCALE - this.meanRain[c]) * meanAlpha;
      // ash settles slowly
      if (this.ash[c] > 0) this.ash[c] = Math.max(0, this.ash[c] - 0.0015);
      if (bias !== 0) this.rainBias[c] = Math.abs(bias) < 0.002 ? 0 : bias * 0.995;
    }
  }

  swap(): void {
    let t = this.temp; this.temp = this.tempNext; this.tempNext = t;
    t = this.humid; this.humid = this.humidNext; this.humidNext = t;
    this.step++;
  }

  /** Called once per tick by the world. */
  tick(tick: number): void {
    this.updateSlice(this.phase, tick);
    this.phase++;
    if (this.phase >= CLIMATE_PHASES) {
      this.phase = 0;
      this.swap();
      // Re-classify a rotating portion of cells each step.
      const n = this.grid.count;
      const per = Math.ceil(n / 16);
      const s = (this.step % 16) * per;
      for (let c = s; c < Math.min(n, s + per); c++) this.classify(c);
    }
  }

  classify(c: number): void {
    const t = this.terrain;
    this.biome[c] = classifyBiome(this.meanTemp[c], this.meanRain[c], t.elev[c], t.oceanFrac[c], t.lakeFrac[c], t.river[c], t.slope[c]);
  }

  classifyAll(): void {
    for (let c = 0; c < this.grid.count; c++) this.classify(c);
  }

  /** Current temperature at a direction (bilinear). */
  tempAt(x: number, y: number, z: number): number {
    return this.grid.sample(this.temp, x, y, z);
  }

  isFrozenOcean(c: number): boolean {
    return this.biome[c] === Biome.SeaIce;
  }
}

/** Scale converting instantaneous precipitation to "mean rain" units (~1 = moderate). */
export const RAIN_SCALE = 11;

const annualCache = new Map<number, number>();
/** Annual mean daily insolation at latitude (cached per 0.01 rad). */
export function annualMeanInsolation(lat: number): number {
  const key = Math.round(lat * 100);
  const cached = annualCache.get(key);
  if (cached !== undefined) return cached;
  let s = 0;
  const N = 48;
  for (let i = 0; i < N; i++) s += dailyInsolation(key / 100, (23.5 * Math.PI / 180) * Math.sin((2 * Math.PI * i) / N));
  const v = s / N;
  annualCache.set(key, v);
  return v;
}
