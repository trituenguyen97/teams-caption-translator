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

// files: tải file lẻ từ HF rồi đổi tên (as). archive+pick: tải .tar.bz2 từ GH, giải nén, chọn file theo regex.
const MODELS = [
  { dir: 'zh-en', desc: 'streaming Paraformer bilingual zh-en (FunASR) [online zh/en]', files: [
    { url: HF('csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en', 'encoder.int8.onnx'), as: 'encoder.onnx' },
    { url: HF('csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en', 'decoder.int8.onnx'), as: 'decoder.onnx' },
    { url: HF('csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en', 'tokens.txt'),         as: 'tokens.txt' },
  ] },
  { dir: 'en', desc: 'streaming Zipformer English GigaSpeech 2023-06-21 [online en]', files: [
    { url: HF('csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21', 'encoder-epoch-99-avg-1.int8.onnx'), as: 'encoder.onnx' },
    { url: HF('csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21', 'decoder-epoch-99-avg-1.int8.onnx'), as: 'decoder.onnx' },
    { url: HF('csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21', 'joiner-epoch-99-avg-1.int8.onnx'),  as: 'joiner.onnx' },
    { url: HF('csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-21', 'tokens.txt'),                       as: 'tokens.txt' },
  ] },
  // ko: Moonshine base-ko (đơn ngữ, int8 ~62MB) — chạy qua onnxruntime-node (src/stt-moonshine.js), KHÔNG phải sherpa
  // (format ONNX transformers.js, sherpa không nạp). A/B: ≈ Live Captions, hơn hẳn zipformer-ko (cả streaming lẫn offline).
  { dir: 'ko', desc: 'Moonshine base-ko (onnxruntime, offline+VAD) [ko]', files: [
    { url: HF('onnx-community/moonshine-base-ko-ONNX', 'onnx/encoder_model_int8.onnx'),        as: 'encoder_model_int8.onnx' },
    { url: HF('onnx-community/moonshine-base-ko-ONNX', 'onnx/decoder_model_merged_int8.onnx'), as: 'decoder_model_merged_int8.onnx' },
    { url: HF('onnx-community/moonshine-base-ko-ONNX', 'tokenizer.json'),                      as: 'tokenizer.json' },
    { url: HF('onnx-community/moonshine-base-ko-ONNX', 'config.json'),                        as: 'config.json' },
  ] },
  { dir: 'vi', desc: 'Zipformer Vietnamese [offline vi]', files: [
    { url: HF('csukuangfj/sherpa-onnx-zipformer-vi-int8-2025-04-20', 'encoder-epoch-12-avg-8.int8.onnx'), as: 'encoder.onnx' },
    { url: HF('csukuangfj/sherpa-onnx-zipformer-vi-int8-2025-04-20', 'decoder-epoch-12-avg-8.onnx'),      as: 'decoder.onnx' },  // decoder chỉ có bản fp32 (nhỏ)
    { url: HF('csukuangfj/sherpa-onnx-zipformer-vi-int8-2025-04-20', 'joiner-epoch-12-avg-8.int8.onnx'),  as: 'joiner.onnx' },
    { url: HF('csukuangfj/sherpa-onnx-zipformer-vi-int8-2025-04-20', 'tokens.txt'),                       as: 'tokens.txt' },
  ] },
  { dir: 'ja', desc: 'Zipformer ReazonSpeech Japanese [offline ja]', archive: GH('sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01.tar.bz2'),
    pick: [
      { as: 'encoder.onnx', prefer: [/encoder.*\.int8\.onnx$/i, /encoder.*\.onnx$/i] },
      { as: 'decoder.onnx', prefer: [/decoder.*\.int8\.onnx$/i, /decoder.*\.onnx$/i] },
      { as: 'joiner.onnx',  prefer: [/joiner.*\.int8\.onnx$/i,  /joiner.*\.onnx$/i] },
      { as: 'tokens.txt',   prefer: [/(^|[\\/])tokens\.txt$/i] },
    ] },
];
const SILERO = { url: GH('silero_vad.onnx'), dest: path.join(OUT_DIR, 'silero_vad.onnx') };
// Phục hồi dấu câu + VIẾT HOA tiếng Anh (chạy qua sherpa OnlinePunctuation) → bin/punct/en. Archive .tar.bz2 (tag
// punctuation-models) gồm cả fp32 — rút model.int8.onnx (~7.5MB) + bpe.vocab. (en STT zipformer ra TOÀN HOA không dấu.)
const PUNCT_EN_DIR = path.join(__dirname, '..', 'bin', 'punct', 'en');
const PUNCT_EN = {
  dir: 'punct-en', desc: 'English punctuation+truecasing (sherpa OnlinePunctuation int8)',
  archive: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-online-punct-en-2024-08-06.tar.bz2',
  pick: [
    { as: 'model.int8.onnx', prefer: [/model\.int8\.onnx$/i] },
    { as: 'bpe.vocab',       prefer: [/bpe\.vocab$/i] },
  ],
};

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
  if (!fs.existsSync(SILERO.dest)) { log('↓ silero_vad.onnx (VAD cho ja/vi)'); await download(SILERO.url, SILERO.dest); }
  else log('✓ silero_vad.onnx (đã có)');
  // En punctuation + truecasing → bin/punct/en (ja punct dựng riêng bằng scripts/export-punc-ja.py).
  fs.mkdirSync(PUNCT_EN_DIR, { recursive: true });
  if (modelComplete(PUNCT_EN, PUNCT_EN_DIR)) log('✓ punct/en — ' + PUNCT_EN.desc + ' (đã đủ)');
  else { log('↓ punct/en — ' + PUNCT_EN.desc); await fetchArchiveModel(PUNCT_EN, PUNCT_EN_DIR); }
  log('xong → bin/stt/{' + MODELS.map(m => m.dir).join(',') + '} + silero_vad.onnx + bin/punct/en');
})().catch(e => { console.error('\n[fetch-stt-model] LỖI:', e.message); process.exit(1); });
