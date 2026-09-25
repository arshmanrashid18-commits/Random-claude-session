import { World } from '../../src/sim/world';
import { TICKS_PER_YEAR } from '../../src/sim/constants';
const w = new World({ seed: Number(process.argv[2] ?? 20260925), preset: 'earthlike' });
const years = Number(process.argv[3] ?? 60);
const civ = w.civ, so = civ.society, T = civ.tribes;
const kinds = new Set(['siege', 'war', 'holy-war', 'peace', 'conquest', 'betrayal', 'alliance', 'first-contact', 'trade-route', 'refugees', 'schism', 'religion', 'plague', 'age']);
for (let y = 1; y <= years; y++) {
  for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
  for (const e of w.events.drain()) {
    if (kinds.has(e.kind)) console.log(`y${y} ${e.kind} ${JSON.stringify(e.data)}`);
    if (e.kind === 'battle') console.log(`y${y} battle ${e.data.stage ?? 'fight'} ${e.data.a} ${e.data.target ?? e.data.settlement ?? ''} size ${e.data.size ?? ''} naval ${e.data.naval ?? ''}`);
  }
  if (y % 10 === 0) {
    console.log(`== year ${y} people ${civ.totalPeople()} tribes ${T.filter((t) => t.alive).length}`);
    for (let a = 0; a < T.length; a++) for (let b = a + 1; b < T.length; b++) if (so.contact[a]?.[b]) console.log(`   ${T[a].name}-${T[b].name} rel ${so.rel[a][b].toFixed(2)} pact ${so.pact[a][b]} war ${!!so.atWar(a, b)} faith ${T[a].religion.name === T[b].religion.name ? 'same' : 'diff'}`);
  }
}
