/**
 * GPU-placed grass near the camera.
 *
 * A fixed set of instances forms a square lattice (sorted by distance so a
 * prefix gives a disc). The lattice is anchored to a snapped cell of the
 * cube-face parameterisation, so blade positions are world-stable as the
 * camera moves. Each instance hashes its lattice coordinate for jitter and
 * decides in the vertex shader whether grass grows there (simulated grass
 * cover, slope, snow, shoreline), then sits exactly on groundHeight().
 */
import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_DETAIL, GLSL_HEIGHT, GLSL_NOISE, GLSL_REGION } from './glsl/common';
import { GLSL_FRAME, OBJECT_FS_HEAD } from './glsl/objects';
import { DEPTH_FS, type SharedUniforms } from './planet/terrain';
import { dirToFaceAB } from '../sim/planet/cubesphere';
import { PLANET_RADIUS } from '../sim/constants';

const BLADES = 4;
/** Lattice spacing in heightmap-param units: 1/6 of a heightmap cell. */
const SUBDIV = 6;

function clumpGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const t: number[] = []; // height along blade 0..1
  const idx: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const ang = (b / BLADES) * Math.PI * 2 + b * 0.7;
    const off = 0.12 + (b % 2) * 0.1;
    const ox = Math.cos(ang) * off, oz = Math.sin(ang) * off;
    const dx = Math.cos(ang + 1.6), dz = Math.sin(ang + 1.6);
    const lean = 0.25 + (b % 3) * 0.12;
    const base = pos.length / 3;
    const w = 0.035;
    const h = 0.5;
    // 5 vertices: base L/R, mid L/R, tip.
    const verts = [
      [-w, 0], [w, 0], [-w * 0.6, 0.55], [w * 0.6, 0.55], [0, 1],
    ];
    for (const [s, y] of verts) {
      const bend = y * y * lean * h;
      pos.push(ox + dx * s + Math.cos(ang) * bend, y * h, oz + dz * s + Math.sin(ang) * bend);
      t.push(y);
    }
    idx.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setIndex(idx);
  return g;
}

const GRASS_VS = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_HEIGHT}
${GLSL_REGION}
${GLSL_NOISE}
${GLSL_DETAIL}
${GLSL_FRAME}
in vec2 aCell;
in float aT;
uniform highp sampler2DArray uNormalTex;
uniform int uGrassFace;
uniform vec2 uGrassAnchor;
uniform float uGrassStep;
uniform float uGrassRadius;
uniform float uTime;
uniform float uWind;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vT;
void main() {
  vec2 cell = aCell;
  vec2 lat = floor(uGrassAnchor / uGrassStep + 0.5) + cell;
  vec3 hs = hash33(vec3(lat, float(uGrassFace) * 7.13));
  vec2 ab = (lat + hs.xy) * uGrassStep;
  vec3 dir = faceABToDir(uGrassFace, ab);
  float h = groundHeight(dir);
  vec3 base = dir * (PLANET_R + h);
  float dist = distance(base, uCamPos);
  // Does grass grow here?
  vec3 ruv = regionUV(dir);
  vec4 veg = texture(uVegATex, ruv);
  vec4 clim = texture(uClimateTex, ruv);
  vec2 nab;
  int nf = dirToFaceAB(dir, nab);
  vec2 nuv = ((nab + 1.0) * 0.5 * uHeightN + 0.5) / (uHeightN + 1.0);
  vec3 N = normalize(texture(uNormalTex, vec3(nuv, float(nf))).xyz);
  float slope = 1.0 - dot(N, dir);
  float patchy = 0.55 + 0.45 * snoise(dir * 900.0);
  float density = veg.r * 1.4 * patchy * (1.0 - smoothstep(0.28, 0.42, slope)) * (1.0 - smoothstep(0.2, 0.5, clim.b)) * smoothstep(0.35, 0.9, h);
  float fade = 1.0 - smoothstep(uGrassRadius * 0.6, uGrassRadius, dist);
  float alive = step(hs.z, density) * fade;
  float scale = alive * (0.55 + hs.x * 0.6) * mix(0.6, 1.2, veg.r);
  vec3 ax, az;
  tangentFrame(dir, hs.y * 6.283, ax, az);
  vec3 lp = position * vec3(1.0, 1.0, 1.0) * scale;
  lp.y *= 0.9 + hs.z * 0.7;
  float ph = dot(lat, vec2(0.37, 0.61));
  float gust = sin(uTime * 1.9 + ph + dot(dir, vec3(40.0))) * 0.5 + sin(uTime * 4.3 + ph * 2.1) * 0.2 + 0.25;
  float bend = aT * aT * uWind * gust * 0.35 * scale;
  lp.x += bend;
  vWorld = base + ax * lp.x + dir * lp.y + az * lp.z;
  vNormal = normalize(dir + ax * 0.3 * (hs.x - 0.5));
  // Grass colour follows the climate like the terrain beneath it.
  float temp = clim.r * 80.0 - 40.0;
  float moist = clim.g * 4.0;
  vec3 lush = pow(vec3(0.30, 0.52, 0.17), vec3(2.2));
  vec3 dry = pow(vec3(0.70, 0.64, 0.36), vec3(2.2));
  vec3 cold = pow(vec3(0.50, 0.52, 0.36), vec3(2.2));
  vec3 c = mix(dry, lush, smoothstep(0.6, 1.8, moist));
  c = mix(c, cold, 1.0 - smoothstep(-4.0, 6.0, temp));
  c *= 0.8 + hs.x * 0.4;
  vColor = c * mix(0.45, 1.15, aT);
  vT = aT;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const GRASS_FS = /* glsl */ `
${OBJECT_FS_HEAD}
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vT;
void main() {
  vec3 c = shadeObject(vWorld, normalize(vNormal), vColor, 0.8, 0.0, vec3(0.0));
  outColor = vec4(c, 1.0);
}
`;

export class Grass {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly depthMaterial: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private maxCount: number;
  budget = 30000;
  radius = 40;

  constructor(shared: SharedUniforms, normalTex: THREE.Texture, maxCount = 60000) {
    this.maxCount = maxCount;
    const side = Math.ceil(Math.sqrt(maxCount)) | 1;
    const cells: [number, number][] = [];
    const half = (side - 1) / 2;
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) cells.push([i - half, j - half]);
    cells.sort((p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]));
    const arr = new Float32Array(maxCount * 2);
    for (let k = 0; k < maxCount; k++) { arr[k * 2] = cells[k][0]; arr[k * 2 + 1] = cells[k][1]; }
    const src = clumpGeometry();
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = src.index;
    this.geo.setAttribute('position', src.getAttribute('position'));
    this.geo.setAttribute('aT', src.getAttribute('aT'));
    this.geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(arr, 2));
    this.geo.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: GRASS_VS,
      fragmentShader: GRASS_FS,
      uniforms: {
        ...shared,
        uNormalTex: { value: normalTex },
        uGrassFace: { value: 0 },
        uGrassAnchor: { value: new THREE.Vector2() },
        uGrassStep: { value: 0.001 },
        uGrassRadius: { value: 40 },
        uWind: { value: 1 },
      },
      side: THREE.DoubleSide,
    });
    this.depthMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: GRASS_VS,
      fragmentShader: DEPTH_FS,
      uniforms: this.material.uniforms,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'grass';
  }

  update(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, heightN: number): void {
    const camR = camera.position.length();
    const camDir = camera.position.clone().divideScalar(camR);
    const alt = camR - PLANET_RADIUS;
    if (this.budget <= 0 || alt > 140) {
      this.geo.instanceCount = 0;
      return;
    }
    // Centre between the point below the camera and the focus.
    const center = camDir.clone().add(focus).normalize();
    const f = dirToFaceAB(center.x, center.y, center.z);
    const step = 2 / heightN / SUBDIV;
    const u = this.material.uniforms;
    u.uGrassFace.value = f.face;
    (u.uGrassAnchor.value as THREE.Vector2).set(f.a, f.b);
    u.uGrassStep.value = step;
    const spacing = step * 0.5 * (Math.PI / 2) * PLANET_RADIUS; // approx world units per lattice step
    const span = camDir.angleTo(focus) * PLANET_RADIUS;
    const radius = Math.min(70, Math.max(26, span * 0.5 + 30));
    u.uGrassRadius.value = radius;
    const needed = Math.ceil(Math.PI * (radius / spacing) ** 2);
    this.geo.instanceCount = Math.min(this.maxCount, this.budget, needed);
    this.radius = radius;
  }
}
