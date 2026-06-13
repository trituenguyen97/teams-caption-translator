/**
 * ipc-handlers.js — All IPC communication between main ↔ renderer
 */
const { ipcMain, desktopCapturer, shell, clipboard } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const state = require('./state');
const Store = require('./store');
const { LANG_NAMES, LANG_LABELS, preprocessText, enqueueTranslate, checkLocalServer, LOCAL_DEFAULTS } = require('./translation');
const localLlm = require('./local-llm');
const { scanBrowserTabs } = require('./http-helpers');
const {
  findMeetingPage, tryToggleCaptionsViaDOM, injectToggleCaptionsKey,
  checkCaptionsActive, tryPowerShellSendKeys,
  getSttLanguage, setSttLanguage,
} = require('./cdp-browser');
const { handlePcm, resetSegmentation, flushStreaming, warmModel } = require('./audio-stt');
const stt = require('./stt');
const tts = require('./tts');
const processAudio = require('./process-audio');
const uia = require('./uia-captions');
const overlay = require('./caption-overlay');
const { timestamp } = require('./caption-service');
const { summarizeMeeting, exportSummary } = require('./summary');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (ch, data) => state.win?.webContents?.send(ch, data);

// Auto-start local LLM server khi provider=local + đã có binary+model. Gọi từ: boot (main.js),
// toggle-captions, save-settings, và SAU KHI tải xong model/binary. Idempotent (startServer tự guard
// alreadyRunning) → gọi nhiều lần an toàn. Server chỉ tắt khi đổi provider khác local hoặc đóng app —
// KHÔNG cần bấm nút play. notifyIfMissing=true (toggle/save) thì báo nếu chưa cài; boot/download thì im.
function ensureLocalServerStarted(notifyIfMissing = false) {
  if (state.provider !== 'local') return;
  try {
    const st = localLlm.serverStatus();
    if (st.running) return;
    if (!st.binaryReady || !st.modelReady) {
      console.warn('[auto-start] thiếu binary/model — bỏ qua (tải xong sẽ tự start)');
      if (notifyIfMissing) send('status', { type: 'error', key: 'status.localMissing' });
      return;
    }
    console.log('[auto-start] khởi động local LLM server…');
    send('status', { type: 'loading', key: 'status.localStarting' });
    localLlm.startServer({ port: 8080 })
      .then(r => {
        if (r.ok) {
          console.log('[auto-start] local server OK', r.pid);
          send('status', { type: 'running', key: 'status.localReady', vars: { pid: r.pid, threads: r.threads || '?' } });
        } else {
          console.warn('[auto-start] fail:', r.error);
          send('status', { type: 'error', key: 'status.localStartFail', vars: { error: r.error } });
        }
      })
      .catch(e => console.warn('[auto-start] error:', e.message));
  } catch (e) { console.warn('[auto-start] exception:', e.message); }
}

function registerAll(app) {
  // Áp dụng ngôn ngữ nguồn STT đã lưu (system/mic) lúc boot — Teams không dùng STT cục bộ.
  try { stt.setLanguage(Store.get('srcLang', '')); } catch {}

  // ── Language ──────────────────────────
  ipcMain.on('set-lang', (_, lang) => {
    state.targetLang = LANG_NAMES[lang] || lang;
    state.targetLangLabel = LANG_LABELS[lang] || lang.toUpperCase();
    state.langCode = lang;
    Store.set('lang', lang);   // lưu để mở app giữ nguyên ngôn ngữ đích đã chọn
  });

  // ── TTS (đọc to bản dịch tiếng Việt — Piper VITS, sherpa-onnx) ──
  // Renderer quyết khi nào đọc (biết target=vi + bật loa); main chỉ sinh PCM off-thread rồi trả về phát.
  ipcMain.handle('tts-available', () => { try { return tts.isAvailable(); } catch { return false; } });
  ipcMain.handle('tts-warm',      async () => { try { return !!(await tts.warm()); } catch { return false; } });
  ipcMain.handle('tts-speak', async (_, text) => {
    try {
      // Supertonic-3 đa ngữ: đọc theo NGÔN NGỮ ĐÍCH hiện tại (state.langCode) + GIỌNG đã chọn (Store ttsVoice 0-9).
      const r = await tts.synthesize(text, { sid: Store.get('ttsVoice', 0), lang: state.langCode });
      return r ? { samples: r.samples, sampleRate: r.sampleRate } : null;
    } catch (e) { console.warn('[tts] speak lỗi:', e.message); return null; }
  });

  // ── Window ────────────────────────────
  ipcMain.on('focus-window', () => { state.win?.show(); state.win?.focus(); });
  ipcMain.on('window-minimize', () => { try { state.win?.minimize(); } catch {} });
  ipcMain.on('window-maximize', () => { const w = state.win; if (!w) return; try { w.isMaximized() ? w.unmaximize() : w.maximize(); } catch {} });
  ipcMain.on('window-close',    () => { try { state.win?.close(); } catch {} });

  ipcMain.on('set-always-on-top', (_, v) => {
    state.pinned = v;
    state.win?.setAlwaysOnTop(v, v ? 'screen-saver' : 'normal');
    if (v) state.win?.focus();
  });

  // ── Captions toggle ───────────────────
  ipcMain.on('toggle-captions', async (_, desired) => {
    // Khi user bấm ▶ caption và đang dùng local LLM → đảm bảo server chạy (báo nếu chưa cài)
    ensureLocalServerStarted(true);
    // Audio mode
    if (state.captureSource !== 'teams') {
      state.audioPaused = !state.audioPaused;
      state.userActive  = !state.audioPaused;   // đồng bộ cờ play với audio (nhất quán teams/audio)
      const label = state.captureSource === 'mic' ? 'Microphone' : 'System Audio';
      if (state.audioPaused) {
        try { flushStreaming(); } catch {}        // chốt nốt câu streaming đang dở → dịch trước khi dừng
        if (processAudio.isActive()) processAudio.stop();   // nguồn = 1 tiến trình (main-side) → dừng helper
        else send('stop-audio-capture', {});                // nguồn = toàn hệ thống (renderer getDisplayMedia)
        send('cc-state', { active: false });
        send('status', { type: 'ended', key: 'status.recordingPaused' });
        return;
      }
      // STT cục bộ (Nemotron, xem src/stt.js). Nguồn audio:
      //  - audioProcessPid đã chọn → thu THEO TIẾN TRÌNH ở main (process-audio → handlePcm); khử feedback TTS.
      //  - chưa chọn ("Toàn hệ thống") → renderer getDisplayMedia loopback như cũ.
      try { resetSegmentation(); } catch {}   // bắt đầu phiên ghi mới → VAD/stream sạch
      const _pid = Store.get('audioProcessPid', '');
      if (_pid && state.captureSource === 'system' && processAudio.isSupported() && processAudio.start(_pid)) {
        send('cc-state', { active: true });
        send('status', { type: 'running', key: 'status.audioRecording', vars: { label } });
      } else {
        if (_pid) console.warn('[toggle] thu theo tiến trình thất bại → fallback toàn hệ thống');
        send('start-audio-capture', { source: state.captureSource });
        send('cc-state', { active: true });
        send('status', { type: 'running', key: 'status.audioRecording', vars: { label } });
      }
      return;
    }

    // ── Teams mode (UIA): nút ▶/⏹ chỉ điều khiển userActive. KHÔNG còn CDP/inject. ──
    // ▶ (wantOn): bật dịch — runUiaService đọc panel 'Live Captions' qua UIA. User tự bật Live Captions
    //   trong Teams (Alt+Shift+C) nếu chưa bật; helper tự phát hiện panel → cc-state active.
    // ⏹ (!wantOn): dừng dịch (runUiaService tự về idle + ẩn overlay).
    const wantOn = (typeof desired === 'boolean') ? desired : !state.userActive;
    if (!wantOn) {
      state.userActive = false;
      send('cc-state', { active: false });
      send('status', { type: 'idle', key: 'status.idle' });
      console.log('[toggle-captions] ⏹ userActive=false (dừng dịch)');
      return;
    }

    state.userActive = true;
    const active = uia.isCaptionsOn();
    console.log('[toggle-captions] ▶ userActive=true | UIA captions:', active);
    send('cc-state', { active });
    if (!active) {
      // Pin TẠM app dịch (nếu chưa pin sẵn) → Teams focus + Alt+Shift+C không che/ẩn nó; bỏ pin khi caption lên.
      if (!state.pinned && !state._tempPin) {
        state._tempPin = true;
        try { state.win?.setAlwaysOnTop(true, 'screen-saver'); } catch {}
        setTimeout(() => {   // an toàn: caption không lên sau 8s → bỏ pin tạm
          if (state._tempPin) { state._tempPin = false; try { state.win?.setAlwaysOnTop(!!state.pinned, state.pinned ? 'screen-saver' : 'normal'); } catch {} }
        }, 8000);
      }
      // Caption đang tắt → tự bật: focus cửa sổ meeting + gửi Alt+Shift+C (helper sẽ phát hiện panel).
      send('status', { type: 'enabling-captions', key: 'status.enablingCaptions' });
      try { uia.enableCaptions(); } catch {}
    }
  });

  // ── Overlay dịch nổi trên Teams (bật/tắt) ──
  ipcMain.on('set-overlay-enabled', (_, v) => {
    state.overlayEnabled = !!v;
    Store.set('overlayEnabled', !!v);
    try { overlay.setEnabled(!!v); } catch {}
  });

  // ── Audio PCM (STT) — renderer gửi Float32 @16k qua Web Audio ─────────────────
  ipcMain.on('audio-pcm', async (_, data) => {
    let f32;
    if (data instanceof Float32Array) f32 = data;
    else if (Buffer.isBuffer(data)) f32 = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    else if (data instanceof ArrayBuffer) f32 = new Float32Array(data);
    else if (data && data.buffer) f32 = new Float32Array(data.buffer, data.byteOffset || 0, Math.floor((data.byteLength || 0) / 4));
    else return;
    try { await handlePcm(f32); } catch (e) { console.warn('[audio-pcm] handlePcm lỗi:', e.message); }
  });

  // ── Liệt kê tiến trình có cửa sổ để chọn nguồn audio theo tiến trình (Process Loopback) ──
  ipcMain.handle('list-audio-processes', async () => {
    try { return processAudio.isSupported() ? await processAudio.listProcesses() : []; }
    catch (e) { console.warn('[list-audio-processes] lỗi:', e.message); return []; }
  });

  // ── Ngôn ngữ caption Teams (spoken language) ──
  // KHÔNG tự đặt: spoken language là cài đặt CHUNG của meeting — đổi sẽ đổi cho MỌI người trong cuộc họp.
  // Để Teams tự dò theo người nói (auto). (No-op giữ để renderer cũ gọi không lỗi.)
  ipcMain.on('set-stt-lang', () => {});
  ipcMain.handle('get-stt-lang', async () => null);

  // ── Debug browser ─────────────────────
  ipcMain.handle('launch-debug-browser', async (_, { port }) => {
    const debugPort = port || 9223;
    const url = 'https://teams.microsoft.com';
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    let browserExe = null;
    for (const p of [...edgePaths, ...chromePaths]) {
      if (fs.existsSync(p)) { browserExe = p; break; }
    }
    if (!browserExe) return { ok: false, error: 'Không tìm thấy Edge hoặc Chrome' };
    const args = `--remote-debugging-port=${debugPort} --user-data-dir=${app.getPath('userData')}\\debug-browser "${url}"`;
    exec(`"${browserExe}" ${args}`, err => {
      if (err) console.warn('[launch-browser]', err.message);
    });
    return { ok: true, port: debugPort, browser: browserExe.includes('msedge') ? 'Edge' : 'Chrome' };
  });

  // ── Desktop windows ───────────────────
  ipcMain.handle('get-open-windows', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 240, height: 150 },
        fetchWindowIcons: true,
      });
      return sources
        .filter(s => s.name && s.name.trim())
        .map(s => ({
          id: s.id,
          name: s.name,
          thumb: s.thumbnail.toDataURL(),
          appIcon: (s.appIcon && !s.appIcon.isEmpty()) ? s.appIcon.toDataURL() : null,
        }));
    } catch (e) {
      console.warn('[get-open-windows]', e.message);
      return [];
    }
  });

  // ── Browser tabs scan ─────────────────
  ipcMain.handle('scan-all-tabs', async () => scanBrowserTabs());

  // ── Settings ──────────────────────────
  ipcMain.handle('get-settings', () => ({
    provider:        Store.get('provider',        'online'),
    apiKey:          Store.get('apiKey',          ''),
    providerKeys:    Store.get('providerKeys',    {}),
    theme:           Store.get('theme',           'auto'),
    uiLang:          Store.get('uiLang',          'vi'),
    lang:            Store.get('lang',            'vi'),
    captureSource:   Store.get('captureSource',   'teams'),
    micDeviceId:     Store.get('micDeviceId',     ''),
    srcLang:         Store.get('srcLang',         ''),
    ttsEnabled:      Store.get('ttsEnabled',      false),
    ttsVoice:        Store.get('ttsVoice',        0),
    audioProcessPid:   Store.get('audioProcessPid',   ''),
    audioProcessTitle: Store.get('audioProcessTitle', ''),
    overlayEnabled:  Store.get('overlayEnabled',  true),
    localPreset:        Store.get('localPreset',        'milmmt'),
    localBaseUrl:       Store.get('localBaseUrl',       LOCAL_DEFAULTS.baseUrl),
    localModel:         Store.get('localModel',         LOCAL_DEFAULTS.model),
    localBinaryVariant: Store.get('localBinaryVariant', 'cpu'),
  }));

  ipcMain.on('save-settings', (_, s) => {
    if (s.provider      !== undefined) { Store.set('provider',      s.provider);      state.provider = s.provider; }
    if (s.apiKey        !== undefined) { Store.set('apiKey',        s.apiKey);        state.apiKey   = s.apiKey; }
    if (s.providerKeys  !== undefined) { Store.set('providerKeys',  s.providerKeys); }
    if (s.theme         !== undefined) { Store.set('theme',         s.theme);         state.theme  = s.theme; }
    if (s.uiLang        !== undefined) { Store.set('uiLang',        s.uiLang);        state.uiLang = s.uiLang; }
    if (s.captureSource !== undefined) {
      if (s.captureSource !== state.captureSource) {
        state.captureSourceChanged = true;
        state.userActive = false;   // đổi nguồn → reset về idle, không auto-play nguồn mới (cũng tránh teams auto-resume)
        try { if (processAudio.isActive()) processAudio.stop(); } catch {}   // đổi nguồn → dừng thu-theo-tiến-trình đang chạy
      }
      state.captureSource = s.captureSource;
      Store.set('captureSource', s.captureSource);
    }
    if (s.micDeviceId     !== undefined) { Store.set('micDeviceId',     s.micDeviceId); }
    if (s.audioProcessTitle !== undefined) { Store.set('audioProcessTitle', s.audioProcessTitle || ''); }
    if (s.audioProcessPid !== undefined) {
      const next = s.audioProcessPid || '';
      const changed = next !== Store.get('audioProcessPid', '');
      Store.set('audioProcessPid', next);
      // Đổi tiến trình khi ĐANG thu (system, đã ▶) → khởi động lại nguồn cho khớp lựa chọn mới.
      if (changed && state.captureSource === 'system' && !state.audioPaused) {
        try { flushStreaming(); } catch {}
        try { resetSegmentation(); } catch {}
        if (processAudio.isActive()) processAudio.stop();
        else send('stop-audio-capture', {});
        if (next && processAudio.isSupported() && processAudio.start(next)) { /* thu theo tiến trình */ }
        else send('start-audio-capture', { source: state.captureSource });
      }
    }
    if (s.ttsVoice        !== undefined) { Store.set('ttsVoice', Math.max(0, Math.min(9, parseInt(s.ttsVoice, 10) || 0))); }
    if (s.ttsEnabled      !== undefined) {
      Store.set('ttsEnabled', !!s.ttsEnabled);
      if (s.ttsEnabled) { try { tts.warm(); } catch {} }   // bật loa → nạp sẵn model để câu đầu không khựng
      else { try { tts.unload(); } catch {} }              // tắt loa → nhả RAM model (B2)
    }
    if (s.srcLang         !== undefined) {
      const srcChanged = s.srcLang !== Store.get('srcLang', '');
      Store.set('srcLang', s.srcLang); try { stt.setLanguage(s.srcLang); } catch {}
      // Đổi ngôn ngữ nguồn khi đang ở chế độ audio → tải SẴN model mới (phủ overlay) để ▶ lần sau không khựng.
      if (srcChanged && (state.captureSource === 'system' || state.captureSource === 'mic')) {
        warmModel().catch(() => {});
      }
    }
    if (s.overlayEnabled  !== undefined) { Store.set('overlayEnabled',  !!s.overlayEnabled); state.overlayEnabled = !!s.overlayEnabled; try { overlay.setEnabled(!!s.overlayEnabled); } catch {} }
    if (s.localBaseUrl    !== undefined) { Store.set('localBaseUrl',    s.localBaseUrl);    state.localBaseUrl    = s.localBaseUrl; }
    if (s.localModel      !== undefined) { Store.set('localModel',      s.localModel);      state.localModel      = s.localModel; }
    send('settings-saved', { ok: true });
    // Vừa chọn local → tự khởi động server (báo nếu chưa cài). Server giữ chạy tới khi đóng app.
    // Ngược lại: vừa đổi SANG provider khác local → tắt llama-server để giải phóng ~1GB RAM
    // (model bị --mlock ghim cứng) — không request nào tới nó nữa.
    if (state.provider === 'local') ensureLocalServerStarted(true);
    else if (s.provider !== undefined && s.provider !== 'local') {
      try { localLlm.stopServer(); } catch {}
    }
  });

  // ── Local LLM ─────────────────────────
  ipcMain.handle('check-local-llm',           async () => checkLocalServer());
  ipcMain.handle('local-llm-status',          () => localLlm.serverStatus());
  ipcMain.handle('local-llm-detect-gpu',      async () => localLlm.detectGpu(true));
  ipcMain.handle('local-llm-download-binary', async () => {
    // Tải SẴN tất cả binary phù hợp (cpu + vulkan [+ cuda nếu có NVIDIA]) — start sẽ tự chọn
    const r = await localLlm.downloadAllBinaries({
      onProgress: (p) => send('local-llm-progress', { task: 'binary', ...p }),
    });
    if (r.ok && r.selected) {
      Store.set('localBinaryVariant', r.selected);
      state.localBinaryVariant = r.selected;
    }
    if (r.ok) ensureLocalServerStarted();   // tải binary xong → tự start nếu provider=local + đã đủ model
    return r;
  });
  ipcMain.handle('local-llm-download-model', async (_, { kind, url, filename }) => {
    const id = `model:${kind}`;
    const r = await localLlm.downloadModel({
      id, url, filename,
      onProgress: (p) => send('local-llm-progress', { task: id, ...p }),
    });
    if (r && r.ok) ensureLocalServerStarted();   // tải model xong → tự start nếu provider=local + đã đủ binary
    return r;
  });
  ipcMain.handle('local-llm-cancel-download', (_, { task }) => ({ ok: localLlm.cancelDownload(task) }));
  ipcMain.handle('local-llm-start', async (_, opts = {}) => localLlm.startServer(opts));
  ipcMain.handle('local-llm-stop',  () => localLlm.stopServer());

  // ── External links ────────────────────
  ipcMain.on('open-external', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // ── Clipboard (Electron native — đáng tin hơn navigator.clipboard ở renderer) ──
  ipcMain.handle('copy-to-clipboard', (_, text) => {
    try { clipboard.writeText(String(text ?? '')); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // ── Summary ───────────────────────────
  ipcMain.handle('summarize-meeting', async (_, captions) => summarizeMeeting(captions));
  ipcMain.handle('export-summary', async (_, opts) => exportSummary(opts));
}

module.exports = { registerAll, ensureLocalServerStarted };
