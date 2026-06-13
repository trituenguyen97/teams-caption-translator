/**
 * verify-affinity-cpucost.cjs — independent reality-check of the E-core-pinning CPU-cost claim.
 * Interleaves none<->ecore encoder runs at prod 560ms cadence; per run measures wall-ms AND
 * process CPU-seconds delta (process.cpuUsage covers ALL threads = true CPU cost). Reports medians.
 * Also confirms ORT parses the affinity key (valid accepted; bogus core id logs/throws).
 */
const path = require('path');
const ort = require('onnxruntime-node');
const ENC = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4', 'encoder.onnx');
const ECORE_IDS = [3, 4, 5];
const GAP_MS = 560;
const ITERS = Number(process.argv[2] || 40);

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
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
async function mkSession(mode) {
  const sess = await ort.InferenceSession.create(ENC, soFor(mode));
  const names = sess.inputNames; const metaArr = sess.inputMetadata; const feeds = {};
  for (let i = 0; i < names.length; i++) feeds[names[i]] = zeroFor(Array.isArray(metaArr) ? metaArr[i] : metaArr[names[i]]);
  for (let i = 0; i < 5; i++) await sess.run(feeds);
  return { sess, feeds };
}
(async () => {
  // --- parse-validation probe ---
  try { const s = await ort.InferenceSession.create(ENC, soFor('ecore')); console.log('VALID affinity "3;4;5" accepted OK'); }
  catch (e) { console.log('VALID affinity THREW (unexpected):', e.message); }
  try {
    const bad = { intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential',
      extra: { session: { 'intra_op_thread_affinities': '99;98;97' } } };
    await ort.InferenceSession.create(ENC, bad);
    console.log('BOGUS core "99;98;97" did NOT throw (affinity may be parsed but set fails silently/logs)');
  } catch (e) { console.log('BOGUS core "99;98;97" THREW:', (e.message||'').split('\n')[0]); }
  try {
    const bad = { intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential',
      extra: { session: { 'intra_op_thread_affinities': '3;4' } } }; // wrong count (need 3)
    await ort.InferenceSession.create(ENC, bad);
    console.log('WRONG-COUNT "3;4" did NOT throw');
  } catch (e) { console.log('WRONG-COUNT "3;4" THREW (count must = threads-1):', (e.message||'').split('\n')[0]); }

  const sessions = { none: await mkSession('none'), ecore: await mkSession('ecore') };
  const wall = { none: [], ecore: [] }, cpu = { none: [], ecore: [] };
  for (let i = 0; i < ITERS; i++) {
    const mode = i % 2 === 0 ? 'none' : 'ecore';
    const { sess, feeds } = sessions[mode];
    const c0 = process.cpuUsage(); const t0 = Date.now();
    await sess.run(feeds);
    const dt = Date.now() - t0; const cu = process.cpuUsage(c0);
    const cpuMs = (cu.user + cu.system) / 1000; // microseconds -> ms of CPU across all threads
    if (i >= 4) { wall[mode].push(dt); cpu[mode].push(cpuMs); }
    await sleep(GAP_MS);
  }
  console.log(`\nn=${wall.none.length} samples/mode, prod ${GAP_MS}ms cadence, interleaved`);
  for (const m of ['none', 'ecore']) {
    console.log(`[${m}] wall-ms median ${med(wall[m]).toFixed(0)} | CPU-ms/chunk median ${med(cpu[m]).toFixed(0)} | continuous-cores ${(med(cpu[m])/GAP_MS).toFixed(2)}`);
  }
  const dWall = (med(wall.ecore) - med(wall.none)) / med(wall.none) * 100;
  const dCpu = (med(cpu.ecore) - med(cpu.none)) / med(cpu.none) * 100;
  console.log(`\necore vs none: wall ${dWall>=0?'+':''}${dWall.toFixed(0)}% | CPU-seconds ${dCpu>=0?'+':''}${dCpu.toFixed(0)}%`);
})();
