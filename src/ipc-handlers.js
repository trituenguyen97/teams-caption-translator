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
const { handleAudioChunk } = require('./audio-stt');
const { timestamp } = require('./caption-service');
const { summarizeMeeting, exportSummary } = require('./summary');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (ch, data) => state.win?.webContents?.send(ch, data);

function registerAll(app) {
  // ── Language ──────────────────────────
  ipcMain.on('set-lang', (_, lang) => {
    state.targetLang = LANG_NAMES[lang] || lang;
    state.targetLangLabel = LANG_LABELS[lang] || lang.toUpperCase();
  });

  // ── Window ────────────────────────────
  ipcMain.on('focus-window', () => { state.win?.show(); state.win?.focus(); });

  ipcMain.on('set-always-on-top', (_, v) => {
    state.pinned = v;
    state.win?.setAlwaysOnTop(v, v ? 'screen-saver' : 'normal');
    if (v) state.win?.focus();
  });

  // Auto-start local LLM server (fire-and-forget, không block toggle-captions)
  function ensureLocalServerStarted() {
    if (state.provider !== 'local') return;
    try {
      const st = localLlm.serverStatus();
      if (st.running) return;
      if (!st.binaryReady || !st.modelReady) {
        console.warn('[auto-start] thiếu binary/model — bỏ qua auto-start');
        send('status', { type: 'error', msg: '⚠ Local LLM chưa cài đủ — vào ⚙️ → Local LLM → Tải tất cả' });
        return;
      }
      console.log('[auto-start] khởi động local LLM server…');
      send('status', { type: 'loading', msg: '⏳ Đang khởi động Local LLM server…' });
      localLlm.startServer({ port: 8080 })
        .then(r => {
          if (r.ok) {
            console.log('[auto-start] local server OK', r.pid);
            send('status', { type: 'running', msg: `▶ Local LLM ready (PID ${r.pid}, -t ${r.threads || '?'})` });
          } else {
            console.warn('[auto-start] fail:', r.error);
            send('status', { type: 'error', msg: '❌ Local LLM start: ' + r.error });
          }
        })
        .catch(e => console.warn('[auto-start] error:', e.message));
    } catch (e) { console.warn('[auto-start] exception:', e.message); }
  }

  // ── Captions toggle ───────────────────
  ipcMain.on('toggle-captions', async (_, desired) => {
    // Khi user bấm ▶ caption và đang dùng local LLM → tự khởi động server
    ensureLocalServerStarted();
    // Audio mode
    if (state.captureSource !== 'teams') {
      state.audioPaused = !state.audioPaused;
      const label = state.captureSource === 'mic' ? 'Microphone' : 'System Audio';
      if (state.audioPaused) {
        send('stop-audio-capture', {});
        send('cc-state', { active: false });
        send('status', { type: 'ended', msg: 'Ghi âm dừng — nhấn ▶ để tiếp tục' });
      } else {
        send('start-audio-capture', { source: state.captureSource });
        send('cc-state', { active: true });
        send('status', { type: 'running', msg: `🎙️ Đang ghi âm (${label})` });
      }
      return;
    }

    // Refresh meetingPage trước khi toggle
    const freshPage = await findMeetingPage();
    if (freshPage) state.meetingPage = freshPage;

    if (!state.meetingPage) {
      console.log('[toggle-captions] không có meetingPage → fallback PowerShell SendKeys');
      await tryPowerShellSendKeys();
      return;
    }

    const stateBefore = await checkCaptionsActive();
    console.log('[toggle-captions] state trước:', stateBefore, '| muốn:', desired);

    // Nếu caption đã ở đúng trạng thái mong muốn (vd đã bật sẵn mà user bấm ▶ để play)
    // → KHÔNG toggle (tránh tắt nhầm caption đang chạy), chỉ đồng bộ trạng thái nút.
    if (typeof desired === 'boolean' && stateBefore === desired) {
      console.log('[toggle-captions] đã đúng trạng thái → giữ nguyên, chỉ đồng bộ');
      send('cc-state', { active: stateBefore });
      return;
    }

    // Cách 1: inject Alt+Shift+C
    await injectToggleCaptionsKey();
    await sleep(1500);
    const stateAfter = await checkCaptionsActive();
    console.log('[toggle-captions] state sau inject key:', stateAfter, '| đổi:', stateAfter !== stateBefore);

    // Cách 2: DOM click
    if (stateAfter === stateBefore) {
      console.log('[toggle-captions] inject key không hiệu quả, thử DOM click...');
      const domResult = await tryToggleCaptionsViaDOM();
      console.log('[toggle-captions] DOM click:', domResult);
      await sleep(1200);
    }

    // Cách 3: PowerShell SendKeys
    if (await checkCaptionsActive() === stateBefore) {
      console.log('[toggle-captions] thử PowerShell SendKeys...');
      await tryPowerShellSendKeys();
    }

    const active = await checkCaptionsActive();
    console.log('[toggle-captions] cc-state cuối:', active);
    send('cc-state', { active });
  });

  // ── Audio chunk (STT) ─────────────────
  ipcMain.on('audio-chunk', async (_, { buffer, mimeType }) => {
    await handleAudioChunk(buffer, mimeType);
  });

  // ── STT language ──────────────────────
  ipcMain.on('set-stt-lang', async (_, langText) => {
    const ok = await setSttLanguage(langText);
    const current = await getSttLanguage();
    send('stt-lang', { current, ok });
  });

  ipcMain.handle('get-stt-lang', async () => getSttLanguage());

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
    provider:        Store.get('provider',        'groq'),
    apiKey:          Store.get('apiKey',          ''),
    providerKeys:    Store.get('providerKeys',    {}),
    captureSource:   Store.get('captureSource',   'teams'),
    micDeviceId:     Store.get('micDeviceId',     ''),
    localPreset:        Store.get('localPreset',        'qwen3'),
    localBaseUrl:       Store.get('localBaseUrl',       LOCAL_DEFAULTS.baseUrl),
    localModel:         Store.get('localModel',         LOCAL_DEFAULTS.model),
    localDraftModel:    Store.get('localDraftModel',    LOCAL_DEFAULTS.draftModel),
    localBinaryVariant: Store.get('localBinaryVariant', 'cpu'),
  }));

  ipcMain.on('save-settings', (_, s) => {
    if (s.provider      !== undefined) { Store.set('provider',      s.provider);      state.provider = s.provider; }
    if (s.apiKey        !== undefined) { Store.set('apiKey',        s.apiKey);        state.apiKey   = s.apiKey; }
    if (s.providerKeys  !== undefined) { Store.set('providerKeys',  s.providerKeys); }
    if (s.captureSource !== undefined) {
      if (s.captureSource !== state.captureSource) state.captureSourceChanged = true;
      state.captureSource = s.captureSource;
      Store.set('captureSource', s.captureSource);
    }
    if (s.micDeviceId     !== undefined) { Store.set('micDeviceId',     s.micDeviceId); }
    if (s.localPreset     !== undefined) { Store.set('localPreset',     s.localPreset);     state.localPreset     = s.localPreset; }
    if (s.localBaseUrl    !== undefined) { Store.set('localBaseUrl',    s.localBaseUrl);    state.localBaseUrl    = s.localBaseUrl; }
    if (s.localModel      !== undefined) { Store.set('localModel',      s.localModel);      state.localModel      = s.localModel; }
    if (s.localDraftModel !== undefined) { Store.set('localDraftModel', s.localDraftModel); state.localDraftModel = s.localDraftModel; }
    send('settings-saved', { ok: true });
    // Auto-start nếu provider vừa đổi sang local + đã có model
    if (state.provider === 'local') ensureLocalServerStarted();
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
    return r;
  });
  ipcMain.handle('local-llm-download-model', async (_, { kind, url, filename }) => {
    const id = `model:${kind}`;
    return localLlm.downloadModel({
      id, url, filename,
      onProgress: (p) => send('local-llm-progress', { task: id, ...p }),
    });
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

module.exports = { registerAll };
