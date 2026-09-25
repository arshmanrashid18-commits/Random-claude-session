import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { TICKS_PER_YEAR } from '../src/sim/constants';

describe('ecosystem stability', () => {
  it('sustains predators and prey through ten years', () => {
    const w = new World({ seed: 20260925, preset: 'earthlike' });
    const start = w.animals.livingSpecies();
    const samples: number[][] = [];
    for (let y = 0; y < 10; y++) {
      for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
      samples.push(Array.from(w.animals.pop.subarray(0, w.animals.defs.length)));
    }
    const a = w.animals;
    expect(a.livingSpecies()).toBeGreaterThanOrEqual(Math.min(start, 10));
    let predators = 0, prey = 0;
    for (let s = 0; s < a.defs.length; s++) {
      if (a.pop[s] <= 0) continue;
      if (a.defs[s].diet === 'herbivore') prey += a.pop[s]; else predators += a.pop[s];
    }
    expect(prey).toBeGreaterThan(800);
    expect(predators).toBeGreaterThan(40);
    expect(predators).toBeLessThan(prey);
    // Populations fluctuate (cycles), they are not frozen.
    const deer = samples.map((row) => row[0]);
    expect(Math.max(...deer)).toBeGreaterThan(Math.min(...deer));
    expect(a.totalAlive()).toBeLessThan(a.cap);
  });

  it('plants follow the climate: rain and bloom raise cover, drought lowers it', () => {
    const w = new World({ seed: 31, preset: 'earthlike' });
    for (let t = 0; t < 200; t++) w.step();
    w.command({ kind: 'boundless', on: true });
    const g = w.planet.region;
    const land = [...Array(g.count).keys()].find((c) => w.planet.terrain.oceanFrac[c] < 0.05 && w.planet.climate.meanTemp[c] > 5)!;
    const p = { x: g.centers[land * 3], y: g.centers[land * 3 + 1], z: g.centers[land * 3 + 2] };
    const cover = () => { let s = 0; for (let k = 0; k < 8; k++) s += w.plants.density[land * 8 + k]; return s; };
    w.command({ kind: 'power', power: 'drought', ...p });
    const before = w.planet.climate.soil[land];
    for (let t = 0; t < TICKS_PER_YEAR / 2; t++) w.step();
    expect(w.planet.climate.soil[land]).toBeLessThan(before + 1e-6);
    const dry = cover();
    w.command({ kind: 'power', power: 'bloom', ...p });
    expect(cover()).toBeGreaterThan(dry);
  });
});
