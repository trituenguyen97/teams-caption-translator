/**
 * gemini-live.js — STT + Dịch + TTS qua Gemini 3.5 Live Translate (gemini-3.5-live-translate-preview).
 *
 * Audio-to-audio: app stream AUDIO (PCM16 16kHz) → model TỰ nhận ngôn ngữ nguồn, trả:
 *   • lời GỐC  = serverContent.inputTranscription.text
 *   • bản DỊCH = serverContent.outputTranscription.text
 *   • audio DỊCH (TTS) = serverContent.modelTurn.parts[].inlineData.data (PCM16 24kHz)
 *
 * CĂN SONG NGỮ theo TRỤC THỜI GIAN (T1C, lag-adaptive DP) — port từ extension/lib/gemini-live.js:
 * mỗi entry caption mang CẢ {original, translated} (ghép câu gốc↔câu dịch) → renderer hiển thị gốc+dịch theo layout.
 * Nói TRÙNG ngôn ngữ đích (không có bản dịch) → echo lời gốc làm bản dịch (_noTransTurn).
 * PHIÊN 2h: contextWindowCompression(slidingWindow) + sessionResumption + reconnect khi goAway/close. SDK ESM → dynamic import().
 */
const state = require('./state');
const { bcp47 } = require('./langs');

const MODEL = 'gemini-3.5-live-translate-preview';
const RECONNECT_MS = 1500;
const LONG_IDLE_MS = 2500;     // nghỉ ~2.5s không turnComplete → quét chốt nốt các cặp đã đủ dấu chấm
const PUMP_DEBOUNCE_MS = 350;  // gộp nhịp vẽ → UI bớt nhảy
const INPUT_GRACE_MS = 700;    // sau turnComplete chờ ~0.7s cho transcript về nốt
const TR_SENT_END = /[.!?。．！？]\s*$/;
const AUDIO_MAX_SAMPLES = (24000 * 3) | 0;     // trần an toàn 3s
const AUDIO_IDLE_MS = 250;                     // audio ngừng ~0.25s → phát nốt
const AUDIO_BREAK_GRACE_MS = 160;              // gặp dấu kết câu → chờ đuôi audio rồi phát
const TR_BREAK = /[.!?。．！？]/;

const send = (ch, data) => state.win && state.win.webContents && state.win.webContents.send(ch, data);
let _genaiMod = null;
async function _sdk() { return _genaiMod || (_genaiMod = await import('@google/genai')); }

function _f32ToPcm16B64(f32) {
  const buf = Buffer.allocUnsafe(f32.length * 2);
  for (let i = 0; i < f32.length; i++) { let s = f32[i]; if (s > 1) s = 1; else if (s < -1) s = -1; buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7FFF), i * 2); }
  return buf.toString('base64');
}
function _ts() { const d = new Date(), p = n => (n < 10 ? '0' : '') + n; return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

let _started = false, _session = null, _connecting = null, _gen = 0;
let _handle = null;
let _reconnectTimer = null, _emitTimer = null, _flushTimer = null, _pumpTimer = null;
let _lineBase = 1, _inAcc = '', _outAcc = '', _turnEnded = false;   // _lineBase=id hàng đầu của LƯỢT hiện tại
const _rowTs = {};   // id hàng → mốc thời gian (đặt 1 lần)
let _inT = [], _outT = [];   // mốc thời gian (ms) câu GỐC/DỊCH thứ k/j hoàn thành → neo căn T1C
const _emit = {};    // id → khoá nội dung đã gửi (chỉ vẽ lại hàng ĐỔI)
let _maxId = 0;
let _audioBuf = [], _audioSamples = 0, _audioIdleTimer = null, _audioBreakTimer = null;
let _noTransTurn = false;   // lượt nói trùng ngôn ngữ đích → echo lời gốc; reset mỗi lượt

function isConfigured() { return !!(state.apiKey && String(state.apiKey).trim()); }
function isActive() { return _started; }

// ── Tách câu kèm VỊ TRÍ kết thúc ──
function _splitPos(s) {
  s = s || ''; const out = []; let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '.') {
      if (/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '')) continue;   // số thập phân 3.14 → không ngắt
      let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;             // '.' giữa câu (sau là chữ thường) → không ngắt
      if (j < s.length && /\p{Ll}/u.test(s[j])) continue;
    }
    if (c === '.' || c === '!' || c === '?' || c === '。' || c === '！' || c === '？' || c === '．') {
      const seg = s.slice(start, i + 1).trim(); if (seg) out.push({ text: seg, end: i + 1 }); start = i + 1;
    }
  }
  const tail = s.slice(start).trim(); if (tail) out.push({ text: tail, end: s.length });
  return out;
}
function _splitVI(s) { return _splitPos(s).map(x => x.text); }
function _median(arr) { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
// CĂN nhiều-nhiều theo TRỤC THỜI GIAN (T1C, lag-adaptive). Cho phép 1:1/1:2/2:1/bỏ qua.
const _WIN = 3, _LAM = 0.6, _TSCALE = 0.01, _GAP = 24;
function _alignTimeRows(inSent, outSent, inT, outT, R) {
  const nIn = inSent.length, nOut = outSent.length; if (!nIn || !nOut) return [];
  const it = k => inT[k] || 0, ot = j => outT[j] || 0;
  const slen = (i, n) => { let s = 0; for (let k = 0; k < n; k++) s += inSent[i + k].text.length; return s; };
  const tlen = (j, n) => { let s = 0; for (let k = 0; k < n; k++) s += outSent[j + k].text.length; return s; };
  const lpen = (i, ti, j, tj) => _LAM * Math.abs(R * slen(i, ti) - tlen(j, tj));
  const tcost = (k, j, lag) => _TSCALE * Math.abs((it(k) + lag[k]) - ot(j));
  const nearestSeed = () => { const p = []; for (let k = 0; k < nIn; k++) { let bj = 0, bd = Infinity; for (let j = 0; j < nOut; j++) { const d = Math.abs(ot(j) - it(k)); if (d < bd) { bd = d; bj = j; } } p.push({ dt: ot(bj) - it(k) }); } return p; };
  const buildLag = seed => { const lag = new Array(nIn).fill(0); for (let k = 0; k < nIn; k++) { const lo = Math.max(0, k - _WIN), hi = Math.min(nIn - 1, k + _WIN); const w = []; for (let q = lo; q <= hi; q++) w.push(seed[q].dt); lag[k] = _median(w); } return lag; };
  const runDP = lag => {
    const INF = Infinity;
    const dp = Array.from({ length: nIn + 1 }, () => new Array(nOut + 1).fill(INF));
    const bk = Array.from({ length: nIn + 1 }, () => new Array(nOut + 1).fill(null));
    dp[0][0] = 0;
    for (let i = 0; i <= nIn; i++) for (let j = 0; j <= nOut; j++) {
      if (dp[i][j] === INF) continue; const base = dp[i][j];
      if (i < nIn && j < nOut) { const c = base + tcost(i, j, lag) + lpen(i, 1, j, 1); if (c < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = c; bk[i + 1][j + 1] = { pi: i, pj: j, ti: 1, tj: 1 }; } }
      if (i < nIn && j + 1 < nOut) { const c = base + tcost(i, j, lag) + lpen(i, 1, j, 2); if (c < dp[i + 1][j + 2]) { dp[i + 1][j + 2] = c; bk[i + 1][j + 2] = { pi: i, pj: j, ti: 1, tj: 2 }; } }
      if (i + 1 < nIn && j < nOut) { const c = base + tcost(i + 1, j, lag) + lpen(i, 2, j, 1); if (c < dp[i + 2][j + 1]) { dp[i + 2][j + 1] = c; bk[i + 2][j + 1] = { pi: i, pj: j, ti: 2, tj: 1 }; } }
      if (i < nIn) { const c = base + _GAP; if (c < dp[i + 1][j]) { dp[i + 1][j] = c; bk[i + 1][j] = { pi: i, pj: j, ti: 1, tj: 0 }; } }
      if (j < nOut) { const c = base + _GAP; if (c < dp[i][j + 1]) { dp[i][j + 1] = c; bk[i][j + 1] = { pi: i, pj: j, ti: 0, tj: 1 }; } }
    }
    const mv = []; let i = nIn, j = nOut; while (i > 0 || j > 0) { const m = bk[i][j]; if (!m) break; mv.push(m); i = m.pi; j = m.pj; } mv.reverse(); return mv;
  };
  const lagFromMoves = (moves, seed) => {
    const d = new Array(nIn).fill(null);
    for (const m of moves) { if (m.ti >= 1 && m.tj >= 1) { const kk = m.pi + m.ti - 1, jj = m.pj; d[kk] = ot(jj) - it(kk); } }
    const f = d.slice(); let last = _median(seed.map(p => p.dt)); for (let k = 0; k < nIn; k++) { if (f[k] === null) f[k] = last; else last = f[k]; }
    const out = new Array(nIn).fill(0); for (let k = 0; k < nIn; k++) { const lo = Math.max(0, k - _WIN), hi = Math.min(nIn - 1, k + _WIN); const w = []; for (let q = lo; q <= hi; q++) w.push(f[q]); out[k] = _median(w); } return out;
  };
  let seed = nearestSeed(); let lag = buildLag(seed); let moves = runDP(lag); lag = lagFromMoves(moves, seed); moves = runDP(lag);
  const rows = [];
  for (const m of moves) {
    const o = inSent.slice(m.pi, m.pi + m.ti).map(s => s.text).join(' ').trim();
    const t = outSent.slice(m.pj, m.pj + m.tj).map(s => s.text).join(' ').trim();
    if (m.ti === 0) { if (rows.length) rows[rows.length - 1].t = (rows[rows.length - 1].t + ' ' + t).trim(); else rows.push({ o: '', t }); }
    else rows.push({ o, t });
  }
  return rows;
}
// Gom transcript bền vững: model 3.x có thể trả BẢN ĐẦY ĐỦ tích luỹ → next bao trùm prev ⇒ THAY; ngược lại NỐI.
function _mergeTrans(prev, next) {
  if (!next) return prev;
  if (!prev || next.startsWith(prev)) return next;
  return prev + next;
}
function _norm(s) { return (s || '').replace(/[\s。、，．！？!?.,]+/g, '').toLowerCase(); }
function _doneCount(s) { s = (s || '').trim(); if (!s) return 0; const segs = _splitVI(s); return TR_SENT_END.test(s) ? segs.length : Math.max(0, segs.length - 1); }
// Gửi 1 entry song ngữ (lines=[{o,t}]); dedupe khi gốc≈dịch (nói tiếng đích).
function _emitCaption(id, lines, turnDone, ts) {
  lines = lines.map(l => { let o = (l.o || '').trim(); const tt = (l.t || '').trim(); if (o && tt && _norm(o) === _norm(tt)) o = ''; return { o, t: tt }; }).filter(l => l.o || l.t);
  if (!lines.length) return false;
  const original = lines.map(l => l.o).filter(Boolean).join('\n');
  const translated = lines.map(l => l.t).filter(Boolean).join('\n');
  send('caption-live', { id, author: 'STT', lines, original, translated, isPartial: !turnDone, ts: ts || _ts(), tsMs: Date.now() });
  return true;
}
// Filler/aizuchi GỐC (はい/yes/ok…) hay bị dịch tràn vế trước → đẩy nội dung về hàng trước, giữ câu filler.
const _SRC_FILLER = /^((はい+|ええ+|うん+|うー?ん|そう(ですね|ですよね|か)?|です(ね|よね)|でしょう(ね)?|なるほど|オッケー|おっけー|あの+|えー?と|へえ+|ふ[んー]+|おお+|yes|yeah|ok(ay)?|right|mm+|uh+|um+)[。、,.!?！？\s]*)+$/iu;
function _isFillerSrc(o) { const s = (o || '').replace(/\s+/g, ''); return !!s && _SRC_FILLER.test(s); }
const _VI_FILLER = /^((vâng|dạ|ừ|ờ|được|rồi|ok(ay)?|à|ạ|ờm|um+|đúng vậy|đúng rồi|đúng)[\s,.!?]*)+$/i;
function _fillerPostproc(rows) {
  for (let i = 1; i < rows.length; i++) {
    if (!_isFillerSrc(rows[i].o)) continue;
    const ts = _splitVI(rows[i].t);
    const con = ts.filter(x => !_VI_FILLER.test(x.trim()));
    if (!con.length) continue;
    const fil = ts.filter(x => _VI_FILLER.test(x.trim()));
    rows[i - 1].t = (rows[i - 1].t + ' ' + con.join(' ')).trim();
    rows[i].t = fil.join(' ');
  }
  return rows;
}
function _mergeEmptyRows(rows, turnEnd) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], emptyT = r.o && !(r.t && r.t.trim()), lastOne = i === rows.length - 1;
    if (emptyT && out.length && (!lastOne || turnEnd)) out[out.length - 1].o = (out[out.length - 1].o + ' ' + r.o).trim();
    else out.push({ o: r.o, t: r.t });
  }
  return out;
}
function _tHasContent(t) { const segs = _splitVI(t || ''); return segs.length ? segs.some(s => !_VI_FILLER.test(s.trim())) : false; }
function _emitRow(id, o, t, partial) {
  o = o || ''; t = t || '';
  const key = o + '' + t + '' + (partial ? '1' : '0');
  if (_emit[id] === key) return;
  _emit[id] = key; if (id > _maxId) _maxId = id;
  if (!_rowTs[id]) _rowTs[id] = _ts();
  _emitCaption(id, [{ o, t }], !partial, _rowTs[id]);
}
function _trimRowsFrom(fromId) {
  for (let id = fromId; id <= _maxId; id++) { if (_emit[id] !== undefined) { delete _emit[id]; delete _rowTs[id]; send('caption-live', { id, remove: true }); } }
  if (fromId - 1 < _maxId) _maxId = fromId - 1;
}
// ── CĂN T1C: re-render toàn cục mỗi lần đổi, chỉ gửi hàng ĐỔI. Câu chưa đủ dấu chấm → dòng LIVE preview ──
function _schedulePump() { if (_pumpTimer) return; _pumpTimer = setTimeout(() => { _pumpTimer = null; _pump(false); }, PUMP_DEBOUNCE_MS); }
function _pump(final) {
  clearTimeout(_pumpTimer); _pumpTimer = null;
  const turnEnd = final && _turnEnded;
  const inSent = _splitPos(_inAcc);
  const outSent = _splitPos(_outAcc);
  const jaDone = _doneCount(_inAcc);
  const viDone = _doneCount(_outAcc);
  const nIn = turnEnd ? inSent.length : jaDone;
  const nOut = turnEnd ? outSent.length : viDone;
  const _now = Date.now();
  for (let k = 0; k < nIn; k++) if (_inT[k] === undefined) _inT[k] = _now;
  for (let j = 0; j < nOut; j++) if (_outT[j] === undefined) _outT[j] = _now;
  let rows;
  if (nIn > 0 && nOut > 0) {
    _noTransTurn = false;   // CÓ bản dịch → không phải lượt trùng ngôn ngữ
    rows = _fillerPostproc(_alignTimeRows(inSent.slice(0, nIn), outSent.slice(0, nOut), _inT, _outT, _outAcc.length / Math.max(1, _inAcc.length)));
    rows = rows.filter(r => !(_isFillerSrc(r.o) && !_tHasContent(r.t)));   // ẩn BACK-CHANNEL: gốc filler mà dịch rỗng (はい→Vâng)
    rows = _mergeEmptyRows(rows, turnEnd);
  } else if (nIn > 0 && (final || _noTransTurn)) {   // có GỐC nhưng KHÔNG có dịch (nói trùng ngôn ngữ đích) → echo lời gốc
    _noTransTurn = true;
    rows = inSent.slice(0, nIn).map(s => ({ o: '', t: s.text }));
  } else rows = [];
  for (let i = 0; i < rows.length; i++) _emitRow(_lineBase + i, rows[i].o, rows[i].t, false);
  let nextId = _lineBase + rows.length;
  if (!turnEnd) {   // dòng LIVE: câu chưa đủ dấu chấm
    const oPrev = inSent.slice(nIn).map(s => s.text).join('\n').trim();
    const tPrev = outSent.slice(nOut).map(s => s.text).join('\n').trim();
    if (oPrev || tPrev) { _emitRow(nextId, oPrev, tPrev, true); nextId++; }
  }
  _trimRowsFrom(nextId);
  if (turnEnd) { _lineBase += rows.length; _inAcc = ''; _outAcc = ''; _inT = []; _outT = []; _turnEnded = false; _clearTurn(); }
}
function _flush() { clearTimeout(_emitTimer); clearTimeout(_flushTimer); _pump(true); }
function _clearTurn() { for (const k in _emit) delete _emit[k]; for (const k in _rowTs) delete _rowTs[k]; _maxId = _lineBase - 1; _noTransTurn = false; }
function _endTurnHard() { _lineBase = _maxId + 1; _inAcc = ''; _outAcc = ''; _inT = []; _outT = []; _turnEnded = false; _clearTurn(); }

// ── Audio TTS: gom ~0.4s rồi phát trọn 1 lần (Node Buffer) ──
function _flushAudio(reason) {
  clearTimeout(_audioIdleTimer); _audioIdleTimer = null;
  clearTimeout(_audioBreakTimer); _audioBreakTimer = null;
  if (!_audioBuf.length) return;
  const b64 = Buffer.concat(_audioBuf).toString('base64');
  _audioBuf = []; _audioSamples = 0;
  send('gemini-audio', { b64, sampleRate: 24000 });
}
function _bufAudio(b64) {
  const b = Buffer.from(b64, 'base64');
  _audioBuf.push(b); _audioSamples += b.length >> 1;
  if (_audioSamples >= AUDIO_MAX_SAMPLES) { _flushAudio('max'); return; }
  clearTimeout(_audioIdleTimer);
  _audioIdleTimer = setTimeout(() => _flushAudio('idle'), AUDIO_IDLE_MS);
}
function _audioBreakOnText() {
  const s = (_outAcc || '').replace(/\s+$/, '');
  if (!s) return;
  const c = s[s.length - 1];
  if (!TR_BREAK.test(c)) return;
  if ((c === '.' || c === ',') && /\d/.test(s[s.length - 2] || '')) return;
  if (!_audioBuf.length) return;
  clearTimeout(_audioBreakTimer);
  _audioBreakTimer = setTimeout(() => _flushAudio('break'), AUDIO_BREAK_GRACE_MS);
}
function _resetAudio() { clearTimeout(_audioIdleTimer); _audioIdleTimer = null; clearTimeout(_audioBreakTimer); _audioBreakTimer = null; _audioBuf = []; _audioSamples = 0; }

function _onMessage(gen, m) {
  if (gen !== _gen) return;
  try {
    if (m.sessionResumptionUpdate && m.sessionResumptionUpdate.resumable && m.sessionResumptionUpdate.newHandle) _handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) { console.log('[live-translate] goAway → reconnect (resume)'); _reconnectWithHandle(); return; }
    const sc = m.serverContent;
    if (!sc) return;
    let changed = false;
    const itText = sc.inputTranscription && sc.inputTranscription.text;    // lời GỐC
    const otText = sc.outputTranscription && sc.outputTranscription.text;   // bản DỊCH
    if (typeof itText === 'string' && itText) { const mg = _mergeTrans(_inAcc, itText); if (mg !== _inAcc) { _inAcc = mg; changed = true; } }
    if (typeof otText === 'string' && otText) { const mg = _mergeTrans(_outAcc, otText); if (mg !== _outAcc) { _outAcc = mg; changed = true; } }
    const parts = (sc.modelTurn && sc.modelTurn.parts) || sc.parts;
    if (parts && state.geminiAudioOn !== false) {
      for (const p of parts) { const id = p && (p.inlineData || p.inline_data); const d = id && id.data; if (d) _bufAudio(d); }
    }
    if (changed) {
      _schedulePump();
      clearTimeout(_flushTimer); _flushTimer = setTimeout(() => _pump(true), _turnEnded ? INPUT_GRACE_MS : LONG_IDLE_MS);
      if (state.geminiAudioOn !== false) _audioBreakOnText();
    }
    if (sc.turnComplete) { _turnEnded = true; clearTimeout(_flushTimer); _flushTimer = setTimeout(() => _pump(true), INPUT_GRACE_MS); _flushAudio('turn'); }
  } catch (e) { console.warn('[live-translate] msg lỗi:', e && e.message); }
}

async function _connect() {
  const { GoogleGenAI, Modality } = await _sdk();
  const ai = new GoogleGenAI({ apiKey: String(state.apiKey).trim() });
  const myGen = ++_gen;
  const config = {
    responseModalities: [Modality.AUDIO],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    // echoTargetLanguage:false → model im lặng khi audio đã ở ngôn ngữ đích (cắt feedback TTS↔mic). Nói trùng đích → echo ở _pump.
    translationConfig: { targetLanguageCode: bcp47(state.langCode), echoTargetLanguage: false },
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: _handle ? { handle: _handle } : {},
  };
  // Giọng đọc TTS (speechConfig áp cho cả engine dịch). Đổi giọng → onTargetLangChanged() reconnect áp ngay.
  if (state.geminiVoice) config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: state.geminiVoice } } };
  return ai.live.connect({
    model: MODEL,
    config,
    callbacks: {
      onopen: () => console.log('[live-translate] phiên mở (gen ' + myGen + ', →' + bcp47(state.langCode) + (_handle ? ', resume' : '') + ')'),
      onmessage: (m) => _onMessage(myGen, m),
      onerror: (e) => console.warn('[live-translate] ws error:', e && e.message),
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
    catch (e) { console.warn('[live-translate] connect lỗi:', e && e.message); _session = null; send('gemini-status', { error: e && e.message }); if (_started) _scheduleReconnect(); }
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
  if (!isConfigured()) { send('gemini-status', { error: 'no-key' }); return; }
  // KHÔNG reset _lineBase: id phải TĂNG ĐƠN ĐIỆU xuyên start/stop (renderer chỉ xoá list khi bấm Clear).
  _started = true; _handle = null; _inAcc = ''; _outAcc = ''; _inT = []; _outT = []; _clearTurn(); _resetAudio();
  _ensure().catch(() => {});
  console.log('[live-translate] start');
}
function stop() {
  _started = false;
  clearTimeout(_reconnectTimer); clearTimeout(_emitTimer); clearTimeout(_flushTimer); clearTimeout(_pumpTimer);
  if (_inAcc || _outAcc) { _turnEnded = true; _flush(); }   // chốt nốt phần đang dở
  _endTurnHard(); _handle = null; _resetAudio();
  _closeSession();
  send('gemini-clear');
  console.log('[live-translate] stop');
}
function onTargetLangChanged() { if (_started) { _handle = null; _endTurnHard(); clearTimeout(_emitTimer); clearTimeout(_flushTimer); clearTimeout(_pumpTimer); _resetAudio(); _closeSession(); _ensure().catch(() => {}); } }   // đổi đích/giọng → phiên mới
function setAudioOn(on) { state.geminiAudioOn = !!on; if (!on) { _resetAudio(); send('gemini-clear'); } }

// Validate API key (zero-cost: ListModels). Trả { ok } | { ok:false, error }.
async function validateKey(key) {
  const k = String(key || '').trim();
  if (!k) return { ok: false, error: 'empty' };
  try {
    const { GoogleGenAI } = await _sdk();
    const ai = new GoogleGenAI({ apiKey: k });
    const pager = await ai.models.list();
    for await (const _m of pager) break;
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, error: /api[_ ]?key|invalid|400|401|403/i.test(msg) ? 'invalid' : msg };
  }
}

module.exports = { isConfigured, isActive, pushAudio, start, stop, onTargetLangChanged, setAudioOn, validateKey };
