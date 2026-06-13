// Fast GPU-only encoder inference bench, explicit flush. NPU compile is too slow to bench inline.
const { addon: ov } = require('openvino-node');
const path = require('path');
const W = (s)=>{ process.stdout.write(s+'\n'); };
function f32(dims){ const n=dims.reduce((a,b)=>a*b,1); return new ov.Tensor('f32', dims, new Float32Array(n)); }
function i64(dims, fill=0){ const n=dims.reduce((a,b)=>a*b,1); const a=new BigInt64Array(n); a.fill(BigInt(fill)); return new ov.Tensor('i64', dims, a); }
(async () => {
  const core = new ov.Core();
  const enc = path.resolve('bin/stt/nemotron-int4/encoder.onnx');
  W('reading model...');
  const model = await core.readModel(enc);
  const feeds = {
    audio_signal: f32([1,65,128]), length: i64([1],65),
    cache_last_channel: f32([1,24,56,1024]), cache_last_time: f32([1,24,1024,8]),
    cache_last_channel_len: i64([1],0), lang_id: i64([1],10),
  };
  const dev='GPU';
  const t0=Date.now();
  const cm = await core.compileModel(model, dev);
  W(`${dev} compile ${Date.now()-t0}ms`);
  const ir = cm.createInferRequest();
  for(let i=0;i<3;i++){ await ir.inferAsync(feeds); }
  W(`${dev} warmup done`);
  const N=30; const t1=Date.now();
  for(let i=0;i<N;i++){ await ir.inferAsync(feeds); }
  const per=(Date.now()-t1)/N;
  W(`${dev} INFER ${per.toFixed(1)} ms/chunk RTF=${(per/560).toFixed(3)} budget560ms`);
  process.exit(0);
})().catch(e=>{ W('ERR '+String(e.message||e).slice(0,400)); process.exit(1); });
