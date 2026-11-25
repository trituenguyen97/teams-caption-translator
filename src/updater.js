/**
 * updater.js — Tự cập nhật (electron-updater, provider generic trên VPS: build.publish trong package.json).
 * Version x.y.z: z = fix bug, y = thay đổi vừa/nhỏ, x = thay đổi lớn (bump bằng `npm run release -- patch|minor|major`).
 *
 * Luồng: mở app → (5s sau) kiểm tra latest.yml → có bản mới → gửi 'update-status' {state:'available', version, notes}
 * → Cài đặt hiện thông báo + ghi chú thay đổi + nút "Cập nhật" → tải (tiến độ %) → cài & khởi động lại.
 * KHÔNG tự tải ngầm: người dùng bấm mới tải. Bản dev (chưa đóng gói) → bỏ qua.
 */
const { app, ipcMain } = require('electron');
const state = require('./state');

const CHECK_DELAY_MS = 5000;
const RECHECK_MS = 4 * 3600e3;   // app mở cả ngày → kiểm tra lại mỗi 4h
let _au = null, _last = { state: 'idle', current: app.getVersion() };

function _send(s) {
  _last = { current: app.getVersion(), ...s };
  try { state.win && state.win.webContents && state.win.webContents.send('update-status', _last); } catch {}
}
function _notes(info) {
  const n = info && info.releaseNotes;
  if (!n) return '';
  if (typeof n === 'string') return n.trim();
  if (Array.isArray(n)) return n.map(x => (x.version ? `## ${x.version}\n` : '') + (x.note || '')).join('\n\n').trim();
  return '';
}

async function check() {
  if (!_au) { _send({ state: 'dev' }); return _last; }
  try { await _au.checkForUpdates(); } catch (e) { _send({ state: 'error', error: (e && e.message) || String(e) }); }
  return _last;
}

function init() {
  ipcMain.handle('update-get', () => _last);
  ipcMain.handle('update-check', () => check());
  ipcMain.handle('update-install', async () => {
    if (!_au || !_last.version) return { ok: false };   // có bản mới (kể cả sau lỗi tải → cho bấm lại)
    if (_last.state === 'downloaded') { setImmediate(() => _au.quitAndInstall(false, true)); return { ok: true }; }
    try { await _au.downloadUpdate(); return { ok: true }; }   // 'update-downloaded' → tự cài & khởi động lại
    catch (e) { _send({ ..._pick(), state: 'error', error: (e && e.message) || String(e) }); return { ok: false }; }
  });

  if (!app.isPackaged) { _last = { state: 'dev', current: app.getVersion() }; return; }   // chạy `electron .` → không cập nhật
  try { _au = require('electron-updater').autoUpdater; }
  catch (e) { console.warn('[updater] không nạp được electron-updater:', e && e.message); return; }
  _au.autoDownload = false;
  _au.autoInstallOnAppQuit = false;
  _au.logger = { info: m => console.log('[updater]', m), warn: m => console.warn('[updater]', m), error: m => console.warn('[updater]', m), debug() {} };
  _au.on('checking-for-update', () => _send({ state: 'checking' }));
  _au.on('update-not-available', () => _send({ state: 'latest' }));
  _au.on('update-available', info => _send({ state: 'available', version: info.version, notes: _notes(info), date: info.releaseDate }));
  _au.on('download-progress', p => _send({ ..._pick(), state: 'downloading', percent: Math.round(p.percent || 0) }));
  _au.on('update-downloaded', info => {
    _send({ state: 'downloaded', version: info.version, notes: _notes(info) });
    setTimeout(() => _au.quitAndInstall(false, true), 800);   // isSilent=false (hiện tiến trình cài), forceRunAfter=true → mở lại app
  });
  _au.on('error', e => _send({ ..._pick(), state: 'error', error: (e && e.message) || String(e) }));
  setTimeout(check, CHECK_DELAY_MS);
  setInterval(() => { if (_last.state !== 'downloading' && _last.state !== 'downloaded') check(); }, RECHECK_MS);
}
function _pick() { return { version: _last.version, notes: _last.notes }; }   // giữ version/notes khi đổi trạng thái tải

module.exports = { init, check };
