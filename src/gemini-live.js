/**
 * gemini-live.js — STT + Dịch + TTS qua Gemini 3.5 Live Translate (gemini-3.5-live-translate-preview).
 *
 * Audio-to-audio: app stream AUDIO cuộc họp (PCM16 16kHz) lên model → model TỰ nhận diện ngôn ngữ nguồn, trả về:
 *   • transcript GỐC   = serverContent.inputTranscription.text   (caption nguồn)
 *   • transcript DỊCH  = serverContent.outputTranscription.text  (caption dịch)
 *   • audio DỊCH (TTS) = serverContent.modelTurn.parts[].inlineData.data (PCM16 24kHz) → renderer phát
 * Transcript về theo DELTA → gom, chốt dòng khi turnComplete. KHÔNG cần STT/translation local nữa.
 *
 * PHIÊN 2h: contextWindowCompression(slidingWindow) bỏ trần 15'; sessionResumption + reconnect khi goAway/close
 * (kết nối ~10' tự xoay). Giữ audio chảy liên tục vào phiên hiện hành. SDK ESM → dynamic import().
 */
const state = require('./state');
const { bcp47 } = require('./langs');

const MODEL = 'gemini-3.5-live-translate-preview';
const RECONNECT_MS = 1500;
const PARTIAL_DEBOUNCE_MS = 120;

const send = (ch, data) => state.win && state.win.webContents && state.win.webContents.send(ch, data);
let _genaiMod = null;
async function _sdk() { return _genaiMod || (_genaiMod = await import('@google/genai')); }

let _started = false, _session = null, _connecting = null, _gen = 0;
let _handle = null;                 // sessionResumption handle (để reconnect xuyên suốt)
let _reconnectTimer = null, _emitTimer = null;
let _lineBase = 1, _origAcc = '', _transAcc = '';

function isConfigured() { return !!(state.apiKey && String(state.apiKey).trim()); }
function isActive() { return _started; }
function _ts() { const d = new Date(), p = n => (n < 10 ? '0' : '') + n; return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

function _f32ToPcm16B64(f32) {
  const buf = Buffer.allocUnsafe(f32.length * 2);
  for (let i = 0; i < f32.length; i++) { let s = f32[i]; if (s > 1) s = 1; else if (s < -1) s = -1; buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7FFF), i * 2); }
  return buf.toString('base64');
}

async function _connect() {
  const { GoogleGenAI, Modality } = await _sdk();
  const ai = new GoogleGenAI({ apiKey: String(state.apiKey).trim() });
  const myGen = ++_gen;
  const config = {
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // echoTargetLanguage:false = model IM LẶNG khi audio vào đã ở ngôn ngữ đích → bỏ qua chính tiếng TTS nó
    // nghe lại từ loa (TTS phát ra = ngôn ngữ đích) → CẮT vòng feedback mic↔loa ở tầng ngữ nghĩa (full-duplex-safe).
    // Vẫn dịch bình thường người nói NGUỒN. (Cẩn trọng: phụ thuộc auto language-ID của Gemini — test từng cặp.)
    translationConfig: { targetLanguageCode: bcp47(state.langCode), echoTargetLanguage: false },
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: _handle ? { handle: _handle } : {},
  };
  return ai.live.connect({
    model: MODEL,
    config,
    callbacks: {
      onopen:    () => console.log('[live-translate] phiên mở (gen ' + myGen + ', →' + bcp47(state.langCode) + (_handle ? ', resume' : '') + ')'),
      onmessage: (m) => _onMessage(myGen, m),
      onerror:   (e) => console.warn('[live-translate] ws error:', e && e.message),
      onclose:   (e) => { if (myGen === _gen) { _session = null; if (_started) _scheduleReconnect(); } },
    },
  });
}
async function _ensure() {
  if (!_started || !isConfigured()) return null;
  if (_session) return _session;
  if (_connecting) return _connecting;
  _connecting = (async () => {
    try { _session = await _connect(); }
    catch (e) { console.warn('[live-translate] connect lỗi:', e && e.message); _session = null; send('gemini-status', { error: e && e.message }); if (_started) _scheduleReconnect(); }
    finally { _connecting = null; }
    return _session;
  })();
  return _connecting;
}
function _scheduleReconnect() { if (!_started) return; clearTimeout(_reconnectTimer); _reconnectTimer = setTimeout(() => { if (_started && !_session && !_connecting) _ensure().catch(() => {}); }, RECONNECT_MS); }
function _closeSession() { const s = _session; _session = null; _gen++; if (s) { try { s.close(); } catch {} } }
function _reconnectWithHandle() { _closeSession(); if (_started) _ensure().catch(() => {}); }   // dùng _handle hiện có

// Cắt câu tại 。．.！？ (bỏ qua dấu chấm thập phân) → mỗi câu 1 entry caption riêng (hết "nối liền").
function _splitSents(s) {
  s = s || ''; const out = []; let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const end = (c === '。' || c === '！' || c === '？' || c === '．' || (c === '.' && !(/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || ''))));
    if (end) { const seg = s.slice(start, i + 1).trim(); if (seg) out.push(seg); start = i + 1; }
  }
  const tail = s.slice(start).trim(); if (tail) out.push(tail);
  return out;
}
// Mỗi câu = 1 entry (ghép gốc↔dịch theo chỉ số). turnDone=false → câu cuối là partial (đang nói).
function _emitSplit(turnDone) {
  const o = _splitSents(_origAcc), tr = _splitSents(_transAcc);
  const n = Math.max(o.length, tr.length);
  for (let i = 0; i < n; i++) {
    const isPartial = !turnDone && (i === n - 1);
    const orig = o[i] || '';
    const trans = (i < tr.length) ? tr[i] : '…';   // chưa có bản dịch câu này → '…' (đang dịch)
    if (!orig && i >= tr.length) continue;
    send('caption-live', { id: _lineBase + i, author: 'STT', original: orig, translated: trans, isPartial, ts: _ts(), tsMs: Date.now() });
  }
  return n;
}

function _onMessage(gen, m) {
  if (gen !== _gen) return;
  try {
    if (m.sessionResumptionUpdate && m.sessionResumptionUpdate.resumable && m.sessionResumptionUpdate.newHandle) _handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) { console.log('[live-translate] goAway → reconnect (resume)'); _reconnectWithHandle(); return; }
    const sc = m.serverContent;
    if (!sc) return;
    // 'interrupted' = model BỎ DỞ lượt TTS hiện hành rồi bắn lượt MỚI. KHÔNG xoá sạch (gemini-clear) vì cắt mất âm
    // đang phát = mất đuôi câu. Thay vào: 'softCut' — node ĐANG phát nói nốt, chỉ BỎ phần đuôi đã xếp ở TƯƠNG LAI
    // (thuộc lượt bị bỏ dở) rồi cho lượt mới nối ngay sau → hết đuôi-cũ dính câu-mới mà KHÔNG cụt âm đang nghe.
    if (sc.interrupted && state.geminiAudioOn !== false) send('gemini-audio', { softCut: true });
    let changed = false;
    const it = sc.inputTranscription && sc.inputTranscription.text;
    if (typeof it === 'string' && it) { _origAcc += it; changed = true; }
    const ot = sc.outputTranscription && sc.outputTranscription.text;
    if (typeof ot === 'string' && ot) { _transAcc += ot; changed = true; }
    const parts = (sc.modelTurn && sc.modelTurn.parts) || sc.parts;
    if (parts && state.geminiAudioOn !== false) for (const p of parts) { const id = p && (p.inlineData || p.inline_data); const d = id && id.data; if (d) send('gemini-audio', { b64: d, sampleRate: 24000 }); }
    if (changed) { clearTimeout(_emitTimer); _emitTimer = setTimeout(() => _emitSplit(false), PARTIAL_DEBOUNCE_MS); }
    if (sc.turnComplete) { clearTimeout(_emitTimer); _lineBase += _emitSplit(true); _origAcc = ''; _transAcc = ''; if (state.geminiAudioOn !== false) send('gemini-audio', { pauseMs: 260 }); }   // ranh giới câu → renderer chèn khoảng lặng (nghỉ giữa câu)
  } catch (e) { console.warn('[live-translate] msg lỗi:', e && e.message); }
}

// ── API công khai ──────────────────────────────────────────────────────────────
// Đẩy 1 khung PCM Float32 @16kHz vào phiên (audio-stt gọi mỗi khung từ renderer/process-loopback).
async function pushAudio(f32) {
  if (!_started || !isConfigured() || !f32 || !f32.length) return;
  const sess = await _ensure();
  if (!sess) return;
  try { sess.sendRealtimeInput({ audio: { data: _f32ToPcm16B64(f32), mimeType: 'audio/pcm;rate=16000' } }); }
  catch (e) { /* phiên đang reconnect → bỏ khung này */ }
}

function start() {
  if (_started) return;
  if (!isConfigured()) { send('gemini-status', { error: 'no-key' }); return; }
  // KHÔNG reset _lineBase: id phải TĂNG ĐƠN ĐIỆU xuyên start/stop (renderer chỉ xoá list khi bấm Clear; reset về 1
  // sẽ trùng id cũ → cập-nhật-tại-chỗ entry CŨ). _lineBase đã được turnComplete/stop() đẩy qua mọi id đã dùng.
  _started = true; _handle = null; _origAcc = ''; _transAcc = '';
  _ensure().catch(() => {});
  console.log('[live-translate] start');
}
function stop() {
  _started = false;
  clearTimeout(_reconnectTimer); clearTimeout(_emitTimer);
  if (_origAcc || _transAcc) { _lineBase += _emitSplit(true); }   // chốt nốt câu dở
  _origAcc = ''; _transAcc = ''; _handle = null;
  _closeSession();
  send('gemini-clear');
  console.log('[live-translate] stop');
}
function onTargetLangChanged() { if (_started) { _handle = null; _closeSession(); _ensure().catch(() => {}); } }   // đổi đích → phiên mới
function setAudioOn(on) { state.geminiAudioOn = !!on; if (!on) send('gemini-clear'); }

// Validate API key (zero-cost: ListModels). Trả { ok } | { ok:false, error }.
async function validateKey(key) {
  const k = String(key || '').trim();
  if (!k) return { ok: false, error: 'empty' };
  try {
    const { GoogleGenAI } = await _sdk();
    const ai = new GoogleGenAI({ apiKey: k });
    const pager = await ai.models.list();   // Pager không có .next(); for-await ép 1 round-trip (key sai → throw)
    for await (const _m of pager) break;
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, error: /api[_ ]?key|invalid|400|401|403/i.test(msg) ? 'invalid' : msg };
  }
}

module.exports = { isConfigured, isActive, pushAudio, start, stop, onTargetLangChanged, setAudioOn, validateKey };
