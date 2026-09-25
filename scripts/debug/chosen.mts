import { World } from '../../src/sim/world';
import { startScenario } from '../../src/sim/scenarios';
import { WIN, IDLE } from '../../tests/support/strategies';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../../src/sim/constants';
const mode = process.argv[2] ?? 'idle';
const w = new World({ seed: 3141, preset: 'earthlike' });
startScenario(w, 'chosen');
w.scenario!.status = 'active';
const strat = mode === 'win' ? WIN.chosen : IDLE;
let day = 0;
const out: string[] = [];
for (let y = 1; y <= 30; y++) {
  for (let t = 0; t < TICKS_PER_YEAR; t++) { if (w.tick % TICKS_PER_DAY === 0) strat(w, day++); w.step(); if (w.scenario) w.scenario.status = 'active'; }
  const best = Math.max(0, ...w.civ.settlements.filter((x) => x.alive).map((x) => x.pop));
  out.push(`${y}:${best}`);
}
console.log(mode, out.join(' '));
