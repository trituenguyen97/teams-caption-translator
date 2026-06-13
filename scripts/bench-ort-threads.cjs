/**
 * bench-ort-threads.cjs — sweep intraOpNumThreads của encoder Nemotron (spinning ĐÃ tắt) để tìm số thread tối thiểu
 * vẫn real-time, nhằm GIẢM số core encoder chiếm CÙNG LÚC (chừa core cho dịch burst) + giảm điện.
 *
 * Đo 2 chế độ mỗi thread-count:
 *   - ACTIVE (run liên tục, không nghỉ): cores chiếm dụng tức thời + RTF + cpu-time/run.
 *   - CADENCE (run + nghỉ 560ms): cores trung bình thực tế (gồm cả lúc nghỉ).
 *
 * Dùng: node scripts/bench-ort-threads.cjs
 */
const path = require('path');
const ort = require('onnxruntime-node');

const ENC = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4', 'encoder.onnx');
const _noSpin = { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function zeroFor(meta) {
  const dims = (meta.shape || []).map(d => (typeof d === 'number' && d > 0) ? d : 1);
  const n = dims.reduce((a, b) => a * b, 1);
  const t = (meta.type || '').toLowerCase();
  if (t.includes('int64')) return new ort.Tensor('int64', new BigInt64Array(n), dims);
  if (t.includes('int32')) return new ort.Tensor('int32', new Int32Array(n), dims);
  return new ort.Tensor('float32', new Float32Array(n), dims);
}

async function buildFeeds(sess) {
  const names = sess.inputNames;
  const metaArr = sess.inputMetadata || names.map(n => ({ name: n, shape: [], type: 'float32' }));
  const feeds = {};
  for (let i = 0; i < names.length; i++) {
    const m = Array.isArray(metaArr) ? metaArr[i] : (metaArr[names[i]] || {});
    feeds[names[i]] = zeroFor(m);
  }
  return feeds;
}

async function measure(threads) {
  const sess = await ort.InferenceSession.create(ENC, {
    intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: 'sequential', extra: { session: _noSpin },
  });
  const feeds = await buildFeeds(sess);
  for (let i = 0; i < 3; i++) await sess.run(feeds);   // warmup

  // ACTIVE: back-to-back, no gap → core chiếm dụng khi đang chạy
  const N = 24;
  let c0 = process.cpuUsage(), w0 = Date.now();
  for (let i = 0; i < N; i++) await sess.run(feeds);
  let wallA = (Date.now() - w0) / 1000, cpuA = (process.cpuUsage(c0).user + process.cpuUsage(c0).system) / 1e6;
  const perRun = (wallA / N) * 1000, rtf = perRun / 560, activeCores = cpuA / wallA, cpuPerRun = (cpuA / N) * 1000;

  // CADENCE: run + nghỉ 560ms → core trung bình thực tế
  const M = 12;
  c0 = process.cpuUsage(); w0 = Date.now();
  for (let i = 0; i < M; i++) { await sess.run(feeds); await sleep(560); }
  let wallC = (Date.now() - w0) / 1000, cpuC = (process.cpuUsage(c0).user + process.cpuUsage(c0).system) / 1e6;
  const cadenceCores = cpuC / wallC;

  return { threads, perRun, rtf, activeCores, cpuPerRun, cadenceCores };
}

(async () => {
  console.log('threads | run(ms) | RTF   | core(active) | cpu-ms/run | core(cadence560)');
  console.log('--------|---------|-------|--------------|------------|------------------');
  for (const t of [2, 3, 4]) {
    const r = await measure(t);
    console.log(
      `   ${r.threads}    |  ${r.perRun.toFixed(0).padStart(4)}   | ${r.rtf.toFixed(3)} |     ${r.activeCores.toFixed(2)}     |    ${r.cpuPerRun.toFixed(0).padStart(3)}     |       ${r.cadenceCores.toFixed(2)}`
    );
  }
  console.log('\nMục tiêu: thread ít nhất mà RTF vẫn « 1 (cốt < ~0.45) → chiếm ít core(active) hơn = chừa core cho dịch.');
  process.exit(0);
})();
