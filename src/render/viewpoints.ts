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
      const f = findBest(r, (d, h) => {
        if (Math.abs(h) > 3) return -1e9;
        const rel = relief(r, d, 0.012);
        const c = climateAt(r, d);
        return rel * 0.6 - Math.abs(c.temp - 20) * 0.05 - Math.abs(d.y) * 2;
      });
      return { focus: f, distance: 70, heading: 1.2, tiltOffset: 0.0, localTime: 0.66 };
    }
    case 'mountains': {
      const f = findBest(r, (d, h) => h + relief(r, d, 0.02) * 0.8 - Math.abs(d.y) * 10);
      return { focus: f, distance: 230, heading: 2.2, tiltOffset: -0.05, localTime: 0.7 };
    }
    case 'forest': {
      const f = findBest(r, (d, h) => {
        if (h < 1.5) return -1e9;
        const c = climateAt(r, d);
        return c.moist * 2 - Math.abs(c.temp - 16) * 0.2 + relief(r, d, 0.015) * 0.1;
      });
      return { focus: f, distance: 60, heading: 0.4, tiltOffset: 0.0, localTime: 0.38 };
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
      const f = findBest(r, (d) => climateAt(r, d).cloud * 3 - Math.abs(Math.abs(d.y) - 0.3), 2000);
      return { focus: f, distance: 1100, heading: 0.2, tiltOffset: 0.1, localTime: 0.45 };
    }
    case 'wildlife': {
      const f = r.creatures.densestSpot() ?? findBest(r, (_d, h) => (h > 2 ? 1 : 0), 400);
      return { focus: f, distance: 34, heading: 1.8, tiltOffset: 0.0, localTime: 0.4 };
    }
    case 'village':
    case 'volcano':
    default: {
      const f = findBest(r, (d, h) => (h > 2 ? 1 : 0) - Math.abs(d.y), 800);
      return { focus: f, distance: 120, heading: 0.5, tiltOffset: 0, localTime: 0.4 };
    }
  }
}

export function applyViewpoint(r: GameRenderer, vp: Viewpoint): void {
  r.camera.cutTo({ focus: vp.focus, distance: vp.distance, heading: vp.heading, tiltOffset: vp.tiltOffset });
  if (vp.localTime !== null) {
    r.timeOfDayOverride = dayFracForLocalTime(vp.focus, vp.localTime);
  } else {
    r.timeOfDayOverride = null;
  }
}
