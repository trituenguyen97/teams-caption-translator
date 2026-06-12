/**
 * stt-moonshine.js — Chạy model Moonshine (UsefulSensors, bản "Flavors" đơn ngữ — hiện dùng cho TIẾNG HÀN base-ko)
 * thuần onnxruntime-node: encoder + decoder-merged KV-cache + tokenizer BPE/SentencePiece. KHÔNG thêm dependency.
 *
 * VÌ SAO không qua sherpa-onnx: bản ONNX duy nhất của Moonshine-ko (onnx-community) là format transformers.js
 * 2-file (encoder gộp preprocessor + decoder gộp 2 nhánh use_cache_branch) — sherpa chỉ nạp format v1 4-file
 * (k2-fsa/sherpa-onnx#3231). UsefulSensors không phát hành ONNX (chỉ safetensors). Port này đã đối chiếu khớp
 * chính xác transformers.js trên cùng audio (greedy, từng token).
 *
 * ⚠️ onnxruntime-node phải được load TRƯỚC sherpa-onnx-node trong process (xem main.js đầu file) — ngược lại
 * dlopen chết "cannot run %1" vì 2 bản onnxruntime.dll tranh nhau.
 *
 * Chống lặp token (autoregressive loop "자 자 자…"): no-repeat-ngram (cấm token tạo n-gram đã có) — KHÔNG dùng
 * repetition-penalty vì méo logit làm SAI CHỮ thường (đã đo: 기피→DP). int8 decoder cần graphOptimizationLevel
 * 'disabled' (bug QDQ của ORT 1.26 với MatMulNBits trong embed_tokens); 'basic' chạy được nhưng lệch numerics.
 */
const fs = require('fs');
const path = require('path');

let _ort = null;
function ort() { return (_ort = _ort || require('onnxruntime-node')); }

// Tokenizer BPE (SentencePiece-style) từ tokenizer.json: id→token, ▁→space, ByteFallback <0xXX>, bỏ token đặc biệt.
function _buildTokenizer(tokJsonPath) {
  const t = JSON.parse(fs.readFileSync(tokJsonPath, 'utf8'));
  const id2tok = [];
  for (const [tok, id] of Object.entries(t.model.vocab)) id2tok[id] = tok;
  for (const a of (t.added_tokens || [])) id2tok[a.id] = a.content;
  const SPECIAL = new Set((t.added_tokens || []).filter(a => a.special).map(a => a.id));
  function decode(ids) {
    const out = []; let bytes = [];
    const flush = () => { if (bytes.length) { out.push(Buffer.from(bytes).toString('utf8')); bytes = []; } };
    for (const id of ids) {
      if (SPECIAL.has(id)) continue;
      const tok = id2tok[id]; if (tok == null) continue;
      const m = /^<0x([0-9A-Fa-f]{2})>$/.exec(tok);
      if (m) bytes.push(parseInt(m[1], 16));
      else { flush(); out.push(tok.replace(/▁/g, ' ')); }
    }
    flush();
    return out.join('').replace(/^ /, '');
  }
  return { decode };
}

// Token rác thi thoảng model phun ở biên đoạn (đã quan sát: "audiotext") → lọc khỏi text cuối.
const _ARTIFACTS_RE = /\s*\baudiotext\b\s*/gi;

/**
 * Tạo recognizer Moonshine từ thư mục model (encoder_model_int8.onnx + decoder_model_merged_int8.onnx +
 * tokenizer.json + config.json). Trả { transcribe(Float32Array @16k) -> Promise<string> }. Throw nếu load lỗi.
 */
async function createMoonshine(dir, opts = {}) {
  // graphOptimizationLevel 'disabled' CẢ HAI session — đã thử 'all' cho encoder (bug QDQ chỉ ở decoder):
  // chạy được + giống hệt trên 2 clip thử, NHƯNG đổi rounding làm LẬT token biên ở clip khác (mất khoảng
  // trắng "롯위로 페이로베가"→"롯위페이로베가" → ko-fix mất boundary). Lợi chỉ ~1% tổng thời gian (encoder
  // = 6% tổng; decoder loop 94% mới là chỗ tốn) → KHÔNG đáng đánh đổi tính tất định với fixtures A/B.
  const so = { graphOptimizationLevel: 'disabled', intraOpNumThreads: opts.threads || 2 };
  const enc = await ort().InferenceSession.create(path.join(dir, 'encoder_model_int8.onnx'), so);
  const dec = await ort().InferenceSession.create(path.join(dir, 'decoder_model_merged_int8.onnx'), so);
  const tok = _buildTokenizer(path.join(dir, 'tokenizer.json'));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  const L = cfg.decoder_num_hidden_layers, H = cfg.decoder_num_attention_heads, D = cfg.hidden_size / H;
  const START = cfg.decoder_start_token_id ?? 1, EOS = cfg.eos_token_id ?? 2, V = cfg.vocab_size;
  const NGRAM = opts.noRepeatNgram != null ? opts.noRepeatNgram : 3;
  const MAXLEN = cfg.max_length || 194;
  const O = ort();

  function emptyPast() {   // bước 1 (use_cache_branch=false): mọi past = tensor rỗng [1,H,0,D]
    const feeds = {};
    for (let i = 0; i < L; i++) for (const side of ['decoder', 'encoder']) for (const kv of ['key', 'value'])
      feeds[`past_key_values.${i}.${side}.${kv}`] = new O.Tensor('float32', new Float32Array(0), [1, H, 0, D]);
    return feeds;
  }

  async function transcribe(audio) {
    if (!audio || audio.length < 1600) return '';
    const encOut = await enc.run({ input_values: new O.Tensor('float32', audio, [1, audio.length]) });
    const encHid = encOut.last_hidden_state;
    const maxNew = Math.min(MAXLEN, Math.floor(audio.length / 16000 * 14) + 24);   // ~14 token/s + dư (Hàn: ByteFallback ~3 token/ký tự ngoài vocab — 8/s làm CỤT câu dài)
    const generated = [];
    let past = emptyPast(), useCache = false, encPast = null;
    for (let step = 0; step < maxNew; step++) {
      const inIds = useCache ? [generated[generated.length - 1]] : [START];
      const out = await dec.run({
        input_ids: new O.Tensor('int64', BigInt64Array.from(inIds.map(BigInt)), [1, inIds.length]),
        encoder_hidden_states: encHid,
        use_cache_branch: new O.Tensor('bool', Uint8Array.from([useCache ? 1 : 0]), [1]),
        ...past,
      });
      const logits = out.logits.data;
      const base = (out.logits.dims[1] - 1) * V;   // logits của token cuối
      // no-repeat-ngram: cấm token sẽ lặp lại n-gram đã sinh
      let banned = null;
      if (NGRAM > 0 && generated.length >= NGRAM - 1) {
        banned = new Set();
        const pref = generated.slice(generated.length - (NGRAM - 1));
        for (let i = 0; i + NGRAM <= generated.length; i++) {
          let ok = true; for (let j = 0; j < NGRAM - 1; j++) if (generated[i + j] !== pref[j]) { ok = false; break; }
          if (ok) banned.add(generated[i + NGRAM - 1]);
        }
      }
      let best = 0, bestV = -Infinity, rawMax = -Infinity;
      for (let v = 0; v < V; v++) {
        const x = logits[base + v];
        if (x > rawMax) rawMax = x;                       // max KHÔNG lọc banned — mốc cho EOS-proximity
        if (banned && banned.has(v)) continue;
        if (x > bestV) { bestV = x; best = v; }
      }
      if (best === EOS) break;
      // EOS-proximity stop: model phân vân (logit EOS sát đỉnh) → hết nội dung thật → dừng, chặn hallucination
      // phun chữ rác tới hết quota (đo A/B: clip hallucinate 55%→88% sau fix). Ngưỡng -3.5 ≈ P(EOS)/P(top) > 3%.
      // So với rawMax chứ KHÔNG phải bestV: khi argmax thật bị no-repeat-ngram cấm (đang lặp THẬT: số trùng,
      // "네 네"), bestV là logit hạng-hai bị xẹp → so với bestV làm EOS dễ vượt ngưỡng → cắt cụt giữa câu.
      if (generated.length > 4 && logits[base + EOS] > rawMax - 3.5) break;
      generated.push(best);
      // past bước sau: decoder.* = present mới (mọc dần); encoder.* giữ nguyên từ bước 1 (cross-attention tĩnh)
      if (!useCache) { encPast = {}; for (let i = 0; i < L; i++) for (const kv of ['key', 'value']) encPast[`past_key_values.${i}.encoder.${kv}`] = out[`present.${i}.encoder.${kv}`]; }
      const np = {};
      for (let i = 0; i < L; i++) for (const kv of ['key', 'value']) np[`past_key_values.${i}.decoder.${kv}`] = out[`present.${i}.decoder.${kv}`];
      Object.assign(np, encPast);
      past = np; useCache = true;
    }
    return tok.decode(generated)
      .replace(_ARTIFACTS_RE, ' ')
      .replace(/�+/g, '')        // byte-fallback dở dang khi chạm maxNew → bỏ ký tự thay thế
      .replace(/["“”]+/g, "")   // quote artifacts: nhay thang + smart quotes U+201C/D (\u escape - ky tu cong literal tung bi mangle)
      .replace(/\s+/g, ' ').trim();
  }

  return { transcribe };
}

// Đủ file model trong thư mục chưa? (cho stt.js modelInfo)
function moonshineComplete(dir) {
  try {
    return ['encoder_model_int8.onnx', 'decoder_model_merged_int8.onnx', 'tokenizer.json', 'config.json']
      .every(f => fs.existsSync(path.join(dir, f)));
  } catch { return false; }
}

module.exports = { createMoonshine, moonshineComplete };
