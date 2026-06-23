/**
 * gemini-text.js — Tóm tắt cuộc họp ĐANG DIỄN RA (rolling) bằng Gemini.
 *
 * RPD: generateContent free-tier đã bị Google cắt còn rất thấp (gemini-2.5-flash ~20-250/ngày) → KHÔNG đủ cho
 * summary định kỳ. Vì model LIVE (gemini-3.1-flash-live-preview) có RPD KHÔNG GIỚI HẠN, ta tóm tắt qua phiên Live
 * (responseModalities TEXT → GIỮ Markdown). Mỗi lần = 1 phiên ngắn (connect → 1 turn → close).
 *
 * ROLLING: chỉ gửi BẢN TÓM TẮT CŨ + CÁC CÂU MỚI (không gửi lại toàn transcript) → token nhỏ, xa ngưỡng 65K TPM.
 *
 * Fallback: nếu Live lỗi → generateContent (gemini-2.5-flash, RPD hạn chế) cho có còn hơn không.
 * SDK @google/genai là ESM-only → dynamic import().
 */
const state = require('./state');

const LIVE_MODEL = 'gemini-3.1-flash-live-preview';   // RPD unlimited (đã verify trả text/audio)
const FALLBACK_MODEL = 'gemini-2.5-flash';            // generateContent ổn định (fallback, RPD thấp)
const PREFER = [/^gemini-3[.\-].*flash/i, /flash-latest/i, /^gemini-2\.5-flash$/i, /flash/i];
const SKIP = /vision|image|tts|audio|embedding|live|thinking|exp-|learnlm|gemma/i;

let _mod = null, _model = null;
async function _sdk() { return _mod || (_mod = await import('@google/genai')); }

function _sysSummary() {
  const L = state.targetLangLabel;
  return `You output ONLY a concise meeting summary in ${L}, formatted as Markdown. No preface, no commentary, no code fences. `
    + `Keep IT/technical terms and proper nouns in their original form. Do not invent content not in the transcript.`;
}

// Trần token: tránh phình prevSummary + số câu mới (free-tier TPM dùng CHUNG model với translate ở chế độ Teams).
const MAX_PREV_SUMMARY_CHARS = 4000;   // ~1–1.5K token; cắt phần đầu (cũ nhất) nếu vượt
const MAX_NEW_CAPTIONS = 40;           // mỗi lần tóm chỉ gửi tối đa 40 câu mới (giữ câu MỚI NHẤT)
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
      + `## Quyết định & việc cần làm), súc tích, viết bằng ${L}. GIỮ NGUYÊN thuật ngữ IT & tên riêng. `
      + `Trả về TOÀN BỘ bản tóm tắt đã cập nhật, CHỈ Markdown.`;
  }
  return `Tóm tắt cuộc họp ĐANG DIỄN RA bằng ${L}, Markdown súc tích với các mục: **Chủ đề chính**, `
    + `**Điểm nổi bật**, **Quyết định / việc cần làm** (kèm người phụ trách nếu có). `
    + `GIỮ NGUYÊN thuật ngữ IT & tên riêng. KHÔNG bịa.\n\nTranscript:\n${lines}`;
}

// ── Đường 1: phiên Live (TEXT) — RPD không giới hạn ──────────────────────────────
async function _viaLive(prompt) {
  const { GoogleGenAI, Modality } = await _sdk();
  const ai = new GoogleGenAI({ apiKey: String(state.apiKey).trim() });
  let acc = '', resolveDone, timer;
  const done = new Promise(res => { resolveDone = res; });
  const finish = (r) => { clearTimeout(timer); resolveDone(r); };
  timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 30000);
  let session;
  try {
    session = await ai.live.connect({
      model: LIVE_MODEL,
      config: { responseModalities: [Modality.TEXT], systemInstruction: _sysSummary() },
      callbacks: {
        onmessage: (m) => {
          const sc = m && m.serverContent;
          const parts = (sc && sc.modelTurn && sc.modelTurn.parts) || (sc && sc.parts);
          if (parts) for (const p of parts) { if (p && typeof p.text === 'string') acc += p.text; }
          if (sc && sc.turnComplete) finish({ ok: true, markdown: acc.trim() });
        },
        onerror: (e) => finish({ ok: false, error: (e && e.message) || 'ws-error' }),
        onclose: () => finish(acc.trim() ? { ok: true, markdown: acc.trim() } : { ok: false, error: 'closed-empty' }),
      },
    });
  } catch (e) { clearTimeout(timer); return { ok: false, error: (e && e.message) || 'connect-failed' }; }
  try { session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: prompt }] }], turnComplete: true }); }
  catch (e) { finish({ ok: false, error: (e && e.message) || 'send-failed' }); }
  const r = await done;
  try { session.close(); } catch {}
  return r;
}

// ── Đường 2 (fallback): generateContent stateless ───────────────────────────────
async function _resolveModel(ai) {
  if (_model) return _model;
  try {
    const names = [];
    const pager = await ai.models.list();
    for await (const m of pager) {
      const name = String((m && m.name) || '').replace(/^models\//, '');
      const acts = (m && (m.supportedActions || m.supportedGenerationMethods)) || [];
      if (Array.isArray(acts) && acts.some(a => /generateContent/i.test(String(a))) && name && !SKIP.test(name)) names.push(name);
    }
    for (const re of PREFER) { const hit = names.find(n => re.test(n)); if (hit) { _model = hit; break; } }
    if (!_model && names.length) _model = names[0];
  } catch (e) { console.warn('[gemini-text] ListModels lỗi → fallback:', e && e.message); }
  if (!_model) _model = FALLBACK_MODEL;
  return _model;
}
async function _generate(ai, model, prompt) {
  const res = await ai.models.generateContent({ model, contents: prompt, config: { temperature: 0.3 } });
  return (res && (typeof res.text === 'string' ? res.text : (res.text && res.text()))) || '';
}
async function _viaGenerate(prompt) {
  try {
    const { GoogleGenAI } = await _sdk();
    const ai = new GoogleGenAI({ apiKey: String(state.apiKey).trim() });
    const model = await _resolveModel(ai);
    let text;
    try { text = await _generate(ai, model, prompt); }
    catch (e) {
      if (model !== FALLBACK_MODEL && /not found|not supported|404/i.test((e && e.message) || '')) { _model = FALLBACK_MODEL; text = await _generate(ai, FALLBACK_MODEL, prompt); }
      else throw e;
    }
    if (!text || !text.trim()) return { ok: false, error: 'empty-response' };
    return { ok: true, markdown: text.trim() };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

// payload: { prevSummary, captions } (rolling). Trả { ok, markdown } | { ok:false, error }.
async function summarize(payload) {
  const prevSummary = (payload && payload.prevSummary) || '';
  const captions = (payload && payload.captions) || (Array.isArray(payload) ? payload : []);
  if (!state.apiKey || !String(state.apiKey).trim()) return { ok: false, error: 'no-key' };
  if ((!captions || !captions.length) && !prevSummary) return { ok: false, error: 'empty' };
  const prompt = _buildRollingPrompt(prevSummary, captions);
  // 1) Live (unlimited RPD)
  const live = await _viaLive(prompt);
  if (live.ok && live.markdown) return live;
  console.warn('[gemini-text] Live summary lỗi (' + (live.error || '?') + ') → fallback generateContent');
  // 2) generateContent (RPD thấp) — best effort
  return _viaGenerate(prompt);
}

module.exports = { summarize };
