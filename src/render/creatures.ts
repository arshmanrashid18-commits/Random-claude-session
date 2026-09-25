/**
 * Animals: procedural low-poly models for every body plan, instanced per plan,
 * animated in the vertex shader (diagonal walking gait, gallop, hopping,
 * grazing head-down, lying down to rest) and lit like the rest of the world.
 * Positions interpolate between simulation snapshots; heading and gait phase
 * are derived from motion. Ground height uses the exact CPU port of the terrain
 * height function so hooves touch the ground.
 */
import * as THREE from 'three';
import { GLSL_CONSTANTS } from './glsl/common';
import { GLSL_FRAME, OBJECT_FS_HEAD } from './glsl/objects';
import { MeshBuilder, lin } from './meshkit';
import { DEPTH_FS, type SharedUniforms } from './planet/terrain';
import { groundHeight } from './groundHeight';
import { PLANET_RADIUS } from '../sim/constants';
import type { EntitySnapshot, SpeciesInfo } from '../worker/protocol';
import type { PlanetData } from './planet/planetData';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface QuadSpec {
  legLen: number;
  bodyLen: number;
  bodyH: number;
  bodyW: number;
  neck: [number, number, number, number, number, number]; // base xyz, tip xyz (y,z used)
  neckR: number;
  head: [number, number, number];
  headSize: [number, number, number];
  snout: number;
  tail: number;
  legR: number;
}

const DARK = lin(0x1e1812);
const BONE = lin(0xd9ccb0);

function quadruped(b: MeshBuilder, q: QuadSpec, bushyTail = false): void {
  const yB = q.legLen + q.bodyH * 0.45;
  b.blob(0.5, 1, V(0, yB, 0), V(q.bodyW, q.bodyH, q.bodyLen), { slot: 1, jitter: 0.08, ao: 0.35 }, 0.06);
  // Belly lighter.
  b.blob(0.46, 1, V(0, yB - q.bodyH * 0.18, 0), V(q.bodyW * 0.92, q.bodyH * 0.7, q.bodyLen * 0.86), { slot: 2, jitter: 0.05 }, 0.04);
  // Legs: tags 1 FL, 2 FR, 3 BL, 4 BR, pivots at the hips.
  const lx = q.bodyW * 0.3, lz = q.bodyLen * 0.34;
  const legs: [number, number, number][] = [[-lx, 0, lz], [lx, 0, lz], [-lx, 0, -lz], [lx, 0, -lz]];
  legs.forEach(([x, , z], k) => {
    const top = V(x, q.legLen + 0.06, z);
    const knee = V(x, q.legLen * 0.45, z + (k < 2 ? 0.02 : -0.03));
    const foot = V(x, 0, z);
    const pivot: [number, number, number] = [x, q.legLen + 0.06, z];
    b.segment(top, knee, q.legR, q.legR * 0.75, 5, { slot: 1, tag: k + 1, pivot });
    b.segment(knee, foot, q.legR * 0.75, q.legR * 0.55, 5, { slot: 1, tag: k + 1, pivot, ao: 0.3 });
    b.segment(foot, V(x, 0.02, z + 0.01), q.legR * 0.62, q.legR * 0.62, 5, { color: DARK, tag: k + 1, pivot });
  });
  // Neck and head (tag 6, pivot at neck base) for grazing.
  const n = q.neck;
  const neckPivot: [number, number, number] = [0, n[1], n[2]];
  if (q.neckR > 0) b.segment(V(0, n[1], n[2]), V(0, n[4], n[5]), q.neckR, q.neckR * 0.75, 6, { slot: 1, tag: 6, pivot: neckPivot });
  b.blob(0.5, 1, V(q.head[0], q.head[1], q.head[2]), V(q.headSize[0], q.headSize[1], q.headSize[2]), { slot: 1, tag: 6, pivot: neckPivot, jitter: 0.05 }, 0.05);
  if (q.snout > 0) {
    b.segment(V(0, q.head[1] - q.headSize[1] * 0.1, q.head[2] + q.headSize[2] * 0.3), V(0, q.head[1] - q.headSize[1] * 0.2, q.head[2] + q.headSize[2] * 0.3 + q.snout), q.headSize[0] * 0.28, q.headSize[0] * 0.2, 5, { slot: 2, tag: 6, pivot: neckPivot });
    b.blob(0.05, 0, V(0, q.head[1] - q.headSize[1] * 0.18, q.head[2] + q.headSize[2] * 0.3 + q.snout), V(1, 0.8, 0.8), { color: DARK, tag: 6, pivot: neckPivot });
  }
  // Eyes.
  for (const sx of [-1, 1]) b.blob(0.025, 0, V(sx * q.headSize[0] * 0.38, q.head[1] + q.headSize[1] * 0.12, q.head[2] + q.headSize[2] * 0.18), V(1, 1, 1), { color: DARK, tag: 6, pivot: neckPivot });
  // Tail (tag 5).
  const tailBase: [number, number, number] = [0, yB + q.bodyH * 0.15, -q.bodyLen * 0.48];
  if (q.tail > 0) {
    b.segment(V(...tailBase), V(0, yB - q.tail * 0.5, -q.bodyLen * 0.5 - q.tail * 0.55), bushyTail ? 0.08 : 0.03, bushyTail ? 0.1 : 0.02, 5, { slot: bushyTail ? 1 : 1, tag: 5, pivot: tailBase });
    if (bushyTail) b.blob(0.12, 1, V(0, yB - q.tail * 0.55, -q.bodyLen * 0.5 - q.tail * 0.6), V(0.9, 0.9, 1.6), { slot: 2, tag: 5, pivot: tailBase });
  }
}

function ears(b: MeshBuilder, q: QuadSpec, len: number, pointy: boolean): void {
  const np: [number, number, number] = [0, q.neck[1], q.neck[2]];
  for (const sx of [-1, 1]) {
    const base = V(sx * q.headSize[0] * 0.3, q.head[1] + q.headSize[1] * 0.35, q.head[2] - q.headSize[2] * 0.1);
    b.segment(base, base.clone().add(V(sx * len * 0.35, len, -len * 0.2)), pointy ? 0.05 : 0.06, pointy ? 0.005 : 0.03, 4, { slot: 1, tag: 6, pivot: np });
  }
}

function antlers(b: MeshBuilder, q: QuadSpec, scale: number, alwaysVisible: boolean): void {
  const np: [number, number, number] = [0, q.neck[1], q.neck[2]];
  const tag = alwaysVisible ? 6 : 10;
  for (const sx of [-1, 1]) {
    const base = V(sx * 0.07, q.head[1] + q.headSize[1] * 0.4, q.head[2] - 0.02);
    const mid = base.clone().add(V(sx * 0.18 * scale, 0.28 * scale, -0.08 * scale));
    const top = mid.clone().add(V(sx * 0.1 * scale, 0.25 * scale, 0.05 * scale));
    b.segment(base, mid, 0.03, 0.022, 4, { color: BONE, tag, pivot: np });
    b.segment(mid, top, 0.022, 0.012, 4, { color: BONE, tag, pivot: np });
    b.segment(mid, mid.clone().add(V(sx * 0.02, 0.14 * scale, 0.14 * scale)), 0.018, 0.01, 4, { color: BONE, tag, pivot: np });
    b.segment(top, top.clone().add(V(sx * 0.1 * scale, 0.1 * scale, -0.08 * scale)), 0.015, 0.008, 4, { color: BONE, tag, pivot: np });
  }
}

function horns(b: MeshBuilder, q: QuadSpec, len: number, curl: number): void {
  const np: [number, number, number] = [0, q.neck[1], q.neck[2]];
  for (const sx of [-1, 1]) {
    let p = V(sx * 0.07, q.head[1] + q.headSize[1] * 0.35, q.head[2]);
    let dir = V(sx * 0.35, 0.75, -0.4).normalize();
    for (let k = 0; k < 4; k++) {
      const next = p.clone().addScaledVector(dir, len / 4);
      b.segment(p, next, 0.045 * (1 - k * 0.2), 0.045 * (1 - (k + 1) * 0.2), 5, { color: lin(0x5b5046), tag: 6, pivot: np });
      p = next;
      dir.applyAxisAngle(V(1, 0, 0), -curl).normalize();
    }
  }
}

export const BODY_PLANS = ['deer', 'hare', 'bovine', 'gazelle', 'camel', 'goat', 'caribou', 'tapir', 'wolf', 'lion', 'bear', 'cat', 'fox'] as const;

function buildBody(plan: string): THREE.BufferGeometry {
  const b = new MeshBuilder();
  switch (plan) {
    case 'deer': {
      const q: QuadSpec = { legLen: 0.62, bodyLen: 0.95, bodyH: 0.42, bodyW: 0.34, neck: [0, 0.92, 0.36, 0, 1.28, 0.58], neckR: 0.09, head: [0, 1.34, 0.66], headSize: [0.2, 0.2, 0.32], snout: 0.12, tail: 0.12, legR: 0.05 };
      quadruped(b, q); ears(b, q, 0.16, true); antlers(b, q, 1.0, false);
      break;
    }
    case 'caribou': {
      const q: QuadSpec = { legLen: 0.58, bodyLen: 1.05, bodyH: 0.5, bodyW: 0.42, neck: [0, 0.92, 0.4, 0, 1.2, 0.62], neckR: 0.13, head: [0, 1.24, 0.72], headSize: [0.22, 0.22, 0.36], snout: 0.12, tail: 0.08, legR: 0.06 };
      quadruped(b, q); ears(b, q, 0.12, true); antlers(b, q, 1.35, true);
      b.blob(0.5, 1, V(0, 1.0, 0.44), V(0.3, 0.3, 0.32), { slot: 2, tag: 6, pivot: [0, 0.92, 0.4] });
      break;
    }
    case 'hare': {
      const q: QuadSpec = { legLen: 0.18, bodyLen: 0.55, bodyH: 0.4, bodyW: 0.34, neck: [0, 0.36, 0.2, 0, 0.44, 0.26], neckR: 0, head: [0, 0.5, 0.3], headSize: [0.22, 0.22, 0.26], snout: 0, tail: 0, legR: 0.045 };
      quadruped(b, q);
      for (const sx of [-1, 1]) b.segment(V(sx * 0.05, 0.6, 0.26), V(sx * 0.1, 0.95, 0.18), 0.04, 0.025, 4, { slot: 1, tag: 6, pivot: [0, 0.36, 0.2] });
      b.blob(0.07, 1, V(0, 0.4, -0.3), V(1, 1, 1), { slot: 2 });
      break;
    }
    case 'bovine': {
      const q: QuadSpec = { legLen: 0.5, bodyLen: 1.25, bodyH: 0.62, bodyW: 0.55, neck: [0, 0.95, 0.5, 0, 0.82, 0.78], neckR: 0.18, head: [0, 0.76, 0.86], headSize: [0.32, 0.3, 0.36], snout: 0.06, tail: 0.3, legR: 0.075 };
      quadruped(b, q);
      b.blob(0.5, 1, V(0, 1.08, 0.3), V(0.55, 0.45, 0.6), { slot: 2, ao: 0.2 }, 0.1);
      horns(b, q, 0.18, 0.5);
      ears(b, q, 0.08, false);
      break;
    }
    case 'gazelle': {
      const q: QuadSpec = { legLen: 0.66, bodyLen: 0.78, bodyH: 0.34, bodyW: 0.26, neck: [0, 0.9, 0.3, 0, 1.22, 0.46], neckR: 0.06, head: [0, 1.28, 0.54], headSize: [0.15, 0.15, 0.26], snout: 0.08, tail: 0.1, legR: 0.035 };
      quadruped(b, q); ears(b, q, 0.12, true);
      horns(b, q, 0.36, 0.12);
      break;
    }
    case 'camel': {
      const q: QuadSpec = { legLen: 0.95, bodyLen: 1.2, bodyH: 0.5, bodyW: 0.42, neck: [0, 1.22, 0.5, 0, 1.7, 0.9], neckR: 0.1, head: [0, 1.72, 1.02], headSize: [0.18, 0.18, 0.36], snout: 0.1, tail: 0.3, legR: 0.06 };
      quadruped(b, q);
      b.blob(0.5, 1, V(0, 1.5, -0.05), V(0.36, 0.4, 0.45), { slot: 1, ao: 0.2 }, 0.08);
      ears(b, q, 0.06, false);
      break;
    }
    case 'goat': {
      const q: QuadSpec = { legLen: 0.46, bodyLen: 0.78, bodyH: 0.42, bodyW: 0.34, neck: [0, 0.78, 0.3, 0, 1.0, 0.46], neckR: 0.08, head: [0, 1.04, 0.54], headSize: [0.18, 0.18, 0.26], snout: 0.06, tail: 0.06, legR: 0.05 };
      quadruped(b, q); ears(b, q, 0.08, true);
      horns(b, q, 0.55, 0.42);
      b.blob(0.06, 0, V(0, 0.9, 0.62), V(0.7, 1.6, 0.7), { slot: 2, tag: 6, pivot: [0, 0.78, 0.3] });
      break;
    }
    case 'tapir': {
      const q: QuadSpec = { legLen: 0.38, bodyLen: 1.1, bodyH: 0.56, bodyW: 0.5, neck: [0, 0.7, 0.44, 0, 0.72, 0.6], neckR: 0.18, head: [0, 0.7, 0.72], headSize: [0.26, 0.28, 0.4], snout: 0.22, tail: 0.04, legR: 0.07 };
      quadruped(b, q); ears(b, q, 0.07, false);
      break;
    }
    case 'wolf': {
      const q: QuadSpec = { legLen: 0.48, bodyLen: 0.85, bodyH: 0.34, bodyW: 0.28, neck: [0, 0.74, 0.34, 0, 0.84, 0.5], neckR: 0.1, head: [0, 0.86, 0.56], headSize: [0.2, 0.2, 0.26], snout: 0.16, tail: 0.4, legR: 0.045 };
      quadruped(b, q, true); ears(b, q, 0.13, true);
      break;
    }
    case 'fox': {
      const q: QuadSpec = { legLen: 0.26, bodyLen: 0.6, bodyH: 0.24, bodyW: 0.2, neck: [0, 0.42, 0.24, 0, 0.5, 0.34], neckR: 0.07, head: [0, 0.52, 0.4], headSize: [0.15, 0.14, 0.2], snout: 0.12, tail: 0.42, legR: 0.03 };
      quadruped(b, q, true); ears(b, q, 0.12, true);
      break;
    }
    case 'lion': {
      const q: QuadSpec = { legLen: 0.5, bodyLen: 1.05, bodyH: 0.44, bodyW: 0.36, neck: [0, 0.8, 0.4, 0, 0.9, 0.56], neckR: 0.14, head: [0, 0.92, 0.62], headSize: [0.26, 0.26, 0.3], snout: 0.08, tail: 0.55, legR: 0.07 };
      quadruped(b, q); ears(b, q, 0.06, false);
      // Mane (tag 10: males only).
      b.blob(0.5, 1, V(0, 0.92, 0.52), V(0.5, 0.52, 0.34), { slot: 2, tag: 10, pivot: [0, 0.8, 0.4], jitter: 0.1 }, 0.14);
      b.blob(0.06, 0, V(0, 0.36, -0.86), V(1, 1.3, 1), { slot: 2, tag: 5, pivot: [0, 0.72, -0.5] });
      break;
    }
    case 'cat': {
      const q: QuadSpec = { legLen: 0.4, bodyLen: 1.0, bodyH: 0.36, bodyW: 0.3, neck: [0, 0.66, 0.38, 0, 0.72, 0.52], neckR: 0.1, head: [0, 0.74, 0.58], headSize: [0.22, 0.2, 0.24], snout: 0.05, tail: 0.6, legR: 0.055 };
      quadruped(b, q); ears(b, q, 0.06, false);
      break;
    }
    case 'bear': {
      const q: QuadSpec = { legLen: 0.42, bodyLen: 1.15, bodyH: 0.62, bodyW: 0.58, neck: [0, 0.82, 0.46, 0, 0.84, 0.62], neckR: 0.2, head: [0, 0.86, 0.72], headSize: [0.32, 0.3, 0.34], snout: 0.12, tail: 0.04, legR: 0.1 };
      quadruped(b, q); ears(b, q, 0.06, false);
      b.blob(0.5, 1, V(0, 1.0, 0.32), V(0.5, 0.35, 0.4), { slot: 1 }, 0.08);
      break;
    }
  }
  return b.build();
}

const CREATURE_VS = /* glsl */ `
precision highp float;
${GLSL_CONSTANTS}
${GLSL_FRAME}
in vec3 aDir;
in vec4 aMotion; // ground, heading, phase, speed
in vec4 aLook;   // pose, scale, col1, col2
in float aFlags;
in vec3 aPivot;
in float aTag;
in float aSlot;
in vec3 color;
uniform float uLegLen;
uniform float uHop;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out vec3 vLocal;
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
void main() {
  float pose = aLook.x;
  float speed = aMotion.w;
  float phase = aMotion.z;
  float flags = aFlags;
  bool male = mod(floor(flags / 4.0), 2.0) > 0.5;
  bool young = mod(floor(flags / 2.0), 2.0) > 0.5;
  vec3 lp = position;
  vec3 nl = normal;
  float tag = aTag;
  float resting = (pose > 6.5 && pose < 7.5) || pose > 8.5 ? 1.0 : 0.0;
  float headDown = (pose > 0.5 && pose < 1.5) || (pose > 2.5 && pose < 3.5) || (pose > 5.5 && pose < 6.5) ? 1.0 : 0.0;
  // Antlers/manes only on males.
  if (tag > 9.5 && !male) lp = aPivot;
  if (tag > 0.5 && tag < 4.5) {
    float off = (tag < 1.5 || tag > 3.5) ? 0.0 : PI;
    float gallop = step(1.2, speed);
    off = mix(off, (tag < 2.5 ? 0.0 : PI * 0.8) + (mod(tag, 2.0) > 0.5 ? 0.0 : 0.35), gallop);
    float amp = min(1.0, speed) * mix(0.55, 0.85, gallop);
    if (uHop > 0.5) off = tag < 2.5 ? 0.0 : PI;
    float a = sin(phase + off) * amp;
    a = mix(a, (tag < 2.5 ? -1.45 : 1.45), resting);
    lp = rotX(lp, aPivot, a);
    nl = rotX(nl, vec3(0.0), a);
  }
  if (tag > 5.5 && tag < 6.5 || tag > 9.5) {
    float a = headDown * 0.95 + sin(phase * 0.5) * 0.05 * min(speed, 1.0);
    lp = rotX(lp, aPivot, a);
    nl = rotX(nl, vec3(0.0), a);
  }
  if (tag > 4.5 && tag < 5.5) {
    float wag = sin(phase * 1.3 + 1.0) * 0.25 + sin(uLegLen * 50.0 + phase) * 0.1;
    vec3 d = lp - aPivot;
    float c = cos(wag), s = sin(wag);
    lp = aPivot + vec3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
  }
  // Body bob while moving; hop for hares; lie down to rest.
  lp.y += abs(sin(phase)) * 0.05 * min(speed, 1.5) + uHop * abs(sin(phase)) * 0.25 * min(speed, 1.0);
  lp.y -= resting * uLegLen * 0.8;
  float sc = aLook.y * (young ? 0.6 : 1.0);
  lp *= sc;
  vec3 up = aDir;
  vec3 ax, az;
  tangentFrame(up, aMotion.y, ax, az);
  vWorld = up * (PLANET_R + aMotion.x) + ax * lp.x + up * lp.y + az * lp.z;
  vNormal = normalize(ax * nl.x + up * nl.y + az * nl.z);
  vec3 c1 = unpackRGB(aLook.z), c2 = unpackRGB(aLook.w);
  vColor = aSlot < 0.5 ? color : (aSlot < 1.5 ? c1 : c2) * color;
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const CREATURE_FS = /* glsl */ `
${OBJECT_FS_HEAD}
uniform float uSpots;
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in vec3 vLocal;
void main() {
  vec3 col = vColor;
  if (uSpots > 0.5) {
    float s = snoise(vLocal * 14.0);
    col *= 1.0 - smoothstep(0.35, 0.55, s) * 0.75;
  }
  vec3 c = shadeObject(vWorld, normalize(vNormal), col, 0.0, 0.0, vec3(0.0));
  outColor = vec4(c, 1.0);
}
`;

const STRIDE = 12;

interface Track {
  px: number; py: number; pz: number;
  cx: number; cy: number; cz: number;
  heading: number;
  phase: number;
  speed: number;
  seen: number;
}

export class Creatures {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  readonly depthMaterials: THREE.ShaderMaterial[] = [];
  private geos = new Map<string, THREE.InstancedBufferGeometry>();
  private bufs = new Map<string, { arr: Float32Array; buf: THREE.InstancedInterleavedBuffer; cap: number }>();
  private tracks = new Map<number, Track>();
  private prev: EntitySnapshot | null = null;
  private cur: EntitySnapshot | null = null;
  species: SpeciesInfo[] = [];
  visibleCount = 0;
  maxDistance = 420;
  /** uid → last rendered world position (for picking / follow). */
  lastPositions = new Map<number, THREE.Vector3>();

  constructor(shared: SharedUniforms) {
    for (const plan of BODY_PLANS) {
      const src = buildBody(plan);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = src.index;
      for (const name of ['position', 'normal', 'color', 'aPivot', 'aTag', 'aSlot']) geo.setAttribute(name, src.getAttribute(name));
      geo.instanceCount = 0;
      this.geos.set(plan, geo);
      this.allocate(plan, 128);
      const legLen = { deer: 0.62, caribou: 0.58, hare: 0.18, bovine: 0.5, gazelle: 0.66, camel: 0.95, goat: 0.46, tapir: 0.38, wolf: 0.48, fox: 0.26, lion: 0.5, cat: 0.4, bear: 0.42 }[plan];
      const uniforms = { ...shared, uLegLen: { value: legLen }, uHop: { value: plan === 'hare' ? 1 : 0 }, uSpots: { value: plan === 'cat' ? 1 : 0 } };
      const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: CREATURE_VS, fragmentShader: CREATURE_FS, uniforms });
      const depth = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: CREATURE_VS, fragmentShader: DEPTH_FS, uniforms, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.name = `animal-${plan}`;
      this.group.add(mesh);
      this.meshes.push(mesh);
      this.depthMaterials.push(depth);
    }
  }

  private allocate(plan: string, cap: number): void {
    const geo = this.geos.get(plan)!;
    const arr = new Float32Array(cap * STRIDE);
    const buf = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDir', new THREE.InterleavedBufferAttribute(buf, 3, 0));
    geo.setAttribute('aMotion', new THREE.InterleavedBufferAttribute(buf, 4, 3));
    geo.setAttribute('aLook', new THREE.InterleavedBufferAttribute(buf, 4, 7));
    geo.setAttribute('aFlags', new THREE.InterleavedBufferAttribute(buf, 1, 11));
    this.bufs.set(plan, { arr, buf, cap });
  }

  /** Direction of the densest gathering of animals in the latest snapshot. */
  densestSpot(): THREE.Vector3 | null {
    const cur = this.cur;
    if (!cur || cur.count === 0) return null;
    let best = -1, bestN = -1;
    const step = Math.max(1, Math.floor(cur.count / 400));
    const r2 = (25 / PLANET_RADIUS) ** 2;
    for (let a = 0; a < cur.count; a += step) {
      let n = 0;
      for (let b = 0; b < cur.count; b++) {
        const dx = cur.pos[a * 3] - cur.pos[b * 3], dy = cur.pos[a * 3 + 1] - cur.pos[b * 3 + 1], dz = cur.pos[a * 3 + 2] - cur.pos[b * 3 + 2];
        if (dx * dx + dy * dy + dz * dz < r2) n++;
      }
      if (n > bestN) { bestN = n; best = a; }
    }
    return new THREE.Vector3(cur.pos[best * 3], cur.pos[best * 3 + 1], cur.pos[best * 3 + 2]);
  }

  /** Accept a new snapshot; returns the one that can be recycled. */
  pushSnapshot(s: EntitySnapshot): EntitySnapshot | null {
    const recycle = this.prev;
    this.prev = this.cur;
    this.cur = s;
    // Update tracks: previous position becomes the old current.
    const seenTick = s.tick;
    for (let k = 0; k < s.count; k++) {
      const uid = s.info[k * 2];
      let t = this.tracks.get(uid);
      const x = s.pos[k * 3], y = s.pos[k * 3 + 1], z = s.pos[k * 3 + 2];
      if (!t) {
        t = { px: x, py: y, pz: z, cx: x, cy: y, cz: z, heading: (uid % 628) / 100, phase: (uid % 100) / 10, speed: 0, seen: seenTick };
        this.tracks.set(uid, t);
      } else {
        t.px = t.cx; t.py = t.cy; t.pz = t.cz;
        t.cx = x; t.cy = y; t.cz = z;
        t.seen = seenTick;
      }
    }
    for (const [uid, t] of this.tracks) if (t.seen !== seenTick) { this.tracks.delete(uid); this.lastPositions.delete(uid); }
    return recycle;
  }

  update(camera: THREE.PerspectiveCamera, renderTick: number, dTick: number, data: PlanetData, dt: number): void {
    const cur = this.cur;
    for (const g of this.geos.values()) g.instanceCount = 0;
    this.visibleCount = 0;
    if (!cur || this.species.length === 0) return;
    const prevTick = this.prev ? this.prev.tick : cur.tick - 1;
    const span = Math.max(1, cur.tick - prevTick);
    const alpha = Math.min(1, Math.max(0, (renderTick - prevTick) / span));
    const cam = camera.position;
    const camR = cam.length();
    const maxD = this.maxDistance;
    const counts = new Map<string, number>();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    if (camR - PLANET_RADIUS > maxD * 1.5) return;
    for (let k = 0; k < cur.count; k++) {
      const uid = cur.info[k * 2];
      const t = this.tracks.get(uid);
      if (!t) continue;
      let x = t.px + (t.cx - t.px) * alpha, y = t.py + (t.cy - t.py) * alpha, z = t.pz + (t.cz - t.pz) * alpha;
      const l = Math.hypot(x, y, z);
      x /= l; y /= l; z /= l;
      const wx = x * PLANET_RADIUS - cam.x, wy = y * PLANET_RADIUS - cam.y, wz = z * PLANET_RADIUS - cam.z;
      const d2 = wx * wx + wy * wy + wz * wz;
      if (d2 > maxD * maxD) continue;
      if (wx * fwd.x + wy * fwd.y + wz * fwd.z < -20) continue;
      const packed = cur.info[k * 2 + 1];
      const sp = packed & 255;
      const state = (packed >>> 8) & 255;
      const size = ((packed >>> 16) & 255) / 60;
      const flags = packed >>> 24;
      const info = this.species[sp];
      if (!info) continue;
      // Heading from motion (east/north components).
      const mx = t.cx - t.px, my = t.cy - t.py, mz = t.cz - t.pz;
      const moved = Math.hypot(mx, my, mz) * PLANET_RADIUS;
      let ex = z, ez = -x;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el; ez /= el;
      const nx = y * ez, ny = z * ex - x * ez, nz = -y * ex;
      if (moved > 0.02) {
        const me = mx * ex + mz * ez, mn = mx * nx + my * ny + mz * nz;
        const target = Math.atan2(me, -mn);
        let dh = target - t.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        t.heading += dh * Math.min(1, dt * 6);
      }
      const perTick = moved / span;
      t.speed += ((perTick / Math.max(0.2, info.size * 0.35)) - t.speed) * Math.min(1, dt * 4);
      t.phase += Math.min(1.2, (perTick * Math.max(0, dTick) * 3.2) / Math.max(0.25, size * 0.6));
      const ground = groundHeight(data.heights, data.n, x, y, z);
      const plan = info.body;
      const n = counts.get(plan) ?? 0;
      let entry = this.bufs.get(plan)!;
      if (n >= entry.cap) { this.allocate(plan, entry.cap * 2); const old = entry; entry = this.bufs.get(plan)!; entry.arr.set(old.arr); }
      const o = n * STRIDE;
      const a = entry.arr;
      a[o] = x; a[o + 1] = y; a[o + 2] = z;
      a[o + 3] = ground; a[o + 4] = t.heading; a[o + 5] = t.phase; a[o + 6] = t.speed;
      a[o + 7] = state; a[o + 8] = size; a[o + 9] = info.colour; a[o + 10] = info.colour2; a[o + 11] = flags;
      counts.set(plan, n + 1);
      this.visibleCount++;
      let lp = this.lastPositions.get(uid);
      if (!lp) { lp = new THREE.Vector3(); this.lastPositions.set(uid, lp); }
      lp.set(x * (PLANET_RADIUS + ground), y * (PLANET_RADIUS + ground), z * (PLANET_RADIUS + ground));
    }
    for (const [plan, n] of counts) {
      const geo = this.geos.get(plan)!;
      geo.instanceCount = n;
      const e = this.bufs.get(plan)!;
      e.buf.clearUpdateRanges();
      e.buf.addUpdateRange(0, n * STRIDE);
      e.buf.needsUpdate = true;
    }
  }
}
