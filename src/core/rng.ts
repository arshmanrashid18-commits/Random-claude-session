/**
 * Deterministic pseudo-random number generation.
 *
 * The simulation threads a single `Rng` instance through every system, so the
 * order in which systems draw numbers is part of the deterministic contract.
 * Positional randomness that must not depend on call order (e.g. "is there a
 * rock at this grid point?") uses the stateless `hash*` functions seeded from
 * the world seed instead.
 *
 * Generator: sfc32 (Small Fast Counting, 128-bit state). It passes PractRand
 * well beyond the lengths we use and is fast with 32-bit integer ops in V8.
 */

/** 32-bit string hash (FNV-1a) used to turn textual seeds into integers. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** SplitMix32 step – used for seeding and for stateless hashing. */
export function splitmix32(x: number): number {
  x = (x + 0x9e3779b9) | 0;
  let z = x;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Stateless integer hash of up to four 32-bit ints. Returns uint32. */
export function hash4(a: number, b: number, c: number, d: number): number {
  let h = splitmix32(a ^ 0x27d4eb2d);
  h = splitmix32(h ^ Math.imul(b | 0, 0x165667b1));
  h = splitmix32(h ^ Math.imul(c | 0, 0x9e3779b1));
  h = splitmix32(h ^ Math.imul(d | 0, 0x85ebca77));
  return h;
}

/** Stateless hash → float in [0,1). */
export function hashFloat(a: number, b: number, c = 0, d = 0): number {
  return hash4(a, b, c, d) / 4294967296;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string = 1) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.a = splitmix32(s);
    this.b = splitmix32(this.a ^ 0x6a09e667);
    this.c = splitmix32(this.b ^ 0xbb67ae85);
    this.d = splitmix32(this.c ^ 0x3c6ef372);
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Next uint32. */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0,1). */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Float in [min,max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  /** Integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number {
    return min + Math.floor(this.float() * (maxExclusive - min));
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.float() * arr.length)];
  }

  /** Standard normal via Box–Muller (uses two draws, no caching → stateless). */
  gauss(): number {
    let u = this.float();
    if (u < 1e-12) u = 1e-12;
    const v = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Fisher–Yates in place. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Derive an independent generator (used only at world creation). */
  fork(label: string): Rng {
    const r = new Rng(0);
    r.setState([this.next() ^ hashString(label), this.next(), this.next(), this.next()]);
    return r;
  }

  getState(): [number, number, number, number] {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  setState(s: readonly number[]): void {
    this.a = s[0] | 0;
    this.b = s[1] | 0;
    this.c = s[2] | 0;
    this.d = s[3] | 0;
  }
}
