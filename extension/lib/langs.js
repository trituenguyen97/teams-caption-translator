// Bảng ngôn ngữ đích (port từ src/langs.js). Trung gửi Gemini bằng BCP-47 zh-Hans.
export const LANG_NAMES = { vi: 'Vietnamese', en: 'English', ja: 'Japanese', ko: 'Korean', 'zh-CN': 'Chinese', zh: 'Chinese' };
export const LANG_LABELS = { vi: 'tiếng Việt', en: 'English', ja: '日本語', ko: '한국어', 'zh-CN': '中文', zh: '中文' };
export const LANG_BCP47 = { vi: 'vi', en: 'en', ja: 'ja', ko: 'ko', 'zh-CN': 'zh-Hans', zh: 'zh-Hans' };
export const bcp47 = (code) => LANG_BCP47[code] || code || 'en';

// Thứ tự hiển thị trong picker + cờ (emoji) — 5 ngôn ngữ.
export const LANG_ORDER = [
  { code: 'vi', flag: '🇻🇳', name: 'Tiếng Việt' },
  { code: 'en', flag: '🇺🇸', name: 'English' },
  { code: 'ja', flag: '🇯🇵', name: '日本語' },
  { code: 'ko', flag: '🇰🇷', name: '한국어' },
  { code: 'zh-CN', flag: '🇨🇳', name: '中文' },
];
