/**
 * The ring of hydrology cells around each lake, at the level of the highest
 * adjacent lake cell. Lakes are drawn over these cells too (clipped against
 * the terrain per pixel), so shores follow the height contours instead of the
 * grid; vegetation uses the same levels so nothing grows in the fringe water.
 */
export function lakeFringe(cells: ArrayLike<number>, levels: ArrayLike<number>, n: number): Map<number, number> {
  const fs = n * n;
  const inLake = new Set<number>();
  for (let k = 0; k < cells.length; k++) inLake.add(cells[k]);
  const fringe = new Map<number, number>();
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    const f = Math.floor(c / fs);
    const rem = c - f * fs;
    const j = Math.floor(rem / n), i = rem - j * n;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if ((di === 0 && dj === 0) || ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const nc = f * fs + jj * n + ii;
        if (inLake.has(nc)) continue;
        const prev = fringe.get(nc);
        if (prev === undefined || levels[k] > prev) fringe.set(nc, levels[k]);
      }
    }
  }
  return fringe;
}
