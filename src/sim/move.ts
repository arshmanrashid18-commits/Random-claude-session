/**
 * Movement on the unit sphere for agents stored as SoA direction vectors.
 */

/**
 * Move (x,y,z)[i] toward (tx,ty,tz)[i] by `step` radians along the great
 * circle. Returns the remaining angular distance after the move.
 */
export function stepToward(
  x: Float32Array, y: Float32Array, z: Float32Array,
  tx: Float32Array, ty: Float32Array, tz: Float32Array,
  i: number, step: number,
): number {
  const px = x[i], py = y[i], pz = z[i];
  let dx = tx[i] - px, dy = ty[i] - py, dz = tz[i] - pz;
  // Project onto tangent plane.
  const d = dx * px + dy * py + dz * pz;
  dx -= d * px; dy -= d * py; dz -= d * pz;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const chord = Math.sqrt((tx[i] - px) ** 2 + (ty[i] - py) ** 2 + (tz[i] - pz) ** 2);
  if (dl < 1e-9 || chord <= step) {
    x[i] = tx[i]; y[i] = ty[i]; z[i] = tz[i];
    return 0;
  }
  const k = step / dl;
  let nx = px + dx * k, ny = py + dy * k, nz = pz + dz * k;
  const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx *= nl; ny *= nl; nz *= nl;
  x[i] = nx; y[i] = ny; z[i] = nz;
  return chord - step;
}

/** Point at angular offset (east, north radians) from direction p. */
export function offsetDir(px: number, py: number, pz: number, east: number, north: number, out: number[]): void {
  let ex = pz, ez = -px;
  let el = Math.sqrt(ex * ex + ez * ez);
  let ey = 0;
  if (el < 1e-6) { ex = 1; ey = 0; ez = 0; el = 1; }
  ex /= el; ez /= el;
  const nx = py * ez - pz * ey, ny = pz * ex - px * ez, nz = px * ey - py * ex;
  let x = px + ex * east + nx * north;
  let y = py + ey * east + ny * north;
  let z = pz + ez * east + nz * north;
  const l = 1 / Math.sqrt(x * x + y * y + z * z);
  x *= l; y *= l; z *= l;
  out[0] = x; out[1] = y; out[2] = z;
}

/** Squared chord distance between agent i and a point. */
export function dist2(x: Float32Array, y: Float32Array, z: Float32Array, i: number, px: number, py: number, pz: number): number {
  const dx = x[i] - px, dy = y[i] - py, dz = z[i] - pz;
  return dx * dx + dy * dy + dz * dz;
}
