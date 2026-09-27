/* App shell: screen stack, sidebar, modals and the global key dispatcher. */
(function (global) {
  'use strict';
  var h = U.h;

  var App = {
    stack: [],
    user: null,
    main: null,
    sidebar: null,

    // ---------- screens ----------
    // A screen is { name, el, onKey(action) -> bool, onShow(), onHide(), onDestroy(), lastFocus, root }
    push: function (screen) {
      var top = App.top();
      if (top) { top.lastFocus = Focus.current; top.el.classList.add('hidden'); if (top.onHide) top.onHide(); }
      App.stack.push(screen);
      App.mount(screen);
    },
    replaceAll: function (screen) {
      App.stack.forEach(function (s) { if (s.onDestroy) s.onDestroy(); if (s.el.parentNode) s.el.parentNode.removeChild(s.el); });
      App.stack = [screen];
      App.mount(screen);
    },
    mount: function (screen) {
      var fullscreen = !!screen.fullscreen;
      document.body.classList.toggle('no-sidebar', fullscreen);
      App.sidebar.classList.toggle('hidden', fullscreen);
      if (!screen.el.parentNode) App.main.appendChild(screen.el);
      screen.el.classList.remove('hidden');
      App.markNav(screen.nav);
      Focus.setRoot(document.getElementById('shell'));
      if (screen.onShow) screen.onShow();
      screen.movesAtMount = Focus.moves;
      if (screen.lastFocus && document.body.contains(screen.lastFocus)) Focus.set(screen.lastFocus);
      else {
        var pref = screen.el.querySelector('[data-autofocus]') || screen.el.querySelector('.focusable');
        // While a screen is still loading, rest on its sidebar entry; content takes focus when it arrives.
        if (pref) Focus.set(pref);
        else Focus.set(App.sidebar.querySelector('.nav-item.active') || App.sidebar.querySelector('.nav-item'));
      }
    },
    // Called when a screen finishes loading: move focus to its content unless the user has already moved.
    focusInScreen: function (preferSelector) {
      var top = App.top();
      if (!top || App.modals.length) return;
      var untouched = Focus.moves === top.movesAtMount;
      var outside = !Focus.current || !document.body.contains(Focus.current) || !top.el.contains(Focus.current);
      if (!untouched && !(outside && !(Focus.current && Focus.current.closest('#sidebar')))) return;
      var pref = (preferSelector && top.el.querySelector(preferSelector)) || top.el.querySelector('[data-autofocus]') || top.el.querySelector('.focusable');
      if (pref && pref.offsetParent !== null) Focus.set(pref);
    },
    top: function () { return App.stack[App.stack.length - 1]; },
    back: function () {
      if (App.stack.length > 1) {
        var s = App.stack.pop();
        if (s.onDestroy) s.onDestroy();
        if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
        App.mount(App.top());
        return true;
      }
      var top = App.top();
      if (top && top.nav && top.nav !== 'home' && App.user) { App.go('home'); return true; }
      App.confirmExit();
      return true;
    },

    // Sidebar destinations are root screens.
    go: function (name) {
      var make = Views[name];
      if (!make) return;
      App.replaceAll(make());
    },

    markNav: function (nav) {
      Array.prototype.forEach.call(App.sidebar.querySelectorAll('.nav-item'), function (el) {
        el.classList.toggle('active', el.dataset.nav === nav);
      });
    },

    buildSidebar: function () {
      var items = [
        ['home', 'home', 'Home'], ['creators', 'star', 'Creators'], ['search', 'search', 'Search'], ['settings', 'gear', 'Settings']
      ];
      var sb = h('nav#sidebar.sidebar', { dataset: { navGroup: 'sidebar', remember: '1' } },
        h('div.brand', h('span.brand-mark', U.icon('play')), h('span.brand-name', U.appName())),
        items.map(function (it) {
          return h('div.nav-item.focusable', { dataset: { nav: it[0] }, onclick: function () { App.go(it[0]); } },
            h('span.nav-icon', U.icon(it[1])), h('span.nav-label', it[2]));
        }),
        h('div.nav-spacer'),
        h('div.nav-user', h('div.nav-avatar'), h('div.nav-username'))
      );
      return sb;
    },

    setUser: function (u) {
      App.user = u;
      var av = App.sidebar.querySelector('.nav-avatar');
      av.style.backgroundImage = u && u.avatar ? 'url("' + u.avatar + '")' : '';
      App.sidebar.querySelector('.nav-username').textContent = u ? u.name : '';
    },

    // ---------- modals ----------
    modals: [],
    modal: function (content, opts) {
      opts = opts || {};
      var prevFocus = Focus.current;
      var el = h('div.modal-backdrop', h('div.modal' + (opts.wide ? '.wide' : ''), content));
      document.body.appendChild(el);
      var m = {
        el: el, prevFocus: prevFocus, onKey: opts.onKey,
        close: function () {
          var i = App.modals.indexOf(m);
          if (i >= 0) App.modals.splice(i, 1);
          if (el.parentNode) el.parentNode.removeChild(el);
          Focus.setRoot(App.modals.length ? App.modals[App.modals.length - 1].el : document.getElementById('shell'));
          if (m.prevFocus && document.body.contains(m.prevFocus)) Focus.set(m.prevFocus); else Focus.ensure();
          if (opts.onClose) opts.onClose();
        }
      };
      App.modals.push(m);
      Focus.setRoot(el);
      Focus.first(opts.focus);
      return m;
    },

    confirm: function (title, body, yesLabel, onYes) {
      var m = App.modal([
        h('h2', title), body ? h('p.muted', body) : null,
        h('div.btn-row',
          h('div.btn.focusable', { onclick: function () { m.close(); onYes(); } }, yesLabel || 'Yes'),
          h('div.btn.secondary.focusable', { onclick: function () { m.close(); } }, 'Cancel'))
      ]);
      return m;
    },

    confirmExit: function () {
      App.confirm('Exit ' + U.appName() + '?', null, 'Exit', function () {
        Host.exit();
      });
    },

    // Shows a QR code so the user can finish something on their phone.
    qr: function (title, url, note) {
      var m = App.modal([
        h('h2', title),
        h('div.qr-wrap', U.qrSvg(url, 360), h('div.qr-side', note ? h('p', note) : null, h('p.url', url))),
        h('div.btn-row', h('div.btn.focusable', { onclick: function () { m.close(); } }, 'Done'))
      ], { wide: true });
      return m;
    },

    handleError: function (err, retry) {
      if (err instanceof Api.AuthError) {
        U.toast(err.message, 5000);
        App.replaceAll(Views.login());
        return null;
      }
      if (err instanceof Api.ChallengeError) { App.passChallenge(); return null; }
      return h('div.error-box',
        h('h3', 'Something went wrong'),
        h('p.muted', err && err.message ? err.message : String(err)),
        retry ? h('div.btn.focusable', { onclick: retry }, 'Try again') : null);
    },

    // ---------- keys ----------
    onKey: function (e) {
      var ae = document.activeElement;
      var typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      // Tizen IME: Done / Cancel.
      if (typing && (e.keyCode === 65376 || e.keyCode === 65385)) {
        ae.blur();
        if (e.keyCode === 65376 && ae.dataset.submit) { var s = document.getElementById(ae.dataset.submit); if (s) s.click(); }
        e.preventDefault();
        return;
      }
      var a = keyAction(e);
      if (typing) {
        if (a === 'back' || a === 'up' || a === 'down') { ae.blur(); if (a === 'back') { e.preventDefault(); return; } }
        else if (a === 'enter') { ae.blur(); if (ae.dataset.submit) { var b = document.getElementById(ae.dataset.submit); if (b) b.click(); } e.preventDefault(); return; }
        else return;
      }
      if (!a) return;
      e.preventDefault();
      App.dispatch(a);
    },

    // Runs one remote action (from a key, or from the on-screen buttons in a browser).
    dispatch: function (a) {
      if (App.modals.length) {
        var m = App.modals[App.modals.length - 1];
        if (m.onKey && m.onKey(a)) return;
        if (a === 'back') { m.close(); return; }
        App.nav(a);
        return;
      }
      if (Player.key(a)) return;
      var top = App.top();
      if (top && top.onKey && top.onKey(a)) return;
      if (a === 'back') { App.back(); return; }
      if (a === 'yellow' && Player.audio.post) { Player.audio.show(); return; }
      App.nav(a);
    },

    nav: function (a) {
      var cur = Focus.current;
      if (a === 'enter') {
        if (!cur) return;
        if (cur.tagName === 'INPUT' || cur.tagName === 'TEXTAREA') { cur.focus(); return; }
        cur.click();
        return;
      }
      if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
        // Long text blocks scroll before focus leaves them.
        if (cur && cur.dataset.scroll && (a === 'up' || a === 'down')) {
          var before = cur.scrollTop;
          cur.scrollTop += (a === 'down' ? 1 : -1) * cur.clientHeight * 0.6;
          if (cur.scrollTop !== before) return;
        }
        // A block taller than the screen (a long post) pages through before focus moves on.
        var page = cur && cur.closest('.scroll-y');
        if (page && (a === 'up' || a === 'down')) {
          var r = cur.getBoundingClientRect(), pr = page.getBoundingClientRect();
          var hiddenBelow = r.bottom > pr.bottom + 4, hiddenAbove = r.top < pr.top - 4;
          if ((a === 'down' && hiddenBelow) || (a === 'up' && hiddenAbove)) {
            page.scrollTop += (a === 'down' ? 1 : -1) * page.clientHeight * 0.6;
            return;
          }
        }
        if (!Focus.move(a) && cur && cur.dataset.scroll === undefined) {
          // Nothing further that way: nudge the page so the user sees the edge.
          var sc = cur.closest('.scroll-y');
          if (sc) sc.scrollTop += (a === 'down' ? 200 : a === 'up' ? -200 : 0);
        }
        return;
      }
      if ((a === 'play' || a === 'playpause') && cur && cur._post) {
        var p = cur._post;
        if (p.canView && Player.play(p, cur._queue ? cur._queue() : [p], cur._queue ? cur._queue().indexOf(p) : 0)) return;
      }
      if (a === 'next' || a === 'prev') {
        var sc2 = cur && cur.closest('.scroll-y');
        if (sc2) sc2.scrollTop += (a === 'next' ? -1 : 1) * sc2.clientHeight * 0.8;
      }
    },

    start: function () {
      registerTvKeys();
      var shell = document.getElementById('shell');
      App.sidebar = App.buildSidebar();
      App.main = h('main#main.main');
      shell.appendChild(App.sidebar);
      shell.appendChild(App.main);
      document.addEventListener('keydown', App.onKey, true);
      document.addEventListener('tvfocus', function (e) { App.sidebar.classList.toggle('focus-in', App.sidebar.contains(e.target)); });
      // Mouse / Smart Remote pointer support.
      // Only follow the pointer after it really moves, so content appearing under a resting cursor does not steal focus.
      var lastMove = 0;
      document.addEventListener('mousemove', function () { lastMove = Date.now(); });
      document.addEventListener('mouseover', function (e) {
        if (Date.now() - lastMove > 300) return;
        var f = e.target.closest && e.target.closest('.focusable');
        if (f && f !== Focus.current && (!App.modals.length || App.modals[App.modals.length - 1].el.contains(f))) Focus.set(f);
      });
      Player.onClose = function () { Focus.ensure(); };
      document.addEventListener('visibilitychange', function () {
        if (document.hidden && Player.active === 'video') Player.key('pause');
      });

      App.web = !Host.tv();
      if (App.web) App.setupWeb();
      if (global.PTV_DEMO) App.setupDemo();
      else if (!global.PTV_SITE) {
        // The TV's own page: it starts the on-TV helper, which reopens the app inside patreon.com.
        App.replaceAll(Views.launcher());
        return;
      }

      // Inside patreon.com (or the sample-data preview): Patreon's own sign-in decides what to show.
      App.replaceAll(Views.splash());
      Api.currentUser().then(function (u) {
        App.setUser(u);
        Store.set('user', u);
        App.go('home');
      }).catch(function (err) {
        if (err instanceof Api.AuthError) { App.replaceAll(Views.login()); return; }
        if (err instanceof Api.ChallengeError) { App.passChallenge(); return; }
        // Offline: keep the cached identity and let screens show their own errors.
        var cached = Store.get('user', null);
        if (cached) { App.setUser(cached); App.go('home'); U.toast(err.message, 5000); }
        else App.replaceAll(Views.login(err.message));
      });
    }
  };

  // Patreon's bot check answered instead of the API. Show Patreon's page once so the check can run; the app comes
  // back by itself when that page reloads. Three tries at most, so a check that never passes can't loop forever.
  App.passChallenge = function () {
    var tries = [];
    try { tries = JSON.parse(sessionStorage.getItem('ptv.challenges') || '[]').filter(function (t) { return Date.now() - t < 300000; }); } catch (e) { /* ignore */ }
    if (tries.length >= 3) {
      App.replaceAll(Views.login('Patreon keeps asking to check this browser. Open patreon.com on your phone to make sure your account is fine, then try again.'));
      return;
    }
    tries.push(Date.now());
    try {
      sessionStorage.setItem('ptv.challenges', JSON.stringify(tries));
      sessionStorage.setItem('ptv.passthrough', '1');
    } catch (e) { /* ignore */ }
    App.replaceAll(Views.splash('Patreon is checking this browser. Follow any steps it shows.'));
    setTimeout(function () { location.reload(); }, 1500);
  };

  // ---------- running in a normal browser (testing without a TV) ----------

  App.setupWeb = function () {
    var root = document.documentElement;
    root.classList.add('web');
    // The app is laid out for a 1920x1080 TV; scale the whole canvas to the window.
    function fit() {
      var w = window.innerWidth, hgt = window.innerHeight;
      var z = w < hgt ? w / 1920 : Math.min(w / 1920, hgt / 1080);
      root.style.zoom = z;
      root.classList.toggle('portrait', w < hgt);
    }
    fit();
    window.addEventListener('resize', fit);

    function btn(icons, label, action, title) {
      return h('button.webbar-btn', { type: 'button', title: title, onclick: function (e) { e.stopPropagation(); App.dispatch(action); } },
        icons.map(function (i) { return U.icon(i); }), label ? ' ' + label : null);
    }
    document.body.appendChild(h('div#webbar.webbar',
      btn(['back'], 'Back', 'back', 'Back (Esc)'),
      btn(['play', 'pause'], '', 'playpause', 'Play or pause (Space)'),
      h('span.webbar-hint', 'Arrow keys, Enter and Esc work like the TV remote. You can also click and scroll.'),
      global.PTV_DEMO ? h('span.webbar-tag', 'Unofficial preview · sample data') : null));
    setTimeout(function () { var hint = document.querySelector('.webbar-hint'); if (hint) hint.classList.add('gone'); }, 12000);

    // Over a playing video the bar only shows while the mouse moves, or when pointed at.
    var still;
    function moved() {
      root.classList.add('mouse');
      clearTimeout(still);
      still = setTimeout(function () { root.classList.remove('mouse'); }, 2500);
    }
    document.addEventListener('mousemove', moved);

    // Clicking the video toggles play, like OK on the remote.
    document.addEventListener('click', function (e) {
      if (e.target.closest && (e.target.closest('#player') || e.target.closest('.audio-art'))) Player.key('enter');
    });
  };

  App.setupDemo = function () {
    Store.saveSettings({ mode: 'demo' });
    Store.set('signedIn', true);
    var wavUrl = URL.createObjectURL(new Blob([PatreonMock.wav()], { type: 'audio/wav' }));
    var videoUrl = new URL('mock-media/video.webm', location.href).href;
    PatreonMock.configure({
      img: function (seed, w, hgt) { return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(PatreonMock.svg(seed, w, hgt)); },
      video: function () { return videoUrl; },
      audio: function () { return wavUrl; }
    });
  };

  global.App = App;
  // Inside patreon.com the loader builds the page and starts the app itself.
  if (!global.PTV_SITE) document.addEventListener('DOMContentLoaded', App.start);
})(window);
