// app.js — controller cho side panel. Thu (mic/tab) → Gemini Live → list + TTS + tóm tắt.
import { createLiveTranslator, validateKey } from './lib/gemini-live.js';
import { createSummarizer } from './lib/gemini-text.js';
import { LANG_ORDER, LANG_LABELS } from './lib/langs.js';
import { GEM_VOICES, DEFAULT_VOICE } from './lib/voices.js';

// ── State + lưu trữ ────────────────────────────────────────────────────────────
const DEFAULTS = {
  apiKey: '', langCode: 'vi', transcribeMode: false, geminiVoice: DEFAULT_VOICE,
  geminiAudioOn: true, source: 'mic', summaryExtra: '',
};
const S = { ...DEFAULTS };
async function loadSettings() { const got = await chrome.storage.local.get(DEFAULTS); Object.assign(S, got); }
function save(patch) { Object.assign(S, patch); chrome.storage.local.set(patch); }

// ── DOM ─────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  settingsBtn: $('settings-btn'), popoutBtn: $('popout-btn'), settings: $('settings'), apikey: $('apikey'), keyStatus: $('key-status'),
  summaryExtra: $('summary-extra'), source: $('source'), lang: $('lang'),
  voice: $('voice'), start: $('start'), status: $('status'), list: $('list'), count: $('count'),
  autoscroll: $('autoscroll'), summaryToggle: $('summary-toggle'), export: $('export'), clear: $('clear'),
  summaryWrap: $('summary-wrap'), summary: $('summary'), sumFull: $('sum-full'), sumCopy: $('sum-copy'), sumExport: $('sum-export'),
  vResizer: $('v-resizer'), dl: $('dl'),
};
function setStatus(msg, cls) { el.status.textContent = msg; el.status.className = 'status' + (cls ? ' ' + cls : ''); }

// ── Engines ──────────────────────────────────────────────────────────────────────
const live = createLiveTranslator({
  getState: () => ({ apiKey: S.apiKey, langCode: S.langCode, transcribeMode: S.transcribeMode, geminiAudioOn: S.geminiAudioOn }),
  onCaption: addCaption,
  onAudio: playAudio,
  onClear: clearAudio,
  onStatus: ({ error }) => { if (error === 'no-key') setStatus('Thiếu API key.', 'err'); else if (error) setStatus('Gemini: ' + error, 'err'); },
});
const summarizer = createSummarizer({
  getState: () => ({ apiKey: S.apiKey, targetLangLabel: LANG_LABELS[S.langCode] || 'tiếng Việt', transcribeMode: S.transcribeMode, summaryExtra: S.summaryExtra }),
});

// ── Caption list ─────────────────────────────────────────────────────────────────
const captions = []; const byId = new Map(); const rowById = new Map();
let autoScroll = true;
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
  row.querySelector('.who').textContent = e.author || 'STT';
  row.querySelector('.ts').textContent = e.ts || '';
  row.querySelector('.entry-text').textContent = e.translated || e.original || '';
  el.count.textContent = captions.length + ' câu';
  if (autoScroll) el.list.scrollTop = el.list.scrollHeight;
}
function clearList() {
  captions.length = 0; byId.clear(); rowById.clear(); el.list.innerHTML = ''; el.count.textContent = '0 câu';
  summaryMd = ''; sumPrevCount = 0; sumLastTime = 0; renderSummary();
}

// ── TTS playback (gapless + trần độ trễ — port từ app.html bản đã vá) ─────────────
let _gemCtx = null, _gemPlayhead = 0, _gemNodes = [];
const _GEM_LEAD = 0.18, _GEM_SOFT_LEAD = 0.6, _GEM_HARD_LEAD = 1.8;
function ensureGemCtx() {
  if (!_gemCtx || _gemCtx.state === 'closed') { _gemCtx = new (window.AudioContext || window.webkitAudioContext)(); _gemPlayhead = 0; _gemNodes = []; }
  if (_gemCtx.state === 'suspended') _gemCtx.resume().catch(() => {});
  return _gemCtx;
}
function clearAudio() { for (const n of _gemNodes) { try { n.onended = null; n.stop(); } catch (e) {} } _gemNodes = []; _gemPlayhead = 0; }
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
      _gemPlayhead = resumeAt;
    }
    const lead = _gemPlayhead - ctx.currentTime;
    const spd = lead > _GEM_SOFT_LEAD ? Math.min(1.12, 1 + (lead - _GEM_SOFT_LEAD) * 0.5) : 1.0;
    const buf = ctx.createBuffer(1, n, sampleRate || 24000);
    buf.getChannelData(0).set(f32);
    const node = ctx.createBufferSource();
    node.buffer = buf; node.playbackRate.value = spd; node.connect(ctx.destination);
    if (_gemPlayhead < ctx.currentTime + 0.02) _gemPlayhead = ctx.currentTime + _GEM_LEAD;
    const startAt = _gemPlayhead; node.start(startAt);
    _gemPlayhead = startAt + buf.duration / spd; node._s = startAt; node._e = _gemPlayhead;
    _gemNodes.push(node);
    node.onended = () => { const i = _gemNodes.indexOf(node); if (i >= 0) _gemNodes.splice(i, 1); };
  } catch (e) { console.warn('[tts] play lỗi:', e && e.message); }
}

// ── Audio capture (mic / màn hình-tab-cửa sổ) → PCM f32 @16k ──────────────────────
let recActive = false, audioCtx = null, srcNode = null, procNode = null, zeroGain = null, rawStream = null, watchdog = null, lastTs = 0;
async function startCapture() {
  let stream;
  if (S.source === 'mic') {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } else {
    // Hiện popup chọn của trình duyệt: Tab trình duyệt / Cửa sổ (app) / Toàn màn hình.
    // getDisplayMedia bắt buộc có video để hiện picker → ta lấy stream rồi BỎ track video, chỉ giữ audio.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    stream.getVideoTracks().forEach(t => t.stop());
  }
  rawStream = stream;
  const tracks = stream.getAudioTracks();
  if (!tracks.length) throw new Error("nguồn không có audio — chọn 'Tab' hoặc tick 'Chia sẻ âm thanh' khi chọn Toàn màn hình (cửa sổ app thường không có audio)");
  recActive = true;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  if (audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch (e) {} }
  audioCtx.onstatechange = () => { if (recActive && audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {}); };
  srcNode = audioCtx.createMediaStreamSource(new MediaStream(tracks));
  procNode = audioCtx.createScriptProcessor(4096, 1, 1);
  zeroGain = audioCtx.createGain(); zeroGain.gain.value = 0;
  procNode.onaudioprocess = (e) => { if (!recActive) return; lastTs = Date.now(); live.pushAudio(new Float32Array(e.inputBuffer.getChannelData(0))); };
  srcNode.connect(procNode); procNode.connect(zeroGain); zeroGain.connect(audioCtx.destination);
  lastTs = Date.now(); clearInterval(watchdog);
  watchdog = setInterval(() => { if (recActive && audioCtx && Date.now() - lastTs > 3000) audioCtx.resume().catch(() => {}); }, 2000);
  // dừng khi user tự tắt chia sẻ/track
  tracks[0].addEventListener('ended', () => { if (recActive) stop(); });
}
function stopCapture() {
  recActive = false; clearInterval(watchdog); watchdog = null;
  try { if (procNode) { procNode.onaudioprocess = null; procNode.disconnect(); } } catch (e) {}
  try { if (srcNode) srcNode.disconnect(); } catch (e) {}
  try { if (zeroGain) zeroGain.disconnect(); } catch (e) {}
  try { if (audioCtx) audioCtx.close(); } catch (e) {}
  procNode = srcNode = zeroGain = audioCtx = null;
  rawStream?.getTracks().forEach(t => t.stop()); rawStream = null;
}

// ── Start / Stop ──────────────────────────────────────────────────────────────────
let running = false;
async function start() {
  if (running) return;
  if (!S.apiKey || !S.apiKey.trim()) { setStatus('Nhập Gemini API key trước.', 'err'); el.settings.classList.remove('hidden'); return; }
  try {
    ensureGemCtx();                 // mở khoá AudioContext phát trong user-gesture
    live.start();
    await startCapture();
    running = true;
    el.start.textContent = '⏹ Dừng'; el.start.classList.add('on');
    setStatus(S.source === 'mic' ? 'Đang nghe micro…' : 'Đang nghe âm thanh đã chọn…', 'run');
  } catch (e) {
    console.error(e); live.stop(); stopCapture();
    if (e && e.name === 'NotAllowedError') setStatus('Đã huỷ chọn nguồn âm thanh.');
    else setStatus('Lỗi thu âm: ' + (e.message || e.name || e), 'err');
  }
}
function stop() {
  if (!running) return;
  running = false;
  live.stop(); stopCapture(); clearAudio();
  el.start.textContent = '▶ Bắt đầu'; el.start.classList.remove('on');
  setStatus('Đã dừng.');
}

// ── Tóm tắt ────────────────────────────────────────────────────────────────────────
let summaryMd = '', sumPrevCount = 0, sumBusy = false, sumTimer = null, sumPanelOpen = false, sumLastTime = 0;
const SUM_MIN_NEW = 24, SUM_POLL_MS = 12000, SUM_MAX_CAPS_PER_CALL = 25;
const finalized = () => captions.filter(c => !c.partial);
async function summarizeTick() {
  if (sumBusy) return;
  const caps = finalized();
  const newCount = caps.length - sumPrevCount;
  if (!((newCount >= SUM_MIN_NEW) || (sumLastTime === 0 && caps.length > 0))) return;
  sumBusy = true;
  let newCaps = caps.slice(sumPrevCount);
  if (newCaps.length > SUM_MAX_CAPS_PER_CALL) newCaps = newCaps.slice(newCaps.length - SUM_MAX_CAPS_PER_CALL);
  try {
    const res = await summarizer.summarize({ prevSummary: summaryMd, captions: newCaps });
    if (res && res.ok) { summaryMd = res.markdown; renderSummary(); sumPrevCount = caps.length; sumLastTime = Date.now(); }
    else if (res && res.error !== 'empty') setStatus('Tóm tắt: ' + res.error, 'err');
  } catch (e) { setStatus('Tóm tắt lỗi: ' + e.message, 'err'); }
  finally { sumBusy = false; }
}
function openSummary() {
  sumPanelOpen = true; el.summaryWrap.classList.remove('hidden'); el.vResizer.classList.remove('hidden'); el.summaryToggle.classList.add('active');
  if (!el.summaryWrap.style.height) el.summaryWrap.style.height = Math.round(window.innerHeight * 0.35) + 'px';
  summarizeTick(); clearInterval(sumTimer); sumTimer = setInterval(summarizeTick, SUM_POLL_MS);
}
function closeSummary() { sumPanelOpen = false; el.summaryWrap.classList.add('hidden'); el.vResizer.classList.add('hidden'); el.summaryToggle.classList.remove('active'); clearInterval(sumTimer); sumTimer = null; }
function renderSummary() { el.summary.innerHTML = summaryMd ? md2html(summaryMd) : '<em class="muted">Chưa có tóm tắt.</em>'; }

// Markdown → HTML gọn (heading, list, bảng GFM, bold/italic/code, hr).
function md2html(md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>');
  const lines = String(md).replace(/\r/g, '').split('\n'); const out = []; let i = 0;
  const isSep = s => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
  while (i < lines.length) {
    const ln = lines[i];
    if (/^\s*#{1,6}\s+/.test(ln)) { const m = ln.match(/^\s*(#{1,6})\s+(.*)$/); const lv = Math.min(m[1].length, 3); out.push(`<h${lv}>${inline(m[2].replace(/\*\*/g, ''))}</h${lv}>`); i++; continue; }
    if (/^\s*([-*+])\s+/.test(ln)) { out.push('<ul>'); while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) { out.push('<li>' + inline(lines[i].replace(/^\s*([-*+])\s+/, '')) + '</li>'); i++; } out.push('</ul>'); continue; }
    if (/^\s*\d+\.\s+/.test(ln)) { out.push('<ol>'); while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { out.push('<li>' + inline(lines[i].replace(/^\s*\d+\.\s+/, '')) + '</li>'); i++; } out.push('</ol>'); continue; }
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
  if (!captions.length) { setStatus('Chưa có nội dung để xuất.'); return; }
  const lines = captions.map(c => {
    const head = `[${c.ts || ''}] ${c.author || 'STT'}:`;
    if (c.original && c.original.trim()) return `${head}\n  • ${c.original}\n  → ${c.translated || ''}`;
    return `${head} ${c.translated || ''}`;
  });
  const d = new Date().toISOString().slice(0, 10);
  download(`transcript-${d}.txt`, lines.join('\n'));
}

// ── UI build + wiring ──────────────────────────────────────────────────────────────
function buildLangSelect() {
  el.lang.innerHTML = '';
  for (const L of LANG_ORDER) { const o = document.createElement('option'); o.value = L.code; o.textContent = `${L.flag} ${L.name}`; el.lang.appendChild(o); }
  const t = document.createElement('option'); t.value = '__transcribe__'; t.textContent = '📝 Chép lời'; el.lang.appendChild(t);
  el.lang.value = S.transcribeMode ? '__transcribe__' : S.langCode;
}
function buildVoiceSelect() {
  el.voice.innerHTML = '';
  const off = document.createElement('option'); off.value = '__off__'; off.textContent = '🔇 Tắt đọc'; el.voice.appendChild(off);
  for (const v of GEM_VOICES) { const o = document.createElement('option'); o.value = v; o.textContent = '🔊 ' + v; el.voice.appendChild(o); }
  el.voice.value = S.geminiAudioOn ? S.geminiVoice : '__off__';
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
  el.keyStatus.textContent = 'Đang kiểm tra…'; el.keyStatus.className = 'key-status';
  const r = await validateKey(k);
  if (r.ok) { el.keyStatus.textContent = '✓ Key hợp lệ'; el.keyStatus.className = 'key-status ok'; }
  else { el.keyStatus.textContent = r.error === 'invalid' ? '✕ Key không hợp lệ' : '✕ ' + r.error; el.keyStatus.className = 'key-status err'; }
}

function wire() {
  el.settingsBtn.addEventListener('click', () => el.settings.classList.toggle('hidden'));
  el.popoutBtn.addEventListener('click', () => {                 // mở UI trong cửa sổ popup RỜI (không dính tab web)
    const page = (location.pathname.split('/').pop() || 'sidepanel.html');
    try { chrome.windows.create({ url: chrome.runtime.getURL(page + '?popup=1'), type: 'popup', width: 460, height: 820, focused: true }); }
    catch (e) { setStatus('Không mở được cửa sổ riêng: ' + (e && e.message), 'err'); }
  });
  el.apikey.addEventListener('input', () => { save({ apiKey: el.apikey.value.trim() }); clearTimeout(keyTimer); keyTimer = setTimeout(checkKey, 600); });
  el.summaryExtra.addEventListener('input', () => save({ summaryExtra: el.summaryExtra.value }));
  el.source.addEventListener('change', () => save({ source: el.source.value }));
  el.lang.addEventListener('change', () => {
    const v = el.lang.value;
    if (v === '__transcribe__') { save({ transcribeMode: true }); live.onTranscribeModeChanged(); }
    else { const wasT = S.transcribeMode; save({ langCode: v, transcribeMode: false }); wasT ? live.onTranscribeModeChanged() : live.onTargetLangChanged(); }
    el.voice.disabled = S.transcribeMode;
  });
  el.voice.addEventListener('change', () => {
    const v = el.voice.value;
    if (v === '__off__') { save({ geminiAudioOn: false }); live.setAudioOn(false); }
    else { save({ geminiAudioOn: true, geminiVoice: v }); live.setAudioOn(true); }
  });
  el.start.addEventListener('click', () => running ? stop() : start());
  el.clear.addEventListener('click', clearList);
  el.export.addEventListener('click', exportTranscript);
  el.autoscroll.addEventListener('click', () => { autoScroll = !autoScroll; el.autoscroll.classList.toggle('active', autoScroll); if (autoScroll) el.list.scrollTop = el.list.scrollHeight; });
  el.list.addEventListener('scroll', () => { const near = el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 40; autoScroll = near; el.autoscroll.classList.toggle('active', near); });
  el.summaryToggle.addEventListener('click', () => sumPanelOpen ? closeSummary() : openSummary());
  el.sumCopy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(summaryMd || ''); setStatus('Đã copy tóm tắt.'); } catch (e) {} });
  el.sumExport.addEventListener('click', () => { if (summaryMd) download(`summary-${new Date().toISOString().slice(0, 10)}.md`, summaryMd, 'text/markdown'); });
  el.sumFull.addEventListener('click', async () => {
    if (running) { setStatus('Dừng ghi trước khi tạo báo cáo tổng thể.'); return; }
    const caps = finalized(); if (!caps.length) { setStatus('Chưa có nội dung.'); return; }
    setStatus('Đang tạo báo cáo tổng thể…');
    const r = await summarizer.summarizeFull(caps);
    if (r && r.ok) { summaryMd = r.markdown; renderSummary(); el.summaryWrap.classList.remove('hidden'); setStatus('Xong báo cáo tổng thể.'); }
    else setStatus('Báo cáo lỗi: ' + (r && r.error), 'err');
  });
}

// ── Init ────────────────────────────────────────────────────────────────────────
(async function init() {
  await loadSettings();
  if (new URLSearchParams(location.search).get('popup') === '1') el.popoutBtn.style.display = 'none';   // đã là cửa sổ rời → ẩn nút tách
  if (S.source !== 'mic' && S.source !== 'screen') save({ source: 'screen' });   // migrate giá trị cũ ('tab')
  el.apikey.value = S.apiKey; el.summaryExtra.value = S.summaryExtra;
  el.source.value = S.source;
  buildLangSelect(); buildVoiceSelect(); el.voice.disabled = S.transcribeMode;
  initResizer(); wire();
  if (S.apiKey) checkKey();
  setStatus(S.apiKey ? 'Sẵn sàng. Bấm Bắt đầu.' : 'Nhập API key (⚙️) rồi bấm Bắt đầu.');
})();
