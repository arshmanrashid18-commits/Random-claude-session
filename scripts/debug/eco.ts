import { World } from '../../src/sim/world';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
const seed = Number(process.argv[2] ?? 20260925);
const years = Number(process.argv[3] ?? 10);
const t0 = performance.now();
const w = new World({ seed, preset: 'earthlike' });
console.log(`gen ${(performance.now() - t0).toFixed(0)}ms`);
const a = w.animals;
const names = a.defs.map((d) => d.name.slice(0, 7));
console.log('yr   ' + names.join(' ') + '  total  ms/tick fires storms');
for (let y = 0; y < years; y++) {
  const ts = performance.now();
  for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
  const ms = (performance.now() - ts) / TICKS_PER_YEAR;
  const counts = a.defs.map((_, s) => String(a.pop[s]).padStart(7)).join(' ');
  console.log(`${String(y + 1).padStart(3)} ${counts}  ${String(a.totalAlive()).padStart(6)}  ${ms.toFixed(2)}  ${w.fires.active.length} ${w.weather.storms.length}`);
}
const ev = w.events.history.slice(-15).map((e) => `${Math.floor(e.tick / TICKS_PER_YEAR)} ${e.kind} ${JSON.stringify(e.data)}`);
console.log(ev.join('\n'));
console.log('records', a.records);
const causes = ['hunger', 'thirst', 'age', 'pred', 'disease', 'fire', 'climate', 'other'];
for (let s = 0; s < a.defs.length; s++) {
  const row = causes.map((c, k) => `${c}:${a.deaths[s * 8 + k]}`).join(' ');
  console.log(a.defs[s].name.padEnd(10), row);
}
