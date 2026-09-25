/**
 * GPU-side planet data: heightmap texture array, derived normal/cavity texture
 * array (computed on the GPU), and the region (climate/vegetation/surface)
 * texture arrays streamed from the simulation. Also keeps a CPU copy of the
 * heights for picking and camera collision.
 */
import * as THREE from 'three';
import { GLSL_CONSTANTS, GLSL_CUBESPHERE } from '../glsl/common';
import { VertexGrid } from '../../sim/planet/cubesphere';
import { HeightPyramid } from './quadtree';
import type { RegionTextures } from '../../worker/protocol';

const NORMAL_VS = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const NORMAL_FS = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 outColor;
precision highp sampler2DArray;
${GLSL_CONSTANTS}
${GLSL_CUBESPHERE}
uniform highp sampler2DArray uHeightTex;
uniform float uHeightN;
uniform int uFace;
float hAt(int i, int j) {
  int n = int(uHeightN);
  return texelFetch(uHeightTex, ivec3(clamp(i, 0, n), clamp(j, 0, n), uFace), 0).r;
}
vec3 posAt(int i, int j) {
  int n = int(uHeightN);
  i = clamp(i, 0, n); j = clamp(j, 0, n);
  vec2 ab = vec2(float(i), float(j)) / uHeightN * 2.0 - 1.0;
  float h = texelFetch(uHeightTex, ivec3(i, j, uFace), 0).r;
  return faceABToDir(uFace, ab) * (PLANET_R + h);
}
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int i = ij.x, j = ij.y;
  vec3 pl = posAt(i - 1, j), pr = posAt(i + 1, j);
  vec3 pd = posAt(i, j - 1), pu = posAt(i, j + 1);
  vec3 N = normalize(cross(pr - pl, pu - pd));
  float h = hAt(i, j);
  float avg = 0.0;
  for (int dj = -3; dj <= 3; dj += 3) for (int di = -3; di <= 3; di += 3) avg += hAt(i + di, j + dj);
  avg = (avg - h) / 8.0;
  outColor = vec4(N, avg - h);
}
`;

export class PlanetData {
  readonly n: number;
  readonly grid: VertexGrid;
  heights: Float32Array;
  heightTex: THREE.DataArrayTexture;
  normalRT: THREE.WebGLArrayRenderTarget;
  pyramid: HeightPyramid;
  climateTex: THREE.DataArrayTexture;
  vegATex: THREE.DataArrayTexture;
  vegBTex: THREE.DataArrayTexture;
  surfaceTex: THREE.DataArrayTexture;
  fxTex: THREE.DataArrayTexture;
  ownerTex: THREE.DataArrayTexture;
  regionN: number;
  private normalMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** CPU copies of region textures (vegetation placement, audio, UI). */
  climateCPU: Uint8Array;
  vegACPU: Uint8Array;
  vegBCPU: Uint8Array;
  surfaceCPU: Uint8Array;
  fxCPU: Uint8Array;
  ownerCPU: Uint8Array;
  /** Incremented whenever region textures change. */
  regionVersion = 0;

  constructor(heights: Float32Array, n: number, regionN: number, maxLodLevel: number) {
    this.n = n;
    this.grid = new VertexGrid(n);
    this.heights = heights;
    this.regionN = regionN;
    const side = n + 1;
    this.heightTex = new THREE.DataArrayTexture(heights, side, side, 6);
    this.heightTex.format = THREE.RedFormat;
    this.heightTex.type = THREE.FloatType;
    this.heightTex.internalFormat = 'R32F';
    this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.generateMipmaps = false;
    this.heightTex.needsUpdate = true;

    this.normalRT = new THREE.WebGLArrayRenderTarget(side, side, 6, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });
    this.normalRT.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.normalRT.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.normalMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: NORMAL_VS,
      fragmentShader: NORMAL_FS,
      uniforms: { uHeightTex: { value: this.heightTex }, uHeightN: { value: n }, uFace: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.normalMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.pyramid = new HeightPyramid(n, Math.min(maxLodLevel, Math.round(Math.log2(n)) - 1));
    this.pyramid.build(heights);

    const P = regionN + 2;
    const mk = () => {
      const t = new THREE.DataArrayTexture(new Uint8Array(P * P * 6 * 4), P, P, 6);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    this.climateTex = mk();
    this.vegATex = mk();
    this.vegBTex = mk();
    this.surfaceTex = mk();
    this.fxTex = mk();
    this.ownerTex = mk();
    this.ownerTex.minFilter = THREE.NearestFilter;
    this.ownerTex.magFilter = THREE.NearestFilter;
    this.climateCPU = new Uint8Array(P * P * 6 * 4);
    this.vegACPU = new Uint8Array(P * P * 6 * 4);
    this.vegBCPU = new Uint8Array(P * P * 6 * 4);
    this.surfaceCPU = new Uint8Array(P * P * 6 * 4);
    this.fxCPU = new Uint8Array(P * P * 6 * 4);
    this.ownerCPU = new Uint8Array(P * P * 6 * 4);
  }

  /** Bilinear sample of one channel of a padded region texture (0..1). */
  sampleRegion(buf: Uint8Array, face: number, a: number, b: number, ch: number): number {
    const n = this.regionN;
    const P = n + 2;
    const x = (a + 1) * 0.5 * n + 0.5, y = (b + 1) * 0.5 * n + 0.5;
    let x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0) x0 = 0; else if (x0 > P - 2) x0 = P - 2;
    if (y0 < 0) y0 = 0; else if (y0 > P - 2) y0 = P - 2;
    const tx = Math.min(1, Math.max(0, x - x0)), ty = Math.min(1, Math.max(0, y - y0));
    const o = (face * P * P + y0 * P + x0) * 4 + ch;
    const v00 = buf[o], v10 = buf[o + 4], v01 = buf[o + P * 4], v11 = buf[o + P * 4 + 4];
    return ((v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty) / 255;
  }

  /** Recompute normals for the given faces (all by default). */
  computeNormals(renderer: THREE.WebGLRenderer, faces: number[] = [0, 1, 2, 3, 4, 5]): void {
    const prev = renderer.getRenderTarget();
    for (const f of faces) {
      this.normalMat.uniforms.uFace.value = f;
      renderer.setRenderTarget(this.normalRT, f);
      renderer.render(this.quadScene, this.quadCam);
    }
    renderer.setRenderTarget(prev);
  }

  /** Copy region textures from the simulation; returns the buffers for reuse. */
  updateRegion(tex: RegionTextures): void {
    (this.climateTex.image.data as Uint8Array).set(tex.climate);
    (this.vegATex.image.data as Uint8Array).set(tex.vegA);
    (this.vegBTex.image.data as Uint8Array).set(tex.vegB);
    (this.surfaceTex.image.data as Uint8Array).set(tex.surface);
    (this.fxTex.image.data as Uint8Array).set(tex.fx);
    this.fxCPU.set(tex.fx);
    this.fxTex.needsUpdate = true;
    (this.ownerTex.image.data as Uint8Array).set(tex.owner);
    this.ownerCPU.set(tex.owner);
    this.ownerTex.needsUpdate = true;
    this.climateCPU.set(tex.climate);
    this.vegACPU.set(tex.vegA);
    this.vegBCPU.set(tex.vegB);
    this.surfaceCPU.set(tex.surface);
    this.regionVersion++;
    this.climateTex.needsUpdate = true;
    this.vegATex.needsUpdate = true;
    this.vegBTex.needsUpdate = true;
    this.surfaceTex.needsUpdate = true;
  }

  /** Apply a full-face height update from the simulation. */
  updateFaces(faces: number[], data: Float32Array[]): void {
    const side = this.n + 1;
    const fs = side * side;
    faces.forEach((f, k) => {
      this.heights.set(data[k], f * fs);
      this.heightTex.addLayerUpdate(f);
      this.pyramid.build(this.heights, f);
    });
    this.heightTex.needsUpdate = true;
  }

  heightAt(x: number, y: number, z: number): number {
    return this.grid.sample(this.heights, x, y, z);
  }

  dispose(): void {
    this.heightTex.dispose();
    this.normalRT.dispose();
    this.climateTex.dispose();
    this.vegATex.dispose();
    this.vegBTex.dispose();
    this.surfaceTex.dispose();
    this.fxTex.dispose();
    this.ownerTex.dispose();
    this.normalMat.dispose();
  }
}
