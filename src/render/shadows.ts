/**
 * Sun shadow map around the camera focus. An orthographic light camera looks
 * down the sun direction over a region that scales with zoom (sharp shadows up
 * close, broad mountain shadows further out). Terrain, vegetation, creatures
 * and buildings render into it with depth-only variants of their own vertex
 * shaders (so wind sway and animation cast matching shadows). Receivers use a
 * hardware-compared 5-tap PCF lookup (GLSL_SHADOW_SAMPLE).
 */
import * as THREE from 'three';
import { PLANET_RADIUS } from '../sim/constants';

export const GLSL_SHADOW_SAMPLE = /* glsl */ `
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform float uShadowTexel;
float sunShadow(vec3 wp, vec3 N) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp + N * 0.12, 1.0);
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float edge = smoothstep(0.0, 0.08, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));
  float bias = 0.0006;
  float s = 0.0;
  float t = uShadowTexel * 1.25;
  s += texture(uShadowMap, vec3(p.xy, p.z - bias));
  s += texture(uShadowMap, vec3(p.xy + vec2(t, t * 0.4), p.z - bias));
  s += texture(uShadowMap, vec3(p.xy + vec2(-t * 0.4, t), p.z - bias));
  s += texture(uShadowMap, vec3(p.xy + vec2(-t, -t * 0.4), p.z - bias));
  s += texture(uShadowMap, vec3(p.xy + vec2(t * 0.4, -t), p.z - bias));
  s /= 5.0;
  return mix(1.0, s, edge);
}
`;

export class ShadowSystem {
  readonly rt: THREE.WebGLRenderTarget;
  readonly camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 2000);
  readonly matrix = new THREE.Matrix4();
  size: number;
  enabled = true;
  /** Mesh → depth-only material. */
  private casters = new Map<THREE.Mesh, THREE.Material>();
  private swap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  constructor(size: number) {
    this.size = size;
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, type: THREE.UnsignedByteType });
    const dt = new THREE.DepthTexture(size, size);
    dt.type = THREE.UnsignedIntType;
    dt.compareFunction = THREE.LessEqualCompare;
    dt.minFilter = THREE.LinearFilter;
    dt.magFilter = THREE.LinearFilter;
    this.rt.depthTexture = dt;
  }

  setSize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    this.rt.setSize(size, size);
  }

  register(mesh: THREE.Mesh, depthMat: THREE.Material): void {
    this.casters.set(mesh, depthMat);
  }

  unregister(mesh: THREE.Mesh): void {
    this.casters.delete(mesh);
  }

  /** Position the light camera over `focus` (unit dir) covering `halfSize` units. */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, focus: THREE.Vector3, focusHeight: number, halfSize: number, sunDir: THREE.Vector3, uniforms: Record<string, THREE.IUniform>): void {
    const up = focus;
    const sunUp = sunDir.dot(up);
    const on = this.enabled && sunUp > -0.05;
    uniforms.uShadowOn.value = on ? 1 : 0;
    if (!on) return;
    const cam = this.camera;
    const center = up.clone().multiplyScalar(PLANET_RADIUS + focusHeight);
    const dist = 700;
    cam.left = -halfSize; cam.right = halfSize; cam.top = halfSize; cam.bottom = -halfSize;
    cam.near = dist - halfSize * 1.2 - 80;
    cam.far = dist + halfSize * 1.2 + 80;
    // Stable orientation: light "up" is the planet normal projected onto the light plane.
    const lightUp = up.clone().sub(sunDir.clone().multiplyScalar(up.dot(sunDir)));
    if (lightUp.lengthSq() < 1e-6) lightUp.set(0, 1, 0);
    cam.up.copy(lightUp.normalize());
    cam.position.copy(center).addScaledVector(sunDir, dist);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    // Snap to texels to stop shimmering as the camera moves.
    const texel = (halfSize * 2) / this.size;
    const inv = cam.matrixWorldInverse;
    const lc = center.clone().applyMatrix4(inv);
    const sx = Math.round(lc.x / texel) * texel - lc.x;
    const sy = Math.round(lc.y / texel) * texel - lc.y;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, -sx).addScaledVector(upv, -sy);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    this.matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    (uniforms.uShadowMatrix.value as THREE.Matrix4).copy(this.matrix);
    uniforms.uShadowTexel.value = 1 / this.size;

    // Render casters with their depth materials; hide everything else.
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.visible) {
        const dm = this.casters.get(o);
        if (dm) { this.swap.set(o, o.material); o.material = dm; }
        else { hidden.push(o); o.visible = false; }
      }
    });
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    for (const [m, mat] of this.swap) m.material = mat;
    this.swap.clear();
    for (const o of hidden) o.visible = true;
  }
}
