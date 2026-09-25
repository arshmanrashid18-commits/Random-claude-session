import { World } from '../../src/sim/world';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
const years = Number(process.argv[2] ?? 200);
const w = new World({ seed: 424242, preset: 'earthlike' });
for (let y = 1; y <= years; y++) {
  const t0 = performance.now();
  for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
  w.events.drain();
  if (y % 25 === 0) {
    const live = w.civ.buildings.filter((b) => !b.gone).length;
    const ruins = w.civ.buildings.filter((b) => b.ruin && !b.gone).length;
    console.log(`year ${y}: people ${w.civ.totalPeople()} tribes ${w.civ.tribes.filter((t) => t.alive).length} pops ${w.civ.tribes.map((t) => t.population).join('/')} ms/tick ${((performance.now() - t0) / TICKS_PER_YEAR).toFixed(2)} buildings ${live} (ruins ${ruins}, total ${w.civ.buildings.length}) roads ${w.civ.roads.length} animals ${w.animals.totalAlive()}`);
  }
}
