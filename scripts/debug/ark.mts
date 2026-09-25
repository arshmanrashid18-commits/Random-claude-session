import { World } from '../../src/sim/world';
import { startScenario } from '../../src/sim/scenarios';
import { WIN } from '../../tests/support/strategies';
import { TICKS_PER_DAY, TICKS_PER_YEAR } from '../../src/sim/constants';
const w = new World({ seed: 5150, preset: 'earthlike' });
startScenario(w, 'ark');
const memo = w.scenario!.memo;
const orig = Object.keys(memo).filter((k) => k.startsWith('sp')).map((k) => Number(k.slice(2)));
let day = 0;
while (w.scenario!.status === 'active' && w.tick < 16 * TICKS_PER_YEAR) {
  if (w.tick % TICKS_PER_DAY === 0) WIN.ark(w, day++);
  w.step();
  if (w.tick % (TICKS_PER_YEAR / 2) === 0) {
    console.log((w.tick / TICKS_PER_YEAR).toFixed(1), 'dev', Math.round(w.civ.devotion), orig.map((i) => `${w.animals.defs[i].name}:${w.animals.pop[i]}`).join(' '));
    const L = w.animals.defs.findIndex((d) => d.name === 'Lion');
    console.log('   lion deaths', Array.from(w.animals.deaths.slice(L * 8, L * 8 + 8)).join(','), 'births?', (w.animals as any).births?.[L]);
  }
}
console.log(w.scenario!.status, w.scenario!.detail);
