/**
 * audio-stt.js — STT server management + audio service
 */
const path = require('path');
const http = require('http');
const state = require('./state');
const { enqueueTranslate, preprocessText } = require('./translation');
const { timestamp } = require('./caption-service');

const STT_PORT = 8765;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (ch, data) => state.win?.webContents?.send(ch, data);

function startSTTServer() {
  if (state.sttProcess) return Promise.resolve();
  const { spawn } = require('child_process');
  const script = path.join(__dirname, '..', 'stt-server.py');
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'python' : 'python3';
    state.sttProcess = spawn(cmd, [script, String(STT_PORT)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    state.sttProcess.stdout.on('data', d => {
      const s = Buffer.from(d).toString('utf8').trim();
      console.log('[STT]', s);
      if (s.includes('sẵn sàng') || s.includes('ready') || s.includes('Server')) resolve();
    });
    state.sttProcess.stderr.on('data', d => console.warn('[STT err]', Buffer.from(d).toString('utf8').trim()));
    state.sttProcess.on('exit', (code) => {
      console.log('[STT] process thoát, code:', code);
      state.sttProcess = null;
    });
    setTimeout(resolve, 45000);
  });
}

function stopSTTServer() {
  if (state.sttProcess) { state.sttProcess.kill(); state.sttProcess = null; }
}

async function callLocalSTT(audioBuffer, mimeType) {
  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1', port: STT_PORT, path: '/', method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': audioBuffer.length, 'X-Audio-Ext': ext },
    }, (res) => {
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(data.trim()));
    });
    req.on('error', () => resolve(''));
    req.setTimeout(60000, () => { req.destroy(); resolve(''); });
    req.write(audioBuffer); req.end();
  });
}

async function runAudioService() {
  state.audioPaused = false;
  const label = state.captureSource === 'mic' ? 'Microphone' : 'System Audio';
  send('status', { type: 'waiting', msg: `🎙 Đang khởi động (${label})...` });
  await startSTTServer();
  send('start-audio-capture', { source: state.captureSource });
  send('status', { type: 'running', msg: `🎙 Đang ghi âm (${label}) — SenseVoice-Small` });
  send('cc-state', { active: true });

  while (!state.captureSourceChanged) { await sleep(300); }

  send('stop-audio-capture', {});
  send('cc-state', { active: false });
}

// Dedup map cho STT
const _sttRecentTexts = new Map();
const STT_DEDUP_MS = 8000;

async function handleAudioChunk(buffer, mimeType) {
  if (state.captureSource === 'teams' || state.audioPaused) return;
  if (!buffer || !buffer.byteLength) return;
  const audioBuf = Buffer.from(buffer);
  const text = await callLocalSTT(audioBuf, mimeType || 'audio/webm');
  if (!text || !text.trim()) return;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const now = Date.now();
  for (const line of lines) {
    const normLine = line.toLowerCase().replace(/\s+/g, ' ').trim();
    if (_sttRecentTexts.has(normLine) && now - _sttRecentTexts.get(normLine) < STT_DEDUP_MS) continue;
    _sttRecentTexts.set(normLine, now);
    for (const [k, ts_] of _sttRecentTexts) {
      if (now - ts_ > STT_DEDUP_MS * 2) _sttRecentTexts.delete(k);
    }

    const id = ++state.audioEntryId;
    const ts = timestamp();
    const tsMs = Date.now();
    const cleaned = preprocessText(line);
    send('caption-live', { id, author: 'STT', original: line, translated: '…', ts, tsMs });
    enqueueTranslate(cleaned).then(translated => {
      const isTranslated = translated !== line && translated !== cleaned;
      send('caption-live', { id, author: 'STT', original: line, translated: isTranslated ? translated : null, ts: timestamp(), tsMs });
    });
  }
}

module.exports = { startSTTServer, stopSTTServer, callLocalSTT, runAudioService, handleAudioChunk };
