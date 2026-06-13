/**
 * process-audio.js — Thu system audio THEO TIẾN TRÌNH (Windows Process Loopback) qua gói `application-loopback`.
 *
 * Gói spawn 2 exe prebuilt (ApplicationLoopback.exe / ProcessList.exe) — KHÔNG native addon, không cần ABI khớp
 * Electron. Thu INCLUDE_TARGET_PROCESS_TREE theo PID → CHỈ audio của tiến trình đó (vd trình duyệt/Teams) →
 * KHÔNG thu tiếng TTS của chính app ⇒ hết vòng lặp feedback. Output exe: 48000Hz / 2 kênh / 16-bit PCM (stdout).
 *
 * Khác nhánh "Toàn hệ thống" (renderer getDisplayMedia loopback): nhánh NÀY chạy ở MAIN, đẩy thẳng PCM 16k mono
 * vào handlePcm (cùng đường STT). Resample 48k/stereo/s16 → 16k/mono/f32 ở đây (box-3 decimate, chống alias cơ bản).
 *
 * ⚠️ Silence-gate: exe DROP frame im lặng (−70dB) → không có timeline liên tục. Endpoint Nemotron đếm theo
 * mẫu audio nên im lặng = không có mẫu = không tự chốt câu cuối → dùng IDLE TIMER (đồng hồ thực) gọi flushStreaming.
 */
const path = require('path');
const { execFile } = require('child_process');
const state = require('./state');
const { handlePcm, flushStreaming } = require('./audio-stt');

let _loop = null;
function lib() {
  if (_loop) return _loop;
  const l = require('application-loopback');
  // Khi đóng gói (asar): exe nằm ở app.asar.unpacked (đã khai báo asarUnpack) — trỏ root tới đó, nếu không spawn fail.
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      l.setExecutablesRoot(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'application-loopback', 'bin'));
    }
  } catch {}
  _loop = l;
  return _loop;
}

function isSupported() {
  try { require.resolve('application-loopback'); return process.platform === 'win32' && process.arch === 'x64'; }
  catch { return false; }
}

// Liệt kê tiến trình có cửa sổ (để làm picker nguồn) qua PowerShell Get-Process.
// KHÔNG dùng ProcessList.exe của gói: exe đó xuất tiêu đề theo codepage ANSI → tên tiếng Việt/CJK lỗi mã.
// PS ép [Console]::OutputEncoding UTF-8 → tên đúng. Chỉ dùng exe của gói cho phần THU. Bỏ chính app dịch.
function listProcesses() {
  return new Promise((resolve) => {
    const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        if (err) { console.warn('[process-audio] list lỗi:', err.message); return resolve([]); }
        let arr = [];
        try { const j = JSON.parse(stdout || '[]'); arr = Array.isArray(j) ? j : [j]; } catch { return resolve([]); }
        const self = process.pid;
        const out = [], seen = new Set();
        for (const p of arr) {
          if (!p || !p.Id || !p.MainWindowTitle) continue;
          if (p.Id === self) continue;
          const title = String(p.MainWindowTitle).trim();
          if (!title || title === 'Caption Translator') continue;   // bỏ chính app (tránh tự thu = feedback)
          if (seen.has(p.Id)) continue; seen.add(p.Id);
          out.push({ pid: String(p.Id), title, name: p.ProcessName ? String(p.ProcessName) : '' });
        }
        resolve(out);
      });
  });
}

// ── Resample 48k stereo s16 → 16k mono f32 ───────────────────────────────────────────────────────────
// box-3 decimate (trung bình 3 mẫu liên tiếp rồi lấy 1) = low-pass thô chống alias + chia 3 tần số. Đủ cho STT
// (năng lượng tiếng nói chủ yếu <4kHz). Giữ residual mẫu/byte qua các chunk để không lệch pha/mất mẫu.
const DECIM = 3;
let _byteResidual = Buffer.alloc(0);   // byte lẻ <1 frame stereo (4 byte)
let _monoResidual = new Float32Array(0); // mẫu mono 48k chưa đủ nhóm 3

function _reset() { _byteResidual = Buffer.alloc(0); _monoResidual = new Float32Array(0); }

function _resample(buf) {
  if (_byteResidual.length) buf = Buffer.concat([_byteResidual, buf]);
  const frames = Math.floor(buf.length / 4);          // 4 byte/frame (L,R int16)
  _byteResidual = buf.subarray(frames * 4);
  const mono = new Float32Array(_monoResidual.length + frames);
  mono.set(_monoResidual, 0);
  for (let i = 0; i < frames; i++) {
    const l = buf.readInt16LE(i * 4);
    const r = buf.readInt16LE(i * 4 + 2);
    mono[_monoResidual.length + i] = (l + r) / 65536;  // (l+r)/2/32768 → mono float [-1,1]
  }
  const outN = Math.floor(mono.length / DECIM);
  const out = new Float32Array(outN);
  for (let i = 0; i < outN; i++) { const j = i * DECIM; out[i] = (mono[j] + mono[j + 1] + mono[j + 2]) / 3; }
  _monoResidual = mono.slice(outN * DECIM);
  return out;
}

// ── Thu ──────────────────────────────────────────────────────────────────────────────────────────────
let _activePid = null;
let _idleTimer = null;
const IDLE_MS = 900;   // không có PCM (im lặng, gate drop) > 0.9s → chốt nốt câu đang dở (≈ ngưỡng no-grow 1s của Nemotron)

function _armIdle() {
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => { try { flushStreaming(); } catch {} }, IDLE_MS);
}

function start(pid) {
  if (_activePid) stop();
  _reset();
  _activePid = String(pid);
  try {
    lib().startAudioCapture(_activePid, {
      onData: (buf) => {
        if (state.audioPaused || !_activePid) return;
        const f32 = _resample(buf);
        if (f32.length) { handlePcm(f32); _armIdle(); }
      },
    });
    console.log('[process-audio] bắt đầu thu PID', _activePid);
    return true;
  } catch (e) { console.warn('[process-audio] start lỗi:', e.message); _activePid = null; return false; }
}

function stop() {
  clearTimeout(_idleTimer); _idleTimer = null;
  if (_activePid) { try { lib().stopAudioCapture(_activePid); } catch {} ; console.log('[process-audio] dừng thu PID', _activePid); _activePid = null; }
  _reset();
}

function isActive() { return !!_activePid; }
function activePid() { return _activePid; }

module.exports = { isSupported, listProcesses, start, stop, isActive, activePid };
