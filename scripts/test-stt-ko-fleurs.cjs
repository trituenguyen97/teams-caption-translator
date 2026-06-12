/**
 * test-stt-ko-fleurs.cjs — A/B Moonshine base-ko trên GIỌNG NGƯỜI THẬT (Google FLEURS ko_kr test split)
 * để kiểm chứng: lỗi nghe-nhầm-ra-từ-thật (후자/개방/측…) thấy trên TTS có xuất hiện trên giọng người không.
 *
 * Lấy clip + transcript chuẩn qua HF dataset viewer API (không cần thư viện datasets), tải wav (giọng người
 * thật, nhiều người nói, nội dung wiki/tin tức), ffmpeg → 16k mono, chạy ĐÚNG pipeline app. CẦN INTERNET + ffmpeg.
 *
 * node scripts/test-stt-ko-fleurs.cjs [count=20] [offset=0]
 */
require('onnxruntime-node');   // PHẢI trước sherpa (dlopen) — đây chỉ dùng Moonshine nhưng giữ quy ước
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { createMoonshine } = require('../src/stt-moonshine');
const { punctuateKo } = require('../src/punctuate-ko');
const { koFix } = require('../src/ko-fix');

const COUNT = parseInt(process.argv[2] || '20');
const OFFSET = parseInt(process.argv[3] || '0');
const TMP = path.join(os.tmpdir(), 'ct-fleurs-ko');
fs.mkdirSync(TMP, { recursive: true });

function get(url, redir = 6) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'ct-test/1.0', Accept: '*/*' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redir <= 0) return reject(new Error('too many redirects'));
        res.resume(); return get(new URL(res.headers.location, url).toString(), redir - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    }).on('error', reject);
  });
}

function readWav16(p) {
  const buf = fs.readFileSync(p);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const numCh = view.getUint16(22, true);
  let off = 44;
  for (let i = 12; i < Math.min(buf.length - 8, 1024);) {
    const id = buf.toString('ascii', i, i + 4); const sz = view.getUint32(i + 4, true);
    if (id === 'data') { off = i + 8; break; } i += 8 + sz + (sz & 1);
  }
  const n = Math.floor((buf.length - off) / 2 / numCh);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(off + i * numCh * 2, true) / 32768;
  return out;
}

// char-overlap (giống metric test TTS để so sánh trực tiếp): |chung| / max(|ref|,|hyp|), bỏ space+dấu.
function charOverlap(ref, hyp) {
  const norm = s => (s || '').replace(/[\s.,!?。、！？·"'""''()\[\]]/g, '');
  const rc = new Set([...norm(ref)]), hc = new Set([...norm(hyp)]);
  if (!rc.size || !hc.size) return 0;
  let common = 0; for (const c of rc) if (hc.has(c)) common++;
  return common / Math.max(rc.size, hc.size);
}

(async () => {
  console.log(`FLEURS ko_kr — giọng người thật | count=${COUNT} offset=${OFFSET}\n`);
  const api = `https://datasets-server.huggingface.co/rows?dataset=google/fleurs&config=ko_kr&split=test&offset=${OFFSET}&length=${COUNT}`;
  const data = JSON.parse((await get(api)).toString('utf8'));
  const rows = data.rows.map(r => r.row);

  const m = await createMoonshine(path.join(__dirname, '..', 'bin', 'stt', 'ko'), { threads: 2 });

  let totAcc = 0, totMs = 0, totSec = 0, done = 0;
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const ref = row.raw_transcription || row.transcription || '';
    const src = (row.audio && row.audio[0] && row.audio[0].src) || null;
    if (!src) { console.log(`[${i}] no audio src — skip`); continue; }
    const mp = path.join(TMP, `f_${OFFSET + i}.dl`);
    const wp = path.join(TMP, `f_${OFFSET + i}.wav`);
    try {
      fs.writeFileSync(mp, await get(src));
      execFileSync('ffmpeg', ['-y', '-i', mp, '-ar', '16000', '-ac', '1', '-f', 'wav', wp], { stdio: 'pipe' });
    } catch (e) { console.log(`[${i}] download/convert lỗi: ${e.message}`); continue; }
    const samples = readWav16(wp);
    const sec = samples.length / 16000;
    const t0 = Date.now();
    let raw = '';
    try { raw = await m.transcribe(samples); } catch (e) { console.log(`[${i}] decode lỗi: ${e.message}`); continue; }
    const ms = Date.now() - t0;
    const hyp = koFix(punctuateKo(raw));
    const acc = charOverlap(ref, hyp);
    totAcc += acc; totMs += ms; totSec += sec; done++;
    results.push({ i: OFFSET + i, sec, acc, ref, hyp });
    console.log(`[${OFFSET + i}] ${sec.toFixed(1)}s rtf=${(ms / 1000 / sec).toFixed(2)} acc=${Math.round(acc * 100)}%`);
    console.log(`   REF: ${ref}`);
    console.log(`   HYP: ${hyp}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Clips: ${done} | avg char-overlap: ${Math.round(totAcc / done * 100)}% | avg RTF: ${(totMs / 1000 / totSec).toFixed(3)}`);
  const sorted = [...results].sort((a, b) => a.acc - b.acc);
  console.log(`\nThấp nhất (soi lỗi substitution):`);
  for (const r of sorted.slice(0, 5)) {
    console.log(`  [${r.i}] ${Math.round(r.acc * 100)}%`);
    console.log(`    REF: ${r.ref}`);
    console.log(`    HYP: ${r.hyp}`);
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
