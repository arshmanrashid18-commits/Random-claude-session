import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { Planet } from '../../src/sim/planet/planet';
import { WORLD_PRESETS } from '../../src/sim/planet/presets';
import { BIOME_COLORS, BIOME_NAMES } from '../../src/sim/climate/biomes';

const seed = Number(process.argv[2] ?? 1234);
const preset = (process.argv[3] ?? 'earthlike') as keyof typeof WORLD_PRESETS;
const out = process.argv[4] ?? '/tmp/biome.png';
const mode = process.argv[5] ?? 'biome';
const t0 = performance.now();
let last = '';
const planet = new Planet(seed, WORLD_PRESETS[preset].params, (s) => { if (s !== last) { console.log(`${(performance.now() - t0).toFixed(0)}ms ${s}`); last = s; } });
console.log(`total ${(performance.now() - t0).toFixed(0)}ms rivers=${planet.hydro.rivers.length} lakes=${planet.hydro.lakes.length}`);
const W = 1024, H = 512;
const png = new PNG({ width: W, height: H });
const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const cols = BIOME_COLORS.map(hex);
const counts = new Array(BIOME_NAMES.length).fill(0);
const R = planet.region;
for (let c = 0; c < R.count; c++) counts[planet.climate.biome[c]]++;
console.log(BIOME_NAMES.map((n, i) => `${n}:${counts[i]}`).join(' '));
for (let y = 0; y < H; y++) {
  const lat = (0.5 - (y + 0.5) / H) * Math.PI;
  for (let x = 0; x < W; x++) {
    const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
    const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
    const h = planet.heightAt(dx, dy, dz);
    const c = R.cellOf(dx, dy, dz);
    let col: number[];
    if (mode === 'temp') { const t = planet.climate.meanTemp[c]; const k = Math.max(0, Math.min(1, (t + 30) / 60)); col = [255 * k, 80, 255 * (1 - k)]; }
    else if (mode === 'rain') { const r = planet.climate.meanRain[c]; const k = Math.min(1, r / 3); col = [200 * (1 - k), 120 + 100 * k, 60 + 180 * k]; }
    else col = cols[planet.climate.biome[c]];
    const e = 0.004;
    const hx = planet.heightAt(Math.cos(lat) * Math.cos(lon + e), dy, Math.cos(lat) * Math.sin(lon + e));
    const hy = planet.heightAt(Math.cos(lat + e) * Math.cos(lon), Math.sin(lat + e), Math.cos(lat + e) * Math.sin(lon));
    const shade = h < 0 ? 1 : Math.max(0.5, Math.min(1.25, 1 + ((h - hx) + (hy - h)) * 0.25));
    const i = (y * W + x) * 4;
    png.data[i] = Math.min(255, col[0] * shade); png.data[i + 1] = Math.min(255, col[1] * shade); png.data[i + 2] = Math.min(255, col[2] * shade); png.data[i + 3] = 255;
  }
}
// rivers
for (const r of planet.hydro.rivers) {
  for (let k = 0; k < r.points.length / 3; k++) {
    const x = r.points[k * 3], y = r.points[k * 3 + 1], z = r.points[k * 3 + 2];
    const lat = Math.asin(y), lon = Math.atan2(z, x);
    const px = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * W), py = Math.floor((0.5 - lat / Math.PI) * H);
    const rad = r.width[k] > 4 ? 1 : 0;
    for (let oy = -rad; oy <= rad; oy++) for (let ox = -rad; ox <= rad; ox++) {
      const i = (((py + oy + H) % H) * W + ((px + ox + W) % W)) * 4;
      png.data[i] = 40; png.data[i + 1] = 110; png.data[i + 2] = 255;
    }
  }
}
writeFileSync(out, PNG.sync.write(png));
