#!/usr/bin/env node
/*
 * Packs the app to run inside www.patreon.com (see tools/site/loader.js):
 *   app/site/patreon-tv.js        the script the on-TV helper loads into patreon.com (ships inside the .wgt)
 *   dist/chrome-extension/        the Chrome add-on for trying the app on a computer
 *   dist/patreon-tv-chrome.zip    the same add-on, zipped
 *   dist/update/                  version.json and patreon-tv.js, the update TVs download (UPDATE_URL in
 *                                 app/service/helper.js); publish by pushing them to update/ in the GitHub repo
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const version = JSON.parse(read('extension/manifest.json')).version;

// Oldest TV helper that can run this app code. Raise it when the app needs something only a newer helper does;
// TVs with an older helper then keep their current app until the TV package is reinstalled.
const MIN_HELPER = '2.2.0';

const VENDOR = ['app/vendor/qrcode.js', 'app/vendor/hls.min.js'];
const APP = ['app/js/util.js', 'app/js/focus.js', 'app/js/api.js', 'app/js/player.js', 'app/js/views.js', 'app/js/app.js'];

// Libraries run in their own function with no module system in sight, publishing their globals on window.
function vendor(file) {
  let src = read(file);
  if (/qrcode\.js$/.test(file)) src += '\n;window.qrcode = qrcode;';
  return `/* ${path.basename(file)} */\n(function (define, exports, module) {\n${src}\n}).call(window);`;
}

let loader = read('tools/site/loader.js');
const css = read('app/css/app.css');
const app = [`window.APP_VERSION = ${JSON.stringify(version)};`]
  .concat(VENDOR.map(vendor))
  .concat(APP.map((f) => `/* ${path.basename(f)} */\n${read(f)}`))
  .join('\n\n');
if (!loader.includes("/*__CSS__*/''") || !loader.includes('/*__APP__*/')) throw new Error('loader placeholders missing');
loader = loader.replace("/*__CSS__*/''", () => JSON.stringify(css)).replace('/*__APP__*/', () => app);

const siteDir = path.join(ROOT, 'app', 'site');
fs.mkdirSync(siteDir, { recursive: true });
fs.writeFileSync(path.join(siteDir, 'patreon-tv.js'), loader);

const ext = path.join(ROOT, 'dist', 'chrome-extension');
fs.rmSync(ext, { recursive: true, force: true });
fs.mkdirSync(ext, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'extension', 'manifest.json'), path.join(ext, 'manifest.json'));
fs.copyFileSync(path.join(ROOT, 'extension', 'background.js'), path.join(ext, 'background.js'));
fs.copyFileSync(path.join(ROOT, 'app', 'icon.png'), path.join(ext, 'icon.png'));
fs.writeFileSync(path.join(ext, 'patreon-tv.js'), loader);

const upd = path.join(ROOT, 'dist', 'update');
fs.mkdirSync(upd, { recursive: true });
fs.writeFileSync(path.join(upd, 'patreon-tv.js'), loader);
fs.writeFileSync(path.join(upd, 'version.json'), JSON.stringify({
  version, minHelper: MIN_HELPER, sha256: crypto.createHash('sha256').update(loader).digest('hex')
}, null, 2) + '\n');

const zip = path.join(ROOT, 'dist', 'patreon-tv-chrome.zip');
fs.rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: ext });
console.log(`Built app/site/patreon-tv.js (${Math.round(loader.length / 1024)} KB) and the Chrome add-on in dist/chrome-extension (v${version})`);
