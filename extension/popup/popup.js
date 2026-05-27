const input = document.getElementById('api-key');
const btn = document.getElementById('save-btn');
const status = document.getElementById('status');

chrome.storage.sync.get('deepseekApiKey', ({ deepseekApiKey }) => {
  if (deepseekApiKey) input.value = deepseekApiKey;
});

btn.addEventListener('click', () => {
  const key = input.value.trim();
  if (!key) {
    status.className = 'err';
    status.textContent = 'Please enter an API key.';
    return;
  }
  chrome.storage.sync.set({ deepseekApiKey: key }, () => {
    status.className = 'ok';
    status.textContent = 'Saved!';
    setTimeout(() => { status.textContent = ''; status.className = ''; }, 2000);
  });
});
