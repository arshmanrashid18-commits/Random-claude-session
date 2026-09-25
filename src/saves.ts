/**
 * Save slots in IndexedDB, export/import of world files, and the
 * resume-on-reload handshake used when loading a world.
 */
import type { SimClient } from './worker/client';
import type { SaveSlotInfo } from './ui/panels';

const DB = 'genesis';
const STORE = 'saves';

interface Record { slot: string; meta: SaveSlotInfo; data: Uint8Array }

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error ?? new Error('Storage unavailable'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error ?? new Error('Storage error'));
    t.oncomplete = () => db.close();
  });
}

export async function listSlots(): Promise<SaveSlotInfo[]> {
  const all = await tx<Record[]>('readonly', (s) => s.getAll() as IDBRequest<Record[]>);
  return all.filter((r) => r.slot !== 'pending').map((r) => r.meta);
}

export async function putSlot(slot: string, meta: SaveSlotInfo, data: Uint8Array): Promise<void> {
  await tx('readwrite', (s) => s.put({ slot, meta, data }));
}

export async function getSlot(slot: string): Promise<Record | undefined> {
  return tx<Record | undefined>('readonly', (s) => s.get(slot) as IDBRequest<Record | undefined>);
}

export async function removeSlot(slot: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(slot));
}

/** Peek at a world file's header without the simulation code. */
export async function peekMeta(data: Uint8Array): Promise<{ seed: number; tick: number; name: string; people: number }> {
  const ds = new DecompressionStream('gzip');
  const raw = new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds)).arrayBuffer());
  const magic = new TextDecoder().decode(raw.subarray(0, 8));
  if (magic !== 'GENESIS\u0001') throw new Error('Not a Genesis world file');
  const len = new DataView(raw.buffer).getUint32(8, true);
  // The meta object is at the start of the JSON header; parse just that prefix.
  const text = new TextDecoder().decode(raw.subarray(12, 12 + Math.min(len, 4096)));
  const m = /"meta":(\{[^}]*\})/.exec(text);
  if (!m) throw new Error('Damaged world file');
  return JSON.parse(m[1]);
}

export class SaveSystem {
  constructor(private sim: SimClient, private worldName: () => string, private onBusy: (msg: string) => void) {}

  list(): Promise<SaveSlotInfo[]> {
    return listSlots();
  }

  async save(slot: string): Promise<void> {
    this.onBusy('Writing the world into memory…');
    const { data, meta } = await this.sim.save(this.worldName());
    await putSlot(slot, { slot, name: meta.name, year: Math.floor(meta.tick / 960) + 1, people: meta.people, when: meta.when }, data);
    this.onBusy('');
  }

  async load(slot: string): Promise<void> {
    const rec = await getSlot(slot);
    if (!rec) throw new Error('That slot is empty');
    await this.resume(rec.data, rec.meta);
  }

  /** Stash the file and restart the page into it (clean renderer state). */
  private async resume(data: Uint8Array, meta: SaveSlotInfo): Promise<void> {
    await putSlot('pending', meta, data);
    const url = new URL(location.href);
    url.searchParams.set('resume', '1');
    location.href = url.toString();
  }

  remove(slot: string): Promise<void> {
    return removeSlot(slot);
  }

  async exportFile(): Promise<void> {
    this.onBusy('Preparing the world file…');
    const { data, meta } = await this.sim.save(this.worldName());
    const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${meta.name.toLowerCase().replace(/\W+/g, '-')}-year-${Math.floor(meta.tick / 960) + 1}.genesis`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    this.onBusy('');
  }

  async importFile(f: File): Promise<void> {
    const data = new Uint8Array(await f.arrayBuffer());
    const meta = await peekMeta(data);
    await this.resume(data, { slot: 'pending', name: meta.name, year: Math.floor(meta.tick / 960) + 1, people: meta.people, when: Date.now() });
  }
}

/** On boot: a world waiting to be resumed? */
export async function takePending(): Promise<Uint8Array | null> {
  try {
    const rec = await getSlot('pending');
    if (!rec) return null;
    await removeSlot('pending');
    return rec.data;
  } catch {
    return null;
  }
}
