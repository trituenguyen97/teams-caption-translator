/**
 * audio-stt.js — Dịch vụ audio (system/mic) qua STT cục bộ sherpa-onnx-node (xem src/stt.js).
 * KHÔNG còn Python: renderer gửi PCM float32 @16k (Web Audio) → handlePcm → dịch.
 *
 * HAI NHÁNH theo ngôn ngữ (stt.isStreaming):
 *   - ONLINE (zh/en): đẩy PCM trực tiếp vào OnlineRecognizer → partial mọc dần (như Live Captions),
 *     chốt câu khi isEndpoint → dịch. KHÔNG cần VAD.
 *   - OFFLINE (ja/vi/ko): cắt câu bằng Silero VAD → transcribe trọn đoạn (ja/vi sherpa, ko Moonshine)
 *     → pseudo-stream partial mọc dần bằng re-decode + LocalAgreement-2 → commit khi VAD chốt.
 */
const state = require('./state');
const { enqueueTranslate, preprocessText } = require('./translation');
const { timestamp } = require('./caption-service');
const stt = require('./stt');
const { jaItn } = require('./ja-itn');
const { koFix } = require('./ko-fix');
const { punctuateJa, warmPunctuate, isAvailable: puncAvailable, addQuestion: _addQuestionJa } = require('./punctuate-ja');
const { punctuateEn, warmPunctuateEn } = require('./punctuate-en');
const { punctuateKo } = require('./punctuate-ko');

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
  try {
    ok = await stt.warm();
    // ja/en: nạp SẴN model dấu câu trong lúc overlay đang hiện → commit câu đầu khỏi khựng vì load.
    if (stt.currentLang() === 'ja') { try { await warmPunctuate(); } catch {} }
    if (stt.currentLang() === 'en') { try { warmPunctuateEn(); } catch {} }
  }
  catch (e) { console.warn('[audio-stt] warm lỗi:', e.message); }
  finally { send('busy', { on: false }); }
  return ok;
}

// ── NHÁNH ONLINE (streaming, zh/en): partial mọc dần → chốt câu khi isEndpoint → dịch ────────────
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
  let sRaw = (text || '').trim();
  _liveText = '';
  if (!sRaw || stt.isHallucination(sRaw)) { _liveId = null; return; }
  // en: model zipformer ra TOÀN HOA không dấu → phục hồi dấu câu + viết hoa (sherpa OnlinePunctuation). Lỗi → nguyên văn.
  if (stt.currentLang() === 'en') { try { sRaw = punctuateEn(sRaw); } catch {} }
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
    _liveText = text;                                 // GIỮ bản thô cho finalize (en: punctuateEn tự hạ thường + truecase)
    if (!_liveId) _liveId = ++state.audioEntryId;     // mở entry mới cho câu đang nói
    const disp = stt.currentLang() === 'en' ? text.toLowerCase() : text;   // en partial: hạ thường đỡ chói (bản chốt mới truecase)
    send('caption-live', { id: _liveId, author: 'STT', original: disp, translated: '', ts: timestamp(), tsMs: Date.now() });
  }
  if (sess.isEndpoint()) { _finalizeOnline(_liveText || text); sess.reset(); }
  return true;
}
// Chốt nốt câu ĐANG stream khi DỪNG ghi (user bấm ⏹ giữa câu) → câu cuối được dịch thay vì treo.
function flushStreaming() {
  if (_online && _liveText) { _finalizeOnline(_liveText); try { _online.reset(); } catch {} }
  // offline: chốt nốt câu đang nói dở (chưa qua VAD endpoint) — đẩy NGUYÊN buffer (đã gồm pre-roll seed) vào
  // queue; worker re-transcribe ĐẦY ĐỦ + commit. Một consumer duy nhất (_pumpSeg) → không double-commit.
  if (_offLen > 0) {
    _enqueueSeg(_mergeFrames(_offBuf, _offLen), null, _offLiveId);
    _offUtt++; _resetOfflineLive();
  }
}

// Dedup câu STT trùng trong cửa sổ ngắn (nhánh OFFLINE)
const _sttRecentTexts = new Map();
const STT_DEDUP_MS = 8000;
function _isDupRecent(norm, now) {
  for (const [k, ts_] of _sttRecentTexts) {
    if (now - ts_ >= STT_DEDUP_MS) continue;
    // trùng khít HOẶC gần-trùng (1 chuỗi chứa chuỗi kia, ≥6 ký tự) → bắt cả biến thể lặp của cùng 1 câu nói
    if (k === norm || (norm.length >= 6 && k.length >= 6 && (k.includes(norm) || norm.includes(k)))) return true;
  }
  return false;
}
function _rememberRecent(norm, now) {
  _sttRecentTexts.set(norm, now);
  for (const [k, ts_] of _sttRecentTexts) if (now - ts_ > STT_DEDUP_MS * 2) _sttRecentTexts.delete(k);
}

// ── VAD: cắt câu theo khoảng lặng (Silero) → chỉ transcribe khi MỘT lượt nói KẾT THÚC → câu đủ nghĩa,
//    ít nghe sai (Whisper nghe trọn đoạn thay vì mảnh 2.5s rời). Thiếu model VAD → fallback chunk như cũ. ──
let _vad = null, _vadLang = null, _vadModelOk = null, _draining = false;
let _vadResidual = new Float32Array(0);   // mẩu <512 sample còn dư giữa các frame → feed VAD đúng cửa sổ 512
let _fbParts = [], _fbLen = 0;   // gom khung cho nhánh fallback (thiếu model VAD)
// Tạo (lại) VAD theo NGÔN NGỮ NGUỒN hiện tại — đổi ngôn ngữ ⇒ tạo lại với config tương ứng (STT_CONFIG).
function _ensureVad() {
  if (_vadModelOk === null) _vadModelOk = stt.isVadAvailable();
  if (!_vadModelOk) return null;   // thiếu model → fallback chunk
  const lang = stt.currentLang();
  if (_vad && _vadLang === lang) return _vad;
  _vad = stt.createVad();          // ngôn ngữ đổi (hoặc lần đầu) → VAD mới theo config ngôn ngữ đó
  _vadLang = lang;
  _vadResidual = new Float32Array(0);
  _offUtt++; _resetOfflineLive();  // đổi ngôn ngữ → bỏ buffer câu dở cũ
  if (_vad) console.log('[audio-stt] VAD theo ngôn ngữ nguồn:', lang || 'auto');
  return _vad;
}

// Phát caption + dịch cho 1 mảng câu (đã lọc) — dùng cho nhánh FALLBACK (thiếu model VAD). Dedup cửa sổ ngắn.
function _emitLines(lines) {
  if (!lines || !lines.length) return;
  for (const line of lines) {
    const now = Date.now();
    const normLine = line.toLowerCase().replace(/\s+/g, ' ').trim();
    if (_isDupRecent(normLine, now)) continue;
    _rememberRecent(normLine, now);
    const id = ++state.audioEntryId;
    const ts = timestamp();
    const tsMs = now;
    const cleaned = preprocessText(line);
    send('caption-live', { id, author: 'STT', original: line, translated: '…', ts, tsMs });
    enqueueTranslate(cleaned).then(translated => {
      if (state.audioPaused) return;   // user đã bấm ⏹ giữa lúc đang dịch → bỏ kết quả tới muộn
      const isTranslated = translated !== line && translated !== cleaned;
      send('caption-live', { id, author: 'STT', original: line, translated: isTranslated ? translated : null, ts: timestamp(), tsMs });
    });
  }
}

// ── PSEUDO-STREAM offline (ja/vi/ko): partial MỌC DẦN bằng re-decode buffer câu đang nói, rồi COMMIT
//    khi VAD chốt đoạn (dùng ĐÚNG entry partial → câu "mọc rồi đông cứng" như Live Captions). ja/vi (sherpa
//    transducer) re-decode chỉ ~0.1-0.2s/lần → tick 0.6s; ko (Moonshine, decoder autoregressive ~39ms/token,
//    94% thời gian) re-decode 2-2.6s ở buffer 6-8s → tick 2s + khoá _offPartialBusy (skip-if-busy) cho cadence
//    suy giảm mềm. LocalAgreement-2 đã verify với Moonshine: prefix commit không bao giờ bị rút lại. ──
let _offBuf = [], _offLen = 0, _offDecLen = 0;     // buffer PCM câu đang nói + mốc samples lần partial trước
let _offLiveId = null, _offPartialText = '', _offPartialBusy = false, _offUtt = 0;
let _offCommitted = '', _offPrevHyp = '', _offStale = 0;   // LocalAgreement-2 + bộ đếm "đơ" để gỡ kẹt khi model sửa đầu câu
let _offRing = [], _offRingLen = 0, _offPre = null;        // pre-roll ring + snapshot lúc onset (prepend cho FINAL → giữ onset đoạn VAD bị trim)
// Khoảng audio MỚI tối thiểu giữa 2 lần re-decode partial, THEO ngôn ngữ: ko decode chậm (RTF ~0.33) nên tick
// dày hơn chỉ phí CPU cho kết quả sẽ bị skip; partial đầu của ko xuất hiện ~2.4s sau khi bắt đầu nói (đã đo).
function _partialStep() { return Math.floor(16000 * (stt.currentLang() === 'ko' ? 2.0 : 0.6)); }
const _PREROLL = Math.floor(16000 * 0.7);          // độ dài pre-roll (rộng hơn → ít rớt onset/đầu câu)
// Đuôi CHƯA KẾT CÂU (trợ từ cách/đề は/を/に… + thể nối で/から): VAD ngắt giữa câu lúc ngập ngừng. KHÔNG ép 。 vào
// đó, VÀ nếu model punctuation lỡ chấm cuối (nó coi biên VAD như hết câu → "…は。") thì BỎ 。 cuối → để TRỐNG, đoạn kế
// nối tiếp như Live Captions (LC không chấm cuối mỗi dòng). Mất 。 ở câu thật kết bằng で/が hiếm + ít chướng hơn nhiều.
const _NONTERM_TAIL = /(は|を|に|へ|も|と|が|の|や|で|から|まで)$/;
const _NONTERM_TAIL_PUNC = /(は|を|に|へ|も|と|が|の|や|で|から|まで)。$/;
function _mergeFrames(frames, len) { const b = new Float32Array(len); let o = 0; for (const p of frames) { b.set(p, o); o += p.length; } return b; }

// Reset trạng thái 1 CÂU (gồm cả ring + pre-roll snapshot) — gọi sau mỗi finalize / đổi ngôn ngữ / phiên mới.
function _resetOfflineLive() {
  _offBuf = []; _offLen = 0; _offDecLen = 0; _offLiveId = null; _offPartialText = ''; _offCommitted = ''; _offPrevHyp = ''; _offStale = 0;
  _offRing = []; _offRingLen = 0; _offPre = null;
}

// Hậu xử lý text FINAL theo ngôn ngữ: ja = ITN số kanji→chữ số; ko = sửa loanword garble hệ thống của
// Moonshine (src/ko-fix.js, chỉ key phi-từ + biên từ — regression test: scripts/test-ko-fix.js). CHỈ áp
// lên FINAL, không áp partial (giữ tính đơn điệu của LocalAgreement). Ngôn ngữ khác trả nguyên.
function _itn(s) {
  try {
    const lang = stt.currentLang();
    if (lang === 'ja') return jaItn(s);
    if (lang === 'ko') return koFix(s);
    return s;
  } catch { return s; }
}
// Tiền tố chung dài nhất Ở MỨC KÝ TỰ (Array.from cho an toàn surrogate) — lõi của LocalAgreement.
function _charLCP(a, b) {
  const A = Array.from(a || ''), B = Array.from(b || '');
  const n = Math.min(A.length, B.length); let i = 0;
  while (i < n && A[i] === B[i]) i++;
  return A.slice(0, i).join('');
}

// Re-decode buffer câu hiện tại → phát partial (translated:'' = đang stream, chưa dịch). Fire-and-forget, có
// khoá chống chạy chồng (_offPartialBusy) + bỏ qua khi đang drain. _offUtt = "thế hệ câu": partial tới muộn
// sau khi câu đã chốt sẽ bị loại (tránh ghi đè / tạo entry rác cho câu đã xong).
function _emitOfflinePartial() {
  if (_offPartialBusy || _draining || !_offLen) return;
  _offPartialBusy = true;
  const gen = _offUtt;
  const merged = _mergeFrames(_offBuf, _offLen);
  stt.transcribe(merged).then(text => {
    text = (text || '').trim();
    if (state.audioPaused || gen !== _offUtt) return;   // đã ⏹ hoặc câu đã chốt → bỏ partial tới muộn
    if (!text || stt.isHallucination(text)) return;     // KHÔNG ghi đè _offPrevHyp → giữ giả thuyết hợp lệ cuối (khỏi mất 1 nhịp)
    // LocalAgreement-2: CHỈ hiện phần prefix mà 2 lần re-decode liên tiếp ĐỒNG Ý (so ký tự) → partial mọc ĐƠN
    // ĐIỆU, không "nhảy ngược" (re-decode offline hay đổi giả thuyết đầu câu khi có thêm ngữ cảnh).
    const agreed = _charLCP(_offPrevHyp, text);
    _offPrevHyp = text;
    if (agreed.startsWith(_offCommitted)) {              // agreed nối tiếp committed → mở rộng bình thường (đơn điệu)
      if (agreed.length > _offCommitted.length) _offCommitted = agreed;
      _offStale = 0;
    } else if (++_offStale >= 2 && agreed.length >= _offCommitted.length) {
      // Model SỬA đầu câu dai dẳng (≥2 nhịp agreed không còn bắt đầu bằng committed) → nhận prefix mới (1 lần
      // "sửa") để KHỎI ĐƠ ở prefix sai suốt câu dài. Final (text trọn, sạch) vẫn là bản chốt cuối cùng.
      _offCommitted = agreed; _offStale = 0;
    }
    // Partial hiện KANJI THÔ (đơn điệu): KHÔNG ITN ở đây vì số đang hình thành (二千六→2006 rồi 二千六百五十七→2657)
    // sẽ phá tính đơn điệu. ITN chỉ áp ở bản FINAL (text đã trọn). Partial là preview, final mới "snap" sang chữ số.
    if (_offCommitted && _offCommitted !== _offPartialText) {
      _offPartialText = _offCommitted;
      if (!_offLiveId) _offLiveId = ++state.audioEntryId;   // mở entry mới cho câu đang nói
      send('caption-live', { id: _offLiveId, author: 'STT', original: _offCommitted, translated: '', ts: timestamp(), tsMs: Date.now() });
    }
  }).catch(() => {}).finally(() => { _offPartialBusy = false; });
}

// ── HÀNG ĐỢI FINALIZE TUẦN TỰ ──────────────────────────────────────────────────────────────────────
// Mỗi đoạn VAD → 1 item {samples, pre(pre-roll onset), liveId(entry partial)} đẩy vào _segQ; worker xử lý
// TỪNG đoạn MỘT (transcribe→punctuation→ITN→emit), TÁCH HẲN khỏi feed-frame/partial. Đảm bảo 1 đoạn = 1
// caption (KHÔNG gộp, KHÔNG rớt — trước đây drain coupling + punctuation async làm dồn/mất đoạn).
let _segQ = [], _segPumping = false;
function _enqueueSeg(samples, pre, liveId) { _segQ.push({ samples, pre, liveId }); _pumpSeg(); }
async function _pumpSeg() {
  if (_segPumping) return;
  _segPumping = true;
  try {
    while (_segQ.length) {
      const it = _segQ.shift();
      let buf = it.samples;
      if (it.pre && it.pre.length) { buf = new Float32Array(it.pre.length + it.samples.length); buf.set(it.pre, 0); buf.set(it.samples, it.pre.length); }
      let text = '';
      try { text = await stt.transcribe(buf); } catch {}
      try { await _commitSeg(text, it.liveId); } catch {}
    }
  } finally { _segPumping = false; }
}

// Chốt 1 đoạn: (ja) punctuation → ITN → emit dưới entry partial (liveId) → "…" → dịch. Dedup khi chưa hiện partial.
async function _commitSeg(rawText, liveId) {
  let base = (rawText || '').trim();
  if (!base || stt.isHallucination(base)) return;
  let sRaw;
  if (stt.isNemotron()) {
    sRaw = base.trim();   // Nemotron ra dấu câu + viết hoa NATIVE → KHÔNG dùng punctuate-*/ITN/ko-fix per-language
  } else {
    if (stt.currentLang() === 'ja') { try { base = await punctuateJa(base); } catch {} }   // dấu câu 、。？
    // ko: heuristic dấu KẾT câu (đuôi 습니다/습니까/까요…) + sửa đuôi hỏng 슴니다→습니다 + bỏ "." sau đuôi nối
    if (stt.currentLang() === 'ko') { try { base = punctuateKo(base); } catch {} }
    sRaw = _itn(base).trim();                                                            // ITN số kanji→Ả Rập
    if (stt.currentLang() === 'ja' && sRaw) {                                         // làm mượt ngắt câu khi VAD cắt giữa câu
      if (_NONTERM_TAIL_PUNC.test(sRaw)) sRaw = sRaw.replace(/。$/, '');               //   model lỡ chấm sau trợ từ nối → bỏ 。 cuối
      else if (!/[。、？！]$/.test(sRaw) && !_NONTERM_TAIL.test(sRaw)) sRaw += '。';   //   hết câu thật mà model quên chấm → ép 。
    }
    if (stt.currentLang() === 'ja') { try { sRaw = _addQuestionJa(sRaw); } catch {} }        // áp lại ？ trên dấu kết câu CUỐI (model đặt 。 lệch chỗ か)
  }
  if (!sRaw || stt.isHallucination(sRaw)) return;
  const now = Date.now();
  const norm = sRaw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!liveId && _isDupRecent(norm, now)) return;   // chưa hiện partial + trùng gần đây → bỏ
  _rememberRecent(norm, now);
  const id = liveId || (++state.audioEntryId);
  const cleaned = preprocessText(sRaw);
  send('caption-live', { id, author: 'STT', original: sRaw, translated: '…', ts: timestamp(), tsMs: now });
  enqueueTranslate(cleaned).then(tr => {
    if (state.audioPaused) return;   // user đã ⏹ giữa lúc dịch → bỏ kết quả tới muộn
    const ok = tr && tr !== cleaned && tr !== sRaw;
    send('caption-live', { id, author: 'STT', original: sRaw, translated: ok ? tr : null, ts: timestamp(), tsMs: now });
  }).catch(() => {});
}

// Rút các đoạn VAD đã CHỐT → ĐẨY VÀO QUEUE (đồng bộ, KHÔNG transcribe ở đây → không chặn feed-frame). Worker
// (_pumpSeg) transcribe + commit TỪNG đoạn → mỗi đoạn VAD = đúng 1 caption (không gộp/rớt). Mỗi đoạn pop = 1 câu
// xong → snapshot {pre-roll onset, liveId entry partial} rồi RESET trạng thái partial cho câu kế.
function _drainVad() {
  if (!_vad) return;
  while (!_vad.isEmpty()) {
    let seg;
    try { seg = _vad.front(false); _vad.pop(); } catch (e) { console.warn('[audio-stt] VAD front lỗi:', e.message); break; }
    _enqueueSeg(seg.samples, _offPre, _offLiveId);   // pre-roll + entry partial gắn theo đoạn → worker chốt
    _offUtt++;                                        // vô hiệu partial đang bay của câu vừa xong
    _resetOfflineLive();                              // sang câu kế (clears _offBuf/_offPre/_offLiveId; ring re-fill)
  }
}

// Nhận PCM float32 @16k từ renderer (khung nhỏ ~0.25s). Online → streaming; offline → VAD → transcribe.
async function handlePcm(samples) {
  if (state.captureSource === 'teams' || state.audioPaused) return;
  if (!samples || !samples.length) return;
  if (stt.isStreaming()) {
    if (_handlePcmStreaming(samples)) return;   // online (zh/en) — chốt câu trong vòng streaming
    // tạo session lỗi → rơi xuống offline phía dưới
  }
  const vad = _ensureVad();
  if (vad) {
    // Feed VAD theo CỬA SỔ 512 (=windowSize Silero), giữ residual qua frame. Đo thực: chunk lớn (4000/frame)
    // làm VAD GỘP đoạn (4 đoạn) → mất câu; feed 512 cho cắt đoạn chuẩn (8 đoạn) = completeness như Live Captions.
    let fed = _vadResidual.length ? (() => { const c = new Float32Array(_vadResidual.length + samples.length); c.set(_vadResidual, 0); c.set(samples, _vadResidual.length); return c; })() : samples;
    let off = 0;
    while (off + 512 <= fed.length) { try { vad.acceptWaveform(fed.subarray(off, off + 512)); } catch { return; } off += 512; }
    _vadResidual = fed.subarray(off);   // remainder (<512) giữ cho frame sau → không mất sample/khoảng lặng
    // Pre-roll ring: LUÔN giữ ~0.4s gần nhất để khi VAD bắt tiếng hơi trễ, onset câu không bị mất.
    _offRing.push(samples); _offRingLen += samples.length;
    while (_offRing.length > 1 && _offRingLen - _offRing[0].length >= _PREROLL) { _offRingLen -= _offRing.shift().length; }
    // Đang nói → gom PCM câu hiện tại + phát partial mọc dần định kỳ (pseudo-stream). Im lặng → không gom.
    if (vad.isDetected()) {
      if (_offLen === 0) {                                                  // onset câu mới
        _offPre = _offRingLen ? _mergeFrames(_offRing, _offRingLen) : null;  // snapshot pre-roll → prepend cho FINAL (giữ onset)
        for (const r of _offRing) { _offBuf.push(r); _offLen += r.length; }  // seed buffer partial (đã gồm frame này)
      } else { _offBuf.push(samples); _offLen += samples.length; }
      if (_offLen - _offDecLen >= _partialStep()) { _offDecLen = _offLen; _emitOfflinePartial(); }
    }
    _drainVad();   // đoạn nào VAD đã chốt → đẩy queue (worker transcribe+commit tuần tự, không chặn frame)
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
  _fbParts = []; _fbLen = 0; _vadResidual = new Float32Array(0);
  _offUtt++; _resetOfflineLive();   // bỏ buffer/partial/pre-roll câu dở của phiên trước (_resetOfflineLive đã xoá ring)
  _segQ = [];                       // bỏ đoạn còn trong hàng đợi finalize của phiên trước
  _sttRecentTexts.clear();
  // Online: bỏ stream cũ → phiên mới tạo session sạch (đổi ngôn ngữ cũng được tái tạo qua _ensureOnline).
  if (_online) { try { _online.reset(); } catch {} }
  _online = null; _onlineLang = null; _liveId = null; _liveText = '';
}

// Không còn server Python — giữ tên export cho main.js (no-op).
function stopSTTServer() {}

module.exports = { runAudioService, handlePcm, stopSTTServer, resetSegmentation, flushStreaming, warmModel };
