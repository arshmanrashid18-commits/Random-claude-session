/**
 * Every scenario is winnable and losable: a scripted winning strategy and a
 * scripted losing strategy are played to completion on the real simulation.
 * None can be won by doing nothing.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { SCENARIOS, startScenario } from '../src/sim/scenarios';
import { WIN, LOSE, IDLE, play } from './support/strategies';

describe('scenarios', () => {
  it('there are eight, each with an objective and a time limit', () => {
    expect(SCENARIOS.length).toBe(8);
    for (const s of SCENARIOS) {
      expect(s.objective.length).toBeGreaterThan(10);
      expect(s.years).toBeGreaterThan(0);
      expect(WIN[s.id]).toBeTypeOf('function');
      expect(LOSE[s.id]).toBeTypeOf('function');
    }
  });

  for (const def of SCENARIOS) {
    it(`${def.id}: can be won`, () => {
      const w = new World({ seed: def.seed, preset: def.preset });
      startScenario(w, def.id);
      expect(play(w, WIN[def.id], def.years + 1), w.scenario!.detail).toBe('won');
    });
    it(`${def.id}: can be lost`, () => {
      const w = new World({ seed: def.seed, preset: def.preset });
      startScenario(w, def.id);
      expect(play(w, LOSE[def.id], def.years + 1), w.scenario!.detail).toBe('lost');
    });
    if (LOSE[def.id] !== IDLE) {
      it(`${def.id}: is not won by doing nothing`, () => {
        const w = new World({ seed: def.seed, preset: def.preset });
        startScenario(w, def.id);
        expect(play(w, IDLE, def.years + 1), w.scenario!.detail).toBe('lost');
      });
    }
  }
});
