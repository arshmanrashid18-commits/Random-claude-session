import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';

describe('determinism', () => {
  it('same seed + same inputs produce an identical world hash', () => {
    const a = new World({ seed: 424242, preset: 'earthlike' });
    const b = new World({ seed: 424242, preset: 'earthlike' });
    expect(a.hash()).toBe(b.hash());
    for (let i = 0; i < 600; i++) { a.step(); b.step(); }
    expect(a.tick).toBe(600);
    expect(a.hash()).toBe(b.hash());
  });

  it('different seeds produce different worlds', () => {
    const a = new World({ seed: 1, preset: 'earthlike' });
    const b = new World({ seed: 2, preset: 'earthlike' });
    expect(a.hash()).not.toBe(b.hash());
  });
});
