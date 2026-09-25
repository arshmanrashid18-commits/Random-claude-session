import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { POWERS } from '../src/sim/powers/defs';
import { TICKS_PER_YEAR } from '../src/sim/constants';

function scanFinite(root: unknown): string[] {
  // Walk the object graph and report any non-finite number in state.
  const bad: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > 8 || v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const a = v as unknown as ArrayLike<number>;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { bad.push(`${path}[${i}]=${a[i]}`); break; }
      return;
    }
    for (const [k, x] of Object.entries(v as object)) {
      if (typeof x === 'number' && Number.isNaN(x)) bad.push(`${path}.${k}=NaN`);
      else walk(x, `${path}.${k}`, depth + 1);
    }
  };
  walk(root, 'world', 0);
  return bad;
}

describe('divine powers', () => {
  const w = new World({ seed: 1234, preset: 'earthlike' });
  for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();

  it('has at least 16 powers including every required one', () => {
    expect(POWERS.length).toBeGreaterThanOrEqual(16);
    for (const id of ['lightning', 'rain', 'drought', 'earthquake', 'volcano', 'tsunami', 'meteor', 'iceage', 'wildfire', 'plague', 'blessing', 'resurrection', 'bloom']) {
      expect(POWERS.some((p) => p.id === id), id).toBe(true);
    }
  });

  it('enforces devotion costs and cooldowns', () => {
    w.civ.devotion = 5;
    const s = w.civ.settlements.find((x) => x.alive)!;
    expect(w.command({ kind: 'power', power: 'rain', x: s.x, y: s.y, z: s.z }).ok).toBe(false);
    w.civ.devotion = 1000;
    expect(w.command({ kind: 'power', power: 'rain', x: s.x, y: s.y, z: s.z }).ok).toBe(true);
    expect(w.civ.devotion).toBe(1000 - 20);
    expect(w.command({ kind: 'power', power: 'rain', x: s.x, y: s.y, z: s.z }).ok).toBe(false); // cooling down
  });

  it('every power changes the world and none corrupts the state', () => {
    w.command({ kind: 'boundless', on: true });
    const s = w.civ.settlements.filter((x) => x.alive).sort((a, b) => b.pop - a.pop)[0];
    const g = w.planet.region;
    let sea = { x: 0, y: 0, z: 1 }, best = -2;
    for (let c = 0; c < g.count; c++) {
      if (w.planet.terrain.oceanFrac[c] < 0.99) continue;
      const d = g.centers[c * 3] * s.x + g.centers[c * 3 + 1] * s.y + g.centers[c * 3 + 2] * s.z;
      if (d > best) { best = d; sea = { x: g.centers[c * 3], y: g.centers[c * 3 + 1], z: g.centers[c * 3 + 2] }; }
    }
    for (const p of POWERS) {
      const before = w.hash();
      const target = p.target === 'ocean' ? sea : { x: s.x, y: s.y, z: s.z };
      const r = w.command({ kind: 'power', power: p.id, ...target });
      for (let t = 0; t < 60; t++) w.step();
      if (r.ok) expect(w.hash(), p.id).not.toBe(before);
    }
    for (let t = 0; t < TICKS_PER_YEAR; t++) w.step();
    expect(scanFinite(w)).toEqual([]);
  });

  it('witnesses remember divine acts', () => {
    expect(w.civ.godMemories.length).toBeGreaterThan(5);
    const s = w.civ.settlements.filter((x) => x.alive).sort((a, b) => b.pop - a.pop)[0];
    expect(w.command({ kind: 'power', power: 'blessing', x: s.x, y: s.y, z: s.z }).ok).toBe(true);
    const P = w.civ.people;
    let withMemory = 0;
    for (let i = 0; i < P.count; i++) if (P.alive[i] && (P.worstMem[i] >= 0 || P.bestMem[i] >= 0)) withMemory++;
    expect(withMemory).toBeGreaterThan(0);
  });
});
