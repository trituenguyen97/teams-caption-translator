/**
 * punctuate-ja.js — Phục hồi dấu câu tiếng Nhật (、。 + ？ heuristic) cho text STT, OFFLINE qua onnxruntime-node.
 *
 * Model: bobfromjapan/bert_japanese_punctuation (char-BERT tohoku char-v3, 2 nhãn 、/。), export int8 ONNX
 * bằng scripts/export-punc-ja.py → bin/punc/ja/model.int8.onnx + vocab.txt. Char-level → tokenize = tra ký tự→id
 * (KHÔNG cần MeCab). CHÈN căn 1:1 GIỮ KÝ TỰ GỐC (không dựng lại từ vocab → không rớt ％．・ ngoài vocab).
 * `？`: heuristic đuôi nghi vấn (か。→か？) vì model chỉ ra 、。. Thiếu model → trả nguyên văn (degrade an toàn).
 */
const fs = require('fs');
const path = require('path');

// Ngưỡng logit = logit(p) = ln(p/(1-p)). period giữ p=0.1; comma hạ p=0.06 → bắt thêm 、 (int8 đặt 、 dè dặt
// hơn fp32 do lượng tử hoá). So sánh logit thô > ngưỡng (khỏi tính sigmoid).
const THRESH_P = Math.log(0.10 / 0.90);   // 。
const THRESH_C = Math.log(0.06 / 0.94);   // 、 (nhạy hơn)
const CHUNK = 256;                    // cắt đoạn dài (model train max ~256 ký tự/lần)

function baseDir() {
  try { const { app } = require('electron'); if (app && typeof app.getAppPath === 'function') return app.isPackaged ? process.resourcesPath : app.getAppPath(); } catch {}
  return process.cwd();
}
function modelDir() { return path.join(baseDir(), 'bin', 'punc', 'ja'); }
// Ưu tiên int4 (MatMulNBits, ~78MB nhanh hơn); fallback int8 nếu chỉ có bản đó.
function modelPath() {
  const d = modelDir();
  for (const f of ['model.int4.onnx', 'model.int8.onnx']) { const p = path.join(d, f); try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}
function isAvailable() { return !!modelPath(); }

let _ort = null, _sess = null, _loading = null, _vocab = null, _UNK = 1, _CLS = 2, _SEP = 3, _disabled = false;

async function _ensure() {
  if (_sess) return _sess;
  if (_disabled) return null;
  if (_loading) return _loading;
  const dir = modelDir();
  const onnx = modelPath();
  const vfile = path.join(dir, 'vocab.txt');
  if (!onnx || !fs.existsSync(vfile)) { _disabled = true; return null; }
  _loading = (async () => {
    try {
      _ort = _ort || require('onnxruntime-node');
      _vocab = new Map();
      const lines = fs.readFileSync(vfile, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].replace(/\r$/, '');
        if (!t) continue;
        _vocab.set(t, i);
        if (t === '[UNK]') _UNK = i; else if (t === '[CLS]') _CLS = i; else if (t === '[SEP]') _SEP = i;
      }
      _sess = await _ort.InferenceSession.create(onnx, { intraOpNumThreads: 2, graphOptimizationLevel: 'all' });
      console.log('[punctuate-ja] model sẵn sàng (int8)');
      return _sess;
    } catch (e) { console.warn('[punctuate-ja] load lỗi → tắt punctuation:', e.message); _disabled = true; _sess = null; return null; }
    finally { _loading = null; }
  })();
  return _loading;
}

// ？ heuristic (model chỉ ra 、。): mỗi câu (tách theo 。) — đuôi か-family (ですか/ますか/でしょうか/のか…), KỂ CẢ khi
// có trợ từ cuối câu sau か (ですかね/のかな/…よ) → ？; HOẶC đuôi でしょう/だろう KÈM từ hỏi trong câu
// (何/なに/なぜ/どう/どこ/いつ/誰/いくら/どの/どれ/どちら/どんな) → ？.
const _QWORD = /(何|なに|なん|なぜ|どう|どこ|いつ|誰|だれ|いくら|どの|どれ|どちら|どんな)/;
function _addQuestion(t) {
  return t.split(/(?<=。)/).map(s => {
    // か cuối câu (± trợ từ cuối ね/な/よ: ですかね/のかな…) ± 。 → đổi dấu kết thành ？ (giữ nguyên か+trợ từ)
    if (/か[ねなよ]?。?$/.test(s)) return s.replace(/。?$/, '？');
    if (/(でしょう|だろう)。$/.test(s) && _QWORD.test(s)) return s.replace(/。$/, '？');
    return s;
  }).join('');
}

// Chèn 、。 vào text tiếng Nhật. Trả Promise<string>. Lỗi/thiếu model → trả nguyên văn.
async function punctuateJa(text) {
  const sRaw = (text || '').trim();
  if (!sRaw) return sRaw;
  const sess = await _ensure();
  if (!sess) return sRaw;
  const chars = Array.from(sRaw.replace(/[、。]/g, ''));   // bỏ dấu câu cũ (nếu có) → model tự đặt lại
  if (!chars.length) return sRaw;
  try {
    let out = '';
    for (let s = 0; s < chars.length; s += CHUNK) {
      const seg = chars.slice(s, s + CHUNK);
      const ids = [_CLS, ...seg.map(c => (_vocab.get(c) ?? _UNK)), _SEP];
      const n = ids.length;
      const idArr = new BigInt64Array(n), amArr = new BigInt64Array(n);
      for (let i = 0; i < n; i++) { idArr[i] = BigInt(ids[i]); amArr[i] = 1n; }
      const feeds = {
        input_ids: new _ort.Tensor('int64', idArr, [1, n]),
        attention_mask: new _ort.Tensor('int64', amArr, [1, n]),
      };
      const res = await sess.run(feeds);
      const logits = (res.logits || res[Object.keys(res)[0]]).data;   // Float32Array [1, n, 2]
      for (let j = 0; j < seg.length; j++) {
        const t = j + 1;                          // token j+1 = ký tự j (token 0 = [CLS])
        out += seg[j];                            // GIỮ ký tự gốc
        const comma = logits[t * 2], period = logits[t * 2 + 1];
        if (period > THRESH_P) out += '。'; else if (comma > THRESH_C) out += '、';
      }
    }
    return _addQuestion(out) || sRaw;
  } catch (e) { console.warn('[punctuate-ja] infer lỗi:', e.message); return sRaw; }
}

module.exports = { punctuateJa, warmPunctuate: _ensure, isAvailable, addQuestion: _addQuestion };
