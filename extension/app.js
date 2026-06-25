// app.js — controller cho side panel. Thu (mic/màn hình) → Gemini Live → list + TTS + tóm tắt.
import { createLiveTranslator, validateKey } from './lib/gemini-live.js';
import { createSummarizer } from './lib/gemini-text.js';
import { LANG_LABELS } from './lib/langs.js';
import { GEM_VOICES, DEFAULT_VOICE } from './lib/voices.js';
import { I18N_LOCALES, flag, t, setLocale, currentLocale, applyI18n } from './lib/i18n.js';

// ── State + lưu trữ ────────────────────────────────────────────────────────────
const DEFAULTS = {
  apiKey: '', langCode: 'vi', transcribeMode: false, geminiVoice: DEFAULT_VOICE,
  geminiAudioOn: true, source: 'mic', summaryExtra: '', uiLang: 'vi',
};
const S = { ...DEFAULTS };
async function loadSettings() { const got = await chrome.storage.local.get(DEFAULTS); Object.assign(S, got); }
function save(patch) { Object.assign(S, patch); chrome.storage.local.set(patch); }

// ── DOM ─────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  settingsBtn: $('settings-btn'), popoutBtn: $('popout-btn'), pipBtn: $('pip-btn'), settings: $('settings'),
  langBtn: $('lang-btn'), langMenu: $('lang-menu'),
  apikey: $('apikey'), keyStatus: $('key-status'), source: $('source'),
  targetBtn: $('target-btn'), targetMenu: $('target-menu'),
  voice: $('voice'), start: $('start'), status: $('status'), list: $('list'), count: $('count'),
  autoscroll: $('autoscroll'), summaryToggle: $('summary-toggle'), export: $('export'), clear: $('clear'),
  summaryWrap: $('summary-wrap'), summary: $('summary'), sumSpin: $('sum-spin'),
  sumEdit: $('sum-edit'), sumEditBox: $('sum-edit-box'), summaryExtra: $('summary-extra'), sumExtraSave: $('sum-extra-save'),
  sumFull: $('sum-full'), sumCopy: $('sum-copy'), sumExport: $('sum-export'),
  vResizer: $('v-resizer'), dl: $('dl'),
};
const langName = c => (I18N_LOCALES.find(l => l.code === c) || {}).name || c;

// Trạng thái có khoá i18n để đổi ngôn ngữ là render lại được.
let _lastStatus = null;
function st(key, vars, cls) { _lastStatus = { key, vars, cls }; el.status.textContent = t(key, vars); el.status.className = 'status' + (cls ? ' ' + cls : ''); }

// ── Engines ──────────────────────────────────────────────────────────────────────
const live = createLiveTranslator({
  getState: () => ({ apiKey: S.apiKey, langCode: S.langCode, transcribeMode: S.transcribeMode, geminiAudioOn: S.geminiAudioOn, geminiVoice: S.geminiVoice }),
  onCaption: addCaption,
  onAudio: playAudio,
  onClear: clearAudio,
  onStatus: ({ error }) => { if (error === 'no-key') st('status.noKeyShort', null, 'err'); else if (error) st('status.geminiErr', { err: error }, 'err'); },
});
const summarizer = createSummarizer({
  getState: () => ({ apiKey: S.apiKey, targetLangLabel: LANG_LABELS[S.langCode] || 'tiếng Việt', transcribeMode: S.transcribeMode, summaryExtra: S.summaryExtra }),
});

// ── Caption list ─────────────────────────────────────────────────────────────────
const captions = []; const byId = new Map(); const rowById = new Map();
let autoScroll = true;
function refreshCount() { el.count.textContent = t('count', { n: captions.length }); }
function addCaption(c) {
  let e = byId.get(c.id);
  if (!e) { e = { id: c.id, author: c.author, translated: c.translated, original: c.original, ts: c.ts, tsMs: c.tsMs, partial: c.isPartial }; captions.push(e); byId.set(c.id, e); }
  else { e.translated = c.translated; e.original = c.original; e.author = c.author; e.partial = c.isPartial; }
  upsertRow(e);
  if (!c.isPartial && sumPanelOpen) summarizeTick();
}
function upsertRow(e) {
  let row = rowById.get(e.id);
  if (!row) {
    row = document.createElement('div'); row.className = 'entry';
    row.innerHTML = '<div class="entry-head"><span class="who"></span><span class="spacer"></span><span class="ts"></span></div><div class="entry-text"></div>';
    el.list.appendChild(row); rowById.set(e.id, row);
  }
  row.classList.toggle('partial', !!e.partial);
  row.querySelector('.who').textContent = e.author || 'Speaker';
  row.querySelector('.ts').textContent = e.ts || '';
  row.querySelector('.entry-text').textContent = e.translated || e.original || '';
  refreshCount();
  if (autoScroll) el.list.scrollTop = el.list.scrollHeight;
}
function clearList() {
  captions.length = 0; byId.clear(); rowById.clear(); el.list.innerHTML = ''; refreshCount();
  summaryMd = ''; sumPrevCount = 0; sumLastTime = 0; renderSummary();
}

// ── TTS playback (gapless + trần độ trễ — port từ app.html bản đã vá) ─────────────
let _gemCtx = null, _gemPlayhead = 0, _gemNodes = [];
// Engine giờ gom audio THEO CỤM (tới dấu ngắt) rồi gửi nguyên cụm → mỗi buffer đã trọn vẹn, KHÔNG cần pre-roll lớn.
// LEAD nhỏ để các cụm nối SÁT nhau (LEAD lớn → khoảng lặng giữa các cụm). Tăng nhẹ nếu cụm đầu bị cắt mở đầu.
const _GEM_LEAD = 0.4, _GEM_SOFT_LEAD = 1.0, _GEM_HARD_LEAD = 2.5;   // đệm 0.4s: chống underrun (hụt/ngắt) GIỮA câu khi gói audio Gemini về không đều
const _GEM_START_LEAD = 0.2;   // ĐỆM ĐỘNG: cụm MỞ ĐẦU mỗi lượt (sau khoảng lặng) chỉ mồi 0.2s → vào nhanh, câu ngắn đỡ trễ/khựng
let _gemSpeed = 1.0;   // tốc độ phát hiện tại — đổi theo HYSTERESIS (không tính lại mỗi gói) → hết rung cao độ
let _gemLastEnd = 0;   // mốc kết thúc cụm cuối (giây, đồng hồ AudioContext) → đo "đã cạn bao lâu" để chọn LEAD động
function ensureGemCtx() {
  if (!_gemCtx || _gemCtx.state === 'closed') { _gemCtx = new (window.AudioContext || window.webkitAudioContext)(); _gemPlayhead = 0; _gemNodes = []; }
  if (_gemCtx.state === 'suspended') _gemCtx.resume().catch(() => {});
  return _gemCtx;
}
function clearAudio() { for (const n of _gemNodes) { try { n.onended = null; n.stop(); } catch (e) {} } _gemNodes = []; _gemPlayhead = 0; _gemSpeed = 1.0; _gemLastEnd = 0; }
function playAudio({ b64, sampleRate }) {
  try {
    if (!S.geminiAudioOn || !b64) return;
    const bin = atob(b64); const n = bin.length >> 1; if (!n) return;
    const f32 = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = (bin.charCodeAt(i * 2 + 1) << 8) | bin.charCodeAt(i * 2); if (s >= 32768) s -= 65536; f32[i] = s / 32768; }
    const ctx = ensureGemCtx();
    if (_gemPlayhead - ctx.currentTime > _GEM_HARD_LEAD) {   // trần cứng: bỏ đuôi đã xếp, kéo độ trễ về ~LEAD
      const now = ctx.currentTime; let resumeAt = now + _GEM_LEAD;
      for (const nd of _gemNodes.slice()) {
        if ((nd._s || 0) > now + 0.005) { try { nd.onended = null; nd.stop(); } catch (e) {} const i = _gemNodes.indexOf(nd); if (i >= 0) _gemNodes.splice(i, 1); }
        else if ((nd._e || 0) > resumeAt) resumeAt = nd._e;
      }
      _gemPlayhead = resumeAt; _gemSpeed = 1.0;
    }
    const lead = _gemPlayhead - ctx.currentTime;
    // HYSTERESIS: bật bù tốc khi backlog > SOFT, tắt khi đã rút xuống < SOFT/2 → tốc độ ỔN ĐỊNH, không rung cao độ mỗi gói.
    if (lead > _GEM_SOFT_LEAD) _gemSpeed = 1.06;
    else if (lead < _GEM_SOFT_LEAD * 0.5) _gemSpeed = 1.0;
    const spd = _gemSpeed;
    const buf = ctx.createBuffer(1, n, sampleRate || 24000);
    buf.getChannelData(0).set(f32);
    const node = ctx.createBufferSource();
    node.buffer = buf; node.playbackRate.value = spd; node.connect(ctx.destination);
    if (_gemPlayhead < ctx.currentTime + 0.02) {   // queue cạn → ĐỆM ĐỘNG: nghỉ lâu (cụm mở đầu) mồi NHANH 0.2s; hụt giữa câu mồi DÀY 0.4s
      const idle = ctx.currentTime - _gemLastEnd;
      _gemPlayhead = ctx.currentTime + (idle > 0.35 ? _GEM_START_LEAD : _GEM_LEAD);
    }
    const startAt = _gemPlayhead; node.start(startAt);
    _gemPlayhead = startAt + buf.duration / spd; node._s = startAt; node._e = _gemPlayhead; _gemLastEnd = _gemPlayhead;
    _gemNodes.push(node);
    node.onended = () => { const i = _gemNodes.indexOf(node); if (i >= 0) _gemNodes.splice(i, 1); };
  } catch (e) { console.warn('[tts] play lỗi:', e && e.message); }
}

// ── Audio capture (mic / màn hình-tab-cửa sổ) → PCM f32 @16k ──────────────────────
let recActive = false, audioCtx = null, srcNode = null, procNode = null, zeroGain = null, rawStream = null, watchdog = null, lastTs = 0;
const MIC_GATE_RMS = 0.004, MIC_GATE_HANG_MS = 700;   // cổng VAD-lite cho mic: bỏ khung im lặng để model khỏi dịch tạp âm / lặp lại
let micVoiceUntil = 0;
async function startCapture() {
  let stream;
  if (S.source === 'mic') {
    try {
      // AGC tắt: tránh khuếch đại im lặng thành tạp âm khiến model dịch sai/lặp. Giữ EC+NS để sạch tiếng.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, video: false,
      });
    } catch (e) {
      // Side panel / popup KHÔNG hiện được hộp thoại xin quyền mic → ném NotAllowedError như "đã hủy".
      // Mở 1 cửa sổ THẬT để người dùng cấp quyền; cấp xong (lưu theo origin) thì side panel dùng mic được.
      if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'SecurityError')) {
        // Mở TAB thật (có thanh địa chỉ) — cửa sổ 'popup' KHÔNG có omnibox nên hộp thoại quyền không hiện được.
        // Cấp đến TỪ nút Bắt đầu → cấp xong tự đóng tab + tự Bắt đầu (xem listener 'mic-granted' trong wire()).
        _autoStartAfterGrant = true;
        try { const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('mic-perm.html'), active: true }); _micPermTabId = tab && tab.id; }
        catch (_) { try { await chrome.windows.create({ url: chrome.runtime.getURL('mic-perm.html'), type: 'normal', width: 520, height: 420, focused: true }); } catch (__) {} }
        const pe = new Error('mic-perm'); pe.name = 'MicPermNeeded'; throw pe;
      }
      throw e;
    }
  } else {
    // Hiện popup chọn của trình duyệt: Tab trình duyệt / Cửa sổ (app) / Toàn màn hình.
    // getDisplayMedia bắt buộc có video để hiện picker → ta lấy stream rồi BỎ track video, chỉ giữ audio.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        // Chrome 141+ (Win/macOS): gỡ tiếng do CHÍNH side panel này phát (TTS) khỏi system audio capture
        // → chống TTS vọng lại ở TẦNG AUDIO (trước khi tới Gemini). No-op nếu nguồn không có system audio
        // hoặc trình duyệt cũ chưa hỗ trợ (constraint "ideal" nên bị bỏ qua, KHÔNG ném lỗi).
        restrictOwnAudio: true,
      },
      systemAudio: 'include',         // hiện rõ tuỳ chọn "chia sẻ âm thanh hệ thống" trong picker
      selfBrowserSurface: 'exclude',  // ẩn chính tab/panel của extension khỏi danh sách chọn
    });
    stream.getVideoTracks().forEach(t => t.stop());
  }
  rawStream = stream;
  const tracks = stream.getAudioTracks();
  if (!tracks.length) throw new Error("nguồn không có audio — chọn 'Tab' hoặc tick 'Chia sẻ âm thanh' khi chọn Toàn màn hình (cửa sổ app thường không có audio)");
  // Xác minh trình duyệt có THẬT SỰ áp dụng restrictOwnAudio không (undefined = chưa hỗ trợ / không có system audio)
  if (S.source !== 'mic' && tracks[0] && tracks[0].getSettings) {
    const aset = tracks[0].getSettings();
    console.log('[capture] restrictOwnAudio =', aset.restrictOwnAudio, '— true = đang gỡ TTS của panel khỏi audio thu; undefined = trình duyệt chưa hỗ trợ');
  }
  recActive = true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch (e) {} }
  audioCtx.onstatechange = () => { if (recActive && audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {}); };
  srcNode = audioCtx.createMediaStreamSource(new MediaStream(tracks));
  procNode = audioCtx.createScriptProcessor(4096, 1, 1);
  zeroGain = audioCtx.createGain(); zeroGain.gain.value = 0;
  procNode.onaudioprocess = (e) => {
    if (!recActive) return;
    lastTs = Date.now();
    const ch = e.inputBuffer.getChannelData(0);
    if (S.source === 'mic') {                 // CỔNG IM LẶNG: chỉ gửi khi có tiếng (+ giữ 700ms sau câu) → giảm dịch lặp/sai
      let sum = 0; for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      if (Math.sqrt(sum / ch.length) >= MIC_GATE_RMS) micVoiceUntil = lastTs + MIC_GATE_HANG_MS;
      if (lastTs > micVoiceUntil) return;     // im lặng kéo dài → KHÔNG gửi khung này
    }
    live.pushAudio(new Float32Array(ch));
  };
  srcNode.connect(procNode); procNode.connect(zeroGain); zeroGain.connect(audioCtx.destination);
  lastTs = Date.now(); clearInterval(watchdog);
  watchdog = setInterval(() => { if (recActive && audioCtx && Date.now() - lastTs > 3000) audioCtx.resume().catch(() => {}); }, 2000);
  tracks[0].addEventListener('ended', () => { if (recActive) stop(); });   // user tự tắt chia sẻ → dừng
  // AUTO-PiP (trick): TAB + mic (getUserMedia) → đăng ký handler để Chrome TỰ mở PiP khi rời tab (không cần bấm 📌).
  if (_isPopup && S.source === 'mic' && 'mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('enterpictureinpicture', () => { if (!_inPip) { _pipAuto = true; openPip(); } });
      navigator.mediaSession.playbackState = 'playing';
    } catch (_) {}
  }
}
function stopCapture() {
  recActive = false; clearInterval(watchdog); watchdog = null;
  try { if (procNode) { procNode.onaudioprocess = null; procNode.disconnect(); } } catch (e) {}
  try { if (srcNode) srcNode.disconnect(); } catch (e) {}
  try { if (zeroGain) zeroGain.disconnect(); } catch (e) {}
  try { if (audioCtx) audioCtx.close(); } catch (e) {}
  procNode = srcNode = zeroGain = audioCtx = null;
  rawStream?.getTracks().forEach(t => t.stop()); rawStream = null;
  try { if ('mediaSession' in navigator) { navigator.mediaSession.setActionHandler('enterpictureinpicture', null); navigator.mediaSession.playbackState = 'none'; } } catch (_) {}
}

// ── Start / Stop ──────────────────────────────────────────────────────────────────
let running = false;
let _micPermTabId = null;        // tab xin quyền mic đang mở (cấp xong → đóng tab)
let _autoStartAfterGrant = false; // chỉ TỰ Bắt đầu sau khi cấp khi việc cấp đến từ nút Bắt đầu (không phải lúc mở extension)
function refreshStartBtn() { el.start.textContent = t(running ? 'btn.stop' : 'btn.start'); el.start.classList.toggle('on', running); }
async function start() {
  if (running) return;
  if (!S.apiKey || !S.apiKey.trim()) { st('status.needKey', null, 'err'); el.settings.classList.remove('hidden'); return; }
  try {
    ensureGemCtx();                 // mở khoá AudioContext phát trong user-gesture
    live.start();
    await startCapture();
    running = true; refreshStartBtn(); refreshSpin();
    st(S.source === 'mic' ? 'status.listeningMic' : 'status.listeningAudio', null, 'run');
  } catch (e) {
    console.error(e); live.stop(); stopCapture();
    if (e && e.name === 'MicPermNeeded') st('status.micPermNeeded', null, 'err');
    else if (e && e.name === 'NotAllowedError') st('status.canceled');
    else st('status.captureErr', { err: e.message || e.name || e }, 'err');
  }
}
function stop() {
  if (!running) return;
  running = false;
  live.stop(); stopCapture(); clearAudio();
  refreshStartBtn(); refreshSpin();
  st('status.stopped');
}
// Đóng CHÍNH context này: nếu là 1 TAB → chrome.tabs.remove; nếu là side panel/cửa sổ → window.close().
function closeSelf() {
  try {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id != null) { try { chrome.tabs.remove(tab.id); } catch (_) { window.close(); } }
      else window.close();
    });
  } catch (_) { window.close(); }
}
// Kiểm tra quyền mic mà KHÔNG bật capture.
async function _micPermState() {
  try { return (await navigator.permissions.query({ name: 'microphone' })).state; } catch (_) { return 'unknown'; }
}
// Chủ động xin quyền mic (lúc MỞ extension / chọn nguồn Micro) — KHÔNG tự Bắt đầu.
// Tab có thanh địa chỉ → bật hộp thoại trực tiếp; side panel không bật được → mở tab mic-perm.
async function ensureMicPermission() {
  const s = await _micPermState();
  if (s === 'granted' || s === 'unknown') return;     // đã cấp / không kiểm tra được → thôi
  _autoStartAfterGrant = false;
  if (_isPopup) {
    try { const ms = await navigator.mediaDevices.getUserMedia({ audio: true }); ms.getTracks().forEach(t => t.stop()); st('status.micGranted', null, 'run'); }
    catch (_) { st('status.micPermHint', null, 'err'); }
  } else {
    try { const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('mic-perm.html'), active: true }); _micPermTabId = tab && tab.id; st('status.micPermNeeded', null, 'err'); } catch (_) {}
  }
}

// ── Tóm tắt ────────────────────────────────────────────────────────────────────────
let summaryMd = '', sumPrevCount = 0, sumBusy = false, sumTimer = null, sumPanelOpen = false, sumLastTime = 0;
const SUM_MIN_NEW = 24, SUM_POLL_MS = 12000, SUM_MAX_CAPS_PER_CALL = 25;
const SUM_MIN_FIRST = 8, SUM_MIN_FIRST_CHARS = 400;   // tóm tắt LẦN ĐẦU chỉ khi ĐỦ nội dung → chống LLM bịa lúc mới có 1-2 câu
const finalized = () => captions.filter(c => !c.partial);
async function summarizeTick() {
  if (sumBusy) return;
  const caps = finalized();
  const newCount = caps.length - sumPrevCount;
  const firstChars = caps.reduce((n, c) => n + ((c.translated || c.original || '').length), 0);
  const firstReady = sumLastTime === 0 && caps.length >= SUM_MIN_FIRST && firstChars >= SUM_MIN_FIRST_CHARS;
  if (!((newCount >= SUM_MIN_NEW) || firstReady)) return;
  sumBusy = true; refreshSpin();
  let newCaps = caps.slice(sumPrevCount);
  if (newCaps.length > SUM_MAX_CAPS_PER_CALL) newCaps = newCaps.slice(newCaps.length - SUM_MAX_CAPS_PER_CALL);
  try {
    const res = await summarizer.summarize({ prevSummary: summaryMd, captions: newCaps });
    if (res && res.ok) { summaryMd = res.markdown; renderSummary(); sumPrevCount = caps.length; sumLastTime = Date.now(); }
    else if (res && res.error !== 'empty') st('status.summaryErr', { err: res.error }, 'err');
  } catch (e) { st('status.summaryErr', { err: e.message }, 'err'); }
  finally { sumBusy = false; refreshSpin(); }
}
// Spinner = chỉ báo "đang chạy": hiện suốt khi đang dịch (running) và panel mở, hoặc khi có lệnh tóm tắt đang chạy. Stop → ẩn.
function refreshSpin() { el.sumSpin.classList.toggle('hidden', !((running && sumPanelOpen) || sumBusy)); }
// Làm lại tóm tắt TỪ ĐẦU với yêu cầu mới (prevSummary rỗng), GIỮ nội dung cũ hiển thị tới khi có bản mới rồi mới đè.
async function regenerateSummary() {
  if (sumBusy) return;
  const caps = finalized();
  if (!caps.length) return;
  sumBusy = true; refreshSpin();
  let newCaps = caps;
  if (newCaps.length > SUM_MAX_CAPS_PER_CALL) newCaps = newCaps.slice(newCaps.length - SUM_MAX_CAPS_PER_CALL);
  try {
    const res = await summarizer.summarize({ prevSummary: '', captions: newCaps });
    if (res && res.ok) { summaryMd = res.markdown; renderSummary(); sumPrevCount = caps.length; sumLastTime = Date.now(); }
    else if (res && res.error !== 'empty') st('status.summaryErr', { err: res.error }, 'err');
  } catch (e) { st('status.summaryErr', { err: e.message }, 'err'); }
  finally { sumBusy = false; refreshSpin(); }
}
function openSummary() {
  sumPanelOpen = true; el.summaryWrap.classList.remove('hidden'); el.vResizer.classList.remove('hidden'); el.summaryToggle.classList.add('active');
  if (!el.summaryWrap.style.height) el.summaryWrap.style.height = Math.round(window.innerHeight * 0.35) + 'px';
  refreshSpin(); summarizeTick(); clearInterval(sumTimer); sumTimer = setInterval(summarizeTick, SUM_POLL_MS);
}
function closeSummary() { sumPanelOpen = false; el.summaryWrap.classList.add('hidden'); el.vResizer.classList.add('hidden'); el.summaryToggle.classList.remove('active'); el.sumEditBox.classList.add('hidden'); refreshSpin(); clearInterval(sumTimer); sumTimer = null; }
function renderSummary() { el.summary.innerHTML = summaryMd ? md2html(summaryMd) : `<em class="muted">${t('summary.empty')}</em>`; }

// Markdown → HTML gọn (heading, list, bảng GFM, bold/italic/code, hr).
function md2html(md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  const lines = String(md).replace(/\r/g, '').split('\n'); const out = []; let i = 0;
  const isSep = s => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
  while (i < lines.length) {
    const ln = lines[i];
    if (/^\s*#{1,6}\s+/.test(ln)) { const m = ln.match(/^\s*(#{1,6})\s+(.*)$/); const lv = Math.min(m[1].length, 3); out.push(`<h${lv}>${inline(m[2].replace(/\*\*/g, ''))}</h${lv}>`); i++; continue; }
    if (/^(\s*)([-*+]|\d+[.)])\s+/.test(ln)) {   // LIST có LỒNG NHAU: thụt sâu hơn cha → <ul> con bên trong <li> cha
      const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
      const stack = [];   // mỗi mức = { indent, tag }
      while (i < lines.length) {
        const m = lines[i].match(listRe);
        if (!m) break;
        const indent = m[1].replace(/\t/g, '  ').length;
        const tag = /^\d/.test(m[2]) ? 'ol' : 'ul';
        const li = '<li>' + inline(m[3]);
        if (!stack.length || indent > stack[stack.length - 1].indent) { out.push('<' + tag + '>'); stack.push({ indent, tag }); out.push(li); }   // sâu hơn → mở list con
        else if (indent === stack[stack.length - 1].indent) { out.push('</li>'); out.push(li); }                                                  // cùng mức → li mới
        else { while (stack.length > 1 && indent < stack[stack.length - 1].indent) out.push('</li></' + stack.pop().tag + '>'); out.push('</li>'); out.push(li); }  // nông hơn → đóng list con
        i++;
      }
      while (stack.length) out.push('</li></' + stack.pop().tag + '>');
      continue;
    }
    if (ln.includes('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      const cells = r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
      const head = cells(ln); i += 2; out.push('<table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>');
      while (i < lines.length && lines[i].includes('|')) { out.push('<tr>' + cells(lines[i]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>'); i++; }
      out.push('</tbody></table>'); continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) { out.push('<hr>'); i++; continue; }
    if (ln.trim() === '') { i++; continue; }
    out.push('<p>' + inline(ln) + '</p>'); i++;
  }
  return out.join('');
}

// ── Export ────────────────────────────────────────────────────────────────────────
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob); el.dl.href = url; el.dl.download = name; el.dl.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function exportTranscript() {
  if (!captions.length) { st('status.noContent'); return; }
  const lines = captions.map(c => {
    const head = `[${c.ts || ''}] ${c.author || 'STT'}:`;
    if (c.original && c.original.trim()) return `${head}\n  • ${c.original}\n  → ${c.translated || ''}`;
    return `${head} ${c.translated || ''}`;
  });
  download(`transcript-${new Date().toISOString().slice(0, 10)}.txt`, lines.join('\n'));
}

// ── UI build (cờ + dropdown ngôn ngữ + giọng) ───────────────────────────────────────
function buildVoiceSelect() {
  el.voice.innerHTML = '';
  const off = document.createElement('option'); off.value = '__off__'; off.textContent = t('voice.off'); el.voice.appendChild(off);
  for (const v of GEM_VOICES) { const o = document.createElement('option'); o.value = v; o.textContent = '🔊 ' + v; el.voice.appendChild(o); }
  el.voice.value = S.geminiAudioOn ? S.geminiVoice : '__off__';
}
function buildTargetButton() {
  el.targetBtn.innerHTML = S.transcribeMode
    ? `<span>${t('lang.transcribe')}</span>`
    : `<span class="flag">${flag(S.langCode)}</span><span>${langName(S.langCode)}</span>`;
}
function buildLangMenu() {
  el.langMenu.innerHTML = '';
  for (const L of I18N_LOCALES) {
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `<span class="flag">${flag(L.code)}</span><span>${L.name}</span>`;
    if (L.code === currentLocale()) b.classList.add('sel');
    b.addEventListener('click', () => { applyLocale(L.code); closeMenus(); });
    el.langMenu.appendChild(b);
  }
}
function buildTargetMenu() {
  el.targetMenu.innerHTML = '';
  for (const L of I18N_LOCALES) {
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `<span class="flag">${flag(L.code)}</span><span>${L.name}</span>`;
    if (!S.transcribeMode && S.langCode === L.code) b.classList.add('sel');
    b.addEventListener('click', () => { pickTarget(L.code, false); closeMenus(); });
    el.targetMenu.appendChild(b);
  }
  const tb = document.createElement('button'); tb.type = 'button';
  tb.innerHTML = `<span>${t('lang.transcribe')}</span>`;
  if (S.transcribeMode) tb.classList.add('sel');
  tb.addEventListener('click', () => { pickTarget(null, true); closeMenus(); });
  el.targetMenu.appendChild(tb);
}
function pickTarget(code, transcribe) {
  if (transcribe) { save({ transcribeMode: true }); live.onTranscribeModeChanged(); }
  else { const wasT = S.transcribeMode; save({ langCode: code, transcribeMode: false }); wasT ? live.onTranscribeModeChanged() : live.onTargetLangChanged(); }
  el.voice.disabled = S.transcribeMode;
  buildTargetButton();
}
function closeMenus() { el.langMenu.classList.add('hidden'); el.targetMenu.classList.add('hidden'); }

function applyLocale(code) {
  setLocale(code); save({ uiLang: code });
  applyI18n(document);
  buildVoiceSelect(); buildTargetButton(); refreshStartBtn(); refreshCount(); renderSummary();
  el.langBtn.innerHTML = `<span class="flag">${flag(code)}</span>`;
  if (_lastStatus) st(_lastStatus.key, _lastStatus.vars, _lastStatus.cls);
}

// Kéo chỉnh chiều cao panel tóm tắt (resizer giữa list dịch và tóm tắt).
function initResizer() {
  let startY = 0, startH = 0, dragging = false;
  el.vResizer.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startH = el.summaryWrap.offsetHeight;
    try { el.vResizer.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault();
  });
  el.vResizer.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = e.clientY - startY;                       // kéo LÊN (dy<0) → tóm tắt CAO hơn
    const max = Math.round(window.innerHeight * 0.78);
    el.summaryWrap.style.height = Math.max(110, Math.min(max, startH - dy)) + 'px';
  });
  const end = (e) => { dragging = false; try { el.vResizer.releasePointerCapture(e.pointerId); } catch (_) {} };
  el.vResizer.addEventListener('pointerup', end);
  el.vResizer.addEventListener('pointercancel', end);
}

let keyTimer = null;
async function checkKey() {
  const k = el.apikey.value.trim();
  if (!k) { el.keyStatus.textContent = ''; el.keyStatus.className = 'key-status'; return; }
  el.keyStatus.textContent = t('status.checking'); el.keyStatus.className = 'key-status';
  const r = await validateKey(k);
  if (r.ok) { el.keyStatus.textContent = t('status.keyOk'); el.keyStatus.className = 'key-status ok'; }
  else { el.keyStatus.textContent = r.error === 'invalid' ? t('status.keyBad') : '✕ ' + r.error; el.keyStatus.className = 'key-status err'; }
}

// Ghim: mở UI trong cửa sổ Document Picture-in-Picture (LUÔN TRÊN CÙNG, nổi trên app khác).
// PiP chỉ mở được từ context TOP-LEVEL (tab) — side panel không phải top-level nên KHÔNG ghim được từ đó.
let _pipHolder = null, _inPip = false, _myWindowId = null, _pipAuto = false, _autoReturning = false;
const _isPopup = new URLSearchParams(location.search).get('popup') === '1';
const _prevTabId = (() => { const v = new URLSearchParams(location.search).get('prev'); return v != null ? parseInt(v, 10) : null; })();
function _setPipReturnMode(on) {   // trong PiP: nút 📌 đổi thành 🔙 "đưa về side panel"
  el.pipBtn.textContent = on ? '🔙' : '📌';
  el.pipBtn.title = t(on ? 'pip.return' : 'pip.title');
}
function returnFromPip() {          // 🔙: đưa về dạng SIDE PANEL + đóng tab. (best-effort: nếu Chrome từ chối gesture thì chỉ đóng như X)
  if (_myWindowId != null) { try { chrome.sidePanel.open({ windowId: _myWindowId }); } catch (_) {} }   // mở lại side panel ĐỒNG BỘ trong gesture click
  const w = window.documentPictureInPicture && window.documentPictureInPicture.window;
  if (w) w.close();                // → pagehide → stop + đóng tab
}
async function openPip() {
  if (!('documentPictureInPicture' in window)) { st('status.pipUnsupported', null, 'err'); return; }
  try {
    if (window.documentPictureInPicture.window) { window.documentPictureInPicture.window.focus(); return; }
    const pip = await window.documentPictureInPicture.requestWindow({ width: 460, height: 820 });
    // chép CSS sang document của PiP
    for (const sheet of Array.from(document.styleSheets)) {
      try { const css = Array.from(sheet.cssRules).map(r => r.cssText).join(''); const s = pip.document.createElement('style'); s.textContent = css; pip.document.head.appendChild(s); }
      catch (_) { if (sheet.href) { const l = pip.document.createElement('link'); l.rel = 'stylesheet'; l.href = sheet.href; pip.document.head.appendChild(l); } }
    }
    // chuyển toàn bộ UI sang PiP (JS/AudioContext vẫn sống ở context này = tab opener)
    const moved = [];
    while (document.body.firstChild) { const n = document.body.firstChild; moved.push(n); pip.document.body.appendChild(n); }
    const prevPop = el.popoutBtn.style.display;
    el.popoutBtn.style.display = 'none';     // trong PiP không tách tiếp
    _inPip = true; _setPipReturnMode(true);  // nút 📌 → 🔙
    _pipHolder = document.createElement('div'); _pipHolder.className = 'pip-holder'; _pipHolder.textContent = t('pip.active'); document.body.appendChild(_pipHolder);
    if (!_pipAuto && _prevTabId != null) { try { chrome.tabs.update(_prevTabId, { active: true }); } catch (_) {} }   // (THỦ CÔNG) trả focus về tab nội dung; AUTO thì user đã rời tab sẵn
    pip.addEventListener('pagehide', () => {
      if (_pipHolder) { _pipHolder.remove(); _pipHolder = null; }
      if (_autoReturning) {                  // AUTO quay lại tab → THU UI VỀ TAB (không dừng, không đóng)
        for (const n of moved) document.body.appendChild(n);
        el.popoutBtn.style.display = prevPop;
        _inPip = false; _pipAuto = false; _autoReturning = false; _setPipReturnMode(false);
      } else {                               // 🔙 (đã mở side panel) hoặc X → dừng + đóng tab opener
        try { stop(); } catch (_) {}
        closeSelf();
      }
    });
  } catch (e) { st('status.pipErr', { err: e && e.message }, 'err'); }
}
// AUTO-PiP: thu PiP về tab khi quay lại tab extension (chỉ cho PiP mở TỰ ĐỘNG, giống Meet).
function softReturnFromPip() {
  _autoReturning = true;
  const w = window.documentPictureInPicture && window.documentPictureInPicture.window;
  if (w) w.close(); else _autoReturning = false;
}

function wire() {
  el.settingsBtn.addEventListener('click', () => el.settings.classList.toggle('hidden'));
  el.pipBtn.addEventListener('click', () => { if (_inPip) returnFromPip(); else { _pipAuto = false; openPip(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && _inPip && _pipAuto) softReturnFromPip(); });   // AUTO-PiP: quay lại tab → thu PiP về tab
  // Trang xin quyền mic báo về "đã cấp" → đóng tab đó + TỰ Bắt đầu (đúng ý: đồng ý là chạy luôn).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'mic-granted') {
      if (_micPermTabId != null) { try { chrome.tabs.remove(_micPermTabId); } catch (_) {} _micPermTabId = null; }
      if (_autoStartAfterGrant && !running && S.source === 'mic') start();   // chỉ tự chạy nếu cấp đến từ nút Bắt đầu
      else if (!running) st('status.micGranted', null, 'run');
      _autoStartAfterGrant = false;
    }
  });
  el.popoutBtn.addEventListener('click', async () => {           // mở UI trong 1 TAB của cửa sổ hiện tại rồi ĐÓNG side panel
    const page = (location.pathname.split('/').pop() || 'sidepanel.html');
    try {
      if (running) stop();                                       // nhả mic/loa trước khi đóng (tab mới tự chạy lại khi bấm ▶)
      let prev = '';
      try { const [act] = await chrome.tabs.query({ active: true, currentWindow: true }); if (act && act.id != null) prev = '&prev=' + act.id; } catch (_) {}   // nhớ tab nội dung để trả focus sau khi bật PiP
      await chrome.tabs.create({ url: chrome.runtime.getURL(page + '?popup=1' + prev), active: true });   // TAB → bấm 📌 trong tab để PiP
      window.close();                                            // đóng Side Panel đang mở
    } catch (e) { st('status.popoutErr', { err: e && e.message }, 'err'); }
  });
  // Dropdown ngôn ngữ giao diện (cờ) + ngôn ngữ đích (cờ)
  el.langBtn.addEventListener('click', (e) => { e.stopPropagation(); const show = el.langMenu.classList.contains('hidden'); closeMenus(); if (show) { buildLangMenu(); el.langMenu.classList.remove('hidden'); } });
  el.targetBtn.addEventListener('click', (e) => { e.stopPropagation(); const show = el.targetMenu.classList.contains('hidden'); closeMenus(); if (show) { buildTargetMenu(); el.targetMenu.classList.remove('hidden'); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.dd')) closeMenus(); });

  el.apikey.addEventListener('input', () => { save({ apiKey: el.apikey.value.trim() }); clearTimeout(keyTimer); keyTimer = setTimeout(checkKey, 600); });
  el.source.addEventListener('change', () => { save({ source: el.source.value }); if (el.source.value === 'mic') ensureMicPermission(); });   // chọn Micro → xin quyền luôn
  el.voice.addEventListener('change', () => {
    const v = el.voice.value;
    if (v === '__off__') { save({ geminiAudioOn: false }); live.setAudioOn(false); }
    else {
      const changed = v !== S.geminiVoice;
      save({ geminiAudioOn: true, geminiVoice: v }); live.setAudioOn(true);
      if (changed && running) live.onVoiceChanged();   // đổi giọng → reconnect áp dụng voiceName mới (~1.5s)
    }
  });
  el.start.addEventListener('click', () => running ? stop() : start());
  el.clear.addEventListener('click', clearList);
  el.export.addEventListener('click', exportTranscript);
  el.autoscroll.addEventListener('click', () => { autoScroll = !autoScroll; el.autoscroll.classList.toggle('active', autoScroll); if (autoScroll) el.list.scrollTop = el.list.scrollHeight; });
  el.list.addEventListener('scroll', () => { const near = el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 40; autoScroll = near; el.autoscroll.classList.toggle('active', near); });
  el.summaryToggle.addEventListener('click', () => sumPanelOpen ? closeSummary() : openSummary());
  el.sumCopy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(summaryMd || ''); st('status.copied'); } catch (e) {} });
  el.sumExport.addEventListener('click', () => { if (summaryMd) download(`summary-${new Date().toISOString().slice(0, 10)}.md`, summaryMd, 'text/markdown'); });
  el.sumFull.addEventListener('click', async () => {
    if (running) { st('status.stopFirst'); return; }
    const caps = finalized(); if (!caps.length) { st('status.noContent'); return; }
    st('status.makingFull'); sumBusy = true; refreshSpin();
    const r = await summarizer.summarizeFull(caps);
    sumBusy = false; refreshSpin();
    if (r && r.ok) { summaryMd = r.markdown; renderSummary(); el.summaryWrap.classList.remove('hidden'); st('status.fullDone'); }
    else st('status.fullErr', { err: r && r.error }, 'err');
  });
  // Bút chì: mở/đóng ô nhập yêu cầu tóm tắt
  el.sumEdit.addEventListener('click', () => {
    const show = el.sumEditBox.classList.contains('hidden');
    el.sumEditBox.classList.toggle('hidden');
    if (show) { el.summaryExtra.value = S.summaryExtra || ''; el.summaryExtra.focus(); }
  });
  // Lưu yêu cầu → áp dụng + tóm tắt lại NGAY (rỗng = về ngôn ngữ đích / ngôn ngữ chép lời)
  el.sumExtraSave.addEventListener('click', async () => {
    save({ summaryExtra: el.summaryExtra.value.trim() });
    el.sumEditBox.classList.add('hidden');
    await regenerateSummary();                 // GIỮ tóm tắt cũ trên màn hình, có bản mới (theo yêu cầu mới) thì tự đè (không hiện thông báo)
  });
}

// ── Init ────────────────────────────────────────────────────────────────────────
(async function init() {
  await loadSettings();
  setLocale(S.uiLang || 'vi');
  // Ghim (PiP) chỉ mở được từ context TOP-LEVEL (tab); side panel không phải top-level → ẩn nút ghim ở side panel.
  if (_isPopup) {
    el.popoutBtn.style.display = 'none';                                                                // đã ở tab riêng → ẩn nút tách
    try { chrome.tabs.getCurrent((tab) => { if (tab) _myWindowId = tab.windowId; }); } catch (_) {}     // nhớ cửa sổ để 🔙 mở lại side panel đúng chỗ
  } else {
    el.pipBtn.style.display = 'none';                                                                   // side panel → ẩn nút ghim (📌)
  }
  if (S.source !== 'mic' && S.source !== 'screen') save({ source: 'screen' });   // migrate giá trị cũ ('tab')
  el.apikey.value = S.apiKey; el.source.value = S.source;
  buildVoiceSelect(); el.voice.disabled = S.transcribeMode;
  buildTargetButton();
  el.langBtn.innerHTML = `<span class="flag">${flag(S.uiLang)}</span>`;
  applyI18n(document); refreshStartBtn(); refreshCount(); renderSummary();
  initResizer(); wire();
  if (S.apiKey) checkKey();
  st(S.apiKey ? 'status.ready' : 'status.readyNoKey');
  if (S.source === 'mic') ensureMicPermission();   // mở extension + đang chọn Micro + chưa cấp quyền → xử lý cấp luôn
})();
