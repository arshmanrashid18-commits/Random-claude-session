import { World } from '../../src/sim/world';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
const w = new World({ seed: Number(process.argv[2] ?? 5150), preset: 'earthlike' });
const A = w.animals;
const names = ['Lion', 'Jaguar', 'Wolf'];
const ids = names.map((n) => A.defs.findIndex((d) => d.name === n));
const st = ids.map(() => new Array(10).fill(0));
const hung = ids.map(() => 0), cnt = ids.map(() => 0);
let preyKills = 0;
const deaths0 = Array.from(A.deaths);
while (w.tick < 4 * TICKS_PER_YEAR) {
  w.step();
  if (w.tick % 7 === 0) for (let i = 0; i < A.count; i++) {
    if (!A.alive[i]) continue;
    const k = ids.indexOf(A.species[i]);
    if (k < 0) continue;
    st[k][A.state[i]]++; hung[k] += A.hunger[i]; cnt[k]++;
  }
  if (w.tick % TICKS_PER_YEAR === 0) {
    console.log('year', w.tick / TICKS_PER_YEAR);
    ids.forEach((id, k) => console.log(' ', names[k], 'pop', A.pop[id], 'hunger', (hung[k] / cnt[k]).toFixed(2), 'states', st[k].map((v) => (v / cnt[k] * 100).toFixed(0)).join('/')));
    const pk = A.defs.map((d, s) => A.deaths[s * 8 + 3] - deaths0[s * 8 + 3]);
    console.log('  predation deaths by prey', pk.join(','), 'kills list', A.kills.length);
    st.forEach((a) => a.fill(0)); hung.fill(0); cnt.fill(0);
  }
}
