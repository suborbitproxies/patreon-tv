/*
 * Sample Patreon data in the same JSON:API shape as www.patreon.com, for developing without an account.
 * Runs in Node (the test server, test/fake-patreon.js) and in the browser (the web preview), so it has no Node dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PatreonMock = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const COLORS = ['#e4572e', '#29335c', '#f3a712', '#669bbc', '#a8c686', '#8e5572', '#2e86ab', '#c73e1d'];
const CAMPAIGNS = [
  { id: '1001', name: 'Pixel Kitchen', creation_name: 'cooking videos every week', patron_count: 4210, is_nsfw: false },
  { id: '1002', name: 'Night Signals', creation_name: 'an audio drama podcast', patron_count: 980, is_nsfw: false },
  { id: '1003', name: 'Sketchbook Club', creation_name: 'art tutorials and process', patron_count: 15200, is_nsfw: false }
];
const TYPES = ['video_external_file', 'audio_file', 'image_file', 'text_only', 'poll', 'video_embed'];

// Where sample media lives; the test server serves it over HTTP, the web preview uses data: and blob: URLs.
const urls = {
  img: (seed, w, h) => `/mock/img/${seed}.svg?w=${w}&h=${h}`,
  video: () => '/mock/video.webm',
  audio: () => '/mock/audio.wav'
};
const img = (seed, w, h) => urls.img(seed, w || 640, h || 360);

function campaignRes(c) {
  return { type: 'campaign', id: c.id, attributes: {
    name: c.name, creation_name: c.creation_name, one_liner: c.creation_name, patron_count: c.patron_count, post_count: 48,
    avatar_photo_url: img('a' + c.id, 200, 200), cover_photo_url: img('c' + c.id, 1600, 400), is_nsfw: c.is_nsfw,
    summary: `<p><b>${c.name}</b> makes ${c.creation_name}.</p><p>Thanks for supporting! New posts land every Friday.</p>`,
    url: 'https://www.patreon.com/' + c.name.replace(/\s/g, ''), vanity: c.name.replace(/\s/g, ''), pay_per_name: 'month', currency: 'USD'
  }, relationships: { rewards: { data: [1, 2, 3].map((i) => ({ type: 'reward', id: c.id + '-r' + i })) }, creator: { data: { type: 'user', id: 'u' + c.id } } } };
}

// 60 posts, newest first (configure({ posts }) makes more, e.g. for the speed test).
const POSTS = [];
function makePosts(count) {
  POSTS.length = 0;
  for (let i = 0; i < count; i++) {
    const c = CAMPAIGNS[i % CAMPAIGNS.length];
    const type = TYPES[i % TYPES.length];
    POSTS.push({ n: i, id: String(50000 - i), campaign: c, type, locked: i % 7 === 5, published: new Date(Date.UTC(2026, 8, 25, 12) - i * 36e5 * 20).toISOString() });
  }
}
makePosts(60);
let pageSize = 12;

function postRes(p, included) {
  const id = p.id;
  const rels = { campaign: { data: { type: 'campaign', id: p.campaign.id } }, user: { data: { type: 'user', id: 'u' + p.campaign.id } },
    images: { data: [] }, attachments_media: { data: [] }, media: { data: [] }, audio: { data: null }, poll: { data: null }, user_defined_tags: { data: [] } };
  const a = {
    title: `${['Episode', 'Behind the scenes', 'Sketch', 'Update', 'Poll', 'Live'][TYPES.indexOf(p.type)]} #${60 - p.n}: ${['Knife skills', 'The lighthouse', 'Ink studies', 'Studio news', 'Pick the next topic', 'Q&A stream'][TYPES.indexOf(p.type)]}`,
    post_type: p.type, published_at: p.published, like_count: (p.n * 37) % 400, comment_count: (p.n * 13) % 60, current_user_has_liked: p.n % 4 === 0,
    current_user_can_view: !p.locked, current_user_can_comment: !p.locked, min_cents_pledged_to_view: p.locked ? 1000 : 0,
    teaser_text: 'A short teaser for this post, visible to everyone.', url: `/posts/mock-post-${id}`,
    image: { large_url: img('p' + id), url: img('p' + id), thumb_url: img('p' + id, 320, 180) },
    content: p.locked ? null : `<p>This is post <b>${id}</b> from ${p.campaign.name}.</p><p>${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(6)}</p>` +
      `<p>Links like <a href="https://example.com/notes">the show notes</a> open as a QR code.</p><figure><img src="${img('i' + id, 800, 450)}"></figure>` +
      `<p>${'More text so long posts scroll with the remote. '.repeat(12)}</p><script>alert(1)</script>`,
    post_file: null, embed: null
  };
  if (!p.locked) {
    if (p.type === 'video_external_file') a.post_file = { url: urls.video(), duration: 95, mimetype: 'video/webm' };
    if (p.type === 'audio_file') { a.post_file = { url: urls.audio(), duration: 20, mimetype: 'audio/wav' }; }
    if (p.type === 'video_embed') {
      a.embed = { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', provider: 'YouTube', subject: 'Big Buck Bunny',
        description: 'Music: https://www.youtube.com/watch?v=Z2Oci7962pI' };
      // As on patreon.com: post_file, images and media only hold the thumbnail picture.
      const thumb = img('yt' + id, 320, 180);
      a.post_file = { url: thumb, width: 320, height: 180, state: 'ready', media_id: Number(id), image_colors: { dominant_color: '#315b81' } };
      rels.images.data = rels.media.data = [{ type: 'media', id }];
      included.push({ type: 'media', id, attributes: { display: { url: thumb, width: 320, height: 180 }, download_url: thumb, file_name: thumb,
        image_urls: { url: thumb, original: thumb, default: thumb, thumbnail: thumb }, mimetype: 'image/jpeg', size_bytes: 8403 } });
    }
    // Some creators only paste YouTube links into the text.
    if (p.type === 'text_only' && p.n % 12 === 3) {
      a.title = `Episode #${60 - p.n}: on YouTube`;
      a.content = `<p>New episode is up: https://youtu.be/aqz-KE-bpKQ?t=30</p><p>Part two is <a href="https://www.youtube.com/watch?v=eRsGyueVLvQ">here</a>, ` +
        `and the trailer on <a href="https://vimeo.com/76979871">Vimeo</a>.</p>`;
    }
    if (p.type === 'image_file') {
      rels.images.data = [0, 1, 2, 3].map((k) => ({ type: 'media', id: `m${id}-${k}` }));
      [0, 1, 2, 3].forEach((k) => included.push({ type: 'media', id: `m${id}-${k}`, attributes: { file_name: `sketch-${k}.png`, image_urls: { thumbnail: img(`m${id}${k}`, 320, 180), default: img(`m${id}${k}`, 1280, 720), original: img(`m${id}${k}`, 1920, 1080) }, download_url: img(`m${id}${k}`, 1920, 1080) } }));
      rels.attachments_media.data = [{ type: 'media', id: `att${id}` }];
      included.push({ type: 'media', id: `att${id}`, attributes: { file_name: 'brushes.zip', download_url: 'https://example.com/brushes.zip', size_bytes: 4200000, mimetype: 'application/zip' } });
    }
    if (p.type === 'poll') {
      rels.poll.data = { type: 'poll', id: 'poll' + id };
      included.push({ type: 'poll', id: 'poll' + id, attributes: { question_text: 'What should the next video be about?', num_responses: 240, closes_at: '2026-10-10T00:00:00Z' },
        relationships: { choices: { data: [1, 2, 3].map((k) => ({ type: 'poll_choice', id: `pc${id}-${k}` })) }, current_user_responses: { data: [{ type: 'poll_response', id: 'pr' + id }] } } });
      ['Bread from scratch', 'Knife sharpening', 'Street food tour'].forEach((t, k) => included.push({ type: 'poll_choice', id: `pc${id}-${k + 1}`, attributes: { text_content: t, num_responses: [120, 70, 50][k], position: k } }));
      included.push({ type: 'poll_response', id: 'pr' + id, relationships: { choice: { data: { type: 'poll_choice', id: `pc${id}-1` } } } });
    }
    rels.user_defined_tags.data = [{ type: 'post_tag', id: 'user_defined;tutorial' }];
    included.push({ type: 'post_tag', id: 'user_defined;tutorial', attributes: { value: 'tutorial', tag_type: 'user_defined' } });
  }
  return { type: 'post', id, attributes: a, relationships: rels };
}

function postsDoc(list, reqUrl) {
  const u = new URL(reqUrl, 'http://x');
  const cursor = parseInt(u.searchParams.get('page[cursor]') || '0', 10) || 0;
  const page = list.slice(cursor, cursor + pageSize);
  const included = [];
  const data = page.map((p) => postRes(p, included));
  const camps = new Set(page.map((p) => p.campaign.id));
  CAMPAIGNS.filter((c) => camps.has(c.id)).forEach((c) => {
    included.push(campaignRes(c));
    included.push({ type: 'user', id: 'u' + c.id, attributes: { full_name: c.name, image_url: img('a' + c.id, 200, 200) } });
  });
  const next = cursor + pageSize < list.length ? String(cursor + pageSize) : null;
  u.searchParams.set('page[cursor]', next || '');
  return { data, included, meta: { pagination: { cursors: { next } } }, links: next ? { next: 'https://www.patreon.com' + u.pathname + '?' + u.searchParams.toString() } : {} };
}

function comments(postId, parentId) {
  const n = parentId ? 3 : 8;
  const data = [], included = [];
  for (let i = 0; i < n; i++) {
    const id = `${parentId || postId}-c${i}`;
    const byCreator = i === 1;
    data.push({ type: 'comment', id, attributes: { body: byCreator ? 'Thanks everyone for watching!' : `Comment ${i + 1}: loved this one, can't wait for the next.`, created: new Date(Date.now() - i * 3600e3).toISOString(), vote_sum: i * 2, is_by_creator: byCreator, reply_count: parentId ? 0 : (i % 3 === 0 ? 3 : 0) },
      relationships: { commenter: { data: { type: 'user', id: 'cu' + i } } } });
    included.push({ type: 'user', id: 'cu' + i, attributes: { full_name: byCreator ? 'The Creator' : 'Patron ' + (i + 1), image_url: img('cu' + i, 100, 100) } });
  }
  return { data, included, links: {} };
}

let liked = {};
const posted = [];

// Answers one API request: returns { status, body }.
function handle(method, url, bodyText) {
  const u = new URL(url, 'https://www.patreon.com');
  const req = { method, url: u.pathname + u.search };
  const res = null;
  const h = { json: (r, status, body) => ({ status, body }) };
  const p = u.pathname;
  let m;
  if (p === '/api/current_user') {
    const included = [];
    CAMPAIGNS.slice(0, 2).forEach((c, i) => {
      included.push({ type: 'member', id: 'mem' + c.id, attributes: { patron_status: 'active_patron', currently_entitled_amount_cents: [500, 1000][i] }, relationships: { campaign: { data: { type: 'campaign', id: c.id } } } });
      included.push(campaignRes(c));
    });
    return h.json(res, 200, { data: { type: 'user', id: '777', attributes: { full_name: 'Mock Patron', email: 'patron@example.com', image_url: img('me', 200, 200) },
      relationships: { active_memberships: { data: CAMPAIGNS.slice(0, 2).map((c) => ({ type: 'member', id: 'mem' + c.id })) } } }, included });
  }
  if (p === '/api/stream') return h.json(res, 200, postsDoc(POSTS, req.url));
  if (p === '/api/posts') {
    const cid = u.searchParams.get('filter[campaign_id]');
    let list = POSTS.filter((x) => x.campaign.id === cid);
    if (u.searchParams.get('filter[collection_id]')) list = list.slice(0, 5);
    if (u.searchParams.get('sort') === 'published_at') list = list.slice().reverse();
    return h.json(res, 200, postsDoc(list, req.url));
  }
  if ((m = p.match(/^\/api\/posts\/(\d+)\/likes$/))) {
    liked[m[1]] = req.method === 'POST';
    return h.json(res, 200, { data: { type: 'like', id: m[1] } });
  }
  if ((m = p.match(/^\/api\/posts\/(\d+)\/comments2$/))) {
    const doc = comments(m[1]);
    posted.filter((c) => c.post === m[1]).forEach((c) => { doc.data.unshift({ type: 'comment', id: c.id, attributes: { body: c.body, created: c.created, vote_sum: 0, reply_count: 0 }, relationships: { commenter: { data: { type: 'user', id: '777' } } } }); });
    doc.included.push({ type: 'user', id: '777', attributes: { full_name: 'Mock Patron', image_url: img('me', 100, 100) } });
    return h.json(res, 200, doc);
  }
  if ((m = p.match(/^\/api\/posts\/(\d+)\/comments$/)) && req.method === 'POST') {
    const j = JSON.parse(String(bodyText));
    posted.push({ post: m[1], id: 'new' + posted.length, body: j.data.attributes.body, created: new Date().toISOString() });
    return h.json(res, 201, { data: { type: 'comment', id: 'new' + posted.length } });
  }
  if ((m = p.match(/^\/api\/comments\/([^/]+)\/replies2$/))) return h.json(res, 200, comments(null, m[1]));
  if ((m = p.match(/^\/api\/posts\/(\d+)$/))) {
    const post = POSTS.find((x) => x.id === m[1]);
    if (!post) return h.json(res, 404, { errors: [{ detail: 'Post not found' }] });
    const included = [];
    const data = postRes(post, included);
    if (m[1] in liked) data.attributes.current_user_has_liked = liked[m[1]];
    included.push(campaignRes(post.campaign));
    return h.json(res, 200, { data, included });
  }
  if ((m = p.match(/^\/api\/campaigns\/(\d+)$/))) {
    const c = CAMPAIGNS.find((x) => x.id === m[1]);
    if (!c) return h.json(res, 404, { errors: [{ detail: 'Not found' }] });
    const included = [1, 2, 3].map((i) => ({ type: 'reward', id: c.id + '-r' + i, attributes: { title: ['Supporter', 'Insider', 'Producer'][i - 1], amount_cents: [500, 1000, 2500][i - 1], description: '<p>Early access, <b>bonus</b> episodes and my eternal gratitude.</p>', published: true } }));
    return h.json(res, 200, { data: campaignRes(c), included });
  }
  if (p === '/api/collection') {
    return h.json(res, 200, { data: [1, 2].map((i) => ({ type: 'collection', id: u.searchParams.get('filter[campaign_id]') + '0' + i, attributes: { title: ['Beginner series', 'Holiday specials'][i - 1], description: 'A curated set of posts.', num_posts: i === 1 ? 5 : { total: 7 }, thumbnail: { url: img('col' + i) } } })) });
  }
  if (p === '/api/search') {
    const q = (u.searchParams.get('q') || '').toLowerCase();
    return h.json(res, 200, { data: CAMPAIGNS.filter((c) => c.name.toLowerCase().includes(q) || c.creation_name.includes(q)).map((c) => ({ type: 'campaign-document', id: 'campaign_' + c.id, attributes: { name: c.name, creation_name: c.creation_name, avatar_photo_url: img('a' + c.id, 200, 200), patron_count: c.patron_count } })) });
  }
  if (p === '/api/auth') return h.json(res, 200, { data: { type: 'user', id: '777' } });
  return h.json(res, 404, { errors: [{ title: 'Mock has no ' + p }] });
}

function svg(seed, w, hgt) {
  let hash = 0; for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const c1 = COLORS[hash % COLORS.length], c2 = COLORS[(hash >> 3) % COLORS.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${hgt * 0.35}" r="${Math.min(w, hgt) / 4}" fill="rgba(255,255,255,.18)"/><text x="50%" y="55%" font-family="Arial" font-size="${Math.min(w, hgt) / 7}" fill="rgba(255,255,255,.85)" text-anchor="middle">${seed}</text></svg>`;
}

// 20 seconds of a soft two-tone chime as 8 kHz mono 16-bit WAV bytes.
let toneBytes = null;
function wav() {
  if (toneBytes) return toneBytes;
  const rate = 8000, secs = 20, n = rate * secs;
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate, f = Math.floor(t) % 2 ? 440 : 660, env = Math.exp(-3 * (t % 1));
    v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * f * t) * env * 8000), true);
  }
  return (toneBytes = new Uint8Array(buf));
}

function configure(o) {
  if (o.posts) makePosts(o.posts);
  if (o.pageSize) pageSize = o.pageSize;
  ['img', 'video', 'audio'].forEach((k) => { if (o[k]) urls[k] = o[k]; });
}

return { handle, svg, wav, configure };
});
