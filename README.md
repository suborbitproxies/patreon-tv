# Patreon TV for Samsung Tizen

An unofficial Patreon app for Samsung smart TVs (built for a Samsung Frame), driven entirely by the TV remote.
Patreon has no TV app on any platform, so this fills the gap for patrons. Everything runs on the TV: there is no
server, bridge or computer involved once it's installed.

Not made or endorsed by Patreon.

## What it does

- **Home feed** of the latest posts from everyone you support or follow, with filters for videos, audio, images and
  text posts, loading more as you scroll.
- **Continue watching**: resume videos and audio where you left off.
- **Your creators**: every membership, with your tier price.
- **Creator pages**: cover, description, membership tiers, all posts filtered by type and sorted newest or oldest
  first, and collections (in the creator's order, or by date).
- **Posts**: full text with images, image galleries with a full-screen viewer and zoom, polls with results,
  attachments, tags, and locked posts showing which tier unlocks them.
- **Video player**: Patreon's HLS and MP4 video, seek with ◀ ▶, remote media keys, auto-play next, resume.
- **Audio player**: keeps playing in the background with a now-playing bar while you browse.
- **YouTube and Vimeo** videos play inside the app, whether the creator embedded them or just pasted a link in the
  text. A post with several links lists them under "Videos in this post". If a YouTube video refuses to play outside
  YouTube, OK opens it in the TV's YouTube app instead.
- **Likes and comments**: like posts, read comments and replies, and write comments and replies with the TV keyboard.
- **Search** for creators.
- **Open on phone**: a QR code for anything a TV can't do (joining a tier, downloading a file, following a link).
- **Settings**: blur 18+ creators, hide locked posts, seek step, auto-play, sign out.

## How it works

Patreon's official API only exposes a creator's *own* campaign, so every third-party Patreon viewer uses the JSON API
the patreon.com website calls. A TV app can't use that API directly: the TV won't send Patreon's sign-in cookie with
an app's requests, and Patreon's video host only serves pages on patreon.com (that was the "code 4" error).

So the app runs *inside* a www.patreon.com page, the way [TizenBrew](https://github.com/reisxd/TizenBrew) runs its
modules. To Patreon it looks like you're using patreon.com in a browser:

1. The app's start page launches a small helper that ships inside the app (`app/service/helper.js`).
2. The helper restarts the app with the TV's web debugger switched on. This is why Developer Mode must point at the
   TV itself (Host PC IP `127.0.0.1`).
3. Through the debugger it adds the app (`app/site/patreon-tv.js`) to every page the app window opens, then opens
   `https://www.patreon.com/home`. The app replaces Patreon's page before Patreon's own scripts run.
4. Sign-in happens on Patreon's real login page, so every method Patreon offers works. The helper presents the TV
   as desktop Chrome, because Google refuses to sign in from browsers it recognises as a TV.

On a computer, a Chrome add-on does step 3, so you can try the same app with your own account in a browser.

## Install on the TV

1. **Developer Mode.** Open **Apps**, press **1 2 3 4 5** on the remote, turn Developer mode **On**, and enter the IP
   of the computer you'll install from. Restart the TV (hold the power button until the Samsung logo shows).
2. **Install.** In [Apps2Samsung](https://apps2samsung.com/), pick your TV, choose **custom .wgt**, and select
   `dist/PatreonTV.wgt`. Apps2Samsung signs it with your Samsung certificate. (Tizen Studio's Device Manager works
   too.)
3. **Point Developer Mode at the TV.** Open Apps, press 1 2 3 4 5 again, change Host PC IP to **127.0.0.1**, and
   restart the TV.
4. **Open Patreon TV.** It opens patreon.com by itself (it briefly closes and reopens the first time). Choose
   **Sign in with Patreon** and sign in on Patreon's page with the remote: arrows move, OK selects, Back goes back.

The app explains step 3 on screen if Developer Mode still points at your computer. To install an update later, set
Host PC IP back to your computer for the install, then to 127.0.0.1 again.

**Signing in with Google:** the app makes the TV look like Chrome to Google, which normally gets you Google's usual
sign-in page. If Google still says it can't sign you in on this device, go back and choose Patreon's option to
continue with email: Patreon emails you a code, and that works for accounts created with Google too.

## Updates

The TV app keeps itself up to date. Each time it starts, it checks this project's GitHub repo
([suborbitproxies/patreon-tv](https://github.com/suborbitproxies/patreon-tv), folder `update/`) for a newer version
of the app and uses it if the download's checksum matches. If GitHub can't be reached, it uses the version it has.
Only changes to the start page or the on-TV helper need a new `PatreonTV.wgt` installed the usual way; when an update
needs that, the helper's log says so and the app keeps its current version.

The Chrome add-on doesn't update itself: unzip the new `patreon-tv-chrome.zip` over the old folder and press reload
in `chrome://extensions`.

## Try it on a computer

1. Unzip `dist/patreon-tv-chrome.zip`.
2. In Chrome (or Edge), open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and pick the
   unzipped folder.
3. Click the add-on's toolbar button, or open `https://www.patreon.com/home#tv`. That tab becomes the TV app, signed
   in as you are on patreon.com. Every other tab stays normal Patreon.

Arrow keys, Enter and Esc act as the remote, the space bar plays and pauses, and you can also click and scroll.
Choosing Exit on the home screen returns the tab to normal patreon.com.

A preview on made-up sample data (no account needed) builds with `sh tools/build-web.sh` into `dist/web/`.

## Remote

| Key | Action |
| --- | --- |
| Arrows | Move |
| OK | Open; play or pause in the player |
| ◀ ▶ in the player | Seek (5 to 30 seconds, set in Settings) |
| ⏪ ⏩ | Seek 30 seconds |
| ▶❚❚ on a post | Play it right away |
| CH ▲ ▼ | Next or previous item in the player |
| Red | Restart the current video |
| Yellow | Show the audio player |
| Blue in a YouTube or Vimeo video | Show a QR code to watch it on your phone |
| Back | Go back, close the player (audio keeps playing), or exit from Home |

## Things to know

- **Your home network.** While the app is open, the TV's web debugger is reachable from your home network (the same
  is true of TizenBrew). Anyone on your network who knows how could look into the app while it runs, including your
  Patreon session. Use it on a network you trust.
- **Developer Mode** has to stay on with Host PC IP 127.0.0.1. On TVs from 2023 on (Tizen 7+), apps need a Samsung
  certificate; Apps2Samsung handles that.
- **Patreon's bot check.** If Patreon wants to check the browser, the app shows Patreon's page until the check
  passes, then comes back by itself.
- **Not yet tried against the real patreon.com.** The API calls, sign-in pages and video follow what patreon.com and
  open-source tools (gallery-dl, patreon-dl, yt-dlp) use, and the whole flow is tested against a stand-in for
  patreon.com and a stand-in TV, but the first run on a real TV and account is the real test. If something fails,
  the TV start page shows details, and `http://127.0.0.1:8617/log` on the TV holds the helper's log.
- Voting in polls, joining or changing tiers, direct messages and the shop open on your phone instead.
- Patreon can change its private web API at any time; `app/js/api.js` is where fixes would go.

## Development

```
app/                 the TV package (.wgt root)
  js/, css/, vendor/ the app itself (plain ES5, no build step)
  index.html         the TV start page (starts the helper), and the app for the sample-data preview
  service/helper.js  the on-TV helper (Node.js service, ES5, no dependencies)
  site/patreon-tv.js the app packed for patreon.com (generated by tools/build-site.js)
extension/           Chrome add-on source (manifest and toolbar button)
tools/
  build-site.js      packs the app for patreon.com and builds the Chrome add-on
  build-wgt.sh       builds dist/PatreonTV.wgt (runs build-site.js first)
  build-web.sh       builds the sample-data preview
  site/loader.js     the part of the packed app that takes over the patreon.com page
  mock/              sample Patreon data and media
test/
  e2e.js             the app driven by remote keys inside a stand-in patreon.com
  helper-test.js     the helper against a stand-in TV (sdbd, Developer Mode API, Tizen APIs, update site) and Chromium
  fake-patreon.js    the stand-in patreon.com
```

Build: `sh tools/build-wgt.sh` (also rebuilds the Chrome add-on in `dist/`).

Publish an app update: bump the version in `extension/manifest.json`, run `node tools/build-site.js`, and push
`dist/update/version.json` and `dist/update/patreon-tv.js` to `update/` in the GitHub repo. TVs pick it up the next time
the app starts. If the app needs something only a newer helper does, raise `MIN_HELPER` in `tools/build-site.js`.

Tests (need Playwright; `NODE_PATH` pointing at a global install works): `node test/e2e.js` and
`node test/helper-test.js`. They cover sign-in on Patreon's page with the remote, navigation, filters, paging,
video and audio playback, seeking, resume, likes and comments with Patreon's CSRF signature, video Referer,
galleries, locked posts, polls, creators, tiers, collections, search, settings, YouTube and Vimeo links, Patreon's
bot check, sign-out and session expiry, the Chrome add-on's tab switch, and the helper's Developer Mode check,
debugger relaunch, injection, updates, desktop-Chrome user agent, YouTube hand-off and exit.
