// gemini-text.js (browser ESM) — port của src/gemini-text.js. Tóm tắt qua generateContent:
//   summarize()     — ROLLING (cuốn chiếu, gọn)
//   summarizeFull() — TỔNG THỂ (báo cáo chi tiết 1 lần, gemma-only)
import { GoogleGenAI } from './genai.mjs';

const SUMMARY_CHAIN = [
  { id: 'gemini-3.1-flash-lite', re: /gemini-3[.\-]?1-flash-lite/i, gemma: false },
  { id: 'gemma-4-31b-it',        re: /gemma-4-31b/i,                gemma: true  },
  { id: 'gemma-4-26b-it',        re: /gemma-4-26b/i,                gemma: true  },
];
const MAX_PREV_SUMMARY_CHARS = 24000;   // ~8K token: giữ ĐỦ bản tóm tắt họp DÀI, tránh cắt mất mục cũ (flash-lite ctx 1M dư sức)
const MAX_NEW_CAPTIONS = 250;           // gửi gần như TẤT CẢ câu mới mỗi vòng → không bỏ sót khi họp dài/nói nhiều (token vẫn nhẹ)
const ROLL_OUT_TOKENS = 2048;
const FULL_OUT_TOKENS = 8192;

// Schema báo cáo có cấu trúc (Gemini responseSchema) → client render HTML "y hệt".
const _S = { type: 'STRING' };
const _PT = { type: 'OBJECT', properties: { label: { type: 'STRING', nullable: true }, text: _S, sub: { type: 'ARRAY', items: _S } }, required: ['text'] };
const _CARD = { type: 'OBJECT', properties: { title: { type: 'STRING', nullable: true }, text: _S }, required: ['text'] };
const _STAT = { type: 'OBJECT', nullable: true, properties: { value: _S, caption: { type: 'STRING', nullable: true } }, required: ['value'] };
const _TABLE = { type: 'OBJECT', nullable: true, properties: { columns: { type: 'ARRAY', items: _S }, rows: { type: 'ARRAY', items: { type: 'OBJECT', properties: { cells: { type: 'ARRAY', items: _S } }, required: ['cells'] } } } };
const _DEC = { type: 'OBJECT', properties: { label: _S, status: { type: 'STRING', enum: ['done', 'plan', 'todo'] }, text: _S }, required: ['label', 'text'] };
const _BLOCKS = { intro: { type: 'STRING', nullable: true }, points: { type: 'ARRAY', items: _PT }, cards: { type: 'ARRAY', items: _CARD }, stat: _STAT, table: _TABLE };
const _SUB = { type: 'OBJECT', properties: Object.assign({ title: _S, tone: { type: 'STRING', enum: ['default', 'warn'], nullable: true } }, _BLOCKS), required: ['title'] };
const _SECTION = { type: 'OBJECT', properties: Object.assign({ heading: _S, tone: { type: 'STRING', enum: ['default', 'warn'], nullable: true } }, _BLOCKS, { decisions: { type: 'ARRAY', items: _DEC }, subs: { type: 'ARRAY', items: _SUB } }), required: ['heading'] };
const REPORT_SCHEMA = { type: 'OBJECT', properties: { eyebrow: { type: 'STRING', nullable: true }, title: _S, meta: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: _S, value: _S }, required: ['label', 'value'] } }, sections: { type: 'ARRAY', items: _SECTION }, footer: { type: 'STRING', nullable: true } }, required: ['title', 'sections'] };
function _parseJson(t) {
  if (!t) return null;
  t = String(t).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (e) {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
  return null;
}

// getState(): { apiKey, targetLangLabel, transcribeMode, summaryExtra }
export function createSummarizer({ getState }) {
  const S = () => getState();
  let _chain = null, _detLang = '';
  const _cooldownUntil = {};

  function _sysSummary() {
    if (!S().transcribeMode) {
      return `You output ONLY the meeting summary in ${S().targetLangLabel}, formatted as Markdown. No preface, no commentary, no code fences. `
        + `Keep IT/technical terms and proper nouns in their original form. Never invent content not in the transcript.`;
    }
    const L = _detLang || 'the dominant language of the transcript';
    const ex = (S().summaryExtra || '').trim();
    return `You output ONLY the meeting summary as Markdown. No preface, no commentary, no code fences. `
      + `By DEFAULT, write the ENTIRE summary (including ALL section headings) in ${L}. `
      + (ex ? `BUT the user's custom instructions below have the HIGHEST priority and OVERRIDE this default — if they ask for a specific output language or format, obey them. ` : '')
      + `Keep IT/technical terms and proper nouns in their original form. Never invent content not in the transcript.`;
  }
  function _outLang() { return S().transcribeMode ? (_detLang || 'ngôn ngữ chiếm đa số trong transcript') : S().targetLangLabel; }
  function _transcribeNote() {
    if (!S().transcribeMode) return '';
    const L = _outLang(); const ex = (S().summaryExtra || '').trim();
    return `\n\nNGÔN NGỮ MẶC ĐỊNH = ${L}: viết TOÀN BỘ bản tóm tắt (KỂ CẢ tiêu đề mục) bằng ${L}; các nhãn tiếng Việt ở khung trên CHỈ là tham chiếu → DỊCH sang ${L}`
      + (ex ? `. NHƯNG nếu "YÊU CẦU RIÊNG TỪ NGƯỜI DÙNG" bên dưới yêu cầu KHÁC (kể cả đổi ngôn ngữ) thì THEO yêu cầu riêng — nó ƯU TIÊN CAO NHẤT.` : `.`);
  }
  function _extraBlock() {
    const x = (S().summaryExtra || '').trim();
    if (!x) return '';
    return `\n\n## YÊU CẦU RIÊNG TỪ NGƯỜI DÙNG (ƯU TIÊN CAO NHẤT — GHI ĐÈ mọi quy tắc & ngôn ngữ mặc định ở trên, kể cả tiêu đề mục; CHỈ giữ quy tắc chống bịa):\n${x}`;
  }
  function _trimPrev(s) {
    s = (s || '').trim(); if (s.length <= MAX_PREV_SUMMARY_CHARS) return s;
    const cut = s.slice(s.length - MAX_PREV_SUMMARY_CHARS);
    const nl = cut.indexOf('\n');
    return (nl > 0 ? cut.slice(nl + 1) : cut).trim();
  }
  function _toLines(captions, cap) {
    const _t = c => (c && (c.translated || c.original) || '').trim();
    let caps = (captions || []).filter(c => _t(c));
    if (cap && caps.length > cap) caps = caps.slice(caps.length - cap);
    return caps.map(c => `[${c.author || 'STT'}] ${_t(c)}`).join('\n');
  }
  function _rawText(captions, cap) {
    let caps = (captions || []).map(c => (c && (c.translated || c.original) || '')).filter(Boolean);
    if (cap && caps.length > cap) caps = caps.slice(caps.length - cap);
    return caps.join(' ');
  }
  function _detectLangLabel(text) {
    const s = String(text || ''); let ja = 0, ko = 0, han = 0, latin = 0, vi = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if ((c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff)) ja++;
      else if (c >= 0xac00 && c <= 0xd7a3) ko++;
      else if (c >= 0x3400 && c <= 0x9fff) han++;
      else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++;
      if (c >= 0x00c0 && c <= 0x1ef9 && !(c >= 0x41 && c <= 0x7a)) vi++;
    }
    if (ja > 0) return 'tiếng Nhật (日本語)';
    if (ko > 0) return 'tiếng Hàn (한국어)';
    if (han > 0) return 'tiếng Trung (中文)';
    if (vi > 0) return 'tiếng Việt';
    if (latin > 0) return 'tiếng Anh (English)';
    return '';
  }
  function _buildRollingPrompt(prevSummary, captions) {
    const lines = _toLines(captions, MAX_NEW_CAPTIONS);
    if (S().transcribeMode) { const d = _detectLangLabel(_rawText(captions, MAX_NEW_CAPTIONS)); if (d) _detLang = d; }
    prevSummary = _trimPrev(prevSummary);
    const L = _outLang();
    const RULES =
      `Cấu trúc (CHỈ thêm mục NÀO CÓ nội dung THẬT, BỎ mục rỗng): ## Chủ đề chính · ## Điểm nổi bật / Vấn đề · ## Quyết định & việc cần làm (người phụ trách/deadline CHỈ ghi khi transcript NÓI RÕ).\n`
      + `- GIỮ NGUYÊN thuật ngữ IT/tiếng Anh & tên riêng (bug, deploy, PR, API, sprint, merge, release...).\n`
      + `- Từ KATAKANA tiếng Nhật (thường là từ mượn tiếng Anh) → ghi BẰNG TIẾNG ANH gốc (デプロイ→deploy...), KHÔNG dịch sang ${L}.\n`
      + `- Dùng BẢNG Markdown khi có số liệu/lịch/so sánh.\n`
      + `- TUYỆT ĐỐI KHÔNG BỊA: chỉ tóm tắt nội dung CÓ THẬT trong transcript dưới đây. KHÔNG tự nghĩ ra chủ đề/quyết định/người phụ trách/deadline/con số không xuất hiện trong transcript.\n`
      + `- Nếu transcript QUÁ NGẮN / chưa đủ ý → CHỈ ghi 1-2 câu mô tả nội dung thực tế (hoặc đúng 1 dòng "Chưa đủ nội dung để tóm tắt"); KHÔNG tạo bảng/mục rỗng, KHÔNG dựng cuộc họp tưởng tượng.`
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
  function _buildFullReportPrompt(captions) {
    const lines = _toLines(captions);
    if (S().transcribeMode) { const d = _detectLangLabel(_rawText(captions)); if (d) _detLang = d; }
    const L = _outLang();
    return `Bạn là trợ lý tổng hợp cuộc họp chuyên nghiệp. Hãy tạo báo cáo cuộc họp chi tiết dạng Markdown từ phần Transcript được cung cấp ở dưới cùng.

## YÊU CẦU TRÌNH BÀY:
- Ngôn ngữ: Viết hoàn toàn bằng ${L}.
- Định dạng Markdown chuẩn: tiêu đề (## / ###), gạch đầu dòng "- ", in đậm **...** cho điểm quan trọng.
- Cấu trúc bắt buộc:
  1. Tổng quan (Thời gian, thành phần tham gia nếu có, mục đích chính).
  2. Các chủ đề chính được thảo luận.
  3. Vấn đề nổi bật / Khó khăn cần giải quyết.
  4. Quyết định / Hành động tiếp theo (kèm người phụ trách & deadline nếu có nhắc tới).

## QUY TẮC THUẬT NGỮ:
- GIỮ NGUYÊN tiếng Anh/nguyên gốc các thuật ngữ IT & tên riêng (bug, sprint, deploy, release, build, merge, PR, API, server, database, review, commit, branch, schedule, deadline, task, issue, ticket, repo, CI/CD, hotfix...). Chỉ dịch phần diễn giải.
- Từ KATAKANA tiếng Nhật → KHÔI PHỤC về TIẾNG ANH gốc (デプロイ→deploy, スケジュール→schedule...), KHÔNG phiên âm/dịch sang ${L}.

## QUY TẮC BẢNG:
- Có số liệu/mốc thời gian/lịch trình/so sánh → BẮT BUỘC dùng BẢNG Markdown.

## NGUYÊN TẮC TRUNG THỰC:
- Không suy diễn, không bịa. Thiếu thông tin → để trống hoặc "Chưa xác định".

${_transcribeNote()}${_extraBlock()}
---
BẮT ĐẦU TRANSCRIPT CUỘC HỌP:
${lines}`;
  }

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
    } catch (e) { console.warn('[summary] ListModels lỗi → id mặc định:', e && e.message); }
    _chain = SUMMARY_CHAIN.map(c => ({ id: names.find(n => c.re.test(n)) || c.id, gemma: c.gemma }));
    console.log('[summary] chain:', _chain.map(c => c.id).join(' → '));
    return _chain;
  }
  const _onCooldown = id => { const t = _cooldownUntil[id]; return !!t && Date.now() < t; };
  const _isQuota = msg => /\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(msg);
  function _setCooldown(id, msg) { const daily = /per\s*day|perday|daily|RequestsPerDay/i.test(msg); _cooldownUntil[id] = Date.now() + (daily ? 4 * 3600e3 : 90e3); }

  async function _generate(ai, entry, prompt, { withSys = true, maxOut = ROLL_OUT_TOKENS } = {}) {
    const config = { temperature: 0.3, maxOutputTokens: maxOut };
    if (!entry.gemma) config.thinkingConfig = { thinkingBudget: 0 };   // tắt "thinking" cho gemini flash-lite → nhanh hơn & khỏi nuốt token (gemma không có field này)
    let contents = prompt;
    if (withSys) { const sys = _sysSummary(); if (entry.gemma) contents = sys + '\n\n' + prompt; else config.systemInstruction = sys; }
    const res = await ai.models.generateContent({ model: entry.id, contents, config });
    return (res && (typeof res.text === 'string' ? res.text : (res.text && res.text()))) || '';
  }
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
        const msg = (e && e.message) || String(e); lastErr = msg;
        if (_isQuota(msg)) { _setCooldown(entry.id, msg); console.warn(`[summary] ${entry.id} 429 → fallback`); continue; }
        if (/not found|not supported|404/i.test(msg)) { console.warn(`[summary] ${entry.id} không khả dụng → fallback`); continue; }
        console.warn(`[summary] ${entry.id} lỗi: ${msg} → model kế`);
      }
    }
    if (skippedAll && chain.length) {
      const last = chain[chain.length - 1];
      try { const text = await _generate(ai, last, prompt, opts); if (text && text.trim()) return { ok: true, markdown: text.trim(), model: last.id }; }
      catch (e) { lastErr = (e && e.message) || String(e); }
    }
    return { ok: false, error: lastErr };
  }
  const _ai = () => new GoogleGenAI({ apiKey: String(S().apiKey).trim() });

  async function summarize(payload) {
    const prevSummary = (payload && payload.prevSummary) || '';
    const captions = (payload && payload.captions) || (Array.isArray(payload) ? payload : []);
    if (!S().apiKey || !String(S().apiKey).trim()) return { ok: false, error: 'no-key' };
    if ((!captions || !captions.length) && !prevSummary) return { ok: false, error: 'empty' };
    const ai = _ai();
    return _runChain(ai, await _resolveChain(ai), _buildRollingPrompt(prevSummary, captions), { withSys: true, maxOut: ROLL_OUT_TOKENS });
  }
  async function summarizeFull(captions) {
    captions = captions || [];
    if (!S().apiKey || !String(S().apiKey).trim()) return { ok: false, error: 'no-key' };
    if (!captions.length) return { ok: false, error: 'empty' };
    const ai = _ai();
    const chain = await _resolveChain(ai);
    // Tổng thể: ƯU TIÊN flash-lite (đo thật ~3s) thay vì gemma-31b (~33s); gemma giữ làm FALLBACK khi transcript quá to/đụng quota.
    return _runChain(ai, chain, _buildFullReportPrompt(captions), { withSys: false, maxOut: FULL_OUT_TOKENS });
  }
  function _buildStructuredPrompt(captions) {
    const lines = _toLines(captions);
    if (S().transcribeMode) { const d = _detectLangLabel(_rawText(captions)); if (d) _detLang = d; }
    const L = _outLang();
    return `Bạn là trợ lý tổng hợp cuộc họp. Tạo BÁO CÁO cuộc họp dưới dạng JSON ĐÚNG theo schema được áp đặt, từ Transcript ở cuối.

NGÔN NGỮ: viết MỌI chuỗi (title, eyebrow, heading, label, value, text, caption, columns, cells...) bằng ${L}.

CÁCH MAP NỘI DUNG VÀO TRƯỜNG:
- eyebrow: nhãn ngắn kiểu "Báo cáo tổng hợp cuộc họp" (bằng ${L}). title: tiêu đề báo cáo ngắn gọn.
- meta: thông tin tổng quan dạng {label,value} (thời gian, thành phần, mục đích...). Không rõ → "Chưa xác định".
- sections: mỗi mục lớn 1 phần tử {heading, ...}. Mục có nhiều ý nhỏ → dùng "subs". Mục VẤN ĐỀ/KHÓ KHĂN/RỦI RO → tone:"warn".
- points: gạch đầu dòng (label = phần in đậm dẫn đầu nếu có; sub = ý con). cards: tập mục ngắn song song (công cụ, lựa chọn, mảng chuyên biệt). table: dữ liệu bảng/so sánh/lịch trình (rows là mảng {cells:[...]}). stat: MỘT con số nổi bật (ngân sách, KPI). decisions: việc/quyết định kèm status ("done"=đã làm, "plan"=định hướng/đang làm, "todo"=việc cần làm).

QUY TẮC THUẬT NGỮ: GIỮ NGUYÊN tiếng Anh/nguyên gốc thuật ngữ IT & tên riêng (bug, deploy, PR, API, sprint, release, CRM, ERP...). KATAKANA tiếng Nhật → khôi phục TIẾNG ANH gốc (デプロイ→deploy...), KHÔNG dịch sang ${L}.
TRUNG THỰC: chỉ dùng nội dung CÓ trong transcript; KHÔNG bịa. Thiếu → "Chưa xác định" hoặc bỏ trường.
${_transcribeNote()}${_extraBlock()}
---
TRANSCRIPT:
${lines}`;
  }

  // Trả { ok, report } | { ok:false, error }. Chỉ flash-lite (JSON schema chuẩn); lỗi → caller fallback summarizeFull.
  async function summarizeFullStructured(captions) {
    captions = captions || [];
    if (!S().apiKey || !String(S().apiKey).trim()) return { ok: false, error: 'no-key' };
    if (!captions.length) return { ok: false, error: 'empty' };
    const ai = _ai();
    const chain = await _resolveChain(ai);
    const prompt = _buildStructuredPrompt(captions);
    let lastErr = 'structured-failed';
    for (const entry of chain.filter(c => !c.gemma)) {
      if (_onCooldown(entry.id)) continue;
      try {
        const config = { temperature: 0.3, maxOutputTokens: FULL_OUT_TOKENS, responseMimeType: 'application/json', responseSchema: REPORT_SCHEMA, thinkingConfig: { thinkingBudget: 0 } };
        const res = await ai.models.generateContent({ model: entry.id, contents: prompt, config });
        const text = (res && (typeof res.text === 'string' ? res.text : (res.text && res.text()))) || '';
        const obj = _parseJson(text);
        if (obj && Array.isArray(obj.sections) && obj.sections.length) return { ok: true, report: obj, model: entry.id };
        lastErr = 'empty-or-invalid-json';
      } catch (e) {
        const msg = (e && e.message) || String(e); lastErr = msg;
        if (_isQuota(msg)) _setCooldown(entry.id, msg);
        console.warn(`[summary] structured ${entry.id}: ${msg}`);
      }
    }
    return { ok: false, error: lastErr };
  }
  return { summarize, summarizeFull, summarizeFullStructured };
}
