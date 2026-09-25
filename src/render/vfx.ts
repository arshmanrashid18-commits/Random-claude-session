/**
 * Visual effects: GPU particles (analytic motion, no per-frame CPU work per
 * particle), lightning bolts, targeting and selection reticles, pillars of
 * light, shockwave rings, fire and smoke over burning land, precipitation
 * around the camera, and the visuals of every divine power.
 *
 * Effects are driven by simulation state (effect list, strike log, fire and
 * rain fields); nothing here changes the simulation.
 */
import * as THREE from 'three';
import { PLANET_RADIUS, TICKS_PER_SECOND_1X, CLOUD_BASE } from '../sim/constants';
import type { EffectData } from '../worker/protocol';
import type { PlanetData } from './planet/planetData';
import { groundHeight } from './groundHeight';
import { dirToFaceAB } from '../sim/planet/cubesphere';
import type { PowerId } from '../sim/powers/defs';

const V = THREE.Vector3;

// ------------------------------------------------------------------ particles
export const Shape = { Glow: 0, Flame: 1, Smoke: 2, Spark: 3, Petal: 4, Swarm: 5, Streak: 6 } as const;

const PART_VS = /* glsl */ `
precision highp float;
in vec3 position;
in vec4 aOrigin; // xyz, birth
in vec4 aVel;    // xyz, life
in vec4 aParams; // size0, size1, gravity, drag
in vec4 aColor;  // rgb, alpha
in vec2 aKind;   // shape, seed
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
out vec2 vUv;
out vec4 vColor;
out float vK;
out float vShape;
out float vSeed;
void main() {
  float t = uTime - aOrigin.w;
  float life = aVel.w;
  if (t < 0.0 || t > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = t / life;
  vec3 up = normalize(aOrigin.xyz);
  float drag = aParams.w;
  vec3 disp = drag > 0.0 ? aVel.xyz * (1.0 - exp(-drag * t)) / drag : aVel.xyz * t;
  vec3 p = aOrigin.xyz + disp - up * 0.5 * aParams.z * t * t;
  float shape = aKind.x;
  // Swarms and petals flutter.
  if (shape == 5.0 || shape == 4.0) {
    float s = aKind.y * 17.0;
    vec3 side = normalize(cross(up, vec3(0.3, 1.0, 0.2)));
    vec3 fwd = cross(up, side);
    p += (side * sin(t * 3.1 + s) + fwd * cos(t * 2.3 + s * 1.3) + up * sin(t * 4.7 + s) * 0.4) * (shape == 5.0 ? 2.2 : 0.6);
  }
  float size = mix(aParams.x, aParams.y, k);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float ang = aKind.y * 6.2831 + t * (fract(aKind.y * 7.3) - 0.5) * 2.0;
  vec2 q = position.xy;
  if (shape == 6.0) {
    // Streak: stretch along the projected velocity.
    vec3 vv = (viewMatrix * vec4(aVel.xyz * exp(-drag * t) - up * aParams.z * t, 0.0)).xyz;
    vec2 d = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(0.0, 1.0);
    q = vec2(d.y, -d.x) * q.x * 0.25 + d * q.y * 2.5;
  } else if (shape != 1.0) {
    q = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * q;
  }
  mv.xy += q * size;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  vColor = aColor;
  vK = k;
  vShape = shape;
  vSeed = aKind.y;
}
`;

const PART_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
in vec2 vUv;
in vec4 vColor;
in float vK;
in float vShape;
in float vSeed;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 uv = vUv;
  float r = length(uv);
  float a = 0.0;
  vec3 col = vColor.rgb;
  float fadeIn = smoothstep(0.0, 0.08, vK);
  float fadeOut = 1.0 - smoothstep(0.6, 1.0, vK);
  if (vShape == 0.0) {
    a = exp(-r * r * 4.0);
  } else if (vShape == 1.0) {
    // Flame: teardrop, hot core to red tips as it ages.
    vec2 q = uv;
    q.y += 0.25;
    float w = 1.0 - smoothstep(-0.8, 1.0, q.y);
    float d = length(vec2(q.x / max(0.15, w * 0.8), q.y * 0.85));
    a = smoothstep(1.0, 0.35, d) * (0.75 + 0.25 * vnoise(uv * 3.0 + vSeed * 40.0));
    col = mix(col * vec3(1.6, 1.4, 1.1), col * vec3(1.0, 0.35, 0.12), smoothstep(0.1, 0.9, vK));
    fadeOut = 1.0 - smoothstep(0.4, 1.0, vK);
  } else if (vShape == 2.0) {
    float n = vnoise(uv * 2.5 + vSeed * 31.0) * 0.6 + vnoise(uv * 5.0 - vSeed * 13.0) * 0.4;
    a = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.6);
    col *= 0.8 + n * 0.4;
    fadeOut = 1.0 - smoothstep(0.3, 1.0, vK);
  } else if (vShape == 3.0 || vShape == 6.0) {
    a = exp(-r * r * 9.0);
  } else if (vShape == 4.0) {
    a = smoothstep(1.0, 0.7, length(vec2(uv.x * 1.8, uv.y)));
  } else {
    a = smoothstep(1.0, 0.55, r);
  }
  a *= vColor.a * fadeIn * fadeOut;
  if (a < 0.003) discard;
  outColor = vec4(col * a, a);
}
`;

class ParticlePool {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private data: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  private head = 0;
  private dirtyLo = Infinity;
  private dirtyHi = -1;
  readonly cap: number;
  static STRIDE = 18;

  constructor(cap: number, additive: boolean, uniforms: { uTime: THREE.IUniform }) {
    this.cap = cap;
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.data = new Float32Array(cap * ParticlePool.STRIDE);
    for (let i = 0; i < cap; i++) this.data[i * ParticlePool.STRIDE + 3] = -1e6; // unborn
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, ParticlePool.STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aOrigin', new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    this.geo.setAttribute('aVel', new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    this.geo.setAttribute('aParams', new THREE.InterleavedBufferAttribute(this.buf, 4, 8));
    this.geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(this.buf, 4, 12));
    this.geo.setAttribute('aKind', new THREE.InterleavedBufferAttribute(this.buf, 2, 16));
    this.geo.instanceCount = cap;
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PART_VS,
      fragmentShader: PART_FS,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 30 : 29;
  }

  emit(time: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, gravity: number, drag: number, r: number, g: number, b: number, a: number, shape: number, seed: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const o = i * ParticlePool.STRIDE;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = time;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = s0; d[o + 9] = s1; d[o + 10] = gravity; d[o + 11] = drag;
    d[o + 12] = r; d[o + 13] = g; d[o + 14] = b; d[o + 15] = a;
    d[o + 16] = shape; d[o + 17] = seed;
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
  }

  flush(): void {
    if (this.dirtyHi < 0) return;
    this.buf.clearUpdateRanges();
    this.buf.addUpdateRange(this.dirtyLo * ParticlePool.STRIDE, (this.dirtyHi - this.dirtyLo + 1) * ParticlePool.STRIDE);
    this.buf.needsUpdate = true;
    this.dirtyLo = Infinity;
    this.dirtyHi = -1;
  }
}

// ------------------------------------------------------------------ ribbons (bolts, rings, pillars)
const GLOW_VS = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 aTangent;
in float aSide;
in float aAlong;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uCamPos;
uniform float uWidth;
out float vSide;
out float vAlong;
void main() {
  vec3 view = normalize(position - uCamPos);
  vec3 side = normalize(cross(aTangent, view));
  float w = uWidth * (0.35 + 0.65 * (1.0 - aAlong * 0.6));
  vec3 p = position + side * aSide * w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vSide = aSide;
  vAlong = aAlong;
}
`;

const GLOW_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
in float vSide;
in float vAlong;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float core = exp(-vSide * vSide * 10.0);
  float halo = exp(-vSide * vSide * 2.0) * 0.35;
  float a = (core + halo) * uAlpha;
  outColor = vec4(uColor * a, a);
}
`;

interface Bolt {
  mesh: THREE.Mesh;
  born: number;
  life: number;
  mat: THREE.RawShaderMaterial;
}

function ribbonGeometry(points: THREE.Vector3[][]): THREE.BufferGeometry {
  const pos: number[] = [], tan: number[] = [], side: number[] = [], along: number[] = [], idx: number[] = [];
  for (const line of points) {
    const base = pos.length / 3;
    for (let i = 0; i < line.length; i++) {
      const p = line[i];
      const t = (i < line.length - 1 ? line[i + 1].clone().sub(p) : p.clone().sub(line[i - 1])).normalize();
      for (const sd of [-1, 1]) {
        pos.push(p.x, p.y, p.z);
        tan.push(t.x, t.y, t.z);
        side.push(sd);
        along.push(i / (line.length - 1));
      }
      if (i < line.length - 1) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTangent', new THREE.Float32BufferAttribute(tan, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ ground rings (reticle, selection, shockwaves)
const RING_VS = /* glsl */ `
precision highp float;
in vec3 position;
in float aU;
in float aV;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out float vU;
out float vV;
void main() {
  vU = aU;
  vV = aV;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const RING_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
in float vU;
in float vV;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
uniform float uDash;
void main() {
  float edge = 1.0 - abs(vV * 2.0 - 1.0);
  float a = smoothstep(0.0, 0.6, edge);
  if (uDash > 0.0) a *= 0.55 + 0.45 * step(0.5, fract(vU * uDash - uTime * 0.6));
  a *= uAlpha;
  outColor = vec4(uColor * a, a);
}
`;

class GroundRing {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.RawShaderMaterial;
  private geo: THREE.BufferGeometry;
  private pos: Float32Array;
  private segs: number;
  visible = false;

  constructor(segs: number, color: number, dash: number, uTime: THREE.IUniform) {
    this.segs = segs;
    this.pos = new Float32Array((segs + 1) * 2 * 3);
    const u = new Float32Array((segs + 1) * 2), v = new Float32Array((segs + 1) * 2);
    const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      u[i * 2] = u[i * 2 + 1] = i / segs;
      v[i * 2] = 0; v[i * 2 + 1] = 1;
      if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    this.geo.setAttribute('aV', new THREE.BufferAttribute(v, 1));
    this.geo.setIndex(idx);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: RING_VS, fragmentShader: RING_FS,
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 }, uTime, uDash: { value: dash } },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 31;
    this.mesh.visible = false;
  }

  /** Lay the ring on the terrain around a direction. */
  place(center: THREE.Vector3, radius: number, width: number, data: PlanetData, lift = 0.3): void {
    const up = center.clone().normalize();
    const east = new V(up.z, 0, -up.x);
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
    east.normalize();
    const north = new V().crossVectors(up, east);
    const d = new V();
    for (let i = 0; i <= this.segs; i++) {
      const a = (i / this.segs) * Math.PI * 2;
      for (let s = 0; s < 2; s++) {
        const r = (radius + (s === 0 ? -width : width)) / PLANET_RADIUS;
        d.copy(up).addScaledVector(east, Math.cos(a) * r).addScaledVector(north, Math.sin(a) * r).normalize();
        const h = Math.max(0.1, groundHeight(data.heights, data.n, d.x, d.y, d.z)) + lift + radius * 0.004;
        const o = (i * 2 + s) * 3;
        this.pos[o] = d.x * (PLANET_RADIUS + h);
        this.pos[o + 1] = d.y * (PLANET_RADIUS + h);
        this.pos[o + 2] = d.z * (PLANET_RADIUS + h);
      }
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = true;
  }
}

interface Shock {
  ring: GroundRing;
  center: THREE.Vector3;
  born: number;
  life: number;
  maxR: number;
  width: number;
}

interface Pillar {
  mesh: THREE.Mesh;
  mat: THREE.RawShaderMaterial;
  born: number;
  life: number;
  id: number;
  base: number;
}

const PILLAR_VS = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;
const PILLAR_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
in vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
void main() {
  float edge = sin(vUv.x * 3.14159 * 2.0) * 0.5 + 0.5;
  float fall = pow(1.0 - vUv.y, 1.6);
  float ripple = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 6.0);
  float a = (0.25 + 0.75 * fall) * ripple * uAlpha * (0.4 + 0.6 * edge);
  outColor = vec4(uColor * a, a);
}
`;

export interface VfxContext {
  camera: THREE.PerspectiveCamera;
  data: PlanetData;
  renderTick: number;
  dt: number;
  effects: EffectData[];
  speed: number;
}

export class Vfx {
  readonly group = new THREE.Group();
  private add: ParticlePool;
  private alpha: ParticlePool;
  private time = 0;
  private timeU = { value: 0 };
  private bolts: Bolt[] = [];
  private shocks: Shock[] = [];
  private pillars: Pillar[] = [];
  private reticle: GroundRing;
  private reticleFill: GroundRing;
  private selection: GroundRing;
  private seen = new Map<number, { phase: number; lastEmit: number }>();
  private emitAcc = 0;
  private rng = 1;
  /** Screen flash (0..1) requested by impacts; read by the renderer. */
  flash = 0;
  flashColor = new THREE.Color(1, 1, 1);
  /** Chromatic aberration pulse (0..1). */
  aberration = 0;
  /** Eclipse amount (0..1) for the renderer's sun/moon. */
  eclipse = 0;
  /** Tsunami rings for the ocean shader: centre xyz, radius. */
  tsunamis: THREE.Vector4[] = [0, 1, 2, 3].map(() => new THREE.Vector4());
  tsunamiAmp: number[] = [0, 0, 0, 0];
  quality = 1;
  /** Sound hooks. */
  onBolt: (p: THREE.Vector3, power: number) => void = () => {};
  onImpact: (p: THREE.Vector3, kind: PowerId) => void = () => {};

  constructor() {
    this.add = new ParticlePool(24000, true, { uTime: this.timeU });
    this.alpha = new ParticlePool(20000, false, { uTime: this.timeU });
    this.group.add(this.alpha.mesh, this.add.mesh);
    this.reticle = new GroundRing(128, 0xffffff, 24, this.timeU);
    this.reticleFill = new GroundRing(96, 0xffffff, 0, this.timeU);
    this.selection = new GroundRing(48, 0xffe8b0, 6, this.timeU);
    this.group.add(this.reticle.mesh, this.reticleFill.mesh, this.selection.mesh);
  }

  private rand(): number {
    this.rng = (this.rng * 16807) % 2147483647;
    return (this.rng - 1) / 2147483646;
  }

  private sym(): number {
    return this.rand() * 2 - 1;
  }

  // ------------------------------------------------------------------ reticles
  private reticleKey = '';
  setReticle(p: THREE.Vector3 | null, radius: number, color: number, data?: PlanetData): void {
    if (!p || !data) { this.reticle.mesh.visible = false; this.reticleFill.mesh.visible = false; return; }
    const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)},${radius},${color}`;
    (this.reticle.mat.uniforms.uColor.value as THREE.Color).setHex(color).multiplyScalar(2.2);
    (this.reticleFill.mat.uniforms.uColor.value as THREE.Color).setHex(color).multiplyScalar(0.5);
    if (key === this.reticleKey) return;
    this.reticleKey = key;
    const w = Math.max(0.25, radius * 0.025);
    this.reticle.place(p, radius, w, data, 0.4);
    this.reticleFill.place(p, radius * 0.5, radius * 0.5, data, 0.35);
    this.reticleFill.mat.uniforms.uAlpha.value = 0.08;
  }

  setSelection(p: THREE.Vector3 | null, radius: number, data?: PlanetData): void {
    if (!p || !data) { this.selection.mesh.visible = false; return; }
    this.selection.place(p, radius, 0.12, data, 0.15);
    (this.selection.mat.uniforms.uColor.value as THREE.Color).setHex(0xffe8b0).multiplyScalar(2);
  }

  // ------------------------------------------------------------------ lightning
  bolt(target: THREE.Vector3, power: number, data: PlanetData, color = 0xcfe0ff): void {
    const up = target.clone().normalize();
    const g = Math.max(0, groundHeight(data.heights, data.n, up.x, up.y, up.z));
    const ground = up.clone().multiplyScalar(PLANET_RADIUS + g);
    const top = up.clone().multiplyScalar(PLANET_RADIUS + CLOUD_BASE + 4 + this.rand() * 6);
    const east = new V(up.z, 0, -up.x).normalize();
    const north = new V().crossVectors(up, east);
    const lines: THREE.Vector3[][] = [];
    const main: THREE.Vector3[] = [];
    const n = 22;
    let off = new V();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = top.clone().lerp(ground, t);
      if (i > 0 && i < n) {
        off.addScaledVector(east, this.sym() * 1.4).addScaledVector(north, this.sym() * 1.4);
        off.multiplyScalar(0.8);
      } else off = new V();
      p.add(off);
      main.push(p);
    }
    lines.push(main);
    // Branches.
    for (let b = 0; b < 3 + Math.floor(power * 3); b++) {
      const k = 2 + Math.floor(this.rand() * (n - 8));
      const start = main[k].clone();
      const dir = new V().addScaledVector(east, this.sym()).addScaledVector(north, this.sym()).normalize();
      const br: THREE.Vector3[] = [start];
      let p = start.clone();
      for (let j = 0; j < 5; j++) {
        p = p.clone().addScaledVector(dir, 1.2 + this.rand()).addScaledVector(up, -(1.5 + this.rand() * 1.5)).addScaledVector(east, this.sym() * 0.6);
        br.push(p);
      }
      lines.push(br);
    }
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
      uniforms: { uCamPos: { value: new V() }, uWidth: { value: 0.35 + power * 0.25 }, uColor: { value: new THREE.Color(color).multiplyScalar(40) }, uAlpha: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(ribbonGeometry(lines), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 32;
    this.group.add(mesh);
    this.bolts.push({ mesh, born: this.time, life: 0.45, mat });
    // Ground flash, sparks and a puff of smoke.
    for (let i = 0; i < 18; i++) {
      const v = up.clone().multiplyScalar(2 + this.rand() * 4).addScaledVector(east, this.sym() * 4).addScaledVector(north, this.sym() * 4);
      this.add.emit(this.time, ground.x, ground.y, ground.z, v.x, v.y, v.z, 0.5 + this.rand() * 0.5, 0.25, 0.05, 9, 1.2, 4, 3.5, 2.5, 1, Shape.Streak, this.rand());
    }
    this.add.emit(this.time, ground.x + up.x * 0.5, ground.y + up.y * 0.5, ground.z + up.z * 0.5, 0, 0, 0, 0.35, 5, 9, 0, 0, 6, 7, 9, 1, Shape.Glow, 0);
    for (let i = 0; i < 4; i++) {
      const v = up.clone().multiplyScalar(0.8 + this.rand()).addScaledVector(east, this.sym() * 0.5);
      this.alpha.emit(this.time, ground.x, ground.y, ground.z, v.x, v.y, v.z, 2.5 + this.rand(), 0.8, 3, 0, 0.6, 0.2, 0.2, 0.2, 0.5, Shape.Smoke, this.rand());
    }
    this.onBolt(ground, power);
  }

  // ------------------------------------------------------------------ primitives
  private shock(center: THREE.Vector3, maxR: number, life: number, color: number, width: number): void {
    const ring = new GroundRing(160, color, 0, this.timeU);
    (ring.mat.uniforms.uColor.value as THREE.Color).setHex(color).multiplyScalar(3);
    this.group.add(ring.mesh);
    this.shocks.push({ ring, center: center.clone().normalize(), born: this.time, life, maxR, width });
  }

  private pillar(id: number, center: THREE.Vector3, radius: number, height: number, color: number, life: number, data: PlanetData, intensity = 1): void {
    const up = center.clone().normalize();
    const g = Math.max(0, groundHeight(data.heights, data.n, up.x, up.y, up.z));
    const geo = new THREE.CylinderGeometry(radius * 0.6, radius, height, 32, 1, true);
    geo.translate(0, height / 2, 0);
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: PILLAR_VS, fragmentShader: PILLAR_FS,
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(2.5 * intensity) }, uAlpha: { value: 0 }, uTime: this.timeU },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(up).multiplyScalar(PLANET_RADIUS + g - 0.5);
    mesh.quaternion.setFromUnitVectors(new V(0, 1, 0), up);
    mesh.frustumCulled = false;
    mesh.renderOrder = 28;
    this.group.add(mesh);
    this.pillars.push({ mesh, mat, born: this.time, life, id, base: g });
  }

  /** Random point within `radius` around a direction, on the ground. */
  private around(center: THREE.Vector3, radius: number, data: PlanetData, lift = 0): THREE.Vector3 {
    const up = center.clone().normalize();
    const east = new V(up.z, 0, -up.x).normalize();
    const north = new V().crossVectors(up, east);
    const a = this.rand() * Math.PI * 2, r = Math.sqrt(this.rand()) * radius / PLANET_RADIUS;
    const d = up.addScaledVector(east, Math.cos(a) * r).addScaledVector(north, Math.sin(a) * r).normalize();
    const g = Math.max(0, groundHeight(data.heights, data.n, d.x, d.y, d.z));
    return d.multiplyScalar(PLANET_RADIUS + g + lift);
  }

  // ------------------------------------------------------------------ effects
  private startEffect(e: EffectData, c: VfxContext): void {
    const center = new V(e.x, e.y, e.z);
    const data = c.data;
    const up = center.clone().normalize();
    switch (e.power) {
      case 'rain':
        this.shock(center, e.radius, 2.2, 0x7fb4ff, 1.5);
        break;
      case 'bloom':
        this.shock(center, e.radius, 2.6, 0x9be36b, 2);
        for (let i = 0; i < 700; i++) {
          const p = this.around(center, e.radius, data, 0.4);
          const v = p.clone().normalize().multiplyScalar(0.8 + this.rand() * 2.5);
          const hue = this.rand();
          const col = hue < 0.3 ? [1, 0.55, 0.75] : hue < 0.55 ? [1, 0.95, 0.5] : hue < 0.8 ? [0.95, 0.95, 1] : [0.75, 0.6, 1];
          this.alpha.emit(this.time + this.rand() * 1.5, p.x, p.y, p.z, v.x, v.y, v.z, 3 + this.rand() * 3, 0.35, 0.3, 0.25, 0.8, col[0], col[1], col[2], 0.95, Shape.Petal, this.rand());
        }
        break;
      case 'blessing':
        this.pillar(e.id, center, e.radius * 0.35, 160, 0xffd98a, 5, data, 1.2);
        for (let i = 0; i < 400; i++) {
          const p = this.around(center, e.radius, data, 0.3);
          const v = p.clone().normalize().multiplyScalar(1.5 + this.rand() * 4);
          this.add.emit(this.time + this.rand() * 3, p.x, p.y, p.z, v.x, v.y, v.z, 3 + this.rand() * 2, 0.35, 0.1, -0.2, 0.2, 5, 4, 2, 1, Shape.Glow, this.rand());
        }
        break;
      case 'resurrection':
        this.pillar(e.id, center, 14, 260, 0xfff4d0, 7, data, 1.6);
        this.shock(center, e.radius, 3, 0xfff4d0, 1.2);
        for (let i = 0; i < 300; i++) {
          const p = this.around(center, e.radius, data, 0.2);
          const v = p.clone().normalize().multiplyScalar(4 + this.rand() * 6);
          this.add.emit(this.time + this.rand() * 4, p.x, p.y, p.z, v.x, v.y, v.z, 2.5, 0.5, 0.05, 0, 0.3, 6, 6, 5, 1, Shape.Streak, this.rand());
        }
        break;
      case 'inspiration':
        for (let i = 0; i < 260; i++) {
          const p = this.around(center, e.radius, data, 1);
          const t = this.rand() * 6.28;
          const v = p.clone().normalize().multiplyScalar(2 + this.rand() * 3).add(new V(Math.cos(t), 0, Math.sin(t)).multiplyScalar(1.5));
          this.add.emit(this.time + this.rand() * 3, p.x, p.y, p.z, v.x, v.y, v.z, 2.5, 0.3, 0.05, 0, 0.3, 2, 4, 7, 1, Shape.Glow, this.rand());
        }
        break;
      case 'prophet':
        this.pillar(e.id, center, 2.2, 120, e.combo === 'omen' ? 0xff8a5a : 0xe8b6ff, 7, data, 1.5);
        break;
      case 'harmony':
        this.shock(center, Math.min(e.radius, 400), 5, 0xb8f0e0, 3);
        for (let i = 0; i < 120; i++) {
          const p = this.around(center, 120, data, 6 + this.rand() * 12);
          const v = new V(this.sym(), this.sym() * 0.3, this.sym()).normalize().multiplyScalar(6 + this.rand() * 4).addScaledVector(p.clone().normalize(), 2);
          this.alpha.emit(this.time + this.rand() * 3, p.x, p.y, p.z, v.x, v.y, v.z, 6, 0.6, 0.5, 0, 0.05, 1.6, 1.6, 1.6, 1, Shape.Petal, this.rand());
        }
        break;
      case 'beacon':
        this.pillar(e.id, center, 3, 420, 0xfff0a0, (e.end - e.start) / (TICKS_PER_SECOND_1X * Math.max(1, c.speed)), data, 2.2);
        this.shock(center, 60, 2, 0xfff0a0, 2);
        break;
      case 'earthquake':
        for (let i = 0; i < 260; i++) {
          const p = this.around(center, e.radius, data, 0.2);
          const v = p.clone().normalize().multiplyScalar(1 + this.rand() * 2);
          this.alpha.emit(this.time + this.rand() * 1.2, p.x, p.y, p.z, v.x, v.y, v.z, 4 + this.rand() * 3, 1.5, 6, 0.1, 0.5, 0.52, 0.45, 0.36, 0.55, Shape.Smoke, this.rand());
        }
        this.shock(center, e.radius, 1.5, 0xc08a5a, 2);
        this.aberration = Math.max(this.aberration, 0.6);
        break;
      case 'plague':
        break;
      case 'wildfire':
        this.flash = Math.max(this.flash, 0.05);
        break;
      case 'sanctuary':
        this.shock(center, e.radius, 3, 0x7de0a0, 1.5);
        break;
      case 'drought':
        this.shock(center, e.radius, 3, 0xe0a35a, 2.5);
        break;
      case 'volcano':
        this.aberration = Math.max(this.aberration, 0.4);
        break;
      case 'tsunami':
        this.aberration = Math.max(this.aberration, 0.3);
        break;
      default:
        break;
    }
    void up;
    this.onImpact(center.clone().multiplyScalar(PLANET_RADIUS), e.power);
  }

  private meteorImpact(e: EffectData, c: VfxContext): void {
    const center = new V(e.x, e.y, e.z);
    const data = c.data;
    const up = center.clone().normalize();
    const g = Math.max(0, groundHeight(data.heights, data.n, up.x, up.y, up.z));
    const p0 = up.clone().multiplyScalar(PLANET_RADIUS + g + 1);
    this.flash = 1;
    this.flashColor.setRGB(1, 0.9, 0.75);
    this.aberration = 1;
    this.shock(center, 160, 2.8, 0xffc26b, 6);
    this.shock(center, 360, 5, 0xffe0b0, 3);
    this.add.emit(this.time, p0.x, p0.y, p0.z, 0, 0, 0, 0.9, 14, 40, 0, 0, 10, 7, 4, 1, Shape.Glow, 0);
    const east = new V(up.z, 0, -up.x).normalize();
    const north = new V().crossVectors(up, east);
    // Fireball.
    for (let i = 0; i < 160; i++) {
      const v = up.clone().multiplyScalar(4 + this.rand() * 10).addScaledVector(east, this.sym() * 9).addScaledVector(north, this.sym() * 9);
      this.add.emit(this.time, p0.x, p0.y, p0.z, v.x, v.y, v.z, 1.2 + this.rand() * 1.4, 6, 14, 0, 1.2, 5, 2.4, 0.7, 1, Shape.Flame, this.rand());
    }
    // Ejecta: low arcs flung outward.
    for (let i = 0; i < 420; i++) {
      const a = this.rand() * Math.PI * 2, sp = 10 + this.rand() * 28;
      const v = east.clone().multiplyScalar(Math.cos(a) * sp).addScaledVector(north, Math.sin(a) * sp).addScaledVector(up, 6 + this.rand() * 14);
      this.add.emit(this.time, p0.x, p0.y, p0.z, v.x, v.y, v.z, 1.5 + this.rand() * 2, 0.6, 0.25, 16, 0.25, 4.5, 2, 0.6, 1, Shape.Streak, this.rand());
    }
    // Mushroom of dust.
    for (let i = 0; i < 500; i++) {
      const k = this.rand();
      const v = up.clone().multiplyScalar(5 + k * 18).addScaledVector(east, this.sym() * (3 + k * 10)).addScaledVector(north, this.sym() * (3 + k * 10));
      this.alpha.emit(this.time + this.rand() * 0.8, p0.x, p0.y, p0.z, v.x, v.y, v.z, 9 + this.rand() * 8, 6, 26, 0, 0.35, 0.34, 0.29, 0.25, 0.8, Shape.Smoke, this.rand());
    }
    this.onImpact(p0, 'meteor');
  }

  private tickEffect(e: EffectData, c: VfxContext, dt: number): void {
    const data = c.data;
    const center = new V(e.x, e.y, e.z);
    const up = center.clone().normalize();
    const tickNow = c.renderTick;
    const q = this.quality;
    switch (e.power) {
      case 'meteor': {
        if (e.phase !== 0) break;
        const fall = 24;
        const k = Math.min(1, Math.max(0, (tickNow - e.start) / fall));
        // Come in low from the horizon so the fall is seen across the sky.
        const dir = new V(e.dx, e.dy, e.dz);
        dir.addScaledVector(up, -dir.dot(up));
        if (dir.lengthSq() < 1e-6) dir.set(up.z, 0, -up.x);
        const entry = dir.normalize().multiplyScalar(0.9).addScaledVector(up, 0.45).normalize();
        const g = Math.max(0, groundHeight(data.heights, data.n, up.x, up.y, up.z));
        const ground = up.clone().multiplyScalar(PLANET_RADIUS + g);
        const dist = (1 - k) * 900 + 2;
        const p = ground.clone().addScaledVector(entry, dist);
        this.add.emit(this.time, p.x, p.y, p.z, 0, 0, 0, 0.12, 8 + (1 - k) * 12, 6, 0, 0, 14, 10, 6, 1, Shape.Glow, 0);
        for (let i = 0; i < 10 * q; i++) {
          const v = entry.clone().multiplyScalar(3 + this.rand() * 3).add(new V(this.sym(), this.sym(), this.sym()).multiplyScalar(1.5));
          this.add.emit(this.time, p.x, p.y, p.z, v.x, v.y, v.z, 0.8 + this.rand() * 0.8, 3, 7, 0, 0.8, 5, 2.2, 0.8, 0.9, Shape.Flame, this.rand());
          this.alpha.emit(this.time, p.x, p.y, p.z, v.x * 0.3, v.y * 0.3, v.z * 0.3, 4 + this.rand() * 3, 3, 12, 0, 0.3, 0.3, 0.27, 0.25, 0.5, Shape.Smoke, this.rand());
        }
        break;
      }
      case 'volcano': {
        const g = Math.max(0, groundHeight(data.heights, data.n, up.x, up.y, up.z));
        const top = up.clone().multiplyScalar(PLANET_RADIUS + g + 0.5);
        if (e.phase >= 1 && tickNow < e.end) {
          const east = new V(up.z, 0, -up.x).normalize();
          const north = new V().crossVectors(up, east);
          const n = Math.ceil(dt * 90 * q);
          for (let i = 0; i < n; i++) {
            // Ash column.
            const v = up.clone().multiplyScalar(6 + this.rand() * 8).addScaledVector(east, this.sym() * 1.5).addScaledVector(north, this.sym() * 1.5);
            this.alpha.emit(this.time, top.x, top.y, top.z, v.x, v.y, v.z, 10 + this.rand() * 8, 3, 22, -0.05, 0.12, 0.16, 0.14, 0.13, 0.85, Shape.Smoke, this.rand());
            // Lava bombs.
            if (this.rand() < 0.5) {
              const b = up.clone().multiplyScalar(8 + this.rand() * 14).addScaledVector(east, this.sym() * 7).addScaledVector(north, this.sym() * 7);
              this.add.emit(this.time, top.x, top.y, top.z, b.x, b.y, b.z, 2 + this.rand() * 1.5, 0.8, 0.5, 12, 0.05, 7, 2.2, 0.5, 1, Shape.Flame, this.rand());
            }
          }
          if (this.rand() < dt * 3) this.add.emit(this.time, top.x, top.y, top.z, 0, 0, 0, 0.6, 18, 26, 0, 0, 5, 1.6, 0.4, 0.6, Shape.Glow, 0);
        } else if (e.phase === 0) {
          // Rising: dust and tremors.
          const n = Math.ceil(dt * 40 * q);
          for (let i = 0; i < n; i++) {
            const p = this.around(center, e.radius, data, 0.3);
            const v = p.clone().normalize().multiplyScalar(1 + this.rand() * 3);
            this.alpha.emit(this.time, p.x, p.y, p.z, v.x, v.y, v.z, 3, 2, 7, 0, 0.5, 0.45, 0.4, 0.34, 0.5, Shape.Smoke, this.rand());
          }
        }
        break;
      }
      case 'plague': {
        const n = Math.ceil(dt * 30 * q);
        for (let i = 0; i < n; i++) {
          const p = this.around(center, e.radius, data, 0.5 + this.rand() * 2);
          const v = new V(this.sym(), this.sym(), this.sym()).multiplyScalar(0.4);
          this.alpha.emit(this.time, p.x, p.y, p.z, v.x, v.y, v.z, 5, 2, 6, -0.02, 0.2, 0.42, 0.62, 0.22, 0.3, Shape.Smoke, this.rand());
        }
        break;
      }
      case 'locusts': {
        const n = Math.ceil(dt * 300 * q);
        for (let i = 0; i < n; i++) {
          const p = this.around(center, e.radius * 0.8, data, 1 + this.rand() * 8);
          const v = new V(e.dx, e.dy, e.dz).multiplyScalar(1.5);
          this.alpha.emit(this.time, p.x, p.y, p.z, v.x, v.y, v.z, 1.6, 0.12, 0.12, 0, 0, 0.08, 0.07, 0.04, 0.95, Shape.Swarm, this.rand());
        }
        break;
      }
      case 'rain': {
        break;
      }
      case 'sanctuary': {
        if (this.rand() < dt * 6 * q) {
          const p = this.around(center, e.radius, data, 0.5 + this.rand() * 3);
          const v = p.clone().normalize().multiplyScalar(0.4);
          this.add.emit(this.time, p.x, p.y, p.z, v.x, v.y, v.z, 4, 0.18, 0.05, 0, 0.1, 1.2, 2.4, 1.4, 1, Shape.Glow, this.rand());
        }
        break;
      }
      case 'wildfire': case 'drought': case 'bloom': default:
        break;
    }
  }

  /** Fire and smoke over burning land near the camera. */
  private fires(c: VfxContext, dt: number): void {
    const data = c.data;
    const fx = data.fxCPU;
    const cam = c.camera.position;
    const camR = cam.length();
    if (camR - PLANET_RADIUS > 2600) return;
    const n = data.regionN;
    const P = n + 2;
    const focus = cam.clone().normalize();
    const f = dirToFaceAB(focus.x, focus.y, focus.z);
    // Scan the region cells of the face under the camera and its neighbours
    // (cheap: fires are sparse; we sample a window around the view).
    const span = Math.ceil(Math.min(n, (camR - PLANET_RADIUS) / 20 + 6));
    const ci = Math.floor((f.a + 1) * 0.5 * n), cj = Math.floor((f.b + 1) * 0.5 * n);
    const budget = dt * 900 * this.quality;
    let emitted = 0;
    const d = [0, 0, 0];
    for (let j = Math.max(0, cj - span); j < Math.min(n, cj + span); j++) {
      for (let i = Math.max(0, ci - span); i < Math.min(n, ci + span); i++) {
        const o = (f.face * P * P + (j + 1) * P + (i + 1)) * 4;
        const fire = fx[o + 2] / 255;
        if (fire < 0.08) continue;
        const k = fire * dt * 14 * this.quality;
        let m = Math.floor(k) + (this.rand() < k % 1 ? 1 : 0);
        while (m-- > 0 && emitted < budget) {
          const a = -1 + (2 * (i + this.rand())) / n, b = -1 + (2 * (j + this.rand())) / n;
          faceABToDirJS(f.face, a, b, d);
          const g = Math.max(0, groundHeight(data.heights, data.n, d[0], d[1], d[2]));
          const up = new V(d[0], d[1], d[2]);
          const p = up.clone().multiplyScalar(PLANET_RADIUS + g + 0.2);
          const v = up.clone().multiplyScalar(1.5 + this.rand() * 2).add(new V(this.sym(), this.sym(), this.sym()).multiplyScalar(0.4));
          this.add.emit(this.time, p.x, p.y, p.z, v.x, v.y, v.z, 0.7 + this.rand() * 0.6, 1.2 + fire * 1.5, 0.4, 0, 0.6, 4, 1.8, 0.5, 0.9, Shape.Flame, this.rand());
          if (this.rand() < 0.35) {
            const s = up.clone().multiplyScalar(3 + this.rand() * 3);
            this.alpha.emit(this.time, p.x, p.y, p.z, s.x, s.y, s.z, 6 + this.rand() * 5, 2, 12, -0.02, 0.15, 0.2, 0.18, 0.17, 0.55 * fire, Shape.Smoke, this.rand());
          }
          if (this.rand() < 0.2) {
            const s = up.clone().multiplyScalar(4 + this.rand() * 5).add(new V(this.sym(), this.sym(), this.sym()).multiplyScalar(2));
            this.add.emit(this.time, p.x, p.y, p.z, s.x, s.y, s.z, 1.5 + this.rand(), 0.12, 0.05, 2, 0.4, 5, 2.5, 0.6, 1, Shape.Glow, this.rand());
          }
          emitted++;
        }
      }
    }
  }

  // ------------------------------------------------------------------ frame
  update(c: VfxContext): void {
    const dt = c.dt;
    this.time += dt;
    this.timeU.value = this.time;
    const now = c.renderTick;
    // Effects: start new ones, tick active ones.
    const live = new Set<number>();
    let eclipse = 0;
    let ti = 0;
    for (const e of c.effects) {
      live.add(e.id);
      let st = this.seen.get(e.id);
      if (!st) {
        st = { phase: e.phase, lastEmit: 0 };
        this.seen.set(e.id, st);
        // Only play the start of effects that began recently.
        if (now - e.start < 40) this.startEffect(e, c);
      }
      if (e.power === 'meteor' && st.phase === 0 && e.phase === 1) this.meteorImpact(e, c);
      st.phase = e.phase;
      if (now < e.end + 2) this.tickEffect(e, c, dt);
      if (e.power === 'eclipse' && now < e.end + 20) {
        const k = (now - e.start) / Math.max(1, e.end - e.start);
        eclipse = Math.max(eclipse, Math.min(1, Math.min(k, 1 - k) * 5) * (now < e.end ? 1 : Math.max(0, 1 - (now - e.end) / 20)));
      }
      if (e.power === 'tsunami' && ti < 4) {
        const r = Math.max(0, now - e.start) * 3.2;
        if (r < e.radius + 40) {
          this.tsunamis[ti].set(e.x, e.y, e.z, r);
          this.tsunamiAmp[ti] = Math.max(0, 1 - r / (e.radius + 40)) * 3.5;
          ti++;
        }
      }
    }
    for (; ti < 4; ti++) this.tsunamiAmp[ti] = 0;
    this.eclipse += (eclipse - this.eclipse) * Math.min(1, dt * 3);
    for (const id of [...this.seen.keys()]) if (!live.has(id)) this.seen.delete(id);
    this.fires(c, dt);
    // Bolts flicker and fade.
    for (const b of this.bolts) {
      const k = (this.time - b.born) / b.life;
      b.mat.uniforms.uAlpha.value = Math.max(0, 1 - k) * (0.6 + 0.4 * Math.sin(k * 40) * Math.sin(k * 23));
      (b.mat.uniforms.uCamPos.value as THREE.Vector3).copy(c.camera.position);
      if (k >= 1) { this.group.remove(b.mesh); b.mesh.geometry.dispose(); b.mat.dispose(); }
    }
    this.bolts = this.bolts.filter((b) => this.time - b.born < b.life);
    // Shockwaves expand.
    for (const s of this.shocks) {
      const k = (this.time - s.born) / s.life;
      const r = s.maxR * (1 - Math.pow(1 - Math.min(1, k), 2.2));
      s.ring.place(s.center, Math.max(0.5, r), s.width * (1 - k * 0.5), c.data, 0.5);
      s.ring.mat.uniforms.uAlpha.value = Math.max(0, 1 - k);
      if (k >= 1) { this.group.remove(s.ring.mesh); s.ring.mesh.geometry.dispose(); s.ring.mat.dispose(); }
    }
    this.shocks = this.shocks.filter((s) => this.time - s.born < s.life);
    // Pillars rise and fade.
    for (const p of this.pillars) {
      const k = (this.time - p.born) / p.life;
      p.mat.uniforms.uAlpha.value = Math.min(1, k * 4) * Math.max(0, Math.min(1, (1 - k) * 3));
      if (k >= 1) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); p.mat.dispose(); }
    }
    this.pillars = this.pillars.filter((p) => this.time - p.born < p.life);
    this.flash *= Math.exp(-dt * 3.5);
    this.aberration *= Math.exp(-dt * 2.5);
    this.add.flush();
    this.alpha.flush();
    void this.emitAcc;
  }
}

/** Face params → direction (JS twin of faceABToDir for fire placement). */
function faceABToDirJS(face: number, a: number, b: number, out: number[]): void {
  const u = Math.tan(a * Math.PI / 4), v = Math.tan(b * Math.PI / 4);
  const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face];
  const U = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0]][face];
  const W = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]][face];
  const x = N[0] + u * U[0] + v * W[0], y = N[1] + u * U[1] + v * W[1], z = N[2] + u * U[2] + v * W[2];
  const l = Math.hypot(x, y, z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
}
