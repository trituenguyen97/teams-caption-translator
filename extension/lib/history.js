// history.js (browser ESM) — lưu lịch sử phiên transcribe vào IndexedDB (bền vững trong máy, không cần quyền đặc biệt).
// Mỗi phiên: { id, startedAt, endedAt, langCode, transcribe, count, caps:[{o,t,ts}], summaryMd, fullMd }
const DB = 'captrans-history', STORE = 'sessions', VER = 1;

function _open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function hSave(s) {
  const db = await _open();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(s); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function hList() {   // trả MẢNG metadata (không kèm caps nặng) sắp xếp mới→cũ
  const db = await _open();
  return new Promise((res, rej) => {
    const out = []; const tx = db.transaction(STORE, 'readonly');
    const cur = tx.objectStore(STORE).openCursor();
    cur.onsuccess = (e) => { const c = e.target.result; if (c) { const v = c.value; out.push({ id: v.id, startedAt: v.startedAt, endedAt: v.endedAt, langCode: v.langCode, transcribe: v.transcribe, count: v.count, hasSummary: !!(v.summaryMd || v.fullMd) }); c.continue(); } else res(out.sort((a, b) => b.startedAt - a.startedAt)); };
    cur.onerror = () => rej(cur.error);
  });
}
async function hGet(id) {
  const db = await _open();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const rq = tx.objectStore(STORE).get(id); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
}
async function hDel(id) {
  const db = await _open();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function hAll() {   // TOÀN BỘ phiên (kèm caps) để export backup
  const db = await _open();
  return new Promise((res, rej) => { const rq = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); rq.onsuccess = () => res((rq.result || []).sort((a, b) => b.startedAt - a.startedAt)); rq.onerror = () => rej(rq.error); });
}
async function hImport(sessions) {   // nhập (merge): ghi theo id (trùng id thì đè); trả số phiên hợp lệ đã nhập
  const arr = Array.isArray(sessions) ? sessions.filter(s => s && s.id != null && Array.isArray(s.caps)) : [];
  if (!arr.length) return 0;
  const db = await _open();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); const os = tx.objectStore(STORE); for (const s of arr) os.put(s); tx.oncomplete = () => res(arr.length); tx.onerror = () => rej(tx.error); });
}
export { hSave, hList, hGet, hDel, hAll, hImport };
