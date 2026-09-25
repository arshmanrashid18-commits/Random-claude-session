/**
 * Render orchestrator: owns the WebGL renderer, render targets, shared
 * uniforms and all visual subsystems, and runs the frame:
 *   sky layer → planet scene (terrain, ocean, lakes, rivers, life, vfx)
 *   → atmosphere/cloud composite → post chain → screen.
 */
import * as THREE from 'three';
import { PlanetData } from './planet/planetData';
import { TerrainRenderer, type SharedUniforms } from './planet/terrain';
import { AtmospherePass } from './atmosphere';
import { SkyLayer } from './sky';
import { PostChain } from './post';
import { PlanetCamera } from './camera';
import { generateCloudNoise } from './cloudNoise';
import { QUALITY_PRESETS, type QualityId, type QualityPreset } from './quality';
import { moonDirection, MOON_DISTANCE, PLANET_RADIUS, sunDirection, TICKS_PER_DAY, TIDE_AMPLITUDE } from '../sim/constants';
import type { StaticWorldData } from '../worker/protocol';
import { WaterBodies } from './water';
import { Vegetation } from './vegetation';
import { ShadowSystem } from './shadows';
import { Grass } from './grass';
import { Creatures } from './creatures';
import { PeopleRenderer } from './people';
import { BuildingsRenderer } from './buildings';
import { Vfx } from './vfx';
import { Precipitation } from './precip';
import type { EffectData, RiverData, LakeData, TribeData } from '../worker/protocol';
import type { StormData } from '../worker/protocol';

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  patches: number;
  frameMs: number;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly shared: SharedUniforms;
  readonly scene = new THREE.Scene();
  camera!: PlanetCamera;
  data!: PlanetData;
  terrain!: TerrainRenderer;
  water!: WaterBodies;
  vegetation!: Vegetation;
  shadows: ShadowSystem;
  grass!: Grass;
  creatures!: Creatures;
  people!: PeopleRenderer;
  buildings!: BuildingsRenderer;
  vfx = new Vfx();
  precip = new Precipitation();
  /** Divine effects from the latest frame (for VFX). */
  effects: EffectData[] = [];
  private rainbow = 0;
  /** Current simulation speed multiplier (VFX timing). */
  simSpeed = 1;
  private world: StaticWorldData | null = null;
  private lastRenderTick = 0;
  atmosphere!: AtmospherePass;
  sky!: SkyLayer;
  post: PostChain;
  quality: QualityPreset = QUALITY_PRESETS.high;
  qualityId: QualityId = 'high';
  private hdrRT: THREE.WebGLRenderTarget;
  private compRT: THREE.WebGLRenderTarget;
  private width = 1;
  private height = 1;
  /** Fractional simulation tick used for lighting (smooth between ticks). */
  renderTick = 0;
  time = 0;
  stats: RenderStats = { drawCalls: 0, triangles: 0, patches: 0, frameMs: 0 };
  private sunUv = new THREE.Vector2();
  ready = false;
  /** Visual overrides (photo mode time-of-day). */
  timeOfDayOverride: number | null = null;
  contextLost = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.info.autoReset = false;
    this.shared = {
      uHeightTex: { value: null },
      uHeightN: { value: 512 },
      uClimateTex: { value: null },
      uVegATex: { value: null },
      uVegBTex: { value: null },
      uSurfaceTex: { value: null },
      uFxTex: { value: null },
      uOwnerTex: { value: null },
      uBorders: { value: 0.35 },
      uRegionN: { value: 64 },
      uNormalTex: { value: null },
      uTransmittanceLUT: { value: null },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uSunIntensity: { value: 20 },
      uMoonDir: { value: new THREE.Vector3(0, 0, 1) },
      uTideAmp: { value: TIDE_AMPLITUDE },
      uCamPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uCloudNoise: { value: null },
      uCloudWind: { value: new THREE.Vector3(0.0021, 0.0004, 0.0013) },
      uCloudCoverBias: { value: 0 },
      uStorms: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uStormParams: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uStormCount: { value: 0 },
      uNightLights: { value: 1 },
      uShadowMap: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowOn: { value: 0 },
      uShadowTexel: { value: 1 / 2048 },
      uEclipse: { value: 0 },
      uTsunami: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uTsunamiAmp: { value: [0, 0, 0, 0] },
      uTribeCol: { value: Array.from({ length: 32 }, () => new THREE.Color(0.8, 0.8, 0.8)) },
    };
    this.vfx.tsunamis = this.shared.uTsunami.value as THREE.Vector4[];
    this.shadows = new ShadowSystem(2048);
    this.shared.uShadowMap.value = this.shadows.rt.depthTexture;
    this.hdrRT = this.makeHdrTarget(1, 1, true);
    this.compRT = this.makeHdrTarget(1, 1, false);
    this.post = new PostChain();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.restore(); });
  }

  private makeHdrTarget(w: number, h: number, depth: boolean): THREE.WebGLRenderTarget {
    const t = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: depth,
      generateMipmaps: false,
    });
    if (depth) {
      t.depthTexture = new THREE.DepthTexture(w, h);
      t.depthTexture.type = THREE.FloatType;
      t.depthTexture.minFilter = THREE.NearestFilter;
      t.depthTexture.magFilter = THREE.NearestFilter;
    }
    return t;
  }

  /** Build all GPU resources for a freshly generated world. */
  init(world: StaticWorldData): void {
    this.world = world;
    this.data = new PlanetData(world.heights, world.heightN, world.regionN, 9);
    const s = this.shared;
    s.uHeightTex.value = this.data.heightTex;
    s.uHeightN.value = world.heightN;
    s.uClimateTex.value = this.data.climateTex;
    s.uVegATex.value = this.data.vegATex;
    s.uVegBTex.value = this.data.vegBTex;
    s.uSurfaceTex.value = this.data.surfaceTex;
    s.uFxTex.value = this.data.fxTex;
    s.uOwnerTex.value = this.data.ownerTex;
    s.uRegionN.value = world.regionN;
    s.uNormalTex.value = this.data.normalRT.texture;
    if (!s.uCloudNoise.value) s.uCloudNoise.value = generateCloudNoise(64);
    this.camera = new PlanetCamera(this.width / this.height, (x, y, z) => this.data.heightAt(x, y, z));
    this.atmosphere = new AtmospherePass(s);
    this.sky = new SkyLayer(s);
    const q = this.quality;
    this.terrain = new TerrainRenderer(this.data, s, { maxLevel: q.maxLevel, rangeK: q.rangeK }, q.grid);
    this.scene.add(this.terrain.terrainMesh);
    this.scene.add(this.terrain.oceanMesh);
    this.water = new WaterBodies(s, world, this.data);
    this.scene.add(this.water.group);
    this.vegetation = new Vegetation(s, world.seed);
    this.scene.add(this.vegetation.group);
    for (const m of this.vegetation.meshes) this.shadows.register(m, this.vegetation.depthMaterial);
    this.grass = new Grass(s, this.data.normalRT.texture);
    this.scene.add(this.grass.mesh);
    this.creatures = new Creatures(s);
    this.creatures.species = world.species;
    this.scene.add(this.creatures.group);
    this.creatures.meshes.forEach((m, i) => this.shadows.register(m, this.creatures.depthMaterials[i]));
    this.people = new PeopleRenderer(s);
    this.scene.add(this.people.mesh);
    this.shadows.register(this.people.mesh, this.people.depthMaterial);
    this.buildings = new BuildingsRenderer(s);
    this.scene.add(this.buildings.group);
    this.buildings.onNewMesh = (m) => this.shadows.register(m, this.buildings.depthMaterial);
    this.scene.add(this.vfx.group);
    this.scene.add(this.precip.mesh);
    this.shadows.register(this.terrain.terrainMesh, this.terrain.depthMat);
    this.renderer.setRenderTarget(null);
    this.data.computeNormals(this.renderer);
    this.atmosphere.buildLUT(this.renderer);
    this.applyQuality(this.quality);
    this.ready = true;
  }

  private restore(): void {
    if (!this.ready) return;
    this.data.heightTex.needsUpdate = true;
    this.data.computeNormals(this.renderer);
    this.atmosphere.buildLUT(this.renderer);
  }

  setQuality(id: QualityId): void {
    this.qualityId = id;
    this.quality = QUALITY_PRESETS[id];
    if (this.ready) this.applyQuality(this.quality);
  }

  private applyQuality(q: QualityPreset): void {
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr) * q.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.resize(this.width, this.height);
    if (this.terrain) {
      const old = this.terrain;
      if (old.lod.settings.maxLevel !== q.maxLevel || old.lod.settings.rangeK !== q.rangeK || (old as unknown as { grid: number }).grid !== q.grid) {
        this.scene.remove(old.terrainMesh);
        this.scene.remove(old.oceanMesh);
        old.dispose();
        this.shadows.unregister(old.terrainMesh);
        this.terrain = new TerrainRenderer(this.data, this.shared, { maxLevel: q.maxLevel, rangeK: q.rangeK }, q.grid);
        this.scene.add(this.terrain.terrainMesh);
        this.scene.add(this.terrain.oceanMesh);
        this.shadows.register(this.terrain.terrainMesh, this.terrain.depthMat);
      }
    }
    if (this.atmosphere) {
      this.atmosphere.material.uniforms.uAtmoSteps.value = q.atmoSteps;
      this.atmosphere.material.uniforms.uCloudSteps.value = q.cloudSteps;
    }
    if (this.vegetation) this.vegetation.budget = q.vegetation;
    if (this.grass) this.grass.budget = q.grass;
    this.shadows.enabled = q.shadowSize > 0;
    if (q.shadowSize > 0) this.shadows.setSize(q.shadowSize);
    this.post.settings.bloom = q.bloom;
    this.post.settings.godRays = q.godRays;
    this.post.settings.fxaa = q.fxaa;
  }

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setSize(this.width, this.height, false);
    const pw = Math.floor(this.width * this.renderer.getPixelRatio());
    const ph = Math.floor(this.height * this.renderer.getPixelRatio());
    this.hdrRT.setSize(pw, ph);
    this.compRT.setSize(pw, ph);
    this.post.resize(pw, ph);
    if (this.camera) {
      this.camera.camera.aspect = this.width / this.height;
      this.camera.camera.updateProjectionMatrix();
    }
  }

  /** Update lighting uniforms from the (fractional) simulation tick. */
  private updateCelestial(): void {
    let tick = this.renderTick;
    if (this.timeOfDayOverride !== null) {
      const day = Math.floor(tick / TICKS_PER_DAY);
      tick = day * TICKS_PER_DAY + this.timeOfDayOverride * TICKS_PER_DAY;
    }
    const sun = sunDirection(tick);
    (this.shared.uSunDir.value as THREE.Vector3).set(sun[0], sun[1], sun[2]);
    const moon = moonDirection(tick);
    const md = this.shared.uMoonDir.value as THREE.Vector3;
    md.set(moon[0], moon[1], moon[2]);
    // Eclipse: the moon slides across the sun; daylight fails.
    const e = this.vfx.eclipse;
    this.shared.uEclipse.value = e;
    if (e > 0.001) {
      const sd = new THREE.Vector3(sun[0], sun[1], sun[2]);
      const off = new THREE.Vector3(0, 1, 0).cross(sd).normalize().multiplyScalar((1 - e) * 0.03);
      md.lerp(sd.clone().add(off).normalize(), Math.min(1, e * 1.5)).normalize();
    }
    this.shared.uSunIntensity.value = 20 * (1 - 0.93 * e);
  }

  render(dt: number): void {
    if (!this.ready || this.contextLost) return;
    const t0 = performance.now();
    this.time += dt;
    this.shared.uTime.value = this.time;
    this.updateCelestial();
    this.camera.update(dt);
    const cam = this.camera.camera;
    (this.shared.uCamPos.value as THREE.Vector3).copy(cam.position);
    this.terrain.update(cam);
    this.vegetation.update(this.camera.current.focus, this.camera.current.distance, this.data, performance.now());
    this.grass.update(cam, this.camera.current.focus, this.data.n);
    const dTick = this.renderTick - this.lastRenderTick;
    this.lastRenderTick = this.renderTick;
    this.creatures.update(cam, this.renderTick, dTick, this.data, dt);
    this.people.update(cam, this.renderTick, dTick, this.data, dt, this.shared.uSunDir.value as THREE.Vector3);
    this.vfx.update({ camera: cam, data: this.data, renderTick: this.renderTick, dt, effects: this.effects, speed: this.simSpeed, sunDir: this.shared.uSunDir.value as THREE.Vector3, civ: this.buildings.latest });
    let extraRain = 0;
    for (const e of this.effects) {
      if (e.power !== 'rain' || this.renderTick > e.end) continue;
      const d = cam.position.clone().normalize().angleTo(new THREE.Vector3(e.x, e.y, e.z)) * PLANET_RADIUS;
      if (d < e.radius) extraRain = Math.max(extraRain, 0.8 * (1 - d / e.radius));
    }
    this.precip.update(cam, this.data, dt, this.shared.uSunDir.value as THREE.Vector3, this.shared.uSunIntensity.value as number, extraRain);
    (this.shared.uTsunamiAmp.value as number[]).splice(0, 4, ...this.vfx.tsunamiAmp);
    // A rainbow when it rains near a low camera with the sun low behind it.
    {
      const up = cam.position.clone().normalize();
      const sunEl = up.dot(this.shared.uSunDir.value as THREE.Vector3);
      const alt = this.camera.altitude;
      const want = this.precip.intensity > 0.12 && sunEl > 0.05 && sunEl < 0.6 && alt < 350 ? Math.min(1, this.precip.intensity * 2) * (1 - this.precip.snow) : 0;
      this.rainbow += (want - this.rainbow) * Math.min(1, dt * 0.5);
      this.atmosphere.material.uniforms.uRainbow.value = this.rainbow;
    }
    const fin = this.post.final.uniforms;
    fin.uCA.value = Math.min(1, this.vfx.aberration);
    fin.uFade.value = Math.min(0.85, this.vfx.flash * 0.8);
    (fin.uFadeColor.value as THREE.Vector3).set(this.vfx.flashColor.r * 1.4, this.vfx.flashColor.g * 1.4, this.vfx.flashColor.b * 1.4);

    const r = this.renderer;
    r.info.reset();
    const halfSize = Math.min(420, Math.max(28, this.camera.current.distance * 1.3 + 12));
    this.shadows.update(r, this.scene, this.camera.current.focus, this.camera.focusHeight, halfSize, this.shared.uSunDir.value as THREE.Vector3, this.shared);
    // Sky layer.
    const moonDir = this.shared.uMoonDir.value as THREE.Vector3;
    const sidereal = -(this.renderTick / TICKS_PER_DAY) * Math.PI * 2;
    this.sky.sync(cam, sidereal, moonDir.clone().multiplyScalar(MOON_DISTANCE), this.hdrRT.height);
    r.setRenderTarget(this.hdrRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.sky.scene, this.sky.camera);
    r.clearDepth();
    r.render(this.scene, cam);
    // Atmosphere composite.
    this.atmosphere.render(r, cam, this.hdrRT.texture, this.hdrRT.depthTexture!, this.compRT);
    // Sun screen position for flare / god rays.
    const sunDir = this.shared.uSunDir.value as THREE.Vector3;
    const sp = cam.position.clone().addScaledVector(sunDir, 5000).project(cam);
    const behind = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).dot(sunDir) < 0;
    this.sunUv.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    const margin = Math.max(Math.abs(sp.x), Math.abs(sp.y));
    const visible = behind ? 0 : 1 - Math.min(1, Math.max(0, (margin - 1.0) / 0.3));
    this.post.render(r, this.compRT.texture, this.hdrRT.depthTexture!, { uv: this.sunUv, visible }, cam.projectionMatrixInverse, this.time);
    this.stats.drawCalls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;
    this.stats.patches = this.terrain.lod.count;
    this.stats.frameMs = performance.now() - t0;
  }

  /** Feed the active storm systems to the cloud shader (up to 8, strongest first). */
  setStorms(storms: StormData[]): void {
    const list = [...storms].sort((a, b) => b.intensity - a.intensity).slice(0, 8);
    const S = this.shared.uStorms.value as THREE.Vector4[];
    const P = this.shared.uStormParams.value as THREE.Vector4[];
    list.forEach((st, i) => {
      S[i].set(st.x, st.y, st.z, st.radius * (st.type === 1 ? 1.4 : 1.0));
      P[i].set(Math.min(1, st.intensity * (st.type === 1 ? 0.9 : 0.75)), st.y >= 0 ? 1 : -1, st.type, 0);
    });
    this.shared.uStormCount.value = list.length;
  }

  /** Terrain changed in the simulation: re-upload faces, normals, vegetation. */
  updateHeights(faces: number[], data: Float32Array[]): void {
    if (!this.ready) return;
    this.data.updateFaces(faces, data);
    this.data.computeNormals(this.renderer, faces);
    this.vegetation.invalidate();
  }

  /** Rivers and lakes changed (terraforming). */
  updateWater(rivers: RiverData, lakes: LakeData): void {
    if (!this.ready || !this.world) return;
    this.world = { ...this.world, rivers, lakes };
    this.water.rebuild(this.world, this.data);
  }

  setTribes(tribes: TribeData[]): void {
    const cols = this.shared.uTribeCol.value as THREE.Color[];
    tribes.forEach((t, i) => { if (i < 32) cols[i].setHex(t.color); });
    this.people.tribes = tribes;
  }

  /** Capture the current frame as a PNG data URL (photo mode export). */
  capture(): string {
    this.render(0);
    return this.canvas.toDataURL('image/png');
  }
}
