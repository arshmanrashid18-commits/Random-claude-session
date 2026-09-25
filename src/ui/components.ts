/**
 * HUD building blocks: top bar (date, time controls, world stats, menus),
 * power bar with devotion orb and terraform tools, event feed, inspector,
 * contextual hint, banner, tooltips, power wheel and the F3 perf overlay.
 * Plain DOM, no framework; every component owns its element.
 */
import { icon } from './icons';
import { POWERS, SCHOOL_NAMES, type PowerDef, type PowerId, type PowerSchool } from '../sim/powers/defs';
import type { InspectInfo, TribeData } from '../worker/protocol';
import type { BrushTool } from '../sim/planet/terraform';
import { PAINT_TARGETS } from '../sim/planet/terraform';
import { narrate, type Narration } from './narrate';
import type { GameEvent } from '../sim/events';
import { keyLabel } from './keys';
import { TICKS_PER_DAY, DAYS_PER_YEAR, SEASON_NAMES, TICKS_PER_YEAR, TICKS_PER_SECOND_1X } from '../sim/constants';
import { FLAG_PATTERNS } from '../sim/civ/tribes';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ------------------------------------------------------------------ tooltip
export class Tooltip {
  readonly el = el('div', 'tip panel');
  private target: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    root.appendChild(this.el);
    document.addEventListener('pointerover', (e) => {
      const t = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (t === this.target) return;
      this.target = t;
      if (!t) { this.el.classList.remove('show'); return; }
      this.el.innerHTML = t.dataset.tip ?? '';
      this.el.classList.add('show');
      this.place(t);
    });
    document.addEventListener('pointerdown', () => { this.el.classList.remove('show'); this.target = null; });
  }

  private place(t: HTMLElement): void {
    const r = t.getBoundingClientRect();
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    let y = r.top - h - 10;
    if (y < 8) y = r.bottom + 10;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}

export function powerTip(p: PowerDef, key: string): string {
  return `<div class="tt">${p.name}</div><div class="tc"><span>${p.cost} devotion</span><span>${SCHOOL_NAMES[p.school]}</span>${key ? `<span><kbd>${keyLabel(key)}</kbd></span>` : ''}</div><div>${esc(p.desc)}</div><div class="te" style="margin-top:4px">${esc(p.effect)}</div>`;
}

// ------------------------------------------------------------------ top bar
export interface HudCallbacks {
  onSpeed: (speed: number, paused: boolean) => void;
  onTimelapse: () => void;
  onMenu: (id: 'chronicle' | 'ecology' | 'tribes' | 'saves' | 'settings' | 'help' | 'photo' | 'director') => void;
}

export class Hud {
  readonly el = el('div', 'hud');
  private year: HTMLElement;
  private season: HTMLElement;
  private worldName: HTMLElement;
  private hand: HTMLElement;
  private seasonIcon: HTMLElement;
  private speedBtns = new Map<string, HTMLButtonElement>();
  private rate: HTMLElement;
  private statEls: Record<string, HTMLElement> = {};
  private menuBtns = new Map<string, HTMLButtonElement>();

  constructor(root: HTMLElement, cb: HudCallbacks) {
    const date = el('div', 'hud-date panel');
    date.innerHTML = `<div class="dial"><div class="season"></div><div class="hand"></div></div><div><div class="year">Year 1</div><div class="season-name">Spring</div><div class="world-name"></div></div>`;
    this.year = date.querySelector('.year')!;
    this.season = date.querySelector('.season-name')!;
    this.worldName = date.querySelector('.world-name')!;
    this.hand = date.querySelector('.hand')!;
    this.seasonIcon = date.querySelector('.season')!;
    date.dataset.tip = '<div class="tt">The turning year</div>Six days make a year; each season lasts a day and a half. The hand shows the time of day at the centre of your view.';

    const time = el('div', 'hud-time panel');
    const mk = (id: string, ic: string, tip: string, fn: () => void) => {
      const b = el('button', 'btn', icon(ic, 18)) as HTMLButtonElement;
      b.dataset.tip = tip;
      b.setAttribute('aria-label', id);
      b.onclick = fn;
      this.speedBtns.set(id, b);
      time.appendChild(b);
    };
    mk('pause', 'pause', '<div class="tt">Pause</div><kbd>Space</kbd>', () => cb.onSpeed(-1, true));
    mk('1', 'play', '<div class="tt">Normal speed</div>A day passes in 40 seconds.', () => cb.onSpeed(1, false));
    mk('10', 'fast', '<div class="tt">Fast</div>Ten times faster. <kbd>.</kbd> / <kbd>,</kbd> change speed.', () => cb.onSpeed(10, false));
    mk('100', 'faster', '<div class="tt">Very fast</div>Generations pass in minutes.', () => cb.onSpeed(100, false));
    time.appendChild(el('div', 'sep'));
    mk('lapse', 'timelapse', '<div class="tt">Cinematic time-lapse</div>The camera drifts while years roll by. <kbd>T</kbd>', () => cb.onTimelapse());
    this.rate = el('div', 'rate');
    time.appendChild(this.rate);

    const right = el('div', 'hud-right');
    const stats = el('div', 'hud-stats panel');
    const stat = (id: string, ic: string, tip: string) => {
      const s = el('div', 'stat', `${icon(ic, 16)}<b>0</b>`);
      s.dataset.tip = tip;
      this.statEls[id] = s.querySelector('b')!;
      stats.appendChild(s);
    };
    stat('people', 'people', '<div class="tt">Mortals</div>Every person alive on the world.');
    stat('tribes', 'flag', '<div class="tt">Peoples</div>Living tribes and nations.');
    stat('animals', 'paw', '<div class="tt">Animals</div>Wild animals, all species.');
    stat('species', 'leaf', '<div class="tt">Species</div>Living animal species, including new ones born of evolution.');
    const menu = el('div', 'hud-menu panel');
    const mb = (id: 'chronicle' | 'ecology' | 'tribes' | 'saves' | 'settings' | 'help' | 'photo' | 'director', ic: string, tip: string) => {
      const b = el('button', 'btn', icon(ic, 18)) as HTMLButtonElement;
      b.dataset.tip = tip;
      b.setAttribute('aria-label', id);
      b.onclick = () => cb.onMenu(id);
      this.menuBtns.set(id, b);
      menu.appendChild(b);
    };
    mb('chronicle', 'book', '<div class="tt">Chronicle</div>The history of your world, as it is told. <kbd>J</kbd>');
    mb('tribes', 'flag', '<div class="tt">Peoples</div>Tribes, faiths, wars and alliances. <kbd>U</kbd>');
    mb('ecology', 'leaf', '<div class="tt">Ecology</div>Populations, biodiversity and the living map. <kbd>K</kbd>');
    mb('director', 'director', '<div class="tt">Auto-director</div>Let the camera find the story. <kbd>O</kbd>');
    mb('photo', 'camera', '<div class="tt">Photo mode</div>Free camera, depth of field, export a PNG. <kbd>P</kbd>');
    mb('saves', 'save', '<div class="tt">Save & load</div><kbd>F5</kbd> quick save · <kbd>F9</kbd> quick load');
    mb('settings', 'gear', '<div class="tt">Settings</div>Quality, audio, accessibility, controls.');
    mb('help', 'help', '<div class="tt">Controls & help</div><kbd>/</kbd>');
    right.append(stats, menu);
    this.el.append(date, time, right);
    root.appendChild(this.el);
  }

  setWorldName(name: string): void {
    this.worldName.textContent = name;
  }

  update(tick: number, localDay: number, speed: number, paused: boolean, tps: number, stats: { people: number; tribes: number; animals: number; species: number }, timelapse: boolean, director: boolean): void {
    const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
    const dayOfYear = (tick / TICKS_PER_DAY) % DAYS_PER_YEAR;
    const season = Math.floor((dayOfYear / DAYS_PER_YEAR) * 4) % 4;
    const sub = ((dayOfYear / DAYS_PER_YEAR) * 4) % 1;
    const phase = sub < 0.33 ? 'Early' : sub < 0.66 ? 'Mid' : 'Late';
    this.year.textContent = `Year ${year}`;
    this.season.textContent = `${phase} ${SEASON_NAMES[season].toLowerCase()} · day ${Math.floor(dayOfYear) + 1}`;
    this.hand.style.transform = `rotate(${localDay * 360 + 180}deg)`;
    const sIcon = ['bloom', 'sun', 'leaf', 'iceage'][season];
    if (this.seasonIcon.dataset.s !== sIcon) { this.seasonIcon.dataset.s = sIcon; this.seasonIcon.innerHTML = icon(sIcon, 14); }
    for (const [id, b] of this.speedBtns) {
      const on = id === 'pause' ? paused : id === 'lapse' ? timelapse : !paused && String(speed) === id;
      b.classList.toggle('active', on);
    }
    this.menuBtns.get('director')?.classList.toggle('active', director);
    const want = paused ? 0 : TICKS_PER_SECOND_1X * speed;
    this.rate.textContent = paused ? 'paused' : tps < want * 0.8 && speed > 1 ? `${(tps / TICKS_PER_SECOND_1X).toFixed(0)}× max` : `${speed}×`;
    this.statEls.people.textContent = stats.people.toLocaleString();
    this.statEls.tribes.textContent = String(stats.tribes);
    this.statEls.animals.textContent = stats.animals.toLocaleString();
    this.statEls.species.textContent = String(stats.species);
  }
}

// ------------------------------------------------------------------ power bar
export interface PowerBarCallbacks {
  onPower: (p: PowerId) => void;
  onTool: (t: BrushTool | null) => void;
  onToolOpts: (radius: number, strength: number, paint: number) => void;
}

const SCHOOL_ORDER: PowerSchool[] = ['sky', 'earth', 'life', 'spirit'];

export class PowerBar {
  readonly el = el('div', 'powerbar');
  private orb: HTMLElement;
  private val: HTMLElement;
  private rateEl: HTMLElement;
  private ring: SVGCircleElement;
  private btns = new Map<PowerId, HTMLElement>();
  private toolBtns = new Map<string, HTMLElement>();
  private tools: HTMLElement;
  private schools: HTMLElement;
  private wasReady = new Map<PowerId, boolean>();
  private lastDevotion = 0;
  selected: PowerId | null = null;
  tool: BrushTool | null = null;
  terraformOpen = false;
  radius = 30;
  strength = 0.5;
  paint = 0;

  constructor(root: HTMLElement, private cb: PowerBarCallbacks, keyOf: (id: string) => string) {
    this.orb = el('div', 'devotion');
    this.orb.innerHTML = `<svg class="ring" width="80" height="80" viewBox="0 0 80 80"><circle cx="40" cy="40" r="38" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="2"/><circle class="arc" cx="40" cy="40" r="38" fill="none" stroke="#f2c572" stroke-width="2" stroke-linecap="round" stroke-dasharray="238.8" stroke-dashoffset="238.8"/></svg><div><div class="val">0</div><div class="lbl">Devotion</div><div class="rate">+0/day</div></div>`;
    this.orb.dataset.tip = '<div class="tt">Devotion</div>The faith of mortals is your power. Love and fear both feed it; prayer multiplies it. Acts they witness change how they feel.';
    this.val = this.orb.querySelector('.val')!;
    this.rateEl = this.orb.querySelector('.rate')!;
    this.ring = this.orb.querySelector('.arc')!;
    this.schools = el('div', 'schools panel');
    for (const school of SCHOOL_ORDER) {
      const col = el('div', 'school');
      col.appendChild(el('div', 'school-name', SCHOOL_NAMES[school]));
      const row = el('div', 'school-row');
      for (const p of POWERS.filter((x) => x.school === school)) {
        const b = el('div', 'pw', `${icon(p.id, 24)}<span class="cost">${p.cost}</span><span class="key">${keyLabel(keyOf(`power:${p.id}`)).slice(0, 3)}</span><div class="cd"></div>`);
        b.style.setProperty('--pw', hex(p.color));
        b.dataset.tip = powerTip(p, keyOf(`power:${p.id}`));
        b.setAttribute('role', 'button');
        b.setAttribute('aria-label', p.name);
        b.tabIndex = 0;
        b.onclick = () => cb.onPower(p.id);
        b.onkeydown = (e) => { if (e.key === 'Enter') cb.onPower(p.id); };
        this.btns.set(p.id, b);
        row.appendChild(b);
      }
      col.appendChild(row);
      this.schools.appendChild(col);
    }
    // Terraform toggle + tools.
    const tcol = el('div', 'school');
    tcol.appendChild(el('div', 'school-name', 'Shape'));
    const trow = el('div', 'school-row');
    const tf = el('div', 'pw', icon('hammer', 24));
    tf.style.setProperty('--pw', '#d9c7a0');
    tf.dataset.tip = '<div class="tt">Terraform</div>Raise mountains, carve valleys, flood lowlands, paint climates. Free of cost. <kbd>Y</kbd>';
    tf.onclick = () => this.toggleTerraform();
    this.toolBtns.set('toggle', tf);
    trow.appendChild(tf);
    tcol.appendChild(trow);
    this.schools.appendChild(tcol);

    this.tools = el('div', 'tools panel');
    this.tools.style.display = 'none';
    const row = el('div', 'tool-row');
    const TOOL_TIPS: Record<BrushTool, string> = {
      raise: 'Raise the land. Hold and drag.', lower: 'Lower the land; dig below sea level for new seas.', smooth: 'Soften slopes and peaks.',
      flatten: 'Level the ground to the height where you first click.', flood: 'Sink the land beneath the waves.', drain: 'Lift seabeds and lakebeds into dry land.',
      paint: 'Nudge the local climate toward a biome; life will follow.',
    };
    for (const t of ['raise', 'lower', 'smooth', 'flatten', 'flood', 'drain', 'paint'] as BrushTool[]) {
      const b = el('div', 'pw', icon(t, 20));
      b.dataset.tip = `<div class="tt">${t[0].toUpperCase() + t.slice(1)}</div>${TOOL_TIPS[t]}`;
      b.onclick = () => { this.tool = this.tool === t ? null : t; this.selected = null; cb.onTool(this.tool); this.refreshSel(); };
      this.toolBtns.set(t, b);
      row.appendChild(b);
    }
    const opts = el('div', 'tool-opts');
    opts.innerHTML = `<label>Size <input type="range" min="8" max="120" value="30" class="r"></label><label>Strength <input type="range" min="5" max="100" value="50" class="s"></label><label class="pl">Biome <select class="p">${PAINT_TARGETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}</select></label>`;
    const r = opts.querySelector('.r') as HTMLInputElement, st = opts.querySelector('.s') as HTMLInputElement, pl = opts.querySelector('.p') as HTMLSelectElement;
    const fire = () => { this.radius = Number(r.value); this.strength = Number(st.value) / 100; this.paint = Number(pl.value); cb.onToolOpts(this.radius, this.strength, this.paint); };
    r.oninput = fire; st.oninput = fire; pl.onchange = fire;
    this.tools.append(row, opts);
    this.el.append(this.orb, this.schools, this.tools);
    root.appendChild(this.el);
  }

  toggleTerraform(force?: boolean): void {
    this.terraformOpen = force ?? !this.terraformOpen;
    this.tools.style.display = this.terraformOpen ? '' : 'none';
    this.toolBtns.get('toggle')!.classList.toggle('selected', this.terraformOpen);
    if (!this.terraformOpen && this.tool) { this.tool = null; this.cb.onTool(null); }
    if (this.terraformOpen && !this.tool) { this.tool = 'raise'; this.selected = null; this.cb.onTool('raise'); }
    this.refreshSel();
  }

  setSelected(p: PowerId | null): void {
    this.selected = p;
    if (p) { this.tool = null; }
    this.refreshSel();
  }

  private refreshSel(): void {
    for (const [id, b] of this.btns) b.classList.toggle('selected', id === this.selected);
    for (const [id, b] of this.toolBtns) if (id !== 'toggle') b.classList.toggle('selected', id === this.tool);
  }

  update(devotion: number, rate: number, cooldowns: number[], boundless: boolean): void {
    this.val.textContent = boundless ? '∞' : Math.floor(devotion).toLocaleString();
    this.rateEl.textContent = boundless ? 'boundless' : `+${rate.toFixed(rate < 10 ? 1 : 0)}/day`;
    const maxCost = 600;
    this.ring.style.strokeDashoffset = String(238.8 * (1 - Math.min(1, boundless ? 1 : devotion / maxCost)));
    if (devotion > this.lastDevotion + 30) { this.orb.classList.remove('pulse'); void this.orb.offsetWidth; this.orb.classList.add('pulse'); }
    this.lastDevotion = devotion;
    POWERS.forEach((p, i) => {
      const b = this.btns.get(p.id)!;
      const cd = cooldowns[i] ?? 0;
      const frac = cd > 0 ? Math.min(1, cd / Math.max(1, p.cooldown)) : 0;
      (b.querySelector('.cd') as HTMLElement).style.setProperty('--cd', `${(frac * 100).toFixed(1)}%`);
      const ready = cd <= 0 && (boundless || devotion >= p.cost);
      b.classList.toggle('poor', !ready);
      if (ready && this.wasReady.get(p.id) === false) { b.classList.remove('ready-flash'); void b.offsetWidth; b.classList.add('ready-flash'); }
      this.wasReady.set(p.id, ready);
    });
  }
}

// ------------------------------------------------------------------ feed
export class Feed {
  readonly el = el('div', 'feed');
  onGoto: (e: GameEvent) => void = () => {};
  private items: { el: HTMLElement; born: number; kind: string; count: number; title: string }[] = [];
  minImportance = 0.42;

  constructor(root: HTMLElement) {
    root.appendChild(this.el);
  }

  push(e: GameEvent, n: Narration = narrate(e)): void {
    // Many of the same thing at once collapse into one notice.
    const top = this.items[0];
    if (top && top.kind === e.kind && performance.now() - top.born < 4000) {
      top.count++;
      top.born = performance.now();
      const d = top.el.querySelector('.d');
      if (d) d.textContent = `${n.text} (and ${top.count - 1} more)`;
      return;
    }
    const item = el('div', `feed-item panel tone-${n.tone}`, `<div class="ic">${icon(n.icon, 18)}</div><div><div class="t">${esc(n.title)}</div><div class="d">${esc(n.text)}</div></div>`);
    if (e.x || e.y || e.z) item.dataset.tip = 'Click to look';
    item.onclick = () => this.onGoto(e);
    this.el.prepend(item);
    this.items.unshift({ el: item, born: performance.now(), kind: e.kind, count: 1, title: n.title });
    while (this.items.length > 6) this.items.pop()!.el.remove();
  }

  update(now: number): void {
    for (const it of this.items) {
      const age = now - it.born;
      if (age > 9000 && !it.el.classList.contains('out')) {
        it.el.classList.add('out');
        setTimeout(() => it.el.remove(), 700);
      }
    }
    this.items = this.items.filter((it) => now - it.born < 9700);
  }
}

// ------------------------------------------------------------------ hint & banner
export class Hint {
  readonly el = el('div', 'hint panel');
  private timer = 0;
  private sticky = '';

  constructor(root: HTMLElement) {
    root.appendChild(this.el);
  }

  /** A persistent contextual hint ('' clears). */
  setSticky(html: string): void {
    this.sticky = html;
    if (!this.timer) this.render(html, false);
  }

  flash(html: string, bad = false, ms = 2600): void {
    this.render(html, bad);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = 0; this.render(this.sticky, false); }, ms);
  }

  private render(html: string, bad: boolean): void {
    this.el.innerHTML = html;
    this.el.classList.toggle('show', !!html);
    this.el.classList.toggle('bad', bad);
  }
}

export class Banner {
  readonly el = el('div', 'banner');
  private timer = 0;

  constructor(root: HTMLElement) {
    root.appendChild(this.el);
  }

  show(title: string, sub: string, ms = 4200): void {
    this.el.innerHTML = `<div class="b1">${esc(title)}</div><div class="b2">${esc(sub)}</div>`;
    this.el.classList.add('show');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.el.classList.remove('show'), ms);
  }
}

// ------------------------------------------------------------------ flags
export function flagSvg(f: TribeData['flag'], w = 34, h = 24): string {
  const bg = hex(f.bg), fg = hex(f.fg), sc = hex(f.symColor);
  let pat = '';
  switch (FLAG_PATTERNS[f.pattern]) {
    case 'band': pat = `<rect y="8" width="36" height="8" fill="${fg}"/>`; break;
    case 'pale': pat = `<rect x="12" width="12" height="24" fill="${fg}"/>`; break;
    case 'cross': pat = `<rect x="10" width="5" height="24" fill="${fg}"/><rect y="9.5" width="36" height="5" fill="${fg}"/>`; break;
    case 'bend': pat = `<path d="M0 24 L0 18 L30 0 L36 0 L36 6 L6 24z" fill="${fg}"/>`; break;
    case 'quartered': pat = `<rect width="18" height="12" fill="${fg}"/><rect x="18" y="12" width="18" height="12" fill="${fg}"/>`; break;
    case 'bordure': pat = `<rect x="1.5" y="1.5" width="33" height="21" fill="none" stroke="${fg}" stroke-width="3"/>`; break;
    case 'chevron': pat = `<path d="M0 0 L18 12 L0 24z" fill="${fg}"/>`; break;
    default: break;
  }
  const sym = ['', '<circle cx="24" cy="12" r="4.5"/>', '<path d="M26 7a5 5 0 1 0 0 10 4 4 0 0 1 0-10z"/>', '<path d="M24 6.5l1.6 3.6 3.9.4-2.9 2.6.8 3.8L24 15l-3.4 1.9.8-3.8-2.9-2.6 3.9-.4z"/>',
    '<path d="M24 5l5 9h-3l3 5h-10l3-5h-3z"/>', '<path d="M17 18l5-9 3 5 2-3 4 7z"/>', '<path d="M17 13c2-3 4-3 6 0s4 3 6 0M17 17c2-3 4-3 6 0s4 3 6 0"/>',
    '<path d="M17.5 12s2.8-4 6.5-4 6.5 4 6.5 4-2.8 4-6.5 4-6.5-4-6.5-4z"/><circle cx="24" cy="12" r="1.8"/>', '<path d="M24 5c3 3 4 5 4 8a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-2-1-4 0-7z"/>'][f.symbol] ?? '';
  return `<svg class="flag-svg" width="${w}" height="${h}" viewBox="0 0 36 24"><rect width="36" height="24" fill="${bg}"/>${pat}<g fill="${sc}" stroke="${sc}" stroke-width="0.6">${sym}</g></svg>`;
}

// ------------------------------------------------------------------ inspector
export interface InspectorCallbacks {
  onClose: () => void;
  onFollow: () => void;
  onFocus: () => void;
  onOpen: (target: { kind: 'tribe'; id: number } | { kind: 'settlement'; id: number }) => void;
}

export class Inspector {
  readonly el = el('div', 'inspector panel hidden');
  info: InspectInfo | null = null;
  following = false;

  constructor(root: HTMLElement, cb: InspectorCallbacks) {
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const act = t.dataset.act!;
      if (act === 'close') cb.onClose();
      else if (act === 'follow') cb.onFollow();
      else if (act === 'focus') cb.onFocus();
      else if (act === 'tribe') cb.onOpen({ kind: 'tribe', id: Number(t.dataset.id) });
      else if (act === 'settlement') cb.onOpen({ kind: 'settlement', id: Number(t.dataset.id) });
    });
  }

  hide(): void {
    this.info = null;
    this.el.classList.add('hidden');
  }

  show(info: InspectInfo, tribes: TribeData[]): void {
    this.info = info;
    this.el.classList.remove('hidden');
    this.el.innerHTML = this.render(info, tribes);
  }

  private meter(label: string, v: number, color = 'var(--gold)', text?: string): string {
    return `<div class="meter"><span>${label}</span><div class="track"><div class="fill" style="width:${pct(v)};--mc:${color}"></div></div><span class="v">${text ?? pct(v)}</span></div>`;
  }

  private head(sw: string, name: string, sub: string, followable: boolean): string {
    return `<div class="insp-head">${sw}<div><div class="name">${esc(name)}</div><div class="sub">${sub}</div></div><div class="tools-r">${followable ? `<button class="btn ${this.following ? 'active' : ''}" data-act="follow" data-tip="Follow <kbd>L</kbd>">${icon('follow', 16)}</button>` : ''}<button class="btn" data-act="focus" data-tip="Look">${icon('target', 16)}</button><button class="btn" data-act="close" data-tip="Close <kbd>Esc</kbd>">${icon('close', 16)}</button></div></div>`;
  }

  private render(info: InspectInfo, tribes: TribeData[]): string {
    switch (info.kind) {
      case 'person': {
        const t = tribes[info.tribe];
        const sw = `<div class="swatch" style="background:${t ? hex(t.color) : '#888'}">${icon(info.role ? 'crown' : 'people', 18)}</div>`;
        const title = `${info.role ? `${info.role} · ` : ''}${info.sex ? 'Man' : 'Woman'}, ${Math.floor(info.age)}`;
        const sub = `${title}<br><span class="link" data-act="tribe" data-id="${info.tribe}">${esc(info.tribeName)}</span> of <span class="link" data-act="settlement" data-id="${info.settlementId}">${esc(info.settlement)}</span>`;
        return this.head(sw, info.name, sub, true) + `
          <div class="insp-sec"><div class="chips"><span class="chip"><b>${esc(info.job)}</b></span><span class="chip">${esc(info.state)}</span>${info.sick ? '<span class="chip" style="color:#b8e07a">Sick</span>' : ''}${info.returned ? '<span class="chip" style="color:#fff4d0">Returned from death</span>' : ''}${info.kills ? `<span class="chip">${info.kills} kills</span>` : ''}</div></div>
          <div class="insp-sec"><h4>Needs</h4>${this.meter('Health', info.health, '#8fdc8a')}${this.meter('Fed', 1 - info.hunger, '#e8c07a')}${this.meter('Happiness', info.happiness, '#8fc6ff')}</div>
          <div class="insp-sec"><h4>Faith</h4>${this.meter('Love', info.love, '#ffd98a')}${this.meter('Fear', info.fear, '#ff8a6a')}${info.memory ? `<div class="quote" style="margin-top:8px">“${esc(info.memory)}”</div>` : ''}</div>
          <div class="insp-sec"><h4>Skills</h4>${this.meter('Farming', info.skills.farm)}${this.meter('Building', info.skills.build)}${this.meter('Fighting', info.skills.fight)}${this.meter('Lore', info.skills.lore)}</div>
          <div class="insp-sec"><h4>Nature</h4><div class="chips">${Object.entries(info.traits).map(([k, v]) => `<span class="chip">${k} <b>${Math.round(v * 10)}</b></span>`).join('')}</div></div>
          <div class="insp-sec"><dl class="kv"><dt>Spouse</dt><dd>${esc(info.spouse || '—')}</dd><dt>Children</dt><dd>${info.children}</dd><dt>Generation</dt><dd>${info.generation + 1}</dd></dl></div>`;
      }
      case 'animal': {
        const sub = `${info.sex ? 'Male' : 'Female'}, ${info.age.toFixed(1)} years · ${info.diet}<br>${info.population.toLocaleString()} of its kind alive`;
        return this.head(`<div class="swatch" style="background:#c8b890">${icon('paw', 18)}</div>`, info.species, sub, true) + `
          <div class="insp-sec"><div class="chips"><span class="chip"><b>${esc(info.state)}</b></span>${info.infected ? '<span class="chip" style="color:#b8e07a">Diseased</span>' : ''}<span class="chip">generation ${info.generation + 1}</span></div></div>
          <div class="insp-sec"><h4>Condition</h4>${this.meter('Health', info.health, '#8fdc8a')}${this.meter('Fed', 1 - info.hunger, '#e8c07a')}${this.meter('Watered', 1 - info.thirst, '#8fc6ff')}</div>
          <div class="insp-sec"><h4>Genes</h4>${this.meter('Speed', info.genes.speed / 1.6, '#c8b0ff', info.genes.speed.toFixed(2))}${this.meter('Size', info.genes.size / 1.6, '#c8b0ff', info.genes.size.toFixed(2))}${this.meter('Fertility', info.genes.fertility / 1.6, '#c8b0ff', info.genes.fertility.toFixed(2))}${this.meter('Cold', info.genes.cold, '#9ad8ff', info.genes.cold.toFixed(2))}${this.meter('Heat', info.genes.heat, '#ffb080', info.genes.heat.toFixed(2))}</div>`;
      }
      case 'settlement': {
        const t = tribes[info.tribe];
        const sw = t ? `<div class="swatch" style="background:transparent">${flagSvg(t.flag, 30, 22)}</div>` : '';
        const sub = `${info.tier}${info.capital ? ' · capital' : ''} of the <span class="link" data-act="tribe" data-id="${info.tribe}">${esc(info.tribeName)}</span><br>${esc(info.where)} · founded year ${info.founded}`;
        const res = ['Food', 'Wood', 'Stone', 'Metal'];
        return this.head(sw, info.name, sub, false) + `
          <div class="insp-sec"><div class="chips"><span class="chip"><b>${info.pop}</b> people</span><span class="chip">housing <b>${info.housing}</b></span>${info.walls ? '<span class="chip">walled</span>' : ''}${info.blessed ? '<span class="chip" style="color:#ffe08a">Blessed</span>' : ''}${info.famine ? '<span class="chip" style="color:#ff9a7a">Famine</span>' : ''}${info.disease > 0.03 ? `<span class="chip" style="color:#b8e07a">Plague ${pct(info.disease)}</span>` : ''}</div></div>
          <div class="insp-sec"><h4>Stores</h4><div class="chips">${info.stock.map((v, i) => `<span class="chip">${res[i]} <b>${Math.floor(v)}</b></span>`).join('')}</div></div>
          <div class="insp-sec"><h4>Mood</h4>${this.meter('Happiness', info.happiness, '#8fc6ff')}${this.meter('Faith', Math.min(1, info.faith), '#ffd98a')}</div>
          <div class="insp-sec"><h4>Buildings</h4><div class="chips">${info.buildings.map((b) => `<span class="chip">${esc(b.name)} <b>${b.count}</b></span>`).join('') || '<span class="muted">None yet</span>'}</div></div>
          <div class="insp-sec"><h4>Work</h4><div class="chips">${info.jobs.map((j) => `<span class="chip">${esc(j.name)} <b>${j.count}</b></span>`).join('')}</div></div>`;
      }
      case 'tribe': {
        const sub = `${info.age} · ${info.population} people${info.alive ? '' : ' · <span style="color:var(--danger)">vanished</span>'}`;
        return this.head(`<div class="swatch" style="background:transparent">${flagSvg(info.flag, 30, 22)}</div>`, `The ${info.name}`, sub, false) + `
          <div class="insp-sec"><h4>Faith</h4><div class="quote">${esc(info.religion)} — they call you <b>${esc(info.deity)}</b></div>${this.meter('Love', info.love, '#ffd98a')}${this.meter('Fear', info.fear, '#ff8a6a')}${info.best ? `<div class="muted" style="margin-top:6px">Most cherished: ${esc(info.best)}</div>` : ''}${info.worst ? `<div class="muted">Most feared: ${esc(info.worst)}</div>` : ''}</div>
          <div class="insp-sec"><h4>Settlements</h4><div class="chips">${info.settlements.map((s) => `<span class="chip link" data-act="settlement" data-id="${s.id}">${esc(s.name)} <b>${s.pop}</b></span>`).join('')}</div></div>
          <div class="insp-sec"><h4>Relations</h4>${info.relations.map((r) => `<div class="meter"><span>${esc(r.tribe)}</span><div class="track"><div class="fill" style="width:${pct((r.opinion + 1) / 2)};--mc:${r.war ? '#e0605a' : r.pact === 2 ? '#8fdc8a' : '#8fc6ff'}"></div></div><span class="v">${r.war ? 'war' : r.pact === 2 ? 'ally' : r.pact === 1 ? 'trade' : ''}</span></div>`).join('') || '<span class="muted">They know of no other people.</span>'}</div>
          <div class="insp-sec"><h4>Research</h4>${info.researching.slice(0, 4).map((r) => `<div class="muted">${esc(r)}</div>`).join('')}<div class="muted" style="margin-top:4px">${info.techs.length} discoveries</div></div>
          ${info.scripture.length ? `<div class="insp-sec"><h4>Scripture</h4>${info.scripture.slice(-3).map((l) => `<div class="quote" style="margin-bottom:6px">${esc(l)}</div>`).join('')}</div>` : ''}`;
      }
      case 'place': {
        const sub = `${esc(info.region)}${info.owner ? `<br>Land of ${esc(info.owner)}` : ''}`;
        return this.head(`<div class="swatch" style="background:#7fb07a">${icon('globe', 18)}</div>`, info.biome, sub, false) + `
          <div class="insp-sec"><dl class="kv"><dt>Temperature</dt><dd>${info.temp.toFixed(1)} °C</dd><dt>Rainfall</dt><dd>${info.rain.toFixed(2)} m/yr</dd><dt>Elevation</dt><dd>${(info.elevation * 60).toFixed(0)} m</dd><dt>Soil moisture</dt><dd>${pct(info.soil)}</dd>${info.fire > 0 ? `<dt>Fire</dt><dd style="color:var(--danger)">${pct(info.fire)}</dd>` : ''}</dl></div>
          <div class="insp-sec"><h4>Plant life</h4>${info.plants.map((p) => this.meter(p.name.split(' ')[0], p.density, '#8fdc8a')).join('') || '<span class="muted">Barren</span>'}</div>`;
      }
    }
  }
}

// ------------------------------------------------------------------ power wheel
export class Wheel {
  readonly el = el('div', 'wheel');
  private svg: SVGSVGElement;
  private label: HTMLElement;
  open = false;
  hover: PowerId | null = null;
  private cx = 0;
  private cy = 0;

  constructor(root: HTMLElement) {
    const n = POWERS.length;
    const R0 = 58, R1 = 150;
    let paths = '';
    POWERS.forEach((p, i) => {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2, a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
      const pt = (r: number, a: number) => `${160 + Math.cos(a) * r},${160 + Math.sin(a) * r}`;
      paths += `<path data-id="${p.id}" d="M${pt(R0, a0)} L${pt(R1, a0)} A${R1} ${R1} 0 0 1 ${pt(R1, a1)} L${pt(R0, a1)} A${R0} ${R0} 0 0 0 ${pt(R0, a0)}z" fill="rgba(12,16,26,0.82)" stroke="rgba(255,226,168,0.18)" stroke-width="1"/>`;
      const am = (a0 + a1) / 2;
      const ix = 160 + Math.cos(am) * 112 - 11, iy = 160 + Math.sin(am) * 112 - 11;
      paths += `<g transform="translate(${ix},${iy})" style="color:${hex(p.color)}">${icon(p.id, 22).replace('<svg', '<svg x="0" y="0"')}</g>`;
    });
    this.el.innerHTML = `<svg width="320" height="320" viewBox="0 0 320 320">${paths}</svg><div class="wlabel"></div>`;
    this.svg = this.el.querySelector('svg')!;
    this.label = this.el.querySelector('.wlabel')!;
    root.appendChild(this.el);
  }

  show(x: number, y: number): void {
    this.cx = x; this.cy = y;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.open = true;
    this.hover = null;
    this.el.classList.add('open');
    this.label.innerHTML = '<small>Choose a power</small>';
  }

  hide(): PowerId | null {
    this.open = false;
    this.el.classList.remove('open');
    return this.hover;
  }

  move(x: number, y: number, devotion: number): void {
    if (!this.open) return;
    const dx = x - this.cx, dy = y - this.cy;
    const r = Math.hypot(dx, dy);
    const n = POWERS.length;
    let id: PowerId | null = null;
    if (r > 40) {
      let a = Math.atan2(dy, dx) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      id = POWERS[Math.floor((a / (Math.PI * 2)) * n) % n].id;
    }
    if (id === this.hover) return;
    this.hover = id;
    for (const p of this.svg.querySelectorAll('path')) {
      const on = p.dataset.id === id;
      const def = POWERS.find((q) => q.id === p.dataset.id)!;
      p.setAttribute('fill', on ? `${hex(def.color)}44` : 'rgba(12,16,26,0.82)');
      p.setAttribute('stroke', on ? hex(def.color) : 'rgba(255,226,168,0.18)');
    }
    const def = POWERS.find((q) => q.id === id);
    this.label.innerHTML = def ? `${def.name}<small>${def.cost} devotion${devotion < def.cost ? ' · not enough' : ''}</small>` : '<small>Choose a power</small>';
  }
}

// ------------------------------------------------------------------ perf overlay
export class PerfOverlay {
  readonly el = el('div', 'perf panel');
  private text = el('div');
  private canvas = el('canvas') as HTMLCanvasElement;
  private hist: number[] = [];
  visible = false;

  constructor(root: HTMLElement) {
    this.canvas.width = 220;
    this.canvas.height = 44;
    this.el.append(this.text, this.canvas);
    this.el.style.display = 'none';
    root.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? '' : 'none';
  }

  update(frameMs: number, lines: string[]): void {
    this.hist.push(frameMs);
    if (this.hist.length > 110) this.hist.shift();
    if (!this.visible) return;
    this.text.textContent = lines.join('\n');
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 220, 44);
    c.strokeStyle = 'rgba(255,255,255,0.15)';
    c.beginPath(); c.moveTo(0, 44 - 16.7 * 1.3); c.lineTo(220, 44 - 16.7 * 1.3); c.stroke();
    this.hist.forEach((v, i) => {
      c.fillStyle = v > 33 ? '#ff7a5c' : v > 17.5 ? '#f2c572' : '#8fdc8a';
      const h = Math.min(44, v * 1.3);
      c.fillRect(i * 2, 44 - h, 1.6, h);
    });
  }
}
