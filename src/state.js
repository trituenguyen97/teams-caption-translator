/**
 * state.js — Shared mutable state (singleton)
 * Tất cả module đọc/ghi state qua đây thay vì global vars.
 */
module.exports = {
  win: null,
  targetLang: 'Vietnamese',
  targetLangLabel: 'tiếng Việt',
  langCode: 'vi',                 // mã ngôn ngữ đích (để renderer dịch tên theo UI lang trong status)
  pinned: false,
  meetingPage: null,
  browser: null,
  captureSource: 'teams',
  captureSourceChanged: false,
  // userActive = user ĐÃ bấm ▶ để bắt đầu dịch/ghi. Mặc định false → mở app KHÔNG tự chạy (no auto-play).
  // Gate output dịch: chỉ phát status{running} + cc-state{active:true} khi userActive (nút play tự thành ⏹).
  userActive: false,
  audioPaused: false,
  audioEntryId: 0,
  sttProcess: null,

  provider: 'online',   // 'online' = cascade Google→MS | 'local' = MiLMMT offline
  apiKey: '',

  theme:  'auto',       // 'auto' (theo OS) | 'dark' | 'light'
  uiLang: 'vi',         // ngôn ngữ GIAO DIỆN (tách riêng khỏi ngôn ngữ dịch)
  overlayEnabled: true, // overlay dịch nổi trên Teams (UIA mode)
  _tempPin: false,      // pin TẠM app dịch lúc bật caption (Teams focus) — bỏ pin khi caption lên (nếu chưa pin sẵn)

  // Local LLM (llama.cpp server, OpenAI-compatible) — MiLMMT-46-1B JP→VI chuyên dụng (model local duy nhất)
  // localPreset luôn 'milmmt' (giữ field cho selectVariantForPreset). MiLMMT dùng /completion, greedy, không draft.
  // Backend: MiLMMT nhanh nhất trên CPU-t4 → ưu tiên CPU; chỉ offload khi có dGPU NVIDIA (CUDA).
  localPreset: 'milmmt',
  localBaseUrl: 'http://127.0.0.1:8080',
  localModel:      'MiLMMT-46-1B-v0.1.Q4_K_M.gguf',
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
