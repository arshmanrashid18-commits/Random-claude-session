/** Diagnose hurricane rendering: storm data, shader uniforms and the storm view. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/?harness=1&seed=20260925&quality=${process.env.Q ?? 'low'}`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(600_000);
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`); });
await page.goto(url);
await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
await page.evaluate(() => window.__genesis.ready);
await page.evaluate(() => window.__genesis.hud(false));
if (process.env.FORCE) await page.evaluate(([r, b, p]) => { window.__FORCE = true; window.__FORCE_R = r; window.__BIAS = b; window.__PATCH = p; }, [Number(process.env.FORCE), Number(process.env.BIAS ?? 0), process.env.PATCH ? JSON.parse(process.env.PATCH) : null]);
for (let k = 0; k < 24; k++) {
  const found = await page.evaluate(() => window.__genesis.game.renderer.storms.some((st) => st.type === 1 && st.intensity > 0.45));
  if (found) break;
  await page.evaluate(() => window.__genesis.advance(80));
  await page.evaluate(() => window.__genesis.renderFrames(1));
}
const info = await page.evaluate(async () => {
  const g = window.__genesis;
  const R = g.game.renderer;
  g.view('storm');
  g.setTime(12.5);
  await g.renderFrames(4);
  if (window.__FORCE) {
    // Isolation test: one strong hurricane at the focus and nothing else.
    const S = R.shared;
    const c0 = R.camera.current.focus;
    S.uStorms.value[0].set(c0.x, c0.y, c0.z, window.__FORCE_R);
    S.uStormParams.value[0].set(1, 1, 1, 0);
    S.uStormCount.value = 1;
    if (window.__BIAS) S.uCloudCoverBias.value = window.__BIAS;
    R.setStorms = () => {};
    if (window.__PATCH) {
      const m = R.atmosphere.material;
      for (const [a, b] of window.__PATCH) {
        if (!m.fragmentShader.includes(a)) throw new Error('patch miss: ' + a);
        m.fragmentShader = m.fragmentShader.replace(a, b);
      }
      m.needsUpdate = true;
    }
    await g.renderFrames(2);
  }
  const c = R.camera.current;
  const S = R.shared;
  return {
    storms: R.storms.map((s) => ({ type: s.type, name: s.name, i: +s.intensity.toFixed(2), r: +s.radius.toFixed(3), dir: [s.x, s.y, s.z].map((v) => +v.toFixed(3)) })),
    count: S.uStormCount.value,
    uStorms: S.uStorms.value.slice(0, S.uStormCount.value).map((v) => v.toArray().map((x) => +x.toFixed(3))),
    uParams: S.uStormParams.value.slice(0, S.uStormCount.value).map((v) => v.toArray().map((x) => +x.toFixed(3))),
    focus: c.focus.toArray().map((x) => +x.toFixed(3)),
    dist: c.distance,
    atmoHasStorms: Object.keys(R.atmosphere?.material?.uniforms ?? R.atmosphere?.mat?.uniforms ?? {}).filter((k) => k.startsWith('uStorm')),
  };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: '/tmp/claude-0/storm-debug.png' });
await browser.close();
await server.close();
