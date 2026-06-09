#!/usr/bin/env node
/**
 * fetch-stt-model.js — Tải model STT Whisper-small (sherpa-onnx) vào ./bin/stt để bundle (extraResources).
 *
 * Whisper đa ngôn ngữ (gồm tiếng Việt) thay cho SenseVoice cũ (chỉ zh/en/ja/ko/yue, KHÔNG có VI).
 * Chạy lúc BUILD (npm run build → prebuild). Tải TRỰC TIẾP 3 file int8 từ HuggingFace (không cần tar/bz2):
 *   small-encoder.int8.onnx (~107MB) + small-decoder.int8.onnx (~250MB) + small-tokens.txt.
 * Người dùng cuối KHÔNG phải tải gì (xem src/stt.js). Idempotent: đã có thì bỏ qua.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small/resolve/main/';
const OUT_DIR = path.join(__dirname, '..', 'bin', 'stt');
const FILES = ['small-encoder.int8.onnx', 'small-decoder.int8.onnx', 'small-tokens.txt'];
// Silero VAD (~0.6MB) để cắt câu theo khoảng lặng (xem src/stt.js createVad). Khác release nên URL riêng.
const EXTRA = [{ name: 'silero_vad.onnx', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx' }];

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
    req.setTimeout(180000, () => req.destroy(new Error('timeout')));
  });
}

async function download(url, dest) {
  const res = await _request(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error('HTTP ' + res.statusCode); }
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

(async () => {
  const all = [...FILES.map(f => ({ name: f, url: BASE + f })), ...EXTRA];
  if (all.every(x => fs.existsSync(path.join(OUT_DIR, x.name)))) { log('model đã có →', OUT_DIR, '(bỏ qua)'); return; }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const x of all) {
    const dest = path.join(OUT_DIR, x.name);
    if (fs.existsSync(dest)) { log('✓', x.name, '(đã có)'); continue; }
    log('↓', x.name);
    await download(x.url, dest);
  }
  log('xong →', OUT_DIR, '|', all.map(x => x.name + ' ' + (fs.statSync(path.join(OUT_DIR, x.name)).size / 1e6).toFixed(1) + 'MB').join(', '));
})().catch(e => { console.error('[fetch-stt-model] LỖI:', e.message); process.exit(1); });
