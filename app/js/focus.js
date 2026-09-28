/* Remote-control input: key mapping and geometric spatial navigation over `.focusable` elements. */
(function (global) {
  'use strict';

  var KEYS = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27, BACKSPACE: 8,
    PLAY_PAUSE: 10252, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412,
    NEXT: 10233, PREV: 10232,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    CH_UP: 427, CH_DOWN: 428
  };

  var MEDIA_KEYS = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'MediaTrackNext', 'MediaTrackPrevious', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    'ChannelUp', 'ChannelDown'];

  function registerTvKeys() {
    try {
      if (global.tizen && tizen.tvinputdevice) {
        MEDIA_KEYS.forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* unsupported key */ } });
      }
    } catch (e) { /* not on a TV */ }
  }

  // Normalises a keydown into an action name.
  function action(e) {
    switch (e.keyCode) {
      case KEYS.LEFT: return 'left';
      case KEYS.RIGHT: return 'right';
      case KEYS.UP: return 'up';
      case KEYS.DOWN: return 'down';
      case KEYS.ENTER: return 'enter';
      case KEYS.BACK: case KEYS.ESC: return 'back';
      case KEYS.BACKSPACE:
        var t = e.target;
        return (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) ? null : 'back';
      case KEYS.PLAY_PAUSE: return 'playpause';
      case KEYS.PLAY: return 'play';
      case KEYS.PAUSE: return 'pause';
      case KEYS.STOP: return 'stop';
      case KEYS.FF: return 'ff';
      case KEYS.RW: return 'rw';
      case KEYS.NEXT: case KEYS.CH_UP: return 'next';
      case KEYS.PREV: case KEYS.CH_DOWN: return 'prev';
      case KEYS.RED: return 'red';
      case KEYS.GREEN: return 'green';
      case KEYS.YELLOW: return 'yellow';
      case KEYS.BLUE: return 'blue';
    }
    if (e.key === ' ' && !(e.target && e.target.tagName === 'INPUT')) return 'playpause';
    return null;
  }

  // A creator's posts can fill a grid with thousands of cards, so a key press must not measure every one of them.
  function usable(el) {
    if (el.disabled || el.classList.contains('hidden')) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.offsetParent !== null;
  }
  function isCandidate(el) {
    return !!el && el.classList.contains('focusable') && (Focus.root || document.body).contains(el) && usable(el);
  }
  function isGridItem(el) {
    var p = el.parentNode;
    return !!(p && p.classList && p.classList.contains('grid'));
  }

  // Inside a grid, the next card is found from its place in the list: the first cards share a row, which gives the columns.
  function gridStep(cur, dir) {
    var kids = cur.parentNode.children, n = kids.length;
    var i = Array.prototype.indexOf.call(kids, cur), top = kids[0].offsetTop, cols = 1, t = -1;
    while (cols < n && kids[cols].offsetTop === top) cols++;
    if (dir === 'left') t = i % cols ? i - 1 : -1;
    else if (dir === 'right') t = i % cols < cols - 1 && i + 1 < n ? i + 1 : -1;
    else if (dir === 'up') t = i - cols;
    else if (i + cols < n) t = i + cols;
    else if (Math.floor(i / cols) < Math.floor((n - 1) / cols)) t = n - 1; // down into a shorter last row
    var el = t >= 0 ? kids[t] : null;
    return el && el.classList.contains('focusable') && usable(el) ? el : null;
  }

  // Focusable elements to consider for a move from rect r: all of them, except that a grid only offers the cards
  // within a screen and a half of r (found by binary search, since its rows run down the page in order).
  function nearCandidates(r) {
    var all = (Focus.root || document.body).getElementsByClassName('focusable');
    var out = [], grids = [], el, i;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      if (isGridItem(el)) { if (grids[grids.length - 1] !== el.parentNode) grids.push(el.parentNode); }
      else if (usable(el)) out.push(el);
    }
    var reach = (window.innerHeight || 1080) * 1.5, from = r.top - reach, to = r.bottom + reach;
    grids.forEach(function (g) {
      if (g.offsetParent === null) return;
      var kids = g.children, lo = 0, hi = kids.length, mid;
      while (lo < hi) { mid = (lo + hi) >> 1; if (kids[mid].getBoundingClientRect().bottom < from) lo = mid + 1; else hi = mid; }
      for (i = lo; i < kids.length; i++) {
        el = kids[i];
        if (el.getBoundingClientRect().top > to) break;
        if (el.classList.contains('focusable') && usable(el)) out.push(el);
      }
    });
    return out;
  }

  var Focus = {
    root: null,      // container that limits navigation (a screen or a modal)
    current: null,

    setRoot: function (el) { Focus.root = el; },

    candidates: function () {
      var root = Focus.root || document.body;
      return Array.prototype.filter.call(root.getElementsByClassName('focusable'), usable);
    },

    set: function (el, opts) {
      if (!el) return;
      if (Focus.current && Focus.current !== el) Focus.current.classList.remove('focused');
      Focus.current = el;
      el.classList.add('focused');
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        if (!(opts && opts.noInputFocus)) { /* keep the IME closed until Enter */ }
      } else if (document.activeElement && document.activeElement !== document.body &&
                 document.activeElement.blur) {
        document.activeElement.blur();
      }
      Focus.reveal(el);
      var ev = document.createEvent('Event');
      ev.initEvent('tvfocus', true, true);
      el.dispatchEvent(ev);
    },

    // Scroll the nearest scrollable parents so the element is fully visible with some margin.
    reveal: function (el) {
      var p = el.parentElement;
      while (p && p !== document.body) {
        var cs = getComputedStyle(p);
        var r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
        if (/(auto|scroll|hidden)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 2) {
          var pad = 80;
          if (r.left < pr.left + pad) p.scrollLeft -= (pr.left + pad - r.left);
          else if (r.right > pr.right - pad) p.scrollLeft += (r.right - pr.right + pad);
        }
        if (/(auto|scroll|hidden)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 2) {
          var padY = 120;
          r = el.getBoundingClientRect();
          var tall = r.height > pr.height - 2 * padY;
          if (tall) {
            // Show the start of tall blocks; the key handler pages through them.
            if (r.top < pr.top || r.top > pr.bottom - padY) p.scrollTop += (r.top - pr.top - padY);
          } else if (r.top < pr.top + padY) p.scrollTop -= (pr.top + padY - r.top);
          else if (r.bottom > pr.bottom - padY) p.scrollTop += (r.bottom - pr.bottom + padY);
        }
        p = p.parentElement;
      }
    },

    first: function (selector) {
      var el = selector ? (Focus.root || document).querySelector(selector) : null;
      if (isCandidate(el)) { Focus.set(el); return true; }
      var all = (Focus.root || document.body).getElementsByClassName('focusable');
      for (var i = 0; i < all.length; i++) if (usable(all[i])) { Focus.set(all[i]); return true; }
      return false;
    },

    ensure: function () {
      if (!isCandidate(Focus.current)) Focus.first();
    },

    moves: 0,

    move: function (dir) {
      Focus.moves++;
      var cur = Focus.current;
      if (!isCandidate(cur)) { Focus.first(); return true; }
      var group = cur.closest('[data-nav-group]');
      var best = isGridItem(cur) ? gridStep(cur, dir) : null;
      if (!best) best = Focus.nearest(cur, dir, group);
      if (best) {
        // When entering a remembered group (e.g. the sidebar or a row), restore its last focused item.
        var g = best.closest('[data-nav-group]');
        if (g && g !== group && g.dataset.remember && g._last && isCandidate(g._last) && !best.dataset.direct) best = g._last;
        if (g && g.dataset.navGroup !== 'chips') g._last = best;
        Focus.set(best);
        return true;
      }
      return false;
    },

    // The closest element in direction dir, by position on screen.
    nearest: function (cur, dir, group) {
      var r = cur.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var best = null, bestScore = Infinity;
      nearCandidates(r).forEach(function (el) {
        if (el === cur) return;
        var o = el.getBoundingClientRect();
        var ox = o.left + o.width / 2, oy = o.top + o.height / 2;
        var primary, secondary;
        // Candidates must lie beyond the current element's edge (or at least have their centre past it).
        if (dir === 'left') { if (!(o.right <= r.left + 10 || ox < r.left)) return; primary = r.left - o.right; secondary = Math.abs(oy - cy); }
        else if (dir === 'right') { if (!(o.left >= r.right - 10 || ox > r.right)) return; primary = o.left - r.right; secondary = Math.abs(oy - cy); }
        else if (dir === 'up') { if (!(o.bottom <= r.top + 10 || oy < r.top)) return; primary = r.top - o.bottom; secondary = Math.abs(ox - cx); }
        else { if (!(o.top >= r.bottom - 10 || oy > r.bottom)) return; primary = o.top - r.bottom; secondary = Math.abs(ox - cx); }
        // The sidebar is only entered sideways.
        if ((dir === 'up' || dir === 'down') && el.closest('#sidebar') && !cur.closest('#sidebar')) return;
        primary = Math.max(0, primary);
        // Overlap on the cross axis is strongly preferred so rows and columns feel natural.
        var overlap = (dir === 'left' || dir === 'right')
          ? Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top)
          : Math.min(r.right, o.right) - Math.max(r.left, o.left);
        var score = primary + secondary * (overlap > 0 ? 0.3 : 2.5);
        // Within a group, and most of all along a row of chips, keep going sideways rather than dropping out of it.
        if (group && el.closest('[data-nav-group]') === group) score *= (dir === 'left' || dir === 'right') && overlap > 0 ? 0.2 : 0.8;
        if (score < bestScore) { bestScore = score; best = el; }
      });
      return best;
    }
  };

  global.KEYS = KEYS;
  global.Focus = Focus;
  global.keyAction = action;
  global.registerTvKeys = registerTvKeys;
})(window);
