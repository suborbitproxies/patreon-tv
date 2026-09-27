/* Small helpers shared by every screen. Plain ES2017 so it runs on 2019+ Tizen (Chromium 63+). */
(function (global) {
  'use strict';

  // h('div.card.focusable', {onclick: fn, dataset: {id: 1}}, child, 'text', [children])
  function h(tag, props) {
    var idMatch = tag.match(/#([\w-]+)/);
    var parts = tag.replace(/#[\w-]+/, '').split('.');
    var el = document.createElement(parts[0] || 'div');
    if (idMatch) el.id = idMatch[1];
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    var start = 1;
    if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
      start = 2;
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (s) { el.style[s] = v[s]; });
        else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'className') el.className += (el.className ? ' ' : '') + v;
        else if (k in el && k !== 'list') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = start; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }


  var ICONS = {
    play: 'M8 5v14l11-7z',
    back: 'M15.4 5.4L14 4l-8 8 8 8 1.4-1.4L8.8 12z',
    pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
    audio: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3z',
    image: 'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 12.5l2.5 3 3.5-4.5 4.5 6H5z',
    text: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z',
    poll: 'M5 9h3v10H5zm5.5-5h3v15h-3zM16 13h3v6h-3z',
    link: 'M14 3h7v7h-2V6.4l-8.3 8.3-1.4-1.4L17.6 5H14zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    lock: 'M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 0 1 6 0v3z',
    heart: 'M12 21s-7-4.35-9.5-8.5C.5 8.5 3 4 7 4c2 0 3.5 1 5 3 1.5-2 3-3 5-3 4 0 6.5 4.5 4.5 8.5C19 16.65 12 21 12 21z',
    comment: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    home: 'M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z',
    star: 'M12 2l3 6.9 7.5.6-5.7 5 1.7 7.4L12 18l-6.5 3.9 1.7-7.4-5.7-5 7.5-.6z',
    search: 'M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z',
    gear: 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.3 7.3 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.3 7.3 0 0 0 1.7 1L11 21h4l.4-2.9a7.3 7.3 0 0 0 1.7-1l2.5 1 2-3.5zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
    download: 'M11 3h2v10l3.5-3.5 1.4 1.4L12 16.8l-5.9-5.9 1.4-1.4L11 13zM4 19h16v2H4z'
  };
  // Inline SVG icons: TV system fonts lack most symbols and emoji.
  function icon(name, cls) {
    var span = document.createElement('span');
    span.className = 'icon' + (cls ? ' ' + cls : '');
    span.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + (ICONS[name] || '') + '"/></svg>';
    return span;
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function timeAgo(iso) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
    return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function duration(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    sec = Math.floor(sec);
    var hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return hh ? hh + ':' + p(mm) + ':' + p(ss) : mm + ':' + p(ss);
  }

  function count(n) {
    n = typeof n === 'number' && isFinite(n) ? n : 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  function money(cents, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format((cents || 0) / 100);
    } catch (e) { return '$' + ((cents || 0) / 100).toFixed(2); }
  }

  // Keep only safe, display-only markup from Patreon's post HTML.
  var ALLOWED = { P: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, A: 1, UL: 1, OL: 1, LI: 1, H1: 1, H2: 1, H3: 1, H4: 1,
    BLOCKQUOTE: 1, PRE: 1, CODE: 1, IMG: 1, FIGURE: 1, FIGCAPTION: 1, HR: 1, SPAN: 1, DIV: 1 };
  function sanitize(html) {
    var doc = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html');
    var root = doc.body.firstChild;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1) { node.removeChild(c); return; }
        if (!ALLOWED[c.tagName]) {
          if (c.tagName === 'SCRIPT' || c.tagName === 'STYLE' || c.tagName === 'IFRAME') { node.removeChild(c); return; }
          walk(c);
          while (c.firstChild) node.insertBefore(c.firstChild, c);
          node.removeChild(c);
          return;
        }
        Array.prototype.slice.call(c.attributes).forEach(function (a) {
          var keep = (c.tagName === 'A' && a.name === 'href') || (c.tagName === 'IMG' && a.name === 'src');
          if (!keep || /^\s*javascript:/i.test(a.value)) c.removeAttribute(a.name);
        });
        walk(c);
      });
    })(root);
    return root.innerHTML;
  }

  // Patreon's newer editor stores posts as TipTap/ProseMirror JSON.
  function tiptapToHtml(json) {
    var doc;
    try { doc = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return ''; }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function node(n) {
      if (!n) return '';
      var inner = (n.content || []).map(node).join('');
      switch (n.type) {
        case 'doc': return inner;
        case 'paragraph': return '<p>' + inner + '</p>';
        case 'heading': var l = Math.min(4, (n.attrs && n.attrs.level) || 2); return '<h' + l + '>' + inner + '</h' + l + '>';
        case 'bulletList': return '<ul>' + inner + '</ul>';
        case 'orderedList': return '<ol>' + inner + '</ol>';
        case 'listItem': return '<li>' + inner + '</li>';
        case 'blockquote': return '<blockquote>' + inner + '</blockquote>';
        case 'codeBlock': return '<pre><code>' + inner + '</code></pre>';
        case 'hardBreak': return '<br>';
        case 'horizontalRule': return '<hr>';
        case 'image': return n.attrs && n.attrs.src ? '<figure><img src="' + esc(n.attrs.src) + '"></figure>' : '';
        case 'text':
          var t = esc(n.text || '');
          (n.marks || []).forEach(function (m) {
            if (m.type === 'bold') t = '<b>' + t + '</b>';
            else if (m.type === 'italic') t = '<i>' + t + '</i>';
            else if (m.type === 'underline') t = '<u>' + t + '</u>';
            else if (m.type === 'strike') t = '<s>' + t + '</s>';
            else if (m.type === 'code') t = '<code>' + t + '</code>';
            else if (m.type === 'link' && m.attrs) t = '<a href="' + esc(m.attrs.href || '') + '">' + t + '</a>';
          });
          return t;
        default: return inner;
      }
    }
    return node(doc);
  }

  // localStorage wrapper that never throws.
  var Store = {
    get: function (k, def) {
      try { var v = localStorage.getItem('ptv.' + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, v) { try { localStorage.setItem('ptv.' + k, JSON.stringify(v)); } catch (e) { /* full or blocked */ } },
    del: function (k) { try { localStorage.removeItem('ptv.' + k); } catch (e) { /* ignore */ } },
    settings: function () {
      var s = Store.get('settings', {});
      return {
        mode: global.PTV_DEMO ? 'demo' : 'site',  // 'site': inside patreon.com; 'demo': sample data
        blurNsfw: s.blurNsfw !== false,
        autoplayNext: s.autoplayNext !== false,
        showLocked: s.showLocked !== false,
        seekStep: s.seekStep || 10
      };
    },
    saveSettings: function (patch) {
      var s = Store.settings();
      Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
      Store.set('settings', s);
      return s;
    }
  };

  // Resume positions and "continue watching" list.
  var Progress = {
    all: function () { return Store.get('progress', {}); },
    get: function (postId) { return Progress.all()[postId] || null; },
    save: function (post, position, dur) {
      var all = Progress.all();
      if (dur && position / dur > 0.95) { delete all[post.id]; }
      else if (position > 5) {
        all[post.id] = { position: position, duration: dur, at: Date.now(),
          post: { id: post.id, title: post.title, thumb: post.thumb, kind: post.kind,
            campaign: post.campaign ? { id: post.campaign.id, name: post.campaign.name, avatar: post.campaign.avatar } : null } };
      }
      var keys = Object.keys(all).sort(function (a, b) { return all[b].at - all[a].at; });
      keys.slice(40).forEach(function (k) { delete all[k]; });
      Store.set('progress', all);
    },
    recent: function () {
      var all = Progress.all();
      return Object.keys(all).map(function (k) { return all[k]; }).sort(function (a, b) { return b.at - a.at; });
    },
    remove: function (postId) { var all = Progress.all(); delete all[postId]; Store.set('progress', all); }
  };

  function toast(msg, ms) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, ms || 3000);
  }

  function qrSvg(text, size) {
    if (!global.qrcode) return h('div', text);
    var qr = global.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var wrap = h('div.qr');
    wrap.innerHTML = qr.createSvgTag({ cellSize: Math.max(2, Math.floor((size || 280) / (qr.getModuleCount() + 8))), margin: 4, scalable: true });
    return wrap;
  }

  function appName() { return global.APP_NAME || 'Patreon TV'; }

  // TV-only actions. The local TV page calls Tizen directly; inside patreon.com the page has no Tizen APIs, so the
  // on-TV helper (app/service/helper.js) does them, listening for '__ptvhost__' console messages.
  var Host = {
    tv: function () { return !!(global.tizen || global.PTV_TV); },
    send: function (msg, reply) {
      if (!global.PTV_TV) return false;
      if (reply) { msg.id = ++hostSeq; hostWaiting[msg.id] = reply; }
      try { console.debug('__ptvhost__' + JSON.stringify(msg)); return true; } catch (e) { return false; }
    },
    exit: function () {
      try { if (global.tizen) { tizen.application.getCurrentApplication().exit(); return; } } catch (e) { /* not available */ }
      if (Host.send({ cmd: 'exit' })) return;
      if (global.PTV_SITE) { Host.leave(); return; }
      try { window.close(); } catch (e) { /* ignore */ }
    },
    // Back to the normal patreon.com (computer add-on).
    leave: function () {
      try { sessionStorage.removeItem('ptv.on'); } catch (e) { /* ignore */ }
      location.href = '/home';
    },
    // Opens a YouTube video in Samsung's YouTube app. fail(err) runs when that is not possible.
    youtube: function (link, fail) {
      if (global.tizen && tizen.application && tizen.ApplicationControl) { launchYouTube(link.id, fail); return; }
      var sent = Host.send({ cmd: 'youtube', video: link.id }, function (r) { if (!r.ok) fail(new Error(r.error || 'YouTube app not found')); });
      if (!sent) fail(new Error('Not on a TV'));
    }
  };
  var hostSeq = 0, hostWaiting = {};
  // The helper answers by calling this in the page.
  global.__ptvHostReply = function (r) {
    var cb = r && hostWaiting[r.id];
    if (cb) { delete hostWaiting[r.id]; cb(r); }
  };

  // The YouTube app's id and deep-link format changed over the years; try the current one first.
  var YOUTUBE_APPS = [
    ['com.samsung.tv.cobalt-yt', '#play?v='],
    ['9Ur5IzDKqV.TizenYouTube', '#play?v='],
    ['111299001912', 'v=']
  ];
  function launchYouTube(id, fail, i) {
    i = i || 0;
    if (i >= YOUTUBE_APPS.length) { fail(new Error('YouTube app not found')); return; }
    try {
      var data = new tizen.ApplicationControlData('PAYLOAD', [YOUTUBE_APPS[i][1] + id]);
      var ctl = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', null, null, null, [data]);
      tizen.application.launchAppControl(ctl, YOUTUBE_APPS[i][0], function () { /* launched */ }, function () { launchYouTube(id, fail, i + 1); });
    } catch (e) { launchYouTube(id, fail, i + 1); }
  }

  global.U = { h: h, icon: icon, appName: appName, clear: clear, timeAgo: timeAgo, duration: duration, count: count, money: money,
    sanitize: sanitize, tiptapToHtml: tiptapToHtml, toast: toast, qrSvg: qrSvg };
  global.Store = Store;
  global.Progress = Progress;
  global.Host = Host;
})(window);
