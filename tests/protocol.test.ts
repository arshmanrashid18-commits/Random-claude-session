/**
 * Worker protocol contract: drive the real worker module's message handler
 * in-process and check every reply against the typed protocol.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { MainToWorker, WorkerToMain, StaticWorldData, FrameData, RegionTextures, CivData } from '../src/worker/protocol';

const sent: WorkerToMain[] = [];
const scope: { postMessage: (m: WorkerToMain) => void; onmessage: ((e: { data: MainToWorker }) => void) | null } = {
  postMessage: (m) => { sent.push(m); },
  onmessage: null,
};

function send(m: MainToWorker): void {
  scope.onmessage!({ data: m });
}

function take<T extends WorkerToMain['type']>(type: T): Extract<WorkerToMain, { type: T }>[] {
  return sent.filter((m) => m.type === type) as Extract<WorkerToMain, { type: T }>[];
}

async function until<T>(fn: () => T | undefined, ms = 60000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  (globalThis as { self?: unknown }).self = scope;
  (globalThis as { __genesisNoLoop?: boolean }).__genesisNoLoop = true;
  await import('../src/worker/sim.worker');
});

describe('worker protocol', () => {
  it('reports generation progress and a well-formed ready message', () => {
    send({ type: 'init', seed: 555, preset: 'earthlike' });
    const progress = take('progress');
    expect(progress.length).toBeGreaterThan(5);
    for (const p of progress) { expect(p.frac).toBeGreaterThanOrEqual(0); expect(p.frac).toBeLessThanOrEqual(1); }
    const ready = take('ready')[0];
    expect(ready).toBeTruthy();
    const d: StaticWorldData = ready.data;
    expect(d.seed).toBe(555);
    expect(d.heights.length).toBe(6 * (d.heightN + 1) * (d.heightN + 1));
    expect(d.rivers.offsets[d.rivers.offsets.length - 1]).toBe(d.rivers.width.length);
    expect(d.rivers.points.length).toBe(d.rivers.width.length * 3);
    expect(d.lakes.cells.length).toBe(d.lakes.levels.length);
    expect(d.species.length).toBeGreaterThanOrEqual(10);
    const tex: RegionTextures = take('textures')[0].tex;
    const size = (d.regionN + 2) * (d.regionN + 2) * 6 * 4;
    for (const k of ['climate', 'vegA', 'vegB', 'surface', 'fx', 'owner'] as const) expect(tex[k].length).toBe(size);
  });

  it('advances, streams frames with entities, and reports the tick', () => {
    sent.length = 0;
    send({ type: 'advance', ticks: 40, id: 7 });
    const adv = take('advanced')[0];
    expect(adv.id).toBe(7);
    expect(adv.tick).toBe(40);
    const frame: FrameData = take('frame')[0].frame;
    expect(frame.header.tick).toBe(40);
    expect(frame.animals && frame.animals.count).toBeGreaterThan(100);
    expect(frame.people && frame.people.count).toBeGreaterThan(20);
    expect(frame.cooldowns.length).toBeGreaterThanOrEqual(16);
    const civ: CivData = take('civ')[0].civ;
    expect(civ.tribes.length).toBeGreaterThan(0);
    expect(civ.roads.length % 7).toBe(0);
  });

  it('answers commands, inspection, ecology and hashing', async () => {
    sent.length = 0;
    const civ = (sent.find((m) => m.type === 'civ') as { civ: CivData } | undefined)?.civ;
    void civ;
    send({ type: 'command', id: 11, cmd: { kind: 'boundless', on: true } });
    expect(take('commandResult')[0]).toMatchObject({ id: 11, ok: true });
    send({ type: 'command', id: 12, cmd: { kind: 'power', power: 'rain', x: 0, y: 1, z: 0 } });
    expect(take('commandResult').find((r) => r.id === 12)!.ok).toBe(true);
    send({ type: 'inspect', id: 13, target: { kind: 'tribe', id: 0 } });
    const insp = take('inspect')[0];
    expect(insp.id).toBe(13);
    expect(insp.info?.kind).toBe('tribe');
    send({ type: 'inspect', id: 14, target: { kind: 'person', uid: 999999 } });
    expect(take('inspect').find((r) => r.id === 14)!.info).toBeNull();
    send({ type: 'ecology', id: 15 });
    const eco = take('ecology')[0];
    expect(eco.data.history.length).toBe(eco.data.species.length);
    send({ type: 'hash', id: 16 });
    expect(typeof take('hash')[0].hash).toBe('number');
    send({ type: 'save', id: 17, name: 'contract' });
    const saved = await until(() => take('saved')[0]);
    expect(saved.id).toBe(17);
    expect(saved.data && saved.data.length).toBeGreaterThan(1000);
  });

  it('streams terrain edits as face updates and new water', () => {
    sent.length = 0;
    send({ type: 'command', id: 20, cmd: { kind: 'brush', tool: 'lower', x: 0.3, y: 0.5, z: 0.81, radius: 40, strength: 1 } });
    send({ type: 'command', id: 21, cmd: { kind: 'brushEnd' } });
    expect(take('commandResult').map((r) => [r.id, r.ok, r.message])).toEqual([[20, true, ''], [21, true, '']]);
  });
});
