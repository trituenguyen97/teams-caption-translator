/**
 * tts.js — Text-to-Speech cục bộ (đọc to bản dịch) bằng sherpa-onnx-node OfflineTts.
 *
 * Model: Supertonic-3 (Supertone, sherpa-onnx-supertonic-3-tts-int8-2026-05-11), MIT (dùng thương mại được).
 *   - ĐA NGỮ 31 ngôn ngữ (phủ vi/en/ja/ko/zh) → đọc đúng từ tiếng Anh chèn trong câu Việt; 44.1kHz; 10 giọng (sid 0-9).
 *   - Chọn ngôn ngữ qua generationConfig.extra.lang; numSteps 5 = chất lượng (2 = nhanh nhưng "robotic"). RTF ~0.12 (5-step).
 *   - "giảm repeat/skip vs v2" — nhưng vẫn là model có duration predictor + vocoder, KHÔNG hoàn toàn miễn nhiễm ảo giác như VITS.
 *
 * ⚠️ Dùng CHUNG runtime với STT: sherpa-onnx-node + onnxruntime-node (đã load trước ở main.js dòng đầu).
 * Tải off-thread (createAsync) + sinh off-thread (generateAsync) để KHÔNG block main process / STT / LLM.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// Gốc tài nguyên: production = <resources>, dev = gốc project, fallback = cwd (test ngoài electron). Giống stt.js.
function baseDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getAppPath === 'function') {
      return app.isPackaged ? process.resourcesPath : app.getAppPath();
    }
  } catch {}
  return process.cwd();
}
function ttsRoot() { return path.join(baseDir(), 'bin', 'tts'); }

const DIR = 'supertonic-3';
function modelPaths() {
  const d = path.join(ttsRoot(), DIR);
  const f = (n) => path.join(d, n);
  return {
    dir: d,
    durationPredictor: f('duration_predictor.int8.onnx'),
    textEncoder:       f('text_encoder.int8.onnx'),
    vectorEstimator:   f('vector_estimator.int8.onnx'),
    vocoder:           f('vocoder.int8.onnx'),
    ttsJson:           f('tts.json'),
    unicodeIndexer:    f('unicode_indexer.bin'),
    voiceStyle:        f('voice.bin'),
  };
}

// Có đủ file để chạy không (4 onnx + 3 asset của Supertonic-3).
function isAvailable() {
  const p = modelPaths();
  try { return [p.textEncoder, p.vectorEstimator, p.vocoder, p.ttsJson, p.voiceStyle].every(x => fs.existsSync(x)); }
  catch { return false; }
}

// Mã ngôn ngữ app (vi/en/ja/ko/zh-CN) → mã Supertonic (vi/en/ja/ko/zh). Khác → trả nguyên (Supertonic phủ 31 ngữ).
function _supLang(code) {
  if (!code) return 'vi';
  if (code === 'zh-CN' || code === 'zh-TW') return 'zh';
  return code;
}

const NUM_SPEAKERS = 10;   // Supertonic-3: sid 0..9
function clampSid(sid) { const n = parseInt(sid, 10); return (Number.isFinite(n) && n >= 0 && n < NUM_SPEAKERS) ? n : 0; }

let _sherpa = null;
function sherpa() { return (_sherpa = _sherpa || require('sherpa-onnx-node')); }
// 2 luồng đủ cho Supertonic (RTF ~0.12 « thời lượng phát); tránh burst chồng STT(2)+llama lúc đang nói.
function _numThreads() { return 2; }

// ── Tinh chỉnh đọc (Supertonic-3) ──
//   NUM_STEPS 5 = chất lượng (mặc định); 2 = nhanh gấp đôi nhưng giọng "robotic" (theo bench). SPEED <1 = chậm hơn.
const NUM_STEPS = 5;
const SPEED = 1.1;   // >1 = đọc nhanh hơn (user thấy 1.0 hơi chậm)

let _tts = null, _loading = null, _inflight = 0, _unloadPending = false;

// Nhả model khỏi RAM khi tắt loa (đối xứng warm). sherpa OfflineTts KHÔNG có .free() → set null, finalizer native
// thu hồi khi GC. GUARD: đang generateAsync thì HOÃN drop tới khi xong (drop native handle giữa job = crash).
function _dropTts() { if (_tts) { _tts = null; try { if (global.gc) global.gc(); } catch {} console.log('[tts] unload Supertonic-3 → nhả RAM'); } }
function unload() {
  if (_inflight > 0) { _unloadPending = true; return false; }
  _unloadPending = false; _dropTts(); return true;
}

// Nạp OfflineTts (1 lần, cache). createAsync để không block. Trả engine hoặc null nếu thiếu model / lỗi.
function ensureTts() {
  if (_tts) return Promise.resolve(_tts);
  if (_loading) return _loading;
  if (!isAvailable()) return Promise.resolve(null);
  const p = modelPaths();
  _loading = (async () => {
    try {
      const tts = await sherpa().OfflineTts.createAsync({
        model: {
          supertonic: {
            durationPredictor: p.durationPredictor,
            textEncoder:       p.textEncoder,
            vectorEstimator:   p.vectorEstimator,
            vocoder:           p.vocoder,
            ttsJson:           p.ttsJson,
            unicodeIndexer:    p.unicodeIndexer,
            voiceStyle:        p.voiceStyle,
          },
          numThreads: _numThreads(),
          provider: 'cpu',
          debug: 0,
        },
        maxNumSentences: 1,
      });
      _tts = tts;
      console.log('[tts] Supertonic-3 sẵn sàng | sr =', tts.sampleRate, '| speakers =', tts.numSpeakers, '| threads =', _numThreads());
      return tts;
    } catch (e) {
      console.warn('[tts] load lỗi:', e.message);
      _tts = null;
      return null;
    } finally { _loading = null; }
  })();
  return _loading;
}

/**
 * Sinh audio cho 1 câu/đoạn. opts: { sid (giọng 0-9), lang (mã app — tự map sang Supertonic), speed, numSteps }.
 * Trả { samples: Float32Array, sampleRate } hoặc null. Float32Array.from() tách buffer riêng → an toàn IPC clone.
 */
async function synthesize(text, opts = {}) {
  const s = (text == null ? '' : String(text)).trim();
  if (!s) return null;
  const tts = await ensureTts();
  if (!tts) return null;
  _inflight++;   // đang synth → unload() HOÃN drop model tới khi xong (chống crash native)
  try {
    const gc = new (sherpa().GenerationConfig)({
      sid: clampSid(opts.sid),
      speed: opts.speed != null ? opts.speed : SPEED,
      numSteps: opts.numSteps != null ? opts.numSteps : NUM_STEPS,
      extra: { lang: _supLang(opts.lang) },
    });
    const audio = await tts.generateAsync({
      text: s,
      generationConfig: gc,
      // BẮT BUỘC false trong Electron: external ArrayBuffer không serialize được qua V8 → generate ném lỗi / async treo.
      enableExternalBuffer: false,
    });
    if (!audio || !audio.samples || !audio.samples.length) return null;
    return { samples: Float32Array.from(audio.samples), sampleRate: audio.sampleRate };
  } catch (e) {
    console.warn('[tts] generate lỗi:', e.message);
    return null;
  } finally {
    _inflight--;
    if (_inflight === 0 && _unloadPending) { _unloadPending = false; _dropTts(); }
  }
}

module.exports = { isAvailable, ensureTts, warm: ensureTts, unload, synthesize, modelPaths, NUM_SPEAKERS };
