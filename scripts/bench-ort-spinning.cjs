/**
 * bench-ort-spinning.cjs — A/B đo CPU của encoder Nemotron với intra/inter-op spinning BẬT vs TẮT.
 *
 * Lý do: onnxruntime-node IM LẶNG bỏ qua key 'extra' sai → create() thành công KHÔNG chứng minh flag có hiệu lực.
 * Bằng chứng DUY NHẤT là delta CPU. Mô phỏng vòng streaming thật: run encoder rồi nghỉ ~560ms (khoảng trống
 * giữa các chunk) — đúng lúc thread spinning busy-wait đốt core. Đo process.cpuUsage() tổng qua cửa sổ ~10s.
 *
 * Dùng: node scripts/bench-ort-spinning.cjs [on|off]   (mặc định on = mặc định ORT)
 */
const path = require('path');
const ort = require('onnxruntime-node');

const MODE = (process.argv[2] || 'on').toLowerCase();   // 'on' = spinning mặc định, 'off' = tắt
const DIR = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4');
const ENC = path.join(DIR, 'encoder.onnx');

const GAP_MS = 560;   // cadence chunk thật
const ITERS = 18;     // ~10s + thời gian compute

function so() {
  const base = { intraOpNumThreads: 4, interOpNumThreads: 1, executionMode: 'sequential' };
  if (MODE === 'off') {
    base.extra = { session: { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' } };
  }
  return base;
}

// Tạo tensor zero đúng shape/type từ metadata; dim động (<=0 hoặc chuỗi) → 1.
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
  const sess = await ort.InferenceSession.create(ENC, so());
  console.log(`[${MODE}] session tạo trong ${Date.now() - t0}ms`);

  // Build feeds từ inputMetadata (v1.26 có inputMetadata; fallback inputNames + shape rỗng).
  const names = sess.inputNames;
  const metaArr = sess.inputMetadata || names.map(n => ({ name: n, shape: [], type: 'float32' }));
  const metaByName = {};
  for (let i = 0; i < names.length; i++) {
    const m = Array.isArray(metaArr) ? metaArr[i] : metaArr[names[i]];
    metaByName[names[i]] = m || { name: names[i], shape: [], type: 'float32' };
  }
  const feeds = {};
  for (const n of names) feeds[n] = zeroFor(metaByName[n]);
  console.log(`[${MODE}] inputs:`, names.map(n => `${n}[${feeds[n].dims.join(',')}]:${feeds[n].type}`).join(' '));

  // Warmup 3
  for (let i = 0; i < 3; i++) { try { await sess.run(feeds); } catch (e) { console.error('run lỗi:', e.message); process.exit(1); } }

  // Đo: vòng run + gap, đếm CPU tổng tiến trình.
  const cpu0 = process.cpuUsage();
  const w0 = Date.now();
  let runMs = 0;
  for (let i = 0; i < ITERS; i++) {
    const r0 = Date.now();
    await sess.run(feeds);
    runMs += Date.now() - r0;
    await sleep(GAP_MS);   // khoảng trống giữa chunk — nơi spinning đốt CPU
  }
  const wall = (Date.now() - w0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const cpuSec = (cpu.user + cpu.system) / 1e6;
  const cores = cpuSec / wall;

  console.log(`\n=== KẾT QUẢ [spinning=${MODE}] ===`);
  console.log(`wall=${wall.toFixed(2)}s  encoder_run_trung_bình=${(runMs / ITERS).toFixed(1)}ms  (RTF=${((runMs / ITERS) / 560).toFixed(3)})`);
  console.log(`CPU tiến trình=${cpuSec.toFixed(2)}s  →  ${cores.toFixed(2)} core-tương-đương trung bình (${(cores * 100).toFixed(0)}%/1-core)`);
})();
