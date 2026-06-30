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
const geminiText = require('./gemini-text');          // summary
const processAudio = require('./process-audio');

const send = (ch, data) => state.win?.webContents?.send(ch, data);

function registerAll(app) {
  // ── Ngôn ngữ ĐÍCH (live-translate tự nhận nguồn) ──
  ipcMain.on('set-lang', (_, lang) => {
    state.targetLang = LANG_NAMES[lang] || lang;
    state.targetLangLabel = LANG_LABELS[lang] || lang.toUpperCase();
    state.langCode = lang;
    Store.set('lang', lang);
    try { geminiLive.onTargetLangChanged(); } catch {}       // audio mode → nối lại phiên với target mới
  });

  // ── Window ──
  ipcMain.on('focus-window', () => { state.win?.show(); state.win?.focus(); });
  ipcMain.on('window-minimize', () => { try { state.win?.minimize(); } catch {} });
  ipcMain.on('window-maximize', () => { const w = state.win; if (!w) return; try { w.isMaximized() ? w.unmaximize() : w.maximize(); } catch {} });
  ipcMain.on('window-close',    () => { try { state.win?.close(); } catch {} });
  ipcMain.on('set-always-on-top', (_, v) => { state.pinned = v; state.win?.setAlwaysOnTop(v, v ? 'screen-saver' : 'normal'); if (v) state.win?.focus(); });
  // Nới rộng cửa sổ tới tối thiểu px (layout 2 cột gốc|dịch cần đủ chỗ chứa). KHÔNG thu nhỏ.
  ipcMain.on('ensure-width', (_, px) => {
    try { const w = state.win; if (!w) return; const b = w.getBounds(); const want = Math.max(b.width, Math.floor(px) || 0); if (want > b.width) w.setBounds({ x: b.x, y: b.y, width: want, height: b.height }); } catch (e) {}
  });

  // Bắt đầu thu chế độ AUDIO: đã CHỌN APP (audioProcessName) → thu CÂY tiến trình gốc của app đó
  // (INCLUDE_TARGET_PROCESS_TREE phủ hết cửa sổ/meeting con; loại TTS của chính app → hết feedback).
  // "Toàn hệ thống" ("") → loopback toàn hệ thống ở renderer. PID resolve LÚC THU (PID đổi mỗi lần app mở lại).
  function startAudioCaptureForSource() {
    const appName = Store.get('audioProcessName', '');
    if (appName && state.captureSource === 'system' && processAudio.isSupported()) {
      processAudio.resolveRootPid(appName).then(pid => {
        if (state.audioPaused) return;   // đã ⏹ trong lúc resolve
        if (!(pid && processAudio.start(pid))) send('start-audio-capture', { source: state.captureSource });
      }).catch(() => { if (!state.audioPaused) send('start-audio-capture', { source: state.captureSource }); });
    } else {
      send('start-audio-capture', { source: state.captureSource });
    }
  }

  // ── ▶/⏹ (chế độ AUDIO system/mic → gemini-3.5-live-translate, audio-in) ──
  ipcMain.on('toggle-captions', () => {
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
    startAudioCaptureForSource();
    send('cc-state', { active: true });
    send('status', { type: 'running', key: 'status.audioRecording', vars: { label } });
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
    try { return processAudio.isSupported() ? await processAudio.listApps() : []; }
    catch (e) { console.warn('[list-audio-apps] lỗi:', e.message); return []; }
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
    summaryExtra:      Store.get('summaryExtra',      ''),
    audioProcessName:  Store.get('audioProcessName',  ''),
    audioProcessApp:   Store.get('audioProcessApp',   ''),
    layout:            Store.get('layout',            'translation'),
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
    if (s.micDeviceId      !== undefined) { Store.set('micDeviceId', s.micDeviceId); }
    if (s.audioProcessApp  !== undefined) { Store.set('audioProcessApp', s.audioProcessApp || ''); }
    if (s.audioProcessName !== undefined) {
      const next = s.audioProcessName || '';
      const changed = next !== Store.get('audioProcessName', '');
      Store.set('audioProcessName', next);
      if (changed && state.captureSource === 'system' && !state.audioPaused) {   // đổi APP khi đang thu → restart nguồn
        if (processAudio.isActive()) processAudio.stop(); else send('stop-audio-capture', {});
        startAudioCaptureForSource();
      }
    }
    if (s.geminiAudioOn !== undefined) { Store.set('geminiAudioOn', !!s.geminiAudioOn); state.geminiAudioOn = !!s.geminiAudioOn; try { geminiLive.setAudioOn(!!s.geminiAudioOn); } catch {} }
    if (s.summaryExtra !== undefined) { const v = String(s.summaryExtra || ''); Store.set('summaryExtra', v); state.summaryExtra = v; }   // yêu cầu tóm tắt riêng → áp ngay vòng tóm tắt kế (không cần nối lại phiên)
    if (s.layout !== undefined) { Store.set('layout', s.layout); }   // giao diện hiển thị gốc/dịch (renderer-only)
    if (s.geminiVoice   !== undefined) { Store.set('geminiVoice', s.geminiVoice); state.geminiVoice = s.geminiVoice; try { geminiLive.onTargetLangChanged(); } catch {} }   // đổi giọng → nối lại phiên áp giọng mới
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
  // Tổng thể CÓ CẤU TRÚC (JSON landing-page) → client render HTML đẹp. Lỗi → caller fallback summarize-meeting (markdown).
  ipcMain.handle('summarize-report', async (_, payload) => {
    try { const p = payload || {}; return await geminiText.summarizeReport(p.captions || [], p.facts || null, p.prevReport || null); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('export-summary', async (_, opts = {}) => {
    try {
      const { filePath, canceled } = await dialog.showSaveDialog(state.win, {
        title: opts.dialogTitle || 'Lưu tóm tắt',
        defaultPath: opts.defaultName || ('summary-' + new Date().toISOString().slice(0, 10) + '.md'),
        filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'HTML', extensions: ['html'] }, { name: 'Text', extensions: ['txt'] }],
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
