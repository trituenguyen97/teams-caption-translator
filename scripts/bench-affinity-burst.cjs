/**
 * bench-affinity-burst.cjs — realistic meeting cadence (NOT saturated):
 * STT encoder runs every 560ms (as in prod). Periodically (every ~3s) ONE translation burst fires.
 * We measure the burst's latency + tok/s WHILE the encoder is concurrently active, alternating
 * affinity none<->ecore every trial to cancel slow drift, discarding the first 2 warmup trials.
 *
 * The encoder's calling thread is also pinned by setting PROCESS affinity to E-cores+ when ecore
 * (so the 4th intra-op share + node housekeeping also stay off P-cores). none = full mask.
 *
 * Usage: node scripts/bench-affinity-burst.cjs [trials=16] [port=8099]
 */
const path = require('path');
const http = require('http');
const ort = require('onnxruntime-node');
const TRIALS = Number(process.argv[2] || 16);
const PORT = Number(process.argv[3] || 8099);
const ENC = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4', 'encoder.onnx');
const ECORE_IDS = [3, 4, 5];
const GAP_MS = 560;

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
    const body = JSON.stringify({ prompt, n_predict: 48, temperature: 0, top_k: 1, cache_prompt: false, stream: false });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/completion', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
const prompts = [
  'Translate to Vietnamese: The quarterly results exceeded our expectations across all regions this year.',
  'Translate to Vietnamese: We need to finalize the migration plan before the end of the next sprint cycle.',
  'Translate to Vietnamese: Please review the attached document carefully and share your feedback by Friday.',
  'Translate to Vietnamese: The customer reported an intermittent connection issue during yesterday call.',
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
  // warm the translation path
  await complete(prompts[0]); await complete(prompts[1]);

  const results = { none: [], ecore: [] };
  for (let trial = 0; trial < TRIALS; trial++) {
    const mode = trial % 2 === 0 ? 'none' : 'ecore';
    const { sess, feeds } = sessions[mode];
    // run encoder 560ms cadence; mid-way fire one burst, time it
    let burstDone = null, tokens = 0;
    const encMs = [];
    const loopEnd = Date.now() + 2500;
    let fired = false, fireAt = Date.now() + 600;
    while (Date.now() < loopEnd) {
      const r0 = Date.now(); await sess.run(feeds); encMs.push(Date.now() - r0);
      if (!fired && Date.now() >= fireAt) {
        fired = true;
        const tb = Date.now();
        complete(prompts[trial % prompts.length]).then(r => { burstDone = Date.now() - tb; tokens = r.tokens_predicted || r.timings?.predicted_n || 0; });
      }
      await sleep(GAP_MS);
    }
    // wait for burst to finish
    while (burstDone == null) await sleep(20);
    if (trial >= 2) {  // discard 2 warmup trials
      const tps = tokens / (burstDone / 1000);
      results[mode].push({ burst: burstDone, tps, encAvg: encMs.reduce((a,b)=>a+b,0)/encMs.length });
    }
  }
  for (const mode of ['none', 'ecore']) {
    const r = results[mode];
    const med = (arr) => { const s=[...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; };
    const burstMed = med(r.map(x => x.burst));
    const tpsMed = med(r.map(x => x.tps));
    const encMed = med(r.map(x => x.encAvg));
    console.log(`[${mode}] n=${r.length} burst-latency median=${burstMed}ms  tok/s median=${tpsMed.toFixed(1)}  enc-avg median=${encMed.toFixed(0)}ms`);
    console.log(`   bursts: ${r.map(x=>x.burst).join(',')}`);
  }
})();
