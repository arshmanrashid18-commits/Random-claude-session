import { World } from '../../src/sim/world';
import { SCENARIOS, startScenario } from '../../src/sim/scenarios';
import { WIN, LOSE, play } from '../../tests/support/strategies';
const only = process.argv[2] ? process.argv[2].split(',') : null;
const mode = process.argv[3] ?? 'both';
for (const def of SCENARIOS) {
  if (only && !only.includes(def.id)) continue;
  for (const kind of mode === 'both' ? ['win', 'lose'] : [mode]) {
    const t0 = performance.now();
    const w = new World({ seed: def.seed, preset: def.preset });
    startScenario(w, def.id);
    const r = play(w, kind === 'win' ? WIN[def.id] : LOSE[def.id], def.years + 1);
    console.log(`${def.id.padEnd(14)} ${kind.padEnd(5)} -> ${r.padEnd(6)} year ${(w.tick / 960).toFixed(1)} ${w.scenario!.detail} | ${w.scenario!.outcome} (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
