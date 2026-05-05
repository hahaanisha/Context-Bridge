// ContextBridge — Popup Script v2.0

const SUPPORTED_HOSTS = [
  "claude.ai",
  "chatgpt.com",
  "chat.openai.com",
  "gemini.google.com",
  "grok.com",
  "x.com",
  "chat.deepseek.com",
  "chat.mistral.ai",
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

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { action: "ping" });
    if (pong?.alive) return true;
  } catch (_) {}
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await new Promise((r) => setTimeout(r, 500));
    return true;
  } catch (err) {
    console.warn("ContextBridge: could not inject content script", err);
    return false;
  }
}

// ── Settings persistence ──────────────────────────────────────────────────────
const SETTINGS_KEY = "cbSettings";

const DEFAULT_SETTINGS = {
  showButton: true,
  includeArtifacts: true,
  includeTimestamps: true,
};

function readSettingsFromUI() {
  return {
    showButton: $("settingShowButton").checked,
    includeArtifacts: $("settingArtifacts").checked,
    includeTimestamps: $("settingTimestamps").checked,
  };
}

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (result) => {
      resolve(Object.assign({}, DEFAULT_SETTINGS, result[SETTINGS_KEY] || {}));
    });
  });
}

async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SETTINGS_KEY]: settings }, resolve);
  });
}

// Send updated settings to the content script on the active tab
async function syncSettingsToPage(settings) {
  try {
    const tab = await getCurrentTab();
    if (!tab || !isSupported(tab.url)) return;
    const ready = await ensureContentScript(tab.id);
    if (!ready) return;
    await chrome.tabs.sendMessage(tab.id, { action: "updateSettings", settings });
  } catch (_) {}
}

async function initSettings() {
  // Load from storage and render into UI
  const settings = await loadSettings();
  $("settingShowButton").checked = settings.showButton;
  $("settingArtifacts").checked = settings.includeArtifacts;
  $("settingTimestamps").checked = settings.includeTimestamps;

  // Push current settings to the page immediately
  await syncSettingsToPage(settings);

  // On any change: save + push to page instantly
  const onChange = async () => {
    const updated = readSettingsFromUI();
    await saveSettings(updated);
    await syncSettingsToPage(updated);
  };

  $("settingShowButton").addEventListener("change", onChange);
  $("settingArtifacts").addEventListener("change", onChange);
  $("settingTimestamps").addEventListener("change", onChange);
}

// ── Token meter UI ────────────────────────────────────────────────────────────
function renderTokenMeter(ti) {
  if (!ti) { $("tokenMeter").style.display = "none"; return; }
  $("tokenMeter").style.display = "block";
  $("tokenPct").textContent = `${ti.pct}%`;
  $("tokenFill").style.width = `${Math.min(ti.pct, 100)}%`;
  $("tokenFill").className =
    "token-fill" +
    (ti.critical ? " token-fill--critical" : ti.warning ? " token-fill--warning" : "");
  $("tokenRemaining").textContent =
    ti.remaining >= 1000
      ? `~${(ti.remaining / 1000).toFixed(1)}k tokens remaining`
      : `~${ti.remaining} tokens remaining`;
  if (ti.warning) {
    $("tokenWarn").style.display = "block";
    $("tokenWarn").textContent = ti.critical
      ? "🔴 Context nearly full — export now!"
      : "🟡 High usage — consider exporting soon";
  } else {
    $("tokenWarn").style.display = "none";
  }
}

// ── Main stat loader ──────────────────────────────────────────────────────────
async function loadStats() {
  const tab = await getCurrentTab();

  if (!isSupported(tab?.url)) {
    $("statusDot").className = "status-dot";
    $("statusPlatform").textContent = "Not an AI chat";
    $("statusDetail").textContent =
      "Navigate to Claude, ChatGPT, Gemini, Grok, DeepSeek or Mistral";
    setButtons(false);
    return;
  }

  const ready = await ensureContentScript(tab.id);
  if (!ready) {
    $("statusDot").className = "status-dot error";
    $("statusPlatform").textContent = "Could not connect";
    $("statusDetail").textContent = "Try refreshing the page";
    setButtons(false);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "getStats" });

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

      renderTokenMeter(response.tokenInfo || null);
      setButtons(true);
    } else {
      $("statusDot").className = "status-dot";
      $("statusPlatform").textContent = response?.platform || "Chat detected";
      $("statusDetail").textContent = "No messages found yet — scroll the chat";
      setButtons(true);
    }
  } catch (e) {
    $("statusDot").className = "status-dot error";
    $("statusPlatform").textContent = "Could not read page";
    $("statusDetail").textContent = "Try refreshing the chat tab";
    setButtons(false);
  }
}

// ── Export buttons (popup grid) ───────────────────────────────────────────────
document.querySelectorAll(".export-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const format = btn.dataset.format;
    const tab = await getCurrentTab();
    const settings = await loadSettings();

    try {
      btn.style.opacity = "0.5";
      const ready = await ensureContentScript(tab.id);
      if (!ready) { showToast("Could not connect. Try refreshing."); return; }
      await chrome.tabs.sendMessage(tab.id, { action: "export", format, settings });
      showToast(
        format === "pdf"
          ? "PDF preview opened — use Ctrl+P to save"
          : `Exporting as ${format}…`,
      );
    } catch (e) {
      showToast("Export failed. Try refreshing.");
    } finally {
      setTimeout(() => (btn.style.opacity = ""), 800);
    }
  });
});

// Init — run in parallel so stats and settings load together
loadStats();
initSettings();