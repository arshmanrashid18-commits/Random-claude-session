import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/world';
import { saveWorld, loadWorld, readSaveMeta } from '../src/sim/serialize';

describe('save / load', () => {
  it('round-trips the complete simulation state and continues identically', async () => {
    const a = new World({ seed: 4242, preset: 'earthlike' });
    for (let t = 0; t < 700; t++) a.step();
    // Exercise divine state and terrain edits so they are covered too.
    a.command({ kind: 'boundless', on: true });
    const s = a.civ.settlements.find((x) => x.alive)!;
    a.command({ kind: 'power', power: 'bloom', x: s.x, y: s.y, z: s.z });
    a.command({ kind: 'power', power: 'rain', x: s.x, y: s.y, z: s.z });
    a.command({ kind: 'brush', tool: 'raise', x: s.y, y: s.z, z: s.x, radius: 25, strength: 0.6 });
    a.command({ kind: 'brushEnd' });
    for (let t = 0; t < 50; t++) a.step();
    const file = await saveWorld(a, 'Test');
    const meta = await readSaveMeta(file);
    expect(meta.tick).toBe(a.tick);
    expect(meta.seed).toBe(4242);
    const b = await loadWorld(file);
    expect(b.hash()).toBe(a.hash());
    for (let t = 0; t < 400; t++) { a.step(); b.step(); }
    expect(b.tick).toBe(a.tick);
    expect(b.hash()).toBe(a.hash());
    // Shared references survive (memories are the same objects as the list entries).
    for (const t of b.civ.tribes) if (t.best) expect(b.civ.godMemories.includes(t.best)).toBe(true);
    // A world can be saved again after loading.
    const again = await saveWorld(b, 'Again');
    expect((await loadWorld(again)).hash()).toBe(b.hash());
  });

  it('rejects files that are not saves', async () => {
    await expect(loadWorld(new Uint8Array([1, 2, 3, 4]))).rejects.toBeTruthy();
  });
});
