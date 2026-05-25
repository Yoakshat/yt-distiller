// YT Distiller — popup script

const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

// Load saved API key on popup open
chrome.storage.sync.get("deepseekApiKey", (result) => {
  if (result.deepseekApiKey) {
    apiKeyInput.value = result.deepseekApiKey;
  }
});

// Save button handler
saveBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    showStatus("Please enter an API key", "error");
    return;
  }

  chrome.storage.sync.set({ deepseekApiKey: key }, () => {
    if (chrome.runtime.lastError) {
      showStatus("Error saving key", "error");
      return;
    }
    showStatus("Saved!", "success");
  });
});

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type || "";
  setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "";
  }, 2000);
}
