/**
 * caption-overlay.js — Cửa sổ overlay trong suốt, click-through, always-on-top.
 * Vẽ bản dịch bám theo từng dòng caption của Teams (toạ độ lấy từ UIA — physical px).
 * Thay cho việc inject DOM của CDP (UIA không sửa được DOM Teams).
 */
const { BrowserWindow, screen } = require('electron');
const path = require('path');

let win = null;
let enabled = true;
let _lastShow = false;
let _lastRaise = 0;   // throttle moveTop (đừng nâng mỗi frame)

function ensureWin() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    fullscreenable: false,
    acceptFirstMouse: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'overlay-preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  try { win.setVisibleOnAllWorkspaces(true); } catch {}
  win.loadFile(path.join(__dirname, '..', 'overlay.html'));
  win.on('closed', () => { win = null; _lastShow = false; });
  return win;
}

// box + rows ở physical px (UIA). rows: [{x,y,w,h,original,translated}]
function update({ box, btn, bg, rows }) {
  if (!enabled || !box) { hide(); return; }
  // rows rỗng = xoá nội dung nhưng GIỮ cửa sổ (trong suốt) → ẩn/hiện khi bị che mượt, không nháy show/hide.
  const w = ensureWin();
  const disp = screen.getDisplayNearestPoint({ x: Math.round(box.x), y: Math.round(box.y) });
  const sf = disp.scaleFactor || 1;   // UIA physical px → Electron DIP
  const bounds = {
    x: Math.round(box.x / sf),
    y: Math.round(box.y / sf),
    width: Math.max(1, Math.round(box.w / sf)),
    height: Math.max(1, Math.round(box.h / sf)),
  };
  try { w.setBounds(bounds); } catch {}

  // Sắp theo y để tính khoảng cách xuống entry kế → KHÔNG đè lên tên người nói kế tiếp.
  const sorted = (rows || []).slice().sort((a, b) => a.y - b.y);
  const NAME_H = 20;                       // chừa chỗ cho tên người nói của entry kế (px vật lý)
  const panelRight = box.x + box.w - 6;    // mép phải vùng caption (full-width)
  const rel = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (!r.text) continue;
    const next = sorted[i + 1];
    const gap = next ? (next.y - r.y) : (r.h + 80);
    const maxH = Math.max(r.h, gap - NAME_H);   // cao tối đa = tới ngay trên tên người kế
    // Dòng nằm ngang hàng cụm nút (dismiss/settings/pop-out) → chừa cột nút bên phải (#3)
    const overlapsBtn = btn && (r.y < btn.bottom && (r.y + r.h) > btn.y);
    const rightEdge = overlapsBtn ? Math.min(panelRight, btn.x - 10) : panelRight;
    const fullW = Math.max(r.w, rightEdge - r.x);
    rel.push({
      key: r.key,
      text: r.text,
      x: Math.round((r.x - box.x) / sf),
      y: Math.round((r.y - box.y) / sf),
      w: Math.round(fullW / sf),
      minH: Math.max(12, Math.round(r.h / sf)),   // phủ hết dòng gốc (che chữ Nhật, khớp khoảng cách)
      maxH: Math.max(14, Math.round(maxH / sf)),
    });
  }

  const payload = { rows: rel, bg };
  const doSend = () => { try { w.webContents.send('overlay-rows', payload); } catch {} };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', doSend);
  else doSend();

  let justShown = false;
  if (!_lastShow) { try { w.showInactive(); } catch {} _lastShow = true; justShown = true; }
  // Popup "Captions" của Teams cũng always-on-top → tái khẳng định + nâng lên để không bị nó che.
  // Throttle ~700ms (hoặc ngay khi vừa hiện) để không nâng mỗi frame.
  const now = Date.now();
  if (justShown || now - _lastRaise > 700) {
    _lastRaise = now;
    try { w.setAlwaysOnTop(true, 'screen-saver'); w.moveTop(); } catch {}
  }
}

function hide() {
  if (win && !win.isDestroyed() && _lastShow) { try { win.hide(); } catch {} _lastShow = false; }
}

function destroy() {
  if (win && !win.isDestroyed()) { try { win.destroy(); } catch {} }
  win = null; _lastShow = false;
}

function setEnabled(v) { enabled = !!v; if (!enabled) hide(); }
function isEnabled() { return enabled; }

module.exports = { update, hide, destroy, setEnabled, isEnabled };
