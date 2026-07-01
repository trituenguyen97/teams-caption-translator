// app.js — controller cho side panel. Thu (mic/màn hình) → Gemini Live → list + TTS + tóm tắt.
import { createLiveTranslator, validateKey } from './lib/gemini-live.js';
import { createSummarizer } from './lib/gemini-text.js';
import { LANG_LABELS } from './lib/langs.js';
import { GEM_VOICES, DEFAULT_VOICE } from './lib/voices.js';
import { I18N_LOCALES, flag, t, setLocale, currentLocale, applyI18n } from './lib/i18n.js';
import { hSave, hList, hGet, hDel, hAll, hImport } from './lib/history.js';

// ── State + lưu trữ ────────────────────────────────────────────────────────────
const DEFAULTS = {
  apiKey: '', langCode: 'vi', geminiVoice: DEFAULT_VOICE,
  geminiAudioOn: true, source: 'mic', summaryExtra: '', uiLang: 'vi', layout: 'translation', zoom: 100, saveHistory: true,
  summaryView: 'html',   // hiển thị rolling: 'html' (landing-page iframe) | 'md' (markdown)
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
  sumView: $('sum-view'), sumFull: $('sum-full'), sumDlHtml: $('sum-dlhtml'), sumExport: $('sum-export'),
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
  getState: () => ({ apiKey: S.apiKey, langCode: S.langCode, geminiAudioOn: S.geminiAudioOn, geminiVoice: S.geminiVoice }),
  onCaption: addCaption,
  onAudio: playAudio,
  onClear: clearAudio,
  onStatus: ({ error }) => { if (error === 'no-key') st('status.noKeyShort', null, 'err'); else if (error) st('status.geminiErr', { err: error }, 'err'); },
});
const summarizer = createSummarizer({
  getState: () => ({ apiKey: S.apiKey, targetLangLabel: LANG_LABELS[S.langCode] || 'tiếng Việt', summaryExtra: S.summaryExtra }),
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
function curLayout() { return S.layout || 'translation'; }
function setLayoutActive() {
  const eff = curLayout();
  el.layoutPick.querySelectorAll('.lay-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.layout === eff);
  });
}
function applyZoom() { const z = (S.zoom || 100) / 100; el.list.style.zoom = z; el.summary.style.zoom = z; if (el.zoomVal) el.zoomVal.textContent = (S.zoom || 100) + '%'; }
function clearList() {
  saveSession(); _sessId = null;   // chốt + lưu phiên đang có trước khi xoá; phiên sau là phiên mới
  captions.length = 0; byId.clear(); rowById.clear(); el.list.classList.remove('dual'); el.list.innerHTML = ''; refreshCount();
  summaryMd = ''; sumPrevCount = 0; sumLastTime = 0; fullReport = null; renderSummary();
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
  // Nút "Tổng thể" (📊) luôn bấm được: rolling vốn đã dựng landing-page, nên ép tạo lại ngay cũng OK kể cả khi đang dịch.
}
async function start() {
  if (running) return;
  if (!S.apiKey || !S.apiKey.trim()) { st('status.needKey', null, 'err'); el.settings.classList.remove('hidden'); return; }
  try {
    ensureGemCtx();                 // mở khoá AudioContext phát trong user-gesture
    live.start();
    await startCapture();
    running = true; if (!_sessId) { _sessId = Date.now(); _sessStart = _sessId; }   // mốc phiên (giữ qua start/stop tới khi xoá)
    refreshStartBtn(); refreshSpin();
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
    lines: (e.lines && e.lines.length) ? e.lines : null, ts: e.ts || '', tsMs: e.tsMs || null,
  }));
}
async function _consumeHandoff() {   // tab mới: đọc + xoá blob, khôi phục captions/tóm tắt/id phiên; trả blob để quyết auto-start
  let h; try { const got = await chrome.storage.local.get('handoff'); h = got.handoff; } catch (_) {}
  if (h) { try { await chrome.storage.local.remove('handoff'); } catch (_) {} }
  if (!h || !Array.isArray(h.caps) || !h.caps.length || (Date.now() - (h.ts || 0) > 120000)) return null;
  if (h.sessId) { _sessId = h.sessId; _sessStart = h.sessStart || h.sessId; }   // tiếp tục CÙNG phiên lịch sử
  h.caps.forEach((c, i) => {
    const e = { id: 'h' + i, author: c.author || '', translated: c.translated || '', original: c.original || '',
      lines: c.lines || [{ o: c.original || '', t: c.translated || '' }], ts: c.ts || '', tsMs: c.tsMs || null, partial: false };
    captions.push(e); byId.set(e.id, e);
  });
  if (h.summaryMd) summaryMd = h.summaryMd;
  if (h.report) { fullReport = h.report; summaryMd = reportToMd(h.report); }
  sumPrevCount = captions.length;   // KHÔNG tóm tắt lại phần đã khôi phục
  reRenderAll(); renderSummary(); refreshCount();
  return h;
}
function saveSession() {   // chụp đồng bộ rồi ghi (an toàn dù captions bị xoá ngay sau)
  if (!S.saveHistory || !_sessId || !captions.length) return;
  const s = { id: _sessId, startedAt: _sessStart, endedAt: Date.now(), langCode: S.langCode, count: captions.length, caps: _capPairs(), summaryMd, report: fullReport };
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
  const _sum = s.report ? reportToMd(s.report) : (s.summaryMd || s.fullMd || '');
  if (_sum) out.push('---', '', `# ${t('summary.title')}`, '', _sum);
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
  const _sum = s.report ? reportToMd(s.report) : (s.summaryMd || s.fullMd || '');
  if (_sum) body += `<hr><h1>${esc(t('summary.title'))}</h1>` + md2html(_sum);
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
  let showOrig = S.layout !== 'translation';                      // transcript: mặc định theo layout đang dùng (translation → chỉ dịch)
  let sumView = (s.report && S.summaryView !== 'md') ? 'html' : 'md';   // tóm tắt: html nếu có báo cáo cấu trúc + đang chọn html
  el.histView.innerHTML = '';

  // Thanh công cụ NGAY TRÊN chi tiết: layout transcript (chỉ dịch / gốc + dịch) + đổi HTML↔MD cho tóm tắt.
  const bar = document.createElement('div'); bar.className = 'hist-detail-bar';
  const bTrans = document.createElement('button'); bTrans.className = 'mini'; bTrans.textContent = t('histview.transOnly');
  const bBoth = document.createElement('button'); bBoth.className = 'mini'; bBoth.textContent = t('histview.bilingual');
  bar.appendChild(bTrans); bar.appendChild(bBoth);
  const sp = document.createElement('span'); sp.className = 'spacer'; bar.appendChild(sp);
  let bView = null;
  if (s.report) { bView = document.createElement('button'); bView.className = 'mini'; bView.title = t('summary.viewToggleTitle'); bar.appendChild(bView); }
  el.histView.appendChild(bar);

  const tx = document.createElement('div'); tx.className = 'hist-tx'; el.histView.appendChild(tx);
  const sm = document.createElement('div'); sm.className = 'hist-sum-wrap'; el.histView.appendChild(sm);

  function renderTx() {
    bTrans.classList.toggle('active', !showOrig); bBoth.classList.toggle('active', showOrig);
    tx.innerHTML = '';
    for (const c of (s.caps || [])) {
      const e = document.createElement('div'); e.className = 'entry';
      if (showOrig && c.o && c.o.trim()) { const o = document.createElement('div'); o.className = 'entry-orig'; o.textContent = c.o; e.appendChild(o); }
      if (c.t && c.t.trim()) { const tt = document.createElement('div'); tt.className = 'entry-text'; tt.textContent = c.t; e.appendChild(tt); }
      if (e.childNodes.length) tx.appendChild(e);
    }
  }
  function renderSum() {
    if (bView) { bView.textContent = sumView === 'html' ? 'HTML' : 'MD'; bView.classList.toggle('active', sumView === 'html'); }
    sm.innerHTML = '';
    if (s.report && sumView === 'html') {   // landing-page "y hệt" qua iframe cô lập
      const fr = document.createElement('iframe'); fr.className = 'report-frame hist-frame'; fr.setAttribute('sandbox', 'allow-same-origin'); fr.srcdoc = buildFancyDoc(s.report); sm.appendChild(fr);
    } else {
      const md = s.report ? reportToMd(s.report) : (s.summaryMd || s.fullMd || '');
      if (md) { const d = document.createElement('div'); d.className = 'hist-sum summary-body'; d.innerHTML = md2html(md); sm.appendChild(d); }
    }
  }
  bTrans.addEventListener('click', () => { showOrig = false; renderTx(); });
  bBoth.addEventListener('click', () => { showOrig = true; renderTx(); });
  if (bView) bView.addEventListener('click', () => { sumView = sumView === 'html' ? 'md' : 'html'; renderSum(); });
  renderTx(); renderSum();
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
let fullReport = null;   // báo cáo có cấu trúc (JSON landing-page) → nguồn DUY NHẤT dựng HTML + preview iframe; null = chưa có. summaryMd = bản markdown soi chiếu (export MD / fallback hiển thị).
const SUM_INTERVAL_MS = 60000, SUM_POLL_MS = 10000;   // rolling cập nhật báo cáo ~1 PHÚT/lần (incremental: chỉ câu mới); kiểm tra mỗi 10s
const SUM_MIN_FIRST = 8, SUM_MIN_FIRST_CHARS = 400;   // tóm tắt LẦN ĐẦU chỉ khi ĐỦ nội dung → chống LLM bịa lúc mới có 1-2 câu
const finalized = () => captions.filter(c => !c.partial);
// Dữ kiện CHÍNH XÁC cho hero.meta/stats (ngày, thời lượng, người, số dòng) — model không phải đoán.
function summaryFacts() {
  const caps = finalized();
  const authors = [...new Set(caps.map(c => (c.author || '').trim()).filter(a => a && !/^STT$/i.test(a)))];
  const startMs = _sessStart || (caps[0] && caps[0].tsMs) || 0;
  const endMs = (caps[caps.length - 1] && caps[caps.length - 1].tsMs) || Date.now();
  let duration = '';
  if (startMs && endMs > startMs) { const m = Math.max(1, Math.round((endMs - startMs) / 60000)); duration = m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`; }
  return { date: startMs ? _fmtDate(startMs).slice(0, 10) : '', duration, participants: authors, lineCount: caps.length };
}
// Dựng/ cập nhật báo cáo + FALLBACK markdown (chuỗi có gemma) khi flash-lite lỗi/hết quota → panel luôn có nội dung.
// prev != null → incremental (sendCaps = CHỈ câu mới). Trả {kind:'report'|'markdown'|'empty'|'error', error?}.
async function makeReport(sendCaps, prev, allCaps, n) {
  let res = null;
  try { res = await summarizer.summarizeReport(sendCaps, summaryFacts(), prev); } catch (e) { res = { ok: false, error: e.message }; }
  if (res && res.ok) { fullReport = res.report; summaryMd = reportToMd(res.report); renderSummary(); sumPrevCount = n; return { kind: 'report' }; }
  if (res && res.error === 'empty') return { kind: 'empty' };
  let mr = null;   // flash-lite hỏng/hết quota → markdown qua flash-lite→gemma→gemma (gemma TPM ∞, RPD 1500)
  try { mr = await summarizer.summarizeFull(allCaps); } catch (e) { mr = { ok: false, error: e.message }; }
  if (mr && mr.ok) { fullReport = null; summaryMd = mr.markdown; renderSummary(); sumPrevCount = n; return { kind: 'markdown' }; }
  return { kind: 'error', error: (mr && mr.error) || (res && res.error) || 'failed' };
}
async function summarizeTick() {
  if (sumBusy) return;
  const caps = finalized();
  const newCount = caps.length - sumPrevCount;
  const firstChars = caps.reduce((n, c) => n + ((c.translated || c.original || '').length), 0);
  const firstReady = sumLastTime === 0 && caps.length >= SUM_MIN_FIRST && firstChars >= SUM_MIN_FIRST_CHARS;
  const dueByTime = sumLastTime !== 0 && newCount > 0 && (Date.now() - sumLastTime) >= (SUM_INTERVAL_MS - SUM_POLL_MS);
  if (!(firstReady || dueByTime)) return;   // rolling: lần đầu khi ĐỦ nội dung, sau đó ~2.5 phút/lần MIỄN LÀ có câu mới (không có câu mới → bỏ qua, khỏi phí quota)
  sumBusy = true; refreshSpin();
  const n = caps.length; sumLastTime = Date.now();   // chốt nhịp NGAY (kể cả khi lỗi/cooldown) → không spam mỗi 10s
  try {
    const prev = fullReport;                                   // đã có báo cáo → CẬP NHẬT incremental (chỉ gửi câu mới)
    const sendCaps = prev ? caps.slice(sumPrevCount) : caps;   // lần đầu/ sau fallback → gửi toàn bộ để dựng đủ
    const r = await makeReport(sendCaps, prev, caps, n);
    if (r.kind === 'error') st('status.summaryErr', { err: r.error }, 'err');
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
  sumLastTime = Date.now();
  try {
    const r = await makeReport(caps, null, caps, caps.length);   // áp prompt mới → dựng LẠI từ đầu (full)
    if (r.kind === 'error') st('status.summaryErr', { err: r.error }, 'err');
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
  const showHtml = !!fullReport && S.summaryView !== 'md';   // có báo cáo cấu trúc + chọn HTML → iframe; ngược lại → markdown
  if (showHtml) {   // landing-page "y hệt" trong iframe cô lập (style không lẫn với panel; checkbox bấm được)
    el.summary.classList.add('has-report'); el.summary.innerHTML = '';
    const f = document.createElement('iframe');
    f.className = 'report-frame'; f.setAttribute('sandbox', 'allow-same-origin');   // không allow-scripts → script reveal tắt, nhưng nội dung vẫn hiện đủ
    f.srcdoc = buildFancyDoc(fullReport);
    el.summary.appendChild(f);
  } else {
    el.summary.classList.remove('has-report');
    el.summary.innerHTML = summaryMd ? md2html(summaryMd) : `<em class="muted">${t('summary.empty')}</em>`;
  }
  _updateViewBtn();
}
// Nút HTML↔MD: chỉ bật khi CÓ báo cáo cấu trúc (mới có 2 dạng để đổi); markdown-fallback thuần → ẩn.
function _updateViewBtn() {
  if (!el.sumView) return;
  el.sumView.hidden = !fullReport;
  const showHtml = !!fullReport && S.summaryView !== 'md';
  el.sumView.textContent = showHtml ? 'HTML' : 'MD';
  el.sumView.classList.toggle('active', showHtml);
}
// #5: render báo cáo tổng thể thành HTML "đẹp" (card mục + bảng) — tự sinh từ markdown, an toàn.
const REPORT_CSS = 'body{margin:0;background:#eef1f4;color:#19283a;font:16px/1.65 system-ui,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased;padding:28px 16px}.report{max-width:840px;margin:0 auto;background:#fff;border:1px solid #e0e5eb;border-radius:10px;box-shadow:0 1px 2px rgba(25,40,58,.04),0 18px 44px -30px rgba(25,40,58,.3);padding:clamp(22px,4vw,46px)}.report>*:first-child{margin-top:0}.report h1{font-family:"Cambria","Georgia",serif;font-size:clamp(24px,4vw,33px);font-weight:700;line-height:1.2;letter-spacing:-.01em;margin:0 0 18px;padding-bottom:14px;border-bottom:3px solid #1b5e7e;color:#19283a}.report h2{font-family:"Cambria","Georgia",serif;font-size:clamp(19px,2.6vw,23px);font-weight:700;color:#154b64;margin:30px 0 12px;padding-left:14px;border-left:4px solid #1b5e7e;line-height:1.25}.report h3{font-size:15.5px;font-weight:700;color:#1b5e7e;margin:20px 0 8px}.report h4{font-size:14px;font-weight:700;color:#33414f;margin:16px 0 6px}.report p{margin:0 0 12px}.report ul,.report ol{margin:8px 0 14px;padding-left:24px}.report li{margin:5px 0;padding-left:3px}.report li::marker{color:#1b5e7e}.report strong{color:#16303f;font-weight:600}.report em{color:#5c6b7e}.report code{background:#eef1f5;color:#154b64;padding:1px 6px;border-radius:4px;font-size:.9em;font-family:Consolas,"Cascadia Code",monospace}.report blockquote{margin:12px 0;padding:8px 16px;border-left:3px solid #b5651d;background:#f7efe4;color:#6a5640;border-radius:0 6px 6px 0;font-style:italic}.report hr{border:0;border-top:1px solid #e0e5eb;margin:24px 0}.report .tbl-wrap{overflow-x:auto;border:1px solid #e0e5eb;border-radius:8px;margin:14px 0}.report table{border-collapse:collapse;width:100%;min-width:520px;font-size:14px;font-variant-numeric:tabular-nums}.report th{background:#1b5e7e;color:#fff;text-align:left;font-weight:600;font-size:12.5px;letter-spacing:.03em;padding:11px 14px;white-space:nowrap}.report td{padding:11px 14px;border-top:1px solid #e6eaef;vertical-align:top;color:#33414f;line-height:1.5}.report tbody tr:nth-child(even) td{background:#fafbfc}.report td:first-child{font-weight:600;color:#19283a}@media print{body{background:#fff;padding:0}.report{border:0;border-radius:0;box-shadow:none;max-width:none}.report h2,.report .tbl-wrap{break-inside:avoid}}';
function reportBodyHtml(md) { return '<div class="report">' + md2html(md) + '</div>'; }
function buildReportDoc(md) {
  return `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meeting report</title><style>${REPORT_CSS}</style></head><body>${reportBodyHtml(md)}</body></html>`;
}

// ════ BÁO CÁO LANDING-PAGE: JSON có cấu trúc (Gemini) → renderer cố định → HTML "y hệt" ════
// 5 phần: hero · problem (thách thức↔giải pháp) · bento · action items (checkbox) · roadmap. Bảng màu/font đúng spec.
const FONT_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Inter:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">';
// Tiến bộ dần (progressive enhancement): JS thêm class .js + reveal khi cuộn; không JS → nội dung vẫn hiện đủ. Bị CSP chặn trong iframe panel cũng không sao.
const REVEAL_JS = '<scr' + 'ipt>document.documentElement.classList.add("js");(function(){try{if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target);}});},{threshold:.12,rootMargin:"0px 0px -8% 0px"});document.querySelectorAll(".reveal").forEach(function(el){io.observe(el);});}catch(_){document.querySelectorAll(".reveal").forEach(function(el){el.classList.add("in");});}})();</scr' + 'ipt>';
const FANCY_CSS = `:root{
--bg:#F7F3EB;--bg-2:#F0EADE;--surface:#FCFAF4;--surface-2:#F3EEE3;
--ink:#36312A;--ink-soft:#5E564A;--ink-faint:#988E7D;
--line:#E5DDCF;--line-strong:#D7CCB9;
--cel:#6E9F8E;--cel-deep:#517C6D;--cel-tint:#E3EDE7;
--hi:#B36A4D;--hi-bg:#F2E2D8;--hi-dot:#C2745A;
--md:#9A7A2E;--md-bg:#F1E9D2;--md-dot:#C7A24E;
--lo:#5E7E6E;--lo-bg:#E1EAE4;--lo-dot:#7E9B8C;
--disp:"Bricolage Grotesque",-apple-system,system-ui,"Segoe UI",sans-serif;
--body:"Inter",-apple-system,system-ui,"Segoe UI",Roboto,sans-serif;
--mono:"Space Mono","SFMono-Regular",Consolas,"Cascadia Code",monospace}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img{max-width:100%}
h1,h2,h3,h4{font-family:var(--disp);font-weight:700;letter-spacing:-.02em;line-height:1.12;margin:0}
p{margin:0}
ul,ol{margin:0;padding:0;list-style:none}
a:focus-visible,button:focus-visible,label:focus-visible,input:focus-visible{outline:2px solid var(--cel-deep);outline-offset:2px}
.wrap{max-width:1080px;margin:0 auto;padding:0 clamp(16px,4vw,40px)}
.eyebrow{display:flex;align-items:center;gap:12px;font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--cel-deep);margin:0 0 18px}
.eyebrow::before{content:"";width:26px;height:2px;background:var(--cel);border-radius:2px;flex:0 0 auto}
section{padding:clamp(26px,3.4vw,40px) 0}
section+section,.foot{border-top:1px solid var(--line)}
/* Hero */
.hero{padding:clamp(28px,4.5vw,46px) 0 clamp(22px,3vw,34px)}
.headline{font-family:var(--disp);font-weight:800;font-size:clamp(30px,6vw,56px);letter-spacing:-.025em;line-height:1.05;text-wrap:balance;max-width:20ch}
.headline .hl{color:var(--cel-deep)}
.sub{margin-top:20px;font-size:clamp(16px,2.1vw,19px);color:var(--ink-soft);max-width:62ch;line-height:1.6}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:26px}
.stat{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:24px 20px 18px;overflow:hidden}
.stat::before{content:"";position:absolute;top:0;left:22px;width:30px;height:3px;background:var(--cel);border-radius:0 0 3px 3px}
.stat-val{font-family:var(--mono);font-weight:700;font-size:clamp(23px,3.2vw,34px);line-height:1;color:var(--ink);letter-spacing:-.02em}
.stat-label{margin-top:11px;font-family:var(--mono);font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-faint);line-height:1.3}
.meta{display:flex;flex-wrap:wrap;gap:10px 26px;margin-top:28px;padding-top:20px;border-top:1px solid var(--line);font-family:var(--mono);font-size:12.5px;color:var(--ink-faint)}
.meta-k{color:var(--ink-soft);font-weight:700}
/* Problem ↔ Solution */
.problem{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.pcard{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:clamp(20px,3vw,30px)}
.pcard.is-solution{background:var(--cel-tint);border-color:var(--cel)}
.pc-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.pc-ico{font-size:22px;line-height:1}
.pc-head h3{font-size:clamp(18px,2.4vw,22px)}
.pts{display:flex;flex-direction:column;gap:11px}
.pts li{position:relative;padding-left:21px;color:var(--ink-soft);line-height:1.55}
.pts li::before{content:"";position:absolute;left:2px;top:.6em;width:7px;height:7px;border-radius:2px;background:var(--cel);transform:rotate(45deg)}
.pcard strong,.b strong{color:var(--ink);font-weight:600}
code{font-family:var(--mono);font-size:.88em;background:var(--surface-2);padding:1px 6px;border-radius:5px}
/* Bento */
.bento{display:grid;grid-template-columns:repeat(12,1fr);gap:18px}
.b{grid-column:1 / -1;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:clamp(20px,3vw,30px);transition:transform .25s ease,box-shadow .25s ease}
.b:hover{transform:translateY(-4px);box-shadow:0 18px 40px -28px rgba(54,49,42,.5)}
.b-ico{font-size:26px;line-height:1;margin-bottom:12px}
.b h3{font-size:clamp(18px,2.3vw,22px);margin-bottom:14px}
.b .pts{margin-bottom:16px}
.b-concl{display:inline-block;background:var(--surface-2);color:var(--ink-soft);border-radius:999px;padding:8px 16px;font-size:13.5px;line-height:1.4}
.b-concl::before{content:"\\2713  ";color:var(--cel-deep);font-weight:700}
@media(min-width:760px){.b.w5{grid-column:span 5}.b.w7{grid-column:span 7}.b.w12{grid-column:1 / -1}}
/* Action items */
.actions-sec .panel{background:var(--bg-2);border:1px solid var(--line);border-radius:18px;padding:clamp(20px,4vw,34px)}
.actions{display:flex;flex-direction:column;gap:10px;margin-top:2px}
.ai{display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:14px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:13px 16px;cursor:pointer}
.ai input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.ai .box{flex:0 0 auto;width:20px;height:20px;border:2px solid var(--line-strong);border-radius:6px;display:grid;place-items:center;transition:.18s}
.ai .box::after{content:"";width:10px;height:6px;border-left:2px solid #fff;border-bottom:2px solid #fff;transform:rotate(-45deg) scale(0);margin-top:-2px;transition:transform .18s}
.ai input:checked+.box{background:var(--cel);border-color:var(--cel)}
.ai input:checked+.box::after{transform:rotate(-45deg) scale(1)}
.ai input:focus-visible+.box{outline:2px solid var(--cel-deep);outline-offset:2px}
.ai .task{color:var(--ink);line-height:1.45;transition:.18s}
.ai input:checked~.task{text-decoration:line-through;color:var(--ink-faint)}
.ai .who,.ai .due{font-family:var(--mono);font-size:12px;color:var(--ink-soft);white-space:nowrap}
.ai .due{color:var(--ink-faint)}
.pri{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:5px 11px;border-radius:999px;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.pri::before{content:"";width:7px;height:7px;border-radius:50%}
.pri-hi{color:var(--hi);background:var(--hi-bg)}.pri-hi::before{background:var(--hi-dot)}
.pri-md{color:var(--md);background:var(--md-bg)}.pri-md::before{background:var(--md-dot)}
.pri-lo{color:var(--lo);background:var(--lo-bg)}.pri-lo::before{background:var(--lo-dot)}
@media(max-width:640px){.ai{grid-template-columns:auto 1fr;row-gap:7px}.ai .task,.ai .who,.ai .due,.ai .pri{grid-column:2}.ai .pri{justify-self:start}}
/* Roadmap timeline */
.road{display:flex;flex-direction:column}
.step{position:relative;padding:0 0 26px 30px}
.step:last-child{padding-bottom:0}
.step-dot{position:absolute;left:0;top:4px;width:15px;height:15px;border-radius:50%;background:var(--cel);border:3px solid var(--bg);box-shadow:0 0 0 1.5px var(--cel);z-index:1}
.step::after{content:"";position:absolute;left:7px;top:4px;bottom:-4px;width:2px;background:var(--line-strong)}
.step:last-child::after{display:none}
.step-time{font-family:var(--mono);font-size:12px;font-weight:700;color:var(--cel-deep);margin-bottom:6px;letter-spacing:.04em}
.step-title{font-family:var(--disp);font-size:16.5px;margin-bottom:6px}
.step-desc{color:var(--ink-soft);font-size:14.5px;line-height:1.5}
@media(min-width:760px){.road{flex-direction:row}.step{flex:1;padding:32px 24px 0 0}.step-dot{top:6px}.step::after{left:15px;right:0;top:12.5px;bottom:auto;width:auto;height:2px}}
/* Footer */
.foot{padding:30px 0 50px;margin-top:8px;font-family:var(--mono);font-size:12px;color:var(--ink-faint);text-align:center}
/* Reveal (chỉ ẩn khi JS chạy được) */
html.js .reveal{opacity:0;transform:translateY(18px);transition:opacity .6s ease,transform .6s ease}
html.js .reveal.in{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){html.js .reveal,html.js .reveal.in{opacity:1;transform:none;transition:none}}
@media(max-width:720px){.stats{grid-template-columns:repeat(2,1fr)}.problem{grid-template-columns:1fr}}
@media(max-width:420px){.stats{grid-template-columns:1fr}}
@media print{body{background:#fff}.b:hover{transform:none;box-shadow:none}section,.b,.pcard,.ai,.step{break-inside:avoid}}`;
function _fesc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _finl(s) { return _fesc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>'); }
function _fhl(s) { return _fesc(s).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>'); }
function _ful(pts) { const a = (pts || []).filter(x => x && String(x).trim()); return a.length ? '<ul class="pts">' + a.map(x => `<li>${_finl(x)}</li>`).join('') + '</ul>' : ''; }
// Nhịp bento bất đối xứng: mỗi hàng 2 khối luân phiên 7-5 / 5-7; khối lẻ cuối → full (w12).
function _bentoSpans(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (n % 2 === 1 && i === n - 1) { out.push('w12'); continue; }
    const wide = (Math.floor(i / 2) % 2 === 0) === (i % 2 === 0);
    out.push(wide ? 'w7' : 'w5');
  }
  return out;
}
const _PRI = Object.assign(Object.create(null), { high: ['pri-hi', 'Cao'], mid: ['pri-md', 'Trung bình'], low: ['pri-lo', 'Thấp'] });   // null-proto → key lạ (vd "toString") không lọt qua _PRI[k]
function renderReport(r) {
  r = r || {}; const h = r.hero || {}, lab = r.labels || {};
  const stats = (h.stats || []).filter(s => s && s.value).slice(0, 4)
    .map(s => `<div class="stat"><div class="stat-val">${_fesc(s.value)}</div><div class="stat-label">${_fesc(s.label)}</div></div>`).join('');
  const meta = (h.meta || []).filter(m => m && m.value)
    .map(m => `<span class="meta-item"><span class="meta-k">${_fesc(m.label)}:</span> ${_fesc(m.value)}</span>`).join('');
  const hero = `<header class="hero reveal">${h.eyebrow ? `<p class="eyebrow">${_fesc(h.eyebrow)}</p>` : ''}`
    + `<h1 class="headline">${_fhl(h.headline || 'Tóm tắt cuộc họp')}</h1>`
    + (h.subhead ? `<p class="sub">${_finl(h.subhead)}</p>` : '')
    + (stats ? `<div class="stats">${stats}</div>` : '')
    + (meta ? `<div class="meta">${meta}</div>` : '') + `</header>`;

  let problem = '';
  const p = r.problem;
  if (p && ((p.challenge && p.challenge.title) || (p.solution && p.solution.title))) {
    const side = (s, cls, ico) => (s && s.title) ? `<article class="pcard ${cls}"><div class="pc-head"><span class="pc-ico">${ico}</span><h3>${_fesc(s.title)}</h3></div>${_ful(s.points)}</article>` : '';
    problem = `<section class="reveal"><p class="eyebrow">${_fesc(lab.problem || 'Vấn đề cốt lõi')}</p><div class="problem">${side(p.challenge, '', '⚠️')}${side(p.solution, 'is-solution', '💡')}</div></section>`;
  }

  let bento = '';
  const bs = (r.bento || []).filter(b => b && b.title);
  if (bs.length) {
    const sp = _bentoSpans(bs.length);
    bento = `<section class="reveal"><p class="eyebrow">${_fesc(lab.bento || 'Chủ đề chính')}</p><div class="bento">`
      + bs.map((b, i) => `<article class="b ${sp[i] || ''}">${b.icon ? `<div class="b-ico">${_fesc(b.icon)}</div>` : ''}<h3>${_fesc(b.title)}</h3>${_ful(b.points)}${b.conclusion ? `<p class="b-concl">${_finl(b.conclusion)}</p>` : ''}</article>`).join('')
      + `</div></section>`;
  }

  let actions = '';
  const as = (r.actions || []).filter(a => a && a.task);
  if (as.length) {
    actions = `<section class="actions-sec reveal"><div class="panel"><p class="eyebrow">${_fesc(lab.actions || 'Việc cần làm')}</p><div class="actions">`
      + as.map(a => { const pr = _PRI[a.priority] || _PRI.mid;
        return `<label class="ai"><input type="checkbox"><span class="box"></span><span class="task">${_finl(a.task)}</span><span class="who">${a.owner ? _fesc(a.owner) : '—'}</span><span class="due">${a.due ? _fesc(a.due) : '—'}</span><span class="pri ${pr[0]}">${pr[1]}</span></label>`;
      }).join('')
      + `</div></div></section>`;
  }

  let road = '';
  const rs = (r.roadmap || []).filter(s => s && s.title);
  if (rs.length) {
    road = `<section class="reveal"><p class="eyebrow">${_fesc(lab.roadmap || 'Lộ trình tiếp theo')}</p><ol class="road">`
      + rs.map(s => `<li class="step"><span class="step-dot"></span>${s.time ? `<div class="step-time">${_fesc(s.time)}</div>` : ''}<h4 class="step-title">${_fesc(s.title)}</h4>${s.desc ? `<p class="step-desc">${_finl(s.desc)}</p>` : ''}</li>`).join('')
      + `</ol></section>`;
  }

  const foot = `<footer class="foot">${r.footer ? _fesc(r.footer) : 'Bản tóm tắt tự động từ transcript cuộc họp.'}</footer>`;
  return `<div class="wrap">${hero}${problem}${bento}${actions}${road}${foot}</div>`;
}
function buildFancyDoc(r) {
  const title = _fesc(String((r && r.hero && r.hero.headline) || 'Báo cáo cuộc họp').replace(/\*\*/g, ''));
  return `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${FONT_LINK}<style>${FANCY_CSS}</style></head><body>${renderReport(r)}${REVEAL_JS}</body></html>`;
}
function reportToMd(r) {
  r = r || {}; const h = r.hero || {}, L = [];
  L.push('# ' + String(h.headline || 'Tóm tắt cuộc họp').replace(/\*\*/g, ''));
  if (h.subhead) { L.push(''); L.push(h.subhead); }
  const meta = (h.meta || []).filter(m => m && m.value);
  if (meta.length) { L.push(''); for (const m of meta) L.push(`- **${m.label}:** ${m.value}`); }
  const stats = (h.stats || []).filter(s => s && s.value);
  if (stats.length) { L.push(''); L.push('## Số liệu chính'); for (const s of stats) L.push(`- **${s.value}** — ${s.label || ''}`); }
  const p = r.problem;
  if (p && ((p.challenge && p.challenge.title) || (p.solution && p.solution.title))) {
    L.push(''); L.push('## Vấn đề cốt lõi');
    const side = (s, ico) => { if (!s || !s.title) return; L.push(''); L.push(`### ${ico} ${s.title}`); for (const x of (s.points || [])) L.push(`- ${x}`); };
    side(p.challenge, '⚠️'); side(p.solution, '💡');
  }
  const bs = (r.bento || []).filter(b => b && b.title);
  if (bs.length) { L.push(''); L.push('## Chủ đề chính'); for (const b of bs) { L.push(''); L.push(`### ${b.icon ? b.icon + ' ' : ''}${b.title}`); for (const x of (b.points || [])) L.push(`- ${x}`); if (b.conclusion) L.push(`> **Kết luận:** ${b.conclusion}`); } }
  const as = (r.actions || []).filter(a => a && a.task);
  if (as.length) { L.push(''); L.push('## Việc cần làm'); L.push(''); L.push('| Việc | Phụ trách | Hạn | Ưu tiên |'); L.push('| --- | --- | --- | --- |'); const PR = { high: 'Cao', mid: 'Trung bình', low: 'Thấp' }; for (const a of as) L.push(`| ${a.task} | ${a.owner || '—'} | ${a.due || '—'} | ${PR[a.priority] || 'Trung bình'} |`); }
  const rs = (r.roadmap || []).filter(s => s && s.title);
  if (rs.length) { L.push(''); L.push('## Lộ trình tiếp theo'); for (const s of rs) L.push(`- **${s.time ? s.time + ' — ' : ''}${s.title}**${s.desc ? ': ' + s.desc : ''}`); }
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
  el.voiceBtn.style.display = '';
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
function buildTargetButton() {   // toolbar: gọn — chỉ cờ ngôn ngữ đích
  el.targetBtn.innerHTML = `<span class="flag">${flag(S.langCode)}</span>`;
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
    if (S.langCode === L.code) b.classList.add('sel');
    b.addEventListener('click', () => { pickTarget(L.code); closeMenus(); });
    el.targetMenu.appendChild(b);
  }
}
function pickTarget(code) {
  save({ langCode: code }); live.onTargetLangChanged();
  buildTargetButton();
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
          caps: _capSnapshot(), summaryMd, report: fullReport, sessId: _sessId, sessStart: _sessStart,
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
  el.sumView.addEventListener('click', () => { save({ summaryView: S.summaryView === 'md' ? 'html' : 'md' }); renderSummary(); });
  el.sumDlHtml.addEventListener('click', () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (fullReport) { download(`bao-cao-${stamp}.html`, buildFancyDoc(fullReport), 'text/html'); return; }   // landing-page "y hệt"
    if (summaryMd) download(`summary-${stamp}.html`, buildReportDoc(summaryMd), 'text/html');
  });
  el.sumExport.addEventListener('click', () => { if (summaryMd) download(`summary-${new Date().toISOString().slice(0, 10)}.md`, summaryMd, 'text/markdown'); });
  el.sumFull.addEventListener('click', async () => {   // 📊 dựng lại báo cáo TỔNG THỂ ngay (toàn bộ transcript) — không cần dừng vì rolling vốn cũng dựng landing-page
    if (sumBusy) return;
    const caps = finalized(); if (!caps.length) { st('status.noContent'); return; }
    if (!sumPanelOpen) { sumPanelOpen = true; el.summaryWrap.classList.remove('hidden'); el.vResizer.classList.remove('hidden'); el.summaryToggle.classList.add('active'); if (!el.summaryWrap.style.height) el.summaryWrap.style.height = Math.round(window.innerHeight * 0.35) + 'px'; }
    st('status.makingFull'); sumBusy = true; refreshSpin(); showFullOverlay(true);
    sumLastTime = Date.now();
    try {
      const r = await makeReport(caps, null, caps, caps.length);   // Tổng thể: dựng LẠI từ toàn bộ transcript (full)
      if (r.kind === 'error') st('status.fullErr', { err: r.error }, 'err'); else st('status.fullDone');
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
