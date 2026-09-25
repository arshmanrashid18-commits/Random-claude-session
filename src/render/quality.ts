/** Rendering quality presets and the auto-detect governor. */

export type QualityId = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  id: QualityId;
  label: string;
  renderScale: number;
  maxDpr: number;
  grid: number;
  maxLevel: number;
  rangeK: number;
  atmoSteps: number;
  cloudSteps: number;
  bloom: boolean;
  godRays: boolean;
  fxaa: boolean;
  /** Vegetation instance budget near the camera. */
  vegetation: number;
  /** Grass blade budget. */
  grass: number;
  /** Max entities drawn at full detail. */
  entityDetail: number;
  /** Sun shadow map size (0 = off). */
  shadowSize: number;
}

export const QUALITY_PRESETS: Record<QualityId, QualityPreset> = {
  low: { id: 'low', label: 'Low', renderScale: 0.6, maxDpr: 1, grid: 16, maxLevel: 6, rangeK: 2.0, atmoSteps: 8, cloudSteps: 10, bloom: true, godRays: false, fxaa: false, vegetation: 2500, grass: 0, entityDetail: 2000, shadowSize: 0 },
  medium: { id: 'medium', label: 'Medium', renderScale: 0.8, maxDpr: 1.25, grid: 24, maxLevel: 7, rangeK: 2.3, atmoSteps: 12, cloudSteps: 18, bloom: true, godRays: true, fxaa: true, vegetation: 7000, grass: 12000, entityDetail: 5000, shadowSize: 1024 },
  high: { id: 'high', label: 'High', renderScale: 1.0, maxDpr: 1.5, grid: 32, maxLevel: 7, rangeK: 2.6, atmoSteps: 16, cloudSteps: 28, bloom: true, godRays: true, fxaa: true, vegetation: 14000, grass: 30000, entityDetail: 10000, shadowSize: 2048 },
  ultra: { id: 'ultra', label: 'Ultra', renderScale: 1.0, maxDpr: 2, grid: 32, maxLevel: 8, rangeK: 3.2, atmoSteps: 24, cloudSteps: 40, bloom: true, godRays: true, fxaa: true, vegetation: 24000, grass: 60000, entityDetail: 16000, shadowSize: 4096 },
};

export const QUALITY_ORDER: QualityId[] = ['low', 'medium', 'high', 'ultra'];

/**
 * Watches frame times and steps quality down when the frame rate stays below
 * target (and back up when there is ample headroom), with hysteresis.
 */
export class QualityGovernor {
  enabled = true;
  private samples: number[] = [];
  private cooldown = 0;
  target = 55;

  /** Returns -1 to lower, +1 to raise, 0 to keep. */
  feed(dtSeconds: number, current: QualityId): number {
    if (!this.enabled) return 0;
    this.samples.push(dtSeconds);
    if (this.samples.length > 90) this.samples.shift();
    this.cooldown -= dtSeconds;
    if (this.cooldown > 0 || this.samples.length < 90) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const fps = 1 / median;
    const idx = QUALITY_ORDER.indexOf(current);
    if (fps < this.target * 0.8 && idx > 0) {
      this.cooldown = 4;
      this.samples.length = 0;
      return -1;
    }
    if (fps > this.target * 1.35 && idx < QUALITY_ORDER.length - 2) {
      this.cooldown = 12;
      this.samples.length = 0;
      return 1;
    }
    return 0;
  }
}

/**
 * Initial quality guess from the GPU and device: software renderers and
 * phones start low, integrated GPUs medium, discrete GPUs high. The governor
 * refines it from measured frame times.
 */
export function detectQuality(gl: WebGL2RenderingContext | WebGLRenderingContext): QualityId {
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  } catch { /* unavailable */ }
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  if (/swiftshader|llvmpipe|software|basic render/.test(renderer)) return 'low';
  if (mobile || mem <= 2) return 'low';
  if (/nvidia|geforce|rtx|gtx|radeon rx|radeon pro|amd radeon(?!.*graphics)|quadro/.test(renderer)) return 'high';
  if (/apple m[1-9] (pro|max|ultra)/.test(renderer)) return 'high';
  return 'medium';
}
