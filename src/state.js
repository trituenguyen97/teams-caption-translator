/**
 * state.js — Shared mutable state (singleton)
 * Tất cả module đọc/ghi state qua đây thay vì global vars.
 */
module.exports = {
  win: null,
  targetLang: 'Vietnamese',
  targetLangLabel: 'tiếng Việt',
  pinned: false,
  meetingPage: null,
  browser: null,
  captureSource: 'teams',
  captureSourceChanged: false,
  audioPaused: false,
  audioEntryId: 0,
  sttProcess: null,

  provider: 'google-free',
  apiKey: '',

  // Local LLM (llama.cpp server, OpenAI-compatible) — Qwen3 setup cho Japanese IT meetings
  localBaseUrl: 'http://127.0.0.1:8080',
  localModel:      'Qwen_Qwen3-1.7B-Q4_K_M.gguf',
  localDraftModel: 'Qwen_Qwen3-0.6B-Q4_0.gguf',
  localServerProc: null,
  localServerPort: 8080,
  localBinaryVariant: 'cpu',   // cpu | vulkan | cuda | sycl — để biết có offload GPU không

  // Teams token state
  teamsTokens: new Map(),
  teamsToken: null,
  teamsTokenTs: 0,

  // Edge translator
  edgeAuthToken: null,
  edgeAuthTs: 0,
};
