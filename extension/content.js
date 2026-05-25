// YT Distiller — content script (runs on youtube.com/watch pages)

// Injects a script tag to read window.ytInitialPlayerResponse (inaccessible from
// the isolated content-script world) and sends the captionTracks back via postMessage.
function getYtInitialPlayerResponse() {
  return new Promise((resolve) => {
    window.addEventListener('message', function handler(e) {
      if (e.source === window && e.data?.type === 'YTD_TRANSCRIPT_DATA') {
        window.removeEventListener('message', handler);
        resolve(e.data.payload);
      }
    });

    const s = document.createElement('script');
    s.textContent = `
      const data = window.ytInitialPlayerResponse?.captions
        ?.playerCaptionsTracklistRenderer?.captionTracks;
      window.postMessage({ type: 'YTD_TRANSCRIPT_DATA', payload: data || null }, '*');
    `;
    document.documentElement.appendChild(s);
    s.remove();
  });
}

async function fetchTranscript() {
  const captionTracks = await getYtInitialPlayerResponse();

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No caption tracks available for this video.');
  }

  // Prefer the first English track; fall back to the first track available
  const track =
    captionTracks.find((t) => t.languageCode === 'en') || captionTracks[0];

  const url = track.baseUrl + '&fmt=json3';

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch transcript: HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data.events)) {
    throw new Error('Unexpected transcript format: missing events array.');
  }

  const segments = data.events
    .filter((event) => event.segs && event.segs.length > 0)
    .map((event) => {
      const text = event.segs
        .map((seg) => seg.utf8)
        .join('')
        .trim();
      return {
        text,
        start: event.tStartMs / 1000,
        duration: (event.dDurationMs || 0) / 1000,
      };
    })
    .filter((segment) => segment.text.length > 0);

  return segments;
}

(async () => {
  try {
    const segments = await fetchTranscript();
    console.log('[YT Distiller] Transcript loaded:', segments.length, 'segments');
    console.log('[YT Distiller] First 5:', segments.slice(0, 5));
  } catch (_) {
    // no captions available — ignore
  }
})();
