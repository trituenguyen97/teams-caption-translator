/**
 * bench-affinity-percore.cjs — verify the affinity PHYSICALLY moves STT compute to E-cores.
 * Runs the encoder in a tight loop (no gap) for ~8s under a given affinity, while a sibling
 * PowerShell sampler reads per-logical-processor "% Processor Time" via PDH and prints which
 * cores were busy. P-cores = 0,1,10,11 ; E/LP-E = 2..9,12,13.
 *
 * Usage: node scripts/bench-affinity-percore.cjs [none|ecore|pcore]
 */
const path = require('path');
const ort = require('onnxruntime-node');
const MODE = (process.argv[2] || 'none').toLowerCase();
const ENC = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4', 'encoder.onnx');
const ECORE_IDS = [3, 4, 5], PCORE_IDS = [1, 2, 11];

function so() {
  const base = { intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential',
    extra: { session: { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' } } };
  if (MODE === 'ecore') base.extra.session['intra_op_thread_affinities'] = ECORE_IDS.join(';');
  if (MODE === 'pcore') base.extra.session['intra_op_thread_affinities'] = PCORE_IDS.join(';');
  return base;
}
function zeroFor(meta) {
  const dims = (meta.shape || meta.dimensions || []).map(d => (typeof d === 'number' && d > 0) ? d : 1);
  const n = dims.reduce((a, b) => a * b, 1);
  const t = (meta.type || '').toLowerCase();
  if (t.includes('int64')) return new ort.Tensor('int64', new BigInt64Array(n), dims);
  return new ort.Tensor('float32', new Float32Array(n), dims);
}
(async () => {
  const sess = await ort.InferenceSession.create(ENC, so());
  const names = sess.inputNames; const metaArr = sess.inputMetadata; const feeds = {};
  for (let i = 0; i < names.length; i++) feeds[names[i]] = zeroFor(Array.isArray(metaArr) ? metaArr[i] : metaArr[names[i]]);
  for (let i = 0; i < 3; i++) await sess.run(feeds);
  console.log(`[${MODE}] tight-loop encoder for 8s (pid=${process.pid}) affinity="${so().extra.session['intra_op_thread_affinities']||'none'}"`);
  const end = Date.now() + 8000;
  while (Date.now() < end) { await sess.run(feeds); }
  console.log(`[${MODE}] done`);
})();
