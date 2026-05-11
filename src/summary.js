/**
 * summary.js — Meeting summarization via LLM
 */
const { dialog } = require('electron');
const fs = require('fs');
const state = require('./state');
const Store = require('./store');
const { callLLM, callGemini } = require('./translation');

function buildSummarizePrompt(captions) {
  const lines = captions
    .filter(c => c.original && c.original.trim())
    .map(c => `[${c.author}] ${c.original}`)
    .join('\n');
  return `Bạn là trợ lý tổng hợp cuộc họn. Hãy tạo báo cáo cuộc họn chi tiết dạng Markdown từ transcript dưới.

Yêu cầu:
- Viết hoàn toàn bằng ${state.targetLangLabel}
- Cấu trúc Markdown rõ ràng: tiêu đề, mổi đầu mục, danh sách
- Bao gồm các phần: Tổng quan, Chủ đề chính, Đặc vấn đề/Vấn đề nổi bật, Quyết định/Hành động tiếp theo
- Giữ nguyên thuật ngữ IT (bug, sprint, deploy, PR, API...)
- Không thêm nội dung không có trong transcript

Transcript cuộc họn:
${lines}`;
}

function estimateTokens(text) { return Math.ceil((text || '').length / 2.5); }

async function summarizeMeeting(captions) {
  if (!captions || !captions.length) return { ok: false, error: 'Không có nội dung để tổng hợp' };

  const withTs = captions.filter(c => typeof c.tsMs === 'number').sort((a, b) => a.tsMs - b.tsMs);
  const durationMs = withTs.length >= 2 ? withTs[withTs.length - 1].tsMs - withTs[0].tsMs : 0;
  const durationMin = Math.round(durationMs / 60000);

  const sumMode = Store.get('summaryProvider', 'groq');
  let provider = sumMode;
  const sumKeys = Store.get('summaryKeys', {});
  const provKeys = Store.get('providerKeys', {});
  let apiKey = sumKeys[provider] || Store.get('summaryApiKey', '') || provKeys[provider] || state.apiKey;
  let model = Store.get('summaryModel', '') || state.llmModel;

  if (provider !== 'groq' && provider !== 'openai' && provider !== 'gemini') {
    return { ok: false, error: `Provider '${provider}' không hỗ trợ tóm tắt (cần LLM)` };
  }
  if (!apiKey) return { ok: false, error: 'Chưa có API key — hãy thiết lập trong ⚙️ Cài đặt → Tóm tắt' };
  if (!model) model = provider === 'gemini' ? 'gemini-2.0-flash' : provider === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o-mini';

  const prompt = buildSummarizePrompt(captions);
  const inputTokensEst = estimateTokens(prompt);
  const t0 = Date.now();

  try {
    let result;
    if (provider === 'gemini') {
      result = await callGemini(apiKey, model, prompt, 8192);
    } else {
      const host = provider === 'groq' ? 'api.groq.com' : 'api.openai.com';
      const llmPath = provider === 'groq' ? '/openai/v1/chat/completions' : '/v1/chat/completions';
      result = await callLLM(host, llmPath, apiKey, model, prompt);
    }
    if (!result) return { ok: false, error: 'LLM không trả về kết quả' };

    const elapsedMs = Date.now() - t0;
    const outputTokens = estimateTokens(result);
    return {
      ok: true, markdown: result,
      stats: {
        provider, model, durationMin,
        inputTokens: inputTokensEst, outputTokens,
        totalTokens: inputTokensEst + outputTokens,
        elapsedMs, elapsedSec: Math.round(elapsedMs / 1000),
        tokensPerSec: elapsedMs > 0 ? +((inputTokensEst + outputTokens) / (elapsedMs / 1000)).toFixed(1) : 0,
      },
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function exportSummary({ markdown, defaultName }) {
  const { filePath, canceled } = await dialog.showSaveDialog(state.win, {
    title: 'Lưu báo cáo cuộc họn',
    defaultPath: defaultName || `meeting-summary-${new Date().toISOString().slice(0, 10)}.md`,
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, markdown, 'utf8');
  return { ok: true, filePath };
}

module.exports = { summarizeMeeting, exportSummary };
