#!/usr/bin/env node
/**
 * fetch-binaries.js — Tải llama-server binary vào ./bin để electron-builder đóng gói (extraResources).
 *
 * Chạy lúc BUILD (npm run build → prebuild tự gọi). Tải SẴN cpu + vulkan + cuda (kèm cudart) từ
 * release mới nhất của ggml-org/llama.cpp vào bin/llama-server/<variant>/. Người dùng cuối KHÔNG cần
 * tải gì — app chạy thẳng binary bundle (xem bundleDirs() trong src/local-llm.js).
 *
 * Idempotent: variant đã có llama-server.exe → bỏ qua (build lại nhanh). Đặt FETCH_VARIANTS=cpu,vulkan
 * để giới hạn. Standalone: chỉ dùng Node built-in + PowerShell Expand-Archive (Windows).
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LLAMA_REPO = 'ggml-org/llama.cpp';
const BIN_ROOT = path.join(__dirname, '..', 'bin', 'llama-server');
const TMP = path.join(__dirname, '..', 'bin', '_tmp');
const VARIANTS = (process.env.FETCH_VARIANTS || 'cpu,vulkan,cuda')
  .split(',').map(s => s.trim()).filter(Boolean);

function log(...a) { console.log('[fetch-binaries]', ...a); }

function _request(url, headers = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'caption-translator-build/1.0', 'Accept': '*/*', ...headers },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        res.resume();
        return _request(new URL(res.headers.location, url).toString(), headers, redirectsLeft - 1).then(resolve, reject);
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(120_000, () => req.destroy(new Error('Request timeout')));
  });
}

async function fetchJson(url) {
  const res = await _request(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode} from ${url}`); }
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function downloadFile(url, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const res = await _request(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode}`); }
  const total = Number(res.headers['content-length'] || 0);
  let written = 0, lastPct = -1;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath + '.partial');
    res.on('data', (c) => {
      written += c.length;
      if (total) {
        const pct = Math.floor((written / total) * 100);
        if (pct >= lastPct + 5) { lastPct = pct; process.stdout.write(`\r    ${pct}% (${(written / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB)   `); }
      }
    });
    res.pipe(out);
    out.on('finish', resolve);
    res.on('error', reject);
    out.on('error', reject);
  });
  process.stdout.write('\n');
  fs.renameSync(destPath + '.partial', destPath);
}

function expandZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
  ], { stdio: 'inherit', windowsHide: true });
}

// Kéo file từ thư mục con lên gốc nếu zip giải nén ra subfolder (không có llama-server.exe ở gốc)
function flatten(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.some(e => e.isFile() && e.name === 'llama-server.exe')) return;
  for (const sub of entries.filter(e => e.isDirectory()).map(e => path.join(dir, e.name))) {
    for (const f of fs.readdirSync(sub)) {
      try { fs.renameSync(path.join(sub, f), path.join(dir, f)); } catch {}
    }
    try { fs.rmdirSync(sub); } catch {}
  }
}

async function findAssets(variants) {
  const info = await fetchJson(`https://api.github.com/repos/${LLAMA_REPO}/releases/latest`);
  const assets = info.assets || [];
  const byVariant = {};
  for (const v of variants) {
    const re = new RegExp('^llama-.*-bin-win-' + v + '[^/]*-x64\\.zip$', 'i');
    const a = assets.find(x => re.test(x.name));
    if (a) byVariant[v] = { name: a.name, url: a.browser_download_url, size: a.size };
  }
  const c = assets.find(x => /^cudart-.*-x64\.zip$/i.test(x.name));
  return { tag: info.tag_name, byVariant, cudart: c ? { name: c.name, url: c.browser_download_url } : null };
}

async function fetchOne(variant, asset, cudartAsset) {
  const vdir = path.join(BIN_ROOT, variant);
  if (fs.existsSync(path.join(vdir, 'llama-server.exe'))) { log(`✓ ${variant}: đã có, bỏ qua`); return true; }
  fs.rmSync(vdir, { recursive: true, force: true });
  fs.mkdirSync(vdir, { recursive: true });

  const zip = path.join(TMP, asset.name);
  log(`↓ ${variant}: ${asset.name} (${(asset.size / 1e6).toFixed(0)} MB)`);
  await downloadFile(asset.url, zip);
  log(`  giải nén ${variant}…`);
  expandZip(zip, vdir);
  flatten(vdir);
  try { fs.unlinkSync(zip); } catch {}

  if (variant === 'cuda' && cudartAsset) {
    const czip = path.join(TMP, cudartAsset.name);
    log(`↓ cudart (CUDA runtime DLLs): ${cudartAsset.name}`);
    await downloadFile(cudartAsset.url, czip);
    expandZip(czip, vdir);   // đặt cudart DLLs cạnh exe
    try { fs.unlinkSync(czip); } catch {}
  }

  if (!fs.existsSync(path.join(vdir, 'llama-server.exe'))) throw new Error(`${variant}: không thấy llama-server.exe sau giải nén`);
  log(`✓ ${variant}: xong`);
  return true;
}

(async () => {
  if (process.platform !== 'win32') {
    log('Chỉ hỗ trợ Windows (Expand-Archive). Bỏ qua trên', process.platform);
    process.exit(0);
  }
  fs.mkdirSync(BIN_ROOT, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });

  // Bỏ qua hẳn nếu tất cả variant đã có (build lại nhanh, không gọi GitHub API)
  if (VARIANTS.every(v => fs.existsSync(path.join(BIN_ROOT, v, 'llama-server.exe')))) {
    log('Tất cả variant đã có:', VARIANTS.join(', '), '→ bỏ qua');
    process.exit(0);
  }

  log('Tìm release mới nhất ggml-org/llama.cpp cho:', VARIANTS.join(', '));
  const { tag, byVariant, cudart } = await findAssets(VARIANTS);
  log('Release:', tag);

  let okCount = 0;
  for (const v of VARIANTS) {
    const a = byVariant[v];
    if (!a) { log(`✗ ${v}: không có asset trong release ${tag} — bỏ qua`); continue; }
    try { await fetchOne(v, a, cudart); okCount++; }
    catch (e) { console.error(`[fetch-binaries] ✗ ${v}:`, e.message); }
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

  if (okCount === 0) { console.error('[fetch-binaries] KHÔNG tải được variant nào'); process.exit(1); }
  log(`Hoàn tất: ${okCount}/${VARIANTS.length} variant trong bin/llama-server/`);
})().catch((e) => { console.error('[fetch-binaries] LỖI:', e.message); process.exit(1); });
