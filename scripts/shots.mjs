/**
 * Screenshot harness: boots the game with a fixed seed in headless Chromium
 * (software WebGL via SwiftShader), advances the simulation to scripted
 * checkpoints, moves the camera to named viewpoints and saves PNGs to
 * docs/screenshots. Any console error or warning fails the run.
 *
 * Usage: npm run shots [-- --only=orbit,coast] [--quality=high] [--seed=N]
 *        [--width=1280] [--height=720] [--out=docs/screenshots]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? 'true'];
}));
const seed = args.seed ?? '20260925';
const quality = args.quality ?? 'high';
const width = Number(args.width ?? 1280);
const height = Number(args.height ?? 720);
const outDir = resolve(args.out ?? 'docs/screenshots');
const prefix = args.prefix ?? '';
const DEFAULT_SHOTS = [
  { name: 'orbit', view: 'orbit', advance: 0 },
  { name: 'terminator', view: 'terminator' },
  { name: 'coast', view: 'coast' },
  { name: 'mountains', view: 'mountains' },
  { name: 'forest', view: 'forest' },
  { name: 'ground', view: 'ground' },
  { name: 'night', view: 'night' },
  { name: 'aurora', view: 'aurora' },
  { name: 'storm', view: 'storm' },
  { name: 'wildlife', view: 'wildlife', advance: 60 },
  { name: 'village', view: 'village' },
  { name: 'volcano', view: 'volcano' },
];
const only = args.only ? args.only.split(',') : null;
const shots = DEFAULT_SHOTS.filter((s) => !only || only.includes(s.name));

mkdirSync(outDir, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const addr = server.httpServer.address();
const url = `http://127.0.0.1:${addr.port}/?harness=1&seed=${seed}&quality=${quality}`;

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.setDefaultTimeout(600_000);
const problems = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') problems.push(`[${t}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
const allLogs = [];
page.on('console', (m) => allLogs.push(`[${m.type()}] ${m.text()}`));
process.on('unhandledRejection', (e) => {
  console.error('FAILED:', e?.message ?? e);
  console.error(allLogs.slice(-30).join('\n'));
  process.exit(1);
});

const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
await page.evaluate(() => window.__genesis.ready);
console.log(`world ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
// Warm up: let textures and shaders settle.
if (args.advance) await page.evaluate((n) => window.__genesis.advance(n), Number(args.advance));
await page.evaluate(() => window.__genesis.renderFrames(3));

for (const s of shots) {
  const ts = Date.now();
  if (s.advance) await page.evaluate((n) => window.__genesis.advance(n), s.advance);
  await page.evaluate((v) => { window.__genesis.view(v); window.__genesis.setTime(12.5); }, s.view);
  await page.evaluate(() => window.__genesis.renderFrames(4));
  await page.evaluate(() => window.__genesis.setTime(12.5));
  await page.evaluate(() => window.__genesis.renderFrames(1));
  const file = `${outDir}/${prefix}${s.name}.png`;
  await page.screenshot({ path: file, timeout: 300_000 });
  const stats = await page.evaluate(() => window.__genesis.stats());
  console.log(`${s.name}: ${((Date.now() - ts) / 1000).toFixed(1)}s  ${JSON.stringify(stats)}`);
}

await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n${problems.length} console problem(s):`);
  for (const p of [...new Set(problems)].slice(0, 40)) console.error('  ' + p);
  process.exit(1);
}
console.log('shots ok, zero console errors/warnings');
