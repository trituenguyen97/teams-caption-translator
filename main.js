/**
 * main.js — Thin entry point. Electron lifecycle + createWindow + startService loop.
 * App dịch caption qua Gemini 3.5 Live Translate (audio → STT + dịch + TTS). Không còn model local.
 */
const { app, BrowserWindow, desktopCapturer, Menu, nativeTheme } = require('electron');
const path = require('path');
const state = require('./src/state');
const Store = require('./src/store');
const { registerAll } = require('./src/ipc-handlers');
const { LANG_NAMES, LANG_LABELS } = require('./src/langs');
const { runAudioService, stopSTTServer } = require('./src/audio-stt');
const { runUiaService, stopHelper: stopUiaHelper } = require('./src/uia-captions');   // chế độ Teams (UIA caption)

// Tắt GPU hardware acceleration
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-software-rasterizer');
// Cho phép AudioContext PHÁT mà không cần user-gesture (Electron mặc định chặn autoplay → TTS Gemini không kêu).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Electron Window ─────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 500,
    height: 720,
    minWidth: 520,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,   // không throttle khi bị che → thu audio + caption không giật
    },
    title: 'Caption Translator',
    frame: false,
    backgroundColor: (state.theme === 'dark' || (state.theme !== 'light' && nativeTheme.shouldUseDarkColors)) ? '#131314' : '#f6f8fc',
    alwaysOnTop: false,
    show: false,
  });
  win.loadFile('app.html');
  state.win = win;

  win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(['media', 'audioCapture', 'videoCapture', 'screen', 'desktopCapture'].includes(permission));
  });
  win.webContents.session.setPermissionCheckHandler((wc, permission) => {
    return ['media', 'audioCapture', 'videoCapture', 'screen', 'desktopCapture'].includes(permission);
  });
  // System audio loopback
  win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(sources => {
      if (sources.length === 0) { callback({}); return; }
      callback({ video: sources[0], audio: 'loopback' });
    }).catch(() => callback({}));
  });

  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { state.win = null; });
  win.on('minimize', () => { if (state.pinned) setTimeout(() => { win?.restore(); win?.setAlwaysOnTop(true, 'screen-saver'); }, 80); });
  win.on('restore', () => { if (state.pinned) { win?.setAlwaysOnTop(true, 'screen-saver'); win?.focus(); } });
  win.on('maximize',   () => { try { win.webContents.send('window-max-state', { max: true }); } catch {} });
  win.on('unmaximize', () => { try { win.webContents.send('window-max-state', { max: false }); } catch {} });
}

// ── Service loop — tự restart khi đổi nguồn ──
async function startService() {
  while (true) {
    state.captureSourceChanged = false;
    state.userActive = false;   // mỗi (re)start → IDLE, chờ user bấm ▶ (không auto-play)
    try { if (state.captureSource === 'teams') await runUiaService(); else await runAudioService(); }
    catch (e) { console.error('[startService] lỗi:', e.message); }
    if (state.captureSourceChanged) await sleep(300);
    else await sleep(2000);
  }
}

// ── App lifecycle ───────────────────────────────────────
app.whenReady().then(() => {
  state.provider      = 'gemini-live';                       // engine duy nhất giờ là Gemini Live Translate
  state.apiKey        = Store.get('apiKey',        '');
  state.geminiAudioOn = Store.get('geminiAudioOn', true);
  state.geminiVoice   = Store.get('geminiVoice',   'Achernar');
  state.transcribeMode = Store.get('transcribeMode', false);   // PHẢI nạp ở main: gemini-live/summary đọc state này (không thì desync UI=chép-lời nhưng main=dịch+TTS)
  state.summaryExtra  = Store.get('summaryExtra',   '');       // prompt tóm tắt riêng cũng dùng ở main
  state.theme         = Store.get('theme',         'auto');
  state.uiLang        = Store.get('uiLang',        'vi');
  const _savedLang = Store.get('lang', 'vi');
  state.langCode        = _savedLang;
  state.targetLang      = LANG_NAMES[_savedLang]  || 'Vietnamese';
  state.targetLangLabel = LANG_LABELS[_savedLang] || 'tiếng Việt';
  Menu.setApplicationMenu(null);
  // Nguồn: 'teams' (UIA caption), 'system' (audio app), 'mic'. Giá trị lạ → 'system'.
  let cs = Store.get('captureSource', 'system');
  if (cs !== 'system' && cs !== 'mic' && cs !== 'teams') cs = 'system';
  state.captureSource = cs;
  Store.set('captureSource', cs);

  registerAll(app);
  createWindow();
  startService();

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => {
  stopSTTServer();
  try { stopUiaHelper(); } catch {}
  try { require('./src/process-audio').stop(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  try { stopUiaHelper(); } catch {}
  try { require('./src/process-audio').stop(); } catch {}
});
