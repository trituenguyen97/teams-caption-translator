/**
 * bench-ort-threads2.cjs — clean sweep {1,2,3,4} on real Nemotron encoder.onnx, spinning OFF.
 * Reports: per-run latency (hrtime), RTF/560ms, CPU-ms charged per run, active-core occupancy,
 * and real-cadence (run+560ms gap) average cores. Repeats each thread count TRIALS times.
 */
const path = require('path');
const ort = require('e:/teams-caption-translator/node_modules/onnxruntime-node');
const ENC = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4', 'encoder.onnx');
const _noSpin = { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function feeds() {
  const z = (d) => new ort.Tensor('float32', new Float32Array(d.reduce((a, b) => a * b, 1)), d);
  const i64 = (v) => new ort.Tensor('int64', BigInt64Array.from(v.map(BigInt)), [v.length]);
  return {
    audio_signal: z([1, 65, 128]), length: i64([65]),
    cache_last_channel: z([1, 24, 56, 1024]), cache_last_time: z([1, 24, 1024, 8]),
    cache_last_channel_len: i64([0]), lang_id: i64([10]),
  };
}

async function measure(threads) {
  const sess = await ort.InferenceSession.create(ENC, {
    intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: 'sequential', extra: { session: _noSpin },
  });
  const f = feeds();
  for (let i = 0; i < 6; i++) await sess.run(f);

  // ACTIVE back-to-back
  const N = 60;
  const c0 = process.cpuUsage(); const w0 = Date.now();
  let runMs = 0;
  for (let i = 0; i < N; i++) { const r0 = process.hrtime.bigint(); await sess.run(f); runMs += Number(process.hrtime.bigint() - r0) / 1e6; }
  const wallA = (Date.now() - w0) / 1000; const u = process.cpuUsage(c0); const cpuA = (u.user + u.system) / 1e6;
  const perRun = runMs / N, rtf = perRun / 560, activeCores = cpuA / wallA, cpuPerRun = (cpuA / N) * 1000;

  // CADENCE run+560
  const M = 16;
  const c1 = process.cpuUsage(); const w1 = Date.now();
  for (let i = 0; i < M; i++) { await sess.run(f); await sleep(560); }
  const wallC = (Date.now() - w1) / 1000; const u1 = process.cpuUsage(c1); const cadenceCores = ((u1.user + u1.system) / 1e6) / wallC;

  await sess.release();
  return { threads, perRun, rtf, activeCores, cpuPerRun, cadenceCores };
}

(async () => {
  const TRIALS = 2;
  const agg = {};
  for (let trial = 0; trial < TRIALS; trial++) {
    for (const t of [1, 2, 3, 4]) {
      const r = await measure(t);
      (agg[t] = agg[t] || []).push(r);
      console.log(`trial${trial} threads=${t} run=${r.perRun.toFixed(1)}ms RTF=${r.rtf.toFixed(3)} cpu/run=${r.cpuPerRun.toFixed(1)}ms coresActive=${r.activeCores.toFixed(2)} coresCadence=${r.cadenceCores.toFixed(2)}`);
    }
  }
  console.log('\n=== AVERAGED ===');
  console.log('threads | run_ms | RTF | cpu_ms/run | cores_active | cores_cadence');
  for (const t of [1, 2, 3, 4]) {
    const a = agg[t]; const avg = (k) => a.reduce((s, x) => s + x[k], 0) / a.length;
    console.log(`${t} | ${avg('perRun').toFixed(1)} | ${avg('rtf').toFixed(3)} | ${avg('cpuPerRun').toFixed(1)} | ${avg('activeCores').toFixed(2)} | ${avg('cadenceCores').toFixed(2)}`);
  }
  process.exit(0);
})();
