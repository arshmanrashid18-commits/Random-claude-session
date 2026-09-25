/** Cast every divine power in a headless world and report consequences. */
import { World } from '../../src/sim/world';
import { POWERS } from '../../src/sim/powers/defs';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
const w = new World({ seed: Number(process.argv[2] ?? 20260925), preset: 'earthlike' });
w.divine.boundless = true;
for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
w.events.drain();
const civ = w.civ;
const s = civ.settlements.filter((x) => x.alive).sort((a, b) => b.pop - a.pop)[0];
// A sea point near the settlement.
let sea = { x: s.x, y: s.y, z: s.z };
const g = w.planet.region;
let bestD = Infinity;
for (let c = 0; c < g.count; c++) {
  if (w.planet.terrain.oceanFrac[c] < 0.99) continue;
  const d = Math.acos(Math.min(1, g.centers[c * 3] * s.x + g.centers[c * 3 + 1] * s.y + g.centers[c * 3 + 2] * s.z));
  if (d < bestD) { bestD = d; sea = { x: g.centers[c * 3], y: g.centers[c * 3 + 1], z: g.centers[c * 3 + 2] }; }
}
console.log('target', s.name, 'pop', s.pop, 'sea at', (bestD * 1000).toFixed(0));
for (const p of POWERS) {
  const pop0 = civ.totalPeople();
  const a0 = w.animals.totalAlive();
  const live = civ.settlements.filter((x) => x.alive).sort((a, b) => b.pop - a.pop)[0];
  const at = p.target === 'ocean' ? sea : { x: live.x, y: live.y, z: live.z };
  const t0 = performance.now();
  const r = w.command({ kind: 'power', power: p.id, ...at });
  const ms = performance.now() - t0;
  for (let t = 0; t < 120; t++) w.step();
  const ev = w.events.drain().filter((e) => e.importance >= 0.4).map((e) => `${e.kind}${e.data.name ? ':' + e.data.name : ''}`);
  console.log(`${p.id.padEnd(13)} ok=${r.ok} ${r.message} ${r.combo ?? ''} cast=${ms.toFixed(0)}ms people ${pop0}->${civ.totalPeople()} animals ${a0}->${w.animals.totalAlive()} devotion=${civ.devotion.toFixed(0)} | ${[...new Set(ev)].join(', ')}`);
}
// Terraform timings.
const t1 = performance.now();
for (let k = 0; k < 10; k++) w.command({ kind: 'brush', tool: 'raise', x: s.x, y: s.y, z: s.z, radius: 30, strength: 0.8 });
const t2 = performance.now();
w.command({ kind: 'brushEnd' });
const t3 = performance.now();
console.log(`brush x10 ${(t2 - t1).toFixed(1)}ms, commit ${(t3 - t2).toFixed(1)}ms`);
console.log('wars', civ.society.wars.length, 'routes', civ.society.routes.length, 'tribes', civ.tribes.length);
console.log('hash', w.hash());
