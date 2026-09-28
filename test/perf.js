/*
 * How long a remote key press takes to move the highlight on a creator with many posts, with the CPU slowed down
 * to roughly a TV's speed. Prints the median and worst time per move at a few list sizes.
 *   node test/perf.js [posts] [cpu-slowdown]
 * Needs Playwright (NODE_PATH pointing at a global install works).
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { execFileSync } = require('child_process');
const fake = require('./fake-patreon');

const ROOT = path.join(__dirname, '..');
const PORT = 8791, ORIGIN = `http://localhost:${PORT}`;
const POSTS = +(process.argv[2] || 1500), SLOWDOWN = +(process.argv[3] || 6);

execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-site.js')], { stdio: 'ignore' });
// Three sample creators share the posts, so the first one gets a third of them.
const patreon = fake.start(PORT, { posts: POSTS * 3, pageSize: 100 });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addCookies([{ name: 'session_id', value: fake.SESSION, url: ORIGIN }]);
  await context.addInitScript(`window.PTV_TV = true; window.PTV_TEST_HOST = 'localhost:${PORT}';`);
  await context.addInitScript({ path: path.join(ROOT, 'app', 'site', 'patreon-tv.js') });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  await page.goto(`${ORIGIN}/home`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.App && App.top() && App.top().name === 'home', null, { timeout: 10000 });
  await page.evaluate(() => App.go('creators'));
  await page.waitForSelector('.creator-tile');
  await page.evaluate(() => document.querySelector('.creator-tile').click());
  await page.waitForSelector('.creator-page .grid .card');
  await page.waitForTimeout(500);

  // Each press: from the keydown to the frame after it, which includes style, layout and paint.
  await page.evaluate(() => {
    window.__times = [];
    document.addEventListener('keydown', (e) => {
      const t0 = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => window.__times.push(performance.now() - t0)));
    }, true);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  // Posts loaded so far (only the ones near the screen are in the page). Versions before 2.3.1 kept them all in the page.
  const cards = () => page.evaluate(() => {
    const w = App.top().el.querySelector('.grid-wrap');
    return w._grid ? w._grid.state.shown.length : App.top().el.querySelectorAll('.grid .card').length;
  });
  async function loadTo(n) {
    // Scrolling to the end (or, before 2.3.1, focusing the last post) is what loads the next page.
    for (let i = 0; i < 200 && (await cards()) < n; i++) {
      const before = await cards();
      await page.evaluate(() => {
        const sc = App.top().el, all = sc.querySelectorAll('.grid .card');
        if (sc.querySelector('.grid-wrap')._grid) sc.scrollTop = sc.scrollHeight; else Focus.set(all[all.length - 1]);
      });
      for (let t = 0; t < 50 && (await cards()) === before; t++) await page.waitForTimeout(100);
      if ((await cards()) === before) break;
    }
  }
  async function measure(label) {
    // Start a few rows from the end (without loading more) and walk around the grid.
    await page.evaluate(() => { const sc = App.top().el; sc.scrollTop = sc.scrollHeight; });
    await page.waitForTimeout(300);
    await page.evaluate(() => { const all = App.top().el.querySelectorAll('.grid .card'); Focus.set(all[Math.max(0, all.length - 24)]); });
    await page.waitForTimeout(300);
    // Loading leaves garbage behind; collect it so the numbers are about moving, not about loading.
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: SLOWDOWN });
    await page.evaluate(() => { window.__times = []; });
    const keys = ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(250 * SLOWDOWN / 2); }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const t = (await page.evaluate(() => window.__times)).sort((a, b) => a - b);
    const n = await cards();
    const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
    console.log(`${label.padEnd(18)} ${String(n).padStart(5)} posts  ${String(dom).padStart(6)} elements  median ${t[t.length >> 1].toFixed(0).padStart(4)} ms  worst ${t[t.length - 1].toFixed(0).padStart(4)} ms`);
    return { cards: n, median: t[t.length >> 1], worst: t[t.length - 1] };
  }

  const out = [];
  for (const n of [60, 300, POSTS]) { await loadTo(n); out.push(await measure(`${n} loaded`)); }
  await browser.close();
  patreon.close();
  if (process.env.PERF_JSON) console.log(JSON.stringify(out));
})().catch((e) => { console.error(e); process.exit(1); });
