/**
 * bitnet-llm.js — Lifecycle sidecar BitNet v7a (dịch JA→VI 152M 1.58-bit, i2_s GGUF)
 *
 * Model i2_s chỉ chạy bằng build BitNet trong WSL + tokenizer unigram phải encode bằng
 * sentencepiece Python (llama.cpp tokenize sai — Bit-Translate ISSUES.md #4). Nên toàn bộ
 * đường dịch nằm trong bitnet/bitnet_sidecar.py; file này chỉ spawn/stop + health check.
 *
 *   app Node --HTTP:8790--> bitnet_sidecar.py --HTTP:8811--> llama-server (WSL)
 */
const path = require('path');
const { spawn, exec } = require('child_process');
const { app } = require('electron');
const { httpGetLocalUrl, httpPostLocal } = require('./http-helpers');

const BASE_URL = 'http://127.0.0.1:8790';
let _proc = null;
let _starting = false;

function sidecarPath() {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(base, 'bitnet', 'bitnet_sidecar.py');
}

async function health() {
  const r = await httpGetLocalUrl(BASE_URL, '/health', 2500);
  if (r.status !== 200) return { ok: false };
  try { return { ok: true, ...JSON.parse(r.body) }; } catch { return { ok: true }; }
}

/** Idempotent: sidecar đã sống (kể cả do phiên khác bật) → dùng luôn, không spawn thêm. */
async function ensureStarted() {
  if (_starting) return { ok: true, starting: true };
  const h = await health();
  if (h.ok) return { ok: true, alreadyRunning: true };
  _starting = true;
  try {
    const script = sidecarPath();
    console.log('[bitnet] spawn sidecar:', script);
    const proc = spawn('python', [script], {
      cwd: path.dirname(script),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    _proc = proc;
    proc.stdout.on('data', b => console.log('[bitnet]', b.toString().trim().slice(0, 200)));
    proc.stderr.on('data', b => console.warn('[bitnet]', b.toString().trim().slice(0, 200)));
    proc.on('exit', (code) => { console.log('[bitnet] sidecar exit', code); _proc = null; });
    proc.on('error', (e) => { console.warn('[bitnet] spawn lỗi:', e.message); _proc = null; });
    // Chờ health tối đa 90s (llama-server WSL nạp model ~5-10s; lần đầu mở WSL có thể lâu hơn)
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (!_proc) return { ok: false, error: 'sidecar thoát sớm (thiếu python/sentencepiece/model?)' };
      const hh = await health();
      if (hh.ok) { console.log('[bitnet] sidecar sẵn sàng | upstream:', hh.upstream); return { ok: true }; }
    }
    return { ok: false, error: 'sidecar không lên sau 90s' };
  } finally {
    _starting = false;
  }
}

/** Tắt sạch: /shutdown để sidecar tự kill llama-server WSL; fallback taskkill. */
function stop() {
  try { httpPostLocal(BASE_URL, '/shutdown', { 'Content-Type': 'application/json' }, '{}', 2000); } catch {}
  const p = _proc;
  if (p) {
    setTimeout(() => {
      try { exec(`taskkill /pid ${p.pid} /T /F`, { windowsHide: true }, () => {}); } catch {}
    }, 1500);
    _proc = null;
  }
  return { ok: true };
}

module.exports = { ensureStarted, stop, health, BASE_URL };
