/* Full-screen video player, background audio player with a now-playing bar, and embed viewer. */
(function (global) {
  'use strict';
  var h = U.h;

  // Plays url in media, trying the TV's own player and hls.js in turn until one works.
  // onFail(message) is called only when every way has failed.
  function attachSource(media, url, isHls, onFail) {
    detach(media);
    var canHlsJs = !!(global.Hls && Hls.isSupported());
    var nativeHls = !!(media.canPlayType('application/vnd.apple.mpegurl') || media.canPlayType('application/x-mpegURL'));
    // HLS goes through hls.js first, even on the TV: its requests come from this page, so they carry patreon.com's
    // Referer, which Patreon's video host (Mux) requires. Samsung's own player may not send it.
    var order = isHls ? ['hlsjs', 'native'] : ['native', 'hlsjs'];  // MP4/MP3 play directly
    order = order.filter(function (w) { return w === 'native' || canHlsJs; });
    if (isHls && !nativeHls && canHlsJs) order = order.filter(function (w) { return w !== 'native'; });
    var errors = [];
    var st = { alive: true };
    media._state = st;

    function next(reason) {
      if (!st.alive) return;
      if (reason) errors.push(reason);
      if (media._hls) { media._hls.destroy(); media._hls = null; }
      var way = order.shift();
      if (!way) { st.alive = false; if (onFail) onFail(errors.join('; ') || 'unknown error'); return; }
      if (way === 'native') {
        var onErr = function () {
          media.removeEventListener('error', onErr);
          var c = media.error ? media.error.code : 0;
          next('player code ' + c + (c === 4 ? ' (format not supported or the server refused it)' : c === 2 ? ' (network)' : c === 3 ? ' (decode)' : ''));
        };
        st.cleanup = function () { media.removeEventListener('error', onErr); };
        media.addEventListener('error', onErr);
        media.src = url;
        var p = media.play(); if (p && p.catch) p.catch(function () { /* autoplay blocked or failed; error event reports it */ });
      } else {
        media.removeAttribute('src');
        var hls = new Hls({ enableWorker: !global.PTV_SITE, maxBufferLength: 30, capLevelToPlayerSize: true, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3 });
        var recovered = false;
        hls.on(Hls.Events.ERROR, function (ev, data) {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
          var code = data.response && data.response.code;
          next('hls.js ' + data.details + (code ? ' HTTP ' + code : ''));
        });
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
          var p2 = media.play(); if (p2 && p2.catch) p2.catch(function () {});
        });
        hls.loadSource(url);
        hls.attachMedia(media);
        media._hls = hls;
      }
    }
    next();
  }

  function detach(media) {
    if (media._state) { media._state.alive = false; if (media._state.cleanup) media._state.cleanup(); media._state = null; }
    if (media._hls) { media._hls.destroy(); media._hls = null; }
    media.removeAttribute('src');
    try { media.load(); } catch (e) { /* ignore */ }
  }

  // ---------------- shared transport (video and audio use the same controls) ----------------

  function Transport(media, post, opts) {
    this.media = media;
    this.post = post;
    this.opts = opts || {};
    this.pendingSeek = null;
    this.saveTimer = null;
  }
  Transport.prototype.toggle = function () { if (this.media.paused) this.media.play(); else this.media.pause(); };
  Transport.prototype.seekBy = function (delta) {
    var m = this.media;
    var base = this.pendingSeek !== null ? this.pendingSeek : m.currentTime;
    var dur = isFinite(m.duration) ? m.duration : Infinity;
    this.pendingSeek = Math.max(0, Math.min(dur - 1, base + delta));
    var self = this;
    clearTimeout(this._seekT);
    if (this.opts.onPendingSeek) this.opts.onPendingSeek(this.pendingSeek);
    this._seekT = setTimeout(function () {
      m.currentTime = self.pendingSeek;
      self.pendingSeek = null;
      if (self.opts.onPendingSeek) self.opts.onPendingSeek(null);
    }, 650);
  };
  Transport.prototype.save = function () {
    var m = this.media;
    var media = this.post.video || this.post.audio || {};
    var dur = isFinite(m.duration) ? m.duration : media.duration;
    if (m.currentTime > 0 && dur) Progress.save(this.post, m.currentTime, dur);
  };
  Transport.prototype.startSaving = function () {
    var self = this;
    clearInterval(this.saveTimer);
    this.saveTimer = setInterval(function () { if (!self.media.paused) self.save(); }, 5000);
  };
  Transport.prototype.stop = function () { clearInterval(this.saveTimer); clearTimeout(this._seekT); this.save(); };
  Transport.prototype.resume = function () {
    var p = Progress.get(this.post.id);
    var m = this.media;
    if (p && p.position > 5 && (!p.duration || p.position / p.duration < 0.95)) {
      var once = function () {
        m.removeEventListener('loadedmetadata', once);
        try { m.currentTime = p.position; } catch (e) { /* not seekable yet */ }
        U.toast('Resumed at ' + U.duration(p.position) + '. Press the red button to start over.', 4000);
      };
      m.addEventListener('loadedmetadata', once);
    }
  };
  Transport.prototype.key = function (a) {
    var step = Store.settings().seekStep;
    switch (a) {
      case 'enter': case 'playpause': this.toggle(); return true;
      case 'play': this.media.play(); return true;
      case 'pause': this.media.pause(); return true;
      case 'left': this.seekBy(-step); return true;
      case 'right': this.seekBy(step); return true;
      case 'rw': this.seekBy(-30); return true;
      case 'ff': this.seekBy(30); return true;
      case 'red': this.media.currentTime = 0; this.media.play(); return true;
    }
    return false;
  };

  // ---------------- video ----------------

  var video = { el: null, media: null, transport: null, post: null, queue: null, index: 0, hideT: null };

  function buildVideo() {
    var media = h('video', { preload: 'auto', playsinline: true });
    var el = h('div#player.overlay.player.hidden',
      media,
      h('div.player-spinner.hidden'),
      h('div.player-chrome',
        h('div.player-top', h('div.player-title'), h('div.player-sub')),
        h('div.player-bottom',
          h('div.player-bar', h('div.player-buffer'), h('div.player-fill'), h('div.player-seek')),
          h('div.player-times', h('span.player-cur', '0:00'), h('span.player-state'), h('span.player-dur', '0:00')),
          h('div.player-hints', 'OK play/pause   ◀ ▶ seek   ▲ ▼ show controls   Back close')
        )
      )
    );
    el.id = 'player';
    document.body.appendChild(el);
    video.el = el;
    video.media = media;

    var q = function (s) { return el.querySelector(s); };
    media.addEventListener('timeupdate', function () { if (video.transport && video.transport.pendingSeek === null) paint(); });
    media.addEventListener('progress', paint);
    media.addEventListener('durationchange', paint);
    media.addEventListener('waiting', function () { q('.player-spinner').classList.remove('hidden'); });
    media.addEventListener('playing', function () { q('.player-spinner').classList.add('hidden'); showChrome(); });
    media.addEventListener('canplay', function () { q('.player-spinner').classList.add('hidden'); });
    media.addEventListener('pause', function () { showChrome(true); paint(); });
    media.addEventListener('play', paint);
    media.addEventListener('ended', function () {
      Progress.finish(video.post.id);
      if (Store.settings().autoplayNext) playNext(1);
    });

    function paint(pending) {
      var d = isFinite(media.duration) ? media.duration : (video.post && video.post.video && video.post.video.duration) || media.duration;
      var t = typeof pending === 'number' ? pending : media.currentTime;
      q('.player-cur').textContent = U.duration(t);
      q('.player-dur').textContent = isFinite(d) ? U.duration(d) : 'LIVE';
      q('.player-fill').style.width = (isFinite(d) && d ? (media.currentTime / d * 100) : 0) + '%';
      q('.player-seek').style.left = (isFinite(d) && d ? (t / d * 100) : 0) + '%';
      q('.player-seek').classList.toggle('active', typeof pending === 'number');
      var b = media.buffered;
      if (b && b.length && isFinite(d) && d) q('.player-buffer').style.width = (b.end(b.length - 1) / d * 100) + '%';
      q('.player-state').textContent = media.paused ? 'Paused' : '';
    }
    video.paint = paint;
  }

  function showChrome(sticky) {
    video.el.classList.add('chrome');
    clearTimeout(video.hideT);
    if (!sticky && !video.media.paused) video.hideT = setTimeout(function () { video.el.classList.remove('chrome'); }, 4000);
  }

  function openVideo(post, queue, index) {
    if (!video.el) buildVideo();
    Audio.pause();
    if (video.transport) video.transport.stop();
    video.post = post; video.queue = queue || [post]; video.index = index || 0;
    video.el.querySelector('.player-title').textContent = post.title;
    video.el.querySelector('.player-sub').textContent = (post.campaign ? post.campaign.name + '  ·  ' : '') + U.timeAgo(post.published);
    video.el.classList.remove('hidden');
    video.el.querySelector('.player-spinner').classList.remove('hidden');
    video.transport = new Transport(video.media, post, { onPendingSeek: function (t) { showChrome(); video.paint(t === null ? undefined : t); } });
    video.transport.resume();
    video.transport.startSaving();
    attachSource(video.media, post.video.url, post.video.hls, function (why) {
      video.el.querySelector('.player-spinner').classList.add('hidden');
      Player.failed(post, 'This video could not be played', why);
    });
    showChrome();
    Player.active = 'video';
  }

  function playNext(dir) {
    var q = video.queue || [];
    for (var i = video.index + dir; i >= 0 && i < q.length; i += dir) {
      if (q[i].video && q[i].canView) { openVideo(q[i], q, i); return true; }
    }
    if (dir > 0) closeVideo();
    return false;
  }

  function closeVideo() {
    if (!video.el) return;
    if (video.transport) video.transport.stop();
    video.media.pause();
    detach(video.media);
    video.el.classList.add('hidden');
    Player.active = null;
    if (Player.onClose) Player.onClose();
  }

  // ---------------- audio (keeps playing while you browse) ----------------

  var Audio = {
    el: null, media: null, transport: null, post: null, queue: null, index: 0, bar: null,
    build: function () {
      var media = h('audio', { preload: 'auto' });
      document.body.appendChild(media);
      Audio.media = media;
      Audio.el = h('div#audioview.overlay.audioview.hidden',
        h('div.audio-art'),
        h('div.audio-info',
          h('div.audio-creator'), h('h1.audio-title'),
          h('div.player-bar', h('div.player-buffer'), h('div.player-fill'), h('div.player-seek')),
          h('div.player-times', h('span.player-cur', '0:00'), h('span.player-state'), h('span.player-dur', '0:00')),
          h('div.player-hints', 'OK play/pause   ◀ ▶ seek   CH▲▼ next/previous   Back keeps playing in the background')
        )
      );
      document.body.appendChild(Audio.el);
      Audio.bar = h('div#nowplaying.nowplaying.hidden', h('div.np-art'), h('div.np-text', h('div.np-title'), h('div.np-sub')),
        h('div.np-state'), h('div.np-fill'));
      document.body.appendChild(Audio.bar);
      ['timeupdate', 'play', 'pause', 'durationchange', 'progress'].forEach(function (ev) { media.addEventListener(ev, Audio.paint); });
      media.addEventListener('ended', function () { Progress.finish(Audio.post.id); if (!Audio.next(1)) Audio.paint(); });
    },
    open: function (post, queue, index) {
      if (!Audio.media) Audio.build();
      if (Audio.post && Audio.post.id === post.id) { Audio.show(); return; }
      if (Audio.transport) Audio.transport.stop();
      Audio.post = post; Audio.queue = queue || [post]; Audio.index = index || 0;
      Audio.transport = new Transport(Audio.media, post, { onPendingSeek: function (t) { Audio.paint(t); } });
      Audio.transport.resume();
      Audio.transport.startSaving();
      attachSource(Audio.media, post.audio.url, /\.m3u8(\?|$)/.test(post.audio.url), function (why) {
        Player.failed(post, 'This audio could not be played', why);
      });
      var art = post.thumb || (post.campaign && post.campaign.avatar) || '';
      Audio.el.querySelector('.audio-art').style.backgroundImage = art ? 'url("' + art + '")' : '';
      Audio.el.querySelector('.audio-title').textContent = post.title;
      Audio.el.querySelector('.audio-creator').textContent = post.campaign ? post.campaign.name : '';
      Audio.bar.querySelector('.np-art').style.backgroundImage = art ? 'url("' + art + '")' : '';
      Audio.bar.querySelector('.np-title').textContent = post.title;
      Audio.bar.querySelector('.np-sub').textContent = post.campaign ? post.campaign.name : '';
      Audio.show();
    },
    show: function () { Audio.el.classList.remove('hidden'); Audio.bar.classList.add('hidden'); Player.active = 'audio'; },
    hide: function () {
      Audio.el.classList.add('hidden');
      Player.active = null;
      if (Audio.post) Audio.bar.classList.remove('hidden');
      if (Player.onClose) Player.onClose();
    },
    next: function (dir) {
      var q = Audio.queue || [];
      for (var i = Audio.index + dir; i >= 0 && i < q.length; i += dir) {
        if (q[i].audio && q[i].canView) { var vis = Player.active === 'audio'; Audio.post = null; Audio.open(q[i], q, i); if (!vis) Audio.hide(); return true; }
      }
      return false;
    },
    pause: function () { if (Audio.media && !Audio.media.paused) Audio.media.pause(); },
    stop: function () {
      if (!Audio.media) return;
      if (Audio.transport) Audio.transport.stop();
      Audio.media.pause(); detach(Audio.media);
      Audio.post = null; Audio.bar.classList.add('hidden'); Audio.el.classList.add('hidden');
    },
    paint: function (pending) {
      var m = Audio.media, el = Audio.el;
      if (!el) return;
      var d = m.duration, t = typeof pending === 'number' ? pending : m.currentTime;
      el.querySelector('.player-cur').textContent = U.duration(t);
      el.querySelector('.player-dur').textContent = isFinite(d) ? U.duration(d) : '';
      var pct = isFinite(d) && d ? m.currentTime / d * 100 : 0;
      el.querySelector('.player-fill').style.width = pct + '%';
      el.querySelector('.player-seek').style.left = (isFinite(d) && d ? t / d * 100 : 0) + '%';
      el.querySelector('.player-state').textContent = m.paused ? 'Paused' : '';
      Audio.bar.querySelector('.np-fill').style.width = pct + '%';
      Audio.bar.querySelector('.np-state').textContent = m.paused ? 'Paused' : '';
    }
  };

  // ---------------- embeds (YouTube / Vimeo) ----------------

  var embed = { el: null, frame: null, link: null, post: null, state: -1, time: 0, timer: null };
  function send(msg) {
    try { embed.frame.contentWindow.postMessage(JSON.stringify(msg), '*'); } catch (e) { /* frame gone */ }
  }
  // YouTube and Vimeo players report state and errors over postMessage once asked to.
  function onEmbedMessage(e) {
    if (!embed.frame || e.source !== embed.frame.contentWindow) return;
    var d = e.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { return; } }
    if (!d) return;
    if (d.event === 'onError' || d.event === 'error') {
      var code = d.info && d.info.code || d.info || (d.data && d.data.name) || '';
      embedTrouble(code === 101 || code === 150 ? 'The creator of this video doesn\'t allow it to play outside YouTube.' : 'The ' + embed.link.provider + ' player reported error ' + code + '.');
    }
    if (d.event === 'onReady' || d.event === 'ready') {
      if (embed.link.provider === 'Vimeo') ['play', 'pause', 'error', 'timeupdate', 'finish'].forEach(function (ev) { send({ method: 'addEventListener', value: ev }); });
    }
    if (d.event === 'infoDelivery' && d.info) {
      if (typeof d.info.playerState === 'number') embed.state = d.info.playerState;
      if (typeof d.info.currentTime === 'number') embed.time = d.info.currentTime;
      if (d.info.duration > 0) embed.duration = d.info.duration;
    }
    if (d.event === 'onStateChange') embed.state = d.info;
    if (d.event === 'play' || d.event === 'playProgress' || d.event === 'timeupdate') {
      embed.state = 1;
      if (d.data && d.data.seconds != null) embed.time = d.data.seconds;
      if (d.data && d.data.duration > 0) embed.duration = d.data.duration;
    }
    if (d.event === 'pause') embed.state = 2;
    if (d.event === 'finish') embed.state = 0;
    if (embed.state === 1) hideTrouble();
    embedProgress();
  }
  // The post's own YouTube or Vimeo video gets a resume point and counts as watched near the end, like Patreon's.
  function mainEmbed() { return embed.post && embed.post.embed && embed.link && embed.post.embed.url === embed.link.url; }
  function embedProgress() {
    if (!mainEmbed() || embed.done) return;
    if (embed.state === 0 || (embed.duration && embed.time / embed.duration >= 0.9)) {
      embed.done = true;
      Progress.finish(embed.post.id);
    } else if (embed.duration && embed.time > 5 && Date.now() - (embed.saved || 0) > 5000) {
      embed.saved = Date.now();
      Progress.save(embed.post, embed.time, embed.duration);
    }
  }
  // YouTube can still go to the TV's YouTube app when its player won't play here; anything else goes to the phone.
  function youtubeApp() { return Host.tv() && embed.link && embed.link.provider === 'YouTube'; }
  function embedTrouble(why) {
    var t = embed.el.querySelector('.embed-trouble');
    t.querySelector('.why').textContent = why;
    t.querySelector('.what').textContent = youtubeApp() ? 'Press OK to open it in the YouTube app instead.' : 'Press OK to watch it on your phone instead.';
    t.classList.remove('hidden');
  }
  function hideTrouble() {
    clearTimeout(embed.timer);
    embed.el.querySelector('.embed-trouble').classList.add('hidden');
  }
  function openEmbed(link, post) {
    Audio.pause();
    if (!embed.el) {
      embed.el = h('div#embed.overlay.embedview.hidden', h('div.embed-frame'),
        h('div.embed-hint', h('span.embed-time'), h('span', 'OK: play or pause  ·  ◀ ▶: seek  ·  Back: close')),
        h('div.embed-trouble.hidden', h('p.why'), h('p.what')));
      document.body.appendChild(embed.el);
      global.addEventListener('message', onEmbedMessage);
    }
    var src = link.player;
    embed.link = link; embed.post = post; embed.state = -1; embed.time = link.start || 0; embed.duration = 0; embed.done = false; embed.saved = 0;
    var prog = mainEmbed() && Progress.get(post.id);
    if (prog && prog.position > 5 && (!prog.duration || prog.position / prog.duration < 0.9)) {
      embed.time = Math.floor(prog.position);
      if (link.provider === 'YouTube') src = src.replace(/&start=\d+/, '') + '&start=' + embed.time;
      else src = src.split('#')[0] + '#t=' + embed.time + 's';
      U.toast('Resuming at ' + U.duration(embed.time) + '. Choose Start over on the post to begin again.', 4000);
    }
    if (link.provider === 'YouTube' && /^https?:/.test(location.protocol)) src += '&origin=' + encodeURIComponent(location.origin);
    embed.frame = h('iframe', { src: src, allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', tabIndex: -1, frameBorder: 0 });
    embed.frame.addEventListener('load', function () {
      if (link.provider === 'YouTube') send({ event: 'listening', id: 'ptv', channel: 'widget' });
      else send({ method: 'ping' });
    });
    U.clear(embed.el.querySelector('.embed-frame')).appendChild(embed.frame);
    embed.el.querySelector('.embed-trouble').classList.add('hidden');
    embed.el.classList.remove('hidden');
    Player.active = 'embed';
    flashHint();
    clearTimeout(embed.timer);
    embed.timer = setTimeout(function () {
      if (embed.state !== 1 && embed.state !== 2 && embed.state !== 3) embedTrouble('Not playing?');
    }, 12000);
    // Keep key events in our document so Back still works.
    setTimeout(function () { try { global.focus(); } catch (e) { /* ignore */ } }, 500);
  }
  // The key hint shows for a few seconds when the video opens and after each key, then gets out of the way.
  function flashHint() {
    var hint = embed.el.querySelector('.embed-hint');
    hint.querySelector('.embed-time').textContent = embed.duration ? U.duration(embed.time) + ' / ' + U.duration(embed.duration) : '';
    hint.classList.remove('gone');
    clearTimeout(embed.hintTimer);
    embed.hintTimer = setTimeout(function () { hint.classList.add('gone'); }, 4000);
  }
  function embedKey(a) {
    var yt = embed.link.provider === 'YouTube', step = Store.settings().seekStep;
    var trouble = !embed.el.querySelector('.embed-trouble').classList.contains('hidden');
    if ((a === 'enter' && trouble) || a === 'blue') {
      var link = embed.link;
      var phone = function () { App.qr('Watch on your phone', link.url); };
      var app = a === 'enter' && youtubeApp();
      closeEmbed();
      if (app) Host.youtube(link, phone); else phone();
      return;
    }
    if (a === 'enter' || a === 'playpause') a = embed.state === 1 ? 'pause' : 'play';
    if (a === 'play') send(yt ? { event: 'command', func: 'playVideo', args: [] } : { method: 'play' });
    else if (a === 'pause') send(yt ? { event: 'command', func: 'pauseVideo', args: [] } : { method: 'pause' });
    else if (a === 'left' || a === 'right' || a === 'rw' || a === 'ff') {
      var t = Math.max(0, embed.time + ((a === 'left' || a === 'rw') ? -1 : 1) * (a === 'ff' || a === 'rw' ? 30 : step));
      embed.time = t;
      send(yt ? { event: 'command', func: 'seekTo', args: [t, true] } : { method: 'setCurrentTime', value: t });
    }
    flashHint();
  }
  function closeEmbed() {
    if (mainEmbed() && !embed.done && embed.duration && embed.time > 5) Progress.save(embed.post, embed.time, embed.duration);
    clearTimeout(embed.timer);
    clearTimeout(embed.hintTimer);
    U.clear(embed.el.querySelector('.embed-frame'));
    embed.frame = null;
    embed.el.classList.add('hidden');
    Player.active = null;
    if (Player.onClose) Player.onClose();
  }
  // Plays a YouTube or Vimeo link inside the app. The app runs as patreon.com, so YouTube's player gets the web
  // page it expects; the TV's YouTube app is only offered when a video won't play here.
  function openLink(link, post) {
    if (!link || !link.player) return false;
    openEmbed(link, post);
    return true;
  }

  var Player = {
    active: null,
    onClose: null,
    // Shows why playback failed, with a way to open the post elsewhere.
    failed: function (post, title, why) {
      if (global.console) console.warn('[playback]', title, why, post.video || post.audio);
      var m = App.modal([
        U.h('h2', title),
        U.h('p.muted', 'Details: ' + why),
        U.h('p', 'Open the post on your phone to watch it there, and send these details to whoever maintains this app.'),
        U.h('div.btn-row',
          U.h('div.btn.focusable', { onclick: function () { m.close(); if (post.url) App.qr('Open this post on your phone', post.url); } }, 'Open on phone'),
          U.h('div.btn.secondary.focusable', { onclick: function () { m.close(); } }, 'Close'))
      ]);
    },
    play: function (post, queue, index) {
      if (post.video) openVideo(post, queue, index);
      else if (post.audio) Audio.open(post, queue, index);
      else if (post.embed && post.embed.player) openLink(post.embed, post);
      else return false;
      return true;
    },
    openLink: openLink,
    audio: Audio,
    // Returns true when the key was consumed by a player.
    key: function (a) {
      if (Player.active === 'video') {
        if (a === 'back' || a === 'stop') { closeVideo(); return true; }
        if (a === 'next') { playNext(1); return true; }
        if (a === 'prev') { playNext(-1); return true; }
        if (a === 'up' || a === 'down') { showChrome(); return true; }
        if (video.transport.key(a)) { showChrome(); return true; }
        return true;
      }
      if (Player.active === 'audio') {
        if (a === 'back') { Audio.hide(); return true; }
        if (a === 'stop') { Audio.stop(); Player.active = null; if (Player.onClose) Player.onClose(); return true; }
        if (a === 'next') { Audio.next(1); return true; }
        if (a === 'prev') { Audio.next(-1); return true; }
        Audio.transport.key(a);
        return true;
      }
      if (Player.active === 'embed') {
        if (a === 'back' || a === 'stop') closeEmbed();
        else embedKey(a);
        return true;
      }
      // Background audio responds to media keys while browsing.
      if (Audio.post && Audio.transport) {
        if (a === 'playpause' || a === 'play' || a === 'pause' || a === 'ff' || a === 'rw') { Audio.transport.key(a); return true; }
        if (a === 'next' || a === 'prev') { Audio.next(a === 'next' ? 1 : -1); return true; }
        if (a === 'stop') { Audio.stop(); return true; }
        if (a === 'yellow') { Audio.show(); return true; }
      }
      return false;
    }
  };

  global.Player = Player;
})(window);
