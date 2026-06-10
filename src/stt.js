/**
 * stt.js — STT cục bộ bằng sherpa-onnx-node, NHÁNH FALLBACK (khi KHÔNG dùng Windows Live Captions).
 *
 * VAI TRÒ: fallback cho source = system/mic khi (a) ngôn ngữ là TIẾNG VIỆT (LC không có vi),
 * (b) máy KHÔNG có Live Captions, hoặc (c) LC chưa tải model → định tuyến rơi xuống đây.
 *
 * THAY Whisper (offline đa ngữ, cắt câu bằng VAD → có trễ) bằng BẢN ĐỒ MODEL THEO NGÔN NGỮ:
 *   - zh-CN / en → ONLINE streaming Paraformer bilingual zh-en (FunASR) → caption mọc dần real-time như Live Captions.
 *   - ko        → ONLINE streaming Zipformer transducer (Hàn).
 *   - ja        → OFFLINE Zipformer transducer (ReazonSpeech) + VAD (không có model streaming Nhật).
 *   - vi        → OFFLINE Zipformer transducer (Việt) + VAD (không có model streaming Việt).
 * Engine 'online' = OnlineRecognizer (đồng bộ, streaming, partial từng chunk). Engine 'offline' = OfflineRecognizer
 * (như Whisper cũ: transcribe trọn đoạn VAD). Model bundle ở bin/stt/<dir>/ (tải lúc build — xem fetch-stt-model.js).
 *
 * Nhận PCM float32 mono @16k (từ renderer qua Web Audio). Port bộ lọc RMS/hallucination/tách câu từ bản cũ.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Bản đồ model theo ngôn ngữ nguồn (app code) ─────────────────────────────────────────────
// dir = thư mục con trong bin/stt/. File CHUẨN HOÁ tên lúc build (xem fetch-stt-model.js): encoder.onnx /
// decoder.onnx / joiner.onnx (transducer) / tokens.txt — build copy bản int8-ưu-tiên về tên generic này
// → runtime KHỎI biết tên epoch gốc và KHỎI quan tâm int8 hay không.
//   engine: 'online' (OnlineRecognizer, streaming) | 'offline' (OfflineRecognizer, theo đoạn VAD)
//   kind:   'paraformer' (encoder+decoder) | 'transducer' (encoder+decoder+joiner)
const MODELS = {
  'zh-CN': { dir: 'zh-en', engine: 'online',  kind: 'paraformer'  },
  'en':    { dir: 'zh-en', engine: 'online',  kind: 'paraformer'  },   // dùng CHUNG model bilingual zh-en
  'ko':    { dir: 'ko',    engine: 'online',  kind: 'transducer'  },
  'ja':    { dir: 'ja',    engine: 'offline', kind: 'transducer'  },
  'vi':    { dir: 'vi',    engine: 'offline', kind: 'transducer'  },
};
const DEFAULT_LANG = 'ja';

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
function sttRoot() { return path.join(baseDir(), 'bin', 'stt'); }

// Ngôn ngữ nguồn hiện tại (app code). '' → DEFAULT_LANG.
let _appLang = '';
function _lang() { return MODELS[_appLang] ? _appLang : DEFAULT_LANG; }
function currentLang() { return _lang(); }
function setLanguage(code) {
  const next = MODELS[code] ? code : '';
  if (next === _appLang) return;
  _appLang = next;
  console.log('[stt] ngôn ngữ nguồn →', _lang(), '(', (MODELS[_lang()].engine), MODELS[_lang()].kind, ')');
}

// Trả {dir, engine, kind, paths:{encoder,decoder,joiner?,tokens}} cho 1 ngôn ngữ, hoặc null nếu THIẾU file.
function modelInfo(appLang) {
  const m = MODELS[appLang] || MODELS[DEFAULT_LANG];
  const d = path.join(sttRoot(), m.dir);
  const encoder = path.join(d, 'encoder.onnx');
  const decoder = path.join(d, 'decoder.onnx');
  const joiner  = path.join(d, 'joiner.onnx');
  const tokens  = path.join(d, 'tokens.txt');
  try {
    if (!fs.existsSync(encoder) || !fs.existsSync(decoder) || !fs.existsSync(tokens)) return null;
    if (m.kind === 'transducer' && !fs.existsSync(joiner)) return null;
  } catch { return null; }
  return { ...m, paths: { encoder, decoder, joiner, tokens } };
}
function isStreaming(appLang) { const m = MODELS[appLang || _lang()]; return !!m && m.engine === 'online'; }
function isModelAvailable() { return !!modelInfo(_lang()); }

let _sherpa = null;
function sherpa() { return (_sherpa = _sherpa || require('sherpa-onnx-node')); }
function _numThreads() { return Math.min(4, os.cpus().length || 2); }
function _modelConfig(info) {
  const base = { tokens: info.paths.tokens, numThreads: _numThreads(), provider: 'cpu', debug: 0 };
  if (info.kind === 'paraformer') return { ...base, paraformer: { encoder: info.paths.encoder, decoder: info.paths.decoder } };
  return { ...base, transducer: { encoder: info.paths.encoder, decoder: info.paths.decoder, joiner: info.paths.joiner } };
}

// ── OFFLINE (ja/vi): OfflineRecognizer transducer — transcribe trọn 1 đoạn VAD (như Whisper cũ) ──────
let _offRec = null, _offLoading = null, _offDir = '';
async function ensureReady() {
  const info = modelInfo(_lang());
  if (!info || info.engine !== 'offline') return false;   // online không dùng đường này
  if (_offRec && _offDir === info.dir) return true;
  if (_offLoading) return _offLoading;
  _offRec = null;
  _offLoading = (async () => {
    try {
      const rec = await sherpa().OfflineRecognizer.createAsync({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: _modelConfig(info),
      });
      _offRec = rec; _offDir = info.dir;
      console.log('[stt] offline recognizer sẵn sàng:', info.dir);
      return true;
    } catch (e) { console.warn('[stt] load offline lỗi:', e.message); _offRec = null; return false; }
    finally { _offLoading = null; }
  })();
  return _offLoading;
}

// ── ONLINE (zh/en/ko): OnlineRecognizer streaming — đồng bộ, KHÔNG createAsync/decodeAsync ────────────
const _onRecCache = new Map();   // dir → OnlineRecognizer (tái dùng giữa các phiên cùng ngôn ngữ)
function _buildOnline(info) {
  if (_onRecCache.has(info.dir)) return _onRecCache.get(info.dir);
  const rec = new (sherpa().OnlineRecognizer)({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: _modelConfig(info),
    decodingMethod: 'greedy_search',
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,   // im lặng dài → chốt dù câu chưa "đủ" length
    rule2MinTrailingSilence: 0.8,   // ngừng nói ngắn sau khi có chữ → chốt câu (snappy như Live Captions)
    rule3MinUtteranceLength: 20,    // câu quá dài (frames) → chốt chống run-on
  });
  _onRecCache.set(info.dir, rec);
  return rec;
}

/**
 * Tạo 1 phiên streaming cho ngôn ngữ hiện tại. null nếu ngôn ngữ KHÔNG phải engine online (ja/vi/offline)
 * hoặc thiếu model. audio-stt đẩy PCM vào accept(), đọc partial qua result().text, chốt câu khi isEndpoint().
 *   { accept(samples), result()->{text,segment,is_final}, isEndpoint()->bool, reset(), finish() }
 */
// Dựng SẴN recognizer cho ngôn ngữ hiện tại (warm) — gọi khi đổi nguồn/ngôn ngữ để ▶ lần sau không khựng.
// online: build OnlineRecognizer đồng bộ (~1-2s, cache theo dir); offline: createAsync off-thread. Trả Promise<bool>.
function warm() {
  const info = modelInfo(_lang());
  if (!info) return Promise.resolve(false);
  if (info.engine === 'online') {
    try { _buildOnline(info); return Promise.resolve(true); }
    catch (e) { console.warn('[stt] warm online lỗi:', e.message); return Promise.resolve(false); }
  }
  return ensureReady();
}

function createOnlineSession() {
  const info = modelInfo(_lang());
  if (!info || info.engine !== 'online') return null;
  let rec, stream;
  try { rec = _buildOnline(info); stream = rec.createStream(); }
  catch (e) { console.warn('[stt] tạo online session lỗi:', e.message); return null; }
  return {
    lang: _lang(),
    accept(samples) {
      stream.acceptWaveform({ samples, sampleRate: 16000 });
      while (rec.isReady(stream)) rec.decode(stream);
    },
    result() { try { return rec.getResult(stream); } catch { return { text: '' }; } },
    isEndpoint() { try { return rec.isEndpoint(stream); } catch { return false; } },
    reset() { try { rec.reset(stream); } catch {} },
    finish() { try { stream.inputFinished(); while (rec.isReady(stream)) rec.decode(stream); } catch {} },
  };
}

// ── VAD (chỉ dùng cho nhánh OFFLINE ja/vi) — cắt câu theo khoảng lặng (Silero) ─────────────────────
//   threshold/minSilence/minSpeech/maxSpeech: tinh chỉnh theo ngôn ngữ. Thiếu silero_vad.onnx → fallback chunk.
const STT_CONFIG = {
  ja:      { threshold: 0.6, minSilenceDuration: 0.65, minSpeechDuration: 0.3,  maxSpeechDuration: 10 },
  vi:      { threshold: 0.5, minSilenceDuration: 0.4,  minSpeechDuration: 0.25, maxSpeechDuration: 8 },
  default: { threshold: 0.5, minSilenceDuration: 0.4,  minSpeechDuration: 0.25, maxSpeechDuration: 8 },
};
function _vadCfg() { return STT_CONFIG[_lang()] || STT_CONFIG.default; }
function maxSpeechSec() { return _vadCfg().maxSpeechDuration; }
function _silero() { const p = path.join(sttRoot(), 'silero_vad.onnx'); try { return fs.existsSync(p) ? p : null; } catch { return null; } }
function isVadAvailable() { return !!_silero(); }
function createVad() {
  const model = _silero();
  if (!model) return null;
  const c = _vadCfg();
  try {
    return new (sherpa().Vad)({
      sileroVad: { model, threshold: c.threshold, minSilenceDuration: c.minSilenceDuration, minSpeechDuration: c.minSpeechDuration, maxSpeechDuration: c.maxSpeechDuration, windowSize: 512 },
      sampleRate: 16000, numThreads: 1, provider: 'cpu', debug: 0,
    }, 30);
  } catch (e) { console.warn('[stt] tạo VAD lỗi:', e.message); return null; }
}

// ── Bộ lọc (port từ bản cũ) ─────────────────────────────────────────────────────────────────
const _RMS_THRESHOLD = 0.008;   // ~-42 dBFS — bỏ audio im lặng/ồn nền (tránh hallucination)
function hasSpeech(pcm) {
  if (!pcm || !pcm.length) return false;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length) >= _RMS_THRESHOLD;
}
const _HALLUC_PHRASES = [
  'ご視聴ありがとうございました', 'チャンネル登録', '字幕制作',
  'thank you for watching', 'thanks for watching', 'please subscribe',
  '[music]', '[applause]', '[noise]', '♪', '【음악】', '(음악)',
];
function isHallucination(text) {
  const s = (text || '').trim();
  if (!s) return true;
  if (/^[\s\p{P}\p{S}]*$/u.test(s)) return true;
  if (/^[([（【][^()[\]（）【】]{0,24}[)\]）】]$/u.test(s)) return true;
  const lo = s.toLowerCase();
  if (_HALLUC_PHRASES.some(p => lo.includes(p.toLowerCase()))) return true;
  if (/(.{2,15}?)\1{3,}/u.test(s)) return true;
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

// Nhận Float32Array PCM @16k → TEXT thô đã lọc (1 chuỗi) — OFFLINE; '' nếu im lặng/rỗng/ảo giác/chưa sẵn sàng.
async function transcribe(samples) {
  if (!_offRec) { if (!(await ensureReady())) return ''; }
  if (!samples || samples.length < 1600) return '';   // < 0.1s
  if (!hasSpeech(samples)) return '';
  let text = '';
  try {
    const stream = _offRec.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples });
    const r = await _offRec.decodeAsync(stream);   // decode off-thread → không nghẽn main
    text = ((r && r.text) || '').trim();
  } catch (e) { console.warn('[stt] decode lỗi:', e.message); return ''; }
  if (!text || isHallucination(text)) return '';
  return text;
}
async function recognize(samples) {
  const t = await transcribe(samples);
  return t ? splitSentences(t).filter(Boolean) : [];
}

module.exports = {
  // chung
  setLanguage, currentLang, isModelAvailable, isStreaming, isHallucination,
  // online (streaming)
  createOnlineSession, warm,
  // offline (VAD + transcribe)
  ensureReady, transcribe, recognize, createVad, isVadAvailable, maxSpeechSec,
  // hằng (test/độ phủ)
  MODELS,
};
