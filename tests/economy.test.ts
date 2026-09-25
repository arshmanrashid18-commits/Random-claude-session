import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { TICKS_PER_YEAR } from '../src/sim/constants';

describe('economy', () => {
  it('conserves every resource exactly: created = held + consumed + used + destroyed', () => {
    const w = new World({ seed: 20260925, preset: 'earthlike' });
    w.command({ kind: 'boundless', on: true });
    for (let y = 0; y < 6; y++) {
      for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
      // Disasters destroy goods; they must be accounted for too.
      const s = w.civ.settlements.filter((x) => x.alive)[y % Math.max(1, w.civ.settlements.filter((x) => x.alive).length)];
      if (s && y === 2) w.command({ kind: 'power', power: 'earthquake', x: s.x, y: s.y, z: s.z });
      if (s && y === 4) w.command({ kind: 'power', power: 'wildfire', x: s.x, y: s.y, z: s.z });
    }
    const h = w.civ.holdings(), L = w.civ.ledger;
    for (let r = 0; r < 4; r++) {
      const balance = L.created[r] - h[r] - L.consumed[r] - L.used[r] - L.destroyed[r];
      expect(Math.abs(balance), `resource ${r}`).toBeLessThan(1e-6 * Math.max(1, L.created[r]) + 1e-6);
    }
    expect(L.created[0]).toBeGreaterThan(1000);
    expect(L.consumed[0]).toBeGreaterThan(500);
    expect(L.used[1]).toBeGreaterThan(50);
  });
});
