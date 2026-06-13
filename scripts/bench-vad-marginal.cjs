/**
 * bench-vad-marginal.cjs — Tách chi phí CPU "biên" của 1 lần chạy encoder vs idle thuần,
 * để tính chính xác lượng core tiết kiệm khi VAD-gate (bỏ encoder run trong im lặng, chỉ trả phí VAD).
 *
 * 3 chế độ trong cùng tiến trình:
 *   A) IDLE: chỉ sleep 560ms × N (sàn CPU của tiến trình + threadpool ngủ)
 *   B) ENC : run encoder rồi sleep 560ms × N (baseline hiện tại — chạy MỌI chunk kể cả im lặng)
 *   C) VAD : run vad-chunk rồi sleep 560ms × N (gate khi im lặng — chỉ trả phí VAD)
 * Tiết kiệm/chunk-im-lặng ≈ (B - C) core. Tiết kiệm thực tế = tỉ-lệ-im-lặng × (B - C).
 */
const path = require('path');
const ort = require('onnxruntime-node');
const DIR = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4');
const CHUNK = 8960, VAD_WIN = 512, NMEL = 128, ENC_FRAMES = 65, GAP_MS = 560, ITERS = 20;
const noSpin = { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const i64 = (v) => new ort.Tensor('int64', BigInt64Array.from(v.map(BigInt)), [v.length]);
const zeros = (dims) => new ort.Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);
const encFeeds = () => ({
  audio_signal: new ort.Tensor('float32', new Float32Array(ENC_FRAMES * NMEL), [1, ENC_FRAMES, NMEL]),
  length: i64([ENC_FRAMES]), cache_last_channel: zeros([1, 24, 56, 1024]), cache_last_time: zeros([1, 24, 1024, 8]),
  cache_last_channel_len: i64([0]), lang_id: i64([10]),
});

async function measure(label, work) {
  const cpu0 = process.cpuUsage(); const w0 = Date.now();
  for (let i = 0; i < ITERS; i++) { await work(); await sleep(GAP_MS); }
  const wall = (Date.now() - w0) / 1000;
  const cpu = process.cpuUsage(cpu0); const cores = (cpu.user + cpu.system) / 1e6 / wall;
  console.log(`${label.padEnd(8)} ${cores.toFixed(3)} core-tb  (wall ${wall.toFixed(1)}s)`);
  return cores;
}

(async () => {
  const enc = await ort.InferenceSession.create(path.join(DIR, 'encoder.onnx'), { intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential', extra: { session: noSpin } });
  const vad = await ort.InferenceSession.create(path.join(DIR, 'silero_vad.onnx'), { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential', extra: { session: noSpin } });
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  let vstate = zeros([2, 1, 128]);
  const wins = Math.floor(CHUNK / VAD_WIN);
  const vadChunk = async () => { for (let w = 0; w < wins; w++) { const r = await vad.run({ input: new ort.Tensor('float32', new Float32Array(VAD_WIN), [1, VAD_WIN]), state: vstate, sr }); vstate = r.stateN; } };
  // warmup
  for (let i = 0; i < 3; i++) { await enc.run(encFeeds()); await vadChunk(); }
  vstate = zeros([2, 1, 128]);

  console.log('=== CPU core trung bình qua cadence 560ms ===');
  const idle = await measure('IDLE', async () => {});
  const encC = await measure('ENC', async () => { await enc.run(encFeeds()); });
  const vadC = await measure('VAD', vadChunk);
  console.log('\n--- Phân tích ---');
  console.log(`Phí biên 1 encoder run/chunk : ${(encC - idle).toFixed(3)} core`);
  console.log(`Phí biên 1 vad-chunk/chunk   : ${(vadC - idle).toFixed(3)} core`);
  console.log(`Tiết kiệm/chunk-IM-LẶNG (ENC→VAD-gate): ${(encC - vadC).toFixed(3)} core`);
  for (const sil of [0.5, 0.6, 0.7]) {
    console.log(`  @ ${(sil * 100) | 0}% im lặng → tiết kiệm trung bình phiên: ${(sil * (encC - vadC)).toFixed(3)} core`);
  }
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
