/** Loading screen with a real progress bar driven by world-generation stages. */

const STAGE_WEIGHTS: Record<string, [number, number]> = {
  'Drifting tectonic plates': [0.02, 0.1],
  'Raising mountains': [0.1, 0.3],
  'Finding the shorelines': [0.3, 0.33],
  'Eroding mountains': [0.33, 0.48],
  'Terrain complete': [0.48, 0.5],
  'Stirring the winds': [0.5, 0.78],
  'Carving rivers': [0.78, 0.86],
  'Seeding life': [0.86, 0.92],
  'Lighting the sky': [0.95, 1.0],
  'Awakening the world': [0.0, 0.95],
};

const FLAVOR = [
  'Before the first word, there was only the turning of stone.',
  'Rain has not yet learned the shape of a river.',
  'Somewhere, a mountain is deciding how tall to be.',
  'The oceans remember every star that has fallen into them.',
  'Winds circle the world, looking for somewhere to rest.',
  'Seeds wait in the dark for a reason to wake.',
  'They will call you by many names. Most of them kind.',
  'Every age begins with a single spark.',
];

export class LoadingScreen {
  private el: HTMLDivElement;
  private bar: HTMLDivElement;
  private stage: HTMLDivElement;
  private flavor: HTMLDivElement;
  private errorEl: HTMLDivElement;
  private flavorTimer: number;
  private progress = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'loading';
    this.el.setAttribute('role', 'progressbar');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    this.el.innerHTML = `
      <div class="stars"></div>
      <div class="title">GENESIS</div>
      <div class="subtitle">a world waits to be born</div>
      <div class="bar"><div></div></div>
      <div class="stage">Waking</div>
      <div class="flavor"></div>
      <div class="error"></div>`;
    root.appendChild(this.el);
    this.bar = this.el.querySelector('.bar > div') as HTMLDivElement;
    this.stage = this.el.querySelector('.stage') as HTMLDivElement;
    this.flavor = this.el.querySelector('.flavor') as HTMLDivElement;
    this.errorEl = this.el.querySelector('.error') as HTMLDivElement;
    let fi = Math.floor(Math.random() * FLAVOR.length);
    this.flavor.textContent = FLAVOR[fi];
    this.flavorTimer = window.setInterval(() => {
      this.flavor.style.opacity = '0';
      window.setTimeout(() => {
        fi = (fi + 1) % FLAVOR.length;
        this.flavor.textContent = FLAVOR[fi];
        this.flavor.style.opacity = '1';
      }, 800);
    }, 4200);
  }

  setStage(stage: string, frac: number): void {
    const w = STAGE_WEIGHTS[stage] ?? [this.progress, this.progress];
    const p = w[0] + (w[1] - w[0]) * Math.min(1, Math.max(0, frac));
    this.progress = Math.max(this.progress, p);
    this.bar.style.width = `${(this.progress * 100).toFixed(1)}%`;
    this.el.setAttribute('aria-valuenow', String(Math.round(this.progress * 100)));
    this.stage.textContent = stage;
  }

  setError(msg: string): void {
    this.errorEl.textContent = msg;
  }

  done(): void {
    this.setStage('Lighting the sky', 1);
    window.clearInterval(this.flavorTimer);
    this.el.classList.add('hidden');
    window.setTimeout(() => this.el.remove(), 1600);
  }
}
