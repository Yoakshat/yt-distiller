# Acceptance: ytInitialData Transcript Extraction

## Success — video with captions

- User clicks **Distill ✶** on a YouTube video that has a transcript.
- Button immediately disables and shows **Fetching…** (or proceeds directly to **Analyzing…** since extraction is synchronous).
- No error toast appears at any point.
- Button transitions to **1 / N ✶** and the video jumps to the first key segment and starts playing.
- After all segments play, button resets to **Distill ✶** and re-enables.
- Zero network requests are made to `/api/timedtext` or any external transcript endpoint — the transcript is read entirely from the page DOM.

## Error — `ytInitialData` not found in DOM

- `getInitialData()` finds no `<script>` tag containing `ytInitialData`.
- `fetchTranscript()` throws with the message: `'Could not read video data — try reloading the page.'`
- Error toast appears with that exact human-readable text.
- Button resets to **Distill ✶** and re-enables.

## Error — transcript panel not found in `ytInitialData`

- `ytInitialData` is present but contains no engagement panel with `panelIdentifier === 'engagement-panel-searchable-transcript'`.
- `fetchTranscript()` throws: `'No transcript available for this video.'`
- Error toast appears with that exact message.
- Button resets to **Distill ✶** and re-enables.
- This covers videos that genuinely have no captions — the path to the error is identical.

## Error — segments empty after parsing

- Transcript panel is found but after walking to `initialSegments` and filtering out empty-text entries, the resulting array is empty.
- `fetchTranscript()` throws: `'Could not parse transcript for this video.'`
- Error toast appears with that exact message.
- Button resets.

## No network request

- DevTools Network panel shows no request to `timedtext`, `caption`, or any YouTube caption endpoint when Distill is clicked.
- The Playwright test does **not** register a `context.route()` mock for timedtext — the absence of such a mock and a clean test run confirms this.

## Error messages are human-readable

- No raw JS exception text, no stack traces, no internal path names appear in any toast.
- Every user-facing error is one of the three strings above.

## Definition of done

- `getInitialData()` is implemented and correctly parses `ytInitialData` from `<script>` tags using `extractJsonObject()`.
- `fetchTranscript()` is synchronous (no `fetch()` calls), extracts segments from the engagement panel path described in the task, and returns `{ text, start, duration }[]`.
- The three error cases throw the exact strings listed above.
- Old `console.log` lines for timedtext URL and caption HTTP status are removed.
- `test-extension.js` no longer has a `context.route('**/api/timedtext**', ...)` mock.
- `test-extension.js` injects `window.ytInitialData` via `page.addInitScript()` with a correctly-shaped mock engagement panel containing at least 5 transcript segments.
- Running the test against a real YouTube video with captions produces a full Distill → Analyzing → segment playback flow with no errors.
- `getPlayerDataFromDOM`, `extractJsonObject`, `background.js`, `popup/`, and `manifest.json` are unchanged.
