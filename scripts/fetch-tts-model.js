#!/usr/bin/env node
/**
 * fetch-tts-model.js — Tải model TTS (Supertonic-3 đa ngữ) vào ./bin/tts/supertonic-3/ để bundle.
 *
 * Model: sherpa-onnx-supertonic-3-tts-int8-2026-05-11 từ sherpa-onnx releases (tag tts-models). MIT license.
 *   - ĐA NGỮ 31 ngôn ngữ (vi/en/ja/ko/zh…), 44.1kHz, 10 giọng. Đọc đúng từ tiếng Anh chèn trong câu Việt.
 *   - Đọc theo ngôn ngữ đích qua generationConfig.extra.lang; numSteps 5 = chất lượng. (xem src/tts.js)
 *
 * Chạy lúc BUILD (npm run build → prebuild). Idempotent: đã đủ file thì bỏ qua. Cần `tar` hỗ trợ bz2 trên máy build.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '..', 'bin', 'tts');
const DEST = path.join(OUT_DIR, 'supertonic-3');
const GH = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';
const ARCHIVE = GH + '/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2';
const INNER = 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11';   // thư mục gốc bên trong tar
const NEED = ['text_encoder.int8.onnx', 'vector_estimator.int8.onnx', 'vocoder.int8.onnx', 'duration_predictor.int8.onnx', 'tts.json', 'unicode_indexer.bin', 'voice.bin'];

function log(...a) { console.log('[fetch-tts-model]', ...a); }

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

function complete() { return NEED.every(n => fs.existsSync(path.join(DEST, n))); }

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (complete()) { log('✓ supertonic-3 — Supertonic-3 TTS đa ngữ (đã đủ)'); return; }
  log('↓ supertonic-3 — Supertonic-3 TTS đa ngữ int8 (MIT, ~123MB)');
  const tmpTar = path.join(os.tmpdir(), 'ct-tts-supertonic-3.tar.bz2');
  const tmpDir = path.join(os.tmpdir(), 'ct-tts-supertonic-3');
  await download(ARCHIVE, tmpTar);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(tmpDir, { recursive: true });
  // -xf (KHÔNG -j): để tar tự nhận diện bz2 (bsdtar/libarchive + GNU tar ≥1.22). -j ép pipe bzip2.exe → hay lỗi trên Windows.
  try { execFileSync('tar', ['-xf', tmpTar, '-C', tmpDir], { stdio: 'inherit' }); }
  catch (e) { throw new Error('giải nén tar lỗi (cần `tar` hỗ trợ bz2 trên máy build): ' + e.message); }
  const inner = path.join(tmpDir, INNER);
  if (!fs.existsSync(inner)) throw new Error('không thấy thư mục ' + INNER + ' trong archive');
  try { fs.rmSync(DEST, { recursive: true, force: true }); } catch {}
  fs.cpSync(inner, DEST, { recursive: true });
  try { fs.unlinkSync(tmpTar); } catch {}
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  if (!complete()) throw new Error('sau giải nén vẫn thiếu file bắt buộc: ' + NEED.filter(n => !fs.existsSync(path.join(DEST, n))).join(', '));
  log('xong → bin/tts/supertonic-3/');
})().catch(e => { console.error('\n[fetch-tts-model] LỖI:', e.message); process.exit(1); });
