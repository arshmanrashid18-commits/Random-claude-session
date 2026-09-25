import { describe, it, expect } from 'vitest';
import { TECHS, TECH_INDEX, STARTING_TECHS, validateTechTree, ageOf, FIELD_NAMES } from '../src/sim/civ/tech';
import { Age } from '../src/sim/civ/defs';

describe('tech tree', () => {
  it('has at least 40 technologies with unique ids', () => {
    expect(TECHS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(TECHS.map((t) => t.id)).size).toBe(TECHS.length);
  });

  it('is fully reachable from the starting knowledge, with no dangling requirements', () => {
    const r = validateTechTree();
    expect(r.missing).toEqual([]);
    expect(r.unreachable).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('has no cycles and requirements are never more expensive than what they unlock', () => {
    for (const t of TECHS) {
      for (const req of t.req) {
        const r = TECHS[TECH_INDEX.get(req)!];
        expect(r.cost, `${req} -> ${t.id}`).toBeLessThanOrEqual(t.cost);
      }
    }
    // Depth-first cycle check.
    const state = new Map<string, number>();
    const visit = (id: string): void => {
      const s = state.get(id);
      if (s === 1) throw new Error(`cycle at ${id}`);
      if (s === 2) return;
      state.set(id, 1);
      for (const r of TECHS[TECH_INDEX.get(id)!].req) visit(r);
      state.set(id, 2);
    };
    for (const t of TECHS) visit(t.id);
  });

  it('covers every field of knowledge and every age transition', () => {
    const fields = new Set(TECHS.map((t) => t.field));
    expect(fields.size).toBe(FIELD_NAMES.length);
    const ages = new Set(TECHS.filter((t) => t.age !== undefined).map((t) => t.age));
    for (const a of [Age.Bronze, Age.Iron, Age.Classical, Age.Medieval, Age.Renaissance, Age.Industrial]) expect(ages.has(a)).toBe(true);
    const all = Uint8Array.from(TECHS.map(() => 1));
    expect(ageOf(all)).toBe(Age.Industrial);
    const start = Uint8Array.from(TECHS.map((t) => (STARTING_TECHS.includes(t.id) ? 1 : 0)));
    expect(ageOf(start)).toBe(Age.Stone);
  });
});
