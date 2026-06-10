/**
 * audio-stt.js — Dịch vụ audio (system/mic) qua STT cục bộ sherpa-onnx-node (xem src/stt.js).
 * KHÔNG còn Python: renderer gửi PCM float32 @16k (Web Audio) → handlePcm → dịch.
 *
 * HAI NHÁNH theo ngôn ngữ (stt.isStreaming):
 *   - ONLINE (zh/en/ko): đẩy PCM trực tiếp vào OnlineRecognizer → partial mọc dần (như Live Captions),
 *     chốt câu khi isEndpoint → dịch. KHÔNG cần VAD.
 *   - OFFLINE (ja/vi): cắt câu bằng Silero VAD → transcribe trọn đoạn → gom câu (như Whisper cũ).
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
  // Warm model sẵn (lần đầu ~1s) để bấm ▶ là ghi ngay — phủ overlay chặn thao tác trong lúc tải.
  const ok = await warmModel();
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

// Tải SẴN model cho ngôn ngữ nguồn hiện tại + PHỦ OVERLAY chặn thao tác (đổi nguồn/đổi ngôn ngữ → tải model).
// Online build OnlineRecognizer đồng bộ (~1-2s, block main): yield 1 nhịp sau 'busy on' để renderer kịp vẽ overlay
// TRƯỚC khi main bị block. Luôn gửi 'busy off' (finally) → không kẹt overlay. Trả Promise<bool> (model sẵn sàng?).
async function warmModel() {
  send('busy', { on: true, key: 'busy.loadingModel' });
  await new Promise(r => setImmediate(r));
  let ok = false;
  try { ok = await stt.warm(); }
  catch (e) { console.warn('[audio-stt] warm lỗi:', e.message); }
  finally { send('busy', { on: false }); }
  return ok;
}

// ── NHÁNH ONLINE (streaming, zh/en/ko): partial mọc dần → chốt câu khi isEndpoint → dịch ────────────
// _liveId = entry câu ĐANG nói (stream realtime, dịch để trống); chốt CHÍNH entry đó khi hết câu.
let _online = null, _onlineLang = null, _liveId = null, _liveText = '';
function _ensureOnline() {
  const lang = stt.currentLang();
  if (_online && _onlineLang === lang) return _online;
  _online = stt.createOnlineSession();   // null nếu thiếu model / không tạo được
  _onlineLang = lang;
  _liveId = null; _liveText = '';
  return _online;
}
// Chốt câu đang stream: chuyển entry _liveId từ live(chưa dịch) → final(dịch). Lọc ảo giác như offline.
function _finalizeOnline(text) {
  const sRaw = (text || '').trim();
  _liveText = '';
  if (!sRaw || stt.isHallucination(sRaw)) { _liveId = null; return; }
  const id = _liveId || (++state.audioEntryId);
  _liveId = null;
  const now = Date.now();
  const cleaned = preprocessText(sRaw);
  send('caption-live', { id, author: 'STT', original: sRaw, translated: '…', ts: timestamp(), tsMs: now });
  enqueueTranslate(cleaned).then(tr => {
    if (state.audioPaused) return;   // user đã ⏹ giữa lúc dịch → bỏ kết quả tới muộn
    const ok = tr && tr !== cleaned && tr !== sRaw;
    send('caption-live', { id, author: 'STT', original: sRaw, translated: ok ? tr : null, ts: timestamp(), tsMs: now });
  }).catch(() => {});
}
// Đẩy 1 khung PCM vào streaming recognizer. Trả false nếu KHÔNG phải nhánh online (caller fallback offline).
function _handlePcmStreaming(samples) {
  const sess = _ensureOnline();
  if (!sess) return false;
  try { sess.accept(samples); } catch { return true; }
  const r = sess.result();
  const text = (r.text || '').trim();
  if (text && text !== _liveText) {
    _liveText = text;
    if (!_liveId) _liveId = ++state.audioEntryId;   // mở entry mới cho câu đang nói
    send('caption-live', { id: _liveId, author: 'STT', original: text, translated: '', ts: timestamp(), tsMs: Date.now() });
  }
  if (sess.isEndpoint()) { _finalizeOnline(_liveText || text); sess.reset(); }
  return true;
}
// Chốt nốt câu ĐANG stream khi DỪNG ghi (user bấm ⏹ giữa câu) → câu cuối được dịch thay vì treo.
function flushStreaming() {
  if (_online && _liveText) { _finalizeOnline(_liveText); try { _online.reset(); } catch {} }
}

// Dedup câu STT trùng trong cửa sổ ngắn (nhánh OFFLINE)
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

// Nhận PCM float32 @16k từ renderer (khung nhỏ ~0.25s). Online → streaming; offline → VAD → transcribe.
async function handlePcm(samples) {
  if (state.captureSource === 'teams' || state.audioPaused) return;
  if (!samples || !samples.length) return;
  if (stt.isStreaming()) {
    if (_handlePcmStreaming(samples)) return;   // online (zh/en/ko) — chốt câu trong vòng streaming
    // tạo session lỗi → rơi xuống offline phía dưới
  }
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
  // Online: bỏ stream cũ → phiên mới tạo session sạch (đổi ngôn ngữ cũng được tái tạo qua _ensureOnline).
  if (_online) { try { _online.reset(); } catch {} }
  _online = null; _onlineLang = null; _liveId = null; _liveText = '';
}

// Không còn server Python — giữ tên export cho main.js (no-op).
function stopSTTServer() {}

module.exports = { runAudioService, handlePcm, stopSTTServer, resetSegmentation, flushStreaming, warmModel };
