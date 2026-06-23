/**
 * ipc-handlers.js — IPC main ↔ renderer. App dịch qua Gemini 3.5 Live Translate (audio→STT+dịch+TTS).
 */
const { ipcMain, shell, clipboard, dialog } = require('electron');
const fs = require('fs');
const state = require('./state');
const Store = require('./store');
const { LANG_NAMES, LANG_LABELS } = require('./langs');
const { handlePcm } = require('./audio-stt');
const geminiLive = require('./gemini-live');          // audio-in (system/mic) — gemini-3.5-live-translate
const geminiTextLive = require('./gemini-text-live'); // text-in (Teams caption) — gemini-3.1-flash-live
const geminiText = require('./gemini-text');          // summary
const processAudio = require('./process-audio');
const uia = require('./uia-captions');

const send = (ch, data) => state.win?.webContents?.send(ch, data);

function registerAll(app) {
  // ── Ngôn ngữ ĐÍCH (live-translate tự nhận nguồn) ──
  ipcMain.on('set-lang', (_, lang) => {
    state.targetLang = LANG_NAMES[lang] || lang;
    state.targetLangLabel = LANG_LABELS[lang] || lang.toUpperCase();
    state.langCode = lang;
    Store.set('lang', lang);
    try { geminiLive.onTargetLangChanged(); } catch {}       // audio mode → nối lại phiên với target mới
    try { geminiTextLive.onTargetLangChanged(); } catch {}   // teams mode → nối lại phiên với target mới
  });

  // ── Window ──
  ipcMain.on('focus-window', () => { state.win?.show(); state.win?.focus(); });
  ipcMain.on('window-minimize', () => { try { state.win?.minimize(); } catch {} });
  ipcMain.on('window-maximize', () => { const w = state.win; if (!w) return; try { w.isMaximized() ? w.unmaximize() : w.maximize(); } catch {} });
  ipcMain.on('window-close',    () => { try { state.win?.close(); } catch {} });
  ipcMain.on('set-always-on-top', (_, v) => { state.pinned = v; state.win?.setAlwaysOnTop(v, v ? 'screen-saver' : 'normal'); if (v) state.win?.focus(); });

  // ── ▶/⏹ ──
  ipcMain.on('toggle-captions', (_, desired) => {
    // CHẾ ĐỘ AUDIO (system/mic) → gemini-3.5-live-translate (audio-in)
    if (state.captureSource !== 'teams') {
      state.audioPaused = !state.audioPaused;
      state.userActive  = !state.audioPaused;
      const label = state.captureSource === 'mic' ? 'Microphone' : 'System Audio';
      if (state.audioPaused) {   // ⏹
        try { geminiLive.stop(); } catch {}
        if (processAudio.isActive()) processAudio.stop(); else send('stop-audio-capture', {});
        send('cc-state', { active: false });
        send('status', { type: 'ended', key: 'status.recordingPaused' });
        return;
      }
      try { geminiLive.start(); } catch {}   // ▶
      const pid = Store.get('audioProcessPid', '');
      if (pid && state.captureSource === 'system' && processAudio.isSupported() && processAudio.start(pid)) { /* thu theo tiến trình */ }
      else send('start-audio-capture', { source: state.captureSource });
      send('cc-state', { active: true });
      send('status', { type: 'running', key: 'status.audioRecording', vars: { label } });
      return;
    }
    // CHẾ ĐỘ TEAMS (UIA caption text) → gemini-3.1-flash-live (text-in)
    const wantOn = (typeof desired === 'boolean') ? desired : !state.userActive;
    if (!wantOn) {   // ⏹
      state.userActive = false;
      try { geminiTextLive.stop(); } catch {}
      send('cc-state', { active: false });
      send('status', { type: 'idle', key: 'status.idle' });
      return;
    }
    state.userActive = true;   // ▶
    try { geminiTextLive.start(); } catch {}
    const active = uia.isCaptionsOn();
    send('cc-state', { active });
    if (!active) {
      if (!state.pinned && !state._tempPin) {   // pin tạm để Alt+Shift+C không che app
        state._tempPin = true;
        try { state.win?.setAlwaysOnTop(true, 'screen-saver'); } catch {}
        setTimeout(() => { if (state._tempPin) { state._tempPin = false; try { state.win?.setAlwaysOnTop(!!state.pinned, state.pinned ? 'screen-saver' : 'normal'); } catch {} } }, 8000);
      }
      send('status', { type: 'enabling-captions', key: 'status.enablingCaptions' });
      try { uia.enableCaptions(); } catch {}
    }
  });

  // ── Audio PCM Float32 @16k từ renderer (Web Audio) → handlePcm → Gemini ──
  ipcMain.on('audio-pcm', async (_, data) => {
    let f32;
    if (data instanceof Float32Array) f32 = data;
    else if (Buffer.isBuffer(data)) f32 = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    else if (data instanceof ArrayBuffer) f32 = new Float32Array(data);
    else if (data && data.buffer) f32 = new Float32Array(data.buffer, data.byteOffset || 0, Math.floor((data.byteLength || 0) / 4));
    else return;
    try { await handlePcm(f32); } catch (e) { console.warn('[audio-pcm] lỗi:', e.message); }
  });

  // ── Liệt kê tiến trình để thu theo tiến trình (Process Loopback, khử feedback TTS) ──
  ipcMain.handle('list-audio-processes', async () => {
    try { return processAudio.isSupported() ? await processAudio.listProcesses() : []; }
    catch (e) { console.warn('[list-audio-processes] lỗi:', e.message); return []; }
  });

  // ── Validate Gemini API key (on-blur ô nhập key) ──
  ipcMain.handle('validate-gemini-key', async (_, key) => {
    try { return await geminiLive.validateKey(key); }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // ── Settings ──
  ipcMain.handle('get-settings', () => ({
    apiKey:            Store.get('apiKey',            ''),
    theme:             Store.get('theme',             'auto'),
    uiLang:            Store.get('uiLang',            'vi'),
    lang:              Store.get('lang',              'vi'),
    captureSource:     Store.get('captureSource',     'system'),
    micDeviceId:       Store.get('micDeviceId',       ''),
    geminiAudioOn:     Store.get('geminiAudioOn',     true),
    geminiVoice:       Store.get('geminiVoice',       'Achernar'),
    audioProcessPid:   Store.get('audioProcessPid',   ''),
    audioProcessTitle: Store.get('audioProcessTitle', ''),
  }));

  ipcMain.on('save-settings', (_, s) => {
    if (s.apiKey        !== undefined) { Store.set('apiKey', s.apiKey); state.apiKey = s.apiKey; }
    if (s.theme         !== undefined) { Store.set('theme',  s.theme);  state.theme  = s.theme; }
    if (s.uiLang        !== undefined) { Store.set('uiLang', s.uiLang); state.uiLang = s.uiLang; }
    if (s.captureSource !== undefined) {
      if (s.captureSource !== state.captureSource) {
        state.captureSourceChanged = true;
        state.userActive = false;
        try { if (processAudio.isActive()) processAudio.stop(); } catch {}
      }
      state.captureSource = s.captureSource;
      Store.set('captureSource', s.captureSource);
    }
    if (s.micDeviceId       !== undefined) { Store.set('micDeviceId', s.micDeviceId); }
    if (s.audioProcessTitle !== undefined) { Store.set('audioProcessTitle', s.audioProcessTitle || ''); }
    if (s.audioProcessPid   !== undefined) {
      const next = s.audioProcessPid || '';
      const changed = next !== Store.get('audioProcessPid', '');
      Store.set('audioProcessPid', next);
      if (changed && state.captureSource === 'system' && !state.audioPaused) {   // đổi tiến trình khi đang thu → restart nguồn
        if (processAudio.isActive()) processAudio.stop(); else send('stop-audio-capture', {});
        if (next && processAudio.isSupported() && processAudio.start(next)) { /* thu theo tiến trình */ }
        else send('start-audio-capture', { source: state.captureSource });
      }
    }
    if (s.geminiAudioOn !== undefined) { Store.set('geminiAudioOn', !!s.geminiAudioOn); state.geminiAudioOn = !!s.geminiAudioOn; try { geminiLive.setAudioOn(!!s.geminiAudioOn); } catch {} }
    if (s.geminiVoice   !== undefined) { Store.set('geminiVoice', s.geminiVoice); state.geminiVoice = s.geminiVoice; try { geminiLive.onTargetLangChanged(); } catch {} try { geminiTextLive.onTargetLangChanged(); } catch {} }   // đổi giọng → nối lại phiên áp giọng mới
    send('settings-saved', { ok: true });
  });

  // ── External + clipboard ──
  ipcMain.on('open-external', (_, url) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); });
  ipcMain.handle('copy-to-clipboard', (_, text) => { try { clipboard.writeText(String(text ?? '')); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });

  // ── Summary (panel cạnh, rolling qua Gemini) ──
  ipcMain.handle('summarize-gemini', async (_, payload) => {
    try { return await geminiText.summarize(payload); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  // Tóm tắt TỔNG THỂ (bấm khi họp xong) → báo cáo chi tiết qua gemma-4-31b (→ 26b). Nhận mảng caption toàn cuộc họp.
  ipcMain.handle('summarize-meeting', async (_, captions) => {
    try { return await geminiText.summarizeFull(captions); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('export-summary', async (_, opts = {}) => {
    try {
      const { filePath, canceled } = await dialog.showSaveDialog(state.win, {
        title: 'Lưu tóm tắt',
        defaultPath: opts.defaultName || ('summary-' + new Date().toISOString().slice(0, 10) + '.md'),
        filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
      });
      if (canceled || !filePath) return { ok: false };
      fs.writeFileSync(filePath, opts.markdown || '', 'utf8');
      return { ok: true, filePath };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── Summary panel mở/đóng → nới/co cửa sổ (chia 2 cột) ──
  const SUM_PANEL_W = 380;
  ipcMain.on('summary-panel', (_, open) => {
    try {
      const w = state.win; if (!w) return;
      const b = w.getBounds();
      if (open && !state._sumPanelOpen) { w.setBounds({ x: b.x, y: b.y, width: b.width + SUM_PANEL_W, height: b.height }); state._sumPanelOpen = true; }
      else if (!open && state._sumPanelOpen) { w.setBounds({ x: b.x, y: b.y, width: Math.max(420, b.width - SUM_PANEL_W), height: b.height }); state._sumPanelOpen = false; }
    } catch (e) { console.warn('[summary-panel] resize lỗi:', e.message); }
  });
}

module.exports = { registerAll };
