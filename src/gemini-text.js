/**
 * gemini-text.js — Tóm tắt cuộc họp bằng Gemini, qua generateContent. Hai chế độ:
 *   • summarize()     — ROLLING (liên tục, mỗi ~2 phút): bản tóm tắt GỌN, cập nhật cuốn chiếu.
 *   • summarizeFull() — TỔNG THỂ (bấm khi họp xong): báo cáo CHI TIẾT một-lần từ TOÀN transcript.
 *
 * RPD free-tier (xem AI Studio → Rate limits, đã verify 06/2026):
 *   - gemini-3.1-flash-lite : 15 RPM · 250K TPM · 500  RPD   → CHÍNH cho rolling (chất lượng tốt nhất nhóm free)
 *   - gemma-4-31b           : 15 RPM · ∞   TPM · 1500 RPD   → fallback rolling + CHÍNH cho tổng thể (TPM ∞ hợp full transcript)
 *   - gemma-4-26b           : 15 RPM · ∞   TPM · 1500 RPD   → fallback cuối (cùng hạn mức)
 *   (gemini-2.5-flash-lite & 3.5-flash chỉ còn ~20 RPD → KHÔNG dùng).
 * Khi 1 model dính 429 (hết quota) → cooldown + tụt xuống model kế. Cộng lại ~3500 RPD: dư cho nhiều cuộc 2h/ngày.
 *
 * ROLLING: mỗi vòng chỉ gửi BẢN TÓM TẮT CŨ + CÁC CÂU MỚI (không gửi lại toàn transcript) → token nhỏ.
 * TỔNG THỂ: gửi toàn transcript 1 lần → gemma (TPM ∞), hiếm khi gọi (1 lần/cuộc) nên không lo RPD.
 * Quota tóm tắt TÁCH BIỆT với bản dịch (translate dùng Live API, RPD unlimited) → hai bên không giành nhau.
 *
 * Gemma qua Gemini API KHÔNG nhận systemInstruction (400) → ghép system vào nội dung; Gemini truyền bình thường.
 * SDK @google/genai là ESM-only → dynamic import().
 */
const state = require('./state');

// Chuỗi model theo thứ tự ưu tiên. `re` để dò id thật từ ListModels (id có thể kèm hậu tố -it/-preview…);
// `id` là phương án dự phòng nếu ListModels lỗi/không khớp. `gemma:true` → không gửi systemInstruction.
const SUMMARY_CHAIN = [
  { id: 'gemini-3.1-flash-lite', re: /gemini-3[.\-]?1-flash-lite/i, gemma: false },
  { id: 'gemma-4-31b-it',        re: /gemma-4-31b/i,                gemma: true  },
  { id: 'gemma-4-26b-it',        re: /gemma-4-26b/i,                gemma: true  },
];

let _mod = null, _chain = null;
async function _sdk() { return _mod || (_mod = await import('@google/genai')); }

function _sysSummary() {
  const L = state.transcribeMode
    ? 'the dominant language of the transcript (the language most lines are written in) — do NOT translate to any other language'
    : state.targetLangLabel;
  return `You output ONLY the meeting summary in ${L}, formatted as Markdown. No preface, no commentary, no code fences. `
    + `Keep IT/technical terms and proper nouns in their original form. Never invent content not in the transcript.`;
}

// Ngôn ngữ ĐẦU RA của bản tóm tắt:
//  - Dịch: theo ngôn ngữ ĐÍCH người dùng chọn (state.targetLangLabel).
//  - Chép lời (transcribeMode): theo NGÔN NGỮ CHIẾM ĐA SỐ trong transcript (model tự nhận) — không dịch sang ngôn ngữ khác.
//    → sau họp, đổi đích sang 1 ngôn ngữ cụ thể (transcribeMode tắt) rồi bấm Tổng thể = tóm tắt lại theo ngôn ngữ đó.
function _outLang() {
  return state.transcribeMode ? 'ngôn ngữ được nói nhiều nhất trong transcript' : state.targetLangLabel;
}
function _transcribeNote() {
  return state.transcribeMode
    ? `\n\nLƯU Ý NGÔN NGỮ: Transcript là LỜI NÓI GỐC (có thể lẫn nhiều ngôn ngữ). Viết bản tóm tắt bằng CHÍNH ngôn ngữ chiếm ĐA SỐ trong transcript; TUYỆT ĐỐI KHÔNG dịch sang ngôn ngữ khác.`
    : '';
}

// Yêu cầu tóm tắt RIÊNG do người dùng gõ trên app → chèn thêm vào prompt (giữ NGUYÊN prompt gốc + quy tắc chống bịa).
function _extraBlock() {
  const x = (state.summaryExtra || '').trim();
  if (!x) return '';
  return `\n\n## YÊU CẦU RIÊNG TỪ NGƯỜI DÙNG (ưu tiên cao — vẫn TUÂN THỦ quy tắc chống bịa & giữ thuật ngữ):\n${x}`;
}

const MAX_PREV_SUMMARY_CHARS = 6000;   // ~2K token: đủ giữ bản tóm tắt rolling nhiều mục mà vẫn nhẹ; cắt nếu phình
const MAX_NEW_CAPTIONS = 25;           // mỗi vòng rolling chỉ gửi tối đa 25 câu mới (giữ câu MỚI NHẤT) → nhẹ token
const ROLL_OUT_TOKENS = 2048;          // rolling: bản tóm tắt gọn
const FULL_OUT_TOKENS = 8192;          // tổng thể: báo cáo chi tiết toàn cuộc họp → cần dài, tránh cụt đuôi/bảng
function _trimPrev(s) {
  s = (s || '').trim(); if (s.length <= MAX_PREV_SUMMARY_CHARS) return s;
  const cut = s.slice(s.length - MAX_PREV_SUMMARY_CHARS);
  const nl = cut.indexOf('\n');   // cắt gọn ở ranh giới dòng để không vỡ Markdown giữa chừng
  return (nl > 0 ? cut.slice(nl + 1) : cut).trim();
}

// Ghép caption thành transcript. Dùng BẢN DỊCH (ngôn ngữ đích) — app không lưu transcribe gốc per-entry; fallback original.
function _toLines(captions, cap) {
  const _t = c => (c && (c.translated || c.original) || '').trim();
  let caps = (captions || []).filter(c => _t(c));
  if (cap && caps.length > cap) caps = caps.slice(caps.length - cap);
  return caps.map(c => `[${c.author || 'STT'}] ${_t(c)}`).join('\n');
}

// ── ROLLING: bản tóm tắt GỌN, cập nhật cuốn chiếu ────────────────────────────────
function _buildRollingPrompt(prevSummary, captions) {
  const lines = _toLines(captions, MAX_NEW_CAPTIONS);
  prevSummary = _trimPrev(prevSummary);
  const L = _outLang();
  const RULES =
    `Cấu trúc: ## Chủ đề chính · ## Điểm nổi bật / Vấn đề · ## Quyết định & việc cần làm (kèm người phụ trách/deadline nếu CÓ nói).\n`
    + `- GIỮ NGUYÊN thuật ngữ IT/tiếng Anh & tên riêng (bug, deploy, PR, API, sprint, merge, release...).\n`
    + `- Dùng BẢNG Markdown khi có số liệu/lịch/so sánh.\n`
    + `- KHÔNG bịa; thiếu thông tin thì để trống hoặc ghi "Chưa xác định".`
    + _transcribeNote() + _extraBlock();
  if (prevSummary && prevSummary.trim()) {
    return `Bạn đang duy trì BẢN TÓM TẮT cuộc họp ĐANG DIỄN RA (Markdown, ${L}). Dưới đây là bản tóm tắt hiện tại và `
      + `CÁC CÂU MỚI. Hãy CẬP NHẬT: gộp ý mới vào đúng mục, gộp ý trùng cho cô đọng, KHÔNG để phình dài. `
      + `Trả về TOÀN BỘ bản tóm tắt đã cập nhật, CHỈ Markdown, không lời dẫn.\n\n${RULES}\n\n`
      + `--- BẢN TÓM TẮT HIỆN TẠI ---\n${prevSummary}\n\n`
      + `--- CÁC CÂU MỚI ---\n${lines || '(không có câu mới)'}`;
  }
  return `Tóm tắt cuộc họp ĐANG DIỄN RA bằng ${L}, Markdown súc tích.\n${RULES}\n\nTranscript:\n${lines}`;
}

// ── TỔNG THỂ: prompt báo cáo chi tiết (giữ NGUYÊN VĂN) áp lên toàn transcript ─────
function _buildFullReportPrompt(captions) {
  const lines = _toLines(captions);
  const L = _outLang();
  return `Bạn là trợ lý tổng hợp cuộc họp chuyên nghiệp. Hãy tạo báo cáo cuộc họp chi tiết dạng Markdown từ phần Transcript được cung cấp ở dưới cùng.

## YÊU CẦU TRÌNH BÀY:
- Ngôn ngữ: Viết hoàn toàn bằng ${L}.
- Định dạng Markdown chuẩn: Dùng tiêu đề (## / ###), gạch đầu dòng "- " cho danh sách, in đậm **...** cho điểm quan trọng.
- Cấu trúc bắt buộc gồm các phần:
  1. Tổng quan (Thời gian, thành phần tham gia nếu có, mục đích chính).
  2. Các chủ đề chính được thảo luận.
  3. Vấn đề nổi bật / Khó khăn cần giải quyết.
  4. Quyết định / Hành động tiếp theo (Bắt buộc kèm người phụ trách & deadline nếu có nhắc tới).

## QUY TẮC THUẬT NGỮ (TUÂN THỦ TUYỆT ĐỐI):
- GIỮ NGUYÊN tiếng Anh / nguyên gốc, KHÔNG dịch sang ${L}: các thuật ngữ IT & kỹ thuật (bug, sprint, deploy, release, build, merge, PR, API, server, database, review, commit, branch, schedule, deadline, task, issue, ticket, repo, CI/CD, hotfix...), mọi từ tiếng Anh chuyên ngành và từ katakana, cùng tên riêng (người, công ty, sản phẩm, dự án, công cụ). Chỉ dịch phần diễn giải xung quanh.

## QUY TẮC BẢNG:
- Nếu nội dung có số liệu, mốc thời gian, lịch trình, so sánh, hoặc danh sách hạng mục nhiều thuộc tính → BẮT BUỘC trình bày bằng BẢNG Markdown. Ví dụ:
  | Hạng mục / Task | Người phụ trách | Trạng thái / Ghi chú / Deadline |
  | --- | --- | --- |

## NGUYÊN TẮC TRUNG THỰC:
- Tuyệt đối không tự suy diễn, không bịa thêm nội dung hoặc giả định bất kỳ thông tin nào không có sẵn trong đoạn transcript dưới đây. Nếu thông tin (như người phụ trách, deadline) không được nói rõ, hãy để trống hoặc ghi "Chưa xác định".

${_transcribeNote()}${_extraBlock()}
---
BẮT ĐẦU TRANSCRIPT CUỘC HỌP:
${lines}`;
}

// ── Dò id thật của từng model trong chuỗi (cache) ────────────────────────────────
async function _resolveChain(ai) {
  if (_chain) return _chain;
  const names = [];
  try {
    const pager = await ai.models.list();
    for await (const m of pager) {
      const name = String((m && m.name) || '').replace(/^models\//, '');
      const acts = (m && (m.supportedActions || m.supportedGenerationMethods)) || [];
      if (name && Array.isArray(acts) && acts.some(a => /generateContent/i.test(String(a)))) names.push(name);
    }
  } catch (e) { console.warn('[gemini-text] ListModels lỗi → dùng id mặc định:', e && e.message); }
  _chain = SUMMARY_CHAIN.map(c => ({ id: names.find(n => c.re.test(n)) || c.id, gemma: c.gemma }));
  console.log('[gemini-text] Summary model chain:', _chain.map(c => c.id).join(' → '));
  return _chain;
}

// ── Cooldown khi model dính 429 ──────────────────────────────────────────────────
// Hết quota/NGÀY (RPD) → nghỉ lâu (4h) để khỏi phí request dội lại suốt cuộc họp; quota/PHÚT (RPM) → nghỉ ngắn (90s).
const _cooldownUntil = {};
function _onCooldown(id) { const t = _cooldownUntil[id]; return !!t && Date.now() < t; }
function _isQuota(msg) { return /\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg); }
function _setCooldown(id, msg) {
  const daily = /per\s*day|perday|daily|RequestsPerDay/i.test(msg);
  _cooldownUntil[id] = Date.now() + (daily ? 4 * 3600e3 : 90e3);
}

// withSys=false → gửi prompt NGUYÊN VĂN (không chèn systemInstruction) — dùng cho prompt tổng thể tự chứa đủ chỉ dẫn.
async function _generate(ai, entry, prompt, { withSys = true, maxOut = ROLL_OUT_TOKENS } = {}) {
  const config = { temperature: 0.3, maxOutputTokens: maxOut };
  let contents = prompt;
  if (withSys) {
    const sys = _sysSummary();
    if (entry.gemma) contents = sys + '\n\n' + prompt;   // Gemma không nhận systemInstruction → ghép vào nội dung
    else config.systemInstruction = sys;
  }
  const res = await ai.models.generateContent({ model: entry.id, contents, config });
  return (res && (typeof res.text === 'string' ? res.text : (res.text && res.text()))) || '';
}

// Thử lần lượt theo `chain`; 429/404/lỗi → tụt model kế. Trả { ok, markdown, model } | { ok:false, error }.
async function _runChain(ai, chain, prompt, opts) {
  let lastErr = 'no-model', skippedAll = true;
  for (const entry of chain) {
    if (_onCooldown(entry.id)) continue;
    skippedAll = false;
    try {
      const text = await _generate(ai, entry, prompt, opts);
      if (text && text.trim()) return { ok: true, markdown: text.trim(), model: entry.id };
      lastErr = 'empty-response';
    } catch (e) {
      const msg = (e && e.message) || String(e);
      lastErr = msg;
      if (_isQuota(msg)) { _setCooldown(entry.id, msg); console.warn(`[gemini-text] ${entry.id} 429/quota → fallback`); continue; }
      if (/not found|not supported|404/i.test(msg)) { console.warn(`[gemini-text] ${entry.id} không khả dụng → fallback`); continue; }
      console.warn(`[gemini-text] ${entry.id} lỗi: ${msg} → thử model kế`);   // lỗi khác (mạng…) → vẫn thử model kế
    }
  }
  // Tất cả đang cooldown → thử model CUỐI bỏ qua cooldown (đề phòng cooldown đặt nhầm)
  if (skippedAll && chain.length) {
    const last = chain[chain.length - 1];
    try {
      const text = await _generate(ai, last, prompt, opts);
      if (text && text.trim()) return { ok: true, markdown: text.trim(), model: last.id };
    } catch (e) { lastErr = (e && e.message) || String(e); }
  }
  return { ok: false, error: lastErr };
}

async function _ai() {
  const { GoogleGenAI } = await _sdk();
  return new GoogleGenAI({ apiKey: String(state.apiKey).trim() });
}

// ROLLING. payload: { prevSummary, captions }. Trả { ok, markdown } | { ok:false, error }.
async function summarize(payload) {
  const prevSummary = (payload && payload.prevSummary) || '';
  const captions = (payload && payload.captions) || (Array.isArray(payload) ? payload : []);
  if (!state.apiKey || !String(state.apiKey).trim()) return { ok: false, error: 'no-key' };
  if ((!captions || !captions.length) && !prevSummary) return { ok: false, error: 'empty' };
  const prompt = _buildRollingPrompt(prevSummary, captions);
  const ai = await _ai();
  const chain = await _resolveChain(ai);
  return _runChain(ai, chain, prompt, { withSys: true, maxOut: ROLL_OUT_TOKENS });
}

// TỔNG THỂ. captions: toàn cuộc họp. Báo cáo chi tiết 1-lần → gemma-4-31b (→ 26b dự phòng), prompt NGUYÊN VĂN.
async function summarizeFull(captions) {
  captions = captions || [];
  if (!state.apiKey || !String(state.apiKey).trim()) return { ok: false, error: 'no-key' };
  if (!captions.length) return { ok: false, error: 'empty' };
  const prompt = _buildFullReportPrompt(captions);
  const ai = await _ai();
  const chain = await _resolveChain(ai);
  const gemma = chain.filter(c => c.gemma);   // [gemma-4-31b, gemma-4-26b]: TPM ∞ + RPD 1500, hợp full transcript
  return _runChain(ai, gemma.length ? gemma : chain, prompt, { withSys: false, maxOut: FULL_OUT_TOKENS });
}

module.exports = { summarize, summarizeFull };
