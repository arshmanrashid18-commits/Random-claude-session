/**
 * Render a viewpoint with runtime shader patches, to test rendering hypotheses
 * without rebuilding: PATCH='[["terrain|atmo","vs|fs","from","to"], ...]'
 * EVAL='R.precip.mesh.visible = false' runs a snippet with the renderer R in scope
 * after the view is set (e.g. to hide a component). ADV=9600 advances the
 * simulation that many ticks first; TIME=21.5 sets the local hour (default 12.5,
 * 'keep' leaves the viewpoint's own).
 * Usage: PATCH='...' node scripts/debug/patchshot.mjs <viewpoint> <out.png> [quality]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
const [view = 'mountains', out = '/tmp/claude-0/patchshot.png', quality = 'high'] = process.argv.slice(2);
const patches = process.env.PATCH ? JSON.parse(process.env.PATCH) : [];
const snippet = process.env.EVAL ?? '';
const adv = Number(process.env.ADV ?? 0);
const hour = process.env.TIME ?? '12.5';
const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/?harness=1&seed=20260925&quality=${quality}`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(1_200_000);
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text().slice(0, 400)}`); });
await page.goto(url);
await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
await page.evaluate(() => window.__genesis.ready);
await page.evaluate(() => window.__genesis.hud(false));
if (adv > 0) await page.evaluate((n) => window.__genesis.advance(n), adv);
const info = await page.evaluate(async ([view, patches, snippet, hour]) => {
  const g = window.__genesis;
  const R = g.game.renderer;
  const mats = { terrain: R.terrain.terrainMat, ocean: R.terrain.oceanMat, atmo: R.atmosphere.material };
  for (const [m, stage, a, b] of patches) {
    const mat = mats[m];
    const key = stage === 'vs' ? 'vertexShader' : 'fragmentShader';
    if (!mat[key].includes(a)) throw new Error(`patch miss in ${m}.${stage}: ${a}`);
    mat[key] = mat[key].split(a).join(b);
    mat.needsUpdate = true;
  }
  g.view(view);
  if (hour !== 'keep') g.setTime(Number(hour));
  await g.renderFrames(4);
  if (snippet) new Function('R', 'g', snippet)(R, g);
  if (hour !== 'keep') g.setTime(Number(hour));
  await g.renderFrames(1);
  const c = R.camera.camera.position;
  return { extra: window.__pickOut, camAlt: +(Math.hypot(c.x, c.y, c.z) - 1000).toFixed(1), stats: R.stats };
}, [view, patches, snippet, hour]);
console.log(JSON.stringify(info));
await page.screenshot({ path: out });
await browser.close();
await server.close();
