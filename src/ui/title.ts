/**
 * Title screen over the live planet: begin, forge a new world (preset and
 * seed), choose a scenario, load, settings. Also the scenario objective
 * tracker, the scenario ending card and the first-play tutorial.
 */
import { el } from './components';
import { icon } from './icons';
import { WORLD_PRESETS, type WorldPresetId } from '../sim/planet/presets';
import { SCENARIOS } from '../sim/scenarios';

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface TitleCallbacks {
  onBegin: () => void;
  onNewWorld: (seed: number, preset: WorldPresetId) => void;
  onScenario: (id: string) => void;
  onLoad: () => void;
  onSettings: () => void;
  onHelp: () => void;
}

export class TitleScreen {
  readonly el = el('div', 'title');
  private page: 'main' | 'new' | 'scenarios' = 'main';
  private preset: WorldPresetId = 'earthlike';
  private seed = 0;

  constructor(root: HTMLElement, private cb: TitleCallbacks, private worldName: string, currentSeed: number, currentPreset: WorldPresetId) {
    this.seed = currentSeed;
    this.preset = currentPreset;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.click(e));
    this.render();
  }

  private click(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    switch (t.dataset.act) {
      case 'begin': this.cb.onBegin(); break;
      case 'new': this.page = 'new'; this.render(); break;
      case 'scenarios': this.page = 'scenarios'; this.render(); break;
      case 'back': this.page = 'main'; this.render(); break;
      case 'load': this.cb.onLoad(); break;
      case 'settings': this.cb.onSettings(); break;
      case 'help': this.cb.onHelp(); break;
      case 'preset': this.preset = t.dataset.id as WorldPresetId; this.render(); break;
      case 'dice': this.seed = Math.floor(Math.random() * 1e9); this.render(); break;
      case 'create': {
        const input = this.el.querySelector('input.seed') as HTMLInputElement | null;
        const v = input ? Number(input.value.replace(/\D/g, '')) : this.seed;
        this.cb.onNewWorld(Number.isFinite(v) && v > 0 ? v : this.seed, this.preset);
        break;
      }
      case 'scenario': this.cb.onScenario(t.dataset.id!); break;
    }
  }

  hide(): void {
    this.el.classList.add('gone');
    setTimeout(() => this.el.remove(), 1400);
  }

  private render(): void {
    let body = '';
    if (this.page === 'main') {
      body = `
        <div class="t-menu">
          <button class="t-btn primary" data-act="begin">${icon('sun', 18)}<span>Begin</span><small>Watch over ${esc(this.worldName)}</small></button>
          <button class="t-btn" data-act="new">${icon('globe', 18)}<span>Forge a new world</span></button>
          <button class="t-btn" data-act="scenarios">${icon('scroll', 18)}<span>Scenarios</span></button>
          <button class="t-btn" data-act="load">${icon('save', 18)}<span>Load a world</span></button>
          <div class="t-row"><button class="btn" data-act="settings">${icon('gear', 18)}<span class="label">Settings</span></button><button class="btn" data-act="help">${icon('help', 18)}<span class="label">How to play</span></button></div>
        </div>`;
    } else if (this.page === 'new') {
      body = `
        <div class="t-panel panel">
          <h3>Forge a new world</h3>
          <div class="presets">${(Object.keys(WORLD_PRESETS) as WorldPresetId[]).map((id) => `<button class="preset ${id === this.preset ? 'on' : ''}" data-act="preset" data-id="${id}"><b>${WORLD_PRESETS[id].name}</b><span>${esc(WORLD_PRESETS[id].blurb)}</span></button>`).join('')}</div>
          <div class="seedrow"><label>Seed</label><input class="seed" type="text" inputmode="numeric" value="${this.seed}" aria-label="World seed"><button class="btn" data-act="dice" aria-label="Random seed">${icon('sparkle', 16)}</button></div>
          <div class="t-row"><button class="btn" data-act="back">Back</button><button class="btn primary" data-act="create"><span class="label">Create this world</span></button></div>
        </div>`;
    } else {
      body = `
        <div class="t-panel panel wide">
          <h3>Scenarios</h3>
          <div class="scen">${SCENARIOS.map((s) => `<button class="scard" data-act="scenario" data-id="${s.id}"><div class="sh"><b>${esc(s.name)}</b><i>${'◆'.repeat(s.difficulty)}${'◇'.repeat(3 - s.difficulty)}</i></div><em>${esc(s.tagline)}</em><p>${esc(s.brief)}</p><div class="obj">${icon('target', 13)}${esc(s.objective)}</div></button>`).join('')}</div>
          <div class="t-row"><button class="btn" data-act="back">Back</button></div>
        </div>`;
    }
    this.el.classList.toggle('sub', this.page !== 'main');
    this.el.innerHTML = `<div class="t-brand"><div class="t-word">GENESIS</div><div class="t-sub">a world is waiting for its god</div><div class="t-world">${esc(this.worldName)} · seed ${this.seed} · ${WORLD_PRESETS[this.preset].name}</div></div>${body}<div class="t-foot">Every system is simulated. Nothing is scripted. Your deeds become their scripture.</div>`;
  }
}

// ------------------------------------------------------------------ scenario HUD
export class ObjectiveTracker {
  readonly el = el('div', 'objective panel');
  private shownEnd = false;
  onEnd: (won: boolean, outcome: string) => void = () => {};

  constructor(root: HTMLElement, name: string, objective: string) {
    this.el.innerHTML = `<div class="o-name">${icon('target', 14)}<b>${esc(name)}</b></div><div class="o-obj">${esc(objective)}</div><div class="o-bar"><div></div></div><div class="o-det"></div>`;
    root.appendChild(this.el);
  }

  update(s: { status: string; progress: number; detail: string; outcome: string }): void {
    (this.el.querySelector('.o-bar > div') as HTMLElement).style.width = `${Math.round(s.progress * 100)}%`;
    (this.el.querySelector('.o-det') as HTMLElement).textContent = s.detail;
    this.el.classList.toggle('won', s.status === 'won');
    this.el.classList.toggle('lost', s.status === 'lost');
    if (s.status !== 'active' && !this.shownEnd) {
      this.shownEnd = true;
      this.onEnd(s.status === 'won', s.outcome);
    }
  }
}

export function endCard(root: HTMLElement, won: boolean, title: string, outcome: string, stats: string, onContinue: () => void, onMenu: () => void): void {
  const wrap = el('div', 'modal-wrap open end-card');
  wrap.innerHTML = `<div class="modal panel" style="width:min(560px,calc(100vw - 32px));text-align:center"><div class="modal-body" style="padding:34px 30px">
    <div style="color:${won ? 'var(--gold-bright)' : 'var(--danger)'}">${icon(won ? 'crown' : 'skull', 40)}</div>
    <div class="t-word" style="font-size:44px;margin-top:8px">${won ? 'Victory' : 'Defeat'}</div>
    <div class="muted" style="margin-top:4px;letter-spacing:.2em;text-transform:uppercase">${esc(title)}</div>
    <p class="quote" style="margin:22px auto 16px;max-width:420px;text-align:left">${esc(outcome)}</p>
    <div class="muted">${esc(stats)}</div>
    <div class="t-row" style="justify-content:center;margin-top:24px"><button class="btn" data-a="menu">Return to the title</button><button class="btn primary" data-a="go"><span class="label">Keep watching this world</span></button></div>
  </div></div>`;
  wrap.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!a) return;
    wrap.remove();
    if (a.dataset.a === 'go') onContinue(); else onMenu();
  });
  root.appendChild(wrap);
}

// ------------------------------------------------------------------ tutorial
export interface TutorialProbe {
  cameraMoved: () => boolean;
  selected: () => boolean;
  castPower: (id: string) => boolean;
  speedChanged: () => boolean;
}

interface Step { text: string; hint: string; done: (p: TutorialProbe, t: number) => boolean }

export class Tutorial {
  readonly el = el('div', 'tutorial panel');
  private step = 0;
  private t = 0;
  active = true;
  onFinish: () => void = () => {};
  private steps: Step[] = [
    { text: 'You are the god of this world.', hint: '<kbd>Drag</kbd> to turn the planet · <kbd>Wheel</kbd> to draw closer', done: (p, t) => p.cameraMoved() && t > 3 },
    { text: 'Somewhere below, your people are making camp.', hint: '<kbd>Click</kbd> a settlement, a person or an animal to see its life', done: (p) => p.selected() },
    { text: 'Rain is a gift. Give one.', hint: 'Select <b>Rain</b> in the bar below (<kbd>2</kbd>), then click near them', done: (p) => p.castPower('rain') },
    { text: 'They saw that. Their faith is your Devotion — love and fear alike.', hint: 'Devotion pays for every power. Prayer multiplies it.', done: (_p, t) => t > 7 },
    { text: 'Time is yours as well.', hint: '<kbd>Space</kbd> pauses · <kbd>.</kbd> and <kbd>,</kbd> change speed', done: (p) => p.speedChanged() },
    { text: 'Their story is being written.', hint: 'Open the <b>Chronicle</b> with <kbd>J</kbd> · everything is explained under <kbd>/</kbd>', done: (_p, t) => t > 7 },
  ];

  constructor(root: HTMLElement, private probe: TutorialProbe) {
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-skip]')) this.finish(); });
    this.render();
  }

  private render(): void {
    const s = this.steps[this.step];
    this.el.innerHTML = `<div class="tu-dots">${this.steps.map((_, i) => `<i class="${i < this.step ? 'done' : i === this.step ? 'on' : ''}"></i>`).join('')}</div><div class="tu-text">${s.text}</div><div class="tu-hint">${s.hint}</div><button class="btn" data-skip>Skip tutorial</button>`;
    this.el.classList.remove('pop');
    void this.el.offsetWidth;
    this.el.classList.add('pop');
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    if (this.steps[this.step].done(this.probe, this.t)) {
      this.step++;
      this.t = 0;
      if (this.step >= this.steps.length) { this.finish(); return; }
      this.render();
    }
  }

  finish(): void {
    if (!this.active) return;
    this.active = false;
    this.el.classList.add('gone');
    setTimeout(() => this.el.remove(), 600);
    this.onFinish();
  }
}
