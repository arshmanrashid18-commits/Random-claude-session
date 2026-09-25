/// <reference lib="webworker" />
/**
 * Simulation worker. Owns the World, advances it on a fixed-tick scheduler
 * decoupled from rendering, and streams state to the main thread.
 */
import { World } from '../sim/world';
import { TICKS_PER_SECOND_1X } from '../sim/constants';
import { buildPadMap, packRGBA } from '../sim/planet/regiontex';
import type { MainToWorker, RegionTextures, StaticWorldData, WorkerToMain } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerToMain, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

let world: World | null = null;
let padMap: Int32Array | null = null;
let speed = 1;
let paused = true;
let acc = 0;
let lastTime = performance.now();
let simMsAvg = 0;
let tpsWindowStart = performance.now();
let tpsTicks = 0;
let tps = 0;
const spareTextures: RegionTextures[] = [];
let lastTexTime = 0;
let texDirty = true;

function makeTextures(n: number): RegionTextures {
  const size = (n + 2) * (n + 2) * 6 * 4;
  return { climate: new Uint8Array(size), vegA: new Uint8Array(size), vegB: new Uint8Array(size), surface: new Uint8Array(size) };
}

function fillTextures(w: World, t: RegionTextures): void {
  const pm = padMap!;
  const cl = w.planet.climate;
  packRGBA(pm, t.climate,
    (c) => (cl.temp[c] + 40) / 80,
    (c) => cl.meanRain[c] / 4,
    (c) => cl.snow[c],
    (c) => cl.cloud[c]);
  // Vegetation arrives with the ecology phase; derive a climate-based proxy.
  packRGBA(pm, t.vegA,
    (c) => vegProxy(cl.meanTemp[c], cl.meanRain[c], 0),
    (c) => vegProxy(cl.meanTemp[c], cl.meanRain[c], 1),
    (c) => vegProxy(cl.meanTemp[c], cl.meanRain[c], 2),
    (c) => vegProxy(cl.meanTemp[c], cl.meanRain[c], 3));
  packRGBA(pm, t.vegB,
    (c) => vegProxy(cl.meanTemp[c], cl.meanRain[c], 4),
    (c) => vegProxy(cl.meanTemp[c], cl.meanRain[c], 5),
    () => 0,
    (c) => vegProxy(cl.meanTemp[c], cl.meanRain[c], 7));
  packRGBA(pm, t.surface, () => 0, (c) => cl.ash[c], () => 0, () => 0);
}

function vegProxy(t: number, r: number, k: number): number {
  const sm = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  switch (k) {
    case 0: return sm(-4, 4, t) * sm(0.25, 0.9, r);
    case 1: return sm(0, 8, t) * sm(0.4, 1.1, r) * 0.6;
    case 2: return sm(4, 10, t) * (1 - sm(20, 26, t)) * sm(1.0, 1.8, r);
    case 3: return sm(-6, -1, t) * (1 - sm(6, 12, t)) * sm(0.45, 1.0, r);
    case 4: return sm(18, 23, t) * sm(1.4, 2.4, r);
    case 5: return sm(12, 20, t) * (1 - sm(0.3, 0.7, r)) * 0.7;
    case 7: return sm(-12, -4, t) * (1 - sm(0, 5, t));
    default: return 0;
  }
}

function staticData(w: World): { data: StaticWorldData; transfer: Transferable[] } {
  const p = w.planet;
  const rivers = p.hydro.rivers;
  let total = 0;
  for (const r of rivers) total += r.width.length;
  const points = new Float32Array(total * 3);
  const width = new Float32Array(total);
  const level = new Float32Array(total);
  const offsets = new Int32Array(rivers.length + 1);
  let o = 0;
  rivers.forEach((r, i) => {
    offsets[i] = o;
    points.set(r.points, o * 3);
    width.set(r.width, o);
    level.set(r.level, o);
    o += r.width.length;
  });
  offsets[rivers.length] = o;
  let lakeCells = 0;
  for (const l of p.hydro.lakes) lakeCells += l.cells.length;
  const cells = new Int32Array(lakeCells);
  const levels = new Float32Array(lakeCells);
  let k = 0;
  for (const l of p.hydro.lakes) for (const c of l.cells) { cells[k] = c; levels[k] = l.level; k++; }
  const heights = p.heights.slice();
  const data: StaticWorldData = {
    seed: w.seed,
    preset: w.preset,
    heightN: p.hg.n,
    regionN: p.region.n,
    hydroN: p.hydroGrid.n,
    heights,
    rivers: { points, width, level, offsets },
    lakes: { cells, levels },
  };
  return { data, transfer: [heights.buffer, points.buffer, width.buffer, level.buffer, offsets.buffer, cells.buffer, levels.buffer] };
}

function stepWorld(n: number): void {
  if (!world) return;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) world.step();
  const dt = performance.now() - t0;
  if (n > 0) simMsAvg = simMsAvg * 0.9 + (dt / n) * 0.1;
  tpsTicks += n;
  texDirty = true;
}

function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  if (world && !paused) {
    const rate = TICKS_PER_SECOND_1X * speed;
    acc += dt * rate;
    const deadline = now + 28;
    let n = 0;
    while (acc >= 1 && performance.now() < deadline) {
      stepWorld(1);
      acc -= 1;
      n++;
    }
    // If the simulation cannot keep up, drop the backlog rather than spiral.
    if (acc > rate * 0.3 + 2) acc = rate * 0.3 + 2;
  }
  if (now - tpsWindowStart > 1000) {
    tps = (tpsTicks * 1000) / (now - tpsWindowStart);
    tpsTicks = 0;
    tpsWindowStart = now;
  }
  if (world) {
    post({ type: 'frame', header: { tick: world.tick, tps, simMs: simMsAvg, speed, paused } });
    if (texDirty && spareTextures.length > 0 && now - lastTexTime > 200) sendTextures();
  }
  setTimeout(loop, 8);
}

function sendTextures(): void {
  if (!world) return;
  const t = spareTextures.pop()!;
  fillTextures(world, t);
  lastTexTime = performance.now();
  texDirty = false;
  post({ type: 'textures', tex: t, tick: world.tick }, [t.climate.buffer, t.vegA.buffer, t.vegB.buffer, t.surface.buffer]);
}

ctx.onmessage = (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        world = new World({ seed: msg.seed, preset: msg.preset }, (stage, frac) => post({ type: 'progress', stage, frac }));
        padMap = buildPadMap(world.planet.region);
        spareTextures.length = 0;
        spareTextures.push(makeTextures(world.planet.region.n), makeTextures(world.planet.region.n));
        const { data, transfer } = staticData(world);
        post({ type: 'ready', data }, transfer);
        texDirty = true;
        sendTextures();
        break;
      }
      case 'speed':
        speed = msg.speed;
        paused = msg.paused;
        break;
      case 'advance': {
        stepWorld(msg.ticks);
        post({ type: 'advanced', id: msg.id, tick: world ? world.tick : 0 });
        if (spareTextures.length > 0) sendTextures();
        break;
      }
      case 'hash':
        post({ type: 'hash', id: msg.id, hash: world ? world.hash() : 0 });
        break;
      case 'returnTextures':
        spareTextures.push(msg.tex);
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};

loop();
