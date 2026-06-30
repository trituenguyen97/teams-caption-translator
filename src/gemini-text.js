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

module.exports = { summarize, summarizeFull, summarizeReport };
