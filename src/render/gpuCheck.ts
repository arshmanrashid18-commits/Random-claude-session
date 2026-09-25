/**
 * Verification utility: evaluates the GLSL ground-height function on the GPU
 * at a set of directions and returns the values, so the harness can compare
 * them with the CPU port used for object placement.
 */
import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_CUBESPHERE, GLSL_DETAIL, GLSL_HEIGHT, GLSL_NOISE } from './glsl/common';
import type { SharedUniforms } from './planet/terrain';

const VS = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FS = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
layout(location = 0) out highp vec4 outColor;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
${GLSL_HEIGHT}
${GLSL_NOISE}
${GLSL_DETAIL}
uniform sampler2D uDirs;
void main() {
  vec3 d = normalize(texelFetch(uDirs, ivec2(gl_FragCoord.xy), 0).xyz);
  outColor = vec4(groundHeight(d), heightAtDir(d), snoise(d * 37.0), 1.0);
}
`;

export function gpuGroundHeights(renderer: THREE.WebGLRenderer, shared: SharedUniforms, dirs: Float32Array): Float32Array {
  const count = dirs.length / 3;
  const w = Math.min(64, count), h = Math.ceil(count / w);
  const dirData = new Float32Array(w * h * 4);
  for (let i = 0; i < count; i++) {
    dirData[i * 4] = dirs[i * 3];
    dirData[i * 4 + 1] = dirs[i * 3 + 1];
    dirData[i * 4 + 2] = dirs[i * 3 + 2];
    dirData[i * 4 + 3] = 1;
  }
  const dirTex = new THREE.DataTexture(dirData, w, h, THREE.RGBAFormat, THREE.FloatType);
  dirTex.needsUpdate = true;
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: false });
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VS,
    fragmentShader: FS,
    uniforms: { ...shared, uDirs: { value: dirTex } },
  });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  const out = new Float32Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, out);
  renderer.setRenderTarget(prev);
  rt.dispose();
  mat.dispose();
  dirTex.dispose();
  mesh.geometry.dispose();
  return out;
}
