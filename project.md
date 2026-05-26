# Project: YT Distiller

## Overview
Chrome extension that analyzes any YouTube video's transcript and plays only the most educational/valuable segments — automatically skipping filler, intros, tangents, and fluff. Users get the knowledge without the noise, watching the real video in-place.

## Tech Stack
- **Chrome Extension Manifest V3** — content scripts, background service worker, popup
- **Vanilla JS** — no framework needed; keeps the extension lightweight and fast
- **DeepSeek Chat API** — analyzes transcript segments and identifies what's worth watching. User brings their own API key (stored in chrome.storage.sync)
- **YouTube timedtext API** — fetches captions via same-origin fetch from content script (no CORS issues)

## Architecture
```
extension/
  manifest.json         — MV3 manifest, declares permissions and scripts
  background.js         — Service worker: handles DeepSeek API calls via chrome.runtime messages
  content.js            — Injected into YouTube pages: fetches transcript from ytInitialPlayerResponse,
                          injects Distill button, sends to background, controls player
  popup/
    popup.html          — Settings UI: API key input
    popup.js            — Saves/loads API key to chrome.storage.sync
  icons/                — Extension icons
```

Flow:
1. User visits a YouTube video page
2. Content script parses `ytInitialPlayerResponse` from `<script>` tags to get caption track URL
3. Content script does same-origin fetch to `youtube.com/api/timedtext` (uses session cookies — no CORS)
4. User clicks "Distill ✶" button in the player toolbar
5. Content script sends transcript to background service worker
6. Background worker calls DeepSeek Chat API: "which segments are worth watching?"
7. DeepSeek returns array of `{start, end}` timestamps in seconds
8. Content script seeks video to each segment in sequence, auto-advancing on `timeupdate`

## Key Files
- `extension/manifest.json` — MV3 manifest, permissions, content script registration
- `extension/content.js` — transcript fetch + Distill button + segment playback
- `extension/background.js` — DeepSeek Chat API call, returns [{start, end}] segments
- `extension/popup/popup.html` + `popup.js` — settings UI with API key management
- `test-extension.js` — Playwright end-to-end test (mocks timedtext with fake transcript)

## How to Run
1. Clone repo, open `chrome://extensions`, enable **Developer Mode**
2. Click **Load unpacked**, select the `extension/` folder
3. Click the YT Distiller icon, paste your DeepSeek API key, click Save
4. Go to any YouTube video — click **Distill ✶** in the player controls

## How to Test
```
npm install
cp .env.example .env   # add DEEPSEEK_API_KEY
node test-extension.js
```
