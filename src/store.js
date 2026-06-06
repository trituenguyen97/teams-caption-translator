/**
 * store.js — Đọc/ghi settings vào file JSON trong userData
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let _file = null;
function file() {
  if (!_file) _file = path.join(app.getPath('userData'), 'settings.json');
  return _file;
}

// Cache toàn bộ settings.json trong RAM, đọc+parse đĩa 1 lần (lazy). Trước đây mỗi Store.get/set
// đều readFileSync + JSON.parse lại cả file (~6 lần lúc boot, ~9 lần mỗi get-settings) trên main thread.
// Store.set là tiến trình DUY NHẤT ghi file này → cache luôn nhất quán; vẫn ghi đồng bộ để không mất dữ liệu.
let _data = null;
function _load() {
  if (_data) return _data;
  try { _data = JSON.parse(fs.readFileSync(file(), 'utf8')); }
  catch { _data = {}; }
  return _data;
}

const Store = {
  get(key, def) {
    const v = _load()[key];
    return v ?? def;
  },
  set(key, val) {
    const data = _load();
    data[key] = val;
    try { fs.writeFileSync(file(), JSON.stringify(data), 'utf8'); }   // write-through (giữ độ bền)
    catch (e) { console.warn('[store] write error:', e.message); }
  },
  all() { return { ..._load() }; },
};

module.exports = Store;
