/**
 * gemini-text-live.js — Dịch TEXT (caption Teams) → text dịch + audio TTS qua gemini-3.1-flash-live-preview.
 *
 * Dùng cho CHẾ ĐỘ TEAMS: uia-captions đọc caption Teams (text) → translate(text) → gửi text lên phiên Live →
 * nhận outputTranscription (bản dịch, trả cho caller) + audio (TTS, emit 'gemini-audio'). Gửi bằng
 * sendClientContent(turnComplete:true) (turn text rời rạc). Phiên recycle 90s/15 câu chống "trôi". Giọng = state.geminiVoice.
 *
 * (Chế độ AUDIO system/mic dùng module KHÁC: gemini-live.js = gemini-3.5-live-translate audio-in.)
 */
const state = require('./state');

const MODEL = 'gemini-3.1-flash-live-preview';
const RECYCLE_MS = 90 * 1000;
const MAX_TURNS = 15;
const TURN_TIMEOUT_MS = 25000;
const MAX_QUEUE = 16;

const send = (ch, data) => state.win && state.win.webContents && state.win.webContents.send(ch, data);
let _mod = null;
async function _sdk() { return _mod || (_mod = await import('@google/genai')); }

let _started = false, _session = null, _connecting = null, _gen = 0;
let _recTimer = null, _recNeeded = false, _turns = 0;
let _queue = [], _inflight = null, _draining = false, _audioLogged = false;

function isConfigured() { return !!(state.apiKey && String(state.apiKey).trim()); }
function isActive() { return _started; }
function _voice() { return state.geminiVoice || 'Achernar'; }
function _sys() {
  const tgt = state.targetLang || 'Vietnamese';
  return `You are a translation engine. Translate the user's message into ${tgt} and SPEAK the translation aloud. `
    + `ALWAYS translate into ${tgt} ONLY — never any other language — regardless of conversation history. `
    + `Treat each message as an INDEPENDENT sentence. Speak ONLY the translation: no preface, no commentary, no `
    + `original text. Preserve proper nouns, numbers, technical terms.`;
}
function _clean(s) {
  let t = (s || '').trim(); if (!t) return t;
  t = t.replace(/^(sure|okay|ok|certainly|here(?:'s| is)[^:]{0,40}:|translation:|bản dịch[^:]{0,20}:)\s*/i, '');
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))) t = t.slice(1, -1);
  return t.trim();
}
function _emitUtterance(bufs) {
  if (!bufs || !bufs.length) return;
  try { send('gemini-audio', { b64: Buffer.concat(bufs).toString('base64'), sampleRate: 24000 }); }
  catch (e) {}
}

async function _connect() {
  const { GoogleGenAI, Modality } = await _sdk();
  const ai = new GoogleGenAI({ apiKey: String(state.apiKey).trim() });
  const myGen = ++_gen; _turns = 0;
  return ai.live.connect({
    model: MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: _voice() } } },
      systemInstruction: _sys(),
    },
    callbacks: {
      onopen:    () => console.log('[gemini-text-live] phiên mở (gen ' + myGen + ', voice ' + _voice() + ')'),
      onmessage: (m) => _onMessage(myGen, m),
      onerror:   (e) => console.warn('[gemini-text-live] ws error:', e && e.message),
      onclose:   () => { if (myGen === _gen) { _session = null; if (_inflight) _fail(); } },
    },
  });
}
async function _ensure() {
  if (!_started || !isConfigured()) return null;
  if (_session) return _session;
  if (_connecting) return _connecting;
  _connecting = (async () => {
    try { _session = await _connect(); }
    catch (e) { console.warn('[gemini-text-live] connect lỗi:', e && e.message); _session = null; send('gemini-status', { error: e && e.message }); }
    finally { _connecting = null; }
    return _session;
  })();
  return _connecting;
}
function _close() { const s = _session; _session = null; _gen++; if (s) { try { s.close(); } catch {} } }
function _fail() { const inf = _inflight; _inflight = null; if (inf) { clearTimeout(inf.timer); try { inf.resolve(null); } catch {} } setTimeout(() => _drain(), 0); }

function _onMessage(gen, m) {
  if (gen !== _gen) return;
  try {
    const sc = m && m.serverContent;
    const parts = (sc && sc.modelTurn && sc.modelTurn.parts) || (sc && sc.parts);
    if (parts && parts.length && _inflight) for (const p of parts) {
      const id = p && (p.inlineData || p.inline_data); const d = id && id.data;
      if (d) { try { _inflight.audio.push(Buffer.from(d, 'base64')); } catch {} if (!_audioLogged) { _audioLogged = true; console.log('[gemini-text-live] audio chunk ĐẦU'); } }
    }
    const ot = sc && sc.outputTranscription && sc.outputTranscription.text;
    if (ot && _inflight) _inflight.acc += ot;
    if (sc && sc.turnComplete && _inflight) {
      const inf = _inflight; _inflight = null; clearTimeout(inf.timer);
      if (state.geminiAudioOn !== false) _emitUtterance(inf.audio);
      try { inf.resolve(_clean(inf.acc)); } catch {}
      _turns++; if (_turns >= MAX_TURNS) _recNeeded = true;
      _maybeRecycle(); _drain();
    }
    if (m && m.goAway) { _recNeeded = true; _maybeRecycle(); }
  } catch (e) { console.warn('[gemini-text-live] msg lỗi:', e && e.message); }
}
async function _drain() {
  if (_draining || !_started || _inflight) return;
  _draining = true;
  try {
    while (_started && _queue.length && !_inflight) {
      const sess = await _ensure();
      if (!sess) break;
      const item = _queue.shift();
      _inflight = { resolve: item.resolve, text: item.text, acc: '', audio: [], timer: null };
      _inflight.timer = setTimeout(() => { console.warn('[gemini-text-live] turn timeout → reconnect'); _close(); _fail(); }, TURN_TIMEOUT_MS);
      try { sess.sendClientContent({ turns: [{ role: 'user', parts: [{ text: item.text }] }], turnComplete: true }); }
      catch (e) { console.warn('[gemini-text-live] send lỗi:', e && e.message); clearTimeout(_inflight.timer); _inflight = null; try { item.resolve(null); } catch {} _close(); }
    }
  } finally { _draining = false; }
}
function _scheduleRecycle() { clearTimeout(_recTimer); _recTimer = setTimeout(() => { _recNeeded = true; _maybeRecycle(); }, RECYCLE_MS); }
function _maybeRecycle() { if (!_recNeeded || !_started) return; if (_inflight || _queue.length) return; _recNeeded = false; _close(); _scheduleRecycle(); }

// ── API công khai ──
function translate(text) {
  if (!_started || !isConfigured()) return Promise.resolve(null);
  const t = (text || '').trim();
  if (!t) return Promise.resolve(null);
  return new Promise((resolve) => {
    _queue.push({ text: t, resolve });
    while (_queue.length > MAX_QUEUE) { const d = _queue.shift(); try { d.resolve(null); } catch {} }
    _drain();
  });
}
function start() {
  if (_started) return;
  if (!isConfigured()) { send('gemini-status', { error: 'no-key' }); return; }
  _started = true; _queue = []; _inflight = null; _recNeeded = false; _turns = 0;
  _scheduleRecycle();
  _ensure().catch(() => {});
  console.log('[gemini-text-live] start');
}
function stop() {
  _started = false;
  clearTimeout(_recTimer); _recTimer = null; _recNeeded = false;
  const q = _queue; _queue = [];
  for (const it of q) { try { it.resolve(null); } catch {} }
  if (_inflight) { clearTimeout(_inflight.timer); try { _inflight.resolve(null); } catch {} _inflight = null; }
  _close();
  send('gemini-clear');
  console.log('[gemini-text-live] stop');
}
// Đóng phiên NGAY (kể cả khi đang có turn chạy/hàng đợi) để giọng/đích mới áp tức thì.
// Turn đang chạy: re-queue text của nó (đầu hàng) để vẫn được dịch lại bằng giọng mới.
function _forceRecycle() {
  if (!_started) return;
  _recNeeded = false;
  const inf = _inflight; _inflight = null;
  if (inf) {
    clearTimeout(inf.timer);
    if (inf.text) _queue.unshift({ text: inf.text, resolve: inf.resolve });
    else { try { inf.resolve(null); } catch {} }
  }
  _close();            // tăng _gen → bỏ qua message phiên cũ; phiên mới sẽ đọc lại _voice()/_sys()
  _scheduleRecycle();
  setTimeout(() => _drain(), 0);
}
function onTargetLangChanged() { if (_started) _forceRecycle(); }   // đổi đích/giọng → nối lại áp config mới NGAY

module.exports = { isConfigured, isActive, translate, start, stop, onTargetLangChanged };
