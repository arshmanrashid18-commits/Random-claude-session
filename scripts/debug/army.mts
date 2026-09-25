import { World } from '../../src/sim/world';
import { PSTATE_NAMES } from '../../src/sim/civ/defs';
import { Intent } from '../../src/sim/civ/people';
const IN = Object.fromEntries(Object.entries(Intent).map(([k, v]) => [v, k]));
const w = new World({ seed: 20260925, preset: 'earthlike' });
const civ = w.civ, P = civ.people, so = civ.society;
let traced = 0;
while (w.tick < 40 * 960 && traced < 2) {
  w.step();
  const ar = so.armies.find((a) => a.stage === 1);
  if (!ar) continue;
  traced++;
  const target = civ.settlements[ar.target];
  console.log(`army ${ar.id} of ${civ.tribes[ar.tribe].name} -> ${target.name} path len ${civ.pathTable[ar.pathId]?.length} naval ${ar.naval}`);
  for (let k = 0; k < 70 && so.armies.includes(ar); k++) {
    for (let t = 0; t < 10; t++) w.step();
    const rows = ar.members.map((u) => P.slot(u)).filter((i) => i >= 0).map((i) => {
      const d = Math.acos(Math.min(1, P.x[i] * target.x + P.y[i] * target.y + P.z[i] * target.z)) * 1000;
      return `${PSTATE_NAMES[P.state[i]]}/${IN[P.intent[i]]} d${d.toFixed(0)} pp${P.pathPos[i]} a${P.army[i]} h${P.hunger[i].toFixed(2)} c${P.carryAmt[i].toFixed(0)} sick${P.sick[i].toFixed(1)}`;
    });
    console.log(` t${w.tick} stage ${ar.stage} ${rows.join(' | ')}`);
    if (ar.stage >= 2) break;
  }
}
