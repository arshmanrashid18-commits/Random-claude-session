/**
 * People: a procedural humanoid instanced for every visible person, dressed
 * in their tribe's colours, carrying what they carry (wood, stone, baskets of
 * food, metal), holding the tools of their trade and animated by what they
 * are doing — walking, running, chopping, hammering, praying, sleeping, and
 * lighting torches at night.
 */
import * as THREE from 'three';
import { GLSL_CONSTANTS } from './glsl/common';
import { GLSL_FRAME, OBJECT_FS_HEAD } from './glsl/objects';
import { MeshBuilder, lin } from './meshkit';
import { DEPTH_FS, type SharedUniforms } from './planet/terrain';
import { groundHeight } from './groundHeight';
import { PLANET_RADIUS } from '../sim/constants';
import { Job, PState } from '../sim/civ/defs';
import type { EntitySnapshot, TribeData } from '../worker/protocol';
import type { PlanetData } from './planet/planetData';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function buildHuman(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const hipL: [number, number, number] = [-0.1, 0.84, 0], hipR: [number, number, number] = [0.1, 0.84, 0];
  // Legs (slot 2 = trousers), feet dark.
  for (const [tag, hip] of [[1, hipL], [2, hipR]] as const) {
    b.segment(V(hip[0], 0.86, 0), V(hip[0], 0.44, 0.02), 0.075, 0.06, 6, { slot: 2, tag, pivot: hip });
    b.segment(V(hip[0], 0.44, 0.02), V(hip[0], 0.06, 0), 0.06, 0.05, 6, { slot: 2, tag, pivot: hip });
    b.box(0.1, 0.07, 0.2, V(hip[0], 0, 0.04), { color: lin(0x2a1d14), tag, pivot: hip });
  }
  // Torso (slot 1 = tunic), belt.
  b.segment(V(0, 0.8, 0), V(0, 1.42, 0), 0.19, 0.16, 8, { slot: 1, ao: 0.25 });
  b.segment(V(0, 0.86, 0), V(0, 0.93, 0), 0.195, 0.195, 8, { slot: 2 });
  // Arms (tags 3 L, 4 R) with shoulder pivots; hands skin (slot 3).
  const shL: [number, number, number] = [-0.22, 1.36, 0], shR: [number, number, number] = [0.22, 1.36, 0];
  for (const [tag, sh, sx] of [[3, shL, -1], [4, shR, 1]] as const) {
    b.segment(V(sh[0], 1.38, 0), V(sh[0] + sx * 0.03, 1.08, 0.01), 0.058, 0.05, 6, { slot: 1, tag, pivot: sh });
    b.segment(V(sh[0] + sx * 0.03, 1.08, 0.01), V(sh[0] + sx * 0.04, 0.82, 0.04), 0.05, 0.042, 6, { slot: 3, tag, pivot: sh });
    b.blob(0.05, 0, V(sh[0] + sx * 0.04, 0.8, 0.05), V(1, 1.1, 1), { slot: 3, tag, pivot: sh });
  }
  // Neck and head (slot 3 skin), hair (slot 4).
  b.segment(V(0, 1.4, 0), V(0, 1.48, 0), 0.06, 0.06, 6, { slot: 3 });
  b.blob(0.13, 1, V(0, 1.58, 0.01), V(1, 1.1, 1.05), { slot: 3 }, 0.02);
  b.blob(0.14, 1, V(0, 1.63, -0.02), V(1.02, 0.75, 1.05), { slot: 4 }, 0.08);
  for (const sx of [-1, 1]) b.blob(0.018, 0, V(sx * 0.045, 1.6, 0.12), V(1, 1, 1), { color: lin(0x1a1410) });
  // Cargo on the shoulder/back (tag 10), coloured per resource in the shader (slot 5).
  b.blob(0.2, 1, V(0.0, 1.42, -0.2), V(1.2, 0.9, 0.8), { slot: 5, tag: 10 }, 0.15);
  // Spear (tag 11, right hand) and shield (tag 12, left arm).
  b.segment(V(0.27, 0.35, 0.08), V(0.27, 2.05, 0.08), 0.02, 0.02, 4, { color: lin(0x6b4b2e), tag: 11, pivot: shR });
  b.cone(0.045, 0.18, 4, V(0.27, 2.05, 0.08), { color: lin(0xb8b8c0), tag: 11, pivot: shR });
  b.cylinder(0.26, 0.26, 0.05, 10, V(-0.3, 1.0, 0.08), { slot: 6, tag: 12, pivot: shL }, new THREE.Euler(Math.PI / 2, 0, Math.PI / 2));
  // Staff (tag 13) and long robe (tag 14).
  b.segment(V(0.28, 0.0, 0.1), V(0.3, 1.9, 0.1), 0.025, 0.02, 5, { color: lin(0x8a6a42), tag: 13, pivot: shR });
  b.blob(0.06, 0, V(0.3, 1.92, 0.1), V(1, 1, 1), { color: lin(0xf5e6a8), tag: 13, pivot: shR });
  b.cone(0.3, 0.8, 10, V(0, 0.08, 0), { slot: 1, tag: 14 }, new THREE.Euler(0, 0, 0));
  // Tool (tag 15): axe/hoe handle in the right hand.
  b.segment(V(0.27, 0.78, 0.06), V(0.27, 0.78, 0.66), 0.02, 0.02, 4, { color: lin(0x6b4b2e), tag: 15, pivot: shR });
  b.box(0.04, 0.14, 0.1, V(0.27, 0.72, 0.62), { color: lin(0x9a9aa2), tag: 15, pivot: shR });
  // Torch (tag 16, left hand) with glowing head (slot 7 = emissive).
  b.segment(V(-0.27, 0.72, 0.06), V(-0.27, 1.25, 0.2), 0.022, 0.022, 4, { color: lin(0x5a3a22), tag: 16, pivot: shL });
  b.blob(0.07, 1, V(-0.27, 1.3, 0.21), V(0.9, 1.4, 0.9), { slot: 7, tag: 16, pivot: shL });
  // Boat (tag 17): hull, thwart, mast and a sail in the tribe's colour.
  const hull = lin(0x6a4a2c), hullDark = lin(0x4a3220);
  b.box(1.1, 0.35, 3.4, V(0, -0.05, 0), { color: hull, tag: 17, ao: 0.4 });
  b.box(1.16, 0.12, 3.5, V(0, 0.16, 0), { color: hullDark, tag: 17 });
  b.cone(0.55, 0.9, 4, V(0, -0.05, 2.05), { color: hull, tag: 17 }, new THREE.Euler(Math.PI / 2, Math.PI / 4, 0));
  b.box(1.0, 0.06, 0.25, V(0, 0.25, -0.6), { color: hullDark, tag: 17 });
  b.segment(V(0, 0.1, 0.5), V(0, 3.4, 0.5), 0.05, 0.04, 5, { color: lin(0x5a3a22), tag: 17 });
  b.quad(1.8, 2.3, V(0, 0.95, 0.52), new THREE.Euler(0, Math.PI / 2, 0), { slot: 1, tag: 17 }, 0.35);
  return b.build();
}

const HUMAN_VS = /* glsl */ `
precision highp float;
${GLSL_CONSTANTS}
${GLSL_FRAME}
in vec3 aDir;
in vec4 aMotion; // ground, heading, phase, speed
in vec4 aLook;   // state, flags, col1, col2
in vec2 aSkin;   // skin, hair
in vec3 aPivot;
in float aTag;
in float aSlot;
in vec3 color;
uniform float uNight;
uniform float uTime;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vEmissive;
vec3 unpackRGB(float c) {
  float r = floor(c / 65536.0);
  float g = floor(mod(c / 256.0, 256.0));
  float b = mod(c, 256.0);
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
vec3 rotX(vec3 p, vec3 pv, float a) {
  vec3 d = p - pv;
  float c = cos(a), s = sin(a);
  return pv + vec3(d.x, d.y * c - d.z * s, d.y * s + d.z * c);
}
vec3 rotZ(vec3 p, vec3 pv, float a) {
  vec3 d = p - pv;
  float c = cos(a), s = sin(a);
  return pv + vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
}
void main() {
  float state = aLook.x;
  float flags = aLook.y;
  float job = mod(flags, 16.0);
  float carry = mod(floor(flags / 16.0), 8.0);
  float ageC = mod(floor(flags / 128.0), 4.0);
  float role = mod(floor(flags / 512.0), 8.0);
  float torch = mod(floor(flags / 4096.0), 2.0);
  float vessel = mod(floor(flags / 8192.0), 2.0);
  float sick = mod(floor(flags / 16384.0), 2.0);
  float returned = mod(floor(flags / 32768.0), 2.0);
  float speed = aMotion.w;
  float phase = aMotion.z;
  vec3 lp = position;
  vec3 nl = normal;
  float tag = aTag;
  // Accessory visibility.
  bool soldier = abs(job - ${Job.Soldier}.0) < 0.5;
  bool priest = abs(job - ${Job.Priest}.0) < 0.5 || role > 1.5 && role < 3.5;
  bool worker = job > 0.5 && job < 8.5 && !soldier;
  bool show = true;
  if (tag > 9.5 && tag < 10.5) show = carry > 0.5;
  else if (tag > 10.5 && tag < 12.5) show = soldier;
  else if (tag > 12.5 && tag < 14.5) show = priest || (tag > 13.5 && ageC > 1.5);
  else if (tag > 14.5 && tag < 15.5) show = worker && carry < 0.5;
  else if (tag > 15.5 && tag < 16.5) show = torch > 0.5;
  else if (tag > 16.5) show = vessel > 0.5;
  if (!show) lp = vec3(0.0, 0.9, 0.0);
  // Aboard a boat the traveller sits amidships.
  if (vessel > 0.5 && tag < 16.5) { lp *= 0.9; lp.y += 0.05; lp.z -= 0.8; }
  bool walking = state > 0.5 && state < 1.5 || state > 2.5 && state < 3.5 || state > 8.5 && state < 9.5 || state > 10.5 && state < 12.5;
  bool working = state > 1.5 && state < 2.5 || state > 7.5 && state < 8.5;
  bool praying = state > 5.5 && state < 6.5;
  bool sleeping = state > 4.5 && state < 5.5;
  bool fighting = state > 9.5 && state < 10.5;
  float run = state > 8.5 && state < 9.5 ? 1.6 : 1.0;
  float amp = walking ? min(1.0, speed) * 0.7 * run : 0.0;
  if (tag > 0.5 && tag < 2.5) {
    float a = sin(phase + (tag < 1.5 ? 0.0 : PI)) * amp;
    if (praying) a = -1.4;
    lp = rotX(lp, aPivot, a);
    nl = rotX(nl, vec3(0.0), a);
    if (praying) { vec3 knee = aPivot + vec3(0.0, -0.42, 0.0); lp = rotX(lp, knee, 1.5); }
  }
  if (tag > 2.5 && tag < 4.5 || tag > 10.5 && tag != 14.0 && tag < 16.5) {
    bool right = abs(aPivot.x - 0.22) < 0.01;
    float a = walking ? -sin(phase + (right ? 0.0 : PI)) * amp * 0.8 : 0.0;
    if (working && right) a = -1.2 - 0.9 * (0.5 + 0.5 * sin(phase * 3.0));
    if (working && !right) a = -0.5;
    if (praying) a = -2.6;
    if (fighting && right) a = -1.5 + sin(phase * 4.0) * 0.6;
    if (carry > 0.5 && right) a = -2.4;
    if (state > 6.5 && state < 7.5) a = right ? -0.6 - 0.4 * sin(phase * 2.0) : 0.1;
    lp = rotX(lp, aPivot, a);
    nl = rotX(nl, vec3(0.0), a);
  }
  if (praying) lp.y -= 0.42;
  float bob = walking ? abs(sin(phase)) * 0.04 * amp : sin(phase * 0.5) * 0.005;
  lp.y += bob;
  if (ageC > 1.5) lp = rotX(lp, vec3(0.0, 0.8, 0.0), 0.12 * step(0.8, lp.y));
  if (sleeping) { lp = rotZ(lp, vec3(0.0), 1.5708); lp.y += 0.15; nl = rotZ(nl, vec3(0.0), 1.5708); }
  float sc = ageC < 0.5 && tag < 16.5 ? 0.62 : 1.0;
  lp *= sc;
  vec3 up = aDir;
  vec3 ax, az;
  tangentFrame(up, aMotion.y, ax, az);
  float ground = aMotion.x;
  if (vessel > 0.5) {
    // Float on the sea, rolling with the swell.
    ground = max(ground, 0.05) + sin(uTime * 1.3 + aDir.x * 400.0) * 0.08;
    lp = rotZ(lp, vec3(0.0), sin(uTime * 1.1 + aDir.z * 300.0) * 0.06);
  }
  vWorld = up * (PLANET_R + ground) + ax * lp.x + up * lp.y + az * lp.z;
  vNormal = normalize(ax * nl.x + up * nl.y + az * nl.z);
  vec3 c1 = unpackRGB(aLook.z), c2 = unpackRGB(aLook.w), skin = unpackRGB(aSkin.x), hair = unpackRGB(aSkin.y);
  vec3 cargo = carry < 1.5 ? vec3(0.45, 0.35, 0.08) : carry < 2.5 ? vec3(0.25, 0.13, 0.05) : carry < 3.5 ? vec3(0.3, 0.3, 0.3) : vec3(0.18, 0.16, 0.14);
  if (priest) c1 = mix(c1, vec3(0.8, 0.78, 0.7), 0.6);
  if (sick > 0.5) skin = mix(skin, vec3(0.42, 0.5, 0.28), 0.55);
  vColor = aSlot < 0.5 ? color : aSlot < 1.5 ? c1 * color : aSlot < 2.5 ? c2 * color : aSlot < 3.5 ? skin * color : aSlot < 4.5 ? hair : aSlot < 5.5 ? cargo : aSlot < 6.5 ? c2 : vec3(1.0, 0.6, 0.2);
  vEmissive = aSlot > 6.5 ? 1.0 : returned > 0.5 && tag < 16.5 ? -0.35 : 0.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const HUMAN_FS = /* glsl */ `
${OBJECT_FS_HEAD}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vEmissive;
void main() {
  // Positive emissive: torch flame; negative: the soft glow of the returned.
  vec3 ec = vEmissive > 0.0 ? vec3(9.0, 4.2, 1.2) * (0.85 + 0.15 * sin(uTime * 13.0 + vWorld.x * 7.0)) : vec3(2.2, 2.1, 1.7) * (0.8 + 0.2 * sin(uTime * 3.0));
  vec3 c = shadeObject(vWorld, normalize(vNormal), vColor, 0.0, abs(vEmissive), ec);
  outColor = vec4(c, 1.0);
}
`;

const STRIDE = 13;
const SKINS = [0xf1d0b5, 0xe0b894, 0xc99a74, 0xa87652, 0x8a5a3a, 0x6b4428, 0x4e3120];
const HAIRS = [0x1c1510, 0x2e1e14, 0x4a3020, 0x6e4a2a, 0x9a7040, 0xc9a060, 0x7a2e18];

interface Track {
  px: number; py: number; pz: number;
  cx: number; cy: number; cz: number;
  heading: number;
  phase: number;
  speed: number;
  seen: number;
}

export class PeopleRenderer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly depthMaterial: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private arr: Float32Array;
  private buf!: THREE.InstancedInterleavedBuffer;
  private cap = 0;
  private tracks = new Map<number, Track>();
  private prev: EntitySnapshot | null = null;
  cur: EntitySnapshot | null = null;
  tribes: TribeData[] = [];
  visibleCount = 0;
  maxDistance = 320;
  lastPositions = new Map<number, THREE.Vector3>();

  constructor(shared: SharedUniforms) {
    const src = buildHuman();
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = src.index;
    for (const n of ['position', 'normal', 'color', 'aPivot', 'aTag', 'aSlot']) this.geo.setAttribute(n, src.getAttribute(n));
    this.arr = new Float32Array(0);
    this.allocate(512);
    this.geo.instanceCount = 0;
    const uniforms = { ...shared, uNight: { value: 0 } };
    this.material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: HUMAN_VS, fragmentShader: HUMAN_FS, uniforms });
    this.depthMaterial = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: HUMAN_VS, fragmentShader: DEPTH_FS, uniforms, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'people';
  }

  private allocate(cap: number): void {
    const arr = new Float32Array(cap * STRIDE);
    arr.set(this.arr.subarray(0, Math.min(this.arr.length, arr.length)));
    this.arr = arr;
    this.cap = cap;
    this.buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aDir', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    this.geo.setAttribute('aMotion', new THREE.InterleavedBufferAttribute(this.buf, 4, 3));
    this.geo.setAttribute('aLook', new THREE.InterleavedBufferAttribute(this.buf, 4, 7));
    this.geo.setAttribute('aSkin', new THREE.InterleavedBufferAttribute(this.buf, 2, 11));
  }

  pushSnapshot(s: EntitySnapshot): EntitySnapshot | null {
    const recycle = this.prev;
    this.prev = this.cur;
    this.cur = s;
    const seen = s.tick;
    for (let k = 0; k < s.count; k++) {
      const uid = s.info[k * 2];
      const x = s.pos[k * 3], y = s.pos[k * 3 + 1], z = s.pos[k * 3 + 2];
      let t = this.tracks.get(uid);
      if (!t) {
        t = { px: x, py: y, pz: z, cx: x, cy: y, cz: z, heading: (uid % 628) / 100, phase: uid % 7, speed: 0, seen };
        this.tracks.set(uid, t);
      } else {
        t.px = t.cx; t.py = t.cy; t.pz = t.cz;
        t.cx = x; t.cy = y; t.cz = z;
        t.seen = seen;
      }
    }
    for (const [uid, t] of this.tracks) if (t.seen !== seen) { this.tracks.delete(uid); this.lastPositions.delete(uid); }
    return recycle;
  }

  update(camera: THREE.PerspectiveCamera, renderTick: number, dTick: number, data: PlanetData, dt: number, sunDir: THREE.Vector3): void {
    const cur = this.cur;
    this.geo.instanceCount = 0;
    this.visibleCount = 0;
    if (!cur) return;
    const prevTick = this.prev ? this.prev.tick : cur.tick - 1;
    const span = Math.max(1, cur.tick - prevTick);
    const alpha = Math.min(1, Math.max(0, (renderTick - prevTick) / span));
    const cam = camera.position;
    if (cam.length() - PLANET_RADIUS > this.maxDistance * 1.5) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const maxD2 = this.maxDistance * this.maxDistance;
    let n = 0;
    for (let k = 0; k < cur.count; k++) {
      const uid = cur.info[k * 2];
      const t = this.tracks.get(uid);
      if (!t) continue;
      let x = t.px + (t.cx - t.px) * alpha, y = t.py + (t.cy - t.py) * alpha, z = t.pz + (t.cz - t.pz) * alpha;
      const l = Math.hypot(x, y, z);
      x /= l; y /= l; z /= l;
      const wx = x * PLANET_RADIUS - cam.x, wy = y * PLANET_RADIUS - cam.y, wz = z * PLANET_RADIUS - cam.z;
      if (wx * wx + wy * wy + wz * wz > maxD2) continue;
      if (wx * fwd.x + wy * fwd.y + wz * fwd.z < -10) continue;
      const packed = cur.info[k * 2 + 1];
      const state = packed & 31;
      const job = (packed >>> 5) & 15;
      const carry = (packed >>> 9) & 7;
      const tribe = (packed >>> 12) & 63;
      const ageC = (packed >>> 18) & 3;
      const role = (packed >>> 20) & 7;
      const vessel = (packed >>> 24) & 1;
      const sick = (packed >>> 25) & 1;
      const returned = (packed >>> 26) & 1;
      const mx = t.cx - t.px, my = t.cy - t.py, mz = t.cz - t.pz;
      const moved = Math.hypot(mx, my, mz) * PLANET_RADIUS;
      let ex = z, ez = -x;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el; ez /= el;
      const nx = y * ez, ny = z * ex - x * ez, nz = -y * ex;
      if (moved > 0.01) {
        const me = mx * ex + mz * ez, mn = mx * nx + my * ny + mz * nz;
        const target = Math.atan2(me, -mn);
        let dh = target - t.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        t.heading += dh * Math.min(1, dt * 8);
      }
      const perTick = moved / span;
      t.speed += (perTick / 0.34 - t.speed) * Math.min(1, dt * 5);
      const working = state === PState.Work || state === PState.Build || state === PState.Fight;
      t.phase += working ? dt * 5 : Math.min(1.2, perTick * Math.max(0, dTick) * 7.5);
      if (n >= this.cap) this.allocate(this.cap * 2);
      const tr = this.tribes[tribe];
      const col1 = tr ? tr.color : 0x8a7a66;
      const col2 = tr ? darken(tr.color2, 0.55) : 0x4a4038;
      const skin = SKINS[(uid * 7 + tribe * 3) % SKINS.length];
      const hair = ageC === 2 ? 0xb8b4ac : HAIRS[(uid * 13) % HAIRS.length];
      // Torches after dark for people on the move.
      const night = x * sunDir.x + y * sunDir.y + z * sunDir.z < -0.05;
      const torch = night && (state === PState.Walk || state === PState.Carry || state === PState.Travel || state === PState.March || state === PState.Flee) && ageC > 0 && (uid % 3 !== 0) ? 1 : 0;
      const flags = job | (carry << 4) | (ageC << 7) | (role << 9) | (torch << 12) | (vessel << 13) | (sick << 14) | (returned << 15);
      const o = n * STRIDE;
      const a = this.arr;
      a[o] = x; a[o + 1] = y; a[o + 2] = z;
      a[o + 3] = groundHeight(data.heights, data.n, x, y, z);
      a[o + 4] = t.heading; a[o + 5] = t.phase; a[o + 6] = t.speed;
      a[o + 7] = state; a[o + 8] = flags; a[o + 9] = col1; a[o + 10] = col2;
      a[o + 11] = skin; a[o + 12] = hair;
      n++;
      let lp = this.lastPositions.get(uid);
      if (!lp) { lp = new THREE.Vector3(); this.lastPositions.set(uid, lp); }
      const rr = PLANET_RADIUS + a[o + 3];
      lp.set(x * rr, y * rr, z * rr);
    }
    this.geo.instanceCount = n;
    this.visibleCount = n;
    this.buf.clearUpdateRanges();
    this.buf.addUpdateRange(0, n * STRIDE);
    this.buf.needsUpdate = true;
  }
}

function darken(hex: number, k: number): number {
  const r = ((hex >> 16) & 255) * k, g = ((hex >> 8) & 255) * k, b = (hex & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
