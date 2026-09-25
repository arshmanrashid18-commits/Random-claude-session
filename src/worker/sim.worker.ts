/// <reference lib="webworker" />
/**
 * Simulation worker. Owns the World, advances it on a fixed-tick scheduler
 * decoupled from rendering, and streams state to the main thread.
 */
import { World } from '../sim/world';
import { TICKS_PER_SECOND_1X } from '../sim/constants';
import { buildPadMap, packRGBA } from '../sim/planet/regiontex';
import type { CivData, EcologyData, EntitySnapshot, FrameData, LakeData, MainToWorker, RegionTextures, RiverData, SpeciesInfo, StaticWorldData, WorkerToMain } from './protocol';
import { HISTORY_INTERVAL, HISTORY_LEN } from '../sim/ecology/animals';
import { inspect } from './inspect';
import { saveWorld, loadWorld } from '../sim/serialize';
import { startScenario } from '../sim/scenarios';
import { BUILDINGS } from '../sim/civ/defs';
const BUILDING_COSTS = BUILDINGS.map((b) => b.cost);

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
const sparePeople: EntitySnapshot[] = [];
let lastPeopleTick = -1;
let lastCivVersion = -1;
let lastHeightSend = 0;
let lastWaterVersion = -1;
let lastCivProgress = -1;
let lastCivTime = 0;
let lastTexTime = 0;
let texDirty = true;
let lastSnapTick = -1;
let lastStatsTime = 0;
let speciesCount = 0;

function makeTextures(n: number): RegionTextures {
  const size = (n + 2) * (n + 2) * 6 * 4;
  return { climate: new Uint8Array(size), vegA: new Uint8Array(size), vegB: new Uint8Array(size), surface: new Uint8Array(size), fx: new Uint8Array(size), owner: new Uint8Array(size) };
}

function makeSnapshot(cap: number, kind: 'animals' | 'people'): EntitySnapshot {
  return { kind, tick: 0, count: 0, pos: new Float32Array(cap * 3), info: new Uint32Array(cap * 2) };
}

function fillTextures(w: World, t: RegionTextures): void {
  const pm = padMap!;
  const cl = w.planet.climate;
  const pd = w.plants.density;
  packRGBA(pm, t.climate, (c) => (cl.temp[c] + 40) / 80, (c) => cl.meanRain[c] / 4, (c) => cl.snow[c], (c) => cl.cloud[c]);
  packRGBA(pm, t.vegA, (c) => pd[c * 8], (c) => pd[c * 8 + 1], (c) => pd[c * 8 + 2], (c) => pd[c * 8 + 3]);
  packRGBA(pm, t.vegB, (c) => pd[c * 8 + 4], (c) => pd[c * 8 + 5], (c) => pd[c * 8 + 6], (c) => pd[c * 8 + 7]);
  const civ = w.civ;
  const dev = (c: number) => {
    const o = civ.owner[c];
    if (o < 0) return 0;
    const st = civ.settlements[o];
    if (!st.alive) return 0;
    // Development falls off from the settlement centre.
    const g = w.planet.region;
    const d = Math.acos(Math.min(1, st.x * g.centers[c * 3] + st.y * g.centers[c * 3 + 1] + st.z * g.centers[c * 3 + 2])) * 1000;
    return Math.max(0, 1 - d / (st.radius + 34)) * Math.min(1, 0.4 + st.pop / 100);
  };
  const lava = w.divine.lava, flood = w.divine.flood;
  packRGBA(pm, t.surface, (c) => w.fires.scar[c], (c) => cl.ash[c], (c) => Math.min(1, lava[c] * 0.8), dev);
  packRGBA(pm, t.owner, (c) => (civ.owner[c] >= 0 && civ.settlements[civ.owner[c]].alive ? (civ.settlements[civ.owner[c]].tribe + 1) / 255 : 0), (c) => (civ.owner[c] >= 0 ? civ.settlements[civ.owner[c]].tier / 255 : 0), () => 0, () => 0);
  packRGBA(pm, t.fx, (c) => cl.rain[c] * 2, (c) => fogAt(w, c), (c) => w.fires.intensity[c], (c) => Math.min(1, flood[c] / 4));
}

/** Fog: saturated, calm air near dawn-cool surfaces. */
function fogAt(w: World, c: number): number {
  const cl = w.planet.climate;
  const sat = 3.8 * Math.exp(0.0687 * Math.max(-45, Math.min(45, cl.temp[c])));
  const rh = cl.humid[c] / sat;
  const wind = Math.hypot(cl.windE[c], cl.windN[c]);
  return Math.max(0, (rh - 0.82) * 5) * Math.max(0, 1 - wind / 9);
}

function ecologyData(w: World): EcologyData {
  const a = w.animals;
  const n = a.defs.length;
  const history: number[][] = [];
  const count = a.historyCount;
  const step = Math.max(1, Math.ceil(count / 400));
  for (let sp = 0; sp < n; sp++) {
    const h: number[] = [];
    for (let k = count - 1 - Math.floor((count - 1) / step) * step; k < count; k += step) {
      const idx = (a.historyHead - count + k + HISTORY_LEN * 2) % HISTORY_LEN;
      h.push(a.history[idx * 64 + sp]);
    }
    history.push(h);
  }
  const deaths: number[][] = [];
  for (let sp = 0; sp < n; sp++) deaths.push(Array.from(a.deaths.subarray(sp * 8, sp * 8 + 8)));
  let cover = 0, land = 0;
  const pd = w.plants.density, terr = w.planet.terrain;
  for (let c = 0; c < terr.oceanFrac.length; c += 3) {
    if (terr.oceanFrac[c] > 0.5) continue;
    land++;
    let s2 = 0;
    for (let k = 0; k < 8; k++) s2 += pd[c * 8 + k];
    cover += Math.min(1, s2);
  }
  return {
    tick: w.tick,
    species: speciesInfo(w),
    alive: Array.from(a.pop.subarray(0, n)),
    history,
    interval: HISTORY_INTERVAL * step,
    records: a.records.map((r) => ({ tick: r.tick, kind: r.kind, name: r.name, parent: r.parent, where: r.where })),
    deaths,
    biomes: w.planet.climate.biome.slice(),
    regionN: w.planet.region.n,
    shannon: a.shannon(),
    plantCover: land ? cover / land : 0,
    people: w.civ.totalPeople(),
  };
}

function speciesInfo(w: World): SpeciesInfo[] {
  return w.animals.defs.map((d) => ({ id: d.id, name: d.name, plural: d.plural, body: d.body, diet: d.diet, size: d.size, colour: d.colour, colour2: d.colour2, parent: d.parent }));
}

function waterData(w: World): { rivers: RiverData; lakes: LakeData; transfer: Transferable[] } {
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
  return { rivers: { points, width, level, offsets }, lakes: { cells, levels }, transfer: [points.buffer, width.buffer, level.buffer, offsets.buffer, cells.buffer, levels.buffer] };
}

function sendHeights(w: World): void {
  const tf = w.terraform;
  const faces = [...tf.renderDirty].sort((a, b) => a - b);
  tf.renderDirty.clear();
  const fs = w.planet.hg.faceSize;
  const data = faces.map((f) => w.planet.heights.slice(f * fs, (f + 1) * fs));
  post({ type: 'heights', faces, data }, data.map((d) => d.buffer));
  lastHeightSend = performance.now();
  texDirty = true;
}

function sendWater(w: World): void {
  lastWaterVersion = w.planet.heightVersion;
  const wd = waterData(w);
  post({ type: 'water', rivers: wd.rivers, lakes: wd.lakes }, wd.transfer);
}

/** Begin streaming a (new or loaded) world to the main thread. */
function start(w: World, loaded: boolean): void {
  padMap = buildPadMap(w.planet.region);
  spareTextures.length = 0;
  spareTextures.push(makeTextures(w.planet.region.n), makeTextures(w.planet.region.n));
  spareSnaps.length = 0;
  for (let i = 0; i < 3; i++) spareSnaps.push(makeSnapshot(w.animals.cap, 'animals'));
  sparePeople.length = 0;
  for (let i = 0; i < 3; i++) sparePeople.push(makeSnapshot(w.civ.people.cap, 'people'));
  lastCivVersion = -1;
  lastSnapTick = -1;
  lastPeopleTick = -1;
  speciesCount = w.animals.defs.length;
  lastWaterVersion = w.planet.heightVersion;
  const { data, transfer } = staticData(w);
  if (loaded) data.history = w.events.history.slice(-3000);
  post({ type: 'ready', data }, transfer);
  texDirty = true;
  sendTextures();
}

function staticData(w: World): { data: StaticWorldData; transfer: Transferable[] } {
  const p = w.planet;
  const wd = waterData(w);
  const heights = p.heights.slice();
  const data: StaticWorldData = {
    seed: w.seed,
    preset: w.preset,
    heightN: p.hg.n,
    regionN: p.region.n,
    hydroN: p.hydroGrid.n,
    heights,
    rivers: wd.rivers,
    lakes: wd.lakes,
    species: speciesInfo(w),
  };
  return { data, transfer: [heights.buffer, ...wd.transfer] };
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

function fillPeople(w: World, s: EntitySnapshot): void {
  const P = w.civ.people;
  let n = 0;
  for (let i = 0; i < P.count; i++) {
    if (!P.alive[i]) continue;
    s.pos[n * 3] = P.x[i];
    s.pos[n * 3 + 1] = P.y[i];
    s.pos[n * 3 + 2] = P.z[i];
    const age = P.age[i] < 13 ? 0 : P.age[i] < 60 ? 1 : 2;
    const packed = (P.state[i] & 31) | ((P.job[i] & 15) << 5) | (((P.carryRes[i] + 1) & 7) << 9) | ((P.tribe[i] & 63) << 12) | (age << 18) | ((P.role[i] & 7) << 20) | ((P.sex[i] & 1) << 23) | ((P.vessel[i] & 1) << 24) | ((P.sick[i] > 0 ? 1 : 0) << 25) | ((P.returned[i] > w.tick ? 1 : 0) << 26);
    s.info[n * 2] = P.uid[i];
    s.info[n * 2 + 1] = packed >>> 0;
    n++;
  }
  s.count = n;
  s.tick = w.tick;
}

function civData(w: World): CivData {
  const civ = w.civ;
  civ.census();
  const roads = new Float32Array(civ.roads.length * 7);
  civ.roads.forEach((r, k) => roads.set([r.ax, r.ay, r.az, r.bx, r.by, r.bz, r.level], k * 7));
  return {
    version: civ.version,
    buildings: civ.buildings.filter((b) => !b.gone).map((b) => ({ id: b.id, type: b.type, x: b.x, y: b.y, z: b.z, rot: b.rot, progress: b.complete ? 1 : b.progress * 0.8 + (b.delivered[1] + b.delivered[2] + b.delivered[3]) / Math.max(1, sumCost(b.type)) * 0.2, complete: b.complete, ruin: b.ruin, age: b.age, style: b.style, tribe: b.tribe, settle: b.settle, growth: b.growth })),
    roads,
    settlements: civ.settlements.map((s) => ({ id: s.id, name: s.name, tribe: s.tribe, x: s.x, y: s.y, z: s.z, tier: s.tier, pop: s.pop, alive: s.alive, radius: s.radius, stock: s.stock.map((v) => Math.round(v)), walls: s.walls })),
    tribes: civ.tribes.map((t) => ({
      id: t.id, name: t.name, adjective: t.adjective, color: t.color, color2: t.color2, flag: t.flag, alive: t.alive, age: t.age,
      population: t.population, religion: t.religion.name, deity: t.religion.deity, capital: t.capital, techCount: t.known.reduce((a, b) => a + b, 0),
    })),
  };
}

function sumCost(type: number): number {
  const c = BUILDING_COSTS[type];
  return c[1] + c[2] + c[3];
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
  let people: EntitySnapshot | null = null;
  if (w.tick !== lastPeopleTick && sparePeople.length > 0) {
    people = sparePeople.pop()!;
    fillPeople(w, people);
    transfer.push(people.pos.buffer, people.info.buffer);
    lastPeopleTick = w.tick;
  }
  // Buildings/roads/settlements when they change (and construction progress periodically).
  let progressSum = 0;
  for (const b of w.civ.buildings) if (!b.complete) progressSum += b.progress + b.delivered[1] + b.delivered[2];
  if (w.civ.version !== lastCivVersion || (progressSum !== lastCivProgress && now - lastCivTime > 400)) {
    lastCivVersion = w.civ.version;
    lastCivProgress = progressSum;
    lastCivTime = now;
    const civ = civData(w);
    post({ type: 'civ', civ }, [civ.roads.buffer]);
  }
  const strikes = w.weather.strikeLog.splice(0);
  const dv = w.divine;
  const frame: FrameData = {
    header: { tick: w.tick, tps, simMs: simMsAvg, speed, paused },
    effects: dv.effects.map((e) => ({ id: e.id, power: e.power, x: e.x, y: e.y, z: e.z, radius: e.radius, start: e.start, end: e.end, phase: e.phase, combo: e.combo, dx: e.dx, dy: e.dy, dz: e.dz })),
    cooldowns: dv.cooldowns(w.tick),
    boundless: dv.boundless,
    chill: -w.planet.climate.forcing.transientOffset,
    scenario: w.scenario ? { id: w.scenario.id, status: w.scenario.status, progress: w.scenario.progress, detail: w.scenario.detail, outcome: w.scenario.outcome } : null,
    storms: w.weather.storms.map((s) => ({ id: s.id, type: s.type, name: s.name, x: s.x, y: s.y, z: s.z, radius: s.radius, intensity: s.intensity })),
    strikes,
    events: w.events.drain(),
    animals,
    people,
    stats,
    devotion: w.civ.devotion,
    devotionRate: w.civ.devotionRate,
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
    // Spend most of each ~32 ms slice simulating; frames and textures are cheap.
    const deadline = now + 29;
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
    if (world.terraform.renderDirty.size > 0 && now - lastHeightSend > 90) sendHeights(world);
    if (world.planet.heightVersion !== lastWaterVersion && world.terraform.renderDirty.size === 0) sendWater(world);
    sendFrame(now);
    if (texDirty && spareTextures.length > 0 && now - lastTexTime > 200) sendTextures();
  }
  setTimeout(loop, 2);
}

function sendTextures(): void {
  if (!world) return;
  const t = spareTextures.pop()!;
  fillTextures(world, t);
  lastTexTime = performance.now();
  texDirty = false;
  post({ type: 'textures', tex: t, tick: world.tick }, [t.climate.buffer, t.vegA.buffer, t.vegB.buffer, t.surface.buffer, t.fx.buffer, t.owner.buffer]);
}

ctx.onmessage = (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': {
        world = new World({ seed: msg.seed, preset: msg.preset }, (stage, frac) => post({ type: 'progress', stage, frac }));
        if (msg.scenario) startScenario(world, msg.scenario);
        if (msg.boundless) world.divine.boundless = true;
        start(world, false);
        break;
      }
      case 'save': {
        if (!world) break;
        const w = world;
        void saveWorld(w, msg.name).then((data) => {
          post({ type: 'saved', id: msg.id, data, meta: { seed: w.seed, preset: w.preset, tick: w.tick, name: msg.name, people: w.civ.totalPeople(), when: Date.now() } }, [data.buffer]);
        }).catch((err) => post({ type: 'saved', id: msg.id, data: null, error: String(err instanceof Error ? err.message : err) }));
        break;
      }
      case 'load': {
        post({ type: 'progress', stage: 'Awakening the world', frac: 0.3 });
        void loadWorld(msg.data).then((w) => {
          world = w;
          post({ type: 'progress', stage: 'Awakening the world', frac: 0.9 });
          start(w, true);
        }).catch((err) => post({ type: 'error', message: `Could not load this world: ${err instanceof Error ? err.message : err}` }));
        break;
      }
      case 'speed':
        speed = msg.speed;
        paused = msg.paused;
        break;
      case 'advance': {
        stepWorld(msg.ticks);
        // Flush a frame first so the main thread has fresh entities/civ state
        // by the time the advance promise resolves.
        lastCivTime = 0;
        sendFrame(performance.now());
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
      case 'command': {
        if (!world) break;
        const r = world.command(msg.cmd);
        post({ type: 'commandResult', id: msg.id, ok: r.ok, message: r.message, combo: r.combo });
        texDirty = true;
        if (msg.cmd.kind === 'power') sendFrame(performance.now());
        break;
      }
      case 'inspect':
        post({ type: 'inspect', id: msg.id, info: world ? inspect(world, msg.target) : null });
        break;
      case 'ecology':
        if (world) {
          const data = ecologyData(world);
          post({ type: 'ecology', id: msg.id, data }, [data.biomes.buffer]);
        }
        break;
      case 'returnSnapshot':
        if (msg.snap.kind === 'people') sparePeople.push(msg.snap);
        else spareSnaps.push(msg.snap);
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};

// Tests drive the message handler directly without the scheduler.
if (!(globalThis as { __genesisNoLoop?: boolean }).__genesisNoLoop) loop();
