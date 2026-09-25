import { World } from '../../src/sim/world';
import { startScenario } from '../../src/sim/scenarios';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
const seed = Number(process.argv[2] ?? 5150), scen = process.argv[3], years = Number(process.argv[4] ?? 10);
const w = new World({ seed, preset: 'earthlike' });
if (scen) startScenario(w, scen);
const A = w.animals;
while (w.tick < years * TICKS_PER_YEAR) {
  w.step();
  if (w.tick % TICKS_PER_YEAR === 0) {
    console.log((w.tick / TICKS_PER_YEAR).toFixed(0), A.defs.map((d, i) => A.pop[i] > 0 ? `${d.name}:${A.pop[i]}` : '').filter(Boolean).join(' '));
    for (const nm of ['Jaguar', 'Lion']) { const L = A.defs.findIndex((d) => d.name === nm); console.log('   ', nm, 'deaths', Array.from(A.deaths.slice(L * 8, L * 8 + 8)).join(',')); }
  }
}
