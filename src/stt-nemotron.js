/**
 * stt-nemotron.js — STT đa ngữ Nemotron-3.5-ASR-Streaming-0.6B (NVIDIA) qua onnxruntime-node, THUẦN Node.
 * 1 model cho cả ja/en/ko/zh/vi. Cache-aware FastConformer encoder + RNN-T (LSTM decoder + joint).
 *
 * Pipeline (đã đối chiếu khớp onnxruntime-genai trên Python; mel khớp tới meandiff 0.009):
 *   PCM @16k → cắt chunk 8960 mẫu (560ms) → mel 56 frame/chunk (src/mel-nemotron) → ghép [9 carryover + 56]=[1,65,128]
 *   → encoder.onnx (cache trượt) → encoded → RNN-T greedy (decoder LSTM + joint, blank) → token → vocab.txt.
 *
 * ⚠️ onnxruntime-node phải load TRƯỚC sherpa-onnx-node (xem main.js). lang_id BẮT BUỘC đúng (en=0/zh=4/ja=10/ko=14/vi=33).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { melChunk, NMEL } = require('./mel-nemotron');

let _ort = null;
function ort() { return (_ort = _ort || require('onnxruntime-node')); }

const CHUNK = 8960, CARRY = 9, NEW = 56, ENC_FRAMES = CARRY + NEW; // 65
const LANG_ID = { en: 0, zh: 4, ja: 10, ko: 14, vi: 33 };
const _TAG = /<[a-z]{2}-[A-Z]{2}>/g;

function _buildVocab(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const skip = new Set(['<blank>', '<unk>', '<pad>']);
  return {
    size: lines.length,
    decode(ids) {
      const out = [];
      for (const i of ids) { const t = lines[i]; if (t == null || skip.has(t)) continue; out.push(t.startsWith('▁') ? ' ' + t.slice(1) : t); }
      return out.join('').replace(_TAG, '').replace(/\s+/g, ' ').trim();
    },
  };
}

/**
 * createNemotron(dir, opts) — dir chứa encoder.onnx(+.data)/decoder.onnx(+.data)/joint.onnx(+.data)/genai_config.json/vocab.txt.
 * Trả { transcribe(Float32Array@16k, langCode) -> Promise<string> }.
 */
async function createNemotron(dir, opts = {}) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'genai_config.json'), 'utf8')).model;
  const BLANK = cfg.blank_id;
  // max_symbols/frame: hạ 10→4 (NeMo mặc định 10 cho offline; streaming chunk nhỏ không cần, giảm cơ hội "xả" lặp/collapse).
  const MAXSYM = opts.maxSymbols || 4;
  const so = { intraOpNumThreads: opts.threads || 4, interOpNumThreads: 1, executionMode: 'sequential' };
  const O = ort();
  const enc = await O.InferenceSession.create(path.join(dir, 'encoder.onnx'), so);
  const dec = await O.InferenceSession.create(path.join(dir, 'decoder.onnx'), so);
  const joint = await O.InferenceSession.create(path.join(dir, 'joint.onnx'), so);
  const vocab = _buildVocab(path.join(dir, 'vocab.txt'));
  // ── Chống script-collapse (greedy + quantization + low-resource hay phun chữ SAI script lặp, vd zh→"ตาาาา").
  // Mask token ngoài-script TRƯỚC argmax: cấm Thái/Cyrillic mọi lang; cấm Hangul (trừ ko); cấm Kana (trừ ja). Han luôn cho. ──
  const _vl = fs.readFileSync(path.join(dir, 'vocab.txt'), 'utf8').split('\n');
  const reThai = /[฀-๿]/, reCyr = /[Ѐ-ӿ]/, reHangul = /[가-힣ᄀ-ᇿ]/, reKana = /[぀-ヿ]/;
  const fThai = new Set(), fCyr = new Set(), fHangul = new Set(), fKana = new Set();
  for (let i = 0; i < _vl.length; i++) { const t = _vl[i]; if (!t) continue; if (reThai.test(t)) fThai.add(i); if (reCyr.test(t)) fCyr.add(i); if (reHangul.test(t)) fHangul.add(i); if (reKana.test(t)) fKana.add(i); }
  const _forbidCache = {};
  function forbiddenFor(lang) {
    if (_forbidCache[lang]) return _forbidCache[lang];
    const s = new Set([...fThai, ...fCyr]);
    if (lang !== 'ko') for (const x of fHangul) s.add(x);
    if (lang !== 'ja') for (const x of fKana) s.add(x);
    return (_forbidCache[lang] = s);
  }

  const i64 = (v) => new O.Tensor('int64', BigInt64Array.from(v.map(BigInt)), [v.length]);
  const zeros = (dims) => new O.Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);

  async function encodeAll(samples, langId) {
    // cache trượt (zero-init)
    let clc = zeros([1, 24, 56, 1024]), clt = zeros([1, 24, 1024, 8]);
    let clcl = i64([0]);
    const lid = i64([langId]);
    let carry = new Float32Array(CARRY * NMEL);   // 9 frame carryover (chunk0 = 0)
    let prevTail = null;
    const encs = [];
    for (let i = 0; i < samples.length; i += CHUNK) {
      const chunk = new Float32Array(CHUNK);
      chunk.set(samples.subarray(i, Math.min(i + CHUNK, samples.length)));
      const newMel = melChunk(chunk, prevTail);                  // [56*128]
      // ghép [9 carryover + 56 new] → [1,65,128]
      const af = new Float32Array(ENC_FRAMES * NMEL);
      af.set(carry, 0); af.set(newMel, CARRY * NMEL);
      const out = await enc.run({
        audio_signal: new O.Tensor('float32', af, [1, ENC_FRAMES, NMEL]),
        length: i64([ENC_FRAMES]),
        cache_last_channel: clc, cache_last_time: clt, cache_last_channel_len: clcl, lang_id: lid,
      });
      encs.push(out.outputs);                                    // [1, ~7, 1024]
      clc = out.cache_last_channel_next; clt = out.cache_last_time_next; clcl = out.cache_last_channel_len_next;
      carry = newMel.slice((NEW - CARRY) * NMEL);                // 9 frame cuối làm carryover chunk sau
      prevTail = samples.subarray(Math.max(0, i + CHUNK - 257), i + CHUNK);
    }
    // concat encoded theo trục thời gian
    const H = encs[0].dims[2], T = encs.reduce((s, e) => s + e.dims[1], 0);
    const E = new Float32Array(T * H); let o = 0;
    for (const e of encs) { E.set(e.data, o); o += e.data.length; }
    return { E, T, H };
  }

  async function greedy(E, T, H, forbidden) {
    let h = zeros([2, 1, 640]), c = zeros([2, 1, 640]);
    const runDec = async (tid) => {
      const r = await dec.run({ targets: new O.Tensor('int64', BigInt64Array.from([BigInt(tid)]), [1, 1]), h_in: h, c_in: c });
      h = r.h_out; c = r.c_out; return r.decoder_output;        // [1,640,1]
    };
    let dout = await runDec(BLANK);
    const hyp = [];
    let runTok = -1, runLen = 0;   // chặn lặp: token cuối + số lần lặp liên tiếp
    for (let t = 0; t < T; t++) {
      const et = new O.Tensor('float32', E.subarray(t * H, (t + 1) * H), [1, 1, H]);
      let sym = 0;
      while (sym < MAXSYM) {
        const dd = dout.data, dlt = dout.dims[2];               // decoder_output [1,640,1] → joint cần [1,1,640]
        const dlast = new Float32Array(640);
        for (let k = 0; k < 640; k++) dlast[k] = dd[k * dlt + (dlt - 1)];
        const jo = await joint.run({ encoder_output: et, decoder_output: new O.Tensor('float32', dlast, [1, 1, 640]) });
        const logits = jo.joint_output.data;
        const V = jo.joint_output.dims[jo.joint_output.dims.length - 1];
        let best = 0, bestV = -Infinity;
        for (let v = 0; v < V; v++) { if (forbidden && forbidden.has(v)) continue; const x = logits[v]; if (x > bestV) { bestV = x; best = v; } }   // mask script lạ
        if (best === BLANK) break;
        if (best === runTok && runLen >= 3) break;              // chặn lặp: cùng token ≥4 lần liên tiếp → dừng (collapse loop)
        runTok = best === runTok ? runTok : best; runLen = best === hyp[hyp.length - 1] ? runLen + 1 : 1;
        hyp.push(best); dout = await runDec(best); sym++;
      }
    }
    return hyp;
  }

  async function transcribe(samples, langCode) {
    if (!samples || samples.length < 1600) return '';
    const langId = LANG_ID[langCode] != null ? LANG_ID[langCode] : 0;
    const { E, T, H } = await encodeAll(samples, langId);
    if (!T) return '';
    return vocab.decode(await greedy(E, T, H, forbiddenFor(langCode)));
  }

  // ── STREAMING NATIVE (stateful): feed PCM dần → encoder cache TRƯỢT + RNN-T decode TĂNG DẦN, giữ state qua
  //    các lần accept(). KHÁC transcribe() (xử trọn buffer, cache/decoder reset mỗi lần): partial mọc dần đơn
  //    điệu (RNN-T greedy chỉ NỐI token, không rút lại) → KHÔNG re-decode, KHÔNG VAD. Cho ra ĐÚNG token như
  //    transcribe() vì greedy vốn tuần tự theo thời gian + cache encoder mang left-context y hệt encodeAll.
  //    Vòng đời 1 câu: accept(frame)* → text() đọc partial → finish() flush đuôi <CHUNK → reset() sang câu kế. ──
  function createStream(langCode) {
    const forbidden = forbiddenFor(langCode);
    const langId = LANG_ID[langCode] != null ? LANG_ID[langCode] : 0;
    const lid = i64([langId]);
    let clc, clt, clcl, carry, prevTail, residual;   // state encoder (cache trượt + carryover + tail + dư <CHUNK)
    let h, c, dout, hyp, runTok, runLen;              // state RNN-T decoder (LSTM h/c + giả thuyết + chặn-lặp)
    function _reset() {
      clc = zeros([1, 24, 56, 1024]); clt = zeros([1, 24, 1024, 8]); clcl = i64([0]);
      carry = new Float32Array(CARRY * NMEL); prevTail = null; residual = new Float32Array(0);
      h = zeros([2, 1, 640]); c = zeros([2, 1, 640]); dout = null; hyp = []; runTok = -1; runLen = 0;
    }
    _reset();
    async function runDec(tid) {
      const r = await dec.run({ targets: new O.Tensor('int64', BigInt64Array.from([BigInt(tid)]), [1, 1]), h_in: h, c_in: c });
      h = r.h_out; c = r.c_out; return r.decoder_output;
    }
    // decode T frame encoded MỚI, TIẾP TỤC state (giống vòng trong của greedy nhưng dùng h/c/dout/hyp của session)
    async function _decode(E, T, H) {
      if (!dout) dout = await runDec(BLANK);
      for (let t = 0; t < T; t++) {
        const et = new O.Tensor('float32', E.subarray(t * H, (t + 1) * H), [1, 1, H]);
        let sym = 0;
        while (sym < MAXSYM) {
          const dd = dout.data, dlt = dout.dims[2];
          const dlast = new Float32Array(640);
          for (let k = 0; k < 640; k++) dlast[k] = dd[k * dlt + (dlt - 1)];
          const jo = await joint.run({ encoder_output: et, decoder_output: new O.Tensor('float32', dlast, [1, 1, 640]) });
          const logits = jo.joint_output.data, V = jo.joint_output.dims[jo.joint_output.dims.length - 1];
          let best = 0, bestV = -Infinity;
          for (let v = 0; v < V; v++) { if (forbidden.has(v)) continue; const x = logits[v]; if (x > bestV) { bestV = x; best = v; } }
          if (best === BLANK) break;
          if (best === runTok && runLen >= 3) break;
          runTok = best; runLen = best === hyp[hyp.length - 1] ? runLen + 1 : 1;
          hyp.push(best); dout = await runDec(best); sym++;
        }
      }
    }
    async function _chunk(samples) {
      const newMel = melChunk(samples, prevTail);
      const af = new Float32Array(ENC_FRAMES * NMEL);
      af.set(carry, 0); af.set(newMel, CARRY * NMEL);
      const out = await enc.run({
        audio_signal: new O.Tensor('float32', af, [1, ENC_FRAMES, NMEL]),
        length: i64([ENC_FRAMES]),
        cache_last_channel: clc, cache_last_time: clt, cache_last_channel_len: clcl, lang_id: lid,
      });
      clc = out.cache_last_channel_next; clt = out.cache_last_time_next; clcl = out.cache_last_channel_len_next;
      carry = newMel.slice((NEW - CARRY) * NMEL);
      prevTail = samples.slice(Math.max(0, samples.length - 257));   // left-context cho chunk sau (copy, tránh alias)
      await _decode(out.outputs.data, out.outputs.dims[1], out.outputs.dims[2]);
    }
    return {
      lang: langCode,
      async accept(samples) {
        if (!samples || !samples.length) return;
        if (residual.length) { const m = new Float32Array(residual.length + samples.length); m.set(residual, 0); m.set(samples, residual.length); residual = m; }
        else residual = samples.slice();
        let off = 0;
        while (off + CHUNK <= residual.length) { await _chunk(residual.subarray(off, off + CHUNK)); off += CHUNK; }
        residual = residual.subarray(off);
      },
      text() { return vocab.decode(hyp); },
      async finish() {
        if (residual.length) { const ch = new Float32Array(CHUNK); ch.set(residual.subarray(0, Math.min(CHUNK, residual.length))); residual = new Float32Array(0); await _chunk(ch); }
        return vocab.decode(hyp);
      },
      reset() { _reset(); },
    };
  }

  return { transcribe, createStream };
}

function nemotronComplete(dir) {
  try { return ['encoder.onnx', 'decoder.onnx', 'joint.onnx', 'genai_config.json', 'vocab.txt'].every(f => fs.existsSync(path.join(dir, f))); }
  catch { return false; }
}

module.exports = { createNemotron, nemotronComplete, LANG_ID };
