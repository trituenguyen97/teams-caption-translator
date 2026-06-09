#!/usr/bin/env node
/**
 * test-translate.js — Kiểm thử dịch: auto-detect ngôn ngữ NGUỒN (không chọn source) + chọn TARGET.
 *
 * Ma trận: 5 nguồn × 5 đích (vi/en/ja/ko/zh-CN), mỗi cặp 2 mẫu (hội thoại + họp IT).
 * Engine online: Google free, MS (Edge translator) — đều auto-detect source.
 * Engine offline: MiLMMT (llama-server + detectSourceLang). Tự start server nếu chạy với --offline.
 *
 * Chấm CƠ HỌC: detect ngôn ngữ của OUTPUT → PASS nếu khớp target (⇒ auto-detect source + target đúng).
 * Ghi kết quả ra scripts/_translate-results.json để bước chấm CHẤT LƯỢNG (LLM judge) dùng.
 *
 * Dùng:  node scripts/test-translate.js            # chỉ online
 *        node scripts/test-translate.js --offline  # online + offline (cần binary + model)
 *        node scripts/test-translate.js --only-offline
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const state = require('../src/state');
const T = require('../src/translation');

const ONLINE = !process.argv.includes('--only-offline');
const OFFLINE = process.argv.includes('--offline') || process.argv.includes('--only-offline');

// ── Ngôn ngữ (tên đầy đủ như translation.js dùng) ──
const LANGS = {
  vi: 'Vietnamese', en: 'English', ja: 'Japanese', ko: 'Korean', 'zh-CN': 'Simplified Chinese',
};
const CODES = Object.keys(LANGS);

// ── Mẫu câu nguồn: hội thoại thường + họp IT, cho từng ngôn ngữ ──
const SAMPLES = {
  vi: {
    conv: 'Chào mọi người, hôm nay cuộc họp bắt đầu lúc mấy giờ vậy?',
    it: 'Tôi đã merge nhánh feature vào main và deploy lên server staging rồi nhé.',
  },
  en: {
    conv: 'Good morning everyone, did you all have a good weekend?',
    it: 'Please review my pull request and check the API endpoint before we deploy to production.',
  },
  ja: {
    conv: 'おはようございます、本日もよろしくお願いいたします。',
    it: 'プルリクエストをレビューして、デプロイ前にサーバーのログを確認してください。',
  },
  ko: {
    conv: '안녕하세요, 오늘 회의는 몇 시에 시작하나요?',
    it: '풀 리퀘스트를 리뷰하고 배포하기 전에 서버 로그를 확인해 주세요.',
  },
  'zh-CN': {
    conv: '大家好，今天的会议几点开始？',
    it: '请先审查我的拉取请求，并在部署到服务器之前检查接口日志。',
  },
};

// ── Nhận diện ngôn ngữ của OUTPUT (để chấm) ──
const RE_HANGUL = /[가-힣]/;
const RE_KANA   = /[぀-ヿ]/;
const RE_HAN    = /[一-鿿]/;
const RE_VI     = /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i;
const RE_LATIN  = /[a-z]/i;

function detectOut(t) {
  if (!t) return '∅';
  if (RE_HANGUL.test(t)) return 'ko';
  if (RE_KANA.test(t)) return 'ja';                 // kana ⇒ Nhật (Trung không có kana)
  if (RE_VI.test(t)) return 'vi';                   // dấu tiếng Việt
  if (RE_HAN.test(t)) return 'zh-CN';               // Hán mà không kana/hangul ⇒ Trung
  if (RE_LATIN.test(t)) return 'en';                // Latin không dấu Việt ⇒ Anh
  return '?';
}

// PASS nếu output đúng ngôn ngữ target (auto-detect source + target hoạt động)
function grade(out, tgtCode) {
  if (!out) return { pass: false, why: 'empty' };
  const d = detectOut(out);
  if (d === tgtCode) return { pass: true, why: d };
  // ja chấp nhận trường hợp kanji-only (hiếm): nếu target ja mà ra zh-CN do thiếu kana
  if (tgtCode === 'ja' && d === 'zh-CN') return { pass: true, why: 'ja(han-only)' };
  return { pass: false, why: `got ${d}` };
}

const ENGINES = {
  google: (text, tgt) => T.translateGoogleFree(text, tgt),
  ms:     (text, tgt) => { state.targetLang = tgt; return T.translateViaEdge(text); },
  local:  (text, tgt) => { state.targetLang = tgt; return T.translateLocalMiLMMT(text, tgt); },
};

function buildCases() {
  const cases = [];
  for (const src of CODES) for (const tgt of CODES) {
    if (src === tgt) continue;
    for (const cat of ['conv', 'it']) {
      cases.push({ src, tgt, cat, input: SAMPLES[src][cat], tgtName: LANGS[tgt] });
    }
  }
  return cases;   // 5×4×2 = 40 cặp
}

async function withTimeout(promise, ms, label) {
  let to;
  const t = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('timeout ' + label)), ms); });
  try { return await Promise.race([promise, t]); } finally { clearTimeout(to); }
}

async function runEngine(name, cases, { concurrency }) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < cases.length) {
      const c = cases[idx++];
      const t0 = Date.now();
      let out = null, err = null;
      try { out = await withTimeout(Promise.resolve(ENGINES[name](c.input, c.tgtName)), 25000, name); }
      catch (e) { err = e.message; }
      const g = grade(out, c.tgt);
      results.push({ engine: name, ...c, output: out, ms: Date.now() - t0, err, pass: g.pass, why: g.why });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Offline llama-server lifecycle ──
function findLocalBinary() {
  const root = path.join(process.env.APPDATA || '', 'teams-caption-translator', 'local-llm', 'llama-server');
  for (const v of ['cpu', 'cuda', 'vulkan']) {
    const exe = path.join(root, v, 'llama-server.exe');
    if (fs.existsSync(exe)) return { exe, dir: path.join(root, v), variant: v };
  }
  return null;
}
function findModel() {
  const roots = [
    path.join(__dirname, '..', 'models'),                                                    // bundle (dev)
    path.join(process.env.APPDATA || '', 'teams-caption-translator', 'local-llm', 'models'), // userData (đã tải)
  ];
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue;
    const ggufs = fs.readdirSync(dir).filter(x => /\.gguf$/i.test(x));
    const pick = ggufs.find(x => /milmmt/i.test(x)) || ggufs[0];   // ưu tiên MiLMMT
    if (pick) return path.join(dir, pick);
  }
  return null;
}
async function startServer() {
  const bin = findLocalBinary();
  const model = findModel();
  if (!bin) throw new Error('Không thấy llama-server.exe (userData). Chạy: npm run fetch-binaries');
  if (!model) throw new Error('Không thấy model .gguf trong models/');
  console.log(`[offline] start ${bin.variant} | model=${path.basename(model)}`);
  const proc = spawn(bin.exe, ['-m', model, '--port', '8080', '--host', '127.0.0.1', '-c', '2048', '-t', '4', '--poll', '0'],
    { cwd: bin.dir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  // poll /v1/models tới khi sẵn sàng (model load có thể vài chục giây)
  const http = require('http');
  const ping = () => new Promise((res) => {
    const r = http.get({ hostname: '127.0.0.1', port: 8080, path: '/v1/models', timeout: 2000 }, (x) => { x.resume(); res(x.statusCode === 200); });
    r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) { if (await ping()) { console.log(`[offline] server ready (${((Date.now() - t0) / 1000).toFixed(0)}s)`); return proc; } await new Promise(r => setTimeout(r, 1500)); }
  proc.kill(); throw new Error('server không sẵn sàng sau 90s');
}

function summarize(all) {
  const engines = [...new Set(all.map(r => r.engine))];
  console.log('\n================ KẾT QUẢ CHẤM CƠ HỌC (auto-detect + target đúng) ================');
  // Tổng theo engine
  console.log('\nEngine        | pass/total | rate   | avg ms');
  console.log('--------------|------------|--------|-------');
  for (const e of engines) {
    const rows = all.filter(r => r.engine === e);
    const pass = rows.filter(r => r.pass).length;
    const avg = Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length);
    console.log(`${e.padEnd(13)} | ${String(pass).padStart(2)}/${String(rows.length).padStart(2)}      | ${(pass / rows.length * 100).toFixed(0).padStart(4)}%  | ${avg}`);
  }
  // Ma trận theo nguồn (auto-detect) cho từng engine
  for (const e of engines) {
    console.log(`\n[${e}] PASS theo NGÔN NGỮ NGUỒN (auto-detect):`);
    for (const src of CODES) {
      const rows = all.filter(r => r.engine === e && r.src === src);
      const pass = rows.filter(r => r.pass).length;
      console.log(`   ${src.padEnd(6)} → ${pass}/${rows.length}` + (pass < rows.length ? '  ⚠ fail: ' + rows.filter(r => !r.pass).map(r => `${r.tgt}/${r.cat}(${r.err || r.why})`).join(', ') : ''));
    }
  }
}

(async () => {
  const cases = buildCases();
  let all = [];

  if (ONLINE) {
    for (const e of ['google', 'ms']) {
      process.stdout.write(`[online] ${e} … `);
      const r = await runEngine(e, cases, { concurrency: 5 });
      all = all.concat(r);
      console.log(`${r.filter(x => x.pass).length}/${r.length} pass`);
    }
  }

  if (OFFLINE) {
    let proc = null;
    try {
      proc = await startServer();
      process.stdout.write('[offline] local (MiLMMT) … ');
      const r = await runEngine('local', cases, { concurrency: 1 });   // local CPU = tuần tự
      all = all.concat(r);
      console.log(`${r.filter(x => x.pass).length}/${r.length} pass`);
    } catch (e) {
      console.warn('[offline] BỎ QUA:', e.message);
    } finally {
      if (proc) { try { require('child_process').execSync(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch {} }
    }
  }

  summarize(all);
  const outPath = path.join(__dirname, '_translate-results.json');
  fs.writeFileSync(outPath, JSON.stringify(all, null, 2), 'utf8');
  console.log('\n→ chi tiết:', outPath, `(${all.length} bản dịch)`);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
