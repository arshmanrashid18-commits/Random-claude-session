/**
 * Procedural tileable 3D noise volume for clouds (generated at load time, no
 * external assets). Channels:
 *  R – Perlin–Worley (billowy base shape)
 *  G – Worley fBm, low frequency
 *  B – Worley fBm, high frequency (edge erosion detail)
 *  A – periodic gradient noise
 */
import * as THREE from 'three';

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** Periodic Worley F1 distance in [0,1] (inverted: 1 at feature points). */
function worley(x: number, y: number, z: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const wx = mod(cx, period), wy = mod(cy, period), wz = mod(cz, period);
        const px = cx + hash3(wx, wy, wz, seed);
        const py = cy + hash3(wx, wy, wz, seed + 1);
        const pz = cz + hash3(wx, wy, wz, seed + 2);
        const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
        if (d < best) best = d;
      }
    }
  }
  return 1 - Math.min(1, Math.sqrt(best));
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(ix: number, iy: number, iz: number, period: number, seed: number, x: number, y: number, z: number): number {
  const h = Math.floor(hash3(mod(ix, period), mod(iy, period), mod(iz, period), seed) * 12);
  const g = GRADS[h];
  return g[0] * x + g[1] * y + g[2] * z;
}
const GRADS = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];

function perlin(x: number, y: number, z: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  const n000 = grad(xi, yi, zi, period, seed, xf, yf, zf);
  const n100 = grad(xi + 1, yi, zi, period, seed, xf - 1, yf, zf);
  const n010 = grad(xi, yi + 1, zi, period, seed, xf, yf - 1, zf);
  const n110 = grad(xi + 1, yi + 1, zi, period, seed, xf - 1, yf - 1, zf);
  const n001 = grad(xi, yi, zi + 1, period, seed, xf, yf, zf - 1);
  const n101 = grad(xi + 1, yi, zi + 1, period, seed, xf - 1, yf, zf - 1);
  const n011 = grad(xi, yi + 1, zi + 1, period, seed, xf, yf - 1, zf - 1);
  const n111 = grad(xi + 1, yi + 1, zi + 1, period, seed, xf - 1, yf - 1, zf - 1);
  const x00 = n000 + u * (n100 - n000), x10 = n010 + u * (n110 - n010);
  const x01 = n001 + u * (n101 - n001), x11 = n011 + u * (n111 - n011);
  const y0 = x00 + v * (x10 - x00), y1 = x01 + v * (x11 - x01);
  return y0 + w * (y1 - y0);
}

export function generateCloudNoise(size = 64): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size * 4);
  const s = 1 / size;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = x * s, fy = y * s, fz = z * s;
        // Perlin fBm, 3 octaves, periodic.
        let p = 0, amp = 1, norm = 0;
        for (let o = 0; o < 3; o++) {
          const f = 4 << o;
          p += perlin(fx * f, fy * f, fz * f, f, 11 + o) * amp;
          norm += amp;
          amp *= 0.5;
        }
        p = p / norm * 0.5 + 0.5;
        const w1 = worley(fx * 4, fy * 4, fz * 4, 4, 101);
        const w2 = worley(fx * 8, fy * 8, fz * 8, 8, 202);
        const w3 = worley(fx * 16, fy * 16, fz * 16, 16, 303);
        const wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
        // Perlin–Worley: remap perlin by worley for billowy cells.
        const pw = Math.min(1, Math.max(0, (p - (1 - wf)) / (1 - (1 - wf)) * 0.5 + wf * 0.5));
        const w4 = worley(fx * 16, fy * 16, fz * 16, 16, 404);
        const w5 = worley(fx * 32, fy * 32, fz * 32, 32, 505);
        const hi = w3 * 0.5 + w4 * 0.3 + w5 * 0.2;
        const i = ((z * size + y) * size + x) * 4;
        data[i] = Math.round(pw * 255);
        data[i + 1] = Math.round(wf * 255);
        data[i + 2] = Math.round(hi * 255);
        data[i + 3] = Math.round(p * 255);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
