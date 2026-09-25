import { World } from '../../src/sim/world';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
import { JOB_NAMES, TIER_NAMES, AGE_NAMES, BUILDINGS } from '../../src/sim/civ/defs';
import { TECHS } from '../../src/sim/civ/tech';
const seed = Number(process.argv[2] ?? 20260925);
const years = Number(process.argv[3] ?? 10);
const every = Number(process.argv[4] ?? 1);
const w = new World({ seed, preset: 'earthlike' });
const civ = w.civ;
console.log('tribes', civ.tribes.map((t) => t.name).join(', '));
for (let y = 0; y < years; y++) {
  const t0 = performance.now();
  for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
  const ms = (performance.now() - t0) / TICKS_PER_YEAR;
  if ((y + 1) % every) continue;
  civ.census();
  console.log(`--- year ${y + 1}  people=${civ.totalPeople()} animals=${w.animals.totalAlive()} ms/tick=${ms.toFixed(2)} devotion=${civ.devotion.toFixed(0)}`);
  for (const t of civ.tribes) {
    const sets = t.settlements.map((id) => civ.settlements[id]).filter((s) => s.alive);
    const known = TECHS.filter((_, k) => t.known[k]).length;
    console.log(`  ${t.name.padEnd(12)} pop ${String(t.population).padStart(4)} ${AGE_NAMES[t.age].padEnd(12)} techs ${known} settlements ${sets.length}`);
    for (const s of sets) {
      const blds = s.buildings.map((id) => civ.buildings[id]).filter((b) => !b.ruin);
      const done = blds.filter((b) => b.complete);
      const kinds = [...new Set(done.map((b) => BUILDINGS[b.type].name))].join(',');
      console.log(`    ${s.name.padEnd(12)} ${TIER_NAMES[s.tier].padEnd(7)} pop ${String(s.pop).padStart(3)} food ${s.stock[0].toFixed(0).padStart(4)} wood ${s.stock[1].toFixed(0).padStart(3)} stone ${s.stock[2].toFixed(0).padStart(3)} metal ${s.stock[3].toFixed(0).padStart(3)} bld ${done.length}/${blds.length} famine ${s.famine} [${kinds}]`);
      const jobs = s.jobTarget.map((n, j) => (n ? `${JOB_NAMES[j]}:${n}` : '')).filter(Boolean).join(' ');
      console.log(`      jobs ${jobs}`);
    }
  }
}
const h = civ.holdings(), L = civ.ledger;
for (let r = 0; r < 4; r++) console.log('res', r, 'created', L.created[r].toFixed(1), 'held', h[r].toFixed(1), 'consumed', L.consumed[r].toFixed(1), 'used', L.used[r].toFixed(1), 'destroyed', L.destroyed[r].toFixed(1), 'balance', (L.created[r] - h[r] - L.consumed[r] - L.used[r] - L.destroyed[r]).toFixed(3));
const ev = w.events.history.filter((e) => ['tech', 'age', 'settlement-founded', 'settlement-grew', 'migration', 'settlement-abandoned', 'tribe-founded'].includes(e.kind)).slice(-30);
for (const e of ev) console.log(Math.floor(e.tick / TICKS_PER_YEAR), e.kind, JSON.stringify(e.data));
