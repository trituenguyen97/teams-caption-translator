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
  return `You output ONLY the meeting summary in ${state.targetLangLabel}, formatted as Markdown. No preface, no commentary, no code fences. `
    + `Keep IT/technical terms and proper nouns in their original form. Never invent content not in the transcript.`;
}

// Ngôn ngữ ĐẦU RA của bản tóm tắt = ngôn ngữ ĐÍCH người dùng chọn (chế độ chép lời đã gỡ).
function _outLang() {
  return state.targetLangLabel;
}
function _transcribeNote() { return ''; }

// Yêu cầu tóm tắt RIÊNG do người dùng gõ trên app → chèn thêm vào prompt (giữ NGUYÊN prompt gốc + quy tắc chống bịa).
function _extraBlock() {
  const x = (state.summaryExtra || '').trim();
  if (!x) return '';
  return `\n\n## YÊU CẦU RIÊNG TỪ NGƯỜI DÙNG (ƯU TIÊN CAO NHẤT — GHI ĐÈ mọi quy tắc & ngôn ngữ mặc định ở trên, kể cả tiêu đề mục; CHỈ giữ quy tắc chống bịa):\n${x}`;
}

const MAX_PREV_SUMMARY_CHARS = 6000;   // ~2K token: đủ giữ bản tóm tắt rolling nhiều mục mà vẫn nhẹ; cắt nếu phình
const MAX_NEW_CAPTIONS = 250;          // incremental report: gửi tới 250 câu mới/vòng (giữ câu MỚI NHẤT) — đủ phủ burst, token vẫn nhẹ
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
    + `- Từ KATAKANA tiếng Nhật (thường là từ mượn tiếng Anh: thuật ngữ chuyên ngành, tên sản phẩm/công cụ) → ghi BẰNG TIẾNG ANH gốc (vd デプロイ→deploy, スケジュール→schedule, アジェンダ→agenda), KHÔNG dịch/phiên âm sang ${L}.\n`
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
- GIỮ NGUYÊN tiếng Anh / nguyên gốc, KHÔNG dịch sang ${L}: các thuật ngữ IT & kỹ thuật (bug, sprint, deploy, release, build, merge, PR, API, server, database, review, commit, branch, schedule, deadline, task, issue, ticket, repo, CI/CD, hotfix...), mọi từ tiếng Anh chuyên ngành, cùng tên riêng (người, công ty, sản phẩm, dự án, công cụ). Chỉ dịch phần diễn giải xung quanh.
- Riêng từ KATAKANA tiếng Nhật (phần lớn là từ mượn tiếng Anh) → KHÔI PHỤC về TIẾNG ANH gốc (vd デプロイ→deploy, スケジュール→schedule, アジェンダ→agenda, リリース→release), KHÔNG phiên âm hay dịch sang ${L} (giữ thuật ngữ chuyên ngành khỏi loạn nghĩa).

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

// ── TỔNG THỂ CÓ CẤU TRÚC (JSON landing-page) → renderer client dựng HTML đẹp ──────
// Schema 5 phần: hero (headline/sub/4 stats/meta) · problem (thách thức↔giải pháp) · bento (chủ đề) · actions · roadmap.
// Chỉ flash-lite (JSON schema chuẩn); thất bại → caller fallback summarizeFull (markdown).
const _S = { type: 'STRING' };
const _SN = { type: 'STRING', nullable: true };
const _STRS = { type: 'ARRAY', items: _S };
const _STAT = { type: 'OBJECT', properties: { value: _S, label: _S }, required: ['value', 'label'], propertyOrdering: ['value', 'label'] };
const _META = { type: 'OBJECT', properties: { label: _S, value: _S }, required: ['label', 'value'], propertyOrdering: ['label', 'value'] };
const _HERO = { type: 'OBJECT', properties: { eyebrow: _SN, headline: _S, subhead: _S, stats: { type: 'ARRAY', items: _STAT }, meta: { type: 'ARRAY', items: _META } }, required: ['headline', 'subhead'], propertyOrdering: ['eyebrow', 'headline', 'subhead', 'stats', 'meta'] };
const _SIDE = { type: 'OBJECT', properties: { title: _S, points: _STRS }, required: ['title', 'points'], propertyOrdering: ['title', 'points'] };
const _PROBLEM = { type: 'OBJECT', nullable: true, properties: { challenge: _SIDE, solution: _SIDE }, propertyOrdering: ['challenge', 'solution'] };
const _BENTO = { type: 'OBJECT', properties: { icon: _SN, title: _S, points: _STRS, conclusion: _SN }, required: ['title', 'points'], propertyOrdering: ['icon', 'title', 'points', 'conclusion'] };
const _ACTION = { type: 'OBJECT', properties: { task: _S, owner: _SN, due: _SN, priority: { type: 'STRING', enum: ['high', 'mid', 'low'], nullable: true } }, required: ['task'], propertyOrdering: ['task', 'owner', 'due', 'priority'] };
const _STEP = { type: 'OBJECT', properties: { time: _SN, title: _S, desc: _SN }, required: ['title'], propertyOrdering: ['time', 'title', 'desc'] };
const _LABELS = { type: 'OBJECT', nullable: true, properties: { problem: _SN, bento: _SN, actions: _SN, roadmap: _SN }, propertyOrdering: ['problem', 'bento', 'actions', 'roadmap'] };
const REPORT_SCHEMA = { type: 'OBJECT', properties: { hero: _HERO, labels: _LABELS, problem: _PROBLEM, bento: { type: 'ARRAY', items: _BENTO }, actions: { type: 'ARRAY', items: _ACTION }, roadmap: { type: 'ARRAY', items: _STEP }, footer: _SN }, required: ['hero'], propertyOrdering: ['hero', 'labels', 'problem', 'bento', 'actions', 'roadmap', 'footer'] };

// Khối "dữ kiện đã biết" (ngày/thời lượng/người/số dòng) — chính xác từ app → hero.meta & stats không bịa.
function _factsBlock(facts) {
  if (!facts) return '';
  const f = [];
  if (facts.date) f.push(`Ngày họp: ${facts.date}`);
  if (facts.duration) f.push(`Thời lượng: ${facts.duration}`);
  if (facts.participants && facts.participants.length) f.push(`Người tham gia (${facts.participants.length}): ${facts.participants.join(', ')}`);
  if (facts.lineCount) f.push(`Số dòng transcript: ${facts.lineCount}`);
  if (!f.length) return '';
  return `\n\nDỮ KIỆN ĐÃ BIẾT (CHÍNH XÁC — ưu tiên dùng cho hero.meta & hero.stats; ĐỪNG mâu thuẫn với nó):\n- ${f.join('\n- ')}`;
}
// Quy tắc điền 5 phần — dùng chung cho cả tạo MỚI lẫn CẬP NHẬT (incremental).
function _reportRules(L) {
  return `CÁCH ĐIỀN 5 PHẦN:
- hero.eyebrow: nhãn ngắn IN HOA kiểu "BÁO CÁO CUỘC HỌP". hero.headline: MỘT câu khẩu hiệu cô đọng kết quả/mục đích lớn nhất — bọc cụm từ THEN CHỐT trong **...** để được tô màu nhấn. hero.subhead: 2-3 câu bối cảnh/lý do.
- hero.stats: ĐÚNG 4 thẻ số liệu quan trọng nhất {value, label} — value là CON SỐ/đại lượng NGẮN (vd "3", "85%", "2 tuần", "45 phút"), label là nhãn ngắn. Thiếu số liệu thật thì dùng chỉ số ĐẾM ĐƯỢC (số chủ đề, số việc cần làm, số người, thời lượng). KHÔNG bịa số.
- hero.meta: 3-4 mục {label, value} tổng quan (Ngày, Thời lượng, Số người, Định dạng). Dùng "DỮ KIỆN ĐÃ BIẾT" nếu có; không rõ → "Chưa xác định".
- labels: nhãn eyebrow IN HOA (bằng ${L}) cho 4 mục — problem≈"VẤN ĐỀ CỐT LÕI", bento≈"CHỦ ĐỀ CHÍNH", actions≈"VIỆC CẦN LÀM", roadmap≈"LỘ TRÌNH".
- problem: {challenge:{title,points[]}, solution:{title,points[]}} = Thách thức hiện tại ↔ Giải pháp đề xuất; mỗi bên 2-4 gạch đầu dòng. KHÔNG có nội dung tương phản rõ → để null.
- bento: 3-4 khối CHỦ ĐỀ chính {icon (đúng 1 emoji), title, points (2-3), conclusion}. conclusion = một câu "Đồng thuận/Kết luận" của khối (bỏ trống nếu chưa chốt).
- actions: việc cần làm {task, owner, due, priority ("high"|"mid"|"low")}. owner/due CHỈ điền khi transcript NÓI RÕ, không thì để null. Việc dang dở/chưa kết luận → vẫn đưa vào với priority "high".
- roadmap: các bước tiếp theo {time, title, desc} theo trình tự thời gian. Không có lộ trình rõ → mảng rỗng.
- footer: một dòng disclaimer ngắn (bản tóm tắt tự động từ transcript, kèm ngày nếu biết).

TRUNG THỰC: chỉ thêm phần/khối CÓ nội dung THẬT; phần rỗng → mảng rỗng hoặc null. TUYỆT ĐỐI KHÔNG BỊA chủ đề/quyết định/người/deadline/số liệu không có trong transcript. Transcript quá ngắn → chỉ điền hero (headline+subhead mô tả thực tế) + để các mảng rỗng.
THUẬT NGỮ: GIỮ NGUYÊN tiếng Anh/nguyên gốc thuật ngữ IT & tên riêng (bug, deploy, PR, API, sprint, release, CRM, ERP...). KATAKANA tiếng Nhật → khôi phục TIẾNG ANH gốc (デプロイ→deploy...), KHÔNG dịch sang ${L}.`;
}
// prevReport != null → INCREMENTAL: gửi báo cáo cũ (JSON) + CHỈ câu mới. App hiện CHỈ gọi full (prevReport=null).
function _buildReportPrompt(captions, facts, prevReport) {
  const cap = prevReport ? MAX_NEW_CAPTIONS : 0;
  const lines = _toLines(captions, cap || undefined);
  const L = _outLang();
  const head = prevReport
    ? `Bạn là chuyên gia thiết kế nội dung kiêm thư ký cuộc họp. Bạn đang DUY TRÌ báo cáo cuộc họp ĐANG DIỄN RA (JSON landing-page). Dưới đây là BÁO CÁO HIỆN TẠI (JSON) + CÁC CÂU MỚI. CẬP NHẬT báo cáo: gộp thông tin mới vào ĐÚNG phần (hero/problem/bento/actions/roadmap), gộp ý trùng cho cô đọng, GIỮ NGUYÊN nội dung cũ còn đúng (đừng xoá), cập nhật hero.stats & hero.meta theo dữ kiện mới. Trả về TOÀN BỘ báo cáo JSON đã cập nhật, ĐÚNG schema.`
    : `Bạn là chuyên gia thiết kế nội dung kiêm thư ký cuộc họp. Đọc TRANSCRIPT ở cuối và xuất BÁO CÁO cuộc họp dưới dạng JSON ĐÚNG theo schema được áp đặt — sẽ được render thành 1 trang landing-page.`;
  const tail = prevReport
    ? `\n--- BÁO CÁO HIỆN TẠI (JSON) ---\n${JSON.stringify(prevReport)}\n\n--- CÁC CÂU MỚI ---\n${lines || '(không có câu mới)'}`
    : `\n---\nTRANSCRIPT:\n${lines}`;
  return `${head}

NGÔN NGỮ: viết MỌI chuỗi (headline, subhead, eyebrow, label, value, title, points, conclusion, task, owner, due, time, desc, footer...) bằng ${L}.

${_reportRules(L)}
${_factsBlock(facts)}${_transcribeNote()}${_extraBlock()}${tail}`;
}

function _parseJson(t) {
  if (!t) return null;
  t = String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}

// Trả { ok, report } | { ok:false, error }. report = object theo REPORT_SCHEMA (landing-page).
// facts = {date,duration,participants,lineCount} (neo hero.meta/stats); prevReport = null → tạo full.
async function summarizeReport(captions, facts, prevReport) {
  captions = captions || [];
  if (!state.apiKey || !String(state.apiKey).trim()) return { ok: false, error: 'no-key' };
  if (!captions.length) return { ok: false, error: 'empty' };
  const ai = await _ai();
  const chain = await _resolveChain(ai);
  const prompt = _buildReportPrompt(captions, facts, prevReport);
  let lastErr = 'structured-failed';
  for (const entry of chain.filter(c => !c.gemma)) {   // chỉ flash-lite: JSON schema chuẩn
    if (_onCooldown(entry.id)) continue;
    try {
      const config = { temperature: 0.3, maxOutputTokens: FULL_OUT_TOKENS, responseMimeType: 'application/json', responseSchema: REPORT_SCHEMA, thinkingConfig: { thinkingBudget: 0 } };
      const res = await ai.models.generateContent({ model: entry.id, contents: prompt, config });
      const text = (res && (typeof res.text === 'string' ? res.text : (res.text && res.text()))) || '';
      const obj = _parseJson(text);
      if (obj && obj.hero && obj.hero.headline) return { ok: true, report: obj, model: entry.id };
      lastErr = 'empty-or-invalid-json';
    } catch (e) {
      const msg = (e && e.message) || String(e); lastErr = msg;
      if (_isQuota(msg)) _setCooldown(entry.id, msg);
      console.warn(`[gemini-text] report ${entry.id}: ${msg}`);
    }
  }
  return { ok: false, error: lastErr };
}

// ══ TỔNG THỂ CAO CẤP: gemini-4-hydrogen (5 RPM · 20 RPD) ═══════════════════════════════════════
// 1 lượt → { markdown: biên bản chuyên nghiệp, html: trang báo cáo trực quan DO MODEL TỰ THIẾT KẾ (CSS + SVG nội tuyến) }.
// Không còn template cố định ở client. Panel hiển thị html trong iframe sandbox (không script) + nút đổi HTML↔MD.
// Đếm lượt CỤC BỘ (API không trả quota còn lại): chỉ tăng khi request tới được model; 429-per-day → đánh dấu hết.
// Ngày quota reset theo nửa đêm giờ Pacific (chuẩn Gemini API).
const Store = require('./store');
const HYDROGEN = { id: 'gemini-4-hydrogen', rpd: 20 };
function _ptDay() { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } }
function hydrogenQuota() {
  const q = Store.get('hydrogenQuota', null);
  const used = (q && q.day === _ptDay()) ? Math.min(HYDROGEN.rpd, q.used | 0) : 0;
  return { used, limit: HYDROGEN.rpd, remaining: HYDROGEN.rpd - used };
}
function _setHydrogenUsed(used) { Store.set('hydrogenQuota', { day: _ptDay(), used: Math.min(HYDROGEN.rpd, used) }); }

// Schema 2 chuỗi: markdown TRƯỚC (đặt cuối thì model hay bỏ trống), html SAU. Không template cố định — model tự thiết kế trang.
const OVERALL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    markdown: { type: 'STRING', description: 'Biên bản cuộc họp dạng văn bản Markdown nhiều dòng, bắt đầu bằng "# ". KHÔNG phải JSON.' },
    html: { type: 'STRING', description: 'Một tài liệu HTML5 hoàn chỉnh, tự chứa (<!doctype html>…</html>), CSS nội tuyến trong <style>, biểu đồ/sơ đồ bằng SVG nội tuyến. KHÔNG có <script>.' },
  },
  required: ['markdown', 'html'],
  propertyOrdering: ['markdown', 'html'],
};
function _buildOverallPrompt(captions, facts) {
  const L = _outLang();
  return `Bạn là chuyên gia phân tích cuộc họp kiêm nhà thiết kế thông tin (information designer). Đọc TRANSCRIPT ở cuối (cuộc họp ĐÃ KẾT THÚC) và trả JSON gồm 2 chuỗi: "markdown" và "html".

NGÔN NGỮ: toàn bộ nội dung viết bằng ${L}.

THUẬT NGỮ: GIỮ NGUYÊN tiếng Anh/nguyên gốc thuật ngữ IT & tên riêng (bug, deploy, PR, API, sprint, release...). KATAKANA tiếng Nhật → khôi phục TIẾNG ANH gốc (デプロイ→deploy...), không dịch.
TRUNG THỰC: chỉ dùng thông tin CÓ trong transcript. KHÔNG bịa người/deadline/số liệu/quyết định. Không rõ → "Chưa xác định". Số liệu trên biểu đồ phải đếm/ước lượng được từ transcript (vd số việc theo người/ưu tiên, tỉ trọng thảo luận theo chủ đề) — ghi rõ khi là ước lượng.

━━ 1) "markdown" — BIÊN BẢN CUỘC HỌP CHUYÊN NGHIỆP ━━
# <Tiêu đề cuộc họp>
Dòng thông tin: ngày · thời lượng · thành phần (nếu biết)
## 1. Tóm tắt điều hành (3-5 câu)
## 2. Nội dung thảo luận (### theo từng chủ đề, gạch đầu dòng, **in đậm** ý chính)
## 3. Quyết định đã thống nhất (bảng | # | Quyết định | Lý do | Phụ trách |)
## 4. Việc cần làm (bảng | # | Việc | Phụ trách | Hạn | Ưu tiên |)
## 5. Rủi ro & vấn đề còn mở
## 6. Bước tiếp theo
Mục không có nội dung → ghi "Không có".

━━ 2) "html" — BÁO CÁO TRỰC QUAN (một trang, bạn TỰ THIẾT KẾ) ━━
Mục tiêu: người đọc nắm cuộc họp trong 30 giây. TRỰC QUAN hơn CHỮ: ưu tiên thẻ số liệu, biểu đồ, sơ đồ, timeline, bảng, badge — chữ ngắn gọn (gạch đầu dòng ≤ 15 từ); chi tiết dài để ở markdown.
THÍCH ỨNG THEO NỘI DUNG — mọi phần bên dưới là TUỲ CHỌN, CHỈ đưa vào khi transcript có dữ liệu THẬT cho nó. Thà ít phần mà đúng còn hơn đủ phần mà gượng. Họp trao đổi thuần (không số liệu/quy trình) → trang gọn: mở đầu + chủ đề + quyết định/việc cần làm là đủ, KHÔNG vẽ biểu đồ/sơ đồ cho có. TUYỆT ĐỐI không tạo biểu đồ từ số bịa, không chia % khi chỉ có 1-2 chủ đề, không vẽ sơ đồ luồng khi cuộc họp không bàn một quy trình/chuỗi bước cụ thể.
Các phần có thể dùng (theo thứ tự, đánh số mục 1, 2, 3…):
- Đầu trang: tiêu đề cuộc họp + 1 câu kết quả chính + 1 dòng thông tin (ngày · thời lượng · thành phần) dạng chữ thường, phân cách bằng dấu "·". Ngay dưới: dải 3-4 chỉ số (con số lớn + nhãn nhỏ) đặt cạnh nhau, phân cách bằng đường kẻ dọc mảnh — KHÔNG đóng khung từng chỉ số.
- 0-3 BIỂU ĐỒ SVG nội tuyến — CHỈ khi có ≥3 điểm dữ liệu có ý nghĩa (số liệu thật trong họp; ≥3 chủ đề rõ rệt → thanh ngang tỉ trọng; ≥3 việc có người phụ trách → cột theo người). Nhãn + giá trị + chú thích nguồn ("ước lượng theo số câu" nếu là ước lượng).
- 0-1 SƠ ĐỒ (SVG) — CHỈ khi cuộc họp THỰC SỰ bàn một quy trình/chuỗi bước/luồng quyết định: hộp chữ nhật viền mảnh + mũi tên, nút quyết định hình thoi.
- Nội dung thảo luận: mỗi chủ đề = tiêu đề phụ + 2-3 gạch đầu dòng ngắn + 1 dòng "Kết luận: …" (chữ đậm cho từ "Kết luận", phần sau chữ thường) — trình bày dạng văn bản liền mạch, KHÔNG đặt trong thẻ/khung.
- Quyết định đã chốt và Việc cần làm: dạng BẢNG (# · nội dung · phụ trách · hạn · ưu tiên). Ưu tiên ghi bằng CHỮ ("Cao/Trung bình/Thấp"), chỉ mức "Cao" được tô màu accent; không dùng badge/viên thuốc.
- Rủi ro / vấn đề mở: danh sách hoặc bảng (vấn đề · mức độ · hướng xử lý). Bước tiếp theo: danh sách đánh số theo mốc thời gian (chỉ khi có ≥2 mốc cụ thể).
- Nếu yêu cầu riêng của người dùng không khớp nội dung transcript: ghi 1 câu ghi chú ngắn ở đầu phần Tóm tắt (chữ nghiêng, màu xám) — KHÔNG làm banner/hộp cảnh báo màu.

PHONG CÁCH THIẾT KẾ — "báo cáo doanh nghiệp / tư vấn" (tối giản, nghiêm túc, giống tài liệu in), TUÂN THỦ CHÍNH XÁC:
- Màu (chỉ dùng đúng các mã này): chữ chính #1F2328 · chữ phụ #57606A · đường kẻ #D0D7DE · nền trang #FFFFFF · nền xen kẽ hàng bảng/khối nhẹ #F6F8FA · DUY NHẤT 1 màu accent #1F4E79 (xanh navy), dùng TIẾT KIỆM: số liệu chính, tiêu đề mục, ưu tiên "Cao", 1 chuỗi màu biểu đồ. Biểu đồ: accent + các sắc độ xám (#8C959F, #C9D1D9). Tuyệt đối không thêm màu khác (không cam/đỏ/tím/xanh lá, không gradient).
- Chữ: font-family system-ui,"Segoe UI",Roboto,Arial,sans-serif. Tiêu đề trang 26px/600; tiêu đề mục 17px/600 có số thứ tự ("1. Tóm tắt"), viền dưới 1px #D0D7DE; nội dung 14.5px/1.6. Số liệu chính 28px/600 màu accent, dùng font-variant-numeric:tabular-nums.
- Bố cục: 1 cột chính max-width 960px, căn giữa, lề rộng; phân tách các mục bằng KHOẢNG TRẮNG (32-40px) và đường kẻ ngang mảnh — KHÔNG dùng thẻ (card) có bóng đổ. Lưới 2 cột chỉ dùng cho biểu đồ đặt cạnh nhau (khung hẹp → 1 cột).
- Bảng: viền ngang 1px #D0D7DE, không viền dọc, tiêu đề cột chữ 12.5px in đậm màu #57606A (không nền màu đậm), hàng xen kẽ #F6F8FA.
- CẤM (các mẫu "trông như AI sinh ra"): thẻ bo góc lớn có bóng đổ; viền màu dày bên trái khối (border-left accent) cho kết luận/ghi chú; nhãn hình viên thuốc (pill/badge) cho tag, ngày, trạng thái; icon emoji trong tiêu đề/thẻ; banner cảnh báo màu cam/vàng; gradient, glow, đổ bóng; chữ in hoa giãn cách làm nhãn trang trí; nhiều màu nhấn. Bo góc tối đa 4px (chỉ cho khối biểu đồ nếu cần).
- @media print: nền trắng, không ngắt giữa bảng/biểu đồ (break-inside:avoid).

Yêu cầu kỹ thuật BẮT BUỘC:
- Tài liệu HTML5 HOÀN CHỈNH, TỰ CHỨA: <!doctype html><html lang="…"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>…</title><style>…</style></head><body>…</body></html>.
- TUYỆT ĐỐI KHÔNG dùng <script>, thuộc tính sự kiện (onclick…), iframe, form, hay tài nguyên ngoài (ảnh/CDN/font từ mạng) — trang hiển thị trong khung KHÔNG chạy JavaScript và phải xem được offline.
- Biểu đồ/sơ đồ: SVG nội tuyến có viewBox, width:100% height:auto.
- Responsive: đọc tốt ở khung hẹp ~420px (panel cạnh) lẫn màn rộng.
- KHÔNG được tràn ngang: *{box-sizing:border-box}, phần tử flex/grid con đặt min-width:0, chữ dài cho xuống dòng (overflow-wrap:anywhere), bảng rộng bọc trong khung overflow-x:auto.
${_factsBlock(facts)}${_transcribeNote()}${_extraBlock()}
---
TRANSCRIPT:
${_toLines(captions)}`;
}
// Gỡ phần chạy được khỏi HTML do model sinh (phòng thủ thêm — iframe đã sandbox không script; file xuất ra mở bằng trình duyệt).
function _sanitizeHtml(h) {
  return String(h || '').normalize('NFC')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/<(iframe|object|embed|form)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    .trim();
}
// Trả { ok, report, model, quota } | { ok:false, error, quota }. error 'quota-exhausted' → caller fallback flash-lite/gemma.
async function summarizeOverall(captions, facts) {
  captions = captions || [];
  if (!state.apiKey || !String(state.apiKey).trim()) return { ok: false, error: 'no-key', quota: hydrogenQuota() };
  if (!captions.length) return { ok: false, error: 'empty', quota: hydrogenQuota() };
  if (hydrogenQuota().remaining <= 0) return { ok: false, error: 'quota-exhausted', quota: hydrogenQuota() };
  const ai = await _ai();
  const prompt = _buildOverallPrompt(captions, facts);
  let lastErr = 'failed';
  for (let attempt = 0; attempt < 3; attempt++) {   // 503 (quá tải) → thử lại sau 3s/8s; KHÔNG tính lượt khi lỗi
    try {
      const config = { temperature: 0.3, maxOutputTokens: 32768, responseMimeType: 'application/json', responseSchema: OVERALL_SCHEMA };
      const res = await ai.models.generateContent({ model: HYDROGEN.id, contents: prompt, config });
      _setHydrogenUsed(hydrogenQuota().used + 1);   // request đã tới model & trả về → đã tiêu 1 lượt RPD
      const text = (res && (typeof res.text === 'string' ? res.text : (res.text && res.text()))) || '';
      const obj = _parseJson(text) || {};
      const html = _sanitizeHtml(obj.html);
      let markdown = typeof obj.markdown === 'string' ? obj.markdown.trim() : '';
      const hi = markdown.indexOf('#'); if (hi > 0 && hi < 200) markdown = markdown.slice(hi);   // bỏ câu dẫn trước tiêu đề
      if (!/<html[\s>]/i.test(html) && markdown.length < 100) return { ok: false, error: 'empty-or-invalid-output', quota: hydrogenQuota() };
      return { ok: true, report: { html: /<html[\s>]/i.test(html) ? html : '', markdown, model: HYDROGEN.id }, model: HYDROGEN.id, quota: hydrogenQuota() };
    } catch (e) {
      const msg = (e && e.message) || String(e); lastErr = msg;
      console.warn(`[gemini-text] hydrogen (lần ${attempt + 1}): ${msg}`);
      if (_isQuota(msg)) { if (/per\s*day|perday|daily|RequestsPerDay/i.test(msg)) _setHydrogenUsed(HYDROGEN.rpd); return { ok: false, error: 'quota-exhausted', quota: hydrogenQuota() }; }
      if (!/\b503\b|UNAVAILABLE|overloaded|high demand|\b500\b|INTERNAL/i.test(msg)) break;
      await new Promise(r => setTimeout(r, attempt ? 8000 : 3000));
    }
  }
  return { ok: false, error: lastErr, quota: hydrogenQuota() };
}

// ══ ARTIFACT (mức 2 + 3): trang TƯƠNG TÁC có JavaScript + chế độ TRÌNH CHIẾU — tạo theo yêu cầu, 1 lượt Hydrogen ══
// Đầu vào = biên bản Markdown đã có (nhẹ hơn transcript). Chạy trong iframe sandbox="allow-scripts" (KHÔNG allow-same-origin
// → origin rỗng, không chạm app/API key) + CSP chặn mọi kết nối mạng. Client bơm thêm bộ dò lỗi → JS hỏng thì báo & cho tạo lại.
const ARTIFACT_SCHEMA = { type: 'OBJECT', properties: { html: { type: 'STRING', description: 'Một tài liệu HTML5 hoàn chỉnh, tự chứa, có <script> JavaScript thuần nội tuyến.' } }, required: ['html'] };
function _buildArtifactPrompt(markdown, facts) {
  const L = _outLang();
  return `Bạn là kỹ sư front-end kiêm nhà thiết kế thông tin. Từ BIÊN BẢN CUỘC HỌP (Markdown) ở cuối, viết MỘT trang web tương tác tự chứa ("artifact") giúp xem lại cuộc họp. Trả JSON {"html": "..."}.

NGÔN NGỮ giao diện & nội dung: ${L}. Chỉ dùng thông tin CÓ trong biên bản — không bịa.

CHỨC NĂNG (chỉ làm phần có dữ liệu thật):
1. Thanh điều hướng trên cùng: tên cuộc họp + các tab (Tổng quan · Thảo luận · Quyết định · Việc cần làm · Rủi ro) chuyển nội dung không tải lại trang; nút "▶ Trình chiếu".
2. Tổng quan: 3-4 chỉ số chính (đếm từ biên bản) có hiệu ứng đếm số tăng dần khi mở; 1 câu tóm tắt.
3. Thảo luận: các chủ đề dạng mục thu gọn/mở rộng (accordion) có chuyển động mượt; ô TÌM KIẾM lọc theo từ khoá và tô sáng chỗ khớp.
4. Việc cần làm: bảng SẮP XẾP được khi bấm tiêu đề cột; bộ lọc theo người phụ trách và mức ưu tiên; ô tick "đã xong" (gạch ngang dòng, cập nhật bộ đếm "x/y việc đã xong" — chỉ giữ trong bộ nhớ trang).
5. Biểu đồ vẽ bằng SVG/JS (KHÔNG thư viện) khi có ≥3 điểm dữ liệu thật (vd số việc theo người phụ trách / theo ưu tiên): thanh có hiệu ứng mọc lên, rê chuột hiện tooltip giá trị. Không đủ dữ liệu → không vẽ.
6. TRÌNH CHIẾU (motion): bấm "▶ Trình chiếu" → phủ toàn màn hình, mỗi slide 1 ý lớn (Tóm tắt → từng Quyết định → Việc cần làm → Bước tiếp theo), chuyển slide bằng ← → / Space / click, Esc để thoát; hiệu ứng chuyển trượt + mờ dần, các dòng trên slide hiện lần lượt; thanh tiến độ mảnh ở đáy; nút tự chạy (mỗi slide ~6s).
7. Tôn trọng @media (prefers-reduced-motion: reduce): tắt/giảm chuyển động.

THIẾT KẾ — tối giản kiểu báo cáo doanh nghiệp (giống bản HTML tĩnh): màu chữ #1F2328, chữ phụ #57606A, kẻ #D0D7DE, nền #FFFFFF / #F6F8FA, DUY NHẤT 1 accent #1F4E79. Font system-ui,"Segoe UI",Roboto,Arial,sans-serif. Bo góc ≤ 6px, không bóng đổ đậm, không gradient, không emoji, không viền màu bên trái khối, không pill/badge nhiều màu. Chuyển động tinh tế (150-400ms, ease-out). Trình chiếu: nền #1F2328 chữ trắng, accent #8AB4E0.
Responsive: dùng tốt ở khung hẹp ~420px (panel cạnh) lẫn toàn màn hình. Không tràn ngang (*{box-sizing:border-box}, min-width:0, overflow-wrap:anywhere, bảng rộng bọc overflow-x:auto).

KỸ THUẬT BẮT BUỘC:
- MỘT file HTML5 hoàn chỉnh: <!doctype html>…<style>…</style>…<script>…</script>. JavaScript thuần (ES2020), bọc trong try/catch ở hàm khởi tạo; dữ liệu cuộc họp nhúng sẵn dạng 1 object JS (const DATA = {...}) rồi render từ đó.
- TUYỆT ĐỐI KHÔNG: tải tài nguyên ngoài (script/CSS/font/ảnh từ mạng, CDN), fetch/XMLHttpRequest/WebSocket/EventSource, localStorage/sessionStorage/cookie/indexedDB (trang chạy ở origin rỗng → các API này sẽ lỗi), alert/confirm/prompt, window.open, eval/new Function, iframe/form.
- Trang phải hiển thị đầy đủ nội dung chính ngay cả trước khi JS chạy xong (nội dung tĩnh trong HTML hoặc render đồng bộ khi tải).
${_factsBlock(facts)}${_extraBlock()}
---
BIÊN BẢN CUỘC HỌP (Markdown):
${markdown}`;
}
// ── SLIDE: bộ trình chiếu kiểu "Claude Design" — design system cố định (terracotta + nền kem giấy + chữ mực),
//    bộ mẫu bố cục slide, chuyển động tinh tế, lời thoại người trình bày (phím N), in PDF mỗi slide 1 trang.
// Font có chân cho tiêu đề theo NGÔN NGỮ ĐÍCH — font Nhật (Yu Mincho) không ghép được dấu chồng tiếng Việt (ầ, ỗ…).
function _serifStack() {
  const c = state.langCode;
  if (c === 'ja') return '"Yu Mincho","Hiragino Mincho ProN","Noto Serif JP",serif';
  if (c === 'ko') return '"Batang","Noto Serif KR",serif';
  if (c === 'zh') return '"SimSun","Songti SC","Noto Serif SC",serif';
  return '"Cambria","Noto Serif","Times New Roman",serif';   // vi/en: Cambria/Times dựng sẵn đủ dấu tiếng Việt
}
function _buildSlidesPrompt(markdown, facts) {
  const L = _outLang();
  return `Bạn là nhà thiết kế trình chiếu chuyên nghiệp. Từ BIÊN BẢN CUỘC HỌP (Markdown) ở cuối, tạo MỘT bộ slide HTML tự chứa để trình bày lại cuộc họp cho người không dự (sếp/khách/đồng nghiệp). Trả JSON {"html": "..."}.

NGÔN NGỮ: ${L}. Chỉ dùng thông tin CÓ trong biên bản — không bịa số liệu/người/deadline.

DESIGN SYSTEM (cố định — áp nhất quán cho MỌI slide):
- Màu: nền kem giấy #F7F3EC; bề mặt phụ #EFE8DC; chữ mực #1F1B16; chữ phụ #6B625A; đường kẻ #DDD3C4; DUY NHẤT 1 màu nhấn terracotta #C2410C (sắc nhạt #F3DCCF cho nền nhấn). Không màu nào khác, không gradient, không bóng đổ đậm, không emoji.
- Chữ: tiêu đề font-family ${_serifStack()} (đậm 600); nội dung system-ui,"Segoe UI",Roboto,sans-serif; số liệu dùng font-variant-numeric:tabular-nums. Thang cỡ chữ theo khung slide (dùng clamp/vw): tiêu đề bìa rất lớn, tiêu đề slide lớn, nội dung đọc được từ xa.
- Lưới: slide tỉ lệ 16:9, căn giữa, co giãn vừa khung (kể cả khung hẹp ~420px — slide thu nhỏ theo tỉ lệ, không vỡ bố cục). Lề rộng, nhiều khoảng trắng; mỗi slide 1 ý chính, tối đa ~5 dòng chữ.
- Phần tử nhấn: thanh terracotta ngắn (40×4px) phía trên tiêu đề; số thứ tự mục lớn mờ; bo góc 4px.

BỘ MẪU SLIDE (chọn & sắp theo nội dung thật, bỏ mẫu không có dữ liệu):
1. Bìa: tên cuộc họp, ngày · thời lượng · thành phần, 1 câu kết quả chính.
2. Tóm tắt: 1 câu lớn + 3-4 chỉ số (số to màu nhấn + nhãn nhỏ).
3. Phân cách mục (số lớn + tên mục) trước mỗi phần lớn.
4. Chủ đề thảo luận: tiêu đề + 2-3 ý + dòng "Kết luận".
5. Quyết định: MỖI quyết định quan trọng 1 slide (câu quyết định thật lớn + lý do + người phụ trách).
6. Việc cần làm: bảng gọn (việc · phụ trách · hạn · ưu tiên; "Cao" tô màu nhấn).
7. Rủi ro / vấn đề mở: bố cục 2 cột (vấn đề ↔ hướng xử lý).
8. Bước tiếp theo: timeline ngang theo mốc.
9. Kết: 1 câu chốt + điều cần nhớ.

TƯƠNG TÁC & CHUYỂN ĐỘNG:
- Chuyển slide: ← → / PageUp PageDown / Space / click nửa trái-phải; Home/End; số trang "3 / 12" + thanh tiến độ mảnh màu nhấn ở đáy.
- Hiệu ứng: slide trượt nhẹ + mờ dần (300-450ms, ease-out); các khối trong slide hiện lần lượt (stagger 80-120ms); số liệu đếm tăng dần. Tôn trọng @media (prefers-reduced-motion: reduce) → bỏ chuyển động.
- Phím F: toàn màn hình (requestFullscreen, bọc try/catch); phím N: bật/tắt khung LỜI THOẠI người trình bày ở đáy (mỗi slide có 2-4 câu lời thoại tự nhiên, bằng ${L}); phím A: tự chạy (mỗi slide ~7s).
- Lưới thu nhỏ: phím G hiện lưới tất cả slide, click để nhảy tới.
- @media print: mỗi slide đúng 1 trang ngang (size: landscape), hiện hết slide, ẩn điều khiển — để in PDF bằng Ctrl+P.

KỸ THUẬT BẮT BUỘC:
- MỘT file HTML5 hoàn chỉnh, JavaScript thuần (ES2020) nội tuyến, hàm khởi tạo bọc try/catch; nội dung slide dựng sẵn bằng HTML tĩnh (hiện được cả khi JS lỗi), JS chỉ điều khiển chuyển slide/hiệu ứng.
- TUYỆT ĐỐI KHÔNG: tài nguyên ngoài (CDN/font/ảnh từ mạng), fetch/XMLHttpRequest/WebSocket, localStorage/sessionStorage/cookie/indexedDB, alert/confirm/prompt, window.open, eval, iframe/form.
${_factsBlock(facts)}${_extraBlock()}
---
BIÊN BẢN CUỘC HỌP (Markdown):
${markdown}`;
}
// Gỡ phần nguy hiểm nhưng GIỮ <script> nội tuyến; chặn script/tài nguyên ngoài bằng CSP chèn đầu <head>.
const ARTIFACT_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
function _sanitizeArtifact(h) {
  h = String(h || '').normalize('NFC')   // model hay trả dấu tiếng Việt dạng TÁCH (NFD) → nhiều font vẽ dấu lệch (tuâǹ)
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>[\s\S]*?<\/script\s*>/gi, '')   // script NGOÀI
    .replace(/<(iframe|object|embed|form|base)\b[\s\S]*?(<\/\1\s*>|>)/gi, '')
    .replace(/<meta\b[^>]*http-equiv[^>]*>/gi, '')                           // không cho model tự đặt CSP/refresh
    .replace(/(href|src|xlink:href|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    .trim();
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
  if (/<head[^>]*>/i.test(h)) h = h.replace(/<head[^>]*>/i, m => m + meta);
  else h = h.replace(/<html[^>]*>/i, m => m + '<head>' + meta + '</head>');
  return h;
}
// Trả { ok, html, quota } | { ok:false, error, quota }. markdown = biên bản đã có (report.markdown).
async function summarizeArtifact(markdown, facts, kind) {
  markdown = String(markdown || '').trim();
  if (!state.apiKey || !String(state.apiKey).trim()) return { ok: false, error: 'no-key', quota: hydrogenQuota() };
  if (markdown.length < 50) return { ok: false, error: 'empty', quota: hydrogenQuota() };
  if (hydrogenQuota().remaining <= 0) return { ok: false, error: 'quota-exhausted', quota: hydrogenQuota() };
  const ai = await _ai();
  const prompt = kind === 'slides' ? _buildSlidesPrompt(markdown, facts) : _buildArtifactPrompt(markdown, facts);   // 'artifact' | 'slides'
  let lastErr = 'failed';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const config = { temperature: 0.4, maxOutputTokens: 32768, responseMimeType: 'application/json', responseSchema: ARTIFACT_SCHEMA };
      const res = await ai.models.generateContent({ model: HYDROGEN.id, contents: prompt, config });
      _setHydrogenUsed(hydrogenQuota().used + 1);
      const text = (res && (typeof res.text === 'string' ? res.text : (res.text && res.text()))) || '';
      const obj = _parseJson(text) || {};
      const html = _sanitizeArtifact(obj.html);
      if (!/<html[\s>]/i.test(html) || !/<script\b/i.test(html)) return { ok: false, error: 'empty-or-invalid-output', quota: hydrogenQuota() };
      return { ok: true, html, model: HYDROGEN.id, quota: hydrogenQuota() };
    } catch (e) {
      const msg = (e && e.message) || String(e); lastErr = msg;
      console.warn(`[gemini-text] artifact (lần ${attempt + 1}): ${msg}`);
      if (_isQuota(msg)) { if (/per\s*day|perday|daily|RequestsPerDay/i.test(msg)) _setHydrogenUsed(HYDROGEN.rpd); return { ok: false, error: 'quota-exhausted', quota: hydrogenQuota() }; }
      if (!/\b503\b|UNAVAILABLE|overloaded|high demand|\b500\b|INTERNAL/i.test(msg)) break;
      await new Promise(r => setTimeout(r, attempt ? 8000 : 3000));
    }
  }
  return { ok: false, error: lastErr, quota: hydrogenQuota() };
}

module.exports = { summarize, summarizeFull, summarizeReport, summarizeOverall, summarizeArtifact, hydrogenQuota };
