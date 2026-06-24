// gemini-live.js (browser ESM) — port của src/gemini-live.js cho extension.
// Audio-to-audio Gemini 3.5 Live Translate: PCM16 16kHz vào → STT + dịch + TTS ra.
// Khác bản Electron: bỏ IPC, thay bằng callbacks; bỏ Node Buffer, dùng base64 helper trình duyệt.
import { GoogleGenAI, Modality } from './genai.mjs';
import { bcp47 } from './langs.js';

const MODEL = 'gemini-3.5-live-translate-preview';
const RECONNECT_MS = 1500;
const PARTIAL_DEBOUNCE_MS = 120;
const TR_SENT_END = /[.!?。．！？]\s*$/;
const SETTLE_MS = 450;
const LONG_IDLE_MS = 2500;
const AUDIO_FLUSH_SAMPLES = (24000 * 0.4) | 0;   // ~0.4s
const AUDIO_IDLE_MS = 200;

function _b64ToBytes(b64) {
  const bin = atob(b64); const n = bin.length; const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function _bytesToB64(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function _f32ToPcm16B64(f32) {
  const buf = new ArrayBuffer(f32.length * 2); const dv = new DataView(buf);
  for (let i = 0; i < f32.length; i++) { let s = f32[i]; if (s > 1) s = 1; else if (s < -1) s = -1; dv.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7FFF), true); }
  return _bytesToB64(new Uint8Array(buf));
}
function _ts() { const d = new Date(), p = n => (n < 10 ? '0' : '') + n; return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

// opts = { getState(): {apiKey, langCode, transcribeMode, geminiAudioOn}, onCaption, onAudio, onClear, onStatus }
export function createLiveTranslator(opts) {
  const st = () => opts.getState();
  const onCaption = opts.onCaption || (() => {});
  const onAudio = opts.onAudio || (() => {});
  const onClear = opts.onClear || (() => {});
  const onStatus = opts.onStatus || (() => {});

  let _started = false, _session = null, _connecting = null, _gen = 0;
  let _handle = null;
  let _reconnectTimer = null, _emitTimer = null, _flushTimer = null;
  let _lineBase = 1, _transAcc = '';
  let _audioBuf = [], _audioSamples = 0, _audioIdleTimer = null;

  const isConfigured = () => !!(st().apiKey && String(st().apiKey).trim());

  // ── Tách câu bản dịch (cắt tại . ? !) — mỗi câu 1 entry ──
  function _splitVI(s) {
    s = s || ''; const out = []; let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '.' && /\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '')) continue;
      if (c === '.' || c === '!' || c === '?' || c === '。' || c === '！' || c === '？' || c === '．') {
        const seg = s.slice(start, i + 1).trim(); if (seg) out.push(seg); start = i + 1;
      }
    }
    const tail = s.slice(start).trim(); if (tail) out.push(tail);
    return out;
  }
  function _emitVI(turnDone) {
    const sents = _splitVI(_transAcc);
    const n = Math.max(sents.length, 1);
    for (let i = 0; i < n; i++) {
      const text = sents[i] || (_transAcc || '').trim();
      if (!text) continue;
      const isPartial = !turnDone && (i === n - 1);
      onCaption({ id: _lineBase + i, author: 'STT', original: '', translated: text, isPartial, ts: _ts(), tsMs: Date.now() });
    }
    return n;
  }
  function _flush() {
    clearTimeout(_emitTimer); clearTimeout(_flushTimer);
    if ((_transAcc || '').trim()) { _lineBase += _emitVI(true); }
    _transAcc = '';
  }

  // ── Audio TTS: gom ~0.4s rồi phát trọn 1 lần ──
  function _flushAudio() {
    clearTimeout(_audioIdleTimer); _audioIdleTimer = null;
    if (!_audioBuf.length) return;
    let total = 0; for (const b of _audioBuf) total += b.length;
    const merged = new Uint8Array(total); let off = 0;
    for (const b of _audioBuf) { merged.set(b, off); off += b.length; }
    _audioBuf = []; _audioSamples = 0;
    onAudio({ b64: _bytesToB64(merged), sampleRate: 24000 });
  }
  function _bufAudio(b64) {
    const bytes = _b64ToBytes(b64);
    _audioBuf.push(bytes); _audioSamples += bytes.length >> 1;
    clearTimeout(_audioIdleTimer);
    if (_audioSamples >= AUDIO_FLUSH_SAMPLES) { _flushAudio(); return; }
    _audioIdleTimer = setTimeout(_flushAudio, AUDIO_IDLE_MS);
  }
  function _resetAudio() { clearTimeout(_audioIdleTimer); _audioIdleTimer = null; _audioBuf = []; _audioSamples = 0; }

  function _onMessage(gen, m) {
    if (gen !== _gen) return;
    try {
      if (m.sessionResumptionUpdate && m.sessionResumptionUpdate.resumable && m.sessionResumptionUpdate.newHandle) _handle = m.sessionResumptionUpdate.newHandle;
      if (m.goAway) { console.log('[live] goAway → reconnect'); _reconnectWithHandle(); return; }
      const sc = m.serverContent;
      if (!sc) return;
      const transcribe = !!st().transcribeMode;
      let changed = false;
      const ot = transcribe
        ? (sc.inputTranscription && sc.inputTranscription.text)
        : (sc.outputTranscription && sc.outputTranscription.text);
      if (typeof ot === 'string' && ot) { _transAcc += ot; changed = true; }
      const parts = (sc.modelTurn && sc.modelTurn.parts) || sc.parts;
      if (!transcribe && parts && st().geminiAudioOn !== false) {
        for (const p of parts) { const id = p && (p.inlineData || p.inline_data); const d = id && id.data; if (d) _bufAudio(d); }
      }
      if (changed) {
        clearTimeout(_emitTimer); _emitTimer = setTimeout(() => _emitVI(false), PARTIAL_DEBOUNCE_MS);
        const ended = TR_SENT_END.test(_transAcc || '');
        clearTimeout(_flushTimer); _flushTimer = setTimeout(_flush, ended ? SETTLE_MS : LONG_IDLE_MS);
      }
      if (sc.turnComplete) _flush();
    } catch (e) { console.warn('[live] msg lỗi:', e && e.message); }
  }

  async function _connect() {
    const ai = new GoogleGenAI({ apiKey: String(st().apiKey).trim() });
    const myGen = ++_gen;
    const config = {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      translationConfig: { targetLanguageCode: bcp47(st().langCode), echoTargetLanguage: st().transcribeMode ? true : false },
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: _handle ? { handle: _handle } : {},
    };
    return ai.live.connect({
      model: MODEL,
      config,
      callbacks: {
        onopen: () => console.log('[live] phiên mở (gen ' + myGen + ', →' + bcp47(st().langCode) + (_handle ? ', resume' : '') + ')'),
        onmessage: (m) => _onMessage(myGen, m),
        onerror: (e) => console.warn('[live] ws error:', e && e.message),
        onclose: () => { if (myGen === _gen) { _session = null; if (_started) _scheduleReconnect(); } },
      },
    });
  }
  async function _ensure() {
    if (!_started || !isConfigured()) return null;
    if (_session) return _session;
    if (_connecting) return _connecting;
    _connecting = (async () => {
      try { _session = await _connect(); }
      catch (e) { console.warn('[live] connect lỗi:', e && e.message); _session = null; onStatus({ error: e && e.message }); if (_started) _scheduleReconnect(); }
      finally { _connecting = null; }
      return _session;
    })();
    return _connecting;
  }
  function _scheduleReconnect() { if (!_started) return; clearTimeout(_reconnectTimer); _reconnectTimer = setTimeout(() => { if (_started && !_session && !_connecting) _ensure().catch(() => {}); }, RECONNECT_MS); }
  function _closeSession() { const s = _session; _session = null; _gen++; if (s) { try { s.close(); } catch {} } }
  function _reconnectWithHandle() { _closeSession(); if (_started) _ensure().catch(() => {}); }

  async function pushAudio(f32) {
    if (!_started || !isConfigured() || !f32 || !f32.length) return;
    const sess = await _ensure();
    if (!sess) return;
    try { sess.sendRealtimeInput({ audio: { data: _f32ToPcm16B64(f32), mimeType: 'audio/pcm;rate=16000' } }); }
    catch (e) { /* đang reconnect → bỏ khung này */ }
  }

  function start() {
    if (_started) return;
    if (!isConfigured()) { onStatus({ error: 'no-key' }); return; }
    _started = true; _handle = null; _transAcc = ''; _resetAudio();
    _ensure().catch(() => {});
    console.log('[live] start');
  }
  function stop() {
    _started = false;
    clearTimeout(_reconnectTimer); clearTimeout(_emitTimer); clearTimeout(_flushTimer);
    if (_transAcc) _flush();
    _transAcc = ''; _handle = null; _resetAudio();
    _closeSession();
    onClear();
    console.log('[live] stop');
  }
  function onTargetLangChanged() { if (_started) { _handle = null; _transAcc = ''; clearTimeout(_emitTimer); clearTimeout(_flushTimer); _resetAudio(); _closeSession(); _ensure().catch(() => {}); } }
  function onTranscribeModeChanged() { onTargetLangChanged(); }
  function setAudioOn(on) { if (!on) { _resetAudio(); onClear(); } }
  const isActive = () => _started;

  return { isConfigured, isActive, pushAudio, start, stop, onTargetLangChanged, onTranscribeModeChanged, setAudioOn };
}

// Validate API key (zero-cost: ListModels). Trả { ok } | { ok:false, error }.
export async function validateKey(key) {
  const k = String(key || '').trim();
  if (!k) return { ok: false, error: 'empty' };
  try {
    const ai = new GoogleGenAI({ apiKey: k });
    const pager = await ai.models.list();
    for await (const _m of pager) break;
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, error: /api[_ ]?key|invalid|400|401|403/i.test(msg) ? 'invalid' : msg };
  }
}
