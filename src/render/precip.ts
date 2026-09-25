/**
 * Rain and snow around the camera. A cylinder of streaks (or flakes) is
 * anchored in the local tangent frame below the camera; positions wrap on
 * the GPU so there is no per-drop CPU work. Intensity comes from the
 * simulated rain field at the camera's location, snow from temperature.
 */
import * as THREE from 'three';
import { PLANET_RADIUS } from '../sim/constants';
import type { PlanetData } from './planet/planetData';
import { dirToFaceAB } from '../sim/planet/cubesphere';

const VS = /* glsl */ `
precision highp float;
in vec3 position;
in vec4 aSeed; // x, z in [-1,1], phase, size jitter
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uAnchor;
uniform vec3 uEast;
uniform vec3 uNorth;
uniform vec3 uUp;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uRadius;
uniform float uHeight;
uniform float uSnow;
uniform vec2 uWind;
out float vAlpha;
out vec2 vUv;
out float vSnow;
void main() {
  float speed = mix(26.0, 2.2, uSnow) * (0.8 + aSeed.w * 0.4);
  float y = mod(aSeed.z * uHeight - uTime * speed, uHeight);
  vec2 xz = aSeed.xy * uRadius;
  // Snow drifts and sways; rain slants with the wind.
  xz += uWind * (uHeight - y) * mix(0.05, 0.4, uSnow);
  xz += uSnow * vec2(sin(uTime * 1.3 + aSeed.z * 20.0), cos(uTime * 1.1 + aSeed.x * 17.0)) * 0.8;
  // Keep the column centred on the camera by wrapping horizontally.
  vec3 base = uAnchor + uEast * xz.x + uNorth * xz.y + uUp * (y - uHeight * 0.35);
  vec3 toCam = uCamPos - base;
  vec3 fall = normalize(-uUp * speed + (uEast * uWind.x + uNorth * uWind.y) * mix(0.5, 1.0, uSnow));
  vec3 side = normalize(cross(fall, toCam));
  float len = mix(0.9, 0.1, uSnow) * (0.8 + aSeed.w * 0.5);
  float wid = mix(0.012, 0.07, uSnow) * (0.8 + aSeed.w * 0.5);
  vec3 p = base + side * position.x * wid + (uSnow > 0.5 ? cross(side, normalize(toCam)) * position.y * wid : fall * position.y * len);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float d = length(toCam);
  vAlpha = smoothstep(uRadius, uRadius * 0.4, length(xz)) * smoothstep(0.5, 3.0, d);
  vUv = position.xy;
  vSnow = uSnow;
}
`;
const FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
in float vAlpha;
in vec2 vUv;
in float vSnow;
uniform float uIntensity;
uniform vec3 uLight;
void main() {
  float a;
  if (vSnow > 0.5) a = smoothstep(1.0, 0.3, length(vUv));
  else a = (1.0 - abs(vUv.x)) * smoothstep(1.0, 0.2, abs(vUv.y));
  a *= vAlpha * mix(0.35, 0.9, vSnow) * uIntensity;
  if (a < 0.004) discard;
  outColor = vec4(uLight * a, a);
}
`;

export class Precipitation {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.RawShaderMaterial;
  readonly max = 26000;
  intensity = 0;
  snow = 0;
  private time = 0;
  /** Current local rain intensity (0..1) for audio. */
  level = 0;

  constructor() {
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    const seeds = new Float32Array(this.max * 4);
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < this.max; i++) {
      // Uniform in a disc.
      const a = r() * Math.PI * 2, d = Math.sqrt(r());
      seeds[i * 4] = Math.cos(a) * d;
      seeds[i * 4 + 1] = Math.sin(a) * d;
      seeds[i * 4 + 2] = r();
      seeds[i * 4 + 3] = r();
    }
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geo.instanceCount = 0;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS,
      uniforms: {
        uAnchor: { value: new THREE.Vector3() }, uEast: { value: new THREE.Vector3() }, uNorth: { value: new THREE.Vector3() }, uUp: { value: new THREE.Vector3() },
        uCamPos: { value: new THREE.Vector3() }, uTime: { value: 0 }, uRadius: { value: 40 }, uHeight: { value: 30 }, uSnow: { value: 0 },
        uWind: { value: new THREE.Vector2() }, uIntensity: { value: 0 }, uLight: { value: new THREE.Vector3(1, 1, 1) },
      },
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 33;
  }

  update(camera: THREE.PerspectiveCamera, data: PlanetData, dt: number, sunDir: THREE.Vector3, sunIntensity: number, extraRain: number): void {
    this.time += dt;
    const cam = camera.position;
    const r = cam.length();
    const up = cam.clone().divideScalar(r);
    const f = dirToFaceAB(up.x, up.y, up.z);
    const rain = Math.min(1, data.sampleRegion(data.fxCPU, f.face, f.a, f.b, 0) * 1.8 + extraRain);
    const temp = data.sampleRegion(data.climateCPU, f.face, f.a, f.b, 0) * 80 - 40;
    const ground = Math.max(0, data.heightAt(up.x, up.y, up.z));
    const alt = r - PLANET_RADIUS - ground;
    // Fade out above the clouds and far from the ground.
    const altK = 1 - Math.min(1, Math.max(0, (alt - 60) / 80));
    const target = rain > 0.08 ? rain : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.5);
    const visible = this.intensity * altK;
    this.snow += ((temp < 0.5 ? 1 : 0) - this.snow) * Math.min(1, dt * 0.8);
    this.level = visible * (1 - this.snow * 0.7);
    const u = this.mat.uniforms;
    const n = Math.floor(this.max * Math.min(1, visible) * (this.snow > 0.5 ? 0.45 : 1));
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n === 0) return;
    const east = new THREE.Vector3(up.z, 0, -up.x).normalize();
    const north = new THREE.Vector3().crossVectors(up, east);
    // Anchor snaps to a coarse grid so drops don't slide with the camera.
    const radius = Math.min(60, 20 + alt * 0.6);
    const height = Math.min(50, 16 + alt * 0.8);
    const anchor = up.clone().multiplyScalar(PLANET_RADIUS + ground + Math.min(alt, 30) * 0.5);
    (u.uAnchor.value as THREE.Vector3).copy(anchor);
    (u.uEast.value as THREE.Vector3).copy(east);
    (u.uNorth.value as THREE.Vector3).copy(north);
    (u.uUp.value as THREE.Vector3).copy(up);
    (u.uCamPos.value as THREE.Vector3).copy(cam);
    u.uTime.value = this.time;
    u.uRadius.value = radius;
    u.uHeight.value = height;
    u.uSnow.value = this.snow;
    u.uIntensity.value = Math.min(1, visible * 1.4);
    const day = Math.max(0, up.dot(sunDir));
    const light = (0.02 + day * 0.9) * sunIntensity * 0.06;
    (u.uLight.value as THREE.Vector3).set(light * 0.9, light * 0.95, light);
    (u.uWind.value as THREE.Vector2).set(Math.sin(this.time * 0.1) * 0.3 + 0.4, 0.2);
  }
}
