/**
 * bench-affinity-paired.cjs — drift-immune paired test. One continuous translation burst
 * (separate process: a detached node feeding /completion back-to-back) provides the contention.
 * THIS process runs the STT encoder at prod 560ms cadence. We toggle the encoder session between
 * a none-pinned and an ecore-pinned instance every SWITCH window, many times, and read the
 * translation server's tok/s for the matching window. Adjacent none/ecore windows share thermal
 * state, so the paired DIFF cancels slow drift.
 *
 * The translation tok/s is sampled by polling llama-server /slots? No — we read it from the burst
 * process which writes each request's server tok/s to a file we tail.
 *
 * Simpler: this single process does BOTH (encoder loop + translation burst), but the translation
 * is measured by SERVER timings (immune to JS contention), and we alternate encoder affinity every
 * 4s for many cycles. Report paired diffs.
 *
 * Usage: node scripts/bench-affinity-paired.cjs [cycles=8] [port=8099]
 */
const path = require('path');
const http = require('http');
const ort = require('onnxruntime-node');
const CYCLES = Number(process.argv[2] || 8);
const PORT = Number(process.argv[3] || 8099);
const ENC = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4', 'encoder.onnx');
const ECORE_IDS = [3, 4, 5];
const GAP_MS = 560;
const WIN_MS = 4000;

function soFor(mode) {
  const base = { intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential',
    extra: { session: { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' } } };
  if (mode === 'ecore') base.extra.session['intra_op_thread_affinities'] = ECORE_IDS.join(';');
  return base;
}
function zeroFor(meta) {
  const dims = (meta.shape || meta.dimensions || []).map(d => (typeof d === 'number' && d > 0) ? d : 1);
  const n = dims.reduce((a, b) => a * b, 1);
  const t = (meta.type || '').toLowerCase();
  if (t.includes('int64')) return new ort.Tensor('int64', new BigInt64Array(n), dims);
  return new ort.Tensor('float32', new Float32Array(n), dims);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function complete(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ prompt, n_predict: 96, temperature: 0, top_k: 1, cache_prompt: false, stop: ['\n', 'Japanese:', 'Vietnamese:'] });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/completion', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
const mk = (ja) => `Translate this from Japanese to Vietnamese:\nJapanese: ${ja}\nVietnamese:`;
const prompts = [
  mk('今四半期の業績はすべての地域で私たちの予想を上回りました。'),
  mk('次のスプリントが終わる前に移行計画を確定する必要があります。'),
  mk('添付の資料をよく確認して金曜日までにフィードバックをください。'),
  mk('お客様は昨日の通話中に断続的な接続の問題を報告しました。'),
];
async function mkSession(mode) {
  const sess = await ort.InferenceSession.create(ENC, soFor(mode));
  const names = sess.inputNames; const metaArr = sess.inputMetadata; const feeds = {};
  for (let i = 0; i < names.length; i++) feeds[names[i]] = zeroFor(Array.isArray(metaArr) ? metaArr[i] : metaArr[names[i]]);
  for (let i = 0; i < 3; i++) await sess.run(feeds);
  return { sess, feeds };
}
(async () => {
  const sessions = { none: await mkSession('none'), ecore: await mkSession('ecore') };
  await complete(prompts[0]); await complete(prompts[1]);

  // continuous translation burst worker for whole test; tags each result with current window id
  let curWin = -1; const winTps = {}; let stop = false; let k = 0;
  const worker = (async () => {
    while (!stop) {
      const w = curWin;
      try { const r = await complete(prompts[k % prompts.length]); const t = r.timings;
        if (w >= 0 && t && t.predicted_n >= 3 && isFinite(t.predicted_per_second)) (winTps[w] = winTps[w] || []).push(t.predicted_per_second); }
      catch { await sleep(20); }
      k++;
    }
  })();

  const pairs = [];
  for (let cyc = 0; cyc < CYCLES; cyc++) {
    for (const mode of ['none', 'ecore']) {
      const winId = cyc * 2 + (mode === 'ecore' ? 1 : 0);
      curWin = winId;
      const { sess, feeds } = sessions[mode];
      const end = Date.now() + WIN_MS;
      while (Date.now() < end) { await sess.run(feeds); await sleep(GAP_MS); }
    }
  }
  curWin = -1; stop = true; await worker;

  const med = (a) => { if (!a || !a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  console.log('cycle | none-tps | ecore-tps | diff(ecore-none)');
  let sumDiff = 0, nDiff = 0;
  for (let cyc = 1; cyc < CYCLES; cyc++) {   // drop cycle 0 as warmup
    const n = med(winTps[cyc * 2]); const e = med(winTps[cyc * 2 + 1]);
    if (n && e) { const d = e - n; sumDiff += d; nDiff++; console.log(`  ${cyc}   |  ${n.toFixed(1)}   |   ${e.toFixed(1)}   |  ${d >= 0 ? '+' : ''}${d.toFixed(1)}`); }
  }
  console.log(`\nMean paired diff (ecore - none) = ${(sumDiff / (nDiff||1)).toFixed(2)} tok/s over ${nDiff} cycles`);
  console.log(`(positive => pinning STT to E-cores HELPED translation; negative => HURT)`);
})();
