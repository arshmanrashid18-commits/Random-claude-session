/**
 * Game: the main-thread orchestrator. Owns the renderer, the simulation
 * client, the HUD and panels, input, audio, settings and saves, and turns
 * player intent into commands for the simulation worker.
 */
import * as THREE from 'three';
import type { GameRenderer } from './render/renderer';
import type { SimClient } from './worker/client';
import { Hud, PowerBar, Feed, Inspector, Hint, Banner, Tooltip, Wheel, PerfOverlay, el } from './ui/components';
import { ChroniclePanel, EcologyPanel, TribesPanel, SettingsPanel, HelpPanel, SavePanel, loadSettings, type Settings, type Modal } from './ui/panels';
import { KeyMap, keyLabel } from './ui/keys';
import { narrate } from './ui/narrate';
import { powerDef, type PowerId } from './sim/powers/defs';
import type { BrushTool } from './sim/planet/terraform';
import type { GameEvent } from './sim/events';
import type { InspectTarget, TribeData, CivData, FrameData } from './worker/protocol';
import { PLANET_RADIUS, TICKS_PER_DAY, TICKS_PER_SECOND_1X } from './sim/constants';
import { PlanetCamera, MIN_DISTANCE, MAX_DISTANCE } from './render/camera';
import { QualityGovernor, QUALITY_ORDER, type QualityId } from './render/quality';
import { dayFracForLocalTime } from './render/viewpoints';

const SPEEDS = [1, 10, 100];

export type Selection = InspectTarget | null;

export class Game {
  readonly renderer: GameRenderer;
  readonly sim: SimClient;
  readonly ui: HTMLElement;
  readonly keys: KeyMap;
  settings: Settings;
  hud!: Hud;
  powers!: PowerBar;
  feed!: Feed;
  inspector!: Inspector;
  hint!: Hint;
  banner!: Banner;
  wheel!: Wheel;
  perf!: PerfOverlay;
  chronicle!: ChroniclePanel;
  ecology!: EcologyPanel;
  tribesPanel!: TribesPanel;
  settingsPanel!: SettingsPanel;
  help!: HelpPanel;
  saves!: SavePanel;
  private modals: Modal[] = [];

  speed = 1;
  paused = false;
  timelapse = false;
  director = false;
  photo = false;
  hudHidden = false;
  selectedPower: PowerId | null = null;
  tool: BrushTool | null = null;
  brushRadius = 30;
  brushStrength = 0.5;
  brushPaint = 0;
  selection: Selection = null;
  following = false;
  worldName = '';
  tribes: TribeData[] = [];
  civ: CivData | null = null;
  lastFrame: FrameData | null = null;
  devotion = 0;
  devotionRate = 0;
  /** Cursor position on the planet surface (world units) or null. */
  hover: THREE.Vector3 | null = null;
  private held = new Set<string>();
  private inspectTimer = 0;
  private directorTimer = 0;
  private directorQueue: GameEvent[] = [];
  private governor = new QualityGovernor();
  private lapseHeading = 0;
  private strokeLevel: number | null = null;
  private lastDab = 0;
  enabled = false;
  /** Title screen: the camera drifts around the planet. */
  titleMode = false;
  private titleDrift = 0;
  tutorial: import('./ui/title').Tutorial | null = null;
  /** Hooks for audio and effects (set by the audio engine / VFX). */
  onCast: (p: PowerId, at: THREE.Vector3, ok: boolean) => void = () => {};
  onEvent: (e: GameEvent) => void = () => {};
  onUi: (kind: 'click' | 'hover' | 'open' | 'close' | 'error' | 'select') => void = () => {};

  constructor(renderer: GameRenderer, sim: SimClient, ui: HTMLElement) {
    this.renderer = renderer;
    this.sim = sim;
    this.ui = ui;
    this.settings = loadSettings();
    this.keys = new KeyMap(this.settings.keys);
  }

  /** Build the HUD once the world exists. */
  buildUi(): void {
    const ui = this.ui;
    new Tooltip(ui);
    this.hud = new Hud(ui, {
      onSpeed: (s, p) => { this.onUi('click'); if (p) this.togglePause(); else this.setSpeed(s); },
      onTimelapse: () => { this.onUi('click'); this.toggleTimelapse(); },
      onMenu: (id) => { this.onUi('click'); this.menu(id); },
    });
    this.powers = new PowerBar(ui, {
      onPower: (p) => { this.onUi('select'); this.selectPower(this.selectedPower === p ? null : p); },
      onTool: (t) => { this.onUi('select'); this.selectTool(t); },
      onToolOpts: (r, s, p) => { this.brushRadius = r; this.brushStrength = s; this.brushPaint = p; },
    }, (id) => this.keys.keyOf(id));
    this.feed = new Feed(ui);
    this.feed.onGoto = (e) => this.gotoEvent(e);
    this.inspector = new Inspector(ui, {
      onClose: () => this.select(null),
      onFollow: () => this.toggleFollow(),
      onFocus: () => this.focusSelection(),
      onOpen: (t) => this.select(t, true),
    });
    this.hint = new Hint(ui);
    this.banner = new Banner(ui);
    this.wheel = new Wheel(ui);
    this.perf = new PerfOverlay(ui);
    this.chronicle = new ChroniclePanel(ui);
    this.chronicle.onGoto = (e) => this.gotoEvent(e);
    this.ecology = new EcologyPanel(ui);
    this.ecology.request = () => this.sim.ecology();
    this.tribesPanel = new TribesPanel(ui);
    this.tribesPanel.onTribe = (id) => this.select({ kind: 'tribe', id }, true);
    this.settingsPanel = new SettingsPanel(ui, this.settings, this.keys);
    this.settingsPanel.onChange = (s) => this.applySettings(s);
    this.help = new HelpPanel(ui, this.keys);
    this.saves = new SavePanel(ui, {
      list: () => this.saveSystem.list(),
      save: (slot) => this.saveSystem.save(slot),
      load: (slot) => this.saveSystem.load(slot),
      remove: (slot) => this.saveSystem.remove(slot),
      exportFile: () => this.saveSystem.exportFile(),
      importFile: (f) => this.saveSystem.importFile(f),
    });
    this.modals = [this.chronicle, this.ecology, this.tribesPanel, this.settingsPanel, this.help, this.saves];
    for (const m of this.modals) m.onClose = () => this.onUi('close');
    this.applySettings(this.settings);
    this.hud.setWorldName(this.worldName);
    this.chronicle.worldName = this.worldName;
  }

  /** Save system hooks (installed by main). */
  saveSystem = {
    list: async () => [] as import('./ui/panels').SaveSlotInfo[],
    save: async (_slot: string) => {},
    load: async (_slot: string) => {},
    remove: async (_slot: string) => {},
    exportFile: async () => {},
    importFile: async (_f: File) => {},
  };

  onSettings: (s: Settings) => void = () => {};

  applySettings(s: Settings): void {
    this.onSettings(s);
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
    this.renderer.camera.reducedMotion = s.reducedMotion;
    this.renderer.post.final.uniforms.uColorblind.value = s.colorblind;
    this.renderer.shared.uBorders.value = s.borders ? 0.35 : 0;
    if (s.quality === 'auto') this.governor.enabled = true;
    else { this.governor.enabled = false; if (this.renderer.quality !== undefined) this.renderer.setQuality(s.quality); }
    this.feed.el.style.display = s.feed ? '' : 'none';
  }

  // ------------------------------------------------------------------ time
  setSpeed(s: number): void {
    this.speed = s;
    this.paused = false;
    this.sim.setSpeed(s, false);
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.sim.setSpeed(this.speed, this.paused);
  }

  stepSpeed(dir: number): void {
    const i = SPEEDS.indexOf(this.speed);
    const j = Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + dir));
    this.setSpeed(SPEEDS[j]);
  }

  toggleTimelapse(): void {
    this.timelapse = !this.timelapse;
    if (this.timelapse) {
      this.setSpeed(100);
      const cam = this.renderer.camera;
      cam.flyTo({ distance: Math.max(cam.target.distance, 1900), tiltOffset: 0.1 }, 3);
      this.lapseHeading = cam.target.heading;
      this.hint.flash(`Time-lapse — <kbd>${keyLabel(this.keys.keyOf('timelapse'))}</kbd> to stop`);
    } else {
      this.setSpeed(1);
    }
  }

  // ------------------------------------------------------------------ powers & tools
  selectPower(p: PowerId | null): void {
    this.selectedPower = p;
    if (p) { this.tool = null; this.powers.toggleTerraform(false); }
    this.powers.setSelected(p);
    if (p) {
      const d = powerDef(p);
      if (d.target === 'global') {
        // Global powers need no aim.
        this.cast(p, this.renderer.camera.current.focus.clone().multiplyScalar(PLANET_RADIUS));
        this.selectPower(null);
        return;
      }
      this.hint.setSticky(`<b style="color:#${d.color.toString(16).padStart(6, '0')}">${d.name}</b> — click ${d.target === 'ocean' ? 'the sea' : d.target === 'settlement' ? 'a settlement' : d.target === 'land' ? 'land' : 'anywhere'} to cast · <kbd>Esc</kbd> to cancel`);
    } else if (!this.tool) this.hint.setSticky('');
  }

  selectTool(t: BrushTool | null): void {
    this.tool = t;
    if (t) { this.selectedPower = null; this.powers.setSelected(null); this.hint.setSticky(`<b>${t[0].toUpperCase() + t.slice(1)}</b> — hold left mouse and drag · <kbd>Esc</kbd> to stop`); }
    else if (!this.selectedPower) this.hint.setSticky('');
  }

  async cast(p: PowerId, at: THREE.Vector3): Promise<void> {
    const d = powerDef(p);
    const dir = at.clone().normalize();
    const r = await this.sim.command({ kind: 'power', power: p, x: dir.x, y: dir.y, z: dir.z });
    this.onCast(p, at, r.ok);
    if (!r.ok) { this.hint.flash(r.message, true); this.onUi('error'); return; }
    if (r.combo) this.banner.show(r.combo, d.name, 3200);
    else if (r.message) this.hint.flash(r.message);
    if (d.cost >= 200) this.renderer.camera.addShake(0.4);
  }

  dab(at: THREE.Vector3): void {
    if (!this.tool) return;
    const now = performance.now();
    if (now - this.lastDab < 45) return;
    this.lastDab = now;
    const dir = at.clone().normalize();
    if (this.tool === 'flatten' && this.strokeLevel === null) this.strokeLevel = this.renderer.data.heightAt(dir.x, dir.y, dir.z);
    void this.sim.command({ kind: 'brush', tool: this.tool, x: dir.x, y: dir.y, z: dir.z, radius: this.brushRadius, strength: this.brushStrength, paint: this.brushPaint, level: this.strokeLevel ?? undefined });
  }

  endStroke(): void {
    this.strokeLevel = null;
    void this.sim.command({ kind: 'brushEnd' });
  }

  // ------------------------------------------------------------------ selection
  select(t: Selection, fly = false): void {
    this.selection = t;
    this.following = false;
    this.renderer.camera.followFn = null;
    this.inspector.following = false;
    if (!t) { this.inspector.hide(); return; }
    this.refreshInspector();
    if (fly) setTimeout(() => this.focusSelection(), 60);
  }

  private refreshInspector(): void {
    const t = this.selection;
    if (!t) return;
    this.sim.inspect(t).then((info) => {
      if (this.selection !== t) return;
      if (!info) { this.inspector.hide(); this.selection = null; this.following = false; this.renderer.camera.followFn = null; return; }
      this.inspector.show(info, this.tribes);
    }).catch(() => {});
  }

  focusSelection(): void {
    const info = this.inspector.info;
    if (!info) return;
    let x = 0, y = 0, z = 0, dist = 60;
    if (info.kind === 'tribe') {
      const s = this.civ?.settlements.find((q) => q.alive && q.tribe === info.id);
      if (!s) return;
      x = s.x; y = s.y; z = s.z; dist = 260;
    } else {
      x = info.x; y = info.y; z = info.z;
      dist = info.kind === 'settlement' ? 90 : info.kind === 'place' ? 140 : 26;
    }
    this.renderer.camera.flyTo({ focus: new THREE.Vector3(x, y, z), distance: dist }, 2.2);
  }

  toggleFollow(): void {
    const t = this.selection;
    if (!t || (t.kind !== 'person' && t.kind !== 'animal')) return;
    this.following = !this.following;
    this.inspector.following = this.following;
    const uid = t.uid;
    this.renderer.camera.followFn = this.following ? () => {
      const p = (t.kind === 'person' ? this.renderer.people.lastPositions : this.renderer.creatures.lastPositions).get(uid);
      return p ? p.clone().normalize() : null;
    } : null;
    if (this.following) this.renderer.camera.flyTo({ distance: Math.min(this.renderer.camera.target.distance, 24) }, 1.2);
    this.refreshInspector();
  }

  /** Screen-space pick of people, animals, settlements; else the ground. */
  pick(ndcX: number, ndcY: number, px: number, py: number): Selection {
    const cam = this.renderer.camera.camera;
    const w = this.renderer.canvas.clientWidth, h = this.renderer.canvas.clientHeight;
    let best: Selection = null, bestD = 18;
    const v = new THREE.Vector3();
    const camPos = cam.position;
    const test = (pos: THREE.Vector3, sel: Selection, bias: number) => {
      v.copy(pos).project(cam);
      if (v.z > 1) return;
      // Hidden behind the planet?
      if (pos.clone().sub(camPos).dot(pos) > 0 && camPos.length() > PLANET_RADIUS * 1.02) return;
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      const d = Math.hypot(sx - px, sy - py) - bias;
      if (d < bestD) { bestD = d; best = sel; }
    };
    for (const [uid, pos] of this.renderer.people.lastPositions) test(pos, { kind: 'person', uid }, 2);
    for (const [uid, pos] of this.renderer.creatures.lastPositions) test(pos, { kind: 'animal', uid }, 0);
    if (best) return best;
    const hit = this.renderer.camera.raycast(ndcX, ndcY);
    if (!hit) return null;
    const dir = hit.clone().normalize();
    if (this.civ) {
      for (const s of this.civ.settlements) {
        if (!s.alive) continue;
        const d = Math.acos(Math.min(1, dir.x * s.x + dir.y * s.y + dir.z * s.z)) * PLANET_RADIUS;
        if (d < s.radius * 0.9) return { kind: 'settlement', id: s.id };
      }
    }
    return { kind: 'place', x: dir.x, y: dir.y, z: dir.z };
  }

  // ------------------------------------------------------------------ menus
  menu(id: 'chronicle' | 'ecology' | 'tribes' | 'saves' | 'settings' | 'help' | 'photo' | 'director'): void {
    if (id === 'photo') { this.togglePhoto(); return; }
    if (id === 'director') { this.toggleDirector(); return; }
    const m = { chronicle: this.chronicle, ecology: this.ecology, tribes: this.tribesPanel, saves: this.saves, settings: this.settingsPanel, help: this.help }[id];
    for (const o of this.modals) if (o !== m) o.close();
    if (id === 'tribes') this.tribesPanel.civ = this.civ;
    m.toggle();
    if (m.isOpen) this.onUi('open');
  }

  get modalOpen(): boolean {
    return this.modals.some((m) => m.isOpen);
  }

  closeAll(): boolean {
    let any = false;
    for (const m of this.modals) if (m.isOpen) { m.close(); any = true; }
    return any;
  }

  toggleDirector(): void {
    this.director = !this.director;
    this.directorTimer = 0;
    this.hint.flash(this.director ? 'Auto-director on: the camera will seek out the story' : 'Auto-director off');
  }

  togglePhoto(): void {
    this.photo = !this.photo;
    const cam = this.renderer.camera;
    if (this.photo) {
      cam.enterFree();
      this.renderer.post.settings.dof = true;
      document.body.classList.add('hud-hidden');
      this.hint.flash(`Photo mode — <kbd>WASD</kbd> move · drag to look · <kbd>Q</kbd>/<kbd>E</kbd> down/up · <kbd>Enter</kbd> save PNG · <kbd>${keyLabel(this.keys.keyOf('photo'))}</kbd> exit`, false, 6000);
    } else {
      cam.exitFree();
      this.renderer.post.settings.dof = false;
      document.body.classList.toggle('hud-hidden', this.hudHidden);
    }
  }

  savePhoto(): void {
    const url = this.renderer.capture();
    const a = el('a');
    a.href = url;
    a.download = `genesis-${this.worldName.replace(/\W+/g, '-').toLowerCase()}-${Date.now()}.png`;
    a.click();
    this.hint.flash('Photograph saved');
  }

  toggleHud(): void {
    this.hudHidden = !this.hudHidden;
    document.body.classList.toggle('hud-hidden', this.hudHidden);
  }

  // ------------------------------------------------------------------ events
  handleEvents(events: GameEvent[]): void {
    const cam = this.renderer.camera;
    for (const e of events) {
      this.chronicle?.add(e);
      this.onEvent(e);
      if (e.importance >= 0.5 && (e.x || e.y || e.z)) this.directorQueue.push(e);
      if (this.directorQueue.length > 30) this.directorQueue.shift();
      const n = narrate(e);
      if (e.importance >= this.feed.minImportance && e.kind !== 'power') this.feed.push(e, n);
      // Big moments get a banner.
      if (['age', 'ice-age', 'thaw', 'schism', 'holy-war', 'extinction'].includes(e.kind) || (e.kind === 'conquest' && e.data.destroyed) || (e.kind === 'omen' && e.data.kind === 'eclipse')) this.banner.show(n.title, n.text);
      // Feel the ground shake.
      if (e.kind === 'quake' || e.kind === 'meteor' || e.kind === 'eruption') {
        const p = new THREE.Vector3(e.x, e.y, e.z).multiplyScalar(PLANET_RADIUS);
        const d = p.distanceTo(cam.camera.position);
        cam.addShake(Math.max(0, 1.6 - d / 500) * (e.kind === 'meteor' ? 1.5 : 1));
      }
    }
  }

  gotoEvent(e: GameEvent): void {
    if (!e.x && !e.y && !e.z) return;
    const dist = ['war', 'holy-war', 'first-contact', 'alliance', 'ice-age', 'drought', 'hurricane', 'landfall', 'tsunami'].includes(e.kind) ? 600 : ['meteor', 'eruption', 'quake', 'wildfire'].includes(e.kind) ? 260 : 90;
    this.renderer.camera.flyTo({ focus: new THREE.Vector3(e.x, e.y, e.z), distance: dist }, 2.6);
  }

  onFrame(f: FrameData): void {
    this.lastFrame = f;
    this.devotion = this.devotionFromFrame(f);
    this.devotionRate = f.devotionRate;
  }

  private devotionFromFrame(f: FrameData): number {
    return f.devotion;
  }

  onCiv(c: CivData): void {
    this.civ = c;
    this.tribes = c.tribes;
    if (this.tribesPanel?.isOpen) { this.tribesPanel.civ = c; this.tribesPanel.render(); }
  }

  // ------------------------------------------------------------------ per frame
  update(dt: number, now: number): void {
    const r = this.renderer;
    const cam = r.camera;
    if (this.titleMode) {
      // Keep the lit hemisphere in view with the terminator on the right,
      // drifting slowly westward.
      const sun = r.shared.uSunDir.value as THREE.Vector3;
      this.titleDrift += dt * 0.012;
      const lon = Math.atan2(-sun.z, sun.x) - 0.75 + Math.sin(this.titleDrift) * 0.25;
      const lat = 0.32;
      const want = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
      cam.target.focus.lerp(want, Math.min(1, dt * 0.5)).normalize();
      cam.current.focus.copy(cam.target.focus);
      cam.target.heading = 0.25;
      cam.current.heading = 0.25;
      return;
    }
    if (!this.enabled) return;
    this.tutorial?.update(dt);
    // Held keys move the camera.
    if (!this.modalOpen && !this.photo) {
      const k = (id: string) => this.held.has(this.keys.keyOf(id));
      const pan = cam.target.distance * 0.9 * dt;
      let de = 0, dn = 0;
      if (k('panN')) dn += 1;
      if (k('panS')) dn -= 1;
      if (k('panE')) de += 1;
      if (k('panW')) de -= 1;
      if (de || dn) this.panBy(de * pan, dn * pan);
      if (k('rotL')) cam.target.heading -= dt * 1.4;
      if (k('rotR')) cam.target.heading += dt * 1.4;
      if (k('tiltUp')) cam.target.tiltOffset = Math.min(0.9, cam.target.tiltOffset + dt * 0.8);
      if (k('tiltDown')) cam.target.tiltOffset = Math.max(-1.2, cam.target.tiltOffset - dt * 0.8);
      if (k('zoomIn')) cam.target.distance = Math.max(MIN_DISTANCE, cam.target.distance * Math.exp(-dt * 1.6));
      if (k('zoomOut')) cam.target.distance = Math.min(MAX_DISTANCE, cam.target.distance * Math.exp(dt * 1.6));
    } else if (this.photo) {
      const hit = cam.raycast(0, 0);
      r.post.setFocus(hit ? hit.distanceTo(cam.camera.position) : 400, 1.2);
      const k = (c: string) => this.held.has(c);
      const f = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0), s2 = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0), u = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);
      if (f || s2 || u) cam.moveFree(f * dt, s2 * dt, u * dt);
    }
    if (this.timelapse && !cam.isFlying) cam.target.heading += dt * 0.05;
    void this.lapseHeading;
    if (this.director) this.runDirector(dt);
    // HUD.
    const f = this.lastFrame;
    const h = this.sim.header;
    const focus = cam.current.focus;
    const localDay = ((r.renderTick / TICKS_PER_DAY) % 1 + 1 - dayFracForLocalTime(focus, 0) + 1) % 1;
    const stats = this.sim.stats;
    this.hud.update(r.renderTick, localDay, h.speed, h.paused, h.tps, {
      people: this.civ ? this.civ.tribes.reduce((a, t) => a + (t.alive ? t.population : 0), 0) : 0,
      tribes: this.civ ? this.civ.tribes.filter((t) => t.alive).length : 0,
      animals: stats ? stats.animals : 0,
      species: stats ? stats.species : 0,
    }, this.timelapse, this.director);
    if (f) this.powers.update(f.devotion, f.devotionRate, f.cooldowns, f.boundless);
    this.feed.update(now);
    // Inspector refresh.
    this.inspectTimer -= dt;
    if (this.selection && this.inspectTimer <= 0) { this.inspectTimer = 0.6; this.refreshInspector(); }
    // Targeting reticle.
    const vfx = r.vfx;
    if (this.hover && (this.selectedPower || this.tool)) {
      const radius = this.selectedPower ? Math.max(6, powerDef(this.selectedPower).radius) : this.brushRadius;
      const color = this.selectedPower ? powerDef(this.selectedPower).color : 0xe8d8b0;
      let valid = true;
      if (this.selectedPower) {
        const d = powerDef(this.selectedPower);
        const dir = this.hover.clone().normalize();
        const hh = r.data.heightAt(dir.x, dir.y, dir.z);
        if (d.target === 'land' && hh < 0) valid = false;
        if (d.target === 'ocean' && hh >= 0) valid = false;
        if (f && !f.boundless && this.devotion < d.cost) valid = false;
      }
      vfx.setReticle(this.hover, Math.min(radius, 420), valid ? color : 0xff5040);
    } else vfx.setReticle(null, 0, 0);
    // Selection ring.
    const sel = this.selection;
    let selPos: THREE.Vector3 | null = null;
    if (sel && sel.kind === 'person') selPos = r.people.lastPositions.get(sel.uid) ?? null;
    else if (sel && sel.kind === 'animal') selPos = r.creatures.lastPositions.get(sel.uid) ?? null;
    vfx.setSelection(selPos, sel && sel.kind === 'animal' ? 1.6 : 1.1);
    // Quality governor.
    if (this.governor.enabled && !this.photo) {
      const cur: QualityId = r.qualityId;
      const step = this.governor.feed(dt, cur);
      if (step !== 0) {
        const idx = QUALITY_ORDER.indexOf(cur) + step;
        if (idx >= 0 && idx < QUALITY_ORDER.length) r.setQuality(QUALITY_ORDER[idx]);
      }
    }
    // Perf overlay.
    {
      const st = r.stats;
      const fps = dt > 0 ? 1 / dt : 0;
      this.perf.update(dt * 1000, [
        `FPS ${fps.toFixed(0)}  frame ${(dt * 1000).toFixed(1)} ms  cpu ${st.frameMs.toFixed(1)} ms`,
        `draws ${st.drawCalls}  tris ${(st.triangles / 1000).toFixed(0)}k  patches ${st.patches}`,
        `quality ${r.qualityId}  dpr ${r.renderer.getPixelRatio().toFixed(2)}`,
        `sim ${h.tps.toFixed(0)} t/s  ${h.simMs.toFixed(2)} ms/tick  tick ${h.tick}`,
        `animals ${stats?.animals ?? 0} (${r.creatures.visibleCount} drawn)  people ${this.hud ? this.civ?.tribes.reduce((a, t) => a + t.population, 0) ?? 0 : 0} (${r.people.visibleCount} drawn)`,
        `buildings ${r.buildings.count}  vegetation ${r.vegetation.count}  speed ${h.paused ? 'paused' : `${h.speed}×`} (${(h.tps / TICKS_PER_SECOND_1X).toFixed(1)}× real)`,
      ]);
    }
  }

  /** Fly to the most populous settlement. */
  focusPeople(): void {
    const s = this.civ?.settlements.filter((q) => q.alive).sort((a, b) => b.pop - a.pop)[0];
    if (s) this.renderer.camera.flyTo({ focus: new THREE.Vector3(s.x, s.y, s.z), distance: 520, tiltOffset: 0.08 }, 4);
  }

  /** Move the camera focus east/north by world units. */
  panBy(de: number, dn: number): void {
    const cam = this.renderer.camera;
    if (cam.followFn) { cam.followFn = null; this.following = false; this.inspector.following = false; }
    const up = cam.target.focus;
    const east = new THREE.Vector3(), north = new THREE.Vector3();
    PlanetCamera.frame(up, east, north);
    const hd = cam.target.heading;
    const fwd = north.clone().multiplyScalar(Math.cos(hd)).addScaledVector(east, Math.sin(hd));
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    up.addScaledVector(fwd, dn / PLANET_RADIUS).addScaledVector(right, de / PLANET_RADIUS).normalize();
  }

  private runDirector(dt: number): void {
    const cam = this.renderer.camera;
    this.directorTimer -= dt;
    if (this.directorTimer > 0 || cam.isFlying) return;
    // Pick the most important fresh event; otherwise drift between vistas.
    const now = this.renderer.renderTick;
    this.directorQueue = this.directorQueue.filter((e) => now - e.tick < TICKS_PER_DAY * 3);
    this.directorQueue.sort((a, b) => b.importance - a.importance || b.tick - a.tick);
    const e = this.directorQueue.shift();
    if (e) {
      this.gotoEvent(e);
      const n = narrate(e);
      this.hint.flash(`<b>${n.title}</b> — ${n.text}`, false, 5000);
      this.directorTimer = 11;
      return;
    }
    const s = this.civ?.settlements.filter((q) => q.alive);
    const rng = Math.random; // presentation only: never touches the simulation
    const choice = rng();
    if (s && s.length && choice < 0.45) {
      const st = s[Math.floor(rng() * s.length)];
      cam.flyTo({ focus: new THREE.Vector3(st.x, st.y, st.z), distance: 50 + rng() * 60, heading: rng() * 6.28, tiltOffset: 0.05 }, 4);
    } else if (choice < 0.7) {
      const p = this.renderer.creatures.densestSpot();
      if (p) cam.flyTo({ focus: p, distance: 30 + rng() * 20, heading: rng() * 6.28 }, 4);
    } else {
      cam.flyTo({ distance: 1500 + rng() * 2000, heading: cam.target.heading + 1, tiltOffset: 0.15 }, 5);
    }
    this.directorTimer = 12;
  }

  // ------------------------------------------------------------------ input
  keyDown(e: KeyboardEvent): void {
    if (!this.enabled || this.settingsPanel?.capturing) return;
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    this.held.add(e.code);
    if (this.photo) {
      if (e.code === 'Enter') { this.savePhoto(); e.preventDefault(); return; }
      if (e.code === this.keys.keyOf('photo') || e.code === 'Escape') { this.togglePhoto(); e.preventDefault(); }
      return;
    }
    const act = this.keys.action(e.code);
    if (!act) return;
    if (act.startsWith('power:')) { this.selectPower(act.slice(6) as PowerId); e.preventDefault(); return; }
    if (e.repeat && !['zoomIn', 'zoomOut'].includes(act)) return;
    switch (act) {
      case 'pause': this.togglePause(); break;
      case 'faster': this.stepSpeed(1); break;
      case 'slower': this.stepSpeed(-1); break;
      case 'speed1': this.setSpeed(1); break;
      case 'speed2': this.setSpeed(10); break;
      case 'speed3': this.setSpeed(100); break;
      case 'timelapse': this.toggleTimelapse(); break;
      case 'home': this.renderer.camera.flyTo({ distance: 3200, tiltOffset: 0 }, 2.5); break;
      case 'follow': this.toggleFollow(); break;
      case 'director': this.toggleDirector(); break;
      case 'photo': this.togglePhoto(); break;
      case 'terraform': this.powers.toggleTerraform(); break;
      case 'cancel':
        if (this.closeAll()) break;
        if (this.selectedPower || this.tool) { this.selectPower(null); this.powers.toggleTerraform(false); this.selectTool(null); break; }
        if (this.selection) { this.select(null); break; }
        if (this.timelapse) { this.toggleTimelapse(); break; }
        this.menu('help');
        break;
      case 'chronicle': this.menu('chronicle'); break;
      case 'ecology': this.menu('ecology'); break;
      case 'tribes': this.menu('tribes'); break;
      case 'saves': this.menu('saves'); break;
      case 'settings': this.menu('settings'); break;
      case 'help': this.menu('help'); break;
      case 'quicksave': void this.saveSystem.save('quick').then(() => this.hint.flash('Quick saved')).catch((err) => this.hint.flash(String(err), true)); break;
      case 'quickload': void this.saveSystem.load('quick').catch((err) => this.hint.flash(String(err), true)); break;
      case 'hideUi': this.toggleHud(); break;
      case 'perf': this.perf.toggle(); break;
      case 'wheel': this.wheel.show(this.pointerX, this.pointerY); break;
      default: return;
    }
    e.preventDefault();
  }

  keyUp(e: KeyboardEvent): void {
    this.held.delete(e.code);
    if (this.keys.action(e.code) === 'wheel' && this.wheel.open) {
      const p = this.wheel.hide();
      if (p) this.selectPower(p);
    }
  }

  pointerX = 0;
  pointerY = 0;
  clearHeld(): void {
    this.held.clear();
  }
}

