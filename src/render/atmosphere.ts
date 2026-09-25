/**
 * Atmosphere, clouds and aurora – a full-screen composite pass that reads the
 * HDR scene colour + depth and integrates single scattering along each view
 * ray (Rayleigh + Mie + ozone absorption) using a precomputed transmittance
 * LUT. Clouds are raymarched through a shell with density from the simulated
 * cloud cover and storm systems; aurora curtains glow over the night-side
 * poles.
 */
import * as THREE from 'three';
import { GLSL_ATMOSPHERE, GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_NOISE, GLSL_REGION } from './glsl/common';
import { GLSL_CLOUDS } from './glsl/surface';
import type { SharedUniforms } from './planet/terrain';

const FS_QUAD_VS = /* glsl */ `
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const LUT_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
${GLSL_CONSTANTS}
const vec3 BETA_R = vec3(0.0058, 0.0135, 0.0331) * 0.62;
const float BETA_M = 0.011;
const vec3 BETA_O = vec3(0.00065, 0.00188, 0.000085) * 0.9;
const float H_R = 12.0;
const float H_M = 2.6;
in vec2 vUv;
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9); d = sqrt(d); return vec2(-b - d, -b + d);
}
float ozoneDensity(float h) { return max(0.0, 1.0 - abs(h - ATMO_H * 0.3) / (ATMO_H * 0.18)); }
void main() {
  float mu = vUv.x * 2.0 - 1.0;
  float hN = vUv.y * vUv.y;
  float r = PLANET_R + hN * ATMO_H + 0.01;
  vec3 ro = vec3(0.0, r, 0.0);
  vec3 rd = vec3(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  vec2 tp = raySphere(ro, rd, PLANET_R - 0.5);
  // Soft planet shadow: fade over a small band so the terminator isn't a hard line.
  float shadowFade = 1.0;
  if (tp.x > 0.0) {
    vec3 closest = ro + rd * max(0.0, -dot(ro, rd));
    float miss = length(closest) - (PLANET_R - 0.5);
    shadowFade = smoothstep(-6.0, 0.0, miss);
  }
  vec2 ta = raySphere(ro, rd, ATMO_R);
  float tEnd = ta.y;
  const int N = 48;
  float dt = tEnd / float(N);
  vec3 tau = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (float(i) + 0.5) * dt;
    float h = length(p) - PLANET_R;
    if (h < 0.0) h = 0.0;
    tau += (BETA_R * exp(-h / H_R) + BETA_M * 1.1 * exp(-h / H_M) + BETA_O * ozoneDensity(h)) * dt;
  }
  outColor = vec4(exp(-tau) * shadowFade, 1.0);
}
`;

const COMPOSITE_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
precision highp sampler2DArray;
precision highp sampler3D;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_REGION}
${GLSL_NOISE}
${GLSL_ATMOSPHERE}
${GLSL_CLOUDS}
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform int uAtmoSteps;
uniform int uCloudSteps;
uniform float uAurora;
uniform float uCloudsOn;
uniform float uSunDiscScale;
uniform float uExposureHint;
in vec2 vUv;

uniform float uEclipse;
uniform float uRainbow;
// Primary (42°) and faint secondary (51°) bows around the antisolar point.
vec3 rainbow(vec3 rd) {
  float a = acos(clamp(dot(rd, -uSunDir), -1.0, 1.0));
  vec3 col = vec3(0.0);
  float t1 = (a - 0.712) / (0.742 - 0.712);
  if (t1 > -0.3 && t1 < 1.3) {
    float h = clamp(t1, 0.0, 1.0);
    vec3 spec = clamp(abs(fract(vec3(0.8 - h * 0.8) + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    col += spec * smoothstep(-0.3, 0.2, t1) * (1.0 - smoothstep(0.8, 1.3, t1));
  }
  float t2 = (a - 0.875) / (0.915 - 0.875);
  if (t2 > -0.3 && t2 < 1.3) {
    float h = clamp(t2, 0.0, 1.0);
    vec3 spec = clamp(abs(fract(vec3(h * 0.8) + vec3(0.0, 0.667, 0.333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    col += spec * 0.35 * smoothstep(-0.3, 0.2, t2) * (1.0 - smoothstep(0.8, 1.3, t2));
  }
  // Brighter sky inside the primary bow.
  col += vec3(0.08) * (1.0 - smoothstep(0.62, 0.72, a));
  return col;
}
vec3 sunDiscRadiance(vec3 rd) {
  float c = dot(rd, uSunDir);
  float ang = acos(clamp(c, -1.0, 1.0));
  float rad = 0.0095 * uSunDiscScale;
  float disc = 1.0 - smoothstep(rad * 0.9, rad, ang);
  float limb = sqrt(max(0.0, 1.0 - pow(ang / rad, 2.0)));
  vec3 sun = vec3(1.0, 0.96, 0.9) * disc * (0.4 + 0.6 * limb) * 260.0 * (1.0 - 0.995 * uEclipse);
  // During an eclipse the corona and a diamond ring appear around the moon.
  if (uEclipse > 0.0) {
    float x = max(0.0, ang - rad * 0.98) / rad;
    float streak = 0.75 + 0.25 * sin(atan(dot(rd, cross(uSunDir, vec3(0.0, 1.0, 0.0))), dot(rd, vec3(0.0, 1.0, 0.0))) * 14.0);
    sun += vec3(0.9, 0.95, 1.0) * exp(-x * 3.0) * streak * 6.0 * uEclipse * step(rad * 0.98, ang);
  }
  return sun;
}

// Aurora emission density at p (night-side high latitudes only).
vec3 auroraEmission(vec3 p) {
  float r = length(p);
  vec3 d = p / r;
  float lat = asin(clamp(abs(d.y), 0.0, 1.0));
  // Auroral oval: a wobbling ring around each magnetic pole.
  float lon = atan(d.z, d.x);
  float ovalLat = 1.16 + 0.05 * sin(lon * 3.0 + uTime * 0.05) + 0.03 * snoise(vec3(lon * 2.0, uTime * 0.03, 0.0));
  float band = exp(-pow((lat - ovalLat) / 0.05, 2.0));
  if (band < 0.01) return vec3(0.0);
  float hf = (r - (PLANET_R + 26.0)) / 44.0;
  if (hf < 0.0 || hf > 1.0) return vec3(0.0);
  float night = 1.0 - smoothstep(-0.3, 0.02, dot(d, uSunDir));
  if (night <= 0.0) return vec3(0.0);
  // Folded curtains with fine vertical rays.
  float fold = snoise(vec3(lon * 9.0 + uTime * 0.04, d.y > 0.0 ? 1.0 : 5.0, uTime * 0.05));
  float curtain = pow(max(0.0, 1.0 - abs(fold) * 1.6), 2.0);
  float rays = 0.55 + 0.45 * snoise(vec3(lon * 90.0, uTime * 0.2, 3.0));
  float vert = smoothstep(0.0, 0.08, hf) * exp(-hf * 3.0);
  vec3 green = vec3(0.15, 1.0, 0.45);
  vec3 violet = vec3(0.6, 0.2, 0.95);
  vec3 col = mix(green, violet, smoothstep(0.3, 0.85, hf));
  return col * band * curtain * rays * vert * night * uAurora * 0.12;
}

void main() {
  vec3 sceneCol = texture(tColor, vUv).rgb;
  float depth = texture(tDepth, vUv).r;
  vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = uInvProj * ndc;
  vp /= vp.w;
  vec3 wpos = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec4 farV = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  farV /= farV.w;
  vec3 rd = normalize((uCamWorld * vec4(farV.xyz, 1.0)).xyz - uCamPos);
  bool sky = depth >= 0.99999;
  float sceneDist = sky ? 1e9 : length(wpos - uCamPos);
  vec3 ro = uCamPos;

  vec2 ta = raySphere(ro, rd, ATMO_R);
  vec3 result = sceneCol;
  if (ta.y > 0.0) {
    float t0 = max(ta.x, 0.0);
    // Ground intersection bounds the sky ray even if the depth buffer is empty.
    vec2 tg = raySphere(ro, rd, PLANET_R - 30.0);
    float t1 = min(ta.y, sceneDist);
    if (sky && tg.x > 0.0) t1 = min(t1, tg.x);

    // ---------------- clouds
    vec3 cloudCol = vec3(0.0);
    float cloudT = 1.0;
    float cloudDepth = -1.0;
    if (uCloudsOn > 0.5) {
      vec2 tc1 = raySphere(ro, rd, CLOUD_R1);
      vec2 tc0 = raySphere(ro, rd, CLOUD_R0);
      float cs = max(tc1.x, 0.0);
      float ce = tc1.y;
      float camR = length(ro);
      if (camR > CLOUD_R0 && tc0.x > 0.0) ce = tc0.x; // from above: stop at the inner shell
      else if (camR < CLOUD_R0) { cs = max(tc0.y, 0.0); }
      ce = min(ce, sceneDist);
      if (ce > cs && tc1.y > 0.0) {
        int steps = uCloudSteps;
        float seg = ce - cs;
        float dt = seg / float(steps);
        float jitter = hash13(vec3(gl_FragCoord.xy, uTime * 60.0));
        float mu = dot(rd, uSunDir);
        float phase = mix(phaseM(mu, 0.55), phaseM(mu, -0.2), 0.3) * 4.0 * PI;
        float lod = seg > 60.0 ? 1.0 : 0.0;
        float wsum = 0.0;
        // Clouds part around a low camera so the god can see the land.
        float camAlt = length(ro) - PLANET_R;
        float nearFade = clamp(camAlt * 1.8, 25.0, 700.0);
        for (int i = 0; i < 48; i++) {
          if (i >= steps || cloudT < 0.03) break;
          float t = cs + (float(i) + jitter) * dt;
          vec3 p = ro + rd * t;
          float dens = cloudDensity(p, lod);
          if (camAlt < 700.0) dens *= smoothstep(nearFade * 0.35, nearFade, t);
          // From low altitude the far cloud deck is seen edge-on and would be
          // badly undersampled: let it dissolve into the haze instead.
          if (camAlt < 260.0) dens *= 1.0 - smoothstep(camAlt * 2.5 + 120.0, camAlt * 5.0 + 260.0, t);
          if (dens > 0.001) {
            float r = length(p);
            vec3 up = p / r;
            float muS = dot(up, uSunDir);
            // Light march toward the sun (2 taps).
            float ld = cloudDensity(p + uSunDir * 2.5, 1.0) + cloudDensity(p + uSunDir * 6.0, 1.0);
            float beer = exp(-ld * 1.6);
            float powder = 1.0 - exp(-dens * 4.0);
            vec3 sunL = transmittanceToSun(r, muS) * uSunIntensity;
            float hf = clamp((r - CLOUD_R0) / (CLOUD_R1 - CLOUD_R0), 0.0, 1.0);
            vec3 ambTop = mix(vec3(0.02, 0.025, 0.04), vec3(0.35, 0.45, 0.62), smoothstep(-0.15, 0.3, muS));
            vec3 amb = ambTop * mix(0.45, 1.0, hf) * uSunIntensity * 0.06;
            vec3 lit = sunL * beer * mix(1.0, powder, 0.5) * phase * 0.09 + amb;
            float ext = dens * 0.55 * dt;
            float a = 1.0 - exp(-ext);
            cloudCol += cloudT * a * lit;
            wsum += cloudT * a * t;
            cloudT *= 1.0 - a;
          }
        }
        if (cloudT < 0.999) cloudDepth = wsum / max(1e-4, 1.0 - cloudT);
      }
    }

    // ---------------- atmosphere single scattering
    int N = uAtmoSteps;
    float seg = max(t1 - t0, 0.0);
    float dt = seg / float(N);
    // Aerial perspective is compressed for nearby surfaces: the atmosphere is
    // scaled for the planet, so at village range it would read as fog. Haze
    // ramps up with distance and reaches full physical strength by ~1100 u.
    float hazeK = sky ? 1.0 : clamp(sceneDist / 1100.0, 0.07, 1.0);
    float dtE = dt * hazeK;
    float mu = dot(rd, uSunDir);
    float pR = phaseR(mu), pM = phaseM(mu, MIE_G);
    vec3 tau = vec3(0.0);
    vec3 inscatter = vec3(0.0);
    vec3 inscatterToCloud = vec3(0.0);
    vec3 tauToCloud = vec3(0.0);
    bool cloudPassed = cloudDepth < 0.0;
    vec3 aur = vec3(0.0);
    for (int i = 0; i < 64; i++) {
      if (i >= N) break;
      float t = t0 + (float(i) + 0.5) * dt;
      vec3 p = ro + rd * t;
      float r = length(p);
      float h = max(r - PLANET_R, 0.0);
      float dR = exp(-h / H_R), dM = exp(-h / H_M);
      vec3 ext = BETA_R * dR + BETA_M * 1.1 * dM + BETA_O * ozoneDensity(h) * dR;
      tau += ext * dtE * 0.5;
      float muS = dot(p / r, uSunDir);
      vec3 Ts = transmittanceToSun(r, muS);
      vec3 T = exp(-tau);
      vec3 s = T * Ts * (BETA_R * dR * pR + BETA_M * dM * pM) * dtE;
      // Faint airglow keeps the night side from being pure black.
      s += T * BETA_R * dR * dt * vec3(0.0006, 0.0009, 0.0016);
      inscatter += s;
      tau += ext * dtE * 0.5;
      if (!cloudPassed && t >= cloudDepth) {
        cloudPassed = true;
        inscatterToCloud = inscatter;
        tauToCloud = tau;
      }
    }
    if (!cloudPassed) { inscatterToCloud = inscatter; tauToCloud = tau; }
    // Aurora: its own jittered march through the thin emitting shell, so the
    // curtains read as soft folds rather than the steps of the air march.
    if (uAurora > 0.0) {
      vec2 sA = raySphere(ro, rd, PLANET_R + 70.0);
      vec2 sB = raySphere(ro, rd, PLANET_R + 26.0);
      float a0 = max(sA.x, 0.0), a1 = min(sA.y, t1);
      // Stop at the inner shell when looking down through it.
      if (sB.x > 0.0) a1 = min(a1, sB.x);
      if (a1 > a0) {
        int an = min(20, uAtmoSteps + 4);
        float ad = (a1 - a0) / float(an);
        float aj = hash13(vec3(gl_FragCoord.yx, uTime * 37.0));
        vec3 Tm = exp(-tau * 0.5);
        for (int i = 0; i < 20; i++) {
          if (i >= an) break;
          aur += Tm * auroraEmission(ro + rd * (a0 + (float(i) + aj) * ad)) * ad;
        }
      }
    }
    vec3 Tfull = exp(-tau);
    vec3 background = sceneCol;
    if (sky) {
      bool hitsPlanet = tg.x < 1e8 && tg.y > 0.0;
      if (hitsPlanet) background = vec3(0.0);
      else background += sunDiscRadiance(rd);
    }
    // The shell is only ~90 u thick, so seen from the ground the zenith sky
    // would read as dusk: deepen the scattering for upward rays near the surface.
    if (sky) {
      float camAltA = length(ro) - PLANET_R;
      float lowK = 1.0 - smoothstep(40.0, 320.0, camAltA);
      float elev = max(dot(rd, normalize(ro)), 0.0);
      float boost = 1.0 + lowK * 3.2 * sqrt(elev);
      inscatter *= boost;
      inscatterToCloud *= boost;
    }
    // Starlight is lost in a bright sky: attenuate by the in-scattered luminance.
    if (sky) {
      float skyLum = dot(inscatter * uSunIntensity, vec3(0.2126, 0.7152, 0.0722));
      vec3 sun = tg.x < 1e8 && tg.y > 0.0 ? vec3(0.0) : sunDiscRadiance(rd);
      background = (background - sun) / (1.0 + skyLum * 60.0) + sun;
    }
    vec3 behind = background * Tfull + aur;
    if (cloudDepth > 0.0) {
      // Front-to-back: air in front of the cloud, the cloud itself, then
      // everything behind it seen through the cloud.
      result = inscatterToCloud * uSunIntensity + exp(-tauToCloud) * cloudCol
        + cloudT * ((inscatter - inscatterToCloud) * uSunIntensity + behind);
    } else {
      result = inscatter * uSunIntensity + behind;
    }
  }
  // Rainbows belong to observers inside the rain, never to the view from orbit.
  float rbAlt = 1.0 - smoothstep(160.0, 320.0, length(uCamPos) - PLANET_R);
  if (uRainbow * rbAlt > 0.001 && dot(rd, uSunDir) < 0.0) {
    // Against the open sky only from near the ground (never against space).
    float camAltR = length(uCamPos) - PLANET_R;
    float reach = (sky ? 1.0 - smoothstep(40.0, 110.0, camAltR) : clamp(sceneDist / 180.0, 0.0, 1.0)) * rbAlt;
    result += rainbow(rd) * uRainbow * reach * uSunIntensity * 0.035;
  }
  outColor = vec4(result, 1.0);
}
`;

export class AtmospherePass {
  readonly lutRT: THREE.WebGLRenderTarget;
  readonly material: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: THREE.Mesh;

  constructor(shared: SharedUniforms) {
    this.lutRT = new THREE.WebGLRenderTarget(256, 64, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    shared.uTransmittanceLUT.value = this.lutRT.texture;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_QUAD_VS,
      fragmentShader: COMPOSITE_FS,
      uniforms: {
        ...shared,
        tColor: { value: null },
        tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uAtmoSteps: { value: 16 },
        uCloudSteps: { value: 24 },
        uAurora: { value: 1 },
        uCloudsOn: { value: 1 },
        uSunDiscScale: { value: 1 },
        uRainbow: { value: 0 },
        uExposureHint: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  buildLUT(renderer: THREE.WebGLRenderer): void {
    const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_QUAD_VS, fragmentShader: LUT_FS, depthTest: false, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const s = new THREE.Scene();
    s.add(m);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.lutRT);
    renderer.render(s, this.cam);
    renderer.setRenderTarget(prev);
    mat.dispose();
    m.geometry.dispose();
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, color: THREE.Texture, depth: THREE.Texture, target: THREE.WebGLRenderTarget | null): void {
    const u = this.material.uniforms;
    u.tColor.value = color;
    u.tDepth.value = depth;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
  }
}

