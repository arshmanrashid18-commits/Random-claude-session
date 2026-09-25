/**
 * Render performance probe: for each quality preset, boot the game, grow the
 * world, frame a busy view and measure main-thread CPU time per frame, draw
 * calls and triangles (and wall-clock frame time, which under headless
 * SwiftShader measures a software rasteriser, not a GPU).
 *
 * Usage: node scripts/perf.mjs [--qualities=low,medium,high,ultra] [--advance=4800]
 *        [--views=village,orbit,forest] [--frames=20]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? 'true'];
}));
const qualities = (args.qualities ?? 'low,medium,high,ultra').split(',');
const views = (args.views ?? 'orbit,village,forest').split(',');
const advance = Number(args.advance ?? 4800);
const frames = Number(args.frames ?? 20);

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-gpu-sandbox'] });
const rows = [];
for (const q of qualities) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(900_000);
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/?harness=1&seed=20260925&quality=${q}`);
  await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
  await page.evaluate(() => window.__genesis.ready);
  await page.evaluate(() => window.__genesis.hud(true));
  await page.evaluate((n) => window.__genesis.advance(n), advance);
  for (const v of views) {
    await page.evaluate((v) => window.__genesis.view(v), v);
    await page.evaluate(() => window.__genesis.renderFrames(4));
    const r = await page.evaluate(async (n) => {
      const g = window.__genesis;
      let cpu = 0, calls = 0, tris = 0;
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        await g.renderFrames(1);
        const s = g.stats();
        cpu += s.frameMs; calls += s.drawCalls; tris += s.triangles;
      }
      const wall = (performance.now() - t0) / n;
      const R = g.game.renderer;
      return { cpu: cpu / n, calls: calls / n, tris: tris / n, wall, people: R.people?.count ?? 0, animals: R.creatures?.count ?? 0, veg: R.vegetation.count };
    }, frames);
    rows.push({ q, v, ...r });
    console.log(`${q.padEnd(7)} ${v.padEnd(8)} cpu ${r.cpu.toFixed(2)} ms  calls ${r.calls.toFixed(0)}  tris ${(r.tris / 1e6).toFixed(2)}M  wall ${r.wall.toFixed(0)} ms  veg ${r.veg}`);
  }
  if (problems.length) console.log(`  ${problems.length} console problem(s): ${problems.slice(0, 3).join(' | ')}`);
  await page.close();
}
console.log('\n| Quality | View | Main-thread CPU ms/frame | Draw calls | Triangles | SwiftShader wall ms/frame |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.q} | ${r.v} | ${r.cpu.toFixed(2)} | ${r.calls.toFixed(0)} | ${(r.tris / 1e6).toFixed(2)} M | ${r.wall.toFixed(0)} |`);
await browser.close();
await server.close();
