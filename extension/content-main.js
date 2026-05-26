// Runs in the page's MAIN world — has access to window.ytcfg, real cookies,
// window.ytInitialData, and window.ytInitialPlayerResponse.
// Communicates with content.js (isolated world) via postMessage.

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data?.type !== 'YTD_FETCH_TRANSCRIPT') return;
  const { msgId } = event.data;
  const send = (segments) => window.postMessage({ type: 'YTD_TRANSCRIPT_RESULT', msgId, segments }, '*');

  function parseInnertubeSegments(data) {
    for (const action of (data?.actions || [])) {
      const segs = action?.updateEngagementPanelAction?.content
        ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer
        ?.body?.transcriptSegmentListRenderer?.initialSegments;
      if (!Array.isArray(segs) || !segs.length) continue;
      const result = segs.map(item => {
        const seg = item?.transcriptSegmentRenderer;
        if (!seg) return null;
        const text = (seg.snippet?.runs || []).map(r => r.text).join('').trim();
        const start = parseInt(seg.startMs || '0', 10) / 1000;
        const dur = seg.endMs ? (parseInt(seg.endMs, 10) - parseInt(seg.startMs || '0', 10)) / 1000 : 0;
        return text ? { text, start, duration: dur } : null;
      }).filter(Boolean);
      if (result.length) return result;
    }
    return null;
  }

  function parseXml(text) {
    if (!text || text.trimStart().startsWith('<html') || text.trimStart().startsWith('<!')) return null;
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    if (xml.querySelector('parsererror')) return null;
    const segs = Array.from(xml.querySelectorAll('text')).map(node => ({
      text: node.textContent.trim(),
      start: parseFloat(node.getAttribute('start') || '0'),
      duration: parseFloat(node.getAttribute('dur') || '0'),
    })).filter(s => s.text.length > 0);
    return segs.length ? segs : null;
  }

  try {
    const cfg = window.ytcfg;
    const apiKey = cfg?.get('INNERTUBE_API_KEY') || '';
    const clientVersion = cfg?.get('INNERTUBE_CLIENT_VERSION') || '';
    const visitorData = cfg?.get('VISITOR_DATA') || '';
    const hl = cfg?.get('HL') || 'en';
    const gl = cfg?.get('GL') || 'US';

    // STEP 1: Try innertube transcript API
    const panels = window.ytInitialData?.engagementPanels;
    const panel = Array.isArray(panels) && panels.find(
      p => p?.engagementPanelSectionListRenderer?.panelIdentifier === 'engagement-panel-searchable-transcript'
    );
    const continuationToken = panel?.engagementPanelSectionListRenderer?.content
      ?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint?.params;

    console.log('[YTD] main-world: continuationToken=' + (continuationToken ? continuationToken.slice(0, 30) + '…' : 'none'));

    if (continuationToken) {
      let authHeader = '';
      try {
        const sapisid = document.cookie.match(/(?:^|;\s*)SAPISID=([^;]+)/)?.[1];
        if (sapisid) {
          const ts = Math.floor(Date.now() / 1000);
          const buf = new TextEncoder().encode(ts + ' ' + sapisid + ' https://www.youtube.com');
          const hashBuf = await crypto.subtle.digest('SHA-1', buf);
          const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
          authHeader = 'SAPISIDHASH ' + ts + '_' + hex;
          console.log('[YTD] main-world: built SAPISIDHASH');
        } else {
          console.log('[YTD] main-world: no SAPISID cookie (not logged in?)');
        }
      } catch (e) { console.log('[YTD] main-world: SAPISIDHASH error', e.message); }

      const headers = {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': clientVersion,
        'X-Goog-Visitor-Id': visitorData,
      };
      if (authHeader) headers['Authorization'] = authHeader;

      try {
        const res = await fetch('/youtubei/v1/get_transcript?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB', clientVersion, hl, gl, visitorData,
                originalUrl: location.href,
                userAgent: navigator.userAgent,
                platform: 'DESKTOP',
                clientFormFactor: 'UNKNOWN_FORM_FACTOR',
                mainAppWebInfo: {
                  graftUrl: location.pathname + location.search,
                  webDisplayMode: 'WEB_DISPLAY_MODE_BROWSER',
                },
              },
              user: { lockedSafetyMode: false },
              request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] },
            },
            params: continuationToken,
          }),
        });
        console.log('[YTD] main-world: innertube status', res.status);
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const segs = data && parseInnertubeSegments(data);
          if (segs) { send(segs); return; }
        }
      } catch (e) { console.log('[YTD] main-world: innertube error', e.message); }
    }

    // STEP 2: Try timedtext URL from ytInitialPlayerResponse (full cookies, main world)
    const tracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    console.log('[YTD] main-world: timedtext tracks=' + (tracks?.length ?? 0));
    if (tracks?.length) {
      const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
      if (track?.baseUrl) {
        const url = track.baseUrl.replace(/([?&])fmt=[^&]*/g, (_, sep) => sep === '?' ? '?' : '');
        console.log('[YTD] main-world: timedtext url', url.slice(0, 80));
        try {
          const res = await fetch(url);
          console.log('[YTD] main-world: timedtext status', res.status, res.headers.get('content-type'));
          if (res.ok) {
            const text = await res.text();
            console.log('[YTD] main-world: timedtext prefix', text.slice(0, 100));
            const segs = parseXml(text);
            if (segs) { send(segs); return; }
          }
        } catch (e) { console.log('[YTD] main-world: timedtext error', e.message); }
      }
    }

    send(null);
  } catch (e) {
    console.log('[YTD] main-world: top-level error', e.message);
    send(null);
  }
});
