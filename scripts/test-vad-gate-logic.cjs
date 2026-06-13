/**
 * test-vad-gate-logic.cjs — kiểm chứng (1) _nemoVadProb chạy thật trên silero_vad.onnx không throw + phân biệt
 * im/nói, (2) máy trạng thái gate (runEnc/hangover/pre-roll) khớp thiết kế: gate lúc im, chạy lúc nói, pre-roll
 * onset, hangover phủ trọn cửa sổ endpoint 1.0s. Dùng frame 4000 mẫu để ép cả đường residual <512.
 */
const path = require('path');
const ort = require('onnxruntime-node');
const VAD = path.join('e:', 'teams-caption-translator', 'bin', 'stt', 'nemotron-int4', 'silero_vad.onnx');

const SR = 16000, WIN = 512, FRAME = 4000, THRESH = 0.35, HANG = Math.floor(SR * 1.15);

// ── bản sao _nemoVadProb (logic y hệt audio-stt) ──
let _state = null, _resid = new Float32Array(0), _sess = null;
async function vadProb(samples) {
  if (!_sess) _sess = await ort.InferenceSession.create(VAD, { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential', extra: { session: { 'intra_op.allow_spinning': '0' } } });
  let buf = samples;
  if (_resid.length) { const c = new Float32Array(_resid.length + samples.length); c.set(_resid, 0); c.set(samples, _resid.length); buf = c; }
  if (!_state) _state = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
  const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), []);
  let maxP = 0, off = 0;
  for (; off + WIN <= buf.length; off += WIN) {
    const input = new ort.Tensor('float32', buf.slice(off, off + WIN), [1, WIN]);
    const r = await _sess.run({ input, state: _state, sr });
    _state = r.stateN; const p = r.output.data[0]; if (p > maxP) maxP = p;
  }
  _resid = buf.slice(off);
  return maxP;
}

// ── bản sao máy trạng thái gate (y hệt _pumpNemo) ──
let hang = 0, prev = null;
function gate(samples, prob) {
  const speech = prob >= THRESH;
  if (speech) hang = HANG; else if (hang > 0) hang -= samples.length;
  const runEnc = speech || hang > 0;
  let fedPre = false;
  if (runEnc) { if (prev) { fedPre = true; prev = null; } }
  else { prev = samples; }
  return { runEnc, fedPre, speech };
}

// tín hiệu "nói": hỗn hợp hài (200/400/800Hz) + noise nhẹ, biên ~0.05 (silero nhận voiced)
function speechFrame() {
  const a = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const t = i / SR;
    a[i] = 0.05 * (Math.sin(2 * Math.PI * 200 * t) + 0.6 * Math.sin(2 * Math.PI * 400 * t) + 0.3 * Math.sin(2 * Math.PI * 800 * t))
         + 0.004 * (((i * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff - 1);
  }
  return a;
}
const silenceFrame = () => new Float32Array(FRAME);

(async () => {
  const seq = [];
  for (let i = 0; i < 5; i++) seq.push(['silence', silenceFrame()]);   // im đầu
  for (let i = 0; i < 5; i++) seq.push(['speech', speechFrame()]);     // nói
  for (let i = 0; i < 8; i++) seq.push(['silence', silenceFrame()]);   // im sau (hangover rồi gate)

  let runDuringInitialSilence = 0, gateDuringSpeech = 0, onsetPreRoll = false, hangoverRuns = 0, gatedTailRuns = 0;
  let probErr = false;
  console.log('idx | kind    | prob   | runEnc | fedPre | hang(ms)');
  for (let i = 0; i < seq.length; i++) {
    const [kind, frame] = seq[i];
    let prob; try { prob = await vadProb(frame); } catch (e) { probErr = true; console.error('vadProb THROW:', e.message); break; }
    const g = gate(frame, prob);
    console.log(`${String(i).padStart(2)}  | ${kind.padEnd(7)} | ${prob.toFixed(3)} |  ${g.runEnc ? 'YES' : 'no '}   |  ${g.fedPre ? 'YES' : 'no '}   | ${Math.round(hang / SR * 1000)}`);
    if (i < 5 && g.runEnc) runDuringInitialSilence++;
    if (kind === 'speech' && !g.runEnc) gateDuringSpeech++;
    if (i === 5 && g.fedPre) onsetPreRoll = true;
    if (g.runEnc && !g.speech) hangoverRuns++;   // chạy encoder dù KHÔNG có speech = đang trong hangover
    if (i >= 10 && !g.runEnc) gatedTailRuns++;
  }

  console.log('\n── ĐÁNH GIÁ ──');
  const speechProbs = seq.map((_, i) => i).filter(i => seq[i][0] === 'speech');
  const pass = [];
  pass.push(['Không throw', !probErr]);
  pass.push(['Im đầu → GATE hết (tiết kiệm)', runDuringInitialSilence === 0]);
  pass.push(['Nói → KHÔNG bị gate', gateDuringSpeech === 0]);
  pass.push(['Onset có pre-roll (frame im trước nói được feed)', onsetPreRoll]);
  pass.push(['Hangover chạy vài frame phủ endpoint 1.0s', hangoverRuns >= 3]);
  pass.push(['Đuôi im (sau hangover) → GATE', gatedTailRuns >= 1]);
  let ok = true;
  for (const [name, p] of pass) { console.log(`  ${p ? '✅' : '❌'} ${name}`); if (!p) ok = false; }
  console.log(ok ? '\n✅ TẤT CẢ PASS' : '\n❌ CÓ FAIL');
  process.exit(ok ? 0 : 1);
})();
