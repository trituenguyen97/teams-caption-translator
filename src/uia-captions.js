/**
 * uia-captions.js — Đọc Live Captions của Teams qua UI Automation (KHÔNG CDP), dịch, đẩy ra app + overlay.
 *
 * Thay thế caption-service.js (CDP/puppeteer). Spawn scripts/uia-captions-helper.ps1 (powershell, đọc UIA)
 * → nhận NDJSON snapshot rows → tái dùng đúng logic "chỉ dịch dòng đã CHỐT" của bản CDP.
 *   - Hiển thị trong cửa sổ app: IPC 'caption-live' (giữ nguyên như cũ).
 *   - Overlay nổi trên Teams: src/caption-overlay.js (bám toạ độ UIA), bật/tắt được.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const state = require('./state');
const { enqueueTranslate, preprocessText, PROV_NAMES, hasUntranslatedCJK } = require('./translation');
const overlay = require('./caption-overlay');

const HELPER_POLL_MS = 40;    // nhịp helper đọc UIA (thấp hết cỡ → overlay bám sát + scroll mượt)
const LOOP_MS = 150;          // nhịp vòng lặp dịch/commit (không cần nhanh như overlay)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = (ch, data) => state.win?.webContents?.send(ch, data);
function timestamp() { return new Date().toLocaleTimeString('vi-VN', { hour12: false }); }
// chuẩn hoá đuôi câu để làm key (dùng chung cho commit + overlay)
const toKey = (author, text) => `${author}::${text.replace(/[。、！？!?.,\s]+$/, '').trim()}`;

const HELPER_PATH = path.join(__dirname, '..', 'scripts', 'uia-captions-helper.ps1');

// ── Tiến trình helper (PowerShell + UIA) ──────────────────────
let _proc = null;
let _rows = [];           // [{spk,txt,x,y,w,h}] — snapshot mới nhất từ helper
let _box = null;          // {x,y,w,h} panel Live Captions
let _captionsOn = false;  // panel có mặt (caption đang bật + trong meeting)
let _visible = true;      // panel KHÔNG bị cửa sổ app khác che (cho overlay)
let _bg = null;           // màu nền caption theo theme Teams (#RRGGBB)
let _btn = null;          // vùng nút điều khiển panel {x,y,bottom} để overlay chừa chỗ
let _prevYByKey = new Map();  // theo dõi y từng dòng → phát hiện scroll
let _moveTicks = 0;           // số tick liên tiếp có nhiều dòng dịch chuyển mạnh
let _scrollUntil = 0;         // ẩn overlay tới mốc này (đang scroll)
let _scrollTimer = null;
let _transByKey = new Map();  // author::normText → bản dịch (cho overlay); reset mỗi phiên
let _pending = new Set();     // author::normText ĐÃ commit + đang chờ dịch (cho placeholder overlay)
let _lastMsgTs = 0;
let _buf = '';
let _spawnGuard = 0;

// Vẽ overlay NGAY từ snapshot mới nhất (gọi khi helper báo đổi vị trí HOẶC khi có bản dịch mới)
// → overlay bám sát caption gốc, không chờ vòng lặp dịch.
function renderOverlay() {
  if (!overlay.isEnabled() || !state.userActive || !_captionsOn || !_box) { overlay.hide(); return; }
  if (!_visible) { overlay.update({ box: _box, btn: _btn, bg: _bg, rows: [] }); return; }   // bị che → xoá nội dung, GIỮ cửa sổ
  if (Date.now() < _scrollUntil) { overlay.update({ box: _box, btn: _btn, bg: _bg, rows: [] }); return; }   // đang scroll → ẩn (khỏi loạn mắt)
  const orows = [];
  for (const r of _rows) {
    const orig = (r.txt || '').trim();
    if (!orig) continue;
    const key = toKey((r.spk || '').trim(), orig);
    const tr = _transByKey.get(key);
    // Chỉ hiện dòng ĐÃ dịch (đè bản dịch) HOẶC ĐANG chờ dịch (placeholder = text gốc, key ổn định → swap mượt).
    // Bỏ: lịch sử cũ baseline (không dịch) + dòng đang nói chưa commit → để Teams hiện gốc.
    if (!tr && !_pending.has(key)) continue;
    orows.push({ key: orig, text: tr || orig, x: r.x, y: r.y, w: r.w, h: r.h });
  }
  overlay.update({ box: _box, btn: _btn, bg: _bg, rows: orows });
}

// Chạy 1 script PowerShell: ghi ra FILE TẠM rồi spawn '-File' (đọc content asar-aware nên chạy cả khi đóng
// gói; KHÔNG vướng giới hạn command-line như -EncodedCommand; -Command - stdin KHÔNG đọc được từ Node).
function spawnPwshScript(tmpName, scriptContent, env, onStdout, onExit) {
  const tmp = path.join(os.tmpdir(), tmpName);
  try { fs.writeFileSync(tmp, scriptContent, 'utf8'); }
  catch (e) { console.error('[uia] ghi temp lỗi:', e.message); return null; }
  let p;
  try {
    p = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { env: env || process.env, windowsHide: true });
  } catch (e) { console.error('[uia] spawn lỗi:', e.message); return null; }
  if (onStdout) { p.stdout.setEncoding('utf8'); p.stdout.on('data', onStdout); }
  p.stderr.on('data', d => { const s = String(d).trim(); if (s) console.warn('[uia ps]', s.slice(0, 200)); });
  if (onExit) p.on('exit', onExit);
  return p;
}

function startHelper() {
  if (_proc) return true;
  let script;
  try { script = fs.readFileSync(HELPER_PATH, 'utf8'); }
  catch (e) { console.error('[uia] không đọc được helper:', e.message); return false; }
  _buf = '';
  _proc = spawnPwshScript('ct-uia-helper.ps1', script,
    { ...process.env, UIA_POLLMS: String(HELPER_POLL_MS) },
    onStdout,
    (code) => { console.warn('[uia] helper thoát, code=', code); _proc = null; _captionsOn = false; _rows = []; _box = null; });
  if (!_proc) return false;
  console.log('[uia] helper đã chạy');
  return true;
}

function onStdout(chunk) {
  _buf += chunk;
  let i;
  while ((i = _buf.indexOf('\n')) >= 0) {
    const line = _buf.slice(0, i).trim();
    _buf = _buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    _lastMsgTs = Date.now();
    if (msg.t === 'rows') {
      _rows = Array.isArray(msg.rows) ? msg.rows : [];
      if (msg.box) _box = msg.box;
      _visible = (msg.vis !== false);
      if (msg.bg) _bg = msg.bg;
      _btn = msg.btn || _btn;
      if (!_captionsOn) {
        console.log('[uia] captions ON');
        if (state._tempPin) {   // caption đã lên → bỏ pin tạm, trả về đúng setting pinned của user
          state._tempPin = false;
          try { state.win?.setAlwaysOnTop(!!state.pinned, state.pinned ? 'screen-saver' : 'normal'); } catch {}
        }
      }
      _captionsOn = true;
      // Phát hiện SCROLL: nhiều dòng dịch chuyển mạnh, KÉO DÀI ≥3 tick (phân biệt với dòng mới chỉ 1-2 tick).
      let bigMoves = 0; const curY = new Map();
      for (const r of _rows) { const k = (r.spk || '') + '|' + (r.txt || ''); curY.set(k, r.y); const pv = _prevYByKey.get(k); if (pv !== undefined && Math.abs(r.y - pv) > 20) bigMoves++; }
      _prevYByKey = curY;
      if (bigMoves >= 2) _moveTicks++; else _moveTicks = 0;
      if (_moveTicks >= 3) {
        _scrollUntil = Date.now() + 180;   // đang scroll → ẩn overlay (khỏi trượt-trễ loạn mắt)
        if (_scrollTimer) clearTimeout(_scrollTimer);
        _scrollTimer = setTimeout(() => { _scrollUntil = 0; renderOverlay(); }, 200);   // scroll dừng → hiện lại
      }
      renderOverlay();   // vẽ overlay ngay (bám sát caption gốc, không chờ vòng lặp dịch)
    } else if (msg.t === 'off') {
      if (_captionsOn) console.log('[uia] captions OFF (panel mất)');
      _captionsOn = false; _rows = [];
      overlay.hide();
    } else if (msg.t === 'err') {
      console.warn('[uia helper err]', msg.m);
    }
  }
}

function stopHelper() {
  if (_proc) { try { _proc.kill(); } catch {} _proc = null; }
  _rows = []; _box = null; _captionsOn = false; _buf = '';
}

// One-shot: bật Live Captions = focus cửa sổ meeting Teams → gửi Alt+Shift+C (cách cũ, KHÔNG trả focus).
// Chốt chặn: nếu panel 'Live Captions' đã có → exit (tránh toggle TẮT nhầm).
// (App dịch được pin tạm trong lúc này để không bị che — xem ipc-handlers toggle-captions.)
const ENABLE_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FG {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
"@
$AE=[System.Windows.Automation.AutomationElement]; $TS=[System.Windows.Automation.TreeScope]; $root=$AE::RootElement
$nameCap=New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty,'Live Captions')
$wins=@()
foreach($p in (Get-Process -Name ms-teams -EA SilentlyContinue|Select-Object -Expand Id)){ $c=New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty,[int]$p); try{ foreach($w in $root.FindAll($TS::Children,$c)){ $wins+=$w } }catch{} }
foreach($w in $wins){ try{ if($w.FindFirst($TS::Descendants,$nameCap)){ Write-Output 'already-on'; exit } }catch{} }
$meeting=$null
foreach($w in $wins){ $n='';try{$n=$w.Current.Name}catch{}; if($n -match 'Meeting|Call' -and $n -notmatch '^(Chat|Captions|Sharing)'){ $meeting=$w; break } }
if(-not $meeting){ foreach($w in $wins){ $n='';try{$n=$w.Current.Name}catch{}; if($n -notmatch '^(Chat|Captions|Sharing)' -and $n -match 'Microsoft Teams'){ $meeting=$w; break } } }
if(-not $meeting){ Write-Output 'no-meeting-window'; exit }
$h=[IntPtr]$meeting.Current.NativeWindowHandle
if($h -eq [IntPtr]::Zero){ Write-Output 'no-hwnd'; exit }
$fg=[FG]::GetForegroundWindow()
$t1=0;[void][FG]::GetWindowThreadProcessId($fg,[ref]$t1)
$t2=0;[void][FG]::GetWindowThreadProcessId($h,[ref]$t2)
[void][FG]::AttachThreadInput($t1,$t2,$true)
[void][FG]::ShowWindow($h,9)
[void][FG]::BringWindowToTop($h)
[void][FG]::SetForegroundWindow($h)
[void][FG]::AttachThreadInput($t1,$t2,$false)
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait('%+c')
Write-Output 'sent'
`;

let _enabling = false;
function enableCaptions() {
  if (_enabling) return;
  _enabling = true;
  setTimeout(() => { _enabling = false; }, 3000);   // chống bấm dồn
  let out = '';
  spawnPwshScript('ct-uia-enable.ps1', ENABLE_SCRIPT, process.env,
    (d) => { out += String(d); },
    () => console.log('[uia] enable-captions →', (out.trim() || '(no output)')));
}

function isCaptionsOn() { return _captionsOn; }
function isHelperAlive() { return !!_proc; }

// ── Service chính (mirror runService của caption-service, nguồn rows = UIA) ──
async function runUiaService() {
  send('status', { type: 'connecting', key: 'status.connectingUIA' });
  if (!startHelper()) {
    send('status', { type: 'error', key: 'status.uiaFailed' });
    return;
  }
  overlay.setEnabled(state.overlayEnabled !== false);

  // committed: key = author::normText → {id, ts}; reuse id khi câu lớn dần.
  const committed = new Map();
  _transByKey = new Map();   // reset bản dịch overlay cho phiên mới
  _pending = new Set();
  let entryId = 0, isInit = true;
  let _lastRowKey = '', _lastRowSince = 0;
  const LAST_ROW_SETTLE_MS = 10000;
  const SENTENCE_END_RE = /[。．.！!？?]\s*$/;

  let idleSent = false, runningSent = false, waitCapSent = false;

  while (true) {
    if (state.captureSourceChanged) break;
    if (!state.win) break;   // app đóng

    // helper chết bất ngờ → respawn (chặn spam)
    if (!_proc) {
      if (Date.now() - _spawnGuard > 2000) { _spawnGuard = Date.now(); startHelper(); }
      await sleep(500); continue;
    }

    // ⏹ / chưa bấm ▶ → idle, chờ
    if (!state.userActive) {
      if (!idleSent) {
        send('status', { type: 'idle', key: 'status.idle' });
        send('cc-state', { active: false });
        overlay.hide();
        idleSent = true; runningSent = false; waitCapSent = false;
      }
      isInit = true;   // re-baseline: không dịch lại loạt câu cũ đang hiển
      await sleep(300); continue;
    }
    idleSent = false;

    // caption Teams chưa bật / chưa vào meeting → chờ (user tự bật Live Captions)
    if (!_captionsOn) {
      if (!waitCapSent) {
        send('status', { type: 'waiting-captions', key: 'status.enableCaptions' });
        send('cc-state', { active: false });
        overlay.hide();
        waitCapSent = true; runningSent = false;
      }
      await sleep(700); continue;
    }
    waitCapSent = false;
    if (!runningSent) {
      const provLabel = PROV_NAMES[state.provider] || state.provider;
      send('status', { type: 'running', key: 'status.translating', vars: { lang: state.langCode, prov: provLabel } });
      send('cc-state', { active: true });
      runningSent = true;
    }

    // snapshot rows hiện tại từ UIA
    const rows = _rows
      .map(r => ({ author: (r.spk || '').trim(), text: (r.txt || '').trim(), rect: { x: r.x, y: r.y, w: r.w, h: r.h } }))
      .filter(r => r.text);

    if (isInit) {
      rows.forEach(r => committed.set(toKey(r.author, r.text), { id: 0, ts: Date.now() }));
      isInit = false; await sleep(LOOP_MS); continue;
    }

    // ── chỉ dịch dòng ĐÃ CHỐT: dòng cuối (đang nói) bỏ qua trừ khi đứng yên ≥10s hoặc kết câu 。！？ ──
    const lastRow = rows[rows.length - 1];
    const lastRowKey = lastRow ? toKey(lastRow.author, lastRow.text) : '';
    if (lastRowKey !== _lastRowKey) { _lastRowKey = lastRowKey; _lastRowSince = Date.now(); }
    const lastRowSettled = !!lastRowKey && (
      (Date.now() - _lastRowSince >= LAST_ROW_SETTLE_MS) ||
      SENTENCE_END_RE.test(lastRow.text));

    const completedRows = lastRowSettled ? rows.slice() : rows.slice(0, -1);
    // bỏ dòng là tiền tố của dòng dài hơn cùng author (câu đang lớn dần)
    const rowsToCommit = completedRows.filter(({ author, text }) => {
      if (!text) return false;
      const normThis = toKey(author, text).slice(author.length + 2);
      if (!normThis) return false;
      return !completedRows.some(other =>
        other.author === author && other.text !== text &&
        toKey(other.author, other.text).slice(other.author.length + 2).startsWith(normThis) &&
        toKey(other.author, other.text).slice(other.author.length + 2).length > normThis.length);
    });

    for (const { author, text } of rowsToCommit) {
      const k = toKey(author, text);
      if (committed.has(k) || !text) continue;
      const normText = k.slice(author.length + 2);
      let reuseId = null;
      if (normText.length >= 3) {
        for (const [ck, cv] of committed) {
          if (cv.id === 0) continue;
          if (!ck.startsWith(author + '::')) continue;
          const cNorm = ck.slice(author.length + 2);
          if (cNorm.length >= 3 && normText.startsWith(cNorm) && normText.length > cNorm.length) {
            reuseId = cv.id; committed.delete(ck); _transByKey.delete(ck); _pending.delete(ck); break;
          }
        }
      }
      const id = reuseId !== null ? reuseId : ++entryId;
      committed.set(k, { id, ts: Date.now() });
      const ts = timestamp();
      const tsMs = Date.now();
      const cleaned = preprocessText(text);
      const author2 = author || 'Speaker';
      send('caption-live', { id, author: author2, original: text, translated: '…', ts, tsMs });
      _pending.add(k); renderOverlay();   // hiện placeholder (text gốc) NGAY → chờ dịch không bị "pop"
      enqueueTranslate(cleaned).then(translated => {
        _pending.delete(k);
        if (!state.userActive) return;
        const stillSource = hasUntranslatedCJK(translated);
        const isTranslated = translated !== cleaned && translated !== text && !stillSource;
        send('caption-live', { id, author: author2, original: text, translated: isTranslated ? translated : null, ts: timestamp(), tsMs });
        if (isTranslated) _transByKey.set(k, translated);
        renderOverlay();   // swap placeholder→bản dịch (hoặc bỏ nếu dịch fail) — không nháy layout
      });
    }

    // dọn committed cũ không còn hiển
    const currentKeys = new Set(rows.map(r => toKey(r.author, r.text)));
    const now = Date.now();
    for (const [k, cv] of committed) {
      if (currentKeys.has(k)) cv.ts = now;
      else if (now - cv.ts > 3000) { committed.delete(k); _transByKey.delete(k); _pending.delete(k); }
    }

    await sleep(LOOP_MS);
  }

  stopHelper();
  overlay.destroy();
}

module.exports = { runUiaService, isCaptionsOn, isHelperAlive, timestamp, stopHelper, enableCaptions };
