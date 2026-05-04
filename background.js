// ContextBridge — Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    exportCount: 0,
    installedAt: new Date().toISOString(),
    version: "1.0.0",
  });
  console.log("ContextBridge installed.");
});

/**
 * Handle download requests from content scripts.
 *
 * Content scripts in MV3 cannot reliably trigger downloads via blob URLs
 * on restricted origins (like claude.ai). We receive a data URL from the
 * content script and use chrome.downloads.download() here in the background,
 * which has the downloads permission and no origin restrictions.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "download") {
    const { dataUrl, filename } = msg;

    if (!dataUrl || !filename) {
      sendResponse({ success: false, error: "Missing dataUrl or filename" });
      return true;
    }

    chrome.downloads.download(
      {
        url: dataUrl,
        filename: filename,
        saveAs: false,
        conflictAction: "uniquify",
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error(
            "ContextBridge download error:",
            chrome.runtime.lastError,
          );
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
        } else {
          sendResponse({ success: true, downloadId });
        }
      },
    );

    return true; // keep message channel open for async sendResponse
  }
});
