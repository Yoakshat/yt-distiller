# Tasks

## In Progress
_nothing yet_

## Up Next
- [ ] extension-scaffold — Create the Chrome extension skeleton: manifest.json (MV3), background.js stub, content.js stub, popup/popup.html + popup.js with API key input/save using chrome.storage.sync, and placeholder icons. Must load on youtube.com/watch pages without errors in chrome://extensions. Done = extension loads, popup opens, no console errors.

- [ ] transcript-fetch — Content script extracts the full video transcript on a YouTube watch page. Strategy: read `ytInitialPlayerResponse` from the page's JS context (injected script), pull the caption track URL from `captions.playerCaptionsTracklistRenderer.captionTracks[0].baseUrl`, fetch it, parse the XML into an array of `{text, start, duration}` objects. Done = console.log shows structured transcript array for any YouTube video with captions.

- [ ] deepseek-integration — Background service worker receives a transcript array, calls DeepSeek V4 Pro API (`https://api.deepseek.com/v1/chat/completions`, model `deepseek-v4-pro`), asks it to identify the most educational/valuable segments and return JSON array of `{start, end}` in seconds. API key read from chrome.storage.sync. Done = given a real transcript, returns coherent timestamp ranges that cover the meaty parts.

- [ ] smart-player — Content script injects a "Distill ✦" button into the YouTube player toolbar. On click: fetches transcript, sends to background for DeepSeek analysis, then uses the YouTube iframe API to play only the returned segments in sequence (seek to start, play, auto-seek to next segment when current one ends). Show a simple progress indicator ("Segment 2 of 7"). Done = clicking Distill on a real video plays only the key segments, skipping everything else.

- [ ] settings-ui — Polish the popup: show API key as masked input with show/hide toggle, save confirmation toast, link to get a DeepSeek API key, and a status indicator (green = key saved, red = no key). Done = first-time user flow is clear and friction-free.

## Backlog
_nothing yet_
