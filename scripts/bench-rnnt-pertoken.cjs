/**
 * bench-rnnt-pertoken.cjs — measure per-token cost of the RNN-T decode loop (decoder.onnx + joint.onnx).
 * Decomposes: native Run() time vs JS-side overhead (dlast copy, argmax over V, tensor construction).
 * Also A/B: current (alloc-every-token) vs preallocated/reused buffers.
 *
 * Run: node scripts/bench-rnnt-pertoken.cjs [tokens]
 */
const ort = require('e:/teams-caption-translator/node_modules/onnxruntime-node');
const path = require('path');
const DIR = 'e:/teams-caption-translator/bin/stt/nemotron-int4';
const BLANK = 13087, V = 13088, H = 1024, DH = 640;
const TOKENS = parseInt(process.argv[2] || '2000', 10);

function so() { return { intraOpNumThreads: 1, interOpNumThreads: 1, executionMode: 'sequential', extra: { session: { 'intra_op.allow_spinning': '0', 'inter_op.allow_spinning': '0' } } }; }
const zeros = (dims) => new ort.Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b, 1)), dims);
const hr = () => Number(process.hrtime.bigint());

(async () => {
  const dec = await ort.InferenceSession.create(path.join(DIR, 'decoder.onnx'), so());
  const joint = await ort.InferenceSession.create(path.join(DIR, 'joint.onnx'), so());

  // Fixed encoder frame (zeros — compute cost of joint is shape-driven, value-independent here)
  const etData = new Float32Array(H);
  const et = new ort.Tensor('float32', etData, [1, 1, H]);

  let h = zeros([2, 1, DH]), c = zeros([2, 1, DH]);
  const runDec = async (tid) => {
    const r = await dec.run({ targets: new ort.Tensor('int64', BigInt64Array.from([BigInt(tid)]), [1, 1]), h_in: h, c_in: c });
    h = r.h_out; c = r.c_out; return r.decoder_output;
  };

  // Warmup
  let dout = await runDec(BLANK);
  for (let i = 0; i < 20; i++) {
    const dd = dout.data, dlt = dout.dims[2];
    const dlast = new Float32Array(DH); for (let k = 0; k < DH; k++) dlast[k] = dd[k * dlt + (dlt - 1)];
    const jo = await joint.run({ encoder_output: et, decoder_output: new ort.Tensor('float32', dlast, [1, 1, DH]) });
    void jo.joint_output.data[0];
    dout = await runDec((i % 100) + 1);
  }

  // ---- Measure each component over TOKENS iterations ----
  let tDec = 0, tJoint = 0, tDlast = 0, tArgmax = 0, tTensor = 0, tDecTensor = 0;
  dout = await runDec(BLANK);
  const tWall0 = hr();
  const cpu0 = process.cpuUsage();
  for (let i = 0; i < TOKENS; i++) {
    const tid = (i % 200) + 1;

    // dlast extraction (JS loop over 640)
    let s = hr();
    const dd = dout.data, dlt = dout.dims[2];
    const dlast = new Float32Array(DH);
    for (let k = 0; k < DH; k++) dlast[k] = dd[k * dlt + (dlt - 1)];
    tDlast += hr() - s;

    // joint decoder_output tensor construction
    s = hr();
    const decT = new ort.Tensor('float32', dlast, [1, 1, DH]);
    tTensor += hr() - s;

    // joint.run()
    s = hr();
    const jo = await joint.run({ encoder_output: et, decoder_output: decT });
    tJoint += hr() - s;

    // argmax over V (with forbidden-set lookup simulated: empty set -> just argmax)
    s = hr();
    const logits = jo.joint_output.data;
    let best = 0, bestV = -Infinity;
    for (let v = 0; v < V; v++) { const x = logits[v]; if (x > bestV) { bestV = x; best = v; } }
    tArgmax += hr() - s;

    // decoder targets tensor construction
    s = hr();
    const tgt = new ort.Tensor('int64', BigInt64Array.from([BigInt(tid)]), [1, 1]);
    tDecTensor += hr() - s;

    // decoder.run()
    s = hr();
    const r = await dec.run({ targets: tgt, h_in: h, c_in: c });
    h = r.h_out; c = r.c_out; dout = r.decoder_output;
    tDec += hr() - s;
  }
  const wall = (hr() - tWall0) / 1e6;
  const cpu = process.cpuUsage(cpu0);
  const cpuMs = (cpu.user + cpu.system) / 1e3;

  const per = (ns) => (ns / 1e6 / TOKENS).toFixed(4);
  console.log(`\n=== per-token decomposition (n=${TOKENS}) ms/token ===`);
  console.log(`  joint.run()           : ${per(tJoint)}`);
  console.log(`  decoder.run()         : ${per(tDec)}`);
  console.log(`  argmax over V=${V}   : ${per(tArgmax)}`);
  console.log(`  dlast copy (640)      : ${per(tDlast)}`);
  console.log(`  joint decT tensor     : ${per(tTensor)}`);
  console.log(`  dec targets tensor    : ${per(tDecTensor)}`);
  const jsOverhead = tArgmax + tDlast + tTensor + tDecTensor;
  const native = tJoint + tDec;
  console.log(`  -- JS overhead (argmax+dlast+tensors): ${per(jsOverhead)} ms/token`);
  console.log(`  -- native Run() (joint+dec)          : ${per(native)} ms/token`);
  console.log(`  total/token=${(wall / TOKENS).toFixed(4)}ms  wall=${wall.toFixed(0)}ms  cpu=${cpuMs.toFixed(0)}ms (${(cpuMs / wall).toFixed(2)} core)`);
})();
