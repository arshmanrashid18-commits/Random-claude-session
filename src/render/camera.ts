/**
 * Cinematic planet camera.
 *
 * The camera orbits a focus point on the planet surface. Distance is smoothed
 * in log space so zooming from orbit to street level feels uniform, and tilt
 * automatically rises toward the horizon as you descend (user tilt is an
 * offset on top). Left-drag grabs the ground, right-drag orbits, the wheel
 * zooms toward the cursor. Supports fly-to transitions, entity following and
 * a free-fly photo mode.
 */
import * as THREE from 'three';
import { PLANET_RADIUS } from '../sim/constants';

export interface CameraState {
  focus: THREE.Vector3; // unit direction
  distance: number;
  heading: number;
  tiltOffset: number;
}

export const MIN_DISTANCE = 3.5;
export const MAX_DISTANCE = 5200;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Auto tilt (radians from vertical) as a function of distance. */
export function autoTilt(distance: number): number {
  const t = smoothstep(Math.log(1100), Math.log(12), Math.log(distance));
  return t * 1.3;
}

export class PlanetCamera {
  readonly camera: THREE.PerspectiveCamera;
  target: CameraState;
  current: CameraState;
  heightAt: (x: number, y: number, z: number) => number;
  /** Optional provider overriding the focus each frame (follow mode). */
  followFn: (() => THREE.Vector3 | null) | null = null;
  private fly: { from: CameraState; to: CameraState; t: number; dur: number } | null = null;
  focusHeight = 0;
  // Free-fly photo camera.
  freeMode = false;
  freePos = new THREE.Vector3();
  freeYaw = 0;
  freePitch = 0;
  /** Shake amplitude (world-relative), decays over time. */
  shake = 0;
  private shakeT = 0;
  reducedMotion = false;

  constructor(aspect: number, heightAt: (x: number, y: number, z: number) => number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 1, 10000);
    this.heightAt = heightAt;
    const focus = new THREE.Vector3(0.4, 0.35, 0.85).normalize();
    this.target = { focus: focus.clone(), distance: 3200, heading: 0, tiltOffset: 0 };
    this.current = { focus: focus.clone(), distance: 3200, heading: 0, tiltOffset: 0 };
  }

  static clone(s: CameraState): CameraState {
    return { focus: s.focus.clone(), distance: s.distance, heading: s.heading, tiltOffset: s.tiltOffset };
  }

  /** Smoothly fly to a new state over `dur` seconds. */
  flyTo(to: Partial<CameraState>, dur = 2.5): void {
    const dest: CameraState = {
      focus: (to.focus ?? this.target.focus).clone().normalize(),
      distance: to.distance ?? this.target.distance,
      heading: to.heading ?? this.target.heading,
      tiltOffset: to.tiltOffset ?? this.target.tiltOffset,
    };
    this.fly = { from: PlanetCamera.clone(this.current), to: dest, t: 0, dur: this.reducedMotion ? Math.min(dur, 0.8) : dur };
    this.target = PlanetCamera.clone(dest);
  }

  /** Cut instantly (auto-director hard cuts, harness viewpoints). */
  cutTo(to: Partial<CameraState>): void {
    this.fly = null;
    if (to.focus) { this.target.focus.copy(to.focus).normalize(); this.current.focus.copy(this.target.focus); }
    if (to.distance !== undefined) { this.target.distance = to.distance; this.current.distance = to.distance; }
    if (to.heading !== undefined) { this.target.heading = to.heading; this.current.heading = to.heading; }
    if (to.tiltOffset !== undefined) { this.target.tiltOffset = to.tiltOffset; this.current.tiltOffset = to.tiltOffset; }
  }

  get isFlying(): boolean {
    return this.fly !== null;
  }

  cancelFly(): void {
    this.fly = null;
  }

  addShake(amount: number): void {
    if (this.reducedMotion) return;
    this.shake = Math.min(3, this.shake + amount);
  }

  /** Local frame at a unit direction: east/north tangents. */
  static frame(up: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3): void {
    east.set(up.z, 0, -up.x);
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
    east.normalize();
    north.crossVectors(up, east).normalize();
  }

  update(dt: number): void {
    if (this.freeMode) {
      this.updateFree();
      return;
    }
    if (this.followFn) {
      const f = this.followFn();
      if (f) this.target.focus.copy(f).normalize();
    }
    const c = this.current, t = this.target;
    if (this.fly) {
      this.fly.t += dt / this.fly.dur;
      const k = this.fly.t >= 1 ? 1 : easeInOut(this.fly.t);
      const a = this.fly.from, b = this.fly.to;
      c.focus.copy(slerp(a.focus, b.focus, k));
      // Arc: rise out and back in for long hops.
      const ang = a.focus.angleTo(b.focus);
      const arc = Math.sin(Math.PI * k) * Math.min(1, ang * 1.2);
      const logD = Math.log(a.distance) * (1 - k) + Math.log(b.distance) * k + arc * 2.2;
      c.distance = Math.exp(logD);
      c.heading = a.heading + shortestAngle(a.heading, b.heading) * k;
      c.tiltOffset = a.tiltOffset * (1 - k) + b.tiltOffset * k;
      if (this.fly.t >= 1) this.fly = null;
    } else {
      const rate = 1 - Math.exp(-dt * 7);
      c.focus.copy(slerp(c.focus, t.focus, rate));
      c.distance = Math.exp(Math.log(c.distance) + (Math.log(t.distance) - Math.log(c.distance)) * rate);
      c.heading += shortestAngle(c.heading, t.heading) * rate;
      c.tiltOffset += (t.tiltOffset - c.tiltOffset) * rate;
    }
    const fh = Math.max(0, this.heightAt(c.focus.x, c.focus.y, c.focus.z));
    this.focusHeight += (fh - this.focusHeight) * Math.min(1, dt * 6);
    this.applyToCamera(dt);
  }

  private applyToCamera(dt: number): void {
    const c = this.current;
    const up = c.focus;
    const east = new THREE.Vector3(), north = new THREE.Vector3();
    PlanetCamera.frame(up, east, north);
    const fwd = north.clone().multiplyScalar(Math.cos(c.heading)).addScaledVector(east, Math.sin(c.heading));
    const tilt = Math.min(1.45, Math.max(0, autoTilt(c.distance) + c.tiltOffset));
    const F = up.clone().multiplyScalar(PLANET_RADIUS + this.focusHeight);
    const offset = up.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(fwd, -Math.sin(tilt));
    const pos = F.clone().addScaledVector(offset, c.distance);
    // Ground collision.
    const pr = pos.length();
    const pdir = pos.clone().divideScalar(pr);
    const ground = Math.max(0.6, this.heightAt(pdir.x, pdir.y, pdir.z));
    const minR = PLANET_RADIUS + ground + 1.6;
    if (pr < minR) pos.copy(pdir.multiplyScalar(minR));
    // Screen shake (decaying, smooth noise).
    if (this.shake > 0.001) {
      this.shakeT += dt * 30;
      const s = this.shake * Math.min(1, c.distance / 60) * 0.6;
      pos.x += Math.sin(this.shakeT * 1.3) * s;
      pos.y += Math.sin(this.shakeT * 1.7 + 1) * s;
      pos.z += Math.sin(this.shakeT * 2.1 + 2) * s;
      this.shake *= Math.exp(-dt * 3.5);
    }
    const view = F.clone().sub(pos).normalize();
    const camUp = fwd.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt)).normalize();
    this.setPose(pos, view, camUp);
  }

  private setPose(pos: THREE.Vector3, view: THREE.Vector3, up: THREE.Vector3): void {
    const cam = this.camera;
    cam.position.copy(pos);
    const z = view.clone().negate();
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    const m = new THREE.Matrix4().makeBasis(x, y, z);
    cam.quaternion.setFromRotationMatrix(m);
    this.updateClipping();
    cam.updateMatrixWorld(true);
  }

  updateClipping(): void {
    const cam = this.camera;
    const r = cam.position.length();
    const dir = cam.position.clone().divideScalar(r);
    const ground = Math.max(0, this.heightAt(dir.x, dir.y, dir.z));
    const alt = Math.max(0.5, r - PLANET_RADIUS - ground);
    const near = Math.min(250, Math.max(0.25, alt * 0.3));
    const horizon = Math.sqrt(Math.max(0, r * r - PLANET_RADIUS * PLANET_RADIUS));
    const far = horizon + Math.sqrt((PLANET_RADIUS + 60) ** 2 - PLANET_RADIUS ** 2) + 200;
    cam.near = near;
    cam.far = Math.max(far, near * 10);
    cam.updateProjectionMatrix();
  }

  private updateFree(): void {
    const cam = this.camera;
    cam.position.copy(this.freePos);
    const up = this.freePos.clone().normalize();
    const east = new THREE.Vector3(), north = new THREE.Vector3();
    PlanetCamera.frame(up, east, north);
    const fwdH = north.clone().multiplyScalar(Math.cos(this.freeYaw)).addScaledVector(east, Math.sin(this.freeYaw));
    const view = fwdH.clone().multiplyScalar(Math.cos(this.freePitch)).addScaledVector(up, Math.sin(this.freePitch)).normalize();
    const camUp = up.clone().sub(view.clone().multiplyScalar(view.dot(up))).normalize();
    this.setPose(this.freePos.clone(), view, camUp);
  }

  enterFree(): void {
    this.freeMode = true;
    this.freePos.copy(this.camera.position);
    const up = this.freePos.clone().normalize();
    const east = new THREE.Vector3(), north = new THREE.Vector3();
    PlanetCamera.frame(up, east, north);
    const view = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.freePitch = Math.asin(Math.max(-1, Math.min(1, view.dot(up))));
    this.freeYaw = Math.atan2(view.dot(east), view.dot(north));
  }

  exitFree(): void {
    this.freeMode = false;
  }

  /** Move the free camera in its local frame (photo mode). */
  moveFree(forward: number, right: number, upAmt: number): void {
    const up = this.freePos.clone().normalize();
    const east = new THREE.Vector3(), north = new THREE.Vector3();
    PlanetCamera.frame(up, east, north);
    const fwdH = north.clone().multiplyScalar(Math.cos(this.freeYaw)).addScaledVector(east, Math.sin(this.freeYaw));
    const rightV = new THREE.Vector3().crossVectors(fwdH, up).normalize();
    const alt = this.freePos.length() - PLANET_RADIUS;
    const speed = Math.max(0.5, alt * 0.8);
    this.freePos.addScaledVector(fwdH, forward * speed).addScaledVector(rightV, right * speed).addScaledVector(up, upAmt * speed);
    const r = this.freePos.length();
    const d = this.freePos.clone().divideScalar(r);
    const minR = PLANET_RADIUS + Math.max(0.6, this.heightAt(d.x, d.y, d.z)) + 1.2;
    if (r < minR) this.freePos.copy(d.multiplyScalar(minR));
  }

  /** Current tilt including auto tilt. */
  get tilt(): number {
    return Math.min(1.45, Math.max(0, autoTilt(this.current.distance) + this.current.tiltOffset));
  }

  /** Altitude of the camera above the ground. */
  get altitude(): number {
    const p = this.camera.position;
    const r = p.length();
    return r - PLANET_RADIUS - Math.max(0, this.heightAt(p.x / r, p.y / r, p.z / r));
  }

  /** Ray-march the terrain; returns the world hit point or null. */
  raycast(ndcX: number, ndcY: number): THREE.Vector3 | null {
    const cam = this.camera;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    const o = ray.ray.origin.clone(), d = ray.ray.direction.clone();
    // Start at the outer bound sphere.
    const rOuter = PLANET_RADIUS + 50;
    const b = o.dot(d), cc = o.lengthSq() - rOuter * rOuter;
    const disc = b * b - cc;
    if (disc < 0) return null;
    let t = Math.max(0, -b - Math.sqrt(disc));
    const tEnd = -b + Math.sqrt(disc);
    const p = new THREE.Vector3();
    let prevT = t;
    for (let i = 0; i < 400 && t < tEnd; i++) {
      p.copy(o).addScaledVector(d, t);
      const r = p.length();
      const h = Math.max(0, this.heightAt(p.x / r, p.y / r, p.z / r));
      const above = r - (PLANET_RADIUS + h);
      if (above < 0.05) {
        // Bisection refine between prevT and t.
        let lo = prevT, hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) * 0.5;
          p.copy(o).addScaledVector(d, mid);
          const rr = p.length();
          const hh = Math.max(0, this.heightAt(p.x / rr, p.y / rr, p.z / rr));
          if (rr - (PLANET_RADIUS + hh) < 0) hi = mid; else lo = mid;
        }
        return o.clone().addScaledVector(d, hi);
      }
      prevT = t;
      t += Math.max(0.15, above * 0.6);
    }
    return null;
  }
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function shortestAngle(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function slerp(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 {
  const dot = Math.min(1, Math.max(-1, a.dot(b)));
  const ang = Math.acos(dot);
  if (ang < 1e-6) return b.clone();
  const s = Math.sin(ang);
  return a.clone().multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(b, Math.sin(t * ang) / s).normalize();
}
