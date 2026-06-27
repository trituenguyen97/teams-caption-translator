// gemini-live.js (browser ESM) — port của src/gemini-live.js cho extension.
// Audio-to-audio Gemini 3.5 Live Translate: PCM16 16kHz vào → STT + dịch + TTS ra.
// Khác bản Electron: bỏ IPC, thay bằng callbacks; bỏ Node Buffer, dùng base64 helper trình duyệt.
import { GoogleGenAI, Modality } from './genai.mjs';
import { bcp47 } from './langs.js';

const MODEL = 'gemini-3.5-live-translate-preview';
const RECONNECT_MS = 1500;
const LONG_IDLE_MS = 2500;     // nghỉ ~2.5s không có turnComplete → quét lại để chốt nốt các cặp đã đủ dấu chấm (KHÔNG ép ngắt câu đang dở)
const INPUT_GRACE_MS = 700;    // sau turnComplete chờ ~0.7s cho transcript về nốt rồi mới chốt hẳn câu cuối
const TR_SENT_END = /[.!?。．！？]\s*$/;   // chuỗi KẾT THÚC bằng dấu kết câu → câu đã trọn (khớp _splitVI)
// Phát TTS THEO CÂU: gom audio tới khi BẢN DỊCH gặp dấu KẾT CÂU ( . ! ? ) — hoặc audio nghỉ — rồi phát cả câu → "đủ câu mới đọc".
const AUDIO_MAX_SAMPLES = (24000 * 3) | 0;     // trần an toàn 3s: không gặp dấu kết câu/nghỉ vẫn phát (chống kẹt)
const AUDIO_IDLE_MS = 250;                     // audio ngừng ~0.25s (model nghỉ cuối câu) → phát nốt
const AUDIO_BREAK_GRACE_MS = 160;              // gặp dấu kết câu → chờ chút cho đuôi audio của câu tới rồi phát
const TR_BREAK = /[.!?。．！？]/;                // KẾT CÂU (khớp _splitVI); KHÔNG gồm phẩy → đọc trọn câu. Ngoại lệ . kẹp số (thập phân) xử lý trong _audioBreakOnText

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
  let _lineBase = 1, _inAcc = '', _outAcc = '', _turnEnded = false;   // _lineBase=id hàng đầu của LƯỢT hiện tại
  const _rowTs = {};   // id hàng → mốc thời gian (đặt 1 lần → "dòng thời gian" cố định)
  let _oAnch = [];     // [{il,ol}] NEO: lúc 1 mảnh DỊCH về thì input đã tới il ký tự, output tới ol → căn câu gốc↔dịch theo tương quan này (S6)
  const _emit = {};    // id → khoá nội dung đã gửi (chỉ vẽ lại hàng nào ĐỔI)
  let _maxId = 0;      // id cao nhất đang hiện trong LƯỢT (để xoá hàng thừa khi DP gộp lại còn ít hàng hơn)
  let _audioBuf = [], _audioSamples = 0, _audioIdleTimer = null, _audioBreakTimer = null;

  const isConfigured = () => !!(st().apiKey && String(st().apiKey).trim());

  // ── Tách câu kèm VỊ TRÍ kết thúc (end exclusive) — để neo char-anchor (S6) ──
  function _splitPos(s) {
    s = s || ''; const out = []; let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '.') {
        if (/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '')) continue;   // số thập phân: 3.14 → không ngắt
        let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;             // dấu '.' chèn GIỮA câu do STT (phía sau là CHỮ THƯỜNG) → không ngắt
        if (j < s.length && /\p{Ll}/u.test(s[j])) continue;                     // đầu câu THẬT luôn viết hoa → chỉ ngắt khi sau dấu chấm là chữ hoa/hết chuỗi
      }
      if (c === '.' || c === '!' || c === '?' || c === '。' || c === '！' || c === '？' || c === '．') {
        const seg = s.slice(start, i + 1).trim(); if (seg) out.push({ text: seg, end: i + 1 }); start = i + 1;
      }
    }
    const tail = s.slice(start).trim(); if (tail) out.push({ text: tail, end: s.length });
    return out;
  }
  function _splitVI(s) { return _splitPos(s).map(x => x.text); }
  // NEO câu gốc k → vị trí ký tự trong bản DỊCH: lúc input chạm hết câu gốc k (C ký tự) thì output đã tới đâu (ol).
  function _anchors(inSent, nIn) {
    const a = [];
    for (let k = 0; k < nIn; k++) { const C = inSent[k].end; let ol = _outAcc.length; for (const an of _oAnch) { if (an.il >= C) { ol = an.ol; break; } } a.push(ol); }
    return a;
  }
  // CĂN nhiều-nhiều bằng DP (S6): tối thiểu Σ|neo(gốc) − vị-trí-kết(dịch)|, cho phép 1:1, 1:2, 2:1, bỏ qua. → rows [{o,t}].
  function _alignRows(a, b, inSent, outSent) {
    const nIn = a.length, nOut = b.length, INF = Infinity, gap = 300;
    const dp = Array.from({ length: nIn + 1 }, () => new Array(nOut + 1).fill(INF));
    const bk = Array.from({ length: nIn + 1 }, () => new Array(nOut + 1).fill(null));
    dp[0][0] = 0;
    for (let i = 0; i <= nIn; i++) for (let j = 0; j <= nOut; j++) {
      if (dp[i][j] === INF) continue; const base = dp[i][j];
      if (i < nIn && j < nOut) { const c = base + Math.abs(a[i] - b[j]); if (c < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = c; bk[i + 1][j + 1] = { pi: i, pj: j, ti: 1, tj: 1 }; } }
      if (i < nIn && j + 1 < nOut) { const c = base + Math.abs(a[i] - b[j + 1]); if (c < dp[i + 1][j + 2]) { dp[i + 1][j + 2] = c; bk[i + 1][j + 2] = { pi: i, pj: j, ti: 1, tj: 2 }; } }
      if (i + 1 < nIn && j < nOut) { const c = base + Math.abs(a[i + 1] - b[j]); if (c < dp[i + 2][j + 1]) { dp[i + 2][j + 1] = c; bk[i + 2][j + 1] = { pi: i, pj: j, ti: 2, tj: 1 }; } }
      if (i < nIn) { const c = base + gap; if (c < dp[i + 1][j]) { dp[i + 1][j] = c; bk[i + 1][j] = { pi: i, pj: j, ti: 1, tj: 0 }; } }
      if (j < nOut) { const c = base + gap; if (c < dp[i][j + 1]) { dp[i][j + 1] = c; bk[i][j + 1] = { pi: i, pj: j, ti: 0, tj: 1 }; } }
    }
    const moves = []; let i = nIn, j = nOut; while (i > 0 || j > 0) { const m = bk[i][j]; if (!m) break; moves.push(m); i = m.pi; j = m.pj; } moves.reverse();
    const rows = [];
    for (const m of moves) {
      const o = inSent.slice(m.pi, m.pi + m.ti).map(s => s.text).join(' ').trim();
      const t = outSent.slice(m.pj, m.pj + m.tj).map(s => s.text).join(' ').trim();
      if (m.ti === 0) { if (rows.length) rows[rows.length - 1].t = (rows[rows.length - 1].t + ' ' + t).trim(); else rows.push({ o: '', t }); }
      else rows.push({ o, t });
    }
    return rows;
  }
  // Gom transcript BỀN VỮNG: model 3.x có thể gửi BẢN ĐẦY ĐỦ tích luỹ (không phải delta thuần) → cứ "+=" sẽ LẶP.
  // next bao trùm prev (là prefix mở rộng / hoặc y hệt) ⇒ THAY; ngược lại coi là delta ⇒ NỐI. An toàn cho cả 2 kiểu.
  function _mergeTrans(prev, next) {
    if (!next) return prev;
    if (!prev || next.startsWith(prev)) return next;
    return prev + next;
  }
  // So sánh đã-chuẩn-hoá để dedupe khi lời gốc ≈ bản dịch (người nói đúng ngôn ngữ đích → khỏi hiện 2 dòng trùng).
  function _norm(s) { return (s || '').replace(/[\s。、，．！？!?.,]+/g, '').toLowerCase(); }
  // Đếm câu HOÀN CHỈNH (đã có dấu kết câu); câu cuối chưa có dấu chấm → CHƯA tính (không tự ngắt khi chưa có dấu chấm).
  function _doneCount(s) { s = (s || '').trim(); if (!s) return 0; const segs = _splitVI(s); return TR_SENT_END.test(s) ? segs.length : Math.max(0, segs.length - 1); }
  // Gửi 1 entry song ngữ (lines = [{o,t}]); dedupe khi gốc≈dịch (nói tiếng đích). ts cố định theo hàng (giữ "dòng thời gian").
  function _send(id, lines, turnDone, ts) {
    lines = lines.map(l => { let o = (l.o || '').trim(); const tt = (l.t || '').trim(); if (o && tt && _norm(o) === _norm(tt)) o = ''; return { o, t: tt }; }).filter(l => l.o || l.t);
    if (!lines.length) return false;
    const original = lines.map(l => l.o).filter(Boolean).join('\n');
    const translated = lines.map(l => l.t).filter(Boolean).join('\n');
    onCaption({ id, author: 'STT', lines, original, translated, isPartial: !turnDone, ts: ts || _ts(), tsMs: Date.now() });
    return true;
  }
  // Vẽ 1 hàng — chỉ khi nội dung ĐỔI (change-detect) → khỏi vẽ lại hàng đã ổn định.
  function _emitRow(id, o, t, partial) {
    o = o || ''; t = t || '';
    const key = o + '' + t + '' + (partial ? '1' : '0');
    if (_emit[id] === key) return;
    _emit[id] = key; if (id > _maxId) _maxId = id;
    if (!_rowTs[id]) _rowTs[id] = _ts();
    _send(id, [{ o, t }], !partial, _rowTs[id]);
  }
  // Xoá hàng từ fromId trở lên (khi DP gộp lại còn ÍT hàng hơn, hoặc dòng LIVE biến mất) → tránh "hàng ma".
  function _trimRowsFrom(fromId) {
    for (let id = fromId; id <= _maxId; id++) { if (_emit[id] !== undefined) { delete _emit[id]; delete _rowTs[id]; onCaption({ id, remove: true }); } }
    if (fromId - 1 < _maxId) _maxId = fromId - 1;
  }
  // ── CĂN S6 (char-anchor DP) ── re-render TOÀN CỤC mỗi lần thay đổi, chỉ gửi hàng nào đổi. Trạng thái cuối == căn DP offline (~90% JA / ~95% EN).
  // Mỗi câu gốc hoàn chỉnh được NEO vào bản dịch theo il/ol; DP ghép nhiều-nhiều. Câu chưa đủ dấu chấm → dòng LIVE preview (mờ).
  function _pump(final) {
    const transcribe = !!st().transcribeMode;
    const turnEnd = final && _turnEnded;
    const inSent = _splitPos(_inAcc);
    const outSent = transcribe ? inSent : _splitPos(_outAcc);
    const jaDone = _doneCount(_inAcc);
    const viDone = transcribe ? jaDone : _doneCount(_outAcc);
    const nIn = turnEnd ? inSent.length : jaDone;
    const nOut = turnEnd ? outSent.length : viDone;
    let rows;
    if (transcribe) rows = inSent.slice(0, nIn).map(s => ({ o: '', t: s.text }));   // chép lời: mỗi câu gốc 1 hàng
    else if (nIn > 0 && nOut > 0) rows = _alignRows(_anchors(inSent, nIn), outSent.slice(0, nOut).map(s => s.end), inSent.slice(0, nIn), outSent.slice(0, nOut));
    else rows = [];
    for (let i = 0; i < rows.length; i++) _emitRow(_lineBase + i, transcribe ? '' : rows[i].o, rows[i].t, false);
    let nextId = _lineBase + rows.length;
    if (!turnEnd) {   // dòng LIVE: câu chưa đủ dấu chấm (gốc/dịch còn dở) → 1 hàng partial, xuống dòng theo câu
      const oPrev = transcribe ? '' : inSent.slice(nIn).map(s => s.text).join('\n').trim();
      const tPrev = (transcribe ? inSent : outSent).slice(nOut).map(s => s.text).join('\n').trim();
      if (oPrev || tPrev) { _emitRow(nextId, oPrev, tPrev, true); nextId++; }
    }
    _trimRowsFrom(nextId);
    if (turnEnd) { _lineBase += rows.length; _inAcc = ''; _outAcc = ''; _oAnch = []; _turnEnded = false; _clearTurn(); }
  }
  function _flush() { clearTimeout(_emitTimer); clearTimeout(_flushTimer); _pump(true); }
  function _clearTurn() { for (const k in _emit) delete _emit[k]; for (const k in _rowTs) delete _rowTs[k]; _maxId = _lineBase - 1; }
  // Đóng CỨNG lượt (stop / đổi ngôn ngữ giữa lượt): nhảy id qua mọi hàng đã hiện để KHỎI đè lượt mới, reset trạng thái.
  function _endTurnHard() { _lineBase = _maxId + 1; _inAcc = ''; _outAcc = ''; _oAnch = []; _turnEnded = false; _clearTurn(); }

  // ── Audio TTS: gom ~0.4s rồi phát trọn 1 lần ──
  function _flushAudio(reason) {
    clearTimeout(_audioIdleTimer); _audioIdleTimer = null;
    clearTimeout(_audioBreakTimer); _audioBreakTimer = null;
    if (!_audioBuf.length) return;
    let total = 0; for (const b of _audioBuf) total += b.length;
    const merged = new Uint8Array(total); let off = 0;
    for (const b of _audioBuf) { merged.set(b, off); off += b.length; }
    // DEBUG: 'break'=đủ câu (text kết câu) | 'idle'=model nghỉ | 'turn'=hết lượt | 'max'=trần 3s. text tail cho thấy lúc phát text đã đủ câu chưa.
    console.log(`[tts] phát (${reason || '?'}) ${((total >> 1) / 24000).toFixed(2)}s | text: "…${(_outAcc || '').slice(-45)}"`);
    _audioBuf = []; _audioSamples = 0;
    onAudio({ b64: _bytesToB64(merged), sampleRate: 24000 });
  }
  function _bufAudio(b64) {
    const bytes = _b64ToBytes(b64);
    _audioBuf.push(bytes); _audioSamples += bytes.length >> 1;
    if (_audioSamples >= AUDIO_MAX_SAMPLES) { _flushAudio('max'); return; }   // trần an toàn 3s
    clearTimeout(_audioIdleTimer);
    _audioIdleTimer = setTimeout(() => _flushAudio('idle'), AUDIO_IDLE_MS);   // nghỉ tự nhiên (cuối câu) → phát nốt
  }
  // Khi BẢN DỊCH chạm dấu ngắt (không phải . , kẹp số thập phân/tiền) → hẹn phát CỤM audio đã gom.
  function _audioBreakOnText() {
    const s = (_outAcc || '').replace(/\s+$/, '');
    if (!s) return;
    const c = s[s.length - 1];
    if (!TR_BREAK.test(c)) return;
    if ((c === '.' || c === ',') && /\d/.test(s[s.length - 2] || '')) return;   // . , kẹp số → chưa chắc ngắt → đợi ký tự kế
    if (!_audioBuf.length) return;
    clearTimeout(_audioBreakTimer);
    _audioBreakTimer = setTimeout(() => _flushAudio('break'), AUDIO_BREAK_GRACE_MS);
  }
  function _resetAudio() { clearTimeout(_audioIdleTimer); _audioIdleTimer = null; clearTimeout(_audioBreakTimer); _audioBreakTimer = null; _audioBuf = []; _audioSamples = 0; }

  function _onMessage(gen, m) {
    if (gen !== _gen) return;
    try {
      if (m.sessionResumptionUpdate && m.sessionResumptionUpdate.resumable && m.sessionResumptionUpdate.newHandle) _handle = m.sessionResumptionUpdate.newHandle;
      if (m.goAway) { console.log('[live] goAway → reconnect'); _reconnectWithHandle(); return; }
      const sc = m.serverContent;
      if (!sc) return;
      const transcribe = !!st().transcribeMode;
      let changed = false;
      const itText = sc.inputTranscription && sc.inputTranscription.text;    // lời GỐC
      const otText = sc.outputTranscription && sc.outputTranscription.text;   // bản DỊCH
      if (typeof itText === 'string' && itText) { const mg = _mergeTrans(_inAcc, itText); if (mg !== _inAcc) { _inAcc = mg; changed = true; } }
      if (!transcribe && typeof otText === 'string' && otText) { const mg = _mergeTrans(_outAcc, otText); if (mg !== _outAcc) { _outAcc = mg; changed = true; _oAnch.push({ il: _inAcc.length, ol: _outAcc.length }); } }   // NEO: mảnh dịch về lúc input đã tới il
      const parts = (sc.modelTurn && sc.modelTurn.parts) || sc.parts;
      if (!transcribe && parts && st().geminiAudioOn !== false) {
        for (const p of parts) { const id = p && (p.inlineData || p.inline_data); const d = id && id.data; if (d) _bufAudio(d); }
      }
      if (changed) {
        _pump(false);   // chốt ngay các CẶP đã hoàn chỉnh cả 2 phía + hiển thị partial cặp đang dở
        // chốt nốt phần dư (lệch số câu / câu cuối dở) khi NGHỈ hẳn hoặc HẾT lượt
        clearTimeout(_flushTimer); _flushTimer = setTimeout(() => _pump(true), _turnEnded ? INPUT_GRACE_MS : LONG_IDLE_MS);
        if (!transcribe && st().geminiAudioOn !== false) _audioBreakOnText();
      }
      if (sc.turnComplete) { _turnEnded = true; clearTimeout(_flushTimer); _flushTimer = setTimeout(() => _pump(true), INPUT_GRACE_MS); _flushAudio('turn'); }   // hết lượt → chốt text + phát nốt audio còn lại
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
    // Giọng đọc đầu ra — docs xác nhận LiveConnectConfig.speechConfig áp dụng cho cả engine dịch.
    // Đổi giọng → onVoiceChanged() mở phiên mới với voiceName mới.
    if (!st().transcribeMode && st().geminiVoice) {
      config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: st().geminiVoice } } };
    }
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
    _started = true; _handle = null; _inAcc = ''; _outAcc = ''; _oAnch = []; _clearTurn(); _resetAudio();
    _ensure().catch(() => {});
    console.log('[live] start');
  }
  function stop() {
    _started = false;
    clearTimeout(_reconnectTimer); clearTimeout(_emitTimer); clearTimeout(_flushTimer);
    if (_inAcc || _outAcc) { _turnEnded = true; _flush(); }   // chốt nốt phần đang dở trước khi dừng
    _endTurnHard(); _handle = null; _resetAudio();
    _closeSession();
    onClear();
    console.log('[live] stop');
  }
  function onTargetLangChanged() { if (_started) { _handle = null; _endTurnHard(); clearTimeout(_emitTimer); clearTimeout(_flushTimer); _resetAudio(); _closeSession(); _ensure().catch(() => {}); } }
  function onTranscribeModeChanged() { onTargetLangChanged(); }
  function onVoiceChanged() {   // đổi giọng → mở PHIÊN MỚI (bỏ resume) để áp dụng speechConfig giọng mới ngay
    if (!_started) return;
    _handle = null; _resetAudio(); _closeSession(); _ensure().catch(() => {});
  }
  function setAudioOn(on) { if (!on) { _resetAudio(); onClear(); } }
  const isActive = () => _started;

  return { isConfigured, isActive, pushAudio, start, stop, onTargetLangChanged, onTranscribeModeChanged, onVoiceChanged, setAudioOn };
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
