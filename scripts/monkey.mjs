/**
 * Monkey test: five minutes of random play — clicks, drags, wheel, keys,
 * powers, terraforming, panels, settings, photo mode, saving — against the
 * real game in headless Chromium. Any console error, warning or page error
 * fails the run.
 *
 * Usage: npm run monkey [-- --minutes=5 --seed=N]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? 'true'];
}));
const minutes = Number(args.minutes ?? 5);
const seed = Number(args.seed ?? 1337);

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/?play=1&seed=20260925&quality=low`;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const W = 1280, H = 720;
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(120_000);
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
page.on('crash', () => problems.push('[crash] page crashed'));
// Loading a save (F5 / the save panel) reloads the page by design.
let navigated = false;
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated = true; });
const NAV_ERR = /context was destroyed|different document|navigat|Target closed/i;

let s = seed >>> 0;
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

await page.goto(url);
await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
await page.evaluate(() => window.__genesis.ready);
await page.evaluate(() => window.__genesis.command({ kind: 'boundless', on: true }));

const keys = ['Space', 'Period', 'Comma', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'Equal', 'Minus', 'KeyH', 'KeyL', 'KeyO', 'KeyY', 'KeyJ', 'KeyK', 'KeyU', 'KeyI', 'Slash', 'Backquote', 'F3', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'KeyT', 'KeyP', 'F5'];
const counts = {};
const note = (k) => { counts[k] = (counts[k] ?? 0) + 1; };
const end = Date.now() + minutes * 60_000;
let actions = 0;
while (Date.now() < end) {
  const r = rnd();
  const x = Math.floor(40 + rnd() * (W - 80)), y = Math.floor(90 + rnd() * (H - 220));
  try {
    if (r < 0.2) {
      // Drag the globe (left) or orbit (right).
      const button = rnd() < 0.7 ? 'left' : 'right';
      await page.mouse.move(x, y);
      await page.mouse.down({ button });
      for (let k = 0; k < 4; k++) await page.mouse.move(x + (rnd() - 0.5) * 300, y + (rnd() - 0.5) * 200, { steps: 3 });
      await page.mouse.up({ button });
      note(`drag-${button}`);
    } else if (r < 0.32) {
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, (rnd() - 0.55) * 900);
      note('wheel');
    } else if (r < 0.52) {
      const k = pick(keys);
      await page.keyboard.press(k);
      note(`key-${k}`);
      // Photo mode: leave it again soon so the HUD stays reachable.
      if (k === 'KeyP') { await page.keyboard.press('Enter'); await page.keyboard.press('KeyP'); }
    } else if (r < 0.7) {
      // Select a power from the bar and cast it somewhere visible.
      const btns = await page.$$('.pw');
      if (btns.length) {
        await pick(btns).click({ timeout: 5000 }).catch(() => {});
        await page.mouse.click(x, y);
        note('cast');
      }
    } else if (r < 0.78) {
      // Terraform stroke.
      await page.keyboard.press('KeyY');
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let k = 0; k < 5; k++) await page.mouse.move(x + k * 12, y + k * 6, { steps: 2 });
      await page.mouse.up();
      await page.keyboard.press('Escape');
      note('terraform');
    } else if (r < 0.9) {
      await page.mouse.click(x, y);
      note('click');
    } else if (r < 0.95) {
      // Open a panel, click inside it, close it.
      const b = pick(await page.$$('.hud-menu .btn'));
      if (b) {
        await b.click({ timeout: 5000 }).catch(() => {});
        const inner = await page.$$('.modal-wrap.open button, .modal-wrap.open [data-sp], .modal-wrap.open .seg button');
        if (inner.length) await pick(inner).click({ timeout: 3000 }).catch(() => {});
        await page.keyboard.press('Escape');
        note('panel');
      }
    } else {
      await page.evaluate(() => window.__genesis.renderFrames(2));
      note('wait');
    }
  } catch (e) {
    // An action racing a save-load reload is expected; anything else is not.
    if (!(navigated && NAV_ERR.test(e.message))) problems.push(`[harness] ${e.message}`);
  }
  actions++;
  if (navigated) {
    navigated = false;
    await page.waitForLoadState('load');
    await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
    await page.evaluate(() => window.__genesis.ready);
    note('reload');
  }
}
const stats = await page.evaluate(() => window.__genesis.stats());
console.log(`${actions} actions in ${minutes} min`, JSON.stringify(counts));
console.log('final', JSON.stringify(stats));
await browser.close();
await server.close();
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)].slice(0, 30)) console.error('  ' + p);
  process.exit(1);
}
console.log('monkey ok: zero console errors or warnings');
