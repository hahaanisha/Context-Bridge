# ⬡ ContextBridge — AI Continuity Tool

> **Built for the Hackathon** · Internal Tooling · Cost Reduction + Operational Efficiency

---

## The Problem We're Solving

You're deep in a critical conversation with Claude or ChatGPT — debugging a complex system, drafting a proposal, analysing a dataset — and then it happens:

> *"You've reached your message limit. Upgrade to continue."*

Now what? You either wait hours for the limit to reset, switch to a different account, or switch to a different AI model entirely. But every time you start a new session, **the AI has no memory of what you discussed**. You're back to square one — re-explaining the entire context, re-pasting documents, re-setting up the problem.

**This costs us real time and money.** Across a team of 50 engineers and analysts each hitting this wall 2–3 times a week, that's hundreds of hours lost per month to context re-entry alone.

**ContextBridge solves this with one click.**

---

## What It Does

ContextBridge is a lightweight browser extension that adds a persistent **Export** button to any AI chat interface (Claude, ChatGPT, Gemini). When you're approaching a token/message limit — or simply want to hand off context to a colleague — you export the full conversation as a structured file.

That file then becomes your **context passport**: paste it into any new chat session on any account or model, and the AI instantly has full context of everything that was discussed.

```
Your Current Session          →    Export    →    New Session / Account / Model
[All context, decisions,               📄            [Full context restored in
 code, analysis, progress]                           seconds. Work continues.]
```

---

## The Employee Experience

### Before ContextBridge

1. Hit the message limit mid-task
2. Open a new tab, start fresh session
3. Spend 10–20 minutes re-explaining the problem, re-pasting code, re-establishing context
4. AI makes mistakes because it's missing earlier decisions
5. Repeat the next time you switch models or accounts

### After ContextBridge

1. Hit the message limit mid-task  
2. Click **Export** → choose format (takes 2 seconds)
3. Open a new tab, paste the file, say *"Continue from this context"*
4. AI reads the full history and picks up exactly where you left off
5. Total interruption: **under 60 seconds**

---

## Installation (Developer Mode)

Since this is an internal tool, install it directly without the Chrome Web Store:

1. **Download** this folder (or clone the repo)
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer Mode** (toggle, top-right)
4. Click **Load unpacked**
5. Select the `context-bridge` folder
6. Done — the ⬡ icon appears in your toolbar

> **Works on:** Chrome, Brave, Edge (any Chromium-based browser)

---

## How to Use

### Method 1: Floating Button (Recommended)

When you're on Claude, ChatGPT, or Gemini, a small **Export** button appears in the bottom-right corner of the page. Click it to see export options:

| Format | Best For |
|--------|----------|
| **Markdown (.md)** | Pasting directly into new AI chats |
| **Plain Text (.txt)** | Universal — works with any tool |
| **JSON (.json)** | API integrations, automation pipelines |

### Method 2: Extension Popup

Click the ⬡ icon in your browser toolbar to see:
- Current platform detected (Claude / ChatGPT / Gemini)
- Message count and estimated token usage
- One-click export buttons

---

## Resuming Context in a New Chat

After exporting, open a new chat session and paste this resume prompt:

**Quick version:**
```
I'm continuing a previous AI conversation. Here is the full transcript — please review it and be ready to continue where we left off.

[paste file contents here]
```

**For complex work sessions:**
```
I'm resuming a work session that was interrupted due to token limits.
Below is the full conversation history. Please:
1. Acknowledge you've read the context
2. Summarise the last decision/task we were on
3. Continue from that point

[paste file contents here]
```

---

## Supported Platforms

| Platform | Status |
|----------|--------|
| Claude (claude.ai) | ✅ Fully supported |
| ChatGPT (chatgpt.com) | ✅ Fully supported |
| Gemini (gemini.google.com) | ✅ Fully supported |
| OpenAI Legacy (chat.openai.com) | ✅ Fully supported |

---

## Business Case

### Cost Reduction
- **Before:** Employees upgrade personal accounts to avoid limits → shadow IT spend
- **After:** Free-tier accounts used efficiently by bridging sessions → $0 extra spend

### Operational Efficiency
- Estimated **15–25 minutes saved per context-loss event**
- Across a team of 50, hitting this 2–3× per week: **~150 hours/month recovered**
- No more "let me re-explain everything" meetings or messages

### Revenue Enablement
- Client-facing teams (sales, consulting) maintain consistent AI context across long engagements
- No dropped context = fewer mistakes in client deliverables

---

## Privacy & Security

- **All processing is local.** No data is sent to any external server.
- The extension reads only the visible text on the current AI chat page.
- Exported files are saved directly to your local machine.
- No account credentials are accessed or stored.
- The extension has zero telemetry.

---

## Export File Structure (JSON format)

```json
{
  "meta": {
    "title": "API Integration Discussion",
    "platform": "Claude",
    "exportedAt": "2026-05-04T14:32:00Z",
    "messageCount": 24,
    "estimatedTokens": 6200,
    "url": "https://claude.ai/chat/...",
    "exportedBy": "ContextBridge v1.0"
  },
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

---

## Roadmap (Post-Hackathon)

- [ ] **Auto-detect** approaching token limits and prompt export proactively
- [ ] **Team sharing** — export to shared Slack channel or Drive folder
- [ ] **Context compression** — AI-summarised export for very long conversations
- [ ] **Cross-model handoff** — smart prompt reformatting for Claude → ChatGPT switches
- [ ] **Keyboard shortcut** — export without opening any UI

---

## Project Structure

```
context-bridge/
├── manifest.json         # Extension config (Manifest V3)
├── content.js            # Injected into AI chat pages — extracts messages, renders button
├── content.css           # Styles for floating button and toast notifications
├── background.js         # Service worker
├── icons/                # Extension icons (16, 32, 48, 128px)
└── popup/
    ├── popup.html        # Toolbar popup UI
    ├── popup.css         # Popup styles
    └── popup.js          # Popup logic — reads page stats, triggers exports
```

---

## Team

Built at the Internal Tools Hackathon · May 2026

*"Why do we do this manually?"* — This project.

---

*ContextBridge is an internal tool. Not affiliated with Anthropic, OpenAI, or Google.*
