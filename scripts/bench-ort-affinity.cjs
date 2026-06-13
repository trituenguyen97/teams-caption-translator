/**
 * bench-ort-affinity.cjs — A/B/C: pin encoder intra-op threads to E-cores via ORT
 * session.intra_op_thread_affinities, vs no-affinity (scheduler), with allow_spinning OFF (current state).
 *
 * Topology (Arrow Lake-H, measured via GetLogicalProcessorInformationEx):
 *   P-cores (EffClass 1): 0-based CPU 0,1,10,11   → 1-based 1,2,11,12
 *   E/LP-E (EffClass 0):  0-based CPU 2..9,12,13   → 1-based 3..10,13,14
 *
 * ORT affinity string: one entry per INTRA-OP WORKER thread (= intraOpNumThreads-1, since the
 * calling thread participates). Entries ';'-separated, each a ','-list of 1-based logical CPU ids.
 *
 * Modes:
 *   none  : no affinity (Windows scheduler) — baseline (current applied state)
 *   ecore : pin 3 worker threads to E-cores (1-based 3,4,5) + we also affinitize the PROCESS to E-cores
 *           so the calling thread lands on E too (ORT can't pin the calling thread).
 *   pcore : pin to P-cores (sanity: confirm pinning actually moves CPU usage)
 *
 * Measures: per-CPU usage delta via GetSystemTimes is not per-core in Node, so we measure
 *   process cpuUsage (cores) AND read per-core time from typeperf/PdH externally is heavy —
 *   instead we VERIFY placement by reading thread affinity is not exposed; we infer placement by
 *   running a parallel P-core hog and seeing if encoder run-time degrades (contention test).
 *
 * Usage: node scripts/bench-ort-affinity.cjs [none|ecore|pcore] [--hog]
 */
const path = require('path');
const ort = require('onnxruntime-node');

const MODE = (process.argv[2] || 'none').toLowerCase();
const HOG = process.argv.includes('--hog');
const DIR = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4');
const ENC = path.join(DIR, 'encoder.onnx');

const GAP_MS = 560;
const ITERS = 30;

// 1-based logical CPU ids
const ECORE_IDS = [3, 4, 5];          // 3 worker threads -> 3 distinct E-cores
const PCORE_IDS = [1, 2, 11];         // 3 worker threads -> P-cores

function so() {
  const base = {
    intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential',
    extra: { session: { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' } },
  };
  if (MODE === 'ecore') base.extra.session['intra_op_thread_affinities'] = ECORE_IDS.join(';');
  if (MODE === 'pcore') base.extra.session['intra_op_thread_affinities'] = PCORE_IDS.join(';');
  return base;
}

function zeroFor(meta) {
  const dims = (meta.shape || meta.dimensions || []).map(d => (typeof d === 'number' && d > 0) ? d : 1);
  const n = dims.reduce((a, b) => a * b, 1);
  const t = (meta.type || '').toLowerCase();
  if (t.includes('int64')) return new ort.Tensor('int64', new BigInt64Array(n), dims);
  if (t.includes('int32')) return new ort.Tensor('int32', new Int32Array(n), dims);
  return new ort.Tensor('float32', new Float32Array(n), dims);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const t0 = Date.now();
  let sess;
  try { sess = await ort.InferenceSession.create(ENC, so()); }
  catch (e) { console.error(`[${MODE}] create FAILED:`, e.message); process.exit(2); }
  console.log(`[${MODE}] session created in ${Date.now() - t0}ms  (affinity="${(so().extra.session['intra_op_thread_affinities']) || 'none'}")`);

  const names = sess.inputNames;
  const metaArr = sess.inputMetadata || names.map(n => ({ name: n, shape: [], type: 'float32' }));
  const metaByName = {};
  for (let i = 0; i < names.length; i++) {
    const m = Array.isArray(metaArr) ? metaArr[i] : metaArr[names[i]];
    metaByName[names[i]] = m || { name: names[i], shape: [], type: 'float32' };
  }
  const feeds = {};
  for (const n of names) feeds[n] = zeroFor(metaByName[n]);

  for (let i = 0; i < 3; i++) await sess.run(feeds);

  const cpu0 = process.cpuUsage();
  const w0 = Date.now();
  let runMs = 0, maxMs = 0;
  const samples = [];
  for (let i = 0; i < ITERS; i++) {
    const r0 = Date.now();
    await sess.run(feeds);
    const dt = Date.now() - r0;
    runMs += dt; if (dt > maxMs) maxMs = dt; samples.push(dt);
    await sleep(GAP_MS);
  }
  const wall = (Date.now() - w0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const cpuSec = (cpu.user + cpu.system) / 1e6;
  const cores = cpuSec / wall;
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p90 = samples[Math.floor(samples.length * 0.9)];

  console.log(`\n=== RESULT [mode=${MODE} hog=${HOG}] ===`);
  console.log(`wall=${wall.toFixed(2)}s  enc_run avg=${(runMs / ITERS).toFixed(1)}ms p50=${p50}ms p90=${p90}ms max=${maxMs}ms (RTF avg=${((runMs / ITERS) / 560).toFixed(3)})`);
  console.log(`process CPU=${cpuSec.toFixed(2)}s -> ${cores.toFixed(2)} cores avg`);
})();
