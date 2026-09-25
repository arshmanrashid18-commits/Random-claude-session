/**
 * Post-processing chain (all hand-written GLSL):
 *   bright-pass → bloom mip chain (downsample 13-tap, upsample tent)
 *   god rays (radial blur of the sky/sun mask)
 *   optional depth of field (photo mode)
 *   final: exposure, ACES filmic tone map, colour grading/filters, lens flare,
 *          vignette, film grain, chromatic aberration (impacts only)
 *   FXAA
 */
import * as THREE from 'three';
import { GLSL_TONEMAP } from './glsl/common';

const VS = /* glsl */ `
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uThreshold;
in vec2 vUv;
void main() {
  vec3 c = texture(tInput, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture(tInput, vUv + uTexel * vec2(0.5, -0.5)).rgb
    + texture(tInput, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture(tInput, vUv + uTexel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  c = min(c, vec3(400.0));
  float br = max(c.r, max(c.g, c.b));
  float knee = uThreshold * 0.6;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  outColor = vec4(c * contrib, 1.0);
}
`;

const DOWN_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
uniform sampler2D tInput;
uniform vec2 uTexel;
in vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 a = texture(tInput, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture(tInput, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 c = texture(tInput, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 d = texture(tInput, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture(tInput, vUv).rgb;
  vec3 f = texture(tInput, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(tInput, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 h = texture(tInput, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 i = texture(tInput, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 j = texture(tInput, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 k = texture(tInput, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 l = texture(tInput, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 m = texture(tInput, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  outColor = vec4(o, 1.0);
}
`;

const UP_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
uniform sampler2D tInput;
uniform sampler2D tPrev;
uniform vec2 uTexel;
uniform float uRadius;
in vec2 vUv;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(tInput, vUv + vec2(-t.x, -t.y)).rgb + texture(tInput, vUv + vec2(t.x, -t.y)).rgb
    + texture(tInput, vUv + vec2(-t.x, t.y)).rgb + texture(tInput, vUv + vec2(t.x, t.y)).rgb;
  s += (texture(tInput, vUv + vec2(0.0, -t.y)).rgb + texture(tInput, vUv + vec2(0.0, t.y)).rgb
    + texture(tInput, vUv + vec2(-t.x, 0.0)).rgb + texture(tInput, vUv + vec2(t.x, 0.0)).rgb) * 2.0;
  s += texture(tInput, vUv).rgb * 4.0;
  s /= 16.0;
  outColor = vec4(s + texture(tPrev, vUv).rgb, 1.0);
}
`;

const GODRAY_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSunUv;
uniform float uIntensity;
in vec2 vUv;
void main() {
  vec2 delta = (vUv - uSunUv);
  const int N = 40;
  vec2 stepv = delta / float(N) * 0.95;
  vec2 uv = vUv;
  float decay = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    uv -= stepv;
    float d = texture(tDepth, uv).r;
    float skyMask = step(0.99999, d);
    vec3 c = texture(tColor, uv).rgb;
    float br = max(c.r, max(c.g, c.b));
    acc += c * skyMask * smoothstep(1.5, 12.0, br) * decay;
    decay *= 0.965;
  }
  outColor = vec4(acc / float(N) * uIntensity, 1.0);
}
`;

const DOF_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform float uFocus;
uniform float uAperture;
uniform vec2 uTexel;
in vec2 vUv;
float viewDist(vec2 uv) {
  float d = texture(tDepth, uv).r;
  vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w);
}
float coc(vec2 uv) {
  float z = viewDist(uv);
  return clamp(abs(z - uFocus) / max(z, 1e-3) * uAperture, 0.0, 1.0);
}
void main() {
  float c0 = coc(vUv);
  vec3 acc = texture(tColor, vUv).rgb;
  float wsum = 1.0;
  const int RINGS = 3;
  for (int r = 1; r <= RINGS; r++) {
    int count = r * 8;
    for (int k = 0; k < 24; k++) {
      if (k >= count) break;
      float a = 6.2831853 * float(k) / float(count) + float(r) * 0.7;
      vec2 off = vec2(cos(a), sin(a)) * float(r) / float(RINGS) * 14.0 * uTexel;
      vec2 uv = vUv + off * c0;
      float cs = coc(uv);
      float w = smoothstep(0.0, 0.3, cs) * 0.5 + 0.5 * step(cs, c0 + 0.1);
      acc += texture(tColor, uv).rgb * w;
      wsum += w;
    }
  }
  outColor = vec4(acc / wsum, 1.0);
}
`;

const FINAL_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
${GLSL_TONEMAP}
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform sampler2D tDepth;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uVignette;
uniform float uGrain;
uniform float uCA;
uniform float uTime;
uniform vec2 uSunUv;
uniform float uSunVisible;
uniform float uFlare;
uniform float uAspect;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uTint;
uniform int uFilter;
uniform float uFade;
uniform vec3 uFadeColor;
uniform int uColorblind;
in vec2 vUv;

vec3 flare(vec2 uv) {
  if (uSunVisible <= 0.0) return vec3(0.0);
  vec2 c = vec2(0.5);
  vec2 dir = c - uSunUv;
  vec3 acc = vec3(0.0);
  // Ghosts along the flare axis.
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float pos = -0.4 + fi * 0.38;
    vec2 gp = uSunUv + dir * (1.0 + pos);
    vec2 d = (uv - gp) * vec2(uAspect, 1.0);
    float size = 0.02 + fract(fi * 0.618) * 0.06;
    float g = smoothstep(size, size * 0.6, length(d)) * 0.35 + exp(-dot(d, d) / (size * size) * 3.0) * 0.25;
    vec3 tint = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + fi * 1.3);
    acc += g * tint * 0.05;
  }
  // Halo ring.
  vec2 hd = (uv - uSunUv) * vec2(uAspect, 1.0);
  float hr = length(hd);
  acc += exp(-pow((hr - 0.28) / 0.012, 2.0)) * vec3(0.4, 0.5, 0.7) * 0.03;
  // Starburst streak.
  float ang = atan(hd.y, hd.x);
  float burst = pow(abs(cos(ang * 3.0)), 30.0) * exp(-hr * 9.0) + exp(-hr * 30.0) * 0.4;
  acc += burst * vec3(1.0, 0.9, 0.75) * 0.25;
  return acc * uSunVisible * uFlare;
}

vec3 applyFilter(vec3 c) {
  if (uFilter == 1) { // noir
    float l = luma(c);
    c = vec3(smoothstep(0.02, 0.98, l));
  } else if (uFilter == 2) { // sepia
    float l = luma(c);
    c = vec3(l * 1.07, l * 0.9, l * 0.68);
  } else if (uFilter == 3) { // dream
    c = mix(c, vec3(luma(c)), -0.25) * vec3(1.03, 0.98, 1.06) + 0.03;
  } else if (uFilter == 4) { // golden hour
    c *= vec3(1.1, 0.98, 0.82);
  } else if (uFilter == 5) { // arctic
    c *= vec3(0.88, 0.98, 1.12);
  }
  return c;
}

vec3 daltonize(vec3 c) {
  // Colour-vision-deficiency assistance: shift lost contrast into visible channels.
  if (uColorblind == 0) return c;
  mat3 sim;
  if (uColorblind == 1) sim = mat3(0.567, 0.558, 0.0, 0.433, 0.442, 0.242, 0.0, 0.0, 0.758); // protan
  else if (uColorblind == 2) sim = mat3(0.625, 0.7, 0.0, 0.375, 0.3, 0.3, 0.0, 0.0, 0.7); // deutan
  else sim = mat3(0.95, 0.0, 0.0, 0.05, 0.433, 0.475, 0.0, 0.567, 0.525); // tritan
  vec3 s = sim * c;
  vec3 err = c - s;
  vec3 shift = vec3(0.0, err.r * 0.7 + err.g, err.r * 0.7 + err.b);
  return clamp(c + shift, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec3 col;
  if (uCA > 0.0) {
    vec2 off = (uv - 0.5) * uCA * 0.012;
    col = vec3(texture(tColor, uv + off).r, texture(tColor, uv).g, texture(tColor, uv - off).b);
  } else {
    col = texture(tColor, uv).rgb;
  }
  col += texture(tBloom, uv).rgb * uBloomStrength;
  col += texture(tRays, uv).rgb;
  col += flare(uv);
  col *= uExposure;
  col = acesFitted(col);
  // Grading in display space.
  col = linearToSRGB(col);
  col = (col - 0.5) * uContrast + 0.5;
  float l = luma(col);
  col = mix(vec3(l), col, uSaturation) * uTint;
  col = applyFilter(col);
  col = daltonize(col);
  float v = length((uv - 0.5) * vec2(uAspect, 1.0) * 0.9);
  col *= 1.0 - smoothstep(0.35, 1.25, v) * uVignette;
  float n = fract(sin(dot(uv * vec2(1213.3, 811.7) + uTime * 17.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * uGrain;
  col = mix(col, uFadeColor, uFade);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const FXAA_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
uniform sampler2D tInput;
uniform vec2 uTexel;
in vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 rgbNW = texture(tInput, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture(tInput, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture(tInput, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
  vec3 rgbSE = texture(tInput, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  vec3 rgbM = texture(tInput, vUv).rgb;
  float lNW = lum(rgbNW), lNE = lum(rgbNE), lSW = lum(rgbSW), lSE = lum(rgbSE), lM = lum(rgbM);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 a = 0.5 * (texture(tInput, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(tInput, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(tInput, vUv + dir * -0.5).rgb + texture(tInput, vUv + dir * 0.5).rgb);
  float lB = lum(b);
  outColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
}
`;

export interface PostSettings {
  bloom: boolean;
  godRays: boolean;
  fxaa: boolean;
  dof: boolean;
}

function rt(w: number, h: number, hdr: boolean): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
}

export class PostChain {
  settings: PostSettings = { bloom: true, godRays: true, fxaa: true, dof: false };
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private bright: THREE.ShaderMaterial;
  private down: THREE.ShaderMaterial;
  private up: THREE.ShaderMaterial;
  private godray: THREE.ShaderMaterial;
  private dofMat: THREE.ShaderMaterial;
  readonly final: THREE.ShaderMaterial;
  private fxaa: THREE.ShaderMaterial;
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];
  private raysRT: THREE.WebGLRenderTarget;
  private dofRT: THREE.WebGLRenderTarget;
  private ldrRT: THREE.WebGLRenderTarget;
  private black: THREE.DataTexture;
  private w = 1;
  private h = 1;

  constructor() {
    const mk = (fs: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    this.bright = mk(BRIGHT_FS, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.6 } });
    this.down = mk(DOWN_FS, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = mk(UP_FS, { tInput: { value: null }, tPrev: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
    this.godray = mk(GODRAY_FS, { tColor: { value: null }, tDepth: { value: null }, uSunUv: { value: new THREE.Vector2() }, uIntensity: { value: 0.4 } });
    this.dofMat = mk(DOF_FS, { tColor: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uFocus: { value: 50 }, uAperture: { value: 1 }, uTexel: { value: new THREE.Vector2() } });
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    this.final = mk(FINAL_FS, {
      tColor: { value: null }, tBloom: { value: this.black }, tRays: { value: this.black }, tDepth: { value: null },
      uExposure: { value: 0.55 }, uBloomStrength: { value: 0.09 }, uVignette: { value: 0.45 }, uGrain: { value: 0.022 },
      uCA: { value: 0 }, uTime: { value: 0 }, uSunUv: { value: new THREE.Vector2() }, uSunVisible: { value: 0 }, uFlare: { value: 1 },
      uAspect: { value: 1 }, uSaturation: { value: 1.06 }, uContrast: { value: 1.04 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
      uFilter: { value: 0 }, uFade: { value: 0 }, uFadeColor: { value: new THREE.Vector3(0, 0, 0) }, uColorblind: { value: 0 },
    });
    this.fxaa = mk(FXAA_FS, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bright);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.raysRT = rt(1, 1, true);
    this.dofRT = rt(1, 1, true);
    this.ldrRT = rt(1, 1, false);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    for (const m of this.mips) m.dispose();
    for (const m of this.ups) m.dispose();
    this.mips = [];
    this.ups = [];
    let mw = Math.floor(w / 2), mh = Math.floor(h / 2);
    for (let i = 0; i < 6 && mw >= 4 && mh >= 4; i++) {
      this.mips.push(rt(mw, mh, true));
      this.ups.push(rt(mw, mh, true));
      mw = Math.floor(mw / 2);
      mh = Math.floor(mh / 2);
    }
    this.raysRT.setSize(Math.max(1, Math.floor(w / 3)), Math.max(1, Math.floor(h / 3)));
    this.dofRT.setSize(w, h);
    this.ldrRT.setSize(w, h);
    this.final.uniforms.uAspect.value = w / h;
  }

  private pass(renderer: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }

  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, depth: THREE.Texture, sun: { uv: THREE.Vector2; visible: number }, invProj: THREE.Matrix4, time: number): void {
    let color: THREE.Texture = input;
    if (this.settings.dof) {
      const u = this.dofMat.uniforms;
      u.tColor.value = input;
      u.tDepth.value = depth;
      u.uInvProj.value.copy(invProj);
      u.uTexel.value.set(1 / this.w, 1 / this.h);
      this.pass(renderer, this.dofMat, this.dofRT);
      color = this.dofRT.texture;
    }
    // Bloom.
    if (this.settings.bloom && this.mips.length > 1) {
      this.bright.uniforms.tInput.value = color;
      this.bright.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this.pass(renderer, this.bright, this.mips[0]);
      for (let i = 1; i < this.mips.length; i++) {
        this.down.uniforms.tInput.value = this.mips[i - 1].texture;
        this.down.uniforms.uTexel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
        this.pass(renderer, this.down, this.mips[i]);
      }
      // Upsample: tent-filter the coarser accumulation and add this level.
      for (let i = this.mips.length - 1; i >= 0; i--) {
        const coarser = i === this.mips.length - 1 ? null : this.ups[i + 1];
        this.up.uniforms.tInput.value = coarser ? coarser.texture : this.black;
        this.up.uniforms.tPrev.value = this.mips[i].texture;
        this.up.uniforms.uTexel.value.set(1 / (coarser ? coarser.width : 1), 1 / (coarser ? coarser.height : 1));
        this.pass(renderer, this.up, this.ups[i]);
      }
      this.final.uniforms.tBloom.value = this.ups[0].texture;
    } else {
      this.final.uniforms.tBloom.value = this.black;
    }
    // God rays.
    if (this.settings.godRays && sun.visible > 0.01) {
      const g = this.godray.uniforms;
      g.tColor.value = input;
      g.tDepth.value = depth;
      g.uSunUv.value.copy(sun.uv);
      g.uIntensity.value = 0.55 * sun.visible;
      this.pass(renderer, this.godray, this.raysRT);
      this.final.uniforms.tRays.value = this.raysRT.texture;
    } else {
      this.final.uniforms.tRays.value = this.black;
    }
    const f = this.final.uniforms;
    f.tColor.value = color;
    f.tDepth.value = depth;
    f.uTime.value = time;
    f.uSunUv.value.copy(sun.uv);
    f.uSunVisible.value = sun.visible;
    if (this.settings.fxaa) {
      this.pass(renderer, this.final, this.ldrRT);
      this.fxaa.uniforms.tInput.value = this.ldrRT.texture;
      this.fxaa.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this.pass(renderer, this.fxaa, null);
    } else {
      this.pass(renderer, this.final, null);
    }
  }
}
