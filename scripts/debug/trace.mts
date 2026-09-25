import { World } from '../../src/sim/world';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
import { PSTATE_NAMES, JOB_NAMES } from '../../src/sim/civ/defs';
import { Intent } from '../../src/sim/civ/people';
const IN = Object.fromEntries(Object.entries(Intent).map(([k, v]) => [v, k]));
const w = new World({ seed: 20260925, preset: 'earthlike' });
const civ = w.civ, P = civ.people;
for (let t = 0; t < 25 * TICKS_PER_YEAR; t++) w.step();
// Follow up to 3 people who reach hunger 1 in a stocked settlement.
const watch = new Map<number, string[]>();
let found = 0;
for (let t = 0; t < 3 * TICKS_PER_YEAR && (found < 4 || watch.size); t++) {
  w.step();
  if (found < 4) for (let i = 0; i < P.count; i++) {
    if (!P.alive[i] || P.hunger[i] < 1 || P.health[i] > 0.35 || watch.has(P.uid[i])) continue;
    const s = P.settle[i] >= 0 ? civ.settlements[P.settle[i]] : null;
    if (!s || s.stock[0] < s.pop) continue;
    watch.set(P.uid[i], []); found++;
    if (found >= 4) break;
  }
  for (const [uid, log] of watch) {
    const i = P.slot(uid);
    if (i < 0) { console.log(`uid ${uid} DIED\n` + log.slice(-40).join('\n')); watch.delete(uid); continue; }
    const s = P.settle[i] >= 0 ? civ.settlements[P.settle[i]] : null;
    const d = s ? (Math.hypot(P.x[i] - s.x, P.y[i] - s.y, P.z[i] - s.z) * 1000).toFixed(1) : '-';
    const td = (Math.hypot(P.x[i] - P.tx[i], P.y[i] - P.ty[i], P.z[i] - P.tz[i]) * 1000).toFixed(1);
    log.push(`  t${w.tick} ${PSTATE_NAMES[P.state[i]]}/${IN[P.intent[i]]} ${JOB_NAMES[P.job[i]]} hunger ${P.hunger[i].toFixed(2)} hp ${P.health[i].toFixed(2)} distHome ${d} distTarget ${td} timer ${P.timer[i]} food ${s ? s.stock[0].toFixed(0) : '-'} carry ${P.carryRes[i]}:${P.carryAmt[i].toFixed(1)} sick ${P.sick[i].toFixed(2)}`);
    if (P.hunger[i] < 0.5) { console.log(`uid ${uid} RECOVERED after ${log.length}`); watch.delete(uid); }
  }
}
