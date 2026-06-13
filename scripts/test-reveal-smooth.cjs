/**
 * test-reveal-smooth.cjs — kiểm logic A1 (lộ dần text nguồn partial) sao y app.html: tiến đơn điệu tới target,
 * đuổi kịp khi chunk mới tới, snap khi CHỐT (không-partial) hoặc khi partial reset ngắn hơn.
 */
const _revealing = new Set();
function _revealTick() {   // gọi tay thay rAF (1 lần = 1 frame)
  for (const el of [..._revealing]) {
    const full = el._origFull || '';
    let shown = el._origShown || 0;
    if (shown >= full.length) { _revealing.delete(el); el._origShown = full.length; continue; }
    shown = Math.min(full.length, shown + Math.max(1, Math.ceil((full.length - shown) * 0.10)));
    el._origShown = shown;
    el._orig.textContent = full.slice(0, shown);
  }
}
// xử lý 1 caption-live (phần A1) cho el
function onUpdate(el, original, isPartial) {
  const s = original || '';
  if (isPartial) {
    el._origFull = s;
    if ((el._origShown || 0) < s.length) _revealing.add(el);
    else if ((el._origShown || 0) > s.length) { el._origShown = s.length; el._orig.textContent = s; }
  } else {
    el._origFull = s; el._origShown = s.length; _revealing.delete(el);
    el._orig.textContent = s;
  }
}
const mkEl = () => ({ _orig: { textContent: '' }, _origFull: '', _origShown: 0 });
const drain = (max = 200) => { let n = 0; while (_revealing.size && n++ < max) _revealTick(); return n; };

const A = []; const ok = (n, c) => A.push([n, c]);

// 1) partial mọc → lộ dần monotonic tới đủ
{ const el = mkEl(); onUpdate(el, 'こんにちは', true);
  let prev = 0, mono = true; const lens = [];
  for (let i = 0; i < 30 && _revealing.size; i++) { _revealTick(); const L = el._orig.textContent.length; lens.push(L); if (L < prev) mono = false; prev = L; }
  ok('Lộ đơn điệu (không lùi)', mono);
  ok('Đạt đủ text', el._orig.textContent === 'こんにちは');
  ok('Có >1 bước (không nhảy 1 phát)', lens.length > 1); }

// 2) chunk mới (dài hơn) giữa chừng → tiếp tục lộ tới target mới
{ const el = mkEl(); onUpdate(el, 'おはよう', true); _revealTick(); _revealTick();
  const mid = el._orig.textContent.length;
  onUpdate(el, 'おはようございます', true);   // target dài hơn
  drain();
  ok('Chunk mới: lộ tiếp tới target mới', el._orig.textContent === 'おはようございます');
  ok('Đã lộ dở trước khi chunk mới', mid > 0 && mid < 'おはようございます'.length); }

// 3) CHỐT (không-partial) → snap đủ ngay, không còn trong hàng lộ
{ const el = mkEl(); onUpdate(el, 'スト', true); _revealTick();
  onUpdate(el, 'ストリーミング完了。', false);
  ok('Chốt snap đủ ngay', el._orig.textContent === 'ストリーミング完了。');
  ok('Chốt: rời khỏi _revealing', !_revealing.has(el)); }

// 4) partial RESET ngắn hơn (câu mới) → snap về text ngắn
{ const el = mkEl(); el._origFull = 'câu dài trước đó'; el._origShown = 16; el._orig.textContent = 'câu dài trước đó';
  onUpdate(el, 'mới', true);
  ok('Partial ngắn hơn → snap', el._orig.textContent === 'mới' && el._origShown === 3); }

// 5) hội tụ: luôn dừng (không vòng vô hạn)
{ const el = mkEl(); onUpdate(el, 'x'.repeat(200), true); const frames = drain(500);
  ok('Hội tụ < 500 frame', frames < 500 && el._orig.textContent.length === 200); }

console.log('idx | kết quả | tên');
let pass = true;
A.forEach(([n, c], i) => { console.log(`${String(i).padStart(2)}  | ${c ? '✅' : '❌'}    | ${n}`); if (!c) pass = false; });
console.log(pass ? '\n✅ TẤT CẢ PASS' : '\n❌ CÓ FAIL');
process.exit(pass ? 0 : 1);
