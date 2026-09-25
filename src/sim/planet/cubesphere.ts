/**
 * Cube-sphere geometry shared by the simulation and the renderer.
 *
 * The planet surface is parameterised by six cube faces. Each face uses an
 * equi-angular mapping: grid parameter a∈[-1,1] maps to cube coordinate
 * tan(a·π/4), which keeps cell areas within ~1.4× of each other and has a
 * closed-form inverse (atan), unlike the popular Nowell mapping.
 *
 * Face order: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z. Each face has a right-handed
 * basis (U × V = N), matching the WebGL cubemap convention, so triangle
 * winding is identical on every face. +Y is the planet's rotation axis.
 *
 * Two grid flavours are used:
 *  - VertexGrid (n+1)² samples per face, vertex-centred. Used for the
 *    heightmap; samples on face edges are duplicated across faces and kept in
 *    sync (they represent the same 3D point).
 *  - CellGrid n² cells per face, cell-centred, with a precomputed 8-neighbour
 *    table that crosses face boundaries. Used for climate, ecology, hydrology,
 *    ownership and pathfinding.
 */

export const FACE_N = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;
export const FACE_U = [
  [0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0],
] as const;
export const FACE_V = [
  [0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0],
] as const;

const QPI = Math.PI / 4;
const INV_QPI = 4 / Math.PI;

/** Scratch result of dirToFaceAB (reused to avoid allocation in hot loops). */
export const FAB = { face: 0, a: 0, b: 0 };

/** Direction (need not be normalised) → face index and equi-angular params. */
export function dirToFaceAB(x: number, y: number, z: number): typeof FAB {
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const az = z < 0 ? -z : z;
  let face: number, u: number, v: number;
  if (ax >= ay && ax >= az) {
    if (x > 0) { face = 0; u = -z / x; v = y / x; }
    else { face = 1; u = z / ax; v = y / ax; }
  } else if (ay >= az) {
    if (y > 0) { face = 2; u = x / y; v = -z / y; }
    else { face = 3; u = x / ay; v = z / ay; }
  } else {
    if (z > 0) { face = 4; u = x / z; v = y / z; }
    else { face = 5; u = -x / az; v = y / az; }
  }
  FAB.face = face;
  FAB.a = Math.atan(u) * INV_QPI;
  FAB.b = Math.atan(v) * INV_QPI;
  return FAB;
}

/** Face + equi-angular params → unit direction written into out[o..o+2]. */
export function faceABToDir(face: number, a: number, b: number, out: Float32Array | Float64Array | number[], o = 0): void {
  const u = Math.tan(a * QPI);
  const v = Math.tan(b * QPI);
  const N = FACE_N[face], U = FACE_U[face], V = FACE_V[face];
  const x = N[0] + u * U[0] + v * V[0];
  const y = N[1] + u * U[1] + v * V[1];
  const z = N[2] + u * U[2] + v * V[2];
  const inv = 1 / Math.sqrt(x * x + y * y + z * z);
  out[o] = x * inv;
  out[o + 1] = y * inv;
  out[o + 2] = z * inv;
}

/** Vertex-centred heightmap grid: (n+1)² samples per face. */
export class VertexGrid {
  readonly n: number;
  readonly side: number;
  readonly faceSize: number;
  readonly count: number;
  /** Groups of indices that denote the same 3D point (face edges/corners). */
  readonly dupStart: Int32Array;
  readonly dupMembers: Int32Array;

  constructor(n: number) {
    this.n = n;
    this.side = n + 1;
    this.faceSize = this.side * this.side;
    this.count = 6 * this.faceSize;
    const { start, members } = this.buildDuplicates();
    this.dupStart = start;
    this.dupMembers = members;
  }

  index(face: number, i: number, j: number): number {
    return face * this.faceSize + j * this.side + i;
  }

  /** Unit direction of sample (face,i,j). */
  dirOf(face: number, i: number, j: number, out: Float32Array | Float64Array | number[], o = 0): void {
    faceABToDir(face, -1 + (2 * i) / this.n, -1 + (2 * j) / this.n, out, o);
  }

  /** Bilinear sample of a per-vertex field at a direction. */
  sample(field: Float32Array, x: number, y: number, z: number): number {
    const f = dirToFaceAB(x, y, z);
    const n = this.n;
    let fx = (f.a + 1) * 0.5 * n;
    let fy = (f.b + 1) * 0.5 * n;
    if (fx < 0) fx = 0; else if (fx > n) fx = n;
    if (fy < 0) fy = 0; else if (fy > n) fy = n;
    let i0 = fx | 0;
    let j0 = fy | 0;
    if (i0 >= n) i0 = n - 1;
    if (j0 >= n) j0 = n - 1;
    const tx = fx - i0;
    const ty = fy - j0;
    const base = f.face * this.faceSize + j0 * this.side + i0;
    const h00 = field[base];
    const h10 = field[base + 1];
    const h01 = field[base + this.side];
    const h11 = field[base + this.side + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  }

  /** Average duplicated edge samples so every copy of a point agrees. */
  syncEdges(field: Float32Array): void {
    const st = this.dupStart, m = this.dupMembers;
    for (let g = 0; g + 1 < st.length; g++) {
      const s = st[g], e = st[g + 1];
      let sum = 0;
      for (let k = s; k < e; k++) sum += field[m[k]];
      const avg = sum / (e - s);
      for (let k = s; k < e; k++) field[m[k]] = avg;
    }
  }

  private buildDuplicates(): { start: Int32Array; members: Int32Array } {
    const n = this.n;
    const groups = new Map<string, number[]>();
    const d = [0, 0, 0];
    for (let f = 0; f < 6; f++) {
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          if (i !== 0 && i !== n && j !== 0 && j !== n) continue;
          this.dirOf(f, i, j, d);
          // Quantise the direction to build a stable key for identical points.
          const key = `${Math.round(d[0] * 1e6)},${Math.round(d[1] * 1e6)},${Math.round(d[2] * 1e6)}`;
          let g = groups.get(key);
          if (!g) { g = []; groups.set(key, g); }
          g.push(this.index(f, i, j));
        }
      }
    }
    const starts: number[] = [];
    const members: number[] = [];
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      starts.push(members.length);
      for (const idx of g) members.push(idx);
    }
    starts.push(members.length);
    return { start: Int32Array.from(starts), members: Int32Array.from(members) };
  }
}

/** Cell-centred grid with cross-face neighbour table. */
export class CellGrid {
  readonly n: number;
  readonly faceSize: number;
  readonly count: number;
  /** Unit direction of each cell centre (xyz interleaved). */
  readonly centers: Float32Array;
  /** 8 neighbours per cell: 0..3 are edge neighbours (+a,-a,+b,-b), 4..7 diagonals. */
  readonly neighbors: Int32Array;
  /** Latitude in radians of each cell centre. */
  readonly lat: Float32Array;
  /** Relative area (solid angle) of each cell, normalised to mean 1. */
  readonly area: Float32Array;
  /** Approximate arc length between neighbouring centres on a unit sphere. */
  readonly spacing: number;

  /** Cell boundaries in gnomonic coordinate u = tan(a·π/4) (n+1 values). */
  private bounds: Float64Array;
  /** Coarse u → cell index guess (8 buckets per cell). */
  private lut: Int32Array;
  private lutScale: number;

  constructor(n: number) {
    this.n = n;
    this.faceSize = n * n;
    this.count = 6 * n * n;
    this.bounds = new Float64Array(n + 1);
    for (let k = 0; k <= n; k++) this.bounds[k] = Math.tan((-1 + (2 * k) / n) * QPI);
    const L = n * 8;
    this.lut = new Int32Array(L + 1);
    this.lutScale = L / 2;
    for (let q = 0; q <= L; q++) {
      const u = -1 + (2 * q) / L;
      this.lut[q] = Math.min(n - 1, Math.max(0, Math.floor((Math.atan(u) * INV_QPI + 1) * 0.5 * n)));
    }
    this.centers = new Float32Array(this.count * 3);
    this.lat = new Float32Array(this.count);
    this.area = new Float32Array(this.count);
    this.neighbors = new Int32Array(this.count * 8);
    this.spacing = (Math.PI / 2) / n;
    const d = [0, 0, 0];
    let areaSum = 0;
    for (let f = 0; f < 6; f++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const c = f * this.faceSize + j * n + i;
          const a = -1 + (2 * i + 1) / n;
          const b = -1 + (2 * j + 1) / n;
          faceABToDir(f, a, b, this.centers, c * 3);
          this.lat[c] = Math.asin(Math.max(-1, Math.min(1, this.centers[c * 3 + 1])));
          // Solid angle estimate from the Jacobian of the equi-angular map.
          const u = Math.tan(a * QPI), v = Math.tan(b * QPI);
          const du = QPI * (1 + u * u), dv = QPI * (1 + v * v);
          const r2 = 1 + u * u + v * v;
          const ar = (du * dv) / Math.pow(r2, 1.5);
          this.area[c] = ar;
          areaSum += ar;
          const offs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
          for (let k = 0; k < 8; k++) {
            const ii = i + offs[k][0];
            const jj = j + offs[k][1];
            let nb: number;
            if (ii >= 0 && ii < n && jj >= 0 && jj < n) {
              nb = f * this.faceSize + jj * n + ii;
            } else {
              faceABToDir(f, -1 + (2 * ii + 1) / n, -1 + (2 * jj + 1) / n, d, 0);
              nb = this.cellOf(d[0], d[1], d[2]);
              if (nb === c) nb = -1;
            }
            this.neighbors[c * 8 + k] = nb;
          }
        }
      }
    }
    const mean = areaSum / this.count;
    for (let c = 0; c < this.count; c++) this.area[c] /= mean;
    // Replace missing corner diagonals with an edge neighbour so the table is dense.
    for (let c = 0; c < this.count; c++) {
      for (let k = 4; k < 8; k++) {
        if (this.neighbors[c * 8 + k] < 0) this.neighbors[c * 8 + k] = this.neighbors[c * 8 + (k - 4)];
      }
    }
  }

  /** Cell containing a direction. Hot path: no trigonometry (boundary table). */
  cellOf(x: number, y: number, z: number): number {
    const ax = x < 0 ? -x : x, ay = y < 0 ? -y : y, az = z < 0 ? -z : z;
    let face: number, u: number, v: number;
    if (ax >= ay && ax >= az) {
      if (x > 0) { face = 0; u = -z / x; v = y / x; } else { face = 1; u = z / ax; v = y / ax; }
    } else if (ay >= az) {
      if (y > 0) { face = 2; u = x / y; v = -z / y; } else { face = 3; u = x / ay; v = z / ay; }
    } else {
      if (z > 0) { face = 4; u = x / z; v = y / z; } else { face = 5; u = -x / az; v = y / az; }
    }
    return face * this.faceSize + this.index1(v) * this.n + this.index1(u);
  }

  private index1(u: number): number {
    const n = this.n, B = this.bounds;
    let q = Math.floor((u + 1) * this.lutScale);
    if (q < 0) q = 0; else if (q >= this.lut.length) q = this.lut.length - 1;
    let i = this.lut[q];
    while (i < n - 1 && u >= B[i + 1]) i++;
    while (i > 0 && u < B[i]) i--;
    return i;
  }

  /**
   * Bilinear sample of a cell field at a direction. Cells near face edges fall
   * back to nearest-cell sampling on the far side of the edge, which is exact
   * enough for smooth climate fields.
   */
  sample(field: Float32Array, x: number, y: number, z: number): number {
    const f = dirToFaceAB(x, y, z);
    const n = this.n;
    const fx = (f.a + 1) * 0.5 * n - 0.5;
    const fy = (f.b + 1) * 0.5 * n - 0.5;
    let i0 = Math.floor(fx);
    let j0 = Math.floor(fy);
    let tx = fx - i0;
    let ty = fy - j0;
    if (i0 < 0) { i0 = 0; tx = 0; }
    if (j0 < 0) { j0 = 0; ty = 0; }
    if (i0 >= n - 1) { i0 = n - 2; tx = 1; }
    if (j0 >= n - 1) { j0 = n - 2; ty = 1; }
    const base = f.face * this.faceSize + j0 * n + i0;
    return (field[base] * (1 - tx) + field[base + 1] * tx) * (1 - ty) +
      (field[base + n] * (1 - tx) + field[base + n + 1] * tx) * ty;
  }
}

/** Great-circle angle between two unit vectors. */
export function angleBetween(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const d = ax * bx + ay * by + az * bz;
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d);
}

/** Squared chord distance between two unit vectors (cheap monotone proxy for angle). */
export function chord2(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx, dy = ay - by, dz = az - bz;
  return dx * dx + dy * dy + dz * dz;
}
