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

const Store = {
  get(key, def) {
    try { return JSON.parse(fs.readFileSync(file(), 'utf8'))[key] ?? def; } catch { return def; }
  },
  set(key, val) {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch {}
    data[key] = val;
    fs.writeFileSync(file(), JSON.stringify(data), 'utf8');
  },
};

module.exports = Store;
