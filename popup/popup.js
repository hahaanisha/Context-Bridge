// ContextBridge — Popup Script v1.2

const SUPPORTED_HOSTS = [
  "claude.ai",
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
];
const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("visible");
  setTimeout(() => t.classList.remove("visible"), 3000);
}

function setButtons(enabled) {
  document.querySelectorAll(".export-btn").forEach((btn) => {
    btn.disabled = !enabled;
  });
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupported(url) {
  return SUPPORTED_HOSTS.some((h) => url && url.includes(h));
}

/**
 * Ensure the content script is injected and alive.
 * On SPAs (Claude, ChatGPT), navigation can invalidate the previous
 * content script context without re-injecting it.
 */
async function ensureContentScript(tabId) {
  try {
    // Fast path: ping the existing content script
    const pong = await chrome.tabs.sendMessage(tabId, { action: "ping" });
    if (pong?.alive) return true;
  } catch (_) {
    // Content script not present — inject it now
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    // Give it a moment to register its listener
    await new Promise((r) => setTimeout(r, 300));
    return true;
  } catch (err) {
    console.warn("ContextBridge: could not inject content script", err);
    return false;
  }
}

async function loadStats() {
  const tab = await getCurrentTab();

  if (!isSupported(tab?.url)) {
    $("statusDot").className = "status-dot";
    $("statusPlatform").textContent = "Not an AI chat";
    $("statusDetail").textContent = "Navigate to Claude, ChatGPT, or Gemini";
    setButtons(false);
    return;
  }

  // Make sure content script is alive before querying
  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    $("statusDot").className = "status-dot error";
    $("statusPlatform").textContent = "Could not connect";
    $("statusDetail").textContent = "Try refreshing the page";
    setButtons(false);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "getStats",
    });

    if (response && response.messageCount > 0) {
      $("statusDot").className = "status-dot active";
      $("statusPlatform").textContent = response.platform || "AI Chat";
      $("statusDetail").textContent =
        `"${response.title?.slice(0, 35) || "Untitled conversation"}"`;

      $("statsRow").style.display = "flex";
      $("statMessages").textContent = response.messageCount;
      $("statTokens").textContent =
        response.estimatedTokens >= 1000
          ? `~${(response.estimatedTokens / 1000).toFixed(1)}k`
          : `~${response.estimatedTokens}`;

      const { exportCount } = await chrome.storage.local.get(["exportCount"]);
      $("statExports").textContent = exportCount || 0;

      setButtons(true);
    } else {
      $("statusDot").className = "status-dot";
      $("statusPlatform").textContent = response?.platform || "Chat detected";
      $("statusDetail").textContent = "No messages found yet — scroll the chat";
      // Still enable buttons so user can try manually
      setButtons(true);
    }
  } catch (e) {
    $("statusDot").className = "status-dot error";
    $("statusPlatform").textContent = "Could not read page";
    $("statusDetail").textContent = "Try refreshing the chat tab";
    setButtons(false);
  }
}

// Handle export button clicks
document.querySelectorAll(".export-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const format = btn.dataset.format;
    const tab = await getCurrentTab();

    try {
      btn.style.opacity = "0.5";
      const ready = await ensureContentScript(tab.id);
      if (!ready) {
        showToast("Could not connect. Try refreshing.");
        return;
      }
      await chrome.tabs.sendMessage(tab.id, { action: "export", format });
      showToast(`Exporting as ${format}…`);
    } catch (e) {
      showToast("Export failed. Try refreshing.");
    } finally {
      setTimeout(() => (btn.style.opacity = ""), 800);
    }
  });
});

// Init
loadStats();
