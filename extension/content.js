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
    throw new Error('No captions available for this video.');
  }

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

function showError(message) {
  let errorDiv = document.getElementById('ytd-error');
  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.id = 'ytd-error';
    errorDiv.style.cssText = [
      'position: absolute',
      'bottom: 48px',
      'right: 8px',
      'background: rgba(0,0,0,0.85)',
      'color: #fff',
      'font-size: 12px',
      'padding: 6px 10px',
      'border-radius: 4px',
      'z-index: 9999',
      'max-width: 260px',
      'pointer-events: none',
    ].join(';');
    const controls = document.querySelector('.ytp-right-controls');
    if (controls) {
      controls.style.position = 'relative';
      controls.appendChild(errorDiv);
    } else {
      document.body.appendChild(errorDiv);
    }
  }
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
  clearTimeout(errorDiv._hideTimer);
  errorDiv._hideTimer = setTimeout(() => {
    errorDiv.style.display = 'none';
  }, 4000);
}

function playSegments(segments) {
  const video = document.querySelector('video.html5-main-video');
  if (!video) throw new Error('YouTube player not found');

  segments.sort((a, b) => a.start - b.start);

  let currentIdx = 0;

  const btn = document.getElementById('ytd-distill-btn');

  function showSegment(idx) {
    if (idx >= segments.length) {
      if (btn) {
        btn.textContent = 'Distill ✶';
        btn.disabled = false;
      }
      video.removeEventListener('timeupdate', onTimeUpdate);
      return;
    }
    const seg = segments[idx];
    if (btn) {
      btn.textContent = `${idx + 1} / ${segments.length} ✶`;
    }
    video.currentTime = seg.start;
    video.play();
  }

  function onTimeUpdate() {
    const seg = segments[currentIdx];
    if (!seg) return;
    if (video.currentTime >= seg.end) {
      currentIdx++;
      showSegment(currentIdx);
    }
  }

  video.addEventListener('timeupdate', onTimeUpdate);
  showSegment(0);
}

async function startDistill() {
  const btn = document.getElementById('ytd-distill-btn');
  if (!btn) return;

  const reset = () => { btn.textContent = 'Distill ✶'; btn.disabled = false; };

  btn.disabled = true;
  btn.textContent = 'Analyzing…';

  let transcript;
  try {
    transcript = await fetchTranscript();
  } catch (err) {
    showError(err.message.includes('No captions') ? 'No captions available for this video.' : err.message);
    reset();
    return;
  }

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'ANALYZE_TRANSCRIPT', transcript },
        (response) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        }
      );
    });
  } catch (err) {
    showError('Extension error: ' + err.message);
    reset();
    return;
  }

  if (!result || !result.ok) {
    const msg = result?.error
      ? (result.error.includes('API key') || result.error.includes('api_key')
          ? 'No API key — open the extension popup to set one.'
          : result.error)
      : 'Something went wrong. Please try again.';
    showError(msg);
    reset();
    return;
  }

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
    if (Date.now() - startTime > 10000) {
      clearInterval(interval);
      return;
    }

    const toolbar = document.querySelector('.ytp-right-controls');
    if (!toolbar) return;

    if (document.getElementById('ytd-distill-btn')) {
      clearInterval(interval);
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'ytd-distill-btn';
    btn.textContent = 'Distill ✶';
    btn.style.cssText = [
      'height: 28px',
      'color: #fff',
      'background: transparent',
      'border: none',
      'cursor: pointer',
      'font-size: 13px',
      'font-weight: 600',
      'padding: 0 8px',
      'letter-spacing: 0.5px',
      'opacity: 1',
      'vertical-align: middle',
    ].join(';');

    btn.addEventListener('mouseenter', () => {
      btn.style.opacity = '0.7';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.opacity = '1';
    });

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
