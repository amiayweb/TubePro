# TubePro

An browser extension that replaces the YouTube watch-page player with a custom player, quality controls, and optional SponsorBlock. The original player is retained as an automatic fallback.

## Build

Node.js 22 or newer is required.

```sh
npm ci
npm run build
```

Outputs:

- `dists/chrome/` — unpacked Chrome Manifest V3 extension.
- `dists/firefox/` — unpacked Firefox Manifest V3 extension.
- `dists/tubepro-chrome-1.0.0.zip`
- `dists/tubepro-firefox-1.0.0.zip`

Chrome: open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dists/chrome`.

Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dists/firefox/manifest.json`. This temporary installation lasts until Firefox closes. Permanent installation requires Mozilla signing; the ZIP is not a signed XPI.

Refresh existing YouTube tabs after installation. Open a normal YouTube `/watch?v=…` video. Shorts, embeds, and other sites are left alone. The toolbar popup controls activation, SponsorBlock and preferred quality. Disabling TubePro immediately restores native playback. Other preferences apply to the next video.

## Playback and fallback

TubePro reads the matching YouTube page player response through a packaged MAIN-world function. It validates the live page URL after SPA navigation, reuses matching media URLs already resolved by the native player (including existing signature/token parameters), and checks HTTP media access before decoding. In parallel, it requests an independent VISIONOS client response from YouTube without cookies. Its direct media URLs are preferred; page-resolved WEB URLs are a secondary attempt. If the independent client refuses the video, TubePro also tries the existing YouTube page session through a same-origin request. Cookies and visitor identity stay in the page; only stream metadata returns to the extension. Anti-bot or sign-in refusals remain possible and are identified explicitly in the fallback message. HTTP media checks run before decoding. The client profile follows the public [yt-dlp adapter](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py). Direct adaptive formats are converted into a local DASH manifest and played with bundled Shaka Player. Muxed MP4 streams are fetched and fragmented locally by MP4Box for MediaSource playback; their remote URL is never assigned directly to the video element. If DASH decoding fails, an available verified muxed MP4 is retried before native fallback.

The player offers automatic/manual quality, playback speed, volume, seeking, keyboard shortcuts, fullscreen, and picture in picture where the browser supports it. Quality is limited to streams the browser can decode and YouTube actually exposes. The quality preference currently applies to DASH; direct muxed streams initially use their highest available quality.

The dark player UI uses SVG controls and hides after 1.3 seconds of pointer inactivity during playback, including fullscreen. Paused playback, active dragging, open selectors, and keyboard-focused controls stay visible. Moving the pointer or using the keyboard shows the controls again.

Playback positions are saved per video in local extension storage every 5 seconds, immediately when seeking or pausing, and when leaving the player. Writes run through a single background queue with capture timestamps, so stale departure snapshots cannot overwrite a newer position. Reopening a video resumes at the saved position; explicit `t` or `start` URL parameters take priority. Completed videos start again. Records older than 180 days or with mismatching video durations are ignored. Positions from the first 5 seconds are not retained.

**This first version supports direct media URLs. It does not independently implement signature deciphering, `n` transformations, PO-token generation, or SABR playback. Existing resolved URLs can be reused only when their media identity and format match the current video.** YouTube frequently requires these, so some or many videos may immediately use the original player. Changing the UI alone does not bypass these restrictions. No promise of universal ad-free playback is made.

The independent player does not schedule YouTube ads. It is not a site-wide ad blocker. In fallback mode, YouTube behaves normally, **including its advertising**, and SponsorBlock is not applied to the original player.

Fallback occurs on extraction failure, unsupported/ciphered-only streams, live streams, rejected/expired media, critical player errors, startup timeout (18 seconds per extraction/loading phase), a missing video area lasting more than 5 seconds, or a playback stall (20 seconds while visible and playing). A notification explains that a YouTube update may have changed third-party playback. You can retry or stay with YouTube. The last content position and pause state are restored where possible; TubePro does not seek native advertisements.

The original player DOM is not replaced. TubePro temporarily hides it, pauses its video, and mounts a separate extension iframe above it, outside YouTube-owned DOM so native player replacements do not destroy playback. It removes that iframe, all playback guards, and its temporary styles on fallback/navigation/disable. The fallback notice is the only remaining TubePro UI.

## SponsorBlock and privacy

When enabled (default), TubePro sends the video ID and selected categories to `https://sponsor.ajay.app/api/skipSegments`. Only community-known segments can be skipped. **Undo** replays a skipped segment without immediately skipping it again. SponsorBlock failure never forces a playback fallback.

Settings stay in local extension storage. No analytics, third-party video proxies, exported cookies, or remotely downloaded executable code are used. Playback and independent player API requests go to YouTube/Google video servers. Host permissions are limited to `www.youtube.com`, Google video subdomains, and SponsorBlock. The scripting permission reads player metadata in the current YouTube tab. A narrowly scoped declarative network rule removes the extension Origin header only from TubePro-initiated requests to the YouTube JSON player endpoint: that endpoint rejects chrome-extension and moz-extension origins with HTTP 403. Website-initiated requests and all other endpoints are unaffected. Signed stream URLs are transient and are not stored or logged.

## GitHub builds and releases

The workflow `.github/workflows/build-release.yml` runs lint, unit tests, and both browser builds on pull requests and pushes to `main` or `master`. The Chrome/Firefox ZIPs and SHA-256 checksums are available in the workflow run's **Artifacts**.

To publish the current version:

1. Push this project, including the workflow, to GitHub's default branch.
2. Open **Actions → Build and release → Run workflow**.
3. Leave **Create the version tag and publish the Chrome/Firefox release** enabled.

The workflow reads `package.json`, creates `v1.0.0` at the exact built commit, and publishes a release containing `tubepro-chrome-1.0.0.zip`, `tubepro-firefox-1.0.0.zip`, and `SHA256SUMS.txt`. It uses GitHub's built-in token; no personal access token or store credentials are needed. Repository rules must permit GitHub Actions to create the tag and release.

You can also push a `v…` tag yourself to trigger publication. Its version must match both package files. Disable the manual **publish** input to build without creating a tag or release. Ordinary branch pushes do not publish releases.

Version numbers are never incremented automatically. An existing tag pointing to a different commit is rejected, and a published release is left unchanged. A failed draft publication can be rerun for the same commit to finish uploading its assets. Publishing changed code as a new release requires an explicit version change in both `package.json` and `package-lock.json`.

The Firefox ZIP is unsigned; this workflow does not publish to Mozilla Add-ons or the Chrome Web Store. For rollback, users can reinstall a previous release's ZIP. If a newly published release must be withdrawn, delete that GitHub release manually; the workflow does not rewrite tags or replace published assets. [GitHub release CLI documentation](https://cli.github.com/manual/gh_release_create).

## Local development

```sh
npm test
npm run lint
npm run format:check
npm run test:browser
```

Browser tests use an isolated Playwright Chromium profile and synthetic YouTube responses; no personal browser profile is accessed. Install the test browser with `npx playwright install chromium`. Tests do not prove current live YouTube availability; that requires manual validation against actual videos.

- `src/extractor.js`: current-page metadata and resolved-URL adapter.
- `src/provider.js`: independent client response adapter; update this when YouTube changes.
- `src/streams.js`: stream validation and DASH manifest generation.
- `src/content.js`: YouTube navigation, mounting, original-player restoration.
- `src/player.js`, `src/player.css`: player and SponsorBlock.
- `src/background.js`: narrowly scoped extraction and SponsorBlock requests.
- `scripts/build.mjs`: browser-specific builds, icons, and ZIP archives.

Shaka Player is Apache-2.0 licensed. MP4Box is BSD-3-Clause licensed. Both licenses are included in both packages.
