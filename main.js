/**
 * main.js â€” Thin entry point
 * Electron app lifecycle + createWindow + startService loop.
 * Táº¥t cáº£ logic Ä‘Ã£ Ä‘Æ°á»£c tÃ¡ch sang src/ modules.
 */
const { app, BrowserWindow, desktopCapturer } = require('electron');
const path = require('path');
const state = require('./src/state');
const Store = require('./src/store');
const { registerAll } = require('./src/ipc-handlers');
const { runService } = require('./src/caption-service');
const { runAudioService, stopSTTServer } = require('./src/audio-stt');

// Táº¯t GPU hardware acceleration
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-software-rasterizer');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// â”€â”€ Electron Window â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function createWindow() {
  const win = new BrowserWindow({
    width: 500,
    height: 720,
    minWidth: 360,
    minHeight: 400,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Caption Translator',
    backgroundColor: '#1b1b1b',
    alwaysOnTop: false,
    show: false,
  });
  win.loadFile('app.html');
  state.win = win;

  // Permissions cho micro + display-media
  win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'videoCapture', 'screen', 'desktopCapture'];
    callback(allowed.includes(permission));
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
  win.on('minimize', () => {
    if (state.pinned) setTimeout(() => { win?.restore(); win?.setAlwaysOnTop(true, 'screen-saver'); }, 80);
  });
  win.on('restore', () => {
    if (state.pinned) { win?.setAlwaysOnTop(true, 'screen-saver'); win?.focus(); }
  });
}

// â”€â”€ Service loop â€” tá»± restart khi máº¥t káº¿t ná»‘i â”€â”€
async function startService() {
  while (true) {
    state.captureSourceChanged = false;
    try {
      if (state.captureSource === 'teams') {
        await runService();
      } else {
        await runAudioService();
      }
    } catch (e) {
      console.error('[startService] lá»—i:', e.message);
    }
    state.browser = null;
    state.meetingPage = null;
    if (state.captureSourceChanged) {
      console.log('[service] nguá»“n dá»‹ch thay Ä‘á»•i â†’ khá»Ÿi Ä‘á»™ng láº¡i ngay...');
      await sleep(300);
    } else {
      console.log('[service] Ä‘Ã£ thoÃ¡t, thá»­ káº¿t ná»‘i láº¡i sau 5s...');
      await sleep(5000);
    }
  }
}

// â”€â”€ App lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.whenReady().then(() => {
  state.provider      = Store.get('provider',      'groq');
  state.apiKey        = Store.get('apiKey',        '');
  state.llmModel      = Store.get('llmModel',      'llama-3.1-8b-instant');
  state.captureSource = Store.get('captureSource', 'teams');
  registerAll(app);
  createWindow();
  startService();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopSTTServer();
  if (process.platform !== 'darwin') app.quit();
});
