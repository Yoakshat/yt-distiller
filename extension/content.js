// Fetches transcript by messaging content-main.js (which runs in the page's main world
// with access to ytcfg, real cookies, ytInitialPlayerResponse, etc.)
async function fetchTranscript() {
  const segments = await fetchViaMainWorld();
  if (segments && segments.length) return segments;
  throw new Error('No transcript available for this video.');
}

function fetchViaMainWorld() {
  return new Promise((resolve) => {
    const msgId = 'ytd-' + Math.random().toString(36).slice(2);

    const handler = (event) => {
      if (event.source !== window || event.data?.type !== 'YTD_TRANSCRIPT_RESULT' || event.data?.msgId !== msgId) return;
      window.removeEventListener('message', handler);
      resolve(event.data.segments || null);
    };
    window.addEventListener('message', handler);

    // content-main.js listens for this message and handles the transcript fetch
    window.postMessage({ type: 'YTD_FETCH_TRANSCRIPT', msgId }, '*');

    setTimeout(() => { window.removeEventListener('message', handler); resolve(null); }, 15000);
  });
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
