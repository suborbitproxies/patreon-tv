/*
 * Tests the on-TV helper (app/service/helper.js) end to end, with stand-ins for the TV around it:
 * a fake Developer Mode API, a fake sdbd that "starts the app with the debugger" by pointing at a real Chromium
 * debugging port, stubbed Tizen APIs, and the fake patreon.com. Chromium plays the TV's browser engine.
 *   node test/helper-test.js [screenshot-dir]
 */
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const fake = require('./fake-patreon');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'test', 'screens');
fs.mkdirSync(OUT, { recursive: true });
const P = { patreon: 8794, launcher: 8795, dev: 8796, sdb: 8797, update: 8798, cdp: 9555, helper: 8617 };
const TV_UA = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36';

const results = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  (' + info + ')' : '')); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-site.js')], { stdio: 'inherit' });
const patreon = fake.start(P.patreon);
// The TV app's own start page (app/index.html), served as the TV would load it from the package.
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
const launcher = http.createServer((req, res) => {
  const f = path.join(ROOT, 'app', decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if (!f.startsWith(path.join(ROOT, 'app')) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(P.launcher);
// Tizen APIs on the start page (the TV provides these to the app's own pages).
const PAGE_TIZEN = `if (location.port === '${P.launcher}') window.tizen = {
  application: {
    getCurrentApplication: function () { return { appInfo: { packageId: 'PtrnTVapp1' }, exit: function () { console.log('__exit__'); } }; },
    launchAppControl: function (c, id, ok) { console.log('__service__' + id); ok(); }
  },
  ApplicationControl: function () {}, ApplicationControlData: function () {},
  tvinputdevice: { registerKey: function () {} }
};`;

// The update address (the project's GitHub repo), offering a newer app than the one in the package.
const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
const updated = fs.readFileSync(path.join(ROOT, 'app', 'site', 'patreon-tv.js'), 'utf8').replace(/window\.APP_VERSION = "[^"]+"/, 'window.APP_VERSION = "9.9.9"');
let updateFiles = { 'version.json': JSON.stringify({ version: '9.9.9', minHelper: '2.1.0', sha256: sha(updated) }), 'patreon-tv.js': updated };
const updateHits = [];
const updates = http.createServer((req, res) => {
  const name = req.url.split('?')[0].replace(/^\/update\//, '');
  updateHits.push(name);
  if (!(name in updateFiles)) { res.writeHead(404); return res.end(); }
  res.writeHead(200); res.end(updateFiles[name]);
}).listen(P.update);

// Developer Mode settings, as the TV reports them on 127.0.0.1:8001.
let devIP = '127.0.0.1';
const dev = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ device: { developerMode: '1', developerIP: devIP, ip: '127.0.0.1' } }));
}).listen(P.dev);

// sdbd: answers the adb-style handshake and "starts the app with the debugger" on the Chromium port.
const sdbCommands = [];
function pkt(cmd, a0, a1, data) {
  const payload = data ? Buffer.from(data) : Buffer.alloc(0);
  const h = Buffer.alloc(24);
  const c = Buffer.from(cmd).readUInt32LE(0);
  h.writeUInt32LE(c, 0); h.writeUInt32LE(a0, 4); h.writeUInt32LE(a1, 8); h.writeUInt32LE(payload.length, 12);
  h.writeUInt32LE(payload.reduce((s, b) => (s + b) >>> 0, 0), 16); h.writeUInt32LE((c ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, payload]);
}
const sdb = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 24) {
      const cmd = buf.slice(0, 4).toString(), a0 = buf.readUInt32LE(4), len = buf.readUInt32LE(12);
      if (buf.length < 24 + len) return;
      const data = buf.slice(24, 24 + len).toString().replace(/\0$/, '');
      buf = buf.slice(24 + len);
      if (cmd === 'CNXN') sock.write(pkt('CNXN', 0x01000000, 4096, 'device::\0'));
      if (cmd === 'OPEN') {
        sdbCommands.push(data);
        sock.write(pkt('OKAY', 77, a0));
        sock.write(pkt('WRTE', 77, a0, `... successfully launched pid = 4242 with debug 1 port: ${P.cdp}\n`));
      }
    }
  });
  sock.on('error', () => {});
}).listen(P.sdb);

// Tizen APIs the helper uses.
const launched = [];
global.tizen = {
  application: {
    getAppInfo: () => ({ packageId: 'PtrnTVapp1' }),
    getAppsContext: (ok) => ok([]),
    launchAppControl: (ctl, id, ok, err) => { launched.push([id, ctl.data[0].value[0]]); if (id === 'com.samsung.tv.cobalt-yt') ok(); else err(new Error('not found')); }
  },
  systeminfo: { getCapability: () => '6.5' },
  ApplicationControl: function (op, uri, mime, cat, data) { this.operation = op; this.data = data; },
  ApplicationControlData: function (key, value) { this.key = key; this.value = value; }
};

Object.assign(process.env, {
  PTV_HELPER_PORT: String(P.helper), PTV_ENTRY: `http://localhost:${P.patreon}/home`, PTV_DEV_API: `http://127.0.0.1:${P.dev}/api/v2/`,
  PTV_SDB_PORT: String(P.sdb), PTV_TEST_HOST: `localhost:${P.patreon}`, PTV_UPDATE_URL: `http://127.0.0.1:${P.update}/update/`
});
const helper = require('../app/service/helper.js');

function call(method, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: P.helper, path: p, method }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(JSON.parse(b)));
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  const unit = helper._test;
  check('reads the debugger port from the TV\'s reply', unit.debugPort('launched pid = 1 with debug 1 port: 34567') === 34567 && unit.debugPort('... debug : 40123') === 40123);
  check('compares app versions', unit.newer('2.10.0', '2.9.1') && !unit.newer('2.1.0', '2.1.0') && unit.newer('2.1.1', '2.1') && !unit.newer(undefined, '2.1.0'));
  check('presents the TV engine as desktop Chrome', /X11; Linux x86_64.*Chrome\/85\.0\.0\.0/.test(unit.chromeUserAgent(TV_UA)) && unit.chromeUserAgent('Mozilla/5.0 (X11) Chrome/120.0.0.0 Safari') === null);

  const browser = await chromium.launch({ args: [`--remote-debugging-port=${P.cdp}`, `--user-agent=${TV_UA}`] });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: TV_UA });
  await context.addCookies([{ name: 'session_id', value: fake.SESSION, url: `http://localhost:${P.patreon}` }]);
  await context.addInitScript(PAGE_TIZEN);
  const page = await context.newPage();
  const pageLog = [];
  page.on('console', (m) => pageLog.push(m.text()));
  page.on('pageerror', (e) => pageLog.push('pageerror: ' + e.message));

  // In Tizen's Web Simulator (NW.js) the helper can't run: the start page says so instead of failing oddly.
  const sim = await context.newPage();
  await sim.addInitScript('window.nw = {};');
  await sim.goto(`http://127.0.0.1:${P.launcher}/index.html`);
  await sim.waitForTimeout(800);
  const simText = await sim.textContent('body');
  check('in the simulator, the start page says to use a real TV or the Chrome add-on, and restarts nothing',
    /Web Simulator/.test(simText) && /Chrome add-on/.test(simText) && sdbCommands.length === 0, simText.slice(0, 200));
  await sim.close();

  // Developer Mode still points at the computer: the start page explains the one-time setup.
  devIP = '192.168.1.20';
  let st = await call('GET', '/status');
  check('status says when Developer Mode points elsewhere', st.devMode === false && st.developerIP === '192.168.1.20', JSON.stringify(st));
  await page.goto(`http://127.0.0.1:${P.launcher}/index.html`);
  await page.waitForFunction(() => /One-time setup/.test(document.body.textContent), null, { timeout: 8000 }).catch(() => {});
  const setupText = await page.textContent('body');
  check('start page shows the one-time setup', /One-time setup/.test(setupText) && /127\.0\.0\.1/.test(setupText) && /192\.168\.1\.20/.test(setupText));
  await page.screenshot({ path: path.join(OUT, '24-tv-setup.png') });

  // Fixed: "Check again" asks the helper to relaunch the app with the debugger, and the app closes itself.
  devIP = '127.0.0.1';
  st = await call('GET', '/status');
  check('status is ready once Host PC IP is 127.0.0.1', st.devMode === true && !st.debugging, JSON.stringify(st));
  await page.keyboard.press('Enter');
  for (let i = 0; i < 60 && !(st = await call('GET', '/status')).debugging; i++) await wait(250);
  check('start page asks for the relaunch and closes the app', pageLog.includes('__exit__'), pageLog.filter((l) => /__/.test(l)).join(' '));
  check('asks sdbd to start the app with the debugger', sdbCommands[0] === 'shell:0 debug PtrnTVapp1.PatreonTV', sdbCommands.join(' | '));
  check('connects to the debugger and opens Patreon', st.debugging, JSON.stringify(st));

  await page.waitForFunction(() => window.App && App.top() && App.top().name === 'home', null, { timeout: 10000 }).catch(() => {});
  check('the app runs inside the Patreon page, signed in', await page.evaluate(() => location.pathname === '/home' && !!window.App && App.top().name === 'home' && window.PTV_TV === true));
  const appVersion = await page.evaluate(() => window.APP_VERSION);
  st = await call('GET', '/status');
  check('loads the newer app from the update address instead of the packaged one', appVersion === '9.9.9' && st.app === '9.9.9',
    appVersion + ' / ' + updateHits.join(', '));
  const ua = await page.evaluate(() => navigator.userAgent);
  check('Patreon and Google see desktop Chrome', /X11; Linux x86_64.*Chrome\/85/.test(ua), ua);

  await page.evaluate(() => new Promise((resolve) => Host.youtube({ id: 'aqz-KE-bpKQ' }, () => resolve('failed')) || setTimeout(resolve, 800)));
  await wait(300);
  check('opens YouTube videos in the TV\'s YouTube app', launched.some((l) => l[0] === 'com.samsung.tv.cobalt-yt' && l[1] === '#play?v=aqz-KE-bpKQ'), JSON.stringify(launched));

  pageLog.length = 0;
  await page.evaluate(() => Host.exit());
  await wait(2000);
  check('exit goes back to the start page, which closes the app', /index\.html#exit$/.test(page.url()) && pageLog.includes('__exit__'), page.url() + ' ' + pageLog.join(' '));

  await browser.close();
  await wait(500);
  st = await call('GET', '/status');
  check('notices when the app closes', !st.debugging, JSON.stringify(st));
  // A damaged download, or an update that needs a newer TV package, leaves the current app in place.
  updateFiles = { 'version.json': JSON.stringify({ version: '9.9.10', minHelper: '2.1.0', sha256: 'not-the-checksum' }), 'patreon-tv.js': updated };
  unit.checkUpdate(); await wait(800);
  st = await call('GET', '/status');
  check('ignores a damaged download and keeps the current app', st.app === '9.9.9' && /damaged/.test(st.updateError || ''), JSON.stringify(st));
  updateFiles['version.json'] = JSON.stringify({ version: '9.9.11', minHelper: '99.0.0', sha256: sha(updated) });
  unit.checkUpdate(); await wait(800);
  st = await call('GET', '/status');
  check('keeps the current app when an update needs the TV package reinstalled', st.app === '9.9.9' && /reinstalled/.test(st.updateError || ''), JSON.stringify(st));
  const log = await call('GET', '/log');
  check('keeps a log for troubleshooting', log.log.length > 3, log.log.slice(-3).join(' / '));

  helper.onExit(); patreon.close(); launcher.close(); dev.close(); sdb.close(); updates.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
