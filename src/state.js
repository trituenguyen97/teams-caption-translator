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

  provider: 'groq',
  apiKey: '',
  llmModel: 'llama-3.1-8b-instant',

  // Teams token state
  teamsTokens: new Map(),
  teamsToken: null,
  teamsTokenTs: 0,

  // Edge translator
  edgeAuthToken: null,
  edgeAuthTs: 0,
};
