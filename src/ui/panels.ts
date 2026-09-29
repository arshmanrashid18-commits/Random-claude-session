/**
 * Full-screen panels: Chronicle (prose history), Ecology dashboard (population
 * curves, biodiversity, living biome map), Peoples (tribes, faiths, wars),
 * Settings, Controls & help, Save & load.
 */
import { el, flagSvg, hex } from './components';
import { icon } from './icons';
import { narrate, yearOfTick } from './narrate';
import type { GameEvent } from '../sim/events';
import type { EcologyData, TribeData, CivData, SpeciesInfo } from '../worker/protocol';
import { BIOME_COLORS, BIOME_NAMES } from '../sim/climate/biomes';
import { dirToFaceAB } from '../sim/planet/cubesphere';
import { ACTIONS, keyLabel, type KeyMap } from './keys';
import { TICKS_PER_YEAR } from '../sim/constants';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Modal {
  readonly wrap = el('div', 'modal-wrap');
  readonly box = el('div', 'modal panel');
  readonly head = el('div', 'modal-head');
  readonly body = el('div', 'modal-body');
  isOpen = false;
  onClose: () => void = () => {};

  constructor(root: HTMLElement, title: string, ic: string) {
    this.head.innerHTML = `<span style="color:var(--gold)">${icon(ic, 22)}</span><h2>${title}</h2><div class="grow"></div>`;
    const close = el('button', 'btn', icon('close', 18));
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => this.close();
    this.head.appendChild(close);
    this.box.append(this.head, this.body);
    this.wrap.appendChild(this.box);
    this.wrap.addEventListener('pointerdown', (e) => { if (e.target === this.wrap) this.close(); });
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-label', title);
    root.appendChild(this.wrap);
  }

  open(): void {
    this.isOpen = true;
    this.wrap.classList.add('open');
    Modal.syncBody();
    this.render();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.wrap.classList.remove('open');
    Modal.syncBody();
    this.onClose();
  }

  /** While any panel is open the world's floating labels step back (they
   *  showed through the translucent panels). */
  private static syncBody(): void {
    document.body.classList.toggle('modal-open', document.querySelector('.modal-wrap.open') !== null);
  }

  toggle(): void {
    if (this.isOpen) this.close(); else this.open();
  }

  render(): void {}
}

// ------------------------------------------------------------------ chronicle
/** Weather that recurs across many lands in one year reads as one sentence. */
const MERGE: Record<string, (places: string) => string> = {
  drought: (p) => `Drought grips ${p}.`,
  'drought-end': (p) => `The droughts over ${p} break.`,
  wildfire: (p) => `Wildfires sweep across ${p}.`,
  blizzard: () => 'Blizzards howl across the high latitudes.',
  // (epidemics name their herds; see mergeYear)
  epidemic: (p) => `Disease spreads among the ${p}.`,
};

function placeList(names: string[]): string {
  const u = [...new Set(names.filter(Boolean))];
  if (u.length === 0) return 'many lands';
  if (u.length === 1) return u[0];
  if (u.length <= 4) return `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
  return `${u.slice(0, 3).join(', ')} and ${u.length - 3} other lands`;
}

function mergeYear(list: GameEvent[]): { id: number; importance: number; text: string }[] {
  const out: { id: number; importance: number; text: string }[] = [];
  const groups = new Map<string, GameEvent[]>();
  for (const e of list) {
    const mergeable = MERGE[e.kind] && !(e.kind === 'drought' && e.data.divine);
    if (!mergeable) {
      const n = narrate(e);
      out.push({ id: e.id, importance: e.importance, text: n.text || n.title });
      continue;
    }
    if (!groups.has(e.kind)) groups.set(e.kind, []);
    groups.get(e.kind)!.push(e);
  }
  // The same sentence twice in one year says nothing new.
  const seenText = new Set<string>();
  for (let k = out.length - 1; k >= 0; k--) {
    if (seenText.has(out[k].text)) out.splice(k, 1);
    else seenText.add(out[k].text);
  }
  for (const [kind, g] of groups) {
    if (g.length === 1) { const n = narrate(g[0]); out.push({ id: g[0].id, importance: g[0].importance, text: n.text || n.title }); continue; }
    // One sentence for a year of murrains, naming each herd once (the same
    // sentence six times in three years read as a log, not a chronicle).
    const places = kind === 'epidemic'
      ? g.map((e) => `${String(e.data.species ?? 'beasts')} of ${String(e.data.where ?? 'the wilds')}`)
      : g.map((e) => String(e.data.continent ?? e.data.where ?? ''));
    out.push({ id: g[0].id, importance: Math.max(...g.map((e) => e.importance)), text: MERGE[kind](placeList(places)) });
  }
  return out;
}

export class ChroniclePanel extends Modal {
  events: GameEvent[] = [];
  onGoto: (e: GameEvent) => void = () => {};
  worldName = '';

  constructor(root: HTMLElement) {
    super(root, 'Chronicle', 'book');
    this.body.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-ev]') as HTMLElement | null;
      if (!t) return;
      const ev = this.events.find((x) => x.id === Number(t.dataset.ev));
      if (ev) { this.close(); this.onGoto(ev); }
    });
  }

  add(e: GameEvent): void {
    if (e.importance < 0.3 || e.kind === 'storm' || e.kind === 'building') return;
    this.events.push(e);
    if (this.events.length > 4000) this.events.splice(0, this.events.length - 4000);
    if (this.isOpen) this.render();
  }

  override render(): void {
    const byEra = new Map<number, GameEvent[]>();
    for (const e of this.events) {
      const era = Math.floor((yearOfTick(e.tick) - 1) / 10);
      let list = byEra.get(era);
      if (!list) { list = []; byEra.set(era, list); }
      list.push(e);
    }
    let html = `<div class="chron"><p class="era">Here is written the story of ${esc(this.worldName || 'the world')}, as its peoples remember it.</p>`;
    const eras = [...byEra.keys()].sort((a, b) => b - a);
    for (const era of eras) {
      const list = byEra.get(era)!;
      html += `<h3>Years ${era * 10 + 1}–${era * 10 + 10}${this.eraName(list, era)}</h3>`;
      // Group by year into short paragraphs.
      const years = new Map<number, GameEvent[]>();
      for (const e of list) { const y = yearOfTick(e.tick); if (!years.has(y)) years.set(y, []); years.get(y)!.push(e); }
      for (const y of [...years.keys()].sort((a, b) => b - a)) {
        // The most important sentences of the year, told in the order they
        // happened (cause before effect: the god's cast before the crater, and
        // before the omens it raises in the same instant).
        const evs = years.get(y)!;
        const byId = new Map(evs.map((e) => [e.id, e]));
        const order = (id: number): [number, number, number] => {
          const e = byId.get(id);
          return e ? [e.tick, e.kind === 'power' ? 0 : 1, id] : [Infinity, 1, id];
        };
        const sentences = mergeYear(evs).sort((a, b) => b.importance - a.importance).slice(0, 8).sort((a, b) => {
          const A = order(a.id), B = order(b.id);
          return A[0] - B[0] || A[1] - B[1] || A[2] - B[2];
        }).map((m) => {
          return `<span class="e" data-ev="${m.id}">${esc(m.text)}</span>`;
        });
        html += `<p><b style="color:var(--gold)">Year ${y}.</b> ${sentences.join(' ')}</p>`;
      }
    }
    if (!this.events.length) html += '<p class="era">Nothing has yet happened worth remembering. Give them time — or give them a reason.</p>';
    html += '</div>';
    this.body.innerHTML = html;
  }

  /** Named after what filled the decade; neighbouring decades of the same
   *  character get different names. */
  private eraName(list: GameEvent[], era: number): string {
    const count = (k: string[]) => list.filter((e) => k.includes(e.kind)).length;
    const war = count(['war', 'holy-war', 'battle', 'siege', 'conquest']);
    const wrath = count(['meteor', 'quake', 'eruption', 'tsunami', 'plague', 'ice-age']);
    const faith = count(['prophet', 'schism', 'religion', 'miracle', 'sacred-site']);
    const growth = count(['settlement-founded', 'settlement-grew', 'tech', 'age']);
    const best = Math.max(war, wrath, faith, growth);
    if (best < 2) return '';
    const pick = (names: string[]) => ` · ${names[era % names.length]}`;
    if (best === wrath) return pick(['The Years of Wrath', 'When the Sky Fell', 'An Age of Ash', 'The Scourging']);
    if (best === war) return pick(['An Age of Spears', 'The Warring Years', 'A Time of Banners', 'The Long Feud']);
    if (best === faith) return pick(['The Years of Wonders', 'An Age of Prophets', 'The Kindling', 'A Time of Visions']);
    return pick(['A Time of Growing', 'The Years of Plenty', 'An Age of Builders', 'The Quickening']);
  }
}

// ------------------------------------------------------------------ ecology
/**
 * Species line styles. Eight categorical hues, validated on the dark panel
 * surface (lightness band, chroma, colour-blind and normal-vision separation,
 * 3:1 contrast), in fixed order and never cycled within a group: herbivores
 * draw solid lines, predators dashed ones in the same hue order, and a species
 * born by speciation keeps its ancestor's hue with a dotted line.
 */
const SPECIES_HUES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
function speciesStyle(list: SpeciesInfo[], i: number): { color: string; dash: number[] } {
  let root = i;
  for (let g = 0; g < 32 && list[root] && list[root].parent >= 0; g++) root = list[root].parent;
  const carn = (k: number) => list[k]?.diet === 'carnivore';
  let rank = 0;
  for (let k = 0; k < root; k++) if (list[k].parent < 0 && carn(k) === carn(root)) rank++;
  const color = SPECIES_HUES[Math.min(rank, SPECIES_HUES.length - 1)];
  const derived = root !== i;
  const dash = carn(root) ? (derived ? [2, 5, 10, 5] : [10, 6]) : (derived ? [2, 5] : []);
  return { color, dash };
}
function speciesSwatch(list: SpeciesInfo[], i: number): string {
  const st = speciesStyle(list, i);
  return `<svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke="${st.color}" stroke-width="2.5" stroke-dasharray="${st.dash.join(' ')}"/></svg>`;
}
const DEATH_CAUSES = ['starvation', 'thirst', 'old age', 'predators', 'disease', 'fire', 'climate', 'disaster'];

export class EcologyPanel extends Modal {
  data: EcologyData | null = null;
  request: () => Promise<EcologyData> = () => Promise.reject(new Error('no source'));
  private hidden = new Set<number>();
  private timer = 0;

  constructor(root: HTMLElement) {
    super(root, 'Ecology', 'leaf');
    this.body.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-sp]') as HTMLElement | null;
      if (!t) return;
      const sp = Number(t.dataset.sp);
      if (this.hidden.has(sp)) this.hidden.delete(sp); else this.hidden.add(sp);
      this.draw();
    });
  }

  override open(): void {
    super.open();
    const refresh = () => {
      if (!this.isOpen) return;
      this.request().then((d) => { this.data = d; this.draw(); }).catch(() => {});
      this.timer = window.setTimeout(refresh, 2500);
    };
    refresh();
  }

  override close(): void {
    clearTimeout(this.timer);
    super.close();
  }

  override render(): void {
    this.body.innerHTML = '<div class="muted">Counting every living thing…</div>';
  }

  private draw(): void {
    const d = this.data;
    if (!d) return;
    const living = d.alive.filter((v) => v > 0).length;
    const extinct = d.records.filter((r) => r.kind === 'extinction').length;
    const born = d.records.filter((r) => r.kind === 'speciation').length;
    const total = d.alive.reduce((a, b) => a + b, 0);
    this.body.innerHTML = `
      <div class="grid2" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
        <div class="card"><h4>Animals</h4><div class="big">${total.toLocaleString()}</div><div class="muted">${living} living species</div></div>
        <div class="card"><h4>Biodiversity</h4><div class="big">${d.shannon.toFixed(2)}</div><div class="muted">Shannon index</div></div>
        <div class="card"><h4>Plant cover</h4><div class="big">${Math.round(d.plantCover * 100)}%</div><div class="muted">of all land</div></div>
        <div class="card"><h4>Evolution</h4><div class="big">${born} <span class="muted">new</span> · ${extinct} <span class="muted">lost</span></div><div class="muted">since the beginning</div></div>
      </div>
      <div class="card" style="margin-bottom:14px"><h4>Populations over time <span class="muted" style="text-transform:none;letter-spacing:0">· square-root scale</span></h4><canvas class="chart pop" width="1640" height="360"></canvas><div class="legend">${d.species.map((s, i) => `<span data-sp="${i}" class="${this.hidden.has(i) ? 'off' : ''}">${speciesSwatch(d.species, i)}${esc(s.name)} ${d.alive[i] ?? 0}</span>`).join('')}</div></div>
      <div class="grid2">
        <div class="card"><h4>The living map</h4><canvas class="chart map" width="640" height="320" style="height:auto;aspect-ratio:2/1"></canvas><div class="legend">${BIOME_NAMES.map((n, i) => `<span><i style="background:${BIOME_COLORS[i]};height:8px"></i>${n}</span>`).join('')}</div></div>
        <div class="card"><h4>How they die</h4>${this.deathTable(d)}<h4 style="margin-top:12px">Evolution</h4>${d.records.slice(-6).reverse().map((r) => `<div class="muted">Year ${Math.floor(r.tick / TICKS_PER_YEAR) + 1}: ${r.kind === 'extinction' ? `the ${esc(r.name)} died out` : `the ${esc(r.name)} arose from the ${esc(r.parent ?? '')}${r.where ? ` in ${esc(r.where)}` : ''}`}</div>`).join('') || '<div class="muted">No species has yet been born or lost.</div>'}</div>
      </div>`;
    this.drawChart(d);
    this.drawMap(d);
  }

  private deathTable(d: EcologyData): string {
    const tot = new Array(8).fill(0);
    for (const row of d.deaths) row.forEach((v, k) => (tot[k] += v));
    const sum = tot.reduce((a, b) => a + b, 0) || 1;
    return tot.map((v, k) => `<div class="meter"><span>${DEATH_CAUSES[k]}</span><div class="track"><div class="fill" style="width:${(v / sum) * 100}%;--mc:#c8a070"></div></div><span class="v">${Math.round((v / sum) * 100)}%</span></div>`).join('');
  }

  private drawChart(d: EcologyData): void {
    const cv = this.body.querySelector('canvas.pop') as HTMLCanvasElement | null;
    if (!cv) return;
    const c = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    c.clearRect(0, 0, W, H);
    let max = 10;
    d.history.forEach((h, i) => { if (!this.hidden.has(i)) for (const v of h) max = Math.max(max, v); });
    // Square-root scale: small populations stay readable beside a boom (on a
    // linear axis six species lay flat along zero), with round tick values.
    // The right margin holds a label at the end of each line: thirteen series
    // share eight hues, so the legend alone could not tell them apart.
    const top = 16, bottom = H - 34, left = 70, right = 170;
    const yOf = (v: number) => bottom - Math.sqrt(Math.max(0, v) / max) * (bottom - top);
    const nice = (v: number) => {
      const p = 10 ** Math.floor(Math.log10(Math.max(1, v)));
      const m = v / p;
      return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
    };
    const ticks = [...new Set([0.06, 0.25, 0.56, 1].map((f) => nice(max * f)))].filter((v) => v <= max);
    c.strokeStyle = 'rgba(255,255,255,0.07)';
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.font = '21px Inter, system-ui, sans-serif';
    c.textAlign = 'right';
    for (const v of [0, ...ticks]) {
      const y = yOf(v);
      c.beginPath(); c.moveTo(left, y); c.lineTo(W - right, y); c.stroke();
      c.fillText(v.toLocaleString(), left - 10, y + 7);
    }
    const n = Math.max(...d.history.map((h) => h.length), 2);
    const years = (n * d.interval) / TICKS_PER_YEAR;
    c.textAlign = 'left';
    c.fillText(`${years.toFixed(0)} years ago`, left, H - 4);
    c.textAlign = 'right';
    c.fillText('now', W - right, H - 4);
    c.textAlign = 'left';
    const ends: { y: number; name: string; color: string }[] = [];
    d.history.forEach((h, i) => {
      if (this.hidden.has(i) || h.length < 2) return;
      const st = speciesStyle(d.species, i);
      c.strokeStyle = st.color;
      c.lineWidth = 2.5;
      c.setLineDash(st.dash);
      c.beginPath();
      h.forEach((v, k) => {
        const x = left + ((k + (n - h.length)) / (n - 1)) * (W - left - right);
        const y = yOf(v);
        if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.stroke();
      if ((d.alive[i] ?? 0) > 0) ends.push({ y: yOf(h[h.length - 1]), name: d.species[i].name, color: st.color });
    });
    c.setLineDash([]);
    // End labels, nudged apart so none overlap (each keeps its line's colour).
    ends.sort((a, b) => a.y - b.y);
    // Within the plot, top and bottom (the highest label was cut by the edge).
    const gap = Math.min(22, (bottom - top - 14) / Math.max(1, ends.length - 1));
    for (let k = 0; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, k ? ends[k - 1].y + gap : top + 14);
    if (ends.length && ends[ends.length - 1].y > bottom) {
      ends[ends.length - 1].y = bottom;
      for (let k = ends.length - 2; k >= 0; k--) ends[k].y = Math.min(ends[k].y, ends[k + 1].y - gap);
    }
    c.font = '19px Inter, system-ui, sans-serif';
    c.textAlign = 'left';
    for (const e of ends) {
      c.fillStyle = e.color;
      c.fillText(e.name, W - right + 12, e.y + 6);
    }
  }

  private drawMap(d: EcologyData): void {
    const cv = this.body.querySelector('canvas.map') as HTMLCanvasElement | null;
    if (!cv) return;
    const c = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    const img = c.createImageData(W, H);
    const n = d.regionN;
    const cols = BIOME_COLORS.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    for (let y = 0; y < H; y++) {
      const lat = (0.5 - (y + 0.5) / H) * Math.PI;
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
        const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = -Math.cos(lat) * Math.sin(lon);
        const f = dirToFaceAB(dx, dy, dz);
        // Blend the four nearest cells' colours: soft biome boundaries instead
        // of the grid's hard blocks.
        const fi = (f.a + 1) * 0.5 * n - 0.5, fj = (f.b + 1) * 0.5 * n - 0.5;
        const i0 = Math.floor(fi), j0 = Math.floor(fj);
        const tx = fi - i0, ty = fj - j0;
        let r = 0, g = 0, bl = 0;
        for (let q = 0; q < 4; q++) {
          const ii = Math.min(n - 1, Math.max(0, i0 + (q & 1))), jj = Math.min(n - 1, Math.max(0, j0 + (q >> 1)));
          const w = (q & 1 ? tx : 1 - tx) * (q >> 1 ? ty : 1 - ty);
          const col = cols[d.biomes[f.face * n * n + jj * n + ii]] ?? [0, 0, 0];
          r += col[0] * w; g += col[1] * w; bl += col[2] * w;
        }
        const o = (y * W + x) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
  }
}

// ------------------------------------------------------------------ peoples
export class TribesPanel extends Modal {
  civ: CivData | null = null;
  onTribe: (id: number) => void = () => {};

  constructor(root: HTMLElement) {
    super(root, 'Peoples of the World', 'flag');
    this.body.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-tribe]') as HTMLElement | null;
      if (t) { this.close(); this.onTribe(Number(t.dataset.tribe)); }
    });
  }

  override render(): void {
    const civ = this.civ;
    if (!civ) { this.body.innerHTML = '<div class="muted">No peoples yet.</div>'; return; }
    const rows = [...civ.tribes].sort((a, b) => Number(b.alive) - Number(a.alive) || b.population - a.population).map((t: TribeData) => {
      const setts = civ.settlements.filter((s) => s.alive && s.tribe === t.id);
      return `<div class="tribe-row" data-tribe="${t.id}">${flagSvg(t.flag)}<div><div class="nm" style="color:${t.alive ? 'var(--text)' : 'var(--text-faint)'}">The ${esc(t.name)}</div><div class="muted">${t.alive ? `${esc(['Stone Age', 'Bronze Age', 'Iron Age', 'Classical Age', 'Medieval Age', 'Renaissance', 'Age of Steam'][t.age] ?? '')} · ${setts.length} settlement${setts.length === 1 ? '' : 's'} · ${t.techCount} discoveries · they worship ${esc(t.deity)} (${esc(t.religion)})` : 'Vanished from the world'}</div></div><div class="big" style="font-size:24px;color:${hex(t.color)}">${t.population}</div></div>`;
    });
    this.body.innerHTML = rows.join('') || '<div class="muted">No peoples yet.</div>';
  }
}

// ------------------------------------------------------------------ settings
export interface Settings {
  quality: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
  master: number;
  music: number;
  sfx: number;
  ui: number;
  colorblind: 0 | 1 | 2 | 3;
  reducedMotion: boolean;
  uiScale: number;
  borders: boolean;
  feed: boolean;
  tutorial: boolean;
  keys: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto', master: 0.8, music: 0.6, sfx: 0.8, ui: 0.6, colorblind: 0, reducedMotion: false, uiScale: 1, borders: true, feed: true, tutorial: true, keys: {},
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('genesis.settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem('genesis.settings', JSON.stringify(s)); } catch { /* storage unavailable */ }
}

export class SettingsPanel extends Modal {
  onChange: (s: Settings) => void = () => {};
  private listening: string | null = null;

  constructor(root: HTMLElement, public settings: Settings, private keys: KeyMap) {
    super(root, 'Settings', 'gear');
    this.body.addEventListener('input', (e) => this.handle(e.target as HTMLElement));
    this.body.addEventListener('change', (e) => this.handle(e.target as HTMLElement));
    this.body.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const seg = t.closest('[data-seg]') as HTMLElement | null;
      if (seg) {
        const [k, v] = seg.dataset.seg!.split(':');
        (this.settings as unknown as Record<string, unknown>)[k] = k === 'colorblind' ? Number(v) : v;
        this.commit();
        return;
      }
      const kb = t.closest('[data-bind]') as HTMLElement | null;
      if (kb) { this.listening = kb.dataset.bind!; this.render(); return; }
      if (t.closest('[data-reset]')) { this.keys.reset(); this.settings.keys = { ...this.keys.bindings }; this.commit(); }
    });
    window.addEventListener('keydown', (e) => {
      if (!this.listening || !this.isOpen) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') this.keys.bind(this.listening, e.code);
      this.listening = null;
      this.settings.keys = { ...this.keys.bindings };
      this.commit();
    }, true);
  }

  private handle(t: HTMLElement): void {
    const k = t.dataset.k;
    if (!k) return;
    const s = this.settings as unknown as Record<string, unknown>;
    if (t instanceof HTMLInputElement && t.type === 'checkbox') s[k] = t.checked;
    else if (t instanceof HTMLInputElement && t.type === 'range') s[k] = Number(t.value) / 100;
    else if (t instanceof HTMLSelectElement) s[k] = t.value;
    this.commit(false);
  }

  private commit(rerender = true): void {
    saveSettings(this.settings);
    this.onChange(this.settings);
    if (rerender) this.render();
  }

  get capturing(): boolean {
    return this.listening !== null;
  }

  override render(): void {
    const s = this.settings;
    const seg = (key: string, opts: [string, string][], cur: string) => `<div class="seg">${opts.map(([v, l]) => `<button data-seg="${key}:${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const range = (key: string, v: number, min = 0, max = 100) => `<input type="range" min="${min}" max="${max}" value="${Math.round(v * 100)}" data-k="${key}">`;
    const groups = ['Time', 'Camera', 'Powers', 'Interface'] as const;
    this.body.innerHTML = `
      <div class="settings">
        <label>Graphics quality</label>${seg('quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], s.quality)}
        <label>Master volume</label>${range('master', s.master)}
        <label>Music</label>${range('music', s.music)}
        <label>Effects</label>${range('sfx', s.sfx)}
        <label>Interface sounds</label>${range('ui', s.ui)}
        <label>Colour vision</label>${seg('colorblind', [['0', 'Standard'], ['1', 'Protanopia'], ['2', 'Deuteranopia'], ['3', 'Tritanopia']], String(s.colorblind))}
        <label>Reduced motion</label><input type="checkbox" data-k="reducedMotion" ${s.reducedMotion ? 'checked' : ''}>
        <label>Interface size</label>${range('uiScale', s.uiScale, 80, 140)}
        <label>Territory borders</label><input type="checkbox" data-k="borders" ${s.borders ? 'checked' : ''}>
        <label>Event notifications</label><input type="checkbox" data-k="feed" ${s.feed ? 'checked' : ''}>
      </div>
      <h3 style="font-family:var(--font-display);font-weight:500;color:var(--gold);margin:22px 0 10px">Controls <button class="btn" data-reset style="float:right">Reset to defaults</button></h3>
      ${groups.map((g) => `<div class="card" style="margin-bottom:10px"><h4>${g}</h4><div class="keylist">${ACTIONS.filter((a) => a.group === g).map((a) => `<span>${esc(a.label)}</span><button data-bind="${a.id}" class="${this.listening === a.id ? 'listening' : ''}">${this.listening === a.id ? 'press a key…' : keyLabel(this.keys.keyOf(a.id))}</button>`).join('')}</div></div>`).join('')}`;
  }
}

// ------------------------------------------------------------------ help
export class HelpPanel extends Modal {
  constructor(root: HTMLElement, private keys: KeyMap) {
    super(root, 'Controls & Help', 'help');
  }

  override render(): void {
    const k = (id: string) => `<kbd>${keyLabel(this.keys.keyOf(id))}</kbd>`;
    this.body.innerHTML = `
      <div class="grid2">
        <div class="card"><h4>Camera</h4><div class="help keylist" style="grid-template-columns:1fr auto">
          <span>Grab and spin the world</span><span><kbd>Left drag</kbd></span>
          <span>Orbit and tilt</span><span><kbd>Right drag</kbd></span>
          <span>Zoom toward the cursor</span><span><kbd>Wheel</kbd></span>
          <span>Fly to a place</span><span><kbd>Double-click</kbd></span>
          <span>Pan</span><span>${k('panN')}${k('panW')}${k('panS')}${k('panE')}</span>
          <span>Rotate / tilt</span><span>${k('rotL')}${k('rotR')} ${k('tiltUp')}${k('tiltDown')}</span>
          <span>Whole planet</span><span>${k('home')}</span>
          <span>Follow selection</span><span>${k('follow')}</span>
          <span>Auto-director</span><span>${k('director')}</span>
          <span>Photo mode</span><span>${k('photo')}</span>
        </div></div>
        <div class="card"><h4>Being a god</h4><div class="help keylist" style="grid-template-columns:1fr auto">
          <span>Select a power</span><span><kbd>Click</kbd> the bar or its key</span>
          <span>Power wheel</span><span>hold ${k('wheel')}</span>
          <span>Cast</span><span><kbd>Left click</kbd></span>
          <span>Cancel</span><span><kbd>Right click</kbd> ${k('cancel')}</span>
          <span>Inspect anything</span><span><kbd>Click</kbd></span>
          <span>Terraform</span><span>${k('terraform')}</span>
          <span>Pause / speed</span><span>${k('pause')} ${k('slower')}${k('faster')}</span>
          <span>Time-lapse</span><span>${k('timelapse')}</span>
          <span>Chronicle / Peoples / Ecology</span><span>${k('chronicle')}${k('tribes')}${k('ecology')}</span>
          <span>Hide interface</span><span>${k('hideUi')}</span>
        </div></div>
      </div>
      <div class="card" style="margin-top:14px"><h4>How the world works</h4><div class="muted" style="font-size:13px;line-height:1.6">
        Nothing here is scripted. Climate emerges from sunlight, winds and oceans; plants follow the climate; herds follow the plants; predators follow the herds; people follow them all.
        Your power is <b>devotion</b> — the faith of mortals. People who witness your deeds come to love or fear you, and both feed you; prayer multiplies it. What you do becomes their scripture, their name for you, the places they hold sacred, and sometimes the reason they go to war.
        Try combining powers: rain on a drought, lightning into a storm, bloom on volcanic ash, a vision during an eclipse.
      </div></div>`;
  }
}

// ------------------------------------------------------------------ saves
export interface SaveSlotInfo {
  slot: string;
  name: string;
  year: number;
  people: number;
  when: number;
}

export interface SaveCallbacks {
  list: () => Promise<SaveSlotInfo[]>;
  save: (slot: string) => Promise<void>;
  load: (slot: string) => Promise<void>;
  remove: (slot: string) => Promise<void>;
  exportFile: () => Promise<void>;
  importFile: (f: File) => Promise<void>;
}

export class SavePanel extends Modal {
  constructor(root: HTMLElement, private cb: SaveCallbacks) {
    super(root, 'Save & Load', 'save');
    this.body.addEventListener('click', async (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const slot = t.dataset.slot ?? '';
      try {
        switch (t.dataset.act) {
          case 'save': await this.cb.save(slot); break;
          case 'load': await this.cb.load(slot); this.close(); return;
          case 'del': await this.cb.remove(slot); break;
          case 'export': await this.cb.exportFile(); break;
          case 'import': (this.body.querySelector('input[type=file]') as HTMLInputElement).click(); return;
        }
      } catch (err) {
        this.body.insertAdjacentHTML('afterbegin', `<div class="muted" style="color:var(--danger);margin-bottom:8px">${esc(String(err))}</div>`);
        return;
      }
      this.render();
    });
    this.body.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      if (input.type !== 'file' || !input.files?.[0]) return;
      try { await this.cb.importFile(input.files[0]); this.close(); } catch (err) { this.body.insertAdjacentHTML('afterbegin', `<div class="muted" style="color:var(--danger)">${esc(String(err))}</div>`); }
    });
  }

  override render(): void {
    this.body.innerHTML = '<div class="muted">Reading the archives…</div>';
    this.cb.list().then((slots) => {
      const names = ['slot1', 'slot2', 'slot3', 'slot4', 'quick'];
      const rows = names.map((n) => {
        const s = slots.find((x) => x.slot === n);
        const label = n === 'quick' ? 'Quick save' : `Slot ${n.slice(4)}`;
        return `<div class="slot"><div><div class="nm">${label}${s ? ` — ${esc(s.name)}` : ''}</div><div class="meta">${s ? `Year ${s.year} · ${s.people} people · saved ${new Date(s.when).toLocaleString()}` : 'Empty'}</div></div><div style="display:flex;gap:4px"><button class="btn" data-act="save" data-slot="${n}">${icon('save', 16)}<span class="label">Save</span></button>${s ? `<button class="btn primary" data-act="load" data-slot="${n}"><span class="label">Load</span></button><button class="btn danger" data-act="del" data-slot="${n}" aria-label="Delete">${icon('trash', 16)}</button>` : ''}</div></div>`;
      });
      this.body.innerHTML = `<div class="slots">${rows.join('')}</div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn" data-act="export">${icon('export', 16)}<span class="label">Export world to file</span></button><button class="btn" data-act="import">${icon('import', 16)}<span class="label">Import world from file</span></button><input type="file" accept=".genesis,application/octet-stream" style="display:none"></div>`;
    }).catch((err) => { this.body.innerHTML = `<div class="muted" style="color:var(--danger)">${esc(String(err))}</div>`; });
  }
}
