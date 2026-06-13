/**
 * bench-vad-gate.cjs — Đo chi phí 1 lần chạy silero_vad.onnx vs 1 lần chạy encoder Nemotron,
 * để định lượng lợi ích VAD-gate encoder trong im lặng.
 *
 * Mô phỏng cadence streaming thật: mỗi 560ms (1 chunk 8960 mẫu) hoặc (a) chạy encoder (baseline)
 * hoặc (b) chạy silero_vad trên cùng chunk (gate). Đo process.cpuUsage() qua cửa sổ ~10s + wall-clock
 * latency mỗi run. allow_spinning='0' cho khớp cấu hình production.
 *
 * Dùng: node scripts/bench-vad-gate.cjs [enc|vad|both]   (mặc định both)
 */
const path = require('path');
const ort = require('onnxruntime-node');

const MODE = (process.argv[2] || 'both').toLowerCase();
const DIR = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4');
const ENC = path.join(DIR, 'encoder.onnx');
const VAD = path.join(DIR, 'silero_vad.onnx');

const CHUNK = 8960;     // 560ms @16k
const VAD_WIN = 512;    // cửa sổ silero @16k
const GAP_MS = 560;
const ITERS = 18;

const NMEL = 128, ENC_FRAMES = 65;
const noSpin = { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const i64 = (v) => new ort.Tensor('int64', BigInt64Array.from(v.map(BigInt)), [v.length]);
const zeros = (dims) => new ort.Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);

// Đầu vào encoder ĐÚNG shape production (mel zero — compute cố định, không phụ thuộc nội dung)
function encFeeds() {
  return {
    audio_signal: new ort.Tensor('float32', new Float32Array(ENC_FRAMES * NMEL), [1, ENC_FRAMES, NMEL]),
    length: i64([ENC_FRAMES]),
    cache_last_channel: zeros([1, 24, 56, 1024]),
    cache_last_time: zeros([1, 24, 1024, 8]),
    cache_last_channel_len: i64([0]),
    lang_id: i64([10]),
  };
}

async function benchEncoder() {
  const sess = await ort.InferenceSession.create(ENC, {
    intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential', extra: { session: noSpin },
  });
  for (let i = 0; i < 3; i++) await sess.run(encFeeds());
  const cpu0 = process.cpuUsage(); const w0 = Date.now(); let runMs = 0;
  for (let i = 0; i < ITERS; i++) {
    const r0 = Date.now(); await sess.run(encFeeds()); runMs += Date.now() - r0;
    await sleep(GAP_MS);
  }
  const wall = (Date.now() - w0) / 1000;
  const cpu = process.cpuUsage(cpu0); const cpuSec = (cpu.user + cpu.system) / 1e6;
  return { label: 'ENCODER (4thr,noSpin)', runMs: runMs / ITERS, cores: cpuSec / wall, wall };
}

// VAD chạy chunk 560ms = 17.5 cửa sổ 512 → 17 lần forward (sai số nhỏ; đúng cách app feed 512/lần)
async function benchVad() {
  const sess = await ort.InferenceSession.create(VAD, {
    intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential', extra: { session: noSpin },
  });
  const wins = Math.floor(CHUNK / VAD_WIN); // 17
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  function runChunk(state) {
    return (async () => {
      let st = state;
      for (let w = 0; w < wins; w++) {
        const input = new ort.Tensor('float32', new Float32Array(VAD_WIN), [1, VAD_WIN]);
        const r = await sess.run({ input, state: st, sr });
        st = r.stateN;
      }
      return st;
    })();
  }
  let state = zeros([2, 1, 128]);
  for (let i = 0; i < 3; i++) state = await runChunk(state);
  state = zeros([2, 1, 128]);
  const cpu0 = process.cpuUsage(); const w0 = Date.now(); let runMs = 0;
  for (let i = 0; i < ITERS; i++) {
    const r0 = Date.now(); state = await runChunk(state); runMs += Date.now() - r0;
    await sleep(GAP_MS);
  }
  const wall = (Date.now() - w0) / 1000;
  const cpu = process.cpuUsage(cpu0); const cpuSec = (cpu.user + cpu.system) / 1e6;
  return { label: `VAD (1thr, ${wins}win/chunk)`, runMs: runMs / ITERS, cores: cpuSec / wall, wall };
}

// VAD chạy 1 cửa sổ duy nhất (đo chi phí 1 forward)
async function benchVadSingle() {
  const sess = await ort.InferenceSession.create(VAD, {
    intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential', extra: { session: noSpin },
  });
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  let state = zeros([2, 1, 128]);
  for (let i = 0; i < 5; i++) { const r = await sess.run({ input: new ort.Tensor('float32', new Float32Array(VAD_WIN), [1, VAD_WIN]), state, sr }); state = r.stateN; }
  const N = 500; const t0 = Date.now();
  for (let i = 0; i < N; i++) { const r = await sess.run({ input: new ort.Tensor('float32', new Float32Array(VAD_WIN), [1, VAD_WIN]), state, sr }); state = r.stateN; }
  return { perForwardMs: (Date.now() - t0) / N };
}

(async () => {
  const results = [];
  if (MODE === 'enc' || MODE === 'both') results.push(await benchEncoder());
  if (MODE === 'vad' || MODE === 'both') {
    const single = await benchVadSingle();
    console.log(`VAD single-forward (512 mẫu): ${single.perForwardMs.toFixed(3)}ms/forward`);
    results.push(await benchVad());
  }
  console.log('\n=== KẾT QUẢ (cadence 560ms, ' + ITERS + ' iters) ===');
  for (const r of results) {
    console.log(`${r.label.padEnd(28)} run=${r.runMs.toFixed(1)}ms/chunk  CPU=${r.cores.toFixed(2)} core-tb  wall=${r.wall.toFixed(1)}s`);
  }
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
