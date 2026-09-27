/*
 * Patreon TV, packed to run inside a www.patreon.com page. Built by tools/build-site.js from app/ — edit those
 * files, not the built copy.
 *
 * On the TV the built-in helper (app/service/helper.js) adds this to every page the app window opens, with
 * window.PTV_TV set. On a computer the Chrome add-on adds it, and app mode is switched on per tab by opening
 * https://www.patreon.com/home#tv. Running as patreon.com means Patreon's own sign-in cookie, CSRF token and
 * Referer apply to everything the app loads, with nothing in between.
 */
(function () {
  // No 'use strict' here: the bundled libraries expect ordinary script mode. The app's own files are strict.
  var w = window, d = document;
  if (w !== w.top || w.__PTV_LOADED) return;

  var tv = !!w.PTV_TV;
  var on = tv || !!w.PTV_TEST_ON;
  try {
    if (location.hash === '#tv') { sessionStorage.setItem('ptv.on', '1'); history.replaceState(null, '', location.pathname + location.search); }
    on = on || sessionStorage.getItem('ptv.on') === '1';
  } catch (e) { /* storage blocked */ }
  if (!on) {
    // Adding #tv to a patreon.com page that is already open switches this tab to the app.
    w.addEventListener('hashchange', function () {
      if (location.hash !== '#tv') return;
      try { sessionStorage.setItem('ptv.on', '1'); } catch (e) { /* ignore */ }
      location.replace(location.pathname + location.search);
    });
    return;
  }

  var onPatreon = location.hostname === 'www.patreon.com' || (w.PTV_TEST_HOST && location.host === w.PTV_TEST_HOST);
  // Pages that stay Patreon's own: signing in and out, verification, and the bot check.
  var OWN = /^\/(login|signup|sign-up|auth|oauth2?|logout|forgot|reset|verify|confirm|two-factor|2fa|mfa|cdn-cgi|checkout|join|policy|legal)(\/|$|\?)/i;
  var passthrough = false;
  try { passthrough = sessionStorage.getItem('ptv.passthrough') === '1'; if (passthrough) sessionStorage.removeItem('ptv.passthrough'); } catch (e) { /* ignore */ }
  if (!onPatreon || OWN.test(location.pathname) || passthrough) {
    if (tv) remoteHelper();
    return;
  }

  w.__PTV_LOADED = true;
  w.PTV_SITE = true;
  takeOver();
  addStyle(/*__CSS__*/'');

  /*__APP__*/

  App.start();

  // Stops Patreon's own page from loading and gives the app a clean document on the same origin.
  // document.open() aborts Patreon's HTML before its scripts run, and close() finishes the (empty) new document,
  // so the browser starts rendering. (window.stop() alone leaves the page never painting.) No markup is written,
  // so the page's Content-Security-Policy and Trusted Types have nothing to object to.
  function takeOver() {
    var late = d.readyState !== 'loading';
    if (late) {
      // Loaded after the page's own scripts ran (older TVs): stop their timers too.
      var id = setTimeout(function () {}, 0);
      while (id > 0) { clearTimeout(id); clearInterval(id); id--; }
    }
    try { d.open(); d.close(); } catch (e) { try { w.stop(); } catch (e2) { /* ignore */ } }
    var html = d.documentElement;
    if (!html) { html = d.createElement('html'); d.appendChild(html); }
    while (html.attributes.length) html.removeAttribute(html.attributes[0].name);
    while (html.firstChild) html.removeChild(html.firstChild);
    html.setAttribute('lang', 'en');
    var head = d.createElement('head'), body = d.createElement('body');
    html.appendChild(head);
    html.appendChild(body);
    var meta = d.createElement('meta');
    meta.name = 'viewport';
    meta.content = tv ? 'width=1920, height=1080, user-scalable=no' : 'width=device-width, initial-scale=1';
    head.appendChild(meta);
    var title = d.createElement('title');
    title.textContent = 'Patreon TV';
    head.appendChild(title);
    ['shell', 'toast'].forEach(function (id2) {
      var div = d.createElement('div');
      div.id = id2;
      div.className = id2;
      body.appendChild(div);
    });
  }

  // Constructed stylesheets are not subject to the page's Content-Security-Policy; <style> is the fallback.
  function addStyle(css) {
    try {
      if ('adoptedStyleSheets' in d && typeof CSSStyleSheet === 'function') {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        d.adoptedStyleSheets = d.adoptedStyleSheets.concat([sheet]);
        return;
      }
    } catch (e) { /* fall back */ }
    var st = d.createElement('style');
    st.textContent = css;
    (d.head || d.documentElement).appendChild(st);
  }

  // On Patreon's and Google's sign-in pages: arrow keys move between fields and buttons, OK selects, Back goes back.
  function remoteHelper() {
    var cur = null;
    var SEL = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=option], [tabindex]:not([tabindex="-1"])';

    function visible(el) {
      if (el.disabled) return false;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      var cs = w.getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0;
    }
    function list() { return Array.prototype.filter.call(d.querySelectorAll(SEL), visible); }
    function set(el) {
      if (cur) cur.classList.remove('ptv-focus');
      cur = el;
      el.classList.add('ptv-focus');
      try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* ignore */ } }
      var r = el.getBoundingClientRect();
      if (r.top < 60 || r.bottom > w.innerHeight - 20) w.scrollBy(0, r.top - w.innerHeight / 2);
    }
    function move(dir) {
      var all = list();
      if (!cur || all.indexOf(cur) < 0) {
        var ae = d.activeElement;
        if (ae && all.indexOf(ae) >= 0) { set(ae); return; }
        if (all.length) set(all[0]);
        return;
      }
      var r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var best = null, bestScore = Infinity;
      all.forEach(function (el) {
        if (el === cur || el.contains(cur) || cur.contains(el)) return;
        var o = el.getBoundingClientRect(), ox = o.left + o.width / 2, oy = o.top + o.height / 2, p, sec;
        if (dir === 'left') { if (!(ox < r.left)) return; p = r.left - o.right; sec = Math.abs(oy - cy); }
        else if (dir === 'right') { if (!(ox > r.right)) return; p = o.left - r.right; sec = Math.abs(oy - cy); }
        else if (dir === 'up') { if (!(oy < r.top)) return; p = r.top - o.bottom; sec = Math.abs(ox - cx); }
        else { if (!(oy > r.bottom)) return; p = o.top - r.bottom; sec = Math.abs(ox - cx); }
        var score = Math.max(0, p) + sec * 2;
        if (score < bestScore) { bestScore = score; best = el; }
      });
      if (best) set(best);
    }
    function typing(el) {
      return el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(button|submit|checkbox|radio|reset|image)$/i.test(el.type)));
    }
    w.addEventListener('keydown', function (e) {
      var k = e.keyCode, ae = d.activeElement;
      var dir = k === 37 ? 'left' : k === 38 ? 'up' : k === 39 ? 'right' : k === 40 ? 'down' : null;
      if (dir) {
        // In a text field, left and right move the cursor; up and down leave the field.
        if (typing(ae) && (dir === 'left' || dir === 'right')) return;
        e.preventDefault(); e.stopPropagation();
        if (typing(ae)) ae.blur();
        move(dir);
      } else if (k === 13 && cur && !typing(ae)) {
        e.preventDefault(); e.stopPropagation();
        if (typing(cur)) cur.focus(); else cur.click();
      } else if (k === 10009 || k === 27) {
        e.preventDefault(); e.stopPropagation();
        if (typing(ae)) { ae.blur(); return; }
        if (history.length > 1) history.back();
        else location.href = 'https://www.patreon.com/home';
      }
    }, true);
    function ready() {
      var st = d.createElement('style');
      st.textContent = '.ptv-focus{outline:5px solid #ff424d!important;outline-offset:3px!important;border-radius:6px}' +
        '#ptv-bar{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:rgba(0,0,0,.85);color:#fff;' +
        'font:22px/1.4 Arial,sans-serif;padding:10px 26px;border-radius:30px;pointer-events:none}';
      (d.head || d.documentElement).appendChild(st);
      var bar = d.createElement('div');
      bar.id = 'ptv-bar';
      bar.textContent = 'Arrows move  ·  OK selects  ·  Back goes back';
      d.body.appendChild(bar);
      setTimeout(function () { if (!cur) move('down'); }, 800);
    }
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', ready); else ready();
  }
})();
