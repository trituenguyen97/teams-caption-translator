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
let _onStatus = null;   // callback báo trạng thái lên UI (ipc-handlers gắn) — vd cảnh báo "thu được nhưng không có audio"
function setStatusHandler(fn) { _onStatus = fn; }
let _onLevel = null, _lvlLast = 0;   // callback đẩy mức âm (peak) lên UI → level meter cho đường per-app
function setLevelHandler(fn) { _onLevel = fn; }
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

// Đoạn PowerShell dò TIẾN TRÌNH GỐC: đi NGƯỢC cây cha (ParentProcessId) tới khi cha là tiến trình hệ thống
// (explorer/services/...) → gốc = app cha. KHÔNG dùng "PID nhỏ nhất" vì PID bị tái dùng (con có thể PID < cha).
const PS_ROOT_FN =
  "$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name; "
  + "$parent=@{}; $nameById=@{}; "
  + "foreach($p in $all){ $parent[[int]$p.ProcessId]=[int]$p.ParentProcessId; $nameById[[int]$p.ProcessId]=$p.Name }; "
  + "$stop='explorer.exe','services.exe','svchost.exe','wininit.exe','userinit.exe','winlogon.exe','runtimebroker.exe'; "
  + "function Get-Root($id){ $cur=[int]$id; for($i=0;$i -lt 12;$i++){ $par=$parent[$cur]; if(-not $par -or $par -eq 0){break}; $pn=$nameById[$par]; if(-not $pn -or ($stop -contains $pn.ToLower())){break}; $cur=$par }; return $cur }; ";

// Liệt kê APP: gom MỌI tiến trình theo TIẾN TRÌNH GỐC → app đa-tiến-trình (Chrome nhiều tab; Teams + WebView2)
// gộp về 1 entry, pid = GỐC để thu INCLUDE_TARGET_PROCESS_TREE phủ HẾT cửa sổ/tab/meeting con (không sót tiếng).
// Vì chỉ thu app đó (cây riêng), KHÔNG bắt TTS của app dịch (cây khác) → hết feedback. Bỏ chính app dịch.
// Trả: { name (ProcessName gốc), app (FileDescription), pid (gốc), title (1 tiêu đề mẫu), icon (PNG base64) }.
function listApps() {
  return new Promise((resolve) => {
    const self = process.pid;
    const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue; "
      + PS_ROOT_FN
      + "function Get-IconB64($id){ try { $p=Get-Process -Id $id -ErrorAction SilentlyContinue; if(-not $p -or -not $p.Path){return $null}; "
      + "$ico=[System.Drawing.Icon]::ExtractAssociatedIcon($p.Path); if(-not $ico){return $null}; "
      + "$bmp=$ico.ToBitmap(); $ms=New-Object System.IO.MemoryStream; $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); "
      + "$b=[Convert]::ToBase64String($ms.ToArray()); $ms.Dispose(); $bmp.Dispose(); $ico.Dispose(); return $b } catch { return $null } }; "
      + "$wins = Get-Process | Where-Object { $_.MainWindowTitle -and $_.Id -ne " + self + " -and $_.MainWindowTitle -ne 'Caption Translator' }; "
      + "$byRoot=@{}; "
      + "foreach($w in $wins){ $root=Get-Root $w.Id; if(-not $byRoot.ContainsKey($root)){ "
      + "$rp=Get-Process -Id $root -ErrorAction SilentlyContinue; $d=$null; if($rp){ try { $d=$rp.Description } catch {} }; if(-not $d){ try { $d=$w.Description } catch {} }; "
      + "$nm= if($rp){$rp.ProcessName}else{$w.ProcessName}; "
      + "$byRoot[$root]=[PSCustomObject]@{ name=$nm; app=$d; pid=$root; title=$w.MainWindowTitle; icon=(Get-IconB64 $root) } } }; "
      + "@($byRoot.Values) | ConvertTo-Json -Compress";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        if (err) { console.warn('[process-audio] listApps lỗi:', err.message); return resolve([]); }
        let arr = [];
        try { const j = JSON.parse(stdout || '[]'); arr = Array.isArray(j) ? j : [j]; } catch { return resolve([]); }
        const out = [];
        for (const p of arr) {
          if (!p || !p.name || !p.pid) continue;
          const name = String(p.name).trim(); if (!name) continue;
          const app = (p.app ? String(p.app).trim() : '') || name;   // FileDescription → fallback ProcessName
          const icon = p.icon ? ('data:image/png;base64,' + String(p.icon)) : '';
          out.push({ name, app, pid: String(p.pid), title: p.title ? String(p.title).trim() : '', icon });
        }
        out.sort((a, b) => a.app.localeCompare(b.app));
        resolve(out);
      });
  });
}

// PID GỐC hiện tại của app theo TÊN (đi ngược cây cha như listApps, KHÔNG trích icon → nhẹ). Mọi tiến trình của
// 1 app đều quy về cùng gốc nên lấy tiến trình đầu tiên cùng tên rồi Get-Root. Dùng lúc bấm ▶ (PID đổi mỗi lần mở).
function resolveRootPid(name) {
  return new Promise((resolve) => {
    const n = String(name || '').trim();
    if (!/^[A-Za-z0-9._ -]{1,64}$/.test(n)) return resolve('');
    const ps = PS_ROOT_FN
      + "$x=@(Get-Process -Name '" + n.replace(/'/g, "''") + "' -ErrorAction SilentlyContinue); "
      + "if($x.Count){ Get-Root $x[0].Id } else { '' }";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        if (err) { console.warn('[process-audio] resolveRootPid lỗi:', err.message); return resolve(''); }
        const pid = (stdout || '').trim();
        resolve(/^\d+$/.test(pid) ? pid : '');
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
let _frames = 0, _noAudioTimer = null;   // chẩn đoán: đếm frame audio THẬT đã nhận; cảnh báo nếu thu khởi động mà 0 frame
const IDLE_MS = 900;   // không có PCM (im lặng, gate drop) > 0.9s → chốt nốt câu đang dở (≈ ngưỡng no-grow 1s của Nemotron)
const NO_AUDIO_MS = 7000;   // thu chạy >7s mà CHƯA có mẫu nào → app render audio ở nơi khác (Teams: lỗi process-loopback Windows đã biết)

function _armIdle() {
  clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => { try { flushStreaming(); } catch {} }, IDLE_MS);
}

function start(pid) {
  if (_activePid) stop();
  _reset();
  _activePid = String(pid);
  _frames = 0;
  try {
    lib().startAudioCapture(_activePid, {
      onData: (buf) => {
        if (state.audioPaused || !_activePid) return;
        const f32 = _resample(buf);
        if (f32.length) {
          if (_frames === 0) { clearTimeout(_noAudioTimer); _noAudioTimer = null; }   // có audio THẬT → huỷ cảnh báo "không có audio"
          _frames++;
          if (_onLevel) { let pk = 0; for (let i = 0; i < f32.length; i++) { const a = f32[i] < 0 ? -f32[i] : f32[i]; if (a > pk) pk = a; } const now = Date.now(); if (now - _lvlLast >= 120) { _lvlLast = now; try { _onLevel(pk); } catch {} } }   // đẩy peak lên level meter (throttle ~120ms)
          handlePcm(f32); _armIdle();
        }
      },
    });
    console.log('[process-audio] bắt đầu thu PID', _activePid);
    clearTimeout(_noAudioTimer);
    _noAudioTimer = setTimeout(() => {   // thu đã khởi động nhưng KHÔNG mẫu nào → cảnh báo (Teams chặn thu theo tiến trình)
      if (_activePid && _frames === 0) { console.warn('[process-audio] PID', _activePid, '— thu chạy nhưng 0 mẫu audio sau', NO_AUDIO_MS, 'ms (app có thể render audio ngoài cây tiến trình, vd Microsoft Teams)'); if (_onStatus) { try { _onStatus({ type: 'warn', key: 'status.noAppAudio' }); } catch {} } }
    }, NO_AUDIO_MS);
    return true;
  } catch (e) { console.warn('[process-audio] start lỗi:', e.message); _activePid = null; return false; }
}

function stop() {
  clearTimeout(_idleTimer); _idleTimer = null;
  clearTimeout(_noAudioTimer); _noAudioTimer = null;
  if (_activePid) { try { lib().stopAudioCapture(_activePid); } catch {} ; console.log('[process-audio] dừng thu PID', _activePid); _activePid = null; }
  _reset();
}

function isActive() { return !!_activePid; }
function activePid() { return _activePid; }

module.exports = { isSupported, listApps, resolveRootPid, start, stop, isActive, activePid, setStatusHandler, setLevelHandler };
