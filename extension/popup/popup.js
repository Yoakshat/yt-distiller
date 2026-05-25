const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const toggleBtn = document.getElementById("toggleBtn");
const clearBtn = document.getElementById("clearBtn");
const statusDot = document.getElementById("statusDot");
const statusLabel = document.getElementById("statusLabel");
const deepseekLink = document.getElementById("deepseekLink");

function setChipSaved() {
  statusDot.className = "status-dot green";
  statusLabel.textContent = "Key saved";
  clearBtn.style.display = "inline";
}

function setChipEmpty() {
  statusDot.className = "status-dot red";
  statusLabel.textContent = "No key";
  clearBtn.style.display = "none";
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type || "";
  setTimeout(() => {
    statusEl.textContent = "";
    statusEl.className = "";
  }, 2000);
}

chrome.storage.sync.get("deepseekApiKey", (result) => {
  if (result.deepseekApiKey) {
    apiKeyInput.value = result.deepseekApiKey;
    setChipSaved();
  } else {
    setChipEmpty();
  }
});

toggleBtn.addEventListener("click", () => {
  if (apiKeyInput.type === "password") {
    apiKeyInput.type = "text";
    toggleBtn.textContent = "Hide";
  } else {
    apiKeyInput.type = "password";
    toggleBtn.textContent = "Show";
  }
});

deepseekLink.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://platform.deepseek.com" });
});

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
    setChipSaved();
    showStatus("Saved!", "success");
  });
});

clearBtn.addEventListener("click", () => {
  chrome.storage.sync.remove("deepseekApiKey", () => {
    if (chrome.runtime.lastError) {
      showStatus("Error clearing key", "error");
      return;
    }
    apiKeyInput.value = "";
    apiKeyInput.type = "password";
    toggleBtn.textContent = "Show";
    setChipEmpty();
    showStatus("Key cleared", "");
  });
});
