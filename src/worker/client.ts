/**
 * Main-thread handle to the simulation worker.
 */
import type { EntitySnapshot, FrameData, FrameHeader, MainToWorker, RegionTextures, SpeciesInfo, StaticWorldData, WorkerToMain, WorldStats } from './protocol';
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
  onError: (msg: string) => void = () => {};
  private nextId = 1;
  private pending = new Map<number, (v: number) => void>();

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
        this.onFrame(f);
        break;
      }
      case 'species': this.species = msg.species; break;
      case 'textures':
        this.onTextures(msg.tex, msg.tick);
        this.send({ type: 'returnTextures', tex: msg.tex }, [msg.tex.climate.buffer, msg.tex.vegA.buffer, msg.tex.vegB.buffer, msg.tex.surface.buffer, msg.tex.fx.buffer]);
        break;
      case 'advanced': this.resolve(msg.id, msg.tick); break;
      case 'hash': this.resolve(msg.id, msg.hash); break;
      case 'error': this.onError(msg.message); break;
    }
  }

  private resolve(id: number, v: number): void {
    const r = this.pending.get(id);
    if (r) { this.pending.delete(id); r(v); }
  }

  send(msg: MainToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  init(seed: number, preset: WorldPresetId): void {
    this.send({ type: 'init', seed, preset });
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

  hash(): Promise<number> {
    const id = this.nextId++;
    return new Promise((res) => { this.pending.set(id, res); this.send({ type: 'hash', id }); });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
