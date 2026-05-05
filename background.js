// ContextBridge — Background Service Worker v2.0

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    exportCount: 0,
    installedAt: new Date().toISOString(),
    version: "2.0.0",
  });
  console.log("ContextBridge v2.0 installed.");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ── File download (txt / md / json / html) ──────────────────────────────────
  if (msg.action === "download") {
    const { dataUrl, filename } = msg;
    if (!dataUrl || !filename) {
      sendResponse({ success: false, error: "Missing dataUrl or filename" });
      return true;
    }
    chrome.downloads.download(
      { url: dataUrl, filename, saveAs: false, conflictAction: "uniquify" },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
        } else {
          sendResponse({ success: true, downloadId });
        }
      },
    );
    return true;
  }
});
