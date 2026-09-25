/**
 * World-wide constants. Units: 1 world unit ≈ 1 metre on a deliberately tiny,
 * stylised planet (radius 1 km) so that people, villages and continents are
 * all legible from one continuous zoom.
 */

/** Planet radius in world units. */
export const PLANET_RADIUS = 1000;
/** Heightmap resolution: segments per cube face (vertex grid is (N+1)²). */
export const HEIGHT_N = 512;
/** Region grid (climate, ecology, ownership, pathfinding): cells per face edge. */
export const REGION_N = 64;
/** Hydrology grid (river networks, lakes): cells per face edge. */
export const HYDRO_N = 128;

/** Elevation scale: heights are stored in world units relative to sea level. */
export const MAX_ELEVATION = 48;
export const MIN_ELEVATION = -40;

/** Atmosphere shell thickness (rendering + weather altitude). */
export const ATMOSPHERE_HEIGHT = 90;
export const CLOUD_BASE = 14;
export const CLOUD_TOP = 26;

// ---------------------------------------------------------------- time
/** Simulation ticks per real second at 1× speed. */
export const TICKS_PER_SECOND_1X = 4;
/** One in-game day (full rotation) in ticks: 40 s at 1×. */
export const TICKS_PER_DAY = 160;
/** Days per year: a year is 4 minutes at 1×, 2.4 s at 100×. */
export const DAYS_PER_YEAR = 6;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;
/**
 * Human years lived per world year. A world year is one seasonal cycle; people
 * live two years of their lives in each, so generations turn over within a
 * play session (a village becomes a town in about twenty world years).
 */
export const LIFE_YEARS_PER_YEAR = 2;
/** Moon orbital period in ticks (≈3.3 days, gives visible tidal rhythm). */
export const TICKS_PER_MOON = 530;
/** Axial tilt in radians (gives real seasons). */
export const AXIAL_TILT = (23.5 * Math.PI) / 180;

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

export function yearOf(tick: number): number {
  return Math.floor(tick / TICKS_PER_YEAR);
}
/** Fraction of the year in [0,1). 0 = spring equinox (northern hemisphere). */
export function yearFrac(tick: number): number {
  return (tick % TICKS_PER_YEAR) / TICKS_PER_YEAR;
}
export function dayFrac(tick: number): number {
  return (tick % TICKS_PER_DAY) / TICKS_PER_DAY;
}
/** Solar declination (radians) for the northern hemisphere. */
export function solarDeclination(tick: number): number {
  return AXIAL_TILT * Math.sin(2 * Math.PI * yearFrac(tick));
}

/**
 * Sun direction in planet-fixed coordinates. The planet rotates about +Y, so
 * in planet space the sun circles the axis once per day and its elevation
 * tracks the seasonal declination.
 */
export function sunDirection(tick: number, out: number[] = [0, 0, 0]): number[] {
  const dec = solarDeclination(tick);
  const hour = 2 * Math.PI * dayFrac(tick);
  const c = Math.cos(dec);
  out[0] = c * Math.cos(hour);
  out[1] = Math.sin(dec);
  out[2] = -c * Math.sin(hour);
  return out;
}

/** Moon direction in planet space; inclined 8° to the equator. */
export function moonDirection(tick: number, out: number[] = [0, 0, 0]): number[] {
  // Relative to the rotating surface the moon appears to go round once per
  // (day length adjusted for its own orbit).
  const orbit = (2 * Math.PI * tick) / TICKS_PER_MOON;
  const spin = (2 * Math.PI * tick) / TICKS_PER_DAY;
  const ang = orbit - spin;
  const inc = (8 * Math.PI) / 180;
  const x = Math.cos(ang);
  const z = -Math.sin(ang);
  out[0] = x;
  out[1] = Math.sin(inc) * Math.sin(orbit);
  out[2] = z * Math.cos(inc);
  const l = Math.hypot(out[0], out[1], out[2]);
  out[0] /= l; out[1] /= l; out[2] /= l;
  return out;
}

export const MOON_DISTANCE = 9000;
export const MOON_RADIUS = 260;
/** Tidal amplitude in world units at the sub-lunar point. */
export const TIDE_AMPLITUDE = 1.1;

/** Equilibrium tide height (world units) at unit direction p. */
export function tideHeight(px: number, py: number, pz: number, moon: number[], strength = 1): number {
  const c = px * moon[0] + py * moon[1] + pz * moon[2];
  return TIDE_AMPLITUDE * strength * (1.5 * c * c - 0.5);
}
