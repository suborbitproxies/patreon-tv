/*
 * Patreon client. Patreon's public OAuth API only exposes a creator's own campaign, so, like every
 * third-party Patreon viewer, this uses the JSON:API endpoints the patreon.com website itself calls.
 *
 * The app runs inside a www.patreon.com page (on the TV the built-in helper loads it there; on a computer the
 * Chrome add-on does), so these are ordinary same-origin requests: Patreon's own sign-in cookie, CSRF token and
 * Referer all apply, and nothing sits in between. The browser preview ('demo' mode) answers from sample data.
 */
(function (global) {
  'use strict';

  var PATREON = 'https://www.patreon.com';

  var POST_INCLUDE = 'campaign,access_rules,attachments_media,audio,images,media,poll.choices,' +
    'poll.current_user_responses.choice,user,user_defined_tags';
  var POST_FIELDS =
    '&fields[campaign]=name,avatar_photo_url,url,vanity,is_nsfw,currency' +
    '&fields[post]=comment_count,content,content_json_string,current_user_can_comment,current_user_can_view,' +
    'current_user_has_liked,embed,image,is_paid,like_count,meta_image_url,min_cents_pledged_to_view,post_file,' +
    'post_metadata,published_at,patreon_url,post_type,thumbnail,teaser_text,title,url,video_preview,view_count' +
    '&fields[user]=image_url,full_name,url' +
    '&fields[access_rule]=access_rule_type,amount_cents' +
    '&fields[media]=id,image_urls,download_url,metadata,file_name,mimetype,size_bytes,display' +
    '&fields[post_tag]=tag_type,value';

  function AuthError(msg) { this.name = 'AuthError'; this.message = msg || 'Not signed in'; }
  AuthError.prototype = Object.create(Error.prototype);
  // Patreon's bot check (Cloudflare) answered instead of the API; the page has to be shown so it can pass.
  function ChallengeError() { this.name = 'ChallengeError'; this.message = 'Patreon wants to check this is a real browser.'; }
  ChallengeError.prototype = Object.create(Error.prototype);

  function demo() { return Store.settings().mode === 'demo'; }

  // Patreon checks a CSRF signature on changes (likes, comments). Its pages carry it; fetch one when needed.
  var csrf = null;
  function csrfToken(refresh) {
    if (csrf && !refresh) return Promise.resolve(csrf);
    return fetch('/login', { credentials: 'include' }).then(function (r) { return r.text(); }).then(function (html) {
      var m = html.match(/"csrfSignature"\s*:\s*"([^"]+)"/) || html.match(/csrf[_-]?signature["']?\s*[:=]\s*["']([^"']+)/i);
      csrf = m ? m[1] : '';
      return csrf;
    }).catch(function () { return ''; });
  }

  function request(method, path, body, retried) {
    var url = path;
    // Paging links from Patreon are absolute; keep them on this page's origin.
    if (url.indexOf(PATREON) === 0) url = url.slice(PATREON.length);

    if (demo()) {
      // Sample data answered in the page itself (web preview and tests).
      var r = global.PatreonMock.handle(method, url, body === undefined ? '' : JSON.stringify(body));
      return new Promise(function (resolve) { setTimeout(resolve, 120); }).then(function () {
        return respond(r.status, r.body === undefined ? '' : JSON.stringify(r.body), 'application/json');
      });
    }

    var mutating = method !== 'GET';
    return (mutating ? csrfToken() : Promise.resolve('')).then(function (token) {
      var headers = { 'Accept': 'application/vnd.api+json, application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/vnd.api+json';
      if (token) headers['X-CSRF-Signature'] = token;
      return fetch(url, {
        method: method,
        headers: headers,
        credentials: 'include',
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    }).then(function (res) {
      return res.text().then(function (t) {
        // A stale CSRF signature is refused with 403; fetch a fresh one and try once more.
        if (mutating && res.status === 403 && !retried && !/cloudflare|cf-chl|challenge-platform/i.test(t)) {
          csrf = null;
          return request(method, path, body, true);
        }
        return respond(res.status, t, res.headers.get('content-type') || '');
      });
    }, function (e) {
      throw new Error('Cannot reach patreon.com (' + e.message + ')');
    });
  }

  // Turns an HTTP status and body into data, or an AuthError / ChallengeError / Error.
  function respond(status, t, type) {
    var j = null;
    try { j = t ? JSON.parse(t) : null; } catch (e) { /* not json */ }
    if (!j && (status === 403 || status === 429 || status === 503) && /html/i.test(type || '') && /cloudflare|cf-chl|challenge-platform|just a moment/i.test(t)) {
      throw new ChallengeError();
    }
    var why = (j && j.errors && j.errors[0] && (j.errors[0].detail || j.errors[0].title)) || (j && j.error) || '';
    if (status === 401 || status === 403) throw new AuthError(why || 'Your Patreon session has expired.');
    if (status === 204) return null;
    if (status < 200 || status >= 300) {
      var err = new Error(why || ('HTTP ' + status)); err.status = status; throw err;
    }
    return j;
  }

  function get(path) { return request('GET', path); }

  // ---------- JSON:API normalisation ----------

  function indexIncluded(doc) {
    var idx = {};
    (doc.included || []).forEach(function (r) { idx[r.type + ':' + r.id] = r; });
    if (Array.isArray(doc.data)) doc.data.forEach(function (r) { idx[r.type + ':' + r.id] = idx[r.type + ':' + r.id] || r; });
    return idx;
  }
  function rel(res, name, idx) {
    var r = res.relationships && res.relationships[name] && res.relationships[name].data;
    if (!r) return Array.isArray(r) ? [] : null;
    if (Array.isArray(r)) return r.map(function (x) { return idx[x.type + ':' + x.id]; }).filter(Boolean);
    return idx[r.type + ':' + r.id] || null;
  }
  function nextCursor(doc) {
    var next = doc && doc.links && doc.links.next;
    if (next) return next;
    var c = doc && doc.meta && doc.meta.pagination && doc.meta.pagination.cursors && doc.meta.pagination.cursors.next;
    return c || null;
  }

  // A count from Patreon. Usually a number, but some come back as a string or an object (such as {"total": 12}),
  // which would otherwise show up as "[object Object] posts".
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'string') return /^\d+$/.test(v) ? +v : 0;
    if (v && typeof v === 'object') {
      var keys = ['total', 'count', 'value', 'all'];
      for (var i = 0; i < keys.length; i++) if (typeof v[keys[i]] === 'number') return v[keys[i]];
      if (global.console) console.warn('[patreon-tv] unexpected count', JSON.stringify(v).slice(0, 300));
    }
    return 0;
  }

  function campaignModel(c) {
    if (!c) return null;
    var a = c.attributes || {};
    return {
      id: c.id, name: a.name || a.creation_name || 'Creator',
      avatar: a.avatar_photo_url || (a.avatar_photo_image_urls && (a.avatar_photo_image_urls.thumbnail || a.avatar_photo_image_urls.default)) || '',
      cover: a.cover_photo_url || (a.cover_photo_url_sizes && a.cover_photo_url_sizes.large) || '',
      summary: a.summary || '', oneLiner: a.one_liner || a.creation_name || '',
      patrons: num(a.patron_count), posts: num(a.post_count), url: a.url || '', vanity: a.vanity || '',
      nsfw: !!a.is_nsfw, payPer: a.pay_per_name || 'month', currency: a.currency || 'USD'
    };
  }

  function mediaImage(m) {
    var a = m.attributes || {};
    var u = a.image_urls || {};
    return { thumb: u.thumbnail_large || u.thumbnail || u.default || a.download_url, full: u.original || u.default || u.url || a.download_url, name: a.file_name };
  }

  function kindOf(post) {
    var t = post.type || '';
    if (post.video || /^video/.test(t) || t === 'livestream_youtube' || (post.embed && post.embedKind === 'video')) return 'video';
    if (post.audio || /^audio/.test(t)) return 'audio';
    if (t === 'poll') return 'poll';
    if (post.images.length || t === 'image_file') return 'image';
    if (t === 'link') return 'link';
    return 'text';
  }

  // YouTube and Vimeo links, wherever they appear: embeds, links in the text, or bare URLs.
  var YT = /(?:https?:)?\/\/(?:(?:www|m|music)\.)?(?:youtube\.com|youtube-nocookie\.com)\/(?:watch\?(?:[^#\s"'<>]*?&(?:amp;)?)?v=|embed\/|live\/|shorts\/|v\/)([\w-]{11})([^\s"'<>]*)|(?:https?:)?\/\/youtu\.be\/([\w-]{11})([^\s"'<>]*)/ig;
  var VIMEO = /(?:https?:)?\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/|channels\/[\w-]+\/)?(\d{5,})(?:\/([0-9a-f]{6,})|\?h=([0-9a-f]{6,}))?/ig;

  function startTime(rest) {
    var m = /[?&#](?:amp;)?(?:t|start)=(?:(\d+)h)?(?:(\d+)m)?(\d+)s?/.exec(rest || '');
    return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+m[3]) : 0;
  }
  function youtube(id, start) {
    return { provider: 'YouTube', id: id, start: start || 0, kind: 'video', url: 'https://www.youtube.com/watch?v=' + id + (start ? '&t=' + start + 's' : ''),
      player: 'https://www.youtube.com/embed/' + id + '?autoplay=1&rel=0&playsinline=1&enablejsapi=1' + (start ? '&start=' + start : ''),
      thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
  }
  function vimeo(id, hash) {
    return { provider: 'Vimeo', id: id, start: 0, kind: 'video', url: 'https://vimeo.com/' + id + (hash ? '/' + hash : ''),
      player: 'https://player.vimeo.com/video/' + id + '?autoplay=1' + (hash ? '&h=' + hash : ''), thumb: '' };
  }
  // Every distinct video link in a piece of text or HTML, in order of appearance.
  function videoLinks(text) {
    var found = [], seen = {}, m;
    if (!text) return found;
    YT.lastIndex = 0;
    while ((m = YT.exec(text))) {
      var id = m[1] || m[3];
      if (!seen['y' + id]) { seen['y' + id] = 1; found.push({ at: m.index, link: youtube(id, startTime(m[2] || m[4])) }); }
    }
    VIMEO.lastIndex = 0;
    while ((m = VIMEO.exec(text))) {
      if (!seen['v' + m[1]]) { seen['v' + m[1]] = 1; found.push({ at: m.index, link: vimeo(m[1], m[2] || m[3]) }); }
    }
    return found.sort(function (x, y) { return x.at - y.at; }).map(function (f) { return f.link; });
  }
  function videoLink(url) { return videoLinks(url)[0] || null; }

  function embedInfo(embed) {
    if (!embed || !embed.url) return null;
    var v = videoLink(embed.url);
    if (v) {
      if (embed.subject) v.title = embed.subject;
      if (embed.thumbnail_url && v.provider !== 'YouTube') v.thumb = embed.thumbnail_url;
      return v;
    }
    return { provider: embed.provider || 'Link', url: embed.url, player: null, kind: /video/i.test(embed.subject || '') ? 'video' : 'link',
      title: embed.subject, description: embed.description };
  }

  function isHls(url) { return /\.m3u8(\?|$)/.test(url) || /stream\.mux\.com/.test(url); }

  // What a post's post_file is: 'video', 'audio', 'image' or ''. Go by the file itself, not the post type: on a
  // YouTube post (post_type video_embed) post_file is just the thumbnail image.
  function postFileKind(pf, type, idx) {
    if (!pf || !pf.url) return '';
    if (isHls(pf.url)) return 'video';
    var m = pf.media_id != null ? idx['media:' + pf.media_id] : null;
    var mime = pf.mimetype || (m && m.attributes && m.attributes.mimetype) || '';
    if (/^(video|audio|image)\//.test(mime)) return mime.split('/')[0];
    var ext = /\.(\w{2,4})(\?|$)/.exec(pf.name || pf.url.split('?')[0]);
    ext = ext ? ext[1].toLowerCase() : '';
    if (/^(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/.test(ext)) return 'audio';
    if (/^(mp4|m4v|mov|webm|mkv)$/.test(ext) || pf.name === 'video') return 'video';
    if (/^(jpe?g|png|gif|webp|avif)$/.test(ext)) return 'image';
    if (type === 'audio_file') return 'audio';
    if (type === 'video_file' || type === 'video_external_file') return 'video';
    if (type === 'image_file') return 'image';
    // Anything else (embeds, links, text) only carries a picture here.
    return pf.width || pf.image_colors ? 'image' : '';
  }

  function postModel(p, idx) {
    var a = p.attributes || {};
    var campaign = campaignModel(rel(p, 'campaign', idx));
    var user = rel(p, 'user', idx);
    var pf = a.post_file || null;
    var type = a.post_type || '';
    var fileKind = postFileKind(pf, type, idx);
    // On a YouTube or other embed post, post_file and the images list only hold the post's thumbnail.
    var cover = fileKind === 'image' && !/^image/.test(type) ? String(pf.media_id) : null;
    var images = (rel(p, 'images', idx) || []).filter(function (m) { return String(m.id) !== cover; })
      .map(mediaImage).filter(function (i) { return i.full; });
    var media = rel(p, 'media', idx) || [];
    var attachments = (rel(p, 'attachments_media', idx) || []).map(function (m) {
      var ma = m.attributes || {};
      return { name: ma.file_name || 'Attachment', url: ma.download_url, size: ma.size_bytes, mime: ma.mimetype };
    }).filter(function (x) { return x.url; });
    var audioRel = rel(p, 'audio', idx);

    var video = null, audio = null;
    if (fileKind === 'audio') audio = { url: pf.url, duration: pf.duration };
    else if (fileKind === 'video') {
      video = { url: pf.url, hls: isHls(pf.url), duration: pf.duration || pf.full_content_duration, width: pf.width, height: pf.height };
    } else if (fileKind === 'image' && /^image/.test(type) && !images.length) images.push({ thumb: pf.url, full: pf.url, name: pf.name });
    if (!audio && audioRel && audioRel.attributes && audioRel.attributes.download_url) {
      audio = { url: audioRel.attributes.download_url, duration: (audioRel.attributes.metadata || {}).duration };
    }
    if (!video) {
      media.forEach(function (m) {
        var ma = m.attributes || {};
        if (!video && /^video\//.test(ma.mimetype || '') && (ma.download_url || (ma.display && ma.display.url))) {
          var u = (ma.display && ma.display.url) || ma.download_url;
          video = { url: u, hls: isHls(u), duration: (ma.metadata || {}).duration };
        }
      });
    }
    var content = a.content || (a.content_json_string ? U.tiptapToHtml(a.content_json_string) : '');
    var embed = embedInfo(a.embed);
    // Creators often post a YouTube or Vimeo link in the text instead of an embed.
    var links = videoLinks((embed && embed.player ? embed.url + ' ' : '') + content);
    if (!video && !audio && links.length && !(embed && embed.player)) embed = links[0];

    var thumb = (a.image && (a.image.large_url || a.image.url || a.image.thumb_url)) ||
      (a.thumbnail && (a.thumbnail.large || a.thumbnail.url || a.thumbnail.default)) ||
      (images[0] && images[0].thumb) || a.meta_image_url || (a.embed && a.embed.thumbnail_url) || (embed && embed.thumb) || '';
    var tags = (rel(p, 'user_defined_tags', idx) || []).map(function (t) { return (t.attributes && t.attributes.value) || String(t.id).replace(/^user_defined;/, ''); });

    var pollRes = rel(p, 'poll', idx);
    var poll = null;
    if (pollRes) {
      var pa = pollRes.attributes || {};
      var mine = (rel(pollRes, 'current_user_responses', idx) || []).map(function (r) { var c = rel(r, 'choice', idx); return c && c.id; });
      poll = {
        id: pollRes.id, question: pa.question_text || a.title, closesAt: pa.closes_at, total: num(pa.num_responses),
        choices: (rel(pollRes, 'choices', idx) || []).map(function (c) {
          var ca = c.attributes || {};
          return { id: c.id, text: ca.text_content || ca.choice_text || '', votes: num(ca.num_responses), mine: mine.indexOf(c.id) >= 0, position: ca.position || 0 };
        }).sort(function (x, y) { return x.position - y.position; })
      };
    }

    var model = {
      id: p.id, title: a.title || (a.teaser_text ? a.teaser_text.slice(0, 80) : 'Untitled post'), type: type,
      published: a.published_at, teaser: a.teaser_text || '', content: content,
      canView: a.current_user_can_view !== false, canComment: !!a.current_user_can_comment,
      liked: !!a.current_user_has_liked, likes: num(a.like_count), comments: num(a.comment_count), views: num(a.view_count),
      minCents: a.min_cents_pledged_to_view || 0, url: a.url ? (a.url.indexOf('http') === 0 ? a.url : PATREON + a.url) : (a.patreon_url || ''),
      campaign: campaign, author: user ? { name: (user.attributes || {}).full_name, avatar: (user.attributes || {}).image_url } : null,
      thumb: thumb, video: video, audio: audio, embed: embed, embedKind: embed && embed.kind, videoLinks: links,
      images: images, attachments: attachments, poll: poll, tags: tags,
      nsfw: !!(campaign && campaign.nsfw)
    };
    model.kind = kindOf(model);
    return model;
  }

  function postsPage(doc) {
    var idx = indexIncluded(doc);
    var list = (Array.isArray(doc.data) ? doc.data : []).filter(function (r) { return r.type === 'post'; })
      .map(function (p) { return postModel(p, idx); });
    return { items: list, next: nextCursor(doc) };
  }

  function withCursor(url, cursor) {
    if (!cursor) return url;
    if (/^https?:/.test(cursor) || cursor.charAt(0) === '/') return cursor;
    return url + '&page[cursor]=' + encodeURIComponent(cursor);
  }

  // ---------- endpoints ----------

  var Api = {
    AuthError: AuthError,
    ChallengeError: ChallengeError,
    request: request,
    videoLink: videoLink,
    videoLinks: videoLinks,

    currentUser: function () {
      var attempts = [
        '/api/current_user?include=active_memberships.campaign&fields[user]=full_name,image_url,email&fields[member]=patron_status,currently_entitled_amount_cents,pledge_relationship_start&fields[campaign]=name,avatar_photo_url,cover_photo_url,url,vanity,is_nsfw,creation_name&json-api-version=1.0',
        '/api/current_user?include=memberships.campaign&json-api-version=1.0',
        '/api/current_user?include=pledges.campaign&json-api-version=1.0',
        '/api/current_user?json-api-version=1.0'
      ];
      function attempt(i) {
        return get(attempts[i]).then(function (doc) {
          var idx = indexIncluded(doc);
          var u = doc.data || {};
          var ua = u.attributes || {};
          var campaigns = [];
          var seen = {};
          (doc.included || []).forEach(function (r) {
            var c = null, member = null;
            if (r.type === 'campaign') c = r;
            else if (r.type === 'member' || r.type === 'pledge') { member = r; c = rel(r, 'campaign', idx); }
            if (c && !seen[c.id]) {
              seen[c.id] = 1;
              var m = campaignModel(c);
              m.member = true;
              campaigns.push(m);
            }
            if (member && c) {
              var ma = member.attributes || {};
              var cm = campaigns.filter(function (x) { return x.id === c.id; })[0];
              if (cm) { cm.status = ma.patron_status; cm.pledgeCents = ma.currently_entitled_amount_cents || ma.amount_cents || 0; }
            }
          });
          return { id: u.id, name: ua.full_name || ua.first_name || 'Patron', avatar: ua.image_url || ua.thumb_url || '',
            email: ua.email || '', campaigns: campaigns };
        }).catch(function (e) {
          if (e instanceof AuthError || i === attempts.length - 1) throw e;
          return attempt(i + 1);
        });
      }
      return attempt(0);
    },

    feed: function (cursor) {
      var url = '/api/stream?include=' + POST_INCLUDE + POST_FIELDS +
        '&filter[is_following]=true&json-api-use-default-includes=false&json-api-version=1.0';
      return get(withCursor(url, cursor)).then(postsPage);
    },

    campaignPosts: function (campaignId, cursor, opts) {
      opts = opts || {};
      var url = '/api/posts?include=' + POST_INCLUDE + POST_FIELDS +
        '&filter[campaign_id]=' + encodeURIComponent(campaignId) +
        '&filter[contains_exclusive_posts]=true&filter[is_draft]=false' +
        (opts.collectionId ? '&filter[collection_id]=' + encodeURIComponent(opts.collectionId) + '&filter[include_drops]=true' : '') +
        (opts.tag ? '&filter[tag]=' + encodeURIComponent(opts.tag) : '') +
        '&sort=' + (opts.sort || (opts.collectionId ? 'collection_order' : '-published_at')) +
        '&json-api-use-default-includes=false&json-api-version=1.0';
      return get(withCursor(url, cursor)).then(postsPage);
    },

    post: function (id) {
      return get('/api/posts/' + encodeURIComponent(id) + '?include=' + POST_INCLUDE + POST_FIELDS +
        '&json-api-use-default-includes=false&json-api-version=1.0').then(function (doc) {
        var idx = indexIncluded(doc);
        return postModel(doc.data, idx);
      });
    },

    campaign: function (id) {
      return get('/api/campaigns/' + encodeURIComponent(id) + '?include=rewards,creator' +
        '&fields[campaign]=name,summary,avatar_photo_url,cover_photo_url,creation_name,one_liner,patron_count,post_count,url,vanity,is_nsfw,pay_per_name,currency' +
        '&fields[reward]=title,amount_cents,description,image_url,patron_count,published' +
        '&fields[user]=full_name,image_url&json-api-version=1.0').then(function (doc) {
        var idx = indexIncluded(doc);
        var c = campaignModel(doc.data);
        c.tiers = (rel(doc.data, 'rewards', idx) || []).filter(function (r) {
          return r.attributes && r.attributes.amount_cents > 0 && r.attributes.published !== false;
        }).map(function (r) {
          var a = r.attributes;
          return { id: r.id, title: a.title || U.money(a.amount_cents, c.currency), cents: a.amount_cents, description: a.description || '', image: a.image_url };
        }).sort(function (x, y) { return x.cents - y.cents; });
        return c;
      });
    },

    collections: function (campaignId) {
      return get('/api/collection?filter[campaign_id]=' + encodeURIComponent(campaignId) +
        '&filter[must_have_posts]=true&fields[collection]=title,description,num_posts,thumbnail&json-api-version=1.0')
        .then(function (doc) {
          return (doc.data || []).map(function (c) {
            var a = c.attributes || {};
            return { id: c.id, title: a.title || 'Collection', description: a.description || '', count: num(a.num_posts),
              thumb: a.thumbnail && (a.thumbnail.url || a.thumbnail.default || a.thumbnail.large) };
          });
        });
    },

    search: function (q) {
      return get('/api/search?q=' + encodeURIComponent(q) + '&page[number]=1&json-api-version=1.0&json-api-use-default-includes=false&include=[]')
        .then(function (doc) {
          return (doc.data || []).map(function (r) {
            var a = r.attributes || {};
            var id = a.campaign_id || String(r.id).replace(/^campaign_/, '');
            return { id: String(id), name: a.name || a.creator_name || 'Creator', avatar: a.avatar_photo_url || a.avatar_photo_image_urls && a.avatar_photo_image_urls.thumbnail || '',
              oneLiner: a.creation_name || a.summary || '', patrons: num(a.patron_count), nsfw: !!a.is_nsfw, url: a.url };
          }).filter(function (c) { return /^\d+$/.test(c.id); });
        });
    },

    comments: function (postId, cursor) {
      var url = '/api/posts/' + encodeURIComponent(postId) + '/comments2?include=commenter,parent,first_reply.commenter' +
        '&fields[comment]=body,created,deleted_at,is_by_patron,is_by_creator,vote_sum,current_user_vote,reply_count' +
        '&fields[user]=image_url,full_name,url&page[count]=30&sort=-created&json-api-version=1.0&json-api-use-default-includes=false';
      return get(withCursor(url, cursor)).then(function (doc) { return commentsPage(doc); });
    },

    replies: function (commentId, cursor) {
      var url = '/api/comments/' + encodeURIComponent(commentId) + '/replies2?include=commenter,parent' +
        '&fields[comment]=body,created,deleted_at,is_by_patron,is_by_creator,vote_sum,current_user_vote' +
        '&fields[user]=image_url,full_name,url&page[count]=50&sort=created&json-api-version=1.0&json-api-use-default-includes=false';
      return get(withCursor(url, cursor)).then(function (doc) { return commentsPage(doc); });
    },

    like: function (postId, liked) {
      return request(liked ? 'POST' : 'DELETE', '/api/posts/' + encodeURIComponent(postId) + '/likes?json-api-version=1.0',
        liked ? { data: { type: 'like', relationships: { post: { data: { type: 'post', id: String(postId) } } } } } : undefined);
    },

    addComment: function (postId, body, parentId) {
      var rels = { post: { data: { type: 'post', id: String(postId) } } };
      if (parentId) rels.parent = { data: { type: 'comment', id: String(parentId) } };
      return request('POST', '/api/posts/' + encodeURIComponent(postId) + '/comments?json-api-version=1.0',
        { data: { type: 'comment', attributes: { body: body }, relationships: rels } });
    },

    // Sign-in happens on Patreon's own page (email, email code, Google, Apple...). It comes back to the app after.
    signInUrl: function () { return '/login?ru=' + encodeURIComponent('/home'); },
    logoutUrl: function () { return '/logout?ru=' + encodeURIComponent('/home'); },
  };

  function commentsPage(doc) {
    var idx = indexIncluded(doc);
    function model(c) {
      var a = c.attributes || {};
      var u = rel(c, 'commenter', idx);
      var ua = (u && u.attributes) || {};
      var first = rel(c, 'first_reply', idx);
      return { id: c.id, body: a.deleted_at ? '(deleted)' : (a.body || ''), created: a.created, votes: a.vote_sum || 0,
        byCreator: !!a.is_by_creator, replies: num(a.reply_count), user: { name: ua.full_name || 'Patron', avatar: ua.image_url || '' },
        firstReply: first ? model(first) : null };
    }
    return { items: (doc.data || []).map(model), next: nextCursor(doc) };
  }

  global.Api = Api;
})(window);
