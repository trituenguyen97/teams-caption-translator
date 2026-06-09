/**
 * win-livecaptions.js — Dùng Windows Live Captions làm nguồn STT cho source = system/mic
 * với các ngôn ngữ LC hỗ trợ (en/ja/ko/zh). Tiếng Việt KHÔNG nằm đây (LC không có vi → PhoWhisper fallback).
 *
 * Hiện cung cấp:
 *   - isAvailable(): Windows 11 (build ≥ 22000) + LiveCaptions.exe tồn tại.
 *   - checkInstalled(): locale model LC nào đã cài ({installed, missing}).
 *   - downloadModels({locales,onProgress}): chạy scripts/lc-download-models.ps1 (ẩn) → tải model + bắn % tổng.
 *   - cancelDownload().
 * (Phần captioning runtime: launch→set lang→ẩn→scrape — sẽ bổ sung ở bước C.)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const state = require('./state');
const { enqueueTranslate, preprocessText, hasUntranslatedCJK } = require('./translation');
const send = (ch, data) => state.win?.webContents?.send(ch, data);
const ts = () => new Date().toLocaleTimeString('vi-VN', { hour12: false });

// App source code → LC locale. vi KHÔNG có trong Live Captions.
const LC_LANGS = { en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', 'zh-CN': 'zh-CN' };
const ALL_LOCALES = Object.values(LC_LANGS);   // ['en-US','ja-JP','ko-KR','zh-CN']

const DL_HELPER  = path.join(__dirname, '..', 'scripts', 'lc-download-models.ps1');
const CAP_HELPER = path.join(__dirname, '..', 'scripts', 'livecaptions-helper.ps1');

// #1 — LC khả dụng: Windows 11 (build ≥ 22000) + có LiveCaptions.exe.
function isAvailable() {
  try {
    const exe = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'LiveCaptions.exe');
    if (!fs.existsSync(exe)) return false;
    const build = parseInt((os.release().split('.')[2] || '0'), 10);   // '10.0.26100' → 26100
    return build >= 22000;
  } catch { return false; }
}

// Locale của app source langs (mặc định 4). Map từ source code app sang LC locale, bỏ cái không hỗ trợ.
function localesFor(codes) {
  if (!codes || !codes.length) return ALL_LOCALES.slice();
  return codes.map(c => LC_LANGS[c]).filter(Boolean);
}

// Trả về {installed:[locale], missing:[locale]} — kiểm tra package MicrosoftWindows.Speech.<locale>.
function checkInstalled(locales) {
  const want = locales && locales.length ? locales : ALL_LOCALES;
  return new Promise((resolve) => {
    const cmd = "$l=@('" + want.join("','") + "');($l|?{(Get-AppxPackage -Name \"MicrosoftWindows.Speech.$_*\" -EA SilentlyContinue|Measure-Object).Count -ge 1}) -join ','";
    let out = '';
    let p;
    try { p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true }); }
    catch { resolve({ installed: [], missing: want.slice() }); return; }
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', d => { out += d; });
    p.on('error', () => resolve({ installed: [], missing: want.slice() }));
    p.on('exit', () => {
      const installed = out.trim().split(',').map(s => s.trim()).filter(Boolean);
      const missing = want.filter(l => !installed.includes(l));
      resolve({ installed, missing });
    });
  });
}

let _dlProc = null;

// Tải model LC cho danh sách locale (mặc định 4 ngôn ngữ LC). onProgress(msg) nhận từng dòng NDJSON helper:
//   {t:'plan',...} {t:'progress',overall,done,total,lang,langPct,status} {t:'langdone',...} {t:'done',overall} {t:'err',m}
function downloadModels({ locales, onProgress } = {}) {
  return new Promise((resolve) => {
    if (_dlProc) { resolve({ ok: false, error: 'already-running' }); return; }
    let script;
    try { script = fs.readFileSync(DL_HELPER, 'utf8'); }
    catch (e) { resolve({ ok: false, error: 'helper-missing: ' + e.message }); return; }
    const tmp = path.join(os.tmpdir(), 'ct-lc-download.ps1');
    try { fs.writeFileSync(tmp, '﻿' + script, 'utf8'); }
    catch (e) { resolve({ ok: false, error: e.message }); return; }
    const want = (locales && locales.length) ? locales : ALL_LOCALES;
    const env = { ...process.env, LC_DL_LANGS: want.join(',') };
    let p;
    try {
      p = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', tmp],
        { env, windowsHide: true });
    } catch (e) { resolve({ ok: false, error: e.message }); return; }
    _dlProc = p;
    let buf = '', lastOverall = 0, errMsg = null;
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (typeof msg.overall === 'number') lastOverall = msg.overall;
        if (msg.t === 'err') errMsg = msg.m;
        try { onProgress && onProgress(msg); } catch {}
      }
    });
    p.stderr.on('data', d => { const s = String(d).trim(); if (s) console.warn('[lc-dl ps]', s.slice(0, 200)); });
    p.on('error', (e) => { _dlProc = null; resolve({ ok: false, error: e.message }); });
    p.on('exit', (code) => {
      _dlProc = null;
      resolve({ ok: lastOverall === 100, overall: lastOverall, code, error: errMsg });
    });
  });
}

function cancelDownload() {
  if (_dlProc) { try { _dlProc.kill(); } catch {} _dlProc = null; return true; }
  return false;
}

// ── Captioning runtime (phần C): chạy livecaptions-helper.ps1 ẩn, nhận text rolling, CHỐT CÂU khi ngừng
// nói (settle) → dịch → 'caption-live'. (Hiển thị câu chốt; dịch 1 lần như nhánh STT/UIA.) ────────────
let _capProc = null, _capBuf = '';
let _capText = '', _lastChange = 0, _capTimer = null, _capEntryId = 0;
let _liveId = null, _liveKey = '';   // entry câu ĐANG nói (stream realtime, chưa chốt)
const _emitted = new Map();          // normKey câu ĐÃ CHỐT → ts (chống lặp khi buffer scroll/LC sửa dấu)
const CAP_SETTLE_MS = 1500;          // im lặng ≥ → chốt nốt câu cuối dù chưa có dấu (hết lượt nói)
const CAP_MAX_FRAG = 220;            // câu dở quá dài (LC nói liền không ngắt) → ép chốt, chống run-on
const _normKey = s => (s || '').replace(/[\s。、，,.!?！？…]+/g, '').toLowerCase();
// Tách câu NGAY SAU dấu kết . ! ? 。 ！ ？ … (zero-width lookbehind) → đúng cả English (có space) lẫn CJK (không space).
const _splitSentences = t => (t || '').split(/(?<=[.!?。！？…])/).map(s => s.trim()).filter(Boolean);

// Chốt 1 câu (dịch) — id có thể là entry đang-stream (chuyển live→final) hoặc entry mới.
function _finalizeSentence(id, sRaw, now) {
  const cleaned = preprocessText(sRaw);
  send('caption-live', { id, author: 'STT', original: sRaw, translated: '…', ts: ts(), tsMs: now });
  enqueueTranslate(cleaned).then(tr => {
    if (!state.userActive) return;
    const ok = tr && tr !== cleaned && tr !== sRaw && !hasUntranslatedCJK(tr);
    send('caption-live', { id, author: 'STT', original: sRaw, translated: ok ? tr : null, ts: ts(), tsMs: now });
  }).catch(() => {});
}

// REALTIME: câu đang nói hiện stream (original cập nhật, chưa dịch); CHỐT khi gặp dấu chấm → dịch.
// LC nói liền mạch không ngừng → ngắt theo DẤU CÂU, không chờ "settle" (settle/maxlen chỉ là fallback cuối lượt).
function _capCommitTick() {
  if (!_capText) return;
  const sentences = _splitSentences(_capText);
  if (!sentences.length) return;
  const endsComplete = /[.!?。！？…]\s*$/.test(_capText);
  const now = Date.now();
  const settled = (now - _lastChange) >= CAP_SETTLE_MS;
  const lastFrag = (sentences[sentences.length - 1] || '');
  let completeCount = endsComplete ? sentences.length : sentences.length - 1;
  if (!endsComplete && (settled || lastFrag.length >= CAP_MAX_FRAG)) completeCount = sentences.length;

  // 1) CHỐT các câu hoàn chỉnh chưa chốt.
  for (let i = 0; i < completeCount; i++) {
    const sRaw = sentences[i].trim();
    const key = _normKey(sRaw);
    if (key.length < 2 || _emitted.has(key)) continue;
    _emitted.set(key, now);
    let id;
    if (_liveId && _liveKey && (key === _liveKey || key.startsWith(_liveKey))) {
      id = _liveId; _liveId = null; _liveKey = '';   // câu đang stream đã xong → chốt CHÍNH entry đó
    } else {
      id = ++_capEntryId;
    }
    _finalizeSentence(id, sRaw, now);
  }

  // 2) Câu cuối CHƯA chốt = đang nói → hiện realtime (original stream, dịch để trống).
  if (completeCount < sentences.length) {
    const frag = sentences[sentences.length - 1].trim();
    const fkey = _normKey(frag);
    if (fkey && !_emitted.has(fkey)) {
      if (!_liveId) _liveId = ++_capEntryId;
      _liveKey = fkey;
      send('caption-live', { id: _liveId, author: 'STT', original: frag, translated: '', ts: ts(), tsMs: now });
    }
  } else { _liveId = null; _liveKey = ''; }

  if (_emitted.size > 80) { const cut = now - 120000; for (const [k, t0] of _emitted) { if (t0 < cut) _emitted.delete(k); } }
}

// Khởi động LC captioning cho 1 locale (en-US/ja-JP/ko-KR/zh-CN). onReady() gọi khi LC sẵn sàng.
function startCaptionsService(locale, onReady) {
  if (_capProc) return true;
  let script;
  try { script = fs.readFileSync(CAP_HELPER, 'utf8'); }
  catch (e) { console.error('[lc-cap] helper missing:', e.message); return false; }
  const tmp = path.join(os.tmpdir(), 'ct-lc-caption.ps1');
  try { fs.writeFileSync(tmp, '﻿' + script, 'utf8'); } catch (e) { console.error('[lc-cap] temp:', e.message); return false; }
  _capText = ''; _capBuf = ''; _capEntryId = 0; _emitted.clear(); _liveId = null; _liveKey = '';
  const env = { ...process.env, LC_LANG: locale, LC_POLLMS: '250' };
  try {
    _capProc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { env, windowsHide: true });
  } catch (e) { console.error('[lc-cap] spawn:', e.message); _capProc = null; return false; }
  _capProc.stdout.setEncoding('utf8');
  _capProc.stdout.on('data', (chunk) => {
    _capBuf += chunk; let i;
    while ((i = _capBuf.indexOf('\n')) >= 0) {
      const line = _capBuf.slice(0, i).trim(); _capBuf = _capBuf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.t === 'cap') { _capText = (m.text || '').trim(); _lastChange = Date.now(); }
      else if (m.t === 'ready') { console.log('[lc-cap] ready', m.lang); if (onReady) onReady(); }
      else if (m.t === 'need-download') { send('status', { type: 'error', msg: `Cần tải model Live Captions cho ${locale} (Settings → Tải model)` }); }
      else if (m.t === 'err') { console.warn('[lc-cap helper]', m.m); }
    }
  });
  _capProc.stderr.on('data', d => { const s = String(d).trim(); if (s) console.warn('[lc-cap ps]', s.slice(0, 200)); });
  _capProc.on('exit', (code) => { console.warn('[lc-cap] helper thoát, code=', code); _capProc = null; });
  _capTimer = setInterval(_capCommitTick, 400);
  return true;
}

function stopCaptions() {
  if (_capTimer) { clearInterval(_capTimer); _capTimer = null; }
  if (_capProc) { try { _capProc.kill(); } catch {} _capProc = null; }
  _capText = ''; _capBuf = ''; _liveId = null; _liveKey = '';
}

function isCaptioning() { return !!_capProc; }

module.exports = {
  isAvailable, checkInstalled, downloadModels, cancelDownload, localesFor, LC_LANGS, ALL_LOCALES,
  startCaptionsService, stopCaptions, isCaptioning,
};
