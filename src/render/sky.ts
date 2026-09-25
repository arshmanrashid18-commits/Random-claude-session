/**
 * Sky layer: procedural starfield + Milky Way + faint nebulae on a full-screen
 * quad, and a procedurally cratered moon. Rendered first with a far-reaching
 * camera; the planet scene is drawn over it and the atmosphere pass then
 * attenuates everything seen through the air.
 */
import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_NOISE } from './glsl/common';
import { MOON_RADIUS } from '../sim/constants';

const SKY_VS = /* glsl */ `
out vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

const SKY_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_NOISE}
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uSidereal;
uniform float uTime;
uniform float uStarBrightness;
uniform float uPixelAngle;
in vec2 vNdc;

vec3 starColor(float t) {
  // Approximate blackbody tint from blue-white to deep orange.
  vec3 hot = vec3(0.62, 0.74, 1.0);
  vec3 sun = vec3(1.0, 0.95, 0.86);
  vec3 cool = vec3(1.0, 0.66, 0.38);
  return t < 0.5 ? mix(hot, sun, t * 2.0) : mix(sun, cool, (t - 0.5) * 2.0);
}

float starLayer(vec3 d, float res, float density, float seed, out vec3 col) {
  vec2 ab;
  int f = dirToFaceAB(d, ab);
  vec2 g = (ab * 0.5 + 0.5) * res;
  vec2 cell = floor(g);
  float best = 0.0;
  col = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      vec3 hs = hash33(vec3(c, float(f) * 17.0 + seed));
      if (hs.z > density) continue;
      vec2 sp = (c + hs.xy) / res * 2.0 - 1.0;
      vec3 sd = faceABToDir(f, sp);
      // Chord distance is smooth near the star (acos is not).
      float dist = length(sd - d);
      float mag = pow(hash13(vec3(c * 1.7, seed + float(f))), 14.0);
      float size = uPixelAngle * (0.7 + mag * 1.6);
      float b = exp(-(dist * dist) / (size * size)) * (0.015 + mag * 1.6);
      if (b > best) {
        best = b;
        col = starColor(hash13(vec3(c * 3.1, seed * 1.3 + float(f))));
      }
    }
  }
  return best;
}

void main() {
  vec4 farV = uInvProj * vec4(vNdc, 1.0, 1.0);
  farV /= farV.w;
  vec3 rd = normalize((uCamWorld * vec4(farV.xyz, 1.0)).xyz - uCamPos);
  // Rotate into the celestial frame (stars fixed while the planet spins).
  float c = cos(uSidereal), s = sin(uSidereal);
  vec3 d = vec3(c * rd.x - s * rd.z, rd.y, s * rd.x + c * rd.z);

  // Milky Way: a tilted galactic plane with a brighter core and dust lanes.
  vec3 G = normalize(vec3(0.35, 0.62, -0.7));
  vec3 core = normalize(vec3(-0.8, 0.1, -0.2));
  core = normalize(core - G * dot(core, G));
  float b = dot(d, G);
  float band = exp(-b * b / 0.028);
  float coreGlow = exp(-pow(acos(clamp(dot(d, core), -1.0, 1.0)), 2.0) / 0.5);
  float clouds = fbm4(d * 6.0) * 0.5 + 0.5;
  float fine = fbm3(d * 22.0) * 0.5 + 0.5;
  float dust = smoothstep(0.35, 0.75, fbm4(d * 9.0 + 3.0) * 0.5 + 0.5) * exp(-b * b / 0.004);
  float mw = band * (0.35 + 0.65 * clouds) * (0.6 + 0.4 * fine) * (1.0 + 2.2 * coreGlow);
  mw *= 1.0 - dust * 0.85;
  vec3 mwCol = mix(vec3(0.5, 0.6, 0.9), vec3(1.0, 0.8, 0.6), coreGlow * 0.7 + fine * 0.15) * mw * 0.09;

  // Nebulae: faint coloured clouds.
  float neb = smoothstep(0.55, 0.9, fbm3(d * 3.0 + 7.0) * 0.5 + 0.5);
  vec3 nebCol = mix(vec3(0.6, 0.15, 0.35), vec3(0.15, 0.35, 0.6), fbm3(d * 5.0) * 0.5 + 0.5) * neb * 0.02;

  vec3 col = mwCol + nebCol;
  vec3 sc;
  float st = starLayer(d, 70.0, 0.55, 1.0, sc);
  col += sc * st * 1.4;
  st = starLayer(d, 190.0, 0.22 + band * 0.4, 2.0, sc);
  col += sc * st * 0.5;
  st = starLayer(d, 420.0, 0.05 + band * 0.45, 3.0, sc);
  col += sc * st * 0.25;
  outColor = vec4(col * uStarBrightness, 1.0);
}
`;

const MOON_VS = /* glsl */ `
out vec3 vN;
out vec3 vLocal;
void main() {
  vLocal = position;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MOON_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
${GLSL_NOISE}
uniform vec3 uSunDir;
uniform float uSunIntensity;
in vec3 vN;
in vec3 vLocal;
float crater(vec3 p, float scale, float seed) {
  vec3 g = p * scale;
  vec3 c = floor(g);
  float acc = 0.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 cc = c + vec3(float(i), float(j), float(k));
    vec3 hs = hash33(cc + seed);
    vec3 cp = cc + hs;
    float r = 0.25 + hs.x * 0.35;
    float d = length(g - cp) / r;
    if (d < 1.2) {
      float bowl = smoothstep(1.0, 0.0, d) * -0.6;
      float rim = exp(-pow((d - 1.0) / 0.12, 2.0)) * 0.5;
      acc += (bowl + rim) * step(0.55, hs.y);
    }
  }
  return acc;
}
void main() {
  vec3 p = normalize(vLocal);
  float maria = smoothstep(0.1, 0.45, fbm3(p * 1.6 + 2.0));
  float h = crater(p, 5.0, 1.0) * 0.6 + crater(p, 13.0, 7.0) * 0.3 + crater(p, 31.0, 3.0) * 0.15;
  vec3 albedo = mix(vec3(0.62, 0.6, 0.57), vec3(0.28, 0.28, 0.3), maria) * (0.9 + fbm3(p * 40.0) * 0.1);
  albedo *= 1.0 + h * 0.35;
  // Bump from crater relief.
  vec3 N = normalize(vN + (vec3(crater(p + vec3(0.01, 0.0, 0.0), 5.0, 1.0), crater(p + vec3(0.0, 0.01, 0.0), 5.0, 1.0), crater(p + vec3(0.0, 0.0, 0.01), 5.0, 1.0)) - crater(p, 5.0, 1.0)) * 1.5);
  float ndl = max(dot(N, uSunDir), 0.0);
  vec3 col = albedo * ndl * uSunIntensity * 0.32 + albedo * 0.004;
  outColor = vec4(col, 1.0);
}
`;

export class SkyLayer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly skyMat: THREE.ShaderMaterial;
  readonly moonMat: THREE.ShaderMaterial;
  readonly moon: THREE.Mesh;

  constructor(shared: Record<string, THREE.IUniform>) {
    this.camera = new THREE.PerspectiveCamera(50, 1, 50, 60000);
    this.skyMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: shared.uCamPos,
        uSidereal: { value: 0 },
        uTime: shared.uTime,
        uStarBrightness: { value: 1 },
        uPixelAngle: { value: 0.001 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.skyMat);
    quad.frustumCulled = false;
    quad.renderOrder = -10;
    this.scene.add(quad);
    this.moonMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: MOON_VS,
      fragmentShader: MOON_FS,
      uniforms: { uSunDir: shared.uSunDir, uSunIntensity: shared.uSunIntensity },
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, 96, 64), this.moonMat);
    this.moon.frustumCulled = false;
    this.scene.add(this.moon);
  }

  sync(main: THREE.PerspectiveCamera, sidereal: number, moonPos: THREE.Vector3, viewportHeight: number): void {
    this.skyMat.uniforms.uPixelAngle.value = ((main.fov * Math.PI) / 180) / Math.max(1, viewportHeight);
    this.camera.position.copy(main.position);
    this.camera.quaternion.copy(main.quaternion);
    this.camera.fov = main.fov;
    this.camera.aspect = main.aspect;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.skyMat.uniforms.uInvProj.value.copy(this.camera.projectionMatrixInverse);
    this.skyMat.uniforms.uCamWorld.value.copy(this.camera.matrixWorld);
    this.skyMat.uniforms.uSidereal.value = sidereal;
    this.moon.position.copy(moonPos);
    // Tidal locking: the same face always points at the planet.
    this.moon.lookAt(0, 0, 0);
  }
}
