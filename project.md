# Project: YT Distiller

## Overview
Chrome extension that analyzes any YouTube video's transcript and plays only the most educational/valuable segments — automatically skipping filler, intros, tangents, and fluff. Users get the knowledge without the noise, watching the real video in-place via YouTube's iframe API.

## Tech Stack
- **Chrome Extension Manifest V3** — content scripts, background service worker, popup
- **Vanilla JS** — no framework needed; keeps the extension lightweight and fast
- **DeepSeek V4 Pro API** — analyzes transcript segments and identifies what's worth watching. User brings their own API key (stored in chrome.storage.sync)
- **YouTube iframe API** — controls playback to skip between key segments without downloading anything
- **YouTube timedtext API** — fetches transcript data from `ytInitialPlayerResponse` embedded in the page

## Architecture
```
extension/
  manifest.json         — MV3 manifest, declares permissions and scripts
  background.js         — Service worker: handles DeepSeek API calls via chrome.runtime messages
  content.js            — Injected into YouTube pages: fetches transcript, injects Distill button, controls player
  popup/
    popup.html          — Settings UI: API key input
    popup.js            — Saves/loads API key to chrome.storage.sync
  icons/                — Extension icons
```

Flow:
1. User visits a YouTube video page
2. Content script detects video, injects "Distill" button in the YouTube toolbar
3. User clicks Distill → content script extracts transcript from `ytInitialPlayerResponse`
4. Content script sends transcript to background worker
5. Background worker calls DeepSeek V4 Pro: "which segments are worth watching?"
6. DeepSeek returns array of `{start, end}` timestamps in seconds
7. Content script uses YouTube iframe API to play only those segments in sequence, auto-advancing

## Key Files
- `extension/manifest.json` — MV3 manifest, permissions, content script registration
- `extension/content.js` — transcript fetch + Distill button + segment playback
- `extension/background.js` — DeepSeek V4 Pro API call, returns [{start, end}] segments
- `extension/popup/popup.html` + `popup.js` — settings UI with API key management

## How to Run
1. Clone repo, open `chrome://extensions`, enable **Developer Mode**
2. Click **Load unpacked**, select the `extension/` folder
3. Click the YT Distiller icon, paste your DeepSeek V4 Pro API key, click Save
4. Go to any YouTube video — click **Distill ✦** in the player controls
