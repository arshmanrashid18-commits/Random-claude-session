/**
 * Biome classification. Biomes are never painted directly by generation: they
 * emerge from the simulated long-term temperature and precipitation of each
 * region cell (a Whittaker diagram), plus elevation and surface water.
 */

export const Biome = {
  Ocean: 0,
  SeaIce: 1,
  Ice: 2,
  Tundra: 3,
  Taiga: 4,
  TemperateForest: 5,
  Grassland: 6,
  Savanna: 7,
  Desert: 8,
  Rainforest: 9,
  Wetland: 10,
  Alpine: 11,
  Lake: 12,
} as const;
export type Biome = (typeof Biome)[keyof typeof Biome];

export const BIOME_COUNT = 13;

export const BIOME_NAMES = [
  'Ocean', 'Sea Ice', 'Glacier', 'Tundra', 'Taiga', 'Temperate Forest', 'Grassland',
  'Savanna', 'Desert', 'Rainforest', 'Wetland', 'Alpine', 'Lake',
];

/** Display colours (sRGB hex) for the biome map in the dashboard. */
export const BIOME_COLORS = [
  '#1d4f7a', '#cfe3ee', '#f1f6fa', '#9aa58a', '#3f6b4f', '#4f8a3c', '#a9b957',
  '#c7a95a', '#e0c68c', '#1f6e35', '#4f7d68', '#8c8577', '#3b7ea3',
];

/** Precipitation thresholds (mean rain units) used by classification. */
export const RAIN_DRY = 0.5;
export const RAIN_MID = 1.15;
export const RAIN_WET = 2.3;

export function classifyBiome(
  meanTemp: number,
  meanRain: number,
  elev: number,
  oceanFrac: number,
  lakeFrac: number,
  riverFlow: number,
  slope: number,
): Biome {
  if (oceanFrac > 0.5) return meanTemp < -4 ? Biome.SeaIce : Biome.Ocean;
  if (lakeFrac > 0.5) return meanTemp < -6 ? Biome.Ice : Biome.Lake;
  if (meanTemp < -9) return Biome.Ice;
  if (elev > 30 && meanTemp < 6) return Biome.Alpine;
  if (meanTemp < -2) return Biome.Tundra;
  const wetBonus = riverFlow > 1 ? 0.25 : 0;
  const rain = meanRain + wetBonus;
  if (rain > RAIN_WET && slope < 0.18 && elev < 10 && meanTemp > 3 && (riverFlow > 2 || lakeFrac > 0.15 || meanRain > RAIN_WET + 0.8)) {
    return Biome.Wetland;
  }
  if (meanTemp < 5) return rain < RAIN_DRY * 0.6 ? Biome.Tundra : Biome.Taiga;
  if (meanTemp < 19) {
    if (rain < RAIN_DRY) return Biome.Desert;
    if (rain < RAIN_MID) return Biome.Grassland;
    return Biome.TemperateForest;
  }
  if (rain < RAIN_DRY) return Biome.Desert;
  if (rain < RAIN_MID + 0.3) return Biome.Savanna;
  return Biome.Rainforest;
}
