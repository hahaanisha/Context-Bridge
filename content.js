// ContextBridge — Content Script v2.0
// Supports: Claude, ChatGPT, Gemini, Grok, DeepSeek, Mistral

(function () {
  "use strict";

  if (window.__CB_LOADED__) return;
  window.__CB_LOADED__ = true;

  // ── Token limits & reset windows per platform (context window sizes) ────────
  // These are the *context window* sizes (input + output combined).
  // We estimate usage from conversation token count and show remaining.
  const TOKEN_LIMITS = {
    // Context window sizes (free tier, conservative estimates)
    Claude: { limit: 90000, note: "Claude free: ~90k token context window" },
    ChatGPT: { limit: 8192, note: "GPT-3.5 free: 8k ctx | GPT-4 limited" },
    Gemini: { limit: 32000, note: "Gemini free: ~32k token context window" },
    Grok: { limit: 131072, note: "Grok: ~128k token context window" },
    DeepSeek: { limit: 64000, note: "DeepSeek: ~64k token context window" },
    Mistral: { limit: 32000, note: "Mistral free: ~32k token context window" },
  };

  // ── Platform registry ────────────────────────────────────────────────────────
  const PLATFORMS = {
    "claude.ai": { name: "Claude", color: "#D97757", extractFn: extractClaude },
    "chatgpt.com": {
      name: "ChatGPT",
      color: "#10A37F",
      extractFn: extractChatGPT,
    },
    "chat.openai.com": {
      name: "ChatGPT",
      color: "#10A37F",
      extractFn: extractChatGPT,
    },
    "gemini.google.com": {
      name: "Gemini",
      color: "#4285F4",
      extractFn: extractGemini,
    },
    "grok.com": { name: "Grok", color: "#1DA1F2", extractFn: extractGrok },
    "x.com": { name: "Grok", color: "#1DA1F2", extractFn: extractGrok },
    "chat.deepseek.com": {
      name: "DeepSeek",
      color: "#4B6BFB",
      extractFn: extractDeepSeek,
    },
    "chat.mistral.ai": {
      name: "Mistral",
      color: "#FF7000",
      extractFn: extractMistral,
    },
  };

  const hostname = window.location.hostname;
  const platformKey = Object.keys(PLATFORMS).find((k) => hostname.includes(k));
  if (!platformKey) return;
  const config = PLATFORMS[platformKey];

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function cleanText(el, stripSels) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    (stripSels || []).forEach((s) =>
      clone.querySelectorAll(s).forEach((c) => c.remove()),
    );
    return (clone.innerText || clone.textContent || "").trim();
  }

  function dedup(arr) {
    const seen = new Set();
    return arr.filter((m) => {
      const k = m.role + ":" + m.content.slice(0, 100);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function domOrder(a, b) {
    const pos = a.el.compareDocumentPosition(b.el);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  // ── Token limit helper ───────────────────────────────────────────────────────
  function getTokenInfo(usedTokens) {
    const info = TOKEN_LIMITS[config.name];
    if (!info) return null;
    const remaining = Math.max(0, info.limit - usedTokens);
    const pct = Math.round((usedTokens / info.limit) * 100);
    return {
      limit: info.limit,
      used: usedTokens,
      remaining,
      pct,
      note: info.note,
      warning: pct >= 80,
      critical: pct >= 95,
    };
  }

  // ── Claude ───────────────────────────────────────────────────────────────────
  function extractClaude() {
    const STRIP = ["button", "svg", "[data-testid='action-bar']"];

    // S1: testid turn wrappers
    {
      const turns = document.querySelectorAll(
        '[data-testid^="conversation-turn-"]',
      );
      if (turns.length) {
        const msgs = [];
        turns.forEach((turn) => {
          const h = turn.querySelector('[data-testid="human-turn"]');
          const a = turn.querySelector('[data-testid="ai-turn"]');
          if (h) {
            const t = cleanText(h, STRIP);
            if (t) msgs.push({ role: "user", content: t });
          } else if (a) {
            const prose =
              a.querySelector('.font-claude-message, [class*="prose"]') || a;
            const t = cleanText(prose, STRIP);
            if (t) msgs.push({ role: "assistant", content: t });
          }
        });
        if (msgs.length) return msgs;
      }
    }

    // S2: direct testid / class selectors
    {
      const combined = [];
      [
        { sel: '[data-testid="human-turn"], .human-turn', role: "user" },
        {
          sel: '[data-testid="ai-turn"], .ai-turn, .font-claude-message',
          role: "assistant",
        },
      ].forEach(({ sel, role }) => {
        document.querySelectorAll(sel).forEach((el) => {
          const t = cleanText(el, STRIP);
          if (t) combined.push({ role, content: t, el });
        });
      });
      combined.sort(domOrder);
      if (combined.length)
        return dedup(combined.map(({ role, content }) => ({ role, content })));
    }

    // S3: scrollable container children
    {
      const candidates = Array.from(
        document.querySelectorAll("main [class], div[class]"),
      ).filter(
        (el) =>
          el.children.length >= 2 &&
          el.children.length <= 200 &&
          el.scrollHeight > 400,
      );
      let best = null,
        bestScore = 0;
      candidates.forEach((c) => {
        const score = Array.from(c.children).reduce(
          (s, k) => s + (k.textContent?.length || 0),
          0,
        );
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      });
      if (best) {
        const combined = [];
        Array.from(best.children).forEach((child) => {
          const text = cleanText(child, STRIP);
          if (!text || text.length < 10) return;
          const hasEditable = !!child.querySelector("[contenteditable]");
          const isUserTestId =
            !!child.querySelector('[data-testid="human-turn"]') ||
            child.getAttribute("data-testid")?.includes("human");
          const isAITestId =
            !!child.querySelector('[data-testid="ai-turn"]') ||
            !!child.querySelector(".font-claude-message");
          let role = null;
          if (hasEditable || isUserTestId) role = "user";
          else if (isAITestId) role = "assistant";
          if (role) combined.push({ role, content: text, el: child });
        });
        if (combined.length)
          return dedup(
            combined.map(({ role, content }) => ({ role, content })),
          );
      }
    }

    // S4: p/li ancestry walk
    {
      const combined = [];
      document.querySelectorAll("p, li").forEach((el) => {
        const text = (el.innerText || el.textContent || "").trim();
        if (text.length < 20) return;
        let container = el.parentElement;
        for (let i = 0; i < 8 && container; i++) {
          const tid = container.getAttribute("data-testid") || "";
          if (
            tid.includes("human-turn") ||
            tid.includes("ai-turn") ||
            tid.includes("conversation-turn")
          )
            break;
          container = container.parentElement;
        }
        if (!container) return;
        const tid = container.getAttribute("data-testid") || "";
        const role = tid.includes("human")
          ? "user"
          : tid.includes("ai")
            ? "assistant"
            : null;
        if (role) combined.push({ role, content: text, el });
      });
      combined.sort(domOrder);
      if (combined.length)
        return dedup(combined.map(({ role, content }) => ({ role, content })));
    }

    // S5: nuclear alternating fallback
    {
      const blocks = [];
      document
        .querySelectorAll("p, [class*='message'], [class*='text']")
        .forEach((el) => {
          const text = (el.innerText || "").trim();
          if (text.length > 30 && !el.querySelector("p"))
            blocks.push({ text, el });
        });
      blocks.sort((a, b) => domOrder({ el: a.el }, { el: b.el }));
      const seen = new Set();
      const unique = blocks.filter(({ text }) => {
        if (seen.has(text.slice(0, 60))) return false;
        seen.add(text.slice(0, 60));
        return true;
      });
      if (unique.length)
        return unique.map(({ text }, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: text,
        }));
    }

    return [];
  }

  // ── ChatGPT ──────────────────────────────────────────────────────────────────
  function extractChatGPT() {
    const STRIP = ["button", "svg", ".flex.items-center.gap-1"];
    const msgs = [];
    document.querySelectorAll("[data-message-author-role]").forEach((turn) => {
      const role = turn.getAttribute("data-message-author-role");
      if (!role) return;
      const isUser = role === "user";
      const inner = isUser
        ? turn.querySelector(".whitespace-pre-wrap") || turn
        : turn.querySelector(".markdown, .prose, [class*='markdown']") || turn;
      const text = cleanText(inner, STRIP);
      if (text)
        msgs.push({ role: isUser ? "user" : "assistant", content: text });
    });
    return dedup(msgs);
  }

  // ── Gemini ───────────────────────────────────────────────────────────────────
  function extractGemini() {
    const STRIP = ["button", "svg", ".rating-container"];
    const msgs = [];
    document.querySelectorAll("user-query, model-response").forEach((el) => {
      const isUser = el.tagName.toLowerCase() === "user-query";
      const inner =
        el.querySelector(
          isUser
            ? ".query-text, .query-text-container"
            : ".response-content, .model-response-text",
        ) || el;
      const text = cleanText(inner, STRIP);
      if (text)
        msgs.push({ role: isUser ? "user" : "assistant", content: text });
    });
    return dedup(msgs);
  }

  // ── Grok (grok.com + x.com/i/grok) ─────────────────────────────────────────
  function extractGrok() {
    const STRIP = ["button", "svg", "[aria-label]"];
    const msgs = [];

    // Grok renders messages in divs with data-testid="message" or role="article"
    // User messages have a distinct background / alignment class
    const candidates = [
      ...document.querySelectorAll(
        '[data-testid="message"], [data-message-id], .message-bubble, article',
      ),
    ];

    if (candidates.length) {
      candidates.forEach((el) => {
        const text = cleanText(el, STRIP);
        if (!text || text.length < 5) return;
        // Grok user messages typically sit in a right-aligned container
        const isUser =
          el.getAttribute("data-sender") === "user" ||
          el.getAttribute("data-role") === "user" ||
          el.classList.contains("human") ||
          el.closest('[data-sender="user"]') !== null ||
          // heuristic: user bubbles are in a flex-end container
          getComputedStyle(el.parentElement || el).justifyContent ===
            "flex-end" ||
          (el.parentElement &&
            getComputedStyle(el.parentElement).alignItems === "flex-end");
        msgs.push({ role: isUser ? "user" : "assistant", content: text, el });
      });
      const sorted = [...msgs].sort((a, b) => domOrder(a, b));
      if (sorted.length)
        return dedup(sorted.map(({ role, content }) => ({ role, content })));
    }

    // Fallback: alternating p blocks
    const blocks = [];
    document.querySelectorAll("p").forEach((el) => {
      const text = (el.innerText || "").trim();
      if (text.length > 20 && !el.querySelector("p")) blocks.push({ text, el });
    });
    blocks.sort((a, b) => domOrder({ el: a.el }, { el: b.el }));
    const seen = new Set();
    return blocks
      .filter(({ text }) => {
        if (seen.has(text.slice(0, 60))) return false;
        seen.add(text.slice(0, 60));
        return true;
      })
      .map(({ text }, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: text,
      }));
  }

  // ── DeepSeek ─────────────────────────────────────────────────────────────────
  function extractDeepSeek() {
    const STRIP = ["button", "svg", ".copy-btn", "[class*='action']"];
    const msgs = [];

    // DeepSeek uses .user-message and .assistant-message class conventions
    // Also supports data-role attribute on message containers
    const turns = document.querySelectorAll(
      "[data-role], .user-message, .assistant-message, [class*='user-message'], [class*='assistant-message']",
    );

    if (turns.length) {
      turns.forEach((el) => {
        const role =
          el.getAttribute("data-role") ||
          (el.className.includes("user")
            ? "user"
            : el.className.includes("assistant")
              ? "assistant"
              : null);
        if (!role) return;
        const text = cleanText(el, STRIP);
        if (text)
          msgs.push({
            role: role === "user" ? "user" : "assistant",
            content: text,
            el,
          });
      });
      const sorted = [...msgs].sort((a, b) => domOrder(a, b));
      if (sorted.length)
        return dedup(sorted.map(({ role, content }) => ({ role, content })));
    }

    // Fallback: DeepSeek chat container walk
    const chatArea = document.querySelector(
      "main, .chat-container, [class*='chat']",
    );
    if (chatArea) {
      const children = Array.from(
        chatArea.querySelectorAll("div, article"),
      ).filter(
        (el) =>
          el.children.length < 10 && (el.innerText || "").trim().length > 15,
      );
      const seen = new Set();
      return children
        .filter(({ innerText: t }) => {
          const key = (t || "").trim().slice(0, 60);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((el, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: cleanText(el, STRIP),
        }));
    }

    return [];
  }

  // ── Mistral ──────────────────────────────────────────────────────────────────
  function extractMistral() {
    const STRIP = ["button", "svg", "[class*='action']", "[class*='copy']"];
    const msgs = [];

    // Mistral uses role-based classes: .user, .assistant or data-role
    const turns = document.querySelectorAll(
      "[data-role='user'], [data-role='assistant'], .human, .assistant, [class*='human-message'], [class*='assistant-message']",
    );

    if (turns.length) {
      turns.forEach((el) => {
        const role =
          el.getAttribute("data-role") ||
          (el.classList.contains("human") || el.className.includes("human")
            ? "user"
            : el.classList.contains("assistant") ||
                el.className.includes("assistant")
              ? "assistant"
              : null);
        if (!role) return;
        const text = cleanText(el, STRIP);
        if (text) msgs.push({ role, content: text, el });
      });
      const sorted = [...msgs].sort((a, b) => domOrder(a, b));
      if (sorted.length)
        return dedup(sorted.map(({ role, content }) => ({ role, content })));
    }

    // Fallback: walk main chat area
    const chatArea = document.querySelector(
      "main, [class*='conversation'], [class*='messages']",
    );
    if (chatArea) {
      const blocks = [];
      chatArea.querySelectorAll("p, div").forEach((el) => {
        const text = (el.innerText || "").trim();
        if (
          text.length > 20 &&
          !el.querySelector("p") &&
          !el.querySelector("div")
        )
          blocks.push({ text, el });
      });
      blocks.sort((a, b) => domOrder({ el: a.el }, { el: b.el }));
      const seen = new Set();
      return blocks
        .filter(({ text }) => {
          if (seen.has(text.slice(0, 60))) return false;
          seen.add(text.slice(0, 60));
          return true;
        })
        .map(({ text }, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: text,
        }));
    }

    return [];
  }

  // ── Entry ────────────────────────────────────────────────────────────────────
  function extractMessages() {
    return config.extractFn();
  }

  function getTitle() {
    const active = document.querySelector(
      '[aria-current="page"], .active-conversation',
    );
    if (active?.textContent?.trim()) return active.textContent.trim();
    return (
      document.title
        .replace(/[-|]?\s*(Claude|ChatGPT|Gemini|Grok|DeepSeek|Mistral).*/i, "")
        .trim() || "AI Conversation"
    );
  }

  function buildData(messages) {
    const tokens = messages.reduce(
      (a, m) => a + Math.ceil(m.content.length / 4),
      0,
    );
    const tkInfo = getTokenInfo(tokens);
    return {
      meta: {
        title: getTitle(),
        platform: config.name,
        exportedAt: new Date().toISOString(),
        messageCount: messages.length,
        estimatedTokens: tokens,
        tokenInfo: tkInfo,
        url: window.location.href,
        exportedBy: "ContextBridge v2.0",
      },
      messages,
    };
  }

  // ── PDF export (via background) ───────────────────────────────────────────────
  // We build an HTML string and send it to the background to open as a print dialog.
  // The background opens a new tab with the HTML, the user prints to PDF.
  function toPDFHtml(d) {
    const rows = d.messages
      .map((m) => {
        const isUser = m.role === "user";
        const label = isUser ? "You" : d.meta.platform;
        const color = isUser ? "#1a1a2e" : "#0f3460";
        const badge = isUser ? "#4f46e5" : "#059669";
        // Escape HTML
        const safe = m.content
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>");
        return `
        <div class="message ${isUser ? "user" : "assistant"}">
          <div class="badge" style="background:${badge}">${label}</div>
          <div class="bubble" style="background:${color}">${safe}</div>
        </div>`;
      })
      .join("");

    const ti = d.meta.tokenInfo;
    const tokenBar = ti
      ? `
      <div class="token-bar-wrap">
        <div class="token-bar-label">
          Context used: ${ti.used.toLocaleString()} / ${ti.limit.toLocaleString()} tokens (${ti.pct}%)
          ${ti.warning ? `<span class="warn">${ti.critical ? "🔴 Critical" : "🟡 High usage"}</span>` : ""}
        </div>
        <div class="token-bar-track"><div class="token-bar-fill ${ti.critical ? "critical" : ti.warning ? "warning" : ""}" style="width:${ti.pct}%"></div></div>
        <div class="token-note">${ti.note}</div>
      </div>`
      : "";

    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${d.meta.title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #0a0a0f; color: #e8e8f0; padding: 32px; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; color: #fff; }
  .meta { font-size: 11px; color: #666; margin-bottom: 8px; }
  .export-info { font-size: 11px; color: #888; background: #111; border: 1px solid #222; border-radius: 8px; padding: 10px 14px; margin-bottom: 20px; }
  .token-bar-wrap { background: #111; border: 1px solid #222; border-radius: 8px; padding: 12px 14px; margin-bottom: 20px; }
  .token-bar-label { font-size: 12px; font-weight: 600; color: #ccc; margin-bottom: 6px; }
  .warn { color: #facc15; margin-left: 8px; }
  .token-bar-track { height: 6px; background: #222; border-radius: 100px; overflow: hidden; margin-bottom: 6px; }
  .token-bar-fill { height: 100%; border-radius: 100px; background: #4f46e5; transition: width 0.3s; }
  .token-bar-fill.warning { background: #f59e0b; }
  .token-bar-fill.critical { background: #ef4444; }
  .token-note { font-size: 10px; color: #555; }
  .resume-box { background: #111827; border: 1px solid #1e3a5f; border-radius: 10px; padding: 12px 16px; margin-bottom: 24px; font-size: 12px; color: #93c5fd; }
  .resume-box strong { display: block; margin-bottom: 4px; color: #60a5fa; }
  .message { margin-bottom: 16px; }
  .badge { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; padding: 3px 10px; border-radius: 100px; color: #fff; margin-bottom: 6px; }
  .bubble { padding: 12px 16px; border-radius: 12px; font-size: 13px; line-height: 1.65; color: #ddd; word-break: break-word; }
  .divider { height: 1px; background: #1a1a2e; margin: 16px 0; }
  @media print { body { background: white; color: black; } .bubble { background: #f9f9f9 !important; color: #111 !important; } }
</style></head><body>
<h1>${d.meta.title}</h1>
<div class="meta">Platform: ${d.meta.platform} · Exported: ${new Date(d.meta.exportedAt).toLocaleString()} · ${d.meta.messageCount} messages</div>
<div class="export-info">🔗 ${d.meta.url}<br>Generated by ContextBridge v2.0</div>
${tokenBar}
<div class="resume-box">
  <strong>🔄 Context Resume Prompt</strong>
  I'm continuing a previous conversation. Here's the full transcript. Please acknowledge and be ready to continue where we left off.
</div>
${rows}
</body></html>`;
  }

  // ── Markdown ──────────────────────────────────────────────────────────────────
  function toMarkdown(d) {
    const ti = d.meta.tokenInfo;
    const tokenSection = ti
      ? [
          "## 📊 Token Usage",
          `- **Used:** ${ti.used.toLocaleString()} / ${ti.limit.toLocaleString()} tokens (${ti.pct}%)`,
          `- **Remaining:** ~${ti.remaining.toLocaleString()} tokens`,
          ti.warning
            ? `- **⚠️ Warning:** ${ti.critical ? "Context nearly full!" : "Usage is high — export soon"}`
            : "",
          `- **Note:** ${ti.note}`,
          "",
        ].filter(Boolean)
      : [];

    return [
      `# ${d.meta.title}`,
      `**Platform:** ${d.meta.platform}`,
      `**Exported:** ${new Date(d.meta.exportedAt).toLocaleString()}`,
      `**Messages:** ${d.meta.messageCount} | **Est. Tokens:** ~${d.meta.estimatedTokens.toLocaleString()}`,
      `**URL:** ${d.meta.url}`,
      "",
      "---",
      "",
      ...tokenSection,
      "## 🔄 Context Resume Prompt",
      "",
      `> *"I'm continuing a previous conversation. Here's the full transcript. Please acknowledge and be ready to continue where we left off."*`,
      "",
      "---",
      "",
      "## Conversation",
      "",
      ...d.messages.flatMap((m) => [
        `### ${m.role === "user" ? "👤 **You**" : `🤖 **${d.meta.platform}**`}`,
        m.content,
        "",
      ]),
    ].join("\n");
  }

  function toJSON(d) {
    return JSON.stringify(d, null, 2);
  }

  function toText(d) {
    const ti = d.meta.tokenInfo;
    const tokenLines = ti
      ? [
          `TOKEN USAGE: ${ti.used.toLocaleString()} / ${ti.limit.toLocaleString()} (${ti.pct}%) | Remaining: ~${ti.remaining.toLocaleString()}`,
          ti.warning
            ? ti.critical
              ? "⚠️  CRITICAL: Context almost full! Export now."
              : "⚠️  HIGH USAGE: Export soon."
            : "",
          `${ti.note}`,
          "",
        ].filter(Boolean)
      : [];

    return [
      `CONTEXT EXPORT — ${d.meta.title}`,
      `Platform: ${d.meta.platform} | ${new Date(d.meta.exportedAt).toLocaleString()}`,
      `Messages: ${d.meta.messageCount} | Tokens: ~${d.meta.estimatedTokens.toLocaleString()}`,
      "=".repeat(60),
      "",
      ...tokenLines,
      `RESUME: "I am continuing a previous AI conversation. Please review and continue where we left off."`,
      "",
      "=".repeat(60),
      "",
      ...d.messages.flatMap((m) => [
        m.role === "user" ? "[YOU]" : `[${d.meta.platform.toUpperCase()}]`,
        m.content,
        "",
        "-".repeat(40),
        "",
      ]),
    ].join("\n");
  }

  // ── Download ─────────────────────────────────────────────────────────────────
  function download(content, filename, mime) {
    try {
      const b64 = btoa(unescape(encodeURIComponent(content)));
      chrome.runtime.sendMessage({
        action: "download",
        dataUrl: `data:${mime};base64,${b64}`,
        filename,
      });
    } catch {
      const url = URL.createObjectURL(new Blob([content], { type: mime }));
      const a = Object.assign(document.createElement("a"), {
        href: url,
        download: filename,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  function triggerExport(format) {
    const msgs = extractMessages();
    if (!msgs.length) {
      showToast(
        "⚠️ No messages found. Run CB_DEBUG() in DevTools console.",
        "error",
      );
      return;
    }
    const d = buildData(msgs);
    const safe = d.meta.title
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase()
      .slice(0, 40);
    const date = new Date().toISOString().split("T")[0];
    const base = `contextbridge_${safe}_${date}`;

    if (format === "pdf") {
      // Download as .html — user opens it in browser and Ctrl+P → Save as PDF
      download(toPDFHtml(d), `${base}.html`, "text/html");
      showToast(
        "📄 HTML downloaded — open it & press Ctrl+P to save as PDF",
        "success",
      );
    } else {
      const MAP = {
        markdown: ["md", "text/markdown", toMarkdown],
        json: ["json", "application/json", toJSON],
        text: ["txt", "text/plain", toText],
      };
      const [ext, mime, fn] = MAP[format];
      download(fn(d), `${base}.${ext}`, mime);
      showToast(`✅ Exported ${msgs.length} messages as .${ext}`, "success");
    }

    chrome.storage.local.get(["exportCount"], (r) =>
      chrome.storage.local.set({ exportCount: (r.exportCount || 0) + 1 }),
    );
  }

  // ── Message listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.action === "ping") {
      reply({ alive: true, platform: config.name });
      return true;
    }
    if (msg.action === "getStats") {
      const msgs = extractMessages();
      const d = buildData(msgs);
      reply({
        messageCount: msgs.length,
        estimatedTokens: d.meta.estimatedTokens,
        tokenInfo: d.meta.tokenInfo,
        title: d.meta.title,
        platform: config.name,
      });
      return true;
    }
    if (msg.action === "export") {
      triggerExport(msg.format);
      reply({ success: true });
      return true;
    }
    return true;
  });

  // ── CB_DEBUG ──────────────────────────────────────────────────────────────────
  window.CB_DEBUG = function () {
    console.group("🔍 ContextBridge v2.0 — " + config.name);
    console.log("hostname:", hostname);
    const result = extractMessages();
    console.log(`extractMessages() → ${result.length} messages`);
    result.forEach((m, i) =>
      console.log(`  [${i}] ${m.role}: "${m.content.slice(0, 80)}"`),
    );
    if (result.length) {
      const ti = getTokenInfo(
        result.reduce((a, m) => a + Math.ceil(m.content.length / 4), 0),
      );
      if (ti) console.log("Token info:", ti);
    }
    console.groupEnd();
    return result;
  };

  // ── Toast ─────────────────────────────────────────────────────────────────────
  function showToast(msg, type = "success") {
    document.querySelector(".cb-toast")?.remove();
    const el = Object.assign(document.createElement("div"), {
      className: "cb-toast",
      textContent: msg,
    });
    el.setAttribute("data-type", type);
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("cb-toast--visible"));
    setTimeout(() => {
      el.classList.remove("cb-toast--visible");
      setTimeout(() => el.remove(), 400);
    }, 4000);
  }

  // ── Floating button ───────────────────────────────────────────────────────────
  function createFloatingButton() {
    if (document.querySelector(".cb-float-wrapper")) return;
    const w = document.createElement("div");
    w.className = "cb-float-wrapper";
    w.innerHTML = `
      <button class="cb-float-btn" title="ContextBridge — Export Chat" aria-label="Export conversation">
        <svg class="cb-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span class="cb-label">Export</span>
      </button>
      <div class="cb-menu" role="menu">
        <div class="cb-menu-header"><span class="cb-menu-logo">⬡</span><span>ContextBridge</span></div>
        <div class="cb-menu-subtitle">Save context · Resume anywhere</div>
        <div class="cb-menu-divider"></div>
        <button class="cb-menu-item" data-format="markdown"><span class="cb-menu-icon">📝</span><div><div class="cb-menu-item-title">Markdown</div><div class="cb-menu-item-desc">Best for pasting into new chats</div></div></button>
        <button class="cb-menu-item" data-format="text"><span class="cb-menu-icon">📄</span><div><div class="cb-menu-item-title">Plain Text</div><div class="cb-menu-item-desc">Universal, works everywhere</div></div></button>
        <button class="cb-menu-item" data-format="json"><span class="cb-menu-icon">⚙️</span><div><div class="cb-menu-item-title">JSON</div><div class="cb-menu-item-desc">Structured, for integrations</div></div></button>
        <button class="cb-menu-item" data-format="pdf"><span class="cb-menu-icon">🖨️</span><div><div class="cb-menu-item-title">PDF</div><div class="cb-menu-item-desc">Print-ready with token info</div></div></button>
        <div class="cb-menu-divider"></div>
        <div class="cb-menu-tip">💡 Open a new chat, paste the file, and say: <em>"Continue from this context"</em></div>
      </div>`;
    document.body.appendChild(w);
    const btn = w.querySelector(".cb-float-btn");
    const menu = w.querySelector(".cb-menu");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.toggle("cb-menu--open");
      btn.classList.toggle("cb-float-btn--active");
    });
    document.addEventListener("click", () => {
      menu.classList.remove("cb-menu--open");
      btn.classList.remove("cb-float-btn--active");
    });
    menu.addEventListener("click", (e) => e.stopPropagation());
    w.querySelectorAll(".cb-menu-item").forEach((item) =>
      item.addEventListener("click", () => {
        menu.classList.remove("cb-menu--open");
        btn.classList.remove("cb-float-btn--active");
        triggerExport(item.dataset.format);
      }),
    );
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  function init() {
    createFloatingButton();
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => {
          document.querySelector(".cb-float-wrapper")?.remove();
          window.__CB_LOADED__ = false;
          window.__CB_LOADED__ = true;
          createFloatingButton();
        }, 1500);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
})();
