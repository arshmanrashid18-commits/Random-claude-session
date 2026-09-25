import { World } from '../../src/sim/world';
import { startScenario } from '../../src/sim/scenarios';
import { WIN, IDLE } from '../../tests/support/strategies';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../../src/sim/constants';
const mode = process.argv[2] ?? 'idle';
const w = new World({ seed: 5150, preset: 'earthlike' });
startScenario(w, 'ark');
const memo = w.scenario!.memo;
const orig = Object.keys(memo).filter((k) => k.startsWith('sp')).map((k) => Number(k.slice(2)));
const start = orig.map((i) => w.animals.pop[i]);
const minR = orig.map(() => 1);
const strat = mode === 'win' ? WIN.ark : IDLE;
let day = 0;
while (w.tick < 15 * TICKS_PER_YEAR) {
  if (w.tick % TICKS_PER_DAY === 0) strat(w, day++);
  w.step();
  if (w.scenario) w.scenario.status = 'active';
  if (w.tick % 96 === 0) orig.forEach((sp, k) => { minR[k] = Math.min(minR[k], w.animals.pop[sp] / Math.max(1, start[k])); });
}
const J = w.animals.defs.findIndex((d) => d.name === 'Jaguar'), L = w.animals.defs.findIndex((d) => d.name === 'Lion');
console.log('jaguar deaths', Array.from(w.animals.deaths.slice(J * 8, J * 8 + 8)).join(','), 'lion deaths', Array.from(w.animals.deaths.slice(L * 8, L * 8 + 8)).join(','), 'groves', w.divine.effects.filter((e) => e.power === 'sanctuary').length, 'devotion', Math.round(w.civ.devotion));
console.log(mode, orig.map((sp, k) => `${w.animals.defs[sp].name}:${start[k]}→${w.animals.pop[sp]} min ${(minR[k] * 100).toFixed(0)}%`).join('  '));
