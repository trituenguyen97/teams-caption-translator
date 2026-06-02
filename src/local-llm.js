/**
 * local-llm.js — Quản lý llama.cpp binary + model download + server lifecycle
 *
 * - Tải llama-server.exe từ GitHub Releases (ggml-org/llama.cpp)
 * - Tải model GGUF từ URL bất kỳ (HuggingFace, hỗ trợ multi-part split)
 * - Spawn / kill llama-server child process với flag tối ưu CPU
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, exec } = require('child_process');
const { app } = require('electron');

const state = require('./state');

// ── Paths ─────────────────────────────────────────────
function dirs() {
  const root = path.join(app.getPath('userData'), 'local-llm');
  return {
    root,
    binary:    path.join(root, 'llama-server'),
    binaryExe: path.join(root, 'llama-server', 'llama-server.exe'),
    models:    path.join(root, 'models'),
    tmp:       path.join(root, 'tmp'),
  };
}

function ensureDirs() {
  const d = dirs();
  for (const p of [d.root, d.binary, d.models, d.tmp]) {
    try { fs.mkdirSync(p, { recursive: true }); } catch {}
  }
  return d;
}

// ── HTTP với follow redirect ──────────────────────────

function _request(url, headers = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'caption-translator/1.0', 'Accept': '*/*', ...headers },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return _request(next, headers, redirectsLeft - 1).then(resolve, reject);
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => { req.destroy(new Error('Request timeout')); });
  });
}

async function fetchJson(url) {
  const res = await _request(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode} from ${url}`); }
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    res.on('error', reject);
  });
}

async function downloadFile(url, destPath, onProgress, cancelToken) {
  const dest = destPath + '.partial';
  try { fs.mkdirSync(path.dirname(destPath), { recursive: true }); } catch {}
  const res = await _request(url);
  if (res.statusCode !== 200) { res.resume(); return { ok: false, error: `HTTP ${res.statusCode}` }; }
  const total = Number(res.headers['content-length'] || 0);
  let written = 0;
  let lastEmit = 0;
  return new Promise((resolve) => {
    const out = fs.createWriteStream(dest);
    let finished = false;
    const cleanup = (err) => {
      if (finished) return;
      finished = true;
      try { out.close(); } catch {}
      if (err) {
        try { fs.unlinkSync(dest); } catch {}
        resolve({ ok: false, error: err.message || String(err) });
      } else {
        try { fs.renameSync(dest, destPath); } catch (e) { return resolve({ ok: false, error: e.message }); }
        resolve({ ok: true, bytesWritten: written });
      }
    };
    res.on('data', (chunk) => {
      if (cancelToken && cancelToken.cancelled) {
        res.destroy();
        cleanup(new Error('cancelled'));
        return;
      }
      written += chunk.length;
      const now = Date.now();
      if (onProgress && (now - lastEmit > 250 || (total && written === total))) {
        lastEmit = now;
        onProgress({ loaded: written, total, pct: total ? (written / total) : 0 });
      }
    });
    res.pipe(out);
    out.on('finish', () => cleanup(null));
    res.on('error', cleanup);
    out.on('error', cleanup);
  });
}

// ── GPU detection ─────────────────────────────────────

/**
 * Detect GPU trên máy → chọn variant llama.cpp tối ưu.
 * NVIDIA → cuda · AMD/Intel → vulkan · không có → cpu
 */
let _gpuCache = null;
async function detectGpu(force = false) {
  if (_gpuCache && !force) return _gpuCache;
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      const r = { vendor: 'unknown', name: '', variant: 'cpu', hint: 'Non-Windows — default to CPU' };
      _gpuCache = r; return resolve(r);
    }
    const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"';
    exec(cmd, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) {
        const r = { vendor: 'none', name: '', variant: 'cpu', hint: 'Không liệt kê được GPU → CPU' };
        _gpuCache = r; return resolve(r);
      }
      const names = (stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const isVirtual = (n) => /microsoft basic|hyper-v|virtio|qemu|vmware|parallels|remote display|teamviewer/i.test(n);
      const real = names.filter(n => !isVirtual(n));

      // Priority: NVIDIA (CUDA) > AMD (Vulkan) > Intel (Vulkan/SYCL) > fallback CPU
      const nvidia = real.find(n => /nvidia|geforce|quadro|tesla|rtx|gtx/i.test(n));
      if (nvidia) {
        const r = { vendor: 'nvidia', name: nvidia, variant: 'cuda', hint: 'NVIDIA detected → CUDA' };
        _gpuCache = r; return resolve(r);
      }
      const amd = real.find(n => /amd radeon|^amd |\bradeon\b|navi|vega|\brx \d/i.test(n));
      if (amd) {
        const r = { vendor: 'amd', name: amd, variant: 'vulkan', hint: 'AMD detected → Vulkan' };
        _gpuCache = r; return resolve(r);
      }
      const intelArc = real.find(n => /intel.*arc|arc.*graphics/i.test(n));
      if (intelArc) {
        const r = { vendor: 'intel-arc', name: intelArc, variant: 'vulkan', hint: 'Intel Arc detected → Vulkan' };
        _gpuCache = r; return resolve(r);
      }
      const intelIgpu = real.find(n => /intel.*(iris|uhd|hd graphics|xe graphics)/i.test(n));
      if (intelIgpu) {
        const r = { vendor: 'intel-igpu', name: intelIgpu, variant: 'vulkan', hint: 'Intel iGPU detected → Vulkan' };
        _gpuCache = r; return resolve(r);
      }
      if (real.length > 0) {
        const r = { vendor: 'unknown', name: real[0], variant: 'vulkan', hint: 'GPU unknown → thử Vulkan' };
        _gpuCache = r; return resolve(r);
      }
      const r = { vendor: 'none', name: '', variant: 'cpu', hint: 'Không có GPU → CPU' };
      _gpuCache = r; return resolve(r);
    });
  });
}

// ── llama-server binary download ──────────────────────

const LLAMA_REPO = 'ggml-org/llama.cpp';

async function findLlamaAsset(variant = 'vulkan') {
  const info = await fetchJson(`https://api.github.com/repos/${LLAMA_REPO}/releases/latest`);
  const assets = info.assets || [];
  const want = new RegExp(`llama-.*-bin-win-${variant}-x64\\.zip$`, 'i');
  let asset = assets.find(a => want.test(a.name));
  if (!asset) asset = assets.find(a => /llama-.*-bin-win-.*-x64\.zip$/i.test(a.name));
  if (!asset) throw new Error('Không tìm thấy asset Windows x64 trong release');
  return { tag: info.tag_name, name: asset.name, url: asset.browser_download_url, size: asset.size };
}

function expandZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`;
    exec(cmd, { windowsHide: true }, (err, _, stderr) => {
      if (err) return reject(new Error('Expand-Archive: ' + (stderr || err.message)));
      resolve();
    });
  });
}

function flattenBinaryDir(binaryDir) {
  try {
    const entries = fs.readdirSync(binaryDir, { withFileTypes: true });
    if (entries.some(e => e.isFile() && e.name === 'llama-server.exe')) return;
    const subDirs = entries.filter(e => e.isDirectory()).map(e => path.join(binaryDir, e.name));
    for (const sub of subDirs) {
      for (const f of fs.readdirSync(sub)) {
        try { fs.renameSync(path.join(sub, f), path.join(binaryDir, f)); } catch {}
      }
      try { fs.rmdirSync(sub); } catch {}
    }
  } catch (e) { console.warn('[local-llm] flatten:', e.message); }
}

async function downloadLlamaBinary({ variant = 'auto', onProgress } = {}) {
  const d = ensureDirs();
  // Auto-detect nếu variant='auto'
  let resolvedVariant = variant;
  let detected = null;
  if (variant === 'auto') {
    onProgress?.({ stage: 'metadata', pct: 0, msg: 'Đang detect GPU…' });
    detected = await detectGpu(true);
    resolvedVariant = detected.variant;
    onProgress?.({ stage: 'metadata', pct: 0, msg: `${detected.hint} (${detected.name || 'CPU'})`, detected });
  }
  let asset;
  try {
    onProgress?.({ stage: 'metadata', pct: 0 });
    asset = await findLlamaAsset(resolvedVariant);
  } catch (e) { return { ok: false, error: 'Tìm release: ' + e.message }; }
  // Lưu variant đã resolve
  state.localBinaryVariant = resolvedVariant;

  const zipPath = path.join(d.tmp, asset.name);
  onProgress?.({ stage: 'downloading', pct: 0, tag: asset.tag, name: asset.name, total: asset.size });
  const dl = await downloadFile(asset.url, zipPath, (p) => onProgress?.({ stage: 'downloading', ...p }));
  if (!dl.ok) return { ok: false, error: 'Tải binary: ' + dl.error };

  onProgress?.({ stage: 'extracting', pct: 1 });
  try {
    try { fs.rmSync(d.binary, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(d.binary, { recursive: true });
    await expandZip(zipPath, d.binary);
    flattenBinaryDir(d.binary);
    try { fs.unlinkSync(zipPath); } catch {}
  } catch (e) { return { ok: false, error: 'Giải nén: ' + e.message }; }

  if (!fs.existsSync(d.binaryExe)) return { ok: false, error: 'Không tìm thấy llama-server.exe sau giải nén' };
  onProgress?.({ stage: 'done', pct: 1, path: d.binaryExe, tag: asset.tag, variant: resolvedVariant });
  return { ok: true, path: d.binaryExe, tag: asset.tag, variant: resolvedVariant, detected };
}

// ── Model download (single + multi-part split) ────────

const _activeDownloads = new Map();

function parseSplitUrl(url) {
  const m = url.match(/^(.*-)(\d{5})-of-(\d{5})(\.[a-z0-9]+)(\?.*)?$/i);
  if (!m) return null;
  return { prefix: m[1], current: Number(m[2]), total: Number(m[3]), ext: m[4], query: m[5] || '', pad: m[2].length };
}

function splitUrlAt(info, n) {
  return info.prefix + String(n).padStart(info.pad, '0') + '-of-' + String(info.total).padStart(info.pad, '0') + info.ext + info.query;
}

async function downloadModel({ id, url, filename, onProgress }) {
  if (!url) return { ok: false, error: 'Thiếu URL' };
  const d = ensureDirs();
  const cancelToken = { cancelled: false };
  _activeDownloads.set(id, cancelToken);
  const split = parseSplitUrl(url);

  const downloadOne = async (oneUrl, oneFilename, partIdx = null, partTotal = null, baseBytes = 0, grandTotal = 0) => {
    let safe = oneFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!/\.gguf$/i.test(safe)) safe += '.gguf';   // auto add extension
    const dest = path.join(d.models, safe);
    if (fs.existsSync(dest)) return { ok: true, path: dest, cached: true, bytes: fs.statSync(dest).size };
    const r = await downloadFile(oneUrl, dest, (p) => {
      const loaded = baseBytes + (p.loaded || 0);
      const total  = grandTotal || (baseBytes + (p.total || 0));
      onProgress?.({ stage: 'downloading', loaded, total, pct: total ? loaded / total : 0, partIdx, partTotal });
    }, cancelToken);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, path: dest, bytes: r.bytesWritten };
  };

  try {
    if (!split) {
      const fn = filename || path.basename(new URL(url).pathname) || 'model.gguf';
      onProgress?.({ stage: 'downloading', pct: 0 });
      const r = await downloadOne(url, fn);
      if (!r.ok) return { ok: false, error: r.error };
      onProgress?.({ stage: 'done', pct: 1, path: r.path, cached: r.cached });
      return r;
    }
    onProgress?.({ stage: 'metadata', pct: 0, partTotal: split.total });
    let totalBytes = 0, downloadedBytes = 0;
    const firstName = filename || (split.prefix.split('/').pop() + '00001-of-' + String(split.total).padStart(split.pad, '0') + split.ext);
    for (let i = 1; i <= split.total; i++) {
      if (cancelToken.cancelled) return { ok: false, error: 'cancelled' };
      const partUrl  = splitUrlAt(split, i);
      const partName = firstName.replace(/(\d{5})-of-(\d{5})/, String(i).padStart(5, '0') + '-of-' + String(split.total).padStart(5, '0'));
      const r = await downloadOne(partUrl, partName, i, split.total, downloadedBytes, totalBytes);
      if (!r.ok) return { ok: false, error: `Part ${i}/${split.total}: ${r.error}` };
      downloadedBytes += (r.bytes || 0);
      if (i === 1 && r.bytes) totalBytes = r.bytes * split.total;
    }
    const firstPath = path.join(d.models, firstName.replace(/[^a-zA-Z0-9._-]/g, '_'));
    onProgress?.({ stage: 'done', pct: 1, path: firstPath, partTotal: split.total });
    return { ok: true, path: firstPath, parts: split.total };
  } finally {
    _activeDownloads.delete(id);
  }
}

function cancelDownload(id) {
  const t = _activeDownloads.get(id);
  if (t) t.cancelled = true;
  return !!t;
}

// ── Server lifecycle ──────────────────────────────────

function listAvailableModels() {
  try {
    const dir = dirs().models;
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => /\.gguf$/i.test(f))
      .map(f => ({ name: f, size: (fs.statSync(path.join(dir, f)).size) }));
  } catch { return []; }
}

// Extract "model size tokens" như 1.7b / 0.6b / 7b / 14b để so sánh chính xác
function extractSizeTokens(s) {
  const m = (s || '').toLowerCase().match(/\d+(?:\.\d+)?\s*b\b/g) || [];
  return new Set(m.map(t => t.replace(/\s+/g, '')));
}

function resolveModelPath(name) {
  if (!name) return { path: null, found: false };
  const d = dirs();
  const candidates = [
    name.endsWith('.gguf') ? name : name + '.gguf',
    name,
  ];
  for (const c of candidates) {
    const full = path.join(d.models, c);
    if (fs.existsSync(full)) return { path: full, found: true };
  }
  // Fuzzy chỉ chấp nhận khi size token (1.7b/0.6b…) khớp — tránh main match nhầm draft
  const wantSize = extractSizeTokens(name);
  if (wantSize.size > 0) {
    for (const f of listAvailableModels()) {
      const fSize = extractSizeTokens(f.name);
      for (const s of wantSize) {
        if (fSize.has(s)) {
          return { path: path.join(d.models, f.name), found: true, fuzzy: true, actualName: f.name };
        }
      }
    }
  }
  return { path: path.join(d.models, candidates[0]), found: false };
}

function serverStatus() {
  const d = dirs();
  const modelName = state.localModel || 'Qwen_Qwen3-1.7B-Q4_K_M.gguf';
  const draftName = state.localDraftModel || 'Qwen_Qwen3-0.6B-Q4_0.gguf';
  const m = resolveModelPath(modelName);
  const dr = resolveModelPath(draftName);
  return {
    binaryReady: fs.existsSync(d.binaryExe),
    binaryPath:  d.binaryExe,
    modelReady:  m.found,
    modelPath:   m.path,
    modelFuzzy:  m.fuzzy ? m.actualName : null,
    draftReady:  dr.found,
    draftPath:   dr.path,
    draftFuzzy:  dr.fuzzy ? dr.actualName : null,
    running:     !!(state.localServerProc && !state.localServerProc.killed),
    pid:         state.localServerProc ? state.localServerProc.pid : null,
    port:        state.localServerPort || 8080,
    available:   listAvailableModels(),
  };
}

// Auto-detect số P-core hợp lý (heuristic): max 8, đa số CPU 6-core desktop = 6
function detectPCores() {
  const total = os.cpus().length;
  // Hyperthreading/SMT: số logical thường = 2x physical → chia 2
  // Intel hybrid: cap ở 8 P-core max của Ultra series
  if (total >= 12) return Math.min(8, Math.floor(total / 2)); // SMT/HT detected
  if (total >= 8)  return 6;  // Likely 8-core no-HT (Ultra 5 P-cores or similar)
  return Math.max(2, total - 1); // Small CPU
}

async function startServer({ port = 8080, ctxSize = 4096, threads, draftMax = 8, draftMin = 2, ngl } = {}) {
  if (state.localServerProc) return { ok: true, alreadyRunning: true, pid: state.localServerProc.pid };
  const st = serverStatus();
  if (!st.binaryReady) return { ok: false, error: 'Chưa tải llama-server binary' };
  if (!st.modelReady)  return { ok: false, error: `Chưa tải model: ${path.basename(st.modelPath)}` };

  const t = threads || detectPCores();
  // ngl: offload N layer lên GPU. Variant CPU → 0; còn lại → 99 (offload tất cả)
  const variant = state.localBinaryVariant || 'cpu';
  const gpuLayers = (ngl !== undefined) ? ngl : (variant === 'cpu' ? 0 : 99);

  const args = [
    '-m',  st.modelPath,
    '--port', String(port),
    '--host', '127.0.0.1',
    '-c',  String(ctxSize),
    '-t',  String(t),       // số thread = P-core (KHÔNG dùng SMT/HT)
    '-tb', String(t),
    '-ngl', String(gpuLayers),  // 0 = CPU only, 99 = offload tất cả lên Vulkan/SYCL/CUDA
    '-fa', 'on',            // flash-attention
    '--no-mmap',            // load thẳng vào RAM
    '-ctk', 'q8_0',
    '-ctv', 'q8_0',
  ];
  if (st.draftReady) {
    // llama.cpp mới: --draft-max/--draft-min → --spec-draft-n-max/--spec-draft-n-min
    args.push('-md', st.draftPath, '--spec-draft-n-max', String(draftMax), '--spec-draft-n-min', String(draftMin));
  }
  console.log(`[local-llm] spawn (variant=${variant}, -ngl=${gpuLayers}, -t=${t}):`, st.binaryPath);

  return new Promise((resolve) => {
    const proc = spawn(st.binaryPath, args, {
      cwd: path.dirname(st.binaryPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    state.localServerProc = proc;
    state.localServerPort = port;
    let resolved = false;

    const handleOut = (b) => {
      const s = b.toString();
      console.log('[llama-server]', s.trim().slice(0, 200));
      if (!resolved && /listening|HTTP server|server is listening|main loop/i.test(s)) {
        resolved = true;
        resolve({ ok: true, pid: proc.pid, port, threads: t, variant, gpuLayers });
      }
    };
    proc.stdout.on('data', handleOut);
    proc.stderr.on('data', handleOut);
    proc.on('exit', (code, sig) => {
      console.log('[local-llm] exit code=', code, 'sig=', sig);
      state.localServerProc = null;
      if (!resolved) { resolved = true; resolve({ ok: false, error: `Process exit ${code}` }); }
    });
    proc.on('error', (e) => {
      state.localServerProc = null;
      if (!resolved) { resolved = true; resolve({ ok: false, error: e.message }); }
    });
    // Fallback: 30s không thấy log "listening" → giả định đang load model
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: true, pid: proc.pid, port, threads: t, note: 'Đang load model, có thể chưa sẵn sàng' });
      }
    }, 30000);
  });
}

function stopServer() {
  const p = state.localServerProc;
  if (!p) return { ok: true, alreadyStopped: true };
  try {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${p.pid} /T /F`, { windowsHide: true }, () => {});
    } else {
      p.kill('SIGTERM');
      setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 3000);
    }
  } catch (e) { console.warn('[local-llm] stop error:', e.message); }
  state.localServerProc = null;
  return { ok: true };
}

module.exports = {
  dirs, ensureDirs,
  downloadLlamaBinary, downloadModel, cancelDownload,
  startServer, stopServer, serverStatus,
  detectPCores, detectGpu,
};
