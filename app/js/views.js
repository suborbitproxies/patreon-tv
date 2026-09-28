/* Every screen of the app. Each factory returns a screen object for App.push / App.replaceAll. */
(function (global) {
  'use strict';
  var h = U.h;
  var seq = 0;

  function screen(name, nav, el, extra) {
    el.id = 'scr-' + (++seq);
    el.classList.add('screen');
    var s = { name: name, nav: nav, el: el };
    Object.keys(extra || {}).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }

  function spinner() { return h('div.loading', h('div.spin'), h('span', 'Loading…')); }

  var KIND_LABEL = { video: 'Video', audio: 'Audio', image: 'Images', poll: 'Poll', link: 'Link', text: 'Post' };
  var KIND_ICON = { video: 'play', audio: 'audio', image: 'image', poll: 'poll', link: 'link', text: 'text' };
  function kindIcon(k) { return U.icon(KIND_ICON[k] || 'text'); }

  // ---------------- post cards and grids ----------------

  function postCard(post, queueFn) {
    var s = Store.settings();
    var prog = Progress.get(post.id);
    var blur = s.blurNsfw && post.nsfw;
    var dur = post.video ? post.video.duration : post.audio ? post.audio.duration : null;
    var card = h('div.card.focusable' + (post.canView ? '' : '.locked') + (blur ? '.nsfw' : ''), {
      onclick: function () { App.push(Views.post(post, queueFn)); }
    },
      h('div.card-thumb', { style: post.thumb ? { backgroundImage: 'url("' + post.thumb + '")' } : {} },
        post.thumb ? null : h('div.card-kind-big', kindIcon(post.kind)),
        h('span.badge', kindIcon(post.kind), ' ' + KIND_LABEL[post.kind] + (dur ? '  ' + U.duration(dur) : '')),
        post.canView ? null : h('div.lock', U.icon('lock'), post.minCents ? h('small', U.money(post.minCents) + '+') : null),
        prog && prog.duration ? h('div.card-progress', h('div', { style: { width: Math.min(100, prog.position / prog.duration * 100) + '%' } })) : null
      ),
      h('div.card-body',
        h('div.card-title', post.title),
        h('div.card-meta',
          post.campaign && post.campaign.avatar ? h('span.mini-avatar', { style: { backgroundImage: 'url("' + post.campaign.avatar + '")' } }) : null,
          h('span', (post.campaign ? post.campaign.name + ' · ' : '') + U.timeAgo(post.published)),
          post.likes ? h('span.meta-count', U.icon('heart'), ' ' + U.count(post.likes)) : null)
      )
    );
    card._post = post;
    card._queue = queueFn;
    paintWatched(card);
    return card;
  }

  // Watched posts are dimmed with a "Watched" (or, for posts with nothing to play, "Seen") label.
  function paintWatched(card) {
    var w = Watched.get(card._post.id), thumb = card.querySelector('.card-thumb');
    var old = thumb.querySelector('.badge-watched');
    if (old) thumb.removeChild(old);
    card.classList.toggle('watched', !!w);
    if (!w) return;
    var bar = thumb.querySelector('.card-progress');
    if (bar && w.how === 'watched' && !Progress.get(card._post.id)) thumb.removeChild(bar);
    thumb.appendChild(h('span.badge-watched', U.icon('check'), w.how === 'seen' ? ' Seen' : ' Watched'));
  }
  document.addEventListener('ptv-watched', function (e) {
    Array.prototype.forEach.call(document.querySelectorAll('.card'), function (c) {
      if (!c._post || c._post.id !== e.detail) return;
      // A finished video leaves the Continue row.
      if (c.closest('[data-nav-group="continue"]')) { if (!Progress.get(e.detail) && c.parentNode) c.parentNode.removeChild(c); return; }
      paintWatched(c);
    });
  });

  // Infinite, filterable grid of posts. Only the rows within a screen of what's showing are in the page, with padding
  // standing in for the rest, so a creator with thousands of posts is as quick to move around as one with fifty.
  var GRID_PAD = 8; // .grid's own top and bottom padding
  function PostGrid(loader, opts) {
    opts = opts || {};
    var grid = h('div.grid');
    var status = h('div.grid-status');
    var wrap = h('div.grid-wrap', grid, status);
    var state = { items: [], shown: [], cursor: null, done: false, loading: false, filter: opts.filter || null, gen: 0 };
    var s = Store.settings();
    var cards = {};               // index in shown -> card, for the posts in the grid now
    var from = 0, to = 0;         // shown[from..to) are in the grid
    var geo = null;               // { cols, pitch }: columns, and px from one row's top to the next

    function queue() { return state.shown; }

    function accept(p) {
      if (!s.showLocked && !p.canView) return false;
      return !state.filter || state.filter(p);
    }

    // Cards are made as they come into view and dropped as they leave it, so thousands of posts don't pile up in memory.
    function cardAt(i) {
      if (cards[i]) return cards[i];
      var p = state.shown[i];
      var c = cards[i] = postCard(p, queue);
      c.addEventListener('tvfocus', function () {
        if (state.shown.indexOf(p) >= state.shown.length - 8) more();
        fit();
      });
      return c;
    }

    // Measures columns and row height from the rows in the page (every card is the same size).
    function measure() {
      var kids = grid.children;
      if (!kids.length) return;
      var top = kids[0].offsetTop, cols = 1;
      while (cols < kids.length && kids[cols].offsetTop === top) cols++;
      if (cols < kids.length) geo = { cols: cols, pitch: kids[cols].offsetTop - top };
    }

    // Puts the posts near the screen into the grid and sizes the padding for the rest.
    function fit() {
      var n = state.shown.length, sc = grid.closest('.scroll-y'), view = sc ? sc.clientHeight : 0;
      if (grid.children.length) measure();
      if (grid.children.length && !view) return; // hidden under another screen: leave it until it shows again
      var cols = geo ? geo.cols : 1, pitch = geo ? geo.pitch : 0;
      var a = 0, b = Math.min(n, 48), i;
      if (geo && view) {
        // Offsets rather than screen rects: they ignore the zoom used in a browser and the highlighted card's scaling.
        var y = GRID_PAD;
        for (var e = grid; e && e !== sc; e = e.offsetParent) y += e.offsetTop;
        var first = Math.floor((sc.scrollTop - y) / pitch), rows = Math.ceil(view / pitch);
        a = Math.max(0, first - rows - 1) * cols;
        b = Math.min(n, Math.max(0, first + 2 * rows + 2) * cols);
        // While the rows on screen, and one either side, are already in, leave them: the grid changes a screen at a time.
        if (grid.children.length && from <= Math.max(0, first - 1) * cols && to >= Math.min(n, (first + rows + 1) * cols)) { a = from; b = to; }
      }
      if (a !== from || b !== to || grid.children.length !== b - a) {
        for (i = from; i < to; i++) {
          if ((i >= a && i < b) || !cards[i]) continue;
          if (cards[i].parentNode === grid) grid.removeChild(cards[i]);
          delete cards[i];
        }
        var next = null;
        for (i = b - 1; i >= a; i--) {
          var c = cardAt(i);
          if (c.parentNode !== grid || c.nextSibling !== next) grid.insertBefore(c, next);
          next = c;
        }
        from = a; to = b;
      }
      grid.style.paddingTop = (GRID_PAD + Math.floor(a / cols) * pitch) + 'px';
      grid.style.paddingBottom = (GRID_PAD + (Math.ceil(n / cols) - Math.ceil(b / cols)) * pitch) + 'px';
    }

    function render(newItems) {
      newItems.filter(accept).forEach(function (p) { state.shown.push(p); });
      fit();
    }

    function more(auto) {
      if (state.loading || state.done) return Promise.resolve();
      state.loading = true;
      var gen = state.gen;
      U.clear(status).appendChild(spinner());
      var before = state.shown.length;
      return loader(state.cursor).then(function (page) {
        if (gen !== state.gen) return;
        state.loading = false;
        state.items = state.items.concat(page.items);
        state.cursor = page.next;
        state.done = !page.next || !page.items.length;
        render(page.items);
        U.clear(status);
        if (state.shown.length === 0 && state.done) status.appendChild(h('div.empty', opts.empty || 'Nothing here yet.'));
        // When a filter hides most posts, keep fetching a few pages so the grid is not empty.
        var added = state.shown.length - before;
        if (!state.done && added < 8 && (auto || 0) < 6) return more((auto || 0) + 1);
        if (opts.onLoad) opts.onLoad(state);
      }).catch(function (err) {
        if (gen !== state.gen) return;
        state.loading = false;
        U.clear(status);
        var e = App.handleError(err, function () { more(); });
        if (e) status.appendChild(e);
        if (opts.onLoad) opts.onLoad(state);
      });
    }

    // Scrolling (with the remote, a mouse or a touch screen) swaps in the posts that come into view, and near the end
    // loads more. The listener goes once the grid has left the page.
    function onScroll(e) {
      if (!document.body.contains(wrap)) { document.removeEventListener('scroll', onScroll, true); return; }
      var sc = e.target;
      if (!sc.contains || !sc.contains(wrap)) return;
      fit();
      if (!state.loading && !state.done && sc.scrollTop + sc.clientHeight > sc.scrollHeight - 600) more();
    }
    document.addEventListener('scroll', onScroll, true);

    function setFilter(f) {
      state.filter = f;
      state.gen++;
      state.loading = false;
      state.shown = [];
      cards = {}; from = to = 0;
      U.clear(grid);
      render(state.items);
      if (state.shown.length < 8 && !state.done) return more(1);
      if (state.shown.length === 0 && state.done) U.clear(status).appendChild(h('div.empty', opts.empty || 'Nothing here yet.'));
      else U.clear(status);
      return Promise.resolve();
    }

    wrap._grid = { el: wrap, more: more, setFilter: setFilter, state: state, queue: queue };
    return wrap._grid;
  }

  var FILTERS = [
    ['All', null],
    ['Videos', function (p) { return p.kind === 'video'; }],
    ['Audio', function (p) { return p.kind === 'audio'; }],
    ['Images', function (p) { return p.kind === 'image'; }],
    ['Posts', function (p) { return p.kind === 'text' || p.kind === 'link' || p.kind === 'poll'; }]
  ];

  function chips(list, onPick, activeIndex) {
    // Entering the row lands on the active chip.
    var row = h('div.chips', { dataset: { navGroup: 'chips', remember: '1' } });
    list.forEach(function (f, i) {
      var c = h('div.chip.focusable' + (i === (activeIndex || 0) ? '.active' : ''), {
        onclick: function () {
          Array.prototype.forEach.call(row.children, function (x) { x.classList.remove('active'); });
          c.classList.add('active');
          row._last = c;
          onPick(f, i);
        }
      }, f[0]);
      if (i === (activeIndex || 0)) row._last = c;
      row.appendChild(c);
    });
    return row;
  }

  // A chip that switches the order of a creator's or collection's posts. The choice is remembered for that list.
  var SORTS = { '-published_at': 'Newest first', 'published_at': 'Oldest first', 'collection_order': 'Collection order' };
  function sortChip(storeKey, order, onChange) {
    var sort = Store.get(storeKey, order[0]);
    if (order.indexOf(sort) < 0) sort = order[0];
    // data-direct: coming up from the posts below lands on it, instead of on the row's selected filter.
    var chip = h('div.chip.chip-sort.focusable', {
      dataset: { direct: '1' },
      onclick: function () {
        Focus.moves++; // keep focus here while the list reloads
        sort = order[(order.indexOf(sort) + 1) % order.length];
        Store.set(storeKey, sort);
        chip.textContent = 'Sort: ' + SORTS[sort];
        onChange(sort);
      }
    }, 'Sort: ' + SORTS[sort]);
    chip.sort = function () { return sort; };
    return chip;
  }

  function focusIntoScreen(sc) {
    if (App.top() === sc) App.focusInScreen('[data-autofocus], .card.focusable, .creator-tile.focusable, .comment-main.focusable');
  }

  // ---------------- screens ----------------

  var Views = {};

  Views.splash = function (message) {
    return screen('splash', null, h('div.splash', h('div.brand-mark.big', U.icon('play')), spinner(), message ? h('p.splash-msg', message) : null), { fullscreen: true });
  };

  // ----- sign in -----
  // The app runs inside patreon.com, so signing in happens on Patreon's own page and every method it offers works.
  Views.login = function (message) {
    var el = h('div.login.scroll-y');
    var sc = screen('login', null, el, { fullscreen: true });
    var body = h('div.login-body');

    if (global.PTV_DEMO) {
      body.appendChild(h('p.lead', 'This web preview runs on sample creators and posts, so you can try every screen without an account.'));
      body.appendChild(h('div.btn-row', h('div.btn.focusable', { dataset: { autofocus: '1' }, onclick: function () {
        App.replaceAll(Views.splash());
        Api.currentUser().then(function (u) { App.setUser(u); Store.set('user', u); App.go('home'); });
      } }, 'Use sample data')));
    } else {
      body.appendChild(h('p.lead', 'Sign in on Patreon\'s own page. Any way you normally sign in works: email and password, a code emailed to you, Google or Apple.'));
      if (Host.tv()) {
        body.appendChild(h('ul.tips',
          h('li', 'Use the arrows to move and OK to select. Back returns here.'),
          h('li', 'If Google says it can\'t sign you in on this device, go back and choose to continue with email instead. Patreon emails you a code, which works for Google accounts too.')));
      }
      var row = h('div.btn-row',
        h('div.btn.focusable#btn-signin', { dataset: { autofocus: '1' }, onclick: function () { location.href = Api.signInUrl(); } }, 'Sign in with Patreon'));
      if (!Host.tv()) row.appendChild(h('div.btn.secondary.focusable', { onclick: Host.leave }, 'Back to patreon.com'));
      body.appendChild(row);
    }

    el.appendChild(h('div.login-card',
      h('div.login-head', h('div.brand-mark.big', U.icon('play')), h('div', h('h1', U.appName()), h('p.muted', 'Watch and read the creators you support.'))),
      message ? h('p.error', message) : null,
      body));
    sc.onShow = function () { var af = el.querySelector('[data-autofocus]'); if (af) Focus.set(af); };
    return sc;
  };

  // ----- the TV's own start page -----
  // Starts the on-TV helper (app/service/helper.js). The helper restarts this app with Tizen's debugger attached,
  // opens www.patreon.com and loads the app into it. That needs Developer Mode pointed at the TV itself.
  var HELPER = 'http://127.0.0.1:8617';
  function helperCall(method, path, timeout) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, HELPER + path);
      x.timeout = timeout || 2000;
      x.onload = function () { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(new Error('Bad helper reply')); } };
      x.onerror = x.ontimeout = function () { reject(new Error('Helper not running')); };
      x.send();
    });
  }

  Views.launcher = function () {
    var el = h('div.login.scroll-y');
    var sc = screen('launcher', null, el, { fullscreen: true });
    var card = h('div.login-card');
    el.appendChild(card);
    var timer = null, startedHelper = false, relaunched = false, since = Date.now();
    sc.onDestroy = function () { clearTimeout(timer); };

    function head() { return h('div.login-head', h('div.brand-mark.big', U.icon('play')), h('div', h('h1', U.appName()), h('p.muted', 'Watch and read the creators you support.'))); }
    function show(nodes, focusSel) {
      U.clear(card).appendChild(head());
      nodes.forEach(function (n) { if (n) card.appendChild(n); });
      var f = focusSel && card.querySelector(focusSel);
      if (f) Focus.set(f);
    }
    function waiting(text) { show([h('div.launch-wait', spinner(), h('p', text))]); }
    function again(ms) { clearTimeout(timer); timer = setTimeout(check, ms); }
    function exitBtn() { return h('div.btn.secondary.focusable', { onclick: Host.exit }, 'Exit'); }

    function check() {
      if (simulator()) {
        return problem('This is Tizen\'s Web Simulator. The helper that opens Patreon only runs on a real TV. To try the app on a computer, use the Chrome add-on (patreon-tv-chrome.zip).');
      }
      helperCall('GET', '/status').then(function (st) {
        if (st.debugging || st.connecting) {
          // The helper is taking this page to patreon.com.
          waiting('Opening Patreon…');
          if (Date.now() - since > 25000) return problem('Patreon did not open.', st);
          return again(1000);
        }
        if (st.devMode === false) return setup(st);
        if (relaunched) return again(1000);
        relaunched = true;
        waiting('Opening Patreon…');
        helperCall('POST', '/relaunch').then(function () {
          // The helper starts this app again with the debugger attached, then connects to it.
          setTimeout(Host.exit, 300);
        }, function (err) { problem(err.message, st); });
      }, function () {
        if (!startedHelper) { startedHelper = true; return startHelper(); }
        if (Date.now() - since > 15000) return problem('The helper that opens Patreon did not start.');
        again(700);
      });
    }

    // Tizen's Web Simulator (NW.js) has Tizen's APIs but can't run the helper.
    function simulator() { var pr = global.process; return typeof global.nw !== 'undefined' || !!(pr && pr.versions && (pr.versions.nw || pr.versions['node-webkit'])); }

    function startHelper() {
      waiting('Starting…');
      try {
        var pkg = tizen.application.getCurrentApplication().appInfo.packageId;
        tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'), pkg + '.Helper',
          function () { again(500); },
          function (e) { problem('Could not start the helper: ' + e.message); });
      } catch (e) {
        problem(global.tizen ? 'Could not start the helper: ' + e.message : 'This is the TV app. To try it on a computer, use the Chrome add-on in the chrome-extension folder.');
      }
    }

    function setup(st) {
      show([
        h('h2', 'One-time setup'),
        h('p', 'This app opens patreon.com and runs inside it, like TizenBrew does. For that, the TV\'s Developer Mode has to point at the TV itself.'),
        h('ol.steps',
          h('li', 'Open Apps, then press 1 2 3 4 5 on the remote.'),
          h('li', 'Set Developer mode On and Host PC IP to 127.0.0.1, then OK.'),
          h('li', 'Restart the TV: hold the power button until the Samsung logo shows.'),
          h('li', 'Open ' + U.appName() + ' again.')),
        st.developerIP ? h('p.muted', 'Host PC IP is ' + st.developerIP + ' right now. When you install an update with Apps2Samsung, set it to your computer\'s IP for the install, then back to 127.0.0.1.') : null,
        h('div.btn-row', h('div.btn.focusable', { onclick: function () { since = Date.now(); relaunched = false; waiting('Checking…'); check(); } }, 'Check again'), exitBtn())
      ], '.btn');
    }

    function problem(text, st) {
      clearTimeout(timer);
      show([
        h('h2', 'Something went wrong'),
        h('p', text),
        st && st.error ? h('p.muted', 'Details: ' + st.error) : null,
        h('div.btn-row', h('div.btn.focusable', { onclick: function () { since = Date.now(); relaunched = false; startedHelper = false; waiting('Starting…'); check(); } }, 'Try again'), exitBtn())
      ], '.btn');
    }

    sc.onShow = function () {
      if (location.hash === '#exit') { Host.exit(); return; }
      if (!card.firstChild) { waiting('Starting…'); check(); }
    };
    return sc;
  };

  // ----- home -----
  Views.home = function () {
    var el = h('div.page.scroll-y');
    var sc = screen('home', 'home', el);
    var greeting = h('div.page-head', h('h1', 'Home'), h('p.muted', App.user ? 'Welcome back, ' + App.user.name.split(' ')[0] : ''));
    el.appendChild(greeting);

    var recent = Progress.recent().slice(0, 12);
    if (recent.length) {
      var row = h('div.row-scroll', { dataset: { navGroup: 'continue', remember: '1' } });
      recent.forEach(function (r) {
        var c = h('div.card.small.focusable', {
          onclick: function () {
            U.toast('Loading…', 1200);
            Api.post(r.post.id).then(function (p) { if (!Player.play(p, [p], 0)) App.push(Views.post(p)); })
              .catch(function (err) { var e = App.handleError(err); if (e) U.toast(err.message); });
          }
        },
          h('div.card-thumb', { style: r.post.thumb ? { backgroundImage: 'url("' + r.post.thumb + '")' } : {} },
            h('span.badge', U.icon(r.post.kind === 'audio' ? 'audio' : 'play'), ' ' + U.duration(r.duration - r.position) + ' left'),
            h('div.card-progress', h('div', { style: { width: (r.position / r.duration * 100) + '%' } }))),
          h('div.card-body', h('div.card-title', r.post.title), h('div.card-meta', h('span', r.post.campaign ? r.post.campaign.name : ''))));
        c._post = { id: r.post.id };
        row.appendChild(c);
      });
      el.appendChild(h('section.section', h('h2', 'Continue'), row));
    }

    var grid = PostGrid(function (cursor) { return Api.feed(cursor); }, {
      empty: 'No posts yet. Posts from creators you support and follow show up here.',
      onLoad: function () { focusIntoScreen(sc); }
    });
    el.appendChild(h('section.section', h('div.section-head', h('h2', 'Latest from your creators'),
      chips(FILTERS, function (f) { grid.setFilter(f[1]); })), grid.el));
    grid.more();
    sc.onKey = function (a) {
      if (a === 'green') { App.go('home'); return true; }
      return false;
    };
    return sc;
  };

  // ----- creators you support -----
  Views.creators = function () {
    var el = h('div.page.scroll-y');
    var sc = screen('creators', 'creators', el);
    el.appendChild(h('div.page-head', h('h1', 'Your creators')));
    var body = h('div');
    el.appendChild(body);

    function draw(list) {
      U.clear(body);
      if (!list.length) { body.appendChild(h('div.empty', 'You are not supporting or following anyone yet. Use Search to find creators.')); return; }
      var grid = h('div.grid.creators');
      list.forEach(function (c) { grid.appendChild(creatorTile(c)); });
      body.appendChild(grid);
      focusIntoScreen(sc);
    }

    function load() {
      U.clear(body).appendChild(spinner());
      Api.currentUser().then(function (u) {
        App.setUser(u); Store.set('user', u);
        var list = u.campaigns.slice();
        // Also include creators seen in the feed (followed but not pledged, or when memberships are not returned).
        return Api.feed(null).then(function (page) {
          var seen = {};
          list.forEach(function (c) { seen[c.id] = 1; });
          page.items.forEach(function (p) { if (p.campaign && !seen[p.campaign.id]) { seen[p.campaign.id] = 1; list.push(p.campaign); } });
          return list;
        }).catch(function () { return list; });
      }).then(function (list) {
        list.sort(function (a, b) { return (b.member ? 1 : 0) - (a.member ? 1 : 0) || a.name.localeCompare(b.name); });
        draw(list);
      }).catch(function (err) { U.clear(body); var e = App.handleError(err, load); if (e) body.appendChild(e); });
    }
    load();
    return sc;
  };

  function creatorTile(c) {
    var blur = Store.settings().blurNsfw && c.nsfw;
    return h('div.creator-tile.focusable' + (blur ? '.nsfw' : ''), { onclick: function () { App.push(Views.creator(c)); } },
      h('div.avatar', { style: c.avatar ? { backgroundImage: 'url("' + c.avatar + '")' } : {} }, c.avatar ? null : c.name.charAt(0)),
      h('div.creator-name', c.name),
      h('div.creator-sub.muted', c.pledgeCents ? U.money(c.pledgeCents, c.currency) + ' / ' + (c.payPer || 'month') : c.member ? 'Member' : (c.patrons ? U.count(c.patrons) + ' members' : c.oneLiner || '')));
  }

  // ----- a creator's page -----
  Views.creator = function (c) {
    var el = h('div.page.scroll-y.creator-page');
    var sc = screen('creator', 'creators', el);
    var header = h('div.creator-hero');
    el.appendChild(header);

    function drawHeader(info) {
      U.clear(header);
      if (info.cover) header.style.backgroundImage = 'linear-gradient(to bottom, rgba(0,0,0,.2), var(--bg)), url("' + info.cover + '")';
      header.appendChild(h('div.creator-hero-inner',
        h('div.avatar.large', { style: info.avatar ? { backgroundImage: 'url("' + info.avatar + '")' } : {} }),
        h('div.creator-hero-text',
          h('h1', info.name),
          info.oneLiner ? h('p.lead', info.oneLiner) : null,
          h('p.muted', [info.patrons ? U.count(info.patrons) + ' members' : '', info.posts ? U.count(info.posts) + ' posts' : ''].filter(Boolean).join('  ·  ')),
          h('div.btn-row',
            info.summary ? h('div.btn.secondary.focusable', { onclick: function () { about(info); } }, 'About') : null,
            info.tiers && info.tiers.length ? h('div.btn.secondary.focusable', { onclick: function () { tiers(info); } }, 'Membership tiers') : null,
            info.url ? h('div.btn.secondary.focusable', { onclick: function () { App.qr('Open ' + info.name + ' on your phone', info.url); } }, 'Open on phone') : null)
        )));
    }
    drawHeader(c);
    Api.campaign(c.id).then(function (info) { info.pledgeCents = c.pledgeCents; drawHeader(info); c = info; })
      .catch(function () { /* header stays with what we already know */ });

    var content = h('div');
    var grid = null, filter = null;
    var tabs = FILTERS.concat([['Collections', 'collections']]);
    var sorter = sortChip('sort.' + c.id, ['-published_at', 'published_at'], function () { showPosts(filter); });
    var row = chips(tabs, function (f) {
      sorter.classList.toggle('hidden', f[1] === 'collections');
      if (f[1] === 'collections') { showCollections(); return; }
      filter = f[1];
      if (!grid || grid.collection) showPosts(f[1]); else grid.setFilter(f[1]);
    });
    row.appendChild(sorter);
    el.appendChild(h('div.section-head.sticky', row));
    el.appendChild(content);

    function showPosts(filter) {
      grid = PostGrid(function (cursor) { return Api.campaignPosts(c.id, cursor, { sort: sorter.sort() }); }, {
        filter: filter, empty: 'No posts to show.', onLoad: function () { focusIntoScreen(sc); }
      });
      U.clear(content).appendChild(grid.el);
      grid.more();
    }

    function showCollections() {
      grid = { collection: true };
      U.clear(content).appendChild(spinner());
      Api.collections(c.id).then(function (list) {
        U.clear(content);
        if (!list.length) { content.appendChild(h('div.empty', 'This creator has no collections.')); return; }
        var g = h('div.grid');
        list.forEach(function (col) {
          g.appendChild(h('div.card.focusable', { onclick: function () { App.push(Views.collection(c, col)); } },
            h('div.card-thumb', { style: col.thumb ? { backgroundImage: 'url("' + col.thumb + '")' } : {} }, col.count ? h('span.badge', U.icon('poll'), ' ' + U.count(col.count) + ' posts') : null),
            h('div.card-body', h('div.card-title', col.title), h('div.card-meta', h('span', col.description.slice(0, 80))))));
        });
        content.appendChild(g);
      }).catch(function (err) {
        U.clear(content);
        var e = App.handleError(err, showCollections); if (e) content.appendChild(e);
      });
    }

    showPosts(null);
    return sc;
  };

  function about(info) {
    var box = h('div.rich.scrollbox.focusable', { dataset: { scroll: '1' }, html: U.sanitize(info.summary) });
    var m = App.modal([h('h2', 'About ' + info.name), box,
      h('div.btn-row', h('div.btn.focusable', { onclick: function () { m.close(); } }, 'Close'))], { wide: true });
  }

  function tiers(info) {
    var list = h('div.tiers');
    info.tiers.forEach(function (t) {
      var mine = info.pledgeCents && info.pledgeCents >= t.cents;
      list.appendChild(h('div.tier.focusable' + (mine ? '.mine' : ''), {
        onclick: function () { App.qr('Join or change tier on your phone', info.url ? info.url + (info.url.indexOf('?') >= 0 ? '&' : '?') + 'membership' : 'https://www.patreon.com', 'Memberships are managed on Patreon.'); }
      },
        h('div.tier-price', U.money(t.cents, info.currency) + ' / ' + (info.payPer || 'month')),
        h('div.tier-title', t.title + (mine ? '  ✓ your tier' : '')),
        h('div.tier-desc.muted', U.sanitize(t.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220))));
    });
    var m = App.modal([h('h2', 'Membership tiers'), list,
      h('div.btn-row', h('div.btn.focusable', { onclick: function () { m.close(); } }, 'Close'))], { wide: true });
  }

  // ----- collection -----
  Views.collection = function (c, col) {
    var el = h('div.page.scroll-y');
    var sc = screen('collection', 'creators', el);
    el.appendChild(h('div.page-head', h('h1', col.title), h('p.muted', c.name + (col.count ? '  ·  ' + U.count(col.count) + ' posts' : ''))));
    var sorter = sortChip('sort.col.' + col.id, ['collection_order', '-published_at', 'published_at'], load);
    var holder = h('div');
    el.appendChild(h('div.section-head', h('div.chips', { dataset: { navGroup: 'chips' } }, sorter)));
    el.appendChild(holder);
    function load() {
      var grid = PostGrid(function (cursor) { return Api.campaignPosts(c.id, cursor, { collectionId: col.id, sort: sorter.sort() }); }, {
        empty: 'This collection is empty.', onLoad: function () { focusIntoScreen(sc); }
      });
      U.clear(holder).appendChild(grid.el);
      grid.more();
    }
    load();
    return sc;
  };

  // ----- a single post -----
  Views.post = function (post, queueFn) {
    var el = h('div.page.post-page.scroll-y');
    var sc = screen('post', 'home', el);
    function queue() { return queueFn ? queueFn() : [post]; }

    function draw(p) {
      post = p;
      U.clear(el);
      var s = Store.settings();
      var hero = h('div.post-hero' + (s.blurNsfw && p.nsfw ? '.nsfw' : ''), { style: p.thumb ? { backgroundImage: 'url("' + p.thumb + '")' } : {} });
      var playable = p.canView && (p.video || p.audio || (p.embed && p.embed.player));
      if (!p.canView) {
        hero.appendChild(h('div.hero-lock', h('div.lock-icon', U.icon('lock')),
          h('p', p.minCents ? 'Unlock with a ' + U.money(p.minCents) + ' or higher membership' : 'This post is for paid members'),
          p.teaser ? h('p.muted', p.teaser) : null));
      } else if (playable) {
        hero.appendChild(h('div.hero-play', U.icon(p.audio && !p.video ? 'audio' : 'play')));
      }

      var actions = h('div.btn-row.post-actions', { dataset: { navGroup: 'actions' } });
      if (playable) {
        var prog = Progress.get(p.id);
        actions.appendChild(h('div.btn.focusable', { dataset: { autofocus: '1' }, onclick: function () { Player.play(p, queue(), queue().indexOf(p)); } },
          (p.audio && !p.video ? 'Listen' : 'Play') + (prog ? ' (resume ' + U.duration(prog.position) + ')' : '')));
        if (prog) actions.appendChild(h('div.btn.secondary.focusable', { onclick: function () { Progress.remove(p.id); Player.play(p, queue(), queue().indexOf(p)); } }, 'Start over'));
      }
      if (!p.canView) {
        actions.appendChild(h('div.btn.focusable', { dataset: { autofocus: '1' }, onclick: function () { App.qr('Unlock on your phone', p.url || 'https://www.patreon.com', 'Join or upgrade on Patreon, then come back here.'); } }, 'Unlock on phone'));
      }
      if (p.images.length && p.canView) {
        actions.appendChild(h('div.btn.focusable' + (playable ? '.secondary' : ''), { dataset: playable ? {} : { autofocus: '1' }, onclick: function () { imageViewer(p.images, 0); } }, 'View ' + p.images.length + ' image' + (p.images.length > 1 ? 's' : '')));
      }
      var likeBtn = h('div.btn.secondary.focusable' + (p.liked ? '.on' : ''), {
        onclick: function () {
          var want = !p.liked;
          p.liked = want; p.likes = Math.max(0, p.likes + (want ? 1 : -1)); paintLike();
          Api.like(p.id, want).catch(function (err) {
            p.liked = !want; p.likes = Math.max(0, p.likes + (want ? -1 : 1)); paintLike();
            if (err instanceof Api.AuthError) { App.handleError(err); return; }
            U.toast('Could not update like: ' + err.message, 5000);
          });
        }
      });
      function paintLike() { U.clear(likeBtn).appendChild(U.icon('heart')); likeBtn.appendChild(document.createTextNode(' ' + (p.liked ? 'Liked' : 'Like') + (p.likes ? '  ' + U.count(p.likes) : ''))); likeBtn.classList.toggle('on', p.liked); }
      paintLike();
      if (p.canView) actions.appendChild(likeBtn);
      actions.appendChild(h('div.btn.secondary.focusable', { onclick: function () { App.push(Views.comments(p)); } }, U.icon('comment'), ' Comments' + (p.comments ? '  ' + U.count(p.comments) : '')));
      if (p.campaign) actions.appendChild(h('div.btn.secondary.focusable', { onclick: function () { App.push(Views.creator(p.campaign)); } }, p.campaign.name));
      if (p.url) actions.appendChild(h('div.btn.secondary.focusable', { onclick: function () { App.qr('Open this post on your phone', p.url); } }, 'Open on phone'));

      // Posts with nothing to play count as seen once opened. Any post can be marked by hand, e.g. one watched elsewhere.
      if (p.canView && !playable) Watched.mark(p.id, 'seen');
      var watchedNote = h('span.watched-note');
      var watchBtn = h('div.btn.secondary.focusable', {
        onclick: function () {
          if (Watched.get(p.id)) Watched.remove(p.id);
          else { Progress.remove(p.id); Watched.mark(p.id, 'watched'); }
          paintWatchState();
        }
      });
      function paintWatchState() {
        var w = Watched.get(p.id);
        watchBtn.textContent = w ? 'Mark as not watched' : 'Mark as watched';
        U.clear(watchedNote);
        if (w) { watchedNote.appendChild(U.icon('check')); watchedNote.appendChild(document.createTextNode((w.how === 'seen' ? ' Seen ' : ' Watched ') + U.timeAgo(new Date(w.at).toISOString()))); }
      }
      paintWatchState();
      if (p.canView) actions.appendChild(watchBtn);

      var head = h('div.post-head',
        h('div.post-meta.muted', (p.campaign ? p.campaign.name + '  ·  ' : '') + U.timeAgo(p.published) + '  ·  ' + KIND_LABEL[p.kind], watchedNote),
        h('h1', p.title),
        p.tags.length ? h('div.tags', p.tags.map(function (t) { return h('span.tag', '#' + t); })) : null);

      el.appendChild(h('div.post-top', hero, h('div.post-side', head, actions)));

      if (p.images.length > 1 && p.canView) {
        var strip = h('div.row-scroll.thumbs', { dataset: { navGroup: 'thumbs' } });
        p.images.forEach(function (img, i) {
          strip.appendChild(h('div.thumb.focusable', { style: { backgroundImage: 'url("' + img.thumb + '")' }, onclick: function () { imageViewer(p.images, i); } }));
        });
        el.appendChild(h('section.section', h('h2', 'Images'), strip));
      }

      // YouTube and Vimeo videos linked in the post, beyond the one the Play button starts.
      var extra = p.canView ? (p.videoLinks || []).filter(function (l) { return !(p.embed && p.embed.url === l.url && !p.video && !p.audio); }) : [];
      if (extra.length) {
        var vrow = h('div.row-scroll.video-links', { dataset: { navGroup: 'videolinks' } });
        extra.forEach(function (l, i) {
          vrow.appendChild(h('div.card.focusable', { onclick: function () { Player.openLink(l, p); } },
            h('div.card-thumb', { style: l.thumb ? { backgroundImage: 'url("' + l.thumb + '")' } : {} },
              l.thumb ? null : h('div.card-kind-big', U.icon('play')),
              h('span.card-provider', l.provider)),
            h('div.card-body', h('div.card-title', l.title || ('Video ' + (i + (playable ? 2 : 1)))))));
        });
        el.appendChild(h('section.section', h('h2', 'Videos in this post'), vrow));
      }

      if (p.poll) el.appendChild(pollView(p.poll));

      if (p.embed && !p.embed.player && p.canView) {
        el.appendChild(h('div.link-card.focusable', { onclick: function () { App.qr('Open link on your phone', p.embed.url); } },
          h('div.link-provider.muted', p.embed.provider), h('div.link-title', p.embed.title || p.embed.url), p.embed.description ? h('p.muted', p.embed.description) : null));
      }

      var html = p.canView ? U.sanitize(p.content) : (p.teaser ? '<p>' + p.teaser.replace(/</g, '&lt;') + '</p>' : '');
      if (html.replace(/<[^>]*>/g, '').trim() || /<img/i.test(html)) {
        var text = h('div.rich.post-text.focusable', { html: html });
        // Links inside the post open as QR codes; images open full screen.
        Array.prototype.forEach.call(text.querySelectorAll('a[href]'), function (a) {
          a.classList.add('focusable');
          a.addEventListener('click', function (e) {
            e.preventDefault();
            var v = Api.videoLink(a.getAttribute('href'));
            if (v && p.canView) Player.openLink(v, p);
            else App.qr('Open link on your phone', a.href);
          });
        });
        Array.prototype.forEach.call(text.querySelectorAll('img'), function (img) {
          img.classList.add('focusable');
          img.addEventListener('click', function () { imageViewer([{ full: img.src, thumb: img.src }], 0); });
        });
        el.appendChild(h('section.section.post-body', text));
      }

      if (p.attachments.length && p.canView) {
        var list = h('div.attachments');
        p.attachments.forEach(function (at) {
          var isAudio = /^audio\//.test(at.mime || '') || /\.(mp3|m4a|aac|ogg|wav|flac)$/i.test(at.name);
          var isVideo = /^video\//.test(at.mime || '') || /\.(mp4|m4v|webm|mov)$/i.test(at.name);
          var isImg = /^image\//.test(at.mime || '') || /\.(jpe?g|png|gif|webp)$/i.test(at.name);
          list.appendChild(h('div.attachment.focusable', {
            onclick: function () {
              var clone = Object.assign({}, p, { id: p.id + ':' + at.name, title: at.name });
              if (isAudio) { clone.audio = { url: at.url }; clone.video = null; Player.play(clone); }
              else if (isVideo) { clone.video = { url: at.url, hls: false }; Player.play(clone); }
              else if (isImg) imageViewer([{ full: at.url, thumb: at.url }], 0);
              else App.qr('Download on your phone', p.url || at.url, 'TVs cannot open this file type. Open the post on your phone to download it.');
            }
          }, h('span.att-icon', U.icon(isAudio ? 'audio' : isVideo ? 'play' : isImg ? 'image' : 'download')), h('span', at.name), at.size ? h('span.muted', ' ' + Math.round(at.size / 1024 / 1024 * 10) / 10 + ' MB') : null));
        });
        el.appendChild(h('section.section', h('h2', 'Attachments'), list));
      }
      el.appendChild(h('div.page-end'));
      if (App.top() === sc) {
        var af = el.querySelector('[data-autofocus]') || actions.querySelector('.focusable');
        if (af) Focus.set(af);
      }
    }

    draw(post);
    // Feed items carry most fields; refresh for the full body, poll and attachments.
    Api.post(post.id).then(function (full) {
      if (!full.campaign && post.campaign) full.campaign = post.campaign;
      var q = queueFn ? queueFn() : null;
      if (q) { var i = q.indexOf(post); if (i >= 0) q[i] = full; }
      var keepFocus = Focus.current && el.contains(Focus.current) && Focus.current.textContent;
      draw(full);
      if (keepFocus) {
        var match = Array.prototype.filter.call(el.querySelectorAll('.focusable'), function (x) { return x.textContent === keepFocus; })[0];
        if (match) Focus.set(match);
      }
    }).catch(function (err) { if (err instanceof Api.AuthError) App.handleError(err); });

    sc.onKey = function (a) {
      if ((a === 'play' || a === 'playpause') && post.canView) return Player.play(post, queue(), queue().indexOf(post));
      return false;
    };
    return sc;
  };

  function pollView(poll) {
    var total = poll.total || poll.choices.reduce(function (n, c) { return n + c.votes; }, 0);
    return h('section.section.poll', h('h2', 'Poll'), h('p.lead', poll.question || ''),
      poll.choices.map(function (c) {
        var pct = total ? Math.round(c.votes / total * 100) : 0;
        return h('div.poll-choice.focusable' + (c.mine ? '.mine' : ''),
          h('div.poll-bar', { style: { width: pct + '%' } }),
          h('span.poll-text', c.text + (c.mine ? '  ✓' : '')), h('span.poll-pct', pct + '%'));
      }),
      h('p.muted', U.count(total) + ' votes' + (poll.closesAt ? '  ·  closes ' + new Date(poll.closesAt).toLocaleDateString() : '') + '  ·  vote in the Patreon app'));
  }

  function imageViewer(images, index) {
    var img = h('img.viewer-img');
    var cap = h('div.viewer-cap');
    var i = index;
    function show() {
      img.src = images[i].full;
      cap.textContent = (i + 1) + ' / ' + images.length + '    ◀ ▶ browse   ▲ ▼ zoom   Back close';
      img.style.transform = '';
      zoom = 1;
    }
    var zoom = 1;
    var el = h('div.viewer', img, cap);
    var m = App.modal(el, {
      onKey: function (a) {
        if (a === 'left' || a === 'rw' || a === 'prev') { i = (i - 1 + images.length) % images.length; show(); return true; }
        if (a === 'right' || a === 'ff' || a === 'next' || a === 'enter') { i = (i + 1) % images.length; show(); return true; }
        if (a === 'up') { zoom = Math.min(3, zoom + 0.5); img.style.transform = 'scale(' + zoom + ')'; return true; }
        if (a === 'down') { zoom = Math.max(1, zoom - 0.5); img.style.transform = 'scale(' + zoom + ')'; return true; }
        return false;
      }
    });
    m.el.classList.add('fullscreen');
    show();
  }

  // ----- comments -----
  Views.comments = function (post) {
    var el = h('div.page.scroll-y.comments-page');
    var sc = screen('comments', 'home', el);
    el.appendChild(h('div.page-head', h('h1', 'Comments'), h('p.muted', post.title)));

    var input = h('input.input.focusable#in-comment', { type: 'text', placeholder: post.canComment ? 'Write a comment…' : 'Commenting is limited to members', disabled: !post.canComment });
    input.dataset.submit = 'btn-comment';
    var replyTo = null;
    var replyLabel = h('span.muted');
    var send = h('div.btn.focusable#btn-comment', {
      onclick: function () {
        var body = input.value.trim();
        if (!body) { input.focus(); return; }
        send.classList.add('busy');
        Api.addComment(post.id, body, replyTo && replyTo.id).then(function () {
          input.value = ''; replyTo = null; replyLabel.textContent = '';
          send.classList.remove('busy');
          U.toast('Comment posted');
          reload();
        }).catch(function (err) {
          send.classList.remove('busy');
          if (App.handleError(err)) U.toast('Could not post: ' + err.message, 5000);
        });
      }
    }, 'Post');
    if (post.canComment) el.appendChild(h('div.compose', input, send, replyLabel));

    var list = h('div.comment-list');
    var status = h('div');
    el.appendChild(list); el.appendChild(status);
    var cursor = null, done = false, loading = false;

    function commentEl(c, isReply) {
      var node = h('div.comment' + (isReply ? '.reply' : ''),
        h('div.comment-main.focusable', {
          onclick: function () {
            if (!post.canComment) return;
            replyTo = c; replyLabel.textContent = 'Replying to ' + c.user.name;
            Focus.set(input);
          }
        },
          h('div.avatar.small', { style: c.user.avatar ? { backgroundImage: 'url("' + c.user.avatar + '")' } : {} }),
          h('div.comment-text',
            h('div.comment-head', h('b', c.user.name), c.byCreator ? h('span.creator-badge', 'Creator') : null, h('span.muted', '  ' + U.timeAgo(c.created) + (c.votes ? '  ·  ' + c.votes + ' likes' : ''))),
            h('div.comment-body', c.body))));
      if (!isReply && c.replies) {
        var replies = h('div.replies');
        if (c.firstReply && c.replies === 1) replies.appendChild(commentEl(c.firstReply, true));
        else {
          var more = h('div.link-btn.focusable', {
            onclick: function () {
              more.textContent = 'Loading…';
              Api.replies(c.id).then(function (page) {
                replies.removeChild(more);
                page.items.forEach(function (r) { replies.appendChild(commentEl(r, true)); });
                var first = replies.querySelector('.focusable'); if (first) Focus.set(first);
              }).catch(function (err) { more.textContent = 'Could not load replies (' + err.message + ')'; });
            }
          }, 'Show ' + c.replies + ' repl' + (c.replies === 1 ? 'y' : 'ies'));
          replies.appendChild(more);
        }
        node.appendChild(replies);
      }
      node.querySelector('.comment-main').addEventListener('tvfocus', function () {
        var all = list.querySelectorAll(':scope > .comment');
        if (all.length && node === all[all.length - 1] || (all.length > 3 && node === all[all.length - 3])) load();
      });
      return node;
    }

    function load() {
      if (loading || done) return;
      loading = true;
      U.clear(status).appendChild(spinner());
      Api.comments(post.id, cursor).then(function (page) {
        loading = false; U.clear(status);
        cursor = page.next; done = !page.next || !page.items.length;
        page.items.forEach(function (c) { list.appendChild(commentEl(c)); });
        if (!list.children.length) status.appendChild(h('div.empty', 'No comments yet.'));
        focusIntoScreen(sc);
      }).catch(function (err) {
        loading = false; U.clear(status);
        var e = App.handleError(err, load); if (e) status.appendChild(e);
      });
    }
    function reload() { U.clear(list); cursor = null; done = false; load(); }
    load();
    return sc;
  };

  // ----- search -----
  Views.search = function () {
    var el = h('div.page.scroll-y');
    var sc = screen('search', 'search', el);
    var input = h('input.input.focusable.search-input#in-search', { type: 'search', placeholder: 'Search creators', dataset: { autofocus: '1' } });
    input.dataset.submit = 'btn-search';
    var results = h('div');
    var btn = h('div.btn.focusable#btn-search', { onclick: run }, 'Search');
    el.appendChild(h('div.page-head', h('h1', 'Search')));
    el.appendChild(h('div.compose', input, btn));
    el.appendChild(results);
    var last = Store.get('lastSearch', '');
    if (last) { input.value = last; setTimeout(run, 0); }

    function run() {
      var q = input.value.trim();
      if (!q) { input.focus(); return; }
      Store.set('lastSearch', q);
      U.clear(results).appendChild(spinner());
      Api.search(q).then(function (list) {
        U.clear(results);
        if (!list.length) { results.appendChild(h('div.empty', 'No creators found for "' + q + '".')); return; }
        var g = h('div.grid.creators');
        list.forEach(function (c) { g.appendChild(creatorTile(c)); });
        results.appendChild(g);
      }).catch(function (err) {
        U.clear(results);
        var e = App.handleError(err, run); if (e) results.appendChild(e);
      });
    }
    return sc;
  };

  // ----- settings -----
  Views.settings = function () {
    var el = h('div.page.scroll-y');
    var sc = screen('settings', 'settings', el);
    function draw() {
      var s = Store.settings();
      U.clear(el);
      el.appendChild(h('div.page-head', h('h1', 'Settings')));
      function toggle(label, key, help) {
        return h('div.setting.focusable', { onclick: function () { var p = {}; p[key] = !Store.settings()[key]; Store.saveSettings(p); var f = label; draw(); refocus(f); } },
          h('div', h('div.setting-label', label), help ? h('div.muted', help) : null), h('div.switch' + (s[key] ? '.on' : '')));
      }
      function choice(label, key, values, fmt) {
        return h('div.setting.focusable', {
          onclick: function () {
            var i = values.indexOf(Store.settings()[key]); var p = {}; p[key] = values[(i + 1) % values.length];
            Store.saveSettings(p); draw(); refocus(label);
          }
        }, h('div.setting-label', label), h('div.setting-value', fmt(s[key])));
      }
      var u = App.user;
      el.appendChild(h('section.section', h('h2', 'Account'),
        h('div.setting', h('div', h('div.setting-label', u ? u.name : 'Not signed in'), u && u.email ? h('div.muted', u.email) : null)),
        h('div.setting', h('div', h('div.setting-label', 'Connection'), h('div.muted', s.mode === 'demo' ? 'Sample data (web preview)' : 'Signed in on patreon.com'))),
        s.mode === 'demo' ? null : h('div.setting.focusable.danger', {
          onclick: function () {
            App.confirm('Sign out?', 'You can sign in again with any method Patreon offers.', 'Sign out', function () {
              Store.del('user'); location.href = Api.logoutUrl();
            });
          }
        }, h('div.setting-label', 'Sign out'))));
      el.appendChild(h('section.section', h('h2', 'Playback'),
        toggle('Play next video automatically', 'autoplayNext'),
        choice('Seek step for ◀ ▶', 'seekStep', [5, 10, 15, 30], function (v) { return v + ' seconds'; }),
        h('div.setting.focusable', { onclick: function () { Store.set('progress', {}); U.toast('Watch history cleared'); } }, h('div.setting-label', 'Clear watch history'))));
      el.appendChild(h('section.section', h('h2', 'Content'),
        toggle('Blur adult creators', 'blurNsfw', 'Blurs thumbnails from creators marked 18+'),
        toggle('Show locked posts', 'showLocked', 'Posts above your tier appear with a lock')));
      el.appendChild(h('section.section', h('h2', 'Remote'),
        h('div.help-grid',
          h('div', 'OK'), h('div', 'Open, or play and pause'),
          h('div', '◀ ▶'), h('div', 'Seek in the player'),
          h('div', '▶❚❚'), h('div', 'Play the focused post right away'),
          h('div', 'CH ▲ ▼'), h('div', 'Next or previous in the player'),
          h('div', 'Red'), h('div', 'Restart the current video'),
          h('div', 'Yellow'), h('div', 'Show the audio player'),
          h('div', 'Back'), h('div', 'Go back, or close the player'))));
      el.appendChild(h('section.section', h('h2', 'About'),
        h('p.muted', U.appName() + ' ' + (global.APP_VERSION || '') + '. An independent app, not made or endorsed by Patreon.')));
    }
    function refocus(label) {
      var m = Array.prototype.filter.call(el.querySelectorAll('.setting.focusable'), function (x) { return x.textContent.indexOf(label) === 0; })[0];
      if (m) Focus.set(m);
    }
    draw();
    return sc;
  };

  global.Views = Views;
})(window);
