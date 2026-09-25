/**
 * Entry point: boots the renderer and simulation worker, shows the loading
 * screen, and exposes the automation harness used by `npm run shots`.
 */
import './ui/styles.css';
import './ui/hud.css';
import * as THREE from 'three';
import { Game } from './game';
import { InputController } from './ui/input';
import { worldName } from './core/worldname';
import { SaveSystem, takePending } from './saves';
import { GameRenderer } from './render/renderer';
import { SimClient } from './worker/client';
import { applyViewpoint, computeViewpoint, type ViewpointId } from './render/viewpoints';
import { TICKS_PER_SECOND_1X } from './sim/constants';
import type { WorldPresetId } from './sim/planet/presets';
import { LoadingScreen } from './ui/loading';
import { gpuGroundHeights } from './render/gpuCheck';
import { groundHeight, snoiseA } from './render/groundHeight';
import { TitleScreen, ObjectiveTracker, endCard, Tutorial } from './ui/title';
import { scenarioDef } from './sim/scenarios';
import { saveSettings } from './ui/panels';
import { TICKS_PER_YEAR } from './sim/constants';
import { AudioEngine } from './audio/audio';
import { detectQuality } from './render/quality';
import { dirToFaceAB } from './sim/planet/cubesphere';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;
const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') ? scenarioDef(params.get('scenario')!) : undefined;
const seed = scenario ? scenario.seed : Number(params.get('seed') ?? 20260925) >>> 0;
const preset = scenario ? scenario.preset : ((params.get('preset') ?? 'earthlike') as WorldPresetId);
const resuming = params.get('resume') === '1';

const renderer = new GameRenderer(canvas);
if (params.get('quality')) renderer.setQuality(params.get('quality') as 'low' | 'medium' | 'high' | 'ultra');
else {
  // Settings choice, or a guess from the GPU (the governor refines it).
  const q = (() => { try { return JSON.parse(localStorage.getItem('genesis.settings') ?? '{}').quality as string | undefined; } catch { return undefined; } })();
  renderer.setQuality(q && q !== 'auto' ? (q as 'low' | 'medium' | 'high' | 'ultra') : detectQuality(renderer.renderer.getContext()));
}
const sim = new SimClient();
const loading = new LoadingScreen(uiRoot);
const game = new Game(renderer, sim, uiRoot);
new InputController(game, canvas);
const harnessMode = params.get('harness') === '1';
const audio = new AudioEngine();
const wakeAudio = () => { if (!harnessMode) audio.start(); applyAudioSettings(); };
window.addEventListener('pointerdown', wakeAudio);
window.addEventListener('keydown', wakeAudio);
function applyAudioSettings(): void {
  const st = game.settings;
  audio.setVolumes({ master: st.master, music: st.music, sfx: st.sfx, ui: st.ui });
}
game.onUi = (k) => audio.uiSound(k);
game.onSettings = () => applyAudioSettings();
game.onCast = (p, at, ok) => { if (ok) audio.effect(p === 'meteor' ? 'meteor-fall' : p, at); else audio.uiSound('error'); };
game.onEvent = (e) => {
  const map: Record<string, string> = { meteor: 'meteor', quake: 'earthquake', eruption: 'volcano', tsunami: 'tsunami', war: 'war', 'holy-war': 'war', battle: 'battle', siege: 'battle', peace: 'peace', age: 'age', extinction: 'extinction', miracle: 'blessing', 'ice-age': 'iceage' };
  const k = map[e.kind];
  if (!k) return;
  const pos = e.x || e.y || e.z ? new THREE.Vector3(e.x, e.y, e.z).multiplyScalar(1000) : null;
  audio.effect(k, pos);
};
renderer.vfx.onBolt = (p, power) => audio.thunder(p, power, renderer.camera.camera.position);
const skipTitle = harnessMode || params.get('play') === '1' || !!scenario || resuming;
let objective: ObjectiveTracker | null = null;

function navigate(q: Record<string, string>): void {
  const url = new URL(location.href);
  url.search = '';
  if (params.get('quality')) url.searchParams.set('quality', params.get('quality')!);
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
  location.href = url.toString();
}

/** Leave the title: descend toward the people and hand over control. */
function beginPlay(): void {
  document.body.classList.remove('hud-hidden', 'title-mode');
  game.titleMode = false;
  game.enabled = true;
  const cam = renderer.camera;
  const s = game.civ?.settlements.filter((q) => q.alive).sort((a, b) => b.pop - a.pop)[0];
  if (s) cam.flyTo({ focus: new THREE.Vector3(s.x, s.y, s.z), distance: 620, heading: 0.4, tiltOffset: 0.08 }, 4.5);
  game.setSpeed(1);
  game.banner.show(game.worldName, scenario ? scenario.tagline : 'A world waits for its god', 5000);
  if (game.settings.tutorial && !scenario) {
    let moved = false, selected = false, cast = '', speedChanged = false;
    const d0 = cam.target.distance;
    const tut = new Tutorial(uiRoot, {
      cameraMoved: () => moved || (moved = Math.abs(cam.target.distance - d0) > 60 || cam.isFlying === false && game.pointerX !== 0),
      selected: () => selected || (selected = game.selection !== null),
      castPower: (id) => cast === id,
      speedChanged: () => speedChanged || (speedChanged = game.paused || game.speed !== 1),
    });
    const prevCast = game.onCast;
    game.onCast = (p, at, ok) => { if (ok) cast = p; prevCast(p, at, ok); };
    game.tutorial = tut;
    tut.onFinish = () => { game.settings.tutorial = false; saveSettings(game.settings); game.tutorial = null; };
  }
}

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
  game.worldName = worldName(data.seed);
  game.buildUi();
  if (data.history) for (const e of data.history) game.chronicle.add(e);
  if (sim.civ) sim.onCiv(sim.civ);
  loading.done();
  readyResolve();
  game.paused = harnessMode;
  sim.setSpeed(1, harnessMode);
  if (skipTitle) {
    game.enabled = true;
    if (!harnessMode) {
      game.banner.show(game.worldName, scenario ? scenario.tagline : resuming ? 'The world remembers' : 'A world waits for its god', 5000);
      if (scenario) setTimeout(() => game.focusPeople(), 400);
    }
  } else {
    // Title over the slowly turning live planet.
    document.body.classList.add('hud-hidden', 'title-mode');
    game.titleMode = true;
    renderer.camera.cutTo({ distance: 3000, heading: 0, tiltOffset: 0.05 });
    const title = new TitleScreen(uiRoot, {
      onBegin: () => { title.hide(); beginPlay(); },
      onNewWorld: (sd, pr) => navigate({ seed: String(sd), preset: pr, play: '1' }),
      onScenario: (id) => navigate({ scenario: id }),
      onLoad: () => game.menu('saves'),
      onSettings: () => game.menu('settings'),
      onHelp: () => game.menu('help'),
    }, game.worldName, seed, preset);
  }
};
sim.onHeights = (faces, data) => renderer.updateHeights(faces, data);
sim.onWater = (rivers, lakes) => renderer.updateWater(rivers, lakes);
sim.onEvents = (events) => { if (renderer.ready && game.enabled) game.handleEvents(events); };
sim.onTextures = (tex) => {
  if (renderer.ready) renderer.data.updateRegion(tex);
};
sim.onAnimals = (snap) => (renderer.ready ? renderer.creatures.pushSnapshot(snap) : snap);
sim.onPeople = (snap) => (renderer.ready ? renderer.people.pushSnapshot(snap) : snap);
sim.onCiv = (civ) => {
  if (!renderer.ready) return;
  renderer.buildings.sync(civ, renderer.data);
  renderer.setTribes(civ.tribes);
  game.onCiv(civ);
};
sim.onFrame = (f) => {
  if (!renderer.ready) return;
  renderer.effects = f.effects;
  renderer.simSpeed = f.header.paused ? 0 : f.header.speed;
  // Divine rain clouds join the weather systems in the cloud shader.
  const storms = f.storms.concat(f.effects.filter((e) => e.power === 'rain' && e.end > f.header.tick).map((e) => ({ id: -e.id, type: 0, name: '', x: e.x, y: e.y, z: e.z, radius: (e.radius * 1.3) / 1000, intensity: 1.1 })));
  renderer.setStorms(storms);
  const cam = renderer.camera.camera.position;
  for (const st of f.strikes) {
    const p = new THREE.Vector3(st.x, st.y, st.z).multiplyScalar(1000);
    if (p.distanceTo(cam) < 1600) renderer.vfx.bolt(p, st.power, renderer.data);
  }
  game.onFrame(f);
  if (f.scenario) {
    if (!objective) {
      const def = scenarioDef(f.scenario.id);
      objective = new ObjectiveTracker(uiRoot, def?.name ?? f.scenario.id, def?.objective ?? '');
      objective.onEnd = (won, outcome) => {
        if (harnessMode) return;
        game.setSpeed(1);
        if (!game.paused) game.togglePause();
        const people = game.civ ? game.civ.tribes.reduce((a, t) => a + (t.alive ? t.population : 0), 0) : 0;
        endCard(uiRoot, won, def?.name ?? '', outcome, `Year ${Math.floor(f.header.tick / TICKS_PER_YEAR) + 1} · ${people} people · ${game.chronicle.events.length} events remembered`,
          () => { if (game.paused) game.togglePause(); },
          () => navigate({}));
      };
    }
    objective.update(f.scenario);
  }
  if (renderer.creatures.species.length !== sim.species.length) renderer.creatures.species = sim.species;
};
game.saveSystem = new SaveSystem(sim, () => game.worldName, (msg) => { if (msg) game.hint.setSticky(msg); else game.hint.setSticky(''); });
if (params.get('resume') === '1') {
  loading.setStage('Awakening the world', 0.1);
  void takePending().then((data) => {
    const url = new URL(location.href);
    url.searchParams.delete('resume');
    history.replaceState(null, '', url.toString());
    if (data) sim.load(data);
    else sim.init(seed, preset);
  });
} else sim.init(seed, preset, scenario?.id, params.get('boundless') === '1');

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
    game.update(dt, now);
    renderer.render(dt);
    if (audio.ctx) audio.update(dt, audioView());
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** What the ears should hear from the current view. */
function audioView(): import('./audio/audio').AudioView {
  const cam = renderer.camera;
  const d = renderer.data;
  const focus = cam.current.focus;
  const f = dirToFaceAB(focus.x, focus.y, focus.z);
  const alt = cam.altitude;
  let ocean = 0;
  const r = Math.min(0.08, Math.max(0.01, alt / 1000));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const p = focus.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.5, Math.sin(a) * r)).normalize();
    if (d.heightAt(p.x, p.y, p.z) < 0) ocean++;
  }
  const sun = renderer.shared.uSunDir.value as THREE.Vector3;
  const trees = d.sampleRegion(d.vegACPU, f.face, f.a, f.b, 2) + d.sampleRegion(d.vegACPU, f.face, f.a, f.b, 3) + d.sampleRegion(d.vegBCPU, f.face, f.a, f.b, 0);
  return {
    camera: cam.camera,
    altitude: alt,
    oceanNear: ocean / 8,
    forestNear: Math.min(1, trees + d.sampleRegion(d.vegACPU, f.face, f.a, f.b, 0) * 0.3),
    settlementNear: d.sampleRegion(d.surfaceCPU, f.face, f.a, f.b, 3),
    fireNear: d.sampleRegion(d.fxCPU, f.face, f.a, f.b, 2),
    rain: renderer.precip.level,
    night: Math.max(0, Math.min(1, (0.1 - focus.dot(sun)) * 4)),
    storm: d.sampleRegion(d.climateCPU, f.face, f.a, f.b, 3),
    paused: game.paused,
  };
}

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
  command(cmd: import('./worker/protocol').Command): Promise<{ ok: boolean; message: string }>;
  hud(show: boolean): void;
  game: Game;
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
  command: (cmd) => sim.command(cmd),
  hud(show) { document.body.classList.toggle('hud-hidden', !show); },
  game,
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
