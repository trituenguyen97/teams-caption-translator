/**
 * local-llm.js — Quản lý llama.cpp binary + model download + server lifecycle
 *
 * - Tải SẴN nhiều binary (cpu + vulkan [+ cuda nếu có NVIDIA]) vào thư mục con theo variant
 * - Lúc start TỰ CHỌN binary phù hợp theo GPU phát hiện được (không phải tải lại)
 * - Tải model GGUF từ URL bất kỳ (HuggingFace, hỗ trợ multi-part split)
 * - Spawn / kill llama-server child process với flag tối ưu CPU/GPU
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
// binRoot chứa các thư mục con theo variant: llama-server/cpu/, /vulkan/, /cuda/
function dirs() {
  const root = path.join(app.getPath('userData'), 'local-llm');
  return {
    root,
    binRoot: path.join(root, 'llama-server'),
    models:  path.join(root, 'models'),
    tmp:     path.join(root, 'tmp'),
  };
}

function ensureDirs() {
  const d = dirs();
  for (const p of [d.root, d.binRoot, d.models, d.tmp]) {
    try { fs.mkdirSync(p, { recursive: true }); } catch {}
  }
  return d;
}

// Ưu tiên backend: cuda > vulkan > cpu
const VARIANTS = ['cuda', 'vulkan', 'cpu'];
function variantDir(v) { return path.join(dirs().binRoot, v); }
function variantExe(v) { return path.join(variantDir(v), 'llama-server.exe'); }

// Các variant đã cài (có llama-server.exe)
function listInstalledVariants() {
  return VARIANTS.filter(v => { try { return fs.existsSync(variantExe(v)); } catch { return false; } });
}

// Chọn variant tối ưu theo GPU trong số đã cài (KHÔNG tải lại). gpu lấy từ detectGpu.
function pickVariant(available, gpu) {
  available = (available && available.length) ? available : listInstalledVariants();
  if (!available.length) return 'cpu';
  if (gpu) {
    if (gpu.vendor === 'nvidia' && available.includes('cuda')) return 'cuda';
    if (gpu.variant !== 'cpu' && available.includes('vulkan')) return 'vulkan';
    if (gpu.variant === 'cpu' && available.includes('cpu'))    return 'cpu';
  }
  // Chưa biết GPU → theo thứ tự ưu tiên VARIANTS trong số đã cài
  return available[0];
}

// Bản chọn hiện tại (sync, dùng cache GPU cho UI)
function selectedVariant() { return pickVariant(listInstalledVariants(), _gpuCache); }

// Chọn variant theo preset. Benchmark thực (Core Ultra 5 225H, 18 lượt/cấu hình):
//   MiLMMT  CPU -t4 = 533ms  |  iGPU = 665ms  → CPU nhanh hơn ~25% (1 model + vocab 262k, iGPU chia sẻ RAM).
//   Qwen3   iGPU   = 605ms  |  CPU = chậm (draft tranh nhân) → Qwen3 hợp GPU.
// → MiLMMT ưu tiên CPU; chỉ offload khi có GPU NVIDIA rời (CUDA, VRAM riêng nên không nghẽn RAM).
//   Các preset khác giữ auto-detect (pickVariant: cuda > vulkan > cpu).
function selectVariantForPreset(available, gpu, preset) {
  available = (available && available.length) ? available : listInstalledVariants();
  if (preset === 'milmmt') {
    if (gpu && gpu.vendor === 'nvidia' && available.includes('cuda')) return 'cuda';
    if (available.includes('cpu')) return 'cpu';
  }
  return pickVariant(available, gpu);
}

// Dọn layout cũ: binary phẳng ở binRoot/llama-server.exe (trước khi có thư mục con theo variant)
function cleanupFlatBinary() {
  try {
    const binRoot = dirs().binRoot;
    if (!fs.existsSync(binRoot)) return;
    for (const e of fs.readdirSync(binRoot, { withFileTypes: true })) {
      if (e.isFile()) { try { fs.unlinkSync(path.join(binRoot, e.name)); } catch {} }
    }
  } catch {}
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
 * Detect GPU trên máy → gợi ý variant llama.cpp tối ưu.
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

// ── llama-server binary download (multi-variant) ──────

const LLAMA_REPO = 'ggml-org/llama.cpp';

// Tìm asset cho từng variant + gói cudart (CUDA runtime) trong release mới nhất.
async function findLlamaAssets(variants) {
  const info = await fetchJson(`https://api.github.com/repos/${LLAMA_REPO}/releases/latest`);
  const assets = info.assets || [];
  const byVariant = {};
  for (const v of variants) {
    // Cho phép hậu tố version (vd cuda-12.4-x64). Loại trừ asset 'cudart-...'
    const re = new RegExp('^llama-.*-bin-win-' + v + '[^/]*-x64\\.zip$', 'i');
    const a = assets.find(x => re.test(x.name));
    if (a) byVariant[v] = { name: a.name, url: a.browser_download_url, size: a.size };
  }
  let cudart = null;
  const c = assets.find(x => /^cudart-.*-x64\.zip$/i.test(x.name));
  if (c) cudart = { name: c.name, url: c.browser_download_url, size: c.size };
  return { tag: info.tag_name, byVariant, cudart };
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

// Nếu zip giải nén ra thư mục con (không có llama-server.exe ở gốc) → kéo file lên gốc
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

// Tải + giải nén 1 variant vào thư mục riêng. CUDA kèm cudart DLLs.
async function downloadOneBinary(variant, asset, cudartAsset, onProgress) {
  const d = ensureDirs();
  const vdir = variantDir(variant);
  const zipPath = path.join(d.tmp, asset.name);
  onProgress?.({ variant, stage: 'downloading', total: asset.size, loaded: 0 });
  const dl = await downloadFile(asset.url, zipPath, (p) => onProgress?.({ variant, stage: 'downloading', ...p }));
  if (!dl.ok) return { ok: false, error: 'Tải binary: ' + dl.error };

  onProgress?.({ variant, stage: 'extracting' });
  try {
    try { fs.rmSync(vdir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(vdir, { recursive: true });
    await expandZip(zipPath, vdir);
    flattenBinaryDir(vdir);
    try { fs.unlinkSync(zipPath); } catch {}
  } catch (e) { return { ok: false, error: 'Giải nén: ' + e.message }; }

  // CUDA cần cudart DLLs đặt cạnh exe mới chạy được
  if (variant === 'cuda' && cudartAsset) {
    const czip = path.join(d.tmp, cudartAsset.name);
    onProgress?.({ variant, sub: 'cudart', stage: 'downloading', total: cudartAsset.size, loaded: 0 });
    const cdl = await downloadFile(cudartAsset.url, czip, (p) => onProgress?.({ variant, sub: 'cudart', stage: 'downloading', ...p }));
    if (cdl.ok) {
      try { await expandZip(czip, vdir); fs.unlinkSync(czip); } catch (e) { console.warn('[local-llm] cudart:', e.message); }
    }
  }

  if (!fs.existsSync(variantExe(variant))) return { ok: false, error: 'Không thấy llama-server.exe sau giải nén' };
  onProgress?.({ variant, stage: 'done' });
  return { ok: true, path: variantExe(variant) };
}

/**
 * Tải SẴN tất cả binary phù hợp 1 lần: cpu + vulkan (+ cuda nếu có NVIDIA).
 * Sau khi tải, chọn variant tối ưu theo GPU hiện tại. Lúc start sẽ tự chọn lại nên không cần tải lại.
 */
async function downloadAllBinaries({ onProgress } = {}) {
  ensureDirs();
  cleanupFlatBinary();
  onProgress?.({ stage: 'metadata', msg: 'Đang detect GPU…' });
  const gpu = await detectGpu(true);
  // cpu + vulkan luôn (vulkan phủ AMD/Intel/Arc + fallback GPU). cuda chỉ khi có NVIDIA
  // (binary CUDA cần GPU NVIDIA + cudart mới chạy → tải trên máy không NVIDIA là vô ích).
  const variants = ['cpu', 'vulkan'];
  if (gpu.vendor === 'nvidia') variants.push('cuda');

  let assets;
  try { onProgress?.({ stage: 'metadata', msg: `Tải binaries: ${variants.join(', ')}` }); assets = await findLlamaAssets(variants); }
  catch (e) { return { ok: false, error: 'Tìm release: ' + e.message }; }

  const results = {};
  for (const v of variants) {
    const a = assets.byVariant[v];
    if (!a) { results[v] = { ok: false, error: 'không có asset trong release' }; continue; }
    results[v] = await downloadOneBinary(v, a, assets.cudart, onProgress);
  }

  const installed = listInstalledVariants();
  state.localBinaryVariant = pickVariant(installed, gpu);
  onProgress?.({ stage: 'all-done', installed, selected: state.localBinaryVariant });
  return {
    ok: installed.length > 0,
    gpu, tag: assets.tag, variants, results, installed,
    selected: state.localBinaryVariant,
  };
}

// Wrapper tương thích IPC cũ (api.downloadLlamaBinary) → giờ tải tất cả
async function downloadLlamaBinary(opts = {}) { return downloadAllBinaries(opts); }

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

// "Họ model" = token chữ cái dài nhất đầu tiên trong tên (milmmt, qwen, gemma…).
// Dùng để fuzzy KHÔNG khớp nhầm model khác họ cùng size (vd MiLMMT-1B vs gemma-3-1b đều "1b").
function modelFamilyKey(name) {
  const tokens = (name || '').toLowerCase().replace(/\.gguf$/, '').match(/[a-z]{3,}/g) || [];
  return tokens[0] || '';
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
  // Fuzzy chỉ chấp nhận khi CẢ size token (1.7b/0.6b…) LẪN họ model (milmmt/qwen…) khớp —
  // tránh main match nhầm draft VÀ tránh thay nhầm model khác họ cùng size (vd MiLMMT-1B → gemma-3-1b).
  const wantSize = extractSizeTokens(name);
  const wantFamily = modelFamilyKey(name);
  if (wantSize.size > 0 && wantFamily) {
    for (const f of listAvailableModels()) {
      const fSize = extractSizeTokens(f.name);
      const sizeMatch = [...wantSize].some(s => fSize.has(s));
      const familyMatch = f.name.toLowerCase().includes(wantFamily);
      if (sizeMatch && familyMatch) {
        return { path: path.join(d.models, f.name), found: true, fuzzy: true, actualName: f.name };
      }
    }
  }
  return { path: path.join(d.models, candidates[0]), found: false };
}

function serverStatus() {
  const modelName = state.localModel || 'Qwen_Qwen3-1.7B-Q4_K_M.gguf';
  const draftName = state.localDraftModel || 'Qwen_Qwen3-0.6B-Q4_0.gguf';
  const m = resolveModelPath(modelName);
  const dr = resolveModelPath(draftName);
  const installed = listInstalledVariants();
  const selected = selectVariantForPreset(installed, _gpuCache, state.localPreset);
  return {
    binaryReady:      installed.length > 0,
    installedVariants: installed,                                 // các backend đã tải sẵn
    binaryVariant:    selected,                                   // backend sẽ dùng theo GPU hiện tại
    binaryPath:       installed.length ? variantExe(selected) : null,
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

async function startServer({ port = 8080, ctxSize, threads, draftMax = 8, draftMin = 2, ngl } = {}) {
  if (state.localServerProc) return { ok: true, alreadyRunning: true, pid: state.localServerProc.pid };
  const preset = state.localPreset || 'qwen3';
  const isMiLMMT = preset === 'milmmt';
  const st = serverStatus();
  if (!st.binaryReady) return { ok: false, error: 'Chưa tải llama-server binary' };
  if (!st.modelReady)  return { ok: false, error: `Chưa tải model: ${path.basename(st.modelPath)}` };

  // ── TỰ CHỌN binary theo GPU + preset (không tải lại). MiLMMT ưu tiên CPU (xem selectVariantForPreset) ──
  const gpu = await detectGpu();
  const installed = listInstalledVariants();
  const variant = selectVariantForPreset(installed, gpu, preset);
  state.localBinaryVariant = variant;
  const exe = variantExe(variant);
  if (!fs.existsSync(exe)) return { ok: false, error: `Binary '${variant}' chưa tải` };

  // MiLMMT (REPORT_speedup.md): 4 threads (KHÔNG SMT/HT) là điểm ngọt, ctx 2048 đủ cho dịch câu.
  const t   = threads || (isMiLMMT ? 4 : detectPCores());
  const ctx = ctxSize || (isMiLMMT ? 2048 : 4096);
  const gpuLayers = (ngl !== undefined) ? ngl : (variant === 'cpu' ? 0 : 99);
  const onGpu = gpuLayers > 0;
  console.log(`[local-llm] auto-select: preset=${preset} | GPU="${gpu.name || 'none'}" (${gpu.vendor}) | đã cài=[${installed.join(', ')}] → dùng '${variant}', -ngl=${gpuLayers}`);

  const args = [
    '-m',  st.modelPath,
    '--port', String(port),
    '--host', '127.0.0.1',
    '-c',  String(ctx),
    '-t',  String(t),       // số thread (KHÔNG dùng SMT/HT)
    '-tb', String(t),
    '-ngl', String(gpuLayers),  // 0 = CPU only, 99 = offload tất cả lên Vulkan/CUDA
  ];

  if (isMiLMMT) {
    // ── Tăng tốc MiLMMT theo REPORT_speedup.md ── (binary cpu/vulkan/cuda tự chọn như Qwen3)
    // --poll 0  : luồng ngủ giữa request → idle ~0% CPU, không lag việc khác
    // --mlock   : ghim model trong RAM (~1GB), tránh swap → latency ổn định
    // CPU: KHÔNG -fa (không lợi ở ctx ngắn, -t4 còn chậm hơn — đã kiểm chứng); GPU: -fa auto
    // KHÔNG draft/speculative : llama.cpp build này không expose tốt + lợi ích thấp trên CPU
    // greedy temp 0 + top_k 1 : truyền theo từng request trong translateLocalMiLMMT
    args.push('--poll', '0', '--mlock');
    if (onGpu) args.push('-fa', 'auto');   // chỉ bật fa khi offload GPU (iGPU Vulkan / CUDA)
    console.log(`[local-llm] spawn (MiLMMT: variant=${variant}, -ngl=${gpuLayers}, -t=${t}, -c=${ctx}, --poll 0 --mlock, fa=${onGpu ? 'auto' : 'off'}):`, exe);
  } else {
    args.push('--no-mmap');   // load thẳng vào RAM
    // Flash-attention + KV cache quant: chỉ ép trên CPU.
    // Trên Vulkan/CUDA, KV q8_0 hỗ trợ hạn chế → ép attention rớt về CPU → dùng -fa auto + KV f16.
    if (onGpu) {
      args.push('-fa', 'auto');
    } else {
      args.push('-fa', 'on', '-ctk', 'q8_0', '-ctv', 'q8_0');
    }
    if (st.draftReady) {
      args.push('-md', st.draftPath, '--spec-draft-n-max', String(draftMax), '--spec-draft-n-min', String(draftMin));
      if (onGpu) args.push('-ngld', String(gpuLayers));  // offload draft model lên GPU luôn
    }
    console.log(`[local-llm] spawn (variant=${variant}, -ngl=${gpuLayers}${onGpu && st.draftReady ? ', -ngld=' + gpuLayers : ''}, -t=${t}, fa=${onGpu ? 'auto' : 'on'}, kv=${onGpu ? 'f16' : 'q8_0'}):`, exe);
  }

  return new Promise((resolve) => {
    const proc = spawn(exe, args, {
      cwd: variantDir(variant),   // để DLL của variant resolve đúng
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
        resolve({ ok: true, pid: proc.pid, port, threads: t, variant, note: 'Đang load model, có thể chưa sẵn sàng' });
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
  downloadLlamaBinary, downloadAllBinaries, downloadModel, cancelDownload,
  startServer, stopServer, serverStatus,
  detectPCores, detectGpu,
  listInstalledVariants, selectedVariant, pickVariant,
};
