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
  win.on('close', () => {
    // Đóng các BrowserWindow webchat ẩn để 'window-all-closed' fire được
    try { require('./src/webchat').destroyAllWindows(); } catch {}
  });
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
  // Migrate: groq/gemini/openai đã bị loại khỏi translation → fallback google-free
  const savedProvider = Store.get('provider', 'google-free');
  if (['groq', 'gemini', 'openai'].includes(savedProvider)) {
    console.log('[migrate] provider', savedProvider, '→ google-free (cloud LLM đã bị xóa khỏi translation)');
    Store.set('provider', 'google-free');
    state.provider = 'google-free';
  } else {
    state.provider = savedProvider;
  }
  state.apiKey        = Store.get('apiKey',        '');
  state.captureSource = Store.get('captureSource', 'teams');
  state.localBaseUrl       = Store.get('localBaseUrl',       state.localBaseUrl);
  state.localModel         = Store.get('localModel',         state.localModel);
  state.localBinaryVariant = Store.get('localBinaryVariant', state.localBinaryVariant);
  // App giờ chỉ dùng MiLMMT-46 (model dịch JP→VI). Ép preset='milmmt' + migrate mọi model cũ
  // đã gỡ (Qwen3, Llama3-8B 1.58-bit ternary) về MiLMMT để không gọi nhánh/model không còn tồn tại.
  state.localPreset = 'milmmt';
  Store.set('localPreset', 'milmmt');
  const _isRemovedModel = f => /qwen|1\.58|tq1_0|tq2_0|bitnet/i.test(f || '');
  if (!state.localModel || _isRemovedModel(state.localModel)) {
    console.log('[migrate] local model', state.localModel, '→ MiLMMT-46-1B (model cũ đã bị gỡ)');
    state.localModel = 'MiLMMT-46-1B-v0.1.Q4_K_M.gguf';
    Store.set('localModel', state.localModel);
  }
  registerAll(app);
  createWindow();
  startService();
  // Auto-start local LLM server nếu provider=local + đã tải model
  if (state.provider === 'local') {
    setTimeout(() => {
      try {
        const localLlm = require('./src/local-llm');
        const st = localLlm.serverStatus();
        if (st.binaryReady && st.modelReady && !st.running) {
          console.log('[boot] auto-start local LLM server...');
          localLlm.startServer({ port: 8080 }).catch(e => console.warn('[boot] local server start:', e.message));
        }
      } catch (e) { console.warn('[boot] local-llm not ready:', e.message); }
    }, 2000);
  }
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopSTTServer();
  try { require('./src/local-llm').stopServer(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try { require('./src/local-llm').stopServer(); } catch {}
});
