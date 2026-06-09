/**
 * audio-stt.js — Dịch vụ audio (system/mic) qua STT cục bộ sherpa-onnx-node (xem src/stt.js).
 * KHÔNG còn Python: renderer gửi PCM float32 @16k (Web Audio) → handlePcm → stt.recognize → dịch.
 */
const state = require('./state');
const { enqueueTranslate, preprocessText } = require('./translation');
const { timestamp } = require('./caption-service');
const stt = require('./stt');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (ch, data) => state.win?.webContents?.send(ch, data);

async function runAudioService() {
  // Boot IDLE: KHÔNG tự ghi khi mở app. audioPaused=true cho tới khi user bấm ▶ (toggle-captions lật cờ).
  state.audioPaused = true;
  const label = state.captureSource === 'mic' ? 'Microphone' : 'System Audio';
  send('status', { type: 'waiting', key: 'status.audioStarting', vars: { label } });

  if (!stt.isModelAvailable()) {
    send('status', { type: 'error', key: 'status.sttModelMissing' });
    while (!state.captureSourceChanged) { await sleep(300); }
    return;
  }
  send('status', { type: 'loading', key: 'status.sttLoading' });
  const ok = await stt.ensureReady();   // load model off-thread sẵn (lần đầu ~1s) để bấm ▶ là ghi ngay
  if (!ok) {
    send('status', { type: 'error', key: 'status.sttFailed' });
    while (!state.captureSourceChanged) { await sleep(300); }
    return;
  }

  // Model sẵn sàng nhưng CHƯA ghi — chờ user bấm ▶. Nút play ở trạng thái ▶ (status≠running).
  send('status', { type: 'idle', key: 'status.audioReady', vars: { label } });
  send('cc-state', { active: false });

  while (!state.captureSourceChanged) { await sleep(300); }

  send('stop-audio-capture', {});
  send('cc-state', { active: false });
}

// Dedup câu STT trùng trong cửa sổ ngắn
const _sttRecentTexts = new Map();
const STT_DEDUP_MS = 8000;

// ── VAD: cắt câu theo khoảng lặng (Silero) → chỉ transcribe khi MỘT lượt nói KẾT THÚC → câu đủ nghĩa,
//    ít nghe sai (Whisper nghe trọn đoạn thay vì mảnh 2.5s rời). Thiếu model VAD → fallback chunk như cũ. ──
let _vad = null, _vadLang = null, _vadModelOk = null, _draining = false;
let _fbParts = [], _fbLen = 0;   // gom khung cho nhánh fallback (thiếu model VAD)
// Tạo (lại) VAD theo NGÔN NGỮ NGUỒN hiện tại — đổi ngôn ngữ ⇒ tạo lại với config tương ứng (STT_CONFIG).
function _ensureVad() {
  if (_vadModelOk === null) _vadModelOk = stt.isVadAvailable();
  if (!_vadModelOk) return null;   // thiếu model → fallback chunk
  const lang = stt.currentLang();
  if (_vad && _vadLang === lang) return _vad;
  _vad = stt.createVad();          // ngôn ngữ đổi (hoặc lần đầu) → VAD mới theo config ngôn ngữ đó
  _vadLang = lang;
  _carry = '';                     // đổi ngôn ngữ → bỏ mảnh dở cũ
  if (_vad) console.log('[audio-stt] VAD theo ngôn ngữ nguồn:', lang || 'auto');
  return _vad;
}

// Phát caption + dịch cho 1 mảng câu (đã lọc) — dedup trong cửa sổ ngắn.
function _emitLines(lines) {
  if (!lines || !lines.length) return;
  const now = Date.now();
  for (const line of lines) {
    const normLine = line.toLowerCase().replace(/\s+/g, ' ').trim();
    // Dedup: trùng khít HOẶC gần-trùng (1 chuỗi chứa chuỗi kia, ≥6 ký tự) trong cửa sổ — bắt cả biến thể
    // lặp như "そろしくお願いします" ⊂ "どうぞそろしくお願いします" (cùng 1 câu nói bị nghe/chia khác nhau).
    let dup = false;
    for (const [k, ts_] of _sttRecentTexts) {
      if (now - ts_ >= STT_DEDUP_MS) continue;
      if (k === normLine || (normLine.length >= 6 && k.length >= 6 && (k.includes(normLine) || normLine.includes(k)))) { dup = true; break; }
    }
    if (dup) continue;
    _sttRecentTexts.set(normLine, now);
    for (const [k, ts_] of _sttRecentTexts) {
      if (now - ts_ > STT_DEDUP_MS * 2) _sttRecentTexts.delete(k);
    }
    const id = ++state.audioEntryId;
    const ts = timestamp();
    const tsMs = Date.now();
    const cleaned = preprocessText(line);
    send('caption-live', { id, author: 'STT', original: line, translated: '…', ts, tsMs });
    enqueueTranslate(cleaned).then(translated => {
      if (state.audioPaused) return;   // user đã bấm ⏹ giữa lúc đang dịch → bỏ kết quả tới muộn
      const isTranslated = translated !== line && translated !== cleaned;
      send('caption-live', { id, author: 'STT', original: line, translated: isTranslated ? translated : null, ts: timestamp(), tsMs });
    });
  }
}

// ── Gom câu theo DẤU KẾT THÚC (。．.!?！？…) ──
// VAD cắt theo khoảng lặng/trần thời gian → đoạn có thể đứt GIỮA câu. Ta giữ mảnh chưa-kết-câu trong
// _carry, nối với đoạn kế → chỉ phát khi câu trọn (kết bằng dấu câu). Đoạn ngắn hơn trần ⇒ kết do khoảng
// lặng ⇒ coi như hết câu (chốt luôn). Giữ quá dài (>80 ký tự) cũng chốt để tránh kẹt.
let _carry = '';
const _SENT_END = /[。．.!?！？…]["'）」』)\]]*$/u;
const _INCOMPLETE_END = /(--|[-‐–—,、:：;；])\s*$/u;   // đuôi rõ ràng còn dở (Whisper báo đứt bằng "--", hoặc phẩy)
function _join(a, b) {
  if (!a) return b;
  return (/[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b)) ? a + ' ' + b : a + b;   // EN cần space; JP/ZH thì không
}
function _sentenceParts(text) {
  const raw = text.split(/(?<=[。．.!?！？…])/u).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of raw) {
    if (out.length && /^[”"'』」）)\]\s]+$/u.test(p)) out[out.length - 1] += p;   // mảnh chỉ gồm dấu đóng → ghép vào câu trước
    else out.push(p);
  }
  return out;
}
function _assembleAndEmit(text, durSec) {
  const endedBySilence = durSec < (stt.maxSpeechSec ? stt.maxSpeechSec() : 8) - 1;
  if (!text) {
    if (endedBySilence && _carry) { _emitLines([_carry]); _carry = ''; }
    return;
  }
  const parts = _sentenceParts(_join(_carry, text));
  _carry = '';
  if (!parts.length) return;
  const last = parts[parts.length - 1];
  let toEmit;
  if (_SENT_END.test(last)) toEmit = parts;                                  // kết bằng dấu câu → câu trọn
  else if (endedBySilence && !_INCOMPLETE_END.test(last)) toEmit = parts;    // có khoảng lặng + đuôi không dở → chốt
  else { toEmit = parts.slice(0, -1); _carry = last; }                       // mảnh dở → giữ lại nối đoạn sau
  if (_carry.length > 80) { toEmit.push(_carry); _carry = ''; }
  _emitLines(toEmit);
}

// Rút các đoạn VAD đã cắt → transcribe → gom câu. Serialize bằng _draining tránh đua.
async function _drainVad() {
  if (_draining) return;
  _draining = true;
  try {
    while (_vad && !_vad.isEmpty()) {
      let seg;
      try { seg = _vad.front(false); _vad.pop(); }   // false = KHÔNG external buffer (Electron cấm → copy thường)
      catch (e) { console.warn('[audio-stt] VAD front lỗi:', e.message); break; }
      const durSec = seg.samples.length / 16000;
      let text;
      try { text = await stt.transcribe(seg.samples); } catch { text = ''; }
      _assembleAndEmit(text, durSec);
    }
  } finally { _draining = false; }
}

// Nhận PCM float32 @16k từ renderer (khung nhỏ ~0.25s) → đẩy vào VAD → transcribe đoạn trọn.
async function handlePcm(samples) {
  if (state.captureSource === 'teams' || state.audioPaused) return;
  if (!samples || !samples.length) return;
  const vad = _ensureVad();
  if (vad) {
    try { vad.acceptWaveform(samples); } catch { return; }
    await _drainVad();
  } else {
    // Fallback (thiếu model VAD): gom khung nhỏ thành ~2.5s rồi transcribe (Whisper cần đoạn đủ dài).
    _fbParts.push(samples); _fbLen += samples.length;
    if (_fbLen < 16000 * 2.5) return;
    const merged = new Float32Array(_fbLen);
    let o = 0; for (const p of _fbParts) { merged.set(p, o); o += p.length; }
    _fbParts = []; _fbLen = 0;
    let lines;
    try { lines = await stt.recognize(merged); } catch { return; }
    _emitLines(lines);
  }
}

// Reset VAD + dedup khi BẮT ĐẦU ghi mới (bỏ audio dở còn sót từ phiên trước → phiên mới sạch).
function resetSegmentation() {
  if (_vad) { try { _vad.reset(); } catch {} try { _vad.clear(); } catch {} }
  _fbParts = []; _fbLen = 0;
  _carry = '';
  _sttRecentTexts.clear();
}

// Không còn server Python — giữ tên export cho main.js (no-op).
function stopSTTServer() {}

module.exports = { runAudioService, handlePcm, stopSTTServer, resetSegmentation };
