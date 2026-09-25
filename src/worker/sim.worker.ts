/// <reference lib="webworker" />
/**
 * Simulation worker. Owns the World, advances it on a fixed-tick scheduler
 * decoupled from rendering, and streams state to the main thread.
 */
import { World } from '../sim/world';
import { TICKS_PER_SECOND_1X } from '../sim/constants';
import { buildPadMap, packRGBA } from '../sim/planet/regiontex';
import type { EntitySnapshot, FrameData, MainToWorker, RegionTextures, SpeciesInfo, StaticWorldData, WorkerToMain } from './protocol';

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
const spareSnaps: EntitySnapshot[] = [];
let lastTexTime = 0;
let texDirty = true;
let lastSnapTick = -1;
let lastStatsTime = 0;
let speciesCount = 0;

function makeTextures(n: number): RegionTextures {
  const size = (n + 2) * (n + 2) * 6 * 4;
  return { climate: new Uint8Array(size), vegA: new Uint8Array(size), vegB: new Uint8Array(size), surface: new Uint8Array(size), fx: new Uint8Array(size) };
}

function makeSnapshot(cap: number): EntitySnapshot {
  return { tick: 0, count: 0, pos: new Float32Array(cap * 3), info: new Uint32Array(cap * 2) };
}

function fillTextures(w: World, t: RegionTextures): void {
  const pm = padMap!;
  const cl = w.planet.climate;
  const pd = w.plants.density;
  packRGBA(pm, t.climate, (c) => (cl.temp[c] + 40) / 80, (c) => cl.meanRain[c] / 4, (c) => cl.snow[c], (c) => cl.cloud[c]);
  packRGBA(pm, t.vegA, (c) => pd[c * 8], (c) => pd[c * 8 + 1], (c) => pd[c * 8 + 2], (c) => pd[c * 8 + 3]);
  packRGBA(pm, t.vegB, (c) => pd[c * 8 + 4], (c) => pd[c * 8 + 5], (c) => pd[c * 8 + 6], (c) => pd[c * 8 + 7]);
  packRGBA(pm, t.surface, (c) => w.fires.scar[c], (c) => cl.ash[c], () => 0, () => 0);
  packRGBA(pm, t.fx, (c) => cl.rain[c] * 2, (c) => fogAt(w, c), (c) => w.fires.intensity[c], () => 0);
}

/** Fog: saturated, calm air near dawn-cool surfaces. */
function fogAt(w: World, c: number): number {
  const cl = w.planet.climate;
  const sat = 3.8 * Math.exp(0.0687 * Math.max(-45, Math.min(45, cl.temp[c])));
  const rh = cl.humid[c] / sat;
  const wind = Math.hypot(cl.windE[c], cl.windN[c]);
  return Math.max(0, (rh - 0.82) * 5) * Math.max(0, 1 - wind / 9);
}

function speciesInfo(w: World): SpeciesInfo[] {
  return w.animals.defs.map((d) => ({ id: d.id, name: d.name, plural: d.plural, body: d.body, diet: d.diet, size: d.size, colour: d.colour, colour2: d.colour2, parent: d.parent }));
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
    species: speciesInfo(w),
  };
  return { data, transfer: [heights.buffer, points.buffer, width.buffer, level.buffer, offsets.buffer, cells.buffer, levels.buffer] };
}

function fillAnimals(w: World, s: EntitySnapshot): void {
  const a = w.animals;
  let n = 0;
  for (let i = 0; i < a.count; i++) {
    if (!a.alive[i]) continue;
    s.pos[n * 3] = a.x[i];
    s.pos[n * 3 + 1] = a.y[i];
    s.pos[n * 3 + 2] = a.z[i];
    const size = Math.min(255, Math.round(a.defs[a.species[i]].size * a.gSize[i] * 60));
    const flags = (a.infected[i] === 1 ? 1 : 0) | (a.age[i] < a.defs[a.species[i]].adultAge ? 2 : 0) | (a.sex[i] ? 4 : 0);
    s.info[n * 2] = a.uid[i];
    s.info[n * 2 + 1] = a.species[i] | (a.state[i] << 8) | (size << 16) | (flags << 24);
    n++;
  }
  s.count = n;
  s.tick = w.tick;
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

function sendFrame(now: number): void {
  if (!world) return;
  const w = world;
  let animals: EntitySnapshot | null = null;
  const transfer: Transferable[] = [];
  if (w.tick !== lastSnapTick && spareSnaps.length > 0) {
    animals = spareSnaps.pop()!;
    fillAnimals(w, animals);
    transfer.push(animals.pos.buffer, animals.info.buffer);
    lastSnapTick = w.tick;
  }
  let stats = null;
  if (now - lastStatsTime > 500) {
    lastStatsTime = now;
    const a = w.animals;
    let cover = 0, land = 0;
    const pd = w.plants.density;
    const terr = w.planet.terrain;
    for (let c = 0; c < terr.oceanFrac.length; c += 7) {
      if (terr.oceanFrac[c] > 0.5) continue;
      land++;
      let s = 0;
      for (let k = 0; k < 8; k++) s += pd[c * 8 + k];
      cover += Math.min(1, s);
    }
    stats = {
      animals: a.totalAlive(),
      species: a.livingSpecies(),
      biodiversity: a.shannon(),
      plantCover: land ? cover / land : 0,
      pop: Array.from(a.pop.subarray(0, a.defs.length)),
      fires: w.fires.active.length,
    };
  }
  if (w.animals.defs.length !== speciesCount) {
    speciesCount = w.animals.defs.length;
    post({ type: 'species', species: speciesInfo(w) });
  }
  const strikes = w.weather.strikeLog.splice(0);
  const frame: FrameData = {
    header: { tick: w.tick, tps, simMs: simMsAvg, speed, paused },
    storms: w.weather.storms.map((s) => ({ id: s.id, type: s.type, name: s.name, x: s.x, y: s.y, z: s.z, radius: s.radius, intensity: s.intensity })),
    strikes,
    events: w.events.drain(),
    animals,
    stats,
  };
  post({ type: 'frame', frame }, transfer);
}

function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  if (world && !paused) {
    const rate = TICKS_PER_SECOND_1X * speed;
    acc += dt * rate;
    const deadline = now + 28;
    while (acc >= 1 && performance.now() < deadline) {
      stepWorld(1);
      acc -= 1;
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
    sendFrame(now);
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
  post({ type: 'textures', tex: t, tick: world.tick }, [t.climate.buffer, t.vegA.buffer, t.vegB.buffer, t.surface.buffer, t.fx.buffer]);
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
        spareSnaps.length = 0;
        for (let i = 0; i < 3; i++) spareSnaps.push(makeSnapshot(world.animals.cap));
        speciesCount = world.animals.defs.length;
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
      case 'returnSnapshot':
        spareSnaps.push(msg.snap);
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};

loop();
