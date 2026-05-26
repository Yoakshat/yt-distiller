const SERVER = 'http://localhost:8765';

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
  btn.textContent = 'Distilling…';

  let result;
  try {
    const res = await fetch(`${SERVER}/distill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: location.href }),
    });
    result = await res.json();
  } catch {
    showError('Server not running — start it: cd server && python app.py');
    reset();
    return;
  }

  if (!result.ok) {
    showError(result.error || 'Something went wrong. Please try again.');
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
