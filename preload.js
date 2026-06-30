const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__caption', {
  // main → renderer
  onStatus:        cb => ipcRenderer.on('status',         (_, d) => cb(d)),
  onBusy:          cb => ipcRenderer.on('busy',           (_, d) => cb(d)),
  onCaptionLive:   cb => ipcRenderer.on('caption-live',   (_, d) => cb(d)),
  onCcState:       cb => ipcRenderer.on('cc-state',       (_, d) => cb(d)),
  onSettingsSaved: cb => ipcRenderer.on('settings-saved', (_, d) => cb(d)),
  onStartAudioCapture: cb => ipcRenderer.on('start-audio-capture', (_, d) => cb(d)),
  onStopAudioCapture:  cb => ipcRenderer.on('stop-audio-capture',  ()    => cb()),
  onAudioLevel:        cb => ipcRenderer.on('audio-level',         (_, d) => cb(d)),
  onMaxState:     cb   => ipcRenderer.on('window-max-state', (_, d) => cb(d)),

  // Gemini Live: audio dịch 24kHz + clear + trạng thái
  onGeminiAudio:  cb => ipcRenderer.on('gemini-audio',  (_, d) => cb(d)),
  onGeminiClear:  cb => ipcRenderer.on('gemini-clear',  ()    => cb()),
  onGeminiStatus: cb => ipcRenderer.on('gemini-status', (_, d) => cb(d)),

  // renderer → main
  sendAudioPcm:   buf  => ipcRenderer.send('audio-pcm', buf),
  setLang:        lang => ipcRenderer.send('set-lang', lang),
  getSettings:    ()   => ipcRenderer.invoke('get-settings'),
  saveSettings:   s    => ipcRenderer.send('save-settings', s),
  validateGeminiKey: key => ipcRenderer.invoke('validate-gemini-key', key),
  listAudioProcesses: () => ipcRenderer.invoke('list-audio-processes'),
  toggleCaptions: (desired) => ipcRenderer.send('toggle-captions', desired),

  // window
  setAlwaysOnTop: v   => ipcRenderer.send('set-always-on-top', v),
  focusWindow:    ()  => ipcRenderer.send('focus-window'),
  windowMinimize: ()  => ipcRenderer.send('window-minimize'),
  windowMaximize: ()  => ipcRenderer.send('window-maximize'),
  windowClose:    ()  => ipcRenderer.send('window-close'),
  openExternal:   url => ipcRenderer.send('open-external', url),
  copyToClipboard: text => ipcRenderer.invoke('copy-to-clipboard', text),

  // summary (panel Gemini)
  summarizeGemini: (payload) => ipcRenderer.invoke('summarize-gemini', payload),
  summarizeMeeting: (captions) => ipcRenderer.invoke('summarize-meeting', captions),   // tổng thể → gemma-4-31b
  summarizeReport: (payload) => ipcRenderer.invoke('summarize-report', payload),   // tổng thể JSON landing-page → render HTML đẹp
  setSummaryPanel: (open)    => ipcRenderer.send('summary-panel', open),
  ensureWidth:     (px)      => ipcRenderer.send('ensure-width', px),
  exportSummary:   (data)    => ipcRenderer.invoke('export-summary', data),
});
