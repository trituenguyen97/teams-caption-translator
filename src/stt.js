/**
 * stt.js — STT cục bộ bằng sherpa-onnx-node (ONNX Whisper), KHÔNG cần Python/PyAV/ffmpeg.
 *
 * VAI TRÒ MỚI (sau khi thêm Windows Live Captions): đây là nhánh FALLBACK — chỉ dùng cho source = TIẾNG VIỆT
 * (LC không hỗ trợ vi) và cho máy KHÔNG có Live Captions. en/ja/ko/zh đi qua Windows Live Captions
 * (xem src/win-livecaptions.js + routing trong ipc-handlers toggle-captions).
 * → Model đích cho VI: PhoWhisper-small (VinAI) export ONNX int8 (xem scripts/export-phowhisper-onnx — bước
 *   convert nặng, cần torch). Tạm thời bin/stt vẫn là Whisper-small đa ngữ (vẫn chạy được VI) cho tới khi
 *   export PhoWhisper xong rồi thay vào (cùng tên file small-encoder/decoder.int8.onnx → drop-in, không đổi code).
 * Nhận PCM float32 mono @16k (từ renderer qua Web Audio) → transcribe. Model bundle ở bin/stt
 * (tải/sinh lúc build). Port bộ lọc RMS/hallucination/tách câu từ bản Python cũ.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// Gốc tài nguyên: production = <resources>, dev = gốc project, fallback = cwd (test ngoài electron).
function baseDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getAppPath === 'function') {
      return app.isPackaged ? process.resourcesPath : app.getAppPath();
    }
  } catch {}
  return process.cwd();
}
function modelDirCandidates() {
  return [
    path.join(baseDir(), 'bin', 'stt'),                                              // bundle / dev
  ];
}
function resolveModel() {
  for (const d of modelDirCandidates()) {
    const encoder = path.join(d, 'small-encoder.int8.onnx');
    const decoder = path.join(d, 'small-decoder.int8.onnx');
    const tokens  = path.join(d, 'small-tokens.txt');
    try { if (fs.existsSync(encoder) && fs.existsSync(decoder) && fs.existsSync(tokens)) return { encoder, decoder, tokens }; } catch {}
  }
  return null;
}
function isModelAvailable() { return !!resolveModel(); }

// Silero VAD (~0.6MB) để cắt câu theo khoảng lặng — bundle cùng bin/stt (xem fetch-stt-model.js).
function resolveSilero() {
  for (const d of modelDirCandidates()) {
    const p = path.join(d, 'silero_vad.onnx');
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}
function isVadAvailable() { return !!resolveSilero(); }

let _sherpa = null, _rec = null, _loading = null, _recLang = '';

// Ngôn ngữ nguồn cho Whisper. '' = auto-detect (mặc định). Map code app → code Whisper.
let _lang = '';
const _WHISPER_LANG = { vi: 'vi', en: 'en', ja: 'ja', ko: 'ko', 'zh-CN': 'zh' };

// ── Cấu hình VAD/cắt câu THEO NGÔN NGỮ NGUỒN (key = whisper code) — MỖI ngôn ngữ 1 bộ, CHỈNH TẠI ĐÂY ──
//   threshold: ngưỡng phát hiện giọng (cao = ít nhạy hơn).
//   minSilenceDuration: nghỉ bao lâu (giây) thì coi là HẾT CÂU (nhỏ = ra text nhanh, dễ cắt cụm; lớn = câu trọn, trễ).
//   minSpeechDuration: đoạn ngắn hơn (giây) thì bỏ (lọc tiếng động).
//   maxSpeechDuration: trần 1 đoạn (giây) — kể cả nói liên tục, cứ tới mốc này là nhả (chặn kẹt + bound độ trễ).
//   ⇒ Đang tinh chỉnh tiếng NHẬT ở khối 'ja' bên dưới.
const STT_CONFIG = {
  ja:      { threshold: 0.6, minSilenceDuration: 0.65, minSpeechDuration: 0.3,  maxSpeechDuration: 10 },
  en:      { threshold: 0.5, minSilenceDuration: 0.4,  minSpeechDuration: 0.25, maxSpeechDuration: 8 },
  vi:      { threshold: 0.5, minSilenceDuration: 0.4,  minSpeechDuration: 0.25, maxSpeechDuration: 8 },
  ko:      { threshold: 0.5, minSilenceDuration: 0.45, minSpeechDuration: 0.25, maxSpeechDuration: 9 },
  zh:      { threshold: 0.5, minSilenceDuration: 0.45, minSpeechDuration: 0.25, maxSpeechDuration: 9 },
  default: { threshold: 0.5, minSilenceDuration: 0.4,  minSpeechDuration: 0.25, maxSpeechDuration: 8 },
};
function _vadCfg() { return STT_CONFIG[_lang] || STT_CONFIG.default; }
function currentLang() { return _lang; }                 // whisper code hiện tại ('' = auto)
function maxSpeechSec() { return _vadCfg().maxSpeechDuration; }   // audio-stt dùng suy ra "đoạn gần trần = bị cắt giữa câu"

// Tạo 1 VAD instance (Silero) theo config NGÔN NGỮ NGUỒN hiện tại. Trả null nếu thiếu model → audio-stt fallback.
function createVad() {
  const model = resolveSilero();
  if (!model) return null;
  const c = _vadCfg();
  try {
    _sherpa = _sherpa || require('sherpa-onnx-node');
    return new _sherpa.Vad({
      sileroVad: { model, threshold: c.threshold, minSilenceDuration: c.minSilenceDuration, minSpeechDuration: c.minSpeechDuration, maxSpeechDuration: c.maxSpeechDuration, windowSize: 512 },
      sampleRate: 16000, numThreads: 1, provider: 'cpu', debug: 0,
    }, 30);
  } catch (e) { console.warn('[stt] tạo VAD lỗi:', e.message); return null; }
}
// Đặt ngôn ngữ nguồn (gọi từ ipc save-settings + boot). Chỉ set _lang; recognize() tự tạo lại recognizer
// khi _recLang !== _lang → an toàn cả khi đang load dở (không mất thay đổi do race).
function setLanguage(code) {
  const w = _WHISPER_LANG[code] || '';   // không khớp / 'auto' / '' → auto-detect
  if (w === _lang) return;
  _lang = w;
  console.log('[stt] ngôn ngữ nguồn →', w || 'auto');
}

async function ensureReady() {
  if (_rec) return true;
  if (_loading) return _loading;
  const paths = resolveModel();
  if (!paths) return false;
  const langForBuild = _lang;   // chốt ngôn ngữ tại thời điểm tạo (recognize phát hiện đổi giữa chừng)
  _loading = (async () => {
    try {
      _sherpa = _sherpa || require('sherpa-onnx-node');
      const numThreads = Math.min(4, os.cpus().length || 2);
      _rec = await _sherpa.OfflineRecognizer.createAsync({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          // language '' = auto; mã ('ja'…) = ép ngôn ngữ nguồn. task 'transcribe' = giữ ngữ. tailPaddings -1 mặc định.
          whisper: { encoder: paths.encoder, decoder: paths.decoder, language: langForBuild, task: 'transcribe', tailPaddings: -1 },
          tokens: paths.tokens, numThreads, provider: 'cpu', debug: 0,
        },
      });
      _recLang = langForBuild;
      console.log('[stt] recognizer sẵn sàng (Whisper-small) | lang:', langForBuild || 'auto');
      return true;
    } catch (e) {
      console.warn('[stt] load lỗi:', e.message);
      _rec = null;
      return false;
    } finally { _loading = null; }
  })();
  return _loading;
}

// ── Bộ lọc (port từ stt-server.py) ──
const _RMS_THRESHOLD = 0.008;   // ~-42 dBFS — bỏ audio im lặng/ồn nền (tránh hallucination)
function hasSpeech(pcm) {
  if (!pcm || !pcm.length) return false;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length) >= _RMS_THRESHOLD;
}

// Cụm Whisper hay "ảo giác" khi audio im lặng (outro video…). CHỈ giữ cụm rõ ràng là rác —
// KHÔNG chặn cụm đời thường như 'ありがとうございました' (chào/cảm ơn thật) để tránh mất caption.
const _HALLUC_PHRASES = [
  'ご視聴ありがとうございました', 'チャンネル登録', '字幕制作',
  'thank you for watching', 'thanks for watching', 'please subscribe',
  '[music]', '[applause]', '[noise]', '♪', '【음악】', '(음악)',
];
function isHallucination(text) {
  const s = (text || '').trim();
  if (!s) return true;
  // Toàn khoảng trắng / dấu câu / ký hiệu (KHÔNG có chữ cái hệ nào) → ảo giác.
  // Dùng Unicode \p{P}\p{S} thay \W: \W của JS coi kana/kanji/hangul là "non-word" → trước đây CHẶN NHẦM
  // toàn bộ tiếng Nhật/Trung/Hàn (nguyên nhân "tiếng được tiếng không").
  if (/^[\s\p{P}\p{S}]*$/u.test(s)) return true;
  // Toàn bộ là 1 chú thích trong ngoặc — ()/[]/（）/【】 — vd "(音楽)", "[Music]", "(笑)", "(拍手)" → rác.
  if (/^[([（【][^()[\]（）【】]{0,24}[)\]）】]$/u.test(s)) return true;
  const lo = s.toLowerCase();
  if (_HALLUC_PHRASES.some(p => lo.includes(p.toLowerCase()))) return true;
  // Lặp bệnh lý của Whisper: 1 cụm 2–15 ký tự lặp ≥4 lần liên tiếp (vd "はいはいはいはい") → bỏ.
  if (/(.{2,15}?)\1{3,}/u.test(s)) return true;
  // Đếm ký tự "thực" = chữ cái MỌI hệ chữ (\p{L}, gồm kana/kanji/hangul) + chữ số (\p{N}).
  const real = (s.match(/[\p{L}\p{N}]/gu) || []).length;
  if (real < 2) return true;
  return false;
}

const _SPLIT_RE = /(?<=[.!?。！？])\s*/;
function splitSentences(text, maxWords = 20) {
  let parts = text.split(_SPLIT_RE).map(s => s.trim()).filter(Boolean);
  if (!parts.length) parts = [text.trim()];
  const out = [];
  for (const part of parts) {
    let words = part.split(/\s+/);
    while (words.length > maxWords) { out.push(words.slice(0, maxWords).join(' ')); words = words.slice(maxWords); }
    if (words.length) out.push(words.join(' '));
  }
  return out;
}

// Nhận Float32Array PCM @16k → TEXT thô đã lọc (1 chuỗi); '' nếu im lặng/rỗng/ảo giác/chưa sẵn sàng.
// (audio-stt sẽ tự gom câu theo dấu kết thúc + carry mảnh dở — xem _assembleAndEmit.)
async function transcribe(samples) {
  if (_rec && _recLang !== _lang) _rec = null;   // đổi ngôn ngữ nguồn → tạo lại recognizer
  if (!_rec) { if (!(await ensureReady())) return ''; }
  if (!samples || samples.length < 1600) return '';   // < 0.1s
  if (!hasSpeech(samples)) return '';
  let text = '';
  try {
    const stream = _rec.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples });
    const r = await _rec.decodeAsync(stream);   // decode off-thread → không nghẽn main
    text = ((r && r.text) || '').trim();
  } catch (e) { console.warn('[stt] decode lỗi:', e.message); return ''; }
  if (!text || isHallucination(text)) return '';
  return text;
}

// Tiện ích cũ: trả mảng câu đã tách (dùng cho nhánh fallback không VAD).
async function recognize(samples) {
  const t = await transcribe(samples);
  return t ? splitSentences(t).filter(Boolean) : [];
}

module.exports = {
  ensureReady, transcribe, recognize, isModelAvailable, isHallucination, setLanguage,
  createVad, isVadAvailable, currentLang, maxSpeechSec,
};
