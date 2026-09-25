/**
 * Main-thread handle to the simulation worker.
 */
import type { CivData, Command, EcologyData, SaveInfo, EntitySnapshot, FrameData, FrameHeader, InspectInfo, InspectTarget, LakeData, MainToWorker, RegionTextures, RiverData, SpeciesInfo, StaticWorldData, WorkerToMain, WorldStats } from './protocol';

export interface CommandResult { ok: boolean; message: string; combo?: string }
import type { WorldPresetId } from '../sim/planet/presets';
import type { GameEvent } from '../sim/events';

export class SimClient {
  readonly worker: Worker;
  header: FrameHeader = { tick: 0, tps: 0, simMs: 0, speed: 1, paused: true };
  headerTime = 0;
  latest: FrameData | null = null;
  stats: WorldStats | null = null;
  species: SpeciesInfo[] = [];
  onProgress: (stage: string, frac: number) => void = () => {};
  onReady: (data: StaticWorldData) => void = () => {};
  onTextures: (tex: RegionTextures, tick: number) => void = () => {};
  onEvents: (events: GameEvent[]) => void = () => {};
  onFrame: (frame: FrameData) => void = () => {};
  /** Called with a new animal snapshot; must return a snapshot to recycle (or null). */
  onAnimals: (snap: EntitySnapshot) => EntitySnapshot | null = (s) => s;
  onPeople: (snap: EntitySnapshot) => EntitySnapshot | null = (s) => s;
  onCiv: (civ: CivData) => void = () => {};
  civ: CivData | null = null;
  onError: (msg: string) => void = () => {};
  onHeights: (faces: number[], data: Float32Array[]) => void = () => {};
  onWater: (rivers: RiverData, lakes: LakeData) => void = () => {};
  private nextId = 1;
  private pending = new Map<number, (v: number) => void>();
  private pendingCmd = new Map<number, (r: CommandResult) => void>();
  private pendingInspect = new Map<number, (r: InspectInfo | null) => void>();
  private pendingEco = new Map<number, (r: EcologyData) => void>();
  private pendingSave = new Map<number, { res: (r: { data: Uint8Array; meta: SaveInfo }) => void; rej: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => this.handle(e.data);
    this.worker.onerror = (e) => this.onError(e.message || 'Worker error');
  }

  private handle(msg: WorkerToMain): void {
    switch (msg.type) {
      case 'progress': this.onProgress(msg.stage, msg.frac); break;
      case 'ready':
        this.species = msg.data.species;
        this.onReady(msg.data);
        break;
      case 'frame': {
        const f = msg.frame;
        this.header = f.header;
        this.headerTime = performance.now();
        this.latest = f;
        if (f.stats) this.stats = f.stats;
        if (f.events.length) this.onEvents(f.events);
        if (f.animals) {
          const recycle = this.onAnimals(f.animals);
          if (recycle) this.send({ type: 'returnSnapshot', snap: recycle }, [recycle.pos.buffer, recycle.info.buffer]);
        }
        if (f.people) {
          const recycle = this.onPeople(f.people);
          if (recycle) this.send({ type: 'returnSnapshot', snap: recycle }, [recycle.pos.buffer, recycle.info.buffer]);
        }
        this.onFrame(f);
        break;
      }
      case 'species': this.species = msg.species; break;
      case 'civ': this.civ = msg.civ; this.onCiv(msg.civ); break;
      case 'textures':
        this.onTextures(msg.tex, msg.tick);
        this.send({ type: 'returnTextures', tex: msg.tex }, [msg.tex.climate.buffer, msg.tex.vegA.buffer, msg.tex.vegB.buffer, msg.tex.surface.buffer, msg.tex.fx.buffer, msg.tex.owner.buffer]);
        break;
      case 'advanced': this.resolve(msg.id, msg.tick); break;
      case 'hash': this.resolve(msg.id, msg.hash); break;
      case 'error': this.onError(msg.message); break;
      case 'commandResult': {
        const r = this.pendingCmd.get(msg.id);
        if (r) { this.pendingCmd.delete(msg.id); r({ ok: msg.ok, message: msg.message, combo: msg.combo }); }
        break;
      }
      case 'inspect': {
        const r = this.pendingInspect.get(msg.id);
        if (r) { this.pendingInspect.delete(msg.id); r(msg.info); }
        break;
      }
      case 'ecology': {
        const r = this.pendingEco.get(msg.id);
        if (r) { this.pendingEco.delete(msg.id); r(msg.data); }
        break;
      }
      case 'saved': {
        const r = this.pendingSave.get(msg.id);
        if (!r) break;
        this.pendingSave.delete(msg.id);
        if (msg.data && msg.meta) r.res({ data: msg.data, meta: msg.meta });
        else r.rej(new Error(msg.error ?? 'Save failed'));
        break;
      }
      case 'heights': this.onHeights(msg.faces, msg.data); break;
      case 'water': this.onWater(msg.rivers, msg.lakes); break;
    }
  }

  private resolve(id: number, v: number): void {
    const r = this.pending.get(id);
    if (r) { this.pending.delete(id); r(v); }
  }

  send(msg: MainToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  init(seed: number, preset: WorldPresetId, scenario?: string, boundless?: boolean): void {
    this.send({ type: 'init', seed, preset, scenario, boundless });
  }

  setSpeed(speed: number, paused: boolean): void {
    this.header.speed = speed;
    this.header.paused = paused;
    this.send({ type: 'speed', speed, paused });
  }

  advance(ticks: number): Promise<number> {
    const id = this.nextId++;
    return new Promise((res) => { this.pending.set(id, res); this.send({ type: 'advance', ticks, id }); });
  }

  command(cmd: Command): Promise<CommandResult> {
    const id = this.nextId++;
    return new Promise((res) => { this.pendingCmd.set(id, res); this.send({ type: 'command', cmd, id }); });
  }

  inspect(target: InspectTarget): Promise<InspectInfo | null> {
    const id = this.nextId++;
    return new Promise((res) => { this.pendingInspect.set(id, res); this.send({ type: 'inspect', target, id }); });
  }

  save(name: string): Promise<{ data: Uint8Array; meta: SaveInfo }> {
    const id = this.nextId++;
    return new Promise((res, rej) => { this.pendingSave.set(id, { res, rej }); this.send({ type: 'save', id, name }); });
  }

  load(data: Uint8Array): void {
    this.send({ type: 'load', data }, [data.buffer]);
  }

  ecology(): Promise<EcologyData> {
    const id = this.nextId++;
    return new Promise((res) => { this.pendingEco.set(id, res); this.send({ type: 'ecology', id }); });
  }

  hash(): Promise<number> {
    const id = this.nextId++;
    return new Promise((res) => { this.pending.set(id, res); this.send({ type: 'hash', id }); });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
