#!/usr/bin/env node
/**
 * fetch-stt-model.js — Tải model STT (sherpa-onnx) cho NHÁNH FALLBACK vào ./bin/stt/<dir>/ để bundle.
 *
 * THAY Whisper-small đa ngữ bằng BẢN ĐỒ MODEL THEO NGÔN NGỮ (xem src/stt.js):
 *   zh-en → streaming Paraformer bilingual zh-en (FunASR)  [online, zh + en]
 *   ko    → streaming Zipformer Korean                     [online]
 *   ja    → Zipformer ReazonSpeech (Nhật)                  [offline + VAD]  ← không có model streaming Nhật
 *   vi    → Zipformer Vietnamese                           [offline + VAD]  ← không có model streaming Việt
 * + silero_vad.onnx (cắt câu cho nhánh offline ja/vi).
 *
 * Chuẩn hoá tên file về encoder.onnx / decoder.onnx / joiner.onnx / tokens.txt (build copy bản int8-ưu-tiên).
 * Chạy lúc BUILD (npm run build → prebuild). Người dùng cuối KHÔNG phải tải gì. Idempotent: đã có thì bỏ qua.
 * (ja lấy từ GitHub release .tar.bz2 → cần `tar` trên máy build; 3 model còn lại lấy file int8 lẻ từ HuggingFace.)
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '..', 'bin', 'stt');
const HF = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file}`;
const GH = (asset) => `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${asset}`;

// ⭐ NEMOTRON 5-in-1 (2026-06): MỘT model NVIDIA Nemotron-3.5-ASR-Streaming-0.6B int4 cho cả ja/en/ko/zh/vi,
// chạy thuần onnxruntime-node (src/stt-nemotron.js: mel + cache-aware FastConformer + RNN-T, dấu câu native).
// Thay TOÀN BỘ 5 model per-language cũ (paraformer/gigaspeech/moonshine/reazonspeech/zipformer-vi) + punct.
// genai-format từ onnx-community (encoder/decoder/joint + .onnx.data + genai_config + vocab). ~757MB.
const NEMO_REPO = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
const MODELS = [
  { dir: 'nemotron-int4', desc: 'NVIDIA Nemotron-3.5-ASR-Streaming 0.6B int4 (5-in-1: ja/en/ko/zh/vi)', files: [
    { url: HF(NEMO_REPO, 'encoder.onnx'),       as: 'encoder.onnx' },
    { url: HF(NEMO_REPO, 'encoder.onnx.data'),  as: 'encoder.onnx.data' },
    { url: HF(NEMO_REPO, 'decoder.onnx'),       as: 'decoder.onnx' },
    { url: HF(NEMO_REPO, 'decoder.onnx.data'),  as: 'decoder.onnx.data' },
    { url: HF(NEMO_REPO, 'joint.onnx'),         as: 'joint.onnx' },
    { url: HF(NEMO_REPO, 'joint.onnx.data'),    as: 'joint.onnx.data' },
    { url: HF(NEMO_REPO, 'genai_config.json'),  as: 'genai_config.json' },
    { url: HF(NEMO_REPO, 'vocab.txt'),          as: 'vocab.txt' },
  ] },
];
const SILERO = { url: GH('silero_vad.onnx'), dest: path.join(OUT_DIR, 'silero_vad.onnx') };   // VAD cắt câu (offline pseudo-stream)

function log(...a) { console.log('[fetch-stt-model]', ...a); }

function _request(url, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch (e) { return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers: { 'User-Agent': 'caption-translator-build/1.0', 'Accept': '*/*' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
        res.resume();
        return _request(new URL(res.headers.location, url).toString(), redirectsLeft - 1).then(resolve, reject);
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(600000, () => req.destroy(new Error('timeout')));
  });
}

async function download(url, dest) {
  const res = await _request(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error('HTTP ' + res.statusCode + ' @ ' + url); }
  const total = Number(res.headers['content-length'] || 0);
  let written = 0, lastPct = -1;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest + '.partial');
    res.on('data', c => { written += c.length; if (total) { const p = Math.floor(written / total * 100); if (p >= lastPct + 5) { lastPct = p; process.stdout.write(`\r    ${path.basename(dest)} ${p}% (${(written/1e6).toFixed(0)}/${(total/1e6).toFixed(0)} MB)   `); } } });
    res.pipe(out); out.on('finish', resolve); res.on('error', reject); out.on('error', reject);
  });
  if (total && written !== total) { try { fs.unlinkSync(dest + '.partial'); } catch {} throw new Error(`tải thiếu ${written}/${total}`); }
  fs.renameSync(dest + '.partial', dest);
  if (total) process.stdout.write('\n');
}

// Liệt kê file (đệ quy) trong thư mục → mảng đường dẫn tuyệt đối.
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

async function fetchHfModel(m, dir) {
  for (const f of m.files) {
    const dest = path.join(dir, f.as);
    if (fs.existsSync(dest)) { log('  ✓', f.as, '(đã có)'); continue; }
    log('  ↓', f.as, '←', f.url.split('/resolve/main/')[1]);
    await download(f.url, dest);
  }
}

async function fetchArchiveModel(m, dir) {
  const tmpTar = path.join(os.tmpdir(), 'ct-stt-' + m.dir + '.tar.bz2');
  const tmpDir = path.join(os.tmpdir(), 'ct-stt-' + m.dir);
  log('  ↓ archive', path.basename(m.archive), '(gồm cả fp32 — sẽ bỏ sau khi rút int8)');
  await download(m.archive, tmpTar);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(tmpDir, { recursive: true });
  // -xf (KHÔNG -j): để tar TỰ nhận diện bz2 và giải nén nội bộ (bsdtar/libarchive + GNU tar ≥1.22 đều được).
  // Dùng -j ép GNU tar pipe qua bzip2.exe ngoài — trên Windows hay lỗi "corrupted"/exit 128.
  try { execFileSync('tar', ['-xf', tmpTar, '-C', tmpDir], { stdio: 'inherit' }); }
  catch (e) { throw new Error('giải nén tar lỗi (cần `tar` hỗ trợ bz2 trên máy build): ' + e.message); }
  const all = walk(tmpDir);
  for (const p of m.pick) {
    let src = null;
    for (const re of p.prefer) { src = all.find(f => re.test(f.replace(/\\/g, '/'))); if (src) break; }
    if (!src) throw new Error(`không tìm thấy file cho ${p.as} trong ${m.archive}`);
    fs.copyFileSync(src, path.join(dir, p.as));
    log('  ✓', p.as, '←', path.basename(src));
  }
  try { fs.unlinkSync(tmpTar); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

function modelComplete(m, dir) {
  const need = m.files ? m.files.map(f => f.as) : m.pick.map(p => p.as);
  return need.every(n => fs.existsSync(path.join(dir, n)));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const m of MODELS) {
    const dir = path.join(OUT_DIR, m.dir);
    fs.mkdirSync(dir, { recursive: true });
    if (modelComplete(m, dir)) { log('✓', m.dir, '—', m.desc, '(đã đủ)'); continue; }
    log('↓', m.dir, '—', m.desc);
    if (m.files) await fetchHfModel(m, dir); else await fetchArchiveModel(m, dir);
  }
  if (!fs.existsSync(SILERO.dest)) { log('↓ silero_vad.onnx (VAD cắt câu)'); await download(SILERO.url, SILERO.dest); }
  else log('✓ silero_vad.onnx (đã có)');
  // Nemotron ra dấu câu + viết hoa NATIVE → KHÔNG cần model punctuation riêng (đã bỏ punct/en + export-punc-ja).
  log('xong → bin/stt/{' + MODELS.map(m => m.dir).join(',') + '} + silero_vad.onnx');
})().catch(e => { console.error('\n[fetch-stt-model] LỖI:', e.message); process.exit(1); });
