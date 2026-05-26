const dot = document.getElementById('dot');
const label = document.getElementById('status-label');
const hint = document.getElementById('hint');

fetch('http://localhost:8765/health')
  .then(r => r.json())
  .then(() => {
    dot.className = 'dot green';
    label.textContent = 'Server connected';
    hint.innerHTML = 'Go to any YouTube video and click <strong>Distill ✶</strong> in the player controls.';
  })
  .catch(() => {
    dot.className = 'dot red';
    label.textContent = 'Server not running';
    hint.innerHTML =
      'Start the server first:<br><br>' +
      '<code>cd server</code><br>' +
      '<code>python app.py</code>';
  });
