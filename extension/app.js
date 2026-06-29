// app.js — controller cho side panel. Thu (mic/màn hình) → Gemini Live → list + TTS + tóm tắt.
import { createLiveTranslator, validateKey } from './lib/gemini-live.js';
import { createSummarizer } from './lib/gemini-text.js';
import { LANG_LABELS } from './lib/langs.js';
import { GEM_VOICES, DEFAULT_VOICE } from './lib/voices.js';
import { I18N_LOCALES, flag, t, setLocale, currentLocale, applyI18n } from './lib/i18n.js';
import { hSave, hList, hGet, hDel, hAll, hImport } from './lib/history.js';

// ── State + lưu trữ ────────────────────────────────────────────────────────────
const DEFAULTS = {
  apiKey: '', langCode: 'vi', transcribeMode: false, geminiVoice: DEFAULT_VOICE,
  geminiAudioOn: true, source: 'mic', summaryExtra: '', uiLang: 'vi', layout: 'translation', zoom: 100, saveHistory: true,
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
  voiceBtn: $('voice-btn'), voiceMenu: $('voice-menu'), start: $('start'), status: $('status'), list: $('list'), count: $('count'),
  levelMeter: $('level-meter'), lmCover: $('lm-cover'), lmTxt: $('lm-txt'),
  autoscroll: $('autoscroll'), layoutPick: $('layout-pick'), zoom: $('zoom'), zoomVal: $('zoom-val'), summaryToggle: $('summary-toggle'), export: $('export'), clear: $('clear'),
  summaryWrap: $('summary-wrap'), summary: $('summary'), sumSpin: $('sum-spin'), sumOverlay: $('sum-overlay'),
  sumEdit: $('sum-edit'), sumEditBox: $('sum-edit-box'), summaryExtra: $('summary-extra'), sumExtraSave: $('sum-extra-save'),
  sumFull: $('sum-full'), sumDlHtml: $('sum-dlhtml'), sumExport: $('sum-export'),
  vResizer: $('v-resizer'), dl: $('dl'),
  saveHistory: $('save-history'), historyBtn: $('history-btn'), history: $('history'), histList: $('hist-list'), histView: $('hist-view'), histClose: $('hist-close'), histBack: $('hist-back'),
  histExport: $('hist-export'), histImport: $('hist-import'), histImportFile: $('hist-import-file'),
};
// Ngôn ngữ ĐÍCH (tách khỏi ngôn ngữ giao diện) — giữ 5 như cũ.
const TARGET_LANGS = [
  { code: 'vi', name: 'Tiếng Việt' }, { code: 'en', name: 'English' }, { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' }, { code: 'zh-CN', name: '中文' },
];
const langName = c => (TARGET_LANGS.find(l => l.code === c) || {}).name || c;
const GLOBE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/><path d="M4.8 7.5h14.4M4.8 16.5h14.4"/></svg>';

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
  if (c.remove) {   // engine báo xoá hàng (DP gộp lại còn ít hàng hơn / dòng live biến mất)
    const e = byId.get(c.id); if (e) { const i = captions.indexOf(e); if (i >= 0) captions.splice(i, 1); byId.delete(c.id); }
    if (curLayout() === 'dual') { renderDual(); return; }
    const row = rowById.get(c.id); if (row) { row.remove(); rowById.delete(c.id); }
    refreshCount(); return;
  }
  let e = byId.get(c.id);
  if (!e) { e = { id: c.id, author: c.author, translated: c.translated, original: c.original, lines: c.lines, ts: c.ts, tsMs: c.tsMs, partial: c.isPartial }; captions.push(e); byId.set(c.id, e); }
  else { e.translated = c.translated; e.original = c.original; e.lines = c.lines; e.author = c.author; e.partial = c.isPartial; }
  if (curLayout() === 'dual') renderDual(); else upsertRow(e);
  if (!c.isPartial && sumPanelOpen) summarizeTick();
}
// Tách câu (cho mode 2 luồng) — bỏ qua '.' thập phân & '.' giữa câu (sau là chữ thường).
function _splitSent(s) {
  s = s || ''; const out = []; let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '.') { if (/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '')) continue; let j = i + 1; while (j < s.length && s[j] === ' ') j++; if (j < s.length && /\p{Ll}/u.test(s[j])) continue; }
    if ('.!?。！？．'.includes(c)) { const seg = s.slice(start, i + 1).trim(); if (seg) out.push(seg); start = i + 1; }
  }
  const tail = s.slice(start).trim(); if (tail) out.push(tail);
  return out;
}
// Mode "2 luồng song song": gom toàn bộ GỐC và DỊCH (theo thứ tự), tách câu, hiện 2 cột ĐỘC LẬP → mỗi cột luôn đúng (không ép khớp hàng).
function renderDual() {
  el.list.classList.add('dual');
  const oArr = [], tArr = [];
  for (const e of captions) {
    const ls = (e.lines && e.lines.length) ? e.lines : [{ o: e.original || '', t: e.translated || '' }];
    for (const l of ls) { if (l.o && l.o.trim()) oArr.push(l.o.trim()); if (l.t && l.t.trim()) tArr.push(l.t.trim()); }
  }
  const oS = _splitSent(oArr.join(' ')), tS = _splitSent(tArr.join(' '));
  el.list.innerHTML = '<div class="dual-col dual-o"></div><div class="dual-col dual-t"></div>';
  const oc = el.list.firstChild, tc = el.list.lastChild;
  for (const s of oS) { const d = document.createElement('div'); d.className = 'dual-line'; d.textContent = s; oc.appendChild(d); }
  for (const s of tS) { const d = document.createElement('div'); d.className = 'dual-line'; d.textContent = s; tc.appendChild(d); }
  refreshCount();
  if (autoScroll) el.list.scrollTop = el.list.scrollHeight;
}
function upsertRow(e) {
  let row = rowById.get(e.id);
  if (!row) {
    row = document.createElement('div'); row.className = 'entry';
    row.innerHTML = '<div class="entry-head"><span class="spacer"></span><span class="ts"></span></div><div class="entry-body"></div>';
    el.list.appendChild(row); rowById.set(e.id, row);
  }
  row.classList.toggle('partial', !!e.partial);
  row.querySelector('.ts').textContent = e.ts || '';
  const body = row.querySelector('.entry-body');
  const lines = (e.lines && e.lines.length) ? e.lines : [{ o: e.original || '', t: e.translated || '' }];
  const lay = curLayout();
  body.className = 'entry-body' + (lay === 'columns' ? ' cols' : '');
  body.innerHTML = '';
  for (const l of lines) {
    if (lay === 'columns') {   // 2 cột: gốc trái | dịch phải
      const o = document.createElement('div'); o.className = 'col-o'; o.textContent = l.o || '';
      const tt = document.createElement('div'); tt.className = 'col-t'; tt.textContent = l.t || '';
      body.appendChild(o); body.appendChild(tt);
    } else {
      if (lay === 'stacked' && l.o) { const d = document.createElement('div'); d.className = 'entry-orig'; d.textContent = l.o; body.appendChild(d); }
      if (l.t) { const d = document.createElement('div'); d.className = 'entry-text'; d.textContent = l.t; body.appendChild(d); }
    }
  }
  // "Chỉ dịch": hàng chưa có bản dịch (dịch đang về / model gộp câu) → ẩn cho gọn; có dịch thì hiện lại
  row.style.display = (lay === 'translation' && !body.childNodes.length) ? 'none' : '';
  refreshCount();
  if (autoScroll) el.list.scrollTop = el.list.scrollHeight;
}
function reRenderAll() {   // áp dụng lại khi đổi layout (xử lý cả vào/ra mode 2 luồng)
  if (curLayout() === 'dual') { renderDual(); return; }
  el.list.classList.remove('dual'); el.list.innerHTML = ''; rowById.clear();
  for (const e of captions) upsertRow(e);
}
function curLayout() { return S.transcribeMode ? 'translation' : (S.layout || 'translation'); }   // Chép lời → ép Chỉ dịch
function setLayoutActive() {
  const eff = curLayout();
  el.layoutPick.querySelectorAll('.lay-opt').forEach(b => {
    b.disabled = S.transcribeMode && b.dataset.layout !== 'translation';   // Chép lời → khoá 'Gốc trên/dưới' & '2 cột'
    b.classList.toggle('active', b.dataset.layout === eff);
  });
}
function applyZoom() { const z = (S.zoom || 100) / 100; el.list.style.zoom = z; el.summary.style.zoom = z; if (el.zoomVal) el.zoomVal.textContent = (S.zoom || 100) + '%'; }
function clearList() {
  saveSession(); _sessId = null;   // chốt + lưu phiên đang có trước khi xoá; phiên sau là phiên mới
  captions.length = 0; byId.clear(); rowById.clear(); el.list.classList.remove('dual'); el.list.innerHTML = ''; refreshCount();
  summaryMd = ''; sumPrevCount = 0; sumLastTime = 0; fullMd = ''; fullReport = null; showingReport = false; renderSummary();
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
// Level meter (chẩn đoán câm/có tiếng): _meterPeak = đỉnh khung hiện tại; _meterLastSig = lần cuối có tín hiệu thật; _meterDisp = mức hiển thị đã làm mượt.
let _meterPeak = 0, _meterLastSig = 0, _meterDisp = 0, _meterRAF = 0;
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
    // Đo mức tín hiệu (peak + rms) MỘT lần — dùng cho CẢ cổng im lặng (mic) LẪN level meter chẩn đoán câm/có tiếng.
    let peak = 0, sum = 0;
    for (let i = 0; i < ch.length; i++) { const v = ch[i], a = v < 0 ? -v : v; if (a > peak) peak = a; sum += v * v; }
    _meterPeak = peak; if (peak > 0.0015) _meterLastSig = lastTs;   // có mẫu khác 0 đáng kể → mốc "lần cuối nghe thấy tiếng"
    if (S.source === 'mic') {                 // CỔNG IM LẶNG: chỉ gửi khi có tiếng (+ giữ 700ms sau câu) → giảm dịch lặp/sai
      if (Math.sqrt(sum / ch.length) >= MIC_GATE_RMS) micVoiceUntil = lastTs + MIC_GATE_HANG_MS;
      if (lastTs > micVoiceUntil) return;     // im lặng kéo dài → KHÔNG gửi khung này
    }
    live.pushAudio(new Float32Array(ch));
  };
  srcNode.connect(procNode); procNode.connect(zeroGain); zeroGain.connect(audioCtx.destination);
  meterStart();   // bật thanh báo mức âm đang thu được (chẩn đoán câm/có tiếng)
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
  meterStop();
  try { if (procNode) { procNode.onaudioprocess = null; procNode.disconnect(); } } catch (e) {}
  try { if (srcNode) srcNode.disconnect(); } catch (e) {}
  try { if (zeroGain) zeroGain.disconnect(); } catch (e) {}
  try { if (audioCtx) audioCtx.close(); } catch (e) {}
  procNode = srcNode = zeroGain = audioCtx = null;
  rawStream?.getTracks().forEach(t => t.stop()); rawStream = null;
  try { if ('mediaSession' in navigator) { navigator.mediaSession.setActionHandler('enterpictureinpicture', null); navigator.mediaSession.playbackState = 'none'; } } catch (_) {}
}

// ── Level meter: hiện realtime mức âm ĐANG THU được → nhìn phát biết câm hay có tiếng (KHÔNG đụng luồng dịch) ──
function meterStart() {
  if (!el.levelMeter) return;
  el.levelMeter.classList.remove('hidden', 'silent');
  _meterDisp = 0; _meterLastSig = Date.now();   // chừa ~2.5s đầu (đang khởi động) trước khi cảnh báo "câm"
  cancelAnimationFrame(_meterRAF);
  const tick = () => {
    if (!recActive) return;
    // map peak → dB → 0..1 (dải -60dB..0dB cho mắt dễ nhìn); attack nhanh, release chậm để theo kịp
    const db = _meterPeak > 0.0001 ? 20 * Math.log10(_meterPeak) : -100;
    const target = Math.max(0, Math.min(1, (db + 60) / 60));
    _meterDisp = target > _meterDisp ? target : _meterDisp + (target - _meterDisp) * 0.2;
    if (el.lmCover) el.lmCover.style.left = (_meterDisp * 100).toFixed(1) + '%';
    const silent = Date.now() - _meterLastSig > 2500;   // có track nhưng >2.5s không mẫu nào khác 0 = câm
    el.levelMeter.classList.toggle('silent', silent);
    if (el.lmTxt) el.lmTxt.textContent = t(silent ? 'meter.silent' : 'meter.live');
    _meterRAF = requestAnimationFrame(tick);
  };
  _meterRAF = requestAnimationFrame(tick);
}
function meterStop() {
  cancelAnimationFrame(_meterRAF); _meterRAF = 0;
  _meterPeak = 0; _meterDisp = 0;
  if (el.lmCover) el.lmCover.style.left = '0%';
  if (el.levelMeter) el.levelMeter.classList.add('hidden');
  if (el.levelMeter) el.levelMeter.classList.remove('silent');
}

// ── Start / Stop ──────────────────────────────────────────────────────────────────
let running = false;
let _micPermTabId = null;        // tab xin quyền mic đang mở (cấp xong → đóng tab)
let _autoStartAfterGrant = false; // chỉ TỰ Bắt đầu sau khi cấp khi việc cấp đến từ nút Bắt đầu (không phải lúc mở extension)
function refreshStartBtn() {
  el.start.textContent = t(running ? 'btn.stop' : 'btn.start'); el.start.classList.toggle('on', running);
  // Nút "Tổng thể": chỉ bấm được khi ĐÃ DỪNG dịch → khóa hình thức (xám + not-allowed) + tooltip i18n khi đang chạy
  el.sumFull.classList.toggle('disabled', running);
  el.sumFull.setAttribute('aria-disabled', running ? 'true' : 'false');
  el.sumFull.title = t(running ? 'summary.fullDisabledTitle' : 'summary.fullTitle');
}
async function start() {
  if (running) return;
  if (!S.apiKey || !S.apiKey.trim()) { st('status.needKey', null, 'err'); el.settings.classList.remove('hidden'); return; }
  try {
    ensureGemCtx();                 // mở khoá AudioContext phát trong user-gesture
    live.start();
    await startCapture();
    running = true; if (!_sessId) { _sessId = Date.now(); _sessStart = _sessId; }   // mốc phiên (giữ qua start/stop tới khi xoá)
    refreshStartBtn(); refreshSpin(); showingReport = false;
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
  saveSession();   // lưu lịch sử phiên (snapshot đồng bộ rồi ghi IndexedDB)
  st('status.stopped');
}
// ── Lịch sử phiên (IndexedDB) ──────────────────────────────────────────────────────
let _sessId = null, _sessStart = 0;
function _capPairs() {   // snapshot caption hiện tại → [{o,t,ts}]
  return captions.map(e => {
    const ls = (e.lines && e.lines.length) ? e.lines : [{ o: e.original || '', t: e.translated || '' }];
    return { o: ls.map(l => l.o).filter(Boolean).join('\n'), t: ls.map(l => l.t).filter(Boolean).join('\n'), ts: e.ts || '' };
  });
}
// ── Chuyển phiên sang TAB MỚI (⧉) — KHÔNG mất transcript / không bắt đầu lại ──────────
// Stream (mic/loa) + WebSocket Gemini KHÔNG chuyển được giữa side panel↔tab (khác context),
// nên ta lưu snapshot vào storage; tab mới khôi phục transcript+tóm tắt và TỰ thu lại nguồn để dịch tiếp.
function _capSnapshot() {   // chụp caption ĐÃ CHỐT (giữ lines) để khôi phục đúng giao diện
  return captions.filter(e => !e.partial).map(e => ({
    author: e.author || '', original: e.original || '', translated: e.translated || '',
    lines: (e.lines && e.lines.length) ? e.lines : null, ts: e.ts || '',
  }));
}
async function _consumeHandoff() {   // tab mới: đọc + xoá blob, khôi phục captions/tóm tắt/id phiên; trả blob để quyết auto-start
  let h; try { const got = await chrome.storage.local.get('handoff'); h = got.handoff; } catch (_) {}
  if (h) { try { await chrome.storage.local.remove('handoff'); } catch (_) {} }
  if (!h || !Array.isArray(h.caps) || !h.caps.length || (Date.now() - (h.ts || 0) > 120000)) return null;
  if (h.sessId) { _sessId = h.sessId; _sessStart = h.sessStart || h.sessId; }   // tiếp tục CÙNG phiên lịch sử
  h.caps.forEach((c, i) => {
    const e = { id: 'h' + i, author: c.author || '', translated: c.translated || '', original: c.original || '',
      lines: c.lines || [{ o: c.original || '', t: c.translated || '' }], ts: c.ts || '', partial: false };
    captions.push(e); byId.set(e.id, e);
  });
  if (h.summaryMd) summaryMd = h.summaryMd;
  if (h.fullMd) { fullMd = h.fullMd; showingReport = false; }
  sumPrevCount = captions.length;   // KHÔNG tóm tắt lại phần đã khôi phục
  reRenderAll(); renderSummary(); refreshCount();
  return h;
}
function saveSession() {   // chụp đồng bộ rồi ghi (an toàn dù captions bị xoá ngay sau)
  if (!S.saveHistory || !_sessId || !captions.length) return;
  const s = { id: _sessId, startedAt: _sessStart, endedAt: Date.now(), langCode: S.langCode, transcribe: !!S.transcribeMode, count: captions.length, caps: _capPairs(), summaryMd, fullMd };
  hSave(s).catch(e => console.warn('[history] lưu lỗi:', e && e.message));
}
function _fmtDate(ts) { const d = new Date(ts), p = n => (n < 10 ? '0' : '') + n; return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function sessionToMd(s) {   // .md sạch: gốc (đậm) + xuống dòng (2 space cuối) + dịch, cách 1 dòng giữa các cặp — KHÔNG dùng bullet để khỏi lệch lề
  const out = [`# Transcript — ${_fmtDate(s.startedAt)} (${langName(s.langCode)})`, ''];
  for (const c of (s.caps || [])) {
    const o = (c.o || '').replace(/\n/g, ' ').trim(), tt = (c.t || '').replace(/\n/g, ' ').trim();
    if (o) out.push(`**${o}**  `);
    if (tt) out.push(tt);
    if (o || tt) out.push('');
  }
  if (s.fullMd || s.summaryMd) out.push('---', '', `# ${t('summary.title')}`, '', s.fullMd || s.summaryMd);
  return out.join('\n');
}
function sessionToHtmlDoc(s) {   // HTML export: dựng transcript trực tiếp (gốc/dịch CÙNG LỀ, không bullet) + tóm tắt qua md2html
  const SESS_CSS = REPORT_CSS + '.tx{margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid #eef1f5}.tx .o{color:#5a6573;font-size:13px;margin-bottom:2px}.tx .t{color:#1a1a1a;font-weight:500}';
  const esc = x => (x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  let body = `<div class="report"><h1>Transcript — ${esc(_fmtDate(s.startedAt))} (${esc(langName(s.langCode))})</h1>`;
  for (const c of (s.caps || [])) {
    const o = (c.o || '').trim(), tt = (c.t || '').trim(); if (!o && !tt) continue;
    body += '<div class="tx">' + (o ? `<div class="o">${esc(o)}</div>` : '') + (tt ? `<div class="t">${esc(tt)}</div>` : '') + '</div>';
  }
  if (s.fullMd || s.summaryMd) body += `<hr><h1>${esc(t('summary.title'))}</h1>` + md2html(s.fullMd || s.summaryMd);
  body += '</div>';
  return `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Transcript</title><style>${SESS_CSS}</style></head><body>${body}</body></html>`;
}
async function openHistory() {
  el.history.classList.remove('hidden'); el.histView.classList.add('hidden'); el.histList.classList.remove('hidden'); el.histBack.classList.add('hidden');
  el.histList.innerHTML = '<div class="hist-empty">…</div>';
  let items = []; try { items = await hList(); } catch (e) { console.warn('[history]', e); }
  if (!items.length) { el.histList.innerHTML = `<div class="hist-empty">${t('history.empty')}</div>`; return; }
  el.histList.innerHTML = '';
  for (const m of items) {
    const div = document.createElement('div'); div.className = 'hist-item';
    div.innerHTML = '<div class="hist-meta"><div class="hist-date"></div><div class="hist-sub"></div></div><div class="hist-acts">'
      + `<button class="mini" data-act="md" title="${t('history.exportMd')}">⬇MD</button><button class="mini" data-act="html" title="${t('history.exportHtml')}">⬇HTML</button><button class="mini" data-act="del" title="${t('history.del')}">🗑</button></div>`;
    div.querySelector('.hist-date').textContent = _fmtDate(m.startedAt);
    div.querySelector('.hist-sub').textContent = `${langName(m.langCode)} · ${t('history.lines', { n: m.count })}${m.hasSummary ? ' · 📋' : ''}`;
    div.querySelector('.hist-meta').addEventListener('click', () => viewSession(m.id));
    div.querySelector('[data-act="md"]').addEventListener('click', () => exportSess(m.id, 'md'));
    div.querySelector('[data-act="html"]').addEventListener('click', () => exportSess(m.id, 'html'));
    div.querySelector('[data-act="del"]').addEventListener('click', async () => { if (confirm(t('history.confirmDel'))) { try { await hDel(m.id); } catch (_) {} openHistory(); } });
    el.histList.appendChild(div);
  }
}
async function viewSession(id) {
  const s = await hGet(id); if (!s) return;
  el.histList.classList.add('hidden'); el.histView.classList.remove('hidden'); el.histBack.classList.remove('hidden');
  el.histView.innerHTML = '';
  for (const c of (s.caps || [])) {
    const e = document.createElement('div'); e.className = 'entry';
    if (c.o && c.o.trim()) { const o = document.createElement('div'); o.className = 'entry-orig'; o.textContent = c.o; e.appendChild(o); }
    if (c.t && c.t.trim()) { const tt = document.createElement('div'); tt.className = 'entry-text'; tt.textContent = c.t; e.appendChild(tt); }
    if (e.childNodes.length) el.histView.appendChild(e);
  }
  if (s.fullMd || s.summaryMd) { const sm = document.createElement('div'); sm.className = 'hist-sum summary-body'; sm.innerHTML = md2html(s.fullMd || s.summaryMd); el.histView.appendChild(sm); }
  el.histView.scrollTop = 0;
}
async function exportSess(id, kind) {
  const s = await hGet(id); if (!s) return;
  const stamp = _fmtDate(s.startedAt).replace(/[: ]/g, '-');
  if (kind === 'md') download(`transcript-${stamp}.md`, sessionToMd(s), 'text/markdown');
  else download(`transcript-${stamp}.html`, sessionToHtmlDoc(s), 'text/html');
}
// Backup TOÀN BỘ lịch sử ra 1 file JSON (chuyển máy / sao lưu — vì IndexedDB không sync theo tài khoản).
async function exportAllHistory() {
  let all = []; try { all = await hAll(); } catch (e) { console.warn('[history] export', e); }
  if (!all.length) { alert(t('history.empty')); return; }
  const blob = { app: 'captrans-history', version: 1, exportedAt: Date.now(), sessions: all };
  const stamp = _fmtDate(Date.now()).replace(/[: ]/g, '-');
  download(`captrans-history-${stamp}.json`, JSON.stringify(blob), 'application/json');
}
// Nhập lịch sử từ file JSON (merge theo id) → gộp với phiên đang có.
async function importHistory(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const sessions = Array.isArray(data) ? data : (data && data.sessions) || [];
    const n = await hImport(sessions);
    if (!n) { alert(t('history.importErr')); return; }
    alert(t('history.imported', { n })); openHistory();
  } catch (e) { console.warn('[history] import', e); alert(t('history.importErr')); }
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
let fullMd = '', showingReport = false;   // #5: tóm tắt tổng thể (markdown) + đang hiển thị bản HTML đẹp?
let fullReport = null;   // báo cáo Tổng thể có cấu trúc (JSON) → xuất HTML "y hệt"; null = markdown thường
const SUM_INTERVAL_MS = 60000, SUM_POLL_MS = 10000, SUM_MAX_CAPS_PER_CALL = 250;   // rolling cập nhật ~1 PHÚT/lần (không theo số câu); kiểm tra mỗi 10s; vẫn gửi gần hết câu mới (token nhẹ)
const SUM_MIN_FIRST = 8, SUM_MIN_FIRST_CHARS = 400;   // tóm tắt LẦN ĐẦU chỉ khi ĐỦ nội dung → chống LLM bịa lúc mới có 1-2 câu
const finalized = () => captions.filter(c => !c.partial);
async function summarizeTick() {
  if (sumBusy) return;
  const caps = finalized();
  const newCount = caps.length - sumPrevCount;
  const firstChars = caps.reduce((n, c) => n + ((c.translated || c.original || '').length), 0);
  const firstReady = sumLastTime === 0 && caps.length >= SUM_MIN_FIRST && firstChars >= SUM_MIN_FIRST_CHARS;
  const dueByTime = sumLastTime !== 0 && newCount > 0 && (Date.now() - sumLastTime) >= (SUM_INTERVAL_MS - SUM_POLL_MS);
  if (!(firstReady || dueByTime)) return;   // rolling: lần đầu khi ĐỦ nội dung, sau đó ~1 phút/lần MIỄN LÀ có câu mới (không có câu mới → bỏ qua, khỏi phí quota)
  sumBusy = true; refreshSpin();
  let newCaps = caps.slice(sumPrevCount);
  if (newCaps.length > SUM_MAX_CAPS_PER_CALL) newCaps = newCaps.slice(newCaps.length - SUM_MAX_CAPS_PER_CALL);
  try {
    const res = await summarizer.summarize({ prevSummary: summaryMd, captions: newCaps });
    if (res && res.ok) { summaryMd = res.markdown; showingReport = false; fullReport = null; renderSummary(); sumPrevCount = caps.length; sumLastTime = Date.now(); }
    else if (res && res.error !== 'empty') st('status.summaryErr', { err: res.error }, 'err');
  } catch (e) { st('status.summaryErr', { err: e.message }, 'err'); }
  finally { sumBusy = false; refreshSpin(); }
}
// Spinner = chỉ báo "đang chạy": hiện suốt khi đang dịch (running) và panel mở, hoặc khi có lệnh tóm tắt đang chạy. Stop → ẩn.
function refreshSpin() { el.sumSpin.classList.toggle('hidden', !((running && sumPanelOpen) || sumBusy)); }
// Overlay LỚN mờ ở giữa panel khi đang tạo BÁO CÁO TỔNG THỂ (tách khỏi spinner nhỏ của rolling).
function showFullOverlay(on) { if (el.sumOverlay) el.sumOverlay.classList.toggle('hidden', !on); }
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
    if (res && res.ok) { summaryMd = res.markdown; showingReport = false; fullReport = null; renderSummary(); sumPrevCount = caps.length; sumLastTime = Date.now(); }
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
function renderSummary() {
  el.summary.innerHTML = (showingReport && fullMd) ? reportBodyHtml(fullMd)
    : (summaryMd ? md2html(summaryMd) : `<em class="muted">${t('summary.empty')}</em>`);
}
// #5: render báo cáo tổng thể thành HTML "đẹp" (card mục + bảng) — tự sinh từ markdown, an toàn.
const REPORT_CSS = 'body{margin:0;background:#eef1f4;color:#19283a;font:16px/1.65 system-ui,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;padding:28px 16px}.report{max-width:840px;margin:0 auto;background:#fff;border:1px solid #e0e5eb;border-radius:10px;box-shadow:0 1px 2px rgba(25,40,58,.04),0 18px 44px -30px rgba(25,40,58,.3);padding:clamp(22px,4vw,46px)}.report>*:first-child{margin-top:0}.report h1{font-family:"Cambria","Georgia",serif;font-size:clamp(24px,4vw,33px);font-weight:700;line-height:1.2;letter-spacing:-.01em;margin:0 0 18px;padding-bottom:14px;border-bottom:3px solid #1b5e7e;color:#19283a}.report h2{font-family:"Cambria","Georgia",serif;font-size:clamp(19px,2.6vw,23px);font-weight:700;color:#154b64;margin:30px 0 12px;padding-left:14px;border-left:4px solid #1b5e7e;line-height:1.25}.report h3{font-size:15.5px;font-weight:700;color:#1b5e7e;margin:20px 0 8px}.report h4{font-size:14px;font-weight:700;color:#33414f;margin:16px 0 6px}.report p{margin:0 0 12px}.report ul,.report ol{margin:8px 0 14px;padding-left:24px}.report li{margin:5px 0;padding-left:3px}.report li::marker{color:#1b5e7e}.report strong{color:#16303f;font-weight:600}.report em{color:#5c6b7e}.report code{background:#eef1f5;color:#154b64;padding:1px 6px;border-radius:4px;font-size:.9em;font-family:Consolas,"Cascadia Code",monospace}.report blockquote{margin:12px 0;padding:8px 16px;border-left:3px solid #b5651d;background:#f7efe4;color:#6a5640;border-radius:0 6px 6px 0;font-style:italic}.report hr{border:0;border-top:1px solid #e0e5eb;margin:24px 0}.report .tbl-wrap{overflow-x:auto;border:1px solid #e0e5eb;border-radius:8px;margin:14px 0}.report table{border-collapse:collapse;width:100%;min-width:520px;font-size:14px;font-variant-numeric:tabular-nums}.report th{background:#1b5e7e;color:#fff;text-align:left;font-weight:600;font-size:12.5px;letter-spacing:.03em;padding:11px 14px;white-space:nowrap}.report td{padding:11px 14px;border-top:1px solid #e6eaef;vertical-align:top;color:#33414f;line-height:1.5}.report tbody tr:nth-child(even) td{background:#fafbfc}.report td:first-child{font-weight:600;color:#19283a}@media print{body{background:#fff;padding:0}.report{border:0;border-radius:0;box-shadow:none;max-width:none}.report h2,.report .tbl-wrap{break-inside:avoid}}';
function reportBodyHtml(md) { return '<div class="report">' + md2html(md) + '</div>'; }
function buildReportDoc(md) {
  return `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meeting report</title><style>${REPORT_CSS}</style></head><body>${reportBodyHtml(md)}</body></html>`;
}

// ════ BÁO CÁO "Y HỆT": JSON có cấu trúc (Gemini) → renderer cố định → HTML ════
const FANCY_CSS = `:root{--ground:#F4F6F8;--paper:#FFFFFF;--ink:#19283A;--muted:#5C6B7E;--faint:#8794A4;--accent:#1B5E7E;--accent-deep:#154B64;--accent-soft:#E8F0F3;--hair:#E0E5EB;--good:#2E7D5B;--good-soft:#E6F1EB;--plan:#1B5E7E;--plan-soft:#E8F0F3;--todo:#B5651D;--todo-soft:#F6EDE2;--warn:#B5651D;--warn-soft:#F7EFE4;--warn-line:#E9D4B6;--serif:"Cambria","Georgia","Times New Roman",serif;--sans:system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.sheet{max-width:900px;margin:0 auto;padding:clamp(20px,4vw,56px) clamp(14px,4vw,40px)}
.doc{background:var(--paper);border:1px solid var(--hair);border-radius:6px;box-shadow:0 1px 2px rgba(25,40,58,.04),0 18px 44px -30px rgba(25,40,58,.3);overflow:hidden}
.head{padding:clamp(28px,5vw,52px) clamp(24px,5vw,56px) clamp(24px,4vw,38px);border-top:4px solid var(--accent)}
.eyebrow{font-size:12.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}
.doc-title{font-family:var(--serif);font-weight:700;font-size:clamp(26px,4.2vw,38px);line-height:1.18;letter-spacing:-.01em;margin:0;text-wrap:balance;color:var(--ink)}
.meta{display:flex;flex-wrap:wrap;gap:12px 26px;margin-top:22px;padding-top:18px;border-top:1px solid var(--hair);font-size:14px;color:var(--muted)}
.meta .m-label{color:var(--faint);font-size:11px;letter-spacing:.08em;text-transform:uppercase;display:block;margin-bottom:2px}
.meta strong{color:var(--ink);font-weight:600}
.body{padding:0 clamp(24px,5vw,56px) clamp(20px,4vw,44px)}
section{padding:clamp(26px,3.5vw,36px) 0;border-top:1px solid var(--hair)}
.sec-head{display:flex;align-items:baseline;gap:14px;margin:0 0 18px}
.sec-num{font-family:var(--serif);font-size:15px;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums;min-width:1.4em}
.sec-title{font-family:var(--serif);font-size:clamp(21px,2.9vw,26px);font-weight:700;letter-spacing:-.005em;margin:0;color:var(--ink);text-wrap:balance}
.sub{margin-top:30px}
.sub:first-of-type{margin-top:4px}
.sub-title{font-size:13px;font-weight:700;letter-spacing:.04em;color:var(--accent-deep);margin:0 0 12px;display:flex;align-items:center;gap:10px}
.sub-title .ix{font-variant-numeric:tabular-nums;color:var(--accent);font-weight:700}
.sub-title::after{content:"";flex:1;height:1px;background:var(--hair)}
.body p{margin:0 0 12px;max-width:72ch;color:#33414f}
.points{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:13px}
.points>li{position:relative;padding-left:22px;max-width:72ch;color:#33414f}
.points>li::before{content:"";position:absolute;left:0;top:.62em;width:7px;height:7px;border-radius:2px;background:var(--accent);transform:rotate(45deg)}
.points b{color:var(--ink);font-weight:600}
.subpoints{list-style:none;margin:9px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}
.subpoints li{position:relative;padding-left:20px;color:var(--muted);font-size:15.5px;line-height:1.55}
.subpoints li::before{content:"";position:absolute;left:2px;top:.72em;width:9px;height:1.5px;background:var(--faint)}
.cardrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:4px 0 0}
.mcard{background:var(--ground);border:1px solid var(--hair);border-radius:6px;padding:16px 18px;border-top:3px solid var(--accent)}
.mcard h4{margin:0 0 6px;font-size:15px;font-weight:700;color:var(--ink);letter-spacing:.01em}
.mcard p{margin:0;font-size:14.5px;color:var(--muted);line-height:1.5;max-width:none}
.tbl-wrap{overflow-x:auto;border:1px solid var(--hair);border-radius:6px;margin:14px 0 0}
.doc table{border-collapse:collapse;width:100%;min-width:520px;font-size:15px;font-variant-numeric:tabular-nums}
.doc thead th{background:var(--accent);color:#fff;text-align:left;font-weight:600;font-size:12.5px;letter-spacing:.04em;text-transform:uppercase;padding:11px 14px;white-space:nowrap}
.doc tbody td{padding:13px 14px;border-top:1px solid var(--hair);vertical-align:top;color:#33414f;line-height:1.5}
.doc tbody tr:nth-child(even) td{background:#FAFBFC}
.doc tbody td:first-child{font-weight:600;color:var(--ink)}
.stat{display:flex;align-items:center;gap:20px;flex-wrap:wrap;background:linear-gradient(180deg,#1B5E7E,#154B64);color:#fff;border-radius:8px;padding:20px 24px;margin-top:14px}
.stat-fig{font-family:var(--serif);font-size:clamp(28px,5vw,40px);font-weight:700;line-height:1;letter-spacing:-.01em}
.stat-cap{font-size:14px;color:#CFE2EA;max-width:46ch;line-height:1.45;margin:0}
.decisions{display:flex;flex-direction:column;gap:14px;margin-top:4px}
.decision{display:grid;grid-template-columns:152px 1fr;gap:8px 20px;align-items:start;padding:16px 18px;background:var(--ground);border:1px solid var(--hair);border-left:3px solid var(--accent);border-radius:5px}
.decision.is-done{border-left-color:var(--good)}
.decision.is-plan{border-left-color:var(--plan)}
.decision.is-todo{border-left-color:var(--todo)}
.decision p{margin:0;color:#33414f;font-size:15.5px;line-height:1.55;max-width:none}
.tag{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;padding:5px 11px;border-radius:999px;white-space:nowrap;align-self:start}
.tag::before{content:"";width:7px;height:7px;border-radius:50%}
.is-done .tag{color:var(--good);background:var(--good-soft)}
.is-done .tag::before{background:var(--good)}
.is-plan .tag{color:var(--plan);background:var(--plan-soft)}
.is-plan .tag::before{background:var(--plan)}
.is-todo .tag{color:var(--todo);background:var(--todo-soft)}
.is-todo .tag::before{background:var(--todo)}
.problems{display:flex;flex-direction:column;gap:14px;margin-top:4px}
.prob{background:var(--warn-soft);border:1px solid var(--warn-line);border-left:3px solid var(--warn);border-radius:6px;padding:15px 18px}
.prob h4{margin:0 0 7px;font-size:15px;font-weight:700;color:#7d4513;letter-spacing:.01em}
.prob p{margin:0;color:#5b4a36;font-size:15px;line-height:1.55;max-width:none}
.prob .subpoints li{color:#6a5640}
.prob .subpoints li::before{background:var(--warn)}
.foot{padding:18px clamp(24px,5vw,56px) 26px;border-top:1px solid var(--hair);font-size:12.5px;color:var(--faint);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
@media(max-width:540px){.decision{grid-template-columns:1fr;gap:10px}.stat{gap:8px}}
@media print{body{background:#fff}.sheet{padding:0;max-width:none}.doc{border:0;border-radius:0;box-shadow:none}section,.tbl-wrap,.stat,.prob,.decision,.mcard{break-inside:avoid}}`;
function _fesc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _finl(s) { return _fesc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>'); }
function _fsub(sub) { return (sub && sub.length) ? ('<ul class="subpoints">' + sub.map(x => `<li>${_finl(x)}</li>`).join('') + '</ul>') : ''; }
function _flbl(p) { return p.label ? `<b>${_fesc(p.label)}${/[:：]\s*$/.test(p.label) ? '' : ':'}</b> ` : ''; }
function _fcells(r) { return Array.isArray(r) ? r : ((r && r.cells) || []); }
function _fhasTable(t) { return t && ((t.columns && t.columns.length) || (t.rows && t.rows.length)); }
const _FSCLS = { done: 'is-done', plan: 'is-plan', todo: 'is-todo' };
function _fblocks(o, warn) {
  let h = '';
  if (o.intro) h += `<p>${_finl(o.intro)}</p>`;
  if (o.points && o.points.length) h += warn
    ? '<div class="problems">' + o.points.map(p => `<div class="prob">${p.label ? `<h4>${_fesc(p.label)}</h4>` : ''}${p.text ? `<p>${_finl(p.text)}</p>` : ''}${_fsub(p.sub)}</div>`).join('') + '</div>'
    : '<ul class="points">' + o.points.map(p => `<li>${_flbl(p)}${_finl(p.text)}${_fsub(p.sub)}</li>`).join('') + '</ul>';
  if (o.cards && o.cards.length) h += '<div class="cardrow">' + o.cards.map(c => `<div class="mcard">${c.title ? `<h4>${_fesc(c.title)}</h4>` : ''}<p>${_finl(c.text)}</p></div>`).join('') + '</div>';
  if (o.stat && o.stat.value) h += `<div class="stat"><span class="stat-fig">${_fesc(o.stat.value)}</span>${o.stat.caption ? `<p class="stat-cap">${_finl(o.stat.caption)}</p>` : ''}</div>`;
  if (_fhasTable(o.table)) h += `<div class="tbl-wrap"><table><thead><tr>${(o.table.columns || []).map(c => `<th>${_finl(c)}</th>`).join('')}</tr></thead><tbody>${(o.table.rows || []).map(r => `<tr>${_fcells(r).map(c => `<td>${_finl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  if (o.decisions && o.decisions.length) h += '<div class="decisions">' + o.decisions.map(d => `<div class="decision ${_FSCLS[d.status] || 'is-plan'}"><span class="tag">${_fesc(d.label)}</span><p>${_finl(d.text)}</p></div>`).join('') + '</div>';
  return h;
}
function renderReport(r) {
  r = r || {};
  const meta = (r.meta || []).filter(m => m && m.value).map(m => `<div><span class="m-label">${_fesc(m.label)}</span><strong>${_fesc(m.value)}</strong></div>`).join('');
  const head = `<header class="head">${r.eyebrow ? `<p class="eyebrow">${_fesc(r.eyebrow)}</p>` : ''}<h1 class="doc-title">${_fesc(r.title || 'Báo cáo cuộc họp')}</h1>${meta ? `<div class="meta">${meta}</div>` : ''}</header>`;
  const body = '<div class="body">' + (r.sections || []).map((s, i) => {
    const num = String(i + 1).padStart(2, '0'), warn = s.tone === 'warn';
    let inner = _fblocks(s, warn);
    if (s.subs && s.subs.length) inner += s.subs.map((sub, j) => `<div class="sub"><p class="sub-title"><span class="ix">${i + 1}.${j + 1}</span> ${_fesc(sub.title)}</p>${_fblocks(sub, sub.tone === 'warn')}</div>`).join('');
    return `<section><div class="sec-head"><span class="sec-num">${num}</span><h2 class="sec-title">${_fesc(s.heading)}</h2></div>${inner}</section>`;
  }).join('') + '</div>';
  const foot = r.footer ? `<footer class="foot"><span>${_fesc(r.footer)}</span></footer>` : '';
  return `<div class="sheet"><article class="doc">${head}${body}${foot}</article></div>`;
}
function buildFancyDoc(r) {
  return `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${_fesc(r && r.title || 'Báo cáo cuộc họp')}</title><style>${FANCY_CSS}</style></head><body>${renderReport(r)}</body></html>`;
}
function reportToMd(r) {
  r = r || {}; const L = [];
  if (r.title) L.push('# ' + r.title);
  for (const m of (r.meta || [])) if (m && m.value) L.push(`- **${m.label}:** ${m.value}`);
  const blk = o => {
    if (o.intro) { L.push(''); L.push(o.intro); }
    for (const p of (o.points || [])) { L.push((p.label ? `- **${p.label}:** ` : '- ') + (p.text || '')); for (const s of (p.sub || [])) L.push('    - ' + s); }
    for (const c of (o.cards || [])) L.push(`- **${c.title || ''}:** ${c.text || ''}`);
    if (o.stat && o.stat.value) { L.push(''); L.push(`**${o.stat.value}** — ${o.stat.caption || ''}`); }
    if (o.table && o.table.columns && o.table.columns.length) { L.push(''); L.push('| ' + o.table.columns.join(' | ') + ' |'); L.push('| ' + o.table.columns.map(() => '---').join(' | ') + ' |'); for (const row of (o.table.rows || [])) L.push('| ' + _fcells(row).join(' | ') + ' |'); }
    for (const d of (o.decisions || [])) L.push(`- **${d.label}:** ${d.text || ''}`);
  };
  (r.sections || []).forEach((s, i) => { L.push(''); L.push(`## ${i + 1}. ${s.heading}`); blk(s); (s.subs || []).forEach((sub, j) => { L.push(''); L.push(`### ${i + 1}.${j + 1}. ${sub.title}`); blk(sub); }); });
  return L.join('\n');
}

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
      const head = cells(ln); i += 2; out.push('<div class="tbl-wrap"><table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>');
      while (i < lines.length && lines[i].includes('|')) { out.push('<tr>' + cells(lines[i]).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>'); i++; }
      out.push('</tbody></table></div>'); continue;
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
function buildVoiceButton() {
  el.voiceBtn.textContent = S.geminiAudioOn ? '🔊' : '🔇';
  el.voiceBtn.style.display = S.transcribeMode ? 'none' : '';   // chép lời → không có TTS
}
function buildVoiceMenu() {
  el.voiceMenu.innerHTML = '';
  const off = document.createElement('button'); off.type = 'button'; off.textContent = t('voice.off');
  if (!S.geminiAudioOn) off.classList.add('sel');
  off.addEventListener('click', () => { save({ geminiAudioOn: false }); live.setAudioOn(false); buildVoiceButton(); closeMenus(); });
  el.voiceMenu.appendChild(off);
  for (const v of GEM_VOICES) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '🔊 ' + v;
    if (S.geminiAudioOn && S.geminiVoice === v) b.classList.add('sel');
    b.addEventListener('click', () => {
      const changed = v !== S.geminiVoice;
      save({ geminiAudioOn: true, geminiVoice: v }); live.setAudioOn(true);
      if (changed && running) live.onVoiceChanged();   // đổi giọng → reconnect áp dụng ngay (~1.5s)
      buildVoiceButton(); closeMenus();
    });
    el.voiceMenu.appendChild(b);
  }
}
function buildTargetButton() {   // toolbar: gọn — chỉ cờ (hoặc 📝 khi chép lời)
  el.targetBtn.innerHTML = S.transcribeMode ? '<span>📝</span>' : `<span class="flag">${flag(S.langCode)}</span>`;
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
  for (const L of TARGET_LANGS) {
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
  buildVoiceButton();   // chép lời → ẩn nút giọng
  buildTargetButton();
  setLayoutActive(); reRenderAll();   // chép lời → ép layout Chỉ dịch + khoá radio; khôi phục khi tắt
}
function closeMenus() { el.langMenu.classList.add('hidden'); el.targetMenu.classList.add('hidden'); el.voiceMenu.classList.add('hidden'); }

function applyLocale(code) {
  setLocale(code); save({ uiLang: code });
  applyI18n(document);
  buildVoiceButton(); buildTargetButton(); refreshStartBtn(); refreshCount(); renderSummary();
  el.langBtn.innerHTML = GLOBE;
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
const _resume = new URLSearchParams(location.search).get('resume') === '1';   // tab mở từ ⧉ → khôi phục phiên đang dịch (không bắt đầu lại)
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
      const wasRunning = running;
      try {                                                      // chuyển phiên sang tab mới (transcript + tóm tắt + id phiên + đang-chạy)
        await chrome.storage.local.set({ handoff: {
          caps: _capSnapshot(), summaryMd, fullMd, sessId: _sessId, sessStart: _sessStart,
          wasRunning, source: S.source, ts: Date.now(),
        } });
      } catch (_) {}
      if (running) stop();                                       // nhả mic/loa (stream không chuyển context được; tab mới tự thu lại)
      let prev = '';
      try { const [act] = await chrome.tabs.query({ active: true, currentWindow: true }); if (act && act.id != null) prev = '&prev=' + act.id; } catch (_) {}   // nhớ tab nội dung để trả focus sau khi bật PiP
      await chrome.tabs.create({ url: chrome.runtime.getURL(page + '?popup=1&resume=1' + prev), active: true });   // TAB → tự khôi phục + tiếp tục dịch
      window.close();                                            // đóng Side Panel đang mở
    } catch (e) { st('status.popoutErr', { err: e && e.message }, 'err'); }
  });
  // Dropdown ngôn ngữ giao diện (cờ) + ngôn ngữ đích (cờ)
  el.langBtn.addEventListener('click', (e) => { e.stopPropagation(); const show = el.langMenu.classList.contains('hidden'); closeMenus(); if (show) { buildLangMenu(); el.langMenu.classList.remove('hidden'); } });
  el.targetBtn.addEventListener('click', (e) => { e.stopPropagation(); const show = el.targetMenu.classList.contains('hidden'); closeMenus(); if (show) { buildTargetMenu(); el.targetMenu.classList.remove('hidden'); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.dd')) closeMenus(); });

  el.apikey.addEventListener('input', () => { save({ apiKey: el.apikey.value.trim() }); clearTimeout(keyTimer); keyTimer = setTimeout(checkKey, 600); });
  el.source.addEventListener('change', () => { save({ source: el.source.value }); if (el.source.value === 'mic') ensureMicPermission(); });   // chọn Micro → xin quyền luôn
  el.voiceBtn.addEventListener('click', (e) => { e.stopPropagation(); const show = el.voiceMenu.classList.contains('hidden'); closeMenus(); if (show) { buildVoiceMenu(); el.voiceMenu.classList.remove('hidden'); } });
  el.start.addEventListener('click', () => running ? stop() : start());
  el.clear.addEventListener('click', clearList);
  el.export.addEventListener('click', exportTranscript);
  el.historyBtn.addEventListener('click', openHistory);
  el.histClose.addEventListener('click', () => el.history.classList.add('hidden'));
  el.histBack.addEventListener('click', openHistory);
  el.histExport.addEventListener('click', exportAllHistory);
  el.histImport.addEventListener('click', () => el.histImportFile.click());
  el.histImportFile.addEventListener('change', (ev) => { const f = ev.target.files && ev.target.files[0]; importHistory(f); ev.target.value = ''; });
  el.saveHistory.addEventListener('change', () => save({ saveHistory: el.saveHistory.checked }));
  el.layoutPick.addEventListener('click', (ev) => { const b = ev.target.closest('.lay-opt'); if (!b || b.disabled) return; save({ layout: b.dataset.layout }); setLayoutActive(); reRenderAll(); });
  el.zoom.addEventListener('input', () => { save({ zoom: +el.zoom.value }); applyZoom(); });
  el.autoscroll.addEventListener('click', () => { autoScroll = !autoScroll; el.autoscroll.classList.toggle('active', autoScroll); if (autoScroll) el.list.scrollTop = el.list.scrollHeight; });
  el.list.addEventListener('scroll', () => { const near = el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 40; autoScroll = near; el.autoscroll.classList.toggle('active', near); });
  el.summaryToggle.addEventListener('click', () => sumPanelOpen ? closeSummary() : openSummary());
  el.sumDlHtml.addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (fullReport) { download(`bao-cao-${stamp}.html`, buildFancyDoc(fullReport), 'text/html'); return; }   // báo cáo Tổng thể → giao diện y hệt
    const md = fullMd || summaryMd; if (md) download(`${fullMd ? 'report' : 'summary'}-${stamp}.html`, buildReportDoc(md), 'text/html');
  });
  el.sumExport.addEventListener('click', () => { if (summaryMd) download(`summary-${new Date().toISOString().slice(0, 10)}.md`, summaryMd, 'text/markdown'); });
  el.sumFull.addEventListener('click', async () => {
    if (running) { st('status.stopFirst'); return; }
    const caps = finalized(); if (!caps.length) { st('status.noContent'); return; }
    st('status.makingFull'); sumBusy = true; refreshSpin(); showFullOverlay(true);
    try {
      let rep = null;
      try { const sr = await summarizer.summarizeFullStructured(caps); if (sr && sr.ok) rep = sr.report; } catch (e) {}
      if (rep) {   // JSON cấu trúc → preview markdown + ⬇HTML dựng giao diện y hệt
        fullReport = rep; fullMd = summaryMd = reportToMd(rep); showingReport = true; renderSummary(); el.summaryWrap.classList.remove('hidden'); st('status.fullDone');
      } else {     // fallback: báo cáo markdown như cũ
        const r = await summarizer.summarizeFull(caps);
        if (r && r.ok) { fullReport = null; fullMd = summaryMd = r.markdown; showingReport = true; renderSummary(); el.summaryWrap.classList.remove('hidden'); st('status.fullDone'); }
        else st('status.fullErr', { err: r && r.error }, 'err');
      }
    } catch (e) { st('status.fullErr', { err: e.message }, 'err'); }
    finally { sumBusy = false; refreshSpin(); showFullOverlay(false); }
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
  if (!['vi', 'en', 'ja'].includes(S.uiLang)) save({ uiLang: 'vi' });   // ko/zh đã gỡ → về vi
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
  setLayoutActive();
  el.zoom.value = S.zoom; applyZoom();
  el.saveHistory.checked = S.saveHistory !== false;
  buildVoiceButton();
  buildTargetButton();
  el.langBtn.innerHTML = GLOBE;
  applyI18n(document); refreshStartBtn(); refreshCount(); renderSummary();
  initResizer(); wire();
  if (S.apiKey) checkKey();
  if (_isPopup && _resume) {                                                  // tab mở từ ⧉ → khôi phục phiên đang dịch
    const h = await _consumeHandoff();
    if (h && h.wasRunning && h.source === 'mic') { start(); }                 // mic: thu lại được ngay → tiếp tục dịch không gián đoạn
    else if (h && h.wasRunning) { st('status.resumePick', null, 'run'); }     // screen/tab: trình duyệt bắt chọn lại nguồn 1 lần
    else if (h) { st('status.resumed', null, 'run'); }                        // đã dừng nhưng khôi phục transcript
    else { st(S.apiKey ? 'status.ready' : 'status.readyNoKey'); if (S.source === 'mic') ensureMicPermission(); }
  } else {
    st(S.apiKey ? 'status.ready' : 'status.readyNoKey');
    if (S.source === 'mic') ensureMicPermission();   // mở extension + đang chọn Micro + chưa cấp quyền → xử lý cấp luôn
  }
})();
