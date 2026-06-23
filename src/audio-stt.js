/**
 * audio-stt.js — Router audio (system/mic) → Gemini 3.5 Live Translate.
 *
 * KHÔNG còn STT local (Nemotron/sherpa/VAD đã gỡ). Renderer/process-loopback gửi PCM Float32 @16k → handlePcm →
 * geminiLive.pushAudio (stream thẳng lên live-translate; model tự STT + dịch + TTS). Giữ TÊN các export cũ để
 * main.js/ipc-handlers/process-audio không vỡ (phần lớn thành no-op).
 */
const state = require('./state');
const geminiLive = require('./gemini-live');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (ch, data) => state.win && state.win.webContents && state.win.webContents.send(ch, data);

// Service loop cho chế độ audio. Boot IDLE (chờ user bấm ▶); thoát khi đổi nguồn để startService restart.
async function runAudioService() {
  state.audioPaused = true;
  const label = state.captureSource === 'mic' ? 'Microphone' : 'System Audio';
  send('status', { type: 'idle', key: 'status.audioReady', vars: { label } });
  send('cc-state', { active: false });
  while (!state.captureSourceChanged) { await sleep(300); }
  send('stop-audio-capture', {});
  send('cc-state', { active: false });
}

// Nhận PCM Float32 @16k → đẩy thẳng lên Gemini live-translate (model lo STT+dịch+TTS).
async function handlePcm(samples) {
  if (state.audioPaused || !samples || !samples.length) return;
  try { await geminiLive.pushAudio(samples); } catch (e) {}
}

// Giữ tên export cũ (không còn model local → no-op).
function warmModel() { return Promise.resolve(true); }
function resetSegmentation() {}
function flushStreaming() {}
function unloadStt() {}
function stopSTTServer() {}

module.exports = { runAudioService, handlePcm, stopSTTServer, resetSegmentation, flushStreaming, warmModel, unloadStt };
