/**
 * Entry point: boots the renderer and simulation worker, shows the loading
 * screen, and exposes the automation harness used by `npm run shots`.
 */
import './ui/styles.css';
import { GameRenderer } from './render/renderer';
import { SimClient } from './worker/client';
import { applyViewpoint, computeViewpoint, type ViewpointId } from './render/viewpoints';
import { TICKS_PER_SECOND_1X } from './sim/constants';
import type { WorldPresetId } from './sim/planet/presets';
import { LoadingScreen } from './ui/loading';
import { gpuGroundHeights } from './render/gpuCheck';
import { groundHeight, snoiseA } from './render/groundHeight';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 20260925) >>> 0;
const preset = (params.get('preset') ?? 'earthlike') as WorldPresetId;

const renderer = new GameRenderer(canvas);
if (params.get('quality')) renderer.setQuality(params.get('quality') as 'low' | 'medium' | 'high' | 'ultra');
const sim = new SimClient();
const loading = new LoadingScreen(uiRoot);

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let readyResolve: () => void = () => {};
const readyPromise = new Promise<void>((r) => (readyResolve = r));

sim.onProgress = (stage, frac) => loading.setStage(stage, frac);
sim.onError = (m) => { console.error(m); loading.setError(m); };
sim.onReady = (data) => {
  loading.setStage('Lighting the sky', 0.95);
  renderer.init(data);
  resize();
  if (sim.civ) sim.onCiv(sim.civ);
  loading.done();
  readyResolve();
  sim.setSpeed(1, params.get('harness') === '1');
};
sim.onTextures = (tex) => {
  if (renderer.ready) renderer.data.updateRegion(tex);
};
sim.onAnimals = (snap) => (renderer.ready ? renderer.creatures.pushSnapshot(snap) : snap);
sim.onPeople = (snap) => (renderer.ready ? renderer.people.pushSnapshot(snap) : snap);
sim.onCiv = (civ) => {
  if (!renderer.ready) return;
  renderer.buildings.sync(civ, renderer.data);
  renderer.people.tribes = civ.tribes;
};
sim.onFrame = (f) => {
  if (!renderer.ready) return;
  renderer.setStorms(f.storms);
  if (renderer.creatures.species.length !== sim.species.length) renderer.creatures.species = sim.species;
};
sim.init(seed, preset);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (renderer.ready) {
    const h = sim.header;
    const rate = h.paused ? 0 : TICKS_PER_SECOND_1X * h.speed;
    const est = h.tick + Math.min(1, ((now - sim.headerTime) / 1000) * rate);
    renderer.renderTick += (est - renderer.renderTick) * Math.min(1, dt * 10);
    if (Math.abs(est - renderer.renderTick) > 50) renderer.renderTick = est;
    renderer.render(dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- harness
interface Harness {
  ready: Promise<void>;
  view(id: ViewpointId): void;
  advance(ticks: number): Promise<number>;
  setTime(t: number): void;
  renderFrames(n: number): Promise<void>;
  stats(): unknown;
  hash(): Promise<number>;
  groundCheck(): { maxErrGround: number; maxErrNoise: number; maxErrBilinear: number; samples: number };
}
const harness: Harness = {
  ready: readyPromise,
  view(id) {
    applyViewpoint(renderer, computeViewpoint(renderer, id));
  },
  async advance(ticks) {
    const t = await sim.advance(ticks);
    renderer.renderTick = t;
    return t;
  },
  setTime(t) {
    renderer.time = t;
  },
  async renderFrames(n) {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
  },
  stats() {
    return { ...renderer.stats, tick: sim.header.tick };
  },
  hash: () => sim.hash(),
  groundCheck() {
    const n = 256;
    const dirs = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), t = i * 2.399963;
      dirs[i * 3] = Math.cos(t) * r; dirs[i * 3 + 1] = y; dirs[i * 3 + 2] = Math.sin(t) * r;
    }
    const gpu = gpuGroundHeights(renderer.renderer, renderer.shared, dirs);
    let maxErrGround = 0, maxErrNoise = 0, maxErrBilinear = 0;
    const d = renderer.data;
    for (let i = 0; i < n; i++) {
      const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
      const l = Math.hypot(x, y, z);
      maxErrGround = Math.max(maxErrGround, Math.abs(gpu[i * 4] - groundHeight(d.heights, d.n, x / l, y / l, z / l)));
      maxErrBilinear = Math.max(maxErrBilinear, Math.abs(gpu[i * 4 + 1] - d.heightAt(x / l, y / l, z / l)));
      maxErrNoise = Math.max(maxErrNoise, Math.abs(gpu[i * 4 + 2] - snoiseA(x / l * 37, y / l * 37, z / l * 37)));
    }
    return { maxErrGround, maxErrNoise, maxErrBilinear, samples: n };
  },
};
(window as unknown as { __genesis: Harness }).__genesis = harness;
