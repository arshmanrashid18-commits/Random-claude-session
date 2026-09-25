/**
 * Named camera viewpoints used by the screenshot harness, the title screen and
 * the auto-director. Each viewpoint searches the live world data for a fitting
 * location (a coast, a mountain range, a polar night...) and sets the local
 * time of day.
 */
import * as THREE from 'three';
import type { GameRenderer } from './renderer';
import { dirToFaceAB } from '../sim/planet/cubesphere';

export type ViewpointId = 'orbit' | 'terminator' | 'coast' | 'mountains' | 'forest' | 'ground' | 'night' | 'aurora' | 'storm' | 'village' | 'volcano' | 'wildlife';

export interface Viewpoint {
  focus: THREE.Vector3;
  distance: number;
  heading: number;
  tiltOffset: number;
  /** Local solar time at the focus: 0 midnight, 0.5 noon. */
  localTime: number | null;
}

/** Day fraction such that `localTime` holds at the focus direction. */
export function dayFracForLocalTime(focus: THREE.Vector3, localTime: number): number {
  // Sun hour angle convention from sunDirection(): x = cos(h), z = -sin(h).
  const lon = Math.atan2(-focus.z, focus.x);
  let h = lon + (localTime - 0.5) * Math.PI * 2;
  h = ((h % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return h / (Math.PI * 2);
}

function fibonacciDirs(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = ga * i;
    out.push(new THREE.Vector3(Math.cos(t) * r, y, Math.sin(t) * r));
  }
  return out;
}

/** Score candidate points on the sphere and return the best direction. */
function findBest(r: GameRenderer, score: (d: THREE.Vector3, h: number) => number, samples = 6000): THREE.Vector3 {
  let best = new THREE.Vector3(1, 0, 0), bestS = -Infinity;
  for (const d of fibonacciDirs(samples)) {
    const h = r.data.heightAt(d.x, d.y, d.z);
    const s = score(d, h);
    if (s > bestS) { bestS = s; best = d; }
  }
  return best;
}

function climateAt(r: GameRenderer, d: THREE.Vector3): { temp: number; moist: number; snow: number; cloud: number } {
  const n = r.data.regionN;
  const P = n + 2;
  const ax = Math.abs(d.x), ay = Math.abs(d.y), az = Math.abs(d.z);
  let face: number, u: number, v: number;
  if (ax >= ay && ax >= az) { if (d.x > 0) { face = 0; u = -d.z / ax; v = d.y / ax; } else { face = 1; u = d.z / ax; v = d.y / ax; } }
  else if (ay >= az) { if (d.y > 0) { face = 2; u = d.x / ay; v = -d.z / ay; } else { face = 3; u = d.x / ay; v = d.z / ay; } }
  else { if (d.z > 0) { face = 4; u = d.x / az; v = d.y / az; } else { face = 5; u = -d.x / az; v = d.y / az; } }
  const a = Math.atan(u) * 4 / Math.PI, b = Math.atan(v) * 4 / Math.PI;
  const i = Math.min(n - 1, Math.max(0, Math.floor((a + 1) * 0.5 * n))) + 1;
  const j = Math.min(n - 1, Math.max(0, Math.floor((b + 1) * 0.5 * n))) + 1;
  const o = (face * P * P + j * P + i) * 4;
  const c = r.data.climateCPU;
  return { temp: c[o] / 255 * 80 - 40, moist: c[o + 1] / 255 * 4, snow: c[o + 2] / 255, cloud: c[o + 3] / 255 };
}

function vegAt(r: GameRenderer, d: THREE.Vector3): { grass: number; trees: number } {
  const f = dirFace(d);
  const vA = r.data.vegACPU, vB = r.data.vegBCPU;
  const grass = r.data.sampleRegion(vA, f.face, f.a, f.b, 0);
  const trees = r.data.sampleRegion(vA, f.face, f.a, f.b, 2) + r.data.sampleRegion(vA, f.face, f.a, f.b, 3) + r.data.sampleRegion(vB, f.face, f.a, f.b, 0);
  return { grass, trees };
}

function dirFace(d: THREE.Vector3): { face: number; a: number; b: number } {
  const r = dirToFaceAB(d.x, d.y, d.z);
  return { face: r.face, a: r.a, b: r.b };
}

function relief(r: GameRenderer, d: THREE.Vector3, eps: number): number {
  const t1 = new THREE.Vector3(d.z, 0, -d.x).normalize();
  const t2 = new THREE.Vector3().crossVectors(d, t1);
  let mx = -1e9, mn = 1e9;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const p = d.clone().addScaledVector(t1, Math.cos(a) * eps).addScaledVector(t2, Math.sin(a) * eps).normalize();
    const h = r.data.heightAt(p.x, p.y, p.z);
    mx = Math.max(mx, h);
    mn = Math.min(mn, h);
  }
  return mx - mn;
}

export function computeViewpoint(r: GameRenderer, id: ViewpointId): Viewpoint {
  switch (id) {
    case 'orbit': {
      // Frame the largest landmass in daylight.
      const f = findBest(r, (d, h) => (h > 0 ? 1 : 0) + Math.min(0, d.y * 0.2) - Math.abs(d.y) * 0.4 + relief(r, d, 0.25) * 0.004, 1500);
      return { focus: f, distance: 3300, heading: 0, tiltOffset: 0, localTime: 0.42 };
    }
    case 'terminator': {
      const f = findBest(r, (d, h) => (h > 0 ? 1 : 0) - Math.abs(d.y) * 0.6, 1500);
      return { focus: f, distance: 2600, heading: 0.6, tiltOffset: 0.15, localTime: 0.745 };
    }
    case 'coast': {
      // A green, sheltered shore with some relief, under a clear sky.
      const f = findBest(r, (d, h) => {
        if (Math.abs(h) > 3) return -1e9;
        const rel = relief(r, d, 0.012);
        const c = climateAt(r, d);
        const v = vegAt(r, d);
        return Math.min(rel, 14) * 0.25 + v.trees * 1.5 + v.grass - c.cloud * 3 - Math.abs(c.temp - 22) * 0.05 - Math.abs(d.y) * 2;
      });
      return { focus: f, distance: 70, heading: 1.2, tiltOffset: 0.0, localTime: 0.64 };
    }
    case 'mountains': {
      // High, rugged, clear-skied and not too far toward the poles.
      const f = findBest(r, (d, h) => h + relief(r, d, 0.02) * 0.8 - Math.abs(d.y) * 16 - climateAt(r, d).cloud * 12);
      return { focus: f, distance: 190, heading: 2.2, tiltOffset: 0.7, localTime: 0.6 };
    }
    case 'forest': {
      // The densest woodland on gentle ground.
      const f = findBest(r, (d, h) => {
        if (h < 1.5 || h > 26) return -1e9;
        const c = climateAt(r, d);
        const v = vegAt(r, d);
        return v.trees * 6 - Math.min(relief(r, d, 0.01), 10) * 0.15 - c.cloud * 2 - Math.abs(d.y) * 0.5;
      });
      return { focus: f, distance: 55, heading: 0.4, tiltOffset: -0.05, localTime: 0.38 };
    }
    case 'ground': {
      const f = findBest(r, (d, h) => {
        if (h < 2 || h > 20) return -1e9;
        const c = climateAt(r, d);
        const v = vegAt(r, d);
        // An open meadow with a few trees around, not a dense forest.
        return v.grass * 4 - Math.abs(v.trees - 0.35) * 3 - relief(r, d, 0.008) * 0.6 + relief(r, d, 0.04) * 0.1 - Math.abs(c.temp - 17) * 0.15;
      });
      return { focus: f, distance: 30, heading: 0.9, tiltOffset: -0.12, localTime: 0.36 };
    }
    case 'night': {
      const f = findBest(r, (d, h) => (h > 0 ? 1 : 0) - Math.abs(d.y) * 0.5 + relief(r, d, 0.1) * 0.01, 1500);
      return { focus: f, distance: 1700, heading: 0.3, tiltOffset: 0.25, localTime: 0.02 };
    }
    case 'aurora': {
      const f = findBest(r, (d) => (d.y > 0 ? d.y : -1) - Math.abs(d.y - 0.85), 1500);
      return { focus: f, distance: 1250, heading: Math.PI, tiltOffset: 0.35, localTime: 0.0 };
    }
    case 'storm': {
      // The strongest hurricane if one is spinning, else the cloudiest band.
      const hur = r.storms.filter((st) => st.type === 1).sort((a, b) => b.intensity - a.intensity)[0];
      if (hur) return { focus: new THREE.Vector3(hur.x, hur.y, hur.z).normalize(), distance: 900, heading: 0.2, tiltOffset: 0.1, localTime: 0.55 };
      const f = findBest(r, (d) => climateAt(r, d).cloud * 3 - Math.abs(Math.abs(d.y) - 0.3), 2000);
      return { focus: f, distance: 1100, heading: 0.2, tiltOffset: 0.1, localTime: 0.45 };
    }
    case 'wildlife': {
      const f = r.creatures.densestSpot() ?? findBest(r, (_d, h) => (h > 2 ? 1 : 0), 400);
      return { focus: f, distance: 34, heading: 1.8, tiltOffset: 0.0, localTime: 0.4 };
    }
    case 'village': {
      const civ = r.buildings.latest;
      const best = civ?.settlements.filter((st) => st.alive).sort((a, b) => b.pop - a.pop)[0];
      if (best) {
        const f = new THREE.Vector3(best.x, best.y, best.z).normalize();
        return { focus: f, distance: 36 + best.radius * 0.9, heading: 2.4, tiltOffset: 0.05, localTime: 0.37 };
      }
      const f = findBest(r, (d, h) => (h > 2 ? 1 : 0) - Math.abs(d.y), 800);
      return { focus: f, distance: 120, heading: 0.5, tiltOffset: 0, localTime: 0.4 };
    }
    case 'volcano': {
      // An erupting volcano (divine or otherwise), framed at dusk for the glow.
      const v = r.effects.find((e) => e.power === 'volcano');
      if (v) return { focus: new THREE.Vector3(v.x, v.y, v.z).normalize(), distance: 150, heading: 2.6, tiltOffset: 0.02, localTime: 0.76 };
      const f = findBest(r, (d, h) => (h > 2 ? 1 : 0) - Math.abs(d.y), 800);
      return { focus: f, distance: 120, heading: 0.5, tiltOffset: 0, localTime: 0.4 };
    }
    default: {
      const f = findBest(r, (d, h) => (h > 2 ? 1 : 0) - Math.abs(d.y), 800);
      return { focus: f, distance: 120, heading: 0.5, tiltOffset: 0, localTime: 0.4 };
    }
  }
}

export function applyViewpoint(r: GameRenderer, vp: Viewpoint): void {
  r.camera.cutTo({ focus: vp.focus, distance: vp.distance, heading: vp.heading, tiltOffset: vp.tiltOffset });
  // A cut is instant: re-place the vegetation around the new focus right away.
  r.vegetation.invalidate();
  if (vp.localTime !== null) {
    r.timeOfDayOverride = dayFracForLocalTime(vp.focus, vp.localTime);
  } else {
    r.timeOfDayOverride = null;
  }
}
