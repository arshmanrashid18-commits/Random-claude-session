import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { VertexGrid, CellGrid } from '../../src/sim/planet/cubesphere';
import { generateTerrain } from '../../src/sim/planet/terrain';
import { WORLD_PRESETS } from '../../src/sim/planet/presets';
import { HEIGHT_N, REGION_N } from '../../src/sim/constants';

const seed = Number(process.argv[2] ?? 1234);
const preset = (process.argv[3] ?? 'earthlike') as keyof typeof WORLD_PRESETS;
const out = process.argv[4] ?? '/tmp/terrain.png';
const t0 = performance.now();
const grid = new VertexGrid(HEIGHT_N);
const region = new CellGrid(REGION_N);
const t1 = performance.now();
let last = '';
const res = generateTerrain(seed, WORLD_PRESETS[preset].params, grid, region, (s, f) => { if (s !== last) { console.log(`${(performance.now() - t1).toFixed(0)}ms ${s}`); last = s; } });
const t2 = performance.now();
console.log(`grids ${(t1 - t0).toFixed(0)}ms, terrain ${(t2 - t1).toFixed(0)}ms`);
const W = 1024, H = 512;
const png = new PNG({ width: W, height: H });
let land = 0;
for (let y = 0; y < H; y++) {
  const lat = (0.5 - (y + 0.5) / H) * Math.PI;
  for (let x = 0; x < W; x++) {
    const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
    const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
    const h = grid.sample(res.heights, dx, dy, dz);
    // hillshade
    const e = 0.004;
    const hx = grid.sample(res.heights, Math.cos(lat) * Math.cos(lon + e), dy, Math.cos(lat) * Math.sin(lon + e));
    const hy = grid.sample(res.heights, Math.cos(lat + e) * Math.cos(lon), Math.sin(lat + e), Math.cos(lat + e) * Math.sin(lon));
    const shade = Math.max(0.35, Math.min(1.3, 1 + ((h - hx) + (hy - h)) * 0.35));
    let r: number, g: number, b: number;
    if (h < 0) { const t = Math.min(1, -h / 40); r = 20 * (1 - t) + 5; g = 90 * (1 - t) + 20; b = 160 * (1 - t) + 70; }
    else { land++; const t = Math.min(1, h / 48); r = 70 + t * 150; g = 130 + t * 60 - t * t * 60; b = 60 + t * 120; r *= shade; g *= shade; b *= shade; }
    const i = (y * W + x) * 4;
    png.data[i] = Math.min(255, r); png.data[i + 1] = Math.min(255, g); png.data[i + 2] = Math.min(255, b); png.data[i + 3] = 255;
  }
}
console.log('land fraction (equirect px)', (land / (W * H)).toFixed(3));
writeFileSync(out, PNG.sync.write(png));
