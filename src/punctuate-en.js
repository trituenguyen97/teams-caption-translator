/**
 * punctuate-en.js — Phục hồi dấu câu + VIẾT HOA (truecasing) tiếng Anh cho output STT, qua sherpa-onnx OnlinePunctuation
 * (model CNN-BiLSTM `sherpa-onnx-online-punct-en-2024-08-06`, int8 ~7.5MB — CÙNG runtime sherpa, KHÔNG thêm dep).
 *
 * Model nhận text CHỮ THƯỜNG không dấu → trả text có . , ? + viết hoa (đầu câu, tên riêng, acronym U.S.). STT
 * zipformer EN ra TOÀN CHỮ HOA nên HẠ về thường trước khi đưa vào (model truecase từ chữ thường). Thiếu model /
 * lỗi → trả nguyên văn (degrade an toàn). Đồng bộ (addPunct trả string ngay, ~ms) → gọi thẳng ở _finalizeOnline.
 */
const fs = require('fs');
const path = require('path');

function baseDir() {
  try { const { app } = require('electron'); if (app && typeof app.getAppPath === 'function') return app.isPackaged ? process.resourcesPath : app.getAppPath(); } catch {}
  return process.cwd();
}
function modelDir() { return path.join(baseDir(), 'bin', 'punct', 'en'); }
function _paths() { const d = modelDir(); return { model: path.join(d, 'model.int8.onnx'), vocab: path.join(d, 'bpe.vocab') }; }
function isAvailable() { try { const p = _paths(); return fs.existsSync(p.model) && fs.existsSync(p.vocab); } catch { return false; } }

let _punct = null, _disabled = false;
function _ensure() {
  if (_punct) return _punct;
  if (_disabled) return null;
  if (!isAvailable()) { _disabled = true; return null; }
  try {
    const sherpa = require('sherpa-onnx-node');
    const p = _paths();
    _punct = new sherpa.OnlinePunctuation({ model: { cnnBilstm: p.model, bpeVocab: p.vocab, numThreads: 1, provider: 'cpu', debug: 0 } });
    console.log('[punctuate-en] model sẵn sàng (sherpa OnlinePunctuation int8)');
    return _punct;
  } catch (e) { console.warn('[punctuate-en] load lỗi → tắt punctuation:', e.message); _disabled = true; _punct = null; return null; }
}
function warmPunctuateEn() { return _ensure(); }

// Thêm . , ? + viết hoa. Input TOÀN HOA (zipformer EN) → hạ về thường để model truecase đúng. Lỗi → nguyên văn.
function punctuateEn(text) {
  const s = (text || '').trim();
  if (!s) return s;
  const p = _ensure();
  if (!p) return s;
  try { const out = p.addPunct(s.toLowerCase()); return (out && out.trim()) || s; }
  catch (e) { console.warn('[punctuate-en] infer lỗi:', e.message); return s; }
}

module.exports = { punctuateEn, warmPunctuateEn, isAvailable };
