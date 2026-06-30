/**
 * state.js — Shared mutable state (singleton). App dịch qua Gemini 3.5 Live Translate.
 */
module.exports = {
  win: null,

  // Ngôn ngữ ĐÍCH (live-translate tự nhận nguồn → chỉ chọn đích)
  targetLang: 'Vietnamese',
  targetLangLabel: 'tiếng Việt',
  langCode: 'vi',

  pinned: false,

  // Nguồn: 'system' (loopback toàn hệ thống / theo app) | 'mic'
  captureSource: 'system',
  captureSourceChanged: false,
  userActive: false,     // user đã bấm ▶
  audioPaused: false,

  // Gemini
  provider: 'gemini-live',
  apiKey: '',
  geminiAudioOn: true,   // bật/tắt đọc to (TTS dịch)
  geminiVoice: 'Achernar',

  // Yêu cầu tóm tắt RIÊNG do người dùng tự gõ trên app — chèn thêm vào prompt tóm tắt (giữ nguyên prompt gốc).
  summaryExtra: '',

  theme:  'auto',
  uiLang: 'vi',

  _sumPanelOpen: false,  // panel tóm tắt đang mở (để nới/co cửa sổ)
};
