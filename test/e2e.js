/*
 * Drives the app in Chromium at 1920x1080 with the remote's arrow/OK/Back keys, the way the TV runs it: the packed
 * app (app/site/patreon-tv.js, built by tools/build-site.js) is added to every page, like the on-TV helper does,
 * and the pages come from a stand-in for www.patreon.com (test/fake-patreon.js).
 *   node test/e2e.js [screenshot-dir]
 * Needs Playwright (NODE_PATH pointing at a global install works).
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const fake = require('./fake-patreon');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'test', 'screens');
const PORT = 8790, ORIGIN = `http://localhost:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-site.js')], { stdio: 'inherit' });
const BUNDLE = path.join(ROOT, 'app', 'site', 'patreon-tv.js');
const patreon = fake.start(PORT);

const results = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  (' + info + ')' : '')); }

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  // What the on-TV helper does: mark the page as the TV, then add the app to every page the window opens.
  await context.addInitScript(`window.PTV_TV = true; window.PTV_TEST_HOST = 'localhost:${PORT}';`);
  await context.addInitScript({ path: BUNDLE });
  const page = await context.newPage();
  const errors = [], hostMessages = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.text().startsWith('__ptvhost__')) hostMessages.push(JSON.parse(m.text().slice(11)));
    else if (m.type() === 'error' && !/youtube|vimeo|ERR_|40[13]|404|Failed to load resource/i.test(m.text())) errors.push('console: ' + m.text());
  });

  const key = async (k, n) => { for (let i = 0; i < (n || 1); i++) { await page.keyboard.press(k); await page.waitForTimeout(120); } };
  const focused = () => page.evaluate(() => Focus.current ? (Focus.current.textContent || Focus.current.className).trim().slice(0, 80) : null);
  // Every screen that gets a screenshot is also checked for values shown as "[object Object]".
  const seenObjectText = [];
  const shot = async (name) => {
    if (/\[object Object\]/.test(await page.evaluate(() => document.body.innerText))) seenObjectText.push(name);
    return page.screenshot({ path: path.join(OUT, name + '.png') });
  };
  const screenName = () => page.evaluate(() => App.top() && App.top().name);

  // 1. The app takes over patreon.com before Patreon's own scripts run; signed out, it offers sign-in.
  await page.goto(`${ORIGIN}/home`, { waitUntil: 'commit' });
  await page.waitForTimeout(800);
  check('Patreon\'s own page script never runs', await page.evaluate(() => window.PATREON_PAGE_RAN === undefined && document.title === 'Patreon TV'));
  check('first launch shows sign-in', (await screenName()) === 'login');
  await shot('01-login');

  // 2. Sign in on Patreon's own page with the remote.
  check('Sign in is focused', /Sign in with Patreon/.test(await focused()));
  await key('Enter');
  await page.waitForURL(/\/login\?ru=/, { waitUntil: 'commit' });
  await page.waitForTimeout(1200);
  check('Patreon\'s sign-in page gets the remote hint', !!(await page.$('#ptv-bar')));
  const firstFocus = await page.evaluate(() => document.querySelector('.ptv-focus') && document.querySelector('.ptv-focus').id);
  await key('ArrowDown');
  const afterDown = await page.evaluate(() => document.activeElement.id);
  check('arrows move between Patreon\'s fields', afterDown === 'email', firstFocus + ' -> ' + afterDown);
  await page.keyboard.type('patron@example.com');
  await key('ArrowDown');
  await page.keyboard.type('hunter2');
  await key('ArrowDown');
  check('down from the last field reaches the button', await page.evaluate(() => document.activeElement.id) === 'submit');
  await shot('01b-patreon-login');
  await key('Enter');
  await page.waitForURL(/\/home$/, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.App && App.top() && App.top().name === 'home', null, { timeout: 8000 });
  await page.waitForSelector('.card');
  await page.waitForTimeout(800);
  check('signing in comes back to the app with your posts', (await page.$$('.grid .card')).length >= 8, (await page.$$('.grid .card')).length + ' cards');
  await shot('02-home');

  // 3. Filter chips and grid navigation.
  const f0 = await focused();
  await key('ArrowUp');
  const onChip = await page.evaluate(() => Focus.current.classList.contains('chip'));
  check('up from first card reaches the filter chips', onChip, f0 + ' -> ' + await focused());
  await key('ArrowRight'); await key('Enter');
  await page.waitForTimeout(400);
  const kinds = await page.$$eval('.grid .card .badge', (b) => b.map((x) => x.textContent));
  check('Videos filter shows only videos', kinds.length && kinds.every((k) => /Video/.test(k)), kinds.length + ' shown');
  await shot('03-filter-videos');
  await key('ArrowLeft'); await key('Enter'); await page.waitForTimeout(300);
  await key('ArrowDown');
  const cardFocus = await page.evaluate(() => Focus.current.classList.contains('card'));
  check('down from chips enters the grid', cardFocus);
  await key('ArrowRight', 2); await key('ArrowDown', 3);
  await page.waitForTimeout(800);
  const count = (await page.$$('.grid .card')).length;
  check('scrolling down loads more posts', count > 12, count + ' cards');
  await shot('04-home-scrolled');

  // 4. Sidebar opens with Left from the first column.
  await key('ArrowLeft', 5);
  const inSidebar = await page.evaluate(() => !!Focus.current.closest('#sidebar'));
  check('left edge moves into the sidebar', inSidebar);
  await shot('05-sidebar');
  await key('ArrowRight');

  // 5. Open a video post and play it.
  await page.evaluate(() => {
    const c = Array.prototype.find.call(document.querySelectorAll('.grid .card'), (x) => x._post && x._post.kind === 'video' && x._post.canView);
    Focus.set(c);
  });
  await key('Enter');
  await page.waitForTimeout(700);
  check('OK on a card opens the post', (await screenName()) === 'post');
  await shot('06-post-video');
  const btn = await focused();
  check('Play is focused on a video post', /Play/.test(btn), btn);
  await key('Enter');
  await page.waitForTimeout(2500);
  const playing = await page.evaluate(() => { const v = document.querySelector('#player video'); return { t: v.currentTime, paused: v.paused, err: v.error && v.error.code }; });
  check('video plays', playing.t > 0.5 && !playing.paused, JSON.stringify(playing));
  await shot('07-player');
  await key('ArrowRight', 2);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => document.querySelector('#player video').currentTime);
  check('right seeks forward', after > playing.t + 5, playing.t.toFixed(1) + ' -> ' + after.toFixed(1));
  await key('Enter'); await page.waitForTimeout(300);
  check('OK pauses', await page.evaluate(() => document.querySelector('#player video').paused));
  await shot('08-player-paused');
  await key('Escape');
  await page.waitForTimeout(300);
  check('Back closes the player', await page.evaluate(() => document.querySelector('#player').classList.contains('hidden')));
  const resume = await page.evaluate(() => Progress.recent()[0] || null);
  check('watch position is saved', !!resume, resume && resume.position.toFixed(1));

  // 6. Like and comments.
  await page.evaluate(() => Focus.set(Array.prototype.find.call(document.querySelectorAll('.post-actions .btn'), (b) => /Like/.test(b.textContent))));
  const likeBefore = await focused();
  if (/Like/.test(likeBefore)) { await key('Enter'); await page.waitForTimeout(400); }
  check('like toggles', /Like/.test(likeBefore) && (await focused()) !== likeBefore, likeBefore + ' -> ' + await focused());
  await page.evaluate(() => Focus.set(Array.prototype.find.call(document.querySelectorAll('.post-actions .btn'), (b) => /Comments/.test(b.textContent))));
  await key('Enter');
  await page.waitForSelector('.comment');
  await page.waitForTimeout(400);
  check('comments load', (await page.$$('.comment')).length >= 8);
  await page.fill('#in-comment', 'Great episode from the TV!');
  await page.click('#btn-comment');
  await page.mouse.move(5, 1075);
  await page.waitForTimeout(900);
  check('posting a comment shows it', /Great episode from the TV/.test(await page.textContent('.comment-list')));
  await page.evaluate(() => Focus.set(document.querySelector('.link-btn')));
  await key('Enter'); await page.waitForTimeout(600);
  check('replies expand', (await page.$$('.comment.reply')).length >= 3);
  await shot('09-comments');
  await key('Escape'); await page.waitForTimeout(300);
  await key('Escape'); await page.waitForTimeout(400);
  check('Back returns to home keeping the grid', (await screenName()) === 'home' && (await page.$$('.grid .card')).length > 12);

  // 7. Image post with viewer and attachments.
  await page.evaluate(() => {
    const c = Array.prototype.find.call(document.querySelectorAll('.grid .card'), (x) => x._post && x._post.kind === 'image' && x._post.canView);
    Focus.set(c);
  });
  await key('Enter'); await page.waitForTimeout(800);
  await shot('10-post-images');
  const imgBtn = await focused();
  await key('Enter'); await page.waitForTimeout(500);
  const viewer = await page.$('.viewer');
  await key('ArrowRight'); await page.waitForTimeout(200);
  const cap = viewer ? await page.textContent('.viewer-cap') : '';
  check('image viewer opens and pages', /2 \/ 4/.test(cap), imgBtn + ' / ' + cap);
  await shot('11-image-viewer');
  await key('Escape'); await page.waitForTimeout(300);
  const txt = await page.textContent('.post-page');
  check('attachments listed', /brushes\.zip/.test(txt));
  check('post HTML is sanitised', !(await page.$('.post-text script')));
  await key('Escape'); await page.waitForTimeout(400);

  // 8. Audio post keeps playing in the background.
  await page.evaluate(() => {
    const c = Array.prototype.find.call(document.querySelectorAll('.grid .card'), (x) => x._post && x._post.kind === 'audio' && x._post.canView);
    Focus.set(c);
  });
  await key('Enter'); await page.waitForTimeout(700);
  await key('Enter'); await page.waitForTimeout(1500);
  const aud = await page.evaluate(() => ({ t: Player.audio.media.currentTime, paused: Player.audio.media.paused }));
  check('audio plays', aud.t > 0.3 && !aud.paused, JSON.stringify(aud));
  await shot('12-audio');
  await key('Escape'); await page.waitForTimeout(300);
  check('audio continues with a now-playing bar', await page.evaluate(() => !Player.audio.media.paused && !document.querySelector('#nowplaying').classList.contains('hidden')));
  await key('Escape'); await page.waitForTimeout(300);
  await shot('13-nowplaying');
  await page.evaluate(() => Player.key('stop'));

  // 9. Locked post.
  await page.evaluate(() => {
    const c = Array.prototype.find.call(document.querySelectorAll('.grid .card'), (x) => x._post && !x._post.canView);
    Focus.set(c);
  });
  await key('Enter'); await page.waitForTimeout(600);
  check('locked post offers unlock on phone', /Unlock on phone/.test(await focused()));
  await key('Enter'); await page.waitForTimeout(300);
  check('QR code modal shows', !!(await page.$('.modal .qr svg')));
  await shot('14-locked-qr');
  await key('Escape'); await key('Escape'); await page.waitForTimeout(400);

  // 10. Poll post.
  await page.evaluate(() => {
    const c = Array.prototype.find.call(document.querySelectorAll('.grid .card'), (x) => x._post && x._post.kind === 'poll' && x._post.canView);
    Focus.set(c);
  });
  await key('Enter'); await page.waitForTimeout(800);
  check('poll shows results', (await page.$$('.poll-choice')).length === 3);
  await shot('15-poll');
  await key('Escape'); await page.waitForTimeout(300);

  // 11. Creators and a creator page.
  await page.evaluate(() => App.go('creators'));
  await page.waitForSelector('.creator-tile'); await page.waitForTimeout(500);
  check('creators lists memberships', (await page.$$('.creator-tile')).length >= 2);
  await shot('16-creators');
  await key('Enter'); await page.waitForTimeout(1200);
  check('creator page shows posts', (await screenName()) === 'creator' && (await page.$$('.grid .card')).length > 0);
  await shot('17-creator');
  // Sorting: the Sort chip switches between newest and oldest first.
  const firstNum = () => page.evaluate(() => { const t = document.querySelector('.grid .card .card-title'); const m = t && /#(\d+)/.exec(t.textContent); return m ? +m[1] : null; });
  const newest = await firstNum();
  await page.evaluate(() => Focus.set(document.querySelector('.chip-sort')));
  await key('Enter'); await page.waitForTimeout(1000);
  const oldest = await firstNum();
  const oldestLabel = await page.textContent('.chip-sort');
  await shot('17b-creator-oldest');
  check('creator posts sort oldest first', /Oldest first/.test(oldestLabel) && newest > oldest && (await page.$$('.grid .card')).length > 0, newest + ' then ' + oldest);
  await key('Enter'); await page.waitForTimeout(1000);
  check('and back to newest first', /Newest first/.test(await page.textContent('.chip-sort')) && (await firstNum()) === newest);
  await page.evaluate(() => Focus.set(Array.prototype.find.call(document.querySelectorAll('.btn'), (b) => /tiers/.test(b.textContent))));
  await key('Enter'); await page.waitForTimeout(300);
  check('membership tiers show', (await page.$$('.tier')).length === 3);
  await shot('18-tiers');
  await key('Escape');
  await page.evaluate(() => Focus.set(Array.prototype.find.call(document.querySelectorAll('.chip'), (b) => /Collections/.test(b.textContent))));
  await key('Enter'); await page.waitForTimeout(600);
  const colText = await page.textContent('.creator-page');
  check('collections tab lists collections', /Beginner series/.test(colText));
  check('post counts show as numbers, even when Patreon sends one as an object', /5 posts/.test(colText) && /7 posts/.test(colText) && !/object Object/.test(colText));
  await key('ArrowDown'); await key('Enter'); await page.waitForTimeout(800);
  check('collection opens', (await screenName()) === 'collection' && (await page.$$('.grid .card')).length > 0);
  await shot('19-collection');

  // 12. Search.
  await page.evaluate(() => App.go('search'));
  await page.waitForTimeout(300);
  await page.fill('#in-search', 'sketch');
  await page.click('#btn-search'); await page.mouse.move(5, 1075); await page.waitForTimeout(600);
  check('search finds creators', /Sketchbook Club/.test(await page.textContent('.page')));
  await shot('20-search');

  // 12a. A YouTube post shaped like patreon.com's: post_file and images only hold its thumbnail picture.
  const ytPost = await page.evaluate(() => Api.post('49989').then((p) => ({ type: p.type, video: p.video, embed: p.embed && p.embed.player, images: p.images.length, links: p.videoLinks.length })));
  check('a YouTube post plays YouTube, not its thumbnail', ytPost.type === 'video_embed' && !ytPost.video && /youtube\.com\/embed\/aqz-KE-bpKQ/.test(ytPost.embed || '') &&
    ytPost.images === 0 && ytPost.links === 1, JSON.stringify(ytPost));

  // 12b. YouTube and Vimeo links pasted into a post's text play in the app.
  await page.evaluate(() => Api.post('49997').then((p) => { window._yt = p; App.push(Views.post(p)); }));
  await page.waitForTimeout(900);
  const yt = await page.evaluate(() => ({ kind: _yt.kind, embed: _yt.embed && _yt.embed.player, thumb: _yt.thumb,
    extra: Array.prototype.map.call(document.querySelectorAll('.video-links .card'), (c) => c.textContent) }));
  check('YouTube link in post text makes a video post', yt.kind === 'video' && /embed\/aqz-KE-bpKQ.*start=30/.test(yt.embed), JSON.stringify(yt.embed));
  check('other video links in the post are listed', yt.extra.length === 2 && /YouTube/.test(yt.extra[0]) && /Vimeo/.test(yt.extra[1]), yt.extra.join(' / '));
  await shot('20b-youtube-post');
  await page.evaluate(() => Focus.set(Array.prototype.find.call(document.querySelectorAll('.post-actions .btn'), (b) => /^Play/.test(b.textContent))));
  await key('Enter'); await page.waitForTimeout(500);
  const ifr = await page.evaluate(() => { const f = document.querySelector('#embed iframe'); return f && !document.querySelector('#embed').classList.contains('hidden') ? f.src : null; });
  check('Play opens YouTube\'s player inside the app', /youtube\.com\/embed\/aqz-KE-bpKQ/.test(ifr || ''), ifr);
  const hintGone = () => page.evaluate(() => document.querySelector('.embed-hint').classList.contains('gone'));
  const hintAtStart = await hintGone();
  await page.waitForTimeout(4300);
  const hintLater = await hintGone();
  await key('ArrowRight'); await page.waitForTimeout(100);
  check('the key hint shows, fades after a few seconds, and comes back on a key', !hintAtStart && hintLater && !(await hintGone()));
  // The player reports that it can't play the video here: OK hands it to the TV's YouTube app.
  await page.evaluate(() => {
    const f = document.querySelector('#embed iframe');
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'onError', info: 150 }), source: f.contentWindow }));
  });
  await page.waitForTimeout(200);
  check('a video that won\'t embed offers the YouTube app', /YouTube app/.test(await page.textContent('.embed-trouble')) && await page.evaluate(() => !document.querySelector('.embed-trouble').classList.contains('hidden')));
  await shot('20c-youtube-trouble');
  await key('Enter'); await page.waitForTimeout(300);
  const ytMsg = hostMessages.filter((m) => m.cmd === 'youtube').pop();
  check('OK then opens it in the YouTube app', ytMsg && ytMsg.video === 'aqz-KE-bpKQ', JSON.stringify(ytMsg));
  await page.evaluate(() => Focus.set(Array.prototype.find.call(document.querySelectorAll('.post-actions .btn'), (b) => /^Play/.test(b.textContent))));
  await key('Enter'); await page.waitForTimeout(500);
  await key('Escape'); await page.waitForTimeout(300);
  check('Back closes the YouTube player', await page.evaluate(() => document.querySelector('#embed').classList.contains('hidden') && App.top().name === 'post'));
  await page.evaluate(() => Focus.set(Array.prototype.find.call(document.querySelectorAll('.post-text a'), (a) => /vimeo/.test(a.href))));
  await key('Enter'); await page.waitForTimeout(400);
  const vim = await page.evaluate(() => { const f = document.querySelector('#embed iframe'); return f ? f.src : null; });
  check('a Vimeo link in the text plays instead of showing a QR code', /player\.vimeo\.com\/video\/76979871/.test(vim || ''), vim);
  await key('Escape'); await page.waitForTimeout(300);
  await key('Escape'); await page.waitForTimeout(300);

  // 13. Settings toggles persist.
  await page.evaluate(() => App.go('settings'));
  await page.waitForTimeout(300);
  await page.evaluate(() => Focus.set(Array.prototype.find.call(document.querySelectorAll('.setting.focusable'), (b) => /Seek step/.test(b.textContent))));
  await key('Enter');
  check('settings change and persist', (await page.evaluate(() => Store.settings().seekStep)) === 15);
  await shot('21-settings');

  // 14. Relaunch keeps the session; Back at home asks to exit, and exit goes through the TV helper.
  await page.reload({ waitUntil: 'commit' }); await page.waitForTimeout(1500);
  check('relaunch skips sign-in', (await screenName()) === 'home');
  await page.evaluate(() => { const c = document.querySelector('.card'); if (c) Focus.set(c); });
  await key('Escape'); await page.waitForTimeout(300);
  check('Back on home asks to exit', /Exit Patreon TV/.test(await page.textContent('body')));
  await shot('22-exit');
  await key('ArrowLeft'); await key('Enter'); await page.waitForTimeout(300);
  check('exit asks the TV helper to close the app', hostMessages.some((m) => m.cmd === 'exit'), JSON.stringify(hostMessages));

  // 15. What Patreon checks, the app sends: the CSRF signature on changes and patreon.com's Referer on video.
  const muts = patreon.state.mutations;
  check('likes and comments carry Patreon\'s CSRF signature', muts.length >= 2 && muts.every((m) => m.csrf === fake.CSRF), JSON.stringify(muts.slice(0, 3)));
  const refs = patreon.state.mediaReferers;
  check('video is requested with patreon.com as Referer', refs.length && refs.every((r) => r && r.startsWith(ORIGIN)), refs.slice(0, 2).join(', '));

  // 16. Patreon's bot check: its page is shown once, and the app comes back when it passes.
  patreon.state.challengeOnce = true;
  await page.reload({ waitUntil: 'commit' });
  await page.waitForTimeout(4000);
  check('after Patreon\'s bot check the app comes back', (await screenName()) === 'home', await page.title());

  // 17. Signing out, and an expired session, both return to sign-in.
  await page.evaluate(() => App.go('settings'));
  await page.waitForTimeout(300);
  await page.evaluate(() => Focus.set(Array.prototype.find.call(document.querySelectorAll('.setting.focusable'), (b) => /Sign out/.test(b.textContent))));
  await key('Enter'); await page.waitForTimeout(200); await key('Enter');
  await page.waitForTimeout(1500);
  check('sign out returns to sign-in', (await screenName()) === 'login' && !(await context.cookies()).some((c) => c.name === 'session_id' && c.value));
  await context.addCookies([{ name: 'session_id', value: fake.SESSION, url: ORIGIN }]);
  await page.goto(`${ORIGIN}/home`, { waitUntil: 'commit' }); await page.waitForTimeout(1200);
  await context.clearCookies();
  await page.evaluate(() => App.go('home'));
  await page.waitForTimeout(1200);
  check('an expired session sends you back to sign-in', (await screenName()) === 'login');

  // 18. On a computer (the Chrome add-on): patreon.com stays normal until opened with #tv.
  const pc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await pc.addInitScript(`window.PTV_TEST_HOST = 'localhost:${PORT}';`);
  await pc.addInitScript({ path: BUNDLE });
  await pc.addCookies([{ name: 'session_id', value: fake.SESSION, url: ORIGIN }]);
  const pcPage = await pc.newPage();
  pcPage.on('pageerror', (e) => errors.push('pc pageerror: ' + e.message));
  await pcPage.goto(`${ORIGIN}/home`); await pcPage.waitForTimeout(600);
  check('computer: patreon.com is untouched without #tv', await pcPage.evaluate(() => window.PATREON_PAGE_RAN === true && !window.App));
  await pcPage.goto(`${ORIGIN}/home#tv`, { waitUntil: 'commit' }); await pcPage.waitForTimeout(1500);
  check('computer: #tv opens the app, scaled to the window', await pcPage.evaluate(() => !!window.App && App.top().name === 'home' && !!document.getElementById('webbar')));
  await pcPage.screenshot({ path: path.join(OUT, '23-computer.png') });
  await pcPage.reload({ waitUntil: 'commit' }); await pcPage.waitForTimeout(1500);
  check('computer: the tab stays in app mode', await pcPage.evaluate(() => !!window.App && App.top().name === 'home'));
  // A YouTube video fills the whole window, and the Back and pause buttons stay out of the way until the mouse moves.
  await pcPage.evaluate(() => Api.post('49989').then((p) => Player.openLink(p.embed, p)));
  await pcPage.waitForTimeout(800);
  const box = await pcPage.locator('#embed iframe').boundingBox();
  const barOpacity = () => pcPage.evaluate(() => getComputedStyle(document.getElementById('webbar')).opacity);
  const barPlaying = await barOpacity();
  check('computer: a YouTube video fills the window', box && box.x <= 1 && box.y <= 1 && box.width >= 1279 && box.height >= 799, JSON.stringify(box));
  // The mouse over YouTube's player only reaches YouTube, so pointing at the buttons' corner brings them back.
  const bar = await pcPage.locator('#webbar .webbar-btn').first().boundingBox();
  await pcPage.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2); await pcPage.waitForTimeout(450);
  const barMouse = await barOpacity();
  check('computer: the Back and pause buttons hide during a video and show when pointed at', barPlaying === '0' && barMouse === '1', barPlaying + ' / ' + barMouse);
  await pcPage.keyboard.press('Escape'); await pcPage.waitForTimeout(300);

  check('no "[object Object]" on any screen', !seenObjectText.length, seenObjectText.join(' | '));
  check('no script errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  patreon.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); patreon.close(); process.exit(1); });
