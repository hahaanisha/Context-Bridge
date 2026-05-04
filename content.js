// ContextBridge — Content Script v1.3 (FINAL)
// Injected into Claude, ChatGPT, Gemini pages

(function () {
  "use strict";

  if (window.__CB_LOADED__) return;
  window.__CB_LOADED__ = true;

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

  // ── Claude ────────────────────────────────────────────────────────────────────
  // Claude's class names are Tailwind hashed and change with deployments.
  // We use a 5-strategy waterfall from most-specific to most-generic.
  function extractClaude() {
    const STRIP = ["button", "svg", "[data-testid='action-bar']"];

    // ── S1: testid turn wrappers (structured prod builds) ──────────────────────
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

    // ── S2: direct testid / known class selectors ──────────────────────────────
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

    // ── S3: scan the main scrollable chat container for alternating children ───
    // Claude renders all turns as sibling divs inside one scrollable container.
    // We look for that container and walk its direct children.
    {
      // Find the element that contains all chat turns — it tends to be the
      // deepest ancestor that has many direct-child divs each with substantial text.
      const candidates = Array.from(
        document.querySelectorAll("main [class], div[class]"),
      ).filter((el) => {
        const kids = el.children.length;
        return kids >= 2 && kids <= 200 && el.scrollHeight > 400;
      });

      // Pick the candidate whose children have the most total text
      let bestContainer = null;
      let bestScore = 0;
      candidates.forEach((c) => {
        const score = Array.from(c.children).reduce(
          (s, kid) => s + (kid.textContent?.length || 0),
          0,
        );
        if (score > bestScore) {
          bestScore = score;
          bestContainer = c;
        }
      });

      if (bestContainer) {
        const combined = [];
        Array.from(bestContainer.children).forEach((child) => {
          const text = cleanText(child, STRIP);
          if (!text || text.length < 10) return;

          // Detect role: Claude wraps user messages in a element that has
          // a contenteditable or a specific nesting pattern.
          // Heuristic: if the child contains an editable area or its text is
          // shorter and "question-like", treat as user; otherwise assistant.
          const hasEditable = child.querySelector("[contenteditable]") !== null;
          const isUserByTestId =
            child.querySelector('[data-testid="human-turn"]') !== null ||
            (child.hasAttribute &&
              child.getAttribute("data-testid")?.includes("human"));
          const isAIByTestId =
            child.querySelector('[data-testid="ai-turn"]') !== null ||
            child.querySelector(".font-claude-message") !== null;

          let role = null;
          if (hasEditable || isUserByTestId) role = "user";
          else if (isAIByTestId) role = "assistant";

          if (role) combined.push({ role, content: text, el: child });
        });

        if (combined.length)
          return dedup(
            combined.map(({ role, content }) => ({ role, content })),
          );
      }
    }

    // ── S4: look for any [contenteditable=false] blocks (rendered messages) ────
    // Claude renders its own responses as rich HTML; user messages may have
    // a [data-is-editable] or similar. We use text density as a heuristic.
    {
      const combined = [];

      // Paragraphs inside .font-claude-message or similar prose containers
      document.querySelectorAll("p, li").forEach((el) => {
        const text = (el.innerText || el.textContent || "").trim();
        if (text.length < 20) return;

        // Walk up to find the message container
        let container = el.parentElement;
        for (let i = 0; i < 8 && container; i++) {
          const testid = container.getAttribute("data-testid") || "";
          if (
            testid.includes("human-turn") ||
            testid.includes("ai-turn") ||
            testid.includes("conversation-turn")
          )
            break;
          container = container.parentElement;
        }
        // Only include if we found a recognisable ancestor
        if (!container) return;
        const testid = container.getAttribute("data-testid") || "";
        const role = testid.includes("human")
          ? "user"
          : testid.includes("ai")
            ? "assistant"
            : null;
        if (role) combined.push({ role, content: text, el });
      });

      combined.sort(domOrder);
      if (combined.length)
        return dedup(combined.map(({ role, content }) => ({ role, content })));
    }

    // ── S5: nuclear fallback — grab ALL visible text blocks, infer alternating ─
    // If nothing else works, grab every paragraph of >30 chars and assign
    // alternating roles (Claude always starts with the user).
    {
      const blocks = [];
      document
        .querySelectorAll("p, [class*='message'], [class*='text']")
        .forEach((el) => {
          const text = (el.innerText || "").trim();
          if (text.length > 30 && !el.querySelector("p")) {
            // leaf nodes only
            blocks.push({ text, el });
          }
        });

      // Sort by DOM position and deduplicate overlapping blocks
      blocks.sort((a, b) => domOrder({ el: a.el }, { el: b.el }));
      const seen = new Set();
      const unique = blocks.filter(({ text }) => {
        if (seen.has(text.slice(0, 60))) return false;
        seen.add(text.slice(0, 60));
        return true;
      });

      if (unique.length) {
        return unique.map(({ text }, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: text,
        }));
      }
    }

    return [];
  }

  // ── ChatGPT ───────────────────────────────────────────────────────────────────
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

  // ── Gemini ────────────────────────────────────────────────────────────────────
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

  // ── Entry point ───────────────────────────────────────────────────────────────
  function extractMessages() {
    return config.extractFn();
  }

  function getTitle() {
    const active = document.querySelector(
      '[aria-current="page"], .active-conversation',
    );
    if (active?.textContent?.trim()) return active.textContent.trim();
    return (
      document.title.replace(/[-|]?\s*(Claude|ChatGPT|Gemini).*/i, "").trim() ||
      "AI Conversation"
    );
  }

  function buildData(messages) {
    const tokens = messages.reduce(
      (a, m) => a + Math.ceil(m.content.length / 4),
      0,
    );
    return {
      meta: {
        title: getTitle(),
        platform: config.name,
        exportedAt: new Date().toISOString(),
        messageCount: messages.length,
        estimatedTokens: tokens,
        url: window.location.href,
        exportedBy: "ContextBridge v1.3",
      },
      messages,
    };
  }

  // ── Exporters ─────────────────────────────────────────────────────────────────
  function toMarkdown(d) {
    const h = [
      `# ${d.meta.title}`,
      `**Platform:** ${d.meta.platform}`,
      `**Exported:** ${new Date(d.meta.exportedAt).toLocaleString()}`,
      `**Messages:** ${d.meta.messageCount} | **Est. Tokens:** ~${d.meta.estimatedTokens.toLocaleString()}`,
      `**URL:** ${d.meta.url}`,
      "",
      "---",
      "",
      "## 🔄 Context Resume Prompt",
      "",
      `> *"I'm continuing a previous conversation. Here's the full transcript. Please acknowledge and be ready to continue where we left off."*`,
      "",
      "---",
      "",
      "## Conversation",
      "",
    ];
    d.messages.forEach((m) =>
      h.push(
        `### ${m.role === "user" ? "👤 **You**" : `🤖 **${d.meta.platform}**`}`,
        m.content,
        "",
      ),
    );
    return h.join("\n");
  }

  function toJSON(d) {
    return JSON.stringify(d, null, 2);
  }

  function toText(d) {
    const h = [
      `CONTEXT EXPORT — ${d.meta.title}`,
      `Platform: ${d.meta.platform} | ${new Date(d.meta.exportedAt).toLocaleString()}`,
      `Messages: ${d.meta.messageCount} | Tokens: ~${d.meta.estimatedTokens.toLocaleString()}`,
      "=".repeat(60),
      "",
      `RESUME: "I am continuing a previous AI conversation. Please review and continue where we left off."`,
      "",
      "=".repeat(60),
      "",
    ];
    d.messages.forEach((m) =>
      h.push(
        m.role === "user" ? "[YOU]" : `[${d.meta.platform.toUpperCase()}]`,
        m.content,
        "",
        "-".repeat(40),
        "",
      ),
    );
    return h.join("\n");
  }

  // ── Download ──────────────────────────────────────────────────────────────────
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
    const MAP = {
      markdown: ["md", "text/markdown", toMarkdown],
      json: ["json", "application/json", toJSON],
      text: ["txt", "text/plain", toText],
    };
    const [ext, mime, fn] = MAP[format];
    download(fn(d), `${base}.${ext}`, mime);
    showToast(`✅ Exported ${msgs.length} messages as .${ext}`, "success");
    chrome.storage.local.get(["exportCount"], (r) =>
      chrome.storage.local.set({ exportCount: (r.exportCount || 0) + 1 }),
    );
  }

  // ── CB_DEBUG ──────────────────────────────────────────────────────────────────
  window.CB_DEBUG = function () {
    console.group("🔍 ContextBridge v1.3 — " + config.name);
    console.log("hostname:", hostname);

    if (platformKey === "claude.ai") {
      const probes = {
        "conversation-turn-N": '[data-testid^="conversation-turn-"]',
        "human-turn": '[data-testid="human-turn"]',
        "ai-turn": '[data-testid="ai-turn"]',
        "font-claude-message": ".font-claude-message",
        "any [data-testid]": "[data-testid]",
        "any contenteditable": "[contenteditable]",
        main: "main",
        article: "article",
      };
      Object.entries(probes).forEach(([label, sel]) => {
        const count = document.querySelectorAll(sel).length;
        console.log(`  ${count > 0 ? "✅" : "❌"} ${label}: ${count}`);
      });
      // Show first [data-testid] values found
      const testids = [
        ...new Set(
          Array.from(document.querySelectorAll("[data-testid]")).map((el) =>
            el.getAttribute("data-testid"),
          ),
        ),
      ].slice(0, 20);
      console.log("\nAll data-testid values found:", testids);
    }

    if (platformKey === "chatgpt.com" || platformKey === "chat.openai.com") {
      console.log(
        "  [data-message-author-role]:",
        document.querySelectorAll("[data-message-author-role]").length,
      );
      console.log(
        "  user turns:",
        document.querySelectorAll('[data-message-author-role="user"]').length,
      );
      console.log(
        "  .whitespace-pre-wrap:",
        document.querySelectorAll(".whitespace-pre-wrap").length,
      );
      console.log(
        "  .markdown:",
        document.querySelectorAll(".markdown").length,
      );
    }

    const result = extractMessages();
    console.log(`\nextractMessages() → ${result.length} messages:`);
    result.forEach((m, i) =>
      console.log(`  [${i}] ${m.role}: "${m.content.slice(0, 80)}"`),
    );
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

  // ── Message listener ──────────────────────────────────────────────────────────
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
