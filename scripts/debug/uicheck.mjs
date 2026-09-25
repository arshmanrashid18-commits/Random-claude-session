/** Boot the game with the HUD visible, exercise panels and powers, screenshot. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/ui';
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/?harness=1&seed=20260925&quality=high`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(600_000);
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
await page.evaluate(() => window.__genesis.ready);
const step = async (name, fn) => { const t = Date.now(); await fn(); console.log(name, ((Date.now() - t) / 1000).toFixed(1) + 's'); };
await step('advance', () => page.evaluate(() => window.__genesis.advance(9600)));
await step('village', async () => {
  await page.evaluate(() => { window.__genesis.view('village'); window.__genesis.setTime(12.5); });
  await page.evaluate(() => window.__genesis.renderFrames(3));
  await page.screenshot({ path: `${out}/hud-village.png` });
});
await step('inspect settlement', async () => {
  await page.evaluate(async () => {
    const g = window.__genesis.game;
    const s = g.civ.settlements.filter((x) => x.alive).sort((a, b) => b.pop - a.pop)[0];
    g.select({ kind: 'settlement', id: s.id });
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.evaluate(() => window.__genesis.renderFrames(2));
  await page.screenshot({ path: `${out}/hud-inspect.png` });
});
await step('meteor', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__genesis.game;
    const cam = g.renderer.camera;
    const f = cam.current.focus.clone();
    const east = f.clone().cross({ x: 0, y: 1, z: 0 }).normalize();
    const p = f.clone().addScaledVector(east, 0.06).normalize();
    await window.__genesis.command({ kind: 'boundless', on: true });
    cam.cutTo({ distance: 260, tiltOffset: 0.25 });
    return window.__genesis.command({ kind: 'power', power: 'meteor', x: p.x, y: p.y, z: p.z });
  });
  console.log('meteor cast', JSON.stringify(r));
  await page.evaluate(() => window.__genesis.advance(14));
  await page.evaluate(() => window.__genesis.renderFrames(3));
  await page.screenshot({ path: `${out}/meteor-falling.png` });
  await page.evaluate(() => window.__genesis.advance(11));
  await page.evaluate(() => window.__genesis.renderFrames(2));
  await page.screenshot({ path: `${out}/meteor-impact.png` });
  await page.evaluate(() => window.__genesis.advance(40));
  await page.evaluate(() => window.__genesis.renderFrames(6));
  await page.screenshot({ path: `${out}/meteor-after.png` });
});
await step('panels', async () => {
  await page.evaluate(() => window.__genesis.game.menu('chronicle'));
  await page.evaluate(() => window.__genesis.renderFrames(2));
  await page.screenshot({ path: `${out}/chronicle.png` });
  await page.evaluate(() => { window.__genesis.game.closeAll(); window.__genesis.game.menu('ecology'); });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => window.__genesis.renderFrames(2));
  await page.screenshot({ path: `${out}/ecology.png` });
  await page.evaluate(() => window.__genesis.game.closeAll());
});
await browser.close();
await server.close();
if (problems.length) { console.log(problems.slice(0, 30).join('\n')); process.exit(1); }
console.log('ui ok');
