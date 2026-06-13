/**
 * audio-stt.js — Dịch vụ audio (system/mic) qua STT cục bộ sherpa-onnx-node (xem src/stt.js).
 * KHÔNG còn Python: renderer gửi PCM float32 @16k (Web Audio) → handlePcm → dịch.
 *
 * NHÁNH theo engine:
 *   - NEMOTRON (cả 5 ngôn ngữ, mặc định nay): streaming NATIVE cache-aware (stt.createNemotronStream) — feed PCM
 *     dần vào session giữ state → partial mọc dần ĐƠN ĐIỆU mỗi chunk ~560ms; endpoint theo trailing-silence
 *     (0.8s) + max-length. KHÔNG VAD, KHÔNG re-decode, KHÔNG LocalAgreement (RNN-T chỉ nối token).
 *   - ONLINE (sherpa, dự phòng): OnlineRecognizer → partial mọc dần, chốt khi isEndpoint. KHÔNG cần VAD.
 *   - OFFLINE (sherpa, dự phòng): Silero VAD cắt đoạn → transcribe trọn đoạn → pseudo-stream re-decode + LA-2.
 */
const state = require('./state');
const { enqueueTranslate, preprocessText } = require('./translation');
const { jaItn } = require('./ja-itn');   // ITN tiếng Nhật: số kanji → chữ số (Nemotron KHÔNG ITN native cho ja)
// Chuyển số kanji→chữ số cho nguồn TIẾNG NHẬT (2026年/11.8%/1763億円) — áp cho cả hiển thị lẫn dịch (MiLMMT đọc
// chữ số chuẩn hơn: 十一点八→11.8 tránh dịch nhầm "11/8"). Ngôn ngữ khác giữ nguyên.
function _jaNum(s) { try { return stt.currentLang() === 'ja' ? jaItn(s) : s; } catch { return s; } }
const { timestamp } = require('./caption-service');
const stt = require('./stt');
const path = require('path');
let _ortMod = null; const _ort = () => (_ortMod = _ortMod || require('onnxruntime-node'));   // lazy (VAD-gate)
// Nemotron 5-in-1 ra dấu câu + viết hoa + ITN NATIVE → KHÔNG còn module punctuate-*/ja-itn/ko-fix per-language.

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
    ok = await stt.warm();   // Nemotron: 1 model cho mọi lang, dấu câu native → không cần warm punctuation riêng
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
  // (nhánh ONLINE chỉ dùng cho engine streaming; Nemotron là offline nên không đi đường này. Giữ scaffolding.)
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
  // Nemotron: chốt nốt câu đang nói dở từ text đã decode (KHÔNG gọi session.finish khi pump có thể đang chạy →
  // tránh chạy chồng hỏng state; đuôi <chunk chưa decode bị bỏ — chấp nhận khi ⏹). Cắt nốt câu hoàn chỉnh + đuôi dở.
  if (_nemo && _nemoLiveText) {
    let tailRaw = _nemoLiveText.startsWith(_nemoCommittedText) ? _nemoLiveText.slice(_nemoCommittedText.length) : _nemoLiveText;
    tailRaw = _commitSentencesIn(tailRaw);
    if (tailRaw.trim()) _commitNemoSentence(tailRaw.trim(), _nemoLiveId);
    _nemoLiveId = null; _nemoCommittedText = ''; _nemoLiveText = '';
  }
  // offline: chốt nốt câu đang nói dở (chưa qua VAD endpoint) — đẩy NGUYÊN buffer (đã gồm pre-roll seed) vào
  // queue; worker re-transcribe ĐẦY ĐỦ + commit. Một consumer duy nhất (_pumpSeg) → không double-commit.
  if (_offLen > 0) {
    _enqueueSeg(_mergeFrames(_offBuf, _offLen), null, _offLiveId);
    _offUtt++; _resetOfflineLive();
  }
}

// ── NHÁNH NEMOTRON STREAMING NATIVE (5-in-1) ─────────────────────────────────────────────────────────
// Cache-aware FastConformer + RNN-T: feed PCM dần vào session (giữ state), nguồn mọc dần ĐƠN ĐIỆU mỗi
// chunk (~560ms). CHỐT CÂU theo (a) DẤU KẾT CÂU native (。．.!?！？ — cắt run-on dài như Live Captions) HOẶC
// (b) HYPOTHESIS NGỪNG MỌC ~1s (không ra token mới = ngừng nói) / max-length. DỊCH CHỈ KHI CHỐT CÂU (không
// dịch streaming — MiLMMT trên CPU nạp token chậm, dịch dở làm giật + tốn CPU của STT). KHÔNG VAD/re-decode.
// Endpoint đo bằng AUDIO-SAMPLES "kể từ token mới cuối" (KHÔNG dùng RMS): độc lập âm lượng → người nói nhỏ /
// mic xa / clip lặng vẫn chốt đúng (RMS 0.008 cũ bỏ sót audio nhỏ). Ngưỡng > 1 chunk (8960) để không cắt giữa câu.
let _nemo = null, _nemoLang = null, _nemoLiveId = null, _nemoLiveText = '';
let _nemoQ = [], _nemoPumping = false;
let _nemoNoGrow = 0, _nemoUttLen = 0, _nemoGrew = false;   // samples kể từ lần hypothesis mọc cuối + độ dài câu + đã từng mọc?
let _nemoCommittedText = '';   // phần hypothesis của utterance hiện tại ĐÃ chốt (đã thành caption riêng theo dấu câu)
const _NEMO_SR = 16000;
const _NEMO_NOGROW = 16000;                         // ngừng mọc ≥1.0s audio (>chunk 0.56s + frame) → chốt câu
const _NEMO_NOGROW_SHORT = 28800;                   // mảnh NGẮN (từ nối/ngập ngừng giữa câu, vd 「しかも」): chờ ~1.8s
const _NEMO_SHORT_CHARS = 6;                         //   để kịp gộp câu sau, tránh caption vụn 1-2 chữ
const _NEMO_MAX_UTT = Math.floor(_NEMO_SR * 15);    // câu quá dài (không có dấu kết câu) → chốt chống run-on

// ── VAD-gate: BỎ QUA chạy encoder lúc IM LẶNG (encoder ~0.59 core/chunk vs silero_vad ~0.015) ──────────────────
//   Lợi: ~0.5 core/chunk-im; họp 40-60% im → ~0.24-0.35 core TB + điện/nhiệt. Lúc đang nói: ~0 lợi (+VAD ~0.015).
//   AN TOÀN: hangover 1.15s > cửa sổ no-grow 1.0s → encoder LUÔN chạy hết tới lúc endpoint chốt câu (KHÔNG gate giữa
//   câu). Im lặng bền = ranh câu (app đã reset() ở 1.0s) → bỏ chunk im KHÔNG hỏng cache. Pre-roll 1 frame chống cắt
//   onset. VAD lỗi/không nạp → fail-open (coi như speech, không gate). Đặt _NEMO_VAD_GATE=false để tắt khi A/B.
const _NEMO_VAD_GATE = true;
const _NEMO_VAD_THRESH = 0.35;                       // prob ≥ ngưỡng = speech (verify: giọng nhỏ amp0.03→0.92; noise amp0.3→0.11)
const _NEMO_VAD_WIN = 512;                            // silero v5 cửa sổ cố định @16k
const _NEMO_VAD_HANG = Math.floor(_NEMO_SR * 1.15);  // hangover ~1.15s > no-grow 1.0s → chạy hết tới endpoint
let _nemoVad = null, _nemoVadFailed = false;          // session silero_vad.onnx (v5); failed=true → thôi thử nạp
let _nemoVadState = null;                              // Tensor recurrent [2,1,128]
let _nemoVadResidual = new Float32Array(0);           // mẩu <512 sample dư giữa frame → cửa sổ VAD đúng 512
let _nemoVadHang = 0;                                  // sample còn lại VẪN chạy encoder sau khi hết speech
let _nemoVadPrev = null;                               // frame im NGAY TRƯỚC speech (pre-roll prepend chống cắt onset)
function _resetNemoVad() { _nemoVadState = null; _nemoVadResidual = new Float32Array(0); _nemoVadHang = 0; _nemoVadPrev = null; }

// Vị trí dấu KẾT CÂU ĐẦU TIÊN trong s (。！？．!?). ASCII '.' BỎ QUA nếu là số thập phân (\d.\d). -1 nếu không có.
function _firstSentenceEnd(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '。' || c === '！' || c === '？' || c === '．' || c === '!' || c === '?') return i;
    if (c === '.' && !(/[0-9]/.test(s[i - 1] || '') && /[0-9]/.test(s[i + 1] || ''))) return i;
  }
  return -1;
}

function _ensureNemo() {
  const lang = stt.currentLang();
  if (_nemo && _nemoLang === lang) return _nemo;
  _nemo = stt.createNemotronStream();   // null nếu model chưa nạp / không phải nemotron
  _nemoLang = lang;
  _nemoLiveId = null; _nemoLiveText = ''; _nemoCommittedText = ''; _nemoNoGrow = 0; _nemoUttLen = 0; _nemoGrew = false;
  if (_nemo) console.log('[audio-stt] Nemotron streaming session:', lang);
  return _nemo;
}

// Nạp silero_vad.onnx (v5, nằm cùng thư mục model Nemotron) cho VAD-gate. Lỗi/không có → _nemoVadFailed (fail-open).
function _ensureNemoVad() {
  if (_nemoVad || _nemoVadFailed) return _nemoVad;
  try {
    const dir = stt.nemotronDir();
    if (!dir) { _nemoVadFailed = true; return null; }
    const O = _ort();
    // 1 thread + spinning off: khớp cấu hình STT, không thêm busy-wait. create đồng bộ qua biến tạm (createSync).
    _nemoVad = O.InferenceSession.create(path.join(dir, 'silero_vad.onnx'), {
      intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential',
      extra: { session: { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' } },
    });
    // create() trả Promise (onnxruntime-node async) → bọc: _nemoVad tạm là Promise, _nemoVadProb await nó.
    return _nemoVad;
  } catch (e) { console.warn('[audio-stt] VAD-gate nạp lỗi → fail-open (không gate):', e && e.message); _nemoVadFailed = true; return null; }
}

// Xác suất SPEECH lớn nhất của 1 frame PCM (chạy silero theo cửa sổ 512, giữ recurrent state, carry residual <512).
// Trả 1 (=speech) khi VAD chưa sẵn/lỗi → FAIL-OPEN (không bao giờ gate nhầm lúc chưa chắc).
async function _nemoVadProb(samples) {
  let sess = _ensureNemoVad();
  if (!sess) return 1;
  try {
    sess = await sess;            // create() là Promise lần đầu; các lần sau đã là session
    _nemoVad = sess;
    const O = _ort();
    let buf = samples;
    if (_nemoVadResidual.length) {
      const c = new Float32Array(_nemoVadResidual.length + samples.length);
      c.set(_nemoVadResidual, 0); c.set(samples, _nemoVadResidual.length); buf = c;
    }
    if (!_nemoVadState) _nemoVadState = new O.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
    const sr = new O.Tensor('int64', BigInt64Array.from([16000n]), []);
    let maxP = 0, off = 0;
    for (; off + _NEMO_VAD_WIN <= buf.length; off += _NEMO_VAD_WIN) {
      const input = new O.Tensor('float32', buf.slice(off, off + _NEMO_VAD_WIN), [1, _NEMO_VAD_WIN]);
      const r = await sess.run({ input, state: _nemoVadState, sr });
      _nemoVadState = r.stateN;
      const p = r.output.data[0];
      if (p > maxP) maxP = p;
    }
    _nemoVadResidual = buf.slice(off);   // mẩu <512 còn dư → frame sau
    return maxP;
  } catch (e) { console.warn('[audio-stt] VAD-gate chạy lỗi → fail-open:', e && e.message); _nemoVadFailed = true; _nemoVad = null; return 1; }
}

// Chốt 1 CÂU: entry (liveId nếu là entry đang sống, else mới) → "đang dịch…" → enqueueTranslate (cascade/TM/QE
// đầy đủ) → bản dịch THẬT. KHÔNG isPartial (vào captionData/export). Lọc ảo giác + dedup câu trùng cửa sổ ngắn.
function _commitNemoSentence(sentence, liveId) {
  let sRaw = (sentence || '').trim();
  if (!sRaw || stt.isHallucination(sRaw)) return;
  sRaw = _jaNum(sRaw);   // ja: số kanji → chữ số (cho cả caption hiển thị + bản dịch). Khác ja: nguyên văn.
  const now = Date.now();
  const norm = sRaw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!liveId && _isDupRecent(norm, now)) return;   // entry mới + trùng gần đây → bỏ (entry đang sống thì luôn chốt)
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

// Chốt MỌI câu hoàn chỉnh (tới từng dấu kết câu) trong pendingRaw → mỗi câu = 1 caption (câu ĐẦU dùng entry đang
// sống _nemoLiveId, câu sau mở entry mới). Cập nhật _nemoCommittedText. Trả phần ĐUÔI DỞ còn lại (chưa có dấu câu).
function _commitSentencesIn(pendingRaw) {
  let rest = pendingRaw, consumed = '';
  let e;
  while ((e = _firstSentenceEnd(rest)) >= 0) {
    const sentRaw = rest.slice(0, e + 1);
    rest = rest.slice(e + 1);
    consumed += sentRaw;
    _commitNemoSentence(sentRaw, _nemoLiveId);   // _commitNemoSentence tự bỏ nếu ảo giác/quá ngắn (vd "。" lẻ)
    _nemoLiveId = null;                           // câu kế mở entry mới
  }
  _nemoCommittedText += consumed;
  return rest;
}

// Pump TUẦN TỰ (1 consumer — ORT async, không cho 2 accept chạy chồng làm hỏng state). Mỗi frame: feed session,
// emit partial mọc dần, theo dõi im lặng → chốt câu khi đủ điều kiện endpoint. Dừng xử lý ngay khi user ⏹.
async function _pumpNemo() {
  if (_nemoPumping) return;
  _nemoPumping = true;
  try {
    while (_nemoQ.length) {
      const samples = _nemoQ.shift();
      if (state.audioPaused) continue;   // đã ⏹ → drain hàng đợi như no-op (flushStreaming lo chốt câu dở)
      const sess = _ensureNemo();
      if (!sess) { _nemoQ.length = 0; break; }   // chưa tạo được session → bỏ phần còn lại (model chưa sẵn)
      try {
        // VAD-gate: chỉ chạy encoder khi có SPEECH hoặc còn HANGOVER (~1.15s sau speech, phủ trọn cửa sổ chốt câu
        // 1.0s → KHÔNG gate giữa câu). Im lặng bền → bỏ qua accept (encoder KHÔNG chạy) nhưng vẫn cộng _nemoNoGrow
        // để endpoint chốt câu như cũ. VAD lỗi/chưa nạp → _nemoVadProb trả 1 = fail-open (chạy encoder mọi frame).
        const _prob = _NEMO_VAD_GATE ? await _nemoVadProb(samples) : 1;
        if (state.audioPaused) continue;   // có thể đã ⏹ trong lúc await VAD
        const _speech = _prob >= _NEMO_VAD_THRESH;
        if (_speech) _nemoVadHang = _NEMO_VAD_HANG;
        else if (_nemoVadHang > 0) _nemoVadHang -= samples.length;
        const _runEnc = _speech || _nemoVadHang > 0;

        if (_runEnc) {
          if (_nemoVadPrev) { try { await sess.accept(_nemoVadPrev); } catch {} _nemoVadPrev = null; }   // pre-roll frame im trước onset
          await sess.accept(samples);
          if (state.audioPaused) continue;
          // nguồn mọc → CHỐT các câu hoàn chỉnh (dấu kết câu) thành caption riêng, hiện phần ĐUÔI DỞ làm partial sống.
          const text = sess.text().trim();
          const grew = text && text !== _nemoLiveText;
          if (grew) {
            _nemoLiveText = text; _nemoNoGrow = 0; _nemoGrew = true;
            let pendingRaw = text.startsWith(_nemoCommittedText) ? text.slice(_nemoCommittedText.length) : (_nemoCommittedText = '', text);
            pendingRaw = _commitSentencesIn(pendingRaw);   // chốt+dịch mọi câu đã xong; còn lại = đuôi dở
            const pending = pendingRaw.trim();
            if (pending) {   // đuôi câu đang nói dở → hiện partial (translated:'' = chưa dịch; dịch khi câu chốt)
              if (!_nemoLiveId) _nemoLiveId = ++state.audioEntryId;
              send('caption-live', { id: _nemoLiveId, author: 'STT', original: _jaNum(pending), translated: '', isPartial: true, ts: timestamp(), tsMs: Date.now() });
            }
          } else {
            _nemoNoGrow += samples.length;   // không ra token mới → cộng dồn audio "im" (độc lập âm lượng)
          }
        } else {
          _nemoVadPrev = samples;            // im lặng (đã gate) → giữ frame mới nhất làm pre-roll; KHÔNG chạy encoder
          _nemoNoGrow += samples.length;     // vẫn cộng dồn để endpoint chốt câu (im = không token mới)
        }
        _nemoUttLen += samples.length;
        // endpoint: đã từng mọc + ngừng mọc đủ lâu (ngừng nói), HOẶC câu quá dài. Mảnh đuôi NGẮN (từ nối/ngập ngừng
        // giữa câu) đòi pause LÂU HƠN (1.8s) trước khi chốt → đỡ vụn (vd 「しかも」 kịp gộp với câu sau).
        const _pendRaw = _nemoLiveText.startsWith(_nemoCommittedText) ? _nemoLiveText.slice(_nemoCommittedText.length) : _nemoLiveText;
        const _need = _pendRaw.trim().length < _NEMO_SHORT_CHARS ? _NEMO_NOGROW_SHORT : _NEMO_NOGROW;
        if ((_nemoGrew && _nemoNoGrow >= _need) || _nemoUttLen >= _NEMO_MAX_UTT) {
          const fin = (await sess.finish()).trim();
          let tailRaw = fin.startsWith(_nemoCommittedText) ? fin.slice(_nemoCommittedText.length) : fin;
          tailRaw = _commitSentencesIn(tailRaw);          // chốt nốt câu hoàn chỉnh trong đuôi finish()
          if (tailRaw.trim()) _commitNemoSentence(tailRaw.trim(), _nemoLiveId);   // chốt đuôi dở (không dấu câu) = caption cuối
          _nemoLiveId = null; _nemoCommittedText = ''; _nemoLiveText = '';
          sess.reset();
          _nemoNoGrow = 0; _nemoUttLen = 0; _nemoGrew = false;
          _resetNemoVad();   // câu chốt → reset recurrent state/hangover/residual VAD cho câu kế (im sau đây sẽ bị gate)
        }
      } catch (e) {
        // BẤT KỲ lỗi nào (accept/decode/finish/cache hỏng do audio bất thường, vd KHI TUA LẠI audio) → TÁI TẠO
        // session để TỰ LÀNH, KHỎI phải ⏹▶. Bỏ câu đang dở + state về 0; _ensureNemo lần sau tạo session sạch.
        console.warn('[audio-stt] nemo pump lỗi → tái tạo session:', e && e.message);
        _nemo = null; _nemoLiveId = null; _nemoLiveText = ''; _nemoCommittedText = '';
        _nemoNoGrow = 0; _nemoUttLen = 0; _nemoGrew = false;
        _resetNemoVad();
      }
    }
  } finally { _nemoPumping = false; }
}
function _handlePcmNemotron(samples) { _nemoQ.push(samples); _pumpNemo(); }

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
function _mergeFrames(frames, len) { const b = new Float32Array(len); let o = 0; for (const p of frames) { b.set(p, o); o += p.length; } return b; }

// Reset trạng thái 1 CÂU (gồm cả ring + pre-roll snapshot) — gọi sau mỗi finalize / đổi ngôn ngữ / phiên mới.
function _resetOfflineLive() {
  _offBuf = []; _offLen = 0; _offDecLen = 0; _offLiveId = null; _offPartialText = ''; _offCommitted = ''; _offPrevHyp = ''; _offStale = 0;
  _offRing = []; _offRingLen = 0; _offPre = null;
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

// Chốt 1 đoạn VAD: Nemotron đã ra dấu câu + viết hoa native → emit thẳng dưới entry partial (liveId) → "…" → dịch.
async function _commitSeg(rawText, liveId) {
  const sRaw = (rawText || '').trim();
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
  if (stt.isNemotron()) { _handlePcmNemotron(samples); return; }   // streaming native 5-in-1 (cache-aware, không VAD)
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
  // Nemotron: bỏ session cũ → phiên mới _ensureNemo tạo lại sạch (đổi ngôn ngữ cũng tái tạo). Xoá trackers + queue.
  if (_nemo) { try { _nemo.reset(); } catch {} }
  _nemo = null; _nemoLang = null; _nemoLiveId = null; _nemoLiveText = ''; _nemoCommittedText = '';
  _nemoQ.length = 0; _nemoNoGrow = 0; _nemoUttLen = 0; _nemoGrew = false;
  _resetNemoVad();   // VAD-gate: xoá recurrent state/hangover/residual (giữ session _nemoVad đã nạp để khỏi load lại)
}

// Không còn server Python — giữ tên export cho main.js (no-op).
function stopSTTServer() {}

module.exports = { runAudioService, handlePcm, stopSTTServer, resetSegmentation, flushStreaming, warmModel };
