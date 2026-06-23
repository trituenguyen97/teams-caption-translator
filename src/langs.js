/**
 * langs.js — Tên/nhãn ngôn ngữ đích + mã BCP-47 cho Gemini live-translate.
 * (Tách ra từ translation.js đã gỡ; chỉ còn dữ liệu ngôn ngữ thuần.)
 */
const LANG_NAMES  = { vi: 'Vietnamese', en: 'English', ja: 'Japanese', ko: 'Korean', 'zh-CN': 'Chinese', zh: 'Chinese' };
const LANG_LABELS = { vi: 'tiếng Việt', en: 'English', ja: '日本語', ko: '한국어', 'zh-CN': '中文', zh: '中文' };
// translationConfig.targetLanguageCode (BCP-47). Trung dùng zh-Hans theo bảng live-translate.
const LANG_BCP47  = { vi: 'vi', en: 'en', ja: 'ja', ko: 'ko', 'zh-CN': 'zh-Hans', zh: 'zh-Hans' };
function bcp47(code) { return LANG_BCP47[code] || code || 'en'; }

module.exports = { LANG_NAMES, LANG_LABELS, LANG_BCP47, bcp47 };
