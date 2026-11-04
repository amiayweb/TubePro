<div align="center">

# TubePro

**Your videos. A cleaner player.**

[![Build](https://github.com/amiayweb/TubePro/actions/workflows/build-release.yml/badge.svg)](https://github.com/amiayweb/TubePro/actions/workflows/build-release.yml)
![Version](https://img.shields.io/badge/version-1.0.0-a99bff?style=flat-square)
![Chrome](https://img.shields.io/badge/Chrome-120%2B-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![Firefox](https://img.shields.io/badge/Firefox-128%2B-FF7139?style=flat-square&logo=firefoxbrowser&logoColor=white)

A modern YouTube player for Chrome and Firefox, with a polished dark interface, quality controls, SponsorBlock, and playback resume.

[**Download**](https://github.com/amiayweb/TubePro/releases/latest) · [Report an issue](https://github.com/amiayweb/TubePro/issues)

</div>

## Features

- **Dark player** — clean SVG controls, fullscreen, and picture in picture where supported.
- **Your preferences** — quality selection, playback speed, and keyboard shortcuts.
- **SponsorBlock** — skip community-reported sponsor segments.
- **Pick up where you left off** — locally saved playback positions.
- **Automatic fallback** — restore the original YouTube player if a stream fails.

## Requirements

Chrome **120+** or Firefox **128+** on desktop. **Node.js 24+** and npm are only needed to build from source.

## Install

Download the browser ZIP from [Releases](https://github.com/amiayweb/TubePro/releases/latest) and extract it.

| Browser     | Steps                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| **Chrome**  | Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the extracted folder.        |
| **Firefox** | Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select the extracted `manifest.json`. |

Firefox installation is temporary until the browser closes; release packages are unsigned.

## Use

Refresh YouTube and open a video. Use the player controls for quality, speed, volume, and fullscreen. Open the extension popup to enable or disable TubePro and SponsorBlock.

**Shortcuts:** `K` / `Space` play or pause · `J` / `L` skip 10 seconds · `M` mute · `F` fullscreen.

> Some videos require YouTube verification or unsupported playback features. TubePro then restores the original player, including its normal advertising.

## Build

```sh
npm ci
npm run build
```

Both browser folders and ZIPs are generated in **`dists/`**. Run `npm test` and `npm run lint` for checks. Publish a release from **Actions → Build and release → Run workflow**.
