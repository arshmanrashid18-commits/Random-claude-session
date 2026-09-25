import { World } from '../../src/sim/world';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
import { PSTATE_NAMES, JOB_NAMES } from '../../src/sim/civ/defs';
import { Intent } from '../../src/sim/civ/people';
const INTENT_NAMES = Object.fromEntries(Object.entries(Intent).map(([k, v]) => [v, k]));
const w = new World({ seed: Number(process.argv[2] ?? 20260925), preset: 'earthlike' });
const years = Number(process.argv[3] ?? 20);
const civ = w.civ;
const orig = civ.personDies.bind(civ);
const tally: Record<string, number> = {};
civ.personDies = (i, tick, cause, events) => {
  if (cause === 'starvation') {
    const P = civ.people;
    const s = P.settle[i] >= 0 ? civ.settlements[P.settle[i]] : null;
    const key = `${s ? (s.stock[0] > s.pop * 1 ? 'stocked' : 'empty') : 'homeless'} state=${PSTATE_NAMES[P.state[i]]} intent=${INTENT_NAMES[P.intent[i]]} job=${JOB_NAMES[P.job[i]]} age=${P.age[i] < 14 ? 'child' : P.age[i] > 60 ? 'old' : 'adult'}${P.vessel[i] ? ' boat' : ''}`;
    tally[key] = (tally[key] ?? 0) + 1;
    if (s && Math.random() < 0.06) {
      const d = Math.hypot(P.x[i] - s.x, P.y[i] - s.y, P.z[i] - s.z) * 1000;
      console.log(`  sample: ${s.name} food ${s.stock[0].toFixed(0)} pop ${s.pop} dist ${d.toFixed(0)} hunger ${P.hunger[i].toFixed(2)} ${key}`);
    }
  }
  return orig(i, tick, cause, events);
};
for (let t = 0; t < years * TICKS_PER_YEAR; t++) w.step();
console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${v}\t${k}`).join('\n'));
