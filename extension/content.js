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


function getInitialData() {
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent;
    if (!text.includes('ytInitialData')) continue;
    const marker = 'ytInitialData';
    const idx = text.indexOf(marker);
    if (idx === -1) continue;
    // advance past `ytInitialData\s*=\s*`
    let start = idx + marker.length;
    while (start < text.length && /[\s=]/.test(text[start])) start++;
    if (text[start] !== '{') continue;
    const jsonStr = extractJsonObject(text, start);
    if (jsonStr) {
      try { return JSON.parse(jsonStr); } catch {}
    }
  }
  // Fall back to window.ytInitialData (injected by tests or available as a global)
  if (typeof window !== 'undefined' && window.ytInitialData) return window.ytInitialData;
  return null;
}

function fetchTranscript() {
  const data = getInitialData();
  if (!data) throw new Error('Could not read video data — try reloading the page.');

  const panels = data?.engagementPanels;
  if (!Array.isArray(panels)) throw new Error('No transcript available for this video.');

  const panel = panels.find(
    (p) => p?.engagementPanelSectionListRenderer?.panelIdentifier === 'engagement-panel-searchable-transcript'
  );
  if (!panel) throw new Error('No transcript available for this video.');

  const initialSegments =
    panel.engagementPanelSectionListRenderer
      ?.content?.transcriptRenderer
      ?.content?.transcriptSearchPanelRenderer
      ?.body?.transcriptSegmentListRenderer
      ?.initialSegments;

  if (!Array.isArray(initialSegments)) throw new Error('Could not parse transcript for this video.');

  const segments = initialSegments
    .map((item) => {
      const seg = item?.transcriptSegmentRenderer;
      if (!seg) return null;
      const text = (seg.snippet?.runs || []).map((r) => r.text).join('').trim();
      const start = parseInt(seg.startMs || '0', 10) / 1000;
      const duration = seg.endMs != null
        ? (parseInt(seg.endMs, 10) - parseInt(seg.startMs || '0', 10)) / 1000
        : 0;
      return { text, start, duration };
    })
    .filter((s) => s && s.text.length > 0);

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
    transcript = fetchTranscript();
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
