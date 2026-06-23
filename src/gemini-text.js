/**
 * gemini-text.js — Tóm tắt cuộc họp ĐANG DIỄN RA (rolling) bằng Gemini, qua generateContent.
 *
 * RPD free-tier (xem AI Studio → Rate limits, đã verify 06/2026):
 *   - gemini-3.1-flash-lite : 15 RPM · 250K TPM · 500  RPD   → CHÍNH (chất lượng tóm tắt tốt nhất nhóm free)
 *   - gemma-4-31b           : 15 RPM · ∞   TPM · 1500 RPD   → fallback 1 (RPD rộng + TPM không giới hạn)
 *   - gemma-4-26b           : 15 RPM · ∞   TPM · 1500 RPD   → fallback 2 (nhẹ/nhanh hơn, cùng hạn mức)
 *   (gemini-2.5-flash-lite & 3.5-flash chỉ còn ~20 RPD → KHÔNG dùng).
 * Khi 1 model dính 429 (hết quota) → cooldown + tụt xuống model kế. Cộng lại ~3500 RPD: dư cho nhiều cuộc 2h/ngày.
 *
 * ROLLING: chỉ gửi BẢN TÓM TẮT CŨ + CÁC CÂU MỚI (không gửi lại toàn transcript) → token nhỏ.
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
  const L = state.targetLangLabel;
  return `You output ONLY a concise meeting summary in ${L}, formatted as Markdown. No preface, no commentary, no code fences. `
    + `Keep IT/technical terms and proper nouns in their original form. Do not invent content not in the transcript.`;
}

// Trần token: giữ prevSummary + số câu mới nhỏ gọn (tóm tắt súc tích, ổn định, nhẹ TPM kể cả model 250K).
const MAX_PREV_SUMMARY_CHARS = 3000;   // ~1K token; cắt phần đầu (cũ nhất) nếu vượt → chặn prevSummary phình
const MAX_NEW_CAPTIONS = 25;           // mỗi lần tóm chỉ gửi tối đa 25 câu mới (giữ câu MỚI NHẤT) → nhẹ token
const MAX_OUTPUT_TOKENS = 2048;        // chặn OUTPUT phình → bound token mỗi lần + giữ tóm tắt súc tích
function _trimPrev(s) {
  s = (s || '').trim(); if (s.length <= MAX_PREV_SUMMARY_CHARS) return s;
  const cut = s.slice(s.length - MAX_PREV_SUMMARY_CHARS);
  const nl = cut.indexOf('\n');   // cắt gọn ở ranh giới dòng để không vỡ Markdown giữa chừng
  return (nl > 0 ? cut.slice(nl + 1) : cut).trim();
}
function _buildRollingPrompt(prevSummary, captions) {
  let caps = (captions || []).filter(c => c && c.original && c.original.trim());
  if (caps.length > MAX_NEW_CAPTIONS) caps = caps.slice(caps.length - MAX_NEW_CAPTIONS);
  const lines = caps
    .map(c => `[${c.author || 'STT'}] ${c.original}`)
    .join('\n');
  prevSummary = _trimPrev(prevSummary);
  const L = state.targetLangLabel;
  if (prevSummary && prevSummary.trim()) {
    return `Bản tóm tắt cuộc họp ĐANG DIỄN RA hiện có (Markdown, ${L}):\n\n${prevSummary}\n\n`
      + `--- CÁC CÂU MỚI kể từ lần tóm tắt trước ---\n${lines || '(không có câu mới)'}\n\n`
      + `CẬP NHẬT bản tóm tắt trên để gộp nội dung mới. GIỮ cấu trúc (## Chủ đề chính / ## Điểm nổi bật / `
      + `## Quyết định & việc cần làm), viết bằng ${L}. GIỮ NGUYÊN thuật ngữ IT & tên riêng. GIỮ SÚC TÍCH — `
      + `toàn bản ≤ ~250 từ (gộp/lược ý cũ ít quan trọng, KHÔNG để phình dài). Trả về TOÀN BỘ bản tóm tắt đã cập nhật, CHỈ Markdown.`;
  }
  return `Tóm tắt cuộc họp ĐANG DIỄN RA bằng ${L}, Markdown súc tích với các mục: **Chủ đề chính**, `
    + `**Điểm nổi bật**, **Quyết định / việc cần làm** (kèm người phụ trách nếu có). `
    + `GIỮ NGUYÊN thuật ngữ IT & tên riêng. KHÔNG bịa.\n\nTranscript:\n${lines}`;
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

async function _generate(ai, entry, prompt) {
  const config = { temperature: 0.3, maxOutputTokens: MAX_OUTPUT_TOKENS };
  let contents = prompt;
  const sys = _sysSummary();
  if (entry.gemma) contents = sys + '\n\n' + prompt;   // Gemma không nhận systemInstruction → ghép vào nội dung
  else config.systemInstruction = sys;
  const res = await ai.models.generateContent({ model: entry.id, contents, config });
  return (res && (typeof res.text === 'string' ? res.text : (res.text && res.text()))) || '';
}

// Thử lần lượt theo chuỗi; 429/404/lỗi → tụt model kế. Trả { ok, markdown, model } | { ok:false, error }.
async function _viaChain(prompt) {
  const { GoogleGenAI } = await _sdk();
  const ai = new GoogleGenAI({ apiKey: String(state.apiKey).trim() });
  const chain = await _resolveChain(ai);
  let lastErr = 'no-model', skippedAll = true;
  for (const entry of chain) {
    if (_onCooldown(entry.id)) continue;
    skippedAll = false;
    try {
      const text = await _generate(ai, entry, prompt);
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
      const text = await _generate(ai, last, prompt);
      if (text && text.trim()) return { ok: true, markdown: text.trim(), model: last.id };
    } catch (e) { lastErr = (e && e.message) || String(e); }
  }
  return { ok: false, error: lastErr };
}

// payload: { prevSummary, captions } (rolling). Trả { ok, markdown } | { ok:false, error }.
async function summarize(payload) {
  const prevSummary = (payload && payload.prevSummary) || '';
  const captions = (payload && payload.captions) || (Array.isArray(payload) ? payload : []);
  if (!state.apiKey || !String(state.apiKey).trim()) return { ok: false, error: 'no-key' };
  if ((!captions || !captions.length) && !prevSummary) return { ok: false, error: 'empty' };
  const prompt = _buildRollingPrompt(prevSummary, captions);
  return _viaChain(prompt);
}

module.exports = { summarize };
