/**
 * Procedural terrain generation.
 *
 * Pipeline:
 *  1. Tectonic plates – a warped spherical Voronoi diagram. Each plate is
 *     continental or oceanic and rotates about its own Euler pole. Relative
 *     motion at plate boundaries classifies them as convergent (mountain
 *     ranges, trenches, island arcs) or divergent (rifts, mid-ocean ridges).
 *  2. Continents – domain-warped fBm modulates the plate crust so coastlines
 *     are organic rather than Voronoi-straight.
 *  3. Relief – ridged multifractal peaks along convergent boundaries plus
 *     masked interior highlands; small-scale fBm detail.
 *  4. Sea level – chosen as the elevation quantile giving the preset's ocean
 *     fraction, then a non-linear curve maps normalised elevation to world
 *     units with continental shelves and abyssal plains.
 *  5. Hydraulic erosion – particle droplets advected over the sphere in 3D.
 */
import { Noise3 } from '../../core/noise';
import { Rng } from '../../core/rng';
import { MAX_ELEVATION, MIN_ELEVATION } from '../constants';
import { CellGrid, VertexGrid, dirToFaceAB } from './cubesphere';
import type { WorldParams } from './presets';

export interface Plate {
  x: number; y: number; z: number;
  continental: boolean;
  base: number;
  /** Angular velocity vector (Euler pole × rate). */
  wx: number; wy: number; wz: number;
  weight: number;
}

export interface TerrainResult {
  heights: Float32Array;
  plates: Plate[];
  /** Per region cell: dominant plate index. */
  plateOf: Uint8Array;
  /** Per region cell: 0..1 tectonic stress (convergent boundary proximity). */
  stress: Float32Array;
  /** Per region cell: 0..1 metal ore richness. */
  ore: Float32Array;
}

export type ProgressFn = (stage: string, frac: number) => void;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Maps normalised elevation (0 = sea level) to world units. */
export function elevationToHeight(e: number): number {
  if (e >= 0) {
    const t = Math.tanh(e * 1.1);
    return Math.min(MAX_ELEVATION, MAX_ELEVATION * Math.pow(t, 1.25));
  }
  const d = -e;
  if (d < 0.07) return -3.2 * (d / 0.07);
  const deep = -3.2 - (-MIN_ELEVATION - 4) * (1 - Math.exp(-(d - 0.07) * 4.2));
  return Math.max(MIN_ELEVATION, deep);
}

export function generatePlates(rng: Rng, params: WorldParams): Plate[] {
  const plates: Plate[] = [];
  for (let i = 0; i < params.plates; i++) {
    const z = rng.range(-1, 1);
    const t = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    const pz = rng.range(-1, 1), pt = rng.range(0, Math.PI * 2), pr = Math.sqrt(1 - pz * pz);
    const rate = rng.range(0.45, 1.0);
    plates.push({
      x: r * Math.cos(t), y: z, z: r * Math.sin(t),
      continental: false,
      base: 0,
      wx: pr * Math.cos(pt) * rate, wy: pz * rate, wz: pr * Math.sin(pt) * rate,
      weight: rng.range(0.8, 1.25),
    });
  }
  // Continental plates chosen by jittered farthest-point sampling so that
  // continents spread around the globe instead of clumping together.
  const nCont = Math.max(2, Math.round(params.plates * params.continentalFraction));
  const chosen: number[] = [rng.int(0, plates.length)];
  while (chosen.length < nCont) {
    let best = -1, bestScore = -1;
    for (let i = 0; i < plates.length; i++) {
      if (chosen.includes(i)) continue;
      let minD = 9;
      for (const c of chosen) {
        const d = Math.acos(Math.max(-1, Math.min(1, plates[i].x * plates[c].x + plates[i].y * plates[c].y + plates[i].z * plates[c].z)));
        minD = Math.min(minD, d);
      }
      const score = minD * rng.range(0.6, 1.0);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    chosen.push(best);
  }
  for (let i = 0; i < plates.length; i++) {
    const cont = chosen.includes(i);
    plates[i].continental = cont;
    plates[i].base = cont ? rng.range(0.1, 0.22) : rng.range(-0.28, -0.16);
  }
  return plates;
}

/** Coarse-grid resolution for the low-frequency terrain fields. */
const COARSE_DIV = 4;

export function generateTerrain(
  seed: number,
  params: WorldParams,
  grid: VertexGrid,
  region: CellGrid,
  progress: ProgressFn = () => {},
): TerrainResult {
  const rng = new Rng(seed ^ 0x7e11a1);
  const noise = new Noise3(seed ^ 0x51ab);
  const noiseW = new Noise3(seed ^ 0x9a3);
  const plates = generatePlates(rng, params);
  const P = plates.length;
  const px = new Float64Array(P), py = new Float64Array(P), pz = new Float64Array(P), pw = new Float64Array(P);
  for (let i = 0; i < P; i++) { px[i] = plates[i].x; py[i] = plates[i].y; pz[i] = plates[i].z; pw[i] = plates[i].weight; }

  const n = grid.n;
  const cn = Math.max(8, Math.floor(n / COARSE_DIV));
  const coarse = new VertexGrid(cn);
  // Low-frequency fields on the coarse grid.
  const cLow = new Float32Array(coarse.count);   // crust + continental noise
  const cCC = new Float32Array(coarse.count);    // continent–continent collision weight
  const cOC = new Float32Array(coarse.count);    // continental-margin range weight
  const cArc = new Float32Array(coarse.count);   // oceanic island arc weight
  const cDent = new Float32Array(coarse.count);  // trenches and rifts (negative relief)
  const cHM = new Float32Array(coarse.count);    // interior highland mask
  const cStress = new Float32Array(coarse.count);
  const cPlate = new Uint8Array(coarse.count);
  const d = [0, 0, 0];
  const cf = params.continentFreq;
  const warpAmp = params.warp * 0.3;

  for (let f = 0; f < 6; f++) {
    progress('Drifting tectonic plates', f / 6);
    for (let j = 0; j <= cn; j++) {
      for (let i = 0; i <= cn; i++) {
        coarse.dirOf(f, i, j, d);
        const x = d[0], y = d[1], z = d[2];
        const wx = noiseW.fbm(x * 1.7 + 11.1, y * 1.7, z * 1.7, 3);
        const wy = noiseW.fbm(x * 1.7, y * 1.7 + 23.7, z * 1.7, 3);
        const wz = noiseW.fbm(x * 1.7, y * 1.7, z * 1.7 + 37.3, 3);
        let qx = x + wx * warpAmp, qy = y + wy * warpAmp, qz = z + wz * warpAmp;
        const ql = 1 / Math.hypot(qx, qy, qz);
        qx *= ql; qy *= ql; qz *= ql;

        let b1 = 0, b2 = 0, d1 = 1e9, d2 = 1e9;
        for (let p = 0; p < P; p++) {
          const dot = qx * px[p] + qy * py[p] + qz * pz[p];
          const ang = Math.acos(dot > 1 ? 1 : dot < -1 ? -1 : dot) / pw[p];
          if (ang < d1) { d2 = d1; b2 = b1; d1 = ang; b1 = p; }
          else if (ang < d2) { d2 = ang; b2 = p; }
        }
        const bd = (d2 - d1) * 0.5;
        const A = plates[b1], B = plates[b2];
        let tx = B.x - A.x, ty = B.y - A.y, tz = B.z - A.z;
        const td = tx * x + ty * y + tz * z;
        tx -= td * x; ty -= td * y; tz -= td * z;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const vax = A.wy * z - A.wz * y, vay = A.wz * x - A.wx * z, vaz = A.wx * y - A.wy * x;
        const vbx = B.wy * z - B.wz * y, vby = B.wz * x - B.wx * z, vbz = B.wx * y - B.wy * x;
        const conv = (vax - vbx) * tx + (vay - vby) * ty + (vaz - vbz) * tz;

        const blend = smoothstep(0.0, 0.2, bd);
        let e = A.base * (0.5 + 0.5 * blend) + B.base * (0.5 - 0.5 * blend);
        e += noise.fbm(qx * cf, qy * cf, qz * cf, 6) * 0.5;
        e += noise.fbm(qx * cf * 0.45 + 5.2, qy * cf * 0.45, qz * cf * 0.45, 3) * 0.3;

        const k = coarse.index(f, i, j);
        let stress = 0;
        if (conv > 0) {
          const c = Math.min(1.5, 0.35 + conv * 1.3);
          if (A.continental && B.continental) {
            cCC[k] = c * Math.exp(-((bd / 0.1) ** 2));
            stress = cCC[k];
          } else if (A.continental && !B.continental) {
            cOC[k] = c * Math.exp(-(((bd - 0.055) / 0.055) ** 2));
            stress = c * Math.exp(-((bd / 0.08) ** 2));
          } else if (!A.continental && B.continental) {
            cDent[k] = c * 0.3 * Math.exp(-((bd / 0.03) ** 2));
            stress = c * Math.exp(-((bd / 0.06) ** 2));
          } else {
            cArc[k] = c * Math.exp(-(((bd - 0.035) / 0.025) ** 2));
            stress = cArc[k] * 0.8;
          }
        } else {
          const c = Math.min(1.2, -conv);
          if (A.continental || B.continental) cDent[k] = c * 0.1 * Math.exp(-((bd / 0.025) ** 2));
          else e += c * 0.14 * Math.exp(-((bd / 0.035) ** 2));
          stress = c * 0.3 * Math.exp(-((bd / 0.03) ** 2));
        }
        cLow[k] = e;
        cHM[k] = smoothstep(0.02, 0.4, noise.fbm(x * 2.1 + 3.7, y * 2.1, z * 2.1 - 1.3, 3));
        cStress[k] = stress;
        cPlate[k] = b1;
      }
    }
  }

  // Full-resolution detail, bilinear-upsampling the coarse fields.
  const elev = new Float32Array(grid.count);
  const mtn = params.mountains;
  const div = n / cn;
  const cs = coarse.side, cfs = coarse.faceSize;
  for (let f = 0; f < 6; f++) {
    progress('Raising mountains', f / 6);
    for (let j = 0; j <= n; j++) {
      const gy = j / div;
      let j0 = Math.floor(gy); if (j0 >= cn) j0 = cn - 1;
      const ty = gy - j0;
      for (let i = 0; i <= n; i++) {
        const gx = i / div;
        let i0 = Math.floor(gx); if (i0 >= cn) i0 = cn - 1;
        const tx = gx - i0;
        const b = f * cfs + j0 * cs + i0;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const b1 = b + 1, b2 = b + cs, b3 = b + cs + 1;
        let e = cLow[b] * w00 + cLow[b1] * w10 + cLow[b2] * w01 + cLow[b3] * w11;
        const cc = cCC[b] * w00 + cCC[b1] * w10 + cCC[b2] * w01 + cCC[b3] * w11;
        const oc = cOC[b] * w00 + cOC[b1] * w10 + cOC[b2] * w01 + cOC[b3] * w11;
        const arc = cArc[b] * w00 + cArc[b1] * w10 + cArc[b2] * w01 + cArc[b3] * w11;
        const dent = cDent[b] * w00 + cDent[b1] * w10 + cDent[b2] * w01 + cDent[b3] * w11;
        const hm = cHM[b] * w00 + cHM[b1] * w10 + cHM[b2] * w01 + cHM[b3] * w11;
        grid.dirOf(f, i, j, d);
        const x = d[0], y = d[1], z = d[2];
        if (cc > 0.01 || oc > 0.01) {
          const r = noise.ridged(x * 7.5, y * 7.5, z * 7.5, 7);
          e += cc * (0.3 + r * 1.25) * mtn + oc * (0.2 + r * 1.0) * mtn;
        }
        if (arc > 0.02) {
          // Volcanic island chains: rounded cones rather than needles.
          const spots = noise.fbm(x * 11, y * 11, z * 11, 3) * 0.5 + 0.5;
          const cone = Math.max(0, spots - 0.52) / 0.48;
          e += arc * Math.sqrt(cone) * 0.55 * mtn;
        }
        e -= dent;
        if (hm > 0.01) e += hm * (noise.ridged(x * 5.3 + 1.1, y * 5.3, z * 5.3, 6) * 0.5 - 0.07) * mtn;
        e += noise.fbm(x * 22, y * 22, z * 22, 4) * 0.035;
        elev[grid.index(f, i, j)] = e;
      }
    }
  }

  progress('Finding the shorelines', 0);
  const sample: number[] = [];
  for (let k = 0; k < grid.count; k += 7) sample.push(elev[k]);
  sample.sort((a, b) => a - b);
  const seaLevel = sample[Math.floor(sample.length * params.oceanFraction)];

  const heights = new Float32Array(grid.count);
  for (let k = 0; k < grid.count; k++) heights[k] = elevationToHeight(elev[k] - seaLevel);
  grid.syncEdges(heights);

  progress('Eroding mountains', 0);
  erode(heights, grid, seed, params.erosion * 1000, (fr) => progress('Eroding mountains', fr));
  grid.syncEdges(heights);

  const plateOf = new Uint8Array(region.count);
  const stress = new Float32Array(region.count);
  const ore = new Float32Array(region.count);
  for (let c = 0; c < region.count; c++) {
    const x = region.centers[c * 3], y = region.centers[c * 3 + 1], z = region.centers[c * 3 + 2];
    const fab = dirToFaceAB(x, y, z);
    const fi = Math.round((fab.a + 1) * 0.5 * cn), fj = Math.round((fab.b + 1) * 0.5 * cn);
    const vi = coarse.index(fab.face, fi, fj);
    plateOf[c] = cPlate[vi];
    stress[c] = Math.min(1, cStress[vi]);
    const oreN = noise.ridged(x * 9 + 40, y * 9, z * 9, 3);
    ore[c] = Math.min(1, Math.max(0, stress[c] * 0.6 + (oreN - 0.55) * 1.6));
  }
  progress('Terrain complete', 1);
  return { heights, plates, plateOf, stress, ore };
}

/**
 * Particle hydraulic erosion on the sphere. Droplets move in 3D over the unit
 * sphere so they cross cube-face seams without artefacts; erosion/deposition
 * writes into the 4 surrounding samples of whichever face they are over.
 */
export function erode(heights: Float32Array, grid: VertexGrid, seed: number, droplets: number, progress: (f: number) => void): void {
  const rng = new Rng(seed ^ 0xe20de);
  const n = grid.n;
  const side = grid.side;
  const fs = grid.faceSize;
  const step = (2 / n) * 0.75; // param-space step ≈ 0.75 grid cells, used as angle on unit sphere
  const eps = 1.2 / n;
  const inertia = 0.3;
  const capacityK = 6;
  const minCapacity = 0.02;
  const erodeK = 0.25;
  const depositK = 0.2;
  const evaporate = 0.03;
  const gravity = 6;
  const maxSteps = 48;

  // Returns bilinear height; also leaves face/i0/j0/tx/ty in closure vars.
  let lf = 0, li = 0, lj = 0, ltx = 0, lty = 0;
  const heightAt = (x: number, y: number, z: number): number => {
    const f = dirToFaceAB(x, y, z);
    let fx = (f.a + 1) * 0.5 * n, fy = (f.b + 1) * 0.5 * n;
    if (fx < 0) fx = 0; else if (fx > n - 1e-4) fx = n - 1e-4;
    if (fy < 0) fy = 0; else if (fy > n - 1e-4) fy = n - 1e-4;
    const i0 = fx | 0, j0 = fy | 0;
    const tx = fx - i0, ty = fy - j0;
    lf = f.face; li = i0; lj = j0; ltx = tx; lty = ty;
    const b = f.face * fs + j0 * side + i0;
    return (heights[b] * (1 - tx) + heights[b + 1] * tx) * (1 - ty) + (heights[b + side] * (1 - tx) + heights[b + side + 1] * tx) * ty;
  };

  const chunk = Math.max(1, Math.floor(droplets / 20));
  for (let dI = 0; dI < droplets; dI++) {
    if (dI % chunk === 0) progress(dI / droplets);
    // Random start on sphere.
    const uz = rng.range(-1, 1), ut = rng.range(0, Math.PI * 2), ur = Math.sqrt(1 - uz * uz);
    let x = ur * Math.cos(ut), y = uz, z = ur * Math.sin(ut);
    let h = heightAt(x, y, z);
    if (h < 0.5) continue; // only erode land
    let vx = 0, vy = 0, vz = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;
    for (let s = 0; s < maxSteps; s++) {
      // Tangent frame.
      let ex: number, ey: number, ez: number;
      if (Math.abs(y) < 0.99) { ex = -z; ey = 0; ez = x; } else { ex = 0; ey = z; ez = -y; }
      let el = 1 / Math.hypot(ex, ey, ez); ex *= el; ey *= el; ez *= el;
      const nx = y * ez - z * ey, ny = z * ex - x * ez, nz = x * ey - y * ex;
      const hE = heightAt(x + ex * eps, y + ey * eps, z + ez * eps);
      const hW = heightAt(x - ex * eps, y - ey * eps, z - ez * eps);
      const hN = heightAt(x + nx * eps, y + ny * eps, z + nz * eps);
      const hS = heightAt(x - nx * eps, y - ny * eps, z - nz * eps);
      const gE = (hE - hW), gN = (hN - hS);
      // Downhill direction in 3D.
      let dx = -(gE * ex + gN * nx), dy = -(gE * ey + gN * ny), dz = -(gE * ez + gN * nz);
      vx = vx * inertia + dx * (1 - inertia);
      vy = vy * inertia + dy * (1 - inertia);
      vz = vz * inertia + dz * (1 - inertia);
      // Remove radial component and normalise.
      const rd = vx * x + vy * y + vz * z;
      vx -= rd * x; vy -= rd * y; vz -= rd * z;
      const vl = Math.hypot(vx, vy, vz);
      if (vl < 1e-9) break;
      vx /= vl; vy /= vl; vz /= vl;
      // Current cell for erosion/deposition.
      const hOld = heightAt(x, y, z);
      const cf = lf, ci = li, cj = lj, ctx = ltx, cty = lty;
      // Move.
      let nx2 = x + vx * step, ny2 = y + vy * step, nz2 = z + vz * step;
      el = 1 / Math.hypot(nx2, ny2, nz2);
      nx2 *= el; ny2 *= el; nz2 *= el;
      const hNew = heightAt(nx2, ny2, nz2);
      const dh = hNew - hOld;
      const cap = Math.max(-dh, minCapacity) * speed * water * capacityK;
      const b = cf * fs + cj * side + ci;
      const w00 = (1 - ctx) * (1 - cty), w10 = ctx * (1 - cty), w01 = (1 - ctx) * cty, w11 = ctx * cty;
      if (sediment > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * depositK;
        sediment -= amt;
        heights[b] += amt * w00; heights[b + 1] += amt * w10;
        heights[b + side] += amt * w01; heights[b + side + 1] += amt * w11;
      } else {
        const amt = Math.min((cap - sediment) * erodeK, -dh);
        heights[b] -= amt * w00; heights[b + 1] -= amt * w10;
        heights[b + side] -= amt * w01; heights[b + side + 1] -= amt * w11;
        sediment += amt;
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * -gravity * 0.1 + 0.01));
      water *= 1 - evaporate;
      x = nx2; y = ny2; z = nz2;
      h = hNew;
      if (h < -0.5) break; // reached the sea
    }
  }
  progress(1);
}
