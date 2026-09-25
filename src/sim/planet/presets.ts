/** World generation presets offered in Sandbox mode. */
export interface WorldParams {
  /** Number of tectonic plates. */
  plates: number;
  /** Fraction of plates that carry continental crust. */
  continentalFraction: number;
  /** Target fraction of the surface covered by ocean. */
  oceanFraction: number;
  /** Base frequency of the continent-shaping noise (higher = more fragmented). */
  continentFreq: number;
  /** Strength of domain warping of coastlines. */
  warp: number;
  /** Mountain height multiplier. */
  mountains: number;
  /** Global temperature offset in °C. */
  temperatureOffset: number;
  /** Global moisture multiplier. */
  moisture: number;
  /** Number of erosion droplets (×1000). */
  erosion: number;
}

export type WorldPresetId = 'earthlike' | 'archipelago' | 'pangaea' | 'frozen' | 'arid' | 'highlands';

export const WORLD_PRESETS: Record<WorldPresetId, { name: string; blurb: string; params: WorldParams }> = {
  earthlike: {
    name: 'Verdant',
    blurb: 'Balanced continents, temperate seas, a world in waiting.',
    params: { plates: 13, continentalFraction: 0.42, oceanFraction: 0.64, continentFreq: 1.35, warp: 0.55, mountains: 1.0, temperatureOffset: 0, moisture: 1.0, erosion: 90 },
  },
  archipelago: {
    name: 'Archipelago',
    blurb: 'A scattering of islands across warm shallow seas.',
    params: { plates: 18, continentalFraction: 0.3, oceanFraction: 0.8, continentFreq: 2.4, warp: 0.7, mountains: 0.8, temperatureOffset: 3, moisture: 1.2, erosion: 70 },
  },
  pangaea: {
    name: 'Pangaea',
    blurb: 'One vast supercontinent with a dry, brutal interior.',
    params: { plates: 9, continentalFraction: 0.55, oceanFraction: 0.6, continentFreq: 0.95, warp: 0.45, mountains: 1.15, temperatureOffset: 1, moisture: 0.85, erosion: 100 },
  },
  frozen: {
    name: 'Rimeworld',
    blurb: 'A cold planet: glaciers, tundra and a narrow green belt.',
    params: { plates: 12, continentalFraction: 0.45, oceanFraction: 0.62, continentFreq: 1.4, warp: 0.55, mountains: 1.0, temperatureOffset: -13, moisture: 0.9, erosion: 80 },
  },
  arid: {
    name: 'Dune',
    blurb: 'Shrunken seas and endless sand; water is life.',
    params: { plates: 12, continentalFraction: 0.55, oceanFraction: 0.42, continentFreq: 1.3, warp: 0.6, mountains: 0.9, temperatureOffset: 6, moisture: 0.45, erosion: 60 },
  },
  highlands: {
    name: 'Highlands',
    blurb: 'Jagged ranges, deep valleys, rivers everywhere.',
    params: { plates: 15, continentalFraction: 0.45, oceanFraction: 0.58, continentFreq: 1.5, warp: 0.6, mountains: 1.6, temperatureOffset: -2, moisture: 1.25, erosion: 130 },
  },
};
