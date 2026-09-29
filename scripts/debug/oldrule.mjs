/**
 * Re-injects the rule behind the mouse bug found in play (`#ui > *` taking the
 * pointer at id specificity) and checks that closed panels still take no hits,
 * i.e. that `visibility: hidden` on closed layers guards independently.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/?play=1&seed=20260925&quality=low`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--disable-gpu-sandbox'] });
const W = 1280, H = 720;
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.setDefaultTimeout(120_000);
await page.goto(url);
await page.waitForFunction(() => window.__genesis !== undefined, null, { timeout: 180_000 });
await page.evaluate(() => window.__genesis.ready);
await page.addStyleTag({ content: '#ui > * { pointer-events: auto; }' });
const hits = await page.evaluate(([W, H]) => {
  const out = [];
  for (let y = 0.2; y < 0.85; y += 0.15) for (let x = 0.2; x < 0.85; x += 0.15) {
    const el = document.elementFromPoint(W * x, H * y);
    out.push(el ? (el.id || String(el.className?.baseVal ?? el.className) || el.tagName) : 'none');
  }
  return out;
}, [W, H]);
const bad = hits.filter((h) => /modal/.test(h));
console.log(bad.length ? `FAIL: with the old rule back, closed panels take hits: ${bad.join(', ')}` : `ok: with the old rule back, no closed panel takes a hit (${hits.length} points: ${[...new Set(hits)].join(', ')})`);
await browser.close();
await server.close();
process.exit(bad.length ? 1 : 0);
