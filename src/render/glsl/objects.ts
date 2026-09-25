/**
 * Shared GLSL for instanced objects standing on the planet (vegetation,
 * creatures, people, buildings): local tangent frames and a lighting model
 * consistent with the terrain (atmospheric sun colour, sky ambient, cloud
 * shadows, foliage translucency, night emissives).
 */
import { GLSL_ATMOSPHERE, GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_NOISE, GLSL_REGION } from './common';
import { GLSL_CLOUDS, GLSL_SKYLIGHT } from './surface';
import { GLSL_SHADOW_SAMPLE } from '../shadows';

export const GLSL_FRAME = /* glsl */ `
// Local frame at unit direction 'up' rotated by 'rot' around it.
void tangentFrame(vec3 up, float rot, out vec3 ax, out vec3 az) {
  vec3 ref = abs(up.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 east = normalize(cross(ref, up));
  vec3 north = cross(up, east);
  float c = cos(rot), s = sin(rot);
  ax = east * c + north * s;
  az = cross(ax, up);
}
`;

export const OBJECT_FS_HEAD = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
precision highp sampler3D;
layout(location = 0) out highp vec4 outColor;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_REGION}
${GLSL_NOISE}
${GLSL_ATMOSPHERE}
${GLSL_CLOUDS}
${GLSL_SKYLIGHT}
${GLSL_SHADOW_SAMPLE}
uniform vec3 uCamPos;

vec3 shadeObject(vec3 wp, vec3 N, vec3 albedo, float foliage, float emissive, vec3 emissiveCol) {
  float r = length(wp);
  vec3 up = wp / r;
  vec3 L = uSunDir;
  float mu = dot(up, L);
  vec3 sunCol = transmittanceToSun(r, mu) * uSunIntensity;
  float ndl = dot(N, L);
  float diff = foliage > 0.0 ? mix(max(ndl, 0.0), ndl * 0.5 + 0.5, 0.22 * foliage) : max(ndl, 0.0);
  float shadow = cloudShadow(wp, L) * sunShadow(wp, N);
  float horizon = smoothstep(-0.03, 0.1, mu);
  vec3 V = normalize(uCamPos - wp);
  // Light through leaves when backlit.
  float trans = foliage * pow(max(dot(-V, L), 0.0), 6.0) * 0.45;
  vec3 direct = sunCol * albedo * (diff / PI + trans) * shadow * horizon;
  vec3 amb = skyAmbient(up, N, L) * albedo * uSunIntensity * 0.1;
  return direct + amb + emissiveCol * emissive;
}
`;
