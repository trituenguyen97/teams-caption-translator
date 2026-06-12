/**
 * punctuate-ko.js — Heuristic khôi phục dấu KẾT CÂU tiếng Hàn (register lịch sự/trang trọng — họp hành)
 * cho output STT (Moonshine base-ko). Rule-based, KHÔNG model, xử lý MỘT đoạn đã chốt (VAD segment).
 *
 * Vì sao rule-based đủ tốt: tiếng Hàn formal đánh dấu loại câu NGAY TRONG đuôi ngữ pháp (어미) —
 * ~습니다/~ㅂ니다 = trần thuật, ~습니까/~나요/~ㄹ까요/~ㄴ가요 = nghi vấn → nhìn đuôi là biết dấu.
 *
 * Mirror rule ja (_NONTERM_TAIL bên audio-stt.js): đuôi NỐI (~고/~며/~지만/~는데/~서/~면…) hoặc trợ từ
 * (은/는/을/를/에서/부터…) = VAD cắt giữa câu → KHÔNG ép ".", và BỎ "." model lỡ đặt sau đuôi nối.
 *
 * Chuẩn hoá đuôi HỎNG model hay phun: 슴니다/슈니다/슘니다/윻니다/슙니다 → 습니다 (và biến thể 니까).
 * An toàn vì KHÔNG có từ/cách chia tiếng Hàn hợp lệ nào sinh các chuỗi này: 슴/슈/슘/윻/슙 đứng TRƯỚC
 * 니다/니까 không bao giờ đúng chính tả — danh từ kết bằng 슴/슘 (가슴, 칼슘) muốn thành vị ngữ phải qua
 * copula 입니다, không bao giờ +니다 trực tiếp; 윻 thực tế không xuất hiện trong từ vựng tiếng Hàn.
 * → thay TOÀN CỤC (đuôi hỏng xuất hiện cả giữa đoạn: "완료됐윻니다만 서비스…", "정착시켰슴니다,").
 *
 * "!" → ".": họp formal hầu như không có câu cảm thán, "!" của Moonshine là nhiễu → ép về "." cho caption
 * đồng nhất. "?" CÓ SẴN luôn được giữ (model nghe được ngữ điệu hỏi mà mặt chữ không thể hiện).
 */
'use strict';

// jongseong (받침) index của âm tiết Hangul; -1 nếu không phải Hangul. Bảng Unicode: ㄴ=4, ㅂ=17.
const JONG_N = 4, JONG_B = 17;
function _jong(ch) {
  if (!ch) return -1;
  const c = ch.codePointAt(0);
  return (c >= 0xAC00 && c <= 0xD7A3) ? (c - 0xAC00) % 28 : -1;
}

// Đuôi hỏng → 습니다/습니까 (xem header — chỉ những dạng KHÔNG BAO GIỜ hợp lệ trong tiếng Hàn chuẩn).
const RX_CORRUPT = /[슴슈슘윻슙](니다|니까)/g;

const RX_TRAIL_JUNK = /[\s,，、]+$/;                 // khoảng trắng + phẩy rác cuối đoạn
const RX_PUNC_END = /[.?!…]+$/;                      // cụm dấu kết có sẵn
const RX_QUOTE_END = /[)\]}»」』"'”’]+$/;  // nháy/ngoặc đóng cuối đoạn

// Từ hỏi (WH) — boost "?" cho đuôi 요 LƯỠNG NGHĨA (세요/어요/죠… vừa trần thuật vừa nghi vấn tuỳ ngữ điệu),
// mirror heuristic でしょう+QWORD bên punctuate-ja. Loại trước từ CHỨA từ hỏi nhưng không phải hỏi (왜냐하면…).
const RX_QWORD = /(어떻게|어떡|무엇|뭐|왜|어디|언제|누가|누구|얼마|몇|어느|무슨)/;
const RX_QWORD_FALSE = /(왜냐하면|언제나|언제든지?|어디(에)?서나|누구나|뭐든지?|어떻게든)/g;
const RX_YO_AMBIG = /(세요|어요|아요|해요|봐요|줘요|와요|돼요|죠|지요)$/;
// Marker mệnh đề NHÚNG ~지 (câu hỏi gián tiếp danh hóa): WH + ~는지/~ㄹ지 + 모르다/궁금하다… = TRẦN THUẬT
// ("왜 그런지 모르겠어요" = "tôi không biết vì sao" — không phải câu hỏi trực tiếp) → chặn boost.
const RX_EMBED_JI = /(는지|런지|[은인일을ㄹㄴ]지)(?!요)/;

// Đuôi 요 trần thuật (해요체). KHÔNG dùng /요$/ trần — danh từ thường kết 요: 필요/주요/수요/개요 sẽ dính oan.
// 나요/가요 đặt CUỐI danh sách vì nhánh nghi vấn (있나요/인가요) đã được bắt TRƯỚC ở _isInterrogative.
const RX_YO_DECL = /(어요|아요|여요|예요|에요|애요|해요|돼요|봐요|줘요|와요|워요|려요|켜요|네요|데요|게요|래요|대요|군요|거든요|지요|죠|니까요|세요|셔요|가요|나요)$/;

function _isInterrogative(t) {
  // ~습니까/~ㅂ니까: 니까 sau âm tiết có jongseong ㅂ (습니까/합니까/됩니까/입니까). Jongseong khác = ~(으)니까
  // "vì" (connective, ví dụ 없으니까/그러니까) → chắc chắn KHÔNG phải câu hỏi → return luôn.
  let m = t.match(/([가-힣])니까$/);
  if (m) return _jong(m[1]) === JONG_B;
  // ~나요 (있나요/하나요/되나요/없나요) — TRỪ động từ gốc kết 나 chia 아요 = trần thuật (끝나요/만나요/나타나요…)
  if (/나요$/.test(t)) return !/(끝나요|만나요|일어나요|떠나요|지나요|나타나요|태어나요|늘어나요|벗어나요|생겨나요)$/.test(t);
  // ~ㄴ가요 (인가요/신가요/은가요/는가요/한가요): 가요 sau âm tiết jongseong ㄴ. 가요 không-ㄴ (들어가요 "đi vào")
  // = động từ 가다 chia 아요 → rơi xuống nhánh trần thuật.
  m = t.match(/([가-힣])가요$/);
  if (m && _jong(m[1]) === JONG_N) return true;
  // ~ㄹ까요/을까요/일까요 (할까요/볼까요/될까요) — TRỪ ~니까요 (đuôi nêu lý do, trần thuật: 했으니까요.)
  if (/까요$/.test(t)) return !/니까요$/.test(t);
  if (/[는은]지요$/.test(t)) return true;   // ~는지요/은지요 (hỏi gián tiếp lịch sự: 아시는지요)
  // Đuôi 요 lưỡng nghĩa + có từ hỏi trong MỆNH ĐỀ CUỐI → "?" (어떻게 생각하세요 → ?; 앉으세요 → . vì không WH).
  // CHỈ xét mệnh đề cuối (sau dấu câu giữa đoạn): VAD 8s dễ chứa 2+ câu — WH ở câu TRƯỚC không được lan "?"
  // sang câu trần thuật cuối ("어디로 갈까요. 저는 모르겠어요" → "."). Và chặn câu hỏi GIÁN TIẾP qua RX_EMBED_JI
  // ("왜 그런지 모르겠어요" → "." vì 런지 là mệnh đề danh hóa, không phải hỏi trực tiếp).
  if (RX_YO_AMBIG.test(t)) {
    const lastClause = t.split(/[.?!…]/).pop().replace(RX_QWORD_FALSE, '');
    if (RX_QWORD.test(lastClause) && !RX_EMBED_JI.test(lastClause)) return true;
  }
  return false;
}

function _isDeclarative(t) {
  let m = t.match(/([가-힣])니다$/);
  if (m && _jong(m[1]) === JONG_B) return true;   // ~습니다/~ㅂ니다/입니다 (합쇼체) — 99% câu họp formal
  m = t.match(/([가-힣])시다$/);
  if (m && _jong(m[1]) === JONG_B) return true;   // ~ㅂ시다 (합시다/봅시다 "chúng ta hãy…")
  if (/십시오$/.test(t)) return true;             // mệnh lệnh trang trọng (확인하십시오)
  return RX_YO_DECL.test(t);
}

// Đuôi NỐI/trợ từ = VAD cắt giữa câu → KHÔNG thêm dấu, BỎ "."/"!" lỡ có. Chỉ chọn đuôi ĐỘ CHÍNH XÁC CAO,
// tránh đụng danh từ thường: BỎ 고$ trần (보고/사고/광고), 면$ trần (화면/측면/장면), 서$/고서$ (보고서/순서/부서),
// trợ từ 1 âm tiết 가/이/도/의/로 (증가/회의/정도/도로). Đuôi không nằm list nào → "giữ nguyên" = cũng không bị ép dấu.
const RX_CONNECTIVE = new RegExp(
  '(며' +                                                  // ~(으)며 "và/vừa" (하며/되며/이며/도입하며)
  '|하고|되고|이고|리고|시고|었고|았고|겠고|였고' +          // ~고 "và/rồi" (dạng cụ thể, né danh từ kết 고)
  '|지만|다만|니다만' +                                     // ~지만/~습니다만 "nhưng"
  '|는데|은데|인데' +                                       // ~는데 "mà/thì" (bối cảnh, hay bị cắt ở đây)
  '|해서|어서|아서|여서|라서|면서' +                         // ~서 "vì/rồi", ~면서 "vừa…vừa"
  '|하면|되면|으면|다면|이면|보면|시면|려면' +               // ~면 "nếu" (dạng cụ thể)
  '|려고|도록|거나|든지|다가' +                              // mục đích/phạm vi/lựa chọn/chuyển cảnh
  '|에서|으로|에게|한테|부터|까지|보다|처럼|마다|조차|마저|밖에)$' // trợ từ đa âm tiết
);
// Trợ từ 1 âm tiết — câu formal không kết bằng các trợ từ này. BỎ 과/와/을 khỏi class (đụng danh từ thường
// kết câu hợp lệ: 결과/효과/성과, 가을/마을, 기와 — "조사 결과." sẽ bị bóc "." oan); 은/는/를/에 ít đụng hơn hẳn
// (danh từ kết 를 gần như không có; 은 trần = "bạc" hiếm; 에-final hiếm).
const RX_PARTICLE1 = /[은는를에]$/;

function _isConnective(t) {
  if (RX_CONNECTIVE.test(t) || RX_PARTICLE1.test(t)) return true;
  const m = t.match(/([가-힣])니까$/);
  return !!m && _jong(m[1]) !== JONG_B;     // ~(으)니까 "vì" (dạng ㅂ니까 là câu hỏi, đã bắt ở trên)
}

/**
 * Chuẩn hoá dấu kết câu cho MỘT đoạn STT tiếng Hàn đã chốt. Đồng bộ — gọi trong _commitSeg như punctuateJa.
 * @param {string} s đoạn text model trả về
 * @returns {string} đoạn đã chuẩn hoá dấu kết (nguyên văn nếu không nhận diện được đuôi)
 */
function punctuateKo(s) {
  let t = String(s == null ? '' : s).replace(RX_CORRUPT, '습$1');   // sửa đuôi hỏng TOÀN CỤC trước
  t = t.replace(RX_TRAIL_JUNK, '');
  if (!t) return t;

  // Tách nháy/ngoặc đóng cuối để soi đuôi thật; dấu kết đặt TRONG nháy ("…합니다." — hợp 한글맞춤법).
  let quotes = '';
  const qm = t.match(RX_QUOTE_END);
  if (qm) { quotes = qm[0]; t = t.slice(0, -quotes.length).replace(RX_TRAIL_JUNK, ''); }
  if (!t) return quotes;

  const pm = t.match(RX_PUNC_END);
  const punc = pm ? pm[0] : '';
  const core = (pm ? t.slice(0, -punc.length) : t).replace(RX_TRAIL_JUNK, '');
  if (!core) return t + quotes;                      // đoạn toàn dấu → trả nguyên

  let out;
  if (punc.includes('?')) out = '?';                 // "?" có sẵn luôn giữ (gom về đúng 1 dấu)
  else if (_isInterrogative(core)) out = '?';        // kể cả sửa "습니까." → "습니까?"
  else if (_isDeclarative(core)) out = '.';
  else if (_isConnective(core)) out = '';            // cắt giữa câu → để trống cho đoạn sau nối tiếp
  else if (punc) out = /(\.{3}|…)/.test(punc) ? '…' : '.';   // đuôi lạ: giữ dấu cũ, "!"→".", "..."→"…"
  else out = '';                                     // không nhận diện được + không dấu → giữ nguyên

  return core + out + quotes;
}

module.exports = { punctuateKo };
