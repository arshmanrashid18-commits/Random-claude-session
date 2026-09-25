/**
 * 500-year soak: the world keeps running without numerical blow-ups,
 * unbounded memory growth or collapse of the living systems.
 */
import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { TICKS_PER_YEAR } from '../src/sim/constants';
import { saveWorld, loadWorld } from '../src/sim/serialize';
import { mkdirSync, writeFileSync } from 'node:fs';

function nonFinite(w: World): string[] {
  const bad: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > 7 || v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const a = v as unknown as ArrayLike<number>;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { bad.push(`${path}[${i}]`); break; }
      return;
    }
    for (const [k, x] of Object.entries(v as object)) {
      if (typeof x === 'number' && Number.isNaN(x)) bad.push(`${path}.${k}`);
      else walk(x, `${path}.${k}`, depth + 1);
    }
  };
  walk(w, 'world', 0);
  return bad;
}

describe('500-year soak', () => {
  it('runs five centuries stably', async () => {
    const YEARS = Number(process.env.SOAK_YEARS ?? 500);
    const w = new World({ seed: 424242, preset: 'earthlike' });
    const log: string[] = [];
    let maxPeople = 0;
    const t0 = Date.now();
    for (let y = 1; y <= YEARS; y++) {
      const ys = performance.now();
      for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
      const yearMs = performance.now() - ys;
      w.events.drain();
      const people = w.civ.totalPeople();
      maxPeople = Math.max(maxPeople, people);
      if (y % 25 === 0) {
        log.push(`year ${y}: people ${people}, ms/tick ${(yearMs / TICKS_PER_YEAR).toFixed(2)}, tribes ${w.civ.tribes.filter((t) => t.alive).length}, animals ${w.animals.totalAlive()}, species ${w.animals.livingSpecies()}, buildings ${w.civ.buildings.filter((b) => !b.gone).length}/${w.civ.buildings.length}, memories ${w.civ.godMemories.length}, paths ${Object.keys(w.civ.pathTable).length}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        expect(nonFinite(w), `year ${y}`).toEqual([]);
        // Bounded structures.
        expect(w.events.history.length).toBeLessThanOrEqual(6000);
        expect(w.civ.godMemories.length).toBeLessThanOrEqual(3000);
        expect(w.civ.graves.length).toBeLessThanOrEqual(900);
        expect(Object.keys(w.civ.pathTable).length).toBeLessThan(6000);
        expect(w.animals.count).toBeLessThanOrEqual(w.animals.cap);
        // Crumbled ruins free their slots: the building list does not grow for ever.
        expect(w.civ.buildings.length).toBeLessThan(9000);
      }
    }
    console.log(log.join('\n'));
    mkdirSync('test-results', { recursive: true });
    writeFileSync(`test-results/soak-${YEARS}y.txt`, log.join('\n') + '\n');
    // Life endures.
    expect(w.animals.totalAlive()).toBeGreaterThan(500);
    expect(w.animals.livingSpecies()).toBeGreaterThanOrEqual(5);
    expect(maxPeople).toBeGreaterThan(100);
    // The world still saves and loads after centuries.
    const file = await saveWorld(w, 'soak');
    const b = await loadWorld(file);
    expect(b.hash()).toBe(w.hash());
  });
});
