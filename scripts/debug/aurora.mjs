/** Print aurora viewpoint geometry: focus, sun direction and their angle. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/?harness=1&seed=20260925&quality=low`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(300_000);
await page.goto(url);
await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
await page.evaluate(() => window.__genesis.ready);
const r = await page.evaluate(async () => {
  const g = window.__genesis;
  const R = g.game.renderer;
  g.view('aurora');
  await g.renderFrames(3);
  const f = R.camera.current.focus;
  const s = R.shared.uSunDir.value;
  const cam = R.camera.camera.position;
  return { focus: f.toArray().map((x) => +x.toFixed(3)), sun: s.toArray().map((x) => +x.toFixed(3)), dot: +f.clone().normalize().dot(s).toFixed(3), tod: R.timeOfDayOverride, cam: cam.toArray().map((x) => +x.toFixed(0)) };
});
console.log(JSON.stringify(r));
await browser.close();
await server.close();
