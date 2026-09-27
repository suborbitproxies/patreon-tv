/*
 * Patreon TV helper: a small background service that ships inside the TV app and runs on the TV itself.
 *
 * A TV app on its own can't use Patreon: the TV won't send Patreon's sign-in cookie with the app's requests, and
 * Patreon's video host only serves pages on patreon.com. So the app runs *inside* a www.patreon.com page instead,
 * the way TizenBrew runs its modules:
 *   1. The app's start page (index.html) starts this service and asks it to relaunch the app.
 *   2. The service asks the TV's own developer bridge (sdbd, 127.0.0.1:26101, available when Developer Mode's
 *      Host PC IP is 127.0.0.1) to start the app with its debugger on, and connects to that debugger.
 *   3. Through the debugger it adds site/patreon-tv.js to every page the app window opens, opens
 *      https://www.patreon.com/home, and presents the engine as desktop Chrome so Google allows sign-in.
 *   4. The app, now running as patreon.com, asks this service for the things only the TV can do (exit, open the
 *      YouTube app) by logging '__ptvhost__{...}' to the console.
 * The start page talks to the service over http://127.0.0.1:8617 (/status, /relaunch, /log).
 *
 * Updates: before each start the service checks UPDATE_URL (the project's own GitHub repo) for newer app code,
 * version.json and patreon-tv.js as written to dist/update by tools/build-site.js, and loads that instead of the
 * copy in this package when its checksum matches. Only this service and the start page need a reinstall to change.
 *
 * Written for the TV's Node.js, which is v4 on 2017 sets: plain ES5, no dependencies.
 */
'use strict';
var http = require('http');
var net = require('net');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var VERSION = '2.2.0';
var PORT = +(process.env.PTV_HELPER_PORT || 8617);
var ENTRY = process.env.PTV_ENTRY || 'https://www.patreon.com/home';
var DEV_API = process.env.PTV_DEV_API || 'http://127.0.0.1:8001/api/v2/';
var SDB_PORT = +(process.env.PTV_SDB_PORT || 26101);
var BUNDLE = path.join(__dirname, '..', 'site', 'patreon-tv.js');
var UPDATE_URL = process.env.PTV_UPDATE_URL !== undefined ? process.env.PTV_UPDATE_URL :
  'https://raw.githubusercontent.com/suborbitproxies/patreon-tv/main/update/';

var state = { debugging: false, connecting: false, error: null, launcherUrl: null, updateError: null };
var cdp = null;
var server = null;
var logs = [];

function log(msg) {
  logs.push(new Date().toISOString().slice(11, 19) + ' ' + msg);
  if (logs.length > 80) logs.shift();
  try { console.log('[patreon-tv] ' + msg); } catch (e) { /* no console */ }
}

function alloc(n) { return Buffer.alloc ? Buffer.alloc(n) : new Buffer(n).fill(0); }
function bytes(s) { return Buffer.from && Buffer.from !== Uint8Array.from ? Buffer.from(s, 'utf8') : new Buffer(s, 'utf8'); }

function tz() { return global.tizen; }
function packageId() { return tz().application.getAppInfo().packageId; }
function uiAppId() { return packageId() + '.PatreonTV'; }
function isTizen3() {
  try { return String(tz().systeminfo.getCapability('http://tizen.org/feature/platform.version')).indexOf('3.0') === 0; } catch (e) { return false; }
}

// ---------- app updates ----------

var bundled = null; // the app code in this package
var latest = null; // newer app code from UPDATE_URL
var updating = null; // callbacks waiting for the check in progress

function packaged() {
  if (!bundled) {
    var src = fs.readFileSync(BUNDLE, 'utf8');
    var m = /window\.APP_VERSION = "([^"]+)"/.exec(src);
    bundled = { version: m ? m[1] : VERSION, source: src };
  }
  return bundled;
}
function appCode() { return latest || packaged(); }

// True when version a is newer than b ("2.10.0" > "2.9.1").
function newer(a, b) {
  a = String(a || '0').split('.'); b = String(b || '0').split('.');
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    var x = +a[i] || 0, y = +b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function download(url, timeout, cb) {
  var done = false, req;
  function finish(err, buf) { if (!done) { done = true; cb(err, buf); } }
  try {
    req = require(/^https:/.test(url) ? 'https' : 'http').get(url, function (res) {
      if (res.statusCode !== 200) { res.resume(); return finish(new Error('HTTP ' + res.statusCode + ' for ' + url.split('?')[0])); }
      var parts = [], size = 0;
      res.on('data', function (c) { parts.push(c); size += c.length; if (size > 20e6) { req.abort(); finish(new Error('Download too large')); } });
      res.on('end', function () { finish(null, Buffer.concat(parts)); });
    });
  } catch (e) { return finish(e); }
  req.on('error', finish);
  req.setTimeout(timeout, function () { req.abort(); finish(new Error('Timed out fetching ' + url.split('?')[0])); });
}

// Looks for newer app code. On any problem the current code is used, so a bad network never stops the app.
function checkUpdate() {
  if (!UPDATE_URL || updating) return;
  updating = [];
  function done(err) {
    if (err) { state.updateError = err.message; log('update: ' + err.message); }
    var waiting = updating; updating = null;
    waiting.forEach(function (f) { f(); });
  }
  download(UPDATE_URL + 'version.json?t=' + Date.now(), 8000, function (err, buf) {
    if (err) return done(err);
    var v;
    try { v = JSON.parse(buf.toString('utf8')); } catch (e) { return done(new Error('Bad version.json')); }
    state.updateError = null;
    if (!newer(v.version, appCode().version)) return done();
    if (newer(v.minHelper, VERSION)) return done(new Error('App ' + v.version + ' needs the TV package reinstalled (helper ' + v.minHelper + ')'));
    log('downloading app ' + v.version);
    download(UPDATE_URL + 'patreon-tv.js?v=' + encodeURIComponent(v.version), 30000, function (err2, code) {
      if (err2) return done(err2);
      if (crypto.createHash('sha256').update(code).digest('hex') !== v.sha256) return done(new Error('Download of app ' + v.version + ' was damaged'));
      latest = { version: v.version, source: code.toString('utf8') };
      log('app updated to ' + v.version);
      done();
    });
  });
}

// Runs cb once the update check in progress (if any) has finished, or after ms at most.
function afterUpdate(ms, cb) {
  var called = false;
  function once() { if (!called) { called = true; cb(); } }
  if (!updating) return once();
  updating.push(once);
  setTimeout(once, ms);
}

function getJson(url, timeout, cb) {
  var done = false;
  function finish(err, j) { if (!done) { done = true; cb(err, j); } }
  var req = http.get(url, function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      try { finish(null, JSON.parse(body)); } catch (e) { finish(new Error('Bad JSON from ' + url)); }
    });
  });
  req.on('error', function (e) { finish(e); });
  req.setTimeout(timeout || 3000, function () { req.abort(); finish(new Error('Timed out: ' + url)); });
}

// Developer Mode must be on with Host PC IP 127.0.0.1 for the TV's sdbd to accept this service.
function devMode(cb) {
  getJson(DEV_API, 3000, function (err, j) {
    if (err || !j || !j.device) return cb({ ok: null, ip: null, tvIp: null, error: err ? err.message : 'no device info' });
    var d = j.device;
    var ok = String(d.developerMode) === '1' && (d.developerIP === '127.0.0.1' || d.developerIP === '1.0.0.127');
    cb({ ok: ok, ip: d.developerIP || null, tvIp: d.ip || null });
  });
}

// ---------------- sdb (the TV's debug bridge; same wire protocol as adb) ----------------

var CMD = {};
['CNXN', 'OPEN', 'OKAY', 'WRTE', 'CLSE', 'AUTH'].forEach(function (c) { CMD[c] = bytes(c).readUInt32LE(0); });

function packet(cmd, a0, a1, data) {
  var payload = typeof data === 'string' ? bytes(data + '\0') : (data || alloc(0));
  var sum = 0;
  for (var i = 0; i < payload.length; i++) sum = (sum + payload[i]) >>> 0;
  var h = alloc(24);
  h.writeUInt32LE(cmd, 0); h.writeUInt32LE(a0 >>> 0, 4); h.writeUInt32LE(a1 >>> 0, 8);
  h.writeUInt32LE(payload.length, 12); h.writeUInt32LE(sum, 16); h.writeUInt32LE((cmd ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, payload]);
}

// Runs one shell command through sdbd and calls back with its output once `until` matches it (or it ends).
function sdbShell(command, until, cb) {
  var sock = net.connect(SDB_PORT, '127.0.0.1');
  var buf = alloc(0), out = '', local = 1, remote = 0, done = false;
  var timer = setTimeout(function () { finish(new Error('sdb did not answer')); }, 15000);
  function finish(err) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    setTimeout(function () { sock.destroy(); }, 1000);
    cb(err, out);
  }
  sock.on('connect', function () { sock.write(packet(CMD.CNXN, 0x01000000, 4096, 'host::')); });
  sock.on('error', function (e) { finish(new Error('sdb: ' + e.message)); });
  sock.on('close', function () { finish(out ? null : new Error('sdb closed the connection')); });
  sock.on('data', function (d) {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 24) {
      var cmd = buf.readUInt32LE(0), a0 = buf.readUInt32LE(4), len = buf.readUInt32LE(12);
      if (buf.length < 24 + len) return;
      var data = buf.slice(24, 24 + len);
      buf = buf.slice(24 + len);
      if (cmd === CMD.CNXN) sock.write(packet(CMD.OPEN, local, 0, 'shell:' + command));
      else if (cmd === CMD.OKAY) remote = a0;
      else if (cmd === CMD.WRTE) {
        remote = a0;
        out += data.toString('utf8');
        sock.write(packet(CMD.OKAY, local, remote));
        if (until.test(out)) finish(null);
      } else if (cmd === CMD.CLSE) finish(null);
      else if (cmd === CMD.AUTH) finish(new Error('sdb wants authorisation; check Developer Mode'));
    }
  });
}

function debugPort(out) {
  var m = /port\s*:?\s*(\d{2,5})/i.exec(out);
  if (m) return +m[1];
  // Older firmware: "... debug ... : 12345" (the format TizenBrew reads).
  var i = out.indexOf(':');
  var n = i >= 0 ? parseInt(out.substr(i + 1, 7).replace(/\s/g, ''), 10) : NaN;
  return n > 0 ? n : null;
}

// ---------------- a minimal WebSocket client, for the debugger ----------------

function WebSocketClient(url, onOpen, onError) {
  var self = this;
  var m = /^ws:\/\/([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
  if (!m) { onError(new Error('Bad debugger URL ' + url)); return; }
  this.onmessage = null;
  this.onclose = null;
  this.socket = null;
  var req = http.request({
    host: m[1], port: +(m[2] || 80), path: m[3] || '/',
    headers: { 'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64') }
  });
  req.on('upgrade', function (res, socket, head) {
    self.socket = socket;
    var buf = head && head.length ? head : alloc(0), parts = [];
    socket.on('data', function (d) {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        var fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80, len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(2) * 4294967296 + buf.readUInt32BE(6); off = 10; }
        var mask = null;
        if (masked) { if (buf.length < off + 4) return; mask = buf.slice(off, off + 4); off += 4; }
        if (buf.length < off + len) return;
        var payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (mask) for (var i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        if (op === 0x8) { socket.end(); return; }
        if (op === 0x9) { self.frame(0xA, payload); continue; }
        if (op === 0xA) continue;
        parts.push(payload);
        if (fin) {
          var text = Buffer.concat(parts).toString('utf8');
          parts = [];
          if (self.onmessage) self.onmessage(text);
        }
      }
    });
    socket.on('close', function () { if (self.onclose) self.onclose(); });
    socket.on('error', function () { /* close follows */ });
    onOpen(self);
  });
  req.on('response', function (res) { onError(new Error('Debugger refused the connection (HTTP ' + res.statusCode + ')')); });
  req.on('error', onError);
  req.end();
}
WebSocketClient.prototype.frame = function (op, data) {
  var len = data.length, hdr;
  if (len < 126) { hdr = alloc(2); hdr[1] = 0x80 | len; }
  else if (len < 65536) { hdr = alloc(4); hdr[1] = 0x80 | 126; hdr.writeUInt16BE(len, 2); }
  else { hdr = alloc(10); hdr[1] = 0x80 | 127; hdr.writeUInt32BE(Math.floor(len / 4294967296), 2); hdr.writeUInt32BE(len % 4294967296, 6); }
  hdr[0] = 0x80 | op;
  var mask = crypto.randomBytes(4), body = alloc(len);
  for (var i = 0; i < len; i++) body[i] = data[i] ^ mask[i & 3];
  this.socket.write(Buffer.concat([hdr, mask, body]));
};
WebSocketClient.prototype.send = function (text) { this.frame(0x1, bytes(text)); };
WebSocketClient.prototype.close = function () { try { this.socket.end(); } catch (e) { /* ignore */ } };

// ---------------- Chrome DevTools Protocol ----------------

function Debugger(ws) {
  var self = this;
  this.ws = ws;
  this.seq = 0;
  this.waiting = {};
  this.handlers = {};
  ws.onmessage = function (text) {
    var j;
    try { j = JSON.parse(text); } catch (e) { return; }
    if (j.id && self.waiting[j.id]) {
      var cb = self.waiting[j.id];
      delete self.waiting[j.id];
      cb(j.error ? new Error(j.error.message) : null, j.result || {});
    } else if (j.method && self.handlers[j.method]) self.handlers[j.method](j.params || {});
  };
}
Debugger.prototype.send = function (method, params) {
  var self = this;
  return new Promise(function (resolve, reject) {
    var id = ++self.seq;
    self.waiting[id] = function (err, result) { if (err) reject(err); else resolve(result); };
    self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
  });
};
Debugger.prototype.on = function (event, fn) { this.handlers[event] = fn; };
function quiet(p) { return p.then(null, function (e) { log('(ignored) ' + e.message); return null; }); }

// Picks the app's own page from the debugger's target list.
function pickTarget(list, host, port) {
  var pages = (list || []).filter(function (t) { return t.type === 'page' && (t.webSocketDebuggerUrl || t.devtoolsFrontendUrl); });
  var own = pages.filter(function (t) { return /^(file|app):/.test(t.url || ''); })[0];
  var t = own || pages.filter(function (p) { return p.url && p.url !== 'about:blank'; })[0] || pages[0];
  if (!t) return null;
  var ws = t.webSocketDebuggerUrl;
  if (!ws) { var m = /ws=([^&]+)/.exec(t.devtoolsFrontendUrl); ws = m ? 'ws://' + decodeURIComponent(m[1]) : null; }
  if (!ws) return null;
  // Use the address we actually reached, whatever the debugger calls itself.
  ws = ws.replace(/^ws:\/\/[^/]+/, 'ws://' + host + ':' + port);
  return { url: t.url, ws: ws };
}

function connectDebugger(hosts, port, attempt) {
  var host = hosts[attempt % hosts.length];
  getJson('http://' + host + ':' + port + '/json/list', 2000, function (err, list) {
    var target = !err && pickTarget(list, host, port);
    if (!target) {
      if (attempt >= 40) return fail('Could not reach the app\'s debugger on port ' + port + (err ? ' (' + err.message + ')' : ''));
      return setTimeout(function () { connectDebugger(hosts, port, attempt + 1); }, 600);
    }
    new WebSocketClient(target.ws, function (ws) {
      log('debugger connected at ' + host + ':' + port);
      setup(new Debugger(ws), target);
    }, function (e) {
      if (attempt >= 40) return fail('Debugger connection failed: ' + e.message);
      setTimeout(function () { connectDebugger(hosts, port, attempt + 1); }, 600);
    });
  });
}

// Google blocks sign-in from embedded browsers, which it recognises by the TV's user agent. Desktop Chrome's
// user agent with the engine's own version gets the normal sign-in page.
function chromeUserAgent(ua) {
  if (/Chrome\/\d/.test(ua) && !/SMART-TV|Tizen|SmartTV|Web0S/i.test(ua)) return null;
  var m = /(\d{2,3})\.\d+\.\d+\.\d+/.exec(ua);
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + (m ? m[1] : '108') + '.0.0.0 Safari/537.36';
}

function setup(dbg, target) {
  cdp = dbg;
  state.launcherUrl = target.url;
  var fallback = false, source = '';
  var prelude = 'window.PTV_TV = true;' + (process.env.PTV_TEST_HOST ? ' window.PTV_TEST_HOST = ' + JSON.stringify(process.env.PTV_TEST_HOST) + ';' : '');
  dbg.ws.onclose = function () {
    if (cdp === dbg) cdp = null;
    state.debugging = false;
    state.connecting = false;
    log('debugger disconnected');
  };
  dbg.on('Runtime.consoleAPICalled', function (p) {
    var a = p.args && p.args[0];
    if (a && typeof a.value === 'string' && a.value.indexOf('__ptvhost__') === 0) {
      try { hostCommand(JSON.parse(a.value.slice(11))); } catch (e) { log('bad host message: ' + e.message); }
    }
  });
  // Very old engines can't add a script to new pages; evaluate it in each new page instead (it checks the page).
  dbg.on('Runtime.executionContextCreated', function (p) {
    var ctx = p.context || {};
    if (fallback && (!ctx.auxData || ctx.auxData.isDefault !== false)) quiet(dbg.send('Runtime.evaluate', { expression: source, contextId: ctx.id }));
  });

  new Promise(function (resolve) { afterUpdate(10000, resolve); })
    .then(function () {
      var code = appCode();
      log('loading app ' + code.version);
      source = prelude + '\n' + code.source;
      return quiet(dbg.send('Runtime.enable'));
    })
    .then(function () { return quiet(dbg.send('Page.enable')); })
    .then(function () { return quiet(dbg.send('Page.setBypassCSP', { enabled: true })); })
    .then(function () { return quiet(dbg.send('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true })); })
    .then(function (r) {
      var ua = r && r.result && r.result.value;
      var chrome = ua && chromeUserAgent(ua);
      if (!chrome) return null;
      log('user agent ' + ua + ' -> ' + chrome);
      return quiet(dbg.send('Network.setUserAgentOverride', { userAgent: chrome }));
    })
    .then(function () {
      return dbg.send('Page.addScriptToEvaluateOnNewDocument', { source: source }).then(null, function () {
        return dbg.send('Page.addScriptToEvaluateOnLoad', { scriptSource: source });
      }).then(null, function () { fallback = true; log('using per-page evaluation'); });
    })
    .then(function () { return dbg.send('Page.navigate', { url: ENTRY }); })
    .then(function () {
      state.debugging = true;
      state.connecting = false;
      state.error = null;
      log('opened ' + ENTRY);
    }, function (e) { fail('Could not open Patreon: ' + e.message); });
}

// Things the app asks for from inside patreon.com, where it has no Tizen APIs.
function hostCommand(msg) {
  function reply(r) {
    if (!cdp || msg.id === undefined) return;
    r.id = msg.id;
    quiet(cdp.send('Runtime.evaluate', { expression: 'window.__ptvHostReply && window.__ptvHostReply(' + JSON.stringify(r) + ')' }));
  }
  if (msg.cmd === 'exit') {
    // The start page closes the app when opened with #exit.
    if (cdp && state.launcherUrl) quiet(cdp.send('Page.navigate', { url: state.launcherUrl.split('#')[0] + '#exit' }));
  } else if (msg.cmd === 'youtube') {
    launchYouTube(String(msg.video || ''), function () { reply({ ok: true }); }, function (e) { reply({ ok: false, error: e.message }); });
  }
}

// The YouTube app's id and deep-link format changed over the years; try the current one first.
var YOUTUBE_APPS = [['com.samsung.tv.cobalt-yt', '#play?v='], ['9Ur5IzDKqV.TizenYouTube', '#play?v='], ['111299001912', 'v=']];
function launchYouTube(id, ok, fail2, i) {
  i = i || 0;
  if (!/^[\w-]{11}$/.test(id)) return fail2(new Error('Bad video id'));
  if (i >= YOUTUBE_APPS.length) return fail2(new Error('YouTube app not found'));
  try {
    var T = tz();
    var data = new T.ApplicationControlData('PAYLOAD', [YOUTUBE_APPS[i][1] + id]);
    var ctl = new T.ApplicationControl('http://tizen.org/appcontrol/operation/view', null, null, null, [data]);
    T.application.launchAppControl(ctl, YOUTUBE_APPS[i][0], ok, function () { launchYouTube(id, ok, fail2, i + 1); });
  } catch (e) { launchYouTube(id, ok, fail2, i + 1); }
}

function fail(msg) {
  log(msg);
  state.error = msg;
  state.connecting = false;
}

// Waits for the app to finish closing (it exits right after asking for the relaunch), then starts it with the
// debugger through sdbd and connects.
function relaunch() {
  if (state.connecting) return;
  state.connecting = true;
  state.error = null;
  checkUpdate();
  devMode(function (dm) {
    if (!dm.ok) return fail(dm.ok === false ? 'Developer Mode Host PC IP is ' + dm.ip + ', not 127.0.0.1' : 'Could not read Developer Mode settings (' + dm.error + ')');
    var app = uiAppId(), started = Date.now();
    (function waitForExit() {
      tz().application.getAppsContext(function (ctxs) {
        var running = ctxs.some(function (c) { return c.appId === app; });
        if ((running && Date.now() - started < 8000) || Date.now() - started < 400) return setTimeout(waitForExit, 150);
        log('starting ' + app + ' with the debugger');
        sdbShell('0 debug ' + app + (isTizen3() ? ' 0' : ''), /port\s*:?\s*\d+|debug[^\n]*:\s*\d+/i, function (err, out) {
          if (err) return fail(err.message);
          var port = debugPort(out);
          if (!port) return fail('The TV did not report a debugger port: ' + out.slice(0, 200));
          log('debugger port ' + port);
          var hosts = dm.tvIp && dm.tvIp !== '127.0.0.1' ? [dm.tvIp, '127.0.0.1'] : ['127.0.0.1'];
          connectDebugger(hosts, port, 0);
        });
      }, function (e) { fail('Could not list running apps: ' + e.message); });
    })();
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function start() {
  if (server) return;
  server = http.createServer(function (req, res) {
    var url = req.url.split('?')[0];
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST' });
      return res.end();
    }
    if (url === '/status') {
      return devMode(function (dm) {
        json(res, 200, { version: VERSION, app: appCode().version, devMode: dm.ok, developerIP: dm.ip, debugging: state.debugging,
          connecting: state.connecting, error: state.error, updating: !!updating, updateError: state.updateError });
      });
    }
    if (url === '/relaunch' && req.method === 'POST') { relaunch(); return json(res, 202, { ok: true }); }
    if (url === '/log') return json(res, 200, { log: logs });
    json(res, 404, { error: 'Not found' });
  });
  server.on('error', function (e) { log('server: ' + e.message); });
  server.listen(PORT, '127.0.0.1', function () { log('helper ' + VERSION + ' listening on 127.0.0.1:' + PORT); });
}

// Tizen calls these; starting at load too keeps newer firmware, which may skip onStart, working.
module.exports.onStart = start;
module.exports.onRequest = start;
module.exports.onExit = function () { if (server) server.close(); server = null; };
module.exports._test = { state: state, chromeUserAgent: chromeUserAgent, debugPort: debugPort, logs: logs, newer: newer, checkUpdate: checkUpdate };
start();
