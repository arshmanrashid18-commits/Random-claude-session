import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';

describe('pathfinding', () => {
  const w = new World({ seed: 20260925, preset: 'earthlike' });
  const g = w.planet.region, t = w.planet.terrain;
  const pf = w.civ.paths;
  const land = w.geo.landOf;

  it('finds contiguous land paths between cells of the same continent', () => {
    // Pick two distant cells on the largest continent.
    const counts = new Map<number, number>();
    for (let c = 0; c < g.count; c++) if (land[c] >= 0) counts.set(land[c], (counts.get(land[c]) ?? 0) + 1);
    const big = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const cells = [];
    for (let c = 0; c < g.count; c++) if (land[c] === big && t.oceanFrac[c] < 0.1 && t.lakeFrac[c] < 0.1) cells.push(c);
    let found = 0;
    for (let k = 0; k < 6; k++) {
      const a = cells[(k * 97) % cells.length], b = cells[(k * 331 + 50) % cells.length];
      const p = pf.find(a, b, 'land', 40000);
      if (!p) continue;
      found++;
      expect(p[0]).toBe(a);
      expect(p[p.length - 1]).toBe(b);
      for (let i = 1; i < p.length; i++) {
        const nb = Array.from(g.neighbors.subarray(p[i - 1] * 8, p[i - 1] * 8 + 8));
        expect(nb).toContain(p[i]);
        if (i < p.length - 1) expect(pf.passable(p[i], 'land')).toBe(true);
      }
    }
    expect(found).toBeGreaterThanOrEqual(4);
  });

  it('never walks across open ocean, and ships never cross land', () => {
    let seaA = -1, seaB = -1;
    for (let c = 0; c < g.count; c++) if (t.oceanFrac[c] > 0.99) { if (seaA < 0) seaA = c; else if (Math.abs(c - seaA) > 500) { seaB = c; break; } }
    const sea = pf.find(seaA, seaB, 'sea', 60000);
    if (sea) for (let i = 1; i < sea.length - 1; i++) expect(pf.passable(sea[i], 'sea')).toBe(true);
    // Land path to a mid-ocean cell must fail (goal excepted, every step must be land).
    const landCell = [...Array(g.count).keys()].find((c) => t.oceanFrac[c] < 0.05 && land[c] >= 0)!;
    const p = pf.find(landCell, seaA, 'land', 40000);
    if (p) for (let i = 1; i < p.length - 1; i++) expect(pf.passable(p[i], 'land')).toBe(true);
  });

  it('returns trivial paths and caches results', () => {
    const c = [...Array(g.count).keys()].find((x) => t.oceanFrac[x] < 0.05)!;
    expect(Array.from(pf.find(c, c, 'land')!)).toEqual([c]);
    const nb = g.neighbors[c * 8];
    const a = pf.find(c, nb, 'land');
    const b = pf.find(c, nb, 'land');
    expect(a).toBe(b);
  });
});
