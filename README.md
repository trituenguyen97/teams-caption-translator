# Teams Caption Translator

> **Real-Time Cross-Border Meeting Intelligence & Autonomous Full-Duplex Translation Overlay**  
> *A grant-seeking, open-source enterprise productivity platform powered by Multimodal Live Audio Streaming, Windows UI Automation, and Process-Specific Audio Loopback.*

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20(x64)-0078D6.svg?logo=windows)](src/)
[![Runtime](https://img.shields.io/badge/Runtime-Electron%20%7C%20Node.js%2018%2B-brightgreen.svg?logo=electron)](package.json)
[![AI Engine](https://img.shields.io/badge/AI%20Engine-Real--Time%20Multimodal%20Voice%20Stream-4285F4.svg)](README.md)
[![Latency](https://img.shields.io/badge/Audio%20Latency-~180ms%20Jitter%20Buffer-orange.svg)](src/)
[![Security](https://img.shields.io/badge/Security-BYOK%20%7C%20Zero%20Data%20Retention-success.svg)](README.md)

---

## 🌟 Executive Summary & Pitch

In globalized engineering and business environments, cross-border synchronous communication remains severely constrained:
1. **Meeting Latency & Cognitive Friction:** Human simultaneous interpreters cost \$150–\$300/hour, while existing transcription extensions suffer from 3–5 second turnaround latencies, disjointed sentence boundaries, and loss of technical terminology (IT/BrSE acronyms, katakana loanwords).
2. **Audio Feedback & Echo Loops:** Typical system audio recorders record the user's own synthetic translated audio, triggering catastrophic infinite audio echo loops.
3. **Enterprise Security & Complexity:** Enterprise clients prohibit risky third-party bots (e.g., automated Zoom/Teams recording bots) joining confidential internal meetings.

**Teams Caption Translator** solves these challenges with an ultra-low-latency, zero-bot desktop overlay for Windows. By hooking directly into Microsoft Teams via **Windows UI Automation (UIA)** and isolating target application audio via **process-specific loopback capture**, it streams real-time full-duplex speech-to-speech translation with sub-second turnaround, displays transparent click-through subtitles directly aligned with native captions, synthesizes gapless 24kHz voice output, and autonomously generates rolling Markdown executive meeting summaries.

```
       ┌────────────────────────────────────────────────────────┐
       │                Windows Enterprise Client               │
       │                                                        │
       │  [Mode 1] MS Teams Client ──► Windows UIA (~40ms Poll) │
       │  [Mode 2] Process Loopback ──► Per-PID WASAPI Capture  │
       │  [Mode 3] Local Microphone ──► 16kHz PCM Stream        │
       └───────────▲────────────────────────────▲───────────────┘
                   │                            │
       ┌───────────┴────────────────────────────┴───────────────┐
       │         Real-Time Multimodal Streaming Voice Engine    │
       │  • Speech-to-Speech Streaming (Auto Language ID)       │
       │  • Sub-second Live Text Translation & Audio Streaming  │
       │  • Gapless 24kHz TTS with Adaptive Latency Buffer      │
       │  • Rolling Meeting Intelligence & Action Item Synth    │
       │  • Comprehensive Executive Post-Mortem Reporting       │
       └────────────────────────────────────────────────────────┘
```

---

## 🚀 Core Features & Architectural Innovations

### 1. Three Flexible Ingestion Modes

| Ingestion Mode | Technical Implementation | Practical Benefit |
|:---|:---|:---|
| 💬 **Teams Live Captions** | Native **Windows UI Automation (UIA)** polling (~40ms) reading text from Teams (`ms-teams`). | **Zero bot required.** No CDP/debugging ports, no virtual drivers. Draws transparent click-through subtitles directly over native Teams subtitles. |
| 🔊 **Process Loopback Audio** | Targeted WASAPI loopback filtered strictly by target Process ID (PID). | **Eliminates acoustic feedback loops.** Captures meeting audio (Teams, Chrome, Zoom) while completely ignoring the app's own TTS output. |
| 🎤 **Microphone Stream** | Hardware audio input streamed in 16kHz mono PCM chunks. | Captures local speaker audio for bilateral bilingual conversations. |

### 2. Multimodal Real-Time Streaming Engine (Zero Local Model Burden)

```
Input Audio Stream (16kHz PCM)
        ↓
Multimodal Live Voice Engine (Auto Language ID + Streaming Translation)
        ↓
Adaptive Jitter Buffer (~180ms Target, Dynamic 1.12x Scaling)
        ↓
Gapless 24kHz PCM Audio Playback (30 Curated Voices)
```

- **Automatic Language Identification (Auto-LID):** Seamlessly recognizes input language without manual toggling.
- **Intelligent Sentence Settlement:** Uses punctuation termination (`. ? ! 。！？`) and adaptive silence gating (`SETTLE_MS` ~0.45s / `LONG_IDLE_MS` ~2.5s) to guarantee linguistically coherent translation units.
- **Session Resumption & Anti-Disconnection:** Implements sliding-window context preservation and automated handshake reconnection (1.5s reconnect on timeout events), maintaining indefinite continuous meeting translation sessions.

### 3. Gapless 24kHz TTS with Adaptive Latency Control
- Streams studio-quality 24kHz PCM voice playback via Web Audio API.
- **Dynamic Queue Drain:** If audio backlog exceeds ~0.6s, playback speed smoothly accelerates up to $\le 1.12\times$ without pitch distortion; if latency exceeds ~1.8s, trailing buffers are intelligently trimmed to maintain real-time conversational sync.
- **30 Built-in Voices** (default: *Achernar*), with instant mute and volume controls.

### 4. Autonomous Rolling Real-Time Summarization & Reporting

| Capability | Architecture & Details |
|:---|:---|
| 📋 **Rolling Real-Time Summary** | Dual-column UI (expands +380px). Automatically triggers every **$\ge 24$ newly translated sentences** (~2 minutes of conversation) with a 12-second backstop timer. Synthesizes prior context (up to 6,000 chars) + 25 latest statements into rich **GitHub Flavored Markdown** tables and action items. |
| 📊 **Full Meeting Post-Mortem** | End-of-meeting comprehensive intelligence report powered by high-capacity reasoning model chains (synthesizing up to 8,192 tokens of structured minutes). |
| 💾 **Multi-Format Transcript Export** | Exports `.txt` files in three modes: **Original Speech**, **Dual Bilingual (Source + Target with Speaker Timestamps)**, and **Translated Only**. Exports meeting minutes to `.md` or copies directly to clipboard. |

### 5. Multilingual & Terminology Preservation
- **Target Translation Languages:** 🇻🇳 Vietnamese, 🇺🇸 English, 🇯🇵 Japanese, 🇰🇷 Korean, 🇨🇳 Chinese (Simplified `zh-Hans`).
- **Verbatim Transcribe Mode:** Transcribes exact multi-speaker dialogue without translation or TTS for official corporate compliance logs.
- **IT / BrSE Terminology Guard:** Specialized prompting preserves proper nouns, technical terms, Japanese Katakana loanwords, and numbers/dates.

---

## 🛠️ Project Structure

```
teams-caption-translator/
├── main.js                  # Electron application lifecycle & IPC manager
├── app.html                 # Main dual-column interface, overlay & summary modal
├── preload.js               # Secure contextBridge interface (window.__caption)
├── package.json             # Electron configuration & build targets
├── src/
│   ├── live-stream-client.js# Bidirectional voice streaming client
│   ├── text-stream-client.js# Live streaming text translation
│   ├── meeting-summary.js   # Rolling summary & executive reporting engine
│   ├── teams-uia.js         # Windows UI Automation client for Microsoft Teams
│   ├── audio-capture.js     # Process-specific WASAPI audio loopback & mic handler
│   ├── tts-player.js        # Gapless 24kHz Web Audio player & adaptive jitter buffer
│   └── store.js             # Local encrypted configuration store
└── extension/               # Enterprise browser companion extension
```

---

## ⚡ Quick Start & Installation

### Prerequisites
- **Operating System:** Windows 10 / 11 (x64)
- **Node.js:** v18.0.0 or higher
- **Microsoft Teams:** New Teams client (`ms-teams`)
- **API Key:** AI API Access Key (configured via `AI_API` in settings)

### Installation & Launch

```bash
# 1. Clone repository
git clone https://github.com/trituenguyen97/teams-caption-translator.git
cd teams-caption-translator

# 2. Install dependencies
npm install

# 3. Launch application
npm start
```

### First-Time Configuration
1. Click the **⋮ Menu** in the top navigation bar → **Translation Settings**.
2. Paste your **AI_API key** into the configuration field. The application performs a non-billable validation ping to confirm connectivity.
3. Select your input source:
   - **Teams Live Caption:** Open Microsoft Teams, join a meeting, and click **▶ Start**. Subtitles will automatically overlay Teams.
   - **System Audio:** Select your target meeting browser/application from the process dropdown.
   - **Microphone:** Select your input microphone.

### Building Windows NSIS Installer (.exe)

```bash
npm run build
```
Generates production NSIS setup installer packages in `dist/`.

---

## 🎯 Startup Vision, Grant Objectives & Roadmap

Teams Caption Translator addresses the massive enterprise market for **frictionless cross-border remote collaboration**. We are actively seeking enterprise grants, cloud compute credits, and venture partnerships.

### Planned Grant Allocation

```
                   ┌───────────────────────────────────────┐
                   │        Target Grant Allocation        │
                   ├──────────────────┬────────────────────┤
                   │ Enterprise Multi-│                    │
                   │ Tenant Cloud API │        40%         │
                   ├──────────────────┼────────────────────┤
                   │ Cross-Platform   │                    │
                   │ macOS / WebRTC   │        25%         │
                   ├──────────────────┼────────────────────┤
                   │ Security Audits  │                    │
                   │ & SOC2 / HIPAA   │        20%         │
                   ├──────────────────┼────────────────────┤
                   │ Enterprise CRM / │                    │
                   │ Slack/Notion Hub │        15%         │
                   └──────────────────┴────────────────────┘
```

1. **Enterprise Multi-Tenant Cloud Infrastructure (40%):** Centralized corporate license management, SSO, and shared billing pools while maintaining zero-retention data sovereignty.
2. **Cross-Platform Engineering (25%):** Extending process-specific loopback audio capture to macOS (CoreAudio HAL tap) and Linux.
3. **Enterprise Compliance & Audits (20%):** Formal SOC2 Type II and HIPAA compliance certification for enterprise deployments.
4. **CRM & Knowledge Base Integrations (15%):** Direct one-click synchronization of generated meeting summaries and action items into Jira, Linear, Notion, and Salesforce.

### Target Grant & Accelerator Programs
- **Enterprise Productivity & Future of Work Acceleration Grants**
- **Sovereign Cloud & Zero-Trust Workplace Technology Programs**
- **Cross-Border Collaboration & Translation Accessibility Initiatives**

---

## 🤝 Contact & Partnership

For enterprise pilots, grant sponsorships, or investment inquiries:

- **Lead Developer & Maintainer:** Tri Tue Nguyen ([@trituenguyen97](https://github.com/trituenguyen97))
- **GitHub:** [https://github.com/trituenguyen97/teams-caption-translator](https://github.com/trituenguyen97/teams-caption-translator)
- **Inquiries:** Open an issue or contact via GitHub profile.
