/**
 * The god's hand: casting divine powers and simulating their lingering
 * effects. Every power changes the simulation itself (climate fields, plants,
 * animals, people, buildings, terrain) — the visuals are driven from the
 * resulting state and from the effect list streamed to the renderer.
 *
 * Mortals witness each act; their love and fear (and so the devotion they
 * produce) respond to what they saw, and their tribe remembers.
 */
import type { World } from '../world';
import { POWERS, POWER_INDEX, powerDef, COMBOS, type PowerId } from './defs';
import { PLANET_RADIUS, TICKS_PER_DAY, TICKS_PER_YEAR } from '../constants';
import { offsetDir } from '../move';
import { TECHS, TECH_INDEX } from '../civ/tech';

export interface DivineEffect {
  id: number;
  power: PowerId;
  x: number; y: number; z: number;
  radius: number;
  start: number;
  end: number;
  strength: number;
  /** Power-specific stage (meteor falling/impacted, volcano rising/erupting). */
  phase: number;
  /** Combo that empowered this effect ('' if none). */
  combo: string;
  /** Drift direction for moving effects (locusts), unit tangent. */
  dx: number; dy: number; dz: number;
  /** Casualties caused so far (tsunami). */
  count: number;
}

export interface CastResult {
  ok: boolean;
  message: string;
  combo?: string;
}

export interface CastRequest {
  power: PowerId;
  x: number; y: number; z: number;
}

/** Shorthand: great-circle distance in world units between two unit vectors. */
function dist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))) * PLANET_RADIUS;
}

const METEOR_FALL = 24;
const VOLCANO_RISE = 24;
const TSUNAMI_SPEED = 3.2; // world units per tick
const TSUNAMI_RANGE = 320;

export class Divine {
  effects: DivineEffect[] = [];
  /** Tick at which each power becomes available again. */
  ready: number[] = POWERS.map(() => 0);
  /** Lava volume per region cell. */
  lava: Float32Array;
  /** Flood water depth per region cell (tsunamis, deluges). */
  flood: Float32Array;
  /** Sandbox: powers cost nothing and have no cooldown. */
  boundless = false;
  /** Totals for statistics and scenarios. */
  casts: Record<string, number> = {};
  combos: Record<string, number> = {};
  private nextId = 1;
  private cellCache = new Map<number, { cells: Int32Array; w: Float32Array }>();

  constructor(regionCount: number) {
    this.lava = new Float32Array(regionCount);
    this.flood = new Float32Array(regionCount);
  }

  // ------------------------------------------------------------------ helpers
  /** Region cells within an effect's radius and their falloff weights (cached). */
  private cellsOf(w: World, e: { id: number; x: number; y: number; z: number; radius: number }): { cells: Int32Array; w: Float32Array } {
    let c = this.cellCache.get(e.id);
    if (c) return c;
    c = this.cellsNear(w, e.x, e.y, e.z, e.radius);
    this.cellCache.set(e.id, c);
    return c;
  }

  cellsNear(w: World, x: number, y: number, z: number, radius: number): { cells: Int32Array; w: Float32Array } {
    const g = w.planet.region;
    const R = Math.max(radius, g.spacing * PLANET_RADIUS * 0.6) / PLANET_RADIUS;
    const cosR = Math.cos(R);
    const cells: number[] = [], ws: number[] = [];
    for (let c = 0; c < g.count; c++) {
      const dot = g.centers[c * 3] * x + g.centers[c * 3 + 1] * y + g.centers[c * 3 + 2] * z;
      if (dot < cosR) continue;
      const t = Math.acos(Math.min(1, dot)) / R;
      cells.push(c);
      ws.push((1 - t * t) * (1 - t * t));
    }
    return { cells: Int32Array.from(cells), w: Float32Array.from(ws) };
  }

  private active(power: PowerId, tick: number): DivineEffect[] {
    return this.effects.filter((e) => e.power === power && e.end > tick);
  }

  /** Is (x,y,z) inside an active effect of this power? */
  within(power: PowerId, x: number, y: number, z: number, tick: number, pad = 0): DivineEffect | null {
    for (const e of this.effects) {
      if (e.power !== power || e.end <= tick) continue;
      if (dist(e.x, e.y, e.z, x, y, z) < e.radius + pad) return e;
    }
    return null;
  }

  private add(power: PowerId, x: number, y: number, z: number, radius: number, start: number, dur: number, strength = 1, combo = ''): DivineEffect {
    const e: DivineEffect = { id: this.nextId++, power, x, y, z, radius, start, end: start + dur, strength, phase: 0, combo, dx: 0, dy: 0, dz: 0, count: 0 };
    this.effects.push(e);
    return e;
  }

  private place(w: World, x: number, y: number, z: number): string {
    return w.geo.describe(w.planet.region.cellOf(x, y, z));
  }

  private combo(w: World, id: string, x: number, y: number, z: number): string {
    const def = COMBOS.find((c) => c.id === id)!;
    this.combos[id] = (this.combos[id] ?? 0) + 1;
    w.events.emit(w.tick, 'miracle', { x, y, z }, 0.7, { combo: id, name: def.name, desc: def.desc });
    return def.name;
  }

  // ------------------------------------------------------------------ casting
  canCast(w: World, power: PowerId): { ok: boolean; message: string } {
    const i = POWER_INDEX.get(power);
    if (i === undefined) return { ok: false, message: 'Unknown power' };
    const def = POWERS[i];
    if (!this.boundless) {
      if (w.tick < this.ready[i]) return { ok: false, message: `${def.name} is gathering strength` };
      if (w.civ.devotion < def.cost) return { ok: false, message: `Not enough devotion (${Math.floor(w.civ.devotion)} / ${def.cost})` };
    }
    return { ok: true, message: '' };
  }

  cast(w: World, req: CastRequest): CastResult {
    const def = powerDef(req.power);
    const check = this.canCast(w, req.power);
    if (!check.ok) return check;
    let { x, y, z } = req;
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    const h = w.planet.heightAt(x, y, z);
    if (def.target === 'land' && h < 0) return { ok: false, message: `${def.name} must be cast upon land` };
    if (def.target === 'ocean' && h >= 0) return { ok: false, message: `${def.name} must be cast upon the sea` };
    const tick = w.tick;
    let result: CastResult;
    switch (req.power) {
      case 'lightning': result = this.lightning(w, x, y, z); break;
      case 'rain': result = this.rain(w, x, y, z); break;
      case 'drought': result = this.drought(w, x, y, z); break;
      case 'wildfire': result = this.wildfire(w, x, y, z); break;
      case 'iceage': result = this.iceAge(w); break;
      case 'earthquake': result = this.earthquake(w, x, y, z); break;
      case 'volcano': result = this.volcano(w, x, y, z); break;
      case 'tsunami': result = this.tsunami(w, x, y, z, 1); break;
      case 'meteor': result = this.meteor(w, x, y, z); break;
      case 'bloom': result = this.bloom(w, x, y, z); break;
      case 'blessing': result = this.blessing(w, x, y, z); break;
      case 'plague': result = this.plague(w, x, y, z); break;
      case 'resurrection': result = this.resurrection(w, x, y, z); break;
      case 'locusts': result = this.locusts(w, x, y, z); break;
      case 'inspiration': result = this.inspiration(w, x, y, z); break;
      case 'prophet': result = this.prophet(w, x, y, z); break;
      case 'harmony': result = this.harmony(w, x, y, z); break;
      case 'beacon': result = this.beacon(w, x, y, z); break;
      case 'eclipse': result = this.eclipse(w); break;
      case 'sanctuary': result = this.sanctuary(w, x, y, z); break;
    }
    if (!result.ok) return result;
    const i = POWER_INDEX.get(req.power)!;
    if (!this.boundless) {
      w.civ.devotion -= def.cost;
      this.ready[i] = tick + def.cooldown;
    }
    this.casts[req.power] = (this.casts[req.power] ?? 0) + 1;
    w.events.emit(tick, 'power', { x, y, z }, def.cost >= 100 ? 0.7 : 0.4, { power: req.power, name: def.name, combo: result.combo ?? '', where: this.place(w, x, y, z) });
    return result;
  }

  // ------------------------------------------------------------------ sky
  private strike(w: World, x: number, y: number, z: number, power: number): number {
    // Visual bolt via the weather strike log; ignition and deaths here.
    w.weather.strikeLog.push({ x, y, z, power });
    const p = w.planet;
    const c = p.region.cellOf(x, y, z);
    if (p.terrain.oceanFrac[c] < 0.6 && w.plants.fuel(c) > 0.15) w.fires.ignite(c, 0.5 + power * 0.3);
    const deaths = w.civ.damageArea(x, y, z, 2.2 * power, 0.9, 'lightning', w.tick, w.rng, w.events).deaths;
    w.animals.killNear(x, y, z, 2.5 * power, 0.7, w.rng);
    return deaths;
  }

  private lightning(w: World, x: number, y: number, z: number): CastResult {
    let deaths = this.strike(w, x, y, z, 1.2);
    let combo: string | undefined;
    const c = w.planet.region.cellOf(x, y, z);
    const stormy = this.within('rain', x, y, z, w.tick) || w.weather.storms.some((s) => dist(s.x, s.y, s.z, x, y, z) < s.radius * PLANET_RADIUS * 0.6) || w.planet.climate.rain[c] > 0.6;
    if (stormy) {
      combo = this.combo(w, 'tempest', x, y, z);
      const e = this.add('lightning', x, y, z, 35, w.tick, 20, 1, 'tempest');
      e.phase = 6; // remaining extra strikes
    } else {
      this.add('lightning', x, y, z, 4, w.tick, 4);
    }
    w.civ.witness(x, y, z, 70, 0.0, stormy ? 0.12 : 0.06, 'lightning', w.tick, this.place(w, x, y, z), deaths);
    return { ok: true, message: stormy ? 'The storm answers your call' : '', combo };
  }

  private rain(w: World, x: number, y: number, z: number): CastResult {
    let combo: string | undefined;
    const tick = w.tick;
    const drought = this.within('drought', x, y, z, tick, 40);
    const cell = w.planet.region.cellOf(x, y, z);
    const dry = w.planet.climate.soil[cell] < 0.15 || Object.values(w.weather.droughtOn).some(Boolean) && w.planet.climate.soil[cell] < 0.3;
    const wet = this.within('rain', x, y, z, tick, 20);
    let love = 0.08;
    if (drought || dry) {
      combo = this.combo(w, 'mercy', x, y, z);
      love = 0.35;
      if (drought) drought.end = tick; // the drought is broken
    } else if (wet) {
      combo = this.combo(w, 'deluge', x, y, z);
    }
    this.add('rain', x, y, z, 70, tick, TICKS_PER_DAY * 2, 1, combo === 'Deluge' ? 'deluge' : combo ? 'mercy' : '');
    w.civ.witness(x, y, z, 120, love, 0.01, combo ? 'mercy' : 'rain', tick, this.place(w, x, y, z), 0);
    return { ok: true, message: '', combo };
  }

  private drought(w: World, x: number, y: number, z: number): CastResult {
    this.add('drought', x, y, z, 150, w.tick, TICKS_PER_YEAR);
    w.events.emit(w.tick, 'drought', { x, y, z }, 0.6, { where: this.place(w, x, y, z), divine: 1 });
    w.civ.witness(x, y, z, 180, -0.05, 0.15, 'drought', w.tick, this.place(w, x, y, z), 0);
    return { ok: true, message: '' };
  }

  private wildfire(w: World, x: number, y: number, z: number): CastResult {
    const tick = w.tick;
    const dry = this.within('drought', x, y, z, tick, 30);
    let combo: string | undefined;
    const { cells, w: ws } = this.cellsNear(w, x, y, z, dry ? 45 : 22);
    if (dry) combo = this.combo(w, 'firestorm', x, y, z);
    let lit = 0;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (w.planet.terrain.oceanFrac[c] > 0.6) continue;
      if (w.fires.ignite(c, Math.min(1, (dry ? 1 : 0.75) * (0.5 + ws[k])))) lit++;
    }
    if (lit === 0) return { ok: false, message: 'Nothing here will burn' };
    this.add('wildfire', x, y, z, dry ? 45 : 22, tick, 40, 1, dry ? 'firestorm' : '');
    w.civ.witness(x, y, z, 90, -0.02, 0.1, 'fire', tick, this.place(w, x, y, z), 0);
    return { ok: true, message: '', combo };
  }

  private iceAge(w: World): CastResult {
    if (this.active('iceage', w.tick).some((e) => e.combo !== 'winter')) return { ok: false, message: 'The world is already frozen' };
    this.add('iceage', 0, 1, 0, 0, w.tick, TICKS_PER_YEAR * 6);
    w.events.emit(w.tick, 'ice-age', null, 0.9, {});
    for (const t of w.civ.tribes) if (t.alive) { t.religion.fear = Math.min(1, t.religion.fear + 0.15); }
    return { ok: true, message: '' };
  }

  // ------------------------------------------------------------------ earth
  private earthquake(w: World, x: number, y: number, z: number): CastResult {
    const tick = w.tick;
    const rng = w.rng;
    // Fault scarp: a line through the epicentre; one side drops.
    const ang = rng.range(0, Math.PI);
    const east = [z, 0, -x];
    const el = Math.hypot(east[0], east[2]) || 1;
    east[0] /= el; east[2] /= el;
    const north = [y * east[2] - z * east[1], z * east[0] - x * east[2], x * east[1] - y * east[0]];
    const nx = Math.cos(ang) * east[0] + Math.sin(ang) * north[0];
    const ny = Math.cos(ang) * east[1] + Math.sin(ang) * north[1];
    const nz = Math.cos(ang) * east[2] + Math.sin(ang) * north[2];
    const throwH = rng.range(1.2, 2.6);
    w.terraform.deform(x, y, z, 60, (h, t, vx, vy, vz) => {
      if (h < -2) return h;
      const side = ((vx - x) * nx + (vy - y) * ny + (vz - z) * nz) * PLANET_RADIUS;
      const step = Math.tanh(side / 2.5) * 0.5 + 0.5;
      const fall = (1 - t) * (1 - t);
      return h + (step - 0.5) * throwH * fall;
    });
    w.terraform.commit();
    const dmg = w.civ.damageArea(x, y, z, 60, 2.2, 'earthquake', tick, rng, w.events, 0.28);
    w.animals.killNear(x, y, z, 25, 0.1, rng);
    this.add('earthquake', x, y, z, 60, tick, 16);
    let combo: string | undefined;
    // Beside a volcano: wake it again.
    for (const e of this.effects) {
      if (e.power === 'volcano' && dist(e.x, e.y, e.z, x, y, z) < 120) {
        combo = this.combo(w, 'aftershock', x, y, z);
        e.phase = 1;
        e.end = Math.max(e.end, tick + TICKS_PER_DAY * 2);
        break;
      }
    }
    // Undersea quakes (or near coasts) raise a tsunami.
    const g = w.planet.region;
    const c = g.cellOf(x, y, z);
    if (w.planet.terrain.coastal[c] && w.planet.heightAt(x, y, z) < 2) {
      // Find the nearest sea cell to launch the wave from.
      for (let k = 0; k < 8; k++) {
        const nb = g.neighbors[c * 8 + k];
        if (w.planet.terrain.oceanFrac[nb] > 0.8) { this.tsunami(w, g.centers[nb * 3], g.centers[nb * 3 + 1], g.centers[nb * 3 + 2], 0.6); break; }
      }
    }
    w.events.emit(tick, 'quake', { x, y, z }, 0.7, { where: this.place(w, x, y, z), deaths: dmg.deaths, ruined: dmg.ruined });
    w.civ.witness(x, y, z, 160, -0.08, 0.3, 'earthquake', tick, this.place(w, x, y, z), dmg.deaths);
    return { ok: true, message: '', combo };
  }

  private volcano(w: World, x: number, y: number, z: number): CastResult {
    const e = this.add('volcano', x, y, z, 45, w.tick, VOLCANO_RISE + TICKS_PER_DAY * 3);
    e.phase = 0;
    w.events.emit(w.tick, 'eruption', { x, y, z }, 0.85, { where: this.place(w, x, y, z) });
    return { ok: true, message: '' };
  }

  private tsunami(w: World, x: number, y: number, z: number, strength: number): CastResult {
    this.add('tsunami', x, y, z, TSUNAMI_RANGE * strength, w.tick, Math.ceil((TSUNAMI_RANGE * strength) / TSUNAMI_SPEED) + 30, strength);
    w.events.emit(w.tick, 'tsunami', { x, y, z }, 0.8, { where: this.place(w, x, y, z) });
    return { ok: true, message: '' };
  }

  private meteor(w: World, x: number, y: number, z: number): CastResult {
    const e = this.add('meteor', x, y, z, 40, w.tick, METEOR_FALL + 60);
    // Entry direction (for the fireball trail): from the east-ish sky.
    e.dx = w.rng.range(-1, 1); e.dy = w.rng.range(0.2, 1); e.dz = w.rng.range(-1, 1);
    w.events.emit(w.tick, 'omen', { x, y, z }, 0.5, { kind: 'meteor' });
    return { ok: true, message: '' };
  }

  private impact(w: World, e: DivineEffect): void {
    const { x, y, z } = e;
    const tick = w.tick;
    const ocean = w.planet.heightAt(x, y, z) < -1;
    w.terraform.deform(x, y, z, 55, (h, t) => {
      // Bowl with a raised rim and ejecta blanket.
      const bowl = -11 * Math.max(0, 1 - (t / 0.55) ** 2);
      const rim = 4.5 * Math.exp(-(((t - 0.58) / 0.12) ** 2));
      const ejecta = 1.2 * Math.max(0, 1 - t) * (t > 0.6 ? 1 : 0);
      return h + bowl + rim + ejecta;
    });
    w.terraform.commit();
    const dmg = w.civ.damageArea(x, y, z, 70, 6, 'meteor', tick, w.rng, w.events);
    const dead = w.animals.killNear(x, y, z, 70, 0.95, w.rng, false);
    // Ring of fire.
    const { cells, w: ws } = this.cellsNear(w, x, y, z, 110);
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (w.planet.terrain.oceanFrac[c] > 0.5) continue;
      w.plants.burn(c, Math.min(1, ws[k] * 1.4));
      if (ws[k] < 0.8) w.fires.ignite(c, 0.6 + ws[k] * 0.4);
    }
    // Dust winter: ash over a wide area and a global chill.
    const ash = this.cellsNear(w, x, y, z, 520);
    const cl = w.planet.climate;
    for (let k = 0; k < ash.cells.length; k++) cl.ash[ash.cells[k]] = Math.min(1, cl.ash[ash.cells[k]] + ash.w[k] * 0.7);
    this.add('iceage', x, y, z, 0, tick, TICKS_PER_YEAR * 1.5, 0.35, 'winter');
    let combo = '';
    if (ocean) { combo = this.combo(w, 'cataclysm', x, y, z); this.tsunami(w, x, y, z, 1.2); }
    e.phase = 1;
    e.combo = combo ? 'cataclysm' : e.combo;
    w.events.emit(tick, 'meteor', { x, y, z }, 0.95, { where: this.place(w, x, y, z), deaths: dmg.deaths, animals: dead, ocean: ocean ? 1 : 0 });
    w.civ.witness(x, y, z, 600, -0.05, 0.4, 'meteor', tick, this.place(w, x, y, z), dmg.deaths);
    // Survivors may hold the crater sacred (a place of dread).
    const near = w.civ.nearestSettlement(x, y, z, 400);
    if (near) {
      const t = w.civ.tribes[near.tribe];
      t.religion.sacredSites.push({ x, y, z, origin: 'the fallen star', tick, shrine: -1 });
      w.events.emit(tick, 'sacred-site', { x, y, z }, 0.5, { tribe: t.name, origin: 'the fallen star' });
    }
  }

  // ------------------------------------------------------------------ life
  private bloom(w: World, x: number, y: number, z: number): CastResult {
    const p = w.planet, pl = w.plants, cl = p.climate;
    const { cells, w: ws } = this.cellsNear(w, x, y, z, 80);
    let ashy = false;
    for (let k = 0; k < cells.length; k++) if (cl.ash[cells[k]] > 0.2 || this.lava[cells[k]] > 0.02 || w.fires.scar[cells[k]] > 0.4) ashy = true;
    let combo: string | undefined;
    if (ashy) combo = this.combo(w, 'ashbloom', x, y, z);
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (p.terrain.oceanFrac[c] > 0.7) continue;
      const wt = ws[k];
      for (let s = 0; s < 8; s++) {
        const suit = pl.suitability(s, c, cl, p.terrain);
        const target = Math.min(1, suit * (ashy ? 1.2 : 1));
        const o = c * 8 + s;
        if (pl.density[o] < target) pl.density[o] += (target - pl.density[o]) * Math.min(1, wt * 1.3);
      }
      pl.bloom[c] = Math.max(pl.bloom[c], wt);
      cl.soil[c] = Math.min(1, cl.soil[c] + 0.3 * wt);
      if (ashy) { cl.ash[c] *= 0.3; w.fires.scar[c] *= 0.3; }
    }
    w.animals.bless(x, y, z, 80);
    for (const b of w.civ.buildings) {
      if (b.type === 2 && !b.ruin && dist(b.x, b.y, b.z, x, y, z) < 80) b.growth = Math.max(b.growth, 0.95);
    }
    this.add('bloom', x, y, z, 80, w.tick, 60, 1, ashy ? 'ashbloom' : '');
    w.civ.witness(x, y, z, 120, 0.2, 0, 'bloom', w.tick, this.place(w, x, y, z), 0);
    return { ok: true, message: '', combo };
  }

  private blessing(w: World, x: number, y: number, z: number): CastResult {
    const s = w.civ.nearestSettlement(x, y, z, 90);
    if (!s) return { ok: false, message: 'There are no people here to bless' };
    const tick = w.tick;
    let combo: string | undefined;
    if (s.disease > 0.03) { combo = this.combo(w, 'cure', s.x, s.y, s.z); w.civ.cureSettlement(s); }
    s.blessed = tick + TICKS_PER_YEAR;
    const P = w.civ.people;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.settle[i] !== s.id) continue;
      P.health[i] = 1;
      P.happiness[i] = Math.min(1, P.happiness[i] + 0.4);
      P.hunger[i] = Math.min(P.hunger[i], 0.2);
    }
    this.add('blessing', s.x, s.y, s.z, s.radius + 10, tick, 60, 1, combo ? 'cure' : '');
    w.civ.witness(s.x, s.y, s.z, s.radius + 40, combo ? 0.45 : 0.3, 0, combo ? 'cure' : 'blessing', tick, s.name, 0);
    return { ok: true, message: `${s.name} is blessed`, combo };
  }

  private plague(w: World, x: number, y: number, z: number): CastResult {
    const s = w.civ.nearestSettlement(x, y, z, 60);
    const tick = w.tick;
    let people = 0;
    if (s) people = w.civ.infectArea(s.x, s.y, s.z, s.radius + 10, 0.35, w.rng);
    else people = w.civ.infectArea(x, y, z, 30, 0.35, w.rng);
    const beasts = w.animals.infectNear(x, y, z, 45, 0.5, w.rng);
    if (people + beasts === 0) return { ok: false, message: 'No living thing here to sicken' };
    const at = s ?? { x, y, z };
    this.add('plague', at.x, at.y, at.z, s ? s.radius + 10 : 45, tick, TICKS_PER_DAY * 3);
    if (s) w.events.emit(tick, 'plague', s, 0.75, { settlement: s.name, tribe: w.civ.tribes[s.tribe].name, sick: people, divine: 1 });
    w.civ.witness(at.x, at.y, at.z, 80, -0.1, 0.25, 'plague', tick, s ? s.name : this.place(w, x, y, z), 0);
    return { ok: true, message: '' };
  }

  private resurrection(w: World, x: number, y: number, z: number): CastResult {
    const tick = w.tick;
    const since = tick - TICKS_PER_YEAR;
    const s = w.civ.nearestSettlement(x, y, z, 60);
    let combo: string | undefined;
    if (s && s.disease > 0.03) { combo = this.combo(w, 'cure', s.x, s.y, s.z); w.civ.cureSettlement(s); }
    const back = w.civ.resurrect(x, y, z, 45, since, tick, w.rng);
    if (back.length === 0 && !combo) return { ok: false, message: 'No one has died here within the year' };
    this.add('resurrection', x, y, z, 45, tick, 80);
    const names = back.slice(0, 3).map((i) => w.civ.personName(i));
    w.events.emit(tick, 'miracle', { x, y, z }, 0.9, { kind: 'resurrection', count: back.length, names: names.join(', ') });
    w.civ.witness(x, y, z, 200, 0.5, 0.15, 'resurrection', tick, s ? s.name : this.place(w, x, y, z), 0);
    if (s) {
      const t = w.civ.tribes[s.tribe];
      t.religion.sacredSites.push({ x, y, z, origin: 'the rising of the dead', tick, shrine: -1 });
      w.events.emit(tick, 'sacred-site', { x, y, z }, 0.5, { tribe: t.name, origin: 'the rising of the dead' });
    }
    return { ok: true, message: back.length ? `${back.length} return from death` : '', combo };
  }

  private locusts(w: World, x: number, y: number, z: number): CastResult {
    const e = this.add('locusts', x, y, z, 30, w.tick, TICKS_PER_DAY * 2);
    const c = w.planet.region.cellOf(x, y, z);
    const cl = w.planet.climate;
    // Drift with the prevailing wind (converted to a tangent vector).
    const east = [z, 0, -x];
    const el = Math.hypot(east[0], east[2]) || 1;
    east[0] /= el; east[2] /= el;
    const north = [y * east[2] - z * east[1], z * east[0] - x * east[2], x * east[1] - y * east[0]];
    const we = cl.windE[c] || 1, wn = cl.windN[c] || 0.3;
    const m = Math.hypot(we, wn);
    e.dx = (east[0] * we + north[0] * wn) / m;
    e.dy = (east[1] * we + north[1] * wn) / m;
    e.dz = (east[2] * we + north[2] * wn) / m;
    w.civ.witness(x, y, z, 120, -0.05, 0.15, 'locusts', w.tick, this.place(w, x, y, z), 0);
    return { ok: true, message: '' };
  }

  // ------------------------------------------------------------------ spirit
  private inspiration(w: World, x: number, y: number, z: number): CastResult {
    const s = w.civ.nearestSettlement(x, y, z, 90);
    if (!s) return { ok: false, message: 'There is no mind here to inspire' };
    const t = w.civ.tribes[s.tribe];
    const tick = w.tick;
    t.inspired = tick + TICKS_PER_YEAR;
    // The field closest to its next discovery leaps forward.
    let bestF = 0, bestGap = Infinity;
    for (let f = 0; f < t.research.length; f++) {
      let cheapest = Infinity;
      for (let k = 0; k < TECHS.length; k++) {
        const tech = TECHS[k];
        if (tech.field !== f || t.known[k]) continue;
        if (!tech.req.every((r) => t.known[TECH_INDEX.get(r)!])) continue;
        cheapest = Math.min(cheapest, tech.cost);
      }
      const gap = cheapest - t.research[f];
      if (gap < bestGap) { bestGap = gap; bestF = f; }
    }
    if (bestGap < Infinity) t.research[bestF] += bestGap + 0.01;
    // A sage rises.
    const P = w.civ.people;
    let best = -1, bestScore = -1;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.settle[i] !== s.id || P.age[i] < 16 || P.role[i] !== 0) continue;
      const sc = P.curious[i] + P.skLore[i];
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    if (best >= 0) { P.role[best] = 5; P.skLore[best] = 1; P.curious[best] = 1; }
    this.add('inspiration', s.x, s.y, s.z, 20, tick, 60);
    w.events.emit(tick, 'miracle', s, 0.6, { kind: 'inspiration', settlement: s.name, tribe: t.name, sage: best >= 0 ? w.civ.personName(best) : '' });
    w.civ.witness(s.x, s.y, s.z, s.radius + 20, 0.12, 0, 'inspiration', tick, s.name, 0);
    return { ok: true, message: `${t.name} dream of new things` };
  }

  private prophet(w: World, x: number, y: number, z: number): CastResult {
    const s = w.civ.nearestSettlement(x, y, z, 90);
    if (!s) return { ok: false, message: 'There is no one here to receive a vision' };
    const P = w.civ.people;
    const tick = w.tick;
    let best = -1, bestScore = -1;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || P.settle[i] !== s.id || P.age[i] < 16 || P.role[i] === 1 || P.role[i] === 3) continue;
      const sc = P.pious[i] * 2 + P.social[i] + P.love[i];
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    if (best < 0) return { ok: false, message: 'No one here is ready for a vision' };
    let combo: string | undefined;
    const eclipse = this.active('eclipse', tick).length > 0;
    if (eclipse) combo = this.combo(w, 'omen', s.x, s.y, s.z);
    else if (s.blessed > tick) combo = this.combo(w, 'saint', s.x, s.y, s.z);
    P.role[best] = 3;
    P.pious[best] = 1;
    P.love[best] = 1;
    P.fear[best] = eclipse ? 1 : P.fear[best];
    P.social[best] = Math.max(P.social[best], 0.8);
    w.civ.raiseProphet(best, tick, w.events, combo === 'Saint' ? 'saint' : eclipse ? 'doom' : 'vision');
    this.add('prophet', P.x[best], P.y[best], P.z[best], 12, tick, 80, 1, combo === 'Saint' ? 'saint' : eclipse ? 'omen' : '');
    w.civ.witness(s.x, s.y, s.z, s.radius + 20, eclipse ? 0.05 : 0.15, eclipse ? 0.3 : 0.04, 'vision', tick, s.name, 0);
    return { ok: true, message: `${w.civ.personName(best)} has seen your face`, combo };
  }

  private harmony(w: World, x: number, y: number, z: number): CastResult {
    const tick = w.tick;
    const tribes = new Set<number>();
    for (const s of w.civ.settlements) if (s.alive && dist(s.x, s.y, s.z, x, y, z) < 400) tribes.add(s.tribe);
    if (tribes.size === 0) return { ok: false, message: 'No people within reach' };
    const ended = w.civ.truce([...tribes], tick, w.events);
    const P = w.civ.people;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i] || !tribes.has(P.tribe[i])) continue;
      P.happiness[i] = Math.min(1, P.happiness[i] + 0.25);
    }
    this.add('harmony', x, y, z, 400, tick, 80);
    w.civ.witness(x, y, z, 400, 0.2, -0.05, 'harmony', tick, this.place(w, x, y, z), 0);
    return { ok: true, message: ended > 0 ? `${ended} war${ended > 1 ? 's' : ''} end in truce` : 'Peace settles over the land' };
  }

  private beacon(w: World, x: number, y: number, z: number): CastResult {
    const tick = w.tick;
    const until = tick + TICKS_PER_DAY * 3;
    w.animals.attractor = { x, y, z, cosR: Math.cos(280 / PLANET_RADIUS), until };
    const cell = w.planet.region.cellOf(x, y, z);
    w.civ.beacon = { x, y, z, cell, until: tick + TICKS_PER_YEAR };
    for (const s of w.civ.settlements) {
      if (s.alive && s.pop >= 14 && dist(s.x, s.y, s.z, x, y, z) < 900) s.colonyCooldown = Math.min(s.colonyCooldown, 80);
    }
    this.add('beacon', x, y, z, 280, tick, TICKS_PER_DAY * 3);
    w.civ.witness(x, y, z, 300, 0.1, 0.02, 'beacon', tick, this.place(w, x, y, z), 0);
    return { ok: true, message: '' };
  }

  private eclipse(w: World): CastResult {
    const tick = w.tick;
    if (this.active('eclipse', tick).length) return { ok: false, message: 'The sun is already hidden' };
    const dur = Math.round(TICKS_PER_DAY * 0.3);
    this.add('eclipse', 0, 1, 0, 0, tick, dur);
    w.civ.omenUntil = tick + dur;
    const P = w.civ.people;
    for (let i = 0; i < P.count; i++) {
      if (!P.alive[i]) continue;
      P.fear[i] = Math.min(1, P.fear[i] + 0.22 * (0.5 + P.pious[i]));
      P.love[i] = Math.min(1, P.love[i] + 0.05);
    }
    for (const t of w.civ.tribes) if (t.alive) t.religion.fear = Math.min(1, t.religion.fear + 0.2);
    w.events.emit(tick, 'omen', null, 0.85, { kind: 'eclipse' });
    return { ok: true, message: '' };
  }

  private sanctuary(w: World, x: number, y: number, z: number): CastResult {
    const tick = w.tick;
    const p = w.planet, pl = w.plants;
    const { cells, w: ws } = this.cellsNear(w, x, y, z, 25);
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      w.civ.sanctuary[c] = 1;
      // Ancient trees: the best-suited tree species rises to full density.
      let bestS = 2, bestV = -1;
      for (const s of [2, 3, 4]) { const v = pl.suitability(s, c, p.climate, p.terrain); if (v > bestV) { bestV = v; bestS = s; } }
      pl.density[c * 8 + bestS] = Math.max(pl.density[c * 8 + bestS], Math.min(1, 0.5 + ws[k] * 0.5));
      pl.bloom[c] = Math.max(pl.bloom[c], ws[k]);
    }
    const s = w.civ.nearestSettlement(x, y, z, 700);
    if (s) {
      const t = w.civ.tribes[s.tribe];
      t.religion.sacredSites.push({ x, y, z, origin: 'the sacred grove', tick, shrine: -1 });
      w.events.emit(tick, 'sacred-site', { x, y, z }, 0.55, { tribe: t.name, origin: 'the sacred grove', where: this.place(w, x, y, z) });
    }
    this.add('sanctuary', x, y, z, 25, tick, Number.MAX_SAFE_INTEGER);
    w.civ.witness(x, y, z, 100, 0.15, 0.02, 'grove', tick, this.place(w, x, y, z), 0);
    return { ok: true, message: '' };
  }

  // ------------------------------------------------------------------ tick
  tick(w: World): void {
    const tick = w.tick;
    const p = w.planet;
    const cl = p.climate;
    // Global forcing from ice ages and impact winters.
    let chill = 0;
    for (const e of this.effects) {
      if (e.power !== 'iceage' || e.end <= tick) continue;
      const dur = e.end - e.start;
      const t = (tick - e.start) / dur;
      const ramp = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.12);
      chill += 9 * e.strength * Math.max(0, ramp);
    }
    cl.forcing.transientOffset = -chill;
    for (const e of this.effects) if (e.power === 'iceage' && e.combo !== 'winter' && e.end === tick) w.events.emit(tick, 'thaw', null, 0.7, {});

    for (const e of this.effects) {
      if (e.end <= tick) continue;
      const age = tick - e.start;
      switch (e.power) {
        case 'lightning':
          if (e.phase > 0 && age % 3 === 2) {
            // Tempest: extra bolts around the first.
            const a = w.rng.range(0, Math.PI * 2), r = w.rng.range(4, e.radius);
            const o = [0, 0, 0];
            offsetDir(e.x, e.y, e.z, (Math.cos(a) * r) / PLANET_RADIUS, (Math.sin(a) * r) / PLANET_RADIUS, o);
            this.strike(w, o[0], o[1], o[2], 1);
            e.phase--;
          }
          break;
        case 'rain':
          if (tick % 8 === 0) {
            const { cells, w: ws } = this.cellsOf(w, e);
            const deluge = e.combo === 'deluge';
            for (let k = 0; k < cells.length; k++) {
              const c = cells[k];
              cl.rainBias[c] = Math.max(cl.rainBias[c], (deluge ? 4 : 2.4) * ws[k]);
              cl.soil[c] = Math.min(1, cl.soil[c] + 0.02 * ws[k]);
              w.fires.intensity[c] *= 1 - 0.5 * ws[k];
              if (deluge && p.terrain.elev[c] < 6 && p.terrain.oceanFrac[c] < 0.9) {
                const depth = (6 - p.terrain.elev[c]) * 0.25 * ws[k] + p.terrain.river[c] * 0.05;
                if (depth > this.flood[c]) this.flood[c] = Math.min(3, depth);
              }
            }
          }
          break;
        case 'drought':
          if (tick % 8 === 4) {
            const { cells, w: ws } = this.cellsOf(w, e);
            for (let k = 0; k < cells.length; k++) {
              const c = cells[k];
              cl.rainBias[c] = Math.min(cl.rainBias[c], -0.95 * ws[k]);
              cl.soil[c] *= 1 - 0.03 * ws[k];
            }
          }
          break;
        case 'volcano': this.tickVolcano(w, e, age); break;
        case 'tsunami': this.tickTsunami(w, e, age); break;
        case 'meteor':
          if (e.phase === 0 && age >= METEOR_FALL) this.impact(w, e);
          break;
        case 'locusts':
          if (tick % 4 === 0) {
            // Drift with the wind, wavering.
            const step = 1.1 / PLANET_RADIUS;
            const wob = Math.sin(age * 0.05) * 0.6;
            let nx = e.x + (e.dx + wob * (e.y * e.dz - e.z * e.dy)) * step;
            let ny = e.y + (e.dy + wob * (e.z * e.dx - e.x * e.dz)) * step;
            let nz = e.z + (e.dz + wob * (e.x * e.dy - e.y * e.dx)) * step;
            const l = Math.hypot(nx, ny, nz);
            nx /= l; ny /= l; nz /= l;
            e.x = nx; e.y = ny; e.z = nz;
            this.cellCache.delete(e.id);
            this.devour(w, e);
          }
          break;
        case 'beacon':
          if (w.animals.attractor && w.animals.attractor.until <= tick) w.animals.attractor = null;
          break;
      }
    }
    // Lava flows and cools.
    if (tick % 4 === 1) this.tickLava(w);
    // Floods recede.
    if (tick % 4 === 2) {
      const f = this.flood;
      for (let c = 0; c < f.length; c++) if (f[c] > 0) f[c] = f[c] < 0.02 ? 0 : f[c] * 0.965;
    }
    // Retire finished effects (keep briefly for fading visuals).
    if (tick % 32 === 0) {
      const before = this.effects.length;
      this.effects = this.effects.filter((e) => e.end > tick - 200);
      if (this.effects.length !== before) for (const id of [...this.cellCache.keys()]) if (!this.effects.some((e) => e.id === id)) this.cellCache.delete(id);
      if (w.civ.beacon && w.civ.beacon.until <= tick) w.civ.beacon = null;
    }
  }

  private devour(w: World, e: DivineEffect): void {
    const { cells, w: ws } = this.cellsOf(w, e);
    const pl = w.plants;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      const f = 1 - 0.12 * ws[k];
      pl.density[c * 8] *= f; // grass
      pl.density[c * 8 + 1] *= 1 - 0.06 * ws[k]; // shrubs
      pl.grazed[c] = Math.min(1, pl.grazed[c] + 0.1 * ws[k]);
    }
    for (const b of w.civ.buildings) {
      if (b.type !== 2 || b.ruin) continue;
      if (dist(b.x, b.y, b.z, e.x, e.y, e.z) < e.radius) b.growth *= 0.75;
    }
  }

  private tickVolcano(w: World, e: DivineEffect, age: number): void {
    const { x, y, z } = e;
    if (e.phase === 0) {
      // The mountain rises over VOLCANO_RISE ticks.
      const k = 1 / VOLCANO_RISE;
      w.terraform.deform(x, y, z, 45, (h, t) => {
        const cone = 30 * Math.pow(Math.max(0, 1 - t), 1.6);
        const crater = -9 * Math.max(0, 1 - (t / 0.13) ** 2);
        const target = Math.max(h, 2) + cone + crater;
        return h + (target - h) * k * (1 + age * k);
      });
      if (age % 6 === 5) w.civ.damageArea(x, y, z, 45, 0.5, 'earthquake', w.tick, w.rng, w.events, 0.04);
      if (age >= VOLCANO_RISE) {
        w.terraform.commit();
        e.phase = 1;
        w.civ.witness(x, y, z, 260, -0.05, 0.35, 'volcano', w.tick, this.place(w, x, y, z), 0);
      }
      return;
    }
    // Erupting: lava pours from the crater, ash rains over the land.
    const g = w.planet.region;
    const c = g.cellOf(x, y, z);
    if (w.tick % 4 === 0) this.lava[c] = Math.min(6, this.lava[c] + 0.9 * e.strength);
    if (w.tick % 16 === 0) {
      const ash = this.cellsNear(w, x, y, z, 260);
      const cl = w.planet.climate;
      for (let k = 0; k < ash.cells.length; k++) cl.ash[ash.cells[k]] = Math.min(1, cl.ash[ash.cells[k]] + ash.w[k] * 0.03);
    }
    // Volcanic lightning in the plume.
    if (w.rng.chance(0.08)) {
      const o = [0, 0, 0];
      offsetDir(x, y, z, w.rng.range(-12, 12) / PLANET_RADIUS, w.rng.range(-12, 12) / PLANET_RADIUS, o);
      w.weather.strikeLog.push({ x: o[0], y: o[1], z: o[2], power: 0.6 });
    }
    if (w.tick >= e.end - 1) e.phase = 2;
  }

  private tickLava(w: World): void {
    const L = this.lava;
    const p = w.planet, g = p.region, terr = p.terrain;
    for (let c = 0; c < L.length; c++) {
      const v = L[c];
      if (v <= 0.02) { if (v > 0) L[c] = 0; continue; }
      // Burn and destroy.
      if (v > 0.15) {
        w.plants.burn(c, Math.min(1, v * 0.4));
        w.fires.scar[c] = Math.min(1, w.fires.scar[c] + 0.08);
        const cx = g.centers[c * 3], cy = g.centers[c * 3 + 1], cz = g.centers[c * 3 + 2];
        if (w.tick % 16 === 1) {
          w.civ.damageArea(cx, cy, cz, g.spacing * PLANET_RADIUS * 0.6, 3, 'lava', w.tick, w.rng, w.events);
          w.animals.killNear(cx, cy, cz, g.spacing * PLANET_RADIUS * 0.6, 0.7, w.rng, false);
        }
        for (let k = 0; k < 4; k++) {
          const nb = g.neighbors[c * 8 + k];
          if (w.plants.fuel(nb) > 0.2 && w.rng.chance(0.03)) w.fires.ignite(nb, 0.6);
        }
      }
      // Flow downhill to the lowest neighbour.
      let best = -1, bestH = terr.elev[c] + v * 0.5;
      for (let k = 0; k < 8; k++) {
        const nb = g.neighbors[c * 8 + k];
        const hh = terr.elev[nb] + L[nb] * 0.5;
        if (hh < bestH) { bestH = hh; best = nb; }
      }
      if (best >= 0 && terr.oceanFrac[best] < 0.8) {
        const flow = v * 0.22;
        L[c] -= flow;
        L[best] += flow * 0.97;
      } else if (best >= 0) {
        // Lava meets the sea: steam and new rock.
        L[c] *= 0.9;
      }
      // Cooling; cooled lava leaves rich volcanic soil.
      L[c] *= 0.992;
      p.climate.soil[c] = Math.min(1, p.climate.soil[c] + 0.0015);
    }
  }

  private tickTsunami(w: World, e: DivineEffect, age: number): void {
    const r1 = age * TSUNAMI_SPEED, r0 = Math.max(0, r1 - TSUNAMI_SPEED);
    if (r0 > e.radius) return;
    const g = w.planet.region, terr = w.planet.terrain;
    const cosA = Math.cos(r0 / PLANET_RADIUS), cosB = Math.cos(r1 / PLANET_RADIUS);
    // Wave height decays with distance.
    const H = 10 * e.strength / Math.sqrt(1 + r1 / 40);
    let deaths = 0;
    for (let c = 0; c < g.count; c++) {
      const dot = g.centers[c * 3] * e.x + g.centers[c * 3 + 1] * e.y + g.centers[c * 3 + 2] * e.z;
      if (dot > cosA || dot <= cosB) continue;
      if (terr.oceanFrac[c] > 0.95) continue;
      const depth = H - Math.max(0, terr.minElev[c]);
      if (depth <= 0.2) continue;
      // Only land reachable from the sea: coastal cells or cells beside flooded ones.
      let reach = terr.coastal[c] === 1;
      if (!reach) for (let k = 0; k < 8; k++) if (this.flood[g.neighbors[c * 8 + k]] > 0.3) { reach = true; break; }
      if (!reach) continue;
      this.flood[c] = Math.max(this.flood[c], Math.min(4, depth));
      deaths += w.civ.floodCell(c, depth, w.planet, w.tick, w.rng, w.events, 'tsunami');
      const cx = g.centers[c * 3], cy = g.centers[c * 3 + 1], cz = g.centers[c * 3 + 2];
      w.animals.killNear(cx, cy, cz, g.spacing * PLANET_RADIUS * 0.7, Math.min(0.8, depth * 0.15), w.rng);
      w.plants.burn(c, Math.min(0.6, depth * 0.1));
      w.planet.climate.soil[c] = Math.max(0, w.planet.climate.soil[c] - 0.2);
      w.fires.intensity[c] = 0;
    }
    e.count += deaths;
    if (r1 + TSUNAMI_SPEED > e.radius && e.phase === 0) {
      e.phase = 1;
      w.civ.witness(e.x, e.y, e.z, e.radius + 60, -0.05, 0.3, 'tsunami', w.tick, this.place(w, e.x, e.y, e.z), e.count);
      w.events.emit(w.tick, 'flood', { x: e.x, y: e.y, z: e.z }, 0.6, { where: this.place(w, e.x, e.y, e.z), deaths: e.count, cause: 'tsunami' });
    }
  }

  /** Cooldown remaining (ticks) per power, for the UI. */
  cooldowns(tick: number): number[] {
    return this.ready.map((r) => Math.max(0, r - tick));
  }
}

