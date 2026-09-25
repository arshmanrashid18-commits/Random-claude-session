/**
 * Exact CPU port of the GLSL ground-height function (src/render/glsl/common.ts:
 * groundHeight = Catmull-Rom heightmap + Ashima simplex detail). Static objects
 * (trees, rocks, buildings) are placed with this so they sit precisely on the
 * rendered terrain without per-vertex GPU height evaluation.
 */
import { dirToFaceAB } from '../sim/planet/cubesphere';
import { PLANET_RADIUS } from '../sim/constants';

const mod289 = (x: number) => x - Math.floor(x * (1 / 289)) * 289;
const permute = (x: number) => mod289((x * 34 + 10) * x);
const tis = (r: number) => 1.79284291400159 - 0.85373472095314 * r;
const N7 = Math.fround(0.142857142857);
const N7x2 = Math.fround(N7 * 2);
const N7y = Math.fround(Math.fround(N7 * 0.5) - 1);

/** Ashima Arts / Gustavson 3D simplex noise, matching the GLSL variant (0.5 falloff, ×105). */
export function snoiseA(vx: number, vy: number, vz: number): number {
  const C1 = 1 / 6, C2 = 1 / 3;
  const s = (vx + vy + vz) * C2;
  let ix = Math.floor(vx + s), iy = Math.floor(vy + s), iz = Math.floor(vz + s);
  const t = (ix + iy + iz) * C1;
  const x0x = vx - ix + t, x0y = vy - iy + t, x0z = vz - iz + t;
  const gx = x0x >= x0y ? 1 : 0, gy = x0y >= x0z ? 1 : 0, gz = x0z >= x0x ? 1 : 0;
  const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
  const i1x = Math.min(gx, lz), i1y = Math.min(gy, lx), i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz), i2y = Math.max(gy, lx), i2z = Math.max(gz, ly);
  const x1x = x0x - i1x + C1, x1y = x0y - i1y + C1, x1z = x0z - i1z + C1;
  const x2x = x0x - i2x + C2, x2y = x0y - i2y + C2, x2z = x0z - i2z + C2;
  const x3x = x0x - 0.5, x3y = x0y - 0.5, x3z = x0z - 0.5;
  ix = mod289(ix); iy = mod289(iy); iz = mod289(iz);
  const p0 = permute(permute(permute(iz) + iy) + ix);
  const p1 = permute(permute(permute(iz + i1z) + iy + i1y) + ix + i1x);
  const p2 = permute(permute(permute(iz + i2z) + iy + i2y) + ix + i2x);
  const p3 = permute(permute(permute(iz + 1) + iy + 1) + ix + 1);
  // Use the float32 values of the GLSL constants: floor() on multiples of 7
  // must round the same way the GPU does.
  const nsz = N7, nsx = N7x2, nsy = N7y;
  const grad = (p: number, px: number, py: number, pz: number): number => {
    const j = p - 49 * Math.floor(p * nsz * nsz);
    const xq = Math.floor(j * nsz);
    const yq = Math.floor(j - 7 * xq);
    const x = xq * nsx + nsy;
    const y = yq * nsx + nsy;
    const h = 1 - Math.abs(x) - Math.abs(y);
    const sx = Math.floor(x) * 2 + 1;
    const sy = Math.floor(y) * 2 + 1;
    const sh = h <= 0 ? -1 : 0;
    const gxx = x + sx * sh;
    const gyy = y + sy * sh;
    const norm = tis(gxx * gxx + gyy * gyy + h * h);
    return (gxx * px + gyy * py + h * pz) * norm;
  };
  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y + x0z * x0z), 0);
  let m1 = Math.max(0.5 - (x1x * x1x + x1y * x1y + x1z * x1z), 0);
  let m2 = Math.max(0.5 - (x2x * x2x + x2y * x2y + x2z * x2z), 0);
  let m3 = Math.max(0.5 - (x3x * x3x + x3y * x3y + x3z * x3z), 0);
  m0 *= m0; m1 *= m1; m2 *= m2; m3 *= m3;
  return 105 * (m0 * m0 * grad(p0, x0x, x0y, x0z) + m1 * m1 * grad(p1, x1x, x1y, x1z) + m2 * m2 * grad(p2, x2x, x2y, x2z) + m3 * m3 * grad(p3, x3x, x3y, x3z));
}

function cr(t: number, out: number[]): void {
  const t2 = t * t, t3 = t2 * t;
  out[0] = -0.5 * t3 + t2 - 0.5 * t;
  out[1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  out[3] = 0.5 * t3 - 0.5 * t2;
}

const wx = [0, 0, 0, 0], wy = [0, 0, 0, 0];

/** Catmull-Rom heightmap sample (matches heightFaceABCubic). */
export function heightCubic(heights: Float32Array, n: number, x: number, y: number, z: number): number {
  const f = dirToFaceAB(x, y, z);
  let px = (f.a + 1) * 0.5 * n, py = (f.b + 1) * 0.5 * n;
  px = Math.min(n, Math.max(0, px));
  py = Math.min(n, Math.max(0, py));
  const i0 = Math.min(Math.floor(px), n - 1), j0 = Math.min(Math.floor(py), n - 1);
  cr(px - i0, wx);
  cr(py - j0, wy);
  const side = n + 1;
  const base = f.face * side * side;
  let acc = 0;
  for (let j = 0; j < 4; j++) {
    const jj = Math.min(n, Math.max(0, j0 - 1 + j));
    const row = base + jj * side;
    let r = 0;
    for (let i = 0; i < 4; i++) {
      const ii = Math.min(n, Math.max(0, i0 - 1 + i));
      r += heights[row + ii] * wx[i];
    }
    acc += r * wy[j];
  }
  return acc;
}

export function detailHeight(x: number, y: number, z: number, h: number): number {
  const k = PLANET_RADIUS * 0.12;
  const px = x * k, py = y * k, pz = z * k;
  const nn = snoiseA(px, py, pz) * 0.6 + snoiseA(px * 2.3 + 5.1, py * 2.3 + 5.1, pz * 2.3 + 5.1) * 0.25;
  const land = Math.min(1, Math.max(0, (h + 0.5) / 2));
  return nn * (0.1 + (0.4 - 0.1) * land);
}

/** Ground height exactly as rendered. */
export function groundHeight(heights: Float32Array, n: number, x: number, y: number, z: number): number {
  const h = heightCubic(heights, n, x, y, z);
  return h + detailHeight(x, y, z, h);
}
