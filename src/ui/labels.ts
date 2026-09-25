/**
 * Floating map labels: settlement names with their people's flag, and
 * named storms, projected from the globe each frame. Fade with distance and
 * hide behind the planet's limb. Clicking a label inspects the settlement.
 */
import * as THREE from 'three';
import { el, flagSvg } from './components';
import type { CivData, StormData } from '../worker/protocol';
import { PLANET_RADIUS } from '../sim/constants';

const TIERS = ['Camp', 'Village', 'Town', 'City'];

export class MapLabels {
  readonly el = el('div', 'labels');
  private pool = new Map<string, HTMLElement>();
  onSettlement: (id: number) => void = () => {};
  visible = true;
  private tmp = new THREE.Vector3();

  constructor(root: HTMLElement) {
    root.prepend(this.el);
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-sid]') as HTMLElement | null;
      if (t) this.onSettlement(Number(t.dataset.sid));
    });
  }

  private get(key: string, make: () => HTMLElement): HTMLElement {
    let e = this.pool.get(key);
    if (!e) { e = make(); this.pool.set(key, e); this.el.appendChild(e); }
    return e;
  }

  update(camera: THREE.PerspectiveCamera, civ: CivData | null, storms: StormData[], width: number, height: number, selected: number): void {
    const used = new Set<string>();
    const cam = camera.position;
    const camR = cam.length();
    const alt = camR - PLANET_RADIUS;
    if (this.visible && civ) {
      for (const s of civ.settlements) {
        if (!s.alive) continue;
        const t = civ.tribes[s.tribe];
        const p = this.tmp.set(s.x, s.y, s.z).multiplyScalar(PLANET_RADIUS + 6);
        const d = p.distanceTo(cam);
        // Near the limb or behind the planet: hide.
        const facing = p.clone().normalize().dot(cam.clone().sub(p).normalize());
        const near = d < 50;
        const far = alt > 2600 && s.tier < 1;
        if (facing < 0.08 || near || far || d > 4200) continue;
        const v = p.project(camera);
        if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
        const key = `s${s.id}`;
        const e = this.get(key, () => {
          const n = el('div', 'maplabel');
          n.dataset.sid = String(s.id);
          return n;
        });
        const sig = `${s.name}|${s.tier}|${s.pop}|${t?.flag.bg}|${s.walls}`;
        if (e.dataset.sig !== sig) {
          e.dataset.sig = sig;
          e.innerHTML = `${t ? flagSvg(t.flag, 18, 12) : ''}<span class="nm">${s.name}</span><span class="pp">${TIERS[s.tier] ?? ''} · ${s.pop}</span>`;
        }
        const fade = Math.min(1, facing * 6) * Math.min(1, (d - 50) / 60) * (d > 2200 ? Math.max(0, 1 - (d - 2200) / 2000) : 1);
        const scale = Math.max(0.75, Math.min(1.1, 700 / d + 0.6));
        e.style.transform = `translate(${((v.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -130%) scale(${scale.toFixed(3)})`;
        e.style.opacity = fade.toFixed(3);
        e.classList.toggle('sel', s.id === selected);
        e.style.zIndex = String(Math.round(10000 - d));
        used.add(key);
      }
      // Named storms, seen from high above.
      if (alt > 500) {
        for (const st of storms) {
          if (st.type !== 1 || st.intensity < 0.35) continue;
          const p = this.tmp.set(st.x, st.y, st.z).normalize().multiplyScalar(PLANET_RADIUS + 30);
          const facing = p.clone().normalize().dot(cam.clone().sub(p).normalize());
          if (facing < 0.1) continue;
          const v = p.project(camera);
          if (v.z > 1) continue;
          const key = `h${st.id}`;
          const e = this.get(key, () => el('div', 'maplabel storm'));
          const cat = Math.max(1, Math.min(5, Math.round(st.intensity * 3.3)));
          const sig = `${st.name}|${cat}`;
          if (e.dataset.sig !== sig) { e.dataset.sig = sig; e.innerHTML = `<span class="nm">${st.name}</span><span class="pp">Hurricane · Cat ${cat}</span>`; }
          e.style.transform = `translate(${((v.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-v.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -50%)`;
          e.style.opacity = Math.min(1, facing * 5).toFixed(3);
          used.add(key);
        }
      }
    }
    for (const [k, e] of this.pool) {
      if (used.has(k)) continue;
      e.remove();
      this.pool.delete(k);
    }
  }
}
