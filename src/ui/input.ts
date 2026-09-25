/**
 * Pointer, wheel and touch input on the 3D view: grab-and-spin the globe,
 * orbit/tilt, zoom toward the cursor, double-click to fly, click to select
 * or cast, drag to paint terrain; pinch/twist on touch screens.
 */
import * as THREE from 'three';
import type { Game } from '../game';
import { PLANET_RADIUS } from '../sim/constants';
import { MIN_DISTANCE, MAX_DISTANCE, slerp } from '../render/camera';

export class InputController {
  private down: { x: number; y: number; t: number; button: number; grab: THREE.Vector3 | null; moved: boolean } | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { d: number; a: number; cx: number; cy: number } | null = null;
  private lastClick = 0;

  constructor(private game: Game, private canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    window.addEventListener('keydown', (e) => game.keyDown(e));
    window.addEventListener('keyup', (e) => game.keyUp(e));
    window.addEventListener('blur', () => game.clearHeld());
    canvas.style.touchAction = 'none';
  }

  private ndc(x: number, y: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1)];
  }

  /** Intersect the view ray with a smooth sphere (stable grab dragging). */
  private sphereHit(x: number, y: number, radius: number): THREE.Vector3 | null {
    const [nx, ny] = this.ndc(x, y);
    const cam = this.game.renderer.camera.camera;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
    const o = ray.ray.origin, d = ray.ray.direction;
    const b = o.dot(d), c = o.lengthSq() - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return null;
    return o.clone().addScaledVector(d, t);
  }

  private groundHit(x: number, y: number): THREE.Vector3 | null {
    const [nx, ny] = this.ndc(x, y);
    return this.game.renderer.camera.raycast(nx, ny);
  }

  private onDown(e: PointerEvent): void {
    const g = this.game;
    if (!g.enabled) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) { this.down = null; this.startPinch(); return; }
    }
    const cam = g.renderer.camera;
    if (g.photo) { this.down = { x: e.clientX, y: e.clientY, t: performance.now(), button: 2, grab: null, moved: false }; return; }
    let grab: THREE.Vector3 | null = null;
    if (e.button === 0 && !g.tool) {
      const r = PLANET_RADIUS + cam.focusHeight;
      grab = this.sphereHit(e.clientX, e.clientY, r);
    }
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, grab, moved: false };
    if (e.button === 0 && g.tool) {
      const hit = this.groundHit(e.clientX, e.clientY);
      if (hit) g.dab(hit);
    }
    if (e.button === 0 && cam.isFlying) cam.cancelFly();
  }

  private onMove(e: PointerEvent): void {
    const g = this.game;
    g.pointerX = e.clientX;
    g.pointerY = e.clientY;
    if (!g.enabled) return;
    if (g.wheel.open) g.wheel.move(e.clientX, e.clientY, g.devotion);
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) { this.updatePinch(); return; }
    }
    // Hover point for the reticle.
    if (e.target === this.canvas || this.down) {
      if (g.selectedPower || g.tool) g.hover = this.groundHit(e.clientX, e.clientY);
      else g.hover = null;
    }
    const d = this.down;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
    if (!d.moved) return;
    const cam = g.renderer.camera;
    if (g.photo) {
      cam.freeYaw += (e.movementX || 0) * 0.004;
      cam.freePitch = Math.max(-1.45, Math.min(1.45, cam.freePitch - (e.movementY || 0) * 0.004));
      return;
    }
    if (d.button === 0 && g.tool) {
      const hit = this.groundHit(e.clientX, e.clientY);
      if (hit) g.dab(hit);
      return;
    }
    if (d.button === 0 && d.grab) {
      if (cam.followFn) { cam.followFn = null; g.following = false; }
      const r = PLANET_RADIUS + cam.focusHeight;
      const now = this.sphereHit(e.clientX, e.clientY, r);
      if (now) {
        // Rotate the focus so the grabbed point returns under the cursor.
        const a = now.clone().normalize(), b = d.grab.clone().normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(a, b);
        cam.target.focus.applyQuaternion(q).normalize();
        cam.current.focus.copy(cam.target.focus);
      } else {
        g.panBy(-e.movementX * cam.target.distance * 0.0012, e.movementY * cam.target.distance * 0.0012);
      }
      return;
    }
    if (d.button === 2 || d.button === 1 || (d.button === 0 && !d.grab)) {
      cam.target.heading += (e.movementX || 0) * 0.005;
      cam.target.tiltOffset = Math.max(-1.2, Math.min(0.9, cam.target.tiltOffset - (e.movementY || 0) * 0.004));
    }
  }

  private onUp(e: PointerEvent): void {
    const g = this.game;
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
    }
    const d = this.down;
    this.down = null;
    if (!d || !g.enabled) return;
    if (g.photo) return;
    if (d.button === 0 && g.tool) { g.endStroke(); return; }
    if (d.moved) return;
    // A click.
    const [nx, ny] = this.ndc(e.clientX, e.clientY);
    if (d.button === 2) {
      if (g.selectedPower || g.tool) { g.selectPower(null); g.powers.toggleTerraform(false); g.selectTool(null); }
      return;
    }
    if (d.button !== 0) return;
    if (g.selectedPower) {
      const hit = this.groundHit(e.clientX, e.clientY) ?? this.sphereHit(e.clientX, e.clientY, PLANET_RADIUS);
      if (hit) void g.cast(g.selectedPower, hit);
      if (!e.shiftKey) g.selectPower(null);
      return;
    }
    const sel = g.pick(nx, ny, e.clientX, e.clientY);
    g.select(sel);
    if (sel) g.onUi('select');
  }

  private onWheel(e: WheelEvent): void {
    const g = this.game;
    if (!g.enabled) return;
    e.preventDefault();
    const cam = g.renderer.camera;
    if (g.photo) { cam.moveFree(-Math.sign(e.deltaY) * 0.05, 0, 0); return; }
    const k = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016))));
    const before = cam.target.distance;
    const after = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, before * k));
    cam.target.distance = after;
    // Zoom toward the cursor: move the focus part of the way to the hit point.
    if (after < before && !cam.followFn) {
      const hit = this.groundHit(e.clientX, e.clientY);
      if (hit) {
        const t = Math.min(0.5, (1 - after / before) * 0.9);
        cam.target.focus.copy(slerp(cam.target.focus, hit.clone().normalize(), t));
      }
    }
  }

  private onDouble(e: MouseEvent): void {
    const g = this.game;
    if (!g.enabled || g.selectedPower || g.tool || g.photo) return;
    const hit = this.groundHit(e.clientX, e.clientY);
    if (!hit) return;
    const now = performance.now();
    if (now - this.lastClick < 120) return;
    this.lastClick = now;
    const cam = g.renderer.camera;
    cam.flyTo({ focus: hit.clone().normalize(), distance: Math.max(MIN_DISTANCE * 4, cam.target.distance * 0.35) }, 1.6);
  }

  private startPinch(): void {
    const [a, b] = [...this.touches.values()];
    this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  private updatePinch(): void {
    if (!this.pinch) { this.startPinch(); return; }
    const [a, b] = [...this.touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const cam = this.game.renderer.camera;
    cam.target.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, cam.target.distance * (this.pinch.d / Math.max(10, d))));
    cam.target.heading -= ang - this.pinch.a;
    cam.target.tiltOffset = Math.max(-1.2, Math.min(0.9, cam.target.tiltOffset - (cy - this.pinch.cy) * 0.004));
    this.pinch = { d, a: ang, cx, cy };
  }
}
