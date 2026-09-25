/**
 * Simulation benchmark: ms per tick by subsystem at the natural population,
 * then with the agent count raised to 5,000 and 10,000 (herds cloned into
 * their own habitat). Runs in Node — the same code the Web Worker runs.
 *
 * Usage: npx tsx scripts/bench.mts [--seed=N] [--ticks=400] [--years=1]
 */
import { World } from '../src/sim/world';
import { TICKS_PER_YEAR } from '../src/sim/constants';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? 'true'];
}));
const seed = Number(args.seed ?? 20260925);
const N = Number(args.ticks ?? 400);
const WARM = Number(args.years ?? 1);

const t0 = performance.now();
const w = new World({ seed, preset: 'earthlike' });
const genMs = performance.now() - t0;

// Wrap each subsystem with a timer.
const acc: Record<string, number> = {};
function timed<T extends object>(obj: T, method: keyof T & string, label: string): void {
  const fn = (obj as Record<string, unknown>)[method] as (...a: unknown[]) => unknown;
  (obj as Record<string, unknown>)[method] = function (this: unknown, ...a: unknown[]) {
    const s = performance.now();
    const r = fn.apply(this, a);
    acc[label] = (acc[label] ?? 0) + performance.now() - s;
    return r;
  };
}
timed(w.planet.climate, 'tick', 'climate');
timed(w.weather, 'update', 'weather');
timed(w.fires, 'tick', 'fire');
timed(w.plants, 'tick', 'plants');
timed(w.animals, 'tick', 'animals');
timed(w.civ, 'tick', 'civilisation');
timed(w.divine, 'tick', 'powers');

// Let the world settle (and its peoples grow) before measuring.
for (let i = 0; i < TICKS_PER_YEAR * WARM; i++) w.step();

const people = () => w.civ.totalPeople();
const animals = () => w.animals.totalAlive();

function measure(label: string): string {
  for (const k of Object.keys(acc)) acc[k] = 0;
  const s = performance.now();
  for (let i = 0; i < N; i++) w.step();
  const total = (performance.now() - s) / N;
  const parts = Object.entries(acc).map(([k, v]) => `${k} ${(v / N).toFixed(2)}`).join(' · ');
  // 100× = 400 ticks/s; the worker spends at most ~88% of each frame simulating.
  const maxSpeed = Math.min(100, (0.88 * 1000) / (total * 4));
  return `| ${label} | ${animals() + people()} | ${animals()} | ${people()} | ${total.toFixed(2)} | ${maxSpeed.toFixed(0)}× | ${parts} |`;
}

/** Clone herds into their own habitat until the agent count reaches `target`. */
function fill(target: number): void {
  const A = w.animals;
  let guard = 0;
  while (animals() + people() < target && guard++ < 200000) {
    const i = w.rng.int(0, A.count);
    if (!A.alive[i]) continue;
    const j = A.spawn(w.rng, A.species[i], A.x[i], A.y[i], A.z[i], null, -1, A.defs[A.species[i]].adultAge + 0.5);
    if (j < 0) break;
  }
}

const rows: string[] = [];
rows.push(measure(`natural (year ${WARM})`));
fill(5000);
rows.push(measure('5,000 agents'));
fill(10000);
rows.push(measure('10,000 agents'));

console.log(`World generation: ${(genMs / 1000).toFixed(1)} s (seed ${seed}); ${N} ticks per row; Node ${process.version}\n`);
console.log('| Scenario | Agents | Animals | People | ms/tick | Max speed | By system (ms/tick) |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) console.log(r);
