/**
 * bench-affinity-e2e.cjs — REAL contention test: Nemotron encoder streaming loop (this Node process)
 * concurrent with MiLMMT translation bursts (separate llama-server -t6 process).
 *
 * Compares STT-encoder affinity NONE (scheduler) vs ECORE (pin intra-op workers to E-cores).
 * The hypothesis: pinning STT to E-cores keeps it off the P-cores that the translation burst wants,
 * reducing contention -> faster/steadier translation and/or steadier STT during bursts.
 *
 * Measures, during a window where BOTH run:
 *   - encoder run-time avg/p90/max (STT smoothness)
 *   - translation tok/s (P-core path throughput) + per-request latency
 *
 * Requires llama-server already running on PORT with MiLMMT loaded (start it separately).
 * Usage: node scripts/bench-affinity-e2e.cjs [none|ecore] [port]
 */
const path = require('path');
const http = require('http');
const ort = require('onnxruntime-node');

const MODE = (process.argv[2] || 'none').toLowerCase();
const PORT = Number(process.argv[3] || 8099);
const DIR = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4');
const ENC = path.join(DIR, 'encoder.onnx');
const ECORE_IDS = [3, 4, 5];
const GAP_MS = 560;
const DURATION_MS = 30000;

function so() {
  const base = { intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential',
    extra: { session: { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' } } };
  if (MODE === 'ecore') base.extra.session['intra_op_thread_affinities'] = ECORE_IDS.join(';');
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
    const body = JSON.stringify({ prompt, n_predict: 48, temperature: 0, top_k: 1, cache_prompt: true, stream: false });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/completion', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

(async () => {
  const sess = await ort.InferenceSession.create(ENC, so());
  console.log(`[${MODE}] encoder ready (affinity="${(so().extra.session['intra_op_thread_affinities']) || 'none'}")`);
  const names = sess.inputNames;
  const metaArr = sess.inputMetadata;
  const feeds = {};
  for (let i = 0; i < names.length; i++) feeds[names[i]] = zeroFor(Array.isArray(metaArr) ? metaArr[i] : metaArr[names[i]]);
  for (let i = 0; i < 3; i++) await sess.run(feeds);

  // translation burst worker: fires sequential completions back-to-back for the whole window
  const prompts = [
    'Translate to Vietnamese: The quarterly results exceeded our expectations across all regions.',
    'Translate to Vietnamese: We need to finalize the migration plan before the end of next sprint.',
    'Translate to Vietnamese: Please review the attached document and share your feedback by Friday.',
    'Translate to Vietnamese: The customer reported an intermittent connection issue during the call.',
  ];
  let stopBurst = false;
  const transLat = []; let transTokens = 0; let transReqs = 0;
  const burst = (async () => {
    let k = 0;
    while (!stopBurst) {
      const t0 = Date.now();
      try {
        const r = await complete(prompts[k % prompts.length]);
        const dt = Date.now() - t0;
        transLat.push(dt); transReqs++;
        const n = (r.tokens_predicted || r.timings?.predicted_n || 0);
        transTokens += n;
      } catch (e) { /* server warming */ await sleep(50); }
      k++;
    }
  })();

  // encoder streaming loop for the window
  const encMs = [];
  const cpu0 = process.cpuUsage();
  const w0 = Date.now();
  while (Date.now() - w0 < DURATION_MS) {
    const r0 = Date.now();
    await sess.run(feeds);
    encMs.push(Date.now() - r0);
    await sleep(GAP_MS);
  }
  stopBurst = true;
  await burst;
  const wall = (Date.now() - w0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const cores = (cpu.user + cpu.system) / 1e6 / wall;

  encMs.sort((a, b) => a - b);
  const avg = encMs.reduce((a, b) => a + b, 0) / encMs.length;
  const p90 = encMs[Math.floor(encMs.length * 0.9)];
  const tlSorted = [...transLat].sort((a, b) => a - b);
  const tlAvg = transLat.reduce((a, b) => a + b, 0) / (transLat.length || 1);
  const tlP90 = tlSorted[Math.floor(tlSorted.length * 0.9)] || 0;
  const tps = transTokens / wall;

  console.log(`\n=== E2E [stt-affinity=${MODE}] wall=${wall.toFixed(1)}s ===`);
  console.log(`STT encoder: n=${encMs.length} avg=${avg.toFixed(1)}ms p90=${p90}ms max=${encMs[encMs.length-1]}ms`);
  console.log(`Translation: reqs=${transReqs} tokens=${transTokens} -> ${tps.toFixed(1)} tok/s | latency avg=${tlAvg.toFixed(0)}ms p90=${tlP90}ms`);
  console.log(`THIS-process CPU=${cores.toFixed(2)} cores avg (encoder only; llama-server is separate proc)`);
})();
