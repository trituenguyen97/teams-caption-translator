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
  let _lineBase = 1, _inAcc = '', _outAcc = '', _turnEnded = false, _jaCut = 0, _viCut = 0;   // _lineBase=id hàng kế tiếp; _jaCut/_viCut=số ký tự GỐC/DỊCH đã chốt&nuốt (phần đã commit, khỏi đụng lại)
  const _rowTs = {};   // id hàng → mốc thời gian (đặt 1 lần → "dòng thời gian" cố định)
  let _audioBuf = [], _audioSamples = 0, _audioIdleTimer = null, _audioBreakTimer = null;

  const isConfigured = () => !!(st().apiKey && String(st().apiKey).trim());

  // ── Tách câu kèm VỊ TRÍ kết thúc (end exclusive) — để NUỐT chính xác phần đã chốt ──
  function _splitPos(s) {
    s = s || ''; const out = []; let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '.') {
        if (/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '')) continue;   // số thập phân: 3.14 → không ngắt
        let j = i + 1; while (j < s.length && s[j] === ' ') j++;                 // dấu '.' chèn GIỮA câu do STT (phía sau là CHỮ THƯỜNG) → không ngắt
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
  // Re-segment bản dịch VI thành ĐÚNG số câu GỐC (jaTexts) khi VI gộp câu: ĐỔI DẤU PHẨY → CHẤM tại vị trí theo TỈ LỆ độ dài câu gốc.
  // Trả [{text, end}] (end trong viText) để nuốt. VI đã đủ/nhiều câu hơn, hoặc thiếu chỗ ngắt → trả nguyên (cắt theo dấu chấm), KHỎI cắt bậy.
  function _resegmentVI(viText, jaTexts) {
    viText = viText || '';
    const segs = _splitPos(viText);
    const N = jaTexts.length;
    if (N <= 1 || segs.length >= N || !viText.trim()) return segs;
    const L = viText.length;
    const totalJa = jaTexts.reduce((a, x) => a + (x ? x.length : 0), 0) || 1;
    const wanted = []; let acc = 0;                                  // N-1 ranh giới mong muốn (tỉ lệ tích luỹ độ dài câu GỐC)
    for (let i = 0; i < N - 1; i++) { acc += (jaTexts[i] ? jaTexts[i].length : 0); wanted.push(acc / totalJa * L); }
    const cand = [];                                                 // ứng viên ngắt: dấu , ; 、 ， . ! ? 。… (KHÔNG lấy ký tự cuối)
    for (let p = 0; p < L - 1; p++) if (',，、;；.!?。！？．'.indexOf(viText[p]) >= 0) cand.push(p);
    if (cand.length < N - 1) return segs;                            // không đủ chỗ ngắt → để nguyên
    const used = new Set();
    for (const w of wanted) { let best = -1, bd = Infinity; for (const b of cand) { if (used.has(b)) continue; const d = Math.abs(b - w); if (d < bd) { bd = d; best = b; } } if (best >= 0) used.add(best); }
    const cuts = Array.from(used).sort((a, b) => a - b);
    const out = []; let start = 0;
    for (const cut of cuts) { const t = viText.slice(start, cut + 1).trim().replace(/[,，、;；]\s*$/, '.'); if (t) out.push({ text: t, end: cut + 1 }); start = cut + 1; }
    const tail = viText.slice(start).trim(); if (tail) out.push({ text: tail, end: L });
    return out;
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
  // Hiển thị TRỰC TIẾP bản dịch của live-translate (realtime). MỖI CÂU GỐC có dấu chấm = 1 HÀNG riêng (id=_lineBase+i, có mốc
  // thời gian cố định); câu DỊCH tương ứng RÁP vào đúng hàng đó (gốc trái / dịch phải KHỚP HÀNG).
  // KHÔNG tự ngắt khi chưa có dấu chấm: câu gốc đang dở = dòng live (partial); chỉ chốt thành hàng khi có dấu kết câu (hoặc hết LƯỢT).
  function _pump(final) {
    const transcribe = !!st().transcribeMode;
    const jaRest = _inAcc.slice(_jaCut);               // phần GỐC chưa chốt (đã nuốt phần trước)
    const viRest = transcribe ? '' : _outAcc.slice(_viCut);
    const turnEnd = final && _turnEnded;               // hết LƯỢT thật → chốt nốt cả câu cuối
    const jaSegs = _splitPos(jaRest);                  // câu GỐC còn lại (kèm vị trí)
    const jaDone = _doneCount(jaRest);                 // số câu GỐC đã có dấu chấm
    const viSegs = transcribe ? jaSegs : _resegmentVI(viRest, jaSegs.map(s => s.text));   // DỊCH re-segment khớp số câu gốc (đổi , → .)
    const pairN = transcribe ? jaDone : Math.min(jaDone, viSegs.length);
    const stable = turnEnd ? Math.max(jaSegs.length, viSegs.length) : Math.max(0, pairN - 1);   // chừa hàng CUỐI (ranh giới còn có thể đổi)
    let jaEnd = 0, viEnd = 0;
    for (let i = 0; i < stable; i++) {                 // chốt cặp đã ổn định = 1 hàng (gốc|dịch khớp), rồi NUỐT
      const o = transcribe ? '' : (jaSegs[i] ? jaSegs[i].text : '');
      const t = transcribe ? (jaSegs[i] ? jaSegs[i].text : '') : (viSegs[i] ? viSegs[i].text : '');
      const id = _lineBase;
      if (!_rowTs[id]) _rowTs[id] = _ts();
      if (o || t) _send(id, transcribe ? [{ o: '', t }] : [{ o, t }], true, _rowTs[id]);
      _lineBase++;
      if (jaSegs[i]) jaEnd = jaSegs[i].end;
      if (viSegs[i]) viEnd = viSegs[i].end;
    }
    _jaCut += jaEnd; if (!transcribe) _viCut += viEnd;
    if (turnEnd) { _inAcc = ''; _outAcc = ''; _jaCut = 0; _viCut = 0; _turnEnded = false; _clearRowTs(); return; }
    // DÒNG LIVE: phần còn lại (chưa chốt) → 1 hàng partial, xuống dòng theo câu
    const oPrev = transcribe ? '' : jaSegs.slice(stable).map(s => s.text).join('\n').trim();
    const tPrev = (transcribe ? jaSegs : viSegs).slice(stable).map(s => s.text).join('\n').trim();
    const pid = _lineBase;
    if (oPrev || tPrev) { if (!_rowTs[pid]) _rowTs[pid] = _ts(); _send(pid, transcribe ? [{ o: '', t: tPrev }] : [{ o: oPrev, t: tPrev }], false, _rowTs[pid]); }
  }
  function _flush() { clearTimeout(_emitTimer); clearTimeout(_flushTimer); _pump(true); }
  function _clearRowTs() { for (const k in _rowTs) delete _rowTs[k]; }
  // Đóng CỨNG lượt hiện tại (stop / đổi ngôn ngữ giữa lượt): chừa id cho các hàng đã hiện để KHỎI đè khi sang lượt mới.
  function _endTurnHard() { _lineBase += _splitVI(_inAcc.slice(_jaCut)).length + 2; _inAcc = ''; _outAcc = ''; _jaCut = 0; _viCut = 0; _turnEnded = false; _clearRowTs(); }

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
      if (!transcribe && typeof otText === 'string' && otText) { const mg = _mergeTrans(_outAcc, otText); if (mg !== _outAcc) { _outAcc = mg; changed = true; } }
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
    _started = true; _handle = null; _inAcc = ''; _outAcc = ''; _jaCut = 0; _viCut = 0; _clearRowTs(); _resetAudio();
    _ensure().catch(() => {});
    console.log('[live] start');
  }
  function stop() {
    _started = false;
    clearTimeout(_reconnectTimer); clearTimeout(_emitTimer); clearTimeout(_flushTimer);
    if (_inAcc || _outAcc) _flush();
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
