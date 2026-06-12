/**
 * main.js â€” Thin entry point
 * Electron app lifecycle + createWindow + startService loop.
 * Táº¥t cáº£ logic Ä‘Ã£ Ä‘Æ°á»£c tÃ¡ch sang src/ modules.
 */
// ⚠️ BẮT BUỘC LOAD ĐẦU TIÊN — TRƯỚC MỌI require src/ (đặc biệt trước sherpa-onnx-node).
// Windows chỉ giữ MỘT onnxruntime.dll mỗi process: nếu sherpa (bundle ORT riêng) load trước thì onnxruntime-node
// load SAU sẽ chết "The operating system cannot run %1" → punctuate-ja (dấu câu Nhật) + stt-moonshine (STT Hàn)
// chết lặng lẽ. Load onnxruntime-node TRƯỚC thì cả hai runtime cùng sống (đã verify). ĐỪNG chèn require lên trên dòng này.
try { require('onnxruntime-node'); } catch (e) { console.warn('[main] onnxruntime-node load lỗi (punctuation ja + STT ko sẽ tắt):', e.message); }

const { app, BrowserWindow, desktopCapturer, Menu, nativeTheme } = require('electron');
const path = require('path');
const state = require('./src/state');
const Store = require('./src/store');
const { registerAll, ensureLocalServerStarted } = require('./src/ipc-handlers');
const { LANG_NAMES, LANG_LABELS } = require('./src/translation');
const { runUiaService, stopHelper: stopUiaHelper } = require('./src/uia-captions');
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
    minWidth: 520,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // App là overlay meeting (thường bị minimize/che sau Teams). Mặc định Electron throttle
      // timer renderer xuống ~1/s khi bị che → thu audio PCM (Web Audio) + cập nhật caption bị giật.
      backgroundThrottling: false,
    },
    title: 'Caption Translator',
    frame: false,   // frameless → header app tự đóng vai title bar (kéo di chuyển + nút min/close tự vẽ)
    backgroundColor: (state.theme === 'dark' || (state.theme !== 'light' && nativeTheme.shouldUseDarkColors)) ? '#131314' : '#f6f8fc',
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
  win.on('maximize',   () => { try { win.webContents.send('window-max-state', { max: true }); } catch {} });
  win.on('unmaximize', () => { try { win.webContents.send('window-max-state', { max: false }); } catch {} });
}

// â”€â”€ Service loop â€” tá»± restart khi máº¥t káº¿t ná»‘i â”€â”€
async function startService() {
  while (true) {
    state.captureSourceChanged = false;
    // Mỗi lần (re)connect/restart (boot, mất kết nối, meeting kết thúc, đổi nguồn) → về IDLE, chờ user bấm ▶.
    // Tránh auto-play: KHÔNG tự dịch lại meeting/nguồn mới chỉ vì lần trước đã từng bấm play.
    state.userActive = false;
    try {
      if (state.captureSource === 'teams') {
        await runUiaService();   // Teams: đọc Live Captions qua UI Automation (không CDP)
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
  // Migrate: mọi provider dịch online cũ (cloud LLM + MS/Google/DeepL riêng lẻ) → gộp về 'online'
  // (1 nhánh cascade Google→MS trong translation.js). Chỉ còn 2 lựa chọn: 'online' | 'local'.
  // Giữ 'deepl' trong danh sách để store cũ còn chọn DeepL vẫn migrate đúng về 'online'.
  const savedProvider = Store.get('provider', 'online');
  const _legacyOnline = ['groq', 'gemini', 'openai', 'teams-token', 'google-free', 'deepl'];
  if (_legacyOnline.includes(savedProvider)) {
    console.log('[migrate] provider', savedProvider, '→ online (gộp MS/Google thành 1 nhánh cascade)');
    Store.set('provider', 'online');
    state.provider = 'online';
  } else {
    state.provider = savedProvider;
  }
  state.apiKey        = Store.get('apiKey',        '');
  state.theme         = Store.get('theme',         'auto');
  state.uiLang        = Store.get('uiLang',        'vi');
  // Khôi phục ngôn ngữ ĐÍCH đã lưu (backend đúng ngay từ boot, trước khi renderer gửi set-lang)
  const _savedLang = Store.get('lang', 'vi');
  state.langCode        = _savedLang;
  state.targetLang      = LANG_NAMES[_savedLang]  || state.targetLang;
  state.targetLangLabel = LANG_LABELS[_savedLang] || state.targetLangLabel;
  Menu.setApplicationMenu(null);   // bỏ menu bar "File Edit View Window Help"
  state.captureSource = Store.get('captureSource', 'teams');
  state.overlayEnabled = Store.get('overlayEnabled', true);
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

  // Đồng bộ tên model với file THẬT có sẵn (bundle Q4_K_M hoặc đã tải) — tên file có thể khác mặc định.
  try {
    const localLlm = require('./src/local-llm');
    const st = localLlm.serverStatus();
    if (st.modelFuzzy && st.modelFuzzy !== state.localModel) {
      console.log('[boot] model file thực:', st.modelFuzzy, '→ cập nhật localModel');
      state.localModel = st.modelFuzzy; Store.set('localModel', st.modelFuzzy);
    } else if (!st.modelReady && st.available.length) {
      const m = st.available.find(x => /milmmt/i.test(x.name)) || st.available[0];
      console.log('[boot] dùng model có sẵn:', m.name);
      state.localModel = m.name; Store.set('localModel', m.name);
    }
  } catch (e) { console.warn('[boot] align model:', e.message); }

  registerAll(app);
  createWindow();
  startService();

  // provider=local → TỰ khởi động llama-server lúc mở app (nếu đã có binary+model), giữ chạy tới khi
  // đóng app. KHÔNG cần bấm play. Nếu chưa cài → im lặng; tải xong (download handler) sẽ tự start.
  // Delay 2s để renderer sẵn sàng nhận status. Tắt server: khi đổi provider khác local / đóng app.
  if (state.provider === 'local') {
    setTimeout(() => { try { ensureLocalServerStarted(); } catch (e) { console.warn('[boot] auto-start local:', e.message); } }, 2000);
  }

  // (BỎ auto-fetch model LC lúc boot) — trước đây tải nền cả 4 locale 8s sau boot, GIỮ khoá _dlProc nhiều phút
  // → bấm "Tải model" thủ công trả 'already-running' (tưởng treo). Nay STT sherpa-onnx bundle sẵn lo mọi ngôn ngữ,
  // nên model LC là TUỲ CHỌN: chỉ tải khi user bấm nút (menu Nguồn → Tải model). Không còn tiến trình nền cạnh tranh.

  // (KHÔNG prewarm ChatGPT nữa) — mỗi lần bấm Tóm tắt mới mở cửa sổ webchat, xong thì destroy. Giữ
  // session sống lâu khiến ChatGPT bắt đăng nhập ở lần hỏi thứ 2 nên không pre-warm/giữ cửa sổ nền.

  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopSTTServer();
  try { stopUiaHelper(); } catch {}
  try { require('./src/local-llm').stopServer(); } catch {}
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try { stopUiaHelper(); } catch {}
  try { require('./src/local-llm').stopServer(); } catch {}
});
