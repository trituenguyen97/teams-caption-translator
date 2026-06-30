// gemini-live.js (browser ESM) — port của src/gemini-live.js cho extension.
// Audio-to-audio Gemini 3.5 Live Translate: PCM16 16kHz vào → STT + dịch + TTS ra.
// Khác bản Electron: bỏ IPC, thay bằng callbacks; bỏ Node Buffer, dùng base64 helper trình duyệt.
import { GoogleGenAI, Modality } from './genai.mjs';
import { bcp47 } from './langs.js';

const MODEL = 'gemini-3.5-live-translate-preview';
const RECONNECT_MS = 1500;
const LONG_IDLE_MS = 2500;     // nghỉ ~2.5s không có turnComplete → quét lại để chốt nốt các cặp đã đủ dấu chấm (KHÔNG ép ngắt câu đang dở)
const PUMP_DEBOUNCE_MS = 350;  // GỘP NHỊP VẼ: thay vì re-render mỗi delta (UI "nhảy" liên tục), gom lại vẽ ~mỗi 350ms → chữ đứng yên rồi cập nhật
const INPUT_GRACE_MS = 700;    // sau turnComplete chờ ~0.7s cho transcript về nốt rồi mới chốt hẳn câu cuối
const TR_SENT_END = /[.!?。．！？]\s*$/;   // chuỗi KẾT THÚC bằng dấu kết câu → câu đã trọn (khớp _splitVI)
// Phát TTS THEO CÂU: gom audio tới khi BẢN DỊCH gặp dấu KẾT CÂU ( . ! ? ) — hoặc audio nghỉ — rồi phát cả câu → "đủ câu mới đọc".
const AUDIO_MAX_SAMPLES = (24000 * 3) | 0;     // trần an toàn 3s: không gặp dấu kết câu/nghỉ vẫn phát (chống kẹt)
const AUDIO_IDLE_MS = 250;                     // audio ngừng ~0.25s (model nghỉ cuối câu) → phát nốt
const AUDIO_BREAK_GRACE_MS = 160;              // gặp dấu kết câu → chờ chút cho đuôi audio của câu tới rồi phát
const TR_BREAK = /[.!?。．！？]/;                // KẾT CÂU (khớp _splitVI); KHÔNG gồm phẩy → đọc trọn câu. Ngoại lệ . kẹp số (thập phân) xử lý trong _audioBreakOnText

function _b64ToBytes(b64) {
  const bin = atob(b64); const n = bin.length; const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function _bytesToB64(bytes) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function _f32ToPcm16B64(f32) {
  const buf = new ArrayBuffer(f32.length * 2); const dv = new DataView(buf);
  for (let i = 0; i < f32.length; i++) { let s = f32[i]; if (s > 1) s = 1; else if (s < -1) s = -1; dv.setInt16(i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7FFF), true); }
  return _bytesToB64(new Uint8Array(buf));
}
function _ts() { const d = new Date(), p = n => (n < 10 ? '0' : '') + n; return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

// opts = { getState(): {apiKey, langCode, transcribeMode, geminiAudioOn}, onCaption, onAudio, onClear, onStatus }
export function createLiveTranslator(opts) {
  const st = () => opts.getState();
  const onCaption = opts.onCaption || (() => {});
  const onAudio = opts.onAudio || (() => {});
  const onClear = opts.onClear || (() => {});
  const onStatus = opts.onStatus || (() => {});

  let _started = false, _session = null, _connecting = null, _gen = 0;
  let _handle = null;
  let _reconnectTimer = null, _emitTimer = null, _flushTimer = null, _pumpTimer = null;
  let _lineBase = 1, _inAcc = '', _outAcc = '', _turnEnded = false;   // _lineBase=id hàng đầu của LƯỢT hiện tại
  const _rowTs = {};   // id hàng → mốc thời gian (đặt 1 lần → "dòng thời gian" cố định)
  let _inT = [], _outT = [];   // [k]/[j] = mốc thời gian (ms) câu GỐC/DỊCH thứ k/j HOÀN THÀNH → neo căn theo TRỤC THỜI GIAN (T1C lag-adaptive)
  const _emit = {};    // id → khoá nội dung đã gửi (chỉ vẽ lại hàng nào ĐỔI)
  let _maxId = 0;      // id cao nhất đang hiện trong LƯỢT (để xoá hàng thừa khi DP gộp lại còn ít hàng hơn)
  let _audioBuf = [], _audioSamples = 0, _audioIdleTimer = null, _audioBreakTimer = null;
  let _noTransTurn = false;   // lượt này KHÔNG có bản dịch (nói trùng ngôn ngữ đích) → echo lời gốc làm bản dịch; reset mỗi lượt

  const isConfigured = () => !!(st().apiKey && String(st().apiKey).trim());

  // ── Tách câu kèm VỊ TRÍ kết thúc (end exclusive) — để neo char-anchor (S6) ──
  function _splitPos(s) {
    s = s || ''; const out = []; let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '.') {
        if (/\d/.test(s[i - 1] || '') && /\d/.test(s[i + 1] || '')) continue;   // số thập phân: 3.14 → không ngắt
        let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;             // dấu '.' chèn GIỮA câu do STT (phía sau là CHỮ THƯỜNG) → không ngắt
        if (j < s.length && /\p{Ll}/u.test(s[j])) continue;                     // đầu câu THẬT luôn viết hoa → chỉ ngắt khi sau dấu chấm là chữ hoa/hết chuỗi
      }
      if (c === '.' || c === '!' || c === '?' || c === '。' || c === '！' || c === '？' || c === '．') {
        const seg = s.slice(start, i + 1).trim(); if (seg) out.push({ text: seg, end: i + 1 }); start = i + 1;
      }
    }
    const tail = s.slice(start).trim(); if (tail) out.push({ text: tail, end: s.length });
    return out;
  }
  function _splitVI(s) { return _splitPos(s).map(x => x.text); }
  function _median(arr) { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  // CĂN nhiều-nhiều theo TRỤC THỜI GIAN (T1C): neo câu gốc k ↔ câu dịch j bằng |（t_in(k)+lag(k)) − t_out(j)|,
  // lag(k) = trung vị TRƯỢT của độ trễ cục bộ (t_out − t_in) quanh câu k (2 pass: seed→DP→rebuild lag→DP). + phạt độ dài phụ.
  // Trục thời gian trực giao char/length (dịch ĐỒNG THỜI: t_in≈t_out) → tách đúng filler ngắn vs câu dịch dài lệch pha. Cho phép 1:1/1:2/2:1/bỏ qua.
  const _WIN = 3, _LAM = 0.6, _TSCALE = 0.01, _GAP = 24;   // bộ hằng đã verify: EN byte-identical baseline, JA ja240 72→80 / ja ngắn 83→87
  function _alignTimeRows(inSent, outSent, inT, outT, R) {
    const nIn = inSent.length, nOut = outSent.length; if (!nIn || !nOut) return [];
    const it = k => inT[k] || 0, ot = j => outT[j] || 0;
    const slen = (i, n) => { let s = 0; for (let k = 0; k < n; k++) s += inSent[i + k].text.length; return s; };
    const tlen = (j, n) => { let s = 0; for (let k = 0; k < n; k++) s += outSent[j + k].text.length; return s; };
    const lpen = (i, ti, j, tj) => _LAM * Math.abs(R * slen(i, ti) - tlen(j, tj));
    const tcost = (k, j, lag) => _TSCALE * Math.abs((it(k) + lag[k]) - ot(j));
    const nearestSeed = () => { const p = []; for (let k = 0; k < nIn; k++) { let bj = 0, bd = Infinity; for (let j = 0; j < nOut; j++) { const d = Math.abs(ot(j) - it(k)); if (d < bd) { bd = d; bj = j; } } p.push({ dt: ot(bj) - it(k) }); } return p; };
    const buildLag = seed => { const lag = new Array(nIn).fill(0); for (let k = 0; k < nIn; k++) { const lo = Math.max(0, k - _WIN), hi = Math.min(nIn - 1, k + _WIN); const w = []; for (let q = lo; q <= hi; q++) w.push(seed[q].dt); lag[k] = _median(w); } return lag; };
    const runDP = lag => {
      const INF = Infinity;
      const dp = Array.from({ length: nIn + 1 }, () => new Array(nOut + 1).fill(INF));
      const bk = Array.from({ length: nIn + 1 }, () => new Array(nOut + 1).fill(null));
      dp[0][0] = 0;
      for (let i = 0; i <= nIn; i++) for (let j = 0; j <= nOut; j++) {
        if (dp[i][j] === INF) continue; const base = dp[i][j];
        if (i < nIn && j < nOut) { const c = base + tcost(i, j, lag) + lpen(i, 1, j, 1); if (c < dp[i + 1][j + 1]) { dp[i + 1][j + 1] = c; bk[i + 1][j + 1] = { pi: i, pj: j, ti: 1, tj: 1 }; } }
        if (i < nIn && j + 1 < nOut) { const c = base + tcost(i, j, lag) + lpen(i, 1, j, 2); if (c < dp[i + 1][j + 2]) { dp[i + 1][j + 2] = c; bk[i + 1][j + 2] = { pi: i, pj: j, ti: 1, tj: 2 }; } }
        if (i + 1 < nIn && j < nOut) { const c = base + tcost(i + 1, j, lag) + lpen(i, 2, j, 1); if (c < dp[i + 2][j + 1]) { dp[i + 2][j + 1] = c; bk[i + 2][j + 1] = { pi: i, pj: j, ti: 2, tj: 1 }; } }
        if (i < nIn) { const c = base + _GAP; if (c < dp[i + 1][j]) { dp[i + 1][j] = c; bk[i + 1][j] = { pi: i, pj: j, ti: 1, tj: 0 }; } }
        if (j < nOut) { const c = base + _GAP; if (c < dp[i][j + 1]) { dp[i][j + 1] = c; bk[i][j + 1] = { pi: i, pj: j, ti: 0, tj: 1 }; } }
      }
      const mv = []; let i = nIn, j = nOut; while (i > 0 || j > 0) { const m = bk[i][j]; if (!m) break; mv.push(m); i = m.pi; j = m.pj; } mv.reverse(); return mv;
    };
    const lagFromMoves = (moves, seed) => {
      const d = new Array(nIn).fill(null);
      for (const m of moves) { if (m.ti >= 1 && m.tj >= 1) { const kk = m.pi + m.ti - 1, jj = m.pj; d[kk] = ot(jj) - it(kk); } }
      const f = d.slice(); let last = _median(seed.map(p => p.dt)); for (let k = 0; k < nIn; k++) { if (f[k] === null) f[k] = last; else last = f[k]; }
      const out = new Array(nIn).fill(0); for (let k = 0; k < nIn; k++) { const lo = Math.max(0, k - _WIN), hi = Math.min(nIn - 1, k + _WIN); const w = []; for (let q = lo; q <= hi; q++) w.push(f[q]); out[k] = _median(w); } return out;
    };
    let seed = nearestSeed(); let lag = buildLag(seed); let moves = runDP(lag); lag = lagFromMoves(moves, seed); moves = runDP(lag);
    const rows = [];
    for (const m of moves) {
      const o = inSent.slice(m.pi, m.pi + m.ti).map(s => s.text).join(' ').trim();
      const t = outSent.slice(m.pj, m.pj + m.tj).map(s => s.text).join(' ').trim();
      if (m.ti === 0) { if (rows.length) rows[rows.length - 1].t = (rows[rows.length - 1].t + ' ' + t).trim(); else rows.push({ o: '', t }); }
      else rows.push({ o, t });
    }
    return rows;
  }
  // Gom transcript BỀN VỮNG: model 3.x có thể gửi BẢN ĐẦY ĐỦ tích luỹ (không phải delta thuần) → cứ "+=" sẽ LẶP.
  // next bao trùm prev (là prefix mở rộng / hoặc y hệt) ⇒ THAY; ngược lại coi là delta ⇒ NỐI. An toàn cho cả 2 kiểu.
  function _mergeTrans(prev, next) {
    if (!next) return prev;
    if (!prev || next.startsWith(prev)) return next;
    return prev + next;
  }
  // So sánh đã-chuẩn-hoá để dedupe khi lời gốc ≈ bản dịch (người nói đúng ngôn ngữ đích → khỏi hiện 2 dòng trùng).
  function _norm(s) { return (s || '').replace(/[\s。、，．！？!?.,]+/g, '').toLowerCase(); }
  // Đếm câu HOÀN CHỈNH (đã có dấu kết câu); câu cuối chưa có dấu chấm → CHƯA tính (không tự ngắt khi chưa có dấu chấm).
  function _doneCount(s) { s = (s || '').trim(); if (!s) return 0; const segs = _splitVI(s); return TR_SENT_END.test(s) ? segs.length : Math.max(0, segs.length - 1); }
  // Gửi 1 entry song ngữ (lines = [{o,t}]); dedupe khi gốc≈dịch (nói tiếng đích). ts cố định theo hàng (giữ "dòng thời gian").
  function _send(id, lines, turnDone, ts) {
    lines = lines.map(l => { let o = (l.o || '').trim(); const tt = (l.t || '').trim(); if (o && tt && _norm(o) === _norm(tt)) o = ''; return { o, t: tt }; }).filter(l => l.o || l.t);
    if (!lines.length) return false;
    const original = lines.map(l => l.o).filter(Boolean).join('\n');
    const translated = lines.map(l => l.t).filter(Boolean).join('\n');
    onCaption({ id, author: 'STT', lines, original, translated, isPartial: !turnDone, ts: ts || _ts(), tsMs: Date.now() });
    return true;
  }
  // Câu gốc filler/aizuchi (はい/ええ/うん/yes/ok…) hay bị model dịch TRÀN vế câu trước vào. Hậu xử lý:
  // nếu hàng filler có >1 câu dịch và CÓ câu dịch filler (Vâng/Ừ/Rồi…), giữ lại câu filler, ĐẨY câu nội dung về hàng TRƯỚC (chủ nó).
  // Filler/aizuchi GỐC: nhận diện theo NGHĨA (regex), KHÔNG theo độ dài → tránh nhầm câu nội dung ngắn ("10年").
  const _SRC_FILLER = /^((はい+|ええ+|うん+|うー?ん|そう(ですね|ですよね|か)?|です(ね|よね)|でしょう(ね)?|なるほど|オッケー|おっけー|あの+|えー?と|へえ+|ふ[んー]+|おお+|yes|yeah|ok(ay)?|right|mm+|uh+|um+)[。、,.!?！？\s]*)+$/iu;   // (...)+ : khớp cả aizuchi LẶP (はいはいはい / うんうんうん) để lọc back-channel
  function _isFillerSrc(o) { const s = (o || '').replace(/\s+/g, ''); return !!s && _SRC_FILLER.test(s); }
  const _VI_FILLER = /^((vâng|dạ|ừ|ờ|được|rồi|ok(ay)?|à|ạ|ờm|um+|đúng vậy|đúng rồi|đúng)[\s,.!?]*)+$/i;
  // Hàng gốc filler mà có câu dịch NỘI DUNG (không phải Vâng/Ừ) → đẩy nội dung về hàng TRƯỚC (chủ nó), giữ lại câu filler (có thể rỗng → ẩn).
  function _fillerPostproc(rows) {
    for (let i = 1; i < rows.length; i++) {
      if (!_isFillerSrc(rows[i].o)) continue;
      const ts = _splitVI(rows[i].t);
      const con = ts.filter(x => !_VI_FILLER.test(x.trim()));
      if (!con.length) continue;   // chỉ toàn filler (Vâng/Ừ) → giữ nguyên
      const fil = ts.filter(x => _VI_FILLER.test(x.trim()));
      rows[i - 1].t = (rows[i - 1].t + ' ' + con.join(' ')).trim();
      rows[i].t = fil.join(' ');
    }
    return rows;
  }
  // POLISH B: hàng còn GỐC nhưng DỊCH RỖNG (1:N residual — bản dịch đã bị DP gán lên hàng trước) → GỘP gốc lên hàng trước (thành 1 hàng 2:1 đúng).
  // Chỉ gộp khi AN TOÀN: có hàng trước & (KHÔNG phải hàng cuối HOẶC đã turnEnd) — tránh gộp nhầm khi bản dịch chỉ CHƯA kịp về (sẽ về ở pump sau).
  function _mergeEmptyRows(rows, turnEnd) {
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], emptyT = r.o && !(r.t && r.t.trim()), lastOne = i === rows.length - 1;
      if (emptyT && out.length && (!lastOne || turnEnd)) out[out.length - 1].o = (out[out.length - 1].o + ' ' + r.o).trim();
      else out.push({ o: r.o, t: r.t });
    }
    return out;
  }
  // Dịch có NỘI DUNG thật (≥1 câu KHÔNG phải filler VI) hay chỉ toàn Vâng/Ừ/Rồi (back-channel)?
  function _tHasContent(t) { const segs = _splitVI(t || ''); return segs.length ? segs.some(s => !_VI_FILLER.test(s.trim())) : false; }
  // Vẽ 1 hàng — chỉ khi nội dung ĐỔI (change-detect) → khỏi vẽ lại hàng đã ổn định.
  function _emitRow(id, o, t, partial) {
    o = o || ''; t = t || '';
    const key = o + '' + t + '' + (partial ? '1' : '0');
    if (_emit[id] === key) return;
    _emit[id] = key; if (id > _maxId) _maxId = id;
    if (!_rowTs[id]) _rowTs[id] = _ts();
    _send(id, [{ o, t }], !partial, _rowTs[id]);
  }
  // Xoá hàng từ fromId trở lên (khi DP gộp lại còn ÍT hàng hơn, hoặc dòng LIVE biến mất) → tránh "hàng ma".
  function _trimRowsFrom(fromId) {
    for (let id = fromId; id <= _maxId; id++) { if (_emit[id] !== undefined) { delete _emit[id]; delete _rowTs[id]; onCaption({ id, remove: true }); } }
    if (fromId - 1 < _maxId) _maxId = fromId - 1;
  }
  // ── CĂN T1C (time-DP lag-adaptive) ── re-render TOÀN CỤC mỗi lần thay đổi, chỉ gửi hàng nào đổi. Trạng thái cuối == căn DP offline (ja240 ~80 / ja ~87 / en ~95).
  // Mỗi câu gốc/dịch hoàn chỉnh gắn MỐC THỜI GIAN (_inT/_outT); DP ghép nhiều-nhiều theo |Δt|+lag cục bộ. Câu chưa đủ dấu chấm → dòng LIVE preview (mờ).
  function _schedulePump() { if (_pumpTimer) return; _pumpTimer = setTimeout(() => { _pumpTimer = null; _pump(false); }, PUMP_DEBOUNCE_MS); }   // debounce: gom các delta dồn dập vào 1 lần vẽ
  function _pump(final) {
    clearTimeout(_pumpTimer); _pumpTimer = null;   // đang vẽ → huỷ pump đang chờ (debounce)
    const transcribe = !!st().transcribeMode;
    const turnEnd = final && _turnEnded;
    const inSent = _splitPos(_inAcc);
    const outSent = transcribe ? inSent : _splitPos(_outAcc);
    const jaDone = _doneCount(_inAcc);
    const viDone = transcribe ? jaDone : _doneCount(_outAcc);
    const nIn = turnEnd ? inSent.length : jaDone;
    const nOut = turnEnd ? outSent.length : viDone;
    const _now = Date.now();   // mốc HOÀN THÀNH câu = lần ĐẦU câu thứ k/j lọt vào nIn/nOut (≈ Date.now() khi _doneCount tăng)
    for (let k = 0; k < nIn; k++) if (_inT[k] === undefined) _inT[k] = _now;
    if (!transcribe) for (let j = 0; j < nOut; j++) if (_outT[j] === undefined) _outT[j] = _now;
    let rows;
    if (transcribe) rows = inSent.slice(0, nIn).map(s => ({ o: '', t: s.text }));   // (chép lời đã gỡ — nhánh trơ, transcribe luôn false)
    else if (nIn > 0 && nOut > 0) {
      _noTransTurn = false;   // CÓ bản dịch → không phải lượt trùng ngôn ngữ
      rows = _fillerPostproc(_alignTimeRows(inSent.slice(0, nIn), outSent.slice(0, nOut), _inT, _outT, _outAcc.length / Math.max(1, _inAcc.length)));
      rows = rows.filter(r => !(_isFillerSrc(r.o) && !_tHasContent(r.t)));   // ẩn BACK-CHANNEL: hàng gốc filler mà dịch rỗng/chỉ-toàn-filler (はい→Vâng); GIỮ nếu lỡ ôm nội dung thật
      rows = _mergeEmptyRows(rows, turnEnd);   // POLISH B: gộp hàng gốc còn-lại-nhưng-dịch-rỗng (1:N residual) lên hàng trước
    } else if (nIn > 0 && (final || _noTransTurn)) {   // có lời GỐC nhưng KHÔNG có bản dịch (nói TRÙNG ngôn ngữ đích) → echo lời gốc làm "bản dịch". final/cờ ổn định → không nháy lúc dịch đang về.
      _noTransTurn = true;
      rows = inSent.slice(0, nIn).map(s => ({ o: '', t: s.text }));
    } else rows = [];
    for (let i = 0; i < rows.length; i++) _emitRow(_lineBase + i, transcribe ? '' : rows[i].o, rows[i].t, false);
    let nextId = _lineBase + rows.length;
    if (!turnEnd) {   // dòng LIVE: câu chưa đủ dấu chấm (gốc/dịch còn dở) → 1 hàng partial, xuống dòng theo câu
      const oPrev = transcribe ? '' : inSent.slice(nIn).map(s => s.text).join('\n').trim();
      const tPrev = (transcribe ? inSent : outSent).slice(nOut).map(s => s.text).join('\n').trim();
      if (oPrev || tPrev) { _emitRow(nextId, oPrev, tPrev, true); nextId++; }
    }
    _trimRowsFrom(nextId);
    if (turnEnd) { _lineBase += rows.length; _inAcc = ''; _outAcc = ''; _inT = []; _outT = []; _turnEnded = false; _clearTurn(); }
  }
  function _flush() { clearTimeout(_emitTimer); clearTimeout(_flushTimer); _pump(true); }
  function _clearTurn() { for (const k in _emit) delete _emit[k]; for (const k in _rowTs) delete _rowTs[k]; _maxId = _lineBase - 1; _noTransTurn = false; }
  // Đóng CỨNG lượt (stop / đổi ngôn ngữ giữa lượt): nhảy id qua mọi hàng đã hiện để KHỎI đè lượt mới, reset trạng thái.
  function _endTurnHard() { _lineBase = _maxId + 1; _inAcc = ''; _outAcc = ''; _inT = []; _outT = []; _turnEnded = false; _clearTurn(); }

  // ── Audio TTS: gom ~0.4s rồi phát trọn 1 lần ──
  function _flushAudio(reason) {
    clearTimeout(_audioIdleTimer); _audioIdleTimer = null;
    clearTimeout(_audioBreakTimer); _audioBreakTimer = null;
    if (!_audioBuf.length) return;
    let total = 0; for (const b of _audioBuf) total += b.length;
    const merged = new Uint8Array(total); let off = 0;
    for (const b of _audioBuf) { merged.set(b, off); off += b.length; }
    // DEBUG: 'break'=đủ câu (text kết câu) | 'idle'=model nghỉ | 'turn'=hết lượt | 'max'=trần 3s. text tail cho thấy lúc phát text đã đủ câu chưa.
    console.log(`[tts] phát (${reason || '?'}) ${((total >> 1) / 24000).toFixed(2)}s | text: "…${(_outAcc || '').slice(-45)}"`);
    _audioBuf = []; _audioSamples = 0;
    onAudio({ b64: _bytesToB64(merged), sampleRate: 24000 });
  }
  function _bufAudio(b64) {
    const bytes = _b64ToBytes(b64);
    _audioBuf.push(bytes); _audioSamples += bytes.length >> 1;
    if (_audioSamples >= AUDIO_MAX_SAMPLES) { _flushAudio('max'); return; }   // trần an toàn 3s
    clearTimeout(_audioIdleTimer);
    _audioIdleTimer = setTimeout(() => _flushAudio('idle'), AUDIO_IDLE_MS);   // nghỉ tự nhiên (cuối câu) → phát nốt
  }
  // Khi BẢN DỊCH chạm dấu ngắt (không phải . , kẹp số thập phân/tiền) → hẹn phát CỤM audio đã gom.
  function _audioBreakOnText() {
    const s = (_outAcc || '').replace(/\s+$/, '');
    if (!s) return;
    const c = s[s.length - 1];
    if (!TR_BREAK.test(c)) return;
    if ((c === '.' || c === ',') && /\d/.test(s[s.length - 2] || '')) return;   // . , kẹp số → chưa chắc ngắt → đợi ký tự kế
    if (!_audioBuf.length) return;
    clearTimeout(_audioBreakTimer);
    _audioBreakTimer = setTimeout(() => _flushAudio('break'), AUDIO_BREAK_GRACE_MS);
  }
  function _resetAudio() { clearTimeout(_audioIdleTimer); _audioIdleTimer = null; clearTimeout(_audioBreakTimer); _audioBreakTimer = null; _audioBuf = []; _audioSamples = 0; }

  function _onMessage(gen, m) {
    if (gen !== _gen) return;
    try {
      if (m.sessionResumptionUpdate && m.sessionResumptionUpdate.resumable && m.sessionResumptionUpdate.newHandle) _handle = m.sessionResumptionUpdate.newHandle;
      if (m.goAway) { console.log('[live] goAway → reconnect'); _reconnectWithHandle(); return; }
      const sc = m.serverContent;
      if (!sc) return;
      const transcribe = !!st().transcribeMode;
      let changed = false;
      const itText = sc.inputTranscription && sc.inputTranscription.text;    // lời GỐC
      const otText = sc.outputTranscription && sc.outputTranscription.text;   // bản DỊCH
      if (typeof itText === 'string' && itText) { const mg = _mergeTrans(_inAcc, itText); if (mg !== _inAcc) { _inAcc = mg; changed = true; } }
      if (!transcribe && typeof otText === 'string' && otText) { const mg = _mergeTrans(_outAcc, otText); if (mg !== _outAcc) { _outAcc = mg; changed = true; } }   // mốc thời gian câu dịch ghi trong _pump (theo _doneCount)
      const parts = (sc.modelTurn && sc.modelTurn.parts) || sc.parts;
      if (!transcribe && parts && st().geminiAudioOn !== false) {
        for (const p of parts) { const id = p && (p.inlineData || p.inline_data); const d = id && id.data; if (d) _bufAudio(d); }
      }
      if (changed) {
        _schedulePump();   // GỘP NHỊP VẼ (~350ms) → UI bớt nhảy; vẫn chốt CẶP hoàn chỉnh + hiện partial
        // chốt nốt phần dư (lệch số câu / câu cuối dở) khi NGHỈ hẳn hoặc HẾT lượt
        clearTimeout(_flushTimer); _flushTimer = setTimeout(() => _pump(true), _turnEnded ? INPUT_GRACE_MS : LONG_IDLE_MS);
        if (!transcribe && st().geminiAudioOn !== false) _audioBreakOnText();
      }
      if (sc.turnComplete) { _turnEnded = true; clearTimeout(_flushTimer); _flushTimer = setTimeout(() => _pump(true), INPUT_GRACE_MS); _flushAudio('turn'); }   // hết lượt → chốt text + phát nốt audio còn lại
    } catch (e) { console.warn('[live] msg lỗi:', e && e.message); }
  }

  async function _connect() {
    const ai = new GoogleGenAI({ apiKey: String(st().apiKey).trim() });
    const myGen = ++_gen;
    const config = {
      responseModalities: [Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      translationConfig: { targetLanguageCode: bcp47(st().langCode), echoTargetLanguage: false },   // luôn DỊCH (chép-lời đã gỡ); nói trùng ngôn ngữ đích → echo ở tầng _pump
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: _handle ? { handle: _handle } : {},
    };
    // Giọng đọc đầu ra — docs xác nhận LiveConnectConfig.speechConfig áp dụng cho cả engine dịch.
    // Đổi giọng → onVoiceChanged() mở phiên mới với voiceName mới.
    if (!st().transcribeMode && st().geminiVoice) {
      config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: st().geminiVoice } } };
    }
    return ai.live.connect({
      model: MODEL,
      config,
      callbacks: {
        onopen: () => console.log('[live] phiên mở (gen ' + myGen + ', →' + bcp47(st().langCode) + (_handle ? ', resume' : '') + ')'),
        onmessage: (m) => _onMessage(myGen, m),
        onerror: (e) => console.warn('[live] ws error:', e && e.message),
        onclose: () => { if (myGen === _gen) { _session = null; if (_started) _scheduleReconnect(); } },
      },
    });
  }
  async function _ensure() {
    if (!_started || !isConfigured()) return null;
    if (_session) return _session;
    if (_connecting) return _connecting;
    _connecting = (async () => {
      try { _session = await _connect(); }
      catch (e) { console.warn('[live] connect lỗi:', e && e.message); _session = null; onStatus({ error: e && e.message }); if (_started) _scheduleReconnect(); }
      finally { _connecting = null; }
      return _session;
    })();
    return _connecting;
  }
  function _scheduleReconnect() { if (!_started) return; clearTimeout(_reconnectTimer); _reconnectTimer = setTimeout(() => { if (_started && !_session && !_connecting) _ensure().catch(() => {}); }, RECONNECT_MS); }
  function _closeSession() { const s = _session; _session = null; _gen++; if (s) { try { s.close(); } catch {} } }
  function _reconnectWithHandle() { _closeSession(); if (_started) _ensure().catch(() => {}); }

  async function pushAudio(f32) {
    if (!_started || !isConfigured() || !f32 || !f32.length) return;
    const sess = await _ensure();
    if (!sess) return;
    try { sess.sendRealtimeInput({ audio: { data: _f32ToPcm16B64(f32), mimeType: 'audio/pcm;rate=16000' } }); }
    catch (e) { /* đang reconnect → bỏ khung này */ }
  }

  function start() {
    if (_started) return;
    if (!isConfigured()) { onStatus({ error: 'no-key' }); return; }
    _started = true; _handle = null; _inAcc = ''; _outAcc = ''; _inT = []; _outT = []; _clearTurn(); _resetAudio();
    _ensure().catch(() => {});
    console.log('[live] start');
  }
  function stop() {
    _started = false;
    clearTimeout(_reconnectTimer); clearTimeout(_emitTimer); clearTimeout(_flushTimer); clearTimeout(_pumpTimer);
    if (_inAcc || _outAcc) { _turnEnded = true; _flush(); }   // chốt nốt phần đang dở trước khi dừng
    _endTurnHard(); _handle = null; _resetAudio();
    _closeSession();
    onClear();
    console.log('[live] stop');
  }
  function onTargetLangChanged() { if (_started) { _handle = null; _endTurnHard(); clearTimeout(_emitTimer); clearTimeout(_flushTimer); clearTimeout(_pumpTimer); _resetAudio(); _closeSession(); _ensure().catch(() => {}); } }
  function onTranscribeModeChanged() { onTargetLangChanged(); }
  function onVoiceChanged() {   // đổi giọng → mở PHIÊN MỚI (bỏ resume) để áp dụng speechConfig giọng mới ngay
    if (!_started) return;
    _handle = null; _resetAudio(); _closeSession(); _ensure().catch(() => {});
  }
  function setAudioOn(on) { if (!on) { _resetAudio(); onClear(); } }
  const isActive = () => _started;

  return { isConfigured, isActive, pushAudio, start, stop, onTargetLangChanged, onTranscribeModeChanged, onVoiceChanged, setAudioOn };
}

// Validate API key (zero-cost: ListModels). Trả { ok } | { ok:false, error }.
export async function validateKey(key) {
  const k = String(key || '').trim();
  if (!k) return { ok: false, error: 'empty' };
  try {
    const ai = new GoogleGenAI({ apiKey: k });
    const pager = await ai.models.list();
    for await (const _m of pager) break;
    return { ok: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    return { ok: false, error: /api[_ ]?key|invalid|400|401|403/i.test(msg) ? 'invalid' : msg };
  }
}
