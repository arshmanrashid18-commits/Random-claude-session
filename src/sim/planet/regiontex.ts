/**
 * Packs per-region-cell fields into padded RGBA8 texture-array data for the
 * GPU. Each face is (n+2)² texels: a one-texel border copied from the
 * neighbouring face makes hardware bilinear filtering continuous across cube
 * seams.
 */
import { CellGrid } from './cubesphere';

export function paddedSize(grid: CellGrid): number {
  return grid.n + 2;
}

/** Precomputed source-cell index for every padded texel. */
export function buildPadMap(grid: CellGrid): Int32Array {
  const n = grid.n;
  const P = n + 2;
  const map = new Int32Array(6 * P * P);
  for (let f = 0; f < 6; f++) {
    for (let y = 0; y < P; y++) {
      for (let x = 0; x < P; x++) {
        const i = x - 1, j = y - 1;
        let src: number;
        const ci = Math.min(n - 1, Math.max(0, i));
        const cj = Math.min(n - 1, Math.max(0, j));
        const base = f * grid.faceSize + cj * n + ci;
        if (i >= 0 && i < n && j >= 0 && j < n) src = base;
        else if (i < 0 && j >= 0 && j < n) src = grid.neighbors[base * 8 + 1];
        else if (i >= n && j >= 0 && j < n) src = grid.neighbors[base * 8 + 0];
        else if (j < 0 && i >= 0 && i < n) src = grid.neighbors[base * 8 + 3];
        else if (j >= n && i >= 0 && i < n) src = grid.neighbors[base * 8 + 2];
        else {
          // Corner: diagonal neighbour.
          const k = i < 0 ? (j < 0 ? 7 : 5) : (j < 0 ? 6 : 4);
          src = grid.neighbors[base * 8 + k];
        }
        map[f * P * P + y * P + x] = src;
      }
    }
  }
  return map;
}

/**
 * Fill an RGBA8 padded array. Each channel function maps a cell index to a
 * value in [0,1].
 */
export function packRGBA(
  padMap: Int32Array,
  out: Uint8Array,
  r: (c: number) => number,
  g: (c: number) => number,
  b: (c: number) => number,
  a: (c: number) => number,
): void {
  for (let t = 0; t < padMap.length; t++) {
    const c = padMap[t];
    const o = t * 4;
    out[o] = clamp255(r(c));
    out[o + 1] = clamp255(g(c));
    out[o + 2] = clamp255(b(c));
    out[o + 3] = clamp255(a(c));
  }
}

function clamp255(v: number): number {
  const x = Math.round(v * 255);
  return x < 0 ? 0 : x > 255 ? 255 : x;
}
