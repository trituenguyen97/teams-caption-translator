/**
 * ko-fix.js — Sửa lỗi loanword/chính tả HỆ THỐNG của Moonshine base-ko trên text FINAL (sau transcribe).
 *
 * CHÍNH SÁCH AN TOÀN (bắt buộc khi thêm entry — xem scripts/test-ko-fix.js):
 *   1. wrong-form PHẢI là phi-từ (non-word) trong tiếng Hàn chuẩn — KHÔNG bao giờ là output đúng.
 *      (로고→로그, 후자→투자, 곳→것… đều BỊ LOẠI vì wrong-form là từ thật → false positive thảm họa.)
 *   2. Chỉ thêm lỗi ĐÃ QUAN SÁT và có tính hệ thống (loanword garble / liaison / đuôi 슴니다) —
 *      KHÔNG đoán mò wrong-form chưa thấy, KHÔNG nhét rác âm học một-lần (롯위로, YO하고…).
 *   3. Biên từ 2 phía: trước = đầu chuỗi / ký tự không phải Hangul-Latin-số; sau = hết chuỗi /
 *      không-Hangul / josa. Chặn key-là-tiền-tố-của-từ-thật: 서빙스푼 (thìa serving), A파이프라인, 기슬기.
 *
 * Khác hẳn hotword-biasing decoder (đã loại với ja): thay chuỗi thuần trên text final → 0 chi phí decode,
 * 0 đụng beam, deterministic, test được. Trần hiệu quả khiêm tốn (~28% lỗi trên data A/B) — phần còn lại
 * là lỗi thay-từ-thật (후자/개방/측…) mà KHÔNG phương pháp text-level an toàn nào sửa nổi.
 */
'use strict';

// Ký tự ĐẦU của các josa phổ biến + COPULA (입니다/일/예요/였: "변도체입니다" phải sửa được — ngữ cảnh
// vị ngữ danh từ phổ biến NHẤT trong họp formal) — cho phép key dính liền josa/copula (페이로베가, 변도체들,
// 기슬입니다) nhưng chặn key nuốt phần đầu từ thật dài hơn (서빙스푼: 푼 ∉ tập này → không khớp).
// Đã soát từng key + 입/일/예/였: không tổ hợp nào tạo tiền tố của từ thật.
const _JOSA = '가이은는을를과와도만의에로으나야랑께요까부보처조마밖들라입일예였';
const _L = '(^|[^가-힣A-Za-z0-9])';                       // biên trái: đầu chuỗi / không Hangul-Latin-số
const _R = `(?=$|[^가-힣]|[${_JOSA}])`;                   // biên phải: hết chuỗi / không-Hangul / josa

// wrong → right. MỌI key là phi-từ đã kiểm chứng (tra từ điển chuẩn + soát từ thật lân cận).
const _MAP = [
  ['A파이',   'API'],      // "A파이 서버" — Latin dính Hangul, không bao giờ hợp lệ (파이=pie/π nhưng "A파이" thì không)
  ['페이로베', '페일오버'],  // failover garble; từ thật gần nhất 페이로드 (payload) khác âm tiết cuối → không đụng
  ['변도체',  '반도체'],    // semiconductor; 도체/전도체/부도체 là từ thật nhưng khác key exact
  ['기슬',    '기술'],      // phi-từ (기슭 = ven núi/sông có patchim ㄺ, khác ký tự; 산기슬 bị biên trái chặn)
  ['서빙스',  '서비스'],    // đuôi VAD cắt giữa từ; 서빙(serving) là từ thật nhưng "서빙스" thì không; 서빙스푼 bị biên phải chặn
];
const _RULES = _MAP.map(([w, r]) => ({ re: new RegExp(_L + w + _R, 'g'), right: r }));

// "503메러" ← "오백 삼 에러": liaison ㅁ+에→메 khi model dính số vào 에러. Khóa theo CHỮ SỐ đứng trước
// → không bao giờ đụng tên riêng 메러디스 (Meredith) hay bất kỳ chỗ nào khác.
const _DIGIT_MERO = new RegExp(`(\\d)\\s*메러${_R}`, 'g');

// Đuôi "~슴니다" → "~습니다": chính tả sai hệ thống của model (thấy 2 lần / 10 clip). Trong output ASR
// formal không bao giờ hợp lệ (chỉ tồn tại như cách viết đùa trên mạng, không phải lời nói).
const _SEUMNIDA = /(?<=[가-힣])슴니다(?=$|[^가-힣])/g;

/** Sửa text FINAL tiếng Hàn. An toàn: lỗi bất kỳ → trả nguyên văn. */
function koFix(text) {
  if (!text || typeof text !== 'string') return text;
  try {
    let out = text;
    for (const { re, right } of _RULES) out = out.replace(re, (m, pre) => pre + right);
    out = out.replace(_DIGIT_MERO, '$1 에러');
    out = out.replace(_SEUMNIDA, '습니다');
    return out;
  } catch { return text; }
}

module.exports = { koFix };
