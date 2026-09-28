/*
 * A stand-in for www.patreon.com, for tests: Patreon-shaped pages and API answers from tools/mock/mock.js,
 * guarded the way the real site is (sign-in cookie, CSRF signature on changes, Referer on video).
 * The page at /home runs a script that must never execute once the app has taken the page over.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const mock = require('../tools/mock/mock.js');

const SESSION = 'test-session', CSRF = 'csrf-abc';

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(/;\s*/).forEach((c) => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i)] = c.slice(i + 1); });
  return out;
}
function send(res, status, type, body, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}
function sendBuffer(req, res, buf, type) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (!m) return send(res, 200, type, buf, { 'Accept-Ranges': 'bytes', 'Content-Length': buf.length });
  const start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : buf.length - 1;
  res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
  res.end(buf.slice(start, end + 1));
}

function start(port, opts) {
  opts = opts || {};
  const state = { apiCalls: [], mutations: [], mediaReferers: [], challengeOnce: false };
  if (opts.posts || opts.pageSize) mock.configure({ posts: opts.posts, pageSize: opts.pageSize });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const signedIn = cookies(req).session_id === SESSION;
    const origin = `http://${req.headers.host}`;
    mock.configure({ img: (s, w, h) => `${origin}/mock/img/${s}.svg?w=${w}&h=${h}`, video: () => origin + '/mock/video.webm', audio: () => origin + '/mock/audio.wav' });

    if (p.startsWith('/api/')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        state.apiCalls.push(req.method + ' ' + p);
        if (state.challengeOnce) {
          state.challengeOnce = false;
          return send(res, 403, 'text/html', page('Just a moment...', '<div id="challenge-form">cf-chl checking your browser</div><script>setTimeout(function(){location.reload()},300)</script>'));
        }
        if (!signedIn) return send(res, 401, 'application/json', JSON.stringify({ errors: [{ code_name: 'Unauthorized', detail: 'You must be logged in' }] }));
        if (req.method !== 'GET') {
          state.mutations.push({ path: p, csrf: req.headers['x-csrf-signature'] || null });
          if (req.headers['x-csrf-signature'] !== CSRF) return send(res, 403, 'application/json', JSON.stringify({ errors: [{ detail: 'CSRF signature missing' }] }));
        }
        const r = mock.handle(req.method, req.url, body);
        send(res, r.status, 'application/vnd.api+json', r.body === undefined ? '' : JSON.stringify(r.body));
      });
      return;
    }
    if (p.startsWith('/mock/')) {
      let m;
      if ((m = p.match(/^\/mock\/img\/([\w-]+)\.svg$/))) return send(res, 200, 'image/svg+xml', mock.svg(m[1], +(u.searchParams.get('w') || 640), +(u.searchParams.get('h') || 360)));
      if (p === '/mock/audio.wav') return sendBuffer(req, res, Buffer.from(mock.wav()), 'audio/wav');
      if (p === '/mock/video.webm') {
        // Like Mux for Patreon: video needs patreon.com's Referer.
        state.mediaReferers.push(req.headers.referer || null);
        if (!req.headers.referer || !req.headers.referer.startsWith(origin)) return send(res, 403, 'text/plain', 'Referer required');
        return sendBuffer(req, res, fs.readFileSync(path.join(__dirname, '..', 'tools', 'mock', 'video.webm')), 'video/webm');
      }
    }
    if (p === '/login') {
      const ru = u.searchParams.get('ru') || '/home';
      return send(res, 200, 'text/html', page('Log in | Patreon',
        `<script>window.patreon = { bootstrap: {}, "csrfSignature": "${CSRF}" };</script>` +
        '<style>a,input,button{display:block;margin:14px;font-size:20px}</style>' +
        '<h1>Log in</h1><a id="google" href="/auth/google">Continue with Google</a>' +
        `<form method="post" action="/login-form?ru=${encodeURIComponent(ru)}"><input id="email" name="email" type="email" placeholder="Email">` +
        '<input id="password" name="password" type="password" placeholder="Password"><button id="submit" type="submit">Continue</button></form>'));
    }
    if (p === '/login-form' && req.method === 'POST') {
      req.resume();
      return send(res, 302, 'text/plain', '', { Location: u.searchParams.get('ru') || '/home', 'Set-Cookie': `session_id=${SESSION}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (p === '/logout') return send(res, 302, 'text/plain', '', { Location: u.searchParams.get('ru') || '/home', 'Set-Cookie': 'session_id=; Path=/; Max-Age=0' });
    if (p === '/favicon.ico') return send(res, 404, 'text/plain', '');
    // Any other page: Patreon's own React site, which the app must stop before it runs.
    send(res, 200, 'text/html', page('Patreon', '<div id="renderPageContentWrapper">Patreon website</div>' +
      '<script>window.PATREON_PAGE_RAN = true; document.title = "Patreon page ran";</script>'));
  });
  server.listen(port);
  server.state = state;
  server.login = () => SESSION;
  return server;
}

module.exports = { start, SESSION, CSRF };
