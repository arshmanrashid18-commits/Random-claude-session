/** Print viewpoint diagnostics: focus, camera distance, vegetation at focus. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
const ids = (process.argv[2] ?? 'forest').split(',');
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/?harness=1&seed=20260925&quality=low`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(300_000);
await page.goto(url);
await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
await page.evaluate(() => window.__genesis.ready);
for (const id of ids) {
  const r = await page.evaluate(async (id) => {
    const g = window.__genesis;
    g.view(id);
    const R = g.game.renderer;
    const f0 = R.camera.current.focus.clone();
    await g.renderFrames(3);
    const c = R.camera.current;
    const d = R.data;
    const face = (v) => { const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z); return [ax, ay, az]; };
    void face;
    const cs = await import('/src/sim/planet/cubesphere.ts');
    const fab = cs.dirToFaceAB(c.focus.x, c.focus.y, c.focus.z);
    const F = { face: fab.face, a: fab.a, b: fab.b };
    const veg = [0, 1, 2, 3].map((k) => +d.sampleRegion(d.vegACPU, F.face, F.a, F.b, k).toFixed(2)).concat([0, 1, 2, 3].map((k) => +d.sampleRegion(d.vegBCPU, F.face, F.a, F.b, k).toFixed(2)));
    // Global maximum of tree density over a coarse scan.
    let best = 0;
    for (let f = 0; f < 6; f++) for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) {
      const a = -1 + (2 * i + 1) / 64, b = -1 + (2 * j + 1) / 64;
      const t = d.sampleRegion(d.vegACPU, f, a, b, 2) + d.sampleRegion(d.vegACPU, f, a, b, 3) + d.sampleRegion(d.vegBCPU, f, a, b, 0);
      if (t > best) best = t;
    }
    return { veg, bestTrees: best, id, focus0: f0.toArray().map((x) => +x.toFixed(4)), focus: c.focus.toArray().map((x) => +x.toFixed(4)), dist: c.distance, tilt: c.tiltOffset, vegCount: R.vegetation.count, h: d.heightAt(c.focus.x, c.focus.y, c.focus.z) };
  }, id);
  console.log(JSON.stringify(r));
}
await browser.close();
await server.close();
