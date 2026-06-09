/**
 * translation.js — Tất cả translation providers + orchestrator + queue
 */
const { httpsPost, httpsGet, httpPostLocal, httpGetLocalUrl } = require('./http-helpers');
const state = require('./state');

// ── Constants ─────────────────────────────────────────
const TEAMS_TOKEN_TTL = 55 * 60 * 1000;
const EDGE_TOKEN_TTL = 9 * 60 * 1000;
// Concurrent translation: cloud OK với 3 (rate limit), local CPU phải 1 (tránh chia BW RAM)
const getMaxConcurrent = () => state.provider === 'local' ? 1 : 3;

// ── Online cascade: cooldown per-engine ───────────────
// Provider 'online' gộp Google → MS. Engine nào dính 429/403 → né tạm ONLINE_COOLDOWN_MS để
// engine còn lại gánh (không hammer endpoint đang bị chặn). Hết cooldown tự gọi lại bình thường.
const ONLINE_COOLDOWN_MS = 12000;   // 429/403 → né engine 12s (cũ 30s quá lâu → caption mất dịch cả đoạn)
const _engineCooldown = { google: 0, ms: 0 };
const _engineReady = (e) => Date.now() - _engineCooldown[e] >= ONLINE_COOLDOWN_MS;
const _engineTrip  = (e) => { _engineCooldown[e] = Date.now(); console.warn('[online] cooldown', e, `${ONLINE_COOLDOWN_MS}ms`); };

// Local LLM defaults — MiLMMT-46-1B Q4_K_M (model dịch JP→VI chuyên dụng, local duy nhất)
const LOCAL_DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8080',
  model:   'MiLMMT-46-1B-v0.1.Q4_K_M.gguf',
};

const LANG_NAMES = {
  'vi': 'Vietnamese', 'en': 'English', 'zh-CN': 'Simplified Chinese',
  'ko': 'Korean', 'ja': 'Japanese',
};

const LANG_LABELS = {
  'vi': 'tiếng Việt', 'en': 'tiếng Anh', 'zh-CN': 'tiếng Trung',
  'ko': 'tiếng Hàn', 'ja': 'tiếng Nhật',
};

const PROV_NAMES = {
  online: 'Online (auto)', local: 'Local LLM',
  // legacy — giữ để log/label câu cũ còn đọc được trước khi migrate sang 'online'
  'teams-token': 'MS Translator',
  'google-free': 'Google Translate',
};

const _msTranslatorLangMap = {
  'Vietnamese': 'vi', 'English': 'en', 'Japanese': 'ja', 'Korean': 'ko',
  'Simplified Chinese': 'zh-Hans',
};

// Map targetLang → mã ngôn ngữ của Google. Hoist ra module scope (trước đây tạo lại object literal
// mỗi câu trong hàm dịch cloud).
const GOOGLE_LANG_CODES = {
  'Vietnamese': 'vi', 'English': 'en', 'Simplified Chinese': 'zh-CN',
  'Korean': 'ko', 'Japanese': 'ja',
};

// ── Phrase Map ────────────────────────────────────────
const PHRASE_MAP = {
  'こんにちは': 'Xin chào.', 'おはようございます': 'Chào buổi sáng.',
  'こんばんは': 'Chào buổi tối.', 'お疲れ様でした': 'Bạn đã làm việc vất vả, cảm ơn.',
  'お疲れ様です': 'Cảm ơn vì sự cố gắng của bạn.',
  'お世話になっております': 'Cảm ơn sự quan tâm của bạn.',
  'よろしくお願いします': 'Rất mong được hợp tác.',
  'よろしくお願いいたします': 'Rất mong được hợp tác.',
  'どうぞよろしくお願いします': 'Rất mong được hợp tác với bạn.',
  '本日はよろしくお願いいたします': 'Hôm nay rất mong được hợp tác cùng mọi người.',
  '引き続きよろしくお願いします': 'Tiếp tục mong được hợp tác.',
  'お願いします': 'Rất mong được hợp tác.', 'はい': 'Vâng.',
  'はい、わかりました': 'Vâng, tôi hiểu rồi.', 'わかりました': 'Tôi hiểu rồi.',
  'かしこまりました': 'Tôi đã hiểu, xin tuân theo.', '了解です': 'Đã hiểu.',
  '了解しました': 'Đã hiểu rồi.', 'ありがとうございます': 'Cảm ơn bạn.',
  'ありがとうございました': 'Cảm ơn bạn rất nhiều.',
  'どうもありがとうございました': 'Xin chân thành cảm ơn.',
  'すみません': 'Xin lỗi.', '失礼します': 'Xin phép.',
  '失礼いたします': 'Xin phép được thất lễ.',
  '申し訳ありません': 'Tôi rất xin lỗi.', '申し訳ございません': 'Tôi thành thật xin lỗi.',
  'そうですね': 'Đúng vậy nhỉ.', 'なるほど': 'À, tôi hiểu rồi.',
  'おっしゃる通りです': 'Đúng như bạn nói.', '確認します': 'Tôi sẽ xác nhận lại.',
  '確認しました': 'Đã xác nhận.', '問題ありません': 'Không có vấn đề gì.',
  '大丈夫です': 'Ổn rồi.', '以上です': 'Hết rồi, cảm ơn.',
  'よろしいでしょうか': 'Bạn có đồng ý không?', 'いかがでしょうか': 'Bạn thấy thế nào?',
  'では始めましょう': 'Vậy chúng ta bắt đầu nhé.', '始めましょう': 'Chúng ta bắt đầu nhé.',
  'お先に失礼します': 'Tôi xin phép về trước.', 'ちょっとよろしいですか': 'Cho tôi hỏi một chút được không?',
  // Câu họp/xã giao thường gặp (#2)
  '承知しました': 'Tôi đã rõ ạ.', '承知いたしました': 'Tôi đã rõ ạ.',
  'ご確認ください': 'Vui lòng kiểm tra giúp ạ.', 'ご確認お願いします': 'Nhờ anh/chị kiểm tra giúp ạ.',
  'ご確認をお願いします': 'Nhờ anh/chị kiểm tra giúp ạ.',
  '少々お待ちください': 'Xin chờ một chút ạ.', 'お待ちください': 'Xin chờ một chút ạ.',
  'お待たせしました': 'Xin lỗi đã để mọi người chờ.', 'お待たせいたしました': 'Xin lỗi đã để mọi người chờ.',
  'もう一度お願いします': 'Nhờ anh/chị nói lại một lần nữa ạ.',
  'もう一度いいですか': 'Cho tôi nghe lại một lần nữa được không ạ?',
  '聞こえますか': 'Mọi người nghe rõ không ạ?', '聞こえますでしょうか': 'Mọi người nghe rõ không ạ?',
  '聞こえています': 'Tôi nghe rõ ạ.', '画面見えますか': 'Mọi người thấy màn hình không ạ?',
  '画面共有します': 'Tôi xin chia sẻ màn hình.', '共有します': 'Tôi xin chia sẻ màn hình.',
  '以上になります': 'Trên đây là phần trình bày của tôi ạ.',
  '質問はありますか': 'Có câu hỏi nào không ạ?', '何か質問はありますか': 'Có câu hỏi nào không ạ?',
  'よろしいですか': 'Được chứ ạ?', 'がんばりましょう': 'Cùng cố gắng nhé.',
};

// Chuẩn hóa câu Nhật: bỏ khoảng trắng + dấu câu ở hai đầu
function normJa(s) {
  return (s || '').trim().replace(/^[\s、。・，]+/, '').replace(/[。、！？!?.，\s]+$/g, '');
}

// Tiền tố thời gian / từ đệm / dẫn nhập hay đứng trước câu xã giao → bỏ để khớp phần lõi.
// (vd "今日はよろしくお願いいたします" → "よろしくお願いいたします")
const PHRASE_PREFIX_RE = /^(?:えー?と?|あの[ー〜っ]?|まずは?|では|それでは|じゃあ?|じゃ|さて|そして|本日は?|今日は?|改めて|引き続き|皆様は?|皆さんは?|みなさんは?|どうぞ|何卒)[\s、,]*/;

function lookupPhrase(text) {
  const t = normJa(text);
  if (!t) return null;
  if (PHRASE_MAP[t]) return PHRASE_MAP[t];

  // Bỏ tối đa 2 lớp tiền tố đệm/thời gian rồi tra lại (vd "では、まずよろしくお願いします")
  let core = t;
  for (let k = 0; k < 2; k++) {
    const nx = normJa(core.replace(PHRASE_PREFIX_RE, ''));
    if (nx === core) break;
    core = nx;
  }
  if (core !== t && PHRASE_MAP[core]) return PHRASE_MAP[core];

  // Họ "よろしくお願い…": gần như luôn là câu chào/xã giao (kể cả khi ASR rớt お hoặc đổi đuôi).
  // Neo ^ để KHÔNG nuốt nhầm câu nhờ vả có nội dung (vd "システム導入をよろしくお願いします").
  if (/^よろしく(?:お?願い(?:いた)?し?ま?す?)?$/.test(core)) {
    return PHRASE_MAP['よろしくお願いします'];
  }
  // "お願いします" đứng riêng (ASR có thể rớt お → "願いします")
  if (/^お?願い(?:いた)?し?ま?す$/.test(core)) {
    return PHRASE_MAP['お願いします'];
  }
  return null;
}

// ── LLM Refusal Detection ─────────────────────────────
// Hoist ra module scope: isLLMRefusal được gọi 2-3 lần/câu (qeSuspicion S5 + các gate orchestrator)
// → trước đây biên dịch lại 12 regex mỗi lần gọi. Không g-flag nên .test() stateless, chia sẻ an toàn.
const REFUSAL_PATTERNS = [
  /i('m| am) (sorry|afraid|unable|not able)/i,
  /i (cannot|can't|couldn't) (translate|understand|process)/i,
  /sorry[,.]? (i |but )?(cannot|can't|am unable)/i,
  /unable to (translate|understand|process)/i,
  /xin lỗi[,.]? (nhưng )?tôi không thể/i,
  /tôi xin lỗi[,.]/i,
  /không thể (hiểu|dịch|xử lý)/i,
  /văn bản đầu vào/i, /nội dung đầu vào/i,
  /cannot (be translated|determine|identify)/i,
  /please provide/i, /would you (like|want)/i,
];
function isLLMRefusal(output, input) {
  if (!output) return true;
  return REFUSAL_PATTERNS.some(p => p.test(output));
}

// ── Sót ký tự nguồn chưa dịch — TÙY NGÔN NGỮ ĐÍCH (#CJK) ──
// Trước đây mọi guard dùng cứng /[kana+Hán]/ để phát hiện "dịch chưa xong". Nhưng tiếng TRUNG dùng
// Hán (一-鿿) và tiếng NHẬT dùng kana+Hán → bản dịch ĐÚNG sang CN/JA bị hiểu nhầm là "còn nguyên Nhật"
// ⇒ orchestrator trả nguyên văn + app hiện gạch ngang (—). Hệ quả: KHÔNG dịch được sang Nhật/Trung
// (mọi nguồn). Sửa: phán đoán theo đích —
//   · Japanese          → kana+Hán đều HỢP LỆ ⇒ không bao giờ coi là sót.
//   · Simplified Chinese → Hán hợp lệ; chỉ kana (hira/kata) mới là sót Nhật.
//   · vi/en/ko          → mọi kana/Hán đều là sót nguồn chưa dịch (hành vi cũ, đúng).
function hasUntranslatedCJK(out, targetLang) {
  const t = targetLang || state.targetLang;
  if (t === 'Japanese') return false;
  if (t === 'Simplified Chinese') return /[぀-ゟ゠-ヿ]/.test(out || '');
  return /[぀-ゟ゠-ヿ一-鿿]/.test(out || '');
}

// ── Quality Estimation (chấm độ ngờ bản dịch — reference-free, #QE) ────
// Mức A = tín hiệu chuỗi/độ dài S1–S5 (rẻ). Ngờ cao → fallback Google.
// S6 (logprob, Mức B) GIỮ trong code nhưng MẶC ĐỊNH TẮT: translateLocalMiLMMT không gửi n_probs
// nữa (chậm ~40%/câu vì vocab 262k) → avgLogprob=null → S6 không cộng. Bật lại nếu cần độ chính xác QE.
const QE_THRESHOLD = 0.5;     // ngờ ≥ ngưỡng → ưu tiên Google (tinh chỉnh theo log thực tế)
const _VI_DIACRITIC = /[ăâđêôơưĂÂĐÊÔƠƯạáàảãậấầẩẫắằẳẵặẹéèẻẽệếềểễọóòỏõộốồổỗợớờởỡụúùủũựứừửữỵýỳỷỹĐ]/;
let _lastMilmmtQE = 1;        // độ ngờ lần MiLMMT gần nhất (local concurrency=1 → an toàn dùng biến module)

function qeSuspicion(jaSrc, vi, avgLogprob) {
  if (!vi || vi.trim().length < 2) return 1;                                        // rỗng / quá ngắn
  let s = 0;
  if (hasUntranslatedCJK(vi)) s += 0.6;                                             // S1: sót ký tự nguồn (tùy ngôn ngữ đích)
  if (vi.length > 10 && state.targetLang === 'Vietnamese' && !_VI_DIACRITIC.test(vi)) s += 0.5; // S2: không có dấu Việt
  const r = vi.length / Math.max(1, (jaSrc || '').length);
  if (r < 0.5 || r > 4) s += 0.3;                                                   // S3: tỉ lệ độ dài bất thường
  if (/(\S+)(?:\s+\1){2,}/iu.test(vi)) s += 0.3;                                    // S4: lặp token ≥3 lần
  if (isLLMRefusal(vi, jaSrc)) s += 0.6;                                            // S5: refusal
  if (numScaleMismatch(jaSrc, vi)) s += 0.5;                                        // S7: lệch bậc số lớn (万/億/兆)
  if (typeof avgLogprob === 'number')                                              // S6: độ tự tin (thang trượt; mặc định tắt)
    s += Math.max(0, Math.min(0.6, (-avgLogprob - 0.55) / 0.5));
  return Math.min(1, s);
}

// S7: lệch BẬC số lớn JP→VI. MiLMMT hay rớt đơn vị 万(10^4)/億(10^8)/兆(10^12):
// vd "500万" (=5.000.000) → "500.000" (sai 10×). Đo thực: lỗi này S1–S6 đều bỏ sót.
// Bắt khi: nguồn có <số>万/億/兆 mà output THIẾU cả số đủ chữ số LẪN từ chỉ bậc (nghìn/triệu/tỷ/vạn).
// Số liệu sai → fallback Google (xử lý số chuẩn hơn). Reference-free, không cần logprob.
const _SCALE_UNIT = { '万': 4, '億': 8, '兆': 12 };
function numScaleMismatch(src, out) {
  const m = (src || '').match(/(\d+)\s*([万億兆])/);
  if (!m) return false;
  if (/(nghìn|ngàn|triệu|tỷ|tỉ|vạn|ức)/i.test(out || '')) return false;   // có từ chỉ bậc → coi như ổn
  const expDigits = m[1].replace(/^0+/, '').length + _SCALE_UNIT[m[2]];    // số chữ số của giá trị đầy đủ
  const norm = (out || '').replace(/(?<=\d)[.,\s](?=\d)/g, '');            // gộp "500.000" → "500000"
  const maxDigits = (norm.match(/\d+/g) || []).reduce((a, b) => Math.max(a, b.length), 0);
  return maxDigits < expDigits;                                           // số lớn nhất vẫn thiếu bậc → lệch
}

// ── Text Preprocessing ────────────────────────────────
const JA_FILLERS = [
  'えっと', 'ええと', 'あの', 'あのー', 'あのう',
  'なんか', 'なんかー', 'まあ', 'まー', 'ま、',
  'ちょっと', 'そのー', 'そのう', 'うーん', 'んー',
  'ねえ', 'ねー', 'さあ', 'さー', 'でー', 'でえと',
];
const JA_FILLER_RE = new RegExp(
  '(?:' + JA_FILLERS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')[、。,\\s]*', 'g'
);

// Glossary thuật ngữ IT/katakana → tiếng Anh: thay sẵn trong câu NGUỒN trước khi dịch.
// MiLMMT/Google hay dịch katakana thành tiếng Việt (デプロイ→"phân phối", バックエンド→"hậu cần"…);
// thay sẵn giúp GIỮ thuật ngữ tiếng Anh và nhiều ca còn dịch đúng hơn (đã kiểm chứng trên server).
// Chỉ ảnh hưởng văn bản gửi đi dịch — phần tiếng Nhật hiển thị vẫn nguyên gốc.
// Người dùng có thể bổ sung từ/tên riêng vào đây.
const JA_GLOSSARY = {
  'コードレビュー': 'code review', 'プルリクエスト': 'pull request', 'プルリク': 'PR',
  'リファクタリング': 'refactor', 'デプロイメント': 'deployment', 'デプロイ': 'deploy',
  'リリース': 'release', 'ロールバック': 'rollback', 'マージ': 'merge', 'コミット': 'commit',
  'ブランチ': 'branch', 'リポジトリ': 'repository', 'バックエンド': 'backend',
  'フロントエンド': 'frontend', 'データベース': 'database', 'サーバー': 'server', 'サーバ': 'server',
  'パイプライン': 'pipeline', 'スプリント': 'sprint', 'タスク': 'task', 'チケット': 'ticket',
  'イシュー': 'issue', 'デバッグ': 'debug', 'リクエスト': 'request', 'レスポンス': 'response',
  'エンドポイント': 'endpoint', 'ライブラリ': 'library', 'フレームワーク': 'framework',
  'レビュー': 'review', 'スケジュール': 'schedule',
  'マイルストーン': 'milestone', 'プロジェクト': 'project', 'リソース': 'resource',
  'ステータス': 'status', 'バージョン': 'version', 'パフォーマンス': 'performance',
  'ブリッジ': 'Bridge (BrSE)', 'ブレッジ': 'Bridge (BrSE)',
};
const _glossRe = new RegExp(
  Object.keys(JA_GLOSSARY).sort((a, b) => b.length - a.length)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'
);
function applyGlossary(text) {
  // replace() với regex /g luôn quét từ đầu & tự reset lastIndex → không cần test() (tránh bug lastIndex)
  return text.replace(_glossRe, m => ' ' + JA_GLOSSARY[m] + ' ');
}

// ── Name glossary (tên riêng) ─────────────────────────
// MiLMMT 1B hay phiên âm SAI tên kanji/katakana (佐藤→"Saito", 高橋→"Cao Hachiya"). Thay tên → romaji
// NGAY TRONG NGUỒN để model copy đúng (đã kiểm chứng: "Sato"/"Takahashi" ra chuẩn). Vì team họp định kỳ
// có danh sách tên cố định → người dùng tự thêm cặp "kanji/katakana": "Romaji". MẶC ĐỊNH RỖNG (no-op).
const NAME_GLOSSARY = {
  // Ví dụ — bỏ comment & thêm tên thành viên team của bạn (nên ghi cả họ tên có dấu ・ nếu có):
  // 'グエン・チ・トゥエ': 'Nguyen Chi Tue', '田中': 'Tanaka', '佐藤': 'Sato', '高橋': 'Takahashi',
};
const _NAME_KEYS = Object.keys(NAME_GLOSSARY).sort((a, b) => b.length - a.length);  // dài trước (tránh khớp 1 phần)
function applyNameGlossary(text) {
  if (!_NAME_KEYS.length) return text;
  let t = text;
  for (const k of _NAME_KEYS) if (t.includes(k)) t = t.split(k).join(NAME_GLOSSARY[k]);
  return t;
}

function preprocessText(text) {
  let t = applyNameGlossary(text);      // tên riêng → romaji TRƯỚC (để model copy đúng)
  t = t.replace(/(.{2,}?)\1+/g, '$1');
  t = t.replace(JA_FILLER_RE, '');
  t = applyGlossary(t);                 // giữ thuật ngữ IT tiếng Anh (#1)
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t || text;
}

// ── Hậu xử lý bản dịch (#A) ───────────────────────────
// Output-glossary: ép thuật ngữ IT bị MT dịch SAI về tiếng Anh (chỉ cụm gần như chắc chắn — tránh hồi quy).
const VI_TERM_FIX = {
  'cú nhảy': 'sprint', 'nước rút': 'sprint',
};
const _viFixRe = Object.keys(VI_TERM_FIX).length
  ? new RegExp('\\b(' + Object.keys(VI_TERM_FIX).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi')
  : null;

// Context-aware term restoration: khôi phục thuật ngữ IT bị dịch sang tiếng Việt — CHỈ khi thuật ngữ
// EN có trong NGUỒN (jaSrc đã qua glossary) mà MẤT khỏi output. Guard theo nguồn → ~0 false positive
// (đo thực: survival IT 50%→86%, FP 0/4 trên câu đối chứng). Không dùng \b (đứt với ký tự có dấu như
// "đ/á") → dùng ranh giới [^A-Za-z]. MiLMMT 1B hay dịch mất các thuật ngữ này dù glossary đã chèn.
// Bảng mở rộng theo ĐO THỰC (quét 34 thuật ngữ glossary): chỉ giữ biến thể VI ĐẶC TRƯNG để tránh
// false positive. Bỏ issue→"vấn đề" / request→"yêu cầu" / ticket→"vé" (quá phổ biến). Thứ tự: cụm
// dài/cụ thể trước (code review trước review; deployment trước deploy) để khớp đúng.
const _IT_TERM_RESTORE = [
  { en: 'pull request', vi: /(yêu cầu kéo(?: pull)?|yêu cầu pull)/i },
  { en: 'code review',  vi: /(xem xét lại code|xem xét code)/i },
  { en: 'deployment',   vi: /(việc triển khai|sự triển khai)/i },
  { en: 'deploy',       vi: /(triển khai)/i },
  { en: 'database',     vi: /(cơ sở dữ liệu)/i },
  { en: 'server',       vi: /(máy chủ)/i },
  { en: 'pipeline',     vi: /(đường ống(?: dẫn)?)/i },
  { en: 'repository',   vi: /(kho lưu trữ)/i },
  { en: 'library',      vi: /(thư viện)/i },
  { en: 'performance',  vi: /(hiệu suất|hiệu năng)/i },
  { en: 'release',      vi: /(phát hành)/i },
  { en: 'rollback',     vi: /(khôi phục lại|quay lui|hoàn tác)/i },
  { en: 'merge',        vi: /(sáp nhập|hợp nhất|gộp lại)/i },
  { en: 'branch',       vi: /(chi nhánh|nhánh)/i },
  { en: 'schedule',     vi: /(lịch trình)/i },
  { en: 'milestone',    vi: /(mốc thời gian|cột mốc)/i },
  { en: 'resource',     vi: /(tài nguyên)/i },
  { en: 'status',       vi: /(trạng thái)/i },
  { en: 'version',      vi: /(phiên bản)/i },
  { en: 'project',      vi: /(dự án)/i },
  { en: 'task',         vi: /(nhiệm vụ)/i },
  { en: 'response',     vi: /(phản hồi)/i },
  { en: 'review',       vi: /(xem xét lại|xem xét|rà soát|đánh giá)/i },
];
function restoreITTerms(out, src) {
  if (!src) return out;
  let t = out;
  for (const { en, vi } of _IT_TERM_RESTORE) {
    const enRe = new RegExp('(^|[^A-Za-z])' + en + '($|[^A-Za-z])', 'i');
    if (!enRe.test(src)) continue;   // nguồn không có thuật ngữ EN → bỏ qua (chống false positive)
    if (enRe.test(t)) continue;      // thuật ngữ đã sống sót trong output
    if (vi.test(t)) t = t.replace(vi, en);   // khôi phục lần xuất hiện đầu của biến thể tiếng Việt
  }
  return t;
}

// Sửa số bậc lớn 万/億/兆 DETERMINISTIC (offline): tự tính giá trị đúng từ nguồn rồi vá vào output —
// mạnh hơn S7 (chỉ flag→Google) vì sửa offline + bắt cả ca model dùng SAI từ-bậc ("100 triệu" cho 10億).
// CHỈ vá số đứng TRƯỚC đơn vị tiền (yên/đồng) để KHÔNG đụng ngày tháng/số đếm. Đã đo: 6/6 quyết định đúng.
const _JP_MULT = { '百': 1e2, '千': 1e3, '万': 1e4, '億': 1e8, '兆': 1e12 };
const _VN_SCALE = { 'nghìn': 1e3, 'ngàn': 1e3, 'triệu': 1e6, 'tỷ': 1e9, 'tỉ': 1e9 };
const _groupVN = n => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function fixNumberScale(out, jaSrc) {
  const nums = [];
  (jaSrc || '').replace(/(?:\d+[百千万億兆])+\d*/g, (m) => {
    let v = 0; const re = /(\d+)([百千万億兆])?/g; let x;
    while ((x = re.exec(m))) { if (!x[1]) continue; v += parseInt(x[1], 10) * (x[2] ? _JP_MULT[x[2]] : 1); }
    nums.push(v); return m;
  });
  if (nums.length !== 1) return out;            // chỉ xử lý ca 1 số → an toàn (nhiều số: để S7 + Google lo)
  const expected = nums[0];
  const m = out.match(/(\d[\d.,]*)\s*(nghìn|ngàn|triệu|tỷ|tỉ)?\s*(yên|yen|đồng|JPY)/i);
  if (!m) return out;
  const got = parseFloat(m[1].replace(/[.,]/g, '')) * (_VN_SCALE[(m[2] || '').toLowerCase()] || 1);
  if (!(got > 0) || got === expected) return out;                                  // đã đúng
  if (Math.max(got, expected) / Math.min(got, expected) < 5) return out;          // lệch <5x → bỏ (rounding)
  return out.slice(0, m.index) + _groupVN(expected) + ' ' + m[3] + out.slice(m.index + m[0].length);
}

// Làm câu tiếng Việt tự nhiên hơn sau khi dịch: chuẩn dấu câu/khoảng trắng, khử lặp artifact,
// ép thuật ngữ, thêm tiểu từ lịch sự "ạ" theo thể です/ます của câu nguồn (giọng họp).
// An toàn khi nguồn không phải Nhật / đích không phải Việt (các bước đặc thù tự bỏ qua).
function postprocessTranslation(out, jaSrc) {
  if (!out) return out;
  let t = out;

  // 1) Dấu câu full-width Nhật còn sót → ASCII
  t = t.replace(/[。．]/g, '.').replace(/、/g, ', ').replace(/！/g, '!').replace(/？/g, '?')
       .replace(/[「」『』]/g, '"').replace(/（/g, '(').replace(/）/g, ')').replace(/・/g, ' ');

  // 2) Chuẩn khoảng trắng quanh dấu câu (giữ an toàn cho số: 3.5 / 1,000 không bị tách)
  t = t.replace(/\s+([,.!?;:])/g, '$1')
       .replace(/([.!?])(?=[^\s\d.!?])/g, '$1 ')
       .replace(/,(?=[^\s\d])/g, ', ')
       .replace(/\s{2,}/g, ' ').trim();

  // 3) Khử cụm token lặp liền kề ≥3 lần (artifact loop của MT); giữ 2 lần (có thể trung thành nguồn)
  t = t.replace(/(\S+)(?:\s+\1){2,}/gi, '$1');

  const isVi = state.targetLang === 'Vietnamese';

  // 4) Output glossary: ép thuật ngữ IT bị dịch sai về tiếng Anh
  if (isVi && _viFixRe) t = t.replace(_viFixRe, m => VI_TERM_FIX[m.toLowerCase()] || m);

  // 5) Khôi phục "review" khi MT dịch một phần nhưng còn NEO tiếng Anh (vd "xem xét code" → "review code").
  //     Chỉ thay khi đi kèm neo (code/API/backend…) → KHÔNG đụng "xem xét"/"đánh giá" đứng riêng (an toàn).
  if (isVi) t = t.replace(/\b(?:xem xét|đánh giá|rà soát)(?: lại)? (code|API|backend|frontend|server|build|database)\b/gi, 'review $1');

  // 5b) Context-aware: khôi phục thuật ngữ IT theo nguồn (jaSrc đã qua glossary). Tổng quát hoá bước 5.
  if (isVi) t = restoreITTerms(t, jaSrc);

  // 5c) Sửa số bậc lớn 万/億 deterministic (offline, chính xác) — chạy trước S7 nên S7 không cần flag nữa.
  if (isVi) t = fixNumberScale(t, jaSrc);

  // 6) Viết hoa chữ cái đầu
  t = t.replace(/^(\p{Ll})/u, c => c.toUpperCase());

  return t.trim() || out;
}

// ── Provider Functions ────────────────────────────────

// Google Translate (FREE) — endpoint công khai dùng bởi browser extensions, không cần API key
async function translateGoogleFree(text, tgtLang) {
  const tgt = GOOGLE_LANG_CODES[tgtLang] || 'vi';
  const path = `/translate_a/single?client=gtx&sl=auto&tl=${tgt}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await httpsGet('translate.googleapis.com', path, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  });
  if (!r.body || r.status !== 200) {
    if (r.status === 429 || r.status === 403) {
      _engineTrip('google');   // né Google trong cascade 'online' tới khi hết cooldown
      console.warn('[google-free] rate-limited hoặc bị chặn:', r.status);
    }
    return null;
  }
  try {
    const j = JSON.parse(r.body);
    if (!Array.isArray(j) || !Array.isArray(j[0])) return null;
    let result = j[0].map(seg => seg && seg[0]).filter(Boolean).join('').trim();
    result = postprocessTranslation(result, text);   // #A: làm câu tự nhiên hơn
    if (result) console.log('[google-free] OK:', text.slice(0, 30), '→', result.slice(0, 30));
    return result || null;
  } catch (e) {
    console.warn('[google-free] parse error:', e.message);
    return null;
  }
}

// ── Edge Translator (FREE) ────────────────────────────

async function getEdgeTranslateToken() {
  if (state.edgeAuthToken && Date.now() - state.edgeAuthTs < EDGE_TOKEN_TTL) return state.edgeAuthToken;
  try {
    const r = await httpsGet('edge.microsoft.com', '/translate/auth', {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
    });
    if (r.status === 200 && r.body && r.body.startsWith('eyJ')) {
      state.edgeAuthToken = r.body.trim();
      state.edgeAuthTs = Date.now();
      console.log('[edge-translate] Auth token OK, len:', state.edgeAuthToken.length);
      return state.edgeAuthToken;
    }
    console.warn('[edge-translate] Auth failed:', r.status);
    return null;
  } catch (e) { console.warn('[edge-translate] Auth error:', e.message); return null; }
}

async function translateViaEdge(text) {
  const to = _msTranslatorLangMap[state.targetLang];
  if (!to) return null;
  const authToken = await getEdgeTranslateToken();
  if (!authToken) return null;
  try {
    const r = await httpsPost(
      'api-edge.cognitive.microsofttranslator.com',
      `/translate?api-version=3.0&to=${encodeURIComponent(to)}&textType=plain`,
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      JSON.stringify([{ Text: text }])
    );
    if (r.status === 200) {
      const result = JSON.parse(r.body)[0]?.translations?.[0]?.text;
      if (result) console.log('[edge-translate] OK:', text.slice(0, 30), '→', result.slice(0, 30));
      return result || null;
    }
    if (r.status === 429) {
      _engineTrip('ms');   // né MS trong cascade 'online' tới khi hết cooldown
      console.warn('[edge-translate] rate-limited 429');
    }
    if (r.status === 401 || r.status === 403) {
      state.edgeAuthToken = null;
      console.warn('[edge-translate] 401/403, token expired');
    }
    return null;
  } catch (e) { console.warn('[edge-translate] error:', e.message); return null; }
}

// ── Teams Token ───────────────────────────────────────

function parseJwtAudience(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')).aud || null;
  } catch { return null; }
}

function storeTeamsToken(token, label) {
  const aud = parseJwtAudience(token) || 'unknown';
  const existing = state.teamsTokens.get(aud);
  if (existing && existing.token === token) return;
  state.teamsTokens.set(aud, { token, ts: Date.now() });
  if (/translator|cognitive/i.test(aud)) {
    state.teamsToken = token; state.teamsTokenTs = Date.now();
    console.log(`[teams-token] ✓ Translator token từ ${label} | aud=${aud.slice(0,60)} | len:${token.length}`);
  } else {
    if (!state.teamsToken || Date.now() - state.teamsTokenTs > TEAMS_TOKEN_TTL) {
      state.teamsToken = token; state.teamsTokenTs = Date.now();
    }
    console.log(`[teams-token] token từ ${label} | aud=${aud.slice(0,60)} | len:${token.length}`);
  }
}

async function translateViaTeamsToken(text) {
  if (!state.teamsToken) return null;
  if (Date.now() - state.teamsTokenTs > TEAMS_TOKEN_TTL) {
    state.teamsToken = null;
    console.log('[teams-translate] Token hết hạn, đợi capture lại');
    return null;
  }
  const to = _msTranslatorLangMap[state.targetLang];
  if (!to) return null;
  try {
    const r = await httpsPost(
      'api.cognitive.microsofttranslator.com',
      `/translate?api-version=3.0&to=${to}&textType=plain`,
      { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.teamsToken}` },
      JSON.stringify([{ Text: text }])
    );
    if (r.status === 200) {
      const result = JSON.parse(r.body)[0]?.translations?.[0]?.text;
      if (result) console.log('[teams-translate] OK:', text.slice(0, 30), '→', result.slice(0, 30));
      return result || null;
    }
    if (r.status === 401 || r.status === 403) {
      console.warn('[teams-translate] Token bị từ chối (', r.status, '), xóa token');
      state.teamsToken = null;
    }
    return null;
  } catch (e) { console.warn('[teams-translate] lỗi:', e.message); return null; }
}

// ── Local LLM (OpenAI-compatible: llama.cpp server) ──

let _localLastFailTs = 0;
const LOCAL_FAIL_COOLDOWN_MS = 8000;

// ── MiLMMT-46 (Xiaomi, Gemma3-1B MT) — completion endpoint ──
// Model dịch chuyên dụng 46 ngôn ngữ. Dùng prompt format gốc (KHÔNG chat template):
//   Translate this from <src> to <tgt>:\n<src>: <text>\n<tgt>:
// Sampling greedy (temperature 0, top_k 1) theo model card + REPORT_speedup.md.

// Tên ngôn ngữ MiLMMT mong đợi (khác tên nội bộ của app ở vài mục, vd Chinese)
const MILMMT_LANG_NAMES = {
  'Vietnamese': 'Vietnamese', 'English': 'English', 'Japanese': 'Japanese',
  'Korean': 'Korean', 'Simplified Chinese': 'Chinese (Simplified)',
};
const milmmtLangName = (appLang) => MILMMT_LANG_NAMES[appLang] || appLang;

// Phát hiện ngôn ngữ nguồn (offline MiLMMT). Thứ tự: dấu hiệu chắc chắn → mơ hồ.
//   kana ⇒ Nhật · hangul ⇒ Hàn · dấu tiếng Việt ⇒ Việt · ký tự giản thể đặc trưng ⇒ Trung ·
//   Hán-thuần (không có dấu hiệu trên) ⇒ Nhật (caption họp Nhật luôn có kana, Hán-thuần hiếm) · Latin ⇒ Anh.
const _VI_SRC = /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;
// Ký tự giản thể THƯỜNG GẶP mà tiếng Nhật hiện đại KHÔNG dùng (đã loại các shinjitai dùng chung như 写/区/医/双/没).
const _ZH_SIMPLIFIED = /[这们吗呢请谢说语还给让过进边远运适选题课师级电视门问间实现习务试话怎您帮东车书见长对开关发变难风飞马鸟鱼鸡龙买卖红绿蓝页脑网络议检觉]/;
function detectSourceLang(text) {
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'Japanese';
  if (/[가-힯]/.test(text)) return 'Korean';
  if (_VI_SRC.test(text)) return 'Vietnamese';
  if (_ZH_SIMPLIFIED.test(text)) return 'Simplified Chinese';
  if (/[一-鿿]/.test(text)) return 'Japanese';
  return 'English';
}

async function translateLocalMiLMMT(text, tgtLang) {
  if (Date.now() - _localLastFailTs < LOCAL_FAIL_COOLDOWN_MS) return null;

  const baseUrl = state.localBaseUrl || LOCAL_DEFAULTS.baseUrl;
  const src = milmmtLangName(detectSourceLang(text));
  const tgt = milmmtLangName(tgtLang);
  if (src === tgt) return null;   // cùng ngôn ngữ → để fallback Google Free xử lý

  const prompt = `Translate this from ${src} to ${tgt}:\n${src}: ${text}\n${tgt}:`;
  // n_predict adaptive theo độ dài nguồn: lưới an toàn chặn vòng lặp degenerate chạy tới 256 token
  // (greedy+stop thường tự dừng sớm nên bình thường không chạm cap — hệ số rộng để KHÔNG cắt câu thật).
  const nPredict = Math.min(256, Math.max(64, text.length * 2 + 32));
  const body = JSON.stringify({
    prompt,
    n_predict: nPredict,
    temperature: 0,
    top_k: 1,            // greedy theo model card
    cache_prompt: true,
    // ⚠ KHÔNG bật n_probs: đo thực trên MiLMMT (vocab 262k) → n_probs:1 làm CHẬM ~40% mỗi câu
    //   (tính+serialize softmax/sort 262k mục mỗi token) mà output greedy KHÔNG đổi. Bỏ logprob →
    //   QE mất S6 (confidence) nhưng vẫn còn S1–S5 (chuỗi/độ dài/lặp/refusal) + post-process. Đáng đổi.
    stop: ['\n', `${src}:`, `${tgt}:`],
  });

  const r = await httpPostLocal(baseUrl, '/completion',
    { 'Content-Type': 'application/json' }, body, 25000);

  if (r.status === 0) {
    _localLastFailTs = Date.now();
    console.warn('[milmmt] không kết nối được', baseUrl, '|', r.error || 'unknown');
    return null;
  }
  if (r.status !== 200) {
    console.warn('[milmmt] HTTP', r.status, '|', (r.body || '').slice(0, 200));
    return null;
  }
  try {
    const j = JSON.parse(r.body);
    if (j.error) { console.warn('[milmmt] error:', j.error.message || j.error); return null; }
    // /completion trả về { content, ... }
    let out = (j.content || '').trim();
    // Bỏ prefix lặp lại nếu model tự thêm "Vietnamese:" / "Translation:"
    out = out.replace(/^(Vietnamese|Tiếng Việt|Translation|Output|[A-Z][a-z]+ \([A-Za-z]+\))\s*[:：]\s*/i, '').trim();
    out = postprocessTranslation(out, text);   // #A: làm câu tự nhiên hơn
    // #QE: chấm độ ngờ bằng S1–S5 (chuỗi/độ dài/lặp/refusal). S6 (avg logprob) đã bỏ cùng n_probs
    // để tăng tốc ~40%/câu — qeSuspicion nhận avgLogprob=null sẽ tự bỏ qua S6.
    _lastMilmmtQE = qeSuspicion(text, out, null);   // #QE: orchestrator dùng để quyết định fallback
    if (out) {
      const usage = j.timings ? ` | ${(j.timings.predicted_per_second || 0).toFixed(1)} tok/s` : '';
      console.log('[milmmt] OK:', text.slice(0, 30), '→', out.slice(0, 30), `| QE=${_lastMilmmtQE.toFixed(2)}`, usage);
    }
    return out || null;
  } catch (e) {
    console.warn('[milmmt] parse error:', e.message);
    return null;
  }
}

async function checkLocalServer() {
  const baseUrl = state.localBaseUrl || LOCAL_DEFAULTS.baseUrl;
  const r = await httpGetLocalUrl(baseUrl, '/v1/models', 2500);
  if (r.status !== 200) return { ok: false, error: `HTTP ${r.status}` };
  try {
    const j = JSON.parse(r.body);
    return { ok: true, models: (j.data || []).map(m => m.id) };
  } catch { return { ok: true, models: [] }; }
}

// ── Translation Memory (cache câu, #TM) ──────────────
const _TM_MAX = 500;
const _tm = new Map();
const _tmKey = (text) => `${state.provider}|${state.targetLang}|${normJa(text)}`;
// tmGet/tmSet nhận KEY đã tính sẵn → 1 câu fresh chỉ chạy normJa 1 lần cho key (trước đây get+set = 2 lần).
function tmGetByKey(k) {
  if (!_tm.has(k)) return undefined;
  const v = _tm.get(k); _tm.delete(k); _tm.set(k, v);   // chạm → mới nhất (LRU)
  return v;
}
function tmSetByKey(k, val) {
  if (_tm.has(k)) _tm.delete(k);
  _tm.set(k, val);
  if (_tm.size > _TM_MAX) _tm.delete(_tm.keys().next().value);   // đẩy cũ nhất
}

// ── Translation Orchestrator ──────────────────────────

// Wrapper cache: tra TM trước; chỉ cache bản dịch THẬT (khác input) để tránh cache lỗi passthrough.
// precomputedKey: key đã tính ở enqueueTranslate (tránh tính lại normJa khi đi qua hàng đợi).
async function translateText(text, precomputedKey) {
  const k = precomputedKey || _tmKey(text);
  const cached = tmGetByKey(k);
  if (cached !== undefined) return cached;
  const result = await _translateUncached(text);
  if (result && result !== text) tmSetByKey(k, result);
  return result;
}

async function _translateUncached(text) {
  const instant = lookupPhrase(text);
  if (instant) { console.log('[translate] phrase match:', text, '→', instant); return instant; }

  if (state.provider === 'local') {
    // Local = MiLMMT-46 (model dịch JP→VI chuyên dụng, duy nhất). /completion greedy + QE.
    const lResult = await translateLocalMiLMMT(text, state.targetLang);
    const lOk = lResult && lResult !== text && !isLLMRefusal(lResult, text)
      && !hasUntranslatedCJK(lResult);
    // #QE: chỉ tin MiLMMT khi độ ngờ thấp; ngờ cao (vd bịa tên / lệch nghĩa) → để Google xử lý
    const suspicious = _lastMilmmtQE >= QE_THRESHOLD;
    if (lOk && !suspicious) return lResult;
    // MiLMMT ngờ hoặc lỗi → thử Google (thường chuẩn hơn cho tên/kanji)
    const gResult = await translateGoogleFree(text, state.targetLang);
    if (gResult && gResult !== text && !isLLMRefusal(gResult, text)
        && !hasUntranslatedCJK(gResult)) return gResult;
    // Google fail → giữ MiLMMT (dù ngờ) còn hơn trả nguyên văn
    if (lOk) return lResult;
    return text;
  }

  // Mọi provider online gộp thành 1 nhánh cascade (mặc định 'online'; provider cũ teams-token/
  // google-free đã migrate về 'online' ở main.js, nhưng vẫn rơi đúng vào đây nếu store còn sót).
  return await translateOnline(text);
}

// Kết quả online "tốt": khác input, không phải refusal, không sót kana/kanji (dấu hiệu dịch chưa xong).
// Gom đúng 3 điều kiện vốn nằm rải rác ở các nhánh provider cũ → 1 cổng kiểm tra dùng chung cho cascade.
function _onlineResultOk(result, text) {
  return !!result && result !== text && !isLLMRefusal(result, text)
    && !hasUntranslatedCJK(result);
}

// Cascade online: Google → MS (Edge→Teams). Engine cho kết quả tốt → return NGAY (engine sau
// khỏi gọi → không thêm latency). Engine đang cooldown (429/403 gần đây) bị skip để né endpoint chết.
// Cả 2 fail/cooldown → trả nguyên văn (giữ hành vi cũ: thà nguyên gốc còn hơn rác).
async function translateOnline(text) {
  // 1) Google free — JP→VI tốt, ưu tiên chạy đầu
  if (_engineReady('google')) {
    const g = await translateGoogleFree(text, state.targetLang);
    if (_onlineResultOk(g, text)) return g;
  }
  // 2) MS Translator — Edge token (free), rồi Teams token nếu đang có (cùng backend MS)
  if (_engineReady('ms')) {
    const edge = await translateViaEdge(text);
    if (_onlineResultOk(edge, text)) return edge;
    if (state.teamsToken || state.teamsTokens.size > 0) {
      const teams = await translateViaTeamsToken(text);
      if (_onlineResultOk(teams, text)) return teams;
    }
  }
  return text;
}

// ── Translation Queue ─────────────────────────────────
const _queue = [];
let _running = 0;

function enqueueTranslate(text) {
  // Short-circuit cache TRƯỚC khi vào hàng đợi: câu trùng (chào hỏi/cụm lặp hay gặp) trả ngay ~0ms,
  // không phải chờ sau inference local (concurrency=1, ~500ms/câu). Tất cả provider còn lại không cần key.
  const k = _tmKey(text);
  const cached = tmGetByKey(k);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise(resolve => {
    _queue.push({ text, key: k, resolve });
    drainQueue();
  });
}

const _MAX_TRANSLATE_RETRY = 2;   // câu online dịch hỏng (429 cooldown) → thử lại để tự lành thay vì mất dịch

function drainQueue() {
  while (_running < getMaxConcurrent() && _queue.length > 0) {
    const item = _queue.shift();
    _running++;
    translateText(item.text, item.key)
      .then(result => {
        _running--;
        // Online trả NGUYÊN VĂN mà nguồn vẫn còn CJK = chưa dịch (thường do cả Google+MS đang cooldown 429).
        // Re-queue sau (qua cooldown) thay vì bỏ → caption sẽ được cập nhật khi engine hồi. KHÔNG retry local.
        const failed = result === item.text && state.provider !== 'local' && hasUntranslatedCJK(item.text);
        if (failed && (item.tries || 0) < _MAX_TRANSLATE_RETRY) {
          item.tries = (item.tries || 0) + 1;
          setTimeout(() => { _queue.push(item); drainQueue(); }, ONLINE_COOLDOWN_MS / 2 + item.tries * 1500);
        } else {
          item.resolve(result);
        }
        drainQueue();
      })
      .catch(() => { _running--; item.resolve(item.text); drainQueue(); });
  }
}

// ── Exports ───────────────────────────────────────────
module.exports = {
  LANG_NAMES, LANG_LABELS, PROV_NAMES,
  lookupPhrase, isLLMRefusal, hasUntranslatedCJK, preprocessText,
  translateText, enqueueTranslate,
  translateGoogleFree,
  translateViaEdge, translateViaTeamsToken,
  storeTeamsToken, parseJwtAudience,
  translateLocalMiLMMT, checkLocalServer, LOCAL_DEFAULTS,
};
