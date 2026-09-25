import { World } from '../../src/sim/world';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
const w = new World({ seed: Number(process.argv[2] ?? 20260925), preset: 'earthlike' });
const years = Number(process.argv[3] ?? 40);
let seen = 0;
for (let y = 0; y < years; y++) {
  for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
  for (const e of w.events.drain()) if (e.kind === 'plague') { seen++; console.log('year', y + 1, JSON.stringify(e.data)); }
  if ((y + 1) % 5 === 0) console.log(`-- year ${y + 1} people ${w.civ.totalPeople()} plague deaths ${w.civ.deathCauses.plague ?? 0}`);
}
