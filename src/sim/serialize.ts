/**
 * Save format: the complete simulation object graph, serialised generically.
 *
 * Every reachable object is encoded once (with an id) so shared references
 * and back-references survive the round trip (e.g. a tribe's "worst memory"
 * is the same object as the entry in the god-memory list). Class instances
 * are restored with their prototypes from an explicit registry (class names
 * are not trusted — minifiers rename them). Typed arrays go into a binary
 * blob; the shared geometry grids are stored as symbolic references. The
 * whole file is gzip-compressed with the platform CompressionStream.
 *
 * Because everything that influences the simulation is saved — including
 * the RNG state, free lists and caches — a loaded world continues exactly
 * as the original would have (verified by tests/saveload.test.ts).
 */
import { World } from './world';
import { Planet, getGrids } from './planet/planet';
import { RegionTerrain } from './planet/regions';
import { Hydrology, MinHeap } from './planet/hydrology';
import { Climate } from './climate/climate';
import { Weather } from './climate/weather';
import { Geography } from './planet/geography';
import { Plants } from './ecology/plants';
import { Fires } from './ecology/fire';
import { Animals } from './ecology/animals';
import { SpatialHash } from './spatial';
import { Civ } from './civ/civ';
import { People } from './civ/people';
import { Pathfinder, Heap } from './civ/pathfind';
import { Society } from './civ/society';
import { EventLog } from './events';
import { Divine } from './powers/divine';
import { Terraformer } from './planet/terraform';
import { Language } from '../core/language';
import { Rng } from '../core/rng';

const CLASSES: Record<string, { prototype: object }> = {
  World, Planet, RegionTerrain, Hydrology, MinHeap, Climate, Weather, Geography, Plants, Fires, Animals, SpatialHash,
  Civ, People, Pathfinder, Heap, Society, EventLog, Divine, Terraformer, Language, Rng,
};
const PROTO_TO_NAME = new Map<object, string>(Object.entries(CLASSES).map(([k, c]) => [c.prototype, k]));

type TypedArray = Float32Array | Float64Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Int8Array | Uint8Array;
const TA: Record<string, new (n: number) => TypedArray> = {
  f32: Float32Array, f64: Float64Array, i32: Int32Array, u32: Uint32Array, i16: Int16Array, u16: Uint16Array, i8: Int8Array, u8: Uint8Array,
};
function taKind(a: TypedArray): string {
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Float64Array) return 'f64';
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Int8Array) return 'i8';
  return 'u8';
}

export const SAVE_VERSION = 3;
const MAGIC = 'GENESIS\u0001';

export interface SaveMeta {
  version: number;
  seed: number;
  preset: string;
  tick: number;
  name: string;
  people: number;
  when: number;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

class Encoder {
  ids = new Map<object, number>();
  next = 1;
  arrays: TypedArray[] = [];
  grids: Map<object, string>;

  constructor() {
    const g = getGrids();
    this.grids = new Map<object, string>([[g.region, 'region'], [g.hydro, 'hydro'], [g.hg, 'hg']]);
  }

  enc(v: unknown, path: string): Json | undefined {
    if (v === null) return null;
    switch (typeof v) {
      case 'number': return Number.isFinite(v) ? v : { $n: String(v) };
      case 'string': case 'boolean': return v;
      case 'undefined': case 'function': return undefined;
      case 'bigint': case 'symbol': throw new Error(`Cannot save ${typeof v} at ${path}`);
    }
    const o = v as object;
    const grid = this.grids.get(o);
    if (grid) return { $g: grid };
    const seen = this.ids.get(o);
    if (seen !== undefined) return { $r: seen };
    const id = this.next++;
    this.ids.set(o, id);
    if (ArrayBuffer.isView(o)) {
      this.arrays.push(o as TypedArray);
      return { $o: id, $t: this.arrays.length - 1 };
    }
    if (Array.isArray(o)) return { $o: id, $a: o.map((x, i) => this.enc(x, `${path}[${i}]`) ?? null) };
    if (o instanceof Map) return { $o: id, $m: [...o.entries()].map(([k, x]) => [this.enc(k, `${path}.key`) ?? null, this.enc(x, `${path}.val`) ?? null]) };
    if (o instanceof Set) return { $o: id, $s: [...o].map((x) => this.enc(x, `${path}.item`) ?? null) };
    const proto = Object.getPrototypeOf(o);
    let cls = '';
    if (proto !== Object.prototype && proto !== null) {
      const name = PROTO_TO_NAME.get(proto);
      if (!name) throw new Error(`Unregistered class ${(proto as { constructor?: { name?: string } }).constructor?.name ?? '?'} at ${path}`);
      cls = name;
    }
    const f: Record<string, Json> = {};
    for (const k of Object.keys(o)) {
      const e = this.enc((o as Record<string, unknown>)[k], `${path}.${k}`);
      if (e !== undefined) f[k] = e;
    }
    return cls ? { $o: id, $c: cls, f } : { $o: id, f };
  }
}

class Decoder {
  objs = new Map<number, unknown>();
  constructor(private arrays: TypedArray[]) {}

  dec(j: Json): unknown {
    if (j === null || typeof j !== 'object') return j;
    if (Array.isArray(j)) return j.map((x) => this.dec(x));
    const n = j as Record<string, Json>;
    if ('$n' in n) return Number(n.$n);
    if ('$g' in n) {
      const g = getGrids();
      return n.$g === 'region' ? g.region : n.$g === 'hydro' ? g.hydro : g.hg;
    }
    if ('$r' in n) {
      if (!this.objs.has(n.$r as number)) throw new Error(`Dangling reference ${n.$r}`);
      return this.objs.get(n.$r as number);
    }
    const id = n.$o as number;
    if ('$t' in n) { const a = this.arrays[n.$t as number]; this.objs.set(id, a); return a; }
    if ('$a' in n) {
      const out: unknown[] = [];
      this.objs.set(id, out);
      for (const x of n.$a as Json[]) out.push(this.dec(x));
      return out;
    }
    if ('$m' in n) {
      const m = new Map();
      this.objs.set(id, m);
      for (const [k, x] of n.$m as [Json, Json][]) m.set(this.dec(k), this.dec(x));
      return m;
    }
    if ('$s' in n) {
      const s = new Set();
      this.objs.set(id, s);
      for (const x of n.$s as Json[]) s.add(this.dec(x));
      return s;
    }
    const cls = n.$c as string | undefined;
    let o: Record<string, unknown>;
    if (cls) {
      const C = CLASSES[cls];
      if (!C) throw new Error(`Unknown class ${cls} in save`);
      o = Object.create(C.prototype);
    } else o = {};
    this.objs.set(id, o);
    const f = n.f as Record<string, Json>;
    for (const k of Object.keys(f)) o[k] = this.dec(f[k]);
    return o;
  }
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Serialise a world to a compressed save file. */
export async function saveWorld(world: World, name: string): Promise<Uint8Array> {
  const enc = new Encoder();
  const root = enc.enc(world, 'world');
  const meta: SaveMeta = {
    version: SAVE_VERSION, seed: world.seed, preset: world.preset, tick: world.tick, name,
    people: world.civ.totalPeople(), when: Date.now(),
  };
  // Binary layout: arrays packed with 8-byte alignment.
  const descr: [string, number, number][] = [];
  let off = 0;
  for (const a of enc.arrays) {
    off = (off + 7) & ~7;
    descr.push([taKind(a), off, a.length]);
    off += a.byteLength;
  }
  const bin = new Uint8Array((off + 7) & ~7);
  enc.arrays.forEach((a, i) => bin.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), descr[i][1]));
  const json = new TextEncoder().encode(JSON.stringify({ meta, arrays: descr, root }));
  const head = new TextEncoder().encode(MAGIC);
  const total = head.length + 4 + json.length;
  const pad = (8 - (total % 8)) % 8;
  const out = new Uint8Array(total + pad + bin.length);
  out.set(head, 0);
  new DataView(out.buffer).setUint32(head.length, json.length, true);
  out.set(json, head.length + 4);
  out.set(bin, total + pad);
  return gzip(out);
}

/** Read only the metadata of a save file. */
export async function readSaveMeta(file: Uint8Array): Promise<SaveMeta> {
  const { header } = await unpack(file);
  return header.meta;
}

async function unpack(file: Uint8Array): Promise<{ header: { meta: SaveMeta; arrays: [string, number, number][]; root: Json }; raw: Uint8Array; binStart: number }> {
  const raw = await gunzip(file);
  const head = new TextDecoder().decode(raw.subarray(0, MAGIC.length));
  if (head !== MAGIC) throw new Error('Not a Genesis world file');
  const len = new DataView(raw.buffer, raw.byteOffset).getUint32(MAGIC.length, true);
  const json = new TextDecoder().decode(raw.subarray(MAGIC.length + 4, MAGIC.length + 4 + len));
  const header = JSON.parse(json);
  if (header.meta?.version !== SAVE_VERSION) throw new Error(`This world was saved by an incompatible version (${header.meta?.version})`);
  const total = MAGIC.length + 4 + len;
  const binStart = total + ((8 - (total % 8)) % 8);
  return { header, raw, binStart };
}

/** Restore a world from a save file. */
export async function loadWorld(file: Uint8Array): Promise<World> {
  const { header, raw, binStart } = await unpack(file);
  const arrays = header.arrays.map(([kind, off, len]) => {
    const C = TA[kind];
    const bytes = raw.slice(binStart + off, binStart + off + len * (new C(0) as TypedArray).BYTES_PER_ELEMENT);
    return new (C as unknown as new (b: ArrayBuffer) => TypedArray)(bytes.buffer);
  });
  const dec = new Decoder(arrays);
  const world = dec.dec(header.root) as World;
  world.wire();
  return world;
}
