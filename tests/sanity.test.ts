import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { TICKS_PER_YEAR } from '../src/sim/constants';

function finite(arr: ArrayLike<number>, name: string): void {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) throw new Error(`${name}[${i}] = ${arr[i]}`);
  }
}

describe('simulation sanity', () => {
  const w = new World({ seed: 99, preset: 'earthlike' });
  for (let i = 0; i < TICKS_PER_YEAR * 2; i++) w.step();

  it('has no NaN or Infinity anywhere in the state', () => {
    const c = w.planet.climate;
    finite(w.planet.heights, 'heights');
    for (const [k, v] of Object.entries({ temp: c.temp, humid: c.humid, rain: c.rain, snow: c.snow, soil: c.soil, meanTemp: c.meanTemp, meanRain: c.meanRain, windE: c.windE, windN: c.windN })) finite(v, k);
    finite(w.plants.density, 'plants');
    finite(w.fires.intensity, 'fires');
    const a = w.animals;
    for (let i = 0; i < a.count; i++) {
      if (!a.alive[i]) continue;
      for (const [k, v] of Object.entries({ x: a.x[i], y: a.y[i], z: a.z[i], hunger: a.hunger[i], thirst: a.thirst[i], health: a.health[i], age: a.age[i] })) {
        if (!Number.isFinite(v)) throw new Error(`animal ${i} ${k}=${v}`);
      }
      expect(Math.abs(Math.hypot(a.x[i], a.y[i], a.z[i]) - 1)).toBeLessThan(1e-3);
    }
  });

  it('keeps plant densities in [0,1] and populations alive', () => {
    for (const d of w.plants.density) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
    expect(w.animals.totalAlive()).toBeGreaterThan(500);
    expect(w.animals.livingSpecies()).toBeGreaterThanOrEqual(10);
  });

  it('produces varied emergent biomes', () => {
    const counts = new Map<number, number>();
    for (const b of w.planet.climate.biome) counts.set(b, (counts.get(b) ?? 0) + 1);
    expect(counts.size).toBeGreaterThanOrEqual(8);
  });
});
