/**
 * ja-itn.js — ITN nhẹ cho tiếng Nhật: chuyển SỐ kanji → chữ số Ả Rập trong text STT (ReazonSpeech không có ITN).
 *
 * Dùng @geolonia/japanese-numeral (MIT, zero-dep, offline) để chuyển cụm số, GIỮ đơn vị 兆/億/万 như Live Captions
 * (二千二百二十億円 → 2220億円, không bung 222000000000) + xử lý thập phân (．/./点/・). Thay TẠI CHỖ bằng regex
 * (vị trí chính xác, KHÔNG split/join toàn cục) để khỏi hỏng kanji nằm trong TỪ (九州, 百貨店, 三角形).
 * Guard: 1 kanji-số LẺ mà KHÔNG kèm đơn vị/đếm phía sau → coi là 1 phần của từ → GIỮ NGUYÊN.
 */
let _lib = null;
function lib() { return (_lib = _lib || require('@geolonia/japanese-numeral')); }

const KDIGIT = { '〇':0,'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
const _NUM = '〇零一二三四五六七八九十百千万億兆';
// thập phân: <nguyên>[．./点・]<lẻ> — KHÔNG gồm 。 (U+3002, dấu chấm câu tiếng Nhật) để khỏi ghép nhầm qua ranh câu.
const _DEC_RE = new RegExp(`([${_NUM}\\d]+)[．.点・]([${_NUM}\\d]+)`, 'g');
const _NUMRUN_RE = new RegExp(`[${_NUM}]+`, 'g');
const _UNIT_RE = /([^兆億万]*)([兆億万])/g;
// Đơn vị/đếm hay đứng SAU số → tín hiệu "đây là số thật" (cho phép chuyển cả kanji-số lẻ như 一→1 trong 第一位).
const _UNIT_AFTER = new Set(Array.from('円年月日万億兆人個位時分秒番回度割合％%歳名件枚本台点ドル円'));

function _small(s) {
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  try { return String(lib().kanji2number(s)); } catch { return s; }   // lỗi → giữ nguyên
}
// Chuyển 1 cụm số kanji → chữ số, GIỮ đơn vị 兆/億/万 (vd 二千二百二十億 → 2220億, 五百 → 500).
function _convInt(s) {
  if (/^\d+$/.test(s)) return s;
  if (!/[兆億万]/.test(s)) return _small(s);
  let out = '', last = 0;
  s.replace(_UNIT_RE, (m, pre, unit, idx) => { out += _small(pre) + unit; last = idx + m.length; return m; });
  if (last < s.length) out += _small(s.slice(last));
  return out;
}
function _fracToDigits(s) {
  if (/^[〇零一二三四五六七八九]+$/.test(s)) return Array.from(s).map(c => KDIGIT[c]).join('');
  try { return String(lib().kanji2number(s)); } catch { return null; }
}

// Chuyển toàn bộ số kanji trong 1 câu tiếng Nhật → chữ số Ả Rập. An toàn: lỗi → trả nguyên văn.
function jaItn(text) {
  if (!text || typeof text !== 'string') return text;
  try {
    // 1) thập phân TRƯỚC (để phần nguyên không bị regex số nguyên nuốt mất dấu chấm)
    let out = text.replace(_DEC_RE, (m, intp, frac) => {
      const i = _convInt(intp), f = _fracToDigits(frac);
      return (f == null || /[^\d]/.test(i)) ? m : `${i}.${f}`;
    });
    // 2) cụm số nguyên kanji — thay TẠI CHỖ (regex callback = đúng vị trí, không đụng cụm trùng ở nơi khác).
    out = out.replace(_NUMRUN_RE, (m, idx, full) => {
      const next = full[idx + m.length] || '';
      if (!_UNIT_AFTER.has(next)) {
        // KHÔNG kèm đơn vị phía sau → chỉ chuyển khi là SỐ THẬT: có hàng (十百千万億兆) HOẶC 〇/零 (năm kiểu 二〇二〇).
        // Giữ nguyên: 1 kanji lẻ (九州/三角形/百貨店), HOẶC chuỗi digit thuần ≥2 không hàng (一四半期, 二三="vài").
        const hasPlaceOrMaru = /[十百千万億兆〇零]/.test(m);
        if (Array.from(m).length < 2 || !hasPlaceOrMaru) return m;
      }
      return _convInt(m);
    });
    return out;
  } catch { return text; }
}

module.exports = { jaItn };
