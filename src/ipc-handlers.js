/**
 * ipc-handlers.js — All IPC communication between main ↔ renderer
 */
const { ipcMain, desktopCapturer, shell } = require('electron');
const { exec } = require('child_process');
const fs = require('fs');
const state = require('./state');
const Store = require('./store');
const { LANG_NAMES, LANG_LABELS, checkGroqQuota, preprocessText, enqueueTranslate } = require('./translation');
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

  // ── Captions toggle ───────────────────
  ipcMain.on('toggle-captions', async () => {
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
    console.log('[toggle-captions] state trước:', stateBefore);

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

  // ── Groq quota ────────────────────────
  ipcMain.handle('check-groq-quota', async (_, model, uiKey) => {
    const key = uiKey || state.apiKey || Store.get('apiKey', '');
    if (!key) return { error: 'Chưa có API key' };
    return checkGroqQuota(key, model || state.llmModel);
  });

  // ── Settings ──────────────────────────
  ipcMain.handle('get-settings', () => ({
    provider:        Store.get('provider',        'groq'),
    apiKey:          Store.get('apiKey',          ''),
    llmModel:        Store.get('llmModel',        'llama-3.1-8b-instant'),
    providerKeys:    Store.get('providerKeys',    {}),
    providerModels:  Store.get('providerModels',  {}),
    captureSource:   Store.get('captureSource',   'teams'),
    micDeviceId:     Store.get('micDeviceId',     ''),
    summaryProvider: Store.get('summaryProvider', 'groq'),
    summaryApiKey:   Store.get('summaryApiKey',   ''),
    summaryModel:    Store.get('summaryModel',    ''),
    summaryKeys:     Store.get('summaryKeys',     {}),
    summaryModels:   Store.get('summaryModels',   {}),
  }));

  ipcMain.on('save-settings', (_, s) => {
    if (s.provider      !== undefined) { Store.set('provider',      s.provider);      state.provider = s.provider; }
    if (s.apiKey        !== undefined) { Store.set('apiKey',        s.apiKey);        state.apiKey   = s.apiKey; }
    if (s.llmModel      !== undefined) { Store.set('llmModel',      s.llmModel);      state.llmModel = s.llmModel; }
    if (s.providerKeys  !== undefined) { Store.set('providerKeys',  s.providerKeys); }
    if (s.providerModels!== undefined) { Store.set('providerModels', s.providerModels); }
    if (s.captureSource !== undefined) {
      if (s.captureSource !== state.captureSource) state.captureSourceChanged = true;
      state.captureSource = s.captureSource;
      Store.set('captureSource', s.captureSource);
    }
    if (s.micDeviceId     !== undefined) { Store.set('micDeviceId',     s.micDeviceId); }
    if (s.summaryProvider !== undefined) { Store.set('summaryProvider', s.summaryProvider); }
    if (s.summaryApiKey   !== undefined) { Store.set('summaryApiKey',   s.summaryApiKey); }
    if (s.summaryModel    !== undefined) { Store.set('summaryModel',    s.summaryModel); }
    if (s.summaryKeys     !== undefined) { Store.set('summaryKeys',     s.summaryKeys); }
    if (s.summaryModels   !== undefined) { Store.set('summaryModels',   s.summaryModels); }
    send('settings-saved', { ok: true });
  });

  // ── External links ────────────────────
  ipcMain.on('open-external', (_, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
  });

  // ── Summary ───────────────────────────
  ipcMain.handle('summarize-meeting', async (_, captions) => summarizeMeeting(captions));
  ipcMain.handle('export-summary', async (_, opts) => exportSummary(opts));
}

module.exports = { registerAll };
