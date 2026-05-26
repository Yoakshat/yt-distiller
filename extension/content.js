function extractJsonObject(src, startIndex) {
  let depth = 0;
  let inString = false;
  let i = startIndex;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      if (ch === '\\') { i += 2; continue; } // skip escaped char
      if (ch === '"') inString = false;
    } else {
      if (ch === '"') { inString = true; }
      else if (ch === '{') { depth++; }
      else if (ch === '}') { depth--; if (depth === 0) return src.slice(startIndex, i + 1); }
    }
    i++;
  }
  return null;
}

function getPlayerDataFromDOM() {
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent;
    if (!text.includes('ytInitialPlayerResponse')) continue;
    const marker = 'ytInitialPlayerResponse';
    const idx = text.indexOf(marker);
    if (idx === -1) continue;
    // advance past `ytInitialPlayerResponse\s*=\s*`
    let start = idx + marker.length;
    while (start < text.length && /[\s=]/.test(text[start])) start++;
    if (text[start] !== '{') continue;
    const jsonStr = extractJsonObject(text, start);
    if (jsonStr) {
      try { return JSON.parse(jsonStr); } catch {}
    }
  }
  return null;
}

async function fetchTranscript() {
  const playerData = getPlayerDataFromDOM();
  if (!playerData) throw new Error('Could not read video data — try reloading the page.');

  const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) throw new Error('No captions available for this video.');

  const track = tracks.find((t) => t.languageCode === 'en') || tracks[0];
  console.log('[YTD] track lang:', track.languageCode, '| kind:', track.kind, '| url prefix:', track.baseUrl?.substring(0, 80));

  // Same-origin fetch: content script on youtube.com fetches youtube.com/api/timedtext with session cookies
  let res;
  try {
    res = await fetch(track.baseUrl + '&fmt=json3');
  } catch (e) {
    throw new Error('Transcript network error: ' + e.message);
  }
  console.log('[YTD] caption status:', res.status, '| content-type:', res.headers.get('content-type'));
  if (!res.ok) throw new Error(`Transcript fetch failed: HTTP ${res.status}`);

  let data;
  try {
    const rawText = await res.text();
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error('Could not load captions — try reloading the page.');
  }

  const segments = (data.events || [])
    .filter((e) => e.segs?.length > 0)
    .map((e) => ({
      text: e.segs.map((s) => s.utf8).join('').trim(),
      start: e.tStartMs / 1000,
      duration: (e.dDurationMs || 0) / 1000,
    }))
    .filter((s) => s.text.length > 0);

  if (!segments.length) throw new Error('Could not parse transcript for this video.');
  return segments;
}

function showError(message) {
  let errorDiv = document.getElementById('ytd-error');
  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.id = 'ytd-error';
    errorDiv.style.cssText = [
      'position:absolute', 'bottom:48px', 'right:8px',
      'background:rgba(0,0,0,0.85)', 'color:#fff', 'font-size:12px',
      'padding:6px 10px', 'border-radius:4px', 'z-index:9999',
      'max-width:260px', 'pointer-events:none',
    ].join(';');
    const controls = document.querySelector('.ytp-right-controls');
    if (controls) { controls.style.position = 'relative'; controls.appendChild(errorDiv); }
    else document.body.appendChild(errorDiv);
  }
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  clearTimeout(errorDiv._hideTimer);
  errorDiv._hideTimer = setTimeout(() => { errorDiv.style.display = 'none'; }, 5000);
}

function playSegments(segments) {
  const video = document.querySelector('video.html5-main-video');
  if (!video) throw new Error('YouTube player not found');

  segments.sort((a, b) => a.start - b.start);
  let currentIdx = 0;
  const btn = document.getElementById('ytd-distill-btn');

  function showSegment(idx) {
    if (idx >= segments.length) {
      if (btn) { btn.textContent = 'Distill ✶'; btn.disabled = false; }
      video.removeEventListener('timeupdate', onTimeUpdate);
      return;
    }
    const seg = segments[idx];
    if (btn) btn.textContent = `${idx + 1} / ${segments.length} ✶`;
    video.currentTime = seg.start;
    video.play();
  }

  function onTimeUpdate() {
    const seg = segments[currentIdx];
    if (!seg) return;
    if (video.currentTime >= seg.end) { currentIdx++; showSegment(currentIdx); }
  }

  video.addEventListener('timeupdate', onTimeUpdate);
  showSegment(0);
}

async function startDistill() {
  const btn = document.getElementById('ytd-distill-btn');
  if (!btn) return;

  const reset = () => { btn.textContent = 'Distill ✶'; btn.disabled = false; };
  btn.disabled = true;
  btn.textContent = 'Fetching…';

  let transcript;
  try {
    transcript = await fetchTranscript();
  } catch (err) {
    showError(err.message);
    reset();
    return;
  }

  btn.textContent = 'Analyzing…';

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'ANALYZE_TRANSCRIPT', transcript }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  } catch (err) {
    showError('Extension error: ' + err.message);
    reset();
    return;
  }

  if (!result || !result.ok) {
    const msg = result?.error
      ? (result.error.includes('No DeepSeek API key configured')
          ? 'No API key — open the extension popup to set one.'
          : result.error)
      : 'Something went wrong. Please try again.';
    console.log('[YTD] error:', msg, '| result:', JSON.stringify(result));
    showError(msg);
    reset();
    return;
  }

  console.log('[YTD] segments received:', JSON.stringify(result.segments));
  try {
    playSegments(result.segments);
  } catch (err) {
    showError(err.message);
    reset();
  }
}

function injectDistillButton() {
  const startTime = Date.now();
  const interval = setInterval(() => {
    if (Date.now() - startTime > 10000) { clearInterval(interval); return; }
    const toolbar = document.querySelector('.ytp-right-controls');
    if (!toolbar) return;
    if (document.getElementById('ytd-distill-btn')) { clearInterval(interval); return; }

    const btn = document.createElement('button');
    btn.id = 'ytd-distill-btn';
    btn.textContent = 'Distill ✶';
    btn.style.cssText = [
      'height:28px', 'color:#fff', 'background:transparent', 'border:none',
      'cursor:pointer', 'font-size:13px', 'font-weight:600', 'padding:0 8px',
      'letter-spacing:0.5px', 'opacity:1', 'vertical-align:middle',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.7'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
    btn.addEventListener('click', startDistill);
    toolbar.insertBefore(btn, toolbar.firstChild);
    clearInterval(interval);
  }, 500);
}

document.addEventListener('yt-navigate-finish', () => {
  document.getElementById('ytd-distill-btn')?.remove();
  injectDistillButton();
});

injectDistillButton();
