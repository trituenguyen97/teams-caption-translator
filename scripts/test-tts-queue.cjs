/**
 * test-tts-queue.cjs — kiểm chứng logic M1 (cap hàng đợi TTS theo giây audio, drop-oldest) + M2 (tách câu dài)
 * sao y app.html. Mục tiêu: họp dày KHÔNG để TTS trôi hậu vô hạn; câu dài tách để đọc sớm + drop hạt mịn.
 */
const _TTS_BUDGET_S = 6, _TTS_HARD_S = 12, _TTS_SPLIT_CHARS = 120;
const _ttsEstSec = (t) => (t ? t.length : 0) * 0.045;

let _ttsQueue = [], _ttsCurSrc = null, _ttsCurEnd = null, _now = 0;
const _ttsSpoken = new Set();
const _ctx = { get currentTime() { return _now; } };
function _ttsPendingSec() {
  let s = 0;
  if (_ttsCurSrc && _ttsCurEnd != null) s += Math.max(0, _ttsCurEnd - _ctx.currentTime);
  for (const t of _ttsQueue) s += _ttsEstSec(t);
  return s;
}
function _ttsSplit(text) {
  const raw = text.split(/(?<=[,.;:!?])\s+/);
  const out = []; let cur = '';
  for (const seg of raw) {
    if (cur && (cur + ' ' + seg).length > _TTS_SPLIT_CHARS) { out.push(cur.trim()); cur = seg; }
    else cur = cur ? cur + ' ' + seg : seg;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [text];
}
function ttsEnqueue(id, text) {
  if (!text) return;
  if (id != null) { if (_ttsSpoken.has(id)) return; _ttsSpoken.add(id); }
  for (const p of (text.length > _TTS_SPLIT_CHARS ? _ttsSplit(text) : [text])) _ttsQueue.push(p);
  if (_ttsPendingSec() > _TTS_HARD_S) _ttsQueue.splice(0, _ttsQueue.length - 1);
  else while (_ttsQueue.length > 1 && _ttsPendingSec() > _TTS_BUDGET_S) _ttsQueue.shift();
}

const A = []; const ok = (n, c) => { A.push([n, c]); };

// 1) câu ngắn KHÔNG tách
{ _ttsQueue = []; _ttsSpoken.clear(); ttsEnqueue(1, 'Xin chào mọi người.');
  ok('Câu ngắn không tách (1 item)', _ttsQueue.length === 1); }

// 2) câu DÀI tách, mỗi mảnh ≲ _TTS_SPLIT_CHARS
{ _ttsQueue = []; _ttsSpoken.clear();
  const long = 'Hôm nay chúng ta sẽ bàn về kế hoạch quý ba, bao gồm doanh thu dự kiến, chi phí vận hành, '
    + 'và các rủi ro tiềm ẩn; sau đó sẽ chuyển sang phần hỏi đáp, rồi tổng kết các hành động cần làm tiếp theo.';
  const parts = _ttsSplit(long);
  ok('Câu dài tách >1 mảnh', parts.length > 1);
  ok('Mỗi mảnh ≤ ~SPLIT+1 từ', parts.every(p => p.length <= _TTS_SPLIT_CHARS + 30)); }

// 3) M1 drop-oldest: nhồi 10 câu trung bình (~100 ký tự ≈ 4.5s mỗi câu) → tổng giữ ≤ budget+1 câu
{ _ttsQueue = []; _ttsSpoken.clear(); _ttsCurSrc = null; _ttsCurEnd = null;
  const s = 'Đây là một câu dịch có độ dài trung bình khoảng chừng một trăm ký tự để mô phỏng phát biểu thật.'; // ~95
  for (let i = 0; i < 10; i++) ttsEnqueue(100 + i, s);
  const pend = _ttsPendingSec();
  ok('Pending ≤ budget + 1 câu (không trôi vô hạn)', pend <= _TTS_BUDGET_S + _ttsEstSec(s) + 0.01);
  ok('Giữ các câu MỚI nhất (cái cuối còn trong hàng)', _ttsQueue.includes(s) && _ttsQueue.length >= 1);
  ok('Đã BỎ bớt câu cũ (không giữ cả 10)', _ttsQueue.length < 10); }

// 4) trần cứng: 1 câu CỰC dài (>12s audio) sau khi tách vẫn bị kẹp; nhồi thêm → chỉ giữ mới nhất
{ _ttsQueue = []; _ttsSpoken.clear();
  const huge = ('rất dài '.repeat(60)).trim() + '.';   // ~480 ký tự ≈ 21s
  ttsEnqueue(200, huge);
  ttsEnqueue(201, 'Câu mới nhất.');
  ok('Vượt trần cứng → hàng đợi rút gọn', _ttsQueue.length <= 3);
  ok('Câu mới nhất được giữ', _ttsQueue[_ttsQueue.length - 1].includes('mới nhất')); }

// 5) dedup theo id
{ _ttsQueue = []; _ttsSpoken.clear();
  ttsEnqueue(5, 'Một câu.'); ttsEnqueue(5, 'Một câu.');
  ok('Dedup id (push 1 lần)', _ttsQueue.length === 1); }

// 6) clip đang phát tính vào pending
{ _ttsQueue = []; _ttsSpoken.clear(); _now = 0; _ttsCurSrc = {}; _ttsCurEnd = 8;  // clip còn 8s
  ttsEnqueue(6, 'Câu kế tiếp khá dài để cộng vào ngân sách phát hiện trôi.');
  ok('Clip đang phát cộng vào pending', _ttsPendingSec() >= 8); }

console.log('idx | kết quả | tên');
let pass = true;
A.forEach(([n, c], i) => { console.log(`${String(i).padStart(2)}  | ${c ? '✅' : '❌'}    | ${n}`); if (!c) pass = false; });
console.log(pass ? '\n✅ TẤT CẢ PASS' : '\n❌ CÓ FAIL');
process.exit(pass ? 0 : 1);
